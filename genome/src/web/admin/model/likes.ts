/**
 * What they like, the Collectors page's panel `likes` in the console (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.8,
 * §3.6 C.6.3 item 4, C.6.5; step 9.4): its words and the pure helpers that write its rows, in the console's voice
 * (sentence case, calm, no exclamation mark). The panel's drawing comes with step 9.10, the collectors behind a figure
 * with steps 9.8 and 9.11: here, the slices each figure opens are named (question 16: a most wished model or collection
 * opens who wishes for it). Every word is checked by admin.brand.test.ts. An AUDITOR reads all of it: no email here.
 */
import { formatCount, formatDate } from '../format.js';
import { durationText } from './owner-intelligence.js';

export const LIKES_COPY = Object.freeze({
  title: 'What they like',
  tabs: Object.freeze({ pieces: 'FAVOURITE PIECES', finishes: 'FINISHES', wished: 'MOST WISHED', viewed: 'MOST VIEWED', held: 'PIECES HELD' }),
  wishedSwitch: Object.freeze({ models: 'MODELS', collections: 'COLLECTIONS' }),
  viewedSwitch: Object.freeze({ models: 'MODELS', releases: 'RELEASES', collectors: 'COLLECTORS', visitors: 'ALL VISITORS' }),
  /** The switches' names for screen readers, one each. */
  switches: Object.freeze({ wished: 'Most wished: models or collections', viewedWhat: 'Most viewed: models or releases', viewedWho: 'Most viewed: by collectors or by every visitor' }),
  /** The words after « Open the N collectors » of this panel's aria-labels. */
  open: Object.freeze({
    noFavourite: (kind: 'PIECE' | 'FINISH') => `who chose no favourite ${kind === 'PIECE' ? 'piece' : 'finish'}`,
    lookedAt: (name: string) => `who looked at ${name} in the period`,
    holdPieceOf: (name: string) => `who hold a piece of ${name}`,
  }),
  wishlists: 'Wishlists',
  withWishlist: 'Collectors with a wishlist',
  wishesAdded: 'Wishes added',
  wishesRemoved: 'Wishes removed',
  mostWishedModels: 'Most wished models',
  mostWishedCollections: 'Most wished collections',
  rowsOpen: 'Each row opens the collectors who wish for it.',
  noCount: 'No count is shown on the model’s sheet.',
  monthly: 'Older than 13 months: monthly totals, without filters.',
  favouritePieces: 'Favourite pieces',
  favouriteFinishes: 'Favourite finishes',
  noneChosen: 'None chosen',
  retired: '(no longer in the collection)',
  showAll: 'Show all',
  columns: Object.freeze({
    rank: 'Rank',
    /** MOST WISHED's bar column, its header read by screen readers only. */
    shareOfMost: 'Share of the most wished',
    model: 'Model',
    type: 'Type',
    collection: 'Collection',
    wished: 'Wished',
    added: 'Added',
    collectorsWishing: 'Collectors wishing',
    addedInPeriod: 'Added in the period',
    comparison: 'Comparison',
    collectors: 'Collectors',
    chosen: 'Chosen in the period',
    collectorsWhoLooked: 'Collectors who looked',
    views: 'Views',
    timeSpent: 'Time spent',
    medianTime: 'Median time per collector',
    visitors: 'Visitors',
    release: 'Release',
    pieces: 'Pieces',
  }),
  empty: Object.freeze({
    wishes: 'No wish in this period.',
    pieces: 'No collector has chosen a favourite piece yet.',
    finishes: 'No collector has chosen a favourite finish yet.',
    viewed: 'No model looked at in this period.',
    held: 'No piece held by these collectors.',
  }),
  /** A median of fewer than 3 collectors (GROWTH's minimum group). */
  withheld: 'Fewer than 3 collectors',
  /** MOST VIEWED's note when the period reaches past the 13 months of detail (§3.6 C.6.3 item 4): `reachWords`. */
  reach: 'Filters other than the country reach back 13 months, to',
});

/**
 * MOST VIEWED's note under COLLECTORS when the period reaches further back than the 13 months of detail (the answer's
 * `viewed.collectors.reachesBackTo`, a Paris day): `Filters other than the country reach back 13 months, to 14 SEP 2025.`,
 * in the console's date format; null when the period stays within them.
 */
export function reachWords(day: string | null): string | null {
  return day === null ? null : `${LIKES_COPY.reach} ${formatDate(day)}.`;
}

/** After a model not shown in THE COLLECTION now (W.8): hidden, discontinued, or shown in the private salon. */
export const WISHED_STATE_MARKS = Object.freeze({ HIDDEN: '(hidden)', DISCONTINUED: '(discontinued)', RESERVED: '(the private salon)' } as const);

export type LikedModelState = 'SHOWN' | 'HIDDEN' | 'DISCONTINUED' | 'RESERVED';

/** A model and its dot: `MONOLITHE · Blue`, or the name alone. */
export function modelWords(m: { name: string | null; variant: string | null }): string {
  const name = m.name ?? '(withdrawn)';
  return m.variant ? `${name} · ${m.variant}` : name;
}

/** A most wished row's name, with its mark when it is not shown in THE COLLECTION now: `ORBITE (hidden)`. */
export function wishedName(m: { name: string; variant: string | null; state: LikedModelState }): string {
  const mark = m.state === 'SHOWN' ? null : WISHED_STATE_MARKS[m.state];
  return mark ? `${modelWords(m)} ${mark}` : modelWords(m);
}

