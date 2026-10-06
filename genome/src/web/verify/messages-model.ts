/**
 * WRITE TO ORBES CLIENT SERVICES and MESSAGES (plan NEXT-NINE of 2026-10-06, §3.1 CS-01): the pure part of the collector
 * app's side. What each button of the app attaches to a message (its context: a kind, the id the server reads, and the
 * label the write sheet shows under CONCERNING), the words checked before the server checks them, the conversation as
 * MESSAGES lists it (the author line, what a message concerned and where it is in the app), and NOW's line while an
 * answer is unread.
 *
 * The ids sent, by kind (API §10.17): PIECE its productId (O26-J-00184); ORDER its orderId; RELEASE its dropId; MODEL its
 * modelId (never the slug); SCAN its scanId, `about` WARRANTY on the warranty tab only. The server checks each and
 * writes its own label; the one here is what the collector reads before sending.
 */
import { MESSAGES } from './copy.js';
import type { AccountMessage, AccountThread, MessageContextInput, MessageContextKind } from './types.js';
import { formatDateTime } from './view-model.js';

/** What a button attaches to a message, and the label the sheet shows under CONCERNING. */
export interface WriteContext extends MessageContextInput {
  label: string;
}

/** A label in capitals, its parts joined by a middle dot (empty parts left out). */
function labelOf(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim().toUpperCase())
    .join(' · ');
}

/**
 * A model's name as the app says it: MONOLITHE, or MONOLITHE IN BLUE for a model with a variant's label (the main model
 * of its group included), the rule the server labels a message by (services/messages.ts modelName).
 */
export function modelWords(name: string, variant?: string | null): string {
  const v = typeof variant === 'string' ? variant.trim().replace(/\s+/g, ' ') : '';
  return v ? `${name} ${MESSAGES.label.in} ${v}` : name;
}

