/**
 * The Messages board of the console (plan NEXT-NINE of 2026-10-06, §3.1 CS-01): its pure parts. The filters read from
 * the route, what a conversation concerns in words and where its link goes, the priority mark, the badge's text, who may
 * do what, and the answer's check. The server orders the board (To answer first; within it PALLADIUM, then PLATINE, then
 * the rest, the longest waiting first; then the others, newest first) and holds every rule; this module only words it.
 */
import { formatCount } from '../format.js';
import { can } from './permissions.js';
import { href, productHref } from '../router.js';
import { CLIENT_CONVERSATION_STATUSES, type AdminRole, type ClientConversationStatus, type Conversation, type ConversationRow, type MessageConcerns } from '../types.js';

/** As services/messages.ts MESSAGE_LIMITS: an answer of 1 to 4,000 characters (test/web/admin.messages.test.ts holds them equal). */
export const MESSAGE_LIMITS = Object.freeze({ staff: 4000 });

export type BoardStatus = ClientConversationStatus | 'ALL';
export type BoardWho = 'mine' | 'unassigned' | '';

/** The board's filters as the route holds them: To answer by default. */
export interface BoardFilters {
  status: BoardStatus;
  who: BoardWho;
  q: string;
}

/** The status filter's words, in its order: To answer (n) · Answered · Closed · All. */
export const STATUS_FILTERS: readonly { value: BoardStatus; label: string }[] = Object.freeze([
  { value: 'TO_ANSWER', label: 'To answer' },
  { value: 'ANSWERED', label: 'Answered' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ALL', label: 'All' },
]);

/** The answering filter's words: Everyone · Mine · Unassigned. */
export const WHO_FILTERS: readonly { value: BoardWho; label: string }[] = Object.freeze([
  { value: '', label: 'Everyone' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
]);

/** A conversation's status in words (To answer, Answered, Closed). */
export const STATUS_LABELS: Readonly<Record<ClientConversationStatus, string>> = Object.freeze({ TO_ANSWER: 'To answer', ANSWERED: 'Answered', CLOSED: 'Closed' });

/** The board's lead and its empty state. */
export const BOARD_LEAD = 'One conversation per client. Clients write from the app, and your answers appear in their account. No email is sent.';
export const BOARD_EMPTY = 'No conversation to answer.';
/** The answer box's hint, and the toasts. */
export const ANSWER_HINT = 'The client reads this in their account, signed ORBES Client Services.';
export const ANSWER_SENT = 'Answer sent.';
export const CONVERSATION_CLOSED = 'Conversation closed.';

export function boardFilters(query: Record<string, string>): BoardFilters {
  const status = (CLIENT_CONVERSATION_STATUSES as readonly string[]).includes(query.status ?? '') || query.status === 'ALL' ? (query.status as BoardStatus) : 'TO_ANSWER';
  const who: BoardWho = query.who === 'mine' || query.who === 'unassigned' ? query.who : '';
  return { status, who, q: (query.q ?? '').trim().slice(0, 254) };
}

/** What the board asks the server for. */
export function boardQuery(f: BoardFilters, page: number): { status: BoardStatus; who?: 'mine' | 'unassigned'; q?: string; page: number; pageSize: number } {
  return { status: f.status, ...(f.who ? { who: f.who } : {}), ...(f.q ? { q: f.q } : {}), page, pageSize: 50 };
}

/** The status filter's label: To answer carries its count. */
export function statusFilterLabel(value: BoardStatus, toAnswer: number): string {
  const label = STATUS_FILTERS.find((s) => s.value === value)!.label;
  return value === 'TO_ANSWER' ? `${label} (${formatCount(toAnswer)})` : label;
}

/** The priority tag: `Priority · PALLADIUM`, `Priority · PLATINE`, or nothing. */
export function priorityTag(priority: ConversationRow['priority']): string | null {
  return priority ? `Priority · ${priority}` : null;
}

/** A label's words after its first part, in sentence case: `INVALID SIGNATURE · WARRANTY` → `Invalid signature · warranty`. */
function tail(label: string): string {
  const rest = label.split(' · ').slice(1).join(' · ').toLowerCase();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
}

/** A name in the label's capitals, in title case: `MONOLITHE IN STEEL` → `Monolithe in steel`. */
function named(label: string): string {
  const head = label.split(' · ')[0]!.toLowerCase();
  return head.charAt(0).toUpperCase() + head.slice(1);
}

/** What a message concerns in the console's words: `Piece O26-J-00184`, `Order OR-3F9A21C4`, `Release Monolithe in steel`, `Scan REF 5A864AF8 · Invalid signature`, `Model Eclipse · salon request`, or `General`. */
export function concernsText(c: MessageConcerns | null): string {
  if (!c) return 'General';
  switch (c.kind) {
    case 'PIECE':
      return `Piece ${c.productId ?? c.label.split(' · ').at(-1)}`;
    case 'ORDER':
      return `Order ${c.orderId ? `OR-${c.orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}` : c.label.replace(/^ORDER /, '').split(' · ')[0]}`;
    case 'RELEASE':
      return `Release ${named(c.label)}`;
    case 'SCAN': {
      const rest = tail(c.label);
      return `Scan REF ${c.scanRef ?? ''}${rest ? ` · ${rest}` : ''}`;
    }
    case 'MODEL':
      return `Model ${named(c.label)}${c.shopRequestId ? ' · salon request' : ''}`;
  }
}

/** Where the console opens what a message concerns; null for a scan the retention has cleared. */
export function concernsHref(c: MessageConcerns): string | null {
  switch (c.kind) {
    case 'PIECE':
      return c.productId ? productHref(c.productId) : null;
    case 'ORDER':
      return c.orderId ? href('order', { orderId: c.orderId }) : null;
    case 'RELEASE':
      return c.dropId ? (c.dropMode === 'LIVE' ? href('liveRelease', { dropId: c.dropId }) : href('drop', { dropId: c.dropId })) : null;
    case 'MODEL':
      return c.shopRequestId ? href('club', {}, { tab: 'requests' }) : c.modelId ? href('model', { modelId: c.modelId }) : null;
    case 'SCAN':
      return c.scanEventId ? href('scans', {}, { scanId: c.scanEventId }) : null;
  }
}

/** `+2 more`, or nothing. */
export function moreText(n: number): string | null {
  return n > 0 ? `+${formatCount(n)} more` : null;
}

/** The sidebar's badge: the count To answer, or nothing at 0. */
export function messagesBadge(toAnswer: number): string {
  return toAnswer > 0 ? formatCount(toAnswer) : '';
}

/** `Answering: <email>`, or `—`. */
export function answeringText(c: Pick<Conversation, 'answeredBy'>): string {
  return c.answeredBy?.email ?? '—';
}

/** Answer, take and close: OPERATOR. */
export function canAnswer(role: AdminRole): boolean {
  return can(role, 'answerMessages');
}

/** Assign to anyone active: ADMIN. */
export function canAssign(role: AdminRole): boolean {
  return can(role, 'assignMessages');
}

/** What is wrong with an answer, or null. */
export function answerProblem(body: string): string | null {
  const s = body.trim();
  if (s === '') return 'Write the answer.';
  if (s.length > MESSAGE_LIMITS.staff) return 'An answer is limited to 4,000 characters.';
  return null;
}
