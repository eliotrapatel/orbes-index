/**
 * End-to-end camera scan in a real browser.
 *
 *   real issued code ─► encoder + SVG ─► camera simulator (hand-held portrait
 *   video, 8 frames of slow motion) ─► Y4M ─► Chromium fake capture device
 *   ─► /verify (built by scripts/build-web.ts, served by the real server on
 *   an ephemeral port) ─► SCAN ORBES CODE ─► decoder Web Worker ─► POST
 *   /api/v1/verify ─► result view
 *
 * Mobile viewport 390×844 at 3×, touch. Every scan is timed on the page
 * clock by an init script (test/e2e/support.ts INSTRUMENTATION):
 *
 *   recognition      camera start (getUserMedia call) → first successful decode
 *   time-to-result   tap on SCAN ORBES CODE → result screen
 *
 * The target is recognition < 1 s (ARCHITECTURE.md, PLATFORM-CONTRACTS §4).
 * A shared, loaded VM makes wall-clock assertions noisy, so the hard
 * assertions are load-independent (every frame of the clip is readable, so
 * the first or second frame sent must be read) plus a generous ceiling per
 * scan; the target is asserted on the best of the repeated runs while the
 * load stays under 1.5 per CPU (recorded otherwise), and on the median with
 * ORBES_E2E_STRICT=1.
 * Numbers go to genome/out/e2e/camera-scan.json, screenshots to genome/out/e2e/.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import type { Browser, ConsoleMessage, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import type { GrayImage } from '../support/raster.js';
import { writePng } from '../support/image-io.js';
import { writeY4m } from '../support/y4m.js';
import {
  CHROMIUM_PATH,
  E2E_OUT_DIR,
  INSTRUMENTATION,
  cameraClipFrames,
  codeSource,
  forgeSerial,
  launchCamera,
  mobileContext,
  printedCodeOf,
  readTimeline,
  recordMetrics,
  scanTiming,
  settlingClipFrames,
  startE2EServer,
  summarize,
  type E2EServer,
  type ScanTiming,
} from './support.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const METRICS = 'camera-scan';
const FPS = 15;
/** Contract target for camera recognition. */
const RECOGNITION_TARGET_MS = 1_000;
/** Per-scan ceiling that only a real regression (or a stalled VM) exceeds. */
const CEILING_MS = Number(process.env.ORBES_E2E_CEILING_MS ?? 6_000);
const STRICT = process.env.ORBES_E2E_STRICT === '1';
const RUNS = 4;
/**
 * The 1 s target is asserted (on the best run) only when the machine is not
 * oversubscribed: on a shared VM running other suites in parallel, a missed
 * target says more about the neighbours than about the scanner. The load is
 * recorded with the numbers either way.
 */
const LOAD_PER_CPU_LIMIT = 1.5;
const loadPerCpu = () => Math.round((loadavg()[0] / Math.max(1, cpus().length)) * 100) / 100;

/** Which frames of a clip the core decoder reads in Node (full frame, no crop): a property of the clip, not of the browser. */
function readableFrames(frames: readonly GrayImage[]): boolean[] {
  return frames.map((f) => decodeOrbesCode(f, { tryInverted: true, readGenome: false }).ok);
}

const POLL = { timeout: 20_000, interval: 50 };
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}

interface Opened {
  page: Page;
  problems: string[];
  close(): Promise<void>;
}

/** Console noise that is expected: Chromium logs 4xx API answers (the signed-out /account/me) as failed resources. */
const expectedConsole = (m: ConsoleMessage) => m.type() !== 'error' || /Failed to load resource: the server responded with a status of 4\d\d/.test(m.text());

