/**
 * Decoder test fixtures: real CODE-01 artifacts (seeded payload fields and
 * signature bytes, CRC-valid frame, encoder output) rendered to luma, plus a
 * seeded camera capture helper. Shared by the decoder tests and the scan
 * matrix script so both measure the same thing.
 */
import { ORBES_CODE_STYLES, encodeOrbesCode, renderOrbesCodeSvg, type OrbesCodeModel } from '../../src/core/code/encoder.js';
import { CODE01_SIZE } from '../../src/core/code/profile.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData } from '../../src/core/payload.js';
import type { CaptureParams } from '../support/camera-sim.js';
import { captureGeometry, simulateCapture } from '../support/camera-sim.js';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import { Prng } from '../support/prng.js';
import { svgToGray, type GrayImage } from '../support/raster.js';

export interface CodeFixture {
  seed: number;
  data: Uint8Array;
  payloadBytes: Uint8Array;
  signature: Uint8Array;
  genomeGlyphs: number[];
  model: OrbesCodeModel;
}

/** A valid CODE-01 artifact whose payload fields and signature bytes are drawn from `seed`. */
export function makeCode(seed: number, opts: { mask?: number; decor?: boolean } = {}): CodeFixture {
  const rng = new Prng(`decoder-fixture-${seed}`);
  const identity = { year: rng.int(2000, 2099), categoryIndex: rng.int(1, 31), serial: rng.int(1, 999_999) };
  const nonce = Uint8Array.from({ length: 4 }, () => rng.int(0, 255));
  const payloadBytes = encodePayload({
    codeVersion: 1,
    genomeVersion: 1,
    keyId: rng.int(1, 255),
    identity,
    issue: rng.int(1, 255),
    issuedDay: rng.int(0, 65535),
    nonce,
  });
  // Decoding never verifies signatures, so random bytes exercise it fully.
  const signature = Uint8Array.from({ length: 64 }, () => rng.int(0, 255));
  const data = frameCodeData(payloadBytes, signature);
  const genomeGlyphs = computeGenome(packIdentity(identity)).glyphs;
  const model = encodeOrbesCode({ data, genomeGlyphs, ...(opts.mask === undefined ? {} : { mask: opts.mask }) }, { decor: opts.decor ?? true });
  return { seed, data, payloadBytes, signature, genomeGlyphs, model };
}

/** Brand presentations (encoder ORBES_CODE_STYLES). */
export type CodeStyle = keyof typeof ORBES_CODE_STYLES;

const sourceCache = new Map<string, GrayImage>();

/**
 * The artifact rasterised at `pxPerU` (whole 50 u square, quiet zone
 * included). Cached: tests photograph the same source many times.
 */
export function renderCode(code: CodeFixture, pxPerU: number, style: CodeStyle = 'classic'): GrayImage {
  const key = `${code.seed}/${code.model.mask}/${pxPerU}/${style}/${code.model.primitives.length}`;
  const cached = sourceCache.get(key);
  if (cached) return cached;
  const img = svgToGray(renderOrbesCodeSvg(code.model, ORBES_CODE_STYLES[style]), { widthPx: Math.round(CODE01_SIZE * pxPerU) });
  if (sourceCache.size > 64) sourceCache.clear();
  sourceCache.set(key, img);
  return img;
}

/** Source resolution for camera captures: comfortably above any capture scale used. */
export const SOURCE_PX_PER_U = 16;

/**
 * Photograph `code` with the camera simulator; `pxPerU` sets the apparent
 * size (frame pixels per code unit, face-on).
 */
export function capture(code: CodeFixture, pxPerU: number, params: CaptureParams, seed: number, style: CodeStyle = 'classic'): GrayImage {
  const source = renderCode(code, Math.max(SOURCE_PX_PER_U, Math.ceil(pxPerU * 1.5)), style);
  return simulateCapture(source, { ...params, codeWidthPx: pxPerU * CODE01_SIZE }, seed);
}

/**
 * Ground truth for a capture made with `capture`: code-plane point (u, y
 * down, origin at the seal centre) → frame pixel, through the simulator's
 * full forward model.
 */
export function captureTruth(pxPerU: number, params: CaptureParams): (x: number, y: number) => { x: number; y: number } {
  const sourcePxPerU = Math.max(SOURCE_PX_PER_U, Math.ceil(pxPerU * 1.5));
  const half = CODE01_SIZE / 2;
  const source = { width: Math.round(CODE01_SIZE * sourcePxPerU), height: Math.round(CODE01_SIZE * sourcePxPerU) };
  const geo = captureGeometry(source, { ...params, codeWidthPx: pxPerU * CODE01_SIZE });
  const s = source.width / CODE01_SIZE;
  return (x, y) => {
    const p = geo.project((x + half) * s, (y + half) * s);
    if (!p) throw new Error(`code point (${x}, ${y}) is not visible`);
    return p;
  };
}

export interface TrialSetup {
  /** Frame pixels per code unit, face-on. */
  pxPerU: number;
  params: CaptureParams;
  style?: CodeStyle;
}

/**
 * Seeded robustness trials: `n` captures of distinct codes built by `setup`
 * from a per-trial PRNG, each decoded with default options. Returns the
 * number of exact decodes and a description of every failure.
 */
export function runTrials(label: string, n: number, setup: (rng: Prng) => TrialSetup): { ok: number; failures: string[] } {
  const failures: string[] = [];
  let ok = 0;
  for (let t = 0; t < n; t++) {
    const rng = new Prng(`${label}#${t}`);
    const code = makeCode(1000 + (t % 16));
    const { pxPerU, params, style } = setup(rng);
    const res = decodeOrbesCode(capture(code, pxPerU, params, rng.u32(), style));
    if (res.ok && res.data.every((b, i) => b === code.data[i])) ok++;
    else failures.push(`${label} #${t}: ${res.ok ? 'wrong data' : `${res.reason} ${res.detail ?? ''}`}`);
  }
  return { ok, failures };
}
