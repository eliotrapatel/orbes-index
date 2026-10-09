/**
 * Logistics in the console (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.4.1; steps 5.11a to 5.11c) — the pure models
 * and the API client: model/logistics.ts against the server's rules (its bounds mirrored and compared), the tabs and
 * their counters, the Location filter, a size's words and marks, To ship and a parcel (its steps, its checklist, the
 * agent's packing slip), the dialogs' checks and what they send, what each role may do; AdminApi's Logistics paths, methods and bodies.
 */
import { describe, expect, it } from 'vitest';
import { LOGISTICS_LIMITS as SERVER_LOGISTICS_LIMITS } from '../../src/server/services/logistics.js';
import { ORDER_CASE_LIMITS } from '../../src/server/services/order-cases.js';
import { PACKING_PHOTO_MAX_BYTES, PARCEL_HISTORY_ACTIONS } from '../../src/server/services/parcels.js';
import { RECEPTION_LIMITS as SERVER_RECEPTION_LIMITS, RECEPTION_RUNS } from '../../src/server/services/receptions.js';
import { PHOTO_MAX_BYTES } from '../../src/web/admin/model/photo.js';
import { STOCK_MOVE_MAX, STOCK_NOTE_MAX } from '../../src/server/services/stock.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  approveText,
  CASE_KIND_LABELS,
  casePieces,
  CORRECTION_STATUS_LABELS,
  correctionInput,
  correctionProblem,
  countInProblem,
  countInText,
  deltaText,
  LOGISTICS_LIMITS,
  LOGISTICS_TABS,
  locationFilter,
  logisticsTab,
  minimumProblem,
  minimumValue,
  noPieceMark,
  offersLocationFilter,
  receiveProblem,
  serialsOf,
  sizeText,
  skuWords,
  tabText,
  transferProblem,
  unbackedNotice,
} from '../../src/web/admin/model/logistics.js';
import {
  checklistComplete,
  HISTORY_BY,
  HISTORY_LABELS,
  othersText,
  PACKING_PHOTO_MAX_SIDE,
  PARCEL_STEP_LABELS,
  parcelActions,
  pieceWords,
  reportProblem,
  scanMessage,
  shippingSlip,
  shipProblem,
  shipToLine,
} from '../../src/web/admin/model/logistics.js';
import {
  cardsLine,
  confirmReceptionText,
  expectedEmpty,
  expectedLead,
  issuingLine,
  RECEPTION_LIMITS,
  receptionInputOf,
  receptionProblem,
  receptionSummary,
  referenceProblem,
  runLabel,
  skippedLine,
  supplierReturnLine,
  supplierReturnProblem,
} from '../../src/web/admin/model/logistics.js';
import { can, logisticsOnly } from '../../src/web/admin/model/permissions.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import { ADMIN_ROLES, ORDER_CASE_KINDS, SHIPMENT_STATUSES, STOCK_CORRECTION_STATUSES, type LogisticsSku, type ShippingOrderView } from '../../src/web/admin/types.js';

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const LOC = '1f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER = '2f0e0d0c-0b0a-4908-8706-050403020100';
const SKU: LogisticsSku = { id: ID, code: 'MNL-BLU-52', model: { id: ID, name: 'MONOLITHE' }, variant: 'BLUE', sizeLabel: '52', setAside: false };

describe('the mirrors of the server', () => {
  it('holds the server\'s bounds of a correction, a minimum, a count in and a parcel back', () => {
    expect(LOGISTICS_LIMITS.move).toBe(STOCK_MOVE_MAX);
    expect(LOGISTICS_LIMITS.note).toBe(STOCK_NOTE_MAX);
    expect(LOGISTICS_LIMITS.reason).toBe(SERVER_LOGISTICS_LIMITS.reason);
    expect(LOGISTICS_LIMITS.minimum).toBe(SERVER_LOGISTICS_LIMITS.minimum);
    expect(LOGISTICS_LIMITS.countIn).toBe(SERVER_LOGISTICS_LIMITS.countIn);
    expect(LOGISTICS_LIMITS.receiveNote).toBe(ORDER_CASE_LIMITS.receiveNote);
  });

  it('names every kind of order case and every correction\'s status', () => {
    expect(Object.keys(CASE_KIND_LABELS).sort()).toEqual([...ORDER_CASE_KINDS].sort());
    expect(CASE_KIND_LABELS.EXCHANGE).toBe('SIZE EXCHANGE');
    expect(CASE_KIND_LABELS.BACK_TO_SENDER).toBe('BACK TO SENDER');
    expect(Object.keys(CORRECTION_STATUS_LABELS).sort()).toEqual([...STOCK_CORRECTION_STATUSES].sort());
    expect(CORRECTION_STATUS_LABELS.TO_APPROVE).toBe('TO APPROVE');
  });
});

