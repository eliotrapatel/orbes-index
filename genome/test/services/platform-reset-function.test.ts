/**
 * PLATFORM RESET rehearsed (lot PURGE, step PURGE.9; plan §B.1, §B.2 and §T; the 9 Oct RESET TO CATALOGUE's bar,
 * docs/launch/RESET-TO-CATALOGUE.md on 1fe6e3f, lines 480-489): migration 0067's `orbes_platform_reset` run on a PGlite
 * database the app filled itself, as the 9 Oct rehearsal was:
 *
 *  - FIRST the demo dataset (db/seed/demo.ts seedDemo, through the real services, as test/integration/demo-seed.test.ts
 *    loads it), THEN on top of it, through the services: a LIVE release with its silhouette, a draw whose access segment
 *    names that release, a Circle post's photograph, a piece's photograph, a piece's photograph identical to a lookbook
 *    image (the 9 Oct case: it stays, once), a founding-list address on a link to a release, a reward given by a vault
 *    opened while testing, a partner's invoice and credit note, a collector's invoice and credit note, an invitation chain, a
 *    TEST ENTRANTS test of a draw (test-0001 …), segments naming a release, a link that goes and a link that stays;
 *  - the request's transaction written as PlatformResetService will write it (PURGE.10): the holder's step-up verified,
 *    then consumed in one transaction with `platform.reset.requested` and `orbes_platform_reset_authorize`; the reset run
 *    as its `run()` will run it (`runReset` below): one transaction, the function, then entry 1 of the new chain; on any
 *    error a ROLLBACK, then `orbes_platform_reset_unauthorize()` and `platform.reset.failed` in a new transaction;
 *  - every refusal with NOTHING changed (every table's count and md5 identical, the gate identical): no holder, not the
 *    holder, a disabled holder (and its 24-hour rule only when its second factor changed), launched, the windows (the
 *    5-minute margin's end included), a test RUNNING, a LIVE room open, no / a stale / an older than the last reset / a
 *    used authorization, LOCK RESET's authorization presented to the reset, the collectors changed (one more, and one
 *    deletion plus one sign-up with the count equal), a table outside the plan, a guard trigger disabled, not the
 *    superuser, replica mode; the authorization's own refusals; LOCK RESET's;
 *  - a proof forced to fail, an error thrown mid-way and the last proof on clock_timestamp() inside a window: each rolled
 *    back whole, audited `platform.reset.failed` by the run, the gate's count of resets unchanged;
 *  - the reset itself: every proof holds; the founding list kept with its accounts cleared, its sources and links kept
 *    (its link to a release re-pointed to the releases page), every other link, partner, experience and partner invoice
 *    wiped, the segments naming a release or a link that went removed, the rewards given back to 0 with only their
 *    `updated_at` moved; releases and accounts deleted; the key kept; the gate compared column by column; entry 1's
 *    capture equal to the lists read before (SKUs with their origin read again from the audit log, logins, piece
 *    reference ranges, the segments that went, the signing keys, the old head, the holder's second factor's dates);
 *    the guards refusing as before after it, the setting and the replication role as before;
 *  - the app after it (the 9 Oct rehearsal's "the app starts as in production", H3): createContext twice on the reset database
 *    (the production boot path: no key made, keys.selfTest() true; the boot rows made again; no bootstrap admin), health
 *    200, one pass of housekeeping, of the email, house, ads and receptions senders and a tracking flush, each with no
 *    error and no audit row; a GET of every route of the registered route table without a 5xx (the detail routes on the
 *    kept catalogue's ids), the founding list's /go/ link answering its redirect to the releases page, POST
 *    /api/v1/founding taking a new address; the numbers from 1 again (piece reference 00001, INV- and CN-…-000001, P- and
 *    PC-…-0001, test-0001); a second reset; then LOCK RESET, its refusals, and every reset refused for good.
 *
 * PGlite has ONE connection: the LIVE engine's lock held elsewhere and another backend are proven here by the function's
 * own source (the logic); their real two-connection proofs are PURGE.13's, on PostgreSQL in genome-ci. The forbidden
 * windows are answered open (CI runs at any hour); their cases replace the window function, then open it again.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { testConfig, type AppConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, type AppContext } from '../../src/server/context.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { inTransaction, type Db } from '../../src/server/db/connection.js';
import { isGuardViolation, pgError, PG_ERROR, resetRefusal } from '../../src/server/db/pg-errors.js';
import { RESET_GATE_CHANGED, RESET_PLAN } from '../../src/server/db/reset-plan.js';
import { seedDemo } from '../../src/server/db/seed/demo.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { AUDIT_GENESIS_HASH, AuditService, type AuditEntry } from '../../src/server/services/audit.js';
import type { StepUpPurpose } from '../../src/server/services/auth.js';
import { deriveDropSeedKey } from '../../src/server/services/drops.js';
import { FOUNDING_ORIGIN } from '../../src/server/services/founding.js';
import { invoiceNumber } from '../../src/server/services/invoices.js';
import { deriveLiveTurnKey } from '../../src/server/services/live.js';
import { parisDay } from '../../src/server/services/schedule.js';
import { testPhrase, type TestEntrantService } from '../../src/server/services/test-entrants.js';
import { VaultService } from '../../src/server/services/vault.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type Logger, type ManualClock } from '../../src/server/types.js';
import { Client, ORIGIN } from '../api/support.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { oneSizeOf } from '../support/draws.js';
import { jpegPhoto } from '../support/images.js';
import { createLiveRelease, type LiveFixture } from '../support/live.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = 'correct horse battery staple';
/** The LIVE engine's advisory lock (db/connection.ts ADVISORY_LOCK.LIVE_ENGINE). */
const LIVE_ENGINE_LOCK = 0x4f52_0301;
const BILLING = { billingName: 'Maison P9 SAS', billingAddress: '8 place Vendôme\n75001 Paris', billingCountry: 'fr', companyNumber: 'RCS Paris 123 456 789' };
const FN = `'orbes_platform_reset(uuid, integer, timestamptz)'::regprocedure`;

// ── the world ──────────────────────────────────────────────────────────────

interface Staff {
  id: string;
  email: string;
  key: Uint8Array;
  actor: Actor & { id: string };
  token: string | null;
}

interface Seen {
  n: number;
  until: string | null;
}

/** What orbes_platform_reset returns (migration 0067 §B.2 d 10). */
interface ResetResult {
  wiped: Record<string, number>;
  kept: Record<string, number>;
  partly: Record<string, { before: number; after: number }>;
  sequencesRestarted: string[];
  at: string;
  collectors: number;
  oldHead: { id: number; hash: string } | null;
  totp: { enabledAt: string | null; enabledBy: string | null; disabledAt: string | null; disabledBy: string | null };
  requestId: number | null;
  stepUpId: number | null;
  recent24h: unknown[];
  capture: Capture;
}

interface Capture {
  skus: Record<string, unknown>[];
  logins: Record<string, unknown>[];
  suppliers: { name: string }[];
  pointsOfSale: { name: string }[];
  carriers: { name: string }[];
  stockLocations: { name: string }[];
  boxes: { name: string }[];
  addons: { name: string }[];
  sets: { name: string }[];
  vaultRewardsGiven: Record<string, unknown>[];
  adsEventsFrom: string | null;
  pieceRanges: Record<string, unknown>[];
  segmentsGone: string[];
  keys: { keyId: number; kid: string; status: string }[];
}

