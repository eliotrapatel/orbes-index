/**
 * ORDER A MODEL's split by size and location (macro scope of 2026-10-20, K11 Z1; plan MACRO M3 §3.4, step M3.6;
 * services/size-split.ts), and the countries each location serves (services/stock.ts, migration 0055), on the services
 * as createContext wires them, over rows written as the services leave them, every figure counted by hand.
 *
 * The world of the split (FRANCE WAREHOUSE the default; LOGISTICS WAREHOUSE serves GB and US):
 *   ORBIT   a ring, sizes 50, 52, 54 offered and 56 set aside. Its orders: FRANCE 52 ×2, 54 ×1, and an exchange 52 → 54
 *           (the EXCHANGE order in 54, its original RETURNED); LOGISTICS 50 ×1. Out: a 50 CANCELLED, a 54 RETURNED, a 56
 *           (set aside), a HALO 52 (another model).
 *   HALO    another ring (SILVER), with GOLD, a variant without a kind of its own (it reads HALO's); CHAIN, a necklace.
 *   Saved ring sizes of the collectors who wish for or own a ring:
 *     C1  wishes ORBIT, 52, profile FR                                 → FRANCE 52
 *     C2  wishes HALO (another ring), 54, profile GB                    → LOGISTICS 54
 *     C3  owns a HALO, 50, default address US, profile FR               → LOGISTICS 50 (the address first)
 *     C4  wishes ORBIT and HALO and owns a HALO, 52, default address FR → FRANCE 52, once
 *     C9  wishes ORBIT, 60, no country                                  → matches no size: unmatched
 *     C12 wishes ORBIT, 50, profile IT (served by none), a GB address that is not the default → FRANCE 50
 *     C13 a test entrant, wishes ORBIT, 54, profile US                  → LOGISTICS 54
 *     C14 wishes HALO GOLD (the variant reads HALO's kind), 54, profile FR → FRANCE 54
 *   Never counted: C5 wishes CHAIN only (54), C6 owns a CHAIN only (52), C7 a wish of ORBIT removed (50), C8 a HALO no
 *   longer held (50), C10 wishes ORBIT without a ring size saved (a necklace size only), C11 DELETED (52).
 *
 *   Weights (orders + saved sizes): 50 FRANCE 0+1, 50 LOGISTICS 1+1, 52 FRANCE 2+2, 52 LOGISTICS 0, 54 FRANCE 2+1,
 *   54 LOGISTICS 0+2: 12 in all. 20 pieces: whole parts 1, 3, 6, 0, 5, 3 (18); the two left to the remainders of 8/12,
 *   52 FRANCE first (the larger weight), then 50 FRANCE: 2, 3, 7, 0, 5, 3.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SizeKind } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { largestRemainder } from '../../src/server/services/size-split.js';
import { cleanLocationCountries, locationForCountry } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { GrowthWorld } from '../support/growth.js';

const NOW = '2026-10-22T09:00:00.000Z';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

/** A split's lines as [size, location, orders, saved sizes, proposed]. */
const rows = (p: { lines: { sku: { sizeLabel: string | null }; location: { name: string }; orders: number; savedSizes: number; proposed: number }[] }) =>
  p.lines.map((l) => [l.sku.sizeLabel, l.location.name, l.orders, l.savedSizes, l.proposed]);

/** The world's rows, written as the services leave them. */
class SplitWorld {
  readonly g: GrowthWorld;
  france = '';
  logistics = '';

  constructor(readonly h: Harness) {
    this.g = new GrowthWorld(h.t.db);
  }

  async prepare(): Promise<this> {
    await this.g.prepare();
    const locations = await this.h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    this.france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    this.logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    return this;
  }

