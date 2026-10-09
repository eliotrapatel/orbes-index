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
  DEMO_PROFILES,
  DEMO_CATEGORIES,
  DEMO_FIRST_REGISTRATION_PRODUCT_ID,
  DEMO_GUARANTEE,
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

  it('gives every model its size type (plan NEXT LOT §3.3), NOCTURNE to give, keeping every size the pieces declared, with capture-ui\'s bare sizes', async () => {
    const rows = await ctx.db
      .selectFrom('models as m')
      .leftJoin('skus as k', 'k.model_id', 'm.id')
      .select(['m.name', 'm.size_type', 'm.size_kind', 'k.code', 'k.set_aside_at'])
      .orderBy('m.name')
      .orderBy('k.code')
      .execute();
    const byModel: Record<string, [string | null, string | null, string[]]> = {};
    for (const r of rows) {
      byModel[r.name] ??= [r.size_type, r.size_kind, []];
      if (r.code !== null) byModel[r.name]![2].push(r.code);
      expect(r.set_aside_at, r.code ?? r.name).toBeNull();
    }
    expect(byModel).toEqual({
      APOGEE: ['ONE_SIZE', null, ['APG-BT', 'APG-BT-85-CM-TAN', 'APG-BT-90-CM-BLACK', 'APG-BT-95-CM-BLACK']],
      ATLAS: ['ONE_SIZE', null, ['ATL-CH', 'ATL-CH-BLACK', 'ATL-CH-TAN']],
      ECLIPSE: ['NECKLACE', 'NECKLACE', ['ECL-PD']],
      EQUINOX: ['ONE_SIZE', null, ['EQX-KR']],
      HORIZON: ['BRACELET', 'BRACELET', ['HRZ-CF']],
      MONOLITHE: ['RING', 'RING', ['MNL-RG-48', 'MNL-RG-50', 'MNL-RG-52', 'MNL-RG-54', 'MNL-RG-SIZE-50', 'MNL-RG-SIZE-52', 'MNL-RG-SIZE-54', 'MNL-RG-SIZE-56']],
      NOCTURNE: [null, null, ['NCT-EDP']],
      ORBITE: ['RING', 'RING', ['ORB-SG-52', 'ORB-SG-54', 'ORB-SG-SIZE-54', 'ORB-SG-SIZE-56', 'ORB-SG-SIZE-58', 'ORB-SG-SIZE-60']],
      PARALLAX: ['ONE_SIZE', null, ['PLX-CL']],
      PERIGEE: ['ONE_SIZE', null, ['PRG-WL', 'PRG-WL-BLACK', 'PRG-WL-COGNAC']],
      SOLSTICE: ['WATCH', 'WRIST', ['SLS-AW', 'SLS-AW-38-MM', 'SLS-AW-39-MM', 'SLS-AW-42-MM']],
    });
    // Audited as the console would, the seed as actor.
    const declared = await ctx.db.selectFrom('audit_logs').select('target_id').where('action', '=', 'model.sizes.declare').execute();
    expect(declared).toHaveLength(10);
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
    // Every warranty started names its point of sale from the register (A-08), never free text.
    const started = await ctx.db.selectFrom('warranties').select(['retailer', 'retailer_id']).where('start_date', 'is not', null).execute();
    expect(started.length).toBeGreaterThan(10);
    expect(started.every((w) => w.retailer_id !== null && w.retailer === null)).toBe(true);
    expect((await ctx.services.retailers.list()).map((r) => r.name)).toContain('ORBES PARIS — SAINT-HONORÉ');
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
    // S-07: stock scanned outside a console session. Lyon, by a stranger: open; the Paris boutique's own check: dismissed.
    const unsold = await ctx.services.anomaly.list({ type: 'UNSOLD_PIECE_SCAN' }, { page: 1, pageSize: 10 });
    expect(unsold.items.map((a) => [a.productId, a.status, a.severity, a.riskScore, a.details.country])).toEqual([
      ['O26-L-00018', 'OPEN', 'MEDIUM', 0, 'FR'],
      ['O26-J-00186', 'DISMISSED', 'MEDIUM', 0, 'FR'],
    ]);
    expect(result.anomalies.open).toBe(3);

    const states = await ctx.db
      .selectFrom('scan_events as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select(['s.result_state', 's.country'])
      .where('p.product_id', '=', 'O26-J-00194')
      .orderBy('s.occurred_at')
      .execute();
    expect(states.filter((s) => s.result_state === 'SUSPICIOUS_ACTIVITY').map((s) => s.country)).toEqual(['FR', 'US']);
  });

  it('opens two cases in the Cases queue: where strangers saw the stolen pendant and the cuff of the impossible travel', async () => {
    const cases = await ctx.services.reports.list({ status: 'OPEN' }, { page: 1, pageSize: 10 });
    expect(cases.total).toBe(2);
    expect(cases.items.map((c) => [c.scan.productId, c.channel, c.scan.state]).sort()).toEqual([
      ['O26-J-00193', 'PRIVATE', 'SUSPICIOUS_ACTIVITY'],
      ['O26-J-00194', 'ONLINE', 'SUSPICIOUS_ACTIVITY'],
    ]);
    // Each leads to the anomaly its scan took part in; the strangers are recorded as the public, never by name.
    for (const c of cases.items) expect(c.anomaly?.status).toBe('OPEN');
    const audited = await ctx.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', 'scan.report').execute();
    expect(audited).toEqual([
      { actor_type: 'system', actor_id: 'public', details: {} },
      { actor_type: 'system', actor_id: 'public', details: {} },
    ]);
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

  it('grants the demo PLATINE collector one guarantee shown to him, for the next release of MONOLITHE (plan NEXT-NINE, IN-01)', async () => {
    const lucas = await ctx.db.selectFrom('accounts').select('id').where('email', '=', 'lucas.weber@example.com').executeTakeFirstOrThrow();
    const rows = await ctx.db.selectFrom('house_guarantees').selectAll().execute();
    expect(rows).toHaveLength(1);
    const g = rows[0]!;
    expect(g).toMatchObject({ account_id: lucas.id, scope: 'MODEL', pieces: DEMO_GUARANTEE.pieces, visible: true, status: 'ACTIVE', covered_drop_id: null, granted_by: null });
    const monolithe = await ctx.db.selectFrom('models').select('id').where('name', '=', 'MONOLITHE').where('variant_of', 'is', null).executeTakeFirstOrThrow();
    expect(g.model_id).toBe(monolithe.id);
    expect(g.valid_until.getTime()).toBeGreaterThan(NOW.getTime() + 89 * 86_400_000);
    // His account sheet shows it, waiting for the next release; he is the demo's PLATINE collector.
    const status = await ctx.services.club.status(lucas.id);
    expect(status.tier.name).toBe('PLATINE');
    expect(status.guarantees).toEqual([expect.objectContaining({ scope: 'MODEL', target: 'MONOLITHE', pieces: 1, release: null })]);
    const audit = await ctx.db.selectFrom('audit_logs').select(['action', 'actor_type']).where('action', '=', 'guarantee.grant').execute();
    expect(audit).toEqual([{ action: 'guarantee.grant', actor_type: 'system' }]);
  });

  it('gives the demo collectors full, partial and empty profiles: a date set by Client Services, Other, a retired finish (plan CUSTOMER INTELLIGENCE §3.1, step 1.11)', async () => {
    const idOf = async (email: string) => (await ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
    const view = async (email: string) => ctx.services.profiles.forCollector(await idOf(email));

    // Full: every item counted (the demo's collection offers no piece or finish), the default address of YOUR ADDRESSES.
    const camille = await view('camille.martin@example.com');
    expect(camille.completion).toEqual({ percent: 100, missing: [] });
    expect(camille.profile).toMatchObject({ firstName: 'Camille', lastName: 'Martin', country: 'FR', city: 'Paris', phone: { country: 'FR', number: '+33639981234' }, birthDate: '1991-04-12', birthDateLocked: true, instagram: 'camille.martin.demo', heard: { label: 'Instagram', other: null } });
    expect(camille.address).toMatchObject({ name: 'Camille Martin', country: 'FR' });
    expect(camille.options).toMatchObject({ pieces: [], finishes: [] });

    // Partial.
    const hugo = await view('hugo.bernard@example.com');
    expect(hugo.completion.percent).toBeGreaterThan(0);
    expect(hugo.completion.percent).toBeLessThan(100);
    expect(hugo.completion.missing).toEqual(['BIRTH_DATE', 'ADDRESS', 'PHONE', 'INSTAGRAM']);

    // Other, with its words.
    const amelia = await view('amelia.clarke@example.com');
    expect(amelia.profile.heard).toMatchObject({ label: 'Other', other: 'A colleague in London' });
    expect(amelia.profile.phone).toEqual({ country: 'GB', number: '+447700900123' });

    // A date of birth set by ORBES Client Services: the collector reads it locked, never having entered one.
    const sofiaId = await idOf('sofia.rossi@example.com');
    const sofia = await ctx.db.selectFrom('account_profiles').selectAll().where('account_id', '=', sofiaId).executeTakeFirstOrThrow();
    expect(sofia).toMatchObject({ birth_date: '1987-09-23', birth_date_by: 'STAFF', birth_date_collector_at: null, updated_by: 'STAFF', version: 2 });
    expect((await ctx.services.profiles.forCollector(sofiaId)).profile).toMatchObject({ birthDate: '1987-09-23', birthDateLocked: true });

    // A favourite finish the collection no longer shows.
    const lucas = await view('lucas.weber@example.com');
    expect(lucas.profile.tastes).toEqual({ pieces: [], finishes: [{ key: 'ROSE GOLD', label: 'Rose gold', retired: true }] });

    // Empty: the accounts made before the lot, left as they are.
    for (const email of ['elena.garcia@example.com', 'kenji.tanaka@example.com', 'noor.haddad@example.com']) {
      const empty = await view(email);
      expect(empty.profile.version).toBe(0);
      expect(empty.profile.firstName).toBeNull();
    }
    expect(await ctx.db.selectFrom('account_profiles').select('account_id').execute()).toHaveLength(DEMO_PROFILES.length);
    // The names follow onto the account; the countries are unchanged.
    const accounts = await ctx.db.selectFrom('accounts').select(['email', 'display_name', 'country']).orderBy('email').execute();
    expect(accounts.map((a) => [a.display_name, a.country])).toEqual(
      DEMO_ACCOUNTS.slice()
        .sort((a, b) => (a.email < b.email ? -1 : 1))
        .map((a) => [a.displayName, a.country]),
    );

    // Audited by field names only: the collectors' saves and Client Services' date, never a value.
    const audits = await ctx.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', 'account.profile.update').orderBy('id').execute();
    expect(audits.map((a) => [a.actor_type, (a.details as { by: string }).by])).toEqual([
      ...DEMO_PROFILES.slice(0, 4).map(() => ['account', 'collector']),
      ['system', 'staff'],
      ['account', 'collector'],
    ]);
    expect(audits[4]).toMatchObject({ actor_id: 'demo-seed', details: { by: 'staff', fields: ['birthDate'], birthDate: 'set' } });
    const json = JSON.stringify(audits);
    for (const typed of ['Camille', 'Paris', '1991-04-12', '1987-09-23', '639981234', 'camille.martin.demo', 'colleague']) expect(json).not.toContain(typed);

    // The console's Sign-up page counts them.
    const given = Object.fromEntries((await ctx.services.profiles.heardOptions({ withCounts: true })).map((o) => [o.label, o.given]));
    expect(given).toMatchObject({ Instagram: 1, 'A friend': 1, Other: 1, 'A shop': 1, 'The press': 1, TikTok: 0 });
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
