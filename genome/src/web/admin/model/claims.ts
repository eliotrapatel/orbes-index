/**
 * The warranty claims of the console (plan ORBES CARE of 2026-10-15, §2(b)): their pure parts. Each step's and each
 * basis's words, the outcomes and refusal reasons in words per basis (the server's lists: services/warranty-claims.ts,
 * migration 0048's CHECKs), what an OPERATOR may do at each step (answer 11: Client Services decide every outcome),
 * what Open a warranty claim names for a piece, the piece page's Free replacement row, and the Warranties page's
 * Claims tab. The server holds every rule and filters what a decision may be now (`decision`); this module only words
 * it. Nothing here starts a claim from the client's app: a claim is opened by Client Services from the conversation.
 */
import { formatDate } from '../format.js';
import { href } from '../router.js';
import {
  WARRANTY_CLAIM_STATUSES,
  type AdminRole,
  type ClaimSheet,
  type PieceClaims,
  type WarrantyClaimBasis,
  type WarrantyClaimOutcome,
  type WarrantyClaimRefusal,
  type WarrantyClaimStatus,
} from '../types.js';
import { formatMoney } from './live.js';
import { can } from './permissions.js';

/** A step in words, as the claim's page, the Claims tab and the piece page read it. */
export const CLAIM_STATUS_LABELS: Readonly<Record<WarrantyClaimStatus, string>> = Object.freeze({
  OPEN: 'Open',
  LABEL_SENT: 'Label sent',
  RECEIVED: 'With ORBES',
  DECIDED: 'Decided',
  DONE: 'Done',
  CANCELLED: 'Closed',
});

/** What a claim is made under, in full (the claim's page, the opening dialog). */
export const CLAIM_BASIS_LABELS: Readonly<Record<WarrantyClaimBasis, string>> = Object.freeze({
  LIFETIME: 'Lifetime warranty',
  TWO_YEARS: '2-year warranty',
  LEGAL: 'Legal guarantee',
});

/** What a claim is made under, short (the piece page's and the Claims tab's tables). */
export const CLAIM_BASIS_SHORT: Readonly<Record<WarrantyClaimBasis, string>> = Object.freeze({
  LIFETIME: 'Lifetime',
  TWO_YEARS: '2 years',
  LEGAL: 'Legal guarantee',
});

/** An outcome as the decision dialog offers it; the part credit names THE PROGRAM's rate. */
export function outcomeChoice(o: WarrantyClaimOutcome, creditPercent: number): string {
  switch (o) {
    case 'REPLACEMENT':
      return 'Replace with the same piece, new';
    case 'VALUE_CREDIT':
      return 'Credit of its value (model no longer made)';
    case 'PART_CREDIT':
      return `${creditPercent} % credit`;
    case 'REPAIR':
      return 'Repaired';
    case 'PRICE_REDUCTION':
      return 'Price reduction';
    case 'REFUND':
      return 'Refund';
    case 'REFUSED':
      return 'Refuse';
  }
}

/**
 * The decision dialog's choices: the server's outcomes for now (`decision.outcomes`), in its order, never the credit of
 * the piece's value while its model is still made (answer 4; the server refuses it too, 422 CLAIM_OUTCOME_NOT_ALLOWED).
 */
export function decisionChoices(s: Pick<ClaimSheet, 'decision' | 'modelDiscontinued'>): { value: WarrantyClaimOutcome; label: string }[] {
  return s.decision.outcomes.filter((o) => o !== 'VALUE_CREDIT' || s.modelDiscontinued).map((o) => ({ value: o, label: outcomeChoice(o, s.decision.creditPercent) }));
}

/** An outcome once decided (the tables and the claim's page); the part credit with its rate when known. */
export function outcomeText(o: WarrantyClaimOutcome | null, creditPercent: number | null = null): string {
  switch (o) {
    case null:
      return '—';
    case 'REPLACEMENT':
      return 'Replaced';
    case 'VALUE_CREDIT':
      return 'Credit of its value';
    case 'PART_CREDIT':
      return creditPercent === null ? 'Part credit' : `${creditPercent} % credit`;
    case 'REPAIR':
      return 'Repaired';
    case 'PRICE_REDUCTION':
      return 'Price reduction';
    case 'REFUND':
      return 'Refunded';
    case 'REFUSED':
      return 'Refused';
  }
}

