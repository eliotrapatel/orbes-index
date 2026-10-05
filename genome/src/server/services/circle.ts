/**
 * The owners' circle (P-X01): what the console publishes for the owners of an
 * ORBES piece, read on /verify/circle.
 *
 * A post (`circle_posts`, migration 0016) is a NOTE (text and photographs),
 * an INVITATION (an event, answered YES or NO within its capacity) or a POLL
 * (2 to 6 options, one vote per account, its results shown once voted). Each
 * may link a drop (its page on /verify/releases), a model of the lookbook (its
 * sheet) and an address in https whose host is one of CIRCLE_LINK_HOSTS (a
 * constant of the code: theorbes.com, youtube.com, vimeo.com and their
 * subdomains), which /verify names beside the link.
 *
 * Access (routes/club.ts): a signed-in account that holds a piece now, as the
 * club counts them (club.ts `tierOf`), read again at every request, so the
 * circle goes with the last piece (403 OWNERS_ONLY). A post reads from its
 * `min_tier` up only, and, when it names a segment (`segment_id`, plan LIVE
 * RELEASE+ choice 27), by that segment's members only, read at every request
 * (services/segments.ts), from its `published_at` on (the publication of a LIVE
 * RELEASE schedules its post for the release's announcement): below its tier,
 * outside its segment, unpublished, not shown yet or unknown, it answers the
 * same 404 CIRCLE_POST_NOT_FOUND. A segment's name is the console's: a member
 * never reads it. A LIVE RELEASE it links is named once its name is
 * revealed, and linked only once announced (`linkedDrop`). The feed is paginated and carries no body (the
 * verify client refuses answers over 256 000 characters): a post does.
 *
 * An answer to an invitation (`circle_rsvps`, one per account, changed in
 * place) is taken under the post's row lock (FOR UPDATE), where the YES are
 * counted, so they never pass its capacity; answers close when the event
 * begins. Audited `circle.rsvp`, the account as actor. A vote
 * (`circle_poll_votes`) is final; it takes the post FOR SHARE, so a change of
 * the poll's options (FOR UPDATE) waits for it, then is refused once a vote
 * exists. A vote is never audited (the audit log is permanent, and a vote is
 * an opinion), nor is a visit: the first page of the feed adds one to the
 * day's count (`circle_daily_visits`), which names nobody.
 *
 * The console (routes/admin/circle.ts; OPERATOR, an AUDITOR reads): create,
 * change, publish and withdraw a post (`circle.post.create`, `.update`,
 * `.publish`, `.unpublish`; the body recorded as its length and SHA-256), its
 * photographs through MediaService; the answers to an invitation (the routes
 * mask the emails for an AUDITOR) and the results of a poll; and the Analytics
 * panel: the members of the club by tier now, the visits by day.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { CIRCLE_POST_KINDS, CIRCLE_RSVP_ANSWERS, type CirclePostKind, type CirclePostRow, type CirclePostUpdate, type CircleRsvpAnswer, type DropRow, type LookbookState } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, noopLogger, pageOffset, pageRequest, systemClock, type Actor, type Clock, type Logger, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';
import { clubMembersByTier, ownersOnly, tierOf, type ClubMembers } from './club.js';
import { dropNotFound, dropState, type DropState } from './drops.js';
import { isAnnounced, liveStages } from './live.js';
import { storyFingerprint } from './lookbook.js';
import { mediaUrl } from './media.js';
import { readActingAccount } from './ownership.js';
import { addDays, daySpan } from './scan-stats.js';
import { isSegmentMember, memberSegments } from './segments.js';

// ── Rules ──────────────────────────────────────────────────────────────────

export const CIRCLE_TITLE_MAX = 120;
/** A post's body: plain paragraphs, as a model's story (no Markdown). */
export const CIRCLE_BODY_MAX = 6000;
export const CIRCLE_PLACE_MAX = 200;
/** The places of an invitation answered YES at most: 1 to 10 000; none (null): no limit. */
export const CIRCLE_CAPACITY_MAX = 10_000;
/** The options of a poll, and the length of one (a line, read in full on a phone). */
export const CIRCLE_POLL_OPTIONS = Object.freeze({ min: 2, max: 6 });
export const CIRCLE_POLL_OPTION_MAX = 40;
export const CIRCLE_URL_MAX = 500;
/**
 * The hosts a post's link may name, and their subdomains (www.youtube.com, player.vimeo.com): a constant of the code,
 * changed here when ORBES adds one. /verify shows the host beside the link, opened apart (noopener noreferrer).
 */
