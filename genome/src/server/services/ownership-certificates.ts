/**
 * OwnershipCertificateService — the shareable ownership certificate (F-06;
 * API §8.6 and §11.7, DATABASE §5.26, SECURITY-MODEL §3.6).
 *
 * The current owner of a piece creates a link to a certificate of its record,
 * for a buyer at a distance or an insurer, without handing the piece over to
 * be scanned. The link is `{PUBLIC_ORIGIN}/verify/c#{token}`: the token rides
 * in the fragment, which browsers never send and Caddy therefore never logs
 * (a path would be written to its access log), and the page sends it in the
 * body of a POST.
 *
 * - Token: 32 random bytes, written as 52 Crockford base32 characters (the
 *   last one holds the final bit, its four low bits zero), so the PDF can
 *   letter it in capitals and a reader can type it back (case, I/L/O and
 *   hyphens forgiven). Only SHA-256 of the 32 bytes is stored (`token_hash`).
 * - Lifetime: 1 to 90 days, chosen at creation (30 by default); at most
 *   MAX_OPEN_CERTIFICATES links still valid per piece at once.
 * - Bound to the piece and to the ownership period it was created in.
 *
 * Everything a certificate shows is read live, at each lookup:
 *   VALID            the record: the piece and its GENOME, the ownership
 *                    (verified or not) and its date, the warranty, and that
 *                    no loss or theft is reported;
 *   NO_LONGER_VALID  expired, or the piece changed hands (its ownership period
 *                    ended), or it has been LOST, STOLEN, REVOKED,
 *                    COUNTERFEIT_FLAGGED or RETIRED since the certificate was
 *                    created (CERTIFICATE_ENDING_STATUSES): read from the
 *                    status history, so a piece found again does not bring an
 *                    old certificate back to life;
 *   404              unknown, malformed or withdrawn by its owner: one answer
 *                    (CERTIFICATE_NOT_FOUND), so a withdrawn link says no more
 *                    than a link that never existed.
 * Never a name, an email, an account or the certificate's own id, and never
 * the word AUTHENTIC: a certificate attests a record, not the object it is
 * shown with.
 *
 * Creation and withdrawal are the owner's (account session, CSRF), audited
 * `ownership.certificate.create` and `ownership.certificate.revoke` (the
 * certificate's id, never its token). Lookups are public and not audited:
 * they draw on the `verify` rate budget.
 */
import { createHash, randomBytes } from 'node:crypto';
import { inTransaction, type Db } from '../db/connection.js';
import type { ProductStatus } from '../db/schema.js';
import { DomainError, forbidden, validationError } from '../errors.js';
import { renderOwnershipCertificatePdf, type RenderedCertificates } from '../render/certificate.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { CROCKFORD_ALPHABET, normalizeCrockford } from './claim-codes.js';
import { lockForOwnerAction, notOwner, readActingAccount, type OwnershipService } from './ownership.js';
import { utcDate, type WarrantySummary } from './warranty.js';

