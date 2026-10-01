/**
 * ORBES GENOME CODE — proof of concept (specification §35).
 *
 *   npm run poc [-- --seed <n>] [--out <dir>]
 *
 * One end-to-end run on the real core modules, with no server and no
 * database: key pair → product identity → GENOME-01 → signed canonical payload
 * → CODE-01 → SVG/PNG → phone capture → decode → verify → AUTHENTIC; then a
 * series of attacks, each of which must be refused with the public state the
 * production server answers: INVALID_SIGNATURE, MALFORMED_CODE, or
 * SUSPICIOUS_ACTIVITY (reason GENOME_MISMATCH) for genuine data reprinted
 * with another product's genome.
 *
 * Real: identity, payload, genome, Reed-Solomon/BCH/CRC, encoder, SVG
 * renderer, resvg rasterisation, decoder, Ed25519 (node:crypto signer,
 * isomorphic @noble verifier, OpenSSL cross-check).
 * Simulated: the phone camera (test/support/camera-sim.ts, deterministic per
 * scene), key custody (the key pair lives in process memory) and the product
 * registry (an in-memory map). The verification decision is the small pure
 * function `decideVerification` below.
 *
 * Without --seed, the key seed, nonce and the forger's random bytes come from
 * the system CSPRNG and the code is issued today, so every run issues a fresh
 * code. --seed <n> makes the run reproducible (deterministic entropy, issue
 * date fixed to SEEDED_ISSUE_DATE). Artifacts go to genome/out/poc/
 * (git-ignored). Exit code 0 iff every outcome matches its expectation.
 */

import { randomFillSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import {
  CODE01,
  CODE01_DATA_CELLS,
  CODE01_SIZE,
  CODE01_TOTAL_CELLS,
  IdentityError,
  PAYLOAD_V1_LENGTH,
  PayloadError,
  SIGNATURE_LENGTH,
  SIGNING_DOMAIN_V1,
  SUPPORTED_GENOME_VERSIONS,
  angleOf,
  cellByteIndex,
  cellCenter,
  computeGenome,
  dateFromIssuedDay,
  decodeOrbesCode,
  decodePayload,
  deg,
  encodeOrbesCode,
  encodePayload,
  equalBytes,
  formatProductId,
  frameCodeData,
  genomeVocabulary,
  issuedDayFromDate,
  packIdentity,
  parseProductId,
  polar,
  readU16BE,
  renderGenomeSvg,
  renderOrbesCodeSvg,
  signingMessage,
  staticCategoryResolver,
  toHex,
  unframeCodeData,
  verifyCodeSignature,
  writeU32BE,
  type CategoryInfo,
  type CategoryResolver,
  type CodePayloadV1,
  type DecodeResult,
  type Genome,
  type OrbesCodeModel,
  type ProductIdentity,
} from '../src/core/index.js';
import { publicKeyFromSeed, signEd25519, verifyEd25519Node } from '../src/server/crypto/ed25519-node.js';
import type { VerificationState as ServerVerificationState } from '../src/server/db/schema.js';
import { PRESETS, simulateCapture, type CaptureParams } from '../test/support/camera-sim.js';
import { writePng } from '../test/support/image-io.js';
import { hashSeed, Prng } from '../test/support/prng.js';
import { svgToGray, type GrayImage } from '../test/support/raster.js';

// ── Demo world ─────────────────────────────────────────────────────────────

export const POC_KEY_ID = 1;
const GENOME_VERSION = 1;

/** In-memory category registry: letter ↔ immutable 5-bit index. */
export const POC_CATEGORIES: readonly CategoryInfo[] = [
  { code: 'J', index: 1, name: 'Jewelry' },
  { code: 'L', index: 2, name: 'Leather Goods' },
];

export interface CatalogueEntry {
  productId: string;
  model: string;
  material: string;
}

/** The product the POC issues a code for. */
export const POC_PRODUCT: CatalogueEntry = { productId: 'O26-J-00184', model: 'MONOLITHE RING', material: '925 STERLING SILVER' };
/** A second registered product: the identity the forgeries try to pass for. */
export const POC_DECOY: CatalogueEntry = { productId: 'O26-L-00027', model: 'ORBIT TOTE', material: 'FULL-GRAIN CALF LEATHER' };

export interface ProductRecord extends CatalogueEntry {
  /** Category name, resolved once when the product is registered. */
  category: string;
  /** Payload bytes of every code issued for the product, by issue number. */
  codes: Map<number, Uint8Array>;
}

/** In-memory product registry keyed by packed identity (the server keeps the same index in PostgreSQL). */
export function createRegistry(categories: CategoryResolver, catalogue: readonly CatalogueEntry[] = [POC_PRODUCT, POC_DECOY]): Map<number, ProductRecord> {
  return new Map(
    catalogue.map((entry) => {
      const identity = parseProductId(entry.productId, categories);
      const category = categories.byIndex(identity.categoryIndex);
      if (!category) throw new IdentityError(`no category with index ${identity.categoryIndex}`);
      return [packIdentity(identity), { ...entry, category: category.name, codes: new Map<number, Uint8Array>() }];
    }),
  );
}

/** Source of secret randomness: key seed, nonce, the forger's random bytes. */
export type Entropy = (length: number) => Uint8Array;

export const systemEntropy: Entropy = (length) => randomFillSync(new Uint8Array(length));

/** Reproducible byte stream (sfc32) for tests and recorded demos. Never for real keys. */
export function demoEntropy(seed: number): Entropy {
  const rng = new Prng(hashSeed('orbes-poc/entropy', seed));
  return (length) => Uint8Array.from({ length }, () => rng.u32() >>> 24);
}

// ── Issuance ───────────────────────────────────────────────────────────────

export interface Signer {
  keyId: number;
  /** 32-byte RFC 8032 secret seed. */
  seed: Uint8Array;
}

export interface IssuedCode {
  payload: CodePayloadV1;
  payloadBytes: Uint8Array;
  signature: Uint8Array;
  /** payload ‖ signature ‖ CRC-16: the 79 bytes the code carries. */
  data: Uint8Array;
  genome: Genome;
}

/** Canonical payload, Ed25519 signature (node:crypto, as on the server), framing and genome. */
export function issueCode(identity: ProductIdentity, signer: Signer, fields: { issue: number; issuedAt: Date; nonce: Uint8Array }): IssuedCode {
  const payload: CodePayloadV1 = {
    codeVersion: 1,
    genomeVersion: GENOME_VERSION,
    keyId: signer.keyId,
    identity,
    issue: fields.issue,
    issuedDay: issuedDayFromDate(fields.issuedAt),
    nonce: fields.nonce,
  };
  const payloadBytes = encodePayload(payload);
  const signature = signEd25519(signer.seed, signingMessage(payloadBytes));
  return {
    payload,
    payloadBytes,
    signature,
    data: frameCodeData(payloadBytes, signature),
    genome: computeGenome(packIdentity(identity), GENOME_VERSION),
  };
}

// ── Verification decision ──────────────────────────────────────────────────

/**
 * The public states the POC can reach: a subset of the production states
 * (PLATFORM-CONTRACTS §2.4), so the POC never tells a story the server would
 * not. A printed genome that disagrees with the signed identity is
 * SUSPICIOUS_ACTIVITY with reason GENOME_MISMATCH, exactly as on the server.
 */
export type VerificationState = Extract<ServerVerificationState, 'AUTHENTIC' | 'UNKNOWN' | 'SUSPICIOUS_ACTIVITY' | 'INVALID_SIGNATURE' | 'MALFORMED_CODE'>;

export interface GenomeReading {
  glyphs: readonly (number | null)[];
  confidence: readonly number[];
}

/** What a scanner submits: the bytes it read and its genome reading, or why it read nothing. A DecodeResult is one. */
export type ScanEvidence =
  | { ok: true; data: Uint8Array; genome: GenomeReading | null }
  | { ok: false; reason: string; detail?: string };

export interface VerificationContext {
  /** Trusted Ed25519 public keys by key id. */
  keys: ReadonlyMap<number, Uint8Array>;
  /** Product registry by packed identity. */
  products: ReadonlyMap<number, ProductRecord>;
}

export type GenomeCheck = 'MATCH' | 'MISMATCH' | 'INCONCLUSIVE' | 'NOT_READ';

export interface GenomeComparison {
  check: GenomeCheck;
  /** Glyphs read with enough confidence to count. */
  read: number;
  mismatches: number;
}

export interface AuthenticProduct {
  productId: string;
  model: string;
  category: string;
  material: string;
  createdYear: number;
  genomeFingerprint: string;
  keyId: number;
  issue: number;
  /** ISO date (UTC) the code was issued. */
  issuedOn: string;
}

export interface Verdict {
  state: VerificationState;
  /** Machine-readable cause: VERIFIED, BAD_SIGNATURE, DECODE_ECC, PAYLOAD_CRC, PRODUCT_NOT_REGISTERED… */
  reason: string;
  /** The parsed payload, once the frame is well-formed (unauthenticated before the signature check). */
  payload?: CodePayloadV1;
  /** Genome recomputed from the signed identity and compared with the reading (signed, registered codes only). */
  genome?: GenomeComparison & { expected: Genome };
  product?: AuthenticProduct;
}

// Genome cross-check thresholds, as on the server: a reading counts from 6
// confident glyphs, and one stray glyph is a misread rather than a mismatch.
const GENOME_MIN_GLYPHS = 6;
const GENOME_MIN_CONFIDENCE = 0.5;
const GENOME_MISMATCH_GLYPHS = 2;

/** Compare a genome reading with the glyphs the signed identity implies. */
export function compareGenome(expected: readonly number[], reading: GenomeReading | null): GenomeComparison {
  if (!reading) return { check: 'NOT_READ', read: 0, mismatches: 0 };
  let read = 0;
  let mismatches = 0;
  expected.forEach((glyph, i) => {
    const seen = reading.glyphs[i];
    if (seen === null || seen === undefined || !(reading.confidence[i] >= GENOME_MIN_CONFIDENCE)) return;
    read++;
    if (seen !== glyph) mismatches++;
  });
  const check = read < GENOME_MIN_GLYPHS ? 'INCONCLUSIVE' : mismatches >= GENOME_MISMATCH_GLYPHS ? 'MISMATCH' : 'MATCH';
  return { check, read, mismatches };
}

/**
 * The verification decision, pure: the first failing check decides.
 *
 *   1. readable frame, CRC-16, strict payload parse        else MALFORMED_CODE
 *   2. key named by the code, Ed25519 signature            else INVALID_SIGNATURE
 *   3. supported genome version                            else MALFORMED_CODE
 *   4. product registered, this exact code on record       else UNKNOWN
 *   5. printed genome agrees with the signed identity      else SUSPICIOUS_ACTIVITY
 *                                                          (reason GENOME_MISMATCH)
 *
 * The signature is checked before any payload field is interpreted (only the
 * key id is read, to select the key), so an unsigned edit to any field, the
 * genome version included, is reported as what it is: a bad signature.
 */
export function decideVerification(scan: ScanEvidence, ctx: VerificationContext): Verdict {
  if (!scan.ok) return { state: 'MALFORMED_CODE', reason: `DECODE_${scan.reason}` };
  let frame: ReturnType<typeof unframeCodeData>;
  try {
    frame = unframeCodeData(scan.data);
  } catch (e) {
    if (e instanceof PayloadError) return { state: 'MALFORMED_CODE', reason: `PAYLOAD_${e.code}` };
    throw e;
  }
  const { payload, payloadBytes, signature } = frame;

  const publicKey = ctx.keys.get(payload.keyId);
  if (!publicKey) return { state: 'INVALID_SIGNATURE', reason: 'UNKNOWN_KEY', payload };
  if (!verifyCodeSignature(publicKey, payloadBytes, signature)) return { state: 'INVALID_SIGNATURE', reason: 'BAD_SIGNATURE', payload };
  if (!SUPPORTED_GENOME_VERSIONS.includes(payload.genomeVersion)) {
    return { state: 'MALFORMED_CODE', reason: 'UNSUPPORTED_GENOME_VERSION', payload };
  }

  const packed = packIdentity(payload.identity);
  const record = ctx.products.get(packed);
  if (!record) return { state: 'UNKNOWN', reason: 'PRODUCT_NOT_REGISTERED', payload };
  const onRecord = record.codes.get(payload.issue);
  // A valid signature on a code never recorded means a leaked key or an unrecorded issuance.
  if (!onRecord || !equalBytes(onRecord, payloadBytes)) return { state: 'UNKNOWN', reason: 'CODE_NOT_REGISTERED', payload };

  const expected = computeGenome(packed, payload.genomeVersion);
  const genome = { expected, ...compareGenome(expected.glyphs, scan.genome) };
  if (genome.check === 'MISMATCH') return { state: 'SUSPICIOUS_ACTIVITY', reason: 'GENOME_MISMATCH', payload, genome };

  return {
    state: 'AUTHENTIC',
    reason: 'VERIFIED',
    payload,
    genome,
    product: {
      productId: record.productId,
      model: record.model,
      category: record.category.toUpperCase(),
      material: record.material,
      createdYear: payload.identity.year,
      genomeFingerprint: expected.fingerprint,
      keyId: payload.keyId,
      issue: payload.issue,
      issuedOn: isoDay(dateFromIssuedDay(payload.issuedDay)),
    },
  };
}

// ── Imaging: render, photograph, decode ────────────────────────────────────

/** Source raster for the camera: comfortably finer than any capture of it. */
const SOURCE_PX_PER_U = 16;
const PREVIEW_WIDTH_PX = 1200;
/** Hand-held shot: typicalPhone (clutter, paper, lens distortion, blur, noise, JPEG 82), turned and tilted further. */
const PHONE = PRESETS.typicalPhone;
const PHONE_POSE = { rotationDeg: 23, tiltXDeg: 16, tiltYDeg: -11 } as const;
/** A scanner reads a stream of frames; each code gets a short burst, the hand drifting slightly between frames. */
const BURST_FRAMES = 3;
const BURST_DRIFT_DEG = 1.5;

type Decoded = Extract<DecodeResult, { ok: true }>;

export interface Capture {
  /** The last frame examined: the first that decoded, or the last of the burst. */
  frame: GrayImage;
  result: DecodeResult;
  /** Frames examined (1..BURST_FRAMES). */
  frames: number;
  /** Simulation time of the last frame (ms). */
  captureMs: number;
}

function rasterise(svg: string): GrayImage {
  return svgToGray(svg, { widthPx: CODE01_SIZE * SOURCE_PX_PER_U });
}

/** Photograph `source` frame after frame until one decodes or the burst ends. `scene` seeds the camera. */
function photographAndDecode(source: GrayImage, scene: string): Capture {
  for (let i = 0; ; i++) {
    const params: CaptureParams = { ...PHONE, ...PHONE_POSE, rotationDeg: PHONE_POSE.rotationDeg + BURST_DRIFT_DEG * i };
    const t0 = performance.now();
    const frame = simulateCapture(source, params, hashSeed('orbes-poc/scene', scene, i));
    const captureMs = performance.now() - t0;
    const result = decodeOrbesCode(frame);
    if (result.ok || i + 1 === BURST_FRAMES) return { frame, result, frames: i + 1, captureMs };
  }
}

// ── Attacks ────────────────────────────────────────────────────────────────

/** A forger's byte edit on a read frame. CRC-16 is public, not a seal, so the forger recomputes it. */
function forge(data: Uint8Array, edit: (payload: Uint8Array, signature: Uint8Array) => void): Uint8Array {
  const { payloadBytes, signature } = unframeCodeData(data);
  edit(payloadBytes, signature);
  return frameCodeData(payloadBytes, signature);
}

const MAX_RANDOM_DRAWS = 1_000_000;

/**
 * Uniformly random payload ‖ signature bytes until they parse as a payload
 * naming `keyId` (key ids are public, so a forger aims at the live key), then
 * framed with a valid CRC-16.
 */
function randomWellFormedFrame(random: Entropy, keyId: number): { data: Uint8Array; payload: CodePayloadV1; draws: number } {
  for (let draws = 1; draws <= MAX_RANDOM_DRAWS; draws++) {
    const body = random(PAYLOAD_V1_LENGTH + SIGNATURE_LENGTH);
    const payloadBytes = body.subarray(0, PAYLOAD_V1_LENGTH);
    const payload = payloadBytes[1] === keyId ? tryDecodePayload(payloadBytes) : undefined;
    if (payload) return { data: frameCodeData(payloadBytes, body.subarray(PAYLOAD_V1_LENGTH)), payload, draws };
  }
  throw new Error(`no well-formed random frame in ${MAX_RANDOM_DRAWS} draws: is the entropy source degenerate?`);
}

function tryDecodePayload(payloadBytes: Uint8Array): CodePayloadV1 | undefined {
  try {
    return decodePayload(payloadBytes);
  } catch (e) {
    if (e instanceof PayloadError) return undefined;
    throw e;
  }
}

/**
 * Physical damage for attack (f): ink smears and abrasions (random discs of
 * ink or bare substrate) over a 240° sector of data orbits 1–12. Orbit 0
 * (format words), the seal and the moons survive, so the decoder locates the
 * code and then fails in Reed-Solomon.
 */
const DAMAGE = { innerRadius: 11, outerRadius: CODE01.extent.halfWidth, from: deg(60), to: deg(300) } as const;
const DAMAGE_SPOTS = 900;
const DAMAGE_SPOT_RADIUS_U = { min: 0.5, max: 1.2 } as const;

function inDamage(x: number, y: number): boolean {
  const r = Math.hypot(x, y);
  const a = angleOf(x, y);
  return r >= DAMAGE.innerRadius && r <= DAMAGE.outerRadius && a >= DAMAGE.from && a <= DAMAGE.to;
}

function scuff(source: GrayImage, seed: string): GrayImage {
  const rng = new Prng(seed);
  const { width, height } = source;
  const data = source.data.slice();
  const pxPerU = width / CODE01_SIZE;
  const half = CODE01_SIZE / 2;
  for (let n = 0; n < DAMAGE_SPOTS; n++) {
    // Area-uniform over the annular sector.
    const centre = polar(Math.sqrt(rng.range(DAMAGE.innerRadius ** 2, DAMAGE.outerRadius ** 2)), rng.range(DAMAGE.from, DAMAGE.to));
    const radius = rng.range(DAMAGE_SPOT_RADIUS_U.min, DAMAGE_SPOT_RADIUS_U.max);
    const level = rng.chance(0.5) ? 0 : 255;
    const [px0, px1] = [centre.x - radius, centre.x + radius].map((x) => Math.min(width - 1, Math.max(0, Math.floor((x + half) * pxPerU))));
    const [py0, py1] = [centre.y - radius, centre.y + radius].map((y) => Math.min(height - 1, Math.max(0, Math.floor((y + half) * pxPerU))));
    for (let py = py0; py <= py1; py++) {
      const y = (py + 0.5) / pxPerU - half;
      for (let px = px0; px <= px1; px++) {
        const x = (px + 0.5) / pxPerU - half;
        if ((x - centre.x) ** 2 + (y - centre.y) ** 2 <= radius * radius && inDamage(x, y)) data[py * width + px] = level;
      }
    }
  }
  return { width, height, data };
}

/** Codeword bytes with at least one cell inside the damage. */
function damagedCodewordBytes(): number {
  const bytes = new Set<number>();
  for (const flat of CODE01_DATA_CELLS) {
    const byte = cellByteIndex(flat);
    const c = cellCenter(flat);
    if (byte >= 0 && inDamage(c.x, c.y)) bytes.add(byte);
  }
  return bytes.size;
}

// ── The run ────────────────────────────────────────────────────────────────

export interface PocOptions {
  /** Default: the system CSPRNG. */
  entropy?: Entropy;
  /** Default: now. */
  issuedAt?: Date;
  /** Artifacts are written here; omitted, nothing is written. */
  outDir?: string;
  /** Receives the narrative line by line; omitted, the run is silent. */
  log?: (line: string) => void;
  /** ANSI styling of the narrative. */
  color?: boolean;
}

export type TamperId = 'a' | 'b1' | 'b2' | 'c' | 'd' | 'e' | 'f';

export interface TamperOutcome {
  id: TamperId;
  title: string;
  expected: VerificationState;
  /** The 79 bytes encoded into a newly printed code (attacks that re-print). */
  printed?: Uint8Array;
  /** Camera capture and decode (attacks that go through a camera). */
  capture?: Capture;
  verdict: Verdict;
}

export interface PocReport {
  publicKey: Uint8Array;
  issued: IssuedCode;
  model: OrbesCodeModel;
  genuine: { capture: Capture; verdict: Verdict };
  tampers: TamperOutcome[];
  /** Absolute paths of the artifacts written. */
  files: string[];
  /** Genuine code AUTHENTIC and every attack as expected. */
  passed: boolean;
}

/** What the three acts of the run share. */
interface Session {
  say: Narrator;
  artifacts: Artifacts;
  random: Entropy;
  categories: CategoryResolver;
  products: Map<number, ProductRecord>;
}

interface Issuance {
  publicKey: Uint8Array;
  issued: IssuedCode;
  model: OrbesCodeModel;
  /** The printed artifact. */
  svg: string;
  ctx: VerificationContext;
}

interface Authentication {
  source: GrayImage;
  capture: Capture;
  decoded: Decoded;
  verdict: Verdict;
}

const ECC_PARITY = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes;

/** The whole proof of concept. Throws when the genuine code cannot be decoded: there is nothing to attack then. */
export function runPoc(options: PocOptions = {}): PocReport {
  const started = performance.now();
  const categories = staticCategoryResolver([...POC_CATEGORIES]);
  const s: Session = {
    say: new Narrator(options.log ?? (() => {}), options.color ?? false),
    artifacts: new Artifacts(options.outDir),
    random: options.entropy ?? systemEntropy,
    categories,
    products: createRegistry(categories),
  };
  s.say.banner();
  const issuance = issueAct(s, options.issuedAt ?? new Date());
  const genuine = authenticateAct(s, issuance);
  const tampers = attackAct(s, issuance, genuine);
  const passed = genuine.verdict.state === 'AUTHENTIC' && tampers.every((t) => t.verdict.state === t.expected);
  s.say.summary(genuine.verdict, tampers, passed, performance.now() - started, options.outDir);
  return {
    publicKey: issuance.publicKey,
    issued: issuance.issued,
    model: issuance.model,
    genuine: { capture: genuine.capture, verdict: genuine.verdict },
    tampers,
    files: s.artifacts.written,
    passed,
  };
}

/** Act I, steps 01–06: key pair, identity, genome, signed payload, CODE-01, render. */
function issueAct(s: Session, issuedAt: Date): Issuance {
  const { say, artifacts } = s;
  say.part('I', 'ISSUANCE');

  // An Ed25519 secret key is, by definition, 32 uniformly random bytes (RFC 8032 §5.1.5).
  const signer: Signer = { keyId: POC_KEY_ID, seed: s.random(32) };
  const publicKey = publicKeyFromSeed(signer.seed);
  say.step('01', 'KEY PAIR');
  say.row('algorithm', 'Ed25519 · RFC 8032 · generated in memory');
  say.row('key id', String(POC_KEY_ID));
  say.row('public key', ...hexLines(publicKey));
  say.row('private seed', say.dim('32 bytes · never leaves this process'));

  const identity = parseProductId(POC_PRODUCT.productId, s.categories);
  const packed = packIdentity(identity);
  say.step('02', 'PRODUCT IDENTITY');
  say.row('category registry', POC_CATEGORIES.map((c) => `${c.code} = ${c.name.toUpperCase()} (${c.index})`).join(' · '));
  say.row('product id', say.bold(POC_PRODUCT.productId));
  say.row('fields', `year ${identity.year} · category ${identity.categoryIndex} · serial ${identity.serial}`);
  say.row('packed identity', `0x${hex32(packed)}  ${say.dim('yy:7 | category:5 | serial:20')}`);

  const issued = issueCode(identity, signer, { issue: 1, issuedAt, nonce: s.random(4) });
  const { genome, payload, payloadBytes, signature, data } = issued;
  s.products.get(packed)?.codes.set(payload.issue, payloadBytes);
  say.step('03', 'GENOME-01');
  say.row('glyphs', say.bold(glyphHints(genome.glyphs)));
  say.row('ids', ...chunk(genome.ids, 4).map((ids) => ids.join(' · ')));
  say.row('value', `0x${hex32(genome.value)}  ${say.dim('Feistel-8 / SHA-256 permutation of the packed identity')}`);
  say.row('fingerprint', say.bold(genome.fingerprint));

  say.step('04', 'SIGNED PAYLOAD');
  say.row(
    'canonical payload',
    ...fieldMap([
      { hex: toHex(payloadBytes.subarray(0, 1)), label: `code v${payload.codeVersion} · genome v${payload.genomeVersion}` },
      { hex: toHex(payloadBytes.subarray(1, 2)), label: `key id ${payload.keyId}` },
      { hex: toHex(payloadBytes.subarray(2, 6)), label: `identity ${POC_PRODUCT.productId}` },
      { hex: toHex(payloadBytes.subarray(6, 7)), label: `issue ${payload.issue}` },
      { hex: toHex(payloadBytes.subarray(7, 9)), label: `issued day ${payload.issuedDay} = ${isoDay(dateFromIssuedDay(payload.issuedDay))}` },
      { hex: toHex(payloadBytes.subarray(9, 13)), label: 'nonce (random)' },
    ]),
  );
  say.row('size', `${payloadBytes.length} bytes`);
  say.row('signing message', `utf8("${SIGNING_DOMAIN_V1}") ‖ 0x00 ‖ payload = ${signingMessage(payloadBytes).length} bytes`);
  say.row('signature', ...hexLines(signature), say.dim(`${signature.length} bytes · Ed25519 · node:crypto`));
  say.row('code data', `payload ‖ signature ‖ CRC-16 0x${hex16(readU16BE(data, PAYLOAD_V1_LENGTH + SIGNATURE_LENGTH))} = ${data.length} bytes`);

  const model = encodeOrbesCode({ data, genomeGlyphs: genome.glyphs });
  const ink = model.cells.reduce((sum, cell) => sum + cell, 0);
  say.step('05', 'ORBES CODE-01');
  say.row('mask', `${model.mask} of 4 · lowest visual penalty`);
  say.row('format word', `0x${hex16(model.formatWord)} · BCH(15,5) · two copies on orbit 0`);
  say.row('codeword', `${model.codeword.length} bytes = ${CODE01.ecc.dataBytes} data + ${ECC_PARITY} Reed-Solomon parity · GF(256)`);
  say.row(
    'ECC capacity',
    `${Math.floor(ECC_PARITY / 2)} unknown byte errors, or ${ECC_PARITY} erasures (2e + E ≤ ${ECC_PARITY})`,
    say.dim(`${pct(ECC_PARITY, model.codeword.length)} of the codeword is redundancy`),
  );
  say.row('cells', `${CODE01_TOTAL_CELLS} on ${CODE01.data.ringCount} data orbits · ${ink} inked (${pct(ink, CODE01_TOTAL_CELLS)})`);
  say.row('primitives', `${model.primitives.length} vector primitives · seal, moons, polaris halo, arcs, glyphs`);

  const svg = renderOrbesCodeSvg(model, { title: `ORBES CODE-01 · ${POC_PRODUCT.productId}` });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: PREVIEW_WIDTH_PX }, font: { loadSystemFonts: false } }).render().asPng();
  say.step('06', 'RENDER');
  say.row('vector', `${artifacts.file('orbes-code.svg', svg)} · ${kb(svg.length)} · 50 × 50 u with quiet zone`);
  say.row('raster', `${artifacts.file('orbes-code.png', png)} · ${PREVIEW_WIDTH_PX} × ${PREVIEW_WIDTH_PX} px · resvg`);
  say.row('genome', `${artifacts.file('genome.svg', renderGenomeSvg(genome, { layout: 'orbit' }))} · the 8 glyphs on their orbit`);

  return { publicKey, issued, model, svg, ctx: { keys: new Map([[POC_KEY_ID, publicKey]]), products: s.products } };
}