export const CIRCLE_LINK_HOSTS: readonly string[] = Object.freeze(['theorbes.com', 'youtube.com', 'vimeo.com']);
/** The feed of /verify: 20 posts a page by default, 50 at most. */
export const CIRCLE_FEED_PAGE = Object.freeze({ default: 20, max: 50 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LINE_BREAKS = /[\r\n]/;

/** The page of the feed a query asks for: `page`, and `pageSize` (CIRCLE_FEED_PAGE: 20 by default, 50 at most). */
export function circleFeedPage(query: unknown): PageRequest {
  const q = (query && typeof query === 'object' ? query : {}) as { page?: unknown; pageSize?: unknown };
  const r = pageRequest({ page: q.page, pageSize: q.pageSize ?? CIRCLE_FEED_PAGE.default });
  return { page: r.page, pageSize: Math.min(r.pageSize, CIRCLE_FEED_PAGE.max) };
}

/** The host of a link as /verify shows it beside the link (`youtube.com`, a leading `www.` dropped), or null. */
export function circleLinkHost(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * A post's link: an https address on one of CIRCLE_LINK_HOSTS (or a subdomain), without credentials or a port of its
 * own, at most CIRCLE_URL_MAX characters, as the URL parser writes it back. '' and null clear it.
 */
export function normalizeCircleUrl(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const refuse = () => validationError(`A link is an https address on ${CIRCLE_LINK_HOSTS.join(', ')} (or one of their subdomains).`);
  if (typeof v !== 'string' || /\s/.test(v.trim())) throw refuse();
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw refuse();
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') throw refuse();
  if (!CIRCLE_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) throw refuse();
  const href = url.href;
  if (href.length > CIRCLE_URL_MAX) throw validationError(`A link has at most ${CIRCLE_URL_MAX} characters.`);
  return href;
}

/** One line of text, trimmed, 1 to `max` characters. */
function oneLine(v: unknown, label: string, max: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > max || CONTROL_CHARS.test(s) || LINE_BREAKS.test(s)) throw validationError(`${label} is one line of 1 to ${max} characters.`);
  return s;
}

/** The body: plain paragraphs separated by a blank line (shared/lookbook.ts draws them), at most CIRCLE_BODY_MAX characters; '' and null clear it. */
export function normalizeBody(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The text must be text.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') return null;
  if (CONTROL_CHARS.test(s)) throw validationError('The text contains invalid characters.');
  if (s.length > CIRCLE_BODY_MAX) throw validationError(`The text must be at most ${CIRCLE_BODY_MAX} characters.`);
  return s
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function cleanTier(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 3) throw validationError('The tier is 1 (TITANE), 2 (PLATINE) or 3 (PALLADIUM).');
  return v;
}

function cleanEventAt(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw validationError('The event must have a date and time.');
  return d;
}

function cleanPlace(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  return oneLine(v, 'The place', CIRCLE_PLACE_MAX);
}

function cleanCapacity(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > CIRCLE_CAPACITY_MAX) throw validationError(`An invitation has 1 to ${CIRCLE_CAPACITY_MAX} places, or no limit.`);
  return v;
}

/** The options of a poll: 2 to 6 lines of 1 to CIRCLE_POLL_OPTION_MAX characters, each once (whatever its case). */
export function normalizePollOptions(v: unknown): string[] {
  if (!Array.isArray(v) || v.length < CIRCLE_POLL_OPTIONS.min || v.length > CIRCLE_POLL_OPTIONS.max) {
    throw validationError(`A poll has ${CIRCLE_POLL_OPTIONS.min} to ${CIRCLE_POLL_OPTIONS.max} options.`);
  }
  const out = v.map((o, i) => oneLine(o, `Option ${i + 1}`, CIRCLE_POLL_OPTION_MAX));
  if (new Set(out.map((o) => o.toLowerCase())).size !== out.length) throw validationError('Each option of a poll is different.');
  return out;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Said as /verify says it (verify/copy.ts CIRCLE.notFound): a post below the reader's tier answers the same. */
export const circlePostNotFound = () => new DomainError('CIRCLE_POST_NOT_FOUND', 404, 'This post is not in the circle.');
const segmentNotFound = () => notFound('Segment', 'SEGMENT_NOT_FOUND');
const notInvitation = () => conflict('CIRCLE_NOT_INVITATION', 'Only an invitation takes an answer.');
const notPoll = () => conflict('CIRCLE_NOT_POLL', 'Only a poll takes a vote.');
const circleFull = () => conflict('CIRCLE_FULL', 'Every place of this invitation is taken.');
const eventBegun = () => conflict('CIRCLE_EVENT_PAST', 'This event has begun: answers are closed.');
const alreadyVoted = () => conflict('CIRCLE_ALREADY_VOTED', 'You have voted in this poll already: a vote is final.');
const alreadyPublished = () => conflict('CIRCLE_ALREADY_PUBLISHED', 'This post is already in the circle.');
const notPublished = () => conflict('CIRCLE_NOT_PUBLISHED', 'This post is not in the circle.');
const pollVoted = () => conflict('CIRCLE_POLL_VOTED', 'Votes have been cast: the options of this poll no longer change.');
const capacityBelow = (taken: number) => conflict('CIRCLE_CAPACITY_BELOW', `${taken} ${taken === 1 ? 'place is' : 'places are'} taken already: the capacity cannot go under that.`);

function assertStaff(actor: Actor, what: string): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
}

function assertAccount(accountId: string): void {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
}

/** The id of a post as the routes pass it; anything else is the same 404 as an unknown one. */
function knownPost(id: string): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw circlePostNotFound();
  return id.toLowerCase();
}

/** The fields of one kind, never set on another (the migration's CHECKs, said before anything is written). */
function checkKind(kind: CirclePostKind, f: { eventAt: Date | null; eventPlace: string | null; capacity: number | null; pollOptions: string[] | null }): void {
  const event = f.eventAt !== null || f.eventPlace !== null || f.capacity !== null;
  if (kind === 'INVITATION') {
    if (f.eventAt === null) throw validationError('An invitation has the date and time of its event.');
    if (f.pollOptions !== null) throw validationError('An invitation has no options: a poll does.');
  } else if (kind === 'POLL') {
    if (f.pollOptions === null) throw validationError(`A poll has ${CIRCLE_POLL_OPTIONS.min} to ${CIRCLE_POLL_OPTIONS.max} options.`);
    if (event) throw validationError('A poll has no date, place or capacity: an invitation does.');
  } else if (event || f.pollOptions !== null) {
    throw validationError('A note has no date, place, capacity or options.');
  }
}

/** How the audit log records a body: its length and SHA-256, never its words (as a model's story). */
const bodyAs = (body: string | null) => storyFingerprint(body);

// ── Views ──────────────────────────────────────────────────────────────────

/** A photograph of a post as /verify shows it: `alt` null, the post's default. */
export interface CirclePhoto {
  url: string;
  alt: string | null;
}

/** One post of the feed (GET /api/v1/club/circle): never its body. */
export interface CircleCard {
  id: string;
  kind: CirclePostKind;
  title: string;
  /** The lowest tier that reads it: 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  minTier: number;
  publishedAt: Date;
  /** Its first photograph, or null. */
  cover: CirclePhoto | null;
  /** An invitation's event: its time and place. */
  eventAt: Date | null;
  eventPlace: string | null;
  /** The reader's answer to an invitation, null without one. */
  answer: CircleRsvpAnswer | null;
  /** Whether the reader voted in a poll. */
  voted: boolean;
}

