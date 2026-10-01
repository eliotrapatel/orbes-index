/**
 * IssuanceService — the generator (contract §2.3).
 *
 * issueProduct, in ONE transaction:
 *   serial (max+1 per year/category, advisory-locked, retried on conflict)
 *   → product row (ISSUED) + status history
 *   → GENOME-01 row (computeGenome of the packed identity)
 *   → canonical payload (issue 1, today, 4 random nonce bytes, active key)
 *   → Ed25519 signature (KeyService: verify-after-sign) → code row
 *   → warranty row (NOT_STARTED, duration from the category)
 *   → audit entry.
 * Any failure rolls everything back: a signed code never exists without its
 * product, genome and audit trail.
 *
 * The signing key row is read FOR SHARE inside the transaction, so a code is
 * never committed under a key that a concurrent rotation/revocation has
 * already retired; issuance then retries with the new active key.
 *
 * Rendering re-checks the stored code end to end (payload fields, hash,
 * genome, key trust, signature) before producing an artifact: a tampered
 * database row can never be printed as a "valid" code.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { equalBytes, toBase64Url, toHex } from '../../core/bytes.js';
import { computeGenome, genomeVocabulary } from '../../core/genome/genome.js';
import { formatProductId, packIdentity, unpackIdentity, type ProductIdentity } from '../../core/identity.js';
import {
  decodePayload,
  encodePayload,
  frameCodeData,
  issuedDayFromDate,
  dateFromIssuedDay,
  signingMessage,
  type CodePayloadV1,
} from '../../core/payload.js';
import { verifyEd25519Node } from '../crypto/ed25519-node.js';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isCheckViolation, isForeignKeyViolation, isRetryableTxError, isUniqueViolation } from '../db/pg-errors.js';
import type { CodeRow, CodeStatus, GenomeRow, OwnershipState, ProductRow, ProductStatus } from '../db/schema.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
import { isKeyTrustedAt, type ActiveSigner, type KeyService } from '../keys/key-service.js';
import {
  ArtifactOptionsError,
  MAX_SHEET_ITEMS,
  renderArtifact,
  renderPrintSheet,
  type ArtifactFormat,
  type ArtifactOptions,
  type PrintSheetOptions,
  type RenderedArtifact,
} from '../render/artifact.js';
import { noopLogger, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import type { AuditService } from './audit.js';
import type { CategoryRegistry } from './categories.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';

// ── Public types ───────────────────────────────────────────────────────────

export interface IssueProductInput {
  categoryCode: string;
  year?: number;
  modelId: string;
  collectionId?: string;
  sku?: string;
  variant?: string;
  material: string;
  productionBatch?: string;
  /** 'YYYY-MM-DD'. */
  productionDate?: string;
  /** Explicit serial (1..999 999); allocated as max+1 otherwise. */
  serial?: number;
  withClaimSecret?: boolean;
  /** e.g. 'PRINTED_CODE' (default) or 'PRINTED_CODE+SECURE_NFC'. */
  authPolicy?: string;
}

