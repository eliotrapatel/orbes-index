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
 *    its refusals.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, issue, seedCatalog, type Catalog, type Harness } from '../api/support.js';
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
    expect(staff.skus.filter((k) => k.model.id === model).map((k) => k.sizeLabel)).toEqual(['52', '54']);
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
});