/** A post as a member reads it (GET /api/v1/club/circle/:id, and the answer to an RSVP or a vote). */
export interface CirclePostView extends CircleCard {
  body: string | null;
  photos: CirclePhoto[];
  invitation: {
    eventAt: Date;
    place: string | null;
    /** null: no limit. */
    capacity: number | null;
    /** The places not answered YES yet; null without a limit. */
    placesLeft: number | null;
    /** Answers are taken until the event begins. */
    open: boolean;
  } | null;
  poll: {
    options: string[];
    /** The index of the reader's vote, null before it. */
    vote: number | null;
    /** The votes by option, shown once the reader voted; null before. */
    results: { counts: number[]; total: number } | null;
  } | null;
  links: {
    /** A published drop: its page, /verify/releases/<id>. */
    drop: { id: string; title: string } | null;
    /** A model shown in the lookbook (PUBLIC, or RESERVED from a tier the reader reaches, P-X08): /verify/lookbook/<slug>. */
    model: { slug: string; name: string; type: string } | null;
    /** An address on one of CIRCLE_LINK_HOSTS, and its host as shown beside it. */
    external: { url: string; host: string } | null;
  };
}

/** A photograph of a post as the console edits it. */
export interface AdminCirclePhoto {
  sha256: string;
  url: string;
  alt: string | null;
  position: number;
}

/** A post as the console reads it (GET /api/admin/circle/posts/:id); the list leaves its body out. */
export interface AdminCirclePost {
  id: string;
  kind: CirclePostKind;
  title: string;
  body: string | null;
  minTier: number;
  eventAt: Date | null;
  eventPlace: string | null;
  capacity: number | null;
  pollOptions: string[] | null;
  drop: { id: string; title: string; state: DropState } | null;
  model: { id: string; name: string; type: string; lookbook: LookbookState; slug: string | null } | null;
  externalUrl: string | null;
  /** Read by this segment's members only (among its tiers); null: by its tiers. */
  segment: { id: string; name: string } | null;
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
  photos: AdminCirclePhoto[];
  /** The answers to an invitation, by answer (0 and 0 for another kind). */
  answers: Record<CircleRsvpAnswer, number>;
  /** A poll's votes by option, null for another kind. */
  results: { counts: number[]; total: number } | null;
}

/** A post of the console's list: everything but its body. */
export type AdminCircleCard = Omit<AdminCirclePost, 'body'>;

/** An answer to an invitation as the console lists it; the routes mask the email for an AUDITOR. */
export interface AdminCircleAnswer {
  accountId: string;
  /** As stored. */
  email: string;
  answer: CircleRsvpAnswer;
  /** The first answer, and the latest change of it. */
  createdAt: Date;
  answeredAt: Date;
}

/** GET /api/admin/analytics/circle: the members of the club by tier now, and the visits by UTC day of the window. */
export interface CircleStats {
  from: string;
  to: string;
  days: number;
  members: ClubMembers;
  visits: { total: number; daily: { day: string; visits: number }[] };
}

export interface CirclePostInput {
  kind: CirclePostKind;
  title: string;
  body?: string | null;
  minTier?: number;
  eventAt?: Date | null;
  eventPlace?: string | null;
  capacity?: number | null;
  pollOptions?: string[] | null;
  dropId?: string | null;
  modelId?: string | null;
  externalUrl?: string | null;
  /** A segment whose members alone read it (among its tiers); null: its tiers. */
  segmentId?: string | null;
}

/** A change of a post: any field but its kind; null (or '') clears an optional one. */
export type CirclePostChange = Partial<Omit<CirclePostInput, 'kind'>>;

/** An account's answers and votes in the circle, for its right-of-access export (OwnerService.exportData). */
export interface ExportedCircleAnswer {
  postId: string;
  title: string;
  answer: CircleRsvpAnswer;
  /** The first answer, and the latest change of it. */
  firstAnsweredAt: Date;
  answeredAt: Date;
}

export interface ExportedCircleVote {
  postId: string;
  title: string;
  /** The option's index (from 0), and its words as the poll has them. */
  option: number;
  optionText: string | null;
  votedAt: Date;
}

/** Every answer and vote of an account, oldest first. Read only. */
export async function accountCircleData(db: Db, accountId: string): Promise<{ answers: ExportedCircleAnswer[]; votes: ExportedCircleVote[] }> {
  assertAccount(accountId);
  const answers = await db
    .selectFrom('circle_rsvps as r')
    .innerJoin('circle_posts as p', 'p.id', 'r.post_id')
    .select(['r.post_id', 'p.title', 'r.answer', 'r.created_at', 'r.updated_at'])
    .where('r.account_id', '=', accountId)
    .orderBy('r.created_at')
    .orderBy('r.post_id')
    .execute();
  const votes = await db
    .selectFrom('circle_poll_votes as v')
    .innerJoin('circle_posts as p', 'p.id', 'v.post_id')
    .select(['v.post_id', 'p.title', 'p.poll_options', 'v.option_index', 'v.created_at'])
    .where('v.account_id', '=', accountId)
    .orderBy('v.created_at')
    .orderBy('v.post_id')
    .execute();
  return {
    answers: answers.map((r) => ({ postId: r.post_id, title: r.title, answer: r.answer, firstAnsweredAt: r.created_at, answeredAt: r.updated_at })),
    votes: votes.map((v) => ({ postId: v.post_id, title: v.title, option: v.option_index, optionText: v.poll_options?.[v.option_index] ?? null, votedAt: v.created_at })),
  };
}

const EMPTY_ANSWERS = (): Record<CircleRsvpAnswer, number> => ({ YES: 0, NO: 0 });

/** The columns of a post a list reads: all but its body. */
const CARD_COLUMNS = [
  'p.id',
  'p.kind',
  'p.title',
  'p.min_tier',
  'p.event_at',
  'p.event_place',
  'p.capacity',
  'p.poll_options',
  'p.drop_id',
  'p.model_id',
  'p.external_url',
  'p.published_at',
  'p.created_by',
  'p.created_at',
  'p.segment_id',
] as const;

/** A post's card: everything but its body. */
type CardRow = Omit<CirclePostRow, 'body'>;

// ── Service ────────────────────────────────────────────────────────────────

export interface CircleServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
}