/** Act II, steps 07–10: camera, decode, verify, registry. */
function authenticateAct(s: Session, iss: Issuance): Authentication {
  const { say, artifacts } = s;
  say.part('II', 'AUTHENTICATION');

  const source = rasterise(iss.svg);
  const capture = photographAndDecode(source, 'genuine');
  say.step('07', 'CAMERA SCAN');
  say.row('camera', `typicalPhone · ${capture.frame.width} × ${capture.frame.height} px · code ≈ ${PHONE.codeWidthPx} px wide`);
  const rotation = PHONE_POSE.rotationDeg + BURST_DRIFT_DEG * (capture.frames - 1);
  say.row('pose', `rotated ${rotation}° · tilted ${PHONE_POSE.tiltXDeg}° and ${PHONE_POSE.tiltYDeg}° · barrel lens`);
  say.row('optics & sensor', `defocus σ ${PHONE.blurSigma} px · read + shot noise · JPEG ${PHONE.jpegQuality} · desk clutter, paper`);
  say.row('frame', `${artifacts.gray('capture.png', capture.frame)} · simulated in ${ms(capture.captureMs)}`);

  const decoded = capture.result;
  if (!decoded.ok) throw new Error(`the genuine code did not decode in ${capture.frames} frames: ${decoded.reason} ${decoded.detail ?? ''}`);
  const q = decoded.quality;
  say.step('08', 'DECODE');
  say.row('decoder', `${say.bold('DECODED')} in ${ms(q.elapsedMs)} · frame ${capture.frames} of ${BURST_FRAMES}`);
  say.row('Reed-Solomon', `${q.rsErrors} byte errors and ${q.rsErasures} erasures corrected · CRC-16 valid`);
  say.row('geometry', `mask ${decoded.mask} · north at ${q.orientation.toFixed(1)}° · module ${q.moduleSizePx.toFixed(1)} px · contrast ${q.contrast.toFixed(2)}`);
  say.row('genome read', ...genomeReadLines(decoded.genome));
  const exact = equalBytes(decoded.data, iss.issued.data);
  say.row('code data', `${decoded.data.length} bytes · ${exact ? 'identical to the issued bytes' : 'DIFFERENT from the issued bytes'}`);

  const read = unframeCodeData(decoded.data);
  const t0 = performance.now();
  const signatureValid = verifyCodeSignature(iss.publicKey, read.payloadBytes, read.signature);
  const verifyMs = performance.now() - t0;
  const opensslValid = verifyEd25519Node(iss.publicKey, signingMessage(read.payloadBytes), read.signature);
  const expected = computeGenome(packIdentity(read.payload.identity), read.payload.genomeVersion);
  const genome = compareGenome(expected.glyphs, decoded.genome);
  say.step('09', 'VERIFY');
  say.row('signature', `${say.validity(signatureValid)} · key ${read.payload.keyId} · @noble/curves, isomorphic · ${ms(verifyMs)}`);
  say.row('cross-check', `${say.validity(opensslValid)} · node:crypto (OpenSSL), the server's verifier`);
  say.row('signed identity', `${claim(s, read.payload)} → genome ${expected.fingerprint}`);
  say.row(
    'genome',
    `expected ${glyphHints(expected.glyphs)}   read ${glyphHints(decoded.genome?.glyphs ?? [])}`,
    `${say.bold(genome.check)} · ${genome.read - genome.mismatches} of ${genome.read} confident glyphs agree`,
  );

  const verdict = decideVerification(decoded, iss.ctx);
  say.step('10', 'REGISTRY');
  say.row('lookup', `${claim(s, read.payload)} · issue ${read.payload.issue} · ${verdict.product ? 'registered, payload on record' : verdict.reason}`);
  say.card(verdict);

  return { source, capture, decoded, verdict };
}

