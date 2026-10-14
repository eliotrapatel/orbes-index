/**
 * The segments (plan LIVE RELEASE+ of 2026-10-04, choice 27, N5; migration 0023): saved groups of collectors, built in
 * the console's Segments page (Clients) from four groups of criteria:
 *
 *   releases   taken part in at least N releases, or in one (services/participation.ts); at least N pieces secured, or
 *              a piece secured in one;
 *   the club   the tier now (club.ts: the pieces held now), a piece held now of some models, or of some collections (a
 *              piece's own collection first, its model's otherwise);
 *   profile    a size (of a piece held now, `products.variant`; chosen in a LIVE RELEASE, entered or said I'LL BE THERE;
 *              or of an order), the country (the account's, else the one its latest LIVE entry came from);
 *   signals    I'LL BE THERE said (to one release, or any), an answer to the question after of a release, the last
 *              activity (a sign-in, a session still in use, a scan) within N days.
 *
 * and, after SIGNALS, the customer intelligence lot's groups (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.0 (g),
 * §3.6 C.5.1), the four above unchanged:
 *
 *   person     the city given in YOUR PROFILE (folded: case and accents, `orbes_fold`), the age today (Paris) from the
 *              date of birth, the answer to « How did you hear about ORBES? », a staff tag;
 *   tastes     an open wish for a model (a main model named includes its variants, a variant only itself) or for a model
 *              of a collection, a favourite piece or finish chosen in YOUR PROFILE (its key; one no longer in the
 *              collection still matches: keys are never checked against the catalogue);
 *   browsing   (§3.3 T.4.3: services/tracking-reads.ts browsingCondition, TrackingService.segmentCondition's SQL) a
 *              model viewed at least N times in the last N days (a main model with its variants), a release viewed at
 *              least N times over the 13 months, a device used in the last N days (its kind, system, way it was opened
 *              and app), a place it was seen from by the connection in the last N days. N days is at most 395: the
 *              views' detail is kept 13 months;
 *   origin     (§3.4 A.5, A.10.6: services/acquisition-report.ts) the first source, or the last link before the sign-up,
 *              before a paid order that is not GIFT, or either, in some channels, links (archived ones too) or kinds of
 *              source, with the reports' fallbacks (Before tracking, Direct). A test entrant never matches one: it
 *              makes no visit and no conversion, and the fallbacks would read it Direct;
 *   engagement (§3.5 SB.3.4) the engagement score of the latest morning run (account_scores, by its key) from … to …: an
 *              account with no score yet (created since the run, a test entrant) never matches but through a NOT. A
 *              segment that reads it may be a LIVE RELEASE's access rule or a post's audience like any other (question
 *              15, §3.6 C.5.4): nothing refuses it.
 *
 * A new criterion reads what a test entrant never has (a profile, a wish, a view, a source, a score): a test entrant
 * matches one only through a NOT (§3.0 (d)), as today's members rule (ACTIVE accounts, test entrants and the team's own
 * accounts included) is unchanged.
 *
 * A segment's `criteria` is a rule tree: a group (`match` ALL or ANY of its rules) whose rules are criteria or groups of
 * criteria (one level down: SEGMENT_LIMITS.depth); any criterion may be negated (`not`). Its members are the ACTIVE
 * accounts it matches, evaluated live, never stored: wherever it decides something (a release's access rule,
 * services/live.ts; the audience of a post of the circle, services/circle.ts), at the moment it decides.
 *
 * The console (routes/admin/segments.ts): the list with each segment's count now and what uses it, the builder's
 * options (the releases, models, collections, sizes and countries it names; for the lot's criteria, the cities, the
 * answers of « How did you hear about ORBES? », the tags, the tastes, the channels, kinds of source and links, the places
 * and the device lists, each bounded), the live count of criteria being built
 * (OPERATOR), a segment's members as a CSV (the routes mask the emails for an AUDITOR), created, changed and deleted by
 * an OPERATOR. Audited `segment.create`, `segment.update` (before and after), `segment.delete`; a segment that a release
 * or a post of the circle uses is never deleted (409 SEGMENT_IN_USE). Its name is the console's: the public never reads
 * it (a release says FOR SELECTED COLLECTORS, decision 32).
 *
 * The test accounts (the test entrants' pool, `test_entrants`) are never among the members the console reads: not in a
 * segment's count (the list's, its page's, the builder's live count), not in its CSV (`notTestEntrant`,
 * services/population.ts). Where a segment decides (`segmentMembers`, `isSegmentMember`: a release's access rule, a
 * post's audience) they are read as any account, so that a test run still enters a release open to a segment.
 */
import { sql, type Expression, type ExpressionBuilder, type RawBuilder, type SqlBool } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  DEVICE_KINDS,
  DEVICE_SYSTEMS,
  IN_APPS,
  jsonText,
  OPENED_IN,
  SOURCE_KINDS,
  type Database,
  type DeviceKind,
  type DeviceSystem,
  type InApp,
  type JsonObject,
  type OpenedIn,
  type SegmentRow,
  type SourceKind,
} from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_THRESHOLDS } from './club.js';
import { LIVE_QUESTION_DEFAULT } from './live.js';
import { participationCount, securedCount, securedIn, tookPartIn } from './participation.js';
import { notTestEntrant } from './population.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { fold } from '../../shared/fold.js';
import { cleanWords, latestBirthDateForAge, TASTE_KEY_MAX, tasteKey } from '../../shared/profile-rules.js';
import { cleanTag } from './client-notes.js';
import { parisDay } from './schedule.js';
import { addParisDays, browsingCondition } from './tracking-reads.js';
import { tasteOptions } from './tastes.js';
import { countryName } from '../../shared/countries.js';
import { UNKNOWN_COUNTRY } from './scan-stats.js';
import { LAST_SOURCE_AT, lastSourceFilter, sourceFilter, type LastSourceAt } from './acquisition-filters.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** Every criterion, by its group: the four of choice 27, then the customer intelligence lot's (§3.0 (g)), in their order. */
export const SEGMENT_CRITERIA = Object.freeze({
  RELEASES: Object.freeze(['PARTICIPATIONS', 'TOOK_PART', 'SECURED', 'SECURED_IN'] as const),
  CLUB: Object.freeze(['TIER', 'OWNS_MODEL', 'OWNS_COLLECTION'] as const),
  PROFILE: Object.freeze(['SIZE', 'COUNTRY'] as const),
  SIGNALS: Object.freeze(['INTEREST', 'ANSWER', 'ACTIVE'] as const),
  PERSON: Object.freeze(['CITY', 'AGE', 'HEARD_FROM', 'TAGGED'] as const),
  TASTES: Object.freeze(['WISHES_MODEL', 'WISHES_COLLECTION', 'FAVOURITE_PIECE', 'FAVOURITE_FINISH'] as const),
  BROWSING: Object.freeze(['VIEWED_MODEL', 'VIEWED_RELEASE', 'DEVICE', 'PLACE'] as const),
  ORIGIN: Object.freeze(['FIRST_SOURCE', 'LAST_SOURCE'] as const),
  ENGAGEMENT: Object.freeze(['SCORE'] as const),
});
export type SegmentCriterionGroup = keyof typeof SEGMENT_CRITERIA;
export const SEGMENT_RULE_KINDS = Object.freeze([
  ...SEGMENT_CRITERIA.RELEASES,
  ...SEGMENT_CRITERIA.CLUB,
  ...SEGMENT_CRITERIA.PROFILE,
  ...SEGMENT_CRITERIA.SIGNALS,
  ...SEGMENT_CRITERIA.PERSON,
  ...SEGMENT_CRITERIA.TASTES,
  ...SEGMENT_CRITERIA.BROWSING,
  ...SEGMENT_CRITERIA.ORIGIN,
  ...SEGMENT_CRITERIA.ENGAGEMENT,
] as const);
export type SegmentRuleKind = (typeof SEGMENT_RULE_KINDS)[number];
export const SEGMENT_MATCHES = Object.freeze(['ALL', 'ANY'] as const);
export type SegmentMatch = (typeof SEGMENT_MATCHES)[number];