const REFUSAL_WORDS: Readonly<Record<Exclude<WarrantyClaimRefusal, 'NO_FAULT_FOUND'>, string>> = Object.freeze({
  LOST: 'Lost',
  THEFT_REPORTED: 'Theft reported',
  SCRATCHED: 'Scratched',
  DAMAGED_ON_PURPOSE: 'Damaged on purpose',
  DAMAGED_BY_SOMEONE_ELSE: 'Damaged by someone else',
  ALTERED_OUTSIDE_ORBES: 'Altered or repaired outside ORBES',
  WARRANTY_ENDED: 'Warranty ended',
  WARRANTY_VOID: 'Warranty no longer valid',
});

/** NO_FAULT_FOUND says what each warranty covers (answer 10): tarnish, fading or accidental break; a defect; conformity. */
const NO_FAULT: Readonly<Record<WarrantyClaimBasis, string>> = Object.freeze({
  LIFETIME: 'No tarnish, fading or accidental break',
  TWO_YEARS: 'No manufacturing defect',
  LEGAL: 'No lack of conformity',
});

/** A reason of refusal in words, as the basis reads it. */
export function refusalText(basis: WarrantyClaimBasis, r: WarrantyClaimRefusal): string {
  return r === 'NO_FAULT_FOUND' ? NO_FAULT[basis] : REFUSAL_WORDS[r];
}

/** The refusal reasons a basis lists, in words (the server's `decision.refusalReasons`, in its order). */
export function refusalOptions(basis: WarrantyClaimBasis, reasons: readonly WarrantyClaimRefusal[]): { value: WarrantyClaimRefusal; label: string }[] {
  return reasons.map((r) => ({ value: r, label: refusalText(basis, r) }));
}

/** The steps of a claim's page: SEND LABEL, REFUSE, CLOSE, RECEIVED, DECIDE, MOVE TO THE LEGAL GUARANTEE, SHIP. */
export type ClaimAction = 'label' | 'refuse' | 'close' | 'receive' | 'decide' | 'legal' | 'ship';

export const CLAIM_ACTION_LABELS: Readonly<Record<ClaimAction, string>> = Object.freeze({
  label: 'Send label',
  refuse: 'Refuse',
  close: 'Close',
  receive: 'Received',
  decide: 'Decide',
  legal: 'Move to the legal guarantee',
  ship: 'Ship',
});

/** Whether the legal guarantee still applies on `today` (an ISO day): its last day not passed. */
export function legalOpen(legalUntil: string | null, today: string): boolean {
  return legalUntil !== null && today <= legalUntil;
}

/**
 * What an OPERATOR (or an ADMIN) may do at each step (answer 11; the server refuses the others: 409 CLAIM_STEP). MOVE TO
 * THE LEGAL GUARANTEE on a received 2-year claim only, while the legal guarantee applies.
 */
export function claimActions(s: Pick<ClaimSheet, 'status' | 'basis' | 'legalUntil'>, role: AdminRole | null | undefined, today: string): ClaimAction[] {
  if (!can(role, 'handleClaims')) return [];
  switch (s.status) {
    case 'OPEN':
      return ['label', 'refuse', 'close'];
    case 'LABEL_SENT':
      return ['receive', 'close'];
    case 'RECEIVED':
      return s.basis === 'TWO_YEARS' && legalOpen(s.legalUntil, today) ? ['decide', 'legal'] : ['decide'];
    case 'DECIDED':
      return ['ship'];
    default:
      return [];
  }
}

/**
 * The outcomes that take an amount typed by staff: a credit when no value is found (D11), a refund when no price paid is
 * found (a boutique sale), a price reduction always (at most the price paid).
 */
export function amountAsked(outcome: string | undefined, d: Pick<ClaimSheet['decision'], 'value' | 'paid'>): boolean {
  if (outcome === 'PRICE_REDUCTION') return true;
  if (outcome === 'REFUND') return d.paid === null;
  return (outcome === 'VALUE_CREDIT' || outcome === 'PART_CREDIT') && d.value === null;
}

/** An amount a decision comes from, in words: `€ 450`, or that staff enter it, in THE PROGRAM's credit currency. */
export function claimValueText(value: ClaimSheet['decision']['value']): string {
  return value ? formatMoney(value.amountMinor, value.currency) : 'None found: enter it, in THE PROGRAM’s credit currency';
}

