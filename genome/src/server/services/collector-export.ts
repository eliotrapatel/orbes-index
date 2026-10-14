/**
 * The Collectors export (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.7, step 9.12): one CSV row per counted
 * collector with everything held about them, read by CollectorInsightsService.exportCsv (ADMIN, audited
 * `collectors.export`; GET /api/admin/collectors/export.csv).
 *
 *   COLLECTOR_EXPORT_COLUMNS   the 76 columns of version 1 (COLLECTOR_EXPORT_VERSION), in their order: the account and
 *                   its profile (§3.1), the default address (H2's address book), the tastes and the wishlist (§3.2 W.9),
 *                   the tags (§3.6 C.4.3), the club and the purchases, the releases, where they came from (§3.4 A.10.6,
 *                   acquisition-reads.ts exportColumns), what they looked at, their devices and places (§3.3 T.4.4,
 *                   tracking-reads.ts exportColumns), the engagement score and its parts (§3.5), active now. A change of
 *                   columns raises the version (the audit's `columns`) and is listed in API.md.
 *   exportIds       the collectors of the page's five filters (insights-scope.ts scopeCte with the scope ALL: counted
 *                   collectors only, §3.0 (d): no test entrant, no team account, no DELETED account), by keyset on
 *                   `accounts.id`, COLLECTOR_EXPORT_BATCH at a time.
 *   exportBatch     a batch's rows, each column group read set-based for the whole batch.
 *   exportDocument  every batch read into CSV lines (core/render/csv.ts csvField: RFC 4180, every field quoted, a
 *                   formula sign neutralised), the header first. Nothing is written to disk.
 *
 * What is not exported: Segments (each has its own CSV), the private notes (free text, read on the sheet: question 19),
 * the team's and the test entrants' accounts. Dates are Paris time, `2026-10-08 14:02` (schedule.ts parisDateTime), and
 * each date column says « (Paris) ». Reads only: the caller's transaction is read-only.
 */
import { sql } from 'kysely';
import { uuidArray, type Db } from '../db/connection.js';
import { CLUB_TIER_NAMES, type TasteKind } from '../db/schema.js';
import { csvField } from '../render/csv.js';
import { ageOn, completion } from '../../shared/profile-rules.js';
import { exportColumns as acquisitionColumns } from './acquisition-reads.js';
import { CLUB_EXCLUDED_STATUSES, tierForPieces } from './club.js';
import { purchaseRows } from './growth.js';
import { activeIn, plusDays, scopeCte, type InsightsFilters } from './insights-scope.js';
import { participationRows } from './participation.js';
import { parisDateTime, parisDay, parisDayStart } from './schedule.js';
import { tasteOptions, tastesOf, type TasteOptions } from './tastes.js';
import { exportColumns as trackingColumns } from './tracking-reads.js';

/** The export's columns, version 1 (§3.6 C.7), in their order. */
export const COLLECTOR_EXPORT_COLUMNS = [
  'account id',
  'email',
  'first name',
  'last name',
  'display name',
  'status',
  'account created (Paris)',
  'country',
  'city',
  'phone',
  'phone country',
  'date of birth',
  'age',
  'date of birth set by',
  'instagram',
  'how they heard',
  'how they heard (other)',
  'default address name',
  'default address',
  'default address country',
  'default address phone',
  'saved addresses',
  'profile complete (%)',
  'favourite pieces',
  'favourite finishes',
  'wishlist',
  'wishes',
  'tags',
  'tier',
  'pieces held',
  'lifetime value',
  'paid orders',
  'releases taken part in',
  'pieces secured',
  "LIVE attended after I'LL BE THERE",
  'first visit (Paris)',
  'first source kind',
  'first link',
  'first channel',
  'first utm source',
  'first utm medium',
  'first utm campaign',
  'first site',
  'sign-up source kind',
  'sign-up link',
  'sign-up channel',
  'sign-up utm campaign',
  'sign-up site',
  'latest purchase (Paris)',
  'latest purchase link',
  'days browsing before sign-up',
  'views, 13 months',
  'minutes, 13 months',
  'active days, 30',
  'active days, 90',
  'last seen (Paris)',
  'top models',
  'releases viewed',
  'scans',
  'scans before the account',
  'devices',
  'main device',
  'opened in apps',
  'usual country',
  'usual city',
  'other cities',
  'views before 13 months',
  'minutes before 13 months',
  'score',
  'recency points',
  'frequency points',
  'spend points',
  'release speed points',
  'attendance points',
  'score calculated (Paris)',
  'active now',
] as const;
export type CollectorExportColumn = (typeof COLLECTOR_EXPORT_COLUMNS)[number];
/** One collector's row, every column in words. */
export type CollectorExportRow = Record<CollectorExportColumn, string>;

