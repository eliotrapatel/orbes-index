/**
 * Camera, frame capture and the decoder worker client.
 *
 *   Camera        getUserMedia (rear camera, 1080p ideal, continuous focus),
 *                 torch and zoom through applyConstraints when supported.
 *   DecoderClient the Web Worker (worker.ts): one frame in flight at a time,
 *                 frames sent as transferable RGBA buffers, a watchdog that
 *                 restarts a worker stuck on a pathological frame.
 *   ScanSession   the frame pump: every video frame (requestVideoFrameCallback
 *                 when available), at most every 120 ms and only while the
 *                 worker is idle, the square under the reticle is drawn to a
 *                 canvas (scaled to ≤ 960 px) and sent for decoding.
 *   readPhoto     the upload fallback: whole photo, then centred crops.
 *
 * Pure decisions (crop geometry, pacing, hints, error classification) live in
 * capture.ts and copy.ts, where they are unit tested.
 */
import { cameraCrop, DECODE_WATCHDOG_MS, FrameThrottle, HINT_AFTER_MS, SCAN_TIMEOUT_MS, scanHint, uploadCrops, type CropPlan, type ScanHint } from './capture.js';
import { classifyCameraError, type ProblemKind } from './copy.js';
import type { DecodeFailureReason, DecodeReply, DecodeRequest, WorkerMessage } from './protocol.js';

// ── Camera ─────────────────────────────────────────────────────────────────

export class CameraError extends Error {
  constructor(readonly kind: ProblemKind, cause?: unknown) {
    super(kind);
    this.name = 'CameraError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
}

/** Non-standard but widely implemented track capabilities/constraints (Chrome Android, Safari 17+). */
interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
}

type ExtendedConstraintSet = MediaTrackConstraintSet & { torch?: boolean; zoom?: number; focusMode?: string };

export function cameraEnvironment(): { isSecureContext: boolean; hasGetUserMedia: boolean } {
  return {
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    hasGetUserMedia: typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function',
  };
}

const PREFERRED: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
    // focusMode is not in the DOM typings; browsers that do not know it ignore an advanced set.
    advanced: [{ focusMode: 'continuous' } as ExtendedConstraintSet],
  },
};

const FALLBACK: MediaStreamConstraints = { audio: false, video: { facingMode: { ideal: 'environment' } } };

export class Camera {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private torchOn = false;
  private attempt = 0;

  get active(): boolean {
    return this.track !== null && this.track.readyState === 'live';
  }

  get torch(): boolean {
    return this.torchOn;
  }

  /** Open the rear camera into `video`. Throws CameraError with a ProblemKind. */
  async start(video: HTMLVideoElement): Promise<CameraCapabilities> {
    const env = cameraEnvironment();
    if (!env.isSecureContext || !env.hasGetUserMedia) throw new CameraError(classifyCameraError(null, env));
    this.stop();
    // A stop() (or a newer start()) while this one awaits makes it stale: its stream is released on arrival.
    const attempt = this.attempt;
    const stale = () => attempt !== this.attempt;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(PREFERRED);
    } catch (e) {
      // Old or unusual devices reject the ideal set as a whole; retry with the bare minimum.
      const name = (e as { name?: string })?.name;
      if (stale() || (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError' && name !== 'TypeError')) {
        throw new CameraError(classifyCameraError(e, env), e);
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia(FALLBACK);
      } catch (e2) {
        throw new CameraError(classifyCameraError(e2, env), e2);
      }
    }
    if (stale()) {
      stopTracks(stream);
      throw new CameraError('camera-failed');
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0] ?? null;
    if (!this.track) {
      this.stop();
      throw new CameraError('camera-missing');
    }

    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.srcObject = stream;
    try {
      await video.play();
    } catch (e) {
      // Autoplay of a muted inline stream is allowed everywhere we target; a failure here is real
      // (or the camera was stopped meanwhile, which interrupts play()).
      if (!stale()) this.stop();
      throw new CameraError('camera-failed', e);
    }
    await waitForDimensions(video);
    if (stale()) throw new CameraError('camera-failed');

    const caps = this.capabilities();
    // Continuous focus where the constraint exists but was not applied at open time.
    const raw = this.rawCapabilities();
    if (raw?.focusMode?.includes('continuous')) {
      await this.apply({ focusMode: 'continuous' });
    }
    return caps;
  }

