/**
 * ORBES Smart Model's export (lot EXPORT SMART MODEL, the owner's decision of 31 Oct 2026): what has been sold, read for
 * ORBES Smart Model (Cloudflare) every hour, without SSH and without the Mac. GET /api/export/v1/smart-model
 * (routes/export.ts) answers exactly what the Mac's orbes-sync.mjs v1.2.0 sends (format orbes-console/2), in pages.
 *
 *   - The query is the script's, as it is (services/smart-model-sql.ts): ONE `REPEATABLE READ READ ONLY` transaction on
 *     one connection of the pool, statement_timeout 60 s and lock_timeout 2 s, ended by ROLLBACK. Nothing is written,
 *     no table or migration is added. Its LIVE guard (the DO block) raises ORBES-SYNC-LIVE while a LIVE release is open
 *     or about to open: `SmartModelExportError('live')`.
 *   - Then, here, as the script's `pseudonymize`: every account and order id becomes an HMAC-SHA-256 fingerprint keyed by
 *     SMART_MODEL_EXPORT_KEY (`key`, `customer`, 22 base64url characters), the order keeps a short reference (`ref`), the
 *     account's email is trimmed and lower-cased, and no uuid may remain outside `models` and `email`.
 *   - The sales are cut into pages of SMART_MODEL_PAGE_SALES, kept in memory as a snapshot for SMART_MODEL_SNAPSHOT_MS:
 *     page 0 reads the database, the next pages are served from the snapshot (`snapshot` id). One process, a Map.
 *   - One reading at a time: another page 0 meanwhile is `busy`. A reading the edge would cut (Caddy waits 35 s for a
 *     response) answers `busy` after SMART_MODEL_ANSWER_WITHIN_MS and goes on; the copy it reads is kept for
 *     SMART_MODEL_READY_MS and becomes the snapshot of the next page 0 for the same day.
 *   - Never in the server's night, 04:00–06:30 Paris (`night`), as the script.
 *
 * Personal data: the account's email (the owner's choice: a customer is the same on the console and on Shopify when the
 * email is the same) and nothing else: the query reads no name, address, phone, engraving, note, tracking number or date
 * of birth. Test accounts are left out, the team's accounts are kept (the query's rules).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { Clock } from '../types.js';
import { PARIS_TIME_ZONE } from './schedule.js';
import { SMART_MODEL_SQL, SMART_MODEL_SQL_VERSION } from './smart-model-sql.js';

export const SMART_MODEL_FORMAT = 'orbes-console/2';
/** At most this many sales a page (the contract). */
export const SMART_MODEL_PAGE_SALES = 1_000;
/** How long a snapshot's pages stay readable (the contract: 10 minutes, then forgotten: 410). */
export const SMART_MODEL_SNAPSHOT_MS = 10 * 60_000;
/** The snapshots kept at most (Smart Model reads one an hour). */
export const SMART_MODEL_SNAPSHOTS_MAX = 4;
/** Page 0 answers within this time, or `busy` while its reading goes on (Caddy's response_header_timeout is 35 s). */
export const SMART_MODEL_ANSWER_WITHIN_MS = 25_000;
/** How long a reading finished after its page 0 answered `busy` waits for the next page 0 (Smart Model comes back 15 minutes later). */
export const SMART_MODEL_READY_MS = 20 * 60_000;

export type SmartModelRefusal = 'live' | 'night' | 'busy' | 'snapshot';

export class SmartModelExportError extends Error {
  constructor(readonly reason: SmartModelRefusal) {
    super(`smart model export refused: ${reason}`);
  }
}

/** A real calendar day, written YYYY-MM-DD (the script's validDay). */
export const validDay = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** 04:00 to 06:30 in Paris: the server's night (the script's nightWindow). */
export function nightWindow(at: Date): boolean {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(at)
    .split(':')
    .map(Number) as [number, number];
  const t = h * 60 + m;
  return t >= 4 * 60 && t < 6 * 60 + 30;
}

/**
 * The script's statements, in order: BEGIN … READ ONLY, the three SET LOCALs, the LIVE guard, the query, ROLLBACK. A
 * statement ends with the line that ends with `;` outside a comment and outside the DO block's `$$` (the query has no
 * comment after code on a line).
 */
export function statementsOf(text: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];
  let dollar = false;
  for (const line of text.split('\n')) {
    current.push(line);
    const code = line.trim();
    if (code.startsWith('--')) continue;
    if ((code.match(/\$\$/g)?.length ?? 0) % 2 === 1) dollar = !dollar;
    if (!dollar && code.endsWith(';')) {
      statements.push(current.join('\n').trim());
      current = [];
    }
  }
  if (current.join('\n').trim() !== '') throw new Error('smart model query: text after its last statement');
  return statements;
}