/** A row's change against the previous period: `+12`, `−3`, `0`; '—' without a previous period. */
export function changeWords(now: number, previous: number | null): string {
  if (previous === null) return '—';
  const d = now - previous;
  return d > 0 ? `+${formatCount(d)}` : d < 0 ? `−${formatCount(-d)}` : '0';
}

/** Collectors with a wishlist, as a share of the collectors: `18 % of collectors`; null when unknown (monthly totals). */
export function shareWords(share: number | null): string | null {
  return share === null ? null : `${formatCount(share)} % of collectors`;
}

/** A favourite piece's or finish's words, marked when the collection no longer offers it. */
export function tasteWords(t: { label: string; retired: boolean }): string {
  return t.retired ? `${t.label} ${LIKES_COPY.retired}` : t.label;
}

/** A time, or the median withheld: `3 min`, `Fewer than 3 collectors`. */
export function medianWords(seconds: number | null): string {
  return seconds === null ? LIKES_COPY.withheld : durationText(seconds);
}

const collectors = (n: number) => (n === 1 ? '1 collector' : `${formatCount(n)} collectors`);

/** The 'Collectors wishing' link of a most wished model (question 16): `Open the 42 collectors who wish for MONOLITHE · Blue`. */
export function wishedModelLabel(n: number, m: { name: string; variant: string | null }): string {
  return `Open the ${collectors(n)} who ${n === 1 ? 'wishes' : 'wish'} for ${modelWords(m)}`;
}

/** The link of a most wished collection: `Open the 12 collectors who wish for a model of ORBITAL`. */
export function wishedCollectionLabel(n: number, name: string): string {
  return `Open the ${collectors(n)} who ${n === 1 ? 'wishes' : 'wish'} for a model of ${name}`;
}

/** The link of a favourite piece's or finish's bar: `Open the 31 collectors whose favourite pieces include RING`. */
export function tasteLabel(n: number, kind: 'PIECE' | 'FINISH', t: { label: string }): string {
  return `Open the ${collectors(n)} whose favourite ${kind === 'PIECE' ? 'pieces' : 'finishes'} include ${t.label}`;
}

/** The link of 'Collectors with a wishlist': `Open the 54 collectors with a wishlist`. */
export function wishlistLabel(n: number): string {
  return `Open the ${collectors(n)} with a wishlist`;
}

/**
 * The slice each figure of the panel opens (§3.6 C.6.5): `haswish`, `wishmodel:<id>` (a main model with its variants'
 * wishers, a variant only its own), `wishcollection:<id>`, `favpiece:<key>`, `favfinish:<key>`, `viewed:<id>` or
 * `viewed:r:<release id>`, `holds:<id>`. Wishes added or removed count wishes, not collectors: they open nothing, nor
 * does anything read from the monthly totals (they name no one), nor ALL VISITORS (an anonymous visitor has no sheet).
 */
export const LIKES_SLICES = Object.freeze({
  haswish: () => 'haswish',
  wishmodel: (modelId: string) => `wishmodel:${modelId}`,
  wishcollection: (collectionId: string) => `wishcollection:${collectionId}`,
  favpiece: (key: string) => `favpiece:${key}`,
  favfinish: (key: string) => `favfinish:${key}`,
  viewedModel: (modelId: string) => `viewed:${modelId}`,
  viewedRelease: (dropId: string) => `viewed:r:${dropId}`,
  holds: (modelId: string) => `holds:${modelId}`,
});

/** A figure's link: the slice it opens and its `aria-label`. */
export interface LikesLink {
  slice: string;
  label: string;
}

/**
 * The link of a most wished row's 'Collectors wishing' (question 16; §3.6 C.6.3 item 4, C.6.5): a model's row opens
 * `wishmodel:<id>` (a main model with its variants' wishers, a variant only its own), a collection's row
 * `wishcollection:<id>`. None when the figures are read from the monthly totals (`raw` false: they name no one). 'Added
 * in the period', 'Wishes added' and 'Wishes removed' count wishes, not collectors: they have no link.
 */
export function wishedLink(raw: boolean, kind: 'model', row: { modelId: string; name: string; variant: string | null; wished: number }): LikesLink | null;
export function wishedLink(raw: boolean, kind: 'collection', row: { collectionId: string; name: string; collectors: number }): LikesLink | null;
export function wishedLink(
  raw: boolean,
  kind: 'model' | 'collection',
  row: { modelId: string; name: string; variant: string | null; wished: number } | { collectionId: string; name: string; collectors: number },
): LikesLink | null {
  if (!raw) return null;
  if (kind === 'model' && 'modelId' in row) return { slice: LIKES_SLICES.wishmodel(row.modelId), label: wishedModelLabel(row.wished, row) };
  if (kind === 'collection' && 'collectionId' in row) return { slice: LIKES_SLICES.wishcollection(row.collectionId), label: wishedCollectionLabel(row.collectors, row.name) };
  return null;
}

/** The link of 'Collectors with a wishlist': `haswish`; none when `raw` is false (the count is then unknown). */
export function wishlistLink(raw: boolean, n: number | null): LikesLink | null {
  return !raw || n === null ? null : { slice: LIKES_SLICES.haswish(), label: wishlistLabel(n) };
}
