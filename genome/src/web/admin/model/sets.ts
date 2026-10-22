/**
 * THE SET in the console (macro scope of 2026-10-20, K44 T1, T3 and T4; lot M3 plan §5.3, step M3.17), pure helpers, no
 * DOM: the words and checks of Catalogue → Sets, a set release's sizes per piece (a draw's fields of pieces, a LIVE
 * RELEASE's lines), the sets on sale and the even rule, a size named by its piece, an entry's sizes, « 1 SET PER PERSON »,
 * and the order page's « Part of THE SET », its cancellation and DECIDE THE SET.
 *
 *  - A set groups 2 to 4 different models (a model or a variant each), in order, each active with a size offered, at one
 *    price (a base price with its currency, optional: the release carries its own, as for a model). Its pieces are frozen
 *    once a release names it (409 SET_IN_USE); its name, code, price and Shopify product still change.
 *  - A set's release gives its sizes per piece; its quantity is a number of sets: a draw's pieces of each piece add up to
 *    the same sets before publication (409 DROP_SET_SIZES_UNEVEN otherwise), a LIVE RELEASE's sets on sale are the
 *    smallest of its pieces' totals.
 *  - A set sold is cancelled whole and returned whole (T3): its return's cases are decided together, each piece where
 *    ORBES says.
 * Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { formatCount, humanize } from '../format.js';
import {
  ORDER_CURRENCIES,
  SET_CODE_PATTERN,
  SET_NAME_MAX,
  SET_PIECES_MAX,
  SET_PIECES_MIN,
  SET_PRICE_MINOR_MAX,
  type AdminOrderSet,
  type DrawSizeInput,
  type Drop,
  type Model,
  type OrderCaseRecord,
  type OrderStatus,
  type PieceSizeRef,
  type ReleaseSet,
  type SetView,
} from '../types.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import { pastedShopifyId } from './shopify.js';
import { ONE_SIZE_LABEL } from './sizes.js';
import { modelChoice } from './variants.js';

export const SET_LIMITS = Object.freeze({ name: SET_NAME_MAX, code: 40, piecesMin: SET_PIECES_MIN, piecesMax: SET_PIECES_MAX, priceMax: SET_PRICE_MINOR_MAX });

// ── Catalogue → Sets ─────────────────────────────────────────────────────────────────────────────────────────────

export const SETS_TEXT = Object.freeze({
  title: 'Sets',
  lead: 'Two to four models sold together at one price, as their own release: a draw or a LIVE RELEASE. One entry, one price, each piece’s size chosen at entry. Returned whole only.',
  empty: 'No set yet: group 2 to 4 models sold at one price.',
  add: 'New set',
  addTitle: 'New set',
  editTitle: 'Edit the set',
  eyebrow: 'Catalogue · Sets',
  added: 'Set added.',
  saved: 'Set saved.',
  unchanged: 'Nothing has changed.',
  nameHint: 'As its release and YOUR ORDERS name it, after THE SET.',
  codeHint: 'Its reference and its Shopify handle: 2 to 40 capitals, digits and hyphens.',
  piecesLead: 'Its pieces, in order: 2 to 4 different models or variants, each active with its sizes declared.',
  pieceHint: (n: number) => (n <= SET_PIECES_MIN ? 'Required.' : 'Optional: leave it empty for a set of fewer pieces.'),
  frozen: 'A release names this set: its pieces no longer change. Its name, code and price still do.',
  priceHint: 'Shown with its releases, which carry their own price, as a model’s. Optional; shared over the pieces’ invoices by their base prices.',
  setAside: 'Set aside',
  reinstate: 'Reinstate',
  setAsideTitle: 'Set the set aside',
  reinstateTitle: 'Reinstate the set',
  setAsideText: 'No new release of it can be made. Its releases and their orders stay as they are.',
  reinstateText: 'It can be sold again by a new release.',
  setAsideDone: 'Set set aside.',
  reinstateDone: 'Set reinstated.',
  shopify: 'Shopify',
  shopifyTitle: 'Shopify product',
  shopifyText: (code: string) => `The set is one Shopify product, its handle ${code}; its pieces are their models’ own variants. Paste the product’s id or address back here.`,
  shopifySaved: 'Shopify id saved.',
  noPrice: 'No base price',
  noRelease: 'None yet',
});

/** A piece of a set as a line: « 1 · AURA · RING · STEEL ». */
export function setPieceLine(p: SetView['pieces'][number]): string {
  return `${p.position} · ${modelChoice({ name: p.model.name, type: p.model.type, variantLabel: p.model.variant })}`;
}

