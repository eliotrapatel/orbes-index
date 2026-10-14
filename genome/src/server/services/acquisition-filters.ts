/**
 * The SQL conditions on an account that say where it came from (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.5,
 * A.10.6), with the reports' fallbacks: Before tracking for what was made or written before the recording started (or
 * with no recording), else Direct.
 *
 *   sourceFilter      its first source is in these channels, links or kinds: the Collectors page's source filter and
 *                     Segments' FIRST_SOURCE (step 4.6; moved here from services/acquisition-report.ts, which exports
 *                     it still, so services/segments.ts reads it without loading the reports' imports).
 *   lastSourceFilter  the last link before its sign-up, before a paid order that is not GIFT, or either, is in these
 *                     channels, links or kinds: Segments' LAST_SOURCE (step 8.4).
 *
 * No import from the services: services/segments.ts sits in the services' import cycle, and these are read there.
 */
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { SourceKind } from '../db/schema.js';

/** « The account's first source is in these channels, links or kinds » (Segments' FIRST_SOURCE shape). */
export interface SourceFilter {
  channelIds?: readonly string[];
  linkIds?: readonly string[];
  kinds?: readonly SourceKind[];
}

/**
 * The account in `accountColumn` came first through one of these channels, links or kinds (§3.4 A.10.6, §3.6 C.6.2):
 * its `account_sources` row, else Before tracking for an account made before the recording started (or with no
 * recording), else Direct. A filter naming nothing matches every account.
 */
export function sourceFilter(accountColumn: string, f: SourceFilter): RawBuilder<SqlBool> {
  const channels = [...(f.channelIds ?? [])];
  const links = [...(f.linkIds ?? [])];
  const kinds = [...(f.kinds ?? [])];
  if (channels.length + links.length + kinds.length === 0) return sql<SqlBool>`TRUE`;
  const any: RawBuilder<SqlBool>[] = [];
  if (kinds.length) any.push(sql<SqlBool>`sfk.kind IN (${sql.join(kinds)})`);
  if (channels.length) any.push(sql<SqlBool>`sfl.channel_id IN (${sql.join(channels.map((c) => sql`${c}::uuid`))})`);
  if (links.length) any.push(sql<SqlBool>`sfk.link_id IN (${sql.join(links.map((l) => sql`${l}::uuid`))})`);
  return sql<SqlBool>`EXISTS (
    SELECT 1 FROM accounts sfa
      LEFT JOIN account_sources sfs ON sfs.account_id = sfa.id
      JOIN acquisition_sources sfk ON sfk.id = coalesce(sfs.first_source_id, (
        SELECT sfx.id FROM acquisition_sources sfx
         WHERE sfx.key = CASE WHEN EXISTS (SELECT 1 FROM acquisition_state sfst WHERE sfst.id = 1 AND sfst.tracking_started_at <= sfa.created_at)
                              THEN 'DIRECT' ELSE 'BEFORE' END))
      LEFT JOIN links sfl ON sfl.id = sfk.link_id
     WHERE sfa.id = ${sql.ref(accountColumn)} AND (${sql.join(any, sql` OR `)}))`;
}

/** The act LAST_SOURCE reads the last link of: the sign-up, a paid order that is not GIFT, or either. */
export const LAST_SOURCE_AT = ['SIGNUP', 'PURCHASE', 'EITHER'] as const;
export type LastSourceAt = (typeof LAST_SOURCE_AT)[number];

/**
 * The account in `accountColumn` came last through one of these channels, links or kinds before `at` (§3.4 A.10.6,
 * Segments' LAST_SOURCE): its sign-up's conversion, else Before tracking when the account was made before the recording
 * started (or with no recording), else Direct; or any paid order of its that is not GIFT, by its conversion, else Before
 * tracking or Direct by its reservation (the reports' fallbacks); EITHER, one or the other. An archived link still
 * matches. Each EXISTS is keyed by the account (accounts' key, orders_account_idx, then acquisition_conversions_ref). A
 * filter naming nothing matches every account.
 */
export function lastSourceFilter(accountColumn: string, f: SourceFilter, at: LastSourceAt): RawBuilder<SqlBool> {
  const channels = [...(f.channelIds ?? [])];
  const links = [...(f.linkIds ?? [])];
  const kinds = [...(f.kinds ?? [])];
  if (channels.length + links.length + kinds.length === 0) return sql<SqlBool>`TRUE`;
  const any: RawBuilder<SqlBool>[] = [];
  if (kinds.length) any.push(sql<SqlBool>`lsk.kind IN (${sql.join(kinds)})`);
  if (channels.length) any.push(sql<SqlBool>`lsl.channel_id IN (${sql.join(channels.map((c) => sql`${c}::uuid`))})`);
  if (links.length) any.push(sql<SqlBool>`lsk.link_id IN (${sql.join(links.map((l) => sql`${l}::uuid`))})`);
  const named = (source: RawBuilder<unknown>) =>
    sql<SqlBool>`${source} IN (SELECT lsk.id FROM acquisition_sources lsk LEFT JOIN links lsl ON lsl.id = lsk.link_id WHERE ${sql.join(any, sql` OR `)})`;
  const fallback = (written: RawBuilder<unknown>) => sql`(
    SELECT lsx.id FROM acquisition_sources lsx
     WHERE lsx.key = CASE WHEN EXISTS (SELECT 1 FROM acquisition_state lst WHERE lst.id = 1 AND lst.tracking_started_at <= ${written})
                          THEN 'DIRECT' ELSE 'BEFORE' END)`;
  const account = sql.ref(accountColumn);
  const signup = sql<SqlBool>`EXISTS (
    SELECT 1 FROM accounts lsa LEFT JOIN acquisition_conversions lsc ON lsc.kind = 'SIGNUP' AND lsc.ref_id = lsa.id
     WHERE lsa.id = ${account} AND ${named(sql`coalesce(lsc.last_source_id, ${fallback(sql`lsa.created_at`)})`)})`;
  const purchase = sql<SqlBool>`EXISTS (
    SELECT 1 FROM orders lso LEFT JOIN acquisition_conversions lsoc ON lsoc.kind = 'ORDER' AND lsoc.ref_id = lso.id
     WHERE lso.account_id = ${account} AND lso.paid_at IS NOT NULL AND lso.channel <> 'GIFT'
       AND ${named(sql`coalesce(lsoc.last_source_id, ${fallback(sql`lso.reserved_at`)})`)})`;
  if (at === 'SIGNUP') return signup;
  if (at === 'PURCHASE') return purchase;
  return sql<SqlBool>`(${signup} OR ${purchase})`;
}
