/**
 * The birthday credit (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.4; services/birthday-credits.ts).
 *
 * Its rules, as pure functions read by the client sheet's Club block (step 6.3) and the daily grant (step 6.4):
 *
 *  - the birthday a Paris day, 29 February on 28 February in a common year;
 *  - its expiry the end of its 30th day (Paris), the birthday day 1, under CET and CEST;
 *  - 365 days between two birthdays, across a leap year;
 *  - the next birthday: not granted, not expired, the date entered before its 00:00 Paris, 365 days after the last.
 *
 * The daily grant, `BirthdayCreditService.grantDue` (SB.4.4, SB.4.8), on the services as createContext wires them
 * (PGlite, the clock fixed):
 *
 *  - given at the first pass of the birthday (Paris), not at 23:59 Paris the day before, under CET and CEST; its
 *    amount, currency and expiry (the end of day 30) THE PROGRAM's; a second pass gives nothing more;
 *  - 29 February: on 28 February of a common year, on 29 February of a leap year, 365 days apart counted enough;
 *  - the entered-before rule (question 20): a date entered at 23:59 Paris on the eve is credited at midnight; one
 *    entered at 00:00 Paris on the birthday, or in the days after, gives nothing that year and the credit the next; a
 *    date changed by Client Services on or after the new date's birthday gives nothing for it;
 *  - a missed day is caught up within the days with the same expiry, never after;
 *  - the 365 days hold after Client Services changes the date of birth;
 *  - switched off, nothing is given and the credits given stay usable; switched back on within the days, it is given;
 *  - an amount or a length changed applies to the credits given from then on;
 *  - a LOCKED account is granted like an ACTIVE one; a DELETED one and a test entrant never;
 *  - two passes at once give one row; a failure on one account is logged and the others go on;
 *  - audited `club.grant` with `kind: 'BIRTHDAY'` by the system, and never the date of birth;
 *  - housekeeping runs it at every pass, outside the morning window too (`runOnce().birthdayCredits`).
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { BIRTHDAY_GAP_DAYS, birthdayExpiry, birthdayIn, birthMonthDays, candidateDays, dayPlus, daysBetween, nextBirthday } from '../../src/server/services/birthday-credits.js';
import { DEFAULT_PROGRAM, type ClubProgram } from '../../src/server/services/club-program.js';
import { creditBalances, usableAt } from '../../src/server/services/tier-grants.js';
import { createManualClock, type Actor, type Logger, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, liveFixtureOn } from '../support/live.js';

describe('the birthday credit\'s rules (§3.5 SB.4.1)', () => {
  it('puts the birthday on its month and day, 29 February on 28 February in a common year', () => {
    expect(birthdayIn(2027, '1994-03-14')).toBe('2027-03-14');
    expect(birthdayIn(2027, '2000-02-29')).toBe('2027-02-28');
    expect(birthdayIn(2028, '2000-02-29')).toBe('2028-02-29');
    expect(birthdayIn(2100, '2000-02-29')).toBe('2100-02-28');
    expect(birthdayIn(2000, '1996-02-29')).toBe('2000-02-29');
  });

  it('ends a credit at the last instant (Paris) of its days, the birthday day 1: 14 March with 30 days until 12 April 23:59:59.999', () => {
    // CEST (UTC+2) on 12 April 2027.
    expect(birthdayExpiry('2027-03-14', 30).toISOString()).toBe('2027-04-12T21:59:59.999Z');
    // CET (UTC+1): 1 December with 30 days until 30 December.
    expect(birthdayExpiry('2026-12-01', 30).toISOString()).toBe('2026-12-30T22:59:59.999Z');
    // One day: the birthday itself; across 25 October 2026 (a 25-hour day), its end is CET's.
    expect(birthdayExpiry('2026-10-25', 1).toISOString()).toBe('2026-10-25T22:59:59.999Z');
    expect(birthdayExpiry('2026-10-24', 1).toISOString()).toBe('2026-10-24T21:59:59.999Z');
  });

  it('counts 365 days birthday against birthday, across a leap year', () => {
    expect(BIRTHDAY_GAP_DAYS).toBe(365);
    expect(daysBetween('2028-02-29', '2029-02-28')).toBe(365);
    expect(daysBetween('2027-03-14', '2028-03-14')).toBe(366);
    expect(daysBetween('2027-03-14', '2027-11-20')).toBe(251);
    expect(dayPlus('2027-03-14', 29)).toBe('2027-04-12');
    expect(dayPlus('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('says the next birthday the rules allow', () => {
    const now = new Date('2027-02-01T10:00:00.000Z');
    const next = (birthDate: string | null, at: string | null, granted: string[] = [], days = 30, when = now) => nextBirthday({ birthDate, birthDateAt: at === null ? null : new Date(at), granted, days, now: when });
    expect(next(null, null)).toBeNull();
    expect(next('1994-03-14', '2027-01-01T09:00:00.000Z')).toBe('2027-03-14');
    // Entered at 23:59 Paris on the eve (CET): it counts; at 00:00 Paris on the birthday: the next year.
    expect(next('1994-03-14', '2027-03-13T22:59:00.000Z', [], 30, new Date('2027-03-13T23:30:00.000Z'))).toBe('2027-03-14');
    expect(next('1994-03-14', '2027-03-13T23:00:00.000Z', [], 30, new Date('2027-03-13T23:30:00.000Z'))).toBe('2028-03-14');
    // Under CEST: 21:59 and 22:00 UTC on the eve.
    expect(next('1994-07-10', '2027-07-09T21:59:00.000Z', [], 30, new Date('2027-07-09T22:30:00.000Z'))).toBe('2027-07-10');
    expect(next('1994-07-10', '2027-07-09T22:00:00.000Z', [], 30, new Date('2027-07-09T22:30:00.000Z'))).toBe('2028-07-10');
    // A birthday passed within its days, not granted, entered before: today's; once expired, the next year's.
    expect(next('1990-01-20', '2026-12-01T09:00:00.000Z')).toBe('2027-02-01');
    expect(next('1990-01-02', '2026-12-01T09:00:00.000Z')).toBe('2028-01-02');
    // Granted: the next, 365 days on; a date changed after it: never before 365 days.
    expect(next('1994-03-14', '2026-01-01T09:00:00.000Z', ['2027-03-14'], 30, new Date('2027-03-20T10:00:00.000Z'))).toBe('2028-03-14');
    expect(next('1994-11-20', '2027-03-20T10:00:00.000Z', ['2027-03-14'], 30, new Date('2027-03-20T10:00:00.000Z'))).toBe('2028-11-20');
    // 29 February granted in 2028, 28 February 2029 is 365 days on.
    expect(next('2000-02-29', '2027-01-01T09:00:00.000Z', ['2028-02-29'], 30, new Date('2028-03-01T10:00:00.000Z'))).toBe('2029-02-28');
  });
});

describe('the days a birthday is due on (§3.5 SB.4.4 step 2)', () => {
  it('lists the days a credit given now would still be valid for, the oldest first', () => {
    expect(candidateDays('2027-03-14', 1)).toEqual(['2027-03-14']);
    expect(candidateDays('2027-03-02', 3)).toEqual(['2027-02-28', '2027-03-01', '2027-03-02']);
    const year = candidateDays('2028-03-01', 365);
    expect(year).toHaveLength(365);
    expect(year[0]).toBe('2027-03-03');
    expect(year.at(-1)).toBe('2028-03-01');
    // No (month, day) of birth is due on two of them, at the longest validity THE PROGRAM allows.
    const keys = year.flatMap((d) => birthMonthDays(d).map(([m, day]) => `${m}-${day}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('adds 29 February to 28 February of a common year only', () => {
    expect(birthMonthDays('2027-03-14')).toEqual([[3, 14]]);
    expect(birthMonthDays('2027-02-28')).toEqual([[2, 28], [2, 29]]);
    expect(birthMonthDays('2028-02-28')).toEqual([[2, 28]]);
    expect(birthMonthDays('2028-02-29')).toEqual([[2, 29]]);
    expect(birthMonthDays('2100-02-28')).toEqual([[2, 28], [2, 29]]);
  });
});

describe('the daily grant of the birthday credit (§3.5 SB.4.4)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let staff: Actor;
  const lines: { level: string; o: unknown; msg: unknown }[] = [];
  const log: Logger = {
    info: (o: unknown, msg?: unknown) => void lines.push({ level: 'info', o, msg }),
    warn: (o: unknown, msg?: unknown) => void lines.push({ level: 'warn', o, msg }),
    error: (o: unknown, msg?: unknown) => void lines.push({ level: 'error', o, msg }),
  };

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-03T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, log, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    staff = (await liveFixtureOn(ctx, clock)).admin;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const pass = () => ctx.services.birthdayCredits.grantDue(clock.now());
  const grantsOf = (accountId: string) =>
    t.db.selectFrom('tier_grants').select(['tier', 'kind', 'birthday_on', 'amount_minor', 'currency', 'granted_at', 'expires_at']).where('account_id', '=', accountId).orderBy('birthday_on').execute();
  const birthdaysOf = async (accountId: string) => (await grantsOf(accountId)).map((g) => g.birthday_on);
  const grantAudits = (accountId: string) =>
    t.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('target_id', '=', accountId).where('action', '=', 'club.grant').orderBy('id').execute();
  /** How many birthday credits the registry holds: the accounts of the earlier cases have their birthdays too. */
  const given = async () => Number((await t.db.selectFrom('tier_grants').select((eb) => eb.fn.countAll<number>().as('n')).where('kind', '=', 'BIRTHDAY').executeTakeFirstOrThrow()).n);
  const setProgram = (over: Partial<ClubProgram>) => ctx.services.clubProgram.update({ ...DEFAULT_PROGRAM, creditChannels: [...DEFAULT_PROGRAM.creditChannels], ...over }, staff);

  /** An account whose date of birth the collector enters at `at` (YOUR PROFILE's SAVE: `birth_date_at` is that instant). */
  async function born(birthDate: string, at: string) {
    const a = await createAccount(t.db);
    const back = clock.now();
    clock.set(at);
    await ctx.services.profiles.save(a.id, { version: 0, birthDate }, a.actor);
    clock.set(back);
    return a;
  }

  it('is given at the first pass of the birthday (Paris), not at 23:59 Paris the day before, under CET: € 20 until the end of day 30', async () => {
    const a = await born('1994-03-14', '2027-01-10T09:00:00.000Z');
    // 13 March 2027, 23:59 Paris (CET, UTC+1).
    clock.set('2027-03-13T22:59:00.000Z');
    await pass();
    expect(await grantsOf(a.id)).toEqual([]);
    // 14 March 2027, 00:00 Paris.
    clock.set('2027-03-13T23:00:00.000Z');
    expect(await pass()).toBeGreaterThanOrEqual(1);
    expect(await grantsOf(a.id)).toEqual([
      { tier: null, kind: 'BIRTHDAY', birthday_on: '2027-03-14', amount_minor: 2_000, currency: 'EUR', granted_at: new Date('2027-03-13T23:00:00.000Z'), expires_at: new Date('2027-04-12T21:59:59.999Z') },
    ]);
    // The next passes of the day, and of the days after, give nothing more.
    clock.set('2027-03-13T23:10:00.000Z');
    await pass();
    clock.set('2027-03-20T08:00:00.000Z');
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2027-03-14']);
    // A credit like a tier's, usable whatever the tier.
    const [credit] = await creditBalances(t.db, a.id);
    expect(credit).toMatchObject({ kind: 'BIRTHDAY', tier: null, birthdayOn: '2027-03-14', amountMinor: 2_000, balanceMinor: 2_000, currency: 'EUR' });
    expect(usableAt(credit!, 0)).toBe(true);
  });

  it('is given at the first pass of the birthday under CEST: 22:00 UTC, not 21:59', async () => {
    const a = await born('1990-07-10', '2027-05-02T09:00:00.000Z');
    // 9 July 2027, 23:59 Paris (CEST, UTC+2).
    clock.set('2027-07-09T21:59:00.000Z');
    await pass();
    expect(await grantsOf(a.id)).toEqual([]);
    clock.set('2027-07-09T22:00:00.000Z');
    await pass();
    expect(await grantsOf(a.id)).toEqual([
      { tier: null, kind: 'BIRTHDAY', birthday_on: '2027-07-10', amount_minor: 2_000, currency: 'EUR', granted_at: new Date('2027-07-09T22:00:00.000Z'), expires_at: new Date('2027-08-08T21:59:59.999Z') },
    ]);
  });

  it('puts 29 February on 28 February of a common year, on 29 February of a leap year, and counts 365 days across it', async () => {
    const a = await born('2000-02-29', '2026-12-01T09:00:00.000Z');
    const other = await born('1996-02-28', '2026-12-01T09:00:00.000Z');
    // 27 February 2027: nothing. 28 February 2027, 00:00 Paris: both, the 29th born on the 28th.
    clock.set('2027-02-26T23:00:00.000Z');
    await pass();
    expect(await grantsOf(a.id)).toEqual([]);
    clock.set('2027-02-27T23:00:00.000Z');
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2027-02-28']);
    expect(await birthdaysOf(other.id)).toEqual(['2027-02-28']);
    // 2028, a leap year: on 28 February only the one born on the 28th (365 days on); the 29th born on the 29th (366 days on).
    clock.set('2028-02-27T23:00:00.000Z');
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2027-02-28']);
    expect(await birthdaysOf(other.id)).toEqual(['2027-02-28', '2028-02-28']);
    clock.set('2028-02-28T23:00:00.000Z');
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2027-02-28', '2028-02-29']);
    // 28 February 2029 is 365 days after 29 February 2028: given.
    clock.set('2029-02-27T23:00:00.000Z');
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
    expect((await grantsOf(a.id)).at(-1)!.expires_at).toEqual(birthdayExpiry('2029-02-28', 30));
  });

  it.each([
    // [what, the date of birth, 23:59 Paris on the eve, 00:00 Paris on the birthday, the birthday, the next one]
    ['CET', '1991-12-05', '2026-12-04T22:59:00.000Z', '2026-12-04T23:00:00.000Z', '2026-12-05', '2027-12-05'],
    ['CEST', '1991-06-18', '2027-06-17T21:59:00.000Z', '2027-06-17T22:00:00.000Z', '2027-06-18', '2028-06-18'],
  ])('counts a birthday only when the date was on the account before its 00:00 Paris (question 20), under %s', async (_zone, birthDate, eve, midnight, birthday, nextOne) => {
    // Entered at 23:59 Paris on the eve: the credit at midnight.
    const onEve = await born(birthDate, eve);
    // Entered at 00:00 Paris on the birthday, and three days after it: nothing this year.
    const onDay = await born(birthDate, midnight);
    const after = await born(birthDate, new Date(Date.parse(midnight) + 3 * 86_400_000).toISOString());
    clock.set(midnight);
    await pass();
    expect(await birthdaysOf(onEve.id)).toEqual([birthday]);
    expect(await birthdaysOf(onDay.id)).toEqual([]);
    // Every pass of the 30 days: still nothing for the two entered on or after the birthday.
    for (const days of [1, 4, 15, 29]) {
      clock.set(new Date(Date.parse(midnight) + days * 86_400_000));
      await pass();
    }
    expect(await birthdaysOf(onDay.id)).toEqual([]);
    expect(await birthdaysOf(after.id)).toEqual([]);
    // The next birthday gives it to them.
    clock.set(new Date(parisMidnight(nextOne)));
    await pass();
    expect(await birthdaysOf(onDay.id)).toEqual([nextOne]);
    expect(await birthdaysOf(after.id)).toEqual([nextOne]);
    expect(await birthdaysOf(onEve.id)).toEqual([birthday, nextOne]);
  });

  it.each([
    ['CET', '1985-01-20', '2027-01-19T22:59:00.000Z', '2027-01-19T23:00:00.000Z', '2027-01-20', '2028-01-20'],
    ['CEST', '1985-08-20', '2027-08-19T21:59:00.000Z', '2027-08-19T22:00:00.000Z', '2027-08-20', '2028-08-20'],
  ])('gives nothing for a birthday when Client Services changed the date on or after it, under %s', async (_zone, birthDate, eve, midnight, birthday, nextOne) => {
    // Three accounts with another date of birth, entered long before; Client Services changes each to `birthDate`.
    const [before, onDay, later] = [await born('1985-04-02', '2026-11-01T09:00:00.000Z'), await born('1985-04-02', '2026-11-01T09:00:00.000Z'), await born('1985-04-02', '2026-11-01T09:00:00.000Z')];
    const change = async (accountId: string, at: string) => {
      clock.set(at);
      await ctx.services.profiles.setBirthDateByStaff(accountId, { version: 1, birthDate, why: 'The client gave the right date on the phone.' }, staff);
    };
    await change(before.id, eve);
    await change(onDay.id, midnight);
    await change(later.id, new Date(Date.parse(midnight) + 5 * 86_400_000).toISOString());
    clock.set(new Date(Date.parse(midnight) + 5 * 86_400_000 + 600_000));
    await pass();
    // Changed at 23:59 Paris on the eve: the date was on the account before the birthday, caught up here.
    expect(await birthdaysOf(before.id)).toEqual([birthday]);
    expect(await birthdaysOf(onDay.id)).toEqual([]);
    expect(await birthdaysOf(later.id)).toEqual([]);
    clock.set(new Date(parisMidnight(nextOne)));
    await pass();
    expect(await birthdaysOf(onDay.id)).toEqual([nextOne]);
    expect(await birthdaysOf(later.id)).toEqual([nextOne]);
  });

  it('catches a missed day up within the days, with the birthday\'s expiry, and gives nothing once they are over', async () => {
    const caught = await born('1988-09-01', '2027-01-10T09:00:00.000Z');
    const late = await born('1988-09-01', '2027-01-10T09:00:00.000Z');
    // The server was down from the birthday: its first pass is on day 30, 23:50 Paris (30 September 2027, CEST).
    await t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', late.id).execute();
    clock.set('2027-09-30T21:50:00.000Z');
    await pass();
    expect(await grantsOf(caught.id)).toEqual([
      { tier: null, kind: 'BIRTHDAY', birthday_on: '2027-09-01', amount_minor: 2_000, currency: 'EUR', granted_at: new Date('2027-09-30T21:50:00.000Z'), expires_at: new Date('2027-09-30T21:59:59.999Z') },
    ]);
    // The other account comes back the day after the 30 days: nothing for that birthday, ever.
    await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', late.id).execute();
    clock.set('2027-09-30T22:00:00.000Z');
    await pass();
    clock.set('2027-10-15T09:00:00.000Z');
    await pass();
    expect(await grantsOf(late.id)).toEqual([]);
    // A date entered after the birthday's 00:00 Paris is not caught up either, within the days.
    const typed = await born('1988-10-10', '2027-10-12T09:00:00.000Z');
    await pass();
    expect(await grantsOf(typed.id)).toEqual([]);
  });

  it('keeps 365 days between two credits when Client Services changes the date of birth', async () => {
    const a = await born('1994-03-14', '2028-01-05T09:00:00.000Z');
    clock.set(parisMidnight('2028-03-14'));
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2028-03-14']);
    // Changed to 20 November in June: nothing on 20 November 2028 (251 days on), the credit on 20 November 2029.
    clock.set('2028-06-01T09:00:00.000Z');
    await ctx.services.profiles.setBirthDateByStaff(a.id, { version: 1, birthDate: '1994-11-20', why: 'A typing mistake, corrected with the client.' }, staff);
    clock.set(parisMidnight('2028-11-20'));
    await pass();
    clock.set('2028-12-15T09:00:00.000Z');
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2028-03-14']);
    clock.set(parisMidnight('2029-11-20'));
    await pass();
    expect(await birthdaysOf(a.id)).toEqual(['2028-03-14', '2029-11-20']);
    // The credit given before the change stayed as it was.
    expect((await grantsOf(a.id))[0]).toMatchObject({ amount_minor: 2_000, expires_at: birthdayExpiry('2028-03-14', 30) });
  });

  it('gives nothing while switched off, leaves the credits given usable, and gives a birthday missed meanwhile once switched back on within its days', async () => {
    const had = await born('1979-05-03', '2028-01-05T09:00:00.000Z');
    const waiting = await born('1979-05-06', '2028-01-05T09:00:00.000Z');
    clock.set(parisMidnight('2030-05-03'));
    await pass();
    expect(await birthdaysOf(had.id)).toEqual(['2030-05-03']);
    try {
      await setProgram({ birthdayCreditOn: false });
      clock.set(parisMidnight('2030-05-06'));
      expect(await pass()).toBe(0);
      clock.set('2030-05-10T09:00:00.000Z');
      expect(await pass()).toBe(0);
      expect(await grantsOf(waiting.id)).toEqual([]);
      // The credit given before stays usable until it expires.
      const [credit] = await creditBalances(t.db, had.id);
      expect(credit).toMatchObject({ kind: 'BIRTHDAY', balanceMinor: 2_000, expiresAt: birthdayExpiry('2030-05-03', 30) });
      expect(credit!.expiresAt.getTime()).toBeGreaterThan(clock.now().getTime());
      expect((await ctx.services.club.status(had.id)).inUse.birthdayCredit).toEqual({ balanceMinor: 2_000, currency: 'EUR', expiresAt: birthdayExpiry('2030-05-03', 30) });
    } finally {
      await setProgram({});
    }
    // Back on, on 12 May: the birthday of 6 May is still within its days, with its own expiry.
    clock.set('2030-05-12T09:00:00.000Z');
    await pass();
    expect(await grantsOf(waiting.id)).toEqual([
      { tier: null, kind: 'BIRTHDAY', birthday_on: '2030-05-06', amount_minor: 2_000, currency: 'EUR', granted_at: new Date('2030-05-12T09:00:00.000Z'), expires_at: birthdayExpiry('2030-05-06', 30) },
    ]);
  });

  it('applies an amount and a length changed to the credits given from then on', async () => {
    const first = await born('1982-04-10', '2028-01-05T09:00:00.000Z');
    const second = await born('1982-04-12', '2028-01-05T09:00:00.000Z');
    clock.set(parisMidnight('2031-04-10'));
    await pass();
    try {
      await setProgram({ birthdayCreditMinor: 3_550, birthdayCreditDays: 15, creditCurrency: 'CHF' });
      clock.set(parisMidnight('2031-04-12'));
      await pass();
      expect((await grantsOf(first.id)).map((g) => [g.birthday_on, g.amount_minor, g.currency, g.expires_at])).toEqual([['2031-04-10', 2_000, 'EUR', birthdayExpiry('2031-04-10', 30)]]);
      expect((await grantsOf(second.id)).map((g) => [g.birthday_on, g.amount_minor, g.currency, g.expires_at])).toEqual([['2031-04-12', 3_550, 'CHF', birthdayExpiry('2031-04-12', 15)]]);
      // With 15 days, a birthday 20 days ago is no longer caught up.
      const old = await born('1982-03-23', '2028-01-05T09:00:00.000Z');
      await pass();
      expect(await grantsOf(old.id)).toEqual([]);
    } finally {
      await setProgram({});
    }
  });

  it('grants a LOCKED account like an ACTIVE one, and never a DELETED one nor a test entrant', async () => {
    const [active, locked, deleted, entrant] = [
      await born('1975-06-01', '2028-01-05T09:00:00.000Z'),
      await born('1975-06-01', '2028-01-05T09:00:00.000Z'),
      await born('1975-06-01', '2028-01-05T09:00:00.000Z'),
      await born('1975-06-01', '2028-01-05T09:00:00.000Z'),
    ];
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    await t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', deleted.id).execute();
    await t.db.insertInto('test_entrants').values({ account_id: entrant.id }).execute();
    clock.set(parisMidnight('2032-06-01'));
    await pass();
    expect(await birthdaysOf(active.id)).toEqual(['2032-06-01']);
    expect(await birthdaysOf(locked.id)).toEqual(['2032-06-01']);
    expect(await grantsOf(deleted.id)).toEqual([]);
    expect(await grantsOf(entrant.id)).toEqual([]);
    // An account with no date of birth, and one with no profile at all: nothing.
    const bare = await createAccount(t.db);
    await pass();
    expect(await grantsOf(bare.id)).toEqual([]);
  });

  it('gives one row when two passes run at once, audited once by the system, and never writes the date of birth', async () => {
    const a = await born('1993-07-21', '2028-01-05T09:00:00.000Z');
    clock.set(parisMidnight('2032-07-21'));
    const before = await given();
    const both = await Promise.all([pass(), pass()]);
    // Each credit is counted by the one pass that inserted it.
    expect(both[0]! + both[1]!).toBe((await given()) - before);
    const grants = await t.db.selectFrom('tier_grants').select(['id', 'birthday_on']).where('account_id', '=', a.id).execute();
    expect(grants.map((g) => g.birthday_on)).toEqual(['2032-07-21']);
    const audits = await grantAudits(a.id);
    expect(audits).toEqual([
      { actor_type: 'system', actor_id: null, details: { grantId: grants[0]!.id, kind: 'BIRTHDAY', birthdayOn: '2032-07-21', amountMinor: 2_000, currency: 'EUR', expiresAt: birthdayExpiry('2032-07-21', 30).toISOString() } },
    ]);
    // The grant's random id is set aside: a uuid can hold "1993" (…-f19935c5eb18) without any date of birth.
    expect(JSON.stringify(audits).replaceAll(grants[0]!.id, '')).not.toContain('1993');
    // The key is the last guard: a second grant for the same birthday is refused by the database.
    await expect(
      t.db.insertInto('tier_grants').values({ account_id: a.id, tier: null, kind: 'BIRTHDAY', granted_at: clock.now(), amount_minor: 2_000, currency: 'EUR', expires_at: birthdayExpiry('2032-07-21', 30), birthday_on: '2032-07-21' }).execute(),
    ).rejects.toThrow(/tier_grants_birthday_key/);
  });

  it('logs a failure on one account, goes on with the others, and gives it at the next pass', async () => {
    const failing = await born('1987-02-10', '2028-01-05T09:00:00.000Z');
    const fine = await born('1987-02-10', '2028-01-05T09:00:00.000Z');
    await sql`CREATE FUNCTION birthday_grant_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id = ${sql.lit(failing.id)}::uuid THEN RAISE EXCEPTION 'the grant failed'; END IF; RETURN NEW; END $$`.execute(t.db);
    await sql`CREATE TRIGGER birthday_grant_fail BEFORE INSERT ON tier_grants FOR EACH ROW EXECUTE FUNCTION birthday_grant_fail()`.execute(t.db);
    clock.set(parisMidnight('2033-02-10'));
    lines.length = 0;
    const before = await given();
    try {
      expect(await pass()).toBe((await given()) - before);
    } finally {
      await sql`DROP TRIGGER birthday_grant_fail ON tier_grants`.execute(t.db);
      await sql`DROP FUNCTION birthday_grant_fail()`.execute(t.db);
    }
    expect(await birthdaysOf(fine.id)).toEqual(['2033-02-10']);
    expect(await grantsOf(failing.id)).toEqual([]);
    expect(await grantAudits(failing.id)).toEqual([]);
    expect(lines.filter((l) => l.level === 'error').map((l) => [(l.o as { accountId?: string }).accountId, l.msg])).toEqual([[failing.id, 'a birthday credit could not be given']]);
    clock.advance(10 * 60_000);
    expect(await pass()).toBe(1);
    expect(await birthdaysOf(failing.id)).toEqual(['2033-02-10']);
  });

  it('runs at every housekeeping pass, outside the morning window too', async () => {
    const a = await born('1999-03-03', '2028-01-05T09:00:00.000Z');
    const hk = startHousekeeping(ctx, { intervalMs: 3_600_000 });
    try {
      // 3 March 2033, 00:05 Paris (23:05 UTC the day before): hours before the morning window opens.
      clock.set('2033-03-02T23:05:00.000Z');
      const before = await given();
      const first = await hk.runOnce();
      expect(first.birthdayCredits).toBe((await given()) - before);
      expect(first.birthdayCredits).toBeGreaterThanOrEqual(1);
      expect(Object.keys(first).slice(4, 7)).toEqual(['activity', 'birthdayCredits', 'acquisitionConversions']);
      expect(await birthdaysOf(a.id)).toEqual(['2033-03-03']);
      clock.advance(10 * 60_000);
      expect((await hk.runOnce()).birthdayCredits).toBe(0);
      // Switched off: the job does nothing.
      const b = await born('1999-03-04', '2028-01-05T09:00:00.000Z');
      await setProgram({ birthdayCreditOn: false });
      clock.set(parisMidnight('2033-03-04'));
      expect((await hk.runOnce()).birthdayCredits).toBe(0);
      expect(await grantsOf(b.id)).toEqual([]);
    } finally {
      await setProgram({});
      await hk.stop();
    }
  });
});

/** 00:00 Paris of a day, as an instant (the first pass of a birthday). */
function parisMidnight(day: string): string {
  return new Date(birthdayExpiry(dayPlus(day, -1), 1).getTime() + 1).toISOString();
}
