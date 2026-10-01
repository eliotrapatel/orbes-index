/**
 * ORBES CODE-01 decoder: luma frame → code data validated by Reed-Solomon,
 * CRC-16 and strict payload parsing. It never verifies signatures (that is
 * the server's job) and never throws.
 *
 * Pipeline (each stage is its own module):
 *
 *  1. Detection image. Frames above 2.5 MP are area-downscaled by an integer
 *     factor for detection only; alignment and sampling always use the full
 *     frame. One summed-area table feeds every box statistic.
 *  2. Seal (finder.ts). Adaptive mean thresholding at two window sizes (1/8
 *     and 1/16 of the short side), for dark ink and — from the same table —
 *     light ink. Rows (then columns) are scanned for the seal's
 *     rotation-invariant 1:1:4:1:1 run pattern; hits are confirmed along a
 *     second direction and clustered; rays cast on the gray image give
 *     sub-pixel ring and core edges, fitted with direct least-squares
 *     ellipses → centre and affine frame (up to rotation). Passes run from
 *     cheapest to most thorough and stop as soon as a code decodes.
 *  3. Moons (moons.ts). Centre-surround box filter in the annulus where the
 *     moons must lie, disc-shape check, size-adapted sub-pixel centroids,
 *     then the best four (or three) whose diagonals pass through the seal
 *     centre — a projective invariant, so strong perspective is no problem.
 *     The polaris halo is measured as an orientation hint only.
 *  4. Homography (homography.ts). Moon centroids are re-measured with their
 *     local scale, then a normalised DLT maps seal centre + moons (plus seal
 *     ring points when a moon is missing). A quiet-zone check rejects look-
 *     alikes (a genome glyph mistaken for a seal) before any costly work.
 *  5. Sampling (sampler.ts). Every cell is read with a 3 × 3 footprint and
 *     classified against a local 2-means threshold; confidence combines the
 *     margin to the threshold with the contrast of the cell's surroundings.
 *  6. Orientation, format and ECC. A single sampling serves all dihedral
 *     hypotheses (a 90° rotation is an index shift on every ring, a mirror an
 *     index reversal: every ring has a multiple of four cells and the moon
 *     square is symmetric). Hypotheses are ranked by the distance of the two
 *     format copies to the nearest BCH(15,5) word (polaris hint breaks ties)
 *     and decoded with RS(164,79): errors only first, then with more and more
 *     erasures on the least confident bytes. With no trustworthy format read
 *     the four masks are brute-forced. CRC-16 and strict payload parsing
 *     (unframeCodeData) catch miscorrections; a failure moves on to the next
 *     hypothesis.
 *  7. Alignment repair, only when step 6 fails, cheapest first: the fits
 *     leaving one moon out (a damaged moon), coordinate-descent refinement of
 *     the control points on cell contrast (refine.ts: centroid bias, lens
 *     distortion), then a smooth offset field (curved surfaces), then that
 *     field started from a registration of the orbits on their ring lattice
 *     (strong bends, e.g. a code on a finger ring); each is followed by
 *     steps 5–6 again.
 *  8. Seal-less fallback: when no seal candidate decodes (seal scratched,
 *     under a glare stripe, crossed by a strip), connected components of the
 *     binarised frame are searched for four disc-like blobs whose diagonals
 *     cross near their middles (components.ts, moons.ts); their crossing is
 *     the code centre, and steps 4–7 follow.
 *  9. Genome (genome-reader.ts), optional and never fatal.
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
import { asGrayImage, downscaleImage, invertImage, type GrayImage } from './image.js';
import { integralImage, type IntegralImage } from './integral.js';
import { inkBlobs } from './components.js';
import { findMoonQuads, findMoons, invert2, moonLevels, refineCentroid, type Mat2, type MoonSet } from './moons.js';
import { alignmentScore, fieldShift, refineControlPoints, refineOffsetField, ringLatticeField } from './refine.js';
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

/**
 * Per-frame detection state. Seal search runs on a detection image (the
 * frame, or an area-downscaled copy of large frames); alignment and sampling
 * run on the full-resolution frame of the matching polarity. Light-ink
 * polarity is binarised directly from the normal summed-area table; the
 * negative images themselves are only built once a light-ink seal is found.
 */
