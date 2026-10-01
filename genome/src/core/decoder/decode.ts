/**
 * ORBES CODE-01 decoder: luma frame → verified-by-ECC code data.
 *
 * Pipeline (each stage is its own module):
 *
 *  1. Detection image. Frames above ~2.5 MP are area-downscaled by an integer
 *     factor for detection only; alignment and sampling always use full
 *     resolution. A summed-area table feeds every box statistic.
 *  2. Seal (finder.ts). Adaptive mean thresholding at two window sizes
 *     (1/8 and 1/16 of the short side); rows are scanned for the seal's
 *     rotation-invariant 1:1:4:1:1 run pattern, hits are confirmed along the
 *     column and diagonals and clustered; rays cast on the gray image give
 *     sub-pixel ring and core edges, fitted with direct least-squares
 *     ellipses → centre + affine frame (up to rotation). Light-on-dark codes
 *     are handled by running the whole pipeline on the negative.
 *  3. Moons (moons.ts). Centre-surround box filter in the annulus where the
 *     moons must be, sub-pixel darkness-weighted centroids, best set of four
 *     (or three) peaks 90° apart. The polaris halo darkness is kept as an
 *     orientation hint only.
 *  4. Homography (homography.ts). Normalised DLT from seal centre + moons.
 *     When all four moons are present the five-point fit and the four
 *     leave-one-moon-out fits compete on cell contrast, so one damaged moon
 *     cannot spoil the frame.
 *  5. Refinement (refine.ts). Coordinate descent on the control points'
 *     image positions maximising the contrast of cell samples (corrects
 *     centroid bias, ellipse-centre perspective offset, mild distortion);
 *     if decoding then fails, a per-sector offset field is added on top for
 *     curved or lens-distorted surfaces and decoding is retried.
 *  6. Sampling (sampler.ts). Every cell is read with a 3 × 3 footprint and
 *     classified against a local 2-means threshold; confidence reflects both
 *     the margin to the threshold and the health of the neighbourhood.
 *  7. Orientation, format and ECC. A single sampling serves all eight
 *     dihedral hypotheses (rotation by 90° = index shift per ring, mirror =
 *     index reversal, since every ring has a multiple of four cells and the
 *     moon square is symmetric). Hypotheses are ranked by the distance of the
 *     two format copies to the nearest BCH(15,5) word (polaris hint breaks
 *     ties), then decoded with Reed-Solomon RS(164,79), errors only first,
 *     then with progressively more erasures on the least confident bytes.
 *     When no hypothesis yields a clean format read, all four masks are
 *     tried. CRC-16 and strict payload parsing (unframeCodeData) reject
 *     miscorrections; a failure moves on to the next hypothesis.
 *  8. Genome (genome-reader.ts), optional and never fatal.
 *
 * The decoder never throws: malformed input, numerical failures and
 * unexpected internal errors all become an ok:false result.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01, CODE01_DATA_CELLS, CODE01_FORMAT_CELLS, CODE01_MASK_COUNT, CODE01_MOONS, CODE01_RINGS, CODE01_TOTAL_CELLS, parseFormatInfoValue } from '../code/profile.js';
import { decodeCellsToCodeword } from '../code/layout.js';
import { bchFormatEncode, rsDecode } from '../ecc/index.js';
import type { Point } from '../geometry.js';
import { PayloadError, unframeCodeData } from '../payload.js';
import { binarize } from './binarize.js';
import { findSealHits, measureSeal, mergeClusters, type SealCandidate, type SealCluster } from './finder.js';
import { readGenome } from './genome-reader.js';
import { applyH, homographyFromPoints, jacobianH, multiplyH, type Homography } from './homography.js';
import { downscaleImage, invertImage, isUsableImage, type GrayImage } from './image.js';
import { integralImage, type IntegralImage } from './integral.js';
import { findMoons, invert2, moonLevels, refineCentroid, type Mat2, type MoonSet } from './moons.js';
import { alignmentScore, refineControlPoints, refineOffsetField } from './refine.js';
import { CELL_COUNT, classifyCells, quietZoneScore, sampleCells, type CellClassification } from './sampler.js';

export interface DecodeOptions {
  /** Also look for light ink on a dark substrate (default true). */
  tryInverted?: boolean;
  /** Also accept mirror images, e.g. a code read through glass (default false). */
  tryMirrored?: boolean;
  /** Read the GENOME glyphs (default true). */
  readGenome?: boolean;
  /** Seal candidates examined per polarity (default 4). */
  maxSealCandidates?: number;
}

