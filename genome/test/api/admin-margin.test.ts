/**
 * The margin and its settings over HTTP (lot M4 plan §1.2, §1.5, steps M4.2 and M4.3; routes/admin/margin.ts): an
 * AUDITOR reads the margin and its CSV (amounts, counts and groups: no account, no email, no vault, no release; THE
 * VAULT's line and its five parts) and the settings (amounts and keys, nothing personal); an AUDITOR and an OPERATOR
 * never write the settings; an ADMIN writes every setting (each answer the whole settings), THE VAULT CARD's unit cost
 * included; LOGISTICS and RETAIL are refused; malformed requests answer 400, EUR's rate 422 MARGIN_RATE_EUR, a band
 * taken 409 SHIPPING_COST_TAKEN, an unknown band 404 SHIPPING_COST_NOT_FOUND, an unknown category 404
 * CATEGORY_NOT_FOUND. The figures are test/services/margin.test.ts's, the rules of each setting
 * test/services/margin-settings.test.ts's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MarginReport } from '../../src/server/services/margin.js';
import type { MarginSettings } from '../../src/server/services/margin-settings.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { MARGIN_NOW, seedMarginVault, type MarginVaultFixture } from '../support/margin.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, seedCatalog, type Client, type Harness } from './support.js';

describe('the margin\'s settings routes (lot M4 plan §1.2)', () => {
  let h: Harness;
  let auditor: Client;
  let operator: Client;
  let admin: Client;
  let agent: Client;
  let seller: Client;
  let jewelry: number;
  let second: number;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-26T09:00:00.000Z');
    await seedCatalog(h.ctx);
    await h.ctx.categories.create({ code: 'Q', name: 'Accessories', warrantyMonths: 24 }, SYSTEM_ACTOR);
    jewelry = (await h.ctx.categories.getByCode('J'))!.index;
    second = (await h.ctx.categories.getByCode('Q'))!.index;
    // What an owner entered before: a GBP rate, three bands, and a box bought in CHF (a currency without a rate).
    const owner: Actor = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    const settings = h.ctx.services.marginSettings;
    await settings.setRate('GBP', '1.2', owner);
    await settings.addShippingCost({ country: 'FR', maxWeightG: 500, costMinor: 690, currency: 'EUR' }, owner);
    await settings.addShippingCost({ country: 'FR', maxWeightG: 2000, costMinor: 990, currency: 'EUR' }, owner);
    await settings.addShippingCost({ country: null, maxWeightG: 2000, costMinor: 1500, currency: 'EUR' }, owner);
    await h.t.db.insertInto('boxes').values({ name: 'CHF BOX', inside_length_mm: 100, inside_width_mm: 70, inside_height_mm: 30, empty_weight_g: 90, cost_minor: 300, currency: 'CHF' }).execute();
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    admin = await adminClient(h, 'ADMIN');
    agent = await adminClient(h, 'LOGISTICS');
    seller = await adminClient(h, 'RETAIL');
  }, 60_000);
  afterAll(() => h?.close());

  it('an AUDITOR and an OPERATOR read the settings, no admin named; LOGISTICS and RETAIL are refused', async () => {
    for (const c of [auditor, operator]) {
      const res = await c.get('/api/admin/margin/settings');
      expect(res.statusCode, res.body).toBe(200);
      const s = safeJson(res) as MarginSettings;
      expect(s.currency).toBe('EUR');
      expect(s.rates.map((x) => [x.currency, x.eurRate])).toEqual([['GBP', '1.200000']]);
      expect(s.currenciesWithoutRate).toEqual(['CHF']);
      expect(s.shippingCosts.map((b) => [b.country, b.maxWeightG, b.costMinor, b.currency])).toEqual([
        ['FR', 500, 690, 'EUR'],
        ['FR', 2000, 990, 'EUR'],
        [null, 2000, 1500, 'EUR'],
      ]);
      expect(s.unitCosts.map((u) => u.key)).toContain('VAULT_CARD');
      expect(s.allowances.map((a) => [a.code, a.allowanceBp])).toEqual([['J', null], ['Q', null]]);
      expect(res.body).not.toContain('updated_by');
      expect(res.body).not.toContain('updatedBy');
    }
    for (const c of [agent, seller]) expect(errorOf(await c.get('/api/admin/margin/settings')).code).toBe('FORBIDDEN');
  });

  it('neither an AUDITOR nor an OPERATOR writes them (403 before any check)', async () => {
    const band = (safeJson(await auditor.get('/api/admin/margin/settings')) as MarginSettings).shippingCosts[0]!.id;
    for (const c of [auditor, operator, agent, seller]) {
      for (const [method, url, body] of [
        ['PUT', '/api/admin/margin/rates/CHF', { rate: 1.05 }],
        ['DELETE', '/api/admin/margin/rates/GBP', undefined],
        ['POST', '/api/admin/margin/shipping-costs', { country: 'IT', maxWeightG: 500, costMinor: 800, currency: 'EUR' }],
        ['PATCH', `/api/admin/margin/shipping-costs/${band}`, { costMinor: 1 }],
        ['DELETE', `/api/admin/margin/shipping-costs/${band}`, undefined],
        ['PUT', '/api/admin/margin/unit-costs/POUCH', { costMinor: 1, currency: 'EUR' }],
        ['PUT', '/api/admin/margin/unit-costs/VAULT_CARD', { costMinor: 1, currency: 'EUR' }],
        ['DELETE', '/api/admin/margin/unit-costs/POUCH', undefined],
        ['PUT', `/api/admin/margin/allowances/${second}`, { percent: 1 }],
        ['DELETE', `/api/admin/margin/allowances/${jewelry}`, undefined],
      ] as const) {
        const res = await c.request(method, url, body !== undefined ? { body } : {});
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    }
    const s = safeJson(await auditor.get('/api/admin/margin/settings')) as MarginSettings;
    expect(s.shippingCosts).toHaveLength(3);
    expect(s.rates).toHaveLength(1);
  });

  it('an ADMIN writes every setting, each answer the whole settings, audited', async () => {
    const put = async (url: string, body: unknown) => {
      const res = await admin.request('PUT', url, { body });
      expect(res.statusCode, res.body).toBe(200);
      return safeJson(res) as MarginSettings;
    };
    let s = await put('/api/admin/margin/rates/chf', { rate: '1.05' });
    expect(s.rates.map((x) => [x.currency, x.eurRate])).toEqual([['CHF', '1.050000'], ['GBP', '1.200000']]);
    expect(s.currenciesWithoutRate).toEqual([]);

    const created = await admin.post('/api/admin/margin/shipping-costs', { country: 'gb', maxWeightG: 500, costMinor: 800, currency: 'EUR' });
    expect(created.statusCode, created.body).toBe(201);
    s = safeJson(created) as MarginSettings;
    const gb = s.shippingCosts.find((b) => b.country === 'GB')!;
    expect(gb).toMatchObject({ maxWeightG: 500, costMinor: 800, currency: 'EUR' });
    expect(s.shippingCosts.map((b) => b.country)).toEqual(['FR', 'FR', 'GB', null]);
    const others = await admin.post('/api/admin/margin/shipping-costs', { country: '', maxWeightG: 500, costMinor: 1100, currency: 'EUR' });
    expect(others.statusCode, others.body).toBe(201);
    expect((safeJson(others) as MarginSettings).shippingCosts.filter((b) => b.country === null).map((b) => b.maxWeightG)).toEqual([500, 2000]);
    const taken = await admin.post('/api/admin/margin/shipping-costs', { country: 'GB', maxWeightG: 500, costMinor: 1, currency: 'EUR' });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken).code).toBe('SHIPPING_COST_TAKEN');
    const patched = await admin.patch(`/api/admin/margin/shipping-costs/${gb.id}`, { costMinor: 850 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((safeJson(patched) as MarginSettings).shippingCosts.find((b) => b.id === gb.id)!.costMinor).toBe(850);
    const onto = await admin.patch(`/api/admin/margin/shipping-costs/${gb.id}`, { country: 'FR' });
    expect(onto.statusCode).toBe(409);
    expect(errorOf(onto).code).toBe('SHIPPING_COST_TAKEN');
    const removed = await admin.request('DELETE', `/api/admin/margin/shipping-costs/${gb.id}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect((safeJson(removed) as MarginSettings).shippingCosts.some((b) => b.id === gb.id)).toBe(false);
    const gone = await admin.request('DELETE', `/api/admin/margin/shipping-costs/${gb.id}`);
    expect(gone.statusCode).toBe(404);
    expect(errorOf(gone).code).toBe('SHIPPING_COST_NOT_FOUND');
    expect(errorOf(await admin.patch(`/api/admin/margin/shipping-costs/${gb.id}`, { costMinor: 1 })).code).toBe('SHIPPING_COST_NOT_FOUND');

    s = await put('/api/admin/margin/unit-costs/VAULT_CARD', { costMinor: 45, currency: 'eur' });
    expect(s.unitCosts.find((u) => u.key === 'VAULT_CARD')).toMatchObject({ costMinor: 45, currency: 'EUR' });
    s = await put('/api/admin/margin/unit-costs/CLAIM_REPAIR', { costMinor: 4500, currency: 'GBP' });
    expect(s.unitCosts.find((u) => u.key === 'CLAIM_REPAIR')).toMatchObject({ costMinor: 4500, currency: 'GBP' });
    const cleared = safeJson(await admin.request('DELETE', '/api/admin/margin/unit-costs/CLAIM_REPAIR')) as MarginSettings;
    expect(cleared.unitCosts.find((u) => u.key === 'CLAIM_REPAIR')).toMatchObject({ costMinor: null, currency: null });
    expect(cleared.unitCosts.find((u) => u.key === 'VAULT_CARD')!.costMinor).toBe(45);

    s = await put(`/api/admin/margin/allowances/${second}`, { percent: 3.5 });
    expect(s.allowances.find((a) => a.code === 'Q')!.allowanceBp).toBe(350);
    s = await put(`/api/admin/margin/allowances/${jewelry}`, { percent: '12.75' });
    expect(s.allowances.find((a) => a.code === 'J')!.allowanceBp).toBe(1275);
    expect((safeJson(await admin.request('DELETE', `/api/admin/margin/allowances/${second}`)) as MarginSettings).allowances.find((a) => a.code === 'Q')!.allowanceBp).toBeNull();

    expect((safeJson(await admin.request('DELETE', '/api/admin/margin/rates/CHF')) as MarginSettings).currenciesWithoutRate).toEqual(['CHF']);
    expect((await h.ctx.audit.list({ action: 'margin.rate' })).items.map((e) => e.details)).toEqual([
      { currency: 'CHF', from: '1.050000', to: null },
      { currency: 'CHF', from: null, to: '1.050000' },
      { currency: 'GBP', from: null, to: '1.200000' },
    ]);
    expect((await h.ctx.audit.list({ action: 'margin.unit_cost' })).items.map((e) => e.details.key)).toEqual(['CLAIM_REPAIR', 'CLAIM_REPAIR', 'VAULT_CARD']);
    expect((await h.ctx.audit.list({ action: 'margin.shipping_cost.delete' })).items).toHaveLength(1);
    expect((await h.ctx.audit.list({ action: 'margin.allowance' })).items).toHaveLength(3);
  });

  it('answers malformed requests 400, EUR 422 MARGIN_RATE_EUR, an unknown category 404 CATEGORY_NOT_FOUND', async () => {
    const eur = await admin.request('PUT', '/api/admin/margin/rates/EUR', { body: { rate: 1 } });
    expect(eur.statusCode).toBe(422);
    expect(errorOf(eur)).toEqual({ code: 'MARGIN_RATE_EUR', message: 'Every margin figure is in euros: the euro is 1 and takes no rate.' });
    expect(errorOf(await admin.request('DELETE', '/api/admin/margin/rates/eur')).code).toBe('MARGIN_RATE_EUR');
    for (const [method, url, body] of [
      ['PUT', '/api/admin/margin/rates/GBPX', { rate: 1 }],
      ['PUT', '/api/admin/margin/rates/GBP', { rate: 0 }],
      ['PUT', '/api/admin/margin/rates/GBP', { rate: '1.1234567' }],
      ['PUT', '/api/admin/margin/rates/GBP', { rate: 1, extra: true }],
      ['PUT', '/api/admin/margin/rates/JPY', { rate: 0.006 }],
      ['POST', '/api/admin/margin/shipping-costs', { country: 'FRA', maxWeightG: 500, costMinor: 1, currency: 'EUR' }],
      ['POST', '/api/admin/margin/shipping-costs', { country: 'XX', maxWeightG: 500, costMinor: 1, currency: 'EUR' }],
      ['POST', '/api/admin/margin/shipping-costs', { country: 'FR', maxWeightG: 0, costMinor: 1, currency: 'EUR' }],
      ['POST', '/api/admin/margin/shipping-costs', { country: 'FR', maxWeightG: 100_001, costMinor: 1, currency: 'EUR' }],
      ['POST', '/api/admin/margin/shipping-costs', { country: 'FR', maxWeightG: 500, costMinor: 100_000_001, currency: 'EUR' }],
      ['POST', '/api/admin/margin/shipping-costs', { maxWeightG: 500, costMinor: 1, currency: 'EUR' }],
      ['PATCH', '/api/admin/margin/shipping-costs/not-a-uuid', { costMinor: 1 }],
      ['PATCH', '/api/admin/margin/shipping-costs/00000000-0000-4000-8000-000000000000', {}],
      ['PUT', '/api/admin/margin/unit-costs/BOX', { costMinor: 1, currency: 'EUR' }],
      ['PUT', '/api/admin/margin/unit-costs/CARD', { costMinor: -1, currency: 'EUR' }],
      ['PUT', '/api/admin/margin/unit-costs/CARD', { costMinor: 1.5, currency: 'EUR' }],
      ['PUT', '/api/admin/margin/unit-costs/CARD', { costMinor: 1 }],
      ['PUT', '/api/admin/margin/allowances/40', { percent: 1 }],
      ['PUT', `/api/admin/margin/allowances/${jewelry}`, { percent: 101 }],
      ['PUT', `/api/admin/margin/allowances/${jewelry}`, { percent: '12.345' }],
    ] as const) {
      const res = await admin.request(method, url, { body });
      expect(res.statusCode, `${method} ${url} ${JSON.stringify(body)} ${res.body}`).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    const unknown = await admin.request('PUT', '/api/admin/margin/allowances/30', { body: { percent: 1 } });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('CATEGORY_NOT_FOUND');
    expect(errorOf(await admin.request('DELETE', '/api/admin/margin/allowances/30')).code).toBe('CATEGORY_NOT_FOUND');
    // Nothing of these refusals was written.
    const s = safeJson(await auditor.get('/api/admin/margin/settings')) as MarginSettings;
    expect(s.rates.map((x) => x.currency)).toEqual(['GBP']);
    expect(s.unitCosts.find((u) => u.key === 'CARD')!.costMinor).toBeNull();
  });
});

describe('the margin\'s report routes (lot M4 plan §1.2, step M4.3)', () => {
  let h: Harness;
  let f: MarginVaultFixture;
  let auditor: Client;
  let operator: Client;
  let admin: Client;
  let agent: Client;
  let seller: Client;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(MARGIN_NOW.toISOString());
    f = await seedMarginVault(h.t.db, (await createAdmin(h.ctx, 'ADMIN')).id);
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    admin = await adminClient(h, 'ADMIN');
    agent = await adminClient(h, 'LOGISTICS');
    seller = await adminClient(h, 'RETAIL');
  }, 60_000);
  afterAll(() => h?.close());

  it('an AUDITOR reads the margin: in euros, by channel with VAULT, THE VAULT\'s line; no account, no email, no vault, no release', async () => {
    const res = await auditor.get('/api/admin/margin');
    expect(res.statusCode, res.body).toBe(200);
    const r = safeJson(res) as MarginReport;
    expect(r.window).toMatchObject({ months: 12, from: '2025-11', to: '2026-10', currency: 'EUR', test: false });
    expect(r.currency).toBe('EUR');
    expect(r.totals).toMatchObject({ orders: 5, revenueMinor: 382_500, marginMinor: 256_386 });
    expect(r.byChannel.map((g) => g.key)).toEqual(['LIVE', 'DRAW', 'SALON', 'VAULT', 'ELSEWHERE']);
    expect(r.vault).toMatchObject({ claimed: { orders: 1, costMinor: 21_540 }, guaranteedPieces: 1, rewardsCost: { costMinor: 49_000, costUnknown: 1 } });
    expect(r.partnerIncome).toEqual([]);
    const emails = (await h.t.db.selectFrom('accounts').select('email').where('id', 'in', Object.values(f.accounts)).execute()).map((a) => a.email);
    for (const e of emails) expect(res.body).not.toContain(e);
    for (const id of [...Object.values(f.accounts), ...Object.values(f.vaults), ...Object.values(f.orders), f.releases.live]) expect(res.body).not.toContain(id);
    expect(res.body).not.toMatch(/release|drop/i);
    // An OPERATOR reads it too; 24 months and the test entrants.
    expect((await operator.get('/api/admin/margin')).statusCode).toBe(200);
    const all = safeJson(await auditor.get('/api/admin/margin?months=24&test=true')) as MarginReport;
    expect(all.window).toMatchObject({ months: 24, from: '2024-11', test: true });
    expect(all.totals.orders).toBe(7);
    expect(all.vault.claimed.orders).toBe(2);
  });

  it('an AUDITOR downloads its CSV: its columns with THE VAULT\'s five parts, named by the Paris day, never stored', async () => {
    const csv = await auditor.get('/api/admin/margin.csv?months=12');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="orbes-margin-2026-10-15.csv"');
    expect(csv.body.split('\r\n')[0]).toBe(
      '"View","Group","Orders","Pieces","Revenue (EUR)","Piece","Inbound","Packaging","Outbound","Allowance","Perks: credits","Perks: free shipping","Perks: welcome gifts","THE VAULT: credits","THE VAULT: credits to give","THE VAULT: add-ons","THE VAULT: products won","THE VAULT: cards","Care and warranty","Margin","Margin %","Orders with estimates"',
    );
    expect(csv.body).toContain('"By channel","VAULT","2","2","915.00"');
    const emails = (await h.t.db.selectFrom('accounts').select('email').where('id', 'in', Object.values(f.accounts)).execute()).map((a) => a.email);
    for (const e of emails) expect(csv.body).not.toContain(e);
    expect(csv.body).not.toMatch(/release|drop/i);
  });

  it('refuses another window or a malformed test 400; LOGISTICS and RETAIL 403; an ADMIN reads', async () => {
    for (const bad of ['/api/admin/margin?months=6', '/api/admin/margin?test=maybe', '/api/admin/margin.csv?months=abc', '/api/admin/margin.csv?months=36']) {
      const res = await auditor.get(bad);
      expect(res.statusCode, bad).toBe(400);
      expect(errorOf(res).code, bad).toBe('VALIDATION_FAILED');
    }
    for (const c of [agent, seller]) {
      for (const url of ['/api/admin/margin', '/api/admin/margin.csv']) {
        const res = await c.get(url);
        expect(res.statusCode, url).toBe(403);
        expect(errorOf(res).code, url).toBe('FORBIDDEN');
      }
    }
    expect((await admin.get('/api/admin/margin.csv')).statusCode).toBe(200);
    expect((await h.client().get('/api/admin/margin')).statusCode).toBe(401);
  });
});