let t: TestDb;
let db: Db;
let clock: ManualClock;
let config: AppConfig;
/** One key custody for every boot: the key's private half lives in it, as in the keys volume. */
const keyProvider = new MemoryKeyProvider({ env: 'test' });
/** The context of the moment (the demo's, then each boot after a reset) and its app. */
let ctx: AppContext;
let app: FastifyInstance | null = null;
let holder: Staff;
let other: Staff;
let monolithe: string;
let liveId: string;
let drawRunId: string;
const logged: { level: 'warn' | 'error'; line: string }[] = [];
const log: Logger = {
  info: () => {},
  warn: (...args: unknown[]) => void logged.push({ level: 'warn', line: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') }),
  error: (...args: unknown[]) => void logged.push({ level: 'error', line: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') }),
} as Logger;

const q = async <T,>(s: string, on: Db = db) => (await sql.raw<T>(s).execute(on)).rows;
const one = async <T,>(s: string, on: Db = db) => (await q<T>(s, on))[0] as T;
const count = async (from: string) => Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`)).n);
const gateRow = () => one<Record<string, any>>(`SELECT * FROM platform_reset_gate`);
const auth = () => ctx.services.auth;
const audit = () => ctx.audit;

/** The forbidden windows' function answered by `body` (SQL over p_at; NULL: open). The test owns the database as its superuser. */
async function windowsAs(body = 'NULL::text'): Promise<void> {
  await sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT ${body} $$`).execute(db);
}

/** Every table of public: its rows and the 9 Oct fingerprint of them (text of each row, sorted, md5). */
async function fingerprint(): Promise<Record<string, string>> {
  // One statement: a function of this session's own temporary schema (never public's: the reset's plan is not asked).
  await q(`CREATE OR REPLACE FUNCTION pg_temp.p9_fingerprint() RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE r record; v_n bigint; v_h text; v_out jsonb := '{}';
    BEGIN
      FOR r IN SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1 LOOP
        EXECUTE format('SELECT count(*), md5(string_agg(x::text, chr(10) ORDER BY x::text)) FROM public.%I x', r.t) INTO v_n, v_h;
        v_out := v_out || jsonb_build_object(r.t, v_n || ' ' || coalesce(v_h, '-'));
      END LOOP;
      RETURN v_out;
    END $$`);
  return (await one<{ f: Record<string, string> }>(`SELECT pg_temp.p9_fingerprint() AS f`)).f;
}

/** The collectors the owner would see (population.ts countedCollector, as the function counts them). */
async function seen(on: Db = db): Promise<Seen> {
  const r = await one<{ n: string | number; m: string | null }>(
    `
    SELECT count(*) AS n, max(a.created_at)::text AS m FROM accounts a
     WHERE a.status <> 'DELETED' AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.email_normalized = a.email_normalized)`,
    on,
  );
  return { n: Number(r.n), until: r.m };
}

/** The code of the next time step (30 s later on the app's clock): never used before. */
function code(s: Staff): string {
  clock.advance(30 * SECOND);
  return totp(s.key, clock.now().getTime());
}

/** A console login of `role` with a second factor, enrolled now. */
async function enrol(email: string): Promise<Staff> {
  const a = await auth().createAdmin({ email, password: PASSWORD, role: 'ADMIN' }, SYSTEM_ACTOR);
  const s: Staff = { id: a.id, email, key: new Uint8Array(), actor: { type: 'admin', id: a.id }, token: null };
  await secondFactor(s);
  return s;
}

/** Its second factor enrolled (again) through the Security page's flow. */
async function secondFactor(s: Staff): Promise<void> {
  const { secret } = await auth().createTotpEnrollment(s.id);
  s.key = base32Decode(secret);
  await auth().enableTotp(s.id, { secret, code: code(s) }, s.actor);
}

/** Signed in with the password and a fresh code: a session that passed MFA. */
async function signIn(s: Staff): Promise<void> {
  const { session } = await auth().adminLogin({ email: s.email, password: PASSWORD, totp: code(s) }, {});
  expect(session.mfaPassed).toBe(true);
  s.token = session.token;
}

/** The step-up of `s` for `purpose`, verified before any transaction (the password asked for the reset and LOCK RESET). */
function verify(s: Staff, purpose: StepUpPurpose) {
  const reset = purpose === 'platform.reset' || purpose === 'platform.reset.lock';
  return auth().verifyAdminStepUp({ adminId: s.id, token: s.token ?? '', totp: code(s), password: PASSWORD, purpose, requirePassword: reset }, { ipHash: 'p9-ip-hash' });
}

/**
 * The request's transaction as PlatformResetService.request (and .lock) will write it (PURGE.10): the step-up verified
 * before, then ONE transaction: consumed, the request audited, the authorization written. `inside` runs last (LOCK RESET).
 */
async function authorize(s: Staff, purpose: 'platform.reset' | 'platform.reset.lock', inside?: (tx: Db) => Promise<void>): Promise<{ stepUpId: number; requestId: number }> {
  const v = await verify(s, purpose);
  return inTransaction(db, async (tx) => {
    await auth().consumeAdminStepUp(v, tx, { ipHash: 'p9-ip-hash' });
    const stepUpId = Number((await one<{ id: string }>(`SELECT max(id)::text AS id FROM audit_logs WHERE action = 'admin.step_up'`, tx)).id);
    const request = await audit().record({ actor: s.actor, action: `${purpose}.requested`, targetType: 'admin', targetId: s.id, details: purpose === 'platform.reset' ? { collectorsSeen: (await seen(tx)).n } : {} }, tx);
    await sql`SELECT orbes_platform_reset_authorize(${s.id}::uuid, ${purpose})`.execute(tx);
    await inside?.(tx);
    return { stepUpId, requestId: request.id };
  });
}

const unauthorize = () => q(`SELECT orbes_platform_reset_unauthorize()`);

/** The reset function in the caller's transaction. */
const callReset = async (adminId: string, s: Seen, on: Db): Promise<ResetResult> =>
  (await sql<{ r: ResetResult }>`SELECT orbes_platform_reset(${adminId}::uuid, ${s.n}::int, ${s.until}::timestamptz) AS r`.execute(on)).rows[0]!.r;

/** The reset alone in its own transaction (a refusal rolls it back). */
const attempt = (adminId: string, s: Seen) => inTransaction(db, (tx) => callReset(adminId, s, tx));

/** LOCK RESET alone in its own transaction. */
const attemptLock = (adminId: string) => inTransaction(db, (tx) => sql`SELECT orbes_platform_reset_lock(${adminId}::uuid)`.execute(tx));

/**
 * The reset as PlatformResetService.run will run it (PURGE.10, plan §B.4): one transaction, its statement timeout, the
 * function, then entry 1 of the new chain (from the genesis hash) with what it returned; on any error ROLLBACK, then in a
 * new transaction the authorization cleared and `platform.reset.failed { reason }` (the database's check list, its
 * refusal or the error's SQLSTATE: never a value), and the error rethrown.
 */
async function runReset(s: Staff, seenArg: Seen): Promise<{ result: ResetResult; entry: AuditEntry }> {
  const chain = new AuditService({ db, clock: clock.now });
  try {
    return await inTransaction(db, async (tx) => {
      await sql`SET LOCAL statement_timeout = '120s'`.execute(tx);
      const result = await callReset(s.id, seenArg, tx);
      const entry = await chain.record(
        {
          actor: s.actor,
          action: 'platform.reset',
          targetType: 'admin',
          targetId: s.id,
          details: {
            by: s.id,
            at: result.at,
            counts: { wiped: result.wiped, kept: result.kept, partly: result.partly, collectors: result.collectors },
            oldHead: result.oldHead,
            totp: result.totp,
            requestId: result.requestId,
            stepUpId: result.stepUpId,
            recent24h: result.recent24h,
            capture: result.capture,
          },
        },
        tx,
      );
      return { result, entry };
    });
  } catch (e) {
    const refusal = resetRefusal(e);
    const reason =
      refusal === 'RESET_PROOF_FAILED' ? String((e as { detail?: unknown }).detail ?? refusal) : (refusal ?? (pgError(e)?.code ? `SQLSTATE ${pgError(e)!.code}` : (e as Error).name));
    await inTransaction(db, async (tx) => {
      await sql`SELECT orbes_platform_reset_unauthorize()`.execute(tx);
      await chain.record({ actor: s.actor, action: 'platform.reset.failed', targetType: 'admin', targetId: s.id, details: { reason } }, tx);
    });
    throw e;
  }
}

/** A refusal of 0067's functions: OR011 with `reason`, its words in the detail when asked. */
function isRefusal(e: unknown, reason: string, words?: RegExp): boolean {
  if (pgError(e)?.code !== PG_ERROR.RESET_REFUSED || resetRefusal(e) !== reason) throw new Error(`expected OR011 ${reason}, got ${pgError(e)?.code} ${(e as Error)?.message}`);
  if (words && !words.test(String((e as { detail?: unknown }).detail))) throw new Error(`${reason}: the words « ${(e as { detail?: unknown }).detail} » do not match ${words}`);
  return true;
}

/** `act` refused with `reason`, NOTHING changed: every table's rows and fingerprint, the gate column by column. */
async function refusedUnchanged(label: string, act: () => Promise<unknown>, reason: string, words?: RegExp): Promise<void> {
  const before = await fingerprint();
  const gate = await gateRow();
  await expect(act(), label).rejects.toSatisfy((e) => isRefusal(e, reason, words));
  expect(await fingerprint(), label).toEqual(before);
  expect(await gateRow(), label).toEqual(gate);
}

/** In one transaction, always rolled back. */
async function rolledBack(body: (tx: Db) => Promise<unknown>): Promise<void> {
  await db
    .transaction()
    .execute(async (tx) => {
      await body(tx);
      throw Object.assign(new Error('rollback'), { rollback: true });
    })
    .catch((e: { rollback?: boolean }) => {
      if (!e?.rollback) throw e;
    });
}

/** The 9 Oct "how made" of a SKU, read again here from the audit log (reset-to-catalogue.sql:184-271). */
async function skusWithOrigin(): Promise<Record<string, unknown>[]> {
  const skus = await q<{ id: string; code: string; model_id: string | null; model: string | null; variant: string | null; addon: string | null; size_label: string | null; size_type: string | null; set_aside: boolean; created_at: string }>(`
    SELECT k.id, k.code, k.model_id, m.name AS model, m.variant_label AS variant, ai.name AS addon, k.size_label, m.size_type,
           k.set_aside_at IS NOT NULL AS set_aside, to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM skus k LEFT JOIN models m ON m.id = k.model_id LEFT JOIN addon_items ai ON ai.id = k.addon_id`);
  const rows = await q<{ action: string; target_id: string; details: Record<string, any> }>(`
    SELECT action, target_id, details FROM audit_logs
     WHERE target_type = 'model' AND action IN ('model.sizes.declare', 'model.create', 'model.variant.create')`);
  const counts = async (table: string) =>
    new Map((await q<{ id: string; n: string }>(`SELECT sku_id::text AS id, count(*)::text AS n FROM ${table} WHERE sku_id IS NOT NULL GROUP BY sku_id`)).map((r) => [r.id, Number(r.n)]));
  const [pieces, orders, releaseSizes, stockMoves] = await Promise.all([counts('products'), counts('orders'), counts('drop_sizes'), counts('stock_movements')]);
  return skus
    .map((k) => {
      const of = rows.filter((r) => r.target_id === k.model_id);
      const size = k.size_label ?? 'ONE SIZE';
      const how =
        k.addon !== null
          ? 'with the add-on'
          : of.some((r) => r.action === 'model.sizes.declare' && [...(r.details.added ?? []), ...(r.details.reinstated ?? [])].includes(k.code))
            ? 'declared'
            : of.some((r) => (r.action === 'model.create' && k.size_label === null && 'sizeType' in r.details) || (r.action === 'model.variant.create' && (r.details.sizes ?? []).includes(size)))
              ? 'with the model'
              : k.size_type !== null
                ? 'before the type'
                : 'by a flow';
      return {
        sort: [(k.model ?? k.addon ?? '').toLowerCase(), (k.variant ?? '').toLowerCase(), k.created_at, k.code],
        row: {
          code: k.code,
          model: k.model_id !== null && k.model !== null ? k.model + (k.variant !== null ? ` / ${k.variant}` : '') : null,
          addon: k.addon,
          size,
          sizeType: k.size_type,
          status: k.set_aside ? 'set aside' : 'offered',
          createdAt: k.created_at,
          pieces: pieces.get(k.id) ?? 0,
          orders: orders.get(k.id) ?? 0,
          releaseSizes: releaseSizes.get(k.id) ?? 0,
          stockMoves: stockMoves.get(k.id) ?? 0,
          how,
          check: how === 'by a flow' && !k.set_aside,
        },
      };
    })
    .sort((a, b) => {
      for (let i = 0; i < 4; i++) if (a.sort[i] !== b.sort[i]) return a.sort[i]! < b.sort[i]! ? -1 : 1;
      return 0;
    })
    .map((x) => x.row);
}

/** The lists the reset must capture, read here before it (the 9 Oct LISTS, plan §B.2 d 6b). */
async function listsBefore() {
  const iso = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  return {
    skus: await skusWithOrigin(),
    logins: await q(`SELECT email, role, totp_secret_enc IS NOT NULL AS totp, CASE WHEN disabled_at IS NULL THEN 'active' ELSE 'disabled' END AS status, ${iso('created_at')} AS "createdAt"
                       FROM admin_users ORDER BY created_at, email`),
    names: {
      suppliers: (await q<{ name: string }>(`SELECT name FROM suppliers ORDER BY lower(name), id`)).map((r) => r.name),
      pointsOfSale: (await q<{ name: string }>(`SELECT name FROM retailers ORDER BY lower(name), id`)).map((r) => r.name),
      carriers: (await q<{ name: string }>(`SELECT name FROM carriers ORDER BY lower(name), id`)).map((r) => r.name),
      stockLocations: (await q<{ name: string }>(`SELECT name FROM stock_locations ORDER BY lower(name), id`)).map((r) => r.name),
      boxes: (await q<{ name: string }>(`SELECT name FROM boxes ORDER BY lower(name), id`)).map((r) => r.name),
      addons: (await q<{ name: string }>(`SELECT name FROM addon_items ORDER BY lower(name), id`)).map((r) => r.name),
      sets: (await q<{ name: string }>(`SELECT name FROM sets ORDER BY lower(name), id`)).map((r) => r.name),
    },
    vaultRewardsGiven: await q(`SELECT id, kind, given, quantity, active FROM vault_rewards WHERE given > 0 ORDER BY position, id`),
    pieceRanges: (
      await q<{ year: number; category: string; pieces: string; first: string; last: string }>(`
        SELECT p.year, btrim(c.code) AS category, count(*)::text AS pieces, min(p.product_id) AS first, max(p.product_id) AS last
          FROM products p JOIN categories c ON c.id = p.category_id GROUP BY p.year, btrim(c.code) ORDER BY 1, 2`)
    ).map((r) => ({ ...r, pieces: Number(r.pieces) })),
    keys: (await q<{ keyId: number; kid: string; status: string }>(`SELECT key_id AS "keyId", kid, status FROM cryptographic_keys ORDER BY key_id`)).map((k) => ({ ...k, keyId: Number(k.keyId) })),
    head: await one<{ id: string; hash: string }>(`SELECT l.id::text AS id, encode(l.hash, 'hex') AS hash FROM audit_logs l ORDER BY l.id DESC LIMIT 1`),
    totp: await one<{ enabledAt: string | null; enabledBy: string | null }>(`
      SELECT ${iso('occurred_at')} AS "enabledAt", actor_id AS "enabledBy" FROM audit_logs
       WHERE target_type = 'admin' AND target_id = '${holder.id}' AND action = 'admin.totp.enable' ORDER BY id DESC LIMIT 1`),
    totpOff: await one<{ disabledAt: string | null; disabledBy: string | null } | undefined>(`
      SELECT ${iso('occurred_at')} AS "disabledAt", actor_id AS "disabledBy" FROM audit_logs
       WHERE target_type = 'admin' AND target_id = '${holder.id}' AND action = 'admin.totp.disable' ORDER BY id DESC LIMIT 1`),
  };
}

/** The photographs a kept model (its cover) or a lookbook uses. */
const usedMedia = async () =>
  (await q<{ sha256: string }>(`SELECT sha256 FROM media_objects m WHERE EXISTS (SELECT 1 FROM models x WHERE x.image_sha256 = m.sha256) OR EXISTS (SELECT 1 FROM model_images x WHERE x.sha256 = m.sha256) ORDER BY 1`)).map((r) => r.sha256);

/** The app's TEST ENTRANTS, driven by hand (no timers; their sleeps move the clock). */
function testsOf(a: FastifyInstance): TestEntrantService {
  const tests = a.testEntrants;
  tests.useTimers(false);
  tests.sleep = async (ms) => {
    clock.advance(ms);
  };
  return tests;
}

async function drive(tests: TestEntrantService, ms: number, step = 500): Promise<void> {
  for (let s = 0; ; s += step) {
    for (let pass = 0; pass < 2; pass++) {
      await tests.tick();
      await tests.settle();
    }
    if (s >= ms) break;
    clock.advance(step);
  }
}

/** A draw of MONOLITHE, published, open now (its opening an hour ago), through the console's service. */
async function openDraw(title: string, access: { segmentId?: string; opensIn?: number } = {}): Promise<string> {
  const now = clock.now().getTime();
  const label = await oneSizeOf(db, monolithe);
  const d = await ctx.services.drops.create(
    {
      modelId: monolithe,
      title,
      sizes: [{ label, pieces: 4 }],
      opensAt: new Date(now + (access.opensIn ?? -HOUR)),
      closesAt: new Date(now + (access.opensIn ?? -HOUR) + 3 * HOUR),
      earlyAccessHours: 0,
      earlyAccessPlatineHours: 0,
      ...(access.segmentId ? { accessSegmentId: access.segmentId } : {}),
    },
    holder.actor,
  );
  await ctx.services.drops.publish(d.id, holder.actor);
  return d.id;
}

/** A TEST ENTRANTS test of `drop` with `n` bots of no tier: RUNNING, then DONE once its bots have entered (`driven`). */
async function startTest(tests: TestEntrantService, drop: string, n: number, driven = true): Promise<string> {
  const started = await tests.start(
    drop,
    { phrase: testPhrase(drop), tiers: { none: n, titane: 0, platine: 0, palladium: 0 }, arrival: { mode: 'all', interestPct: 0 }, behaviour: { confirmPct: 100 } },
    holder.actor,
  );
  if (driven) await drive(tests, 0);
  return started.id;
}

/** A private salon's order of `accountId`, priced and PAID (its invoice), as the console closes one. */
async function paidSalonOrder(accountId: string): Promise<string> {
  const request = await db.insertInto('shop_requests').values({ account_id: accountId, model_id: monolithe, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
  clock.advance(MINUTE);
  await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, holder.actor);
  const id = (await db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
  await ctx.services.orders.setTerms(id, { sizeLabel: await oneSizeOf(db, monolithe), priceMinor: 450_000, currency: 'EUR' }, holder.actor);
  await ctx.services.orders.setBuyer(id, { name: 'Ada Zurbaran-Quill', address: '12 rue Imaginaire\n75003 Paris' }, holder.actor);
  clock.advance(MINUTE);
  await ctx.services.orders.transition(id, { to: 'PAID' }, holder.actor);
  return id;
}

/** An order's invoice and credit note numbers, the invoice first. */
const invoiceNumbers = async (orderId: string) =>
  (await db.selectFrom('invoices').select(['kind', 'year', 'sequence']).where('order_id', '=', orderId).orderBy('kind', 'desc').execute()).map((r) => invoiceNumber(r.kind, r.year, r.sequence));

/** A partner's experience invoiced (its P- number), and cancelled when asked (its PC- credit note). */
async function partnerDocuments(brand: string, cancel: boolean) {
  const partner = await ctx.services.partners.create({ brand, ...BILLING }, holder.actor);
  const exp = await ctx.services.partners.createExperience(partner.id, { title: 'Dinner', eventOn: parisDay(new Date(clock.now().getTime() + 10 * DAY)), amountMinor: 1_200_000, currency: 'EUR' }, holder.actor);
  const invoiced = await ctx.services.partners.issueInvoice(exp.id, holder.actor);
  const cancelled = cancel ? await ctx.services.partners.cancel(exp.id, holder.actor, { admin: true }) : null;
  return { invoice: invoiced.invoice!.number, creditNote: cancelled?.creditNote?.number ?? null };
}

/** A new context on the database, as the process boots it in production (no key made: the kept one self-tested). */
async function boot(overrides: Partial<AppConfig> = {}): Promise<AppContext> {
  return createContext(testConfig({ publicOrigin: ORIGIN, ...overrides }), { db, clock: clock.now, keyProvider, ensureActiveKey: false, log });
}

async function closeApp(): Promise<void> {
  await app?.close();
  app = null;
  await ctx?.close();
}

/** What the extras made, read back after the reset. */
const made: {
  silhouette?: string;
  circlePhoto?: string;
  piecePhoto?: string;
  lookbook?: string;
  cover?: string;
  keptLink?: string;
  goneLink?: string;
  keptSource?: number;
  founding?: string[];
  segments?: Record<string, string>;
  accessDraw?: string;
  invitees?: string[];
  testAccount?: string;
  reward?: string;
  partner?: { invoice: string; creditNote: string | null }[];
  collectorInvoice?: string[];
} = {};

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  const now = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
  clock = createManualClock(now);
  config = testConfig({ publicOrigin: ORIGIN });
  ctx = await createContext(config, { db, clock: clock.now, keyProvider, ensureActiveKey: true, log });
  // CI runs at any hour: the forbidden windows answered open.
  await windowsAs();

  // ── FIRST the demo dataset, through the real services ──
  await seedDemo(ctx, { clock, now, accountPassword: 'demo-account-password-2026' });
  monolithe = (await db.selectFrom('models').select('id').where('name', '=', 'MONOLITHE').where('variant_of', 'is', null).executeTakeFirstOrThrow()).id;

  // ── the console's logins: the holder and another ADMIN, each with a second factor, enrolled more than 24 h ago ──
  holder = await enrol('reset.holder@example.com');
  other = await enrol('other.admin@example.com');
  clock.advance(DAY + MINUTE);
  await signIn(holder);
  await signIn(other);

  // ── THEN the extras, through the services ──
  const f: LiveFixture = {
    db,
    clock,
    audit: ctx.audit,
    drops: ctx.services.drops,
    live: ctx.services.live,
    liveConsole: ctx.services.liveConsole,
    seedKey: deriveDropSeedKey(config),
    turnKey: deriveLiveTurnKey(config),
    admin: holder.actor,
    modelId: monolithe,
  };
  const jpeg = (w: number, h: number) => ({ mime: 'image/jpeg' as const, bytes: jpegPhoto(w, h) });
  // A LIVE release (three days ahead), its silhouette given before it is announced, then published as the fixture does.
  liveId = (await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 3 * DAY), sizes: [{ label: await oneSizeOf(db, monolithe), stock: 2 }], published: false })).id;
  made.silhouette = (await ctx.services.media.setLiveSilhouette(liveId, jpeg(40, 64), holder.actor)).sha256;
  await db.updateTable('drops').set({ published_at: clock.now() }).where('id', '=', liveId).execute();
  // A segment naming it, and a draw opened to that segment only.
  const segment = async (name: string, rules: object[]) => (await ctx.services.segments.create({ name, criteria: { match: 'ALL', rules } }, holder.actor)).id;
  made.segments = { took: await segment('P9 TOOK PART IN THE LIVE', [{ kind: 'TOOK_PART', dropId: liveId }]) };
  made.accessDraw = await openDraw('MONOLITHE · P9 FOR THOSE OF THE LIVE', { segmentId: made.segments.took, opensIn: 4 * DAY });
  // A Circle post's photograph.
  const post = await ctx.services.circle.create({ kind: 'NOTE', title: 'P9 A NOTE WITH A PHOTOGRAPH' }, holder.actor);
  made.circlePhoto = (await ctx.services.media.addCirclePostPhoto(post.id, jpeg(50, 40), holder.actor)).sha256;
  // A piece's photograph; a lookbook image; another piece's photograph identical to it (the 9 Oct case); a cover.
  const photoOf = async (productId: string) => (await db.selectFrom('products').select('photo_sha256').where('product_id', '=', productId).executeTakeFirstOrThrow()).photo_sha256;
  await ctx.services.media.setProductPhoto('O26-J-00184', jpeg(42, 40), holder.actor);
  made.piecePhoto = (await photoOf('O26-J-00184'))!;
  made.lookbook = (await ctx.services.media.addModelGalleryImage(monolithe, jpeg(60, 60), holder.actor)).sha256;
  await ctx.services.media.setProductPhoto('O26-J-00192', jpeg(60, 60), holder.actor);
  expect(await photoOf('O26-J-00192')).toBe(made.lookbook);
  const orbite = (await db.selectFrom('models').select('id').where('name', '=', 'ORBITE').where('variant_of', 'is', null).executeTakeFirstOrThrow()).id;
  made.cover = (await ctx.services.media.setModelImage(orbite, jpeg(64, 48), holder.actor)).sha256;
  // Links to the LIVE release: one the founding list comes through (kept), one nobody does (wiped); a link to the
  // releases page; segments naming each.
  const channelId = (await db.selectFrom('link_channels').select('id').orderBy('position').executeTakeFirstOrThrow()).id;
  const link = async (code: string, destination: string, dropId?: string) =>
    (await ctx.services.links.create({ name: code.toUpperCase(), channelId, destination, code, ...(dropId ? { dropId } : {}) }, holder.actor)).id;
  made.keptLink = await link('p9-founding', 'RELEASE', liveId);
  made.goneLink = await link('p9-gone', 'RELEASE', liveId);
  await link('p9-releases', 'RELEASES');
  made.segments.goneLink = await segment('P9 CAME BY THE GONE LINK', [{ kind: 'FIRST_SOURCE', linkIds: [made.goneLink] }]);
  made.segments.keptLink = await segment('P9 CAME BY THE FOUNDING LINK', [{ kind: 'FIRST_SOURCE', linkIds: [made.keptLink] }]);
  made.segments.tier = await segment('P9 TITANE', [{ kind: 'TIER', tiers: [1] }]);
  // The founding list: an address through the release's link, matched at once to the account that has it; another one
  // straight from theorbes.com.
  const camille = (await db.selectFrom('accounts').select(['id', 'email']).where('email', '=', 'camille.martin@example.com').executeTakeFirstOrThrow()).id;
  const viaLink = await ctx.services.founding.register({ email: 'camille.martin@example.com', firstName: 'Camille', country: 'FR', consent: true, o: 'p9-founding' }, { type: 'system', id: 'public' });
  expect(viaLink).toMatchObject({ outcome: 'ADDED', sourceKind: 'LINK', matched: camille });
  const direct = await ctx.services.founding.register({ email: 'p9.founding@example.com', firstName: 'Inès', country: 'FR', consent: true }, { type: 'system', id: 'public' });
  expect(direct).toMatchObject({ outcome: 'ADDED' });
  made.founding = ['camille.martin@example.com', 'p9.founding@example.com'];
  made.keptSource = (await db.selectFrom('acquisition_sources').select('id').where('link_id', '=', made.keptLink).executeTakeFirstOrThrow()).id;
  // An invitation chain: Camille invites one, who invites another.
  const signUp = async (email: string, invite: string) =>
    (await auth().registerAccount({ email, password: PASSWORD, firstName: 'Léa', lastName: 'Martin', country: 'FR', invite })).account.id;
  const first = await signUp('p9.invitee.one@example.com', (await ctx.services.vault.invitation(camille)).code);
  const second = await signUp('p9.invitee.two@example.com', (await ctx.services.vault.invitation(first)).code);
  made.invitees = [first, second];
  expect(await q(`SELECT invited_by FROM accounts WHERE id IN ('${first}', '${second}') ORDER BY created_at`)).toEqual([{ invited_by: camille }, { invited_by: first }]);
  // A collector's invoice and its credit note.
  const order = await paidSalonOrder(camille);
  clock.advance(MINUTE);
  await ctx.services.orders.transition(order, { to: 'CANCELLED', note: 'The client withdrew.' }, holder.actor);
  made.collectorInvoice = await invoiceNumbers(order);
  // A partner's invoice, and another one cancelled with its credit note.
  made.partner = [await partnerDocuments('P9 MAISON', false), await partnerDocuments('P9 MAISON BIS', true)];
  // A TEST ENTRANTS test of a draw, its bots entered (its accounts test-0001 …).
  app = await buildApp(ctx, { serveStatic: false, liveHub: { pulseMs: 0, cacheMs: 0 } });
  const tests = testsOf(app);
  const testDraw = await openDraw('MONOLITHE · P9 TEST DRAW');
  drawRunId = await startTest(tests, testDraw, 3);
  made.testAccount = (await db.selectFrom('accounts').select('id').where('email', '=', 'test-0001@orbes.test').executeTakeFirstOrThrow()).id;
  // A reward given by a vault opened while testing (the first row above the floor: given 1). A test entrant never gets a
  // vault (THE VAULT's D9): the house gives one to an account signed up for the tests, which opens it.
  const opener = new VaultService({ db, audit: ctx.audit, profiles: ctx.services.profiles, clock: clock.now, random: () => 0, giftKey: new Uint8Array(randomBytes(32)) });
  expect((await opener.give({ source: 'HOUSE', accountId: made.testAccount, giftId: randomUUID(), givenBy: holder.id })).vaults).toEqual([]);
  const vault = (await opener.give({ source: 'HOUSE', accountId: second, giftId: randomUUID(), givenBy: holder.id })).vaults[0]!;
  await opener.open(second, vault.id);
  made.reward = (await db.selectFrom('vaults').select('reward_id').where('id', '=', vault.id).executeTakeFirstOrThrow()).reward_id!;
}, 600_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
  await ctx?.close().catch(() => undefined);
  await t?.close();
});

