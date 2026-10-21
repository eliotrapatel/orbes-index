/**
 * House messages (macro scope of 2026-10-20, D24 M2 to M4; lot M2 plan §1.3, §1.4, steps M2.2 and M2.3): what ORBES
 * writes to an account, in MESSAGES only (never `client_conversations`: they never reach the Messages board, never make
 * a conversation TO_ANSWER, and no reply is written under them), read-only. Two sources (`house_deliveries`, migration
 * 0052): a moment (services/house-moments.ts), its title and words rendered at delivery and stored with it; a custom
 * message written by staff, its words read from the message itself, {firstName} filled at reading.
 *
 * The collector's side (step M2.2):
 *   list        GET /api/v1/account/house-messages?page=: the account's, newest first, 30 a page, each with whether it
 *               is unread, with how many are unread and how many there are in all.
 *   markRead    POST /api/v1/account/house-messages/read {upTo}: read up to a time, never later than now.
 *   unread      whether one is unread (GET /api/v1/account/messages/unread's `house`: NOW's line and the sheet's NEW).
 *   unreadCount how many are unread (GET /api/v1/account/messages/unread-count adds them to the answers unread).
 *
 * The custom messages, the console's side (step M2.3, routes/admin/house.ts):
 *   create / update / remove   written by an OPERATOR: a title (one line, at most 80 characters) and words (plain
 *               paragraphs, at most 2 000), {firstName} their only placeholder, no link; to a segment (any saved one) or
 *               a tier read as "this tier and above" (TITANE, PLATINE, PALLADIUM), exactly one (422 HOUSE_AUDIENCE).
 *               A DRAFT or a SCHEDULED message is edited; only a DRAFT is deleted; a SENT one never changes (409
 *               HOUSE_MESSAGE_SENT), nor a CANCELLED one (409 HOUSE_MESSAGE_STATE).
 *   count       how many an audience reaches now under the delivery rule (the editor's and the send dialog's figure).
 *   send        by an ADMIN, the phrase SEND typed: now (SCHEDULED for now, the sender's next pass delivers it) or at a
 *               Paris date and time (`YYYY-MM-DDTHH:MM` read in Paris, stored in UTC; 422 HOUSE_SEND_PAST before now,
 *               within a year); a SCHEDULED message is rescheduled the same way until it goes.
 *   cancel      by an ADMIN, a SCHEDULED message: CANCELLED, kept with its audience's name.
 *   messages / message   the list (newest first, by status) and one message, with its reach, how many read it and
 *               the share; a draft or scheduled one with the reach its audience has now.
 *
 * Who receives anything: ACTIVE accounts only (never a LOCKED or DELETED one), never a test entrant (`notTestEntrant`).
 * A tier is read with the segments' own TIER criterion on a one-rule group, so both audiences go through one path
 * (services/segments.ts segmentMembers, as services/live.ts reads a release's minimum tier).
 *
 * The delivery (`deliverDue`, the loop `HouseSender` started in context.ts, every 30 seconds, stopped on close): each
 * SCHEDULED message due is claimed under `FOR UPDATE SKIP LOCKED` (two processes never take one twice), its audience
 * evaluated at that moment and frozen there by one `INSERT … SELECT` of a delivery per member (`ON CONFLICT (dedupe_key)
 * DO NOTHING`, the key `CUSTOM:<message>:<account>`), then marked SENT with its reach and its audience's name, in one
 * transaction. A message that cannot be delivered is logged and left SCHEDULED for the next pass; the others go on.
 *
 * Audit (never a collector's name or email; the words as their length and SHA-256, the circle's rule):
 * `house.message.create`, `.update`, `.delete`, `.schedule`, `.send`, `.cancel` (the audience as a segment's id or a
 * tier), and `house.message.delivered {id, reach}` with the system as actor.
 *
 * Kept with the account, as messages are: never deleted (the table refuses it), in its export (`accountHouseMessages`)
 * with when each was read. A lock leaves them as they are; a LOCKED account receives nothing new.
 */
import { createHash } from 'node:crypto';
import { sql, type Selectable, type SqlBool } from 'kysely';
import { inTransaction, jitOff, type Db } from '../db/connection.js';
import { CLUB_TIER_NAMES, type HouseDeliverySource, type HouseMessageStatus, type HouseMoment, type HouseMessagesTable } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, noopLogger, pageOffset, SYSTEM_ACTOR, systemClock, type Actor, type Clock, type Logger, type Page, type PageRequest } from '../types.js';
import { HOUSE_CUSTOM_PLACEHOLDERS, renderHouseWords } from '../../shared/house-words.js';
import type { AuditService } from './audit.js';
import { cleanHouseBody, cleanHouseTitle } from './house-moments.js';
import { notTestEntrant } from './population.js';
import { parisLocalInstant } from './schedule.js';
import { cleanCriteria, segmentMembers, type SegmentGroup } from './segments.js';

