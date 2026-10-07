/**
 * GROWTH over HTTP (plan NEXT-NINE, §3.9 BP-29, step 9.1; API §16.31; routes/admin/growth.ts), on the fourteen months
 * of test/support/growth.ts:
 *
 *  - GET /api/admin/growth: its shape, the last 12 months and the most invoiced currency by default, 24 months on
 *    request, 400 VALIDATION_FAILED for another window or currency; its JSON names no account (no id, email or name);
 *  - GET /api/admin/growth/collectors: the accounts, their emails masked for an AUDITOR and in clear for OPERATOR and
 *    ADMIN; GET /api/admin/growth/releases;
 *  - AUDITOR and up read, RETAIL gets 403;
 *  - the scan days not counted yet are counted first; a count that fails is logged and the report still answers.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createForwardingLogger, loggerOptions } from '../../src/server/http/logging.js';
import { GROWTH_NOW, seedGrowth, type GrowthFixture } from '../support/growth.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('GET /api/admin/growth', () => {
  let h: Harness;
  let f: GrowthFixture;
  const clients = {} as Record<'RETAIL' | 'AUDITOR' | 'OPERATOR' | 'ADMIN', Client>;
  const lines: string[] = [];
  const sink = { write: (s: string) => lines.push(s) };

  const get = async (role: keyof typeof clients, url: string, status = 200): Promise<any> => {
    const res = await clients[role].get(url);
    expect(res.statusCode, `${role} ${url} → ${res.body.slice(0, 200)}`).toBe(status);
    return safeJson(res);
  };

  beforeAll(async () => {
    const log = createForwardingLogger(sink);
    h = await createHarness({ app: { logger: { ...(loggerOptions({ logLevel: 'info' }) as object), stream: sink } }, context: { log } });
    log.attach(h.app.log);
    h.clock.set(GROWTH_NOW.toISOString());
    f = await seedGrowth(h.ctx.db);
    for (const role of ['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const) clients[role] = await adminClient(h, role);
  }, 60_000);
  afterAll(() => h?.close());

  it('gives an AUDITOR the report: the window, lifetime value, repeat buying, the funnel and the revenue', async () => {
    const r = await get('AUDITOR', '/api/admin/growth');
    expect(Object.keys(r)).toEqual(['window', 'ltv', 'repeat', 'funnel', 'revenue']);
    expect(r.window).toMatchObject({ months: 12, from: '2025-11', to: '2026-10', currency: 'EUR', currencies: ['EUR', 'GBP'] });
    expect(Object.keys(r.ltv)).toEqual(['perCollector', 'unpricedPieces', 'byTier', 'byCountry', 'byFirstModel', 'byChannel']);
    expect(r.ltv.perCollector).toEqual({ collectors: 7, totalMinor: 2_715_000, averageMinor: 387_857, medianMinor: 240_000, topTenthFromMinor: 960_000 });
    expect(Object.keys(r.repeat)).toEqual(['collectors', 'withSecond', 'rate', 'medianDays', 'buckets', 'cohorts']);
    expect(r.funnel.totals).toEqual({ scans: 100, accounts: 9, owners: 4, buyers: 5, platine: 1, palladium: 1 });
    expect(r.funnel.thresholds).toEqual([1, 5, 10]);
    expect(r.revenue.total).toEqual({ orders: 9, invoicedMinor: 2_115_000, creditedMinor: 600_000, netMinor: 1_515_000 });
    expect(r.revenue.months).toHaveLength(12);
    // 24 months, and another currency.
    expect((await get('AUDITOR', '/api/admin/growth?months=24')).window).toMatchObject({ months: 24, from: '2024-11' });
    const gbp = await get('AUDITOR', '/api/admin/growth?currency=GBP');
    expect(gbp.window.currency).toBe('GBP');
    expect(gbp.revenue.total.netMinor).toBe(100_000);
  });

  it('refuses another window or currency: 400 VALIDATION_FAILED', async () => {
    for (const url of ['/api/admin/growth?months=6', '/api/admin/growth?months=twelve', '/api/admin/growth?currency=JPY', '/api/admin/growth?currency=eur', '/api/admin/growth/collectors?page=0', '/api/admin/growth/collectors?page=x', '/api/admin/growth/collectors?currency=XXX']) {
      const res = await clients.AUDITOR.get(url);
      expect(res.statusCode, url).toBe(400);
      expect(errorOf(res).code, url).toBe('VALIDATION_FAILED');
    }
  });

  it('names no account in the report: no id, email or name', async () => {
    const body = (await clients.ADMIN.get('/api/admin/growth')).body;
    for (const id of Object.values(f.accounts)) expect(body).not.toContain(id);
    expect(body).not.toMatch(/@example\.com|accountId|email|displayName/);
  });

  it('COLLECTORS BY VALUE: the emails masked for an AUDITOR, in clear for OPERATOR and ADMIN', async () => {
    const emails = new Map((await h.ctx.db.selectFrom('accounts').select(['id', 'email']).execute()).map((a) => [a.id, a.email]));
    const masked = await get('AUDITOR', '/api/admin/growth/collectors');
    expect(masked).toMatchObject({ currency: 'EUR', currencies: ['EUR', 'GBP'], page: 1, pageSize: 25, total: 7 });
    expect(masked.items[0]).toMatchObject({ accountId: f.accounts.A2, tier: 'TITANE', country: 'FR', pieces: 2, valueMinor: 960_000, firstPieceAt: '2025-11-20T12:00:00.000Z' });
    for (const c of masked.items) {
      expect(c.email, c.accountId).toMatch(/^[^@*]\*\*\*@example\.com$/);
      expect(c.email).not.toBe(emails.get(c.accountId));
    }
    for (const role of ['OPERATOR', 'ADMIN'] as const) {
      const plain = await get(role, '/api/admin/growth/collectors?currency=EUR&page=1');
      expect(plain.items.map((c: any) => c.accountId)).toEqual(masked.items.map((c: any) => c.accountId));
      for (const c of plain.items) expect(c.email, `${role} ${c.accountId}`).toBe(emails.get(c.accountId));
    }
    expect((await get('AUDITOR', '/api/admin/growth/collectors?page=2')).items).toEqual([]);
  });

  it('Latest releases: the past ones, the latest first', async () => {
    const r = await get('AUDITOR', '/api/admin/growth/releases');
    expect(r.items.map((x: any) => x.id)).toEqual([f.releases.D2, f.releases.D1, f.releases.L1]);
    expect(r.items[2]).toMatchObject({ mode: 'LIVE', pieces: 3, sold: 1, sellOutMs: null, entries: null });
  });

  it('RETAIL gets 403 on every route; AUDITOR, OPERATOR and ADMIN read', async () => {
    for (const url of ['/api/admin/growth', '/api/admin/growth/collectors', '/api/admin/growth/releases']) {
      const res = await clients.RETAIL.get(url);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('FORBIDDEN');
      for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) expect((await clients[role].get(url)).statusCode, `${role} ${url}`).toBe(200);
    }
  });

  it('the client sheet carries the lifetime value, as COLLECTORS BY VALUE counts it', async () => {
    const sheet = await get('AUDITOR', `/api/admin/owners/${f.accounts.A1}`);
    expect(sheet.lifetimeValue).toEqual([{ currency: 'EUR', valueMinor: 605_000 }]);
    expect((await get('AUDITOR', `/api/admin/owners/${f.accounts.A9}`)).lifetimeValue).toEqual([]);
  });

  it('counts the scan days not counted yet first; a count that fails is logged and the report still answers', async () => {
    // Yesterday's scans, not counted yet: the report counts them before it reads.
    await h.ctx.db.insertInto('scan_events').values({ occurred_at: new Date('2026-10-14T09:00:00.000Z'), event_type: 'VERIFY', result_state: 'AUTHENTIC', country: 'FR' }).execute();
    const counted = await get('AUDITOR', '/api/admin/growth');
    expect(counted.funnel.months[0]).toMatchObject({ month: '2026-10', counts: { scans: 1 } });
    // A count that fails (a constraint every new day breaks): logged, and the report answers with the days counted.
    await h.ctx.db.insertInto('scan_events').values({ occurred_at: new Date('2026-10-15T09:00:00.000Z'), event_type: 'VERIFY', result_state: 'AUTHENTIC', country: 'FR' }).execute();
    h.clock.set('2026-10-16T12:00:00.000Z');
    await sql`ALTER TABLE scan_daily_stats ADD CONSTRAINT growth_test_refuses CHECK (n < 0) NOT VALID`.execute(h.ctx.db);
    try {
      clients.AUDITOR = await adminClient(h, 'AUDITOR'); // a session of the day after
      lines.length = 0;
      const r = await get('AUDITOR', '/api/admin/growth');
      expect(r.funnel.months[0].counts.scans).toBe(1);
      expect(lines.some((l) => l.includes('scan statistics could not be counted before the growth report'))).toBe(true);
    } finally {
      await sql`ALTER TABLE scan_daily_stats DROP CONSTRAINT growth_test_refuses`.execute(h.ctx.db);
      h.clock.set(GROWTH_NOW.toISOString());
    }
  });
});