export type DecodeFailure = 'NO_SEAL' | 'NO_MOONS' | 'FORMAT' | 'ECC' | 'CRC' | 'PAYLOAD';

export type DecodeResult =
  | {
      ok: true;
      data: Uint8Array;
      payloadBytes: Uint8Array;
      signature: Uint8Array;
      codeVersion: number;
      mask: number;
      genome: { glyphs: (number | null)[]; confidence: number[] } | null;
      quality: {
        rsErrors: number;
        rsErasures: number;
        contrast: number;
        moduleSizePx: number;
        inverted: boolean;
        mirrored: boolean;
        orientation: number;
        elapsedMs: number;
      };
      geometry: { center: { x: number; y: number }; moons: { x: number; y: number }[]; homography: number[] };
    }
  | { ok: false; reason: DecodeFailure; detail?: string; elapsedMs: number };

// ── Static tables ──────────────────────────────────────────────────────────

const NSYM = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes;
const CODE_VERSION = 1;
/** Largest detection image (pixels) before downscaling. */
const MAX_DETECTION_PIXELS = 2_500_000;
/** Smallest frame side worth examining: a seal needs ≥ 8 u × 1.2 px. */
const MIN_SIDE = 12;
/** Seal clusters measured per polarity before ranking. */
const MAX_CLUSTERS = 12;
/** Erasure schedule on the least confident bytes (2·errors + erasures ≤ 85). */
const ERASURE_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80];
/** Combined distance (of 30 bits) up to which a format read is trusted (the 30-bit code corrects 6). */
const FORMAT_TRUST = 6;

const FORMAT_WORDS = Array.from({ length: 32 }, (_, v) => bchFormatEncode(v));

/** perm[g][j]: frame-0 cell carrying true cell j under dihedral hypothesis g (rotation g & 3, mirror g >> 2). */
const DIHEDRAL_PERMS: Int16Array[] = Array.from({ length: 8 }, (_, g) => {
  const k = g & 3;
  const mirror = g >> 2 === 1;
  const perm = new Int16Array(CODE01_TOTAL_CELLS);
  for (const ring of CODE01_RINGS) {
    const n = ring.cells;
    for (let c = 0; c < n; c++) {
      const base = mirror ? n - 1 - c : c;
      perm[ring.offset + c] = ring.offset + ((base + (k * n) / 4) % n);
    }
  }
  return perm;
});

/** g as a code-plane homography: true code point → frame-0 code point (rotate k·90° clockwise after optional mirror). */
function dihedralMatrix(g: number): Homography {
  const k = g & 3;
  const cos = [1, 0, -1, 0][k];
  const sin = [0, 1, 0, -1][k];
  const m = g >> 2 === 1 ? -1 : 1;
  return [cos * m, -sin, 0, sin * m, cos, 0, 0, 0, 1];
}

/** Frame-0 moon slot holding true moon i under hypothesis g. */
function moonSlot(g: number, i: number): number {
  const k = g & 3;
  return g >> 2 === 1 ? (((1 - i + k) % 4) + 4) % 4 : (i + k) % 4;
}

/** The eight true cells of each codeword byte. */
const BYTE_CELLS: Int16Array[] = Array.from({ length: CODE01.ecc.totalBytes }, (_, b) =>
  Int16Array.from({ length: 8 }, (_, j) => CODE01_DATA_CELLS[8 * b + j]),
);

function popcount(x: number): number {
  let c = 0;
  for (let v = x; v !== 0; v &= v - 1) c++;
  return c;
}

const now: () => number =
  typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : () => Date.now();

// ── Failure bookkeeping ────────────────────────────────────────────────────

const FAILURE_RANK: Record<DecodeFailure, number> = { NO_SEAL: 0, NO_MOONS: 1, FORMAT: 2, ECC: 3, CRC: 4, PAYLOAD: 5 };

class Failure {
  reason: DecodeFailure = 'NO_SEAL';
  detail?: string;
  note(reason: DecodeFailure, detail?: string): void {
    if (FAILURE_RANK[reason] >= FAILURE_RANK[this.reason]) {
      this.reason = reason;
      this.detail = detail;
    }
  }
}

// ── Stage: seal candidates ─────────────────────────────────────────────────

interface Detection {
  /** Detection image (possibly downscaled) and its summed-area table. */
  image: GrayImage;
  integral: IntegralImage;
  /** Full-resolution pixels per detection pixel. */
  factor: number;
}

