/**
 * THE CIRCLE (P-X01): the feed and the posts of the owners' circle (API
 * §10.11) → what /verify/circle and /verify/circle/<id> show. Pure (no DOM)
 * and unit-tested, like the releases' and the lookbook's.
 *
 *  - The feed: each post's kind, title, day of publication, the tiers it is
 *    reserved to (above the first), its first photograph, an invitation's
 *    event (UTC), what the reader did (answered, voted), and its one text
 *    link, named after its kind.
 *  - A post: its photographs (the operator's alternative text, else "TITLE,
 *    photographed by ORBES"), its body (shared/lookbook.ts draws its
 *    paragraphs), an invitation's facts (the time in UTC then on the phone's
 *    clock, the place, the places left) and the reader's answer, a poll's
 *    options and, once voted, its results; its links: a release's page, a
 *    model's sheet, an address of another site with its host.
 *
 * Nothing the server did not send: a photograph is taken from this origin's
 * media route only, an address of this app only if it is one, and the link to
 * another site only in https, on a host of the code's list.
 */
import { isLookbookSlug } from '../shared/lookbook.js';
import { CIRCLE } from './copy.js';
import { isReleaseId, releasePath, twoClocks, type ReleaseRow } from './releases-model.js';
import type { CircleAnswer, CircleCard, CirclePost, CirclePostKind } from './types.js';
import { formatDate, formatDateTime, upper } from './view-model.js';

/** The feed of the circle, and the page of one post under it. */
export const CIRCLE_PATH = '/verify/circle';

