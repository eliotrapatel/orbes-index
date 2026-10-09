/**
 * YOUR WISHLIST (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.4, step 2.2; migration 0041 `account_wishes`): the
 * heart on a model's sheet keeps that model, that dot (a main model or a variant, each its own `models` row), in the
 * collector's wishlist. Private: nobody else sees it and no count is shown anywhere in the app.
 *
 *   add      PUT /api/v1/account/wishlist/:slug. The model by its address among those the reader may open now, by the
 *            rule of the sheet (LookbookService.sheetOf): PUBLIC, or RESERVED from its `private_min_tier` for the
 *            account's tier (ClubService tierOf); a discontinued model is allowed; anything else 404
 *            LOOKBOOK_NOT_FOUND. In one transaction holding the account FOR NO KEY UPDATE (two adds of one account
 *            wait for each other; 404 ACCOUNT_NOT_FOUND, 403 ACCOUNT_LOCKED when not ACTIVE): an open wish is returned
 *            as it is; at WISHLIST_MAX open wishes, 409 WISHLIST_FULL; a wish of this model removed less than
 *            WISH_READD_MS ago is reopened (its `removed_at` cleared), so tapping on and off makes no new row;
 *            otherwise a new row, which the partial unique index `account_wishes_open` keeps single.
 *   remove   DELETE …/:slug. The model by its address whatever its place in the lookbook now (a wished model may have
 *            been hidden since); the open wish gets `removed_at`. Idempotent: no open wish, an unknown or malformed
 *            address all answer `{ wished: false, count }`, never whether the address exists.
 *   list     GET …/wishlist: the open wishes, the latest added first, at most WISHLIST_MAX, each `SHOWN` when the
 *            reader may open its sheet now, else `NOT_SHOWN` (HIDDEN, or RESERVED above the reader's tier), which
 *            carries only its address, name, variant and when it was added: no photograph, type or collection
 *            (terms article 12, as THE PRIVATE SALON's teaser).
 *   ofAccount  staff: every open wish with the model's id and its state (SHOWN, HIDDEN, DISCONTINUED, RESERVED), for
 *            the client sheet; read only, staff never edit a wishlist.
 *   exportedWishes  the right of access (OwnerService.exportData, step 2.3): every row still held, removed ones within
 *            their 13 months included, by the model's name and variant, oldest first.
 *
 * The jobs (§3.2 W.7, step 2.4), run by the app's housekeeping in the lot's morning window (services/schedule.ts):
 *
 *   wishMonths   aggregateWishMonths: each complete Paris month not yet in `wish_months_counted`, from the month of the
 *            first wish, one transaction per month: per model with a wish open at some point in it, the wishes added,
 *            removed, and open at its last instant, of ACTIVE counted collectors (services/population.ts: no test
 *            entrant, no team account); then the month is marked counted. A month is counted once; one left
 *            uncommitted by a restart is counted on the next pass.
 *   wishHistory  purgeWishHistory, only when wishMonths succeeded in the same pass: removed wishes older than
 *            WISH_HISTORY_MONTHS Paris months whose month of removal is counted, in batches of 1 000, at most 20 a
 *            pass, each its own short transaction. Open wishes are never purged.
 *
 * No audit entry: a heart can be tapped thousands of times a day, and the audit log is permanent and hash-chained; the
 * row is its own record (who, what, when added, when removed). A removed row stays for the figures over time.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { conflict, notFound } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { customerAccountLocked } from './auth.js';
import { tierOf } from './club.js';
import { lookbookNotFound, SLUG_MAX, SLUG_RE } from './lookbook.js';
import { mediaUrl } from './media.js';
import { countedCollector } from './population.js';
import { parisDay, parisDayStart, parisMonthStart } from './schedule.js';

/** The open wishes of one account at most: a bound for the page, the payload and the table. */
export const WISHLIST_MAX = 200;
/** A wish removed and added again within this time reopens the same row instead of adding one. */
export const WISH_READD_MS = 10 * 60_000;
/** Removed wishes are kept this many Paris months, then purged once their month is counted (the owner's rule). */
export const WISH_HISTORY_MONTHS = 13;