/** Act III: every attack must be refused (INVALID_SIGNATURE, MALFORMED_CODE or SUSPICIOUS_ACTIVITY). */
function attackAct(s: Session, iss: Issuance, genuine: Authentication): TamperOutcome[] {
  const { say, artifacts } = s;
  say.part('III', 'ADVERSARIAL TRIALS');
  const outcomes: TamperOutcome[] = [];
  const settle = (outcome: TamperOutcome): void => {
    outcomes.push(outcome);
    say.outcome(outcome);
  };
  // The byte-level attacks edit what the genuine scan read, and resubmit it with the genuine genome reading.
  const read = genuine.decoded;
  const submit = (data: Uint8Array): Verdict => decideVerification({ ok: true, data, genome: read.genome }, iss.ctx);
  const decoyIdentity = parseProductId(POC_DECOY.productId, s.categories);
  const decoyGenome = computeGenome(packIdentity(decoyIdentity), GENOME_VERSION);
  const sig0 = PAYLOAD_V1_LENGTH;

  const relabelled = forge(read.data, (payload) => writeU32BE(payload, 2, packIdentity(decoyIdentity)));
  say.trial('a', 'PRODUCT ID REWRITTEN IN THE DECODED PAYLOAD');
  say.row('edit', `identity ${POC_PRODUCT.productId} → ${POC_DECOY.productId}, a registered ${POC_DECOY.model}`);
  say.row('kept', say.dim('the genuine signature · CRC-16 recomputed, as any forger would'));
  settle({ id: 'a', title: 'product id rewritten', expected: 'INVALID_SIGNATURE', verdict: submit(relabelled) });

  const versioned = forge(read.data, (payload) => {
    payload[0] = (payload[0] & 0xf0) | (GENOME_VERSION + 1);
  });
  say.trial('b1', 'GENOME VERSION CHANGED IN THE SIGNED PAYLOAD');
  say.row('edit', `payload byte 0: 0x${byteHex(read.data, 0)} → 0x${byteHex(versioned, 0)} · genome v${GENOME_VERSION} → v${GENOME_VERSION + 1}`);
  settle({ id: 'b1', title: 'genome version changed', expected: 'INVALID_SIGNATURE', verdict: submit(versioned) });

  const reprintedModel = encodeOrbesCode({ data: iss.issued.data, genomeGlyphs: decoyGenome.glyphs });
  const reprinted = photographAndDecode(rasterise(renderOrbesCodeSvg(reprintedModel)), 'reprinted-genome');
  const reprintedVerdict = decideVerification(reprinted.result, iss.ctx);
  say.trial('b2', 'GENUINE DATA REPRINTED WITH ANOTHER GENOME');
  say.row('print', `the genuine 79 bytes · glyphs of ${POC_DECOY.productId}: ${glyphHints(decoyGenome.glyphs)}`);
  say.capture(artifacts.gray('tamper-b2-capture.png', reprinted.frame), reprinted);
  if (reprintedVerdict.genome) {
    const g = reprintedVerdict.genome;
    say.row('genome', `${g.mismatches} of ${g.read} glyphs differ from ${g.expected.fingerprint}, the signed identity's genome`);
  }
  settle({
    id: 'b2',
    title: 'printed glyphs replaced',
    expected: 'SUSPICIOUS_ACTIVITY',
    printed: iss.issued.data,
    capture: reprinted,
    verdict: reprintedVerdict,
  });

  const resigned = forge(read.data, (_payload, signature) => {
    signature[0] ^= 0x01;
  });
  say.trial('c', 'ONE SIGNATURE BYTE MODIFIED');
  say.row('edit', `signature byte 0: 0x${byteHex(read.data, sig0)} → 0x${byteHex(resigned, sig0)} · CRC-16 recomputed`);
  settle({ id: 'c', title: 'signature byte modified', expected: 'INVALID_SIGNATURE', verdict: submit(resigned) });

  // The decisive one: a forgery that is a perfectly well-formed, printable ORBES CODE.
  const forgedModel = encodeOrbesCode({ data: relabelled, genomeGlyphs: decoyGenome.glyphs });
  const forgedSvg = renderOrbesCodeSvg(forgedModel, { title: `ORBES CODE-01 · ${POC_DECOY.productId}` });
  const forged = photographAndDecode(rasterise(forgedSvg), 'forged-code');
  say.trial('d', 'FORGED CODE: TAMPERED PAYLOAD RE-ENCODED, PRINTED, SCANNED');
  say.row('forgery', `payload of (a): claims ${POC_DECOY.productId} · genuine signature · valid CRC-16`);
  say.row('genome', `${decoyGenome.fingerprint} ${glyphHints(decoyGenome.glyphs)} · printed to match the claim`);
  say.row('print', `${artifacts.file('tamper-d-forged-code.svg', forgedSvg)} · mask ${forgedModel.mask} · a well-formed CODE-01`);
  say.capture(artifacts.gray('tamper-d-capture.png', forged.frame), forged);
  if (forged.result.ok) say.row('read as', `${claimOf(s, forged.result.data)} · format, Reed-Solomon, CRC-16, payload: all valid`);
  settle({
    id: 'd',
    title: 'forged code re-printed',
    expected: 'INVALID_SIGNATURE',
    printed: relabelled,
    capture: forged,
    verdict: decideVerification(forged.result, iss.ctx),
  });

  const fake = randomWellFormedFrame(s.random, POC_KEY_ID);
  const fakeModel = encodeOrbesCode({ data: fake.data, genomeGlyphs: computeGenome(packIdentity(fake.payload.identity), GENOME_VERSION).glyphs });
  const fakeCapture = photographAndDecode(rasterise(renderOrbesCodeSvg(fakeModel)), 'random-code');
  say.trial('e', 'RANDOM FAKE CODE');
  say.row('bytes', `draw #${fake.draws}: the first 77 random bytes that parse as a payload naming key ${POC_KEY_ID}`);
  say.row('claims', `${claim(s, fake.payload)} · valid CRC-16 · genome printed to match`);
  say.capture(artifacts.gray('tamper-e-capture.png', fakeCapture.frame), fakeCapture);
  settle({
    id: 'e',
    title: 'random fake code',
    expected: 'INVALID_SIGNATURE',
    printed: fake.data,
    capture: fakeCapture,
    verdict: decideVerification(fakeCapture.result, iss.ctx),
  });

  const damaged = photographAndDecode(scuff(genuine.source, 'orbes-poc/damage'), 'corrupted');
  say.trial('f', 'CORRUPTED IMAGE BEYOND ECC CAPACITY');
  say.row('damage', `ink smears and abrasion over 240° of data orbits 1–12 · ${damagedCodewordBytes()} of ${CODE01.ecc.totalBytes} codeword bytes hit`);
  say.row('capacity', say.dim(`Reed-Solomon repairs at most ${Math.floor(ECC_PARITY / 2)} unknown or ${ECC_PARITY} located bad bytes`));
  say.capture(artifacts.gray('tamper-f-capture.png', damaged.frame), damaged);
  settle({
    id: 'f',
    title: 'image corrupted beyond ECC',
    expected: 'MALFORMED_CODE',
    capture: damaged,
    verdict: decideVerification(damaged.result, iss.ctx),
  });

  return outcomes;
}