function detectionImage(img: GrayImage): Detection {
  const pixels = img.width * img.height;
  const factor = pixels > MAX_DETECTION_PIXELS ? Math.ceil(Math.sqrt(pixels / MAX_DETECTION_PIXELS)) : 1;
  const image = factor > 1 ? downscaleImage(img, factor) : img;
  return { image, integral: integralImage(image), factor };
}

/**
 * Seal candidates in passes of increasing cost: rows of the coarse-window
 * binarisation, rows of the fine-window one, then columns of both (which
 * catch seals whose left or right side is damaged). Each pass yields only
 * seals not seen before, best first, so a frame whose code is found early
 * never pays for the later passes.
 */
function* sealCandidates(det: Detection, max: number): Generator<SealCandidate> {
  const { image } = det;
  const side = Math.min(image.width, image.height);
  const windows = [...new Set([Math.max(8, Math.round(side / 8)), Math.max(6, Math.round(side / 16))])];
  const binaries: Uint8Array[] = [];
  const seen: SealCandidate[] = [];
  const passes: (() => SealCluster[][])[] = [
    ...windows.map((w) => () => {
      const bin = binarize(image, det.integral, w);
      binaries.push(bin);
      return [findSealHits(bin, image.width, image.height, 'rows')];
    }),
    () => binaries.map((bin) => findSealHits(bin, image.width, image.height, 'columns')),
  ];
  for (const pass of passes) {
    const fresh: SealCandidate[] = [];
    for (const cluster of mergeClusters(pass()).slice(0, MAX_CLUSTERS)) {
      if (seen.some((s) => Math.hypot(s.center.x - cluster.x, s.center.y - cluster.y) < 2 * s.unit)) continue;
      const seal = measureSeal(image, cluster);
      if (seal && !seen.some((s) => Math.hypot(s.center.x - seal.center.x, s.center.y - seal.center.y) < 2 * s.unit)) fresh.push(seal);
    }
    fresh.sort((a, b) => b.score - a.score);
    for (const seal of fresh.slice(0, max)) {
      seen.push(seal);
      yield seal;
    }
  }
}

// ── Stage: alignment ───────────────────────────────────────────────────────

interface Alignment {
  homography: Homography;
  /** Frame-0 code points and their image positions used for the fit. */
  codePoints: Point[];
  imagePoints: Point[];
  values: Float64Array;
  cls: CellClassification;
  /** Per-cell image shift from the offset field, when one was fitted. */
  shift: Float64Array | null;
}

function scale(p: Point, f: number): Point {
  return { x: p.x * f, y: p.y * f };
}

/** Minimum fraction of quiet-zone probes reading as substrate for a frame to be worth refining. */
const MIN_QUIET_SCORE = 0.7;

/**
 * Initial homography from seal + moons. Moon centroids are first re-measured
 * at full resolution with their own local scale (the seal's affine frame is
 * only exact at the centre; under perspective a moon's window would
 * otherwise clip it or catch the polaris halo). With four moons the full fit
 * and each leave-one-out fit compete on cell contrast, so one damaged moon
 * cannot spoil the frame.
 */
/**
 * Homography from the seal centre and the moons (frame-0 code points ↔ image
 * points). With three moons the centre is collinear with the opposite pair,
 * which leaves one degree of freedom open, so the seal itself supplies four
 * more correspondences: points of its ring (r = 3.5 u) placed through the
 * seal's affine frame, rotated to agree with the moons (2-D Procrustes).
 */
function fitFrame(center: Point, sealAffine: Mat2, pairs: readonly [Point, Point][]): Homography | null {
  const code = [{ x: 0, y: 0 }, ...pairs.map(([c]) => c)];
  const image = [center, ...pairs.map(([, p]) => p)];
  if (pairs.length < 4) {
    const inv = invert2(sealAffine);
    if (!inv) return null;
    // Rotation θ best mapping code moon vectors onto the seal-rectified image vectors.
    let dot = 0;
    let cross = 0;
    for (const [c, p] of pairs) {
      const qx = inv[0] * (p.x - center.x) + inv[1] * (p.y - center.y);
      const qy = inv[2] * (p.x - center.x) + inv[3] * (p.y - center.y);
      dot += c.x * qx + c.y * qy;
      cross += c.x * qy - c.y * qx;
    }
    const theta = Math.atan2(cross, dot);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const R = 3.5;
    for (const [ux, uy] of [
      [R, 0],
      [0, R],
      [-R, 0],
      [0, -R],
    ]) {
      const rx = cos * ux - sin * uy;
      const ry = sin * ux + cos * uy;
      code.push({ x: ux, y: uy });
      image.push({ x: center.x + sealAffine[0] * rx + sealAffine[1] * ry, y: center.y + sealAffine[2] * rx + sealAffine[3] * ry });
    }
  }
  return homographyFromPoints(code, image);
}