/** House messages a page of MESSAGES shows. */
export const HOUSE_PAGE_SIZE = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertAccount(accountId: string): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

/** A house message as its collector reads it. */
export interface CollectorHouseMessage {
  id: string;
  source: HouseDeliverySource;
  /** A moment's kind (its links are fixed by it: src/shared/house-words.ts HOUSE_MOMENT_LINKS); null for a custom message. */
  moment: HouseMoment | null;
  title: string;
  body: string;
  /** The piece a first registration or a year of ownership names, by its serial; null otherwise. */
  pieceRef: string | null;
  /** Whether the account still holds that piece (its link then opens the piece, else MY PIECES); null without a piece. */
  pieceHeld: boolean | null;
  at: Date;
  unread: boolean;
}

/** GET /api/v1/account/house-messages. */
export interface CollectorHousePage {
  messages: CollectorHouseMessage[];
  /** How many of the account's house messages are unread, on every page. */
  unread: number;
  /** How many the account has in all. */
  total: number;
}

/** A house message in the account's export (right of access): as its collector reads it, with when it was read. */
export interface ExportedHouseMessage {
  source: HouseDeliverySource;
  moment: HouseMoment | null;
  title: string;
  body: string;
  pieceRef: string | null;
  deliveredAt: Date;
  readAt: Date | null;
}

interface Row {
  id: string;
  source: HouseDeliverySource;
  moment: HouseMoment | null;
  title: string | null;
  body: string | null;
  piece_ref: string | null;
  delivered_at: Date;
  read_at: Date | null;
  custom_title: string | null;
  custom_body: string | null;
  first_name: string | null;
  held: boolean | null;
}

/** The account's deliveries with their words (a custom message's from the message), newest first unless `oldestFirst`. */
function rows(db: Db, accountId: string, opts: { limit?: number; offset?: number; oldestFirst?: boolean } = {}) {
  const order = opts.oldestFirst ? sql`d.delivered_at ASC, d.id ASC` : sql`d.delivered_at DESC, d.id DESC`;
  return sql<Row>`
    SELECT d.id, d.source, d.moment, d.title, d.body, d.piece_ref, d.delivered_at, d.read_at,
           hm.title AS custom_title, hm.body AS custom_body, pr.first_name,
           CASE WHEN d.piece_ref IS NULL THEN NULL ELSE EXISTS (
             SELECT 1 FROM ownership o JOIN products p ON p.id = o.product_id
              WHERE p.product_id = d.piece_ref AND o.account_id = d.account_id AND o.ended_at IS NULL) END AS held
      FROM house_deliveries d
      LEFT JOIN house_messages hm ON hm.id = d.house_message_id
      LEFT JOIN account_profiles pr ON pr.account_id = d.account_id
     WHERE d.account_id = ${accountId}
     ORDER BY ${order}
     ${opts.limit !== undefined ? sql`LIMIT ${opts.limit} OFFSET ${opts.offset ?? 0}` : sql``}`.execute(db);
}

/** A delivery's title and words as read: a moment's as stored, a custom message's with {firstName} filled now. */
function wordsOf(r: Row): { title: string; body: string } {
  if (r.source === 'MOMENT') return { title: r.title ?? '', body: r.body ?? '' };
  const values = { firstName: r.first_name };
  return { title: renderHouseWords(r.custom_title ?? '', values).replace(/\s+/g, ' ').trim(), body: renderHouseWords(r.custom_body ?? '', values).trim() };
}

/** Every house message of the account, oldest first, as its export gives it. */
export async function accountHouseMessages(db: Db, accountId: string): Promise<ExportedHouseMessage[]> {
  const r = await rows(db, accountId, { oldestFirst: true });
  return r.rows.map((x) => ({ source: x.source, moment: x.moment, ...wordsOf(x), pieceRef: x.piece_ref, deliveredAt: x.delivered_at, readAt: x.read_at }));
}

// ── The custom messages (step M2.3) ────────────────────────────────────────

/** The sender's pass (HouseSender): every 30 seconds; at most this many messages delivered in one pass. */
export const HOUSE_SENDER = Object.freeze({ intervalMs: 30_000, perPass: 20 });
/** A message is scheduled at most this many days ahead. */
export const HOUSE_SCHEDULE_MAX_DAYS = 366;
/** The phrase the send dialog asks for. */
export const HOUSE_SEND_PHRASE = 'SEND';
/** The tiers an audience names: 1 TITANE, 2 PLATINE, 3 PALLADIUM, each read as "this tier and above". */
const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];

