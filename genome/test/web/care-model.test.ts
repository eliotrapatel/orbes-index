/**
 * PRIVATE CARE in a piece's tab (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6; named PRIVATE CARE by plan ORBES CARE,
 * answer 5): care-model.ts says each state in the plan's words, prefills the request's own form from the last order, and
 * for TITANE, for no tier or for a tier whose allowance is 0 says only the tier it opens from (none when no tier includes
 * it), except a request of the piece still open. The WARRANTY CLAIM (plan ORBES CARE §2(a) item 2, answer 9): every step
 * and every outcome, in the words of the claim's warranty.
 */
import { describe, expect, it } from 'vitest';
import { careFormModel, careFormProblem, careModel, claimModel } from '../../src/web/verify/care-model.js';
import { WARRANTY_CLAIM, YEARLY_CARE } from '../../src/web/verify/copy.js';
import type { CareRequestView, PieceCare, PieceClaim } from '../../src/web/verify/types.js';

const status = (over: Partial<PieceCare> = {}): PieceCare => ({ year: 2026, tier: 'PLATINE', allowance: 1, used: 0, request: null, reason: 'AVAILABLE', addressHint: null, ...over });
const request = (over: Partial<CareRequestView> = {}): CareRequestView => ({
  id: 'c0ffee00-0000-4000-8000-000000000001',
  status: 'REQUESTED',
  year: 2026,
  requestedAt: '2026-10-07T09:00:00.000Z',
  returnName: 'Camille Martin',
  returnAddress: '12 rue de la Paix\n75002 Paris',
  label: null,
  receivedAt: null,
  return: null,
  doneAt: null,
  cancelledAt: null,
  ...over,
});
const shipment = { carrier: { id: 'x', name: 'Colissimo' }, tracking: '6A12345678901', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901', at: '2026-10-08T09:00:00.000Z' };

describe('PRIVATE CARE (care-model.ts)', () => {
  it('says what the tier includes, 1 piece in the year or every piece once a year each, then REQUEST PRIVATE CARE', () => {
    expect(careModel(status())).toEqual({
      label: 'PRIVATE CARE',
      notice: null,
      block: {
        kind: 'available',
        text: 'Your PLATINE tier includes PRIVATE CARE for 1 piece in 2026: inspection, cleaning and polishing by ORBES, free of charge. ORBES Client Services sends you a prepaid label for this piece, and returns it to you at no cost.',
        action: 'REQUEST PRIVATE CARE',
      },
    });
    expect(careModel(status({ tier: 'PLATINE', allowance: 'ALL' }))!.block).toEqual({
      kind: 'available',
      text: 'Your PLATINE tier includes PRIVATE CARE for every piece, once a year each: inspection, cleaning and polishing by ORBES, free of charge. ORBES Client Services sends you a prepaid label for this piece, and returns it to you at no cost.',
      action: 'REQUEST PRIVATE CARE',
    });
    expect(careModel(status({ tier: 'PALLADIUM', allowance: 3 }))!.block).toMatchObject({ text: expect.stringMatching(/^Your PALLADIUM tier includes PRIVATE CARE for 3 pieces in 2026: /) });
  });

  it('draws no block for TITANE, for no tier, or for an allowance of 0 when no tier includes it, except a request of the piece still open', () => {
    expect(careModel(status({ tier: 'TITANE', allowance: 0, reason: 'NOT_INCLUDED' }))).toBeNull();
    expect(careModel(status({ tier: null, allowance: 0, reason: 'NOT_INCLUDED' }))).toBeNull();
    expect(careModel(status({ tier: 'PLATINE', allowance: 0, reason: 'NOT_INCLUDED' }))).toBeNull();
    expect(careModel(null)).toBeNull();
    // A done or cancelled request of a tier that dropped: nothing either.
    expect(careModel(status({ tier: 'TITANE', allowance: 0, reason: 'NOT_INCLUDED', request: request({ status: 'DONE', doneAt: '2026-10-20T09:00:00.000Z' }) }))).toBeNull();
    expect(careModel(status({ tier: 'TITANE', allowance: 0, reason: 'NOT_INCLUDED', request: request({ status: 'CANCELLED', cancelledAt: '2026-10-08T09:00:00.000Z' }) }))).toBeNull();
    // An open one keeps showing its state.
    expect(careModel(status({ tier: 'TITANE', allowance: 0, reason: 'NOT_INCLUDED', request: request() }))!.block.kind).toBe('requested');
    expect(careModel(status({ tier: null, allowance: 0, reason: 'NOT_INCLUDED', request: request({ status: 'RECEIVED' }) }))!.block.kind).toBe('received');
  });

  it('says the tier PRIVATE CARE opens from to a tier that includes none, as THE PROGRAM gives it (plan ORBES CARE §2(a) item 3)', () => {
    const titane = { tier: 'TITANE', allowance: 0, reason: 'NOT_INCLUDED' } as const;
    expect(careModel(status({ ...titane, opens: { tier: 'PLATINE', allowance: 'ALL' } }))).toEqual({
      label: 'PRIVATE CARE',
      notice: null,
      block: { kind: 'opens', text: 'PRIVATE CARE opens from PLATINE: the inspection, cleaning and polishing of every piece by ORBES, free, once a year each.' },
    });
    expect(careModel(status({ ...titane, opens: { tier: 'PLATINE', allowance: 1 } }))!.block).toEqual({
      kind: 'opens',
      text: 'PRIVATE CARE opens from PLATINE: the inspection, cleaning and polishing of 1 piece a year by ORBES, free.',
    });
    expect(careModel(status({ tier: null, allowance: 0, reason: 'NOT_INCLUDED', opens: { tier: 'PALLADIUM', allowance: 2 } }))!.block).toEqual({
      kind: 'opens',
      text: 'PRIVATE CARE opens from PALLADIUM: the inspection, cleaning and polishing of 2 pieces a year by ORBES, free.',
    });
    // Nothing when no tier includes it, or from a server before it, or for an allowance that gives none.
    for (const opens of [null, undefined, { tier: 'PLATINE', allowance: 0 }, { tier: '', allowance: 'ALL' as const }]) expect(careModel(status({ ...titane, opens })), JSON.stringify(opens)).toBeNull();
    // A done or cancelled request of the year: the tier it opens from all the same; an open request: its own state.
    const opensAll = { opens: { tier: 'PLATINE', allowance: 'ALL' as const } };
    expect(careModel(status({ ...titane, ...opensAll, request: request({ status: 'DONE', doneAt: '2026-10-20T09:00:00.000Z' }) }))!.block.kind).toBe('opens');
    expect(careModel(status({ ...titane, ...opensAll, request: request() }))!.block.kind).toBe('requested');
    // A tier that includes it reads its own block, never the line.
    expect(careModel(status({ ...opensAll }))!.block.kind).toBe('available');
  });

  it('says each step of a request in the plan\'s words', () => {
    expect(careModel(status({ used: 1, reason: 'PIECE_DONE', request: request() }))!.block).toEqual({
      kind: 'requested',
      head: 'REQUESTED · 7 OCT 2026',
      text: 'ORBES Client Services is preparing your prepaid label. It will appear here.',
      rows: [['RETURN ADDRESS', 'Camille Martin\n12 rue de la Paix\n75002 Paris']],
      action: 'CANCEL REQUEST',
      requestId: 'c0ffee00-0000-4000-8000-000000000001',
    });
    expect(careModel(status({ request: request({ status: 'LABEL_SENT', label: { ...shipment, pdf: true } }) }))!.block).toEqual({
      kind: 'label',
      head: 'YOUR PREPAID LABEL',
      text: 'Print it, pack the piece in its box and hand it to the carrier.',
      rows: [
        ['CARRIER', 'COLISSIMO'],
        ['TRACKING NUMBER', '6A12345678901'],
      ],
      download: 'DOWNLOAD LABEL',
      requestId: 'c0ffee00-0000-4000-8000-000000000001',
    });
    expect((careModel(status({ request: request({ status: 'LABEL_SENT', label: { ...shipment, pdf: false } }) }))!.block as { download: string | null }).download).toBeNull();
    expect(careModel(status({ request: request({ status: 'RECEIVED' }) }))!.block).toEqual({ kind: 'received', head: 'WITH ORBES', text: 'ORBES has received your piece.' });
    expect(careModel(status({ request: request({ status: 'RETURNING', return: shipment }) }))!.block).toEqual({
      kind: 'returning',
      head: 'ON ITS WAY BACK',
      rows: [
        ['CARRIER', 'COLISSIMO'],
        ['TRACKING NUMBER', '6A12345678901'],
      ],
      // Its accessible name says where it leads, as YOUR ORDERS' does.
      track: { text: 'TRACK THE SHIPMENT', href: shipment.trackingUrl, label: 'Track the shipment 6A12345678901 on the site of Colissimo (opens in a new tab)' },
    });
    expect(careModel(status({ used: 1, reason: 'PIECE_DONE', request: request({ status: 'DONE' }) }))!.block).toEqual({ kind: 'done', text: 'Its PRIVATE CARE for 2026 is complete. It is recorded in SERVICE HISTORY.' });
  });

  it('says a year used elsewhere, a piece already cared for, a piece that cannot be, and a cancelled request', () => {
    expect(careModel(status({ used: 1, reason: 'USED' }))!.block).toEqual({ kind: 'used', text: 'Your PRIVATE CARE for 2026 has been used for another piece. It renews on 1 January.' });
    expect(careModel(status({ tier: 'PALLADIUM', allowance: 'ALL', reason: 'PIECE_DONE' }))!.block).toEqual({ kind: 'pieceDone', text: 'This piece has had its PRIVATE CARE for 2026.' });
    expect(careModel(status({ reason: 'UNAVAILABLE' }))!.block).toEqual({ kind: 'unavailable', text: 'PRIVATE CARE cannot be requested for this piece just now.' });
    const cancelled = careModel(status({ request: request({ status: 'CANCELLED', cancelledAt: '2026-10-08T09:00:00.000Z' }) }))!;
    expect(cancelled.notice).toBe('This request was cancelled.');
    expect(cancelled.block.kind).toBe('available');
  });

  it('asks the return address in the request\'s own form, prefilled from the last order with its ash line, and says what is missing', () => {
    expect(careFormModel(status())).toEqual({
      question: 'Request PRIVATE CARE for this piece for 2026?',
      label: 'RETURN ADDRESS',
      lead: 'Where ORBES returns the piece once its care is done.',
      name: { label: 'NAME', value: '', max: 200 },
      address: { label: 'ADDRESS', value: '', max: 1000 },
      prefilled: null,
      confirm: 'CONFIRM REQUEST',
      cancel: 'CANCEL',
    });
    const hinted = careFormModel(status({ addressHint: { name: 'C. Martin', address: '1 avenue Montaigne\n75008 Paris' } }));
    expect(hinted.name.value).toBe('C. Martin');
    expect(hinted.address.value).toBe('1 avenue Montaigne\n75008 Paris');
    expect(hinted.prefilled).toBe('From your last order. Check it before you confirm.');
    expect(careFormProblem('', '12 rue de la Paix')).toBe('Enter the name and the address the piece returns to.');
    expect(careFormProblem('Camille', '  ')).toBe(YEARLY_CARE.missing);
    expect(careFormProblem('Camille', '12 rue de la Paix')).toBeNull();
  });

  it('keeps every word calm and in English: no exclamation mark, and never the atelier', () => {
    const said = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => string)('PLATINE', 1, 2026))] : v && typeof v === 'object' ? Object.values(v).flatMap(said) : [];
    const words = [...said(YEARLY_CARE), ...said(WARRANTY_CLAIM)];
    expect(words.length).toBeGreaterThan(50);
    for (const w of words) {
      expect(w).not.toContain('!');
      expect(w).not.toMatch(/atelier|handmade|stolen/i);
    }
  });
});

