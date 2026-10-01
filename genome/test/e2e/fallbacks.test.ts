/**
 * End-to-end paths around the camera, in a real browser at a phone viewport
 * (390×844 at 3×, touch), against the real server and web build:
 *
 *   - camera permission declined at the prompt, and camera blocked for the
 *     site beforehand: the elegant fallback (CAMERA ACCESS DECLINED, how to
 *     allow it, UPLOAD A PHOTO first), and that the fallback actually works:
 *     uploading a photo from that screen verifies the code;
 *   - photo upload from the landing screen: a simulated ≈3 MP phone JPEG of a
 *     real issued code → AUTHENTIC with its product id, timed;
 *   - an INVALID code (one flipped signature bit) uploaded → INVALID SIGNATURE;
 *   - a camera showing a blank tag (no code): no false recognition, the scan
 *     guidance appears, CLOSE releases the camera.
 *
 * Chromium runs without --use-fake-ui-for-media-stream here so permissions
 * can be refused: --deny-permission-prompts declines every prompt, a context
 * granted 'camera' needs no prompt, and CDP Browser.setPermission blocks it.
 * Screenshots go to genome/out/e2e/, numbers to genome/out/e2e/fallbacks.json.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, ConsoleMessage, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { writeJpeg } from '../support/image-io.js';
import { writeY4m } from '../support/y4m.js';
import {
  CHROMIUM_PATH,
  E2E_OUT_DIR,
  INSTRUMENTATION,
  blankSource,
  blockCamera,
  cameraClipFrames,
  codeSource,
  forgeSignature,
  launchCamera,
  mobileContext,
  phonePhoto,
  printedCodeOf,
  readTimeline,
  recordMetrics,
  startE2EServer,
  uploadTiming,
  type E2EServer,
} from './support.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const METRICS = 'fallbacks';
const POLL = { timeout: 20_000, interval: 50 };
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}

const expectedConsole = (m: ConsoleMessage) => m.type() !== 'error' || /Failed to load resource: the server responded with a status of 4\d\d/.test(m.text());

interface Opened {
  page: Page;
  problems: string[];
  close(): Promise<void>;
}

async function openVerify(
  browser: Browser,
  srv: E2EServer,
  opts: { reducedMotion?: 'reduce' | 'no-preference'; permissions?: string[] } = {},
): Promise<Opened> {
  const ctx = await mobileContext(browser, { reducedMotion: opts.reducedMotion ?? 'reduce', permissions: opts.permissions });
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
  return { page, problems, close: () => ctx.close() };
}

/** Tap a button that opens the photo picker and choose `file`. */
async function choosePhoto(page: Page, button: Locator, file: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.tap()]);
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(file);
}

async function screenTitle(page: Page): Promise<string> {
  await page.locator('.view--result, .view--message').first().waitFor({ timeout: 30_000 });
  return norm(await page.locator('h1').first().innerText());
}

async function latestScanEvent(srv: E2EServer) {
  return srv.ctx.db.selectFrom('scan_events').select(['id', 'result_state', 'client_metrics']).orderBy('occurred_at', 'desc').limit(1).executeTakeFirstOrThrow();
}

