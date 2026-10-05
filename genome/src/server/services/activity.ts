/**
 * The best time to open (plan LIVE RELEASE+ of 2026-10-04, choice 10, G3): when the collectors are about, from their
 * sign-ins and scans counted by hour, country and tier, aggregated with no account in them, and from the presence at
 * T0 of past releases.
 *
 *   counting   `aggregateActivity`, a job of the existing analytics pass (context.ts startHousekeeping, after the daily
 *              scan statistics and before any purge of the scan history: no scan leaves the history uncounted) and of
 *              the console's reading (routes/admin/analytics.ts), counts every complete UTC hour not counted yet into
 *              `activity_hourly`:
 *               - sign-ins: an account signing in or created (the audit log's `account.login` and `account.register`,
 *                 kept for good), at the country the account gave (ZZ without one);
 *               - scans: the scans of the public verification (the daily statistics' own: VERIFY, REGISTER, TRANSFER;
 *                 never a staff scan), at the country the scan came from (ZZ unknown);
 *              each at the tier its account holds when the hour is counted (club.ts clubStandings: within the pass after
 *              the hour; a scan without an account is no tier, 0). Only the hour, the country, the tier and the counts
 *              are written: never an account. An hour is complete ACTIVITY_SETTLE_MS after it ends, counted once (the
 *              pass starts after the last hour counted and writes its hours in one transaction; a pass repeated writes
 *              the same figures); a first pass counts the
 *              last ANALYTICS_MAX_DAYS days, the longest window the console reads.
 *   reading    `bestTime`: over the last `days` days of complete hours, the activity (sign-ins and scans) of the tiers
 *              chosen (a release's: its tier and above) by hour of the day in Paris time, by tier and by country (each
 *              with its own busiest hour), and the past releases' presence at T0 by the Paris hour they opened at (the
 *              latest LIVE_INSIGHT_RULES.pastReleases ended, the entries in the line at T0 from those tiers); the
 *              suggested hour, the busiest, its share of that activity (the past presence breaks a tie, then the
 *              earlier hour), and for a release its own T0's hour and share. Its reasoning in words.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { SCAN_STAT_EVENT_TYPES, VERIFICATION_STATES } from '../db/schema.js';
import { validationError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { clubStandings, tierName, type ClubTier } from './club.js';
import { dropNotFound } from './drops.js';
import { count, LIVE_INSIGHT_RULES, percent } from './live-insights.js';
import { ANALYTICS_DEFAULT_DAYS, ANALYTICS_MAX_DAYS, UNKNOWN_COUNTRY } from './scan-stats.js';

/** An hour counts once it ended this long ago (a sign-in or a scan begun before its end has committed by then). */
export const ACTIVITY_SETTLE_MS = 10 * 60_000;
/** The audit log's actions that are a sign-in of an account (its creation signs it in). */
export const SIGN_IN_ACTIONS = Object.freeze(['account.login', 'account.register'] as const);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const UPSERT_CHUNK = 500;
const PARIS = 'Europe/Paris';
const TIERS: readonly number[] = [0, 1, 2, 3];
const COUNTRY_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The end (exclusive) of the last complete hour at `now`. */
export function lastCompleteHour(now: Date): Date {
  return new Date(Math.floor((now.getTime() - ACTIVITY_SETTLE_MS) / HOUR_MS) * HOUR_MS);
}

const parisHours = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, hour: '2-digit', hourCycle: 'h23' });

/** The hour of the day (0 to 23) an instant falls in, in Paris. */
export function parisHour(d: Date): number {
  return Number(parisHours.formatToParts(d).find((p) => p.type === 'hour')?.value ?? '0') % 24;
}

const country = (c: string | null | undefined) => {
  const v = (c ?? '').trim().toUpperCase();
  return COUNTRY_RE.test(v) ? v : UNKNOWN_COUNTRY;
};

/**
 * Count every complete hour not counted yet into activity_hourly (see the module comment). Returns the rows written: 0
 * when every complete hour is counted already.
 */
