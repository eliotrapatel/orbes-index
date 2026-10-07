/**
 * YOUR TIER's benefits in use (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T10; GET /api/v1/club/status):
 *
 *  - `program`: the lines THE PROGRAM gives the account's tier now: the early access, shipping and care of its own
 *    tier, the priority from the tier it starts from, the gift and the credit of its own tier only, the experiences it
 *    is invited to; none without a tier; NEXT's `program`, what the next tier's program adds;
 *  - `inUse`: the credit left and until when, usable now; the yearly care of the year (null when the tier gives none);
 *    a PENDING welcome gift only while its tier is held and has an active gift model, WITH_ORDER from its order until
 *    it is delivered; the channels THE PROGRAM takes the credit off (`creditChannels`), which its note names;
 *  - PLATINE's words by default are none: its early access and priority are its program's lines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLUB_TIER_DEFAULT_BENEFITS } from '../../src/server/services/club.js';
import { DEFAULT_PROGRAM, programLines } from '../../src/server/services/club-program.js';
import { orderReference } from '../../src/server/services/orders.js';
import { addUtcMonths } from '../../src/server/services/tier-grants.js';
import type { Actor } from '../../src/server/types.js';
import { createModel, holdPieces } from '../support/live.js';
import { accountClient, adminClient, createHarness, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface StatusJson {
  tier: { level: number; name: string | null };
  benefits: string[];
  program: string[];
  next: { name: string; program: string[]; benefits: string[] } | null;
  inUse: {
    credit: { balanceMinor: number; currency: string; expiresAt: string } | null;
    care: { year: number; used: number; allowance: number | 'ALL' } | null;
    gifts: { tier: string; model: string; state: string; orderReference: string | null }[];
    creditChannels: string[];
  };
}

describe('YOUR TIER: the program and the benefits in use (BP-19 T10)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-07T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    const a = await h.t.db.insertInto('admin_users').values({ email: 'club-status@orbes.test', email_normalized: 'club-status@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: a.id };
  });
  afterAll(() => h?.close());

  async function holding(n: number): Promise<{ client: Client; id: string }> {
    const { client, email } = await accountClient(h);
    const id = (await h.t.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
    if (n) await holdPieces(h.t.db, id, n, catalog.modelId);
    return { client, id };
  }
  const status = async (c: Client) => {
    const res = await c.get('/api/v1/club/status');
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as StatusJson;
  };
  const setProgram = async (change: Partial<typeof DEFAULT_PROGRAM>) => {
    const p = await h.ctx.services.clubProgram.read();
    await h.ctx.services.clubProgram.update({ ...p, ...change }, admin);
  };

  it('says the program of the account\'s own tier, and what the next tier\'s adds; nothing below TITANE', async () => {
    expect(CLUB_TIER_DEFAULT_BENEFITS.PLATINE).toBe('');
    const none = await status((await holding(0)).client);
    expect([none.program, none.benefits]).toEqual([[], []]);
    expect(none.next).toMatchObject({ name: 'TITANE', program: [] });
    const titane = await status((await holding(1)).client);
    expect(titane.program).toEqual([]);
    expect(titane.next!.program).toEqual(programLines(DEFAULT_PROGRAM, 2));
    const platine = await status((await holding(5)).client);
    expect(platine.program).toEqual([
      'Early access to each draw: a place reserved directly 2 hours before entries open to everyone, unless its page says otherwise.',
      'Free shipping on every order.',
      'The yearly care of 1 piece a year by the ORBES atelier, asked for from the piece, with a prepaid label both ways.',
      'Priority with ORBES Client Services: your messages are read first.',
      'A credit of € 50, valid 12 months, on a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.',
      'The members’ evening, once a year, by invitation in THE CIRCLE.',
    ]);
    // PLATINE's words by default are none: its benefits are TITANE's words only.
    expect(platine.benefits).toEqual(CLUB_TIER_DEFAULT_BENEFITS.TITANE.split('\n'));
    // PALLADIUM: its own early access, shipping and care; the priority it holds from PLATINE; its own credit only.
    const palladium = await status((await holding(10)).client);
    expect(palladium.program).toEqual([
      'Early access to each draw: a place reserved directly 4 hours before entries open to everyone, unless its page says otherwise.',
      'Free express shipping on every order.',
      'The yearly care of every piece by the ORBES atelier, once a year each, asked for from the piece, with a prepaid label both ways.',
      'Priority with ORBES Client Services: your messages are read first.',
      'A credit of € 100, valid 12 months, on a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.',
      'The members’ evening, once a year, by invitation in THE CIRCLE.',
      'Launch previews and partner experiences, by invitation in THE CIRCLE.',
    ]);
    expect(palladium.next).toBeNull();
  });

  it('shows the credit left and until when, the yearly care of the year, and a welcome gift only while it would come', async () => {
    const a = await holding(5);
    const first = await status(a.client);
    const now = h.clock.now();
    expect(first.inUse).toEqual({
      credit: { balanceMinor: 5000, currency: 'EUR', expiresAt: addUtcMonths(now, 12).toISOString() },
      care: { year: 2026, used: 0, allowance: 1 },
      // No gift model in THE PROGRAM: no WELCOME GIFT row, never a gift that would not come.
      gifts: [],
      // THE PROGRAM's "Credit usable on", which the note under CREDIT names.
      creditChannels: ['DRAW', 'LIVE', 'SALON'],
    });
    await setProgram({ creditChannels: ['DRAW', 'LIVE'] });
    expect((await status(a.client)).inUse.creditChannels).toEqual(['DRAW', 'LIVE']);
    await setProgram({ creditChannels: ['DRAW', 'LIVE', 'SALON'] });
    // A gift model set: the row reads WITH YOUR NEXT ORDER.
    const charm = await createModel(h.t.db, 'ORBITAL CHARM');
    await setProgram({ giftPlatineModelId: charm });
    expect((await status(a.client)).inUse.gifts).toEqual([{ tier: 'PLATINE', model: 'ORBITAL CHARM', state: 'PENDING', orderReference: null }]);
    // The model withdrawn from the catalogue: the row goes.
    await h.t.db.updateTable('models').set({ active: false }).where('id', '=', charm).execute();
    expect((await status(a.client)).inUse.gifts).toEqual([]);
    await h.t.db.updateTable('models').set({ active: true }).where('id', '=', charm).execute();
    // With the next order: WITH ORDER OR-…, until it is delivered.
    const request = await h.t.db.insertInto('shop_requests').values({ account_id: a.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(60_000);
    await h.ctx.services.salon.close(request.id, { note: 'Concluded.', outcome: 'ACCEPTED' }, admin);
    const parent = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    expect((await status(a.client)).inUse.gifts).toEqual([{ tier: 'PLATINE', model: 'ORBITAL CHARM', state: 'WITH_ORDER', orderReference: orderReference(parent) }]);
    const carrier = (await h.t.db.selectFrom('carriers').select('id').executeTakeFirstOrThrow()).id;
    const at = h.clock.now();
    await h.t.db
      .updateTable('orders')
      .set({ status: 'DELIVERED', reservation: null, paid_at: at, shipped_at: at, delivered_at: at, carrier_id: carrier, tracking_number: '6A12345678901' })
      .where('with_order_id', '=', parent)
      .execute();
    expect((await status(a.client)).inUse.gifts).toEqual([]);
    // The yearly care asked for counts; a tier whose care is 0 has no YEARLY CARE row.
    const serial = (await h.t.db.selectFrom('ownership as o').innerJoin('products as p', 'p.id', 'o.product_id').select('p.product_id').where('o.account_id', '=', a.id).executeTakeFirstOrThrow()).product_id;
    await h.ctx.services.care.request(a.id, serial, { name: 'A. Owner', address: '1 rue de Rivoli, Paris' }, { type: 'account', id: a.id });
    expect((await status(a.client)).inUse.care).toEqual({ year: 2026, used: 1, allowance: 1 });
    await setProgram({ carePiecesPlatine: 0, giftPlatineModelId: null });
    expect((await status(a.client)).inUse.care).toBeNull();
    await setProgram({ carePiecesPlatine: 1 });
    // Below its tier, the credit waits: no row; TITANE has no care row either.
    const titane = await holding(1);
    expect((await status(titane.client)).inUse).toEqual({ credit: null, care: null, gifts: [], creditChannels: ['DRAW', 'LIVE', 'SALON'] });
    await h.t.db.updateTable('ownership').set({ ended_at: h.clock.now() }).where('account_id', '=', a.id).where('product_id', 'in', (eb) => eb.selectFrom('products').select('id').where('product_id', '!=', serial)).execute();
    expect((await status(a.client)).inUse.credit).toBeNull();
  });
  it('gives the console\'s owner sheet its Club block: the grants, a credit with what is left, a gift and where it is, the yearly care of the year', async () => {
    const a = await holding(10);
    await status(a.client);
    const auditor = await adminClient(h, 'AUDITOR');
    const res = await auditor.get(`/api/admin/owners/${a.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const club = (safeJson(res) as { club: { tier: string; grants: { tier: string; kind: string; balanceMinor: number | null; gift: unknown }[]; careThisYear: unknown } }).club;
    expect(club.tier).toBe('PALLADIUM');
    expect(club.grants.map((g) => [g.tier, g.kind, g.balanceMinor, g.gift])).toEqual([
      ['PLATINE', 'GIFT', null, { state: 'PENDING', orderId: null, orderReference: null }],
      ['PLATINE', 'CREDIT', 5000, null],
      ['PALLADIUM', 'GIFT', null, { state: 'PENDING', orderId: null, orderReference: null }],
      ['PALLADIUM', 'CREDIT', 10000, null],
    ]);
    expect(club.careThisYear).toEqual({ year: 2026, used: 0, allowance: 'ALL', open: null });
  });
});
