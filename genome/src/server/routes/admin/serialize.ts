/**
 * JSON views of service records for the admin API.
 *
 * Byte arrays are never sent raw (they would serialise as index maps) and
 * the scannable code `data` is only included where an OPERATOR is producing
 * codes (issuance, re-issue): anyone holding it can print a code that
 * verifies, so read-only roles get the fingerprints, not the payload.
 */
import { toBase64Url } from '../../../core/bytes.js';
import type { KeyRecord } from '../../keys/key-service.js';
import type { AdminProfile } from '../../services/auth.js';
import type { CodeRecord, GenomeRecord, ProductRecord } from '../../services/issuance.js';

export function adminJson(a: AdminProfile) {
  return { id: a.id, email: a.email, role: a.role, totpEnabled: a.totpEnabled };
}

export function productJson(p: ProductRecord) {
  return {
    id: p.id,
    productId: p.productId,
    packedIdentity: p.packedIdentity,
    year: p.year,
    categoryIndex: p.categoryIndex,
    categoryCode: p.categoryCode,
    serial: p.serial,
    sku: p.sku,
    modelId: p.modelId,
    collectionId: p.collectionId,
    variant: p.variant,
    material: p.material,
    productionBatch: p.productionBatch,
    productionDate: p.productionDate,
    status: p.status,
    ownershipState: p.ownershipState,
    authPolicy: p.authPolicy,
    hasClaimSecret: p.hasClaimSecret,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function genomeJson(g: GenomeRecord) {
  return {
    id: g.id,
    productId: g.productId,
    version: g.version,
    versionLabel: `GENOME-${String(g.version).padStart(2, '0')}`,
    value: g.value,
    glyphs: g.glyphs,
    ids: g.ids,
    pattern: g.pattern,
    fingerprint: g.fingerprint,
    createdAt: g.createdAt,
  };
}

/** A code without its scannable payload (read views). */
export function codeJson(c: CodeRecord) {
  return {
    id: c.id,
    productId: c.productId,
    keyId: c.keyId,
    codeVersion: c.codeVersion,
    issue: c.issue,
    issuedDay: c.issuedDay,
    issuedAt: c.issuedAt,
    nonce: c.nonce,
    payloadHash: c.payloadHash,
    status: c.status,
    revokedAt: c.revokedAt,
    revocationReason: c.revocationReason,
    createdAt: c.createdAt,
  };
}

/** A freshly produced code, including the base64url data a scanner reads (OPERATOR responses only). */
export function issuedCodeJson(c: CodeRecord) {
  return { ...codeJson(c), data: c.data };
}

export function keyJson(k: KeyRecord) {
  return {
    keyId: k.keyId,
    kid: k.kid,
    alg: k.algorithm,
    publicKey: toBase64Url(k.publicKey),
    status: k.status,
    provider: k.provider,
    createdAt: k.createdAt,
    activatedAt: k.activatedAt,
    retiredAt: k.retiredAt,
    revokedAt: k.revokedAt,
    compromisedAt: k.compromisedAt,
    revocationReason: k.revocationReason,
  };
}

/** `{ items }` wrapper for unpaginated admin lists (same top-level key as paged ones). */
export function itemsOf<T>(items: T[]): { items: T[] } {
  return { items };
}