export async function aggregateActivity(db: Db, now: Date): Promise<number> {
  const until = lastCompleteHour(now);
  const last = await db.selectFrom('activity_hourly').select((eb) => eb.fn.max('hour').as('hour')).executeTakeFirst();
  const floor = new Date(until.getTime() - ANALYTICS_MAX_DAYS * DAY_MS);
  const since = last?.hour ? new Date(Math.max(new Date(last.hour).getTime() + HOUR_MS, floor.getTime())) : floor;
  if (since.getTime() >= until.getTime()) return 0;
  const hourOf = (column: string) => sql<Date>`to_timestamp(floor(extract(epoch FROM ${sql.ref(column)}) / 3600) * 3600)`;
  const [signIns, scans] = await Promise.all([
    db
      .selectFrom('audit_logs as l')
      .innerJoin('accounts as a', (j) => j.on(sql`a.id::text`, '=', sql.ref('l.actor_id')))
      .select((eb) => [hourOf('l.occurred_at').as('hour'), 'a.id as account_id', 'a.country', eb.fn.countAll<number>().as('n')])
      .where('l.actor_type', '=', 'account')
      .where('l.action', 'in', [...SIGN_IN_ACTIONS])
      .where('l.occurred_at', '>=', since)
      .where('l.occurred_at', '<', until)
      .groupBy(['hour', 'a.id', 'a.country'])
      .execute(),
    db
      .selectFrom('scan_events as s')
      .select((eb) => [hourOf('s.occurred_at').as('hour'), 's.account_id', 's.country', eb.fn.countAll<number>().as('n')])
      .where('s.event_type', 'in', [...SCAN_STAT_EVENT_TYPES])
      .where('s.result_state', 'in', [...VERIFICATION_STATES])
      .where('s.occurred_at', '>=', since)
      .where('s.occurred_at', '<', until)
      .groupBy(['hour', 's.account_id', 's.country'])
      .execute(),
  ]);
  const accounts = [...new Set([...signIns.map((r) => r.account_id), ...scans.map((r) => r.account_id).filter((x): x is string => x !== null)])];
  const standings = await clubStandings(db, accounts, now);
  const tierOf = (account: string | null) => (account ? (standings.get(account.toLowerCase())?.tier ?? 0) : 0);
  const cells = new Map<string, { hour: Date; country: string; tier: number; sign_ins: number; scans: number }>();
  const cell = (hour: Date, c: string, tier: number) => {
    const at = new Date(hour);
    const key = `${at.getTime()}|${c}|${tier}`;
    let v = cells.get(key);
    if (!v) cells.set(key, (v = { hour: at, country: c, tier, sign_ins: 0, scans: 0 }));
    return v;
  };
  for (const r of signIns) cell(r.hour, country(r.country), tierOf(r.account_id)).sign_ins += Number(r.n);
  for (const r of scans) cell(r.hour, country(r.country), tierOf(r.account_id)).scans += Number(r.n);
  const rows = [...cells.values()];
  // All the hours of a pass or none: the next pass starts after the latest hour written, so a pass stopped half-way
  // must never leave an earlier hour unwritten behind a later one.
  await inTransaction(db, async (tx) => {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      await tx
        .insertInto('activity_hourly')
        .values(rows.slice(i, i + UPSERT_CHUNK))
        .onConflict((oc) => oc.columns(['hour', 'country', 'tier']).doUpdateSet((eb) => ({ sign_ins: eb.ref('excluded.sign_ins'), scans: eb.ref('excluded.scans') })))
        .execute();
    }
  });
  return rows.length;
}

// ── The reading ────────────────────────────────────────────────────────────

/** A row of activity_hourly, as the reading takes it. */
export interface ActivityCell {
  hour: Date;
  country: string;
  tier: number;
  signIns: number;
  scans: number;
}

/** A past release as the reading takes it: when it opened, the line at T0 by tier. */
export interface PastPresence {
  opensAt: Date;
  presentByTier: readonly number[];
}

/** An hour of the day, Paris time. */
export interface BestTimeHour {
  /** 0 to 23. */
  hour: number;
  /** The tiers chosen (and the country, when one is): their sign-ins, their scans, both. */
  signIns: number;
  scans: number;
  activity: number;
  /** Every tier's activity at that hour (the country chosen): no tier, TITANE, PLATINE, PALLADIUM. */
  byTier: number[];
  /** The past releases that opened at that hour, and their line at T0 from the tiers chosen. */
  past: { releases: number; present: number };
}

export interface BestTime {
  /** The window: the last `days` days of complete hours, [from, to). */
  days: number;
  from: Date;
  to: Date;
  /** The tiers read: this one and above (0: everyone, a scan without an account included). */
  minTier: number;
  /** One country (ISO 3166-1, ZZ unknown), or null for all. */
  country: string | null;
  hours: BestTimeHour[];
  /** The countries with activity from the tiers chosen, the most first: each with its busiest hour, Paris time. */
  countries: { country: string; activity: number; peakHour: number }[];
  /** The activity of the tiers chosen over the window. */
  total: number;
  /** The busiest hour and its share of that activity; null without any. */
  suggested: { hour: number; activity: number; share: number } | null;
  /** A release's own T0: its hour, Paris time, and its share; null when none is read. */
  release: { hour: number; activity: number; share: number } | null;
  pastReleases: number;
  reasoning: string[];
}

