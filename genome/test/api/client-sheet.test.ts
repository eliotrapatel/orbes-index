/**
 * The client sheet and the Shopify readiness in the console (plan LIVE RELEASE+, step S9: choices 24, 25 and 26), over
 * HTTP with real sessions (OPERATOR, AUDITOR):
 *
 *  - GET /api/admin/owners/:id, the client sheet (N4): beside the account, its tier and its pieces, its orders with
 *    their steps and their dates, the releases it took part in with the pieces it secured, its answers to the question
 *    after, its I'LL BE THERE and what became of each, the segments it belongs to now, and the notes Client Services
 *    wrote on its orders, draw entries and requests; the email masked for an AUDITOR as the console does;
 *  - PATCH /api/admin/models/:id: the base price with its currency, the care guide (N2, M6), read again by MY PIECES;
 *  - GET /api/admin/shopify/products.csv, GET and PUT /api/admin/models/:id/shopify, GET /api/admin/shopify/orders.csv:
 *    attachments never stored by a cache, the order CSV's collectors and buyers masked for an AUDITOR, the refusals.
 *  - the sheet's Lifetime value (plan NEXT-NINE, BP-29): GROWTH's rule (services/growth.ts collectorValue).
 * Which role reaches which route is test/api/admin-roles.test.ts; the files' contents test/services/shopify.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderReference } from '../../src/server/services/orders.js';
import { createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

type Json = Record<string, any>;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = Date.parse('2026-11-02T09:00:00.000Z');
const at = (ms: number) => new Date(START + ms);

describe('the client sheet and the Shopify exports: the console\'s routes', () => {
  let h: Harness;
  let f: LiveFixture;
  let op: Client;
  let auditor: Client;
  /** The collector, its account and its own session (MY PIECES). */
  let me: { id: string; email: string; client: Client };
  const ids = { draw: '', live: '', missed: '', coming: '', drawOrder: '', liveOrder: '', salonOrder: '', newcomers: '' };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(at(0));
    f = await liveFixtureOn(h.ctx, h.clock);
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    const { client, email } = await accountClient(h);
    const { id } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    me = { id, email, client };
    const actor = { type: 'account' as const, id };

    // A draw: entered, drawn, confirmed by Client Services with a note.
    const draw = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — release I', quantity: 1, opensAt: at(MINUTE), closesAt: at(2 * MINUTE), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(draw.id, f.admin);
    ids.draw = draw.id;
    // The LIVE RELEASES: one it takes part in and secures a piece with an add-on, one it said I'LL BE THERE to and
    // missed, one still to come it said I'LL BE THERE to.
    const live = await createLiveRelease(f, { opensAt: at(30 * MINUTE), sizes: [{ label: '54', stock: 1 }], addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }] });
    const missed = await createLiveRelease(f, { opensAt: at(40 * MINUTE), sizes: [{ label: '52', stock: 1 }] });
    const coming = await createLiveRelease(f, { opensAt: at(48 * HOUR), sizes: [{ label: '56', stock: 1 }] });
    for (const [r, title] of [[live, 'MONOLITHE — LIVE I'], [missed, 'MONOLITHE — LIVE II'], [coming, 'MONOLITHE — LIVE III']] as const) {
      await h.ctx.db.updateTable('drops').set({ title }).where('id', '=', r.id).execute();
    }
    Object.assign(ids, { live: live.id, missed: missed.id, coming: coming.id });
    await f.live.setInterest(id, missed.id, missed.sizes[0]!.id, actor);
    await f.live.setInterest(id, coming.id, coming.sizes[0]!.id, actor);

    h.clock.set(at(MINUTE + SECOND));
    await f.drops.enter(id, draw.id, actor);
    h.clock.set(at(3 * MINUTE));
    await f.drops.draw(draw.id, f.admin);
    const entry = await h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', draw.id).executeTakeFirstOrThrow();
    await f.drops.confirm(draw.id, entry.id, 'Called the client: the place is confirmed.', f.admin);
    ids.drawOrder = (await h.ctx.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry.id).executeTakeFirstOrThrow()).id;

    h.clock.set(at(29 * MINUTE));
    await f.live.enter(id, live.id, { sizeId: live.sizes[0]!.id }, actor);
    h.clock.set(at(30 * MINUTE));
    await f.live.advance(live.id);
    h.clock.advance(2 * SECOND);
    const token = (await f.live.entry(id, live.id))!.turn!.token!;
    await f.live.press(id, live.id, token);
    h.clock.advance(1500);
    await f.live.secure(id, live.id, token, actor);
    await f.live.setAddons(id, live.id, live.addons.map((x) => x.id), actor);
    await f.live.confirm(id, live.id, actor);
    ids.liveOrder = (await h.ctx.db.selectFrom('orders').select('id').where('drop_id', '=', live.id).executeTakeFirstOrThrow()).id;
    h.clock.set(at(41 * MINUTE));
    await f.live.advance(missed.id);
    // Its answer to the question after the release it missed.
    await h.ctx.db.insertInto('release_answers').values({ drop_id: missed.id, account_id: id, answer: 2, answered_at: at(2 * HOUR) }).execute();

    // A request of the private salon accepted, priced, paid, then cancelled with a note.
    h.clock.set(at(3 * HOUR));
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: id, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded by phone.', outcome: 'ACCEPTED' }, f.admin);
    ids.salonOrder = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await op.patch(`/api/admin/orders/${ids.salonOrder}/terms`, { sizeLabel: '58', priceMinor: 480_000, currency: 'EUR' });
    await op.request('PUT', `/api/admin/orders/${ids.salonOrder}/buyer`, { body: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' } });
    h.clock.advance(MINUTE);
    expect((await op.post(`/api/admin/orders/${ids.salonOrder}/transition`, { to: 'PAID' })).statusCode).toBe(200);
    h.clock.advance(MINUTE);
    expect((await op.post(`/api/admin/orders/${ids.salonOrder}/transition`, { to: 'CANCELLED', note: 'The client withdrew.' })).statusCode).toBe(200);

    // Two segments: it is in one of them.
    const created = await op.post('/api/admin/segments', { name: 'Newcomers', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [0] }] } });
    ids.newcomers = (safeJson(created) as Json).id;
    await op.post('/api/admin/segments', { name: 'Palladium circle', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [3] }] } });
    h.clock.set(at(4 * HOUR));
  });
  afterAll(() => h?.close());

  it('gathers the client sheet: orders and their steps, releases and pieces secured, answers, interest, tier, segments, notes', async () => {
    const res = await op.get(`/api/admin/owners/${me.id}`);
    expect(res.statusCode).toBe(200);
    const sheet = safeJson(res) as Json;
    expect(sheet.owner.email).toBe(me.email);
    expect(sheet.tier).toMatchObject({ level: 0, name: null });

    // Its orders, the latest first, each with its steps.
    expect(sheet.orders.map((o: Json) => o.reference)).toEqual([orderReference(ids.salonOrder), orderReference(ids.liveOrder), orderReference(ids.drawOrder)]);
    const [salon, liveOrder, drawOrder] = sheet.orders as Json[];
    expect(salon).toMatchObject({ id: ids.salonOrder, channel: 'SALON', status: 'CANCELLED', release: null, sizeLabel: '58', priceMinor: 480_000, currency: 'EUR', timing: { late: false } });
    expect(salon.steps).toEqual({ reservedAt: at(3 * HOUR).toISOString(), paidAt: at(3 * HOUR + MINUTE).toISOString(), shippedAt: null, deliveredAt: null, cancelledAt: at(3 * HOUR + 2 * MINUTE).toISOString(), returnedAt: null });
    expect(liveOrder).toMatchObject({ channel: 'LIVE', status: 'RESERVED', release: { id: ids.live, title: 'MONOLITHE — LIVE I' }, sizeLabel: '54', addons: [{ label: 'ENGRAVING' }], priceMinor: 505_000 });
    // Reserved over 2 days ago? Not yet: four hours.
    expect(liveOrder.timing).toMatchObject({ rule: 'RESERVED', late: false });
    expect(drawOrder).toMatchObject({ channel: 'DRAW', status: 'RESERVED', release: { id: ids.draw, title: 'ECLIPSE — release I' }, sizeLabel: null, priceMinor: null });
    for (const o of sheet.orders as Json[]) expect(o).not.toHaveProperty('account');

    // The releases it took part in, the latest first, with the pieces it secured; the one it missed and the one to come are not.
    expect(sheet.releases).toEqual({
      count: 2,
      secured: 2,
      items: [
        { id: ids.live, kind: 'LIVE', title: 'MONOLITHE — LIVE I', opensAt: at(30 * MINUTE).toISOString(), secured: 1 },
        { id: ids.draw, kind: 'DRAW', title: 'ECLIPSE — release I', opensAt: at(MINUTE).toISOString(), secured: 1 },
      ],
    });
    expect(sheet.answers).toEqual([
      { dropId: ids.missed, title: 'MONOLITHE — LIVE II', question: 'WHAT WOULD YOU HAVE WANTED?', answer: 2, answerText: 'ANOTHER FINISH', answeredAt: at(2 * HOUR).toISOString() },
    ]);
    expect(sheet.interest.map((i: Json) => [i.dropId, i.size, i.outcome])).toEqual([
      [ids.coming, '56', 'UPCOMING'],
      [ids.missed, '52', 'DID_NOT_COME'],
    ]);
    expect(sheet.segments).toEqual([{ id: ids.newcomers, name: 'Newcomers' }]);
    expect(sheet.notes.map((n: Json) => [n.about, n.subject, n.text])).toEqual([
      ['ORDER', orderReference(ids.salonOrder), 'The client withdrew.'],
      ['SALON', 'MONOLITHE', 'The sale is concluded by phone.'],
      ['DRAW', 'ECLIPSE — release I', 'Called the client: the place is confirmed.'],
    ]);
    expect(sheet.notes[0]).toMatchObject({ orderId: ids.salonOrder, by: expect.stringMatching(/@orbes\.test$/) });
    expect(sheet.notes[2]).toMatchObject({ orderId: null, by: expect.stringMatching(/^live-admin-/) });
    // Never the buyer's details on the sheet.
    expect(res.body).not.toContain('Jane Doe');
    expect(res.body).not.toContain('rue de la Paix');
  });

  it('masks the collector\'s email for an AUDITOR, as the console does; the rest reads the same', async () => {
    const [clear, masked] = await Promise.all([op.get(`/api/admin/owners/${me.id}`), auditor.get(`/api/admin/owners/${me.id}`)]);
    const a = safeJson(clear) as Json;
    const b = safeJson(masked) as Json;
    expect(b.owner.email).toBe(`${me.email[0]}***${me.email.slice(me.email.indexOf('@'))}`);
    expect(masked.body).not.toContain(me.email);
    expect({ ...b, owner: null }).toEqual({ ...a, owner: null });
    const unknown = await op.get('/api/admin/owners/00000000-0000-4000-8000-000000000000');
    expect([unknown.statusCode, errorOf(unknown).code]).toEqual([404, 'ACCOUNT_NOT_FOUND']);
  });

  it('sets a model\'s base price with its currency and its care guide, which MY PIECES reads with the model\'s orders', async () => {
    const bad = await op.patch(`/api/admin/models/${f.modelId}`, { basePriceMinor: 480_000 });
    expect([bad.statusCode, errorOf(bad).code]).toEqual([400, 'VALIDATION_FAILED']);
    const res = await op.patch(`/api/admin/models/${f.modelId}`, { basePriceMinor: 480_000, baseCurrency: 'EUR', careGuide: 'Wipe it with a soft cloth.\nKeep it in its box.' });
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ basePriceMinor: 480_000, baseCurrency: 'EUR', careGuide: 'Wipe it with a soft cloth.\nKeep it in its box.', shopify: { productId: null } });
    const guide = await me.client.get(`/api/v1/account/orders/${ids.liveOrder}/care-guide`);
    expect(safeJson(guide)).toEqual({ careGuide: { model: 'MONOLITHE', text: 'Wipe it with a soft cloth.\nKeep it in its box.' } });
    const cleared = await op.patch(`/api/admin/models/${f.modelId}`, { basePriceMinor: null, baseCurrency: null });
    expect(safeJson(cleared)).toMatchObject({ basePriceMinor: null, baseCurrency: null });
    await op.patch(`/api/admin/models/${f.modelId}`, { basePriceMinor: 480_000, baseCurrency: 'EUR' });
  });

  it('downloads the Shopify product CSV, and keeps the ids pasted back', async () => {
    const file = await auditor.get('/api/admin/shopify/products.csv?currency=EUR');
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toMatch(/^text\/csv/);
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.headers['content-disposition']).toBe('attachment; filename="ORBES-shopify-products-EUR-2026-11-02.csv"');
    // NOCTURNE N1: a model and its variants one product, by Variant (Option1) and Size (Option2), each its cover.
    expect(file.body.split('\r\n')[0]).toBe('"Title","URL handle","Vendor","Type","Published on online store","Status","SKU","Option1 name","Option1 value","Option2 name","Option2 value","Price","Requires shipping","Product image URL","Image position","Image alt text","Variant image URL"');
    expect(file.body).toContain('"MONOLITHE"');
    const refused = await auditor.get('/api/admin/shopify/products.csv?currency=JPY');
    expect([refused.statusCode, errorOf(refused).code]).toEqual([400, 'VALIDATION_FAILED']);

    const product = safeJson(await auditor.get(`/api/admin/models/${f.modelId}/shopify`)) as Json;
    expect(product).toMatchObject({ model: { id: f.modelId, name: 'MONOLITHE' }, handle: 'monolithe', productId: null });
    const sizes = (product.variants as Json[]).map((v) => v.size);
    expect(sizes).toEqual(expect.arrayContaining(['54', '58']));
    const saved = await op.request('PUT', `/api/admin/models/${f.modelId}/shopify`, {
      body: { productId: 'https://admin.shopify.com/store/orbes/products/8001', variants: [{ size: '54', variantId: '5401' }] },
    });
    expect(saved.statusCode).toBe(200);
    expect(safeJson(saved)).toMatchObject({ productId: '8001' });
    expect((safeJson(await auditor.get('/api/admin/models')) as { items: Json[] }).items.find((m) => m.id === f.modelId)!.shopify).toEqual({ productId: '8001', variants: sizes.length, linked: 1 });
    for (const body of [{ productId: '8001' }, { productId: '8001', variants: [], extra: true }, { productId: '8001', variants: [{ size: '54' }] }, { productId: 'no', variants: [] }]) {
      const r = await op.request('PUT', `/api/admin/models/${f.modelId}/shopify`, { body });
      expect([r.statusCode, errorOf(r).code], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const missing = await op.request('PUT', '/api/admin/models/00000000-0000-4000-8000-000000000000/shopify', { body: { productId: null, variants: [] } });
    expect([missing.statusCode, errorOf(missing).code]).toEqual([404, 'MODEL_NOT_FOUND']);
  });

  it('downloads the Shopify order CSV of a period, the collectors and buyers masked for an AUDITOR', async () => {
    const q = '/api/admin/shopify/orders.csv?from=2026-11-01&to=2026-11-30';
    const clear = await op.get(q);
    expect(clear.statusCode).toBe(200);
    expect(clear.headers['cache-control']).toBe('no-store');
    expect(clear.headers['content-disposition']).toBe('attachment; filename="ORBES-shopify-orders-2026-11-01-to-2026-11-30.csv"');
    // The LIVE order (the piece and its add-on) and the salon's (priced); the draw's has no price yet.
    expect(clear.body).toContain(`"${orderReference(ids.liveOrder)}","${me.email}"`);
    expect(clear.body).toContain('"Jane Doe"');
    expect(clear.body).not.toContain(orderReference(ids.drawOrder));
    const masked = await auditor.get(q);
    expect(masked.statusCode).toBe(200);
    expect(masked.body).not.toContain(me.email);
    expect(masked.body).not.toContain('Jane Doe');
    expect(masked.body).not.toContain('rue de la Paix');
    expect(masked.body).toContain('"J*** D***"');
    for (const bad of ['?from=2026-11-30&to=2026-11-01', '?from=2025-11-01&to=2026-11-30', '?from=2026-11-01', '?from=2026-02-30&to=2026-03-01']) {
      const r = await op.get(`/api/admin/shopify/orders.csv${bad}`);
      expect([r.statusCode, errorOf(r).code], bad).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('reads the Lifetime value (plan NEXT-NINE, BP-29): none while nothing is bought, then each order paid at its invoiced price, as GROWTH counts it', async () => {
    // The salon's order was paid then cancelled (its credit note nets it to nothing); the LIVE and the draw's are not paid.
    expect((safeJson(await auditor.get(`/api/admin/owners/${me.id}`)) as Json).lifetimeValue).toEqual([]);
    await op.request('PUT', `/api/admin/orders/${ids.liveOrder}/buyer`, { body: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' } });
    h.clock.advance(MINUTE);
    expect((await op.post(`/api/admin/orders/${ids.liveOrder}/transition`, { to: 'PAID' })).statusCode).toBe(200);
    const sheet = safeJson(await auditor.get(`/api/admin/owners/${me.id}`)) as Json;
    // Its invoice: the piece (€ 5 050) and its engraving (€ 150).
    expect(sheet.lifetimeValue).toEqual([{ currency: 'EUR', valueMinor: 520_000 }]);
    expect(sheet.lifetimeValue).toEqual(await h.ctx.services.growth.collectorValue(me.id));
    const row = (await h.ctx.services.growth.collectors({ currency: 'EUR' })).items.find((c) => c.accountId === me.id)!;
    expect(row).toMatchObject({ pieces: 1, valueMinor: 520_000 });
  });
});

describe('THE HOUSE’S GUARANTEE on the client sheet (plan NEXT-NINE, IN-01)', () => {
  let h: Harness;
  let f: LiveFixture;
  let op: Client;
  let auditor: Client;
  let admin: Client;
  const NOTE = 'Waited at the boutique for the first release: Client Services owe a place.';
  const accountIdOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(at(0));
    f = await liveFixtureOn(h.ctx, h.clock);
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
  });
  afterAll(() => h?.close());

  it('grants, lists, changes and revokes a guarantee from the client sheet; a release lists its guarantees, the emails masked for an AUDITOR; the settings', async () => {
    const draw = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — guaranteed', quantity: 3, opensAt: at(HOUR), closesAt: at(2 * HOUR), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(draw.id, f.admin);
    const { email } = await accountClient(h);
    const id = await accountIdOf(email);
    const granted = await op.post(`/api/admin/owners/${id}/guarantees`, { scope: 'MODEL', targetId: f.modelId, pieces: 2, validUntil: '2026-12-31', visible: false, note: NOTE });
    expect(granted.statusCode, granted.body).toBe(201);
    const out = safeJson(granted) as Json;
    expect(out.setAsideFor).toEqual({ id: draw.id, title: 'ECLIPSE — guaranteed' });
    expect(out.guarantee).toMatchObject({ scope: 'MODEL', target: { kind: 'MODEL', id: f.modelId, name: 'MONOLITHE' }, pieces: 2, visible: false, note: NOTE, state: 'SET_ASIDE', release: { id: draw.id, mode: 'DRAW' } });
    const bad = await op.post(`/api/admin/owners/${id}/guarantees`, { scope: 'MODEL', targetId: f.modelId, pieces: 6, validUntil: '2026-12-31', visible: true });
    expect([bad.statusCode, errorOf(bad).code]).toEqual([400, 'VALIDATION_FAILED']);
    // The client sheet lists it; the AUDITOR reads the same sheet, the client's email masked.
    const sheet = safeJson(await op.get(`/api/admin/owners/${id}`)) as Json;
    expect(sheet.guarantees).toEqual([expect.objectContaining({ id: out.guarantee.id, note: NOTE, state: 'SET_ASIDE', grantedBy: expect.objectContaining({ email: expect.stringContaining('@orbes.test') }) })]);
    expect(((safeJson(await auditor.get(`/api/admin/owners/${id}`)) as Json).guarantees as Json[])[0]!.id).toBe(out.guarantee.id);
    const ofRelease = (c: Client) => c.get(`/api/admin/drops/${draw.id}/guarantees`);
    expect(((safeJson(await ofRelease(op)) as Json).items as Json[])[0]).toMatchObject({ id: out.guarantee.id, account: { id, email }, pieces: 2, visible: false, state: 'SET_ASIDE', entry: null });
    expect(((safeJson(await ofRelease(auditor)) as Json).items as Json[])[0]!.account.email).not.toBe(email);
    expect((safeJson(await op.get(`/api/admin/drops/${draw.id}`)) as Json).guaranteed).toEqual({ places: 1, pieces: 2 });
    // Changed, then revoked with a note.
    const changed = await op.patch(`/api/admin/guarantees/${out.guarantee.id}`, { visible: true, pieces: 1 });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((safeJson(changed) as Json).guarantee).toMatchObject({ visible: true, pieces: 1 });
    expect((await op.patch(`/api/admin/guarantees/${out.guarantee.id}`, {})).statusCode).toBe(400);
    const revoked = await op.post(`/api/admin/guarantees/${out.guarantee.id}/revoke`, { note: 'Granted twice.' });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((safeJson(revoked) as Json).guarantee).toMatchObject({ status: 'REVOKED', state: 'REVOKED', revokeNote: 'Granted twice.' });
    // The settings: read by an AUDITOR, set by an ADMIN.
    expect(safeJson(await auditor.get('/api/admin/settings/guarantees'))).toMatchObject({ validDays: 90, pieces: 1, visible: true });
    const saved = await admin.request('PUT', '/api/admin/settings/guarantees', { body: { validDays: 120, pieces: 2, visible: false } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(safeJson(await auditor.get('/api/admin/settings/guarantees'))).toMatchObject({ validDays: 120, pieces: 2, visible: false });
    expect((await admin.request('PUT', '/api/admin/settings/guarantees', { body: { validDays: 731, pieces: 1, visible: true } })).statusCode).toBe(400);
    await admin.request('PUT', '/api/admin/settings/guarantees', { body: { validDays: 90, pieces: 1, visible: true } });
  });

  it('a lock unbinds the guarantee of its open entry and never revokes it; a LOCKED account is never granted one; the export carries every guarantee with its notes, at the grant and at a revocation; the audit log neither the email nor the notes', async () => {
    const draw = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — lock', quantity: 3, opensAt: at(3 * HOUR), closesAt: at(4 * HOUR), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(draw.id, f.admin);
    const { email } = await accountClient(h);
    const id = await accountIdOf(email);
    const g = (safeJson(await op.post(`/api/admin/owners/${id}/guarantees`, { scope: 'RELEASE', targetId: draw.id, pieces: 2, validUntil: '2026-12-31', visible: false, note: NOTE })) as Json).guarantee;
    h.clock.set(at(3 * HOUR + MINUTE));
    await f.drops.enter(id, draw.id, { type: 'account', id });
    expect(await h.ctx.db.selectFrom('drop_entries').select(['guarantee_id', 'pieces']).where('account_id', '=', id).executeTakeFirstOrThrow()).toEqual({ guarantee_id: g.id, pieces: 2 });
    admin = await adminClient(h, 'ADMIN');
    op = await adminClient(h, 'OPERATOR');
    expect((await admin.post(`/api/admin/owners/${id}/lock`)).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('drop_entries').select(['status', 'guarantee_id', 'pieces']).where('account_id', '=', id).executeTakeFirstOrThrow()).toEqual({ status: 'WITHDRAWN', guarantee_id: null, pieces: 1 });
    expect((await h.ctx.db.selectFrom('house_guarantees').select('status').where('id', '=', g.id).executeTakeFirstOrThrow()).status).toBe('ACTIVE');
    const refused = await op.post(`/api/admin/owners/${id}/guarantees`, { scope: 'MODEL', targetId: f.modelId, pieces: 1, validUntil: '2026-12-31', visible: true });
    expect([refused.statusCode, errorOf(refused).code]).toEqual([403, 'ACCOUNT_LOCKED']);
    // The right of access: every guarantee, the hidden one too, with its note.
    const exported = safeJson(await admin.get(`/api/admin/owners/${id}/export`)) as Json;
    expect(exported.guarantees).toEqual([expect.objectContaining({ id: g.id, scope: 'RELEASE', target: 'ECLIPSE — lock', pieces: 2, visible: false, note: NOTE, revokeNote: null, status: 'ACTIVE', releaseId: draw.id })]);
    // A revoked one with the revocation's note too.
    expect((await admin.post(`/api/admin/owners/${id}/unlock`)).statusCode).toBe(200);
    op = await adminClient(h, 'OPERATOR');
    expect((await op.post(`/api/admin/guarantees/${g.id}/revoke`, { note: 'Waited at the boutique for a refund.' })).statusCode).toBe(200);
    const again = safeJson(await admin.get(`/api/admin/owners/${id}/export`)) as Json;
    expect(again.guarantees).toEqual([expect.objectContaining({ id: g.id, note: NOTE, revokeNote: 'Waited at the boutique for a refund.', status: 'REVOKED' })]);
    const logged = JSON.stringify(await h.ctx.db.selectFrom('audit_logs').select('details').where('action', 'like', 'guarantee.%').execute());
    expect(logged).not.toContain(email);
    expect(logged).not.toContain('Waited at the boutique');
  });
});