describe('the page', () => {
  it('reads its tab from the query, the first one otherwise; the counters apart from the words', () => {
    // To ship first: the agent's daily work (Default (mine), §5.1).
    expect(LOGISTICS_TABS.map((t) => t.id)).toEqual(['ship', 'receptions', 'stock', 'returns', 'corrections']);
    expect(logisticsTab({})).toBe('ship');
    expect(logisticsTab({ tab: 'corrections' })).toBe('corrections');
    expect(logisticsTab({ tab: 'atelier' })).toBe('ship');
    expect(tabText('ship', { ship: 3 })).toEqual(['To ship', '(3)']);
    expect(tabText('returns', { returns: 2, corrections: 0 })).toEqual(['Returns', '(2)']);
    expect(tabText('corrections', { returns: 2, corrections: 0 })).toEqual(['Corrections', '(0)']);
    // Stock has no counter.
    expect(tabText('stock', { returns: 2 })).toEqual(['Stock', null]);
  });

  it('keeps the Location filter to the scope\'s locations, offered when there are several', () => {
    const locations = [
      { id: LOC, name: 'LOGISTICS WAREHOUSE', isDefault: true },
      { id: OTHER, name: 'FRANCE WAREHOUSE', isDefault: false },
    ];
    expect(locationFilter({ locationId: LOC.toUpperCase() }, locations)).toBe(LOC);
    expect(locationFilter({ locationId: ID }, locations)).toBeUndefined();
    expect(locationFilter({ locationId: 'x' }, locations)).toBeUndefined();
    expect(offersLocationFilter(locations)).toBe(true);
    expect(offersLocationFilter(locations.slice(0, 1))).toBe(false);
  });

  it('routes Logistics and its tabs', () => {
    expect(parseHash('#/logistics?tab=corrections')).toMatchObject({ name: 'logistics', query: { tab: 'corrections' } });
    expect(href('logistics', {}, { tab: 'returns', locationId: LOC })).toBe(`#/logistics?tab=returns&locationId=${LOC}`);
  });
});

describe('a size and its marks', () => {
  it('names a size by its model, variant and size; ONE SIZE for a model of one size', () => {
    expect(skuWords(SKU)).toBe('MONOLITHE · BLUE · 52');
    expect(skuWords({ ...SKU, variant: null, sizeLabel: null })).toBe('MONOLITHE · ONE SIZE');
    expect(skuWords({ model: 'MONOLITHE', variant: 'BLUE', sizeLabel: '52' })).toBe('MONOLITHE · BLUE · 52');
    expect(sizeText(null)).toBe('ONE SIZE');
    expect(casePieces({ pieces: [{ model: 'MONOLITHE', variant: null, sizeLabel: '54' }] })).toEqual(['MONOLITHE · 54']);
  });

  it('marks a count no identity backs (ORBES staff), and says how many sizes are so over the table', () => {
    expect(noPieceMark(3)).toBe('NO PIECE · 3');
    expect(noPieceMark(0)).toBeNull();
    expect(noPieceMark(undefined)).toBeNull();
    expect(unbackedNotice(3)).toBe('3 sizes have pieces counted that no ORBES identity backs. An order holding them cannot be packed: count their pieces in, or correct the count down.');
    expect(unbackedNotice(1)).toMatch(/^1 size has pieces counted/);
    expect(unbackedNotice(0)).toBeNull();
    expect(unbackedNotice(undefined)).toBeNull();
    expect(countInText(SKU)).toBe('Name the pieces of MONOLITHE · BLUE · 52 that are on the shelf: they enter the stock with their ORBES identity. The count does not move.');
  });

  it('writes a count\'s change with its sign, and what approving it does', () => {
    expect(deltaText(12)).toBe('+12');
    expect(deltaText(-2)).toBe('-2');
    expect(approveText({ sku: SKU, location: { name: 'LOGISTICS WAREHOUSE' }, delta: 2 })).toBe(
      'The count of MONOLITHE · BLUE · 52 at LOGISTICS WAREHOUSE moves by +2, and the orders waiting there are served, the oldest first.',
    );
    expect(approveText({ sku: SKU, location: { name: 'LOGISTICS WAREHOUSE' }, delta: -1 })).toBe('The count of MONOLITHE · BLUE · 52 at LOGISTICS WAREHOUSE moves by -1.');
  });
});