/** A custom message's audience: a saved segment, or a tier and above. */
export type HouseAudience = { segmentId: string; tier?: undefined } | { tier: Tier; segmentId?: undefined };

/** A console member as a message names them. */
export interface HouseStaff {
  id: string;
  email: string;
}

/** A custom message as the console reads it. */
export interface AdminHouseMessage {
  id: string;
  title: string;
  body: string;
  status: HouseMessageStatus;
  /**
   * Its audience: the segment's id (null once that segment was deleted after the message went) or the tier, and its
   * name: as written at sending for a SENT message (and at cancelling for a CANCELLED one), the segment's name now or
   * the tier's otherwise (« PLATINE and above »).
   */
  audience: { segmentId: string | null; tier: Tier | null; label: string };
  /** When it goes or went (SCHEDULED, SENT). */
  sendAt: Date | null;
  sentAt: Date | null;
  /** How many it reached, recorded at delivery (SENT); how many of them read it, and their share (0 to 1; null for none reached). */
  reach: number | null;
  read: number | null;
  shareRead: number | null;
  createdAt: Date;
  createdBy: HouseStaff | null;
  updatedAt: Date;
  updatedBy: HouseStaff | null;
  /** Who scheduled or sent it. */
  sentBy: HouseStaff | null;
  cancelledAt: Date | null;
  cancelledBy: HouseStaff | null;
}

/** One message, with, while a DRAFT or SCHEDULED, the reach its audience has now. */
export interface AdminHouseMessageDetail extends AdminHouseMessage {
  reachNow: number | null;
}

type MessageRow = Selectable<HouseMessagesTable>;

const messageNotFound = () => notFound('House message', 'HOUSE_MESSAGE_NOT_FOUND');
const messageSent = () => conflict('HOUSE_MESSAGE_SENT', 'This message was sent: it no longer changes.');
const stateConflict = (message: string) => conflict('HOUSE_MESSAGE_STATE', message);
const audienceError = () => new DomainError('HOUSE_AUDIENCE', 422, 'Choose one audience: a segment or a tier.');
const sendPast = () => new DomainError('HOUSE_SEND_PAST', 422, 'Choose a time to come, in Paris.');

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function knownMessage(v: unknown): string {
  if (typeof v !== 'string' || !UUID_ID.test(v)) throw messageNotFound();
  return v.toLowerCase();
}

function staffOf(actor: Actor, what: string): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_ID.test(actor.id)) throw forbidden(`Only ORBES staff can ${what}.`);
  return actor.id.toLowerCase();
}

/** The words' fingerprint in the audit log: their length and SHA-256, never the words (the circle's rule). */
function fingerprint(s: string): { length: number; sha256: string } {
  return { length: [...s].length, sha256: createHash('sha256').update(s, 'utf8').digest('hex') };
}

/** A custom message's title: one line of 1 to 80 characters, {firstName} its only placeholder. */
export function cleanCustomTitle(v: unknown): string {
  const t = cleanHouseTitle(v, HOUSE_CUSTOM_PLACEHOLDERS);
  if (t === null) throw validationError('Write a title.');
  return t;
}

/** A custom message's words: plain paragraphs of at most 2 000 characters, {firstName} their only placeholder. */
export function cleanCustomBody(v: unknown): string {
  const t = cleanHouseBody(v, HOUSE_CUSTOM_PLACEHOLDERS);
  if (t === null) throw validationError('Write the message.');
  return t;
}

/** An audience as the console sends it: exactly one of a segment's id and a tier (1 TITANE, 2 PLATINE, 3 PALLADIUM). */
export function cleanAudience(v: unknown): HouseAudience {
  const a = (v && typeof v === 'object' ? v : {}) as { segmentId?: unknown; tier?: unknown };
  const hasSegment = a.segmentId !== undefined && a.segmentId !== null;
  const hasTier = a.tier !== undefined && a.tier !== null;
  if (hasSegment === hasTier) throw audienceError();
  if (hasSegment) {
    if (typeof a.segmentId !== 'string' || !UUID_ID.test(a.segmentId)) throw notFound('Segment', 'SEGMENT_NOT_FOUND');
    return { segmentId: a.segmentId.toLowerCase() };
  }
  if (typeof a.tier !== 'number' || !(TIERS as readonly number[]).includes(a.tier)) throw validationError('A tier is 1 (TITANE), 2 (PLATINE) or 3 (PALLADIUM).');
  return { tier: a.tier as Tier };
}

