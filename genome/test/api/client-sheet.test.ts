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
 *  - the client sheet's tags and private notes (plan CUSTOMER INTELLIGENCE §3.6 C.4.3, C.9): GET /api/admin/tags, GET, POST
 *    and DELETE …/notes, POST and DELETE …/tags, by role, with the CSRF token and the same origin, and their audits;
 *  - the client sheet's Profile (§3.1 P.6.5, P.6.6, P.9.2, §3.6 C.4.2): in clear for an OPERATOR, withheld for an AUDITOR
 *    with the age band; PUT …/profile, …/birth-date (the reason a private note) and …/default-address for an OPERATOR,
 *    the version's 409 on both sides, an AUDITOR 403.
 * Which role reaches which route is test/api/admin-roles.test.ts; the files' contents test/services/shopify.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderReference } from '../../src/server/services/orders.js';
import { createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';
import { poolDraw } from '../support/draws.js';

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
    const draw = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'ECLIPSE — release I', quantity: 1, opensAt: at(MINUTE), closesAt: at(2 * MINUTE), earlyAccessHours: 0 }, f.admin);
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

  it('masks the collector\'s email for an AUDITOR, as the console does, and withholds the profile\'s date of birth, phone, city, Instagram and address (plan CUSTOMER INTELLIGENCE §3.0 (h)); the rest reads the same', async () => {
    const [clear, masked] = await Promise.all([op.get(`/api/admin/owners/${me.id}`), auditor.get(`/api/admin/owners/${me.id}`)]);
    const a = safeJson(clear) as Json;
    const b = safeJson(masked) as Json;
    expect(b.owner.email).toBe(`${me.email[0]}***${me.email.slice(me.email.indexOf('@'))}`);
    expect(masked.body).not.toContain(me.email);
    expect(b.profile).toEqual({ ...a.profile, birthDate: null, age: null, phone: null, city: null, instagram: null, address: null, withheld: ['birthDate', 'phone', 'city', 'address', 'instagram'] });
    expect({ ...b, owner: null, profile: null }).toEqual({ ...a, owner: null, profile: null });
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
    const draw = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'ECLIPSE — guaranteed', quantity: 3, opensAt: at(HOUR), closesAt: at(2 * HOUR), earlyAccessHours: 0 }, f.admin);
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
    const draw = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'ECLIPSE — lock', quantity: 3, opensAt: at(3 * HOUR), closesAt: at(4 * HOUR), earlyAccessHours: 0 }, f.admin);
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