  stop(): void {
    this.attempt++;
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    this.track = null;
    this.torchOn = false;
  }

  capabilities(): CameraCapabilities {
    const raw = this.rawCapabilities();
    const zoom = raw?.zoom && Number.isFinite(raw.zoom.max) && raw.zoom.max > (raw.zoom.min ?? 1)
      ? { min: raw.zoom.min ?? 1, max: raw.zoom.max, step: raw.zoom.step ?? 0.1 }
      : null;
    return { torch: raw?.torch === true, zoom };
  }

  async setTorch(on: boolean): Promise<boolean> {
    if (!this.capabilities().torch) return false;
    const ok = await this.apply({ torch: on });
    if (ok) this.torchOn = on;
    return ok;
  }

  async setZoom(level: number): Promise<boolean> {
    const z = this.capabilities().zoom;
    if (!z) return false;
    const clamped = Math.min(z.max, Math.max(z.min, level));
    return this.apply({ zoom: clamped });
  }

  private rawCapabilities(): ExtendedCapabilities | null {
    const t = this.track;
    if (!t || typeof t.getCapabilities !== 'function') return null;
    try {
      return t.getCapabilities() as ExtendedCapabilities;
    } catch {
      return null;
    }
  }

  private async apply(set: ExtendedConstraintSet): Promise<boolean> {
    if (!this.track) return false;
    try {
      await this.track.applyConstraints({ advanced: [set] });
      return true;
    } catch {
      return false;
    }
  }
}

function stopTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

function waitForDimensions(video: HTMLVideoElement, timeoutMs = 4_000): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', check);
      video.removeEventListener('resize', check);
      resolve();
    };
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) done();
    };
    const timer = setTimeout(done, timeoutMs);
    video.addEventListener('loadedmetadata', check);
    video.addEventListener('resize', check);
  });
}

// ── Decoder worker client ──────────────────────────────────────────────────

export class DecoderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecoderUnavailableError';
  }
}

/** The worker bundle's URL: written into <meta name="orbes-worker"> by scripts/build-web.ts. */
export function workerUrl(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="orbes-worker"]');
  const content = meta?.content?.trim();
  if (!content || /\.ts$/.test(content)) throw new DecoderUnavailableError('decoder bundle not configured');
  return new URL(content, document.baseURI).href;
}

interface Pending {
  id: number;
  resolve(r: DecodeReply): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class DecoderClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private nextId = 1;
  private failures = 0;

  constructor(
    private readonly url: string,
    private readonly watchdogMs = DECODE_WATCHDOG_MS,
  ) {}

  get busy(): boolean {
    return this.pending !== null;
  }

