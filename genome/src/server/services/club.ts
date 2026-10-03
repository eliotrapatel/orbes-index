/**
 * The owners' club (the 2026-10-03 « Potentiel » lot: P-R02 first): what a
 * signed-in account holds now decides what of the club it may read.
 *
 * An owner is an account that holds at least one piece now: an ownership
 * still open (`ownership.ended_at IS NULL`) of a piece that is not REVOKED,
 * COUNTERFEIT_FLAGGED or RETIRED. Those three never end an ownership (a
 * revocation is not a transfer: TERMS-FACTS N3, the table is only read
 * here), so they are left out of the count instead. It is read again at each
 * request: the access goes with the last piece.
 *
 * P-R02: the lookbook's RESERVED models (LookbookService), listed and opened
 * for an owner only (routes/club.ts); any other account is answered
 * 403 OWNERS_ONLY. RESERVED means unlisted, not confidential: the photographs
 * of those sheets stay public at /api/v1/media/…, like every other.
 *
 * P-R03: the tiers. `tierOf` counts the same pieces and gives the account's
 * standing in the club: its tier (CLUB_TIER_THRESHOLDS, 1 / 3 / 5 pieces:
 * TITANE, PLATINE, PALLADIUM; 0 below the first) and its seniority, the full
 * years since the first `started_at` of its ownerships (any, ended or not).
 * The thresholds are a constant of the code, never a setting: a production
 * setting could contradict the published rule of a draw (DropService), which
 * reads them at the moment of the draw, as tiers are reused by the circle, the
 * early access, the tiers' page and the private salon of the same lot. The
 * club's status (GET /api/v1/club/status) is open to every signed-in account:
 * any ORBES account enters a drop (an account that holds no piece is drawn
 * after the tiers).
 */