/** The bounds of a segment (web/admin/model/segments.ts mirrors them). */
export const SEGMENT_LIMITS = Object.freeze({
  name: 60,
  /** The rules of a group. */
  rules: 20,
  /** Groups within the segment's group, one level. */
  depth: 2,
  /** The ids, sizes or countries one criterion names. */
  items: 50,
  /** Releases taken part in, pieces secured: at least 1 to 100. */
  count: Object.freeze({ min: 1, max: 100 }),
  /** The last activity within 1 to 3 650 days. */
  days: Object.freeze({ min: 1, max: 3650 }),
  sizeLabel: 12,
  /** AGE: whole years from 0 to 120. */
  age: Object.freeze({ min: 0, max: 120 }),
  /** A city named by CITY, in characters (YOUR PROFILE's CITY_MAX). */
  city: 80,
  /** A tag named by TAGGED, in characters (services/client-notes.ts TAG_MAX). */
  tag: 32,
  /** The last N days of VIEWED_MODEL, DEVICE and PLACE (services/tracking-reads.ts VIEW_RULE_DAYS: the 13 months). */
  viewDays: Object.freeze({ min: 1, max: 395 }),
  /** Viewed at least N times (VIEW_RULE_MIN). */
  viewMin: Object.freeze({ min: 1, max: 100 }),
  /** SCORE: the engagement score from … to …, whole numbers (account_scores.score). */
  score: Object.freeze({ min: 0, max: 100 }),
});

/** A criterion of a segment; `not`: the accounts it does not match. */
export type SegmentRule = { not?: boolean } & (
  | { kind: 'PARTICIPATIONS'; min: number }
  | { kind: 'TOOK_PART'; dropId: string }
  | { kind: 'SECURED'; min: number }
  | { kind: 'SECURED_IN'; dropId: string }
  | { kind: 'TIER'; tiers: number[] }
  | { kind: 'OWNS_MODEL'; modelIds: string[] }
  | { kind: 'OWNS_COLLECTION'; collectionIds: string[] }
  | { kind: 'SIZE'; sizes: string[] }
  | { kind: 'COUNTRY'; countries: string[] }
  | { kind: 'INTEREST'; dropId: string | null }
  | { kind: 'ANSWER'; dropId: string; answer: number }
  | { kind: 'ACTIVE'; days: number }
  | { kind: 'CITY'; cities: string[] }
  | { kind: 'AGE'; min: number; max: number }
  | { kind: 'HEARD_FROM'; optionIds: string[] }
  | { kind: 'TAGGED'; tags: string[] }
  | { kind: 'WISHES_MODEL'; modelIds: string[] }
  | { kind: 'WISHES_COLLECTION'; collectionIds: string[] }
  | { kind: 'FAVOURITE_PIECE'; pieces: string[] }
  | { kind: 'FAVOURITE_FINISH'; finishes: string[] }
  | { kind: 'VIEWED_MODEL'; modelIds: string[]; min: number; days: number }
  | { kind: 'VIEWED_RELEASE'; dropId: string; min: number }
  | { kind: 'DEVICE'; kinds?: DeviceKind[]; systems?: DeviceSystem[]; openedIn?: OpenedIn[]; apps?: InApp[]; days: number }
  | { kind: 'PLACE'; countries?: string[]; placeIds?: number[]; days: number }
  | { kind: 'FIRST_SOURCE'; channelIds?: string[]; linkIds?: string[]; kinds?: SourceKind[] }
  | { kind: 'LAST_SOURCE'; channelIds?: string[]; linkIds?: string[]; kinds?: SourceKind[]; at: LastSourceAt }
  | { kind: 'SCORE'; min: number; max: number }
);

/** A group of rules: ALL of them, or ANY. */
export interface SegmentGroup {
  match: SegmentMatch;
  rules: (SegmentRule | SegmentGroup)[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DAY_MS = 86_400_000;

const isGroup = (x: SegmentRule | SegmentGroup): x is SegmentGroup => (x as SegmentGroup).match !== undefined;

function whole(v: unknown, b: { min: number; max: number }, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < b.min || v > b.max) throw validationError(`${what} is a whole number from ${b.min} to ${b.max}.`);
  return v;
}

function id(v: unknown, what: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw validationError(`${what} is unknown.`);
  return v.toLowerCase();
}

function list<T>(v: unknown, what: string, each: (x: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > SEGMENT_LIMITS.items) throw validationError(`${what}: name 1 to ${SEGMENT_LIMITS.items}.`);
  const out = [...new Set(v.map(each))];
  return out.sort();
}

/** A size as the segments compare them: trimmed, in capitals. */
export function segmentSize(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (s.length < 1 || s.length > SEGMENT_LIMITS.sizeLabel || CONTROL_CHARS.test(s)) throw validationError(`A size is 1 to ${SEGMENT_LIMITS.sizeLabel} characters.`);
  return s;
}

function country(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(s)) throw validationError('A country is its two letters (FR, IT, US).');
  return s;
}

/** One of `values`, as given. */
function oneOf<T extends string>(values: readonly T[], what: string): (v: unknown) => T {
  return (v) => {
    if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw validationError(`${what} is one of ${values.join(', ')}.`);
    return v as T;
  };
}

/** A place seen from (geo_places.id): a whole number from 1. Places are never checked: one no longer seen matches nobody. */
function placeId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2_147_483_647) throw validationError('A place is unknown.');
  return v;
}

/** The lists of DEVICE or PLACE given (at least one), each of 1 to 50 items; a list left out stays out. */
function someLists<K extends string>(r: Record<string, unknown>, keys: { [k in K]: (x: unknown) => string | number }, what: string): Partial<Record<K, (string | number)[]>> {
  const out: Partial<Record<K, (string | number)[]>> = {};
  for (const k of Object.keys(keys) as K[]) if (r[k] !== undefined) out[k] = list(r[k], what, keys[k]);
  if (Object.keys(out).length === 0) throw validationError(`${what}: tick at least one.`);
  return out;
}

