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
 * No audit entry: a heart can be tapped thousands of times a day, and the audit log is permanent and hash-chained; the
 * row is its own record (who, what, when added, when removed). A removed row stays for the figures over time.
 */
import { inTransaction, type Db } from '../db/connection.js';
import { conflict, notFound } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { customerAccountLocked } from './auth.js';
import { tierOf } from './club.js';
import { lookbookNotFound, SLUG_MAX, SLUG_RE } from './lookbook.js';
import { mediaUrl } from './media.js';

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
        await tx.updateTable('account_wishes').set({ removed_at: null }).where('account_id', '=', id).where('model_id', '=', m.id).where('added_at', '=', latest.added_at).execute();
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
