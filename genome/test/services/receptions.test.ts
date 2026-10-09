/**
 * The receptions (plan NEXT LOT of 2026-10-07, §3.5.6.5, step 5.7; services/receptions.ts, migration 0036), on the
 * service as createContext wires it and on a twin with a lighter claim-code hash (scrypt N = 2^10: the hash format and
 * its check are the real ones; 500 pieces at N = 2^15 would take a minute):
 *
 *  - the agent's one way in: the reference only (SO-…, any case, with or without its dash), an open order of its
 *    locations, its lines without a price; anything else 404 SUPPLIER_ORDER_NOT_FOUND in the same words; the orders on
 *    their way for ORBES staff only;
 *  - the count: at least one piece, a note beyond the expected or for a size not on the order, one open reception per
 *    order, counted again, sent back, counted again; SUPPLIER_ORDER_CLOSED on a closed order, also at confirmation;
 *    the material of every model before confirming, kept by the Catalogue while identities of it are owed, a line
 *    whose model lost it anyway passed over by the worker; the order's lines, the rejected pieces to send back, its status;
 *  - the issuing: no timer in tests (nothing issued until `issuePending`); identities ISSUED with their reception line,
 *    their codes signed and their claim codes sealed for the cards; one RECEIVED movement per chunk; the waiting
 *    orders served strictly oldest first, a reshipment (`queue_first`) first; a crash between chunks resumed without a
 *    piece issued twice; 500 pieces in chunks of 50; the worker's own timer when started;
 *  - the cards: RECEPTION_ISSUING until every identity is issued; runs fixed by serial (48 and 50) that never shift; a
 *    code replaced (NEW CLAIM CODE or a hash no longer matching), a piece registered, a sealed copy that no longer
 *    opens: skipped and erased; a sold piece's card never printed (its copy erased by the packing scan, or at printing
 *    without being opened); Cards attached erases the rest, then CARDS_ATTACHED;
 *  - the rejected pieces sent back by the agent; every row of another location 404 for the agent;
 *  - no claim code in an audit, the journal or a log.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toBase64Url } from '../../src/core/bytes.js';
import { openText } from '../../src/server/crypto/secretbox.js';
import { DomainError } from '../../src/server/errors.js';
import { normalizeClaimCode, verifyClaimCode } from '../../src/server/services/claim-codes.js';
import type { IssuanceService } from '../../src/server/services/issuance.js';
import { cardAad, deriveCardClaimKey, RECEPTION_ISSUE_CHUNK, ReceptionService } from '../../src/server/services/receptions.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { supplierOrderReference } from '../../src/server/services/supplier-orders.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { packAndShip } from '../support/fulfil.js';
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

/** The real hash format at N = 2^10: verifyClaimCode reads its cost from it. */
async function lightHash(code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = scryptSync(Buffer.from(normalizeClaimCode(code)!, 'utf8'), salt, 32, { N: 1024, r: 8, p: 1 });
  return `scrypt$10$8$1$${toBase64Url(salt)}$${toBase64Url(key)}`;
}

const NOT_EXPECTED = (ref: string) => ({ code: 'SUPPLIER_ORDER_NOT_FOUND', status: 404, message: `No supplier order ${ref} is expected here. Check the reference, or ask ORBES.` });