/** Its pieces, one line each, in order; a model no longer offered said. */
export function setPiecesLines(s: Pick<SetView, 'pieces'>): string[] {
  return s.pieces.map((p) => `${setPieceLine(p)}${p.model.active ? '' : ' · NOT OFFERED'}`);
}

/** Its base price: « € 4 200 », or No base price. */
export function setPriceText(s: Pick<SetView, 'basePriceMinor' | 'baseCurrency'>): string {
  return s.basePriceMinor === null || s.baseCurrency === null ? SETS_TEXT.noPrice : formatMoney(s.basePriceMinor, s.baseCurrency);
}

export function setState(s: Pick<SetView, 'active'>): string {
  return s.active ? 'ACTIVE' : 'SET ASIDE';
}

/** Its releases: None yet, or « 2 releases » (its pieces then frozen). */
export function setReleasesText(s: Pick<SetView, 'releases'>): string {
  const n = s.releases.length;
  return n === 0 ? SETS_TEXT.noRelease : `${formatCount(n)} ${n === 1 ? 'release' : 'releases'}`;
}

export function setShopifyStatus(s: Pick<SetView, 'shopifyProductId'>): string {
  return s.shopifyProductId ? 'LINKED' : 'NOT LINKED';
}

/** The fields of the pieces: `piece1` to `piece4`. */
export const SET_PIECE_FIELDS = Object.freeze(['piece1', 'piece2', 'piece3', 'piece4'] as const);

/**
 * A piece's options: the active models and variants in natural order (a variant after its main model), a model with no
 * size offered greyed out (the server refuses it), a model the set already holds kept even when no longer offered.
 */
export function setModelOptions(models: readonly Model[], held: readonly string[] = []): { value: string; label: string; disabled?: boolean }[] {
  const shown = models.filter((m) => m.active || held.includes(m.id));
  const mains = shown.filter((m) => !m.variantOf || !shown.some((x) => x.id === m.variantOf!.id));
  const ordered = mains.flatMap((m) => [m, ...shown.filter((v) => v.variantOf?.id === m.id && v !== m)]);
  return ordered.map((m) => {
    const sized = m.sizeType !== null && m.sizesOffered > 0;
    return { value: m.id, label: sized ? modelChoice(m) : modelChoice(m, 'no size offered'), ...(sized || held.includes(m.id) ? {} : { disabled: true }) };
  });
}

/** The dialog's values: the set's own, or a new set's. */
export function setFormValues(s: SetView | null): Record<string, string> {
  return {
    name: s?.name ?? '',
    code: s?.code ?? '',
    ...Object.fromEntries(SET_PIECE_FIELDS.map((f, i) => [f, s?.pieces[i]?.model.id ?? ''])),
    price: s && s.basePriceMinor !== null ? moneyField(s.basePriceMinor) : '',
    currency: s?.baseCurrency ?? 'EUR',
  };
}

/** The models chosen, in order, the empty fields left out. */
export function setModelIdsOf(v: Record<string, string>): string[] {
  return SET_PIECE_FIELDS.map((f) => (v[f] ?? '').trim()).filter((x) => x !== '');
}

/** The code as the server keeps it: trimmed, in capitals. */
export const setCodeOf = (v: Record<string, string>): string => (v.code ?? '').trim().toUpperCase();

