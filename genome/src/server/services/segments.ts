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
 * A segment's `criteria` is a rule tree: a group (`match` ALL or ANY of its rules) whose rules are criteria or groups of
 * criteria (one level down: SEGMENT_LIMITS.depth); any criterion may be negated (`not`). Its members are the ACTIVE
 * accounts it matches, evaluated live, never stored: wherever it decides something (a release's access rule,
 * services/live.ts; the audience of a post of the circle, services/circle.ts), at the moment it decides.
 *
 * The console (routes/admin/segments.ts): the list with each segment's count now and what uses it, the builder's
 * options (the releases, models, collections, sizes and countries it names), the live count of criteria being built
 * (OPERATOR), a segment's members as a CSV (the routes mask the emails for an AUDITOR), created, changed and deleted by
 * an OPERATOR. Audited `segment.create`, `segment.update` (before and after), `segment.delete`; a segment that a release
 * or a post of the circle uses is never deleted (409 SEGMENT_IN_USE). Its name is the console's: the public never reads
 * it (a release says FOR SELECTED COLLECTORS, decision 32).
 */
import { sql, type Expression, type ExpressionBuilder, type RawBuilder, type SqlBool } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { jsonText, type Database, type JsonObject, type SegmentRow } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_THRESHOLDS } from './club.js';
import { LIVE_QUESTION_DEFAULT } from './live.js';
import { participationCount, securedCount, securedIn, tookPartIn } from './participation.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** Every criterion, by its group (the four of choice 27, in their order). */
export const SEGMENT_CRITERIA = Object.freeze({
  RELEASES: Object.freeze(['PARTICIPATIONS', 'TOOK_PART', 'SECURED', 'SECURED_IN'] as const),
  CLUB: Object.freeze(['TIER', 'OWNS_MODEL', 'OWNS_COLLECTION'] as const),
  PROFILE: Object.freeze(['SIZE', 'COUNTRY'] as const),
  SIGNALS: Object.freeze(['INTEREST', 'ANSWER', 'ACTIVE'] as const),
});
export type SegmentCriterionGroup = keyof typeof SEGMENT_CRITERIA;
export const SEGMENT_RULE_KINDS = Object.freeze([...SEGMENT_CRITERIA.RELEASES, ...SEGMENT_CRITERIA.CLUB, ...SEGMENT_CRITERIA.PROFILE, ...SEGMENT_CRITERIA.SIGNALS] as const);
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
      x = exists(
        db
          .selectFrom('ownership as mo')
          .innerJoin('products as mp', 'mp.id', 'mo.product_id')
          .select('mo.id')
          .where('mo.account_id', '=', account)
          .where('mo.ended_at', 'is', null)
          .where('mp.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
          .where('mp.model_id', 'in', r.modelIds),
      );
      break;
    case 'OWNS_COLLECTION':
      x = exists(
        db
          .selectFrom('ownership as co')
          .innerJoin('products as cp', 'cp.id', 'co.product_id')
          .innerJoin('models as cm', 'cm.id', 'cp.model_id')
          .select('co.id')
          .where('co.account_id', '=', account)
          .where('co.ended_at', 'is', null)
          .where('cp.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
          .where((w) => w(w.fn.coalesce('cp.collection_id', 'cm.collection_id'), 'in', r.collectionIds)),
      );
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
  /** Its members now. */
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

/** What the builder names: the releases (their question after for a LIVE one), models, collections, sizes and countries known. */
export interface SegmentOptions {
  releases: { id: string; title: string; mode: 'DRAW' | 'LIVE'; opensAt: Date; answers: string[] | null }[];
  /** `variant` (NOCTURNE N1): the model's label among its variants, or null: a model and its variants share a name. */
  models: { id: string; name: string; type: string; variant: string | null }[];
  collections: { id: string; name: string }[];
  sizes: string[];
  countries: string[];
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

  /** Every segment, by name, each with its members now and what uses it. */
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

  /** The members criteria being built would have now (the builder's live count): checked as a save checks them. */
  async count(criteria: unknown): Promise<{ count: number }> {
    const tree = cleanCriteria(criteria);
    await this.checkNames(this.db, tree);
    return { count: await this.members(this.db, tree) };
  }

  /** What the builder names. */
  async options(): Promise<SegmentOptions> {
    const [releases, models, collections, sizes, countries] = await Promise.all([
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
    ]);
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

  /** A segment's members now, by email, as a CSV (RFC 4180); `email` writes each as the caller may read it. */
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

  private async members(db: Db, criteria: SegmentGroup): Promise<number> {
    const r = await segmentMembers(db, criteria, this.clock()).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** The members with what the CSV says of each, by email. */
  private async memberRows(criteria: SegmentGroup): Promise<SegmentMember[]> {
    const now = this.clock();
    const db = this.db;
    const rows = await segmentMembers(db, criteria, now)
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

  /** The releases, models and collections the criteria name exist (404 otherwise); an answer is one of its release's. */
  private async checkNames(db: Db, criteria: SegmentGroup): Promise<void> {
    const rules = segmentRules(criteria);
    const drops = [...new Set(rules.flatMap((r) => ('dropId' in r && r.dropId ? [r.dropId] : [])))];
    const models = [...new Set(rules.flatMap((r) => (r.kind === 'OWNS_MODEL' ? r.modelIds : [])))];
    const collections = [...new Set(rules.flatMap((r) => (r.kind === 'OWNS_COLLECTION' ? r.collectionIds : [])))];
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

