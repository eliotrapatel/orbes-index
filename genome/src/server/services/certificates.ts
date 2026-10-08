/**
 * CertificateService — the certificate card 79t (render/certificate.ts, plan
 * NEXT LOT §3.2), which carries a product's ORBES CODE and its one-time claim
 * code in plain sight, as a PDF card, an A4 sheet of eight cards, or a CSV
 * for variable-data printing. The card draws the product's ACTIVE code, its
 * model's variant, its Size field and the year of its identity.
 *
 * The claim code is shown once at issuance and only its scrypt hash is
 * stored, so the console sends the code back with the request. Before
 * anything is drawn, every code is checked against its product's hash
 * (verifyClaimCode): a card printed with a mistyped code would lock the
 * buyer out of registration for good. The code is never kept: not stored,
 * not logged, not audited, never echoed in an error. Audit entries carry
 * product ids only, and `certificate.render` the issue of the ORBES CODE
 * printed for each (`codeIssues`, in `productIds` order).
 *
 * Refusals, in this order (each one audited as `certificate.render_refused`
 * with the product ids and the reason; nothing is rendered):
 *   404 PRODUCT_NOT_FOUND      an unknown product
 *   422 NO_CLAIM_SECRET        issued without a claim code
 *   409 PRODUCT_NOT_PRINTABLE  revoked, retired, flagged, lost or stolen
 *   409 NO_ACTIVE_CODE         no ACTIVE code to draw (revoked with no new one): re-issue it first
 *   409 CODE_INTEGRITY         the ACTIVE code failed its end-to-end check (IssuanceService.verifiedActiveCode:
 *                              payload fields and hash, genome, a trusted key, the signature), as every other
 *                              print of a code; the message names the issue and the piece, what failed is logged
 *   409 ALREADY_REGISTERED     the product has an owner: its claim code is spent
 *   422 CLAIM_CODE_MISMATCH    a code does not match its product's hash (the first one)
 * Mismatches are not counted towards the customers' claim-code attempt limit
 * (ownership.ts): this route needs an OPERATOR session with MFA, and every
 * refusal is in the audit log.
 *
 * Cost. Each check is one scrypt (32 MiB) on libuv's small thread pool, which
 * customers' logins and claim-code registrations share. So the checks run
 * one at a time and stop at the first code that does not match (a request of
 * wrong codes costs one scrypt), and each admin has at most one render in
 * progress: a second one answers 429 RATE_LIMITED until the first is done.
 */
import { computeGenome } from '../../core/genome/genome.js';
import type { Db } from '../db/connection.js';
import type { ProductRow } from '../db/schema.js';
import { DomainError, tooManyRequests, validationError } from '../errors.js';
import {
  CERTIFICATE_FORMATS,
  CERTIFICATE_LAYOUT_STATUS,
  CERTIFICATE_LAYOUTS,
  MAX_CERTIFICATE_ITEMS,
  renderCertificateCsv,
  renderCertificatePdf,
  type CertificateFormat,
  type CertificateItem,
  type CertificateLayout,
  type RenderedCertificates,
} from '../render/certificate.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { formatGrouped, normalizeClaimCode, verifyClaimCode } from './claim-codes.js';
import { NOT_PRINTABLE, type IssuanceService } from './issuance.js';
import { requireProduct } from './lifecycle.js';

export interface CertificateRequestItem {
  /** Canonical product id or row uuid. */
  productId: string;
  /** As shown at issuance (any spelling verifyClaimCode accepts). */
  claimCode: string;
}

export interface CertificateRenderOptions {
  /** 'pdf' (default) or 'csv'. */
  format?: CertificateFormat;
  /** PDF only: 'card' (default, one 95 × 62 mm page per card) or 'sheet' (A4, eight cards). */
  layout?: CertificateLayout;
  /**
   * A buyer's new card (plan NEXT LOT §3.4, ClaimRenewalService.buyerCard): its order, written with `by: 'buyer'` into the
   * audit entries (`certificate.render`, `certificate.render_refused`).
   */
  context?: { orderId: string; by: 'buyer' };
}

export interface CertificateServiceDeps {
  db: Db;
  audit: AuditService;
  /** The end-to-end check of the ACTIVE code the card draws (CODE_INTEGRITY), shared with every other print of a code. */
  issuance: Pick<IssuanceService, 'verifiedActiveCode'>;
  clock?: Clock;
}

export const CERTIFICATE_RENDER_ACTION = 'certificate.render';
export const CERTIFICATE_REFUSED_ACTION = 'certificate.render_refused';

