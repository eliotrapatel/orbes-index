import { describe, expect, it } from 'vitest';
import { renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { toBase64Url } from '../../src/core/bytes.js';
import { parse, verifyBody } from '../../src/server/http/schemas.js';
import {
  buildVerifyInput,
  CAMERA_MAX_SIDE,
  cameraCrop,
  correctionLoad,
  DEFAULT_ZOOM,
  defaultZoomLevel,
  FRAME_INTERVAL_MS,
  FrameThrottle,
  HEAVY_CORRECTION_LOAD,
  HINT_AFTER_MS,
  HINT_WINDOW,
  HintTracker,
  ReadConfirmer,
  RETICLE_MARGIN,
  scanHint,
  SEAL_CONFIDENT,
  SMALL_MODULE_PX,
  UPLOAD_MAX_SIDE,
  uploadCrops,
  zoomLabel,
  type ScanFailure,
} from '../../src/web/verify/capture.js';
import { HINTS } from '../../src/web/verify/copy.js';
import { handleDecode } from '../../src/web/verify/frame-decoder.js';
import { isDecodeRequest, MAX_FRAME_PIXELS, type DecodeFailureReason, type DecodeRequest, type DecodedCode } from '../../src/web/verify/protocol.js';
import { makeCode } from '../decoder/fixtures.js';
import { grayToRgba, svgToGray } from '../support/raster.js';

describe('cameraCrop', () => {
  it('maps the on-screen reticle to the matching square of a portrait frame (object-fit: cover)', () => {
    // 720×1280 stream in a 390×844 view: scale = max(390/720, 844/1280) = 0.659…
    const p = cameraCrop({ width: 720, height: 1280 }, { width: 390, height: 844 }, 257.4);
    const scale = Math.max(390 / 720, 844 / 1280);
    expect(p.sw).toBe(Math.round((257.4 * RETICLE_MARGIN) / scale));
    expect(p.sh).toBe(p.sw);
    expect(p.sx).toBe(Math.floor((720 - p.sw) / 2));
    expect(p.sy).toBe(Math.floor((1280 - p.sh) / 2));
    expect([p.tw, p.th]).toEqual([p.sw, p.sw]); // under the size cap: decoded 1:1
  });

  it('clamps to the short side and caps the decode size', () => {
    // A reticle larger than the frame's short side (in frame pixels) is clamped to it.
    const p = cameraCrop({ width: 1920, height: 1080 }, { width: 390, height: 844 }, 800);
    expect(p.sw).toBe(1080);
    expect(p.sx).toBe(420);
    expect(p.sy).toBe(0);
    expect(p.tw).toBe(CAMERA_MAX_SIDE);
    expect(p.th).toBe(CAMERA_MAX_SIDE);
  });

  it('uses the whole short side when the view is unknown', () => {
    const p = cameraCrop({ width: 1280, height: 720 }, { width: 0, height: 0 }, 0, { maxSide: 512 });
    expect(p).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720, tw: 512, th: 512 });
  });

  it('returns integer coordinates inside the frame for odd sizes', () => {
    for (const [w, h] of [
      [641, 479],
      [1079, 1919],
      [33, 2000],
    ]) {
      const p = cameraCrop({ width: w, height: h }, { width: 375, height: 667 }, 247.3);
      for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true);
      expect(p.sx).toBeGreaterThanOrEqual(0);
      expect(p.sy).toBeGreaterThanOrEqual(0);
      expect(p.sx + p.sw).toBeLessThanOrEqual(w);
      expect(p.sy + p.sh).toBeLessThanOrEqual(h);
    }
  });
});

describe('uploadCrops', () => {
  it('decodes a small photo once, at full resolution', () => {
    expect(uploadCrops(1200, 900)).toEqual([{ sx: 0, sy: 0, sw: 1200, sh: 900, tw: 1200, th: 900 }]);
  });

  it('downscales a large photo, then retries centred crops at higher resolution', () => {
    const plans = uploadCrops(4032, 3024);
    expect(plans).toHaveLength(3);
    expect(plans[0]).toMatchObject({ sx: 0, sy: 0, sw: 4032, sh: 3024, tw: UPLOAD_MAX_SIDE, th: 1200 });
    expect(plans[1].sw).toBe(Math.round(3024 * 0.6));
    expect(plans[2].sw).toBe(Math.round(3024 * 0.36));
    for (const p of plans) {
      expect(Math.max(p.tw, p.th)).toBeLessThanOrEqual(UPLOAD_MAX_SIDE);
      expect(p.sx + p.sw).toBeLessThanOrEqual(4032);
      expect(p.sy + p.sh).toBeLessThanOrEqual(3024);
    }
    // Each further crop sees the centre at a higher effective resolution.
    expect(plans[1].tw / plans[1].sw).toBeGreaterThan(plans[0].tw / plans[0].sw);
  });
});