describe('PLATFORM RESET rehearsed on the demo dataset and the extras (PURGE.9)', () => {
  it('the platform before: the demo and every extra there, through the services', async () => {
    expect(await count('accounts')).toBeGreaterThan(10);
    expect(await count('products')).toBeGreaterThanOrEqual(38);
    expect(await count(`drops WHERE silhouette_sha256 = '${made.silhouette}'`)).toBe(1);
    expect(await count(`drops WHERE access_segment_id = '${made.segments!.took}'`)).toBe(1);
    expect(await count(`circle_post_images WHERE sha256 = '${made.circlePhoto}'`)).toBe(1);
    expect(await count(`products WHERE photo_sha256 = '${made.lookbook}'`)).toBe(1);
    expect(await count(`model_images WHERE sha256 = '${made.lookbook}'`)).toBe(1);
    expect(await count(`preregistrations WHERE account_id IS NOT NULL`)).toBe(1);
    expect(await count(`links l JOIN acquisition_sources s ON s.link_id = l.id JOIN preregistrations p ON p.source_id = s.id WHERE l.destination = 'RELEASE'`)).toBe(1);
    expect(await one(`SELECT kind, given FROM vault_rewards WHERE id = '${made.reward}'`)).toEqual({ kind: expect.any(String), given: 1 });
    expect(made.partner).toEqual([
      { invoice: expect.stringMatching(/^P-\d{4}-0001$/), creditNote: null },
      { invoice: expect.stringMatching(/^P-\d{4}-0002$/), creditNote: expect.stringMatching(/^PC-\d{4}-0001$/) },
    ]);
    expect(made.collectorInvoice).toEqual([expect.stringMatching(/^INV-\d{4}-\d{6}$/), expect.stringMatching(/^CN-\d{4}-\d{6}$/)]);
    // Its bots have all entered: DONE, waiting for its draw.
    expect(await one(`SELECT status FROM test_runs WHERE id = '${drawRunId}'`)).toEqual({ status: 'DONE' });
    expect(await count(`test_entrants`)).toBe(3);
    // The migration ran before any console login: no holder yet.
    expect((await gateRow()).holder_admin_id).toBeNull();
  });

  it('no holder (none recorded at the migration): the precheck says NO_HOLDER; the reset, the authorization and LOCK RESET refused with its words, nothing changed', async () => {
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'NO_HOLDER' });
    const words = /^there is no active reset holder \(an ADMIN with two-factor authentication\)$/;
    await refusedUnchanged('reset', async () => attempt(holder.id, await seen()), 'RESET_NO_HOLDER', words);
    await refusedUnchanged('lock', () => attemptLock(holder.id), 'RESET_NO_HOLDER', words);
    const v = await verify(holder, 'platform.reset');
    await refusedUnchanged(
      'authorize',
      () =>
        inTransaction(db, async (tx) => {
          await auth().consumeAdminStepUp(v, tx);
          await audit().record({ actor: holder.actor, action: 'platform.reset.requested', targetType: 'admin', targetId: holder.id }, tx);
          await sql`SELECT orbes_platform_reset_authorize(${holder.id}::uuid, 'platform.reset')`.execute(tx);
        }),
      'RESET_NO_HOLDER',
      words,
    );
    // Fixed forward as a later migration would (the migrations' superuser): the holder recorded.
    await q(`UPDATE platform_reset_gate SET holder_admin_id = '${holder.id}'`);
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: null });
  }, 300_000);

  it('orbes_platform_reset_authorize\'s own refusals, each with nothing changed and the gate identical', async () => {
    const touch = (tx: Db, id: string) => sql`UPDATE admin_users SET failed_logins = 0 WHERE id = ${id}`.execute(tx);
    const requested = (tx: Db, s: Staff, action = 'platform.reset.requested') => audit().record({ actor: s.actor, action, targetType: 'admin', targetId: s.id }, tx);
    const authorizeIn = (tx: Db, s: Staff, purpose = 'platform.reset') => sql`SELECT orbes_platform_reset_authorize(${s.id}::uuid, ${purpose})`.execute(tx);
    const consume = (tx: Db, v: Awaited<ReturnType<typeof verify>>) => auth().consumeAdminStepUp(v, tx);
    const cases: [string, () => Promise<unknown>, string][] = [
      ['no admin.step_up row in this transaction', () => inTransaction(db, async (tx) => { await touch(tx, holder.id); await requested(tx, holder); await authorizeIn(tx, holder); }), 'RESET_NOT_AUTHORIZED'],
      ['a step-up for the other purpose', async () => { const v = await verify(holder, 'platform.reset.lock'); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, holder); await authorizeIn(tx, holder); }); }, 'RESET_NOT_AUTHORIZED'],
      ['another admin\'s step-up', async () => { const v = await verify(other, 'platform.reset'); return inTransaction(db, async (tx) => { await consume(tx, v); await touch(tx, holder.id); await requested(tx, holder); await authorizeIn(tx, holder); }); }, 'RESET_NOT_AUTHORIZED'],
      [`a purge's step-up (test_run.purge:<id>)`, async () => { const v = await verify(holder, `test_run.purge:${drawRunId}`); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, holder); await authorizeIn(tx, holder); }); }, 'RESET_NOT_AUTHORIZED'],
      ['PURGE ALL\'s step-up', async () => { const v = await verify(holder, 'test_run.purge_all'); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, holder); await authorizeIn(tx, holder); }); }, 'RESET_NOT_AUTHORIZED'],
      ['no platform.reset.requested row', async () => { const v = await verify(holder, 'platform.reset'); return inTransaction(db, async (tx) => { await consume(tx, v); await authorizeIn(tx, holder); }); }, 'RESET_NOT_AUTHORIZED'],
      ['LOCK RESET\'s request for the reset', async () => { const v = await verify(holder, 'platform.reset'); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, holder, 'platform.reset.lock.requested'); await authorizeIn(tx, holder); }); }, 'RESET_NOT_AUTHORIZED'],
      ['no update of its admin_users row in this transaction (a step-up row written by hand)', () => inTransaction(db, async (tx) => { await audit().record({ actor: holder.actor, action: 'admin.step_up', targetType: 'admin', targetId: holder.id, details: { purpose: 'platform.reset' } }, tx); await requested(tx, holder); await authorizeIn(tx, holder); }), 'RESET_NOT_AUTHORIZED'],
      ['not the holder', async () => { const v = await verify(other, 'platform.reset'); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, other); await authorizeIn(tx, other); }); }, 'RESET_NOT_HOLDER'],
      ['a disabled holder', async () => { const v = await verify(holder, 'platform.reset'); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, holder); await sql`UPDATE admin_users SET disabled_at = now() WHERE id = ${holder.id}`.execute(tx); await authorizeIn(tx, holder); }); }, 'RESET_NO_HOLDER'],
      ['launched', async () => { const v = await verify(holder, 'platform.reset'); return inTransaction(db, async (tx) => { await sql`UPDATE platform_reset_gate SET launched_at = now(), launched_by = ${holder.id}`.execute(tx); await consume(tx, v); await requested(tx, holder); await authorizeIn(tx, holder); }); }, 'RESET_LOCKED'],
      ['no such purpose', async () => { const v = await verify(holder, 'test_run.purge_all'); return inTransaction(db, async (tx) => { await consume(tx, v); await requested(tx, holder, 'test_run.purge_all.requested'); await authorizeIn(tx, holder, 'test_run.purge_all'); }); }, 'RESET_NOT_AUTHORIZED'],
    ];
    for (const [label, act, reason] of cases) await refusedUnchanged(label, act, reason);
    // None of them consumed a code nor wrote a step-up: the holder's next step-up passes.
    expect(await count(`audit_logs WHERE action = 'admin.step_up'`)).toBe(0);
    await authorize(holder, 'platform.reset');
    expect(await gateRow()).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset' });
    await unauthorize();
  }, 300_000);

  it('the start guards and the holder: a guard trigger disabled, not the superuser, replica mode, not the holder, launched, a disabled holder (its 24-hour rule only when its second factor changed); nothing changed', async () => {
    await authorize(holder, 'platform.reset');
    const s = await seen();
    // A guard trigger disabled by the superuser: refused, named.
    await q(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`);
    try {
      await refusedUnchanged('a trigger disabled', () => attempt(holder.id, s), 'RESET_TRIGGER_DISABLED', /audit_logs\.audit_logs_append_only \(D\)/);
      await refusedUnchanged('a trigger disabled (authorize)', () => authorize(holder, 'platform.reset'), 'RESET_TRIGGER_DISABLED');
    } finally {
      await q(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`);
    }
    // A guard set to fire in replica mode only (it would let a write through unguarded): refused the same.
    await q(`ALTER TABLE accounts ENABLE REPLICA TRIGGER accounts_invited_once`);
    try {
      await refusedUnchanged('a trigger set to replica only', () => attempt(holder.id, s), 'RESET_TRIGGER_DISABLED', /accounts\.accounts_invited_once \(R\)/);
    } finally {
      await q(`ALTER TABLE accounts ENABLE TRIGGER accounts_invited_once`);
    }
    // Not the migrations' superuser (the function owned by another role), and replica mode: refused first.
    await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'p9_not_super') THEN CREATE ROLE p9_not_super NOSUPERUSER NOLOGIN; END IF; END $$`);
    await refusedUnchanged(
      'not the superuser',
      () =>
        inTransaction(db, async (tx) => {
          await sql.raw(`ALTER FUNCTION ${FN.replace(/'(.*)'::regprocedure/, '$1')} OWNER TO p9_not_super`).execute(tx);
          await callReset(holder.id, s, tx);
        }),
      'RESET_NOT_SUPERUSER',
    );
    expect(await one(`SELECT r.rolsuper AS su FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.oid = ${FN}`)).toEqual({ su: true });
    await refusedUnchanged(
      'replica mode',
      () =>
        inTransaction(db, async (tx) => {
          await sql`SET LOCAL session_replication_role = replica`.execute(tx);
          await callReset(holder.id, s, tx);
        }),
      'RESET_REPLICA_MODE',
    );
    // Another ADMIN (an active one, with a second factor): not the holder.
    await refusedUnchanged('not the holder', () => attempt(other.id, s), 'RESET_NOT_HOLDER', /^only the reset holder can do this$/);
    // Launched (as LOCK RESET leaves it): refused, in a transaction rolled back.
    await refusedUnchanged(
      'launched',
      () =>
        inTransaction(db, async (tx) => {
          await sql`UPDATE platform_reset_gate SET launched_at = now(), launched_by = ${holder.id}`.execute(tx);
          await callReset(holder.id, s, tx);
        }),
      'RESET_LOCKED',
    );
    // The holder disabled in Team (the owner's move for a wrong holder): NO_HOLDER, with its words.
    await auth().setAdminDisabled(holder.id, true, other.actor);
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'NO_HOLDER' });
    await refusedUnchanged('a disabled holder', () => attempt(holder.id, s), 'RESET_NO_HOLDER', /^there is no active reset holder/);
    // Enabled again, its second factor unchanged: no 24-hour wait, the step-up passes at once.
    await auth().setAdminDisabled(holder.id, false, other.actor);
    await signIn(holder);
    await authorize(holder, 'platform.reset');
    await unauthorize();
    // Disabled, its second factor reset by another ADMIN, enabled again: NO_HOLDER until it enrols again, then the step-up
    // waits 24 hours after the enrolment (STEP_UP_TOO_SOON), then passes.
    await auth().setAdminDisabled(holder.id, true, other.actor);
    await auth().disableTotp(holder.id, other.actor);
    await auth().setAdminDisabled(holder.id, false, other.actor);
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'NO_HOLDER' });
    await refusedUnchanged('a holder without its second factor', () => attempt(holder.id, s), 'RESET_NO_HOLDER');
    await secondFactor(holder);
    await signIn(holder);
    await expect(verify(holder, 'platform.reset')).rejects.toSatisfy((e) => e instanceof DomainError && e.code === 'STEP_UP_TOO_SOON' && e.httpStatus === 403);
    clock.advance(DAY + MINUTE);
    await signIn(holder);
    await signIn(other);
    await authorize(holder, 'platform.reset');
    expect(await gateRow()).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset' });
    await unauthorize();
  }, 300_000);

  it('the authorization: none, LOCK RESET\'s presented to the reset, a stale one (over 5 minutes): refused, nothing changed', async () => {
    const s = await seen();
    expect((await gateRow()).authorized_by).toBeNull();
    await refusedUnchanged('no authorization', () => attempt(holder.id, s), 'RESET_NOT_AUTHORIZED', /^no authorization of this admin for this, under 5 minutes old, since the last reset$/);
    await authorize(holder, 'platform.reset.lock');
    await refusedUnchanged('LOCK RESET\'s authorization', () => attempt(holder.id, s), 'RESET_NOT_AUTHORIZED');
    await authorize(holder, 'platform.reset');
    // Its time moved back by the superuser: 5 minutes and 1 second old.
    await q(`UPDATE platform_reset_gate SET authorized_at = authorized_at - interval '5 minutes 1 second'`);
    await refusedUnchanged('a stale authorization', () => attempt(holder.id, s), 'RESET_NOT_AUTHORIZED');
    await unauthorize();
  }, 300_000);

  it('the moment: the windows (and the 5-minute margin\'s end), a test RUNNING, a LIVE room open, a table outside the plan, the collectors changed: refused, nothing changed', async () => {
    const tests = testsOf(app!);
    // The test of the extras ENDED (its draw cancelled); another one started, RUNNING (its bots not entered yet).
    const done = await db.selectFrom('test_runs').select(['drop_id']).where('id', '=', drawRunId).executeTakeFirstOrThrow();
    expect((await tests.end(drawRunId, testPhrase(done.drop_id, true), holder.actor)).status).toBe('ENDED');
    await ctx.services.drops.cancel(done.drop_id, holder.actor);
    const runningDraw = await openDraw('MONOLITHE · P9 TEST RUNNING');
    const runningId = await startTest(tests, runningDraw, 2, false);
    expect(await one(`SELECT status FROM test_runs WHERE id = '${runningId}'`)).toEqual({ status: 'RUNNING' });
    try {
      // A window now, and only the margin's end inside one (the hub's backup 30 s ahead): refused.
      await authorize(holder, 'platform.reset');
      await windowsAs(`'NIGHT'::text`);
      expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'WINDOW' });
      await refusedUnchanged('in a window', async () => attempt(holder.id, await seen()), 'RESET_WINDOW', /^NIGHT$/);
      await windowsAs(`CASE WHEN p_at > now() + interval '30 seconds' THEN 'BACKUP' END`);
      await refusedUnchanged('the margin\'s end in a window', async () => attempt(holder.id, await seen()), 'RESET_WINDOW', /^BACKUP$/);
      // 6 minutes ahead: outside the margin, the precheck lets it through (to its next answer: the test running).
      await windowsAs(`CASE WHEN p_at > now() + interval '6 minutes' THEN 'BACKUP' END`);
      expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'TEST_RUNNING' });
    } finally {
      await windowsAs();
    }
    // A test RUNNING: refused; once ENDED (and its draw cancelled), the next answer.
    await refusedUnchanged('a test running', async () => attempt(holder.id, await seen()), 'RESET_TEST_RUNNING');
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'TEST_RUNNING' });
    expect((await tests.end(runningId, testPhrase(runningDraw, true), holder.actor)).status).toBe('ENDED');
    await ctx.services.drops.cancel(runningDraw, holder.actor);
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: null });

    // A LIVE room open: its room opened (5 minutes before T0, on the database's clock), not ended.
    const f: LiveFixture = { db, clock, audit: ctx.audit, drops: ctx.services.drops, live: ctx.services.live, liveConsole: ctx.services.liveConsole, seedKey: deriveDropSeedKey(config), turnKey: deriveLiveTurnKey(config), admin: holder.actor, modelId: monolithe };
    const soon = (await createLiveRelease(f, { opensAt: new Date(Date.now() + 2 * MINUTE), sizes: [{ label: await oneSizeOf(db, monolithe), stock: 1 }] })).id;
    await authorize(holder, 'platform.reset');
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'LIVE_OPEN' });
    await refusedUnchanged('a LIVE room open', async () => attempt(holder.id, await seen()), 'RESET_LIVE_OPEN');
    await q(`UPDATE drops SET cancelled_at = now() WHERE id = '${soon}'`);

    // The LIVE engine still running, another connection: the logic, from the function's own source (PGlite has one
    // connection; the real two-connection proofs are PURGE.13's): the engine's lock TRIED, false refused; every other
    // client backend of this database counted whatever its name and state.
    const src = (await one<{ def: string }>(`SELECT pg_get_functiondef(${FN}) AS def`)).def;
    expect(src).toMatch(new RegExp(`IF NOT pg_try_advisory_xact_lock\\(${LIVE_ENGINE_LOCK}::bigint\\) THEN\\s+RAISE EXCEPTION USING ERRCODE = 'OR011', MESSAGE = 'RESET_LIVE_ENGINE'`));
    const backends = src.slice(src.indexOf('FROM pg_stat_activity a'), src.indexOf('RESET_OTHER_CONNECTIONS'));
    expect(backends).toContain(`WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.backend_type = 'client backend'`);
    expect(backends).not.toMatch(/application_name|state\s*(=|<>|IN)/);
    expect(src.indexOf('RESET_LIVE_ENGINE')).toBeLessThan(src.indexOf('RESET_OTHER_CONNECTIONS'));
    expect(src.indexOf('RESET_OTHER_CONNECTIONS')).toBeLessThan(src.indexOf('LOCK TABLE public.%I'));

    // A table outside the plan (as a migration of another lot would add one): refused, named, nothing changed.
    await authorize(holder, 'platform.reset');
    await q(`CREATE TABLE public.p9_unplanned (id int)`);
    try {
      await refusedUnchanged('a table outside the plan', async () => attempt(holder.id, await seen()), 'RESET_UNPLANNED_TABLES', /p9_unplanned/);
    } finally {
      await q(`DROP TABLE public.p9_unplanned`);
    }

    // The collectors changed since the owner looked: one more account; and one deleted plus one signed up, the count equal.
    await authorize(holder, 'platform.reset');
    const looked = await seen();
    await auth().registerAccount({ email: 'p9.late.one@example.com', password: PASSWORD, firstName: 'Late', lastName: 'One', country: 'FR' });
    await refusedUnchanged('an account more', () => attempt(holder.id, looked), 'RESET_COLLECTORS_CHANGED', new RegExp(`^${looked.n + 1} accounts neither test nor team now, ${looked.n} seen until `));
    const again = await seen();
    await q(`UPDATE accounts SET status = 'DELETED' WHERE email = 'p9.late.one@example.com'`);
    clock.advance(SECOND);
    await auth().registerAccount({ email: 'p9.late.two@example.com', password: PASSWORD, firstName: 'Late', lastName: 'Two', country: 'FR' });
    expect((await seen()).n).toBe(again.n);
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}', ${again.n}, '${again.until}') AS r`)).toEqual({ r: 'COLLECTORS_CHANGED' });
    await refusedUnchanged('one deleted and one signed up', () => attempt(holder.id, again), 'RESET_COLLECTORS_CHANGED');
    await unauthorize();
  }, 300_000);

  it('failures roll back whole: a proof forced to fail (OR020 naming it), an error thrown mid-way, the last proof on clock_timestamp() inside a window; each audited platform.reset.failed by the run, the gate\'s resets unchanged', async () => {
    /** One failure: every table identical but the failure's audit row and the authorization the run clears. */
    const fails = async (label: string, check: (e: unknown) => void, reasonOf: (reason: string) => void) => {
      await authorize(holder, 'platform.reset');
      const before = await fingerprint();
      const gate = await gateRow();
      const head = Number((await one<{ id: string }>(`SELECT max(id)::text AS id FROM audit_logs`)).id);
      await expect(runReset(holder, await seen()), label).rejects.toSatisfy((e) => {
        check(e);
        return true;
      });
      const after = await fingerprint();
      for (const table of Object.keys(before)) if (table !== 'audit_logs' && table !== 'platform_reset_gate') expect(after[table], `${label}: ${table}`).toBe(before[table]);
      expect(await one(`SELECT md5(string_agg(x::text, chr(10) ORDER BY x::text)) AS h FROM audit_logs x WHERE id <= ${head}`)).toEqual({ h: before.audit_logs!.split(' ')[1] });
      const failed = await q<{ id: string; action: string; details: { reason: string } }>(`SELECT id::text, action, details FROM audit_logs WHERE id > ${head} ORDER BY id`);
      expect(failed.map((r) => r.action), label).toEqual(['platform.reset.failed']);
      reasonOf(failed[0]!.details.reason);
      expect(await gateRow(), label).toEqual({ ...gate, authorized_by: null, authorized_at: null, authorized_purpose: null });
      expect((await gateRow()).resets).toBe(0);
      expect(await ctx.audit.verifyChain()).toMatchObject({ ok: true });
    };
    // A proof forced to fail: a kept table written during the reset (a trigger fired by its DELETE of the accounts).
    await q(`CREATE FUNCTION p9_touch_kept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.admin_users SET failed_logins = failed_logins + 1 WHERE id = '${holder.id}'; RETURN NULL; END $$`);
    await q(`CREATE TRIGGER p9_touch_kept AFTER DELETE ON accounts FOR EACH STATEMENT EXECUTE FUNCTION p9_touch_kept()`);
    try {
      await fails(
        'a proof forced to fail',
        (e) => {
          expect(pgError(e)?.code).toBe(PG_ERROR.RESET_PROOF_FAILED);
          expect(resetRefusal(e)).toBe('RESET_PROOF_FAILED');
          expect(String((e as { detail?: string }).detail)).toMatch(/^1 check\(s\) failed, nothing is kept: kept table admin_users changed \(\d+ rows before, \d+ after\)$/);
        },
        (reason) => expect(reason).toMatch(/kept table admin_users changed/),
      );
    } finally {
      await q(`DROP TRIGGER p9_touch_kept ON accounts`);
      await q(`DROP FUNCTION p9_touch_kept()`);
    }
    // An error thrown mid-way (at the accounts' DELETE, after the TRUNCATE): everything back.
    await q(`CREATE FUNCTION p9_stop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'p9 stopped mid-way with a value 4242' USING ERRCODE = 'P0001'; END $$`);
    await q(`CREATE TRIGGER p9_stop BEFORE DELETE ON accounts FOR EACH STATEMENT EXECUTE FUNCTION p9_stop()`);
    try {
      await fails(
        'an error thrown mid-way',
        (e) => {
          expect(pgError(e)?.code).toBe('P0001');
          expect(resetRefusal(e)).toBeUndefined();
        },
        (reason) => {
          expect(reason).toBe('SQLSTATE P0001');
          expect(reason).not.toContain('4242');
        },
      );
    } finally {
      await q(`DROP TRIGGER p9_stop ON accounts`);
      await q(`DROP FUNCTION p9_stop()`);
    }
    // The last proof reads the clock now: a window that opens after the transaction's start (its checks at the start,
    // now() and now() + 5 minutes, pass).
    await windowsAs(`CASE WHEN p_at > now() AND p_at < now() + interval '1 minute' THEN 'NIGHT' END`);
    try {
      await fails(
        'the last proof inside a window',
        (e) => {
          expect(pgError(e)?.code).toBe(PG_ERROR.RESET_PROOF_FAILED);
          expect(String((e as { detail?: string }).detail)).toMatch(/inside a forbidden window now \(NIGHT\)$/);
        },
        (reason) => expect(reason).toMatch(/inside a forbidden window now \(NIGHT\)/),
      );
    } finally {
      await windowsAs();
    }
  }, 300_000);

  let lists: Awaited<ReturnType<typeof listsBefore>>;
  let reset1: { result: ResetResult; entry: AuditEntry };
  let keysBefore: unknown;
  const kept: Record<string, unknown> = {};

  it('THE RESET: every proof holds; the founding list, its sources and its links kept as the rule says, everything else wiped; the gate column by column; entry 1\'s capture equal to the lists read before', async () => {
    // The margin's end 6 minutes ahead in a window: outside the reset's 5 minutes, it goes on.
    await windowsAs(`CASE WHEN p_at > now() + interval '6 minutes' THEN 'BACKUP' END`);
    const ids = await authorize(holder, 'platform.reset');
    // The app closes its pool before the run (the shutdown path, PURGE.10): its context and app closed.
    await closeApp();
    const gateBefore = await gateRow();
    const secrets = await one<{ hash: string; sealed: string }>(`SELECT password_hash AS hash, totp_secret_enc AS sealed FROM admin_users WHERE id = '${holder.id}'`);
    lists = await listsBefore();
    keysBefore = await q(`SELECT * FROM cryptographic_keys ORDER BY key_id`);
    kept.preregistrations = await q(`SELECT * FROM preregistrations ORDER BY id`);
    kept.sources = await q(`SELECT * FROM acquisition_sources WHERE EXISTS (SELECT 1 FROM preregistrations p WHERE p.source_id = acquisition_sources.id) ORDER BY id`);
    kept.link = await one(`SELECT * FROM links WHERE id = '${made.keptLink}'`);
    kept.rewards = await q(`SELECT * FROM vault_rewards ORDER BY id`);
    kept.segments = await q(`SELECT * FROM segments WHERE id IN ('${made.segments!.keptLink}', '${made.segments!.tier}') ORDER BY id`);
    kept.media = await usedMedia();
    kept.revocations = await q(`SELECT * FROM revocations WHERE target_type = 'KEY' ORDER BY id`);
    const fp = await fingerprint();
    const s = await seen();
    expect(s.n).toBeGreaterThan(0);
    reset1 = await runReset(holder, s);
    await windowsAs();
    const { result, entry } = reset1;

    // Wiped: every table the plan wipes empty, releases and accounts (the invitation chain in one statement) deleted.
    for (const [table, kind] of Object.entries(RESET_PLAN)) if (kind === 'WIPE') expect(await count(table), table).toBe(table === 'audit_logs' ? 1 : 0);
    expect(Object.keys(result.wiped).sort()).toEqual(Object.entries(RESET_PLAN).filter(([, k]) => k === 'WIPE').map(([tb]) => tb).sort());
    expect(result.wiped.accounts).toBe(Number(fp.accounts!.split(' ')[0]));
    expect(result.wiped.drops).toBe(Number(fp.drops!.split(' ')[0]));
    for (const table of ['partners', 'partner_experiences', 'partner_invoices', 'invoices', 'products', 'genomes', 'codes', 'circle_post_images', 'test_runs', 'test_entrants', 'vaults', 'sessions']) {
      expect(result.wiped[table], table).toBe(Number(fp[table]!.split(' ')[0]));
    }
    expect(result.wiped.partners).toBe(2);
    expect(result.wiped.partner_invoices).toBe(3);
    // Kept whole: every KEEP table identical, row for row (count and fingerprint), the key among them.
    const fpAfter = await fingerprint();
    for (const [table, kind] of Object.entries(RESET_PLAN)) if (kind === 'KEEP') expect(fpAfter[table], table).toBe(fp[table]);
    expect(await q(`SELECT * FROM cryptographic_keys ORDER BY key_id`)).toEqual(keysBefore);
    // The founding list: the same rows, its accounts cleared; its sources; its link to the release re-pointed.
    expect(await q(`SELECT * FROM preregistrations ORDER BY id`)).toEqual((kept.preregistrations as Record<string, unknown>[]).map((p) => ({ ...p, account_id: null, matched_at: null })));
    expect(await q(`SELECT email_normalized FROM preregistrations ORDER BY email_normalized`)).toEqual(made.founding!.map((e) => ({ email_normalized: e })));
    expect(await q(`SELECT * FROM acquisition_sources ORDER BY id`)).toEqual(kept.sources);
    expect(await q(`SELECT * FROM links`)).toEqual([{ ...(kept.link as object), destination: 'RELEASES', drop_id: null }]);
    // Segments: those naming a release or the link that went removed; the others as they were.
    expect(await q(`SELECT * FROM segments ORDER BY id`)).toEqual(kept.segments);
    // The rewards: 0 given everywhere, only the given one's updated_at moved with it.
    const rewards = await q<Record<string, unknown>>(`SELECT * FROM vault_rewards ORDER BY id`);
    expect(rewards.map((r) => ({ ...r, given: 0, updated_at: null }))).toEqual((kept.rewards as Record<string, unknown>[]).map((r) => ({ ...r, given: 0, updated_at: null })));
    for (const [i, r] of rewards.entries()) {
      const was = (kept.rewards as Record<string, any>[])[i]!;
      expect(r.given).toBe(0);
      if (was.given === 0) expect(r).toEqual(was);
      else expect((r.updated_at as Date).getTime()).not.toBe((was.updated_at as Date).getTime());
    }
    // Photographs: exactly those of the models and the lookbook, the piece's identical to the lookbook's once; the
    // silhouette, the Circle's and the piece's own gone. Revocations: the keys' only.
    expect((await q<{ sha256: string }>(`SELECT sha256 FROM media_objects ORDER BY 1`)).map((r) => r.sha256)).toEqual(kept.media);
    expect(kept.media).toEqual(expect.arrayContaining([made.lookbook, made.cover]));
    for (const gone of [made.silhouette, made.circlePhoto, made.piecePhoto]) expect(kept.media).not.toContain(gone);
    expect(await q(`SELECT * FROM revocations ORDER BY id`)).toEqual(kept.revocations);
    expect(result.partly.media_objects!.before).toBeGreaterThan(result.partly.media_objects!.after);
    // The sequences of the wiped tables restarted; the founding list's sources' untouched.
    expect(result.sequencesRestarted).toEqual(expect.arrayContaining(['audit_logs_id_seq', 'order_events_id_seq', 'stock_movements_id_seq']));
    expect(result.sequencesRestarted).not.toContain('acquisition_sources_id_seq');

    // The gate, column by column against the snapshot (its authorization cleared at step 1): only the reset's four.
    const gate = await gateRow();
    for (const column of Object.keys(gateBefore)) {
      if (column.startsWith('authorized_')) expect(gate[column], column).toBeNull();
      else if (!RESET_GATE_CHANGED.includes(column)) expect(gate[column], column).toEqual(gateBefore[column]);
    }
    expect(Object.keys(gate).sort()).toEqual(Object.keys(gateBefore).sort());
    expect(gateBefore).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset', resets: 0, last_reset_at: null, last_reset_by: null, last_reset_details: null });
    expect(gate).toMatchObject({ resets: gateBefore.resets + 1, last_reset_by: holder.id, last_reset_at: expect.any(Date) });
    expect(gate.last_reset_details).toEqual({ oldHead: result.oldHead, totp: result.totp, requestId: result.requestId, stepUpId: result.stepUpId, recent24h: result.recent24h, capture: result.capture });

    // Entry 1 of the new chain, from the genesis hash; its capture equal to the lists read before.
    expect(entry).toMatchObject({ id: 1, action: 'platform.reset', prevHash: Buffer.from(AUDIT_GENESIS_HASH).toString('hex') });
    expect(await q(`SELECT id::int AS id, action FROM audit_logs`)).toEqual([{ id: 1, action: 'platform.reset' }]);
    const details = (await one<{ details: Record<string, any> }>(`SELECT details FROM audit_logs WHERE id = 1`)).details;
    expect(details.capture).toEqual(result.capture);
    expect(details.oldHead).toEqual({ id: Number(lists.head.id), hash: lists.head.hash });
    expect(details.totp).toEqual({ enabledAt: lists.totp.enabledAt, enabledBy: lists.totp.enabledBy, disabledAt: lists.totpOff?.disabledAt ?? null, disabledBy: lists.totpOff?.disabledBy ?? null });
    expect(details.totp.disabledBy).toBe(other.id);
    expect({ stepUpId: details.stepUpId, requestId: details.requestId }).toEqual(ids);
    expect(Array.isArray(details.recent24h)).toBe(true);
    const c = details.capture as Capture;
    expect(c.skus).toEqual(lists.skus);
    expect(c.skus.some((k) => k.how === 'declared')).toBe(true);
    expect(c.skus.some((k) => k.how === 'by a flow' && k.check === true)).toBe(true);
    expect(c.logins).toEqual(lists.logins);
    expect(c.logins.map((l) => l.email)).toEqual(expect.arrayContaining([holder.email, other.email]));
    for (const [list, names] of Object.entries(lists.names)) expect((c[list as keyof Capture] as { name: string }[]).map((x) => x.name), list).toEqual(names);
    expect(c.vaultRewardsGiven).toEqual(lists.vaultRewardsGiven);
    expect(c.vaultRewardsGiven).toEqual([expect.objectContaining({ id: made.reward, given: 1 })]);
    expect(c.pieceRanges).toEqual(lists.pieceRanges);
    expect(c.pieceRanges).toEqual(expect.arrayContaining([expect.objectContaining({ year: 2026, category: 'J', first: expect.stringMatching(/^O26-J-\d{5}$/) })]));
    expect(c.segmentsGone).toEqual(['P9 CAME BY THE GONE LINK', 'P9 TOOK PART IN THE LIVE']);
    expect(c.keys).toEqual(lists.keys);
    // Nothing secret, no collector's data: no password hash, no sealed second factor, no collector's address or name.
    const text = JSON.stringify(details);
    expect(text).not.toContain(secrets.hash);
    expect(text).not.toContain(secrets.sealed);
    expect(text).not.toMatch(/scrypt|camille|martin|p9\.invitee|test-0001|Ada Zurbaran/i);
    expect(await ctx.audit.verifyChain()).toEqual({ ok: true, checked: 1 });
  }, 300_000);

  it('after it: the guards refuse as before (OR001), the setting and the replication role as before; the authorization used once', async () => {
    const guarded = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => isGuardViolation(e));
    await guarded(q(`DELETE FROM audit_logs WHERE id = 1`), 'DELETE audit_logs');
    await guarded(q(`UPDATE audit_logs SET action = 'p9.changed' WHERE id = 1`), 'UPDATE audit_logs');
    await guarded(q(`TRUNCATE audit_logs`), 'TRUNCATE audit_logs');
    await guarded(q(`DELETE FROM cryptographic_keys`), 'DELETE cryptographic_keys');
    await guarded(q(`UPDATE cryptographic_keys SET kid = kid || 'x'`), 'UPDATE cryptographic_keys');
    expect(await one(`SELECT coalesce(current_setting('orbes.guard_bypass', true), '') AS v, current_setting('session_replication_role') AS r`)).toEqual({ v: '', r: 'origin' });
    // Its authorization was used: the same reset again refused, nothing changed.
    expect((await gateRow()).authorized_by).toBeNull();
    await refusedUnchanged('the authorization already used', async () => attempt(holder.id, await seen()), 'RESET_NOT_AUTHORIZED');
  }, 300_000);

  let base: { accounts: string; tracking: string; acquisition: string; sources: unknown; admins: unknown };

  it('the app boots twice on the reset database as in production: no key made and the kept one self-tested, the boot rows made again, no bootstrap admin, no restart loop', async () => {
    const admins = await q(`SELECT * FROM admin_users ORDER BY id`);
    const keys = await q(`SELECT * FROM cryptographic_keys ORDER BY key_id`);
    logged.length = 0;
    const bootstrapAdmin = { email: 'p9.bootstrap@example.com', password: PASSWORD };
    for (let i = 0; i < 2; i++) {
      ctx = await boot({ bootstrapAdmin });
      expect(await ctx.keys.selfTest(), `boot ${i + 1}`).toBe(true);
      expect(await q(`SELECT * FROM cryptographic_keys ORDER BY key_id`)).toEqual(keys);
      expect(await q(`SELECT * FROM admin_users ORDER BY id`)).toEqual(admins);
      // The boot's rows: the visits' and the views' start, the fixed sources, the founding list's kept beside them.
      expect(await count('tracking_state')).toBe(1);
      expect(await count('acquisition_state')).toBe(1);
      expect((await q<{ kind: string }>(`SELECT DISTINCT kind FROM acquisition_sources ORDER BY 1`)).map((r) => r.kind)).toEqual(expect.arrayContaining(['BEFORE', 'DIRECT', 'LINK', 'STAFF']));
      const now = { accounts: String(await count('accounts')), tracking: JSON.stringify(await q(`SELECT * FROM tracking_state`)), acquisition: JSON.stringify(await q(`SELECT * FROM acquisition_state`)), sources: await q(`SELECT * FROM acquisition_sources ORDER BY id`), admins };
      if (i === 0) base = now;
      else expect(now).toEqual(base);
      if (i === 0) await ctx.close();
    }
    expect(logged.filter((l) => l.level === 'error')).toEqual([]);
    app = await buildApp(ctx, { serveStatic: false, liveHub: { pulseMs: 0, cacheMs: 0 } });
  }, 120_000);

  it('the app works as on 9 Oct: health 200; one pass of housekeeping and of every sender and a tracking flush, no error and no audit row; every GET route without a 5xx; the /go/ link to the releases page; POST /api/v1/founding takes an address', async () => {
    const anonymous = new Client(app!);
    expect((await anonymous.get('/api/v1/health')).statusCode).toBe(200);
    // One pass of each job: no error logged, no audit row written.
    const jobs: [string, () => Promise<unknown>][] = [
      ['housekeeping', async () => {
        const hk = startHousekeeping(ctx, { intervalMs: HOUR });
        try {
          return await hk.runOnce();
        } finally {
          await hk.stop();
        }
      }],
      ['email', () => ctx.services.email.sendDue()],
      ['house', () => ctx.services.houseMessages.deliverDue()],
      ['ads', () => ctx.services.ads.sendDue()],
      ['receptions', () => ctx.services.receptions.issuePending()],
      ['tracking', () => ctx.services.tracking.flushNow()],
    ];
    for (const [name, job] of jobs) {
      logged.length = 0;
      const auditBefore = await count('audit_logs');
      await expect(job(), name).resolves.toBeDefined();
      expect(logged.filter((l) => l.level === 'error'), name).toEqual([]);
      expect(await count('audit_logs'), name).toBe(auditBefore);
    }

    // The console signed in again (every session ended), a collector account made again (the checklist's (4)).
    const staff = new Client(app!);
    expect((await staff.post('/api/admin/auth/login', { email: holder.email, password: PASSWORD, totp: code(holder) })).statusCode).toBe(200);
    const collector = new Client(app!);
    expect((await collector.post('/api/v1/account/register', { email: 'p9.collector.again@example.com', password: PASSWORD, firstName: 'Camille', lastName: 'Again', country: 'FR' })).statusCode).toBe(201);

    // Every GET of the registered route table, the detail routes on the kept catalogue's ids, the rest on an unknown id.
    const ids = {
      model: monolithe,
      segment: made.segments!.tier,
      link: made.keptLink!,
      media: made.lookbook!,
      admin: holder.id,
      slug: (await one<{ slug: string | null }>(`SELECT slug FROM models WHERE id = '${monolithe}'`)).slug ?? 'monolithe',
      set: (await one<{ id: string } | undefined>(`SELECT id FROM sets LIMIT 1`))?.id,
      addon: (await one<{ id: string } | undefined>(`SELECT id FROM addon_items LIMIT 1`))?.id,
      kind: (await one<{ kind: string } | undefined>(`SELECT kind FROM email_templates LIMIT 1`))?.kind ?? 'WELCOME',
      moment: (await one<{ moment: string } | undefined>(`SELECT moment FROM house_moment_settings LIMIT 1`).catch(() => undefined))?.moment ?? 'BIRTHDAY',
    };
    const unknown = randomUUID();
    const fill = (route: string): string =>
      route
        .replace(/^\/api\/admin\/models\/:id/, `/api/admin/models/${ids.model}`)
        .replace(/^\/api\/admin\/segments\/:id/, `/api/admin/segments/${ids.segment}`)
        .replace(/^\/api\/admin\/links\/:id/, `/api/admin/links/${ids.link}`)
        .replace(/^\/api\/admin\/admins\/:id/, `/api/admin/admins/${ids.admin}`)
        .replace(/^\/api\/admin\/sets\/:id/, `/api/admin/sets/${ids.set ?? unknown}`)
        .replace(/^\/api\/admin\/addons\/:id/, `/api/admin/addons/${ids.addon ?? unknown}`)
        .replace(/^\/api\/admin\/email\/kinds\/:kind/, `/api/admin/email/kinds/${ids.kind}`)
        .replace(/^\/api\/admin\/house\/moments\/:moment/, `/api/admin/house/moments/${ids.moment}`)
        .replace(/^\/api\/v1\/media\/:sha256/, `/api/v1/media/${ids.media}`)
        .replace(/\/:slug/, `/${ids.slug}`)
        .replace(/^\/go\/:code/, '/go/p9-founding')
        .replace(/\/:productId/, '/O26-J-00184')
        .replace(/\/:code\b/, '/ABCD-EFGH-JKLM')
        .replace(/\/:number/, '/INV-2026-000001')
        .replace(/\/:name/, '/p9-unknown.woff2')
        .replace(/\.:format/, '.svg')
        .replace(/:[A-Za-z]+/g, unknown);
    const routes = getRoutes(app!);
    expect(routes.length).toBeGreaterThan(200);
    const answers: { route: string; url: string; status: number }[] = [];
    for (const route of routes) {
      const url = fill(route);
      const who = route.startsWith('/api/admin') ? staff : route.startsWith('/go/') ? anonymous : collector;
      const res = await within(who.get(url), 20 * SECOND, url);
      answers.push({ route, url, status: res.statusCode });
    }
    expect(answers.filter((a) => a.status >= 500)).toEqual([]);
    expect(answers.filter((a) => a.status === 429)).toEqual([]);
    expect(answers.filter((a) => a.status === 401 && !a.route.startsWith('/api/admin/auth'))).toEqual([]);
    // The kept catalogue answers as before: its details 200.
    for (const route of ['/api/admin/models/:id', '/api/admin/segments/:id', '/api/admin/links/:id', '/api/v1/media/:sha256', '/api/admin/keys', '/api/v1/keys', '/api/admin/founding']) {
      const a = answers.find((x) => x.route === route);
      if (a) expect(a.status, route).toBe(200);
    }
    expect(answers.filter((a) => a.status === 200).length).toBeGreaterThan(120);

    // The founding list's link to a release leads to the releases page now, the code kept on the address.
    const go = await anonymous.get('/go/p9-founding');
    expect(go.statusCode).toBe(302);
    const releases = await ctx.services.links.resolve('p9-founding');
    expect(releases).not.toBeNull();
    expect(go.headers.location).toBe(`${releases}?o=p9-founding`);
    expect((await ctx.services.links.get(made.keptLink!)).destination).toBe('RELEASES');
    expect((await anonymous.get('/go/p9-gone')).headers.location).toBe('/verify');

    // theorbes.com's form: a new address on the founding list.
    const form = new Client(app!, { origin: FOUNDING_ORIGIN });
    const posted = await form.post('/api/v1/founding', { email: 'p9.after.reset@example.com', firstName: 'Nora', country: 'FR', consent: true, website: '' });
    expect(posted.statusCode).toBe(202);
    expect(await count(`preregistrations WHERE email_normalized = 'p9.after.reset@example.com'`)).toBe(1);
    expect(await ctx.audit.verifyChain()).toMatchObject({ ok: true });
  }, 600_000);

  it('the numbers start again at 1: piece reference 00001, INV- and CN-…-000001, P- and PC-…-0001, test-0001; order_events still append-only', async () => {
    const year = clock.now().getUTCFullYear();
    const yy = String(year % 100).padStart(2, '0');
    // The first piece made after it.
    const issued = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: monolithe, material: '925 STERLING SILVER', variant: await oneSizeOf(db, monolithe) }, SYSTEM_ACTOR);
    expect(issued.product.productId).toBe(`O${yy}-J-00001`);
    // A collector's invoice and credit note.
    const collector = (await db.selectFrom('accounts').select('id').where('email', '=', 'p9.collector.again@example.com').executeTakeFirstOrThrow()).id;
    const order = await paidSalonOrder(collector);
    clock.advance(MINUTE);
    await ctx.services.orders.transition(order, { to: 'CANCELLED', note: 'The client withdrew.' }, holder.actor);
    expect(await invoiceNumbers(order)).toEqual([`INV-${year}-000001`, `CN-${year}-000001`]);
    // A partner's invoice and credit note.
    expect(await partnerDocuments('P9 MAISON AFTER', true)).toEqual({ invoice: `P-${year}-0001`, creditNote: `PC-${year}-0001` });
    // The TEST ENTRANTS pool from test-0001 again.
    const tests = testsOf(app!);
    const drop = await openDraw('MONOLITHE · P9 TEST AFTER THE RESET');
    const runId = await startTest(tests, drop, 1);
    expect(await q(`SELECT a.email FROM test_run_entrants r JOIN accounts a ON a.id = r.account_id WHERE r.run_id = '${runId}'`)).toEqual([{ email: 'test-0001@orbes.test' }]);
    expect((await tests.end(runId, testPhrase(drop, true), holder.actor)).status).toBe('ENDED');
    await ctx.services.drops.cancel(drop, holder.actor);
    // order_events, written by the order above, refuses as before.
    expect(await count(`order_events WHERE order_id = '${order}'`)).toBeGreaterThan(0);
    await expect(q(`DELETE FROM order_events WHERE order_id = '${order}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(q(`UPDATE order_events SET actor_id = actor_id WHERE order_id = '${order}'`)).rejects.toSatisfy(isGuardViolation);
  }, 300_000);

  it('a second reset works; before it, an authorization older than the last reset refused, nothing changed', async () => {
    await signIn(holder);
    await signIn(other);
    // An authorization dated at the last reset (as one written before it would be): refused.
    await authorize(holder, 'platform.reset');
    await q(`UPDATE platform_reset_gate SET authorized_at = last_reset_at`);
    await refusedUnchanged('older than the last reset', async () => attempt(holder.id, await seen()), 'RESET_NOT_AUTHORIZED');
    await refusedUnchanged('LOCK RESET, older than the last reset', () => attemptLock(holder.id), 'RESET_NOT_AUTHORIZED');
    // The second reset.
    await authorize(holder, 'platform.reset');
    const gateBefore = await gateRow();
    const founding = await q(`SELECT email_normalized FROM preregistrations ORDER BY 1`);
    const s = await seen();
    expect(s.n).toBe(1);
    await closeApp();
    const { result, entry } = await runReset(holder, s);
    expect(entry).toMatchObject({ id: 1, action: 'platform.reset' });
    expect(result.oldHead!.id).toBeGreaterThan(1);
    expect(result.capture.pieceRanges).toEqual([expect.objectContaining({ year: clock.now().getUTCFullYear(), category: 'J', pieces: 1, first: expect.stringMatching(/-00001$/) })]);
    const gate = await gateRow();
    expect(gate).toMatchObject({ resets: 2, last_reset_by: holder.id, holder_admin_id: gateBefore.holder_admin_id, launched_at: null, authorized_by: null });
    expect(gate.last_reset_at.getTime()).toBeGreaterThan(gateBefore.last_reset_at.getTime());
    for (const table of ['accounts', 'products', 'invoices', 'partner_invoices', 'partners', 'drops', 'test_entrants']) expect(await count(table), table).toBe(0);
    expect(await q(`SELECT email_normalized FROM preregistrations ORDER BY 1`)).toEqual(founding);
    expect(await count(`preregistrations WHERE account_id IS NOT NULL OR matched_at IS NOT NULL`)).toBe(0);
    ctx = await boot();
    expect(await ctx.keys.selfTest()).toBe(true);
    expect(await ctx.audit.verifyChain()).toEqual({ ok: true, checked: 1 });
  }, 300_000);

  it('LOCK RESET: LOCK RESET\'s own refusals (the reset\'s authorization, not the holder, none, a stale one), each with nothing changed; then pressed (in any window), used once, one way: every reset and lock refused for good', async () => {
    await signIn(holder);
    await signIn(other);
    // The reset's authorization presented to LOCK RESET.
    await authorize(holder, 'platform.reset');
    await refusedUnchanged('the reset\'s authorization', () => attemptLock(holder.id), 'RESET_NOT_AUTHORIZED');
    await unauthorize();
    await refusedUnchanged('not the holder', () => attemptLock(other.id), 'RESET_NOT_HOLDER');
    await refusedUnchanged('no authorization', () => attemptLock(holder.id), 'RESET_NOT_AUTHORIZED');
    await authorize(holder, 'platform.reset.lock');
    await q(`UPDATE platform_reset_gate SET authorized_at = authorized_at - interval '5 minutes 1 second'`);
    await refusedUnchanged('a stale authorization', () => attemptLock(holder.id), 'RESET_NOT_AUTHORIZED');
    await unauthorize();
    // Pressed as PlatformResetService.lock will (PURGE.10), in the night: LOCK RESET is allowed in any window.
    await windowsAs(`'NIGHT'::text`);
    const gateBefore = await gateRow();
    try {
      await authorize(holder, 'platform.reset.lock', async (tx) => {
        await sql`SELECT orbes_platform_reset_lock(${holder.id}::uuid)`.execute(tx);
        // Used once, inside its own transaction: the authorization already cleared.
        expect(await one(`SELECT authorized_by, authorized_purpose FROM platform_reset_gate`, tx)).toEqual({ authorized_by: null, authorized_purpose: null });
        await audit().record({ actor: holder.actor, action: 'platform.reset.lock', targetType: 'admin', targetId: holder.id }, tx);
      });
    } finally {
      await windowsAs();
    }
    const gate = await gateRow();
    expect(gate).toMatchObject({ launched_by: holder.id, launched_at: expect.any(Date), authorized_by: null, authorized_at: null, authorized_purpose: null, resets: 2, holder_admin_id: holder.id });
    for (const column of ['last_reset_at', 'last_reset_by', 'last_reset_details', 'resets', 'holder_admin_id']) expect(gate[column], column).toEqual(gateBefore[column]);
    expect(await one(`SELECT orbes_platform_reset_precheck('${holder.id}') AS r`)).toEqual({ r: 'LOCKED' });
    // For good: a second lock, a reset, an authorization; each refused, nothing changed; the lock one way.
    const words = /^LOCK RESET was pressed at /;
    await refusedUnchanged('a second lock', () => attemptLock(holder.id), 'RESET_LOCKED', words);
    await refusedUnchanged('a reset', async () => attempt(holder.id, await seen()), 'RESET_LOCKED', words);
    await refusedUnchanged('an authorization', () => authorize(holder, 'platform.reset.lock'), 'RESET_LOCKED', words);
    await refusedUnchanged('an authorization of the reset', () => authorize(holder, 'platform.reset'), 'RESET_LOCKED', words);
    await expect(q(`UPDATE platform_reset_gate SET launched_at = NULL, launched_by = NULL`)).rejects.toSatisfy(isGuardViolation);
    await expect(q(`UPDATE platform_reset_gate SET holder_admin_id = '${other.id}'`)).rejects.toSatisfy(isGuardViolation);
  }, 300_000);
});

/** The registered route table's GET routes, every one (Fastify's printRoutes, its tree read back into paths). */
function getRoutes(a: FastifyInstance): string[] {
  const stack: string[] = [];
  const out: string[] = [];
  for (const line of a.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^([│ ]*)[├└]── (.*?)(?: \(([A-Z, ]+)\))?$/u.exec(line);
    if (!m) continue;
    const depth = [...m[1]!].length / 4;
    stack.length = depth;
    const path = (stack[depth - 1] ?? '') + m[2];
    stack[depth] = path;
    if (m[3]?.split(', ').includes('GET')) out.push(path);
  }
  return out;
}

/** A request that must answer within `ms` (a stream that never ends fails the sweep instead of hanging it). */
async function within(p: Promise<LightMyRequestResponse>, ms: number, url: string): Promise<LightMyRequestResponse> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms: GET ${url}`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
