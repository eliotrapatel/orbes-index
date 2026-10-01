/**
 * Scan-history retention (SCAN_RETENTION_DAYS, DATABASE §10).
 *
 * Deletes scan events older than the retention cut-off together with the
 * rows that reference them (`scan_tokens.scan_event_id` and
 * `authentication_events.scan_event_id`, both ON DELETE RESTRICT, so the
 * dependants go first), in batches: each batch is one short transaction over
 * the oldest `batchSize` events, and one pass stops after `maxBatches`, so a
 * first purge of a large backlog never holds long locks; the next pass
 * continues.
 *
 * Not touched: `anomalies` (case records reviewed by staff, keyed to the
 * product, not to individual scans), `audit_logs` (append-only hash chain)
 * and everything else. Configuration guarantees the cut-off is never inside
 * the anomaly look-back (config.ts `scanLookbackDays`).
 */
import type { Db } from '../db/connection.js';

export interface PurgeScanHistoryOptions {
  /** Scan events per transaction (default 1 000). */
  batchSize?: number;
  /** Transactions per call (default 50). */
  maxBatches?: number;
}

/** Delete scan events that occurred before `before`, dependants first. Returns the number of scan events deleted. */
export async function purgeScanHistory(db: Db, before: Date, opts: PurgeScanHistoryOptions = {}): Promise<number> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? 1_000));
  const maxBatches = Math.max(1, Math.floor(opts.maxBatches ?? 50));
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const n = await db.transaction().execute(async (trx) => {
      const ids = (
        await trx.selectFrom('scan_events').select('id').where('occurred_at', '<', before).orderBy('occurred_at').limit(batchSize).execute()
      ).map((r) => r.id);
      if (ids.length === 0) return 0;
      await trx.deleteFrom('scan_tokens').where('scan_event_id', 'in', ids).execute();
      await trx.deleteFrom('authentication_events').where('scan_event_id', 'in', ids).execute();
      const r = await trx.deleteFrom('scan_events').where('id', 'in', ids).executeTakeFirst();
      return Number(r.numDeletedRows);
    });
    deleted += n;
    if (n < batchSize) break;
  }
  return deleted;
}
