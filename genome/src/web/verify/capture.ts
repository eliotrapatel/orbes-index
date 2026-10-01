/**
 * Pure capture logic for the scanner (no DOM): which part of a frame to
 * decode, how often, which hint to show, and how a decoded code becomes the
 * /api/v1/verify request body. Kept apart from scanner.ts so it can be unit
 * tested in Node.
 */
import type { DecodeFailureReason, DecodedCode } from './protocol.js';
import type { VerifyInput } from './types.js';

// ── Regions of interest ────────────────────────────────────────────────────

/** A source rectangle (video or image pixels) and the size it is drawn at for decoding. */
export interface CropPlan {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Target (canvas) size. */
  tw: number;
  th: number;
}

/** Camera crops are scaled to at most this side: enough pixels per module, bounded decode time. */
export const CAMERA_MAX_SIDE = 960;
/** The crop covers the reticle plus this margin factor (the code's corner moons sit outside its circle). */
export const RETICLE_MARGIN = 1.45;

/**
 * The square region of a camera frame under the on-screen reticle.
 *
 * The preview uses `object-fit: cover`, centred, so the frame is scaled by
 * max(view/video) and the reticle (centred on screen) is centred on the
 * frame too. Decoding only this region bounds the work per frame and keeps
 * unrelated texture out of the finder.
 */
export function cameraCrop(
  video: { width: number; height: number },
  view: { width: number; height: number },
  reticleCssPx: number,
  opts: { margin?: number; maxSide?: number } = {},
): CropPlan {
  const vw = Math.max(1, Math.floor(video.width));
  const vh = Math.max(1, Math.floor(video.height));
  const short = Math.min(vw, vh);
  const margin = opts.margin ?? RETICLE_MARGIN;
  const maxSide = Math.max(16, Math.floor(opts.maxSide ?? CAMERA_MAX_SIDE));
  let side = short;
  if (view.width > 0 && view.height > 0 && reticleCssPx > 0) {
    const scale = Math.max(view.width / vw, view.height / vh);
    side = Math.min(short, Math.round((reticleCssPx * margin) / scale));
  }
  side = Math.max(Math.min(short, 64), side);
  const sx = Math.floor((vw - side) / 2);
  const sy = Math.floor((vh - side) / 2);
  const t = Math.min(side, maxSide);
  return { sx, sy, sw: side, sh: side, tw: t, th: t };
}

/** Photos are decoded at most this large (long side). */
export const UPLOAD_MAX_SIDE = 1600;

/**
 * Decode attempts for an uploaded photo, cheapest first: the whole photo,
 * then centred crops at higher effective resolution (a small code in a large
 * photo loses too much detail when the whole frame is downscaled).
 */
export function uploadCrops(width: number, height: number, maxSide = UPLOAD_MAX_SIDE): CropPlan[] {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const plans: CropPlan[] = [];
  const fit = (sw: number, sh: number): { tw: number; th: number } => {
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    return { tw: Math.max(1, Math.round(sw * k)), th: Math.max(1, Math.round(sh * k)) };
  };
  plans.push({ sx: 0, sy: 0, sw: w, sh: h, ...fit(w, h) });
  for (const f of [0.6, 0.36]) {
    const side = Math.round(Math.min(w, h) * f);
    // Only worth it when the full pass was downscaled, i.e. the crop gains resolution.
    if (Math.max(w, h) <= maxSide || side < 200) break;
    plans.push({ sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), sw: side, sh: side, ...fit(side, side) });
  }
  return plans;
}

/**
 * Second readings of an uploaded photo, used only to confirm a heavily
 * corrected read (ReadConfirmer): the whole photo at three quarters of the
 * first pass's size, and a centred crop of 80 % of the short side. Each
 * resamples the pixels differently from every uploadCrops plan, so a
 * miscorrection would have to repeat on different data to pass.
 */
export function uploadConfirmCrops(width: number, height: number, maxSide = UPLOAD_MAX_SIDE): CropPlan[] {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const k = 0.75 * Math.min(1, maxSide / Math.max(w, h));
  const side = Math.max(1, Math.round(Math.min(w, h) * 0.8));
  const t = Math.max(1, Math.min(side, maxSide));
  return [
    { sx: 0, sy: 0, sw: w, sh: h, tw: Math.max(1, Math.round(w * k)), th: Math.max(1, Math.round(h * k)) },
    { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), sw: side, sh: side, tw: t, th: t },
  ];
}

// ── Pacing ─────────────────────────────────────────────────────────────────

/** Contract §4: frames go to the worker at most every 120 ms. */
export const FRAME_INTERVAL_MS = 120;

/**
 * Frame pacing with backpressure: a frame is sent only when the worker is idle
 * and the minimum interval has passed since the previous one was sent.
 */
export class FrameThrottle {
  private last = Number.NEGATIVE_INFINITY;

  constructor(readonly intervalMs = FRAME_INTERVAL_MS) {}

  ready(now: number, workerBusy: boolean): boolean {
    return !workerBusy && now - this.last >= this.intervalMs;
  }

