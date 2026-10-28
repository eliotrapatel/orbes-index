/**
 * The shared admin step-up (plan PURGE §S, PURGE.1): verifyAdminStepUp before the action's transaction, then
 * consumeAdminStepUp first inside it. Every refusal in its order, the code consumed once and only by an action that
 * commits, the step-up's own daily limit that an unlock does not clear, the 24-hour rule per action, consume's
 * re-checks of what changed between the two calls, and the facts a platform reset carries into entry 1 (§S.2.8, H5).
 * No code, password or session token ever reaches the audit chain or the log.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashSecret } from '../../src/server/crypto/scrypt.js';
import { seal } from '../../src/server/crypto/secretbox.js';
import { base32Decode, generateTotpSecret, totp } from '../../src/server/crypto/totp.js';
import { testConfig } from '../../src/server/config.js';
import { inTransaction, type Db } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import {
  ADMIN_LOCKOUT_THRESHOLD,
  AuthService,
  deriveTotpEncryptionKey,
  STEP_UP_DAILY_FAILURES,
  type StepUpPurpose,
  type VerifiedStepUp,
} from '../../src/server/services/auth.js';
import { parisWhen } from '../../src/server/services/maintenance-window.js';
import { SessionService } from '../../src/server/services/sessions.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new password, long enough';
const WRONG_PASSWORD = 'not the password at all';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const system: Actor = { type: 'system', id: 'test' };
const RUN_ID = '0b6f6c1e-55d2-4a63-9a3b-0d6f1f9b2c11';
const PURGE: StepUpPurpose = `test_run.purge:${RUN_ID}`;
const TOTP_KEY = deriveTotpEncryptionKey(testConfig());

/** Every code, password and session token a test typed: none may appear in an audit row or a log line. */
const secrets = new Set<string>([PASSWORD, NEW_PASSWORD, WRONG_PASSWORD]);

const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const real = console[m].bind(console);
  vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
    real(...args);
  });
}

