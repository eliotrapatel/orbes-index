/**
 * PRIVATE CARE and a WARRANTY CLAIM in a piece's tab (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6; plan ORBES CARE §2(a)
 * items 2 and 3): what each block says, from GET /api/v1/account/products/:productId/care. Pure: views/yearly-care.ts
 * draws them.
 *
 * PRIVATE CARE (internal name YEARLY_CARE) is drawn when the account's tier has a care allowance above 0 (from PLATINE
 * by default). For a tier without one (TITANE, no tier, an allowance of 0), the block says the tier it opens from
 * (`opens`, THE PROGRAM's lowest tier with an allowance), or nothing when no tier includes it. The one exception is a
 * request of this piece still open (not DONE nor CANCELLED): it keeps showing its own state if the tier drops
 * meanwhile, because its label and its return concern this piece.
 *
 *   available    the tier's PRIVATE CARE, then REQUEST PRIVATE CARE, which opens the request's own form in place: the
 *                question, RETURN ADDRESS with NAME and ADDRESS prefilled from the account's last order (with its ash
 *                line), CONFIRM REQUEST · CANCEL
 *   requested    REQUESTED · date, the label to come, the RETURN ADDRESS row, CANCEL REQUEST
 *   label        YOUR PREPAID LABEL, DOWNLOAD LABEL, CARRIER and TRACKING NUMBER
 *   received     WITH ORBES
 *   returning    ON ITS WAY BACK, CARRIER and TRACKING NUMBER, TRACK THE SHIPMENT
 *   done         its PRIVATE CARE of the year is complete, recorded in SERVICE HISTORY
 *   used         a year's allowance used for another piece (THE PROGRAM sets a number); it renews on 1 January
 *   pieceDone    this piece has had its PRIVATE CARE of the year
 *   unavailable  the piece cannot be cared for just now (lost, stolen, in service, a transfer pending, a claim under way)
 *   opens        a tier that includes none: « PRIVATE CARE opens from PLATINE: … »
 *
 * A request cancelled this year adds « This request was cancelled. » above what may be done now.
 *
 * The WARRANTY CLAIM (answer 9) is the piece's claim of this account, while under way and for 30 days after it ended
 * (the server sends it so): its step, its prepaid label (DOWNLOAD LABEL), its outcome in the words of its warranty, the
 * shipment back. Nothing in it starts or feeds a claim.
 */
import { ORDERS, WARRANTY_CLAIM, YEARLY_CARE } from './copy.js';
import type { CareRequestView, CareShipment, PieceCare, PieceClaim } from './types.js';
import { formatDate, formatMoney } from './view-model.js';

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
  | { kind: 'unavailable'; text: string }
  | { kind: 'opens'; text: string };

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
  if (!included(c)) {
    // The tier it opens from (plan ORBES CARE §2(a) item 3), when THE PROGRAM gives one; else no block.
    const o = c.reason === 'NOT_INCLUDED' ? c.opens : null;
    if (!o || typeof o.tier !== 'string' || !o.tier || !(o.allowance === 'ALL' || (Number.isInteger(o.allowance) && o.allowance > 0))) return null;
    return { label: YEARLY_CARE.label, notice: null, block: { kind: 'opens', text: YEARLY_CARE.opens(o.tier, o.allowance) } };
  }
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

// ── The warranty claim (plan ORBES CARE §2(a) item 2, answer 9) ─────────────

/** What the WARRANTY CLAIM block says now: a head (or none), its sentences, its rows, DOWNLOAD LABEL, TRACK THE SHIPMENT. */
export interface ClaimModel {
  label: string;
  claimId: string;
  head: string | null;
  texts: string[];
  rows: CareRow[];
  /** DOWNLOAD LABEL, while the prepaid label's PDF can be downloaded; else null. */
  download: string | null;
  track: { text: string; href: string; label: string } | null;
}

/** TRACK THE SHIPMENT of a shipment with an https link, its accessible name saying where (ORDERS.trackLabel). */
function trackOf(s: CareShipment | null, text: string): ClaimModel['track'] {
  return s && /^https:\/\//.test(s.trackingUrl) ? { text, href: s.trackingUrl, label: ORDERS.trackLabel(s.tracking, s.carrier.name) } : null;
}

const money = (a: { amountMinor: number; currency: string } | null): string => (a && Number.isInteger(a.amountMinor) && typeof a.currency === 'string' ? formatMoney(a.amountMinor, a.currency) : '');