export interface ProductRecord {
  /** Row id (uuid). */
  id: string;
  /** Canonical product id, e.g. O26-J-00184. */
  productId: string;
  packedIdentity: number;
  year: number;
  categoryIndex: number;
  categoryCode: string;
  serial: number;
  sku: string;
  modelId: string;
  collectionId: string | null;
  variant: string | null;
  material: string;
  productionBatch: string | null;
  productionDate: string | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  authPolicy: string;
  /** A claim code was issued (its hash is never exposed). */
  hasClaimSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenomeRecord {
  id: string;
  productUuid: string;
  /** Canonical product id (the genome id). */
  productId: string;
  version: number;
  value: number;
  glyphs: number[];
  ids: string[];
  pattern: string;
  fingerprint: string;
  createdAt: Date;
}

export interface CodeRecord {
  id: string;
  productUuid: string;
  productId: string;
  genomeUuid: string;
  keyId: number;
  codeVersion: number;
  issue: number;
  issuedDay: number;
  /** 'YYYY-MM-DD' (UTC) of issuedDay. */
  issuedAt: string;
  /** hex, 4 bytes. */
  nonce: string;
  payload: Uint8Array;
  signature: Uint8Array;
  /** hex sha256(payload). */
  payloadHash: string;
  /** base64url of the 79-byte framed data: exactly what a scanner reads and POSTs to /api/v1/verify. */
  data: string;
  status: CodeStatus;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
}

export interface IssueResult {
  product: ProductRecord;
  genome: GenomeRecord;
  code: CodeRecord;
  /** XXXX-XXXX-XXXX, returned ONCE when requested; only its scrypt hash is stored. */
  claimCode?: string;
}

export interface RenderCodeOptions extends ArtifactOptions {}

export interface IssuanceServiceDeps {
  db: Db;
  keys: KeyService;
  audit: AuditService;
  categories: CategoryRegistry;
  clock?: Clock;
  log?: Logger;
}

/** Authenticator kinds a policy may name (contract §2.11). */
export const AUTH_POLICY_KINDS = ['PRINTED_CODE', 'SECURE_NFC', 'SECURE_ELEMENT', 'TAMPER_EVIDENT'] as const;
export const DEFAULT_AUTH_POLICY = 'PRINTED_CODE';
export const GENOME_VERSION = 1;
export const CODE_VERSION = 1;
export const MAX_ISSUE = 255;
const SERIAL_MAX = 999_999;
const MAX_ATTEMPTS = 5;
const MAX_REASON = 500;

// ── Validation ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^O\d{2}-[A-Z]-(\d{5}|[1-9]\d{5})$/;

/** Admin forms send '' for untouched optional fields: treat it as absent. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is too long.`)
    .regex(/^[^\p{Cc}]+$/u, `${label} contains invalid characters.`);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Production date must be YYYY-MM-DD.')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Production date is not a valid date.');

const issueSchema = z.strictObject({
  categoryCode: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]$/, 'Category code must be a single letter A–Z.')),
  year: optional(z.number().int().min(2000, 'Year must be 2000–2099.').max(2099, 'Year must be 2000–2099.')),
  modelId: z.string().trim().regex(UUID_RE, 'Model id is invalid.'),
  collectionId: optional(z.string().trim().regex(UUID_RE, 'Collection id is invalid.')),
  sku: optional(
    z
      .string()
      .trim()
      .max(64, 'SKU is too long.')
      .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, 'SKU may contain letters, digits, space, dot, underscore, hyphen and slash.'),
  ),
  variant: optional(text(100, 'Variant')),
  material: text(200, 'Material'),
  productionBatch: optional(text(100, 'Production batch')),
  productionDate: optional(isoDate),
  serial: optional(z.number().int().min(1, 'Serial must be 1–999999.').max(SERIAL_MAX, 'Serial must be 1–999999.')),
  withClaimSecret: optional(z.boolean()),
  authPolicy: optional(z.string().trim().max(200)),
});

type ParsedIssueInput = z.infer<typeof issueSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path.join('.');
    // Unknown keys and type errors carry zod's generic text; give admins the field name.
    const message = issue?.code === 'unrecognized_keys' ? 'The request contains unknown fields.' : issue?.message ?? 'Invalid input.';
    throw validationError(message, field ? `field ${field}` : undefined);
  }
  return r.data;
}

/** Normalise and check an authentication policy: known kinds joined by '+', PRINTED_CODE included. */
export function normalizeAuthPolicy(policy: string | undefined): string {
  if (policy === undefined || policy.trim() === '') return DEFAULT_AUTH_POLICY;
  const kinds = policy
    .trim()
    .toUpperCase()
    .split('+')
    .map((k) => k.trim());
  const known = new Set<string>(AUTH_POLICY_KINDS);
  if (kinds.some((k) => !known.has(k))) {
    throw validationError(`Authentication policy may only combine ${AUTH_POLICY_KINDS.join(', ')}.`);
  }
  if (new Set(kinds).size !== kinds.length) throw validationError('Authentication policy lists a method twice.');
  // Every issued product carries a printed code, so the policy always includes it.
  if (!kinds.includes('PRINTED_CODE')) throw validationError('Authentication policy must include PRINTED_CODE.');
  return kinds.join('+');
}

/** SKU when none is given: the model's prefix plus the variant, e.g. MNL-RG-52. */
export function deriveSku(skuPrefix: string, variant: string | undefined): string {
  const prefix = skuPrefix.trim().toUpperCase();
  if (!variant) return prefix.slice(0, 64);
  const slug = variant
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return (slug ? `${prefix}-${slug}` : prefix).slice(0, 64);
}

// ── Internal errors ────────────────────────────────────────────────────────

type WorkKind = 'auto-serial' | 'explicit-serial' | 'reissue';

/** The signer fetched before the transaction is no longer the ACTIVE key: retry with a fresh one. */
class StaleSignerError extends Error {
  override readonly name = 'StaleSignerError';
}

// ── Service ────────────────────────────────────────────────────────────────

export class IssuanceService {
  private readonly db: Db;
  private readonly keys: KeyService;
  private readonly audit: AuditService;
  private readonly categories: CategoryRegistry;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: IssuanceServiceDeps) {
    this.db = deps.db;
    this.keys = deps.keys;
    this.audit = deps.audit;
    this.categories = deps.categories;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /** Issue a product with its genome, first signed code (issue 1) and warranty. */
  async issueProduct(input: IssueProductInput, actor: Actor): Promise<IssueResult> {
    const p = parseOrThrow(issueSchema, input);
    const authPolicy = normalizeAuthPolicy(p.authPolicy);
    const now = this.clock();
    const year = p.year ?? now.getUTCFullYear();
    if (p.productionDate !== undefined && p.productionDate > dayString(new Date(now.getTime() + 86_400_000))) {
      throw validationError('Production date cannot be in the future.');
    }

    // Reads before the transaction: PGlite has a single connection, and these give precise errors.
    const category = await this.categories.getByCode(p.categoryCode);
    if (!category) throw notFound('Category', 'CATEGORY_NOT_FOUND');
    if (!category.active) throw conflict('CATEGORY_INACTIVE', 'This category is no longer used for new products.');
    const model = await this.db.selectFrom('models').selectAll().where('id', '=', p.modelId).executeTakeFirst();
    if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (model.category_id !== category.index) {
      throw validationError('The model belongs to another category.', `model category ${model.category_id}, requested ${category.index}`);
    }
    if (p.collectionId !== undefined) {
      const col = await this.db.selectFrom('collections').select('id').where('id', '=', p.collectionId).executeTakeFirst();
      if (!col) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    }
    const sku = p.sku ?? deriveSku(model.sku_prefix, p.variant);

    // scrypt runs on the thread pool OUTSIDE the transaction, which then stays short.
    const claimCode = p.withClaimSecret ? generateClaimCode() : undefined;
    const claimHash = claimCode ? await hashClaimCode(claimCode) : null;

    const result = await this.withRetries(
      (signer) =>
        inTransaction(this.db, (trx) =>
          this.issueIn(trx, signer, actor, {
            p,
            year,
            categoryIndex: category.index,
            categoryCode: category.code,
            warrantyMonths: category.warrantyMonths,
            sku,
            authPolicy,
            claimHash,
          }),
        ),
      p.serial !== undefined ? 'explicit-serial' : 'auto-serial',
    );
    return claimCode ? { ...result, claimCode } : result;
  }

  /**
   * Replace a product's code (damage, suspected copying): the ACTIVE code
   * becomes SUPERSEDED (verifies as REVOKED from now on) and a new code with
   * issue+1, a fresh nonce and the active key is signed for the SAME genome.
   * `productRef` is the canonical product id or the row uuid.
   */
  async reissueCode(productRef: string, reason: string, actor: Actor): Promise<CodeRecord> {
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < 1 || why.length > MAX_REASON) throw validationError(`A reason of 1–${MAX_REASON} characters is required.`);
    const product = await this.findProduct(this.db, productRef);
    if (!product) throw notFound('Product', 'PRODUCT_NOT_FOUND');

    return this.withRetries((signer) => inTransaction(this.db, (trx) => this.reissueIn(trx, signer, product.id, why, actor)), 'reissue');
  }