describe('WARRANTY CLAIM (care-model.ts claimModel; plan ORBES CARE §2(a) item 2, answer 9)', () => {
  const ID = 'c1a1m000-0000-4000-8000-000000000001';
  const claim = (over: Partial<PieceClaim> = {}): PieceClaim => ({
    id: ID,
    status: 'OPEN',
    basis: 'LIFETIME',
    openedAt: '2026-10-10T09:00:00.000Z',
    label: null,
    receivedAt: null,
    outcome: null,
    refusalReason: null,
    credit: null,
    value: null,
    decidedAt: null,
    return: null,
    doneAt: null,
    cancelledAt: null,
    ...over,
  });
  const base = { label: 'WARRANTY CLAIM', claimId: ID, head: null, rows: [], download: null, track: null };
  const rows = [
    ['CARRIER', 'COLISSIMO'],
    ['TRACKING NUMBER', '6A12345678901'],
  ];
  const track = { text: 'TRACK THE SHIPMENT', href: shipment.trackingUrl, label: 'Track the shipment 6A12345678901 on the site of Colissimo (opens in a new tab)' };
  const received = { receivedAt: '2026-10-12T09:00:00.000Z' };
  const credit = (amountMinor: number) => ({ credit: { amountMinor, currency: 'EUR', expiresAt: '2027-10-15T09:00:00.000Z' } });
  const decided = (outcome: PieceClaim['outcome'], over: Partial<PieceClaim> = {}) => claim({ status: 'DECIDED', ...received, outcome, decidedAt: '2026-10-15T09:00:00.000Z', ...over });
  const done = (outcome: PieceClaim['outcome'], over: Partial<PieceClaim> = {}) => decided(outcome, { status: 'DONE', return: shipment, doneAt: '2026-10-16T09:00:00.000Z', ...over });

  it('draws nothing without a claim, or with one the app cannot read', () => {
    expect(claimModel(null)).toBeNull();
    expect(claimModel(undefined)).toBeNull();
    expect(claimModel(claim({ basis: 'OTHER' as 'LIFETIME' }))).toBeNull();
    expect(claimModel(claim({ status: 'LOST' as 'OPEN' }))).toBeNull();
    expect(claimModel(decided('UNKNOWN' as 'REFUSED'))).toBeNull();
  });

  it('says each step before the decision: the label to come, YOUR PREPAID LABEL with DOWNLOAD LABEL, WITH ORBES, and a claim closed', () => {
    expect(claimModel(claim())).toEqual({ ...base, texts: ['ORBES Client Services is preparing your prepaid label. It will appear here.'] });
    expect(claimModel(claim({ status: 'LABEL_SENT', label: { ...shipment, pdf: true } }))).toEqual({
      ...base,
      head: 'YOUR PREPAID LABEL',
      texts: ['Print it, pack the piece in its box and hand it to the carrier. ORBES answers once it has received the piece.'],
      rows,
      download: 'DOWNLOAD LABEL',
    });
    // The label's PDF erased: its rows, and nothing to download.
    expect(claimModel(claim({ status: 'LABEL_SENT', label: { ...shipment, pdf: false } }))!.download).toBeNull();
    expect(claimModel(claim({ status: 'RECEIVED', ...received }))).toEqual({ ...base, head: 'WITH ORBES', texts: ['ORBES has received your piece and is examining it.'] });
    expect(claimModel(claim({ status: 'CANCELLED', cancelledAt: '2026-10-11T09:00:00.000Z' }))).toEqual({ ...base, texts: ['This claim was closed.'] });
  });

  it('says the lifetime warranty\'s outcomes: the same piece new, then REPLACED with its shipment; a credit of its value; the 30 % credit, the piece returned then on its way', () => {
    expect(claimModel(decided('REPLACEMENT'))).toEqual({ ...base, texts: ['Your new piece is being prepared. Its shipment will appear here.'] });
    expect(claimModel(done('REPLACEMENT'))).toEqual({ ...base, head: 'REPLACED', texts: ['Your new piece is on its way. Register it with the certificate card in its box.'], rows, track });
    expect(claimModel(decided('VALUE_CREDIT', { status: 'DONE', doneAt: '2026-10-15T09:00:00.000Z', ...credit(45_000) }))).toEqual({
      ...base,
      texts: ['This model is no longer made: a credit of €\u00a0450 toward a new piece is in your account until 15 OCT 2027.'],
    });
    expect(claimModel(decided('PART_CREDIT', credit(13_500)))).toEqual({
      ...base,
      texts: ['A credit of €\u00a0135 toward a new piece is in your account until 15 OCT 2027.', 'Your piece is returned to you.'],
    });
    expect(claimModel(done('PART_CREDIT', credit(13_500)))).toEqual({
      ...base,
      texts: ['A credit of €\u00a0135 toward a new piece is in your account until 15 OCT 2027.', 'Your piece is on its way back.'],
      rows,
      track,
    });
  });

  it('says a repair in the words of its warranty: the 2-year warranty, or the legal guarantee', () => {
    expect(claimModel(decided('REPAIR', { basis: 'TWO_YEARS' }))).toEqual({ ...base, texts: ['Your piece has been repaired under the ORBES warranty.'] });
    expect(claimModel(done('REPAIR', { basis: 'TWO_YEARS' }))).toEqual({ ...base, texts: ['Your piece has been repaired under the ORBES warranty. It is on its way back.'], rows, track });
    expect(claimModel(done('REPAIR', { basis: 'LEGAL' }))).toEqual({ ...base, texts: ['Your piece has been repaired under the legal guarantee. It is on its way back.'], rows, track });
    // The 2-year warranty's replacement reads as the lifetime warranty's.
    expect(claimModel(done('REPLACEMENT', { basis: 'TWO_YEARS' }))!.head).toBe('REPLACED');
  });

  it('says the legal guarantee\'s money remedies: a price reduction, then the piece on its way; a refund at once', () => {
    const value = (amountMinor: number) => ({ value: { amountMinor, currency: 'EUR' } });
    expect(claimModel(decided('PRICE_REDUCTION', { basis: 'LEGAL', ...value(9_000) }))).toEqual({
      ...base,
      texts: ['Under the legal guarantee, the price of your piece is reduced by €\u00a090: the seller pays it back to you.'],
    });
    expect(claimModel(done('PRICE_REDUCTION', { basis: 'LEGAL', ...value(9_000) }))).toEqual({
      ...base,
      texts: ['Under the legal guarantee, the price of your piece is reduced by €\u00a090: the seller pays it back to you.', 'Your piece is on its way back.'],
      rows,
      track,
    });
    expect(claimModel(decided('REFUND', { basis: 'LEGAL', status: 'DONE', doneAt: '2026-10-15T09:00:00.000Z', ...value(45_000) }))).toEqual({
      ...base,
      texts: ['Under the legal guarantee, your piece is refunded, €\u00a0450: the seller pays it back to you (for an ORBES order, with its credit note in ORDERS).'],
    });
  });

  it('says a refusal with its reason, in the words of its warranty; once received, the piece returned then on its way', () => {
    const reasons = {
      LOST: 'the piece is lost',
      THEFT_REPORTED: 'its theft is reported',
      SCRATCHED: 'it is scratched',
      DAMAGED_ON_PURPOSE: 'it was damaged on purpose',
      DAMAGED_BY_SOMEONE_ELSE: 'it was damaged by someone else',
      ALTERED_OUTSIDE_ORBES: 'it was altered or repaired outside ORBES',
      WARRANTY_ENDED: 'its warranty has ended',
      WARRANTY_VOID: 'its warranty no longer applies',
    } as const;
    for (const [reason, words] of Object.entries(reasons)) {
      // Refused before the piece was sent (a case that needs no piece): the reason alone.
      const before = claim({ status: 'DONE', outcome: 'REFUSED', refusalReason: reason as PieceClaim['refusalReason'], decidedAt: '2026-10-11T09:00:00.000Z', doneAt: '2026-10-11T09:00:00.000Z' });
      expect(claimModel(before), reason).toEqual({ ...base, texts: [`Not covered by the warranty: ${words}.`] });
    }
    expect(claimModel(decided('REFUSED', { refusalReason: 'NO_FAULT_FOUND' }))).toEqual({
      ...base,
      texts: ['Not covered by the warranty: it shows no tarnish, fading or accidental break.', 'Your piece is returned to you.'],
    });
    expect(claimModel(done('REFUSED', { basis: 'TWO_YEARS', refusalReason: 'NO_FAULT_FOUND' }))).toEqual({
      ...base,
      texts: ['Not covered by the warranty: it shows no manufacturing defect.', 'Your piece is on its way back.'],
      rows,
      track,
    });
    expect(claimModel(done('REFUSED', { basis: 'LEGAL', refusalReason: 'NO_FAULT_FOUND' }))!.texts).toEqual(['Not covered by the legal guarantee: it shows no lack of conformity.', 'Your piece is on its way back.']);
    expect(claimModel(done('REFUSED', { basis: 'LEGAL', refusalReason: 'DAMAGED_ON_PURPOSE' }))!.texts[0]).toBe('Not covered by the legal guarantee: it was damaged on purpose.');
  });

  it('offers nothing that starts or feeds a claim: DOWNLOAD LABEL and TRACK THE SHIPMENT only', () => {
    const words = JSON.stringify(WARRANTY_CLAIM);
    expect(words).not.toMatch(/photo|upload|form\b|START|SUBMIT|SEND/i);
    // A tracking link that is not https: the rows, no link.
    expect(claimModel(done('REPLACEMENT', { return: { ...shipment, trackingUrl: 'http://example.com/t' } }))!.track).toBeNull();
  });
});
