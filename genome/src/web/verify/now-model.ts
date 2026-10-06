/**
 * NOW (plan NOCTURNE, screen 1, step N3; /verify, in place of the landing) — what it shows, pure (no DOM) and
 * unit-tested.
 *
 * What leads (the owner's choices, 2026-10-05): NOW always has a hero, chosen in this order —
 *   1. a LIVE RELEASE announced, its room open or live (C1, C10): it leads; a draw open, soon open or in its early access
 *      then follows it as a plate card;
 *   2. else such a draw leads as the hero (C42);
 *   3. else the newest model of the collection leads (C43): the PUBLIC entry most recently published (a model and its
 *      variants counted once, shown by its main model; THE PRIVATE SALON's models are never in that list);
 *   with none of them, NOW opens on YOUR PIECES (signed in) or the scan (signed out). With several releases of a kind, the
 *   first in THE RELEASES' own order leads (the server's lists: the next LIVE RELEASE first, then the draws as listed).
 *
 * Under it: the account's pieces (two side by side, their model's photographs, never a piece's own: decision 9) and its
 * tier in one line; THE CIRCLE's next invitation with YES / NO (addition 6, circle-model.ts invitationReply); THE
 * COLLECTION (a photograph of the newest entry, of a model the hero does not show); the scan.
 */
import { circleCards, type CircleCardModel } from './circle-model.js';
import { LIVE, LOOKBOOK, NOW, PHOTOS, RELEASES, TIER } from './copy.js';
import { countdown, formatMoney, interestLine, pictureOf, releaseTime, type LivePicture } from './live-model.js';
import { entryDots, entryPhoto, entryPublishedAt, sizesLine, youOwn, type EntryDot, type LookbookPhoto } from './lookbook-model.js';
import { drawLeads } from './nocturne-model.js';
import { isReleaseId, releaseCards, releasePath, twoClocks } from './releases-model.js';
import { isLookbookSlug } from '../shared/lookbook.js';
import type { CircleCard, ClubStatus, DropCard, LiveCard, LookbookCard, OwnedPiece } from './types.js';
import { formatDateTime, modelWithVariant, upper } from './view-model.js';

// ── What leads ─────────────────────────────────────────────────────────────

export type NowTop =
  | { kind: 'live'; live: LiveCard; draw: DropCard | null }
  | { kind: 'draw'; draw: DropCard }
  | { kind: 'collection'; entry: LookbookCard }
  | { kind: 'none' };

/** A LIVE RELEASE that leads: announced, its room open, or live (the server lists none that has ended). */
export function liveLeads(c: LiveCard): boolean {
  return c?.kind === 'LIVE' && isReleaseId(c.id) && (c.phase === 'ANNOUNCED' || c.phase === 'ROOM' || c.phase === 'LIVE');
}

/** A draw that leads, or follows a LIVE RELEASE: open, soon open, or in its early access. */
export function drawCanLead(d: DropCard): boolean {
  return isReleaseId(d?.id) && typeof d.title === 'string' && drawLeads(d);
}

/** The newest entry of the collection: the one last published (the first of the list on a tie, or when none says). */
export function newestEntry(entries: readonly LookbookCard[]): LookbookCard | null {
  let best: LookbookCard | null = null;
  let bestAt = -Infinity;
  for (const e of entries) {
    if (!isLookbookSlug(e?.slug)) continue;
    const at = entryPublishedAt(e) ?? -Infinity;
    if (best === null || at > bestAt) {
      best = e;
      bestAt = at;
    }
  }
  return best;
}

/** What leads NOW: a LIVE RELEASE (with the draw under it), else a draw, else the newest model, else nothing. */
export function nowTop(live: readonly LiveCard[], drops: readonly DropCard[], collection: readonly LookbookCard[]): NowTop {
  const release = live.find(liveLeads) ?? null;
  const draw = drops.find(drawCanLead) ?? null;
  if (release) return { kind: 'live', live: release, draw };
  if (draw) return { kind: 'draw', draw };
  const entry = newestEntry(collection);
  return entry ? { kind: 'collection', entry } : { kind: 'none' };
}

// ── A LIVE RELEASE leads (C1, C10) ─────────────────────────────────────────

export interface LiveHeroModel {
  id: string;
  href: string;
  /** The release's title once its name is revealed (`MONOLITHE IN BLUE`), else TO BE REVEALED. */
  title: string;
  /** The model's name once revealed (`MONOLITHE`): the title sets it on a line of its own. */
  model: string | null;
  /** `BRACELET · ORBITAL` once the name is revealed. */
  line: string | null;
  picture: LivePicture | null;
  /** `THURSDAY 8 OCTOBER · 21:00 PARIS`, then on this phone when its zone says it otherwise. */
  when: { paris: string; local: string | null };
  /** `25 PIECES` (first, in ivory), `ONE PER COLLECTOR`, `FOR OWNERS`. */
  lines: string[];
  /** `5 COLLECTORS WILL BE THERE`, or null before anyone said so. */
  interest: string | null;
  /** Its moments (ms): the room's opening, T0, the end. */
  roomOpensAt: number;
  opensAt: number;
  closesAt: number;
}