describe('FrameThrottle', () => {
  it('sends at most one frame per interval and never while the worker is busy', () => {
    const t = new FrameThrottle();
    expect(t.intervalMs).toBe(FRAME_INTERVAL_MS);
    expect(t.ready(0, false)).toBe(true);
    t.sent(0);
    expect(t.ready(FRAME_INTERVAL_MS - 1, false)).toBe(false);
    expect(t.ready(FRAME_INTERVAL_MS, true)).toBe(false);
    expect(t.ready(FRAME_INTERVAL_MS, false)).toBe(true);
    t.sent(500);
    t.reset();
    expect(t.ready(501, false)).toBe(true);
  });
});

describe('scanHint', () => {
  const f = (reason: DecodeFailureReason, more: Partial<ScanFailure> = {}): ScanFailure => ({ reason, ...more });
  const T = HINT_AFTER_MS;

  it('stays quiet at first, then guides by the last failure', () => {
    expect(scanHint(f('NO_SEAL'), T - 1)).toBeNull();
    expect(scanHint(null, T * 3)).toBeNull();
    expect(scanHint(f('NO_SEAL'), T)).toBe('align');
    for (const r of ['FORMAT', 'ECC', 'CRC', 'PAYLOAD'] as const) expect(scanHint(f(r, { moduleSizePx: 6 }), T)).toBe('steady');
    expect(scanHint(f('FORMAT'), T)).toBe('steady');
    expect(scanHint(f('INTERNAL'), T)).toBe('align');
    expect(scanHint(f('INPUT'), T)).toBe('align');
  });

  it('asks to place the code in the orbit when no code-like seal was found (clutter, a look-alike, no consistent moons)', () => {
    expect(scanHint(f('NO_MOONS'), T)).toBe('align');
    expect(scanHint(f('NO_MOONS', { seal: { confidence: 0.1, unitPx: 4 } }), T)).toBe('align');
    expect(scanHint(f('NO_MOONS', { seal: { confidence: SEAL_CONFIDENT - 0.01, unitPx: 1.5 } }), T, { zoom: 'available' })).toBe('align');
    // A real code of a sensible size whose moons were missed: part of it is outside the orbit.
    expect(scanHint(f('NO_MOONS', { seal: { confidence: 0.9, unitPx: 5 } }), T, { cropSidePx: 560 })).toBe('align');
  });

  it('never says "move closer": distance-aware guidance, zoom first when the camera offers it', () => {
    expect(Object.values(HINTS).join(' ')).not.toMatch(/closer/i);
    expect(HINTS.distance).toBe('Hold about 20 cm away');
    expect(HINTS.zoom).toMatch(/^Zoom in/);
    // A code read far too small to decode (format read, data not): zoom in if possible, else the distance.
    const small = f('ECC', { moduleSizePx: SMALL_MODULE_PX - 0.3 });
    expect(scanHint(small, T, { zoom: 'available' })).toBe('zoom');
    expect(scanHint(small, T, { zoom: 'applied' })).toBe('distance');
    expect(scanHint(small, T, { zoom: 'none' })).toBe('distance');
    expect(scanHint(small, T)).toBe('distance');
    // A real seal, too small for its moons to be found.
    expect(scanHint(f('NO_MOONS', { seal: { confidence: 0.8, unitPx: 1.4 } }), T, { zoom: 'available' })).toBe('zoom');
    // A real seal so large the moons fall outside the decoded square: too close.
    expect(scanHint(f('NO_MOONS', { seal: { confidence: 0.8, unitPx: 14 } }), T, { cropSidePx: 560, zoom: 'available' })).toBe('distance');
    // A FORMAT failure says nothing certain about a code (clutter is framed too): steady, never zoom.
    expect(scanHint(f('FORMAT', { moduleSizePx: 1.5 }), T, { zoom: 'available' })).toBe('steady');
  });
});

describe('HintTracker', () => {
  it('follows the prevailing failure of the recent frames, not a single odd frame', () => {
    const t = new HintTracker();
    expect(t.hint(HINT_AFTER_MS)).toBeNull();
    for (let i = 0; i < 5; i++) t.push({ reason: 'NO_MOONS' });
    t.push({ reason: 'FORMAT', moduleSizePx: 2 });
    expect(t.hint(HINT_AFTER_MS - 1)).toBeNull();
    expect(t.hint(HINT_AFTER_MS)).toBe('align');
    for (let i = 0; i < HINT_WINDOW; i++) t.push({ reason: 'ECC', moduleSizePx: 6 });
    expect(t.hint(HINT_AFTER_MS)).toBe('steady');
    t.reset();
    expect(t.hint(HINT_AFTER_MS * 2)).toBeNull();
  });

  it('breaks ties towards the most recent frame', () => {
    const t = new HintTracker(4);
    t.push({ reason: 'ECC', moduleSizePx: 6 });
    t.push({ reason: 'NO_SEAL' });
    t.push({ reason: 'ECC', moduleSizePx: 6 });
    t.push({ reason: 'NO_SEAL' });
    expect(t.hint(HINT_AFTER_MS)).toBe('align');
  });
});

