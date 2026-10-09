/**
 * What collectors look at, from which device and place (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.8.3, §3.0 (b)
 * to (d); migration 0042 `collector_views`): the lot's one pipeline. The collector app sends its views to
 * `POST /api/v1/seen` (routes/seen.ts); the device is the existing cookie `__Host-orbes_device`, known here only by its
 * pseudonym `device_hash`, as `scan_events.device_hash` already stores it.
 *
 *   ingest   one batch of views, never thrown. In order: staff (a console session on the request marks the device
 *            `staff_at` and deletes its earlier rows once; a device already marked; an account whose email is a
 *            console login's, HouseAccounts) → dropped; a test entrant's account (TestEntrantAccounts) or an address in
 *            100.64.0.0/10 (the test entrants' networks) → dropped; an automated agent or a prefetch
 *            (http/device-class.ts isAutomated) → dropped; past DEVICE_DAILY_CAP rows a device a Paris day → the rest
 *            dropped. Then the device (one upsert, then an LRU of DEVICE_CACHE_SIZE), the place (PlaceService), and
 *            each event's row (its page code, its subject resolved, `at` = now − ago on the server's clock, its
 *            seconds capped) into the buffer.
 *   buffer   ViewBuffer: the rows wait in memory and are written every BUFFER_FLUSH_MS (at once past
 *            BUFFER_FLUSH_AT rows) in one multi-row INSERT, with one batched UPDATE of the devices' last sight and
 *            place, at most every DEVICE_SEEN_EVERY_MS a device. A flush is put off while the database pool has
 *            requests waiting, so the recording never queues ahead of a collector's request on the shared server.
 *            Past BUFFER_MAX_ROWS the oldest rows are dropped, with one warning a minute. A failed flush keeps its
 *            rows for the next try, within the same bound: the database down, restarting or slow never drops a row
 *            by itself. Only a chunk PostgreSQL refuses for its data (SQLSTATE class 22 or 23) FLUSH_MAX_ATTEMPTS times
 *            in a row is dropped, logged, so one bad row never holds the others back. `stop()` writes what is left at
 *            shutdown.
 *   link     (§3.3 T.8.4) at sign-up (SIGN_UP), sign-in (SIGN_IN) and on a signed-in visit whose device is not linked to
 *            that account yet (SESSION): the device's anonymous rows since its previous link (all of its last 13 months
 *            when it was never linked) take the account. First in memory (`buffer.claim`, so a flush put off during a
 *            release peak never leaves them anonymous), then in one transaction holding the advisory lock
 *            `orbes/views-daily` (the daily job's, so a link and a day's count never cross) and the device row FOR
 *            UPDATE (two sign-ins at once on one device wait for each other): the rows attached, the device's link
 *            (`tracking_device_accounts`, `tracking_devices.account_id`, `linked_at`), then the acquisition's attach
 *            (a hook, a no-op until the acquisition is built). A late row (a batch in flight at the sign-in, sent
 *            without the session) from before the link and after the previous one takes the account too. Never
 *            audited: no person acts, and the sign-up and sign-in are audited already.
 *   recordScan (§3.3 T.8.3, §3.0 (c)) after `POST /api/v1/verify` has answered (routes/public.ts, onResponse): the scan's
 *            SCAN row (page 1, its piece's model, no duration) for its device, in one INSERT … SELECT from
 *            `scan_events`, so an anonymous scan is attached with the browsing at a later sign-up or sign-in. The same
 *            exclusions as the views (a staff scan, ADMIN_TEST, never), best-effort: logged, never thrown, never slowing
 *            the scan's answer. `scan_events`, anomaly scoring and SCAN_RETENTION_DAYS do not change.
 *   prepare  at boot (context.ts): the one `tracking_state` row, the recording's start (`started_at`, the first boot on
 *            this schema), inserted once. Then backfillScans, in the background (start()): the scans of the 13 months
 *            before `started_at` become devices and SCAN rows, by keyset on (occurred_at, id) from the state's
 *            watermark, BACKFILL_BATCH scans a transaction that also moves the watermark, so a crash resumes after the
 *            last batch with no scan written twice or skipped; a short batch marks it done (`scans_backfilled_at`),
 *            and a later boot does nothing. Their class from `user_agent_family` (kind UNKNOWN until a visit), their
 *            place the scan's country, their account `scan_events.account_id` as recorded. Left out as the live scans
 *            are: ADMIN_TEST, a `Bot/` family, a test entrant's account, the team's own account (houseAccount) and a
 *            browser marked staff (before the batch is read, or while it is written).
 *   markStaff  a browser that opened the console is staff's from its first view: its buffered rows go, `staff_at` is
 *            set once, its rows are deleted in batches of STAFF_DELETE_BATCH; the daily totals already counted keep
 *            their few views.
 *
 * Nothing here is audited (§3.0 (m)): views are data, not decisions. Nothing reaches the collector: no word, no
 * screen, and the route answers 204 whatever happened. No third party: the rows stay in this database.
 */
import { BlockList } from 'node:net';
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { pgError } from '../db/pg-errors.js';
import { VIEW_PAGE_CODES, VIEW_PAGES, type LinkVia, type ViewPage } from '../db/schema.js';
import type { ConnectionPlace } from '../geo/place.js';
import { canonicalIp } from '../http/client.js';
import { classifyDevice, clientHintsOf, isAutomated, type DeviceClass } from '../http/device-class.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { normalizeEmail } from './auth.js';
import { SLUG_RE } from './lookbook.js';
import type { PlaceService } from './places.js';
import { houseAccount, HouseAccounts, TestEntrantAccounts } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';

// ── Constants (in code: no new environment variable, §3.3 T.8.3) ─────────────────────────────────────────────────

