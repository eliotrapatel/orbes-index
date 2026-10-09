/**
 * The client sheet's Intelligence (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.4, C.9, C.11, §3.0 (h), step 5.7;
 * API §16.36): what the house knows of a client beyond what the client gave, read for GET
 * /api/admin/owners/:id/intelligence after the sheet, so a slow or failing read never keeps Client Services from the
 * sheet itself.
 *
 *   engagement  the engagement score and its five parts (§3.5 SB.3.6): null until I2 ships it (the block is absent).
 *   origin      where the client came from (§3.4 A.10.5): the first visit and its source, the source the sign-up came
 *               through, the source the latest purchase came through (AcquisitionService.originOf).
 *   wishlist    the client's open wishes, the latest first, with the model's state (§3.2 W.9: WishlistService.ofAccount).
 *   browsing    what the client looks at, the devices and the places from the connection (§3.3 T.4.1:
 *               TrackingService.collectorBrowsing), the cities withheld for an AUDITOR (`inClear` false).
 *   recordingSince  the recording's start (`tracking_state.started_at`), for an account older than it.
 *
 * Each block is its own small read on indexes keyed by the account, the four run side by side; one failing is logged
 * and marked `{ failed: true }` alone, the others stand. An unknown account is 404 ACCOUNT_NOT_FOUND. Every role that
 * reaches the sheet reads it (AUDITOR and up), the cities aside. It only reads: nothing is written or audited.
 */
import type { Db } from '../db/connection.js';
import { notFound } from '../errors.js';
import type { AcquisitionService } from './acquisition.js';
import type { OriginOf } from './acquisition-reads.js';
import type { CollectorBrowsing } from './tracking-reads.js';
import type { TrackingService } from './tracking.js';
import type { StaffWish, WishlistService } from './wishlist.js';

/** A block that could not be read: the sheet says so under its heading, with Try again. */
export interface FailedBlock {
  failed: true;
}

export interface OwnerIntelligence {
  /** The engagement score's block: null until I2 (plan §4, step 7.x). */
  engagement: null;
  origin: OriginOf | FailedBlock;
  wishlist: StaffWish[] | FailedBlock;
  browsing: CollectorBrowsing | FailedBlock;
  /** The recording's start; null before the first boot on this schema. */
  recordingSince: Date | null;
}

export interface OwnerIntelligenceDeps {
  db: Db;
  acquisition: Pick<AcquisitionService, 'originOf'>;
  wishlist: Pick<WishlistService, 'ofAccount'>;
  tracking: Pick<TrackingService, 'collectorBrowsing'>;
  /** Where a failed block is logged (the route's logger). */
  warn?: (detail: { block: string; err: unknown }, message: string) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client sheet's Intelligence of one account; `inClear` false (an AUDITOR) withholds every city. */
export async function ownerIntelligence(deps: OwnerIntelligenceDeps, accountId: string, opts: { inClear: boolean }): Promise<OwnerIntelligence> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const id = accountId.toLowerCase();
  const account = await deps.db.selectFrom('accounts').select('id').where('id', '=', id).executeTakeFirst();
  if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');

  const block = async <T>(name: string, read: () => Promise<T>): Promise<T | FailedBlock> => {
    try {
      return await read();
    } catch (err) {
      deps.warn?.({ block: name, err }, 'client sheet intelligence block failed');
      return { failed: true };
    }
  };
  const [origin, wishlist, browsing, state] = await Promise.all([
    block('origin', () => deps.acquisition.originOf(id)),
    block('wishlist', () => deps.wishlist.ofAccount(id)),
    block('browsing', () => deps.tracking.collectorBrowsing(id, { withCities: opts.inClear })),
    deps.db
      .selectFrom('tracking_state')
      .select('started_at')
      .where('id', '=', 1)
      .executeTakeFirst()
      .catch(() => undefined),
  ]);
  return { engagement: null, origin, wishlist, browsing, recordingSince: state?.started_at ?? null };
}