async function refusal(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

async function expectRefused(p: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  const e = await refusal(p);
  expect({ code: e.code, status: e.httpStatus }).toEqual({ code, status });
  return e;
}

/** Every value of a JSON tree (strings and numbers), to look for secrets in audit details. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (v === null || v === undefined) return out;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => leaves(x, out));
  return out;
}

/** No audit row (any column) and no log line holds a code, a password or a session token. */
async function expectNothingSecret(db: Db): Promise<void> {
  const rows = await db.selectFrom('audit_logs').select(['action', 'actor_id', 'target_type', 'target_id', 'details', 'ip_hash']).execute();
  for (const r of rows) {
    const values = [r.action, r.actor_id, r.target_type, r.target_id, r.ip_hash, ...leaves(r.details)].filter((x): x is string => typeof x === 'string');
    for (const s of secrets) {
      for (const v of values) {
        if (/^\d{6}$/.test(s) ? v === s : v.includes(s)) throw new Error(`a secret is in the audit row ${r.action}`);
      }
    }
  }
  for (const line of logged) for (const s of secrets) if (!/^\d{6}$/.test(s) && line.includes(s)) throw new Error('a secret is in the log');
  for (const line of logged) for (const s of secrets) if (/^\d{6}$/.test(s) && new RegExp(`(^|\\D)${s}(\\D|$)`).test(line)) throw new Error('a code is in the log');
}

interface Stack {
  t: TestDb;
  clock: ManualClock;
  audit: AuditService;
  sessions: SessionService;
  auth: AuthService;
}

async function stack(start: string): Promise<Stack> {
  const t = await createTestDb();
  const clock = createManualClock(start);
  const audit = new AuditService({ db: t.db, clock: clock.now });
  const sessions = new SessionService({ db: t.db, clock: clock.now, ttlHours: { account: 720, admin: 8 } });
  const auth = new AuthService({ db: t.db, audit, sessions, clock: clock.now, totpKey: TOTP_KEY });
  return { t, clock, audit, sessions, auth };
}

interface Login {
  id: string;
  addr: string;
  key: Uint8Array;
  token: string;
}

let n = 0;

describe('the admin step-up', () => {
  let s: Stack;
  /** Another ADMIN, who unlocks, disables, changes roles and resets second factors. */
  let other: { id: string; actor: Actor };

  beforeAll(async () => {
    s = await stack('2026-08-01T08:00:00.000Z');
    const o = await s.auth.createAdmin({ email: 'other.admin@example.com', password: PASSWORD, role: 'ADMIN' }, system);
    other = { id: o.id, actor: { type: 'admin', id: o.id } };
  });
  afterAll(async () => {
    await expectNothingSecret(s.t.db);
    await s.t.close();
  });

  /** The code of the next time step (30 s later), so it was never used. */
  function nextCode(key: Uint8Array): string {
    s.clock.advance(30_000);
    const c = totp(key, s.clock.now().getTime());
    secrets.add(c);
    return c;
  }

  function wrongCode(key: Uint8Array): string {
    const right = totp(key, s.clock.now().getTime());
    const near = [-1, 1].map((d) => totp(key, s.clock.now().getTime() + d * 30_000));
    for (let i = 0; ; i++) {
      const c = String((Number(right) + 111_111 * (i + 1)) % 1_000_000).padStart(6, '0');
      if (c !== right && !near.includes(c)) return c;
    }
  }

  /** An admin of `role` with a second factor, its own rows (creation, enrolment) more than 24 h old. */
  async function enrolled(role: 'ADMIN' | 'OPERATOR' = 'ADMIN'): Promise<{ id: string; addr: string; key: Uint8Array }> {
    const addr = `step.up.${++n}@example.com`;
    const a = await s.auth.createAdmin({ email: addr, password: PASSWORD, role }, system);
    const { secret } = await s.auth.createTotpEnrollment(a.id);
    const key = base32Decode(secret);
    await s.auth.enableTotp(a.id, { secret, code: nextCode(key) }, { type: 'admin', id: a.id });
    s.clock.advance(DAY + MIN);
    return { id: a.id, addr, key };
  }

  /** Sign in with the password and a fresh code: a session that passed MFA. */
  async function signIn(a: { id: string; addr: string; key: Uint8Array }): Promise<Login> {
    const { session } = await s.auth.adminLogin({ email: a.addr, password: PASSWORD, totp: nextCode(a.key) }, {});
    expect(session.mfaPassed).toBe(true);
    secrets.add(session.token);
    return { ...a, token: session.token };
  }

  async function ready(role: 'ADMIN' | 'OPERATOR' = 'ADMIN'): Promise<Login> {
    return signIn(await enrolled(role));
  }

  function verify(a: Login, totpCode: unknown, opts: { purpose?: StepUpPurpose; password?: unknown; requirePassword?: boolean; token?: string } = {}) {
    return s.auth.verifyAdminStepUp(
      { adminId: a.id, token: opts.token ?? a.token, totp: totpCode, password: opts.password, purpose: opts.purpose ?? PURGE, requirePassword: opts.requirePassword ?? false },
      { ipHash: 'ip-hash-of-the-test' },
    );
  }

  /**
   * A route-shaped action: one transaction that writes a row of its own first, consumes the step-up, then writes the
   * action's row. A refusal of consume rolls everything back.
   */
  function action(v: VerifiedStepUp, opts: { failAfter?: boolean } = {}) {
    return inTransaction(s.t.db, async (tx) => {
      await s.audit.record({ actor: system, action: 'test.before_step_up', targetType: 'admin', targetId: v.adminId }, tx);
      await s.auth.consumeAdminStepUp(v, tx, { ipHash: 'ip-hash-of-the-test' });
      await s.audit.record({ actor: system, action: 'test.action', targetType: 'admin', targetId: v.adminId }, tx);
      if (opts.failAfter) throw new Error('the action failed');
    });
  }

  async function rows(action: string, adminId: string) {
    return s.t.db.selectFrom('audit_logs').select(['id', 'details', 'actor_id', 'ip_hash']).where('action', '=', action).where('target_id', '=', adminId).orderBy('id').execute();
  }

  async function sealedOf(adminId: string): Promise<string | null> {
    return (await s.t.db.selectFrom('admin_users').select('totp_secret_enc').where('id', '=', adminId).executeTakeFirstOrThrow()).totp_secret_enc;
  }

  async function failedLogins(adminId: string): Promise<number> {
    return (await s.t.db.selectFrom('admin_users').select('failed_logins').where('id', '=', adminId).executeTakeFirstOrThrow()).failed_logins;
  }

  /** The action committed nothing: no row of its own, no admin.step_up row, the sealed TOTP state as given. */
  async function expectNothingCommitted(adminId: string, sealed: string | null): Promise<void> {
    expect(await rows('test.before_step_up', adminId)).toEqual([]);
    expect(await rows('test.action', adminId)).toEqual([]);
    expect(await rows('admin.step_up', adminId)).toEqual([]);
    expect(await sealedOf(adminId)).toBe(sealed);
  }

  describe('verifyAdminStepUp: the refusals, in order, before any code', () => {
    it('1. a disabled admin: 401 (its sessions ended with it), before its role', async () => {
      const a = await ready();
      await s.auth.setAdminRole(a.id, 'OPERATOR', other.actor);
      await s.auth.setAdminDisabled(a.id, true, other.actor);
      await expectRefused(verify(a, nextCode(a.key)), 'UNAUTHORIZED', 401);
      // An unknown admin or a malformed id answers the same.
      await expectRefused(verify({ ...a, id: '7a0c3a52-8f0e-4b8e-9d3c-111111111111' }, nextCode(a.key)), 'UNAUTHORIZED', 401);
      await expectRefused(verify({ ...a, id: 'not-an-id' }, nextCode(a.key)), 'UNAUTHORIZED', 401);
    });

    it('2. a role other than ADMIN: 403 INSUFFICIENT_ROLE, before the second factor', async () => {
      const op = await ready('OPERATOR');
      await expectRefused(verify(op, nextCode(op.key)), 'INSUFFICIENT_ROLE', 403);
      // An OPERATOR with no second factor at all: still the role first.
      const addr = `step.up.${++n}@example.com`;
      const bare = await s.auth.createAdmin({ email: addr, password: PASSWORD, role: 'OPERATOR' }, system);
      const { session } = await s.auth.adminLogin({ email: addr, password: PASSWORD }, {});
      secrets.add(session.token);
      await expectRefused(verify({ id: bare.id, addr, key: op.key, token: session.token }, '123456'), 'INSUFFICIENT_ROLE', 403);
    });

    it('3. no second factor enrolled, whatever ADMIN_REQUIRE_MFA says: 403 STEP_UP_TOTP_NOT_ENABLED, before the session', async () => {
      const addr = `step.up.${++n}@example.com`;
      const a = await s.auth.createAdmin({ email: addr, password: PASSWORD, role: 'ADMIN' }, system);
      s.clock.advance(DAY + MIN);
      // Signed in with the password alone (the guard's MFA rule off): the session did not pass MFA either.
      const { session } = await s.auth.adminLogin({ email: addr, password: PASSWORD }, {});
      secrets.add(session.token);
      expect(session.mfaPassed).toBe(false);
      const e = await expectRefused(verify({ id: a.id, addr, key: new Uint8Array(20), token: session.token }, '123456'), 'STEP_UP_TOTP_NOT_ENABLED', 403);
      expect(e.publicMessage).toBe('Turn on two-factor authentication on the Security page first.');
      expect(await failedLogins(a.id)).toBe(0);
    });

    it('4. a session that did not pass MFA: 403 STEP_UP_SESSION_WITHOUT_CODE, before the lockout; a session that is not this admin\'s: 401', async () => {
      const [ea, eb] = [await enrolled(), await enrolled()];
      const a = await signIn(ea);
      const b = await signIn(eb);
      const plain = await s.sessions.create({ subjectType: 'admin', subjectId: a.id, mfaPassed: false });
      secrets.add(plain.token);
      await s.t.db.updateTable('admin_users').set({ locked_until: new Date(s.clock.now().getTime() + 15 * MIN) }).where('id', '=', a.id).execute();
      const e = await expectRefused(verify(a, nextCode(a.key), { token: plain.token }), 'STEP_UP_SESSION_WITHOUT_CODE', 403);
      expect(e.publicMessage).toBe('Sign out, then sign in again with your authenticator code.');
      await s.t.db.updateTable('admin_users').set({ locked_until: null }).where('id', '=', a.id).execute();
      // Another admin's session, an ended one, or no token: 401.
      await expectRefused(verify(a, nextCode(a.key), { token: b.token }), 'UNAUTHORIZED', 401);
      await expectRefused(verify(a, nextCode(a.key), { token: 'x'.repeat(43) }), 'UNAUTHORIZED', 401);
      await expectRefused(verify(a, nextCode(a.key), { token: '' }), 'UNAUTHORIZED', 401);
      // An account session token is not a console session.
      const acc = await s.auth.registerAccount({ email: `collector.${++n}@example.com`, password: PASSWORD });
      secrets.add(acc.session.token);
      await expectRefused(verify(a, nextCode(a.key), { token: acc.session.token }), 'UNAUTHORIZED', 401);
      // Expired: 401.
      s.clock.advance(8 * HOUR + MIN);
      await expectRefused(verify(a, nextCode(a.key)), 'UNAUTHORIZED', 401);
    });

    it('5. the sign-in lockout: 429 ACCOUNT_LOCKED before any code or password is looked at', async () => {
      const a = await ready();
      await s.t.db.updateTable('admin_users').set({ locked_until: new Date(s.clock.now().getTime() + 15 * MIN) }).where('id', '=', a.id).execute();
      const before = await failedLogins(a.id);
      await expectRefused(verify(a, nextCode(a.key)), 'ACCOUNT_LOCKED', 429);
      await expectRefused(verify(a, wrongCode(a.key), { requirePassword: true, password: WRONG_PASSWORD }), 'ACCOUNT_LOCKED', 429);
      expect(await failedLogins(a.id)).toBe(before);
      expect(await rows('admin.login_failed', a.id)).toEqual([]);
    });

    it('then the password (when required) before the code; a wrong one is counted as a step-up failure', async () => {
      const a = await ready();
      const e = await expectRefused(verify(a, wrongCode(a.key), { requirePassword: true, password: WRONG_PASSWORD }), 'STEP_UP_PASSWORD_INVALID', 400);
      expect(e.publicMessage).toBe('The password is not correct.');
      await expectRefused(verify(a, nextCode(a.key), { requirePassword: true }), 'STEP_UP_PASSWORD_INVALID', 400);
      await expectRefused(verify(a, nextCode(a.key), { requirePassword: true, password: 42 }), 'STEP_UP_PASSWORD_INVALID', 400);
      expect((await rows('admin.login_failed', a.id)).map((r) => r.details)).toEqual([
        { reason: 'password', failedLogins: 1, locked: false, via: 'step_up' },
        { reason: 'password', failedLogins: 2, locked: false, via: 'step_up' },
        { reason: 'password', failedLogins: 3, locked: false, via: 'step_up' },
      ]);
      // Right password and code: verified. A password typed for an action that does not ask for one is not looked at.
      const v = await verify(a, nextCode(a.key), { requirePassword: true, password: PASSWORD });
      await action(v);
      const w = await verify(a, nextCode(a.key), { requirePassword: false, password: WRONG_PASSWORD });
      await action(w);
      expect(await failedLogins(a.id)).toBe(0);
    });

    it('then the code: 400 STEP_UP_CODE_INVALID for a wrong one, 400 STEP_UP_CODE_USED for one whose step was used at sign-in; both counted, never a 401', async () => {
      const a = await enrolled();
      const code = nextCode(a.key);
      const { session } = await s.auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code }, {});
      secrets.add(session.token);
      const login: Login = { ...a, token: session.token };
      const used = await expectRefused(verify(login, code), 'STEP_UP_CODE_USED', 400);
      expect(used.publicMessage).toBe('This code was just used. Wait for the next code.');
      const bad = await expectRefused(verify(login, wrongCode(a.key)), 'STEP_UP_CODE_INVALID', 400);
      expect(bad.publicMessage).toBe('The code is not valid. Check the time on your device and try again.');
      await expectRefused(verify(login, 'abcdef'), 'STEP_UP_CODE_INVALID', 400);
      expect((await rows('admin.login_failed', a.id)).map((r) => r.details)).toEqual([
        { reason: 'totp', failedLogins: 1, locked: false, via: 'step_up' },
        { reason: 'totp', failedLogins: 2, locked: false, via: 'step_up' },
        { reason: 'totp', failedLogins: 3, locked: false, via: 'step_up' },
      ]);
      // Nothing typed (or no text) is not a guess: refused, not counted.
      await expectRefused(verify(login, ''), 'STEP_UP_CODE_INVALID', 400);
      await expectRefused(verify(login, '   '), 'STEP_UP_CODE_INVALID', 400);
      await expectRefused(verify(login, undefined), 'STEP_UP_CODE_INVALID', 400);
      await expectRefused(verify(login, 123456), 'STEP_UP_CODE_INVALID', 400);
      expect(await failedLogins(a.id)).toBe(3);
      // The failures were committed on their own; the session is untouched.
      expect(await s.sessions.isLive(login.token, 'admin', a.id)).toBe(true);
      // The next code passes, and the success puts the counter back to 0.
      await action(await verify(login, nextCode(a.key)));
      expect(await failedLogins(a.id)).toBe(0);
    });

    it('refuses an unknown purpose as a programming error, before reading anything', async () => {
      const a = await ready();
      for (const purpose of ['test_run.purge:', 'test_run.purge:NOT-A-UUID', `test_run.purge:${RUN_ID.toUpperCase()}`, 'platform.reset.now', '', undefined, 7]) {
        const input = { adminId: a.id, token: a.token, totp: nextCode(a.key), purpose: purpose as StepUpPurpose, requirePassword: false };
        await expect(s.auth.verifyAdminStepUp(input)).rejects.toThrow(RangeError);
      }
      expect(await failedLogins(a.id)).toBe(0);
      for (const purpose of [PURGE, 'test_run.purge_all', 'platform.reset', 'platform.reset.lock'] as const) {
        await action(await verify(a, nextCode(a.key), { purpose, requirePassword: purpose.startsWith('platform'), password: PASSWORD }));
      }
      expect((await rows('admin.step_up', a.id)).map((r) => r.details)).toEqual([
        { purpose: PURGE },
        { purpose: 'test_run.purge_all' },
        { purpose: 'platform.reset' },
        { purpose: 'platform.reset.lock' },
      ]);
    });
  });

  describe('the code is consumed once, by an action that commits', () => {
    it('verify then consume: admin.step_up { purpose } targets the admin with its actor; the same code again is STEP_UP_CODE_USED', async () => {
      const a = await ready();
      const code = nextCode(a.key);
      const v = await verify(a, code);
      // Nothing is written by verify.
      expect(await rows('admin.step_up', a.id)).toEqual([]);
      // Nothing secret when the verified state is logged: the token, the sealed state and the hash are not enumerable.
      expect(Object.keys(v).sort()).toEqual(['adminId', 'purpose', 'step']);
      expect(JSON.stringify(v)).not.toContain(a.token);
      expect(Object.isFrozen(v)).toBe(true);
      await action(v);
      const stepUps = await rows('admin.step_up', a.id);
      expect(stepUps.map((r) => ({ details: r.details, actor: r.actor_id, ip: r.ip_hash }))).toEqual([{ details: { purpose: PURGE }, actor: a.id, ip: 'ip-hash-of-the-test' }]);
      expect(await rows('test.action', a.id)).toHaveLength(1);
      await expectRefused(verify(a, code), 'STEP_UP_CODE_USED', 400);
      // Consuming the same verified step-up twice: the second compare-and-swap finds the state changed.
      await expectRefused(action(v), 'STEP_UP_CODE_USED', 400);
      expect(await rows('admin.step_up', a.id)).toHaveLength(1);
      // Signing in with that code afterwards is refused too: the counter moved forward.
      await expect(s.auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code }, {})).rejects.toMatchObject({ code: 'INVALID_TOTP' });
    });

    it('two concurrent step-ups with the same code: exactly one consume passes (compare-and-swap)', async () => {
      const a = await ready();
      const code = nextCode(a.key);
      const [v1, v2] = await Promise.all([verify(a, code), verify(a, code)]);
      const results = await Promise.allSettled([action(v1), action(v2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(lost.reason).toMatchObject({ code: 'STEP_UP_CODE_USED', httpStatus: 400 });
      expect(await rows('admin.step_up', a.id)).toHaveLength(1);
      expect(await rows('test.action', a.id)).toHaveLength(1);
      expect(await rows('test.before_step_up', a.id)).toHaveLength(1);
    });

    it('a rollback of the action after consume leaves the counter unchanged: the same code is usable again', async () => {
      const a = await ready();
      const code = nextCode(a.key);
      const sealed = await sealedOf(a.id);
      await expect(action(await verify(a, code), { failAfter: true })).rejects.toThrow('the action failed');
      await expectNothingCommitted(a.id, sealed);
      await action(await verify(a, code));
      expect(await rows('admin.step_up', a.id)).toHaveLength(1);
    });

    it('a wrong code inside a route transaction does not hang on PGlite: 400 within 2 s, the failure committed, the action never opened', async () => {
      const a = await ready();
      const before = (await rows('admin.login_failed', a.id)).length;
      let opened = false;
      const route = async () => {
        const v = await verify(a, wrongCode(a.key));
        return inTransaction(s.t.db, async (tx) => {
          opened = true;
          await s.auth.consumeAdminStepUp(v, tx);
        });
      };
      const started = Date.now();
      const outcome = await Promise.race([
        route().then(
          () => 'passed',
          (e: unknown) => e,
        ),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 2_000)),
      ]);
      expect(outcome).toBeInstanceOf(DomainError);
      expect(outcome).toMatchObject({ code: 'STEP_UP_CODE_INVALID', httpStatus: 400 });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(opened).toBe(false);
      expect(await rows('admin.login_failed', a.id)).toHaveLength(before + 1);
    });
  });

  describe('the lockouts', () => {
    it(`a wrong code counts: the ${ADMIN_LOCKOUT_THRESHOLD}th locks, and a locked admin is refused before the code, even the right one`, async () => {
      const a = await ready();
      for (let i = 1; i < ADMIN_LOCKOUT_THRESHOLD; i++) await expectRefused(verify(a, wrongCode(a.key)), 'STEP_UP_CODE_INVALID', 400);
      expect(await failedLogins(a.id)).toBe(ADMIN_LOCKOUT_THRESHOLD - 1);
      await expectRefused(verify(a, wrongCode(a.key)), 'STEP_UP_CODE_INVALID', 400);
      const last = (await rows('admin.login_failed', a.id)).at(-1)!;
      expect(last.details).toEqual({ reason: 'totp', failedLogins: ADMIN_LOCKOUT_THRESHOLD, locked: true, via: 'step_up' });
      await expectRefused(verify(a, nextCode(a.key)), 'ACCOUNT_LOCKED', 429);
      // Sign-in is locked the same way (the existing lockout of adminLogin).
      await expect(s.auth.adminLogin({ email: a.addr, password: PASSWORD, totp: nextCode(a.key) }, {})).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    it(`STEP_UP_LOCKED: after ${STEP_UP_DAILY_FAILURES} step-up failures, an unlock by another ADMIN reopens sign-in but not the step-up, until 24 h after the 10th`, async () => {
      const a = await ready();
      for (let i = 0; i < STEP_UP_DAILY_FAILURES; i++) await expectRefused(verify(a, wrongCode(a.key)), 'STEP_UP_CODE_INVALID', 400);
      const tenth = s.clock.now().getTime();
      await expectRefused(verify(a, nextCode(a.key)), 'ACCOUNT_LOCKED', 429);
      await s.auth.unlockAdmin(a.id, other.actor);
      expect(await failedLogins(a.id)).toBe(0);
      // Sign-in itself is unchanged: the right code opens a session at once.
      const again = await signIn(a);
      const e = await expectRefused(verify(again, nextCode(a.key)), 'STEP_UP_LOCKED', 429);
      expect(e.publicMessage).toBe(`Too many wrong codes today. Try again after ${parisWhen(new Date(tenth + DAY))}.`);
      // The right password with it changes nothing, and the refusal costs no attempt.
      await expectRefused(verify(again, nextCode(a.key), { requirePassword: true, password: PASSWORD }), 'STEP_UP_LOCKED', 429);
      expect(await failedLogins(a.id)).toBe(0);
      // 23 h 59 min after the 10th: still refused, with the right code (a new session: the 8-hour one has ended).
      // signIn and nextCode each move 30 s, so the step-up runs 1 min after the time set.
      s.clock.set(tenth + DAY - 2 * MIN);
      const late = await signIn(a);
      await expectRefused(verify(late, nextCode(a.key)), 'STEP_UP_LOCKED', 429);
      // 24 h 01 min after it: open again.
      s.clock.set(tenth + DAY);
      const next = await signIn(a);
      await action(await verify(next, nextCode(a.key)));
      expect(await rows('admin.step_up', a.id)).toHaveLength(1);
    });

    it('sign-in failures do not count toward STEP_UP_LOCKED (only via step_up), and another admin\'s failures do not either', async () => {
      const [ea, eb] = [await enrolled(), await enrolled()];
      const a = await signIn(ea);
      const b = await signIn(eb);
      for (let i = 0; i < ADMIN_LOCKOUT_THRESHOLD - 1; i++) {
        await expect(s.auth.adminLogin({ email: a.addr, password: WRONG_PASSWORD }, {})).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      }
      for (let i = 0; i < STEP_UP_DAILY_FAILURES - 1; i++) await expectRefused(verify(b, wrongCode(b.key)), 'STEP_UP_CODE_INVALID', 400);
      await s.auth.unlockAdmin(a.id, other.actor);
      await s.auth.unlockAdmin(b.id, other.actor);
      // a: 9 sign-in failures and 1 step-up failure; b: 9 step-up failures. Neither is at 10.
      await expectRefused(verify(a, wrongCode(a.key)), 'STEP_UP_CODE_INVALID', 400);
      await action(await verify(a, nextCode(a.key)));
      await action(await verify(b, nextCode(b.key)));
    });
  });

  describe('STEP_UP_TOO_SOON: 24 h after a second-factor change or an ADMIN role change on this account', () => {
    /**
     * 23 h 59 min after `at` refused with the Paris time of `at` + 24 h, 24 h 01 min after it passes (signIn and nextCode
     * each move 30 s, so the step-up runs 1 min after the time set).
     */
    async function refusedForADay(a: { id: string; addr: string; key: Uint8Array }, at: number): Promise<void> {
      s.clock.set(at + DAY - 2 * MIN);
      expect(s.clock.now().getTime()).toBeGreaterThan(at);
      const early = await signIn(a);
      const e = await expectRefused(verify(early, nextCode(a.key)), 'STEP_UP_TOO_SOON', 403);
      expect(e.publicMessage).toBe(
        `Two-factor authentication or the role of this account changed less than 24 hours ago. Try again after ${parisWhen(new Date(at + DAY))}.`,
      );
      expect(await failedLogins(a.id)).toBe(0);
      s.clock.set(at + DAY);
      const late = await signIn(a);
      await action(await verify(late, nextCode(a.key)));
    }

    it('admin.totp.enable (the real enrolment)', async () => {
      const addr = `step.up.${++n}@example.com`;
      const created = await s.auth.createAdmin({ email: addr, password: PASSWORD, role: 'ADMIN' }, system);
      s.clock.advance(DAY + HOUR);
      const { secret } = await s.auth.createTotpEnrollment(created.id);
      const key = base32Decode(secret);
      await s.auth.enableTotp(created.id, { secret, code: nextCode(key) }, { type: 'admin', id: created.id });
      await refusedForADay({ id: created.id, addr, key }, s.clock.now().getTime());
    });

    it('admin.totp.disable (the row the Team page\'s and the shell\'s TOTP reset write), then a new enrolment', async () => {
      const a = await ready();
      await s.auth.disableTotp(a.id, other.actor);
      expect((await rows('admin.totp.disable', a.id)).map((r) => ({ actor: r.actor_id, type: 'admin' }))).toEqual([{ actor: other.id, type: 'admin' }]);
      // A crafted row alone, as the shell writes it, on an admin whose enrolment is old: the disable alone counts.
      const b = await ready();
      await s.audit.record({ actor: { type: 'system', id: 'cli' }, action: 'admin.totp.disable', targetType: 'admin', targetId: b.id, details: { sessionsRevoked: 0 } });
      await refusedForADay(b, s.clock.now().getTime());
    });

    it('admin.role_change to ADMIN (a promotion) and from ADMIN (a crafted row); a role change between two other roles does not count', async () => {
      const op = await enrolled('OPERATOR');
      await s.auth.setAdminRole(op.id, 'ADMIN', other.actor);
      await refusedForADay(op, s.clock.now().getTime());

      const b = await ready();
      await s.audit.record({ actor: other.actor, action: 'admin.role_change', targetType: 'admin', targetId: b.id, details: { from: 'ADMIN', to: 'OPERATOR' } });
      await refusedForADay(b, s.clock.now().getTime());

      const c = await ready();
      await s.audit.record({ actor: other.actor, action: 'admin.role_change', targetType: 'admin', targetId: c.id, details: { from: 'OPERATOR', to: 'AUDITOR' } });
      await action(await verify(c, nextCode(c.key)));
    });

    it('admin.create as ADMIN (the real creation with its enrolment); a creation as OPERATOR does not count', async () => {
      const addr = `step.up.${++n}@example.com`;
      const created = await s.auth.createAdmin({ email: addr, password: PASSWORD, role: 'ADMIN' }, system);
      const createdAt = s.clock.now().getTime();
      const { secret } = await s.auth.createTotpEnrollment(created.id);
      const key = base32Decode(secret);
      await s.auth.enableTotp(created.id, { secret, code: nextCode(key) }, { type: 'admin', id: created.id });
      await refusedForADay({ id: created.id, addr, key }, createdAt + 30_000);

      const c = await ready();
      await s.audit.record({ actor: system, action: 'admin.create', targetType: 'admin', targetId: c.id, details: { role: 'OPERATOR' } });
      await action(await verify(c, nextCode(c.key)));
    });

    it("another admin's rows are ignored", async () => {
      const [ea, b] = [await enrolled(), await enrolled()];
      const a = await signIn(ea);
      await s.auth.disableTotp(b.id, other.actor);
      await s.audit.record({ actor: other.actor, action: 'admin.role_change', targetType: 'admin', targetId: b.id, details: { from: 'OPERATOR', to: 'ADMIN' } });
      await s.audit.record({ actor: { type: 'admin', id: b.id }, action: 'admin.totp.enable', targetType: 'admin', targetId: other.id, details: { sessionsRevoked: 0 } });
      await action(await verify(a, nextCode(a.key)));
    });

    it('STEP_UP_LOCKED is checked before STEP_UP_TOO_SOON, and TOO_SOON before the password: no attempt is spent', async () => {
      const a = await ready();
      for (let i = 0; i < STEP_UP_DAILY_FAILURES; i++) await expectRefused(verify(a, wrongCode(a.key)), 'STEP_UP_CODE_INVALID', 400);
      await s.auth.unlockAdmin(a.id, other.actor);
      await s.audit.record({ actor: other.actor, action: 'admin.role_change', targetType: 'admin', targetId: a.id, details: { from: 'OPERATOR', to: 'ADMIN' } });
      await expectRefused(verify(a, nextCode(a.key)), 'STEP_UP_LOCKED', 429);

      const b = await ready();
      await s.audit.record({ actor: other.actor, action: 'admin.role_change', targetType: 'admin', targetId: b.id, details: { from: 'OPERATOR', to: 'ADMIN' } });
      await expectRefused(verify(b, wrongCode(b.key), { requirePassword: true, password: WRONG_PASSWORD }), 'STEP_UP_TOO_SOON', 403);
      expect(await failedLogins(b.id)).toBe(0);
      expect(await rows('admin.login_failed', b.id)).toEqual([]);
    });
  });

  describe("consume's re-checks: what changed between verify and consume refuses, and the action commits nothing", () => {
    async function verified(): Promise<{ a: Login; v: VerifiedStepUp; sealed: string | null }> {
      const a = await ready();
      const v = await verify(a, nextCode(a.key), { purpose: 'platform.reset', requirePassword: true, password: PASSWORD });
      return { a, v, sealed: await sealedOf(a.id) };
    }

    it('the account disabled by another ADMIN: 401', async () => {
      const { a, v, sealed } = await verified();
      await s.auth.setAdminDisabled(a.id, true, other.actor);
      await expectRefused(action(v), 'UNAUTHORIZED', 401);
      await expectNothingCommitted(a.id, sealed);
    });

    it('the sign-in lockout set meanwhile: 429 ACCOUNT_LOCKED', async () => {
      const { a, v, sealed } = await verified();
      await s.t.db.updateTable('admin_users').set({ locked_until: new Date(s.clock.now().getTime() + 15 * MIN) }).where('id', '=', a.id).execute();
      await expectRefused(action(v), 'ACCOUNT_LOCKED', 429);
      await expectNothingCommitted(a.id, sealed);
    });

    it('the role changed to OPERATOR: 403 INSUFFICIENT_ROLE', async () => {
      const { a, v, sealed } = await verified();
      await s.auth.setAdminRole(a.id, 'OPERATOR', other.actor);
      await expectRefused(action(v), 'INSUFFICIENT_ROLE', 403);
      await expectNothingCommitted(a.id, sealed);
    });

    it('the password changed: 400 STEP_UP_PASSWORD_CHANGED', async () => {
      const { a, v, sealed } = await verified();
      await s.auth.changePassword({ type: 'admin', id: a.id }, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { type: 'admin', id: a.id }, { keepToken: a.token });
      const e = await expectRefused(action(v), 'STEP_UP_PASSWORD_CHANGED', 400);
      expect(e.publicMessage).toBe('Your password changed. Sign in again.');
      await expectNothingCommitted(a.id, sealed);
    });

    it('the session revoked: 401', async () => {
      const { a, v, sealed } = await verified();
      await s.sessions.revoke(a.token);
      await expectRefused(action(v), 'UNAUTHORIZED', 401);
      await expectNothingCommitted(a.id, sealed);
    });

    it('the second factor reset by another ADMIN: refused (401: the reset ended the session with it)', async () => {
      const { a, v } = await verified();
      await s.auth.disableTotp(a.id, other.actor);
      await expectRefused(action(v), 'UNAUTHORIZED', 401);
      await expectNothingCommitted(a.id, null);
    });

    it('the second factor reset and enrolled again while the session lived (the sealed state replaced): the compare-and-swap changes 0 rows, 400 STEP_UP_CODE_USED', async () => {
      const { a, v } = await verified();
      const replaced = seal(TOTP_KEY, JSON.stringify({ v: 1, s: generateTotpSecret(), c: 0 }), `orbes/admin-totp/v1|${a.id}`);
      await s.t.db.updateTable('admin_users').set({ totp_secret_enc: replaced }).where('id', '=', a.id).execute();
      await expectRefused(action(v), 'STEP_UP_CODE_USED', 400);
      await expectNothingCommitted(a.id, replaced);
    });

    it('a sign-in elsewhere with a newer code meanwhile (the counter moved): the compare-and-swap changes 0 rows, 400 STEP_UP_CODE_USED', async () => {
      const { a, v } = await verified();
      const elsewhere = await s.auth.adminLogin({ email: a.addr, password: PASSWORD, totp: nextCode(a.key) }, {});
      secrets.add(elsewhere.session.token);
      const sealed = await sealedOf(a.id);
      await expectRefused(action(v), 'STEP_UP_CODE_USED', 400);
      await expectNothingCommitted(a.id, sealed);
    });
  });
});