/** Raw views and scans are kept this many Paris calendar months (the owner's choice), then folded per collector. */
export const VIEW_RETENTION_MONTHS = 13;
/** A view's seconds at most: a screen left open is not a look. */
export const VIEW_MAX_SECONDS = 1_800;
/** A LIVE room's seconds at most: a room is watched without touching. */
export const VIEW_MAX_SECONDS_LIVE = 10_800;
/** A view shorter than this is not recorded: a screen passed through is not a view. */
export const VIEW_MIN_SECONDS = 1;
/** The events of one batch at most. */
export const BATCH_MAX_EVENTS = 50;
/** A view begun this long ago or more (a batch held by an offline phone) is too old to place: dropped. */
export const VIEW_MAX_AGE_MS = 24 * 60 * 60_000;
/** The rows of one device in one Paris day at most: a person never reaches it, a script does. */
export const DEVICE_DAILY_CAP = 2_000;
/** How often the buffer is written. */
export const BUFFER_FLUSH_MS = 2_000;
/** Past this many rows waiting, the buffer is written at once. */
export const BUFFER_FLUSH_AT = 500;
/** The rows the buffer holds at most; past it the oldest are dropped. */
export const BUFFER_MAX_ROWS = 5_000;
/** The rows of one INSERT at most. */
export const BUFFER_INSERT_ROWS = 1_000;
/** A device's `last_seen_at` is written at most this often. */
export const DEVICE_SEEN_EVERY_MS = 10 * 60_000;
/** The devices the cache holds (T.7: ≈ 3 MB). */
export const DEVICE_CACHE_SIZE = 20_000;
/** A device's rows deleted per statement when it is marked staff. */
export const STAFF_DELETE_BATCH = 5_000;
/** The subject maps (published models, releases, circle posts) are read again after this long. */
export const SUBJECT_REFRESH_MS = 5 * 60_000;
/** The pieces' serials the cache holds (serial → model). */
export const PIECE_CACHE_SIZE = 2_000;
/** The past scans turned into devices and SCAN rows per transaction at boot (§3.3 T.11). */
export const BACKFILL_BATCH = 1_000;
/**
 * A chunk PostgreSQL refused for its data (SQLSTATE class 22 or 23) this many flushes in a row is dropped (logged), so
 * one bad row never holds the others back. Any other failure (the database down, restarting, slow) keeps the rows.
 */
export const FLUSH_MAX_ATTEMPTS = 5;

/** Every page the collector app may name: VIEW_PAGES but SCAN, which only the server writes at a scan. */
export const SEEN_PAGES = Object.values(VIEW_PAGES).filter((p): p is Exclude<ViewPage, 'SCAN'> => p !== 'SCAN') as [Exclude<ViewPage, 'SCAN'>, ...Exclude<ViewPage, 'SCAN'>[]];
export type SeenPage = (typeof SEEN_PAGES)[number];

const WARN_EVERY_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A piece's serial as the app shows it, « O26-J-00184 » (services/messages.ts reads the same). */
const SERIAL_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;

/** The test entrants' networks (RFC 6598): their bots act from there, and no collector's phone does. */
const TEST_NETWORKS = (() => {
  const b = new BlockList();
  b.addSubnet('100.64.0.0', 10, 'ipv4');
  return b;
})();

/**
 * The start of the oldest Paris day still kept raw: the same day VIEW_RETENTION_MONTHS calendar months before `now`'s
 * Paris day (the month's last day when it is shorter). On 8 October 2026 the first day kept is 8 September 2025.
 */