export const wishlistFull = () => conflict('WISHLIST_FULL', `Your wishlist holds up to ${WISHLIST_MAX} models. Remove one to add another.`);

/** A dot's words: its label and colour, or null for a model alone. */
export interface WishVariant {
  label: string;
  swatch: string;
}

/** A wish whose sheet the reader may open now. */
export interface ShownWish {
  state: 'SHOWN';
  slug: string;
  name: string;
  variant: WishVariant | null;
  type: string;
  /** The model's collection's name, or null. */
  collection: string | null;
  imageUrl: string | null;
  discontinuedYear: number | null;
  /** A model of THE PRIVATE SALON. */
  reserved: boolean;
  addedAt: Date;
}

/** A wish the reader may not open now (HIDDEN, or RESERVED above the reader's tier): no photograph, type or collection. */
export interface NotShownWish {
  state: 'NOT_SHOWN';
  slug: string;
  name: string;
  variant: WishVariant | null;
  addedAt: Date;
}

export type WishlistItem = ShownWish | NotShownWish;

/** The model's place for staff (the client sheet): shown, hidden, discontinued, or a salon model. */
export type WishModelState = 'SHOWN' | 'HIDDEN' | 'DISCONTINUED' | 'RESERVED';

/** An open wish as staff read it. */
export interface StaffWish {
  modelId: string;
  name: string;
  variant: WishVariant | null;
  /** The model's collection's name, or null (the client sheet's Collection column, §3.6 C.4.4). */
  collection: string | null;
  addedAt: Date;
  state: WishModelState;
}

