/**
 * End-to-end: the built verification app, served by the real server
 * (buildApp, in-memory database, ephemeral port), driven in Chromium at a
 * phone viewport. Covers the photo upload path, the camera path (Chromium's
 * fake capture device fed with a simulated phone clip of a real issued
 * code), first registration with a claim code through the OWNERSHIP tab, the
 * same registration from an UNUSUAL ACTIVITY result (a burst of scans of
 * copies, then the holder of the certificate card), the contact of ORBES
 * Client Services (an INVALID SIGNATURE result, a warranty that no longer
 * applies), the answer to WHERE DID YOU SEE OR BUY THIS PIECE? attached to
 * the scan, the password (FORGOTTEN PASSWORD? through ORBES Client Services
 * and a recovery code, then CHANGE PASSWORD beside SIGN OUT), and the
 * problem screens. On each screen the floors of BRAND-DESIGN-SYSTEM §3.8
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
import { CLAIM_HELD, STAFF_SCAN_NOTE } from '../../src/web/verify/copy.js';
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

/**
 * The box the keyboard focus ring of a control draws: its ::before (outline included), which
 * the controls with a transparent tap zone use instead of an outline around the zone.
 */
async function focusRingOf(loc: Locator): Promise<{ focusVisible: boolean; left: number; right: number; top: number; bottom: number } | null> {
  return loc.evaluate((el) => {
    const b = getComputedStyle(el, '::before');
    if (b.position !== 'absolute' || b.outlineStyle === 'none') return null;
    const r = el.getBoundingClientRect();
    const w = Number.parseFloat(b.outlineWidth) || 0;
    const px = (v: string) => Number.parseFloat(v);
    return {
      focusVisible: el.matches(':focus-visible'),
      left: r.left + px(b.left) - w,
      right: r.right - px(b.right) + w,
      top: r.top + px(b.top) - w,
      bottom: r.bottom - px(b.bottom) + w,
    };
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
    // A phone held sideways, and a short portrait phone: the heading (monogram, word, AUTHENTICATION) stays inside
    // the emblem, whose size follows the height there, so it never reaches the resting orbit's ring.
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 667, height: 375 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      const box = (await page.locator('.landing__emblem').boundingBox())!;
      const heading = (await page.locator('h1.landing__title').boundingBox())!;
      const where = `${viewport.width} × ${viewport.height}`;
      expect(heading.y, where).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(heading.y + heading.height, where).toBeLessThanOrEqual(box.y + box.height + 0.5);
      expect((await monogram.boundingBox())!.width, where).toBeGreaterThan(30);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    expect((await monogram.boundingBox())!.width).toBeCloseTo(0.195 * MOBILE_VIEWPORT.width, 0);

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
    // Its focus ring keeps to the word, as before the tap zones grew: clear of the dots on either side.
    const ring = (await focusRingOf(page.getByRole('tab', { name: 'WARRANTY' })))!;
    expect(ring.focusVisible).toBe(true);
    const dots = await page.locator('.tabs__dot').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
    expect(ring.left).toBeGreaterThan(dots[0].right + 1);
    expect(ring.right).toBeLessThan(dots[1].left - 1);
    await page.keyboard.press('End');
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    // A piece ORBES has not sold yet says so (S-07): not yet delivered by ORBES or an authorised retailer.
    await textOf(page.locator('.ownership__status'), 'NOT YET DELIVERED');
    await textOf(page.locator('.ownership__text'), 'This piece has not yet been delivered by ORBES or an authorised retailer. Registration opens once it has been.');

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
    // An ordinary address, longer than the line has room for beside SIGN OUT on a small phone.
    const email = 'marie-claire.dupont@example.com';
    await page.getByLabel('EMAIL').fill(email);
    await page.getByLabel('PASSWORD').fill('too short');
    await page.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();
    await textOf(page.getByRole('alert'), /at least 12 characters/);
    // The typed email survives a failed attempt.
    await valueOf(page.getByLabel('EMAIL'), email);
    await page.getByLabel('PASSWORD').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();

    // Signed in (session cookie + CSRF token): the claim form appears.
    await visible(page.getByLabel('CLAIM CODE'));
    await textOf(page.locator('.ownership__email'), email);
    await keepsFloors(page, ['REGISTER THIS PIECE', 'SIGN OUT']);
    // At every phone width SIGN OUT keeps its one line (the floors check each label's lines): the account line wraps instead.
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['REGISTER THIS PIECE', 'SIGN OUT']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
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
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['CANCEL TRANSFER', 'SIGN OUT']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.getByRole('button', { name: 'CANCEL TRANSFER' }).click();
    await textOf(page.locator('.form__notice'), 'The transfer has been cancelled.');

    const owner = await srv.ctx.services.ownership.currentOwner(issued.product.id);
    expect(owner).toBeTruthy();
    expect(problems).toEqual([]);
  }, 120_000);

  it('recovers a forgotten password with the code of ORBES Client Services, then changes it beside SIGN OUT', async () => {
    // An owner who forgot the password scans their piece, signed out.
    const email = 'helene.martin@example.com';
    const owner = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    const issued = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = await srv.ctx.services.verification.verify({ code: issued.code.data }, {});
    await srv.ctx.services.ownership.registerFirst(owner.account.id, { registrationToken: scan.registration!.token, claimCode: issued.claimCode! }, { type: 'account', id: owner.account.id });
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'recover.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC REGISTERED');
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    const panel = page.locator('.ownership');

    // Under SIGN IN: FORGOTTEN PASSWORD?, a text link, which leads to ORBES Client Services.
    await visible(panel.getByLabel('PASSWORD', { exact: true }));
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT', 'FORGOTTEN PASSWORD?']);
    // From the keyboard (Enter), where a focus ring would show if the heading had one.
    await page.getByRole('button', { name: 'FORGOTTEN PASSWORD?' }).focus();
    await page.keyboard.press('Enter');
    await textOf(panel.locator('#recover-title'), 'FORGOTTEN PASSWORD');
    // A section under the status of the piece, where the sign-in form was; keyboard focus moves to it, without a
    // ring: a heading focused on a screen change shows none (BRAND §3.8).
    await textOf(panel.locator('.ownership__status'), 'REGISTERED TO ITS OWNER');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('recover-title');
    expect(await panel.locator('#recover-title').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    await textOf(panel, /After checking your identity, they give you a one-time recovery code, valid for 30 minutes\./);
    const contact = panel.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    await visible(contact);
    const ref = (await page.locator('.result__meta').innerText()).match(/REF ([0-9A-F]{8})/)![1];
    const href = new URL((await contact.getAttribute('href'))!);
    expect(href.pathname).toBe(CLIENT_SERVICES.email);
    expect(href.searchParams.get('subject')).toBe('ORBES — FORGOTTEN PASSWORD');
    expect(href.searchParams.get('body')).toBe(`\r\n\r\nREFERENCE: ${ref}`);
    await attrOf(panel.locator('.contact'), 'data-placement', 'recovery');
    await visible(panel.getByRole('link', { name: `Call ORBES Client Services, ${CLIENT_SERVICES.phone}` }));
    const recoverControls = ['CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'I HAVE A RECOVERY CODE', 'BACK TO SIGN IN'];
    await keepsFloors(page, recoverControls);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, recoverControls);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-forgotten-password.png'), fullPage: true });

    // The code, given by Client Services after the identity check (an ADMIN, in the console).
    await page.getByRole('button', { name: 'I HAVE A RECOVERY CODE' }).click();
    await textOf(panel.locator('#recover-title'), 'SET A NEW PASSWORD');
    await keepsFloors(page, ['SET NEW PASSWORD', 'BACK TO SIGN IN']);
    const staff = await srv.ctx.services.auth.createAdmin({ email: 'client.services@orbes.test', password: 'client services passphrase', role: 'ADMIN' }, SYSTEM_ACTOR);
    const { recoveryCode } = await srv.ctx.services.recovery.issue(owner.account.id, { type: 'admin', id: staff.id });
    await panel.getByLabel('EMAIL', { exact: true }).fill(email);
    await panel.getByLabel('RECOVERY CODE', { exact: true }).fill('ZZZZ-ZZZZ-ZZZZ');
    await panel.getByLabel('NEW PASSWORD', { exact: true }).fill('a brand new passphrase');
    await page.getByRole('button', { name: 'SET NEW PASSWORD' }).click();
    // One answer for every refusal, as the server wrote it; the form keeps the email.
    await textOf(panel.getByRole('alert'), /^This email and recovery code do not match, or the code has expired or was already used\./);
    await valueOf(panel.getByLabel('EMAIL', { exact: true }), email);
    // Any spelling of the code is accepted; the field shows it grouped.
    await panel.getByLabel('RECOVERY CODE', { exact: true }).fill(recoveryCode.replace(/-/g, '').toLowerCase());
    await valueOf(panel.getByLabel('RECOVERY CODE', { exact: true }), recoveryCode);
    await panel.getByLabel('NEW PASSWORD', { exact: true }).fill('a brand new passphrase');
    await page.getByRole('button', { name: 'SET NEW PASSWORD' }).click();

    // Back to SIGN IN, the email filled in, with what the recovery did.
    await textOf(page.locator('.form__notice'), /^Your password has been changed: sign in with it\. For your security, every session of your account has ended, its pending transfers were cancelled and new transfers are paused until \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d\.$/);
    await valueOf(panel.getByLabel('EMAIL', { exact: true }), email);
    await panel.getByLabel('PASSWORD', { exact: true }).fill('a brand new passphrase');
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await textOf(page.locator('.ownership__email'), email);

    // Signed in: CHANGE PASSWORD beside SIGN OUT, both on one line at every phone width.
    await keepsFloors(page, ['CHANGE PASSWORD', 'SIGN OUT']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['CHANGE PASSWORD', 'SIGN OUT']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    await textOf(panel.locator('.ownership__status'), 'CHANGE PASSWORD');
    await keepsFloors(page, ['CHANGE PASSWORD', 'CANCEL', 'SIGN OUT']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-change-password.png'), fullPage: true });
    // A wrong current password is said on its field; the page stays signed in (a 400, never a 401).
    await panel.getByLabel('CURRENT PASSWORD', { exact: true }).fill('not my password at all');
    await panel.getByLabel('NEW PASSWORD', { exact: true }).fill('another new passphrase');
    await panel.locator('form').getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    await textOf(panel.getByRole('alert'), 'The current password is not correct.');
    await attrOf(panel.getByLabel('CURRENT PASSWORD', { exact: true }), 'aria-invalid', 'true');
    await textOf(page.locator('.ownership__email'), email);
    await panel.getByLabel('CURRENT PASSWORD', { exact: true }).fill('a brand new passphrase');
    await panel.locator('form').getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    await textOf(page.locator('.form__notice'), 'Your password has been changed. Your other sessions have ended.');
    await textOf(page.locator('.ownership__email'), email);
    expect((await srv.ctx.services.auth.login({ email, password: 'another new passphrase' }, {})).account.email).toBe(email);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('scans as staff in a browser signed in to the console (S-07): no registration offered, the scan recorded under the console user', async () => {
    const issued = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const creds = { email: `seller-${issued.product.productId.toLowerCase()}@orbes.test`, password: PASSWORD };
    const seller = await srv.ctx.services.auth.createAdmin({ ...creds, role: 'RETAIL' }, SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // The console's sign-in, from this browser: its cookie (Path=/) now goes with every request of the origin.
    const signedIn = await page.evaluate(
      async (c) => (await fetch('/api/admin/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) })).status,
      creds,
    );
    expect(signedIn).toBe(200);

    await uploadPhoto(page, writeCodePng(srv.workDir, 'staff.png', issued));
    // The state a buyer would see, but no registration: the result opens on PRODUCT, and OWNERSHIP says why.
    expect(await resultTitle(page)).toBe('AUTHENTIC FIRST REGISTRATION');
    await attrOf(page.getByRole('tab', { name: 'PRODUCT' }), 'aria-selected', 'true');
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await textOf(page.locator('.ownership__status'), 'STAFF SCAN');
    await textOf(page.locator('.ownership__text'), STAFF_SCAN_NOTE);
    await countOf(page.locator('.ownership form, .ownership button'), 0);

    const scan = await srv.ctx.db.selectFrom('scan_events').select(['event_type', 'admin_id', 'device_hash']).where('product_id', '=', issued.product.id).executeTakeFirstOrThrow();
    expect(scan).toEqual({ event_type: 'ADMIN_TEST', admin_id: seller.id, device_hash: null });
    expect(await srv.ctx.db.selectFrom('scan_tokens').select('id_hash').where('product_id', '=', issued.product.id).execute()).toEqual([]);

    // A code ORBES did not sign, from the same browser: a staff scan takes no report, so WHERE DID YOU SEE OR BUY
    // THIS PIECE? is not offered (the server would refuse it, and scanning again would only make another staff scan).
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[30] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'staff-forged.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await visible(page.locator('.result__help'));
    await countOf(page.getByRole('region', { name: 'WHERE DID YOU SEE OR BUY THIS PIECE?' }), 0);
    await countOf(page.locator('.report'), 0);
    const forgedScans = await srv.ctx.db.selectFrom('scan_events').select(['event_type', 'result_state']).where('admin_id', '=', seller.id).orderBy('result_state').execute();
    expect(forgedScans).toEqual([
      { event_type: 'ADMIN_TEST', result_state: 'AUTHENTIC_FIRST_REGISTRATION' },
      { event_type: 'ADMIN_TEST', result_state: 'INVALID_SIGNATURE' },
    ]);
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

    // Sign-in first (an account is created), then the CLAIM CODE, which is required: no claim form before it.
    await countOf(page.getByLabel('CLAIM CODE'), 0);
    await card.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await countOf(page.getByLabel('CLAIM CODE'), 0);
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
    // Registration held (too many claim codes tried for this piece, by anyone, within the hour): the line says how
    // long, and who helps, since the hold can outlast this scan's window.
    await page.route('**/api/v1/ownership/register', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }) }),
    );
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await textOf(page.getByRole('alert'), CLAIM_HELD);
    expect(CLAIM_HELD).toMatch(/up to an hour.*ORBES Client Services can assist you\.$/);
    await page.unroute('**/api/v1/ownership/register');
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

  it('points a closed registration window of the certificate-card section to the one SCAN AGAIN of the page', async () => {
    const issued = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    for (let i = 0; i < 22; i++) {
      await srv.ctx.services.verification.verify({ code: issued.code.data }, { deviceHash: `late-device-${i}`, ipHash: `late-ip-${i}`, geo: { country: 'FR' } });
    }
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'late.png', issued));
    expect(await resultTitle(page)).toBe('UNUSUAL ACTIVITY DETECTED');
    const card = page.getByRole('region', { name: 'DO YOU HOLD THE CERTIFICATE CARD?' });
    await visible(card);
    await countOf(page.getByRole('button', { name: 'SCAN AGAIN' }), 1);
    // The visitor takes longer than the 15 minutes of the scan's registration window, then acts in the section.
    await page.clock.setFixedTime(Date.now() + 16 * 60_000);
    await card.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await textOf(card.locator('.ownership__text'), /registration window of this scan has closed\. Scan the code again, then register this piece with the claim code of its certificate card\./);
    await countOf(card.getByRole('button'), 0);
    await countOf(page.getByLabel('CLAIM CODE'), 0);
    // One SCAN AGAIN: the foot's.
    await countOf(page.getByRole('button', { name: 'SCAN AGAIN' }), 1);
    await countOf(page.locator('.result__foot').getByRole('button', { name: 'SCAN AGAIN' }), 1);
    expect(problems).toEqual([]);
  }, 120_000);

  it('keeps an UNUSUAL ACTIVITY result without registration as it was: no certificate-card section, the help line and the contact', async () => {
    // A piece reported STOLEN (a status finding), and a piece issued without a claim code whose history alone is
    // suspicious: the server offers no registration token for either.
    const stolen = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.lifecycle.transition(stolen.product.id, 'STOLEN', { reason: 'Reported by its owner' }, SYSTEM_ACTOR);
    const plain = await srv.issue({ withClaimSecret: false });
    await srv.ctx.services.warranty.activate(plain.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    for (let i = 0; i < 22; i++) {
      await srv.ctx.services.verification.verify({ code: plain.code.data }, { deviceHash: `plain-device-${i}`, ipHash: `plain-ip-${i}`, geo: { country: 'FR' } });
    }
    for (const [name, piece] of [
      ['stolen.png', stolen],
      ['no-claim-code.png', plain],
    ] as const) {
      const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
      await uploadPhoto(page, writeCodePng(srv.workDir, name, piece));
      expect(await resultTitle(page), name).toBe('UNUSUAL ACTIVITY DETECTED');
      await attrOf(page.locator('.view--result'), 'data-tone', 'caution');
      await visible(page.locator('.result__help'));
      await countOf(page.locator('.result__card'), 0);
      await countOf(page.getByRole('region', { name: 'DO YOU HOLD THE CERTIFICATE CARD?' }), 0);
      await countOf(page.getByLabel('CLAIM CODE'), 0);
      await countOf(page.getByRole('tab'), 0);
      await visible(page.locator('.result__help').getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
      await countOf(page.getByRole('button', { name: 'SCAN AGAIN' }), 1);
      await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', 'SCAN AGAIN']);
      expect(problems, name).toEqual([]);
      await page.context().close();
    }
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
    expect(href.searchParams.get('body')).toMatch(new RegExp(`^\\r\\n\\r\\nREFERENCE: ${ref}\\r\\nRESULT: INVALID SIGNATURE\\r\\nVERIFIED: \\d{1,2} [A-Z]{3} \\d{4} · \\d\\d:\\d\\d \\(UTC[+-]\\d\\d:\\d\\d\\)$`));
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

  it('asks WHERE DID YOU SEE OR BUY THIS PIECE? under the contact of an INVALID SIGNATURE result, and attaches the answer to its scan', async () => {
    const issued = await srv.issue();
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[20] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'forged-report.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    const scan = await srv.ctx.db.selectFrom('scan_events').select(['id', 'result_state']).orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(scan.result_state).toBe('INVALID_SIGNATURE');
    const ref = scan.id.split('-')[0].toUpperCase();

    // Under the help line and its contact; the question a status line in the display face, 11 px.
    const section = page.getByRole('region', { name: 'WHERE DID YOU SEE OR BUY THIS PIECE?' });
    await visible(section);
    expect(await page.locator('.result__help + .report').count()).toBe(1);
    const title = section.getByRole('heading', { level: 2 });
    expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('11px');
    expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans/);
    await textOf(section.locator('.report__lead'), 'Optional. Your answer stays with this reference, for ORBES Client Services.');
    // Four answers and nothing to type until one is chosen; SCAN AGAIN stays the one hairline button.
    await textsOf(section.getByRole('button'), ['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER']);
    expect(await section.locator('form').isHidden()).toBe(true);
    await countOf(page.locator('.btn:visible'), 1);
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', 'BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER', 'SCAN AGAIN']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER', 'SCAN AGAIN']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);

    // ONLINE: pressed, then the place, the note and SEND ANSWER (a text link).
    const online = section.getByRole('button', { name: 'ONLINE' });
    await online.click();
    await attrOf(online, 'aria-pressed', 'true');
    await attrOf(section.getByRole('button', { name: 'BOUTIQUE' }), 'aria-pressed', 'false');
    await visible(section.getByLabel('PLACE (OPTIONAL)'));
    await section.getByLabel('PLACE (OPTIONAL)').fill('a marketplace listing');
    await section.getByLabel('NOTE (OPTIONAL)').fill('Offered at a third of the boutique price.');
    await textOf(section.locator('#report-note-hint'), 'Please leave out your name and contact details.');
    const send = section.getByRole('button', { name: 'SEND ANSWER' });
    await attrOf(send, 'class', 'textlink report__send');
    await countOf(page.locator('.btn:visible'), 1);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER', 'SEND ANSWER', 'SCAN AGAIN']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-invalid-signature-report.png'), fullPage: true });

    // A refusal from the server is shown as it comes, and nothing typed is lost.
    await page.route('**/api/v1/reports', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'REPORT_NOT_ALLOWED', message: 'A report can be sent only within 24 hours of a result that was not authentic. Please scan the piece again.' } }),
      }),
    );
    await send.click();
    await textOf(section.getByRole('alert'), 'A report can be sent only within 24 hours of a result that was not authentic. Please scan the piece again.');
    await valueOf(section.getByLabel('PLACE (OPTIONAL)'), 'a marketplace listing');
    await page.unroute('**/api/v1/reports');

    // Sent: the thanks, with the reference of the result's foot; the case waits in the console's queue.
    await send.click();
    await textOf(section.getByRole('status'), 'THANK YOU');
    await textOf(section.locator('.report__lead'), `Your answer is kept with reference ${ref}.`);
    await countOf(section.getByRole('button'), 0);
    await textOf(page.locator('.result__meta'), new RegExp(`REF ${ref}$`));
    const row = await srv.ctx.db.selectFrom('scan_reports').selectAll().where('scan_event_id', '=', scan.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ channel: 'ONLINE', place: 'a marketplace listing', note: 'Offered at a third of the boutique price.', status: 'OPEN' });
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', 'SCAN AGAIN']);
    expect(problems).toEqual([]);
  }, 120_000);

  it('shows a result without waiting for a contact read that does not answer, and offers the contact on a later result', async () => {
    const issued = await srv.issue();
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[12] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // The first read of the contact is held by the network and never answered; later ones go through.
    let held = 0;
    await page.route('**/api/v1/client-services', async (route) => {
      if (held++ === 0) return;
      await route.fallback();
    });
    const verified = page.waitForResponse((r) => r.url().endsWith('/api/v1/verify'));
    await uploadPhoto(page, writeCodePng(srv.workDir, 'stalled-contact.png', forged));
    await verified;
    const answeredAt = Date.now();
    await page.locator('.view--result').waitFor({ timeout: 10_000 });
    // Not the 15 s of a request timeout: about the 1 s the result may wait for the contact, at most.
    expect(Date.now() - answeredAt).toBeLessThan(3_000);
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await countOf(page.locator('.contact'), 0);
    await visible(page.locator('.result__help'));
    // The held read gives up on its own (a few seconds); the next result reads the contact again and shows it.
    await page.waitForTimeout(4_500);
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'stalled-contact-2.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await visible(page.locator('.result__help').getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
    expect(held).toBe(2);
    expect(problems.filter((p) => !/client-services/.test(p))).toEqual([]);
    await page.context().close();
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
