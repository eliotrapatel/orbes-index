/**
 * YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.6, P.10, P.16, step 1.4; services/profiles.ts; migration 0040), on
 * the service as createContext wires it:
 *
 *  - the first boot's answers, created once (twice, or two starts at once, create one set and one audit);
 *  - the choices through TasteService and the answers offered;
 *  - `save`: every field, cleaned by the shared rules; a name or a country changed, never cleared once set; the date of
 *    birth entered once (the same date again changes nothing, another 409, after a removal 409 BIRTH_DATE_ENTERED); the
 *    version (409 PROFILE_CHANGED); the tastes in the same transaction (a bad taste refuses the whole SAVE); the heard
 *    answer; the account's name and country following; nothing changed, nothing written; LOCKED 403;
 *  - `saveByStaff`: LOCKED allowed, DELETED 409, `updated_by` STAFF; `forStaff` in clear and for an AUDITOR;
 *  - the audit holds field names, never a value typed;
 *  - the answers' list (create, rename, set aside, offer again, 12 at most, Other stays, the order) and its counts
 *    without test entrants and the team's own accounts;
 *  - two saves at once give one 409, a collector's save and a staff save at once never deadlock (PGlite always;
 *    PostgreSQL with ORBES_TEST_POSTGRES_URL, a pool of 8: true parallelism).
 *
 * `setBirthDateByStaff` (Change the date of birth, step 5.4): set, changed and removed by Client Services with
 * `birth_date_by` STAFF and the collector's one entry kept; the reason a private note in the same transaction (a
 * failing note leaves the date as it was); the version, LOCKED and DELETED; the audit with the note's id, never the date
 * or the reason.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { HEARD_PRESETS } from '../../src/server/services/profiles.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { createTestDb } from '../support/db.js';
import { createAccount } from '../support/live.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

const EMPTY_TASTES = { pieces: [], finishes: [] };

describe('YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1)', () => {
  let h: Harness;
  let staff: Actor;
  let models: { ring: string; gold: string };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-09T09:00:00.000Z');
    staff = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    const model = async (type: string, slug: string, more: Record<string, unknown> = {}) =>
      (
        await h.t.db
          .insertInto('models')
          .values({ category_id: 1, name: 'MODEL', type, sku_prefix: `P-${slug}`, slug, lookbook: 'PUBLIC', published_at: '2026-01-01T00:00:00Z', ...more })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const ring = await model('RING', 'ring-steel', { variant_label: 'Steel', variant_swatch: '#888888' });
    const gold = await model('RING', 'ring-gold', { variant_of: ring, variant_label: 'Gold', variant_swatch: '#C9A227' });
    await model('CUFF', 'cuff');
    await model('PENDANT', 'pendant-hidden', { lookbook: 'HIDDEN' });
    await model('BELT', 'belt-gone', { active: false, discontinued_at: '2026-06-01T00:00:00Z' });
    await model('WALLET', 'wallet-off', { active: false });
    models = { ring, gold };
  });
  afterAll(() => h?.close());

  const svc = () => h.ctx.services.profiles;
  const heardId = async (label: string) => (await h.t.db.selectFrom('heard_options').select('id').where('label', '=', label).executeTakeFirstOrThrow()).id;
  const audits = (accountId: string) =>
    h.t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'actor_id', 'details']).where('target_id', '=', accountId).where('action', '=', 'account.profile.update').orderBy('id').execute();
  const accountRow = (id: string) => h.t.db.selectFrom('accounts').select(['display_name', 'country']).where('id', '=', id).executeTakeFirstOrThrow();
  const base = async (accountId: string) => {
    const v = await svc().forCollector(accountId);
    return { version: v.profile.version };
  };

  it('creates the first boot\'s answers once, in the owner\'s order, Other last; again and two at once create nothing more', async () => {
    const rows = await h.t.db.selectFrom('heard_options').select(['label', 'is_other', 'position', 'active']).orderBy('position').execute();
    expect(rows.map((r) => r.label)).toEqual(['Instagram', 'TikTok', 'A friend', 'The press', 'A shop', 'A web search', 'An influencer', 'Other']);
    expect(rows.map((r) => r.is_other)).toEqual([false, false, false, false, false, false, false, true]);
    expect(rows.every((r) => r.active)).toBe(true);
    const setups = () => h.t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'heard_option.setup').execute();
    expect(await setups()).toEqual([{ actor_type: 'system', details: { labels: [...HEARD_PRESETS] } }]);
    expect(await svc().prepare()).toEqual([]);
    expect(await setups()).toHaveLength(1);

    // An empty list (a fresh database): two starts at once create one set.
    const fresh = await createHarness();
    try {
      await fresh.t.db.deleteFrom('heard_options').execute();
      const [a, b] = await Promise.all([fresh.ctx.services.profiles.prepare(), fresh.ctx.services.profiles.prepare()]);
      expect([a.length, b.length].sort()).toEqual([0, 8]);
      expect(await fresh.t.db.selectFrom('heard_options').select('id').execute()).toHaveLength(8);
      expect(await fresh.t.db.selectFrom('audit_logs').select('id').where('action', '=', 'heard_option.setup').execute()).toHaveLength(2);
      // A renamed answer is never created again.
      await fresh.t.db.updateTable('heard_options').set({ label: 'Instagram ads' }).where('label', '=', 'Instagram').execute();
      expect(await fresh.ctx.services.profiles.prepare()).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  it('offers the catalogue\'s pieces and finishes through TasteService (PUBLIC, variants through their main model, discontinued and inactive left out) and the answers offered', async () => {
    const o = await svc().options();
    expect(o.pieces.map((p) => p.key)).toEqual(['CUFF', 'RING']);
    expect(o.finishes).toEqual([
      { key: 'GOLD', label: 'Gold', swatch: '#C9A227' },
      { key: 'STEEL', label: 'Steel', swatch: '#888888' },
    ]);
    expect(o.heard.map((x) => [x.label, x.other])).toEqual(HEARD_PRESETS.map((l) => [l, l === 'Other']));
  });

  it('reads an account of before as empty: version 0, no row, the name and every field missing, nothing forced', async () => {
    const a = await createAccount(h.t.db);
    const v = await svc().forCollector(a.id);
    expect(v.profile).toEqual({
      firstName: null, lastName: null, country: null, city: null, phone: null, birthDate: null, birthDateLocked: false, instagram: null, heard: null,
      tastes: { pieces: [], finishes: [] }, version: 0,
    });
    expect(v.address).toBeNull();
    expect(v.addresses).toBe(0);
    expect(v.completion).toEqual({ percent: 0, missing: ['NAME', 'COUNTRY', 'BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD'] });
    expect(await h.t.db.selectFrom('account_profiles').select('account_id').where('account_id', '=', a.id).execute()).toEqual([]);
    expect(await refusal(svc().forCollector(randomUUID()))).toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });

  it('saves every field, cleaned; the account\'s name and country follow; audited with the field names only, never a value typed', async () => {
    const a = await createAccount(h.t.db);
    await h.ctx.services.addresses.create(a.id, { name: 'Camille Durand', address: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, a.actor);
    const friend = await heardId('A friend');
    const saved = await svc().save(
      a.id,
      {
        version: 0, firstName: ' Camille ', lastName: 'Durand', country: 'FR', city: ' Lyon ', phone: { country: 'FR', number: '06 12 34 56 78' }, birthDate: '1994-03-14',
        instagram: 'https://www.instagram.com/Camille.DL/?hl=fr', heard: { optionId: friend }, tastes: { pieces: ['ring'], finishes: ['Gold', 'steel'] },
      },
      a.actor,
    );
    expect(saved.profile).toEqual({
      firstName: 'Camille', lastName: 'Durand', country: 'FR', city: 'Lyon', phone: { country: 'FR', number: '+33612345678' }, birthDate: '1994-03-14', birthDateLocked: true,
      instagram: 'camille.dl', heard: { optionId: friend, label: 'A friend', other: null },
      tastes: { pieces: [{ key: 'RING', label: 'RING', retired: false }], finishes: [{ key: 'GOLD', label: 'Gold', swatch: '#C9A227', retired: false }, { key: 'STEEL', label: 'Steel', swatch: '#888888', retired: false }] },
      version: 1,
    });
    expect(saved.address).toEqual({ name: 'Camille Durand', firstLine: '12 rue de la Paix', country: 'FR' });
    expect(saved.addresses).toBe(1);
    expect(saved.completion).toEqual({ percent: 100, missing: [] });
    expect(await accountRow(a.id)).toEqual({ display_name: 'Camille Durand', country: 'FR' });
    const row = await h.t.db.selectFrom('account_profiles').selectAll().where('account_id', '=', a.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ birth_date_by: 'COLLECTOR', birth_date_at: h.clock.now(), birth_date_collector_at: h.clock.now(), heard_at: h.clock.now(), updated_by: 'COLLECTOR', version: 1 });
    const [entry] = await audits(a.id);
    expect(entry).toEqual({
      action: 'account.profile.update', actor_type: 'account', actor_id: a.id,
      details: { by: 'collector', fields: ['firstName', 'lastName', 'country', 'city', 'phone', 'birthDate', 'instagram', 'heard', 'tastes'], tastes: { pieces: 1, finishes: 2, added: 3, removed: 0 }, birthDate: 'set' },
    });
    // Nothing typed reaches the audit: no name, city, phone, date, Instagram, answer or taste.
    const text = JSON.stringify(await h.t.db.selectFrom('audit_logs').select('details').where('target_id', '=', a.id).where('action', 'like', 'account.profile.%').execute());
    for (const typed of ['Camille', 'Durand', 'Lyon', '612345678', '1994', '03-14', 'camille.dl', 'A friend', friend, 'RING', 'GOLD', 'Gold', 'STEEL']) expect(text, typed).not.toContain(typed);

    // The same profile again: nothing written, nothing audited, the version unchanged.
    h.clock.advance(60_000);
    const again = await svc().save(
      a.id,
      { version: 1, firstName: 'Camille', lastName: 'Durand', country: 'FR', city: 'Lyon', phone: { country: 'FR', number: '+33612345678' }, birthDate: '1994-03-14', instagram: '@camille.dl', heard: { optionId: friend }, tastes: { pieces: ['RING'], finishes: ['STEEL', 'GOLD'] } },
      a.actor,
    );
    expect(again.profile.version).toBe(1);
    expect(await audits(a.id)).toHaveLength(1);
    // A field left out is unchanged; cleared ones clear.
    const cleared = await svc().save(a.id, { version: 1, city: null, phone: null, instagram: '', heard: null }, a.actor);
    expect(cleared.profile).toMatchObject({ firstName: 'Camille', city: null, phone: null, instagram: null, heard: null, version: 2 });
    expect(cleared.completion).toEqual({ percent: 60, missing: ['CITY', 'PHONE', 'INSTAGRAM', 'HEARD'] });
    expect((await audits(a.id))[1]!.details).toEqual({ by: 'collector', fields: ['city', 'phone', 'instagram', 'heard'] });
    // The first answer's time stays when the answer is cleared and given again.
    h.clock.advance(60_000);
    await svc().save(a.id, { version: 2, heard: { optionId: await heardId('The press') } }, a.actor);
    expect((await h.t.db.selectFrom('account_profiles').select('heard_at').where('account_id', '=', a.id).executeTakeFirstOrThrow()).heard_at).toEqual(row.heard_at);
  });

  it('refuses each field in its words: a name or a country once set changed, never cleared; an account of before may leave its name empty', async () => {
    const a = await createAccount(h.t.db);
    const save = (x: Record<string, unknown>) => svc().save(a.id, { version: 0, ...x }, a.actor);
    const words = async (x: Record<string, unknown>) => (await refusal(save(x))).message;
    expect(await words({ firstName: 'x'.repeat(51) })).toBe('Your first name is 50 characters at most.');
    expect(await words({ lastName: 'Do<e' })).toBe('Your last name contains characters that cannot be kept.');
    expect(await words({ country: 'ZZ' })).toBe('Choose your country.');
    expect(await words({ city: 'x'.repeat(81) })).toBe('Your city is 80 characters at most.');
    expect(await words({ phone: { country: 'ZZ', number: '0612345678' } })).toBe('Choose the country code of your phone.');
    expect(await words({ phone: { country: 'FR', number: '06 12 AB' } })).toBe('Enter your phone number with digits only.');
    expect(await words({ phone: { country: 'FR', number: '0612' } })).toBe('This phone number is too short or too long.');
    expect(await words({ instagram: 'camille dl' })).toBe('Enter your Instagram username: letters, numbers, full stops and underscores, 30 at most.');
    expect(await words({ heard: { optionId: await heardId('Other'), other: 'x'.repeat(101) } })).toBe('Your words are 100 characters at most.');
    expect(await refusal(save({ firstName: 'x'.repeat(51) }))).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    // Nothing written by a refusal.
    expect(await h.t.db.selectFrom('account_profiles').select('account_id').where('account_id', '=', a.id).execute()).toEqual([]);
    // An account of before: names empty, saved anyway.
    expect((await save({ firstName: null, lastName: '', city: 'Paris' })).profile).toMatchObject({ firstName: null, lastName: null, city: 'Paris', version: 1 });
    // Given once, a name and the country are changed, never cleared.
    await svc().save(a.id, { version: 1, firstName: 'Jean Paul', lastName: 'Le Gall', country: 'FR' }, a.actor);
    expect(await refusal(svc().save(a.id, { version: 2, firstName: '' }, a.actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Enter your first name.' });
    expect(await refusal(svc().save(a.id, { version: 2, lastName: null }, a.actor))).toMatchObject({ message: 'Enter your last name.' });
    expect(await refusal(svc().save(a.id, { version: 2, country: null }, a.actor))).toMatchObject({ message: 'Choose your country.' });
    const renamed = await svc().save(a.id, { version: 2, firstName: 'Jean-Paul', country: 'BE' }, a.actor);
    expect(renamed.profile).toMatchObject({ firstName: 'Jean-Paul', lastName: 'Le Gall', country: 'BE', version: 3 });
    expect(await accountRow(a.id)).toEqual({ display_name: 'Jean-Paul Le Gall', country: 'BE' });
  });

  it('takes the date of birth once: a real day from 1900, 13 years before today in Paris; the same again changes nothing, another 409; null refused; after Client Services removes the collector\'s entry, 409 BIRTH_DATE_ENTERED, its time kept; after a removal of a date only staff set, the collector may enter one', async () => {
    const a = await createAccount(h.t.db);
    const save = (version: number, birthDate: unknown) => svc().save(a.id, { version, birthDate }, a.actor);
    expect(await refusal(save(0, '2001-02-29'))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'This date does not exist.' });
    expect(await refusal(save(0, '2013-10-10'))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Enter your date of birth.' });
    expect(await refusal(save(0, '1899-12-31'))).toMatchObject({ message: 'Enter your date of birth.' });
    expect(await refusal(save(0, '14/03/1994'))).toMatchObject({ message: 'Enter your date of birth.' });
    expect(await refusal(save(0, null))).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    // 13 years exactly, on 9 October 2026 in Paris.
    const first = await save(0, '2013-10-09');
    expect(first.profile).toMatchObject({ birthDate: '2013-10-09', birthDateLocked: true, version: 1 });
    expect(await save(1, '2013-10-09')).toMatchObject({ profile: { version: 1 } });
    expect(await refusal(save(1, '2013-10-08'))).toEqual({ code: 'BIRTH_DATE_SET', status: 409, message: 'Your date of birth is saved. ORBES Client Services can change it.' });
    expect(await refusal(save(1, null))).toMatchObject({ code: 'VALIDATION_FAILED' });
    // Client Services removes it (Change the date of birth, step 5.4): the collector's one entry is used.
    const entered = (await h.t.db.selectFrom('account_profiles').select('birth_date_collector_at').where('account_id', '=', a.id).executeTakeFirstOrThrow()).birth_date_collector_at;
    await svc().setBirthDateByStaff(a.id, { version: 1, birthDate: null, why: 'Typed by mistake, the client says.' }, staff);
    expect((await svc().forCollector(a.id)).profile).toMatchObject({ birthDate: null, birthDateLocked: true, version: 2 });
    expect(await refusal(save(2, '1994-03-14'))).toEqual({ code: 'BIRTH_DATE_ENTERED', status: 409, message: 'You have entered your date of birth once. ORBES Client Services can set it.' });
    expect((await h.t.db.selectFrom('account_profiles').select('birth_date_collector_at').where('account_id', '=', a.id).executeTakeFirstOrThrow()).birth_date_collector_at).toEqual(entered);
    // A date only Client Services set, then removed: the collector's entry is still unused.
    const b = await createAccount(h.t.db);
    await svc().setBirthDateByStaff(b.id, { version: 0, birthDate: '1990-01-01', why: 'Given on the phone.' }, staff);
    expect((await svc().forCollector(b.id)).profile).toMatchObject({ birthDate: '1990-01-01', birthDateLocked: true, version: 1 });
    await svc().setBirthDateByStaff(b.id, { version: 1, birthDate: null, why: 'Not the client\'s own.' }, staff);
    expect((await svc().forCollector(b.id)).profile.birthDateLocked).toBe(false);
    expect((await svc().save(b.id, { version: 2, birthDate: '1991-05-06' }, b.actor)).profile).toMatchObject({ birthDate: '1991-05-06', birthDateLocked: true, version: 3 });
  });

  it('refuses a save of another version (409 PROFILE_CHANGED) and a LOCKED account (403), writing nothing', async () => {
    const a = await createAccount(h.t.db);
    await svc().save(a.id, { version: 0, city: 'Lyon' }, a.actor);
    expect(await refusal(svc().save(a.id, { version: 0, city: 'Paris' }, a.actor))).toEqual({ code: 'PROFILE_CHANGED', status: 409, message: 'Your profile was changed meanwhile.' });
    expect(await refusal(svc().save(a.id, { version: 7, city: 'Paris' }, a.actor))).toMatchObject({ code: 'PROFILE_CHANGED' });
    expect(await refusal(svc().save(a.id, { city: 'Paris' }, a.actor))).toMatchObject({ code: 'VALIDATION_FAILED' });
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
    expect(await refusal(svc().save(a.id, { version: 1, city: 'Paris' }, a.actor))).toEqual({ code: 'ACCOUNT_LOCKED', status: 403, message: 'This account is locked. ORBES Client Services can assist you.' });
    expect((await svc().forCollector(a.id)).profile).toMatchObject({ city: 'Lyon', version: 1 });
  });

  it('saves the tastes in the same transaction: new ones from the collection only, a retired one kept, 30 at most; a bad taste refuses the whole SAVE and leaves the profile unchanged', async () => {
    const a = await createAccount(h.t.db);
    await svc().save(a.id, { version: 0, firstName: 'Ana', tastes: { pieces: ['RING', 'CUFF'], finishes: ['GOLD'] } }, a.actor);
    expect(await refusal(svc().save(a.id, { version: 1, firstName: 'Anna', tastes: { pieces: ['RING', 'PENDANT'], finishes: ['GOLD'] } }, a.actor))).toEqual({
      code: 'TASTE_UNKNOWN', status: 400, message: 'Choose among the pieces and finishes of the collection.',
    });
    expect(await refusal(svc().save(a.id, { version: 1, firstName: 'Anna', tastes: { pieces: Array.from({ length: 31 }, (_, i) => `T${i}`), finishes: [] } }, a.actor))).toMatchObject({ code: 'TASTES_TOO_MANY' });
    const unchanged = await svc().forCollector(a.id);
    expect(unchanged.profile).toMatchObject({ firstName: 'Ana', version: 1 });
    expect(unchanged.profile.tastes.pieces.map((p) => p.key)).toEqual(['CUFF', 'RING']);
    // Gold leaves the collection: kept, shown retired; unpressed, gone for good.
    await h.t.db.updateTable('models').set({ active: false, discontinued_at: '2026-10-09T09:00:00Z' }).where('id', '=', models.gold).execute();
    try {
      const kept = await svc().save(a.id, { version: 1, tastes: { pieces: ['RING', 'CUFF'], finishes: ['GOLD', 'STEEL'] } }, a.actor);
      expect(kept.profile.tastes.finishes).toEqual([{ key: 'STEEL', label: 'Steel', swatch: '#888888', retired: false }, { key: 'GOLD', label: 'Gold', retired: true }]);
      await svc().save(a.id, { version: 2, tastes: { pieces: ['RING', 'CUFF'], finishes: ['STEEL'] } }, a.actor);
      expect(await refusal(svc().save(a.id, { version: 3, tastes: { pieces: ['RING'], finishes: ['GOLD'] } }, a.actor))).toMatchObject({ code: 'TASTE_UNKNOWN' });
      expect((await audits(a.id)).map((e) => (e.details as { tastes?: unknown }).tastes)).toEqual([
        { pieces: 2, finishes: 1, added: 3, removed: 0 },
        { pieces: 2, finishes: 2, added: 1, removed: 0 },
        { pieces: 2, finishes: 1, added: 0, removed: 1 },
      ]);
    } finally {
      await h.t.db.updateTable('models').set({ active: true, discontinued_at: null }).where('id', '=', models.gold).execute();
    }
  });

  it('keeps the heard answer: a set-aside one refused when newly picked, kept while unchanged; Other\'s words only with Other; the first answer\'s time', async () => {
    const a = await createAccount(h.t.db);
    const tiktok = await heardId('TikTok');
    const other = await heardId('Other');
    const shop = await heardId('A shop');
    const withOther = await svc().save(a.id, { version: 0, heard: { optionId: other, other: ' Saw it in Milan ' } }, a.actor);
    expect(withOther.profile.heard).toEqual({ optionId: other, label: 'Other', other: 'Saw it in Milan' });
    // Words with another answer are dropped.
    expect((await svc().save(a.id, { version: 1, heard: { optionId: shop, other: 'ignored' } }, a.actor)).profile.heard).toEqual({ optionId: shop, label: 'A shop', other: null });
    // A shop is set aside: kept as the collector's, shown after the offered ones; TikTok set aside cannot be picked.
    await h.t.db.updateTable('heard_options').set({ active: false }).where('id', 'in', [shop, tiktok]).execute();
    try {
      const read = await svc().forCollector(a.id);
      expect(read.profile.heard).toEqual({ optionId: shop, label: 'A shop', other: null });
      expect(read.options.heard.at(-1)).toEqual({ id: shop, label: 'A shop', other: false });
      expect(read.options.heard.map((x) => x.label)).not.toContain('TikTok');
      expect(await svc().save(a.id, { version: 2, heard: { optionId: shop }, city: 'Lyon' }, a.actor)).toMatchObject({ profile: { heard: { optionId: shop }, version: 3 } });
      expect(await refusal(svc().save(a.id, { version: 3, heard: { optionId: tiktok } }, a.actor))).toEqual({ code: 'HEARD_UNAVAILABLE', status: 400, message: 'This answer is no longer offered. Choose another.' });
      expect(await refusal(svc().save(a.id, { version: 3, heard: { optionId: randomUUID() } }, a.actor))).toMatchObject({ code: 'HEARD_UNAVAILABLE' });
      expect(await refusal(svc().save(a.id, { version: 3, heard: { optionId: 'x' } }, a.actor))).toMatchObject({ code: 'HEARD_UNAVAILABLE' });
    } finally {
      await h.t.db.updateTable('heard_options').set({ active: true }).where('id', 'in', [shop, tiktok]).execute();
    }
  });

  it('lets Client Services save a LOCKED account\'s profile, never a DELETED one\'s; updated_by STAFF, audited by the staff member with the field names; no date of birth here', async () => {
    const a = await createAccount(h.t.db);
    await svc().save(a.id, { version: 0, firstName: 'Camille' }, a.actor);
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
    expect(await refusal(svc().saveByStaff(a.id, { version: 0, lastName: 'Durand' }, staff))).toEqual({
      code: 'PROFILE_CHANGED', status: 409, message: 'The client changed the profile meanwhile. It has been read again: check and save.',
    });
    const saved = await svc().saveByStaff(a.id, { version: 1, lastName: 'Durand', birthDate: '1994-03-14', city: 'Lyon', tastes: { pieces: ['RING'], finishes: [] } }, staff);
    expect(saved).toMatchObject({ firstName: 'Camille', lastName: 'Durand', city: 'Lyon', birthDate: null, version: 2, updatedBy: 'STAFF' });
    const [, entry] = await audits(a.id);
    expect(entry).toEqual({
      action: 'account.profile.update', actor_type: 'admin', actor_id: staff.id,
      details: { by: 'staff', fields: ['lastName', 'city', 'tastes'], tastes: { pieces: 1, finishes: 0, added: 1, removed: 0 } },
    });
    expect(await accountRow(a.id)).toMatchObject({ display_name: 'Camille Durand' });
    await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', a.id).execute();
    expect(await refusal(svc().saveByStaff(a.id, { version: 2, city: 'Paris' }, staff))).toEqual({ code: 'ACCOUNT_DELETED', status: 409, message: 'This account is deleted.' });
    // The sheet still reads.
    expect((await svc().forStaff(a.id, { inClear: true })).city).toBe('Lyon');
  });

  it('lets Client Services set, change and remove the date of birth (birth_date_by STAFF, never the collector\'s once), the reason a private note in the same transaction; the version, LOCKED allowed, DELETED refused; the audit holds the note\'s id, never the date or the reason', async () => {
    const a = await createAccount(h.t.db);
    const notes = () => h.t.db.selectFrom('account_notes').select(['id', 'body', 'created_by']).where('account_id', '=', a.id).orderBy('created_at').orderBy('body').execute();
    // Set: none before, a profile row made for it.
    h.clock.advance(60_000);
    const set = await svc().setBirthDateByStaff(a.id, { version: 0, birthDate: '1994-03-14', why: '  The client gave it on the phone.  ' }, staff);
    expect(set).toMatchObject({ birthDate: '1994-03-14', age: 32, ageBand: '25-34', birthDateBy: 'STAFF', birthDateAt: h.clock.now(), birthDateCollectorAt: null, version: 1, updatedBy: 'STAFF' });
    // The collector never entered one: theirs is still unused, but the date is set, so YOUR PROFILE reads it locked.
    expect((await svc().forCollector(a.id)).profile).toMatchObject({ birthDate: '1994-03-14', birthDateLocked: true });
    const [first] = await notes();
    expect(first).toEqual({ id: expect.any(String), body: 'Date of birth changed: The client gave it on the phone.', created_by: staff.id });
    // The same date again: nothing written, no note.
    expect(await svc().setBirthDateByStaff(a.id, { version: 1, birthDate: '1994-03-14', why: 'Checked again.' }, staff)).toMatchObject({ version: 1 });
    expect(await notes()).toHaveLength(1);
    // Changed, on a LOCKED account.
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
    h.clock.advance(60_000);
    expect(await svc().setBirthDateByStaff(a.id, { version: 1, birthDate: '1994-04-13', why: 'Day and month swapped.' }, staff)).toMatchObject({ birthDate: '1994-04-13', version: 2 });
    // Removed: the date and who set it go together.
    h.clock.advance(60_000);
    expect(await svc().setBirthDateByStaff(a.id, { version: 2, birthDate: null, why: 'Not the client\'s own.' }, staff)).toMatchObject({ birthDate: null, birthDateBy: null, birthDateAt: null, age: null, ageBand: null, version: 3 });
    expect((await notes()).map((n) => n.body)).toEqual(['Date of birth changed: The client gave it on the phone.', 'Date of birth changed: Day and month swapped.', 'Date of birth removed: Not the client\'s own.']);
    // Audited: the field, what happened and the note, never the date or the reason; and the note's own entry.
    const entries = await audits(a.id);
    const ids = (await notes()).map((n) => n.id);
    expect(entries.map((e) => e.details)).toEqual([
      { by: 'staff', fields: ['birthDate'], birthDate: 'set', noteId: ids[0] },
      { by: 'staff', fields: ['birthDate'], birthDate: 'changed', noteId: ids[1] },
      { by: 'staff', fields: ['birthDate'], birthDate: 'cleared', noteId: ids[2] },
    ]);
    expect(entries.every((e) => e.actor_type === 'admin' && e.actor_id === staff.id)).toBe(true);
    const noteAudits = await h.t.db.selectFrom('audit_logs').select('details').where('target_id', '=', a.id).where('action', '=', 'account.note.add').orderBy('id').execute();
    expect(noteAudits.map((e) => (e.details as { noteId: string }).noteId)).toEqual(ids);
    const logged = JSON.stringify(await h.t.db.selectFrom('audit_logs').select('details').where('target_id', '=', a.id).execute());
    for (const typed of ['1994', 'phone', 'swapped', 'own']) expect(logged).not.toContain(typed);
    // Refusals, nothing written: the version, the date's words, the reason, an unknown or DELETED account.
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 2, birthDate: '1990-01-01', why: 'Late.' }, staff))).toEqual({
      code: 'PROFILE_CHANGED', status: 409, message: 'The client changed the profile meanwhile. It has been read again: check and save.',
    });
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 3, birthDate: '1990-02-30', why: 'Typo.' }, staff))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'This date does not exist.' });
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 3, birthDate: '1899-12-31', why: 'Typo.' }, staff))).toMatchObject({ message: 'Enter a date of birth from 1900, 13 years ago at least.' });
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 3, birthDate: '2013-10-10', why: 'Typo.' }, staff))).toMatchObject({ message: 'Enter a date of birth from 1900, 13 years ago at least.' });
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 3, birthDate: '1990-01-01', why: '   ' }, staff))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Give the reason.' });
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 3, birthDate: '1990-01-01', why: 'x'.repeat(501) }, staff))).toMatchObject({ message: 'Give the reason in 500 characters at most.' });
    expect(await refusal(svc().setBirthDateByStaff(randomUUID(), { version: 0, birthDate: '1990-01-01', why: 'Typo.' }, staff))).toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
    await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', a.id).execute();
    expect(await refusal(svc().setBirthDateByStaff(a.id, { version: 3, birthDate: '1990-01-01', why: 'Typo.' }, staff))).toEqual({ code: 'ACCOUNT_DELETED', status: 409, message: 'This account is deleted.' });
    expect(await notes()).toHaveLength(3);
    expect((await svc().forStaff(a.id, { inClear: true })).version).toBe(3);
  });

  it('writes the date of birth and its note in one transaction: a note that cannot be written leaves the date as it was', async () => {
    const a = await createAccount(h.t.db);
    await svc().setBirthDateByStaff(a.id, { version: 0, birthDate: '1990-01-01', why: 'Given on the phone.' }, staff);
    await sql.raw(`CREATE FUNCTION test_refuse_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no note'; END $$`).execute(h.t.db);
    await sql.raw(`CREATE TRIGGER test_refuse_note BEFORE INSERT ON account_notes FOR EACH ROW EXECUTE FUNCTION test_refuse_note()`).execute(h.t.db);
    try {
      await expect(svc().setBirthDateByStaff(a.id, { version: 1, birthDate: '1991-01-01', why: 'A correction.' }, staff)).rejects.toThrow(/no note/);
    } finally {
      await sql.raw(`DROP TRIGGER test_refuse_note ON account_notes`).execute(h.t.db);
      await sql.raw(`DROP FUNCTION test_refuse_note()`).execute(h.t.db);
    }
    expect(await svc().forStaff(a.id, { inClear: true })).toMatchObject({ birthDate: '1990-01-01', version: 1 });
    expect(await audits(a.id)).toHaveLength(1);
  });

  it('reads the client sheet\'s Profile in clear, and withheld for an AUDITOR with the age band only; a team account named', async () => {
    const a = await createAccount(h.t.db);
    await h.ctx.services.addresses.create(a.id, { name: 'Camille Durand', address: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, a.actor);
    await h.ctx.services.addresses.create(a.id, { name: 'Camille Durand', address: '1 Rue du Rhône\n1204 Genève', country: 'CH', phone: '+41 79 123 45 67' }, a.actor);
    await svc().save(
      a.id,
      { version: 0, firstName: 'Camille', lastName: 'Durand', country: 'FR', city: 'Lyon', phone: { country: 'FR', number: '0612345678' }, birthDate: '1994-03-14', instagram: 'camille.dl', heard: { optionId: await heardId('Other'), other: 'Milan' } },
      a.actor,
    );
    const clear = await svc().forStaff(a.id, { inClear: true });
    expect(clear).toMatchObject({
      firstName: 'Camille', lastName: 'Durand', country: 'FR', birthDate: '1994-03-14', age: 32, ageBand: '25-34', birthDateBy: 'COLLECTOR', birthDateAt: h.clock.now(), birthDateCollectorAt: h.clock.now(),
      phone: { country: 'FR', number: '+33612345678' }, city: 'Lyon', instagram: 'camille.dl', heard: { label: 'Other', other: 'Milan', setAside: false, at: h.clock.now() },
      address: { name: 'Camille Durand', lines: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, otherAddresses: 1,
      completion: { percent: 80, missing: ['PIECES', 'FINISHES'] }, version: 1, updatedBy: 'COLLECTOR', withheld: [], teamAccount: false,
    });
    const auditor = await svc().forStaff(a.id, { inClear: false });
    expect(auditor).toMatchObject({ firstName: 'Camille', lastName: 'Durand', country: 'FR', birthDate: null, age: null, ageBand: '25-34', phone: null, city: null, instagram: null, address: null, otherAddresses: 1 });
    expect(auditor.withheld).toEqual(['birthDate', 'phone', 'city', 'address', 'instagram']);
    const text = JSON.stringify(auditor);
    for (const hidden of ['1994-03-14', '612345678', 'Lyon', 'camille.dl', 'rue de la Paix']) expect(text, hidden).not.toContain(hidden);
    // The team's own account: its email is a console login's.
    const team = await createAccount(h.t.db);
    await h.t.db.insertInto('admin_users').values({ email: team.email, email_normalized: team.email, password_hash: 'scrypt$x', role: 'AUDITOR' }).execute();
    expect((await svc().forStaff(team.id, { inClear: true })).teamAccount).toBe(true);
    expect((await svc().forStaff(team.id, { inClear: true })).version).toBe(0);
  });

  it('edits the answers (ADMIN): add before Other, rename, set aside and offer again, 12 offered at most, Other stays, the order of every answer; audited with the labels; counts without test entrants and the team\'s accounts', async () => {
    const admin: Actor = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    const list = () => svc().heardOptions({ withCounts: true });
    expect(await refusal(svc().createHeard({ label: '  ' }, admin))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Enter the answer.' });
    expect(await refusal(svc().createHeard({ label: 'x'.repeat(41) }, admin))).toMatchObject({ message: 'An answer is 40 characters at most.' });
    expect(await refusal(svc().createHeard({ label: 'instagram' }, admin))).toEqual({ code: 'HEARD_LABEL_TAKEN', status: 409, message: 'This answer exists already.' });
    const added = await svc().createHeard({ label: ' A podcast ' }, admin);
    expect(added.map((x) => x.label)).toEqual([...HEARD_PRESETS.slice(0, 7), 'A podcast', 'Other']);
    expect(added.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const podcast = added.find((x) => x.label === 'A podcast')!.id;
    // Rename; nothing changed is no write.
    await svc().updateHeard(podcast, { label: 'A podcast or a radio' }, admin);
    await svc().updateHeard(podcast, { label: 'A podcast or a radio' }, admin);
    expect(await refusal(svc().updateHeard(podcast, { label: 'TIKTOK' }, admin))).toMatchObject({ code: 'HEARD_LABEL_TAKEN' });
    // Other stays offered.
    const other = await heardId('Other');
    expect(await refusal(svc().updateHeard(other, { active: false }, admin))).toEqual({ code: 'HEARD_OTHER_STAYS', status: 409, message: 'Other stays offered.' });
    expect((await svc().updateHeard(other, { label: 'Something else' }, admin)).at(-1)).toMatchObject({ label: 'Something else', other: true, active: true });
    await svc().updateHeard(other, { label: 'Other' }, admin);
    expect(await refusal(svc().updateHeard(randomUUID(), { active: false }, admin))).toMatchObject({ code: 'HEARD_OPTION_NOT_FOUND', status: 404 });
    // 12 offered at most, Other included: 9 now, three more, then the 13th refused; set aside, one more fits.
    for (const l of ['A newspaper', 'A friend of a friend', 'A shop window']) await svc().createHeard({ label: l }, admin);
    expect(await refusal(svc().createHeard({ label: 'A fair' }, admin))).toEqual({ code: 'HEARD_LIMIT', status: 409, message: 'At most 12 answers are offered at once. Set one aside first.' });
    await svc().updateHeard(podcast, { active: false }, admin);
    await svc().createHeard({ label: 'A fair' }, admin);
    expect(await refusal(svc().updateHeard(podcast, { active: true }, admin))).toMatchObject({ code: 'HEARD_LIMIT' });
    const fair = await heardId('A fair');
    await svc().updateHeard(fair, { active: false }, admin);
    await svc().updateHeard(podcast, { active: true }, admin);
    // The order: every answer but Other, at once.
    const now = await list();
    const ids = now.filter((x) => !x.other).map((x) => x.id);
    expect(await refusal(svc().orderHeard(ids.slice(1), admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Reorder every answer at once.' });
    expect(await refusal(svc().orderHeard([...ids, other], admin))).toMatchObject({ message: 'Reorder every answer at once.' });
    expect(await refusal(svc().orderHeard([ids[0], ...ids.slice(0, -1)], admin))).toMatchObject({ message: 'Reorder every answer at once.' });
    const reversed = await svc().orderHeard([...ids].reverse(), admin);
    expect(reversed.map((x) => x.id)).toEqual([...[...ids].reverse(), other]);
    expect(reversed.map((x) => x.position)).toEqual(reversed.map((_, i) => i + 1));
    await svc().orderHeard([...ids].reverse(), admin);
    const actions = await h.t.db.selectFrom('audit_logs').select(['action', 'details']).where('action', 'like', 'heard_option.%').where('action', '<>', 'heard_option.setup').orderBy('id').execute();
    expect(actions.map((x) => x.action)).toEqual([
      'heard_option.create', 'heard_option.update', 'heard_option.update', 'heard_option.update', 'heard_option.create', 'heard_option.create', 'heard_option.create',
      'heard_option.update', 'heard_option.create', 'heard_option.update', 'heard_option.update', 'heard_option.order',
    ]);
    expect(actions[0]!.details).toEqual({ label: 'A podcast' });
    expect(actions[1]!.details).toEqual({ before: { label: 'A podcast', active: true }, after: { label: 'A podcast or a radio', active: true } });
    expect((actions.at(-1)!.details as { labels: string[] }).labels).toEqual(reversed.filter((x) => !x.other).map((x) => x.label));

    // The counts: collectors who gave each answer, test entrants and the team's own accounts left out, LOCKED counted.
    const press = await heardId('The press');
    const before = (await list()).find((x) => x.id === press)!.given!;
    const counted = await createAccount(h.t.db);
    const locked = await createAccount(h.t.db);
    const entrant = await createAccount(h.t.db);
    const team = await createAccount(h.t.db);
    const deleted = await createAccount(h.t.db);
    for (const x of [counted, locked, entrant, team, deleted]) await svc().save(x.id, { version: 0, heard: { optionId: press } }, x.actor);
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', deleted.id).execute();
    await h.t.db.insertInto('test_entrants').values({ account_id: entrant.id }).execute();
    await h.t.db.insertInto('admin_users').values({ email: team.email, email_normalized: team.email, password_hash: 'scrypt$x', role: 'AUDITOR' }).execute();
    expect((await list()).find((x) => x.id === press)!.given).toBe(before + 2);
    expect((await svc().heardOptions({ withCounts: false }))[0]).not.toHaveProperty('given');
  });
});

// ── Concurrency ──────────────────────────────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const admin = createDb(adminUrl!);
      const name = `orbes_profiles_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        },
      };
    },
  },
];

/** Every outcome of a batch of calls made together: 'ok' or the code of the refusal. */
async function together(calls: (() => Promise<unknown>)[]): Promise<string[]> {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return settled.map((s) => {
    if (s.status === 'fulfilled') return 'ok';
    if (s.reason instanceof DomainError) return s.reason.code;
    throw s.reason;
  });
}

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`YOUR PROFILE under concurrency, on ${backend.name}`, () => {
    let handle: Awaited<ReturnType<Backend['open']>>;
    let ctx: AppContext;
    let clock: ManualClock;
    let staff: Actor;

    beforeAll(async () => {
      handle = await backend.open();
      clock = createManualClock('2026-10-09T09:00:00.000Z');
      ctx = await createContext(testConfig(), { db: handle.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
      staff = { type: 'admin', id: (await createAdmin(ctx, 'OPERATOR')).id };
    });
    afterAll(async () => {
      await ctx?.close();
      await handle?.close();
    });

    it('two saves of one version at once: one saved, the other 409 PROFILE_CHANGED', async () => {
      for (let round = 0; round < 5; round++) {
        const a = await createAccount(handle.db);
        await ctx.services.profiles.save(a.id, { version: 0, firstName: 'Ana' }, a.actor);
        const outcomes = await together([
          () => ctx.services.profiles.save(a.id, { version: 1, city: 'Lyon', tastes: EMPTY_TASTES }, a.actor),
          () => ctx.services.profiles.save(a.id, { version: 1, city: 'Paris', tastes: EMPTY_TASTES }, a.actor),
        ]);
        expect(outcomes.sort()).toEqual(['PROFILE_CHANGED', 'ok']);
        expect((await ctx.services.profiles.forCollector(a.id)).profile.version).toBe(2);
      }
    });

    it('a collector\'s save and a staff save at once finish without a deadlock: one saved, the other 409', async () => {
      for (let round = 0; round < 5; round++) {
        const a = await createAccount(handle.db);
        await ctx.services.profiles.save(a.id, { version: 0, firstName: 'Ana', country: 'FR' }, a.actor);
        const outcomes = await together([
          () => ctx.services.profiles.save(a.id, { version: 1, lastName: 'Lima', country: 'PT', tastes: EMPTY_TASTES }, a.actor),
          () => ctx.services.profiles.saveByStaff(a.id, { version: 1, lastName: 'Lima', city: 'Porto', tastes: EMPTY_TASTES }, staff),
          // H2's address book takes the same account first.
          () => ctx.services.addresses.create(a.id, { name: 'Ana Lima', address: 'Rua 1\nPorto', country: 'PT', phone: '+351 912 345 678' }, a.actor),
        ]);
        expect(outcomes.slice(0, 2).sort()).toEqual(['PROFILE_CHANGED', 'ok']);
        expect(outcomes[2]).toBe('ok');
        const after = await ctx.services.profiles.forStaff(a.id, { inClear: true });
        expect(after.version).toBe(2);
        expect(after.address).toMatchObject({ country: 'PT' });
      }
    });
  });
}