describe('Tags and private notes on the client sheet (plan CUSTOMER INTELLIGENCE §3.6 C.4.3, C.9)', () => {
  let h: Harness;
  let op: Client;
  let other: Client;
  let admin: Client;
  let auditor: Client;
  let id = '';
  const accountIdOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
  const del = (c: Client, url: string, opts = {}) => c.request('DELETE', url, opts);

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(at(0));
    op = await adminClient(h, 'OPERATOR');
    other = await adminClient(h, 'OPERATOR');
    admin = await adminClient(h, 'ADMIN');
    auditor = await adminClient(h, 'AUDITOR');
    id = await accountIdOf((await accountClient(h)).email);
  });
  afterAll(() => h?.close());

  it('GET /api/admin/tags suggests VIP, PRESS and FRIEND OF THE HOUSE while no tag is used, then the tags in use; an AUDITOR reads them', async () => {
    const first = await auditor.get('/api/admin/tags');
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(safeJson(first)).toEqual({ items: [{ tag: 'VIP', accounts: 0 }, { tag: 'PRESS', accounts: 0 }, { tag: 'FRIEND OF THE HOUSE', accounts: 0 }] });
    const added = await op.post(`/api/admin/owners/${id}/tags`, { tag: 'friend  of the house' });
    expect(added.statusCode, added.body).toBe(201);
    expect(safeJson(added)).toEqual({ tags: ['FRIEND OF THE HOUSE'] });
    // Already carried: 200 with the tags, nothing added.
    const again = await other.post(`/api/admin/owners/${id}/tags`, { tag: 'Friend of the House' });
    expect([again.statusCode, safeJson(again)]).toEqual([200, { tags: ['FRIEND OF THE HOUSE'] }]);
    expect(safeJson(await auditor.get('/api/admin/tags'))).toEqual({ items: [{ tag: 'FRIEND OF THE HOUSE', accounts: 1 }] });
    const removed = await del(op, `/api/admin/owners/${id}/tags/${encodeURIComponent('FRIEND OF THE HOUSE')}`);
    expect([removed.statusCode, removed.body]).toEqual([204, '']);
    // A tag it does not carry: 204 all the same.
    expect((await del(op, `/api/admin/owners/${id}/tags/press`)).statusCode).toBe(204);
    const audits = await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', id).where('action', 'like', 'account.tag.%').orderBy('id').execute();
    expect(audits).toEqual([
      { action: 'account.tag.add', details: { tag: 'FRIEND OF THE HOUSE' } },
      { action: 'account.tag.remove', details: { tag: 'FRIEND OF THE HOUSE' } },
    ]);
  });

  it('refuses a tag in other words (400), the 21st (409 TAG_LIMIT), an unknown account (404), an AUDITOR (403), a write without the CSRF token or from another origin', async () => {
    const bad = await op.post(`/api/admin/owners/${id}/tags`, { tag: 'VIP!' });
    expect([bad.statusCode, errorOf(bad)]).toEqual([400, { code: 'VALIDATION_FAILED', message: 'A tag is 1 to 32 letters, digits or spaces (and & ’ - .).' }]);
    expect((await op.post(`/api/admin/owners/${id}/tags`, { tag: 'VIP', more: 1 })).statusCode).toBe(400);
    expect(errorOf(await op.post(`/api/admin/owners/${randomUUID()}/tags`, { tag: 'VIP' })).code).toBe('ACCOUNT_NOT_FOUND');
    expect(errorOf(await auditor.post(`/api/admin/owners/${id}/tags`, { tag: 'VIP' })).code).toBe('FORBIDDEN');
    expect(errorOf(await op.post(`/api/admin/owners/${id}/tags`, { tag: 'VIP' }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await op.post(`/api/admin/owners/${id}/tags`, { tag: 'VIP' }, { origin: 'https://evil.example' })).code).toBe('CSRF_FAILED');
    expect(errorOf(await del(op, `/api/admin/owners/${id}/tags/VIP`, { noCsrf: true })).code).toBe('CSRF_FAILED');
    for (let i = 1; i <= 20; i++) expect((await op.post(`/api/admin/owners/${id}/tags`, { tag: `tag ${i}` })).statusCode).toBe(201);
    const full = await op.post(`/api/admin/owners/${id}/tags`, { tag: 'one more' });
    expect([full.statusCode, errorOf(full)]).toEqual([409, { code: 'TAG_LIMIT', message: 'A client carries at most 20 tags.' }]);
    for (let i = 1; i <= 20; i++) await del(op, `/api/admin/owners/${id}/tags/${encodeURIComponent(`TAG ${i}`)}`);
  });

  it('adds a private note (201 the note), lists the notes the newest first, removes one by its writer or an ADMIN only; an AUDITOR reads them', async () => {
    const res = await op.post(`/api/admin/owners/${id}/notes`, { text: '  Prefers to be called in the evening.  ' });
    expect(res.statusCode, res.body).toBe(201);
    const note = safeJson(res) as Json;
    expect(note).toEqual({ id: expect.any(String), text: 'Prefers to be called in the evening.', at: expect.any(String), by: expect.stringMatching(/^operator-.*@orbes\.test$/), byId: expect.any(String) });
    h.clock.advance(MINUTE);
    const second = safeJson(await other.post(`/api/admin/owners/${id}/notes`, { text: 'Asked for the cuff in 54.' })) as Json;
    const read = await auditor.get(`/api/admin/owners/${id}/notes?all=1`);
    expect(read.statusCode).toBe(200);
    expect(safeJson(read)).toEqual({ items: [second, note], total: 2 });
    expect(errorOf(await auditor.request('DELETE', `/api/admin/owners/${id}/notes/${note.id}`)).code).toBe('FORBIDDEN');
    const notYours = await other.request('DELETE', `/api/admin/owners/${id}/notes/${note.id}`);
    expect([notYours.statusCode, errorOf(notYours)]).toEqual([403, { code: 'NOTE_NOT_YOURS', message: 'Only the note’s writer or an ADMIN removes it.' }]);
    expect((await op.request('DELETE', `/api/admin/owners/${id}/notes/${note.id}`)).statusCode).toBe(204);
    expect((await admin.request('DELETE', `/api/admin/owners/${id}/notes/${second.id}`)).statusCode).toBe(204);
    // Twice: 204, nothing more.
    expect((await op.request('DELETE', `/api/admin/owners/${id}/notes/${note.id}`)).statusCode).toBe(204);
    expect(safeJson(await auditor.get(`/api/admin/owners/${id}/notes`))).toEqual({ items: [], total: 0 });
    expect(errorOf(await op.request('DELETE', `/api/admin/owners/${id}/notes/${randomUUID()}`)).code).toBe('NOTE_NOT_FOUND');
    const long = await op.post(`/api/admin/owners/${id}/notes`, { text: 'x'.repeat(2001) });
    expect([long.statusCode, errorOf(long)]).toEqual([400, { code: 'VALIDATION_FAILED', message: 'A note is 1 to 2,000 characters.' }]);
    expect(errorOf(await op.post(`/api/admin/owners/${id}/notes`, { text: 'Hi.' }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    const audits = await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', id).where('action', 'like', 'account.note.%').orderBy('id').execute();
    expect(audits).toEqual([
      { action: 'account.note.add', details: { noteId: note.id, length: 36 } },
      { action: 'account.note.add', details: { noteId: second.id, length: 25 } },
      { action: 'account.note.remove', details: { noteId: note.id } },
      { action: 'account.note.remove', details: { noteId: second.id } },
    ]);
    expect(JSON.stringify(audits)).not.toContain('evening');
  });
});

describe('The client sheet\'s Profile (plan CUSTOMER INTELLIGENCE §3.1 P.6.5, P.6.6, P.9.2, §3.6 C.4.2)', () => {
  let h: Harness;
  let op: Client;
  let auditor: Client;
  let me: { id: string; client: Client };
  const accountIdOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
  const put = (c: Client, path: string, body: unknown, opts = {}) => c.request('PUT', `/api/admin/owners/${me.id}/${path}`, { body, ...opts });
  /** Edit the profile's body: the profile as the dialog read it, with the changes. */
  const whole = (p: Json, changes: Json = {}) => ({
    version: p.version,
    firstName: p.firstName,
    lastName: p.lastName,
    country: p.country,
    city: p.city,
    phone: p.phone,
    instagram: p.instagram,
    heard: p.heard ? { optionId: p.heard.optionId, other: p.heard.other } : null,
    tastes: { pieces: p.tastes.pieces.map((t: Json) => t.key), finishes: p.tastes.finishes.map((t: Json) => t.key) },
    ...changes,
  });
  const sheetOf = async (c: Client) => safeJson(await c.get(`/api/admin/owners/${me.id}`)) as Json;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-09T09:00:00.000Z');
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    const { client, email } = await accountClient(h);
    me = { id: await accountIdOf(email), client };
    const read = safeJson(await client.get('/api/v1/account/profile')) as Json;
    const saved = await client.request('PUT', '/api/v1/account/profile', {
      body: {
        version: read.profile.version, firstName: 'Camille', lastName: 'Durand', country: 'FR', city: 'Lyon', phone: { country: 'FR', number: '06 12 34 56 78' },
        birthDate: '1994-03-14', instagram: 'camille.dl', heard: null, tastes: { pieces: [], finishes: [] },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await h.ctx.services.addresses.create(me.id, { name: 'Camille Durand', address: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, { type: 'account', id: me.id });
  });
  afterAll(() => h?.close());

  it('GET /api/admin/owners/:id carries the profile in clear for an OPERATOR, withheld for an AUDITOR with the age band; the tags, the private notes and the team account', async () => {
    const sheet = await sheetOf(op);
    expect(sheet.profile).toMatchObject({
      firstName: 'Camille', lastName: 'Durand', country: 'FR', birthDate: '1994-03-14', age: 32, ageBand: '25-34', birthDateBy: 'COLLECTOR',
      phone: { country: 'FR', number: '+33612345678' }, city: 'Lyon', instagram: 'camille.dl',
      address: { name: 'Camille Durand', lines: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, otherAddresses: 0,
      version: 2, updatedBy: 'COLLECTOR', withheld: [], teamAccount: false,
    });
    expect(sheet).toMatchObject({ tags: [], privateNotes: { items: [], total: 0 }, teamAccount: false });
    const masked = await auditor.get(`/api/admin/owners/${me.id}`);
    expect(masked.statusCode).toBe(200);
    const p = (safeJson(masked) as Json).profile;
    expect(p).toMatchObject({ firstName: 'Camille', lastName: 'Durand', country: 'FR', birthDate: null, age: null, ageBand: '25-34', phone: null, city: null, instagram: null, address: null, withheld: ['birthDate', 'phone', 'city', 'address', 'instagram'] });
    // Nothing withheld leaks elsewhere in the AUDITOR's sheet.
    for (const word of ['1994-03-14', '612345678', 'Lyon', 'camille.dl', 'rue de la Paix']) expect(masked.body, word).not.toContain(word);
    // The route's mask is the service's AUDITOR view.
    expect(p).toEqual(JSON.parse(JSON.stringify(await h.ctx.services.profiles.forStaff(me.id, { inClear: false }))));
  });

  it('PUT …/profile: an OPERATOR edits the profile with the version read (409 PROFILE_CHANGED after the client saved); never the date of birth; an AUDITOR 403; the CSRF token and the same origin', async () => {
    const p = (await sheetOf(op)).profile;
    expect(errorOf(await put(auditor, 'profile', whole(p, { city: 'Paris' }))).code).toBe('FORBIDDEN');
    expect(errorOf(await put(op, 'profile', whole(p, { city: 'Paris' }), { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await put(op, 'profile', whole(p, { city: 'Paris' }), { origin: 'https://evil.example' })).code).toBe('CSRF_FAILED');
    // The date of birth has its own route; an unknown key is refused.
    expect((await put(op, 'profile', whole(p, { birthDate: '1990-01-01' }))).statusCode).toBe(400);
    expect((await put(op, 'profile', whole(p, { note: 'x' }))).statusCode).toBe(400);
    const res = await put(op, 'profile', whole(p, { city: 'Paris', instagram: 'https://www.instagram.com/Camille.DL/' }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((safeJson(res) as Json).profile).toMatchObject({ city: 'Paris', instagram: 'camille.dl', version: p.version + 1, updatedBy: 'STAFF', birthDate: '1994-03-14' });
    const audit = await h.ctx.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('target_id', '=', me.id).where('action', '=', 'account.profile.update').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(audit).toEqual({ actor_type: 'admin', details: { by: 'staff', fields: ['city'] } });
    // The collector's YOUR PROFILE, read before, is now behind: 409 for the collector, in its own words.
    const late = await me.client.request('PUT', '/api/v1/account/profile', { body: { ...whole(p, { city: 'Nice' }), birthDate: undefined } });
    expect([late.statusCode, errorOf(late)]).toEqual([409, { code: 'PROFILE_CHANGED', message: 'Your profile was changed meanwhile.' }]);
    // And Client Services', read before the collector's next save, 409 in the console's words.
    const now = safeJson(await me.client.get('/api/v1/account/profile')) as Json;
    expect((await me.client.request('PUT', '/api/v1/account/profile', { body: { ...whole({ ...now.profile, heard: null }, { city: 'Lyon' }) } })).statusCode).toBe(200);
    const stale = await put(op, 'profile', whole(p, { version: p.version + 1, city: 'Marseille' }));
    expect([stale.statusCode, errorOf(stale)]).toEqual([409, { code: 'PROFILE_CHANGED', message: 'The client changed the profile meanwhile. It has been read again: check and save.' }]);
    expect(errorOf(await op.request('PUT', `/api/admin/owners/${randomUUID()}/profile`, { body: whole(p) })).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('PUT …/birth-date: an OPERATOR changes or removes the date with a reason, kept as a private note in the same transaction; the version; an AUDITOR 403', async () => {
    const p = (await sheetOf(op)).profile;
    expect(errorOf(await put(auditor, 'birth-date', { version: p.version, birthDate: '1994-04-13', why: 'Day and month swapped.' })).code).toBe('FORBIDDEN');
    expect(errorOf(await put(op, 'birth-date', { version: p.version, birthDate: '1994-04-13', why: 'Day and month swapped.' }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    const noWhy = await put(op, 'birth-date', { version: p.version, birthDate: '1994-04-13', why: '' });
    expect([noWhy.statusCode, errorOf(noWhy)]).toEqual([400, { code: 'VALIDATION_FAILED', message: 'Give the reason.' }]);
    expect((await put(op, 'birth-date', { version: p.version, birthDate: '1994-04-13' })).statusCode).toBe(400);
    const stale = await put(op, 'birth-date', { version: p.version - 1, birthDate: '1994-04-13', why: 'Day and month swapped.' });
    expect(errorOf(stale).code).toBe('PROFILE_CHANGED');
    const res = await put(op, 'birth-date', { version: p.version, birthDate: '1994-04-13', why: 'Day and month swapped.' });
    expect(res.statusCode, res.body).toBe(200);
    expect((safeJson(res) as Json).profile).toMatchObject({ birthDate: '1994-04-13', birthDateBy: 'STAFF', version: p.version + 1 });
    const sheet = await sheetOf(op);
    expect(sheet.privateNotes).toEqual({ items: [expect.objectContaining({ text: 'Date of birth changed: Day and month swapped.' })], total: 1 });
    const removed = await put(op, 'birth-date', { version: p.version + 1, birthDate: null, why: 'Not the client\'s own.' });
    expect((safeJson(removed) as Json).profile).toMatchObject({ birthDate: null, birthDateBy: null, version: p.version + 2 });
    // The collector entered it once: theirs is used, only Client Services sets it now.
    const read = safeJson(await me.client.get('/api/v1/account/profile')) as Json;
    expect(read.profile).toMatchObject({ birthDate: null, birthDateLocked: true });
    const again = await me.client.request('PUT', '/api/v1/account/profile', { body: { ...whole({ ...read.profile, heard: null }), birthDate: '1994-04-13' } });
    expect(errorOf(again).code).toBe('BIRTH_DATE_ENTERED');
    const audits = await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', me.id).where('action', 'in', ['account.profile.update', 'account.note.add']).orderBy('id', 'desc').limit(4).execute();
    expect(audits.reverse().map((a) => [a.action, (a.details as Json).birthDate ?? null])).toEqual([
      ['account.note.add', null],
      ['account.profile.update', 'changed'],
      ['account.note.add', null],
      ['account.profile.update', 'cleared'],
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/1994|swapped/);
  });

  it('PUT …/default-address: an OPERATOR edits the default address in place, or adds the first as the default; audited by staff with the id and country only; an AUDITOR 403', async () => {
    const before = (await sheetOf(op)).profile;
    const body = { name: 'Camille Durand', address: '3 rue de la République\n69001 Lyon', country: 'FR', phone: '+33 6 12 34 56 78' };
    expect(errorOf(await put(auditor, 'default-address', body)).code).toBe('FORBIDDEN');
    expect(errorOf(await put(op, 'default-address', body, { noCsrf: true })).code).toBe('CSRF_FAILED');
    const bad = await put(op, 'default-address', { ...body, country: 'XX' });
    expect([bad.statusCode, errorOf(bad)]).toEqual([400, { code: 'VALIDATION_FAILED', message: 'Choose a country.' }]);
    const res = await put(op, 'default-address', body);
    expect(res.statusCode, res.body).toBe(200);
    expect((safeJson(res) as Json).profile).toMatchObject({ address: { name: 'Camille Durand', lines: '3 rue de la République\n69001 Lyon', country: 'FR' }, otherAddresses: 0, version: before.version });
    const audit = await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', me.id).where('action', 'like', 'account.address.%').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ action: 'account.address.update', details: { by: 'staff', country: 'FR' } });
    expect(JSON.stringify(audit)).not.toContain('République');
    // An account with no address: the first, made the default.
    const other = await accountIdOf((await accountClient(h)).email);
    const created = await op.request('PUT', `/api/admin/owners/${other}/default-address`, { body: { ...body, country: 'IT', address: 'Via Roma 1\n20121 Milano' } });
    expect((safeJson(created) as Json).profile).toMatchObject({ address: { country: 'IT' }, otherAddresses: 0 });
    expect(await h.ctx.db.selectFrom('account_addresses').select(['is_default', 'country']).where('account_id', '=', other).execute()).toEqual([{ is_default: true, country: 'IT' }]);
  });
});
