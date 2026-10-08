/**
 * Order cases on an order's page (plan NEXT LOT of 2026-10-07, §1.1 (b), §3.5.4.4 and §3.6.D; step 5.11e): pure
 * helpers, no DOM. The Order case section's words; what may be done with a case (Decide, Cancel the order case) and with
 * the order (Open a return); the dialogs' checks and what they send. The server stays the authority (409
 * ORDER_CASE_OPEN, EXCHANGE_SIZE_NOT_IN_STOCK, ORDER_CASE_NOT_RECEIVED; 403 for a lost parcel or the archive below
 * ADMIN).
 */
import { formatCount, formatDate } from '../format.js';
import { can } from './permissions.js';
import type { AdminRole, OrderCaseReason, OrderCaseRecord, OrderCaseStatus } from '../types.js';

/** The bounds of services/order-cases.ts (ORDER_CASE_LIMITS). */
export const ORDER_CASE_LIMITS = Object.freeze({ note: 1000, decisionNote: 1000, cancelNote: 1000 });
/** The collector's own window to return a piece (services/parcels.ts RETURN_WINDOW_DAYS). */
export const RETURN_WINDOW_DAYS = 14;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/** The four reasons of §3.6.D, as the collector's app words them. */
export const CASE_REASON_LABELS: Readonly<Record<OrderCaseReason, string>> = Object.freeze({
  SIZE: 'The size does not fit',
  NOT_AS_EXPECTED: 'The piece is not as I expected',
  DAMAGED: 'The piece arrived damaged',
  OTHER: 'Another reason',
});