describe('ReadConfirmer (miscorrection safety)', () => {
  const read = (code: string, rsErrors: number, rsErasures: number): DecodedCode => ({
    code,
    codeVersion: 1,
    genome: null,
    quality: { rsErrors, rsErasures, moduleSizePx: 5, contrast: 0.6, inverted: false, mirrored: false },
  });

  it('measures the correction load as 2·errors + erasures', () => {
    expect(correctionLoad(read('A', 10, 30).quality)).toBe(50);
    expect(HEAVY_CORRECTION_LOAD).toBe(50);
  });

  it('submits a lightly corrected read at once', () => {
    const c = new ReadConfirmer();
    const r = read('A', 10, 30);
    expect(c.offer(r, 1)).toBe(r);
  });

  it('holds a heavily corrected read until a second, independent frame decodes identical data', () => {
    const c = new ReadConfirmer();
    const first = read('A', 10, 31);
    expect(c.offer(first, 1)).toBeNull();
    // The same video frame again is not independent evidence.
    expect(c.offer(read('A', 12, 31), 1)).toBeNull();
    // A different frame with different data replaces the held read; nothing is submitted.
    expect(c.offer(read('B', 0, 60), 2)).toBeNull();
    // Another frame confirming B: submitted, the least corrected of the two.
    const confirm = read('B', 20, 20);
    expect(c.offer(confirm, 3)).toBe(confirm);
  });

  it('confirms a held heavy read with a light read of the same data, and lets a light read of other data through', () => {
    const c = new ReadConfirmer();
    expect(c.offer(read('A', 0, 70), 1)).toBeNull();
    const light = read('A', 2, 0);
    expect(c.offer(light, 2)).toBe(light);
    c.reset();
    expect(c.offer(read('A', 0, 70), 1)).toBeNull();
    const other = read('C', 1, 0);
    expect(c.offer(other, 2)).toBe(other);
    // After a reset nothing is held.
    c.reset();
    expect(c.offer(read('A', 30, 10), 5)).toBeNull();
  });
});

describe('camera zoom', () => {
  it('applies about 2× by default, clamped to the track range and snapped to its step', () => {
    expect(DEFAULT_ZOOM).toBe(2);
    expect(defaultZoomLevel(null)).toBeNull();
    expect(defaultZoomLevel({ min: 1, max: 8, step: 0.1 })).toBe(2);
    expect(defaultZoomLevel({ min: 1, max: 1.6, step: 0.1 })).toBe(1.6);
    expect(defaultZoomLevel({ min: 1, max: 10, step: 0.75 })).toBe(1.75);
    expect(defaultZoomLevel({ min: 1, max: 5, step: 0 })).toBe(2);
    // No gain over the minimum (or a range in other units, e.g. 100–400): leave the camera alone.
    expect(defaultZoomLevel({ min: 100, max: 400, step: 1 })).toBeNull();
    expect(defaultZoomLevel({ min: 2, max: 2, step: 0.1 })).toBeNull();
    expect(defaultZoomLevel({ min: 1, max: Number.NaN, step: 0.1 })).toBeNull();
  });

  it('labels the zoom control with the level it switches to', () => {
    expect(zoomLabel(2)).toBe('2×');
    expect(zoomLabel(1)).toBe('1×');
    expect(zoomLabel(1.6)).toBe('1.6×');
    expect(zoomLabel(1.75)).toBe('1.8×');
  });
});

const decoded = (over: Partial<DecodedCode> = {}): DecodedCode => ({
  code: 'A'.repeat(106),
  codeVersion: 1,
  genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 8], confidence: [0.9, 0.8, 0.95, 1, 0.7, 0.66666, 0.5, 0.99] },
  quality: { rsErrors: 3, rsErasures: 0, moduleSizePx: 7.931, contrast: 0.7, inverted: false, mirrored: false },
  ...over,
});

