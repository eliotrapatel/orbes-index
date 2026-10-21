/**
 * The founding list (plan MACRO M1 §3.1, §3.5 « founding.test.ts »; macro scope F2 to F5; services/founding.ts):
 *
 *  - F2: every field refused in the collector's words, all at once; the consent box ticked, nothing else; the honeypot
 *    filled stores nothing, whatever else is sent;
 *  - no enumeration: an address already on the list (in any case) leaves its row exactly as it was, nothing audited;
 *  - F3, the source: the console link of `o` (an archived one too), then the `utm_` tags, then the referring site
 *    (theorbes.com itself an inner move), then DIRECT;
 *  - F3, the match: at once with the account that has the address, at the account's sign-up otherwise (in its
 *    transaction), never a test entrant's account; audited `founding.match`;
 *  - unsubscribe keeps the row (§11 note 9); removal on request (ADMIN, a phrase) deletes it;
 *  - the console's reads: the list (filters, emails masked for an AUDITOR), the summary, the CSV in a Shopify import's
 *    columns; the right of access's `foundingList`;
 *  - F4: the segment rule FOUNDING_LIST (matched, live, never a test entrant, negated);
 *  - concurrent registrations of one address make one row (on PGlite always; on PostgreSQL with
 *    ORBES_TEST_POSTGRES_URL, a pool of 8: genome-ci).
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AcquisitionService } from '../../src/server/services/acquisition.js';
import { AuditService } from '../../src/server/services/audit.js';
import {
  cleanFounding,
  FOUNDING_CONSENT_VERSION,
  FOUNDING_WORDS,
  FoundingFieldsError,
  FoundingService,
  removePhrase,
  type FoundingInput,
} from '../../src/server/services/founding.js';
import { isSegmentMember } from '../../src/server/services/segments.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, PASSWORD, safeJson, type Harness } from '../api/support.js';

const PUBLIC: Actor = { type: 'system', id: 'public' };
const person = (email: string, extra: Partial<FoundingInput> = {}): FoundingInput => ({ email, firstName: 'Léa', country: 'FR', consent: true, ...extra });

describe('FoundingService (plan MACRO M1 §3.1, F2 to F5)', () => {
  let h: Harness;
  let admin: Actor;
  let n = 0;
  const svc = () => h.ctx.services.founding;
  const unique = (tag = 'p') => `${tag}-${++n}-${randomBytes(3).toString('hex')}@example.com`;
  const row = (email: string) => h.ctx.db.selectFrom('preregistrations').selectAll().where('email_normalized', '=', email.toLowerCase()).executeTakeFirst();
  const sourceOf = async (email: string) => {
    const r = await row(email);
    return h.ctx.db.selectFrom('acquisition_sources').selectAll().where('id', '=', r!.source_id).executeTakeFirstOrThrow();
  };
  const audits = (action: string) => h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', action).orderBy('id').execute();
  const account = async (email: string) =>
    (await h.ctx.db.insertInto('accounts').values({ email, email_normalized: email.toLowerCase(), password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-21T08:00:00.000Z');
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
  });
  afterAll(() => h?.close());

  it('refuses each field in the collector’s words, every refused field at once, the first one’s words as the message', async () => {
    const all = await svc().register({}, PUBLIC).catch((e: unknown) => e);
    expect(all).toBeInstanceOf(FoundingFieldsError);
    expect((all as FoundingFieldsError).fields).toEqual({
      email: 'Enter your email.',
      firstName: 'Enter your first name.',
      country: 'Choose your country.',
      consent: 'Tick the box to join the list.',
    });
    expect((all as FoundingFieldsError).toResponse()).toEqual({ error: { code: 'VALIDATION_FAILED', message: 'Enter your email.', fields: (all as FoundingFieldsError).fields } });
    expect((all as FoundingFieldsError).httpStatus).toBe(400);
    const refused = (input: FoundingInput) => {
      try {
        cleanFounding(input);
        return {};
      } catch (e) {
        return (e as FoundingFieldsError).fields;
      }
    };
    const ok = person('lea@example.com');
    for (const [input, fields] of [
      [{ ...ok, email: 'not-an-address' }, { email: FOUNDING_WORDS.email }],
      [{ ...ok, email: `${'x'.repeat(250)}@e.co` }, { email: FOUNDING_WORDS.email }],
      [{ ...ok, firstName: '   ' }, { firstName: FOUNDING_WORDS.firstName }],
      [{ ...ok, firstName: 'x'.repeat(81) }, { firstName: FOUNDING_WORDS.firstName }],
      [{ ...ok, firstName: '<b>Léa</b>' }, { firstName: FOUNDING_WORDS.firstName }],
      [{ ...ok, country: 'XX' }, { country: FOUNDING_WORDS.country }],
      [{ ...ok, country: 'France' }, { country: FOUNDING_WORDS.country }],
      // Only a ticked box: never a string, never false.
      [{ ...ok, consent: 'true' }, { consent: FOUNDING_WORDS.consent }],
      [{ ...ok, consent: false }, { consent: FOUNDING_WORDS.consent }],
      [{ ...ok, consent: undefined }, { consent: FOUNDING_WORDS.consent }],
    ] as [FoundingInput, Record<string, string>][]) {
      expect(refused(input), JSON.stringify(input).slice(0, 60)).toEqual(fields);
    }
    // Trimmed, NFC, the country in capitals, the address's lookup key in lower case; 80 characters is the bound.
    expect(cleanFounding({ ...ok, email: '  Lea@Example.COM ', firstName: ' Léa ', country: 'fr' })).toEqual({ email: 'Lea@Example.COM', normalized: 'lea@example.com', firstName: 'Léa', country: 'FR' });
    expect(cleanFounding({ ...ok, firstName: 'x'.repeat(80) }).firstName).toHaveLength(80);
    expect(await h.ctx.db.selectFrom('preregistrations').select('id').execute()).toEqual([]);
  });

  it('adds a person with the consent’s time and the legal version, audited without the address; the honeypot filled stores nothing', async () => {
    const email = unique();
    const out = await svc().register(person(email.toUpperCase()), PUBLIC);
    expect(out).toEqual({ outcome: 'ADDED', id: expect.any(String), sourceKind: 'DIRECT', matched: null });
    const r = await row(email);
    expect(r).toMatchObject({ email: email.toUpperCase(), email_normalized: email, first_name: 'Léa', country: 'FR', consent_version: FOUNDING_CONSENT_VERSION, account_id: null, matched_at: null, unsubscribed_at: null });
    expect(r!.consent_at).toEqual(h.clock.now());
    expect(r!.created_at).toEqual(h.clock.now());
    const audit = (await audits('founding.register')).find((a) => a.target_id === r!.id)!;
    expect(audit).toMatchObject({ actor_type: 'system', actor_id: 'public', target_type: 'preregistration', details: { preregistrationId: r!.id, sourceKind: 'DIRECT' } });
    expect(JSON.stringify(audit)).not.toContain(email);
    // A robot fills the hidden field: nothing stored, nothing audited, the fields not even read.
    const bot = unique('bot');
    const before = (await audits('founding.register')).length;
    expect(await svc().register({ ...person(bot), website: 'https://spam.example' }, PUBLIC)).toEqual({ outcome: 'HONEYPOT' });
    expect(await svc().register({ email: 'junk', website: 'x' }, PUBLIC)).toEqual({ outcome: 'HONEYPOT' });
    expect(await row(bot)).toBeUndefined();
    expect(await audits('founding.register')).toHaveLength(before);
    // Blank is no honeypot (a browser's autofill of nothing).
    expect((await svc().register({ ...person(unique()), website: '  ' }, PUBLIC)).outcome).toBe('ADDED');
  });

  it('leaves an address already on the list exactly as it was, in any case, and answers the same (no enumeration)', async () => {
    const email = unique();
    await svc().register(person(email, { utm: { source: 'ig', campaign: 'first' } }), PUBLIC);
    const first = await row(email);
    h.clock.advance(60_000);
    const again = await svc().register(person(email.toUpperCase(), { firstName: 'Other', country: 'IT', o: 'whatever', referrer: 'https://www.google.com/' }), PUBLIC);
    expect(again).toEqual({ outcome: 'ALREADY' });
    expect(await row(email)).toEqual(first);
    expect((await audits('founding.register')).filter((a) => a.target_id === first!.id)).toHaveLength(1);
    // Unsubscribed, the row stays unsubscribed: a new form changes nothing.
    await svc().unsubscribe(first!.id, PUBLIC);
    expect((await svc().register(person(email), PUBLIC)).outcome).toBe('ALREADY');
    expect((await row(email))!.unsubscribed_at).not.toBeNull();
  });

  it('keeps where the person came from: the link of `o` (archived too), then the tags, then the referring site, then DIRECT', async () => {
    const channelId = (await h.ctx.services.links.channels())[0]!.id;
    const link = await h.ctx.services.links.create({ name: 'Founding bio', code: 'founding-bio', channelId, destination: 'LANDING' }, admin);
    const old = await h.ctx.services.links.create({ name: 'Old founding', code: 'old-founding', channelId, destination: 'LANDING' }, admin);
    await h.ctx.services.links.archive(old.id, admin);
    const cases: [Partial<FoundingInput>, Record<string, unknown>][] = [
      [{ o: 'FOUNDING-BIO', utm: { source: 'ig' }, referrer: 'https://l.instagram.com/x' }, { kind: 'LINK', link_id: link.id }],
      [{ o: 'old-founding' }, { kind: 'LINK', link_id: old.id }],
      // A code no link has: the next class down.
      [{ o: 'no-such-link', utm: { source: 'IG', medium: 'Story', campaign: 'Founding' } }, { kind: 'CAMPAIGN', utm_source: 'ig', utm_medium: 'story', utm_campaign: 'founding' }],
      [{ referrer: 'https://l.instagram.com/?u=https%3A%2F%2Ftheorbes.com' }, { kind: 'SITE', site: 'instagram.com' }],
      [{ referrer: 'https://verify.theorbes.com/verify' }, { kind: 'SITE', site: 'verify.theorbes.com' }],
      // theorbes.com itself (its form's own page) is an inner move, never a site.
      [{ referrer: 'https://theorbes.com/' }, { kind: 'DIRECT' }],
      [{ referrer: 'https://www.theorbes.com/?ref=x' }, { kind: 'DIRECT' }],
      [{}, { kind: 'DIRECT' }],
    ];
    for (const [signals, expected] of cases) {
      const email = unique('src');
      await svc().register(person(email, signals), PUBLIC);
      expect(await sourceOf(email), JSON.stringify(signals)).toMatchObject(expected);
    }
  });

  it('matches the account that has the address at once, and an address that signs up later in the account’s own transaction', async () => {
    // At once: the account exists.
    const known = unique('known');
    const id = await account(known);
    const out = await svc().register(person(known.toUpperCase()), PUBLIC);
    expect(out).toMatchObject({ outcome: 'ADDED', matched: id });
    expect(await row(known)).toMatchObject({ account_id: id, matched_at: h.clock.now() });
    const r = await row(known);
    expect((await audits('founding.match')).find((a) => a.target_id === r!.id)).toMatchObject({ details: { preregistrationId: r!.id, accountId: id, at: 'REGISTER' } });
    // At the sign-up (POST /api/v1/account/register).
    const later = unique('later');
    await svc().register(person(later), PUBLIC);
    h.clock.advance(5 * 60_000);
    const c = h.client();
    const res = await c.post('/api/v1/account/register', { email: later.toUpperCase(), password: PASSWORD, firstName: 'Léa', lastName: 'Martin', country: 'FR' });
    expect(res.statusCode, res.body).toBe(201);
    const accountId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', later).executeTakeFirstOrThrow()).id;
    const matched = await row(later);
    expect(matched).toMatchObject({ account_id: accountId, matched_at: h.clock.now() });
    const audit = (await audits('founding.match')).find((a) => a.target_id === matched!.id)!;
    expect(audit).toMatchObject({ actor_type: 'account', actor_id: accountId, details: { preregistrationId: matched!.id, accountId, at: 'SIGN_UP' } });
    // A sign-up with no pre-registration matches nothing.
    const { email: other } = await accountClient(h);
    expect(await row(other)).toBeUndefined();
    // A test entrant's account is never matched.
    const bot = unique('te');
    const te = await account(bot);
    await h.ctx.db.insertInto('test_entrants').values({ account_id: te }).execute();
    expect(await svc().register(person(bot), PUBLIC)).toMatchObject({ outcome: 'ADDED', matched: null });
    expect((await row(bot))!.account_id).toBeNull();
  });

  it('F4: FOUNDING_LIST holds the accounts matched to the list, live, never a test entrant, and negates', async () => {
    const segments = h.ctx.services.segments;
    const seg = await segments.create({ name: `Founding list ${n}`, criteria: { match: 'ALL', rules: [{ kind: 'FOUNDING_LIST' }] } }, admin);
    const not = await segments.create({ name: `Not founding ${n}`, criteria: { match: 'ALL', rules: [{ kind: 'FOUNDING_LIST', not: true }] } }, admin);
    expect(seg.criteria).toEqual({ match: 'ALL', rules: [{ kind: 'FOUNDING_LIST' }] });
    const listed = unique('seg');
    const member = await account(listed);
    await svc().register(person(listed), PUBLIC);
    const outsider = await account(unique('out'));
    const now = h.clock.now();
    expect(await isSegmentMember(h.ctx.db, seg.id, member, now)).toBe(true);
    expect(await isSegmentMember(h.ctx.db, seg.id, outsider, now)).toBe(false);
    expect(await isSegmentMember(h.ctx.db, not.id, outsider, now)).toBe(true);
    expect(await isSegmentMember(h.ctx.db, not.id, member, now)).toBe(false);
    // An unsubscribe stops the emails, not the early access.
    await svc().unsubscribe((await row(listed))!.id, PUBLIC);
    expect(await isSegmentMember(h.ctx.db, seg.id, member, now)).toBe(true);
    // A test entrant matched by hand still never is a member.
    const te = await account(unique('te2'));
    await h.ctx.db.insertInto('test_entrants').values({ account_id: te }).execute();
    const teMail = (await h.ctx.db.selectFrom('accounts').select('email').where('id', '=', te).executeTakeFirstOrThrow()).email;
    await svc().register(person(teMail), PUBLIC);
    await h.ctx.db.updateTable('preregistrations').set({ account_id: te, matched_at: now }).where('email_normalized', '=', teMail).execute();
    expect(await isSegmentMember(h.ctx.db, seg.id, te, now)).toBe(false);
    // Nothing lasting: removed from the list, out of the segment.
    await svc().remove((await row(listed))!.id, removePhrase((await row(listed))!.id), admin);
    expect(await isSegmentMember(h.ctx.db, seg.id, member, now)).toBe(false);
    // The console's count (test accounts left out) reads the rule too.
    expect(typeof (await segments.get(seg.id)).count).toBe('number');
  });

  it('unsubscribes once and keeps the row; an unknown or malformed id answers false', async () => {
    const email = unique('unsub');
    const { id } = (await svc().register(person(email), PUBLIC)) as { id: string };
    expect(await svc().unsubscribe(id, PUBLIC)).toBe(true);
    const at = (await row(email))!.unsubscribed_at;
    expect(at).toEqual(h.clock.now());
    h.clock.advance(1_000);
    expect(await svc().unsubscribe(id, PUBLIC)).toBe(false);
    expect((await row(email))!.unsubscribed_at).toEqual(at);
    expect((await audits('founding.unsubscribe')).filter((a) => a.target_id === id)).toHaveLength(1);
    expect(await svc().unsubscribe('00000000-0000-4000-8000-000000000000', PUBLIC)).toBe(false);
    expect(await svc().unsubscribe('nope', PUBLIC)).toBe(false);
  });

  it('removes a row on request: the phrase, then deleted and audited without the address; 404 for an unknown one', async () => {
    const email = unique('rm');
    const { id } = (await svc().register(person(email), PUBLIC)) as { id: string };
    expect(removePhrase(id)).toBe(`REMOVE ${id.slice(0, 8).toUpperCase()}`);
    await expect(svc().remove(id, 'REMOVE', admin)).rejects.toMatchObject({ httpStatus: 400, publicMessage: `Type ${removePhrase(id)} to confirm.` });
    expect(await row(email)).toBeDefined();
    await svc().remove(id, ` remove  ${id.slice(0, 8).toLowerCase()} `, admin);
    expect(await row(email)).toBeUndefined();
    const audit = (await audits('founding.remove')).find((a) => a.target_id === id)!;
    expect(audit).toMatchObject({ actor_type: 'admin', details: { preregistrationId: id, matched: false } });
    expect(JSON.stringify(audit)).not.toContain(email);
    await expect(svc().remove(id, removePhrase(id), admin)).rejects.toMatchObject({ code: 'PREREGISTRATION_NOT_FOUND', httpStatus: 404 });
    // Removed, the address may join again.
    expect((await svc().register(person(email), PUBLIC)).outcome).toBe('ADDED');
  });

  it('reads the list for the console: filters, emails masked for an AUDITOR, the summary, the CSV in a Shopify import’s columns (OPERATOR)', async () => {
    const auditor = await adminClient(h, 'AUDITOR');
    const operator = await adminClient(h, 'OPERATOR');
    const adminC = await adminClient(h, 'ADMIN');
    const res = await auditor.get('/api/admin/founding?pageSize=5');
    expect(res.statusCode, res.body).toBe(200);
    const page = safeJson(res) as { items: { email: string; firstName: string; source: { kind: string; label: string } }[]; total: number; page: number; pageSize: number };
    expect(page.pageSize).toBe(5);
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe((await h.ctx.db.selectFrom('preregistrations').select('id').execute()).length);
    expect(page.items.every((i) => i.email.includes('***'))).toBe(true);
    const clear = safeJson(await operator.get('/api/admin/founding?pageSize=5')) as typeof page;
    expect(clear.items.every((i) => !i.email.includes('***'))).toBe(true);
    // Newest first.
    const newest = await h.ctx.db.selectFrom('preregistrations').select('email').orderBy('created_at', 'desc').orderBy('id').limit(1).executeTakeFirstOrThrow();
    expect(clear.items[0]!.email).toBe(newest.email);
    // Filters.
    const matched = safeJson(await operator.get('/api/admin/founding?matched=true&pageSize=100')) as { items: { accountId: string | null }[]; total: number };
    expect(matched.total).toBeGreaterThan(0);
    expect(matched.items.every((i) => i.accountId !== null)).toBe(true);
    const unsub = safeJson(await operator.get('/api/admin/founding?unsubscribed=true&pageSize=100')) as { items: { unsubscribedAt: string | null }[] };
    expect(unsub.items.length).toBeGreaterThan(0);
    expect(unsub.items.every((i) => i.unsubscribedAt !== null)).toBe(true);
    const links = safeJson(await operator.get('/api/admin/founding?sourceKind=LINK&country=fr')) as { items: { source: { kind: string; channel: string | null; linkId: string | null } }[] };
    expect(links.items.length).toBeGreaterThan(0);
    expect(links.items.every((i) => i.source.kind === 'LINK' && i.source.linkId !== null && i.source.channel !== null)).toBe(true);
    expect((await operator.get('/api/admin/founding?sourceKind=NOPE')).statusCode).toBe(400);
    // The summary.
    const summary = safeJson(await auditor.get('/api/admin/founding/summary')) as { total: number; matched: number; unsubscribed: number; countries: { country: string; name: string; count: number }[]; kinds: { kind: string; count: number }[]; sources: { kind: string; label: string; count: number }[] };
    expect(summary.total).toBe(page.total);
    expect(summary.countries[0]).toEqual({ country: 'FR', name: 'France', count: expect.any(Number) });
    expect(summary.kinds.reduce((t, k) => t + k.count, 0)).toBe(summary.total);
    expect(summary.sources.find((s) => s.kind === 'LINK')).toMatchObject({ label: 'Founding bio' });
    expect(summary.matched).toBe(matched.total);
    // The CSV: OPERATOR, every row, Shopify's customer columns.
    expect((await auditor.get('/api/admin/founding.csv')).statusCode).toBe(403);
    const csv = await operator.get('/api/admin/founding.csv');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8; header=present');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="orbes-founding-list-2026-10-21.csv"');
    // Every field quoted (render/csv.ts): read back without the quotes.
    const lines = csv.body.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((l) => l.replace(/^"|"$/g, '').split('","').join(','));
    expect(lines[0]).toBe('First Name,Last Name,Email,Accepts Email Marketing,Default Address Country Code,Tags,Note');
    expect(lines).toHaveLength(page.total + 1);
    expect(lines.some((l) => /,no,FR,founding-list,/.test(l))).toBe(true);
    // A row of the first registrations (several share the harness's first instant, so their order among them is the ids').
    expect(lines.slice(1).some((l) => /^Léa,,[^,]+@example\.com,(yes|no),FR,founding-list,Joined 2026-10-21 10:00 Paris · consent 2026-10-15 · Direct$/i.test(l))).toBe(true);
    // Removal: ADMIN only.
    const any = page.items[0] as unknown as { id: string };
    expect((await operator.post(`/api/admin/founding/${any.id}/remove`, { phrase: removePhrase(any.id) })).statusCode).toBe(403);
    const wrong = await adminC.post(`/api/admin/founding/${any.id}/remove`, { phrase: 'REMOVE' });
    expect([wrong.statusCode, errorOf(wrong).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await adminC.post(`/api/admin/founding/${any.id}/remove`, { phrase: removePhrase(any.id) })).statusCode).toBe(204);
  });

  it('gives the matched row in the right of access, in words, and null when the account is not on the list', async () => {
    const adminC = await adminClient(h, 'ADMIN');
    const email = unique('export');
    const id = await account(email);
    await svc().register(person(email, { utm: { source: 'newsletter', campaign: 'founding' } }), PUBLIC);
    await svc().unsubscribe((await row(email))!.id, PUBLIC);
    const res = await adminC.get(`/api/admin/owners/${id}/export`);
    expect(res.statusCode, res.body).toBe(200);
    const out = safeJson(res) as { foundingList: unknown };
    expect(out.foundingList).toEqual({
      joinedAt: h.clock.now().toISOString(),
      firstName: 'Léa',
      country: 'FR',
      consentVersion: FOUNDING_CONSENT_VERSION,
      kind: 'CAMPAIGN',
      source: 'newsletter / founding',
      channel: null,
      unsubscribedAt: h.clock.now().toISOString(),
    });
    const audit = (await audits('account.export')).at(-1)!;
    expect((audit.details as { foundingList: number }).foundingList).toBe(1);
    const none = await account(unique('none'));
    expect((safeJson(await adminC.get(`/api/admin/owners/${none}/export`)) as { foundingList: unknown }).foundingList).toBeNull();
  });
});

// ── One address sent many times at once ─────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
const BACKENDS = [
  { name: 'PGlite', skip: false },
  { name: 'PostgreSQL', skip: !adminUrl },
] as const;

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`concurrent registrations of one address make one row, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;

    beforeAll(async () => {
      if (backend.name === 'PGlite') {
        const t = await createTestDb();
        db = t.db;
        close = () => t.close();
      } else {
        const admin = createDb(adminUrl!);
        const name = `orbes_founding_${randomBytes(6).toString('hex')}`;
        await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
        const u = new URL(adminUrl!);
        u.pathname = `/${name}`;
        db = createDb(u.toString(), { poolMax: 8 });
        await migrateToLatest(db);
        close = async () => {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        };
      }
    });
    afterAll(() => close?.());

    it('eight forms of one address at once (in any case, from new campaign tags): one row, one audit, every answer a success', async () => {
      const clock = createManualClock('2026-10-21T08:00:00.000Z');
      const audit = new AuditService({ db, clock: clock.now });
      const acquisition = new AcquisitionService({ db, publicOrigin: 'https://verify.orbes.test', clock: clock.now });
      await acquisition.prepare();
      const founding = new FoundingService({ db, audit, acquisition, clock: clock.now });
      const outs = await Promise.all(
        Array.from({ length: 8 }, (_, i) => founding.register(person(i % 2 ? 'Same@Example.com' : 'same@example.COM', { utm: { source: `src-${i}` } }), PUBLIC)),
      );
      expect(outs.filter((o) => o.outcome === 'ADDED')).toHaveLength(1);
      expect(outs.filter((o) => o.outcome === 'ALREADY')).toHaveLength(7);
      expect(await db.selectFrom('preregistrations').select('id').where('email_normalized', '=', 'same@example.com').execute()).toHaveLength(1);
      expect(await db.selectFrom('audit_logs').select('id').where('action', '=', 'founding.register').execute()).toHaveLength(1);
    });
  });
}