export function liveHero(c: LiveCard, localZone: string): LiveHeroModel {
  const named = typeof c.name === 'string' && c.name.trim() !== '';
  const title = typeof c.title === 'string' && c.title.trim() ? upper(c.title) : named ? upper(modelWithVariant(c.name!, c.variant)) : LIVE.unnamed;
  const access = typeof c.access?.text === 'string' && c.access.text.trim() ? LIVE.forWhom(c.access.text.trim()) : null;
  return {
    id: c.id,
    href: releasePath(c.id),
    title,
    model: named ? upper(c.name) : null,
    line: named ? [upper(c.type), upper(c.collection)].filter((x) => x.length > 0).join(' · ') || null : null,
    picture: pictureOf(c),
    when: releaseTime(c.opensAt, localZone),
    lines: [upper(c.quantityLine), Number.isInteger(c.perAccount) && c.perAccount > 0 ? LIVE.perAccount(c.perAccount) : '', access ?? ''].filter((x) => x.length > 0),
    interest: interestLine(c.interest),
    roomOpensAt: Date.parse(c.roomOpensAt),
    opensAt: Date.parse(c.opensAt),
    closesAt: Date.parse(c.closesAt),
  };
}

/** Where the leading LIVE RELEASE stands at `now` (ms, the server's clock as this device estimates it). */
export interface LivePhaseModel {
  /** LIVE RELEASE, LIVE RELEASE · THE ROOM IS OPEN, LIVE RELEASE · LIVE NOW (THE RELEASES' own words). */
  kind: string;
  /** Until T0: OPENS IN and its groups (DAYS HOURS MINUTES, or HOURS MINUTES SECONDS within a day); null once live. */
  countdown: { value: string; unit: string }[] | null;
  /** Its end has come: NOW reads what leads again. */
  ended: boolean;
}

export function livePhase(h: Pick<LiveHeroModel, 'roomOpensAt' | 'opensAt' | 'closesAt'>, now: number): LivePhaseModel {
  if (Number.isFinite(h.closesAt) && now >= h.closesAt) return { kind: LIVE.kind, countdown: null, ended: true };
  if (Number.isFinite(h.opensAt) && now >= h.opensAt) return { kind: `${LIVE.kind} · ${LIVE.phase.LIVE}`, countdown: null, ended: false };
  const room = Number.isFinite(h.roomOpensAt) && now >= h.roomOpensAt;
  return { kind: room ? `${LIVE.kind} · ${LIVE.phase.ROOM}` : LIVE.kind, countdown: Number.isFinite(h.opensAt) ? countdown(h.opensAt - now) : null, ended: false };
}

// ── A draw (C42, and its card under a LIVE RELEASE in C1) ──────────────────

export interface DrawLeadModel {
  id: string;
  href: string;
  /** DRAW · ENTRIES OPEN, DRAW · ENTRIES OPEN SOON, DRAW · EARLY ACCESS */
  kind: string;
  title: string;
  /** `MONOLITHE · BRACELET` */
  model: string;
  /** `€ 4 200`, or null when ORBES gave no price. */
  price: string | null;
  /** `12 PIECES · ENTRIES CLOSE` and the time that matters, in UTC (`11 OCT 2026 · 18:00 UTC`), never parted. */
  line: { lead: string; time: string };
  /** The same time on this phone (`11 OCT 2026 · 20:00 on this phone (UTC+02:00)`), when it is not UTC. */
  local: string | null;
  image: { src: string; alt: string } | null;
}

export function drawLead(d: DropCard, offsetMinutes: number): DrawLeadModel | null {
  const card = releaseCards([d])[0];
  if (!card) return null;
  const pieces = RELEASES.pieces(Number(d.quantity) || 0);
  const soon = card.state === 'UPCOMING';
  const at = soon ? d.opensAt : d.closesAt;
  const time = RELEASES.utc(formatDateTime(at, 0));
  const full = soon ? RELEASES.opensLine(pieces, formatDateTime(at, 0)) : RELEASES.closesLine(pieces, formatDateTime(at, 0));
  const lead = full.endsWith(time) ? full.slice(0, full.length - time.length).trimEnd() : full;
  const price = typeof d.priceMinor === 'number' && typeof d.currency === 'string' ? formatMoney(d.priceMinor, d.currency) : null;
  return {
    id: card.id,
    href: card.href,
    kind: `${NOW.draw} · ${card.stateLabel}`,
    title: card.title,
    model: card.model,
    price,
    line: { lead, time: full.endsWith(time) ? time : '' },
    local: twoClocks(at, offsetMinutes).local,
    image: card.image,
  };
}

// ── The newest model (C43), and THE COLLECTION's photograph ────────────────