/** The columns' version, written in the audit's `columns`; raised by any change of the columns. */
export const COLLECTOR_EXPORT_VERSION = 1;
/** The accounts read per batch (a keyset on `accounts.id`). */
export const COLLECTOR_EXPORT_BATCH = 1_000;
/** The reading's `statement_timeout`. */
export const COLLECTOR_EXPORT_TIMEOUT_MS = 60_000;
/** « Active now »: an act in the last 90 Paris days, today included (the Collectors page's ACTIVE AND DORMANT). */
export const EXPORT_ACTIVE_DAYS = 90;

/** The file's name: the Paris day of the export. */
export const collectorExportFilename = (now: Date): string => `orbes-collectors-${parisDay(now)}.csv`;

/** Who set the date of birth (`account_profiles.birth_date_by`). */
const BIRTH_DATE_BY = Object.freeze({ COLLECTOR: 'client', STAFF: 'Client Services' } as const);

/** A lifetime value per currency, `EUR 1240.00 · GBP 300.00`, the currencies in code order; empty with none. */
export function valueWords(values: readonly { currency: string; valueMinor: number }[]): string {
  return [...values]
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
    .map((v) => `${v.currency} ${(v.valueMinor / 100).toFixed(2)}`)
    .join(' · ');
}

/** An address's lines joined with ' / ' (the lines as typed, blank ones left out). */
export const addressLine = (address: string): string =>
  address
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' / ');

/** A date in Paris time, or empty. */
const when = (at: Date | string | null | undefined): string => (at === null || at === undefined ? '' : parisDateTime(at instanceof Date ? at : new Date(at)));
const num = (v: unknown): string => String(Number(v ?? 0));
const later = (...dates: (Date | string | null | undefined)[]): Date | null => {
  let best: Date | null = null;
  for (const d of dates) {
    if (d === null || d === undefined) continue;
    const t = d instanceof Date ? d : new Date(d);
    if (!Number.isNaN(t.getTime()) && (best === null || t.getTime() > best.getTime())) best = t;
  }
  return best;
};

/**
 * The next `limit` collectors of the five filters after `after` (null: from the first), by `accounts.id`. The scope is
 * ALL, so no period applies (the export is lifetime to date, §3.6 C.7).
 */
export async function exportIds(tx: Db, filters: InsightsFilters, after: string | null, limit: number = COLLECTOR_EXPORT_BATCH): Promise<string[]> {
  const epoch = new Date(0);
  const r = await sql<{ account_id: string }>`
    WITH ${scopeCte('col', { filters, scope: 'all' }, { start: epoch, end: epoch })}
    SELECT account_id FROM col
     ${after === null ? sql`` : sql`WHERE account_id > ${after}::uuid`}
     ORDER BY account_id LIMIT ${limit}`.execute(tx);
  return r.rows.map((x) => x.account_id);
}

/** What every batch shares: the catalogue's tastes and the latest finished run of the engagement score. */
export interface ExportBasis {
  now: Date;
  today: string;
  offered: TasteOptions;
  lastRunFinishedAt: Date | null;
}

export async function exportBasis(tx: Db, now: Date): Promise<ExportBasis> {
  const run = await tx.selectFrom('engagement_runs').select('finished_at').where('finished_at', 'is not', null).orderBy('day', 'desc').limit(1).executeTakeFirst();
  return { now, today: parisDay(now), offered: await tasteOptions(tx), lastRunFinishedAt: run?.finished_at ?? null };
}

interface BaseRow {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  created_at: Date;
  country: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  phone: string | null;
  phone_country: string | null;
  birth_date: string | null;
  birth_date_by: 'COLLECTOR' | 'STAFF' | null;
  instagram: string | null;
  heard_option_id: string | null;
  heard: string | null;
  heard_other: string | null;
  pieces: number;
  score: number | null;
  recency_points: number | null;
  frequency_points: number | null;
  spend_points: number | null;
  speed_points: number | null;
  attendance_points: number | null;
  changed_at: Date | null;
  active_now: boolean;
}

/** Group rows by account. */
function byAccount<T extends { account_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.account_id);
    if (list) list.push(r);
    else m.set(r.account_id, [r]);
  }
  return m;
}