function claim(s: Session, payload: CodePayloadV1): string {
  return describeIdentity(payload.identity, s.categories);
}

function claimOf(s: Session, data: Uint8Array): string {
  const payload = tryDecodePayload(data.subarray(0, PAYLOAD_V1_LENGTH));
  return payload ? claim(s, payload) : 'an unparseable payload';
}

// ── Artifacts ──────────────────────────────────────────────────────────────

class Artifacts {
  readonly written: string[] = [];

  constructor(private readonly dir: string | undefined) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  /** Writes `name` and returns its display path (the bare name when the run writes no files). */
  file(name: string, content: string | Uint8Array): string {
    return this.save(name, (path) => writeFileSync(path, content));
  }

  gray(name: string, img: GrayImage): string {
    return this.save(name, (path) => writePng(path, img));
  }

  private save(name: string, write: (path: string) => void): string {
    if (!this.dir) return name;
    const path = join(this.dir, name);
    write(path);
    this.written.push(path);
    return relative(process.cwd(), path);
  }
}

// ── Narrative ──────────────────────────────────────────────────────────────

const INDENT = '   ';
const LABEL_WIDTH = 20;
const SUMMARY_LABEL_WIDTH = 34;
const RULE_WIDTH = 74;

const VERDICT_TEXT: Record<VerificationState, string> = {
  AUTHENTIC: 'AUTHENTIC',
  UNKNOWN: 'UNVERIFIED · UNKNOWN PRODUCT',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS · SUSPICIOUS ACTIVITY',
  INVALID_SIGNATURE: 'INVALID · INVALID SIGNATURE',
  MALFORMED_CODE: 'INVALID · MALFORMED CODE',
};

