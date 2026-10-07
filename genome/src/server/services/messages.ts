/**
 * MESSAGES (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; API §10.17 and §16.28; DATABASE §5.62 and §5.63): every place of
 * the collector app that showed an email address, a phone number or opening hours now shows WRITE TO ORBES CLIENT
 * SERVICES. The collector writes; ORBES Client Services answer in the console; the answers are read in the account's
 * MESSAGES. Only people write here: the house writes nothing on its own (no automatic message, no notification), and
 * nothing is emailed. Messages carry no files.
 *
 * One conversation per collector (`client_conversations`). Each collector message may concern one place of the app,
 * which the server checks and labels (`resolveContext`): a PIECE the account owns now, an ORDER of the account, a
 * RELEASE published (a LIVE one only once announced and its name revealed; with the account's own entry: PLACE HELD,
 * PLACE RESERVED, CONCLUDED, CONFIRMED · REFERENCE LR-…, REMOVED), a
 * SCAN at most 24 hours old (REPORT_WINDOW_MS; with WARRANTY on the warranty tab), a MODEL the account's lookbook
 * reaches (with its open or latest salon request). The label is a snapshot; the console links the row it names.
 *
 *   write     POST /api/v1/account/messages: the context resolved first; then in one transaction, the account FOR
 *             SHARE (403 ACCOUNT_LOCKED when locked), the rate (MESSAGE_RATE: 10 in a rolling hour, else 429
 *             MESSAGE_LIMIT), the
 *             conversation created or locked FOR UPDATE, the message; TO_ANSWER, its waiting time kept when it was
 *             waiting already; a CLOSED conversation reopens. Audited `message.write` with the account as actor.
 *   thread    GET /api/v1/account/messages: the conversation oldest first, staff never named (ORBES CLIENT SERVICES),
 *             the statuses never shown; `unread` while an answer is newer than what the collector read.
 *   markRead  POST /api/v1/account/messages/read: read up to a time (never later than now).
 *   board     GET /api/admin/messages: TO_ANSWER first; within it PALLADIUM, then PLATINE, then the rest (the tier read
 *             now, `clubStandings`), the longest waiting first in each; then the others, newest message first. The
 *             priority applies from THE PROGRAM's `messages_priority_min_tier` (BP-19 T8: PLATINE by default,
 *             PALLADIUM, or off: then the longest waiting first only), read at each board.
 *   answer    POST /api/admin/messages/:id/answer (OPERATOR): an existing conversation only (staff never open one:
 *             404 CONVERSATION_NOT_FOUND), FOR UPDATE; ANSWERED, and `answered_by` set when empty. `message.answer`.
 *   take / assign / close: who answers it (`message.take`, `message.assign {before, after}`, ADMIN), and CLOSED
 *             (`message.close`); the collector never sees it, and writing again reopens it.
 *
 * No audit entry ever holds a message's words: only ids, the kind of a context and whether it reopened. A lock of the
 * account leaves its conversation as it is: staff can still answer it. Messages are kept with the account, included in
 * its export (accountMessages), and never deleted; the scan retention clears a message's scan id and keeps its REF.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import {
  CLIENT_CONVERSATION_STATUSES,
  type ClientConversationStatus,
  type ClientMessageAuthor,
  type ClientMessageContext,
  type DropMode,
} from '../db/schema.js';
import { DomainError, conflict, forbidden, notFound, validationError } from '../errors.js';
import { makePage, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';
import { customerAccountLocked, normalizeEmail } from './auth.js';
import { clubStandings, tierName, type ClubTier, type ClubTierName } from './club.js';
import { openCareOf } from './care.js';
import { readProgram, type PriorityTier } from './club-program.js';
import { entryReserved } from './drops.js';
import { liveReference } from './live-console.js';
import { isAnnounced, liveStages, stagesAt } from './live.js';
import type { LookbookService } from './lookbook.js';
import { orderReference } from './orders.js';
import { REPORT_WINDOW_MS } from './scan-reports.js';

/** The longest message of a collector and of a staff answer, and the longest label of a context (also CHECKs of 0025). */
export const MESSAGE_LIMITS = Object.freeze({ collector: 2000, staff: 4000, label: 120 });
/** A collector writes at most `messages` messages in any rolling `windowMs`. */
export const MESSAGE_RATE = Object.freeze({ messages: 10, windowMs: 60 * 60_000 });
/**
 * Whether a conversation is answered first and marked on the board: its account's tier read now (`tier.level`) from
 * THE PROGRAM's `messages_priority_min_tier` (BP-19 T8; 2 PLATINE by default, 3 PALLADIUM, 0 off). Its mark is the
 * tier's name; null below it, or when the priority is off.
 */
export function priorityOf(tier: ConversationTier, minTier: PriorityTier): ClubTierName | null {
  return minTier !== 0 && tier.level >= minTier ? tier.name : null;
}
/** The excerpt of the last message on the board, in characters. */
export const MESSAGE_EXCERPT = 140;
/** The sides of a conversation as the collector reads them: never a staff member's name. */
export const MESSAGE_FROM = Object.freeze({ COLLECTOR: 'YOU', STAFF: 'ORBES_CLIENT_SERVICES' } as const);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERIAL_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;
const SCAN_REF_RE = /^[0-9A-F]{8}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const messageContextInvalid = () => new DomainError('MESSAGE_CONTEXT_INVALID', 422, 'This cannot be attached to your message.');
export const messageContextExpired = () =>
  new DomainError('MESSAGE_CONTEXT_EXPIRED', 422, 'This scan is more than 24 hours old. Scan the piece again to write about it, or write from MESSAGES.');