const STATEMENTS = statementsOf(SMART_MODEL_SQL);
/** BEGIN … READ ONLY;, the SET LOCALs, the LIVE guard and the query; ROLLBACK is run apart, whatever happened. */
const READ_STATEMENTS = (() => {
  const [begin, ...rest] = STATEMENTS;
  const rollback = rest.pop();
  if (begin !== 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' && !begin?.endsWith('\nBEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;')) {
    throw new Error('smart model query: it must begin a read-only transaction');
  }
  if (rollback !== 'ROLLBACK;' || rest.length !== 5) throw new Error('smart model query: unexpected statements');
  return [begin, ...rest];
})();

/** The query's statements for sales paid from `since` (a Paris day): the only value put into it, checked first. */
export function readStatements(since: string): string[] {
  if (!validDay(since)) throw new RangeError('since must be a day written YYYY-MM-DD');
  return READ_STATEMENTS.map((s) => s.replaceAll('__SINCE__', since));
}

/** What the query answers (the line after ORBES-SYNC-JSON:). */
export interface SmartModelRaw {
  format: string;
  since: string;
  dbNow: string | null;
  rates: unknown[];
  models: unknown[];
  stock?: unknown;
  sales: Array<Record<string, unknown> & { order: string; account: string; email: unknown }>;
}

/** Runs the script's query on one connection, in its read-only transaction, always ended by ROLLBACK. */
export async function readSmartModel(db: Db, since: string): Promise<SmartModelRaw> {
  const statements = readStatements(since);
  return db.connection().execute(async (conn) => {
    let out: unknown;
    try {
      for (const statement of statements) {
        const r = await sql.raw<{ out: string }>(statement).execute(conn);
        if (r.rows[0]?.out !== undefined) out = r.rows[0].out;
      }
    } catch (err) {
      if (/ORBES-SYNC-LIVE/.test((err as Error).message ?? '')) throw new SmartModelExportError('live');
      throw err;
    } finally {
      await sql.raw('ROLLBACK').execute(conn);
    }
    const line = typeof out === 'string' && out.startsWith('ORBES-SYNC-JSON:') ? out.slice('ORBES-SYNC-JSON:'.length) : null;
    if (line === null) throw new Error('smart model query: no ORBES-SYNC-JSON line');
    const raw = JSON.parse(line) as SmartModelRaw;
    if (raw?.format !== SMART_MODEL_FORMAT || !Array.isArray(raw.sales) || !Array.isArray(raw.models) || !Array.isArray(raw.rates)) {
      throw new Error('smart model query: unknown format');
    }
    return raw;
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** HMAC-SHA-256 keyed by SMART_MODEL_EXPORT_KEY (64 hex), 22 base64url characters: the script's fingerprint. */
export const fingerprint = (key: string, kind: 'order' | 'account', id: string): string =>
  createHmac('sha256', Buffer.from(key, 'hex')).update(`${kind}:${id}`).digest('base64url').slice(0, 22);

export interface SmartModelCopy {
  meta: Record<string, unknown> & { totalSales: number };
  sales: Array<Record<string, unknown>>;
}

/** The script's `pseudonymize`: every account and order id replaced by its fingerprint, the reference kept for display. */
export function pseudonymize(raw: SmartModelRaw, hmacKey: string, now: Date): SmartModelCopy {
  if (!/^[0-9a-f]{64}$/.test(hmacKey)) throw new Error('the fingerprint key is missing or malformed');
  const sales = raw.sales.map((s) => {
    if (!UUID.test(s.order) || !UUID.test(s.account)) throw new Error('the query sent a sale without its ids');
    const { order, account, email, ...rest } = s;
    const mail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
    return { ref: `OR-${order.replace(/-/g, '').slice(0, 8).toUpperCase()}`, key: fingerprint(hmacKey, 'order', order), customer: fingerprint(hmacKey, 'account', account), email: mail, ...rest };
  });
  const meta = {
    format: SMART_MODEL_FORMAT,
    since: raw.since,
    extractedAt: now.toISOString(),
    dbNow: raw.dbNow ?? null,
    rates: raw.rates,
    models: raw.models,
    totalSales: sales.length,
    tool: SMART_MODEL_SQL_VERSION,
    ...(raw.stock ? { stock: raw.stock } : {}),
  };
  assertNoRawIds(sales);
  return { meta, sales };
}

/** Belt and braces (the script's): no uuid anywhere in the sales except the catalogue's model ids and the emails. */
export function assertNoRawIds(sales: ReadonlyArray<Record<string, unknown>>): void {
  for (const s of sales) {
    const { models, email: _email, ...rest } = s;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(rest))) throw new Error(`a raw id would leave the console (sale ${String(s.ref)})`);
    if (!Object.keys((models as object | null) ?? {}).every((k) => UUID.test(k))) throw new Error('unexpected model ids');
  }
}

/** The sales cut into pages of SMART_MODEL_PAGE_SALES, in the query's order (one empty page when there is none). */
export function pagesOf<T>(sales: readonly T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < sales.length; i += SMART_MODEL_PAGE_SALES) pages.push(sales.slice(i, i + SMART_MODEL_PAGE_SALES));
  return pages.length ? pages : [[]];
}

