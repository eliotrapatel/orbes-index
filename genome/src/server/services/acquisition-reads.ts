/**
 * Where a collector came from, read for one account or a page of them (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4
 * A.10.5, A.10.6, §3.0 (h) and (k), step 4.10), offered by AcquisitionService. Reads only; nothing is audited here (the
 * right-of-access export audits itself, `account.export`).
 *
 *   originOf        the client sheet's Origin block (§3.6 C.4.4, read through GET /api/admin/owners/:id/intelligence,
 *                   phase 5): the first visit (its time and source), the source the sign-up came through, and the source
 *                   the latest purchase came through with its reference. Every role reads it (§3.0 (h)): a source names
 *                   no person and no city.
 *   exportColumns   the Collectors export's acquisition columns (A.10.6, §3.6 C.7 columns 36 to 48 and 50), set-based,
 *                   ACQUISITION_EXPORT_CHUNK accounts a round. Counted collectors only (§3.0 (d)): a test entrant, a
 *                   team account or a DELETED account gets no row.
 *   exportedOrigin  the right of access's `origin` (§3.0 (k)): the first source, the sign-up's last link and each order's
 *                   last link, in words; nothing of the score, tags or notes, and never who on staff made a link.
 *
 * The rules are the reports' (services/acquisition-report.ts, §3.4 A.5): a collector's first source is its
 * `account_sources` row; without one, Before tracking for an account made before the recording started (or with no
 * recording yet), else Direct (the conversions job's safety net writes it within minutes). An act's last link is its
 * conversion's; without one, Before tracking when its row was written before the recording started, else Direct. A
 * purchase is GROWTH's: paid, never GIFT, not CANCELLED nor RETURNED.
 *
 * A source in words (A.10.5): a link's name (with its channel), a campaign's tags « instagram / story / drop-14 », a
 * site's host, « Direct », « Before tracking », « Console device ».
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { SourceKind } from '../db/schema.js';
import { notFound } from '../errors.js';
import { UUID_RE } from '../http/schemas.js';
import { orderReference } from './orders.js';
import { countedCollector } from './population.js';

/** The accounts one round of exportColumns reads. */
export const ACQUISITION_EXPORT_CHUNK = 500;

/** The words of the sources no link, tag or site names (as the Links page says them, web/admin/model/links.ts). */
export const SOURCE_WORDS: Readonly<Record<'DIRECT' | 'BEFORE' | 'STAFF', string>> = Object.freeze({
  DIRECT: 'Direct',
  BEFORE: 'Before tracking',
  STAFF: 'Console device',
});

/** A source as the client sheet shows it (A.10.5): its kind, its words, a link's channel and id (its name opens its page). */
export interface OriginSource {
  kind: SourceKind;
  label: string;
  channel: string | null;
  linkId: string | null;
}

/**
 * The client sheet's Origin block (A.10.5, §3.6 C.4.4). `firstVisit.at` is null when no first visit is recorded (Before
 * tracking, or Direct until the job writes it); `lastOrder` null: « No purchase ».
 */
export interface OriginOf {
  firstVisit: { at: Date | null; source: OriginSource };
  signUp: { at: Date; source: OriginSource };
  lastOrder: { orderId: string; reference: string; paidAt: Date; source: OriginSource } | null;
}

/** The acquisition columns of the Collectors export, in their order (§3.6 C.7 places them among its 76). */
export const ACQUISITION_EXPORT_COLUMNS = [
  'first_visit_at',
  'first_source_kind',
  'first_link',
  'first_channel',
  'first_utm_source',
  'first_utm_medium',
  'first_utm_campaign',
  'first_site',
  'signup_source_kind',
  'signup_link',
  'signup_channel',
  'signup_utm_campaign',
  'signup_site',
  'latest_purchase_link',
] as const;
export type AcquisitionExportColumn = (typeof ACQUISITION_EXPORT_COLUMNS)[number];