describe.skipIf(!HAS_CHROMIUM)('E2E camera fallbacks, photo upload and invalid codes (Chromium, mobile)', () => {
  let srv: E2EServer;
  let browser: Browser;
  let issued: IssueResult;
  const photos = { genuine: '', invalid: '' };
  const metrics: Record<string, unknown> = {};

  beforeAll(async () => {
    mkdirSync(E2E_OUT_DIR, { recursive: true });
    srv = await startE2EServer();
    issued = await srv.issue({ serial: 184 });
    const source = codeSource(printedCodeOf(issued));
    photos.genuine = join(srv.workDir, 'IMG_0184.jpg');
    writeJpeg(photos.genuine, phonePhoto(source, 7), 88);
    photos.invalid = join(srv.workDir, 'IMG_0666.jpg');
    writeJpeg(photos.invalid, phonePhoto(codeSource(forgeSignature(issued)), 8), 88);
    // For review: the photo the visitor uploads.
    writeJpeg(join(E2E_OUT_DIR, 'upload-photo.jpg'), phonePhoto(source, 7), 80);
    // The camera, when allowed, shows a blank hang tag on the desk (negative control).
    const clip = join(srv.workDir, 'blank.y4m');
    writeY4m(clip, cameraClipFrames(blankSource(), { n: 4, seed: 3 }), 15, { range: 'limited' });
    browser = await launchCamera(clip, { fakeUi: false, args: ['--deny-permission-prompts'] });
  }, 120_000);

  afterAll(async () => {
    recordMetrics(METRICS, 'run', metrics);
    await browser?.close();
    await srv?.close();
  });

  it('declined at the prompt: explains how to allow the camera, offers the photo first, and the photo path verifies', async () => {
    const { page, problems, close } = await openVerify(browser, srv, { reducedMotion: 'no-preference' });
    try {
      await page.getByRole('button', { name: 'SCAN ORBES CODE' }).tap();
      expect(await screenTitle(page)).toBe('CAMERA ACCESS DECLINED');
      const timeline = await readTimeline(page);
      expect(timeline.gum.map((g) => g.error)).toEqual(['NotAllowedError']);
      await textOf(page.locator('.message__text'), 'To scan, allow camera access for this page in your browser settings. You may also upload a photo of the ORBES CODE.');
      // Calm, two actions only: the photo first (primary button), scanning again as a text link.
      const actions = page.locator('.message__actions button');
      expect((await actions.allInnerTexts()).map(norm)).toEqual(['UPLOAD A PHOTO', 'SCAN AGAIN']);
      expect(await actions.nth(0).getAttribute('class')).toMatch(/\bbtn\b/);
      expect(await actions.nth(1).getAttribute('class')).toMatch(/\btextlink\b/);
      // Focus moved to the heading (screen readers announce the problem); no camera left running.
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('message-title');
      expect(await page.locator('video').count()).toBe(0);
      // Fits the phone screen without scrolling sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.waitForTimeout(1_200);
      await page.screenshot({ path: join(E2E_OUT_DIR, 'camera-denied.png') });

      // The fallback is real: upload a photo from this very screen.
      await choosePhoto(page, actions.nth(0), photos.genuine);
      await page.locator('.view--result').waitFor({ timeout: 30_000 });
      expect(await screenTitle(page)).toBe('AUTHENTIC');
      await textOf(page.locator('.genome__id'), 'O26-J-00184');
      const event = await latestScanEvent(srv);
      expect(event.result_state).toBe('AUTHENTIC');
      expect(JSON.stringify(event.client_metrics)).toMatch(/"source":"upload"/);
      metrics.deniedThenUpload = uploadTiming(await readTimeline(page));
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  }, 90_000);

  it('blocked for the site beforehand: the same fallback, and SCAN AGAIN stays on it without a loop', async () => {
    const { page, problems, close } = await openVerify(browser, srv);
    // The visitor chose "Block" for this site on an earlier visit (the app only asks at SCAN).
    const block = await blockCamera(browser, page, srv.origin);
    try {
      expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'camera' as PermissionName })).state)).toBe('denied');
      await page.getByRole('button', { name: 'SCAN ORBES CODE' }).tap();
      expect(await screenTitle(page)).toBe('CAMERA ACCESS DECLINED');
      await page.getByRole('button', { name: 'SCAN AGAIN' }).tap();
      await expect.poll(async () => (await readTimeline(page)).gum.length, POLL).toBe(2);
      expect(await screenTitle(page)).toBe('CAMERA ACCESS DECLINED');
      await page.getByRole('button', { name: 'UPLOAD A PHOTO' }).waitFor();
      expect(problems).toEqual([]);
    } finally {
      await block.release();
      await close();
    }
  }, 60_000);

  it('photo upload from the landing screen: a phone JPEG of an issued code → AUTHENTIC with its product id', async () => {
    const { page, problems, close } = await openVerify(browser, srv, { reducedMotion: 'no-preference' });
    try {
      await choosePhoto(page, page.getByRole('button', { name: 'UPLOAD A PHOTO' }), photos.genuine);
      expect(await screenTitle(page)).toBe('AUTHENTIC');
      const result = page.locator('.view--result');
      expect(await result.getAttribute('data-state')).toBe('AUTHENTIC');
      await textOf(page.locator('.genome__id'), 'O26-J-00184');
      expect((await page.locator('.lines__line').allInnerTexts()).map(norm)).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
      const timing = uploadTiming(await readTimeline(page));
      metrics.upload = timing;
      expect(timing.chosenToDecoded).not.toBeNull();
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: join(E2E_OUT_DIR, 'upload-result.png'), fullPage: true });
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);

  it('an INVALID code (one flipped signature bit) uploaded → INVALID SIGNATURE, nothing disclosed', async () => {
    const { page, problems, close } = await openVerify(browser, srv);
    try {
      await choosePhoto(page, page.getByRole('button', { name: 'UPLOAD A PHOTO' }), photos.invalid);
      expect(await screenTitle(page)).toBe('INVALID SIGNATURE');
      const result = page.locator('.view--result');
      expect(await result.getAttribute('data-state')).toBe('INVALID_SIGNATURE');
      expect(await result.getAttribute('data-tone')).toBe('void');
      expect(await page.locator('.genome__id').count()).toBe(0);
      expect(await page.getByRole('tab').count()).toBe(0);
      expect(norm(await page.locator('body').innerText())).not.toContain('O26-J-00184');
      await textOf(page.locator('.result__help'), /ORBES Client Services/);
      const event = await latestScanEvent(srv);
      expect(event.result_state).toBe('INVALID_SIGNATURE');
      metrics.invalidUpload = uploadTiming(await readTimeline(page));
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);

  it('camera on a blank tag: keeps scanning without a false read, guides the visitor, CLOSE releases the camera', async () => {
    const { page, problems, close } = await openVerify(browser, srv, { reducedMotion: 'no-preference', permissions: ['camera'] });
    try {
      const before = await srv.ctx.db.selectFrom('scan_events').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      await page.getByRole('button', { name: 'SCAN ORBES CODE' }).tap();
      await page.locator('.view--scan.is-ready').waitFor();
      await textOf(page.getByRole('status'), 'SCANNING…');
      // HINT_AFTER_MS (6 s) without a read: the guide line turns into advice.
      await textOf(page.locator('.scan__hint'), /Place the whole code inside the orbit|Move a little closer/);
      await page.screenshot({ path: join(E2E_OUT_DIR, 'camera-searching.png') });

      const timeline = await readTimeline(page);
      // ≥ 6 s of frames, at most one every 120 ms and only while the worker is idle (≈ 3–8 per second here).
      expect(timeline.replies.length).toBeGreaterThanOrEqual(3);
      expect(timeline.replies.every((r) => !r.ok)).toBe(true);
      expect(timeline.locked).toBeNull();
      const reasons: Record<string, number> = {};
      for (const r of timeline.replies) reasons[r.reason ?? '?'] = (reasons[r.reason ?? '?'] ?? 0) + 1;
      const elapsed = timeline.replies.at(-1)!.t - timeline.frames[0].t;
      metrics.blankTag = {
        frames: timeline.frames.length,
        seconds: Math.round(elapsed) / 1000,
        framesPerSecond: Math.round((timeline.frames.length / (elapsed / 1000)) * 10) / 10,
        reasons,
        workerDecodeMs: timeline.replies.map((r) => r.timing?.decodeMs ?? null),
      };
      // Nothing reached the server.
      const after = await srv.ctx.db.selectFrom('scan_events').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      expect(Number(after.n)).toBe(Number(before.n));

      await page.getByRole('button', { name: 'CLOSE' }).tap();
      await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
      expect((await readTimeline(page)).stoppedTracks).toBeGreaterThanOrEqual(1);
      expect(await page.locator('video').count()).toBe(0);
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);
});