export const messageLimit = () => new DomainError('MESSAGE_LIMIT', 429, 'You have written several messages within the hour. Please write again later.');
export const conversationNotFound = () => notFound('Conversation', 'CONVERSATION_NOT_FOUND');

/** What the collector attaches to a message (POST /api/v1/account/messages): a kind and its id; `about` WARRANTY for a SCAN only. */
export interface MessageContextInput {
  kind: ClientMessageContext;
  /** PIECE: the piece's productId (O26-J-00184, or its row id); ORDER: the orderId; RELEASE: the dropId; MODEL: the modelId; SCAN: the scanEventId. */
  id: string;
  about?: 'WARRANTY';
}

/** A message as the collector reads it. */
export interface CollectorMessage {
  id: string;
  from: (typeof MESSAGE_FROM)[keyof typeof MESSAGE_FROM];
  body: string;
  at: Date;
  /** On the collector's own messages: what it concerns, and where it is in the app (null for a scan). */
  concerning: { kind: ClientMessageContext; label: string; path: string | null } | null;
}

/** GET /api/v1/account/messages. */
export interface CollectorThread {
  messages: CollectorMessage[];
  /** An answer is newer than what the collector read. */
  unread: boolean;
}

/** What a message concerns, as the console reads it: the label, and the ids of the row it names (for its link). */
export interface MessageConcerns {
  kind: ClientMessageContext;
  label: string;
  /** PIECE, or the piece of a SCAN: its productId (O26-J-00184). */
  productId: string | null;
  orderId: string | null;
  dropId: string | null;
  /** The release's mode, for its page in the console (Club → Drops or LIVE). */
  dropMode: DropMode | null;
  modelId: string | null;
  shopRequestId: string | null;
  /** The scan while the retention keeps it (the Verification events page filters by it); null once cleared. */
  scanEventId: string | null;
  scanRef: string | null;
}

/** A message as the console reads it: its author named. */
export interface StaffMessage {
  id: string;
  author: ClientMessageAuthor;
  /** The staff member of a STAFF message. */
  admin: { id: string; email: string } | null;
  body: string;
  at: Date;
  concerns: MessageConcerns | null;
}

export interface ConversationTier {
  level: ClubTier;
  name: ClubTierName | null;
}

/** A row of the Messages board. */
export interface BoardConversation {
  id: string;
  account: { id: string; email: string };
  tier: ConversationTier;
  /** `PALLADIUM` or `PLATINE` from THE PROGRAM's priority tier (messages_priority_min_tier), read now; null otherwise. */
  priority: ClubTierName | null;
  /** The latest context of the collector's messages, and how many other places they concern. */
  concerns: MessageConcerns | null;
  moreConcerns: number;
  lastMessage: { author: ClientMessageAuthor; excerpt: string; at: Date };
  waitingSince: Date | null;
  status: ClientConversationStatus;
  answeredBy: { id: string; email: string } | null;
  /**
   * The client's open yearly care (BP-19 T6), read from `care_requests`: the board's and the head's `Yearly care ·
   * O26-J-00184`, a link to its page. It changes neither the status nor the order; null without one.
   */
  care: { id: string; serial: string } | null;
}

/** A conversation of the console (GET /api/admin/messages/:id). */
export interface StaffConversation extends Omit<BoardConversation, 'concerns' | 'moreConcerns' | 'lastMessage'> {
  createdAt: Date;
  closedAt: Date | null;
  closedBy: { id: string; email: string } | null;
  messages: StaffMessage[];
}

export type BoardStatusFilter = ClientConversationStatus | 'ALL';

export interface BoardFilter {
  /** TO_ANSWER by default. */
  status?: BoardStatusFilter;
  /** Mine: answered by the reader; unassigned: by nobody. */
  who?: 'mine' | 'unassigned';
  /** A client's email (part of it), or a scan's REF (8 hex characters). */
  q?: string;
  /**
   * The whole email only, never part of it: for a reader who sees the clients' emails masked (an AUDITOR), so that
   * extending `q` a character at a time cannot rebuild an address.
   */
  exactEmail?: boolean;
}

/** The board's page, with the count of To answer (its filter's label and the sidebar's badge). */
export type BoardPage = Page<BoardConversation> & { toAnswer: number };

/** GET /api/admin/messages/summary: the sidebar's badge. */
export interface MessagesSummary {
  toAnswer: number;
  /** Of them, the conversations answered first (THE PROGRAM's priority tier and up; 0 when it is off). */
  priority: number;
}

/** A message of an account, for its right-of-access export: never the staff member. */
export interface ExportedMessage {
  at: Date;
  from: CollectorMessage['from'];
  body: string;
  concerning: { kind: ClientMessageContext; label: string } | null;
}

/** The context as the service resolved it, ready to insert. */
interface ResolvedContext {
  kind: ClientMessageContext;
  label: string;
  product_id: string | null;
  order_id: string | null;
  drop_id: string | null;
  model_id: string | null;
  shop_request_id: string | null;
  scan_event_id: string | null;
  scan_ref: string | null;
}

// ── Words ──────────────────────────────────────────────────────────────────

/** The collector's words: line breaks as \n, trimmed, 1 to MESSAGE_LIMITS.collector characters. */
export function normalizeCollectorBody(v: unknown): string {
  if (typeof v !== 'string') throw validationError('Write your message.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') throw validationError('Write your message.');
  if (CONTROL_CHARS.test(s)) throw validationError('Your message contains characters that cannot be sent.');
  if (s.length > MESSAGE_LIMITS.collector) throw validationError('Your message is limited to 2,000 characters.');
  return s;
}

