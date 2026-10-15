/**
 * The PRIVATE CARE board of the console (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6, the yearly care; named PRIVATE
 * CARE on screen by plan ORBES CARE, its route `#/care` and internal names kept): its pure parts. The tabs by step, each
 * step's words, what an OPERATOR may do at each step, the label's file check, and the Messages board's link to an open
 * request (`PRIVATE CARE · O26-J-00184`). The server orders the board (oldest first) and holds every rule; this module
 * only words it. Nothing is written in MESSAGES at any step.
 */
import { can } from './permissions.js';
import { href } from '../router.js';
import { CARE_REQUEST_STATUSES, type AdminRole, type CareRequestStatus, type CareSheet } from '../types.js';

/** As services/care.ts CARE_LABEL_MAX_BYTES: the label's PDF, at most 2 MiB (test/web/admin.model.test.ts holds them equal). */
export const CARE_LABEL_MAX_BYTES = 2 * 1024 * 1024;

/** The board's lead and its empty state. */
export const CARE_LEAD =
  'PRIVATE CARE, which the tiers from PLATINE include, asked for by clients from a piece. Send each the prepaid label, receive the piece, ship it back to the address they gave, then complete it: it is recorded in the piece’s SERVICE HISTORY.';
export const CARE_EMPTY = 'No PRIVATE CARE at this step.';
/** The conversation row of a request without one. */
export const NO_CONVERSATION = 'No conversation yet.';

/** A step in words, as the tabs and the rows read it. */
export const CARE_STATUS_LABELS: Readonly<Record<CareRequestStatus, string>> = Object.freeze({
  REQUESTED: 'Requested',
  LABEL_SENT: 'Label sent',
  RECEIVED: 'With ORBES',
  RETURNING: 'On its way back',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
});

/** The tabs, in the order of the steps: Requested · Label sent · With ORBES · On its way back · Done · Cancelled. */
export const CARE_TABS: readonly { value: CareRequestStatus; label: string }[] = Object.freeze(CARE_REQUEST_STATUSES.map((s) => ({ value: s, label: CARE_STATUS_LABELS[s] })));

/** The tab the route names; Requested by default. */
export function careTab(query: Record<string, string>): CareRequestStatus {
  return (CARE_REQUEST_STATUSES as readonly string[]).includes(query.status ?? '') ? (query.status as CareRequestStatus) : 'REQUESTED';
}

/** The actions of a request: SEND LABEL, RECEIVED BY ORBES, SHIP BACK, COMPLETE, CANCEL. */
export type CareAction = 'label' | 'receive' | 'return' | 'complete' | 'cancel';

/** What an OPERATOR may do at each step (the server refuses the others: 409 CARE_STEP). */
export function careActions(status: CareRequestStatus, role: AdminRole): CareAction[] {
  if (!can(role, 'manageCare')) return [];
  switch (status) {
    case 'REQUESTED':
      return ['label', 'cancel'];
    case 'LABEL_SENT':
      return ['receive', 'cancel'];
    case 'RECEIVED':
      return ['return', 'cancel'];
    case 'RETURNING':
      return ['complete'];
    default:
      return [];
  }
}

/** The actions' words. */
export const CARE_ACTION_LABELS: Readonly<Record<CareAction, string>> = Object.freeze({
  label: 'Send label',
  receive: 'Received by ORBES',
  return: 'Ship back',
  complete: 'Complete',
  cancel: 'Cancel',
});

/** What is wrong with the label's file, or null: a PDF, of at most 2 MB. */
export function labelFileProblem(file: { type: string; size: number; name: string } | null | undefined): string | null {
  if (!file) return 'Choose the label, a PDF.';
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!pdf) return 'Send the label itself, as a PDF.';
  if (file.size > CARE_LABEL_MAX_BYTES) return 'The label is limited to 2 MB.';
  if (file.size === 0) return 'This file is empty.';
  return null;
}

/** A shipment in words: `Colissimo · 6A12345678901`. */
export function shipmentText(s: CareSheet['label'] | CareSheet['return']): string {
  return s ? `${s.carrier.name} · ${s.tracking}` : '—';
}

/** The Messages board's and a conversation's link to a client's open PRIVATE CARE: `PRIVATE CARE · O26-J-00184`. */
export function careLinkText(care: { serial: string }): string {
  return `PRIVATE CARE · ${care.serial}`;
}

export function careHref(care: { id: string }): string {
  return href('careRequest', { careId: care.id });
}