/** What the server would refuse, said before anything is sent; null when the values hold. */
export function setProblem(v: Record<string, string>, s: SetView | null = null): string | null {
  const name = (v.name ?? '').trim();
  if (!name) return 'Give the set a name.';
  if ([...name].length > SET_LIMITS.name) return `A set’s name has at most ${SET_LIMITS.name} characters.`;
  if (!SET_CODE_PATTERN.test(setCodeOf(v))) return 'The code is 2 to 40 capitals, digits and hyphens, starting with a capital or a digit.';
  const fields = SET_PIECE_FIELDS.map((f) => (v[f] ?? '').trim());
  const last = fields.reduce((n, x, i) => (x ? i : n), -1);
  if (fields.slice(0, last + 1).some((x) => x === '')) return 'Give the pieces in order, without an empty one between two.';
  const ids = setModelIdsOf(v);
  if (ids.length < SET_LIMITS.piecesMin) return `A set groups ${SET_LIMITS.piecesMin} to ${SET_LIMITS.piecesMax} models.`;
  if (new Set(ids).size !== ids.length) return 'Each model is in a set once.';
  if (s && s.releases.length > 0 && !samePieces(s, ids)) return SETS_TEXT.frozen;
  const price = (v.price ?? '').trim();
  if (price !== '') {
    const minor = parseMoney(price);
    if (minor === null || minor < 1 || minor > SET_LIMITS.priceMax) return 'The price is an amount in units: 4200, or 4200.50.';
    if (!(ORDER_CURRENCIES as readonly string[]).includes(v.currency ?? '')) return `A set is priced in ${ORDER_CURRENCIES.join(', ')}.`;
  }
  return null;
}

const samePieces = (s: Pick<SetView, 'pieces'>, ids: readonly string[]): boolean => s.pieces.length === ids.length && s.pieces.every((p, i) => p.model.id === ids[i]);

const priceOf = (v: Record<string, string>): { basePriceMinor: number | null; baseCurrency: string | null } => {
  const price = (v.price ?? '').trim();
  return price === '' ? { basePriceMinor: null, baseCurrency: null } : { basePriceMinor: parseMoney(price)!, baseCurrency: v.currency };
};

/** POST /api/admin/sets, from values setProblem accepted: the price sent only when given. */
export function setCreateInput(v: Record<string, string>): { name: string; code: string; modelIds: string[]; basePriceMinor?: number; baseCurrency?: string } {
  const p = priceOf(v);
  return { name: v.name.trim(), code: setCodeOf(v), modelIds: setModelIdsOf(v), ...(p.basePriceMinor !== null ? { basePriceMinor: p.basePriceMinor, baseCurrency: p.baseCurrency! } : {}) };
}

/** PATCH /api/admin/sets/:id: only what changed (the price with its currency); {} when nothing did. */
export function setChange(s: SetView, v: Record<string, string>): { name?: string; code?: string; modelIds?: string[]; basePriceMinor?: number | null; baseCurrency?: string | null } {
  const out: ReturnType<typeof setChange> = {};
  const name = v.name.trim();
  if (name !== s.name) out.name = name;
  const code = setCodeOf(v);
  if (code !== s.code) out.code = code;
  const ids = setModelIdsOf(v);
  if (!samePieces(s, ids)) out.modelIds = ids;
  const p = priceOf(v);
  if (p.basePriceMinor !== s.basePriceMinor || p.baseCurrency !== s.baseCurrency) {
    out.basePriceMinor = p.basePriceMinor;
    out.baseCurrency = p.baseCurrency;
  }
  return out;
}

/** Shopify: the product's id or address pasted back; empty unlinks it. */
export function setShopifyProblem(s: Pick<SetView, 'shopifyProductId'>, v: Record<string, string>): string | null {
  const product = pastedShopifyId(v.productId, 'products');
  if (product === undefined) return 'The product id is the number at the end of the product’s address in Shopify’s admin.';
  return product === s.shopifyProductId ? SETS_TEXT.unchanged : null;
}