/** One collector's acquisition columns: empty text where a source has no such part (a Direct first source has no link). */
export interface AcquisitionExportRow {
  /** The first visit's time (`account_sources.first_seen_at`); null when none is recorded. */
  first_visit_at: Date | null;
  first_source_kind: SourceKind;
  first_link: string;
  first_channel: string;
  first_utm_source: string;
  first_utm_medium: string;
  first_utm_campaign: string;
  first_site: string;
  signup_source_kind: SourceKind;
  signup_link: string;
  signup_channel: string;
  signup_utm_campaign: string;
  signup_site: string;
  /** The latest purchase's last link in words (a link's name, a campaign's tags, a site, Direct, Before tracking); empty without a purchase. */
  latest_purchase_link: string;
}

/**
 * The right of access's `origin` (§3.0 (k)): where the account first came from and through what its sign-up and each
 * order came, in words. `at` null: none recorded (the words then are the fallback, Before tracking or Direct). The
 * orders are those with a recorded last link, oldest first, each at its moment (§3.4 A.5).
 */
export interface ExportedOrigin {
  firstVisit: { at: Date | null; kind: SourceKind; source: string; channel: string | null };
  signUp: { at: Date | null; kind: SourceKind; source: string; channel: string | null };
  orders: { order: string; at: Date; kind: SourceKind; source: string; channel: string | null }[];
}

/** A source's row with what its words need. */
interface SourceRow {
  id: number;
  kind: SourceKind;
  link_id: string | null;
  link_name: string | null;
  channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  site: string | null;
}

/** A source in words (A.10.5). */
export function sourceWords(s: Pick<SourceRow, 'kind' | 'link_name' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'site'>): string {
  switch (s.kind) {
    case 'LINK':
      return s.link_name ?? 'A link';
    case 'CAMPAIGN':
      return [s.utm_source, s.utm_medium, s.utm_campaign].filter((t): t is string => t !== null && t !== '').join(' / ') || 'Campaign tags';
    case 'SITE':
      return s.site ?? 'A site';
    default:
      return SOURCE_WORDS[s.kind];
  }
}

const originSource = (s: SourceRow): OriginSource => ({ kind: s.kind, label: sourceWords(s), channel: s.channel, linkId: s.link_id });

/** The recording's start (far in the future without one: everything reads Before tracking) and the BEFORE and DIRECT ids. */
async function basisOf(db: Db): Promise<{ started: Date; before: number; direct: number }> {
  const state = await db.selectFrom('acquisition_state').select('tracking_started_at').where('id', '=', 1).executeTakeFirst();
  const fixed = await db.selectFrom('acquisition_sources').select(['key', 'id']).where('key', 'in', ['BEFORE', 'DIRECT']).execute();
  const id = (k: string) => fixed.find((f) => f.key === k)?.id ?? 0;
  return { started: state?.tracking_started_at ?? new Date('9999-12-31T00:00:00.000Z'), before: id('BEFORE'), direct: id('DIRECT') };
}

/** The sources by id, with their link's name and channel. The fallbacks (BEFORE, DIRECT) are read even when unused. */
async function sourcesById(db: Db, ids: Iterable<number>): Promise<Map<number, SourceRow>> {
  const wanted = [...new Set([...ids].filter((x) => Number.isInteger(x) && x > 0))];
  if (wanted.length === 0) return new Map();
  const rows = await sql<SourceRow>`
    SELECT s.id, s.kind, s.link_id, l.name AS link_name, c.name AS channel, s.utm_source, s.utm_medium, s.utm_campaign, s.site
      FROM acquisition_sources s
      LEFT JOIN links l ON l.id = s.link_id
      LEFT JOIN link_channels c ON c.id = l.channel_id
     WHERE s.id IN (${sql.join(wanted.map((x) => sql`${x}::integer`))})`.execute(db);
  return new Map(rows.rows.map((r) => [Number(r.id), { ...r, id: Number(r.id) }]));
}

/** A source row that must exist; a missing fixed source (no `prepare` yet) reads as its kind alone. */
function sourceOr(map: Map<number, SourceRow>, id: number, kind: SourceKind): SourceRow {
  return map.get(id) ?? { id, kind, link_id: null, link_name: null, channel: null, utm_source: null, utm_medium: null, utm_campaign: null, site: null };
}

