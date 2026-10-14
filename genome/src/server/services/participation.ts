/**
 * Taking part in the releases (plan LIVE RELEASE+ of 2026-10-04, choice 4 and its Architecture): computed, never stored
 * per collector, read where it decides something (the access rule of a release, services/live.ts; the segments,
 * services/segments.ts) or is shown.
 *
 * A collector has taken part in a release when its T0 (`opens_at`) has passed and they had a place in it:
 *  - a LIVE RELEASE: an entry with a place in the line (`position`, given at T0 or on joining after it), whatever became
 *    of it, but REMOVED (taken out of the line by ORBES); an after-room's entry counts as the release it follows (its
 *    guests had a place in that line): an after-room never counts on its own;
 *  - a draw: an entry not WITHDRAWN when the draw ran (every entry still in the drop once `drawn_at` is set: none is
 *    withdrawn after it), and a place reserved directly during its early access (P-X02: SELECTED at once, then
 *    CONFIRMED or LAPSED), drawn or not yet.
 * A cancelled release counts for nobody (a LIVE RELEASE is cancelled before its room opens, a draw before its draw).
 * Distinct releases: each counts once, whatever the entries.
 *
 * A piece secured: a LIVE entry CONFIRMED (PAY pressed; its quantity in pieces), an after-room's included, and a draw's
 * entry CONFIRMED by ORBES Client Services.
 */
import { sql, type Expression, type RawBuilder, type SqlBool } from 'kysely';
import { uuidArray, type Db } from '../db/connection.js';

/** The statuses of a draw's entry that only a place reserved directly can have before the draw (drops.ts, P-X02). */
const RESERVED_DIRECTLY = ['SELECTED', 'CONFIRMED', 'LAPSED'] as const;

/**
 * Every (account, release) a collector took part in at `now`, `release_id` the release itself (an after-room's parent):
 * a query to read from, narrowed to one account when `accountId` is given.
 */
export function participationRows(db: Db, now: Date, accountId?: string) {
  const live = db
    .selectFrom('live_entries as le')
    .innerJoin('drops as ld', 'ld.id', 'le.drop_id')
    .select(['le.account_id as account_id', sql<string>`coalesce(ld.parent_drop_id, ld.id)`.as('release_id')])
    .where('ld.mode', '=', 'LIVE')
    .where('ld.cancelled_at', 'is', null)
    .where('ld.opens_at', '<=', now)
    .where('le.position', 'is not', null)
    .where('le.status', '<>', 'REMOVED')
    .$if(accountId !== undefined, (q) => q.where('le.account_id', '=', accountId!));
  const draw = db
    .selectFrom('drop_entries as de')
    .innerJoin('drops as dd', 'dd.id', 'de.drop_id')
    .select(['de.account_id as account_id', 'dd.id as release_id'])
    .where('dd.mode', '=', 'DRAW')
    .where('dd.cancelled_at', 'is', null)
    .where('dd.opens_at', '<=', now)
    .where('de.status', '<>', 'WITHDRAWN')
    .where((eb) => eb.or([eb('dd.drawn_at', 'is not', null), eb('de.status', 'in', [...RESERVED_DIRECTLY])]))
    .$if(accountId !== undefined, (q) => q.where('de.account_id', '=', accountId!));
  return live.union(draw);
}

/** A release an account took part in, with when the collector entered it (the engagement score, services/engagement.ts). */
export interface ReleaseEntry {
  account_id: string;
  /** The release itself (an after-room's parent). */
  release_id: string;
  /** When the release opened (an after-room's: when the release it follows opened): what places it in a period. */
  release_opens_at: Date;
  /** T0 of what the collector entered, for the speed of entering: the release's, or the after-room's own. */
  opens_at: Date;
  /** The collector's entry: a draw entry's creation, the earliest counted LIVE entry's `joined_at` (the room or its after-room). */
  entered_at: Date;
}

/**
 * Every (account, release) the accounts `accountIds` took part in at `now`, among the releases opened after `from`,
 * each once, with the opening and the entry: by the very rules of `participationRows` (a LIVE entry with a place in
 * the line that was not REMOVED, an after-room's counting as the release it follows; a draw's entry not WITHDRAWN once
 * drawn, or a place reserved directly; a cancelled release for nobody; T0 passed). test/services/engagement.test.ts
 * holds the two to the same pairs. For a LIVE RELEASE entered in its room and in its after-room, the earliest entry
 * is the one kept.
 */
export async function releaseEntries(db: Db, accountIds: readonly string[], from: Date, now: Date): Promise<ReleaseEntry[]> {
  if (accountIds.length === 0) return [];
  const ids = uuidArray(accountIds);
  const r = await sql<ReleaseEntry>`
    SELECT DISTINCT ON (e.account_id, e.release_id) e.account_id, e.release_id, e.release_opens_at, e.opens_at, e.entered_at
      FROM (
        SELECT le.account_id, coalesce(ld.parent_drop_id, ld.id) AS release_id, coalesce(lp.opens_at, ld.opens_at) AS release_opens_at,
               ld.opens_at, le.joined_at AS entered_at
          FROM live_entries le
          JOIN drops ld ON ld.id = le.drop_id
          LEFT JOIN drops lp ON lp.id = ld.parent_drop_id
         WHERE le.account_id = ANY(${ids}) AND ld.mode = 'LIVE' AND ld.cancelled_at IS NULL AND ld.opens_at <= ${now}
           AND le.position IS NOT NULL AND le.status <> 'REMOVED'
        UNION ALL
        SELECT de.account_id, dd.id, dd.opens_at, dd.opens_at, de.created_at
          FROM drop_entries de
          JOIN drops dd ON dd.id = de.drop_id
         WHERE de.account_id = ANY(${ids}) AND dd.mode = 'DRAW' AND dd.cancelled_at IS NULL AND dd.opens_at <= ${now}
           AND de.status <> 'WITHDRAWN' AND (dd.drawn_at IS NOT NULL OR de.status IN (${sql.join([...RESERVED_DIRECTLY])}))
      ) e
     WHERE e.release_opens_at > ${from}
     ORDER BY e.account_id, e.release_id, e.entered_at, e.opens_at`.execute(db);
  return r.rows;
}

