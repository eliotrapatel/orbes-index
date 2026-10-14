/**
 * The birthday credit's rules (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.4.1; migration 0045): every account
 * with a date of birth, piece or not, receives on its birthday (a Paris day) one credit of THE PROGRAM's amount, in
 * THE PROGRAM's credit currency, valid THE PROGRAM's days from the birthday (the birthday is day 1), as a `tier_grants`
 * row of kind BIRTHDAY, taken off an order by Client Services like a tier's credit (services/tier-grants.ts usableAt).
 *
 *   the day        the Paris calendar day whose month and day are the date of birth's; 29 February falls on
 *                  28 February in a common year (never skipped) (`birthdayIn`);
 *   its expiry     the end (23:59:59.999 Paris) of the birthday's day `days` − 1 later: 14 March with 30 days is usable
 *                  until 12 April (`birthdayExpiry`);
 *   12 months      a new one only when the account's previous one was for a birthday at least 365 days earlier
 *                  (`BIRTHDAY_GAP_DAYS`, birthday against birthday, exact across leap years and date changes);
 *   entered before the date of birth must be on the account before 00:00 Paris on the birthday (`birth_date_at`, the
 *                  last time it was entered or changed, by the collector or by Client Services; question 20 of
 *                  8 October 2026): typing a recent date never gives € 20 at once;
 *   a missed day   given at the first pass afterwards while the birthday's credit has not expired, with the days left.
 *
 * `nextBirthday` answers, for the client sheet's Club block (OwnerService, §3.5 SB.4.3 `birthdayNext`), the first
 * birthday from today these rules allow.
 *
 * The grant (`BirthdayCreditService.grantDue`, §3.5 SB.4.4) runs at every housekeeping pass (context.ts, the job
 * `birthdayCredits`), so a credit arrives within 10 minutes after midnight Paris and a missed day is caught up while
 * within its days. One read finds the accounts whose birthday falls in the days a credit would still be valid for
 * (not DELETED, not a test entrant, none given in the last 365 days); each is then granted in its own transaction,
 * under its account's row (FOR UPDATE: a profile save takes the same row FOR NO KEY UPDATE, services/profiles.ts, so a
 * date of birth changed meanwhile is seen), every rule checked again there. `tier_grants_birthday_key` (one grant per
 * account and birthday) is the last guard against two passes at once. Audited `club.grant` with `kind: 'BIRTHDAY'`, the
 * system as actor, only for a row inserted, and never the date of birth. Switched off in THE PROGRAM, nothing is given;
 * the credits given stay as they are. No run is recorded: the rules alone give one credit per birthday.
 *
 * Lock order: the account's row, then the grant inserted, the audit log last.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { SYSTEM_ACTOR, noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import type { AuditService } from './audit.js';
import { readProgram } from './club-program.js';
import { notTestEntrant } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';

/** Two birthday credits of an account are at least this many days apart, birthday against birthday. */
export const BIRTHDAY_GAP_DAYS = 365;

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(day: string): [number, number, number] {
  const m = DATE_RE.exec(day);
  if (!m) throw new RangeError('A day is YYYY-MM-DD.');
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The calendar day `n` days after `day` (`YYYY-MM-DD`), negative for before. */
export function dayPlus(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (`YYYY-MM-DD`), as calendar days: positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** The birthday of a date of birth (`YYYY-MM-DD`) in `year`, as a Paris day: 29 February on 28 February in a common year. */
export function birthdayIn(year: number, birthDate: string): string {
  const [, m, d] = parts(birthDate);
  return m === 2 && d === 29 && !isLeap(year) ? iso(year, 2, 28) : iso(year, m, d);
}

/** When a birthday credit given for `birthdayOn` expires: the last instant (Paris) of its `days`-th day, the birthday being day 1. */
export function birthdayExpiry(birthdayOn: string, days: number): Date {
  return new Date(parisDayStart(dayPlus(birthdayOn, days)).getTime() - 1);
}

/**
 * The first birthday from today (Paris) the rules allow (SB.4.1): not granted yet, its credit not expired (a birthday
 * passed within its days counts, as `today`: the next pass grants it), the date of birth on the account before its
 * 00:00 Paris, and 365 days at least after the last birthday granted. Null without a date of birth.
 */
export function nextBirthday(input: {
  /** The date of birth, `YYYY-MM-DD`, or null. */
  birthDate: string | null;
  /** When the date of birth was last entered or changed (`account_profiles.birth_date_at`). */
  birthDateAt: Date | null;
  /** The birthdays already granted (`tier_grants.birthday_on` of the account's BIRTHDAY grants). */
  granted: readonly string[];
  /** THE PROGRAM's days. */
  days: number;
  now: Date;
}): string | null {
  const { birthDate, birthDateAt, granted, days, now } = input;
  if (birthDate === null || birthDateAt === null) return null;
  const today = parisDay(now);
  const last = granted.reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);
  const [year] = parts(today);
  // The rules reach at most two birthdays beyond the next one (a date changed after the last credit, 365 days after it).
  for (let y = year - 1; y <= year + 3; y++) {
    const b = birthdayIn(y, birthDate);
    if (granted.includes(b)) continue;
    if (birthdayExpiry(b, days).getTime() < now.getTime()) continue;
    if (birthDateAt.getTime() >= parisDayStart(b).getTime()) continue;
    if (last !== null && daysBetween(last, b) < BIRTHDAY_GAP_DAYS) continue;
    return b < today ? today : b;
  }
  return null;
}

// ── The daily grant ────────────────────────────────────────────────────────

/**
 * The Paris days a birthday credit given now would still be valid for, the oldest first: from `days` − 1 days before
 * `today` to `today` (SB.4.4 step 2). A birthday on any of them is due.
 */
export function candidateDays(today: string, days: number): string[] {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back--) out.push(dayPlus(today, -back));
  return out;
}