/** The account's first source, its sign-up's and its latest purchase's last link, as ids (the fallbacks applied). */
async function originIds(
  db: Db,
  accountIds: readonly string[],
  b: { started: Date; before: number; direct: number },
): Promise<
  Map<
    string,
    {
      createdAt: Date;
      firstAt: Date | null;
      first: number;
      firstKind: SourceKind;
      signup: number;
      signupKind: SourceKind;
      /** The SIGNUP conversion's moment; null while none is recorded. */
      signupAt: Date | null;
      order: { id: string; paidAt: Date; source: number; kind: SourceKind } | null;
    }
  >
> {
  const fallback = (at: string) => sql`(CASE WHEN ${sql.ref(at)} < ${b.started}::timestamptz THEN ${b.before}::integer ELSE ${b.direct}::integer END)`;
  const fallbackKind = (at: string) => sql`(CASE WHEN ${sql.ref(at)} < ${b.started}::timestamptz THEN 'BEFORE' ELSE 'DIRECT' END)`;
  const rows = await sql<{
    id: string;
    created_at: Date;
    first_at: Date | null;
    first: number;
    first_kind: SourceKind;
    signup: number;
    signup_kind: SourceKind;
    signup_at: Date | null;
    order_id: string | null;
    paid_at: Date | null;
    order_src: number | null;
    order_kind: SourceKind | null;
  }>`
    SELECT a.id, a.created_at, s.first_seen_at AS first_at,
           coalesce(s.first_source_id, ${fallback('a.created_at')}) AS first,
           coalesce(fk.kind, ${fallbackKind('a.created_at')}) AS first_kind,
           coalesce(c.last_source_id, ${fallback('a.created_at')}) AS signup,
           coalesce(ck.kind, ${fallbackKind('a.created_at')}) AS signup_kind, c.at AS signup_at,
           lo.id AS order_id, lo.paid_at, lo.src AS order_src, lo.kind AS order_kind
      FROM accounts a
      LEFT JOIN account_sources s ON s.account_id = a.id
      LEFT JOIN acquisition_sources fk ON fk.id = s.first_source_id
      LEFT JOIN acquisition_conversions c ON c.kind = 'SIGNUP' AND c.ref_id = a.id
      LEFT JOIN acquisition_sources ck ON ck.id = c.last_source_id
      LEFT JOIN LATERAL (
        SELECT o.id, o.paid_at, coalesce(oc.last_source_id, ${fallback('o.reserved_at')}) AS src, coalesce(ok.kind, ${fallbackKind('o.reserved_at')}) AS kind
          FROM orders o
          LEFT JOIN acquisition_conversions oc ON oc.kind = 'ORDER' AND oc.ref_id = o.id
          LEFT JOIN acquisition_sources ok ON ok.id = oc.last_source_id
         WHERE o.account_id = a.id AND o.paid_at IS NOT NULL AND o.channel <> 'GIFT' AND o.status NOT IN ('CANCELLED', 'RETURNED')
         ORDER BY o.paid_at DESC, o.id DESC LIMIT 1) lo ON TRUE
     WHERE a.id IN (${sql.join(accountIds.map((x) => sql`${x}::uuid`))})`.execute(db);
  return new Map(
    rows.rows.map((r) => [
      r.id,
      {
        createdAt: r.created_at,
        firstAt: r.first_at,
        first: Number(r.first),
        firstKind: r.first_kind,
        signup: Number(r.signup),
        signupKind: r.signup_kind,
        signupAt: r.signup_at,
        order: r.order_id ? { id: r.order_id, paidAt: r.paid_at!, source: Number(r.order_src), kind: r.order_kind! } : null,
      },
    ]),
  );
}

/** The client sheet's Origin block of one account (A.10.5); 404 ACCOUNT_NOT_FOUND for an account that does not exist. */
export async function originOf(db: Db, accountId: string): Promise<OriginOf> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const b = await basisOf(db);
  const o = (await originIds(db, [accountId.toLowerCase()], b)).get(accountId.toLowerCase());
  if (!o) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const sources = await sourcesById(db, [o.first, o.signup, ...(o.order ? [o.order.source] : [])]);
  return {
    firstVisit: { at: o.firstAt, source: originSource(sourceOr(sources, o.first, o.firstKind)) },
    signUp: { at: o.createdAt, source: originSource(sourceOr(sources, o.signup, o.signupKind)) },
    lastOrder: o.order ? { orderId: o.order.id, reference: orderReference(o.order.id), paidAt: o.order.paidAt, source: originSource(sourceOr(sources, o.order.source, o.order.kind)) } : null,
  };
}