/** A favourite piece's or finish's key, as YOUR PROFILE keeps one (shared/profile-rules.ts tasteKey). */
function taste(v: unknown): string {
  const k = tasteKey(v);
  if (k === null) throw validationError(`A favourite piece or finish is 1 to ${TASTE_KEY_MAX} characters.`);
  return k;
}

/** A city as CITY compares it: as YOUR PROFILE keeps one (1 to 80 characters), then folded like `orbes_fold` (shared/fold.ts). */
function city(v: unknown): string {
  const c = cleanWords(v, SEGMENT_LIMITS.city);
  if (!c.ok || c.value === null) throw validationError(`A city is 1 to ${SEGMENT_LIMITS.city} characters.`);
  return fold(c.value);
}

function cleanRule(v: unknown): SegmentRule {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const not = r.not === true ? { not: true as const } : {};
  switch (r.kind as SegmentRuleKind) {
    case 'PARTICIPATIONS':
      return { kind: 'PARTICIPATIONS', min: whole(r.min, SEGMENT_LIMITS.count, 'The releases taken part in'), ...not };
    case 'TOOK_PART':
      return { kind: 'TOOK_PART', dropId: id(r.dropId, 'The release'), ...not };
    case 'SECURED':
      return { kind: 'SECURED', min: whole(r.min, SEGMENT_LIMITS.count, 'The pieces secured'), ...not };
    case 'SECURED_IN':
      return { kind: 'SECURED_IN', dropId: id(r.dropId, 'The release'), ...not };
    case 'TIER':
      return { kind: 'TIER', tiers: list(r.tiers, 'The tiers', (t) => whole(t, { min: 0, max: 3 }, 'A tier')), ...not };
    case 'OWNS_MODEL':
      return { kind: 'OWNS_MODEL', modelIds: list(r.modelIds, 'The models', (m) => id(m, 'A model')), ...not };
    case 'OWNS_COLLECTION':
      return { kind: 'OWNS_COLLECTION', collectionIds: list(r.collectionIds, 'The collections', (c) => id(c, 'A collection')), ...not };
    case 'SIZE':
      return { kind: 'SIZE', sizes: list(r.sizes, 'The sizes', segmentSize), ...not };
    case 'COUNTRY':
      return { kind: 'COUNTRY', countries: list(r.countries, 'The countries', country), ...not };
    case 'INTEREST':
      return { kind: 'INTEREST', dropId: r.dropId === null || r.dropId === undefined ? null : id(r.dropId, 'The release'), ...not };
    case 'ANSWER':
      return { kind: 'ANSWER', dropId: id(r.dropId, 'The release'), answer: whole(r.answer, { min: 1, max: 6 }, 'The answer'), ...not };
    case 'ACTIVE':
      return { kind: 'ACTIVE', days: whole(r.days, SEGMENT_LIMITS.days, 'The days'), ...not };
    case 'CITY':
      return { kind: 'CITY', cities: list(r.cities, 'The cities', city), ...not };
    case 'AGE': {
      const min = whole(r.min, SEGMENT_LIMITS.age, 'The youngest age');
      const max = whole(r.max, SEGMENT_LIMITS.age, 'The oldest age');
      if (min > max) throw validationError(`Age between N and N: whole years from ${SEGMENT_LIMITS.age.min} to ${SEGMENT_LIMITS.age.max}, the first not above the second.`);
      return { kind: 'AGE', min, max, ...not };
    }
    case 'HEARD_FROM':
      return { kind: 'HEARD_FROM', optionIds: list(r.optionIds, 'The answers', (o) => id(o, 'An answer')), ...not };
    case 'TAGGED':
      return { kind: 'TAGGED', tags: list(r.tags, 'The tags', cleanTag), ...not };
    case 'WISHES_MODEL':
      return { kind: 'WISHES_MODEL', modelIds: list(r.modelIds, 'The models', (m) => id(m, 'A model')), ...not };
    case 'WISHES_COLLECTION':
      return { kind: 'WISHES_COLLECTION', collectionIds: list(r.collectionIds, 'The collections', (c) => id(c, 'A collection')), ...not };
    case 'FAVOURITE_PIECE':
      return { kind: 'FAVOURITE_PIECE', pieces: list(r.pieces, 'The favourite pieces', taste), ...not };
    case 'FAVOURITE_FINISH':
      return { kind: 'FAVOURITE_FINISH', finishes: list(r.finishes, 'The favourite finishes', taste), ...not };
    case 'VIEWED_MODEL':
      return {
        kind: 'VIEWED_MODEL',
        modelIds: list(r.modelIds, 'The models', (m) => id(m, 'A model')),
        min: whole(r.min, SEGMENT_LIMITS.viewMin, 'Viewed at least N times'),
        days: whole(r.days, SEGMENT_LIMITS.viewDays, 'Viewed a model in the last N days'),
        ...not,
      };
    case 'VIEWED_RELEASE':
      return { kind: 'VIEWED_RELEASE', dropId: id(r.dropId, 'The release'), min: whole(r.min, SEGMENT_LIMITS.viewMin, 'Viewed at least N times'), ...not };
    case 'DEVICE': {
      const lists = someLists(r, { kinds: oneOf(DEVICE_KINDS, 'A device'), systems: oneOf(DEVICE_SYSTEMS, 'A system'), openedIn: oneOf(OPENED_IN, 'A way it was opened'), apps: oneOf(IN_APPS, 'An app') }, 'Device');
      return { kind: 'DEVICE', ...(lists as Pick<Extract<SegmentRule, { kind: 'DEVICE' }>, 'kinds' | 'systems' | 'openedIn' | 'apps'>), days: whole(r.days, SEGMENT_LIMITS.viewDays, 'Device: in the last N days'), ...not };
    }
    case 'FIRST_SOURCE':
    case 'LAST_SOURCE': {
      const what = r.kind === 'FIRST_SOURCE' ? 'Came first through' : 'Came last through';
      const lists = someLists(r, { channelIds: (c) => id(c, 'A channel'), linkIds: (l) => id(l, 'A link'), kinds: oneOf(SOURCE_KINDS, 'A source') }, what) as Pick<
        Extract<SegmentRule, { kind: 'FIRST_SOURCE' }>,
        'channelIds' | 'linkIds' | 'kinds'
      >;
      if (r.kind === 'FIRST_SOURCE') return { kind: 'FIRST_SOURCE', ...lists, ...not };
      return { kind: 'LAST_SOURCE', ...lists, at: oneOf(LAST_SOURCE_AT, 'Came last through: before')(r.at), ...not };
    }
    case 'PLACE': {
      const lists = someLists(r, { countries: country, placeIds: placeId }, 'Seen from');
      return { kind: 'PLACE', ...(lists as Pick<Extract<SegmentRule, { kind: 'PLACE' }>, 'countries' | 'placeIds'>), days: whole(r.days, SEGMENT_LIMITS.viewDays, 'Seen from: in the last N days'), ...not };
    }
    case 'SCORE': {
      const b = SEGMENT_LIMITS.score;
      const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= b.min && n <= b.max;
      if (!ok(r.min) || !ok(r.max) || r.min > r.max) throw validationError(`The engagement score is two whole numbers from ${b.min} to ${b.max}, the first not above the second.`);
      return { kind: 'SCORE', min: r.min, max: r.max, ...not };
    }
    default:
      throw validationError(`A criterion is one of ${SEGMENT_RULE_KINDS.join(', ')}.`);
  }
}