  /** Resolve once no frame is in flight (a camera frame may still be decoding when a photo is chosen). */
  async whenIdle(timeoutMs = this.watchdogMs): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    if (this.pending) this.restart();
  }

  /** Start the worker early (landing page) so the first frame is not slowed by its boot. */
  warm(): void {
    try {
      this.ensure();
    } catch {
      // Reported on first use.
    }
  }

  decode(image: ImageData, options: DecodeRequest['options']): Promise<DecodeReply> {
    if (this.pending) return Promise.reject(new Error('decoder busy'));
    const worker = this.ensure();
    const id = this.nextId++;
    const buffer = image.data.buffer as ArrayBuffer;
    const req: DecodeRequest = { type: 'decode', id, width: image.width, height: image.height, buffer, options };
    return new Promise<DecodeReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A frame that takes this long is pathological: restart the worker rather than wait.
        this.restart();
        reject(new Error('decode timed out'));
      }, this.watchdogMs);
      this.pending = { id, resolve, reject, timer };
      try {
        worker.postMessage(req, [buffer]);
      } catch (e) {
        clearTimeout(timer);
        this.pending = null;
        reject(e instanceof Error ? e : new Error('postMessage failed'));
      }
    });
  }

  dispose(): void {
    this.restart();
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    if (this.failures >= 3) throw new DecoderUnavailableError('decoder worker keeps failing');
    if (typeof Worker === 'undefined') throw new DecoderUnavailableError('Web Workers are not available');
    let w: Worker;
    try {
      w = new Worker(this.url, { type: 'module', name: 'orbes-decoder' });
    } catch {
      // Browsers without module workers (Firefox < 114): the bundle has no imports, so it also runs classic.
      w = new Worker(this.url, { name: 'orbes-decoder' });
    }
    w.addEventListener('message', (ev: MessageEvent<WorkerMessage>) => this.onMessage(ev.data));
    w.addEventListener('error', (ev) => {
      ev.preventDefault();
      this.failures++;
      this.fail(new DecoderUnavailableError('decoder worker failed'));
      this.worker = null;
      w.terminate();
    });
    this.worker = w;
    return w;
  }

  private onMessage(m: WorkerMessage): void {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ready') {
      this.failures = 0;
      return;
    }
    const p = this.pending;
    if (m.type !== 'result' || !p || m.id !== p.id) return; // stale reply after a restart
    clearTimeout(p.timer);
    this.pending = null;
    p.resolve(m);
  }

  private fail(e: Error): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    p.reject(e);
  }

  private restart(): void {
    this.fail(new Error('decoder restarted'));
    this.worker?.terminate();
    this.worker = null;
  }
}

// ── Frame pump ─────────────────────────────────────────────────────────────

export interface ScanCallbacks {
  /** A code was read. Scanning has stopped. */
  onDecoded(reply: Extract<DecodeReply, { ok: true }>, decodeMs: number): void;
  /** Guidance changed (null clears it). */
  onHint(hint: ScanHint): void;
  /** Nothing read for SCAN_TIMEOUT_MS. Scanning has stopped. */
  onTimeout(): void;
  /** The decoder cannot run in this browser. Scanning has stopped. */
  onFatal(): void;
}

interface FrameSource {
  video: HTMLVideoElement;
  /** Reticle diameter in CSS pixels (to crop the matching square of the frame). */
  reticleSize(): number;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?(cb: () => void): number;
  cancelVideoFrameCallback?(handle: number): void;
};

export class ScanSession {
  private running = false;
  private handle = 0;
  private usesVfc = false;
  private readonly throttle = new FrameThrottle();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx2d: CanvasRenderingContext2D;
  private startedAt = 0;
  private lastReason: DecodeFailureReason | null = null;
  private lastHint: ScanHint = null;
  private hintTimer: ReturnType<typeof setInterval> | undefined;
  private consecutiveErrors = 0;

