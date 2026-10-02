/**
 * End-to-end: the built verification app, served by the real server
 * (buildApp, in-memory database, ephemeral port), driven in Chromium at a
 * phone viewport. Covers the photo upload path, the camera path (Chromium's
 * fake capture device fed with a simulated phone clip of a real issued
 * code), first registration with a claim code through the OWNERSHIP tab, and
 * the problem screens. Mobile screenshots of the landing and result screens
 * are written to genome/out/ for design review.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, ConsoleMessage, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { genomeLayout } from '../../src/core/genome/render.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { CHROMIUM_PATH, launchChromium, MOBILE_VIEWPORT, mobileContext, startVerifyServer, writeCameraY4m, writeCodePng, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const PASSWORD = 'correct horse battery staple';

// playwright-core ships no assertion library: these poll a locator with vitest's expect.poll.
const POLL = { timeout: 15_000, interval: 100 };
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}
async function textsOf(loc: Locator, expected: string[]): Promise<void> {
  await expect.poll(async () => (await loc.allInnerTexts()).map(norm), POLL).toEqual(expected);
}
async function attrOf(loc: Locator, name: string, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(() => loc.getAttribute(name), POLL).toBe(expected);
  else await expect.poll(async () => (await loc.getAttribute(name)) ?? '', POLL).toMatch(expected);
}
async function countOf(loc: Locator, n: number): Promise<void> {
  await expect.poll(() => loc.count(), POLL).toBe(n);
}
async function valueOf(loc: Locator, expected: string): Promise<void> {
  await expect.poll(() => loc.inputValue(), POLL).toBe(expected);
}
const visible = (loc: Locator) => loc.waitFor({ state: 'visible', timeout: POLL.timeout });

/** Visible text set in Gravesend Sans that holds a one or a zero: there should be none (its one is its capital I, its zero an O). */
async function figuresInDisplayFace(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
      .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
      .filter((t) => /[01]/.test(t)),
  );
}

/**
 * Console noise that is expected: Chromium logs every 4xx API answer as a failed resource
 * (a 403 for a wrong claim code; signed-out visitors no longer cause a 401: /account/session answers 200).
 */
function isExpectedConsole(m: ConsoleMessage): boolean {
  return m.type() !== 'error' || /Failed to load resource: the server responded with a status of 4\d\d/.test(m.text());
}

interface Watched {
  page: Page;
  problems: string[];
}

async function openVerify(browser: Browser, srv: VerifyServer, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<Watched> {
  const ctx = await mobileContext(browser, opts);
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (!isExpectedConsole(m)) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Any CSP violation is a bug (no inline scripts or styles anywhere).
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
  });
  const res = await page.goto(`${srv.origin}/verify`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toMatch(/script-src 'self'/);
  await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
  return { page, problems };
}

async function uploadPhoto(page: Page, file: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'UPLOAD A PHOTO' }).first().click()]);
  await chooser.setFiles(file);
}

