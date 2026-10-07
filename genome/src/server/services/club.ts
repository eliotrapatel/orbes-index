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
 * of those sheets stay public at /api/v1/media/…, like every other. Since
 * P-X08 they are THE PRIVATE SALON (services/salon.ts), each shown from its
 * tier up, with its price, on request; SalonService reads `tierOf` here.
 *
 * P-R03: the tiers. `tierOf` counts the same pieces and gives the account's
 * standing in the club: its tier (CLUB_TIER_THRESHOLDS, 1 / 5 / 10 pieces:
 * TITANE, PLATINE, PALLADIUM; 0 below the first) and its seniority, the full
 * years since the first `started_at` of its ownerships (any, ended or not).
 * The thresholds are a constant of the code, never a setting: a production
 * setting could contradict the published rule of a draw (DropService), which
 * reads them at the moment of the draw, as tiers are reused by the circle, the
 * early access, the tiers' page and the private salon of the same lot. The
 * club's status (GET /api/v1/club/status) is open to every signed-in account:
 * any ORBES account enters a drop (an account that holds no piece is drawn
 * after the tiers).
 *
 * P-X01: the circle (CircleService) reads `tierOf` at each request (a post
 * from its tier up), and the console's Analytics counts the members of each
 * tier now (`clubMembersByTier`: counts only, never an account).
 *
 * P-X04: the tiers' benefits. Each tier has its words, what it adds to the
 * ones below it, one benefit per line: by default constants of the code, in
 * English (CLUB_TIER_DEFAULT_BENEFITS); the console's Club, its Tiers tab
 * (OPERATOR), changes them, and `club_tiers` (migration 0018) keeps only
 * what it changed (a tier restored to its words by default loses its row).
 * Audited `club.tier.update`. The club's status gives the account its tier,
 * its pieces, the benefits of its tier and of those below it, and the next
 * tier: the pieces it starts from, how many more, and what it adds. The
 * thresholds themselves never change from the console.
 *
 * Plan NEXT-NINE, BP-19 T9 and T10: THE PROGRAM's lines (services/club-program.ts) say what each tier gives with the
 * figures of the console's settings; the status adds the lines the account's tier gives now (`program`) and its
 * benefits in use (`inUse`: its credit, its yearly care of the year, its welcome gifts), and the public THE CLUB
 * (GET /api/v1/the-club, `theClub`) every tier's lines and words, for no account. PLATINE's words by default are none:
 * its early access and priority are its program's lines.
 */
