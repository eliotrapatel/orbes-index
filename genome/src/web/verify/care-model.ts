/**
 * YEARLY CARE in a piece's SERVICE tab (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6): what the block says, from GET
 * /api/v1/account/products/:productId/care. Pure: views/piece.ts draws it.
 *
 * A block is shown only when the account's tier has a care allowance above 0 (PLATINE and PALLADIUM by default). For
 * TITANE, for no tier, or for a tier whose allowance is 0, there is no block at all: no line, no link to THE CLUB. The
 * one exception is a request of this piece still open (not DONE nor CANCELLED): it keeps showing its own state if the
 * tier drops meanwhile, because its label and its return concern this piece.
 *
 *   available    the tier's yearly care, then REQUEST YEARLY CARE, which opens the request's own form in place: the
 *                question, RETURN ADDRESS with NAME and ADDRESS prefilled from the account's last order (with its ash
 *                line), CONFIRM REQUEST · CANCEL
 *   requested    REQUESTED · date, the label to come, the RETURN ADDRESS row, CANCEL REQUEST
 *   label        YOUR PREPAID LABEL, DOWNLOAD LABEL, CARRIER and TRACKING NUMBER
 *   received     AT THE ATELIER
 *   returning    ON ITS WAY BACK, CARRIER and TRACKING NUMBER, TRACK THE SHIPMENT
 *   done         its yearly care of the year is complete, recorded in SERVICE HISTORY
 *   used         a PLATINE year used for another piece; it renews on 1 January
 *   pieceDone    this piece has had its yearly care of the year
 *   unavailable  the piece cannot be cared for just now (lost, stolen, in service, a transfer pending)
 *
 * A request cancelled this year adds « This request was cancelled. » above what may be done now.
 */
import { ORDERS, YEARLY_CARE } from './copy.js';
import type { CareRequestView, PieceCare } from './types.js';
import { formatDate } from './view-model.js';

export type CareRow = readonly [label: string, value: string];

export type CareBlock =
  | { kind: 'available'; text: string; action: string }
  | { kind: 'requested'; head: string; text: string; rows: CareRow[]; action: string; requestId: string }
  | { kind: 'label'; head: string; text: string; rows: CareRow[]; download: string | null; requestId: string }
  | { kind: 'received'; head: string; text: string }
  | { kind: 'returning'; head: string; rows: CareRow[]; track: { text: string; href: string; label: string } | null }
  | { kind: 'done'; text: string }
  | { kind: 'used'; text: string }
  | { kind: 'pieceDone'; text: string }
  | { kind: 'unavailable'; text: string };

export interface CareModel {
  label: string;
  /** « This request was cancelled. », above the block, when the piece's latest request of the year was. */
  notice: string | null;
  block: CareBlock;
}

/** The request's own form: its words, and what it starts with. */
export interface CareFormModel {
  question: string;
  label: string;
  lead: string;
  name: { label: string; value: string; max: number };
  address: { label: string; value: string; max: number };
  /** The ash line under a prefilled address; null when nothing was prefilled. */
  prefilled: string | null;
  confirm: string;
  cancel: string;
}

const OPEN = new Set(['REQUESTED', 'LABEL_SENT', 'RECEIVED', 'RETURNING']);

/** Whether a tier's allowance gives a care at all. */
function included(c: PieceCare): boolean {
  return c.tier !== null && c.allowance !== 0;
}

/** A shipment's rows: CARRIER and TRACKING NUMBER. */
function shipmentRows(s: { carrier: { name: string }; tracking: string }): CareRow[] {
  return [
    [YEARLY_CARE.carrier, s.carrier.name.toUpperCase()],
    [YEARLY_CARE.tracking, s.tracking],
  ];
}