/**
 * The Collectors export's acquisition columns per account (A.10.6), ACQUISITION_EXPORT_CHUNK accounts a round of two
 * set-based queries. Counted collectors only (§3.0 (d)).
 */
export async function exportColumns(db: Db, accountIds: readonly string[]): Promise<Map<string, AcquisitionExportRow>> {
  const out = new Map<string, AcquisitionExportRow>();
  const wanted = [...new Set(accountIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()))];
  if (wanted.length === 0) return out;
  const b = await basisOf(db);
  for (let i = 0; i < wanted.length; i += ACQUISITION_EXPORT_CHUNK) {
    const chunk = wanted.slice(i, i + ACQUISITION_EXPORT_CHUNK);
    const counted = (await sql<{ id: string }>`SELECT a.id FROM accounts a WHERE a.id IN (${sql.join(chunk.map((x) => sql`${x}::uuid`))}) AND ${countedCollector('a.id')}`.execute(db)).rows.map((r) => r.id);
    if (counted.length === 0) continue;
    const origins = await originIds(db, counted, b);
    const sources = await sourcesById(db, [...origins.values()].flatMap((o) => [o.first, o.signup, ...(o.order ? [o.order.source] : [])]));
    for (const id of counted) {
      const o = origins.get(id);
      if (!o) continue;
      const first = sourceOr(sources, o.first, o.firstKind);
      const signup = sourceOr(sources, o.signup, o.signupKind);
      out.set(id, {
        first_visit_at: o.firstAt,
        first_source_kind: first.kind,
        first_link: first.kind === 'LINK' ? (first.link_name ?? '') : '',
        first_channel: first.channel ?? '',
        first_utm_source: first.utm_source ?? '',
        first_utm_medium: first.utm_medium ?? '',
        first_utm_campaign: first.utm_campaign ?? '',
        first_site: first.site ?? '',
        signup_source_kind: signup.kind,
        signup_link: signup.kind === 'LINK' ? (signup.link_name ?? '') : '',
        signup_channel: signup.channel ?? '',
        signup_utm_campaign: signup.utm_campaign ?? '',
        signup_site: signup.site ?? '',
        latest_purchase_link: o.order ? sourceWords(sourceOr(sources, o.order.source, o.order.kind)) : '',
      });
    }
  }
  return out;
}

/** The right of access's `origin` of one account (§3.0 (k)), read in the export's transaction `db`. */
export async function exportedOrigin(db: Db, accountId: string): Promise<ExportedOrigin> {
  const b = await basisOf(db);
  const o = (await originIds(db, [accountId], b)).get(accountId);
  const orders = await sql<{ id: string; at: Date; source: number }>`
    SELECT c.ref_id AS id, c.at, c.last_source_id AS source FROM acquisition_conversions c
     WHERE c.account_id = ${accountId}::uuid AND c.kind = 'ORDER'
     ORDER BY c.at, c.id`.execute(db);
  const first = o?.first ?? b.before;
  const signup = o?.signup ?? b.before;
  const sources = await sourcesById(db, [first, signup, ...orders.rows.map((r) => Number(r.source))]);
  const said = (id: number, kind: SourceKind) => {
    const s = sourceOr(sources, id, kind);
    return { kind: s.kind, source: sourceWords(s), channel: s.channel };
  };
  return {
    firstVisit: { at: o?.firstAt ?? null, ...said(first, o?.firstKind ?? 'BEFORE') },
    signUp: { at: o?.signupAt ?? null, ...said(signup, o?.signupKind ?? 'BEFORE') },
    orders: orders.rows.map((r) => ({ order: orderReference(r.id), at: r.at, ...said(Number(r.source), 'DIRECT') })),
  };
}

/** What a right-of-access `origin` holds, for `account.export`'s counts: the first source and the last links recorded. */
export const exportedOriginCount = (o: ExportedOrigin): number => (o.firstVisit.at !== null ? 1 : 0) + (o.signUp.at !== null ? 1 : 0) + o.orders.length;