  constructor(
    private readonly source: FrameSource,
    private readonly decoder: DecoderClient,
    private readonly callbacks: ScanCallbacks,
  ) {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!ctx) throw new DecoderUnavailableError('2D canvas unavailable');
    this.ctx2d = ctx;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    this.lastReason = null;
    this.lastHint = null;
    this.throttle.reset();
    this.hintTimer = setInterval(() => this.tickHints(), 500);
    this.schedule();
  }

  stop(): void {
    this.running = false;
    clearInterval(this.hintTimer);
    this.hintTimer = undefined;
    const v = this.source.video as VideoWithFrameCallback;
    if (this.usesVfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.handle);
    else cancelAnimationFrame(this.handle);
  }

  private schedule(): void {
    if (!this.running) return;
    const v = this.source.video as VideoWithFrameCallback;
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.usesVfc = true;
      this.handle = v.requestVideoFrameCallback(() => this.onFrame());
    } else {
      this.usesVfc = false;
      this.handle = requestAnimationFrame(() => this.onFrame());
    }
  }

  private tickHints(): void {
    if (!this.running) return;
    const elapsed = performance.now() - this.startedAt;
    if (elapsed >= SCAN_TIMEOUT_MS) {
      this.stop();
      this.callbacks.onTimeout();
      return;
    }
    const hint = elapsed >= HINT_AFTER_MS ? scanHint(this.lastReason, elapsed) : null;
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.callbacks.onHint(hint);
    }
  }

  private onFrame(): void {
    if (!this.running) return;
    this.schedule();
    const video = this.source.video;
    const now = performance.now();
    if (video.readyState < 2 || video.videoWidth === 0 || !this.throttle.ready(now, this.decoder.busy)) return;
    this.throttle.sent(now);

    const rect = video.getBoundingClientRect();
    const plan = cameraCrop({ width: video.videoWidth, height: video.videoHeight }, { width: rect.width, height: rect.height }, this.source.reticleSize());
    let image: ImageData;
    try {
      image = drawCrop(this.canvas, this.ctx2d, video, plan);
    } catch {
      return; // a frame that cannot be drawn (track ending): skip it
    }
    this.decoder
      .decode(image, { tryInverted: true, tryMirrored: false, readGenome: true })
      .then((reply) => {
        if (!this.running) return;
        this.consecutiveErrors = 0;
        if (reply.ok) {
          this.stop();
          this.callbacks.onDecoded(reply, reply.timing.totalMs);
        } else {
          this.lastReason = reply.reason;
        }
      })
      .catch((e: unknown) => {
        if (!this.running) return;
        this.consecutiveErrors++;
        if (e instanceof DecoderUnavailableError || this.consecutiveErrors >= 5) {
          this.stop();
          this.callbacks.onFatal();
        }
      });
  }
}

function drawCrop(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, source: CanvasImageSource, plan: CropPlan): ImageData {
  if (canvas.width !== plan.tw) canvas.width = plan.tw;
  if (canvas.height !== plan.th) canvas.height = plan.th;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Paper behind transparent PNGs: the decoder expects dark ink on light ground.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.tw, plan.th);
  ctx.drawImage(source, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.tw, plan.th);
  return ctx.getImageData(0, 0, plan.tw, plan.th);
}

// ── Photo upload ───────────────────────────────────────────────────────────

/** Photos larger than this are refused before decoding (phones produce ≤ ~15 MB). */
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

export class PhotoError extends Error {
  constructor(readonly kind: 'upload-invalid' | 'upload-unreadable' | 'decoder-failed') {
    super(kind);
    this.name = 'PhotoError';
  }
}

async function loadBitmap(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to <img>, which some browsers decode more formats with (HEIC on Safari).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError('upload-invalid');
  }
}

/** Decode an uploaded photo: the whole image first, then centred crops. */
export async function readPhoto(file: File, decoder: DecoderClient): Promise<{ reply: Extract<DecodeReply, { ok: true }>; decodeMs: number }> {
  if (!file || file.size === 0 || file.size > MAX_PHOTO_BYTES) throw new PhotoError('upload-invalid');
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('upload-invalid');
  const bmp = await loadBitmap(file);
  await decoder.whenIdle();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) throw new PhotoError('decoder-failed');
  let total = 0;
  try {
    if (bmp.width < 16 || bmp.height < 16) throw new PhotoError('upload-unreadable');
    for (const plan of uploadCrops(bmp.width, bmp.height)) {
      const image = drawCrop(canvas, ctx, bmp.source, plan);
      let reply: DecodeReply;
      try {
        reply = await decoder.decode(image, { tryInverted: true, tryMirrored: true, readGenome: true });
      } catch (e) {
        if (e instanceof DecoderUnavailableError) throw new PhotoError('decoder-failed');
        continue; // watchdog: try the next (smaller) crop
      }
      total += reply.timing.totalMs;
      if (reply.ok) return { reply, decodeMs: total };
    }
  } finally {
    bmp.close();
    canvas.width = canvas.height = 0;
  }
  throw new PhotoError('upload-unreadable');
}