/**
 * The releases an account took part in at `now`, each once; `except`: a release left out (an access rule never counts
 * the release it guards).
 */
export async function participations(db: Db, accountId: string, now: Date, except?: string): Promise<number> {
  const r = await db
    .selectFrom(participationRows(db, now, accountId).as('p'))
    .select((eb) => eb.fn.count<number>('p.release_id').distinct().as('n'))
    .$if(except !== undefined, (q) => q.where('p.release_id', '<>', except!))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** The releases (their ids) an account took part in at `now`. */
export async function participatedReleases(db: Db, accountId: string, now: Date): Promise<Set<string>> {
  const rows = await db.selectFrom(participationRows(db, now, accountId).as('p')).select('p.release_id').distinct().execute();
  return new Set(rows.map((r) => r.release_id));
}

/**
 * The releases taken part in by the account `account` names (a column of the outer query), as a correlated count;
 * `except`: a release left out.
 */
export function participationCount(db: Db, now: Date, account: Expression<string>, except?: string) {
  return db
    .selectFrom(participationRows(db, now).as('p'))
    .select((eb) => eb.fn.count<number>('p.release_id').distinct().as('n'))
    .where('p.account_id', '=', account)
    .$if(except !== undefined, (q) => q.where('p.release_id', '<>', except!));
}

/** Whether the account `account` names took part in the release `releaseId`. */
export function tookPartIn(db: Db, now: Date, account: Expression<string>, releaseId: string): Expression<SqlBool> {
  return sql<SqlBool>`exists (${db
    .selectFrom(participationRows(db, now).as('p'))
    .select('p.release_id')
    .where('p.account_id', '=', account)
    .where('p.release_id', '=', releaseId)})`;
}

/** The pieces secured by the account `account` names: its LIVE entries CONFIRMED (their quantity), its draw entries CONFIRMED. */
export function securedCount(db: Db, account: Expression<string>): RawBuilder<number> {
  const live = db.selectFrom('live_entries as se').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('se.quantity'), sql<number>`0`).as('n')).where('se.account_id', '=', account).where('se.status', '=', 'CONFIRMED');
  const draw = db
    .selectFrom('drop_entries as sd')
    .innerJoin('drops as sdd', 'sdd.id', 'sd.drop_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('sd.account_id', '=', account)
    .where('sd.status', '=', 'CONFIRMED')
    .where('sdd.mode', '=', 'DRAW');
  return sql<number>`((${live}) + (${draw}))`;
}

/** Whether the account `account` names secured a piece in the release `releaseId` (its after-room's included). */
export function securedIn(db: Db, account: Expression<string>, releaseId: string): Expression<SqlBool> {
  const live = db
    .selectFrom('live_entries as ie')
    .innerJoin('drops as idr', 'idr.id', 'ie.drop_id')
    .select('ie.id')
    .where('ie.account_id', '=', account)
    .where('ie.status', '=', 'CONFIRMED')
    .where(sql<string>`coalesce(idr.parent_drop_id, idr.id)`, '=', releaseId);
  const draw = db.selectFrom('drop_entries as ic').select('ic.id').where('ic.account_id', '=', account).where('ic.status', '=', 'CONFIRMED').where('ic.drop_id', '=', releaseId);
  return sql<SqlBool>`(exists (${live}) or exists (${draw}))`;
}

/** A release an account took part in (THE RELEASES' PAST, plan LIVE RELEASE+ choice 5), and whether it secured a piece there. */
export interface ReleaseTakenPart {
  /** The release (an after-room's: the release it follows). */
  id: string;
  /** A piece secured in it, its after-room's included: YOU SECURED A PIECE; else YOU TOOK PART. */
  secured: boolean;
}

/**
 * The releases an account took part in at `now`, each once (by id), each with whether it secured a piece there: the
 * same releases `participations` counts, so their number is the collector's « You have taken part in N releases ».
 */
export async function releasesTakenPart(db: Db, accountId: string, now: Date): Promise<ReleaseTakenPart[]> {
  const took = await participatedReleases(db, accountId, now);
  if (took.size === 0) return [];
  const live = db
    .selectFrom('live_entries as ce')
    .innerJoin('drops as cd', 'cd.id', 'ce.drop_id')
    .select(sql<string>`coalesce(cd.parent_drop_id, cd.id)`.as('release_id'))
    .where('cd.mode', '=', 'LIVE')
    .where('ce.account_id', '=', accountId)
    .where('ce.status', '=', 'CONFIRMED');
  const draw = db
    .selectFrom('drop_entries as ce')
    .innerJoin('drops as cd', 'cd.id', 'ce.drop_id')
    .select('cd.id as release_id')
    .where('cd.mode', '=', 'DRAW')
    .where('ce.account_id', '=', accountId)
    .where('ce.status', '=', 'CONFIRMED');
  const secured = new Set((await live.union(draw).execute()).map((r) => r.release_id));
  return [...took].sort().map((id) => ({ id, secured: secured.has(id) }));
}