const tierWords = (t: number) => (t === 0 ? 'every collector' : `collectors from ${tierName(t as ClubTier)}`);
const clock = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** The reading (pure): see the module comment. */
export function bestTime(input: {
  days: number;
  from: Date;
  to: Date;
  minTier: number;
  country: string | null;
  cells: readonly ActivityCell[];
  past: readonly PastPresence[];
  releaseOpensAt?: Date | null;
}): BestTime {
  const minTier = Math.min(3, Math.max(0, Math.trunc(input.minTier)));
  const hours: BestTimeHour[] = Array.from({ length: 24 }, (_, hour) => ({ hour, signIns: 0, scans: 0, activity: 0, byTier: [0, 0, 0, 0], past: { releases: 0, present: 0 } }));
  const countries = new Map<string, number[]>();
  for (const c of input.cells) {
    const t = new Date(c.hour).getTime();
    if (t < input.from.getTime() || t >= input.to.getTime()) continue;
    const h = parisHour(new Date(t));
    const n = c.signIns + c.scans;
    const chosen = c.tier >= minTier;
    if (chosen && n > 0) {
      const byHour = countries.get(c.country) ?? new Array<number>(24).fill(0);
      byHour[h] += n;
      countries.set(c.country, byHour);
    }
    if (input.country !== null && c.country !== input.country) continue;
    hours[h]!.byTier[Math.min(3, Math.max(0, c.tier))] += n;
    if (!chosen) continue;
    hours[h]!.signIns += c.signIns;
    hours[h]!.scans += c.scans;
    hours[h]!.activity += n;
  }
  for (const p of input.past) {
    const h = hours[parisHour(new Date(p.opensAt))]!;
    h.past.releases += 1;
    h.past.present += TIERS.filter((t) => t >= minTier).reduce((n, t) => n + (p.presentByTier[t] ?? 0), 0);
  }
  const total = hours.reduce((n, h) => n + h.activity, 0);
  const best = total > 0 ? [...hours].sort((a, b) => b.activity - a.activity || b.past.present - a.past.present || a.hour - b.hour)[0]! : null;
  const suggested = best ? { hour: best.hour, activity: best.activity, share: best.activity / total } : null;
  const releaseHour = input.releaseOpensAt ? parisHour(new Date(input.releaseOpensAt)) : null;
  const release = releaseHour === null ? null : { hour: releaseHour, activity: hours[releaseHour]!.activity, share: total > 0 ? hours[releaseHour]!.activity / total : 0 };
  const who = `${tierWords(minTier)}${input.country ? ` in ${input.country}` : ''}`;
  const why: string[] = [
    `The sign-ins and scans counted by hour over the last ${count(input.days)} ${input.days === 1 ? 'day' : 'days'}, without any account: ${count(total)} from ${who}, each at the tier its account held when its hour was counted (a scan without an account is no tier).`,
  ];
  if (suggested) {
    why.push(`The busiest hour, Paris time: ${clock(suggested.hour)}, with ${percent(suggested.share)} of that activity (${count(suggested.activity)}).`);
  } else {
    why.push('No activity counted in these days: no hour stands out yet.');
  }
  const pastHours = hours.filter((h) => h.past.releases > 0);
  if (pastHours.length) {
    why.push(
      `Past releases by the hour they opened, Paris time, and their line at T0 from these tiers: ${pastHours
        .map((h) => `${clock(h.hour)} ${count(h.past.releases)} ${h.past.releases === 1 ? 'release' : 'releases'}, ${count(h.past.present)} present`)
        .join('; ')}. On equal activity, the hour where more were present wins.`,
    );
  } else {
    why.push('No past release to compare.');
  }
  if (release) why.push(`This release opens at ${clock(release.hour)}, Paris time: ${percent(release.share)} of that activity.`);
  return {
    days: input.days,
    from: input.from,
    to: input.to,
    minTier,
    country: input.country,
    hours,
    countries: [...countries.entries()]
      .map(([c, byHour]) => {
        const activity = byHour.reduce((a, b) => a + b, 0);
        const peakHour = byHour.reduce((best, n, h) => (n > byHour[best]! ? h : best), 0);
        return { country: c, activity, peakHour };
      })
      .sort((a, b) => b.activity - a.activity || a.country.localeCompare(b.country)),
    total,
    suggested,
    release,
    pastReleases: input.past.length,
    reasoning: why,
  };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface BestTimeQuery {
  /** 1 to ANALYTICS_MAX_DAYS; ANALYTICS_DEFAULT_DAYS by default. */
  days?: number;
  /** 0 to 3: this tier and above. */
  minTier?: number;
  country?: string | null;
}

export interface ActivityServiceDeps {
  db: Db;
  clock?: Clock;
}

export class ActivityService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: ActivityServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** Count the complete hours not counted yet (the housekeeping's job, run again before a reading). */
  aggregate(): Promise<number> {
    return aggregateActivity(this.db, this.clock());
  }

  /** The best time to open over the last `days` days, for a tier and above, everywhere or in one country. */
  async bestTime(q: BestTimeQuery = {}, release: { id: string; opensAt: Date } | null = null): Promise<BestTime> {
    const days = q.days ?? ANALYTICS_DEFAULT_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > ANALYTICS_MAX_DAYS) throw validationError(`days: 1 to ${ANALYTICS_MAX_DAYS} days.`);
    const minTier = q.minTier ?? 0;
    if (!Number.isInteger(minTier) || minTier < 0 || minTier > 3) throw validationError('tier: 0 (everyone) to 3 (PALLADIUM).');
    const c = q.country ? q.country.trim().toUpperCase() : null;
    if (c !== null && !COUNTRY_RE.test(c)) throw validationError('country: two letters (ISO 3166-1).');
    const now = this.clock();
    const to = lastCompleteHour(now);
    const from = new Date(to.getTime() - days * DAY_MS);
    const [cells, past] = await Promise.all([
      this.db.selectFrom('activity_hourly').select(['hour', 'country', 'tier', 'sign_ins', 'scans']).where('hour', '>=', from).where('hour', '<', to).execute(),
      this.past(release?.id ?? null, now),
    ]);
    return bestTime({
      days,
      from,
      to,
      minTier,
      country: c,
      cells: cells.map((r) => ({ hour: r.hour, country: r.country.trim(), tier: r.tier, signIns: Number(r.sign_ins), scans: Number(r.scans) })),
      past,
      releaseOpensAt: release?.opensAt ?? null,
    });
  }

  /** A LIVE RELEASE's best time: its tier and above, its T0's hour beside the suggestion (404 for anything else). */
  async forRelease(dropId: string, q: Pick<BestTimeQuery, 'days' | 'country'> = {}): Promise<BestTime> {
    if (typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw dropNotFound();
    const d = await this.db.selectFrom('drops').select(['id', 'live_min_tier', 'opens_at']).where('id', '=', dropId.toLowerCase()).where('mode', '=', 'LIVE').executeTakeFirst();
    if (!d) throw dropNotFound();
    return this.bestTime({ ...q, minTier: d.live_min_tier ?? 0 }, { id: d.id, opensAt: d.opens_at });
  }

  /** The latest past LIVE RELEASES (ended, never an after-room or a cancelled one; `except` left out) and their line at T0 by tier. */
  private async past(except: string | null, now: Date): Promise<PastPresence[]> {
    const rows = await this.db
      .selectFrom('drops as d')
      .select(['d.id', 'd.opens_at'])
      .where('d.mode', '=', 'LIVE')
      .where('d.parent_drop_id', 'is', null)
      .where('d.published_at', 'is not', null)
      .where('d.cancelled_at', 'is', null)
      .where('d.opens_at', '<', now)
      .where((eb) => eb.or([eb('d.ended_at', 'is not', null), eb('d.closes_at', '<=', now)]))
      .$if(except !== null, (q) => q.where('d.id', '<>', except!))
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .limit(LIVE_INSIGHT_RULES.pastReleases)
      .execute();
    if (rows.length === 0) return [];
    const present = await this.db
      .selectFrom('live_entries as e')
      .innerJoin('drops as d', 'd.id', 'e.drop_id')
      .select((eb) => ['e.drop_id', 'e.tier', eb.fn.countAll<number>().as('n')])
      .where('e.drop_id', 'in', rows.map((r) => r.id))
      .whereRef('e.queued_at', '=', 'd.opens_at')
      .groupBy(['e.drop_id', 'e.tier'])
      .execute();
    return rows.map((r) => {
      const byTier = [0, 0, 0, 0];
      for (const p of present) if (p.drop_id === r.id) byTier[Math.min(3, Math.max(0, p.tier))] += Number(p.n);
      return { opensAt: r.opens_at, presentByTier: byTier };
    });
  }
}