function cleanGroup(v: unknown, depth: number): SegmentGroup {
  const g = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (!(SEGMENT_MATCHES as readonly unknown[]).includes(g.match)) throw validationError('A group matches ALL of its rules, or ANY.');
  if (!Array.isArray(g.rules) || g.rules.length < 1 || g.rules.length > SEGMENT_LIMITS.rules) throw validationError(`A group has 1 to ${SEGMENT_LIMITS.rules} rules.`);
  const rules = g.rules.map((r) => {
    if (r && typeof r === 'object' && 'match' in r) {
      if (depth >= SEGMENT_LIMITS.depth) throw validationError('A group within a group holds criteria only.');
      return cleanGroup(r, depth + 1);
    }
    return cleanRule(r);
  });
  return { match: g.match as SegmentMatch, rules };
}

/** A segment's criteria as the console sends them, checked and written the same way every time (lists sorted, deduplicated). */
export function cleanCriteria(v: unknown): SegmentGroup {
  return cleanGroup(v, 1);
}

/** A segment's name: one line of 1 to 60 characters. */
export function cleanSegmentName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > SEGMENT_LIMITS.name || CONTROL_CHARS.test(s)) throw validationError(`A segment's name is one line of 1 to ${SEGMENT_LIMITS.name} characters.`);
  return s;
}

/** Every criterion of a tree, in order. */
export function segmentRules(g: SegmentGroup): SegmentRule[] {
  return g.rules.flatMap((r) => (isGroup(r) ? segmentRules(r) : [r]));
}

// ── Members ────────────────────────────────────────────────────────────────

type Accounts = ExpressionBuilder<Database & { a: Database['accounts'] }, 'a'>;

/** The tier of the pieces counted (club.ts), in SQL: how many of CLUB_TIER_THRESHOLDS it reaches. */
function tierSql(pieces: Expression<number>): Expression<number> {
  const [t1, t2, t3] = CLUB_TIER_THRESHOLDS;
  return sql<number>`(case when ${pieces} >= ${t3} then 3 when ${pieces} >= ${t2} then 2 when ${pieces} >= ${t1} then 1 else 0 end)`;
}

/** The pieces the account holds now, as the club counts them. */
function piecesHeld(db: Db, account: Expression<string>): RawBuilder<number> {
  return sql<number>`(${db
    .selectFrom('ownership as ho')
    .innerJoin('products as hp', 'hp.id', 'ho.product_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('ho.account_id', '=', account)
    .where('ho.ended_at', 'is', null)
    .where('hp.status', 'not in', [...CLUB_EXCLUDED_STATUSES])})`;
}