/** The line under the decision's choice naming what it comes from: the piece's value (a credit), the price paid (a refund). */
export function decisionBasisLine(d: Pick<ClaimSheet['decision'], 'value' | 'paid'>, outcome: string | undefined): string | null {
  if (outcome === 'VALUE_CREDIT' || outcome === 'PART_CREDIT') {
    return d.value ? `Value of the piece: ${claimValueText(d.value)}.` : 'No value is found for this piece: enter it, in THE PROGRAM’s credit currency.';
  }
  if (outcome === 'REFUND') return d.paid ? `Price paid: ${claimValueText(d.paid)}.` : 'No price paid is recorded (a boutique sale): enter it, in THE PROGRAM’s credit currency.';
  return null;
}

/** A part credit's amount, as the server computes it: THE PROGRAM's percent of the value, rounded down. */
export function partCreditMinor(valueMinor: number, percent: number): number {
  return Math.floor((valueMinor * percent) / 100);
}

/** What a decision's dialog says under its choice, from the values: what it gives and what follows. */
export function decisionNote(s: Pick<ClaimSheet, 'decision'>, outcome: string | undefined): string | null {
  const v = s.decision.value;
  switch (outcome) {
    case 'REPLACEMENT':
      return 'An ISSUED identity of the same SKU, never sold: from the stock, or from the Generator (an ADMIN’s). The piece claimed is revoked as REPLACED; the new one ships next.';
    case 'VALUE_CREDIT':
      return v
        ? `A credit of ${formatMoney(v.amountMinor, v.currency)} toward a new piece, valid 12 months. The piece claimed stays with ORBES and is revoked as REPLACED.`
        : 'A credit of the value entered, valid 12 months. The piece claimed stays with ORBES and is revoked as REPLACED.';
    case 'PART_CREDIT':
      return v
        ? `A credit of ${formatMoney(partCreditMinor(v.amountMinor, s.decision.creditPercent), v.currency)} (${s.decision.creditPercent} % of ${formatMoney(v.amountMinor, v.currency)}), valid 12 months. The piece returns to the client.`
        : `A credit of ${s.decision.creditPercent} % of the value entered, valid 12 months. The piece returns to the client.`;
    case 'REPAIR':
      return 'The piece returns to the client, repaired.';
    case 'PRICE_REDUCTION':
      return 'At most the price paid, paid back by the seller. The piece returns to the client.';
    case 'REFUND':
      return 'The price paid, paid back by the seller: for an ORBES order, open the order’s return (its archive draws the credit note); for a boutique sale, the seller refunds. The piece stays with ORBES and is revoked as REFUNDED.';
    case 'REFUSED':
      return 'The piece returns to the client.';
    default:
      return null;
  }
}

/** The claim's decision in words for its page: `Refused · No manufacturing defect`, `30 % credit · € 135 until 15 OCT 2027`. */
export function decisionText(s: Pick<ClaimSheet, 'basis' | 'outcome' | 'refusalReason' | 'creditPercent' | 'grant' | 'value' | 'replacement' | 'otherSize'>): string {
  if (!s.outcome) return '—';
  const parts = [outcomeText(s.outcome, s.creditPercent)];
  if (s.outcome === 'REFUSED' && s.refusalReason) parts.push(refusalText(s.basis, s.refusalReason));
  if (s.grant) parts.push(`${formatMoney(s.grant.amountMinor, s.grant.currency)} until ${formatDate(s.grant.expiresAt)}`);
  else if (s.value && (s.outcome === 'PRICE_REDUCTION' || s.outcome === 'REFUND')) parts.push(formatMoney(s.value.amountMinor, s.value.currency));
  if (s.replacement) parts.push(`by ${s.replacement.productId}${s.otherSize ? ', another size' : ''}`);
  return parts.join(' · ');
}

// ── Open a warranty claim ─────────────────────────────────────────────────

/** The warranty a claim under the ORBES warranty records for a piece, as Open a warranty claim names it (never chosen). */
export function warrantyKindText(lifetime: boolean): string {
  return lifetime ? 'Lifetime warranty' : '2-year warranty (defects only)';
}

/** The line Open a warranty claim adds for a piece whose model is no longer made, or null. */
export function discontinuedText(c: Pick<PieceClaims, 'lifetime' | 'modelDiscontinued'>): string | null {
  if (!c.modelDiscontinued) return null;
  return c.lifetime
    ? 'This model is no longer made.'
    : 'This model is no longer made: a replacement is not possible. If it cannot be repaired, choose Legal guarantee.';
}

