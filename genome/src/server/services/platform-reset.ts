/**
 * PLATFORM RESET and LOCK RESET in the app (lot PURGE, plan §B.4; the owner's answers of 27 Oct 2026, answers 1 to 3 and
 * Claude's points 3, 4, 5, 7, 8 and 10): the one button that empties the platform before the launch, pressed from the
 * console only, by the reset holder only, until LOCK RESET closes it for good. The database does the reset and every
 * check of it (migration 0067: `orbes_platform_reset_precheck`, `_authorize`, `_unauthorize`, `orbes_platform_reset`,
 * `orbes_platform_reset_lock`); this service asks it, and words its answers for the console, Paris time first.
 *
 *  - `state(adminId)`: `{ holder: false }` for anyone but the holder (D12: nothing else). For the holder: his email, LOCK
 *    RESET (when and by whom), the last reset (when, by whom, its counts, entry 1's hash as the new chain's anchor, the
 *    old chain's head, the lists it captured before the wipe) with its POST-CHECK computed read-only at each reading,
 *    as the 9 Oct `reset-to-catalogue.postcheck.sql` did (entry 1 is id 1 from AUDIT_GENESIS_HASH and the chain checks
 *    OK; one ACTIVE signing key; pieces, invoices and partner invoices none or from 1; the next piece reference per
 *    active category, the next INV-, CN-, P- and PC- numbers and the next test, `test-0001`), each line OK or failing;
 *    the last refused reset (the newest `platform.reset.failed` since the last reset); and why a reset would be refused
 *    now (the database's precheck, in words).
 *  - `isHolder(adminId)`: whether he is the holder, nothing else (the Settings page's link, one read of the gate).
 *  - `preview(adminId)` (holder only): one REPEATABLE READ, READ ONLY transaction, counts and names only, no lock
 *    beyond reads and no rehearsal (D19): every table's rows that go and stay by its class, the collectors neither test
 *    nor team (`countedCollector`, population.ts) with their 20 newest sign-up dates in Paris and `collectorsSeenUntil`
 *    (the newest sign-up among them, to the microsecond: it travels back with the press, G18), the test entrants, the
 *    founding list, the links kept and wiped, the partners wiped, the releases open or announced, a LIVE room open,
 *    and the SAME lists the reset captures into entry 1 (what stays that a test may have made: SKUs with their origin,
 *    console logins, suppliers, points of sale, carriers, stock locations, boxes, add-ons, sets, vault rewards given,
 *    the ads' events_from, the piece reference ranges per year and category, the segments that go, the signing keys).
 *  - `numbersAfterReset(now, categories)`: the one helper every number after a reset comes from (H2), computed for the
 *    date: the UTC year of issue (as invoices.ts and partners.ts take it) and the piece reference prefix of that year
 *    (as issuance.ts formats it). The preview's dialog body and the post-check read it, so they never disagree.
 *  - `request(...)`: the phrase RESET PLATFORM; the database's precheck with the count of collectors and the newest
 *    sign-up the owner saw (409 RESET_COLLECTORS_CHANGED, LIVE_OPEN, RESET_WINDOW … in words); the step-up verified
 *    BEFORE the transaction with the password (AuthService.verifyAdminStepUp: a wrong code is counted in its own
 *    commit); then ONE transaction: the step-up consumed, the precheck again, `platform.reset.requested`, and
 *    `orbes_platform_reset_authorize`, the single-use authorization the reset itself requires within 5 minutes. It
 *    answers `{ restartsIn }`; the ROUTE then asks `ctx.lifecycle.requestPlatformReset` once its 202 is sent.
 *  - `run(adminId, collectorsSeen, collectorsSeenUntil, conn)`: the reset, on ONE DEDICATED CONNECTION `conn` that the
 *    shutdown path opens after it has closed the main pool (H13: the function refuses any other client backend),
 *    never on the main pool: one transaction, `SET LOCAL statement_timeout = '120s'`, the function, then entry 1 of
 *    the new chain (`platform.reset`, from AUDIT_GENESIS_HASH: who, when, the counts, the old head, the holder's second
 *    factor's dates, the request's and the step-up's ids, the 24 h facts the step-up still counts (H5) and the
 *    capture; ids, names, staff emails, dates and hashes only), checked to be entry 1, COMMIT. On any error: ROLLBACK,
 *    then in a new transaction on the same connection the authorization cleared and `platform.reset.failed { reason }`
 *    (the database's refusal, its failed checks, or the error's SQLSTATE; never a value), and the error rethrown.
 *  - `lock(...)`: the phrase LOCK RESET; the step-up verified before with the password; then one transaction: consumed,
 *    `platform.reset.lock.requested`, the authorization, `orbes_platform_reset_lock`, `platform.reset.lock`.
 *
 * Nothing here ever exits the process or stops a service: index.ts's shutdown path (platform-reset-shutdown.ts) does,
 * and only once the request's 202 is on the wire (H4).
 */
