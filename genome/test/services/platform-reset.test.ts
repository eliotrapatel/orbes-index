/**
 * PlatformResetService (lot PURGE, step PURGE.10; plan §B.4, §S.2.8; D2, D7, D12, D14, F8, F17, F27, G8, G17, G18, H2,
 * H5): the holder's page (state, preview), its press (request), the reset on a dedicated connection (run), LOCK RESET,
 * on a PGlite database the app filled itself, reset by the real migration 0067 function.
 *
 *  - state: `{ holder: false }` for anyone else; the preview for the holder only (403 otherwise): what goes and stays,
 *    the collectors neither test nor team with their sign-up dates in Paris and the newest sign-up to the microsecond,
 *    and the numbers of the dialog's body from `numbersAfterReset` (a clock in 2027 reads INV-2027-000001);
 *  - request refused with nothing written (the phrase, another ADMIN, the collectors changed: one more, and one deleted
 *    plus one signed up with the count equal); a run refused by the database rolled back, the authorization cleared,
 *    `platform.reset.failed` audited and shown as the last refused reset; never on the main pool;
 *  - over HTTP, the lifecycle hook called only after a 202, never on a refusal;
 *  - the reset itself through `run` on a second connection: entry 1 from the genesis hash with the counts, the old
 *    chain's head, the holder's second factor's dates, the request's and the step-up's ids, the capture equal to the
 *    preview's lists read just before, and the 24 h facts with no secret in them; the post-check OK line by line, its
 *    numbers equal to the preview's for the same clock (also in 2027), a failing line when a key is added;
 *  - the step-up ACROSS that real reset (H5): the holder's second factor re-enrolled by another ADMIN 2 h before →
 *    STEP_UP_TOO_SOON until 24 h after it (23 h 59 min refused, 24 h 01 min passes); an OPERATOR promoted to ADMIN 1 h
 *    before, likewise; 10 wrong step-up codes before → STEP_UP_LOCKED after it with the right code, until 24 h after;
 *  - LOCK RESET: locked for good, the reset refused with its Paris time.
 *
 * The app's clock starts 60 h before the real time (the database's own now() is real: the reset reads its 24 h facts
 * against it), so the second factors enrolled then are old; it is moved forward to the real time for the reset. The
 * database's forbidden windows are answered open (CI runs at any hour).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { createDbFromPGlite, type Db } from '../../src/server/db/connection.js';
import { pgError, PG_ERROR, resetRefusal } from '../../src/server/db/pg-errors.js';
import { RESET_PLAN } from '../../src/server/db/reset-plan.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { AUDIT_GENESIS_HASH } from '../../src/server/services/audit.js';
import type { StepUpPurpose } from '../../src/server/services/auth.js';
import { parisWhen } from '../../src/server/services/maintenance-window.js';
import { numbersAfterReset, RESET_PHRASE, LOCK_PHRASE, type PlatformResetPreview } from '../../src/server/services/platform-reset.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { toHex } from '../../src/core/bytes.js';
import { Client, ORIGIN, errorOf, issue, safeJson, seedCatalog } from '../api/support.js';
import { createTestDb, type TestDb } from '../support/db.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PASSWORD = 'correct horse battery staple';
const META = { ipHash: 'p10-ip-hash-7f3a' };

interface Staff {
  id: string;
  email: string;
  key: Uint8Array;
  secret: string;
  actor: Actor & { id: string };
  token: string;
}

let t: TestDb;
let db: Db;
let clock: ManualClock;
let ctx: AppContext;
let app: FastifyInstance;
let holder: Staff;
let ally: Staff;
let third: Staff;
let promoted: Staff;
/** Every code, password, secret and token the tests typed or were given: none may reach entry 1. */
const secrets = new Set<string>([PASSWORD, META.ipHash]);

const q = async <T,>(s: string, on: Db = db) => (await sql.raw<T>(s).execute(on)).rows;
const one = async <T,>(s: string, on: Db = db) => (await q<T>(s, on))[0] as T;
const n = async (s: string) => Number((await one<{ n: string | number }>(s)).n);
const service = () => ctx.services.platformReset;
const auth = () => ctx.services.auth;
const gateRow = () => one<Record<string, any>>(`SELECT * FROM platform_reset_gate`);
const stepUps = () => n(`SELECT count(*) AS n FROM audit_logs WHERE action = 'admin.step_up'`);