/** Why a claim was refused, in the words of its warranty; '' for a reason the app does not know. */
function refusal(c: PieceClaim): string {
  const r = c.refusalReason;
  const reason = r === 'NO_FAULT_FOUND' ? WARRANTY_CLAIM.noFault[c.basis] : r && Object.hasOwn(WARRANTY_CLAIM.reasons, r) ? WARRANTY_CLAIM.reasons[r as keyof typeof WARRANTY_CLAIM.reasons] : '';
  if (!reason) return '';
  return c.basis === 'LEGAL' ? WARRANTY_CLAIM.refusedLegal(reason) : WARRANTY_CLAIM.refused(reason);
}

/**
 * The block of the piece's warranty claim, or null without one (or one the app cannot read). DECIDED is the outcome
 * before its shipment, DONE after it: the piece back (or the new piece) with CARRIER, TRACKING NUMBER and TRACK THE
 * SHIPMENT. A credit of value and a refund are DONE at once, ORBES keeping the piece.
 */
export function claimModel(c: PieceClaim | null | undefined): ClaimModel | null {
  if (!c || typeof c.id !== 'string' || !(c.basis === 'LIFETIME' || c.basis === 'TWO_YEARS' || c.basis === 'LEGAL')) return null;
  const base: ClaimModel = { label: WARRANTY_CLAIM.label, claimId: c.id, head: null, texts: [], rows: [], download: null, track: null };
  const shipped = c.status === 'DONE' && c.return ? c.return : null;
  /** The piece's way back (or the new piece's way), once shipped. */
  const back = (texts: string[], head: string | null = null): ClaimModel => ({
    ...base,
    head,
    texts,
    rows: shipped ? shipmentRows(shipped) : [],
    track: trackOf(shipped, WARRANTY_CLAIM.track),
  });
  switch (c.status) {
    case 'OPEN':
      return { ...base, texts: [WARRANTY_CLAIM.open] };
    case 'LABEL_SENT':
      return {
        ...base,
        head: WARRANTY_CLAIM.labelTitle,
        texts: [WARRANTY_CLAIM.labelText],
        rows: c.label ? shipmentRows(c.label) : [],
        download: c.label?.pdf ? WARRANTY_CLAIM.download : null,
      };
    case 'RECEIVED':
      return { ...base, head: WARRANTY_CLAIM.received, texts: [WARRANTY_CLAIM.receivedText] };
    case 'CANCELLED':
      return { ...base, texts: [WARRANTY_CLAIM.cancelled] };
    case 'DECIDED':
    case 'DONE': {
      const done = c.status === 'DONE';
      const credit = money(c.credit);
      const until = c.credit ? formatDate(c.credit.expiresAt) : '';
      switch (c.outcome) {
        case 'REPLACEMENT':
          return done ? back([WARRANTY_CLAIM.replacedText], WARRANTY_CLAIM.replaced) : { ...base, texts: [WARRANTY_CLAIM.replacement] };
        case 'VALUE_CREDIT':
          return { ...base, texts: [WARRANTY_CLAIM.valueCredit(credit, until)] };
        case 'PART_CREDIT':
          return back([WARRANTY_CLAIM.partCredit(credit, until), done ? WARRANTY_CLAIM.onItsWay : WARRANTY_CLAIM.returned]);
        case 'REPAIR': {
          const repaired = c.basis === 'LEGAL' ? WARRANTY_CLAIM.repaired.LEGAL : WARRANTY_CLAIM.repaired.TWO_YEARS;
          return back(done ? [`${repaired} ${WARRANTY_CLAIM.repairedBack}`] : [repaired]);
        }
        case 'PRICE_REDUCTION':
          return back([WARRANTY_CLAIM.priceReduction(money(c.value)), ...(done ? [WARRANTY_CLAIM.onItsWay] : [])]);
        case 'REFUND':
          return { ...base, texts: [WARRANTY_CLAIM.refund(money(c.value))] };
        case 'REFUSED': {
          const why = refusal(c);
          // Refused once received: the piece goes back to its owner, then is on its way.
          const way = c.receivedAt ? [done ? WARRANTY_CLAIM.onItsWay : WARRANTY_CLAIM.returned] : [];
          return back([...(why ? [why] : []), ...way]);
        }
        default:
          return null;
      }
    }
    default:
      return null;
  }
}
