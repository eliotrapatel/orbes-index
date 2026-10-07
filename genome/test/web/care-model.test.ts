/**
 * YEARLY CARE in a piece's SERVICE tab (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6): care-model.ts says each state in
 * the plan's words, prefills the request's own form from the last order, and draws no block for TITANE, for no tier or
 * for a tier whose allowance is 0, except a request of the piece still open.
 */
import { describe, expect, it } from 'vitest';
import { careFormModel, careFormProblem, careModel } from '../../src/web/verify/care-model.js';
import { YEARLY_CARE } from '../../src/web/verify/copy.js';
import type { CareRequestView, PieceCare } from '../../src/web/verify/types.js';

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

describe('YEARLY CARE (care-model.ts)', () => {
  it('says what the tier includes, 1 piece for PLATINE and every piece for PALLADIUM, then REQUEST YEARLY CARE', () => {
    expect(careModel(status())).toEqual({
      label: 'YEARLY CARE',
      notice: null,
      block: {
        kind: 'available',
        text: 'Your PLATINE tier includes the yearly care of 1 piece in 2026: inspection, cleaning and polishing by the ORBES atelier. ORBES Client Services sends you a prepaid label for this piece, and returns it to you at no cost.',
        action: 'REQUEST YEARLY CARE',
      },
    });
    expect(careModel(status({ tier: 'PALLADIUM', allowance: 'ALL' }))!.block).toMatchObject({ text: expect.stringMatching(/^Your PALLADIUM tier includes the yearly care of every piece in 2026: /) });
    expect(careModel(status({ tier: 'PALLADIUM', allowance: 3 }))!.block).toMatchObject({ text: expect.stringMatching(/the yearly care of 3 pieces in 2026/) });
  });

  it('draws no block for TITANE, for no tier, or for an allowance of 0, except a request of the piece still open', () => {
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
    expect(careModel(status({ request: request({ status: 'RECEIVED' }) }))!.block).toEqual({ kind: 'received', head: 'AT THE ATELIER', text: 'The ORBES atelier has received your piece.' });
    expect(careModel(status({ request: request({ status: 'RETURNING', return: shipment }) }))!.block).toEqual({
      kind: 'returning',
      head: 'ON ITS WAY BACK',
      rows: [
        ['CARRIER', 'COLISSIMO'],
        ['TRACKING NUMBER', '6A12345678901'],
      ],
      track: { text: 'TRACK THE SHIPMENT', href: shipment.trackingUrl },
    });
    expect(careModel(status({ used: 1, reason: 'PIECE_DONE', request: request({ status: 'DONE' }) }))!.block).toEqual({ kind: 'done', text: 'Its yearly care for 2026 is complete. It is recorded in SERVICE HISTORY.' });
  });

  it('says a year used elsewhere, a piece already cared for, a piece that cannot be, and a cancelled request', () => {
    expect(careModel(status({ used: 1, reason: 'USED' }))!.block).toEqual({ kind: 'used', text: 'Your yearly care for 2026 has been used for another piece. It renews on 1 January.' });
    expect(careModel(status({ tier: 'PALLADIUM', allowance: 'ALL', reason: 'PIECE_DONE' }))!.block).toEqual({ kind: 'pieceDone', text: 'This piece has had its yearly care for 2026.' });
    expect(careModel(status({ reason: 'UNAVAILABLE' }))!.block).toEqual({ kind: 'unavailable', text: 'The yearly care cannot be requested for this piece just now.' });
    const cancelled = careModel(status({ request: request({ status: 'CANCELLED', cancelledAt: '2026-10-08T09:00:00.000Z' }) }))!;
    expect(cancelled.notice).toBe('This request was cancelled.');
    expect(cancelled.block.kind).toBe('available');
  });

  it('asks the return address in the request\'s own form, prefilled from the last order with its ash line, and says what is missing', () => {
    expect(careFormModel(status())).toEqual({
      question: 'Request the yearly care of this piece for 2026?',
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

  it('keeps every word calm and in English: no exclamation mark', () => {
    const words = Object.values(YEARLY_CARE).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => string)('PLATINE', 1, 2026))] : []));
    for (const w of words) expect(w).not.toContain('!');
  });
});
