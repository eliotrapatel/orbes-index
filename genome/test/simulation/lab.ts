/**
 * Counterfeit simulation lab (master spec §27): one isolated ORBES world per
 * scenario, driven end to end through the REAL stack.
 *
 *   createContext (database, MemoryKeyProvider, every service) + buildApp
 *   → admin API (issue, activate, render PNG artifacts, revoke, re-issue, keys)
 *   → artifact PNG decoded to luma
 *   → phone capture (test/support/camera-sim.ts, seeded, per-device preset)
 *   → the scanner's own decode step (src/web/verify/frame-decoder.ts → core decoder)
 *   → the scanner's own request builder (src/web/verify/capture.ts buildVerifyInput)
 *   → POST /api/v1/verify (app.inject) with per-device cookies, IPs and geo headers
 *
 * Forgeries are produced the way a counterfeiter would: by editing the bytes a
 * scan reads (the CRC-16 is public, so it is recomputed) and/or by printing a
 * new artifact with the server's own render module.
 *
 * Every check a scenario makes is recorded as { expected, observed, status }:
 *   PASS   the expectation of spec §27 holds;
 *   GAP    §27's expectation does not hold, but the observed state is the one
 *          the normative platform contract prescribes (a documented gap);
 *   LIMIT  the system behaves as designed, yet the counterfeit is not caught
 *          (a documented detection limit, e.g. a single quiet copy);
 *   FAIL   anything else.
 * Every public response is also checked for redaction (no risk score, reason,
 * threshold, raw status or internal id may leave the server).
 *
 * Shared by test/simulation/*.test.ts and scripts/counterfeit-simulation.ts.
 */
import { performance } from 'node:perf_hooks';
import type { LightMyRequestResponse } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { PNG } from 'pngjs';
import { toBase64Url } from '../../src/core/bytes.js';
import { CODE01_SIZE } from '../../src/core/code/profile.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig, type AnomalyConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import type { Db } from '../../src/server/db/connection.js';
import { PRODUCT_STATUSES, type VerificationState } from '../../src/server/db/schema.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { renderArtifact, type ArtifactTheme } from '../../src/server/render/index.js';
import { RULE_TYPES, SERVICE_FINDING_TYPES } from '../../src/server/services/anomaly-rules.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { buildVerifyInput } from '../../src/web/verify/capture.js';
import { handleDecode } from '../../src/web/verify/frame-decoder.js';
import type { DecodedCode } from '../../src/web/verify/protocol.js';
import type { VerifyInput } from '../../src/web/verify/types.js';
import { Client, createAdmin, ORIGIN, PASSWORD, safeJson, seedCatalog, type Catalog } from '../api/support.js';
import { PRESETS, simulateCapture, type CaptureParams, type PresetName } from '../support/camera-sim.js';
import { createTestDb } from '../support/db.js';
import { hashSeed, Prng } from '../support/prng.js';
import { grayToRgba, rgbaToGray, type GrayImage } from '../support/raster.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Every world starts at this instant (UTC); scenarios only move the clock forward. */
export const WORLD_START = '2026-06-01T08:00:00.000Z';

/** Geo headers set by the (simulated) trusted edge proxy: GEO_MODE=headers. */
export const GEO_HEADERS = { country: 'x-orbes-geo-country', lat: 'x-orbes-geo-lat', lon: 'x-orbes-geo-lon' } as const;

/** Printed artifact: 30 mm at 600 dpi (≈ 14 px per code unit), the admin generator's default. */
export const ARTIFACT_WIDTH_MM = 30;
export const ARTIFACT_DPI = 600;

/** A scanner reads a stream of frames: each scan gets a short burst, the hand drifting between frames. */
export const BURST_FRAMES = 3;
const BURST_DRIFT_DEG = 1.5;

export const AUTHENTIC_STATES: readonly VerificationState[] = [
  'AUTHENTIC',
  'AUTHENTIC_FIRST_REGISTRATION',
  'AUTHENTIC_REGISTERED',
  'AUTHENTIC_OWNERSHIP_VERIFIED',
];

export const MINUTE = 60_000;

// ── Places ─────────────────────────────────────────────────────────────────