describe('across a reset: the facts carried into entry 1 (§S.2.8, H5)', () => {
  const START = '2026-09-10T10:00:00.000Z';

  /** An ADMIN written straight into admin_users, as a reset keeps the console logins while the audit chain is emptied. */
  async function keptAdmin(st: Stack, label: string): Promise<{ id: string; addr: string; key: Uint8Array }> {
    const id = crypto.randomUUID();
    const addr = `kept.${label}.${++n}@example.com`;
    const secret = generateTotpSecret();
    await st.t.db
      .insertInto('admin_users')
      .values({
        id,
        email: addr,
        email_normalized: addr.toLowerCase(),
        password_hash: await hashSecret(PASSWORD),
        role: 'ADMIN',
        totp_secret_enc: seal(TOTP_KEY, JSON.stringify({ v: 1, s: secret, c: 0 }), `orbes/admin-totp/v1|${id}`),
      })
      .execute();
    return { id, addr, key: base32Decode(secret) };
  }

  function code(st: Stack, key: Uint8Array): string {
    st.clock.advance(30_000);
    const c = totp(key, st.clock.now().getTime());
    secrets.add(c);
    return c;
  }

  async function stepUp(st: Stack, a: { id: string; addr: string; key: Uint8Array }, totpCode?: string): Promise<VerifiedStepUp> {
    const { session } = await st.auth.adminLogin({ email: a.addr, password: PASSWORD, totp: code(st, a.key) }, {});
    secrets.add(session.token);
    return st.auth.verifyAdminStepUp({ adminId: a.id, token: session.token, totp: totpCode ?? code(st, a.key), purpose: 'platform.reset', password: PASSWORD, requirePassword: true }, {});
  }

  function consume(st: Stack, v: VerifiedStepUp) {
    return inTransaction(st.t.db, (tx) => st.auth.consumeAdminStepUp(v, tx));
  }

  const fact = (action: string, targetAdminId: string, ageMs: number, now: number, extra: Record<string, string> = {}) => ({
    action,
    targetAdminId,
    occurredAt: new Date(now - ageMs).toISOString(),
    ...extra,
  });

  it('entry 1 = platform.reset: an enrolment 2 h old gives STEP_UP_TOO_SOON, 10 failures give STEP_UP_LOCKED with the right code, a fact 24 h 01 min old is ignored', async () => {
    const st = await stack(START);
    try {
      const enrolledRecently = await keptAdmin(st, 'enrolled');
      const promoted = await keptAdmin(st, 'promoted');
      const failed = await keptAdmin(st, 'failed');
      const nine = await keptAdmin(st, 'nine');
      const old = await keptAdmin(st, 'old');
      const now = st.clock.now().getTime();
      const recent24h = [
        fact('admin.totp.enable', enrolledRecently.id, 2 * HOUR, now),
        fact('admin.role_change', promoted.id, HOUR, now, { from: 'OPERATOR', to: 'ADMIN' }),
        ...Array.from({ length: STEP_UP_DAILY_FAILURES }, (_, i) => fact('admin.login_failed', failed.id, HOUR + i * MIN, now)),
        ...Array.from({ length: STEP_UP_DAILY_FAILURES - 1 }, () => fact('admin.login_failed', nine.id, HOUR, now)),
        fact('admin.totp.enable', old.id, DAY + MIN, now),
        fact('admin.create', old.id, DAY + MIN, now),
        ...Array.from({ length: STEP_UP_DAILY_FAILURES }, () => fact('admin.login_failed', old.id, DAY + MIN, now)),
      ];
      const entry1 = await st.audit.record({ actor: { type: 'system', id: 'platform-reset' }, action: 'platform.reset', details: { resets: 1, recent24h } });
      expect(entry1.id).toBe(1);

      const tooSoon = await refusal(stepUp(st, enrolledRecently));
      expect({ code: tooSoon.code, status: tooSoon.httpStatus }).toEqual({ code: 'STEP_UP_TOO_SOON', status: 403 });
      expect(tooSoon.publicMessage).toContain(`Try again after ${parisWhen(new Date(now - 2 * HOUR + DAY))}.`);
      expect(await refusal(stepUp(st, promoted))).toMatchObject({ code: 'STEP_UP_TOO_SOON' });

      const locked = await refusal(stepUp(st, failed));
      expect({ code: locked.code, status: locked.httpStatus }).toEqual({ code: 'STEP_UP_LOCKED', status: 429 });
      // The 10th newest listed failure is the oldest of the ten: 1 h 09 min before the reset.
      expect(locked.publicMessage).toBe(`Too many wrong codes today. Try again after ${parisWhen(new Date(now - HOUR - 9 * MIN + DAY))}.`);

      // Nine listed failures and one new one make ten.
      const ninth = await refusal(stepUp(st, nine, '000000' === totp(nine.key, st.clock.now().getTime()) ? '111111' : '000000'));
      expect(ninth.code).toBe('STEP_UP_CODE_INVALID');
      await st.auth.unlockAdmin(nine.id, { type: 'admin', id: old.id });
      expect(await refusal(stepUp(st, nine))).toMatchObject({ code: 'STEP_UP_LOCKED' });

      // Facts older than 24 h count for nothing.
      await consume(st, await stepUp(st, old));

      // A day later every listed fact is over 24 h old: open again (the new failure of `nine` alone is one).
      st.clock.set(now + 23 * HOUR + 2 * MIN);
      for (const a of [enrolledRecently, promoted, failed, nine]) await consume(st, await stepUp(st, a));
      await expectNothingSecret(st.t.db);
    } finally {
      await st.t.close();
    }
  });

  it('a platform.reset row anywhere but id 1 is not entry 1: its list is ignored', async () => {
    const st = await stack(START);
    try {
      const a = await keptAdmin(st, 'elsewhere');
      const now = st.clock.now().getTime();
      const first = await st.audit.record({ actor: system, action: 'category.create', targetType: 'category', targetId: 'c1' });
      expect(first.id).toBe(1);
      const recent24h = [fact('admin.totp.enable', a.id, 2 * HOUR, now), ...Array.from({ length: STEP_UP_DAILY_FAILURES }, () => fact('admin.login_failed', a.id, HOUR, now))];
      const second = await st.audit.record({ actor: { type: 'system', id: 'platform-reset' }, action: 'platform.reset', details: { recent24h } });
      expect(second.id).toBe(2);
      await consume(st, await stepUp(st, a));
      expect((await st.t.db.selectFrom('audit_logs').select('details').where('action', '=', 'admin.step_up').execute()).map((r) => r.details)).toEqual([{ purpose: 'platform.reset' }]);
    } finally {
      await st.t.close();
    }
  });

  it('malformed facts are ignored, a fact for an id in capitals still counts', async () => {
    const st = await stack(START);
    try {
      const a = await keptAdmin(st, 'malformed');
      const b = await keptAdmin(st, 'capitals');
      const now = st.clock.now().getTime();
      const recent24h = [
        null,
        'admin.totp.enable',
        { action: 'admin.totp.enable', targetAdminId: a.id },
        { action: 'admin.totp.enable', targetAdminId: a.id, occurredAt: 'yesterday' },
        { action: 'admin.unknown', targetAdminId: a.id, occurredAt: new Date(now - HOUR).toISOString() },
        { action: 'admin.totp.enable', targetAdminId: b.id.toUpperCase(), occurredAt: new Date(now - HOUR).toISOString() },
      ];
      await st.audit.record({ actor: { type: 'system', id: 'platform-reset' }, action: 'platform.reset', details: { recent24h } });
      await consume(st, await stepUp(st, a));
      expect(await refusal(stepUp(st, b))).toMatchObject({ code: 'STEP_UP_TOO_SOON' });
    } finally {
      await st.t.close();
    }
  });
});
