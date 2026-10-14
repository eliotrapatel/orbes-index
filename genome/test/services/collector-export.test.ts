/**
 * The Collectors export (plan CUSTOMER INTELLIGENCE §3.6 C.7, C.13 « collector-export.test.ts »; step 9.12;
 * services/collector-export.ts, CollectorInsightsService.exportCsv):
 *
 *  - the header row pinned: the 76 columns of version 1, in their order;
 *  - a row's every column from seeded data: the profile (a date of birth set by Client Services, Other's words), the
 *    default address of two, the tastes, the open wishes newest first, the tags, the tier and the pieces, the lifetime
 *    value per currency, the paid orders, the releases and the pieces secured, the LIVE attended after I'LL BE THERE,
 *    where they came from (a link), what they looked at and their device, the score and its parts, active now; a
 *    collector with nothing reads empty cells and zeros;
 *  - formula signs neutralised (core/render/csv.ts csvField);
 *  - the five filters applied, alone and combined; the period and the scope are not the export's;
 *  - test entrants, the team's own accounts and DELETED accounts absent; a LOCKED account present;
 *  - one export at a time (409 EXPORT_RUNNING);
 *  - the audit `collectors.export` written with the filters, the row count and the columns' version only, after the
 *    reading and before the body: an audit that fails gives no file.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { COLLECTOR_EXPORT_COLUMNS, addressLine, valueWords } from '../../src/server/services/collector-export.js';
import { CollectorInsightsService } from '../../src/server/services/collector-insights.js';
import { parisDateTime } from '../../src/server/services/schedule.js';
import type { Actor } from '../../src/server/types.js';
import { GrowthWorld } from '../support/growth.js';
import { seedScore } from '../support/scores.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';

const z = (iso: string) => new Date(iso);
const NOW = '2026-10-14T10:00:00Z'; // 12:00 Paris

/** The CSV's lines parsed back (every field quoted, CRLF): enough for the export's own output. */
function parseCsv(body: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  return rows;
}