import type { Db } from '../db/connection.js';
import type { ProductStatus } from '../db/schema.js';
import { DomainError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import type { AccountDropEntry, DropService } from './drops.js';
import type { LookbookCard, LookbookService, LookbookSheet } from './lookbook.js';

/** The pieces that count for nothing in the club: revoked, flagged or retired by ORBES, whose ownership stays open (N3). */
export const CLUB_EXCLUDED_STATUSES: readonly ProductStatus[] = Object.freeze(['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'] as const);

/**
 * The pieces held now that reach each tier, in order: 1 for TITANE, 3 for PLATINE, 5 for PALLADIUM (the plan's
 * choice 7). A constant of the code, so a production setting never contradicts the published rule of a draw.
 */
export const CLUB_TIER_THRESHOLDS: readonly number[] = Object.freeze([1, 3, 5]);

/** The names of the tiers 1, 2 and 3, in the order of CLUB_TIER_THRESHOLDS. */
export const CLUB_TIER_NAMES = Object.freeze(['TITANE', 'PLATINE', 'PALLADIUM'] as const);
export type ClubTierName = (typeof CLUB_TIER_NAMES)[number];

/** 0: no piece held; 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
export type ClubTier = 0 | 1 | 2 | 3;

/** An account's place in the club now: the pieces it holds (as the club counts them), its tier and its seniority. */
export interface ClubStanding {
  pieces: number;
  tier: ClubTier;
  /** Full years since the first `started_at` of the account's ownerships; 0 for an account that never owned one. */
  seniority: number;
}

export const ownersOnly = () => new DomainError('OWNERS_ONLY', 403, 'This is reserved for the owners of an ORBES piece.');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Accounts read per query by clubStandings (a draw may read thousands). */
const STANDINGS_CHUNK = 1000;

/** The tier of `pieces` held now: how many thresholds of CLUB_TIER_THRESHOLDS it reaches. */
export function tierForPieces(pieces: number): ClubTier {
  const n = Number.isFinite(pieces) ? pieces : 0;
  return CLUB_TIER_THRESHOLDS.filter((t) => n >= t).length as ClubTier;
}

/** The name of a tier, null for 0. */
export function tierName(tier: ClubTier): ClubTierName | null {
  return tier === 0 ? null : CLUB_TIER_NAMES[tier - 1]!;
}

/** `from` moved `years` calendar years, in UTC (29 February moves to 1 March of a year without one). */
function addUtcYears(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  d.setUTCFullYear(from.getUTCFullYear() + years);
  return d;
}

/** The full years from `from` to `to`, in UTC: 0 before the first anniversary, and when `to` is not after `from`. */
export function fullYears(from: Date, to: Date): number {
  if (!(to.getTime() > from.getTime())) return 0;
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  if (addUtcYears(from, years).getTime() > to.getTime()) years--;
  return Math.max(0, years);
}

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

/**
 * The standing of each account of `accountIds` at `now`, read in one query per thousand accounts: the pieces held
 * now (open ownerships of pieces the club counts), the tier they reach, and the full years since the account's first
 * ownership began. An account with no ownership at all stands at 0, 0, 0. Read only: the ownership table is never
 * written here (TERMS-FACTS N3).
 */
export async function clubStandings(db: Db, accountIds: readonly string[], now: Date): Promise<Map<string, ClubStanding>> {
  const ids = [...new Set(accountIds.filter((id) => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase()))];
  const out = new Map<string, ClubStanding>();
  for (let i = 0; i < ids.length; i += STANDINGS_CHUNK) {
    const chunk = ids.slice(i, i + STANDINGS_CHUNK);
    const rows = await db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .select((eb) => [
        'o.account_id',
        eb.fn.count<number>('o.id').filterWhere((w) => w.and([w('o.ended_at', 'is', null), w('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])])).as('pieces'),
        eb.fn.min<Date>('o.started_at').as('since'),
      ])
      .where('o.account_id', 'in', chunk)
      .groupBy('o.account_id')
      .execute();
    for (const r of rows) {
      const pieces = Number(r.pieces);
      const since = r.since === null ? null : new Date(r.since);
      out.set(r.account_id, { pieces, tier: tierForPieces(pieces), seniority: since ? fullYears(since, now) : 0 });
    }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { pieces: 0, tier: 0, seniority: 0 });
  return out;
}

/** One account's standing in the club at `now` (clubStandings). */
export async function tierOf(db: Db, accountId: string, now: Date): Promise<ClubStanding> {
  return (await clubStandings(db, [accountId], now)).get(String(accountId).toLowerCase()) ?? { pieces: 0, tier: 0, seniority: 0 };
}

/** GET /api/v1/club/status: the account's standing, and its entries in the drops (newest drop first). */
export interface ClubStatus {
  tier: { level: ClubTier; name: ClubTierName | null };
  pieces: number;
  seniority: number;
  entries: AccountDropEntry[];
}

export interface ClubServiceDeps {
  db: Db;
  lookbook: LookbookService;
  drops: DropService;
  clock?: Clock;
}

export class ClubService {
  private readonly db: Db;
  private readonly lookbook: LookbookService;
  private readonly drops: DropService;
  private readonly clock: Clock;

  constructor(deps: ClubServiceDeps) {
    this.db = deps.db;
    this.lookbook = deps.lookbook;
    this.drops = deps.drops;
    this.clock = deps.clock ?? systemClock;
  }

  /** The pieces the account holds now (activePieceCount). */
  activePieces(accountId: string): Promise<number> {
    return activePieceCount(this.db, accountId);
  }

  /** The account's standing in the club now (tierOf). */
  tierOf(accountId: string): Promise<ClubStanding> {
    return tierOf(this.db, accountId, this.clock());
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

  /** The account's place in the club and its entries (GET /api/v1/club/status): any signed-in account. */
  async status(accountId: string): Promise<ClubStatus> {
    const standing = await this.tierOf(accountId);
    return {
      tier: { level: standing.tier, name: tierName(standing.tier) },
      pieces: standing.pieces,
      seniority: standing.seniority,
      entries: await this.drops.accountEntries(accountId),
    };
  }
}