export interface Place {
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export const PLACES = {
  paris: { city: 'Paris', country: 'FR', lat: 48.86, lon: 2.35 },
  lyon: { city: 'Lyon', country: 'FR', lat: 45.76, lon: 4.84 },
  milan: { city: 'Milan', country: 'IT', lat: 45.46, lon: 9.19 },
  berlin: { city: 'Berlin', country: 'DE', lat: 52.52, lon: 13.4 },
  london: { city: 'London', country: 'GB', lat: 51.51, lon: -0.13 },
  newYork: { city: 'New York', country: 'US', lat: 40.71, lon: -74.01 },
  tokyo: { city: 'Tokyo', country: 'JP', lat: 35.68, lon: 139.69 },
  dubai: { city: 'Dubai', country: 'AE', lat: 25.2, lon: 55.27 },
  saoPaulo: { city: 'São Paulo', country: 'BR', lat: -23.55, lon: -46.63 },
  shanghai: { city: 'Shanghai', country: 'CN', lat: 31.23, lon: 121.47 },
} as const satisfies Record<string, Place>;

// ── Checks ─────────────────────────────────────────────────────────────────

export type CheckStatus = 'PASS' | 'GAP' | 'LIMIT' | 'FAIL';

export interface Check {
  id: string;
  title: string;
  expected: string;
  observed: string;
  status: CheckStatus;
  note?: string;
}

/** An expected public state: one state, a set of states, any authentic state, or any non-authentic state. */
export type Expect = VerificationState | readonly VerificationState[] | 'AUTHENTIC*' | 'NOT_AUTHENTIC';

export function matches(expect: Expect, state: string | undefined): boolean {
  if (state === undefined) return false;
  if (expect === 'AUTHENTIC*') return (AUTHENTIC_STATES as readonly string[]).includes(state);
  if (expect === 'NOT_AUTHENTIC') return !(AUTHENTIC_STATES as readonly string[]).includes(state);
  if (typeof expect === 'string') return state === expect;
  return (expect as readonly string[]).includes(state);
}

export function describeExpect(expect: Expect): string {
  if (expect === 'NOT_AUTHENTIC') return 'never AUTHENTIC*';
  if (typeof expect === 'string') return expect;
  return expect.join(' or ');
}

/** "SUSPICIOUS_ACTIVITY ×23, AUTHENTIC_REGISTERED ×1" (most frequent first). */
export function tally(states: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([s, n]) => `${s} ×${n}`)
    .join(', ');
}

// ── Redaction ──────────────────────────────────────────────────────────────

const BASE_KEYS = ['state', 'scanId', 'verifiedAt', 'title', 'message'];
const VERIFICATION_KEYS = ['verification', ...['signature', 'keyId', 'codeVersion', 'genomeVersion', 'issuedAt', 'issue', 'assurance', 'hardwareProofRequired'].map((k) => `verification.${k}`)];
const GENOME_KEYS = ['genome', ...['id', 'version', 'fingerprint', 'glyphs', 'ids'].map((k) => `genome.${k}`)];
const PRODUCT_KEYS = [
  'product',
  ...['productId', 'category', 'category.code', 'category.name', 'collection', 'model', 'type', 'variant', 'material', 'createdYear', 'productionDate', 'care'].map(
    (k) => `product.${k}`,
  ),
];
const WARRANTY_KEYS = ['warranty', 'warranty.status', 'warranty.startDate', 'warranty.endDate'];
const OWNERSHIP_KEYS = ['ownership', 'ownership.registered', 'ownership.you', 'ownership.transferPending'];
const REGISTRATION_KEYS = ['registration', 'registration.token', 'registration.expiresAt', 'registration.claimCodeRequired'];

/** Key paths a public outcome may carry, per state (PLATFORM-CONTRACTS §2.4, VerifyOutcome). */
function allowedKeys(state: string): Set<string> {
  const authentic = [...BASE_KEYS, ...VERIFICATION_KEYS, ...GENOME_KEYS, ...PRODUCT_KEYS, ...WARRANTY_KEYS, ...OWNERSHIP_KEYS];
  switch (state) {
    case 'AUTHENTIC':
    case 'AUTHENTIC_REGISTERED':
      return new Set(authentic);
    case 'AUTHENTIC_FIRST_REGISTRATION':
      return new Set([...authentic, ...REGISTRATION_KEYS]);
    case 'AUTHENTIC_OWNERSHIP_VERIFIED':
      return new Set([...authentic, 'notice']);
    case 'SUSPICIOUS_ACTIVITY':
      // A registration token (claim code required) when only the scan history made it suspicious (§2.4 step 10).
      return new Set([...BASE_KEYS, ...VERIFICATION_KEYS, ...GENOME_KEYS, ...REGISTRATION_KEYS]);
    case 'REVOKED':
      return new Set([...BASE_KEYS, ...VERIFICATION_KEYS, ...GENOME_KEYS]);
    default:
      return new Set(BASE_KEYS);
  }
}

/** Groups an AUTHENTIC* outcome must carry. */
const REQUIRED_AUTHENTIC = ['verification', 'genome', 'product', 'warranty', 'ownership'];

function keyPaths(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) return v.length > 0 && v[0] !== null && typeof v[0] === 'object' ? keyPaths(v[0], prefix) : [];
  if (v === null || typeof v !== 'object') return [];
  const out: string[] = [];
  for (const [k, child] of Object.entries(v)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p, ...keyPaths(child, p));
  }
  return out;
}

