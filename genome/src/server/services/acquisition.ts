/**
 * Where collectors come from (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.7.1, §3.0 (b) and (c); migration 0043
 * `acquisition`): the visits a device makes through a console link, campaign tags or a referring site, remembered on
 * the device (`tracking_devices`, the existing cookie `__Host-orbes_device`) and attached to the account at sign-up or
 * sign-in.
 *
 *   prepare  at boot (context.ts, after ProfileService.prepare): the seven channels the links are grouped by
 *            (CHANNEL_PRESETS, only while `link_channels` is empty and at the first boot, before the state row
 *            exists: a channel staff removed never comes back, even once they removed them all), the
 *            DIRECT, BEFORE and STAFF sources, and the one `acquisition_state` row whose `tracking_started_at` is this
 *            first boot (before it, « Before tracking »). Each `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`, so a
 *            second boot, or two processes at once, create one set; a second boot never moves the start.
 *   arrive   (§3.4 A.5, A.7.1, step 4.2) the page load's arrival, the `a` of its first `POST /api/v1/seen` batch, handed
 *            over by TrackingService.ingest once the pipeline's exclusions passed (staff, the team's own accounts, test
 *            entrants and their networks, automated agents, the device's daily cap; §3.3 T.8.3). Classified once, the
 *            most deliberate signal winning (`classify`): a console link named by `o` (archived ones included; its tags
 *            and site then ignored), then campaign tags (utm_source or utm_campaign), then a referring site
 *            (services/referrers.ts), then DIRECT. Its source row found by its key, or made: a new CAMPAIGN or SITE
 *            source past SOURCES_PER_DAY made this Paris day falls back to the next class down (its site, then
 *            DIRECT), so junk tags never fill the disk. Then, in one short transaction: the device's first source, set
 *            once (DIRECT included), and, unless DIRECT, the visit: one row per device, source and Paris day, its
 *            repeats counted (`arrivals`), its last arrival moved, the account kept once known. A visit is data, not
 *            an act: never audited.
 *   attach   (§3.4 A.4, A.7.1, step 4.4) inside TrackingService.link's transaction (§3.3 T.8.4 step 7), at a sign-up
 *            (SIGN_UP), a sign-in (SIGN_IN) and a signed-in visit whose device was not linked to the account (SESSION):
 *            the device's visits still without an account take it. At a sign-up, the account's first source
 *            (`account_sources`, set by SIGN_UP: the device's first visit and its source, STAFF on a device marked
 *            staff's, DIRECT when the device made no arrival) and its SIGNUP conversion, judged at the account's
 *            creation by `lastSourceAt`. At a sign-in or a signed-in visit, the first source checked again: a device
 *            first seen before the account's recorded first visit and before the account was made (made since the
 *            recording started), not marked staff's and linked to no other account, becomes the account's first source
 *            (set by SIGN_IN). A failure is logged (`acquisition attach failed`) and rolls the link back; the
 *            collector is answered as before, and the conversions job writes a missing SIGNUP afterwards.
 *   lastSourceAt (§3.4 A.5) the last link of an act: the account's latest visit begun at or before the moment, whose
 *            latest arrival up to the moment falls within LAST_LINK_DAYS of it, else DIRECT. A visit is never DIRECT,
 *            so a direct return never replaces the link that brought them. `lastTouch` is the same rule in SQL, for the
 *            conversions job.
 *   jobs     (§3.4 A.8, step 4.5; services/acquisition-jobs.ts) recordConversions, summariseDays and purge, run by the
 *            housekeeping (context.ts) in the lot's order (§3.0 (f)).
 *
 * Nothing here is audited at boot: the presets are the house's words, written once, as the stock's are. No third party:
 * nothing leaves this database.
 */
import { sql, type RawBuilder } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { LinkVia, SourceKind } from '../db/schema.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { purgeTouches, recordConversions, summariseDays, type ConversionsOutcome } from './acquisition-jobs.js';
import { referrerHost, SITE_RE } from './referrers.js';
import { parisDay, parisDayStart } from './schedule.js';

