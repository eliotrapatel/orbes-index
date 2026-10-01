/**
 * The demo dataset (src/server/db/seed/demo.ts), seeded through the real
 * services into an in-memory database on a manual clock.
 *
 * Besides the shape of the data, every demo product's CURRENT code (and every
 * superseded one) is scanned anonymously right after seeding and must return
 * the state the catalogue promises; that is what a demo audience will see.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import {
  DEMO_ACCOUNTS,
  DEMO_CATEGORIES,
  DEMO_FIRST_REGISTRATION_PRODUCT_ID,
  DEMO_MIN_NOW,
  DEMO_TIMELINE_START,
  DemoSeedError,
  demoSeedStatus,
  listDemoProducts,
  seedDemo,
  type DemoSeedResult,
} from '../../src/server/db/seed/demo.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { toCodeRecord } from '../../src/server/services/issuance.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const NOW = new Date('2026-10-01T09:00:00.000Z');
const PASSWORD = 'demo-account-password-2026';

let t: TestDb;
let clock: ManualClock;
let ctx: AppContext;
let result: DemoSeedResult;

beforeAll(async () => {
  t = await createTestDb();
  clock = createManualClock(DEMO_TIMELINE_START);
  ctx = await createContext(testConfig(), {
    db: t.db,
    clock: clock.now,
    keyProvider: new MemoryKeyProvider({ env: 'test' }),
    ensureActiveKey: true,
  });
  result = await seedDemo(ctx, { clock, now: NOW, accountPassword: PASSWORD });
}, 180_000);

afterAll(async () => {
  await ctx?.close();
  await t?.close();
});

/** Current and previous codes of a product, as base64url scanner data. */
async function codesOf(productId: string) {
  const rows = await ctx.db
    .selectFrom('codes as c')
    .innerJoin('products as p', 'p.id', 'c.product_id')
    .selectAll('c')
    .where('p.product_id', '=', productId)
    .orderBy('c.issue')
    .execute();
  return rows.map((r) => toCodeRecord(r, productId));
}

