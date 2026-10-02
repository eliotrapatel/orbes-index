/**
 * VerificationService (contract §2.4): the server-side decision on a scanned
 * ORBES CODE. The decision procedure below is normative; each numbered step
 * matches the contract, and the first step that decides the state ends the
 * decision (later steps may still record evidence: the scan event, anomaly
 * findings and the authentication event are written for every request).
 *
 * What a result proves: a valid ORBES signature, a registry entry, a
 * lifecycle status and a consistent scan history. It never proves that the
 * physical object is genuine (a printed code can be copied), and the copy in
 * copy.ts never says so.
 *
 * The public outcome is built field by field from an allow-list. Internal
 * facts (risk score, thresholds, raw product status, reasons, anomaly
 * details) are stored on `authentication_events` / `anomalies` for the admin
 * console and never leave this module in the response.
 *
 * `staffScan` (A-08, the console's sale mode) runs the same steps 1–8 for a
 * console user and records an ADMIN_TEST scan naming that user, without the
 * history, ownership and anomaly steps and without any public wording.
 * `verify` with a console session (S-07: `ScanMeta.adminId`) is a staff scan
 * too: ADMIN_TEST, outside UNSOLD_PIECE_SCAN and the history rules (the code's
 * own findings of steps 6–7 are still recorded, marked `staffScan`), no
 * registration token, the public wording.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { equalBytes, fromBase64Url } from '../../core/bytes.js';
import { computeGenome, SUPPORTED_GENOME_VERSIONS, type Genome } from '../../core/genome/genome.js';
import { packIdentity } from '../../core/identity.js';
import { CODE_PROFILES, unframeAnyCodeData } from '../../core/code-profiles.js';
import { dateFromIssuedDay, PayloadError, type CodePayloadV1 } from '../../core/payload.js';
import type { AnomalyConfig } from '../config.js';
import { verifyEd25519Node } from '../crypto/ed25519-node.js';
import { inTransaction, type Db } from '../db/connection.js';
import {
  jsonText,
  type CodeStatus,
  type GenomeCheck,
  type JsonObject,
  type JsonValue,
  type ProductStatus,
  type VerificationState,
} from '../db/schema.js';
import { validationError } from '../errors.js';
import { normalizeCountry, roundCoord, type GeoInfo } from '../geo/resolver.js';
import { isKeyTrustedAt, type KeyRecord, type KeyService } from '../keys/key-service.js';
import { AuthenticatorRegistry, type Assurance, type PolicyEvaluation } from '../authenticators/index.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { ANOMALY_WEIGHTS, type ServiceFindingType } from './anomaly-rules.js';
import type { AnomalyFinding, AnomalyService } from './anomaly.js';
import { copyFor } from './copy.js';
import { isPreSaleService } from './lifecycle.js';
import { createScanToken, SCAN_TOKEN_TTL_MS } from './scan-tokens.js';
import { computeWarrantyStatus, utcDate, type WarrantyStatus } from './warranty.js';

export type { VerificationState } from '../db/schema.js';
export type { GeoInfo } from '../geo/resolver.js';

// ── Public contract types ──────────────────────────────────────────────────

export interface VerifyInput {
  /** base64url of the 79-byte framed code data. */
  code: string;
  genome?: { glyphs: (number | null)[]; confidence?: number[] };
  client?: { rsErrors?: number; rsErasures?: number; moduleSizePx?: number; decodeMs?: number; source?: 'camera' | 'upload' };
}

export interface ScanMeta {
  /** HMAC(pepper, device cookie id). */
  deviceHash?: string;
  /** HMAC of the session token (or another per-session pseudonym). */
  sessionHash?: string;
  /** accounts.id of the logged-in viewer, if any. */
  accountId?: string;
  /** HMAC(pepper, IP). Raw IPs are never passed here. */
  ipHash?: string;
  geo?: GeoInfo;
  userAgentFamily?: string;
  /**
   * admin_users.id of the console user whose session the request carries (S-07): the scan is a
   * staff scan, recorded as ADMIN_TEST under that user (see verify()).
   */
  adminId?: string;
}

export type VerificationNotice = 'UNUSUAL_ACTIVITY';

/** The API response body of POST /api/v1/verify. */
export interface VerifyOutcome {
  state: VerificationState;
  scanId: string;
  verifiedAt: string;
  title: string;
  message: string;
  notice?: VerificationNotice;
  verification?: {
    signature: 'VALID';
    keyId: number;
    codeVersion: string;
    genomeVersion: string;
    issuedAt: string;
    issue: number;
    assurance: Assurance;
    hardwareProofRequired?: boolean;
  };
  product?: {
    productId: string;
    category: { code: string; name: string };
    collection?: string;
    model: string;
    type: string;
    variant?: string;
    material: string;
    createdYear: number;
    productionDate?: string;
    care?: string;
  };
  genome?: { id: string; version: string; fingerprint: string; glyphs: number[]; ids: string[] };
  warranty?: { status: WarrantyStatus; startDate?: string; endDate?: string };
  ownership?: { registered: boolean; you: boolean; transferPending?: boolean };
  registration?: { token: string; expiresAt: string; claimCodeRequired: boolean };
}

