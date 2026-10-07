/**
 * The tiers' grants (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T5; migration 0027): on reaching PLATINE or PALLADIUM, an
 * account receives that tier's welcome GIFT and its CREDIT, **once per tier and per account, ever** (`tier_grants_once`:
 * PLATINE, then TITANE, then PLATINE again gives no new row; a row is never deleted).
 *
 *   granted      `ensureGrants`, in the transaction that may raise the tier: a first registration and a transfer
 *                accepted (services/ownership.ts, after the ownership's insert), a piece reinstated
 *                (services/lifecycle.ts), each order's creation (services/orders.ts), and idempotently at each status
 *                read (ClubService.status); at boot, `prepare` for every ACTIVE account at PLATINE or PALLADIUM. For each
 *                tier from PLATINE to the one held now: its GIFT, and its CREDIT of THE PROGRAM's amount in THE
 *                PROGRAM's currency, valid THE PROGRAM's months from now (a credit of 0 is not created). Audited
 *                `club.grant` (the system as actor), only for a row inserted.
 *   waiting      a grant waits while the account is below its tier: its gift is added to no order, its credit taken
 *                off none; it comes back with its expiry unchanged. There is no grace period.
 *   the gift     added to the account's next order (services/orders.ts attachGifts) while its tier has an active gift
 *                model (THE PROGRAM): a GIFT order at 0, travelling with it.
 *   the credit   taken off an order's invoice by Client Services (services/orders.ts applyCredit): its balance is its
 *                amount less its open uses (`credit_uses`); PALLADIUM's grant first, then the earliest expiry.
 *
 * Lock order: the account's grants after the rows of the sale or the order that reads them; the audit log last (the
 * entries are returned for the caller to write after its own).
 */
import { inTransaction, type Db } from '../db/connection.js';
import type { CreditReleaseReason, TierGrantKind, TierGrantRow } from '../db/schema.js';
import { SYSTEM_ACTOR, systemClock, type Clock, type Logger, noopLogger } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_THRESHOLDS, tierOf } from './club.js';
import { creditOf, readProgram } from './club-program.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `from` moved `months` calendar months, in UTC (31 January + 1 month: the last day of February). */
export function addUtcMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * The grants of every tier the account holds now, from PLATINE up, inserted when missing (ON CONFLICT DO NOTHING: once
 * per tier and kind, ever), in the caller's transaction. Returns the audit entries of the rows inserted (`club.grant`,
 * the system as actor), for the caller to write after its own.
 */
export async function ensureGrants(tx: Db, accountId: string, now: Date): Promise<AuditRecordInput[]> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) return [];
  const standing = await tierOf(tx, accountId, now);
  if (standing.tier < 2) return [];
  const program = await readProgram(tx);
  const notes: AuditRecordInput[] = [];
  for (const tier of [2, 3] as const) {
    if (standing.tier < tier) continue;
    const credit = creditOf(program, tier);
    const rows: { kind: TierGrantKind; amount_minor: number | null; currency: string | null; expires_at: Date | null }[] = [
      { kind: 'GIFT', amount_minor: null, currency: null, expires_at: null },
      ...(credit > 0 ? [{ kind: 'CREDIT' as const, amount_minor: credit, currency: program.creditCurrency, expires_at: addUtcMonths(now, program.creditValidityMonths) }] : []),
    ];
    for (const r of rows) {
      const inserted = await tx
        .insertInto('tier_grants')
        .values({ account_id: accountId, tier, kind: r.kind, granted_at: now, amount_minor: r.amount_minor, currency: r.currency, expires_at: r.expires_at })
        .onConflict((oc) => oc.constraint('tier_grants_once').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) continue;
      notes.push({
        actor: SYSTEM_ACTOR,
        action: 'club.grant',
        targetType: 'account',
        targetId: accountId,
        details: {
          grantId: inserted.id,
          tier,
          kind: r.kind,
          ...(r.kind === 'CREDIT' ? { amountMinor: r.amount_minor, currency: r.currency, expiresAt: r.expires_at!.toISOString() } : {}),
        },
      });
    }
  }
  return notes;
}

