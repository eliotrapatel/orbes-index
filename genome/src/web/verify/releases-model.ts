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
 *  - The early access (P-X02): the line under a release's state
 *    (PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …), its facts (when it
 *    opens, the places reserved directly), and, for an account PLATINE or
 *    PALLADIUM while it lasts, RESERVE A PLACE; a release whose every piece
 *    is reserved says so.
 *
 * Nothing the server did not send: a photograph is taken from this origin's
 * media route only, an address only if it is one.
 */
import { isLookbookSlug } from '../shared/lookbook.js';
import { RELEASES } from './copy.js';
import type { ClientServices, ClubEntry, DropCard, DropEntryStatus, DropSheet, DropState, DrawEntry } from './types.js';
import { formatDateTime, formatDateTimeLong, releaseContactModel, upper, utcOffsetLabel, type ContactModel } from './view-model.js';

/** The list of the releases, and the page of one under it. */
export const RELEASES_PATH = '/verify/releases';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_SRC = /^\/api\/v1\/media\/[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function releasePath(id: string): string {
  return `${RELEASES_PATH}/${id}`;
}

/** Whether `id` is the id of a release (a lower-case uuid). */
export function isReleaseId(id: string | null | undefined): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * The route of a path under /verify/releases: the list, a release by its id, or a LIVE RELEASE's boutique board
 * (`/verify/releases/<id>/board`, its secret in the fragment); anything else is the list.
 */
export function releasesRouteOf(path: string): { release: string | null; board?: true } | null {
  const p = path.replace(/\/+$/, '').toLowerCase();
  if (p === RELEASES_PATH) return { release: null };
  if (!p.startsWith(`${RELEASES_PATH}/`)) return null;
  const rest = p.slice(RELEASES_PATH.length + 1);
  const board = /^([^/]+)\/board$/.exec(rest);
  if (board && isReleaseId(board[1])) return { release: board[1]!, board: true };
  return { release: isReleaseId(rest) ? rest : null };
}

const STATES = new Set<DropState>(['UPCOMING', 'OPEN', 'CLOSED', 'DRAWN', 'CANCELLED']);
const stateOf = (s: unknown): DropState => (STATES.has(s as DropState) ? (s as DropState) : 'CLOSED');

/** The lowest tier that reserves a place directly during an early access (P-X02): PLATINE (server: EARLY_ACCESS_MIN_TIER). */
export const EARLY_ACCESS_MIN_TIER = 2;

/** The early access of a release as the server sent it (P-X02): when it opens, and whether it is open now; null without one. */
export interface EarlyAccess {
  opensAt: string;
  open: boolean;
}

/** A release's early access, when the server names a valid time for it, and only before entries open to everyone. */
export function earlyAccessOf(c: Pick<DropCard, 'state' | 'earlyAccessOpensAt' | 'earlyAccessOpen'>): EarlyAccess | null {
  const at = c?.earlyAccessOpensAt;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return { opensAt: at, open: c.earlyAccessOpen === true && stateOf(c.state) === 'UPCOMING' };
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
  image: ReleasePhoto | null;
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
  /** P-X02: `PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …` (UTC), under the state; null without an early access. */
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
  /** Once drawn: how many entries took part. */
  entries: number | null;
  drawn: boolean;
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
  const rows: ReleaseRow[] = [{ label: RELEASES.rows.pieces, value: String(quantity) }];
  const earlyAt = early ? twoClocks(early.opensAt, offsetMinutes) : null;
  if (earlyAt) rows.push({ label: RELEASES.rows.early, value: earlyAt.utc, local: earlyAt.local });
  rows.push(
    { label: RELEASES.rows.opens, value: opens.utc, local: opens.local },
    { label: RELEASES.rows.closes, value: closes.utc, local: closes.local },
    { label: RELEASES.rows.held, value: RELEASES.hours(Number(s.purchaseWindowHours) || 0) },
  );
  // The places reserved directly, once the early access has begun: before the draw, what is left of the pieces.
  if (early && (early.open || state !== 'UPCOMING' || reserved > 0)) rows.push({ label: RELEASES.rows.reserved, value: RELEASES.reservedOf(reserved, quantity) });
  if (s.drawnAt) {
    const drawn = twoClocks(s.drawnAt, offsetMinutes);
    rows.push({ label: RELEASES.rows.drawn, value: drawn.utc, local: drawn.local });
  }
  const full = quantity > 0 && reserved >= quantity && (state === 'UPCOMING' || state === 'OPEN' || state === 'CLOSED');
  const seedHashHex = typeof s.seedHash === 'string' && HEX64.test(s.seedHash) ? s.seedHash : '';
  const seedHex = state === 'DRAWN' && typeof s.seed === 'string' && HEX64.test(s.seed) ? s.seed : null;
  const model = s.model ?? { name: '', type: '', collection: null, imageUrl: null, lookbook: null };
  return {
    id: s.id,
    title: upper(s.title),
    state,
    stateLabel: [stateLabelOf(state, early), full ? RELEASES.fullState : ''].filter((x) => x.length > 0).join(' · '),
    earlyAccess: early,
    access: earlyAt && opens.utc ? RELEASES.access(earlyAt.utc, opens.utc) : null,
    earlyNote: early ? RELEASES.earlyNote : null,
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
    entries: state === 'DRAWN' && typeof s.entries === 'number' ? s.entries : null,
    drawn: state === 'DRAWN',
  };
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

/** The draw's list as the page shows it: one line per entry, the account's own marked. */
export function drawLines(entries: readonly DrawEntry[], yours: string | null): DrawLine[] {
  return entries
    .filter((e) => isReleaseId(e?.id) && Number.isInteger(e.rank) && e.rank >= 1)
    .map((e) => ({ id: e.id, rank: e.rank, line: RELEASES.entryLine(e.rank, tierLabel(e.tier), Math.max(0, Math.trunc(e.seniority) || 0)), yours: e.id === yours }));
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
  /** A place held: ORBES Client Services will contact the account; their contact follows. */
  contact: ContactModel | null;
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
  entry: (Pick<ClubEntry, 'id' | 'status' | 'rank' | 'respondBy'> & { reserved?: boolean }) | null,
  opts: { offsetMinutes: number; clientServices?: ClientServices; tier?: number },
): EntryModel {
  const st = RELEASES.status;
  const none = (sentence: string, canEnter = false, canReserve = false): EntryModel => ({ label: null, sentence, entryId: null, canEnter, canWithdraw: false, canReserve, contact: null });
  const open = release.state === 'OPEN';
  const opens = inSentence(release.opensAt, opts.offsetMinutes);
  if (!entry) {
    switch (release.state) {
      case 'OPEN':
        return none(release.full ? st.openFull : st.open, true);
      case 'UPCOMING': {
        const early = release.earlyAccess ?? null;
        const tier = reservingTier(opts.tier);
        if (early?.open) {
          if (release.full) return none(st.full(opens));
          return tier ? none(st.early(tier, opens), false, true) : none(st.earlyOthers(opens));
        }
        // Before the early access: a PLATINE or PALLADIUM account is told when it may reserve.
        if (early && tier && Date.parse(early.opensAt) < Date.parse(release.opensAt)) return none(st.earlySoon(tier, inSentence(early.opensAt, opts.offsetMinutes)));
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
  const label = reserved ? RELEASES.reservedLabel : (RELEASES.statusLabel[entry.status as DropEntryStatus] ?? null);
  const base = { label, entryId: isReleaseId(entry.id) ? entry.id : null, canEnter: false, canWithdraw: false, canReserve: false, contact: null };
  if (release.state === 'CANCELLED') return { ...base, sentence: st.cancelled };
  switch (entry.status) {
    case 'ENTERED':
      return { ...base, sentence: open ? st.entered : st.enteredClosed, canWithdraw: release.state === 'OPEN' || release.state === 'CLOSED' };
    case 'WITHDRAWN':
      return { ...base, sentence: open ? st.withdrawn : st.withdrawnClosed, canEnter: open };
    case 'SELECTED': {
      const until = entry.respondBy ? inSentence(entry.respondBy, opts.offsetMinutes) : '';
      return {
        ...base,
        sentence: reserved ? st.reserved(until) : st.selected(until),
        contact: releaseContactModel(opts.clientServices, release.title, entry.id, label ?? undefined),
      };
    }
    case 'WAITLISTED':
      return { ...base, sentence: st.waitlisted(entry.rank ?? 0) };
    case 'CONFIRMED':
      return { ...base, sentence: st.confirmed };
    default:
      return { ...base, sentence: st.lapsed };
  }
}

/** One entry of MY PIECES: its release (a link to its page), its status and what it means now. */
export interface MyEntryModel {
  id: string;
  dropId: string;
  href: string;
  title: string;
  stateLabel: string;
  entry: EntryModel;
}

export function myEntries(entries: readonly ClubEntry[], opts: { offsetMinutes: number; clientServices?: ClientServices }): MyEntryModel[] {
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
      };
    });
}
