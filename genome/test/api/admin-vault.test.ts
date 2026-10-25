/**
 * THE VAULT in the console over HTTP (lot Q3, step Q3.9; plan §2.9, §4; vault/SCOPE.md E12; routes/admin/vault.ts,
 * the LIVE switch of routes/admin/live.ts and VAULT ONLY of routes/admin/catalog.ts; services/vault.ts holds the rules,
 * test/services/vault*.test.ts prove them):
 *
 *  - the roles: an AUDITOR reads the settings, the report and a client's vaults; an OPERATOR edits the table, gives a
 *    vault to one collector, switches a LIVE release's vault and a model's VAULT ONLY; an ADMIN sets the sources and
 *    gives to a segment; RETAIL and LOGISTICS read nothing;
 *  - the table's refusals in the console's words: a SERVICE add-on as a reward (409 VAULT_REWARD_SERVICE, as an ADDON
 *    and as a PRODUCT), the odds above one in one, the floor, an unknown row; strict bodies;
 *  - GIVE A VAULT: `dryRun` the reach alone, nothing given; the note never audited nor an email;
 *  - the report for a period of Paris days (422 PERIOD_INVALID);
 *  - a client's vaults read-only, no client email in any reply (the AUDITOR's masking holds nothing to mask), and no
 *    revoke route (N36): POST /api/admin/vault/vaults/:id/revoke answers 404 as any unknown route;
 *  - every write audited (`vault.settings`, `vault.reward.*`, `vault.give`, `drop.live.vault`, `model.vault_only`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/server/types.js';
import { createAccount, createLiveRelease, createModel, liveFixtureOn, sizedModel, type LiveFixture } from '../support/live.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

const HOUR = 3_600_000;
type Json = Record<string, unknown>;
const put = (c: Client, url: string, body?: unknown) => c.request('PUT', url, body === undefined ? {} : { body });

describe('THE VAULT in the console (lot Q3, step Q3.9)', () => {
  let h: Harness;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  let retail: Client;
  let agent: Client;
  let staff: Actor & { id: string };
  let f: LiveFixture;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-02T09:00:00.000Z');
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    retail = await adminClient(h, 'RETAIL');
    agent = await adminClient(h, 'LOGISTICS');
    staff = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    f = await liveFixtureOn(h.ctx, h.clock);
  });
  afterAll(() => h?.close());

  const audits = (action: string) => h.t.db.selectFrom('audit_logs').select(['actor_type', 'target_id', 'details']).where('action', '=', action).execute();

  it('the roles: an AUDITOR reads, an OPERATOR edits the table and gives to one collector, an ADMIN sets the sources and gives to a segment; RETAIL and LOGISTICS nothing', async () => {
    for (const c of [auditor, operator, admin]) {
      const s = await c.get('/api/admin/vault/settings');
      expect(s.statusCode, s.body).toBe(200);
      expect(s.headers['cache-control']).toBe('no-store');
    }
    const settings = safeJson(await auditor.get('/api/admin/vault/settings')) as { sources: Json[]; rewards: Json[]; partsGiven: number; floor: Json };
    expect(settings.sources.map((s) => s.source)).toEqual(['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE']);
    expect(settings.rewards.filter((r) => r.kind === 'I_WAS_THERE')).toHaveLength(1);
    expect(settings).toMatchObject({ partsGiven: 0, floor: { parts: 1_000_000, oddsIn: 1, oddsText: '1 IN 1' } });
    for (const c of [retail, agent]) {
      for (const url of ['/api/admin/vault/settings', '/api/admin/vault/report', `/api/admin/vault/vaults?account=${randomUUID()}`]) expect(errorOf(await c.get(url)).code, url).toBe('FORBIDDEN');
    }
    const credit = { kind: 'CREDIT', oddsIn: 10, quantity: 100, amountMinor: 2_500, currency: 'EUR' };
    // Writes: never an AUDITOR's; the sources an ADMIN's; a segment's gift an ADMIN's.
    expect(errorOf(await auditor.post('/api/admin/vault/rewards', credit)).code).toBe('FORBIDDEN');
    expect(errorOf(await put(auditor, '/api/admin/vault/sources/LIVE', { enabled: true, perOccasion: 1, cap: 1 })).code).toBe('FORBIDDEN');
    expect(errorOf(await put(operator, '/api/admin/vault/sources/LIVE', { enabled: true, perOccasion: 1, cap: 1 })).code).toBe('FORBIDDEN');
    expect(errorOf(await auditor.post('/api/admin/vault/give', { email: 'nobody@example.com', dryRun: true })).code).toBe('FORBIDDEN');
    const segment = await h.ctx.services.segments.create({ name: `Iceland ${randomUUID().slice(0, 4)}`, criteria: { match: 'ALL', rules: [{ kind: 'COUNTRY', countries: ['IS'] }] } }, staff);
    expect(errorOf(await operator.post('/api/admin/vault/give', { segmentId: segment.id, dryRun: true }))).toEqual({ code: 'FORBIDDEN', message: 'Only an ADMIN gives a vault to a segment.' });
    const dry = await admin.post('/api/admin/vault/give', { segmentId: segment.id, dryRun: true });
    expect(dry.statusCode, dry.body).toBe(200);
    expect(safeJson(dry)).toEqual({ giftId: null, dryRun: true, reach: 0, accounts: 0, vaults: 0, leftOut: { testEntrants: 0, inactive: 0 } });

    const created = await operator.post('/api/admin/vault/rewards', credit);
    expect(created.statusCode, created.body).toBe(201);
    const row = (safeJson(created) as { rewards: Json[] }).rewards.find((r) => r.kind === 'CREDIT')!;
    expect(row).toMatchObject({ oddsIn: 10, oddsText: '1 IN 10', quantity: 100, given: 0, left: 100, amountMinor: 2_500, currency: 'EUR', active: true, rare: false });
    expect(safeJson(created)).toMatchObject({ partsGiven: 100_000, floor: { parts: 900_000, oddsText: '1 IN 1' } });
    const src = await put(admin, '/api/admin/vault/sources/WORN', { enabled: false, perOccasion: 2, cap: 3 });
    expect(src.statusCode, src.body).toBe(200);
    expect((safeJson(src) as { sources: Json[] }).sources.find((s) => s.source === 'WORN')).toMatchObject({ enabled: false, perOccasion: 2, cap: 3 });
    expect((await audits('vault.settings')).at(-1)).toMatchObject({ actor_type: 'admin', target_id: 'WORN', details: { source: 'WORN', after: { enabled: false, perOccasion: 2, cap: 3 } } });
    await put(admin, '/api/admin/vault/sources/WORN', { enabled: true, perOccasion: 1, cap: 1 });
    expect(errorOf(await put(admin, '/api/admin/vault/sources/BIRTHDAY', { enabled: true, perOccasion: 1, cap: 1 })).code).toBe('VAULT_SOURCE_NOT_FOUND');
    expect(errorOf(await put(admin, '/api/admin/vault/sources/HOUSE', { enabled: true, perOccasion: 1, cap: 2 }))).toEqual({ code: 'VALIDATION_FAILED', message: 'The house’s gifts have no cap: each gift is its own.' });
    expect(errorOf(await put(admin, '/api/admin/vault/sources/LIVE', { enabled: true, perOccasion: 11, cap: 1 })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await put(admin, '/api/admin/vault/sources/LIVE', { enabled: true, perOccasion: 1 })).code).toBe('VALIDATION_FAILED');
    await operator.post(`/api/admin/vault/rewards/${row.id}/deactivate`);
  });

  it('the table: a row created, changed, set aside and ordered, each audited; a SERVICE add-on refused as an ADDON and as a PRODUCT (409 VAULT_REWARD_SERVICE); the odds above one in one, the floor and an unknown row refused; strict bodies', async () => {
    const product = await h.ctx.services.addons.create({ name: 'POLISHING CLOTH', skuCode: `ADD-CLOTH-${randomUUID().slice(0, 4)}`, prices: { EUR: 1_500 } }, staff);
    const service = await h.ctx.services.addons.create({ kind: 'SERVICE', name: 'GIFT WRAPPING', skuCode: `ADD-WRAP-${randomUUID().slice(0, 4)}`, prices: { EUR: 500 } }, staff);
    const serviceRefused = { code: 'VAULT_REWARD_SERVICE', message: 'A service cannot be a vault’s reward.' };
    expect(errorOf(await operator.post('/api/admin/vault/rewards', { kind: 'ADDON', oddsIn: 20, quantity: 5, addonId: service.id }))).toEqual(serviceRefused);
    expect(errorOf(await operator.post('/api/admin/vault/rewards', { kind: 'PRODUCT', oddsIn: 20, quantity: 5, addonId: service.id, mode: 'FREE' }))).toEqual(serviceRefused);
    expect(errorOf(await operator.post('/api/admin/vault/rewards', { kind: 'PRODUCT', oddsIn: 20, quantity: 5, addonId: service.id, mode: 'RIGHT_TO_BUY' }))).toEqual(serviceRefused);
    const addon = safeJson(await operator.post('/api/admin/vault/rewards', { kind: 'ADDON', oddsIn: 20, quantity: 5, addonId: product.id })) as { rewards: Json[] };
    const row = addon.rewards.find((r) => r.kind === 'ADDON' && r.active)!;
    expect(row).toMatchObject({ addonId: product.id, addonName: 'POLISHING CLOTH', oddsText: '1 IN 20' });
    // Changed to a SERVICE add-on: refused the same.
    expect(errorOf(await put(operator, `/api/admin/vault/rewards/${row.id}`, { oddsIn: 20, quantity: 5, addonId: service.id }))).toEqual(serviceRefused);
    const changed = await put(operator, `/api/admin/vault/rewards/${row.id}`, { oddsIn: 25, quantity: 6, addonId: product.id });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((safeJson(changed) as { rewards: Json[] }).rewards.find((r) => r.id === row.id)).toMatchObject({ oddsIn: 25, quantity: 6 });
    expect(errorOf(await put(operator, `/api/admin/vault/rewards/${row.id}`, { kind: 'CREDIT', oddsIn: 25, quantity: 6 })).message).toBe('A reward keeps its kind: add another row.');
    // The odds above one in one; the floor; an unknown row.
    expect(errorOf(await operator.post('/api/admin/vault/rewards', { kind: 'CREDIT', oddsIn: 1, quantity: 1, amountMinor: 100, currency: 'EUR' }))).toEqual({
      code: 'VAULT_ODDS_OVER',
      message: 'The odds of the active rewards add up to more than one in one. Lower one first.',
    });
    expect(errorOf(await operator.post('/api/admin/vault/rewards', { kind: 'I_WAS_THERE', oddsIn: 2, quantity: 1 })).code).toBe('VAULT_FLOOR_FIXED');
    const floor = (safeJson(await operator.get('/api/admin/vault/settings')) as { floor: { id: string } }).floor;
    expect(errorOf(await put(operator, `/api/admin/vault/rewards/${floor.id}`, { oddsIn: 2, quantity: 1 })).code).toBe('VAULT_FLOOR_FIXED');
    expect(errorOf(await operator.post(`/api/admin/vault/rewards/${floor.id}/deactivate`)).code).toBe('VAULT_FLOOR_FIXED');
    expect(errorOf(await operator.post(`/api/admin/vault/rewards/${randomUUID()}/deactivate`)).code).toBe('VAULT_REWARD_NOT_FOUND');
    // Strict bodies: an unknown field, an unknown kind, a fraction, a missing quantity.
    for (const bad of [
      { kind: 'CREDIT', oddsIn: 10, quantity: 1, amountMinor: 100, currency: 'EUR', given: 4 },
      { kind: 'BIRTHDAY', oddsIn: 10, quantity: 1 },
      { kind: 'CREDIT', oddsIn: 10.5, quantity: 1, amountMinor: 100, currency: 'EUR' },
      { kind: 'CREDIT', oddsIn: 10, amountMinor: 100, currency: 'EUR' },
    ]) {
      expect(errorOf(await operator.post('/api/admin/vault/rewards', bad)).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    // Set aside, then the table's order.
    expect((await operator.post(`/api/admin/vault/rewards/${row.id}/deactivate`, { now: true })).statusCode).toBe(400);
    const aside = await operator.post(`/api/admin/vault/rewards/${row.id}/deactivate`);
    expect((safeJson(aside) as { rewards: Json[] }).rewards.find((r) => r.id === row.id)).toMatchObject({ active: false });
    const ids = ((safeJson(await operator.get('/api/admin/vault/settings')) as { rewards: { id: string }[] }).rewards.map((r) => r.id)).reverse();
    const ordered = await operator.post('/api/admin/vault/rewards/order', { ids });
    expect(ordered.statusCode, ordered.body).toBe(200);
    expect((safeJson(ordered) as { rewards: { id: string }[] }).rewards.map((r) => r.id)).toEqual(ids);
    expect(errorOf(await operator.post('/api/admin/vault/rewards/order', { ids: ids.slice(1) })).code).toBe('VALIDATION_FAILED');
    for (const action of ['vault.reward.create', 'vault.reward.update', 'vault.reward.deactivate', 'vault.reward.order']) expect((await audits(action)).length, action).toBeGreaterThan(0);
  });

  it('GIVE A VAULT: the reach first (`dryRun`), then one collector by email; the note never audited nor an email; THE HOUSE switched off refused; a client’s vaults read-only, nothing to mask; no revoke route (N36)', async () => {
    const one = await createAccount(h.t.db);
    const NOTE = 'Sentinel note: after the evening.';
    const dry = await operator.post('/api/admin/vault/give', { email: one.email.toUpperCase(), note: NOTE, dryRun: true });
    expect(safeJson(dry)).toEqual({ giftId: null, dryRun: true, reach: 1, accounts: 0, vaults: 0, leftOut: { testEntrants: 0, inactive: 0 } });
    expect(await h.t.db.selectFrom('vaults').select('id').where('account_id', '=', one.id).execute()).toEqual([]);
    const given = await operator.post('/api/admin/vault/give', { email: one.email, note: NOTE });
    expect(given.statusCode, given.body).toBe(200);
    expect(safeJson(given)).toMatchObject({ dryRun: false, reach: 1, accounts: 1, vaults: 1 });
    const gifts = await audits('vault.give');
    const mine = gifts.filter((g) => JSON.stringify(g.details).includes(one.id) || g.target_id === one.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const g of gifts) {
      expect(JSON.stringify(g)).not.toContain('Sentinel note');
      expect(JSON.stringify(g)).not.toContain(one.email);
    }
    // Strict: neither or both, an unknown account, an unknown field.
    expect(errorOf(await operator.post('/api/admin/vault/give', {}))).toEqual({ code: 'VALIDATION_FAILED', message: 'Choose a collector or a segment.' });
    expect(errorOf(await operator.post('/api/admin/vault/give', { email: one.email, accountId: one.id })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await operator.post('/api/admin/vault/give', { accountId: randomUUID() })).code).toBe('ACCOUNT_NOT_FOUND');
    expect(errorOf(await operator.post('/api/admin/vault/give', { accountId: one.id, revoke: true })).code).toBe('VALIDATION_FAILED');

    // A client's vaults: read by an AUDITOR as by an OPERATOR, every state, the note for Client Services, no client email.
    for (const c of [auditor, operator]) {
      const res = await c.get(`/api/admin/vault/vaults?account=${one.id}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect((safeJson(res) as { items: Json[] }).items).toMatchObject([{ source: 'HOUSE', state: 'WAITING', label: 'FROM THE HOUSE', note: NOTE, kind: null, held: null, revokedReason: null }]);
      expect(res.body).not.toContain(one.email);
      expect(res.body).not.toContain(one.email.split('@')[0]!);
    }
    expect(errorOf(await auditor.get(`/api/admin/vault/vaults?account=${randomUUID()}`)).code).toBe('ACCOUNT_NOT_FOUND');
    expect(errorOf(await auditor.get('/api/admin/vault/vaults')).code).toBe('VALIDATION_FAILED');
    // No route takes a vault back: the console's REVOKE does not exist (N36), as any unknown route.
    const id = ((safeJson(await auditor.get(`/api/admin/vault/vaults?account=${one.id}`)) as { items: { id: string }[] }).items[0]!).id;
    const revoke = await admin.post(`/api/admin/vault/vaults/${id}/revoke`, { reason: 'ERROR' });
    const unknown = await admin.post('/api/admin/vault/no-such-route', {});
    expect(revoke.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(safeJson(revoke)).toEqual(safeJson(unknown));
    expect((await admin.request('DELETE', `/api/admin/vault/vaults/${id}`)).statusCode).toBe(404);
    expect(await h.t.db.selectFrom('vaults').select(['revoked_at']).where('id', '=', id).executeTakeFirstOrThrow()).toEqual({ revoked_at: null });

    // THE HOUSE switched off: refused in words.
    await put(admin, '/api/admin/vault/sources/HOUSE', { enabled: false, perOccasion: 1, cap: null });
    expect(errorOf(await operator.post('/api/admin/vault/give', { accountId: one.id }))).toEqual({ code: 'VAULT_SOURCE_OFF', message: 'THE HOUSE is switched off in CLUB > THE VAULT. Switch it on first.' });
    await put(admin, '/api/admin/vault/sources/HOUSE', { enabled: true, perOccasion: 1, cap: null });
  });

  it('the report: the period’s vaults by source and state, the rewards won with their value and cost, the quantities left; an AUDITOR reads it; a bad period 422', async () => {
    const credit = (safeJson(await operator.post('/api/admin/vault/rewards', { kind: 'CREDIT', oddsIn: 1, quantity: 9, amountMinor: 2_000, currency: 'EUR' })) as { rewards: Json[] }).rewards.find((r) => r.kind === 'CREDIT' && r.active)!;
    const a = await createAccount(h.t.db);
    const v = (await h.ctx.services.vault.give({ source: 'HOUSE', accountId: a.id, giftId: randomUUID(), givenBy: staff.id })).vaults[0]!;
    await h.ctx.services.vault.open(a.id, v.id);
    const res = await auditor.get('/api/admin/vault/report?from=2026-11-01&to=2026-11-02');
    expect(res.statusCode, res.body).toBe(200);
    const r = safeJson(res) as { from: string; to: string; given: { source: string; count: number }[]; givenTotal: number; opened: number; byKind: Json[]; rows: Json[]; credits: Json; totalCost: Json[]; costUnknown: number };
    expect(r).toMatchObject({ from: '2026-11-01', to: '2026-11-02', opened: 1, costUnknown: 0 });
    expect(r.given.map((g) => g.source)).toEqual(['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE']);
    expect(r.given.find((g) => g.source === 'HOUSE')!.count).toBeGreaterThanOrEqual(2);
    expect(r.byKind.find((k) => k.kind === 'CREDIT')).toMatchObject({ won: 1, value: [{ currency: 'EUR', minor: 2_000 }], cost: [{ currency: 'EUR', minor: 2_000 }] });
    expect(r.rows.find((x) => x.id === credit.id)).toMatchObject({ won: 1, quantity: 9, given: 1, left: 8 });
    expect(r.credits).toEqual({ given: [{ currency: 'EUR', minor: 2_000 }], used: [] });
    expect(r.totalCost).toEqual([{ currency: 'EUR', minor: 2_000 }]);
    // Its CSV (step Q3.12, §4.3): one figure per row, named by its Paris days; an AUDITOR reads it, RETAIL never.
    const csv = await auditor.get('/api/admin/vault/report.csv?from=2026-11-01&to=2026-11-02');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8; header=present');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="ORBES-vault-report-2026-11-01-to-2026-11-02.csv"');
    expect(csv.headers['cache-control']).toBe('no-store');
    const lines = csv.body.split('\r\n');
    expect(lines[0]).toBe('"section","item","value"');
    for (const row of ['"period","from","2026-11-01"', '"vaults","opened","1"', '"kind credit","won","1"', '"kind credit","value EUR","20.00"', '"credits","given EUR","20.00"', '"cost","total EUR","20.00"', '"cost","unknown","0"']) expect(lines, row).toContain(row);
    expect(lines.some((l) => /^"reward \d+ credit","left","8"$/.test(l))).toBe(true);
    expect(errorOf(await retail.get('/api/admin/vault/report.csv')).code).toBe('FORBIDDEN');
    expect(errorOf(await auditor.get('/api/admin/vault/report.csv?from=2026-11-02')).code).toBe('PERIOD_INVALID');
    // The default period (the last 30 days) reads the same opening; a period another day reads none.
    expect((safeJson(await auditor.get('/api/admin/vault/report')) as { opened: number }).opened).toBe(1);
    expect((safeJson(await auditor.get('/api/admin/vault/report?from=2026-10-01&to=2026-10-31')) as { opened: number }).opened).toBe(0);
    expect(errorOf(await auditor.get('/api/admin/vault/report?from=2026-11-02'))).toEqual({ code: 'PERIOD_INVALID', message: 'Give the first and the last day, or neither.' });
    expect(errorOf(await auditor.get('/api/admin/vault/report?from=2026-11-02&to=2026-11-01')).code).toBe('PERIOD_INVALID');
    expect(errorOf(await auditor.get('/api/admin/vault/report?from=2026-13-01&to=2026-13-02')).code).toBe('VALIDATION_FAILED');
    await operator.post(`/api/admin/vault/rewards/${credit.id}/deactivate`);

    // A piece won free: at its supplier unit price where known (the latest sent supplier order's), else counted unknown.
    const france = (await h.t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const modelId = await sizedModel(h.t.db, 'ORBITE', ['52']);
    await h.t.db.updateTable('models').set({ base_price_minor: 90_000, base_currency: 'EUR' }).where('id', '=', modelId).execute();
    const sku = (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', modelId).executeTakeFirstOrThrow()).id;
    await h.ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted.' }, staff);
    const free = (safeJson(await operator.post('/api/admin/vault/rewards', { kind: 'PRODUCT', oddsIn: 1, quantity: 5, modelId, mode: 'FREE' })) as { rewards: Json[] }).rewards.find((x) => x.kind === 'PRODUCT' && x.active)!;
    const b = await createAccount(h.t.db);
    const w = (await h.ctx.services.vault.give({ source: 'HOUSE', accountId: b.id, giftId: randomUUID(), givenBy: staff.id })).vaults[0]!;
    expect(await h.ctx.services.vault.open(b.id, w.id)).toMatchObject({ kind: 'PRODUCT' });
    const unknown = safeJson(await auditor.get('/api/admin/vault/report?from=2026-11-01&to=2026-11-02')) as typeof r;
    expect(unknown.byKind.find((k) => k.kind === 'PRODUCT')).toMatchObject({ won: 1, value: [{ currency: 'EUR', minor: 90_000 }], cost: [], costUnknown: 1 });
    expect(unknown).toMatchObject({ totalCost: [{ currency: 'EUR', minor: 2_000 }], costUnknown: 1 });
    const supplier = await h.t.db.insertInto('suppliers').values({ name: `ATELIER ${randomUUID().slice(0, 4)}`, currency: 'EUR' }).returning('id').executeTakeFirstOrThrow();
    const order = await h.t.db
      .insertInto('supplier_orders')
      .values({ supplier_id: supplier.id, location_id: france, status: 'SENT', currency: 'EUR', expected_on: '2026-11-20', sent_at: h.clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.t.db.insertInto('supplier_order_lines').values({ supplier_order_id: order.id, sku_id: sku, quantity: 1, unit_price_minor: 12_000 }).execute();
    const known = safeJson(await auditor.get('/api/admin/vault/report?from=2026-11-01&to=2026-11-02')) as typeof r;
    expect(known.rows.find((x) => x.id === free.id)).toMatchObject({ won: 1, cost: [{ currency: 'EUR', minor: 12_000 }], costUnknown: 0, left: 4 });
    expect(known).toMatchObject({ totalCost: [{ currency: 'EUR', minor: 14_000 }], costUnknown: 0 });
    await operator.post(`/api/admin/vault/rewards/${free.id}/deactivate`);
  });

  it('a LIVE release’s THE VAULT (PUT /api/admin/live/:id/vault): an OPERATOR’s until its end, audited; never an after-room’s; an AUDITOR refused; strict body', async () => {
    const r = await createLiveRelease(f, { opensAt: new Date(h.clock.now().getTime() + 2 * HOUR), published: false, afterRoom: { modelId: f.modelId, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] } });
    const on = await put(operator, `/api/admin/live/${r.id}/vault`, { on: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(safeJson(on)).toMatchObject({ id: r.id, vaultOn: true });
    expect((await audits('drop.live.vault')).filter((x) => x.target_id === r.id)).toEqual([{ actor_type: 'admin', target_id: r.id, details: { before: false, after: true } }]);
    expect(errorOf(await put(auditor, `/api/admin/live/${r.id}/vault`, { on: false })).code).toBe('FORBIDDEN');
    // Step Q3.12 (§4.2): the release report reads its switch and the vaults it gave and those opened; an after-room's none.
    const report = await auditor.get(`/api/admin/live/${r.id}/report`);
    expect(report.statusCode, report.body).toBe(200);
    expect((safeJson(report) as Json).vaults).toEqual({ on: true, given: 0, opened: 0 });
    expect((safeJson(await auditor.get(`/api/admin/live/${r.afterRoom!.id}/report`)) as Json).vaults).toBeNull();
    expect((await auditor.get(`/api/admin/live/${r.id}/report.csv`)).body).toContain('"the vault","switch","on"');
    expect(errorOf(await put(operator, `/api/admin/live/${r.id}/vault`, { on: 'yes' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await put(operator, `/api/admin/live/${r.afterRoom!.id}/vault`, { on: true })).code).toBe('LIVE_AFTER_ROOM');
    expect(errorOf(await put(operator, `/api/admin/live/${randomUUID()}/vault`, { on: true })).code).toBe('DROP_NOT_FOUND');
    expect((safeJson(await put(operator, `/api/admin/live/${r.id}/vault`, { on: false })) as Json).vaultOn).toBe(false);
  });

  it('a model’s VAULT ONLY (PUT /api/admin/models/:id/vault-only): an OPERATOR’s, read with the model, audited; refused while the table holds it the other way', async () => {
    const id = await createModel(h.t.db, 'SECRET');
    const marked = await put(operator, `/api/admin/models/${id}/vault-only`, { vaultOnly: true });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(safeJson(marked)).toMatchObject({ id, vaultOnly: true });
    expect((safeJson(await auditor.get(`/api/admin/models/${id}`)) as Json).vaultOnly).toBe(true);
    expect((await audits('model.vault_only')).filter((x) => x.target_id === id)).toEqual([{ actor_type: 'admin', target_id: id, details: { before: false, after: true } }]);
    expect(errorOf(await put(auditor, `/api/admin/models/${id}/vault-only`, { vaultOnly: false })).code).toBe('FORBIDDEN');
    expect(errorOf(await put(operator, `/api/admin/models/${id}/vault-only`, { vaultOnly: 'on' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await put(operator, `/api/admin/models/${randomUUID()}/vault-only`, { vaultOnly: true })).code).toBe('MODEL_NOT_FOUND');
    // A VAULT EDITION of the table keeps its model vault-only; a PRODUCT of the table keeps its model sold.
    const edition = (safeJson(await operator.post('/api/admin/vault/rewards', { kind: 'VAULT_EDITION', oddsIn: 500, quantity: 3, modelId: id, line: 'Made only for the vault.' })) as { rewards: Json[] }).rewards.find((r) => r.modelId === id)!;
    expect(edition).toMatchObject({ kind: 'VAULT_EDITION', rare: true });
    expect(errorOf(await put(operator, `/api/admin/models/${id}/vault-only`, { vaultOnly: false })).code).toBe('VAULT_EDITION_MODEL');
    await operator.post(`/api/admin/vault/rewards/${edition.id}/deactivate`);
    expect((safeJson(await put(operator, `/api/admin/models/${id}/vault-only`, { vaultOnly: false })) as Json).vaultOnly).toBe(false);
    await operator.post('/api/admin/vault/rewards', { kind: 'PRODUCT', oddsIn: 500, quantity: 3, modelId: id, mode: 'FREE' });
    expect(errorOf(await put(operator, `/api/admin/models/${id}/vault-only`, { vaultOnly: true })).code).toBe('VAULT_ONLY_PRODUCT');
  });
});
