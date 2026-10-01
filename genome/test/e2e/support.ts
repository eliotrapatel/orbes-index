/**
 * End-to-end camera harness (test/e2e/**): the real server and the real web
 * build, a Chromium fake camera fed with simulated phone video of real
 * issued codes, page instrumentation for timing, and metric files.
 *
 *   startE2EServer()   web build through the CLI (scripts/build-web.ts --out
 *                      <tmp>), in-memory database, seeded catalogue,
 *                      buildApp(serveStatic) listening on 127.0.0.1:<ephemeral>
 *   cameraClipFrames() hand-held portrait frames (camera simulator) of a code,
 *                      with slow periodic motion so Chromium's loop is seamless
 *   launchCamera()     Chromium with --use-fake-device-for-media-stream and a Y4M
 *   mobileContext()    390×844 CSS px, deviceScaleFactor 3, isMobile, hasTouch
 *   INSTRUMENTATION    init script recording getUserMedia, decoder worker
 *                      traffic, screen changes and taps on the page clock
 *
 * Kept separate from test/web/verify.harness.ts (owned by the web app
 * engineer) so that the two suites can evolve independently.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { encodeOrbesCode, renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData, unframeCodeData } from '../../src/core/payload.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import type { IssueProductInput, IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { simulateCapture, type CaptureParams } from '../support/camera-sim.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { svgToGray, type GrayImage } from '../support/raster.js';
import { WARMUP_FRAME_SIDE } from '../../src/web/verify/warmup.js';

const execFileP = promisify(execFile);

export const GENOME_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const E2E_OUT_DIR = join(GENOME_DIR, 'out', 'e2e');
export const CHROMIUM_PATH = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** iPhone 12–15: 390×844 CSS px at 3× (1170×2532 device px). */
export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 } as const;
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// ── Server ─────────────────────────────────────────────────────────────────