class Detection {
  readonly image: GrayImage;
  readonly integral: IntegralImage;
  /** Full-resolution pixels per detection pixel. */
  readonly factor: number;
  /** Binarisation windows (px): 1/8 and 1/16 of the short side. */
  readonly windows: number[];
  private negative: { image: GrayImage; integral: IntegralImage; frame: GrayImage } | null = null;
  private readonly binaries = new Map<string, Uint8Array>();

  constructor(readonly frame: GrayImage) {
    const pixels = frame.width * frame.height;
    this.factor = pixels > MAX_DETECTION_PIXELS ? Math.ceil(Math.sqrt(pixels / MAX_DETECTION_PIXELS)) : 1;
    this.image = this.factor > 1 ? downscaleImage(frame, this.factor) : frame;
    this.integral = integralImage(this.image);
    const side = Math.min(this.image.width, this.image.height);
    this.windows = [...new Set([Math.max(8, Math.round(side / 8)), Math.max(6, Math.round(side / 16))])];
  }

  /** Detection image, its table and the full frame, as dark-ink images of the given polarity. */
  view(inverted: boolean): { image: GrayImage; integral: IntegralImage; frame: GrayImage } {
    if (!inverted) return { image: this.image, integral: this.integral, frame: this.frame };
    if (!this.negative) {
      const image = invertImage(this.image);
      this.negative = { image, integral: integralImage(image), frame: this.factor > 1 ? invertImage(this.frame) : image };
    }
    return this.negative;
  }

  /** Binarisation of the detection image (cached: the passes share them). */
  binary(windowPx: number, inverted: boolean): Uint8Array {
    const key = `${windowPx}/${inverted}`;
    let bin = this.binaries.get(key);
    if (!bin) {
      bin = binarize(this.image, this.integral, windowPx, inverted);
      this.binaries.set(key, bin);
    }
    return bin;
  }
}

interface SealHit {
  seal: SealCandidate;
  inverted: boolean;
}

/**
 * Seal candidates in passes of increasing cost, both polarities interleaved:
 * rows of the coarse-window binarisation (dark ink, then light ink), rows of
 * the fine-window one, then columns of all of them (which catch seals with a
 * damaged left or right side). Each pass yields only seals not seen before,
 * best first, so a frame whose code is found early never pays for the
 * later passes.
 */
