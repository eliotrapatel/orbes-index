/**
 * Where a collector came from, read for the client sheet and the Collectors export (plan CUSTOMER INTELLIGENCE of
 * 2026-10-08, §3.4 A.10.5 and A.10.6, step 4.10; services/acquisition-reads.ts, offered by AcquisitionService), through
 * the real arrivals, links at sign-up and conversions job:
 *
 *  - originOf: the first visit with its time and source in words (a link's name and its channel, a campaign's tags, a
 *    site's host, Direct, Before tracking, Console device), the sign-up's last link, the latest purchase's last link
 *    with its reference (GROWTH's purchase: paid, never GIFT, not CANCELLED nor RETURNED), or none; an account made
 *    before the recording reads Before tracking with no time; an account whose first source is not written yet reads
 *    Direct with no time; a test entrant's or a team account's sheet shows it all the same; an unknown account 404;
 *  - exportColumns: the A.10.6 columns (and the latest purchase's link of §3.6 C.7), one row per counted collector only
 *    (no test entrant, team account or DELETED account), set-based over a page of accounts, junk ids ignored.
 * The right of access's `origin` is test/api/owners.test.ts's.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACQUISITION_EXPORT_COLUMNS, sourceWords } from '../../src/server/services/acquisition-reads.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { GrowthWorld } from '../support/growth.js';

const z = (iso: string) => new Date(iso);
const START = z('2026-10-01T08:00:00Z');

describe('AcquisitionService.originOf and exportColumns (§3.4 A.10.5, A.10.6, step 4.10)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let seq = 0;
  const acc: Record<string, string> = {};
  const order: Record<string, string> = {};
  let linkId = '';
  let model = '';

  const device = async (key: string, firstSeen: Date) => {
    const hash = `${key.padEnd(8, '_')}${String(++seq).padStart(4, '0')}${'o'.repeat(31)}`;
    const id = (await h.t.db.insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: firstSeen, last_seen_at: firstSeen }).returning('id').executeTakeFirstOrThrow()).id;
    return { id, hash };
  };
  const account = async (key: string, created: Date, email = `${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`) =>
    (acc[key] = (await h.t.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'x', country: 'FR', created_at: created }).returning('id').executeTakeFirstOrThrow()).id);
  const signUp = async (key: string, d: { hash: string }, created: Date, email?: string) => {
    await account(key, created, email);
    await h.ctx.services.tracking.link(d.hash, acc[key]!, 'SIGN_UP', created);
  };
  const paid = async (key: string, accountId: string, channel: 'SALON' | 'GIFT', day: string, o: { status?: 'PAID' | 'RETURNED' | 'CANCELLED'; ended?: string; withOrderId?: string } = {}) =>
    (order[key] = await w.order({
      accountId,
      modelId: model,
      channel,
      paid: day,
      total: channel === 'GIFT' ? 0 : 20_000,
      currency: 'EUR',
      ...(o.status ? { status: o.status } : {}),
      ...(o.ended ? { ended: o.ended } : {}),
      ...(o.withOrderId ? { withOrderId: o.withOrderId } : {}),
      ...(channel === 'GIFT' ? { giftGrantId: await w.giftGrant(accountId, model, day) } : {}),
    }));

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-01T09:00:00Z');
    await h.t.db.updateTable('acquisition_state').set({ tracking_started_at: START, conversions_until: START }).execute();
    w = await new GrowthWorld(h.t.db).prepare();
    model = await w.model('MONOLITHE', { price: [20_000, 'EUR'] });
    const admin = await createAdmin(h.ctx, 'OPERATOR');
    const actor: Actor = { type: 'admin', id: admin.id };
    const channel = (await h.ctx.services.links.channels()).find((c) => c.name === 'Influencers')!;
    const link = await h.ctx.services.links.create({ name: 'Léa — TikTok', channelId: channel.id, destination: 'NOW' }, actor);
    linkId = link.id;
    const arrive = (deviceId: number, now: Date, a: { link?: string; utm?: Record<string, string>; referrer?: string }, accountId: string | null = null) =>
      h.ctx.services.acquisition.arrive({ deviceId, accountId, now, ...a });

    // A: through the link (2 Oct), signs up (3 Oct); then instagram.com, signed in (5 Oct); a salon order paid 6 Oct
    // (its request 5 Oct, after instagram.com), a later order RETURNED and a GIFT travelling with the first: the latest
    // purchase is the salon order of 6 Oct.
    const dA = await device('A', z('2026-10-02T10:00:00Z'));
    await arrive(dA.id, z('2026-10-02T10:00:00Z'), { link: link.code });
    await signUp('A', dA, z('2026-10-03T10:00:00Z'));
    await arrive(dA.id, z('2026-10-05T08:00:00Z'), { referrer: 'https://l.instagram.com/?u=x' }, acc.A);
    await paid('aSalon', acc.A!, 'SALON', '2026-10-06');
    await paid('aReturned', acc.A!, 'SALON', '2026-10-08', { status: 'RETURNED', ended: '2026-10-12' });
    await paid('aGift', acc.A!, 'GIFT', '2026-10-09', { withOrderId: order.aSalon });
    // C: campaign tags, signs up; no purchase.
    const dC = await device('C', z('2026-10-04T10:00:00Z'));
    await arrive(dC.id, z('2026-10-04T10:00:00Z'), { utm: { source: 'ig', medium: 'story', campaign: 'drop-14' } });
    await signUp('C', dC, z('2026-10-04T11:00:00Z'));
    // D: made after the start, its attach never ran and the job has not reached it: Direct, no time.
    await account('D', z('2026-10-12T20:57:00Z'));
    // E: made before the recording (Before tracking), a salon order requested since, with no visit: Direct.
    await account('E', z('2026-09-20T12:00:00Z'));
    await paid('eSalon', acc.E!, 'SALON', '2026-10-05');
    // S: signed up on a console browser.
    const staff = `S_______${'s'.repeat(35)}`;
    await h.ctx.services.tracking.markStaff(staff, z('2026-10-04T09:00:00Z'));
    await account('S', z('2026-10-04T10:00:00Z'));
    await h.ctx.services.tracking.link(staff, acc.S!, 'SIGN_UP', z('2026-10-04T10:00:00Z'));
    // T a test entrant, H one of the team's own accounts, F later DELETED: each through the link.
    for (const key of ['T', 'H', 'F'] as const) {
      const d = await device(key, z('2026-10-02T12:00:00Z'));
      await arrive(d.id, z('2026-10-02T12:00:00Z'), { link: link.code });
      await signUp(key, d, z('2026-10-02T13:00:00Z'), key === 'H' ? (await createAdmin(h.ctx, 'AUDITOR')).email : undefined);
    }
    await h.t.db.insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', acc.F!).execute();
    // The conversions job, as the housekeeping runs it (an evening pass: no catch-up).
    await h.ctx.services.acquisition.recordConversions(z('2026-10-12T21:00:00Z'));
  }, 60_000);
  afterAll(() => h?.close());

  const reference = (id: string) => `OR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const LINK = () => ({ kind: 'LINK', label: 'Léa — TikTok', channel: 'Influencers', linkId });

  it('the client sheet\'s Origin: the first visit and its source, the sign-up\'s last link, the latest purchase\'s with its reference', async () => {
    const a = await h.ctx.services.acquisition.originOf(acc.A!);
    expect(a).toEqual({
      firstVisit: { at: z('2026-10-02T10:00:00Z'), source: LINK() },
      signUp: { at: z('2026-10-03T10:00:00Z'), source: LINK() },
      // The salon order of 6 Oct, judged at its request (5 Oct, after instagram.com); the returned one and the gift are
      // no purchase.
      lastOrder: { orderId: order.aSalon, reference: reference(order.aSalon!), paidAt: z('2026-10-06T12:00:00Z'), source: { kind: 'SITE', label: 'instagram.com', channel: null, linkId: null } },
    });
    const c = await h.ctx.services.acquisition.originOf(acc.C!);
    expect(c.firstVisit.source).toEqual({ kind: 'CAMPAIGN', label: 'ig / story / drop-14', channel: null, linkId: null });
    expect(c.signUp.source.label).toBe('ig / story / drop-14');
    expect(c.lastOrder).toBeNull();
  });

  it('reads Direct with no time while nothing is written, Before tracking for an account older than the recording, Console device for a console browser', async () => {
    expect(await h.ctx.services.acquisition.originOf(acc.D!)).toEqual({
      firstVisit: { at: null, source: { kind: 'DIRECT', label: 'Direct', channel: null, linkId: null } },
      signUp: { at: z('2026-10-12T20:57:00Z'), source: { kind: 'DIRECT', label: 'Direct', channel: null, linkId: null } },
      lastOrder: null,
    });
    const e = await h.ctx.services.acquisition.originOf(acc.E!);
    const before = { kind: 'BEFORE', label: 'Before tracking', channel: null, linkId: null };
    expect(e.firstVisit).toEqual({ at: null, source: before });
    expect(e.signUp.source).toEqual(before);
    // Its order was requested after the start, with no visit before it: Direct.
    expect(e.lastOrder).toMatchObject({ reference: reference(order.eSalon!), source: { kind: 'DIRECT', label: 'Direct', channel: null, linkId: null } });
    const s = await h.ctx.services.acquisition.originOf(acc.S!);
    expect(s.firstVisit.source).toEqual({ kind: 'STAFF', label: 'Console device', channel: null, linkId: null });
    expect(s.firstVisit.at).toEqual(z('2026-10-04T09:00:00Z'));
  });

  it('shows a test entrant\'s, a team account\'s and a deleted account\'s origin on their sheet; 404 for an unknown account', async () => {
    for (const key of ['T', 'H', 'F']) expect((await h.ctx.services.acquisition.originOf(acc[key]!)).firstVisit.source, key).toEqual(LINK());
    await expect(h.ctx.services.acquisition.originOf(randomUUID())).rejects.toMatchObject({ httpStatus: 404, code: 'ACCOUNT_NOT_FOUND' });
    await expect(h.ctx.services.acquisition.originOf('not-an-id')).rejects.toMatchObject({ httpStatus: 404, code: 'ACCOUNT_NOT_FOUND' });
  });

  it('the Collectors export\'s columns: one row per counted collector, every column in its order', async () => {
    const rows = await h.ctx.services.acquisition.exportColumns([...Object.values(acc), randomUUID(), 'junk', acc.A!.toUpperCase()]);
    // No test entrant, no team account, no DELETED account.
    expect([...rows.keys()].sort()).toEqual([acc.A, acc.C, acc.D, acc.E, acc.S].sort());
    for (const r of rows.values()) expect(Object.keys(r)).toEqual([...ACQUISITION_EXPORT_COLUMNS]);
    expect(rows.get(acc.A!)).toEqual({
      first_visit_at: z('2026-10-02T10:00:00Z'),
      first_source_kind: 'LINK',
      first_link: 'Léa — TikTok',
      first_channel: 'Influencers',
      first_utm_source: '',
      first_utm_medium: '',
      first_utm_campaign: '',
      first_site: '',
      signup_source_kind: 'LINK',
      signup_link: 'Léa — TikTok',
      signup_channel: 'Influencers',
      signup_utm_campaign: '',
      signup_site: '',
      latest_purchase_link: 'instagram.com',
    });
    expect(rows.get(acc.C!)).toMatchObject({ first_source_kind: 'CAMPAIGN', first_link: '', first_utm_source: 'ig', first_utm_medium: 'story', first_utm_campaign: 'drop-14', signup_utm_campaign: 'drop-14', latest_purchase_link: '' });
    expect(rows.get(acc.D!)).toMatchObject({ first_visit_at: null, first_source_kind: 'DIRECT', signup_source_kind: 'DIRECT', latest_purchase_link: '' });
    expect(rows.get(acc.E!)).toMatchObject({ first_visit_at: null, first_source_kind: 'BEFORE', signup_source_kind: 'BEFORE', latest_purchase_link: 'Direct' });
    expect(rows.get(acc.S!)).toMatchObject({ first_source_kind: 'STAFF', first_link: '' });
    expect((await h.ctx.services.acquisition.exportColumns([])).size).toBe(0);
  });

  it('says a source in words', () => {
    const none = { link_name: null, utm_source: null, utm_medium: null, utm_campaign: null, site: null };
    expect(sourceWords({ ...none, kind: 'CAMPAIGN', utm_source: 'ig', utm_campaign: 'drop-14' })).toBe('ig / drop-14');
    expect(sourceWords({ ...none, kind: 'SITE', site: 'theorbes.com' })).toBe('theorbes.com');
    expect(['DIRECT', 'BEFORE', 'STAFF'].map((kind) => sourceWords({ ...none, kind: kind as 'DIRECT' }))).toEqual(['Direct', 'Before tracking', 'Console device']);
  });
});