/** What a staff scan (VerificationService.staffScan, the sale mode) learns: registry facts, never a risk score. */
export interface StaffScan {
  scanId: string;
  occurredAt: Date;
  /** The decision of steps 1–8; AUTHENTIC when none of them refused the code. */
  state: VerificationState;
  reasons: readonly string[];
  /** The registered piece of a trusted code (key trusted, product and code found, payload hash equal); null otherwise. */
  piece: StaffScanPiece | null;
}

export interface StaffScanPiece {
  /** products.id */
  productUuid: string;
  productId: string;
  status: ProductStatus;
  category: { code: string; name: string };
  collection: string | null;
  model: string;
  type: string;
  variant: string | null;
  material: string;
  createdYear: number;
  warranty: { status: WarrantyStatus; startDate: string | null; endDate: string | null; voided: boolean };
  /** A customer account holds it. */
  registered: boolean;
}

export interface VerificationServiceDeps {
  db: Db;
  keys: KeyService;
  anomaly: AnomalyService;
  /** Internal thresholds (only `suspiciousThreshold` is read here). */
  config: { anomaly: AnomalyConfig };
  authenticators?: AuthenticatorRegistry;
  clock?: Clock;
  log?: Logger;
  /** Registration token lifetime (default 15 minutes). */
  registrationTtlMs?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Contract §2.4 step 1: base64url of 79 bytes is 106 chars; anything over 200 is refused unread. */
export const MAX_CODE_CHARS = 200;
/** Step 7: a reading counts when it has at least this many confident glyphs… */
export const GENOME_MIN_GLYPHS = 6;
/** …each with at least this confidence… */
export const GENOME_MIN_CONFIDENCE = 0.5;
/** …and it is a mismatch from this many differing glyphs on. */
export const GENOME_MISMATCH_GLYPHS = 2;
const GENOME_LENGTH = 8;

const REGISTRABLE: readonly ProductStatus[] = ['ACTIVATED', 'RESOLD', 'SERVICED'];
const REVOKING_PRODUCT: readonly ProductStatus[] = ['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'];
const INCIDENT_PRODUCT: readonly ProductStatus[] = ['LOST', 'STOLEN'];
const REVOKED_CODE: readonly CodeStatus[] = ['SUPERSEDED', 'REVOKED'];
const AUTHENTIC_STATES: readonly VerificationState[] = [
  'AUTHENTIC',
  'AUTHENTIC_FIRST_REGISTRATION',
  'AUTHENTIC_REGISTERED',
  'AUTHENTIC_OWNERSHIP_VERIFIED',
];
const GENOME_STATES: readonly VerificationState[] = [...AUTHENTIC_STATES, 'SUSPICIOUS_ACTIVITY', 'REVOKED'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_META_TEXT = 200;

/**
 * Request body schema for POST /api/v1/verify (strict: unknown keys are
 * rejected). `code` is deliberately loose (any string up to 1 KiB): a code
 * that cannot be decoded must reach the service and be recorded as
 * MALFORMED_CODE rather than bounce as a 400.
 */
export const verifyInputSchema = z.strictObject({
  code: z.string().max(1024),
  genome: z
    .strictObject({
      glyphs: z.array(z.int().min(0).max(15).nullable()).length(GENOME_LENGTH),
      confidence: z.array(z.number().min(0).max(1)).length(GENOME_LENGTH).optional(),
    })
    .optional(),
  client: z
    .strictObject({
      rsErrors: z.int().min(0).max(255).optional(),
      rsErasures: z.int().min(0).max(255).optional(),
      moduleSizePx: z.number().min(0).max(10_000).optional(),
      decodeMs: z.number().min(0).max(600_000).optional(),
      source: z.enum(['camera', 'upload']).optional(),
    })
    .optional(),
});

// ── Internal working state ─────────────────────────────────────────────────

interface Registered {
  productUuid: string;
  productId: string;
  year: number;
  status: ProductStatus;
  variant: string | null;
  material: string;
  productionDate: string | null;
  authPolicy: string;
  hasClaimSecret: boolean;
  categoryCode: string;
  categoryName: string;
  modelName: string;
  modelType: string;
  care: string | null;
  collection: string | null;
  code: { id: string; status: CodeStatus; createdAt: Date; payloadHash: Uint8Array } | null;
  warranty: { start_date: string | null; end_date: string | null; voided_at: Date | null; duration_months: number } | null;
  ownerAccountId: string | null;
  transferPending: boolean;
}

interface Work {
  state?: VerificationState;
  reasons: string[];
  payload?: CodePayloadV1;
  payloadBytes?: Uint8Array;
  signatureValid: boolean;
  key?: KeyRecord;
  reg?: Registered;
  /** Key trusted, product and code found, payload hash equal (steps 4 and 6 passed). */
  trusted: boolean;
  /** Step 5 ended the decision: a validly signed genome version this server does not support. */
  unsupportedGenomeVersion?: number;
  /** A well-formed code of a code version without a profile on this server (outdated server). */
  unsupportedCodeVersion?: number;
  genome?: Genome;
  genomeCheck: GenomeCheck;
  serviceFinding?: { type: ServiceFindingType; details: JsonObject };
  riskScore: number;
  notice?: VerificationNotice;
  isOwner: boolean;
  policy?: PolicyEvaluation;
}

interface CleanGenome {
  glyphs: (number | null)[];
  confidence?: number[];
}

// ── Service ────────────────────────────────────────────────────────────────

export class VerificationService {
  private readonly db: Db;
  private readonly keys: KeyService;
  private readonly anomaly: AnomalyService;
  private readonly threshold: number;
  private readonly authenticators: AuthenticatorRegistry;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly registrationTtlMs: number;

  constructor(deps: VerificationServiceDeps) {
    this.db = deps.db;
    this.keys = deps.keys;
    this.anomaly = deps.anomaly;
    const t = deps.config?.anomaly?.suspiciousThreshold;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > 100) {
      throw new TypeError('VerificationService: config.anomaly.suspiciousThreshold must be in (0, 100]');
    }
    this.threshold = t;
    this.authenticators = deps.authenticators ?? AuthenticatorRegistry.withDefaults();
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.registrationTtlMs = deps.registrationTtlMs ?? SCAN_TOKEN_TTL_MS;
  }

  /**
   * The public verification. A request that carries a console session (`meta.adminId`, S-07) is a
   * staff scan: the same decision, recorded as ADMIN_TEST under that console user without the
   * device, session or account pseudonyms; it raises no UNSOLD_PIECE_SCAN, takes no part in the
   * scoring of step 9 (which still reads the public history, so the state is the one a customer
   * would see) and earns no registration token. The findings of steps 6–7 describe the code, not
   * who scanned it (VALID_SIGNATURE_UNREGISTERED and CODE_MISMATCH page on a possible key
   * compromise): a staff scan records them too, with `staffScan: true` in their details. A public
   * scan of a piece ORBES has not sold yet (ISSUED, or in a pre-sale service) records
   * UNSOLD_PIECE_SCAN, once per piece and per UTC day, with weight 0: the state shown does not change.
   */
  async verify(input: VerifyInput, meta: ScanMeta = {}): Promise<VerifyOutcome> {
    const started = performance.now();
    const now = this.clock();
    const genomeReading = cleanGenome(input?.genome);
    const clientMetrics = cleanClientMetrics(input?.client);
    const m = cleanMeta(meta);
    const staff = m.adminId !== null;

    const w: Work = { reasons: [], signatureValid: false, trusted: false, genomeCheck: 'NOT_PROVIDED', riskScore: 0, isOwner: false };
    await this.decide(w, input?.code, genomeReading);

    // Steps 9–12 (and the persistence of every earlier decision) in one transaction.
    const result = await inTransaction(this.db, async (trx) => {
      const scan = await trx
        .insertInto('scan_events')
        .values({
          occurred_at: now,
          code_id: w.trusted && w.reg?.code ? w.reg.code.id : null,
          product_id: w.reg?.productUuid ?? null,
          packed_identity: w.payload ? packedOf(w.payload) : null,
          event_type: staff ? 'ADMIN_TEST' : 'VERIFY',
          admin_id: m.adminId,
          // A staff scan names its console user and nothing else of the browser (as the sale mode's).
          device_hash: staff ? null : m.deviceHash,
          session_hash: staff ? null : m.sessionHash,
          account_id: staff ? null : m.accountId,
          ip_hash: m.ipHash,
          country: m.country,
          region: m.region,
          lat: m.lat,
          lon: m.lon,
          user_agent_family: m.userAgentFamily,
          client_metrics: clientMetrics ? jsonText(clientMetrics) : null,
          // Provisional; the final state is written below once decided.
          result_state: w.state ?? 'PENDING',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const scanId = scan.id;

      // Steps 6–7 judge the code itself, whoever scans it: a staff scan records these findings too
      // (Client Services checking a suspicious piece is how a forged but validly signed code reaches
      // ORBES), marked staffScan. Only the unsold rule and the history rules leave staff scans out.
      if (w.serviceFinding) await this.anomaly.recordFinding(this.serviceFinding(w, now, staff), trx);

      if (w.trusted && w.reg?.code) {
        const reg = w.reg;
        const code = reg.code!;
        w.isOwner = m.accountId !== null && reg.ownerAccountId !== null && m.accountId === reg.ownerAccountId;
        // A pre-sale service (ISSUED → SERVICED): the piece was never sold.
        const preSaleService = await isPreSaleService(trx, { id: reg.productUuid, status: reg.status });

        // S-07: the code of a piece ORBES has not sold yet, scanned outside the maison (no console session).
        // Every such scan says so in its reasons; the finding itself is recorded once per piece and per UTC day.
        if (!staff && (reg.status === 'ISSUED' || preSaleService)) {
          w.reasons.push('ANOMALY:UNSOLD_PIECE_SCAN');
          await this.anomaly.recordFinding(this.unsoldPieceFinding(w, now, scanId, m.country, preSaleService), trx, { oncePerUtcDay: true });
        }

        // Step 9: score this code's recent history, this scan included (a staff scan: the history alone).
        const evaluation = await this.anomaly.evaluate(
          { productId: reg.productUuid, codeId: code.id, scanEventId: scanId, accountIsOwner: w.isOwner },
          { trx, productStatus: reg.status, codeStatus: code.status, ownerAccountId: reg.ownerAccountId, observeOnly: staff },
        );
        w.riskScore = evaluation.riskScore;
        for (const f of evaluation.findings) w.reasons.push(`ANOMALY:${f.type}`);
        /** SUSPICIOUS only because of the scan history (no status, genome or code finding). */
        let riskOnly = false;
        if (w.state === undefined && w.riskScore >= this.threshold) {
          if (w.isOwner) {
            w.state = 'AUTHENTIC_OWNERSHIP_VERIFIED';
            w.notice = 'UNUSUAL_ACTIVITY';
            w.reasons.push('RISK_THRESHOLD_OWNER');
          } else {
            w.state = 'SUSPICIOUS_ACTIVITY';
            w.reasons.push('RISK_THRESHOLD');
            riskOnly = true;
          }
        }

        // Step 10: ownership.
        let registration: VerifyOutcome['registration'];
        const issueToken = async (claimCodeRequired: boolean) => {
          const token = await createScanToken(trx, { productId: reg.productUuid, scanEventId: scanId, now, ttlMs: this.registrationTtlMs });
          return { token: token.token, expiresAt: token.expiresAt.toISOString(), claimCodeRequired };
        };
        // A pre-sale service (ISSUED → SERVICED) was never sold: not open for first registration.
        const registrable = REGISTRABLE.includes(reg.status) && !preSaleService;
        if (w.state === undefined) {
          if (w.isOwner) w.state = 'AUTHENTIC_OWNERSHIP_VERIFIED';
          else if (reg.ownerAccountId !== null) w.state = 'AUTHENTIC_REGISTERED';
          else if (registrable) {
            w.state = 'AUTHENTIC_FIRST_REGISTRATION';
            // A staff scan is the console user's test, never a buyer's scan: no registration token.
            if (!staff) registration = await issueToken(reg.hasClaimSecret);
          } else w.state = 'AUTHENTIC';
        } else if (riskOnly && reg.ownerAccountId === null && reg.hasClaimSecret && registrable && !staff) {
          // Anomaly poisoning (strangers scanning copies) must not lock out the buyer who holds the
          // certificate claim code: the token is offered, and only the claim code can use it.
          registration = await issueToken(true);
          w.reasons.push('REGISTRATION_WITH_CLAIM_CODE');
        }

        // Step 11: authenticator policy (never changes the state).
        w.policy = await this.authenticators.evaluate(reg.authPolicy, undefined, {
          product: { id: reg.productUuid, productId: reg.productId, authPolicy: reg.authPolicy },
          code: { id: code.id, status: code.status },
          checks: { signatureValid: true, registered: true },
        });

        return this.finish(trx, w, scanId, now, started, registration);
      }

      return this.finish(trx, w, scanId, now, started, undefined);
    });
    return result;
  }

  /**
   * A staff scan: the sale mode's lookup (A-08). The code is judged by steps 1–8 exactly as by
   * verify() (structure, key, signature, revoked-key trust, genome version, registry, genome
   * cross-check, code and product status), then ONE scan event is written with the type
   * ADMIN_TEST and the console user's id, with its authentication event. Nothing else of verify()
   * runs: no anomaly is evaluated or recorded (ADMIN_TEST scans are outside every history rule),
   * no registration token is issued, no public wording is built. `then` runs in the same
   * transaction, so whatever the caller records about this scan (the sale token) commits with it.
   */
  async staffScan<T>(input: VerifyInput, opts: { adminId: string; meta?: ScanMeta }, then: (trx: Db, scan: StaffScan) => Promise<T>): Promise<T> {
    if (typeof opts?.adminId !== 'string' || !UUID_RE.test(opts.adminId)) throw new TypeError('staffScan: adminId must be an admin_users.id uuid');
    const started = performance.now();
    const now = this.clock();
    const genomeReading = cleanGenome(input?.genome);
    const clientMetrics = cleanClientMetrics(input?.client);
    const m = cleanMeta(opts.meta);

    const w: Work = { reasons: [], signatureValid: false, trusted: false, genomeCheck: 'NOT_PROVIDED', riskScore: 0, isOwner: false };
    await this.decide(w, input?.code, genomeReading);
    // No history, ownership or anomaly step: what steps 1–8 did not refuse is the registry's own piece.
    const state: VerificationState = w.state ?? 'AUTHENTIC';

    return inTransaction(this.db, async (trx) => {
      const scan = await trx
        .insertInto('scan_events')
        .values({
          occurred_at: now,
          code_id: w.trusted && w.reg?.code ? w.reg.code.id : null,
          product_id: w.reg?.productUuid ?? null,
          packed_identity: w.payload ? packedOf(w.payload) : null,
          event_type: 'ADMIN_TEST',
          admin_id: opts.adminId.toLowerCase(),
          ip_hash: m.ipHash,
          country: m.country,
          region: m.region,
          lat: m.lat,
          lon: m.lon,
          user_agent_family: m.userAgentFamily,
          client_metrics: clientMetrics ? jsonText(clientMetrics) : null,
          result_state: state,
          // The decision's time: nothing after it changes the state.
          latency_ms: Math.max(0, Math.round(performance.now() - started)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.recordAuthentication(trx, w, scan.id, state, now);
      const reg = w.reg;
      const piece: StaffScanPiece | null =
        w.trusted && reg
          ? {
              productUuid: reg.productUuid,
              productId: reg.productId,
              status: reg.status,
              category: { code: reg.categoryCode, name: reg.categoryName },
              collection: reg.collection,
              model: reg.modelName,
              type: reg.modelType,
              variant: reg.variant,
              material: reg.material,
              createdYear: reg.year,
              warranty: {
                status: computeWarrantyStatus(reg.warranty, utcDate(now)),
                startDate: reg.warranty?.start_date ?? null,
                endDate: reg.warranty?.end_date ?? null,
                voided: reg.warranty?.voided_at !== null && reg.warranty?.voided_at !== undefined,
              },
              registered: reg.ownerAccountId !== null,
            }
          : null;
      return then(trx, { scanId: scan.id, occurredAt: now, state, reasons: [...w.reasons], piece });
    });
  }

  // ── Steps 1–8 (read-only) ──────────────────────────────────────────────

  private async decide(w: Work, code: unknown, genomeReading: CleanGenome | undefined): Promise<void> {
    // Step 1: strict structural parse: base64url, then the code version's profile (high nibble of byte 0,
    // CODE_PROFILES): unframe (length + CRC) and strict payload decoding (reserved values such as genome
    // version / key id / issue 0). An intact frame of a code version this server has no profile for is not
    // damage: the server is outdated, as for an unsupported genome version (step 5). Nothing in it can be
    // checked (no key, signature or registry rules), so it is UNKNOWN, with a server warning.
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_CHARS) {
      return end(w, 'MALFORMED_CODE', 'MALFORMED:INPUT');
    }
    let unframed: ReturnType<typeof unframeAnyCodeData<CodePayloadV1>>;
    try {
      unframed = unframeAnyCodeData(fromBase64Url(code), CODE_PROFILES);
    } catch (e) {
      if (e instanceof PayloadError && e.code === 'UNSUPPORTED_VERSION') {
        w.unsupportedCodeVersion = e.codeVersion;
        return end(w, 'UNKNOWN', 'UNSUPPORTED_CODE_VERSION');
      }
      return end(w, 'MALFORMED_CODE', e instanceof PayloadError ? `MALFORMED:${e.code}` : 'MALFORMED:ENCODING');
    }
    const { payload, payloadBytes, signature, profile } = unframed;
    w.payload = payload;
    w.payloadBytes = payloadBytes;

    // Step 2: the key named by the code.
    const key = await this.keys.publicKey(payload.keyId);
    if (!key) return end(w, 'INVALID_SIGNATURE', 'UNKNOWN_KEY');
    w.key = key;

    // Step 3: strict Ed25519 (rejects small-order / non-canonical keys before OpenSSL). Every signed
    // field, the genome version included, is authenticated here: an edited version fails as a forgery.
    if (!verifyEd25519Node(key.publicKey, profile.signingMessage(payloadBytes), signature)) {
      return end(w, 'INVALID_SIGNATURE', 'BAD_SIGNATURE');
    }
    w.signatureValid = true;

    // Step 4: revoked-key trust. A revoked key only vouches for codes whose registry record (product,
    // issue) was created before its cut-off; anything else it signed, registered or not, is refused.
    const reg = await this.lookup(packedOf(payload), payload.issue);
    const keyTrusted = reg?.code ? isKeyTrustedAt(key, reg.code.createdAt) : key.status !== 'REVOKED';
    if (!keyTrusted) {
      w.reg = reg;
      return end(w, 'INVALID_SIGNATURE', 'KEY_REVOKED');
    }

    // Step 5: genome version support. Validly signed by a trusted ORBES key but newer than this
    // server understands: the server is outdated, not the code. UNKNOWN, with a server warning.
    if (!SUPPORTED_GENOME_VERSIONS.includes(payload.genomeVersion)) {
      w.reg = reg;
      w.unsupportedGenomeVersion = payload.genomeVersion;
      return end(w, 'UNKNOWN', 'UNSUPPORTED_GENOME_VERSION');
    }

    // Step 6: registry.
    if (!reg) {
      w.serviceFinding = {
        type: 'VALID_SIGNATURE_UNREGISTERED',
        details: { packedIdentity: packedOf(payload), keyId: payload.keyId, issue: payload.issue, reason: 'PRODUCT_NOT_REGISTERED' },
      };
      return end(w, 'UNKNOWN', 'PRODUCT_NOT_REGISTERED');
    }
    w.reg = reg;
    if (!reg.code) {
      w.serviceFinding = {
        type: 'VALID_SIGNATURE_UNREGISTERED',
        details: { packedIdentity: packedOf(payload), keyId: payload.keyId, issue: payload.issue, reason: 'CODE_NOT_REGISTERED' },
      };
      return end(w, 'UNKNOWN', 'CODE_NOT_REGISTERED');
    }
    if (!equalBytes(sha256(payloadBytes), reg.code.payloadHash)) {
      w.serviceFinding = { type: 'CODE_MISMATCH', details: { keyId: payload.keyId, issue: payload.issue } };
      return end(w, 'SUSPICIOUS_ACTIVITY', 'CODE_MISMATCH');
    }
    w.trusted = true;

    // Step 7: genome cross-check against the signed identity.
    w.genome = computeGenome(packedOf(payload), payload.genomeVersion);
    const g = genomeCheck(w.genome.glyphs, genomeReading);
    w.genomeCheck = g.check;
    if (g.check === 'MISMATCH') {
      w.serviceFinding = { type: 'GENOME_MISMATCH', details: { provided: g.provided, mismatches: g.mismatches } };
      return end(w, 'SUSPICIOUS_ACTIVITY', 'GENOME_MISMATCH');
    }

    // Step 8: code and product status.
    if (REVOKED_CODE.includes(reg.code.status)) return end(w, 'REVOKED', `CODE_${reg.code.status}`);
    if (REVOKING_PRODUCT.includes(reg.status)) return end(w, 'REVOKED', `PRODUCT_${reg.status}`);
    if (INCIDENT_PRODUCT.includes(reg.status)) return end(w, 'SUSPICIOUS_ACTIVITY', `PRODUCT_${reg.status}`);
  }

  /** Product (by packed identity) with the code of this issue and everything the outcome needs, in one query. */
  private async lookup(packed: number, issue: number): Promise<Registered | undefined> {
    const r = await this.db
      .selectFrom('products as p')
      .innerJoin('categories as cat', 'cat.id', 'p.category_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      // Same rule as product_overview and the owner's product list: the product's own collection, else its model's.
      .leftJoin('collections as col', (j) => j.on((eb) => eb('col.id', '=', eb.fn.coalesce('p.collection_id', 'm.collection_id'))))
      .leftJoin('codes as c', (j) => j.onRef('c.product_id', '=', 'p.id').on('c.issue', '=', issue))
      .leftJoin('warranties as w', 'w.product_id', 'p.id')
      .leftJoin('ownership as o', (j) => j.onRef('o.product_id', '=', 'p.id').on('o.ended_at', 'is', null))
      .leftJoin('ownership_transfers as t', (j) => j.onRef('t.product_id', '=', 'p.id').on('t.status', '=', 'PENDING'))
      .select([
        'p.id as productUuid',
        'p.product_id as productId',
        'p.year',
        'p.status',
        'p.variant',
        'p.material',
        'p.production_date as productionDate',
        'p.auth_policy as authPolicy',
        'p.claim_secret_hash as claimSecretHash',
        'cat.code as categoryCode',
        'cat.name as categoryName',
        'm.name as modelName',
        'm.type as modelType',
        'm.care_instructions as care',
        'col.name as collection',
        'c.id as codeId',
        'c.status as codeStatus',
        'c.created_at as codeCreatedAt',
        'c.payload_hash as payloadHash',
        'w.start_date as wStart',
        'w.end_date as wEnd',
        'w.voided_at as wVoided',
        'w.duration_months as wMonths',
        'o.account_id as ownerAccountId',
        't.expires_at as transferExpiresAt',
      ])
      .where('p.packed_identity', '=', packed)
      .executeTakeFirst();
    if (!r) return undefined;
    const now = this.clock();
    return {
      productUuid: r.productUuid,
      productId: r.productId,
      year: r.year,
      status: r.status,
      variant: r.variant,
      material: r.material,
      productionDate: r.productionDate,
      authPolicy: r.authPolicy,
      hasClaimSecret: r.claimSecretHash !== null,
      categoryCode: r.categoryCode,
      categoryName: r.categoryName,
      modelName: r.modelName,
      modelType: r.modelType,
      care: r.care,
      collection: r.collection,
      code:
        r.codeId !== null && r.codeStatus !== null && r.codeCreatedAt !== null && r.payloadHash !== null
          ? { id: r.codeId, status: r.codeStatus, createdAt: r.codeCreatedAt, payloadHash: r.payloadHash }
          : null,
      warranty:
        r.wMonths !== null
          ? { start_date: r.wStart, end_date: r.wEnd, voided_at: r.wVoided, duration_months: r.wMonths }
          : null,
      ownerAccountId: r.ownerAccountId,
      transferPending: r.transferExpiresAt !== null && r.transferExpiresAt.getTime() > now.getTime(),
    };
  }

  // ── Step 12 ──────────────────────────────────────────────────────────────

  /** The internal record of a decision (reasons, risk, authenticator results), next to its scan event. */
  private async recordAuthentication(trx: Db, w: Work, scanId: string, state: VerificationState, now: Date): Promise<void> {
    const serviceRisk = w.serviceFinding ? ANOMALY_WEIGHTS[w.serviceFinding.type].weight : 0;
    await trx
      .insertInto('authentication_events')
      .values({
        scan_event_id: scanId,
        code_id: w.trusted && w.reg?.code ? w.reg.code.id : null,
        product_id: w.reg?.productUuid ?? null,
        key_id: w.payload?.keyId ?? null,
        signature_valid: w.signatureValid,
        genome_check: w.genomeCheck,
        state,
        reasons: w.reasons,
        risk_score: Math.max(w.riskScore, serviceRisk),
        authenticators: jsonText(
          w.policy
            ? { policy: w.policy.policy, assurance: w.policy.assurance, results: w.policy.results as unknown as JsonValue[] }
            : { policy: null, results: [] },
        ),
        created_at: now,
      })
      .execute();
  }

  private async finish(
    trx: Db,
    w: Work,
    scanId: string,
    now: Date,
    started: number,
    registration: VerifyOutcome['registration'],
  ): Promise<VerifyOutcome> {
    const state: VerificationState = w.state ?? 'AUTHENTIC';
    await this.recordAuthentication(trx, w, scanId, state, now);
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    await trx.updateTable('scan_events').set({ result_state: state, latency_ms: latencyMs }).where('id', '=', scanId).execute();
    if (state === 'SUSPICIOUS_ACTIVITY' || w.notice) {
      this.log.warn({ scanId, state, reasons: w.reasons }, 'verification flagged');
    }
    if (w.unsupportedCodeVersion !== undefined) {
      this.log.warn(
        { scanId, codeVersion: w.unsupportedCodeVersion },
        'well-formed code of an unsupported code version: this server is outdated (or the version nibble was edited)',
      );
    }
    if (w.unsupportedGenomeVersion !== undefined) {
      this.log.warn(
        { scanId, genomeVersion: w.unsupportedGenomeVersion, keyId: w.payload?.keyId },
        'validly signed code with an unsupported genome version: this server is outdated',
      );
    }
    return this.outcome(state, w, scanId, now, registration);
  }

  /** The public body, from an allow-list of fields per state. */
  private outcome(
    state: VerificationState,
    w: Work,
    scanId: string,
    now: Date,
    registration: VerifyOutcome['registration'],
  ): VerifyOutcome {
    const copy = copyFor(state, w.notice);
    const out: VerifyOutcome = { state, scanId, verifiedAt: now.toISOString(), title: copy.title, message: copy.message };
    if (w.notice && state === 'AUTHENTIC_OWNERSHIP_VERIFIED') out.notice = w.notice;

    const reg = w.reg;
    const p = w.payload;
    if (w.trusted && reg && p && GENOME_STATES.includes(state)) {
      const policy = w.policy;
      out.verification = {
        signature: 'VALID',
        keyId: p.keyId,
        codeVersion: `CODE-${pad2(p.codeVersion)}`,
        genomeVersion: `GENOME-${pad2(p.genomeVersion)}`,
        issuedAt: utcDate(dateFromIssuedDay(p.issuedDay)),
        issue: p.issue,
        assurance: policy?.assurance ?? 'CODE',
        ...(policy?.hardwareProofRequired ? { hardwareProofRequired: true } : {}),
      };
    }

    if (reg && p && GENOME_STATES.includes(state) && w.signatureValid) {
      const g = w.genome ?? computeGenome(packedOf(p), p.genomeVersion);
      out.genome = {
        id: reg.productId,
        version: `GENOME-${pad2(g.version)}`,
        fingerprint: g.fingerprint,
        glyphs: [...g.glyphs],
        ids: [...g.ids],
      };
    }

    if (reg && AUTHENTIC_STATES.includes(state)) {
      out.product = {
        productId: reg.productId,
        category: { code: reg.categoryCode, name: reg.categoryName },
        ...(reg.collection ? { collection: reg.collection } : {}),
        model: reg.modelName,
        type: reg.modelType,
        ...(reg.variant ? { variant: reg.variant } : {}),
        material: reg.material,
        createdYear: reg.year,
        ...(reg.productionDate ? { productionDate: reg.productionDate } : {}),
        ...(reg.care ? { care: reg.care } : {}),
      };
      const today = utcDate(now);
      const wr = reg.warranty;
      out.warranty = {
        status: computeWarrantyStatus(wr, today),
        ...(wr?.start_date ? { startDate: wr.start_date } : {}),
        ...(wr?.end_date ? { endDate: wr.end_date } : {}),
      };
      out.ownership = {
        registered: reg.ownerAccountId !== null,
        you: w.isOwner,
        ...(reg.ownerAccountId !== null && reg.transferPending ? { transferPending: true } : {}),
      };
      if (state === 'AUTHENTIC_FIRST_REGISTRATION' && registration) out.registration = registration;
    }
    // SUSPICIOUS from the risk score alone on an unregistered product with a claim secret (step 10).
    if (state === 'SUSPICIOUS_ACTIVITY' && registration?.claimCodeRequired === true) out.registration = registration;
    return out;
  }

  /** A finding of steps 6–7; `staffScan` (S-07): the scan carried a console session, and its details say so. */
  private serviceFinding(w: Work, now: Date, staffScan: boolean): AnomalyFinding {
    const f = w.serviceFinding!;
    const { severity, weight } = ANOMALY_WEIGHTS[f.type];
    return {
      type: f.type,
      severity,
      weight,
      riskScore: weight,
      productId: w.reg?.productUuid ?? null,
      // CODE_MISMATCH: the scanned code is not the registered one, but the registered code is the one at risk.
      codeId: w.reg?.code?.id ?? null,
      at: now,
      details: staffScan ? { ...f.details, staffScan: true } : f.details,
    };
  }

  /** S-07: the public scan of a piece not sold yet, with the scan's country (null when unknown). */
  private unsoldPieceFinding(w: Work, now: Date, scanEventId: string, country: string | null, preSaleService: boolean): AnomalyFinding {
    const reg = w.reg!;
    const { severity, weight } = ANOMALY_WEIGHTS.UNSOLD_PIECE_SCAN;
    return {
      type: 'UNSOLD_PIECE_SCAN',
      severity,
      weight,
      riskScore: weight,
      productId: reg.productUuid,
      codeId: reg.code?.id ?? null,
      at: now,
      details: { country, productStatus: reg.status, ...(preSaleService ? { preSaleService: true } : {}), scanEventId },
    };
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function end(w: Work, state: VerificationState, reason: string): void {
  w.state = state;
  w.reasons.push(reason);
}

function packedOf(p: CodePayloadV1): number {
  return packIdentity(p.identity);
}

function sha256(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(b).digest());
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Step 7. A glyph is "provided" when it is not null and its confidence (1
 * when the client sent none) is at least GENOME_MIN_CONFIDENCE. Fewer than
 * GENOME_MIN_GLYPHS provided glyphs is INCONCLUSIVE: a partial reading must
 * never flag a product. One stray glyph is tolerated as a misread.
 */
export function genomeCheck(
  expected: readonly number[],
  reading: CleanGenome | undefined,
): { check: GenomeCheck; provided: number; mismatches: number } {
  if (!reading) return { check: 'NOT_PROVIDED', provided: 0, mismatches: 0 };
  let provided = 0;
  let mismatches = 0;
  for (let i = 0; i < GENOME_LENGTH; i++) {
    const glyph = reading.glyphs[i];
    if (glyph === null || glyph === undefined) continue;
    const conf = reading.confidence ? reading.confidence[i] : 1;
    if (!(conf >= GENOME_MIN_CONFIDENCE)) continue;
    provided++;
    if (glyph !== expected[i]) mismatches++;
  }
  if (provided === 0) return { check: 'NOT_PROVIDED', provided, mismatches };
  if (provided < GENOME_MIN_GLYPHS) return { check: 'INCONCLUSIVE', provided, mismatches };
  return { check: mismatches >= GENOME_MISMATCH_GLYPHS ? 'MISMATCH' : 'MATCH', provided, mismatches };
}

/** Strict structure (routes validate with zod too): 8 entries of null or 0..15, optional 8 confidences in [0, 1]. */
function cleanGenome(g: unknown): CleanGenome | undefined {
  if (g === undefined || g === null) return undefined;
  const bad = () => validationError('The genome reading is invalid.');
  if (typeof g !== 'object' || Array.isArray(g)) throw bad();
  const { glyphs, confidence } = g as { glyphs?: unknown; confidence?: unknown };
  if (!Array.isArray(glyphs) || glyphs.length !== GENOME_LENGTH) throw bad();
  const out: (number | null)[] = glyphs.map((v) => {
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 15) throw bad();
    return v;
  });
  if (confidence === undefined || confidence === null) return { glyphs: out };
  if (!Array.isArray(confidence) || confidence.length !== GENOME_LENGTH) throw bad();
  const conf = confidence.map((c) => {
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) throw bad();
    return c;
  });
  return { glyphs: out, confidence: conf };
}

/** Client decode metrics are informational: invalid values are dropped, never trusted for decisions. */
function cleanClientMetrics(c: unknown): JsonObject | undefined {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return undefined;
  const src = c as Record<string, unknown>;
  const out: JsonObject = {};
  const num = (k: string, max: number, int: boolean) => {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && (!int || Number.isInteger(v))) out[k] = v;
  };
  num('rsErrors', 255, true);
  num('rsErasures', 255, true);
  num('moduleSizePx', 10_000, false);
  num('decodeMs', 600_000, false);
  if (src.source === 'camera' || src.source === 'upload') out.source = src.source;
  return Object.keys(out).length ? out : undefined;
}

interface CleanMeta {
  deviceHash: string | null;
  sessionHash: string | null;
  accountId: string | null;
  ipHash: string | null;
  country: string | null;
  region: string | null;
  lat: number | null;
  lon: number | null;
  userAgentFamily: string | null;
  adminId: string | null;
}

function cleanMeta(meta: ScanMeta | undefined): CleanMeta {
  const text = (v: unknown, max = MAX_META_TEXT): string | null =>
    // eslint-disable-next-line no-control-regex
    typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : null;
  const geo = meta?.geo;
  const lat = geo?.lat;
  const lon = geo?.lon;
  const hasPoint =
    typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return {
    deviceHash: text(meta?.deviceHash),
    sessionHash: text(meta?.sessionHash),
    accountId: typeof meta?.accountId === 'string' && UUID_RE.test(meta.accountId) ? meta.accountId.toLowerCase() : null,
    ipHash: text(meta?.ipHash),
    country: normalizeCountry(typeof geo?.country === 'string' ? geo.country : undefined) ?? null,
    region: text(geo?.region, 64),
    lat: hasPoint ? roundCoord(lat) : null,
    lon: hasPoint ? roundCoord(lon) : null,
    userAgentFamily: text(meta?.userAgentFamily, 64),
    adminId: typeof meta?.adminId === 'string' && UUID_RE.test(meta.adminId) ? meta.adminId.toLowerCase() : null,
  };
}