/** The code of the next time step (30 s later on the app's clock): never used before. */
function code(s: Staff): string {
  clock.advance(30 * SECOND);
  const c = totp(s.key, clock.now().getTime());
  secrets.add(c);
  return c;
}

/** A code that is not the right one now. */
function wrongCode(s: Staff): string {
  const right = Number(totp(s.key, clock.now().getTime()));
  const w = String((right + 500_000) % 1_000_000).padStart(6, '0');
  secrets.add(w);
  return w;
}

async function enrol(name: string, role: 'ADMIN' | 'OPERATOR'): Promise<Staff> {
  const email = `p10.${name}.${randomUUID().slice(0, 6)}@example.com`;
  const a = await auth().createAdmin({ email, password: PASSWORD, role }, SYSTEM_ACTOR);
  const s: Staff = { id: a.id, email, key: new Uint8Array(), secret: '', actor: { type: 'admin', id: a.id }, token: '' };
  await secondFactor(s);
  return s;
}

async function secondFactor(s: Staff): Promise<void> {
  const { secret } = await auth().createTotpEnrollment(s.id);
  s.key = base32Decode(secret);
  s.secret = secret;
  secrets.add(secret);
  await auth().enableTotp(s.id, { secret, code: code(s) }, s.actor);
}

async function signIn(s: Staff): Promise<void> {
  const { session } = await auth().adminLogin({ email: s.email, password: PASSWORD, totp: code(s) }, {});
  expect(session.mfaPassed).toBe(true);
  s.token = session.token;
  secrets.add(session.token);
}

const asker = (s: Staff) => ({ actor: s.actor, token: s.token });
const verify = (s: Staff, purpose: StepUpPurpose, totpCode = code(s)) =>
  auth().verifyAdminStepUp({ adminId: s.id, token: s.token, totp: totpCode, password: PASSWORD, purpose, requirePassword: purpose.startsWith('platform.') }, META);

async function collector(name: string): Promise<string> {
  const { account } = await auth().registerAccount({ email: `p10.${name}.${randomUUID().slice(0, 6)}@example.com`, password: PASSWORD, firstName: 'Léa', lastName: 'Martin', country: 'FR' });
  return account.id;
}

function press(s: Staff, p: Pick<PlatformResetPreview, 'collectorsSeen' | 'collectorsSeenUntil'>, extra: Record<string, unknown> = {}) {
  return service().request({ phrase: RESET_PHRASE, password: PASSWORD, totp: code(s), collectorsSeen: p.collectorsSeen, collectorsSeenUntil: p.collectorsSeenUntil, ...extra }, asker(s), META);
}

/** A DomainError with this status and code. */
function domain(status: number, codeWanted: string, words?: string | RegExp) {
  return (e: unknown) => {
    if (!(e instanceof DomainError) || e.httpStatus !== status || e.code !== codeWanted) throw new Error(`expected ${status} ${codeWanted}, got ${(e as DomainError)?.httpStatus} ${(e as DomainError)?.code} ${(e as Error)?.message}`);
    if (words !== undefined && !(typeof words === 'string' ? e.publicMessage === words : words.test(e.publicMessage))) throw new Error(`the words « ${e.publicMessage} » do not match ${words}`);
    return true;
  };
}

/** Every value of a JSON tree. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (v === null || v === undefined) return out;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => leaves(x, out));
  return out;
}

/** Whether `text` holds the secret `s` (a six-digit code only between two non-digits, ids and hashes set aside). */
function holds(text: string, s: string): boolean {
  if (!/^\d{6}$/.test(s)) return text.includes(s);
  return new RegExp(`(^|\\D)${s}(\\D|$)`).test(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '~').replace(/[0-9a-f-]{16,}/gi, '~'));
}

