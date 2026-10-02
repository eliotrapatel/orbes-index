/**
 * End-to-end: the built verification app, served by the real server
 * (buildApp, in-memory database, ephemeral port), driven in Chromium at a
 * phone viewport. Covers the photo upload path, the camera path (Chromium's
 * fake capture device fed with a simulated phone clip of a real issued
 * code), first registration with a claim code through the OWNERSHIP tab, the
 * same registration from an UNUSUAL ACTIVITY result (a burst of scans of
 * copies, then the holder of the certificate card), the contact of ORBES
 * Client Services (an INVALID SIGNATURE result, a warranty that no longer
 * applies), and the problem screens. On each screen the floors of BRAND-DESIGN-SYSTEM §3.8
 * are measured: 10 px type and 44 × 44 px tap zones for every button, link
 * and tab. Mobile screenshots of the landing and result screens are written
 * to genome/out/ for design review.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, ConsoleMessage, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { genomeLayout } from '../../src/core/genome/render.js';
import { frameCodeData, unframeCodeData } from '../../src/core/payload.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { CHROMIUM_PATH, launchChromium, MOBILE_VIEWPORT, mobileContext, startVerifyServer, writeCameraY4m, writeCodePng, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const PASSWORD = 'correct horse battery staple';
/** The ORBES Client Services contact this server publishes (CLIENT_SERVICES_*). */
const CLIENT_SERVICES = { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' };

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
 * The lines a control's text takes: its line boxes, told apart by their top edge. A height
 * cannot say it, since two lines of 10 px type fit inside a 44 or 52 px control.
 */
async function linesOf(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
}

/** The phone widths in use, narrowest last: Android (360), iPhone SE, 8 and mini (375), the smallest (320). */
const PHONE_WIDTHS = [360, 375, 320] as const;

/** The floors of BRAND-DESIGN-SYSTEM §3.8 on the current screen, which shows at least `controls`. */
async function keepsFloors(page: Page, controls: string[]): Promise<void> {
  const { checked, problems } = await tapZoneFloors(page);
  expect(problems).toEqual([]);
  expect(checked).toEqual(expect.arrayContaining(controls));
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
    srv = await startVerifyServer({ clientServices: CLIENT_SERVICES });
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
    // The monogram over the typed word, inside the resting orbit: the master's five outlines in ink,
    // 76 px wide on this 390 px phone, centred, decorative (the heading says ORBES in words, once).
    const monogram = page.locator('h1 svg.monogram.landing__monogram');
    await countOf(monogram.locator('path'), 5);
    await attrOf(monogram, 'aria-hidden', 'true');
    await countOf(page.getByRole('img', { name: 'ORBES' }), 0);
    expect(await monogram.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(10, 10, 10)');
    const mono = (await monogram.boundingBox())!;
    const word = (await page.locator('.landing__wordmark').boundingBox())!;
    const emblem = (await page.locator('.landing__emblem').boundingBox())!;
    expect(mono.width).toBeCloseTo(0.195 * MOBILE_VIEWPORT.width, 0);
    expect(mono.height / mono.width).toBeCloseTo(316.54 / 414.42, 2);
    expect(mono.x + mono.width / 2).toBeCloseTo(MOBILE_VIEWPORT.width / 2, 0);
    expect(mono.y + mono.height + 24).toBeCloseTo(word.y, 0);
    expect(mono.y).toBeGreaterThan(emblem.y);
    await page.screenshot({ path: join(OUT_DIR, 'verify-landing.png') });
    await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO']);

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
    // The fingerprint beneath, a fact the customer may compare: 10 px, not the 8 px of decoration.
    expect(await page.locator('.genome__meta').evaluate((el) => getComputedStyle(el).fontSize)).toBe('10px');
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
    // The four tabs at 10 px keep the width they had at 9 px: 44 px zones on this phone and on the
    // smallest in use (320 px, where they tighten), without scrolling sideways.
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER']);
    await page.setViewportSize({ width: 320, height: 640 });
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER']);
    await page.setViewportSize(MOBILE_VIEWPORT);

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
    // The closing time of the window is a fact to read: 10 px, as the field labels.
    await textOf(page.locator('.ownership__meta'), /^REGISTRATION OPEN UNTIL \d\d:\d\d$/);
    expect(await page.locator('.ownership__meta').evaluate((el) => getComputedStyle(el).fontSize)).toBe('10px');
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT']);

    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT']);
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
    await keepsFloors(page, ['REGISTER THIS PIECE', 'SIGN OUT']);
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
    expect(await page.locator('.transfer-code__label').evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize))).toEqual(['10px', '10px']);
    await keepsFloors(page, ['CANCEL TRANSFER', 'SIGN OUT']);
    await page.getByRole('button', { name: 'CANCEL TRANSFER' }).click();
    await textOf(page.locator('.form__notice'), 'The transfer has been cancelled.');

    const owner = await srv.ctx.services.ownership.currentOwner(issued.product.id);
    expect(owner).toBeTruthy();
    expect(problems).toEqual([]);
  }, 120_000);

  it('lets the holder of the certificate card register from an UNUSUAL ACTIVITY result, with its claim code', async () => {
    const issued = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    // A burst of scans of copies of its code, from 22 sources within a minute (velocity ⊕ diversity):
    // the buyer's own scan, the next one, comes out suspicious from the scan history alone.
    for (let i = 0; i < 22; i++) {
      await srv.ctx.services.verification.verify({ code: issued.code.data }, { deviceHash: `copy-device-${i}`, ipHash: `copy-ip-${i}`, geo: { country: 'FR' } });
    }
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'burst.png', issued));
    expect(await resultTitle(page)).toBe('UNUSUAL ACTIVITY DETECTED');
    await attrOf(page.locator('.view--result'), 'data-tone', 'caution');
    // No tabs and no product data: the GENOME, the help line, then the certificate-card section beneath it.
    await countOf(page.getByRole('tab'), 0);
    await countOf(page.locator('.lines__line, .rows'), 0);
    const card = page.getByRole('region', { name: 'DO YOU HOLD THE CERTIFICATE CARD?' });
    await visible(card);
    expect(await page.locator('.result__help + .result__card').count()).toBe(1);
    await textOf(card.locator('.result__card-text'), /certificate card, you may register it in your name with the claim code/);
    await textOf(card.locator('.ownership__status'), 'REGISTRATION OPEN');
    await textOf(card.locator('.ownership__text').first(), 'While its activity is reviewed, this piece can be registered only with the claim code of its certificate card.');
    // The question is a status line in the display face, 11 px: read, not decoration.
    const title = card.getByRole('heading', { level: 2 });
    expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('11px');
    expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans/);
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT', 'SCAN AGAIN']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-unusual-activity-card.png'), fullPage: true });
    // On the smallest phone in use the question wraps, balanced, and nothing scrolls sideways.
    await page.setViewportSize({ width: 320, height: 640 });
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT', 'SCAN AGAIN']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.setViewportSize(MOBILE_VIEWPORT);

    // Sign-in first (an account is created), then the CLAIM CODE, which is required.
    await card.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await page.getByLabel('EMAIL').fill('card-holder@example.com');
    await page.getByLabel('PASSWORD').fill(PASSWORD);
    await card.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();
    await visible(page.getByLabel('CLAIM CODE'));
    await keepsFloors(page, ['REGISTER THIS PIECE', 'SIGN OUT', 'SCAN AGAIN']);
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await textOf(page.getByRole('alert'), /Enter the 12 characters of your claim code/);
    // A wrong code: the server's answer, as it comes.
    await page.getByLabel('CLAIM CODE').fill('ZZZZ-ZZZZ-ZZZZ');
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await textOf(page.getByRole('alert'), 'The claim code does not match this product.');
    expect(await srv.ctx.services.ownership.currentOwner(issued.product.id)).toBeFalsy();
    // The code of the card: REGISTERED TO YOU.
    await page.getByLabel('CLAIM CODE').fill(issued.claimCode!);
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await textOf(card.locator('.ownership__status'), 'REGISTERED TO YOU');
    await textOf(card, /Ownership verified with its claim code/);
    expect(await srv.ctx.services.ownership.currentOwner(issued.product.id)).toBeTruthy();

    // VIEW AS OWNER verifies again: the owner's own piece, with the unusual activity said once.
    await page.getByRole('button', { name: 'VIEW AS OWNER' }).click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    await attrOf(page.locator('.view--result'), 'data-tone', 'authentic');
    await textOf(page.locator('.result__message'), /Unusual activity has been recorded for it/);
    await countOf(page.locator('.result__card'), 0);
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await textOf(page.locator('.ownership__status'), 'REGISTERED TO YOU');
    expect(problems).toEqual([]);
  }, 120_000);

  it('offers CONTACT ORBES CLIENT SERVICES on an INVALID SIGNATURE result: the reference in the email, then the phone and the hours', async () => {
    // A code ORBES did not sign: one bit of an issued code's signature flipped, the frame still valid.
    const issued = await srv.issue();
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[10] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'forged.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await attrOf(page.locator('.view--result'), 'data-tone', 'void');

    // Under the help line: a text link (the hairline button stays SCAN AGAIN), an email to Client
    // Services that quotes this scan's reference.
    const help = page.locator('.result__help');
    const email = help.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    await visible(email);
    const scan = await srv.ctx.db.selectFrom('scan_events').select(['id', 'result_state']).orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(scan.result_state).toBe('INVALID_SIGNATURE');
    const ref = scan.id.split('-')[0].toUpperCase();
    await textOf(page.locator('.result__meta'), new RegExp(`REF ${ref}$`));
    const href = new URL((await email.getAttribute('href'))!);
    expect(href.protocol).toBe('mailto:');
    expect(href.pathname).toBe(CLIENT_SERVICES.email);
    expect(href.searchParams.get('subject')).toBe(`ORBES — REF ${ref} — INVALID SIGNATURE`);
    expect(href.searchParams.get('body')).toMatch(new RegExp(`^\\r\\n\\r\\nREFERENCE: ${ref}\\r\\nRESULT: INVALID SIGNATURE\\r\\nVERIFIED: \\d{1,2} [A-Z]{3} \\d{4} · \\d\\d:\\d\\d$`));
    await attrOf(email, 'class', 'textlink contact__email');
    await countOf(page.locator('.btn:visible'), 1);
    // One line, inside the column (never wider than the page), in a text link's 44 px tap zone.
    expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await linesOf(email)).toBe(1);
    // Then the phone, a tel: link read in Helvetica Neue (figures), and the hours.
    const phone = help.getByRole('link', { name: `Call ORBES Client Services, ${CLIENT_SERVICES.phone}` });
    await attrOf(phone, 'href', 'tel:+33123456789');
    await textOf(phone, CLIENT_SERVICES.phone);
    expect(await phone.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    await textOf(help.locator('.contact__hours'), CLIENT_SERVICES.hours.toUpperCase());
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'SCAN AGAIN']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-invalid-signature-contact.png'), fullPage: true });
    // On the phones in use, down to the smallest, the link keeps its one line and nothing scrolls sideways.
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'SCAN AGAIN']);
      expect((await email.boundingBox())!.height, `${width} px`).toBeGreaterThanOrEqual(44);
      expect(await linesOf(email), `${width} px`).toBe(1);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    expect(problems).toEqual([]);
  }, 120_000);

  it('offers the same contact in the WARRANTY tab of an authentic piece whose warranty no longer applies, and nowhere else', async () => {
    const issued = await srv.issue();
    await srv.ctx.services.warranty.void(issued.product.id, 'unauthorised modification', SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'void-warranty.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await countOf(page.locator('.contact'), 0);
    await page.getByRole('tab', { name: 'WARRANTY' }).click();
    const panel = page.getByRole('tabpanel');
    await textOf(panel.locator('.rows'), /NO LONGER VALID/);
    const email = panel.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    await visible(email);
    const href = new URL((await email.getAttribute('href'))!);
    expect(href.searchParams.get('subject')).toMatch(/^ORBES — REF [0-9A-F]{8} — AUTHENTIC$/);
    expect(href.searchParams.get('body')).toMatch(/\r\nRESULT: AUTHENTIC\r\nWARRANTY: NO LONGER VALID\r\n/);
    await visible(panel.getByRole('link', { name: `Call ORBES Client Services, ${CLIENT_SERVICES.phone}` }));
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'SCAN ANOTHER']);
    await countOf(page.locator('.contact'), 1);
    // A text link at the width of a tab panel: one line on this phone and on the narrower ones in use.
    await attrOf(email, 'class', 'textlink contact__email');
    await countOf(page.locator('.btn:visible'), 1);
    expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await linesOf(email)).toBe(1);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'SCAN ANOTHER']);
      expect((await email.boundingBox())!.height, `${width} px`).toBeGreaterThanOrEqual(44);
      expect(await linesOf(email), `${width} px`).toBe(1);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
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
    await keepsFloors(page, ['UPLOAD A PHOTO', 'SCAN AGAIN']);
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
