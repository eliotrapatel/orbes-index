/**
 * The client sheet's Intelligence (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.4, C.13 « owner-intelligence.test.ts »,
 * step 5.7; services/owner-intelligence.ts):
 *
 *  - each block from seeded rows: the origin (a referring site as the first source, the sign-up's last link, the latest
 *    purchase's), the wishlist (its collection, the model's state), the browsing (the 13 months and the summary older
 *    than them, « Before the account »), the recording's start; the engagement block null until I2;
 *  - an AUDITOR's reading withholds every city, the rest the same;
 *  - the empty account: every block's empty answer;
 *  - one block failing marks only itself, logged; an unknown account 404.
 * The route, its roles and its masking are test/api/client-sheet.test.ts and test/api/admin-roles.test.ts.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { ownerIntelligence, type OwnerIntelligenceDeps } from '../../src/server/services/owner-intelligence.js';
import { createHarness, type Harness } from '../api/support.js';
import { GrowthWorld } from '../support/growth.js';

const NOW = '2026-10-09T10:00:00.000Z';

describe('the client sheet\'s Intelligence (plan CUSTOMER INTELLIGENCE §3.6 C.4.4)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let rich: string;
  let empty: string;
  let model: string;
  const db = () => h.t.db;
  const deps = (): OwnerIntelligenceDeps => ({ db: db(), acquisition: h.ctx.services.acquisition, wishlist: h.ctx.services.wishlist, tracking: h.ctx.services.tracking });

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    w = await new GrowthWorld(db()).prepare();
    await db().updateTable('tracking_state').set({ started_at: new Date('2026-09-01T00:00:00Z'), scans_backfilled_at: new Date('2026-09-01T00:00:00Z') }).where('id', '=', 1).execute();
    const collection = (await db().insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;
    model = await w.model('MONOLITHE', { label: 'Blue', swatch: '#1F3A93', collectionId: collection });
    rich = await w.account('2026-09-20', 'FR');
    await db().updateTable('accounts').set({ created_at: new Date('2026-09-20T10:00:00Z') }).where('id', '=', rich).execute();
    empty = await w.account('2026-10-01', 'IT');

    // Its first visit came from Instagram's site, two days before the account.
    const site = (await db().insertInto('acquisition_sources').values({ kind: 'SITE', site: 'instagram.com', key: 'S:instagram.com' }).returning('id').executeTakeFirstOrThrow()).id;
    await db().insertInto('account_sources').values({ account_id: rich, first_source_id: site, first_seen_at: new Date('2026-09-18T19:04:00Z'), set_at: new Date('2026-09-20T10:00:00Z'), set_by: 'SIGN_UP' }).execute();
    await db().insertInto('acquisition_conversions').values({ kind: 'SIGNUP', ref_id: rich, account_id: rich, at: new Date('2026-09-20T10:00:00Z'), last_source_id: site }).execute();
    // A wish.
    await db().insertInto('account_wishes').values({ account_id: rich, model_id: model, added_at: new Date('2026-10-08T09:00:00Z') }).execute();
    // Views: one before the account, one after, in Paris; a summary older than 13 months.
    const device = (
      await db()
        .insertInto('tracking_devices')
        .values({ device_hash: randomBytes(32).toString('base64url').slice(0, 43), kind: 'PHONE', os: 'IOS', browser: 'SAFARI', opened_in: 'BROWSER', in_app: null, account_id: rich, linked_at: new Date('2026-09-20T10:00:00Z'), first_seen_at: new Date('2026-09-18T19:04:00Z'), last_seen_at: new Date('2026-10-08T19:00:00Z') })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db().insertInto('tracking_device_accounts').values({ device_id: device, account_id: rich, first_via: 'SIGN_UP', first_linked_at: new Date('2026-09-20T10:00:00Z'), last_linked_at: new Date('2026-09-20T10:00:00Z') }).execute();
    const paris = (await h.ctx.services.places.idOf('FR', 'Paris'))!;
    await db()
      .insertInto('collector_views')
      .values([
        { at: new Date('2026-09-18T19:04:00Z'), device_id: device, account_id: rich, page: VIEW_PAGE_CODES.MODEL, subject: model, seconds: 40, place_id: paris },
        { at: new Date('2026-10-08T19:00:00Z'), device_id: device, account_id: rich, page: VIEW_PAGE_CODES.MODEL, subject: model, seconds: 60, place_id: paris },
      ])
      .execute();
    await db().insertInto('collector_view_totals').values({ account_id: rich, page: VIEW_PAGE_CODES.MODEL, subject: model, views: 4, seconds: 600, first_at: new Date('2025-01-01T10:00:00Z'), last_at: new Date('2025-03-01T10:00:00Z') }).execute();
    await db().insertInto('collector_places').values({ account_id: rich, place_id: paris, days: 2, first_day: '2026-09-18', last_day: '2026-10-08' }).execute();
  });
  afterAll(() => h?.close());

  it('reads each block from its own data: the origin, the wishlist with its collection, the browsing and the summary older than 13 months; no engagement before I2', async () => {
    const i = await ownerIntelligence(deps(), rich, { inClear: true });
    expect(i.engagement).toBeNull();
    expect(i.recordingSince).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(i.origin).toEqual(await h.ctx.services.acquisition.originOf(rich));
    expect(i.origin).toMatchObject({ firstVisit: { at: new Date('2026-09-18T19:04:00Z'), source: { kind: 'SITE', label: 'instagram.com' } }, signUp: { source: { kind: 'SITE' } }, lastOrder: null });
    expect(i.wishlist).toEqual([{ modelId: model, name: 'MONOLITHE', variant: { label: 'Blue', swatch: '#1F3A93' }, collection: 'ORBITAL', addedAt: new Date('2026-10-08T09:00:00Z'), state: expect.any(String) }]);
    expect(i.browsing).toEqual(await h.ctx.services.tracking.collectorBrowsing(rich, { withCities: true }));
    expect(i.browsing).toMatchObject({
      views: { count: 2, seconds: 100 },
      older: { views: 4, seconds: 600 },
      beforeAccount: { kind: 'BROWSED', days: 1, views: 1, scans: 0 },
      places: [{ country: 'FR', city: 'Paris', days: 2 }],
      modelsViewed: 1,
      citiesWithheld: false,
    });
  });

  it('withholds every city from an AUDITOR, the rest the same', async () => {
    const i = await ownerIntelligence(deps(), rich, { inClear: false });
    expect(i.browsing).toMatchObject({ places: [{ country: 'FR', city: null }], citiesWithheld: true, lastSeen: { place: { country: 'FR', city: null } } });
    expect(JSON.stringify(i)).not.toContain('Paris');
    expect(i.origin).toEqual((await ownerIntelligence(deps(), rich, { inClear: true })).origin);
  });

  it('reads an account with nothing recorded as every block\'s empty answer', async () => {
    const i = await ownerIntelligence(deps(), empty, { inClear: true });
    expect(i.wishlist).toEqual([]);
    // Made before the visits' recording started: Before tracking.
    expect(i.origin).toMatchObject({ firstVisit: { at: null, source: { kind: 'BEFORE', label: 'Before tracking' } }, lastOrder: null });
    expect(i.browsing).toMatchObject({ lastSeen: null, views: { count: 0, seconds: 0 }, older: null, beforeAccount: { kind: 'NOTHING' }, models: [], releases: [], devices: [], places: [], modelsViewed: 0 });
  });

  it('marks only the block that failed, logged, and keeps the others; 404 for an unknown account', async () => {
    const warned: string[] = [];
    const failing: OwnerIntelligenceDeps = {
      ...deps(),
      wishlist: { ofAccount: () => Promise.reject(new Error('wishlist down')) },
      warn: (d) => warned.push(d.block),
    };
    const i = await ownerIntelligence(failing, rich, { inClear: true });
    expect(i.wishlist).toEqual({ failed: true });
    expect(i.origin).not.toHaveProperty('failed');
    expect(i.browsing).not.toHaveProperty('failed');
    expect(warned).toEqual(['wishlist']);
    const all: OwnerIntelligenceDeps = {
      db: db(),
      acquisition: { originOf: () => Promise.reject(new Error('down')) },
      wishlist: { ofAccount: () => Promise.reject(new Error('down')) },
      tracking: { collectorBrowsing: () => Promise.reject(new Error('down')) },
    };
    expect(await ownerIntelligence(all, rich, { inClear: true })).toMatchObject({ engagement: null, origin: { failed: true }, wishlist: { failed: true }, browsing: { failed: true }, recordingSince: new Date('2026-09-01T00:00:00Z') });
    await expect(ownerIntelligence(deps(), '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', { inClear: true })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    await expect(ownerIntelligence(deps(), 'nope', { inClear: true })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});
