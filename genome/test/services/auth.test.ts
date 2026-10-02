import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import { AuditService } from '../../src/server/services/audit.js';
import {
  ACCOUNT_LOGIN_THROTTLE,
  ADMIN_LOCKOUT_MS,
  ADMIN_LOCKOUT_THRESHOLD,
  AuthService,
  checkPasswordPolicy,
  deriveTotpEncryptionKey,
  normalizeEmail,
} from '../../src/server/services/auth.js';
import { SessionService } from '../../src/server/services/sessions.js';
import { AccountRecoveryService } from '../../src/server/services/account-recovery.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { OwnershipService } from '../../src/server/services/ownership.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { testConfig } from '../../src/server/config.js';
import { DomainError } from '../../src/server/errors.js';
import { createManualClock, type Actor } from '../../src/server/types.js';

const PASSWORD = 'correct horse battery staple';
const system: Actor = { type: 'system', id: 'test' };

async function expectDomainError(p: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('pure helpers', () => {
  it('normalises emails for lookup', () => {
    expect(normalizeEmail('  Client@Example.COM ')).toEqual({ email: 'Client@Example.COM', normalized: 'client@example.com' });
    for (const bad of ['', 'no-at', 'a@b', 'a b@c.d', `${'a'.repeat(250)}@x.io`, 'a@b.c\u0000', 42, null]) {
      expect(normalizeEmail(bad)).toBeUndefined();
    }
  });

  it('enforces the password policy (≥ 12 characters, bounded, not trivial)', () => {
    expect(checkPasswordPolicy(PASSWORD)).toBe(PASSWORD);
    const fail = (pw: unknown, email?: string) => {
      try {
        checkPasswordPolicy(pw, email);
        return 'ok';
      } catch (e) {
        return (e as DomainError).code;
      }
    };
    expect(fail('short-pass1')).toBe('VALIDATION_FAILED');
    expect(fail('aaaaaaaaaaaaaaaa')).toBe('VALIDATION_FAILED');
    expect(fail(' '.repeat(20))).toBe('VALIDATION_FAILED');
    expect(fail('x'.repeat(1025))).toBe('VALIDATION_FAILED');
    expect(fail('me@example.com12', 'ME@example.com12')).toBe('VALIDATION_FAILED');
    expect(fail(undefined)).toBe('VALIDATION_FAILED');
    // 12 code points, not 12 UTF-16 units: emoji count once.
    expect(fail('🔒🔒🔒🔒🔒🔒abcdef')).toBe('ok');
  });

  it('derives a purpose-bound TOTP key from the KEK, else the cookie secret', () => {
    const base = testConfig();
    const k1 = deriveTotpEncryptionKey(base);
    expect(k1).toHaveLength(32);
    expect(deriveTotpEncryptionKey(base)).toEqual(k1);
    const withKek = testConfig({ keys: { provider: 'local', dir: '/tmp/k', encryptionKey: Buffer.alloc(32, 9).toString('base64url') } });
    expect(Buffer.from(deriveTotpEncryptionKey(withKek)).equals(Buffer.from(k1))).toBe(false);
  });
});

describe('AuthService', () => {
  let t: TestDb;
  let audit: AuditService;
  let sessions: SessionService;
  let auth: AuthService;
  const clock = createManualClock('2026-08-01T08:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    sessions = new SessionService({ db: t.db, clock: clock.now, ttlHours: { account: 720, admin: 8 } });
    auth = new AuthService({ db: t.db, audit, sessions, clock: clock.now, totpKey: deriveTotpEncryptionKey(testConfig()) });
  });
  afterAll(() => t.close());

  let n = 0;
  const email = (prefix = 'user') => `${prefix}.${++n}@Example.com`;

  describe('accounts', () => {
    it('registers, hashes with scrypt N=2^15 r=8 p=1 and logs in', async () => {
      const addr = email();
      const { account, session } = await auth.registerAccount({ email: ` ${addr} `, password: PASSWORD, displayName: ' Ada ', country: 'fr' }, { ipHash: 'ip-1', userAgent: 'UA' });
      expect(account).toMatchObject({ email: addr, displayName: 'Ada', country: 'FR', status: 'ACTIVE' });
      expect(session).toMatchObject({ subjectType: 'account', subjectId: account.id, mfaPassed: false });
      const row = await t.db.selectFrom('accounts').selectAll().where('id', '=', account.id).executeTakeFirstOrThrow();
      expect(row.email_normalized).toBe(addr.toLowerCase());
      expect(row.password_hash).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
      expect(row.password_hash).not.toContain(PASSWORD);
      expect((await auth.authenticateAccount(session.token))?.account.id).toBe(account.id);

      // The audit log is append-only: it must not hold customer PII.
      const entry = (await audit.list({ action: 'account.register', targetId: account.id })).items[0];
      expect(entry).toMatchObject({ actorType: 'account', actorId: account.id, ipHash: 'ip-1' });
      expect(JSON.stringify(entry)).not.toMatch(/example\.com|Ada/i);
    });

    it('refuses duplicate emails case-insensitively, and invalid input', async () => {
      const addr = email();
      await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      await expectDomainError(auth.registerAccount({ email: addr.toUpperCase(), password: PASSWORD }, {}), 'EMAIL_TAKEN', 409);
      await expectDomainError(auth.registerAccount({ email: 'nope', password: PASSWORD }, {}), 'VALIDATION_FAILED', 400);
      await expectDomainError(auth.registerAccount({ email: email(), password: 'too-short' }, {}), 'VALIDATION_FAILED', 400);
      await expectDomainError(auth.registerAccount({ email: email(), password: PASSWORD, country: 'FRA' }, {}), 'VALIDATION_FAILED', 400);
      await expectDomainError(auth.registerAccount({ email: email(), password: PASSWORD, displayName: '<script>' }, {}), 'VALIDATION_FAILED', 400);
    });

    it('logs in with the right password only, with one generic error', async () => {
      const addr = email();
      await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      const ok = await auth.login({ email: addr.toUpperCase(), password: PASSWORD }, {});
      expect(ok.account.email).toBe(addr);
      const wrong = await expectDomainError(auth.login({ email: addr, password: `${PASSWORD}!` }, {}), 'INVALID_CREDENTIALS', 401);
      const unknown = await expectDomainError(auth.login({ email: email('ghost'), password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
      expect(wrong.publicMessage).toBe(unknown.publicMessage);
      await expectDomainError(auth.login({ email: 'garbage', password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
      await expectDomainError(auth.login({ email: addr, password: undefined as unknown as string }, {}), 'INVALID_CREDENTIALS', 401);
      expect((await audit.list({ action: 'account.login_failed', targetId: ok.account.id })).total).toBe(1);
    });

    it(`throttles an account after ${ACCOUNT_LOGIN_THROTTLE.maxFailures} wrong passwords in 15 minutes, answering with the same generic error`, async () => {
      expect(ACCOUNT_LOGIN_THROTTLE).toEqual({ maxFailures: 10, windowMs: 15 * 60_000 });
      const addr = email();
      const { account } = await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      const generic = (await expectDomainError(auth.login({ email: email('ghost'), password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401)).publicMessage;
      for (let i = 0; i < 10; i++) {
        clock.advance(10_000);
        await expectDomainError(auth.login({ email: addr, password: `wrong password ${i}` }, {}), 'INVALID_CREDENTIALS', 401);
      }
      // The right password no longer helps while the window lasts, and the answer does not say why.
      const throttled = await expectDomainError(auth.login({ email: addr, password: PASSWORD }, { ipHash: 'ip-9' }), 'INVALID_CREDENTIALS', 401);
      expect(throttled.publicMessage).toBe(generic);
      expect((await audit.list({ action: 'account.login_failed', targetId: account.id })).total).toBe(10);
      expect((await audit.list({ action: 'account.login_throttled', targetId: account.id })).total).toBe(1);

      clock.advance(15 * 60_000);
      expect((await auth.login({ email: addr, password: PASSWORD }, {})).account.id).toBe(account.id);
      const row = await t.db.selectFrom('accounts').select(['failed_logins', 'failed_logins_since']).where('id', '=', account.id).executeTakeFirstOrThrow();
      expect(row).toEqual({ failed_logins: 0, failed_logins_since: null });

      // Failures spread beyond the window start a new window instead of adding up.
      for (let i = 0; i < 9; i++) await expectDomainError(auth.login({ email: addr, password: 'wrong password!!' }, {}), 'INVALID_CREDENTIALS', 401);
      clock.advance(16 * 60_000);
      for (let i = 0; i < 9; i++) await expectDomainError(auth.login({ email: addr, password: 'wrong password!!' }, {}), 'INVALID_CREDENTIALS', 401);
      expect((await auth.login({ email: addr, password: PASSWORD }, {})).account.id).toBe(account.id);
    });

    it('verifies NFKC-equivalent passwords', async () => {
      const addr = email();
      await auth.registerAccount({ email: addr, password: 'ｐａｓｓｗｏｒｄ１２３４' }, {});
      expect((await auth.login({ email: addr, password: 'password1234' }, {})).account.email).toBe(addr);
    });

    it('rotates the session on login and logs out', async () => {
      const addr = email();
      const reg = await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      const login = await auth.login({ email: addr, password: PASSWORD }, { previousToken: reg.session.token });
      expect(await auth.authenticateAccount(reg.session.token)).toBeNull();
      expect((await auth.authenticateAccount(login.session.token))?.account.id).toBe(reg.account.id);
      await auth.logout(login.session.token, 'account');
      expect(await auth.authenticateAccount(login.session.token)).toBeNull();
      expect((await audit.list({ action: 'account.logout', targetId: reg.account.id })).total).toBe(1);
      await auth.logout(login.session.token, 'account'); // idempotent
      await auth.logout('garbage', 'account');
    });

    it('locked and deleted accounts cannot log in; their sessions stop working', async () => {
      const addr = email();
      const { account, session } = await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', account.id).execute();
      expect(await auth.authenticateAccount(session.token)).toBeNull();
      expect(await sessions.validate(session.token, 'account')).toBeNull(); // revoked, not just refused
      await expectDomainError(auth.login({ email: addr, password: PASSWORD }, {}), 'ACCOUNT_LOCKED', 403);
      await expectDomainError(auth.login({ email: addr, password: 'wrong password!!' }, {}), 'INVALID_CREDENTIALS', 401);
      await t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', account.id).execute();
      await expectDomainError(auth.login({ email: addr, password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
    });

    it('an account session token is not an admin session', async () => {
      const { session } = await auth.registerAccount({ email: email(), password: PASSWORD }, {});
      expect(await auth.authenticateAdmin(session.token)).toBeNull();
    });

    it('changes the password, revoking every other session', async () => {
      const addr = email();
      const reg = await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      const other = await auth.login({ email: addr, password: PASSWORD }, {});
      const subject = { type: 'account' as const, id: reg.account.id };
      // A wrong current password is a 400, never a 401 (the apps sign out on any 401), and changes nothing.
      await expectDomainError(
        auth.changePassword(subject, { currentPassword: 'not my password', newPassword: 'a brand new passphrase' }, { type: 'account', id: reg.account.id }),
        'CURRENT_PASSWORD_INVALID',
        400,
      );
      expect(await auth.authenticateAccount(other.session.token)).not.toBeNull();
      // A weak new password is refused before the current one is checked.
      await expectDomainError(auth.changePassword(subject, { currentPassword: PASSWORD, newPassword: 'short' }, { type: 'account', id: reg.account.id }), 'VALIDATION_FAILED', 400);
      await auth.changePassword(subject, { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' }, { type: 'account', id: reg.account.id }, { keepToken: reg.session.token });
      expect(await auth.authenticateAccount(other.session.token)).toBeNull();
      expect(await auth.authenticateAccount(reg.session.token)).not.toBeNull();
      await expectDomainError(auth.login({ email: addr, password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
      expect((await auth.login({ email: addr, password: 'a brand new passphrase' }, {})).account.id).toBe(reg.account.id);
      const entry = (await audit.list({ action: 'account.password_change', targetId: reg.account.id })).items[0];
      expect(entry).toMatchObject({ actorType: 'account', actorId: reg.account.id });
    });

    it('counts a wrong current password in the login throttle, and then stops checking it', async () => {
      const addr = email();
      const reg = await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      const subject = { type: 'account' as const, id: reg.account.id };
      const actor = { type: 'account' as const, id: reg.account.id, ipHash: 'ip-7' };
      for (let i = 0; i < ACCOUNT_LOGIN_THROTTLE.maxFailures; i++) {
        await expectDomainError(auth.changePassword(subject, { currentPassword: `wrong password ${i}`, newPassword: 'a brand new passphrase' }, actor), 'CURRENT_PASSWORD_INVALID', 400);
      }
      const failures = (await audit.list({ action: 'account.login_failed', targetId: reg.account.id })).items;
      expect(failures).toHaveLength(ACCOUNT_LOGIN_THROTTLE.maxFailures);
      expect(failures[0]).toMatchObject({ ipHash: 'ip-7', details: { via: 'password_change', throttled: true } });
      // Throttled: even the right current password is refused, with the same answer; so is a login.
      await expectDomainError(auth.changePassword(subject, { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' }, actor), 'CURRENT_PASSWORD_INVALID', 400);
      await expectDomainError(auth.login({ email: addr, password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
      clock.advance(ACCOUNT_LOGIN_THROTTLE.windowMs);
      await auth.changePassword(subject, { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' }, actor, { keepToken: reg.session.token });
      expect(await auth.authenticateAccount(reg.session.token)).not.toBeNull();
    });

    it('a recovery code from ORBES Client Services ends every session and sets the new password', async () => {
      const addr = email();
      const reg = await auth.registerAccount({ email: addr, password: PASSWORD }, {});
      const other = await auth.login({ email: addr, password: PASSWORD }, {});
      const lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
      const ownership = new OwnershipService({ db: t.db, audit, lifecycle, clock: clock.now });
      const recovery = new AccountRecoveryService({ db: t.db, audit, sessions, ownership, clock: clock.now });
      const staff = await auth.createAdmin({ email: email('cs'), password: PASSWORD, role: 'ADMIN' }, system);
      const { recoveryCode } = await recovery.issue(reg.account.id, { type: 'admin', id: staff.id });
      // Wrong email, then a code past its 30 minutes: one answer.
      await expectDomainError(recovery.recover({ email: email('nobody'), recoveryCode, newPassword: 'a brand new passphrase' }), 'RECOVERY_CODE_INVALID', 400);
      await recovery.recover({ email: addr, recoveryCode, newPassword: 'a brand new passphrase' });
      expect(await auth.authenticateAccount(reg.session.token)).toBeNull();
      expect(await auth.authenticateAccount(other.session.token)).toBeNull();
      expect((await auth.login({ email: addr, password: 'a brand new passphrase' }, {})).account.id).toBe(reg.account.id);
      // Used once.
      await expectDomainError(recovery.recover({ email: addr, recoveryCode, newPassword: 'another new passphrase' }), 'RECOVERY_CODE_INVALID', 400);
      const second = await recovery.issue(reg.account.id, { type: 'admin', id: staff.id });
      clock.advance(30 * 60_000);
      await expectDomainError(recovery.recover({ email: addr, recoveryCode: second.recoveryCode, newPassword: 'another new passphrase' }), 'RECOVERY_CODE_INVALID', 400);
    });
  });

  describe('admins', () => {
    async function newAdmin(role: 'ADMIN' | 'OPERATOR' | 'AUDITOR' = 'OPERATOR') {
      const addr = email('admin');
      const admin = await auth.createAdmin({ email: addr, password: PASSWORD, role }, system);
      return { ...admin, addr };
    }

    it('creates admins and logs in without TOTP (mfaPassed = false)', async () => {
      const a = await newAdmin('AUDITOR');
      expect(a).toMatchObject({ role: 'AUDITOR', totpEnabled: false });
      const { admin, session } = await auth.adminLogin({ email: a.addr, password: PASSWORD }, {});
      expect(admin.id).toBe(a.id);
      expect(session).toMatchObject({ subjectType: 'admin', mfaPassed: false });
      expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(8 * 3_600_000);
      expect((await auth.authenticateAdmin(session.token))?.admin.role).toBe('AUDITOR');
      expect(await auth.authenticateAccount(session.token)).toBeNull();
      await expectDomainError(auth.createAdmin({ email: a.addr, password: PASSWORD, role: 'ADMIN' }, system), 'EMAIL_TAKEN', 409);
      await expectDomainError(auth.createAdmin({ email: email(), password: PASSWORD, role: 'ROOT' as 'ADMIN' }, system), 'VALIDATION_FAILED', 400);
    });

    it(`locks after ${ADMIN_LOCKOUT_THRESHOLD} failures for 15 minutes, refusing even the right password`, async () => {
      const a = await newAdmin();
      for (let i = 1; i <= ADMIN_LOCKOUT_THRESHOLD; i++) {
        await expectDomainError(auth.adminLogin({ email: a.addr, password: `wrong password ${i}` }, {}), 'INVALID_CREDENTIALS', 401);
      }
      let row = await t.db.selectFrom('admin_users').selectAll().where('id', '=', a.id).executeTakeFirstOrThrow();
      expect(row.failed_logins).toBe(ADMIN_LOCKOUT_THRESHOLD);
      expect(row.locked_until?.getTime()).toBe(clock.now().getTime() + ADMIN_LOCKOUT_MS);
      await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD }, {}), 'ACCOUNT_LOCKED', 429);

      clock.advance(ADMIN_LOCKOUT_MS - 1);
      await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD }, {}), 'ACCOUNT_LOCKED', 429);
      clock.advance(1);
      // Still at the threshold: one more failure re-locks at once (no fresh 10-guess budget).
      await expectDomainError(auth.adminLogin({ email: a.addr, password: 'still wrong!!' }, {}), 'INVALID_CREDENTIALS', 401);
      await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD }, {}), 'ACCOUNT_LOCKED', 429);
      clock.advance(ADMIN_LOCKOUT_MS);
      await auth.adminLogin({ email: a.addr, password: PASSWORD }, {});
      row = await t.db.selectFrom('admin_users').selectAll().where('id', '=', a.id).executeTakeFirstOrThrow();
      expect(row.failed_logins).toBe(0);
      expect(row.locked_until).toBeNull();
      const failures = await audit.list({ action: 'admin.login_failed', targetId: a.id });
      expect(failures.total).toBe(ADMIN_LOCKOUT_THRESHOLD + 1);
      expect(failures.items[0].details).toMatchObject({ reason: 'password', locked: true });
    });

    it('disabled admins cannot log in and lose their sessions', async () => {
      const a = await newAdmin();
      const { session } = await auth.adminLogin({ email: a.addr, password: PASSWORD }, {});
      await t.db.updateTable('admin_users').set({ disabled_at: clock.now() }).where('id', '=', a.id).execute();
      expect(await auth.authenticateAdmin(session.token)).toBeNull();
      await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
    });

    describe('TOTP', () => {
      it('enrols in two steps, then requires a fresh code at every login', async () => {
        const a = await newAdmin('ADMIN');
        const { secret, otpauthUri } = await auth.createTotpEnrollment(a.id);
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(otpauthUri).toContain(`secret=${secret}`);
        expect(otpauthUri).toContain('issuer=ORBES');
        expect(decodeURIComponent(otpauthUri)).toContain(a.addr);
        const key = base32Decode(secret);
        const code = (ms = clock.now().getTime()) => totp(key, ms);

        await expectDomainError(auth.enableTotp(a.id, { secret, code: '000000' === code() ? '111111' : '000000' }, system), 'TOTP_CODE_INVALID', 400);
        await expectDomainError(auth.enableTotp(a.id, { secret: 'not base32!', code: code() }, system), 'VALIDATION_FAILED', 400);
        await auth.enableTotp(a.id, { secret, code: code() }, { type: 'admin', id: a.id });
        expect((await auth.getAdmin(a.id)).totpEnabled).toBe(true);
        await expectDomainError(auth.createTotpEnrollment(a.id), 'TOTP_ALREADY_ENABLED', 409);
        await expectDomainError(auth.enableTotp(a.id, { secret, code: code() }, system), 'TOTP_ALREADY_ENABLED', 409);

        // Stored encrypted, never in clear.
        const row = await t.db.selectFrom('admin_users').select('totp_secret_enc').where('id', '=', a.id).executeTakeFirstOrThrow();
        expect(row.totp_secret_enc).toMatch(/^v1\./);
        expect(row.totp_secret_enc).not.toContain(secret);

        // Password alone: TOTP_REQUIRED, not counted as a failure.
        await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD }, {}), 'TOTP_REQUIRED', 401);
        // Wrong password with a code: the generic error, counted.
        await expectDomainError(auth.adminLogin({ email: a.addr, password: 'wrong password!', totp: code() }, {}), 'INVALID_CREDENTIALS', 401);
        // The code used for enrolment cannot be replayed for login.
        await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code() }, {}), 'INVALID_TOTP', 401);

        clock.advance(30_000);
        const { session } = await auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code() }, {});
        expect(session.mfaPassed).toBe(true);
        // Same code again (same step): replay refused.
        await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code() }, {}), 'INVALID_TOTP', 401);
        // A code from the previous step is older than the last accepted one: refused too.
        clock.advance(30_000);
        await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code(clock.now().getTime() - 30_000) }, {}), 'INVALID_TOTP', 401);
        expect((await auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code() }, {})).session.mfaPassed).toBe(true);

        const row2 = await t.db.selectFrom('admin_users').select('failed_logins').where('id', '=', a.id).executeTakeFirstOrThrow();
        expect(row2.failed_logins).toBe(0); // reset by the successful login
        expect((await audit.list({ action: 'admin.login_failed', targetId: a.id })).items.map((e) => e.details.reason)).toEqual(['totp', 'totp', 'totp', 'password']);
      });

      it('accepts ±1 step of drift', async () => {
        const a = await newAdmin();
        const { secret } = await auth.createTotpEnrollment(a.id);
        const key = base32Decode(secret);
        await auth.enableTotp(a.id, { secret, code: totp(key, clock.now().getTime()) }, system);
        clock.advance(120_000);
        const ahead = totp(key, clock.now().getTime() + 30_000);
        expect((await auth.adminLogin({ email: a.addr, password: PASSWORD, totp: ahead }, {})).session.mfaPassed).toBe(true);
        clock.advance(120_000);
        const tooOld = totp(key, clock.now().getTime() - 60_000);
        await expectDomainError(auth.adminLogin({ email: a.addr, password: PASSWORD, totp: tooOld }, {}), 'INVALID_TOTP', 401);
      });

      it('binds the encrypted secret to its admin (swapped rows fail closed)', async () => {
        const a = await newAdmin();
        const b = await newAdmin();
        for (const x of [a, b]) {
          const { secret } = await auth.createTotpEnrollment(x.id);
          await auth.enableTotp(x.id, { secret, code: totp(base32Decode(secret), clock.now().getTime()) }, system);
        }
        const aRow = await t.db.selectFrom('admin_users').select('totp_secret_enc').where('id', '=', a.id).executeTakeFirstOrThrow();
        await t.db.updateTable('admin_users').set({ totp_secret_enc: aRow.totp_secret_enc }).where('id', '=', b.id).execute();
        await expectDomainError(auth.adminLogin({ email: b.addr, password: PASSWORD, totp: '123456' }, {}), 'TOTP_UNAVAILABLE', 503);
      });

      it('can be disabled (then password-only again)', async () => {
        const a = await newAdmin();
        await expectDomainError(auth.disableTotp(a.id, system), 'TOTP_NOT_ENABLED', 409);
        const { secret } = await auth.createTotpEnrollment(a.id);
        await auth.enableTotp(a.id, { secret, code: totp(base32Decode(secret), clock.now().getTime()) }, system);
        await auth.disableTotp(a.id, system);
        expect((await auth.adminLogin({ email: a.addr, password: PASSWORD }, {})).session.mfaPassed).toBe(false);
        expect((await audit.list({ action: 'admin.totp.disable', targetId: a.id })).total).toBe(1);
        await expectDomainError(auth.disableTotp('00000000-0000-4000-8000-000000000000', system), 'ADMIN_NOT_FOUND', 404);
      });
    });
  });

  describe('bootstrapAdmin', () => {
    it('creates the configured ADMIN only when no admin exists', async () => {
      const fresh = await createTestDb();
      try {
        const freshAudit = new AuditService({ db: fresh.db, clock: clock.now });
        const freshSessions = new SessionService({ db: fresh.db, clock: clock.now, ttlHours: { account: 1, admin: 1 } });
        const a = new AuthService({ db: fresh.db, audit: freshAudit, sessions: freshSessions, clock: clock.now, totpKey: new Uint8Array(32).fill(1) });
        expect(await a.bootstrapAdmin({})).toEqual({ created: false });
        const cfg = { bootstrapAdmin: { email: 'root@theorbes.com', password: PASSWORD } };
        const [r1, r2] = await Promise.all([a.bootstrapAdmin(cfg), a.bootstrapAdmin(cfg)]);
        expect([r1.created, r2.created].filter(Boolean)).toHaveLength(1);
        expect(await a.bootstrapAdmin(cfg)).toEqual({ created: false });
        const admins = await fresh.db.selectFrom('admin_users').selectAll().execute();
        expect(admins).toHaveLength(1);
        expect(admins[0]).toMatchObject({ role: 'ADMIN', email_normalized: 'root@theorbes.com' });
        const { admin } = await a.adminLogin({ email: 'root@theorbes.com', password: PASSWORD }, {});
        expect(admin.role).toBe('ADMIN');
        expect((await freshAudit.list({ action: 'admin.create' })).items[0]).toMatchObject({ actorType: 'system', actorId: 'bootstrap' });
      } finally {
        await fresh.close();
      }
    });
  });

  it('rejects a TOTP key of the wrong size', () => {
    expect(() => new AuthService({ db: t.db, audit, sessions, totpKey: new Uint8Array(16) })).toThrow(RangeError);
  });
});