export interface WishlistServiceDeps {
  db: Db;
  clock?: Clock;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A model's facts as a wish reads them. */
interface WishModelRow {
  id: string;
  slug: string | null;
  name: string;
  type: string;
  lookbook: string;
  private_min_tier: number;
  discontinued_at: Date | null;
  image_sha256: string | null;
  variant_label: string | null;
  variant_swatch: string | null;
  collection: string | null;
}

/** The address as a sheet reads it (trimmed, lower case), or null when it cannot be one. */
function slugOf(slug: unknown): string | null {
  const key = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  return key.length > 0 && key.length <= SLUG_MAX && SLUG_RE.test(key) ? key : null;
}

function knownAccount(accountId: unknown): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

const variantOf = (r: Pick<WishModelRow, 'variant_label' | 'variant_swatch'>): WishVariant | null =>
  r.variant_label !== null && r.variant_swatch !== null ? { label: r.variant_label, swatch: r.variant_swatch } : null;

/** Whether a reader of `tier` may open the model's sheet now: the rule of LookbookService.sheetOf. */
const shownTo = (r: Pick<WishModelRow, 'slug' | 'lookbook' | 'private_min_tier'>, tier: number): boolean =>
  r.slug !== null && (r.lookbook === 'PUBLIC' || (r.lookbook === 'RESERVED' && tier >= 1 && r.private_min_tier <= tier));

function itemOf(r: WishModelRow, addedAt: Date, tier: number): WishlistItem {
  const slug = r.slug ?? '';
  if (!shownTo(r, tier)) return { state: 'NOT_SHOWN', slug, name: r.name, variant: variantOf(r), addedAt };
  return {
    state: 'SHOWN',
    slug,
    name: r.name,
    variant: variantOf(r),
    type: r.type,
    collection: r.collection,
    imageUrl: mediaUrl(r.image_sha256),
    discontinuedYear: r.discontinued_at ? r.discontinued_at.getUTCFullYear() : null,
    reserved: r.lookbook === 'RESERVED',
    addedAt,
  };
}

/** The models' facts a wish reads, with their collection's name. */
function modelRows(db: Db) {
  return db
    .selectFrom('models as m')
    .leftJoin('collections as col', 'col.id', 'm.collection_id')
    .select(['m.id', 'm.slug', 'm.name', 'm.type', 'm.lookbook', 'm.private_min_tier', 'm.discontinued_at', 'm.image_sha256', 'm.variant_label', 'm.variant_swatch', 'col.name as collection']);
}

/** The account FOR NO KEY UPDATE, ACTIVE: 404 ACCOUNT_NOT_FOUND, 403 ACCOUNT_LOCKED otherwise. */
async function lockAccount(tx: Db, accountId: string): Promise<void> {
  const a = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forNoKeyUpdate().executeTakeFirst();
  if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  if (a.status !== 'ACTIVE') throw customerAccountLocked();
}

async function openCount(db: Db, accountId: string): Promise<number> {
  const r = await db.selectFrom('account_wishes').select((eb) => eb.fn.countAll<number>().as('n')).where('account_id', '=', accountId).where('removed_at', 'is', null).executeTakeFirstOrThrow();
  return Number(r.n);
}

export class WishlistService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: WishlistServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** The heart pressed (PUT): the wish of the model at `slug`, kept open. */
  async add(accountId: string, slug: string): Promise<{ wished: true; item: WishlistItem; count: number }> {
    const id = knownAccount(accountId);
    const key = slugOf(slug);
    if (key === null) throw lookbookNotFound();
    return inTransaction(this.db, async (tx) => {
      await lockAccount(tx, id);
      const now = this.clock();
      const { tier } = await tierOf(tx, id, now);
      // Read in this transaction: a model hidden before it is not found; hidden after, the wish stays.
      const m = await modelRows(tx).where('m.slug', '=', key).executeTakeFirst();
      if (!m || m.lookbook === 'HIDDEN' || !shownTo(m, tier)) throw lookbookNotFound();
      const open = await tx.selectFrom('account_wishes').select('added_at').where('account_id', '=', id).where('model_id', '=', m.id).where('removed_at', 'is', null).executeTakeFirst();
      if (open) return { wished: true as const, item: itemOf(m, open.added_at, tier), count: await openCount(tx, id) };
      // Never past WISHLIST_MAX, a reopened wish included.
      if ((await openCount(tx, id)) >= WISHLIST_MAX) throw wishlistFull();
      const latest = await tx
        .selectFrom('account_wishes')
        .select(['added_at', 'removed_at'])
        .where('account_id', '=', id)
        .where('model_id', '=', m.id)
        .orderBy('added_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      let addedAt: Date;
      if (latest?.removed_at && now.getTime() - latest.removed_at.getTime() < WISH_READD_MS && latest.removed_at.getTime() <= now.getTime()) {
        // The latest row, matched in the database (a timestamp read back loses its microseconds).
        await sql`UPDATE account_wishes SET removed_at = NULL
          WHERE account_id = ${id} AND model_id = ${m.id}
            AND added_at = (SELECT max(l.added_at) FROM account_wishes l WHERE l.account_id = ${id} AND l.model_id = ${m.id})`.execute(tx);
        addedAt = latest.added_at;
      } else {
        await tx
          .insertInto('account_wishes')
          .values({ account_id: id, model_id: m.id, added_at: now })
          .onConflict((oc) => oc.columns(['account_id', 'model_id']).where('removed_at', 'is', null).doNothing())
          .execute();
        const row = await tx.selectFrom('account_wishes').select('added_at').where('account_id', '=', id).where('model_id', '=', m.id).where('removed_at', 'is', null).executeTakeFirstOrThrow();
        addedAt = row.added_at;
      }
      return { wished: true as const, item: itemOf(m, addedAt, tier), count: await openCount(tx, id) };
    });
  }

  /** The heart released (DELETE): the open wish of the model at `slug` removed, whatever the model's place now. */
  async remove(accountId: string, slug: string): Promise<{ wished: false; count: number }> {
    const id = knownAccount(accountId);
    const key = slugOf(slug);
    return inTransaction(this.db, async (tx) => {
      await lockAccount(tx, id);
      if (key !== null) {
        const m = await tx.selectFrom('models').select('id').where('slug', '=', key).executeTakeFirst();
        if (m) await tx.updateTable('account_wishes').set({ removed_at: this.clock() }).where('account_id', '=', id).where('model_id', '=', m.id).where('removed_at', 'is', null).execute();
      }
      return { wished: false as const, count: await openCount(tx, id) };
    });
  }

  /** The open wishes, the latest added first, each SHOWN or NOT_SHOWN for the reader now. */
  async list(accountId: string): Promise<WishlistItem[]> {
    const id = knownAccount(accountId);
    const { tier } = await tierOf(this.db, id, this.clock());
    const rows = await modelRows(this.db)
      .innerJoin('account_wishes as w', 'w.model_id', 'm.id')
      .select('w.added_at')
      .where('w.account_id', '=', id)
      .where('w.removed_at', 'is', null)
      .orderBy('w.added_at', 'desc')
      .orderBy('m.id')
      .limit(WISHLIST_MAX)
      .execute();
    return rows.map((r) => itemOf(r, r.added_at, tier));
  }

  /** Staff (the client sheet): every open wish, the latest first, with the model's id and state. Read only. */
  async ofAccount(accountId: string): Promise<StaffWish[]> {
    const id = knownAccount(accountId);
    const rows = await modelRows(this.db)
      .innerJoin('account_wishes as w', 'w.model_id', 'm.id')
      .select('w.added_at')
      .where('w.account_id', '=', id)
      .where('w.removed_at', 'is', null)
      .orderBy('w.added_at', 'desc')
      .orderBy('m.id')
      .execute();
    return rows.map((r) => ({
      modelId: r.id,
      name: r.name,
      variant: variantOf(r),
      collection: r.collection,
      addedAt: r.added_at,
      state: r.slug === null || r.lookbook === 'HIDDEN' ? 'HIDDEN' : r.discontinued_at !== null ? 'DISCONTINUED' : r.lookbook === 'RESERVED' ? 'RESERVED' : 'SHOWN',
    }));
  }
}

/** A wish in the right-of-access file: the model's name and variant label, when added, and when removed (or null). */
export interface ExportedWish {
  model: string;
  variant: string | null;
  addedAt: Date;
  removedAt: Date | null;
}

/** Every wish row still held for the account, open or removed, oldest first (the right of access, in its transaction). */
export async function exportedWishes(db: Db, accountId: string): Promise<ExportedWish[]> {
  const rows = await db
    .selectFrom('account_wishes as w')
    .innerJoin('models as m', 'm.id', 'w.model_id')
    .select(['m.name', 'm.variant_label', 'w.added_at', 'w.removed_at'])
    .where('w.account_id', '=', accountId)
    .orderBy('w.added_at')
    .orderBy('m.id')
    .execute();
  return rows.map((r) => ({ model: r.name, variant: r.variant_label, addedAt: r.added_at, removedAt: r.removed_at }));
}

// ── The jobs (§3.2 W.7): the monthly summary, then the purge ────────────────

/** The purge's batch and the most batches a pass deletes. */
export const WISH_PURGE_BATCH = 1_000;
export const WISH_PURGE_MAX_BATCHES = 20;

/** The Paris month of an instant, `YYYY-MM`. */
const monthOf = (at: Date): string => parisDay(at).slice(0, 7);

/** The month after `YYYY-MM`. */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${String(y + 1).padStart(4, '0')}-01` : `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * The first instant a removed wish is kept from: 00:00 Paris on the same Paris day WISH_HISTORY_MONTHS months before
 * `now` (the 31st becomes the month's last day).
 */
export function wishHistoryCutoff(now: Date): Date {
  const [y, m, d] = parisDay(now).split('-').map(Number) as [number, number, number];
  const back = y * 12 + (m - 1) - WISH_HISTORY_MONTHS;
  const year = Math.floor(back / 12);
  const month = (back % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return parisDayStart(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`);
}

/** The month before `YYYY-MM`. */
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${String(y - 1).padStart(4, '0')}-12` : `${String(y).padStart(4, '0')}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Job `wishMonths`: each complete Paris month not yet counted, from the month of the first wish up to the month before
 * `now`'s, into `model_wish_months` (counted collectors, ACTIVE accounts) and `wish_months_counted`, one transaction per
 * month. Returns how many months it counted (0 almost every pass: one primary-key read).
 *
 * The months are counted in order, one transaction each, and a pass stops at the first that fails, so the counted
 * months always run unbroken up to the newest one counted: once the last complete month is counted there is nothing to
 * do, and the pass ends on that one primary-key read of `wish_months_counted`, before `account_wishes` is read at all.
 */
export async function aggregateWishMonths(db: Db, now: Date): Promise<number> {
  const current = monthOf(now);
  const done = await db.selectFrom('wish_months_counted').select('month').where('month', '=', `${previousMonth(current)}-01`).executeTakeFirst();
  if (done) return 0;
  const first = await db.selectFrom('account_wishes').select((eb) => eb.fn.min('added_at').as('first')).executeTakeFirst();
  if (!first?.first) return 0;
  let month = monthOf(new Date(first.first as Date | string));
  const counted = new Set((await db.selectFrom('wish_months_counted').select('month').execute()).map((r) => String(r.month).slice(0, 7)));
  let n = 0;
  for (; month < current; month = nextMonth(month)) {
    if (counted.has(month)) continue;
    const day = `${month}-01`;
    const start = parisMonthStart(month);
    const end = parisMonthStart(nextMonth(month));
    await inTransaction(db, async (tx) => {
      await sql`
        INSERT INTO model_wish_months (month, model_id, added, removed, wished_end, counted_at)
        SELECT ${day}::date, w.model_id,
               (count(*) FILTER (WHERE w.added_at >= ${start} AND w.added_at < ${end}))::int,
               (count(*) FILTER (WHERE w.removed_at >= ${start} AND w.removed_at < ${end}))::int,
               (count(*) FILTER (WHERE w.removed_at IS NULL OR w.removed_at >= ${end}))::int,
               ${now}::timestamptz
          FROM account_wishes w
          JOIN accounts a ON a.id = w.account_id
         WHERE w.added_at < ${end}
           AND (w.removed_at IS NULL OR w.removed_at >= ${start})
           AND a.status = 'ACTIVE'
           AND ${countedCollector('w.account_id')}
         GROUP BY w.model_id
        ON CONFLICT (month, model_id) DO UPDATE SET added = EXCLUDED.added, removed = EXCLUDED.removed, wished_end = EXCLUDED.wished_end, counted_at = EXCLUDED.counted_at`.execute(tx);
      await tx.insertInto('wish_months_counted').values({ month: day, counted_at: now }).onConflict((oc) => oc.column('month').doNothing()).execute();
    });
    n++;
  }
  return n;
}

/**
 * Job `wishHistory` (run only after `wishMonths` succeeded in the same pass): the removed wishes older than
 * wishHistoryCutoff whose Paris month of removal is counted, the oldest first, in batches of `batchSize`, at most
 * `maxBatches` a pass, each its own transaction. Open wishes are never touched. Returns how many rows it deleted.
 */
export async function purgeWishHistory(db: Db, now: Date, opts: { batchSize?: number; maxBatches?: number } = {}): Promise<number> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? WISH_PURGE_BATCH));
  const maxBatches = Math.max(1, Math.floor(opts.maxBatches ?? WISH_PURGE_MAX_BATCHES));
  const cutoff = wishHistoryCutoff(now);
  // The counted months before the cut-off, each bounded by it, joined where they follow each other.
  const months = (await db.selectFrom('wish_months_counted').select('month').orderBy('month').execute()).map((r) => String(r.month).slice(0, 7));
  const ranges: { start: Date; end: Date }[] = [];
  for (const month of months) {
    const start = parisMonthStart(month);
    if (start.getTime() >= cutoff.getTime()) break;
    const end = new Date(Math.min(parisMonthStart(nextMonth(month)).getTime(), cutoff.getTime()));
    const last = ranges.at(-1);
    if (last && last.end.getTime() === start.getTime()) last.end = end;
    else ranges.push({ start, end });
  }
  if (ranges.length === 0) return 0;
  const removedIn = sql.join(ranges.map((r) => sql`(removed_at >= ${r.start} AND removed_at < ${r.end})`), sql` OR `);
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const n = await db.transaction().execute(async (trx) => {
      const r = await sql<{ x: number }>`
        DELETE FROM account_wishes
         WHERE (account_id, model_id, added_at) IN (
           SELECT account_id, model_id, added_at FROM account_wishes
            WHERE removed_at IS NOT NULL AND (${removedIn})
            ORDER BY removed_at
            LIMIT ${batchSize})
        RETURNING 1 AS x`.execute(trx);
      return r.rows.length;
    });
    deleted += n;
    if (n < batchSize) break;
  }
  return deleted;
}