  sent(now: number): void {
    this.last = now;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

// ── Scan guidance ──────────────────────────────────────────────────────────

/** After this long without a read, guidance appears under the status line. */
export const HINT_AFTER_MS = 6_000;
/** After this long without a read, scanning pauses and the timeout screen is shown. */
export const SCAN_TIMEOUT_MS = 40_000;
/** A single decode that takes longer than this is abandoned (the worker is restarted). */
export const DECODE_WATCHDOG_MS = 6_000;

export type ScanHint = 'align' | 'steady' | 'distance' | 'zoom' | null;

/** What a failed decode says about the frame (protocol.ts DecodeReply, failure branch). */
export interface ScanFailure {
  reason: DecodeFailureReason;
  /** NO_MOONS: the most code-like seal found and its scale. */
  seal?: { confidence: number; unitPx: number };
  /** FORMAT…PAYLOAD: scale of the code that was located but not read. */
  moduleSizePx?: number;
}

/** Camera zoom state: no zoom control, zoom offered but not applied, or applied. */
export type ZoomState = 'none' | 'available' | 'applied';

export interface HintContext {
  /** Side of the decoded square (crop canvas pixels), to tell a code too large for it. */
  cropSidePx?: number;
  zoom?: ZoomState;
}

/**
 * Seal evidence (share of data orbits with arc texture) from which a seal is
 * taken to be a real code rather than a look-alike in clutter.
 */
export const SEAL_CONFIDENT = 0.5;
/**
 * Below this scale (px per u, ≈ 125 px across the code) a located code is too
 * small to read reliably (ORBES-CODE-SPEC §10 targets ≥ 3.5 px per u).
 */
export const SMALL_MODULE_PX = 2.5;
/** Code-plane span (u) the moons need: diameter of the moon orbit plus a moon. */
export const CODE_SPAN_U = 2 * (27.5 + 1.75);

/**
 * Guidance from a decode failure, distance-aware: phones that cannot focus
 * close (iPhone Pro, ≈ 20 cm) only blur when moved closer, so a code too
 * small is answered with the zoom (when the camera offers it and it is not
 * applied yet) or the working distance, never with "move closer".
 *
 *   NO_SEAL, INPUT, INTERNAL       nothing code-like: place the code in the orbit
 *   NO_MOONS, no confident seal    clutter or a look-alike: place the code in the orbit
 *   NO_MOONS, confident seal       too large for the square: the distance;
 *                                  too small: zoom / distance; else part of it is
 *                                  outside the orbit: place the code in the orbit
 *   ECC, CRC, PAYLOAD              a code read but not decoded: too small → zoom /
 *                                  distance, otherwise blur or motion: hold steady
 *   FORMAT                         hold steady (clutter is framed too: no size advice)
 */
export function scanHint(last: ScanFailure | null, elapsedMs: number, ctx: HintContext = {}): ScanHint {
  if (elapsedMs < HINT_AFTER_MS || last === null) return null;
  const zoomOrDistance: ScanHint = ctx.zoom === 'available' ? 'zoom' : 'distance';
  switch (last.reason) {
    case 'ECC':
    case 'CRC':
    case 'PAYLOAD':
      return typeof last.moduleSizePx === 'number' && last.moduleSizePx < SMALL_MODULE_PX ? zoomOrDistance : 'steady';
    case 'FORMAT':
      return 'steady';
    case 'NO_MOONS': {
      const seal = last.seal;
      if (!seal || !(seal.confidence >= SEAL_CONFIDENT)) return 'align';
      if (ctx.cropSidePx && seal.unitPx * CODE_SPAN_U > ctx.cropSidePx) return 'distance';
      if (seal.unitPx < SMALL_MODULE_PX) return zoomOrDistance;
      return 'align';
    }
    default:
      return 'align';
  }
}

/** Failures the hint is drawn from. */
export const HINT_WINDOW = 6;

/**
 * Hints from the prevailing failure of the last few frames rather than the
 * very last one, so a single odd frame (clutter framed as a code for once)
 * neither flips the guidance nor contradicts what the visitor sees.
 */
export class HintTracker {
  private recent: ScanFailure[] = [];

  constructor(readonly window = HINT_WINDOW) {}

  push(failure: ScanFailure): void {
    this.recent.push(failure);
    if (this.recent.length > this.window) this.recent.shift();
  }

  reset(): void {
    this.recent = [];
  }

  hint(elapsedMs: number, ctx: HintContext = {}): ScanHint {
    if (elapsedMs < HINT_AFTER_MS || this.recent.length === 0) return null;
    const votes = new Map<ScanHint, number>();
    let best: ScanHint = null;
    let bestVotes = 0;
    // Most recent first, so ties go to the latest frame.
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const h = scanHint(this.recent[i], elapsedMs, ctx);
      votes.set(h, (votes.get(h) ?? 0) + 1);
    }
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const h = scanHint(this.recent[i], elapsedMs, ctx);
      const n = votes.get(h) ?? 0;
      if (n > bestVotes) {
        best = h;
        bestVotes = n;
      }
    }
    return best;
  }
}

