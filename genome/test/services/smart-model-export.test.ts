/**
 * ORBES Smart Model's export (lot EXPORT SMART MODEL; services/smart-model-export.ts, routes/export.ts): the script's query
 * as it is, its figures on the margin's houses (test/support/margin.ts) counted by hand, the stock, the fingerprints, the
 * pages and snapshots, every refusal of the contract, and a database left exactly as it was.
 */
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/server/db/connection.js';
import {
  fingerprint,
  nightWindow,
  pagesOf,
  pseudonymize,
  readSmartModel,
  readStatements,
  SMART_MODEL_ANSWER_WITHIN_MS,
  SMART_MODEL_PAGE_SALES,
  SMART_MODEL_SNAPSHOT_MS,
  SmartModelExport,
  SmartModelExportError,
  statementsOf,
  type SmartModelRaw,
} from '../../src/server/services/smart-model-export.js';
import { SMART_MODEL_SQL, SMART_MODEL_SQL_VERSION } from '../../src/server/services/smart-model-sql.js';
import { SMART_MODEL_EXPORT_ROUTE, SMART_MODEL_FAILURES_MAX, SMART_MODEL_PAUSE_MS } from '../../src/server/routes/export.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { seedMargin, seedMarginEdges, seedMarginVault, type MarginFixture } from '../support/margin.js';

/** SHA-256 of the constant SQL of orbes-sync.mjs v1.2.0 (the script's own SHA-256: 5f60fde2…be45c). */
const SCRIPT_SQL_SHA256 = 'd18c5c88aa083b1dcc66db92072e129e8c894a7461f0d38569b08f1743f596c2';

const TOKEN = 'smart-model-test-token-0123456789abcdefghij';
const TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
const KEY = 'a1'.repeat(32);
const SINCE = '2025-01-01';
/** 12:00 Paris on 15 Oct 2026: outside the night. */
const NOON = new Date('2026-10-15T10:00:00.000Z');

/** Every field a sale carries (the contract): nothing else may leave. */
const SALE_FIELDS = [
  'ref', 'key', 'customer', 'email', 'day', 'reservedDay', 'channel', 'status', 'currency', 'docCurrencies', 'country', 'units', 'unitsReturned',
  'giftUnits', 'vaultWonUnits', 'exchanges', 'models', 'revenueMinor', 'creditsMinor', 'shippingMinor', 'refundedMinor', 'refundedDay', 'returnedDay',
  'creditKinds', 'customerRank', 'source',
].sort();

type Sale = Record<string, unknown> & { order: string; account: string; models: Record<string, number>; creditKinds: string[] };
const byOrder = (raw: SmartModelRaw) => new Map(raw.sales.map((s) => [s.order, s as unknown as Sale]));