import { inTransaction, type Db } from '../db/connection.js';
import { CLUB_TIER_NAMES, type ClubTierName, type ProductStatus } from '../db/schema.js';
import { DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { careThisYear, type CareAllowance } from './care.js';
import { activeGifts, effectiveProgramLines, programLines, readProgram, type ClubProgram } from './club-program.js';
import type { AccountDropEntry, DropService } from './drops.js';
import { orderReference } from './orders.js';
import { creditBalances, ensureGrants } from './tier-grants.js';

/** The pieces that count for nothing in the club: revoked, flagged or retired by ORBES, whose ownership stays open (N3). */
export const CLUB_EXCLUDED_STATUSES: readonly ProductStatus[] = Object.freeze(['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'] as const);

/**
 * The pieces held now that reach each tier, in order: 1 for TITANE, 5 for PLATINE, 10 for PALLADIUM (plan NEXT-NINE, BP-19
 * T1, for every account at once). A constant of the code, so a production setting never contradicts a draw's rule.
 */
export const CLUB_TIER_THRESHOLDS: readonly number[] = Object.freeze([1, 5, 10]);

/** The names of the tiers 1, 2 and 3, in the order of CLUB_TIER_THRESHOLDS (db/schema.ts, club_tiers.tier). */
export { CLUB_TIER_NAMES, type ClubTierName };

/** A tier's benefits: at most this many characters (club_tiers.benefits), in at most CLUB_TIER_BENEFIT_LINES lines. */
export const CLUB_TIER_BENEFITS_MAX = 600;
export const CLUB_TIER_BENEFIT_LINES = 8;

/**
 * The words of each tier's benefits by default (P-X04, the plan's choice 7), in English: what the tier adds to the ones
 * below it, one benefit per line. The console's Tiers tab changes them; `club_tiers` keeps only what it changed.
 */
export const CLUB_TIER_DEFAULT_BENEFITS: Readonly<Record<ClubTierName, string>> = Object.freeze({
  TITANE: ['The owners’ circle: its notes, its invitations and its polls.', 'Priority in the draw of each release, before the accounts that hold no piece.'].join('\n'),
  // PLATINE's early access and priority with ORBES Client Services are said by THE PROGRAM's lines (plan NEXT-NINE, BP-19 T1).
  PLATINE: '',
  PALLADIUM: ['Special commissions, made for you by the ORBES atelier.', 'A yearly visit to the ORBES atelier.'].join('\n'),
});

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

/** The tier of a name (1 TITANE, 2 PLATINE, 3 PALLADIUM). */
export function tierLevel(name: ClubTierName): 1 | 2 | 3 {
  return (CLUB_TIER_NAMES.indexOf(name) + 1) as 1 | 2 | 3;
}

/** The lines of a tier's benefits as they are shown: one benefit per line, none empty. */
export function benefitLines(benefits: string): string[] {
  return benefits
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * A tier's benefits as the console sends them: one benefit per line (blank lines and the spaces around each dropped),
 * 1 to CLUB_TIER_BENEFIT_LINES lines and 1 to CLUB_TIER_BENEFITS_MAX characters; null, '' or blank text: the words by
 * default (returned as null).
 */
export function normalizeBenefits(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The benefits must be text.');
  const lines = benefitLines(v.replace(/\r\n?/g, '\n'));
  if (lines.length === 0) return null;
  const s = lines.join('\n');
  if (CONTROL_CHARS.test(s)) throw validationError('The benefits contain invalid characters.');
  if (s.length > CLUB_TIER_BENEFITS_MAX) throw validationError(`The benefits must be at most ${CLUB_TIER_BENEFITS_MAX} characters.`);
  if (lines.length > CLUB_TIER_BENEFIT_LINES) throw validationError(`A tier has at most ${CLUB_TIER_BENEFIT_LINES} benefits, one per line.`);
  return s;
}

const tierNotFound = () => notFound('Tier', 'TIER_NOT_FOUND');

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

/** The members of the club now, by tier (P-X01, the console's Analytics): counts only, never an account. */
export interface ClubMembers {
  TITANE: number;
  PLATINE: number;
  PALLADIUM: number;
  /** The three together: the accounts that read the circle now. */
  total: number;
}

/**
 * How many ACTIVE accounts stand at each tier now: the pieces each holds, counted as `tierOf` counts them, grouped by
 * their number, then each number given its tier (tierForPieces). A locked account reads nothing of the club, so it is
 * left out. Read only (TERMS-FACTS N3); what comes back names no account.
 */
export async function clubMembersByTier(db: Db): Promise<ClubMembers> {
  const held = db
    .selectFrom('ownership as o')
    .innerJoin('products as p', 'p.id', 'o.product_id')
    .innerJoin('accounts as a', 'a.id', 'o.account_id')
    .select((eb) => ['o.account_id', eb.fn.countAll<number>().as('pieces')])
    .where('o.ended_at', 'is', null)
    .where('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
    .where('a.status', '=', 'ACTIVE')
    .groupBy('o.account_id');
  const rows = await db
    .selectFrom(held.as('h'))
    .select((eb) => ['h.pieces', eb.fn.countAll<number>().as('accounts')])
    .groupBy('h.pieces')
    .execute();
  const out: ClubMembers = { TITANE: 0, PLATINE: 0, PALLADIUM: 0, total: 0 };
  for (const r of rows) {
    const name = tierName(tierForPieces(Number(r.pieces)));
    if (!name) continue;
    out[name] += Number(r.accounts);
    out.total += Number(r.accounts);
  }
  return out;
}

/** The tier that follows the account's (P-X04): the pieces it starts from, how many more the account needs, what it adds. */
export interface ClubNextTier {
  level: 1 | 2 | 3;
  name: ClubTierName;
  /** The pieces held now it starts from (CLUB_TIER_THRESHOLDS). */
  pieces: number;
  /** How many more pieces the account needs to reach it (≥ 1). */
  missing: number;
  /** What it adds to the ones below it, one benefit per entry. */
  benefits: string[];
  /** What its program adds (THE PROGRAM's lines of that tier, BP-19 T10), before its words. */
  program: string[];
}

/** A tier's benefits in use by the account now (BP-19 T10): YOUR TIER's IN USE, the console's Club block. */
export interface ClubInUse {
  /** Its credit left, usable now (its tier held, not expired): the sum of its grants' balances, the earliest expiry. */
  credit: { balanceMinor: number; currency: string; expiresAt: Date } | null;
  /** Its yearly care of the year (UTC); null when its tier gives none. */
  care: { year: number; used: number; allowance: CareAllowance } | null;
  /**
   * Its welcome gifts: PENDING while its tier is held and has an active gift model (the next order carries it),
   * WITH_ORDER from the order it travels with until it is DELIVERED; never a gift that would not come.
   */
  gifts: { tier: ClubTierName; model: string; state: 'PENDING' | 'WITH_ORDER'; orderReference: string | null }[];
}

/** GET /api/v1/the-club (BP-19 T9): every tier, what it gives and from how many pieces; no account. */
export interface TheClub {
  tiers: { name: ClubTierName; level: 1 | 2 | 3; pieces: number; lines: string[] }[];
  tierThresholds: number[];
  creditCurrency: string;
  /** The welcome gift of each tier while its model is active: its name, and its photograph. */
  gifts: { tier: ClubTierName; model: string; imageUrl: string | null }[];
}

/** GET /api/v1/club/status: the account's standing, its benefits and the next tier (P-X04), and its entries in the drops (newest drop first). */
export interface ClubStatus {
  tier: { level: ClubTier; name: ClubTierName | null };
  pieces: number;
  seniority: number;
  /** P-X04: the benefits of the account's tier and of those below it, the lowest tier first; [] without a tier. */
  benefits: string[];
  /** P-X04: the next tier; null at PALLADIUM, the highest. */
  next: ClubNextTier | null;
  /** BP-19 T10: what THE PROGRAM gives the account's tier now (effectiveProgramLines); [] without a tier. */
  program: string[];
  /** BP-19 T10: its benefits in use. */
  inUse: ClubInUse;
  /** The pieces held now each tier starts from, TITANE first (CLUB_TIER_THRESHOLDS): YOUR TIER's meter has a dot per piece up to the last (plan NEXT-NINE, BP-19 T1). */
  tierThresholds: number[];
  entries: AccountDropEntry[];
}

/** One tier as the console's Tiers tab reads it (GET /api/admin/club/tiers, P-X04). */
export interface ClubTierSheet {
  tier: ClubTierName;
  level: 1 | 2 | 3;
  /** The pieces held now it starts from (a constant of the code, never changed from the console). */
  pieces: number;
  /** Its words now: the console's, or the default ones; one benefit per line. */
  benefits: string;
  /** Its words by default (CLUB_TIER_DEFAULT_BENEFITS). */
  defaultBenefits: string;
  /** The console changed its words (a row of club_tiers). */
  edited: boolean;
  /** When the console last changed them; null while they are the default ones. */
  updatedAt: Date | null;
}

export interface ClubServiceDeps {
  db: Db;
  drops: DropService;
  audit: AuditService;
  clock?: Clock;
}

export class ClubService {
  private readonly db: Db;
  private readonly drops: DropService;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: ClubServiceDeps) {
    this.db = deps.db;
    this.drops = deps.drops;
    this.audit = deps.audit;
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

  /**
   * The account's place in the club, the benefits of its tier and of those below it, the next tier, and its entries
   * (GET /api/v1/club/status): any signed-in account.
   */
  async status(accountId: string): Promise<ClubStatus> {
    // The tiers' grants (plan NEXT-NINE, BP-19 T5), made here too when the tier was reached without a write that makes them.
    await inTransaction(this.db, async (tx) => {
      for (const n of await ensureGrants(tx, accountId, this.clock())) await this.audit.record(n, tx);
    });
    const [standing, words, entries, program] = await Promise.all([this.tierOf(accountId), this.benefitWords(this.db), this.drops.accountEntries(accountId), readProgram(this.db)]);
    const gifts = await activeGifts(this.db, program);
    const giftNames = { 2: gifts[2]?.name ?? null, 3: gifts[3]?.name ?? null };
    const nextLevel = standing.tier + 1;
    const next: ClubNextTier | null =
      nextLevel <= CLUB_TIER_NAMES.length
        ? {
            level: nextLevel as 1 | 2 | 3,
            name: CLUB_TIER_NAMES[nextLevel - 1]!,
            pieces: CLUB_TIER_THRESHOLDS[nextLevel - 1]!,
            missing: Math.max(1, CLUB_TIER_THRESHOLDS[nextLevel - 1]! - standing.pieces),
            benefits: benefitLines(words[CLUB_TIER_NAMES[nextLevel - 1]!]),
            program: programLines(program, nextLevel as 1 | 2 | 3, giftNames),
          }
        : null;
    return {
      tier: { level: standing.tier, name: tierName(standing.tier) },
      pieces: standing.pieces,
      seniority: standing.seniority,
      benefits: CLUB_TIER_NAMES.slice(0, standing.tier).flatMap((name) => benefitLines(words[name])),
      next,
      program: effectiveProgramLines(program, standing.tier, giftNames),
      inUse: await this.inUse(accountId, standing.tier, program),
      tierThresholds: [...CLUB_TIER_THRESHOLDS],
      entries,
    };
  }

  /** The account's benefits in use now (ClubInUse): its credit, its yearly care of the year, its welcome gifts. */
  async inUse(accountId: string, tier: ClubTier, program?: ClubProgram): Promise<ClubInUse> {
    const now = this.clock();
    const p = program ?? (await readProgram(this.db));
    // Usable now, PALLADIUM's first (creditBalances' order); one currency shown, the first grant's.
    const open = (await creditBalances(this.db, accountId)).filter((g) => g.tier <= tier && g.balanceMinor > 0 && g.expiresAt.getTime() > now.getTime());
    const usable = open.filter((g) => g.currency === open[0]?.currency);
    const credit = usable.length
      ? { balanceMinor: usable.reduce((n, g) => n + g.balanceMinor, 0), currency: usable[0]!.currency, expiresAt: new Date(Math.min(...usable.map((g) => g.expiresAt.getTime()))) }
      : null;
    const year = await careThisYear(this.db, accountId, now, p);
    const care = year.allowance === 0 ? null : { year: year.year, used: year.used, allowance: year.allowance };
    const grants = await this.db
      .selectFrom('tier_grants as g')
      .leftJoin('orders as o', (j) => j.onRef('o.gift_grant_id', '=', 'g.id').on('o.status', '<>', 'CANCELLED'))
      .leftJoin('models as m', 'm.id', 'g.model_id')
      .select(['g.tier', 'o.status', 'o.with_order_id', 'm.name', 'm.variant_label'])
      .where('g.account_id', '=', accountId)
      .where('g.kind', '=', 'GIFT')
      .orderBy('g.tier')
      .execute();
    const active = await activeGifts(this.db, p);
    const gifts: ClubInUse['gifts'] = [];
    for (const g of grants) {
      const name = tierName(g.tier as ClubTier)!;
      if (g.status) {
        if (g.status === 'DELIVERED' || g.status === 'RETURNED') continue;
        const model = g.name ? `${g.name.toUpperCase()}${g.variant_label ? ` IN ${g.variant_label.toUpperCase()}` : ''}` : '';
        gifts.push({ tier: name, model, state: 'WITH_ORDER', orderReference: g.with_order_id ? orderReference(g.with_order_id) : null });
      } else {
        const a = active[g.tier as 2 | 3];
        if (g.tier <= tier && a) gifts.push({ tier: name, model: a.name, state: 'PENDING', orderReference: null });
      }
    }
    return { credit, care, gifts };
  }

  /** THE CLUB (GET /api/v1/the-club, public): every tier's program lines then its words, the credit's currency, the gifts. */
  async theClub(): Promise<TheClub> {
    const [words, program] = await Promise.all([this.benefitWords(this.db), readProgram(this.db)]);
    const gifts = await activeGifts(this.db, program);
    const names = { 2: gifts[2]?.name ?? null, 3: gifts[3]?.name ?? null };
    return {
      tiers: CLUB_TIER_NAMES.map((name, i) => {
        const level = (i + 1) as 1 | 2 | 3;
        return { name, level, pieces: CLUB_TIER_THRESHOLDS[i]!, lines: [...programLines(program, level, names), ...benefitLines(words[name])] };
      }),
      tierThresholds: [...CLUB_TIER_THRESHOLDS],
      creditCurrency: program.creditCurrency,
      gifts: ([2, 3] as const).flatMap((t) => {
        const g = gifts[t];
        return g ? [{ tier: tierName(t)!, model: g.name, imageUrl: g.imageUrl }] : [];
      }),
    };
  }

  // ── The tiers' benefits (P-X04) ────────────────────────────────────────────

  /** Every tier's words now: the console's where it changed them, the default ones otherwise. */
  private async benefitWords(db: Db): Promise<Record<ClubTierName, string>> {
    const rows = await db.selectFrom('club_tiers').select(['tier', 'benefits']).execute();
    const out: Record<ClubTierName, string> = { ...CLUB_TIER_DEFAULT_BENEFITS };
    for (const r of rows) if ((CLUB_TIER_NAMES as readonly string[]).includes(r.tier)) out[r.tier] = r.benefits;
    return out;
  }

  /** The three tiers as the console's Tiers tab reads them (GET /api/admin/club/tiers), TITANE first. */
  async tiers(db: Db = this.db): Promise<ClubTierSheet[]> {
    const rows = await db.selectFrom('club_tiers').select(['tier', 'benefits', 'updated_at']).execute();
    return CLUB_TIER_NAMES.map((name, i) => {
      const row = rows.find((r) => r.tier === name);
      return {
        tier: name,
        level: (i + 1) as 1 | 2 | 3,
        pieces: CLUB_TIER_THRESHOLDS[i]!,
        benefits: row?.benefits ?? CLUB_TIER_DEFAULT_BENEFITS[name],
        defaultBenefits: CLUB_TIER_DEFAULT_BENEFITS[name],
        edited: row !== undefined,
        updatedAt: row ? new Date(row.updated_at) : null,
      };
    });
  }

  /**
   * Change a tier's words (PATCH /api/admin/club/tiers/:tier, OPERATOR): one benefit per line (normalizeBenefits);
   * null, blank text or the default words exactly restore the default ones (the tier's row is removed). Audited
   * `club.tier.update` with the words set (null: the default ones) and the previous ones. 404 TIER_NOT_FOUND for a name
   * that is not a tier.
   */
  async updateTier(name: string, benefits: unknown, actor: Actor): Promise<ClubTierSheet> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only an ORBES admin can change the benefits of a tier.');
    if (!(CLUB_TIER_NAMES as readonly string[]).includes(name)) throw tierNotFound();
    const tier = name as ClubTierName;
    const normalized = normalizeBenefits(benefits);
    const words = normalized === CLUB_TIER_DEFAULT_BENEFITS[tier] ? null : normalized;
    return inTransaction(this.db, async (tx) => {
      const before = await tx.selectFrom('club_tiers').select('benefits').where('tier', '=', tier).forUpdate().executeTakeFirst();
      if (words === null) {
        await tx.deleteFrom('club_tiers').where('tier', '=', tier).execute();
      } else {
        const now = this.clock();
        await tx
          .insertInto('club_tiers')
          .values({ tier, benefits: words, updated_by: actor.id!, updated_at: now })
          .onConflict((oc) => oc.column('tier').doUpdateSet({ benefits: words, updated_by: actor.id!, updated_at: now }))
          .execute();
      }
      await this.audit.record({ actor, action: 'club.tier.update', targetType: 'club_tier', targetId: tier, details: { tier, benefits: words, previous: before?.benefits ?? null } }, tx);
      return (await this.tiers(tx)).find((t) => t.tier === tier)!;
    });
  }
}
