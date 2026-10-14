/**
 * The Collectors page over HTTP (plan CUSTOMER INTELLIGENCE §3.6 C.6, C.9, C.13 « admin-collectors.test.ts »; steps 9.2
 * and on; API §16.37; routes/admin/collectors.ts):
 *
 *  - GET /api/admin/collectors/options and /report: AUDITOR, OPERATOR and ADMIN read; RETAIL and LOGISTICS get 403
 *    FORBIDDEN before any validation; no session 401;
 *  - the query: unknown keys refused, the panel, the period, the scope, the five filters and the currency checked (400
 *    VALIDATION_FAILED, CUSTOM's dates in the page's words);
 *  - the report's head and figures; no email, no account id and no name in a panel's JSON; an AUDITOR reads the same
 *    figures as an ADMIN (the cache holds figures only, shared by the roles);
 *  - GET /api/admin/collectors/list (step 9.8): by role, 50 a page ordered by email for every slice, `score` and
 *    `part` included, no score in a row; an AUDITOR reads the emails masked and no city; the slice and the page checked.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedScore } from '../support/scores.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('GET /api/admin/collectors/… (§3.6 C.9)', () => {
  let h: Harness;
  const clients = {} as Record<'RETAIL' | 'LOGISTICS' | 'AUDITOR' | 'OPERATOR' | 'ADMIN', Client>;
  const emails: string[] = [];
  const ids: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-14T10:00:00Z');
    for (const role of ['RETAIL', 'LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const) clients[role] = await adminClient(h, role);
    for (let i = 0; i < 4; i++) {
      const email = `collector-${i}-${randomUUID().slice(0, 6)}@example.com`;
      emails.push(email);
      const id = (
        await h.t.db
          .insertInto('accounts')
          .values({ email, email_normalized: email, password_hash: 'x', display_name: `Collector Number${i}`, country: i % 2 ? 'IT' : 'FR', created_at: new Date(`2026-10-0${i + 1}T10:00:00Z`) })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      ids.push(id);
      await h.t.db.insertInto('account_profiles').values({ account_id: id, city: i ? 'Lyon' : 'Paris', birth_date: '1990-01-0' + (i + 1), birth_date_by: 'COLLECTOR', birth_date_at: new Date('2026-10-01T00:00:00Z') }).execute();
    }
  }, 60_000);
  afterAll(() => h?.close());

  const get = async (role: keyof typeof clients, url: string, status = 200): Promise<any> => {
    const res = await clients[role].get(url);
    expect(res.statusCode, `${role} ${url} → ${res.body.slice(0, 200)}`).toBe(status);
    return safeJson(res);
  };

  it('AUDITOR, OPERATOR and ADMIN read; RETAIL and LOGISTICS get 403; no session 401', async () => {
    for (const url of ['/api/admin/collectors/options', '/api/admin/collectors/report?panel=overview', '/api/admin/collectors/report?panel=who', '/api/admin/collectors/report?panel=origin', '/api/admin/collectors/report?panel=likes', '/api/admin/collectors/report?panel=devices', '/api/admin/collectors/report?panel=engagement', '/api/admin/collectors/report?panel=trends&figure=active&split=country']) {
      for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) await get(role, url);
      for (const role of ['RETAIL', 'LOGISTICS'] as const) expect(errorOf(await clients[role].get(url)).code, `${role} ${url}`).toBe('FORBIDDEN');
      expect((await h.client().get(url)).statusCode).toBe(401);
    }
    // Forbidden before any validation.
    expect((await clients.RETAIL.get('/api/admin/collectors/report?panel=nothing&x=1')).statusCode).toBe(403);
  });

  it('the report: its head and its figures, the same for an AUDITOR as for an ADMIN, with no email, id or name', async () => {
    const r = await get('AUDITOR', '/api/admin/collectors/report?panel=who&p=7d&scope=new&c=FR,IT');
    expect(r).toMatchObject({
      panel: 'who',
      period: { key: '7d', from: '2026-10-08', to: '2026-10-14', days: 7 },
      previous: { from: '2026-10-01', to: '2026-10-07' },
      scope: 'new',
      compareBy: 'SCOPE',
    });
    expect(r.figures.total).toBe(0);
    const all = await get('AUDITOR', '/api/admin/collectors/report?panel=who&p=30d&cmp=0');
    expect(all.previous).toBeNull();
    expect(all.figures.total).toBe(4);
    expect(all.figures.countries.given).toEqual([
      { key: 'FR', collectors: 2, compare: null },
      { key: 'IT', collectors: 2, compare: null },
    ]);
    expect(all.figures.cities.given.rows.map((c: { label: string; collectors: number }) => [c.label, c.collectors])).toEqual([
      ['Lyon', 3],
      ['Paris', 1],
    ]);
    // An AUDITOR and an ADMIN read the same figures (no city or email is masked in a figure; none names a person).
    expect((await get('ADMIN', '/api/admin/collectors/report?panel=who&p=30d&cmp=0')).figures).toEqual(all.figures);
    const text = JSON.stringify([
      all,
      await get('ADMIN', '/api/admin/collectors/report?panel=overview'),
      await get('AUDITOR', '/api/admin/collectors/report?panel=origin'),
      await get('AUDITOR', '/api/admin/collectors/report?panel=likes'),
      await get('AUDITOR', '/api/admin/collectors/report?panel=devices'),
      await get('AUDITOR', '/api/admin/collectors/report?panel=engagement'),
      await get('AUDITOR', '/api/admin/collectors/report?panel=trends&split=age'),
    ]);
    for (const e of emails) expect(text).not.toContain(e);
    for (const id of ids) expect(text).not.toContain(id);
    expect(text).not.toContain('Number');
    const o = await get('OPERATOR', '/api/admin/collectors/options');
    expect(o).toMatchObject({ countries: ['FR', 'IT'], sourceKinds: ['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'], tiers: [0, 1, 2, 3], snapshotsSince: null });
  });

  it('refuses unknown keys and bad values: 400 VALIDATION_FAILED', async () => {
    for (const url of [
      '/api/admin/collectors/options?p=7d',
      '/api/admin/collectors/report',
      '/api/admin/collectors/report?panel=overview&page=2',
      '/api/admin/collectors/report?panel=overview&slice=all',
      '/api/admin/collectors/report?panel=nothing',
      '/api/admin/collectors/report?panel=overview&p=14d',
      '/api/admin/collectors/report?panel=overview&scope=everyone',
      '/api/admin/collectors/report?panel=overview&cmp=maybe',
      '/api/admin/collectors/report?panel=overview&currency=JPY',
      '/api/admin/collectors/report?panel=overview&c=FRA',
      '/api/admin/collectors/report?panel=overview&s=instagram',
      '/api/admin/collectors/report?panel=overview&t=5',
      '/api/admin/collectors/report?panel=overview&sc=90-10',
      '/api/admin/collectors/report?panel=overview&p=custom&from=2026-13-01&to=2026-10-01',
      '/api/admin/collectors/report?panel=trends&figure=revenue',
      '/api/admin/collectors/report?panel=trends&split=city',
      `/api/admin/collectors/report?panel=trends&figure=${'x'.repeat(21)}`,
    ]) {
      const res = await clients.AUDITOR.get(url);
      expect(res.statusCode, `${url} → ${res.body.slice(0, 200)}`).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    const custom = await clients.AUDITOR.get('/api/admin/collectors/report?panel=overview&p=custom&from=2025-12-01&to=2026-01-31');
    expect(errorOf(custom)).toEqual({ code: 'VALIDATION_FAILED', message: 'Choose dates from 1 Jan 2026 to today, at most two years apart.' });
    expect((await get('AUDITOR', '/api/admin/collectors/report?panel=overview&p=custom&from=2026-01-01&to=2026-10-14')).period).toEqual({ key: 'custom', from: '2026-01-01', to: '2026-10-14', days: 287 });
  });

  it('GET /api/admin/collectors/list: ordered by email, no score; an AUDITOR reads the emails masked and no city', async () => {
    await seedScore(h.t.db, ids[1]!, 55, new Date('2026-10-14T07:00:00Z'));
    await seedScore(h.t.db, ids[2]!, 57, new Date('2026-10-14T07:00:00Z'));
    const url = '/api/admin/collectors/list?slice=all&p=30d';
    for (const role of ['RETAIL', 'LOGISTICS'] as const) expect(errorOf(await clients[role].get(url)).code, role).toBe('FORBIDDEN');
    expect((await h.client().get(url)).statusCode).toBe(401);
    const admin = await get('ADMIN', url);
    expect(admin).toMatchObject({ slice: 'all', subject: null, total: 4, page: 1, pageSize: 50, scope: 'all', period: { key: '30d', to: '2026-10-14' } });
    expect(admin.rows.map((r: { email: string }) => r.email)).toEqual([...emails].sort());
    expect(admin.rows.map((r: { city: string }) => r.city).sort()).toEqual(['Lyon', 'Lyon', 'Lyon', 'Paris']);
    expect(admin.rows[0]).toMatchObject({ accountId: ids[0], name: 'Collector Number0', country: 'FR', tier: 0, lastSeenAt: null });
    expect((await get('OPERATOR', url)).rows).toEqual(admin.rows);
    const auditor = await get('AUDITOR', url);
    expect(auditor.rows.map((r: { accountId: string }) => r.accountId)).toEqual(admin.rows.map((r: { accountId: string }) => r.accountId));
    for (const r of auditor.rows) {
      expect(r.email).toMatch(/^c\*\*\*@example\.com$/);
      expect(r.city).toBeNull();
    }
    for (const e of emails) expect(JSON.stringify(auditor)).not.toContain(e);
    // Every slice is ordered by email, the score's and the parts' too, and no row carries a score.
    for (const slice of ['scored', 'score:50-59', 'part:recency', 'country:FR', 'age:35-44']) {
      const list = await get('AUDITOR', `/api/admin/collectors/list?slice=${encodeURIComponent(slice)}`);
      const rows = list.rows as { accountId: string }[];
      expect(rows.map((r) => ids.indexOf(r.accountId)), slice).toEqual(rows.map((r) => ids.indexOf(r.accountId)).sort());
      for (const r of rows) expect(Object.keys(r).sort(), slice).toEqual(['accountId', 'city', 'country', 'createdAt', 'email', 'lastSeenAt', 'name', 'tier']);
      for (const r of rows) expect(Object.values(r), slice).not.toEqual(expect.arrayContaining([55]));
      for (const r of rows) expect(Object.values(r), slice).not.toEqual(expect.arrayContaining([57]));
    }
    expect((await get('AUDITOR', '/api/admin/collectors/list?slice=score:50-59')).total).toBe(2);
    expect((await get('AUDITOR', '/api/admin/collectors/list?slice=part:recency')).total).toBe(2);
    expect((await get('ADMIN', '/api/admin/collectors/list?slice=all&page=2')).rows).toEqual([]);
    // The query, the slice and the page checked: 400 VALIDATION_FAILED.
    for (const bad of ['', '?slice=all&panel=overview', '?slice=everyone', '?slice=all&page=0', '?slice=all&page=x', '?slice=score:5-9', '?slice=all&fresh=1', `?slice=${'a'.repeat(301)}`]) {
      const res = await clients.AUDITOR.get(`/api/admin/collectors/list${bad}`);
      expect(res.statusCode, `${bad} → ${res.body.slice(0, 200)}`).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
  });
});