/** The rows of a batch of counted collectors (`ids`, from exportIds), in the order of `ids`. */
export async function exportBatch(tx: Db, ids: readonly string[], basis: ExportBasis): Promise<CollectorExportRow[]> {
  if (ids.length === 0) return [];
  const { now, today } = basis;
  const list = uuidArray(ids);
  const activeFrom = parisDayStart(plusDays(today, -(EXPORT_ACTIVE_DAYS - 1)));

  const base = await sql<BaseRow>`
    SELECT a.id, a.email, a.display_name, a.status, a.created_at, a.country,
           p.first_name, p.last_name, p.city, p.phone, p.phone_country, p.birth_date::text AS birth_date, p.birth_date_by, p.instagram,
           p.heard_option_id, ho.label AS heard, p.heard_other,
           coalesce(h.pieces, 0)::int AS pieces,
           sc.score, sc.recency_points, sc.frequency_points, sc.spend_points, sc.speed_points, sc.attendance_points, sc.changed_at,
           ${activeIn('a.id', activeFrom, now)} AS active_now
      FROM accounts a
      LEFT JOIN account_profiles p ON p.account_id = a.id
      LEFT JOIN heard_options ho ON ho.id = p.heard_option_id
      LEFT JOIN (SELECT o.account_id, count(*)::int AS pieces FROM ownership o JOIN products pr ON pr.id = o.product_id
                  WHERE o.account_id = ANY(${list}) AND o.ended_at IS NULL AND pr.status NOT IN (${sql.join([...CLUB_EXCLUDED_STATUSES])})
                  GROUP BY o.account_id) h ON h.account_id = a.id
      LEFT JOIN account_scores sc ON sc.account_id = a.id
     WHERE a.id = ANY(${list})`.execute(tx);

  const addresses = byAccount(
    (
      await sql<{ account_id: string; name: string; address: string; country: string; phone: string; is_default: boolean }>`
        SELECT account_id, name, address, country, phone, is_default FROM account_addresses WHERE account_id = ANY(${list})`.execute(tx)
    ).rows,
  );
  const tastes = byAccount(
    (await sql<{ account_id: string; kind: TasteKind; value_key: string; label: string }>`
      SELECT account_id, kind, value_key, label FROM account_tastes WHERE account_id = ANY(${list}) ORDER BY account_id, value_key`.execute(tx)).rows,
  );
  const wishes = byAccount(
    (
      await sql<{ account_id: string; name: string; variant_label: string | null; variant_swatch: string | null }>`
        SELECT w.account_id, m.name, m.variant_label, m.variant_swatch FROM account_wishes w JOIN models m ON m.id = w.model_id
         WHERE w.account_id = ANY(${list}) AND w.removed_at IS NULL
         ORDER BY w.account_id, w.added_at DESC, m.id`.execute(tx)
    ).rows,
  );
  const tags = byAccount(
    (await sql<{ account_id: string; tag: string }>`SELECT account_id, tag FROM account_tags WHERE account_id = ANY(${list}) ORDER BY account_id, created_at, tag`.execute(tx)).rows,
  );
  const values = byAccount(
    (
      await sql<{ account_id: string; currency: string; value: string | number }>`
        SELECT pu.account_id, pu.currency, sum(pu.value)::bigint AS value FROM (${purchaseRows(ids)}) pu
         WHERE pu.value IS NOT NULL GROUP BY pu.account_id, pu.currency`.execute(tx)
    ).rows,
  );
  // A paid order: GROWTH's purchase by order (paid, never GIFT, not CANCELLED nor RETURNED), as the latest purchase link reads it.
  const orders = new Map(
    (
      await sql<{ account_id: string; n: number; latest: Date | null }>`
        SELECT o.account_id, count(*)::int AS n, max(o.paid_at) AS latest FROM orders o
         WHERE o.account_id = ANY(${list}) AND o.paid_at IS NOT NULL AND o.channel <> 'GIFT' AND o.status NOT IN ('CANCELLED', 'RETURNED')
         GROUP BY o.account_id`.execute(tx)
    ).rows.map((r) => [r.account_id, r]),
  );
  const taken = new Map(
    (
      await tx
        .selectFrom(participationRows(tx, now).as('pa'))
        .select((eb) => ['pa.account_id', eb.fn.count<number>('pa.release_id').distinct().as('n')])
        .where(sql<boolean>`pa.account_id = ANY(${list})`)
        .groupBy('pa.account_id')
        .execute()
    ).map((r) => [r.account_id, Number(r.n)]),
  );
  const secured = new Map(
    (
      await sql<{ account_id: string; n: number }>`
        SELECT s.account_id, sum(s.n)::int AS n FROM (
          SELECT le.account_id, sum(le.quantity)::int AS n FROM live_entries le WHERE le.account_id = ANY(${list}) AND le.status = 'CONFIRMED' GROUP BY le.account_id
          UNION ALL
          SELECT de.account_id, count(*)::int FROM drop_entries de JOIN drops d ON d.id = de.drop_id
           WHERE de.account_id = ANY(${list}) AND de.status = 'CONFIRMED' AND d.mode = 'DRAW' GROUP BY de.account_id) s
         GROUP BY s.account_id`.execute(tx)
    ).rows.map((r) => [r.account_id, Number(r.n)]),
  );
  // I'LL BE THERE for a LIVE RELEASE that has opened and was not cancelled (the client sheet's CAME or DID_NOT_COME), and of
  // those the ones the collector took part in.
  const interest = new Map(
    (
      await sql<{ account_id: string; said: number; came: number }>`
        SELECT i.account_id, count(*)::int AS said,
               (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM (${participationRows(tx, now)}) pa WHERE pa.account_id = i.account_id AND pa.release_id = i.drop_id)))::int AS came
          FROM live_interest i JOIN drops d ON d.id = i.drop_id
         WHERE i.account_id = ANY(${list}) AND d.cancelled_at IS NULL AND d.opens_at <= ${now}::timestamptz
         GROUP BY i.account_id`.execute(tx)
    ).rows.map((r) => [r.account_id, r]),
  );
  // Last seen: the latest sign-in (on audit_logs_account_login_idx) and scan; the views (and SCAN rows) come from tracking.
  const signIns = new Map(
    (
      await sql<{ account_id: string; at: Date }>`
        SELECT target_id AS account_id, max(occurred_at) AS at FROM audit_logs
         WHERE action = 'account.login' AND target_id IN (${sql.join(ids.map((x) => sql`${x}::text`))}) GROUP BY target_id`.execute(tx)
    ).rows.map((r) => [r.account_id, r.at]),
  );
  const scans = new Map(
    (
      await sql<{ account_id: string; at: Date }>`
        SELECT account_id, max(occurred_at) AS at FROM scan_events WHERE account_id = ANY(${list}) GROUP BY account_id`.execute(tx)
    ).rows.map((r) => [r.account_id, r.at]),
  );
  const tracking = await trackingColumns(tx, ids, { now });
  const origin = await acquisitionColumns(tx, ids);

  const byId = new Map(base.rows.map((r) => [r.id, r]));
  const out: CollectorExportRow[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    const book = addresses.get(id) ?? [];
    const home = book.find((x) => x.is_default) ?? null;
    const held = tastesOf(tastes.get(id) ?? [], basis.offered);
    const wished = wishes.get(id) ?? [];
    const order = orders.get(id);
    const said = interest.get(id);
    const t = tracking.get(id);
    const o = origin.get(id);
    const done = completionPercent(a, held, home !== null, basis.offered);
    const tier = tierForPieces(Number(a.pieces));
    const scored = a.score !== null;
    // EngagementService.account's rule: an ACTIVE account is calculated at every run, a LOCKED one when its row was written.
    const calculated = !scored ? null : a.status === 'ACTIVE' && basis.lastRunFinishedAt && basis.lastRunFinishedAt.getTime() > a.changed_at!.getTime() ? basis.lastRunFinishedAt : a.changed_at;
    out.push({
      'account id': a.id,
      email: a.email,
      'first name': a.first_name ?? '',
      'last name': a.last_name ?? '',
      'display name': a.display_name ?? '',
      status: a.status,
      'account created (Paris)': when(a.created_at),
      country: a.country?.trim() ?? '',
      city: a.city ?? '',
      phone: a.phone ?? '',
      'phone country': a.phone_country ?? '',
      'date of birth': a.birth_date ?? '',
      age: a.birth_date ? String(ageOn(a.birth_date, today)) : '',
      'date of birth set by': a.birth_date && a.birth_date_by ? BIRTH_DATE_BY[a.birth_date_by] : '',
      instagram: a.instagram ?? '',
      'how they heard': a.heard ?? '',
      'how they heard (other)': a.heard_other ?? '',
      'default address name': home?.name ?? '',
      'default address': home ? addressLine(home.address) : '',
      'default address country': home?.country ?? '',
      'default address phone': home?.phone ?? '',
      'saved addresses': String(book.length),
      'profile complete (%)': String(done),
      'favourite pieces': held.pieces.map((x) => x.label).join(' | '),
      'favourite finishes': held.finishes.map((x) => x.label).join(' | '),
      wishlist: wished.map((w) => (w.variant_label !== null && w.variant_swatch !== null ? `${w.name} · ${w.variant_label}` : w.name)).join(' | '),
      wishes: String(wished.length),
      tags: (tags.get(id) ?? []).map((x) => x.tag).join(' · '),
      tier: tier === 0 ? 'NO TIER' : CLUB_TIER_NAMES[tier - 1]!,
      'pieces held': num(a.pieces),
      'lifetime value': valueWords((values.get(id) ?? []).map((v) => ({ currency: v.currency, valueMinor: Number(v.value) }))),
      'paid orders': num(order?.n),
      'releases taken part in': num(taken.get(id)),
      'pieces secured': num(secured.get(id)),
      "LIVE attended after I'LL BE THERE": `${num(said?.came)} / ${num(said?.said)}`,
      'first visit (Paris)': when(o?.first_visit_at),
      'first source kind': o?.first_source_kind ?? '',
      'first link': o?.first_link ?? '',
      'first channel': o?.first_channel ?? '',
      'first utm source': o?.first_utm_source ?? '',
      'first utm medium': o?.first_utm_medium ?? '',
      'first utm campaign': o?.first_utm_campaign ?? '',
      'first site': o?.first_site ?? '',
      'sign-up source kind': o?.signup_source_kind ?? '',
      'sign-up link': o?.signup_link ?? '',
      'sign-up channel': o?.signup_channel ?? '',
      'sign-up utm campaign': o?.signup_utm_campaign ?? '',
      'sign-up site': o?.signup_site ?? '',
      'latest purchase (Paris)': when(order?.latest),
      'latest purchase link': o?.latest_purchase_link ?? '',
      'days browsing before sign-up': num(t?.days_browsing_before_sign_up),
      'views, 13 months': num(t?.views_13_months),
      'minutes, 13 months': num(t?.minutes_13_months),
      'active days, 30': num(t?.active_days_30),
      'active days, 90': num(t?.active_days_90),
      'last seen (Paris)': when(later(t?.last_seen_at, signIns.get(id), scans.get(id))),
      'top models': t?.top_models ?? '',
      'releases viewed': num(t?.releases_viewed),
      scans: num(t?.scans),
      'scans before the account': num(t?.scans_before_account),
      devices: t?.devices ?? '',
      'main device': t?.main_device ?? '',
      'opened in apps': t?.opened_in_apps ?? '',
      'usual country': t?.usual_country ?? '',
      'usual city': t?.usual_city ?? '',
      'other cities': t?.other_cities ?? '',
      'views before 13 months': num(t?.views_before_13_months),
      'minutes before 13 months': num(t?.minutes_before_13_months),
      score: scored ? String(a.score) : '',
      'recency points': scored ? num(a.recency_points) : '',
      'frequency points': scored ? num(a.frequency_points) : '',
      'spend points': scored ? num(a.spend_points) : '',
      'release speed points': scored ? num(a.speed_points) : '',
      'attendance points': scored ? num(a.attendance_points) : '',
      'score calculated (Paris)': when(calculated),
      'active now': a.active_now ? 'yes' : 'no',
    });
  }
  return out;
}

