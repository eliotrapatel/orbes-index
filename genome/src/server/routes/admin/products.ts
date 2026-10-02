/**
 * Products: list, issue (the generator), full detail, lifecycle moves, code
 * re-issue, warranty and service records, ownership confirmation.
 *
 * Roles: reads AUDITOR; mutations OPERATOR; revoking (a transition to
 * REVOKED) and reinstating ADMIN. The services own the business rules and
 * audit every change with the admin actor (id + hashed IP).
 *
 * The detail view re-verifies every stored code live (payload fields, hash,
 * key trust, Ed25519 over the canonical signing message), so a row tampered
 * with in the database shows up as invalid in the console.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { equalBytes } from '../../../core/bytes.js';
import { packIdentity } from '../../../core/identity.js';
import { decodePayload, signingMessage } from '../../../core/payload.js';
import { verifyEd25519Node } from '../../crypto/ed25519-node.js';
import type { CodeRow, ProductOverviewRow } from '../../db/schema.js';
import { forbidden } from '../../errors.js';
import { isKeyTrustedAt } from '../../keys/key-service.js';
import {
  completeServiceBody,
  emptyBody,
  openServiceBody,
  optionalReasonBody,
  pageOf,
  parse,
  productListQuery,
  productParams,
  requiredReasonBody,
  serviceParams,
  transitionBody,
  warrantyActivateBody,
  warrantyExtendBody,
} from '../../http/schemas.js';
import { adminActor, hasRole, requireAdmin } from '../../http/sessions.js';
import { toCodeRecord, toGenomeRecord, toProductRecord, type IssueProductInput } from '../../services/issuance.js';
import { requireProduct } from '../../services/lifecycle.js';
import type { AppContext } from '../../context.js';
import { makePage, pageOffset } from '../../types.js';
import type { AdminRouteDeps } from './index.js';
import { codeJson, genomeJson, issuedCodeJson, productJson } from './serialize.js';

/** Transitions that end a product's public validity: ADMIN only (contract §3: revocation is ADMIN's). */
export const ADMIN_ONLY_TARGETS: ReadonlySet<string> = new Set(['REVOKED', 'RETIRED']);

/** Escape LIKE metacharacters so a search for "50%" matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function overviewJson(r: ProductOverviewRow) {
  return {
    id: r.id,
    productId: r.product_id,
    sku: r.sku,
    category: r.category,
    categoryCode: r.category_code.trim(),
    collection: r.collection,
    model: r.model,
    modelType: r.model_type,
    variant: r.variant,
    material: r.material,
    productionBatch: r.production_batch,
    productionDate: r.production_date,
    genomeId: r.genome_id,
    genomePattern: r.genome_pattern,
    genomeFingerprint: r.genome_fingerprint,
    codeId: r.code_id,
    codeVersion: r.code_version,
    codeIssue: r.code_issue,
    status: r.status,
    ownershipState: r.ownership_state,
    warrantyStart: r.warranty_start,
    warrantyEnd: r.warranty_end,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type LiveCodeCheck = { valid: true; keyStatus: string } | { valid: false; reason: string; keyStatus: string | null };

/** Re-verify a stored code end to end, exactly as a scan of it would be judged cryptographically. */
export async function liveCodeCheck(ctx: AppContext, row: CodeRow, packedIdentity: number): Promise<LiveCodeCheck> {
  const key = await ctx.keys.publicKey(row.key_id);
  if (!key) return { valid: false, reason: 'UNKNOWN_KEY', keyStatus: null };
  let payload;
  try {
    payload = decodePayload(row.payload);
  } catch {
    return { valid: false, reason: 'PAYLOAD_INVALID', keyStatus: key.status };
  }
  if (
    packIdentity(payload.identity) !== packedIdentity ||
    payload.issue !== row.issue ||
    payload.keyId !== row.key_id ||
    payload.issuedDay !== row.issued_day ||
    payload.codeVersion !== row.code_version ||
    !equalBytes(payload.nonce, row.nonce)
  ) {
    return { valid: false, reason: 'PAYLOAD_MISMATCH', keyStatus: key.status };
  }
  const hash = new Uint8Array(createHash('sha256').update(row.payload).digest());
  if (!equalBytes(hash, row.payload_hash)) return { valid: false, reason: 'PAYLOAD_HASH_MISMATCH', keyStatus: key.status };
  if (!verifyEd25519Node(key.publicKey, signingMessage(row.payload), row.signature)) {
    return { valid: false, reason: 'SIGNATURE_INVALID', keyStatus: key.status };
  }
  if (!isKeyTrustedAt(key, row.created_at)) return { valid: false, reason: 'KEY_REVOKED', keyStatus: key.status };
  return { valid: true, keyStatus: key.status };
}