export const setShopifyInput = (v: Record<string, string>): string | null => pastedShopifyId(v.productId, 'products') ?? null;

// ── What a release sells ─────────────────────────────────────────────────────────────────────────────────────────

export const OFFER_TEXT = Object.freeze({
  label: 'What it sells',
  model: 'A model',
  set: 'A set',
  chooseSet: 'Choose a set',
  noSet: 'No set yet: group 2 to 4 models in Catalogue → Sets first.',
  setLead: 'Its set first: a set’s release gives its sizes per piece, each piece’s model’s offered sizes, and its quantity in sets.',
  setFixed: 'A set’s release sells its set: another set may take its place while it is a draft, its sizes with it.',
});

/** A set as a release's options name it: « AURA SET · 3 PIECES », a set aside greyed out. */
export function setOptions(sets: readonly SetView[], current = ''): { value: string; label: string; disabled?: boolean }[] {
  return sets
    .filter((s) => s.active || s.id === current)
    .map((s) => ({ value: s.id, label: `${humanize(s.name)} · ${s.pieces.length} PIECES`, ...(s.active ? {} : { disabled: true }) }));
}

/** A release's offer under its title in a list: « MONOLITHE · RING », or « SET · AURA · ECLIPSE » for a set's. */
export function releaseOfferLine(r: { model: { name: string; type: string }; set?: ReleaseSet }): string {
  return r.set ? `Set · ${r.set.pieces.map((p) => humanize(p.model.name)).join(' · ')}` : `${humanize(r.model.name)} · ${humanize(r.model.type)}`;
}

/** A piece of a set release by its model: « AURA », « AURA · STEEL »; `Piece n` when unknown. */
export function pieceName(set: Pick<ReleaseSet, 'pieces'> | null | undefined, piece: number | null | undefined): string {
  const p = set?.pieces.find((x) => x.piece === piece);
  return p ? [humanize(p.model.name), ...(p.model.variant ? [humanize(p.model.variant)] : [])].join(' · ') : `Piece ${piece ?? '—'}`;
}

/** A size named by its piece on a set's release (« AURA · 52 »), as it is on a model's (« 52 »). */
export function pieceSizeLabel(set: Pick<ReleaseSet, 'pieces'> | null | undefined, s: { label: string; piece?: number | null }): string {
  return set && s.piece ? `${pieceName(set, s.piece)} · ${s.label}` : s.label;
}

/** An entry's sizes in the set's order: « 52 · M · 45 CM ». */
export function entrySizesText(sizes: readonly PieceSizeRef[] | undefined): string {
  return [...(sizes ?? [])].sort((a, b) => a.piece - b.piece).map((s) => s.label).join(' · ');
}

/** The pieces one person takes: « 1 SET PER PERSON », « 2 PIECES PER PERSON » (T4: a set counts as one). */
export function perPersonText(n: number, set: boolean): string {
  return set ? `${n} ${n === 1 ? 'SET' : 'SETS'} PER PERSON` : `${n} ${n === 1 ? 'PIECE' : 'PIECES'} PER PERSON`;
}

/** The release's quantity: « 25 sets », « 25 pieces ». */
export function quantityWords(n: number, set: boolean): string {
  return set ? `${formatCount(n)} ${n === 1 ? 'set' : 'sets'}` : `${formatCount(n)} ${n === 1 ? 'piece' : 'pieces'}`;
}

// ── A set draw's sizes per piece ─────────────────────────────────────────────────────────────────────────────────

/** A piece's size field of pieces in a set draw's dialog: `piece:<n>:<label>`. */
export const SET_SIZE_FIELD = 'piece:';
export const setSizeField = (piece: number, label: string): string => `${SET_SIZE_FIELD}${piece}:${label}`;

/** A set's pieces with their offered sizes (ONE SIZE for a size of none), as its draw's dialog lists them. */
export interface SetPieceSizes {
  piece: number;
  name: string;
  labels: string[];
}

