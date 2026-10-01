import { describe, expect, it } from 'vitest';
import { renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { toBase64Url } from '../../src/core/bytes.js';
import { parse, verifyBody } from '../../src/server/http/schemas.js';
import {
  buildVerifyInput,
  CAMERA_MAX_SIDE,
  cameraCrop,
  FRAME_INTERVAL_MS,
  FrameThrottle,
  HINT_AFTER_MS,
  RETICLE_MARGIN,
  scanHint,
  UPLOAD_MAX_SIDE,
  uploadCrops,
} from '../../src/web/verify/capture.js';
import { handleDecode } from '../../src/web/verify/frame-decoder.js';
import { isDecodeRequest, MAX_FRAME_PIXELS, type DecodeRequest, type DecodedCode } from '../../src/web/verify/protocol.js';
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
  it('stays quiet at first, then guides by the last failure', () => {
    expect(scanHint('NO_SEAL', HINT_AFTER_MS - 1)).toBeNull();
    expect(scanHint(null, HINT_AFTER_MS * 3)).toBeNull();
    expect(scanHint('NO_SEAL', HINT_AFTER_MS)).toBe('align');
    expect(scanHint('NO_MOONS', HINT_AFTER_MS)).toBe('closer');
    for (const r of ['FORMAT', 'ECC', 'CRC', 'PAYLOAD'] as const) expect(scanHint(r, HINT_AFTER_MS)).toBe('steady');
    expect(scanHint('INTERNAL', HINT_AFTER_MS)).toBe('align');
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
