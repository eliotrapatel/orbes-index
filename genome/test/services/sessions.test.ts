import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import {
  checkCsrf,
  hashSessionToken,
  SESSION_COOKIE,
  sessionCookieName,
  sessionCookieOptions,
  SessionService,
} from '../../src/server/services/sessions.js';
import { fromBase64Url } from '../../src/core/bytes.js';
import { DomainError } from '../../src/server/errors.js';
import { createManualClock } from '../../src/server/types.js';

const HOUR = 3_600_000;

describe('SessionService', () => {
  let t: TestDb;
  let sessions: SessionService;
  const clock = createManualClock('2026-04-01T12:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    sessions = new SessionService({ db: t.db, clock: clock.now, ttlHours: { account: 720, admin: 8 }, maxPerSubject: 3 });
  });
  afterAll(() => t.close());

  it('issues a 32-byte token and a CSRF token, storing only the sha256 of the token', async () => {
    const subjectId = randomUUID();
    const s = await sessions.create({ subjectType: 'account', subjectId, ipHash: 'iphash', userAgent: 'Mozilla/5.0\u0000\n' });
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fromBase64Url(s.token)).toHaveLength(32);
    expect(s.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.csrfToken).not.toBe(s.token);
    expect(s).toMatchObject({ subjectType: 'account', subjectId, mfaPassed: false });
    expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBe(720 * HOUR);

    const rows = await t.db.selectFrom('sessions').selectAll().where('subject_id', '=', subjectId).execute();
    expect(rows).toHaveLength(1);
    const expected = createHash('sha256').update(fromBase64Url(s.token)).digest();
    expect(Buffer.from(rows[0].id_hash).equals(expected)).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain(s.token);
    expect(rows[0].user_agent).toBe('Mozilla/5.0');
    expect(rows[0].ip_hash).toBe('iphash');
  });

  it('admin sessions use the admin TTL', async () => {
    const s = await sessions.create({ subjectType: 'admin', subjectId: randomUUID(), mfaPassed: true });
    expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBe(8 * HOUR);
    expect(s.mfaPassed).toBe(true);
  });

  it('validates live tokens of the right subject type only', async () => {
    const subjectId = randomUUID();
    const s = await sessions.create({ subjectType: 'account', subjectId });
    const info = await sessions.validate(s.token, 'account');
    expect(info).toMatchObject({ subjectType: 'account', subjectId, csrfToken: s.csrfToken, mfaPassed: false });
    expect(info?.id).toBe(Buffer.from(hashSessionToken(s.token)!).toString('hex'));
    expect(await sessions.validate(s.token, 'admin')).toBeNull();
    for (const bad of [undefined, null, 42, '', 'short', s.token.slice(0, 42), `${s.token}A`, s.token.replace(/.$/, '!')]) {
      expect(await sessions.validate(bad, 'account')).toBeNull();
    }
    // Well-formed but unknown.
    const other = await sessions.create({ subjectType: 'account', subjectId: randomUUID() });
    await sessions.revoke(other.token);
    expect(await sessions.validate(other.token, 'account')).toBeNull();
  });

  it('expires absolutely and deletes expired rows on sight', async () => {
    const s = await sessions.create({ subjectType: 'admin', subjectId: randomUUID() });
    clock.advance(8 * HOUR - 1);
    expect(await sessions.validate(s.token, 'admin')).not.toBeNull();
    clock.advance(1);
    expect(await sessions.validate(s.token, 'admin')).toBeNull();
    const row = await t.db.selectFrom('sessions').select('id_hash').where('id_hash', '=', hashSessionToken(s.token)!).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('refreshes last_seen_at at most once per interval', async () => {
    const s = await sessions.create({ subjectType: 'account', subjectId: randomUUID() });
    const t0 = clock.now().getTime();
    clock.advance(30_000);
    expect((await sessions.validate(s.token, 'account'))!.lastSeenAt.getTime()).toBe(t0);
    clock.advance(30_000);
    expect((await sessions.validate(s.token, 'account'))!.lastSeenAt.getTime()).toBe(t0 + 60_000);
  });

  it('rotates: creating with replaceToken revokes the previous session', async () => {
    const subjectId = randomUUID();
    const first = await sessions.create({ subjectType: 'account', subjectId });
    const second = await sessions.create({ subjectType: 'account', subjectId, replaceToken: first.token });
    expect(second.token).not.toBe(first.token);
    expect(await sessions.validate(first.token, 'account')).toBeNull();
    expect(await sessions.validate(second.token, 'account')).not.toBeNull();
  });

  it('caps sessions per subject, dropping the oldest', async () => {
    const subjectId = randomUUID();
    const tokens: string[] = [];
    for (let i = 0; i < 5; i++) {
      clock.advance(1000);
      tokens.push((await sessions.create({ subjectType: 'account', subjectId })).token);
    }
    const live = await sessions.listForSubject('account', subjectId);
    expect(live).toHaveLength(3);
    expect(await sessions.validate(tokens[0], 'account')).toBeNull();
    expect(await sessions.validate(tokens[1], 'account')).toBeNull();
    expect(await sessions.validate(tokens[4], 'account')).not.toBeNull();
  });

  it('revokes one session, or all of a subject except one', async () => {
    const subjectId = randomUUID();
    const a = await sessions.create({ subjectType: 'account', subjectId });
    const b = await sessions.create({ subjectType: 'account', subjectId });
    const c = await sessions.create({ subjectType: 'account', subjectId });
    expect(await sessions.revoke(a.token)).toBe(true);
    expect(await sessions.revoke(a.token)).toBe(false);
    expect(await sessions.revoke('garbage')).toBe(false);
    expect(await sessions.revokeAllForSubject('account', subjectId, { exceptToken: c.token })).toBe(1);
    expect(await sessions.validate(b.token, 'account')).toBeNull();
    expect(await sessions.validate(c.token, 'account')).not.toBeNull();
    expect(await sessions.revokeAllForSubject('account', 'not-a-uuid')).toBe(0);
  });

  it('step-up to MFA rotates the token: a new MFA-passed session replaces the old one', async () => {
    const subjectId = randomUUID();
    const s = await sessions.create({ subjectType: 'admin', subjectId, ipHash: 'ip', userAgent: 'UA' });
    clock.advance(60_000);
    const up = await sessions.rotate(s.token, 'admin', { mfaPassed: true });
    expect(up).toMatchObject({ subjectType: 'admin', subjectId, mfaPassed: true });
    expect(up!.token).not.toBe(s.token);
    expect(up!.csrfToken).not.toBe(s.csrfToken);
    expect(await sessions.validate(s.token, 'admin')).toBeNull();
    expect((await sessions.validate(up!.token, 'admin'))!.mfaPassed).toBe(true);
    // The absolute expiry is not extended by a step-up.
    expect(up!.expiresAt).toEqual(s.expiresAt);
    expect(await sessions.rotate('nope', 'admin', { mfaPassed: true })).toBeNull();
    expect(await sessions.rotate(up!.token, 'account', { mfaPassed: true })).toBeNull();
  });

  it('purges expired sessions', async () => {
    await sessions.create({ subjectType: 'admin', subjectId: randomUUID() });
    clock.advance(721 * HOUR);
    expect(await sessions.purgeExpired()).toBeGreaterThan(0);
    expect(await t.db.selectFrom('sessions').select('id_hash').where('expires_at', '<=', clock.now()).execute()).toEqual([]);
  });

  it('rejects invalid input', async () => {
    const e = await sessions.create({ subjectType: 'account', subjectId: 'not-a-uuid' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DomainError);
    const e2 = await sessions.create({ subjectType: 'robot' as 'admin', subjectId: randomUUID() }).catch((x: unknown) => x);
    expect(e2).toBeInstanceOf(DomainError);
    expect(() => new SessionService({ db: t.db, ttlHours: { account: 0, admin: 8 } })).toThrow(RangeError);
  });

  it('commits with, and rolls back with, the caller transaction', async () => {
    const subjectId = randomUUID();
    let token = '';
    await expect(
      t.db.transaction().execute(async (trx) => {
        token = (await sessions.create({ subjectType: 'account', subjectId }, trx)).token;
        throw new Error('login failed later');
      }),
    ).rejects.toThrow('login failed later');
    expect(await sessions.validate(token, 'account')).toBeNull();
  });
});

describe('CSRF and cookies', () => {
  it('compares CSRF tokens exactly', () => {
    const session = { csrfToken: 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123' };
    expect(checkCsrf(session, session.csrfToken)).toBe(true);
    expect(checkCsrf(session, session.csrfToken.toLowerCase())).toBe(false);
    expect(checkCsrf(session, session.csrfToken.slice(1))).toBe(false);
    expect(checkCsrf(session, undefined)).toBe(false);
    expect(checkCsrf(session, '')).toBe(false);
    expect(checkCsrf(session, ['x'])).toBe(false);
  });

  it('cookie names and attributes follow the contract', () => {
    expect(SESSION_COOKIE).toEqual({ account: 'orbes_session', admin: 'orbes_admin' });
    // Production: the __Host- prefix (Secure, Path=/, no Domain) so no subdomain or plain-HTTP response can plant or shadow them.
    expect(sessionCookieName({ env: 'production' }, 'account')).toBe('__Host-orbes_session');
    expect(sessionCookieName({ env: 'production' }, 'admin')).toBe('__Host-orbes_admin');
    expect(sessionCookieName({ env: 'development' }, 'admin')).toBe('orbes_admin');
    expect(sessionCookieName({ env: 'test' }, 'account')).toBe('orbes_session');
    expect(sessionCookieOptions({ env: 'production' })).toMatchObject({ secure: true, path: '/' });
    expect(sessionCookieOptions({ env: 'production' })).not.toHaveProperty('domain');
    const exp = new Date('2026-05-01T00:00:00Z');
    expect(sessionCookieOptions({ env: 'production' }, exp)).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', expires: exp });
    expect(sessionCookieOptions({ env: 'development' })).toEqual({ httpOnly: true, secure: false, sameSite: 'strict', path: '/' });
  });
});