/** Internal vocabulary that must never appear in a public body. */
const FORBIDDEN_WORDS = [
  'risk',
  'Risk',
  'score',
  'threshold',
  'ANOMALY',
  'RISK_THRESHOLD',
  'BAD_SIGNATURE',
  'UNKNOWN_KEY',
  'KEY_REVOKED',
  'PRODUCT_NOT_REGISTERED',
  'CODE_NOT_REGISTERED',
  'UNSUPPORTED_',
  'MALFORMED:',
  'SUPERSEDED',
  ...RULE_TYPES,
  ...SERVICE_FINDING_TYPES,
];
// REVOKED doubles as a public state name.
const RAW_STATUSES = PRODUCT_STATUSES.filter((s) => s !== 'REVOKED');

/**
 * Redaction of one public verify response: only the contract's fields for
 * its state, no internal vocabulary, no raw product status, none of the
 * given secrets (row ids, payload hashes, claim codes, account ids).
 * Returns the violations (empty = clean).
 */
export function redactionViolations(body: unknown, secrets: Iterable<string> = []): string[] {
  const out: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body is not a JSON object'];
  const state = (body as { state?: unknown }).state;
  if (typeof state !== 'string') return ['no state'];
  const allowed = allowedKeys(state);
  for (const k of keyPaths(body)) if (!allowed.has(k)) out.push(`field ${k} not allowed in ${state}`);
  if ((AUTHENTIC_STATES as readonly string[]).includes(state)) {
    for (const k of REQUIRED_AUTHENTIC) if (!(k in body)) out.push(`${state} without ${k}`);
  }
  const registration = (body as { registration?: { claimCodeRequired?: unknown } }).registration;
  if (state === 'SUSPICIOUS_ACTIVITY' && registration !== undefined && registration?.claimCodeRequired !== true) {
    out.push('SUSPICIOUS_ACTIVITY registration without a required claim code');
  }
  const text = JSON.stringify(body);
  for (const w of FORBIDDEN_WORDS) if (text.includes(w)) out.push(`internal term "${w}"`);
  for (const s of RAW_STATUSES) if (text.includes(`"${s}"`)) out.push(`raw status "${s}"`);
  for (const s of secrets) if (s && text.includes(s)) out.push(`secret ${s.slice(0, 12)}…`);
  return out;
}

// ── World ──────────────────────────────────────────────────────────────────

/** A database for one world: in-memory PGlite by default, a throwaway PostgreSQL database in the opt-in suite. */
export type DbFactory = () => Promise<{ db: Db; close(): Promise<void> }>;

export const pgliteFactory: DbFactory = async () => {
  const t = await createTestDb();
  return { db: t.db, close: () => t.close() };
};

export interface LabOptions {
  /** Scenario label (seeds every capture). */
  scenario: string;
  /** Name of this world in reports (default 'default thresholds'). */
  label?: string;
  dbFactory?: DbFactory;
  /** Anomaly thresholds (default: the production defaults, DEFAULT_ANOMALY_CONFIG). */
  anomaly?: Partial<AnomalyConfig>;
  start?: string;
}

export interface IssuedProduct {
  productId: string;
  uuid: string;
  packedIdentity: number;
  genome: { glyphs: number[]; fingerprint: string };
  code: { id: string; data: string; issue: number; keyId: number; payloadHash: string };
  claimCode?: string;
}

export interface Artifact {
  label: string;
  /** genuine: the admin-rendered print; altered: a genuine print physically damaged; forged: printed by a forger. */
  kind: 'genuine' | 'altered' | 'forged';
  png: Uint8Array;
  gray: GrayImage;
}

export interface Device {
  name: string;
  client: Client;
  place?: Place;
  /** What the edge proxy reports: city coordinates + country, country only, or nothing. */
  geo: 'coords' | 'country' | 'none';
  preset: PresetName;
}

export interface Photo {
  ok: boolean;
  /** Frames examined (1..BURST_FRAMES). */
  frames: number;
  decodeMs: number;
  reason?: string;
  decoded?: DecodedCode;
  /** The last frame examined. */
  frame: GrayImage;
}

export interface Submission {
  status: number;
  body: Record<string, any>;
  state: string | undefined;
  scanId: string | undefined;
  violations: string[];
}

export interface Scan extends Submission {
  photo: Photo;
}

export interface AnomalyView {
  productId: string | null;
  type: string;
  severity: string;
  riskScore: number;
  occurrences: number;
  status: string;
  details: Record<string, unknown>;
}

export interface CaptureStats {
  photos: number;
  decoded: number;
  frames: number;
  decodeMs: number[];
}

/** Per-device capture presets cycled through by `lab.device()` (metal is excluded: 55 % in the scan matrix). */
export const DEVICE_PRESETS: readonly PresetName[] = ['typicalPhone', 'glare', 'tilted45', 'lowLight', 'worn', 'leather', 'small', 'clean'];

/** One public response, as the scenario summary sees it. */
export interface ResponseRecord {
  state: string;
  violations: string[];
  /** The submitted bytes are not those of any code the world issued (edited, forged, corrupted, random). */
  forged: boolean;
}