  /**
   * Render the artifact of an ACTIVE code (SVG via the core renderer, PNG via
   * resvg, vector PDF via pdfkit). With `actor`, the download is audited.
   */
  async renderCode(codeId: string, format: ArtifactFormat, opts: RenderCodeOptions = {}, actor?: Actor): Promise<RenderedArtifact> {
    const loaded = await this.loadVerifiedCode(codeId);
    let artifact: RenderedArtifact;
    try {
      artifact = await renderArtifact(
        { data: loaded.data, genomeGlyphs: loaded.glyphs },
        format,
        opts,
        { productId: loaded.productId, issue: loaded.issue, createdAt: loaded.createdAt },
      );
    } catch (e) {
      if (e instanceof ArtifactOptionsError) throw validationError(e.message);
      throw e;
    }
    if (actor) {
      await this.audit.record({
        actor,
        action: 'code.render',
        targetType: 'code',
        targetId: codeId,
        details: { productId: loaded.productId, issue: loaded.issue, format, ...opts },
      });
    }
    return artifact;
  }

  /** Multi-up PDF print sheet of ACTIVE codes (labeled, with crop marks). With `actor`, audited. */
  async renderPrintSheet(codeIds: readonly string[], opts: PrintSheetOptions = {}, actor?: Actor): Promise<RenderedArtifact> {
    if (!Array.isArray(codeIds) || codeIds.length < 1 || codeIds.length > MAX_SHEET_ITEMS) {
      throw validationError(`Select 1 to ${MAX_SHEET_ITEMS} codes.`);
    }
    const ids = [...new Set(codeIds)];
    const items = [];
    for (const id of ids) {
      const c = await this.loadVerifiedCode(id);
      items.push({ data: c.data, genomeGlyphs: c.glyphs, productId: c.productId });
    }
    let sheet: RenderedArtifact;
    try {
      sheet = await renderPrintSheet(items, opts, { createdAt: this.clock() });
    } catch (e) {
      if (e instanceof ArtifactOptionsError) throw validationError(e.message);
      throw e;
    }
    if (actor) {
      await this.audit.record({
        actor,
        action: 'code.render_sheet',
        targetType: 'code',
        targetId: null,
        details: { codeIds: ids, productIds: items.map((i) => i.productId), ...opts },
      });
    }
    return sheet;
  }

