/**
 * The margin's settings (macro scope K43 N1 and N2, D61; lot M4 plan §1.2, §1.5, step M4.2; services/margin-settings.ts),
 * on the service as createContext wires it:
 *
 *  - parseRate and percentToBp: every bound, six decimals for a rate, two for a percent;
 *  - the rates: EUR refused (422 MARGIN_RATE_EUR), set, changed, the same again writing nothing, cleared; the currencies
 *    that appear in the data without a rate listed, THE VAULT's credits, credits to give and vaults' costs included;
 *  - the bands: one per country and limit (409 SHIPPING_COST_TAKEN), ALL OTHER COUNTRIES once per limit too, a country
 *    checked, changed field by field (a change onto another band refused), removed, 404 SHIPPING_COST_NOT_FOUND; their
 *    order (by country, ALL OTHER COUNTRIES last, then by limit);
 *  - the unit costs: every key read (null while not set), THE VAULT CARD (VAULT_CARD) among them, set, cleared, an
 *    unknown key refused;
 *  - the allowances: in hundredths of a percent, a percent with three decimals or above 100 refused, 404
 *    CATEGORY_NOT_FOUND;
 *  - the audit: `margin.rate`, `margin.shipping_cost.create`, `.update`, `.delete`, `margin.unit_cost`,
 *    `margin.allowance`, with keys and amounts only; a collector cannot write;
 *  - two first saves of one key at once: the second meets the first's row, is run again and updates it (never a 500).
 * The routes and roles are test/api/admin-margin.test.ts's.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARGIN_UNIT_COST_KEYS } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import type { Db } from '../../src/server/db/connection.js';
import { MarginSettingsService, parseRate, percentToBp } from '../../src/server/services/margin-settings.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';
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

describe('the margin settings: parsing', () => {
  it('parseRate: above 0, at most 100 000, six decimals at most, read back as numeric(14,6)', () => {
    expect(parseRate(1.15)).toBe('1.150000');
    expect(parseRate('0.008512')).toBe('0.008512');
    expect(parseRate(' 100000 ')).toBe('100000.000000');
    expect(parseRate('007.5')).toBe('7.500000');
    for (const bad of [0, '0', '0.000000', -1, 100_000.000001, '1.1234567', 'abc', '1e3', '', null, undefined, Number.NaN, {}]) expect(() => parseRate(bad), String(bad)).toThrow(DomainError);
  });

  it('percentToBp: a percent from 0 to 100 with two decimals at most, in hundredths of a percent', () => {
    expect(percentToBp(0)).toBe(0);
    expect(percentToBp(12.5)).toBe(1250);
    expect(percentToBp('2.25')).toBe(225);
    expect(percentToBp(100)).toBe(10_000);
    for (const bad of [-1, 100.01, '12.345', 'x', null, '']) expect(() => percentToBp(bad), String(bad)).toThrow(DomainError);
  });
});

describe('MarginSettingsService (lot M4 plan §1.2)', () => {
  let h: Harness;
  let admin: Actor;
  let adminId: string;
  const settings = () => h.ctx.services.marginSettings;
  const audit = async (action: string) => (await h.ctx.audit.list({ action })).items;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-23T09:00:00.000Z');
    await seedCatalog(h.ctx);
    adminId = (await createAdmin(h.ctx, 'ADMIN')).id;
    admin = { type: 'admin', id: adminId };
  });
  afterAll(() => h?.close());

  it('reads empty settings: every unit cost and every category, nothing set', async () => {
    const s = await settings().read();
    expect(s.currency).toBe('EUR');
    expect(s.rates).toEqual([]);
    expect(s.shippingCosts).toEqual([]);
    expect(s.unitCosts.map((u) => u.key)).toEqual([...MARGIN_UNIT_COST_KEYS]);
    expect(s.unitCosts.map((u) => u.key).slice(0, 4)).toEqual(['POUCH', 'CARD', 'VAULT_CARD', 'CARE_SERVICE']);
    expect(s.unitCosts.every((u) => u.costMinor === null && u.currency === null && u.updatedAt === null)).toBe(true);
    expect(s.allowances).toEqual([{ categoryId: expect.any(Number), code: 'J', name: 'Jewelry', active: true, allowanceBp: null, updatedAt: null }]);
  });

  it('a rate: EUR refused, set, changed, the same again written once, cleared; audited margin.rate', async () => {
    expect(await refusal(settings().setRate('EUR', 1, admin))).toEqual({ code: 'MARGIN_RATE_EUR', status: 422, message: 'Every margin figure is in euros: the euro is 1 and takes no rate.' });
    expect((await refusal(settings().setRate('eur', 1, admin))).code).toBe('MARGIN_RATE_EUR');
    expect((await refusal(settings().setRate('GBP', 0, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(settings().setRate('GB', 1.2, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(settings().setRate('KWD', 1.2, admin))).code).toBe('VALIDATION_FAILED'); // three decimals: not supported
    let s = await settings().setRate('gbp', '1.15', admin);
    expect(s.rates).toEqual([{ currency: 'GBP', eurRate: '1.150000', updatedAt: expect.any(Date) }]);
    s = await settings().setRate('GBP', 1.16, admin);
    expect(s.rates[0]!.eurRate).toBe('1.160000');
    await settings().setRate('GBP', '1.160000', admin);
    const entries = await audit('margin.rate');
    expect(entries.map((e) => e.details)).toEqual([
      { currency: 'GBP', from: '1.150000', to: '1.160000' },
      { currency: 'GBP', from: null, to: '1.150000' },
    ]);
    expect(entries[0]).toMatchObject({ targetType: 'currency_rate', targetId: 'GBP', actorType: 'admin', actorId: admin.id });
    s = await settings().clearRate('GBP', admin);
    expect(s.rates).toEqual([]);
    await settings().clearRate('GBP', admin);
    expect((await audit('margin.rate')).map((e) => e.details)[0]).toEqual({ currency: 'GBP', from: '1.160000', to: null });
    expect(await audit('margin.rate')).toHaveLength(3);
  });

  it('lists the currencies that appear without a rate (an order\'s, a box\'s, a band\'s), never EUR', async () => {
    await h.t.db.insertInto('boxes').values({ name: 'CHF BOX', inside_length_mm: 100, inside_width_mm: 70, inside_height_mm: 30, empty_weight_g: 90, cost_minor: 300, currency: 'CHF' }).execute();
    await settings().addShippingCost({ country: 'US', maxWeightG: 500, costMinor: 1200, currency: 'usd' }, admin);
    expect((await settings().read()).currenciesWithoutRate).toEqual(['CHF', 'USD']);
    await settings().setRate('USD', 0.92, admin);
    expect((await settings().read()).currenciesWithoutRate).toEqual(['CHF']);
  });

  it('lists THE VAULT\'s currencies without a rate too: a vault\'s value and cost, a credit to give, a VAULT credit (D61)', async () => {
    const db = h.t.db;
    const account = await createAccount(db);
    const friend = await createAccount(db);
    const floor = await db.selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
    const given = new Date('2026-09-01T10:00:00.000Z');
    const vault = await db
      .insertInto('vaults')
      .values({ account_id: account.id, source: 'HOUSE', given_by: adminId, occasion_key: `HOUSE:${randomUUID()}`, occasion_index: 1, given_at: given, waits_until: new Date('2026-10-01T10:00:00.000Z') } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('vaults')
      .set({ opened_at: new Date('2026-10-02T10:00:00.000Z'), reward_id: floor.id, reward_kind: 'CREDIT_TO_GIVE', prize: 'A CREDIT TO GIVE', odds_text: '1 IN 200', rare: false, value_minor: 3000, currency: 'NOK', cost_minor: 3000 } as never)
      .where('id', '=', vault.id)
      .execute();
    await db
      .insertInto('vault_gifts')
      .values({ vault_id: vault.id, code_hash: new Uint8Array(32).fill(7), amount_minor: 3000, currency: 'DKK', created_at: new Date('2026-10-02T10:00:00.000Z'), expires_at: new Date('2026-11-01T10:00:00.000Z') })
      .execute();
    await db
      .insertInto('tier_grants')
      .values({ account_id: friend.id, kind: 'VAULT', vault_id: vault.id, usable_while_no_piece: true, amount_minor: 3000, currency: 'SEK', expires_at: new Date('2026-11-02T10:00:00.000Z') })
      .execute();
    expect((await settings().read()).currenciesWithoutRate).toEqual(['CHF', 'DKK', 'NOK', 'SEK']);
    await settings().setRate('SEK', '0.087', admin);
    expect((await settings().read()).currenciesWithoutRate).toEqual(['CHF', 'DKK', 'NOK']);
    await settings().clearRate('SEK', admin);
  });

  it('a band: once per country and limit, ALL OTHER COUNTRIES once per limit, a country checked; its order', async () => {
    await settings().addShippingCost({ country: 'fr', maxWeightG: 1000, costMinor: 990, currency: 'EUR' }, admin);
    await settings().addShippingCost({ country: 'FR', maxWeightG: 500, costMinor: 690, currency: 'EUR' }, admin);
    await settings().addShippingCost({ country: null, maxWeightG: 1000, costMinor: 1500, currency: 'EUR' }, admin);
    expect(await refusal(settings().addShippingCost({ country: 'FR', maxWeightG: 500, costMinor: 700, currency: 'EUR' }, admin))).toEqual({
      code: 'SHIPPING_COST_TAKEN',
      status: 409,
      message: 'This country already has a band with this weight limit.',
    });
    expect((await refusal(settings().addShippingCost({ country: null, maxWeightG: 1000, costMinor: 1, currency: 'EUR' }, admin))).code).toBe('SHIPPING_COST_TAKEN');
    for (const bad of [
      { country: 'XX', maxWeightG: 500, costMinor: 1, currency: 'EUR' },
      { maxWeightG: 500, costMinor: 1, currency: 'EUR' },
      { country: 'DE', maxWeightG: 0, costMinor: 1, currency: 'EUR' },
      { country: 'DE', maxWeightG: 100_001, costMinor: 1, currency: 'EUR' },
      { country: 'DE', maxWeightG: 500, costMinor: -1, currency: 'EUR' },
      { country: 'DE', maxWeightG: 500, costMinor: 100_000_001, currency: 'EUR' },
      { country: 'DE', maxWeightG: 500, costMinor: 1.5, currency: 'EUR' },
      { country: 'DE', maxWeightG: 500, costMinor: 1, currency: 'EURO' },
    ]) {
      expect((await refusal(settings().addShippingCost(bad as never, admin))).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    const s = await settings().read();
    expect(s.shippingCosts.map((b) => [b.country, b.maxWeightG, b.costMinor, b.currency])).toEqual([
      ['FR', 500, 690, 'EUR'],
      ['FR', 1000, 990, 'EUR'],
      ['US', 500, 1200, 'USD'],
      [null, 1000, 1500, 'EUR'],
    ]);
    const created = (await audit('margin.shipping_cost.create')).find((e) => e.details.country === null)!;
    expect(created.details).toEqual({ country: null, maxWeightG: 1000, costMinor: 1500, currency: 'EUR' });
  });

  it('a band changed field by field, never onto another band; removed; 404 for one unknown', async () => {
    const bands = (await settings().read()).shippingCosts;
    const fr500 = bands.find((b) => b.country === 'FR' && b.maxWeightG === 500)!;
    let s = await settings().updateShippingCost(fr500.id, { costMinor: 720 }, admin);
    expect(s.shippingCosts.find((b) => b.id === fr500.id)).toMatchObject({ country: 'FR', maxWeightG: 500, costMinor: 720 });
    await settings().updateShippingCost(fr500.id, { costMinor: 720, currency: 'EUR' }, admin); // nothing changed
    expect((await audit('margin.shipping_cost.update')).map((e) => e.details)).toEqual([{ costMinor: { from: 690, to: 720 } }]);
    expect((await refusal(settings().updateShippingCost(fr500.id, { maxWeightG: 1000 }, admin))).code).toBe('SHIPPING_COST_TAKEN');
    s = await settings().updateShippingCost(fr500.id, { country: null, maxWeightG: 2000 }, admin);
    expect(s.shippingCosts.find((b) => b.id === fr500.id)).toMatchObject({ country: null, maxWeightG: 2000 });
    expect((await refusal(settings().updateShippingCost(fr500.id, {}, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(settings().updateShippingCost('00000000-0000-4000-8000-000000000000', { costMinor: 1 }, admin))).code).toBe('SHIPPING_COST_NOT_FOUND');
    expect((await refusal(settings().removeShippingCost('nope', admin))).code).toBe('SHIPPING_COST_NOT_FOUND');
    s = await settings().removeShippingCost(fr500.id, admin);
    expect(s.shippingCosts.some((b) => b.id === fr500.id)).toBe(false);
    expect((await audit('margin.shipping_cost.delete'))[0]!.details).toEqual({ country: null, maxWeightG: 2000, costMinor: 720, currency: 'EUR' });
    expect((await refusal(settings().removeShippingCost(fr500.id, admin))).status).toBe(404);
  });

  it('a unit cost set, changed and cleared; an unknown key refused; audited margin.unit_cost', async () => {
    let s = await settings().setUnitCost('POUCH', { costMinor: 300, currency: 'eur' }, admin);
    expect(s.unitCosts.find((u) => u.key === 'POUCH')).toMatchObject({ costMinor: 300, currency: 'EUR' });
    s = await settings().setUnitCost('CLAIM_REPAIR', { costMinor: 4500, currency: 'GBP' }, admin);
    expect(s.unitCosts.find((u) => u.key === 'CLAIM_REPAIR')).toMatchObject({ costMinor: 4500, currency: 'GBP' });
    await settings().setUnitCost('POUCH', { costMinor: 300, currency: 'EUR' }, admin); // nothing changed
    s = await settings().clearUnitCost('POUCH', admin);
    expect(s.unitCosts.find((u) => u.key === 'POUCH')).toMatchObject({ costMinor: null, currency: null });
    s = await settings().setUnitCost('VAULT_CARD', { costMinor: 45, currency: 'EUR' }, admin);
    expect(s.unitCosts.find((u) => u.key === 'VAULT_CARD')).toMatchObject({ costMinor: 45, currency: 'EUR', updatedAt: expect.any(Date) });
    s = await settings().clearUnitCost('VAULT_CARD', admin);
    expect(s.unitCosts.find((u) => u.key === 'VAULT_CARD')).toEqual({ key: 'VAULT_CARD', costMinor: null, currency: null, updatedAt: null });
    expect((await refusal(settings().setUnitCost('BOX', { costMinor: 1, currency: 'EUR' }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(settings().setUnitCost('CARD', { costMinor: 1 }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await audit('margin.unit_cost')).map((e) => e.details)).toEqual([
      { key: 'VAULT_CARD', from: { costMinor: 45, currency: 'EUR' }, to: null },
      { key: 'VAULT_CARD', from: null, to: { costMinor: 45, currency: 'EUR' } },
      { key: 'POUCH', from: { costMinor: 300, currency: 'EUR' }, to: null },
      { key: 'CLAIM_REPAIR', from: null, to: { costMinor: 4500, currency: 'GBP' } },
      { key: 'POUCH', from: null, to: { costMinor: 300, currency: 'EUR' } },
    ]);
  });

  it('an allowance in hundredths of a percent; three decimals or above 100 refused; 404 for a category unknown', async () => {
    const id = (await settings().read()).allowances[0]!.categoryId;
    let s = await settings().setAllowance(id, 2.5, admin);
    expect(s.allowances[0]).toMatchObject({ code: 'J', allowanceBp: 250 });
    s = await settings().setAllowance(id, '12.75', admin);
    expect(s.allowances[0]!.allowanceBp).toBe(1275);
    expect((await refusal(settings().setAllowance(id, 12.755, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(settings().setAllowance(id, 101, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(settings().setAllowance(30, 1, admin))).code).toBe('CATEGORY_NOT_FOUND');
    expect((await refusal(settings().clearAllowance(0, admin))).code).toBe('CATEGORY_NOT_FOUND');
    s = await settings().clearAllowance(id, admin);
    expect(s.allowances[0]!.allowanceBp).toBeNull();
    expect((await audit('margin.allowance')).map((e) => e.details)).toEqual([
      { category: 'J', fromBp: 1275, toBp: null },
      { category: 'J', fromBp: 250, toBp: 1275 },
      { category: 'J', fromBp: null, toBp: 250 },
    ]);
  });

  it('a collector never writes the settings', async () => {
    const collector: Actor = { type: 'account', id: '00000000-0000-4000-8000-000000000001' };
    expect((await refusal(settings().setRate('GBP', 1.2, collector))).code).toBe('FORBIDDEN');
    expect((await refusal(settings().setAllowance(1, 1, collector))).code).toBe('FORBIDDEN');
  });

  it('two first saves of one key at once: the second meets the first\'s row, is run again and updates it, audited from it', async () => {
    // The interleaving of two ADMIN tabs: the first tab's CARD is saved just after this save read it absent. A Kysely
    // plugin answers this save's first read of margin_unit_costs with no row, as it read before the first tab's commit.
    await h.t.db.insertInto('margin_unit_costs').values({ key: 'CARD', cost_minor: 200, currency: 'EUR' }).execute();
    let stale = true;
    const stalled = new Set<unknown>();
    const db: Db = h.t.db.withPlugin({
      transformQuery: ({ queryId, node }) => {
        if (stale && node.kind === 'SelectQueryNode' && JSON.stringify(node).includes('"margin_unit_costs"')) {
          stale = false;
          stalled.add(queryId);
        }
        return node;
      },
      transformResult: async ({ queryId, result }) => (stalled.has(queryId) ? { ...result, rows: [] } : result),
    });
    const service = new MarginSettingsService({ db, audit: h.ctx.audit, clock: h.clock.now });
    const s = await service.setUnitCost('CARD', { costMinor: 250, currency: 'EUR' }, admin);
    expect(stalled.size).toBe(1);
    expect(s.unitCosts.find((u) => u.key === 'CARD')).toMatchObject({ costMinor: 250, currency: 'EUR' });
    expect((await audit('margin.unit_cost'))[0]!.details).toEqual({ key: 'CARD', from: { costMinor: 200, currency: 'EUR' }, to: { costMinor: 250, currency: 'EUR' } });
  });
});