export class CircleService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: CircleServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  // ── The members (routes/club.ts) ─────────────────────────────────────────

  /**
   * The feed: the posts published for the reader's tier, the latest first, without their bodies; 403 OWNERS_ONLY for
   * an account that holds no piece now. The first page counts a visit of the day (no account recorded).
   */
  async feed(accountId: string, page: PageRequest): Promise<Page<CircleCard>> {
    assertAccount(accountId);
    const now = this.clock();
    const { tier } = await tierOf(this.db, accountId, now);
    if (tier < 1) throw ownersOnly();
    // The segments of the posts shown to the tier, each read now for this account.
    const named = await this.db
      .selectFrom('circle_posts')
      .select('segment_id')
      .distinct()
      .where('published_at', '<=', now)
      .where('min_tier', '<=', tier)
      .where('segment_id', 'is not', null)
      .execute();
    const mine = [...(await memberSegments(this.db, accountId, named.map((r) => r.segment_id!), now))];
    const shown = this.db
      .selectFrom('circle_posts as p')
      .where('p.published_at', '<=', now)
      .where('p.min_tier', '<=', tier)
      .where((eb) => eb.or([eb('p.segment_id', 'is', null), ...(mine.length ? [eb('p.segment_id', 'in', mine)] : [])]));
    const total = await shown.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await shown.select([...CARD_COLUMNS]).orderBy('p.published_at', 'desc').orderBy('p.id').limit(page.pageSize).offset(pageOffset(page)).execute();
    const ids = rows.map((r) => r.id);
    const [covers, answers, votes] = await Promise.all([this.covers(this.db, ids), this.myAnswers(this.db, accountId, ids), this.myVotes(this.db, accountId, ids)]);
    if (page.page === 1) await this.countVisit(now);
    return makePage(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        minTier: r.min_tier,
        publishedAt: r.published_at!,
        cover: covers.get(r.id) ?? null,
        eventAt: r.event_at,
        eventPlace: r.event_place,
        answer: answers.get(r.id) ?? null,
        voted: votes.has(r.id),
      })),
      Number(total.n),
      page,
    );
  }

  /** A post for the reader: its body, photographs, invitation or poll, and links. 404 below its tier, unpublished or unknown. */
  async post(accountId: string, postId: string): Promise<CirclePostView> {
    assertAccount(accountId);
    const id = knownPost(postId);
    const { tier } = await tierOf(this.db, accountId, this.clock());
    if (tier < 1) throw ownersOnly();
    return this.memberView(accountId, id, tier);
  }

  /**
   * YES or NO to an invitation (POST /api/v1/club/circle/:id/rsvp): one answer per account, changed in place, until the
   * event begins (409 CIRCLE_EVENT_PAST). Under the post's row lock, the YES of the other accounts are counted: a YES
   * past its capacity is 409 CIRCLE_FULL. A LOCKED account is refused. The same answer again writes nothing; any
   * other is audited `circle.rsvp` (the account as actor), with the answer it replaced.
   */
  async rsvp(accountId: string, postId: string, answer: CircleRsvpAnswer, actor: Actor): Promise<CirclePostView> {
    assertAccount(accountId);
    const id = knownPost(postId);
    if (!(CIRCLE_RSVP_ANSWERS as readonly string[]).includes(answer)) throw validationError('Answer YES or NO.');
    const tier = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await readActingAccount(tx, accountId);
      if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const standing = await tierOf(tx, accountId, now);
      if (standing.tier < 1) throw ownersOnly();
      const p = await tx.selectFrom('circle_posts').select(['kind', 'published_at', 'min_tier', 'segment_id', 'event_at', 'capacity']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || !shownAt(p.published_at, now) || p.min_tier > standing.tier || !(await this.inSegment(tx, p.segment_id, accountId, now))) throw circlePostNotFound();
      if (p.kind !== 'INVITATION') throw notInvitation();
      if (p.event_at && now.getTime() >= p.event_at.getTime()) throw eventBegun();
      const mine = await tx.selectFrom('circle_rsvps').select('answer').where('post_id', '=', id).where('account_id', '=', accountId).executeTakeFirst();
      if (mine?.answer === answer) return standing.tier;
      if (answer === 'YES' && p.capacity !== null) {
        const yes = await tx
          .selectFrom('circle_rsvps')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('post_id', '=', id)
          .where('answer', '=', 'YES')
          .executeTakeFirstOrThrow();
        if (Number(yes.n) >= p.capacity) throw circleFull();
      }
      if (mine) await tx.updateTable('circle_rsvps').set({ answer, updated_at: now }).where('post_id', '=', id).where('account_id', '=', accountId).execute();
      else await tx.insertInto('circle_rsvps').values({ post_id: id, account_id: accountId, answer, created_at: now, updated_at: now }).execute();
      await this.audit.record({ actor, action: 'circle.rsvp', targetType: 'circle_post', targetId: id, details: { answer, ...(mine ? { previous: mine.answer } : {}) } }, tx);
      return standing.tier;
    });
    return this.memberView(accountId, id, tier);
  }

  /**
   * A vote in a poll (POST /api/v1/club/circle/:id/vote): one per account, final (409 CIRCLE_ALREADY_VOTED), by the
   * index of an option of the poll. Under the post's FOR SHARE, so its options cannot change meanwhile. Not audited.
   * Answered with the post, its results now shown.
   */
  async vote(accountId: string, postId: string, option: number): Promise<CirclePostView> {
    assertAccount(accountId);
    const id = knownPost(postId);
    if (typeof option !== 'number' || !Number.isInteger(option) || option < 0 || option >= CIRCLE_POLL_OPTIONS.max) throw validationError('Choose one of the options of this poll.');
    const tier = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await readActingAccount(tx, accountId);
      if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const standing = await tierOf(tx, accountId, now);
      if (standing.tier < 1) throw ownersOnly();
      const p = await tx.selectFrom('circle_posts').select(['kind', 'published_at', 'min_tier', 'segment_id', 'poll_options']).where('id', '=', id).forShare().executeTakeFirst();
      if (!p || !shownAt(p.published_at, now) || p.min_tier > standing.tier || !(await this.inSegment(tx, p.segment_id, accountId, now))) throw circlePostNotFound();
      if (p.kind !== 'POLL' || !p.poll_options) throw notPoll();
      if (option >= p.poll_options.length) throw validationError('Choose one of the options of this poll.');
      const voted = await tx.selectFrom('circle_poll_votes').select('option_index').where('post_id', '=', id).where('account_id', '=', accountId).executeTakeFirst();
      if (voted) throw alreadyVoted();
      try {
        await tx.insertInto('circle_poll_votes').values({ post_id: id, account_id: accountId, option_index: option, created_at: now }).execute();
      } catch (e) {
        if (isUniqueViolation(e)) throw alreadyVoted();
        throw e;
      }
      return standing.tier;
    });
    return this.memberView(accountId, id, tier);
  }

  // ── The console (routes/admin/circle.ts) ─────────────────────────────────

  /** Every post, the latest created first, without its body. */
  async list(page: PageRequest): Promise<Page<AdminCircleCard>> {
    const total = await this.db.selectFrom('circle_posts').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await this.db.selectFrom('circle_posts as p').select([...CARD_COLUMNS]).orderBy('p.created_at', 'desc').orderBy('p.id').limit(page.pageSize).offset(pageOffset(page)).execute();
    const views = await this.adminViews(this.db, rows);
    return makePage(views, Number(total.n), page);
  }

  /** One post (404 CIRCLE_POST_NOT_FOUND), its body included. */
  get(postId: string): Promise<AdminCirclePost> {
    return this.adminPost(this.db, knownPost(postId));
  }

  /**
   * A new post, not published yet. The fields of its kind (an invitation's event, a poll's options) and of no other;
   * its links checked (an unknown drop or model is 404; an address off CIRCLE_LINK_HOSTS is 400). OPERATOR; audited
   * `circle.post.create` (the body as its length and SHA-256).
   */
  async create(input: CirclePostInput, actor: Actor): Promise<AdminCirclePost> {
    assertStaff(actor, 'write in the circle');
    const kind = input?.kind;
    if (!(CIRCLE_POST_KINDS as readonly string[]).includes(kind)) throw validationError('A post is a NOTE, an INVITATION or a POLL.');
    const title = oneLine(input.title, 'The title', CIRCLE_TITLE_MAX);
    const body = normalizeBody(input.body ?? null);
    const minTier = cleanTier(input.minTier ?? 1);
    const eventAt = input.eventAt === undefined || input.eventAt === null ? null : cleanEventAt(input.eventAt);
    const eventPlace = cleanPlace(input.eventPlace ?? null);
    const capacity = cleanCapacity(input.capacity ?? null);
    const pollOptions = input.pollOptions === undefined || input.pollOptions === null ? null : normalizePollOptions(input.pollOptions);
    checkKind(kind, { eventAt, eventPlace, capacity, pollOptions });
    const externalUrl = normalizeCircleUrl(input.externalUrl ?? null);
    const dropId = input.dropId === undefined || input.dropId === null || input.dropId === '' ? null : knownLink(input.dropId, dropNotFound);
    const modelId = input.modelId === undefined || input.modelId === null || input.modelId === '' ? null : knownLink(input.modelId, () => notFound('Model', 'MODEL_NOT_FOUND'));
    const segmentId = input.segmentId === undefined || input.segmentId === null || input.segmentId === '' ? null : knownLink(input.segmentId, segmentNotFound);
    return inTransaction(this.db, async (tx) => {
      await this.checkLinks(tx, dropId, modelId);
      await this.checkSegment(tx, segmentId);
      const row = await tx
        .insertInto('circle_posts')
        .values({
          kind,
          title,
          body,
          min_tier: minTier,
          event_at: eventAt,
          event_place: eventPlace,
          capacity,
          poll_options: pollOptions,
          drop_id: dropId,
          model_id: modelId,
          external_url: externalUrl,
          segment_id: segmentId,
          created_by: actor.id!,
          created_at: this.clock(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          actor,
          action: 'circle.post.create',
          targetType: 'circle_post',
          targetId: row.id,
          details: {
            kind,
            title,
            body: bodyAs(body),
            minTier,
            eventAt: eventAt?.toISOString() ?? null,
            eventPlace,
            capacity,
            pollOptions,
            dropId,
            modelId,
            externalUrl,
            segmentId,
          },
        },
        tx,
      );
      return this.adminPost(tx, row.id);
    });
  }

  /**
   * Change a post, published or not: any field but its kind, under its row lock. A poll's options no longer change
   * once a vote is cast (409 CIRCLE_POLL_VOTED); an invitation's capacity never goes under its YES (409
   * CIRCLE_CAPACITY_BELOW). Audited `circle.post.update` with each value before and after (the body as its length and
   * SHA-256); nothing changed, nothing written.
   */
  async update(postId: string, change: CirclePostChange, actor: Actor): Promise<AdminCirclePost> {
    assertStaff(actor, 'write in the circle');
    const id = knownPost(postId);
    return inTransaction(this.db, async (tx) => {
      const p = await this.lock(tx, id);
      const set: CirclePostUpdate = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const same = (a: unknown, b: unknown) =>
        a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
      const shown = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
      const note = <C extends keyof CirclePostUpdate>(key: string, column: C, from: unknown, to: CirclePostUpdate[C], as: (v: unknown) => unknown = shown) => {
        if (same(from, to)) return;
        set[column] = to;
        before[key] = as(from);
        after[key] = as(to);
      };
      if (change.title !== undefined) note('title', 'title', p.title, oneLine(change.title, 'The title', CIRCLE_TITLE_MAX));
      if (change.body !== undefined) note('body', 'body', p.body, normalizeBody(change.body), (v) => bodyAs((v as string | null) ?? null));
      if (change.minTier !== undefined) note('minTier', 'min_tier', p.min_tier, cleanTier(change.minTier));
      const eventAt = change.eventAt !== undefined ? (change.eventAt === null ? null : cleanEventAt(change.eventAt)) : p.event_at;
      const eventPlace = change.eventPlace !== undefined ? cleanPlace(change.eventPlace) : p.event_place;
      const capacity = change.capacity !== undefined ? cleanCapacity(change.capacity) : p.capacity;
      const pollOptions = change.pollOptions !== undefined ? (change.pollOptions === null ? null : normalizePollOptions(change.pollOptions)) : p.poll_options;
      checkKind(p.kind, { eventAt, eventPlace, capacity, pollOptions });
      note('eventAt', 'event_at', p.event_at, eventAt);
      note('eventPlace', 'event_place', p.event_place, eventPlace);
      if (!same(p.capacity, capacity) && capacity !== null) {
        const taken = Number((await tx.selectFrom('circle_rsvps').select((eb) => eb.fn.countAll<number>().as('n')).where('post_id', '=', id).where('answer', '=', 'YES').executeTakeFirstOrThrow()).n);
        if (capacity < taken) throw capacityBelow(taken);
      }
      note('capacity', 'capacity', p.capacity, capacity);
      if (!same(p.poll_options, pollOptions)) {
        const votes = await tx.selectFrom('circle_poll_votes').select('post_id').where('post_id', '=', id).limit(1).executeTakeFirst();
        if (votes) throw pollVoted();
      }
      note('pollOptions', 'poll_options', p.poll_options, pollOptions);
      if (change.externalUrl !== undefined) note('externalUrl', 'external_url', p.external_url, normalizeCircleUrl(change.externalUrl));
      const dropId = change.dropId === undefined ? p.drop_id : change.dropId === null || change.dropId === '' ? null : knownLink(change.dropId, dropNotFound);
      const modelId = change.modelId === undefined ? p.model_id : change.modelId === null || change.modelId === '' ? null : knownLink(change.modelId, () => notFound('Model', 'MODEL_NOT_FOUND'));
      await this.checkLinks(tx, dropId !== p.drop_id ? dropId : null, modelId !== p.model_id ? modelId : null);
      note('dropId', 'drop_id', p.drop_id, dropId);
      note('modelId', 'model_id', p.model_id, modelId);
      const segmentId = change.segmentId === undefined ? p.segment_id : change.segmentId === null || change.segmentId === '' ? null : knownLink(change.segmentId, segmentNotFound);
      if (segmentId !== p.segment_id) await this.checkSegment(tx, segmentId);
      note('segmentId', 'segment_id', p.segment_id, segmentId);
      if (Object.keys(set).length > 0) {
        await tx.updateTable('circle_posts').set(set).where('id', '=', id).execute();
        await this.audit.record({ actor, action: 'circle.post.update', targetType: 'circle_post', targetId: id, details: { before, after } }, tx);
      }
      return this.adminPost(tx, id);
    });
  }

  /** Publish a post: it shows in the circle, for its tier and up, from now on (409 when it already does). Audited `circle.post.publish`. */
  async publish(postId: string, actor: Actor): Promise<AdminCirclePost> {
    assertStaff(actor, 'publish in the circle');
    const id = knownPost(postId);
    return inTransaction(this.db, async (tx) => {
      const p = await this.lock(tx, id);
      if (p.published_at) throw alreadyPublished();
      await tx.updateTable('circle_posts').set({ published_at: this.clock() }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'circle.post.publish', targetType: 'circle_post', targetId: id, details: { kind: p.kind, minTier: p.min_tier, segmentId: p.segment_id } }, tx);
      return this.adminPost(tx, id);
    });
  }

  /**
   * Withdraw a post from the circle: no member reads it any more; its answers and votes are kept, and it can be
   * published again (409 CIRCLE_NOT_PUBLISHED when it is not shown). Audited `circle.post.unpublish`.
   */
  async unpublish(postId: string, actor: Actor): Promise<AdminCirclePost> {
    assertStaff(actor, 'withdraw from the circle');
    const id = knownPost(postId);
    return inTransaction(this.db, async (tx) => {
      const p = await this.lock(tx, id);
      if (!p.published_at) throw notPublished();
      await tx.updateTable('circle_posts').set({ published_at: null }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'circle.post.unpublish', targetType: 'circle_post', targetId: id, details: { publishedAt: p.published_at.toISOString() } }, tx);
      return this.adminPost(tx, id);
    });
  }

  /** The answers to an invitation, the latest first; `answer` narrows them. */
  async answers(postId: string, filter: { answer?: CircleRsvpAnswer }, page: PageRequest): Promise<Page<AdminCircleAnswer>> {
    const id = knownPost(postId);
    const p = await this.db.selectFrom('circle_posts').select('id').where('id', '=', id).executeTakeFirst();
    if (!p) throw circlePostNotFound();
    const scoped = this.db
      .selectFrom('circle_rsvps as r')
      .where('r.post_id', '=', id)
      .$if(filter.answer !== undefined, (qb) => qb.where('r.answer', '=', filter.answer!));
    const total = await scoped.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await scoped
      .innerJoin('accounts as a', 'a.id', 'r.account_id')
      .select(['r.account_id', 'a.email', 'r.answer', 'r.created_at', 'r.updated_at'])
      .orderBy('r.updated_at', 'desc')
      .orderBy('r.account_id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      rows.map((r) => ({ accountId: r.account_id, email: r.email, answer: r.answer, createdAt: r.created_at, answeredAt: r.updated_at })),
      Number(total.n),
      page,
    );
  }

  /** The Analytics panel: the members of the club by tier now (club.ts), and the visits of each UTC day of the window. */
  async stats(window: { from: string; to: string }): Promise<CircleStats> {
    const { from, to } = window;
    const [members, rows] = await Promise.all([
      clubMembersByTier(this.db),
      this.db.selectFrom('circle_daily_visits').select(['day', 'visits']).where('day', '>=', from).where('day', '<=', to).execute(),
    ]);
    const byDay = new Map(rows.map((r) => [r.day, Number(r.visits)]));
    const days = daySpan(from, to);
    const daily = Array.from({ length: days }, (_, i) => {
      const day = addDays(from, i);
      return { day, visits: byDay.get(day) ?? 0 };
    });
    return { from, to, days, members, visits: { total: daily.reduce((n, d) => n + d.visits, 0), daily } };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** A visit of the circle today (UTC): one more on the day's count. Best effort: a failure is logged, the feed still shown. */
  private async countVisit(now: Date): Promise<void> {
    try {
      await this.db
        .insertInto('circle_daily_visits')
        .values({ day: now.toISOString().slice(0, 10), visits: 1 })
        .onConflict((oc) => oc.column('day').doUpdateSet({ visits: sql<number>`circle_daily_visits.visits + 1` }))
        .execute();
    } catch (e) {
      this.log.warn({ err: { message: (e as Error)?.message } }, 'circle: a visit could not be counted');
    }
  }

  /** The post's row FOR UPDATE (every console change), 404 CIRCLE_POST_NOT_FOUND. */
  private async lock(tx: Db, id: string): Promise<CirclePostRow> {
    const p = await tx.selectFrom('circle_posts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw circlePostNotFound();
    return p;
  }

  /**
   * The drop and the model a post links, when they change: each must exist (404 DROP_NOT_FOUND, MODEL_NOT_FOUND); an
   * after-room is never linked (services/after-room.ts: nobody but its guests sees it), the same 404.
   */
  private async checkLinks(tx: Db, dropId: string | null, modelId: string | null): Promise<void> {
    if (dropId && !(await tx.selectFrom('drops').select('id').where('id', '=', dropId).where('parent_drop_id', 'is', null).executeTakeFirst())) throw dropNotFound();
    if (modelId && !(await tx.selectFrom('models').select('id').where('id', '=', modelId).executeTakeFirst())) throw notFound('Model', 'MODEL_NOT_FOUND');
  }

  /** A segment a post names exists (404 SEGMENT_NOT_FOUND). */
  private async checkSegment(tx: Db, segmentId: string | null): Promise<void> {
    if (segmentId && !(await tx.selectFrom('segments').select('id').where('id', '=', segmentId).executeTakeFirst())) throw segmentNotFound();
  }

  /** Whether a post's segment, when it names one, has the account among its members now. */
  private async inSegment(db: Db, segmentId: string | null, accountId: string, now: Date): Promise<boolean> {
    return segmentId === null || isSegmentMember(db, segmentId, accountId, now);
  }

  /** The first photograph of each post. */
  private async covers(db: Db, ids: readonly string[]): Promise<Map<string, CirclePhoto>> {
    const out = new Map<string, CirclePhoto>();
    if (ids.length === 0) return out;
    const rows = await db.selectFrom('circle_post_images').select(['post_id', 'sha256', 'alt']).where('post_id', 'in', [...ids]).where('position', '=', 1).execute();
    for (const r of rows) {
      const url = mediaUrl(r.sha256);
      if (url) out.set(r.post_id, { url, alt: r.alt });
    }
    return out;
  }

  private async myAnswers(db: Db, accountId: string, ids: readonly string[]): Promise<Map<string, CircleRsvpAnswer>> {
    if (ids.length === 0) return new Map();
    const rows = await db.selectFrom('circle_rsvps').select(['post_id', 'answer']).where('account_id', '=', accountId).where('post_id', 'in', [...ids]).execute();
    return new Map(rows.map((r) => [r.post_id, r.answer]));
  }

  private async myVotes(db: Db, accountId: string, ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db.selectFrom('circle_poll_votes').select(['post_id', 'option_index']).where('account_id', '=', accountId).where('post_id', 'in', [...ids]).execute();
    return new Map(rows.map((r) => [r.post_id, r.option_index]));
  }

  /** The votes of each poll, by option. */
  private async results(db: Db, polls: readonly { id: string; options: number }[]): Promise<Map<string, { counts: number[]; total: number }>> {
    const out = new Map<string, { counts: number[]; total: number }>();
    if (polls.length === 0) return out;
    for (const p of polls) out.set(p.id, { counts: Array.from({ length: p.options }, () => 0), total: 0 });
    const rows = await db
      .selectFrom('circle_poll_votes')
      .select(['post_id', 'option_index', (eb) => eb.fn.countAll<number>().as('n')])
      .where('post_id', 'in', polls.map((p) => p.id))
      .groupBy(['post_id', 'option_index'])
      .execute();
    for (const r of rows) {
      const res = out.get(r.post_id);
      if (!res || r.option_index >= res.counts.length) continue;
      res.counts[r.option_index] = Number(r.n);
      res.total += Number(r.n);
    }
    return out;
  }

  /** The YES of each invitation, and its NO. */
  private async answerCounts(db: Db, ids: readonly string[]): Promise<Map<string, Record<CircleRsvpAnswer, number>>> {
    const out = new Map<string, Record<CircleRsvpAnswer, number>>();
    if (ids.length === 0) return out;
    const rows = await db
      .selectFrom('circle_rsvps')
      .select(['post_id', 'answer', (eb) => eb.fn.countAll<number>().as('n')])
      .where('post_id', 'in', [...ids])
      .groupBy(['post_id', 'answer'])
      .execute();
    for (const r of rows) {
      const c = out.get(r.post_id) ?? EMPTY_ANSWERS();
      c[r.answer] = Number(r.n);
      out.set(r.post_id, c);
    }
    return out;
  }

  /** A post as the member reads it, from the post's committed row (after a change, read again outside its transaction). */
  private async memberView(accountId: string, id: string, tier: number): Promise<CirclePostView> {
    const db = this.db;
    const now = this.clock();
    const p = await db.selectFrom('circle_posts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p || !shownAt(p.published_at, now) || p.min_tier > tier || !(await this.inSegment(db, p.segment_id, accountId, now))) throw circlePostNotFound();
    const [images, mine, vote, drop, model] = await Promise.all([
      db.selectFrom('circle_post_images').select(['sha256', 'alt']).where('post_id', '=', id).orderBy('position').execute(),
      db.selectFrom('circle_rsvps').select('answer').where('post_id', '=', id).where('account_id', '=', accountId).executeTakeFirst(),
      db.selectFrom('circle_poll_votes').select('option_index').where('post_id', '=', id).where('account_id', '=', accountId).executeTakeFirst(),
      p.drop_id ? db.selectFrom('drops').select([...LINKED_DROP_COLUMNS]).where('id', '=', p.drop_id).executeTakeFirst() : undefined,
      p.model_id ? db.selectFrom('models').select(['slug', 'name', 'type', 'lookbook', 'private_min_tier']).where('id', '=', p.model_id).executeTakeFirst() : undefined,
    ]);
    const photos = images.flatMap((i) => {
      const url = mediaUrl(i.sha256);
      return url ? [{ url, alt: i.alt }] : [];
    });
    let invitation: CirclePostView['invitation'] = null;
    if (p.kind === 'INVITATION' && p.event_at) {
      const yes = p.capacity === null ? 0 : (await this.answerCounts(db, [id])).get(id)?.YES ?? 0;
      invitation = {
        eventAt: p.event_at,
        place: p.event_place,
        capacity: p.capacity,
        placesLeft: p.capacity === null ? null : Math.max(0, p.capacity - yes),
        open: now.getTime() < p.event_at.getTime(),
      };
    }
    let poll: CirclePostView['poll'] = null;
    if (p.kind === 'POLL' && p.poll_options) {
      const voted = vote ? vote.option_index : null;
      poll = {
        options: p.poll_options,
        vote: voted,
        results: voted === null ? null : (await this.results(db, [{ id, options: p.poll_options.length }])).get(id) ?? null,
      };
    }
    const host = circleLinkHost(p.external_url);
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      minTier: p.min_tier,
      publishedAt: p.published_at!,
      cover: photos[0] ?? null,
      eventAt: p.event_at,
      eventPlace: p.event_place,
      answer: mine?.answer ?? null,
      voted: vote !== undefined,
      body: p.body,
      photos,
      invitation,
      poll,
      links: {
        drop: drop ? linkedDrop(drop, now) : null,
        // A RESERVED model is linked only for a member whose tier reaches it in the private salon (P-X08): its sheet is 404 below.
        model: model && model.slug && (model.lookbook === 'PUBLIC' || (model.lookbook === 'RESERVED' && model.private_min_tier <= tier)) ? { slug: model.slug, name: model.name, type: model.type } : null,
        external: p.external_url && host ? { url: p.external_url, host } : null,
      },
    };
  }

  private async adminPost(db: Db, id: string): Promise<AdminCirclePost> {
    const p = await db.selectFrom('circle_posts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) throw circlePostNotFound();
    const [view] = await this.adminViews(db, [p]);
    return { ...view!, body: p.body };
  }

  /** The console's view of posts, their photographs, answers, votes, links and authors read in one query each. */
  private async adminViews(db: Db, rows: readonly CardRow[]): Promise<AdminCircleCard[]> {
    if (rows.length === 0) return [];
    const now = this.clock();
    const ids = rows.map((r) => r.id);
    const dropIds = [...new Set(rows.map((r) => r.drop_id).filter((x): x is string => x !== null))];
    const modelIds = [...new Set(rows.map((r) => r.model_id).filter((x): x is string => x !== null))];
    const staff = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => x !== null))];
    const segmentIds = [...new Set(rows.map((r) => r.segment_id).filter((x): x is string => x !== null))];
    const [images, answers, results, drops, models, creators, segments] = await Promise.all([
      db.selectFrom('circle_post_images').select(['post_id', 'sha256', 'alt', 'position']).where('post_id', 'in', ids).orderBy('post_id').orderBy('position').execute(),
      this.answerCounts(db, ids),
      this.results(
        db,
        rows.filter((r) => r.kind === 'POLL' && r.poll_options).map((r) => ({ id: r.id, options: r.poll_options!.length })),
      ),
      dropIds.length ? db.selectFrom('drops').select(['id', 'title', 'published_at', 'cancelled_at', 'drawn_at', 'opens_at', 'closes_at']).where('id', 'in', dropIds).execute() : [],
      modelIds.length ? db.selectFrom('models').select(['id', 'name', 'type', 'lookbook', 'slug']).where('id', 'in', modelIds).execute() : [],
      staff.length ? db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', staff).execute() : [],
      segmentIds.length ? db.selectFrom('segments').select(['id', 'name']).where('id', 'in', segmentIds).execute() : [],
    ]);
    const segmentOf = new Map(segments.map((x) => [x.id, x]));
    const photos = new Map<string, AdminCirclePhoto[]>();
    for (const i of images) {
      const url = mediaUrl(i.sha256);
      if (!url) continue;
      const list = photos.get(i.post_id) ?? [];
      list.push({ sha256: i.sha256, url, alt: i.alt, position: i.position });
      photos.set(i.post_id, list);
    }
    const dropOf = new Map(drops.map((d) => [d.id, d]));
    const modelOf = new Map(models.map((m) => [m.id, m]));
    const creatorOf = new Map(creators.map((c) => [c.id, c.email]));
    return rows.map((r) => {
      const d = r.drop_id ? dropOf.get(r.drop_id) : undefined;
      const m = r.model_id ? modelOf.get(r.model_id) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        title: r.title,
        minTier: r.min_tier,
        eventAt: r.event_at,
        eventPlace: r.event_place,
        capacity: r.capacity,
        pollOptions: r.poll_options,
        drop: d ? { id: d.id, title: d.title, state: dropState(d, now) } : null,
        model: m ? { id: m.id, name: m.name, type: m.type, lookbook: m.lookbook, slug: m.slug } : null,
        externalUrl: r.external_url,
        segment: r.segment_id ? (segmentOf.get(r.segment_id) ?? null) : null,
        published: r.published_at !== null,
        publishedAt: r.published_at,
        createdAt: r.created_at,
        createdBy: r.created_by && creatorOf.has(r.created_by) ? { id: r.created_by, email: creatorOf.get(r.created_by)! } : null,
        photos: photos.get(r.id) ?? [],
        answers: answers.get(r.id) ?? EMPTY_ANSWERS(),
        results: r.kind === 'POLL' ? results.get(r.id) ?? null : null,
      };
    });
  }
}

