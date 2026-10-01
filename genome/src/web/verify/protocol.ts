/**
 * Messages between the page and the decoder Web Worker (worker.ts).
 *
 * Frames travel as RGBA ArrayBuffers in the transfer list (zero copy); the
 * worker sends the buffer back with its reply so the page can see it was
 * released. Replies carry everything the page needs to call /api/v1/verify:
 * the base64url code, the genome reading and decode quality, never more.
 */

export interface DecodeRequest {
  type: 'decode';
  /** Correlates the reply; also lets the page drop stale replies. */
  id: number;
  width: number;
  height: number;
  /** RGBA, width × height × 4 bytes (transferred). */
  buffer: ArrayBuffer;
  options: { tryInverted: boolean; tryMirrored: boolean; readGenome: boolean };
}

export interface DecodeTiming {
  /** RGBA → luma. */
  grayMs: number;
  /** decodeOrbesCode itself. */
  decodeMs: number;
  /** Message receipt to reply. */
  totalMs: number;
}

export interface DecodedCode {
  /** base64url of the 79-byte framed code data (what /api/v1/verify takes). */
  code: string;
  codeVersion: number;
  genome: { glyphs: (number | null)[]; confidence: number[] } | null;
  quality: { rsErrors: number; rsErasures: number; moduleSizePx: number; contrast: number; inverted: boolean; mirrored: boolean };
}

export type DecodeFailureReason = 'NO_SEAL' | 'NO_MOONS' | 'FORMAT' | 'ECC' | 'CRC' | 'PAYLOAD' | 'INPUT' | 'INTERNAL';

export type DecodeReply =
  | { type: 'result'; id: number; ok: true; decoded: DecodedCode; timing: DecodeTiming; buffer?: ArrayBuffer }
  | {
      type: 'result';
      id: number;
      ok: false;
      reason: DecodeFailureReason;
      /** NO_MOONS: the most code-like seal found (scan guidance only). */
      seal?: { confidence: number; unitPx: number };
      /** FORMAT…PAYLOAD: scale (px per u) of the code located but not read (scan guidance only). */
      moduleSizePx?: number;
      timing: DecodeTiming;
      buffer?: ArrayBuffer;
    };

export interface ReadyMessage {
  type: 'ready';
}

export type WorkerMessage = DecodeReply | ReadyMessage;

/** Upper bound on a frame the worker accepts (≈ 12 MP); larger requests are refused as INPUT. */
export const MAX_FRAME_PIXELS = 12_000_000;

/** Structural check of a request (the worker trusts nothing it receives). */
export function isDecodeRequest(m: unknown): m is DecodeRequest {
  if (!m || typeof m !== 'object') return false;
  const r = m as Partial<DecodeRequest>;
  return (
    r.type === 'decode' &&
    Number.isInteger(r.id) &&
    Number.isInteger(r.width) &&
    Number.isInteger(r.height) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0 &&
    (r.width as number) * (r.height as number) <= MAX_FRAME_PIXELS &&
    r.buffer instanceof ArrayBuffer &&
    r.buffer.byteLength === (r.width as number) * (r.height as number) * 4 &&
    !!r.options &&
    typeof r.options === 'object'
  );
}