  // ── Transactions ─────────────────────────────────────────────────────────

  /**
   * Run `work` with the current signer, retrying (fresh signer, fresh
   * transaction) on a stale signer, a serial race (auto-allocated serials
   * only) or a serialization failure / deadlock.
   */
  private async withRetries<T>(work: (signer: ActiveSigner) => Promise<T>, kind: WorkKind): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const signer = await this.keys.activeSigner();
      try {
        return await work(signer);
      } catch (e) {
        const last = attempt >= MAX_ATTEMPTS || this.db.isTransaction;
        if (e instanceof StaleSignerError) {
          this.keys.invalidate();
          if (!last) continue;
          throw new DomainError('SIGNING_UNAVAILABLE', 503, 'Code signing is temporarily unavailable.', {
            detail: 'active key kept changing during issuance',
          });
        }
        if (!last && ((kind === 'auto-serial' && isUniqueViolation(e)) || isRetryableTxError(e))) continue;
        throw mapDbError(e, kind);
      }
    }
  }

  private async lockSigner(trx: Db, signer: ActiveSigner): Promise<void> {
    // FOR SHARE: a concurrent rotate/retire/revoke waits for this commit, or we see its result.
    const key = await trx
      .selectFrom('cryptographic_keys')
      .select(['status', 'public_key'])
      .where('key_id', '=', signer.keyId)
      .forShare()
      .executeTakeFirst();
    if (!key || key.status !== 'ACTIVE' || !equalBytes(key.public_key, signer.publicKey)) throw new StaleSignerError();
  }

  private async issueIn(
    trx: Db,
    signer: ActiveSigner,
    actor: Actor,
    a: {
      p: ParsedIssueInput;
      year: number;
      categoryIndex: number;
      categoryCode: string;
      warrantyMonths: number;
      sku: string;
      authPolicy: string;
      claimHash: string | null;
    },
  ): Promise<Omit<IssueResult, 'claimCode'>> {
    const { p, year, categoryIndex } = a;
    const now = this.clock();
    await this.lockSigner(trx, signer);

    // Per (year, category) lock: max+1 is then race-free; the UNIQUE constraint remains the backstop.
    await advisoryXactLock(trx, ADVISORY_LOCK.SERIAL_ALLOCATION, (year - 2000) * 32 + categoryIndex);
    let serial = p.serial;
    if (serial === undefined) {
      const row = await trx
        .selectFrom('products')
        .select((eb) => eb.fn.max('serial').as('max'))
        .where('year', '=', year)
        .where('category_id', '=', categoryIndex)
        .executeTakeFirst();
      serial = Number(row?.max ?? 0) + 1;
      if (serial > SERIAL_MAX) throw conflict('SERIALS_EXHAUSTED', 'No serial numbers are left for this year and category.');
    }
    const identity: ProductIdentity = { year, categoryIndex, serial };
    const packed = packIdentity(identity);
    const productId = formatProductId(identity, this.categories.resolver());

    const productRow = await trx
      .insertInto('products')
      .values({
        product_id: productId,
        packed_identity: packed,
        year,
        category_id: categoryIndex,
        serial,
        sku: a.sku,
        model_id: p.modelId,
        collection_id: p.collectionId ?? null,
        variant: p.variant ?? null,
        material: p.material,
        production_batch: p.productionBatch ?? null,
        production_date: p.productionDate ?? null,
        status: 'ISSUED',
        ownership_state: 'UNREGISTERED',
        auth_policy: a.authPolicy,
        claim_secret_hash: a.claimHash,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('product_status_history')
      .values({
        product_id: productRow.id,
        from_status: null,
        to_status: 'ISSUED',
        reason: 'Product issued',
        actor_type: actor.type,
        actor_id: actor.id ?? null,
        created_at: now,
      })
      .execute();

    const genome = computeGenome(packed, GENOME_VERSION);
    const genomeRow = await trx
      .insertInto('genomes')
      .values({
        product_id: productRow.id,
        genome_version: genome.version,
        genome_id: productId,
        value: genome.value,
        glyphs: genome.glyphs,
        pattern: genome.ids.join('·'),
        fingerprint: genome.fingerprint,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const codeRow = await this.signAndInsertCode(trx, signer, {
      productUuid: productRow.id,
      genomeUuid: genomeRow.id,
      identity,
      genomeVersion: genome.version,
      issue: 1,
      now,
    });

    await trx
      .insertInto('warranties')
      .values({ product_id: productRow.id, duration_months: a.warrantyMonths, created_at: now, updated_at: now })
      .execute();

    await this.audit.record(
      {
        actor,
        action: 'product.issue',
        targetType: 'product',
        targetId: productId,
        details: {
          productId,
          packedIdentity: packed,
          category: a.categoryCode,
          year,
          serial,
          serialAllocated: p.serial === undefined,
          modelId: p.modelId,
          sku: a.sku,
          authPolicy: a.authPolicy,
          claimSecret: a.claimHash !== null,
          genomeFingerprint: genome.fingerprint,
          codeId: codeRow.id,
          issue: 1,
          keyId: signer.keyId,
        },
      },
      trx,
    );

    return {
      product: toProductRecord(productRow, a.categoryCode),
      genome: toGenomeRecord(genomeRow),
      code: toCodeRecord(codeRow, productId),
    };
  }

  private async reissueIn(trx: Db, signer: ActiveSigner, productUuid: string, reason: string, actor: Actor): Promise<CodeRecord> {
    const now = this.clock();
    await this.lockSigner(trx, signer);
    const product = await trx.selectFrom('products').selectAll().where('id', '=', productUuid).forUpdate().executeTakeFirst();
    if (!product) throw notFound('Product', 'PRODUCT_NOT_FOUND');
    if (product.status === 'RETIRED' || product.status === 'REVOKED') {
      throw conflict('PRODUCT_NOT_REISSUABLE', 'A retired or revoked product cannot receive a new code.', `status ${product.status}`);
    }
    const codes = await trx.selectFrom('codes').selectAll().where('product_id', '=', productUuid).orderBy('issue', 'desc').execute();
    const latest = codes[0];
    if (!latest) throw conflict('NO_CODE', 'This product has no code to replace.');
    const nextIssue = latest.issue + 1;
    if (nextIssue > MAX_ISSUE) throw conflict('ISSUES_EXHAUSTED', 'This product has reached the maximum number of code issues.');
    const genomeRow = await trx.selectFrom('genomes').selectAll().where('id', '=', latest.genome_id).executeTakeFirstOrThrow();

    const superseded = codes.filter((c) => c.status === 'ACTIVE').map((c) => c.id);
    if (superseded.length > 0) {
      // Before the insert: one ACTIVE code per product is enforced by a partial unique index.
      await trx
        .updateTable('codes')
        .set({ status: 'SUPERSEDED', revoked_at: now, revocation_reason: reason })
        .where('id', 'in', superseded)
        .execute();
    }
    const identity = unpackIdentity(Number(product.packed_identity));
    const codeRow = await this.signAndInsertCode(trx, signer, {
      productUuid,
      genomeUuid: genomeRow.id,
      identity,
      genomeVersion: genomeRow.genome_version,
      issue: nextIssue,
      now,
    });
    await this.audit.record(
      {
        actor,
        action: 'code.reissue',
        targetType: 'product',
        targetId: product.product_id,
        details: {
          productId: product.product_id,
          reason,
          supersededCodeIds: superseded,
          previousIssue: latest.issue,
          codeId: codeRow.id,
          issue: nextIssue,
          keyId: signer.keyId,
        },
      },
      trx,
    );
    return toCodeRecord(codeRow, product.product_id);
  }

  private async signAndInsertCode(
    trx: Db,
    signer: ActiveSigner,
    c: { productUuid: string; genomeUuid: string; identity: ProductIdentity; genomeVersion: number; issue: number; now: Date },
  ): Promise<CodeRow> {
    const payload: CodePayloadV1 = {
      codeVersion: CODE_VERSION,
      genomeVersion: c.genomeVersion,
      keyId: signer.keyId,
      identity: c.identity,
      issue: c.issue,
      issuedDay: issuedDayFromDate(c.now),
      nonce: new Uint8Array(randomBytes(4)),
    };
    const payloadBytes = encodePayload(payload);
    // KeyService verifies the signature with the registered public key before returning it.
    const signature = await signer.sign(signingMessage(payloadBytes));
    return trx
      .insertInto('codes')
      .values({
        product_id: c.productUuid,
        genome_id: c.genomeUuid,
        key_id: signer.keyId,
        code_version: CODE_VERSION,
        issue: c.issue,
        issued_day: payload.issuedDay,
        nonce: payload.nonce,
        payload: payloadBytes,
        signature,
        payload_hash: sha256(payloadBytes),
        status: 'ACTIVE',
        created_at: c.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private async findProduct(db: Db, ref: string): Promise<ProductRow | undefined> {
    if (typeof ref !== 'string') return undefined;
    const s = ref.trim();
    if (UUID_RE.test(s)) return db.selectFrom('products').selectAll().where('id', '=', s).executeTakeFirst();
    if (PRODUCT_ID_RE.test(s)) return db.selectFrom('products').selectAll().where('product_id', '=', s).executeTakeFirst();
    return undefined;
  }

  /**
   * Load an ACTIVE code and prove the stored row is a genuine, consistent
   * ORBES code before anything is rendered from it.
   */
  private async loadVerifiedCode(codeId: string): Promise<{
    data: Uint8Array;
    glyphs: number[];
    productId: string;
    issue: number;
    createdAt: Date;
  }> {
    if (typeof codeId !== 'string' || !UUID_RE.test(codeId)) throw notFound('Code', 'CODE_NOT_FOUND');
    const row = await this.db
      .selectFrom('codes as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .innerJoin('genomes as g', 'g.id', 'c.genome_id')
      .select([
        'c.id',
        'c.key_id',
        'c.code_version',
        'c.issue',
        'c.issued_day',
        'c.nonce',
        'c.payload',
        'c.signature',
        'c.payload_hash',
        'c.status',
        'c.created_at',
        'p.product_id as canonical_id',
        'p.packed_identity',
        'g.genome_version',
        'g.glyphs',
        'g.product_id as genome_product',
        'c.product_id as code_product',
      ])
      .where('c.id', '=', codeId)
      .executeTakeFirst();
    if (!row) throw notFound('Code', 'CODE_NOT_FOUND');
    if (row.status !== 'ACTIVE') {
      throw conflict('CODE_NOT_ACTIVE', 'Only the active code of a product can be rendered.', `status ${row.status}`);
    }

    const fail = (detail: string): never => {
      this.log.error({ codeId, detail }, 'stored code failed its integrity check; refusing to render');
      throw new DomainError('CODE_INTEGRITY', 409, 'This code failed its integrity check and cannot be rendered.', { detail });
    };
    let payload: CodePayloadV1;
    try {
      payload = decodePayload(row.payload);
    } catch {
      return fail('payload does not decode');
    }
    const packed = Number(row.packed_identity);
    if (row.genome_product !== row.code_product) fail('genome belongs to another product');
    if (payload.keyId !== row.key_id) fail('key id mismatch');
    if (payload.issue !== row.issue) fail('issue mismatch');
    if (payload.issuedDay !== row.issued_day) fail('issued day mismatch');
    if (payload.codeVersion !== row.code_version) fail('code version mismatch');
    if (payload.genomeVersion !== row.genome_version) fail('genome version mismatch');
    if (!equalBytes(payload.nonce, row.nonce)) fail('nonce mismatch');
    if (packIdentity(payload.identity) !== packed) fail('identity mismatch');
    if (!equalBytes(sha256(row.payload), row.payload_hash)) fail('payload hash mismatch');
    const expected = computeGenome(packed, row.genome_version).glyphs;
    if (expected.length !== row.glyphs.length || expected.some((g, i) => g !== row.glyphs[i])) fail('genome mismatch');
    const key = await this.keys.publicKey(row.key_id);
    if (!key) fail('unknown signing key');
    if (!isKeyTrustedAt(key!, row.created_at)) fail('signing key revoked before this code was recorded');
    if (!verifyEd25519Node(key!.publicKey, signingMessage(row.payload), row.signature)) fail('signature does not verify');

    return {
      data: frameCodeData(row.payload, row.signature),
      glyphs: [...row.glyphs],
      productId: row.canonical_id,
      issue: row.issue,
      createdAt: row.created_at,
    };
  }
}

// ── Mapping ────────────────────────────────────────────────────────────────

function mapDbError(e: unknown, kind: WorkKind): unknown {
  if (e instanceof DomainError) return e;
  if (isUniqueViolation(e)) {
    if (kind === 'explicit-serial') return conflict('SERIAL_TAKEN', 'This serial number is already used.');
    return conflict('ISSUANCE_CONFLICT', 'A concurrent change prevented issuance. Please retry.');
  }
  if (isForeignKeyViolation(e)) return notFound('Referenced record', 'REFERENCE_NOT_FOUND');
  if (isCheckViolation(e)) return validationError('The product data was rejected.', 'check constraint');
  return e;
}

function sha256(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(b).digest());
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toProductRecord(r: ProductRow, categoryCode: string): ProductRecord {
  return {
    id: r.id,
    productId: r.product_id,
    packedIdentity: Number(r.packed_identity),
    year: r.year,
    categoryIndex: r.category_id,
    categoryCode,
    serial: r.serial,
    sku: r.sku,
    modelId: r.model_id,
    collectionId: r.collection_id,
    variant: r.variant,
    material: r.material,
    productionBatch: r.production_batch,
    productionDate: r.production_date,
    status: r.status,
    ownershipState: r.ownership_state,
    authPolicy: r.auth_policy,
    hasClaimSecret: r.claim_secret_hash !== null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toGenomeRecord(r: GenomeRow): GenomeRecord {
  const vocabulary = genomeVocabulary(r.genome_version);
  return {
    id: r.id,
    productUuid: r.product_id,
    productId: r.genome_id,
    version: r.genome_version,
    value: Number(r.value),
    glyphs: [...r.glyphs],
    ids: r.glyphs.map((g) => vocabulary[g].id),
    pattern: r.pattern,
    fingerprint: r.fingerprint,
    createdAt: r.created_at,
  };
}

export function toCodeRecord(r: CodeRow, productId: string): CodeRecord {
  return {
    id: r.id,
    productUuid: r.product_id,
    productId,
    genomeUuid: r.genome_id,
    keyId: r.key_id,
    codeVersion: r.code_version,
    issue: r.issue,
    issuedDay: r.issued_day,
    issuedAt: dayString(dateFromIssuedDay(r.issued_day)),
    nonce: toHex(r.nonce),
    payload: Uint8Array.from(r.payload),
    signature: Uint8Array.from(r.signature),
    payloadHash: toHex(r.payload_hash),
    data: toBase64Url(frameCodeData(r.payload, r.signature)),
    status: r.status,
    revokedAt: r.revoked_at,
    revocationReason: r.revocation_reason,
    createdAt: r.created_at,
  };
}