describe('ReceptionService (plan NEXT LOT §3.5.6.5)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let agent: Actor;
  let france: string;
  let logistics: string;
  let rs: ReceptionService;
  let k50: string;
  let k52: string;
  let k54: string;
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
    const nord = await h.ctx.services.suppliers.create({ name: 'Maison Nord', currency: 'EUR' }, admin);
    await h.ctx.services.suppliers.setModelSupplier(catalog.modelId, { supplierId: nord.id }, admin);
    [k50, k52, k54] = [await skuOf('50'), await skuOf('52'), await skuOf('54')];
    rs = twin();
  });
  afterAll(() => h?.close());

  const so = () => h.ctx.services.supplierOrders;
  const skuOf = (label: string, modelId = catalog.modelId) => h.ctx.db.transaction().execute((tx) => ensureSku(tx, modelId, label));
  const twin = (issuance: Pick<IssuanceService, 'inSigningTransaction'> = h.ctx.services.issuance) =>
    new ReceptionService({ db: h.ctx.db, audit: h.ctx.audit, issuance, certificates: h.ctx.services.certificates, cardKey: deriveCardClaimKey(h.ctx.config), clock: h.clock.now, hashClaim: lightHash });

  /** A supplier order sent to a location, with its lines. */
  async function sentOrder(locationId: string, lines: [string, number][]): Promise<{ id: string; reference: string }> {
    let id = '';
    for (const [skuId, quantity] of lines) id = (await so().addToDraft({ skuId, locationId, quantity }, admin)).id;
    await so().updateDraft(id, { lines: lines.map(([skuId, quantity]) => ({ skuId, quantity, unitPriceMinor: 12_000 })), expectedOn: '2026-11-02' }, admin);
    const sent = await so().send(id, admin);
    return { id: sent.id, reference: sent.reference };
  }
  /** Counted by ORBES staff and confirmed, then issued. */
  async function received(locationId: string, lines: [string, number][], opts: { issue?: boolean } = {}) {
    const order = await sentOrder(locationId, lines);
    const r = await rs.record(order.id, { lines: lines.map(([skuId, accepted]) => ({ skuId, accepted, rejected: 0 })) }, admin, null);
    await rs.confirm(r.id, admin);
    if (opts.issue ?? true) await rs.issuePending();
    return { order, reception: await rs.view(r.id, null) };
  }
  /** A salon order of the size at the default location (FRANCE WAREHOUSE): it holds a piece, or waits for one. */
  async function salonOrder(size: string): Promise<string> {
    const account = await createAccount(h.ctx.db);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(1000);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: size }, admin);
    return id;
  }
  const productsOf = (receptionId: string) =>
    h.t.db
      .selectFrom('products as p')
      .innerJoin('reception_lines as rl', 'rl.id', 'p.reception_line_id')
      .select(['p.id', 'p.product_id', 'p.serial', 'p.status', 'p.sku_id', 'p.stock_entered_at', 'p.production_batch', 'p.claim_secret_hash'])
      .where('rl.reception_id', '=', receptionId)
      .orderBy('p.serial')
      .execute();
  const receivedMovements = (receptionId: string) =>
    h.t.db
      .selectFrom('stock_movements as m')
      .innerJoin('reception_lines as rl', 'rl.id', 'm.reception_line_id')
      .select(['m.delta', 'm.reason', 'm.location_id', 'm.sku_id'])
      .where('rl.reception_id', '=', receptionId)
      .orderBy('m.id')
      .execute();

  it('lets the agent in by the reference only: an open order of its locations, its lines without a price; anything else 404 in the same words; the orders on their way for ORBES staff', async () => {
    const order = await sentOrder(logistics, [[k52, 3], [k54, 2]]);
    const hex = order.reference.slice(3);
    for (const typed of [order.reference, order.reference.toLowerCase(), `SO${hex}`, ` ${order.reference} `]) {
      const found = await rs.findForReception(typed, agentScope());
      expect(found.id, typed).toBe(order.id);
    }
    const found = await rs.findForReception(order.reference, agentScope());
    expect(found).toMatchObject({ reference: order.reference, supplierName: 'Maison Nord', location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, expectedOn: '2026-11-02' });
    expect(found.lines.map((l) => [l.sku.sizeLabel, l.ordered, l.alreadyReceived, l.expected])).toEqual([
      ['52', 3, 0, 3],
      ['54', 2, 0, 2],
    ]);
    expect(found.offered.map((s) => s.sizeLabel)).toEqual(['50', '52', '54']);
    expect(JSON.stringify(found)).not.toMatch(/price|Minor|currency|total|email|phone/i);
    // Another location, a draft, an unknown or malformed reference: the same 404.
    const elsewhere = await sentOrder(france, [[k50, 1]]);
    expect(await refusal(rs.findForReception(elsewhere.reference, agentScope()))).toEqual(NOT_EXPECTED(elsewhere.reference));
    expect(await refusal(rs.linesFor(elsewhere.id, agentScope()))).toMatchObject({ code: 'SUPPLIER_ORDER_NOT_FOUND', status: 404 });
    const draft = await so().addToDraft({ skuId: k50, locationId: logistics, quantity: 1 }, admin);
    expect(await refusal(rs.findForReception(draft.reference, agentScope()))).toEqual(NOT_EXPECTED(draft.reference));
    expect(await refusal(rs.findForReception('SO-00000000', agentScope()))).toEqual(NOT_EXPECTED('SO-00000000'));
    expect(await refusal(rs.findForReception('7C21A0B9-xx', agentScope()))).toMatchObject({ code: 'SUPPLIER_ORDER_NOT_FOUND', status: 404, message: 'No supplier order with this reference is expected here. Check the reference, or ask ORBES.' });
    await so().discardDraft(draft.id, admin);
    // ORBES staff: every location, and the orders on their way (never the agent's: the routes keep it from LOGISTICS).
    expect((await rs.findForReception(elsewhere.reference, null)).id).toBe(elsewhere.id);
    const expected = await rs.expected(logistics);
    expect(expected.find((e) => e.id === order.id)).toEqual({ id: order.id, reference: order.reference, supplierName: 'Maison Nord', location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, expectedOn: '2026-11-02', piecesExpected: 5 });
    expect((await rs.expected()).map((e) => e.id)).toEqual(expect.arrayContaining([order.id, elsewhere.id]));
    expect((await rs.board(agentScope())).expected).toBeUndefined();
    expect((await rs.board(null)).expected!.map((e) => e.id)).toEqual(expect.arrayContaining([order.id, elsewhere.id]));
  });

  it('counts a delivery: one piece at least, a note beyond the expected or for a size not on the order; one open reception; counted again, sent back, counted again; confirmed onto the order\'s lines, its returns and its status', async () => {
    const order = await sentOrder(logistics, [[k52, 3], [k54, 2]]);
    const scope = agentScope();
    expect(await refusal(rs.record(order.id, { lines: [{ skuId: k52, accepted: 0, rejected: 0 }] }, agent, scope))).toEqual({ code: 'RECEPTION_EMPTY', status: 422, message: 'Count at least one piece.' });
    expect((await refusal(rs.record(order.id, { lines: [{ skuId: k52, accepted: 4, rejected: 0 }] }, agent, scope))).code).toBe('RECEPTION_NOTE_REQUIRED');
    expect((await refusal(rs.record(order.id, { lines: [{ skuId: k50, accepted: 1, rejected: 0 }] }, agent, scope))).code).toBe('RECEPTION_NOTE_REQUIRED');
    const r = await rs.record(
      order.id,
      { lines: [{ skuId: k52, accepted: 2, rejected: 1 }, { skuId: k50, accepted: 1, rejected: 0, note: 'A 50 came in the box.' }], deliveryNote: 'BL-2210', note: 'One 52 scratched.' },
      agent,
      scope,
    );
    expect(r).toMatchObject({ status: 'TO_CONFIRM', supplierOrder: { id: order.id, reference: order.reference }, supplierName: null, deliveryNote: 'BL-2210', accepted: 3, rejected: 1, issuing: { issued: 0, accepted: 3, done: false } });
    expect(r.lines.map((l) => [l.sku.sizeLabel, l.onOrder, l.accepted, l.rejected, l.note])).toEqual(
      expect.arrayContaining([
        ['52', true, 2, 1, null],
        ['50', false, 1, 0, 'A 50 came in the box.'],
      ]),
    );
    expect(r.lines).toHaveLength(2);
    expect(await refusal(rs.record(order.id, { lines: [{ skuId: k54, accepted: 1, rejected: 0 }] }, agent, scope))).toMatchObject({ code: 'RECEPTION_OPEN', status: 409 });
    // Counted again; sent back by ORBES; counted again → TO_CONFIRM.
    await rs.update(r.id, { lines: [{ skuId: k52, accepted: 2, rejected: 1 }, { skuId: k54, accepted: 2, rejected: 0 }] }, agent, scope);
    const back = await rs.sendBack(r.id, { note: 'Count the 54 again.' }, admin);
    expect(back).toMatchObject({ status: 'SENT_BACK', sentBack: { note: 'Count the 54 again.' } });
    expect((await rs.board(scope)).toConfirm.map((v) => [v.id, v.status])).toContainEqual([r.id, 'SENT_BACK']);
    expect(await refusal(rs.confirm(r.id, admin))).toMatchObject({ code: 'RECEPTION_SENT_BACK', status: 409 });
    await rs.update(r.id, { lines: [{ skuId: k52, accepted: 2, rejected: 1 }, { skuId: k54, accepted: 1, rejected: 0 }], deliveryNote: 'BL-2210' }, agent, scope);
    expect((await rs.view(r.id, scope)).status).toBe('TO_CONFIRM');
    expect((await rs.board(null)).count).toBeGreaterThanOrEqual(1);
    // Confirmed: the order's lines counted, the rejected listed to send back, PARTLY_RECEIVED; nothing issued without the worker.
    const done = await rs.confirm(r.id, admin);
    expect(done).toMatchObject({ status: 'CONFIRMED', issuing: { issued: 0, accepted: 3, done: false } });
    expect((await so().get(order.id)).status).toBe('PARTLY_RECEIVED');
    const lines = await h.t.db.selectFrom('supplier_order_lines').select(['sku_id', 'accepted_quantity', 'rejected_quantity']).where('supplier_order_id', '=', order.id).execute();
    expect(new Map(lines.map((l) => [l.sku_id, [l.accepted_quantity, l.rejected_quantity]]))).toEqual(new Map([[k52, [2, 1]], [k54, [1, 0]]]));
    expect(await refusal(rs.update(r.id, { lines: [{ skuId: k52, accepted: 1, rejected: 0 }] }, agent, scope))).toMatchObject({ code: 'RECEPTION_CONFIRMED', status: 409 });
    expect(await refusal(rs.confirm(r.id, admin))).toMatchObject({ code: 'RECEPTION_CONFIRMED', status: 409 });
    expect(await refusal(rs.printCards(r.id, { layout: 'sheet' }, agent, scope))).toEqual({ code: 'RECEPTION_ISSUING', status: 409, message: 'The identities are still being issued: print the cards once they are all issued.' });
    expect((await refusal(rs.cardsAttached(r.id, agent, scope))).code).toBe('RECEPTION_ISSUING');
    // Already received on the next count: accepted + rejected.
    expect((await rs.linesFor(order.id, scope)).lines.map((l) => [l.sku.sizeLabel, l.alreadyReceived, l.expected])).toEqual([
      ['52', 3, 1],
      ['54', 1, 1],
    ]);
    // The rejected pieces, back to the supplier by the agent.
    const [ret] = (await rs.board(scope)).backToSupplier.filter((x) => x.supplierOrder.id === order.id);
    expect(ret).toMatchObject({ sku: { id: k52 }, quantity: 1, status: 'TO_RETURN' });
    expect((await refusal(rs.supplierReturnSent(ret!.id, { trackingNumber: 'AB123456' }, agent, scope))).code).toBe('VALIDATION_FAILED');
    const carrier = (await h.t.db.selectFrom('carriers').select('id').where('active', '=', true).executeTakeFirstOrThrow()).id;
    expect(await refusal(rs.supplierReturnSent(ret!.id, {}, agent, new Set([france])))).toMatchObject({ code: 'SUPPLIER_RETURN_NOT_FOUND', status: 404 });
    expect(await rs.supplierReturnSent(ret!.id, { carrierId: carrier, trackingNumber: 'AB123456' }, agent, scope)).toMatchObject({ id: ret!.id, status: 'RETURNED' });
    expect((await refusal(rs.supplierReturnSent(ret!.id, {}, agent, scope))).code).toBe('SUPPLIER_RETURN_SENT');
    // The audit: counts and ids, never a note's words.
    const audits = await h.t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', r.id).orderBy('id').execute();
    expect(audits.map((a) => a.action)).toEqual(['reception.record', 'reception.update', 'reception.send_back', 'reception.update', 'reception.confirm']);
    expect(audits[4]!.details).toMatchObject({ supplierOrderId: order.id, accepted: 3, rejected: 1, status: 'PARTLY_RECEIVED' });
    expect(JSON.stringify(audits)).not.toMatch(/scratched|again|came in the box/);
  });

  it('refuses a closed order: no reception counted, none confirmed onto it; and a model without its material', async () => {
    const order = await sentOrder(logistics, [[k50, 2]]);
    const r = await rs.record(order.id, { lines: [{ skuId: k50, accepted: 2, rejected: 0 }] }, admin, null);
    // Closed meanwhile (here by hand): the confirmation locks the order first and refuses.
    await h.t.db.updateTable('supplier_orders').set({ status: 'RECEIVED', received_at: h.clock.now() }).where('id', '=', order.id).execute();
    expect(await refusal(rs.confirm(r.id, admin))).toEqual({ code: 'SUPPLIER_ORDER_CLOSED', status: 409, message: 'This supplier order expects nothing more.' });
    expect(await refusal(rs.update(r.id, { lines: [{ skuId: k50, accepted: 1, rejected: 0 }] }, admin, null))).toMatchObject({ code: 'SUPPLIER_ORDER_CLOSED', status: 409 });
    expect((await rs.view(r.id, null)).status).toBe('TO_CONFIRM');
    // Cancel the rest of an order: nothing more counted against it.
    const other = await sentOrder(logistics, [[k54, 1]]);
    await so().cancelRest(other.id, { note: 'The supplier stopped this size.' }, admin);
    expect(await refusal(rs.record(other.id, { lines: [{ skuId: k54, accepted: 1, rejected: 0 }] }, admin, null))).toMatchObject({ code: 'SUPPLIER_ORDER_CLOSED', status: 409 });
    // A variant without a material (nor its main model's): named in the refusal.
    const variant = (
      await h.ctx.db
        .insertInto('models')
        .values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'ECLAT', type: 'RING', sku_prefix: 'ECL-RG', variant_label: 'BLUE', variant_swatch: '#1F3A93', supplier_id: (await h.t.db.selectFrom('suppliers').select('id').where('name', '=', 'Maison Nord').executeTakeFirstOrThrow()).id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const kv = await skuOf('52', variant);
    const bare = await sentOrder(logistics, [[kv, 1]]);
    const rb = await rs.record(bare.id, { lines: [{ skuId: kv, accepted: 1, rejected: 0 }] }, admin, null);
    expect(await refusal(rs.confirm(rb.id, admin))).toEqual({ code: 'RECEPTION_MATERIAL_MISSING', status: 409, message: 'Set the material of ECLAT · BLUE in the Catalogue before confirming.' });
    await h.ctx.db.updateTable('models').set({ default_material: '925 STERLING SILVER' }).where('id', '=', variant).execute();
    expect((await rs.confirm(rb.id, admin)).status).toBe('CONFIRMED');
    await rs.issuePending();
    // A reception of rejected pieces only is issued at once (nothing to issue).
    const rejectedOnly = await sentOrder(logistics, [[k54, 1]]);
    const ro = await rs.record(rejectedOnly.id, { lines: [{ skuId: k54, accepted: 0, rejected: 1 }] }, admin, null);
    await rs.confirm(ro.id, admin);
    expect(await rs.issuePending()).toBe(0);
    expect((await rs.view(ro.id, null)).issuing).toEqual({ issued: 0, accepted: 0, done: true });
    // It has no card: never in Cards to print, nor in the agent's counter; its rejected piece waits to go back.
    for (const scope of [null, agentScope()]) {
      const board = await rs.board(scope);
      expect(board.cardsToPrint.map((v) => v.id)).not.toContain(ro.id);
      expect(board.toConfirm.map((v) => v.id)).not.toContain(ro.id);
      expect(board.backToSupplier.map((x) => x.supplierOrder.id)).toContain(rejectedOnly.id);
    }
  });

  it('keeps a model\'s material while a confirmed reception owes identities of it; a line whose model lost it anyway is passed over and the other receptions keep issuing', async () => {
    const velum = (
      await h.ctx.db
        .insertInto('models')
        .values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'VELUM', type: 'RING', sku_prefix: 'VEL-RG', default_material: '750 YELLOW GOLD', supplier_id: (await h.t.db.selectFrom('suppliers').select('id').where('name', '=', 'Maison Nord').executeTakeFirstOrThrow()).id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const kv = await skuOf('52', velum);
    const first = await received(logistics, [[kv, 2]], { issue: false });
    h.clock.advance(1000);
    const second = await received(logistics, [[k52, 2]], { issue: false });
    // The Catalogue keeps the material while its identities are owed.
    expect(await refusal(h.ctx.services.catalog.updateModel(velum, { defaultMaterial: null }, admin))).toEqual({
      code: 'MODEL_MATERIAL_IN_USE',
      status: 409,
      message: 'The identities of a confirmed reception of VELUM are still being issued: its material stays until they are.',
    });
    expect(await refusal(h.ctx.services.catalog.updateModel(velum, { defaultMaterial: '  ' }, admin))).toMatchObject({ code: 'MODEL_MATERIAL_IN_USE' });
    // Lost anyway (written by hand): the first reception's line is passed over, the second is issued.
    await h.t.db.updateTable('models').set({ default_material: null }).where('id', '=', velum).execute();
    expect(await rs.issuePending()).toBe(2);
    expect((await rs.view(first.reception.id, null)).issuing).toEqual({ issued: 0, accepted: 2, done: false });
    expect((await rs.view(second.reception.id, null)).issuing).toEqual({ issued: 2, accepted: 2, done: true });
    expect(await h.t.db.selectFrom('card_prints').select('product_id').where('reception_id', '=', first.reception.id).execute()).toEqual([]);
    // Its material entered again: the first reception is issued too; once nothing is owed, the material may be cleared.
    await h.ctx.services.catalog.updateModel(velum, { defaultMaterial: '750 YELLOW GOLD' }, admin);
    expect(await rs.issuePending()).toBe(2);
    expect((await rs.view(first.reception.id, null)).issuing).toEqual({ issued: 2, accepted: 2, done: true });
    expect((await h.ctx.services.catalog.updateModel(velum, { defaultMaterial: null }, admin)).defaultMaterial).toBeNull();
  });

  it('issues the identities: ISSUED in the stock with their reception line, signed, their claim codes sealed for the cards; one RECEIVED movement per chunk; nothing without the worker; no claim code in an audit or the journal', async () => {
    const { order, reception } = await received(logistics, [[k52, 3], [k54, 2]], { issue: false });
    expect(reception.issuing).toEqual({ issued: 0, accepted: 5, done: false });
    // No timer in tests: nothing issued until the worker runs.
    expect(await productsOf(reception.id)).toEqual([]);
    expect(await rs.issuePending()).toBe(5);
    const after = await rs.view(reception.id, null);
    expect(after.issuing).toEqual({ issued: 5, accepted: 5, done: true });
    const pieces = await productsOf(reception.id);
    expect(pieces).toHaveLength(5);
    for (const p of pieces) expect(p).toMatchObject({ status: 'ISSUED', production_batch: order.reference, stock_entered_at: h.clock.now() });
    expect(pieces.filter((p) => p.sku_id === k52)).toHaveLength(3);
    expect((await receivedMovements(reception.id)).map((m) => [m.sku_id, m.delta, m.reason, m.location_id]).sort()).toEqual([[k52, 3, 'RECEIVED', logistics], [k54, 2, 'RECEIVED', logistics]].sort());
    // Each claim code sealed for its own piece: it opens with the key and its AAD only, and matches the piece's hash.
    const key = deriveCardClaimKey(h.ctx.config);
    const cards = await h.t.db.selectFrom('card_prints').selectAll().where('reception_id', '=', reception.id).execute();
    expect(cards).toHaveLength(5);
    for (const c of cards) {
      const code = openText(key, c.sealed_claim_code!, cardAad(c.product_id));
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(c.sealed_claim_code).not.toContain(code);
      expect(await verifyClaimCode(code, pieces.find((p) => p.id === c.product_id)!.claim_secret_hash!)).toBe(true);
      expect(() => openText(key, c.sealed_claim_code!, cardAad(cards.find((x) => x.product_id !== c.product_id)!.product_id))).toThrow();
    }
    // Audited: every identity with its reception, then the reception issued; never a claim code.
    const issuedAudit = (await h.t.db.selectFrom('audit_logs').select(['action', 'details', 'actor_id']).where('action', '=', 'product.issue').execute()).filter(
      (a) => (a.details as { receptionId?: string })?.receptionId === reception.id,
    );
    expect(issuedAudit).toHaveLength(5);
    expect(issuedAudit.every((a) => a.actor_id === admin.id)).toBe(true);
    expect(await h.t.db.selectFrom('audit_logs').select('details').where('action', '=', 'reception.issued').where('target_id', '=', reception.id).execute()).toEqual([{ details: { supplierOrderId: order.id, identities: 5 } }]);
    const codes = cards.map((c) => openText(key, c.sealed_claim_code!, cardAad(c.product_id)));
    const everything = JSON.stringify([await h.t.db.selectFrom('audit_logs').select('details').execute(), await h.t.db.selectFrom('event_journal').select('payload').execute()]);
    for (const code of codes) {
      expect(everything).not.toContain(code);
      expect(everything).not.toContain(code.replace(/-/g, ''));
    }
    // The order counted in the journal.
    expect((await h.t.db.selectFrom('event_journal').select('type').where('entity_id', '=', order.id).execute()).map((j) => j.type)).toContain('reception.confirm');
  });

  it('serves the orders waiting for the size, strictly the oldest first, a reshipment first, as the pieces come in', async () => {
    const a = await salonOrder('50');
    const b = await salonOrder('50');
    const c = await salonOrder('50');
    const d = await salonOrder('50');
    const holds = async () => new Map((await h.t.db.selectFrom('orders').select(['id', 'reservation']).where('id', 'in', [a, b, c, d]).execute()).map((o) => [o.id, o.reservation]));
    expect([...(await holds()).values()]).toEqual(['AWAITING', 'AWAITING', 'AWAITING', 'AWAITING']);
    // The newest is a reshipment: it goes first.
    await h.t.db.updateTable('orders').set({ queue_first: true }).where('id', '=', d).execute();
    await received(france, [[k50, 2]]);
    expect(await holds()).toEqual(new Map([[a, 'STOCK'], [b, 'AWAITING'], [c, 'AWAITING'], [d, 'STOCK']]));
    await received(france, [[k50, 1]]);
    expect(await holds()).toEqual(new Map([[a, 'STOCK'], [b, 'STOCK'], [c, 'AWAITING'], [d, 'STOCK']]));
    // Each served order's event names the piece's place.
    const served = await h.t.db.selectFrom('order_events').select(['order_id', 'details']).where('action', '=', 'order.serve').where('order_id', 'in', [a, b, d]).execute();
    expect(served.map((e) => e.order_id).sort()).toEqual([a, b, d].sort());
    for (const e of served) expect(e.details).toMatchObject({ reservation: 'STOCK', skuId: k50, locationId: france });
  });

  it('resumes after a crash between chunks: the committed chunk kept, the rest issued once, never a piece twice', async () => {
    const { reception } = await received(logistics, [[k54, 120]], { issue: false });
    let calls = 0;
    const crashing = {
      inSigningTransaction: <T>(work: Parameters<IssuanceService['inSigningTransaction']>[0]) =>
        h.ctx.services.issuance.inSigningTransaction(async (trx, signFirst) => {
          const out = await work(trx, signFirst);
          if (++calls === 2) throw new Error('the process stopped');
          return out as T;
        }),
    } as Pick<IssuanceService, 'inSigningTransaction'>;
    const dying = twin(crashing);
    expect(await dying.issueChunk()).toBe(RECEPTION_ISSUE_CHUNK);
    await expect(dying.issueChunk()).rejects.toThrow('the process stopped');
    expect((await rs.view(reception.id, null)).issuing).toEqual({ issued: 50, accepted: 120, done: false });
    expect(await productsOf(reception.id)).toHaveLength(50);
    expect((await receivedMovements(reception.id)).map((m) => m.delta)).toEqual([50]);
    // The next process.
    expect(await rs.issuePending()).toBe(70);
    const pieces = await productsOf(reception.id);
    expect(pieces).toHaveLength(120);
    expect(new Set(pieces.map((p) => p.product_id)).size).toBe(120);
    expect((await receivedMovements(reception.id)).map((m) => m.delta)).toEqual([50, 50, 20]);
    expect(await h.t.db.selectFrom('card_prints').select('product_id').where('reception_id', '=', reception.id).execute()).toHaveLength(120);
    expect(await rs.issuePending()).toBe(0);
  });

  it('issues 500 pieces in chunks of 50, their serials following each other', { timeout: 240_000 }, async () => {
    const { reception } = await received(logistics, [[k52, 500]], { issue: false });
    let chunks = 0;
    while ((await rs.issueChunk()) > 0) chunks += 1;
    expect(chunks).toBe(10);
    const pieces = await productsOf(reception.id);
    expect(pieces).toHaveLength(500);
    expect(pieces.at(-1)!.serial - pieces[0]!.serial).toBe(499);
    expect((await receivedMovements(reception.id)).map((m) => m.delta)).toEqual(Array(10).fill(50));
    const view = await rs.view(reception.id, null);
    expect(view.issuing).toEqual({ issued: 500, accepted: 500, done: true });
    expect(view.cards.runs.sheet.map((r) => r.cards)).toEqual([...Array(10).fill(48), 20]);
    expect(view.cards.runs.card.map((r) => r.cards)).toEqual(Array(10).fill(50));
  });

  it('prints the cards in runs fixed by serial; a code replaced, a piece registered, a sealed copy unreadable: skipped and erased, never shifting a run; Cards attached erases the rest', { timeout: 120_000 }, async () => {
    const { reception } = await received(logistics, [[k50, 60]]);
    const scope = agentScope();
    let view = await rs.view(reception.id, scope);
    expect(view.cards.runs.sheet).toEqual([{ run: 1, cards: 48, sealed: 48, printed: 0 }, { run: 2, cards: 12, sealed: 12, printed: 0 }]);
    expect(view.cards.runs.card).toEqual([{ run: 1, cards: 50, sealed: 50, printed: 0 }, { run: 2, cards: 10, sealed: 10, printed: 0 }]);
    const pieces = await productsOf(reception.id);
    // In run 1: one piece gets a new claim code (NEW CLAIM CODE), one a hash that no longer matches, one is registered,
    // one sealed copy no longer opens.
    await h.ctx.services.claimRenewals.renew(pieces[1]!.product_id, { reason: 'Card lost before printing.', expect: 'IN_STOCK', after: null }, admin);
    await h.t.db.updateTable('products').set({ claim_secret_hash: await lightHash('ZZZZ-ZZZZ-ZZZZ') }).where('id', '=', pieces[2]!.id).execute();
    await h.t.db.updateTable('products').set({ ownership_state: 'REGISTERED' }).where('id', '=', pieces[3]!.id).execute();
    await h.t.db.updateTable('card_prints').set({ sealed_claim_code: 'v1.AAAA.BBBB' }).where('product_id', '=', pieces[4]!.id).execute();
    const run1 = await rs.printCards(reception.id, { layout: 'sheet', run: 1 }, agent, scope);
    expect(run1.file.contentType).toBe('application/pdf');
    expect(run1.printed).toHaveLength(44);
    expect(run1.skipped.sort((x, y) => x.productId.localeCompare(y.productId))).toEqual(
      [
        { productId: pieces[1]!.product_id, reason: 'REPLACED' },
        { productId: pieces[2]!.product_id, reason: 'REPLACED' },
        { productId: pieces[3]!.product_id, reason: 'REGISTERED' },
        { productId: pieces[4]!.product_id, reason: 'UNREADABLE' },
      ].sort((x, y) => x.productId.localeCompare(y.productId)),
    );
    expect(run1.printed).not.toContain(pieces[48]!.product_id);
    // Run 2 is still pieces 49 to 60: the gaps never shift it.
    h.clock.advance(1000);
    const run2 = await rs.printCards(reception.id, { layout: 'sheet', run: 2 }, agent, scope);
    expect(run2.printed).toEqual(pieces.slice(48).map((p) => p.product_id));
    expect(run2.skipped).toEqual([]);
    // Printed again: the same pieces, counted twice.
    h.clock.advance(1000);
    expect((await rs.printCards(reception.id, { layout: 'card', run: 2 }, agent, scope)).printed).toEqual(pieces.slice(50).map((p) => p.product_id));
    expect((await refusal(rs.printCards(reception.id, { layout: 'card', run: 3 }, agent, scope))).code).toBe('VALIDATION_FAILED');
    view = await rs.view(reception.id, scope);
    expect(view.cards).toMatchObject({ sealed: 56, printed: 56, erased: { REPLACED: 2, REGISTERED: 1, UNREADABLE: 1 }, attachedAt: null });
    expect(view.cards.runs.sheet).toEqual([{ run: 1, cards: 48, sealed: 44, printed: 44 }, { run: 2, cards: 12, sealed: 12, printed: 12 }]);
    const erased = await h.t.db.selectFrom('card_prints').select(['product_id', 'sealed_claim_code', 'erased_reason']).where('erased_at', 'is not', null).where('reception_id', '=', reception.id).execute();
    expect(erased.every((e) => e.sealed_claim_code === null)).toBe(true);
    // Another location's agent: 404.
    expect(await refusal(rs.printCards(reception.id, { layout: 'sheet' }, agent, new Set([france])))).toMatchObject({ code: 'RECEPTION_NOT_FOUND', status: 404 });
    // Cards attached: every sealed copy erased; no more printing.
    const attached = await rs.cardsAttached(reception.id, agent, scope);
    expect(attached.cards).toMatchObject({ sealed: 0, erased: { REPLACED: 2, REGISTERED: 1, UNREADABLE: 1, ATTACHED: 56 } });
    expect(attached.cards.attachedAt).not.toBeNull();
    expect(await refusal(rs.printCards(reception.id, { layout: 'sheet' }, agent, scope))).toEqual({ code: 'CARDS_ATTACHED', status: 409, message: 'These cards are attached: a lost card needs a new claim code from ORBES.' });
    expect((await refusal(rs.cardsAttached(reception.id, agent, scope))).code).toBe('CARDS_ATTACHED');
    expect((await rs.board(scope)).cardsToPrint.map((v) => v.id)).not.toContain(reception.id);
    const printAudits = await h.t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', reception.id).where('action', 'in', ['card.print', 'card.attached']).orderBy('id').execute();
    expect(printAudits.map((a) => [a.action, (a.details as { run?: number }).run ?? null, (a.details as { layout?: string }).layout ?? null])).toEqual([
      ['card.print', 1, 'sheet'],
      ['card.print', 2, 'sheet'],
      ['card.print', 2, 'card'],
      ['card.attached', null, null],
    ]);
    expect(printAudits[3]!.details).toEqual({ receptionId: reception.id, cards: 56 });
  });

  it('never prints a sold piece\'s card: the packing scan erases its sealed copy (ATTACHED), and a copy left is erased at printing without being opened', { timeout: 120_000 }, async () => {
    const k56 = await skuOf('56');
    const order = await salonOrder('56');
    await h.ctx.services.orders.setTerms(order, { priceMinor: 420_000, currency: 'EUR' }, admin);
    await h.ctx.services.orders.transition(order, { to: 'PAID' }, admin);
    const { reception } = await received(france, [[k56, 3]]);
    expect((await h.t.db.selectFrom('orders').select('reservation').where('id', '=', order).executeTakeFirstOrThrow()).reservation).toBe('STOCK');
    const before = await h.t.db.selectFrom('card_prints').select(['product_id', 'sealed_claim_code']).where('reception_id', '=', reception.id).execute();
    const colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    // Served, packed and shipped before Cards attached: the scan erased its sealed copy.
    await packAndShip(h.ctx, order, { carrierId: colissimo, trackingNumber: '6A00000000056' }, admin);
    const sold = (await h.t.db.selectFrom('orders as o').innerJoin('products as p', 'p.id', 'o.product_id').select(['p.id', 'p.product_id', 'o.status']).where('o.id', '=', order).executeTakeFirstOrThrow());
    expect(sold.status).toBe('SHIPPED');
    const row = () => h.t.db.selectFrom('card_prints').select(['sealed_claim_code', 'erased_reason']).where('product_id', '=', sold.id).executeTakeFirstOrThrow();
    expect(await row()).toEqual({ sealed_claim_code: null, erased_reason: 'ATTACHED' });
    const others = (await productsOf(reception.id)).filter((p) => p.id !== sold.id).map((p) => p.product_id);
    const run = await rs.printCards(reception.id, { layout: 'card', run: 1 }, agent, new Set([france]));
    expect(run.printed).toEqual(others);
    expect(run.skipped).toEqual([]);
    // A sealed copy left on a sold piece (written before the scan erased it): erased at printing, its code never opened.
    await h.t.db
      .updateTable('card_prints')
      .set({ sealed_claim_code: before.find((c) => c.product_id === sold.id)!.sealed_claim_code, erased_at: null, erased_reason: null })
      .where('product_id', '=', sold.id)
      .execute();
    h.clock.advance(1000);
    const again = await rs.printCards(reception.id, { layout: 'card', run: 1 }, agent, new Set([france]));
    expect(again.printed).toEqual(others);
    expect(again.skipped).toEqual([{ productId: sold.product_id, reason: 'ATTACHED' }]);
    expect(await row()).toEqual({ sealed_claim_code: null, erased_reason: 'ATTACHED' });
    const audit = await h.t.db.selectFrom('audit_logs').select('details').where('action', '=', 'card.print').where('target_id', '=', reception.id).orderBy('id').execute();
    expect(audit.map((a) => (a.details as { productIds: string[] }).productIds)).toEqual([others, others]);
  });

  it('cuts the runs in one order when two categories share their serial numbers: every card in exactly one run, before and after printing', { timeout: 120_000 }, async () => {
    // A supplier's bracelets and necklaces in one delivery: serials are numbered per year and category, so the two models'
    // numbers overlap (O26-B-00012 and O26-N-00012). The necklaces start one number later, so a run's boundary (48 or
    // 50) falls between two pieces of the same number.
    const nord = (await h.t.db.selectFrom('suppliers').select('id').where('name', '=', 'Maison Nord').executeTakeFirstOrThrow()).id;
    const modelIn = async (code: string, name: string) => {
      const category = (await h.ctx.categories.getByCode(code)) ?? (await h.ctx.categories.create({ code, name: `${name}s`, warrantyMonths: 24 }, admin));
      return (
        await h.ctx.db
          .insertInto('models')
          .values({ category_id: category.index, name, type: name, sku_prefix: `${code}-${randomBytes(3).toString('hex').toUpperCase()}`, default_material: '925 STERLING SILVER', supplier_id: nord })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    };
    const bracelet = await modelIn('B', 'BRACELET');
    const necklace = await modelIn('N', 'NECKLACE');
    await h.ctx.services.issuance.issueProduct({ categoryCode: 'N', modelId: necklace, material: '925 STERLING SILVER' }, admin);
    const [kb, kn] = [await skuOf('18', bracelet), await skuOf('45', necklace)];
    const { reception } = await received(logistics, [[kb, 31], [kn, 30]]);
    const pieces = await productsOf(reception.id);
    expect(pieces).toHaveLength(61);
    const serials = (prefix: string) => pieces.filter((p) => p.product_id.slice(4, 5) === prefix).map((p) => p.serial).sort((a, b) => a - b);
    expect([serials('B')[0], serials('B').at(-1), serials('N')[0], serials('N').at(-1)]).toEqual([1, 31, 2, 31]);
    // The order: year, category, serial (the bracelets, then the necklaces).
    const categoryOf = new Map((await h.t.db.selectFrom('products').select(['id', 'category_id']).where('id', 'in', pieces.map((p) => p.id)).execute()).map((p) => [p.id, p.category_id]));
    const ordered = [...pieces].sort((x, y) => categoryOf.get(x.id)! - categoryOf.get(y.id)! || x.serial - y.serial).map((p) => p.product_id);
    const scope = agentScope();
    const before = await rs.view(reception.id, scope);
    expect(before.cards.runs.sheet.map((r) => r.cards)).toEqual([48, 13]);
    expect(before.cards.runs.card.map((r) => r.cards)).toEqual([50, 11]);
    // Each layout's runs, printed one after the other (each print rewrites its rows), hold every card exactly once.
    for (const [layout, size] of [['sheet', 48], ['card', 50]] as const) {
      const printed: string[] = [];
      for (let run = 1; run <= 2; run++) {
        h.clock.advance(1000);
        const p = await rs.printCards(reception.id, { layout, run }, agent, scope);
        expect(p.skipped).toEqual([]);
        expect(p.printed, `${layout} run ${run}`).toEqual(ordered.slice((run - 1) * size, run * size));
        printed.push(...p.printed);
      }
      expect(printed).toHaveLength(61);
      expect(new Set(printed).size).toBe(61);
    }
    const after = await rs.view(reception.id, scope);
    const cut = (v: typeof before) => ({ sheet: v.cards.runs.sheet.map((r) => [r.run, r.cards, r.sealed]), card: v.cards.runs.card.map((r) => [r.run, r.cards, r.sealed]) });
    expect(cut(after)).toEqual(cut(before));
    expect(after.cards.runs.sheet.every((r) => r.printed === r.cards)).toBe(true);
    expect(after.cards.runs.card.every((r) => r.printed === r.cards)).toBe(true);
    expect(after.cards.printed).toBe(61);
    const counts = await h.t.db.selectFrom('card_prints').select('printed_count').where('reception_id', '=', reception.id).execute();
    expect(counts.every((c) => c.printed_count === 2)).toBe(true);
  });

  it('keeps the agent to its locations: another location\'s reception 404; the board narrowed to its own', async () => {
    const { reception } = await received(france, [[k52, 1]]);
    expect(await refusal(rs.view(reception.id, agentScope()))).toMatchObject({ code: 'RECEPTION_NOT_FOUND', status: 404 });
    expect(await refusal(rs.cardsAttached(reception.id, agent, agentScope()))).toMatchObject({ code: 'RECEPTION_NOT_FOUND', status: 404 });
    const board = await rs.board(agentScope());
    expect([...board.toConfirm, ...board.cardsToPrint].every((v) => v.location.id === logistics)).toBe(true);
    expect(board.count).toBe(board.toConfirm.length + board.cardsToPrint.length);
    expect((await rs.board(null, { locationId: france })).cardsToPrint.map((v) => v.id)).toContain(reception.id);
    expect(await refusal(rs.board(agentScope(), { locationId: france }))).toMatchObject({ code: 'STOCK_LOCATION_NOT_FOUND', status: 404 });
  });

  it('runs its own worker when started: a confirmed reception issued by the timer, stopped at close', { timeout: 60_000 }, async () => {
    const worker = twin();
    const { reception } = await received(logistics, [[k54, 3]], { issue: false });
    worker.start();
    try {
      const until = Date.now() + 30_000;
      while (Date.now() < until && !(await worker.view(reception.id, null)).issuing.done) await new Promise((r) => setTimeout(r, 50));
    } finally {
      await worker.stop();
    }
    expect((await worker.view(reception.id, null)).issuing).toEqual({ issued: 3, accepted: 3, done: true });
  });

  it('the context\'s own service, with the house\'s scrypt: confirmed, then issued by `issuePending`', { timeout: 60_000 }, async () => {
    const svc = h.ctx.services.receptions;
    const order = await sentOrder(logistics, [[k52, 2]]);
    const r = await svc.record(order.id, { lines: [{ skuId: k52, accepted: 2, rejected: 0 }] }, admin, null);
    await svc.confirm(r.id, admin);
    expect((await svc.view(r.id, null)).issuing.issued).toBe(0);
    expect(await svc.issuePending()).toBe(2);
    const pieces = await productsOf(r.id);
    expect(pieces.every((p) => p.claim_secret_hash!.startsWith('scrypt$15$'))).toBe(true);
    expect(supplierOrderReference(order.id)).toBe(order.reference);
  });
});
