/**
 * The house's moments (macro scope of 2026-10-20, D24 M1; lot M2 plan §1.2, step M2.2; services/house-moments.ts and
 * src/shared/house-words.ts).
 *
 * The rules, as pure functions on a fake clock: each moment's due time (the Paris day after a first registration under
 * CET and CEST, a year of ownership with 29 February on 28 February, 7 days before a credit expires and never before it
 * was granted, 90 days after the last activity), the switch-on rule, the dedupe keys, the placeholders and their
 * rendering. The default words stay true for any THE PROGRAM setting: every credit channel set, PRIVATE CARE's pieces
 * none, one or several for PLATINE and PALLADIUM, PRIVATE CARE opening from any tier or not at all: no channel, mechanism
 * or count named, d)'s {tier} the tier PRIVATE CARE opens from.
 *
 * The job `runMoments`, on the services as createContext wires them (PGlite, the clock fixed): each moment delivered at
 * its due time and not a minute before, never for what fell due before its switch-on, once whatever the passes; a)
 * once ever with its piece; b) with its amount and expiry, nothing for a credit used up; c) nothing for a tier's credit
 * waiting below its tier; d) from PLATINE, from PALLADIUM when THE PROGRAM gives PLATINE none, nothing when it gives
 * none; e) the first year only, nothing for an ownership ended; f) once per absence, again after a new visit, never twice
 * for one absence when a session is purged; test entrants and LOCKED accounts left out; edited words and their
 * placeholders, an unknown placeholder refused, a blank title read as the default's; the audit by counts and the
 * console's switch and words audited as fingerprints; the housekeeping runs it in the morning window only.
 *
 * Under concurrency (PGlite always; PostgreSQL in genome-ci, ORBES_TEST_POSTGRES_URL): two passes at once deliver each
 * moment once.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { CREDIT_CHANNELS, HOUSE_MOMENTS, type HouseMoment } from '../../src/server/db/schema.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { AuditService } from '../../src/server/services/audit.js';
import { careOpens } from '../../src/server/services/care.js';
import { CLUB_TIER_NAMES } from '../../src/server/services/club.js';
import { DEFAULT_PROGRAM, type ClubProgram } from '../../src/server/services/club-program.js';
import {
  absenceDue,
  creditExpiringDue,
  firstRegistrationDue,
  HouseMomentService,
  isDue,
  momentKey,
  ownershipYearDue,
  renderMoment,
} from '../../src/server/services/house-moments.js';
import { ensureGrants } from '../../src/server/services/tier-grants.js';
import { createManualClock, type Actor, type Logger, type ManualClock } from '../../src/server/types.js';
import {
  HOUSE,
  HOUSE_DEFAULT_WORDS,
  HOUSE_MOMENT_LINKS,
  HOUSE_MOMENT_NAMES,
  HOUSE_PLACEHOLDERS,
  houseDate,
  houseMoney,
  renderHouseWords,
  unknownPlaceholders,
} from '../../src/shared/house-words.js';
import { HOUSE as COPY_HOUSE } from '../../src/web/verify/copy.js';
import { formatDateLong, formatMoney } from '../../src/web/verify/view-model.js';
import { createTestDb } from '../support/db.js';
import { createAccount, createModel, holdPieces, liveFixtureOn } from '../support/live.js';

const z = (iso: string) => new Date(iso);

describe('the moments’ due times (plan §1.2)', () => {
  it('a) the Paris day after the first ownership began, under CET and CEST', () => {
    // 1 March 2027 11:00 Paris (CET): due 2 March 00:00 Paris, 1 March 23:00 UTC.
    expect(firstRegistrationDue(z('2027-03-01T10:00:00Z')).toISOString()).toBe('2027-03-01T23:00:00.000Z');
    // 23:30 Paris is still that day: due at the next midnight; 00:30 Paris is the next day's.
    expect(firstRegistrationDue(z('2027-03-01T22:30:00Z')).toISOString()).toBe('2027-03-01T23:00:00.000Z');
    expect(firstRegistrationDue(z('2027-03-01T23:30:00Z')).toISOString()).toBe('2027-03-02T23:00:00.000Z');
    // CEST: 10 July 2027, due 11 July 00:00 Paris, 10 July 22:00 UTC; across 25 October 2026 (25 hours).
    expect(firstRegistrationDue(z('2027-07-10T08:00:00Z')).toISOString()).toBe('2027-07-10T22:00:00.000Z');
    expect(firstRegistrationDue(z('2026-10-25T08:00:00Z')).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('e) the Paris day one year after an ownership began, 29 February on 28 February', () => {
    expect(ownershipYearDue(z('2027-03-14T10:00:00Z')).toISOString()).toBe('2028-03-13T23:00:00.000Z');
    expect(ownershipYearDue(z('2028-02-29T12:00:00Z')).toISOString()).toBe('2029-02-27T23:00:00.000Z');
    // A Paris day, not a UTC one: 31 December 2027 23:30 UTC is 1 January 2028 in Paris.
    expect(ownershipYearDue(z('2027-12-31T23:30:00Z')).toISOString()).toBe('2028-12-31T23:00:00.000Z');
  });

  it('c) 7 days before a credit expires, never before it was granted; f) 90 days after the last activity', () => {
    expect(creditExpiringDue(z('2030-05-01T09:00:00Z'), z('2029-05-01T09:00:00Z')).toISOString()).toBe('2030-04-24T09:00:00.000Z');
    // A credit of 5 days is due when it is granted.
    expect(creditExpiringDue(z('2030-05-06T09:00:00Z'), z('2030-05-01T09:00:00Z')).toISOString()).toBe('2030-05-01T09:00:00.000Z');
    expect(absenceDue(z('2030-10-15T10:00:00Z')).toISOString()).toBe('2031-01-13T10:00:00.000Z');
  });

  it('delivers what falls due at or after the switch-on and not after now (the switch-on rule)', () => {
    const on = z('2027-03-01T09:00:00Z');
    expect(isDue(z('2027-03-01T08:59:59Z'), on, z('2027-03-05T00:00:00Z'))).toBe(false);
    expect(isDue(on, on, on)).toBe(true);
    expect(isDue(z('2027-03-05T00:00:01Z'), on, z('2027-03-05T00:00:00Z'))).toBe(false);
  });

  it('keys each delivery so it is made once: per account, grant, ownership, or account and absence', () => {
    const id = randomUUID();
    expect(momentKey.FIRST_REGISTRATION(id)).toBe(`FIRST_REGISTRATION:${id}`);
    expect(momentKey.NINETY_DAYS(id, z('2030-10-15T22:30:00Z'))).toBe(`NINETY_DAYS:${id}:2030-10-16`);
    for (const m of HOUSE_MOMENTS) expect((momentKey[m] as (a: string, b: Date) => string)(id, z('2030-10-15T10:00:00Z')).length).toBeLessThanOrEqual(200);
  });
});

describe('the moments’ words (src/shared/house-words.ts)', () => {
  it('names the six moments as the database does, each with its placeholders, links and default words, re-exported in copy.ts', () => {
    expect([...HOUSE_MOMENT_NAMES]).toEqual([...HOUSE_MOMENTS]);
    expect(COPY_HOUSE).toBe(HOUSE);
    expect(HOUSE.moments).toBe(HOUSE_DEFAULT_WORDS);
    for (const m of HOUSE_MOMENTS) {
      expect(HOUSE_PLACEHOLDERS[m]).toContain('firstName');
      expect(HOUSE_MOMENT_LINKS[m].length).toBeGreaterThan(0);
      const d = HOUSE_DEFAULT_WORDS[m];
      expect(d.title).toBe(d.title.toUpperCase());
      expect(d.title.length).toBeLessThanOrEqual(80);
      // The defaults use their moment's placeholders only, and none depends on a first name.
      expect(unknownPlaceholders(`${d.title} ${d.body}`, HOUSE_PLACEHOLDERS[m])).toEqual([]);
      expect(`${d.title} ${d.body}`).not.toContain('{firstName}');
    }
    expect(HOUSE_MOMENT_LINKS.FIRST_REGISTRATION).toEqual(['CARE', 'SIZES']);
    expect(HOUSE_DEFAULT_WORDS.BIRTHDAY_CREDIT.body).toBe('A credit of {amount} is yours until {expires}.');
    expect(HOUSE_DEFAULT_WORDS.PRIVATE_CARE.body).toBe('From {tier}, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.');
  });

  it('finds the placeholders a moment does not have, and renders the known ones (nothing without a value)', () => {
    expect(unknownPlaceholders('{piece} until {expires}, {Amount} {nope} {nope}', HOUSE_PLACEHOLDERS.FIRST_REGISTRATION)).toEqual(['{expires}', '{Amount}', '{nope}']);
    expect(unknownPlaceholders('{ firstName } {}', ['firstName'])).toEqual([]);
    expect(renderHouseWords('Dear {firstName}, {piece} {other}', { firstName: 'Camille', piece: 'MONOLITHE' })).toBe('Dear Camille, MONOLITHE {other}');
    expect(renderHouseWords('Dear {firstName}.', { firstName: null })).toBe('Dear .');
  });

  it('writes amounts and dates as the app does', () => {
    for (const [minor, currency] of [[2000, 'EUR'], [480050, 'EUR'], [100, 'GBP'], [123456789, 'USD'], [5000, 'CHF']] as const) expect(houseMoney(minor, currency)).toBe(formatMoney(minor, currency));
    for (const day of ['2026-11-12', '2029-04-08', '2030-01-01']) expect(houseDate(day)).toBe(formatDateLong(day));
    expect(houseMoney(2000, 'EUR')).toBe('€\u00a020');
    expect(houseDate('2029-04-08')).toBe('8 April 2029');
  });

  it('renders a moment as stored: one line of at most 400 characters, words of at most 8 000, a blank title read as the default’s', () => {
    const long = renderMoment('FIRST_REGISTRATION', { title: '{piece}', body: '{piece}' }, { piece: 'M'.repeat(9000) });
    expect([...long.title].length).toBe(400);
    expect([...long.body].length).toBe(8000);
    expect(long.title.endsWith('…')).toBe(true);
    expect(renderMoment('NINETY_DAYS', { title: '{firstName}', body: 'Hello\r\n\r\n{firstName}  again.' }, { firstName: null })).toEqual({ title: 'WHAT IS NEW', body: 'Hello\n\n  again.' });
    expect(renderMoment('NINETY_DAYS', { title: 'For  {firstName}\nand', body: null }, { firstName: 'Camille' }).title).toBe('For Camille and');
  });
});

/** Every THE PROGRAM setting the default words must stay true for (plan §1.2, §11 note 14). */
function programs(): ClubProgram[] {
  const channelSets: ClubProgram['creditChannels'][] = [];
  for (let mask = 0; mask < 1 << CREDIT_CHANNELS.length; mask++) channelSets.push(CREDIT_CHANNELS.filter((_, i) => mask & (1 << i)));
  const pieces = [null, 0, 1, 3, 20];
  const out: ClubProgram[] = [];
  for (const creditChannels of channelSets)
    for (const carePiecesPlatine of pieces)
      for (const carePiecesPalladium of pieces) out.push({ ...DEFAULT_PROGRAM, creditChannels, carePiecesPlatine, carePiecesPalladium });
  return out;
}