/** A drop's or a model's id as the console sends it; anything else is the same 404 as an unknown one. */
function knownLink(id: string, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

// ── A post as its readers see it ──────────────────────────────────────────

/**
 * A post is shown from its `published_at` on: the console publishes one at once, and the publication of a LIVE RELEASE
 * (services/live-console.ts) schedules its own for the release's announcement; NULL, it is withdrawn.
 */
function shownAt(publishedAt: Date | null, now: Date): boolean {
  return publishedAt !== null && publishedAt.getTime() <= now.getTime();
}

/** What a member's view of a post reads of the drop it links. */
const LINKED_DROP_COLUMNS = [
  'id', 'title', 'mode', 'parent_drop_id', 'published_at', 'cancelled_at', 'drawn_at', 'opens_at', 'closes_at', 'announce_at', 'silhouette_at', 'name_at', 'photo_at', 'room_opens_minutes',
] as const;

/**
 * The drop a post links, as a member reads it: a draw once published; a LIVE RELEASE once announced and while not
 * cancelled (an after-room never), its title once its name is revealed (« LIVE RELEASE » before: the staged reveals hold in the circle too).
 */
function linkedDrop(d: Pick<DropRow, (typeof LINKED_DROP_COLUMNS)[number]>, now: Date): { id: string; title: string } | null {
  // An after-room is never linked (checkLinks): should one be, the circle still says nothing of it.
  if (d.parent_drop_id !== null) return null;
  if (d.mode !== 'LIVE') return dropState(d, now) !== 'DRAFT' ? { id: d.id, title: d.title } : null;
  if (d.cancelled_at || !isAnnounced(d, now)) return null;
  return { id: d.id, title: liveStages(d, now)?.name ? d.title : 'LIVE RELEASE' };
}