describe('the dialogs', () => {
  it('checks a correction (never 0, with why) and sends it as the server takes it', () => {
    expect(correctionProblem({ delta: '0', reason: 'x' })).toMatch(/up \(12\) or down \(-2\)/);
    expect(correctionProblem({ delta: '1.5', reason: 'x' })).not.toBeNull();
    expect(correctionProblem({ delta: '10001', reason: 'x' })).not.toBeNull();
    expect(correctionProblem({ delta: '-2', reason: ' ' })).toBe('Say why the count changes.');
    expect(correctionProblem({ delta: '-2', reason: 'x'.repeat(501) })).toMatch(/at most 500/);
    expect(correctionProblem({ delta: '+3', reason: 'Found on the shelf.' })).toBeNull();
    expect(correctionInput(ID, LOC, { delta: ' -2 ', reason: ' Damaged. ' })).toEqual({ skuId: ID, locationId: LOC, delta: -2, reason: 'Damaged.' });
  });

  it('checks a transfer and a minimum', () => {
    expect(transferProblem({ fromLocationId: LOC, toLocationId: LOC, quantity: '1' })).toBe('A transfer goes to another location.');
    expect(transferProblem({ fromLocationId: LOC, toLocationId: 'x', quantity: '1' })).toBe('Choose both locations.');
    expect(transferProblem({ fromLocationId: LOC, toLocationId: OTHER, quantity: '0' })).toMatch(/Move 1 to/);
    expect(transferProblem({ fromLocationId: LOC, toLocationId: OTHER, quantity: '2', note: '' })).toBeNull();
    expect(minimumProblem({ minimum: '' })).toBeNull();
    expect(minimumProblem({ minimum: '0' })).not.toBeNull();
    expect(minimumProblem({ minimum: '12' })).toBeNull();
    expect(minimumValue({ minimum: ' ' })).toBeNull();
    expect(minimumValue({ minimum: '12' })).toBe(12);
  });

  it('reads the serials of Count pieces in, one per line, in capitals, each once; refuses what is not a serial', () => {
    expect(serialsOf('o26-j-00184\nO26-J-00185, O26-J-00184\n\n')).toEqual(['O26-J-00184', 'O26-J-00185']);
    expect(countInProblem({ serials: '', note: 'x' })).toMatch(/at least one piece/);
    expect(countInProblem({ serials: 'O26-J-00184\nnot-one', note: 'x' })).toBe('NOT-ONE is not a serial: a serial reads O26-J-00184.');
    expect(countInProblem({ serials: 'O26-J-00184', note: '' })).toMatch(/note/);
    expect(countInProblem({ serials: Array.from({ length: 101 }, (_, i) => `O26-J-${String(i + 1).padStart(5, '0')}`).join('\n'), note: 'x' })).toMatch(/at most 100/);
    expect(countInProblem({ serials: 'O26-J-00184', note: 'Pieces of before H2.' })).toBeNull();
  });

  it('records a parcel back with the piece\'s state', () => {
    expect(receiveProblem({ pieceState: '', note: '' })).toBe('Say whether the piece is OK or damaged.');
    expect(receiveProblem({ pieceState: 'OK', note: 'x'.repeat(501) })).toMatch(/at most 500/);
    expect(receiveProblem({ pieceState: 'DAMAGED', note: '' })).toBeNull();
  });
});