/**
 * Initial homography from seal + moons. Moon centroids are first re-measured
 * at full resolution with their own local scale (the seal's affine frame is
 * only exact at the centre; under perspective a moon's window would
 * otherwise clip it or catch the polaris halo). With four moons the full fit
 * and each leave-one-out fit compete on cell contrast, so one damaged moon
 * cannot spoil the frame.
 */
function initialAlignment(img: GrayImage, seal: SealCandidate, moons: MoonSet, factor: number): Alignment | null {
  const center = scale(seal.center, factor);
  const sealAffine = seal.affine.map((v) => v * factor) as Mat2;
  let pairs: [Point, Point][] = [];
  moons.slots.forEach((m, k) => {
    if (m) pairs.push([CODE01_MOONS[k], scale(m, factor)]);
  });
  const rough = fitFrame(center, sealAffine, pairs);
  if (!rough) return null;
  pairs = pairs.map(([c, p]) => {
    const local = jacobianH(rough, c.x, c.y);
    const { ink, paper } = moonLevels(img, local, p);
    return [c, refineCentroid(img, local, p, ink, paper)];
  });

  const subsets: [Point, Point][][] = [pairs];
  if (pairs.length === 4) for (let skip = 0; skip < 4; skip++) subsets.push(pairs.filter((_, i) => i !== skip));
  let best: Alignment | null = null;
  let bestScore = -Infinity;
  for (const subset of subsets) {
    const h = fitFrame(center, sealAffine, subset);
    if (!h) continue;
    const values = sampleCells(img, h, false);
    const cls = classifyCells(values);
    const score = alignmentScore(values, cls);
    if (score > bestScore) {
      bestScore = score;
      // Refinement moves every control point, so a moon left out by the
      // winning subset re-enters at its predicted position.
      best = {
        homography: h,
        codePoints: [{ x: 0, y: 0 }, ...CODE01_MOONS],
        imagePoints: [center, ...CODE01_MOONS.map((c) => applyH(h, c.x, c.y))],
        values,
        cls,
        shift: null,
      };
    }
  }
  return best;
}

function refineAlignment(img: GrayImage, a: Alignment, unitPx: number): Alignment {
  const refined = refineControlPoints(img, a.codePoints, a.imagePoints, unitPx, a.cls);
  if (!refined) return a;
  const values = sampleCells(img, refined.homography, true);
  return { ...a, homography: refined.homography, imagePoints: refined.points, values, cls: classifyCells(values) };
}

function withOffsetField(img: GrayImage, a: Alignment, unitPx: number): Alignment {
  const { shift } = refineOffsetField(img, a.homography, unitPx, a.cls);
  const values = sampleCells(img, a.homography, true, shift);
  return { ...a, values, cls: classifyCells(values), shift };
}

// ── Stage: format, ECC, payload ────────────────────────────────────────────

interface Hypothesis {
  g: number;
  mask: number;
  formatDistance: number;
  hint: number;
}

interface CodeRead {
  g: number;
  mask: number;
  data: Uint8Array;
  payloadBytes: Uint8Array;
  signature: Uint8Array;
  errors: number;
  erasures: number;
}

/** Format distance of the best version-1 word for each dihedral hypothesis. */
function formatHypotheses(cls: CellClassification, moons: MoonSet, mirrored: boolean, failure: Failure): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (let g = 0; g < (mirrored ? 8 : 4); g++) {
    const perm = DIHEDRAL_PERMS[g];
    const [w0, w1] = CODE01_FORMAT_CELLS.map((copy) => copy.reduce((w, flat) => (w << 1) | cls.bits[perm[flat]], 0));
    let bestV1 = { mask: 0, d: Infinity };
    let bestAny = Infinity;
    FORMAT_WORDS.forEach((word, v) => {
      const d = popcount(w0 ^ word) + popcount(w1 ^ word);
      bestAny = Math.min(bestAny, d);
      const info = parseFormatInfoValue(v);
      if (info.codeVersion === CODE_VERSION && d < bestV1.d) bestV1 = { mask: info.mask, d };
    });
    if (bestAny <= FORMAT_TRUST && bestV1.d > FORMAT_TRUST) failure.note('FORMAT', 'unsupported code version');
    const polaris = moons.slots[moonSlot(g, 0)];
    out.push({ g, mask: bestV1.mask, formatDistance: bestV1.d, hint: polaris ? polaris.halo : 0 });
  }
  return out.sort((a, b) => a.formatDistance - b.formatDistance || b.hint - a.hint);
}