import { sql } from 'kysely';
import { formatProductId, type CategoryInfo, type CategoryResolver } from '../../core/identity.js';
import { toHex } from '../../core/bytes.js';
import { inTransaction, type Db } from '../db/connection.js';
import { pgError, resetRefusal } from '../db/pg-errors.js';
import { RESET_PLAN, type ResetClass } from '../db/reset-plan.js';
import { conflict, DomainError, forbidden, validationError } from '../errors.js';
import { noopLogger, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import { AUDIT_GENESIS_HASH, AuditService } from './audit.js';
import type { AuthService, ClientMeta } from './auth.js';
import { invoiceNumber } from './invoices.js';
import { LIVE_ROOM_OPENS_MINUTES } from './live.js';
import { MAINTENANCE_MARGIN_MS, parisWhen, windowWords } from './maintenance-window.js';
import { partnerInvoiceNumber } from './partners.js';
import { parisDateTime } from './schedule.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The phrase typed to reset the platform (D2). */
export const RESET_PHRASE = 'RESET PLATFORM';
/** The phrase typed to lock the reset for good (D13). */
export const LOCK_PHRASE = 'LOCK RESET';
/** The reset's statement timeout, inside its one transaction (plan §B.4). */
export const RESET_STATEMENT_TIMEOUT = '120s';
/** What the console says after the 202 (the platform restarts). */
export const RESET_RESTARTS_IN = 'about a minute';
/** The newest sign-ups the preview lists (their dates only, never an email). */
export const PREVIEW_SIGN_UPS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An instant as the preview gives it (ISO-8601, to the microsecond), or with an offset. */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
/** A time as the database writes it for the console (the migration's `iso`): ISO-8601 in UTC, to the microsecond. */
const iso = (expr: string) => `to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// The rules of migration 0067, as SQL over the given alias (the migration keeps its own copies: a migration never
// changes); test/services/platform-reset.test.ts proves the preview's lists equal what the reset captured.

/** A counted collector (population.ts countedCollector): not DELETED, not a test entrant, not the team's own. */
const COUNTED = (a: string) =>
  `${a}.status <> 'DELETED' AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = ${a}.id)
   AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.email_normalized = ${a}.email_normalized)`;
/** A source the founding list names (kept). */
const SOURCE_KEPT = (s: string) => `EXISTS (SELECT 1 FROM preregistrations p WHERE p.source_id = ${s}.id)`;
/** A link a kept source names (kept). */
const LINK_KEPT = (l: string) => `EXISTS (SELECT 1 FROM acquisition_sources s WHERE s.link_id = ${l}.id AND ${SOURCE_KEPT('s')})`;
/** A segment that goes: its rules name a release, or a link that goes. */
const SEGMENT_GOES = (s: string) => `(jsonb_path_exists(${s}.criteria, 'lax $.**.dropId ? (@.type() == "string")')
     OR EXISTS (SELECT 1 FROM jsonb_path_query(${s}.criteria, 'lax $.**.linkIds[*]') AS x (v)
                 WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.id::text = lower(x.v #>> '{}') AND ${LINK_KEPT('l')})))`;
/** A photograph a kept model (its cover) or a lookbook uses. */
const MEDIA_USED = (m: string) =>
  `(EXISTS (SELECT 1 FROM models x WHERE x.image_sha256 = ${m}.sha256) OR EXISTS (SELECT 1 FROM model_images x WHERE x.sha256 = ${m}.sha256))`;
/** A LIVE room open now (a LIVE release published, not cancelled, its room opened and not ended). */
const LIVE_OPEN = (d: string) =>
  `${d}.mode = 'LIVE' AND ${d}.published_at IS NOT NULL AND ${d}.cancelled_at IS NULL AND ${d}.ended_at IS NULL
   AND ${d}.opens_at - coalesce(${d}.room_opens_minutes, ${LIVE_ROOM_OPENS_MINUTES.default}) * interval '1 minute' <= now()`;

/**
 * The lists the reset captures into entry 1 (migration 0067 §B.2 d 6b), the same SQL: what stays that a test may have
 * made, what goes that has a name, the signing keys. Read only.
 */
const CAPTURE_SQL = `SELECT jsonb_build_object(
  'skus', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'code', k.code,
             'model', CASE WHEN m.id IS NOT NULL THEN m.name || coalesce(' / ' || m.variant_label, '') END,
             'addon', ai.name,
             'size', coalesce(k.size_label, 'ONE SIZE'),
             'sizeType', m.size_type,
             'status', CASE WHEN k.set_aside_at IS NULL THEN 'offered' ELSE 'set aside' END,
             'createdAt', ${iso('k.created_at')},
             'pieces', (SELECT count(*) FROM products x WHERE x.sku_id = k.id),
             'orders', (SELECT count(*) FROM orders x WHERE x.sku_id = k.id),
             'releaseSizes', (SELECT count(*) FROM drop_sizes x WHERE x.sku_id = k.id),
             'stockMoves', (SELECT count(*) FROM stock_movements x WHERE x.sku_id = k.id),
             'how', o.how,
             'check', (o.how = 'by a flow' AND k.set_aside_at IS NULL))
             ORDER BY lower(coalesce(m.name, ai.name, '')), lower(coalesce(m.variant_label, '')), k.created_at, k.code), '[]'::jsonb)
             FROM skus k
             LEFT JOIN models m ON m.id = k.model_id
             LEFT JOIN addon_items ai ON ai.id = k.addon_id
             CROSS JOIN LATERAL (SELECT CASE
               WHEN k.addon_id IS NOT NULL THEN 'with the add-on'
               WHEN EXISTS (SELECT 1 FROM audit_logs a
                             WHERE a.target_type = 'model' AND a.target_id = k.model_id::text AND a.action = 'model.sizes.declare'
                               AND (jsonb_path_exists(a.details, '$.added[*] ? (@ == $c)', jsonb_build_object('c', k.code))
                                 OR jsonb_path_exists(a.details, '$.reinstated[*] ? (@ == $c)', jsonb_build_object('c', k.code))))
                 THEN 'declared'
               WHEN EXISTS (SELECT 1 FROM audit_logs a
                             WHERE a.target_type = 'model' AND a.target_id = k.model_id::text
                               AND ((a.action = 'model.create' AND k.size_label IS NULL AND a.details ? 'sizeType')
                                 OR (a.action = 'model.variant.create'
                                     AND jsonb_path_exists(a.details, '$.sizes[*] ? (@ == $s)', jsonb_build_object('s', coalesce(k.size_label, 'ONE SIZE'))))))
                 THEN 'with the model'
               WHEN m.size_type IS NOT NULL THEN 'before the type'
               ELSE 'by a flow' END AS how) o),
  'logins', (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'email', a.email, 'role', a.role, 'totp', a.totp_secret_enc IS NOT NULL,
               'status', CASE WHEN a.disabled_at IS NULL THEN 'active' ELSE 'disabled' END, 'createdAt', ${iso('a.created_at')})
               ORDER BY a.created_at, a.email), '[]'::jsonb) FROM admin_users a),
  'suppliers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'name', s.name, 'status', CASE WHEN s.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('s.created_at')})
                  ORDER BY lower(s.name), s.id), '[]'::jsonb) FROM suppliers s),
  'pointsOfSale', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'name', x.name, 'city', x.city, 'country', x.country, 'status', CASE WHEN x.active THEN 'active' ELSE 'inactive' END,
                     'createdAt', ${iso('x.created_at')}) ORDER BY lower(x.name), x.id), '[]'::jsonb) FROM retailers x),
  'carriers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'name', c.name, 'status', CASE WHEN c.active THEN 'offered' ELSE 'set aside' END, 'createdAt', ${iso('c.created_at')})
                 ORDER BY lower(c.name), c.id), '[]'::jsonb) FROM carriers c),
  'stockLocations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'name', l.name, 'default', l.is_default, 'address', l.address IS NOT NULL, 'createdAt', ${iso('l.created_at')})
                       ORDER BY lower(l.name), l.id), '[]'::jsonb) FROM stock_locations l),
  'boxes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'name', b.name, 'status', CASE WHEN b.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('b.created_at')})
              ORDER BY lower(b.name), b.id), '[]'::jsonb) FROM boxes b),
  'addons', (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'name', x.name, 'kind', x.kind, 'status', CASE WHEN x.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('x.created_at')})
               ORDER BY lower(x.name), x.id), '[]'::jsonb) FROM addon_items x),
  'sets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', x.name, 'code', x.code, 'status', CASE WHEN x.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('x.created_at')})
             ORDER BY lower(x.name), x.id), '[]'::jsonb) FROM sets x),
  'vaultRewardsGiven', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'id', v.id, 'kind', v.kind, 'given', v.given, 'quantity', v.quantity, 'active', v.active)
                          ORDER BY v.position, v.id), '[]'::jsonb) FROM vault_rewards v WHERE v.given > 0),
  'adsEventsFrom', (SELECT ${iso('x.events_from')} FROM ads_settings x WHERE x.events_from IS NOT NULL ORDER BY x.id LIMIT 1),
  'pieceRanges', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'year', q.year, 'category', q.category, 'pieces', q.pieces, 'first', q.first, 'last', q.last)
                    ORDER BY q.year, q.category), '[]'::jsonb)
                    FROM (SELECT p.year, btrim(c.code) AS category, count(*) AS pieces, min(p.product_id) AS first, max(p.product_id) AS last
                            FROM products p JOIN categories c ON c.id = p.category_id GROUP BY p.year, btrim(c.code)) q),
  'segmentsGone', (SELECT coalesce(jsonb_agg(s.name ORDER BY lower(s.name), s.id), '[]'::jsonb) FROM segments s WHERE ${SEGMENT_GOES('s')}),
  'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('keyId', k.key_id, 'kid', k.kid, 'status', k.status) ORDER BY k.key_id), '[]'::jsonb)
             FROM cryptographic_keys k)
) AS capture`;

/** How many rows of each partly kept table stay (migration 0067's rules, §B.1). */
const PARTLY_STAYS: Readonly<Record<string, string>> = Object.freeze({
  media_objects: `SELECT count(*) FROM media_objects m WHERE ${MEDIA_USED('m')}`,
  revocations: `SELECT count(*) FROM revocations x WHERE x.target_type = 'KEY'`,
  segments: `SELECT count(*) FROM segments s WHERE NOT ${SEGMENT_GOES('s')}`,
  vault_rewards: `SELECT count(*) FROM vault_rewards`,
  preregistrations: `SELECT count(*) FROM preregistrations`,
  acquisition_sources: `SELECT count(*) FROM acquisition_sources s WHERE ${SOURCE_KEPT('s')}`,
  links: `SELECT count(*) FROM links l WHERE ${LINK_KEPT('l')}`,
  platform_reset_gate: `SELECT count(*) FROM platform_reset_gate`,
});

// ── Types ──────────────────────────────────────────────────────────────────

/** What the reset captured before the wipe (entry 1's `capture`; the preview's `lists`). */
export interface ResetCapture {
  skus: Record<string, unknown>[];
  logins: { email: string; role: string; totp: boolean; status: string; createdAt: string }[];
  suppliers: Record<string, unknown>[];
  pointsOfSale: Record<string, unknown>[];
  carriers: Record<string, unknown>[];
  stockLocations: Record<string, unknown>[];
  boxes: Record<string, unknown>[];
  addons: Record<string, unknown>[];
  sets: Record<string, unknown>[];
  vaultRewardsGiven: Record<string, unknown>[];
  adsEventsFrom: string | null;
  pieceRanges: { year: number; category: string; pieces: number; first: string; last: string }[];
  segmentsGone: string[];
  keys: { keyId: number; kid: string; status: string }[];
}

/** What `orbes_platform_reset` returns (migration 0067 §B.2 d 10). */
export interface ResetResult {
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
  capture: ResetCapture;
}

/** Every number after a reset, for one date (H2). */
export interface ResetNumbers {
  /** The UTC year of issue. */
  year: number;
  /** The first piece reference of each active category for that year: O<yy>-<cat>-00001. */
  pieceReferences: { category: string; name: string; reference: string }[];
  invoice: string;
  creditNote: string;
  partnerInvoice: string;
  partnerCreditNote: string;
  test: string;
}

/** One line of the post-check: OK or failing, with what was found. */
export interface PostCheckLine {
  key: 'chain' | 'key' | 'documents' | 'pieces' | 'numbers' | 'test';
  label: string;
  ok: boolean;
  value: string;
}

export interface ResetRefusal {
  code: string;
  message: string;
}

export interface LastReset {
  at: string;
  by: string | null;
  counts: { wiped: Record<string, number>; kept: Record<string, number>; partly: Record<string, { before: number; after: number }>; collectors: number } | null;
  /** The rows the reset deleted (every wiped table's, and what each partly kept table lost). */
  rowsDeleted: number | null;
  /** Entry 1 of the new chain: its hash is the new anchor. */
  anchor: { id: number; hash: string } | null;
  /** The old chain's last entry, as the reset read it. */
  oldHead: { id: number; hash: string } | null;
  capture: ResetCapture | null;
  postCheck: PostCheckLine[];
}

export type PlatformResetState =
  | { holder: false }
  | {
      holder: true;
      email: string;
      launched: { at: string; by: string | null } | null;
      lastReset: LastReset | null;
      lastFailure: { at: string; reason: string; message: string } | null;
      refusal: ResetRefusal | null;
    };

export interface PlatformResetPreview {
  /** When it was read (ISO). */
  at: string;
  /** The numbers the dialog body states (the same helper as the post-check, H2). */
  numbers: ResetNumbers;
  /** Every table: its class, its rows, how many go and how many stay. */
  tables: { table: string; kind: ResetClass; rows: number; goes: number; stays: number }[];
  rowsToGo: number;
  /** The accounts neither test nor team: how many, their newest sign-ups (Paris), the newest one to the microsecond. */
  collectors: { count: number; signUps: { at: string; paris: string }[] };
  /** What the press sends back (G18). */
  collectorsSeen: number;
  collectorsSeenUntil: string | null;
  testEntrants: number;
  foundingList: number;
  links: { kept: number; wiped: number };
  acquisitionSources: { kept: number };
  partners: { partners: number; experiences: number; invoices: number };
  releases: { id: string; title: string; mode: string; opensAt: string; closesAt: string }[];
  liveOpen: { until: string; message: string } | null;
  lists: ResetCapture;
}

export interface ResetPressInput {
  phrase: unknown;
  password: unknown;
  totp: unknown;
  collectorsSeen: unknown;
  collectorsSeenUntil: unknown;
}

export interface LockPressInput {
  phrase: unknown;
  password: unknown;
  totp: unknown;
}

export interface ResetAsker {
  actor: Actor;
  /** The console session's token: the step-up checks it, it is never stored. */
  token: string;
}

/** What the route hands the lifecycle after its 202. */
export interface ResetRequested {
  adminId: string;
  collectorsSeen: number;
  collectorsSeenUntil: string | null;
  restartsIn: string;
}

export interface PlatformResetServiceDeps {
  db: Db;
  audit: AuditService;
  auth: Pick<AuthService, 'verifyAdminStepUp' | 'consumeAdminStepUp'>;
  clock?: Clock;
  log?: Logger;
}

// ── Numbers ────────────────────────────────────────────────────────────────

/** The first test entrant's name after a reset (TestEntrantService numbers them test-0001, test-0002 …). */
const testName = (n: number) => `test-${String(n).padStart(4, '0')}`;

function resolverOf(categories: readonly CategoryInfo[]): CategoryResolver {
  return {
    byCode: (code) => categories.find((c) => c.code === code),
    byIndex: (index) => categories.find((c) => c.index === index),
  };
}

/**
 * Every number after a reset, computed for `now` (H2): the UTC year of issue, as invoices.ts (`invoiceNumber`) and
 * partners.ts take it, the first piece reference of each active category for that year, as issuance.ts formats it
 * (`formatProductId`), the first INV-, CN-, P- and PC- numbers and the first test entrant. The preview's dialog body
 * and the post-check both read it: a press on 1 January 2027 reads INV-2027-000001.
 */
export function numbersAfterReset(now: Date, categories: readonly CategoryInfo[]): ResetNumbers {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('numbersAfterReset: not a valid instant');
  const year = now.getUTCFullYear();
  const resolver = resolverOf(categories);
  return {
    year,
    pieceReferences: [...categories]
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .map((c) => ({ category: c.code, name: c.name, reference: formatProductId({ year, categoryIndex: c.index, serial: 1 }, resolver) })),
    invoice: invoiceNumber('INVOICE', year, 1),
    creditNote: invoiceNumber('CREDIT_NOTE', year, 1),
    partnerInvoice: partnerInvoiceNumber('INVOICE', year, 1),
    partnerCreditNote: partnerInvoiceNumber('CREDIT_NOTE', year, 1),
    test: testName(1),
  };
}

// ── Words ──────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortHash = (hex: string) => hex.slice(0, 12);

/** The words of a refusal of the console's press, or of the database's authorization or lock (OR011). */
const REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  RESET_NO_HOLDER: 'There is no reset holder: the reset needs an active ADMIN with two-factor authentication.',
  RESET_NOT_HOLDER: 'Only the reset holder can do this.',
  RESET_TEST_RUNNING: 'A test is running. Reset once it has ended.',
  RESET_NOT_AUTHORIZED: 'The confirmation is no longer valid. Confirm again.',
  RESET_LOCKED: 'LOCK RESET was pressed: the reset is refused for good.',
});

/** Why a reset that ran was refused (`platform.reset.failed`'s reason), as the end of a sentence. */
const FAILURE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  RESET_NOT_AUTHORIZED: 'its confirmation was no longer valid',
  RESET_COLLECTORS_CHANGED: 'accounts signed up after the page was read',
  RESET_WINDOW: 'a maintenance window was under way',
  RESET_TEST_RUNNING: 'a test was running',
  RESET_LIVE_OPEN: 'a LIVE room was open',
  RESET_LIVE_ENGINE: 'the LIVE engine was still running',
  RESET_OTHER_CONNECTIONS: 'another connection to the database was open',
  RESET_UNPLANNED_TABLES: 'the database has a table the reset does not know',
  RESET_TRIGGER_DISABLED: 'a guard of the database was off',
  RESET_NOT_SUPERUSER: 'it did not run as the database owner',
  RESET_REPLICA_MODE: 'the database was in replica mode',
  RESET_NO_HOLDER: 'there was no active reset holder',
  RESET_NOT_HOLDER: 'it was not asked by the reset holder',
  RESET_LOCKED: 'LOCK RESET had been pressed',
  RESET_ENTRY_NOT_FIRST: 'its audit entry was not the first of a new log',
});

