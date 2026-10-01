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

export type ScanHint = 'align' | 'steady' | 'closer' | null;

/**
 * Guidance from the most recent decode failure. A found seal that could not
 * be read means the code is in view but blurred or moving; nothing found
 * means it is not in the orbit (or too small).
 */
export function scanHint(lastReason: DecodeFailureReason | null, elapsedMs: number): ScanHint {
  if (elapsedMs < HINT_AFTER_MS || lastReason === null) return null;
  switch (lastReason) {
    case 'FORMAT':
    case 'ECC':
    case 'CRC':
    case 'PAYLOAD':
      return 'steady';
    case 'NO_MOONS':
      return 'closer';
    default:
      return 'align';
  }
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