export function viewHistoryCutoff(now: Date): Date {
  const [y, m, d] = parisDay(now).split('-').map(Number) as [number, number, number];
  const back = y * 12 + (m - 1) - VIEW_RETENTION_MONTHS;
  const year = Math.floor(back / 12);
  const month = (back % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return parisDayStart(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`);
}

/** Whether an address is in 100.64.0.0/10 (an IPv4-mapped IPv6 address read as its IPv4). */
export function inTestNetwork(ip: string | undefined): boolean {
  const c = canonicalIp(ip);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(c) && TEST_NETWORKS.check(c, 'ipv4');
}

// ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One view the app sends: its page, its subject (a slug, a release or post id, a serial), how long, how long ago it began. */
export interface SeenEvent {
  p: SeenPage;
  s?: string;
  ms: number;
  ago: number;
}

/** `POST /api/v1/seen`'s body (http/schemas.ts seenBody): the device's own words and the views. */
export interface SeenBatch {
  v: 1;
  /** The device: standalone (home screen), touch points, the screen's short side in CSS pixels. */
  d: { s: boolean; t: number; w: number };
  e: readonly SeenEvent[];
}

/** What the route knows of the request (read in memory, never stored but as the class and the place). */
export interface SeenMeta {
  /** pseudonymize(IP_HASH_PEPPER, 'device', id) of the device cookie (http/device.ts ensureDevice). */
  deviceHash: string;
  /** The account session on the request, if any. */
  account: { id: string; email: string } | null;
  /** A console session on the request. */
  staff: boolean;
  ip: string | undefined;
  userAgent: string | null;
  headers: Record<string, string | string[] | undefined>;
  /** The connection's place (geo/place.ts connectionPlace), null without a country. */
  place: ConnectionPlace | null;
  now: Date;
}

export type DropReason = 'STAFF' | 'TEAM' | 'TEST_ENTRANT' | 'TEST_NETWORK' | 'AUTOMATED' | 'CAP' | 'ERROR';

/** What ingest did, for the tests and the logs (the route answers 204 whatever it is). */
export interface IngestOutcome {
  /** Rows put into the buffer. */
  recorded: number;
  dropped?: DropReason;
}

/** A row waiting in the buffer, `collector_views` as it will be written. */
export interface BufferedView {
  at: Date;
  deviceId: number;
  accountId: string | null;
  page: number;
  subject: string | null;
  seconds: number;
  placeId: number | null;
}

export interface FlushResult {
  written: number;
  /** Put off: the pool had requests waiting. */
  deferred: boolean;
  failed: boolean;
}

// ── The buffer ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface ViewBufferDeps {
  db: Db;
  clock: Clock;
  log: Logger;
  /** Whether the database pool has requests waiting (db/connection.ts poolOf … waitingCount > 0); false on PGlite. */
  waiting: () => boolean;
  /** The rows held at most (tests). Default BUFFER_MAX_ROWS. */
  maxRows?: number;
}

/**
 * The rows waiting to be written, in memory, in arrival order. On PGlite (tests, one connection, no pool) nothing is
 * ever waiting, so a flush always runs.
 */
export class ViewBuffer {
  private rows: BufferedView[] = [];
  private readonly seen = new Map<number, { at: Date; place: number | null }>();
  private chain: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private lastFullWarn = -Infinity;
  private lastFailWarn = -Infinity;
  private readonly maxRows: number;

  constructor(private readonly deps: ViewBufferDeps) {
    this.maxRows = Math.max(1, deps.maxRows ?? BUFFER_MAX_ROWS);
  }

  /** How many rows wait. */
  get size(): number {
    return this.rows.length;
  }

  /** The rows waiting, oldest first (tests). */
  peek(): readonly BufferedView[] {
    return this.rows;
  }

  /** Add rows; past the bound the oldest go, with one warning a minute. */
  push(rows: readonly BufferedView[]): void {
    if (rows.length === 0) return;
    this.rows.push(...rows);
    this.trim();
  }

  /** The device was seen at `at` from `place`: written with the next flush (the latest kept). */
  markSeen(deviceId: number, at: Date, place: number | null): void {
    const prev = this.seen.get(deviceId);
    if (!prev || prev.at.getTime() <= at.getTime()) this.seen.set(deviceId, { at, place: place ?? prev?.place ?? null });
  }

  /** The device's buffered rows with no account take `accountId`, at once, in memory. Returns how many. */
  claim(deviceId: number, accountId: string): number {
    let n = 0;
    for (const r of this.rows) {
      if (r.deviceId === deviceId && r.accountId === null) {
        r.accountId = accountId;
        n += 1;
      }
    }
    return n;
  }

  /** Remove the device's buffered rows and its pending sight (a device marked staff). Returns how many rows. */
  dropDevice(deviceId: number): number {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.deviceId !== deviceId);
    this.seen.delete(deviceId);
    return before - this.rows.length;
  }

  /**
   * Write what waits: the rows by INSERTs of up to BUFFER_INSERT_ROWS, then the devices' sights in one UPDATE. Put off
   * while the pool has requests waiting, unless `force` (the shutdown). Flushes run one after another, never two at
   * once. Never thrown.
   */
  flush(opts: { force?: boolean } = {}): Promise<FlushResult> {
    const run = this.chain.then(() =>
      this.flushOnce(opts).catch((e: unknown): FlushResult => {
        this.warnFailure(e);
        return { written: 0, deferred: false, failed: true };
      }),
    );
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Resolves once the flush under way (if any) has ended, without starting one. */
  settled(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  private async flushOnce(opts: { force?: boolean }): Promise<FlushResult> {
    const out: FlushResult = { written: 0, deferred: false, failed: false };
    const waiting = () => !opts.force && this.deps.waiting();
    if (waiting()) return { ...out, deferred: true };
    while (this.rows.length > 0) {
      const chunk = this.rows.slice(0, BUFFER_INSERT_ROWS);
      try {
        await this.deps.db
          .insertInto('collector_views')
          .values(chunk.map((r) => ({ at: r.at, device_id: r.deviceId, account_id: r.accountId, page: r.page, subject: r.subject, seconds: r.seconds, place_id: r.placeId })))
          .execute();
      } catch (e) {
        out.failed = true;
        // Only PostgreSQL refusing the rows themselves counts toward dropping them. The database down, restarting or
        // slow keeps every row for the next try, within BUFFER_MAX_ROWS (§3.3 T.8.3, T.12).
        if (!isDataRejection(e)) {
          this.failures = 0;
          this.warnFailure(e);
          return out;
        }
        this.failures += 1;
        if (this.failures >= FLUSH_MAX_ATTEMPTS) {
          // One bad row would otherwise hold every later one back for good.
          this.remove(chunk);
          this.failures = 0;
          this.deps.log.error({ err: errText(e), rows: chunk.length }, 'views flush failed; rows dropped');
        } else {
          this.warnFailure(e);
        }
        return out;
      }
      this.failures = 0;
      // By identity: rows may have been dropped (a device marked staff, the bound) while the INSERT ran.
      this.remove(chunk);
      out.written += chunk.length;
      if (waiting()) {
        out.deferred = this.rows.length > 0;
        return out;
      }
    }
    if (this.seen.size > 0) {
      const items = [...this.seen].slice(0, BUFFER_INSERT_ROWS);
      for (const [id] of items) this.seen.delete(id);
      try {
        const values = sql.join(items.map(([id, s]) => sql`(${id}::integer, ${s.at}::timestamptz, ${s.place}::integer)`));
        await sql`UPDATE tracking_devices d SET last_seen_at = v.at, last_place_id = coalesce(v.place, d.last_place_id)
          FROM (VALUES ${values}) AS v(id, at, place) WHERE d.id = v.id AND d.last_seen_at < v.at`.execute(this.deps.db);
      } catch (e) {
        for (const [id, s] of items) this.markSeen(id, s.at, s.place);
        out.failed = true;
        this.warnFailure(e);
      }
    }
    return out;
  }

  private remove(written: readonly BufferedView[]): void {
    const done = new Set(written);
    this.rows = this.rows.filter((r) => !done.has(r));
  }

  private trim(): void {
    const over = this.rows.length - this.maxRows;
    if (over <= 0) return;
    this.rows.splice(0, over);
    const now = this.deps.clock().getTime();
    if (now - this.lastFullWarn >= WARN_EVERY_MS) {
      this.lastFullWarn = now;
      this.deps.log.warn({ dropped: over, held: this.rows.length }, 'views buffer full; oldest rows dropped');
    }
  }

  private warnFailure(e: unknown): void {
    const now = this.deps.clock().getTime();
    if (now - this.lastFailWarn < WARN_EVERY_MS) return;
    this.lastFailWarn = now;
    this.deps.log.warn({ err: errText(e), held: this.rows.length }, 'views flush failed; rows kept for the next try');
  }
}

/**
 * Whether PostgreSQL refused the rows themselves: SQLSTATE class 22 (data exception) or 23 (integrity constraint). A
 * connection refused, a timeout or a shutdown is not: those rows are kept for the next try.
 */
export function isDataRejection(e: unknown): boolean {
  const code = pgError(e)?.code;
  return code !== undefined && (code.startsWith('22') || code.startsWith('23'));
}

function errText(e: unknown): { message: string } {
  return { message: e instanceof Error ? e.message : String(e) };
}

// ── Subjects (§3.3 T.8.5) ─────────────────────────────────────────────────────────────────────────────────────

/** A set or map read from the database, read again once SUBJECT_REFRESH_MS old; a failed read is not kept. */
class Snapshot<T> {
  private value: T | null = null;
  private at = 0;
  private reading: Promise<T> | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly clock: Clock,
  ) {}

  async get(): Promise<T> {
    if (this.value !== null && this.clock().getTime() - this.at < SUBJECT_REFRESH_MS) return this.value;
    this.reading ??= this.load()
      .then((v) => {
        this.value = v;
        this.at = this.clock().getTime();
        return v;
      })
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }
}

/**
 * What a view is about: a MODEL's slug → its model (a variant's own slug → the variant), a RELEASE, LIVE or AFTER_ROOM
 * id → a drop, a POST id → a circle post, a PIECE's serial → the piece's model (the serial itself is never stored).
 * Anything unknown is null, and the view is kept without a subject.
 */
export class SubjectResolver {
  private readonly models: Snapshot<ReadonlyMap<string, string>>;
  private readonly drops: Snapshot<ReadonlySet<string>>;
  private readonly posts: Snapshot<ReadonlySet<string>>;
  private readonly pieces = new Map<string, string | null>();

  constructor(
    private readonly db: Db,
    clock: Clock,
  ) {
    this.models = new Snapshot(async () => {
      const rows = await db.selectFrom('models').select(['id', 'slug']).where('slug', 'is not', null).execute();
      return new Map(rows.map((r) => [r.slug!, r.id]));
    }, clock);
    this.drops = new Snapshot(async () => new Set((await db.selectFrom('drops').select('id').execute()).map((r) => r.id)), clock);
    this.posts = new Snapshot(async () => new Set((await db.selectFrom('circle_posts').select('id').execute()).map((r) => r.id)), clock);
  }

  async resolve(page: ViewPage, s: string | undefined): Promise<string | null> {
    if (typeof s !== 'string' || s.length === 0) return null;
    switch (page) {
      case 'MODEL': {
        const slug = s.toLowerCase();
        return SLUG_RE.test(slug) ? ((await this.models.get()).get(slug) ?? null) : null;
      }
      case 'RELEASE':
      case 'LIVE':
      case 'AFTER_ROOM': {
        const id = s.toLowerCase();
        return UUID_RE.test(id) && (await this.drops.get()).has(id) ? id : null;
      }
      case 'POST': {
        const id = s.toLowerCase();
        return UUID_RE.test(id) && (await this.posts.get()).has(id) ? id : null;
      }
      case 'PIECE':
        return SERIAL_RE.test(s) ? this.pieceModel(s.toUpperCase()) : null;
      default:
        return null;
    }
  }

  private async pieceModel(serial: string): Promise<string | null> {
    if (this.pieces.has(serial)) {
      const hit = this.pieces.get(serial)!;
      this.pieces.delete(serial);
      this.pieces.set(serial, hit);
      return hit;
    }
    const row = await this.db.selectFrom('products').select('model_id').where('product_id', '=', serial).executeTakeFirst();
    const model = row?.model_id ?? null;
    this.pieces.set(serial, model);
    while (this.pieces.size > PIECE_CACHE_SIZE) this.pieces.delete(this.pieces.keys().next().value as string);
    return model;
  }
}

// ── The service ────────────────────────────────────────────────────────────────────────────────────────────────

/** What the device cache keeps of a device. */
interface DeviceEntry {
  id: number;
  staff: boolean;
  accountId: string | null;
  linkedAt: Date | null;
  /**
   * The link before `linkedAt`, when this process made the link (null: the device was never linked before; undefined:
   * not known, the entry was read from the row). The late-row rule needs it.
   */
  previousLinkedAt?: Date | null;
  /** The class last written, as a key. */
  cls: string | null;
  /** When `last_seen_at` was last written (ms). */
  seenAt: number;
}

export interface TrackingServiceDeps {
  db: Db;
  places: Pick<PlaceService, 'idOf'>;
  clock?: Clock;
  log?: Logger;
  /** The team's own accounts (services/population.ts); default a HouseAccounts on `db`. */
  houseAccounts?: Pick<HouseAccounts, 'isHouseEmail'>;
  /** The test entrants' accounts; default a TestEntrantAccounts on `db`. */
  testEntrants?: Pick<TestEntrantAccounts, 'has'>;
  /** Whether the database pool has requests waiting; default false (PGlite, tests). context.ts passes the pool's count. */
  waiting?: () => boolean;
  /** The buffer's bound (tests). */
  bufferMaxRows?: number;
  /**
   * The acquisition's attach (§3.4 A.4), run inside the link's transaction: the device's visits take the account, and
   * at a sign-up its first source and SIGNUP conversion are written. A no-op until the acquisition is built (step 4.4).
   */
  attach?: LinkAttach;
}

/** The hook the link runs in its transaction (§3.4 A.7.1 `AcquisitionService.attach`); a failure rolls the link back. */
export type LinkAttach = (tx: Db, deviceId: number, accountId: string, via: LinkVia, now: Date) => Promise<void>;

/** What a sign-up or sign-in knows of its request, for `linkVisit`. */
export interface LinkVisit {
  deviceHash: string;
  accountId: string;
  via: Exclude<LinkVia, 'SESSION'>;
  ip: string | undefined;
  userAgent: string | null;
  headers: Record<string, string | string[] | undefined>;
  now: Date;
}

const classKey = (c: DeviceClass) => `${c.kind}/${c.os}/${c.browser}/${c.openedIn}/${c.inApp ?? ''}`;

export class TrackingService {
  readonly buffer: ViewBuffer;
  readonly subjects: SubjectResolver;
  private readonly db: Db;
  private readonly places: Pick<PlaceService, 'idOf'>;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly houseAccounts: Pick<HouseAccounts, 'isHouseEmail'>;
  private readonly testEntrants: Pick<TestEntrantAccounts, 'has'>;
  private readonly attach: LinkAttach;
  private readonly devices = new Map<string, DeviceEntry>();
  private readonly daily = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** The scans being recorded (after their answer), awaited by idle() and the shutdown. */
  private readonly scans = new Set<Promise<void>>();
  private backfilling: Promise<unknown> | null = null;

  constructor(deps: TrackingServiceDeps) {
    this.db = deps.db;
    this.places = deps.places;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.houseAccounts = deps.houseAccounts ?? new HouseAccounts(deps.db, this.clock);
    this.testEntrants = deps.testEntrants ?? new TestEntrantAccounts(deps.db, this.clock);
    this.attach = deps.attach ?? (async () => {});
    this.buffer = new ViewBuffer({ db: deps.db, clock: this.clock, log: this.log, waiting: deps.waiting ?? (() => false), ...(deps.bufferMaxRows ? { maxRows: deps.bufferMaxRows } : {}) });
    this.subjects = new SubjectResolver(deps.db, this.clock);
  }

  /** Start the buffer's own interval (BUFFER_FLUSH_MS, unref'd). */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.buffer.flush(), BUFFER_FLUSH_MS);
    this.timer.unref();
    // The past scans, in the background: the boot never waits for them (§3.3 T.11).
    this.backfilling ??= this.backfillScans()
      .then((r) => {
        if (r.scans > 0) this.log.info(r, 'past scans recorded');
      })
      .catch((e: unknown) => this.log.error({ err: errText(e) }, 'past scans not recorded; the next boot resumes'));
  }

  /** Resolves once the scans being recorded and the flush under way have ended (the shutdown, the tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.scans]);
    await this.buffer.settled();
  }

  /** Stop the interval and write what is left (the shutdown, before the database closes). Idempotent. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stopped) return;
    this.stopped = true;
    await Promise.all([...this.scans]);
    await this.backfilling;
    const r = await this.buffer.flush({ force: true });
    if (r.failed) this.log.warn({ held: this.buffer.size }, 'views left unwritten at shutdown');
  }

  /** One batch of views from `POST /api/v1/seen` (see the header). Never thrown: a dropped batch is an outcome. */
  async ingest(batch: SeenBatch, meta: SeenMeta): Promise<IngestOutcome> {
    try {
      return await this.admit(batch, meta);
    } catch (e) {
      this.log.error({ err: errText(e) }, 'views ingest failed');
      return { recorded: 0, dropped: 'ERROR' };
    }
  }

  /** Steps 1 to 3 of ingest (§3.0 (d)), the same for a scan: why the request is never recorded, or null. */
  private async excluded(meta: SeenMeta): Promise<DropReason | null> {
    // 1. Staff: a console session marks the device; a device marked, or one of the team's own accounts, is staff's.
    if (meta.staff) {
      await this.markStaff(meta.deviceHash, meta.now);
      return 'STAFF';
    }
    if (this.devices.get(meta.deviceHash)?.staff) return 'STAFF';
    if (meta.account && (await this.houseAccounts.isHouseEmail(emailKey(meta.account.email)))) return 'TEAM';
    // 2. Test entrants: their accounts, their networks.
    if (meta.account && (await this.testEntrants.has(meta.account.id))) return 'TEST_ENTRANT';
    if (inTestNetwork(meta.ip)) return 'TEST_NETWORK';
    // 3. Robots, headless browsers, prefetches.
    if (isAutomated(meta.userAgent, meta.headers)) return 'AUTOMATED';
    return null;
  }

  /** Step 6: a signed-in request on a device not linked to its account links it (SESSION); a failure is only logged. */
  private async sessionLink(meta: SeenMeta, device: DeviceEntry): Promise<DeviceEntry> {
    if (!meta.account || device.accountId === meta.account.id) return device;
    try {
      await this.link(meta.deviceHash, meta.account.id, 'SESSION', meta.now);
    } catch (e) {
      this.log.warn({ err: errText(e) }, 'views session link failed');
    }
    return this.devices.get(meta.deviceHash) ?? device;
  }

  private async admit(batch: SeenBatch, meta: SeenMeta): Promise<IngestOutcome> {
    const { now } = meta;
    const dropped = await this.excluded(meta);
    if (dropped) return { recorded: 0, dropped };
    // 4. The per-device daily cap.
    const events = this.underCap(meta.deviceHash, batch.e, now);
    if (events.length === 0 && batch.e.length > 0) return { recorded: 0, dropped: 'CAP' };
    // 5. The device, with its place (7).
    const placeId = meta.place ? await this.places.idOf(meta.place.country, meta.place.city) : null;
    const cls = classifyDevice({ userAgent: meta.userAgent, hints: clientHintsOf(meta.headers), client: { standalone: batch.d.s, touchPoints: batch.d.t, shortSide: batch.d.w } });
    let device = await this.deviceOf(meta.deviceHash, cls, placeId, now);
    if (device.staff) return { recorded: 0, dropped: 'STAFF' };
    // 6. The session link: a collector signed in before this device was linked to them (a 30-day session) is linked
    // now. A failure is logged and the batch goes on; the next batch tries again.
    device = await this.sessionLink(meta, device);
    // 8. The rows.
    const rows: BufferedView[] = [];
    for (const e of events) {
      const row = await this.rowOf(e, device, meta, placeId);
      if (row) rows.push(row);
    }
    this.buffer.push(rows);
    if (this.buffer.size >= BUFFER_FLUSH_AT) void this.buffer.flush();
    return { recorded: rows.length };
  }

  /** The events within the device's daily cap, counted per Paris day in an LRU as large as the device cache. */
  private underCap(deviceHash: string, events: readonly SeenEvent[], now: Date): readonly SeenEvent[] {
    const key = `${deviceHash}|${parisDay(now)}`;
    const taken = this.daily.get(key) ?? 0;
    const allowed = Math.max(0, Math.min(events.length, DEVICE_DAILY_CAP - taken));
    this.daily.delete(key);
    this.daily.set(key, taken + allowed);
    while (this.daily.size > DEVICE_CACHE_SIZE) this.daily.delete(this.daily.keys().next().value as string);
    return allowed === events.length ? events : events.slice(0, allowed);
  }

  private async rowOf(e: SeenEvent, device: DeviceEntry, meta: SeenMeta, placeId: number | null): Promise<BufferedView | null> {
    const page = e.p as ViewPage;
    if (page === 'SCAN' || !(page in VIEW_PAGE_CODES)) return null;
    if (!(e.ago >= 0) || e.ago >= VIEW_MAX_AGE_MS) return null;
    if (!(e.ms >= VIEW_MIN_SECONDS * 1000)) return null;
    const seconds = Math.min(Math.round(e.ms / 1000), page === 'LIVE' ? VIEW_MAX_SECONDS_LIVE : VIEW_MAX_SECONDS);
    const at = new Date(meta.now.getTime() - e.ago);
    return {
      at,
      deviceId: device.id,
      accountId: meta.account?.id ?? lateAccount(device, at),
      page: VIEW_PAGE_CODES[page as SeenPage],
      subject: await this.subjects.resolve(page, e.s),
      seconds,
      placeId,
    };
  }

  /**
   * The device's id and what is known of it: the cache, else one upsert (`INSERT … ON CONFLICT (device_hash) DO
   * UPDATE`, safe under concurrency) that also writes a class read differently (an updated system) and the place. A
   * cached device's last sight is written by the buffer, at most every DEVICE_SEEN_EVERY_MS.
   */
  private async deviceOf(deviceHash: string, cls: DeviceClass | null, placeId: number | null, now: Date, opts: { classOnInsert?: boolean } = {}): Promise<DeviceEntry> {
    const hit = this.devices.get(deviceHash);
    if (hit && (cls === null || opts.classOnInsert || hit.cls === classKey(cls))) {
      this.devices.delete(deviceHash);
      this.devices.set(deviceHash, hit);
      if (now.getTime() - hit.seenAt >= DEVICE_SEEN_EVERY_MS) {
        this.buffer.markSeen(hit.id, now, placeId);
        hit.seenAt = now.getTime();
      }
      return hit;
    }
    const classCols = cls ? { kind: cls.kind, os: cls.os, browser: cls.browser, opened_in: cls.openedIn, in_app: cls.inApp } : {};
    const row = await this.db
      .insertInto('tracking_devices')
      .values({ device_hash: deviceHash, ...classCols, last_place_id: placeId, first_seen_at: now, last_seen_at: now })
      .onConflict((oc) =>
        oc.column('device_hash').doUpdateSet({
          last_seen_at: sql`greatest(tracking_devices.last_seen_at, excluded.last_seen_at)`,
          last_place_id: sql`coalesce(excluded.last_place_id, tracking_devices.last_place_id)`,
          ...(cls && !opts.classOnInsert
            ? { kind: sql`excluded.kind`, os: sql`excluded.os`, browser: sql`excluded.browser`, opened_in: sql`excluded.opened_in`, in_app: sql`excluded.in_app` }
            : {}),
        }),
      )
      .returning(['id', 'staff_at', 'account_id', 'linked_at'])
      .executeTakeFirstOrThrow();
    const entry: DeviceEntry = {
      id: row.id,
      staff: row.staff_at !== null,
      accountId: row.account_id,
      linkedAt: row.linked_at,
      cls: cls && !opts.classOnInsert ? classKey(cls) : (hit?.cls ?? null),
      seenAt: now.getTime(),
      ...(hit?.previousLinkedAt !== undefined && hit.accountId === row.account_id ? { previousLinkedAt: hit.previousLinkedAt } : {}),
    };
    this.remember(deviceHash, entry);
    return entry;
  }

  private remember(deviceHash: string, entry: DeviceEntry): void {
    this.devices.delete(deviceHash);
    this.devices.set(deviceHash, entry);
    while (this.devices.size > DEVICE_CACHE_SIZE) this.devices.delete(this.devices.keys().next().value as string);
  }

  /**
   * A scan's SCAN row (see the header), once `POST /api/v1/verify` has answered. Never thrown, never awaited by the
   * scan's answer; idle() and the shutdown wait for it.
   */
  recordScan(scanId: string, meta: SeenMeta): Promise<void> {
    const run = this.writeScan(scanId, meta).catch((e: unknown) => this.log.error({ err: errText(e) }, 'scan view not recorded'));
    this.scans.add(run);
    void run.finally(() => this.scans.delete(run));
    return run;
  }

  private async writeScan(scanId: string, meta: SeenMeta): Promise<void> {
    if (await this.excluded(meta)) return;
    const placeId = meta.place ? await this.places.idOf(meta.place.country, meta.place.city) : null;
    const cls = classifyDevice({ userAgent: meta.userAgent, hints: clientHintsOf(meta.headers) });
    let device = await this.deviceOf(meta.deviceHash, cls, placeId, meta.now, { classOnInsert: true });
    if (device.staff) return;
    device = await this.sessionLink(meta, device);
    await sql`INSERT INTO collector_views (at, device_id, account_id, page, subject, seconds, place_id)
      SELECT s.occurred_at, ${device.id}::integer, s.account_id, ${VIEW_PAGE_CODES.SCAN}::smallint, p.model_id, 0, ${placeId}::integer
      FROM scan_events s LEFT JOIN products p ON p.id = s.product_id
      WHERE s.id = ${scanId}::uuid AND s.event_type <> 'ADMIN_TEST'`.execute(this.db);
  }

  /** The one `tracking_state` row, inserted at the first boot on this schema (never by the migration). Returns the recording's start. */
  async prepare(now: Date = this.clock()): Promise<{ startedAt: Date }> {
    await this.db.insertInto('tracking_state').values({ id: 1, started_at: now }).onConflict((oc) => oc.column('id').doNothing()).execute();
    const row = await this.db.selectFrom('tracking_state').select('started_at').where('id', '=', 1).executeTakeFirstOrThrow();
    return { startedAt: row.started_at };
  }

  /**
   * The scans of the 13 months before the recording's start, as devices and SCAN rows (§3.3 T.11; see the header).
   * Resumable and idempotent through `tracking_state`; two processes at once take turns on its row. Stops between
   * batches at shutdown. Returns what it wrote.
   */
  async backfillScans(opts: { batchSize?: number } = {}): Promise<{ batches: number; scans: number; done: boolean }> {
    const size = Math.max(1, Math.floor(opts.batchSize ?? BACKFILL_BATCH));
    const out = { batches: 0, scans: 0, done: false };
    for (;;) {
      const state = await this.db.selectFrom('tracking_state').selectAll().where('id', '=', 1).executeTakeFirst();
      if (!state) throw new Error('tracking_state has no row: prepare() runs first');
      if (state.scans_backfilled_at) return { ...out, done: true };
      if (this.stopped) return out;
      const from = viewHistoryCutoff(state.started_at);
      let q = this.db
        .selectFrom('scan_events as s')
        .leftJoin('products as p', 'p.id', 's.product_id')
        .select(['s.id', 's.occurred_at', 's.device_hash', 's.account_id', 's.country', 's.user_agent_family', 'p.model_id'])
        .where('s.occurred_at', '>=', from)
        .where('s.occurred_at', '<', state.started_at)
        .where('s.device_hash', 'is not', null)
        .where('s.event_type', '<>', 'ADMIN_TEST')
        .where((eb) => eb.or([eb('s.user_agent_family', 'is', null), eb('s.user_agent_family', 'not like', 'Bot/%')]))
        .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = s.account_id)`)
        // The team's own (§3.0 (d)): its accounts, and a browser already marked staff's, as ingest and recordScan drop them.
        .where(sql<boolean>`(s.account_id IS NULL OR NOT (${houseAccount('s.account_id')}))`)
        .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM tracking_devices td WHERE td.device_hash = s.device_hash AND td.staff_at IS NOT NULL)`);
      if (state.scans_after_id) {
        // The watermark is compared in SQL, at the database's own precision (microseconds), never through a JS Date.
        q = q.where(sql<boolean>`(s.occurred_at, s.id) > (SELECT ts.scans_after_at, ts.scans_after_id FROM tracking_state ts WHERE ts.id = 1)`);
      }
      const scans = await q.orderBy('s.occurred_at').orderBy('s.id').limit(size).execute();
      // The places first, outside the transaction (PlaceService reads on its own connection).
      const placeOf = new Map<string, number | null>();
      for (const sc of scans) {
        const country = sc.country?.trim() ?? '';
        if (!placeOf.has(country)) placeOf.set(country, await this.places.idOf(country || null, null));
      }
      const last = scans[scans.length - 1];
      const moved = await inTransaction(this.db, async (tx) => {
        // The watermark read above must still be the row's: another process may have taken this batch meanwhile.
        const now = await tx.selectFrom('tracking_state').selectAll().where('id', '=', 1).forUpdate().executeTakeFirstOrThrow();
        if (now.scans_backfilled_at || now.scans_after_id !== state.scans_after_id) return false;
        if (scans.length > 0) {
          const byDevice = new Map<string, { first: Date; last: Date; family: string | null }>();
          for (const sc of scans) {
            const d = byDevice.get(sc.device_hash!);
            if (!d) byDevice.set(sc.device_hash!, { first: sc.occurred_at, last: sc.occurred_at, family: sc.user_agent_family });
            else {
              d.last = sc.occurred_at;
              d.family = sc.user_agent_family ?? d.family;
            }
          }
          const devices = await tx
            .insertInto('tracking_devices')
            .values([...byDevice].map(([hash, d]) => ({ device_hash: hash, ...familyClass(d.family), first_seen_at: d.first, last_seen_at: d.last })))
            .onConflict((oc) => oc.column('device_hash').doUpdateSet({ last_seen_at: sql`greatest(tracking_devices.last_seen_at, excluded.last_seen_at)` }))
            .returning(['id', 'device_hash', 'staff_at'])
            .execute();
          // A browser marked staff since the batch was read (its row is locked by the upsert above, so a marking either
          // came first and shows here, or waits and then deletes these rows) gets none.
          const idOf = new Map(devices.filter((d) => d.staff_at === null).map((d) => [d.device_hash, d.id]));
          const kept = scans.filter((sc) => idOf.has(sc.device_hash!));
          if (kept.length > 0) {
            await tx
              .insertInto('collector_views')
              .values(
                kept.map((sc) => ({
                  at: sc.occurred_at,
                  device_id: idOf.get(sc.device_hash!)!,
                  account_id: sc.account_id,
                  page: VIEW_PAGE_CODES.SCAN,
                  subject: sc.model_id,
                  seconds: 0,
                  place_id: placeOf.get(sc.country?.trim() ?? '') ?? null,
                })),
              )
              .execute();
          }
        }
        await tx
          .updateTable('tracking_state')
          .set({
            ...(last ? { scans_after_at: sql`(SELECT occurred_at FROM scan_events WHERE id = ${last.id}::uuid)`, scans_after_id: last.id } : {}),
            ...(scans.length < size ? { scans_backfilled_at: this.clock() } : {}),
          })
          .where('id', '=', 1)
          .execute();
        return true;
      });
      if (!moved) continue;
      out.batches += 1;
      out.scans += scans.length;
      if (scans.length < size) return { ...out, done: true };
    }
  }

  /**
   * A sign-up or a sign-in (routes/account.ts, after the account's own transaction): the device linked to the account,
   * unless the request is a test entrant's (its network or its account) or an automated agent's. Awaited by the route,
   * never thrown: a failure is logged and the collector is answered as before; the next signed-in visit links it.
   */
  async linkVisit(v: LinkVisit): Promise<void> {
    try {
      if (inTestNetwork(v.ip) || isAutomated(v.userAgent, v.headers) || (await this.testEntrants.has(v.accountId))) return;
      const cls = classifyDevice({ userAgent: v.userAgent, hints: clientHintsOf(v.headers) });
      await this.link(v.deviceHash, v.accountId, v.via, v.now, cls);
    } catch (e) {
      this.log.error({ err: errText(e), via: v.via }, 'device link failed');
    }
  }

  /**
   * Link the device to the account (see the header, §3.3 T.8.4). `cls` is the request's class, written only when the
   * device is new (a sign-in reads no page, so it never rewrites what the app said). Returns the rows attached. A
   * SESSION link of a device already linked to that account (another batch got there first) changes nothing.
   */
  async link(deviceHash: string, accountId: string, via: LinkVia, now: Date = this.clock(), cls: DeviceClass | null = null): Promise<{ attached: number }> {
    const device = await this.deviceOf(deviceHash, cls, null, now, { classOnInsert: true });
    // 1. The rows still in memory take the account at once; then a best-effort flush (put off while the pool waits:
    // the claimed rows reach the table later already carrying the account, and the sign-in never waits on the pool).
    this.buffer.claim(device.id, accountId);
    await this.buffer.flush();
    const r = await inTransaction(this.db, async (tx) => {
      // 2. The daily job's lock, then the device row: a link and a day's count never cross; two links of one device wait.
      await sql`SELECT pg_advisory_xact_lock(hashtext('orbes/views-daily'))`.execute(tx);
      const d = await tx.selectFrom('tracking_devices').select(['id', 'account_id', 'linked_at']).where('id', '=', device.id).forUpdate().executeTakeFirstOrThrow();
      if (via === 'SESSION' && d.account_id === accountId) return { attached: 0, since: undefined, linkedAt: d.linked_at, skipped: true };
      // 3. Since its previous link, or its whole 13 months when it was never linked. 4. The anonymous rows, scans included.
      const since = d.linked_at;
      const from = since ?? viewHistoryCutoff(now);
      const u = await tx
        .updateTable('collector_views')
        .set({ account_id: accountId })
        .where('device_id', '=', device.id)
        .where('account_id', 'is', null)
        .where('at', '>=', from)
        .executeTakeFirst();
      // 6. The device's link.
      await tx
        .insertInto('tracking_device_accounts')
        .values({ device_id: device.id, account_id: accountId, first_via: via, first_linked_at: now, last_linked_at: now })
        .onConflict((oc) =>
          oc.columns(['device_id', 'account_id']).doUpdateSet({
            links: sql`tracking_device_accounts.links + 1`,
            last_linked_at: sql`greatest(tracking_device_accounts.last_linked_at, excluded.last_linked_at)`,
          }),
        )
        .execute();
      await tx.updateTable('tracking_devices').set({ account_id: accountId, linked_at: now }).where('id', '=', device.id).execute();
      // 7. The acquisition's attach, in the same transaction.
      await this.attach(tx, device.id, accountId, via, now);
      return { attached: Number(u.numUpdatedRows ?? 0), since, linkedAt: now, skipped: false };
    });
    const entry = this.devices.get(deviceHash) ?? device;
    this.remember(deviceHash, { ...entry, accountId, linkedAt: r.linkedAt, ...(r.skipped ? {} : { previousLinkedAt: r.since ?? null }) });
    return { attached: r.attached };
  }

  /**
   * A browser that opened the console is staff's from its first view: its rows still in the buffer go, `staff_at` is
   * set once, and its rows already written are deleted in batches of STAFF_DELETE_BATCH (only the first time). A
   * device marked before is only remembered.
   */
  async markStaff(deviceHash: string, now: Date = this.clock()): Promise<void> {
    if (this.devices.get(deviceHash)?.staff) return;
    const known = await this.db.selectFrom('tracking_devices').select(['id', 'staff_at', 'account_id', 'linked_at']).where('device_hash', '=', deviceHash).executeTakeFirst();
    let id: number;
    if (known?.staff_at) {
      id = known.id;
    } else {
      const row = await this.db
        .insertInto('tracking_devices')
        .values({ device_hash: deviceHash, staff_at: now, first_seen_at: now, last_seen_at: now })
        .onConflict((oc) => oc.column('device_hash').doUpdateSet({ staff_at: sql`coalesce(tracking_devices.staff_at, excluded.staff_at)` }))
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
      // Its rows still in memory go, and an INSERT under way that carries some ends before they are deleted.
      this.buffer.dropDevice(id);
      await this.buffer.settled();
      for (;;) {
        const r = await sql`DELETE FROM collector_views WHERE id IN (SELECT id FROM collector_views WHERE device_id = ${id} LIMIT ${STAFF_DELETE_BATCH})`.execute(this.db);
        if (Number(r.numAffectedRows ?? 0) < STAFF_DELETE_BATCH) break;
      }
    }
    this.buffer.dropDevice(id);
    this.remember(deviceHash, { id, staff: true, accountId: known?.account_id ?? null, linkedAt: known?.linked_at ?? null, cls: null, seenAt: now.getTime() });
  }
}

/**
 * The late-row rule (§3.3 T.8.3): a row sent without a session, from before the device's link made by this process and
 * after its previous one (within its 13 months when it had none), is the linked account's: a batch in flight at the
 * sign-in.
 */
function lateAccount(device: DeviceEntry, at: Date): string | null {
  if (!device.accountId || !device.linkedAt || device.previousLinkedAt === undefined) return null;
  if (at.getTime() >= device.linkedAt.getTime()) return null;
  const from = device.previousLinkedAt ?? viewHistoryCutoff(device.linkedAt);
  return at.getTime() >= from.getTime() ? device.accountId : null;
}

/** A past scan's device class from its `user_agent_family` (« Safari/iOS »): its system and browser, its kind UNKNOWN until a visit. */
function familyClass(family: string | null): { kind: 'UNKNOWN'; os: DeviceClass['os']; browser: DeviceClass['browser'] } {
  const [browser, os] = (family ?? '').split('/');
  const browsers: Record<string, DeviceClass['browser']> = { Safari: 'SAFARI', Chrome: 'CHROME', Firefox: 'FIREFOX', Edge: 'EDGE', Samsung: 'SAMSUNG', Opera: 'OPERA', WebView: 'WEBVIEW' };
  const systems: Record<string, DeviceClass['os']> = { iOS: 'IOS', Android: 'ANDROID', macOS: 'MACOS', Windows: 'WINDOWS', ChromeOS: 'CHROMEOS', Linux: 'LINUX' };
  return { kind: 'UNKNOWN', os: systems[os ?? ''] ?? 'OTHER', browser: browsers[browser ?? ''] ?? 'OTHER' };
}

/** An account's email as `accounts.email_normalized` holds it. */
function emailKey(email: string): string {
  return normalizeEmail(email)?.normalized ?? email.trim().toLowerCase();
}