/** A fingerprint of every table of the public schema (its rows, as text), to prove nothing was written. */
async function tablesDigest(db: Db): Promise<Record<string, string>> {
  const tables = (
    await sql<{ name: string }>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`.execute(db)
  ).rows.map((r) => r.name);
  const out: Record<string, string> = {};
  for (const t of tables) {
    const r = await sql<{ d: string }>`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) || ':' || count(*) AS d FROM ${sql.table(t)} x`.execute(db);
    out[t] = r.rows[0]!.d;
  }
  return out;
}

const fakeSale = (i: number) => ({
  order: randomUUID(), account: randomUUID(), email: ` Person${i}@Example.COM `, day: '2027-01-02', reservedDay: '2027-01-02', channel: 'SALON', status: 'paid',
  currency: 'EUR', docCurrencies: 'EUR', country: 'FR', units: 1, unitsReturned: 0, giftUnits: 0, vaultWonUnits: 0, exchanges: 0, models: {},
  revenueMinor: 100_000, creditsMinor: 0, shippingMinor: 0, refundedMinor: 0, refundedDay: null, returnedDay: null, creditKinds: [], customerRank: 1, source: null,
});
const fakeRaw = (n: number, since = SINCE): SmartModelRaw => ({ format: 'orbes-console/2', since, dbNow: '2027-01-03T10:00:00+01:00', rates: [], models: [], sales: Array.from({ length: n }, (_, i) => fakeSale(i)) });

describe('the query', () => {
  it('is the constant SQL of orbes-sync.mjs v1.2.0, as it is', () => {
    expect(createHash('sha256').update(SMART_MODEL_SQL).digest('hex')).toBe(SCRIPT_SQL_SHA256);
    expect(SMART_MODEL_SQL_VERSION).toBe('1.2.0');
  });

  it('runs as BEGIN … READ ONLY, three SET LOCALs, the LIVE guard and the query; ROLLBACK apart', () => {
    const all = statementsOf(SMART_MODEL_SQL);
    expect(all).toHaveLength(7);
    expect(all[0]!.endsWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;')).toBe(true);
    expect(all.slice(1, 4)).toEqual(["SET LOCAL statement_timeout = '60s';", "SET LOCAL lock_timeout = '2s';", 'SET LOCAL enable_nestloop = off;']);
    expect(all[4]).toMatch(/^-- Never during a LIVE release[\s\S]*DO \$\$[\s\S]*ORBES-SYNC-LIVE[\s\S]*\$\$;$/);
    expect(all[5]).toMatch(/^WITH RECURSIVE[\s\S]*::text AS out;$/);
    expect(all[6]).toBe('ROLLBACK;');
    const run = readStatements('2027-01-01');
    expect(run).toHaveLength(6);
    expect(run.join('\n')).not.toContain('__SINCE__');
    expect(run.join('\n')).toContain("'2027-01-01'::date");
  });

  it('puts in nothing but a real day', () => {
    for (const bad of ['2027-02-30', '2027-1-01', "2027-01-01'; DROP TABLE orders; --", '', 'tomorrow']) expect(() => readStatements(bad)).toThrow(RangeError);
  });

  it('knows the night as the script does: 04:00 to 06:30 Paris', () => {
    expect(nightWindow(new Date('2026-11-02T02:59:00Z'))).toBe(false); // 03:59 Paris (winter time)
    expect(nightWindow(new Date('2026-11-02T03:00:00Z'))).toBe(true);
    expect(nightWindow(new Date('2026-11-02T05:29:00Z'))).toBe(true);
    expect(nightWindow(new Date('2026-11-02T05:30:00Z'))).toBe(false);
    expect(nightWindow(new Date('2026-07-02T02:00:00Z'))).toBe(true); // 04:00 Paris (summer time)
  });
});

describe('the figures, on the margin houses', () => {
  let h: Harness;
  let adminId: string;
  beforeAll(async () => {
    h = await createHarness();
    adminId = (await createAdmin(h.ctx, 'ADMIN')).id;
  });
  afterAll(async () => h.close());

  it('seedMargin: every sale counted by hand, test accounts out, the whole history ranked', async () => {
    const f = await seedMargin(h.ctx.db, adminId);
    const raw = await readSmartModel(h.ctx.db, SINCE);
    const s = byOrder(raw);
    const o = f.orders;
    // Sales are root orders: O3 travels with O2, E5 is O5's exchange, S2 travels with S1, G1 (the gift) with O1; O8 is a test entrant's.
    expect([...s.keys()].sort()).toEqual([o.O1, o.O2, o.O4, o.O5, o.O6, o.O7, o.O9, o.O10, o.S1].sort());
    expect(s.get(o.O1)).toMatchObject({ channel: 'SALON', status: 'paid', country: 'FR', units: 1, giftUnits: 1, revenueMinor: 122_500, shippingMinor: 1_500, customerRank: 2 });
    expect(s.get(o.O2)).toMatchObject({ channel: 'LIVE', units: 2, revenueMinor: 237_000, creditsMinor: -10_000, refundedMinor: 2_000, refundedDay: '2026-04-06', customerRank: 1 });
    expect(s.get(o.O4)).toMatchObject({ currency: 'GBP', docCurrencies: 'GBP', country: 'GB', revenueMinor: 100_000 });
    expect(s.get(o.O5)).toMatchObject({ units: 1, exchanges: 1, revenueMinor: 120_000 });
    expect(s.get(o.O6)).toMatchObject({ status: 'paid', units: 1, unitsReturned: 1, refundedMinor: 120_000, returnedDay: '2026-02-20' });
    expect(s.get(o.O7)).toMatchObject({ status: 'cancelled', units: 0, revenueMinor: 0, customerRank: null });
    expect(s.get(o.O9)).toMatchObject({ day: '2025-09-01', customerRank: 1 });
    expect(s.get(o.O10)).toMatchObject({ customerRank: 3 });
    expect(s.get(o.S1)).toMatchObject({ units: 2, revenueMinor: 100_000 });
    expect(Object.keys(s.get(o.O10)!.models)).toEqual([f.models.halo]); // the Gold variant counts as HALO
    expect(raw.rates).toEqual([{ currency: 'GBP', eurRate: 1.2 }]);
    // `since` keeps the sales paid from that Paris day only; the rank still counts the whole history.
    const later = byOrder(await readSmartModel(h.ctx.db, '2026-03-01'));
    expect(later.has(o.O9)).toBe(false);
    expect(later.get(o.O1)).toMatchObject({ customerRank: 2 });
  });

  it('seedMarginVault: a piece won at 0 in THE VAULT is free, with no unit and no rank', async () => {
    const h2 = await createHarness();
    try {
      const f = await seedMarginVault(h2.ctx.db, (await createAdmin(h2.ctx, 'ADMIN')).id);
      const s = byOrder(await readSmartModel(h2.ctx.db, SINCE));
      expect(s.get(f.orders.OW)).toMatchObject({ channel: 'VAULT', status: 'free', units: 0, vaultWonUnits: 1, revenueMinor: 0, customerRank: null });
      expect(s.get(f.orders.OR)).toMatchObject({ channel: 'VAULT', status: 'paid', units: 1, revenueMinor: 90_000 });
      expect([...s.get(f.orders.O2)!.creditKinds].sort()).toEqual(['BIRTHDAY', 'VAULT_GIFT']);
      expect(s.has(f.orders.OT)).toBe(false);
      expect(s.has(f.orders.OTs)).toBe(false);
    } finally {
      await h2.close();
    }
  });

  it('seedMarginEdges: three paid orders travelling together are one sale of three pieces', async () => {
    const h2 = await createHarness();
    try {
      const f = await seedMarginEdges(h2.ctx.db, (await createAdmin(h2.ctx, 'ADMIN')).id);
      const s = byOrder(await readSmartModel(h2.ctx.db, SINCE));
      expect([...s.keys()].sort()).toEqual([f.orders.O1, f.orders.O4].sort());
      expect(s.get(f.orders.O1)).toMatchObject({ units: 3, revenueMinor: 304_000, day: '2026-04-01' });
      expect(s.get(f.orders.O4)).toMatchObject({ units: 1, revenueMinor: 150_000 });
    } finally {
      await h2.close();
    }
  });

  it('the stock: in hand, reserved, awaited, and what sent supplier orders still owe (a draft and a received one do not)', async () => {
    const h2 = await createHarness();
    try {
      const db = h2.ctx.db;
      const f: MarginFixture = await seedMargin(db, (await createAdmin(h2.ctx, 'ADMIN')).id);
      const w = f.world;
      const halo = await w.sku(f.models.halo, 'STOCK 50');
      const gold = await w.sku(f.models.gold, 'STOCK 52');
      const orbit = await w.sku(f.models.orbit, 'STOCK 60');
      const move = (sku: string, delta: number, at: string) =>
        db.insertInto('stock_movements').values({ sku_id: sku, location_id: w.location, delta, reason: 'ADJUSTED', note: 'test', actor_type: 'system', actor_id: null, created_at: new Date(at) }).execute();
      await move(halo, 40, '2026-05-10T10:00:00Z');
      await move(gold, 10, '2026-05-12T10:00:00Z');
      await move(halo, -3, '2026-06-20T10:00:00Z');
      await move(orbit, 10, '2026-06-01T10:00:00Z');
      await db.updateTable('orders').set({ reservation: 'STOCK', sku_id: halo, location_id: w.location }).where('id', '=', f.orders.O4).execute();
      const owe = async (status: 'SENT' | 'EXPECTED' | 'PARTLY_RECEIVED' | 'DRAFT' | 'RECEIVED', sku: string, q: { quantity: number; accepted?: number; credited?: number; restCancelled?: number }) => {
        const sent = status === 'DRAFT' ? null : new Date('2026-06-01T10:00:00Z');
        const so = (
          await db
            .insertInto('supplier_orders')
            .values({ supplier_id: w.supplier, location_id: w.location, status, currency: 'EUR', expected_on: '2026-07-01', sent_at: sent, supplier_confirmed_at: status === 'DRAFT' || status === 'SENT' ? null : sent, received_at: status === 'RECEIVED' ? sent : null })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        await db
          .insertInto('supplier_order_lines')
          .values({ supplier_order_id: so, sku_id: sku, quantity: q.quantity, unit_price_minor: 100, accepted_quantity: q.accepted ?? 0, rejected_quantity: q.credited ?? 0, credited_quantity: q.credited ?? 0, rest_cancelled_quantity: q.restCancelled ?? 0 })
          .execute();
      };
      await owe('PARTLY_RECEIVED', halo, { quantity: 15, accepted: 3, credited: 1, restCancelled: 1 }); // 10 still owed
      await owe('EXPECTED', gold, { quantity: 10 }); // 10, a variant of HALO
      await owe('SENT', orbit, { quantity: 5 });
      await owe('DRAFT', halo, { quantity: 7 });
      await owe('RECEIVED', halo, { quantity: 9 });
      const raw = await readSmartModel(db, '2026-05-01');
      const stock = raw.stock as { now: Array<Record<string, unknown>>; monthEnds: Array<Record<string, unknown>> };
      const now = new Map(stock.now.map((r) => [r.id, r]));
      expect(now.get(f.models.halo)).toEqual({ id: f.models.halo, onHand: 47, reserved: 1, awaiting: 0, expected: 20 });
      expect(now.get(f.models.orbit)).toEqual({ id: f.models.orbit, onHand: 10, reserved: 0, awaiting: 0, expected: 5 });
      const ends = stock.monthEnds.filter((r) => r.id === f.models.halo).slice(0, 2);
      expect(ends).toEqual([
        { month: '2026-05', id: f.models.halo, onHand: 50 },
        { month: '2026-06', id: f.models.halo, onHand: 47 },
      ]);
    } finally {
      await h2.close();
    }
  });

  it('reads only: every table is exactly as it was', async () => {
    const before = await tablesDigest(h.ctx.db);
    await readSmartModel(h.ctx.db, SINCE);
    await readSmartModel(h.ctx.db, '2027-01-01');
    expect(await tablesDigest(h.ctx.db)).toEqual(before);
  });

  it('refuses while a LIVE release is open or about to open (the query\'s own guard)', async () => {
    const h2 = await createHarness();
    try {
      const f = await seedMargin(h2.ctx.db, (await createAdmin(h2.ctx, 'ADMIN')).id);
      await sql`UPDATE drops SET opens_at = now() + interval '10 minutes', closes_at = now() + interval '70 minutes', ended_at = NULL WHERE id = ${f.releases.live}`.execute(h2.ctx.db);
      await expect(readSmartModel(h2.ctx.db, SINCE)).rejects.toEqual(new SmartModelExportError('live'));
      // The connection was rolled back: the next query runs, once the release opens tomorrow.
      await sql`UPDATE drops SET opens_at = now() + interval '1 day', closes_at = now() + interval '1 day 1 hour' WHERE id = ${f.releases.live}`.execute(h2.ctx.db);
      expect((await readSmartModel(h2.ctx.db, SINCE)).sales.length).toBeGreaterThan(0);
    } finally {
      await h2.close();
    }
  });
});

describe('the copy', () => {
  it('replaces every account and order id by its fingerprint, as the script does', () => {
    const raw = fakeRaw(2);
    raw.sales[1]!.email = null;
    const at = new Date('2027-01-03T09:00:00Z');
    const copy = pseudonymize(raw, KEY, at);
    const [a, b] = copy.sales as Array<Record<string, unknown>>;
    const src = raw.sales[0]!;
    expect(a).toMatchObject({
      ref: `OR-${src.order.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      key: fingerprint(KEY, 'order', src.order),
      customer: fingerprint(KEY, 'account', src.account),
      email: 'person0@example.com',
    });
    expect((a!.key as string).length).toBe(22);
    expect(b!.email).toBeNull();
    expect(Object.keys(a!).sort()).toEqual(SALE_FIELDS);
    expect(JSON.stringify(copy.sales)).not.toContain(src.order);
    expect(JSON.stringify(copy.sales)).not.toContain(src.account);
    expect(copy.meta).toEqual({ format: 'orbes-console/2', since: SINCE, extractedAt: at.toISOString(), dbNow: raw.dbNow, rates: [], models: [], totalSales: 2, tool: '1.2.0' });
  });

  it('refuses a copy that would carry a raw id outside the models and the emails', () => {
    const raw = fakeRaw(1);
    (raw.sales[0] as Record<string, unknown>).source = { kind: 'LINK', link: randomUUID() };
    expect(() => pseudonymize(raw, KEY, NOON)).toThrow(/raw id/);
    expect(() => pseudonymize(fakeRaw(1), 'short', NOON)).toThrow(/fingerprint key/);
  });

  it('cuts the sales into pages of 1 000', () => {
    expect(pagesOf([]).map((p) => p.length)).toEqual([0]);
    expect(pagesOf(Array.from({ length: 2_500 }, (_, i) => i)).map((p) => p.length)).toEqual([SMART_MODEL_PAGE_SALES, SMART_MODEL_PAGE_SALES, 500]);
  });
});