/**
 * The channels made at the first boot, in their order (§3.4 A.6 item 1): the words of « How did you hear about ORBES? »
 * less « A friend » (no referral link was chosen), so the declared and the measured origins read alike.
 */
export const CHANNEL_PRESETS: readonly (readonly [name: string, position: number])[] = [
  ['Instagram', 10],
  ['TikTok', 20],
  ['Influencers', 30],
  ['Press', 40],
  ['Shops', 50],
  ['Search', 60],
  ['Other', 70],
];

/** The sources no arrival creates, made at boot, each its kind as its key (§3.4 A.6 item 3). */
export const FIXED_SOURCES = ['DIRECT', 'BEFORE', 'STAFF'] as const satisfies readonly SourceKind[];

/** New CAMPAIGN and SITE sources made per Paris day at most (§3.4 A.6): past it, an arrival falls back a class. */
export const SOURCES_PER_DAY = 100;
/** The source rows' ids kept in memory, by key (a source is never deleted nor changed). */
export const SOURCE_CACHE_SIZE = 1_000;
/** U+001F, between the five tags of a campaign's key. */
export const TAG_SEPARATOR = '\u001f';
/** The last link of an act is a visit within this many days before it (§3.4 A.5, question 6). */
export const LAST_LINK_DAYS = 90;

/** The sources no arrival makes, by kind (made by `prepare`). */
export type FixedSourceIds = Record<(typeof FIXED_SOURCES)[number], number>;

/** The ids of the DIRECT, BEFORE and STAFF sources; throws when `prepare` has not run. */
export async function fixedSourceIds(db: Db): Promise<FixedSourceIds> {
  const rows = await db.selectFrom('acquisition_sources').select(['key', 'id']).where('key', 'in', [...FIXED_SOURCES]).execute();
  const ids = Object.fromEntries(rows.map((r) => [r.key, r.id])) as Partial<FixedSourceIds>;
  for (const k of FIXED_SOURCES) if (ids[k] === undefined) throw new Error(`the ${k} source is missing`);
  return ids as FixedSourceIds;
}

/**
 * The last link of an act (§3.4 A.5), in SQL: the source of the account's latest visit begun at or before `at` whose
 * latest arrival up to `at` is within LAST_LINK_DAYS of it (on `acquisition_touches_account`), or NULL (read as
 * DIRECT). A visit updated later the same day still counts from its first arrival.
 */
export const lastTouch = (account: RawBuilder<unknown>, at: RawBuilder<unknown>): RawBuilder<number | null> => sql<number | null>`(
  SELECT lt.source_id FROM acquisition_touches lt
   WHERE lt.account_id = ${account} AND lt.first_at <= ${at}
     AND least(lt.last_at, ${at}) >= ${at} - ${sql.raw(`interval '${LAST_LINK_DAYS} days'`)}
   ORDER BY least(lt.last_at, ${at}) DESC, lt.id DESC LIMIT 1)`;

/** What `attach` wrote (the tests). */
export interface AttachOutcome {
  /** The device's visits that took the account. */
  touches: number;
  /** The account's first source was written (a sign-up) or replaced by an earlier device (a sign-in). */
  firstSource: boolean;
  /** The SIGNUP conversion was written. */
  signup: boolean;
}