/** A refused reset's reason (`platform.reset.failed`) in the console's words, as the end of a sentence. */
export function failureWords(reason: string): string {
  if (FAILURE_WORDS[reason]) return FAILURE_WORDS[reason]!;
  if (/check\(s\) failed/.test(reason)) return `a check before the commit failed (${reason})`;
  const state = /^SQLSTATE ([0-9A-Z]{5})$/.exec(reason)?.[1];
  if (state === '57014') return 'the database stopped it after 120 seconds';
  if (state) return `the database stopped it (SQLSTATE ${state})`;
  if (reason.startsWith('SHUTDOWN ')) return `the restart stopped before the reset (${reason.slice('SHUTDOWN '.length)})`;
  return `it stopped (${reason})`;
}

/** The reason recorded in `platform.reset.failed`: the refusal, the failed checks, or the error's SQLSTATE or name. */
export function failureReason(e: unknown): string {
  const refusal = resetRefusal(e);
  if (refusal === 'RESET_PROOF_FAILED') return String((e as { detail?: unknown }).detail ?? refusal).slice(0, 2000);
  if (refusal) return refusal;
  const code = pgError(e)?.code;
  if (code) return `SQLSTATE ${code}`;
  if (e instanceof ResetEntryError) return e.reason;
  return e instanceof Error ? e.name : 'Error';
}