function requestBlock(r: CareRequestView): CareBlock | null {
  switch (r.status) {
    case 'REQUESTED':
      return {
        kind: 'requested',
        head: YEARLY_CARE.requested(formatDate(r.requestedAt)),
        text: YEARLY_CARE.requestedText,
        rows: [[YEARLY_CARE.returnAddress, `${r.returnName}\n${r.returnAddress}`]],
        action: YEARLY_CARE.cancelRequest,
        requestId: r.id,
      };
    case 'LABEL_SENT':
      return {
        kind: 'label',
        head: YEARLY_CARE.labelTitle,
        text: YEARLY_CARE.labelText,
        rows: r.label ? shipmentRows(r.label) : [],
        download: r.label?.pdf ? YEARLY_CARE.download : null,
        requestId: r.id,
      };
    case 'RECEIVED':
      return { kind: 'received', head: YEARLY_CARE.received, text: YEARLY_CARE.receivedText };
    case 'RETURNING':
      return {
        kind: 'returning',
        head: YEARLY_CARE.returning,
        rows: r.return ? shipmentRows(r.return) : [],
        // Its accessible name says where it leads, as YOUR ORDERS' TRACK THE SHIPMENT does (ORDERS.trackLabel).
        track:
          r.return && /^https:\/\//.test(r.return.trackingUrl)
            ? { text: YEARLY_CARE.track, href: r.return.trackingUrl, label: ORDERS.trackLabel(r.return.tracking, r.return.carrier.name) }
            : null,
      };
    case 'DONE':
      return { kind: 'done', text: YEARLY_CARE.done(r.year) };
    default:
      return null;
  }
}

/** What the block says now, or null when no block is drawn (see the header). */
export function careModel(c: PieceCare | null | undefined): CareModel | null {
  if (!c) return null;
  const r = c.request;
  // An open request shows its own state, whatever the tier now.
  if (r && OPEN.has(r.status)) return { label: YEARLY_CARE.label, notice: null, block: requestBlock(r)! };
  if (!included(c)) return null;
  if (r && r.status === 'DONE' && r.year === c.year) return { label: YEARLY_CARE.label, notice: null, block: requestBlock(r)! };
  const notice = r && r.status === 'CANCELLED' && r.year === c.year ? YEARLY_CARE.cancelled : null;
  let block: CareBlock;
  switch (c.reason) {
    case 'AVAILABLE':
      block = { kind: 'available', text: YEARLY_CARE.available(c.tier!, c.allowance, c.year), action: YEARLY_CARE.request };
      break;
    case 'USED':
      block = { kind: 'used', text: YEARLY_CARE.used(c.year) };
      break;
    case 'PIECE_DONE':
      block = { kind: 'pieceDone', text: YEARLY_CARE.pieceDone(c.year) };
      break;
    case 'UNAVAILABLE':
      block = { kind: 'unavailable', text: YEARLY_CARE.unavailable };
      break;
    default:
      return null;
  }
  return { label: YEARLY_CARE.label, notice, block };
}

/** The request's own form, prefilled from the account's last order when there is one. */
export function careFormModel(c: PieceCare): CareFormModel {
  const hint = c.addressHint && c.addressHint.address.trim() !== '' ? c.addressHint : null;
  return {
    question: YEARLY_CARE.confirm(c.year),
    label: YEARLY_CARE.returnAddress,
    lead: YEARLY_CARE.returnLead,
    name: { label: YEARLY_CARE.name, value: hint?.name.slice(0, YEARLY_CARE.nameMax) ?? '', max: YEARLY_CARE.nameMax },
    address: { label: YEARLY_CARE.address, value: hint?.address.slice(0, YEARLY_CARE.addressMax) ?? '', max: YEARLY_CARE.addressMax },
    prefilled: hint ? YEARLY_CARE.prefilled : null,
    confirm: YEARLY_CARE.confirmRequest,
    cancel: YEARLY_CARE.cancel,
  };
}

/** What is missing from the form before it is sent, as the server says it; null when both are given. */
export function careFormProblem(name: string, address: string): string | null {
  return name.trim() === '' || address.trim() === '' ? YEARLY_CARE.missing : null;
}