/** A credit grant with its balance now: its amount less its open uses. */
export interface CreditBalance {
  grantId: string;
  tier: 2 | 3;
  amountMinor: number;
  balanceMinor: number;
  currency: string;
  expiresAt: Date;
}

/**
 * The account's credit grants with their balances (every one, expired or not, whatever its tier now), PALLADIUM's
 * first, then the earliest expiry: the order a credit is taken off them. `forUpdate`: their rows locked (in the order's
 * transaction, after the order's row).
 */
export async function creditBalances(db: Db, accountId: string, opts: { forUpdate?: boolean } = {}): Promise<CreditBalance[]> {
  let q = db
    .selectFrom('tier_grants')
    .select(['id', 'tier', 'amount_minor', 'currency', 'expires_at'])
    .where('account_id', '=', accountId)
    .where('kind', '=', 'CREDIT')
    .orderBy('tier', 'desc')
    .orderBy('expires_at')
    .orderBy('id');
  if (opts.forUpdate) q = q.forUpdate();
  const grants = await q.execute();
  if (grants.length === 0) return [];
  const used = await db
    .selectFrom('credit_uses')
    .select((eb) => ['grant_id', eb.fn.sum<string>('amount_minor').as('used')])
    .where('grant_id', 'in', grants.map((g) => g.id))
    .where('released_at', 'is', null)
    .groupBy('grant_id')
    .execute();
  const usedOf = new Map(used.map((u) => [u.grant_id, Number(u.used)]));
  return grants.map((g) => ({
    grantId: g.id,
    tier: g.tier as 2 | 3,
    amountMinor: g.amount_minor!,
    balanceMinor: Math.max(0, g.amount_minor! - (usedOf.get(g.id) ?? 0)),
    currency: g.currency!,
    expiresAt: g.expires_at!,
  }));
}

/** An account's grants as their rows hold them, its tiers in order (the console's, the export's). */
export async function accountGrants(db: Db, accountId: string): Promise<TierGrantRow[]> {
  return db.selectFrom('tier_grants').selectAll().where('account_id', '=', accountId).orderBy('tier').orderBy('kind').execute();
}

/** Why a credit taken off an order is given back, by the step that gives it back. */
export const CREDIT_RELEASE_OF: Readonly<Record<'remove' | 'cancel' | 'return', CreditReleaseReason>> = Object.freeze({ remove: 'REMOVED', cancel: 'CANCELLED', return: 'RETURNED' });

// ── Service ────────────────────────────────────────────────────────────────

export interface TierGrantServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
}

export class TierGrantService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: TierGrantServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /** The account's grants made now (ensureGrants) in a transaction of their own, audited. Returns how many were inserted. */
  async ensure(accountId: string): Promise<number> {
    return inTransaction(this.db, async (tx) => {
      const notes = await ensureGrants(tx, accountId, this.clock());
      for (const n of notes) await this.audit.record(n, tx);
      return notes.length;
    });
  }

  /**
   * At boot (with OrderService.prepare): the grants of every ACTIVE account at PLATINE or PALLADIUM (the pieces it holds
   * now, as the club counts them), each account in its own transaction; idempotent. A failure is logged, and the next
   * boot or the account's next status read grants them. Returns how many grants were inserted.
   */
  async prepare(): Promise<number> {
    const rows = await this.db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .select((eb) => ['o.account_id', eb.fn.countAll<number>().as('pieces')])
      .where('o.ended_at', 'is', null)
      .where('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
      .where('a.status', '=', 'ACTIVE')
      .groupBy('o.account_id')
      .having((eb) => eb.fn.countAll(), '>=', CLUB_TIER_THRESHOLDS[1]!)
      .orderBy('o.account_id')
      .execute();
    let inserted = 0;
    for (const r of rows) {
      try {
        inserted += await this.ensure(r.account_id);
      } catch (e) {
        this.log.error({ accountId: r.account_id, err: { message: (e as Error)?.message } }, 'the grants of an account could not be made at boot');
      }
    }
    return inserted;
  }
}
