/**
 * Standard boxes and weights in the console (macro scope of 2026-10-20, D16 B1 and B2; lot M3 plan §1.3, step M3.3) —
 * the pure model (src/web/admin/model/boxes.ts) against the server's rules, and the API client's routes:
 *
 *  - Orders → Settings → Boxes: a box's sides, weight, cost and state; its dialog's checks (the bounds of migration
 *    0054, the 95 × 62 mm card flat in either orientation, said in the server's words) and what it sends (an edit only
 *    what changed, the cost and its currency together).
 *  - A model's Packing: its box and weight, its own or its main model's (« As MONOLITHE »), the select, the packed
 *    weight's check, the Catalogue's Box cell.
 *  - A parcel's Packing: the box's source line (every piece's, the largest, chosen, none), THE PARCEL'S WEIGHT or what
 *    it misses, the values recorded at PACKED, CHANGE BOX's options and the slip's box and weight; never a cost.
 *  - The words: calm, no atelier, handmade or craft, no exclamation mark.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { boxTooSmall, cardFits as serverCardFits } from '../../src/server/services/boxes.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  BOX_LIMITS,
  BOXES_TEXT,
  boxChange,
  boxCostText,
  boxFormValues,
  boxInput,
  boxProblem,
  boxSides,
  boxSourceLine,
  boxState,
  boxWords,
  CARD_RULE,
  cardFits,
  catalogueBoxCell,
  changeBoxOptions,
  grams,
  joinWords,
  missingLine,
  MODEL_PACKING_TEXT,
  modelBoxRow,
  modelWeightRow,
  PARCEL_BOX_TEXT,
  packingBoxOptions,
  packingChanged,
  packingFormValues,
  packingInput,
  packingProblem,
  parcelBoxRow,
  parcelWeightRow,
  slipParcel,
} from '../../src/web/admin/model/boxes.js';
import { formatMoney } from '../../src/web/admin/model/live.js';
import type { BoxRef, BoxView, Model, ParcelPacking } from '../../src/web/admin/types.js';

const T = ' ';
const CUBE: BoxRef = { id: '0b0b0b0b-0b0a-4908-8706-050403020100', name: 'CUBE 80', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 40, emptyWeightG: 85, active: true };
const LONG: BoxRef = { id: '1b0b0b0b-0b0a-4908-8706-050403020100', name: 'LONG 200', insideLengthMm: 2000, insideWidthMm: 100, insideHeightMm: 60, emptyWeightG: 1200, active: false };
const VIEW: BoxView = { ...CUBE, costMinor: 120, currency: 'EUR', models: 2, createdAt: '2026-10-22T08:00:00.000Z', updatedAt: '2026-10-22T08:00:00.000Z' };
const form = (extra: Partial<Record<string, string>> = {}) => ({ name: 'CUBE 80', insideLengthMm: '120', insideWidthMm: '90', insideHeightMm: '40', emptyWeightG: '85', cost: '', currency: '', ...extra });

const own = (extra: Partial<Model['packing']> = {}): Pick<Model, 'packing' | 'variantOf'> => ({ packing: { box: CUBE, packedWeightG: 140, inherited: null, ...extra }, variantOf: null });
const variant = (inherits: { box: boolean; packedWeightG: boolean }, box: BoxRef | null = CUBE, weight: number | null = 140): Pick<Model, 'packing' | 'variantOf'> => ({
  packing: { box, packedWeightG: weight, inherited: { from: { id: 'm', name: 'MONOLITHE' }, ...inherits } },
  variantOf: { id: 'm', name: 'MONOLITHE', label: null },
});
const parcel = (extra: Partial<ParcelPacking> = {}): ParcelPacking => ({ box: CUBE, boxSource: 'MODELS', pieces: 1, modelsWithoutBox: [], weightG: 225, missing: [], recorded: false, boxes: [CUBE], ...extra });

describe('Orders → Settings → Boxes', () => {
  it('reads a box: its inside sides, grams, its cost or none, its state', () => {
    expect(boxSides(LONG)).toBe(`2${T}000 × 100 × 60 mm`);
    expect(grams(1240)).toBe(`1${T}240 g`);
    expect(boxCostText(VIEW)).toBe(formatMoney(120, 'EUR'));
    expect(boxCostText(VIEW)).toMatch(/^€.1\.20$/);
    expect(boxCostText({ costMinor: null, currency: null })).toBe('—');
    expect([boxState(CUBE), boxState(LONG)]).toEqual(['ACTIVE', 'SET ASIDE']);
    expect(boxWords(CUBE)).toBe('CUBE 80 · 120 × 90 × 40 mm');
    expect(boxWords(LONG)).toBe(`LONG 200 · 2${T}000 × 100 × 60 mm · SET ASIDE`);
    expect(BOXES_TEXT.empty).toBe('No box yet. Add your boxes: each model is then given its box.');
    expect(CARD_RULE).toBe('Inside, it must take the 95 × 62 mm certificate card flat.');
  });

  it('checks the dialog as the server does: the bounds, the card flat in either orientation (the server\'s words), the cost with its currency', () => {
    expect(boxProblem(form())).toBeNull();
    expect(boxProblem(form({ name: ' ' }))).toBe('Name the box.');
    expect(boxProblem(form({ name: 'x'.repeat(61) }))).toBe('A name has at most 60 characters.');
    expect(boxProblem(form({ insideLengthMm: '0' }))).toBe(`The inside length is a whole number of millimetres, 1 to 2${T}000.`);
    expect(boxProblem(form({ insideWidthMm: '9.5' }))).toMatch(/^The inside width is a whole number/);
    expect(boxProblem(form({ insideHeightMm: '2001' }))).toMatch(/^The inside height is a whole number/);
    for (const [l, w] of [
      [95, 62],
      [62, 95],
      [2000, 62],
    ]) {
      expect(cardFits(l!, w!), `${l} × ${w}`).toBe(true);
      expect(serverCardFits(l!, w!)).toBe(true);
    }
    for (const [l, w] of [
      [94, 62],
      [62, 94],
      [95, 61],
      [61, 2000],
    ]) {
      expect(cardFits(l!, w!), `${l} × ${w}`).toBe(false);
      expect(serverCardFits(l!, w!)).toBe(false);
      expect(boxProblem(form({ insideLengthMm: String(l), insideWidthMm: String(w) }))).toBe(boxTooSmall().publicMessage);
    }
    expect(boxProblem(form({ emptyWeightG: '30001' }))).toBe(`The empty weight is a whole number of grams, 1 to 30${T}000.`);
    expect(boxProblem(form({ cost: '1.20' }))).toBe('A cost needs its currency, a three-letter code such as EUR.');
    expect(boxProblem(form({ cost: '1.205', currency: 'EUR' }))).toBe('A cost reads 1.20, or 12.');
    expect(boxProblem(form({ cost: '1000000.01', currency: 'EUR' }))).toBe('A cost reads 1.20, or 12.');
    expect(boxProblem(form({ cost: '1000000', currency: 'eur' }))).toBeNull();
    expect(boxProblem(form({ currency: 'EUR' }))).toBe('Enter the cost, or leave the currency empty.');
    expect(BOX_LIMITS).toMatchObject({ name: 60, insideMm: 2000, emptyWeightG: 30_000, costMinor: 100_000_000, packedWeightG: 30_000 });
  });

  it('sends a new box whole, and an edit only what changed, the cost and its currency together', () => {
    expect(boxInput(form({ name: ' CUBE 80 ', cost: '1.2', currency: 'eur' }))).toEqual({ name: 'CUBE 80', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 40, emptyWeightG: 85, costMinor: 120, currency: 'EUR' });
    expect(boxInput(form())).toMatchObject({ costMinor: null, currency: null });
    const values = boxFormValues(VIEW);
    expect(values).toEqual({ name: 'CUBE 80', insideLengthMm: '120', insideWidthMm: '90', insideHeightMm: '40', emptyWeightG: '85', cost: '1.20', currency: 'EUR' });
    expect(boxFormValues(null)).toEqual({ name: '', insideLengthMm: '', insideWidthMm: '', insideHeightMm: '', emptyWeightG: '', cost: '', currency: '' });
    expect(boxChange(VIEW, values)).toBeNull();
    expect(boxChange(VIEW, { ...values, insideHeightMm: '45' })).toEqual({ insideHeightMm: 45 });
    expect(boxChange(VIEW, { ...values, currency: 'GBP' })).toEqual({ costMinor: 120, currency: 'GBP' });
    expect(boxChange(VIEW, { ...values, cost: '', currency: '' })).toEqual({ costMinor: null, currency: null });
  });
});

describe('a model\'s Packing and the Catalogue\'s Box', () => {
  it('reads its own box and weight, or a variant\'s main model\'s', () => {
    expect(modelBoxRow(own())).toEqual({ value: 'CUBE 80 · 120 × 90 × 40 mm', note: null });
    expect(modelWeightRow(own())).toEqual({ value: '140 g', note: MODEL_PACKING_TEXT.weightHint });
    expect(modelBoxRow(own({ box: null }))).toEqual({ value: 'No box yet.', note: null });
    expect(modelWeightRow(own({ packedWeightG: null })).value).toBe('Not set');
    expect(modelBoxRow(variant({ box: true, packedWeightG: false }))).toEqual({ value: 'CUBE 80 · 120 × 90 × 40 mm', note: 'As MONOLITHE, its main model.' });
    expect(modelWeightRow(variant({ box: false, packedWeightG: true }))).toEqual({ value: '140 g', note: 'As MONOLITHE, its main model.' });
    expect(MODEL_PACKING_TEXT.weightHint).toBe('The piece as it is packed, with its pouch and card, without the box.');
    expect(catalogueBoxCell(own())).toEqual({ value: 'CUBE 80', sub: null });
    expect(catalogueBoxCell(own({ box: null }))).toEqual({ value: '—', sub: null });
    expect(catalogueBoxCell(variant({ box: true, packedWeightG: true }))).toEqual({ value: 'CUBE 80', sub: 'As MONOLITHE' });
  });

  it('opens Edit on its own values, offers « As MONOLITHE » to a variant and the active boxes (its own kept), checks and sends both fields', () => {
    expect(packingFormValues(own())).toEqual({ boxId: CUBE.id, packedWeightG: '140' });
    expect(packingFormValues(variant({ box: true, packedWeightG: true }))).toEqual({ boxId: '', packedWeightG: '' });
    expect(packingBoxOptions([CUBE, LONG], own())).toEqual([
      { value: '', label: 'None' },
      { value: CUBE.id, label: 'CUBE 80 · 120 × 90 × 40 mm' },
    ]);
    expect(packingBoxOptions([CUBE, LONG], variant({ box: true, packedWeightG: true }))[0]).toEqual({ value: '', label: 'As MONOLITHE' });
    // A box set aside the model already packs in stays offered, marked.
    expect(packingBoxOptions([CUBE, LONG], own({ box: LONG })).map((o) => o.label)).toEqual(['None', 'CUBE 80 · 120 × 90 × 40 mm', `LONG 200 · 2${T}000 × 100 × 60 mm · SET ASIDE`]);
    expect(packingProblem({ packedWeightG: '' })).toBeNull();
    expect(packingProblem({ packedWeightG: '0' })).toBe(`The packed weight is a whole number of grams, 1 to 30${T}000.`);
    expect(packingProblem({ packedWeightG: '30001' })).not.toBeNull();
    expect(packingInput({ boxId: CUBE.id, packedWeightG: ' 140 ' })).toEqual({ boxId: CUBE.id, packedWeightG: 140 });
    expect(packingInput({ boxId: '', packedWeightG: '' })).toEqual({ boxId: null, packedWeightG: null });
    expect(packingChanged(own(), { boxId: CUBE.id, packedWeightG: '140' })).toBe(false);
    expect(packingChanged(own(), { boxId: CUBE.id, packedWeightG: '141' })).toBe(true);
    expect(packingChanged(own(), { boxId: '', packedWeightG: '140' })).toBe(true);
  });
});

describe('a parcel\'s Packing and its slip', () => {
  it('says where the box comes from: the piece\'s, every piece\'s, the largest, chosen, or none set', () => {
    expect(boxSourceLine(parcel())).toBe('The piece’s box.');
    expect(boxSourceLine(parcel({ pieces: 2 }))).toBe('Every piece’s box.');
    expect(boxSourceLine(parcel({ pieces: 3, boxSource: 'LARGEST' }))).toBe('The largest of the pieces’ boxes: check the fit.');
    expect(boxSourceLine(parcel({ pieces: 2, boxSource: 'LARGEST', modelsWithoutBox: ['ORBITE'] }))).toBe('The largest of the pieces’ boxes: check the fit. No box is set for ORBITE.');
    expect(boxSourceLine(parcel({ boxSource: 'CHOSEN', modelsWithoutBox: ['ORBITE'] }))).toBe('Chosen while packing.');
    expect(boxSourceLine(parcel({ box: null, boxSource: null, modelsWithoutBox: ['MONOLITHE · Steel'] }))).toBe('No box is set for MONOLITHE · Steel: choose one.');
    expect(boxSourceLine(parcel({ box: null, boxSource: null, modelsWithoutBox: ['A', 'B', 'C'] }))).toBe('No box is set for A, B and C: choose one.');
    expect(joinWords([])).toBe('');
    expect(parcelBoxRow(parcel())).toEqual({ value: 'CUBE 80 · 120 × 90 × 40 mm', note: 'The piece’s box.' });
    expect(parcelBoxRow(parcel({ box: null, boxSource: null, modelsWithoutBox: ['MONOLITHE'] }))).toEqual({ value: 'None yet', note: 'No box is set for MONOLITHE: choose one.' });
  });

  it('reads THE PARCEL\'S WEIGHT, or what it misses; once packed, as recorded', () => {
    expect(parcelWeightRow(parcel({ weightG: 1240 }))).toEqual({ value: `1${T}240 g`, note: 'The box’s empty weight and each piece as it is packed.' });
    expect(missingLine(['MONOLITHE'])).toBe('Unknown: no weight for MONOLITHE');
    expect(missingLine(['MONOLITHE', 'ORBITE', 'box'])).toBe('Unknown: no weight for MONOLITHE and ORBITE, and no box');
    expect(missingLine(['box'])).toBe('Unknown: no box');
    expect(missingLine(['over 100000 g'])).toBe(`Unknown: over 100${T}000 g`);
    expect(parcelWeightRow(parcel({ weightG: null, missing: ['MONOLITHE'] })).value).toBe('Unknown: no weight for MONOLITHE');
    // Packed: the box and weight written at PACKED; a parcel packed before boxes existed has neither.
    const packed = parcel({ recorded: true, boxSource: 'CHOSEN', boxes: [] });
    expect(parcelBoxRow(packed)).toEqual({ value: 'CUBE 80 · 120 × 90 × 40 mm', note: PARCEL_BOX_TEXT.recorded });
    expect(parcelBoxRow({ ...packed, box: { ...CUBE, active: false } }).value).toBe('CUBE 80 · 120 × 90 × 40 mm');
    expect(parcelWeightRow(packed)).toEqual({ value: '225 g', note: 'As recorded when the parcel was packed.' });
    expect(parcelWeightRow({ ...packed, weightG: null, missing: ['box'] })).toEqual({ value: 'Unknown: no box', note: PARCEL_BOX_TEXT.recorded });
    const before = parcel({ recorded: true, box: null, boxSource: null, weightG: null, missing: [], boxes: [] });
    expect(parcelBoxRow(before)).toEqual({ value: 'None recorded', note: null });
    expect(parcelWeightRow(before)).toEqual({ value: 'Not recorded', note: null });
  });

  it('offers CHANGE BOX the active boxes, and prints the box and the weight on the slip, never a cost', () => {
    expect(changeBoxOptions(parcel({ boxes: [CUBE] }))).toEqual([{ value: CUBE.id, label: 'CUBE 80 · 120 × 90 × 40 mm' }]);
    expect(slipParcel(parcel())).toEqual({ box: 'CUBE 80 · 120 × 90 × 40 mm', weight: '225 g' });
    expect(slipParcel(parcel({ box: null, boxSource: null, weightG: null, missing: ['MONOLITHE', 'box'] }))).toEqual({ box: 'To be chosen', weight: 'Unknown: no weight for MONOLITHE, and no box' });
    expect(slipParcel(parcel({ recorded: true, box: null, weightG: null, missing: [] }))).toEqual({ box: 'None recorded', weight: 'Not recorded' });
  });
});

describe('the words', () => {
  it('are calm: no atelier, handmade or craft, no exclamation mark; the parcel\'s words name no cost', () => {
    const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/admin/model/boxes.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/atelier|handmade|hand-made|craft|!['"`]/i);
    expect(Object.values(PARCEL_BOX_TEXT).join(' ')).not.toMatch(/cost|price|€|EUR/i);
  });
});

describe('the API client', () => {
  it('calls the boxes\', a model\'s packing and CHANGE BOX\'s routes with their methods and bodies, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    const id = CUBE.id;
    await api.boxes();
    await api.createBox({ name: 'CUBE 80', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 40, emptyWeightG: 85, costMinor: null, currency: null });
    await api.updateBox(id, { insideHeightMm: 45 });
    await api.setBoxAside(id);
    await api.reinstateBox(id);
    await api.setModelPacking(id, { boxId: id, packedWeightG: 140 });
    await api.chooseParcelBox(id, id);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/boxes',
      'POST /api/admin/boxes',
      `PATCH /api/admin/boxes/${id}`,
      `POST /api/admin/boxes/${id}/set-aside`,
      `POST /api/admin/boxes/${id}/reinstate`,
      `PUT /api/admin/models/${id}/packing`,
      `POST /api/admin/logistics/orders/${id}/packing/box`,
    ]);
    expect(calls.slice(1).map((c) => JSON.parse(String(c.init.body)))).toEqual([
      { name: 'CUBE 80', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 40, emptyWeightG: 85, costMinor: null, currency: null },
      { insideHeightMm: 45 },
      {},
      {},
      { boxId: id, packedWeightG: 140 },
      { boxId: id },
    ]);
    for (const c of calls.slice(1)) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});