/** The five campaign tags of an arrival, as the app read them from the address (`utm_source` … `utm_term`). */
export interface ArrivalTags {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

/** What an arrival says (http/schemas.ts arrivalShape, every field optional, an invalid one already dropped). */
export interface ArrivalSignals {
  /** The console link's code from `o` (any case). */
  link?: string | null;
  utm?: ArrivalTags | null;
  /** `document.referrer`: only its host is ever kept. */
  referrer?: string | null;
}

/** `arrive`'s input (§3.4 A.7.1). */
export interface ArrivalInput extends ArrivalSignals {
  deviceId: number;
  /** The account signed in on the request, if any: its visit is the account's at once. */
  accountId: string | null;
  now: Date;
}

/** One candidate source of an arrival, in the order they are tried. */
export type SourceCandidate =
  | { kind: 'LINK'; code: string }
  | { kind: 'CAMPAIGN'; key: string; tags: Required<{ [K in keyof ArrivalTags]: string | null }> }
  | { kind: 'SITE'; key: string; site: string }
  | { kind: 'DIRECT'; key: 'DIRECT' };

/** What `arrive` recorded (the tests and the logs; the route answers 204 whatever it is). */
export interface ArrivalOutcome {
  sourceId: number;
  kind: Exclude<SourceKind, 'BEFORE' | 'STAFF'>;
  /** The device's first source was set by this arrival. */
  firstSource: boolean;
  /** A visit was written (a new one or a repeat); never for DIRECT. */
  touch: boolean;
}

const TAG_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const LINK_CODE_RE = /^[a-z0-9-]{3,32}$/;

/** A tag as it is kept: trimmed, in lower case, 1 to 100 characters; anything else is no tag. */
function tagOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return t.length >= 1 && t.length <= 100 && !/\p{C}/u.test(t) ? t : null;
}

/**
 * The candidate sources of an arrival, most deliberate first (§3.4 A.5): the link named by `o`, the campaign of its
 * tags, the referring site, then DIRECT, always last. Pure: whether the link exists, and the day's cap, are the
 * caller's to check.
 */
export function classify(input: ArrivalSignals, publicHost: string): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  const code = typeof input.link === 'string' ? input.link.trim().toLowerCase() : '';
  if (LINK_CODE_RE.test(code)) out.push({ kind: 'LINK', code });
  const tags = Object.fromEntries(TAG_KEYS.map((k) => [k, tagOf(input.utm?.[k])])) as Required<{ [K in keyof ArrivalTags]: string | null }>;
  if (tags.source !== null || tags.campaign !== null) out.push({ kind: 'CAMPAIGN', key: `C:${TAG_KEYS.map((k) => tags[k] ?? '').join(TAG_SEPARATOR)}`, tags });
  const site = referrerHost(input.referrer, publicHost);
  if (site !== null && SITE_RE.test(site)) out.push({ kind: 'SITE', key: `S:${site}`, site });
  out.push({ kind: 'DIRECT', key: 'DIRECT' });
  return out;
}

export interface AcquisitionServiceDeps {
  db: Db;
  /** The app's own origin (config.publicOrigin): an arrival from it is an inner move, never a referring site. */
  publicOrigin: string;
  clock?: Clock;
  log?: Logger;
}

/** What `prepare` created (nothing on a later boot). */
export interface AcquisitionPrepared {
  channels: string[];
  sources: string[];
  /** The recording's start, written by this boot (null: an earlier boot wrote it). */
  started: Date | null;
}

export class AcquisitionService {
  protected readonly db: Db;
  protected readonly clock: Clock;
  protected readonly log: Logger;
  /** The host of the app's own origin, in lower case (« verify.theorbes.com »). */
  readonly publicHost: string;

  constructor(deps: AcquisitionServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.publicHost = hostOf(deps.publicOrigin);
  }

