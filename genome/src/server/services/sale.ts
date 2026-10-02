/**
 * SaleService — the sale mode of a seller's phone (A-08, `/admin#/sale`).
 *
 * Two steps, so that an activation is always tied to a real scan of the
 * piece being sold, never to a product id typed or remembered:
 *
 *   1. lookup   the decoded code is judged by the decision steps of
 *               /api/v1/verify (VerificationService.staffScan: structure,
 *               key, signature, revoked-key trust, registry, genome
 *               cross-check, code and product status), recorded as ONE
 *               ADMIN_TEST scan naming the console user, outside the history
 *               rules (the code's own findings of steps 6–7 are recorded,
 *               marked staffScan). When the piece can be sold (an authentic,
 *               known piece that no client holds, whose warranty has not
 *               started and is not void, not in a service), a 10-minute
 *               single-use SALE_ACTIVATION scan token comes back with it,
 *               minted in the scan's own transaction.
 *   2. activate the token and a point of sale of the register: the token is
 *               used up and the warranty started (WarrantyService.activate,
 *               purchase date today, country of the point of sale) in one
 *               transaction. The token only works for the console user whose
 *               scan earned it; a refusal leaves it unused.
 *
 * The audit entry of the activation (`warranty.activate`) names the point of
 * sale and the scan (`saleScanId`); the scan event names the seller.
 */
import { inTransaction, type Db } from '../db/connection.js';
import type { VerificationState } from '../db/schema.js';
import { DomainError, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import { consumeScanToken, createScanToken, type ScanTokenFailure } from './scan-tokens.js';
import type { ScanMeta, StaffScanPiece, VerificationService, VerifyInput } from './verification.js';
import { ACTIVATABLE_STATUSES, type WarrantyRecord, type WarrantyService } from './warranty.js';
import type { StatusChange } from './lifecycle.js';

/** Lifetime of a sale token: the time between the scan and the gesture that activates. */
export const SALE_TOKEN_TTL_MS = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Why a scanned piece cannot be sold:
 *  - NOT_AUTHENTIC       the code did not verify as a registered ORBES piece in force (state ≠ AUTHENTIC);
 *  - WARRANTY_ACTIVE     its warranty has already started (sold before);
 *  - WARRANTY_VOID       its warranty was voided;
 *  - ALREADY_REGISTERED  a client account holds it: it has been sold, whatever its warranty says;
 *  - NOT_FOR_SALE        its status does not allow a sale: not one a warranty starts from, or in a
 *                        service (at the workshop, not at the counter; a pre-sale service would leave
 *                        the piece looking unsold, WarrantyService.activate refuses it too).
 */
export const SALE_REFUSALS = ['NOT_AUTHENTIC', 'WARRANTY_ACTIVE', 'WARRANTY_VOID', 'ALREADY_REGISTERED', 'NOT_FOR_SALE'] as const;
export type SaleRefusal = (typeof SALE_REFUSALS)[number];

export interface SaleLookup {
  scanId: string;
  state: VerificationState;
  piece: StaffScanPiece | null;
  /** The token that lets this console user activate this piece, or null with a refusal. */
  sale: { token: string; expiresAt: Date } | null;
  refusal: SaleRefusal | null;
}

export interface SaleActivation {
  warranty: WarrantyRecord;
  statusChange: StatusChange | null;
  /** The staff scan the token came from. */
  scanId: string;
}

/** The refusal for a looked-up piece, or null when it can be sold. */
export function saleRefusal(state: VerificationState, piece: StaffScanPiece | null): SaleRefusal | null {
  if (state !== 'AUTHENTIC' || !piece) return 'NOT_AUTHENTIC';
  if (piece.warranty.voided) return 'WARRANTY_VOID';
  if (piece.warranty.startDate !== null) return 'WARRANTY_ACTIVE';
  if (piece.registered) return 'ALREADY_REGISTERED';
  if (piece.status === 'SERVICED' || !ACTIVATABLE_STATUSES.includes(piece.status)) return 'NOT_FOR_SALE';
  return null;
}

function saleTokenError(reason: ScanTokenFailure): DomainError {
  switch (reason) {
    case 'USED':
      return new DomainError('SALE_TOKEN_USED', 409, 'This scan has already been used. Scan the piece again.');
    case 'EXPIRED':
      return new DomainError('SALE_TOKEN_EXPIRED', 410, 'This scan is more than 10 minutes old. Scan the piece again.');
    default:
      return new DomainError('SALE_TOKEN_INVALID', 400, 'This scan is not valid. Scan the piece again.', { detail: reason });
  }
}

export class SaleService {
  private readonly db: Db;
  private readonly verification: VerificationService;
  private readonly warranty: WarrantyService;
  private readonly clock: Clock;

  constructor(deps: { db: Db; verification: VerificationService; warranty: WarrantyService; clock?: Clock }) {
    this.db = deps.db;
    this.verification = deps.verification;
    this.warranty = deps.warranty;
    this.clock = deps.clock ?? systemClock;
  }

  /** Step 1: judge the scanned code, record the staff scan and, when the piece can be sold, mint its sale token. */
  async lookup(input: VerifyInput, actor: Actor, meta: ScanMeta = {}): Promise<SaleLookup> {
    const adminId = adminIdOf(actor);
    return this.verification.staffScan(input, { adminId, meta }, async (trx, scan) => {
      const refusal = saleRefusal(scan.state, scan.piece);
      let sale: SaleLookup['sale'] = null;
      if (refusal === null && scan.piece) {
        const t = await createScanToken(trx, {
          productId: scan.piece.productUuid,
          scanEventId: scan.scanId,
          purpose: 'SALE_ACTIVATION',
          now: scan.occurredAt,
          ttlMs: SALE_TOKEN_TTL_MS,
        });
        sale = { token: t.token, expiresAt: t.expiresAt };
      }
      return { scanId: scan.scanId, state: scan.state, piece: scan.piece, sale, refusal };
    });
  }

  /** Step 2: use up the token of this console user's scan and start the warranty at a point of sale, today. */
  async activate(input: { token: string; retailerId: string }, actor: Actor): Promise<SaleActivation> {
    const adminId = adminIdOf(actor);
    if (typeof input?.retailerId !== 'string' || input.retailerId.trim() === '') throw validationError('Choose the point of sale.');
    return inTransaction(this.db, async (tx) => {
      const consumed = await consumeScanToken(tx, input.token, { purpose: 'SALE_ACTIVATION', now: this.clock() });
      if (!consumed.ok) throw saleTokenError(consumed.reason);
      // Bound to the seller who scanned: a token seen by anyone else is worthless (the refusal rolls the use back).
      const scan = await tx.selectFrom('scan_events').select('admin_id').where('id', '=', consumed.scanEventId).executeTakeFirst();
      if (!scan || scan.admin_id === null || scan.admin_id.toLowerCase() !== adminId) throw saleTokenError('NOT_FOUND');
      const r = await this.warranty.activate(consumed.productId, { retailerId: input.retailerId }, actor, { tx, saleScanId: consumed.scanEventId });
      return { ...r, scanId: consumed.scanEventId };
    });
  }
}

function adminIdOf(actor: Actor): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw new TypeError('sale: the actor must be a console user');
  return actor.id.toLowerCase();
}