function readCodeword(cls: CellClassification, g: number, mask: number): { codeword: Uint8Array; byteConfidence: Float64Array } {
  const perm = DIHEDRAL_PERMS[g];
  const cells = new Uint8Array(CELL_COUNT);
  for (let j = 0; j < CELL_COUNT; j++) cells[j] = cls.bits[perm[j]];
  const { codeword } = decodeCellsToCodeword(cells, mask);
  const byteConfidence = new Float64Array(codeword.length);
  BYTE_CELLS.forEach((list, b) => {
    let m = 1;
    for (const flat of list) m = Math.min(m, cls.confidence[perm[flat]]);
    byteConfidence[b] = m;
  });
  return { codeword, byteConfidence };
}

function tryHypothesis(cls: CellClassification, g: number, mask: number, schedule: readonly number[], failure: Failure): CodeRead | null {
  const { codeword, byteConfidence } = readCodeword(cls, g, mask);
  const order = Array.from(byteConfidence.keys()).sort((a, b) => byteConfidence[a] - byteConfidence[b] || a - b);
  let lastErasures = -1;
  for (const step of schedule) {
    // Never erase bytes that read cleanly: past that point more erasures only cost capacity.
    let count = 0;
    while (count < step && byteConfidence[order[count]] < 0.999) count++;
    if (count === lastErasures) continue;
    lastErasures = count;
    const rs = rsDecode(codeword, NSYM, order.slice(0, count));
    if (!rs.ok) {
      failure.note('ECC', `Reed-Solomon failed (mask ${mask}, ${count} erasures)`);
      continue;
    }
    try {
      const framed = unframeCodeData(rs.data);
      return { g, mask, data: rs.data, payloadBytes: framed.payloadBytes, signature: framed.signature, errors: rs.errors, erasures: rs.erasures };
    } catch (e) {
      if (e instanceof PayloadError && e.code === 'CRC') failure.note('CRC', 'CRC-16 mismatch after Reed-Solomon');
      else failure.note('PAYLOAD', e instanceof Error ? e.message : 'invalid payload');
    }
  }
  return null;
}

/** Erasure schedule when brute-forcing masks (format unreadable): fewer, coarser steps. */
const BRUTE_FORCE_ERASURES = [0, 30, 60];

function decodeCells(cls: CellClassification, moons: MoonSet, mirrored: boolean, failure: Failure): CodeRead | null {
  const hyps = formatHypotheses(cls, moons, mirrored, failure);
  const trusted = hyps.filter((h) => h.formatDistance <= FORMAT_TRUST);
  for (const h of trusted) {
    const read = tryHypothesis(cls, h.g, h.mask, ERASURE_STEPS, failure);
    if (read) return read;
  }
  if (trusted.length > 0) return null;
  // Format unreadable (both copies damaged): brute-force the masks, the
  // most plausible orientations first.
  failure.note('FORMAT', 'format word unreadable');
  for (const h of hyps) {
    for (let mask = 0; mask < CODE01_MASK_COUNT; mask++) {
      const read = tryHypothesis(cls, h.g, mask, BRUTE_FORCE_ERASURES, failure);
      if (read) return read;
    }
  }
  return null;
}

// ── Orchestration ──────────────────────────────────────────────────────────