function ruleSql(db: Db, eb: Accounts, r: SegmentRule, now: Date): Expression<SqlBool> {
  const account = eb.ref('a.id');
  const exists = (q: { compile(): unknown }) => sql<SqlBool>`exists (${q as never})`;
  let x: Expression<SqlBool>;
  switch (r.kind) {
    case 'PARTICIPATIONS':
      x = sql<SqlBool>`(${participationCount(db, now, account)}) >= ${r.min}`;
      break;
    case 'TOOK_PART':
      x = tookPartIn(db, now, account, r.dropId);
      break;
    case 'SECURED':
      x = sql<SqlBool>`${securedCount(db, account)} >= ${r.min}`;
      break;
    case 'SECURED_IN':
      x = securedIn(db, account, r.dropId);
      break;
    case 'TIER':
      x = sql<SqlBool>`coalesce((select te.tier from test_entrants as te where te.account_id = ${account}), ${tierSql(piecesHeld(db, account))}) in (${sql.join(r.tiers)})`; // a test entrant's tier: its test row (club.ts clubStandings)
      break;
    case 'OWNS_MODEL':
      x = sql<SqlBool>`(${exists(
        db
          .selectFrom('ownership as mo')
          .innerJoin('products as mp', 'mp.id', 'mo.product_id')
          .select('mo.id')
          .where('mo.account_id', '=', account)
          .where('mo.ended_at', 'is', null)
          .where('mp.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
          .where('mp.model_id', 'in', r.modelIds),
      )} or exists (select 1 from test_entrants as te where te.account_id = ${account}))`; // a test entrant owns the release's model (services/test-entrants.ts)
      break;
    case 'OWNS_COLLECTION':
      x = sql<SqlBool>`(${exists(
        db
          .selectFrom('ownership as co')
          .innerJoin('products as cp', 'cp.id', 'co.product_id')
          .innerJoin('models as cm', 'cm.id', 'cp.model_id')
          .select('co.id')
          .where('co.account_id', '=', account)
          .where('co.ended_at', 'is', null)
          .where('cp.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
          .where((w) => w(w.fn.coalesce('cp.collection_id', 'cm.collection_id'), 'in', r.collectionIds)),
      )} or exists (select 1 from test_entrants as te where te.account_id = ${account}))`; // a test entrant owns the release's collection (services/test-entrants.ts)
      break;
    case 'SIZE': {
      const sizes = sql.join(r.sizes);
      const held = db
        .selectFrom('ownership as so')
        .innerJoin('products as sp', 'sp.id', 'so.product_id')
        .select('so.id')
        .where('so.account_id', '=', account)
        .where('so.ended_at', 'is', null)
        .where('sp.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
        .where(sql<SqlBool>`upper(btrim(sp.variant)) in (${sizes})`);
      const entered = db.selectFrom('live_entries as ze').innerJoin('drop_sizes as zs', 'zs.id', 'ze.size_id').select('ze.id').where('ze.account_id', '=', account).where(sql<SqlBool>`upper(zs.label) in (${sizes})`);
      const said = db.selectFrom('live_interest as zi').innerJoin('drop_sizes as zz', 'zz.id', 'zi.size_id').select('zi.drop_id').where('zi.account_id', '=', account).where(sql<SqlBool>`upper(zz.label) in (${sizes})`);
      const ordered = db.selectFrom('orders as zo').select('zo.id').where('zo.account_id', '=', account).where(sql<SqlBool>`upper(btrim(zo.size_label)) in (${sizes})`);
      x = sql<SqlBool>`(${exists(held)} or ${exists(entered)} or ${exists(said)} or ${exists(ordered)})`;
      break;
    }
    case 'COUNTRY': {
      const latest = db
        .selectFrom('live_entries as ce')
        .select('ce.country')
        .where('ce.account_id', '=', account)
        .where('ce.country', 'is not', null)
        .orderBy('ce.joined_at', 'desc')
        .orderBy('ce.id')
        .limit(1);
      x = sql<SqlBool>`coalesce(nullif(upper(btrim(a.country)), ''), (${latest})) in (${sql.join(r.countries)})`;
      break;
    }
    case 'INTEREST':
      x = exists(db.selectFrom('live_interest as ii').select('ii.drop_id').where('ii.account_id', '=', account).$if(r.dropId !== null, (q) => q.where('ii.drop_id', '=', r.dropId!)));
      break;
    case 'ANSWER':
      x = exists(db.selectFrom('release_answers as ra').select('ra.drop_id').where('ra.account_id', '=', account).where('ra.drop_id', '=', r.dropId).where('ra.answer', '=', r.answer));
      break;
    case 'ACTIVE': {
      const since = new Date(now.getTime() - r.days * DAY_MS);
      const signedIn = db
        .selectFrom('audit_logs as al')
        .select('al.id')
        .where('al.action', '=', 'account.login')
        .where('al.target_type', '=', 'account')
        .where('al.target_id', '=', sql<string>`${account}::text`)
        .where('al.occurred_at', '>=', since);
      const session = db.selectFrom('sessions as ss').select('ss.subject_id').where('ss.subject_type', '=', 'account').where('ss.subject_id', '=', account).where('ss.last_seen_at', '>=', since);
      const scanned = db.selectFrom('scan_events as se').select('se.id').where('se.account_id', '=', account).where('se.occurred_at', '>=', since);
      x = sql<SqlBool>`(${exists(signedIn)} or ${exists(session)} or ${exists(scanned)})`;
      break;
    }
    case 'CITY':
      // On account_profiles_city_fold_idx (migration 0044): the city given, folded as the rule's are.
      x = sql<SqlBool>`exists (select 1 from account_profiles as pc where pc.account_id = ${account} and pc.city is not null and orbes_fold(pc.city) in (${sql.join(r.cities)}))`;
      break;
    case 'AGE': {
      // Its age today (Paris) within min and max: born after the latest date of birth of max + 1, at or before min's.
      const today = parisDay(now);
      x = sql<SqlBool>`exists (select 1 from account_profiles as pa where pa.account_id = ${account}
        and pa.birth_date > ${latestBirthDateForAge(today, r.max + 1)}::date and pa.birth_date <= ${latestBirthDateForAge(today, r.min)}::date)`;
      break;
    }
    case 'HEARD_FROM':
      x = sql<SqlBool>`exists (select 1 from account_profiles as ph where ph.account_id = ${account} and ph.heard_option_id in (${sql.join(r.optionIds.map((o) => sql`${o}::uuid`))}))`;
      break;
    case 'TAGGED':
      x = sql<SqlBool>`exists (select 1 from account_tags as tg where tg.account_id = ${account} and tg.tag in (${sql.join(r.tags)}))`;
      break;
    case 'WISHES_MODEL': {
      // On account_wishes_open: a main model named includes its variants' wishes, a variant only its own.
      const ids = sql.join(r.modelIds.map((m) => sql`${m}::uuid`));
      x = sql<SqlBool>`exists (select 1 from account_wishes as ww join models as wm on wm.id = ww.model_id
        where ww.account_id = ${account} and ww.removed_at is null and (ww.model_id in (${ids}) or wm.variant_of in (${ids})))`;
      break;
    }
    case 'WISHES_COLLECTION':
      // The model's collection now: a model moved takes its wishes with it (segments are read live).
      x = sql<SqlBool>`exists (select 1 from account_wishes as cw join models as cm on cm.id = cw.model_id
        where cw.account_id = ${account} and cw.removed_at is null and cm.collection_id in (${sql.join(r.collectionIds.map((c) => sql`${c}::uuid`))}))`;
      break;
    case 'FAVOURITE_PIECE':
    case 'FAVOURITE_FINISH': {
      const [kind, keys] = r.kind === 'FAVOURITE_PIECE' ? ['PIECE', r.pieces] : ['FINISH', r.finishes];
      x = sql<SqlBool>`exists (select 1 from account_tastes as ft where ft.account_id = ${account} and ft.kind = ${kind} and ft.value_key in (${sql.join(keys)}))`;
      break;
    }
    case 'VIEWED_MODEL':
    case 'VIEWED_RELEASE':
    case 'DEVICE':
    case 'PLACE':
      // Each on an index that leads with the account (collector_views_account_idx, tracking_device_accounts, collector_places).
      x = browsingCondition(r, account, now);
      break;
    case 'FIRST_SOURCE':
      // account_sources by its key, else the reports' fallback (Before tracking, Direct); never a test entrant.
      x = sql<SqlBool>`(${sourceFilter('a.id', r)} and ${notTestEntrant('a.id')})`;
      break;
    case 'LAST_SOURCE':
      x = sql<SqlBool>`(${lastSourceFilter('a.id', r, r.at)} and ${notTestEntrant('a.id')})`;
      break;
    case 'SCORE':
      // account_scores by its primary key: the score of the latest morning run. No row (created since, a test entrant,
      // DELETED): no match. A LOCKED account's frozen score still matches (members are ACTIVE accounts anyway).
      x = sql<SqlBool>`exists (select 1 from account_scores as sc where sc.account_id = ${account} and sc.score between ${r.min} and ${r.max})`;
      break;
  }
  return r.not ? sql<SqlBool>`not (${x})` : x;
}

function groupSql(db: Db, eb: Accounts, g: SegmentGroup, now: Date): Expression<SqlBool> {
  const parts = g.rules.map((r) => (isGroup(r) ? groupSql(db, eb, r, now) : ruleSql(db, eb, r, now)));
  return g.match === 'ALL' ? eb.and(parts) : eb.or(parts);
}

/** A tree as a condition on the account `a` of an outer query on `accounts as a` (services/live.ts accessAccounts). */
export function segmentCondition(db: Db, eb: ExpressionBuilder<any, any>, criteria: SegmentGroup, now: Date): Expression<SqlBool> {
  return groupSql(db, eb as unknown as Accounts, criteria, now);
}

/** The ACTIVE accounts a tree matches at `now`: a query on `accounts as a`, to count, list or narrow to one account. */
export function segmentMembers(db: Db, criteria: SegmentGroup, now: Date) {
  return db
    .selectFrom('accounts as a')
    .where('a.status', '=', 'ACTIVE')
    .where((eb) => groupSql(db, eb as unknown as Accounts, criteria, now));
}

/** Whether an account is a member of a segment at `now` (an unknown segment: no one). */
export async function isSegmentMember(db: Db, segmentId: string, accountId: string, now: Date): Promise<boolean> {
  const s = await db.selectFrom('segments').select('criteria').where('id', '=', segmentId).executeTakeFirst();
  if (!s) return false;
  const hit = await segmentMembers(db, cleanCriteria(s.criteria), now).select('a.id').where('a.id', '=', accountId).executeTakeFirst();
  return hit !== undefined;
}

/** The segments of `segmentIds` an account belongs to at `now`. */
export async function memberSegments(db: Db, accountId: string, segmentIds: readonly string[], now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  for (const sid of [...new Set(segmentIds)]) if (await isSegmentMember(db, sid, accountId, now)) out.add(sid);
  return out;
}

// ── Views ──────────────────────────────────────────────────────────────────

/** A segment in the console: its rule tree, its members now, and what uses it. */
export interface AdminSegment {
  id: string;
  name: string;
  criteria: SegmentGroup;
  /** Its members now, the test accounts left out. */
  count: number;
  /** The releases whose access rule it is, the posts of the circle whose audience it is. */
  usedBy: { releases: { id: string; title: string }[]; posts: { id: string; title: string }[] };
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
  updatedAt: Date;
}

/** A segment as a choice names it (a release's access rule, a post's audience): its id and name, never its members. */
export interface SegmentName {
  id: string;
  name: string;
}

/** The bounds of the builder's lists (§3.6 C.5.2): the most frequent, used or newest first. */
export const SEGMENT_OPTION_LIMITS = Object.freeze({ cities: 500, tags: 200, links: 500, places: 500 });

/** The kinds of first or last source the builder offers beside the channels and links (§3.6 C.5.2): no link's own. */
export const SEGMENT_SOURCE_KINDS = Object.freeze(['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'] as const satisfies readonly SourceKind[]);

/**
 * What the builder names: the releases (their question after for a LIVE one), models, collections, sizes and countries
 * known; and, for the customer intelligence lot's criteria (§3.6 C.5.2), each list bounded: the cities given (the most
 * frequent first, each as most often typed), the answers of « How did you hear about ORBES? » (set aside included), the
 * tags in use, the favourite pieces and finishes (the collection's, then the keys still held that it no longer
 * offers), the channels, the kinds of source, the links (archived ones too, the newest first), the places seen from in
 * the last 13 months and the device lists.
 */
export interface SegmentOptions {
  releases: { id: string; title: string; mode: 'DRAW' | 'LIVE'; opensAt: Date; answers: string[] | null }[];
  /** `variant` (NOCTURNE N1): the model's label among its variants, or null: a model and its variants share a name. */
  models: { id: string; name: string; type: string; variant: string | null }[];
  collections: { id: string; name: string }[];
  sizes: string[];
  countries: string[];
  cities: string[];
  heardOptions: { id: string; label: string; setAside: boolean }[];
  tags: { tag: string; accounts: number }[];
  tastes: {
    pieces: { key: string; label: string; retired: boolean }[];
    finishes: { key: string; label: string; swatch: string | null; retired: boolean }[];
  };
  channels: { id: string; name: string }[];
  sourceKinds: (typeof SEGMENT_SOURCE_KINDS)[number][];
  links: { id: string; name: string; channel: string; archived: boolean }[];
  places: { id: number; label: string }[];
  devices: { kinds: DeviceKind[]; systems: DeviceSystem[]; openedIn: OpenedIn[]; apps: InApp[] };
}

/** A place from the connection in words: « Paris, France », or its country alone. */
function placeLabel(country: string, city: string | null): string {
  const c = country === UNKNOWN_COUNTRY ? 'Unknown country' : countryName(country);
  return city ? `${city}, ${c}` : c;
}

/** A member as the CSV lists it; the route masks the email for an AUDITOR. */
export interface SegmentMember {
  accountId: string;
  /** As stored. */
  email: string;
  country: string | null;
  tier: number;
  pieces: number;
  participations: number;
  secured: number;
  createdAt: Date;
}

const segmentNotFound = () => notFound('Segment', 'SEGMENT_NOT_FOUND');
const nameTaken = () => conflict('SEGMENT_NAME_TAKEN', 'A segment already has this name.');
const inUse = () => conflict('SEGMENT_IN_USE', 'This segment is the access rule of a release or the audience of a post of the circle: choose another there first.');

function assertStaff(actor: Actor, what: string): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
  return actor.id.toLowerCase();
}