async function resultTitle(page: Page): Promise<string> {
  await page.locator('.view--result, .view--message').first().waitFor({ timeout: 30_000 });
  return (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim();
}

describe.skipIf(!HAS_CHROMIUM)('verify web app (Chromium, mobile)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let plain: IssueResult;

  beforeAll(async () => {
    srv = await startVerifyServer();
    plain = await srv.issue({ serial: 184 });
    browser = await launchChromium();
    mkdirSync(OUT_DIR, { recursive: true });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  it('serves the shell with hashed, immutable assets', async () => {
    const html = await (await fetch(`${srv.origin}/verify`)).text();
    const js = /src="(\/assets\/verify-[A-Z0-9]{8}\.js)"/.exec(html)?.[1];
    const worker = /content="(\/assets\/verify-worker-[A-Z0-9]{8}\.js)"/.exec(html)?.[1];
    expect(js).toBeDefined();
    expect(worker).toBeDefined();
    const font = /<link rel="preload" href="(\/assets\/gravesend-sans-500-[A-Z0-9]{8}\.woff2)" as="font" type="font\/woff2" crossorigin>/.exec(html)?.[1];
    expect(font).toBeDefined();
    for (const path of [js!, worker!, font!]) {
      const res = await fetch(`${srv.origin}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toMatch(/immutable/);
    }
    expect((await fetch(`${srv.origin}${font!}`)).headers.get('content-type')).toBe('font/woff2');
  });

  it('sets the wordmark, titles and labels in Gravesend Sans, fetched once through the preload, and reads in Helvetica Neue', async () => {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Gravesend Sans').map((f) => f.status))).toEqual(['loaded']);
    const family = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
    for (const selector of ['.landing__wordmark', '.landing__sub', '.landing__scan', '.landing__upload']) {
      expect(await family(selector), selector).toMatch(/^"?Gravesend Sans"?,\s*"?Helvetica Neue"?/);
    }
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    // The preload and the stylesheet name the same URL: one download, never two.
    const fetched = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.woff2')));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/\/assets\/gravesend-sans-500-[A-Z0-9]{8}\.woff2$/);
    expect(problems).toEqual([]);
  }, 120_000);

  it('verifies an uploaded photo of an issued code: AUTHENTIC with its product id', async () => {
    const { page, problems } = await openVerify(browser, srv);
    // Landing, after its entrance has settled.
    await textOf(page.locator('h1'), /ORBES\s*AUTHENTICATION/);
    await page.waitForTimeout(2_400);
    await page.screenshot({ path: join(OUT_DIR, 'verify-landing.png') });

    await uploadPhoto(page, writeCodePng(srv.workDir, 'plain.png', plain));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    const result = page.locator('.view--result');
    await attrOf(result, 'data-state', 'AUTHENTIC');
    await textOf(page.locator('.genome__id'), plain.product.productId);
    expect(plain.product.productId).toBe('O26-J-00184');
    await textsOf(page.locator('.lines__line'), ['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    // The GENOME is drawn from the core renderer, in its orbit around the SEAL as on the piece:
    // the seal layer, then one path group per glyph.
    const genome = page.locator('.genome__glyphs .genome-svg');
    await attrOf(genome, 'aria-label', new RegExp(plain.genome.fingerprint));
    await attrOf(genome, 'class', /\bgenome-svg--orbit\b/);
    await countOf(genome.locator('g[data-layer="seal"]'), 1);
    await countOf(genome.locator('g[data-layer="genome"]'), 8);
    // A square of min(64vw, 260px): glyphs of about 42 px on this 390 px phone (43 px from 407 px).
    const box = await genome.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeCloseTo(Math.min(0.64 * MOBILE_VIEWPORT.width, 260), 0);
    expect(box!.height).toBeCloseTo(box!.width, 0);
    expect(box!.x + box!.width / 2).toBeCloseTo(MOBILE_VIEWPORT.width / 2, 0);
    const orbit = genomeLayout(plain.genome, 'orbit');
    expect((box!.width * 2 * orbit.glyphRadius) / orbit.viewBox.w).toBeGreaterThan(41);
    await textsOf(page.getByRole('tab'), ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP']);
    await attrOf(page.getByRole('tab', { name: 'PRODUCT' }), 'aria-selected', 'true');
    // The id, the fingerprint, the product lines, the rows and the reference read in Helvetica Neue.
    expect(await figuresInDisplayFace(page)).toEqual([]);
    // Honest limits are stated on every positive result.
    await textOf(page.locator('.result__footnote'), /cannot prove that an object is genuine/);
    // Focus moved to the new screen's heading for screen readers.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('result-title');

    await page.waitForTimeout(2_000);
    await page.screenshot({ path: join(OUT_DIR, 'verify-result.png'), fullPage: true });

    // Keyboard: arrows move between tabs and show their panels.
    await page.getByRole('tab', { name: 'PRODUCT' }).focus();
    await page.keyboard.press('ArrowRight');
    await attrOf(page.getByRole('tab', { name: 'WARRANTY' }), 'aria-selected', 'true');
    await textOf(page.getByRole('tabpanel'), /NOT YET STARTED/);
    await page.keyboard.press('End');
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await textOf(page.locator('.ownership__status'), 'NOT YET REGISTERED');

    // Back returns to the landing screen.
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(problems).toEqual([]);
  }, 120_000);

  it('registers a piece at first registration: account, claim code, then the owner view', async () => {
    const issued = await srv.issue({ withClaimSecret: true, variant: 'SIZE 52' });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'claim.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC FIRST REGISTRATION');
    // Registration opens straight on the OWNERSHIP tab.
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await textOf(page.locator('.ownership__status'), 'REGISTRATION OPEN');

    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await page.getByLabel('EMAIL').fill('client@example.com');
    await page.getByLabel('PASSWORD').fill('too short');
    await page.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();
    await textOf(page.getByRole('alert'), /at least 12 characters/);
    // The typed email survives a failed attempt.
    await valueOf(page.getByLabel('EMAIL'), 'client@example.com');
    await page.getByLabel('PASSWORD').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();

    // Signed in (session cookie + CSRF token): the claim form appears.
    await visible(page.getByLabel('CLAIM CODE'));
    await textOf(page.locator('.ownership__email'), 'client@example.com');
    await page.getByLabel('CLAIM CODE').fill('ZZZZ-ZZZZ-ZZZZ');
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await visible(page.getByRole('alert'));
    await page.getByLabel('CLAIM CODE').fill(issued.claimCode!.replace(/-/g, '').toLowerCase());
    await valueOf(page.getByLabel('CLAIM CODE'), issued.claimCode!);
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await textOf(page.locator('.ownership__status'), 'REGISTERED TO YOU');
    await textOf(page.locator('.ownership'), /Ownership verified with its claim code/);

    // Re-verify as the owner: the server now reports the ownership.
    await page.getByRole('button', { name: 'VIEW AS OWNER' }).click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await page.getByRole('button', { name: 'CREATE TRANSFER CODE' }).click();
    await textOf(page.locator('.transfer-code__value'), /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    await page.getByRole('button', { name: 'CANCEL TRANSFER' }).click();
    await textOf(page.locator('.form__notice'), 'The transfer has been cancelled.');

    const owner = await srv.ctx.services.ownership.currentOwner(issued.product.id);
    expect(owner).toBeTruthy();
    expect(problems).toEqual([]);
  }, 120_000);

  it('shows the revoked state for a superseded code', async () => {
    const issued = await srv.issue();
    await srv.ctx.services.issuance.reissueCode(issued.product.id, 'damaged label', SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'old.png', issued));
    expect(await resultTitle(page)).toBe('REVOKED');
    await attrOf(page.locator('.view--result'), 'data-tone', 'void');
    await countOf(page.getByRole('tab'), 0);
    await countOf(page.locator('.result__footnote'), 0);
    expect(problems).toEqual([]);
  }, 120_000);

  it('explains a photo without a code, and offers another photo', async () => {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    const file = join(srv.workDir, 'not-a-code.png');
    writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    await uploadPhoto(page, file);
    expect(await resultTitle(page)).toBe('NO ORBES CODE FOUND');
    await visible(page.getByRole('button', { name: 'UPLOAD A PHOTO' }));
    await page.getByRole('button', { name: 'SCAN AGAIN' }).waitFor();
    expect(problems).toEqual([]);
  }, 120_000);

  it('falls back gracefully when the device has no camera', async () => {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).click();
    expect(await resultTitle(page)).toBe('NO CAMERA AVAILABLE');
    await page.getByRole('button', { name: 'RETURN' }).click();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(problems).toEqual([]);
  }, 120_000);
});

describe.skipIf(!HAS_CHROMIUM)('verify web app: camera scan (Chromium fake capture device)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let issued: IssueResult;

  beforeAll(async () => {
    srv = await startVerifyServer();
    issued = await srv.issue({ serial: 184 });
    const clip = join(srv.workDir, 'camera.y4m');
    writeCameraY4m(clip, issued);
    browser = await launchChromium({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  it('reads the code from the live camera, locks the orbit and verifies it', async () => {
    const { page, problems } = await openVerify(browser, srv);
    // Keep a handle on every stream the page opens, to check it is released afterwards.
    await page.evaluate(() => {
      const md = navigator.mediaDevices;
      const original = md.getUserMedia.bind(md);
      const w = window as unknown as { __streams: MediaStream[] };
      w.__streams = [];
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        const stream = await original(c);
        w.__streams.push(stream);
        return stream;
      };
    });
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).click();
    await page.locator('.view--scan').waitFor();
    // The status line is a polite live region.
    await attrOf(page.getByRole('status'), 'aria-live', 'polite');
    await page.locator('.view--scan.is-locked').waitFor({ timeout: 30_000 });
    await textOf(page.getByRole('status'), /ORBES CODE FOUND|VERIFYING…/);
    await page.screenshot({ path: join(OUT_DIR, 'verify-scan-locked.png') });
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await textOf(page.locator('.genome__id'), issued.product.productId);
    // The camera was opened once (rear camera requested) and released once the code was read.
    const tracks = await page.evaluate(() =>
      (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((st) => st.getTracks().map((t) => ({ kind: t.kind, state: t.readyState }))),
    );
    expect(tracks).toEqual([{ kind: 'video', state: 'ended' }]);

    // The scan was recorded as a camera scan.
    const scan = await srv.ctx.db.selectFrom('scan_events').select(['client_metrics', 'result_state']).orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(scan.result_state).toBe('AUTHENTIC');
    expect(JSON.stringify(scan.client_metrics)).toMatch(/"source":"camera"/);
    expect(problems).toEqual([]);
  }, 120_000);
});

describe.skipIf(!HAS_CHROMIUM)('verify web app: camera permission declined', () => {
  let srv: VerifyServer;
  let browser: Browser;

  beforeAll(async () => {
    srv = await startVerifyServer();
    browser = await launchChromium({ args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  it('explains how to allow the camera and offers the photo upload instead', async () => {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).click();
    expect(await resultTitle(page)).toBe('CAMERA ACCESS DECLINED');
    await textOf(page.locator('.message__text'), /allow camera access/);
    await visible(page.getByRole('button', { name: 'UPLOAD A PHOTO' }));
    await visible(page.getByRole('button', { name: 'SCAN AGAIN' }));
    expect(problems).toEqual([]);
  }, 120_000);
});
