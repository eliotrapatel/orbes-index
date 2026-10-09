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
 *
 * Nothing here is audited at boot: the presets are the house's words, written once, as the stock's are. No third party:
 * nothing leaves this database.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { SourceKind } from '../db/schema.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';

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
