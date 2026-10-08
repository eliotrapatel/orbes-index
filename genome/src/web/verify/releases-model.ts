/**
 * THE RELEASES (P-R03): the list and the pages of the releases (API §8.9) and
 * the account's entries (§10.10) → what /verify/releases, a release's page
 * and MY PIECES show. Pure (no DOM) and unit-tested, like the lookbook's.
 *
 *  - A time is said twice: in UTC, as the server keeps it and the rule
 *    names it, then on the phone's own clock with its offset.
 *  - A release's page: its model (the address of its lookbook sheet when the
 *    model is PUBLIC there), its pieces, its dates, how long a place drawn
 *    is held; the rule of the draw; the fingerprint of its seed, then, once
 *    drawn, the seed and its entries (each by its id, tier, seniority and
 *    rank).
 *  - The account's entry: one sentence for what it means now (a place held
 *    until a time, the waiting list's rank, …), and whether ENTER THE DRAW
 *    or WITHDRAW is offered.
 *  - THE RELEASES' PAST (plan LIVE RELEASE+, choice 5): each release ended as it was announced (its photograph, its
 *    name, its opening date, its quantity line; never an end figure), and, signed in, the account's part in it (YOU
 *    TOOK PART, YOU SECURED A PIECE) and in how many releases; a drawn release's page says THIS RELEASE IS OVER.
 *  - The early access (P-X02): the line under a release's state
 *    (PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …), its facts (when it
 *    opens, the places reserved directly), and, for an account PLATINE or
 *    PALLADIUM while it lasts, RESERVE A PLACE; a release whose every piece
 *    is reserved says so.
 *  - Sizes in a draw (plan NEXT LOT §3.6.F): its SIZES row (each size's
 *    pieces, the places reserved directly in it, FULL), its own rule, the
 *    list's size of each entry, YOUR SIZE's picker preselected (the entry's
 *    size, YOUR SIZES', the only one) with the sizes full greyed out during
 *    the early access, and every label and sentence of an entry with its
 *    size. A draw without sizes reads as before.
 *
 * Nothing the server did not send: a photograph is taken from this origin's
 * media route only, an address only if it is one.
 */
import { isLookbookSlug } from '../shared/lookbook.js';
import { RELEASES } from './copy.js';
import type { ClubEntry, DrawSizeRef, DropCard, DropEntryStatus, DropSheet, DropState, DrawEntry, Participation, PastRelease } from './types.js';
import { formatDate, formatDateTime, formatDateTimeLong, formatMoney, modelWithVariant, upper, utcOffsetLabel } from './view-model.js';
import { releaseContext, type WriteContext } from './messages-model.js';
import { storyCardModel, type StoryCardModel } from './story-card.js';

