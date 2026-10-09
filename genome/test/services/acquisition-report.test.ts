/**
 * Where they come from, the console's readings (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.5, A.7, A.10 and A.15
 * « acquisition-report.test.ts », step 4.6; services/acquisition-report.ts and the read routes of routes/admin/links.ts),
 * on one scripted October 2026 written through the real services (the arrivals, the links at sign-up, the conversions
 * job), every figure counted by hand below:
 *
 *   A   first seen through Instagram bio (L1, €100) on 2 Oct, then Léa — TikTok (L2, £50) on 5 Oct, signs up on 6 Oct,
 *       enters a draw (7 Oct) and a LIVE RELEASE (9 Oct); its draw order (€480, 8 Oct) is returned (credit note 20 Oct);
 *       its LIVE order is £150 (9 Oct); a salon order of €200 (request 21 Oct, paid 22 Oct).
 *   B   from vogue.fr (3 Oct), signs up 4 Oct; through L1 again on 12 Oct, signed in; a salon request on 10 Oct
 *       accepted on 14 Oct (€300): its last link is vogue.fr, judged at the request.
 *   C   campaign tags ig / story / drop-14, content story-1 (5 Oct), signs up, enters the draw, a salon order of £200.
 *   C2  the same campaign, content story-2 (6 Oct), signs up: one campaign row of two variants.
 *   D   arrives direct (11 Oct) and signs up: Direct.
 *   E   made on 20 Sep, before the recording (1 Oct, 08:00 UTC): a salon request of 25 Sep paid on 15 Oct (€100):
 *       Before tracking, first and last.
 *   S   signs up on a browser signed into the console (13 Oct): Console device.
 *   F   through L1, signs up, buys (€50), then DELETED; H, through L1, one of the team's own accounts, buys (€70);
 *   T   a test entrant with a draw entry: none of the three in any figure, the TOTAL included.
 *   L3  an archived Instagram link, one anonymous visit (3 Oct); X1, X2, X3: anonymous visits through L1 at 22:30 UTC
 *       on 24 Oct and 25 Oct and at 23:30 UTC on 25 Oct (Paris: 25 Oct twice, the 25-hour day, then 26 Oct).
 *
 * Checked: both attributions side by side; the TOTAL equals every sign-up, entry, purchase and revenue of the period of
 * counted collectors, and the rows plus the lines add up to it, on all three views; revenue is invoices less credit
 * notes by their issue date, one currency at a time; the return in the cost's currency since the link was made (and
 * null without a cost); the WITHOUT lines; Paris days (25 October 2026); archived links on and off; the visits from
 * the daily summary and the raw visits never both for one day; the collectors behind a figure match it; one link's
 * figures and days; the overview and sourceFilter; the routes' query checks and the AUDITOR's masked emails.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HouseCurrency, OrderChannel } from '../../src/server/db/schema.js';
import { jsonText } from '../../src/server/db/schema.js';
import { summariseDays } from '../../src/server/services/acquisition-jobs.js';
import { addFigures, parseSourceSpec, sourceFilter, zeroFigures, type AcquisitionReport, type Figures, type SourceSpec } from '../../src/server/services/acquisition-report.js';
import type { Actor } from '../../src/server/types.js';
import { GrowthWorld } from '../support/growth.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, type Harness } from '../api/support.js';

const z = (iso: string) => new Date(iso);
const START = z('2026-10-01T08:00:00Z');
const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('AcquisitionReportService (§3.4 A.5, A.10, step 4.6)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let seq = 0;
  let invoiceSeq = 1_000;
  const acc: Record<string, string> = {};
  const src: Record<string, number> = {};
  const link: Record<string, string> = {};
  const channel: Record<string, string> = {};

  const svc = () => h.ctx.services.acquisitionReport;
  const device = async (key: string, firstSeen: Date) => {
    const hash = `${key.padEnd(8, '_')}${String(++seq).padStart(4, '0')}${'r'.repeat(31)}`;
    const id = (await h.t.db.insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: firstSeen, last_seen_at: firstSeen }).returning('id').executeTakeFirstOrThrow()).id;
    return { id, hash };
  };
  const arrive = (deviceId: number, now: Date, a: { link?: string; utm?: Record<string, string>; referrer?: string }, accountId: string | null = null) =>
    h.ctx.services.acquisition.arrive({ deviceId, accountId, now, ...a });
  const account = async (key: string, created: Date, email = `${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`) =>
    (acc[key] = (await h.t.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'x', country: 'FR', created_at: created }).returning('id').executeTakeFirstOrThrow()).id);
  const signUp = async (key: string, d: { hash: string }, created: Date) => {
    await account(key, created);
    await h.ctx.services.tracking.link(d.hash, acc[key]!, 'SIGN_UP', created);
  };
  const invoice = async (orderId: string, kind: 'INVOICE' | 'CREDIT_NOTE', issued: Date, currency: string, total: number, credits: string | null) =>
    (
      await h.t.db
        .insertInto('invoices')
        .values({
          kind,
          year: issued.getUTCFullYear(),
          sequence: ++invoiceSeq,
          order_id: orderId,
          credits_invoice_id: credits,
          credit_scope: kind === 'CREDIT_NOTE' ? 'FULL' : null,
          issuer: jsonText({ name: 'CONGLOMERAT LLC', address: ['30 N Gould St, Ste N', 'Sheridan, WY 82801', 'United States'] }),
          buyer: jsonText({ name: null, address: null, email: null }),
          lines: jsonText([{ kind: 'PIECE', label: 'PIECE', detail: null, amountMinor: total }]),
          currency,
          subtotal_minor: total,
          total_minor: total,
          issued_at: issued,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  /** An order paid at `paid` with its invoice; a salon's request at `request`; returned with its credit note at `returned`. */
  const order = async (o: { account: string; channel: OrderChannel; dropId?: string; dropEntryId?: string; liveEntryId?: string; request?: Date; reserved: Date; paid: Date; total: number; currency: HouseCurrency; returned?: Date }) => {
    const request = o.request
      ? (await h.t.db.insertInto('shop_requests').values({ account_id: o.account, model_id: acc.model!, status: 'CLOSED', created_at: o.request, handled_at: o.reserved, outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow()).id
      : null;
    const shipped = o.returned ? new Date(o.paid.getTime() + 86_400_000) : null;
    const id = (
      await h.t.db
        .insertInto('orders')
        .values({
          channel: o.channel,
          account_id: o.account,
          model_id: acc.model!,
          shop_request_id: request,
          drop_id: o.dropId ?? null,
          drop_entry_id: o.dropEntryId ?? null,
          live_entry_id: o.liveEntryId ?? null,
          price_minor: o.total,
          currency: o.currency,
          status: o.returned ? 'RETURNED' : 'PAID',
          reserved_at: o.reserved,
          paid_at: o.paid,
          shipped_at: shipped,
          carrier_id: shipped ? w.carrier : null,
          tracking_number: shipped ? 'ACQ-123' : null,
          returned_at: o.returned ?? null,
          location_id: w.location,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const inv = await invoice(id, 'INVOICE', o.paid, o.currency, o.total, null);
    if (o.returned) await invoice(id, 'CREDIT_NOTE', o.returned, o.currency, o.total, inv);
    return id;
  };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-01T09:00:00Z');
    await h.t.db.updateTable('acquisition_state').set({ tracking_started_at: START, conversions_until: START }).execute();
    w = await new GrowthWorld(h.t.db).prepare();
    acc.model = await w.model('MONOLITHE', { price: [48_000, 'EUR'] });
    const admin = await createAdmin(h.ctx, 'OPERATOR');
    const actor: Actor = { type: 'admin', id: admin.id };
    for (const c of await h.ctx.services.links.channels()) channel[c.name] = c.id;
    const made = async (key: string, name: string, ch: string, cost: { minor: number; currency: HouseCurrency } | null) => {
      h.clock.advance(60_000);
      const l = await h.ctx.services.links.create({ name, channelId: channel[ch], destination: 'NOW', ...(cost ? { cost } : {}) }, actor);
      link[key] = l.id;
      src[key] = (await h.t.db.selectFrom('acquisition_sources').select('id').where('link_id', '=', l.id).executeTakeFirstOrThrow()).id;
      return l;
    };
    await made('L1', 'Instagram bio', 'Instagram', { minor: 10_000, currency: 'EUR' });
    await made('L2', 'Léa — TikTok', 'Influencers', { minor: 5_000, currency: 'GBP' });
    await made('L3', 'Old post', 'Instagram', null);
    await h.ctx.services.links.archive(link.L3!, actor);
    const code = async (key: string) => (await h.t.db.selectFrom('links').select('code').where('id', '=', link[key]!).executeTakeFirstOrThrow()).code;
    const L1 = await code('L1');
    const L2 = await code('L2');
    const L3 = await code('L3');

    // A
    const dA = await device('A', z('2026-10-02T10:00:00Z'));
    await arrive(dA.id, z('2026-10-02T10:00:00Z'), { link: L1 });
    await arrive(dA.id, z('2026-10-05T10:00:00Z'), { link: L2 });
    await signUp('A', dA, z('2026-10-06T10:00:00Z'));
    // B
    const dB = await device('B', z('2026-10-03T10:00:00Z'));
    await arrive(dB.id, z('2026-10-03T10:00:00Z'), { referrer: 'https://www.vogue.fr/article' });
    await signUp('B', dB, z('2026-10-04T10:00:00Z'));
    await arrive(dB.id, z('2026-10-12T10:00:00Z'), { link: L1 }, acc.B);
    // C, C2
    const dC = await device('C', z('2026-10-05T10:00:00Z'));
    await arrive(dC.id, z('2026-10-05T10:00:00Z'), { utm: { source: 'ig', medium: 'story', campaign: 'drop-14', content: 'story-1' } });
    await signUp('C', dC, z('2026-10-05T20:00:00Z'));
    const dC2 = await device('C2', z('2026-10-06T10:00:00Z'));
    await arrive(dC2.id, z('2026-10-06T10:00:00Z'), { utm: { source: 'ig', medium: 'story', campaign: 'drop-14', content: 'story-2' } });
    await signUp('C2', dC2, z('2026-10-06T11:00:00Z'));
    // D: a direct arrival.
    const dD = await device('D', z('2026-10-11T09:00:00Z'));
    await arrive(dD.id, z('2026-10-11T09:00:00Z'), {});
    await signUp('D', dD, z('2026-10-11T10:00:00Z'));
    // E, before the recording.
    await account('E', z('2026-09-20T12:00:00Z'));
    // S, on a console browser.
    const staffHash = `S_______${'s'.repeat(35)}`;
    await h.ctx.services.tracking.markStaff(staffHash, z('2026-10-13T09:00:00Z'));
    await account('S', z('2026-10-13T10:00:00Z'));
    await h.ctx.services.tracking.link(staffHash, acc.S!, 'SIGN_UP', z('2026-10-13T10:00:00Z'));
    // F (deleted later), H (the team's), T (a test entrant).
    const dF = await device('F', z('2026-10-07T10:00:00Z'));
    await arrive(dF.id, z('2026-10-07T10:00:00Z'), { link: L1 });
    await signUp('F', dF, z('2026-10-08T10:00:00Z'));
    const team = await createAdmin(h.ctx, 'AUDITOR');
    const dH = await device('H', z('2026-10-07T11:00:00Z'));
    await arrive(dH.id, z('2026-10-07T11:00:00Z'), { link: L1 });
    await account('H', z('2026-10-08T11:00:00Z'), team.email);
    await h.ctx.services.tracking.link(dH.hash, acc.H!, 'SIGN_UP', z('2026-10-08T11:00:00Z'));
    await account('T', z('2026-10-08T12:00:00Z'));
    await h.t.db.insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    // The archived link's visit, and the three late visits through L1.
    const dY = await device('Y', z('2026-10-03T10:00:00Z'));
    await arrive(dY.id, z('2026-10-03T10:00:00Z'), { link: L3 });
    for (const [k, at] of [['X1', '2026-10-24T22:30:00Z'], ['X2', '2026-10-25T22:30:00Z'], ['X3', '2026-10-25T23:30:00Z']] as const) {
      const d = await device(k, z(at));
      await arrive(d.id, z(at), { link: L1 });
    }

    // Entries and orders.
    const draw = await w.drop({ mode: 'DRAW', modelId: acc.model, title: 'DRAW', opens: '2026-10-07', quantity: 10 });
    const aEntry = await w.drawEntry(draw.id, acc.A!, 'CONFIRMED', '2026-10-07');
    await w.drawEntry(draw.id, acc.C!, 'ENTERED', '2026-10-07', 2);
    await w.drawEntry(draw.id, acc.T!, 'ENTERED', '2026-10-08', 3);
    await order({ account: acc.A!, channel: 'DRAW', dropId: draw.id, dropEntryId: aEntry, reserved: z('2026-10-08T10:00:00Z'), paid: z('2026-10-08T11:00:00Z'), total: 48_000, currency: 'EUR', returned: z('2026-10-20T12:00:00Z') });
    const live = await w.drop({ mode: 'LIVE', modelId: acc.model, title: 'LIVE', opens: '2026-10-09', quantity: 3 });
    const aLive = await w.liveEntry(live, acc.A!, '2026-10-09');
    await order({ account: acc.A!, channel: 'LIVE', dropId: live.id, liveEntryId: aLive, reserved: z('2026-10-09T12:00:00Z'), paid: z('2026-10-09T12:05:00Z'), total: 15_000, currency: 'GBP' });
    await order({ account: acc.A!, channel: 'SALON', request: z('2026-10-21T10:00:00Z'), reserved: z('2026-10-22T10:00:00Z'), paid: z('2026-10-22T11:00:00Z'), total: 20_000, currency: 'EUR' });
    await order({ account: acc.B!, channel: 'SALON', request: z('2026-10-10T12:00:00Z'), reserved: z('2026-10-14T12:00:00Z'), paid: z('2026-10-14T13:00:00Z'), total: 30_000, currency: 'EUR' });
    await order({ account: acc.C!, channel: 'SALON', request: z('2026-10-15T10:00:00Z'), reserved: z('2026-10-16T10:00:00Z'), paid: z('2026-10-16T11:00:00Z'), total: 20_000, currency: 'GBP' });
    await order({ account: acc.E!, channel: 'SALON', request: z('2026-09-25T10:00:00Z'), reserved: z('2026-10-15T10:00:00Z'), paid: z('2026-10-15T11:00:00Z'), total: 10_000, currency: 'EUR' });
    await order({ account: acc.F!, channel: 'SALON', request: z('2026-10-09T08:00:00Z'), reserved: z('2026-10-09T09:00:00Z'), paid: z('2026-10-09T10:00:00Z'), total: 5_000, currency: 'EUR' });
    await order({ account: acc.H!, channel: 'SALON', request: z('2026-10-10T08:00:00Z'), reserved: z('2026-10-10T09:00:00Z'), paid: z('2026-10-10T10:00:00Z'), total: 7_000, currency: 'EUR' });
    await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', acc.F!).execute();
    // The conversions job, as the housekeeping runs it.
    await h.ctx.services.acquisition.recordConversions(z('2026-10-31T22:30:00Z'));
    src.vogue = (await h.t.db.selectFrom('acquisition_sources').select('id').where('key', '=', 'S:vogue.fr').executeTakeFirstOrThrow()).id;
    for (const k of ['DIRECT', 'BEFORE', 'STAFF']) src[k] = (await h.t.db.selectFrom('acquisition_sources').select('id').where('key', '=', k).executeTakeFirstOrThrow()).id;
    const campaigns = await h.t.db.selectFrom('acquisition_sources').select(['id', 'utm_content']).where('kind', '=', 'CAMPAIGN').execute();
    src.camp1 = campaigns.find((c) => c.utm_content === 'story-1')!.id;
    src.camp2 = campaigns.find((c) => c.utm_content === 'story-2')!.id;
  }, 60_000);
  afterAll(() => h?.close());

  const F = (visits: number, firstVisits: number, first: [number, number, number, number], last: [number, number, number, number]): Figures => ({
    visits,
    firstVisits,
    first: { signups: first[0], entries: first[1], purchases: first[2], revenueMinor: first[3] },
    last: { signups: last[0], entries: last[1], purchases: last[2], revenueMinor: last[3] },
  });
  const OCT_TOTAL = F(12, 11, [6, 3, 5, 60_000], [6, 3, 5, 60_000]);
  const L1_OCT = F(7, 6, [1, 2, 2, 20_000], [0, 0, 0, 0]);
  const L2_OCT = F(1, 0, [0, 0, 0, 0], [1, 2, 2, 20_000]);
  const L3_OCT = F(1, 1, [0, 0, 0, 0], [0, 0, 0, 0]);
  const VOGUE = F(1, 1, [1, 0, 1, 30_000], [1, 0, 1, 30_000]);
  const CAMP1 = F(1, 1, [1, 1, 1, 0], [1, 1, 1, 0]);
  const CAMP2 = F(1, 1, [1, 0, 0, 0], [1, 0, 0, 0]);
  const DIRECT = F(0, 1, [1, 0, 0, 0], [2, 0, 0, 0]);
  const BEFORE = F(0, 0, [0, 0, 1, 10_000], [0, 0, 1, 10_000]);
  const STAFF = F(0, 0, [1, 0, 0, 0], [0, 0, 0, 0]);
  const line = (r: AcquisitionReport, kind: string) => r.without.find((l) => l.kind === kind)!.figures;
  /** The rows plus the lines of a view, added up. */
  const addedUp = (r: AcquisitionReport): Figures => {
    const rows = [...r.channels.map((c) => c.figures), ...r.campaigns.flatMap((g) => g.rows.map((x) => x.figures)), ...r.sites.map((s) => s.figures), ...r.without.map((l) => l.figures)];
    return rows.reduce(addFigures, zeroFigures());
  };

  it('LINKS: the links by channel in the channels\' order, both attributions side by side, the lines without a link, and a TOTAL the rows add up to', async () => {
    const r = await svc().report({ ...OCT, currency: 'EUR' });
    expect(r).toMatchObject({ view: 'links', period: OCT, currency: 'EUR', archived: false, trackingStartedAt: START });
    expect(r.currencies).toEqual(['EUR', 'GBP']);
    expect(r.channels.map((c) => c.channel.name)).toEqual(['Instagram', 'Influencers']);
    const [instagram, influencers] = r.channels;
    // The archived link is out of the list, never out of its channel's sum.
    expect(instagram!.links.map((l) => l.link.name)).toEqual(['Instagram bio']);
    expect(instagram!.links[0]!.figures).toEqual(L1_OCT);
    expect(instagram!.figures).toEqual(addFigures(L1_OCT, L3_OCT));
    expect(influencers!.links[0]!.figures).toEqual(L2_OCT);
    expect(line(r, 'CAMPAIGN')).toEqual(addFigures(CAMP1, CAMP2));
    expect(line(r, 'SITE')).toEqual(VOGUE);
    expect(line(r, 'DIRECT')).toEqual(DIRECT);
    expect(line(r, 'BEFORE')).toEqual(BEFORE);
    expect(line(r, 'STAFF')).toEqual(STAFF);
    expect(r.without.map((l) => l.kind)).toEqual(['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF']);
    expect(r.total).toEqual(OCT_TOTAL);
    expect(addedUp(r)).toEqual(r.total);
    // Shown on: the archived link listed, with its date.
    const shown = await svc().report({ ...OCT, currency: 'EUR', archived: true });
    // The newest first, as the link builder lists them.
    expect(shown.channels[0]!.links.map((l) => [l.link.name, l.link.archivedAt !== null])).toEqual([
      ['Old post', true],
      ['Instagram bio', false],
    ]);
    expect(shown.channels[0]!.links[0]!.figures).toEqual(L3_OCT);
    expect(shown.total).toEqual(r.total);
  });

  it('the TOTAL equals every sign-up, entry, purchase and revenue of the period of counted collectors, on all three views', async () => {
    // Counted by hand: the sign-ups of A, B, C, C2, D and S (not E, made in September; not F, deleted; not H, the
    // team's; not T, a test entrant); the entries of A (two) and C; the purchases of A (LIVE and salon; its draw order
    // was returned), B, C and E; the revenue in euros: A €480 − €480 + €200, B €300, E €100.
    // October in Paris: 30 Sep 22:00 UTC to 31 Oct 23:00 UTC.
    const counted = await sql<{ signups: number; entries: number }>`
      SELECT (SELECT count(*) FROM accounts a WHERE a.created_at >= ${z('2026-09-30T22:00:00Z')} AND a.created_at < ${z('2026-10-31T23:00:00Z')}
                AND a.status <> 'DELETED' AND NOT EXISTS (SELECT 1 FROM test_entrants t WHERE t.account_id = a.id)
                AND NOT EXISTS (SELECT 1 FROM admin_users u WHERE u.email_normalized = a.email_normalized))::int AS signups,
             ((SELECT count(*) FROM drop_entries e WHERE e.account_id NOT IN (${acc.F!}, ${acc.H!}, ${acc.T!}))
              + (SELECT count(*) FROM live_entries e WHERE e.account_id NOT IN (${acc.F!}, ${acc.H!}, ${acc.T!})))::int AS entries`.execute(h.t.db);
    expect(counted.rows[0]).toEqual({ signups: 6, entries: 3 });
    for (const view of ['links', 'campaigns', 'sites'] as const) {
      const r = await svc().report({ ...OCT, currency: 'EUR', view });
      expect(r.total, view).toEqual(OCT_TOTAL);
      expect(addedUp(r), view).toEqual(OCT_TOTAL);
    }
    // All time: E's sign-up joins, under Before tracking, first and last.
    const all = await svc().report({ currency: 'EUR' });
    expect(all.period).toEqual({ from: null, to: null });
    expect(all.total).toEqual(F(12, 11, [7, 3, 5, 60_000], [7, 3, 5, 60_000]));
    expect(line(all, 'BEFORE')).toEqual(F(0, 0, [1, 0, 1, 10_000], [1, 0, 1, 10_000]));
    expect(addedUp(all)).toEqual(all.total);
  });

  it('CAMPAIGN TAGS and REFERRING SITES: their rows, their lines without', async () => {
    const c = await svc().report({ ...OCT, currency: 'EUR', view: 'campaigns' });
    expect(c.campaigns).toEqual([
      {
        utmSource: 'ig',
        figures: addFigures(CAMP1, CAMP2),
        rows: [{ source: 'ig', medium: 'story', campaign: 'drop-14', sourceIds: [src.camp1, src.camp2], variants: 2, content: null, term: null, figures: addFigures(CAMP1, CAMP2) }],
      },
    ]);
    expect(c.without.map((l) => l.kind)).toEqual(['LINK', 'SITE', 'DIRECT', 'BEFORE', 'STAFF']);
    expect(line(c, 'LINK')).toEqual(addFigures(addFigures(L1_OCT, L2_OCT), L3_OCT));
    const s = await svc().report({ ...OCT, currency: 'EUR', view: 'sites' });
    expect(s.sites).toEqual([{ site: 'vogue.fr', sourceId: src.vogue, figures: VOGUE }]);
    expect(s.without.map((l) => l.kind)).toEqual(['LINK', 'CAMPAIGN', 'DIRECT', 'BEFORE', 'STAFF']);
    // One variant: its content and term read on the row.
    const one = await svc().report({ from: '2026-10-05', to: '2026-10-05', currency: 'EUR', view: 'campaigns' });
    expect(one.campaigns[0]!.rows[0]).toMatchObject({ variants: 1, content: 'story-1', term: null, sourceIds: [src.camp1] });
  });

  it('revenue is invoices less credit notes by their issue date, in one currency at a time', async () => {
    const early = await svc().report({ from: '2026-10-01', to: '2026-10-15', currency: 'EUR' });
    // The draw order's invoice (8 Oct) in the first half, its credit note (20 Oct) in the second.
    expect(early.channels[0]!.links[0]!.figures.first.revenueMinor).toBe(48_000);
    expect(early.channels[1]!.links[0]!.figures.last.revenueMinor).toBe(48_000);
    const late = await svc().report({ from: '2026-10-16', to: '2026-10-31', currency: 'EUR' });
    expect(late.channels[0]!.links[0]!.figures.first.revenueMinor).toBe(-28_000);
    expect(late.channels[1]!.links[0]!.figures.last.revenueMinor).toBe(-28_000);
    // In pounds: A's LIVE order and C's salon order only.
    const gbp = await svc().report({ ...OCT, currency: 'GBP' });
    expect(gbp.total.first.revenueMinor).toBe(35_000);
    expect(gbp.channels[0]!.links[0]!.figures.first.revenueMinor).toBe(15_000);
    expect(line(gbp, 'CAMPAIGN').first.revenueMinor).toBe(20_000);
    // Purchases count whatever their currency.
    expect(gbp.total.first.purchases).toBe(5);
    // The default currency is the one with the most invoices.
    expect((await svc().report(OCT)).currency).toBe('EUR');
  });

  it('the return: since the link was made, in its cost\'s currency, each attribution its own; none without a cost', async () => {
    const r = await svc().report({ from: '2026-10-25', to: '2026-10-25', currency: 'EUR' });
    const [instagram, influencers] = r.channels;
    // Whatever the period: A's euros since L1 was made (€480 − €480 + €200) for €100.
    expect(instagram!.links[0]!.returns).toEqual({
      first: { revenueMinor: 20_000, costMinor: 10_000, currency: 'EUR', ratio: 2 },
      last: { revenueMinor: 0, costMinor: 10_000, currency: 'EUR', ratio: 0 },
    });
    expect(influencers!.links[0]!.returns).toEqual({
      first: { revenueMinor: 0, costMinor: 5_000, currency: 'GBP', ratio: 0 },
      last: { revenueMinor: 15_000, costMinor: 5_000, currency: 'GBP', ratio: 3 },
    });
    // The channel's: over its links with a cost in the currency shown.
    expect(instagram!.cost).toEqual({ minor: 10_000, currency: 'EUR' });
    expect(instagram!.returns?.first.ratio).toBe(2);
    expect(influencers!.cost).toBeNull();
    expect(influencers!.returns).toBeNull();
    const archived = await svc().report({ currency: 'EUR', archived: true });
    expect(archived.channels[0]!.links.find((l) => l.link.name === 'Old post')!.returns).toBeNull();
  });

  it('counts in Paris days: 25 October 2026, its 25 hours, once', async () => {
    const day = await svc().report({ from: '2026-10-25', to: '2026-10-25', currency: 'EUR' });
    // 22:30 UTC on 24 Oct (00:30 Paris summer time) and on 25 Oct (23:30 Paris winter time); not 23:30 UTC (26 Oct).
    expect(day.channels[0]!.links[0]!.figures).toMatchObject({ visits: 2, firstVisits: 2 });
    const next = await svc().report({ from: '2026-10-26', to: '2026-10-26', currency: 'EUR' });
    expect(next.channels[0]!.links[0]!.figures).toMatchObject({ visits: 1, firstVisits: 1 });
  });

  it('reads the visits from the daily summary for the days summarised, the raw ones after, never both', async () => {
    const before = await svc().report({ ...OCT, currency: 'EUR' });
    expect(await summariseDays(h.t.db, z('2026-10-13T08:00:00Z'))).toBe(12);
    const half = await svc().report({ ...OCT, currency: 'EUR' });
    expect(half.total).toEqual(before.total);
    expect(half.channels).toEqual(before.channels);
    while ((await summariseDays(h.t.db, z('2026-11-02T08:00:00Z'))) > 0);
    expect((await svc().report({ ...OCT, currency: 'EUR' })).total).toEqual(before.total);
    expect((await svc().report({ from: '2026-10-25', to: '2026-10-25', currency: 'EUR' })).channels[0]!.links[0]!.figures.visits).toBe(2);
  });

  it('the collectors behind a figure match it, the newest sign-up first', async () => {
    const list = (source: SourceSpec, attribution: 'first' | 'last', measure: 'signups' | 'entries' | 'purchases' | 'revenue', period = OCT) =>
      svc().collectors({ source, attribution, measure, ...period, currency: 'EUR' });
    const all = await list({ total: true }, 'first', 'signups');
    expect(all.items.map((i) => i.accountId)).toEqual([acc.S, acc.D, acc.C2, acc.A, acc.C, acc.B]);
    expect(all).toMatchObject({ total: 6, page: 1, pageSize: 25, currency: 'EUR' });
    const a = await list({ link: link.L2! }, 'last', 'purchases');
    expect(a.items).toEqual([{ accountId: acc.A, email: expect.stringMatching(/^a-/), country: 'FR', signedUpAt: z('2026-10-06T10:00:00Z'), entries: 2, purchases: 2, revenueMinor: 20_000 }]);
    // Each figure of the report equals its list's: sign-ups by count, entries, purchases and revenue by sum.
    const r = await svc().report({ ...OCT, currency: 'EUR' });
    const checks: [SourceSpec, Figures][] = [
      [{ link: link.L1! }, L1_OCT],
      [{ channel: channel.Instagram! }, r.channels[0]!.figures],
      [{ sources: [src.camp1!, src.camp2!] }, addFigures(CAMP1, CAMP2)],
      [{ kind: 'SITE' }, VOGUE],
      [{ kind: 'DIRECT' }, DIRECT],
      [{ kind: 'BEFORE' }, BEFORE],
      [{ kind: 'STAFF' }, STAFF],
      [{ total: true }, OCT_TOTAL],
    ];
    for (const [spec, figures] of checks) {
      for (const attribution of ['first', 'last'] as const) {
        const want = figures[attribution];
        const label = `${JSON.stringify(spec)} ${attribution}`;
        expect((await list(spec, attribution, 'signups')).total, label).toBe(want.signups);
        expect((await list(spec, attribution, 'entries')).items.reduce((n, i) => n + i.entries, 0), label).toBe(want.entries);
        expect((await list(spec, attribution, 'purchases')).items.reduce((n, i) => n + i.purchases, 0), label).toBe(want.purchases);
        const revenue = await list(spec, attribution, 'revenue');
        expect(revenue.items.reduce((n, i) => n + i.revenueMinor, 0), label).toBe(want.revenueMinor);
      }
    }
    // Never a deleted account, a team account or a test entrant.
    const everyone = (await list({ total: true }, 'first', 'signups', { from: '2026-09-01', to: '2026-12-31' })).items.map((i) => i.accountId);
    expect(everyone).not.toContain(acc.F);
    expect(everyone).not.toContain(acc.H);
    expect(everyone).not.toContain(acc.T);
    expect(everyone).toContain(acc.E);
    // A page past the end: empty, its total kept.
    expect(await svc().collectors({ source: { total: true }, attribution: 'first', measure: 'signups', ...OCT, page: 2 })).toMatchObject({ items: [], total: 6, page: 2 });
  });

  it('one link: its figures, its days, its return; its destination gone', async () => {
    const l1 = await svc().link(link.L1!, { ...OCT, currency: 'EUR' });
    expect(l1.link.name).toBe('Instagram bio');
    expect(l1.destinationGone).toBe(false);
    expect(l1.figures).toEqual(L1_OCT);
    expect(l1.returns?.first.ratio).toBe(2);
    expect(l1.days).toEqual([
      { day: '2026-10-02', visits: 1, firstVisits: 1, signupsFirst: 0, signupsLast: 0 },
      { day: '2026-10-06', visits: 0, firstVisits: 0, signupsFirst: 1, signupsLast: 0 },
      { day: '2026-10-07', visits: 2, firstVisits: 2, signupsFirst: 0, signupsLast: 0 },
      { day: '2026-10-12', visits: 1, firstVisits: 0, signupsFirst: 0, signupsLast: 0 },
      { day: '2026-10-25', visits: 2, firstVisits: 2, signupsFirst: 0, signupsLast: 0 },
      { day: '2026-10-26', visits: 1, firstVisits: 1, signupsFirst: 0, signupsLast: 0 },
    ]);
    const l2 = await svc().link(link.L2!, { ...OCT });
    expect(l2.days).toEqual([
      { day: '2026-10-05', visits: 1, firstVisits: 0, signupsFirst: 0, signupsLast: 0 },
      { day: '2026-10-06', visits: 0, firstVisits: 0, signupsFirst: 0, signupsLast: 1 },
    ]);
    const l3 = await svc().link(link.L3!);
    expect(l3.returns).toBeNull();
    expect(l3.link.archivedAt).toEqual(expect.any(Date));
    await expect(svc().link(randomUUID())).rejects.toMatchObject({ code: 'LINK_NOT_FOUND' });
  });

  it('the overview: sign-ups by first source, the top links and campaigns, first visits by day, first and last differing; sourceFilter', async () => {
    const o = await svc().overview(OCT);
    expect(o.signupsByFirst).toEqual(
      expect.arrayContaining([
        { kind: 'LINK', channel: { id: channel.Instagram, name: 'Instagram' }, collectors: 1 },
        { kind: 'CAMPAIGN', channel: null, collectors: 2 },
        { kind: 'SITE', channel: null, collectors: 1 },
        { kind: 'DIRECT', channel: null, collectors: 1 },
        { kind: 'STAFF', channel: null, collectors: 1 },
      ]),
    );
    expect(o.signupsByFirst.reduce((n, r) => n + r.collectors, 0)).toBe(6);
    expect(o.topLinks).toEqual([{ link: { id: link.L1, name: 'Instagram bio', code: expect.any(String), channel: { id: channel.Instagram, name: 'Instagram' } }, signups: 1 }]);
    expect(o.topCampaigns).toEqual([{ source: 'ig', medium: 'story', campaign: 'drop-14', signups: 2 }]);
    expect(o.firstVisits.reduce((n, d) => n + d.n, 0)).toBe(11);
    expect(o.firstVisits.find((d) => d.day === '2026-10-25')).toEqual({ day: '2026-10-25', n: 2 });
    // A (L1, then L2) and S (Console device, then Direct) differ.
    expect(o.firstLastDiffer).toEqual({ collectors: 6, differ: 2 });
    const instagram = await svc().overview({ ...OCT, filters: { sources: { channelIds: [channel.Instagram!] } } });
    expect(instagram.firstLastDiffer.collectors).toBe(1);
    expect(instagram.firstVisits.reduce((n, d) => n + d.n, 0)).toBe(7);
    const ids = async (f: Parameters<typeof sourceFilter>[1]) =>
      (await h.t.db.selectFrom('accounts as a').select('a.id').where(sourceFilter('a.id', f)).execute()).map((r) => r.id).sort();
    expect(await ids({ linkIds: [link.L1!] })).toEqual([acc.A, acc.F, acc.H].sort());
    expect(await ids({ kinds: ['BEFORE'] })).toEqual(expect.arrayContaining([acc.E]));
    expect(await ids({ kinds: ['BEFORE'] })).not.toContain(acc.A);
    expect(await ids({ kinds: ['STAFF', 'SITE'] })).toEqual([acc.B, acc.S].sort());
  });

  it('parses the source of a click-through and refuses anything else', () => {
    expect(parseSourceSpec('total')).toEqual({ total: true });
    expect(parseSourceSpec('source:4,7,4')).toEqual({ sources: [4, 7] });
    expect(parseSourceSpec('kind:CAMPAIGN')).toEqual({ kind: 'CAMPAIGN' });
    for (const bad of ['', 'link:x', 'kind:OTHER', 'source:', 'source:0', 'channel:1', `source:${Array.from({ length: 201 }, (_, i) => i + 1).join(',')}`]) {
      expect(() => parseSourceSpec(bad), bad).toThrow();
    }
  });

  it('the routes: the report, a link, the collectors with an AUDITOR\'s emails masked; their queries checked', async () => {
    const auditor = await adminClient(h, 'AUDITOR');
    const operator = await adminClient(h, 'OPERATOR');
    const report = await auditor.get('/api/admin/links?from=2026-10-01&to=2026-10-31&currency=EUR&view=links&archived=1');
    expect(report.statusCode).toBe(200);
    expect((safeJson(report) as AcquisitionReport).total).toEqual(OCT_TOTAL);
    expect((safeJson(report) as AcquisitionReport).channels[0]!.links).toHaveLength(2);
    expect((await auditor.get(`/api/admin/links/${link.L1}?from=2026-10-01&to=2026-10-31`)).statusCode).toBe(200);
    expect(errorOf(await auditor.get(`/api/admin/links/${randomUUID()}`)).code).toBe('LINK_NOT_FOUND');
    const url = `/api/admin/acquisition/collectors?source=link:${link.L2}&attribution=last&measure=signups&from=2026-10-01&to=2026-10-31`;
    const masked = safeJson(await auditor.get(url)) as { items: { email: string }[] };
    expect(masked.items[0]!.email).toMatch(/^a\*\*\*@example\.com$/);
    const clear = safeJson(await operator.get(url)) as { items: { email: string }[] };
    expect(clear.items[0]!.email).toMatch(/^a-[0-9a-f]{6}@example\.com$/);
    for (const bad of [
      '/api/admin/links?from=2026-10-01',
      '/api/admin/links?from=2026-10-31&to=2026-10-01',
      '/api/admin/links?from=2024-01-01&to=2026-10-01',
      '/api/admin/links?view=tables',
      '/api/admin/links?currency=JPY',
      '/api/admin/acquisition/collectors?source=nothing&attribution=first&measure=signups',
      '/api/admin/acquisition/collectors?source=total&attribution=middle&measure=signups',
      '/api/admin/acquisition/collectors?source=total&attribution=first&measure=visits',
    ]) {
      const res = await auditor.get(bad);
      expect(res.statusCode, bad).toBe(400);
      expect(errorOf(res).code, bad).toBe('VALIDATION_FAILED');
    }
    // 800 days apart is the most.
    expect((await auditor.get('/api/admin/links?from=2024-08-22&to=2026-10-31')).statusCode).toBe(200);
    expect((await auditor.get('/api/admin/links?from=2024-08-21&to=2026-10-31')).statusCode).toBe(400);
  });
});