describe('the default words stay true for any THE PROGRAM setting (plan §1.2, S7)', () => {
  /** A channel, a mechanism or a count: what no default may name. */
  const NAMED = /\b(order|orders|invoice|invoices|checkout|platform|online|store|shop|draw|draws|live|salon|apply|applied|deducted|taken off|once a year|every year|per year|a year's|each|one piece|pieces? a year|times?)\b/i;

  it('names no channel, mechanism or count, and d)’s {tier} is the tier PRIVATE CARE opens from', () => {
    const all = programs();
    expect(all.length).toBe(8 * 25);
    let opened = 0;
    for (const p of all) {
      const opens = careOpens(p);
      for (const m of HOUSE_MOMENTS) {
        const values = {
          firstName: null,
          piece: 'MONOLITHE IN STEEL',
          amount: houseMoney(m === 'BIRTHDAY_CREDIT' ? p.birthdayCreditMinor : p.creditPlatineMinor, p.creditCurrency),
          expires: houseDate('2029-04-08'),
          tier: opens?.tier ?? null,
        };
        const w = renderMoment(m, { title: null, body: null }, values);
        const words = `${w.title}\n${w.body}`;
        expect(words, `${m} ${JSON.stringify(p.creditChannels)}`).not.toMatch(NAMED);
        // No figure but the placeholders' own values (an amount, a date): never a count of pieces or a frequency.
        let rest = words;
        for (const v of Object.values(values)) if (v) rest = rest.split(v).join('');
        expect(rest, m).not.toMatch(/\d/);
        if (m === 'PRIVATE_CARE' && opens) {
          opened++;
          expect(w.body).toBe(`From ${opens.tier}, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.`);
        }
      }
    }
    expect(opened).toBeGreaterThan(0);
    // Whatever tier it opens from (TITANE included, were THE PROGRAM ever to allow it): the same sentence, that tier named.
    for (const tier of CLUB_TIER_NAMES) {
      const body = renderMoment('PRIVATE_CARE', { title: null, body: null }, { tier }).body;
      expect(body).toBe(`From ${tier}, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.`);
      expect(body).not.toMatch(NAMED);
    }
  });
});

describe('the house’s moments delivered (HouseMomentService.runMoments)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: AppContext;
  let clock: ManualClock;
  let staff: Actor & { id: string };
  let modelId: string;
  const lines: { level: string; o: unknown; msg: unknown }[] = [];
  const log: Logger = {
    info: (o: unknown, msg?: unknown) => void lines.push({ level: 'info', o, msg }),
    warn: (o: unknown, msg?: unknown) => void lines.push({ level: 'warn', o, msg }),
    error: (o: unknown, msg?: unknown) => void lines.push({ level: 'error', o, msg }),
  };

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2027-02-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, log, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    const f = await liveFixtureOn(ctx, clock);
    staff = f.admin;
    modelId = f.modelId;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });
  afterEach(async () => {
    for (const m of HOUSE_MOMENTS) await ctx.services.houseMoments.setMoment(m, { enabled: false, title: null, body: null }, staff);
    await ctx.services.clubProgram.update({ ...DEFAULT_PROGRAM, creditChannels: [...DEFAULT_PROGRAM.creditChannels] }, staff);
  });

  const moments = () => ctx.services.houseMoments;
  /** Switch `m` on now (off first: its switch-on is now). */
  const on = async (m: HouseMoment) => {
    await moments().setMoment(m, { enabled: false }, staff);
    return moments().setMoment(m, { enabled: true }, staff);
  };
  const pass = () => moments().runMoments(clock.now());
  const of = (accountId: string) =>
    t.db.selectFrom('house_deliveries').select(['source', 'moment', 'title', 'body', 'piece_ref', 'dedupe_key', 'delivered_at', 'read_at']).where('account_id', '=', accountId).orderBy('delivered_at').orderBy('id').execute();
  const named = async (name: string) => {
    const a = await createAccount(t.db);
    await t.db.insertInto('account_profiles').values({ account_id: a.id, first_name: name }).execute();
    return a;
  };
  const serialOf = async (productId: string) => (await t.db.selectFrom('products').select('product_id').where('id', '=', productId).executeTakeFirstOrThrow()).product_id;

  it('a) delivers the Paris day after a first registration, its piece named, once ever; nothing for what fell due before the switch-on', async () => {
    const steel = await createModel(t.db, 'ECLIPSE');
    await t.db.updateTable('models').set({ variant_label: 'Steel blue', variant_swatch: '#9D9B96' }).where('id', '=', steel).execute();
    // Its first ownership on 28 February 2027, 23:00 Paris: due 1 March 00:00 Paris, before the switch-on.
    const before = await createAccount(t.db);
    await holdPieces(t.db, before.id, 1, modelId, { startedAt: z('2027-02-28T22:00:00Z') });
    clock.set('2027-03-01T09:00:00Z');
    const view = await on('FIRST_REGISTRATION');
    expect(view).toMatchObject({ moment: 'FIRST_REGISTRATION', enabled: true, enabledAt: clock.now(), title: null, body: null, links: ['CARE', 'SIZES'] });
    const a = await named('Camille');
    const [piece] = await holdPieces(t.db, a.id, 1, steel, { startedAt: z('2027-03-01T10:00:00Z') });
    // 1 March 23:59 Paris: nothing yet. 2 March 00:00 Paris: delivered.
    clock.set('2027-03-01T22:59:00Z');
    await pass();
    expect(await of(a.id)).toEqual([]);
    clock.set('2027-03-01T23:00:00Z');
    expect(await pass()).toBeGreaterThanOrEqual(1);
    expect(await of(a.id)).toEqual([
      {
        source: 'MOMENT',
        moment: 'FIRST_REGISTRATION',
        title: 'YOUR FIRST PIECE',
        body: 'ECLIPSE IN STEEL BLUE is registered to you. How to care for it is in its ORBES CARE tab, and YOUR SIZES keeps your sizes for the releases to come.',
        piece_ref: await serialOf(piece!),
        dedupe_key: `FIRST_REGISTRATION:${a.id}`,
        delivered_at: clock.now(),
        read_at: null,
      },
    ]);
    // A second piece, and the passes after: never again.
    await holdPieces(t.db, a.id, 1, modelId, { startedAt: z('2027-03-03T10:00:00Z') });
    clock.set('2027-03-05T09:00:00Z');
    await pass();
    await pass();
    expect(await of(a.id)).toHaveLength(1);
    expect(await of(before.id)).toEqual([]);
  });

  it('e) delivers a year after an ownership began, 29 February on 28 February, the first year only; nothing for an ownership ended', async () => {
    clock.set('2029-01-01T09:00:00Z');
    const leap = await createAccount(t.db);
    const [piece] = await holdPieces(t.db, leap.id, 1, modelId, { startedAt: z('2028-02-29T12:00:00Z') });
    const earlier = await createAccount(t.db);
    await holdPieces(t.db, earlier.id, 1, modelId, { startedAt: z('2027-12-01T12:00:00Z') });
    const ended = await createAccount(t.db);
    const [gone] = await holdPieces(t.db, ended.id, 1, modelId, { startedAt: z('2028-02-29T12:00:00Z') });
    await t.db.updateTable('ownership').set({ ended_at: z('2028-06-01T12:00:00Z'), ended_reason: 'TRANSFERRED' }).where('product_id', '=', gone!).execute();
    await on('OWNERSHIP_YEAR');
    clock.set('2029-02-27T22:59:00Z');
    await pass();
    expect(await of(leap.id)).toEqual([]);
    clock.set('2029-02-27T23:00:00Z');
    await pass();
    const [own] = await t.db.selectFrom('ownership').select('id').where('product_id', '=', piece!).execute();
    expect(await of(leap.id)).toEqual([
      { source: 'MOMENT', moment: 'OWNERSHIP_YEAR', title: 'ONE YEAR', body: 'MONOLITHE has been yours for a year today.', piece_ref: await serialOf(piece!), dedupe_key: `OWNERSHIP_YEAR:${own!.id}`, delivered_at: clock.now(), read_at: null },
    ]);
    clock.set('2030-02-28T09:00:00Z');
    await pass();
    expect(await of(leap.id)).toHaveLength(1);
    expect(await of(earlier.id)).toEqual([]);
    expect(await of(ended.id)).toEqual([]);
  });

  /** A SALON order of the account, to take a credit off. */
  async function useCredit(accountId: string, grantId: string, amount: number) {
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: modelId }).returning('id').executeTakeFirstOrThrow();
    const location = await t.db.selectFrom('stock_locations').select('id').orderBy('name').executeTakeFirstOrThrow();
    const order = await t.db.insertInto('orders').values({ channel: 'SALON', shop_request_id: request.id, account_id: accountId, model_id: modelId, location_id: location.id }).returning('id').executeTakeFirstOrThrow();
    await t.db.insertInto('credit_uses').values({ grant_id: grantId, order_id: order.id, amount_minor: amount, applied_by: staff.id, applied_at: clock.now() }).execute();
  }

  it('b) delivers the birthday credit opened, with its amount and last day; nothing for one used up', async () => {
    clock.set('2029-03-01T09:00:00Z');
    const a = await createAccount(t.db);
    const used = await createAccount(t.db);
    for (const x of [a, used]) await ctx.services.profiles.save(x.id, { version: 0, birthDate: '1990-03-10' }, x.actor);
    await on('BIRTHDAY_CREDIT');
    // 10 March 2029, 00:00 Paris: the credit, then its moment.
    clock.set('2029-03-09T23:00:00Z');
    await ctx.services.birthdayCredits.grantDue(clock.now());
    const grant = await t.db.selectFrom('tier_grants').select('id').where('account_id', '=', used.id).where('kind', '=', 'BIRTHDAY').executeTakeFirstOrThrow();
    await useCredit(used.id, grant.id, 2000);
    await pass();
    const [mine] = await t.db.selectFrom('tier_grants').select('id').where('account_id', '=', a.id).where('kind', '=', 'BIRTHDAY').execute();
    expect(await of(a.id)).toEqual([
      { source: 'MOMENT', moment: 'BIRTHDAY_CREDIT', title: 'YOUR BIRTHDAY CREDIT', body: 'A credit of €\u00a020 is yours until 8 April 2029.', piece_ref: null, dedupe_key: `BIRTHDAY_CREDIT:${mine!.id}`, delivered_at: clock.now(), read_at: null },
    ]);
    expect(await of(used.id)).toEqual([]);
  });

  it('c) delivers 7 days before a credit expires, its balance and last day; nothing for a tier’s credit waiting below its tier', async () => {
    clock.set('2029-05-01T09:00:00Z');
    await on('CREDIT_EXPIRING');
    const platine = await createAccount(t.db);
    await holdPieces(t.db, platine.id, 5, modelId, { startedAt: z('2029-05-01T08:00:00Z') });
    const below = await createAccount(t.db);
    const held = await holdPieces(t.db, below.id, 5, modelId, { startedAt: z('2029-05-01T08:00:00Z') });
    for (const x of [platine, below]) await ensureGrants(t.db, x.id, clock.now());
    // Back to TITANE: its PLATINE credit waits.
    await t.db.updateTable('ownership').set({ ended_at: z('2029-06-01T08:00:00Z'), ended_reason: 'TRANSFERRED' }).where('product_id', 'in', held.slice(1)).execute();
    const credit = await t.db.selectFrom('tier_grants').select(['id', 'expires_at']).where('account_id', '=', platine.id).where('kind', '=', 'CREDIT').executeTakeFirstOrThrow();
    expect(credit.expires_at!.toISOString()).toBe('2030-05-01T09:00:00.000Z');
    await useCredit(platine.id, credit.id, 1500);
    clock.set('2030-04-24T08:59:00Z');
    await pass();
    expect(await of(platine.id)).toEqual([]);
    clock.set('2030-04-24T09:00:00Z');
    await pass();
    expect(await of(platine.id)).toEqual([
      { source: 'MOMENT', moment: 'CREDIT_EXPIRING', title: 'A CREDIT ENDS SOON', body: '€\u00a035 of your credit ends on 1 May 2030.', piece_ref: null, dedupe_key: `CREDIT_EXPIRING:${credit.id}`, delivered_at: clock.now(), read_at: null },
    ]);
    expect(await of(below.id)).toEqual([]);
  });

  it('d) delivers PRIVATE CARE from the tier it opens from, PALLADIUM when PLATINE has none, nothing when THE PROGRAM gives none', async () => {
    const reach = async (pieces: number) => {
      const a = await createAccount(t.db);
      await holdPieces(t.db, a.id, pieces, modelId, { startedAt: clock.now() });
      await ensureGrants(t.db, a.id, clock.now());
      return a;
    };
    const earlier = await reach(5);
    clock.set('2030-06-01T09:00:00Z');
    await on('PRIVATE_CARE');
    clock.set('2030-06-01T10:00:00Z');
    const platine = await reach(5);
    clock.set('2030-06-01T11:00:00Z');
    await pass();
    expect((await of(platine.id)).map((d) => [d.title, d.body, d.dedupe_key])).toEqual([
      ['PRIVATE CARE', 'From PLATINE, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.', `PRIVATE_CARE:${platine.id}`],
    ]);
    expect(await of(earlier.id)).toEqual([]);
    // PLATINE gives none: from PALLADIUM.
    await ctx.services.clubProgram.update({ ...DEFAULT_PROGRAM, creditChannels: [...DEFAULT_PROGRAM.creditChannels], carePiecesPlatine: 0, carePiecesPalladium: 2 }, staff);
    const platine2 = await reach(5);
    const palladium = await reach(10);
    clock.set('2030-06-01T12:00:00Z');
    await pass();
    expect(await of(platine2.id)).toEqual([]);
    expect((await of(palladium.id)).map((d) => d.body)).toEqual(['From PALLADIUM, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.']);
    // No tier gives it: nothing at all.
    await ctx.services.clubProgram.update({ ...DEFAULT_PROGRAM, creditChannels: [...DEFAULT_PROGRAM.creditChannels], carePiecesPlatine: 0, carePiecesPalladium: 0 }, staff);
    const none = await reach(10);
    clock.set('2030-06-01T13:00:00Z');
    await pass();
    expect(await of(none.id)).toEqual([]);
  });

  it('f) delivers 90 days after the last visit, once per absence, again after a new visit, never twice when a session is purged', async () => {
    const account = await createAccount(t.db);
    const idle = await createAccount(t.db);
    await t.db.updateTable('accounts').set({ created_at: z('2030-09-01T10:00:00Z') }).where('id', 'in', [account.id, idle.id]).execute();
    const session = async (accountId: string, lastSeen: string) => {
      const id = randomBytes(32);
      await t.db.insertInto('sessions').values({ id_hash: id, subject_type: 'account', subject_id: accountId, csrf_token: 'x', created_at: z(lastSeen), expires_at: z('2032-01-01T00:00:00Z'), last_seen_at: z(lastSeen) }).execute();
      return id;
    };
    // Signed in on 14 October, its session last used on 15 October.
    clock.set('2030-10-14T10:00:00Z');
    await ctx.audit.record({ actor: account.actor, action: 'account.login', targetType: 'account', targetId: account.id });
    const first = await session(account.id, '2030-10-15T10:00:00Z');
    // Idle since 1 October: due 30 December, before the switch-on.
    await session(idle.id, '2030-10-01T10:00:00Z');
    clock.set('2031-01-10T09:00:00Z');
    await on('NINETY_DAYS');
    clock.set('2031-01-13T09:59:00Z');
    await pass();
    expect(await of(account.id)).toEqual([]);
    clock.set('2031-01-13T10:00:00Z');
    await pass();
    expect(await of(account.id)).toEqual([
      { source: 'MOMENT', moment: 'NINETY_DAYS', title: 'WHAT IS NEW', body: 'Since your last visit, THE COLLECTION and THE RELEASES have moved on.', piece_ref: null, dedupe_key: `NINETY_DAYS:${account.id}:2030-10-15`, delivered_at: clock.now(), read_at: null },
    ]);
    // Its session purged: the last activity reads its sign-in of 14 October (due 12 January, after the switch-on), yet
    // this absence has had its message.
    await t.db.deleteFrom('sessions').where('id_hash', '=', first).execute();
    clock.set('2031-02-01T10:00:00Z');
    await pass();
    expect(await of(account.id)).toHaveLength(1);
    expect(await of(idle.id)).toEqual([]);
    // A new visit, then 90 days: again.
    await session(account.id, '2031-02-01T10:00:00Z');
    clock.set('2031-05-02T10:00:00Z');
    await pass();
    expect((await of(account.id)).map((d) => d.dedupe_key)).toEqual([`NINETY_DAYS:${account.id}:2030-10-15`, `NINETY_DAYS:${account.id}:2031-02-01`]);
  });

  it('leaves out the test entrants and the LOCKED accounts', async () => {
    clock.set('2031-06-01T09:00:00Z');
    await on('FIRST_REGISTRATION');
    const [entrant, locked, active] = [await createAccount(t.db), await createAccount(t.db), await createAccount(t.db)];
    for (const a of [entrant, locked, active]) await holdPieces(t.db, a.id, 1, modelId, { startedAt: z('2031-06-01T10:00:00Z') });
    await t.db.insertInto('test_entrants').values({ account_id: entrant.id, tier: 1 }).execute();
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    clock.set('2031-06-02T09:00:00Z');
    await pass();
    expect(await of(active.id)).toHaveLength(1);
    expect(await of(entrant.id)).toEqual([]);
    expect(await of(locked.id)).toEqual([]);
  });

  it('renders the words as edited, refuses a placeholder the moment does not have, and audits the switch and words as fingerprints', async () => {
    clock.set('2031-07-01T09:00:00Z');
    await on('FIRST_REGISTRATION');
    await expect(moments().setMoment('FIRST_REGISTRATION', { body: 'Until {expires}.' }, staff)).rejects.toMatchObject({ code: 'HOUSE_PLACEHOLDER', httpStatus: 422 });
    await expect(moments().setMoment('FIRST_REGISTRATION', { title: 'ONE\nTWO' }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(moments().setMoment('FIRST_REGISTRATION', { title: 'T'.repeat(81) }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(moments().setMoment('NOPE', { enabled: true }, staff)).rejects.toMatchObject({ code: 'HOUSE_MOMENT_NOT_FOUND', httpStatus: 404 });
    const view = await moments().setMoment('FIRST_REGISTRATION', { title: '  WELCOME {firstName}  ', body: 'Dear {firstName},\r\n\r\n{piece} is yours.' }, staff);
    expect(view).toMatchObject({ enabled: true, title: 'WELCOME {firstName}', body: 'Dear {firstName},\n\n{piece} is yours.' });
    const camille = await named('Camille');
    const nobody = await createAccount(t.db);
    for (const a of [camille, nobody]) await holdPieces(t.db, a.id, 1, modelId, { startedAt: z('2031-07-01T10:00:00Z') });
    clock.set('2031-07-02T09:00:00Z');
    await pass();
    expect((await of(camille.id)).map((d) => [d.title, d.body])).toEqual([['WELCOME Camille', 'Dear Camille,\n\nMONOLITHE is yours.']]);
    expect((await of(nobody.id)).map((d) => [d.title, d.body])).toEqual([['WELCOME', 'Dear ,\n\nMONOLITHE is yours.']]);
    // The words back to the defaults: the deliveries made keep theirs.
    await moments().setMoment('FIRST_REGISTRATION', { title: null, body: '' }, staff);
    expect((await of(camille.id))[0]!.title).toBe('WELCOME Camille');
    const audits = await t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'target_type', 'target_id', 'details']).where('target_type', '=', 'house_moment').where('occurred_at', '>=', z('2031-07-01T00:00:00Z')).orderBy('id').execute();
    const words = audits.filter((a) => a.action === 'house.moment.words');
    expect(words[0]!.details).toEqual({
      moment: 'FIRST_REGISTRATION',
      title: { length: 19, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      body: { length: 'Dear {firstName},\n\n{piece} is yours.'.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      defaults: { title: false, body: false },
    });
    expect(words[1]!.details).toEqual({ moment: 'FIRST_REGISTRATION', title: null, body: null, defaults: { title: true, body: true } });
    expect(JSON.stringify(audits)).not.toMatch(/WELCOME|Dear|Camille/);
    expect(audits.filter((a) => a.action === 'house.moment.enable').map((a) => [a.actor_type, a.target_id, a.details])).toContainEqual(['admin', 'FIRST_REGISTRATION', { moment: 'FIRST_REGISTRATION' }]);
    // Each delivery audited as a count, by the system, naming no account.
    const delivered = audits.filter((a) => a.action === 'house.moment.delivered');
    expect(delivered.map((a) => [a.actor_type, a.target_id, a.details])).toEqual([['system', 'FIRST_REGISTRATION', { moment: 'FIRST_REGISTRATION', count: 2 }]]);
    // A switch-off audited, and its switch-on cleared.
    expect(await moments().setMoment('FIRST_REGISTRATION', { enabled: false }, staff)).toMatchObject({ enabled: false, enabledAt: null });
    expect(lines.some((l) => l.msg === 'house moments' && (l.o as { FIRST_REGISTRATION?: number }).FIRST_REGISTRATION === 2)).toBe(true);
  });

  it('runs in the housekeeping’s morning window only, after the birthday credits', async () => {
    clock.set('2031-08-01T09:00:00Z');
    await on('FIRST_REGISTRATION');
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, 1, modelId, { startedAt: z('2031-08-01T10:00:00Z') });
    const hk = startHousekeeping(ctx, { intervalMs: 3_600_000 });
    try {
      // 2 August, 06:00 UTC: before the window (07:30 UTC).
      clock.set('2031-08-02T06:00:00Z');
      expect((await hk.runOnce()).houseMoments).toBe(0);
      expect(await of(a.id)).toEqual([]);
      clock.set('2031-08-02T07:30:00Z');
      expect((await hk.runOnce()).houseMoments).toBe(1);
      expect(await of(a.id)).toHaveLength(1);
    } finally {
      await hk.stop();
    }
  });
});

// ── Under concurrency ──────────────────────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

const BACKENDS: { name: string; skip: boolean; open(): Promise<{ db: Db; close(): Promise<void> }> }[] = [
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
      const name = `orbes_house_${randomBytes(6).toString('hex')}`;
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

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`the house's moments on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    beforeAll(async () => {
      ({ db, close } = await backend.open());
    }, 60_000);
    afterAll(() => close?.());

    it('two housekeeping passes at once deliver each moment once', async () => {
      const clock = createManualClock('2027-03-02T09:00:00.000Z');
      const passes = [0, 1, 2, 3].map(() => new HouseMomentService({ db, audit: new AuditService({ db, clock: clock.now }), clock: clock.now }));
      await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
      const admin = await db.insertInto('admin_users').values({ email: `house-${randomUUID()}@orbes.test`, email_normalized: `house-${randomUUID()}@orbes.test`, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('house_moment_settings').values({ moment: 'FIRST_REGISTRATION', enabled: true, enabled_at: z('2027-03-01T09:00:00Z'), updated_by: admin.id }).execute();
      const model = await createModel(db, 'MONOLITHE');
      const accounts: string[] = [];
      for (let i = 0; i < 12; i++) {
        const a = await createAccount(db);
        await holdPieces(db, a.id, 1, model, { startedAt: z('2027-03-01T10:00:00Z') });
        accounts.push(a.id);
      }
      const counts = await Promise.all(passes.map((p) => p.runMoments(clock.now())));
      expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
      const rows = await db.selectFrom('house_deliveries').select(['account_id', 'dedupe_key']).execute();
      expect(rows.map((r) => r.account_id).sort()).toEqual([...accounts].sort());
      const audited = await db.selectFrom('audit_logs').select('details').where('action', '=', 'house.moment.delivered').execute();
      expect(audited.reduce((n, a) => n + (a.details as { count: number }).count, 0)).toBe(12);
    });
  });
}