export interface CollectionHeroModel {
  /** The main model's address (its sheet); a dot's once selected. */
  slug: string;
  /** THE COLLECTION · ORBITAL */
  label: string;
  name: string;
  type: string;
  /** SIZES 16 · 17 · 18, or null. */
  sizes: string | null;
  /** Its variants (the main model first), or none. */
  dots: EntryDot[];
  image: LookbookPhoto | null;
  /** « You own two: steel and gold », or null. */
  owned: string | null;
}

export function collectionHero(e: LookbookCard, pieces: readonly Pick<OwnedPiece, 'lookbook'>[]): CollectionHeroModel {
  const collection = upper(e.collection);
  return {
    slug: e.slug,
    label: collection ? `${LOOKBOOK.title} · ${collection}` : LOOKBOOK.title,
    name: upper(e.name),
    type: upper(e.type),
    sizes: sizesLine(e.sizes),
    dots: entryDots(e),
    image: entryPhoto(e),
    owned: pieces.length > 0 ? youOwn(e, pieces) : null,
  };
}

export interface CollectionTeaserModel {
  /** The entry's collection (`ORBITAL`), beside the section's title; null without one. */
  collection: string | null;
  name: string;
  type: string;
  image: LookbookPhoto | null;
}

/**
 * THE COLLECTION under the hero (C1, C10, C42): the newest entry, by a photograph the hero does not show: of its models,
 * the one in the collection the longest that is not the hero's (`heroSlug`, the address of the release's model), else
 * the entry's own.
 */
export function collectionTeaser(e: LookbookCard, heroSlug: string | null): CollectionTeaserModel {
  const dots = entryDots(e).filter((d) => d.slug !== heroSlug && d.image !== null);
  const first = dots.reduce<EntryDot | null>((a, d) => (a === null || (d.publishedAt ?? Infinity) < (a.publishedAt ?? Infinity) ? d : a), null);
  return {
    collection: e.collection && e.collection.trim() ? upper(e.collection) : null,
    name: upper(e.name),
    type: upper(e.type),
    image: first?.image ?? entryPhoto(e),
  };
}

// ── YOUR PIECES ────────────────────────────────────────────────────────────

export interface NowPieceModel {
  productId: string;
  /** MONOLITHE */
  name: string;
  /** The model's photograph (decision 9), named after the model and its variant; null without one. */
  image: { src: string; alt: string } | null;
}

/** YOUR PIECES: the first two of MY PIECES (its order: the newest first), each by its model's photograph. */
export function nowPieces(pieces: readonly OwnedPiece[]): NowPieceModel[] {
  return pieces
    .filter((p) => typeof p?.productId === 'string')
    .slice(0, 2)
    .map((p) => {
      const src = typeof p.imageUrl === 'string' && /^\/api\/v1\/media\/[0-9a-f]{64}$/.test(p.imageUrl) ? p.imageUrl : null;
      return { productId: p.productId, name: upper(p.model), image: src ? { src, alt: PHOTOS.modelAlt(upper(p.model), upper(p.type), p.modelVariant) } : null };
    });
}

/** The tier's one line under YOUR PIECES (decision 10: the whole block is the account sheet's): `TITANE` and its sentence. */
export interface TierLineModel {
  /** TITANE, PLATINE, PALLADIUM; THE CLUB without a tier. */
  name: string;
  /** `2 pieces held. 1 more piece registered to your account opens PLATINE, from 3 pieces held.` */
  text: string;
}

const TIER_NAMES = ['TITANE', 'PLATINE', 'PALLADIUM'] as const;

export function tierLine(status: Pick<ClubStatus, 'tier' | 'pieces' | 'next'> | null): TierLineModel | null {
  if (!status) return null;
  const level = Number.isInteger(status.tier?.level) ? status.tier.level : 0;
  const name = level >= 1 && level <= 3 ? TIER_NAMES[level - 1]! : null;
  const n = status.next;
  const next = n && (TIER_NAMES as readonly string[]).includes(n.name) && n.level === level + 1 ? n : null;
  const pieces = Number.isInteger(status.pieces) && status.pieces >= 0 ? status.pieces : 0;
  if (name === null) return next ? { name: TIER.noneLabel, text: TIER.firstWay(next.name) } : null;
  const way = next ? TIER.way(next.name, Math.max(1, Number(next.missing) || 0), Number(next.pieces) || 0) : name === 'PALLADIUM' ? TIER.top : '';
  return { name, text: [`${TIER.pieces(pieces)}.`, way].filter((x) => x.length > 0).join(' ') };
}

// ── THE CIRCLE ─────────────────────────────────────────────────────────────

/** THE CIRCLE's next invitation: of the feed's invitations whose answers are open, the one whose event comes first. */
export function nextInvitation(items: readonly CircleCard[], now: number): CircleCardModel | null {
  const at = new Map(items.map((c) => [c?.id, Date.parse(c?.eventAt ?? '')] as const));
  const open = circleCards(items).filter((c) => c.kind === 'INVITATION' && c.reply?.open === true && (at.get(c.id) ?? NaN) > now);
  open.sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  return open[0] ?? null;
}
