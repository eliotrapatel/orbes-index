/**
 * LifecycleService — the product status state machine (contract §2.6).
 *
 * The machine is data: `TRANSITIONS` lists every status reachable from each
 * status, exactly as the contract table. Some exits are "return" moves
 * (`RETURN_TO_PREVIOUS`): leaving SERVICED back to the pre-service status,
 * recovering from LOST/STOLEN, clearing a COUNTERFEIT_FLAGGED flag, and
 * reinstating a REVOKED product. Those are only allowed towards the ONE
 * status the product held before, which is derived from
 * `product_status_history` (see `computeReturnStack`), never stored
 * separately, so it cannot drift from the audit trail.
 *
 * Every change (a) locks the product row, (b) updates products.status,
 * (c) appends product_status_history, (d) writes its entry of the event
 * journal (services/journal.ts), (e) writes a hash-chained audit entry,
 * all in one transaction. Moving to REVOKED also opens a `revocations` row;
 * reinstatement lifts it.
 *
 * Public error messages never name statuses (account-facing flows reuse
 * this service); the statuses go into DomainError.internal for logs.
 */
import { inTransaction, type Db } from '../db/connection.js';
import {
  PRODUCT_STATUSES,
  type OwnershipState,
  type ProductRow,
  type ProductStatus,
} from '../db/schema.js';
import { DomainError, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type ActorType, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { CLUB_EXCLUDED_STATUSES } from './club.js';
import { productPayload, writeJournal } from './journal.js';
import { ensureGrants } from './tier-grants.js';

// ── The state machine (data) ───────────────────────────────────────────────

const S = <T extends ProductStatus[]>(...s: T): readonly ProductStatus[] => Object.freeze(s);

/** Statuses a product can come back to after a LOST/STOLEN or counterfeit episode. */
const NON_INCIDENT = S('ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD');

/**
 * Contract §2.6, row for row. REVOKED leaves only through `reinstate()`; RETIRED is terminal. RESERVED (migration 0022:
 * an identity reserved for a piece to make) leaves through no transition: since the atelier went (plan NEXT LOT §3.5.8,
 * step 5.13) the identities already reserved stay reserved and unused, as the owner decided.
 */
export const TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = Object.freeze({
  RESERVED: S(),
  // ISSUED → SERVICED: pre-sale inspection / quality control; the return move goes back to ISSUED.
  ISSUED: S('ACTIVATED', 'SERVICED', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  ACTIVATED: S('REGISTERED', 'OWNED', 'SERVICED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  REGISTERED: S('OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  OWNED: S('TRANSFERRED', 'SERVICED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  TRANSFERRED: S('OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  SERVICED: S('ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  RESOLD: S('REGISTERED', 'OWNED', 'SERVICED', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'),
  LOST: S(...NON_INCIDENT, 'RETIRED', 'REVOKED'),
  STOLEN: S(...NON_INCIDENT, 'RETIRED', 'REVOKED'),
  COUNTERFEIT_FLAGGED: S(...NON_INCIDENT, 'REVOKED', 'RETIRED'),
  REVOKED: S(),
  RETIRED: S(),
});

/**
 * For these statuses, the listed targets are "return" moves: allowed only
 * towards the status held before entering the current one.
 */
export const RETURN_TO_PREVIOUS: Readonly<Partial<Record<ProductStatus, readonly ProductStatus[]>>> = Object.freeze({
  SERVICED: S('ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'RESOLD'),
  LOST: NON_INCIDENT,
  STOLEN: NON_INCIDENT,
  COUNTERFEIT_FLAGGED: NON_INCIDENT,
});

/** Statuses that suspend another one, which a later return/reinstatement restores. */
export const SUSPENDING_STATUSES: readonly ProductStatus[] = S('SERVICED', 'LOST', 'STOLEN', 'COUNTERFEIT_FLAGGED', 'REVOKED');

export const TERMINAL_STATUSES: readonly ProductStatus[] = S('RETIRED');

const MAX_REASON = 1000;
const REASON_CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^O[0-9]{2}-[A-Z]-[0-9]{5,6}$/;

export function isProductStatus(v: unknown): v is ProductStatus {
  return typeof v === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(v);
}

// ── History replay (pure) ──────────────────────────────────────────────────

export interface HistoryStep {
  from: ProductStatus | null;
  to: ProductStatus;
}

/**
 * Replay status history and return the stack of suspended statuses: the top
 * is where a return/reinstatement from the current status goes.
 *
 *   OWNED →SERVICED          [OWNED]
 *   SERVICED →REVOKED        [OWNED, SERVICED]
 *   REVOKED →SERVICED (reinstate)  [OWNED]
 *   SERVICED →OWNED (return) []
 *
 * Entering a suspending status from a normal one starts a new episode;
 * moving between suspending statuses pushes; a move to the top of the stack
 * pops; any other move to a normal status ends the episode.
 */
export function computeReturnStack(steps: readonly HistoryStep[]): ProductStatus[] {
  let stack: ProductStatus[] = [];
  for (const { from, to } of steps) {
    if (from === null) {
      stack = [];
      continue;
    }
    const fromSuspending = SUSPENDING_STATUSES.includes(from);
    const isReturn = fromSuspending && stack.length > 0 && stack[stack.length - 1] === to;
    if (isReturn) {
      stack.pop();
      if (!SUSPENDING_STATUSES.includes(to)) stack = [];
    } else if (SUSPENDING_STATUSES.includes(to)) {
      if (fromSuspending) stack.push(from);
      else stack = [from];
    } else {
      stack = [];
    }
  }
  return stack;
}

/**
 * Where a return move from `current` would go, or null. Requires the history
 * to end in `current`; if it does not (rows written outside this service),
 * the target is unknown rather than guessed.
 */
export function returnTargetFromHistory(steps: readonly HistoryStep[], current: ProductStatus): ProductStatus | null {
  if (!SUSPENDING_STATUSES.includes(current)) return null;
  if (steps.length === 0 || steps[steps.length - 1].to !== current) return null;
  const stack = computeReturnStack(steps);
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Whether `from → to` is allowed by the table, given the computed return target. Pure. */
export function isTransitionAllowed(from: ProductStatus, to: ProductStatus, returnTarget: ProductStatus | null): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  const returns = RETURN_TO_PREVIOUS[from];
  if (returns?.includes(to)) return to === returnTarget;
  return true;
}

/** Allowed next statuses (in table order) given the computed return target. Pure. */
export function allowedFrom(from: ProductStatus, returnTarget: ProductStatus | null): ProductStatus[] {
  return TRANSITIONS[from].filter((to) => isTransitionAllowed(from, to, returnTarget));
}

/**
 * Order history rows chronologically. Rows written in the same millisecond
 * (older data, or other writers) are chained: the next row is the one whose
 * `from` is the status the previous row ended in.
 */
export function orderHistory<T extends HistoryStep & { at: Date; id: string }>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  const out: T[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].at.getTime() === sorted[i].at.getTime()) j++;
    const group = sorted.slice(i, j);
    while (group.length > 0) {
      const current = out.length > 0 ? out[out.length - 1].to : null;
      let k = group.findIndex((r) => r.from === current);
      if (k < 0) k = 0;
      out.push(group.splice(k, 1)[0]);
    }
    i = j;
  }
  return out;
}

// ── Product lookup (shared with ownership / warranty) ──────────────────────

/**
 * Find a product by its uuid (`products.id`) or canonical id (`O26-J-00184`).
 * `forUpdate` takes a row lock: use it inside the transaction that changes it.
 */
export async function findProduct(db: Db, ref: unknown, opts: { forUpdate?: boolean } = {}): Promise<ProductRow | undefined> {
  if (typeof ref !== 'string' || ref.length > 64) return undefined;
  const s = ref.trim();
  let q = db.selectFrom('products').selectAll();
  if (UUID_RE.test(s)) q = q.where('id', '=', s.toLowerCase());
  else if (PRODUCT_ID_RE.test(s.toUpperCase())) q = q.where('product_id', '=', s.toUpperCase());
  else return undefined;
  if (opts.forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function requireProduct(db: Db, ref: unknown, opts: { forUpdate?: boolean } = {}): Promise<ProductRow> {
  const p = await findProduct(db, ref, opts);
  if (!p) throw notFound('Product', 'PRODUCT_NOT_FOUND');
  return p;
}

/** Optional free-text reason: trimmed, bounded, no control characters except newlines and tabs. */
export function cleanReason(v: unknown, field = 'Reason', required = false): string | null {
  if (v === undefined || v === null) {
    if (required) throw validationError(`${field} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${field} must be text.`);
  const s = v.trim();
  if (s === '') {
    if (required) throw validationError(`${field} is required.`);
    return null;
  }
  if (s.length > MAX_REASON) throw validationError(`${field} is too long.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) throw validationError(`${field} contains invalid characters.`);
  return s;
}

/** Audit / revocation representation of an actor, e.g. 'admin:3f0c…' or 'system'. */
export function actorLabel(actor: Actor): string {
  return actor.id ? `${actor.type}:${actor.id}` : actor.type;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface TransitionOptions {
  reason?: string | null;
  /** For moves to REVOKED: machine reason stored on the revocation (UPPER_SNAKE). */
  revocationReasonCode?: string;
}

export interface StatusChange {
  /** products.id (uuid). */
  id: string;
  /** Canonical product id. */
  productId: string;
  from: ProductStatus;
  to: ProductStatus;
  reason: string | null;
  at: Date;
}

export interface StatusHistoryEntry {
  id: string;
  from: ProductStatus | null;
  to: ProductStatus;
  reason: string | null;
  actorType: ActorType;
  actorId: string | null;
  at: Date;
}

export interface LifecycleSnapshot {
  status: ProductStatus;
  /** Allowed `transition()` targets. */
  allowed: ProductStatus[];
  /** Where a return/recovery/reinstatement from the current status leads, if any. */
  returnTo: ProductStatus | null;
  /** True when the product is REVOKED and its pre-revocation status is known. */
  canReinstate: boolean;
}

/** Options for status changes made on behalf of sibling services (ownership, warranty). @internal */
export interface ServiceTransitionOptions {
  reason: string | null;
  /** Audit `details.via`, e.g. 'ownership.register'. */
  via: string;
  /** Set products.ownership_state in the same UPDATE (one statement keeps updated_at on the injected clock). */
  ownershipState?: OwnershipState;
  /**
   * First registration may happen while the product is SERVICED (contract
   * §2.4 step 10 offers it): allow SERVICED → REGISTERED/OWNED even when that
   * is not the pre-service status.
   */
  registrationFromService?: boolean;
}

export class LifecycleService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: { db: Db; audit: AuditService; clock?: Clock }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Move a product to `to`. Throws 409 TRANSITION_NOT_ALLOWED when the table
   * (or the return rule) forbids it. `productId` is the uuid or canonical id.
   */
  async transition(productId: string, to: ProductStatus, opts: TransitionOptions = {}, actor: Actor, trx?: Db): Promise<StatusChange> {
    if (!isProductStatus(to)) throw validationError('Unknown product status.');
    const reason = cleanReason(opts.reason);
    const reasonCode = opts.revocationReasonCode;
    if (reasonCode !== undefined && !REASON_CODE_RE.test(reasonCode)) throw validationError('Invalid revocation reason code.');

    return inTransaction(trx ?? this.db, async (tx) => {
      const product = await requireProduct(tx, productId, { forUpdate: true });
      if (product.status === 'REVOKED') {
        throw notAllowed(product.status, to, 'a revoked product can only be reinstated');
      }
      const target = await this.returnTargetOf(tx, product);
      if (!isTransitionAllowed(product.status, to, target)) {
        const returns = RETURN_TO_PREVIOUS[product.status];
        if (returns?.includes(to) && TRANSITIONS[product.status].includes(to)) {
          if (target === null) throw previousUnknown(product.status);
          throw notAllowed(product.status, to, `only a return to ${target} is allowed`);
        }
        throw notAllowed(product.status, to);
      }
      return this.apply(tx, product, to, { reason, reasonCode, action: 'product.transition' }, actor);
    });
  }

  /**
   * Lift a revocation: REVOKED → the status held before the revocation.
   * Authorisation (ADMIN only) is enforced by the route; the actor is recorded.
   */
  async reinstate(productId: string, reason: string | null | undefined, actor: Actor, trx?: Db): Promise<StatusChange> {
    // Optional: the contract's reinstate route carries no body. Routes should still pass one when they have it.
    const why = cleanReason(reason);
    return inTransaction(trx ?? this.db, async (tx) => {
      const product = await requireProduct(tx, productId, { forUpdate: true });
      if (product.status !== 'REVOKED') {
        throw new DomainError('NOT_REVOKED', 409, 'This product is not revoked.', { detail: `status ${product.status}` });
      }
      const target = await this.returnTargetOf(tx, product);
      if (target === null) throw previousUnknown(product.status);
      return this.apply(tx, product, target, { reason: why, action: 'product.reinstate' }, actor);
    });
  }

  /** Status history, oldest first. */
  async history(productId: string): Promise<StatusHistoryEntry[]> {
    const product = await requireProduct(this.db, productId);
    const rows = await this.loadHistory(this.db, product.id);
    return rows.map((r) => ({ id: r.id, from: r.from, to: r.to, reason: r.reason, actorType: r.actorType, actorId: r.actorId, at: r.at }));
  }

  /** Statuses `transition()` would accept right now. Empty for REVOKED (use reinstate) and RETIRED. */
  async allowedTransitions(productId: string): Promise<ProductStatus[]> {
    return (await this.snapshot(productId)).allowed;
  }

  /** Current status, allowed moves and return target in one read (admin product page). */
  async snapshot(productId: string, trx?: Db): Promise<LifecycleSnapshot> {
    const db = trx ?? this.db;
    const product = await requireProduct(db, productId);
    const returnTo = await this.returnTargetOf(db, product);
    const revoked = product.status === 'REVOKED';
    return {
      status: product.status,
      allowed: revoked ? [] : allowedFrom(product.status, returnTo),
      returnTo,
      canReinstate: revoked && returnTo !== null,
    };
  }

  /** Where a return move from the current status leads (pre-service, pre-incident, pre-revocation), or null. */
  async previousStatus(productId: string, trx?: Db): Promise<ProductStatus | null> {
    const db = trx ?? this.db;
    const product = await requireProduct(db, productId);
    return this.returnTargetOf(db, product);
  }

  /**
   * A SERVICED product whose service started before sale (ISSUED → SERVICED:
   * inspection, quality control). Such a piece was never sold, so it is not
   * open for first registration until it has been activated.
   */
  async isPreSaleService(productId: string, trx?: Db): Promise<boolean> {
    const db = trx ?? this.db;
    return isPreSaleService(db, await requireProduct(db, productId));
  }

  /**
   * Status change on behalf of OwnershipService / WarrantyService, inside
   * THEIR transaction, on a product row they already locked FOR UPDATE.
   * Same table and return rules as `transition()`. @internal
   */
  async applyForService(tx: Db, product: ProductRow, to: ProductStatus, opts: ServiceTransitionOptions, actor: Actor): Promise<StatusChange> {
    if (!tx.isTransaction) throw new Error('applyForService must run inside a transaction');
    if (product.status === 'REVOKED') throw notAllowed(product.status, to);
    const target = await this.returnTargetOf(tx, product);
    // First registration during an after-sale service; never during a pre-sale (ISSUED → SERVICED) one.
    const registrationOverride =
      opts.registrationFromService === true && product.status === 'SERVICED' && target !== 'ISSUED' && (to === 'REGISTERED' || to === 'OWNED');
    if (!registrationOverride && !isTransitionAllowed(product.status, to, target)) {
      throw notAllowed(product.status, to);
    }
    return this.apply(
      tx,
      product,
      to,
      { reason: opts.reason, action: 'product.transition', via: opts.via, ownershipState: opts.ownershipState },
      actor,
    );
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async returnTargetOf(db: Db, product: ProductRow): Promise<ProductStatus | null> {
    return returnTargetOf(db, product);
  }

  private async loadHistory(db: Db, productUuid: string) {
    return loadStatusHistory(db, productUuid);
  }

  private async apply(
    tx: Db,
    product: ProductRow,
    to: ProductStatus,
    opts: { reason: string | null; action: string; reasonCode?: string; via?: string; ownershipState?: OwnershipState },
    actor: Actor,
  ): Promise<StatusChange> {
    const now = this.clock();
    // History order must be strict per product: bump by 1 ms past the latest row if the clock has not moved.
    const last = await tx
      .selectFrom('product_status_history')
      .select('created_at')
      .where('product_id', '=', product.id)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const at = last && last.created_at.getTime() >= now.getTime() ? new Date(last.created_at.getTime() + 1) : now;

    await tx
      .updateTable('products')
      .set({ status: to, updated_at: now, ...(opts.ownershipState ? { ownership_state: opts.ownershipState } : {}) })
      .where('id', '=', product.id)
      .execute();
    await tx
      .insertInto('product_status_history')
      .values({
        product_id: product.id,
        from_status: product.status,
        to_status: to,
        reason: opts.reason,
        actor_type: actor.type,
        actor_id: actor.id ?? null,
        created_at: at,
      })
      .execute();

    if (to === 'REVOKED') {
      await tx
        .insertInto('revocations')
        .values({
          target_type: 'PRODUCT',
          target_id: product.product_id,
          reason_code: opts.reasonCode ?? defaultRevocationCode(product.status),
          reason: opts.reason,
          created_by: actorLabel(actor),
          created_at: now,
        })
        .execute();
    }
    if (product.status === 'REVOKED') {
      await tx
        .updateTable('revocations')
        .set({ lifted_at: now, lifted_by: actorLabel(actor) })
        .where('target_type', '=', 'PRODUCT')
        .where('target_id', '=', product.product_id)
        .where('lifted_at', 'is', null)
        .execute();
    }
    // The event journal (plan LIVE RELEASE+, N1): every change of a piece's status, in its transaction.
    await writeJournal(tx, [{ type: opts.action, entityType: 'product', entityId: product.id, payload: productPayload({ ...product, status: to }, at) }], at);
    // A piece counted again by the club (a reinstatement, a flag lifted): its owner's tiers' grants (plan NEXT-NINE,
    // BP-19 T5), before the audit entries.
    const granted: AuditRecordInput[] = [];
    if (CLUB_EXCLUDED_STATUSES.includes(product.status) && !CLUB_EXCLUDED_STATUSES.includes(to)) {
      const owner = await tx.selectFrom('ownership').select('account_id').where('product_id', '=', product.id).where('ended_at', 'is', null).executeTakeFirst();
      if (owner) granted.push(...(await ensureGrants(tx, owner.account_id, now)));
    }

    await this.audit.record(
      {
        actor,
        action: opts.action,
        targetType: 'product',
        targetId: product.product_id,
        details: {
          from: product.status,
          to,
          ...(opts.reason !== null ? { reason: opts.reason } : {}),
          ...(opts.via ? { via: opts.via } : {}),
          ...(to === 'REVOKED' ? { revocationReasonCode: opts.reasonCode ?? defaultRevocationCode(product.status) } : {}),
        },
      },
      tx,
    );
    for (const n of granted) await this.audit.record(n, tx);
    const fromStatus = product.status;
    // Keep the caller's in-memory row truthful for any follow-up work in the same transaction.
    product.status = to;
    product.updated_at = now;
    if (opts.ownershipState) product.ownership_state = opts.ownershipState;
    return { id: product.id, productId: product.product_id, from: fromStatus, to, reason: opts.reason, at };
  }
}

function defaultRevocationCode(previous: ProductStatus): string {
  switch (previous) {
    case 'COUNTERFEIT_FLAGGED':
      return 'COUNTERFEIT';
    case 'LOST':
      return 'LOST';
    case 'STOLEN':
      return 'STOLEN';
    default:
      return 'ADMIN_DECISION';
  }
}

function notAllowed(from: ProductStatus, to: ProductStatus, why?: string): DomainError {
  return new DomainError('TRANSITION_NOT_ALLOWED', 409, 'This status change is not allowed for this product.', {
    detail: `${from} → ${to}${why ? `: ${why}` : ''}`,
    from,
    to,
  });
}

function previousUnknown(status: ProductStatus): DomainError {
  return new DomainError('PREVIOUS_STATUS_UNKNOWN', 409, 'The previous status of this product cannot be determined.', {
    detail: `no return target recorded for ${status}`,
  });
}

/** Where a return move from the product's current status leads, or null (pure read of the history). */
export async function returnTargetOf(db: Db, product: Pick<ProductRow, 'id' | 'status'>): Promise<ProductStatus | null> {
  if (!SUSPENDING_STATUSES.includes(product.status)) return null;
  return returnTargetFromHistory(await loadStatusHistory(db, product.id), product.status);
}

/**
 * A SERVICED product whose service started before sale (ISSUED → SERVICED:
 * inspection, quality control): never sold, so not open for first
 * registration (ownership registration and verification step 10).
 */
export async function isPreSaleService(db: Db, product: Pick<ProductRow, 'id' | 'status'>): Promise<boolean> {
  return product.status === 'SERVICED' && (await returnTargetOf(db, product)) === 'ISSUED';
}

/** A product's status history, oldest first (ties ordered by chaining from → to). */
export async function loadStatusHistory(db: Db, productUuid: string) {
  const rows = await db
    .selectFrom('product_status_history')
    .select(['id', 'from_status', 'to_status', 'reason', 'actor_type', 'actor_id', 'created_at'])
    .where('product_id', '=', productUuid)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return orderHistory(
    rows.map((r) => ({
      id: r.id,
      from: r.from_status,
      to: r.to_status,
      reason: r.reason,
      actorType: r.actor_type,
      actorId: r.actor_id,
      at: r.created_at,
    })),
  );
}
