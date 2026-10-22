/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.6.6, step 5.8; services/logistics.ts), on the service as createContext
 * wires it. The atelier's stock cases, moved here (its stock read, minimums, declared and set-aside sizes, an inactive
 * model), and what is new:
 *
 *  - the stock: every offered size at each location, 0 included, with what waits for a piece; expected, to order and
 *    the pieces without an identity for ORBES staff only; the agent's own locations only (404 outside them; a login
 *    of two locations sees both);
 *  - corrections: the agent proposes, ORBES approves or declines once (CORRECTION_NOT_PENDING); ORBES's own applied at
 *    once; never below reserved (STOCK_NOT_AVAILABLE), never above the pieces that exist (STOCK_NOT_BACKED); up, the
 *    waiting orders served, the oldest first;
 *  - a transfer serves the orders waiting at its destination;
 *  - counted without a piece: a hand count and a Generator piece read as NO PIECE; the pieces counted in (countIn) and
 *    its refusals;
 *  - an add-on's SKU (macro scope K48 D1, plan MACRO M3 §4.2): listed after the models' sizes, named by its add-on,
 *    counted without an identity, a unit held on an order reserved (`stock_holds`), set aside like a size.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { packingSuggestion, parcelWeight } from '../../src/server/services/parcels.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, issue, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { packParcel, scanIntoParcel, stockPieces } from '../support/fulfil.js';
