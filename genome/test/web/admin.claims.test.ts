/**
 * The console's warranty claims (plan ORBES CARE of 2026-10-15, §2(b), step 3.2): their pure parts (model/claims.ts).
 * Each step's and each basis's words; the outcomes and the refusal reasons in words per basis (lifetime: every reason but
 * Warranty ended; 2 years: its five; legal guarantee: its three, answer 10 and D1), the same lists as the server's; what
 * an OPERATOR may do at each step (answer 11: Client Services decide every outcome, an AUDITOR nothing), MOVE TO THE
 * LEGAL GUARANTEE on a received 2-year claim within the legal guarantee only; the amount asked when no value is found;
 * Open a warranty claim's pieces and choices; the piece page's Free replacement row; the Claims tab's filter; and, at
 * compile time, the console's shapes against what the server sends.
 */
import { describe, expect, it } from 'vitest';
import * as serverSchema from '../../src/server/db/schema.js';
import { partCredit as serverPartCredit, type ClaimBoardRow as ServerClaimBoardRow, type ClaimSheet as ServerClaimSheet, type PieceClaims as ServerPieceClaims } from '../../src/server/services/warranty-claims.js';
import {
  amountAsked,
  CLAIM_ACTION_LABELS,
  CLAIM_BASIS_LABELS,
  CLAIM_BASIS_SHORT,
  CLAIM_STATUS_LABELS,
  claimActions,
  claimablePieces,
  claimHref,
  claimStatusFilter,
  claimValueText,
  decisionBasisLine,
  decisionChoices,
  decisionNote,
  decisionText,
  discontinuedText,
  freeReplacementRow,
  legalOpen,
  openBasisOptions,
  outcomeChoice,
  outcomeText,
  partCreditMinor,
  refusalOptions,
  refusalText,
  warrantiesTab,
  warrantyKindText,
  warrantyRefusal,
} from '../../src/web/admin/model/claims.js';
import { CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { parseHash } from '../../src/web/admin/router.js';
import type * as web from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
// Compile-time: the console's claim shapes are what the server sends.
export const claimRowFits = (r: Json<ServerClaimBoardRow>): web.ClaimBoardRow => r;
export const claimSheetFits = (s: Json<ServerClaimSheet>): web.ClaimSheet => s;
export const pieceClaimsFits = (c: Json<Omit<ServerPieceClaims, 'serviceIds'>>): web.PieceClaims => c;

const sheet = (over: Partial<web.ClaimSheet> = {}): Pick<web.ClaimSheet, 'status' | 'basis' | 'legalUntil' | 'decision'> => ({
  status: 'RECEIVED',
  basis: 'LIFETIME',
  legalUntil: '2028-03-01',
  decision: { outcomes: ['REPLACEMENT', 'VALUE_CREDIT', 'REFUSED'], refusalReasons: [], value: { amountMinor: 45_000, currency: 'EUR' }, paid: null, creditPercent: 30 },
  ...over,
});

describe('the warranty claims in the console (plan ORBES CARE, step 3.2)', () => {
  it('words every step and every basis, the steps toned as the PRIVATE CARE board’s', () => {
    expect(Object.keys(CLAIM_STATUS_LABELS)).toEqual([...serverSchema.WARRANTY_CLAIM_STATUSES]);
    expect(Object.values(CLAIM_STATUS_LABELS)).toEqual(['Open', 'Label sent', 'With ORBES', 'Decided', 'Done', 'Closed']);
    expect(serverSchema.WARRANTY_CLAIM_STATUSES.map((s) => toneOf('claim', s))).toEqual(['alert', 'outline', 'alert', 'alert', 'solid', 'muted']);
    expect(Object.keys(CLAIM_BASIS_LABELS)).toEqual([...serverSchema.WARRANTY_CLAIM_BASES]);
    expect(Object.values(CLAIM_BASIS_LABELS)).toEqual(['Lifetime warranty', '2-year warranty', 'Legal guarantee']);
    expect(Object.values(CLAIM_BASIS_SHORT)).toEqual(['Lifetime', '2 years', 'Legal guarantee']);
  });

  it('offers each basis’s outcomes and refusal reasons in words, the server’s lists (answer 10, D1)', () => {
    expect(serverSchema.WARRANTY_CLAIM_OUTCOMES.map((o) => outcomeChoice(o, 30))).toEqual([
      'Replace with the same piece, new',
      'Credit of its value (model no longer made)',
      '30 % credit',
      'Repaired',
      'Price reduction',
      'Refund',
      'Refuse',
    ]);
    expect(outcomeChoice('PART_CREDIT', 25)).toBe('25 % credit');
    expect(serverSchema.WARRANTY_CLAIM_OUTCOMES.map((o) => outcomeText(o, 30))).toEqual(['Replaced', 'Credit of its value', '30 % credit', 'Repaired', 'Price reduction', 'Refunded', 'Refused']);
    expect(outcomeText(null)).toBe('—');
    expect(outcomeText('PART_CREDIT')).toBe('Part credit');
    const words = (b: web.WarrantyClaimBasis) => refusalOptions(b, serverSchema.WARRANTY_CLAIM_REFUSALS_BY_BASIS[b]).map((o) => o.label);
    // Lifetime: every reason but Warranty ended (it never ends).
    expect(words('LIFETIME')).toEqual([
      'Lost',
      'Theft reported',
      'Scratched',
      'Damaged on purpose',
      'Damaged by someone else',
      'Altered or repaired outside ORBES',
      'No tarnish, fading or accidental break',
      'Warranty no longer valid',
    ]);
    // 2 years: manufacturing defects only, its five reasons.
    expect(words('TWO_YEARS')).toEqual(['Lost', 'Theft reported', 'No manufacturing defect', 'Warranty ended', 'Warranty no longer valid']);
    // The legal guarantee: its three.
    expect(words('LEGAL')).toEqual(['Damaged on purpose', 'Damaged by someone else', 'No lack of conformity']);
    expect(refusalText('TWO_YEARS', 'NO_FAULT_FOUND')).toBe('No manufacturing defect');
    // Never "stolen" (the BRAND lexicon), even for staff.
    for (const b of serverSchema.WARRANTY_CLAIM_BASES) for (const r of serverSchema.WARRANTY_CLAIM_REFUSALS) expect(refusalText(b, r)).not.toMatch(/stolen|atelier/i);
  });

  it('the decision dialog offers the server’s outcomes, never the credit of the piece’s value for a model still made (answer 4)', () => {
    const gone = { ...sheet(), modelDiscontinued: true };
    expect(decisionChoices(gone)).toEqual([
      { value: 'REPLACEMENT', label: 'Replace with the same piece, new' },
      { value: 'VALUE_CREDIT', label: 'Credit of its value (model no longer made)' },
      { value: 'REFUSED', label: 'Refuse' },
    ]);
    const made = { ...sheet(), modelDiscontinued: false };
    expect(decisionChoices(made).map((c) => c.value)).toEqual(['REPLACEMENT', 'REFUSED']);
    expect(decisionChoices({ ...made, decision: { ...made.decision, outcomes: ['PART_CREDIT', 'REFUSED'] } })).toEqual([
      { value: 'PART_CREDIT', label: '30 % credit' },
      { value: 'REFUSED', label: 'Refuse' },
    ]);
  });

  it('offers an OPERATOR each step in turn (answer 11), MOVE TO THE LEGAL GUARANTEE on a received 2-year claim within it; an AUDITOR nothing', () => {
    expect(CAPABILITY_MIN_ROLE.handleClaims).toBe('OPERATOR');
    const today = '2026-10-15';
    expect(claimActions(sheet({ status: 'OPEN' }), 'OPERATOR', today)).toEqual(['label', 'refuse', 'close']);
    expect(claimActions(sheet({ status: 'LABEL_SENT' }), 'OPERATOR', today)).toEqual(['receive', 'close']);
    expect(claimActions(sheet({ status: 'RECEIVED' }), 'OPERATOR', today)).toEqual(['decide']);
    expect(claimActions(sheet({ status: 'RECEIVED', basis: 'TWO_YEARS' }), 'OPERATOR', today)).toEqual(['decide', 'legal']);
    expect(claimActions(sheet({ status: 'RECEIVED', basis: 'TWO_YEARS', legalUntil: '2026-10-14' }), 'OPERATOR', today)).toEqual(['decide']);
    expect(claimActions(sheet({ status: 'RECEIVED', basis: 'TWO_YEARS', legalUntil: null }), 'OPERATOR', today)).toEqual(['decide']);
    expect(claimActions(sheet({ status: 'RECEIVED', basis: 'LEGAL' }), 'OPERATOR', today)).toEqual(['decide']);
    expect(claimActions(sheet({ status: 'DECIDED' }), 'ADMIN', today)).toEqual(['ship']);
    expect(claimActions(sheet({ status: 'DONE' }), 'OPERATOR', today)).toEqual([]);
    expect(claimActions(sheet({ status: 'CANCELLED' }), 'OPERATOR', today)).toEqual([]);
    for (const status of serverSchema.WARRANTY_CLAIM_STATUSES) expect(claimActions(sheet({ status }), 'AUDITOR', today), status).toEqual([]);
    expect(Object.values(CLAIM_ACTION_LABELS)).toEqual(['Send label', 'Refuse', 'Close', 'Received', 'Decide', 'Move to the legal guarantee', 'Ship']);
    expect(legalOpen('2026-10-15', today)).toBe(true);
    expect(legalOpen('2026-10-14', today)).toBe(false);
  });

  it('asks an amount only when none is found (a credit: the piece’s value; a refund: the price paid), a price reduction always; says what each decision gives', () => {
    const known = sheet();
    const none = sheet({ decision: { ...known.decision, value: null, paid: null } });
    for (const o of ['VALUE_CREDIT', 'PART_CREDIT']) {
      expect(amountAsked(o, known.decision), o).toBe(false);
      expect(amountAsked(o, none.decision), o).toBe(true);
    }
    // A refund comes from the price paid, not the model's price: a boutique sale's is entered.
    expect(amountAsked('REFUND', known.decision)).toBe(true);
    expect(amountAsked('REFUND', { value: null, paid: { amountMinor: 45_000, currency: 'GBP' } })).toBe(false);
    expect(amountAsked('PRICE_REDUCTION', { value: known.decision.value, paid: known.decision.value })).toBe(true);
    for (const o of ['REPLACEMENT', 'REPAIR', 'REFUSED', undefined]) expect(amountAsked(o, none.decision), String(o)).toBe(false);
    expect(claimValueText(known.decision.value)).toBe('€ 450');
    expect(claimValueText(null)).toBe('None found: enter it, in THE PROGRAM’s credit currency');
    expect(decisionBasisLine(known.decision, 'PART_CREDIT')).toBe('Value of the piece: € 450.');
    expect(decisionBasisLine(known.decision, 'REFUND')).toBe('No price paid is recorded (a boutique sale): enter it, in THE PROGRAM’s credit currency.');
    expect(decisionBasisLine(none.decision, 'VALUE_CREDIT')).toBe('No value is found for this piece: enter it, in THE PROGRAM’s credit currency.');
    expect(decisionBasisLine({ value: null, paid: { amountMinor: 45_000, currency: 'GBP' } }, 'REFUND')).toBe('Price paid: £ 450.');
    expect(decisionBasisLine(known.decision, 'REPAIR')).toBeNull();
    // The part credit, as the server computes it.
    expect(partCreditMinor(45_000, 30)).toBe(serverPartCredit(45_000, 30));
    expect(partCreditMinor(33_333, 30)).toBe(serverPartCredit(33_333, 30));
    expect(decisionNote(known, 'PART_CREDIT')).toBe('A credit of € 135 (30 % of € 450), valid 12 months. The piece returns to the client.');
    expect(decisionNote(known, 'VALUE_CREDIT')).toContain('A credit of € 450 toward a new piece, valid 12 months.');
    expect(decisionNote(known, 'REFUND')).toContain('revoked as REFUNDED');
    expect(decisionNote(known, 'REPLACEMENT')).toContain('of the same SKU');
    expect(decisionNote(known, undefined)).toBeNull();
    const decided: Parameters<typeof decisionText>[0] = {
      basis: 'TWO_YEARS',
      outcome: 'REFUSED',
      refusalReason: 'NO_FAULT_FOUND',
      creditPercent: null,
      grant: null,
      value: null,
      replacement: null,
      otherSize: false,
    };
    expect(decisionText(decided)).toBe('Refused · No manufacturing defect');
    expect(decisionText({ ...decided, basis: 'LIFETIME', outcome: 'PART_CREDIT', refusalReason: null, creditPercent: 30, grant: { id: 'g', amountMinor: 13_500, currency: 'EUR', expiresAt: '2027-10-15T09:00:00.000Z' } })).toBe(
      '30 % credit · € 135 until 15 OCT 2027',
    );
    expect(decisionText({ ...decided, basis: 'LIFETIME', outcome: 'REPLACEMENT', refusalReason: null, replacement: { productId: 'O26-J-00201' }, otherSize: true })).toBe('Replaced · by O26-J-00201, another size');
    expect(decisionText({ ...decided, basis: 'LEGAL', outcome: 'REFUND', refusalReason: null, value: { amountMinor: 45_000, currency: 'EUR' } })).toBe('Refunded · € 450');
    expect(decisionText({ ...decided, outcome: null, refusalReason: null })).toBe('—');
  });

  it('names a piece’s warranty in Open a warranty claim as the server records it, and offers the ORBES warranty to the registered owner only', () => {
    expect(warrantyKindText(true)).toBe('Lifetime warranty');
    expect(warrantyKindText(false)).toBe('2-year warranty (defects only)');
    expect(discontinuedText({ lifetime: true, modelDiscontinued: false })).toBeNull();
    expect(discontinuedText({ lifetime: true, modelDiscontinued: true })).toBe('This model is no longer made.');
    expect(discontinuedText({ lifetime: false, modelDiscontinued: true })).toBe('This model is no longer made: a replacement is not possible. If it cannot be repaired, choose Legal guarantee.');
    expect(warrantyRefusal(true)).toBeNull();
    expect(warrantyRefusal(false)).toMatch(/^Only the registered owner/);
    expect(openBasisOptions(true, '2028-03-01', '2026-10-15')).toEqual([
      { value: 'WARRANTY', label: 'ORBES warranty' },
      { value: 'LEGAL', label: 'Legal guarantee, until 01 MAR 2028' },
    ]);
    expect(openBasisOptions(false, '2026-03-01', '2026-10-15')).toEqual([
      { value: 'WARRANTY', label: 'ORBES warranty', disabled: true },
      { value: 'LEGAL', label: 'Legal guarantee, until 01 MAR 2026', disabled: true },
    ]);
    expect(openBasisOptions(true, null, '2026-10-15')[1]).toEqual({ value: 'LEGAL', label: 'Legal guarantee', disabled: true });
    // The pieces: registered to the client now, then those of its orders standing, each once.
    const pieces = [
      { productId: 'O26-J-00184', model: 'MONOLITHE', until: null },
      { productId: 'O26-J-00100', model: 'ECLIPSE', until: '2026-05-01T00:00:00.000Z' },
      { productId: 'O26-J-00090', model: 'ECLIPSE', until: null },
    ];
    const orders = [
      { reference: 'OR-1A2B3C4D', status: 'DELIVERED', piece: 'O26-J-00184', model: { name: 'MONOLITHE' } },
      { reference: 'OR-2B3C4D5E', status: 'DELIVERED', piece: 'O26-J-00200', model: { name: 'ECLIPSE' } },
      { reference: 'OR-3C4D5E6F', status: 'CANCELLED', piece: 'O26-J-00300', model: { name: 'ECLIPSE' } },
      { reference: 'OR-4D5E6F7A', status: 'RESERVED', piece: null, model: { name: 'ECLIPSE' } },
    ];
    expect(claimablePieces(pieces, orders)).toEqual([
      { productId: 'O26-J-00090', label: 'O26-J-00090 · ECLIPSE' },
      { productId: 'O26-J-00184', label: 'O26-J-00184 · MONOLITHE' },
      { productId: 'O26-J-00200', label: 'O26-J-00200 · ECLIPSE · order OR-2B3C4D5E' },
    ]);
    expect(claimablePieces([], [])).toEqual([]);
  });

  it('reads the piece page’s Free replacement row, the Claims tab and the claim’s route', () => {
    expect(freeReplacementRow({ freeReplacement: null })).toBeNull();
    expect(freeReplacementRow({ freeReplacement: { available: true } })).toEqual({ value: 'Available', claimId: null });
    expect(freeReplacementRow({ freeReplacement: { available: false, claimId: 'c1', decidedAt: '2026-11-03T10:00:00.000Z' } })).toEqual({ value: 'Used · 03 NOV 2026', claimId: 'c1' });
    expect(warrantiesTab({})).toBe('warranties');
    expect(warrantiesTab({ tab: 'claims' })).toBe('claims');
    expect(warrantiesTab({ tab: 'nope' })).toBe('warranties');
    expect(claimStatusFilter({ status: 'RECEIVED' })).toBe('RECEIVED');
    expect(claimStatusFilter({ status: 'NOPE' })).toBeUndefined();
    expect(claimStatusFilter({})).toBeUndefined();
    const id = '5b0a7c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(claimHref(id)).toBe(`#/warranty-claims/${id}`);
    expect(parseHash(claimHref(id))).toMatchObject({ name: 'warrantyClaim', params: { claimId: id } });
  });
});