/** Terminal narrative in the ORBES register: monochrome, tracked capitals, hairline rules. */
class Narrator {
  constructor(
    private readonly emit: (line: string) => void,
    private readonly color: boolean,
  ) {}

  private sgr(code: string, text: string): string {
    return this.color ? `\x1b[${code}m${text}\x1b[0m` : text;
  }

  bold(text: string): string {
    return this.sgr('1', text);
  }

  dim(text: string): string {
    return this.sgr('2', text);
  }

  mark(ok: boolean): string {
    return ok ? this.sgr('32', '✓') : this.sgr('31', '✗');
  }

  validity(valid: boolean): string {
    return `${this.bold(valid ? 'VALID' : 'INVALID')} ${this.mark(valid)}`;
  }

  private line(text = ''): void {
    this.emit(text && INDENT + text);
  }

  banner(): void {
    this.line();
    this.line(this.bold('O   R   B   E   S'));
    this.line(`${this.bold('G E N O M E   C O D E')}${this.dim('   ·   PROOF OF CONCEPT')}`);
    this.line(this.dim('CODE-01 · GENOME-01 · Ed25519 · Reed-Solomon RS(164,79) · PARIS, 2026'));
  }

  part(numeral: string, title: string): void {
    this.line();
    this.line(this.dim('─'.repeat(RULE_WIDTH)));
    this.line(this.bold(`${numeral}.  ${title.split('').join(' ')}`));
    this.line(this.dim('─'.repeat(RULE_WIDTH)));
  }