export class Lab {
  readonly checks: Check[];
  readonly secrets: Set<string>;
  readonly responses: ResponseRecord[];
  readonly stats: CaptureStats;
  /** base64url data of every code issued in this world (and its spawned worlds). */
  readonly issuedData: Set<string>;
  /** Scan ids of camera scans of unaltered genuine artifacts (genome cross-check false-positive statistics). */
  readonly genuineScans: { lab: Lab; scanId: string }[];
  private shot = 0;
  private devices = 0;
  private readonly children: Lab[] = [];

  private constructor(
    readonly scenario: string,
    readonly label: string,
    readonly ctx: AppContext,
    readonly app: FastifyInstance,
    readonly clock: ManualClock,
    readonly provider: MemoryKeyProvider,
    readonly admin: Client,
    readonly catalog: Catalog,
    private readonly dbClose: () => Promise<void>,
    private readonly dbFactory: DbFactory,
    shared?: Lab,
  ) {
    this.checks = shared?.checks ?? [];
    this.secrets = shared?.secrets ?? new Set();
    this.responses = shared?.responses ?? [];
    this.stats = shared?.stats ?? { photos: 0, decoded: 0, frames: 0, decodeMs: [] };
    this.issuedData = shared?.issuedData ?? new Set();
    this.genuineScans = shared?.genuineScans ?? [];
  }

  static async open(opts: LabOptions, shared?: Lab): Promise<Lab> {
    const dbFactory = opts.dbFactory ?? pgliteFactory;
    const store = await dbFactory();
    let ctx: AppContext | undefined;
    let app: FastifyInstance | undefined;
    try {
      const clock = createManualClock(opts.start ?? WORLD_START);
      const provider = new MemoryKeyProvider({ env: 'test' });
      const config = testConfig({
        publicOrigin: ORIGIN,
        trustProxy: true,
        geo: { mode: 'headers', countryHeader: GEO_HEADERS.country, latHeader: GEO_HEADERS.lat, lonHeader: GEO_HEADERS.lon },
        anomaly: opts.anomaly ?? {},
        // Scenarios span up to two simulated days; the admin console stays logged in throughout.
        sessionTtlHours: { admin: 168 },
      });
      ctx = await createContext(config, { db: store.db, clock: clock.now, keyProvider: provider, ensureActiveKey: true });
      app = await buildApp(ctx, { serveStatic: false });
      const catalog = await seedCatalog(ctx);
      const creds = await createAdmin(ctx, 'ADMIN');
      const admin = new Client(app, { ip: '192.0.2.10' });
      const login = await admin.post('/api/admin/auth/login', { email: creds.email, password: creds.password });
      if (login.statusCode !== 200) throw new Error(`admin login failed: ${login.statusCode} ${login.body}`);
      return new Lab(opts.scenario, opts.label ?? 'default thresholds', ctx, app, clock, provider, admin, catalog, store.close, dbFactory, shared);
    } catch (e) {
      await app?.close();
      await ctx?.close();
      await store.close();
      throw e;
    }
  }

  /** A second, independent world (own database and keys) whose checks are recorded with this one's. */
  async spawn(opts: Omit<LabOptions, 'dbFactory'>): Promise<Lab> {
    const child = await Lab.open({ ...opts, dbFactory: this.dbFactory }, this);
    this.children.push(child);
    return child;
  }

  /** Worlds opened with spawn(). */
  spawned(): readonly Lab[] {
    return this.children;
  }

  async close(): Promise<void> {
    for (const c of this.children.splice(0)) await c.close();
    await this.app.close();
    await this.ctx.close();
    await this.dbClose();
  }

  // ── Time ─────────────────────────────────────────────────────────────────

  now(): Date {
    return this.clock.now();
  }

  /** Move the clock forward to `iso` (never backwards: scan histories must stay causal). */
  at(iso: string): Date {
    const t = Date.parse(iso);
    if (!(t >= this.clock.now().getTime())) throw new Error(`clock may only move forward (${this.clock.now().toISOString()} → ${iso})`);
    this.clock.set(t);
    return this.clock.now();
  }

  advance(ms: number): Date {
    if (!(ms >= 0)) throw new Error('advance(ms) needs ms ≥ 0');
    return this.clock.advance(ms);
  }

  // ── Admin API ────────────────────────────────────────────────────────────