export const adminProductRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db } = ctx;
  const { issuance, lifecycle, warranty, ownership, anomaly } = ctx.services;

  // ── Read ─────────────────────────────────────────────────────────────────

  app.get('/api/admin/products', async (request) => {
    const f = parse(productListQuery, request.query);
    const page = pageOf(request.query);
    let q = db.selectFrom('product_overview');
    if (f.status) q = q.where('status', '=', f.status);
    if (f.category) q = q.where('category_code', '=', f.category);
    if (f.q) {
      const like = `%${escapeLike(f.q)}%`;
      q = q.where((eb) =>
        eb.or([eb('product_id', 'ilike', like), eb('sku', 'ilike', like), eb('model', 'ilike', like), eb('genome_fingerprint', 'ilike', like)]),
      );
    }
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await q.selectAll().orderBy('created_at', 'desc').orderBy('product_id').limit(page.pageSize).offset(pageOffset(page)).execute();
    return makePage(rows.map(overviewJson), Number(total.n), page);
  });

  app.get('/api/admin/products/:productId', async (request) => {
    const { productId } = parse(productParams, request.params);
    const product = await requireProduct(db, productId);
    const overview = await db.selectFrom('product_overview').selectAll().where('id', '=', product.id).executeTakeFirstOrThrow();
    const model = await db.selectFrom('models').select(['id', 'name', 'type', 'sku_prefix', 'care_instructions']).where('id', '=', product.model_id).executeTakeFirstOrThrow();
    const genomeRows = await db.selectFrom('genomes').selectAll().where('product_id', '=', product.id).orderBy('genome_version').execute();
    const codeRows = await db.selectFrom('codes').selectAll().where('product_id', '=', product.id).orderBy('issue').execute();
    const packed = Number(product.packed_identity);
    const codes = [];
    for (const row of codeRows) {
      codes.push({ ...codeJson(toCodeRecord(row, product.product_id)), verification: await liveCodeCheck(ctx, row, packed) });
    }
    const scans = await db
      .selectFrom('scan_events')
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.max('occurred_at').as('last')])
      .where('product_id', '=', product.id)
      .executeTakeFirstOrThrow();
    const genomes = genomeRows.map((g) => genomeJson(toGenomeRecord(g)));

    return {
      product: {
        ...productJson(toProductRecord(product, overview.category_code.trim())),
        category: { index: product.category_id, code: overview.category_code.trim(), name: overview.category },
        model: { id: model.id, name: model.name, type: model.type, skuPrefix: model.sku_prefix, care: model.care_instructions },
        collection: overview.collection,
      },
      genome: genomes[genomes.length - 1] ?? null,
      genomes,
      codes,
      scans: { count: Number(scans.n), lastAt: scans.last ?? null },
      ownership: { current: await ownership.currentOwner(product.id), ...(await ownership.history(product.id)) },
      warranty: await warranty.get(product.id),
      services: await warranty.services(product.id),
      anomalies: (await anomaly.list({ productId: product.id }, { page: 1, pageSize: 100 })).items,
      statusHistory: await lifecycle.history(product.id),
      lifecycle: await lifecycle.snapshot(product.id),
    };
  });

  // ── Issue ────────────────────────────────────────────────────────────────

  app.post('/api/admin/products', async (request, reply) => {
    // The service validates the body with its own strict schema (unknown fields → 400).
    const r = await issuance.issueProduct((request.body ?? {}) as IssueProductInput, adminActor(request));
    reply.code(201);
    return {
      product: productJson(r.product),
      genome: genomeJson(r.genome),
      code: issuedCodeJson(r.code),
      // Shown once: only its scrypt hash is stored.
      ...(r.claimCode ? { claimCode: r.claimCode } : {}),
    };
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  app.post('/api/admin/products/:productId/transitions', async (request) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(transitionBody, request.body);
    const { admin } = requireAdmin(request);
    // RETIRED is revocation-class: terminal (no reinstatement) and verifies as REVOKED, so it needs ADMIN too.
    if (ADMIN_ONLY_TARGETS.has(b.to) && !hasRole(admin.role, 'ADMIN')) throw forbidden('Only an ADMIN can revoke or retire a product.');
    const statusChange = await lifecycle.transition(productId, b.to, { reason: b.reason ?? null }, adminActor(request));
    return { statusChange, lifecycle: await lifecycle.snapshot(statusChange.id) };
  });

  app.post('/api/admin/products/:productId/reinstate', { config: { guard: { minRole: 'ADMIN' } } }, async (request) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(optionalReasonBody, request.body);
    const statusChange = await lifecycle.reinstate(productId, b.reason ?? null, adminActor(request));
    return { statusChange, lifecycle: await lifecycle.snapshot(statusChange.id) };
  });

  app.post('/api/admin/products/:productId/codes/reissue', async (request, reply) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(requiredReasonBody, request.body);
    const code = await issuance.reissueCode(productId, b.reason, adminActor(request));
    reply.code(201);
    return { code: issuedCodeJson(code) };
  });

  // ── Warranty & services ──────────────────────────────────────────────────

  app.post('/api/admin/products/:productId/warranty/activate', async (request) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(warrantyActivateBody, request.body);
    return warranty.activate(
      productId,
      { ...(b.purchaseDate ? { purchaseDate: b.purchaseDate } : {}), retailer: b.retailer ?? null, retailerId: b.retailerId ?? null, country: b.country ?? null },
      adminActor(request),
    );
  });

  app.post('/api/admin/products/:productId/warranty/void', async (request) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(optionalReasonBody, request.body);
    return { warranty: await warranty.void(productId, b.reason ?? null, adminActor(request)) };
  });

  app.post('/api/admin/products/:productId/warranty/extend', async (request) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(warrantyExtendBody, request.body);
    return { warranty: await warranty.extend(productId, b.months, adminActor(request)) };
  });

  app.post('/api/admin/products/:productId/services', async (request, reply) => {
    const { productId } = parse(productParams, request.params);
    const b = parse(openServiceBody, request.body);
    const service = await warranty.openService(
      productId,
      { type: b.type, location: b.location ?? null, notes: b.notes ?? null, performedBy: b.performedBy ?? null },
      adminActor(request),
    );
    reply.code(201);
    return { service };
  });

  app.post('/api/admin/services/:id/complete', async (request) => {
    const { id } = parse(serviceParams, request.params);
    const b = parse(completeServiceBody, request.body);
    return warranty.completeService(id, { notes: b.notes ?? null }, adminActor(request));
  });

  // ── Ownership ────────────────────────────────────────────────────────────

  app.post('/api/admin/products/:productId/ownership/confirm', async (request) => {
    const { productId } = parse(productParams, request.params);
    parse(emptyBody, request.body);
    return { ownership: await ownership.confirmOwnership(productId, adminActor(request)) };
  });
};