/** A staff answer: line breaks as \n, trimmed, 1 to MESSAGE_LIMITS.staff characters. */
export function normalizeStaffBody(v: unknown): string {
  if (typeof v !== 'string') throw validationError('Write the answer.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') throw validationError('Write the answer.');
  if (CONTROL_CHARS.test(s)) throw validationError('The answer contains invalid characters.');
  if (s.length > MESSAGE_LIMITS.staff) throw validationError('An answer is limited to 4,000 characters.');
  return s;
}

/** A label in capitals, cut to MESSAGE_LIMITS.label characters. */
function labelOf(parts: readonly (string | null | undefined)[]): string {
  const s = parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim().toUpperCase())
    .join(' · ');
  return s.length > MESSAGE_LIMITS.label ? `${s.slice(0, MESSAGE_LIMITS.label - 1)}…` : s;
}

/**
 * A model's name as the app says it (view-model.ts modelWithVariant, messages-model.ts modelWords): MONOLITHE, or
 * MONOLITHE IN BLUE for a model with a variant's label, the main model of its group included.
 */
function modelName(name: string, variantLabel: string | null): string {
  const v = typeof variantLabel === 'string' ? variantLabel.trim().replace(/\s+/g, ' ') : '';
  return v ? `${name} IN ${v}` : name;
}

/** A verification state in words: INVALID_SIGNATURE → INVALID SIGNATURE. */
function stateWords(state: string): string {
  return state.replace(/_/g, ' ');
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > MESSAGE_EXCERPT ? `${flat.slice(0, MESSAGE_EXCERPT - 1)}…` : flat;
}

/** Where a context is in the collector app; null for a scan, which has no page of its own. */
function pathOf(kind: ClientMessageContext, ids: { serial: string | null; orderId: string | null; dropId: string | null; slug: string | null }): string | null {
  switch (kind) {
    case 'PIECE':
      return ids.serial ? `/verify/pieces/${ids.serial}` : null;
    case 'ORDER':
      return ids.orderId ? `/verify/pieces?order=${ids.orderId}` : '/verify/pieces';
    case 'RELEASE':
      return ids.dropId ? `/verify/releases/${ids.dropId}` : null;
    case 'MODEL':
      return ids.slug ? `/verify/lookbook/${ids.slug}` : null;
    default:
      return null;
  }
}

/**
 * The time of a conversation's next message: now, or just after its latest message when the clock has not moved past
 * it, so that a conversation always reads in the order it was written. The conversation is held FOR UPDATE.
 */
async function nextMessageAt(tx: Db, conversationId: string, now: Date): Promise<Date> {
  const r = await tx.selectFrom('client_messages').select((eb) => eb.fn.max('created_at').as('latest')).where('conversation_id', '=', conversationId).executeTakeFirst();
  const latest = r?.latest ? new Date(r.latest as Date | string) : null;
  return latest && latest.getTime() >= now.getTime() ? new Date(latest.getTime() + 1) : now;
}

function adminIdOf(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

function assertAccount(accountId: string): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

function conversationId(id: string): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw conversationNotFound();
  return id.toLowerCase();
}

// ── The right of access (OwnerService.exportData) ─────────────────────────

/** Every message of an account, oldest first: its words and Client Services' answers, never who answered. */
export async function accountMessages(db: Db, accountId: string): Promise<ExportedMessage[]> {
  const account = assertAccount(accountId);
  const rows = await db
    .selectFrom('client_messages as m')
    .innerJoin('client_conversations as c', 'c.id', 'm.conversation_id')
    .select(['m.author', 'm.body', 'm.created_at', 'm.context_kind', 'm.context_label'])
    .where('c.account_id', '=', account)
    .orderBy('m.created_at')
    .orderBy('m.id')
    .execute();
  return rows.map((r) => ({
    at: r.created_at,
    from: MESSAGE_FROM[r.author],
    body: r.body,
    concerning: r.context_kind && r.context_label ? { kind: r.context_kind, label: r.context_label } : null,
  }));
}

/** The account's conversation for its client sheet: its id and status, or null when it never wrote. */
export async function accountConversation(db: Db, accountId: string): Promise<{ conversationId: string; status: ClientConversationStatus } | null> {
  const account = assertAccount(accountId);
  const c = await db.selectFrom('client_conversations').select(['id', 'status']).where('account_id', '=', account).executeTakeFirst();
  return c ? { conversationId: c.id, status: c.status } : null;
}

/** Scan retention (services/scan-retention.ts): the messages of deleted scans keep their REF, not the scan's id. */
export async function clearMessageScans(tx: Db, scanIds: readonly string[]): Promise<number> {
  if (scanIds.length === 0) return 0;
  const r = await tx.updateTable('client_messages').set({ scan_event_id: null }).where('scan_event_id', 'in', [...scanIds]).executeTakeFirst();
  return Number(r.numUpdatedRows);
}

// ── Service ────────────────────────────────────────────────────────────────

export interface MessageServiceDeps {
  db: Db;
  audit: AuditService;
  lookbook: LookbookService;
  clock?: Clock;
}