/** A tier's audience in words: « TITANE and above », « PLATINE and above », « PALLADIUM ». */
export function tierAudienceLabel(tier: Tier): string {
  const name = CLUB_TIER_NAMES[tier - 1]!;
  return tier === TIERS.length ? name : `${name} and above`;
}

/** An audience's name as stored (house_messages.audience_label): one line, at most 80 characters. */
function storedLabel(s: string): string {
  // eslint-disable-next-line no-control-regex
  const line = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...line];
  return (chars.length > 80 ? chars.slice(0, 80).join('').trimEnd() : line) || 'A segment';
}

/** The rule tree a tier stands for: the segments' TIER criterion, this tier and above (services/live.ts reads it so). */
function tierCriteria(tier: Tier): SegmentGroup {
  return { match: 'ALL', rules: [{ kind: 'TIER', tiers: TIERS.filter((t) => t >= tier) }] };
}

export interface HouseMessageServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
}

export class HouseMessageService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: HouseMessageServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /** A page of the account's house messages, newest first (page 1 the newest), with the unread count and the total. */
  async list(accountId: string, page = 1): Promise<CollectorHousePage> {
    const account = assertAccount(accountId);
    const p = Number.isInteger(page) && page >= 1 ? Math.min(page, 100_000) : 1;
    const counts = await this.db
      .selectFrom('house_deliveries')
      .select((eb) => [eb.fn.countAll<string | number>().as('total'), eb.fn.count<string | number>('id').filterWhere('read_at', 'is', null).as('unread')])
      .where('account_id', '=', account)
      .executeTakeFirstOrThrow();
    const r = await rows(this.db, account, { limit: HOUSE_PAGE_SIZE, offset: (p - 1) * HOUSE_PAGE_SIZE });
    return {
      messages: r.rows.map((x) => ({
        id: x.id,
        source: x.source,
        moment: x.moment,
        ...wordsOf(x),
        pieceRef: x.piece_ref,
        pieceHeld: x.held,
        at: x.delivered_at,
        unread: x.read_at === null,
      })),
      unread: Number(counts.unread),
      total: Number(counts.total),
    };
  }

  /** Whether a house message is unread (NOW's line, the account's NEW). */
  async unread(accountId: string): Promise<{ house: boolean }> {
    const account = assertAccount(accountId);
    const r = await this.db.selectFrom('house_deliveries').select('id').where('account_id', '=', account).where('read_at', 'is', null).limit(1).executeTakeFirst();
    return { house: r !== undefined };
  }

  /** How many house messages are unread. */
  async unreadCount(accountId: string): Promise<number> {
    const account = assertAccount(accountId);
    const r = await this.db
      .selectFrom('house_deliveries')
      .select((eb) => eb.fn.countAll<string | number>().as('n'))
      .where('account_id', '=', account)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** The collector has read its house messages delivered up to `upTo` (never later than now); a read one stays read. */
  async markRead(accountId: string, upTo: Date): Promise<void> {
    const account = assertAccount(accountId);
    if (!(upTo instanceof Date) || Number.isNaN(upTo.getTime())) throw validationError('upTo must be a date-time.');
    const now = this.clock();
    const at = new Date(Math.min(upTo.getTime(), now.getTime()));
    await this.db
      .updateTable('house_deliveries')
      .set({ read_at: at })
      .where('account_id', '=', account)
      .where('read_at', 'is', null)
      .where('delivered_at', '<=', at)
      .execute();
  }

  // ── The console: custom messages (step M2.3) ─────────────────────────────

  /** How many an audience reaches now: the ACTIVE accounts it matches, never a test entrant (the editor's live figure). */
  async count(audience: unknown): Promise<{ count: number }> {
    const a = cleanAudience(audience);
    return inTransaction(this.db, async (tx) => ({ count: await this.reachOf(tx, await this.criteriaOf(tx, a), this.clock()) }));
  }

  /** The custom messages, newest first, of one status or all, a page at a time. */
  async messages(filter: { status?: HouseMessageStatus }, page: PageRequest): Promise<Page<AdminHouseMessage>> {
    const base = () => (filter.status ? this.db.selectFrom('house_messages').where('status', '=', filter.status) : this.db.selectFrom('house_messages'));
    const total = await base()
      .select((eb) => eb.fn.countAll<string | number>().as('n'))
      .executeTakeFirstOrThrow();
    const rows = await base().selectAll().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(page.pageSize).offset(pageOffset(page)).execute();
    return makePage(await this.views(this.db, rows), Number(total.n), page);
  }

  /** One custom message (404 HOUSE_MESSAGE_NOT_FOUND), with the reach its audience has now while it has not gone (null if unreadable). */
  async message(id: string): Promise<AdminHouseMessageDetail> {
    const mid = knownMessage(id);
    const row = await this.db.selectFrom('house_messages').selectAll().where('id', '=', mid).executeTakeFirst();
    if (!row) throw messageNotFound();
    const [view] = await this.views(this.db, [row]);
    let reachNow: number | null = null;
    if (row.status === 'DRAFT' || row.status === 'SCHEDULED') {
      // A segment whose rules no longer read (never through the console) gives no figure; the message is still shown.
      reachNow = await inTransaction(this.db, async (tx) => this.reachOf(tx, await this.criteriaOf(tx, audienceOf(row)), this.clock())).catch((e: unknown) => {
        if (e instanceof DomainError) return null;
        throw e;
      });
    }
    return { ...view!, reachNow };
  }

  /** A new DRAFT (OPERATOR): its title, words and audience. Audited `house.message.create` (the words as fingerprints). */
  async create(input: { title: unknown; body: unknown; audience: unknown }, actor: Actor): Promise<AdminHouseMessageDetail> {
    const by = staffOf(actor, 'write a house message');
    const title = cleanCustomTitle(input?.title);
    const body = cleanCustomBody(input?.body);
    const a = cleanAudience(input?.audience);
    const id = await inTransaction(this.db, async (tx) => {
      await this.criteriaOf(tx, a);
      const now = this.clock();
      const row = await tx
        .insertInto('house_messages')
        .values({ title, body, audience_segment_id: a.segmentId ?? null, audience_min_tier: a.tier ?? null, created_by: by, created_at: now, updated_by: by, updated_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        { actor, action: 'house.message.create', targetType: 'house_message', targetId: row.id, details: { title: fingerprint(title), body: fingerprint(body), audience: audienceDetails(a) } },
        tx,
      );
      return row.id;
    });
    return this.message(id);
  }

  /**
   * A DRAFT's or a SCHEDULED message's title, words or audience (OPERATOR; a scheduled one keeps its time). A SENT message
   * never changes (409 HOUSE_MESSAGE_SENT), nor a CANCELLED one (409 HOUSE_MESSAGE_STATE). Audited `house.message.update`
   * with what changed (the words as fingerprints, the audience before and after); nothing changed, nothing written.
   */
  async update(id: string, change: { title?: unknown; body?: unknown; audience?: unknown }, actor: Actor): Promise<AdminHouseMessageDetail> {
    const by = staffOf(actor, 'change a house message');
    const mid = knownMessage(id);
    const title = change?.title === undefined ? undefined : cleanCustomTitle(change.title);
    const body = change?.body === undefined ? undefined : cleanCustomBody(change.body);
    const a = change?.audience === undefined ? undefined : cleanAudience(change.audience);
    await inTransaction(this.db, async (tx) => {
      const m = await this.locked(tx, mid);
      if (m.status === 'SENT') throw messageSent();
      if (m.status === 'CANCELLED') throw stateConflict('This message was cancelled: it no longer changes.');
      if (a) await this.criteriaOf(tx, a);
      const details: Record<string, unknown> = {};
      if (title !== undefined && title !== m.title) details.title = fingerprint(title);
      if (body !== undefined && body !== m.body) details.body = fingerprint(body);
      const before = audienceOf(m);
      if (a && ((a.segmentId ?? null) !== (before.segmentId ?? null) || (a.tier ?? null) !== (before.tier ?? null))) {
        details.audience = { before: audienceDetails(before), after: audienceDetails(a) };
      }
      if (Object.keys(details).length === 0) return;
      await tx
        .updateTable('house_messages')
        .set({
          ...(details.title ? { title } : {}),
          ...(details.body ? { body } : {}),
          ...(details.audience ? { audience_segment_id: a!.segmentId ?? null, audience_min_tier: a!.tier ?? null } : {}),
          updated_by: by,
          updated_at: this.clock(),
        })
        .where('id', '=', mid)
        .execute();
      await this.audit.record({ actor, action: 'house.message.update', targetType: 'house_message', targetId: mid, details: details as never }, tx);
    });
    return this.message(mid);
  }

  /** Delete a DRAFT (OPERATOR); a scheduled message is cancelled instead, a sent or cancelled one kept. Audited `house.message.delete`. */
  async remove(id: string, actor: Actor): Promise<void> {
    staffOf(actor, 'delete a house message');
    const mid = knownMessage(id);
    await inTransaction(this.db, async (tx) => {
      const m = await this.locked(tx, mid);
      if (m.status === 'SENT') throw messageSent();
      if (m.status === 'SCHEDULED') throw stateConflict('This message is scheduled: cancel it instead.');
      if (m.status === 'CANCELLED') throw stateConflict('This message was cancelled: it is kept.');
      await tx.deleteFrom('house_messages').where('id', '=', mid).execute();
      await this.audit.record(
        { actor, action: 'house.message.delete', targetType: 'house_message', targetId: mid, details: { title: fingerprint(m.title), body: fingerprint(m.body), audience: audienceDetails(audienceOf(m)) } },
        tx,
      );
    });
  }

  /**
   * Send a DRAFT, or reschedule a SCHEDULED message (ADMIN, the phrase SEND typed): now when `at` is absent (SCHEDULED
   * for now: the sender's next pass delivers it, within 30 seconds), or at `at`, a Paris date and time
   * `YYYY-MM-DDTHH:MM` (the minute under way counts as now; 422 HOUSE_SEND_PAST before it; at most a year ahead).
   * Audited `house.message.send` or `house.message.schedule`, with its time, audience and reach now.
   */
  async send(id: string, input: { at?: unknown; phrase: unknown }, actor: Actor): Promise<AdminHouseMessageDetail> {
    const by = staffOf(actor, 'send a house message');
    const mid = knownMessage(id);
    if (typeof input?.phrase !== 'string' || input.phrase.trim().toUpperCase() !== HOUSE_SEND_PHRASE) throw validationError(`Type ${HOUSE_SEND_PHRASE} to confirm.`);
    const now = this.clock();
    let at: Date | null = null;
    if (input.at !== undefined && input.at !== null) {
      at = typeof input.at === 'string' ? parisLocalInstant(input.at) : null;
      if (at === null) throw validationError('Choose a date and a time in Paris that exist (YYYY-MM-DDTHH:MM).');
      if (at.getTime() + 60_000 <= now.getTime()) throw sendPast();
      if (at.getTime() - now.getTime() > HOUSE_SCHEDULE_MAX_DAYS * 86_400_000) throw validationError('A message is scheduled at most a year ahead.');
    }
    const sendAt = at && at.getTime() > now.getTime() ? at : now;
    await inTransaction(this.db, async (tx) => {
      const m = await this.locked(tx, mid);
      if (m.status === 'SENT') throw messageSent();
      if (m.status === 'CANCELLED') throw stateConflict('This message was cancelled: write it again to send it.');
      const a = audienceOf(m);
      const reach = await this.reachOf(tx, await this.criteriaOf(tx, a), now);
      await tx.updateTable('house_messages').set({ status: 'SCHEDULED', send_at: sendAt, sent_by: by }).where('id', '=', mid).execute();
      await this.audit.record(
        {
          actor,
          action: at ? 'house.message.schedule' : 'house.message.send',
          targetType: 'house_message',
          targetId: mid,
          details: { sendAt: sendAt.toISOString(), audience: audienceDetails(a), reach, rescheduled: m.status === 'SCHEDULED' },
        },
        tx,
      );
    });
    return this.message(mid);
  }

  /** Cancel a SCHEDULED message (ADMIN): CANCELLED, kept with its audience's name. Audited `house.message.cancel`. */
  async cancel(id: string, actor: Actor): Promise<AdminHouseMessageDetail> {
    const by = staffOf(actor, 'cancel a house message');
    const mid = knownMessage(id);
    await inTransaction(this.db, async (tx) => {
      const m = await this.locked(tx, mid);
      if (m.status === 'SENT') throw messageSent();
      if (m.status === 'DRAFT') throw stateConflict('This message is a draft: delete it instead.');
      if (m.status === 'CANCELLED') throw stateConflict('This message is already cancelled.');
      const a = audienceOf(m);
      await tx
        .updateTable('house_messages')
        .set({ status: 'CANCELLED', send_at: null, cancelled_at: this.clock(), cancelled_by: by, audience_label: await this.labelOf(tx, a) })
        .where('id', '=', mid)
        .execute();
      await this.audit.record(
        { actor, action: 'house.message.cancel', targetType: 'house_message', targetId: mid, details: { sendAt: m.send_at ? m.send_at.toISOString() : null, audience: audienceDetails(a) } },
        tx,
      );
    });
    return this.message(mid);
  }

  /**
   * The sender's pass (HouseSender, every 30 seconds; tests call it): each SCHEDULED message due at `now`, oldest first,
   * claimed under FOR UPDATE SKIP LOCKED, its audience evaluated now and frozen by one INSERT … SELECT of a delivery per
   * member, then SENT with its reach and its audience's name, in one transaction; at most HOUSE_SENDER.perPass messages.
   * A message that cannot be delivered is logged and left SCHEDULED for the next pass; the others go on.
   */
  async deliverDue(now: Date = this.clock()): Promise<{ messages: number; deliveries: number }> {
    const failed: string[] = [];
    let messages = 0;
    let deliveries = 0;
    for (let i = 0; i < HOUSE_SENDER.perPass; i++) {
      const claim: { id: string | null } = { id: null };
      let reach: number | null;
      try {
        reach = await inTransaction(this.db, async (tx) => {
          let due = tx.selectFrom('house_messages').selectAll().where('status', '=', 'SCHEDULED').where('send_at', '<=', now);
          if (failed.length > 0) due = due.where('id', 'not in', failed);
          const m = await due.orderBy('send_at').orderBy('id').limit(1).forUpdate().skipLocked().executeTakeFirst();
          if (!m) return null;
          claim.id = m.id;
          const a = audienceOf(m);
          const criteria = await this.criteriaOf(tx, a);
          const label = await this.labelOf(tx, a);
          await jitOff(tx);
          const members = this.members(tx, criteria, now).select([
            'a.id as account_id',
            sql<'CUSTOM'>`'CUSTOM'`.as('source'),
            sql<string>`${m.id}::uuid`.as('house_message_id'),
            sql<string>`${`CUSTOM:${m.id}:`} || a.id::text`.as('dedupe_key'),
            sql<Date>`${now}::timestamptz`.as('delivered_at'),
          ]);
          await tx
            .insertInto('house_deliveries')
            .columns(['account_id', 'source', 'house_message_id', 'dedupe_key', 'delivered_at'])
            .expression(members)
            .onConflict((oc) => oc.column('dedupe_key').doNothing())
            .execute();
          const n = Number(
            (await tx.selectFrom('house_deliveries').select((eb) => eb.fn.countAll<string | number>().as('n')).where('house_message_id', '=', m.id).executeTakeFirstOrThrow()).n,
          );
          await tx.updateTable('house_messages').set({ status: 'SENT', sent_at: now, reach: n, audience_label: label }).where('id', '=', m.id).execute();
          await this.audit.record({ actor: SYSTEM_ACTOR, action: 'house.message.delivered', targetType: 'house_message', targetId: m.id, details: { id: m.id, reach: n } }, tx);
          return n;
        });
      } catch (e) {
        if (claim.id === null) throw e;
        failed.push(claim.id);
        this.log.error({ id: claim.id, err: { message: (e as Error)?.message } }, 'a house message could not be delivered');
        continue;
      }
      if (reach === null) break;
      messages++;
      deliveries += reach;
    }
    if (messages > 0) this.log.info({ messages, deliveries }, 'house messages');
    return { messages, deliveries };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The message under its row's lock (404 HOUSE_MESSAGE_NOT_FOUND): a change waits for the sender, then sees SENT. */
  private async locked(tx: Db, id: string): Promise<MessageRow> {
    const m = await tx.selectFrom('house_messages').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!m) throw messageNotFound();
    return m;
  }

  /** The members a rule tree has at `now` under the delivery rule: ACTIVE (segmentMembers), never a test entrant. */
  private members(db: Db, criteria: SegmentGroup, now: Date) {
    return segmentMembers(db, criteria, now).where(sql<SqlBool>`${notTestEntrant('a.id')}`);
  }

  /** How many those are (inside a transaction: JIT off, as the segments' count). */
  private async reachOf(tx: Db, criteria: SegmentGroup, now: Date): Promise<number> {
    await jitOff(tx);
    const r = await this.members(tx, criteria, now).select((eb) => eb.fn.countAll<string | number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** An audience's rule tree: its segment's criteria (404 SEGMENT_NOT_FOUND), or its tier's. */
  private async criteriaOf(db: Db, a: HouseAudience): Promise<SegmentGroup> {
    if (a.tier !== undefined) return tierCriteria(a.tier);
    const s = await db.selectFrom('segments').select('criteria').where('id', '=', a.segmentId).executeTakeFirst();
    if (!s) throw notFound('Segment', 'SEGMENT_NOT_FOUND');
    return cleanCriteria(s.criteria);
  }

  /** An audience's name as stored with a sent or cancelled message. */
  private async labelOf(db: Db, a: HouseAudience): Promise<string> {
    if (a.tier !== undefined) return tierAudienceLabel(a.tier);
    const s = await db.selectFrom('segments').select('name').where('id', '=', a.segmentId).executeTakeFirst();
    return storedLabel(s?.name ?? 'A segment');
  }

  /** The console's views of `rows`: the audience's name, the staff, and for the sent ones how many read them. */
  private async views(db: Db, rows: readonly MessageRow[]): Promise<AdminHouseMessage[]> {
    if (rows.length === 0) return [];
    const segmentIds = [...new Set(rows.flatMap((r) => (r.audience_segment_id ? [r.audience_segment_id] : [])))];
    const staffIds = [...new Set(rows.flatMap((r) => [r.created_by, r.updated_by, r.sent_by, r.cancelled_by].filter((x): x is string => typeof x === 'string')))];
    const sent = rows.filter((r) => r.status === 'SENT').map((r) => r.id);
    const segments = segmentIds.length ? await db.selectFrom('segments').select(['id', 'name']).where('id', 'in', segmentIds).execute() : [];
    const staff = staffIds.length ? await db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', staffIds).execute() : [];
    const reads = sent.length
      ? await db
          .selectFrom('house_deliveries')
          .select((eb) => ['house_message_id', eb.fn.count<string | number>('id').filterWhere('read_at', 'is not', null).as('read')])
          .where('house_message_id', 'in', sent)
          .groupBy('house_message_id')
          .execute()
      : [];
    const segmentName = new Map(segments.map((s) => [s.id, s.name]));
    const who = new Map(staff.map((a) => [a.id, { id: a.id, email: a.email }]));
    const readOf = new Map(reads.map((r) => [r.house_message_id, Number(r.read)]));
    const person = (id: string | null) => (id ? (who.get(id) ?? null) : null);
    return rows.map((r) => {
      const tier = (r.audience_min_tier ?? null) as Tier | null;
      const label = r.audience_label ?? (r.audience_segment_id ? (segmentName.get(r.audience_segment_id) ?? 'A segment') : tier ? tierAudienceLabel(tier) : 'No audience');
      const read = r.status === 'SENT' ? (readOf.get(r.id) ?? 0) : null;
      const reach = r.status === 'SENT' ? (r.reach ?? 0) : null;
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        status: r.status,
        audience: { segmentId: r.audience_segment_id, tier, label },
        sendAt: r.send_at,
        sentAt: r.sent_at,
        reach,
        read,
        shareRead: read !== null && reach ? read / reach : null,
        createdAt: r.created_at,
        createdBy: person(r.created_by),
        updatedAt: r.updated_at,
        updatedBy: person(r.updated_by),
        sentBy: person(r.sent_by),
        cancelledAt: r.cancelled_at,
        cancelledBy: person(r.cancelled_by),
      };
    });
  }
}

/** A message's audience as stored (a SCHEDULED or DRAFT one has exactly one: house_messages_audience). */
function audienceOf(m: Pick<MessageRow, 'audience_segment_id' | 'audience_min_tier'>): HouseAudience {
  if (m.audience_min_tier !== null && (TIERS as readonly number[]).includes(m.audience_min_tier)) return { tier: m.audience_min_tier as Tier };
  if (m.audience_segment_id) return { segmentId: m.audience_segment_id };
  throw audienceError();
}

/** An audience in the audit log: a segment's id or a tier, never a member. */
function audienceDetails(a: HouseAudience): { segmentId: string } | { tier: number } {
  return a.tier !== undefined ? { tier: a.tier } : { segmentId: a.segmentId };
}

/**
 * The loop that delivers the custom messages (plan §1.3): started in context.ts beside the LIVE engine and the emails'
 * sender, always on, a pass every 30 seconds (HouseMessageService.deliverDue), stopped on close (the pass under way
 * finishes its transaction). A message scheduled for 18:00 Paris is in MESSAGES by 18:00:30.
 */
export class HouseSender {
  private readonly messages: HouseMessageService;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly intervalMs: number;
  private timers = false;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(deps: { messages: HouseMessageService; clock?: Clock; log?: Logger; intervalMs?: number }) {
    this.messages = deps.messages;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.intervalMs = deps.intervalMs ?? HOUSE_SENDER.intervalMs;
  }

  /** At the process's start: a pass now, then one every 30 seconds. */
  start(): void {
    this.timers = true;
    this.schedule(0);
  }

  /** At the process's close: no new pass; the one under way finishes. */
  async stop(): Promise<void> {
    this.timers = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  private schedule(ms: number): void {
    if (!this.timers) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = (async () => {
      try {
        await this.messages.deliverDue(this.clock());
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'house messages: a pass of the sender failed');
      }
    })();
    await this.running;
    this.running = null;
    this.schedule(this.intervalMs);
  }
}