/** The reference an order is known by: `OR-` and the first eight figures of its id (services/orders.ts orderReference). */
export function orderReference(orderId: string): string {
  return `OR-${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** A verification state in words: INVALID_SIGNATURE → INVALID SIGNATURE. */
function stateWords(state: string): string {
  return state.replace(/_/g, ' ');
}

/** A scan with a problem (site 1): `REF 5A864AF8 · INVALID SIGNATURE`. */
export function scanContext(scanId: string, reference: string, state: string): WriteContext {
  return { kind: 'SCAN', id: scanId, label: labelOf(`${MESSAGES.label.ref} ${reference}`, stateWords(state)) };
}

/** The warranty tab of a scan (site 2): the scan, about its warranty no longer valid. */
export function warrantyContext(scanId: string, reference: string, state: string): WriteContext {
  return { kind: 'SCAN', id: scanId, about: 'WARRANTY', label: labelOf(`${MESSAGES.label.ref} ${reference}`, stateWords(state), MESSAGES.label.warranty) };
}

/** A piece of MY PIECES (site 3): `MONOLITHE · O26-J-00184`. */
export function pieceContext(p: { productId: string; model: string; modelVariant?: string | null }): WriteContext {
  return { kind: 'PIECE', id: p.productId, label: labelOf(modelWords(p.model, p.modelVariant), p.productId) };
}

/** An order of MY PIECES' ORDERS tab (site 5): `ORDER OR-3F9A21C4 · MONOLITHE`, `… · MONOLITHE IN GOLD` for a variant. */
export function orderContext(o: { id: string; model: string; modelVariant?: string | null }): WriteContext {
  return { kind: 'ORDER', id: o.id, label: labelOf(`${MESSAGES.label.order} ${orderReference(o.id)}`, modelWords(o.model, o.modelVariant)) };
}

/**
 * A release (sites 4, 6, 7 and 8): its name and the account's place in it, `MONOLITHE IN STEEL · CONFIRMED · REFERENCE
 * LR-8K2M4Q`. The models' entries carry it as `{dropId, label}` (EntryModel.write).
 */
export function releaseContext(dropId: string, title: string, ...state: (string | null | undefined)[]): WriteContext {
  return { kind: 'RELEASE', id: dropId, label: labelOf(title, ...state) };
}

/** The reference words of a LIVE RELEASE's confirmed entry: `REFERENCE LR-8K2M4Q`. */
export function referenceWords(reference: string): string {
  return `${MESSAGES.label.reference} ${reference}`;
}

/** A model of the private salon, requested (site 9): `ECLIPSE · PRIVATE SALON REQUEST`, `ECLIPSE IN ONYX · …` for a variant. */
export function modelContext(modelId: string, name: string, variant?: string | null): WriteContext {
  return { kind: 'MODEL', id: modelId, label: labelOf(modelWords(name, variant), MESSAGES.label.salon) };
}

/** What the server is sent for a context: its kind, id and `about`, never the label. */
export function contextInput(c: WriteContext | null): MessageContextInput | null {
  if (!c) return null;
  return c.about ? { kind: c.kind, id: c.id, about: c.about } : { kind: c.kind, id: c.id };
}

/** What is wrong with the words before they are sent (the server's own words), or null. */
export function messageProblem(text: string): string | null {
  const s = text.replace(/\r\n?/g, '\n').trim();
  if (s === '') return MESSAGES.empty;
  if (s.length > MESSAGES.max) return MESSAGES.tooLong;
  return null;
}

/** Where a message's context is in the app, from the path the server gave; null for a scan (no page of its own). */
export type ConcerningTarget = { to: 'piece'; id: string } | { to: 'order'; id: string } | { to: 'pieces' } | { to: 'release'; id: string } | { to: 'sheet'; slug: string };

export function concerningTarget(path: string | null): ConcerningTarget | null {
  if (!path) return null;
  const order = /^\/verify\/pieces\?order=([0-9a-f-]{36})$/i.exec(path);
  if (order) return { to: 'order', id: order[1]!.toLowerCase() };
  if (path === '/verify/pieces') return { to: 'pieces' };
  const piece = /^\/verify\/pieces\/(O\d{2}-[A-Z]-\d{5,6})$/i.exec(path);
  if (piece) return { to: 'piece', id: piece[1]!.toUpperCase() };
  const release = /^\/verify\/releases\/([0-9a-f-]{36})$/i.exec(path);
  if (release) return { to: 'release', id: release[1]!.toLowerCase() };
  const sheet = /^\/verify\/lookbook\/([a-z0-9-]{1,80})$/.exec(path);
  if (sheet) return { to: 'sheet', slug: sheet[1]! };
  return null;
}

/** A message of MESSAGES as the view draws it. */
export interface ThreadItem {
  id: string;
  mine: boolean;
  /** `YOU · 6 OCT 2026 · 14:02` or `ORBES CLIENT SERVICES · 6 OCT 2026 · 16:40`, at this phone's offset. */
  author: string;
  /** The body, plain text with its line breaks. */
  body: string;
  concerning: { kind: MessageContextKind; label: string; target: ConcerningTarget | null } | null;
}

export function threadItem(m: AccountMessage, offsetMinutes: number): ThreadItem {
  const mine = m.from === 'YOU';
  return {
    id: m.id,
    mine,
    author: `${mine ? MESSAGES.you : MESSAGES.house} · ${formatDateTime(m.at, offsetMinutes)}`,
    body: m.body,
    concerning: mine && m.concerning ? { kind: m.concerning.kind, label: m.concerning.label, target: concerningTarget(m.concerning.path) } : null,
  };
}

/** MESSAGES: the conversation oldest first, its empty sentence, the label over the reply, and the time read up to. */
export interface ThreadModel {
  items: ThreadItem[];
  empty: string | null;
  replyLabel: string;
  /** The latest message's time: opening the view marks the conversation read up to it. */
  readUpTo: string | null;
}

export function threadModel(t: AccountThread, offsetMinutes: number): ThreadModel {
  const items = t.messages.map((m) => threadItem(m, offsetMinutes));
  return {
    items,
    empty: items.length === 0 ? MESSAGES.emptyThread : null,
    replyLabel: items.length === 0 ? MESSAGES.yourMessage : MESSAGES.yourReply,
    readUpTo: t.messages.at(-1)?.at ?? null,
  };
}

/** NOW's line while an answer is unread: MESSAGES, its sentence and READ; null otherwise. */
export function nowMessagesLine(unread: boolean): { label: string; sentence: string; action: string } | null {
  return unread ? { label: MESSAGES.now.label, sentence: MESSAGES.now.sentence, action: MESSAGES.now.read } : null;
}