export type SmartModelPage =
  | { ok: true; format: string; snapshot: string; page: 0; pages: number; meta: SmartModelCopy['meta']; sales: Array<Record<string, unknown>> }
  | { ok: true; format: string; snapshot: string; page: number; pages: number; sales: Array<Record<string, unknown>> };

interface Snapshot {
  meta: SmartModelCopy['meta'];
  pages: Array<Array<Record<string, unknown>>>;
  expiresAt: number;
}

export interface SmartModelExportDeps {
  db: Db;
  clock: Clock;
  /** SMART_MODEL_EXPORT_KEY (64 hex). */
  hmacKey: string;
  /** The reading (default: the script's query); tests slow it down. */
  read?: (since: string) => Promise<SmartModelRaw>;
}

/** The export's state in this process: the reading in progress, the snapshots, a copy read after its page 0 answered. */
export class SmartModelExport {
  private readonly snapshots = new Map<string, Snapshot>();
  private reading: Promise<SmartModelCopy> | null = null;
  private ready: { since: string; copy: SmartModelCopy; until: number } | null = null;
  read: (since: string) => Promise<SmartModelRaw>;

  constructor(private readonly deps: SmartModelExportDeps) {
    this.read = deps.read ?? ((since) => readSmartModel(deps.db, since));
  }

  private now(): number {
    return this.deps.clock().getTime();
  }

  /** Page `page` of the snapshot `snapshot` (page > 0), or a new snapshot's page 0. */
  async page(input: { since: string; page: number; snapshot?: string }): Promise<SmartModelPage> {
    const now = this.now();
    if (nightWindow(new Date(now))) throw new SmartModelExportError('night');
    for (const [id, s] of this.snapshots) if (s.expiresAt <= now) this.snapshots.delete(id);
    if (input.page > 0) {
      const s = input.snapshot === undefined ? undefined : this.snapshots.get(input.snapshot);
      if (!s || s.meta.since !== input.since || input.page >= s.pages.length) throw new SmartModelExportError('snapshot');
      return { ok: true, format: SMART_MODEL_FORMAT, snapshot: input.snapshot!, page: input.page, pages: s.pages.length, sales: s.pages[input.page]! };
    }
    const copy = await this.copyFor(input.since);
    const id = randomBytes(16).toString('base64url');
    const pages = pagesOf(copy.sales);
    this.snapshots.set(id, { meta: copy.meta, pages, expiresAt: now + SMART_MODEL_SNAPSHOT_MS });
    while (this.snapshots.size > SMART_MODEL_SNAPSHOTS_MAX) this.snapshots.delete(this.snapshots.keys().next().value!);
    return { ok: true, format: SMART_MODEL_FORMAT, snapshot: id, page: 0, pages: pages.length, meta: copy.meta, sales: pages[0]! };
  }

  /** A copy for page 0: the one read after a `busy` answer for the same day, or a new reading (one at a time). */
  private async copyFor(since: string): Promise<SmartModelCopy> {
    const ready = this.ready;
    if (ready && ready.since === since && ready.until > this.now()) {
      this.ready = null;
      return ready.copy;
    }
    if (this.reading) throw new SmartModelExportError('busy');
    const reading = this.read(since).then((raw) => pseudonymize(raw, this.deps.hmacKey, new Date(this.now())));
    this.reading = reading;
    let answered = false;
    reading.then(
      (copy) => {
        if (answered) this.ready = { since, copy, until: this.now() + SMART_MODEL_READY_MS };
      },
      () => {},
    ).finally(() => {
      if (this.reading === reading) this.reading = null;
    });
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), SMART_MODEL_ANSWER_WITHIN_MS);
      timer.unref?.();
    });
    try {
      const first = await Promise.race([reading, late]);
      if (first === 'late') {
        answered = true;
        throw new SmartModelExportError('busy');
      }
      return first;
    } finally {
      clearTimeout(timer);
    }
  }
}