  /**
   * A model of the size type `kind` (its kind the same; ONE_SIZE: none; null: no type) with `labels` declared (null: ONE
   * SIZE), each its own SKU; a variant has no type of its own. Returns its id and its SKUs by label.
   */
  async model(name: string, kind: Exclude<SizeKind, 'WRIST'> | 'ONE_SIZE' | null, labels: readonly (string | null)[], o: { variantOf?: string; label?: string } = {}): Promise<{ id: string; sku: Record<string, string> }> {
    const prefix = `SPL-${randomUUID().slice(0, 8)}`;
    const variant = o.variantOf !== undefined;
    const id = (
      await this.h.t.db
        .insertInto('models')
        .values({
          category_id: 1,
          name,
          type: 'RING',
          sku_prefix: prefix,
          size_type: variant ? null : kind,
          size_kind: variant || kind === 'ONE_SIZE' ? null : kind,
          variant_of: o.variantOf ?? null,
          variant_label: o.label ?? null,
          variant_swatch: o.label ? '#C0C0C0' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const sku: Record<string, string> = {};
    for (const l of labels) {
      sku[l ?? 'ONE SIZE'] = (await this.h.t.db.insertInto('skus').values({ model_id: id, size_label: l, code: `${prefix}-${l ?? 'OS'}` }).returning('id').executeTakeFirstOrThrow()).id;
    }
    return { id, sku };
  }

  /** An order of the size at a location: PAID, or CANCELLED or RETURNED. */
  async order(m: { id: string; sku: Record<string, string> }, size: string, locationId: string, status: 'PAID' | 'CANCELLED' | 'RETURNED' = 'PAID'): Promise<string> {
    const accountId = await this.g.account('2025-06-01', 'FR');
    const id = await this.g.order({ accountId, modelId: m.id, channel: 'SALON', paid: '2026-03-01', total: 100_000, currency: 'EUR', status, ...(status !== 'PAID' ? { ended: '2026-04-01' } : {}) });
    await this.h.t.db.updateTable('orders').set({ sku_id: m.sku[size]!, size_label: size === 'ONE SIZE' ? null : size, location_id: locationId }).where('id', '=', id).execute();
    return id;
  }

  /** A size exchange decided: the original RETURNED, the EXCHANGE order in its new size at the same location. */
  async exchange(m: { id: string; sku: Record<string, string> }, from: string, to: string, locationId: string): Promise<void> {
    const original = await this.order(m, from, locationId, 'RETURNED');
    const o = await this.h.t.db.selectFrom('orders').select(['account_id', 'paid_at']).where('id', '=', original).executeTakeFirstOrThrow();
    await this.h.t.db
      .insertInto('orders')
      .values({
        channel: 'EXCHANGE',
        exchange_of_order_id: original,
        account_id: o.account_id,
        model_id: m.id,
        sku_id: m.sku[to]!,
        size_label: to,
        price_minor: 100_000,
        currency: 'EUR',
        status: 'PAID',
        reserved_at: new Date('2026-04-02T10:00:00.000Z'),
        paid_at: new Date('2026-04-02T10:00:00.000Z'),
        location_id: locationId,
      })
      .execute();
  }

  /** A collector: profile country, saved sizes, the default address's country (and another address), wishes, pieces held. */
  async collector(c: {
    country?: string | null;
    sizes?: Partial<Record<SizeKind, number>>;
    address?: string;
    otherAddress?: string;
    wishes?: string[];
    removedWishes?: string[];
    owns?: string[];
    owned?: string[];
    status?: 'ACTIVE' | 'DELETED';
    test?: boolean;
  }): Promise<string> {
    const db = this.h.t.db;
    const id = await this.g.account('2025-06-01', c.country ?? null, c.status ?? 'ACTIVE');
    for (const [kind, value] of Object.entries(c.sizes ?? {})) await db.insertInto('account_sizes').values({ account_id: id, kind: kind as SizeKind, value_mm: value }).execute();
    if (c.address) await db.insertInto('account_addresses').values({ account_id: id, name: 'Home', address: '1 Main Street', country: c.address, phone: '+33 6 00 00 00 00', is_default: true }).execute();
    if (c.otherAddress) await db.insertInto('account_addresses').values({ account_id: id, name: 'Office', address: '2 High Street', country: c.otherAddress, phone: '+44 20 0000 0000', is_default: false }).execute();
    for (const m of c.wishes ?? []) await db.insertInto('account_wishes').values({ account_id: id, model_id: m }).execute();
    for (const m of c.removedWishes ?? []) await db.insertInto('account_wishes').values({ account_id: id, model_id: m, added_at: new Date('2026-04-01T10:00:00.000Z'), removed_at: new Date('2026-05-01T10:00:00.000Z') }).execute();
    for (const m of c.owns ?? []) await this.g.own(id, await this.g.piece(m), 'FIRST_REGISTRATION', '2026-01-10');
    for (const m of c.owned ?? []) await this.g.own(id, await this.g.piece(m), 'FIRST_REGISTRATION', '2026-01-10', '2026-02-10');
    if (c.test) await db.insertInto('test_entrants').values({ account_id: id }).execute();
    return id;
  }
}

describe('the largest remainder (plan MACRO M3 §3.1)', () => {
  it('shares in proportion, the pieces left to the largest remainders, ties to the larger weight, then the earlier line; a weight of 0 gets 0', () => {
    expect(largestRemainder(20, [1, 2, 4, 0, 3, 2])).toEqual([2, 3, 7, 0, 5, 3]);
    expect(largestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(1, [0, 0, 5])).toEqual([0, 0, 1]);
    expect(largestRemainder(3, [1, 3])).toEqual([1, 2]);
    expect(largestRemainder(7, [0, 0])).toEqual([0, 0]);
    expect(largestRemainder(7, [])).toEqual([]);
    expect(largestRemainder(10_000, [3, 3, 3]).reduce((n, x) => n + x, 0)).toBe(10_000);
  });
});

describe('ORDER A MODEL: the split by size and location (plan MACRO M3 §3.2, Z1)', () => {
  let h: Harness;
  let w: SplitWorld;
  let admin: Actor;
  let orbit: { id: string; sku: Record<string, string> };
  let halo: { id: string; sku: Record<string, string> };
  let gold: { id: string; sku: Record<string, string> };
  let chain: { id: string; sku: Record<string, string> };
  const accounts: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    w = await new SplitWorld(h).prepare();
    await h.ctx.services.stock.setLocationCountries(w.logistics, ['gb', 'US'], admin);

    orbit = await w.model('ORBIT', 'RING', ['50', '52', '54', '56']);
    halo = await w.model('HALO', 'RING', ['52'], { label: 'SILVER' });
    gold = await w.model('HALO', null, ['52'], { variantOf: halo.id, label: 'GOLD' });
    chain = await w.model('CHAIN', 'NECKLACE', ['45 CM', '50 CM']);

    // ORBIT's orders.
    await w.order(orbit, '52', w.france);
    await w.order(orbit, '52', w.france);
    await w.order(orbit, '54', w.france);
    await w.exchange(orbit, '52', '54', w.france);
    await w.order(orbit, '50', w.logistics);
    await w.order(orbit, '50', w.france, 'CANCELLED');
    await w.order(orbit, '54', w.france, 'RETURNED');
    await w.order(orbit, '56', w.france);
    await w.order(halo, '52', w.france);
    await h.t.db.updateTable('skus').set({ set_aside_at: h.clock.now(), set_aside_by: admin.id! }).where('id', '=', orbit.sku['56']!).execute();

    // The collectors.
    accounts.push(
      await w.collector({ country: 'FR', sizes: { RING: 52 }, wishes: [orbit.id] }), // C1
      await w.collector({ country: 'GB', sizes: { RING: 54 }, wishes: [halo.id] }), // C2
      await w.collector({ country: 'FR', sizes: { RING: 50 }, address: 'US', owns: [halo.id] }), // C3
      await w.collector({ country: 'GB', sizes: { RING: 52 }, address: 'FR', wishes: [orbit.id, halo.id], owns: [halo.id] }), // C4
      await w.collector({ country: 'FR', sizes: { RING: 54 }, wishes: [chain.id] }), // C5
      await w.collector({ country: 'FR', sizes: { RING: 52 }, owns: [chain.id] }), // C6
      await w.collector({ country: 'FR', sizes: { RING: 50 }, removedWishes: [orbit.id] }), // C7
      await w.collector({ country: 'FR', sizes: { RING: 50 }, owned: [halo.id] }), // C8
      await w.collector({ country: null, sizes: { RING: 60 }, wishes: [orbit.id] }), // C9
      await w.collector({ country: 'FR', sizes: { NECKLACE: 450 }, wishes: [orbit.id] }), // C10
      await w.collector({ country: 'FR', sizes: { RING: 52 }, wishes: [orbit.id], status: 'DELETED' }), // C11
      await w.collector({ country: 'IT', sizes: { RING: 50 }, otherAddress: 'GB', wishes: [orbit.id] }), // C12
      await w.collector({ country: 'US', sizes: { RING: 54 }, wishes: [orbit.id], test: true }), // C13
      await w.collector({ country: 'FR', sizes: { RING: 54 }, wishes: [gold.id] }), // C14
    );
  });
  afterAll(() => h?.close());

  const split = (input: { modelId: string; quantity: number; locationIds?: string[] }) => h.ctx.services.sizeSplit.splitProposal(input);

  it('weighs each offered size at each location by its orders net of size exchanges and the saved sizes of those who wish for or own a ring, each once, shared by the largest remainder', async () => {
    const p = await split({ modelId: orbit.id, quantity: 20 });
    expect(p).toMatchObject({
      model: { id: orbit.id, name: 'ORBIT', variant: null },
      sizeKind: 'RING',
      quantity: 20,
      locations: [
        { id: w.france, name: 'FRANCE WAREHOUSE', isDefault: true },
        { id: w.logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false },
      ],
      totals: { orders: 5, savedSizes: 7, proposed: 20 },
      unmatched: 1,
      source: 'DATA',
    });
    expect(rows(p)).toEqual([
      ['50', 'FRANCE WAREHOUSE', 0, 1, 2],
      ['50', 'LOGISTICS WAREHOUSE', 1, 1, 3],
      ['52', 'FRANCE WAREHOUSE', 2, 2, 7],
      ['52', 'LOGISTICS WAREHOUSE', 0, 0, 0],
      ['54', 'FRANCE WAREHOUSE', 2, 1, 5],
      ['54', 'LOGISTICS WAREHOUSE', 0, 2, 3],
    ]);
    // 56, set aside, is never proposed; each line names its SKU.
    expect(p.lines.map((l) => l.sku.id)).not.toContain(orbit.sku['56']);
    expect(p.lines[0]!.sku).toEqual({ id: orbit.sku['50'], code: expect.stringMatching(/-50$/), sizeLabel: '50' });
    // Counts only: no account is named anywhere in the answer.
    const json = JSON.stringify(p);
    for (const a of accounts) expect(json).not.toContain(a);
  });

  it('a wisher of another model of the same kind counts; a wisher of another kind does not', async () => {
    const bangle = await w.model('BANGLE', 'BRACELET', ['16 CM', '17 CM', '18 CM']);
    const cuff = await w.model('CUFF', 'BRACELET', ['17 CM']);
    const ring = await w.model('SIGNET', 'RING', ['52']);
    const before = await split({ modelId: bangle.id, quantity: 3 });
    expect(before.source).toBe('EVEN');
    const other = await w.collector({ country: 'FR', sizes: { BRACELET: 170 }, wishes: [cuff.id] });
    // A ring wished for, with a bracelet size saved: it would read as 16 CM if it counted.
    const ringWisher = await w.collector({ country: 'FR', sizes: { BRACELET: 160 }, wishes: [ring.id] });
    const p = await split({ modelId: bangle.id, quantity: 3 });
    expect(p).toMatchObject({ sizeKind: 'BRACELET', totals: { orders: 0, savedSizes: 1, proposed: 3 }, unmatched: 0, source: 'DATA' });
    expect(rows(p)).toEqual([
      ['16 CM', 'FRANCE WAREHOUSE', 0, 0, 0],
      ['16 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
      ['17 CM', 'FRANCE WAREHOUSE', 0, 1, 3],
      ['17 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
      ['18 CM', 'FRANCE WAREHOUSE', 0, 0, 0],
      ['18 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
    ]);
    expect(JSON.stringify(p)).not.toMatch(new RegExp(`${other}|${ringWisher}`));
  });

  it('a variant reads its main model\'s kind; a size kind matched to its own sizes only, the rest counted apart', async () => {
    const p = await split({ modelId: gold.id, quantity: 4 });
    expect(p).toMatchObject({ model: { id: gold.id, name: 'HALO', variant: 'GOLD' }, sizeKind: 'RING', unmatched: 6, source: 'DATA' });
    // Its own orders: none; ring collectors counted: C1, C2, C3, C4, C9, C12, C13, C14; at 52: C1 and C4 (FRANCE).
    expect(rows(p)).toEqual([
      ['52', 'FRANCE WAREHOUSE', 0, 2, 4],
      ['52', 'LOGISTICS WAREHOUSE', 0, 0, 0],
    ]);
  });

  it('a size\'s fit range matches first: a saved size inside it counts there', async () => {
    const fitted = await w.model('FITTED', 'RING', ['S', 'M']);
    await h.t.db.updateTable('skus').set({ fit_min_mm: 48, fit_max_mm: 51 }).where('id', '=', fitted.sku['S']!).execute();
    await h.t.db.updateTable('skus').set({ fit_min_mm: 52, fit_max_mm: 56 }).where('id', '=', fitted.sku['M']!).execute();
    const p = await split({ modelId: fitted.id, quantity: 9 });
    // Ring collectors: 50 (C3 LOGISTICS, C12 FRANCE), 52 (C1, C4 FRANCE), 54 (C2, C13 LOGISTICS; C14 FRANCE), 60 (C9) apart.
    // By compareSizes, as everywhere else: M, then S.
    expect(rows(p)).toEqual([
      ['M', 'FRANCE WAREHOUSE', 0, 3, 4],
      ['M', 'LOGISTICS WAREHOUSE', 0, 2, 3],
      ['S', 'FRANCE WAREHOUSE', 0, 1, 1],
      ['S', 'LOGISTICS WAREHOUSE', 0, 1, 1],
    ]);
    expect(p.unmatched).toBe(1);
  });

  it('considers only the locations chosen: their orders and collectors, the rest left out', async () => {
    const p = await split({ modelId: orbit.id, quantity: 6, locationIds: [w.logistics] });
    expect(p.locations).toEqual([{ id: w.logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false }]);
    // LOGISTICS: 50 1 order + C3; 54 C2 + C13. Weights 2, 0, 2: 3, 0, 3. C9 (unmatched) counts at FRANCE: left out.
    expect(rows(p)).toEqual([
      ['50', 'LOGISTICS WAREHOUSE', 1, 1, 3],
      ['52', 'LOGISTICS WAREHOUSE', 0, 0, 0],
      ['54', 'LOGISTICS WAREHOUSE', 0, 2, 3],
    ]);
    expect(p.unmatched).toBe(0);
  });

  it('splits evenly over the offered sizes at the default location when there is no data, and says so; the first location chosen when the default is not', async () => {
    const plain = await w.model('PLAIN', 'NECKLACE', ['45 CM', '50 CM', '55 CM']);
    // CHAIN's owner C6 and wisher C5 saved ring sizes only: PLAIN reads no saved size.
    const p = await split({ modelId: plain.id, quantity: 10 });
    expect(p).toMatchObject({ source: 'EVEN', totals: { orders: 0, savedSizes: 0, proposed: 10 }, unmatched: 0 });
    expect(rows(p)).toEqual([
      ['45 CM', 'FRANCE WAREHOUSE', 0, 0, 4],
      ['45 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
      ['50 CM', 'FRANCE WAREHOUSE', 0, 0, 3],
      ['50 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
      ['55 CM', 'FRANCE WAREHOUSE', 0, 0, 3],
      ['55 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
    ]);
    const there = await split({ modelId: plain.id, quantity: 2, locationIds: [w.logistics] });
    expect(rows(there)).toEqual([
      ['45 CM', 'LOGISTICS WAREHOUSE', 0, 0, 1],
      ['50 CM', 'LOGISTICS WAREHOUSE', 0, 0, 1],
      ['55 CM', 'LOGISTICS WAREHOUSE', 0, 0, 0],
    ]);
  });

  it('a model of one size: its orders only, no saved size read', async () => {
    const single = await w.model('MEDAL', 'ONE_SIZE', [null]);
    await w.order(single, 'ONE SIZE', w.logistics);
    await w.collector({ country: 'FR', sizes: { RING: 52 }, wishes: [single.id] });
    const p = await split({ modelId: single.id, quantity: 5 });
    expect(p).toMatchObject({ sizeKind: null, unmatched: 0, source: 'DATA', totals: { orders: 1, savedSizes: 0, proposed: 5 } });
    expect(rows(p)).toEqual([
      [null, 'FRANCE WAREHOUSE', 0, 0, 0],
      [null, 'LOGISTICS WAREHOUSE', 1, 0, 5],
    ]);
  });

  it('refuses a model without an offered size (409 MODEL_NO_SIZES), an unknown model or location (404), and a number of pieces out of 1 to 10 000', async () => {
    const bare = await w.model('BARE', 'RING', ['52']);
    await h.t.db.updateTable('skus').set({ set_aside_at: h.clock.now(), set_aside_by: admin.id! }).where('id', '=', bare.sku['52']!).execute();
    expect(await refusal(split({ modelId: bare.id, quantity: 1 }))).toEqual({ code: 'MODEL_NO_SIZES', status: 409, message: 'This model has no offered size: declare its sizes in the Catalogue.' });
    const none = await w.model('NONE', 'RING', []);
    expect((await refusal(split({ modelId: none.id, quantity: 1 }))).code).toBe('MODEL_NO_SIZES');
    expect((await refusal(split({ modelId: randomUUID(), quantity: 1 }))).code).toBe('MODEL_NOT_FOUND');
    expect((await refusal(split({ modelId: 'not-a-model', quantity: 1 }))).code).toBe('MODEL_NOT_FOUND');
    expect((await refusal(split({ modelId: orbit.id, quantity: 1, locationIds: [randomUUID()] }))).code).toBe('STOCK_LOCATION_NOT_FOUND');
    for (const quantity of [0, 10_001, 1.5]) expect((await refusal(split({ modelId: orbit.id, quantity }))).code, String(quantity)).toBe('VALIDATION_FAILED');
    expect((await refusal(split({ modelId: orbit.id, quantity: 1, locationIds: [] }))).code).toBe('VALIDATION_FAILED');
    expect((await split({ modelId: orbit.id, quantity: 10_000 })).totals.proposed).toBe(10_000);
  });
});

describe('the countries each location serves (plan MACRO M3 §3.2, Z1)', () => {
  let h: Harness;
  let admin: Actor;
  let france: string;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
  });
  afterAll(() => h?.close());

  const stock = () => h.ctx.services.stock;
  const audits = (id: string) => h.t.db.selectFrom('audit_logs').select(['action', 'details', 'actor_id']).where('target_id', '=', id).where('action', '=', 'stock.location.countries').orderBy('id').execute();

  it('reads the codes of the countries: any case, each once, alphabetical; refuses anything else', () => {
    expect(cleanLocationCountries([' gb', 'FR', 'fr'])).toEqual(['FR', 'GB']);
    expect(cleanLocationCountries([])).toEqual([]);
    for (const bad of [['XX'], ['France'], [''], [7], 'FR', null]) expect(() => cleanLocationCountries(bad)).toThrow(DomainError);
  });

  it('serves each country from one location at most: a country moved says where from; the default location for the rest; audited', async () => {
    expect(await stock().locationForCountry('DE')).toBe(france);
    const first = await stock().setLocationCountries(logistics, ['de', 'GB', 'US'], admin);
    expect(first).toEqual({ location: expect.objectContaining({ id: logistics, name: 'LOGISTICS WAREHOUSE', countries: ['DE', 'GB', 'US'] }), moved: [] });
    const paris = await stock().createLocation({ name: 'PARIS STUDIO' }, admin);
    expect(paris.countries).toEqual([]);
    const second = await stock().setLocationCountries(paris.id, ['IT', 'DE', 'us'], admin);
    expect(second).toEqual({
      location: expect.objectContaining({ id: paris.id, countries: ['DE', 'IT', 'US'] }),
      moved: [
        { country: 'DE', from: { id: logistics, name: 'LOGISTICS WAREHOUSE' } },
        { country: 'US', from: { id: logistics, name: 'LOGISTICS WAREHOUSE' } },
      ],
    });
    // Every location read with its countries, one location per country.
    expect((await stock().locations()).map((l) => [l.name, l.countries])).toEqual([
      ['FRANCE WAREHOUSE', []],
      ['LOGISTICS WAREHOUSE', ['GB']],
      ['PARIS STUDIO', ['DE', 'IT', 'US']],
    ]);
    expect(await h.t.db.selectFrom('stock_location_countries').select(['country', 'location_id', 'updated_by']).orderBy('country').execute()).toEqual([
      { country: 'DE', location_id: paris.id, updated_by: admin.id },
      { country: 'GB', location_id: logistics, updated_by: admin.id },
      { country: 'IT', location_id: paris.id, updated_by: admin.id },
      { country: 'US', location_id: paris.id, updated_by: admin.id },
    ]);
    expect(await locationForCountry(h.ctx.db, 'de')).toBe(paris.id);
    expect(await stock().locationForCountry('GB')).toBe(logistics);
    expect(await stock().locationForCountry('ES')).toBe(france);
    expect(await stock().locationForCountry(null)).toBe(france);
    expect(await stock().locationForCountry('ZZ')).toBe(france);

    // The same list again changes nothing and is not audited; a country left out stops being served.
    await stock().setLocationCountries(paris.id, ['DE', 'IT', 'US'], admin);
    const cleared = await stock().setLocationCountries(paris.id, ['IT'], admin);
    expect(cleared).toEqual({ location: expect.objectContaining({ countries: ['IT'] }), moved: [] });
    expect(await stock().locationForCountry('DE')).toBe(france);
    expect((await audits(paris.id)).map((a) => [a.details, a.actor_id])).toEqual([
      [{ added: ['IT'], removed: [], moved: [{ country: 'DE', from: logistics }, { country: 'US', from: logistics }] }, admin.id],
      [{ added: [], removed: ['DE', 'US'], moved: [] }, admin.id],
    ]);
    expect((await audits(logistics)).map((a) => a.details)).toEqual([{ added: ['DE', 'GB', 'US'], removed: [], moved: [] }]);
    // A rename keeps its countries in the answer.
    expect((await stock().updateLocation(paris.id, { name: 'PARIS ROOM' }, admin)).countries).toEqual(['IT']);
    expect((await refusal(stock().setLocationCountries(randomUUID(), ['FR'], admin))).code).toBe('STOCK_LOCATION_NOT_FOUND');
    expect((await refusal(stock().setLocationCountries(paris.id, ['XX'], admin))).code).toBe('VALIDATION_FAILED');
  });
});