/** The hosts a post's link may name (the server's CIRCLE_LINK_HOSTS, services/circle.ts), and their subdomains. */
export const CIRCLE_LINK_HOSTS: readonly string[] = Object.freeze(['theorbes.com', 'youtube.com', 'vimeo.com']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_SRC = /^\/api\/v1\/media\/[0-9a-f]{64}$/;
const KINDS = new Set<CirclePostKind>(['NOTE', 'INVITATION', 'POLL']);

export function circlePostPath(id: string): string {
  return `${CIRCLE_PATH}/${id}`;
}

/** Whether `id` is the id of a post (a lower-case uuid). */
export function isCirclePostId(id: string | null | undefined): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** The route of a path under /verify/circle: the feed, or a post by its id (anything else is the feed). */
export function circleRouteOf(path: string): { post: string | null } | null {
  const p = path.replace(/\/+$/, '').toLowerCase();
  if (p === CIRCLE_PATH) return { post: null };
  if (!p.startsWith(`${CIRCLE_PATH}/`)) return null;
  const id = p.slice(CIRCLE_PATH.length + 1);
  return { post: isCirclePostId(id) ? id : null };
}

/** The address of another site a post links, when it is one the server keeps (https, a host of the list): its host as shown. */
export function externalLink(url: string | null | undefined): { href: string; host: string } | null {
  if (typeof url !== 'string') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || !CIRCLE_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return { href: u.href, host: host.replace(/^www\./, '') };
}

export interface CirclePhotoModel {
  src: string;
  alt: string;
}

const kindOf = (k: unknown): CirclePostKind => (KINDS.has(k as CirclePostKind) ? (k as CirclePostKind) : 'NOTE');

/** The tiers a post is reserved to, above the first (every owner reads a post of the first: nothing said). */
function reachOf(minTier: unknown): string | null {
  return minTier === 3 ? CIRCLE.reach[3] : minTier === 2 ? CIRCLE.reach[2] : null;
}

function photo(p: { url?: unknown; alt?: unknown } | null | undefined, title: string): CirclePhotoModel | null {
  if (!p || typeof p.url !== 'string' || !MEDIA_SRC.test(p.url)) return null;
  return { src: p.url, alt: typeof p.alt === 'string' && p.alt.trim() ? p.alt.trim() : CIRCLE.photoAlt(title) };
}

/** An invitation's event, in UTC: `12 OCT 2026 · 19:00 UTC · PARIS`. */
function eventLine(eventAt: string | null, place: string | null): string | null {
  const t = eventAt ? formatDateTime(eventAt, 0) : '';
  if (!t) return null;
  return [`${t} UTC`, place && place.trim() ? upper(place) : ''].filter((x) => x.length > 0).join(' · ');
}

export interface CircleCardModel {
  id: string;
  href: string;
  kind: CirclePostKind;
  kindLabel: string;
  title: string;
  /** The day it was published: `3 OCT 2026`. */
  date: string;
  /** PLATINE AND PALLADIUM, or PALLADIUM; null for every owner. */
  reach: string | null;
  image: CirclePhotoModel | null;
  /** An invitation's event (UTC). */
  event: string | null;
  /** YOU ANSWERED YES, YOU VOTED; null otherwise. */
  mine: string | null;
  /** READ THE NOTE, SEE THE INVITATION, SEE THE POLL. */
  linkLabel: string;
}

/** The posts of the feed, in the server's order; one without an id of its own is left out. */
export function circleCards(cards: readonly CircleCard[]): CircleCardModel[] {
  const out: CircleCardModel[] = [];
  for (const c of cards) {
    if (!isCirclePostId(c?.id) || typeof c.title !== 'string') continue;
    const kind = kindOf(c.kind);
    const title = upper(c.title);
    out.push({
      id: c.id,
      href: circlePostPath(c.id),
      kind,
      kindLabel: CIRCLE.kind[kind],
      title,
      date: formatDate(c.publishedAt),
      reach: reachOf(c.minTier),
      image: photo(c.cover, title),
      event: kind === 'INVITATION' ? eventLine(c.eventAt, c.eventPlace) : null,
      mine: kind === 'INVITATION' && (c.answer === 'YES' || c.answer === 'NO') ? CIRCLE.answered(c.answer) : kind === 'POLL' && c.voted === true ? CIRCLE.voted : null,
      linkLabel: CIRCLE.see[kind],
    });
  }
  return out;
}

export interface InvitationModel {
  rows: ReleaseRow[];
  answer: CircleAnswer | null;
  /** Answers are taken: the event has not begun. */
  open: boolean;
  /** Every place is taken, and the reader has not one of them. */
  full: boolean;
  /** What the reader's answer, or its absence, means now. */
  sentence: string;
}

export interface PollModel {
  options: { index: number; label: string; chosen: boolean }[];
  voted: boolean;
  /** Once voted: each option, its votes and its share, the reader's own marked. */
  results: { label: string; votes: string; share: string; mine: boolean }[] | null;
  sentence: string;
}

export interface CirclePostModel {
  id: string;
  kind: CirclePostKind;
  kindLabel: string;
  title: string;
  date: string;
  reach: string | null;
  photos: CirclePhotoModel[];
  /** The body as the server keeps it, null without one: shared/lookbook.ts storyBlock draws its paragraphs. */
  body: string | null;
  invitation: InvitationModel | null;
  poll: PollModel | null;
  links: {
    release: { id: string; href: string; title: string } | null;
    model: { slug: string; title: string } | null;
    external: { href: string; host: string } | null;
  };
}

const share = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%');

export function circlePostModel(p: CirclePost, offsetMinutes: number): CirclePostModel {
  const kind = kindOf(p.kind);
  const title = upper(p.title);
  const photos: CirclePhotoModel[] = [];
  for (const ph of Array.isArray(p.photos) ? p.photos : []) {
    const m = photo(ph, title);
    if (m && !photos.some((x) => x.src === m.src)) photos.push(m);
  }
  let invitation: InvitationModel | null = null;
  const inv = p.invitation;
  if (kind === 'INVITATION' && inv && typeof inv.eventAt === 'string') {
    const when = twoClocks(inv.eventAt, offsetMinutes);
    const rows: ReleaseRow[] = [{ label: CIRCLE.rows.when, value: when.utc, local: when.local }];
    if (inv.place && inv.place.trim()) rows.push({ label: CIRCLE.rows.where, value: upper(inv.place) });
    const capacity = typeof inv.capacity === 'number' ? inv.capacity : null;
    const left = typeof inv.placesLeft === 'number' ? Math.max(0, inv.placesLeft) : null;
    if (capacity !== null && left !== null) rows.push({ label: CIRCLE.rows.places, value: CIRCLE.places(left, capacity) });
    const answer = p.answer === 'YES' || p.answer === 'NO' ? p.answer : null;
    const open = inv.open === true;
    const full = open && left === 0 && answer !== 'YES';
    const a = CIRCLE.answer;
    invitation = {
      rows,
      answer,
      open,
      full,
      sentence: !open ? a.closed : answer === 'YES' ? a.yes : full ? a.full : answer === 'NO' ? a.no : a.none,
    };
  }
  let poll: PollModel | null = null;
  if (kind === 'POLL' && p.poll && Array.isArray(p.poll.options)) {
    const vote = Number.isInteger(p.poll.vote) ? (p.poll.vote as number) : null;
    const options = p.poll.options.map((label, index) => ({ index, label: upper(label), chosen: index === vote }));
    const r = p.poll.results;
    const results =
      vote !== null && r && Array.isArray(r.counts)
        ? options.map((o) => {
            const n = Number(r.counts[o.index]) || 0;
            return { label: o.label, votes: CIRCLE.votes(n), share: share(n, Number(r.total) || 0), mine: o.chosen };
          })
        : null;
    poll = { options, voted: vote !== null, results, sentence: vote !== null ? CIRCLE.pollVoted : CIRCLE.pollLead };
  }
  const drop = p.links?.drop;
  const model = p.links?.model;
  return {
    id: p.id,
    kind,
    kindLabel: CIRCLE.kind[kind],
    title,
    date: formatDate(p.publishedAt),
    reach: reachOf(p.minTier),
    photos,
    body: typeof p.body === 'string' && p.body.trim() ? p.body : null,
    invitation,
    poll,
    links: {
      release: drop && isReleaseId(drop.id) ? { id: drop.id, href: releasePath(drop.id), title: upper(drop.title) } : null,
      model: model && isLookbookSlug(model.slug) ? { slug: model.slug, title: [upper(model.name), upper(model.type)].filter((x) => x.length > 0).join(' · ') } : null,
      external: externalLink(p.links?.external?.url),
    },
  };
}