  private async adminCall(method: 'GET' | 'POST', url: string, body?: unknown, expectStatus = [200, 201]): Promise<LightMyRequestResponse> {
    const res = method === 'GET' ? await this.admin.get(url) : await this.admin.post(url, body ?? {});
    if (!expectStatus.includes(res.statusCode)) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body.slice(0, 300)}`);
    return res;
  }

  /** Issue a product through POST /api/admin/products (the generator), optionally activated (retail sale). */
  async issue(opts: { activate?: boolean; claim?: boolean; variant?: string } = {}): Promise<IssuedProduct> {
    const res = await this.adminCall('POST', '/api/admin/products', {
      categoryCode: this.catalog.categoryCode,
      modelId: this.catalog.modelId,
      collectionId: this.catalog.collectionId,
      material: '925 STERLING SILVER',
      ...(opts.variant ? { variant: opts.variant } : {}),
      ...(opts.claim ? { withClaimSecret: true } : {}),
    });
    const b = safeJson(res) as any;
    const p: IssuedProduct = {
      productId: b.product.productId,
      uuid: b.product.id,
      packedIdentity: b.product.packedIdentity,
      genome: { glyphs: b.genome.glyphs, fingerprint: b.genome.fingerprint },
      code: { id: b.code.id, data: b.code.data, issue: b.code.issue, keyId: b.code.keyId, payloadHash: b.code.payloadHash },
      ...(b.claimCode ? { claimCode: b.claimCode } : {}),
    };
    for (const s of [p.uuid, p.code.id, p.code.payloadHash, b.genome.id, p.claimCode ?? '']) if (s) this.secrets.add(s);
    this.issuedData.add(p.code.data);
    if (opts.activate) await this.activate(p);
    return p;
  }

  /** Retail sale: POST …/warranty/activate (ISSUED → ACTIVATED, warranty starts). */
  async activate(p: IssuedProduct): Promise<void> {
    await this.adminCall('POST', `/api/admin/products/${p.productId}/warranty/activate`, { retailer: 'ORBES PARIS', country: 'FR' });
  }

  async transition(p: IssuedProduct, to: string, reason: string): Promise<void> {
    await this.adminCall('POST', `/api/admin/products/${p.productId}/transitions`, { to, reason });
  }

  async revokeCode(codeId: string, reason: string): Promise<void> {
    await this.adminCall('POST', `/api/admin/codes/${codeId}/revoke`, { reason });
  }

  /** POST …/codes/reissue: the old code is superseded, a new one (issue + 1) is signed by the ACTIVE key. */
  async reissue(p: IssuedProduct, reason: string): Promise<IssuedProduct> {
    const res = await this.adminCall('POST', `/api/admin/products/${p.productId}/codes/reissue`, { reason });
    const c = (safeJson(res) as any).code;
    for (const s of [c.id, c.payloadHash]) this.secrets.add(s);
    this.issuedData.add(c.data);
    return { ...p, code: { id: c.id, data: c.data, issue: c.issue, keyId: c.keyId, payloadHash: c.payloadHash } };
  }

  async rotateKey(kid: string): Promise<number> {
    const res = await this.adminCall('POST', '/api/admin/keys/rotate', { kid });
    return (safeJson(res) as any).keyId as number;
  }

  async revokeKey(keyId: number, reason: string, compromisedAt?: Date): Promise<void> {
    await this.adminCall('POST', `/api/admin/keys/${keyId}/revoke`, { reason, ...(compromisedAt ? { compromisedAt: compromisedAt.toISOString() } : {}) });
  }

  /** The private key of `keyId` signing outside issuance: what an attacker holding a stolen key can do. */
  async signWithKey(keyId: number, message: Uint8Array): Promise<Uint8Array> {
    const row = await this.ctx.db.selectFrom('cryptographic_keys').select('provider_ref').where('key_id', '=', keyId).executeTakeFirstOrThrow();
    return this.provider.sign(row.provider_ref, message);
  }

  /** Every anomaly of this world, through GET /api/admin/anomalies. */
  async anomalies(): Promise<AnomalyView[]> {
    const res = await this.adminCall('GET', '/api/admin/anomalies?page=1&pageSize=200');
    // The world clock is fixed, so several findings share a timestamp and the API order among them
    // follows random row ids: sort by product and type so the report reads the same on every run.
    const items = ((safeJson(res) as any).items as any[])
      .slice()
      .sort((x, y) => String(x.productId ?? '').localeCompare(String(y.productId ?? '')) || String(x.type).localeCompare(String(y.type)));
    return items.map((a) => ({
      productId: a.productId,
      type: a.type,
      severity: a.severity,
      riskScore: a.riskScore,
      occurrences: a.occurrences,
      status: a.status,
      details: a.details,
    }));
  }

  async anomaliesOf(p: IssuedProduct | null): Promise<AnomalyView[]> {
    return (await this.anomalies()).filter((a) => a.productId === (p ? p.productId : null));
  }

  /** Internal record of one verification (admin evidence, never public). */
  async authEvent(scanId: string | undefined) {
    if (!scanId) return undefined;
    return this.ctx.db
      .selectFrom('authentication_events')
      .select(['state', 'reasons', 'genome_check', 'risk_score', 'signature_valid'])
      .where('scan_event_id', '=', scanId)
      .executeTakeFirst();
  }

  async scanEventCount(): Promise<number> {
    const r = await this.ctx.db.selectFrom('scan_events').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  // ── Artifacts ────────────────────────────────────────────────────────────

  /** The genuine artifact: GET /api/admin/codes/:codeId/artifact.png (30 mm, 600 dpi), decoded to luma. */
  async artifact(p: IssuedProduct, label = `${p.productId}/I${p.code.issue}`): Promise<Artifact> {
    const res = await this.adminCall('GET', `/api/admin/codes/${p.code.id}/artifact.png?widthMm=${ARTIFACT_WIDTH_MM}&dpi=${ARTIFACT_DPI}`);
    if (res.headers['content-type'] !== 'image/png') throw new Error(`artifact content-type ${String(res.headers['content-type'])}`);
    const png = new Uint8Array(res.rawPayload);
    return { label, kind: 'genuine', png, gray: pngToGray(png) };
  }

  /** A forger's print: arbitrary 79 bytes and glyphs through the server's render module (same pipeline as genuine prints). */
  async forgeArtifact(label: string, data: Uint8Array, glyphs: readonly number[], theme: ArtifactTheme = 'classic'): Promise<Artifact> {
    const r = await renderArtifact(
      { data, genomeGlyphs: glyphs },
      'png',
      { widthMm: ARTIFACT_WIDTH_MM, dpi: ARTIFACT_DPI, theme, decor: true, label: false },
      { productId: 'O00-A-00000', issue: 1, createdAt: this.now() },
    );
    const png = r.body as Uint8Array;
    return { label, kind: 'forged', png, gray: pngToGray(png) };
  }

  // ── Devices and scans ────────────────────────────────────────────────────

  /** A phone: its own cookie jar (device id), IP, location and camera conditions. */
  device(name: string, place: Place | undefined, opts: { geo?: Device['geo']; preset?: PresetName; client?: Client } = {}): Device {
    const n = ++this.devices;
    const client = opts.client ?? new Client(this.app, { ip: `10.${(n >> 8) & 255}.${n & 255}.${1 + (hashSeed(this.scenario, name) % 250)}` });
    const preset = opts.preset ?? DEVICE_PRESETS[(n - 1) % DEVICE_PRESETS.length];
    return { name, client, place, geo: opts.geo ?? (place ? 'coords' : 'none'), preset };
  }

  /** Photograph `artifact` with the device's camera and run the scanner's decode step on each frame of a short burst. */
  photograph(device: Device, artifact: Artifact, opts: { preset?: PresetName } = {}): Photo {
    const shot = ++this.shot;
    const rng = new Prng(hashSeed('orbes-counterfeit-sim/pose', this.scenario, device.name, artifact.label, shot));
    const base: CaptureParams = PRESETS[opts.preset ?? device.preset];
    const rotation = (base.rotationDeg ?? 0) + rng.range(0, 360);
    const pose: CaptureParams = {
      tiltXDeg: (base.tiltXDeg ?? 0) + rng.range(-4, 4),
      tiltYDeg: (base.tiltYDeg ?? 0) + rng.range(-4, 4),
      offset: { x: rng.range(-40, 40), y: rng.range(-25, 25) },
    };
    let last: Photo | undefined;
    for (let i = 0; i < BURST_FRAMES; i++) {
      const params: CaptureParams = { ...base, ...pose, rotationDeg: rotation + BURST_DRIFT_DEG * i };
      const frame = simulateCapture(artifact.gray, params, hashSeed('orbes-counterfeit-sim/frame', this.scenario, device.name, artifact.label, shot, i));
      const rgba = grayToRgba(frame);
      const reply = handleDecode({
        type: 'decode',
        id: shot,
        width: frame.width,
        height: frame.height,
        buffer: rgba.buffer as ArrayBuffer,
        options: { tryInverted: true, tryMirrored: false, readGenome: true },
      });
      this.stats.decodeMs.push(reply.timing.decodeMs);
      last = reply.ok
        ? { ok: true, frames: i + 1, decodeMs: reply.timing.decodeMs, decoded: reply.decoded, frame }
        : { ok: false, frames: i + 1, decodeMs: reply.timing.decodeMs, reason: reply.reason, frame };
      if (reply.ok) break;
    }
    this.stats.photos++;
    this.stats.frames += last!.frames;
    if (last!.ok) this.stats.decoded++;
    return last!;
  }

  /** POST /api/v1/verify from `device` (its cookies, IP and geo headers), with the redaction check. */
  async submit(device: Device, input: VerifyInput | Record<string, unknown>): Promise<Submission> {
    const headers: Record<string, string> = {};
    if (device.place && device.geo !== 'none') headers[GEO_HEADERS.country] = device.place.country;
    if (device.place && device.geo === 'coords') {
      headers[GEO_HEADERS.lat] = String(device.place.lat);
      headers[GEO_HEADERS.lon] = String(device.place.lon);
    }
    const res = await device.client.post('/api/v1/verify', input, { headers });
    const body = (safeJson(res) ?? {}) as Record<string, any>;
    const violations = res.statusCode === 200 ? redactionViolations(body, this.secrets) : [];
    const code = (input as { code?: unknown }).code;
    if (res.statusCode === 200) this.responses.push({ state: String(body.state), violations, forged: !(typeof code === 'string' && this.issuedData.has(code)) });
    return { status: res.statusCode, body, state: res.statusCode === 200 ? body.state : undefined, scanId: body.scanId, violations };
  }

  /** Submit raw framed bytes (a forger's edit or a hand-made request), no genome reading. */
  submitBytes(device: Device, data: Uint8Array, genome?: VerifyInput['genome']): Promise<Submission> {
    return this.submit(device, { code: toBase64Url(data), ...(genome ? { genome } : {}) });
  }

  /** Photograph + decode + (when decoded) verify, exactly like the mobile scanner. */
  async scan(device: Device, artifact: Artifact): Promise<Scan> {
    const photo = this.photograph(device, artifact);
    if (!photo.ok || !photo.decoded) {
      return { photo, status: 0, body: {}, state: undefined, scanId: undefined, violations: [] };
    }
    const sub = await this.submit(device, buildVerifyInput(photo.decoded, 'camera', photo.decodeMs));
    if (artifact.kind === 'genuine' && sub.scanId) this.genuineScans.push({ lab: this, scanId: sub.scanId });
    return { ...sub, photo };
  }

  /** A customer account (registered and logged in through the account API) and the phone it uses. */
  async customer(name: string, place: Place): Promise<{ device: Device; accountId: string }> {
    const n = ++this.devices;
    const client = new Client(this.app, { ip: `172.16.${(n >> 8) & 255}.${n & 255}` });
    const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${n}@example.com`;
    const res = await client.post('/api/v1/account/register', { email, password: PASSWORD, displayName: name });
    if (res.statusCode !== 201) throw new Error(`account register failed: ${res.statusCode} ${res.body}`);
    const row = await this.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow();
    this.secrets.add(row.id);
    this.devices--; // device() below counts it
    return { device: this.device(name, place, { client }), accountId: row.id };
  }

  /** First registration through the real token flow: POST /api/v1/ownership/register. */
  async register(owner: Device, scan: Submission, claimCode?: string): Promise<number> {
    const token = scan.body.registration?.token as string | undefined;
    if (!token) throw new Error(`no registration token in a ${scan.state} response`);
    const res = await owner.client.post('/api/v1/ownership/register', { registrationToken: token, ...(claimCode ? { claimCode } : {}) });
    return res.statusCode;
  }

  // ── Recording ────────────────────────────────────────────────────────────

  record(c: Check): Check {
    this.checks.push(c);
    return c;
  }

  /** Boolean check with free-text expected / observed. */
  expectTrue(id: string, title: string, expected: string, observed: string, ok: boolean, note?: string): Check {
    return this.record({ id, title, expected, observed, status: ok ? 'PASS' : 'FAIL', ...(note ? { note } : {}) });
  }

  /**
   * One public state. With `reason`, the internal authentication event must
   * list that reason (the state was reached for the right cause). With `gap`,
   * a state that differs from §27's expectation but matches the contract is a
   * GAP rather than a FAIL. With `limit`, a match is recorded as LIMIT (works
   * as designed, counterfeit not caught). A response that leaks anything is a FAIL.
   */
  async expectState(
    id: string,
    title: string,
    res: Submission | undefined,
    expect: Expect,
    opts: { reason?: string; gap?: { contract: Expect; note: string }; limit?: boolean; note?: string } = {},
  ): Promise<Check> {
    const state = res?.state;
    const ev = res?.scanId ? await this.authEvent(res.scanId) : undefined;
    const reasonOk = opts.reason === undefined || (ev?.reasons ?? []).includes(opts.reason);
    const leak = res?.violations ?? [];
    let observed = state ?? (res && res.status ? `HTTP ${res.status}` : 'no request');
    if (opts.reason !== undefined) observed += ` [${(ev?.reasons ?? []).join(', ') || '—'}]`;
    if (leak.length) observed += ` LEAK: ${leak.join('; ')}`;
    let status: CheckStatus = 'FAIL';
    if (leak.length === 0 && reasonOk) {
      if (matches(expect, state)) status = opts.limit ? 'LIMIT' : 'PASS';
      else if (opts.gap && matches(opts.gap.contract, state)) status = 'GAP';
    }
    const expected = describeExpect(expect) + (opts.reason ? ` [${opts.reason}]` : '');
    const note = status === 'GAP' ? opts.gap!.note : opts.note;
    return this.record({ id, title, expected, observed, status, ...(note ? { note } : {}) });
  }

  /** Many submissions, all expected to match `expect` (observed as a tally). */
  expectAll(id: string, title: string, subs: readonly Submission[], expect: Expect, opts: { gap?: { contract: Expect; note: string }; note?: string } = {}): Check {
    const states = subs.map((s) => s.state ?? `HTTP ${s.status}`);
    const leaks = subs.flatMap((s) => s.violations);
    const all = (e: Expect) => subs.length > 0 && subs.every((s) => matches(e, s.state));
    let status: CheckStatus = 'FAIL';
    if (leaks.length === 0) {
      if (all(expect)) status = 'PASS';
      else if (opts.gap && all(opts.gap.contract)) status = 'GAP';
    }
    const observed = tally(states) + (leaks.length ? ` LEAK: ${[...new Set(leaks)].join('; ')}` : '');
    const note = status === 'GAP' ? opts.gap!.note : opts.note;
    return this.record({ id, title, expected: `${describeExpect(expect)} ×${subs.length}`, observed, status, ...(note ? { note } : {}) });
  }

  /** The anomaly types recorded for a product include `types`. */
  async expectAnomalies(id: string, title: string, p: IssuedProduct | null, types: readonly string[]): Promise<Check> {
    const rows = await this.anomaliesOf(p);
    const have = new Set(rows.map((a) => a.type));
    const ok = types.every((t) => have.has(t));
    const observed = rows.length ? rows.map((a) => `${a.type} (${a.severity}, ×${a.occurrences})`).join(', ') : 'none';
    return this.expectTrue(id, title, types.length ? types.join(' + ') : 'none', observed, types.length ? ok : rows.length === 0);
  }

  /** Scenario-level redaction summary over every public response of the world(s). */
  redactionCheck(id: string): Check {
    const n = this.responses.length;
    const bad = this.responses.filter((r) => r.violations.length > 0);
    const states = new Set(this.responses.map((r) => r.state));
    return this.expectTrue(
      id,
      `public redaction of every response (${states.size} states)`,
      'no internal field, score, reason, raw status or id',
      bad.length ? `${bad.length} of ${n} leaked: ${bad[0].violations.join('; ')}` : `${n} of ${n} clean`,
      bad.length === 0 && n > 0,
    );
  }
}