const PRODUCT_REF_RE = /^(O\d{2}-[A-Z]-\d{5,6}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** A product reference fit for an audit entry or a message: anything else (a code typed in the wrong field) is never repeated. */
function safeRef(v: unknown): string {
  if (typeof v !== 'string' || !PRODUCT_REF_RE.test(v.trim())) return '(invalid)';
  const s = v.trim();
  return s.length === 36 ? s.toLowerCase() : s.toUpperCase();
}

/** "O26-J-00001, O26-J-00002 and 3 more": product ids for an operator-facing message. */
function listIds(ids: readonly string[]): string {
  const shown = ids.slice(0, 5).join(', ');
  return ids.length > 5 ? `${shown} and ${ids.length - 5} more` : shown;
}

const refusal = (code: string, status: number, message: string, refused: readonly string[]) => new DomainError(code, status, message, { refused: [...refused] });

/** The key of an actor's renders in progress (one at a time per admin). */
const actorKey = (actor: Actor) => `${actor.type}:${actor.id ?? ''}`;

export class CertificateService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly issuance: Pick<IssuanceService, 'verifiedActiveCode'>;
  private readonly clock: Clock;
  /** Actors with a render in progress: a second concurrent one is refused, so one session holds at most one scrypt thread. */
  private readonly inProgress = new Set<string>();

  constructor(deps: CertificateServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.issuance = deps.issuance;
    this.clock = deps.clock ?? systemClock;
  }

  /** Check every claim code against its product's hash, then render the cards (or the CSV) and audit the product ids. */
  async render(items: readonly CertificateRequestItem[], opts: CertificateRenderOptions, actor: Actor): Promise<RenderedCertificates> {
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CERTIFICATE_ITEMS) {
      throw validationError(`Add 1 to ${MAX_CERTIFICATE_ITEMS} products.`);
    }
    const format = opts.format ?? 'pdf';
    const layout = opts.layout ?? 'card';
    if (!CERTIFICATE_FORMATS.includes(format)) throw validationError('Format must be pdf or csv.');
    if (!CERTIFICATE_LAYOUTS.includes(layout)) throw validationError('Layout must be card or sheet.');
    for (const it of items) {
      if (!it || typeof it !== 'object' || typeof it.productId !== 'string' || typeof it.claimCode !== 'string') {
        throw validationError('Each item needs a productId and a claimCode.');
      }
    }
    const shape = { ...(format === 'pdf' ? { format, layout } : { format }), ...(opts.context ? { orderId: opts.context.orderId, by: opts.context.by } : {}) };

    // Claimed before the first await, so two concurrent requests of one admin cannot both pass.
    const key = actorKey(actor);
    if (this.inProgress.has(key)) throw tooManyRequests('A certificate download is already being prepared. Wait for it to finish, then try again.');
    this.inProgress.add(key);
    try {
      return await this.renderChecked(items, format, layout, shape, actor);
    } finally {
      this.inProgress.delete(key);
    }
  }

  private async renderChecked(
    items: readonly CertificateRequestItem[],
    format: CertificateFormat,
    layout: CertificateLayout,
    shape: { format: CertificateFormat; layout?: CertificateLayout; orderId?: string; by?: 'buyer' },
    actor: Actor,
  ): Promise<RenderedCertificates> {
    const found: string[] = [];
    let cards: CertificateItem[];
    try {
      cards = await this.checked(items, found);
    } catch (e) {
      // Refusals carry the product ids they concern; validation errors (400) are not audited.
      if (e instanceof DomainError && Array.isArray(e.internal?.refused)) {
        const refused = e.internal.refused as string[];
        // Canonical ids, as certificate.render records them, whether the request named a product by id or by
        // row uuid: the submitted reference (made safe) only for a product that was not found or not looked up.
        const productIds = items.map((it, i) => found[i] ?? safeRef(it.productId));
        await this.audit.record({
          actor,
          action: CERTIFICATE_REFUSED_ACTION,
          targetType: 'product',
          targetId: items.length === 1 ? productIds[0] : null,
          details: { reason: e.code, productIds, refused, ...shape },
        });
      }
      throw e;
    }

    const createdAt = this.clock();
    const status = CERTIFICATE_LAYOUT_STATUS;
    const file = format === 'csv' ? renderCertificateCsv(cards, { createdAt, status }) : await renderCertificatePdf(cards, { layout, createdAt, status });
    await this.audit.record({
      actor,
      action: CERTIFICATE_RENDER_ACTION,
      targetType: 'product',
      targetId: cards.length === 1 ? cards[0].productId : null,
      // codeIssues: which ORBES CODE went into each box (plan NEXT LOT §3.2), in productIds order; never a claim code.
      details: { productIds: cards.map((c) => c.productId), count: cards.length, ...shape, layoutStatus: status, codeIssues: cards.map((c) => c.code.issue) },
    });
    return file;
  }

  /**
   * The products, each with its verified claim code in display form, or the
   * first refusal. `found` receives each item's canonical product id, in
   * order, as its product is found (for the refusal's audit entry).
   */
  private async checked(items: readonly CertificateRequestItem[], found: string[]): Promise<CertificateItem[]> {
    const rows: { p: ProductRow; code: string }[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      let p: ProductRow;
      try {
        p = await requireProduct(this.db, it.productId);
      } catch (e) {
        const ref = safeRef(it.productId);
        if (e instanceof DomainError && e.code === 'PRODUCT_NOT_FOUND') throw refusal('PRODUCT_NOT_FOUND', 404, `Product not found: ${ref}.`, [ref]);
        throw e;
      }
      found.push(p.product_id);
      if (seen.has(p.id)) throw validationError(`${p.product_id} appears more than once.`);
      seen.add(p.id);
      rows.push({ p, code: it.claimCode });
    }
    const ids = (pred: (p: ProductRow) => boolean) => rows.filter((r) => pred(r.p)).map((r) => r.p.product_id);

    const without = ids((p) => p.claim_secret_hash === null);
    if (without.length > 0) throw refusal('NO_CLAIM_SECRET', 422, `Issued without a claim code: ${listIds(without)}.`, without);
    const blocked = ids((p) => NOT_PRINTABLE.has(p.status));
    if (blocked.length > 0) {
      throw refusal('PRODUCT_NOT_PRINTABLE', 409, `No certificate card can be printed for ${listIds(blocked)} in its current state.`, blocked);
    }
    // The card draws the piece's ACTIVE code (plan NEXT LOT §3.2): its signed payload and signature, its issue, and
    // the genome version it was signed with (the GENOME row printed beside it is the same). A piece whose code was
    // revoked with no new one has nothing to print.
    const codes = new Map(
      (
        await this.db
          .selectFrom('codes')
          .innerJoin('genomes', 'genomes.id', 'codes.genome_id')
          .select(['codes.id', 'codes.product_id', 'genomes.genome_version'])
          .where('codes.product_id', 'in', [...seen])
          .where('codes.status', '=', 'ACTIVE')
          .execute()
      ).map((c) => [c.product_id, c]),
    );
    const codeless = ids((p) => !codes.has(p.id));
    if (codeless.length > 0) {
      throw refusal(
        'NO_ACTIVE_CODE',
        409,
        `No active code for ${listIds(codeless)}: re-issue ${codeless.length === 1 ? 'its code' : 'their codes'} on the product page first.`,
        codeless,
      );
    }
    // Each ACTIVE code is proven a genuine, consistent ORBES code before it goes onto a card, as for every other print
    // of a code (a key revoked with a compromise date before the code, a tampered row): 409 CODE_INTEGRITY otherwise.
    const verified = new Map<string, { data: Uint8Array; issue: number }>();
    for (const r of rows) {
      const id = r.p.product_id;
      try {
        const c = await this.issuance.verifiedActiveCode(codes.get(r.p.id)!.id);
        verified.set(r.p.id, { data: c.data, issue: c.issue });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        // The check's own message names the issue and the piece; its detail stays in the log (IssuanceService).
        if (e.code === 'CODE_INTEGRITY' || e.code === 'PRODUCT_NOT_PRINTABLE') throw refusal(e.code, e.httpStatus, e.publicMessage, [id]);
        // Superseded or revoked since it was read above.
        if (e.code === 'CODE_NOT_ACTIVE') throw refusal('NO_ACTIVE_CODE', 409, `No active code for ${id}: re-issue its code on the product page first.`, [id]);
        throw e;
      }
    }
    const owned = new Set(
      (await this.db.selectFrom('ownership').select('product_id').where('product_id', 'in', [...seen]).where('ended_at', 'is', null).execute()).map((o) => o.product_id),
    );
    const registered = ids((p) => owned.has(p.id));
    if (registered.length > 0) {
      throw refusal('ALREADY_REGISTERED', 409, `Already registered to an owner, so the claim code has been used: ${listIds(registered)}.`, registered);
    }

    // One scrypt at a time (32 MiB each), the most expensive check last, stopping at the first code that does not match.
    for (const r of rows) {
      if (!(await verifyClaimCode(r.code, r.p.claim_secret_hash!))) {
        const id = r.p.product_id;
        throw refusal('CLAIM_CODE_MISMATCH', 422, `The claim code does not match ${id}. Use the code shown when the product was issued.`, [id]);
      }
    }

    const models = new Map(
      (
        await this.db
          .selectFrom('models')
          .select(['id', 'name', 'type', 'variant_label'])
          .where('id', 'in', [...new Set(rows.map((r) => r.p.model_id))])
          .execute()
      ).map((m) => [m.id, m]),
    );
    return rows.map(({ p, code: claim }) => {
      const model = models.get(p.model_id);
      const active = codes.get(p.id)!; // NO_ACTIVE_CODE above
      const code = verified.get(p.id)!; // CODE_INTEGRITY above
      return {
        productId: p.product_id,
        model: model ? `${model.name} · ${model.type}` : '',
        modelVariant: model?.variant_label ?? null,
        size: p.variant,
        material: p.material,
        year: p.year,
        // The genome is a public function of the signed identity: the one the code carries.
        genome: computeGenome(Number(p.packed_identity), active.genome_version),
        code: { data: code.data, issue: code.issue },
        claimCode: formatGrouped(normalizeClaimCode(claim)!),
      };
    });
  }
}