describe('demo seed', () => {
  it('loads the catalogue with the immutable category indices', async () => {
    const cats = await ctx.categories.list();
    expect(cats.map((c) => [c.code, c.index, c.name])).toEqual(DEMO_CATEGORIES.map((c) => [c.code, c.index, c.name]));
    const models = await ctx.db.selectFrom('models').select(['name', 'type', 'default_material']).execute();
    expect(models).toEqual(
      expect.arrayContaining([
        { name: 'MONOLITHE', type: 'RING', default_material: '925 STERLING SILVER' },
        { name: 'ORBITE', type: 'SIGNET RING', default_material: '18K YELLOW GOLD' },
        { name: 'ECLIPSE', type: 'PENDANT', default_material: '925 STERLING SILVER' },
        { name: 'HORIZON', type: 'CUFF', default_material: '925 STERLING SILVER' },
        { name: 'ATLAS', type: 'CARDHOLDER', default_material: 'FULL-GRAIN CALF LEATHER' },
        { name: 'PERIGEE', type: 'WALLET', default_material: 'FULL-GRAIN CALF LEATHER' },
        { name: 'APOGEE', type: 'BELT', default_material: 'FULL-GRAIN CALF LEATHER' },
      ]),
    );
  });

  it('covers the lifecycle with about forty products', async () => {
    expect(result.products).toBe(listDemoProducts().length);
    expect(result.products).toBeGreaterThanOrEqual(38);
    for (const s of ['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED', 'REVOKED', 'STOLEN', 'LOST', 'RETIRED', 'COUNTERFEIT_FLAGGED']) {
      expect(result.productsByStatus[s], s).toBeGreaterThan(0);
    }
    const total = Object.values(result.productsByStatus).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.products);
    expect(await demoSeedStatus(ctx.db)).toBe('SEEDED');
  });

  it('makes O26-J-00184 a 2026 MONOLITHE RING in 925 sterling silver, sold and unregistered', async () => {
    const p = await ctx.db.selectFrom('product_overview').selectAll().where('product_id', '=', DEMO_FIRST_REGISTRATION_PRODUCT_ID).executeTakeFirstOrThrow();
    expect(p).toMatchObject({
      model: 'MONOLITHE',
      model_type: 'RING',
      material: '925 STERLING SILVER',
      category: 'Jewelry',
      status: 'ACTIVATED',
      ownership_state: 'UNREGISTERED',
    });
    expect(p.created_at.getUTCFullYear()).toBe(2026);
    const claim = result.claimCodes.find((c) => c.productId === DEMO_FIRST_REGISTRATION_PRODUCT_ID);
    expect(claim?.registrable).toBe(true);
    expect(claim?.claimCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('creates obviously fake customer accounts only, with no live sessions', async () => {
    const accounts = await ctx.db.selectFrom('accounts').select(['email']).execute();
    expect(accounts).toHaveLength(DEMO_ACCOUNTS.length);
    for (const a of accounts) expect(a.email).toMatch(/@example\.com$/);
    const sessions = await ctx.db.selectFrom('sessions').select('subject_id').execute();
    expect(sessions).toHaveLength(0);
    expect(result.generatedAccountPassword).toBeUndefined();
    // The supplied password works through the real login.
    const login = await ctx.services.auth.login({ email: DEMO_ACCOUNTS[0].email, password: PASSWORD });
    expect(login.account.email).toBe(DEMO_ACCOUNTS[0].email);
  });

  it('records warranties, service records, transfers and scan histories', async () => {
    const services = await ctx.db.selectFrom('service_records').select(['status']).execute();
    expect(services.filter((s) => s.status === 'OPEN').length).toBeGreaterThanOrEqual(2);
    expect(services.filter((s) => s.status === 'COMPLETED').length).toBeGreaterThanOrEqual(2);
    const transfers = await ctx.db.selectFrom('ownership_transfers').select(['status']).execute();
    expect(transfers.filter((x) => x.status === 'ACCEPTED').length).toBeGreaterThanOrEqual(3);
    expect(transfers.filter((x) => x.status === 'PENDING')).toHaveLength(1);
    expect(await ctx.services.warranty.status('O25-F-00009', NOW)).toBe('EXPIRED');
    expect(await ctx.services.warranty.status('O25-L-00008', NOW)).toBe('VOID');
    expect(await ctx.services.warranty.status('O26-W-00003', NOW)).toBe('ACTIVE');
    expect(await ctx.services.warranty.status('O26-J-00186', NOW)).toBe('NOT_STARTED');

    expect(result.scans).toBeGreaterThan(40);
    const recent = await ctx.db
      .selectFrom('scan_events')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('occurred_at', '>=', new Date(NOW.getTime() - 24 * 3_600_000))
      .executeTakeFirstOrThrow();
    expect(Number(recent.n)).toBeGreaterThan(0);
    const future = await ctx.db.selectFrom('scan_events').select('id').where('occurred_at', '>', NOW).execute();
    expect(future).toHaveLength(0);
  });

  it('produces the impossible-travel anomaly from real scoring, left OPEN', async () => {
    const travel = await ctx.services.anomaly.list({ type: 'IMPOSSIBLE_TRAVEL' }, { page: 1, pageSize: 10 });
    expect(travel.items).toHaveLength(1);
    expect(travel.items[0]).toMatchObject({ productId: 'O26-J-00194', status: 'OPEN', severity: 'HIGH' });
    expect(travel.items[0].occurrences).toBeGreaterThanOrEqual(2);

    const stolen = await ctx.services.anomaly.list({ type: 'LOST_STOLEN_SCAN' }, { page: 1, pageSize: 10 });
    expect(stolen.items[0]).toMatchObject({ productId: 'O26-J-00193', status: 'OPEN' });
    const triaged = await ctx.services.anomaly.list({ type: 'POST_REVOCATION_SCAN' }, { page: 1, pageSize: 10 });
    expect(triaged.items[0]).toMatchObject({ productId: 'O26-J-00198', status: 'DISMISSED' });
    expect(result.anomalies.open).toBe(2);

    const states = await ctx.db
      .selectFrom('scan_events as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select(['s.result_state', 's.country'])
      .where('p.product_id', '=', 'O26-J-00194')
      .orderBy('s.occurred_at')
      .execute();
    expect(states.filter((s) => s.result_state === 'SUSPICIOUS_ACTIVITY').map((s) => s.country)).toEqual(['FR', 'US']);
  });

  it('keeps the audit chain intact and attributes back-office work to the demo seed', async () => {
    const chain = await ctx.audit.verifyChain();
    expect(chain.ok).toBe(true);
    const actors = await ctx.db.selectFrom('audit_logs').select(['actor_type', 'actor_id']).where('action', '=', 'product.issue').execute();
    expect(actors.every((a) => a.actor_type === 'system' && a.actor_id === 'demo-seed')).toBe(true);
    // The timeline reads forward: audit time never goes backwards along the chain.
    const times = await ctx.db.selectFrom('audit_logs').select(['occurred_at']).orderBy('id').execute();
    for (let i = 1; i < times.length; i++) expect(times[i].occurred_at.getTime()).toBeGreaterThanOrEqual(times[i - 1].occurred_at.getTime());
  });

  it('every demo code verifies, anonymously and right after seeding, as the catalogue says', async () => {
    clock.set(new Date(NOW.getTime() + 60_000));
    const mismatches: string[] = [];
    for (const info of listDemoProducts()) {
      const codes = await codesOf(info.productId);
      const current = codes[codes.length - 1];
      const outcome = await ctx.services.verification.verify({ code: current.data }, {});
      if (outcome.state !== info.expectedState) mismatches.push(`${info.productId}: ${outcome.state} ≠ ${info.expectedState}`);
      for (const prev of info.previousIssues) {
        const old = codes.find((c) => c.issue === prev.issue)!;
        const r = await ctx.services.verification.verify({ code: old.data }, {});
        if (r.state !== prev.expectedState) mismatches.push(`${info.productId} issue ${prev.issue}: ${r.state} ≠ ${prev.expectedState}`);
      }
    }
    expect(mismatches).toEqual([]);

    const first = await codesOf(DEMO_FIRST_REGISTRATION_PRODUCT_ID);
    const outcome = await ctx.services.verification.verify({ code: first[0].data }, {});
    expect(outcome).toMatchObject({
      state: 'AUTHENTIC_FIRST_REGISTRATION',
      title: expect.stringContaining('FIRST REGISTRATION'),
      product: { productId: 'O26-J-00184', model: 'MONOLITHE', type: 'RING', material: '925 STERLING SILVER', createdYear: 2026 },
      registration: { claimCodeRequired: true },
      warranty: { status: 'ACTIVE' },
      ownership: { registered: false, you: false },
    });
  });

  it('refuses to seed twice, into production, before the timeline, or with a foreign clock', async () => {
    await expect(seedDemo(ctx, { clock, now: NOW })).rejects.toThrow(/already loaded/);
    const prodCtx = { ...ctx, config: { ...ctx.config, env: 'production' as const } };
    await expect(seedDemo(prodCtx, { clock, now: NOW })).rejects.toThrow(/production/);

    const t2 = await createTestDb();
    const c2 = createManualClock(DEMO_TIMELINE_START);
    const ctx2 = await createContext(testConfig(), { db: t2.db, clock: c2.now, keyProvider: new MemoryKeyProvider({ env: 'test' }) });
    try {
      await expect(seedDemo(ctx2, { clock: c2, now: new Date(DEMO_MIN_NOW.getTime() - 1) })).rejects.toBeInstanceOf(DemoSeedError);
      await expect(seedDemo(ctx2, { clock: createManualClock(), now: NOW })).rejects.toThrow(/clock/);
      await expect(seedDemo(ctx2, { clock: c2, now: NOW, accountPassword: 'short' })).rejects.toThrow(/12 characters/);
      // A category holding a demo index under another code blocks the seed before anything is written.
      await ctx2.categories.create({ code: 'Z', name: 'Other', warrantyMonths: 12 }, { type: 'system' });
      await expect(seedDemo(ctx2, { clock: c2, now: NOW, accountPassword: PASSWORD })).rejects.toThrow(/index/);
      expect(await demoSeedStatus(ctx2.db)).toBe('EMPTY');
    } finally {
      await ctx2.close();
      await t2.close();
    }
  });

  it('describes the products without secrets', () => {
    const list = listDemoProducts();
    expect(new Set(list.map((p) => p.productId)).size).toBe(list.length);
    expect(list.find((p) => p.productId === 'O26-J-00198')?.previousIssues).toEqual([{ issue: 1, expectedState: 'REVOKED' }]);
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/"(claimCode|password|token|data)"/);
    expect(json).not.toMatch(/\b[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\b/); // no claim or transfer code values
  });
});
