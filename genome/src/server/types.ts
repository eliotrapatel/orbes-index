/**
 * Small shared server types: who acts (Actor), what time it is (Clock), where
 * logs go (Logger) and how lists are paginated (Page<T>).
 *
 * Kept dependency-free so every service, route and test can import it without
 * pulling in the database or Fastify.
 */

// ── Actor ──────────────────────────────────────────────────────────────────

export type ActorType = 'admin' | 'account' | 'system';
export const ACTOR_TYPES: readonly ActorType[] = ['admin', 'account', 'system'];

/**
 * The principal on whose behalf a mutation runs. Every mutating service method
 * takes one and writes it to the audit log. `ipHash` is the peppered HMAC of
 * the client IP (never the raw address).
 */
export interface Actor {
  type: ActorType;
  id?: string;
  ipHash?: string;
}

/** The server itself (migrations, bootstrap, scheduled jobs). */
export const SYSTEM_ACTOR: Readonly<Actor> = Object.freeze({ type: 'system' as const });

export function systemActor(id?: string): Actor {
  return id === undefined ? { type: 'system' } : { type: 'system', id };
}

// ── Clock ──────────────────────────────────────────────────────────────────

/** Injectable time source. Services never call `new Date()` directly so tests can move time. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** A clock tests can set and advance deterministically. */
export interface ManualClock {
  readonly now: Clock;
  set(d: Date | string | number): void;
  advance(ms: number): Date;
}

export function createManualClock(start: Date | string | number = '2026-01-01T00:00:00.000Z'): ManualClock {
  let t = toEpochMs(start);
  return {
    // Return a fresh Date each call so callers can't mutate the clock's state.
    now: () => new Date(t),
    set(d) {
      t = toEpochMs(d);
    },
    advance(ms) {
      if (!Number.isFinite(ms)) throw new RangeError('advance(ms) needs a finite number');
      t += ms;
      return new Date(t);
    },
  };
}

function toEpochMs(d: Date | string | number): number {
  const ms = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d);
  if (!Number.isFinite(ms)) throw new RangeError('invalid clock time');
  return ms;
}

// ── Logger ─────────────────────────────────────────────────────────────────

type LogFn = (o: object | string, m?: string) => void;

/** Structural subset of pino (Fastify's logger) so `app.log` can be passed straight in. */
export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

export const noopLogger: Logger = Object.freeze({
  info: () => {},
  warn: () => {},
  error: () => {},
});

// ── Pagination ─────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  page: number;      // 1-based
  pageSize: number;  // 1..MAX_PAGE_SIZE
}

/** Paginated list response body: `{ items, page, pageSize, total }`. */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Normalise `?page=&pageSize=` query values (strings, numbers or absent).
 * Lenient on purpose: garbage falls back to defaults and sizes are clamped,
 * because a bad page parameter should never become a 500 or an unbounded scan.
 */
export function pageRequest(input: { page?: unknown; pageSize?: unknown } = {}): PageRequest {
  const page = toPositiveInt(input.page) ?? 1;
  const size = toPositiveInt(input.pageSize) ?? DEFAULT_PAGE_SIZE;
  return { page, pageSize: Math.min(size, MAX_PAGE_SIZE) };
}

/** Row offset for a page request. */
export function pageOffset(req: PageRequest): number {
  return (req.page - 1) * req.pageSize;
}

export function makePage<T>(items: T[], total: number, req: PageRequest): Page<T> {
  return { items, page: req.page, pageSize: req.pageSize, total };
}

/** Map the items of a page, keeping its metadata. */
export function mapPage<T, U>(page: Page<T>, fn: (item: T) => U): Page<U> {
  return { ...page, items: page.items.map(fn) };
}

// Pages beyond this are refused by clamping: OFFSET cost grows linearly in Postgres.
const MAX_PAGE_NUMBER = 1_000_000;

function toPositiveInt(v: unknown): number | undefined {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\s*\d{1,9}\s*$/.test(v)) n = Number(v);
  else return undefined;
  if (!Number.isSafeInteger(n) || n < 1) return undefined;
  return Math.min(n, MAX_PAGE_NUMBER);
}
