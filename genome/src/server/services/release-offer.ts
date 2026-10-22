/**
 * What a release sells (migration 0057, macro scope K44 T1; lot M3 plan §5.2, steps M3.13 and M3.14): a model, or a set
 * of 2 to 4 models (`drops_one_offer`, exactly one of `drops.model_id` and `drops.set_id`). `releaseOffer` reads either
 * as one shape, its pieces in order: a model's release has one piece (`piece` null), a set's release one per model of
 * the set (`piece` 1..4, `set_models.position`), so a reader that means « the release's model » reads every piece and
 * never attributes a set's release to one of its models.
 *
 * Every reader of a release's model, by what it does with a set's release (plan §5.2, « the compiler's list »):
 *
 *   KEPT in full (a set's release is a release like any, T1)
 *     - the CAMPAIGN tab (services/campaign.ts, C1 to C3): its links per channel in one click, the readout per link
 *       (entries, buyers, revenue, cost and return), the `.ics` link; its `offer` gives the countdown image the set's
 *       name and each piece's photograph and name (TEASER by default, FULL with the photographs side by side);
 *     - GROWTH (services/growth.ts): a set's release in `releases()` like any (its sets sold), a set sale's revenue
 *       counted by release and by each piece's order with its share (§15 note 11), never under one model.
 *   EXCLUDED
 *     - the model's releases on its sheet (services/past-releases.ts `modelReleases`): a set's release is listed under
 *       its set (Catalogue → Sets, services/sets.ts `releases`), never under one of its models;
 *     - the house's guarantees (services/guarantees.ts): never bound to a set's release, never granted for one;
 *     - the after-rooms (services/live-console.ts, services/after-room.ts): a set's release is never one (the CHECK
 *       `drops_set_no_after_room`) and never has one (409 AFTER_ROOM_SET); an after-room reads its model through
 *       `afterRoomModelId`.
 *   ADAPTED
 *     - PAST (services/past-releases.ts `page`): a set's release is its own entry, under its set's name, its pieces'
 *       names and photographs at their stages;
 *     - the planner (services/live-insights.ts `plan`): per piece, each piece's model's demand for the release's sets;
 *     - test entrants (services/test-entrants.ts): each bot chooses a size per piece.
 *   SET-AWARE (the release's flows)
 *     - the orders of an entry (services/orders.ts `ordersForLiveEntry`, `orderForDrawEntry`): a set's entry makes its
 *       set sales (services/set-sales.ts `ordersForSetSale`); the SKU of a release's size (services/stock.ts
 *       `linkDropSizes`): its piece's model's; the size YOUR SIZES preselects (services/drops.ts `entryFor`,
 *       services/live-room.ts `savedSizes`): one per piece;
 *     - the draw's own flows (services/drops.ts, M3.15): created with its set and its sizes per piece, its entries' sizes
 *       per piece, the fill and OFFER NEXT by every size, its public page's and the console's `set` (the set itself in
 *       the card's `model`, never one of its models);
 *     - the LIVE RELEASE's own flows (services/live.ts, live-room.ts, live-console.ts, release-stock.ts, live-insights.ts,
 *       test-entrants.ts, M3.16): created with its set and its sizes per piece, I'LL BE THERE, ENTER and CHANGE SIZE with a
 *       size per piece, the turns by every size, its sets per person (T4), PAY's set sales, its sell-out by sets, ADD
 *       PIECES per piece's size, its feasibility, size mix and boards per piece; its public and console views carry `set`
 *       (the set itself in the card's `model`, never one of its models).
 */
import type { Db } from '../db/connection.js';
import type { SizeKind, SizeType } from '../db/schema.js';
import { mediaUrl } from './media.js';
import { savedSizeAmong, type SizeCandidate } from './sizes.js';

/** A model as a release's piece reads it. */
export interface OfferModel {
  id: string;
  name: string;
  /** Its label among its main model's variants (« Blue »), or null. */
  variant: string | null;
  variantOf: string | null;
  type: string;
  active: boolean;
  sizeType: SizeType | null;
  sizeKind: SizeKind | null;
  /** Its reference photograph's media route (`/api/v1/media/<sha256>`), or null. */
  imageUrl: string | null;
  slug: string | null;
  lookbook: string;
  collectionId: string | null;
}

/** One piece of what a release sells: its position in the set (null on a model's release) and its model. */
export interface ReleasePiece {
  piece: number | null;
  model: OfferModel;
}