describe('the Collectors export (§3.6 C.7)', () => {
  let h: Harness;
  let svc: CollectorInsightsService;
  let w: GrowthWorld;
  let actor: Actor;
  let adminId = '';
  const acc: Record<string, string> = {};
  const emails: Record<string, string> = {};

  const account = async (key: string, created: string, country: string | null, o: { status?: 'ACTIVE' | 'LOCKED' | 'DELETED'; email?: string; displayName?: string } = {}) => {
    const email = o.email ?? `export-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
    emails[key] = email;
    acc[key] = (
      await h.t.db
        .insertInto('accounts')
        .values({ email, email_normalized: email.toLowerCase(), password_hash: 'x', country, status: o.status ?? 'ACTIVE', display_name: o.displayName ?? null, created_at: z(created) })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    return acc[key]!;
  };

  const exportOf = async (q: Parameters<CollectorInsightsService['exportCsv']>[0] = {}) => {
    const file = await svc.exportCsv(q, actor);
    const [header, ...rows] = parseCsv(file.body.join(''));
    return { file, header: header!, rows: rows.map((r) => Object.fromEntries(header!.map((c, i) => [c, r[i]!]))) as Record<string, string>[] };
  };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-09-01T08:00:00Z');
    await h.t.db.updateTable('acquisition_state').set({ tracking_started_at: z('2026-09-01T08:00:00Z'), conversions_until: z('2026-09-01T08:00:00Z') }).execute();
    w = await new GrowthWorld(h.t.db).prepare();
    const admin = await createAdmin(h.ctx, 'ADMIN');
    adminId = admin.id;
    actor = { type: 'admin', id: admin.id };
    const model = await w.model('MONOLITHE', { price: [30_000, 'EUR'] });
    await h.t.db.updateTable('models').set({ variant_label: 'Silver', variant_swatch: '#C0C0C0' }).where('id', '=', model).execute();
    const blue = await w.model('MONOLITHE', { variantOf: model, label: 'Blue', swatch: '#1F3A93' });
    const orbite = await w.model('ORBITE', { price: [10_000, 'EUR'] });

    // A: everything held. Arrives through a link on 2 Oct and signs up on that device the same day.
    const channel = (await h.ctx.services.links.channels()).find((c) => c.name === 'Instagram')!;
    const link = await h.ctx.services.links.create({ name: 'Instagram bio', channelId: channel.id, destination: 'NOW' }, actor);
    const device = (
      await h.t.db
        .insertInto('tracking_devices')
        .values({ device_hash: `xa${'a'.repeat(41)}`, kind: 'PHONE', os: 'IOS', browser: 'SAFARI', opened_in: 'IN_APP', in_app: 'INSTAGRAM', first_seen_at: z('2026-10-02T08:00:00Z'), last_seen_at: z('2026-10-12T10:00:00Z') })
        .returning(['id', 'device_hash'])
        .executeTakeFirstOrThrow()
    );
    await h.ctx.services.acquisition.arrive({ deviceId: device.id, accountId: null, now: z('2026-10-02T08:00:00Z'), link: link.code });
    await account('A', '2026-10-02T09:00:00Z', 'FR', { displayName: 'Camille Martin' });
    await h.ctx.services.tracking.link(device.device_hash, acc.A!, 'SIGN_UP', z('2026-10-02T09:00:00Z'));
    const other = (await h.t.db.selectFrom('heard_options').select('id').where('is_other', '=', true).executeTakeFirstOrThrow()).id;
    await h.t.db
      .insertInto('account_profiles')
      .values({
        account_id: acc.A!,
        first_name: 'Camille',
        last_name: 'Martin',
        phone: '+33639980001',
        phone_country: 'FR',
        birth_date: '1990-05-20',
        birth_date_by: 'STAFF',
        birth_date_at: z('2026-10-03T10:00:00Z'),
        city: 'Lyon',
        instagram: 'camille.m',
        heard_option_id: other,
        heard_other: 'a stylist',
        heard_at: z('2026-10-02T09:00:00Z'),
      })
      .execute();
    await h.t.db
      .insertInto('account_addresses')
      .values([
        { account_id: acc.A!, name: 'Camille Martin', address: '12 rue de la Paix\n\n75002 Paris', country: 'FR', phone: '+33 6 39 98 00 01', is_default: true },
        { account_id: acc.A!, name: 'Office', address: '1 place Bellecour\n69002 Lyon', country: 'FR', phone: '+33 6 39 98 00 02', is_default: false },
      ])
      .execute();
    // Tastes the catalogue no longer shows keep their own words.
    await h.t.db
      .insertInto('account_tastes')
      .values([
        { account_id: acc.A!, kind: 'PIECE', value_key: 'RING', label: 'RING', created_at: z('2026-10-02T09:00:00Z') },
        { account_id: acc.A!, kind: 'PIECE', value_key: 'CUFF', label: 'CUFF', created_at: z('2026-10-02T09:00:00Z') },
        { account_id: acc.A!, kind: 'FINISH', value_key: 'GOLD', label: 'Gold', created_at: z('2026-10-02T09:00:00Z') },
      ])
      .execute();
    await h.t.db
      .insertInto('account_wishes')
      .values([
        { account_id: acc.A!, model_id: blue, added_at: z('2026-10-05T10:00:00Z') },
        { account_id: acc.A!, model_id: orbite, added_at: z('2026-10-08T10:00:00Z') },
        { account_id: acc.A!, model_id: model, added_at: z('2026-10-04T10:00:00Z'), removed_at: z('2026-10-06T10:00:00Z') },
      ])
      .execute();
    await h.t.db
      .insertInto('account_tags')
      .values([
        { account_id: acc.A!, tag: 'VIP', created_by: adminId, created_at: z('2026-10-03T10:00:00Z') },
        { account_id: acc.A!, tag: 'PRESS', created_by: adminId, created_at: z('2026-10-04T10:00:00Z') },
      ])
      .execute();
    await h.t.db.insertInto('account_notes').values({ account_id: acc.A!, body: 'Prefers a call after 18:00.', created_by: adminId }).execute();
    // A piece registered (a purchase at its model's price), a salon order in euros, one in pounds, one cancelled, a gift.
    await w.own(acc.A!, await w.piece(model), 'FIRST_REGISTRATION', '2026-07-01');
    await w.order({ accountId: acc.A!, modelId: blue, channel: 'SALON', paid: '2026-10-10', total: 45_000, currency: 'EUR' });
    await w.order({ accountId: acc.A!, modelId: orbite, channel: 'SALON', paid: '2026-10-11', total: 5_000, currency: 'GBP' });
    await w.order({ accountId: acc.A!, modelId: orbite, channel: 'SALON', paid: '2026-10-12', total: 9_000, currency: 'EUR', status: 'CANCELLED', ended: '2026-10-13' });
    // A draw whose place it concluded, and a LIVE RELEASE it said it would be at (I'LL BE THERE) and missed.
    const draw = await w.drop({ mode: 'DRAW', modelId: model, title: 'THE OCTOBER DRAW', opens: '2026-10-05', quantity: 5 });
    await w.drawEntry(draw.id, acc.A!, 'CONFIRMED', '2026-10-05');
    const live = await w.drop({ mode: 'LIVE', modelId: blue, title: 'MONOLITHE IN BLUE', opens: '2026-10-08', quantity: 5 });
    await h.t.db.insertInto('live_interest').values({ drop_id: live.id, account_id: acc.A!, size_id: live.sizeId!, created_at: z('2026-10-06T10:00:00Z') }).execute();
    // What it looked at: two model views (3 min) and a scan, on its phone.
    for (const [at, page, subject, seconds] of [
      ['2026-10-03T10:00:00Z', VIEW_PAGE_CODES.MODEL, blue, 120],
      ['2026-10-12T10:00:00Z', VIEW_PAGE_CODES.MODEL, blue, 60],
      ['2026-10-12T10:05:00Z', VIEW_PAGE_CODES.SCAN, null, 0],
    ] as const) {
      await h.t.db.insertInto('collector_views').values({ at: z(at), device_id: device.id, account_id: acc.A!, page, subject, seconds, place_id: null }).execute();
    }
    // Its latest sign-in, after the views: last seen.
    h.clock.set('2026-10-13T18:30:00Z');
    await h.ctx.audit.record({ actor: { type: 'account', id: acc.A! }, action: 'account.login', targetType: 'account', targetId: acc.A! });
    // The morning's score: written at 07:40 UTC, the run finished at 07:45 UTC.
    await seedScore(h.t.db, acc.A!, 72, z('2026-10-14T07:40:00Z'));
    await h.t.db.insertInto('engagement_runs').values({ day: '2026-10-14', formula: 1, started_at: z('2026-10-14T07:30:00Z'), finished_at: z('2026-10-14T07:45:00Z'), accounts: 1, changed: 1, bands: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0], duration_ms: 10 }).execute();
    await h.ctx.services.acquisition.recordConversions(z('2026-10-14T09:00:00Z'));

    // B: LOCKED, nothing else; C: a name a spreadsheet would read as a formula; I: in Italy, scored 30.
    await account('B', '2026-09-10T10:00:00Z', 'FR', { status: 'LOCKED' });
    await account('C', '2026-09-11T10:00:00Z', 'FR', { displayName: '=HYPERLINK("http://x.test","y")' });
    await h.t.db.insertInto('account_profiles').values({ account_id: acc.C!, city: '+33 Lyon', heard_option_id: other, heard_other: '@a stylist', heard_at: z('2026-09-11T10:00:00Z') }).execute();
    await account('I', '2026-09-12T10:00:00Z', 'IT');
    await seedScore(h.t.db, acc.I!, 30, z('2026-10-14T07:40:00Z'));
    await h.t.db.insertInto('account_tastes').values({ account_id: acc.I!, kind: 'PIECE', value_key: 'RING', label: 'RING', created_at: z('2026-10-02T09:00:00Z') }).execute();
    // Never in the export: a test entrant, one of the team's own accounts, a DELETED account.
    await account('T', '2026-09-13T10:00:00Z', 'FR');
    await h.t.db.insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    const team = await createAdmin(h.ctx, 'AUDITOR');
    await account('H', '2026-09-14T10:00:00Z', 'FR', { email: team.email });
    await account('X', '2026-09-15T10:00:00Z', 'FR', { status: 'DELETED' });

    h.clock.set(NOW);
    svc = h.ctx.services.collectorInsights;
  }, 120_000);
  afterAll(() => h?.close());

  it('the header row: the 76 columns of version 1, in their order', async () => {
    expect(COLLECTOR_EXPORT_COLUMNS).toEqual([
      'account id', 'email', 'first name', 'last name', 'display name', 'status', 'account created (Paris)', 'country', 'city', 'phone',
      'phone country', 'date of birth', 'age', 'date of birth set by', 'instagram', 'how they heard', 'how they heard (other)',
      'default address name', 'default address', 'default address country', 'default address phone', 'saved addresses',
      'profile complete (%)', 'favourite pieces', 'favourite finishes', 'wishlist', 'wishes', 'tags', 'tier', 'pieces held',
      'lifetime value', 'paid orders', 'releases taken part in', 'pieces secured', "LIVE attended after I'LL BE THERE",
      'first visit (Paris)', 'first source kind', 'first link', 'first channel', 'first utm source', 'first utm medium',
      'first utm campaign', 'first site', 'sign-up source kind', 'sign-up link', 'sign-up channel', 'sign-up utm campaign',
      'sign-up site', 'latest purchase (Paris)', 'latest purchase link', 'days browsing before sign-up', 'views, 13 months',
      'minutes, 13 months', 'active days, 30', 'active days, 90', 'last seen (Paris)', 'top models', 'releases viewed', 'scans',
      'scans before the account', 'devices', 'main device', 'opened in apps', 'usual country', 'usual city', 'other cities',
      'views before 13 months', 'minutes before 13 months', 'score', 'recency points', 'frequency points', 'spend points',
      'release speed points', 'attendance points', 'score calculated (Paris)', 'active now',
    ]);
    expect(COLLECTOR_EXPORT_COLUMNS).toHaveLength(76);
    const { file, header } = await exportOf();
    expect(header).toEqual([...COLLECTOR_EXPORT_COLUMNS]);
    expect(file.body[0]).toBe(`${COLLECTOR_EXPORT_COLUMNS.map((c) => `"${c}"`).join(',')}\r\n`);
    expect(file).toMatchObject({ filename: 'orbes-collectors-2026-10-14.csv', contentType: 'text/csv; charset=utf-8; header=present' });
  });

  it('a row holds every column from the seeded data; a collector with nothing reads empty cells and zeros', async () => {
    const { rows } = await exportOf();
    const a = rows.find((r) => r['account id'] === acc.A)!;
    expect(a).toEqual({
      'account id': acc.A,
      email: emails.A,
      'first name': 'Camille',
      'last name': 'Martin',
      'display name': 'Camille Martin',
      status: 'ACTIVE',
      'account created (Paris)': '2026-10-02 11:00',
      country: 'FR',
      city: 'Lyon',
      // E.164 starts with +, a formula sign: neutralised like every other field (core/render/csv.ts).
      phone: "'+33639980001",
      'phone country': 'FR',
      'date of birth': '1990-05-20',
      age: '36',
      'date of birth set by': 'Client Services',
      instagram: 'camille.m',
      'how they heard': 'Other',
      'how they heard (other)': 'a stylist',
      'default address name': 'Camille Martin',
      'default address': '12 rue de la Paix / 75002 Paris',
      'default address country': 'FR',
      'default address phone': "'+33 6 39 98 00 01",
      'saved addresses': '2',
      // Every item but nothing to choose among the pieces and finishes: the catalogue shows none, the account holds some.
      'profile complete (%)': '100',
      'favourite pieces': 'CUFF | RING',
      'favourite finishes': 'Gold',
      wishlist: 'ORBITE | MONOLITHE · Blue',
      wishes: '2',
      tags: 'VIP · PRESS',
      tier: 'TITANE',
      'pieces held': '1',
      'lifetime value': 'EUR 750.00 · GBP 50.00',
      'paid orders': '2',
      'releases taken part in': '1',
      'pieces secured': '1',
      "LIVE attended after I'LL BE THERE": '0 / 1',
      'first visit (Paris)': '2026-10-02 10:00',
      'first source kind': 'LINK',
      'first link': 'Instagram bio',
      'first channel': 'Instagram',
      'first utm source': '',
      'first utm medium': '',
      'first utm campaign': '',
      'first site': '',
      'sign-up source kind': 'LINK',
      'sign-up link': 'Instagram bio',
      'sign-up channel': 'Instagram',
      'sign-up utm campaign': '',
      'sign-up site': '',
      'latest purchase (Paris)': parisDateTime(z('2026-10-11T12:00:00Z')),
      'latest purchase link': 'Instagram bio',
      'days browsing before sign-up': '0',
      'views, 13 months': '2',
      'minutes, 13 months': '3',
      'active days, 30': '2',
      'active days, 90': '2',
      'last seen (Paris)': '2026-10-13 20:30',
      'top models': 'MONOLITHE BLUE',
      'releases viewed': '0',
      scans: '1',
      'scans before the account': '0',
      // Inside Instagram: the device without its browser.
      devices: 'iPhone',
      'main device': 'Phone iOS',
      'opened in apps': 'Instagram',
      'usual country': '',
      'usual city': '',
      'other cities': '',
      'views before 13 months': '0',
      'minutes before 13 months': '0',
      score: '72',
      'recency points': '25',
      'frequency points': '20',
      'spend points': '25',
      'release speed points': '2',
      'attendance points': '0',
      'score calculated (Paris)': '2026-10-14 09:45',
      'active now': 'yes',
    });
    const b = rows.find((r) => r['account id'] === acc.B)!;
    // Its country alone, of the 8 items counted (the catalogue offers no piece nor finish to choose, and it holds none).
    expect(b).toMatchObject({ status: 'LOCKED', 'first name': '', city: '', 'date of birth': '', age: '', 'date of birth set by': '', 'saved addresses': '0', 'profile complete (%)': '13' });
    expect(b).toMatchObject({ wishlist: '', wishes: '0', tags: '', tier: 'NO TIER', 'pieces held': '0', 'lifetime value': '', 'paid orders': '0', "LIVE attended after I'LL BE THERE": '0 / 0' });
    expect(b).toMatchObject({ 'first source kind': 'DIRECT', 'latest purchase (Paris)': '', 'latest purchase link': '', 'views, 13 months': '0', 'last seen (Paris)': '', devices: '', score: '', 'recency points': '', 'score calculated (Paris)': '', 'active now': 'no' });
    // The private notes are never exported (question 19).
    const text = (await svc.exportCsv({}, actor)).body.join('');
    expect(text).not.toContain('Prefers a call');
  });

  it('formula signs are neutralised', async () => {
    const { rows, file } = await exportOf();
    const c = rows.find((r) => r['account id'] === acc.C)!;
    expect(c['display name']).toBe(`'=HYPERLINK("http://x.test","y")`);
    expect(c.city).toBe(`'+33 Lyon`);
    expect(c['how they heard (other)']).toBe(`'@a stylist`);
    expect(file.body.join('')).toContain(`"'=HYPERLINK(""http://x.test"",""y"")"`);
  });

  it('test entrants, the team’s own accounts and DELETED accounts are never in it; LOCKED ones are; ordered by account id', async () => {
    const { rows, file } = await exportOf();
    const ids = rows.map((r) => r['account id']);
    expect([...ids].sort()).toEqual([acc.A, acc.B, acc.C, acc.I].sort());
    expect(ids).toEqual([...ids].sort());
    expect(file.rows).toBe(4);
    const text = file.body.join('');
    for (const k of ['T', 'H', 'X']) expect(text).not.toContain(emails[k]!);
  });

  it('the five filters apply, alone and combined; the period and the scope are not the export’s', async () => {
    const ids = async (q: Parameters<CollectorInsightsService['exportCsv']>[0]) => (await exportOf(q)).rows.map((r) => r['account id']).sort();
    expect(await ids({ c: 'IT' })).toEqual([acc.I]);
    expect(await ids({ c: 'FR,IT', t: '1' })).toEqual([acc.A]);
    expect(await ids({ t: '0' })).toEqual([acc.B, acc.C, acc.I].sort());
    expect(await ids({ sc: '20-40' })).toEqual([acc.I]);
    expect(await ids({ sc: '0-100' })).toEqual([acc.A, acc.I].sort());
    expect(await ids({ ft: 'RING' })).toEqual([acc.A, acc.I].sort());
    expect(await ids({ ft: 'RING', c: 'FR' })).toEqual([acc.A]);
    const instagram = (await h.ctx.services.links.channels()).find((c) => c.name === 'Instagram')!.id;
    expect(await ids({ s: instagram })).toEqual([acc.A]);
    expect(await ids({ s: 'kind:DIRECT' })).toEqual([acc.B, acc.C, acc.I].sort());
    await expect(svc.exportCsv({ c: 'France' }, actor)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.exportCsv({ sc: '50-10' }, actor)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('one export at a time: a second one while the first is made gets 409 EXPORT_RUNNING; after it, another may start', async () => {
    const first = svc.exportCsv({}, actor);
    await expect(svc.exportCsv({}, actor)).rejects.toMatchObject({ code: 'EXPORT_RUNNING', httpStatus: 409, message: 'An export is being made. Try again when it is done.' });
    expect((await first).rows).toBe(4);
    expect((await svc.exportCsv({}, actor)).rows).toBe(4);
  });

  it('the audit: collectors.export with the filters, the rows and the columns’ version, never an email; after the reading, before the body', async () => {
    const before = await h.t.db.selectFrom('audit_logs').select((eb) => eb.fn.max('id').as('id')).executeTakeFirstOrThrow();
    const file = await svc.exportCsv({ c: 'fr,it', t: '1,0', sc: '0-100', ft: 'ring' }, actor);
    const entries = await h.t.db.selectFrom('audit_logs').selectAll().where('id', '>', Number(before.id)).where('action', '=', 'collectors.export').execute();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e).toMatchObject({ actor_type: 'admin', actor_id: adminId, target_type: 'collectors', target_id: null });
    const details = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
    expect(details).toEqual({ filters: { countries: ['FR', 'IT'], sources: { channelIds: [], kinds: [] }, tiers: [0, 1], score: { min: 0, max: 100 }, types: ['RING'] }, rows: file.rows, columns: 1 });
    expect(file.rows).toBe(2);
    expect(JSON.stringify(details)).not.toMatch(/@example\.com|Camille/);

    // The order: every row read, then the audit, then the body handed back; an audit that fails gives no file.
    const order: string[] = [];
    const audited = new CollectorInsightsService({
      db: h.t.db,
      links: h.ctx.services.links,
      clock: h.clock.now,
      audit: {
        record: async (entry) => {
          order.push(`audit:${String((entry.details as { rows: number }).rows)}`);
          return h.ctx.audit.record(entry);
        },
      },
    });
    const made = await audited.exportCsv({}, actor);
    order.push('body');
    expect(order).toEqual(['audit:4', 'body']);
    expect(made.rows).toBe(4);
    const failing = new CollectorInsightsService({
      db: h.t.db,
      links: h.ctx.services.links,
      clock: h.clock.now,
      audit: { record: async () => Promise.reject(new Error('the audit log is unavailable')) },
    });
    await expect(failing.exportCsv({}, actor)).rejects.toThrow('the audit log is unavailable');
    // …and the failed one does not hold the next export back.
    await expect(failing.exportCsv({}, actor)).rejects.toThrow('the audit log is unavailable');
  });

  it('valueWords and addressLine', () => {
    expect(valueWords([{ currency: 'GBP', valueMinor: 30_000 }, { currency: 'EUR', valueMinor: 124_000 }])).toBe('EUR 1240.00 · GBP 300.00');
    expect(valueWords([])).toBe('');
    expect(addressLine('  12 rue de la Paix \r\n\r\n 75002 Paris\n')).toBe('12 rue de la Paix / 75002 Paris');
  });
});