export const CERTIFICATE_TOKEN_BYTES = 32;
/** 256 bits in 5-bit characters. */
export const CERTIFICATE_TOKEN_LENGTH = Math.ceil((CERTIFICATE_TOKEN_BYTES * 8) / 5);
export const CERTIFICATE_MIN_DAYS = 1;
export const CERTIFICATE_MAX_DAYS = 90;
export const CERTIFICATE_DEFAULT_DAYS = 30;
/** Links of one piece still valid at once (created by its current owner, neither expired, withdrawn nor ended). */
export const MAX_OPEN_CERTIFICATES = 10;
/** The verify app's route of the public certificate (the token follows in the fragment). */
export const CERTIFICATE_PATH = '/verify/c';
/** Statuses that end every certificate created before the piece entered them. */
export const CERTIFICATE_ENDING_STATUSES: readonly ProductStatus[] = Object.freeze(['LOST', 'STOLEN', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED']);

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Generous bound on a typed token (52 characters, 12 hyphens, spaces). */
const MAX_TOKEN_INPUT = 128;

// ── Tokens ─────────────────────────────────────────────────────────────────

/** 32 bytes as 52 Crockford base32 characters, most significant bit first (the last character carries one bit). */
export function encodeCertificateToken(bytes: Uint8Array): string {
  if (bytes.length !== CERTIFICATE_TOKEN_BYTES) throw new RangeError(`a certificate token is ${CERTIFICATE_TOKEN_BYTES} bytes`);
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * The 32 bytes of a token in any accepted spelling (case, I/L read as 1, O as 0, hyphens and spaces ignored), or
 * undefined when it cannot be one: another length, a character outside the alphabet, or padding bits that are not
 * zero (one spelling per token).
 */
export function certificateTokenBytes(token: unknown): Uint8Array | undefined {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_INPUT) return undefined;
  const canonical = normalizeCrockford(token.replace(/[\s-]+/g, ''), CERTIFICATE_TOKEN_LENGTH);
  if (canonical === undefined) return undefined;
  const out = new Uint8Array(CERTIFICATE_TOKEN_BYTES);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of canonical) {
    acc = (acc << 5) | CROCKFORD_ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (o < out.length) out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  // 52 × 5 = 260 bits: 256 of the token, then 4 padding bits that must be zero.
  if (o !== out.length || acc !== 0) return undefined;
  return out;
}

/** The canonical spelling of a token (52 characters, no separators), or undefined. */
export function canonicalCertificateToken(token: unknown): string | undefined {
  const bytes = certificateTokenBytes(token);
  return bytes ? encodeCertificateToken(bytes) : undefined;
}

/** What is stored: SHA-256 of the 32 token bytes, or undefined when `token` is not one. */
export function hashCertificateToken(token: unknown): Uint8Array | undefined {
  const bytes = certificateTokenBytes(token);
  return bytes ? new Uint8Array(createHash('sha256').update(bytes).digest()) : undefined;
}

// ── Types ──────────────────────────────────────────────────────────────────

/** POST /api/v1/ownership/certificates: the link, shown once (only its token's hash is stored). */
export interface CertificateOffer {
  id: string;
  productId: string;
  token: string;
  /** `{PUBLIC_ORIGIN}/verify/c#{token}`. */
  url: string;
  createdAt: Date;
  expiresAt: Date;
}

/** One link of the owner's (GET /api/v1/ownership/certificates): not withdrawn, not expired, of a piece they own. */
export interface OwnerCertificate {
  id: string;
  productId: string;
  createdAt: Date;
  expiresAt: Date;
  /** False once the piece has been reported lost or stolen (or revoked, flagged, retired) since it was created. */
  valid: boolean;
}

/** The piece as a certificate shows it: what a result's product lines and GENOME show, nothing about a person. */
export interface CertificatePiece {
  productId: string;
  category: { code: string; name: string };
  collection: string | null;
  model: string;
  type: string;
  variant: string | null;
  material: string;
  createdYear: number;
  genome: { id: string; version: number; fingerprint: string; glyphs: number[]; pattern: string } | null;
}

/** POST /api/v1/certificates/lookup (API §8.6). */
export type CertificateLookup =
  | {
      status: 'VALID';
      /** When the record was read: now. */
      checkedAt: Date;
      certificate: { issuedAt: Date; expiresAt: Date };
      piece: CertificatePiece;
      /** Verified (a claim code, or ORBES Client Services), and the day the ownership began ('YYYY-MM-DD', UTC). */
      ownership: { verified: boolean; since: string };
      warranty: WarrantySummary;
      /** No loss or theft is reported (a VALID certificate never has one). */
      incidentReported: false;
    }
  | { status: 'NO_LONGER_VALID'; checkedAt: Date };

export interface OwnershipCertificateServiceDeps {
  db: Db;
  audit: AuditService;
  ownership: OwnershipService;
  /** PUBLIC_ORIGIN: the address of the links. */
  publicOrigin: string;
  clock?: Clock;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Unknown, malformed or withdrawn: one answer for all (the message says nothing about which). */
export const certificateNotFound = () =>
  new DomainError('CERTIFICATE_NOT_FOUND', 404, 'This certificate link is not valid: it may be incomplete, or withdrawn by its owner. Ask the owner of the piece for a new link.');
const certificateNoLongerValid = () => new DomainError('CERTIFICATE_NO_LONGER_VALID', 409, 'This certificate is no longer valid. Ask the owner of the piece for a new one.');
const certificateNotAllowed = (status: ProductStatus) =>
  new DomainError('CERTIFICATE_NOT_ALLOWED', 409, 'A certificate cannot be created for this piece at this time. ORBES Client Services can assist you.', { detail: `status ${status}` });
const certificateLimit = () =>
  new DomainError('CERTIFICATE_LIMIT', 409, `This piece already has ${MAX_OPEN_CERTIFICATES} certificate links in use. Withdraw one before creating another.`);

/**
 * When the piece last entered a status that ends certificates (null: never). A certificate created at or before it is
 * no longer valid, even once the piece is found again or reinstated.
 */
async function lastEndingAt(db: Db, productUuid: string): Promise<Date | null> {
  const r = await db
    .selectFrom('product_status_history')
    .select((eb) => eb.fn.max('created_at').as('at'))
    .where('product_id', '=', productUuid)
    .where('to_status', 'in', [...CERTIFICATE_ENDING_STATUSES])
    .executeTakeFirst();
  const at = r?.at as Date | string | null | undefined;
  return at ? new Date(at) : null;
}

const after = (createdAt: Date, endedAt: Date | null) => endedAt === null || createdAt.getTime() > endedAt.getTime();

// ── Service ────────────────────────────────────────────────────────────────

export class OwnershipCertificateService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly ownership: OwnershipService;
  private readonly publicOrigin: string;
  private readonly clock: Clock;

  constructor(deps: OwnershipCertificateServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.ownership = deps.ownership;
    this.publicOrigin = deps.publicOrigin.replace(/\/+$/, '');
    this.clock = deps.clock ?? systemClock;
  }

  /** The live address of a certificate. */
  linkFor(token: string): string {
    return `${this.publicOrigin}${CERTIFICATE_PATH}#${token}`;
  }

  /**
   * The current owner creates a link to a certificate of the piece, valid `validDays` days (1 to 90, 30 by default).
   * Refused: another account's piece, or an unknown id (403 NOT_OWNER, alike), a piece reported lost or stolen,
   * revoked, flagged or retired (409 CERTIFICATE_NOT_ALLOWED), MAX_OPEN_CERTIFICATES links still valid (409
   * CERTIFICATE_LIMIT), an account locked by ORBES Client Services meanwhile (403 ACCOUNT_LOCKED). In one
   * transaction under the account's share lock, then the piece's row lock (lock order account → product).
   */
  async create(accountId: string, productId: string, opts: { validDays?: number }, actor: Actor): Promise<CertificateOffer> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
    const days = opts.validDays ?? CERTIFICATE_DEFAULT_DAYS;
    if (!Number.isInteger(days) || days < CERTIFICATE_MIN_DAYS || days > CERTIFICATE_MAX_DAYS) {
      throw validationError(`A certificate is valid for ${CERTIFICATE_MIN_DAYS} to ${CERTIFICATE_MAX_DAYS} days.`);
    }
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await readActingAccount(tx, accountId);
      if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const p = await lockForOwnerAction(tx, productId);
      const current = await tx.selectFrom('ownership').select(['id', 'account_id']).where('product_id', '=', p.id).where('ended_at', 'is', null).executeTakeFirst();
      if (!current || current.account_id !== accountId) throw notOwner();
      if (CERTIFICATE_ENDING_STATUSES.includes(p.status)) throw certificateNotAllowed(p.status);
      const endedAt = await lastEndingAt(tx, p.id);
      const open = await tx
        .selectFrom('ownership_certificates')
        .select('created_at')
        .where('ownership_id', '=', current.id)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', now)
        .execute();
      if (open.filter((c) => after(c.created_at, endedAt)).length >= MAX_OPEN_CERTIFICATES) throw certificateLimit();

      const bytes = new Uint8Array(randomBytes(CERTIFICATE_TOKEN_BYTES));
      const token = encodeCertificateToken(bytes);
      const tokenHash = new Uint8Array(createHash('sha256').update(bytes).digest());
      bytes.fill(0);
      const expiresAt = new Date(now.getTime() + days * DAY_MS);
      const row = await tx
        .insertInto('ownership_certificates')
        .values({ token_hash: tokenHash, product_id: p.id, ownership_id: current.id, created_at: now, expires_at: expiresAt })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          actor,
          action: 'ownership.certificate.create',
          targetType: 'product',
          targetId: p.product_id,
          details: { certificateId: row.id, expiresAt, validDays: days },
        },
        tx,
      );
      return { id: row.id, productId: p.product_id, token, url: this.linkFor(token), createdAt: now, expiresAt };
    });
  }

  /** The account's links still open (not withdrawn, not expired) for the pieces it owns now, newest first. */
  async listForAccount(accountId: string): Promise<OwnerCertificate[]> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
    const now = this.clock();
    const rows = await this.db
      .selectFrom('ownership_certificates as c')
      .innerJoin('ownership as o', 'o.id', 'c.ownership_id')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .select(['c.id', 'c.created_at', 'c.expires_at', 'p.id as uuid', 'p.product_id', 'p.status'])
      .where('o.account_id', '=', accountId)
      .where('o.ended_at', 'is', null)
      .where('c.revoked_at', 'is', null)
      .where('c.expires_at', '>', now)
      .orderBy('c.created_at', 'desc')
      .orderBy('c.id')
      .execute();
    const endings = new Map<string, Date | null>();
    for (const uuid of new Set(rows.map((r) => r.uuid))) endings.set(uuid, await lastEndingAt(this.db, uuid));
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      valid: !CERTIFICATE_ENDING_STATUSES.includes(r.status) && after(r.created_at, endings.get(r.uuid) ?? null),
    }));
  }

  /**
   * The owner withdraws a link: from then on it answers 404, as a link that never existed. Only a link created in one
   * of the account's ownership periods (current or past); anything else, an already withdrawn one included, answers
   * 404 CERTIFICATE_NOT_FOUND. Audited `ownership.certificate.revoke`.
   */
  async revoke(accountId: string, certificateId: string, actor: Actor): Promise<void> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
    if (typeof certificateId !== 'string' || !UUID_RE.test(certificateId)) throw certificateNotFound();
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const r = await tx
        .updateTable('ownership_certificates')
        .set({ revoked_at: now })
        .where('id', '=', certificateId)
        .where('revoked_at', 'is', null)
        .where('ownership_id', 'in', (eb) => eb.selectFrom('ownership').select('id').where('account_id', '=', accountId))
        .returning(['id', 'product_id'])
        .executeTakeFirst();
      if (!r) throw certificateNotFound();
      const p = await tx.selectFrom('products').select('product_id').where('id', '=', r.product_id).executeTakeFirstOrThrow();
      await this.audit.record(
        { actor, action: 'ownership.certificate.revoke', targetType: 'product', targetId: p.product_id, details: { certificateId: r.id } },
        tx,
      );
    });
  }

  /** What a link shows, read now (see the file header). Throws 404 CERTIFICATE_NOT_FOUND for unknown and withdrawn links. */
  async lookup(token: unknown): Promise<CertificateLookup> {
    const hash = hashCertificateToken(token);
    if (!hash) throw certificateNotFound();
    const row = await this.db
      .selectFrom('ownership_certificates as c')
      .innerJoin('ownership as o', 'o.id', 'c.ownership_id')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .select(['c.created_at', 'c.expires_at', 'c.revoked_at', 'o.account_id', 'o.ended_at', 'p.id as uuid', 'p.status'])
      .where('c.token_hash', '=', hash)
      .executeTakeFirst();
    if (!row || row.revoked_at !== null) throw certificateNotFound();
    const now = this.clock();
    const noLonger: CertificateLookup = { status: 'NO_LONGER_VALID', checkedAt: now };
    if (row.expires_at.getTime() <= now.getTime() || row.ended_at !== null || CERTIFICATE_ENDING_STATUSES.includes(row.status)) return noLonger;
    if (!after(row.created_at, await lastEndingAt(this.db, row.uuid))) return noLonger;
    // The owner's own view of the piece, narrowed to what a certificate may show.
    const [owned] = await this.ownership.listForAccount(row.account_id, { productUuid: row.uuid });
    if (!owned || owned.incident !== null) return noLonger;
    return {
      status: 'VALID',
      checkedAt: now,
      certificate: { issuedAt: row.created_at, expiresAt: row.expires_at },
      piece: {
        productId: owned.productId,
        category: owned.category,
        collection: owned.collection,
        model: owned.model,
        type: owned.type,
        variant: owned.variant,
        material: owned.material,
        createdYear: owned.createdYear,
        genome: owned.genome,
      },
      ownership: { verified: owned.verified, since: utcDate(owned.since) },
      warranty: owned.warranty,
      incidentReported: false,
    };
  }

  /**
   * The certificate as a PDF (render/certificate.ts): the record read now, its date, and the link, lettered and as a
   * link annotation, so whoever holds the page can check it. 404 as `lookup`; 409 CERTIFICATE_NO_LONGER_VALID when
   * it no longer is (no PDF of a certificate that does not hold).
   */
  async renderPdf(token: unknown): Promise<RenderedCertificates> {
    const r = await this.lookup(token);
    if (r.status !== 'VALID') throw certificateNoLongerValid();
    const { piece } = r;
    return renderOwnershipCertificatePdf({
      productId: piece.productId,
      category: piece.category.name,
      collection: piece.collection,
      model: piece.model,
      type: piece.type,
      variant: piece.variant,
      material: piece.material,
      createdYear: piece.createdYear,
      genome: piece.genome,
      verified: r.ownership.verified,
      since: r.ownership.since,
      warranty: r.warranty,
      issuedAt: r.certificate.issuedAt,
      expiresAt: r.certificate.expiresAt,
      checkedAt: r.checkedAt,
      link: this.linkFor(canonicalCertificateToken(token)!),
    });
  }
}