export interface E2EServer {
  origin: string;
  ctx: AppContext;
  app: FastifyInstance;
  workDir: string;
  webDir: string;
  /** Wall time of the web build through the CLI. */
  buildMs: number;
  issue(extra?: Partial<IssueProductInput>): Promise<IssueResult>;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Build the web apps with the real CLI into a private directory (never the
 * shared dist/web other suites may be serving), then start the API + static
 * server on an ephemeral port with a seeded catalogue (J · ORBIT · MONOLITHE).
 */
export async function startE2EServer(): Promise<E2EServer> {
  const workDir = mkdtempSync(join(tmpdir(), 'orbes-e2e-'));
  const webDir = join(workDir, 'web');
  const t0 = performance.now();
  await execFileP(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', '--out', webDir], { cwd: GENOME_DIR, timeout: 90_000 });
  const buildMs = performance.now() - t0;

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let t: TestDb | undefined;
  let ctx: AppContext | undefined;
  let app: FastifyInstance | undefined;
  try {
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, rateLimits: { verifyPerMinute: 1_000, authPerMinute: 1_000, adminPerMinute: 1_000 } });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    const c = ctx;
    if (!(await c.categories.getByCode('J'))) await c.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    const category = (await c.categories.getByCode('J'))!;
    const collection = await c.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    const model = await c.db
      .insertInto('models')
      .values({
        category_id: category.index,
        collection_id: collection.id,
        name: 'MONOLITHE',
        type: 'RING',
        sku_prefix: 'MNL',
        default_material: '925 STERLING SILVER',
        care_instructions: 'Wipe with a soft, dry cloth after wearing.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    app = await buildApp(ctx, { serveStatic: true, staticDir: webDir });
    await app.listen({ port, host: '127.0.0.1' });
    const a = app;
    const db = t;
    return {
      origin,
      ctx: c,
      app: a,
      workDir,
      webDir,
      buildMs,
      issue: (extra = {}) =>
        c.services.issuance.issueProduct(
          { categoryCode: 'J', modelId: model.id, collectionId: collection.id, material: '925 STERLING SILVER', year: 2026, ...extra },
          SYSTEM_ACTOR,
        ),
      async close() {
        await a.close();
        await c.close();
        await db.close();
        rmSync(workDir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await app?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await t?.close().catch(() => {});
    rmSync(workDir, { recursive: true, force: true });
    throw e;
  }
}

// ── Codes ──────────────────────────────────────────────────────────────────

export interface PrintedCode {
  /** The 79-byte framed data the artifact carries. */
  data: Uint8Array;
  genomeGlyphs: number[];
}

export function printedCodeOf(issued: IssueResult): PrintedCode {
  return { data: fromBase64Url(issued.code.data), genomeGlyphs: [...issued.genome.glyphs] };
}

/**
 * A counterfeiter's best effort at a new identity: a genuine code with its
 * signed serial changed (+1) and the genome redrawn for the claimed identity,
 * so the artifact is self-consistent and decodes cleanly. Only the Ed25519
 * signature can tell: the server must answer INVALID_SIGNATURE.
 */
export function forgeSerial(issued: IssueResult): PrintedCode & { code: string } {
  const { signature, payload } = unframeCodeData(fromBase64Url(issued.code.data));
  const identity = { ...payload.identity, serial: payload.identity.serial + 1 };
  const data = frameCodeData(encodePayload({ ...payload, identity }), signature);
  return { data, genomeGlyphs: computeGenome(packIdentity(identity)).glyphs, code: toBase64Url(data) };
}

/** A genuine payload whose signature has one flipped bit (a damaged or hand-made signature). */
export function forgeSignature(issued: IssueResult): PrintedCode & { code: string } {
  const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
  const sig = signature.slice();
  sig[17] ^= 0x04;
  const data = frameCodeData(payloadBytes, sig);
  return { data, genomeGlyphs: [...issued.genome.glyphs], code: toBase64Url(data) };
}

/** The printed artifact (classic ink on white, decor on) rasterised to luma. */
export function codeSource(code: PrintedCode, widthPx = 800): GrayImage {
  const model = encodeOrbesCode({ data: code.data, genomeGlyphs: code.genomeGlyphs }, { decor: true });
  return svgToGray(renderOrbesCodeSvg(model, { ink: '#0a0a0a', paper: '#ffffff' }), { widthPx });
}

/** A blank hang tag (same stock, no code): the negative control. */
export function blankSource(widthPx = 800): GrayImage {
  return { width: widthPx, height: widthPx, data: new Uint8Array(widthPx * widthPx).fill(255) };
}

// ── Simulated captures ─────────────────────────────────────────────────────

/**
 * Hand-held phone video of a printed hang tag on a desk, portrait (the rear
 * camera of a phone held upright delivers 720×1280 or 1080×1920): the
 * typicalPhone conditions of the camera simulator (perspective, barrel
 * distortion, clutter, paper texture, uneven light, vignetting, defocus,
 * sensor noise, JPEG) with the code filling the on-screen orbit the way the
 * scan guide asks.
 */
export const PORTRAIT_HANDHELD: Readonly<CaptureParams> = Object.freeze<CaptureParams>({
  frame: { width: 720, height: 1280 },
  codeWidthPx: 360,
  rotationDeg: 9,
  tiltXDeg: 10,
  tiltYDeg: -7,
  barrelK1: 0.02,
  sheetMargin: 0.35,
  background: { kind: 'clutter' },
  substrate: 'paper',
  paperLevel: 0.87,
  inkLevel: 0.1,
  illumination: { angleDeg: 300, strength: 0.15 },
  vignette: 0.22,
  blurSigma: 0.85,
  noise: { sigma: 1.6, shot: 0.04 },
  jpegQuality: 85,
});

/**
 * `n` frames of slow, periodic hand motion (a closed loop, so Chromium's
 * looping of the file shows no jump): ±14 px drift, ±1.2° roll, ±2° tilt,
 * and a little shake blur on every third frame. Deterministic per `seed`.
 */
export function cameraClipFrames(source: GrayImage, opts: { n?: number; seed?: number; base?: CaptureParams } = {}): GrayImage[] {
  const n = opts.n ?? 8;
  const base = opts.base ?? PORTRAIT_HANDHELD;
  const frames: GrayImage[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    frames.push(
      simulateCapture(
        source,
        {
          ...base,
          offset: { x: 14 * Math.sin(a), y: 10 * Math.cos(a) },
          rotationDeg: (base.rotationDeg ?? 0) + 1.2 * Math.sin(a),
          tiltXDeg: (base.tiltXDeg ?? 0) + 2 * Math.cos(a),
          tiltYDeg: (base.tiltYDeg ?? 0) + 1.5 * Math.sin(a),
          ...(i % 3 === 2 ? { motionBlur: { lengthPx: 2.5, angleDeg: 70 } } : {}),
        },
        (opts.seed ?? 1) * 1000 + i,
      ),
    );
  }
  return frames;
}

/**
 * The hand arriving: `moving` frames of the tag sliding into the orbit with
 * strong shake blur (unreadable by design), then the steady clip. Played
 * from its first frame when the camera opens, it measures how quickly the
 * scanner recovers once the code becomes readable.
 */
export function settlingClipFrames(
  source: GrayImage,
  opts: { moving?: number; steady?: number; seed?: number; steadyFrames?: readonly GrayImage[] } = {},
): { frames: GrayImage[]; moving: number } {
  const moving = opts.moving ?? 6;
  const frames: GrayImage[] = [];
  for (let i = 0; i < moving; i++) {
    const k = 1 - i / moving; // 1 → far off, approaching the centre
    frames.push(
      simulateCapture(
        source,
        {
          ...PORTRAIT_HANDHELD,
          offset: { x: 150 * k + 20, y: 260 * k + 20 },
          rotationDeg: 9 + 10 * k,
          motionBlur: { lengthPx: 26, angleDeg: 30 },
          blurSigma: 1.6,
        },
        (opts.seed ?? 5) * 1000 + i,
      ),
    );
  }
  frames.push(...(opts.steadyFrames ?? cameraClipFrames(source, { n: opts.steady ?? 8, seed: (opts.seed ?? 5) + 1 })));
  return { frames, moving };
}

/** A still phone photo (≈3 MP, landscape) of the tag, for the upload path. */
export function phonePhoto(source: GrayImage, seed = 7): GrayImage {
  return simulateCapture(
    source,
    {
      ...PORTRAIT_HANDHELD,
      frame: { width: 2016, height: 1512 },
      codeWidthPx: 620,
      offset: { x: 90, y: -40 },
      rotationDeg: -14,
      blurSigma: 1.1,
      jpegQuality: 88,
    },
    seed,
  );
}

// ── Browser ────────────────────────────────────────────────────────────────

/**
 * Chromium with a fake camera that plays `clip` (Y4M, looped). `fakeUi`
 * accepts the permission prompt automatically (--use-fake-ui-for-media-stream);
 * without it, permissions are decided per context (grants, CDP) or by `args`.
 */
export async function launchCamera(clip: string, opts: { fakeUi?: boolean; args?: string[] } = {}): Promise<Browser> {
  const args = ['--no-sandbox', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`];
  if (opts.fakeUi !== false) args.push('--use-fake-ui-for-media-stream');
  return chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: [...args, ...(opts.args ?? [])] });
}

export async function launchPlain(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
}

export async function mobileContext(
  browser: Browser,
  opts: { reducedMotion?: 'reduce' | 'no-preference'; permissions?: string[] } = {},
): Promise<BrowserContext> {
  return browser.newContext({
    ...MOBILE,
    viewport: { ...MOBILE.viewport },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    reducedMotion: opts.reducedMotion ?? 'no-preference',
    locale: 'en-GB',
    timezoneId: 'Europe/Paris',
    ...(opts.permissions ? { permissions: opts.permissions } : {}),
  });
}

/**
 * Deny the camera for `origin` in this page's browser context only (as if the
 * visitor chose "Block" on an earlier visit). Chromium drops CDP permission
 * overrides when the session detaches, so keep it until `release()`.
 */
export async function blockCamera(browser: Browser, page: Page, origin: string): Promise<{ release(): Promise<void> }> {
  const session = await page.context().newCDPSession(page);
  const { targetInfo } = (await session.send('Target.getTargetInfo')) as { targetInfo: { browserContextId?: string } };
  await session.detach();
  if (!targetInfo.browserContextId) throw new Error('blockCamera: no browser context id for the page');
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Browser.setPermission', { permission: { name: 'camera' }, setting: 'denied', origin, browserContextId: targetInfo.browserContextId });
  return { release: () => cdp.detach() };
}

// ── Instrumentation ────────────────────────────────────────────────────────

export interface TimelineReply {
  t: number;
  id: number;
  ok: boolean;
  reason?: string;
  timing?: { grayMs: number; decodeMs: number; totalMs: number };
}

export interface Timeline {
  clicks: { t: number; text: string }[];
  gum: { start: number; end?: number; ok?: boolean; error?: string; settings?: { width?: number; height?: number; frameRate?: number } }[];
  frames: { t: number; id: number; w: number; h: number }[];
  replies: TimelineReply[];
  /** The landing page's decoder warm-up decode (not a camera or photo frame), once posted. */
  warmup: { t: number; id: number; reply: TimelineReply | null } | null;
  screens: { t: number; screen: string }[];
  locked: number | null;
  video: { t: number; type: string }[];
  /** File inputs that changed (a photo was chosen). */
  inputs: { t: number; id: string }[];
  stoppedTracks: number;
}

/**
 * Runs before any page script (Playwright init scripts are exempt from the
 * page CSP). Plain JS on purpose: the bundler must not touch it. Everything
 * is timed with performance.now() on the page clock.
 */
export const INSTRUMENTATION = `(() => {
  const now = () => performance.now();
  const T = (window.__orbesE2E = { clicks: [], gum: [], frames: [], replies: [], warmup: null, screens: [], locked: null, video: [], inputs: [], stoppedTracks: 0 });
  document.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'file') T.inputs.push({ t: now(), id: e.target.id || '' });
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    T.clicks.push({ t: now(), text: b ? (b.textContent || '').trim() : '' });
  }, true);
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === 'function') {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      const rec = { start: now() };
      T.gum.push(rec);
      try {
        const s = await orig(c);
        rec.end = now();
        rec.ok = true;
        const track = s.getVideoTracks()[0];
        if (track) {
          const st = track.getSettings();
          rec.settings = { width: st.width, height: st.height, frameRate: st.frameRate };
          const stop = track.stop.bind(track);
          track.stop = () => { T.stoppedTracks++; stop(); };
        }
        return s;
      } catch (e) {
        rec.end = now();
        rec.ok = false;
        rec.error = e && e.name;
        throw e;
      }
    };
  }
  const W = window.Worker;
  if (typeof W === 'function') {
    window.Worker = class extends W {
      constructor(url, opts) {
        super(url, opts);
        this.addEventListener('message', (ev) => {
          const m = ev.data;
          if (!m || m.type !== 'result') return;
          const reply = { t: now(), id: m.id, ok: m.ok === true, reason: m.reason, timing: m.timing };
          if (T.warmup && T.warmup.id === m.id && !T.warmup.reply) T.warmup.reply = reply;
          else T.replies.push(reply);
        });
      }
      postMessage(msg, transfer) {
        // The landing page's decoder warm-up (src/web/verify/warmup.ts, 200 × 200, first decode of the page) is kept apart.
        if (msg && msg.type === 'decode' && T.warmup === null && T.frames.length === 0 && msg.width === ${WARMUP_FRAME_SIDE} && msg.height === ${WARMUP_FRAME_SIDE}) T.warmup = { t: now(), id: msg.id, reply: null };
        else if (msg && msg.type === 'decode') T.frames.push({ t: now(), id: msg.id, w: msg.width, h: msg.height });
        return super.postMessage(msg, transfer);
      }
    };
  }
  for (const type of ['loadeddata', 'playing']) document.addEventListener(type, () => T.video.push({ t: now(), type }), true);
  let last = null;
  const watch = () => {
    const s = document.body && document.body.dataset.screen;
    if (s && s !== last) { last = s; T.screens.push({ t: now(), screen: s }); }
    if (T.locked === null && document.querySelector('.view--scan.is-locked')) T.locked = now();
  };
  new MutationObserver(watch).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-screen'] });
})();`;

export async function readTimeline(page: Page): Promise<Timeline> {
  return page.evaluate(() => (window as unknown as { __orbesE2E: Timeline }).__orbesE2E);
}

/** Milestones of one camera scan, in ms on the page clock (null when not reached). */
export interface ScanTiming {
  /** Tap on SCAN ORBES CODE → getUserMedia called (screen transition). */
  tapToCameraRequest: number | null;
  /** getUserMedia call → stream live (device start). */
  cameraOpen: number | null;
  /** Stream live → first frame sent to the decoder worker. */
  liveToFirstFrame: number | null;
  /** Camera START (getUserMedia call) → first successful decode reply: the time-to-recognition. */
  recognition: number | null;
  /** Stream live → first successful decode reply. */
  liveToDecoded: number | null;
  /** Decoded → result screen shown (lock pause, POST /verify, screen change). */
  decodedToResult: number | null;
  /** Tap → result screen shown: the time-to-result. */
  tapToResult: number | null;
  /** Frames sent to the worker up to and including the first successful one. */
  framesToRecognition: number | null;
  /** Worker-side decode time of each frame sent (ms). */
  workerDecodeMs: number[];
  resultScreen: string | null;
}

export function scanTiming(t: Timeline, tapText = 'SCAN ORBES CODE'): ScanTiming {
  const tap = [...t.clicks].reverse().find((c) => c.text === tapText)?.t ?? null;
  const gum = [...t.gum].reverse().find((g) => tap === null || g.start >= tap) ?? null;
  const live = gum?.ok ? (gum.end ?? null) : null;
  const okReply = t.replies.find((r) => r.ok && (gum === null || r.t >= gum.start)) ?? null;
  const firstFrame = t.frames.find((f) => live !== null && f.t >= live) ?? null;
  const result = t.screens.find((s) => (s.screen === 'result' || s.screen === 'message') && okReply !== null && s.t >= okReply.t) ?? null;
  const d = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : round(b - a));
  return {
    tapToCameraRequest: d(tap, gum?.start),
    cameraOpen: d(gum?.start, live),
    liveToFirstFrame: d(live, firstFrame?.t),
    recognition: d(gum?.start, okReply?.t),
    liveToDecoded: d(live, okReply?.t),
    decodedToResult: d(okReply?.t, result?.t),
    tapToResult: d(tap, result?.t),
    framesToRecognition: okReply ? t.frames.filter((f) => f.id <= okReply.id && (gum === null || f.t >= gum.start)).length : null,
    workerDecodeMs: t.replies.filter((r) => gum === null || r.t >= gum.start).map((r) => round(r.timing?.decodeMs ?? NaN)),
    resultScreen: result?.screen ?? null,
  };
}

/** Milestones of one photo upload, in ms on the page clock. */
export interface UploadTiming {
  /** Photo chosen → first successful decode reply (image decode, crops, worker). */
  chosenToDecoded: number | null;
  /** Photo chosen → result screen. */
  chosenToResult: number | null;
  /** Decode attempts (whole photo, then centred crops) up to the first success. */
  attempts: number;
  workerDecodeMs: number[];
}

export function uploadTiming(t: Timeline): UploadTiming {
  const chosen = t.inputs.at(-1)?.t ?? null;
  const replies = t.replies.filter((r) => chosen !== null && r.t >= chosen);
  const ok = replies.find((r) => r.ok) ?? null;
  const result = t.screens.find((s) => chosen !== null && s.t >= chosen && (s.screen === 'result' || s.screen === 'message')) ?? null;
  return {
    chosenToDecoded: ok && chosen !== null ? round(ok.t - chosen) : null,
    chosenToResult: result && chosen !== null ? round(result.t - chosen) : null,
    attempts: ok ? replies.indexOf(ok) + 1 : replies.length,
    workerDecodeMs: replies.map((r) => round(r.timing?.decodeMs ?? NaN)),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Metrics ────────────────────────────────────────────────────────────────

/**
 * Merge `data` under `key` into genome/out/e2e/<file>.json. One file per
 * test file: vitest runs files in parallel processes.
 */
export function recordMetrics(file: string, key: string, data: unknown): void {
  mkdirSync(E2E_OUT_DIR, { recursive: true });
  const path = join(E2E_OUT_DIR, `${file}.json`);
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    all = {};
  }
  all[key] = data;
  all._updated = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
}

export function summarize(values: readonly number[]): { n: number; min: number; median: number; max: number; mean: number } {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, min: NaN, median: NaN, max: NaN, mean: NaN };
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return { n, min: round(v[0]), median: round(median), max: round(v[n - 1]), mean: round(v.reduce((a, b) => a + b, 0) / n) };
}