const PARCEL: ShippingOrderView = {
  id: ID,
  reference: 'OR-0F0E0D0C',
  location: { id: LOC, name: 'FRANCE WAREHOUSE' },
  step: 'PACKING',
  readySince: '2026-11-03T09:00:00.000Z',
  late: false,
  orders: [
    { orderId: ID, reference: 'OR-0F0E0D0C', status: 'PAID', model: 'MONOLITHE', variant: 'BLUE', sizeLabel: '52', skuCode: 'MNL-BLU-52', addons: ['INITIALS'], engraving: 'A. & L.', surprise: null, piece: { productId: 'O26-J-00184', scanned: true } },
    { orderId: OTHER, reference: 'OR-2F0E0D0C', status: 'PAID', model: 'ORBITE', variant: null, sizeLabel: null, skuCode: 'ORB', addons: [], engraving: null, surprise: 'A silk pouch', piece: null },
  ],
  shipTo: { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: null, phone: null },
  addressChanged: null,
  shipment: { id: ID, status: 'PACKING', packingStartedAt: '2026-11-03T10:00:00.000Z', packedAt: null, shippedAt: null, deliveredAt: null, photo: false, carrier: null, trackingNumber: null, trackingUrl: null },
  checklist: [
    { key: `piece:${ID}`, label: 'The right piece: its card scanned (1 of 2)', byScan: true, ticked: true },
    { key: `card:${ID}`, label: 'The card, its claim code visible (1 of 2)', byScan: false, ticked: false },
    { key: 'box', label: 'The box and the pouch', byScan: false, ticked: false },
  ],
  history: [],
  carriers: [{ id: LOC, name: 'Colissimo' }],
};

