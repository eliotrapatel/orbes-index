/**
 * YOUR PROFILE's routes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.6.2, P.6.3 and P.16, step 1.6; API §10.25):
 *
 *  - GET /api/v1/account/profile: the account's own profile, the catalogue's choices, the default address in short,
 *    how many are saved and how complete it is; signed out 401; never stored by a cache; no staff field in any reply;
 *  - PUT /api/v1/account/profile: the whole profile with the version read, its tastes in the same transaction; the CSRF
 *    token and the same origin; each 400 in its words, the 409s (PROFILE_CHANGED, BIRTH_DATE_SET, BIRTH_DATE_ENTERED)
 *    and the 403 of an account locked while the save was on its way; a bad taste refuses the whole SAVE.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

/** What a collector may read: the plan's shape, and nothing about staff, the audit or who saved last. */
const PROFILE_KEYS = ['birthDate', 'birthDateLocked', 'city', 'country', 'firstName', 'heard', 'instagram', 'lastName', 'phone', 'tastes', 'version'];
const STAFF_WORDS = /updatedBy|updated_by|birthDateBy|birth_date_by|birthDateAt|birthDateCollectorAt|withheld|teamAccount|ageBand|"age"|STAFF|actor|audit/;

describe('YOUR PROFILE routes (plan CUSTOMER INTELLIGENCE §3.1 P.6.2, P.6.3)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-09T09:00:00.000Z');
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    // THE COLLECTION: a RING in Steel and Gold, a CUFF without variants.
    const ring = await model({ type: 'RING', label: 'Steel', swatch: '#8A8D8F' });
    await model({ type: 'RING', variantOf: ring, label: 'Gold', swatch: '#C9A227' });
    await model({ type: 'CUFF' });
  });
  afterAll(() => h?.close());

  async function model(o: { type: string; variantOf?: string; label?: string; swatch?: string }): Promise<string> {
    const id = randomUUID();
    await h.t.db
      .insertInto('models')
      .values({
        id, category_id: 1, name: 'MODEL', type: o.type, sku_prefix: `P-${id.slice(0, 8)}`, slug: `m-${id.slice(0, 8)}`, lookbook: 'PUBLIC',
        published_at: '2026-01-01T00:00:00Z', active: true, variant_of: o.variantOf ?? null, variant_label: o.label ?? null, variant_swatch: o.label ? (o.swatch ?? '#888888') : null,
      })
      .execute();
    return id;
  }

  const put = (c: Client, body: unknown, opts = {}) => c.request('PUT', '/api/v1/account/profile', { body, ...opts });
  const accountIdOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
  const heardId = async (label: string) => (await h.ctx.db.selectFrom('heard_options').select('id').where('label', '=', label).executeTakeFirstOrThrow()).id;

  /** The whole profile as the app sends it back, from what GET read. */
  function whole(view: any, changes: Record<string, unknown> = {}) {
    const p = view.profile;
    return {
      version: p.version,
      firstName: p.firstName,
      lastName: p.lastName,
      country: p.country,
      city: p.city,
      phone: p.phone,
      instagram: p.instagram,
      heard: p.heard ? { optionId: p.heard.optionId, other: p.heard.other } : null,
      tastes: { pieces: p.tastes.pieces.map((t: any) => t.key), finishes: p.tastes.finishes.map((t: any) => t.key) },
      ...changes,
    };
  }

  it('answers 401 signed out, on GET and PUT, never stored by a cache', async () => {
    const anon = h.client();
    for (const res of [await anon.get('/api/v1/account/profile'), await put(anon, { version: 0 })]) {
      expect(res.statusCode).toBe(401);
      expect(errorOf(res).code).toBe('UNAUTHORIZED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('GET reads the account’s profile as the sign-up wrote it, the catalogue’s choices and the answers offered; no-store; no staff field', async () => {
    const { client } = await accountClient(h);
    const res = await client.get('/api/v1/account/profile');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const v = safeJson(res) as any;
    expect(Object.keys(v).sort()).toEqual(['address', 'addresses', 'completion', 'options', 'profile']);
    expect(Object.keys(v.profile).sort()).toEqual(PROFILE_KEYS);
    expect(v.profile).toEqual({
      firstName: 'Owner',
      lastName: 'Test',
      country: 'FR',
      city: null,
      phone: null,
      birthDate: null,
      birthDateLocked: false,
      instagram: null,
      heard: null,
      tastes: { pieces: [], finishes: [] },
      version: 1,
    });
    expect(v.options.pieces).toEqual([
      { key: 'CUFF', label: 'CUFF' },
      { key: 'RING', label: 'RING' },
    ]);
    expect(v.options.finishes).toEqual([
      { key: 'GOLD', label: 'Gold', swatch: '#C9A227' },
      { key: 'STEEL', label: 'Steel', swatch: '#8A8D8F' },
    ]);
    expect(v.options.heard.map((x: any) => x.label)).toEqual(['Instagram', 'TikTok', 'A friend', 'The press', 'A shop', 'A web search', 'An influencer', 'Other']);
    expect(v.address).toBeNull();
    expect(v.addresses).toBe(0);
    expect(v.completion).toEqual({ percent: 20, missing: ['BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD'] });
    expect(res.body).not.toMatch(STAFF_WORDS);
  });

  it('PUT saves the whole profile with its tastes, answers it read again with the next version, and needs the CSRF token and the same origin', async () => {
    const { client, email } = await accountClient(h);
    const id = await accountIdOf(email);
    const read = safeJson(await client.get('/api/v1/account/profile')) as any;
    const body = whole(read, {
      firstName: 'Camille',
      lastName: 'Martin',
      country: 'IT',
      city: 'Milano',
      phone: { country: 'IT', number: '06 1234 5678' },
      birthDate: '1990-04-12',
      instagram: '@Camille.M',
      heard: { optionId: await heardId('Other'), other: 'A window in Milan' },
      tastes: { pieces: ['ring', 'Cuff'], finishes: ['gold'] },
    });
    expect((await put(client, body, { noCsrf: true })).statusCode).toBe(403);
    expect(errorOf(await put(client, body, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await put(client, body, { origin: 'https://evil.example' })).code).toBe('CSRF_FAILED');
    const res = await put(client, body);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const saved = safeJson(res) as any;
    expect(saved.profile).toMatchObject({
      firstName: 'Camille',
      lastName: 'Martin',
      country: 'IT',
      city: 'Milano',
      phone: { country: 'IT', number: '+390612345678' },
      birthDate: '1990-04-12',
      birthDateLocked: true,
      instagram: 'camille.m',
      heard: { label: 'Other', other: 'A window in Milan' },
      version: 2,
    });
    expect(saved.profile.tastes).toEqual({
      pieces: [
        { key: 'CUFF', label: 'CUFF', retired: false },
        { key: 'RING', label: 'RING', retired: false },
      ],
      finishes: [{ key: 'GOLD', label: 'Gold', swatch: '#C9A227', retired: false }],
    });
    expect(saved.completion).toEqual({ percent: 90, missing: ['ADDRESS'] });
    expect(safeJson(await client.get('/api/v1/account/profile'))).toEqual(saved);
    expect(res.body).not.toMatch(STAFF_WORDS);
    const account = await h.ctx.db.selectFrom('accounts').select(['display_name', 'country']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(account).toEqual({ display_name: 'Camille Martin', country: 'IT' });
    // The same profile again: nothing written, the version stays.
    const again = safeJson(await put(client, whole(saved))) as any;
    expect(again.profile.version).toBe(2);
  });

  it('refuses each field in its words (400), the whole SAVE with them: a bad taste leaves the profile as it was', async () => {
    const { client } = await accountClient(h);
    const read = safeJson(await client.get('/api/v1/account/profile')) as any;
    const cases: [Record<string, unknown>, string, string][] = [
      [{ firstName: null }, 'VALIDATION_FAILED', 'Enter your first name.'],
      [{ lastName: '' }, 'VALIDATION_FAILED', 'Enter your last name.'],
      [{ firstName: 'A'.repeat(51) }, 'VALIDATION_FAILED', 'Your first name is 50 characters at most.'],
      [{ country: null }, 'VALIDATION_FAILED', 'Choose your country.'],
      [{ country: 'ZZ' }, 'VALIDATION_FAILED', 'Choose your country.'],
      [{ city: 'C'.repeat(81) }, 'VALIDATION_FAILED', 'Your city is 80 characters at most.'],
      [{ phone: { country: 'QQ', number: '0612345678' } }, 'VALIDATION_FAILED', 'Choose the country code of your phone.'],
      [{ phone: { country: 'FR', number: '06 12 AB' } }, 'VALIDATION_FAILED', 'Enter your phone number with digits only.'],
      [{ phone: { country: 'FR', number: '0612' } }, 'VALIDATION_FAILED', 'This phone number is too short or too long.'],
      [{ birthDate: '1990-02-30' }, 'VALIDATION_FAILED', 'This date does not exist.'],
      [{ birthDate: '1899-12-31' }, 'VALIDATION_FAILED', 'Enter your date of birth.'],
      [{ birthDate: '2020-01-01' }, 'VALIDATION_FAILED', 'Enter your date of birth.'],
      [{ birthDate: null }, 'VALIDATION_FAILED', 'Only ORBES Client Services can remove a date of birth.'],
      [{ instagram: 'not a name' }, 'VALIDATION_FAILED', 'Enter your Instagram username: letters, numbers, full stops and underscores, 30 at most.'],
      [{ heard: { optionId: randomUUID() } }, 'HEARD_UNAVAILABLE', 'This answer is no longer offered. Choose another.'],
      [{ tastes: { pieces: ['RING', 'WATCH'], finishes: [] } }, 'TASTE_UNKNOWN', 'Choose among the pieces and finishes of the collection.'],
      [{ tastes: { pieces: Array.from({ length: 31 }, (_, i) => `P${i}`), finishes: [] } }, 'TASTES_TOO_MANY', 'Choose up to 30 favourite pieces and 30 favourite finishes.'],
    ];
    for (const [change, code, message] of cases) {
      const res = await put(client, whole(read, { city: 'Lyon', ...change }));
      expect(res.statusCode, JSON.stringify(change)).toBe(400);
      expect(errorOf(res), JSON.stringify(change)).toEqual({ code, message });
    }
    // The outer wall: an unknown field, a missing one, a wrong type.
    for (const body of [{ ...whole(read), role: 'ADMIN' }, { version: read.profile.version }, whole(read, { version: 'one' })]) {
      const res = await put(client, body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    // Nothing of any refused SAVE was kept: the city typed with each is not there, the version unchanged.
    expect(safeJson(await client.get('/api/v1/account/profile'))).toEqual(read);
  });

  it('answers 409 PROFILE_CHANGED to a SAVE of a version read before another, and 409 for a second date of birth', async () => {
    const { client, email } = await accountClient(h);
    const id = await accountIdOf(email);
    const read = safeJson(await client.get('/api/v1/account/profile')) as any;
    expect((await put(client, whole(read, { city: 'Lyon', birthDate: '1985-06-01' }))).statusCode).toBe(200);
    const stale = await put(client, whole(read, { city: 'Paris' }));
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale)).toEqual({ code: 'PROFILE_CHANGED', message: 'Your profile was changed meanwhile.' });
    const now = safeJson(await client.get('/api/v1/account/profile')) as any;
    expect(now.profile).toMatchObject({ city: 'Lyon', birthDate: '1985-06-01', birthDateLocked: true, version: 2 });
    // The same date again is no change; another one is Client Services'.
    expect((await put(client, whole(now, { birthDate: '1985-06-01' }))).statusCode).toBe(200);
    const other = await put(client, whole(now, { birthDate: '1985-06-02' }));
    expect(other.statusCode).toBe(409);
    expect(errorOf(other)).toEqual({ code: 'BIRTH_DATE_SET', message: 'Your date of birth is saved. ORBES Client Services can change it.' });
    // Client Services removed the date the collector entered (step 5.4's route; written here as it would): the
    // collector's one entry is used, the date stays Client Services'.
    await h.ctx.db.updateTable('account_profiles').set({ birth_date: null, birth_date_by: null, birth_date_at: null }).where('account_id', '=', id).execute();
    const cleared = safeJson(await client.get('/api/v1/account/profile')) as any;
    expect(cleared.profile).toMatchObject({ birthDate: null, birthDateLocked: true });
    const again = await put(client, whole(cleared, { birthDate: '1985-06-01' }));
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toEqual({ code: 'BIRTH_DATE_ENTERED', message: 'You have entered your date of birth once. ORBES Client Services can set it.' });
  });

  it('answers 403 ACCOUNT_LOCKED when the account was locked while the SAVE was on its way; nothing is written', async () => {
    const { client, email } = await accountClient(h);
    const id = await accountIdOf(email);
    const read = safeJson(await client.get('/api/v1/account/profile')) as any;
    const profiles = h.ctx.services.profiles;
    const save = profiles.save.bind(profiles);
    const spy = vi.spyOn(profiles, 'save').mockImplementationOnce(async (...args) => {
      await h.ctx.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', id).execute();
      return save(...args);
    });
    try {
      const res = await put(client, whole(read, { city: 'Lyon' }));
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('ACCOUNT_LOCKED');
    } finally {
      spy.mockRestore();
    }
    expect((await h.ctx.db.selectFrom('account_profiles').select('city').where('account_id', '=', id).executeTakeFirstOrThrow()).city).toBeNull();
    // Locked, the account is signed out: the next read is a 401.
    expect((await client.get('/api/v1/account/profile')).statusCode).toBe(401);
  });

  it('shows the collector no trace of a staff save: the profile as saved, never who saved it', async () => {
    const { client, email } = await accountClient(h);
    const id = await accountIdOf(email);
    const read = safeJson(await client.get('/api/v1/account/profile')) as any;
    const staff = { type: 'admin' as const, id: randomUUID() };
    await h.ctx.services.profiles.saveByStaff(id, { version: read.profile.version, city: 'Bordeaux', instagram: 'owner.test' }, staff);
    const res = await client.get('/api/v1/account/profile');
    expect((safeJson(res) as any).profile).toMatchObject({ city: 'Bordeaux', instagram: 'owner.test', version: read.profile.version + 1 });
    expect(res.body).not.toMatch(STAFF_WORDS);
    expect(res.body).not.toContain(staff.id);
  });
});