describe('SmartModelExport', () => {
  afterEach(() => vi.useRealTimers());

  it('one reading at a time: page 0 meanwhile is busy', async () => {
    let release!: (r: SmartModelRaw) => void;
    const exporter = new SmartModelExport({ db: null as unknown as Db, clock: () => NOON, hmacKey: KEY, read: () => new Promise((r) => (release = r)) });
    const first = exporter.page({ since: SINCE, page: 0 });
    await expect(exporter.page({ since: SINCE, page: 0 })).rejects.toEqual(new SmartModelExportError('busy'));
    release(fakeRaw(3));
    expect((await first).sales).toHaveLength(3);
  });

  it('a reading longer than the edge waits answers busy, and its copy is the next page 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let release!: (r: SmartModelRaw) => void;
    const read = vi.fn(() => new Promise<SmartModelRaw>((r) => (release = r)));
    const exporter = new SmartModelExport({ db: null as unknown as Db, clock: () => NOON, hmacKey: KEY, read });
    const first = exporter.page({ since: SINCE, page: 0 });
    vi.advanceTimersByTime(SMART_MODEL_ANSWER_WITHIN_MS);
    await expect(first).rejects.toEqual(new SmartModelExportError('busy'));
    release(fakeRaw(4));
    await Promise.resolve();
    await Promise.resolve();
    const next = await exporter.page({ since: SINCE, page: 0 });
    expect(next.sales).toHaveLength(4);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/export/v1/smart-model', () => {
  let h: Harness;
  const get = (url: string, token: string | null = TOKEN, ip = '198.51.100.7') =>
    h.app.inject({ method: 'GET', url, remoteAddress: ip, headers: { accept: 'application/json', 'user-agent': 'ORBES Smart Model', ...(token !== null ? { authorization: `Bearer ${token}` } : {}) } });
  const page0 = `${SMART_MODEL_EXPORT_ROUTE}?since=${SINCE}&page=0`;
  const logged: string[] = [];

  beforeAll(async () => {
    const lines = (level: string) => (o: unknown, m?: string) => logged.push(`${level} ${JSON.stringify(o)} ${m ?? ''}`);
    h = await createHarness({
      config: { smartModelExport: { tokenSha256: TOKEN_SHA256, key: KEY } },
      context: { log: { info: lines('info'), warn: lines('warn'), error: lines('error'), debug: lines('debug') } as never },
    });
    h.clock.set(NOON);
    await seedMargin(h.ctx.db, (await createAdmin(h.ctx, 'ADMIN')).id);
  });
  afterAll(async () => h.close());

  it('is closed without its two variables: the app\'s own 404', async () => {
    const closed = await createHarness();
    try {
      const res = await closed.app.inject({ method: 'GET', url: page0, headers: { authorization: `Bearer ${TOKEN}` } });
      expect(res.statusCode).toBe(404);
      expect(closed.app.smartModelExport).toBeNull();
    } finally {
      await closed.close();
    }
  });

  it('answers page 0 with the meta and the sales, fingerprinted, no-store', async () => {
    const res = await get(page0);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toMatchObject({ ok: true, format: 'orbes-console/2', page: 0, pages: 1 });
    expect(Object.keys(body.meta).sort()).toEqual(['dbNow', 'extractedAt', 'format', 'models', 'rates', 'since', 'stock', 'tool', 'totalSales'].sort());
    expect(body.meta).toMatchObject({ format: 'orbes-console/2', since: SINCE, totalSales: 9, extractedAt: NOON.toISOString() });
    expect(body.sales).toHaveLength(9);
    for (const s of body.sales) expect(Object.keys(s).sort()).toEqual(SALE_FIELDS);
    // No account or order id leaves: only the catalogue's models (in `models`, `meta.models` and the stock) and the emails.
    const sales = JSON.stringify(body.sales.map(({ models: _m, email: _e, ...rest }: Record<string, unknown>) => rest));
    expect(sales).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('serves the next pages from the same snapshot, then forgets it after 10 minutes (410)', async () => {
    h.app.smartModelExport!.read = async () => fakeRaw(2_500);
    try {
      const first = (await get(page0)).json();
      expect(first.pages).toBe(3);
      const keys = first.sales.map((s: { key: string }) => s.key);
      for (const p of [1, 2]) {
        const res = await get(`${SMART_MODEL_EXPORT_ROUTE}?since=${SINCE}&page=${p}&snapshot=${first.snapshot}`);
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ ok: true, format: 'orbes-console/2', snapshot: first.snapshot, page: p, pages: 3 });
        expect(body.meta).toBeUndefined();
        keys.push(...body.sales.map((s: { key: string }) => s.key));
      }
      expect(keys).toHaveLength(first.meta.totalSales);
      expect(new Set(keys).size).toBe(2_500);
      const beyond = await get(`${SMART_MODEL_EXPORT_ROUTE}?since=${SINCE}&page=3&snapshot=${first.snapshot}`);
      expect([beyond.statusCode, beyond.json()]).toEqual([410, { ok: false, reason: 'snapshot' }]);
      h.clock.advance(SMART_MODEL_SNAPSHOT_MS);
      const expired = await get(`${SMART_MODEL_EXPORT_ROUTE}?since=${SINCE}&page=1&snapshot=${first.snapshot}`);
      expect([expired.statusCode, expired.json()]).toEqual([410, { ok: false, reason: 'snapshot' }]);
      const unknown = await get(`${SMART_MODEL_EXPORT_ROUTE}?since=${SINCE}&page=1&snapshot=nope`);
      expect(unknown.statusCode).toBe(410);
    } finally {
      h.clock.set(NOON);
      h.app.smartModelExport!.read = (since) => readSmartModel(h.ctx.db, since);
    }
  });

  it('refuses a malformed request (400)', async () => {
    for (const q of ['since=2027-02-30&page=0', 'page=0', `since=${SINCE}`, `since=${SINCE}&page=-1`, `since=${SINCE}&page=1`, `since=${SINCE}&page=0&snapshot=a%20b`]) {
      const res = await get(`${SMART_MODEL_EXPORT_ROUTE}?${q}`);
      expect([q, res.statusCode, res.json()]).toEqual([q, 400, { ok: false, reason: 'request' }]);
    }
  });

  it('refuses in the night, 04:00–06:30 Paris (503 night)', async () => {
    h.clock.set('2026-10-15T03:00:00.000Z'); // 05:00 Paris
    try {
      const res = await get(page0);
      expect([res.statusCode, res.json()]).toEqual([503, { ok: false, reason: 'night' }]);
    } finally {
      h.clock.set(NOON);
    }
  });

  it('refuses while a reading is in progress (503 busy)', async () => {
    let release!: (r: SmartModelRaw) => void;
    h.app.smartModelExport!.read = () => new Promise((r) => (release = r));
    try {
      const first = get(page0);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const res = await get(page0);
      expect([res.statusCode, res.json()]).toEqual([503, { ok: false, reason: 'busy' }]);
      release(fakeRaw(1));
      expect((await first).statusCode).toBe(200);
    } finally {
      h.app.smartModelExport!.read = (since) => readSmartModel(h.ctx.db, since);
    }
  });

  it('refuses during a LIVE release (503 live)', async () => {
    h.app.smartModelExport!.read = async () => {
      throw new SmartModelExportError('live');
    };
    try {
      const res = await get(page0);
      expect([res.statusCode, res.json()]).toEqual([503, { ok: false, reason: 'live' }]);
    } finally {
      h.app.smartModelExport!.read = (since) => readSmartModel(h.ctx.db, since);
    }
  });

  it('401 without the token or with a wrong one; 429 for an hour after 10 from one network, whatever it sends', async () => {
    const ip = '203.0.113.9';
    for (const t of [null, 'wrong', `${TOKEN}x`]) {
      const res = await get(page0, t, ip);
      expect([res.statusCode, res.json()]).toEqual([401, { ok: false, reason: 'token' }]);
    }
    const lower = await h.app.inject({ method: 'GET', url: page0, remoteAddress: ip, headers: { authorization: `bearer ${TOKEN}` } });
    expect(lower.statusCode).toBe(401);
    for (let i = 4; i < SMART_MODEL_FAILURES_MAX; i += 1) expect((await get(page0, 'wrong', ip)).statusCode).toBe(401);
    const paused = await get(page0, TOKEN, ip);
    expect([paused.statusCode, paused.json()]).toEqual([429, { ok: false, reason: 'paused' }]);
    // Another network is not held.
    expect((await get(page0)).statusCode).toBe(200);
    h.clock.advance(SMART_MODEL_PAUSE_MS);
    try {
      expect((await get(page0, TOKEN, ip)).statusCode).toBe(200);
    } finally {
      h.clock.set(NOON);
    }
  });

  it('never logs the token', () => {
    expect(logged.some((l) => l.includes('wrong token'))).toBe(true);
    expect(logged.join('\n')).not.toContain(TOKEN);
    expect(logged.join('\n')).not.toContain(TOKEN_SHA256);
  });
});