export const CASE_STATUS_LABELS: Readonly<Record<OrderCaseStatus, string>> = Object.freeze({ OPEN: 'OPEN', RECEIVED: 'RECEIVED', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED' });

export const CASE_TEXT = Object.freeze({
  title: 'Order case',
  empty: 'No return, exchange or parcel problem.',
  open: 'Open a return',
  openText: 'The collector sends the piece back at their cost. The agent records it when it arrives; you then decide.',
  late: 'Delivered more than 14 days ago: this return is ORBES’s choice, beyond the collector’s own 14 days.',
  opened: 'Return opened.',
  sizeOut: 'none in stock',
  decide: 'Decide',
  decided: 'Decision recorded.',
  lostText: 'The lost piece’s identity is revoked: it can never be registered.',
  reshipText: 'Another piece is shipped ahead of the orders waiting for stock.',
  cancel: 'Cancel the order case',
  cancelText: 'The order case ends with no decision: a request refused or withdrawn. Answer the collector in MESSAGES.',
  cancelled: 'Order case cancelled.',
});

/** What may be done with the order: Open a return, once shipped or delivered and while no order case is open. */
export function canOpenReturn(o: { status: string }, cases: readonly Pick<OrderCaseRecord, 'status'>[], role: AdminRole | null | undefined): boolean {
  return can(role, 'manageOrders') && (o.status === 'SHIPPED' || o.status === 'DELIVERED') && !cases.some((c) => c.status === 'OPEN' || c.status === 'RECEIVED');
}

/** Whether the collector's 14 days are behind (the dialog says ORBES chooses beyond them). */
export function pastReturnWindow(deliveredAt: string | null, now: Date): boolean {
  return deliveredAt !== null && now.getTime() > new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * DAY_MS;
}

/** What may be done with a case now: Decide (once the parcel is back, a lost parcel by an ADMIN as it stands), Cancel. */
export function caseActions(c: Pick<OrderCaseRecord, 'kind' | 'status'>, role: AdminRole | null | undefined): { decide: boolean; cancel: boolean } {
  const open = c.status === 'OPEN' || c.status === 'RECEIVED';
  const may = c.kind === 'LOST' ? can(role, 'decideLostParcel') : c.kind === 'RETURN' || c.kind === 'EXCHANGE' ? can(role, 'decideReturns') : can(role, 'decideParcels');
  return {
    decide: may && (c.kind === 'LOST' ? c.status === 'OPEN' : c.status === 'RECEIVED'),
    cancel: can(role, 'manageOrders') && open,
  };
}

/** The outcomes a case may take, worded. */
export function outcomeOptions(kind: OrderCaseRecord['kind']): { value: 'REFUND' | 'EXCHANGE' | 'RESHIP'; label: string }[] {
  if (kind === 'RETURN') return [{ value: 'REFUND', label: 'Refund' }];
  if (kind === 'EXCHANGE') return [{ value: 'EXCHANGE', label: 'Ship the other size' }, { value: 'REFUND', label: 'Refund' }];
  return [{ value: 'RESHIP', label: 'Ship another piece' }, { value: 'REFUND', label: 'Refund' }];
}

/** Whether the decision says where the piece goes: a return, an exchange, a damaged parcel. */
export const decidesPiece = (kind: OrderCaseRecord['kind']): boolean => kind === 'RETURN' || kind === 'EXCHANGE' || kind === 'DAMAGED';

/** The lines of a case on the order page. */
export function caseLines(c: OrderCaseRecord): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [
    { label: 'Opened', value: `${formatDate(c.openedAt)} · ${c.openedBy === 'COLLECTOR' ? 'by the collector' : 'by ORBES Client Services'}` },
  ];
  if (c.reason) out.push({ label: 'Reason', value: CASE_REASON_LABELS[c.reason] });
  if (c.exchange) out.push({ label: 'New size', value: `${c.exchange.sizeLabel} · ${formatCount(c.exchange.available)} in stock` });
  if (c.note) out.push({ label: 'Note', value: c.note });
  if (c.received) out.push({ label: 'Back at the agent', value: `${formatDate(c.received.at)} · ${c.received.pieceState === 'OK' ? 'OK' : 'Damaged'}${c.received.note ? ` · ${c.received.note}` : ''}` });
  if (c.decision) {
    const outcome = c.decision.outcome === 'REFUND' ? 'Refund' : c.decision.outcome === 'EXCHANGE' ? 'Ship the other size' : 'Ship another piece';
    const piece = c.decision.pieceTo === 'RESTOCKED' ? ' · back to stock' : c.decision.pieceTo === 'ARCHIVED' ? ' · to the archive' : c.decision.pieceTo === 'REVOKED' ? ' · revoked' : '';
    out.push({ label: 'Decided', value: `${formatDate(c.decision.at)} · ${outcome}${piece}${c.decision.exchangeOrder ? ` · ${c.decision.exchangeOrder.reference}` : ''}` });
    if (c.decision.note) out.push({ label: 'Decision note', value: c.decision.note });
  }
  if (c.cancelled) out.push({ label: 'Cancelled', value: `${formatDate(c.cancelled.at)}${c.cancelled.note ? ` · ${c.cancelled.note}` : ''}` });
  return out;
}

// ── The dialogs ────────────────────────────────────────────────────────────

/** Open a return: its kind, a new size in stock for an exchange, a reason, a note. */
export function openCaseProblem(v: Record<string, string>, sizes: readonly { skuId: string; selectable: boolean }[]): string | null {
  if (v.kind !== 'RETURN' && v.kind !== 'EXCHANGE') return 'Choose a return or a size exchange.';
  if (v.kind === 'EXCHANGE' && !sizes.some((s) => s.skuId === v.exchangeSkuId && s.selectable)) return 'Choose the new size among those in stock.';
  if (!(v.reason in CASE_REASON_LABELS)) return 'Choose the reason.';
  const note = (v.note ?? '').trim();
  if (!note) return 'Say in the note what the collector asked.';
  if (note.length > ORDER_CASE_LIMITS.note) return `A note has at most ${formatCount(ORDER_CASE_LIMITS.note)} characters.`;
  return null;
}

export function openCaseInput(v: Record<string, string>): { kind: 'RETURN' | 'EXCHANGE'; reason: OrderCaseReason; exchangeSkuId: string | null; note: string } {
  return { kind: v.kind as 'RETURN' | 'EXCHANGE', reason: v.reason as OrderCaseReason, exchangeSkuId: v.kind === 'EXCHANGE' ? v.exchangeSkuId! : null, note: v.note!.trim() };
}

/** Decide: an outcome; where the piece goes (back to stock at a location, or to the archive); a note (required but for a parcel problem). */
export function decideProblem(c: Pick<OrderCaseRecord, 'kind'>, v: Record<string, string>): string | null {
  if (!outcomeOptions(c.kind).some((o) => o.value === v.decision)) return 'Choose the outcome.';
  if (decidesPiece(c.kind)) {
    if (v.pieceTo !== 'RESTOCKED' && v.pieceTo !== 'ARCHIVED') return 'Say where the piece goes.';
    if (v.pieceTo === 'RESTOCKED' && !UUID_RE.test(v.locationId ?? '')) return 'Choose the location the piece goes back to.';
  }
  const note = (v.note ?? '').trim();
  if (!note && (c.kind === 'RETURN' || c.kind === 'EXCHANGE')) return 'Say in the note why.';
  if (note.length > ORDER_CASE_LIMITS.decisionNote) return `A note has at most ${formatCount(ORDER_CASE_LIMITS.decisionNote)} characters.`;
  return null;
}

export function decideInput(c: Pick<OrderCaseRecord, 'kind'>, v: Record<string, string>): { decision: 'REFUND' | 'EXCHANGE' | 'RESHIP'; pieceTo: 'RESTOCKED' | 'ARCHIVED' | null; locationId: string | null; note: string | null } {
  const piece = decidesPiece(c.kind) ? (v.pieceTo as 'RESTOCKED' | 'ARCHIVED') : null;
  return { decision: v.decision as 'REFUND' | 'EXCHANGE' | 'RESHIP', pieceTo: piece, locationId: piece === 'RESTOCKED' ? v.locationId! : null, note: (v.note ?? '').trim() || null };
}