describe('PlatformResetService', () => {
  const realStart = Date.now();
  /** What the lifecycle was asked, in order with the requests' answers (the HTTP case). */
  const order: string[] = [];
  const asked: { adminId: string; seen: number; until: string | null }[] = [];
  /** The pre-reset facts the step-up must still count after it (H5). */
  let enabledAt: Date;
  let disabledAt: Date;
  let promotedAt: Date;
  let failedAt: Date;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    clock = createManualClock(realStart - 60 * HOUR);
    ctx = await createContext(testConfig({ publicOrigin: ORIGIN }), { db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    app = await buildApp(ctx, { serveStatic: false });
    await sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`).execute(db);
    holder = await enrol('holder', 'ADMIN');
    ally = await enrol('ally', 'ADMIN');
    third = await enrol('third', 'ADMIN');
    promoted = await enrol('promoted', 'OPERATOR');
    await q(`UPDATE platform_reset_gate SET holder_admin_id = '${holder.id}'`);
    // A piece issued and two collectors: what a reset deletes.
    await issue(ctx, await seedCatalog(ctx));
    await collector('one');
    await collector('two');
    clock.advance(2 * HOUR);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await ctx?.close();
    await t?.close();
  });

  it('shows the page to the holder only: the state, then the preview with the collectors seen and the numbers of the dialog', async () => {
    expect(await service().state(ally.id)).toEqual({ holder: false });
    expect(await service().state('not-a-uuid')).toEqual({ holder: false });
    await expect(service().preview(ally.id)).rejects.toSatisfy(domain(403, 'RESET_NOT_HOLDER', 'Only the reset holder can do this.'));

    const state = await service().state(holder.id);
    expect(state).toEqual({ holder: true, email: holder.email, launched: null, lastReset: null, lastFailure: null, refusal: null });

    const p = await service().preview(holder.id);
    const newest = await one<{ m: string }>(`SELECT to_char(max(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS m FROM accounts`);
    expect(p.collectors.count).toBe(2);
    expect(p.collectorsSeen).toBe(2);
    expect(p.collectorsSeenUntil).toBe(newest.m);
    expect(p.collectors.signUps).toHaveLength(2);
    for (const s of p.collectors.signUps) expect(s.paris).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} Paris$/);
    expect(JSON.stringify(p.collectors)).not.toContain('@');
    expect(p.numbers).toEqual(numbersAfterReset(clock.now(), [{ code: 'J', index: (await one<{ id: number }>(`SELECT id FROM categories WHERE btrim(code) = 'J'`)).id, name: 'Jewelry' }]));
    const byTable = new Map(p.tables.map((x) => [x.table, x]));
    expect(byTable.get('accounts')).toMatchObject({ kind: 'WIPE', rows: 2, goes: 2, stays: 0 });
    expect(byTable.get('products')).toMatchObject({ kind: 'WIPE', rows: 1, goes: 1 });
    expect(byTable.get('models')).toMatchObject({ kind: 'KEEP', goes: 0 });
    expect(byTable.get('admin_users')).toMatchObject({ kind: 'KEEP', rows: 4, stays: 4 });
    expect(byTable.get('audit_logs')!.goes).toBeGreaterThan(0);
    expect(p.tables.map((x) => x.table).sort()).toEqual(Object.keys(RESET_PLAN).sort());
    expect(p.rowsToGo).toBe(p.tables.reduce((s, x) => s + x.goes, 0));
    expect(p.lists.keys).toEqual([expect.objectContaining({ status: 'ACTIVE' })]);
    expect(p.lists.logins.map((l) => l.email).sort()).toEqual([holder.email, ally.email, third.email, promoted.email].sort());
    expect(p.lists.pieceRanges).toEqual([expect.objectContaining({ category: 'J', pieces: 1 })]);
    expect(p).toMatchObject({ foundingList: 0, testEntrants: 0, releases: [], liveOpen: null, links: { kept: 0, wiped: 0 }, partners: { partners: 0, experiences: 0, invoices: 0 } });
  });

  it('computes every number after a reset for its date, in UTC as the invoices are numbered (H2)', () => {
    const cats = [
      { code: 'W', index: 2, name: 'Watches' },
      { code: 'J', index: 1, name: 'Jewelry' },
    ];
    expect(numbersAfterReset(new Date('2027-01-01T09:00:00Z'), cats)).toEqual({
      year: 2027,
      pieceReferences: [
        { category: 'J', name: 'Jewelry', reference: 'O27-J-00001' },
        { category: 'W', name: 'Watches', reference: 'O27-W-00001' },
      ],
      invoice: 'INV-2027-000001',
      creditNote: 'CN-2027-000001',
      partnerInvoice: 'P-2027-0001',
      partnerCreditNote: 'PC-2027-0001',
      test: 'test-0001',
    });
    // 00:30 on 1 January in Paris is still 2026 in UTC: the year the invoices take.
    expect(numbersAfterReset(new Date('2026-12-31T23:30:00Z'), cats).invoice).toBe('INV-2026-000001');
    expect(() => numbersAfterReset(new Date(Number.NaN), cats)).toThrow(RangeError);
  });

  it('refuses a press with nothing written: the phrase, another ADMIN, the collectors changed (one more; one deleted and one signed up)', async () => {
    await signIn(holder);
    await signIn(ally);
    const quiet = async (label: string, act: () => Promise<unknown>, check: (e: unknown) => boolean) => {
      const before = { steps: await stepUps(), failed: await n(`SELECT count(*) AS n FROM audit_logs WHERE action = 'admin.login_failed'`), gate: await gateRow(), holder: await one(`SELECT totp_secret_enc FROM admin_users WHERE id = '${holder.id}'`) };
      await expect(act(), label).rejects.toSatisfy(check);
      expect(await stepUps(), label).toBe(before.steps);
      expect(await n(`SELECT count(*) AS n FROM audit_logs WHERE action = 'admin.login_failed'`), label).toBe(before.failed);
      expect(await gateRow(), label).toEqual(before.gate);
      expect(await one(`SELECT totp_secret_enc FROM admin_users WHERE id = '${holder.id}'`), label).toEqual(before.holder);
      expect(await n(`SELECT count(*) AS n FROM audit_logs WHERE action = 'platform.reset.requested'`), label).toBe(0);
    };
    let p = await service().preview(holder.id);
    await quiet('the phrase', () => press(holder, p, { phrase: 'RESET' }), domain(400, 'VALIDATION_FAILED', 'Type RESET PLATFORM to confirm.'));
    await quiet('no count', () => press(holder, p, { collectorsSeen: undefined }), domain(400, 'VALIDATION_FAILED'));
    await quiet('a bad time', () => press(holder, p, { collectorsSeenUntil: 'yesterday' }), domain(400, 'VALIDATION_FAILED'));
    await quiet('another ADMIN', () => press(ally, p), domain(403, 'RESET_NOT_HOLDER'));

    await collector('late');
    await quiet('one more', () => press(holder, p), domain(409, 'RESET_COLLECTORS_CHANGED', '1 account signed up since you opened this page. Reload it and check them.'));

    p = await service().preview(holder.id);
    expect(p.collectorsSeen).toBe(3);
    const gone = await one<{ id: string }>(`SELECT id FROM accounts ORDER BY created_at LIMIT 1`);
    await q(`UPDATE accounts SET status = 'DELETED' WHERE id = '${gone.id}'`);
    clock.advance(SECOND);
    await collector('later');
    expect((await service().preview(holder.id)).collectorsSeen).toBe(3);
    await quiet('one deleted, one signed up', () => press(holder, p), domain(409, 'RESET_COLLECTORS_CHANGED', '1 account signed up since you opened this page. Reload it and check them.'));
  });

  it('a run the database refuses is rolled back, its authorization cleared and audited; never on the main pool', async () => {
    clock.set(realStart - 30 * HOUR);
    await signIn(holder);
    const p = await service().preview(holder.id);
    const out = await press(holder, p);
    expect(out).toEqual({ adminId: holder.id, collectorsSeen: p.collectorsSeen, collectorsSeenUntil: p.collectorsSeenUntil, restartsIn: 'about a minute' });
    expect(await gateRow()).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset' });
    const requested = await one<{ details: Record<string, unknown>; target_id: string; actor_id: string }>(`SELECT details, target_id, actor_id FROM audit_logs WHERE action = 'platform.reset.requested'`);
    expect(requested).toEqual({ details: { collectorsSeen: p.collectorsSeen, collectorsSeenUntil: p.collectorsSeenUntil }, target_id: holder.id, actor_id: holder.id });

    // Never on the main pool.
    await expect(service().run(holder.id, p.collectorsSeen, p.collectorsSeenUntil, db)).rejects.toThrow(/dedicated connection/);
    expect(await gateRow()).toMatchObject({ authorized_by: holder.id });

    const conn = createDbFromPGlite(t.pglite);
    const accounts = await n(`SELECT count(*) AS n FROM accounts`);
    await collector('after-the-press');
    const before = await one<{ resets: number }>(`SELECT resets FROM platform_reset_gate`);
    await expect(service().run(holder.id, p.collectorsSeen, p.collectorsSeenUntil, conn)).rejects.toSatisfy((e) => resetRefusal(e) === 'RESET_COLLECTORS_CHANGED');
    expect(await gateRow()).toMatchObject({ authorized_by: null, authorized_at: null, authorized_purpose: null, resets: before.resets, last_reset_at: null });
    expect(await n(`SELECT count(*) AS n FROM accounts`)).toBe(accounts + 1);
    const failed = await one<{ details: Record<string, unknown>; actor_id: string; target_id: string; occurred_at: Date }>(
      `SELECT details, actor_id, target_id, occurred_at FROM audit_logs WHERE action = 'platform.reset.failed' ORDER BY id DESC LIMIT 1`,
    );
    expect(failed).toMatchObject({ details: { reason: 'RESET_COLLECTORS_CHANGED' }, actor_id: holder.id, target_id: holder.id });
    expect((await ctx.audit.verifyChain()).ok).toBe(true);

    // No authorization any more: refused again, audited again.
    const q2 = await service().preview(holder.id);
    await expect(service().run(holder.id, q2.collectorsSeen, q2.collectorsSeenUntil, conn)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.RESET_REFUSED && resetRefusal(e) === 'RESET_NOT_AUTHORIZED');
    const state = await service().state(holder.id);
    if (!state.holder) throw new Error('the holder sees the page');
    const newest = await one<{ occurred_at: Date }>(`SELECT occurred_at FROM audit_logs WHERE action = 'platform.reset.failed' ORDER BY id DESC LIMIT 1`);
    expect(state.lastFailure).toEqual({
      at: newest.occurred_at.toISOString(),
      reason: 'RESET_NOT_AUTHORIZED',
      message: `The reset of ${parisWhen(newest.occurred_at)} was refused: its confirmation was no longer valid. Nothing changed.`,
    });
    expect(state.lastReset).toBeNull();
  });

  it('over HTTP, asks the lifecycle only after a 202 is sent, never on a refusal', async () => {
    clock.set(realStart - 2 * HOUR - 5 * MINUTE);
    const real = service().request.bind(service());
    service().request = async (...args) => {
      const r = await real(...args);
      order.push('request answered');
      return r;
    };
    const original = ctx.lifecycle;
    ctx.lifecycle = {
      requestPlatformReset(adminId, seen, until) {
        order.push('lifecycle');
        asked.push({ adminId, seen, until });
      },
    };
    try {
      const c = new Client(app);
      const login = await c.post('/api/admin/auth/login', { email: holder.email, password: PASSWORD, totp: code(holder) });
      expect(login.statusCode, login.body).toBe(200);
      const page = safeJson(await c.get('/api/admin/platform-reset')) as { holder: boolean; preview: PlatformResetPreview };
      expect(page.holder).toBe(true);
      const body = (extra: Record<string, unknown> = {}) => ({ phrase: RESET_PHRASE, password: PASSWORD, totp: code(holder), collectorsSeen: page.preview.collectorsSeen, collectorsSeenUntil: page.preview.collectorsSeenUntil, ...extra });
      for (const [label, b, status, codeWanted] of [
        ['the phrase', body({ phrase: 'RESET' }), 400, 'VALIDATION_FAILED'],
        ['a wrong code', body({ totp: wrongCode(holder) }), 400, 'STEP_UP_CODE_INVALID'],
        ['the count', body({ collectorsSeen: page.preview.collectorsSeen - 1 }), 409, 'RESET_COLLECTORS_CHANGED'],
      ] as const) {
        const res = await c.post('/api/admin/platform-reset', b);
        expect({ status: res.statusCode, code: errorOf(res).code }, `${label}: ${res.body}`).toEqual({ status, code: codeWanted });
        await new Promise((r) => setImmediate(r));
        expect(asked, label).toEqual([]);
      }
      // Another ADMIN of the console: 403, and the hook not called.
      const other = new Client(app);
      expect((await other.post('/api/admin/auth/login', { email: ally.email, password: PASSWORD, totp: code(ally) })).statusCode).toBe(200);
      expect(safeJson(await other.get('/api/admin/platform-reset'))).toEqual({ holder: false });
      const refused = await other.post('/api/admin/platform-reset', { ...body(), totp: code(ally) });
      expect({ status: refused.statusCode, code: errorOf(refused).code }).toEqual({ status: 403, code: 'RESET_NOT_HOLDER' });
      expect(asked).toEqual([]);

      const res = await c.post('/api/admin/platform-reset', body());
      expect(res.statusCode, res.body).toBe(202);
      expect(safeJson(res)).toEqual({ restartsIn: 'about a minute' });
      await new Promise((r) => setImmediate(r));
      expect(asked).toEqual([{ adminId: holder.id, seen: page.preview.collectorsSeen, until: page.preview.collectorsSeenUntil }]);
      expect(order.filter((x) => x === 'request answered' || x === 'lifecycle')).toEqual(['request answered', 'lifecycle']);
    } finally {
      service().request = real;
      ctx.lifecycle = original;
    }
  });

  it('resets on a dedicated connection: entry 1 from the genesis hash with the old head, the second factor dates and the capture; the post-check OK', async () => {
    // The facts the step-up must still count after the reset (H5): another ADMIN re-enrols the holder's second factor
    // 2 h before, an OPERATOR is promoted 1 h before, ten wrong step-up codes are typed 1 h before.
    clock.set(realStart - 2 * HOUR);
    await auth().disableTotp(holder.id, ally.actor);
    await secondFactor(holder);
    const facts = await q<{ action: string; occurred_at: Date }>(`SELECT action, occurred_at FROM audit_logs WHERE target_id = '${holder.id}' AND action IN ('admin.totp.enable', 'admin.totp.disable') ORDER BY id DESC LIMIT 2`);
    enabledAt = facts.find((f) => f.action === 'admin.totp.enable')!.occurred_at;
    disabledAt = facts.find((f) => f.action === 'admin.totp.disable')!.occurred_at;
    clock.set(realStart - HOUR);
    await auth().setAdminRole(promoted.id, 'ADMIN', ally.actor);
    promotedAt = (await one<{ at: Date }>(`SELECT occurred_at AS at FROM audit_logs WHERE action = 'admin.role_change' AND target_id = '${promoted.id}'`)).at;
    await signIn(third);
    failedAt = clock.now();
    for (let i = 0; i < 10; i++) await expect(verify(third, 'test_run.purge_all', wrongCode(third))).rejects.toSatisfy(domain(400, 'STEP_UP_CODE_INVALID'));
    clock.set(realStart);

    const [{ adminId, seen, until }] = asked as [(typeof asked)[number]];
    const p = await service().preview(holder.id);
    expect({ seen: p.collectorsSeen, until: p.collectorsSeenUntil }).toEqual({ seen, until });
    const head = await one<{ id: string; hash: string }>(`SELECT l.id::text AS id, encode(l.hash, 'hex') AS hash FROM audit_logs l ORDER BY l.id DESC LIMIT 1`);
    const requestId = Number((await one<{ id: string }>(`SELECT max(id)::text AS id FROM audit_logs WHERE action = 'platform.reset.requested'`)).id);
    const stepUpId = Number((await one<{ id: string }>(`SELECT max(id)::text AS id FROM audit_logs WHERE action = 'admin.step_up' AND details->>'purpose' = 'platform.reset'`)).id);

    const conn = createDbFromPGlite(t.pglite);
    const { result, entry } = await service().run(adminId, seen, until, conn);

    expect(entry.id).toBe(1);
    const e1 = await one<{ id: number; action: string; prev_hash: Uint8Array; hash: Uint8Array; actor_id: string; target_id: string; details: Record<string, any> }>(`SELECT * FROM audit_logs WHERE id = 1`);
    expect(toHex(e1.prev_hash)).toBe(toHex(AUDIT_GENESIS_HASH));
    expect(toHex(e1.hash)).toBe(entry.hash);
    expect(e1).toMatchObject({ action: 'platform.reset', actor_id: holder.id, target_id: holder.id });
    expect(await n(`SELECT count(*) AS n FROM audit_logs`)).toBe(1);
    expect((await ctx.audit.verifyChain()).ok).toBe(true);
    const d = e1.details;
    expect(d.by).toBe(holder.id);
    expect(d.oldHead).toEqual({ id: Number(head.id), hash: head.hash });
    expect(d.totp).toEqual({ enabledAt: enabledAt.toISOString().replace('Z', '000Z'), enabledBy: holder.id, disabledAt: disabledAt.toISOString().replace('Z', '000Z'), disabledBy: ally.id });
    expect({ requestId: d.requestId, stepUpId: d.stepUpId }).toEqual({ requestId, stepUpId });
    expect(d.capture).toEqual(p.lists);
    expect(d.counts).toEqual({ wiped: result.wiped, kept: result.kept, partly: result.partly, collectors: seen });
    expect(d.counts.wiped.accounts).toBeGreaterThan(0);

    // The facts of the last 24 h, nothing else: no code, no password, no secret, no address hash, no token.
    const recent = d.recent24h as { action: string; targetAdminId: string; occurredAt: string; from?: string; to?: string }[];
    const iso = (x: Date) => x.toISOString().replace('Z', '000Z');
    expect(recent).toEqual(
      expect.arrayContaining([
        { action: 'admin.totp.disable', targetAdminId: holder.id, occurredAt: iso(disabledAt) },
        { action: 'admin.totp.enable', targetAdminId: holder.id, occurredAt: iso(enabledAt) },
        { action: 'admin.role_change', targetAdminId: promoted.id, occurredAt: iso(promotedAt), from: 'OPERATOR', to: 'ADMIN' },
      ]),
    );
    expect(recent.filter((f) => f.action === 'admin.login_failed' && f.targetAdminId === third.id)).toHaveLength(10);
    for (const f of recent) expect(Object.keys(f).sort().filter((k) => !['action', 'targetAdminId', 'occurredAt', 'from', 'to'].includes(k))).toEqual([]);
    const text = JSON.stringify(e1.details);
    const values = leaves(e1.details).join('\n');
    for (const s of secrets) {
      expect(holds(text, s), `entry 1 holds a secret`).toBe(false);
      expect(holds(values, s), `entry 1 holds a secret`).toBe(false);
    }

    // The page after it: the last reset, the anchor, the old head, the capture; the post-check OK line by line.
    const state = await service().state(holder.id);
    if (!state.holder) throw new Error('the holder sees the page');
    expect(state.lastFailure).toBeNull();
    expect(state.refusal).toBeNull();
    const last = state.lastReset!;
    expect(last).toMatchObject({ by: holder.email, anchor: { id: 1, hash: entry.hash }, oldHead: { id: Number(head.id), hash: head.hash }, capture: p.lists });
    expect(last.rowsDeleted).toBeGreaterThan(0);
    expect(last.postCheck.map((l) => [l.key, l.ok])).toEqual([
      ['chain', true],
      ['key', true],
      ['documents', true],
      ['pieces', true],
      ['numbers', true],
      ['test', true],
    ]);
    // The post-check's numbers are the preview's dialog numbers for the same clock (H2).
    const after = await service().preview(holder.id);
    expect(after).toMatchObject({ collectorsSeen: 0, collectorsSeenUntil: null });
    const lines = new Map(last.postCheck.map((l) => [l.key, l.value]));
    expect(lines.get('pieces')).toBe(after.numbers.pieceReferences.map((r) => r.reference).join(', '));
    expect(lines.get('numbers')).toBe([after.numbers.invoice, after.numbers.creditNote, after.numbers.partnerInvoice, after.numbers.partnerCreditNote].join(', '));
    expect(lines.get('test')).toBe('test-0001');
    expect(lines.get('documents')).toBe('None yet.');
  });

  it('the post-check shows a failing line when a key is added, and nothing else changes', async () => {
    await db
      .transaction()
      .execute(async (tx) => {
        await sql`DROP INDEX cryptographic_keys_single_active`.execute(tx);
        await sql`INSERT INTO cryptographic_keys (key_id, kid, public_key, status, provider, provider_ref) VALUES (200, 'p10-extra', ${randomBytes(32)}, 'ACTIVE', 'memory', 'p10')`.execute(tx);
        const lines = await service().postCheck(clock.now(), tx);
        expect(lines.find((l) => l.key === 'key')).toEqual({ key: 'key', label: 'One active signing key', ok: false, value: '2 ACTIVE signing keys, expected 1.' });
        expect(lines.filter((l) => l.key !== 'key').every((l) => l.ok)).toBe(true);
        const state = await service().state(holder.id, tx);
        expect(state.holder && state.lastReset!.postCheck.find((l) => !l.ok)?.key).toBe('key');
        throw Object.assign(new Error('rollback'), { rollback: true });
      })
      .catch((e: { rollback?: boolean }) => {
        if (!e?.rollback) throw e;
      });
    expect((await service().postCheck()).every((l) => l.ok)).toBe(true);
  });

  it('carries the step-up\'s 24 h facts across the reset (H5): re-enrolment and promotion → STEP_UP_TOO_SOON, ten wrong codes → STEP_UP_LOCKED, each until 24 h after', async () => {
    // A check at `at`: signed in (its code 30 s before), then the step-up's code at `at` exactly.
    const at = async (s: Staff, when: number) => {
      clock.set(when - 60 * SECOND);
      await signIn(s);
      return verify(s, s === third ? 'test_run.purge_all' : 'platform.reset');
    };
    const after = 24 * HOUR + MINUTE;
    const before = 24 * HOUR - MINUTE;
    await expect(at(holder, enabledAt.getTime() + before)).rejects.toSatisfy(domain(403, 'STEP_UP_TOO_SOON'));
    await expect(at(holder, enabledAt.getTime() + after)).resolves.toMatchObject({ adminId: holder.id, purpose: 'platform.reset' });
    await expect(at(promoted, promotedAt.getTime() + before)).rejects.toSatisfy(domain(403, 'STEP_UP_TOO_SOON'));
    await expect(at(promoted, promotedAt.getTime() + after)).resolves.toMatchObject({ adminId: promoted.id });
    await expect(at(third, failedAt.getTime() + before)).rejects.toSatisfy(domain(429, 'STEP_UP_LOCKED'));
    await expect(at(third, failedAt.getTime() + after)).resolves.toMatchObject({ adminId: third.id });
  });

  it('in 2027 the post-check and the dialog both read INV-2027-000001 (H2)', async () => {
    clock.set(new Date('2027-01-01T09:00:00Z'));
    const p = await service().preview(holder.id);
    expect(p.numbers).toMatchObject({ year: 2027, invoice: 'INV-2027-000001', creditNote: 'CN-2027-000001', partnerInvoice: 'P-2027-0001', partnerCreditNote: 'PC-2027-0001' });
    expect(p.numbers.pieceReferences.map((r) => r.reference)).toEqual(['O27-J-00001']);
    const lines = new Map((await service().postCheck()).map((l) => [l.key, l]));
    expect(lines.get('numbers')).toMatchObject({ ok: true, value: 'INV-2027-000001, CN-2027-000001, P-2027-0001, PC-2027-0001' });
    expect(lines.get('pieces')).toMatchObject({ ok: true, value: 'O27-J-00001' });
  });

  it('LOCK RESET: the phrase and the step-up, then locked for good and every reset refused with its Paris time', async () => {
    await signIn(holder);
    await expect(service().lock({ phrase: 'LOCK', password: PASSWORD, totp: code(holder) }, asker(holder), META)).rejects.toSatisfy(domain(400, 'VALIDATION_FAILED', 'Type LOCK RESET to confirm.'));
    await signIn(ally);
    await expect(service().lock({ phrase: LOCK_PHRASE, password: PASSWORD, totp: code(ally) }, asker(ally), META)).rejects.toSatisfy(domain(403, 'RESET_NOT_HOLDER'));
    expect(await gateRow()).toMatchObject({ launched_at: null, authorized_by: null });

    const out = await service().lock({ phrase: LOCK_PHRASE, password: PASSWORD, totp: code(holder) }, asker(holder), META);
    const gate = await gateRow();
    expect(out).toEqual({ launched: { at: gate.launched_at.toISOString(), by: holder.email } });
    expect(gate).toMatchObject({ launched_by: holder.id, authorized_by: null, resets: 1 });
    expect((await q<{ action: string }>(`SELECT action FROM audit_logs WHERE id > 1 AND action LIKE 'platform.reset%' ORDER BY id`)).map((r) => r.action)).toEqual(['platform.reset.lock.requested', 'platform.reset.lock']);

    const state = await service().state(holder.id);
    expect(state.holder && state.launched).toEqual({ at: gate.launched_at.toISOString(), by: holder.email });
    expect(state.holder && state.refusal).toEqual({ code: 'RESET_LOCKED', message: `LOCK RESET was pressed on ${parisWhen(gate.launched_at)}: the reset is refused for good.` });
    const p = await service().preview(holder.id);
    const steps = await stepUps();
    await expect(press(holder, p)).rejects.toSatisfy(domain(409, 'RESET_LOCKED'));
    await expect(service().lock({ phrase: LOCK_PHRASE, password: PASSWORD, totp: code(holder) }, asker(holder), META)).rejects.toSatisfy(domain(409, 'RESET_LOCKED'));
    expect(await stepUps()).toBe(steps);
  });
});