/** Why the ORBES warranty is not offered for a piece in Open a warranty claim, or null when it is. */
export function warrantyRefusal(registeredToClient: boolean): string | null {
  return registeredToClient ? null : 'Only the registered owner claims under the ORBES warranty: this piece is not registered to this client.';
}

/** The basis choices of Open a warranty claim: the ORBES warranty for the registered owner, the legal guarantee within its 2 years. */
export function openBasisOptions(registeredToClient: boolean, legalUntil: string | null, today: string): { value: 'WARRANTY' | 'LEGAL'; label: string; disabled?: boolean }[] {
  return [
    { value: 'WARRANTY', label: 'ORBES warranty', ...(registeredToClient ? {} : { disabled: true }) },
    { value: 'LEGAL', label: legalUntil ? `Legal guarantee, until ${formatDate(legalUntil)}` : 'Legal guarantee', ...(legalOpen(legalUntil, today) ? {} : { disabled: true }) },
  ];
}

/** A piece of the client, for Open a warranty claim's first step: registered to the client, or of one of its orders. */
export interface ClaimablePiece {
  productId: string;
  label: string;
}

/**
 * The pieces Open a warranty claim names: those registered to the client now, by serial, then those of its orders still
 * standing (the legal guarantee is the buyer's), each once.
 */
export function claimablePieces(
  pieces: readonly { productId: string; model: string; until: string | null }[],
  orders: readonly { reference: string; status: string; piece: string | null; model: { name: string } }[],
): ClaimablePiece[] {
  const out: ClaimablePiece[] = [];
  const seen = new Set<string>();
  for (const p of [...pieces].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))) {
    if (p.until !== null || seen.has(p.productId)) continue;
    seen.add(p.productId);
    out.push({ productId: p.productId, label: `${p.productId} · ${p.model}` });
  }
  for (const o of orders) {
    if (!o.piece || seen.has(o.piece) || !['PAID', 'SHIPPED', 'DELIVERED'].includes(o.status)) continue;
    seen.add(o.piece);
    out.push({ productId: o.piece, label: `${o.piece} · ${o.model.name} · order ${o.reference}` });
  }
  return out;
}

// ── The piece page ────────────────────────────────────────────────────────

/** The piece page's Free replacement row (a lifetime piece only): `Available`, or `Used · 03 NOV 2026` with its claim. */
export function freeReplacementRow(c: Pick<PieceClaims, 'freeReplacement'>): { value: string; claimId: string | null } | null {
  const f = c.freeReplacement;
  if (!f) return null;
  return f.available ? { value: 'Available', claimId: null } : { value: `Used · ${formatDate(f.decidedAt)}`, claimId: f.claimId };
}

/** Whether a claim is under way (OPEN, LABEL_SENT, RECEIVED, DECIDED): one at a time per piece. */
export function claimLive(status: WarrantyClaimStatus): boolean {
  return status !== 'DONE' && status !== 'CANCELLED';
}

export function claimHref(id: string): string {
  return href('warrantyClaim', { claimId: id });
}

// ── Warranties → Claims ───────────────────────────────────────────────────

/** The Warranties page's tabs (`?tab=`): the warranties, and their claims. */
export type WarrantiesTab = 'warranties' | 'claims';

export function warrantiesTab(query: Record<string, string>): WarrantiesTab {
  return query.tab === 'claims' ? 'claims' : 'warranties';
}

/** The Claims tab's status filter: All, or one step (the server orders the claims under way first, then newest first). */
export function claimStatusFilter(query: Record<string, string>): WarrantyClaimStatus | undefined {
  return (WARRANTY_CLAIM_STATUSES as readonly string[]).includes(query.status ?? '') ? (query.status as WarrantyClaimStatus) : undefined;
}

/** The Warranties page's lead (plan ORBES CARE: each model chooses lifetime or 2 years). */
export const WARRANTIES_LEAD = 'Started on the purchase date, for life or for 2 years, as its model says.';
export const CLAIMS_LEAD = 'Opened by Client Services from the client’s conversation: the claims under way first, then the others, newest first.';
export const CLAIMS_EMPTY = 'No warranty claim.';