/** Entry 1 was not the new chain's first entry: the reset is rolled back. */
export class ResetEntryError extends Error {
  override readonly name = 'ResetEntryError';
  constructor(readonly reason: string) {
    super(reason);
  }
}

function checkPhrase(typed: unknown, wanted: string): void {
  if (typeof typed !== 'string' || typed.trim().replace(/\s+/g, ' ').toUpperCase() !== wanted) throw validationError(`Type ${wanted} to confirm.`);
}

function assertAdmin(actor: Actor | undefined): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only an ORBES admin can do this.');
  return actor.id.toLowerCase();
}

function seenOf(input: Pick<ResetPressInput, 'collectorsSeen' | 'collectorsSeenUntil'>): { seen: number; until: string | null } {
  const seen = input?.collectorsSeen;
  if (typeof seen !== 'number' || !Number.isSafeInteger(seen) || seen < 0) throw validationError('Reload the page: the count of accounts it showed is missing.');
  const until = input.collectorsSeenUntil;
  if (until === null) return { seen, until: null };
  if (typeof until !== 'string' || !INSTANT_RE.test(until) || Number.isNaN(Date.parse(until))) {
    throw validationError('Reload the page: the time of the newest sign-up it showed is missing.');
  }
  return { seen, until };
}

const notHolder = () => new DomainError('RESET_NOT_HOLDER', 403, REFUSAL_WORDS.RESET_NOT_HOLDER!);

// ── The service ────────────────────────────────────────────────────────────