/** A release's set: its name, code and whether it is offered. */
export interface OfferSet {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export type ReleaseOffer =
  | { kind: 'MODEL'; modelId: string; set: null; pieces: [ReleasePiece] }
  | { kind: 'SET'; modelId: null; set: OfferSet; pieces: ReleasePiece[] };

const MODEL_COLUMNS = [
  'm.id',
  'm.name',
  'm.variant_label',
  'm.variant_of',
  'm.type',
  'm.active',
  'm.size_type',
  'm.size_kind',
  'm.image_sha256',
  'm.slug',
  'm.lookbook',
  'm.collection_id',
] as const;

type ModelRow = {
  id: string;
  name: string;
  variant_label: string | null;
  variant_of: string | null;
  type: string;
  active: boolean;
  size_type: SizeType | null;
  size_kind: SizeKind | null;
  image_sha256: string | null;
  slug: string | null;
  lookbook: string;
  collection_id: string | null;
};

const modelOf = (m: ModelRow): OfferModel => ({
  id: m.id,
  name: m.name,
  variant: m.variant_label,
  variantOf: m.variant_of,
  type: m.type,
  active: m.active,
  sizeType: m.size_type,
  sizeKind: m.size_kind,
  imageUrl: mediaUrl(m.image_sha256),
  slug: m.slug,
  lookbook: m.lookbook,
  collectionId: m.collection_id,
});

/** A set's pieces in their order (`set_models.position`), each with its model. */
export async function setPieces(db: Db, setId: string): Promise<ReleasePiece[]> {
  const rows = await db
    .selectFrom('set_models as s')
    .innerJoin('models as m', 'm.id', 's.model_id')
    .select(['s.position', ...MODEL_COLUMNS])
    .where('s.set_id', '=', setId)
    .orderBy('s.position')
    .execute();
  return rows.map((r) => ({ piece: r.position, model: modelOf(r as ModelRow) }));
}

/** The pieces of several sets at once (each as `setPieces` reads it), by set id: one read whatever their number. */
export async function setPiecesOf(db: Db, setIds: readonly string[]): Promise<Map<string, ReleasePiece[]>> {
  const out = new Map<string, ReleasePiece[]>();
  const ids = [...new Set(setIds)];
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom('set_models as s')
    .innerJoin('models as m', 'm.id', 's.model_id')
    .select(['s.set_id', 's.position', ...MODEL_COLUMNS])
    .where('s.set_id', 'in', ids)
    .orderBy('s.set_id')
    .orderBy('s.position')
    .execute();
  for (const r of rows) out.set(r.set_id, [...(out.get(r.set_id) ?? []), { piece: r.position, model: modelOf(r as unknown as ModelRow) }]);
  return out;
}

/** What the release `d` sells (see the header): its model, or its set and the set's pieces in order. */
export async function releaseOffer(db: Db, d: { readonly model_id: string | null; readonly set_id: string | null }): Promise<ReleaseOffer> {
  if (d.set_id !== null) {
    const s = await db.selectFrom('sets').select(['id', 'name', 'code', 'active']).where('id', '=', d.set_id).executeTakeFirstOrThrow();
    return { kind: 'SET', modelId: null, set: s, pieces: await setPieces(db, s.id) };
  }
  if (d.model_id === null) throw new Error('releaseOffer: a release sells a model or a set');
  const m = await db.selectFrom('models as m').select([...MODEL_COLUMNS]).where('m.id', '=', d.model_id).executeTakeFirstOrThrow();
  return { kind: 'MODEL', modelId: m.id, set: null, pieces: [{ piece: null, model: modelOf(m as ModelRow) }] };
}

/** The offers of several releases at once, by release id (each read as `releaseOffer` reads it). */
export async function releaseOffers(db: Db, drops: readonly { readonly id: string; readonly model_id: string | null; readonly set_id: string | null }[]): Promise<Map<string, ReleaseOffer>> {
  const out = new Map<string, ReleaseOffer>();
  // One after the other: a transaction is one connection.
  for (const d of drops) out.set(d.id, await releaseOffer(db, d));
  return out;
}

/** The model of a release's piece (`piece` null on a model's release, 1..4 on a set's); throws on a piece it does not have. */
export function pieceModelId(offer: ReleaseOffer, piece: number | null): string {
  const p = offer.kind === 'MODEL' ? offer.pieces[0] : offer.pieces.find((x) => x.piece === piece);
  if (!p || (offer.kind === 'SET' && piece === null)) throw new Error(`pieceModelId: no piece ${String(piece)} in this release`);
  return p.model.id;
}

/** The name a release's offer goes by: its model's, or its set's. */
export const offerName = (offer: ReleaseOffer): string => (offer.kind === 'SET' ? offer.set.name : offer.pieces[0].model.name);

/**
 * The model of an after-room (EXCLUDED, see the header): an after-room is always a model's release (the CHECK
 * `drops_set_no_after_room`), so a set's release here is a broken invariant, never a case to handle.
 */
export function afterRoomModelId(d: { readonly model_id: string | null }): string {
  if (d.model_id === null) throw new Error('afterRoomModelId: an after-room always sells a model (drops_set_no_after_room)');
  return d.model_id;
}

/**
 * The size YOUR SIZES preselects for each piece of a set's release (macro scope K44 T1: « YOUR SIZES preselects each
 * piece by its model's size kind »): among each piece's sizes (`sizes`, each with its piece), the one the account's
 * saved size of that piece's model's kind matches (services/sizes.ts savedSizeAmong); a piece with none is left out.
 * Reads only.
 */
export async function savedSizesByPiece<C extends SizeCandidate & { piece: number | null }>(
  db: Db,
  accountId: string,
  offer: ReleaseOffer,
  sizes: readonly C[],
): Promise<{ piece: number; id: string; label: string }[]> {
  if (offer.kind !== 'SET') return [];
  const out: { piece: number; id: string; label: string }[] = [];
  for (const p of offer.pieces) {
    const match = await savedSizeAmong(db, accountId, p.model.id, sizes.filter((z) => z.piece === p.piece));
    if (match) out.push({ piece: p.piece!, id: match.id, label: match.label });
  }
  return out;
}