function decodeCandidate(img: GrayImage, seal: SealCandidate, moons: MoonSet, det: Detection, opts: Required<DecodeOptions>, inverted: boolean, failure: Failure, started: number): DecodeResult | null {
  const initial = initialAlignment(img, seal, moons, det.factor);
  if (!initial) {
    failure.note('NO_MOONS', 'degenerate moon configuration');
    return null;
  }
  if (quietZoneScore(img, initial.homography, initial.cls) < MIN_QUIET_SCORE) {
    failure.note('NO_MOONS', 'no code structure around the seal');
    return null;
  }
  const unitPx = seal.unit * det.factor;
  let T = now(); const lap = (l: string) => { const n = now(); (globalThis as any).DBG?.(l + ' ' + (n - T).toFixed(1)); T = n; };
  // Cheapest first: a sharp frontal capture decodes straight from the moon fit.
  let alignment: Alignment = { ...initial, values: sampleCells(img, initial.homography, true) };
  alignment.cls = classifyCells(alignment.values);
  let read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
  lap('initial ' + !!read);
  if (!read) {
    alignment = refineAlignment(img, initial, unitPx);
    read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
    lap('refine ' + !!read);
  }
  if (!read) {
    alignment = withOffsetField(img, alignment, unitPx);
    read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
    lap('field ' + !!read);
  }
  if (!read) return null;

  const g = read.g;
  const h = multiplyH(alignment.homography, dihedralMatrix(g));
  let genome: { glyphs: (number | null)[]; confidence: number[] } | null = null;
  if (opts.readGenome) {
    try {
      genome = readGenome(img, h);
    } catch {
      genome = null;
    }
  }
  const center = applyH(h, 0, 0);
  const north = applyH(h, 0, -10);
  let orientation = (Math.atan2(north.x - center.x, -(north.y - center.y)) * 180) / Math.PI;
  if (orientation < 0) orientation += 360;
  const [a, b, c, d] = jacobianH(h, 0, 0);
  return {
    ok: true,
    data: read.data,
    payloadBytes: read.payloadBytes,
    signature: read.signature,
    codeVersion: CODE_VERSION,
    mask: read.mask,
    genome,
    quality: {
      rsErrors: read.errors,
      rsErasures: read.erasures,
      contrast: Math.min(1, alignment.cls.globalContrast / 255),
      moduleSizePx: Math.sqrt(Math.abs(a * d - b * c)),
      inverted,
      mirrored: g >= 4,
      orientation,
      elapsedMs: now() - started,
    },
    geometry: {
      center,
      moons: CODE01_MOONS.map((m) => applyH(h, m.x, m.y)),
      homography: h,
    },
  };
}

function decodePolarity(img: GrayImage, opts: Required<DecodeOptions>, inverted: boolean, failure: Failure, started: number): DecodeResult | null {
  let T = now();
  const det = detectionImage(img);
  for (const seal of sealCandidates(det, opts.maxSealCandidates)) {
    (globalThis as any).DBG?.('seal ' + seal.unit.toFixed(2) + '@' + seal.score.toFixed(2) + ' t=' + (now() - T).toFixed(1));
    const moons = findMoons(det.image, det.integral, seal);
    if (!moons) {
      failure.note('NO_MOONS', `seal at (${seal.center.x.toFixed(1)}, ${seal.center.y.toFixed(1)}) without moons`);
      continue;
    }
    const result = decodeCandidate(img, seal, moons, det, opts, inverted, failure, started);
    if (result) return result;
  }
  return null;
}

/** Decode the most prominent ORBES CODE-01 in a luma frame. Never throws. */
export function decodeOrbesCode(img: GrayImage, opts: DecodeOptions = {}): DecodeResult {
  const started = now();
  const failure = new Failure();
  try {
    if (!isUsableImage(img) || img.width < MIN_SIDE || img.height < MIN_SIDE) {
      return { ok: false, reason: 'NO_SEAL', detail: 'image too small or malformed', elapsedMs: now() - started };
    }
    const options: Required<DecodeOptions> = {
      tryInverted: opts.tryInverted ?? true,
      tryMirrored: opts.tryMirrored ?? false,
      readGenome: opts.readGenome ?? true,
      maxSealCandidates: Number.isFinite(opts.maxSealCandidates) ? Math.max(1, Math.min(16, Math.floor(opts.maxSealCandidates as number))) : 4,
    };
    const frame: GrayImage = img.data.length === img.width * img.height ? img : { ...img, data: img.data.subarray(0, img.width * img.height) };
    const normal = decodePolarity(frame, options, false, failure, started);
    if (normal) return normal;
    if (options.tryInverted) {
      const inverted = decodePolarity(invertImage(frame), options, true, failure, started);
      if (inverted) return inverted;
    }
  } catch (e) {
    return { ok: false, reason: failure.reason, detail: `internal error: ${e instanceof Error ? e.message : String(e)}`, elapsedMs: now() - started };
  }
  return { ok: false, reason: failure.reason, ...(failure.detail ? { detail: failure.detail } : {}), elapsedMs: now() - started };
}