/**
 * The profile's completion (profile-rules.ts `completion`, as YOUR PROFILE reads it), in percent. A missing profile row
 * reads as every field empty, which `completion` counts the same as no profile.
 */
function completionPercent(a: BaseRow, tastes: { pieces: readonly unknown[]; finishes: readonly unknown[] }, hasDefaultAddress: boolean, offered: TasteOptions): number {
  return completion(
    { firstName: a.first_name, lastName: a.last_name, birthDate: a.birth_date, city: a.city, phone: a.phone, instagram: a.instagram, heard: a.heard_option_id, tastes },
    { country: a.country },
    hasDefaultAddress,
    offered,
  ).percent;
}

/** One CSV line (CRLF-terminated) of the columns in their order. */
export const csvLine = (cells: readonly string[]): string => `${cells.map(csvField).join(',')}\r\n`;

/** The export's whole document as CSV lines, the header first, and its row count, the batches read by keyset. */
export async function exportDocument(tx: Db, filters: InsightsFilters, now: Date): Promise<{ rows: number; lines: string[] }> {
  const basis = await exportBasis(tx, now);
  const lines = [csvLine(COLLECTOR_EXPORT_COLUMNS)];
  let rows = 0;
  let after: string | null = null;
  for (;;) {
    const ids = await exportIds(tx, filters, after);
    if (ids.length === 0) break;
    const batch = await exportBatch(tx, ids, basis);
    // One string per batch: the batch's rows are dropped once written into it.
    lines.push(batch.map((r) => csvLine(COLLECTOR_EXPORT_COLUMNS.map((c) => r[c]))).join(''));
    rows += batch.length;
    after = ids[ids.length - 1]!;
    if (ids.length < COLLECTOR_EXPORT_BATCH) break;
  }
  return { rows, lines };
}
