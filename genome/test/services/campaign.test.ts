/**
 * The CAMPAIGN tab of a release (plan MACRO M1 §2.1 and §2.4, scope C2; services/campaign.ts and the two routes of
 * routes/admin/drops.ts), on a scripted November 2026 whose every figure is counted by hand below.
 *
 * MAKE THE LINKS: one link per channel still without an active one to the release (the archived one does not cover its
 * channel), in the channels' order, each to the release's page, named `<title> · <channel>` (a long title cut with …),
 * its address from the release's opening day in Paris and the channel (`-2` when taken; never the title), no cost;
 * LinkService's `link.create` for each and one `drop.campaign.links` with the count; a second click, or two at once,
 * makes each link once; a draft, a cancelled release and an after-room refused.
 *
 * The readout, LAST LINK (the conversion's `last_source_id`), on the draw D (EUR, the most invoiced currency, as it has
 * no price):
 *
 *   links of D    LI Instagram (made in one click, then €100), LA Instagram (archived), LT TikTok (£50: another
 *                 currency, no return), LF Influencers (made, then €0: a return without a ratio), and the four others
 *                 made in one click. X: a link of no release (its address the one LI would have taken).
 *   entries       A → LI, B → LT, C → X, E → none written yet, G → LA; T (a test entrant), H (the team's), Z (DELETED)
 *                 → LI, never counted.
 *   orders        A €480 paid 6 Nov → LI and €200 paid 7 Nov → LT (A a buyer once, on LI, its first); B €300 → LT,
 *                 RETURNED with its credit note (no buyer, nets to 0 on LT); C €150 → none (other); E £90 → LI (a
 *                 buyer on LI; no euro); T €999, H €777, Z €555 → LI (never counted); A €50 on another release → LI
 *                 (not D's).
 *
 *   LI  1 entry, 2 buyers, €480, return 4.8 on €100      LT  1, 0, €200, no return (cost in GBP)
 *   LA  1, 0, €0                                        LF  0, 0, €0, return of €0 cost: no ratio
 *   OTHER SOURCES  2 entries (C, E), 1 buyer (C), €150   TOTAL  5, 3, €830, the rows added up
 *
 * The LIVE RELEASE L (EUR, its price's), opening at 23:30 UTC on 10 Nov (11 Nov in Paris): A's entry and €500 order → its
 * Instagram link, B's entry no conversion; its after-room AR: C's entry there is not L's, C's €250 order there is (an
 * after-room's guests come from its line). Instagram 1, 1, €500; OTHER 1, 1, €250; TOTAL 2, 2, €750. Stages: UPCOMING,
 * SO_FAR from the opening to the first entry (the draw's early access from its publication; the LIVE room), FINAL once
 * drawn or ended.
 *
 * PostgreSQL (genome-ci): the readout reads under REPEATABLE READ, READ ONLY (test/api/postgres.test.ts).
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jsonText, type ConversionKind } from '../../src/server/db/schema.js';
import { campaignCodeBase, campaignDay, campaignLinkName, type CampaignFigures, type ReleaseCampaign } from '../../src/server/services/campaign.js';
import { LINK_NAME_MAX } from '../../src/server/services/links.js';
import type { Actor } from '../../src/server/types.js';
import { GrowthWorld } from '../support/growth.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, type Harness } from '../api/support.js';

const z = (iso: string) => new Date(iso);
const F = (entries: number, buyers: number, revenueMinor: number): CampaignFigures => ({ entries, buyers, revenueMinor });

describe('CampaignService (plan MACRO M1 §2.1, C2)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let actor: Actor;
  let model: string;
  const acc: Record<string, string> = {};
  const channel: Record<string, string> = {};
  const svc = () => h.ctx.services.campaign;
  const links = () => h.ctx.services.links;
  const sourceOf = async (linkId: string) => (await h.t.db.selectFrom('acquisition_sources').select('id').where('link_id', '=', linkId).executeTakeFirstOrThrow()).id;
  const convert = async (kind: ConversionKind, refId: string, account: string, linkId: string) =>
    h.t.db.insertInto('acquisition_conversions').values({ kind, ref_id: refId, account_id: account, at: h.clock.now(), last_source_id: await sourceOf(linkId) }).execute();
  const audits = (action: string, targetId: string) => h.t.db.selectFrom('audit_logs').selectAll().where('action', '=', action).where('target_id', '=', targetId).orderBy('id').execute();
  let invoiceSeq = 900_000;
  /** An invoice or a credit note of an order, issued at `issued`. */
  const document = async (orderId: string, kind: 'INVOICE' | 'CREDIT_NOTE', issued: Date, currency: string, total: number, credits: string | null) =>
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
  let livePosition = 1;
  /** A LIVE entry CONFIRMED (GrowthWorld's), at the next free place of the line. */
  const liveEntry = async (drop: { id: string; sizeId: string | null }, account: string) => {
    await h.t.db.updateTable('live_entries').set({ position: ++livePosition + 100 }).where('drop_id', '=', drop.id).where('position', '=', 1).execute();
    return w.liveEntry(drop, account, '2026-11-10');
  };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-01T08:00:00Z');
    await h.t.db.updateTable('acquisition_state').set({ tracking_started_at: z('2026-10-01T00:00:00Z'), conversions_until: z('2026-10-01T00:00:00Z') }).execute();
    w = await new GrowthWorld(h.t.db).prepare();
    model = await w.model('MONOLITHE', { price: [48_000, 'EUR'] });
    actor = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    for (const c of await links().channels()) channel[c.name] = c.id;
    for (const k of ['A', 'B', 'C', 'E', 'G', 'T', 'Z']) acc[k] = await w.account('2026-10-02', 'FR');
    await h.t.db.insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    const team = await createAdmin(h.ctx, 'AUDITOR');
    acc.H = (await h.t.db.insertInto('accounts').values({ email: team.email, email_normalized: team.email.toLowerCase(), password_hash: 'x', country: 'FR' }).returning('id').executeTakeFirstOrThrow()).id;
  }, 60_000);
  afterAll(() => h?.close());

  it('names a link’s address from the opening day in Paris and the channel, never the title, and cuts a long name', () => {
    expect(campaignDay(z('2026-11-05T12:00:00Z'))).toBe('5 Nov');
    expect(campaignDay(z('2026-11-10T23:30:00Z'))).toBe('11 Nov');
    expect(campaignCodeBase(z('2026-11-05T12:00:00Z'), 'Instagram')).toBe('release-5-nov-instagram');
    expect(campaignCodeBase(z('2026-11-05T12:00:00Z'), 'Presse écrite & web')).toBe('release-5-nov-presse-ecrite-web');
    expect(campaignCodeBase(z('2026-11-05T12:00:00Z'), '★')).toBe('release-5-nov');
    expect(campaignLinkName('MONOLITHE DRAW', 'Instagram')).toBe('MONOLITHE DRAW · Instagram');
    const long = campaignLinkName('M'.repeat(120), 'Influencers');
    expect(long.length).toBe(LINK_NAME_MAX);
    expect(long.endsWith('… · Influencers')).toBe(true);
  });

  describe('a draw', () => {
    let D: { id: string };
    let other: { id: string };
    const L: Record<string, string> = {};

    beforeAll(async () => {
      D = await w.drop({ mode: 'DRAW', modelId: model, title: 'MONOLITHE DRAW', opens: '2026-11-05', quantity: 10 });
      other = await w.drop({ mode: 'DRAW', modelId: model, title: 'ANOTHER DRAW', opens: '2026-11-06', quantity: 10 });
      // Before the click: an archived Instagram link, an active TikTok one (£50), and a link of no release taking LI's address.
      L.LA = (await links().create({ name: 'Old post', channelId: channel.Instagram, destination: 'RELEASE', dropId: D.id }, actor)).id;
      await links().archive(L.LA, actor);
      L.LT = (await links().create({ name: 'Léa — TikTok', channelId: channel.TikTok, destination: 'RELEASE', dropId: D.id, cost: { minor: 5_000, currency: 'GBP' } }, actor)).id;
      L.X = (await links().create({ name: 'Taken', channelId: channel.Other, destination: 'NOW', code: 'release-5-nov-instagram' }, actor)).id;
      h.clock.advance(60_000);
    });

    it('reads the channels in their order with the release’s links, and the ones still without an active link', async () => {
      const c = await svc().campaign(D.id);
      expect(c.release).toMatchObject({ id: D.id, mode: 'DRAW', title: 'MONOLITHE DRAW', published: true, cancelled: false });
      expect(c.channels.map((x) => [x.name, x.links.map((l) => l.id), x.covered])).toEqual([
        ['Instagram', [L.LA], false],
        ['TikTok', [L.LT], true],
        ['Influencers', [], false],
        ['Press', [], false],
        ['Shops', [], false],
        ['Search', [], false],
        ['Other', [], false],
      ]);
      expect(c.missing.map((m) => m.name)).toEqual(['Instagram', 'Influencers', 'Press', 'Shops', 'Search', 'Other']);
      expect(c.readout.stage).toBe('UPCOMING');
      // The early access begins at the publication (4 Nov, 12:00 UTC), not 48 hours before the opening.
      expect(c.readout.opensAt).toEqual(z('2026-11-04T12:00:00Z'));
      expect(c.readout.total).toEqual(F(0, 0, 0));
    });

    it('MAKE THE LINKS: one per channel without one, in order, to the release, named and addressed, no cost, audited; a second click makes none', async () => {
      const { made, campaign } = await svc().makeLinks(D.id, actor);
      expect(made.map((l) => [l.channel.name, l.code, l.name, l.destination, l.dropId, l.cost])).toEqual([
        ['Instagram', 'release-5-nov-instagram-2', 'MONOLITHE DRAW · Instagram', 'RELEASE', D.id, null],
        ['Influencers', 'release-5-nov-influencers', 'MONOLITHE DRAW · Influencers', 'RELEASE', D.id, null],
        ['Press', 'release-5-nov-press', 'MONOLITHE DRAW · Press', 'RELEASE', D.id, null],
        ['Shops', 'release-5-nov-shops', 'MONOLITHE DRAW · Shops', 'RELEASE', D.id, null],
        ['Search', 'release-5-nov-search', 'MONOLITHE DRAW · Search', 'RELEASE', D.id, null],
        ['Other', 'release-5-nov-other', 'MONOLITHE DRAW · Other', 'RELEASE', D.id, null],
      ]);
      expect(made[0]!.address).toBe('https://verify.orbes.test/go/release-5-nov-instagram-2');
      expect(made[0]!.directAddress).toBe(`https://verify.orbes.test/verify/releases/${D.id}?o=release-5-nov-instagram-2`);
      expect(campaign.missing).toEqual([]);
      expect(campaign.channels.every((c) => c.covered)).toBe(true);
      // Each link with its source, audited by LinkService; the click once, with the count.
      for (const l of made) expect(await sourceOf(l.id)).toBeGreaterThan(0);
      const created = await h.t.db.selectFrom('audit_logs').select('target_id').where('action', '=', 'link.create').where('target_id', 'in', made.map((l) => l.id)).execute();
      expect(created).toHaveLength(6);
      const click = await audits('drop.campaign.links', D.id);
      expect(click).toHaveLength(1);
      expect(click[0]!.details).toEqual({ dropId: D.id, count: 6, codes: made.map((l) => l.code) });
      expect(click[0]!.actor_id).toBe(actor.id);
      // Again: nothing made, nothing audited.
      const again = await svc().makeLinks(D.id, actor);
      expect(again.made).toEqual([]);
      expect(await audits('drop.campaign.links', D.id)).toHaveLength(1);
      L.LI = made[0]!.id;
      L.LF = made[1]!.id;
    });

    it('reads the readout under the last link: entries, buyers once on their first order, revenue less credit notes, cost and return, OTHER SOURCES and a TOTAL the rows add up to', async () => {
      await links().update(L.LI!, { cost: { minor: 10_000, currency: 'EUR' } }, actor);
      await links().update(L.LF!, { cost: { minor: 0, currency: 'EUR' } }, actor);
      // Entries.
      const ent: Record<string, string> = {};
      const entry = async (k: string, to: string | null, rank: number, drop = D.id) => {
        const id = await w.drawEntry(drop, acc[k]!, 'ENTERED', '2026-11-05', rank);
        if (to) await convert('DRAW_ENTRY', id, acc[k]!, L[to]!);
        if (drop === D.id) ent[k] = id;
        return id;
      };
      await entry('A', 'LI', 1);
      await entry('B', 'LT', 2);
      await entry('C', 'X', 3);
      await entry('E', null, 4);
      await entry('G', 'LA', 5);
      for (const [k, n] of [['T', 6], ['H', 7], ['Z', 8]] as const) await entry(k, 'LI', n);
      // Orders: each its invoice when paid, and its credit note when returned (the house's documents, as GROWTH's tests write them).
      const order = async (k: string, to: string | null, o: { paid: string; total: number; currency?: string; returned?: string; entryId?: string; piece?: number; drop?: string }) => {
        const paid = z(`${o.paid}T12:00:00Z`);
        const currency = o.currency ?? 'EUR';
        const returned = o.returned ? z(`${o.returned}T12:00:00Z`) : null;
        const id = (
          await h.t.db
            .insertInto('orders')
            .values({
              channel: 'DRAW',
              account_id: acc[k]!,
              model_id: model,
              drop_id: o.drop ?? D.id,
              drop_entry_id: o.entryId ?? ent[k]!,
              piece: o.piece ?? 1,
              price_minor: o.total,
              currency,
              status: returned ? 'RETURNED' : 'PAID',
              reserved_at: new Date(paid.getTime() - 3_600_000),
              paid_at: paid,
              shipped_at: returned ? new Date(paid.getTime() + 86_400_000) : null,
              carrier_id: returned ? w.carrier : null,
              tracking_number: returned ? 'CAMPAIGN-1' : null,
              returned_at: returned,
              location_id: w.location,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        const invoice = await document(id, 'INVOICE', paid, currency, o.total, null);
        if (returned) await document(id, 'CREDIT_NOTE', returned, currency, o.total, invoice);
        if (to) await convert('ORDER', id, acc[k]!, L[to]!);
        return id;
      };
      await order('A', 'LT', { paid: '2026-11-07', total: 20_000, piece: 2 });
      await order('A', 'LI', { paid: '2026-11-06', total: 48_000 });
      await order('B', 'LT', { paid: '2026-11-06', total: 30_000, returned: '2026-11-09' });
      await order('C', null, { paid: '2026-11-06', total: 15_000 });
      await order('E', 'LI', { paid: '2026-11-06', total: 9_000, currency: 'GBP' });
      await order('T', 'LI', { paid: '2026-11-06', total: 99_900 });
      await order('H', 'LI', { paid: '2026-11-06', total: 77_700 });
      await order('Z', 'LI', { paid: '2026-11-06', total: 55_500 });
      await order('A', 'LI', { paid: '2026-11-06', total: 5_000, drop: other.id, entryId: await entry('A', null, 1, other.id) });
      await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', acc.Z!).execute();

      h.clock.set('2026-11-05T12:30:00Z');
      const r = (await svc().campaign(D.id)).readout;
      expect(r.stage).toBe('SO_FAR');
      expect(r.currency).toBe('EUR');
      const byId = new Map(r.links.map((x) => [x.link.id, x]));
      expect(r.links.map((x) => x.link.channel.name)).toEqual(['Instagram', 'Instagram', 'TikTok', 'Influencers', 'Press', 'Shops', 'Search', 'Other']);
      expect(r.links.slice(0, 2).map((x) => x.link.id)).toEqual([L.LI, L.LA]);
      expect(byId.get(L.LI!)!.figures).toEqual(F(1, 2, 48_000));
      expect(byId.get(L.LI!)!.returns).toEqual({ revenueMinor: 48_000, costMinor: 10_000, currency: 'EUR', ratio: 4.8 });
      expect(byId.get(L.LT!)!.figures).toEqual(F(1, 0, 20_000));
      expect(byId.get(L.LT!)!.returns).toBeNull();
      expect(byId.get(L.LA!)!.figures).toEqual(F(1, 0, 0));
      expect(byId.get(L.LF!)!.figures).toEqual(F(0, 0, 0));
      expect(byId.get(L.LF!)!.returns).toEqual({ revenueMinor: 0, costMinor: 0, currency: 'EUR', ratio: null });
      expect(r.links.filter((x) => ![L.LI, L.LT, L.LA].includes(x.link.id)).every((x) => x.figures.entries === 0 && x.figures.buyers === 0 && x.figures.revenueMinor === 0)).toBe(true);
      expect(r.other).toEqual(F(2, 1, 15_000));
      expect(r.total).toEqual(F(5, 3, 83_000));
      const sum = [...r.links.map((x) => x.figures), r.other].reduce((t, f) => F(t.entries + f.entries, t.buyers + f.buyers, t.revenueMinor + f.revenueMinor), F(0, 0, 0));
      expect(sum).toEqual(r.total);

      // Drawn: FINAL (a draw of its own, its seed committed so that the draw can reveal it).
      const seed = new Uint8Array(randomBytes(32));
      const drawn = (
        await h.t.db
          .insertInto('drops')
          .values({
            model_id: model,
            title: 'DRAWN',
            quantity: 1,
            opens_at: z('2026-11-02T12:00:00Z'),
            closes_at: z('2026-11-03T12:00:00Z'),
            seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
            seed_hash: new Uint8Array(createHash('sha256').update(seed).digest()),
            published_at: z('2026-11-01T12:00:00Z'),
            mode: 'DRAW',
            early_access_hours: 0,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      expect((await svc().campaign(drawn)).readout.stage).toBe('SO_FAR');
      await h.t.db.updateTable('drops').set({ drawn_at: z('2026-11-04T12:00:00Z'), seed }).where('id', '=', drawn).execute();
      expect((await svc().campaign(drawn)).readout.stage).toBe('FINAL');
    });

    it('refuses a draft, a cancelled release, an unknown or malformed id', async () => {
      const draft = await w.drop({ mode: 'DRAW', modelId: model, title: 'DRAFT', opens: '2026-11-20', quantity: 1, published: false });
      const cancelled = await w.drop({ mode: 'DRAW', modelId: model, title: 'CANCELLED', opens: '2026-11-20', quantity: 1, cancelled: true });
      await expect(svc().makeLinks(draft.id, actor)).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_PUBLISHED', httpStatus: 409 });
      await expect(svc().makeLinks(cancelled.id, actor)).rejects.toMatchObject({ code: 'CAMPAIGN_CANCELLED', httpStatus: 409 });
      expect((await svc().campaign(cancelled.id)).readout.stage).toBe('FINAL');
      expect((await svc().campaign(draft.id)).release.published).toBe(false);
      for (const id of ['00000000-0000-4000-8000-000000000000', 'nope']) {
        await expect(svc().campaign(id)).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
        await expect(svc().makeLinks(id, actor)).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
      }
      expect(await h.t.db.selectFrom('links').select('id').where('drop_id', 'in', [draft.id, cancelled.id]).execute()).toEqual([]);
    });

    it('makes each link once when two clicks meet', async () => {
      const twice = await w.drop({ mode: 'DRAW', modelId: model, title: 'TWICE', opens: '2026-11-21', quantity: 1 });
      const [a, b] = await Promise.all([svc().makeLinks(twice.id, actor), svc().makeLinks(twice.id, actor)]);
      expect(a.made.length + b.made.length).toBe(7);
      const all = await h.t.db.selectFrom('links').select(['channel_id']).where('drop_id', '=', twice.id).execute();
      expect(new Set(all.map((l) => l.channel_id)).size).toBe(7);
      expect(all).toHaveLength(7);
    });
  });

  it('reads the campaign in one REPEATABLE READ, READ ONLY transaction', async () => {
    const R = await w.drop({ mode: 'DRAW', modelId: model, title: 'ONE MOMENT', opens: '2026-11-22', quantity: 1 });
    const channelsOf = links().channels.bind(links());
    let seen: { i: string; r: string } | undefined;
    links().channels = async (tx) => {
      seen = (await sql<{ i: string; r: string }>`SELECT current_setting('transaction_isolation') AS i, current_setting('transaction_read_only') AS r`.execute(tx!)).rows[0];
      return channelsOf(tx);
    };
    try {
      await svc().campaign(R.id);
    } finally {
      links().channels = channelsOf;
    }
    expect(seen).toEqual({ i: 'repeatable read', r: 'on' });
  });

  describe('a LIVE RELEASE and its after-room', () => {
    let L: { id: string; sizeId: string | null };
    let AR: { id: string; sizeId: string | null };
    let campaign: ReleaseCampaign;

    beforeAll(async () => {
      h.clock.set('2026-11-08T08:00:00Z');
      L = await w.drop({ mode: 'LIVE', modelId: model, title: `NOCTURNE ${'M'.repeat(100)}`, opens: '2026-11-10', quantity: 3 });
      await h.t.db.updateTable('drops').set({ opens_at: z('2026-11-10T23:30:00Z'), closes_at: z('2026-11-11T00:30:00Z') }).where('id', '=', L.id).execute();
      AR = await w.drop({ mode: 'LIVE', modelId: model, title: 'AFTER', opens: '2026-11-11', quantity: 1, parentId: L.id });
    });

    it('makes its links from its opening day in Paris, its long title cut, and refuses its after-room', async () => {
      const { made } = await svc().makeLinks(L.id, actor);
      expect(made).toHaveLength(7);
      expect(made.map((l) => l.code)).toEqual(['instagram', 'tiktok', 'influencers', 'press', 'shops', 'search', 'other'].map((c) => `release-11-nov-${c}`));
      for (const l of made) {
        expect(l.name.length).toBeLessThanOrEqual(LINK_NAME_MAX);
        expect(l.name.endsWith(`… · ${l.channel.name}`)).toBe(true);
      }
      await expect(svc().campaign(AR.id)).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
      await expect(svc().makeLinks(AR.id, actor)).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
      campaign = await svc().campaign(L.id);
      expect(campaign.readout.stage).toBe('UPCOMING');
      expect(campaign.readout.opensAt).toEqual(z('2026-11-10T23:25:00Z'));
      expect(campaign.readout.currency).toBe('EUR');
    });

    it('counts its own entries, and its after-room’s orders with its own', async () => {
      const instagram = campaign.channels[0]!.links[0]!.id;
      const a = await liveEntry(L, acc.A!);
      await convert('LIVE_ENTRY', a, acc.A!, instagram);
      await liveEntry(L, acc.B!);
      const c = await liveEntry(AR, acc.C!);
      const paidA = await w.order({ accountId: acc.A!, modelId: model, channel: 'LIVE', dropId: L.id, liveEntryId: a, paid: '2026-11-10', total: 50_000, currency: 'EUR' });
      await convert('ORDER', paidA, acc.A!, instagram);
      await w.order({ accountId: acc.C!, modelId: model, channel: 'LIVE', dropId: AR.id, liveEntryId: c, paid: '2026-11-11', total: 25_000, currency: 'EUR' });
      h.clock.set('2026-11-10T23:40:00Z');
      const r = (await svc().campaign(L.id)).readout;
      expect(r.stage).toBe('SO_FAR');
      expect(r.links.find((x) => x.link.id === instagram)!.figures).toEqual(F(1, 1, 50_000));
      expect(r.other).toEqual(F(1, 1, 25_000));
      expect(r.total).toEqual(F(2, 2, 75_000));
      await h.t.db.updateTable('drops').set({ ended_at: z('2026-11-10T23:50:00Z'), ended_reason: 'SOLD_OUT' }).where('id', '=', L.id).execute();
      expect((await svc().campaign(L.id)).readout.stage).toBe('FINAL');
    });
  });

  describe('over HTTP (routes/admin/drops.ts)', () => {
    it('reads for an AUDITOR, makes for an OPERATOR only, with its CSRF token; 404 for an unknown release, 400 for a malformed id', async () => {
      const R = await w.drop({ mode: 'DRAW', modelId: model, title: 'OVER HTTP', opens: '2026-11-25', quantity: 1 });
      const auditor = await adminClient(h, 'AUDITOR');
      const operator = await adminClient(h, 'OPERATOR');
      const read = await auditor.get(`/api/admin/releases/${R.id}/campaign`);
      expect(read.statusCode, read.body).toBe(200);
      expect((safeJson(read) as ReleaseCampaign).missing).toHaveLength(7);
      expect((await auditor.post(`/api/admin/releases/${R.id}/campaign/links`)).statusCode).toBe(403);
      const made = await operator.post(`/api/admin/releases/${R.id}/campaign/links`);
      expect(made.statusCode, made.body).toBe(200);
      const body = safeJson(made) as { made: { code: string }[]; campaign: ReleaseCampaign };
      expect(body.made).toHaveLength(7);
      expect(body.campaign.missing).toEqual([]);
      expect(body.campaign.readout.total).toEqual(F(0, 0, 0));
      expect((await operator.post(`/api/admin/releases/${R.id}/campaign/links`, { unexpected: true })).statusCode).toBe(400);
      expect(errorOf(await auditor.get('/api/admin/releases/00000000-0000-4000-8000-000000000000/campaign')).code).toBe('DROP_NOT_FOUND');
      expect((await auditor.get('/api/admin/releases/nope/campaign')).statusCode).toBe(400);
      expect((await h.client().get(`/api/admin/releases/${R.id}/campaign`)).statusCode).toBe(401);
    });
  });
});