async function openVerify(browser: Browser, srv: E2EServer, reducedMotion: 'reduce' | 'no-preference'): Promise<Opened> {
  const ctx = await mobileContext(browser, { reducedMotion });
  await ctx.addInitScript({ content: INSTRUMENTATION });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (!expectedConsole(m) || /Content Security Policy/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const res = await page.goto(`${srv.origin}/verify`);
  expect(res?.status()).toBe(200);
  await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
  // The landing warms the decoder at idle time (one synthetic decode); a visitor reads the page for a moment first.
  await page.waitForTimeout(300);
  await expect.poll(async () => (await readTimeline(page)).warmup?.reply?.ok ?? null, { timeout: 10_000, interval: 50 }).toBe(true);
  return { page, problems, close: () => ctx.close() };
}

/** Tap SCAN, wait for the result (or problem) screen, and return its title and the scan timing. */
async function scan(page: Page): Promise<{ title: string; timing: ScanTiming }> {
  await page.getByRole('button', { name: 'SCAN ORBES CODE' }).tap();
  await page.locator('.view--result, .view--message').first().waitFor({ timeout: 30_000 });
  const title = norm(await page.locator('h1').first().innerText());
  return { title, timing: scanTiming(await readTimeline(page)) };
}

async function latestScanEvent(srv: E2EServer) {
  return srv.ctx.db
    .selectFrom('scan_events')
    .select(['id', 'result_state', 'client_metrics', 'latency_ms', 'product_id'])
    .orderBy('occurred_at', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
}

describe.skipIf(!HAS_CHROMIUM)('E2E camera scan: real browser, fake camera, real server', () => {
  let srv: E2EServer;
  let issued: IssueResult;
  const clips = { limited: '', full: '', forged: '', settling: '' };
  let settlingMoving = 0;
  const metrics: Record<string, unknown> = {};

  beforeAll(async () => {
    mkdirSync(E2E_OUT_DIR, { recursive: true });
    srv = await startE2EServer();
    issued = await srv.issue({ serial: 184 });
    expect(issued.product.productId).toBe('O26-J-00184');

    const t0 = performance.now();
    const source = codeSource(printedCodeOf(issued));
    const frames = cameraClipFrames(source, { n: 8, seed: 1 });
    clips.limited = join(srv.workDir, 'code-limited.y4m');
    clips.full = join(srv.workDir, 'code-full.y4m');
    writeY4m(clips.limited, frames, FPS, { range: 'limited' });
    writeY4m(clips.full, frames, FPS, { range: 'full' });
    const forgedFrames = cameraClipFrames(codeSource(forgeSerial(issued)), { n: 4, seed: 2 });
    clips.forged = join(srv.workDir, 'forged-limited.y4m');
    writeY4m(clips.forged, forgedFrames, FPS, { range: 'limited' });
    // The hand arrives, then holds the tag as in the steady clip (same frames).
    const settling = settlingClipFrames(source, { moving: 6, seed: 5, steadyFrames: frames });
    settlingMoving = settling.moving;
    clips.settling = join(srv.workDir, 'settling-limited.y4m');
    writeY4m(clips.settling, settling.frames, FPS, { range: 'limited' });
    const clipGenerationMs = Math.round(performance.now() - t0);

    // The clips are what they claim: every steady frame is readable, every arriving (blurred) frame is not.
    const readable = { steady: readableFrames(frames), forged: readableFrames(forgedFrames), arriving: readableFrames(settling.frames.slice(0, settlingMoving)) };
    expect(readable.steady.every(Boolean)).toBe(true);
    expect(readable.forged.every(Boolean)).toBe(true);
    expect(readable.arriving.some(Boolean)).toBe(false);

    // What the fake camera plays, for review.
    writePng(join(E2E_OUT_DIR, 'clip-frame-0.png'), frames[0]);
    writePng(join(E2E_OUT_DIR, 'clip-frame-5.png'), frames[5]);
    writePng(join(E2E_OUT_DIR, 'clip-settling-frame-2.png'), settling.frames[2]);
    metrics.setup = {
      webBuildMs: Math.round(srv.buildMs),
      clipGenerationMs,
      clip: { width: 720, height: 1280, fps: FPS, frames: frames.length },
      settlingClip: { movingFrames: settlingMoving, steadyFrames: settling.frames.length - settlingMoving },
      readableInNode: readable,
      machine: { cpus: cpus().length, model: cpus()[0]?.model, loadPerCpuAtStart: loadPerCpu() },
    };
  }, 120_000);

  afterAll(async () => {
    recordMetrics(METRICS, 'run', metrics);
    await srv?.close();
  });

  describe('limited-range clip (calibrated: the page sees the simulated levels)', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await launchCamera(clips.limited);
    }, 60_000);
    afterAll(async () => {
      await browser?.close();
    });

    it('scans an issued code through the UI and shows AUTHENTIC with its product id (motion as designed)', async () => {
      const { page, problems, close } = await openVerify(browser, srv, 'no-preference');
      try {
        await page.getByRole('button', { name: 'SCAN ORBES CODE' }).tap();
        await page.locator('.view--scan').waitFor();
        await page.locator('.view--scan.is-locked').waitFor({ timeout: 30_000 });
        // The lock is held for a moment on purpose: the orbit closes on the code.
        await page.screenshot({ path: join(E2E_OUT_DIR, 'camera-locked.png') });
        await page.locator('.view--result').waitFor({ timeout: 30_000 });

        const result = page.locator('.view--result');
        expect(await result.getAttribute('data-state')).toBe('AUTHENTIC');
        expect(await result.getAttribute('data-tone')).toBe('authentic');
        await textOf(page.locator('#result-title'), 'AUTHENTIC');
        await textOf(page.locator('.genome__id'), 'O26-J-00184');
        expect((await page.locator('.lines__line').allInnerTexts()).map(norm)).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
        // The GENOME in its orbit, as on the piece, the ORBES monogram at its centre on a collector's screen (NOCTURNE,
        // decision 12): the monogram's layer in place of the seal's, and one group per glyph.
        const genome = page.locator('.genome__glyphs .genome-svg');
        expect(await genome.getAttribute('aria-label')).toContain(issued.genome.fingerprint);
        expect(await genome.locator('g[data-layer="seal"]').count()).toBe(0);
        expect(await genome.locator('g[data-layer="monogram"]').count()).toBe(1);
        expect(await genome.locator('g[data-layer="genome"]').count()).toBe(8);
        expect((await page.getByRole('tab').allInnerTexts()).map(norm)).toEqual(['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP']);

        const timeline = await readTimeline(page);
        const timing = scanTiming(timeline);
        // The rear camera was requested once and was released after the read. Chromium adapts the
        // 720×1280 clip to the app's ideal 1920×1080 by cropping to the ideal height (720×1080):
        // the reticle sits in the centre, so nothing it needs is lost.
        expect(timeline.gum).toHaveLength(1);
        expect(timeline.gum[0].settings).toMatchObject({ width: 720, frameRate: FPS });
        expect(timeline.gum[0].settings?.height).toBeLessThanOrEqual(1280);
        expect(timeline.stoppedTracks).toBeGreaterThanOrEqual(1);
        expect(await page.locator('video').count()).toBe(0);
        // Frames went to the worker as the reticle crop, not the whole frame.
        expect(timeline.frames[0].w).toBe(timeline.frames[0].h);
        expect(timeline.frames[0].w).toBeLessThan(720);

        const event = await latestScanEvent(srv);
        expect(event.result_state).toBe('AUTHENTIC');
        expect(event.product_id).toBe(issued.product.id);
        expect(JSON.stringify(event.client_metrics)).toMatch(/"source":"camera"/);

        await page.waitForTimeout(1_500); // entrance animations settle before the review screenshot
        await page.screenshot({ path: join(E2E_OUT_DIR, 'camera-result.png'), fullPage: true });

        // The warm-up decode ran on the landing page, before the tap, and is not counted as a camera frame.
        expect(timeline.warmup?.reply?.ok).toBe(true);
        expect(timeline.warmup!.t).toBeLessThan(timeline.gum[0].start);
        metrics.designedMotion = {
          ...timing,
          serverLatencyMs: event.latency_ms,
          cropPx: timeline.frames[0].w,
          trackSettings: timeline.gum[0].settings,
          warmupDecodeMs: timeline.warmup?.reply?.timing?.decodeMs ?? null,
        };
        expect(timing.recognition).not.toBeNull();
        expect(timing.recognition!).toBeLessThan(CEILING_MS);
        expect(timing.tapToResult!).toBeLessThan(CEILING_MS + 3_000);
        expect(problems).toEqual([]);
      } finally {
        await close();
      }
    }, 90_000);

    it(`time-to-recognition and time-to-result over ${RUNS} fresh scans (reduced motion: no designed pauses)`, async () => {
      const timings: (ScanTiming & { serverLatencyMs: number | null })[] = [];
      const warmups: (number | null)[] = [];
      for (let i = 0; i < RUNS; i++) {
        const { page, problems, close } = await openVerify(browser, srv, 'reduce');
        try {
          const warmupDecodeMs = (await readTimeline(page)).warmup?.reply?.timing?.decodeMs ?? null;
          const { title, timing } = await scan(page);
          warmups.push(warmupDecodeMs);
          expect(title).toBe('AUTHENTIC');
          await textOf(page.locator('.genome__id'), 'O26-J-00184');
          const event = await latestScanEvent(srv);
          expect(event.result_state).toBe('AUTHENTIC');
          timings.push({ ...timing, serverLatencyMs: event.latency_ms });
          expect(problems).toEqual([]);
        } finally {
          await close();
        }
      }
      const recognition = timings.map((t) => t.recognition!);
      const summary = {
        runs: timings,
        recognition: summarize(recognition),
        cameraOpen: summarize(timings.map((t) => t.cameraOpen!)),
        liveToDecoded: summarize(timings.map((t) => t.liveToDecoded!)),
        decodedToResult: summarize(timings.map((t) => t.decodedToResult!)),
        tapToResult: summarize(timings.map((t) => t.tapToResult!)),
        framesToRecognition: summarize(timings.map((t) => t.framesToRecognition!)),
        workerDecodeMs: summarize(timings.flatMap((t) => t.workerDecodeMs)),
        // Warm-up decode on the landing page (cold engine), then the first camera frame (warm).
        warmupDecodeMs: warmups,
        firstFrameDecodeMs: summarize(timings.map((t) => t.workerDecodeMs[0])),
        targetMs: RECOGNITION_TARGET_MS,
      };
      metrics.reducedMotion = summary;
      console.log(`[e2e camera] recognition ${JSON.stringify(summary.recognition)} tap→result ${JSON.stringify(summary.tapToResult)} frames ${JSON.stringify(summary.framesToRecognition)}`);

      const load = loadPerCpu();
      (summary as Record<string, unknown>).loadPerCpuAtEnd = load;
      for (const t of timings) {
        expect(t.recognition!).toBeLessThan(CEILING_MS);
        // Every frame of the clip is readable, so the first or second frame the pump sends must be read.
        expect(t.framesToRecognition!).toBeLessThanOrEqual(2);
      }
      if (STRICT) expect(summary.recognition.median).toBeLessThan(RECOGNITION_TARGET_MS);
      else if (load < LOAD_PER_CPU_LIMIT) expect(summary.recognition.min).toBeLessThan(RECOGNITION_TARGET_MS);
      else console.warn(`[e2e camera] load ${load}/CPU: the ${RECOGNITION_TARGET_MS} ms target was recorded, not asserted`);
    }, 110_000);
  });

  describe('settling clip (6 blurred frames of the hand arriving, then steady)', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await launchCamera(clips.settling);
    }, 60_000);
    afterAll(async () => {
      await browser?.close();
    });

    // The clip loops (6 blurred + 8 steady frames, 0.93 s), so whether the pump samples a blurred frame
    // before a steady one depends on when the camera starts: rejected frames are recorded in the
    // metrics (settling.failedReasons), not asserted. What is asserted is that the scan still ends AUTHENTIC.
    it('reads the code from a clip that starts with the hand arriving (blurred frames): AUTHENTIC', async () => {
      const { page, problems, close } = await openVerify(browser, srv, 'reduce');
      try {
        const { title, timing } = await scan(page);
        expect(title).toBe('AUTHENTIC');
        await textOf(page.locator('.genome__id'), 'O26-J-00184');
        const timeline = await readTimeline(page);
        const failures = timeline.replies.filter((r) => !r.ok).map((r) => r.reason);
        metrics.settling = { ...timing, failedReasons: failures, movingMs: Math.round((settlingMoving / FPS) * 1000) };
        expect(timing.recognition!).toBeLessThan(CEILING_MS);
        expect(problems).toEqual([]);
      } finally {
        await close();
      }
    }, 60_000);
  });

  describe("'full'-range clip (Chromium stretches it: harder contrast, clipped paper)", () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await launchCamera(clips.full);
    }, 60_000);
    afterAll(async () => {
      await browser?.close();
    });

    it('still reads the code and shows AUTHENTIC with its product id', async () => {
      const { page, problems, close } = await openVerify(browser, srv, 'reduce');
      try {
        const { title, timing } = await scan(page);
        expect(title).toBe('AUTHENTIC');
        await textOf(page.locator('.genome__id'), 'O26-J-00184');
        metrics.fullRange = timing;
        expect(timing.recognition!).toBeLessThan(CEILING_MS);
        expect(problems).toEqual([]);
      } finally {
        await close();
      }
    }, 60_000);
  });

  describe('forged code (genuine signature, altered serial, genome redrawn to match)', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await launchCamera(clips.forged);
    }, 60_000);
    afterAll(async () => {
      await browser?.close();
    });

    it('is read by the camera and shown as INVALID SIGNATURE, with no product data', async () => {
      const { page, problems, close } = await openVerify(browser, srv, 'no-preference');
      try {
        const { title, timing } = await scan(page);
        expect(title).toBe('INVALID SIGNATURE');
        const result = page.locator('.view--result');
        expect(await result.getAttribute('data-state')).toBe('INVALID_SIGNATURE');
        expect(await result.getAttribute('data-tone')).toBe('void');
        await textOf(page.locator('.result__message'), /signature of this code could not be verified/);
        // Nothing of the claimed (or the genuine) product is disclosed, and no positive affordances are offered.
        expect(await page.locator('.genome__id').count()).toBe(0);
        expect(await page.locator('.lines__line').count()).toBe(0);
        expect(await page.getByRole('tab').count()).toBe(0);
        expect(await page.locator('.result__footnote').count()).toBe(0);
        expect(norm(await page.locator('body').innerText())).not.toMatch(/O26-J-0018[45]/);
        await page.getByRole('button', { name: 'SCAN AGAIN' }).waitFor();

        const event = await latestScanEvent(srv);
        expect(event.result_state).toBe('INVALID_SIGNATURE');
        const auth = await srv.ctx.db
          .selectFrom('authentication_events')
          .select(['signature_valid', 'state', 'reasons'])
          .where('scan_event_id', '=', event.id)
          .executeTakeFirstOrThrow();
        expect(auth.signature_valid).toBe(false);
        expect(auth.state).toBe('INVALID_SIGNATURE');

        await page.waitForTimeout(1_200);
        await page.screenshot({ path: join(E2E_OUT_DIR, 'camera-invalid.png'), fullPage: true });
        metrics.forged = timing;
        expect(problems).toEqual([]);
      } finally {
        await close();
      }
    }, 60_000);
  });
});