  /** The first boot's channels, fixed sources and state row (see the header). Idempotent, safe at once in two processes. */
  async prepare(): Promise<AcquisitionPrepared> {
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      const channels = await sql<{ name: string }>`
        INSERT INTO link_channels (name, position, created_at)
        SELECT v.name, v.position, ${now}::timestamptz
          FROM (VALUES ${sql.join(CHANNEL_PRESETS.map(([name, position]) => sql`(${name}::text, ${position}::smallint)`))}) AS v (name, position)
         WHERE NOT EXISTS (SELECT 1 FROM link_channels)
           AND NOT EXISTS (SELECT 1 FROM acquisition_state)
           AND NOT EXISTS (SELECT 1 FROM link_channels c WHERE lower(c.name) = lower(v.name))
        ON CONFLICT DO NOTHING RETURNING name`.execute(tx);
      const sources = await sql<{ key: string }>`
        INSERT INTO acquisition_sources (kind, key, created_at)
        SELECT v.kind, v.kind, ${now}::timestamptz
          FROM (VALUES ${sql.join(FIXED_SOURCES.map((k) => sql`(${k}::text)`))}) AS v (kind)
        ON CONFLICT (key) DO NOTHING RETURNING key`.execute(tx);
      const state = await sql<{ tracking_started_at: Date }>`
        INSERT INTO acquisition_state (id, tracking_started_at, conversions_until)
        VALUES (1, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (id) DO NOTHING RETURNING tracking_started_at`.execute(tx);
      const made = new Set(channels.rows.map((r) => r.name));
      const fixed = new Set(sources.rows.map((r) => r.key));
      return {
        channels: CHANNEL_PRESETS.map(([name]) => name).filter((n) => made.has(n)),
        sources: FIXED_SOURCES.filter((k) => fixed.has(k)),
        started: state.rows[0]?.tracking_started_at ?? null,
      };
    });
  }

  private readonly sourceIds = new Map<string, number>();

  /**
   * The page load's arrival (see the header): its source, the device's first source, the visit. Throws on a database
   * failure; TrackingService.ingest logs it and the views go on.
   */
  async arrive(input: ArrivalInput): Promise<ArrivalOutcome> {
    const day = parisDay(input.now);
    // Source ids are kept in memory only once their transaction committed: a row rolled back is never remembered.
    const learnt = new Map<string, number>();
    const outcome = await inTransaction(this.db, async (tx) => {
      let chosen: { id: number; kind: ArrivalOutcome['kind'] } | null = null;
      for (const candidate of classify(input, this.publicHost)) {
        const id = await this.sourceOf(tx, candidate, input.now, learnt);
        if (id !== null) {
          chosen = { id, kind: candidate.kind };
          break;
        }
      }
      if (!chosen) throw new Error('the DIRECT source is missing');
      const first = await sql`UPDATE tracking_devices SET first_source_id = ${chosen.id}::integer WHERE id = ${input.deviceId}::integer AND first_source_id IS NULL`.execute(tx);
      let touch = false;
      if (chosen.kind !== 'DIRECT') {
        await sql`
          INSERT INTO acquisition_touches (device_id, source_id, day, first_at, last_at, account_id)
          VALUES (${input.deviceId}::integer, ${chosen.id}::integer, ${day}::date, ${input.now}::timestamptz, ${input.now}::timestamptz, ${input.accountId}::uuid)
          ON CONFLICT (device_id, source_id, day) DO UPDATE SET
            last_at = greatest(acquisition_touches.last_at, EXCLUDED.last_at),
            arrivals = acquisition_touches.arrivals + 1,
            account_id = coalesce(acquisition_touches.account_id, EXCLUDED.account_id)`.execute(tx);
        touch = true;
      }
      return { sourceId: chosen.id, kind: chosen.kind, firstSource: Number(first.numAffectedRows ?? 0) > 0, touch };
    });
    for (const [key, id] of learnt) this.remember(key, id);
    return outcome;
  }

  /**
   * The id of a candidate's source row, or null when it cannot be used: a link code no link has, a new campaign or site
   * past the day's cap. A link's source is made with the link (LinkService.create); one found missing is made here.
   */
  private async sourceOf(tx: Db, c: SourceCandidate, now: Date, learnt: Map<string, number>): Promise<number | null> {
    if (c.kind === 'LINK') {
      const cached = this.sourceIds.get(`O:${c.code}`);
      if (cached !== undefined) return cached;
      const link = await tx.selectFrom('links').select('id').where('code', '=', c.code).executeTakeFirst();
      if (!link) return null;
      const id = await this.ensureSource(tx, `L:${link.id}`, { kind: 'LINK', link_id: link.id }, now);
      learnt.set(`O:${c.code}`, id);
      return id;
    }
    const cached = this.sourceIds.get(c.key);
    if (cached !== undefined) return cached;
    const found = await tx.selectFrom('acquisition_sources').select('id').where('key', '=', c.key).executeTakeFirst();
    if (found) {
      learnt.set(c.key, found.id);
      return found.id;
    }
    if (c.kind === 'DIRECT') {
      const id = await this.ensureSource(tx, 'DIRECT', { kind: 'DIRECT' }, now);
      learnt.set(c.key, id);
      return id;
    }
    // A new campaign or site: within the day's cap only.
    const made = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM acquisition_sources
       WHERE created_at >= ${parisDayStart(parisDay(now))}::timestamptz AND kind IN ('CAMPAIGN', 'SITE')`.execute(tx);
    if ((made.rows[0]?.n ?? 0) >= SOURCES_PER_DAY) return null;
    const cols =
      c.kind === 'CAMPAIGN'
        ? { kind: 'CAMPAIGN' as const, utm_source: c.tags.source, utm_medium: c.tags.medium, utm_campaign: c.tags.campaign, utm_content: c.tags.content, utm_term: c.tags.term }
        : { kind: 'SITE' as const, site: c.site };
    const id = await this.ensureSource(tx, c.key, cols, now);
    learnt.set(c.key, id);
    return id;
  }

  /** The source row of `key`, made when missing (`ON CONFLICT (key) DO NOTHING`, then read: safe under concurrency). */
  private async ensureSource(
    tx: Db,
    key: string,
    cols: { kind: SourceKind; link_id?: string; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null; utm_term?: string | null; site?: string },
    now: Date,
  ): Promise<number> {
    const inserted = await tx
      .insertInto('acquisition_sources')
      .values({ ...cols, key, created_at: now })
      .onConflict((oc) => oc.column('key').doNothing())
      .returning('id')
      .executeTakeFirst();
    return inserted?.id ?? (await tx.selectFrom('acquisition_sources').select('id').where('key', '=', key).executeTakeFirstOrThrow()).id;
  }

  private remember(key: string, id: number): void {
    this.sourceIds.delete(key);
    this.sourceIds.set(key, id);
    while (this.sourceIds.size > SOURCE_CACHE_SIZE) this.sourceIds.delete(this.sourceIds.keys().next().value as string);
  }

  /**
   * The device linked to the account (see the header), inside TrackingService.link's transaction `tx`. Throws on a
   * failure, logged here: the link rolls back and its caller logs it too.
   */
  async attach(tx: Db, deviceId: number, accountId: string, via: LinkVia, now: Date): Promise<AttachOutcome> {
    try {
      // The device's visits still without an account: since its previous link, they are this account's.
      const touched = await sql`UPDATE acquisition_touches SET account_id = ${accountId}::uuid WHERE device_id = ${deviceId}::integer AND account_id IS NULL`.execute(tx);
      const touches = Number(touched.numAffectedRows ?? 0);
      const started = await this.trackingStartedAt(tx);
      // Before `prepare` (never in the app: it runs at boot), nothing is attributed.
      if (!started) return { touches, firstSource: false, signup: false };
      const ids = await this.fixed(tx);
      if (via === 'SIGN_UP') {
        const first = await sql`
          INSERT INTO account_sources (account_id, first_source_id, first_seen_at, set_at, set_by)
          SELECT a.id, CASE WHEN d.staff_at IS NOT NULL THEN ${ids.STAFF}::integer ELSE coalesce(d.first_source_id, ${ids.DIRECT}::integer) END,
                 least(d.first_seen_at, a.created_at), ${now}::timestamptz, 'SIGN_UP'
            FROM accounts a JOIN tracking_devices d ON d.id = ${deviceId}::integer
           WHERE a.id = ${accountId}::uuid
          ON CONFLICT (account_id) DO NOTHING`.execute(tx);
        const signup = await sql`
          INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
          SELECT 'SIGNUP', a.id, a.id, a.created_at,
                 CASE WHEN a.created_at < ${started}::timestamptz THEN ${ids.BEFORE}::integer
                      ELSE coalesce(${lastTouch(sql`a.id`, sql`a.created_at`)}, ${ids.DIRECT}::integer) END,
                 ${now}::timestamptz
            FROM accounts a WHERE a.id = ${accountId}::uuid
          ON CONFLICT (kind, ref_id) DO NOTHING`.execute(tx);
        return { touches, firstSource: Number(first.numAffectedRows ?? 0) > 0, signup: Number(signup.numAffectedRows ?? 0) > 0 };
      }
      // A sign-in or a signed-in visit: an earlier device of this account is the discovery (never one another account uses).
      const rechecked = await sql`
        INSERT INTO account_sources (account_id, first_source_id, first_seen_at, set_at, set_by)
        SELECT a.id, coalesce(d.first_source_id, ${ids.DIRECT}::integer), d.first_seen_at, ${now}::timestamptz, 'SIGN_IN'
          FROM accounts a JOIN tracking_devices d ON d.id = ${deviceId}::integer
         WHERE a.id = ${accountId}::uuid
           AND d.staff_at IS NULL
           AND d.first_seen_at < a.created_at
           AND a.created_at >= ${started}::timestamptz
           AND NOT EXISTS (SELECT 1 FROM tracking_device_accounts x WHERE x.device_id = d.id AND x.account_id <> a.id)
        ON CONFLICT (account_id) DO UPDATE SET
          first_source_id = EXCLUDED.first_source_id, first_seen_at = EXCLUDED.first_seen_at, set_at = EXCLUDED.set_at, set_by = EXCLUDED.set_by
         WHERE EXCLUDED.first_seen_at < account_sources.first_seen_at`.execute(tx);
      return { touches, firstSource: Number(rechecked.numAffectedRows ?? 0) > 0, signup: false };
    } catch (e) {
      this.log.error({ err: { message: (e as Error)?.message }, via }, 'acquisition attach failed');
      throw e;
    }
  }

  /** The last link of the account's act at `at` (§3.4 A.5): its source id, DIRECT when none. */
  async lastSourceAt(db: Db, accountId: string, at: Date): Promise<number> {
    const ids = await this.fixed(db);
    const row = await sql<{ id: number }>`SELECT coalesce(${lastTouch(sql`${accountId}::uuid`, sql`${at}::timestamptz`)}, ${ids.DIRECT}::integer) AS id`.execute(db);
    return Number(row.rows[0]!.id);
  }

  /** The DIRECT, BEFORE and STAFF sources' ids, kept once read (a source is never deleted nor changed). */
  private async fixed(db: Db): Promise<FixedSourceIds> {
    const known = FIXED_SOURCES.map((k) => this.sourceIds.get(k));
    if (known.every((id) => id !== undefined)) return Object.fromEntries(FIXED_SOURCES.map((k, i) => [k, known[i]])) as FixedSourceIds;
    const ids = await fixedSourceIds(db);
    for (const k of FIXED_SOURCES) this.remember(k, ids[k]);
    return ids;
  }

  /** Job `acquisitionConversions` (§3.4 A.8 item 1): see services/acquisition-jobs.ts. */
  recordConversions(now: Date = this.clock()): Promise<ConversionsOutcome> {
    return recordConversions(this.db, now);
  }

  /** Job `acquisitionDaily` (§3.4 A.8 item 2): the complete Paris days' visits; the days summarised. */
  summariseDays(now: Date = this.clock()): Promise<number> {
    return summariseDays(this.db, now);
  }

  /** Job `acquisitionPurge` (§3.4 A.8 item 3): the visits past their 13 months, once summarised; the rows deleted. */
  purge(now: Date = this.clock()): Promise<number> {
    return purgeTouches(this.db, now);
  }

  /** The recording's start (`acquisition_state.tracking_started_at`), or null before `prepare` ran. */
  async trackingStartedAt(db: Db = this.db): Promise<Date | null> {
    const row = await db.selectFrom('acquisition_state').select('tracking_started_at').where('id', '=', 1).executeTakeFirst();
    return row?.tracking_started_at ?? null;
  }
}

/** The host of an origin, in lower case, without its port: « https://verify.theorbes.com » → « verify.theorbes.com ». */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}
