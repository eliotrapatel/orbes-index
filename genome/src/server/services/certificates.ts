/**
 * CertificateService — the certificate card that carries a product's
 * one-time claim code under a scratch-off panel (render/certificate.ts), as
 * a PDF card, an A4 sheet of cards, or a CSV for variable-data printing.
 *
 * The claim code is shown once at issuance and only its scrypt hash is
 * stored, so the console sends the code back with the request. Before
 * anything is drawn, every code is checked against its product's hash
 * (verifyClaimCode): a card printed with a mistyped code would lock the
 * buyer out of registration for good. The code is never kept: not stored,
 * not logged, not audited, never echoed in an error. Audit entries carry
 * product ids only.
 *
 * Refusals, in this order (each one audited as `certificate.render_refused`
 * with the product ids and the reason; nothing is rendered):
 *   404 PRODUCT_NOT_FOUND      an unknown product
 *   422 NO_CLAIM_SECRET        issued without a claim code
 *   409 PRODUCT_NOT_PRINTABLE  revoked, retired, flagged, lost or stolen
 *   409 ALREADY_REGISTERED     the product has an owner: its claim code is spent
 *   422 CLAIM_CODE_MISMATCH    a code does not match its product's hash
 * Mismatches are not counted towards the customers' claim-code attempt limit
 * (ownership.ts): this route needs an OPERATOR session with MFA, and every
 * refusal is in the audit log.
 */
import { computeGenome } from '../../core/genome/genome.js';
import type { Db } from '../db/connection.js';
import type { ProductRow } from '../db/schema.js';
import { DomainError, validationError } from '../errors.js';
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
import { GENOME_VERSION, NOT_PRINTABLE } from './issuance.js';
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
  /** PDF only: 'card' (default, one 85 × 55 mm page per card) or 'sheet' (A4, ten cards). */
  layout?: CertificateLayout;
}

export interface CertificateServiceDeps {
  db: Db;
  audit: AuditService;
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

export class CertificateService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: CertificateServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
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
    const shape = format === 'pdf' ? { format, layout } : { format };

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
    const file = format === 'csv' ? renderCertificateCsv(cards, { createdAt }) : await renderCertificatePdf(cards, { layout, createdAt });
    await this.audit.record({
      actor,
      action: CERTIFICATE_RENDER_ACTION,
      targetType: 'product',
      targetId: cards.length === 1 ? cards[0].productId : null,
      details: { productIds: cards.map((c) => c.productId), count: cards.length, ...shape, layoutStatus: CERTIFICATE_LAYOUT_STATUS },
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
    const owned = new Set(
      (await this.db.selectFrom('ownership').select('product_id').where('product_id', 'in', [...seen]).where('ended_at', 'is', null).execute()).map((o) => o.product_id),
    );
    const registered = ids((p) => owned.has(p.id));
    if (registered.length > 0) {
      throw refusal('ALREADY_REGISTERED', 409, `Already registered to an owner, so the claim code has been used: ${listIds(registered)}.`, registered);
    }

    // One scrypt at a time (32 MiB each): the most expensive check comes last.
    const mismatched: string[] = [];
    for (const r of rows) {
      if (!(await verifyClaimCode(r.code, r.p.claim_secret_hash!))) mismatched.push(r.p.product_id);
    }
    if (mismatched.length > 0) {
      throw refusal('CLAIM_CODE_MISMATCH', 422, `The claim code does not match ${listIds(mismatched)}. Use the code shown when the product was issued.`, mismatched);
    }

    const models = new Map(
      (await this.db.selectFrom('models').select(['id', 'name', 'type']).where('id', 'in', [...new Set(rows.map((r) => r.p.model_id))]).execute()).map((m) => [m.id, m]),
    );
    const versions = new Map(
      (
        await this.db
          .selectFrom('genomes')
          .select((eb) => ['product_id', eb.fn.max('genome_version').as('version')])
          .where('product_id', 'in', [...seen])
          .groupBy('product_id')
          .execute()
      ).map((g) => [g.product_id, Number(g.version)]),
    );
    return rows.map(({ p, code }) => {
      const model = models.get(p.model_id);
      return {
        productId: p.product_id,
        model: model ? `${model.name} · ${model.type}` : '',
        material: p.material,
        // The genome is a public function of the signed identity: the one the code carries.
        genome: computeGenome(Number(p.packed_identity), versions.get(p.id) ?? GENOME_VERSION),
        claimCode: formatGrouped(normalizeClaimCode(code)!),
      };
    });
  }
}
