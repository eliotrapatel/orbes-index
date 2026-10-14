/**
 * What they like (plan CUSTOMER INTELLIGENCE §3.2 W.8, §3.6 C.6.3 item 4, C.13; step 9.4; services/likes.ts), on a small
 * house whose every figure is counted here by hand. Today is 14 October 2026 (12:00 Paris); LAST 30 DAYS runs from 15
 * September to 14 October, the previous period from 16 August to 14 September.
 *
 *   MONOLITHE (main, « Silver », in ORBITAL, shown), its dots Blue (shown) and Steel (discontinued), ORBITE (hidden,
 *   no collection).
 *   A   wishes Blue (2 Oct) and Steel (3 Oct); favourite piece RING and finish BLUE (1 Oct); 2 pieces of Blue; views.
 *   B   wishes Blue (1 Sep); favourite piece RING (1 Sep); 1 piece of MONOLITHE; a view of Blue.
 *   C   wished MONOLITHE from 20 Sep to 5 Oct; favourite piece CUFF (5 Oct), which the collection does not offer; a view
 *       of Steel; a piece held until 1 Oct.
 *   D   wishes ORBITE (10 Oct); a piece of ORBITE since revoked.
 *   L   a LOCKED account (counted): wished Steel from 20 Aug to 10 Sep.
 *   T, H, X  a test entrant, one of the team's own accounts and a DELETED account: each wishes Blue, likes RING, holds
 *       Blue and looks at it, in no figure.
 *
 * "Open at T" (W.8: `added_at <= T AND (removed_at IS NULL OR removed_at > T)`, T the period's last moment) is read with
 * the period's exclusive end, `end`, the first instant after its last Paris day: a wish is open at the end when it was
 * added before `end` and not removed before `end`, so a removal at `end` exactly falls in the next period (the wish is
 * still open) and an addition at `end` exactly too (the wish is neither open nor added). The second block pins it at
 * the end of the period and of the previous one, the rule the slices `haswish`, `wishmodel` and `wishcollection` follow.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { parisPeriod, previousPeriod, type Period } from '../../src/server/services/insights-scope.js';
import { LIKES_MIN_GROUP, tasteFilter, type AccountFilter, type LikesWindow, type WishedModelRow } from '../../src/server/services/likes.js';
import { wishHistoryCutoff } from '../../src/server/services/wishlist.js';
import { GrowthWorld } from '../support/growth.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';

const NOW = new Date('2026-10-14T10:00:00.000Z');
const z = (iso: string) => new Date(iso);
const windowOf = (p: Period, previous: Period | null): LikesWindow => ({ from: p.from, to: p.to, start: p.start, end: p.end, previous: previous ? { from: previous.from, to: previous.to, start: previous.start, end: previous.end } : null });

describe('LikesService (§3.2 W.8, §3.6 C.6.3 item 4; step 9.4)', () => {
  let h: Harness;
  let w: GrowthWorld;
  const acc: Record<string, string> = {};
  const m: Record<string, string> = {};
  let orbital = '';
  let drop = '';
  const P30 = parisPeriod({ p: '30d' }, NOW);
  const B30 = previousPeriod(P30);
  const likes = (window: LikesWindow, population?: AccountFilter, countries?: string[]) => h.ctx.services.likes.likes(window, population, { countries });

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    const db = h.t.db;
    w = await new GrowthWorld(db).prepare();
    orbital = (await db.insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;
    const model = async (key: string, o: { name: string; type?: string; label?: string; swatch?: string; variantOf?: string; collection?: string | null; shown?: boolean; discontinued?: boolean }) => {
      const id = randomUUID();
      const slug = o.shown === false ? null : `likes-${id.slice(0, 8)}`;
      await db
        .insertInto('models')
        .values({
          id,
          category_id: 1,
          name: o.name,
          type: o.type ?? 'RING',
          sku_prefix: `L-${id.slice(0, 8)}`,
          collection_id: o.collection ?? null,
          slug,
          lookbook: slug === null ? 'HIDDEN' : 'PUBLIC',
          published_at: slug === null ? null : z('2026-01-01T00:00:00Z'),
          active: !o.discontinued,
          discontinued_at: o.discontinued ? z('2026-06-01T00:00:00Z') : null,
          variant_of: o.variantOf ?? null,
          variant_label: o.label ?? null,
          variant_swatch: o.label ? (o.swatch ?? '#888888') : null,
        })
        .execute();
      m[key] = id;
      return id;
    };
    await model('MONO', { name: 'MONOLITHE', label: 'Silver', swatch: '#C0C0C0', collection: orbital });
    await model('BLUE', { name: 'MONOLITHE', label: 'Blue', swatch: '#1F3A93', variantOf: m.MONO, collection: orbital });
    await model('STEEL', { name: 'MONOLITHE', label: 'Steel', variantOf: m.MONO, collection: orbital, discontinued: true });
    await model('ORBITE', { name: 'ORBITE', type: 'CUFF', shown: false });
    const team = await createAdmin(h.ctx, 'AUDITOR');
    for (const key of ['A', 'B', 'C', 'D', 'L', 'T', 'H', 'X']) {
      const email = key === 'H' ? team.email : `likes-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
      acc[key] = (
        await db
          .insertInto('accounts')
          .values({ email, email_normalized: email.toLowerCase(), password_hash: 'x', country: key === 'B' ? 'IT' : 'FR', status: key === 'L' ? 'LOCKED' : 'ACTIVE', created_at: z('2026-06-01T10:00:00Z') })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    await db.insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    const wish = (who: string, model: string, added: string, removed: string | null = null) =>
      db.insertInto('account_wishes').values({ account_id: acc[who]!, model_id: m[model]!, added_at: z(added), removed_at: removed ? z(removed) : null }).execute();
    await wish('A', 'BLUE', '2026-10-02T10:00:00Z');
    await wish('A', 'STEEL', '2026-10-03T10:00:00Z');
    await wish('B', 'BLUE', '2026-09-01T10:00:00Z');
    await wish('C', 'MONO', '2026-09-20T10:00:00Z', '2026-10-05T10:00:00Z');
    await wish('D', 'ORBITE', '2026-10-10T10:00:00Z');
    await wish('L', 'STEEL', '2026-08-20T10:00:00Z', '2026-09-10T10:00:00Z');
    for (const who of ['T', 'H', 'X']) await wish(who, 'BLUE', '2026-10-01T10:00:00Z');
    const taste = (who: string, kind: 'PIECE' | 'FINISH', key: string, label: string, at: string) =>
      db.insertInto('account_tastes').values({ account_id: acc[who]!, kind, value_key: key, label, created_at: z(at) }).execute();
    await taste('A', 'PIECE', 'RING', 'RING', '2026-10-01T10:00:00Z');
    await taste('A', 'FINISH', 'BLUE', 'Blue', '2026-10-01T10:00:00Z');
    await taste('B', 'PIECE', 'RING', 'RING', '2026-09-01T10:00:00Z');
    await taste('C', 'PIECE', 'CUFF', 'Cuff', '2026-10-05T10:00:00Z');
    for (const who of ['T', 'H', 'X']) await taste(who, 'PIECE', 'RING', 'RING', '2026-10-01T10:00:00Z');
    // Pieces held now.
    const hold = async (who: string, model: string, ended?: string) => w.own(acc[who]!, await w.piece(m[model]!), 'FIRST_REGISTRATION', '2026-07-01', ended);
    await hold('A', 'BLUE');
    await hold('A', 'BLUE');
    await hold('B', 'MONO');
    await hold('C', 'MONO', '2026-10-01');
    for (const who of ['T', 'H', 'X']) await hold(who, 'BLUE');
    await hold('D', 'ORBITE');
    await db.updateTable('products').set({ status: 'REVOKED' }).where('model_id', '=', m.ORBITE!).execute();
    // Views: A 2 of Blue (30 s, 50 s) and 1 of MONOLITHE (20 s) and 1 of a release (15 s); B 1 of Blue (40 s); C 1 of
    // Steel (10 s); a view of Blue before the period; T and an anonymous visitor 1 of Blue each.
    drop = (await w.drop({ mode: 'DRAW', modelId: m.MONO!, title: 'MONOLITHE BLUE', opens: '2026-10-01', quantity: 10 })).id;
    const device = (await db.insertInto('tracking_devices').values({ device_hash: `likes${'d'.repeat(38)}`, first_seen_at: z('2026-09-01T10:00:00Z'), last_seen_at: z('2026-10-10T10:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    const view = (who: string | null, page: number, subject: string, seconds: number, at = '2026-10-10T10:00:00Z') =>
      db.insertInto('collector_views').values({ at: z(at), device_id: device, account_id: who ? acc[who]! : null, page, subject, seconds, place_id: null }).execute();
    await view('A', VIEW_PAGE_CODES.MODEL, m.BLUE!, 30);
    await view('A', VIEW_PAGE_CODES.MODEL, m.BLUE!, 50);
    await view('A', VIEW_PAGE_CODES.MODEL, m.MONO!, 20);
    await view('A', VIEW_PAGE_CODES.RELEASE, drop, 15);
    await view('B', VIEW_PAGE_CODES.MODEL, m.BLUE!, 40);
    await view('C', VIEW_PAGE_CODES.MODEL, m.STEEL!, 10);
    await view('B', VIEW_PAGE_CODES.MODEL, m.BLUE!, 900, '2026-09-10T10:00:00Z');
    await view('T', VIEW_PAGE_CODES.MODEL, m.BLUE!, 99);
    await view(null, VIEW_PAGE_CODES.MODEL, m.BLUE!, 77);
    // Every visitor's daily totals (kept for good).
    const daily = (day: string, subject: string, country: string, views: number, seconds: number, devices: number) =>
      db.insertInto('view_daily_stats').values({ day, page: VIEW_PAGE_CODES.MODEL, subject, country, views, seconds, devices, signed_in_views: 0 }).execute();
    await daily('2026-10-10', m.BLUE!, 'FR', 7, 300, 4);
    await daily('2026-10-10', m.MONO!, 'FR', 2, 60, 2);
    await daily('2026-10-11', m.BLUE!, 'IT', 1, 10, 1);
    await daily('2026-09-01', m.BLUE!, 'FR', 50, 5000, 30);
    // Every visitor's devices a day (What they look at's Visitors), and a page with no model (NOW).
    const devices = (day: string, country: string, n: number) =>
      db.insertInto('device_daily_stats').values({ day, country, kind: 'PHONE', os: 'IOS', browser: 'SAFARI', opened_in: 'BROWSER', in_app: 'NONE', devices: n, new_devices: 0, signed_in_devices: 0 }).execute();
    await devices('2026-10-10', 'FR', 5);
    await devices('2026-10-11', 'IT', 1);
    await devices('2026-09-01', 'FR', 30);
    await db.insertInto('view_daily_stats').values({ day: '2026-10-11', page: VIEW_PAGE_CODES.NOW, subject: '00000000-0000-0000-0000-000000000000', country: 'FR', views: 3, seconds: 130, devices: 2, signed_in_views: 0 }).execute();
    await db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', acc.X!).execute();
  }, 120_000);
  afterAll(() => h?.close());

  it('wishlists: the collectors with a wish open at the end and their share, the wishes added and removed, and the same for the previous period', async () => {
    const f = await likes(windowOf(P30, B30));
    expect(f.raw).toBe(true);
    expect(f.total).toBe(5); // A, B, C, D and the LOCKED L
    // Open at the end: A, B, D; added: A ×2, C, D; removed: C. Before: B open; B and L added; L removed.
    expect(f.wishlists).toEqual({ collectors: 3, share: 60, added: 4, removed: 1, previous: { collectors: 1, added: 2, removed: 1 } });
    const off = await likes(windowOf(P30, null));
    expect(off.wishlists.previous).toBeNull();
  });

  it('most wished: by main model, a main row counting each collector once over its dots, each variant its own; added in the period; open at the previous end; the state of each', async () => {
    const f = await likes(windowOf(P30, B30));
    const pick = (r: WishedModelRow) => [r.name, r.variant, r.state, r.wished, r.added, r.previous];
    expect(f.mostWished.groups).toBe(2);
    expect(f.mostWished.rows.map(pick)).toEqual([
      ['MONOLITHE', 'Silver', 'SHOWN', 2, 3, 1], // A (twice), B; added A ×2 and C; before B (L's wish was removed)
      ['ORBITE', null, 'HIDDEN', 1, 1, 0],
    ]);
    expect(f.mostWished.rows[0]!).toMatchObject({ modelId: m.MONO, type: 'RING', collection: 'ORBITAL' });
    expect(f.mostWished.rows[0]!.variants.map(pick)).toEqual([
      ['MONOLITHE', 'Blue', 'SHOWN', 2, 1, 1],
      ['MONOLITHE', 'Steel', 'DISCONTINUED', 1, 1, 0],
    ]);
    expect(f.mostWished.rows[1]!.variants).toEqual([]);
    // Collections: the distinct collectors wishing a model of ORBITAL, at the end and at the previous end.
    expect(f.collections).toEqual({ rows: [{ collectionId: orbital, name: 'ORBITAL', collectors: 2, previous: 1 }], groups: 1 });
  });

  it('favourite pieces and finishes: collectors, chosen in the period, chosen in the previous one; a choice no longer offered marked retired; None chosen', async () => {
    const f = await likes(windowOf(P30, B30));
    expect(f.pieces).toEqual({
      rows: [
        { key: 'RING', label: 'RING', retired: false, collectors: 2, chosen: 1, previous: 1 },
        { key: 'CUFF', label: 'Cuff', retired: true, collectors: 1, chosen: 1, previous: 0 },
      ],
      none: 2, // D and L
    });
    expect(f.finishes).toEqual({ rows: [{ key: 'BLUE', label: 'Blue', swatch: '#1F3A93', retired: false, collectors: 1, chosen: 1, previous: 0 }], none: 4 });
  });

  it('most viewed by the collectors: by main model with its dots, the collectors who looked, views, time and the median per collector (withheld under 3), the releases; within the period only', async () => {
    const f = await likes(windowOf(P30, B30));
    const v = f.viewed.collectors;
    expect(v.reachesBackTo).toBeNull();
    expect(LIKES_MIN_GROUP).toBe(3);
    // MONOLITHE: A 100 s, B 40 s, C 10 s → median 40; B's view of 10 Sep is before the period; T and the anonymous view are no collector's.
    expect(v.models).toEqual([
      {
        modelId: m.MONO,
        name: 'MONOLITHE',
        variant: 'Silver',
        collectors: 3,
        views: 5,
        seconds: 150,
        medianSeconds: 40,
        visitors: null,
        variants: [
          { modelId: m.BLUE, name: 'MONOLITHE', variant: 'Blue', collectors: 2, views: 3, seconds: 120, medianSeconds: null, visitors: null },
          { modelId: m.STEEL, name: 'MONOLITHE', variant: 'Steel', collectors: 1, views: 1, seconds: 10, medianSeconds: null, visitors: null },
        ],
      },
    ]);
    expect(v.releases).toEqual([{ dropId: drop, title: 'MONOLITHE BLUE', collectors: 1, views: 1, seconds: 15, medianSeconds: null, visitors: null }]);
    // Twelve months back reach past the 13 months kept: read from the first day kept, which the answer names.
    const custom = await likes(windowOf(parisPeriod({ p: 'custom', from: '2026-01-01', to: '2026-10-14' }, NOW), null));
    expect(custom.viewed.collectors.reachesBackTo).toBeNull();
    const before = await h.ctx.services.likes.likes(windowOf({ ...P30, from: '2025-06-01', start: z('2025-05-31T22:00:00Z') }, null));
    expect(before.viewed.collectors.reachesBackTo).toBe('2025-09-14');
    expect(before.viewed.collectors.models[0]!.views).toBe(6); // B's view of 10 Sep counted now
  });

  it('most viewed by every visitor: the daily totals by main model with its dots (devices a day), only the countries applying', async () => {
    const f = await likes(windowOf(P30, B30));
    expect(f.viewed.visitors.models).toEqual([
      {
        modelId: m.MONO,
        name: 'MONOLITHE',
        variant: 'Silver',
        collectors: null,
        views: 10,
        seconds: 370,
        medianSeconds: null,
        visitors: 7,
        variants: [{ modelId: m.BLUE, name: 'MONOLITHE', variant: 'Blue', collectors: null, views: 8, seconds: 310, medianSeconds: null, visitors: 5 }],
      },
    ]);
    const it = await likes(windowOf(P30, B30), undefined, ['IT']);
    expect(it.viewed.visitors.models.map((r) => [r.views, r.variants.map((v) => v.views)])).toEqual([[1, [1]]]);
  });

  it('what they look at under ALL VISITORS (§3.3 T.4.2): Views, Time spent, Visitors (devices), Collectors seen (counted collectors, signed in), Views by day and Pages, each with the previous period', async () => {
    const f = await likes(windowOf(P30, B30));
    const look = f.viewed.visitors.look;
    // 10 Oct: 9 views of models (360 s); 11 Oct: 1 of Blue in Italy (10 s) and 3 of NOW (130 s). Devices: 5 + 1.
    // Collectors seen: A, B and C (T is a test entrant, the anonymous visitor has no account); before: B on 10 Sep.
    expect(look).toMatchObject({ views: 13, seconds: 500, visitors: 6, collectors: 3, collectorsFrom: null, previous: { views: 50, seconds: 5000, visitors: 30, collectors: 1 } });
    expect(look.byDay).toHaveLength(30);
    expect(look.byDay[0]!.day).toBe('2026-09-15');
    expect(look.byDay.filter((d) => d.views > 0)).toEqual([
      { day: '2026-10-10', views: 9 },
      { day: '2026-10-11', views: 4 },
    ]);
    expect(look.previousByDay).toHaveLength(30);
    expect(look.previousByDay!.filter((d) => d.views > 0)).toEqual([{ day: '2026-09-01', views: 50 }]);
    expect(look.pages).toEqual([
      { page: 'MODEL', views: 10, seconds: 370, share: 74 },
      { page: 'NOW', views: 3, seconds: 130, share: 26 },
    ]);
    // Without the comparison, no previous period; the country alone applies, to Collectors seen too (no view placed in Italy).
    const off = await likes(windowOf(P30, null));
    expect(off.viewed.visitors.look).toMatchObject({ previous: null, previousByDay: null });
    const it = await likes(windowOf(P30, B30), undefined, ['IT']);
    expect(it.viewed.visitors.look).toMatchObject({ views: 1, seconds: 10, visitors: 1, collectors: 0, previous: { views: 0, visitors: 0, collectors: 0 } });
    // A period reaching past the 13 months of detail: Collectors seen counts from the first day kept, the previous one withheld.
    const long = await likes(windowOf({ ...P30, from: '2025-06-01', start: z('2025-05-31T22:00:00Z') }, B30));
    expect(long.viewed.visitors.look).toMatchObject({ collectorsFrom: '2025-09-14', collectors: 3, previous: { collectors: null } });
  });

  it('pieces held: by main model with its dots, the collectors holding one now and the pieces; ended ownerships and revoked pieces left out', async () => {
    const f = await likes(windowOf(P30, B30));
    expect(f.held).toEqual({
      rows: [
        {
          modelId: m.MONO,
          name: 'MONOLITHE',
          variant: 'Silver',
          collectors: 2,
          pieces: 3,
          variants: [{ modelId: m.BLUE, name: 'MONOLITHE', variant: 'Blue', collectors: 1, pieces: 2 }],
        },
      ],
      groups: 1,
    });
  });

  it('a population narrows every figure but ALL VISITORS: the favourite-type filter, or the account’s country', async () => {
    const ring: AccountFilter = (name) => sql`${sql.id(name)} AS (SELECT a.id AS account_id FROM accounts a WHERE a.status <> 'DELETED' AND ${tasteFilter('a.id', ['RING'])}
      AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = a.id) AND a.email NOT LIKE '%@orbes.test')`;
    const f = await likes(windowOf(P30, B30), ring);
    expect(f.total).toBe(2); // A and B
    expect(f.wishlists).toMatchObject({ collectors: 2, share: 100, added: 2 });
    expect(f.mostWished.rows.map((r) => [r.name, r.wished])).toEqual([['MONOLITHE', 2]]);
    expect(f.pieces.rows.map((r) => [r.key, r.collectors])).toEqual([['RING', 2]]);
    expect(f.viewed.collectors.models[0]).toMatchObject({ collectors: 2, views: 4, seconds: 140 });
    expect(f.held.rows.map((r) => [r.collectors, r.pieces])).toEqual([[2, 3]]);
    expect(f.viewed.visitors.models[0]!.views).toBe(10);
  });

  it('a period before the 13-month line reads the monthly totals, without filters (raw: false); a previous period alone beyond it is withheld', async () => {
    const db = h.t.db;
    expect(wishHistoryCutoff(NOW)).toEqual(z('2025-09-13T22:00:00Z'));
    for (const month of ['2025-05-01', '2025-06-01', '2025-07-01']) await db.insertInto('wish_months_counted').values({ month }).execute();
    const total = (month: string, model: string, added: number, removed: number, wished_end: number) => db.insertInto('model_wish_months').values({ month, model_id: m[model]!, added, removed, wished_end }).execute();
    await total('2025-05-01', 'BLUE', 1, 0, 4);
    await total('2025-06-01', 'BLUE', 3, 1, 5);
    await total('2025-07-01', 'BLUE', 1, 0, 6);
    await total('2025-07-01', 'STEEL', 2, 0, 2);
    const summer = parisPeriod({ p: 'custom', from: '2026-06-01', to: '2026-07-31' }, NOW);
    const shift = (p: Period, from: string, to: string, start: string, end: string): Period => ({ ...p, from, to, start: z(start), end: z(end) });
    const june = shift(summer, '2025-06-01', '2025-07-31', '2025-05-31T22:00:00Z', '2025-07-31T22:00:00Z');
    const may = shift(summer, '2025-04-01', '2025-05-31', '2025-03-31T22:00:00Z', '2025-05-31T22:00:00Z');
    const f = await likes(windowOf(june, may));
    expect(f.raw).toBe(false);
    expect(f.wishlists).toEqual({ collectors: null, share: null, added: 6, removed: 1, previous: { collectors: null, added: 1, removed: 0 } });
    expect(f.mostWished.rows.map((r) => [r.variant, r.wished, r.added, r.previous, r.variants.map((v) => [v.variant, v.wished, v.added, v.previous])])).toEqual([
      ['Silver', 8, 6, 4, [['Blue', 6, 4, 4], ['Steel', 2, 2, 0]]],
    ]);
    expect(f.collections.rows).toEqual([{ collectionId: orbital, name: 'ORBITAL', collectors: 8, previous: 4 }]);
    // The rows of the current period are not read: no filter applies to the totals.
    const narrow = await likes(windowOf(june, may), (name) => sql`${sql.id(name)} AS (SELECT a.id AS account_id FROM accounts a WHERE false)`);
    expect(narrow.mostWished.rows[0]!.wished).toBe(8);
    // A period inside the line whose previous one is beyond it: the wish figures' previous values are withheld.
    const autumn = shift(summer, '2025-09-20', '2025-10-19', '2025-09-19T22:00:00Z', '2025-10-19T22:00:00Z');
    const august = shift(summer, '2025-08-21', '2025-09-19', '2025-08-20T22:00:00Z', '2025-09-19T22:00:00Z');
    const g = await likes(windowOf(autumn, august));
    expect(g.raw).toBe(true);
    expect(g.wishlists.previous).toBeNull();
    expect(g.pieces.rows.every((r) => r.previous === 0)).toBe(true);
  });
});

describe('LikesService: "open at T" around a wish removed or added at the end exactly (§3.2 W.8, W.13; step 9.4)', () => {
  let h: Harness;
  const acc: Record<string, string> = {};
  const m: Record<string, string> = {};
  const c: Record<string, string> = {};
  const P30 = parisPeriod({ p: '30d' }, NOW);
  const B30 = previousPeriod(P30);
  const only = (...keys: string[]): AccountFilter => (name) => sql`${sql.id(name)} AS (SELECT a.id AS account_id FROM accounts a WHERE a.id IN (${sql.join(keys.map((k) => acc[k]!))}))`;

  // BORNE (in EDGE): R's wish removed at the period's end, RB's removed at the previous period's end.
  // SEUIL (in LIMIT): N's wish added at the period's end, NB's added at the previous period's end.
  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    const db = h.t.db;
    expect(P30.end).toEqual(z('2026-10-14T22:00:00Z'));
    expect(B30.end).toEqual(z('2026-09-14T22:00:00Z'));
    expect(B30.end).toEqual(P30.start);
    await new GrowthWorld(db).prepare();
    for (const [key, name, collection] of [['BORNE', 'BORNE', 'EDGE'], ['SEUIL', 'SEUIL', 'LIMIT']] as const) {
      c[collection] = (await db.insertInto('collections').values({ name: collection }).returning('id').executeTakeFirstOrThrow()).id;
      const id = randomUUID();
      await db
        .insertInto('models')
        .values({ id, category_id: 1, name, type: 'RING', sku_prefix: `E-${id.slice(0, 8)}`, collection_id: c[collection]!, slug: `edge-${id.slice(0, 8)}`, lookbook: 'PUBLIC', published_at: z('2026-01-01T00:00:00Z') })
        .execute();
      m[key] = id;
    }
    const wish = async (key: string, model: string, added: Date, removed: Date | null = null) => {
      const email = `edge-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
      acc[key] = (
        await db
          .insertInto('accounts')
          .values({ email, email_normalized: email, password_hash: 'x', country: 'FR', status: 'ACTIVE', created_at: z('2026-06-01T10:00:00Z') })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db.insertInto('account_wishes').values({ account_id: acc[key]!, model_id: m[model]!, added_at: added, removed_at: removed }).execute();
    };
    await wish('R', 'BORNE', z('2026-10-01T10:00:00Z'), P30.end);
    await wish('RB', 'BORNE', z('2026-09-01T10:00:00Z'), B30.end);
    await wish('N', 'SEUIL', P30.end);
    await wish('NB', 'SEUIL', B30.end);
  }, 120_000);
  afterAll(() => h?.close());

  it('a wish removed at the end is open at the end and not removed in the period; one added at the end is neither open nor added', async () => {
    const likes = (population?: AccountFilter) => h.ctx.services.likes.likes(windowOf(P30, B30), population);
    const f = await likes();
    expect(f.raw).toBe(true);
    expect(f.total).toBe(4);
    // BORNE: open at P30's end, R (removed at it), not RB (removed at P30's start, B30's end); added in P30: R. Open at
    // B30's end: RB (removed at it).
    // SEUIL: open at P30's end, NB (added at P30's start), not N (added at the end); added in P30: NB, not N. Open at
    // B30's end: none (NB added at it).
    expect(f.mostWished.rows.map((r) => [r.name, r.wished, r.added, r.previous])).toEqual([
      ['BORNE', 1, 1, 1],
      ['SEUIL', 1, 1, 0],
    ]);
    expect(f.collections.rows).toEqual([
      { collectionId: c.EDGE, name: 'EDGE', collectors: 1, previous: 1 },
      { collectionId: c.LIMIT, name: 'LIMIT', collectors: 1, previous: 0 },
    ]);
    // Removed in P30: RB's (at its start), not R's (at its end). Added in B30: RB's, not NB's (at its end).
    expect(f.wishlists).toEqual({ collectors: 2, share: 50, added: 2, removed: 1, previous: { collectors: 1, added: 1, removed: 0 } });
    // Each pair alone: the removals at an end leave the wish open at that end, the additions at an end do not open it.
    expect((await likes(only('R', 'RB'))).wishlists).toEqual({ collectors: 1, share: 50, added: 1, removed: 1, previous: { collectors: 1, added: 1, removed: 0 } });
    expect((await likes(only('N', 'NB'))).wishlists).toEqual({ collectors: 1, share: 50, added: 1, removed: 0, previous: { collectors: 0, added: 0, removed: 0 } });
  });
});