describe('buildVerifyInput', () => {
  it('builds a body the server schema accepts', () => {
    const input = buildVerifyInput(decoded(), 'camera', 123.6);
    expect(input).toEqual({
      code: 'A'.repeat(106),
      genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 8], confidence: [0.9, 0.8, 0.95, 1, 0.7, 0.667, 0.5, 0.99] },
      client: { source: 'camera', rsErrors: 3, rsErasures: 0, moduleSizePx: 7.93, decodeMs: 124 },
    });
    expect(() => parse(verifyBody, input)).not.toThrow();
  });

  it('keeps unread glyphs as null and clamps odd numbers into the schema bounds', () => {
    const input = buildVerifyInput(
      decoded({
        genome: { glyphs: [1, null, 3, 99, -1, 2.5, 7, 8], confidence: [2, -1, Number.NaN, 0.5, 0.5, 0.5, 0.5, 0.5] },
        quality: { rsErrors: 999, rsErasures: -4, moduleSizePx: 1e9, contrast: 1, inverted: true, mirrored: true },
      }),
      'upload',
      1e12,
    );
    expect(input.genome).toEqual({ glyphs: [1, null, 3, null, null, null, 7, 8], confidence: [1, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5] });
    expect(input.client).toEqual({ source: 'upload', rsErrors: 255, rsErasures: 0, moduleSizePx: 10_000, decodeMs: 600_000 });
    expect(() => parse(verifyBody, input)).not.toThrow();
  });

  it('omits a genome reading that is not eight glyphs, and confidences of the wrong length', () => {
    expect(buildVerifyInput(decoded({ genome: null }), 'camera').genome).toBeUndefined();
    expect(buildVerifyInput(decoded({ genome: { glyphs: [1, 2, 3], confidence: [] } }), 'camera').genome).toBeUndefined();
    expect(buildVerifyInput(decoded({ genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 8], confidence: [1] } }), 'camera').genome).toEqual({
      glyphs: [1, 2, 3, 4, 5, 6, 7, 8],
    });
  });
});

describe('frame decoder (worker step)', () => {
  const rgbaOf = (gray: { width: number; height: number; data: Uint8Array }) => {
    const rgba = grayToRgba(gray);
    const buffer = new ArrayBuffer(rgba.byteLength);
    new Uint8Array(buffer).set(rgba);
    return buffer;
  };

  it('reads a rendered CODE-01 and returns exactly the bytes /api/v1/verify expects', () => {
    const code = makeCode(11);
    const gray = svgToGray(renderOrbesCodeSvg(code.model), { widthPx: 600 });
    const req: DecodeRequest = {
      type: 'decode',
      id: 7,
      width: gray.width,
      height: gray.height,
      buffer: rgbaOf(gray),
      options: { tryInverted: true, tryMirrored: false, readGenome: true },
    };
    expect(isDecodeRequest(req)).toBe(true);
    const reply = handleDecode(req);
    expect(reply.id).toBe(7);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.decoded.code).toBe(toBase64Url(code.data));
    expect(reply.decoded.codeVersion).toBe(1);
    expect(reply.decoded.genome?.glyphs).toEqual(code.genomeGlyphs);
    expect(reply.timing.totalMs).toBeGreaterThanOrEqual(reply.timing.decodeMs);
    const input = buildVerifyInput(reply.decoded, 'upload', reply.timing.totalMs);
    expect(() => parse(verifyBody, input)).not.toThrow();
  });

  it('reports a frame without a code as a failure, never throwing', () => {
    const w = 320;
    const h = 240;
    const buffer = new ArrayBuffer(w * h * 4);
    new Uint8Array(buffer).fill(200);
    const reply = handleDecode({ type: 'decode', id: 1, width: w, height: h, buffer, options: { tryInverted: true, tryMirrored: false, readGenome: true } });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(['NO_SEAL', 'NO_MOONS']).toContain(reply.reason);
  });

  it('validates requests structurally', () => {
    const ok = { type: 'decode', id: 1, width: 2, height: 2, buffer: new ArrayBuffer(16), options: {} };
    expect(isDecodeRequest(ok)).toBe(true);
    expect(isDecodeRequest(null)).toBe(false);
    expect(isDecodeRequest({ ...ok, type: 'other' })).toBe(false);
    expect(isDecodeRequest({ ...ok, id: 1.5 })).toBe(false);
    expect(isDecodeRequest({ ...ok, buffer: new ArrayBuffer(15) })).toBe(false);
    expect(isDecodeRequest({ ...ok, buffer: new Uint8Array(16) })).toBe(false);
    expect(isDecodeRequest({ ...ok, width: 0 })).toBe(false);
    expect(isDecodeRequest({ ...ok, options: undefined })).toBe(false);
    const huge = Math.ceil(Math.sqrt(MAX_FRAME_PIXELS)) + 1;
    expect(isDecodeRequest({ ...ok, width: huge, height: huge, buffer: new ArrayBuffer(4) })).toBe(false);
  });
});