import { jpegPhoto } from '../support/images.js';
import { createAccount } from '../support/live.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('LogisticsService (plan NEXT LOT §3.5.6.6)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let agent: Actor;
  let france: string;
  let logistics: string;
  const agentScope = () => new Set([logistics]);

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-08T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    agent = { type: 'admin', id: (await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [logistics] })).id };
  });
  afterAll(() => h?.close());

  const lg = () => h.ctx.services.logistics;
  const skuOf = (label: string | null, modelId = catalog.modelId) => h.ctx.db.transaction().execute((tx) => ensureSku(tx, modelId, label));
  const handCount = (skuId: string, locationId: string, n: number) => h.ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Counted by hand.' }, admin);
  let models = 0;
  async function createModel(name: string, extra: { variant_label?: string; variant_swatch?: string } = {}): Promise<string> {
    models += 1;
    const category = (await h.ctx.categories.getByCode('J'))!.index;
    return (await h.ctx.db.insertInto('models').values({ category_id: category, name, type: 'RING', sku_prefix: `LG${models}-RG`, default_material: '925 STERLING SILVER', ...extra }).returning('id').executeTakeFirstOrThrow()).id;
  }
  /** A salon order of the size at the default location (FRANCE WAREHOUSE): it holds a piece, or waits for one. */
  async function salonOrder(size: string, modelId: string): Promise<string> {
    const account = await createAccount(h.ctx.db);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(1000);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: size }, admin);
    return id;
  }
  const reservation = async (id: string) => (await h.t.db.selectFrom('orders').select('reservation').where('id', '=', id).executeTakeFirstOrThrow()).reservation;
  /** A Generator piece of the size, counted in: an identity that backs a count. */
  async function piece(modelId: string, size: string, opts: { countIn?: boolean } = {}): Promise<{ id: string; productId: string; skuId: string }> {
    const r = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', variant: size }, admin);
    const row = await h.t.db.selectFrom('products').select(['id', 'product_id', 'sku_id']).where('product_id', '=', r.product.productId).executeTakeFirstOrThrow();
    if (opts.countIn ?? true) await lg().countIn(row.sku_id!, { productRefs: [row.product_id], note: 'On the shelf.' }, admin);
    return { id: row.id, productId: row.product_id, skuId: row.sku_id! };
  }
  const auditsOf = (targetId: string, action: string) => h.t.db.selectFrom('audit_logs').select('details').where('target_id', '=', targetId).where('action', '=', action).orderBy('id').execute();

  it('reads every offered size at each location, 0 included: on hand, reserved, available, waiting, minimum; expected, to order and NO PIECE for ORBES staff only', async () => {
    const model = await createModel('HALO');
    const [s52, s54] = [await skuOf('52', model), await skuOf('54', model)];
    await handCount(s52, france, 3);
    const held = await salonOrder('52', model);
    expect(await reservation(held)).toBe('STOCK');
    const waits = await salonOrder('54', model);
    expect(await reservation(waits)).toBe('AWAITING');
    await lg().setMinimum({ skuId: s52, locationId: france, minimum: 5 }, admin);
    await lg().setMinimum({ skuId: s54, locationId: logistics, minimum: 2 }, admin);
    expect((await auditsOf(s52, 'stock.threshold'))[0]!.details).toEqual({ locationId: france, from: null, to: 5 });
    const staff = await lg().stock({ modelId: model });
    expect(staff.rows.map((r) => [r.sku.sizeLabel, r.location.name, r.onHand, r.reserved, r.available, r.waiting, r.minimum, r.expected, r.toOrder, r.unbacked])).toEqual([
      ['52', 'FRANCE WAREHOUSE', 3, 1, 2, 0, 5, 0, 3, 3],
      ['52', 'LOGISTICS WAREHOUSE', 0, 0, 0, 0, null, 0, 0, 3],
      ['54', 'FRANCE WAREHOUSE', 0, 0, 0, 1, null, 0, 1, 0],
      ['54', 'LOGISTICS WAREHOUSE', 0, 0, 0, 0, 2, 0, 2, 0],
    ]);
    expect(staff.unbackedSizes).toBeGreaterThanOrEqual(1);
    expect(staff.skus.filter((k) => k.model?.id === model).map((k) => k.sizeLabel)).toEqual(['52', '54']);
    expect(staff.locations.map((l) => [l.name, l.isDefault])).toEqual([
      ['FRANCE WAREHOUSE', true],
      ['LOGISTICS WAREHOUSE', false],
    ]);
    // The agent: its location only, without expected, to order nor NO PIECE.
    const mine = await lg().stock({ modelId: model }, agentScope());
    expect(mine.rows.map((r) => [r.sku.sizeLabel, r.location.name])).toEqual([
      ['52', 'LOGISTICS WAREHOUSE'],
      ['54', 'LOGISTICS WAREHOUSE'],
    ]);
    for (const r of mine.rows) expect(Object.keys(r).sort()).toEqual(['available', 'location', 'minimum', 'onHand', 'reserved', 'sku', 'waiting']);
    expect(mine.unbackedSizes).toBeUndefined();
    expect(mine.locations.map((l) => l.name)).toEqual(['LOGISTICS WAREHOUSE']);
    expect(await refusal(lg().stock({ locationId: france }, agentScope()))).toMatchObject({ code: 'STOCK_LOCATION_NOT_FOUND', status: 404 });
    // A login of two locations sees both.
    expect((await lg().stock({ modelId: model }, new Set([logistics, france]))).rows).toHaveLength(4);
    // Minimums: nothing to change, 0 refused, removed.
    expect((await refusal(lg().setMinimum({ skuId: s52, locationId: france, minimum: 5 }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(lg().setMinimum({ skuId: s52, locationId: france, minimum: 0 }, admin))).code).toBe('VALIDATION_FAILED');
    await lg().setMinimum({ skuId: s54, locationId: logistics, minimum: null }, admin);
    expect((await auditsOf(s54, 'stock.threshold')).at(-1)!.details).toEqual({ locationId: logistics, from: 2, to: null });
  });

  it('keeps a set-aside size only where something remains (no new minimum, never to order), and an inactive model\'s sizes only where something remains', async () => {
    const model = await createModel('CREST');
    await h.ctx.services.sizes.declare(model, { sizeType: 'RING', ticked: ['50', '52'] }, admin);
    const s52 = (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', model).where('size_label', '=', '52').executeTakeFirstOrThrow()).id;
    await handCount(s52, france, 2);
    await lg().setMinimum({ skuId: s52, locationId: logistics, minimum: 4 }, admin);
    expect((await h.ctx.services.sizes.removeSize(model, s52, admin)).outcome).toBe('SET_ASIDE');
    const rows = (await lg().stock({ modelId: model })).rows.map((r) => [r.sku.sizeLabel, r.location.name, r.onHand, r.minimum, r.toOrder, r.sku.setAside]);
    expect(rows).toEqual([
      ['50', 'FRANCE WAREHOUSE', 0, null, 0, false],
      ['50', 'LOGISTICS WAREHOUSE', 0, null, 0, false],
      ['52', 'FRANCE WAREHOUSE', 2, null, 0, true],
      ['52', 'LOGISTICS WAREHOUSE', 0, 4, 0, true],
    ]);
    expect(await refusal(lg().setMinimum({ skuId: s52, locationId: france, minimum: 2 }, admin))).toEqual({
      code: 'SIZE_SET_ASIDE',
      status: 409,
      message: 'Size 52 of CREST is set aside. Reinstate it on the model’s page to offer it again.',
    });
    const inactive = await createModel('DUSK');
    const s50 = await skuOf('50', inactive);
    await skuOf('52', inactive);
    await handCount(s50, logistics, 1);
    await h.t.db.updateTable('models').set({ active: false }).where('id', '=', inactive).execute();
    expect((await lg().stock({ modelId: inactive })).rows.map((r) => [r.sku.sizeLabel, r.location.name, r.onHand])).toEqual([['50', 'LOGISTICS WAREHOUSE', 1]]);
  });

  it('reads a hand count and a Generator piece as NO PIECE until counted in; counts named pieces in, and refuses the others', async () => {
    const model = await createModel('ORBITE');
    const s52 = await skuOf('52', model);
    await handCount(s52, logistics, 2);
    expect(await lg().unbacked(s52)).toBe(2);
    const loose = await piece(model, '52', { countIn: false });
    expect(await lg().unbacked(s52)).toBe(2);
    expect(await refusal(lg().countIn(s52, { productRefs: [loose.productId], note: '' }, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
    const counted = await lg().countIn(s52, { productRefs: [loose.productId.toLowerCase()], note: 'On the shelf at LOGISTICS.' }, admin);
    expect(counted).toEqual({ skuId: s52, productIds: [loose.productId], unbacked: 1 });
    // The Stock read's figure (grouped over every size listed) is each size's own.
    const listed = (await lg().stock({ modelId: model })).rows;
    expect(listed.map((r) => r.unbacked)).toContain(1);
    for (const r of listed) expect(r.unbacked, `${r.sku.sizeLabel} at ${r.location.name}`).toBe(await lg().unbacked(r.sku.id));
    expect((await h.t.db.selectFrom('products').select('stock_entered_at').where('id', '=', loose.id).executeTakeFirstOrThrow()).stock_entered_at).toEqual(h.clock.now());
    expect((await auditsOf(s52, 'stock.count_in')).at(-1)!.details).toEqual({ skuId: s52, productIds: [loose.productId] });
    expect(JSON.stringify(await auditsOf(s52, 'stock.count_in'))).not.toContain('shelf');
    // Already counted in; registered; retired; in an order; another size; unknown.
    const notCountable = (id: string) => ({ code: 'PIECE_NOT_COUNTABLE', status: 409, message: `${id} cannot be counted in: it is registered, in an order, retired, or already in stock.` });
    expect(await refusal(lg().countIn(s52, { productRefs: [loose.productId], note: 'Again.' }, admin))).toEqual(notCountable(loose.productId));
    const registered = await piece(model, '52', { countIn: false });
    await h.t.db.updateTable('products').set({ ownership_state: 'REGISTERED' }).where('id', '=', registered.id).execute();
    expect(await refusal(lg().countIn(s52, { productRefs: [registered.productId], note: 'x' }, admin))).toEqual(notCountable(registered.productId));
    const retired = await piece(model, '52', { countIn: false });
    await h.t.db.updateTable('products').set({ status: 'RETIRED' }).where('id', '=', retired.id).execute();
    expect(await refusal(lg().countIn(s52, { productRefs: [retired.productId], note: 'x' }, admin))).toEqual(notCountable(retired.productId));
    const ordered = await piece(model, '52', { countIn: false });
    const order = await salonOrder('52', model);
    await h.t.db.updateTable('orders').set({ product_id: ordered.id }).where('id', '=', order).execute();
    expect(await refusal(lg().countIn(s52, { productRefs: [ordered.productId], note: 'x' }, admin))).toEqual(notCountable(ordered.productId));
    const other = await piece(model, '54', { countIn: false });
    expect(await refusal(lg().countIn(s52, { productRefs: [other.productId], note: 'x' }, admin))).toEqual({ code: 'PIECE_NOT_COUNTABLE', status: 409, message: `${other.productId} is not a piece of ORBITE · 52.` });
    expect(await refusal(lg().countIn(s52, { productRefs: ['O26-J-99999'], note: 'x' }, admin))).toMatchObject({ code: 'PRODUCT_NOT_FOUND', status: 404 });
    expect(await refusal(lg().countIn(s52, { productRefs: ['not a serial'], note: 'x' }, admin))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'not a serial is not an ORBES serial, such as O26-J-00184.' });
    // Refused whole: nothing counted in by a refused request.
    const fine = await piece(model, '52', { countIn: false });
    await refusal(lg().countIn(s52, { productRefs: [fine.productId, registered.productId], note: 'x' }, admin));
    expect((await h.t.db.selectFrom('products').select('stock_entered_at').where('id', '=', fine.id).executeTakeFirstOrThrow()).stock_entered_at).toBeNull();
  });

  it('takes the agent\'s correction for ORBES to approve or decline once; applies ORBES\'s at once; never below reserved nor above the pieces that exist; up, the waiting orders served oldest first', async () => {
    const model = await createModel('ZENITH', { variant_label: 'BLUE', variant_swatch: '#1F3A93' });
    const s52 = await skuOf('52', model);
    // Two pieces exist and are counted at LOGISTICS.
    await piece(model, '52');
    await piece(model, '52');
    const up = await lg().proposeCorrection({ skuId: s52, locationId: logistics, delta: 2, reason: 'Two pieces found on the shelf.' }, agent, agentScope());
    expect(up).toMatchObject({ status: 'TO_APPROVE', delta: 2, reason: 'Two pieces found on the shelf.', location: { id: logistics }, decidedAt: null });
    expect((await lg().stock({ modelId: model, locationId: logistics })).rows[0]!.onHand).toBe(0);
    expect(await refusal(lg().proposeCorrection({ skuId: s52, locationId: france, delta: 1, reason: 'x' }, agent, agentScope()))).toMatchObject({ code: 'STOCK_LOCATION_NOT_FOUND', status: 404 });
    expect((await lg().corrections(agentScope())).toApprove).toBe(1);
    expect(await refusal(lg().correction(up.id, new Set([france])))).toMatchObject({ code: 'CORRECTION_NOT_FOUND', status: 404 });
    const approved = await lg().approveCorrection(up.id, admin);
    expect(approved).toMatchObject({ status: 'APPROVED' });
    expect((await lg().stock({ modelId: model, locationId: logistics })).rows[0]).toMatchObject({ onHand: 2, unbacked: 0 });
    const movement = await h.t.db.selectFrom('stock_corrections').select('movement_id').where('id', '=', up.id).executeTakeFirstOrThrow();
    expect(await h.t.db.selectFrom('stock_movements').select(['reason', 'delta', 'note']).where('id', '=', movement.movement_id!).executeTakeFirstOrThrow()).toEqual({ reason: 'ADJUSTED', delta: 2, note: 'Two pieces found on the shelf.' });
    expect(await refusal(lg().approveCorrection(up.id, admin))).toEqual({ code: 'CORRECTION_NOT_PENDING', status: 409, message: 'This correction has already been decided.' });
    expect((await refusal(lg().declineCorrection(up.id, { note: 'No.' }, admin))).code).toBe('CORRECTION_NOT_PENDING');
    // Above the pieces that exist: refused, at approval and for ORBES's own.
    const tooMany = await lg().proposeCorrection({ skuId: s52, locationId: logistics, delta: 1, reason: 'One more.' }, agent, agentScope());
    expect(await refusal(lg().approveCorrection(tooMany.id, admin))).toEqual({ code: 'STOCK_NOT_BACKED', status: 409, message: 'Only 2 pieces of ZENITH · BLUE · 52 exist to back this count: count a piece in first.' });
    expect((await refusal(lg().proposeCorrection({ skuId: s52, locationId: france, delta: 1, reason: 'One more.' }, admin, null))).code).toBe('STOCK_NOT_BACKED');
    expect(await refusal(lg().declineCorrection(tooMany.id, { note: '' }, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await lg().declineCorrection(tooMany.id, { note: 'Count again: two are on the shelf.' }, admin)).toMatchObject({ status: 'DECLINED', decisionNote: 'Count again: two are on the shelf.' });
    // Below reserved: refused. An order of the size at LOGISTICS cannot be made here (salon orders go to FRANCE): two
    // pieces moved to FRANCE, one held there by an order, then a correction of -2 refused.
    await lg().transfer({ skuId: s52, fromLocationId: logistics, toLocationId: france, quantity: 2 }, admin);
    const holder = await salonOrder('52', model);
    expect(await reservation(holder)).toBe('STOCK');
    expect(await refusal(lg().proposeCorrection({ skuId: s52, locationId: france, delta: -2, reason: 'Damaged.' }, admin, null))).toEqual({ code: 'STOCK_NOT_AVAILABLE', status: 409, message: 'Only 1 piece is available there: the others are reserved by orders.' });
    // ORBES's own correction, applied at once, recorded APPROVED with ORBES as approver.
    const down = await lg().proposeCorrection({ skuId: s52, locationId: france, delta: -1, reason: 'One damaged in handling.' }, admin, null);
    expect(down).toMatchObject({ status: 'APPROVED', delta: -1 });
    expect((await h.t.db.selectFrom('stock_corrections').select(['decided_by', 'proposed_by']).where('id', '=', down.id).executeTakeFirstOrThrow())).toEqual({ decided_by: admin.id, proposed_by: admin.id });
    // Up serves the waiting orders, the oldest first: two orders wait, a third piece exists, one comes back.
    const first = await salonOrder('52', model);
    const second = await salonOrder('52', model);
    expect([await reservation(first), await reservation(second)]).toEqual(['AWAITING', 'AWAITING']);
    const back = await lg().proposeCorrection({ skuId: s52, locationId: france, delta: 1, reason: 'The damaged piece was fine.' }, admin, null);
    expect(back.status).toBe('APPROVED');
    expect([await reservation(first), await reservation(second)]).toEqual(['STOCK', 'AWAITING']);
    const audits = await h.t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', s52).where('action', 'like', 'stock.correction.%').orderBy('id').execute();
    expect(audits.map((a) => a.action)).toEqual([
      'stock.correction.propose',
      'stock.correction.approve',
      'stock.correction.propose',
      'stock.correction.decline',
      'stock.correction.propose',
      'stock.correction.approve',
      'stock.correction.propose',
      'stock.correction.approve',
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/shelf|damaged|fine/i);
  });

  it('serves the orders waiting at a transfer\'s destination', async () => {
    const model = await createModel('ECLAT');
    const s50 = await skuOf('50', model);
    await piece(model, '50');
    await lg().proposeCorrection({ skuId: s50, locationId: logistics, delta: 1, reason: 'Counted.' }, admin, null);
    const waiting = await salonOrder('50', model);
    expect(await reservation(waiting)).toBe('AWAITING');
    await lg().transfer({ skuId: s50, fromLocationId: logistics, toLocationId: france, quantity: 1 }, admin);
    expect(await reservation(waiting)).toBe('STOCK');
    expect((await lg().stock({ modelId: model, locationId: france })).rows[0]).toMatchObject({ onHand: 1, reserved: 1, waiting: 0 });
  });

  it('lists an active add-on\'s SKU after the models\' sizes, named by its add-on (macro scope K48 D1): counted without an identity (never NO PIECE, a correction up needs no piece), a unit held on an order reserved, set aside only where something remains', async () => {
    const a = await h.ctx.services.addons.create({ name: 'Polishing Cloth', skuCode: 'LG-CLOTH', prices: { EUR: 1500 } }, admin);
    const named = { id: a.sku.id, code: 'LG-CLOTH', model: null, addon: { id: a.id, name: 'Polishing Cloth' }, variant: null, sizeLabel: null, setAside: false };
    // Offered at once: 0 at each location, after every model's size.
    let staff = await lg().stock();
    expect(staff.skus.at(-1)).toEqual(named);
    expect(staff.rows.filter((r) => r.sku.id === a.sku.id).map((r) => [r.location.name, r.onHand, r.reserved, r.available, r.waiting, r.minimum, r.expected, r.toOrder, r.unbacked])).toEqual([
      ['FRANCE WAREHOUSE', 0, 0, 0, 0, null, 0, 0, 0],
      ['LOGISTICS WAREHOUSE', 0, 0, 0, 0, null, 0, 0, 0],
    ]);
    expect(staff.rows.findIndex((r) => r.sku.model === null)).toBe(staff.rows.length - 2);
    // A model filter leaves it out.
    expect((await lg().stock({ modelId: catalog.modelId })).rows.some((r) => r.sku.id === a.sku.id)).toBe(false);
    // The agent's correction up: approved without a piece behind it, never NO PIECE.
    const c = await lg().proposeCorrection({ skuId: a.sku.id, locationId: logistics, delta: 5, reason: 'Delivered by hand.' }, agent, agentScope());
    expect(c).toMatchObject({ sku: named, status: 'TO_APPROVE' });
    expect((await lg().approveCorrection(c.id, admin)).status).toBe('APPROVED');
    expect(await lg().unbacked(a.sku.id)).toBe(0);
    // A unit held on an order (M3.10's flow, written here directly): reserved, never taken by a correction down.
    const order = await salonOrder('52', catalog.modelId);
    await h.t.db.insertInto('order_addon_items').values({ order_id: order, addon_id: a.id, sku_id: a.sku.id, location_id: logistics, price_minor: 1500, currency: 'EUR', added_by_type: 'STAFF' }).execute();
    const mine = await lg().stock({ locationId: logistics }, agentScope());
    expect(mine.rows.find((r) => r.sku.id === a.sku.id)).toEqual({ sku: named, location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, onHand: 5, reserved: 1, available: 4, waiting: 0, minimum: null });
    expect(await refusal(lg().proposeCorrection({ skuId: a.sku.id, locationId: logistics, delta: -5, reason: 'Lost.' }, admin, null))).toMatchObject({ code: 'STOCK_NOT_AVAILABLE', status: 409 });
    // A count in names pieces: none is ever an add-on's.
    const other = await piece(catalog.modelId, '52', { countIn: false });
    expect(await refusal(lg().countIn(a.sku.id, { productRefs: [other.productId], note: 'On the shelf.' }, admin))).toEqual({
      code: 'PIECE_NOT_COUNTABLE',
      status: 409,
      message: `${other.productId} is not a piece of Polishing Cloth.`,
    });
    // Under a minimum, it is to order; set aside, only where something remains, never to order.
    await lg().setMinimum({ skuId: a.sku.id, locationId: france, minimum: 2 }, admin);
    staff = await lg().stock();
    expect(staff.rows.find((r) => r.sku.id === a.sku.id && r.location.id === france)).toMatchObject({ minimum: 2, toOrder: 2, unbacked: 0 });
    await h.ctx.services.addons.setAside(a.id, admin);
    staff = await lg().stock();
    expect(staff.skus.some((k) => k.id === a.sku.id)).toBe(false);
    expect(staff.rows.filter((r) => r.sku.id === a.sku.id).map((r) => [r.location.name, r.sku.setAside, r.toOrder])).toEqual([
      ['FRANCE WAREHOUSE', true, 0],
      ['LOGISTICS WAREHOUSE', true, 0],
    ]);
    await h.ctx.services.addons.reinstate(a.id, admin);
  });
});

/**
 * A parcel's box and weight (macro scope D16 B1 and B2; plan MACRO M3 §1.1, step M3.2; services/parcels.ts and
 * services/logistics.ts):
 *
 *  - the box to use: every piece's box when they share one (MODELS), else the largest of their boxes by inside volume
 *    (LARGEST), none set: none, the models without one named; a variant reads its main model's box and weight; a box set
 *    aside counts as none;
 *  - the weight: the box's empty weight plus each piece's packed weight, live while packing; unknown with what is
 *    missing (each model's words, « box »), never blocking;
 *  - CHANGE BOX while PACKING only (PACKING_NOT_STARTED, PACKING_PACKED), an active box (BOX_SET_ASIDE, BOX_NOT_FOUND),
 *    within the agent's locations, audited `shipment.box`;
 *  - PACKED writes the box used, the weight or its missing list, in its transaction: journaled `shipment.pack`, the
 *    audit `order.pack.check` naming them; the checklist's box line « The box: <name>, and the pouch », its key `box`;
 *  - the agent never reads a box's cost.
 */
describe('a parcel\'s box and weight (plan MACRO M3 §1.1)', () => {
  let h: Harness;
  let admin: Actor;
  let agent: Actor;
  let outsider: Actor;
  let france: string;
  let serial = 0;
  const scope = () => new Set([france]);

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    await seedCatalog(h.ctx);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    const elsewhere = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    agent = { type: 'admin', id: (await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [france] })).id };
    outsider = { type: 'admin', id: (await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [elsewhere] })).id };
  });
  afterAll(() => h?.close());

  const lg = () => h.ctx.services.logistics;
  const db = () => h.t.db;
  const box = (name: string, sides: [number, number, number], emptyWeightG: number) =>
    h.ctx.services.boxes.create({ name, insideLengthMm: sides[0], insideWidthMm: sides[1], insideHeightMm: sides[2], emptyWeightG, costMinor: 75, currency: 'EUR' }, admin);
  async function model(name: string, packing: { boxId?: string | null; packedWeightG?: number | null } = {}, variantOf?: string): Promise<string> {
    serial += 1;
    const category = (await h.ctx.categories.getByCode('J'))!.index;
    const id = (
      await db()
        .insertInto('models')
        .values({
          category_id: category,
          name,
          type: 'RING',
          sku_prefix: `BX${serial}-RG`,
          default_material: '925 STERLING SILVER',
          ...(variantOf ? { variant_of: variantOf, variant_label: `V${serial}`, variant_swatch: '#1F3A93' } : {}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    if (packing.boxId !== undefined || packing.packedWeightG !== undefined) await h.ctx.services.catalog.setModelPacking(id, packing, admin);
    return id;
  }
  /** A salon order of a model in size 52, priced and paid, holding its piece at FRANCE WAREHOUSE. */
  async function readyOrder(modelId: string): Promise<string> {
    const account = await createAccount(db());
    const request = await db().insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(1000);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await db().selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    const sku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, modelId, '52'));
    await stockPieces(h.ctx, { skuId: sku, locationId: france, count: 1, forOrderIds: [id] }, admin);
    h.clock.advance(1000);
    await h.ctx.services.orders.transition(id, { to: 'PAID' }, admin);
    return id;
  }
  const shipmentOf = (key: string) => db().selectFrom('shipments').selectAll().where('order_id', '=', key).where('status', '<>', 'CANCELLED').executeTakeFirstOrThrow();

  it('suggests the pieces\' shared box, weighs it live, and writes the box and weight at PACKED: journaled shipment.pack, audited with order.pack.check; the agent never reads a cost', async () => {
    const cube = await box('CUBE 100', [100, 70, 40], 120);
    const m = await model('HALO', { boxId: cube.id, packedWeightG: 85 });
    const key = await readyOrder(m);
    const ready = await lg().parcel(key, scope());
    expect(ready.step).toBe('READY_TO_PACK');
    expect(ready.packing).toMatchObject({
      box: { id: cube.id, name: 'CUBE 100', insideLengthMm: 100, insideWidthMm: 70, insideHeightMm: 40, emptyWeightG: 120, active: true },
      boxSource: 'MODELS',
      pieces: 1,
      modelsWithoutBox: [],
      weightG: 205,
      missing: [],
      recorded: false,
    });
    expect(ready.packing.boxes.map((b) => b.name)).toContain('CUBE 100');
    expect(JSON.stringify(ready)).not.toMatch(/cost|currency/i);
    expect(ready.checklist.find((l) => l.key === 'box')).toEqual({ key: 'box', label: 'The box: CUBE 100, and the pouch', byScan: false, ticked: false });
    await packParcel(h.ctx, key, {}, agent);
    const s = await shipmentOf(key);
    expect({ status: s.status, box_id: s.box_id, weight_g: s.weight_g, weight_missing: s.weight_missing }).toEqual({ status: 'PACKED', box_id: cube.id, weight_g: 205, weight_missing: null });
    expect(s.checklist.find((l) => l.key === 'box')).toEqual({ key: 'box', label: 'The box: CUBE 100, and the pouch' });
    const journal = await db().selectFrom('event_journal').select(['type', 'entity_type', 'payload']).where('entity_id', '=', s.id).execute();
    expect(journal).toEqual([
      { type: 'shipment.pack', entity_type: 'shipment', payload: { id: s.id, orderId: key, orderIds: [key], boxId: cube.id, weightG: 205, weightMissing: null, packedAt: s.packed_at!.toISOString() } },
    ]);
    expect((await h.ctx.audit.list({ action: 'order.pack.check', targetId: key })).items[0]).toMatchObject({ actorId: agent.id, details: { boxId: cube.id, weightG: 205, weightMissing: null } });
    // The model's box and weight changed after: the parcel reads what was written.
    await h.ctx.services.catalog.setModelPacking(m, { packedWeightG: 300 }, admin);
    const packed = await lg().parcel(key, scope());
    expect(packed.packing).toMatchObject({ box: { id: cube.id }, weightG: 205, missing: [], recorded: true, boxes: [] });
    expect(packed.checklist.find((l) => l.key === 'box')!.label).toBe('The box: CUBE 100, and the pouch');
  });

  it('never blocks on a missing weight: no box and no packed weight are packed with what was missing, the box line as before', async () => {
    const m = await model('BARE');
    const key = await readyOrder(m);
    const view = await lg().parcel(key, scope());
    expect(view.packing).toMatchObject({ box: null, boxSource: null, modelsWithoutBox: ['BARE'], weightG: null, missing: ['BARE', 'box'], recorded: false });
    expect(view.checklist.find((l) => l.key === 'box')!.label).toBe('The box and the pouch');
    await packParcel(h.ctx, key, {}, admin);
    const s = await shipmentOf(key);
    expect({ box_id: s.box_id, weight_g: s.weight_g, weight_missing: s.weight_missing }).toEqual({ box_id: null, weight_g: null, weight_missing: ['BARE', 'box'] });
    expect((await lg().parcel(key, scope())).packing).toMatchObject({ box: null, weightG: null, missing: ['BARE', 'box'], recorded: true });
  });

  it('a variant reads its main model\'s box and weight; several pieces sharing a box are weighed together; boxes of different sizes give the largest by volume; a box set aside counts as none', async () => {
    const small = await box('SMALL', [100, 70, 30], 100);
    const large = await box('LARGE', [200, 150, 80], 300);
    const main = await model('ECLIPSE', { boxId: small.id, packedWeightG: 60 });
    await db().updateTable('models').set({ variant_label: 'Silver', variant_swatch: '#D7D5D0' }).where('id', '=', main).execute();
    const steel = await model('ECLIPSE', {}, main);
    const gold = await model('ECLIPSE', { packedWeightG: 90 }, main);
    // A main model and two of its variants in one parcel (as a LIVE entry's pieces travel together): one box shared,
    // each piece's weight, a variant without its own reading its main model's.
    const piece = (modelId: string, i: number) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, model_id: modelId });
    const shared = await packingSuggestion(db(), [piece(main, 1), piece(steel, 2), piece(gold, 3)]);
    expect({ box: shared.box?.id, source: shared.source, without: shared.modelsWithoutBox }).toEqual({ box: small.id, source: 'MODELS', without: [] });
    expect(parcelWeight(shared.box, shared)).toEqual({ weightG: 100 + 60 + 60 + 90, missing: [] });
    // A piece of another box: the largest of the two by its inside volume; a model without a box is named.
    const other = await model('ATLAS', { boxId: large.id, packedWeightG: 40 });
    const bare = await model('NOBOX', { packedWeightG: 20 });
    const mixed = await packingSuggestion(db(), [piece(main, 1), piece(other, 2), piece(bare, 3)]);
    expect({ box: mixed.box?.id, source: mixed.source, without: mixed.modelsWithoutBox }).toEqual({ box: large.id, source: 'LARGEST', without: ['NOBOX'] });
    expect(parcelWeight(mixed.box, mixed)).toEqual({ weightG: 300 + 60 + 40 + 20, missing: [] });
    // Unknown: a piece without a packed weight, named once however many pieces of it.
    const light = await model('NOWEIGHT', { boxId: small.id });
    const unknown = await packingSuggestion(db(), [piece(light, 1), piece(light, 2), piece(main, 3)]);
    expect(parcelWeight(unknown.box, unknown)).toEqual({ weightG: null, missing: ['NOWEIGHT'] });
    expect(parcelWeight(null, shared)).toEqual({ weightG: null, missing: ['box'] });
    // LARGE set aside (ATLAS made inactive first, as no active model may pack in a box set aside): it counts as none.
    await db().updateTable('models').set({ active: false }).where('id', '=', other).execute();
    await h.ctx.services.boxes.setAside(large.id, admin);
    const after = await packingSuggestion(db(), [piece(main, 1), piece(other, 2), piece(bare, 3)]);
    expect({ box: after.box?.id, source: after.source, without: after.modelsWithoutBox }).toEqual({ box: small.id, source: 'MODELS', without: ['ATLAS', 'NOBOX'] });
    // On a parcel being packed, the variant's piece reads its main model's box and weight, and the box set aside is not offered.
    const key = await readyOrder(steel);
    const view = await lg().parcel(key, scope());
    expect(view.packing).toMatchObject({ box: { id: small.id }, boxSource: 'MODELS', pieces: 1, weightG: 160, missing: [] });
    expect(view.packing.boxes.map((b) => b.id)).toContain(small.id);
    expect(view.packing.boxes.map((b) => b.id)).not.toContain(large.id);
  });

  it('CHANGE BOX while packing only: an active box of the house, kept and written at PACKED, audited shipment.box; refused before, after, set aside, unknown, or outside the agent\'s locations', async () => {
    const cube = await box('CHANGE CUBE', [100, 70, 40], 120);
    const flat = await box('CHANGE FLAT', [160, 110, 20], 90);
    const aside = await box('CHANGE ASIDE', [160, 110, 20], 90);
    await h.ctx.services.boxes.setAside(aside.id, admin);
    const m = await model('PRISM', { boxId: cube.id, packedWeightG: 50 });
    const key = await readyOrder(m);
    expect(await refusal(lg().chooseBox(key, { boxId: flat.id }, agent, scope()))).toMatchObject({ code: 'PACKING_NOT_STARTED', status: 409 });
    await scanIntoParcel(h.ctx, key, {}, admin);
    expect(await refusal(lg().chooseBox(key, { boxId: aside.id }, agent, scope()))).toMatchObject({ code: 'BOX_SET_ASIDE', status: 409 });
    expect(await refusal(lg().chooseBox(key, { boxId: '00000000-0000-4000-8000-000000000000' }, agent, scope()))).toMatchObject({ code: 'BOX_NOT_FOUND', status: 404 });
    expect(await refusal(lg().chooseBox(key, { boxId: flat.id }, outsider, new Set(['00000000-0000-4000-8000-000000000001'])))).toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
    const chosen = await lg().chooseBox(key, { boxId: flat.id }, agent, scope());
    expect(chosen.packing).toMatchObject({ box: { id: flat.id, name: 'CHANGE FLAT' }, boxSource: 'CHOSEN', weightG: 90 + 50 });
    expect(chosen.checklist.find((l) => l.key === 'box')!.label).toBe('The box: CHANGE FLAT, and the pouch');
    const s = await shipmentOf(key);
    expect((await h.ctx.audit.list({ action: 'shipment.box', targetId: s.id })).items[0]).toMatchObject({ actorId: agent.id, details: { parcel: key, from: null, to: flat.id } });
    // The same box again: nothing written. Back to the models' box: read as theirs.
    await lg().chooseBox(key, { boxId: flat.id }, agent, scope());
    expect((await h.ctx.audit.list({ action: 'shipment.box', targetId: s.id })).items).toHaveLength(1);
    expect((await lg().chooseBox(key, { boxId: cube.id }, admin, null)).packing).toMatchObject({ box: { id: cube.id }, boxSource: 'MODELS' });
    await lg().chooseBox(key, { boxId: flat.id }, admin, null);
    await lg().setPhoto(key, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, agent, scope());
    const before = await lg().parcel(key, scope());
    await lg().checkPacked(key, { ticked: before.checklist.filter((l) => !l.byScan).map((l) => l.key) }, agent, scope());
    expect(await shipmentOf(key)).toMatchObject({ status: 'PACKED', box_id: flat.id, weight_g: 140, weight_missing: null });
    expect((await lg().parcel(key, scope())).packing).toMatchObject({ box: { id: flat.id }, boxSource: 'CHOSEN', weightG: 140, recorded: true });
    expect(await refusal(lg().chooseBox(key, { boxId: cube.id }, agent, scope()))).toMatchObject({ code: 'PACKING_PACKED', status: 409 });
  });
});
