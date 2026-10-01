/**
 * One decode step, shared by the Web Worker (worker.ts) and the Node tests:
 * RGBA frame → luma → core decoder → the reply sent back to the page.
 *
 * Isomorphic (no DOM, no Node APIs). Never throws: every failure is a reply.
 */
import { toBase64Url } from '../../core/bytes.js';
import { decodeOrbesCode, rgbaToGray } from '../../core/decoder/index.js';
import type { DecodeFailureReason, DecodeReply, DecodeRequest, DecodedCode } from './protocol.js';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function handleDecode(req: DecodeRequest): DecodeReply {
  const t0 = now();
  let t1 = t0;
  try {
    const gray = rgbaToGray(new Uint8ClampedArray(req.buffer), req.width, req.height);
    t1 = now();
    const r = decodeOrbesCode(gray, {
      tryInverted: req.options.tryInverted !== false,
      tryMirrored: req.options.tryMirrored === true,
      readGenome: req.options.readGenome !== false,
    });
    const t2 = now();
    const timing = { grayMs: round(t1 - t0), decodeMs: round(t2 - t1), totalMs: round(t2 - t0) };
    if (!r.ok) return { type: 'result', id: req.id, ok: false, reason: r.reason, timing };
    const decoded: DecodedCode = {
      code: toBase64Url(r.data),
      codeVersion: r.codeVersion,
      genome: r.genome ? { glyphs: [...r.genome.glyphs], confidence: [...r.genome.confidence] } : null,
      quality: {
        rsErrors: r.quality.rsErrors,
        rsErasures: r.quality.rsErasures,
        moduleSizePx: round(r.quality.moduleSizePx),
        contrast: round(r.quality.contrast, 3),
        inverted: r.quality.inverted,
        mirrored: r.quality.mirrored,
      },
    };
    return { type: 'result', id: req.id, ok: true, decoded, timing };
  } catch {
    // The decoder itself never throws; this guards the conversion and the reply shaping.
    const t2 = now();
    const reason: DecodeFailureReason = 'INTERNAL';
    return { type: 'result', id: req.id, ok: false, reason, timing: { grayMs: round(t1 - t0), decodeMs: round(t2 - t1), totalMs: round(t2 - t0) } };
  }
}
