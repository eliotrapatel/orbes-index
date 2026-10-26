/**
 * THE VAULT's collector routes over HTTP (lot Q3, step Q3.9; plan §2.9, §2.10; routes/account.ts; services/vault.ts
 * holds the rules, test/services/vault*.test.ts prove them): signed in only (401 otherwise), the account's own vaults
 * only (another account's 404 VAULT_NOT_FOUND), never stored by a cache, bodies strict.
 *
 *  - THE VAULT page (GET /vaults): YOUR VAULTS, OPENED, the ledger, WHAT A VAULT CAN HOLD's eight kinds in the grid's
 *    order with the rare ones marked, and never the house table: no odds, quantity or part of a row before it is drawn
 *    (D22 "Not chosen: … odds table on any page"); the quiet number (GET /vaults/summary);
 *  - the door on SOLD OUT and the end page (GET /vaults/live/:dropId): the entry's own vault of that release while it
 *    waits, 404 otherwise (N28);
 *  - the opening (POST /vaults/:id/open): the reveal written once and answered again for a vault already opened (one
 *    draw, one receipt, its row's `given` + 1 once: a lost answer is never a second draw), 409 VAULT_EXPIRED, 409
 *    VAULT_REVOKED only for a returned piece's vault, 10 a minute per account (429 RATE_LIMITED the 11th, whatever the
 *    network; another account on the same network opens);
 *  - INVITE A FRIEND (POST /vaults/invite): one link, the same ever after; CREATE ACCOUNT with it names the inviter;
 *  - a credit to give (GET /vaults/gifts/:code, POST …/accept): nothing of the giver, accepted once by a friend holding
 *    no piece, the giver and another account after refused in words, an unknown code 404;
 *  - YOUR ORDERS: a right to buy listed and bought within its 24 hours (the same order again; 409 VAULT_OFFER_ENDED
 *    after), a piece won free's sizes and its claim (VAULT_SIZE_NONE_LEFT only on a change of size to one with no unit,
 *    the address asked, PAID; any other order 404).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { VAULT_OPEN_PER_MINUTE } from '../../src/server/http/rate-limit.js';
import { revokeReturnedPieceVaults, VAULT_GRID } from '../../src/server/services/vault.js';
import type { Actor } from '../../src/server/types.js';
import { createLiveRelease, liveFixtureOn, sizedModel, type LiveFixture } from '../support/live.js';
import { accountClient, createAdmin, createHarness, errorOf, issue, ORIGIN, PASSWORD, safeJson, seedCatalog, type Client, type Harness } from './support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PARIS = { name: 'Camille Martin', address: '12 rue de Rivoli\n75004 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };

type Json = Record<string, unknown>;

describe('THE VAULT’s collector routes (lot Q3, step Q3.9)', () => {
  let h: Harness;
  let staff: Actor & { id: string };
  let f: LiveFixture;
  let france: string;
  let ip = 10;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-02T09:00:00.000Z');
    staff = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    f = await liveFixtureOn(h.ctx, h.clock);
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  const vault = () => h.ctx.services.vault;
  /** A signed-in collector on its own network (the per-network budgets never meet). */
  async function collector(): Promise<{ c: Client; id: string; email: string; ip: string }> {
    const at = `198.51.100.${ip++}`;
    const { client, email } = await accountClient(h, { ip: at });
    const id = (await h.t.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
    return { c: client, id, email, ip: at };
  }
  /** An account registered and signed in on `c` (its network's), its id. */
  async function accountClientOn(c: Client): Promise<string> {
    const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
    expect((await c.post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Owner', lastName: 'Test', country: 'FR' })).statusCode).toBe(201);
    return (await h.t.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
  }
  /** The table: `row` alone above the floor at 1 IN 1 (every opening draws it); `{}`: the floor alone. */
  async function only(row: Json): Promise<void> {
    for (const r of (await vault().settings()).rewards) if (r.kind !== 'I_WAS_THERE' && r.active) await vault().deactivateReward(r.id, staff);
    if (Object.keys(row).length > 0) await vault().createReward({ oddsIn: 1, quantity: 1_000, ...row }, staff);
  }
  const houseVault = async (accountId: string) => (await vault().give({ source: 'HOUSE', accountId, giftId: randomUUID(), givenBy: staff.id })).vaults[0]!.id;
  const open = (c: Client, id: string) => c.post(`/api/v1/account/vaults/${id}/open`);

  it('signed out: every route answers 401', async () => {
    const anyone = h.client({ ip: '198.51.100.250' });
    const id = randomUUID();
    for (const [method, url] of [
      ['GET', '/api/v1/account/vaults'],
      ['GET', '/api/v1/account/vaults/summary'],
      ['GET', `/api/v1/account/vaults/live/${id}`],
      ['POST', `/api/v1/account/vaults/${id}/open`],
      ['POST', '/api/v1/account/vaults/invite'],
      ['GET', '/api/v1/account/vaults/gifts/ABCD-EFGH-JKMN'],
      ['POST', '/api/v1/account/vaults/gifts/ABCD-EFGH-JKMN/accept'],
      ['GET', '/api/v1/account/vaults/rights-to-buy'],
      ['POST', `/api/v1/account/vaults/${id}/buy`],
      ['GET', `/api/v1/account/orders/${id}/claim`],
      ['POST', `/api/v1/account/orders/${id}/claim`],
    ] as const) {
      const res = await anyone.request(method, url);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('THE VAULT page: YOUR VAULTS, OPENED, the ledger and the grid’s eight kinds; never the table’s odds or quantities (D22); the quiet number', async () => {
    await only({ kind: 'CREDIT', amountMinor: 2_500, currency: 'EUR', quantity: 777 });
    const me = await collector();
    const first = await houseVault(me.id);
    h.clock.advance(MINUTE);
    const second = await houseVault(me.id);
    const page = await me.c.get('/api/v1/account/vaults');
    expect(page.statusCode, page.body).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    const p = safeJson(page) as { waiting: Json[]; opened: Json[]; ledger: Json[]; grid: Json[]; waitingCount: number };
    expect(p.waiting.map((d) => [d.id, d.source, d.label, d.line])).toEqual([
      [first, 'HOUSE', 'FROM THE HOUSE', 'FROM THE HOUSE'],
      [second, 'HOUSE', 'FROM THE HOUSE', 'FROM THE HOUSE'],
    ]);
    expect(p.waiting[0]).toMatchObject({ waitsUntilDay: '2026-12-02' });
    expect(p.opened).toEqual([]);
    expect(p.waitingCount).toBe(2);
    expect(p.ledger.map((r) => r.source)).toEqual(['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE']);
    expect(p.grid).toEqual([...VAULT_GRID]);
    expect(p.grid.map((g) => g.kind)).toEqual(['CREDIT', 'ADDON', 'GUARANTEED', 'PRODUCT', 'CREDIT_TO_GIVE', 'I_WAS_THERE', 'VAULT_EDITION', 'THE_PIECE']);
    expect(p.grid.filter((g) => g.rare).map((g) => g.kind)).toEqual(['GUARANTEED', 'VAULT_EDITION', 'THE_PIECE']);
    // No row of the table reaches a collector: its odds, its quantity, its parts, its amount before it is drawn.
    for (const word of ['1 IN', 'oddsIn', 'odds', 'quantity', 'parts', '777', '2500', 'rewardId']) expect(page.body, word).not.toContain(word);
    expect(safeJson(await me.c.get('/api/v1/account/vaults/summary'))).toEqual({ waiting: 2 });

    // Opened: in OPENED with what it held, its own odds only in its reveal.
    const reveal = safeJson(await open(me.c, first)) as { reveal: Json };
    expect(reveal.reveal).toMatchObject({ vaultId: first, kind: 'CREDIT', prize: '€25', line: 'House credit, valid 30 days.', odds: '1 IN 1', rare: false, where: 'ACCOUNT', giftCode: null });
    const after = safeJson(await me.c.get('/api/v1/account/vaults')) as typeof p;
    expect(after.waiting.map((d) => d.id)).toEqual([second]);
    expect(after.opened).toMatchObject([{ id: first, source: 'HOUSE', label: 'FROM THE HOUSE', kind: 'CREDIT', prize: '€25', held: '€25 · HOUSE CREDIT', openedDay: '2026-11-02', gift: null }]);
    expect(safeJson(await me.c.get('/api/v1/account/vaults/summary'))).toEqual({ waiting: 1 });
    // Another collector reads only their own.
    const other = await collector();
    expect(safeJson(await other.c.get('/api/v1/account/vaults'))).toMatchObject({ waiting: [], opened: [], waitingCount: 0 });
  });

  it('the opening: written once and answered again (one draw, one receipt, given + 1 once); another account’s 404; expired 409; a returned piece’s 409 VAULT_REVOKED; strict bodies', async () => {
    await only({ kind: 'CREDIT', amountMinor: 1_000, currency: 'EUR' });
    const me = await collector();
    const id = await houseVault(me.id);
    const givenBefore = (await vault().settings()).rewards.find((r) => r.kind === 'CREDIT' && r.active)!;
    const once = await open(me.c, id);
    expect(once.statusCode, once.body).toBe(200);
    expect(once.headers['cache-control']).toBe('no-store');
    h.clock.advance(MINUTE);
    const again = await open(me.c, id);
    expect(safeJson(again)).toEqual(safeJson(once));
    const row = (await vault().settings()).rewards.find((r) => r.id === givenBefore.id)!;
    expect(row.given).toBe(givenBefore.given + 1);
    expect(await h.t.db.selectFrom('house_deliveries').select('id').where('dedupe_key', '=', `VAULT_OPENED:${id}`).execute()).toHaveLength(1);
    expect(await h.t.db.selectFrom('audit_logs').select('id').where('action', '=', 'vault.open').where('target_id', '=', id).execute()).toHaveLength(1);
    expect(await h.t.db.selectFrom('tier_grants').select('id').where('vault_id', '=', id).execute()).toHaveLength(1);

    // Another account's vault, an unknown one: not found; a malformed id: 400; a body: refused.
    const other = await collector();
    expect(errorOf(await open(other.c, id))).toEqual({ code: 'VAULT_NOT_FOUND', message: 'Vault not found.' });
    expect(errorOf(await open(other.c, randomUUID())).code).toBe('VAULT_NOT_FOUND');
    expect(errorOf(await open(other.c, 'not-a-vault')).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await other.c.post(`/api/v1/account/vaults/${await houseVault(other.id)}/open`, { pick: 1 })).code).toBe('VALIDATION_FAILED');

    // Kept 30 days, then expired (given 30 days ago: the session's own life is shorter than the vault's).
    const late = (await vault().give({ source: 'HOUSE', accountId: other.id, giftId: randomUUID(), givenBy: staff.id }, new Date(h.clock.now().getTime() - 30 * DAY))).vaults[0]!.id;
    expect(errorOf(await open(other.c, late))).toEqual({ code: 'VAULT_EXPIRED', message: 'This vault was kept 30 days and can no longer be opened.' });
    expect(await h.t.db.selectFrom('vaults').select('opened_at').where('id', '=', late).executeTakeFirstOrThrow()).toEqual({ opened_at: null });

    // A returned piece's vault: taken back, its words.
    const catalog = await seedCatalog(h.ctx);
    const piece = (await issue(h.ctx, catalog)).product;
    const pv = (await vault().give({ source: 'PIECE', accountId: other.id, productId: piece.id })).vaults[0]!.id;
    await inTransaction(h.t.db, (tx) => revokeReturnedPieceVaults(tx, piece.id, h.clock.now()));
    expect(errorOf(await open(other.c, pv))).toEqual({ code: 'VAULT_REVOKED', message: 'This vault went back with its piece.' });
  });

  it(`the opening is rate-limited: ${VAULT_OPEN_PER_MINUTE} a minute per account, the next 429 RATE_LIMITED whatever its network; another account on the same network opens`, async () => {
    await only({});
    const me = await collector();
    const id = await houseVault(me.id);
    for (let i = 0; i < VAULT_OPEN_PER_MINUTE; i++) expect((await open(me.c, id)).statusCode, `opening ${i + 1}`).toBe(200);
    const over = await open(me.c, id);
    expect(over.statusCode).toBe(429);
    expect(errorOf(over).code).toBe('RATE_LIMITED');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    // The same account from another network: the account's budget, still spent.
    const elsewhere = h.client({ ip: '192.0.2.77' });
    for (const [k, v] of me.c.cookies) elsewhere.cookies.set(k, v);
    elsewhere.csrf = me.c.csrf;
    expect((await open(elsewhere, id)).statusCode).toBe(429);
    // Another account on the first network: its own budget. The page reads on: only the opening is limited.
    const neighbour = h.client({ ip: me.ip });
    const other = await accountClientOn(neighbour);
    expect((await open(neighbour, await houseVault(other))).statusCode).toBe(200);
    expect((await me.c.get('/api/v1/account/vaults')).statusCode).toBe(200);
  });

  it('the door on SOLD OUT and the end page: the entry’s own vault of that release while it waits; 404 for another account, another release, once opened', async () => {
    await only({});
    const me = await collector();
    const opensAt = new Date(h.clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt });
    const other = await createLiveRelease(f, { opensAt });
    await h.t.db.updateTable('drops').set({ vault_on: true }).where('id', 'in', [r.id, other.id]).execute();
    h.clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(me.id, r.id, { sizeId: r.sizes[0]!.id }, { type: 'account', id: me.id });
    const entry = await h.t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', me.id).executeTakeFirstOrThrow();
    const given = await vault().give({ source: 'LIVE', accountId: me.id, dropId: r.id, entryId: entry.id });
    const id = given.vaults[0]!.id;

    const door = await me.c.get(`/api/v1/account/vaults/live/${r.id}`);
    expect(door.statusCode, door.body).toBe(200);
    expect(door.headers['cache-control']).toBe('no-store');
    expect((safeJson(door) as { vault: Json }).vault).toMatchObject({ id, source: 'LIVE', label: 'YOUR SIZE SOLD OUT', line: `YOUR SIZE SOLD OUT · MONOLITHE` });
    const stranger = await collector();
    expect(errorOf(await stranger.c.get(`/api/v1/account/vaults/live/${r.id}`)).code).toBe('VAULT_NOT_FOUND');
    expect(errorOf(await me.c.get(`/api/v1/account/vaults/live/${other.id}`)).code).toBe('VAULT_NOT_FOUND');
    expect(errorOf(await me.c.get('/api/v1/account/vaults/live/not-a-release')).code).toBe('VALIDATION_FAILED');
    expect((await open(me.c, id)).statusCode).toBe(200);
    expect(errorOf(await me.c.get(`/api/v1/account/vaults/live/${r.id}`)).code).toBe('VAULT_NOT_FOUND');
  });

  it('INVITE A FRIEND: one personal link, the same ever after; CREATE ACCOUNT with its code names the inviter', async () => {
    const me = await collector();
    const made = await me.c.post('/api/v1/account/vaults/invite');
    expect(made.statusCode, made.body).toBe(200);
    const { code, url } = safeJson(made) as { code: string; url: string };
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(url).toBe(`${ORIGIN}/verify/join/${code}`);
    expect(safeJson(await me.c.post('/api/v1/account/vaults/invite'))).toEqual({ code, url });
    expect(errorOf(await me.c.post('/api/v1/account/vaults/invite', { again: true })).code).toBe('VALIDATION_FAILED');
    const friend = h.client({ ip: '198.51.100.240' });
    const email = `friend-${randomUUID().slice(0, 8)}@example.com`;
    expect((await friend.post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Ana', lastName: 'Friend', country: 'FR', invite: code.toLowerCase() })).statusCode).toBe(201);
    expect(await h.t.db.selectFrom('accounts').select('invited_by').where('email', '=', email).executeTakeFirstOrThrow()).toEqual({ invited_by: me.id });
  });

  it('a credit to give: read by its code (nothing of the giver), accepted once by a friend holding no piece; the giver, a later account and an unknown code refused in words', async () => {
    await only({ kind: 'CREDIT_TO_GIVE', amountMinor: 3_000, currency: 'EUR' });
    const giver = await collector();
    const v = await houseVault(giver.id);
    const reveal = (safeJson(await open(giver.c, v)) as { reveal: { giftCode: string; prize: string } }).reveal;
    expect(reveal.prize).toBe('€30 TO GIVE');
    expect(reveal.giftCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const code = reveal.giftCode;

    const own = await giver.c.get(`/api/v1/account/vaults/gifts/${code}`);
    expect(own.statusCode, own.body).toBe(200);
    expect((safeJson(own) as { gift: Json }).gift).toMatchObject({ amount: '€30', amountMinor: 3_000, currency: 'EUR', state: 'OPEN', canAccept: false, refusal: 'This credit is yours to give to a friend.' });
    const friend = await collector();
    const read = await friend.c.get(`/api/v1/account/vaults/gifts/${code.toLowerCase()}`);
    expect((safeJson(read) as { gift: Json }).gift).toMatchObject({ state: 'OPEN', canAccept: true, refusal: null });
    // Nothing of the giver: no email, no id, no name.
    for (const word of [giver.email, giver.id, 'Owner']) expect(read.body).not.toContain(word);

    expect(errorOf(await giver.c.post(`/api/v1/account/vaults/gifts/${code}/accept`))).toEqual({ code: 'VAULT_GIFT_NOT_FOR_YOU', message: 'This credit is yours to give to a friend.' });
    const accepted = await friend.c.post(`/api/v1/account/vaults/gifts/${code}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(safeJson(accepted)).toMatchObject({ gift: { state: 'ACCEPTED', canAccept: false }, credit: { amountMinor: 3_000, currency: 'EUR' } });
    // Accepted again by the friend: the same credit; by anyone else: ended.
    expect((await friend.c.post(`/api/v1/account/vaults/gifts/${code}/accept`)).statusCode).toBe(200);
    expect(await h.t.db.selectFrom('tier_grants').select('id').where('account_id', '=', friend.id).where('kind', '=', 'VAULT').execute()).toHaveLength(1);
    const later = await collector();
    expect(errorOf(await later.c.post(`/api/v1/account/vaults/gifts/${code}/accept`))).toEqual({ code: 'VAULT_GIFT_ENDED', message: 'This credit can no longer be accepted.' });
    expect((safeJson(await later.c.get(`/api/v1/account/vaults/gifts/${code}`)) as { gift: Json }).gift).toMatchObject({ state: 'ENDED', canAccept: false });
    expect(errorOf(await later.c.get('/api/v1/account/vaults/gifts/ZZZZ-ZZZZ-ZZZZ'))).toEqual({ code: 'VAULT_GIFT_NOT_FOUND', message: 'Gift not found.' });
    expect(errorOf(await later.c.post('/api/v1/account/vaults/gifts/ZZZZ-ZZZZ-ZZZZ/accept')).code).toBe('VAULT_GIFT_NOT_FOUND');
    // The giver's OPENED row: GIVEN.
    expect((safeJson(await giver.c.get('/api/v1/account/vaults')) as { opened: Json[] }).opened).toMatchObject([{ id: v, kind: 'CREDIT_TO_GIVE', gift: { code: null, given: true } }]);
  });

  /** A model of `stock` units per size at the house's location, priced. */
  async function stockedModel(name: string, stock: Record<string, number>): Promise<{ id: string; sku: Record<string, string> }> {
    const id = await sizedModel(h.t.db, name, Object.keys(stock));
    await h.t.db.updateTable('models').set({ base_price_minor: 90_000, base_currency: 'EUR' }).where('id', '=', id).execute();
    const sku: Record<string, string> = {};
    for (const k of await h.t.db.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', id).execute()) sku[k.size_label!] = k.id;
    for (const [l, n] of Object.entries(stock)) if (n > 0) await h.ctx.services.stock.adjust({ skuId: sku[l]!, locationId: france, delta: n, note: 'Counted.' }, staff);
    return { id, sku };
  }

  it('YOUR ORDERS: a right to buy listed and bought within its 24 hours (the same order again), refused after them', async () => {
    const m = await stockedModel('HALO', { '52': 2, '54': 1 });
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'RIGHT_TO_BUY' });
    const me = await collector();
    const v = await houseVault(me.id);
    expect((safeJson(await open(me.c, v)) as { reveal: Json }).reveal).toMatchObject({ kind: 'PRODUCT', line: 'Yours to buy at its price, for 24 hours.', where: 'ORDERS' });
    const rights = await me.c.get('/api/v1/account/vaults/rights-to-buy');
    expect(rights.statusCode, rights.body).toBe(200);
    expect((safeJson(rights) as { items: Json[] }).items).toMatchObject([{ vaultId: v, modelId: m.id, priceMinor: 90_000, currency: 'EUR', sizes: ['52', '54'] }]);
    expect(errorOf(await me.c.post(`/api/v1/account/vaults/${v}/buy`, { size: '61' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await me.c.post(`/api/v1/account/vaults/${v}/buy`, { size: 52 })).code).toBe('VALIDATION_FAILED');
    const bought = await me.c.post(`/api/v1/account/vaults/${v}/buy`, { size: '54', address: { address: PARIS } });
    expect(bought.statusCode, bought.body).toBe(200);
    const order = (safeJson(bought) as { order: { id: string } }).order;
    expect(await h.t.db.selectFrom('orders').select(['channel', 'vault_id', 'price_minor', 'size_label', 'status']).where('id', '=', order.id).executeTakeFirstOrThrow()).toEqual({
      channel: 'VAULT', vault_id: v, price_minor: 90_000, size_label: '54', status: 'RESERVED',
    });
    expect((safeJson(await me.c.post(`/api/v1/account/vaults/${v}/buy`, { size: '52' })) as { order: { id: string } }).order.id).toBe(order.id);
    expect((safeJson(await me.c.get('/api/v1/account/vaults/rights-to-buy')) as { items: Json[] }).items).toEqual([]);
    // Another account's vault: not found. After its 24 hours: ended.
    const other = await collector();
    expect(errorOf(await other.c.post(`/api/v1/account/vaults/${v}/buy`, { size: '52' })).code).toBe('VAULT_NOT_FOUND');
    const late = await houseVault(other.id);
    await open(other.c, late);
    h.clock.advance(24 * HOUR);
    expect(errorOf(await other.c.post(`/api/v1/account/vaults/${late}/buy`, { size: '52' }))).toEqual({ code: 'VAULT_OFFER_ENDED', message: 'The 24 hours to buy it are over.' });
  });

  it('YOUR ORDERS: a piece won free, its sizes and its claim; VAULT_SIZE_NONE_LEFT only on a change of size, the address asked, then PAID; any other order 404', async () => {
    const m = await stockedModel('ORBITE', { '52': 1, '54': 0 });
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'FREE' });
    const me = await collector();
    const v = await houseVault(me.id);
    expect((safeJson(await open(me.c, v)) as { reveal: Json }).reveal).toMatchObject({ kind: 'PRODUCT', line: 'Yours, free. In YOUR ORDERS.', where: 'ORDERS' });
    const orderId = (await h.t.db.selectFrom('vaults').select('order_id').where('id', '=', v).executeTakeFirstOrThrow()).order_id!;
    const sizes = await me.c.get(`/api/v1/account/orders/${orderId}/claim`);
    expect(sizes.statusCode, sizes.body).toBe(200);
    expect(safeJson(sizes)).toMatchObject({ orderId, claimed: false, sizeFixed: false, size: '52', sizes: [{ label: '52', current: true, available: true }, { label: '54', current: false, available: false }] });
    expect(errorOf(await me.c.post(`/api/v1/account/orders/${orderId}/claim`, { size: '54', address: { address: PARIS } }))).toEqual({ code: 'VAULT_SIZE_NONE_LEFT', message: expect.any(String) });
    expect(errorOf(await me.c.post(`/api/v1/account/orders/${orderId}/claim`)).code).toBe('ORDER_ADDRESS_MISSING');
    expect(errorOf(await me.c.post(`/api/v1/account/orders/${orderId}/claim`, { address: { street: 'x' } })).code).toBe('VALIDATION_FAILED');
    const claimed = await me.c.post(`/api/v1/account/orders/${orderId}/claim`, { address: { address: PARIS, save: true } });
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(await h.t.db.selectFrom('orders').select(['status', 'price_minor', 'sku_id']).where('id', '=', orderId).executeTakeFirstOrThrow()).toEqual({ status: 'PAID', price_minor: 0, sku_id: m.sku['52'] });
    expect(safeJson(await me.c.get(`/api/v1/account/orders/${orderId}/claim`))).toMatchObject({ claimed: true });
    // Another account; an unknown order: not found.
    const other = await collector();
    expect(errorOf(await other.c.get(`/api/v1/account/orders/${orderId}/claim`)).code).toBe('ORDER_NOT_FOUND');
    expect(errorOf(await other.c.post(`/api/v1/account/orders/${orderId}/claim`, { address: { address: PARIS } })).code).toBe('ORDER_NOT_FOUND');
    expect(errorOf(await other.c.get(`/api/v1/account/orders/${randomUUID()}/claim`)).code).toBe('ORDER_NOT_FOUND');
  });
});