/** The (month, day) of the dates of birth whose birthday falls on `day`: its own, and 29 February on 28 February of a common year. */
export function birthMonthDays(day: string): [number, number][] {
  const [y, m, d] = parts(day);
  return m === 2 && d === 28 && !isLeap(y) ? [[2, 28], [2, 29]] : [[m, d]];
}

export interface BirthdayCreditServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
}

export class BirthdayCreditService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: BirthdayCreditServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /**
   * The birthday credits due at `now` (see the header): returns how many were given. A failure on one account is
   * logged and the others go on; the next pass tries it again.
   */
  async grantDue(now: Date = this.clock()): Promise<number> {
    const program = await readProgram(this.db);
    if (!program.birthdayCreditOn) return 0;
    const today = parisDay(now);
    // The birthday of each (month, day) of birth among the candidate days: the latest, were one to come twice.
    const dayOf = new Map<string, string>();
    for (const day of candidateDays(today, program.birthdayCreditDays)) for (const [m, d] of birthMonthDays(day)) dayOf.set(`${m}-${d}`, day);
    const pairs = [...dayOf.keys()].map((k) => k.split('-').map(Number) as [number, number]);
    // A scan of the accounts with a date of birth: no expression index (`extract` on a date is not reliably IMMUTABLE
    // across PGlite and PostgreSQL), and it costs milliseconds at 10 000 accounts. The 365 days are read from today
    // here (never stricter than the rule) and from the birthday itself under the lock.
    const found = await sql<{ id: string; birth_date: string; birth_date_at: Date }>`
      SELECT a.id, p.birth_date, p.birth_date_at
        FROM accounts a
        JOIN account_profiles p ON p.account_id = a.id
       WHERE a.status <> 'DELETED'
         AND p.birth_date IS NOT NULL
         AND (extract(month FROM p.birth_date)::int, extract(day FROM p.birth_date)::int) IN (${sql.join(pairs.map(([m, d]) => sql`(${m}::int, ${d}::int)`))})
         AND ${notTestEntrant('a.id')}
         AND NOT EXISTS (SELECT 1 FROM tier_grants g WHERE g.account_id = a.id AND g.kind = 'BIRTHDAY' AND g.birthday_on > ${dayPlus(today, -BIRTHDAY_GAP_DAYS)}::date)
       ORDER BY a.id`.execute(this.db);
    let granted = 0;
    for (const c of found.rows) {
      const [, m, d] = parts(c.birth_date);
      const birthdayOn = dayOf.get(`${m}-${d}`);
      if (birthdayOn === undefined) continue;
      // Still within its days, and the date of birth on the account before 00:00 Paris on the birthday (question 20).
      if (now.getTime() > birthdayExpiry(birthdayOn, program.birthdayCreditDays).getTime()) continue;
      if (c.birth_date_at.getTime() >= parisDayStart(birthdayOn).getTime()) continue;
      try {
        if (await this.grant(c.id, birthdayOn, { birthDate: c.birth_date, birthDateAt: c.birth_date_at }, now)) granted++;
      } catch (e) {
        this.log.error({ accountId: c.id, err: { message: (e as Error)?.message } }, 'a birthday credit could not be given');
      }
    }
    return granted;
  }

  /**
   * One account's credit for `birthdayOn`, in its own transaction: the account's row locked, then every rule checked
   * again (not DELETED, not a test entrant, the date of birth and its time as read, THE PROGRAM still on and the credit
   * within its days, no birthday credit for a birthday less than 365 days earlier), the grant inserted and audited.
   * False when nothing was given.
   */
  private async grant(accountId: string, birthdayOn: string, read: { birthDate: string; birthDateAt: Date }, now: Date): Promise<boolean> {
    return inTransaction(this.db, async (tx) => {
      const account = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forUpdate().executeTakeFirst();
      if (!account || account.status === 'DELETED') return false;
      const still = await sql<{ birth_date: string | null; birth_date_at: Date | null; test_entrant: boolean; recent: boolean }>`
        SELECT p.birth_date, p.birth_date_at,
               NOT ${notTestEntrant('p.account_id')} AS test_entrant,
               EXISTS (SELECT 1 FROM tier_grants g WHERE g.account_id = p.account_id AND g.kind = 'BIRTHDAY' AND g.birthday_on > ${dayPlus(birthdayOn, -BIRTHDAY_GAP_DAYS)}::date) AS recent
          FROM account_profiles p WHERE p.account_id = ${accountId}`.execute(tx);
      const p = still.rows[0];
      if (!p || p.test_entrant || p.recent) return false;
      if (p.birth_date !== read.birthDate || p.birth_date_at === null || p.birth_date_at.getTime() !== read.birthDateAt.getTime()) return false;
      const program = await readProgram(tx);
      if (!program.birthdayCreditOn) return false;
      const expiresAt = birthdayExpiry(birthdayOn, program.birthdayCreditDays);
      if (now.getTime() > expiresAt.getTime()) return false;
      const inserted = await tx
        .insertInto('tier_grants')
        .values({ account_id: accountId, tier: null, kind: 'BIRTHDAY', granted_at: now, amount_minor: program.birthdayCreditMinor, currency: program.creditCurrency, expires_at: expiresAt, birthday_on: birthdayOn })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) return false;
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'club.grant',
          targetType: 'account',
          targetId: accountId,
          details: { grantId: inserted.id, kind: 'BIRTHDAY', birthdayOn, amountMinor: program.birthdayCreditMinor, currency: program.creditCurrency, expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
      return true;
    });
  }
}
