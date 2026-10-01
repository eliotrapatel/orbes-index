/**
 * KeyService — the signing-key registry and lifecycle (contract §2.2).
 *
 *   ACTIVE   exactly one at a time (partial unique index); signs new codes
 *   RETIRED  verify-only; every code it signed stays valid
 *   REVOKED  codes are trusted only if their DB record predates the
 *            compromise (compromised_at, or revoked_at when unknown)
 *
 * Key ids are 1 byte (carried in every code), allocated lowest-unused in
 * 1..255 under an advisory lock. Rows are never deleted (codes reference them
 * and history must stay verifiable), so an id is never reused.
 *
 * Defences against faulty or hostile custody backends:
 *  - a new public key must be a strict (canonical, not small-order) Ed25519
 *    key, and the provider must prove possession by signing a probe that
 *    verifies before the key is registered;
 *  - every signature is verified with the registered public key before it is
 *    returned (verify-after-sign), so a broken HSM/KMS can never put an
 *    invalid code into circulation.
 *
 * Public keys are cached with a short TTL. Changes made through this instance
 * invalidate the cache at once; changes made by another instance become
 * visible within the TTL.
 */
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { concatBytes, toBase64Url, utf8 } from '../../core/bytes.js';
import { SIGNATURE_LENGTH } from '../../core/payload.js';
import { verifyEd25519Node } from '../crypto/ed25519-node.js';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { KeyRow, KeyStatus } from '../db/schema.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
import type { AuditService } from '../services/audit.js';
import { noopLogger, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import { isValidKid, KeyProviderError, type KeyProvider } from './key-provider.js';

export const KEY_ID_MIN = 1;
export const KEY_ID_MAX = 255;
export const PUBLIC_KEY_LENGTH = 32;
const DEFAULT_CACHE_TTL_MS = 30_000;
// Unknown key ids are cached briefly only: a key rotated on another instance must appear quickly.
const NEGATIVE_CACHE_TTL_MS = 5_000;
const MAX_REASON = 500;
// Domain-separated from 'ORBES-CODE/v1' so a probe signature can never double as a code signature.
const PROBE_DOMAIN = utf8('ORBES-KEY-PROBE/v1');

export interface KeyRecord {
  keyId: number;
  kid: string;
  algorithm: 'Ed25519';
  publicKey: Uint8Array;
  status: KeyStatus;
  provider: string;
  /** Opaque provider reference (file name, KMS key ARN, …). Never a secret. */
  providerRef: string;
  createdAt: Date;
  activatedAt: Date | null;
  retiredAt: Date | null;
  revokedAt: Date | null;
  compromisedAt: Date | null;
  revocationReason: string | null;
}

/** Entry of the public key list (`GET /api/v1/keys`, `/.well-known/orbes-keys.json`). */
export interface PublicKeyInfo {
  keyId: number;
  kid: string;
  alg: 'Ed25519';
  /** base64url, 32 bytes. */
  publicKey: string;
  status: KeyStatus;
  activatedAt: string | null;
  retiredAt: string | null;
  revokedAt: string | null;
}

export interface ActiveSigner {
  keyId: number;
  kid: string;
  publicKey: Uint8Array;
  /** Signs and verifies the signature against the registered public key before returning it. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface RevokeKeyInput {
  /** When the key is believed to have been compromised (≤ now). Codes recorded before it stay trusted. */
  compromisedAt?: Date;
  reason: string;
}

export interface KeyServiceDeps {
  db: Db;
  provider: KeyProvider;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
  /** Public-key cache lifetime (default 30 s). 0 disables caching. */
  cacheTtlMs?: number;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

/**
 * Contract §2.4 step 6: may a code whose DB record was created at
 * `codeCreatedAt` be trusted under this key? RETIRED and ACTIVE keys: yes.
 * REVOKED keys: only strictly before the compromise (or revocation) time.
 */
export function isKeyTrustedAt(key: Pick<KeyRecord, 'status' | 'revokedAt' | 'compromisedAt'>, codeCreatedAt: Date): boolean {
  if (key.status !== 'REVOKED') return true;
  const cutoff = key.compromisedAt ?? key.revokedAt;
  if (cutoff === null) return false; // inconsistent row: fail closed
  return codeCreatedAt.getTime() < cutoff.getTime();
}

/** Strict RFC 8032 public key: canonical encoding of a point of order > 8 (same rule as verifyEd25519Node). */
export function isStrictEd25519PublicKey(publicKey: unknown): publicKey is Uint8Array {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== PUBLIC_KEY_LENGTH) return false;
  try {
    return !ed25519.Point.fromBytes(publicKey, false).isSmallOrder();
  } catch {
    return false;
  }
}

export class KeyService {
  private readonly db: Db;
  private readonly provider: KeyProvider;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly ttl: number;

  private byId = new Map<number, CacheEntry<KeyRecord | undefined>>();
  private activeEntry: CacheEntry<KeyRecord | undefined> | undefined;
  private listEntry: CacheEntry<KeyRecord[]> | undefined;
  /** Bumped on invalidation so a load that started before a change cannot repopulate stale data. */
  private generation = 0;

  constructor(deps: KeyServiceDeps) {
    this.db = deps.db;
    this.provider = deps.provider;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.ttl = Math.max(0, deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  }

  /** Name of the custody provider new keys are created with. */
  get providerName(): string {
    return this.provider.name;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The signer for the current ACTIVE key. Pass `trx` to read the registry
   * inside a transaction (uncached); without it the cached record is used.
   * Throws NO_ACTIVE_KEY (503) when no key is active.
   */
  async activeSigner(trx?: Db): Promise<ActiveSigner> {
    const record = trx ? await this.loadActive(trx) : await this.cachedActive();
    if (!record) {
      throw new DomainError('NO_ACTIVE_KEY', 503, 'Code signing is temporarily unavailable.', {
        detail: 'no ACTIVE signing key; rotate to create one',
      });
    }
    if (record.provider !== this.provider.name) {
      throw new DomainError('SIGNING_UNAVAILABLE', 503, 'Code signing is temporarily unavailable.', {
        detail: `active key ${record.kid} belongs to provider '${record.provider}', configured provider is '${this.provider.name}'`,
      });
    }
    const { keyId, kid, providerRef } = record;
    // Private copy: the signer verifies against exactly the key it was handed, whatever callers do to theirs.
    const publicKey = Uint8Array.from(record.publicKey);
    return {
      keyId,
      kid,
      publicKey: Uint8Array.from(publicKey),
      sign: (message) => this.signVerified({ keyId, kid, providerRef, publicKey }, message),
    };
  }

  /** Registry record for a key id (any status), cached. Undefined for unknown or out-of-range ids. */
  async publicKey(keyId: number): Promise<KeyRecord | undefined> {
    if (!isKeyId(keyId)) return undefined;
    const now = this.now();
    const hit = this.byId.get(keyId);
    if (hit && hit.expires > now) return hit.value && cloneRecord(hit.value);
    const gen = this.generation;
    const row = await this.db.selectFrom('cryptographic_keys').selectAll().where('key_id', '=', keyId).executeTakeFirst();
    const record = row ? fromRow(row) : undefined;
    if (gen === this.generation && this.ttl > 0) {
      this.byId.set(keyId, { value: record, expires: now + (record ? this.ttl : Math.min(this.ttl, NEGATIVE_CACHE_TTL_MS)) });
    }
    return record && cloneRecord(record);
  }

  /** Every key (all statuses), ordered by key id, in public form. */
  async listPublic(): Promise<PublicKeyInfo[]> {
    return (await this.cachedList()).map(toPublicInfo);
  }

  /** Every key with its full registry record (admin). */
  async list(): Promise<KeyRecord[]> {
    return (await this.cachedList()).map(cloneRecord);
  }

  /** Drop every cached record (call after changing keys through another channel, e.g. SQL). */
  invalidate(): void {
    this.generation++;
    this.byId = new Map();
    this.activeEntry = undefined;
    this.listEntry = undefined;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Generate a new key and make it ACTIVE; the previous ACTIVE key becomes
   * RETIRED (verify-only). `kid` defaults to `orbes-k<id>-<yyyymmdd>-<rand>`.
   */
  async rotate(actor: Actor, kid?: string): Promise<KeyRecord> {
    if (kid !== undefined && !isValidKid(kid)) {
      throw validationError('Key label must be 1–64 characters: letters, digits, dot, underscore or hyphen.');
    }
    try {
      return await inTransaction(this.db, (trx) => this.rotateIn(trx, actor, kid));
    } finally {
      this.invalidate();
    }
  }

  /** Return the ACTIVE key, creating one (as by rotate) when none exists. For first start and the demo. */
  async ensureActiveKey(actor: Actor): Promise<KeyRecord> {
    try {
      return await inTransaction(this.db, async (trx) => {
        await advisoryXactLock(trx, ADVISORY_LOCK.KEY_ROTATION);
        const active = await this.loadActive(trx);
        return active ?? this.rotateIn(trx, actor, undefined);
      });
    } finally {
      this.invalidate();
    }
  }

  /** ACTIVE → RETIRED. Codes it signed stay valid. Issuance stops until the next rotation. */
  async retire(keyId: number, actor: Actor): Promise<void> {
    requireKeyId(keyId);
    try {
      await inTransaction(this.db, async (trx) => {
        await advisoryXactLock(trx, ADVISORY_LOCK.KEY_ROTATION);
        const row = await this.lockRow(trx, keyId);
        if (row.status !== 'ACTIVE') {
          throw conflict('KEY_NOT_ACTIVE', 'Only the active key can be retired.', `key ${keyId} is ${row.status}`);
        }
        const now = this.clock();
        await trx.updateTable('cryptographic_keys').set({ status: 'RETIRED', retired_at: now }).where('key_id', '=', keyId).execute();
        await this.audit.record(
          { actor, action: 'key.retire', targetType: 'key', targetId: String(keyId), details: { keyId, kid: row.kid } },
          trx,
        );
      });
    } finally {
      this.invalidate();
    }
    this.log.info({ keyId }, 'signing key retired');
  }

  /**
   * Revoke a key (ACTIVE or RETIRED). Codes whose DB record was created
   * before `compromisedAt` (or before now when it is not given) stay trusted;
   * later ones fail with KEY_REVOKED. Revoking an already revoked key again is
   * allowed only to move the compromise time EARLIER (a later finding never
   * widens trust).
   */
  async revoke(keyId: number, input: RevokeKeyInput, actor: Actor): Promise<void> {
    requireKeyId(keyId);
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 1 || reason.length > MAX_REASON) throw validationError(`A revocation reason of 1–${MAX_REASON} characters is required.`);
    const now = this.clock();
    let compromisedAt: Date | null = null;
    if (input.compromisedAt !== undefined && input.compromisedAt !== null) {
      if (!(input.compromisedAt instanceof Date) || Number.isNaN(input.compromisedAt.getTime())) {
        throw validationError('The compromise time is not a valid date.');
      }
      if (input.compromisedAt.getTime() > now.getTime()) throw validationError('The compromise time cannot be in the future.');
      compromisedAt = new Date(input.compromisedAt.getTime());
    }

    try {
      await inTransaction(this.db, async (trx) => {
        await advisoryXactLock(trx, ADVISORY_LOCK.KEY_ROTATION);
        const row = await this.lockRow(trx, keyId);

        if (row.status === 'REVOKED') {
          const cutoff = row.compromised_at ?? row.revoked_at;
          if (compromisedAt === null || (cutoff !== null && compromisedAt.getTime() >= cutoff.getTime())) {
            throw conflict('KEY_ALREADY_REVOKED', 'This key is already revoked.');
          }
          await trx.updateTable('cryptographic_keys').set({ compromised_at: compromisedAt }).where('key_id', '=', keyId).execute();
          await this.audit.record(
            {
              actor,
              action: 'key.revoke.amend',
              targetType: 'key',
              targetId: String(keyId),
              details: { keyId, kid: row.kid, compromisedAt, previousCutoff: cutoff, reason },
            },
            trx,
          );
          return;
        }

        await trx
          .updateTable('cryptographic_keys')
          .set({ status: 'REVOKED', revoked_at: now, compromised_at: compromisedAt, revocation_reason: reason })
          .where('key_id', '=', keyId)
          .execute();
        await trx
          .insertInto('revocations')
          .values({
            target_type: 'KEY',
            target_id: String(keyId),
            reason_code: compromisedAt ? 'KEY_COMPROMISED' : 'KEY_REVOKED',
            reason,
            created_by: actorLabel(actor),
            created_at: now,
          })
          .execute();
        await this.audit.record(
          {
            actor,
            action: 'key.revoke',
            targetType: 'key',
            targetId: String(keyId),
            details: { keyId, kid: row.kid, previousStatus: row.status, compromisedAt, reason },
          },
          trx,
        );
      });
    } finally {
      this.invalidate();
    }
    this.log.warn({ keyId, compromised: compromisedAt !== null }, 'signing key revoked');
  }

  /**
   * Startup/health check: sign a probe with the ACTIVE key and verify it. Catches a
   * wrong KEY_ENCRYPTION_KEY, a missing key file or an unreachable KMS before the
   * first issuance does. Resolves false when there is no active key.
   */
  async selfTest(): Promise<boolean> {
    const record = await this.loadActive(this.db);
    if (!record) return false;
    if (record.provider !== this.provider.name) return false;
    try {
      await this.signVerified(record, probeMessage(record.kid));
      return true;
    } catch {
      return false;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async rotateIn(trx: Db, actor: Actor, requestedKid: string | undefined): Promise<KeyRecord> {
    await advisoryXactLock(trx, ADVISORY_LOCK.KEY_ROTATION);
    const now = this.clock();
    const existing = await trx.selectFrom('cryptographic_keys').select(['key_id', 'kid', 'status']).execute();
    const used = new Set(existing.map((r) => r.key_id));
    let keyId = 0;
    for (let i = KEY_ID_MIN; i <= KEY_ID_MAX; i++) {
      if (!used.has(i)) {
        keyId = i;
        break;
      }
    }
    if (keyId === 0) throw conflict('KEY_IDS_EXHAUSTED', 'All 255 key ids are in use.');
    const kid = requestedKid ?? defaultKid(keyId, now);
    if (existing.some((r) => r.kid === kid)) throw conflict('KID_TAKEN', 'This key label is already in use.');

    let generated: { publicKey: Uint8Array; providerRef: string };
    try {
      generated = await this.provider.generate(kid);
    } catch (e) {
      if (e instanceof KeyProviderError && e.code === 'KEY_EXISTS') throw conflict('KID_TAKEN', 'This key label is already in use.');
      this.log.error({ kid, provider: this.provider.name, err: providerErrorInfo(e) }, 'key generation failed');
      throw new DomainError('KEY_PROVIDER_UNAVAILABLE', 503, 'The key provider is unavailable.', { cause: e });
    }

    try {
      const { providerRef } = generated;
      const publicKey = Uint8Array.from(generated.publicKey);
      if (!isStrictEd25519PublicKey(publicKey)) {
        throw new DomainError('KEY_REJECTED', 500, 'The key provider returned an unusable key.', {
          detail: 'public key is not a strict Ed25519 key (length, encoding or small order)',
        });
      }
      if (typeof providerRef !== 'string' || providerRef.length < 1 || providerRef.length > 512) {
        throw new DomainError('KEY_REJECTED', 500, 'The key provider returned an unusable key.', { detail: 'invalid provider reference' });
      }
      // Proof of possession: the provider must sign for the key it claims, or nothing is registered.
      await this.signVerified({ keyId, kid, providerRef, publicKey }, probeMessage(kid));

      const previous = existing.filter((r) => r.status === 'ACTIVE').map((r) => r.key_id);
      if (previous.length > 0) {
        // Before the insert: the partial unique index allows a single ACTIVE row at any instant.
        await trx
          .updateTable('cryptographic_keys')
          .set({ status: 'RETIRED', retired_at: now })
          .where('key_id', 'in', previous)
          .execute();
      }
      const row = await trx
        .insertInto('cryptographic_keys')
        .values({
          key_id: keyId,
          kid,
          algorithm: 'Ed25519',
          public_key: publicKey,
          status: 'ACTIVE',
          provider: this.provider.name,
          provider_ref: providerRef,
          created_at: now,
          activated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw conflict('KEY_CONFLICT', 'A concurrent key change happened. Please retry.', 'unique violation on insert');
          throw e;
        });
      const record = fromRow(row);
      await this.audit.record(
        {
          actor,
          action: 'key.rotate',
          targetType: 'key',
          targetId: String(keyId),
          details: {
            keyId,
            kid,
            alg: 'Ed25519',
            provider: this.provider.name,
            providerRef,
            publicKey: toBase64Url(publicKey),
            retiredKeyIds: previous,
          },
        },
        trx,
      );
      this.log.info({ keyId, kid, provider: this.provider.name, retiredKeyIds: previous }, 'signing key rotated');
      return record;
    } catch (e) {
      // The provider already holds the key; it is never registered, so it can never sign a code.
      this.log.warn({ kid, provider: this.provider.name }, 'generated key was not registered (orphaned in provider, unused)');
      throw e;
    }
  }

  /** Provider signature, then verify-after-sign with the registered public key. */
  private async signVerified(
    key: { keyId: number; kid: string; providerRef: string; publicKey: Uint8Array },
    message: Uint8Array,
  ): Promise<Uint8Array> {
    if (!(message instanceof Uint8Array)) throw new TypeError('message must be a Uint8Array');
    let signature: Uint8Array;
    try {
      signature = await this.provider.sign(key.providerRef, message);
    } catch (e) {
      this.log.error({ keyId: key.keyId, kid: key.kid, provider: this.provider.name, err: providerErrorInfo(e) }, 'signing failed');
      throw new DomainError('SIGNING_UNAVAILABLE', 503, 'Code signing is temporarily unavailable.', { cause: e });
    }
    const ok =
      signature instanceof Uint8Array &&
      signature.length === SIGNATURE_LENGTH &&
      verifyEd25519Node(key.publicKey, message, signature);
    if (!ok) {
      this.log.error({ keyId: key.keyId, kid: key.kid, provider: this.provider.name }, 'signature failed verify-after-sign; refused');
      throw new DomainError('SIGNING_FAILED', 503, 'Code signing is temporarily unavailable.', {
        detail: `signature from provider for key ${key.kid} does not verify with the registered public key`,
      });
    }
    return Uint8Array.from(signature);
  }

  private async lockRow(trx: Db, keyId: number): Promise<KeyRow> {
    const row = await trx.selectFrom('cryptographic_keys').selectAll().where('key_id', '=', keyId).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Key', 'KEY_NOT_FOUND');
    return row;
  }

  private async loadActive(db: Db): Promise<KeyRecord | undefined> {
    const row = await db.selectFrom('cryptographic_keys').selectAll().where('status', '=', 'ACTIVE').executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  private async cachedActive(): Promise<KeyRecord | undefined> {
    const now = this.now();
    if (this.activeEntry && this.activeEntry.expires > now) return this.activeEntry.value;
    const gen = this.generation;
    const record = await this.loadActive(this.db);
    if (gen === this.generation && this.ttl > 0) {
      this.activeEntry = { value: record, expires: now + (record ? this.ttl : Math.min(this.ttl, NEGATIVE_CACHE_TTL_MS)) };
    }
    return record;
  }

  private async cachedList(): Promise<KeyRecord[]> {
    const now = this.now();
    if (this.listEntry && this.listEntry.expires > now) return this.listEntry.value;
    const gen = this.generation;
    const rows = await this.db.selectFrom('cryptographic_keys').selectAll().orderBy('key_id', 'asc').execute();
    const records = rows.map(fromRow);
    if (gen === this.generation && this.ttl > 0) this.listEntry = { value: records, expires: now + this.ttl };
    return records;
  }

  private now(): number {
    return this.clock().getTime();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function isKeyId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= KEY_ID_MIN && v <= KEY_ID_MAX;
}

function requireKeyId(v: unknown): asserts v is number {
  if (!isKeyId(v)) throw validationError(`Key id must be an integer in ${KEY_ID_MIN}..${KEY_ID_MAX}.`);
}

function fromRow(r: KeyRow): KeyRecord {
  return Object.freeze({
    keyId: Number(r.key_id),
    kid: r.kid,
    algorithm: 'Ed25519' as const,
    publicKey: Uint8Array.from(r.public_key),
    status: r.status,
    provider: r.provider,
    providerRef: r.provider_ref,
    createdAt: r.created_at,
    activatedAt: r.activated_at,
    retiredAt: r.retired_at,
    revokedAt: r.revoked_at,
    compromisedAt: r.compromised_at,
    revocationReason: r.revocation_reason,
  });
}

/** Cached records are shared; hand out copies so a caller mutating publicKey cannot poison the cache. */
function cloneRecord(r: KeyRecord): KeyRecord {
  return Object.freeze({ ...r, publicKey: Uint8Array.from(r.publicKey) });
}

function toPublicInfo(r: KeyRecord): PublicKeyInfo {
  return {
    keyId: r.keyId,
    kid: r.kid,
    alg: 'Ed25519',
    publicKey: toBase64Url(r.publicKey),
    status: r.status,
    activatedAt: r.activatedAt?.toISOString() ?? null,
    retiredAt: r.retiredAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  };
}

function defaultKid(keyId: number, now: Date): string {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '');
  // Random suffix: a generation that failed after the provider stored the key must not block the retry's label.
  return `orbes-k${String(keyId).padStart(3, '0')}-${ymd}-${randomBytes(2).toString('hex')}`;
}

function probeMessage(kid: string): Uint8Array {
  return concatBytes(PROBE_DOMAIN, Uint8Array.of(0), utf8(kid), Uint8Array.of(0), randomBytes(16));
}

/** `admin:<id>` style label for revocations.created_by. */
export function actorLabel(actor: Actor): string {
  return actor.id ? `${actor.type}:${actor.id}` : actor.type;
}

/** Loggable summary of a provider failure (codes and messages never contain key material). */
function providerErrorInfo(e: unknown): { code?: string; message: string } {
  if (e instanceof KeyProviderError) return { code: e.code, message: e.message };
  if (e instanceof Error) return { message: e.message };
  return { message: 'unknown error' };
}