// ── Images ─────────────────────────────────────────────────────────────────

export function pngToGray(png: Uint8Array): GrayImage {
  const decoded = PNG.sync.read(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  return rgbaToGray(decoded.data, decoded.width, decoded.height, 255);
}

/** Code units → pixel mapping of an artifact image (50 u square, centre at the seal). */
function unitMap(img: GrayImage): { pxPerU: number; c: number } {
  return { pxPerU: img.width / CODE01_SIZE, c: img.width / 2 };
}

/**
 * Physical damage to a printed artifact: `spots` random discs of ink or bare
 * substrate (radius 0.5–1.2 u) inside the annular sector [r0, r1] × [a0, a1]
 * (angles in degrees clockwise from north). Seeded.
 */
export function scuff(img: GrayImage, seed: string, sector: { r0: number; r1: number; a0: number; a1: number }, spots: number): GrayImage {
  const rng = new Prng(seed);
  const out = { width: img.width, height: img.height, data: img.data.slice() };
  const { pxPerU, c } = unitMap(img);
  const toRad = Math.PI / 180;
  const inSector = (x: number, y: number) => {
    const r = Math.hypot(x, y);
    let a = Math.atan2(x, -y) / toRad;
    if (a < 0) a += 360;
    return r >= sector.r0 && r <= sector.r1 && a >= sector.a0 && a <= sector.a1;
  };
  for (let n = 0; n < spots; n++) {
    const r = Math.sqrt(rng.range(sector.r0 ** 2, sector.r1 ** 2));
    const a = rng.range(sector.a0, sector.a1) * toRad;
    const cx = r * Math.sin(a);
    const cy = -r * Math.cos(a);
    const rad = rng.range(0.5, 1.2);
    const level = rng.chance(0.5) ? 0 : 255;
    const x0 = Math.max(0, Math.floor((cx - rad) * pxPerU + c));
    const x1 = Math.min(img.width - 1, Math.ceil((cx + rad) * pxPerU + c));
    const y0 = Math.max(0, Math.floor((cy - rad) * pxPerU + c));
    const y1 = Math.min(img.height - 1, Math.ceil((cy + rad) * pxPerU + c));
    for (let py = y0; py <= y1; py++) {
      const y = (py + 0.5 - c) / pxPerU;
      for (let px = x0; px <= x1; px++) {
        const x = (px + 0.5 - c) / pxPerU;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad && inSector(x, y)) out.data[py * img.width + px] = level;
      }
    }
  }
  return out;
}

/** Paint the annulus r0..r1 (u) with paper: e.g. the genome orbit sanded off. */
export function blankAnnulus(img: GrayImage, r0: number, r1: number, level = 255): GrayImage {
  const out = { width: img.width, height: img.height, data: img.data.slice() };
  const { pxPerU, c } = unitMap(img);
  for (let py = 0; py < img.height; py++) {
    const y = (py + 0.5 - c) / pxPerU;
    for (let px = 0; px < img.width; px++) {
      const x = (px + 0.5 - c) / pxPerU;
      const r = Math.hypot(x, y);
      if (r >= r0 && r <= r1) out.data[py * img.width + px] = level;
    }
  }
  return out;
}

/** A physically altered version of an artifact (damage, sanding): same print, new image. */
export function withGray(a: Artifact, label: string, gray: GrayImage): Artifact {
  return { label, kind: a.kind === 'forged' ? 'forged' : 'altered', png: a.png, gray };
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Wall-clock helper. */
export function since(t0: number): number {
  return performance.now() - t0;
}