  step(index: string, title: string): void {
    this.line();
    this.line(`${this.dim(index)}  ${this.bold(title)}`);
  }

  trial(id: string, title: string): void {
    this.line();
    this.line(`${this.dim(`(${id})`.padEnd(4))}  ${this.bold(title)}`);
  }

  /** `label ........ value`, further values aligned underneath. */
  row(label: string, ...values: string[]): void {
    this.rowAt(LABEL_WIDTH, label, values);
  }

  private rowAt(width: number, label: string, values: readonly string[]): void {
    const [first = '', ...rest] = values;
    this.line(`    ${label} ${this.dim('.'.repeat(Math.max(2, width - label.length)))} ${first}`);
    for (const value of rest) this.line(`${' '.repeat(width + 6)}${value}`);
  }

  capture(path: string, c: Capture): void {
    const r = c.result;
    this.row('capture', path);
    this.row(
      'decoder',
      r.ok
        ? `decoded in ${ms(r.quality.elapsedMs)} · ${r.quality.rsErrors} RS errors · frame ${c.frames} of ${BURST_FRAMES}`
        : `no decode in ${c.frames} frames · ${r.reason}${r.detail ? ` · ${r.detail}` : ''}`,
    );
  }

  outcome(t: TamperOutcome): void {
    const ok = t.verdict.state === t.expected;
    this.row('verdict', `${this.bold(VERDICT_TEXT[t.verdict.state])} ${this.dim(`(${t.verdict.reason})`)}  ${this.mark(ok)}${ok ? '' : `  expected ${t.expected}`}`);
  }

