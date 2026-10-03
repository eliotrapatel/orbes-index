/**
 * The owners' club (the 2026-10-03 « Potentiel » lot: P-R02 first): what a
 * signed-in account holds now decides what of the club it may read.
 *
 * An owner is an account that holds at least one piece now: an ownership
 * still open (`ownership.ended_at IS NULL`) of a piece that is not REVOKED,
 * COUNTERFEIT_FLAGGED or RETIRED. Those three never end an ownership (a
 * revocation is not a transfer: TERMS-FACTS N3, the table is only read
 * here), so they are left out of the count instead. It is read again at each
 * request: the access goes with the last piece. The tiers (P-R03) count the
 * same pieces.
 *
 * P-R02: the lookbook's RESERVED models (LookbookService), listed and opened
 * for an owner only (routes/club.ts); any other account is answered
 * 403 OWNERS_ONLY. RESERVED means unlisted, not confidential: the photographs
 * of those sheets stay public at /api/v1/media/…, like every other.
 */
import type { Db } from '../db/connection.js';
import type { ProductStatus } from '../db/schema.js';
import { DomainError } from '../errors.js';
import type { LookbookCard, LookbookService, LookbookSheet } from './lookbook.js';

/** The pieces that count for nothing in the club: revoked, flagged or retired by ORBES, whose ownership stays open (N3). */
export const CLUB_EXCLUDED_STATUSES: readonly ProductStatus[] = Object.freeze(['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'] as const);

export const ownersOnly = () => new DomainError('OWNERS_ONLY', 403, 'This is reserved for the owners of an ORBES piece.');

/** The pieces an account holds now, as the club counts them (see the file header). */
export async function activePieceCount(db: Db, accountId: string): Promise<number> {
  const r = await db
    .selectFrom('ownership as o')
    .innerJoin('products as p', 'p.id', 'o.product_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('o.account_id', '=', accountId)
    .where('o.ended_at', 'is', null)
    .where('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export interface ClubServiceDeps {
  db: Db;
  lookbook: LookbookService;
}

export class ClubService {
  private readonly db: Db;
  private readonly lookbook: LookbookService;

  constructor(deps: ClubServiceDeps) {
    this.db = deps.db;
    this.lookbook = deps.lookbook;
  }

  /** The pieces the account holds now (activePieceCount). */
  activePieces(accountId: string): Promise<number> {
    return activePieceCount(this.db, accountId);
  }

  /** 403 OWNERS_ONLY unless the account holds a piece now. */
  async requireOwner(accountId: string): Promise<void> {
    if ((await this.activePieces(accountId)) < 1) throw ownersOnly();
  }

  /** The lookbook's RESERVED models, for an owner (GET /api/v1/club/lookbook): no story. */
  async reservedLookbook(accountId: string): Promise<LookbookCard[]> {
    await this.requireOwner(accountId);
    return this.lookbook.listReserved();
  }

  /** A sheet of the lookbook, PUBLIC or RESERVED, for an owner (GET /api/v1/club/lookbook/:slug); 404 LOOKBOOK_NOT_FOUND otherwise. */
  async lookbookSheet(accountId: string, slug: string): Promise<LookbookSheet> {
    await this.requireOwner(accountId);
    return this.lookbook.sheet(slug, { reserved: true });
  }
}
