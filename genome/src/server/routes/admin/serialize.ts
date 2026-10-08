/**
 * JSON views of service records for the admin API.
 *
 * Byte arrays are never sent raw (they would serialise as index maps) and
 * the scannable code `data` is only included where an OPERATOR is producing
 * codes (issuance, re-issue): anyone holding it can print a code that
 * verifies, so read-only roles get the fingerprints, not the payload.
 * Likewise a customer's email reads in clear from OPERATOR up and masked
 * (`j***@example.com`) for an AUDITOR (A-06, SECURITY-MODEL §3.6), and so do
 * the buyer's name and address of an order (decision 31 of LIVE RELEASE+:
 * `J*** D***`, the address withheld).
 */
import type { FastifyRequest } from 'fastify';
import { toBase64Url } from '../../../core/bytes.js';
import { hasRole, requireAdmin } from '../../http/sessions.js';
import type { KeyRecord } from '../../keys/key-service.js';
import type { AdminProfile } from '../../services/auth.js';
import type { CodeRecord, GenomeRecord, IssueBatchLine, ProductRecord } from '../../services/issuance.js';

/** `jane@example.com` → `j***@example.com`: the first character of the local part, then the domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${[...email.slice(0, at)][0]}***${email.slice(at)}`;
}

/** Whether the caller reads customers' emails in clear: OPERATOR and ADMIN do, an AUDITOR does not. */
export function readsClientEmails(request: FastifyRequest): boolean {
  return hasRole(requireAdmin(request).admin.role, 'OPERATOR');
}

/** A customer's email as the caller may read it (see `readsClientEmails`). */
export function clientEmail(email: string, inClear: boolean): string {
  return inClear ? email : maskEmail(email);
}

/** A name as an AUDITOR reads it: the first letter of each word, then `***` (`Jane Doe` → `J*** D***`). */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${[...w][0]}***`)
    .join(' ');
}

/** What an AUDITOR reads of an address: that one was entered. */
export const MASKED_ADDRESS = '***';

/**
 * An order's buyer as the caller may read it: in clear (OPERATOR, ADMIN), masked for an AUDITOR: the name masked, the
 * address withheld and, since plan NEXT LOT §3.6.B, the phone withheld (null) and the country shown (a country alone
 * names no one).
 */
export function orderBuyer<T extends { name: string | null; address: string | null; phone?: string | null }>(b: T, inClear: boolean): T {
  if (inClear) return b;
  return { ...b, name: b.name === null ? null : maskName(b.name), address: b.address === null ? null : MASKED_ADDRESS, ...('phone' in b ? { phone: null } : {}) };
}

/**
 * Whether the caller reads a parcel's Ship to in clear (plan NEXT LOT §3.5.3, §3.6.B): the agent, who ships it, and
 * OPERATOR and ADMIN; an AUDITOR reads it masked (`parcelShipTo`).
 */
export function readsShipTo(request: FastifyRequest): boolean {
  return requireAdmin(request).admin.role === 'LOGISTICS' || readsClientEmails(request);
}

/**
 * A parcel's Ship to as the caller may read it: in clear (see `readsShipTo`), or as an AUDITOR reads an order's buyer
 * (`orderBuyer`: the name masked, the address withheld), the phone withheld and the country shown (§3.6.B: a country
 * alone names no one).
 */
export function parcelShipTo<T extends { name: string | null; address: string | null; phone?: string | null }>(to: T, inClear: boolean): T {
  if (inClear) return to;
  return orderBuyer(to, false);
}

export function adminJson(a: AdminProfile) {
  return { id: a.id, email: a.email, role: a.role, totpEnabled: a.totpEnabled, passwordChangeRequired: a.passwordChangeRequired };
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

/**
 * One piece of a batch (POST /api/admin/products/batch): its identity, code id and claim code (shown
 * once) when signed; the refusal when not; nothing more when the batch stopped before it.
 */
export function issueBatchLineJson(line: IssueBatchLine) {
  if (line.status === 'ISSUED') {
    const { product, code, claimCode } = line.result;
    return {
      index: line.index,
      status: line.status,
      productId: product.productId,
      codeId: code.id,
      serial: product.serial,
      sku: product.sku,
      variant: product.variant,
      // Shown once: only its scrypt hash is stored.
      ...(claimCode ? { claimCode } : {}),
    };
  }
  if (line.status === 'FAILED') return { index: line.index, status: line.status, error: line.error };
  return { index: line.index, status: line.status };
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
