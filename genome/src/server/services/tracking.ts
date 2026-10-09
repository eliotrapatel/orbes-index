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
 *            rows for the next try (a chunk failing FLUSH_MAX_ATTEMPTS times in a row is dropped, logged, so one bad
 *            row never holds the others back). `stop()` writes what is left at shutdown.
 *   markStaff  a browser that opened the console is staff's from its first view: its buffered rows go, `staff_at` is
 *            set once, its rows are deleted in batches of STAFF_DELETE_BATCH; the daily totals already counted keep
 *            their few views.
 *
 * Nothing here is audited (§3.0 (m)): views are data, not decisions. Nothing reaches the collector: no word, no
 * screen, and the route answers 204 whatever happened. No third party: the rows stay in this database.
 */
import { BlockList } from 'node:net';
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import { VIEW_PAGE_CODES, VIEW_PAGES, type ViewPage } from '../db/schema.js';
import type { ConnectionPlace } from '../geo/place.js';
import { canonicalIp } from '../http/client.js';
import { classifyDevice, clientHintsOf, isAutomated, type DeviceClass } from '../http/device-class.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { normalizeEmail } from './auth.js';
import { SLUG_RE } from './lookbook.js';
import type { PlaceService } from './places.js';
import { HouseAccounts, TestEntrantAccounts } from './population.js';
import { parisDay } from './schedule.js';

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
/** A chunk that failed this many flushes in a row is dropped (logged), so one bad row never holds the others back. */
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
        this.failures += 1;
        out.failed = true;
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
  private readonly devices = new Map<string, DeviceEntry>();
  private readonly daily = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(deps: TrackingServiceDeps) {
    this.db = deps.db;
    this.places = deps.places;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.houseAccounts = deps.houseAccounts ?? new HouseAccounts(deps.db, this.clock);
    this.testEntrants = deps.testEntrants ?? new TestEntrantAccounts(deps.db, this.clock);
    this.buffer = new ViewBuffer({ db: deps.db, clock: this.clock, log: this.log, waiting: deps.waiting ?? (() => false), ...(deps.bufferMaxRows ? { maxRows: deps.bufferMaxRows } : {}) });
    this.subjects = new SubjectResolver(deps.db, this.clock);
  }

  /** Start the buffer's own interval (BUFFER_FLUSH_MS, unref'd). */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.buffer.flush(), BUFFER_FLUSH_MS);
    this.timer.unref();
  }

  /** Stop the interval and write what is left (the shutdown, before the database closes). Idempotent. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stopped) return;
    this.stopped = true;
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

  private async admit(batch: SeenBatch, meta: SeenMeta): Promise<IngestOutcome> {
    const { now } = meta;
    // 1. Staff: a console session marks the device; a device marked, or one of the team's own accounts, is staff's.
    if (meta.staff) {
      await this.markStaff(meta.deviceHash, now);
      return { recorded: 0, dropped: 'STAFF' };
    }
    if (this.devices.get(meta.deviceHash)?.staff) return { recorded: 0, dropped: 'STAFF' };
    if (meta.account && (await this.houseAccounts.isHouseEmail(emailKey(meta.account.email)))) return { recorded: 0, dropped: 'TEAM' };
    // 2. Test entrants: their accounts, their networks.
    if (meta.account && (await this.testEntrants.has(meta.account.id))) return { recorded: 0, dropped: 'TEST_ENTRANT' };
    if (inTestNetwork(meta.ip)) return { recorded: 0, dropped: 'TEST_NETWORK' };
    // 3. Robots, headless browsers, prefetches.
    if (isAutomated(meta.userAgent, meta.headers)) return { recorded: 0, dropped: 'AUTOMATED' };
    // 4. The per-device daily cap.
    const events = this.underCap(meta.deviceHash, batch.e, now);
    if (events.length === 0 && batch.e.length > 0) return { recorded: 0, dropped: 'CAP' };
    // 5. The device, with its place (7).
    const placeId = meta.place ? await this.places.idOf(meta.place.country, meta.place.city) : null;
    const cls = classifyDevice({ userAgent: meta.userAgent, hints: clientHintsOf(meta.headers), client: { standalone: batch.d.s, touchPoints: batch.d.t, shortSide: batch.d.w } });
    const device = await this.deviceOf(meta.deviceHash, cls, placeId, now);
    if (device.staff) return { recorded: 0, dropped: 'STAFF' };
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
    return {
      at: new Date(meta.now.getTime() - e.ago),
      deviceId: device.id,
      accountId: meta.account?.id ?? null,
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
  private async deviceOf(deviceHash: string, cls: DeviceClass | null, placeId: number | null, now: Date): Promise<DeviceEntry> {
    const hit = this.devices.get(deviceHash);
    if (hit && (cls === null || hit.cls === classKey(cls))) {
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
          ...(cls
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
      cls: cls ? classKey(cls) : (hit?.cls ?? null),
      seenAt: now.getTime(),
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

/** An account's email as `accounts.email_normalized` holds it. */
function emailKey(email: string): string {
  return normalizeEmail(email)?.normalized ?? email.trim().toLowerCase();
}