export class PlatformResetService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly auth: PlatformResetServiceDeps['auth'];
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: PlatformResetServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.auth = deps.auth;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  /** The page's state (see the header): `{ holder: false }` for anyone but the holder. */
  async state(adminId: string, on: Db = this.db): Promise<PlatformResetState> {
    const admin = typeof adminId === 'string' && UUID_RE.test(adminId) ? adminId.toLowerCase() : null;
    const gate = await this.gate(on);
    if (!admin || !gate || gate.holder_admin_id !== admin) return { holder: false };
    const emails = await this.emails(on, [gate.holder_admin_id, gate.launched_by, gate.last_reset_by]);
    const now = this.clock();
    return {
      holder: true,
      email: emails.get(admin) ?? '',
      launched: gate.launched_at ? { at: gate.launched_at.toISOString(), by: gate.launched_by ? (emails.get(gate.launched_by) ?? null) : null } : null,
      lastReset: gate.last_reset_at ? await this.lastReset(on, gate, emails, now) : null,
      lastFailure: await this.lastFailure(on, gate.last_reset_at),
      refusal: await this.refusalNow(on, admin, now),
    };
  }

  /**
   * Whether `adminId` is the reset holder, and nothing else (the console's Settings page shows its link to the holder
   * only): one read of the gate, none of the state's or the preview's work.
   */
  async isHolder(adminId: string): Promise<boolean> {
    const admin = typeof adminId === 'string' && UUID_RE.test(adminId) ? adminId.toLowerCase() : null;
    const gate = await this.gate(this.db);
    return !!admin && !!gate && gate.holder_admin_id === admin;
  }

  /** What a reset would delete and keep (see the header): the holder only; read only, nothing locked or stored. */
  async preview(adminId: string): Promise<PlatformResetPreview> {
    const admin = typeof adminId === 'string' && UUID_RE.test(adminId) ? adminId.toLowerCase() : null;
    const gate = await this.gate(this.db);
    if (!admin || !gate || gate.holder_admin_id !== admin) throw notHolder();
    const now = this.clock();
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      const plan = Object.entries(RESET_PLAN).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const counts = await this.tableCounts(tx, plan.map(([t]) => t));
      const tables = [];
      for (const [table, kind] of plan) {
        const rows = counts.get(table) ?? 0;
        const stays = kind === 'KEEP' ? rows : kind === 'WIPE' ? 0 : Number((await sql.raw<{ count: number | string }>(PARTLY_STAYS[table]!).execute(tx)).rows[0]?.count ?? 0);
        tables.push({ table, kind, rows, goes: rows - stays, stays });
      }
      const collectors = (
        await sql.raw<{ n: number | string; until: string | null }>(
          `SELECT count(*) AS n, ${iso('max(a.created_at)')} AS until FROM accounts a WHERE ${COUNTED('a')}`,
        ).execute(tx)
      ).rows[0]!;
      const signUps = (
        await sql.raw<{ at: Date }>(`SELECT a.created_at AS at FROM accounts a WHERE ${COUNTED('a')} ORDER BY a.created_at DESC, a.id LIMIT ${PREVIEW_SIGN_UPS}`).execute(tx)
      ).rows.map((r) => ({ at: r.at.toISOString(), paris: `${parisDateTime(r.at)} Paris` }));
      const one = async (q: string) => Number((await sql.raw<{ n: number | string }>(q).execute(tx)).rows[0]?.n ?? 0);
      const linksKept = await one(`SELECT count(*) AS n FROM links l WHERE ${LINK_KEPT('l')}`);
      const releases = (
        await sql.raw<{ id: string; title: string; mode: string; opens_at: Date; closes_at: Date }>(
          `SELECT d.id, d.title, d.mode, d.opens_at, d.closes_at FROM drops d
            WHERE d.published_at IS NOT NULL AND d.cancelled_at IS NULL AND d.ended_at IS NULL AND d.closes_at > now()
            ORDER BY d.opens_at, d.id`,
        ).execute(tx)
      ).rows.map((r) => ({ id: r.id, title: r.title, mode: r.mode, opensAt: r.opens_at.toISOString(), closesAt: r.closes_at.toISOString() }));
      const lists = (await sql.raw<{ capture: ResetCapture }>(CAPTURE_SQL).execute(tx)).rows[0]!.capture;
      const n = Number(collectors.n);
      return {
        at: now.toISOString(),
        numbers: numbersAfterReset(now, await this.activeCategories(tx)),
        tables,
        rowsToGo: tables.reduce((sum, t) => sum + t.goes, 0),
        collectors: { count: n, signUps },
        collectorsSeen: n,
        collectorsSeenUntil: n > 0 ? collectors.until : null,
        testEntrants: counts.get('test_entrants') ?? 0,
        foundingList: counts.get('preregistrations') ?? 0,
        links: { kept: linksKept, wiped: (counts.get('links') ?? 0) - linksKept },
        acquisitionSources: { kept: await one(`SELECT count(*) AS n FROM acquisition_sources s WHERE ${SOURCE_KEPT('s')}`) },
        partners: { partners: counts.get('partners') ?? 0, experiences: counts.get('partner_experiences') ?? 0, invoices: counts.get('partner_invoices') ?? 0 },
        releases,
        liveOpen: await this.liveOpen(tx),
        lists,
      };
    });
  }

  /**
   * The post-check after a reset (B5.signin, F17), read only, at `now`: each line OK or failing with what was found.
   * `on` lets a test read it inside its own transaction.
   */
  async postCheck(now: Date = this.clock(), on: Db = this.db): Promise<PostCheckLine[]> {
    const numbers = numbersAfterReset(now, await this.activeCategories(on));
    const year = numbers.year;
    const lines: PostCheckLine[] = [];

    // 1. Entry 1 is the reset's, from the genesis hash, and the chain checks out.
    const entry1 = await on.selectFrom('audit_logs').select(['id', 'action', 'prev_hash', 'hash']).where('id', '=', 1).executeTakeFirst();
    const genesis = toHex(AUDIT_GENESIS_HASH);
    const chain = await (on === this.db ? this.audit : new AuditService({ db: on, clock: this.clock })).verifyChain();
    const entryOk = !!entry1 && entry1.action === 'platform.reset' && toHex(entry1.prev_hash) === genesis;
    lines.push({
      key: 'chain',
      label: 'Audit log: entry 1 links to the start, chain OK',
      ok: entryOk && chain.ok,
      value: !entryOk
        ? entry1
          ? `Entry 1 is ${entry1.action}, not the reset, or does not link to the start.`
          : 'There is no entry 1.'
        : chain.ok
          ? `Entry 1, hash ${shortHash(toHex(entry1!.hash))}; ${plural(chain.checked, 'entry', 'entries')} checked.`
          : `The chain breaks at entry ${chain.firstBadId ?? '?'}.`,
    });

    // 2. Exactly one ACTIVE signing key.
    const active = await on.selectFrom('cryptographic_keys').select(['key_id', 'kid']).where('status', '=', 'ACTIVE').orderBy('key_id').execute();
    lines.push({
      key: 'key',
      label: 'One active signing key',
      ok: active.length === 1,
      value: active.length === 1 ? `Key ${active[0]!.key_id} (${active[0]!.kid}).` : `${active.length} ACTIVE signing keys, expected 1.`,
    });

    // 3. Pieces, invoices and partner invoices: none, or each series from 1.
    const series = async (table: 'products' | 'invoices' | 'partner_invoices') => {
      const groups =
        table === 'products'
          ? (await sql<{ g: string; first: number }>`SELECT year::text || '-' || category_id::text AS g, min(serial)::int AS first FROM products GROUP BY year, category_id`.execute(on)).rows
          : (await sql<{ g: string; first: number }>`SELECT year::text || '-' || kind AS g, min(sequence)::int AS first FROM ${sql.table(table)} GROUP BY year, kind`.execute(on)).rows;
      const rows = Number((await on.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
      return { rows, fromOne: groups.every((x) => Number(x.first) === 1) };
    };
    const docs = { pieces: await series('products'), invoices: await series('invoices'), partnerInvoices: await series('partner_invoices') };
    const docsOk = docs.pieces.fromOne && docs.invoices.fromOne && docs.partnerInvoices.fromOne;
    const none = docs.pieces.rows + docs.invoices.rows + docs.partnerInvoices.rows === 0;
    lines.push({
      key: 'documents',
      label: 'No pieces, no invoices, no partner invoices',
      ok: docsOk,
      value: none
        ? 'None yet.'
        : `${plural(docs.pieces.rows, 'piece', 'pieces')}, ${plural(docs.invoices.rows, 'invoice or credit note', 'invoices and credit notes')}, ${plural(docs.partnerInvoices.rows, 'partner invoice', 'partner invoices')}${docsOk ? ', each series from 1.' : ': a series does not start at 1.'}`,
    });

    // 4. The next piece reference of each active category, for this year (max + 1, as issuance allocates it).
    const resolver = resolverOf((await this.categories(on)).map((c) => ({ code: c.code, index: c.index, name: c.name })));
    const pieceSeries = new Map(
      (await sql<{ category_id: number; first: number; last: number }>`SELECT category_id, min(serial)::int AS first, max(serial)::int AS last FROM products WHERE year = ${year} GROUP BY category_id`.execute(on)).rows.map((r) => [
        Number(r.category_id),
        { first: Number(r.first), last: Number(r.last) },
      ]),
    );
    const nextPieces = numbers.pieceReferences.map((p) => {
      const info = resolver.byCode(p.category)!;
      const s = pieceSeries.get(info.index);
      return { reference: s ? formatProductId({ year, categoryIndex: info.index, serial: s.last + 1 }, resolver) : p.reference, ok: !s || s.first === 1 };
    });
    lines.push({
      key: 'pieces',
      label: 'Next piece references',
      ok: nextPieces.every((p) => p.ok),
      value: nextPieces.length ? nextPieces.map((p) => p.reference).join(', ') : 'No active category.',
    });

    // 5. The next INV-, CN-, P- and PC- numbers for this year.
    const next = async (table: 'invoices' | 'partner_invoices', kind: 'INVOICE' | 'CREDIT_NOTE') => {
      const r = (await sql<{ first: number | null; last: number | null }>`SELECT min(sequence)::int AS first, max(sequence)::int AS last FROM ${sql.table(table)} WHERE year = ${year} AND kind = ${kind}`.execute(on)).rows[0];
      const last = r?.last === null || r?.last === undefined ? 0 : Number(r.last);
      const ok = last === 0 || Number(r!.first) === 1;
      return { number: table === 'invoices' ? invoiceNumber(kind, year, last + 1) : partnerInvoiceNumber(kind, year, last + 1), ok };
    };
    const docNumbers = [await next('invoices', 'INVOICE'), await next('invoices', 'CREDIT_NOTE'), await next('partner_invoices', 'INVOICE'), await next('partner_invoices', 'CREDIT_NOTE')];
    lines.push({ key: 'numbers', label: 'Next numbers', ok: docNumbers.every((d) => d.ok), value: docNumbers.map((d) => d.number).join(', ') });

    // 6. The next test entrant (TestEntrantService numbers from the highest test-NNNN account + 1).
    const tests = (
      await sql<{ first: number | null; last: number | null }>`
        SELECT min(substring(email_normalized from '^test-([0-9]+)@orbes\\.test$')::int) AS first,
               max(substring(email_normalized from '^test-([0-9]+)@orbes\\.test$')::int) AS last
          FROM accounts WHERE email_normalized LIKE 'test-%@orbes.test'`.execute(on)
    ).rows[0];
    const lastTest = tests?.last === null || tests?.last === undefined ? 0 : Number(tests.last);
    lines.push({ key: 'test', label: 'Next test', ok: lastTest === 0 || Number(tests!.first) === 1, value: lastTest === 0 ? numbers.test : testName(lastTest + 1) });
    return lines;
  }

  // ── The press ────────────────────────────────────────────────────────────

  /**
   * RESET PLATFORM pressed (see the header). Refused before anything: 400 for the phrase or the counts, 403
   * RESET_NOT_HOLDER, 409 RESET_LOCKED / RESET_WINDOW / RESET_TEST_RUNNING / LIVE_OPEN / RESET_COLLECTORS_CHANGED /
   * RESET_NO_HOLDER with the console's words, and the step-up's own answers (400, 403, 429; 401 only for an ended
   * session). Nothing is written by a refusal, and the code is consumed only by a request that commits.
   */
  async request(input: ResetPressInput, asker: ResetAsker, meta: ClientMeta = {}): Promise<ResetRequested> {
    const admin = assertAdmin(asker?.actor);
    checkPhrase(input?.phrase, RESET_PHRASE);
    const { seen, until } = seenOf(input);
    await this.precheck(this.db, admin, seen, until);
    const verified = await this.auth.verifyAdminStepUp(
      { adminId: admin, token: asker.token, totp: input.totp, password: input.password, purpose: 'platform.reset', requirePassword: true },
      meta,
    );
    await inTransaction(this.db, async (tx) => {
      await this.auth.consumeAdminStepUp(verified, tx, meta);
      await this.precheck(tx, admin, seen, until);
      await this.audit.record(
        { actor: asker.actor, action: 'platform.reset.requested', targetType: 'admin', targetId: admin, details: { collectorsSeen: seen, collectorsSeenUntil: until } },
        tx,
      );
      await this.authorize(tx, admin, 'platform.reset');
    });
    this.log.warn({ adminId: admin, collectorsSeen: seen }, 'platform reset requested: the platform restarts once the answer is sent');
    return { adminId: admin, collectorsSeen: seen, collectorsSeenUntil: until, restartsIn: RESET_RESTARTS_IN };
  }

  /**
   * LOCK RESET pressed (see the header): allowed in any window (it only makes the platform safer). Refused before
   * anything: 400 for the phrase, 403 RESET_NOT_HOLDER, 409 RESET_LOCKED / RESET_NO_HOLDER, the step-up's answers.
   */
  async lock(input: LockPressInput, asker: ResetAsker, meta: ClientMeta = {}): Promise<{ launched: { at: string; by: string | null } }> {
    const admin = assertAdmin(asker?.actor);
    checkPhrase(input?.phrase, LOCK_PHRASE);
    await this.lockPrecheck(this.db, admin);
    const verified = await this.auth.verifyAdminStepUp(
      { adminId: admin, token: asker.token, totp: input.totp, password: input.password, purpose: 'platform.reset.lock', requirePassword: true },
      meta,
    );
    const at = await inTransaction(this.db, async (tx) => {
      await this.auth.consumeAdminStepUp(verified, tx, meta);
      await this.lockPrecheck(tx, admin);
      await this.audit.record({ actor: asker.actor, action: 'platform.reset.lock.requested', targetType: 'admin', targetId: admin, details: {} }, tx);
      await this.authorize(tx, admin, 'platform.reset.lock');
      let launchedAt: Date;
      try {
        launchedAt = (await sql<{ at: Date }>`SELECT orbes_platform_reset_lock(${admin}::uuid) AS at`.execute(tx)).rows[0]!.at;
      } catch (e) {
        throw this.dbRefusal(e);
      }
      await this.audit.record({ actor: asker.actor, action: 'platform.reset.lock', targetType: 'admin', targetId: admin, details: { at: new Date(launchedAt).toISOString() } }, tx);
      return new Date(launchedAt);
    });
    const email = (await this.emails(this.db, [admin])).get(admin) ?? null;
    return { launched: { at: at.toISOString(), by: email } };
  }

  // ── The reset itself ─────────────────────────────────────────────────────

  /**
   * The reset (see the header), on `conn`: ONE dedicated connection, never the main pool (H13). Resolves with what the
   * function returned and entry 1; rejects (after the ROLLBACK, the authorization cleared and `platform.reset.failed`
   * audited) with the error.
   */
  async run(adminId: string, collectorsSeen: number, collectorsSeenUntil: string | null, conn: Db): Promise<{ result: ResetResult; entry: { id: number; hash: string } }> {
    if (conn === this.db) throw new Error('the platform reset runs on its own dedicated connection, never on the main pool');
    if (conn.isTransaction) throw new Error('the platform reset opens its own transaction');
    if (typeof adminId !== 'string' || !UUID_RE.test(adminId)) throw new Error('the platform reset needs the holder\'s id');
    const admin = adminId.toLowerCase();
    const actor: Actor = { type: 'admin', id: admin };
    const chain = new AuditService({ db: conn, clock: this.clock });
    try {
      return await conn.transaction().execute(async (tx) => {
        await sql.raw(`SET LOCAL statement_timeout = '${RESET_STATEMENT_TIMEOUT}'`).execute(tx);
        const result = (
          await sql<{ r: ResetResult }>`SELECT orbes_platform_reset(${admin}::uuid, ${collectorsSeen}::int, ${collectorsSeenUntil}::timestamptz) AS r`.execute(tx)
        ).rows[0]!.r;
        const entry = await chain.record(
          {
            actor,
            action: 'platform.reset',
            targetType: 'admin',
            targetId: admin,
            details: {
              by: admin,
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
        // The last proof of the app's own: what it wrote is entry 1 of a new chain, from the genesis hash.
        if (entry.id !== 1 || entry.prevHash !== toHex(AUDIT_GENESIS_HASH)) throw new ResetEntryError('RESET_ENTRY_NOT_FIRST');
        return { result, entry: { id: entry.id, hash: entry.hash } };
      });
    } catch (e) {
      const reason = failureReason(e);
      this.log.error({ reason }, 'platform reset refused or failed: rolled back, nothing changed');
      await this.abandon(admin, reason, conn);
      throw e;
    }
  }

  /**
   * A reset that will not run (its run failed, or the shutdown stopped before it): the authorization cleared and
   * `platform.reset.failed { reason }` audited, in its own transaction on `on`. Never throws once it runs (a failure
   * is logged).
   */
  async abandon(adminId: string, reason: string, on: Db): Promise<void> {
    if (on.isTransaction) throw new Error('abandon opens its own transaction');
    try {
      await on.transaction().execute(async (tx) => {
        await sql`SELECT orbes_platform_reset_unauthorize()`.execute(tx);
        await new AuditService({ db: on, clock: this.clock }).record(
          { actor: { type: 'admin', id: adminId }, action: 'platform.reset.failed', targetType: 'admin', targetId: adminId, details: { reason } },
          tx,
        );
      });
    } catch (e) {
      this.log.error({ reason, err: { name: (e as Error)?.name, code: pgError(e)?.code } }, 'platform reset: its failure could not be recorded');
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async gate(on: Db) {
    return on.selectFrom('platform_reset_gate').selectAll().where('id', '=', 1).executeTakeFirst();
  }

  private async emails(on: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
    if (wanted.length === 0) return new Map();
    const rows = await on.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', wanted).execute();
    return new Map(rows.map((r) => [r.id, r.email]));
  }

  private async categories(on: Db): Promise<{ code: string; index: number; name: string; active: boolean }[]> {
    const rows = await on.selectFrom('categories').select(['id', 'code', 'name', 'active']).orderBy('code').execute();
    return rows.map((r) => ({ code: String(r.code).trim(), index: Number(r.id), name: r.name, active: r.active }));
  }

  private async activeCategories(on: Db): Promise<CategoryInfo[]> {
    return (await this.categories(on)).filter((c) => c.active).map((c) => ({ code: c.code, index: c.index, name: c.name }));
  }

  /** Every table's rows, in one statement (the plan's names only, quoted). */
  private async tableCounts(on: Db, tables: readonly string[]): Promise<Map<string, number>> {
    const parts = tables.map((t) => sql`SELECT ${t}::text AS t, count(*) AS n FROM ${sql.table(t)}`);
    const rows = (await sql<{ t: string; n: number | string }>`${sql.join(parts, sql` UNION ALL `)}`.execute(on)).rows;
    return new Map(rows.map((r) => [r.t, Number(r.n)]));
  }

  private async liveOpen(on: Db): Promise<{ until: string; message: string } | null> {
    const r = (await sql.raw<{ until: Date | null }>(`SELECT max(d.closes_at) AS until FROM drops d WHERE ${LIVE_OPEN('d')}`).execute(on)).rows[0];
    if (!r?.until) return null;
    const until = new Date(r.until);
    return { until: until.toISOString(), message: until.getTime() > this.clock().getTime() ? `A LIVE room is open until ${parisWhen(until)}.` : 'A LIVE room is open until its release ends.' };
  }

  private async lastReset(on: Db, gate: NonNullable<Awaited<ReturnType<PlatformResetService['gate']>>>, emails: Map<string, string>, now: Date): Promise<LastReset> {
    const entry1 = await on.selectFrom('audit_logs').select(['id', 'action', 'details', 'hash']).where('id', '=', 1).executeTakeFirst();
    const details = (entry1?.action === 'platform.reset' ? entry1.details : null) as Record<string, any> | null;
    const stored = (gate.last_reset_details ?? null) as Record<string, any> | null;
    const counts = details?.counts && typeof details.counts === 'object' ? (details.counts as LastReset['counts']) : null;
    const rowsDeleted = counts
      ? Object.values(counts.wiped ?? {}).reduce((s, n) => s + Number(n), 0) +
        Object.values(counts.partly ?? {}).reduce((s, p) => s + Math.max(0, Number(p?.before ?? 0) - Number(p?.after ?? 0)), 0)
      : null;
    return {
      at: gate.last_reset_at!.toISOString(),
      by: gate.last_reset_by ? (emails.get(gate.last_reset_by) ?? null) : null,
      counts,
      rowsDeleted,
      anchor: details && entry1 ? { id: Number(entry1.id), hash: toHex(entry1.hash) } : null,
      oldHead: (stored?.oldHead ?? details?.oldHead ?? null) as LastReset['oldHead'],
      capture: (stored?.capture ?? details?.capture ?? null) as ResetCapture | null,
      postCheck: await this.postCheck(now, on),
    };
  }

  private async lastFailure(on: Db, since: Date | null): Promise<{ at: string; reason: string; message: string } | null> {
    let q = on.selectFrom('audit_logs').select(['occurred_at', 'details']).where('action', '=', 'platform.reset.failed');
    if (since) q = q.where('occurred_at', '>', since);
    const row = await q.orderBy('id', 'desc').limit(1).executeTakeFirst();
    if (!row) return null;
    const reason = typeof row.details.reason === 'string' ? row.details.reason : 'unknown';
    return { at: row.occurred_at.toISOString(), reason, message: `The reset of ${parisWhen(row.occurred_at)} was refused: ${failureWords(reason)}. Nothing changed.` };
  }

  /** Why a reset would be refused now (the database's precheck, without the collectors' figures), in words; null when allowed. */
  private async refusalNow(on: Db, admin: string, now: Date): Promise<ResetRefusal | null> {
    const reason = (await sql<{ r: string | null }>`SELECT orbes_platform_reset_precheck(${admin}::uuid, NULL, NULL) AS r`.execute(on)).rows[0]?.r ?? null;
    if (reason === null) return null;
    const e = await this.precheckError(on, reason, now, 0, null);
    return { code: e.code, message: e.publicMessage };
  }

  /** The database's precheck for a reset with what the owner saw: refused with its words, or nothing. */
  private async precheck(on: Db, admin: string, seen: number, until: string | null): Promise<void> {
    const reason = (await sql<{ r: string | null }>`SELECT orbes_platform_reset_precheck(${admin}::uuid, ${seen}::int, ${until}::timestamptz) AS r`.execute(on)).rows[0]?.r ?? null;
    if (reason !== null) throw await this.precheckError(on, reason, this.clock(), seen, until);
  }

  /** LOCK RESET's precheck: the holder, not locked (windows, tests and rooms do not hold it). */
  private async lockPrecheck(on: Db, admin: string): Promise<void> {
    const reason = (await sql<{ r: string | null }>`SELECT orbes_platform_reset_precheck(${admin}::uuid, NULL, NULL) AS r`.execute(on)).rows[0]?.r ?? null;
    if (reason === 'NO_HOLDER' || reason === 'NOT_HOLDER' || reason === 'LOCKED') throw await this.precheckError(on, reason, this.clock(), 0, null);
  }

  private async precheckError(on: Db, reason: string, now: Date, seen: number, until: string | null): Promise<DomainError> {
    switch (reason) {
      case 'NOT_HOLDER':
        return notHolder();
      case 'NO_HOLDER':
        return conflict('RESET_NO_HOLDER', REFUSAL_WORDS.RESET_NO_HOLDER!);
      case 'LOCKED': {
        const g = await this.gate(on);
        return conflict('RESET_LOCKED', g?.launched_at ? `LOCK RESET was pressed on ${parisWhen(g.launched_at)}: the reset is refused for good.` : REFUSAL_WORDS.RESET_LOCKED!);
      }
      case 'WINDOW':
        return conflict('RESET_WINDOW', windowWords(now, MAINTENANCE_MARGIN_MS.reset) ?? 'A maintenance window is under way. Try again in a few minutes.');
      case 'TEST_RUNNING':
        return conflict('RESET_TEST_RUNNING', REFUSAL_WORDS.RESET_TEST_RUNNING!);
      case 'LIVE_OPEN':
        return conflict('LIVE_OPEN', (await this.liveOpen(on))?.message ?? 'A LIVE room is open.');
      case 'COLLECTORS_CHANGED': {
        const r = (
          await sql<{ n: number | string; since: number | string }>`
            SELECT count(*) AS n, count(*) FILTER (WHERE a.created_at > coalesce(${until}::timestamptz, '-infinity'::timestamptz)) AS since
              FROM accounts a WHERE ${sql.raw(COUNTED('a'))}`.execute(on)
        ).rows[0];
        const n = Math.max(1, Number(r?.since ?? 0), Number(r?.n ?? 0) - seen);
        return conflict('RESET_COLLECTORS_CHANGED', `${plural(n, 'account', 'accounts')} signed up since you opened this page. Reload it and check them.`);
      }
      default:
        return conflict(`RESET_${reason}`.replace(/[^A-Z0-9_]/g, '_'), 'The reset cannot run now.');
    }
  }

  /** The single-use authorization, written in the step-up's own transaction (§B.2 g). */
  private async authorize(tx: Db, admin: string, purpose: 'platform.reset' | 'platform.reset.lock'): Promise<void> {
    try {
      await sql`SELECT orbes_platform_reset_authorize(${admin}::uuid, ${purpose})`.execute(tx);
    } catch (e) {
      throw this.dbRefusal(e);
    }
  }

  /** A refusal of 0067's functions (OR011) in the console's words; any other error as it is. */
  private dbRefusal(e: unknown): unknown {
    const reason = resetRefusal(e);
    if (!reason || reason === 'RESET_PROOF_FAILED') return e;
    if (reason === 'RESET_NOT_HOLDER') return notHolder();
    return conflict(reason, REFUSAL_WORDS[reason] ?? 'The reset cannot run now.');
  }
}