/** A set's pieces and their offered sizes, from its catalogue view. */
export function setPieceSizes(s: Pick<SetView, 'pieces'>): SetPieceSizes[] {
  return s.pieces.map((p) => ({
    piece: p.position,
    name: [humanize(p.model.name), ...(p.model.variant ? [humanize(p.model.variant)] : [])].join(' · '),
    labels: p.sizes.map((z) => z.label ?? ONE_SIZE_LABEL),
  }));
}

/** The fields' values: a draft's pieces in each of its sizes (0 for the others), empty for a new release. */
export function setDrawSizeValues(pieces: readonly SetPieceSizes[], d: Pick<Drop, 'sizes'> | null): Record<string, string> {
  const had = new Map((d?.sizes ?? []).map((s) => [`${s.piece ?? 0}:${s.label.toUpperCase()}`, s.pieces]));
  return Object.fromEntries(pieces.flatMap((p) => p.labels.map((l) => [setSizeField(p.piece, l), d ? String(had.get(`${p.piece}:${l.toUpperCase()}`) ?? 0) : ''])));
}

const whole = (v: string): number | null => (/^\s*\d{1,6}\s*$/.test(v ?? '') ? Number(v) : null);

/** The sizes the dialog holds, in their order, each with its piece and pieces (empty is 0; null: not a whole number in bounds). */
export function setDrawSizesOf(v: Record<string, string>): { piece: number; label: string; pieces: number | null }[] {
  return Object.keys(v)
    .filter((k) => k.startsWith(SET_SIZE_FIELD))
    .map((k) => {
      const rest = k.slice(SET_SIZE_FIELD.length);
      const at = rest.indexOf(':');
      const raw = (v[k] ?? '').trim();
      const n = raw === '' ? 0 : whole(raw);
      return { piece: Number(rest.slice(0, at)), label: rest.slice(at + 1), pieces: n === null || n > 10_000 ? null : n };
    });
}

/** Each piece's pieces in all, in the set's order. */
export function pieceTotals(sizes: readonly { piece?: number | null; pieces?: number | null; stock?: number }[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => sizes.filter((s) => s.piece === i + 1).reduce((n, s) => n + (s.pieces ?? s.stock ?? 0), 0));
}

/** What the server would refuse in a set draw's sizes; null when they hold (an uneven draft is said, never refused). */
export function setDrawSizesProblem(v: Record<string, string>, pieces: readonly SetPieceSizes[]): string | null {
  const sizes = setDrawSizesOf(v);
  if (sizes.some((s) => s.pieces === null)) return 'A size has 0 to 10 000 pieces.';
  for (const p of pieces) {
    if (p.labels.length === 0) return `${p.name} offers no size: declare its sizes in the Catalogue.`;
    const withPieces = sizes.filter((s) => s.piece === p.piece && (s.pieces ?? 0) > 0);
    if (withPieces.length === 0) return `Give ${p.name} at least one size with pieces.`;
    if (withPieces.length > 24) return `${p.name} has at most 24 sizes with pieces.`;
    if (withPieces.reduce((n, s) => n + s.pieces!, 0) > 10_000) return `${p.name} has at most 10 000 pieces.`;
  }
  return null;
}

/** The sizes to send: those with pieces, each with its piece, in the dialog's order. */
export function setDrawSizesInput(v: Record<string, string>): DrawSizeInput[] {
  return setDrawSizesOf(v)
    .filter((s) => (s.pieces ?? 0) > 0)
    .map((s) => ({ piece: s.piece, label: s.label, pieces: s.pieces! }));
}

/** Whether a draft's sizes are those the dialog gives (piece, label whatever its case, pieces, in order). */
export function sameSetSizes(had: readonly { label: string; pieces: number; piece?: number }[], next: readonly DrawSizeInput[]): boolean {
  return had.length === next.length && had.every((s, i) => (s.piece ?? null) === (next[i]!.piece ?? null) && s.label.toUpperCase() === next[i]!.label.toUpperCase() && s.pieces === next[i]!.pieces);
}