function* sealCandidates(det: Detection, max: number, polarities: readonly boolean[]): Generator<SealHit> {
  const { image } = det;
  const passes: { inverted: boolean; scan: () => SealCluster[][] }[] = [];
  for (const w of det.windows) {
    for (const inverted of polarities) {
      passes.push({ inverted, scan: () => [findSealHits(det.binary(w, inverted), image.width, image.height, 'rows')] });
    }
  }
  for (const inverted of polarities) {
    passes.push({ inverted, scan: () => det.windows.map((w) => findSealHits(det.binary(w, inverted), image.width, image.height, 'columns')) });
  }
  const seen: SealHit[] = [];
  const near = (x: number, y: number, inverted: boolean) =>
    seen.some((h) => h.inverted === inverted && Math.hypot(h.seal.center.x - x, h.seal.center.y - y) < 2 * h.seal.unit);
  for (const pass of passes) {
    const clusters = mergeClusters(pass.scan()).filter((c) => !near(c.x, c.y, pass.inverted));
    if (clusters.length === 0) continue;
    const view = det.view(pass.inverted);
    const fresh: SealCandidate[] = [];
    for (const cluster of clusters.slice(0, MAX_CLUSTERS)) {
      const seal = measureSeal(view.image, cluster);
      if (seal && !near(seal.center.x, seal.center.y, pass.inverted)) fresh.push(seal);
    }
    fresh.sort((a, b) => b.score - a.score);
    for (const seal of fresh.slice(0, max)) {
      const hit = { seal, inverted: pass.inverted };
      seen.push(hit);
      yield hit;
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

/** Seal centre and moon correspondences (frame-0 code point ↔ image point) of a candidate. */
interface Anchors {
  center: Point;
  sealAffine: Mat2;
  pairs: [Point, Point][];
}

/** Alignment through `h`, with every moon (found or predicted) as a refinable control point. */
function alignmentFrom(...args: Parameters<typeof alignmentFromInner>): ReturnType<typeof alignmentFromInner> { const t0 = now(); const r = alignmentFromInner(...args); __acc('alignmentFrom', now() - t0); return r; }
function alignmentFromInner(img: GrayImage, center: Point, h: Homography): Alignment {
  const values = sampleCells(img, h, true);
  return {
    homography: h,
    codePoints: [{ x: 0, y: 0 }, ...CODE01_MOONS],
    imagePoints: [center, ...CODE01_MOONS.map((c) => applyH(h, c.x, c.y))],
    values,
    cls: classifyCells(values),
    shift: null,
  };
}

/**
 * Anchors at full resolution. Moon centroids are re-measured with their own
 * local scale from a first fit: the seal's affine frame is only exact at the
 * centre, so under perspective a moon's window would otherwise clip it or
 * catch the polaris halo.
 */
function anchorsOf(...args: Parameters<typeof anchorsOfInner>): ReturnType<typeof anchorsOfInner> { const t0 = now(); const r = anchorsOfInner(...args); __acc('anchorsOf', now() - t0); return r; }
function anchorsOfInner(img: GrayImage, center: Point, sealAffine: Mat2, moons: MoonSet, factor: number): Anchors | null {
  const pairs: [Point, Point][] = [];
  moons.slots.forEach((m, k) => {
    if (m) pairs.push([CODE01_MOONS[k], scale(m, factor)]);
  });
  const rough = fitFrame(center, sealAffine, pairs);
  if (!rough) return null;
  return {
    center,
    sealAffine,
    pairs: pairs.map(([c, p]) => {
      const local = jacobianH(rough, c.x, c.y);
      const { ink, paper } = moonLevels(img, local, p);
      return [c, refineCentroid(img, local, p, ink, paper)];
    }),
  };
}

/**
 * With four moons, the fits leaving one moon out compete with the full fit
 * on cell contrast (thresholds of the full fit), so one damaged moon (a
 * smudge, a partial occlusion) cannot spoil the frame. Null when the full
 * fit stays best.
 */
function leaveOneOut(...args: Parameters<typeof leaveOneOutInner>): ReturnType<typeof leaveOneOutInner> { const t0 = now(); const r = leaveOneOutInner(...args); __acc('leaveOneOut', now() - t0); return r; }
function leaveOneOutInner(img: GrayImage, anchors: Anchors, full: Alignment): Alignment | null {
  if (anchors.pairs.length !== 4) return null;
  let best: Homography | null = null;
  let bestScore = alignmentScore(sampleCells(img, full.homography, false), full.cls);
  for (let skip = 0; skip < 4; skip++) {
    const h = fitFrame(anchors.center, anchors.sealAffine, anchors.pairs.filter((_, i) => i !== skip));
    if (!h) continue;
    const score = alignmentScore(sampleCells(img, h, false), full.cls);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best ? alignmentFrom(img, anchors.center, best) : null;
}

function refineAlignment(...args: Parameters<typeof refineAlignmentInner>): ReturnType<typeof refineAlignmentInner> { const t0 = now(); const r = refineAlignmentInner(...args); __acc('refineAlignment', now() - t0); return r; }
function refineAlignmentInner(img: GrayImage, a: Alignment, unitPx: number): Alignment {
  const refined = refineControlPoints(img, a.codePoints, a.imagePoints, unitPx, a.cls);
  if (!refined) return a;
  const values = sampleCells(img, refined.homography, true);
  return { ...a, homography: refined.homography, imagePoints: refined.points, values, cls: classifyCells(values) };
}

function withOffsetField(...args: Parameters<typeof withOffsetFieldInner>): ReturnType<typeof withOffsetFieldInner> { const t0 = now(); const r = withOffsetFieldInner(...args); __acc('withOffsetField', now() - t0); return r; }
function withOffsetFieldInner(img: GrayImage, a: Alignment, unitPx: number): Alignment {
  const { shift } = refineOffsetField(img, a.homography, unitPx, a.cls);
  const values = sampleCells(img, a.homography, true, shift);
  return { ...a, values, cls: classifyCells(values), shift };
}

/** Offset field registered on the ring lattice first (strong curvature), then refined; null when no lattice shows. */
function withRingLattice(...args: Parameters<typeof withRingLatticeInner>): ReturnType<typeof withRingLatticeInner> { const t0 = now(); const r = withRingLatticeInner(...args); __acc('withRingLattice', now() - t0); return r; }
function withRingLatticeInner(img: GrayImage, a: Alignment, unitPx: number): Alignment | null {
  const initial = ringLatticeField(img, a.homography);
  if (!initial) return null;
  const start = classifyCells(sampleCells(img, a.homography, true, fieldShift(initial)));
  const { shift } = refineOffsetField(img, a.homography, unitPx, start, initial);
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

/**
 * Reed-Solomon over the erasure schedule for one (orientation, mask) guess.
 * `guessed` marks brute-forced masks, whose Reed-Solomon failures say nothing
 * beyond the unreadable format already noted.
 */
function tryHypothesis(cls: CellClassification, g: number, mask: number, schedule: readonly number[], guessed: boolean, failure: Failure): CodeRead | null {
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
      if (!guessed) failure.note('ECC', `Reed-Solomon failed (mask ${mask}, ${count} erasures)`);
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

const __acc = (k: string, t: number) => { const g = globalThis as any; g.__times = g.__times ?? {}; g.__times[k] = (g.__times[k] ?? 0) + t; g.__counts = g.__counts ?? {}; g.__counts[k] = (g.__counts[k] ?? 0) + 1; };
function decodeCells(cls: CellClassification, moons: MoonSet, mirrored: boolean, failure: Failure): CodeRead | null {
  const t0 = now(); const r = decodeCellsInner(cls, moons, mirrored, failure); __acc('decodeCells', now() - t0); return r;
}
function decodeCellsInner(cls: CellClassification, moons: MoonSet, mirrored: boolean, failure: Failure): CodeRead | null {
  const hyps = formatHypotheses(cls, moons, mirrored, failure);
  const trusted = hyps.filter((h) => h.formatDistance <= FORMAT_TRUST);
  for (const h of trusted) {
    const read = tryHypothesis(cls, h.g, h.mask, ERASURE_STEPS, false, failure);
    if (read) return read;
  }
  if (trusted.length === 0) failure.note('FORMAT', 'format word unreadable');
  // Format unreadable, or damaged into a wrong but plausible word: brute-force
  // the masks not tried yet, the most plausible orientations first.
  for (const h of hyps) {
    for (let mask = 0; mask < CODE01_MASK_COUNT; mask++) {
      if (h.formatDistance <= FORMAT_TRUST && mask === h.mask) continue;
      const read = tryHypothesis(cls, h.g, mask, BRUTE_FORCE_ERASURES, true, failure);
      if (read) return read;
    }
  }
  return null;
}

// ── Orchestration ──────────────────────────────────────────────────────────

/**
 * Full decode from located anchors: alignment, sampling, format and ECC, with
 * progressively more expensive alignment stages, then the result assembly.
 * `unitPx` is the expected pixels per u near the centre.
 */
function decodeAnchors(img: GrayImage, anchors: Anchors | null, unitPx: number, moons: MoonSet, opts: Required<DecodeOptions>, inverted: boolean, failure: Failure, started: number): DecodeResult | null {
  const fit = anchors && fitFrame(anchors.center, anchors.sealAffine, anchors.pairs);
  if (!anchors || !fit) {
    failure.note('NO_MOONS', 'degenerate moon configuration');
    return null;
  }
  let alignment = alignmentFrom(img, anchors.center, fit);
  if (quietZoneScore(img, alignment.homography, alignment.cls) < MIN_QUIET_SCORE) {
    failure.note('NO_MOONS', 'no code structure around the seal');
    return null;
  }
  // Cheapest first: most captures decode straight from the anchor fit; each
  // further stage costs more and only runs when the previous one failed.
  // The lattice registration tolerates misalignment the other repairs cannot,
  // so it starts from the plain anchor fit: the leave-one-out fits lean on
  // the seal's affine frame, which a strong bend makes wrong away from the
  // centre, and the contrast descents may have locked onto a neighbouring ring.
  const fitted = alignment;
  (globalThis as any).__stage = 'anchor'; let read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
  if (!read) {
    const robust = leaveOneOut(img, anchors, alignment);
    if (robust) {
      alignment = robust; (globalThis as any).__stage = 'loo';
      read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
    }
  }
  if (!read) {
    alignment = refineAlignment(img, alignment, unitPx); (globalThis as any).__stage = 'refine';
    read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
  }
  if (!read) {
    alignment = withOffsetField(img, alignment, unitPx); (globalThis as any).__stage = 'field';
    read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
  }
  if (!read) {
    const lattice = withRingLattice(img, fitted, unitPx);
    if (lattice) {
      alignment = lattice; (globalThis as any).__stage = 'lattice';
      read = decodeCells(alignment.cls, moons, opts.tryMirrored, failure);
    }
  }
  if (!read) return null;
  (globalThis as any).__okStage = ((globalThis as any).__fromMoons ? 'moons:' : '') + (globalThis as any).__stage;

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

/** Moon quadruples examined per polarity by the seal-less fallback. */
const MAX_MOON_QUADS = 3;

/**
 * Seal-less fallback: the four moons alone locate the code (their diagonals
 * cross at its centre in any view). Runs only when every seal candidate
 * failed, e.g. a seal under a glare stripe or crossed by a scratch.
 */
function decodeFromMoons(det: Detection, opts: Required<DecodeOptions>, polarities: readonly boolean[], failure: Failure, started: number): DecodeResult | null {
  (globalThis as any).__fromMoons = true;
  const { image } = det;
  for (const inverted of polarities) {
    // A moon (r = 1.75 u) of at least 2 px radius, at most a third of the short side across.
    const side = Math.min(image.width, image.height);
    const blobs = inkBlobs(det.binary(det.windows[0], inverted), image.width, image.height, 12, (side * side) / 36);
    const view = det.view(inverted);
    for (const quad of findMoonQuads(view.image, blobs, MAX_MOON_QUADS)) {
      const center = scale(quad.center, det.factor);
      const moonFit = homographyFromPoints([{ x: 0, y: 0 }, ...CODE01_MOONS], [center, ...quad.points.map((m) => scale(m, det.factor))]);
      if (!moonFit) continue;
      const local = jacobianH(moonFit, 0, 0);
      const anchors = anchorsOf(view.frame, center, local, quad.moons, det.factor);
      const result = decodeAnchors(view.frame, anchors, Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2])), quad.moons, opts, inverted, failure, started);
      if (result) return result;
    }
  }
  return null;
}

function decodeFrame(frame: GrayImage, opts: Required<DecodeOptions>, failure: Failure, started: number): DecodeResult | null {
  const det = new Detection(frame);
  const polarities = opts.tryInverted ? [false, true] : [false];
  for (const { seal, inverted } of sealCandidates(det, opts.maxSealCandidates, polarities)) {
    const view = det.view(inverted);
    const tm = now(); const moons = findMoons(view.image, view.integral, seal); __acc('findMoons', now() - tm);
    if (!moons) {
      failure.note('NO_MOONS', `seal at (${(seal.center.x * det.factor).toFixed(1)}, ${(seal.center.y * det.factor).toFixed(1)}) without moons`);
      continue;
    }
    const center = scale(seal.center, det.factor);
    const sealAffine = seal.affine.map((v) => v * det.factor) as Mat2;
    const anchors = anchorsOf(view.frame, center, sealAffine, moons, det.factor);
    const result = decodeAnchors(view.frame, anchors, seal.unit * det.factor, moons, opts, inverted, failure, started);
    if (result) return result;
  }
  const tf = now(); const rr = decodeFromMoons(det, opts, polarities, failure, started); __acc('moonFallbackTotal', now() - tf); return rr;
}

/** Decode the most prominent ORBES CODE-01 in a luma frame. Never throws. */
export function decodeOrbesCode(img: GrayImage, opts: DecodeOptions = {}): DecodeResult {
  const started = now(); (globalThis as any).__fromMoons = false; (globalThis as any).__okStage = 'none';
  const failure = new Failure();
  try {
    const frame = asGrayImage(img);
    if (!frame || frame.width < MIN_SIDE || frame.height < MIN_SIDE) {
      return { ok: false, reason: 'NO_SEAL', detail: 'image too small or malformed', elapsedMs: now() - started };
    }
    const o: DecodeOptions = opts !== null && typeof opts === 'object' ? opts : {};
    const options: Required<DecodeOptions> = {
      tryInverted: o.tryInverted ?? true,
      tryMirrored: o.tryMirrored ?? false,
      readGenome: o.readGenome ?? true,
      maxSealCandidates: Number.isFinite(o.maxSealCandidates) ? Math.max(1, Math.min(16, Math.floor(o.maxSealCandidates as number))) : 4,
    };
    const result = decodeFrame(frame, options, failure, started);
    if (result) return result;
  } catch (e) {
    return { ok: false, reason: failure.reason, detail: `internal error: ${e instanceof Error ? e.message : String(e)}`, elapsedMs: now() - started };
  }
  return { ok: false, reason: failure.reason, ...(failure.detail ? { detail: failure.detail } : {}), elapsedMs: now() - started };
}