function knownSegment(v: unknown): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw segmentNotFound();
  return v.toLowerCase();
}

// ── Service ────────────────────────────────────────────────────────────────

export interface SegmentServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class SegmentService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: SegmentServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** Every segment, by name, each with its members now (never a test account) and what uses it. */
  async list(): Promise<AdminSegment[]> {
    const rows = await this.db.selectFrom('segments').selectAll().orderBy(sql`lower(name)`).orderBy('id').execute();
    return Promise.all(rows.map((r) => this.view(this.db, r)));
  }

  /** Every segment's id and name, by name: the choices a release's access rule and a post's audience offer, no count read. */
  async names(): Promise<SegmentName[]> {
    return this.db.selectFrom('segments').select(['id', 'name']).orderBy(sql`lower(name)`).orderBy('id').execute();
  }

  /** One segment (404 SEGMENT_NOT_FOUND). */
  async get(segmentId: string): Promise<AdminSegment> {
    const r = await this.db.selectFrom('segments').selectAll().where('id', '=', knownSegment(segmentId)).executeTakeFirst();
    if (!r) throw segmentNotFound();
    return this.view(this.db, r);
  }

  /** The members criteria being built would have now (the builder's live count, never a test account): checked as a save checks them. */
  async count(criteria: unknown): Promise<{ count: number }> {
    const tree = cleanCriteria(criteria);
    await this.checkNames(this.db, tree);
    return { count: await this.members(this.db, tree) };
  }

  /** What the builder names, each list bounded (SEGMENT_OPTION_LIMITS). */
  async options(): Promise<SegmentOptions> {
    const now = this.clock();
    // The places seen from within the longest window PLACE reads (the 13 months of the recording).
    const placesSince = addParisDays(parisDay(now), -(SEGMENT_LIMITS.viewDays.max - 1));
    const [releases, models, collections, sizes, countries, cities, heard, tags, offered, held, channels, links, places] = await Promise.all([
      this.db
        .selectFrom('drops')
        .select(['id', 'title', 'mode', 'opens_at', 'question_enabled', 'question_answers'])
        .where('parent_drop_id', 'is', null)
        .where('published_at', 'is not', null)
        .where('cancelled_at', 'is', null)
        .orderBy('opens_at', 'desc')
        .orderBy('id')
        .execute(),
      this.db.selectFrom('models').select(['id', 'name', 'type', 'variant_label as variant']).orderBy('name').orderBy('id').execute(),
      this.db.selectFrom('collections').select(['id', 'name']).orderBy('name').orderBy('id').execute(),
      sql<{ size: string }>`select size from (
          select upper(btrim(variant)) as size from products where variant is not null
          union select upper(label) from drop_sizes
          union select upper(btrim(size_label)) from orders where size_label is not null
        ) s where length(size) between 1 and ${SEGMENT_LIMITS.sizeLabel} order by size`.execute(this.db),
      sql<{ country: string }>`select country from (
          select upper(btrim(country)) as country from accounts where country is not null
          union select country from live_entries where country is not null
        ) c where country ~ '^[A-Z]{2}$' order by country`.execute(this.db),
      // The cities given, folded as CITY compares them, each shown as most often typed.
      sql<{ city: string }>`select (array_agg(city order by n desc, city collate "C"))[1] as city from (
          select orbes_fold(city) as folded, city, count(*) as n from account_profiles where city is not null group by orbes_fold(city), city
        ) c group by folded order by sum(n) desc, folded collate "C" limit ${SEGMENT_OPTION_LIMITS.cities}`.execute(this.db),
      this.db.selectFrom('heard_options').select(['id', 'label', 'active']).orderBy('position').orderBy('id').execute(),
      sql<{ tag: string; accounts: number }>`select tag, count(*)::int as accounts from account_tags group by tag order by accounts desc, tag limit ${SEGMENT_OPTION_LIMITS.tags}`.execute(this.db),
      tasteOptions(this.db),
      // The keys still held, each with its most recent label (the collection's own words win where it still offers it).
      sql<{ kind: 'PIECE' | 'FINISH'; value_key: string; label: string }>`select distinct on (kind, value_key) kind, value_key, label from account_tastes
          order by kind, value_key, created_at desc, label`.execute(this.db),
      this.db.selectFrom('link_channels').select(['id', 'name']).orderBy('position').orderBy(sql`lower(name)`).orderBy('id').execute(),
      this.db
        .selectFrom('links as l')
        .innerJoin('link_channels as c', 'c.id', 'l.channel_id')
        .select(['l.id', 'l.name', 'c.name as channel', 'l.archived_at'])
        .orderBy('l.created_at', 'desc')
        .orderBy('l.id')
        .limit(SEGMENT_OPTION_LIMITS.links)
        .execute(),
      sql<{ id: number; country: string; city: string | null }>`select gp.id, gp.country, gp.city from geo_places gp
          join (select place_id, count(*) as n from collector_places where last_day >= ${placesSince}::date group by place_id) cp on cp.place_id = gp.id
          order by cp.n desc, gp.country, gp.city nulls first, gp.id limit ${SEGMENT_OPTION_LIMITS.places}`.execute(this.db),
    ]);
    const retired = (kind: 'PIECE' | 'FINISH', current: readonly { key: string }[]) => {
      const keys = new Set(current.map((o) => o.key));
      return held.rows.filter((r) => r.kind === kind && !keys.has(r.value_key)).map((r) => ({ key: r.value_key, label: r.label, retired: true }));
    };
    return {
      releases: releases.map((d) => ({
        id: d.id,
        title: d.title,
        mode: d.mode,
        opensAt: d.opens_at,
        // A LIVE RELEASE asks its question after unless it was turned off: its own words, else the default question's.
        answers: d.mode === 'LIVE' && d.question_enabled !== false ? (d.question_answers ?? [...LIVE_QUESTION_DEFAULT.answers]) : null,
      })),
      models,
      collections,
      sizes: sizes.rows.map((r) => r.size),
      countries: countries.rows.map((r) => r.country),
      cities: cities.rows.map((r) => r.city),
      heardOptions: heard.map((o) => ({ id: o.id, label: o.label, setAside: !o.active })),
      tags: tags.rows.map((r) => ({ tag: r.tag, accounts: Number(r.accounts) })),
      tastes: {
        pieces: [...offered.pieces.map((o) => ({ key: o.key, label: o.label, retired: false })), ...retired('PIECE', offered.pieces)],
        finishes: [...offered.finishes.map((o) => ({ key: o.key, label: o.label, swatch: o.swatch, retired: false })), ...retired('FINISH', offered.finishes).map((r) => ({ ...r, swatch: null }))],
      },
      channels,
      sourceKinds: [...SEGMENT_SOURCE_KINDS],
      links: links.map((l) => ({ id: l.id, name: l.name, channel: l.channel, archived: l.archived_at !== null })),
      places: places.rows.map((r) => ({ id: Number(r.id), label: placeLabel(r.country, r.city) })),
      devices: { kinds: [...DEVICE_KINDS], systems: [...DEVICE_SYSTEMS], openedIn: [...OPENED_IN], apps: [...IN_APPS] },
    };
  }

  /** A new segment (OPERATOR): a name no other has, whatever the case, and its criteria. Audited `segment.create`. */
  async create(input: { name: unknown; criteria: unknown }, actor: Actor): Promise<AdminSegment> {
    const admin = assertStaff(actor, 'create a segment');
    const name = cleanSegmentName(input?.name);
    const criteria = cleanCriteria(input?.criteria);
    return inTransaction(this.db, async (tx) => {
      await this.checkNames(tx, criteria);
      const now = this.clock();
      let row: SegmentRow;
      try {
        row = await tx
          .insertInto('segments')
          .values({ name, criteria: jsonText(criteria), created_by: admin, created_at: now, updated_at: now })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
      await this.audit.record({ actor, action: 'segment.create', targetType: 'segment', targetId: row.id, details: { name, criteria: criteria as unknown as JsonObject } }, tx);
      return this.view(tx, row);
    });
  }

  /** Its name, its criteria, or both (OPERATOR). Audited `segment.update` with each before and after; nothing changed, nothing written. */
  async update(segmentId: string, change: { name?: unknown; criteria?: unknown }, actor: Actor): Promise<AdminSegment> {
    assertStaff(actor, 'change a segment');
    const sid = knownSegment(segmentId);
    const name = change?.name !== undefined ? cleanSegmentName(change.name) : undefined;
    const criteria = change?.criteria !== undefined ? cleanCriteria(change.criteria) : undefined;
    return inTransaction(this.db, async (tx) => {
      const s = await tx.selectFrom('segments').selectAll().where('id', '=', sid).forUpdate().executeTakeFirst();
      if (!s) throw segmentNotFound();
      if (criteria) await this.checkNames(tx, criteria);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (name !== undefined && name !== s.name) {
        before.name = s.name;
        after.name = name;
      }
      if (criteria && JSON.stringify(criteria) !== JSON.stringify(cleanCriteria(s.criteria))) {
        before.criteria = s.criteria;
        after.criteria = criteria;
      }
      if (Object.keys(after).length === 0) return this.view(tx, s);
      const now = this.clock();
      let row: SegmentRow;
      try {
        row = await tx
          .updateTable('segments')
          .set({ ...(after.name ? { name: after.name as string } : {}), ...(after.criteria ? { criteria: jsonText(criteria) } : {}), updated_at: now })
          .where('id', '=', sid)
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
      await this.audit.record({ actor, action: 'segment.update', targetType: 'segment', targetId: sid, details: { before, after } as JsonObject }, tx);
      return this.view(tx, row);
    });
  }

  /** Delete a segment no release and no post of the circle uses (409 SEGMENT_IN_USE). Audited `segment.delete`. */
  async remove(segmentId: string, actor: Actor): Promise<void> {
    assertStaff(actor, 'delete a segment');
    const sid = knownSegment(segmentId);
    await inTransaction(this.db, async (tx) => {
      const s = await tx.selectFrom('segments').selectAll().where('id', '=', sid).forUpdate().executeTakeFirst();
      if (!s) throw segmentNotFound();
      const used = await this.usedBy(tx, sid);
      if (used.releases.length + used.posts.length > 0) throw inUse();
      await tx.deleteFrom('segments').where('id', '=', sid).execute();
      await this.audit.record({ actor, action: 'segment.delete', targetType: 'segment', targetId: sid, details: { name: s.name, criteria: s.criteria } }, tx);
    });
  }

  /** A segment's members now (never a test account), by email, as a CSV (RFC 4180); `email` writes each as the caller may read it. */
  async csv(segmentId: string, view: { email: (stored: string) => string }): Promise<{ filename: string; contentType: string; body: string }> {
    const s = await this.get(segmentId);
    const rows = await this.memberRows(s.criteria);
    const body = csvDocument([
      ['email', 'country', 'tier', 'pieces held', 'releases taken part in', 'pieces secured', 'account created'],
      ...rows.map((m) => [view.email(m.email), m.country ?? '', String(m.tier), String(m.pieces), String(m.participations), String(m.secured), m.createdAt.toISOString()]),
    ]);
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'segment';
    return { filename: `orbes-segment-${slug}.csv`, contentType: CSV_CONTENT_TYPE, body };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The members the console counts: never a test account. */
  private async members(db: Db, criteria: SegmentGroup): Promise<number> {
    const r = await segmentMembers(db, criteria, this.clock()).where(sql<SqlBool>`${notTestEntrant('a.id')}`).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** The members with what the CSV says of each, by email: never a test account. */
  private async memberRows(criteria: SegmentGroup): Promise<SegmentMember[]> {
    const now = this.clock();
    const db = this.db;
    const rows = await segmentMembers(db, criteria, now)
      .where(sql<SqlBool>`${notTestEntrant('a.id')}`)
      .select((eb) => [
        'a.id',
        'a.email',
        'a.country',
        'a.created_at',
        piecesHeld(db, eb.ref('a.id')).as('pieces'),
        participationCount(db, now, eb.ref('a.id')).as('participations'),
        securedCount(db, eb.ref('a.id')).as('secured'),
      ])
      .orderBy('a.email_normalized')
      .orderBy('a.id')
      .execute();
    return rows.map((r) => {
      const pieces = Number(r.pieces);
      return {
        accountId: r.id,
        email: r.email,
        country: r.country?.trim() || null,
        tier: CLUB_TIER_THRESHOLDS.filter((t) => pieces >= t).length,
        pieces,
        participations: Number(r.participations),
        secured: Number(r.secured),
        createdAt: r.created_at,
      };
    });
  }

  /**
   * The releases, models, collections, links, channels and answers of « How did you hear about ORBES? » the criteria name exist (404
   * otherwise); an answer to the question after is one of its release's. Tags are free, and favourite pieces and
   * finishes are never checked against the catalogue of the day: a segment on a key no longer offered still runs; nor
   * are the places seen from (one no longer seen matches nobody).
   */
  private async checkNames(db: Db, criteria: SegmentGroup): Promise<void> {
    const rules = segmentRules(criteria);
    const drops = [...new Set(rules.flatMap((r) => ('dropId' in r && r.dropId ? [r.dropId] : [])))];
    const models = [...new Set(rules.flatMap((r) => (r.kind === 'OWNS_MODEL' || r.kind === 'WISHES_MODEL' || r.kind === 'VIEWED_MODEL' ? r.modelIds : [])))];
    const collections = [...new Set(rules.flatMap((r) => (r.kind === 'OWNS_COLLECTION' || r.kind === 'WISHES_COLLECTION' ? r.collectionIds : [])))];
    if (drops.length) {
      const found = await db.selectFrom('drops').select(['id', 'mode', 'question_enabled', 'question_answers']).where('id', 'in', drops).where('parent_drop_id', 'is', null).execute();
      if (found.length !== drops.length) throw notFound('Release', 'DROP_NOT_FOUND');
      for (const r of rules) {
        if (r.kind !== 'ANSWER' && r.kind !== 'INTEREST') continue;
        const d = found.find((x) => x.id === r.dropId);
        if (!d) continue;
        if (d.mode !== 'LIVE') throw validationError(r.kind === 'ANSWER' ? 'Only a LIVE RELEASE asks a question after.' : 'I’LL BE THERE is said to a LIVE RELEASE.');
        if (r.kind === 'ANSWER') {
          const answers = d.question_answers ?? LIVE_QUESTION_DEFAULT.answers;
          if (d.question_enabled === false || r.answer > answers.length) throw validationError('Choose one of the answers of that release’s question after.');
        }
      }
    }
    if (models.length && (await db.selectFrom('models').select('id').where('id', 'in', models).execute()).length !== models.length) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (collections.length && (await db.selectFrom('collections').select('id').where('id', 'in', collections).execute()).length !== collections.length) {
      throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    }
    // A link archived and a channel still exist: a segment naming one keeps matching.
    const links = [...new Set(rules.flatMap((r) => ((r.kind === 'FIRST_SOURCE' || r.kind === 'LAST_SOURCE') && r.linkIds ? r.linkIds : [])))];
    if (links.length && (await db.selectFrom('links').select('id').where('id', 'in', links).execute()).length !== links.length) throw notFound('Link', 'LINK_NOT_FOUND');
    const channels = [...new Set(rules.flatMap((r) => ((r.kind === 'FIRST_SOURCE' || r.kind === 'LAST_SOURCE') && r.channelIds ? r.channelIds : [])))];
    if (channels.length && (await db.selectFrom('link_channels').select('id').where('id', 'in', channels).execute()).length !== channels.length) throw notFound('Channel', 'CHANNEL_NOT_FOUND');
    // An answer set aside still exists: a segment on it keeps matching those who gave it.
    const heard = [...new Set(rules.flatMap((r) => (r.kind === 'HEARD_FROM' ? r.optionIds : [])))];
    if (heard.length && (await db.selectFrom('heard_options').select('id').where('id', 'in', heard).execute()).length !== heard.length) throw notFound('Answer', 'HEARD_OPTION_NOT_FOUND');
  }

  private async usedBy(db: Db, sid: string): Promise<AdminSegment['usedBy']> {
    const [releases, posts] = await Promise.all([
      db.selectFrom('drops').select(['id', 'title']).where('access_segment_id', '=', sid).orderBy('opens_at', 'desc').orderBy('id').execute(),
      db.selectFrom('circle_posts').select(['id', 'title']).where('segment_id', '=', sid).orderBy('created_at', 'desc').orderBy('id').execute(),
    ]);
    return { releases, posts };
  }

  private async view(db: Db, r: SegmentRow): Promise<AdminSegment> {
    const criteria = cleanCriteria(r.criteria);
    const [count, usedBy, creator] = await Promise.all([
      this.members(db, criteria),
      this.usedBy(db, r.id),
      r.created_by ? db.selectFrom('admin_users').select(['id', 'email']).where('id', '=', r.created_by).executeTakeFirst() : undefined,
    ]);
    return { id: r.id, name: r.name, criteria, count, usedBy, createdAt: r.created_at, createdBy: creator ?? null, updatedAt: r.updated_at };
  }
}