/**
 * Under a set release's sizes: « Sets on sale: 25 » (the smallest piece's total), and while the pieces differ, the even
 * rule (a draw is published only when each piece adds up to the same sets; a LIVE RELEASE sells its scarcest piece's).
 */
export function setsOnSaleLines(totals: readonly number[], names: readonly string[], mode: 'DRAW' | 'LIVE'): { onSale: string; uneven: string | null } {
  const sets = totals.length ? Math.min(...totals) : 0;
  const even = totals.every((t) => t === totals[0]);
  const each = totals.map((t, i) => `${names[i] ?? `Piece ${i + 1}`} ${formatCount(t)}`).join(' · ');
  return {
    onSale: `Sets on sale: ${formatCount(sets)}`,
    uneven: even
      ? null
      : mode === 'DRAW'
        ? `Each piece’s sizes add up to the same sets before the draw is published: ${each}.`
        : `The release sells as many sets as its scarcest piece: ${each}.`,
  };
}

// ── The order page ───────────────────────────────────────────────────────────────────────────────────────────────

export const ORDER_SET_TEXT = Object.freeze({
  title: 'The set',
  part: (name: string) => `Part of THE SET ${humanize(name)}`,
  lead: 'Sold as one, at one price shared over its pieces’ orders. Cancelled whole, returned whole; a piece’s size can be exchanged alone.',
  thisOrder: 'This order',
  decide: 'Decide the set',
  decideLead: 'A set is returned whole: its pieces are decided together, once every one is back. Each piece goes back to stock or to the archive; each order gets its credit note.',
  waiting: (n: number) => `${formatCount(n)} ${n === 1 ? 'piece is' : 'pieces are'} not back yet: the set is decided once every piece is received.`,
});

/** The set's price: « € 4 200 for the set », or No price (its orders' prices entered by Client Services). */
export function orderSetPriceText(s: Pick<AdminOrderSet, 'priceMinor' | 'currency'>): string {
  return s.priceMinor === null || s.currency === null ? 'No price: each order’s is entered by Client Services' : `${formatMoney(s.priceMinor, s.currency)} for the set`;
}

/** An order of the set as its row says it: « Piece 2 · AURA · STEEL · 52 ». */
export function orderSetPieceLine(o: AdminOrderSet['orders'][number]): string {
  return [`Piece ${o.piece ?? '—'}`, humanize(o.model), ...(o.variant ? [humanize(o.variant)] : []), ...(o.sizeLabel ? [o.sizeLabel] : [])].join(' · ');
}

/** Its share of the set's price: « € 2 100 », or No price. */
export function orderSetShare(o: Pick<AdminOrderSet['orders'][number], 'priceMinor' | 'currency'>): string {
  return o.priceMinor === null || o.currency === null ? 'No price' : formatMoney(o.priceMinor, o.currency);
}

const OPEN: readonly OrderStatus[] = ['RESERVED', 'PAID'];

/**
 * What Cancel says on a set's order (§15 note 12, cancelled whole): the set's open orders it cancels with it, or null on
 * an order of no set, and on a piece's size EXCHANGE order (cancelled alone).
 */
export function setCancelText(s: AdminOrderSet | null | undefined, orderId: string, channel: string): string | null {
  if (!s || channel === 'EXCHANGE') return null;
  const open = s.orders.filter((o) => o.channel !== 'EXCHANGE' && OPEN.includes(o.status));
  const others = open.filter((o) => o.id !== orderId);
  if (others.length === 0) return null;
  return `A set is cancelled whole: this cancels the set’s ${formatCount(open.length)} orders, ${open.map((o) => o.reference).join(', ')}.`;
}

/** DECIDE THE SET's field of a piece: `to:<caseId>`, and its location `at:<caseId>`. */
export const pieceToField = (caseId: string): string => `to:${caseId}`;
export const pieceAtField = (caseId: string): string => `at:${caseId}`;