// ── Read confirmation ──────────────────────────────────────────────────────

/**
 * Correction load above which a read is confirmed before it is submitted.
 * Reed-Solomon RS(164,79) has 85 parity bytes; a read that spent more than 50
 * of them (2·errors + erasures) leaves few to catch a miscorrection, so a
 * wrong word would rest on CRC-16 alone. Requiring a second, independent frame
 * to decode to identical data makes a false read (and a false INVALID
 * SIGNATURE verdict) vanishingly unlikely; a clean scan pays nothing.
 */
export const HEAVY_CORRECTION_LOAD = 50;

export function correctionLoad(q: { rsErrors: number; rsErasures: number }): number {
  return 2 * q.rsErrors + q.rsErasures;
}

/**
 * Gate between the decoder and /api/v1/verify. `offer` returns the read to
 * submit, or null to keep scanning: a heavily corrected read is held until
 * another frame (a different `frameKey`, e.g. the video frame's media time)
 * decodes to the same bytes, and the less corrected of the two is submitted.
 */
export class ReadConfirmer {
  private held: { decoded: DecodedCode; frameKey: unknown } | null = null;

  offer(decoded: DecodedCode, frameKey: unknown): DecodedCode | null {
    const held = this.held;
    if (held && held.decoded.code === decoded.code && held.frameKey !== frameKey) {
      this.held = null;
      return correctionLoad(held.decoded.quality) < correctionLoad(decoded.quality) ? held.decoded : decoded;
    }
    if (correctionLoad(decoded.quality) <= HEAVY_CORRECTION_LOAD) {
      this.held = null;
      return decoded;
    }
    // Same frame again: keep the first reading; otherwise hold the newest.
    if (!held || held.frameKey !== frameKey) this.held = { decoded, frameKey };
    return null;
  }

  reset(): void {
    this.held = null;
  }
}

// ── Camera zoom ────────────────────────────────────────────────────────────

/**
 * Zoom applied when the camera opens. At 2× the reliable minimum print size
 * falls from 25 mm to 10–15 mm (docs/reports/print-size-matrix.md), and the
 * phone stays at a distance where it can focus.
 */
export const DEFAULT_ZOOM = 2;

/** The default zoom for a track's zoom range, or null when it would gain nothing. */
export function defaultZoomLevel(z: { min: number; max: number; step: number } | null): number | null {
  if (!z || !Number.isFinite(z.min) || !Number.isFinite(z.max) || z.max <= z.min) return null;
  let level = Math.min(z.max, Math.max(z.min, DEFAULT_ZOOM));
  if (Number.isFinite(z.step) && z.step > 0) {
    level = z.min + Math.round((level - z.min) / z.step) * z.step;
    if (level > z.max) level -= z.step;
    level = Math.round(level * 1000) / 1000;
  }
  return level > z.min + 1e-9 ? level : null;
}

/** Control label for a zoom level: 2×, 1.6×. */
export function zoomLabel(level: number): string {
  const r = Math.round(level * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}×`;
}

// ── Verify request ─────────────────────────────────────────────────────────

const GLYPHS = 8;

function clampInt(n: unknown, min: number, max: number): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * The /api/v1/verify body for a decoded code. Values are clamped to the
 * server's schema bounds so an odd decoder reading can never turn a valid
 * code into a 400; a genome reading that is not exactly 8 glyphs is left out
 * (the server then records NOT_PROVIDED instead of rejecting the request).
 */
export function buildVerifyInput(decoded: DecodedCode, source: 'camera' | 'upload', decodeMs?: number): VerifyInput {
  const input: VerifyInput = { code: decoded.code };
  const g = decoded.genome;
  if (g && Array.isArray(g.glyphs) && g.glyphs.length === GLYPHS) {
    const glyphs = g.glyphs.map((x) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 15 ? x : null));
    const genome: NonNullable<VerifyInput['genome']> = { glyphs };
    if (Array.isArray(g.confidence) && g.confidence.length === GLYPHS) {
      genome.confidence = g.confidence.map((c) => (typeof c === 'number' && Number.isFinite(c) ? Math.round(Math.min(1, Math.max(0, c)) * 1000) / 1000 : 0));
    }
    input.genome = genome;
  }
  const client: NonNullable<VerifyInput['client']> = { source };
  const rsErrors = clampInt(decoded.quality?.rsErrors, 0, 255);
  const rsErasures = clampInt(decoded.quality?.rsErasures, 0, 255);
  const moduleSize = decoded.quality?.moduleSizePx;
  if (rsErrors !== undefined) client.rsErrors = rsErrors;
  if (rsErasures !== undefined) client.rsErasures = rsErasures;
  if (typeof moduleSize === 'number' && Number.isFinite(moduleSize)) client.moduleSizePx = Math.round(Math.min(10_000, Math.max(0, moduleSize)) * 100) / 100;
  if (typeof decodeMs === 'number' && Number.isFinite(decodeMs)) client.decodeMs = Math.round(Math.min(600_000, Math.max(0, decodeMs)));
  input.client = client;
  return input;
}
