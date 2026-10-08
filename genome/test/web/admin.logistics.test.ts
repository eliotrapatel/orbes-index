/**
 * Logistics in the console (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.4.1; steps 5.11a to 5.11c) — the pure models
 * and the API client: model/logistics.ts against the server's rules (its bounds mirrored and compared), the tabs and
 * their counters, the Location filter, a size's words and marks, the dialogs' checks and what they send, what each role
 * may do; AdminApi's Logistics paths, methods and bodies.
 */
import { describe, expect, it } from 'vitest';
import { LOGISTICS_LIMITS as SERVER_LOGISTICS_LIMITS } from '../../src/server/services/logistics.js';
import { ORDER_CASE_LIMITS } from '../../src/server/services/order-cases.js';
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
import { can, logisticsOnly } from '../../src/web/admin/model/permissions.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import { ADMIN_ROLES, ORDER_CASE_KINDS, STOCK_CORRECTION_STATUSES, type LogisticsSku } from '../../src/web/admin/types.js';

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
    expect(LOGISTICS_TABS.map((t) => t.id)).toEqual(['stock', 'returns', 'corrections']);
    expect(logisticsTab({})).toBe('stock');
    expect(logisticsTab({ tab: 'corrections' })).toBe('corrections');
    expect(logisticsTab({ tab: 'atelier' })).toBe('stock');
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

describe('what each role may do', () => {
  it('lets the agent read and act on its locations only, ORBES\'s OPERATOR approve and act at once, an AUDITOR read', () => {
    const roles = [...ADMIN_ROLES];
    expect(roles.filter((r) => can(r, 'readLogistics'))).toEqual(expect.arrayContaining(['LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN']));
    expect(can('RETAIL', 'readLogistics')).toBe(false);
    expect(roles.filter((r) => can(r, 'logistics')).sort()).toEqual(['ADMIN', 'LOGISTICS', 'OPERATOR']);
    for (const cap of ['approveCorrections', 'manageStock'] as const) expect(roles.filter((r) => can(r, cap)).sort(), cap).toEqual(['ADMIN', 'OPERATOR']);
    expect(logisticsOnly('LOGISTICS')).toBe(true);
    expect(logisticsOnly('AUDITOR')).toBe(false);
  });
});

describe('the API client', () => {
  it('calls each Logistics route with its method and body, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
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
      'GET /api/admin/logistics/order-cases',
      `POST /api/admin/logistics/order-cases/${ID}/received`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : undefined));
    expect(bodies[2]).toEqual({ skuId: ID, locationId: LOC, delta: -2, reason: 'Damaged.' });
    expect(bodies[3]).toEqual({});
    expect(bodies[4]).toEqual({ note: 'Counted again: 12.' });
    expect(bodies[6]).toEqual({ skuId: ID, locationId: LOC, minimum: 4 });
    expect(bodies[7]).toEqual({ skuId: ID, productIds: ['O26-J-00184'], note: 'On the shelf.' });
    expect(bodies[10]).toEqual({ pieceState: 'OK', note: null });
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
  });
});