  /** The AUTHENTIC result card, or the verdict line when the genuine code fails. */
  card(v: Verdict): void {
    if (!v.product) {
      this.row('verdict', `${this.bold(VERDICT_TEXT[v.state])} ${this.dim(`(${v.reason})`)}  ${this.mark(false)}`);
      return;
    }
    const p = v.product;
    const lines = [
      'A U T H E N T I C',
      '',
      p.model,
      `${p.category} · ${p.material} · CREATED ${p.createdYear}`,
      '',
      `${p.productId} · ${p.genomeFingerprint} · ISSUE ${p.issue} · KEY ${p.keyId}`,
      `ISSUED ${p.issuedOn} · SIGNATURE VALID · GENOME ${v.genome?.check ?? 'NOT_READ'}`,
    ];
    const width = Math.max(...lines.map((l) => l.length)) + 4;
    this.line();
    this.line(`    ┌${'─'.repeat(width)}┐`);
    lines.forEach((text, i) => {
      const body = `  ${text}`.padEnd(width);
      this.line(`    │${i === 0 || i === 2 ? this.bold(body) : body}│`);
    });
    this.line(`    └${'─'.repeat(width)}┘`);
  }

  summary(genuine: Verdict, tampers: readonly TamperOutcome[], passed: boolean, elapsedMs: number, outDir: string | undefined): void {
    this.part('IV', 'RESULT');
    this.line();
    this.rowAt(SUMMARY_LABEL_WIDTH, 'genuine code', [`${this.bold(VERDICT_TEXT[genuine.state])}  ${this.mark(genuine.state === 'AUTHENTIC')}`]);
    for (const t of tampers) {
      this.rowAt(SUMMARY_LABEL_WIDTH, `${`(${t.id})`.padEnd(5)}${t.title}`, [`${VERDICT_TEXT[t.verdict.state]}  ${this.mark(t.verdict.state === t.expected)}`]);
    }
    const met = tampers.filter((t) => t.verdict.state === t.expected).length + (genuine.state === 'AUTHENTIC' ? 1 : 0);
    this.line();
    const headline = this.bold(`PROOF OF CONCEPT ${passed ? 'PASSED' : 'FAILED'}`);
    this.line(`${headline} · ${met} of ${tampers.length + 1} outcomes as expected · ${(elapsedMs / 1000).toFixed(1)} s`);
    if (outDir) this.line(this.dim(`artifacts in ${relative(process.cwd(), outDir) || '.'}`));
    this.line();
  }
}

function genomeReadLines(reading: GenomeReading | null): string[] {
  if (!reading) return ['not read'];
  return [glyphHints(reading.glyphs), `confidence ${reading.confidence.map((c) => c.toFixed(2)).join(' ')}`];
}

/** Text form of an identity, even one whose category the registry does not know (random codes). */
function describeIdentity(identity: ProductIdentity, categories: CategoryResolver): string {
  try {
    return formatProductId(identity, categories);
  } catch (e) {
    if (!(e instanceof IdentityError)) throw e;
    return `O${String(identity.year - 2000).padStart(2, '0')}-[category ${identity.categoryIndex}]-${String(identity.serial).padStart(5, '0')}`;
  }
}

function glyphHints(glyphs: readonly (number | null)[]): string {
  const vocabulary = genomeVocabulary(GENOME_VERSION);
  return glyphs.map((g) => (g === null ? '?' : vocabulary[g].hint)).join(' ');
}

/**
 * Hex fields with a labelled branch under each one:
 *   11 01 341000b8
 *   │  │  └ identity
 *   │  └ key id
 *   └ version
 */
function fieldMap(fields: readonly { hex: string; label: string }[]): string[] {
  const starts: number[] = [];
  let column = 0;
  for (const f of fields) {
    starts.push(column);
    column += f.hex.length + 1;
  }
  const lines = [fields.map((f) => f.hex).join(' ')];
  for (let k = fields.length - 1; k >= 0; k--) {
    let line = '';
    for (let j = 0; j < k; j++) line += '│'.padEnd(starts[j + 1] - starts[j]);
    lines.push(`${line}└ ${fields[k].label}`);
  }
  return lines;
}

/** Hex in groups of 8 digits, 4 groups per line. */
function hexLines(bytes: Uint8Array): string[] {
  return chunk(toHex(bytes).match(/.{1,8}/g) ?? [], 4).map((groups) => groups.join(' '));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

const byteHex = (bytes: Uint8Array, i: number): string => toHex(bytes.subarray(i, i + 1));
const hex32 = (v: number): string => v.toString(16).toUpperCase().padStart(8, '0');
const hex16 = (v: number): string => v.toString(16).toUpperCase().padStart(4, '0');
const ms = (v: number): string => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(1)} %`;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

// ── CLI ────────────────────────────────────────────────────────────────────

const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../out/poc');
/** Issue date of a --seed run, so that every byte of it is reproducible. */
const SEEDED_ISSUE_DATE = new Date(Date.UTC(2026, 0, 15));

function main(): void {
  const { values } = parseArgs({ options: { seed: { type: 'string' }, out: { type: 'string' } } });
  const seed = values.seed === undefined ? undefined : Number(values.seed);
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) {
    console.error('poc: --seed must be an integer in 0..4294967295');
    process.exitCode = 2;
    return;
  }
  try {
    const report = runPoc({
      entropy: seed === undefined ? systemEntropy : demoEntropy(seed),
      issuedAt: seed === undefined ? new Date() : SEEDED_ISSUE_DATE,
      outDir: resolve(values.out ?? DEFAULT_OUT_DIR),
      log: (line) => console.log(line),
      color: process.stdout.isTTY === true && !('NO_COLOR' in process.env),
    });
    process.exitCode = report.passed ? 0 : 1;
  } catch (e) {
    console.error(`poc: aborted: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