/** The list of the releases, and the page of one under it. */
export const RELEASES_PATH = '/verify/releases';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_SRC = /^\/api\/v1\/media\/[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function releasePath(id: string): string {
  return `${RELEASES_PATH}/${id}`;
}

/** The after-room of a LIVE RELEASE (plan LIVE RELEASE+, choice 2): read through the release it follows, by its guests only. */
export function afterRoomPath(parentId: string): string {
  return `${RELEASES_PATH}/${parentId}/after-room`;
}

/** Whether `id` is the id of a release (a lower-case uuid). */
export function isReleaseId(id: string | null | undefined): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * The route of a path under /verify/releases: the list, a release by its id, a LIVE RELEASE's boutique board
 * (`/verify/releases/<id>/board`, its secret in the fragment) or its after-room (`/verify/releases/<id>/after-room`, the
 * release it follows), or HOW RELEASES WORK (`/verify/releases/how`, plan NEXT-NINE FT-01: never a release's id);
 * anything else is the list.
 */
export function releasesRouteOf(path: string): { release: string | null; board?: true; afterRoom?: true; how?: true } | null {
  const p = path.replace(/\/+$/, '').toLowerCase();
  if (p === RELEASES_PATH) return { release: null };
  if (!p.startsWith(`${RELEASES_PATH}/`)) return null;
  const rest = p.slice(RELEASES_PATH.length + 1);
  if (rest === 'how') return { release: null, how: true };
  const sub = /^([^/]+)\/(board|after-room)$/.exec(rest);
  if (sub && isReleaseId(sub[1])) return sub[2] === 'board' ? { release: sub[1]!, board: true } : { release: sub[1]!, afterRoom: true };
  return { release: isReleaseId(rest) ? rest : null };
}

const STATES = new Set<DropState>(['UPCOMING', 'OPEN', 'CLOSED', 'DRAWN', 'CANCELLED']);
const stateOf = (s: unknown): DropState => (STATES.has(s as DropState) ? (s as DropState) : 'CLOSED');

/** The lowest tier that reserves a place directly during an early access (P-X02): PLATINE (server: EARLY_ACCESS_MIN_TIER). */
export const EARLY_ACCESS_MIN_TIER = 2;

/**
 * The early access of a release as the server sent it (P-X02, by tier since BP-19 T3): when PALLADIUM's opens and whether
 * it is open now (the release's EARLY ACCESS), then PLATINE's (null: none for PLATINE); null without one.
 */
export interface EarlyAccess {
  opensAt: string;
  open: boolean;
  platineOpensAt: string | null;
  platineOpen: boolean;
  /** Each tier's hours before the opening, as the release was published with them. */
  palladiumHours: number;
  platineHours: number;
}

const validTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * A release's early access, when the server names a valid time for it, and only before entries open to everyone. A
 * release published before the windows by tier, or without PLATINE's fields, reads PALLADIUM's time for both.
 */
export function earlyAccessOf(
  c: Pick<DropCard, 'state' | 'earlyAccessOpensAt' | 'earlyAccessOpen' | 'earlyAccessHours' | 'earlyAccessPlatineHours' | 'earlyAccessPlatineOpensAt' | 'earlyAccessPlatineOpen'>,
): EarlyAccess | null {
  const at = c?.earlyAccessOpensAt;
  if (!validTime(at)) return null;
  const upcoming = stateOf(c.state) === 'UPCOMING';
  const open = c.earlyAccessOpen === true && upcoming;
  const byTier = c.earlyAccessPlatineOpensAt !== undefined;
  const platineOpensAt = byTier ? (validTime(c.earlyAccessPlatineOpensAt) ? c.earlyAccessPlatineOpensAt : null) : at;
  const palladiumHours = Number.isInteger(c.earlyAccessHours) && c.earlyAccessHours > 0 ? c.earlyAccessHours : 0;
  const platineHours = Number.isInteger(c.earlyAccessPlatineHours) && c.earlyAccessPlatineHours! >= 0 ? c.earlyAccessPlatineHours! : palladiumHours;
  return {
    opensAt: at,
    open,
    platineOpensAt,
    platineOpen: upcoming && platineOpensAt !== null && (byTier ? c.earlyAccessPlatineOpen === true : open),
    palladiumHours,
    platineHours: platineOpensAt === null ? 0 : platineHours,
  };
}

/** Whether PALLADIUM and PLATINE reserve from one time (a release of before the windows by tier, or one set alike). */
export function sameEarlyTime(e: EarlyAccess): boolean {
  return e.platineOpensAt !== null && Date.parse(e.platineOpensAt) === Date.parse(e.opensAt);
}

/** A release's state as its page and the list say it: EARLY ACCESS while PLATINE and PALLADIUM reserve. */
function stateLabelOf(state: DropState, early: EarlyAccess | null): string {
  return early?.open ? RELEASES.earlyState : RELEASES.state[state];
}

/** A time in UTC (`12 OCT 2026 · 10:00 UTC`), then on the phone's clock when it is not UTC. */
export interface TwoClocks {
  utc: string;
  local: string | null;
}

export function twoClocks(iso: string, offsetMinutes: number): TwoClocks {
  const utc = formatDateTime(iso, 0);
  if (!utc) return { utc: '', local: null };
  return { utc: RELEASES.utc(utc), local: offsetMinutes === 0 ? null : RELEASES.onThisPhone(formatDateTime(iso, offsetMinutes), utcOffsetLabel(offsetMinutes)) };
}

export interface ReleasePhoto {
  src: string;
  alt: string;
}

export interface ReleaseCardModel {
  id: string;
  href: string;
  title: string;
  state: DropState;
  stateLabel: string;
  /** MONOLITHE · RING */
  model: string;
  /** `3 PIECES · ENTRIES OPEN 12 OCT 2026 · 10:00 UTC`, or their close once open. */
  line: string;
  /** `€ 4 200` (addition 5), or null when ORBES gave the draw no price. */
  price: string | null;
  image: ReleasePhoto | null;
}

/** A draw's price (addition 5): `€ 4 200`, or null when ORBES gave none (both its amount and its currency, or neither). */
export function drawPrice(d: Pick<DropCard, 'priceMinor' | 'currency'>): string | null {
  return typeof d?.priceMinor === 'number' && Number.isFinite(d.priceMinor) && typeof d.currency === 'string' && d.currency ? formatMoney(d.priceMinor, d.currency) : null;
}

const modelLine = (m: { name: string; type: string }): string => [upper(m.name), upper(m.type)].filter((x) => x.length > 0).join(' · ');

/** The releases of the list, in the server's order; one without an id of its own is left out. */
export function releaseCards(cards: readonly DropCard[]): ReleaseCardModel[] {
  const out: ReleaseCardModel[] = [];
  for (const c of cards) {
    if (!isReleaseId(c?.id) || typeof c.title !== 'string') continue;
    const state = stateOf(c.state);
    const pieces = RELEASES.pieces(Number(c.quantity) || 0);
    const line = state === 'UPCOMING' ? RELEASES.opensLine(pieces, formatDateTime(c.opensAt, 0)) : state === 'OPEN' ? RELEASES.closesLine(pieces, formatDateTime(c.closesAt, 0)) : pieces;
    out.push({
      id: c.id,
      href: releasePath(c.id),
      title: upper(c.title),
      state,
      stateLabel: stateLabelOf(state, earlyAccessOf(c)),
      model: modelLine(c.model ?? { name: '', type: '' }),
      line,
      price: drawPrice(c),
      image: typeof c.model?.imageUrl === 'string' && MEDIA_SRC.test(c.model.imageUrl) ? { src: c.model.imageUrl, alt: RELEASES.photosLabel(upper(c.title)) } : null,
    });
  }
  return out;
}

/** A row of the release's facts: a label, and a value said in UTC then on the phone's clock (`local`), or plain. */
export interface ReleaseRow {
  label: string;
  value: string;
  local?: string | null;
  /** Plan NEXT LOT §3.6.F: the SIZES row's further lines, one per size after the first (`value`). */
  more?: string[];
}

/** A draw's size on its page (plan NEXT LOT §3.6.F): its pieces, those reserved directly in it, full before the draw. */
export interface DrawSizeModel {
  id: string;
  label: string;
  pieces: number;
  reserved: number;
  full: boolean;
}

export interface ReleaseSheetModel {
  id: string;
  title: string;
  state: DropState;
  stateLabel: string;
  /** The collection, else the model's name: the line over the title. */
  eyebrow: string;
  model: string;
  /** The address (`<slug>`) of the model's sheet in THE COLLECTION, when it is PUBLIC there. */
  lookbookSlug: string | null;
  /** When entries open, as the server sent it (ISO 8601). */
  opensAt: string;
  /** P-X02: its early access (when it opens, whether it is open now); null without one. */
  earlyAccess: EarlyAccess | null;
  /**
   * P-X02: `PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …` (UTC), under the state, or by tier (BP-19 T3) `PALLADIUM:
   * FROM … · PLATINE: FROM … · EVERYONE: FROM …` when their times differ; null without an early access.
   */
  access: string | null;
  /** P-X02: THE RELEASE's paragraph on the early access; null without one. */
  earlyNote: string | null;
  /** P-X02: every piece held by a direct reservation, before the draw (the page says so, an entry joins a waiting list). */
  full: boolean;
  image: ReleasePhoto | null;
  description: string | null;
  rows: ReleaseRow[];
  /** The seed's fingerprint, in groups of four. */
  seedHash: string;
  /** Once drawn: the seed in groups of four, and its raw hexadecimal for the phone's check. */
  seed: string | null;
  seedHex: string | null;
  seedHashHex: string;
  drawn: boolean;
  /** IN-01: once drawn, the places guaranteed by the house, by entry id and pieces (never an account); their size (§3.6.F). */
  guaranteed: { id: string; pieces: number; size?: DrawSizeRef | null }[];
  /** Plan NEXT LOT §3.6.F: its sizes with pieces, in order; empty for a draw without sizes (one published before). */
  sizes: DrawSizeModel[];
  /** The rule of its draw, word for word: a draw with sizes has its own. */
  rule: string;
}

/** Hexadecimal in groups of four, for reading and comparing by eye. */
export function groupHex(hex: string): string {
  return (hex.match(/.{1,4}/g) ?? []).join(' ');
}

export function releaseSheet(s: DropSheet, offsetMinutes: number): ReleaseSheetModel {
  const state = stateOf(s.state);
  const opens = twoClocks(s.opensAt, offsetMinutes);
  const closes = twoClocks(s.closesAt, offsetMinutes);
  const early = earlyAccessOf(s);
  const quantity = Number(s.quantity) || 0;
  const reserved = Number.isInteger(s.reserved) && s.reserved > 0 ? s.reserved : 0;
  const price = drawPrice(s);
  const rows: ReleaseRow[] = [...(price ? [{ label: RELEASES.rows.price, value: price }] : []), { label: RELEASES.rows.pieces, value: String(quantity) }];
  // Plan NEXT LOT §3.6.F: each size's pieces, public; the places reserved directly in it from the early access on (and
  // once drawn), FULL before the draw. A one-size draw has no SIZES row.
  const sizes = drawSizes(s);
  const reservedShown = early !== null && (early.open || state !== 'UPCOMING');
  if (sizes.length > 1) {
    const lines = sizes.map((z) => RELEASES.sizes.line(z.label, z.pieces, reservedShown ? z.reserved : 0, z.full));
    rows.push({ label: RELEASES.rows.sizes, value: lines[0]!, more: lines.slice(1) });
  }
  const earlyAt = early ? twoClocks(early.opensAt, offsetMinutes) : null;
  const platineAt = early?.platineOpensAt ? twoClocks(early.platineOpensAt, offsetMinutes) : null;
  // BP-19 T3: the EARLY ACCESS row gives each tier's hours; the line under the state gives their times.
  if (early) rows.push({ label: RELEASES.rows.early, value: RELEASES.earlyHours(RELEASES.hours(early.palladiumHours), platineAt ? RELEASES.hours(early.platineHours) : null) });
  rows.push(
    { label: RELEASES.rows.opens, value: opens.utc, local: opens.local },
    { label: RELEASES.rows.closes, value: closes.utc, local: closes.local },
    { label: RELEASES.rows.held, value: RELEASES.hours(Number(s.purchaseWindowHours) || 0) },
  );
  // The places reserved directly, once the early access has begun: before the draw, what is left of the pieces; once
  // drawn, the release is over and says no end figure (plan LIVE RELEASE+, choice 5).
  if (early && state !== 'DRAWN' && (early.open || state !== 'UPCOMING' || reserved > 0)) rows.push({ label: RELEASES.rows.reserved, value: RELEASES.reservedOf(reserved, quantity) });
  if (s.drawnAt) {
    const drawn = twoClocks(s.drawnAt, offsetMinutes);
    rows.push({ label: RELEASES.rows.drawn, value: drawn.utc, local: drawn.local });
  }
  // Full as RESERVE counts it (the server's `full`: the pieces the house guarantees too), or every piece reserved.
  const full = (s.full === true || (quantity > 0 && reserved >= quantity)) && (state === 'UPCOMING' || state === 'OPEN' || state === 'CLOSED');
  const seedHashHex = typeof s.seedHash === 'string' && HEX64.test(s.seedHash) ? s.seedHash : '';
  const seedHex = state === 'DRAWN' && typeof s.seed === 'string' && HEX64.test(s.seed) ? s.seed : null;
  const model = s.model ?? { name: '', type: '', collection: null, imageUrl: null, lookbook: null };
  return {
    id: s.id,
    title: upper(s.title),
    state,
    // Drawn, the release is over (plan LIVE RELEASE+, decision 30): its page says so, neutral.
    stateLabel: state === 'DRAWN' ? RELEASES.over : [stateLabelOf(state, early), full ? RELEASES.fullState : ''].filter((x) => x.length > 0).join(' · '),
    earlyAccess: early,
    access: earlyAt && opens.utc ? (sameEarlyTime(early!) ? RELEASES.access(earlyAt.utc, opens.utc) : RELEASES.accessByTier(earlyAt.utc, platineAt?.utc ?? null, opens.utc)) : null,
    earlyNote: early ? (sameEarlyTime(early) ? RELEASES.earlyNote : RELEASES.earlyNoteByTier) : null,
    full,
    eyebrow: model.collection && model.collection.trim() ? upper(model.collection) : upper(model.name),
    model: modelLine(model),
    lookbookSlug: isLookbookSlug(model.lookbook) ? model.lookbook : null,
    opensAt: s.opensAt,
    image: typeof model.imageUrl === 'string' && MEDIA_SRC.test(model.imageUrl) ? { src: model.imageUrl, alt: RELEASES.photosLabel(upper(s.title)) } : null,
    description: s.description && s.description.trim() ? s.description.trim() : null,
    rows,
    seedHash: groupHex(seedHashHex),
    seedHashHex,
    seed: seedHex ? groupHex(seedHex) : null,
    seedHex,
    drawn: state === 'DRAWN',
    guaranteed: state === 'DRAWN' && Array.isArray(s.guaranteed) ? s.guaranteed.filter((x) => x && isReleaseId(x.id) && Number.isInteger(x.pieces)) : [],
    sizes,
    rule: sizes.length > 0 ? RELEASES.ruleSizes : RELEASES.rule,
  };
}

/** A draw's sizes with pieces, as the server sent them (plan NEXT LOT §3.6.F); none for a draw without sizes. */
export function drawSizes(s: Pick<DropSheet, 'sizes' | 'state'>): DrawSizeModel[] {
  const open = stateOf(s.state) !== 'DRAWN' && stateOf(s.state) !== 'CANCELLED';
  return (Array.isArray(s.sizes) ? s.sizes : [])
    .filter((z) => z && typeof z.id === 'string' && typeof z.label === 'string' && z.label.trim() !== '' && Number.isInteger(z.pieces) && z.pieces > 0)
    .map((z) => ({ id: z.id, label: z.label.trim(), pieces: z.pieces, reserved: Number.isInteger(z.reserved) && z.reserved > 0 ? z.reserved : 0, full: open && z.full === true }));
}

/** Where YOUR SIZE's first size comes from: the entry's, YOUR SIZES' (to be confirmed), the only one. */
export type DrawPickFrom = 'entry' | 'saved' | 'only';

/**
 * The size preselected in a draw's picker, in this order (plan NEXT LOT §3.6.F): the entry's (one withdrawn included:
 * its size is asked again, preselected), the one YOUR SIZES suggests (the server's `savedSize`), the only size; null
 * otherwise (the collector picks one). A size no longer among the draw's is never preselected.
 */
export function drawPick(sizes: readonly DrawSizeModel[], entry: { size?: DrawSizeRef | null } | null, savedSize: DrawSizeRef | null): { sizeId: string | null; from: DrawPickFrom | null } {
  const known = (id: string | undefined | null) => typeof id === 'string' && sizes.some((z) => z.id === id);
  if (entry?.size && known(entry.size.id)) return { sizeId: entry.size.id, from: 'entry' };
  if (savedSize && known(savedSize.id)) return { sizeId: savedSize.id, from: 'saved' };
  return sizes.length === 1 ? { sizeId: sizes[0]!.id, from: 'only' } : { sizeId: null, from: null };
}

/**
 * YOUR SIZE's buttons: each size with pieces, the one picked; during the early access (RESERVE A PLACE) a size whose
 * pieces are all reserved cannot be picked (`unavailable`, its aria-label saying so); while entries are open it stays
 * open to an entry.
 */
export function drawSizeChoices(sizes: readonly DrawSizeModel[], picked: string | null, mode: 'enter' | 'reserve'): { id: string; label: string; selected: boolean; unavailable: boolean; aria: string | null }[] {
  return sizes.map((z) => {
    const unavailable = mode === 'reserve' && z.full;
    return { id: z.id, label: z.label, selected: z.id === picked, unavailable, aria: unavailable ? RELEASES.sizes.full(z.label) : null };
  });
}

/** Under YOUR SIZE while entries are open: a size picked whose pieces are all reserved, said with its waiting list; else null. */
export function drawPickNote(sizes: readonly DrawSizeModel[], picked: string | null, state: DropState): string | null {
  const z = sizes.find((x) => x.id === picked);
  return z && z.full && state === 'OPEN' ? RELEASES.sizes.openFull(z.label) : null;
}

/** The name of a tier as the draw's list says it: 0 is no tier. */
export function tierLabel(tier: number): string {
  return tier === 3 ? 'PALLADIUM' : tier === 2 ? 'PLATINE' : tier === 1 ? 'TITANE' : RELEASES.noTier;
}

export interface DrawLine {
  id: string;
  rank: number;
  /** `1 · PALLADIUM · 3 YEARS` */
  line: string;
  yours: boolean;
}

/** The draw's list as the page shows it: one line per entry, the account's own marked; its size (plan NEXT LOT §3.6.F). */
export function drawLines(entries: readonly DrawEntry[], yours: string | null): DrawLine[] {
  return entries
    .filter((e) => isReleaseId(e?.id) && Number.isInteger(e.rank) && e.rank >= 1)
    .map((e) => {
      const line = RELEASES.entryLine(e.rank, tierLabel(e.tier), Math.max(0, Math.trunc(e.seniority) || 0));
      const size = e.size && typeof e.size.label === 'string' && e.size.label.trim() ? e.size.label.trim() : null;
      return { id: e.id, rank: e.rank, line: size ? RELEASES.entryLineIn(line, size) : line, yours: e.id === yours };
    });
}

/** What the account's entry (or none) means now, and what it may do: ENTER THE DRAW, WITHDRAW, RESERVE A PLACE, or nothing. */
export interface EntryModel {
  /** The status, as a label (ENTERED, PLACE HELD, PLACE RESERVED…); null without an entry. */
  label: string | null;
  sentence: string;
  /** The entry's id (the one the draw publishes); null without one. */
  entryId: string | null;
  /** A LIVE RELEASE entry's reference for ORBES Client Services (`REFERENCE LR-…`), in place of an id. */
  reference?: string | null;
  canEnter: boolean;
  canWithdraw: boolean;
  /** P-X02: RESERVE A PLACE, for a PLATINE or PALLADIUM account while the early access lasts and a piece is left. */
  canReserve: boolean;
  /**
   * A place held or confirmed: WRITE TO ORBES CLIENT SERVICES, the release attached with the account's place in it
   * (`{dropId, label}`, plan NEXT-NINE CS-01); null otherwise.
   */
  write: WriteContext | null;
}

/** A time inside a sentence (a place held until it, entries opening on it): on the phone's clock, its offset named. */
function inSentence(iso: string, offsetMinutes: number): string {
  const t = formatDateTimeLong(iso, offsetMinutes);
  return t ? `${t} (${utcOffsetLabel(offsetMinutes)})` : '';
}

/** The name of a tier that reserves directly (P-X02), null below it. */
function reservingTier(tier: number | undefined): string | null {
  return typeof tier === 'number' && tier >= EARLY_ACCESS_MIN_TIER && tier <= 3 ? tierLabel(tier) : null;
}

/**
 * What the account's entry means now. `release.earlyAccess` and `release.full` (P-X02) come from its page; `opts.tier`
 * is the account's tier now (the club's status; 0 or absent: none), which decides RESERVE A PLACE during the early access.
 */
export function entryModel(
  release: { id: string; title: string; state: DropState; opensAt: string; earlyAccess?: EarlyAccess | null; full?: boolean },
  entry: (Pick<ClubEntry, 'id' | 'status' | 'rank' | 'respondBy'> & { reserved?: boolean; size?: DrawSizeRef | null }) | null,
  opts: { offsetMinutes: number; tier?: number },
): EntryModel {
  const st = RELEASES.status;
  const none = (sentence: string, canEnter = false, canReserve = false): EntryModel => ({ label: null, sentence, entryId: null, canEnter, canWithdraw: false, canReserve, write: null });
  const open = release.state === 'OPEN';
  const opens = inSentence(release.opensAt, opts.offsetMinutes);
  if (!entry) {
    switch (release.state) {
      case 'OPEN':
        return none(release.full ? st.openFull : st.open, true);
      case 'UPCOMING': {
        const early = release.earlyAccess ?? null;
        const tier = reservingTier(opts.tier);
        // BP-19 T3: each tier from its own time, PALLADIUM's first; a release of before reads one time for both.
        const own = early && tier ? (opts.tier === 3 ? early.opensAt : early.platineOpensAt) : null;
        const ownOpen = early && tier ? (opts.tier === 3 ? early.open : early.platineOpen) : false;
        const bothOpen = early ? early.open && early.platineOpen : false;
        if (early?.open) {
          if (release.full) return none(st.full(opens));
          if (tier && ownOpen) return none(st.early(tier, opens), false, true);
          // A PLATINE account during PALLADIUM's hours: when its own begin (none of its own: as any other account).
          if (tier && own) return none(st.earlyPalladium(inSentence(own, opts.offsetMinutes)));
          return none(bothOpen ? st.earlyOthers(opens) : st.earlyOthersPalladium(opens));
        }
        // Before the early access: a PLATINE or PALLADIUM account is told when it may reserve.
        if (early && tier && own && Date.parse(own) < Date.parse(release.opensAt)) return none(st.earlySoon(tier, inSentence(own, opts.offsetMinutes)));
        return none(release.full ? st.full(opens) : st.upcoming(opens));
      }
      case 'CLOSED':
        return none(st.closed);
      case 'DRAWN':
        return none(st.drawn);
      default:
        return none(st.cancelled);
    }
  }
  const reserved = entry.reserved === true && entry.status === 'SELECTED';
  const status = reserved ? RELEASES.reservedLabel : (RELEASES.statusLabel[entry.status as DropEntryStatus] ?? null);
  // Plan NEXT LOT §3.6.F: an entry in a draw with sizes says its size, on its label line and in its sentence.
  const size = entry.size && typeof entry.size.label === 'string' && entry.size.label.trim() ? entry.size.label.trim() : null;
  const label = status && size ? RELEASES.sizes.label(status, size) : status;
  const base = { label, entryId: isReleaseId(entry.id) ? entry.id : null, canEnter: false, canWithdraw: false, canReserve: false, write: null };
  if (release.state === 'CANCELLED') return { ...base, sentence: st.cancelled };
  switch (entry.status) {
    case 'ENTERED':
      return { ...base, sentence: open ? (size ? st.enteredIn(size) : st.entered) : st.enteredClosed, canWithdraw: release.state === 'OPEN' || release.state === 'CLOSED' };
    case 'WITHDRAWN':
      return { ...base, sentence: open ? st.withdrawn : st.withdrawnClosed, canEnter: open };
    case 'SELECTED': {
      const until = entry.respondBy ? inSentence(entry.respondBy, opts.offsetMinutes) : '';
      return {
        ...base,
        sentence: reserved ? (size ? st.reservedIn(size, until) : st.reserved(until)) : size ? st.selectedIn(size, until) : st.selected(until),
        write: releaseContext(release.id, release.title, label),
      };
    }
    case 'WAITLISTED':
      return { ...base, sentence: size ? st.waitlistedIn(size, entry.rank ?? 0) : st.waitlisted(entry.rank ?? 0) };
    case 'CONFIRMED':
      return { ...base, sentence: st.confirmed, write: releaseContext(release.id, release.title, label) };
    default:
      return { ...base, sentence: st.lapsed };
  }
}

/**
 * SHARE TO STORIES on a draw's page (plan NEXT-NINE, §3.8 BP-10): the SELECTED story card of the account's place, drawn
 * (SELECTED), reserved directly (PLACE RESERVED) or concluded (CONFIRMED): DRAW, the draw's title (its model's name on a
 * line of its own), the day of the draw or, for a reservation, the day it was reserved, on this phone's calendar
 * (`offsetMinutes` east of UTC). Null for any other entry, a cancelled release, or without the release's photograph.
 */
export function drawStoryModel(
  s: Pick<ReleaseSheetModel, 'state' | 'title' | 'model' | 'image'>,
  entry: Pick<ClubEntry, 'status' | 'reserved' | 'enteredAt' | 'drawnAt'> | null,
  offsetMinutes: number,
): StoryCardModel | null {
  if (!entry || s.state === 'CANCELLED' || (entry.status !== 'SELECTED' && entry.status !== 'CONFIRMED')) return null;
  const model = s.model.split(' · ')[0]?.trim() || null;
  return storyCardModel('draw', { photo: s.image?.src, title: s.title, model, at: entry.reserved === true ? entry.enteredAt : entry.drawnAt, zone: offsetMinutes });
}

/** One entry of MY PIECES: its release (a link to its page), its status and what it means now. */
export interface MyEntryModel {
  id: string;
  dropId: string;
  href: string;
  /** An after-room's entry: the release it follows (its page is read through it). */
  afterRoomOf?: string;
  title: string;
  stateLabel: string;
  entry: EntryModel;
  /** IN-01: the entry uses the house's guarantee, shown to the client: its small label beside the status. */
  guaranteed?: boolean;
}

export function myEntries(entries: readonly ClubEntry[], opts: { offsetMinutes: number }): MyEntryModel[] {
  return entries
    .filter((e) => isReleaseId(e?.dropId) && typeof e.title === 'string')
    .map((e) => {
      const state = stateOf(e.state);
      return {
        id: e.id,
        dropId: e.dropId,
        href: releasePath(e.dropId),
        title: upper(e.title),
        stateLabel: RELEASES.state[state],
        // An entry exists: the early access no longer decides anything (a reservation reads PLACE RESERVED).
        entry: entryModel({ id: e.dropId, title: upper(e.title), state, opensAt: e.opensAt }, e, opts),
        guaranteed: e.guaranteed === true,
      };
    });
}

// ── THE RELEASES' PAST (plan LIVE RELEASE+, choice 5) ──────────────────────

/** The releases PAST reads at a time (SHOW MORE reads the next ones). */
export const PAST_PAGE_SIZE = 12;

/** A release of PAST: what was announced, never an end figure; the account's part in it is set by `pastMark`. */
export interface PastCardModel {
  id: string;
  href: string;
  /** LIVE RELEASE or DRAW. */
  kind: string;
  /** A LIVE RELEASE's model with its variant (`MONOLITHE IN STEEL`), as its card and page name it; a draw's title, as its card does. */
  title: string;
  /** A LIVE RELEASE's type and collection; a draw's model and type. */
  model: string;
  /** `11 OCT 2026 · 25 PIECES`: the opening date on this phone's calendar, the quantity as announced. */
  line: string;
  /** `11 OCT 2026`: the opening date on this phone's calendar, after the kind (C25: `LIVE RELEASE · 11 OCT 2026`). */
  date: string;
  /** `25 PIECES`: the quantity as announced. */
  pieces: string;
  image: ReleasePhoto | null;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** `11 OCT 2026`: the date of `iso` on the calendar of `timeZone` (UTC when the zone is unknown); '' when unreadable. */
export function zonedDate(iso: string, timeZone: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  let f = dayFormatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
    }
    dayFormatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return formatDate(`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`);
}

/** The releases of a page of PAST, in the server's order; one without an id of its own is left out. */
export function pastCards(items: readonly PastRelease[], localZone: string): PastCardModel[] {
  const out: PastCardModel[] = [];
  for (const c of items) {
    if (!isReleaseId(c?.id) || (c.kind !== 'LIVE' && c.kind !== 'DRAW')) continue;
    const m = c.model ?? { name: null, type: null, collection: null };
    const live = c.kind === 'LIVE';
    // A LIVE RELEASE is named by its model, from its name's stage (one ended before it: LIVE RELEASE); a draw by its title.
    const named = typeof m.name === 'string' && m.name.trim() !== '';
    const title = live ? (named ? upper(modelWithVariant(m.name!, m.variant)) : RELEASES.past.kind.LIVE) : upper(c.title ?? '');
    const model = live ? [upper(m.type), upper(m.collection)].filter((x) => x.length > 0).join(' · ') : modelLine({ name: m.name ?? '', type: m.type ?? '' });
    out.push({
      id: c.id,
      href: releasePath(c.id),
      kind: RELEASES.past.kind[c.kind],
      title,
      model,
      line: RELEASES.past.line(zonedDate(c.opensAt, localZone), upper(c.quantityLine)),
      date: zonedDate(c.opensAt, localZone),
      pieces: upper(c.quantityLine),
      image: typeof c.imageUrl === 'string' && MEDIA_SRC.test(c.imageUrl) ? { src: c.imageUrl, alt: RELEASES.photosLabel(title) } : null,
    });
  }
  return out;
}

/**
 * PAST read a page at a time (SHOW MORE). The next page is counted, never worked out from the releases shown: a release
 * that ends between two pages moves the others down (one already shown comes again, and is shown once) and one
 * unreadable is left out, so fewer releases may be shown than the pages read. SHOW MORE stays while a page is left on
 * the server, and so reaches the last release.
 */
export class PastPages {
  /** The releases shown, each once, in the order read. */
  readonly cards: PastCardModel[] = [];
  private read = 0;
  private total = 0;

  /** The page to ask for next: the first before any is read. */
  get next(): number {
    return this.read + 1;
  }

  /** Whether SHOW MORE has a page left to read. */
  get more(): boolean {
    return this.cards.length > 0 && this.read * PAST_PAGE_SIZE < this.total;
  }

  /** Page `page` read, `total` releases ended on the server: its releases not shown yet, added in order and returned. */
  add(page: number, cards: readonly PastCardModel[], total: number): PastCardModel[] {
    const known = new Set(this.cards.map((c) => c.id));
    const fresh: PastCardModel[] = [];
    for (const c of cards) {
      if (known.has(c.id)) continue;
      known.add(c.id);
      fresh.push(c);
    }
    this.cards.push(...fresh);
    this.read = Math.max(this.read, page);
    this.total = Number.isInteger(total) && total > 0 ? total : 0;
    return fresh;
  }
}

/** The account's part in the releases: how many, and for each, YOU SECURED A PIECE or YOU TOOK PART. */
export interface ParticipationModel {
  /** « You have taken part in N releases. » */
  taken: string;
  marks: ReadonlyMap<string, string>;
}

export function participationModel(p: Participation): ParticipationModel {
  const marks = new Map<string, string>();
  for (const r of Array.isArray(p?.releases) ? p.releases : []) {
    if (isReleaseId(r?.id)) marks.set(r.id, r.secured === true ? RELEASES.past.secured : RELEASES.past.tookPart);
  }
  const count = Number.isInteger(p?.count) && p.count >= 0 ? p.count : marks.size;
  return { taken: RELEASES.past.taken(count), marks };
}