/** The cases of a set's return group not ended, each with its order's piece line (from the order's set), in the set's order. */
export function groupPieces(c: Pick<OrderCaseRecord, 'group'>, s: AdminOrderSet | null | undefined): { caseId: string; reference: string; line: string; received: boolean }[] {
  const cases = c.group?.cases ?? [];
  return cases
    .filter((x) => x.status !== 'CLOSED' && x.status !== 'CANCELLED')
    .map((x) => {
      const o = s?.orders.find((y) => y.id === x.order.id);
      return { caseId: x.id, reference: x.order.reference, line: o ? orderSetPieceLine(o) : x.order.reference, received: x.received };
    });
}

/** A case of a set's return group as the order page lists it: « Piece 2 · AURA · 52 · ORB-… · RECEIVED ». */
export function groupCaseLine(x: NonNullable<OrderCaseRecord['group']>['cases'][number], s: AdminOrderSet | null | undefined): string {
  const o = s?.orders.find((y) => y.id === x.order.id);
  const state = x.status === 'RECEIVED' || x.received ? 'RECEIVED' : x.status === 'OPEN' ? 'NOT BACK YET' : humanize(x.status);
  return [...(o ? [orderSetPieceLine(o)] : []), x.order.reference, state].join(' · ');
}

/** Each piece's destination from DECIDE THE SET's values (the location only for a piece back to stock). */
export function setDecisionPieces(c: Pick<OrderCaseRecord, 'group'>, v: Record<string, string>): { caseId: string; pieceTo: 'RESTOCKED' | 'ARCHIVED'; locationId?: string | null }[] {
  return groupPieces(c, null).map((p) => {
    const to = v[pieceToField(p.caseId)] === 'ARCHIVED' ? 'ARCHIVED' : 'RESTOCKED';
    return { caseId: p.caseId, pieceTo: to, ...(to === 'RESTOCKED' ? { locationId: v[pieceAtField(p.caseId)] || null } : {}) };
  });
}

/** What DECIDE THE SET would be refused: a piece not back yet, a piece without its destination or location, no note. */
export function setDecisionProblem(c: Pick<OrderCaseRecord, 'group'>, v: Record<string, string>): string | null {
  if (v.decision !== 'REFUND') return 'Choose the outcome.';
  const pieces = groupPieces(c, null);
  const waiting = pieces.filter((p) => !p.received).length;
  if (waiting > 0) return ORDER_SET_TEXT.waiting(waiting);
  for (const p of pieces) {
    const to = v[pieceToField(p.caseId)];
    if (to !== 'RESTOCKED' && to !== 'ARCHIVED') return `Say where the piece of ${p.reference} goes.`;
    if (to === 'RESTOCKED' && !/^[0-9a-f-]{36}$/i.test(v[pieceAtField(p.caseId)] ?? '')) return `Choose the location the piece of ${p.reference} goes back to.`;
  }
  const note = (v.note ?? '').trim();
  if (!note) return 'Say in the note why.';
  return null;
}

/** DECIDE THE SET's body: the decision of this case (its own piece's destination) and every piece's by its case. */
export function setDecisionInput(c: Pick<OrderCaseRecord, 'id' | 'group'>, v: Record<string, string>): { decision: 'REFUND'; pieceTo: 'RESTOCKED' | 'ARCHIVED'; locationId: string | null; note: string; pieces: { caseId: string; pieceTo: 'RESTOCKED' | 'ARCHIVED'; locationId?: string | null }[] } {
  const pieces = setDecisionPieces(c, v);
  const own = pieces.find((p) => p.caseId === c.id) ?? pieces[0]!;
  return { decision: 'REFUND', pieceTo: own.pieceTo, locationId: own.pieceTo === 'RESTOCKED' ? (own.locationId ?? null) : null, note: (v.note ?? '').trim(), pieces };
}