export class MessageService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly lookbook: LookbookService;
  private readonly clock: Clock;

  constructor(deps: MessageServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.lookbook = deps.lookbook;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The collector ────────────────────────────────────────────────────────

  /**
   * Write to ORBES Client Services (POST /api/v1/account/messages), with what the message concerns. See the header.
   * Returns the message as the collector reads it.
   */
  async write(accountId: string, input: { body: unknown; context?: MessageContextInput | null }, actor: Actor): Promise<{ message: CollectorMessage }> {
    const account = assertAccount(accountId);
    const words = normalizeCollectorBody(input?.body);
    const now = this.clock();
    // What the message concerns, read before the transaction: the lookbook reads on its own connection.
    const context = input?.context ? await this.resolveContext(this.db, account, input.context, now) : null;
    return inTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', account).forShare().executeTakeFirst();
      if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (a.status !== 'ACTIVE') throw customerAccountLocked();
      // The conversation, created on the first message, then held for this one.
      await tx
        .insertInto('client_conversations')
        .values({ account_id: account, status: 'TO_ANSWER', waiting_since: now, last_message_at: now, created_at: now })
        .onConflict((oc) => oc.column('account_id').doNothing())
        .execute();
      const c = await tx.selectFrom('client_conversations').select(['id', 'status', 'waiting_since']).where('account_id', '=', account).forUpdate().executeTakeFirstOrThrow();
      const recent = await tx
        .selectFrom('client_messages')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('conversation_id', '=', c.id)
        .where('author', '=', 'COLLECTOR')
        .where('created_at', '>', new Date(now.getTime() - MESSAGE_RATE.windowMs))
        .executeTakeFirstOrThrow();
      if (Number(recent.n) >= MESSAGE_RATE.messages) throw messageLimit();
      const at = await nextMessageAt(tx, c.id, now);
      const m = await tx
        .insertInto('client_messages')
        .values({
          conversation_id: c.id,
          author: 'COLLECTOR',
          body: words,
          context_kind: context?.kind ?? null,
          context_label: context?.label ?? null,
          product_id: context?.product_id ?? null,
          order_id: context?.order_id ?? null,
          drop_id: context?.drop_id ?? null,
          model_id: context?.model_id ?? null,
          shop_request_id: context?.shop_request_id ?? null,
          scan_event_id: context?.scan_event_id ?? null,
          scan_ref: context?.scan_ref ?? null,
          created_at: at,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();
      const reopened = c.status === 'CLOSED';
      await tx
        .updateTable('client_conversations')
        .set({
          status: 'TO_ANSWER',
          // Still waiting: since the first message not answered.
          waiting_since: c.status === 'TO_ANSWER' && c.waiting_since ? c.waiting_since : at,
          last_message_at: at,
          closed_at: null,
          closed_by: null,
        })
        .where('id', '=', c.id)
        .execute();
      await this.audit.record(
        { actor, action: 'message.write', targetType: 'client_conversation', targetId: c.id, details: { conversationId: c.id, messageId: m.id, context: context?.kind ?? null, reopened } },
        tx,
      );
      const path = context ? await this.pathFor(tx, context) : null;
      return {
        message: {
          id: m.id,
          from: MESSAGE_FROM.COLLECTOR,
          body: words,
          at: m.created_at,
          concerning: context ? { kind: context.kind, label: context.label, path } : null,
        },
      };
    });
  }

  /** The conversation as the collector reads it, oldest first (GET /api/v1/account/messages). */
  async thread(accountId: string): Promise<CollectorThread> {
    const account = assertAccount(accountId);
    const c = await this.db.selectFrom('client_conversations').select(['id', 'collector_read_at']).where('account_id', '=', account).executeTakeFirst();
    if (!c) return { messages: [], unread: false };
    const rows = await this.db
      .selectFrom('client_messages as m')
      .leftJoin('products as p', 'p.id', 'm.product_id')
      .leftJoin('models as md', 'md.id', 'm.model_id')
      .select(['m.id', 'm.author', 'm.body', 'm.created_at', 'm.context_kind', 'm.context_label', 'm.order_id', 'm.drop_id', 'p.product_id as serial', 'md.slug'])
      .where('m.conversation_id', '=', c.id)
      .orderBy('m.created_at')
      .orderBy('m.id')
      .execute();
    const readAt = c.collector_read_at?.getTime() ?? Number.NEGATIVE_INFINITY;
    return {
      messages: rows.map((r) => ({
        id: r.id,
        from: MESSAGE_FROM[r.author],
        body: r.body,
        at: r.created_at,
        concerning:
          r.author === 'COLLECTOR' && r.context_kind && r.context_label
            ? { kind: r.context_kind, label: r.context_label, path: pathOf(r.context_kind, { serial: r.serial ?? null, orderId: r.order_id, dropId: r.drop_id, slug: r.slug ?? null }) }
            : null,
      })),
      unread: rows.some((r) => r.author === 'STAFF' && r.created_at.getTime() > readAt),
    };
  }

  /** Whether an answer is unread (GET /api/v1/account/messages/unread: NOW's line and the sheet's NEW). */
  async unread(accountId: string): Promise<{ unread: boolean }> {
    const account = assertAccount(accountId);
    const r = await this.db
      .selectFrom('client_conversations as c')
      .innerJoin('client_messages as m', 'm.conversation_id', 'c.id')
      .select('m.id')
      .where('c.account_id', '=', account)
      .where('m.author', '=', 'STAFF')
      .where((eb) => eb.or([eb('c.collector_read_at', 'is', null), eb('m.created_at', '>', eb.ref('c.collector_read_at'))]))
      .limit(1)
      .executeTakeFirst();
    return { unread: r !== undefined };
  }

  /** The collector has read the conversation up to `upTo` (never later than now; never earlier than before). */
  async markRead(accountId: string, upTo: Date): Promise<void> {
    const account = assertAccount(accountId);
    if (!(upTo instanceof Date) || Number.isNaN(upTo.getTime())) throw validationError('upTo must be a date-time.');
    const now = this.clock();
    // Never later than now, nor than the latest message (which may be a moment after now: nextMessageAt).
    const at = sql<Date>`least(${upTo}::timestamptz, greatest(${now}::timestamptz, last_message_at))`;
    await this.db
      .updateTable('client_conversations')
      .set({ collector_read_at: sql<Date>`greatest(coalesce(collector_read_at, ${at}), ${at})` })
      .where('account_id', '=', account)
      .execute();
  }

  /**
   * What the collector may attach to a message, checked and labelled now (see the header); 422 MESSAGE_CONTEXT_INVALID
   * otherwise, 422 MESSAGE_CONTEXT_EXPIRED for a scan over 24 hours old.
   */
  private async resolveContext(tx: Db, account: string, input: MessageContextInput, now: Date): Promise<ResolvedContext> {
    const id = typeof input?.id === 'string' ? input.id.trim() : '';
    const none = { product_id: null, order_id: null, drop_id: null, model_id: null, shop_request_id: null, scan_event_id: null, scan_ref: null };
    if (input?.about !== undefined && (input.about !== 'WARRANTY' || input.kind !== 'SCAN')) throw messageContextInvalid();
    switch (input?.kind) {
      case 'PIECE': {
        if (!UUID_RE.test(id) && !SERIAL_RE.test(id)) throw messageContextInvalid();
        const p = await tx
          .selectFrom('ownership as o')
          .innerJoin('products as p', 'p.id', 'o.product_id')
          .innerJoin('models as m', 'm.id', 'p.model_id')
          .select(['p.id', 'p.product_id', 'm.name', 'm.variant_label'])
          .where('o.account_id', '=', account)
          .where('o.ended_at', 'is', null)
          .where(UUID_RE.test(id) ? 'p.id' : 'p.product_id', '=', UUID_RE.test(id) ? id.toLowerCase() : id.toUpperCase())
          .executeTakeFirst();
        if (!p) throw messageContextInvalid();
        return { ...none, kind: 'PIECE', label: labelOf([modelName(p.name, p.variant_label), p.product_id]), product_id: p.id };
      }
      case 'ORDER': {
        if (!UUID_RE.test(id)) throw messageContextInvalid();
        const o = await tx
          .selectFrom('orders as o')
          .innerJoin('models as m', 'm.id', 'o.model_id')
          .select(['o.id', 'm.name', 'm.variant_label'])
          .where('o.id', '=', id.toLowerCase())
          .where('o.account_id', '=', account)
          .executeTakeFirst();
        if (!o) throw messageContextInvalid();
        return { ...none, kind: 'ORDER', label: labelOf([`ORDER ${orderReference(o.id)}`, modelName(o.name, o.variant_label)]), order_id: o.id };
      }
      case 'RELEASE': {
        if (!UUID_RE.test(id)) throw messageContextInvalid();
        const dropId = id.toLowerCase();
        const d = await tx
          .selectFrom('drops')
          .select(['id', 'title', 'mode', 'published_at', 'announce_at', 'silhouette_at', 'name_at', 'photo_at', 'opens_at', 'room_opens_minutes', 'ended_at'])
          .where('id', '=', dropId)
          .executeTakeFirst();
        if (!d || d.published_at === null) throw messageContextInvalid();
        // A LIVE RELEASE is named nowhere before its announcement and its name's stage (liveAccessRule): no label says it.
        if (d.mode === 'LIVE' && (!isAnnounced(d, now) || !liveStages(d, stagesAt(d, now))?.name)) throw messageContextInvalid();
        return { ...none, kind: 'RELEASE', label: labelOf([d.title, ...(await this.entryWords(tx, account, d.id, d.mode))]), drop_id: d.id };
      }
      case 'SCAN': {
        if (!UUID_RE.test(id)) throw messageContextInvalid();
        const s = await tx.selectFrom('scan_events').select(['id', 'occurred_at', 'event_type', 'result_state', 'product_id']).where('id', '=', id.toLowerCase()).executeTakeFirst();
        // A staff scan (ADMIN_TEST) is no collector's to write about.
        if (!s || s.event_type === 'ADMIN_TEST' || !s.result_state) throw messageContextInvalid();
        if (now.getTime() - s.occurred_at.getTime() >= REPORT_WINDOW_MS) throw messageContextExpired();
        const ref = s.id.slice(0, 8).toUpperCase();
        return {
          ...none,
          kind: 'SCAN',
          label: labelOf([`REF ${ref}`, stateWords(s.result_state), input.about === 'WARRANTY' ? 'WARRANTY NO LONGER VALID' : null]),
          product_id: s.product_id,
          scan_event_id: s.id,
          scan_ref: ref,
        };
      }
      case 'MODEL': {
        if (!UUID_RE.test(id)) throw messageContextInvalid();
        const m = await tx.selectFrom('models').select(['id', 'slug', 'name', 'variant_label']).where('id', '=', id.toLowerCase()).executeTakeFirst();
        if (!m || !m.slug) throw messageContextInvalid();
        // Only a model the account's lookbook reaches now: PUBLIC, or RESERVED from its tier up.
        const standing = (await clubStandings(tx, [account], now)).get(account);
        try {
          await this.lookbook.sheetOf(m.slug, { tier: standing?.tier ?? 0 });
        } catch {
          throw messageContextInvalid();
        }
        const request = await tx
          .selectFrom('shop_requests')
          .select(['id'])
          .where('account_id', '=', account)
          .where('model_id', '=', m.id)
          .orderBy(sql`status = 'OPEN'`, 'desc')
          .orderBy('created_at', 'desc')
          .orderBy('id')
          .executeTakeFirst();
        return {
          ...none,
          kind: 'MODEL',
          label: labelOf([modelName(m.name, m.variant_label), request ? 'PRIVATE SALON REQUEST' : null]),
          model_id: m.id,
          shop_request_id: request?.id ?? null,
        };
      }
      default:
        throw messageContextInvalid();
    }
  }

  /** The account's own entry in a release, in words: PLACE HELD, PLACE RESERVED, CONFIRMED · REFERENCE LR-…, REMOVED. */
  private async entryWords(tx: Db, account: string, dropId: string, mode: DropMode): Promise<string[]> {
    if (mode === 'DRAW') {
      const e = await tx
        .selectFrom('drop_entries as e')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .leftJoin('house_guarantees as g', 'g.id', 'e.guarantee_id')
        .select(['e.status', 'e.tier', 'e.rank', 'e.guarantee_id', 'g.used_at as guarantee_used_at', 'd.opens_at'])
        .where('e.drop_id', '=', dropId)
        .where('e.account_id', '=', account)
        .executeTakeFirst();
      // As the release page says it (drops.ts entryReserved): a guarantee used at the draw is a place held, never a mark.
      if (e?.status === 'SELECTED') return [entryReserved(e) ? 'PLACE RESERVED' : 'PLACE HELD'];
      // The sale concluded, as MY PIECES says it of a draw's entry.
      if (e?.status === 'CONFIRMED') return ['CONCLUDED'];
      return [];
    }
    const e = await tx.selectFrom('live_entries').select(['id', 'status']).where('drop_id', '=', dropId).where('account_id', '=', account).executeTakeFirst();
    if (e?.status === 'CONFIRMED') return ['CONFIRMED', `REFERENCE ${liveReference(e.id)}`];
    if (e?.status === 'SECURED') return ['PLACE HELD'];
    if (e?.status === 'REMOVED') return ['REMOVED'];
    return [];
  }

  /** The app's path of a context just resolved. */
  private async pathFor(tx: Db, c: ResolvedContext): Promise<string | null> {
    const serial = c.kind === 'PIECE' && c.product_id ? ((await tx.selectFrom('products').select('product_id').where('id', '=', c.product_id).executeTakeFirst())?.product_id ?? null) : null;
    const slug = c.kind === 'MODEL' && c.model_id ? ((await tx.selectFrom('models').select('slug').where('id', '=', c.model_id).executeTakeFirst())?.slug ?? null) : null;
    return pathOf(c.kind, { serial, orderId: c.order_id, dropId: c.drop_id, slug });
  }

  // ── The console ──────────────────────────────────────────────────────────

  /** The tier of each account now. */
  private async tiers(accountIds: readonly string[]): Promise<Map<string, ConversationTier>> {
    const standings = await clubStandings(this.db, accountIds, this.clock());
    const out = new Map<string, ConversationTier>();
    for (const id of accountIds) {
      const level = standings.get(id)?.tier ?? 0;
      out.set(id, { level, name: tierName(level) });
    }
    return out;
  }

  /** THE PROGRAM's priority tier now (BP-19 T8): 2 PLATINE, 3 PALLADIUM, 0 off. */
  private async priorityMin(): Promise<PriorityTier> {
    return (await readProgram(this.db)).messagesPriorityMinTier;
  }

  /**
   * The Messages board (GET /api/admin/messages): one row per conversation, in the order of the header. `actor` is the
   * reader (Mine).
   */
  async board(filter: BoardFilter, page: PageRequest, actor: Actor): Promise<BoardPage> {
    const status = filter.status ?? 'TO_ANSWER';
    if (status !== 'ALL' && !CLIENT_CONVERSATION_STATUSES.includes(status)) throw validationError('Unknown conversation status.');
    const me = adminIdOf(actor);
    const q = typeof filter.q === 'string' ? filter.q.trim() : '';
    let query = this.db
      .selectFrom('client_conversations as c')
      .innerJoin('accounts as a', 'a.id', 'c.account_id')
      .select(['c.id', 'c.account_id', 'c.status', 'c.waiting_since', 'c.last_message_at']);
    if (status !== 'ALL') query = query.where('c.status', '=', status);
    if (filter.who === 'mine') query = me ? query.where('c.answered_by', '=', me) : query.where(sql<boolean>`false`);
    if (filter.who === 'unassigned') query = query.where('c.answered_by', 'is', null);
    if (q !== '') {
      const ref = SCAN_REF_RE.test(q) ? q.toUpperCase() : null;
      const like = `%${q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const exact = filter.exactEmail ? (normalizeEmail(q)?.normalized ?? null) : null;
      query = query.where((eb) =>
        eb.or([
          ...(!filter.exactEmail ? [eb('a.email_normalized', 'like', like)] : exact !== null ? [eb('a.email_normalized', '=', exact)] : []),
          ...(ref ? [eb.exists(eb.selectFrom('client_messages as r').select('r.id').whereRef('r.conversation_id', '=', 'c.id').where('r.scan_ref', '=', ref))] : []),
        ]),
      );
    }
    const all = await query.execute();
    const waiting = all.filter((c) => c.status === 'TO_ANSWER');
    const tiers = await this.tiers([...new Set(waiting.map((c) => c.account_id))]);
    const min = await this.priorityMin();
    const rank = (accountId: string) => {
      const t = tiers.get(accountId);
      return t && priorityOf(t, min) ? t.level : 0;
    };
    const sorted = [
      ...waiting.sort(
        (x, y) =>
          rank(y.account_id) - rank(x.account_id) ||
          (x.waiting_since?.getTime() ?? 0) - (y.waiting_since?.getTime() ?? 0) ||
          (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      ),
      ...all
        .filter((c) => c.status !== 'TO_ANSWER')
        .sort((x, y) => y.last_message_at.getTime() - x.last_message_at.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    ];
    const slice = sorted.slice((page.page - 1) * page.pageSize, page.page * page.pageSize);
    const rows = await this.rows(slice.map((c) => c.id), min);
    const toAnswer = await this.db.selectFrom('client_conversations').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'TO_ANSWER').executeTakeFirstOrThrow();
    return { ...makePage(slice.map((c) => rows.get(c.id)!).filter(Boolean), sorted.length, page), toAnswer: Number(toAnswer.n) };
  }

  /** The board's rows of these conversations, by id. */
  private async rows(ids: readonly string[], min: PriorityTier): Promise<Map<string, BoardConversation>> {
    const out = new Map<string, BoardConversation>();
    if (ids.length === 0) return out;
    const heads = await this.heads(ids);
    const accounts = [...new Set(heads.map((h) => h.account_id))];
    const tiers = await this.tiers(accounts);
    const cares = await openCareOf(this.db, accounts);
    const [last, contexts] = await Promise.all([
      this.db
        .selectFrom('client_messages as m')
        .select(['m.conversation_id', 'm.author', 'm.body', 'm.created_at'])
        .distinctOn('m.conversation_id')
        .where('m.conversation_id', 'in', [...ids])
        .orderBy('m.conversation_id')
        .orderBy('m.created_at', 'desc')
        .orderBy('m.id', 'desc')
        .execute(),
      this.concernsOf(ids),
    ]);
    for (const h of heads) {
      const tier = tiers.get(h.account_id) ?? { level: 0 as ClubTier, name: null };
      const mine = contexts.filter((c) => c.conversationId === h.id);
      const distinct = new Set(mine.map((c) => c.concerns.label));
      const l = last.find((m) => m.conversation_id === h.id)!;
      out.set(h.id, {
        id: h.id,
        account: { id: h.account_id, email: h.email },
        tier,
        priority: priorityOf(tier, min),
        concerns: mine.at(-1)?.concerns ?? null,
        moreConcerns: Math.max(0, distinct.size - 1),
        lastMessage: { author: l.author, excerpt: excerpt(l.body), at: l.created_at },
        waitingSince: h.waiting_since,
        status: h.status,
        answeredBy: h.answered_by ? { id: h.answered_by, email: h.answered_email ?? '' } : null,
        care: cares.get(h.account_id) ?? null,
      });
    }
    return out;
  }

  private heads(ids: readonly string[]) {
    return this.db
      .selectFrom('client_conversations as c')
      .innerJoin('accounts as a', 'a.id', 'c.account_id')
      .leftJoin('admin_users as u', 'u.id', 'c.answered_by')
      .leftJoin('admin_users as k', 'k.id', 'c.closed_by')
      .select([
        'c.id',
        'c.account_id',
        'a.email',
        'c.status',
        'c.waiting_since',
        'c.last_message_at',
        'c.created_at',
        'c.closed_at',
        'c.answered_by',
        'u.email as answered_email',
        'c.closed_by',
        'k.email as closed_email',
      ])
      .where('c.id', 'in', [...ids])
      .execute();
  }

  /** The contexts of these conversations' messages, oldest first, with the ids the console links. */
  private async concernsOf(conversationIds: readonly string[]): Promise<{ conversationId: string; messageId: string; concerns: MessageConcerns }[]> {
    if (conversationIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('client_messages as m')
      .leftJoin('products as p', 'p.id', 'm.product_id')
      .leftJoin('drops as d', 'd.id', 'm.drop_id')
      .select([
        'm.conversation_id',
        'm.id',
        'm.context_kind',
        'm.context_label',
        'm.order_id',
        'm.drop_id',
        'm.model_id',
        'm.shop_request_id',
        'm.scan_event_id',
        'm.scan_ref',
        'p.product_id as serial',
        'd.mode as drop_mode',
      ])
      .where('m.conversation_id', 'in', [...conversationIds])
      .where('m.context_kind', 'is not', null)
      .orderBy('m.created_at')
      .orderBy('m.id')
      .execute();
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      messageId: r.id,
      concerns: {
        kind: r.context_kind!,
        label: r.context_label ?? '',
        productId: r.serial ?? null,
        orderId: r.order_id,
        dropId: r.drop_id,
        dropMode: r.drop_mode ?? null,
        modelId: r.model_id,
        shopRequestId: r.shop_request_id,
        scanEventId: r.scan_event_id,
        scanRef: r.scan_ref ? r.scan_ref.trim() : null,
      },
    }));
  }

  /** A conversation with its messages, oldest first (GET /api/admin/messages/:id). */
  async conversation(id: string): Promise<StaffConversation> {
    const cid = conversationId(id);
    const [h] = await this.heads([cid]);
    if (!h) throw conversationNotFound();
    const tier = (await this.tiers([h.account_id])).get(h.account_id)!;
    const care = (await openCareOf(this.db, [h.account_id])).get(h.account_id) ?? null;
    const [messages, contexts] = await Promise.all([
      this.db
        .selectFrom('client_messages as m')
        .leftJoin('admin_users as u', 'u.id', 'm.admin_id')
        .select(['m.id', 'm.author', 'm.admin_id', 'u.email as admin_email', 'm.body', 'm.created_at'])
        .where('m.conversation_id', '=', cid)
        .orderBy('m.created_at')
        .orderBy('m.id')
        .execute(),
      this.concernsOf([cid]),
    ]);
    return {
      id: h.id,
      account: { id: h.account_id, email: h.email },
      tier,
      priority: priorityOf(tier, await this.priorityMin()),
      waitingSince: h.waiting_since,
      status: h.status,
      answeredBy: h.answered_by ? { id: h.answered_by, email: h.answered_email ?? '' } : null,
      care,
      createdAt: h.created_at,
      closedAt: h.closed_at,
      closedBy: h.closed_by ? { id: h.closed_by, email: h.closed_email ?? '' } : null,
      messages: messages.map((m) => ({
        id: m.id,
        author: m.author,
        admin: m.admin_id ? { id: m.admin_id, email: m.admin_email ?? '' } : null,
        body: m.body,
        at: m.created_at,
        concerns: contexts.find((c) => c.messageId === m.id)?.concerns ?? null,
      })),
    };
  }

  /**
   * Answer a conversation (POST /api/admin/messages/:id/answer, OPERATOR): ANSWERED, the answering staff member set
   * when nobody was. Staff never open a conversation: 404 CONVERSATION_NOT_FOUND for one that does not exist.
   */
  async answer(id: string, actor: Actor, input: { body: unknown }): Promise<StaffConversation> {
    const by = adminIdOf(actor);
    if (by === null) throw forbidden('Only ORBES Client Services answer a conversation.');
    const words = normalizeStaffBody(input?.body);
    const cid = conversationId(id);
    await inTransaction(this.db, async (tx) => {
      const c = await tx.selectFrom('client_conversations').select(['id', 'answered_by']).where('id', '=', cid).forUpdate().executeTakeFirst();
      if (!c) throw conversationNotFound();
      const now = await nextMessageAt(tx, cid, this.clock());
      const m = await tx
        .insertInto('client_messages')
        .values({ conversation_id: cid, author: 'STAFF', admin_id: by, body: words, created_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('client_conversations')
        .set({ status: 'ANSWERED', waiting_since: null, closed_at: null, closed_by: null, last_message_at: now, answered_by: c.answered_by ?? by })
        .where('id', '=', cid)
        .execute();
      await this.audit.record({ actor, action: 'message.answer', targetType: 'client_conversation', targetId: cid, details: { conversationId: cid, messageId: m.id } }, tx);
    });
    return this.conversation(cid);
  }

  /** Take a conversation (POST /api/admin/messages/:id/take, OPERATOR): the reader answers it from now. */
  async take(id: string, actor: Actor): Promise<StaffConversation> {
    const by = adminIdOf(actor);
    if (by === null) throw forbidden('Only ORBES Client Services take a conversation.');
    return this.setAnswering(conversationId(id), by, actor, 'message.take');
  }

  /** Assign a conversation (POST /api/admin/messages/:id/assign, ADMIN) to an active OPERATOR or ADMIN. */
  async assign(id: string, adminId: string, actor: Actor): Promise<StaffConversation> {
    if (adminIdOf(actor) === null) throw forbidden('Only an ORBES admin assigns a conversation.');
    const cid = conversationId(id);
    if (typeof adminId !== 'string' || !UUID_RE.test(adminId)) throw validationError('Choose a member of ORBES Client Services.');
    const target = await this.db.selectFrom('admin_users').select(['id', 'role', 'disabled_at']).where('id', '=', adminId.toLowerCase()).executeTakeFirst();
    if (!target || target.disabled_at !== null || (target.role !== 'OPERATOR' && target.role !== 'ADMIN')) {
      throw validationError('Choose an active OPERATOR or ADMIN.');
    }
    return this.setAnswering(cid, target.id, actor, 'message.assign');
  }

  private async setAnswering(cid: string, to: string, actor: Actor, action: 'message.take' | 'message.assign'): Promise<StaffConversation> {
    await inTransaction(this.db, async (tx) => {
      const c = await tx.selectFrom('client_conversations').select(['answered_by']).where('id', '=', cid).forUpdate().executeTakeFirst();
      if (!c) throw conversationNotFound();
      if (c.answered_by === to) return;
      await tx.updateTable('client_conversations').set({ answered_by: to }).where('id', '=', cid).execute();
      await this.audit.record({ actor, action, targetType: 'client_conversation', targetId: cid, details: { conversationId: cid, before: c.answered_by, after: to } }, tx);
    });
    return this.conversation(cid);
  }

  /** Close a conversation (POST /api/admin/messages/:id/close, OPERATOR); 409 CONVERSATION_CLOSED when it is. */
  async close(id: string, actor: Actor): Promise<StaffConversation> {
    const by = adminIdOf(actor);
    if (by === null) throw forbidden('Only ORBES Client Services close a conversation.');
    const cid = conversationId(id);
    await inTransaction(this.db, async (tx) => {
      const c = await tx.selectFrom('client_conversations').select(['status', 'last_message_at']).where('id', '=', cid).forUpdate().executeTakeFirst();
      if (!c) throw conversationNotFound();
      if (c.status === 'CLOSED') throw conflict('CONVERSATION_CLOSED', 'This conversation is already closed.');
      const now = this.clock();
      await tx
        .updateTable('client_conversations')
        .set({ status: 'CLOSED', waiting_since: null, closed_at: now.getTime() < c.last_message_at.getTime() ? c.last_message_at : now, closed_by: by })
        .where('id', '=', cid)
        .execute();
      await this.audit.record({ actor, action: 'message.close', targetType: 'client_conversation', targetId: cid, details: { conversationId: cid, from: c.status } }, tx);
    });
    return this.conversation(cid);
  }

  /** The sidebar's badge: the conversations To answer, and those answered first (GET /api/admin/messages/summary). */
  async summary(): Promise<MessagesSummary> {
    const waiting = await this.db.selectFrom('client_conversations').select('account_id').where('status', '=', 'TO_ANSWER').execute();
    const tiers = await this.tiers(waiting.map((w) => w.account_id));
    const min = await this.priorityMin();
    return { toAnswer: waiting.length, priority: waiting.filter((w) => priorityOf(tiers.get(w.account_id)!, min) !== null).length };
  }

}