describe('To ship and a parcel', () => {
  it('names a parcel\'s step, its other pieces, a piece, where it goes, and a card scanned', () => {
    expect(Object.keys(PARCEL_STEP_LABELS).sort()).toEqual([...SHIPMENT_STATUSES.filter((x) => x !== 'CANCELLED'), 'NOT_READY', 'READY_TO_PACK'].sort());
    expect(PARCEL_STEP_LABELS.READY_TO_PACK).toBe('READY TO PACK');
    expect(othersText(2)).toBe('+ 2 pieces');
    expect(othersText(1)).toBe('+ 1 piece');
    expect(othersText(0)).toBeNull();
    expect(pieceWords({ model: 'MONOLITHE', variant: 'BLUE' })).toBe('MONOLITHE · BLUE');
    expect(pieceWords({ model: 'MONOLITHE', variant: null })).toBe('MONOLITHE');
    // The country by its English name (plan NEXT LOT §3.6.B).
    expect(shipToLine({ name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris\n', country: 'FR' })).toBe('Ada Martin · 75007 Paris · France');
    expect(shipToLine({ name: null, address: null, country: null })).toBe('Not entered');
    expect(scanMessage({ productId: 'O26-J-00184', sku: SKU })).toBe('MONOLITHE · BLUE · 52 · O26-J-00184: the right piece.');
  });

  it('names every step of a parcel\'s history, by a role, never a name', () => {
    for (const a of PARCEL_HISTORY_ACTIONS) expect(HISTORY_LABELS[a], a).toBeTruthy();
    expect(Object.values(HISTORY_BY)).toEqual(['ORBES', 'The agent', 'The collector', 'ORBES']);
  });

  it('offers each step where the server takes it; Packed once every line is ticked, every card scanned and the photo added', () => {
    expect(parcelActions({ step: 'READY_TO_PACK', shipment: null }, true)).toMatchObject({ start: true, scan: false, check: false, ship: false });
    expect(parcelActions(PARCEL, true)).toMatchObject({ start: false, scan: true, photo: true, check: true, ship: false, deliver: false, report: false });
    expect(parcelActions(PARCEL, false)).toMatchObject({ start: false, scan: false, photo: false, check: false });
    expect(parcelActions({ step: 'PACKED', shipment: { ...PARCEL.shipment!, status: 'PACKED' } }, true)).toMatchObject({ ship: true, scan: false });
    expect(parcelActions({ step: 'SHIPPED', shipment: { ...PARCEL.shipment!, status: 'SHIPPED' } }, true)).toMatchObject({ deliver: true, report: true });
    const all = new Set([`card:${ID}`, 'box']);
    expect(checklistComplete(PARCEL, all)).toBe(false); // no photo
    const withPhoto = { ...PARCEL, shipment: { ...PARCEL.shipment!, photo: true } };
    expect(checklistComplete(withPhoto, all)).toBe(true);
    expect(checklistComplete(withPhoto, new Set(['box']))).toBe(false);
    // A card's line is ticked by its scan, never by hand.
    expect(checklistComplete({ ...withPhoto, checklist: withPhoto.checklist.map((l) => ({ ...l, ticked: false })) }, new Set([...all, `piece:${ID}`]))).toBe(false);
  });

  it('checks Ship and a parcel problem', () => {
    expect(shipProblem({ carrierId: '', trackingNumber: '6A123' }, [])).toBe('Choose a carrier.');
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A' }, [])).toBe('A tracking number has 3 to 40 letters and digits.');
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A12345678901' }, [])).toBeNull();
    const declared = [{ orderId: ID, currency: 'EUR' }];
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A123', [`declared_${ID}`]: '4800.50' }, declared)).toBeNull();
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A123', [`declared_${ID}`]: 'a lot' }, declared)).toBe('A declared value reads 4800, or 4800.50.');
    // What Ship cannot send (parseMoney's 7 figures) is refused, never dropped.
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A123', [`declared_${ID}`]: '9999999.99' }, declared)).toBeNull();
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A123', [`declared_${ID}`]: '10000000' }, declared)).toBe('A declared value reads 4800, or 4800.50.');
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A123', [`declared_${ID}`]: '10' }, [{ orderId: ID, currency: null }])).toMatch(/price first/);
    expect(reportProblem({ kind: '', note: 'x' })).toBe('Say what happened.');
    expect(reportProblem({ kind: 'LOST', note: '' })).toBe('Say what happened in the note.');
    expect(reportProblem({ kind: 'DAMAGED', note: 'The box arrived crushed.' })).toBeNull();
  });

  it('builds the agent\'s packing slip from the parcel: one block per piece, without Channel, Release, Source or a price', () => {
    const slip = shippingSlip(PARCEL);
    expect(slip).toEqual({
      reference: 'OR-0F0E0D0C',
      // Plan NEXT LOT §3.6.B, §1.1 (d): no country nor phone entered yet; no change.
      buyer: { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: null, phone: 'Not entered', changed: null },
      pieces: [
        { reference: 'OR-0F0E0D0C', piece: 'MONOLITHE · BLUE', serial: 'O26-J-00184', size: '52', addons: ['INITIALS'], engraving: 'A. & L.', surprise: null },
        { reference: 'OR-2F0E0D0C', piece: 'ORBITE', serial: null, size: 'ONE SIZE', addons: [], engraving: null, surprise: 'A silk pouch' },
      ],
    });
    expect(Object.keys(slip)).not.toEqual(expect.arrayContaining(['channel', 'release', 'sourceReference']));
    // With its country (by its English name), its phone, and ADDRESS CHANGED's line while the parcel has not shipped.
    const changed = shippingSlip({ ...PARCEL, shipTo: { ...PARCEL.shipTo, country: 'GB', phone: '+44 20 7946 0000' }, addressChanged: { at: '2026-10-07T12:02:00.000Z', by: 'COLLECTOR' } });
    expect(changed.buyer).toEqual({ name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: 'United Kingdom', phone: '+44 20 7946 0000', changed: expect.stringMatching(/^Changed on 07 OCT 2026 at \d{2}:02 by the collector\.$/) });
  });

  it('scales the packing photo to 1600 px, within the server\'s 1 MiB', () => {
    expect(PACKING_PHOTO_MAX_SIDE).toBe(1600);
    expect(PHOTO_MAX_BYTES).toBe(PACKING_PHOTO_MAX_BYTES);
  });
});

describe('receptions', () => {
  const ORDER = {
    lines: [{ lineId: 'l', sku: SKU, ordered: 50, alreadyReceived: 0, expected: 50 }],
  };
  const EXTRA = { ...SKU, id: OTHER, code: 'MNL-BLU-54', sizeLabel: '54' };
  const VIEW = { supplierOrder: { id: ID, reference: 'SO-7C21A0B9' }, accepted: 48, rejected: 2, status: 'TO_CONFIRM' as const, location: { id: LOC, name: 'LOGISTICS WAREHOUSE' }, issuing: { issued: 150, accepted: 500, done: false } };

  it('holds the server\'s bounds and runs', () => {
    expect(RECEPTION_LIMITS).toMatchObject({ pieces: SERVER_RECEPTION_LIMITS.pieces, deliveryNote: SERVER_RECEPTION_LIMITS.deliveryNote, note: SERVER_RECEPTION_LIMITS.note, lineNote: SERVER_RECEPTION_LIMITS.lineNote });
    expect([RECEPTION_LIMITS.sheetRun, RECEPTION_LIMITS.cardRun]).toEqual([RECEPTION_RUNS.sheet, RECEPTION_RUNS.card]);
  });

  it('says a reception, its cards and their progress, a rejected piece and ORBES\'s Expected list in the plan\'s words', () => {
    expect(receptionSummary(VIEW)).toBe('SO-7C21A0B9 · 48 OK · 2 rejected · waiting for ORBES');
    expect(receptionSummary({ ...VIEW, status: 'SENT_BACK' })).toBe('SO-7C21A0B9 · 48 OK · 2 rejected');
    expect(cardsLine(VIEW)).toBe('SO-7C21A0B9 · 500 cards');
    expect(issuingLine(VIEW)).toBe('Issuing the identities: 150 of 500.');
    expect(issuingLine({ issuing: { issued: 500, accepted: 500, done: true } })).toBeNull();
    expect(confirmReceptionText(VIEW)).toBe(
      '48 pieces get their ORBES identity now: a serial, a signed ORBES code and a claim code each. They enter the stock at LOGISTICS WAREHOUSE and go to the orders waiting for them, the oldest first. The agent then prints their cards. 2 rejected pieces get no identity: they are listed TO RETURN on SO-7C21A0B9.',
    );
    expect(confirmReceptionText({ ...VIEW, accepted: 0, rejected: 1 })).toBe('1 rejected piece gets no identity: it is listed TO RETURN on SO-7C21A0B9.');
    expect(supplierReturnLine({ id: ID, supplierOrder: VIEW.supplierOrder, sku: SKU, quantity: 2, status: 'TO_RETURN', location: VIEW.location })).toBe('SO-7C21A0B9 · MONOLITHE · BLUE · 52 · 2 pieces · TO RETURN');
    expect(expectedLead('LOGISTICS WAREHOUSE')).toBe('Supplier orders on their way to LOGISTICS WAREHOUSE. Open one when its parcel arrives, and count what is in it.');
    expect(expectedEmpty('LOGISTICS WAREHOUSE')).toBe('No supplier order on its way to LOGISTICS WAREHOUSE.');
    expect(runLabel('sheet', 1, 1)).toBe('Print A4 sheets');
    expect(runLabel('card', 2, 3)).toBe('Print one per page · run 2');
    expect(skippedLine([])).toBeNull();
    expect(skippedLine([{ productId: 'O26-J-00184', reason: 'REGISTERED' }])).toBe('Not printed: O26-J-00184 (registered, packed for an order, replaced or no longer readable). Tell ORBES.');
  });

  it('reads a reference as the server does', () => {
    expect(referenceProblem('so7c21a0b9')).toBeNull();
    expect(referenceProblem(' SO-7C21A0B9 ')).toBeNull();
    expect(referenceProblem('7C21A0B9')).toBe('A supplier order’s reference reads SO-7C21A0B9.');
  });

  it('checks a count (a note for more than expected or a size not on the order) and sends its lines, none at 0', () => {
    expect(receptionProblem(ORDER, [], {})).toBe('Count at least one piece.');
    expect(receptionProblem(ORDER, [], { [`accepted_${ID}`]: '2.5' })).toMatch(/whole pieces/);
    expect(receptionProblem(ORDER, [], { [`accepted_${ID}`]: '51' })).toBe('Say in a note why more pieces than expected, or a piece not on the order, came in.');
    expect(receptionProblem(ORDER, [], { [`accepted_${ID}`]: '51', [`note_${ID}`]: 'One more.' })).toBeNull();
    expect(receptionProblem(ORDER, [EXTRA], { [`accepted_${ID}`]: '48', [`rejected_${OTHER}`]: '1' })).toMatch(/note/);
    expect(receptionProblem(ORDER, [], { [`accepted_${ID}`]: '48', deliveryNote: 'x'.repeat(61) })).toMatch(/delivery note/);
    expect(receptionInputOf(ORDER, [EXTRA], { [`accepted_${ID}`]: '48', [`rejected_${ID}`]: '2', [`accepted_${OTHER}`]: '0', deliveryNote: ' BL-1 ', note: '' })).toEqual({
      lines: [{ skuId: ID, accepted: 48, rejected: 2, note: null }],
      deliveryNote: 'BL-1',
      note: null,
    });
    expect(supplierReturnProblem({ carrierId: '', trackingNumber: 'RET-1' })).toBe('A tracking number comes with its carrier.');
    expect(supplierReturnProblem({ carrierId: LOC, trackingNumber: 'RET-1' })).toBeNull();
    expect(supplierReturnProblem({ carrierId: '', trackingNumber: '' })).toBeNull();
  });
});

describe('what each role may do', () => {
  it('lets the agent read and act on its locations only, ORBES\'s OPERATOR approve and act at once, an AUDITOR read', () => {
    const roles = [...ADMIN_ROLES];
    expect(roles.filter((r) => can(r, 'readLogistics'))).toEqual(expect.arrayContaining(['LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN']));
    expect(can('RETAIL', 'readLogistics')).toBe(false);
    expect(roles.filter((r) => can(r, 'logistics')).sort()).toEqual(['ADMIN', 'LOGISTICS', 'OPERATOR']);
    for (const cap of ['approveCorrections', 'manageStock', 'confirmReceptions'] as const) expect(roles.filter((r) => can(r, cap)).sort(), cap).toEqual(['ADMIN', 'OPERATOR']);
    expect(logisticsOnly('LOGISTICS')).toBe(true);
    expect(logisticsOnly('AUDITOR')).toBe(false);
  });
});

describe('the API client', () => {
  it('calls each Logistics route with its method and body, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/cards')) return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ORBES-cards.pdf"', 'x-orbes-cards-printed': '2', 'x-orbes-cards-skipped': 'O26-J-00184:REPLACED' } });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.logisticsStock({ locationId: LOC });
    await api.stockCorrections({ status: 'TO_APPROVE' });
    await api.proposeCorrection({ skuId: ID, locationId: LOC, delta: -2, reason: 'Damaged.' });
    await api.approveCorrection(ID);
    await api.declineCorrection(ID, 'Counted again: 12.');
    await api.logisticsTransfer({ skuId: ID, fromLocationId: LOC, toLocationId: OTHER, quantity: 2 });
    await api.setLogisticsMinimum({ skuId: ID, locationId: LOC, minimum: 4 });
    await api.countIn({ skuId: ID, productIds: ['O26-J-00184'], note: 'On the shelf.' });
    await api.parcels({ locationId: LOC });
    await api.parcel(ID);
    await api.startPacking(ID);
    await api.scanPackingCard(ID, { code: 'AAAA' });
    await api.setPackingPhoto(ID, new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }));
    await api.checkPacked(ID, ['box']);
    await api.shipParcel(ID, { carrierId: LOC, trackingNumber: '6A123' });
    await api.markParcelDelivered(ID);
    await api.reportParcel(ID, { kind: 'LOST', note: 'Never arrived.' });
    await api.receptions({ locationId: LOC });
    await api.findReception('SO-7C21A0B9');
    await api.receptionLines(ID);
    await api.reception(ID);
    await api.recordReception({ supplierOrderId: ID, lines: [{ skuId: ID, accepted: 1, rejected: 0 }] });
    await api.updateReception(ID, { lines: [{ skuId: ID, accepted: 2, rejected: 0 }] });
    await api.sendBackReception(ID, 'Count again.');
    await api.confirmReception(ID);
    const printed = await api.receptionCards(ID, { layout: 'sheet', run: 1 });
    await api.cardsAttached(ID);
    await api.supplierReturnSent(ID, { carrierId: LOC, trackingNumber: 'RET-1' });
    await api.casesToReceive();
    await api.receiveCase(ID, { pieceState: 'OK', note: null });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `GET /api/admin/logistics/stock?locationId=${LOC}`,
      'GET /api/admin/logistics/corrections?status=TO_APPROVE',
      'POST /api/admin/logistics/corrections',
      `POST /api/admin/logistics/corrections/${ID}/approve`,
      `POST /api/admin/logistics/corrections/${ID}/decline`,
      'POST /api/admin/logistics/transfers',
      'PUT /api/admin/logistics/minimums',
      'POST /api/admin/logistics/count-in',
      `GET /api/admin/logistics/orders?locationId=${LOC}`,
      `GET /api/admin/logistics/orders/${ID}`,
      `POST /api/admin/logistics/orders/${ID}/packing`,
      `POST /api/admin/logistics/orders/${ID}/packing/scan`,
      `PUT /api/admin/logistics/orders/${ID}/packing/photo`,
      `POST /api/admin/logistics/orders/${ID}/packing/check`,
      `POST /api/admin/logistics/orders/${ID}/ship`,
      `POST /api/admin/logistics/orders/${ID}/delivered`,
      `POST /api/admin/logistics/orders/${ID}/order-case`,
      `GET /api/admin/logistics/receptions?locationId=${LOC}`,
      'GET /api/admin/logistics/receptions/supplier-order?reference=SO-7C21A0B9',
      `GET /api/admin/logistics/receptions/lines/${ID}`,
      `GET /api/admin/logistics/receptions/${ID}`,
      'POST /api/admin/logistics/receptions',
      `PUT /api/admin/logistics/receptions/${ID}`,
      `POST /api/admin/logistics/receptions/${ID}/send-back`,
      `POST /api/admin/logistics/receptions/${ID}/confirm`,
      `POST /api/admin/logistics/receptions/${ID}/cards`,
      `POST /api/admin/logistics/receptions/${ID}/cards-attached`,
      `POST /api/admin/logistics/supplier-returns/${ID}/sent`,
      'GET /api/admin/logistics/order-cases',
      `POST /api/admin/logistics/order-cases/${ID}/received`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : undefined));
    expect(bodies[2]).toEqual({ skuId: ID, locationId: LOC, delta: -2, reason: 'Damaged.' });
    expect(bodies[3]).toEqual({});
    expect(bodies[4]).toEqual({ note: 'Counted again: 12.' });
    expect(bodies[6]).toEqual({ skuId: ID, locationId: LOC, minimum: 4 });
    expect(bodies[7]).toEqual({ skuId: ID, productIds: ['O26-J-00184'], note: 'On the shelf.' });
    expect(calls[12]!.init.body).toBeInstanceOf(Blob);
    expect((calls[12]!.init.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
    expect(bodies[13]).toEqual({ ticked: ['box'] });
    expect(bodies[14]).toEqual({ carrierId: LOC, trackingNumber: '6A123' });
    expect(bodies[16]).toEqual({ kind: 'LOST', note: 'Never arrived.' });
    expect(bodies[21]).toEqual({ supplierOrderId: ID, lines: [{ skuId: ID, accepted: 1, rejected: 0 }] });
    expect(bodies[23]).toEqual({ note: 'Count again.' });
    expect(bodies[25]).toEqual({ layout: 'sheet', run: 1 });
    expect(printed).toMatchObject({ printed: 2, skipped: [{ productId: 'O26-J-00184', reason: 'REPLACED' }] });
    expect(bodies[27]).toEqual({ carrierId: LOC, trackingNumber: 'RET-1' });
    expect(bodies[29]).toEqual({ pieceState: 'OK', note: null });
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
  });
});
