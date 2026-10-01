/**
 * Decoder Web Worker: RGBA frame in, ORBES CODE data out.
 *
 * Runs the isomorphic core decoder (src/core/decoder) off the main thread so
 * the camera preview and the reticle animation stay fluid while a frame is
 * examined (≈ 50–300 ms on a phone). The worker never verifies anything: it
 * reads bytes and reports them; the server decides (PLATFORM-CONTRACTS §2.4).
 *
 * Protocol: protocol.ts. One request at a time is expected (the page applies
 * backpressure), but every request is answered with its own id regardless.
 */
import { handleDecode } from './frame-decoder.js';
import { isDecodeRequest, type DecodeReply } from './protocol.js';

/** The slice of DedicatedWorkerGlobalScope used here (the DOM lib does not describe workers). */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (ev: MessageEvent) => {
  const m: unknown = ev.data;
  if (!isDecodeRequest(m)) {
    const id = m && typeof m === 'object' && Number.isInteger((m as { id?: unknown }).id) ? (m as { id: number }).id : -1;
    const reply: DecodeReply = { type: 'result', id, ok: false, reason: 'INPUT', timing: { grayMs: 0, decodeMs: 0, totalMs: 0 } };
    scope.postMessage(reply);
    return;
  }
  const reply = handleDecode(m);
  // Hand the frame buffer back (zero copy) so the page knows it is free again.
  reply.buffer = m.buffer;
  scope.postMessage(reply, [m.buffer]);
});

scope.postMessage({ type: 'ready' });
