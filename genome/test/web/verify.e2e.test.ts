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
 * the scan, the photographs of an authentic piece above its GENOME (F-04),
 * the links to the legal pages at the foot of the landing, under a result
 * and under CREATE ACCOUNT (J-06),
 * the password (FORGOTTEN PASSWORD? through ORBES Client Services and a
 * recovery code, then CHANGE PASSWORD in MY PIECES), the second-hand
 * guidance under AUTHENTIC — REGISTERED and its link to RECEIVING THIS PIECE
 * (J-02), the reception of a piece with its transfer code (F-03: signed in
 * after the scan, VERIFY AGAIN; the code of another piece refused; the
 * window of the scan closed; from an UNUSUAL ACTIVITY result caused by the
 * scan history alone; never from a staff scan), MY PIECES (F-01: sign-in,
 * the list and the photograph of a piece (F-04), its tabs from the keyboard,
 * a piece reported stolen then scanned by a stranger, a loss withdrawn with
 * the account's password and read again from the server, a piece the owner
 * cannot report; a direct link, a reload and the back button), the
 * ownership certificate (F-06: created in MY PIECES, opened from its link by
 * a visitor, its PDF, ended by a declaration, withdrawn, its address typed
 * back in capitals as the PDF letters it; a list of links that cannot be
 * read stays said after a creation), THE COLLECTION (P-R02: the lookbook
 * from the landing, a model's sheet and the way back through the lookbook,
 * a sheet's address opened directly, SEE THE MODEL under an authentic
 * result, the models reserved for an owner signed in), THE RELEASES (P-R03:
 * the list from the landing, a release's page, its sign-in, ENTER THE DRAW
 * and WITHDRAW, YOUR RELEASES in MY PIECES, then, drawn, the place held with
 * the contact of ORBES Client Services, the seed checked on the phone and
 * the entries by rank; P-X02: the early access, both openings under the
 * state, RESERVE A PLACE for a PLATINE owner and the place held at once, a
 * TITANE owner who waits, the privilege recalled in MY PIECES and THE
 * CIRCLE), the tier at the head of MY PIECES (P-X04: the badge, the
 * benefits and the way to the next tier as ORBES words it; THE CLUB for an
 * account without a piece), THE CIRCLE (P-X01: signed out its sign-in, then the
 * feed of an owner, each post from its tier up; an invitation answered YES
 * then NO within its places; a poll, one option chosen then VOTE, then its
 * results; a note's photographs, text and links, the release's page and a
 * film on another site with its host; THE CIRCLE in MY PIECES; an account
 * that holds no piece told it opens with one), the ceremony of a first
 * registration (P-D01: the glyphs one by one, then the model and its
 * collection, the vibration, SHARE THE GENOME shared or saved, without motion
 * when it is reduced, kept by TRY AGAIN, never for a piece received), the
 * sound signature (P-D07: the chord on an authentic result only, its
 * AudioContext created in the tap UPLOAD A PHOTO or SCAN ORBES CODE, SOUND ON /
 * OFF at the foot of the landing, kept on the device across a reload), the scan
 * as a ritual (P-D10: the ring tightened around the centre while a decoder
 * stand-in sees a seal, 4 times a second at most, then loosened; only steadied
 * when motion is reduced; VERIFYING… on the scanner's ring; the GENOME plate
 * opening from its centre), and the problem screens. On each
 * screen the floors of BRAND-DESIGN-SYSTEM §3.8 are measured: 10 px type
 * and 44 × 44 px tap zones for every button, link and tab. Mobile screenshots of the landing and result screens are written
 * to genome/out/ for design review.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, ConsoleMessage, Locator, Page } from 'playwright-core';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { genomeLayout } from '../../src/core/genome/render.js';
import { frameCodeData, unframeCodeData } from '../../src/core/payload.js';
import { certificateLinkLettering } from '../../src/server/render/certificate.js';
import { CLUB_TIER_DEFAULT_BENEFITS } from '../../src/server/services/club.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { CEREMONY, CIRCLE, CLAIM_HELD, ORBES_CARE, RECEIVING, RELEASES, RESALE_ACTION, RESALE_GUIDANCE, STAFF_SCAN_NOTE } from '../../src/web/verify/copy.js';
import { groupHex } from '../../src/web/verify/releases-model.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { jpegPhoto, SEGMENTS, withJpegSegments } from '../support/images.js';
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
 * The ceremony's stand-ins (P-D01), set on the page before VIEW AS OWNER (the app is one page: they stay): the
 * vibrations asked for, and a share sheet that accepts a file (`share`: the file and whether the tap was still
 * active when it was handed over) or none (`save`: the browser cannot share a file, so the image is saved).
 */
async function standInsForCeremony(page: Page, mode: 'share' | 'save'): Promise<void> {
  await page.evaluate((m) => {
    const w = window as unknown as { vibrations: unknown[]; shared: unknown[] };
    w.vibrations = [];
    w.shared = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern: unknown) => (w.vibrations.push(pattern), true) });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: ShareData) => m === 'share' && (d.files?.length ?? 0) === 1 });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: ShareData) => {
        const file = d.files![0];
        const entry = { name: file.name, type: file.type, title: d.title, activeTap: navigator.userActivation.isActive, png: false };
        entry.png = [...new Uint8Array(await file.slice(0, 4).arrayBuffer())].join(',') === '137,80,78,71';
        w.shared.push(entry);
      },
    });
  }, mode);
}

const vibrationsOf = (page: Page) => page.evaluate(() => (window as unknown as { vibrations: unknown[] }).vibrations);

/** What the sound signature (P-D07) did on the page: each AudioContext created, then each voice of a chord (its Hz). */
interface SoundRecord {
  contexts: { activeTap: boolean; session: string }[];
  notes: number[];
}

/**
 * The sound signature's stand-ins (P-D07), set on the page before the tap (the app is one page: they stay until a
 * reload): Safari's navigator.audioSession, and the page's AudioContext, recording whether the tap was still active
 * when it was created, the session's type then, and the frequency of every voice scheduled on it.
 */
async function recordSound(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec: SoundRecord = { contexts: [], notes: [] };
    const w = window as unknown as { __sound: SoundRecord; AudioContext: typeof AudioContext };
    w.__sound = rec;
    const session = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session });
    const Native = w.AudioContext;
    w.AudioContext = class extends Native {
      constructor() {
        super();
        rec.contexts.push({ activeTap: navigator.userActivation.isActive, session: session.type });
      }
      override createOscillator(): OscillatorNode {
        const osc = super.createOscillator();
        const set = osc.frequency.setValueAtTime.bind(osc.frequency);
        osc.frequency.setValueAtTime = (value: number, time: number) => (rec.notes.push(Math.round(value)), set(value, time));
        return osc;
      }
    };
  });
}

const soundOf = (page: Page) => page.evaluate(() => (window as unknown as { __sound: SoundRecord }).__sound);
/** The chord's voices, rounded to the hertz (src/web/verify/sound.ts). */
const CHORD = [294, 440, 554, 659];

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

/** The links to the legal pages (J-06) at the foot of the landing and under every result, then DB-IP's attribution. */
const LEGAL_LINKS = ['PRIVACY', 'TERMS', 'LEGAL', 'HELP', 'IP Geolocation by DB-IP'];

/** The plate of NOCTURNE (--vault-plate): the house's ivory plates turn to it on its ground (no ivory plate in /verify). */
const PLATE = 'rgb(20, 19, 18)';

/** The legal links of `scope`: their names, addresses and targets, in order. */
async function legalLinksOf(scope: Locator): Promise<{ name: string; href: string | null; target: string | null }[]> {
  return scope.getByRole('navigation', { name: 'Legal information' }).getByRole('link').evaluateAll((els) =>
    els.map((el) => ({ name: (el.textContent ?? '').trim(), href: el.getAttribute('href'), target: el.getAttribute('target') })),
  );
}

/** The account sheet (C2), from the header's account button, once the tier is read. */
async function openAccount(page: Page): Promise<void> {
  const account = page.locator('.n-hd button.n-acct');
  await account.waitFor();
  await account.click();
  await page.locator('.n-account:not([hidden]) .n-account__tier').waitFor();
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
    // NOW (N3): the header's wordmark, the rail, SCAN ORBES CODE and UPLOAD A PHOTO.
    await page.locator('.view--now[data-ready]').waitFor();
    for (const selector of ['.n-wm', '.n-rail__link', '.landing__scan', '.landing__upload']) {
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
    // NOW (N3), in place of the landing: nothing announced and no model shown here, so it opens on the scan, the page
    // named NOW (no hero, no title of its own); the header says ORBES.
    await page.locator('.view--now[data-ready]').waitFor();
    await attrOf(page.locator('main.view--now'), 'aria-label', 'NOW');
    expect(await page.locator('.view--now > section').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Scan']);
    await textOf(page.locator('header.n-hd .n-wm'), 'ORBES');
    // The one image named ORBES is NOCTURNE's footer's monogram (as the canvas names it); the header's is decorative.
    await countOf(page.getByRole('img', { name: 'ORBES' }), 1);
    await countOf(page.locator('footer.n-foot').getByRole('img', { name: 'ORBES' }), 1);
    const footMono = page.locator('footer.n-foot svg.monogram');
    // In the ink of its context: ivory on NOCTURNE's ground.
    expect(await footMono.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(246, 242, 234)');
    await page.screenshot({ path: join(OUT_DIR, 'verify-landing.png') });
    await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO', ...LEGAL_LINKS]);
    // A phone held sideways, a short portrait phone and the smallest in use: the scan and its link stay whole, the page
    // never scrolls sideways.
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 667, height: 375 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      const where = `${viewport.width} × ${viewport.height}`;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
      await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);

    await uploadPhoto(page, writeCodePng(srv.workDir, 'plain.png', plain));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    const result = page.locator('.view--result');
    await attrOf(result, 'data-state', 'AUTHENTIC');
    await textOf(page.locator('.n-result__genome .n-gen__id'), plain.product.productId);
    expect(plain.product.productId).toBe('O26-J-00184');
    // The model's name over the piece's lines (C9).
    await textOf(page.locator('.n-result__name'), 'MONOLITHE');
    await textsOf(page.locator('.n-result__lines .n-lines__line'), ['RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    // The GENOME is drawn from the core renderer, in its orbit as on the piece, the ORBES monogram at its centre on a
    // collector's screen (NOCTURNE, decision 12): the monogram's layer in place of the seal's, one group per glyph, in ivory.
    const genome = page.locator('.n-result__genome .n-gen__figure .genome-svg');
    await attrOf(genome, 'aria-label', new RegExp(plain.genome.fingerprint));
    await attrOf(genome, 'class', /\bgenome-svg--orbit\b/);
    await countOf(genome.locator('g[data-layer="seal"]'), 0);
    await countOf(genome.locator('g[data-layer="monogram"] path'), 5);
    await countOf(genome.locator('g[data-layer="genome"]'), 8);
    await attrOf(genome.locator('g[fill]').first(), 'fill', '#f6f2ea');
    // A square of 200 px, as the canvas draws it (C9): glyphs of about 33 px.
    const box = await genome.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeCloseTo(200, 0);
    expect(box!.height).toBeCloseTo(box!.width, 0);
    expect(box!.x + box!.width / 2).toBeCloseTo(MOBILE_VIEWPORT.width / 2, 0);
    // The fingerprint beneath, a fact the customer may compare: 11.5 px (C9's .gen .fp), not the 8 px of decoration.
    expect(await page.locator('.n-result__genome .n-gen__fp').evaluate((el) => getComputedStyle(el).fontSize)).toBe('11.5px');
    const orbit = genomeLayout(plain.genome, 'orbit');
    expect((box!.width * 2 * orbit.glyphRadius) / orbit.viewBox.w).toBeGreaterThan(32);
    await textsOf(page.getByRole('tab'), ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP']);
    await attrOf(page.getByRole('tab', { name: 'PRODUCT' }), 'aria-selected', 'true');
    // The id, the fingerprint, the product lines, the rows and the reference read in Helvetica Neue.
    expect(await figuresInDisplayFace(page)).toEqual([]);
    // Honest limits are stated on every positive result.
    await textOf(page.locator('.n-result__footnote'), /cannot prove that an object is genuine/);
    // Focus moved to the new screen's heading for screen readers.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('result-title');

    await page.waitForTimeout(2_000);
    await page.screenshot({ path: join(OUT_DIR, 'verify-result.png'), fullPage: true });
    // The four tabs at 10 px keep the width they had at 9 px: 44 px zones on this phone and on the
    // smallest in use (320 px, where they tighten), without scrolling sideways.
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER', ...LEGAL_LINKS]);
    await page.setViewportSize({ width: 320, height: 640 });
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER', ...LEGAL_LINKS]);
    await page.setViewportSize(MOBILE_VIEWPORT);

    // Keyboard: arrows move between tabs and show their panels.
    await page.getByRole('tab', { name: 'PRODUCT' }).focus();
    await page.keyboard.press('ArrowRight');
    await attrOf(page.getByRole('tab', { name: 'WARRANTY' }), 'aria-selected', 'true');
    await textOf(page.getByRole('tabpanel'), /NOT YET STARTED/);
    // Its focus ring shows, clear of the tabs on either side (C9's tabs spread across the column, no dots between them).
    // NOCTURNE's ring: an ivory outline, 2 px, 2 px off (plan, Accessibility), round the word.
    const ring = await page.getByRole('tab', { name: 'WARRANTY' }).evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const off = Number.parseFloat(cs.outlineWidth) + Number.parseFloat(cs.outlineOffset);
      return { focusVisible: el.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth, left: r.left - off, right: r.right + off };
    });
    expect(ring).toMatchObject({ focusVisible: true, style: 'solid', width: '2px' });
    const product = (await page.getByRole('tab', { name: 'PRODUCT' }).boundingBox())!;
    const care = (await page.getByRole('tab', { name: 'CARE' }).boundingBox())!;
    expect(ring.left).toBeGreaterThan(product.x + product.width);
    expect(ring.right).toBeLessThan(care.x);
    await page.keyboard.press('End');
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    // A piece ORBES has not sold yet says so (S-07): not yet delivered by ORBES or an authorised retailer.
    await textOf(page.locator('.n-own__status'), 'NOT YET DELIVERED');
    await textOf(page.locator('.n-own__small'), 'This piece has not yet been delivered by ORBES or an authorised retailer. Registration opens once it has been.');

    // Back returns to the landing screen.
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(problems).toEqual([]);
  }, 120_000);

  it('links the legal pages (J-06) at the foot of every screen, NOCTURNE\'s footer, in a new tab, with the attribution of DB-IP', async () => {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // The landing: the footer's links, as the canvas has them, in a new tab (the screen stays); DB-IP's site apart.
    const footer = page.locator('footer.n-foot');
    const FOOT = [
      { name: 'PRIVACY', href: '/legal/privacy', target: '_blank' },
      { name: 'TERMS', href: '/legal/terms', target: '_blank' },
      { name: 'LEGAL', href: '/legal/notice', target: '_blank' },
      { name: 'HELP', href: '/legal/faq', target: '_blank' },
    ];
    expect(await legalLinksOf(footer)).toEqual(FOOT);
    await attrOf(footer.getByRole('link', { name: 'IP Geolocation by DB-IP' }), 'href', 'https://db-ip.com');
    await attrOf(footer.getByRole('link', { name: 'IP Geolocation by DB-IP' }), 'target', '_blank');
    for (const a of await footer.getByRole('link').all()) await attrOf(a, 'rel', 'noopener');
    // Words in the display face, under the screen and its actions, in the page's flow.
    const privacy = footer.getByRole('link', { name: 'PRIVACY' });
    expect(await privacy.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans"?/);
    const actions = (await page.locator('section[aria-label="Scan"]').boundingBox())!;
    const links = (await footer.locator('.n-fl').boundingBox())!;
    const copyright = (await footer.locator('.n-cr').boundingBox())!;
    expect(links.y).toBeGreaterThan(actions.y + actions.height);
    expect(copyright.y).toBeGreaterThan(links.y + links.height);
    expect(await footer.evaluate((el) => getComputedStyle(el).position)).toBe('relative');
    // The four pages on one line on this phone and on the smallest in use, the floors kept.
    for (const width of [...PHONE_WIDTHS, MOBILE_VIEWPORT.width]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      const rows = await footer.locator('.n-fl a').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
      expect(rows, `${width}`).toBe(1);
      await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO', ...LEGAL_LINKS]);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    // A short screen scrolls down to them rather than laying them over the actions.
    await page.setViewportSize({ width: 320, height: 568 });
    const upload = (await page.getByRole('button', { name: 'UPLOAD A PHOTO' }).boundingBox())!;
    expect((await footer.locator('.n-fl').boundingBox())!.y).toBeGreaterThan(upload.y + upload.height);
    await page.setViewportSize(MOBILE_VIEWPORT);

    // PRIVACY opens the privacy policy in English, the app's language here (en-GB), in a new tab.
    const [privacyTab] = await Promise.all([page.context().waitForEvent('page'), privacy.click()]);
    await privacyTab.waitForLoadState();
    expect(privacyTab.url()).toBe(`${srv.origin}/legal/privacy`);
    await textOf(privacyTab.locator('h1'), 'PRIVACY POLICY');
    expect(await privacyTab.evaluate(() => document.documentElement.lang)).toBe('en');
    await privacyTab.close();

    // Under a result: the same footer, in a new tab, so the result stays for the customer to come back to.
    await uploadPhoto(page, writeCodePng(srv.workDir, 'legal.png', plain));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    expect(await legalLinksOf(footer)).toEqual(FOOT);
    // Under the reference, the result's last line.
    const ref = (await page.locator('.n-result__meta').boundingBox())!;
    expect((await footer.boundingBox())!.y).toBeGreaterThan(ref.y + ref.height);
    const [tab] = await Promise.all([page.context().waitForEvent('page'), footer.getByRole('link', { name: 'HELP' }).click()]);
    await tab.waitForLoadState();
    expect(tab.url()).toBe(`${srv.origin}/legal/faq`);
    await textOf(tab.locator('h1'), 'FREQUENTLY ASKED QUESTIONS');
    await tab.close();
    // The result is still there.
    await attrOf(page.locator('.view--result'), 'data-state', 'AUTHENTIC');
    await keepsFloors(page, ['SCAN ANOTHER', ...LEGAL_LINKS]);
    expect(problems).toEqual([]);
  }, 120_000);

  it('plays the sound signature on an authentic result only, from the tap UPLOAD A PHOTO; SOUND ON / OFF at the foot of every screen, kept on the device (P-D07)', async () => {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // In NOCTURNE's footer, under the legal pages (as the canvas has it): in the display face, on by default.
    const toggle = page.getByRole('button', { name: 'SOUND', exact: true });
    await visible(toggle);
    await countOf(page.locator('footer.n-foot .n-foot__sound > button.n-snd'), 1);
    await attrOf(toggle, 'aria-pressed', 'true');
    await textOf(toggle, 'SOUND ON');
    expect(await toggle.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans"?/);
    const box = (await toggle.boundingBox())!;
    expect(box.y).toBeGreaterThan((await page.locator('section[aria-label="Scan"]').boundingBox())!.y);
    const fl = (await page.locator('footer.n-foot .n-fl').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(fl.y + fl.height);
    await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO', 'SOUND ON', ...LEGAL_LINKS]);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);

    // Nothing is created before a tap; UPLOAD A PHOTO creates the AudioContext in the tap, the session ambient first.
    await recordSound(page);
    expect(await soundOf(page)).toEqual({ contexts: [], notes: [] });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'sound.png', plain));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await expect.poll(() => soundOf(page), POLL).toEqual({ contexts: [{ activeTap: true, session: 'ambient' }], notes: CHORD });

    // A result that is not authentic: no chord.
    await page.goBack();
    await visible(toggle);
    const issued = await srv.issue();
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[10] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    await uploadPhoto(page, writeCodePng(srv.workDir, 'sound-forged.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await page.waitForTimeout(300);
    expect(await soundOf(page)).toEqual({ contexts: [{ activeTap: true, session: 'ambient' }], notes: CHORD });

    // SOUND OFF: pressed no more, kept on the device, read back after a reload; an authentic result is then silent.
    await page.goBack();
    await visible(toggle);
    await toggle.click();
    await attrOf(toggle, 'aria-pressed', 'false');
    await textOf(toggle, 'SOUND OFF');
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({ 'orbes.sound': 'off' });
    await page.reload();
    await visible(toggle);
    await attrOf(toggle, 'aria-pressed', 'false');
    await textOf(toggle, 'SOUND OFF');
    await recordSound(page);
    await uploadPhoto(page, writeCodePng(srv.workDir, 'sound-off.png', plain));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await page.waitForTimeout(300);
    expect(await soundOf(page)).toEqual({ contexts: [], notes: [] });

    // SOUND ON again: the key is removed (on is the default), and the next authentic result sounds.
    await page.goBack();
    await visible(toggle);
    await toggle.click();
    await attrOf(toggle, 'aria-pressed', 'true');
    await textOf(toggle, 'SOUND ON');
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    await uploadPhoto(page, writeCodePng(srv.workDir, 'sound-on.png', plain));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await expect.poll(() => soundOf(page), POLL).toEqual({ contexts: [{ activeTap: true, session: 'ambient' }], notes: CHORD });
    expect(problems).toEqual([]);
  }, 120_000);

  it('registers a piece at first registration: account, claim code, then the owner view', async () => {
    const issued = await srv.issue({ withClaimSecret: true, variant: 'SIZE 52' });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'claim.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC FIRST REGISTRATION');
    // No owner yet, so no transfer code can exist: no second-hand guidance (J-02).
    await countOf(page.locator('.n-result__notice'), 0);
    // Registration opens straight on the OWNERSHIP tab.
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await textOf(page.locator('.n-own__status'), 'REGISTRATION OPEN');
    // The closing time of the window is a fact to read: a label, 9.5 px as the canvas sets it (C9's .lb).
    await textOf(page.locator('.n-own__until'), /^REGISTRATION OPEN UNTIL \d\d:\d\d$/);
    expect(await page.locator('.n-own__until').evaluate((el) => getComputedStyle(el).fontSize)).toBe('9.5px');
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT']);

    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    // Under CREATE ACCOUNT, the terms it accepts and the privacy policy (J-06), each in a new tab: the form and the
    // scan's window stay. The privacy policy is the information due where the account's data is collected.
    await textOf(page.locator('.n-own__terms > span'), 'Creating an ORBES account means accepting the ORBES terms of use.');
    const terms = page.getByRole('link', { name: 'TERMS OF USE' });
    await attrOf(terms, 'href', '/legal/terms');
    await attrOf(terms, 'target', '_blank');
    await attrOf(terms, 'rel', 'noopener');
    const privacyPolicy = page.locator('.n-own__terms').getByRole('link', { name: 'PRIVACY POLICY' });
    await attrOf(privacyPolicy, 'href', '/legal/privacy');
    await attrOf(privacyPolicy, 'target', '_blank');
    await attrOf(privacyPolicy, 'rel', 'noopener');
    expect(await page.locator('.n-own__terms').evaluate((el) => el.previousElementSibling?.matches('form.form--create'))).toBe(true);
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT', 'TERMS OF USE', 'PRIVACY POLICY']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      await keepsFloors(page, ['TERMS OF USE', 'PRIVACY POLICY']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
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
    await textOf(page.locator('.n-own__email'), email);
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
    await textOf(page.locator('.n-own__status'), 'REGISTERED TO YOU');
    await textOf(page.locator('.n-own'), /Ownership verified with its claim code/);

    // Re-verify as the owner: the server now reports the ownership.
    await standInsForCeremony(page, 'save');
    await page.getByRole('button', { name: 'VIEW AS OWNER' }).click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    await countOf(page.locator('.n-result__notice'), 0);
    // The ceremony of a first registration (P-D01), motion reduced: the GENOME plate first, the model and its
    // collection under the glyphs, all at once, and the vibration with them.
    await textOf(page.locator('.n-ceremony__name'), 'MONOLITHE');
    await textOf(page.locator('.n-ceremony__collection'), 'ORBIT');
    expect(await page.locator('.view--result').evaluate((el) => el.classList.contains('is-ceremony'))).toBe(false);
    expect(await page.locator('.view--result > :nth-child(2)').evaluate((el) => el.classList.contains('n-result__ceremony'))).toBe(true);
    expect(await page.locator('.n-result__genome g[data-layer="genome"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))).toEqual(Array(8).fill('none'));
    expect(await vibrationsOf(page)).toEqual([[18, 90, 18]]);
    // SHARE THE GENOME, a text link held to the floors; where the browser cannot share a file, the image is saved.
    const shareGenome = page.getByRole('button', { name: CEREMONY.share });
    await visible(shareGenome);
    expect(await shareGenome.evaluate((el) => el.classList.contains('n-tl'))).toBe(true);
    await keepsFloors(page, [CEREMONY.share, 'SCAN ANOTHER']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    const [image] = await Promise.all([page.waitForEvent('download'), shareGenome.click()]);
    expect(image.suggestedFilename()).toBe('ORBES-GENOME.png');
    const imagePath = join(srv.workDir, 'genome-share.png');
    await image.saveAs(imagePath);
    // For design review, beside the screenshots.
    await image.saveAs(join(OUT_DIR, 'verify-share-genome.png'));
    const png = PNG.sync.read(readFileSync(imagePath));
    expect([png.width, png.height]).toEqual([1080, 1350]);
    const pixel = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    // On ivory, the SEAL's core in the ivory colourway's ink at the centre of the orbit.
    expect(pixel(4, 4)).toEqual([246, 242, 234]);
    expect(pixel(540, 640)).toEqual([17, 17, 17]);
    expect(await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([]);
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await page.getByRole('button', { name: 'CREATE TRANSFER CODE' }).click();
    await textOf(page.locator('.n-own__code'), /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // Its label and validity are labels (C37's .lb, 9.5 px); the validity names the day and the hour.
    expect(await page.locator('.n-own__code-label, .n-own__code + .n-own__until').evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize))).toEqual(['9.5px', '9.5px']);
    await textOf(page.locator('.n-own__code + .n-own__until'), /^VALID UNTIL \d{1,2} [A-Z]{3} \d{4} · \d\d:\d\d$/);
    await keepsFloors(page, ['CANCEL TRANSFER', 'SIGN OUT']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['CANCEL TRANSFER', 'SIGN OUT']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.getByRole('button', { name: 'CANCEL TRANSFER' }).click();
    await textOf(page.locator('.n-own__notice'), 'The transfer has been cancelled.');

    const owner = await srv.ctx.services.ownership.currentOwner(issued.product.id);
    expect(owner).toBeTruthy();
    expect(problems).toEqual([]);
  }, 120_000);

  it('opens the ceremony of a first registration with motion (P-D01): the glyphs one by one, the names, the vibration, SHARE THE GENOME', async () => {
    const issued = await srv.issue({ variant: 'SIZE 48' });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-21', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv);
    await uploadPhoto(page, writeCodePng(srv.workDir, 'ceremony.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC FIRST REGISTRATION');
    // The scan itself is no ceremony.
    await countOf(page.locator('.n-ceremony'), 0);
    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await page.getByLabel('EMAIL').fill('ceremony.p-d01@example.com');
    await page.getByLabel('PASSWORD').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();
    await page.getByRole('button', { name: 'REGISTER THIS PIECE' }).click();
    await textOf(page.locator('.n-own__status'), 'REGISTERED TO YOU');
    await standInsForCeremony(page, 'share');

    // The connection drops under VIEW AS OWNER: TRY AGAIN keeps the ceremony.
    await page.route('**/api/v1/verify', (route) => route.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'VIEW AS OWNER' }).click();
    const tryAgain = page.getByRole('button', { name: 'TRY AGAIN' });
    await visible(tryAgain);
    await page.unroute('**/api/v1/verify');
    await tryAgain.click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toMatch(/^AUTHENTIC (OWNERSHIP VERIFIED|REGISTERED)$/);

    // With motion: each of the eight glyphs (one group of the layer genome) appears in turn, from its --i.
    await attrOf(page.locator('.view--result'), 'class', /\bis-ceremony\b/);
    const glyphs = page.locator('.n-result__genome .genome-svg g[data-layer="genome"]');
    await countOf(glyphs, 8);
    const motion = await glyphs.evaluateAll((els) =>
      els.map((el) => ({ i: (el as SVGGElement).style.getPropertyValue('--i'), name: getComputedStyle(el).animationName, delay: Number.parseFloat(getComputedStyle(el).animationDelay) })),
    );
    expect(motion.map((m) => [m.i, m.name])).toEqual(Array.from({ length: 8 }, (_, i) => [String(i), 'ceremony-glyph']));
    for (let i = 1; i < 8; i++) expect(motion[i].delay).toBeGreaterThan(motion[i - 1].delay);
    // Then the model and its collection rise under them, with the vibration.
    const names = page.locator('.n-ceremony__name');
    expect(await names.evaluate((el) => Number.parseFloat(getComputedStyle(el).animationDelay))).toBeGreaterThan(motion[7].delay);
    await textOf(names, 'MONOLITHE');
    await textOf(page.locator('.n-ceremony__collection'), 'ORBIT');
    await expect.poll(() => vibrationsOf(page), POLL).toEqual([[18, 90, 18]]);

    // SHARE THE GENOME: the PNG, ready before the tap, goes to the share sheet while the tap is still active.
    const shareGenome = page.getByRole('button', { name: CEREMONY.share });
    await expect.poll(() => shareGenome.evaluate((el) => getComputedStyle(el).opacity), POLL).toBe('1');
    await keepsFloors(page, [CEREMONY.share, 'SCAN ANOTHER']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await page.screenshot({ path: join(OUT_DIR, 'verify-ceremony.png'), fullPage: true });
    await shareGenome.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared), POLL)
      .toEqual([{ name: 'ORBES-GENOME.png', type: 'image/png', title: CEREMONY.shareTitle, activeTap: true, png: true }]);
    expect(problems.filter((p) => !/internetdisconnected|ERR_INTERNET_DISCONNECTED/.test(p))).toEqual([]);
  }, 120_000);

  it('receives a piece with its transfer code (F-03): scan, sign in, VERIFY AGAIN, the code of this piece only, then the owner view', async () => {
    // A seller owns two pieces and has offered both: the buyer of one is handed the code of the other first.
    const seller = await srv.ctx.services.auth.registerAccount({ email: 'seller.f03@example.com', password: PASSWORD }, {});
    const sellerActor = { type: 'account', id: seller.account.id } as const;
    const [sold, kept] = [await srv.issue({ variant: 'SIZE 54' }), await srv.issue({ variant: 'SIZE 50' })];
    const codes: string[] = [];
    for (const piece of [sold, kept]) {
      await srv.ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
      const scan = await srv.ctx.services.verification.verify({ code: piece.code.data }, {});
      await srv.ctx.services.ownership.registerFirst(seller.account.id, { registrationToken: scan.registration!.token }, sellerActor);
      codes.push((await srv.ctx.services.ownership.initiateTransfer(seller.account.id, piece.product.id, sellerActor)).transferCode);
    }
    const [soldCode, keptCode] = codes;

    // The buyer scans the piece signed out: a registered piece, its transfer in progress; the result opens on PRODUCT.
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'receive.png', sold));
    expect(await resultTitle(page)).toBe('AUTHENTIC REGISTERED');
    await attrOf(page.getByRole('tab', { name: 'PRODUCT' }), 'aria-selected', 'true');
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    const panel = page.locator('.n-own');
    await textOf(panel.locator('.n-own__status'), 'REGISTERED TO ITS OWNER');
    await textOf(panel.locator('.n-own__heading'), 'RECEIVING THIS PIECE');
    await textOf(panel.locator('.n-own__text').first(), 'This piece is registered to an ORBES account. A transfer of its ownership is in progress.');
    await countOf(page.getByLabel('TRANSFER CODE'), 0);

    // Signed in after the scan: this scan carries no transfer window, so the panel asks to verify the piece again.
    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await panel.getByLabel('EMAIL').fill('buyer.f03@example.com');
    await panel.getByLabel('PASSWORD').fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'CREATE ACCOUNT' }).click();
    await textOf(panel.locator('.n-own__email'), 'buyer.f03@example.com');
    await textOf(panel.locator('.n-own__text').last(), 'To receive this piece, verify it again now that you are signed in.');
    await countOf(page.getByLabel('TRANSFER CODE'), 0);
    await keepsFloors(page, ['VERIFY AGAIN', 'MY PIECES', 'SIGN OUT']);
    await page.getByRole('button', { name: 'VERIFY AGAIN' }).click();

    // The scan of a signed-in reader who is not the owner: the result opens straight on OWNERSHIP, with this scan's window.
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC REGISTERED');
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await textOf(panel.locator('.n-own__until'), /^RECEIVING OPEN UNTIL \d\d:\d\d$/);
    expect(await panel.locator('.n-own__until').evaluate((el) => getComputedStyle(el).fontSize)).toBe('9.5px');
    await textOf(page.locator('#transfer-code-hint'), 'Created by its owner in their ORBES account.');
    await keepsFloors(page, ['RECEIVE THIS PIECE', 'MY PIECES', 'SIGN OUT']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['RECEIVE THIS PIECE', 'MY PIECES', 'SIGN OUT']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-receive.png'), fullPage: true });

    // The code of the other piece: refused, in the server's words, which name neither piece.
    await page.getByLabel('TRANSFER CODE').fill(keptCode);
    await page.getByRole('button', { name: 'RECEIVE THIS PIECE' }).click();
    await textOf(panel.getByRole('alert'), 'This transfer code is not for this piece. Check the code with the owner of this piece.');
    expect((await srv.ctx.services.ownership.currentOwner(kept.product.id))?.accountId).toBe(seller.account.id);

    // The piece's own code, typed loosely: the piece is the buyer's.
    await page.getByLabel('TRANSFER CODE').fill(soldCode.replace(/-/g, '').toLowerCase());
    await valueOf(page.getByLabel('TRANSFER CODE'), soldCode);
    await page.getByRole('button', { name: 'RECEIVE THIS PIECE' }).click();
    await textOf(panel.locator('.n-own__status'), 'REGISTERED TO YOU');
    await textOf(panel, new RegExp(`The ownership of ${sold.product.productId} has been transferred to your ORBES account\\.`));
    const buyer = (await srv.ctx.services.ownership.currentOwner(sold.product.id))!;
    expect(buyer.accountId).not.toBe(seller.account.id);
    expect(buyer.acquiredVia).toBe('TRANSFER');
    expect((await srv.ctx.services.ownership.currentOwner(kept.product.id))?.accountId).toBe(seller.account.id);

    // VIEW AS OWNER verifies again: the buyer's own piece. A piece received is no first registration: no ceremony (P-D01).
    await page.getByRole('button', { name: 'VIEW AS OWNER' }).click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    await countOf(page.locator('.n-ceremony'), 0);
    expect(await page.locator('.view--result').evaluate((el) => el.classList.contains('is-ceremony'))).toBe(false);

    // The new owner scans the piece signed out, then signs in on the result: no transfer is pending, and VERIFY AGAIN
    // shows the piece as theirs.
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await panel.getByRole('button', { name: 'SIGN OUT' }).click();
    await visible(panel.getByLabel('EMAIL', { exact: true }));
    await page.goto(`${srv.origin}/verify`);
    await uploadPhoto(page, writeCodePng(srv.workDir, 'receive-owner.png', sold));
    expect(await resultTitle(page)).toBe('AUTHENTIC REGISTERED');
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await textOf(panel.locator('.n-own__small--hint'), 'If this piece is already registered to you, sign in and scan it again to see it as its owner.');
    await panel.getByLabel('EMAIL', { exact: true }).fill('buyer.f03@example.com');
    await panel.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await textOf(panel.locator('.n-own__email'), 'buyer.f03@example.com');
    await textOf(panel.locator('.n-own__small--first'), 'No transfer of this piece is pending. Once its owner has created a transfer code, scan this piece again to receive it.');
    await textOf(panel.locator('.n-own__small').last(), 'If this piece is registered to you, verify it again to see it as its owner.');
    await keepsFloors(page, ['VERIFY AGAIN', 'MY PIECES', 'SIGN OUT']);
    await page.getByRole('button', { name: 'VERIFY AGAIN' }).click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    expect(problems).toEqual([]);
  }, 120_000);

  it('keeps the window to receive a piece to the account of the scan, and closes it 15 minutes after the scan (F-03): SCAN AGAIN, and nothing is sent', async () => {
    const seller = await srv.ctx.services.auth.registerAccount({ email: 'seller.late@example.com', password: PASSWORD }, {});
    const sellerActor = { type: 'account', id: seller.account.id } as const;
    const piece = await srv.issue();
    await srv.ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = await srv.ctx.services.verification.verify({ code: piece.code.data }, {});
    await srv.ctx.services.ownership.registerFirst(seller.account.id, { registrationToken: scan.registration!.token }, sellerActor);
    const { transferCode } = await srv.ctx.services.ownership.initiateTransfer(seller.account.id, piece.product.id, sellerActor);
    await srv.ctx.services.auth.registerAccount({ email: 'buyer.late@example.com', password: PASSWORD }, {});

    // Signed in before the scan: the result opens on OWNERSHIP with the form at once.
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await page.goto(`${srv.origin}/verify/pieces`);
    await page.getByLabel('EMAIL').fill('buyer.late@example.com');
    await page.getByLabel('PASSWORD').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await visible(page.getByRole('button', { name: 'CHANGE PASSWORD' }));
    await page.goto(`${srv.origin}/verify`);
    await uploadPhoto(page, writeCodePng(srv.workDir, 'receive-late.png', piece));
    expect(await resultTitle(page)).toBe('AUTHENTIC REGISTERED');
    await attrOf(page.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await visible(page.getByLabel('TRANSFER CODE'));

    // The window is the scan's account's: another account signed in on the same result is asked to verify the piece
    // again (the server would refuse the window to it), and the scan's account finds the form again.
    await srv.ctx.services.auth.registerAccount({ email: 'other.late@example.com', password: PASSWORD }, {});
    const panel = page.locator('.n-own');
    const signInAs = async (email: string) => {
      await panel.getByRole('button', { name: 'SIGN OUT' }).click();
      await panel.getByLabel('EMAIL', { exact: true }).fill(email);
      await panel.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
      await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
      await textOf(panel.locator('.n-own__email'), email);
    };
    await signInAs('other.late@example.com');
    await textOf(panel.locator('.n-own__text').last(), 'To receive this piece, verify it again now that you are signed in.');
    await countOf(page.getByLabel('TRANSFER CODE'), 0);
    await visible(page.getByRole('button', { name: 'VERIFY AGAIN' }));
    await signInAs('buyer.late@example.com');
    await visible(page.getByLabel('TRANSFER CODE'));

    // The buyer takes longer than the 15 minutes of the scan, then sends the code: the panel says to scan again.
    let sent = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/v1/ownership/transfers/accept')) sent++;
    });
    await page.clock.setFixedTime(Date.now() + 16 * 60_000);
    await page.getByLabel('TRANSFER CODE').fill(transferCode);
    await page.getByRole('button', { name: 'RECEIVE THIS PIECE' }).click();
    await textOf(page.locator('.n-own__text').last(), 'The window to receive this piece from this scan has closed. Scan the code again to receive it.');
    await countOf(page.getByLabel('TRANSFER CODE'), 0);
    await keepsFloors(page, ['SCAN AGAIN']);
    expect(sent).toBe(0);
    expect((await srv.ctx.services.ownership.currentOwner(piece.product.id))?.accountId).toBe(seller.account.id);
    expect(problems).toEqual([]);
  }, 120_000);

  it('tells a buyer of a registered piece to ask the seller for a transfer code (J-02); I HAVE A TRANSFER CODE opens OWNERSHIP on RECEIVING THIS PIECE', async () => {
    // A piece sold and registered by its owner; a buyer scans it, signed out.
    const email = 'antoine.seller@example.com';
    const owner = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    const issued = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = await srv.ctx.services.verification.verify({ code: issued.code.data }, {});
    await srv.ctx.services.ownership.registerFirst(owner.account.id, { registrationToken: scan.registration!.token, claimCode: issued.claimCode! }, { type: 'account', id: owner.account.id });
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'resale.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC REGISTERED');

    // Under the server's message, between the notice's hairlines, the sentence of the packaging kit, read in Helvetica Neue.
    const notice = page.locator('.n-result__notice-block .n-result__notice');
    await textOf(notice, RESALE_GUIDANCE);
    await attrOf(notice, 'role', 'note');
    expect(await notice.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    // Then its link, a text link: the page keeps one hairline button, SCAN ANOTHER. The tabs open on PRODUCT.
    const link = page.getByRole('button', { name: RESALE_ACTION });
    await visible(link);
    await attrOf(link, 'class', /\bn-tl\b/);
    await countOf(page.locator('.n-btn'), 1);
    await attrOf(page.getByRole('tab', { name: 'PRODUCT' }), 'aria-selected', 'true');
    const controls = [RESALE_ACTION, 'PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER'];
    await keepsFloors(page, controls);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, controls);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-resale-guidance.png'), fullPage: true });

    // The link selects OWNERSHIP and brings RECEIVING THIS PIECE into view, the selected tab still in sight above it,
    // keyboard focus on that heading, without a ring.
    const heading = page.locator('#receiving-title');
    const ownershipTab = page.getByRole('tab', { name: 'OWNERSHIP' });
    const inView = async () => {
      const boxes = await Promise.all([heading.boundingBox(), ownershipTab.boundingBox()]);
      return boxes.every((b) => b !== null && b.y >= 0 && b.y + b.height <= MOBILE_VIEWPORT.height);
    };
    // Before: the panel is not built yet, and the tabs are below the fold.
    await countOf(heading, 0);
    expect((await ownershipTab.boundingBox())!.y).toBeGreaterThan(MOBILE_VIEWPORT.height);
    await link.click();
    await attrOf(ownershipTab, 'aria-selected', 'true');
    await textOf(heading, 'RECEIVING THIS PIECE');
    await expect.poll(inView, POLL).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('receiving-title');
    expect(await heading.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    await textOf(page.locator('.n-own__status'), 'REGISTERED TO ITS OWNER');
    await textOf(page.locator('.n-own__text').first(), 'This piece is registered to an ORBES account.');
    // Below it, sign-in to receive the piece; the focus stays on the heading while the panel learns the session.
    const panel = page.locator('.n-own');
    await visible(panel.getByLabel('PASSWORD', { exact: true }));
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('receiving-title');
    await page.screenshot({ path: join(OUT_DIR, 'verify-resale-receiving.png') });

    // From the keyboard, once the panel is built: back to PRODUCT, then Enter on the link.
    await page.getByRole('tab', { name: 'PRODUCT' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await link.focus();
    await page.keyboard.press('Enter');
    await attrOf(ownershipTab, 'aria-selected', 'true');
    await expect.poll(inView, POLL).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('receiving-title');

    // The owner, signed in and scanning again, reads OWNERSHIP VERIFIED: the guidance is for others, never for them.
    await panel.getByLabel('EMAIL', { exact: true }).fill(email);
    await panel.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await textOf(page.locator('.n-own__email'), email);
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'resale-owner.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    await countOf(page.locator('.n-result__notice'), 0);
    await countOf(page.getByRole('button', { name: RESALE_ACTION }), 0);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('recovers a forgotten password with the code of ORBES Client Services, then changes it in MY PIECES', async () => {
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
    const panel = page.locator('.n-own');

    // Under SIGN IN: FORGOTTEN PASSWORD?, a text link, which leads to ORBES Client Services.
    await visible(panel.getByLabel('PASSWORD', { exact: true }));
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT', 'FORGOTTEN PASSWORD?']);
    // From the keyboard (Enter), where a focus ring would show if the heading had one.
    await page.getByRole('button', { name: 'FORGOTTEN PASSWORD?' }).focus();
    await page.keyboard.press('Enter');
    await textOf(panel.locator('#recover-title'), 'FORGOTTEN PASSWORD');
    // A section under the status of the piece, where the sign-in form was; keyboard focus moves to it, without a
    // ring: a heading focused on a screen change shows none (BRAND §3.8).
    await textOf(panel.locator('.n-own__status'), 'REGISTERED TO ITS OWNER');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('recover-title');
    expect(await panel.locator('#recover-title').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    await textOf(panel, /After checking your identity, they give you a one-time recovery code, valid for 30 minutes\./);
    const contact = panel.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    await visible(contact);
    const ref = (await page.locator('.n-result__meta').innerText()).match(/REF ([0-9A-F]{8})/)![1];
    const href = new URL((await contact.getAttribute('href'))!);
    expect(href.pathname).toBe(CLIENT_SERVICES.email);
    expect(href.searchParams.get('subject')).toBe('ORBES — FORGOTTEN PASSWORD');
    expect(href.searchParams.get('body')).toBe(`\r\n\r\nREFERENCE: ${ref}`);
    await attrOf(panel.locator('.n-contact'), 'data-placement', 'recovery');
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
    await textOf(page.locator('.n-own__notice'), /^Your password has been changed: sign in with it\. For your security, every session of your account has ended, its pending transfers were cancelled, its certificate links were withdrawn and new transfers are paused until \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d\.$/);
    await valueOf(panel.getByLabel('EMAIL', { exact: true }), email);
    await panel.getByLabel('PASSWORD', { exact: true }).fill('a brand new passphrase');
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await textOf(page.locator('.n-own__email'), email);

    // Signed in: MY PIECES beside SIGN OUT (F-01: CHANGE PASSWORD has moved there), both on one line at every phone width.
    await countOf(panel.getByRole('button', { name: 'CHANGE PASSWORD' }), 0);
    await keepsFloors(page, ['MY PIECES', 'SIGN OUT']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['MY PIECES', 'SIGN OUT']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await attrOf(panel.getByRole('link', { name: 'MY PIECES' }), 'href', '/verify/pieces');
    await panel.getByRole('link', { name: 'MY PIECES' }).click();
    await textOf(page.locator('h1'), 'MY PIECES');
    expect(new URL(page.url()).pathname).toBe('/verify/pieces');
    // The account line at the foot of MY PIECES: CHANGE PASSWORD beside SIGN OUT, both on one line at every phone width.
    const account = page.locator('.pieces__account');
    await textOf(account.locator('.ownership__email'), email);
    await keepsFloors(page, ['CHANGE PASSWORD', 'SIGN OUT', 'SCAN ORBES CODE']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['CHANGE PASSWORD', 'SIGN OUT', 'SCAN ORBES CODE']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await account.getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    await textOf(account.locator('.ownership__status'), 'CHANGE PASSWORD');
    // Keyboard focus moves into the form, on the current password.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('current-password');
    await keepsFloors(page, ['CHANGE PASSWORD', 'CANCEL', 'SIGN OUT']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-change-password.png'), fullPage: true });
    // CANCEL closes it, focus back on CHANGE PASSWORD; then open it again.
    await account.getByRole('button', { name: 'CANCEL' }).click();
    await countOf(account.locator('form'), 0);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('CHANGE PASSWORD');
    await account.getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    // A wrong current password is said on its field; the page stays signed in (a 400, never a 401).
    await account.getByLabel('CURRENT PASSWORD', { exact: true }).fill('not my password at all');
    await account.getByLabel('NEW PASSWORD', { exact: true }).fill('another new passphrase');
    await account.locator('form').getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    await textOf(account.getByRole('alert'), 'The current password is not correct.');
    await attrOf(account.getByLabel('CURRENT PASSWORD', { exact: true }), 'aria-invalid', 'true');
    await textOf(account.locator('.ownership__email'), email);
    await account.getByLabel('CURRENT PASSWORD', { exact: true }).fill('a brand new passphrase');
    await account.locator('form').getByRole('button', { name: 'CHANGE PASSWORD' }).click();
    await textOf(account.locator('.form__notice'), 'Your password has been changed. Your other sessions have ended.');
    await textOf(account.locator('.ownership__email'), email);
    // Still the owner's page: the piece is listed.
    await textOf(page.locator('.piece .genome__id'), issued.product.productId);
    expect((await srv.ctx.services.auth.login({ email, password: 'another new passphrase' }, {})).account.email).toBe(email);
    // Back leaves MY PIECES (it took the result's place in the history) for the landing.
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).first().waitFor();
    // NOW (N3), in place of the landing.
    await page.locator('.view--now[data-ready]').waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  /** A piece sold (warranty started) and registered to `accountId` with its claim code, as the owner's scan would. */
  async function ownedPiece(accountId: string, modelId?: string): Promise<IssueResult> {
    const issued = await srv.issue({ withClaimSecret: true, ...(modelId ? { modelId } : {}) });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = await srv.ctx.services.verification.verify({ code: issued.code.data }, {});
    await srv.ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode: issued.claimCode! }, { type: 'account', id: accountId });
    return issued;
  }

  it('MY PIECES: signs in without a scan, lists the pieces, reports one stolen, which a stranger then scans as UNUSUAL ACTIVITY', async () => {
    const email = 'claire.bernard@example.com';
    const owner = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    // The older piece on a MONOLITHE RING of its own (a copy of the suite's, under another SKU prefix), so that its
    // model's photograph shows on no other piece of this suite; the newer piece keeps the suite's model, without one.
    const shared = await srv.ctx.db
      .selectFrom('models')
      .select(['category_id', 'collection_id', 'name', 'type', 'default_material', 'care_instructions'])
      .where('id', '=', srv.modelId)
      .executeTakeFirstOrThrow();
    const photographed = await srv.ctx.db.insertInto('models').values({ ...shared, sku_prefix: 'MNL-PH' }).returning('id').executeTakeFirstOrThrow();
    const older = await ownedPiece(owner.account.id, photographed.id);
    const polish = await srv.ctx.services.warranty.openService(older.product.id, { type: 'POLISH', location: 'Paris atelier', notes: 'staff note' }, SYSTEM_ACTOR);
    await srv.ctx.services.warranty.completeService(polish.id, {}, SYSTEM_ACTOR);
    const newer = await ownedPiece(owner.account.id);
    // ORBES photographed the older piece at issuance (F-04), before NOCTURNE, and its model: decision 9 shows the
    // model's photograph alone, never the piece's own.
    const ownPhoto = await srv.ctx.services.media.setProductPhoto(older.product.productId, { mime: 'image/jpeg', bytes: jpegPhoto(480, 480) }, SYSTEM_ACTOR);
    const modelPhoto = await srv.ctx.services.media.setModelImage(photographed.id, { mime: 'image/jpeg', bytes: jpegPhoto(640, 480) }, SYSTEM_ACTOR);
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });

    // The landing offers MY PIECES once the session is known, signed out too: the owner of a piece that is gone cannot scan it.
    const link = page.getByRole('link', { name: 'MY PIECES' });
    await visible(link);
    await attrOf(link, 'href', '/verify/pieces');
    await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO', 'MY PIECES']);
    await link.click();
    await textOf(page.locator('h1'), 'MY PIECES');
    expect(new URL(page.url()).pathname).toBe('/verify/pieces');

    // Signed out: the OWNERSHIP panel's sign-in alone, FORGOTTEN PASSWORD? under it.
    const signIn = page.locator('.pieces__signin');
    await textOf(signIn.locator('.n-own__lead'), /^Sign in to see the pieces registered to your ORBES account\. A piece lost or stolen can be reported here, without scanning it\.$/);
    await visible(signIn.getByRole('button', { name: 'FORGOTTEN PASSWORD?' }));
    await countOf(page.locator('article.piece'), 0);
    await keepsFloors(page, ['SIGN IN', 'CREATE ACCOUNT', 'FORGOTTEN PASSWORD?', 'SCAN ORBES CODE', ...LEGAL_LINKS]);
    // Where the account's data is collected, the legal pages (J-06), in a new tab, under SCAN ORBES CODE: NOCTURNE's
    // footer, under the page.
    const footer = page.locator('footer.n-foot');
    expect(await legalLinksOf(footer)).toEqual([
      { name: 'PRIVACY', href: '/legal/privacy', target: '_blank' },
      { name: 'TERMS', href: '/legal/terms', target: '_blank' },
      { name: 'LEGAL', href: '/legal/notice', target: '_blank' },
      { name: 'HELP', href: '/legal/faq', target: '_blank' },
    ]);
    await attrOf(footer.getByRole('link', { name: 'IP Geolocation by DB-IP' }), 'target', '_blank');
    const scanButton = (await page.locator('.pieces__foot').getByRole('button', { name: 'SCAN ORBES CODE' }).boundingBox())!;
    expect((await footer.locator('.n-fl').boundingBox())!.y).toBeGreaterThan(scanButton.y + scanButton.height);
    // CREATE ACCOUNT, signed out in MY PIECES: the same note, both links.
    await signIn.getByRole('button', { name: 'CREATE ACCOUNT' }).first().click();
    await attrOf(signIn.locator('.n-own__terms').getByRole('link', { name: 'PRIVACY POLICY' }), 'href', '/legal/privacy');
    await attrOf(signIn.locator('.n-own__terms').getByRole('link', { name: 'TERMS OF USE' }), 'href', '/legal/terms');
    await keepsFloors(page, ['TERMS OF USE', 'PRIVACY POLICY', ...LEGAL_LINKS]);
    await signIn.getByRole('button', { name: 'SIGN IN' }).first().click();
    await signIn.getByLabel('EMAIL').fill(email);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();

    // The pieces, newest acquisition first, each on its ivory plate; keyboard focus on the page's title above them.
    const pieces = page.locator('article.piece');
    await countOf(pieces, 2);
    await textsOf(page.locator('.piece .genome__id'), [newer.product.productId, older.product.productId]);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id), POLL).toBe('pieces-title');
    await textOf(page.locator('.pieces__lead'), 'The pieces registered to your ORBES account.');
    const card = page.getByRole('article', { name: older.product.productId });
    const other = page.getByRole('article', { name: newer.product.productId });
    expect(await card.locator('.piece__plate').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PLATE);
    // Under the écrin that carries its heading, the photograph ORBES took of the piece's model (F-04), never the one of
    // the piece itself (NOCTURNE, decision 9), on the ivory plate of an authentic result, with its alternative text, the
    // plate named after the piece; the other piece, whose model has none, shows none.
    const photos = card.getByRole('region', { name: `Photographs of ${older.product.productId}` });
    await visible(photos);
    const photo = photos.locator('img.photo__img');
    await countOf(photo, 1);
    await countOf(card.locator('img'), 1);
    await attrOf(photo, 'alt', 'The MONOLITHE RING model, photographed by ORBES');
    // The model's file, never the piece's (`/api/v1/media/<the piece photo's sha256>`).
    const src = new URL((await photo.getAttribute('src'))!, srv.origin).pathname;
    expect(src).toBe(new URL(modelPhoto.url, srv.origin).pathname);
    expect(ownPhoto.photoUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
    expect(src).not.toBe(ownPhoto.photoUrl);
    await textsOf(photos.locator('.photo__caption'), ['THE MODEL']);
    await textOf(photos.locator('.photos__note'), 'Photographed by ORBES. Compare it with the piece in your hands.');
    await expect.poll(() => photo.evaluate((el) => [(el as HTMLImageElement).complete, (el as HTMLImageElement).naturalWidth]), POLL).toEqual([true, 640]);
    expect(await photos.locator('.photos__plate').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PLATE);
    const [ecrin, photosBox, linesBox] = [(await card.locator('.piece__plate').boundingBox())!, (await photos.boundingBox())!, (await card.locator('.piece__lines').boundingBox())!];
    expect(photosBox.y).toBeGreaterThan(ecrin.y + ecrin.height);
    expect(photosBox.y + photosBox.height).toBeLessThan(linesBox.y);
    await countOf(other.locator('.result__photos, img'), 0);
    await countOf(card.locator('.genome__glyphs .genome-svg--orbit g[data-layer="genome"]'), 8);
    await attrOf(card.locator('.genome-svg'), 'aria-label', new RegExp(older.genome.fingerprint));
    await textOf(card.locator('.genome__meta'), `${older.genome.fingerprint} · GENOME-01`);
    await textsOf(card.locator('.lines__line'), ['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    await textsOf(card.getByRole('tab'), ['OWNERSHIP', 'WARRANTY', 'SERVICE', 'CARE']);
    await attrOf(card.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await textOf(card.locator('.ownership__status'), 'REGISTERED TO YOU');
    await textOf(card.locator('.piece__ownership .rows'), /^SINCE \d{1,2} [A-Z]{3} \d{4} ACQUIRED FIRST REGISTRATION OWNERSHIP VERIFIED$/);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    const listControls = ['OWNERSHIP', 'WARRANTY', 'SERVICE', 'CARE', 'REPORT LOST / STOLEN', 'CHANGE PASSWORD', 'SIGN OUT', 'SCAN ORBES CODE'];
    await keepsFloors(page, listControls);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces.png'), fullPage: true });
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, listControls);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);

    // The tabs of a piece from the keyboard (the result's tablist): arrows, Home and End, one tab in the tab order.
    const tab = (name: string) => card.getByRole('tab', { name });
    await tab('OWNERSHIP').focus();
    await page.keyboard.press('ArrowRight');
    await attrOf(tab('WARRANTY'), 'aria-selected', 'true');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('WARRANTY');
    expect(await card.getByRole('tab').evaluateAll((els) => els.map((el) => (el as HTMLElement).tabIndex))).toEqual([-1, 0, -1, -1]);
    await textOf(card.getByRole('tabpanel'), /STATUS ACTIVE FROM 20 SEP 2026 UNTIL 20 SEP 2028 This piece is covered by the ORBES warranty until 20 September 2028\./);
    await page.keyboard.press('ArrowRight');
    await attrOf(tab('SERVICE'), 'aria-selected', 'true');
    // The service history, without staff notes.
    await textOf(card.getByRole('tabpanel').locator('.rows'), /^POLISH \d{1,2} [A-Z]{3} \d{4} · PARIS ATELIER$/);
    await countOf(card.getByText('staff note'), 0);
    // CARE (P-M02): the care of the piece's model, then ORBES Care; no subscription page is published on this server,
    // so a plain sentence says subscriptions open soon, with nothing to press.
    await page.keyboard.press('ArrowRight');
    await attrOf(tab('CARE'), 'aria-selected', 'true');
    const carePanel = card.getByRole('tabpanel');
    await textsOf(carePanel.locator('.section-label'), ['CARING FOR THIS PIECE', 'ORBES CARE']);
    await textOf(carePanel.locator('.piece__care-text'), 'Store on its own in the ORBES pouch. Wipe with a soft, dry cloth after wearing; avoid perfume, chlorine and abrasive cleaners.');
    await visible(carePanel.getByRole('region', { name: 'ORBES CARE' }));
    await textsOf(carePanel.locator('.pieces__benefit'), [...ORBES_CARE.benefits]);
    await textOf(carePanel.locator('.piece__care-soon'), 'Subscriptions open soon.');
    await countOf(carePanel.getByRole('link'), 0);
    await countOf(carePanel.getByRole('button'), 0);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['OWNERSHIP', 'WARRANTY', 'SERVICE', 'CARE']);
    await page.keyboard.press('ArrowRight');
    await attrOf(tab('OWNERSHIP'), 'aria-selected', 'true');
    await page.keyboard.press('End');
    await attrOf(tab('CARE'), 'aria-selected', 'true');
    await page.keyboard.press('Home');
    await attrOf(tab('OWNERSHIP'), 'aria-selected', 'true');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('OWNERSHIP');
    // Each piece has its own tablist: the other one did not move.
    await attrOf(other.getByRole('tab', { name: 'OWNERSHIP' }), 'aria-selected', 'true');
    await countOf(other.getByRole('tabpanel'), 1);

    // A reload stays on MY PIECES, signed in. This time the server publishes the subscription page of ORBES Care
    // (CARE_SUBSCRIBE_URL, served by GET /api/v1/client-services): CARE offers SUBSCRIBE, a text link in a new tab.
    const careUrl = 'https://whop.com/orbes/care';
    await page.route('**/api/v1/client-services', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...((await response.json()) as object), careSubscribeUrl: careUrl } });
    });
    await page.reload();
    await textOf(page.locator('h1'), 'MY PIECES');
    await countOf(pieces, 2);
    expect(new URL(page.url()).pathname).toBe('/verify/pieces');
    await tab('CARE').click();
    const subscribe = card.getByRole('tabpanel').getByRole('link', { name: 'Subscribe to ORBES Care, in a new tab' });
    await textOf(subscribe, 'SUBSCRIBE');
    await attrOf(subscribe, 'href', careUrl);
    await attrOf(subscribe, 'target', '_blank');
    await attrOf(subscribe, 'rel', 'noopener noreferrer');
    expect(await subscribe.getAttribute('class')).toMatch(/\btextlink\b/);
    await countOf(card.locator('.piece__care-soon'), 0);
    // The page keeps its one hairline button, SCAN ORBES CODE.
    await countOf(page.locator('.view--pieces .btn'), 1);
    await keepsFloors(page, ['SUBSCRIBE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-care.png'), fullPage: true });
    await page.unroute('**/api/v1/client-services');
    await tab('OWNERSHIP').click();

    // REPORT LOST / STOLEN, confirmed: LOST or STOLEN first, then CONFIRM REPORT.
    await card.getByRole('button', { name: 'REPORT LOST / STOLEN' }).click();
    await textOf(card.locator('.piece__ownership .section-label'), 'REPORT LOST / STOLEN');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('REPORT LOST / STOLEN');
    await card.getByRole('button', { name: 'CONFIRM REPORT' }).click();
    await textOf(card.getByRole('alert'), 'Choose LOST or STOLEN.');
    expect(await srv.ctx.db.selectFrom('products').select('status').where('id', '=', older.product.id).executeTakeFirstOrThrow()).toEqual({ status: 'OWNED' });
    const choice = card.getByRole('group', { name: 'What happened to this piece' });
    await choice.getByRole('button', { name: 'STOLEN' }).click();
    await attrOf(choice.getByRole('button', { name: 'STOLEN' }), 'aria-pressed', 'true');
    await attrOf(choice.getByRole('button', { name: 'LOST' }), 'aria-pressed', 'false');
    await textOf(card.locator('.piece__ownership'), /Once it is recovered, ORBES Client Services check the piece and withdraw the report\./);
    await keepsFloors(page, ['LOST', 'STOLEN', 'CONFIRM REPORT', 'CANCEL']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-report.png'), fullPage: true });
    await card.getByRole('button', { name: 'CONFIRM REPORT' }).click();
    await textOf(card.locator('.ownership__status'), 'REPORTED STOLEN');
    await textOf(card.getByRole('status'), 'This piece is now reported stolen. Every scan of its code shows UNUSUAL ACTIVITY.');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('REPORTED STOLEN');
    // A theft is ORBES Client Services' to withdraw: nothing to press, their contact instead.
    await countOf(card.getByRole('button', { name: 'PIECE FOUND' }), 0);
    await countOf(card.getByRole('button', { name: 'REPORT LOST / STOLEN' }), 0);
    const contact = card.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    const href = new URL((await contact.getAttribute('href'))!);
    expect(href.searchParams.get('subject')).toBe(`ORBES — ${older.product.productId} — REPORTED STOLEN`);
    expect(href.searchParams.get('body')).toBe(`\r\n\r\nPIECE: ${older.product.productId}`);
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'SIGN OUT']);
    expect(await srv.ctx.db.selectFrom('products').select('status').where('id', '=', older.product.id).executeTakeFirstOrThrow()).toEqual({ status: 'STOLEN' });

    // The other piece: reported LOST, then found again by its owner (PIECE FOUND, confirmed).
    await other.getByRole('button', { name: 'REPORT LOST / STOLEN' }).click();
    await other.getByRole('button', { name: 'LOST', exact: true }).click();
    await textOf(other.locator('.piece__ownership'), /Once you find it, you withdraw the report yourself, here: PIECE FOUND\./);
    await other.getByRole('button', { name: 'CONFIRM REPORT' }).click();
    await textOf(other.locator('.ownership__status'), 'REPORTED LOST');
    await textOf(other.locator('.piece__ownership'), /Every scan of its code shows UNUSUAL ACTIVITY until you tell ORBES that it has been found\./);
    expect(await srv.ctx.db.selectFrom('products').select('status').where('id', '=', newer.product.id).executeTakeFirstOrThrow()).toEqual({ status: 'LOST' });
    await other.getByRole('button', { name: 'PIECE FOUND' }).click();
    await textOf(other.locator('.section-label'), 'PIECE FOUND');
    await textOf(other.locator('.piece__ownership'), /Confirm with the password of your ORBES account that this piece is back with you\./);
    await keepsFloors(page, ['CONFIRM', 'CANCEL']);
    // The account's password, typed again: a session alone does not withdraw the report. Missing, then wrong (a 400:
    // the session stays, the field is cleared and takes the focus), the piece stays reported.
    const foundPassword = other.getByLabel('PASSWORD', { exact: true });
    await other.getByRole('button', { name: 'CONFIRM', exact: true }).click();
    await textOf(other.getByRole('alert'), 'Enter the password of your ORBES account.');
    await foundPassword.fill('not the password of this account');
    await other.getByRole('button', { name: 'CONFIRM', exact: true }).click();
    await textOf(other.getByRole('alert'), 'The current password is not correct.');
    await valueOf(foundPassword, '');
    await attrOf(foundPassword, 'aria-invalid', 'true');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).toBe('password');
    expect(await srv.ctx.db.selectFrom('products').select('status').where('id', '=', newer.product.id).executeTakeFirstOrThrow()).toEqual({ status: 'LOST' });
    await foundPassword.fill(PASSWORD);
    await other.getByRole('button', { name: 'CONFIRM', exact: true }).click();
    await textOf(other.locator('.ownership__status'), 'REGISTERED TO YOU');
    await textOf(other.getByRole('status'), 'This piece is no longer reported lost.');
    await visible(other.getByRole('button', { name: 'REPORT LOST / STOLEN' }));
    expect(await srv.ctx.db.selectFrom('products').select('status').where('id', '=', newer.product.id).executeTakeFirstOrThrow()).toEqual({ status: 'OWNED' });
    const audit = await srv.ctx.audit.list({ action: 'ownership.incident.resolve', targetId: newer.product.productId });
    expect(audit.items.map((e) => [e.actorType, e.actorId, e.details])).toEqual([['account', owner.account.id, { type: 'LOST', to: 'OWNED' }]]);

    // Back returns to the landing (MY PIECES sat in one entry above it).
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).first().waitFor();
    // NOW (N3), in place of the landing.
    await page.locator('.view--now[data-ready]').waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');
    expect(problems).toEqual([]);
    await page.context().close();

    // A stranger scans the stolen piece: UNUSUAL ACTIVITY. The piece found again reads as it did before its loss.
    const stranger = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(stranger.page, writeCodePng(srv.workDir, 'reported-stolen.png', older));
    expect(await resultTitle(stranger.page)).toBe('UNUSUAL ACTIVITY DETECTED');
    await attrOf(stranger.page.locator('.view--result'), 'data-tone', 'caution');
    await countOf(stranger.page.getByRole('tab'), 0);
    await stranger.page.goBack();
    await stranger.page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(stranger.page, writeCodePng(srv.workDir, 'found-again.png', newer));
    expect(await resultTitle(stranger.page)).toBe('AUTHENTIC REGISTERED');
    expect(stranger.problems).toEqual([]);
    await stranger.page.context().close();
  }, 180_000);

  it('MY PIECES reads a piece again after a change: a loss declared during a service returns to IN SERVICE; a piece the server would refuse to report points to Client Services; links it cannot list stay said', async () => {
    const email = 'paul.durand@example.com';
    const owner = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    // In service when its owner loses it (SERVICED → LOST), revoked by ORBES (the report would be refused), and an
    // ordinary piece whose certificate links cannot be read just now.
    const serviced = await ownedPiece(owner.account.id);
    await srv.ctx.services.warranty.openService(serviced.product.id, { type: 'POLISH', location: 'Paris atelier' }, SYSTEM_ACTOR);
    const revoked = await ownedPiece(owner.account.id);
    await srv.ctx.services.lifecycle.transition(revoked.product.id, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    const shared = await ownedPiece(owner.account.id);
    const ctx = await mobileContext(browser, { reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (!isExpectedConsole(m) || /Content Security Policy/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // The list of open links answers what the app cannot read (as a server mid-deploy might), until told otherwise.
    let listUnreadable = true;
    await page.route('**/api/v1/ownership/certificates', (route) =>
      route.request().method() === 'GET' && listUnreadable ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"unexpected":true}' }) : route.fallback(),
    );
    await page.goto(`${srv.origin}/verify/pieces`);
    const signIn = page.locator('.pieces__signin');
    await signIn.getByLabel('EMAIL').fill(email);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await countOf(page.locator('article.piece'), 3);

    // The piece in service: reported lost, then found with the password; it reads IN SERVICE again, as the server holds it.
    const inService = page.getByRole('article', { name: serviced.product.productId });
    await textOf(inService.locator('.ownership__status'), 'IN SERVICE');
    await inService.getByRole('button', { name: 'REPORT LOST / STOLEN' }).click();
    await inService.getByRole('button', { name: 'LOST', exact: true }).click();
    await inService.getByRole('button', { name: 'CONFIRM REPORT' }).click();
    await textOf(inService.locator('.ownership__status'), 'REPORTED LOST');
    await inService.getByRole('button', { name: 'PIECE FOUND' }).click();
    await inService.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await inService.getByRole('button', { name: 'CONFIRM', exact: true }).click();
    await textOf(inService.locator('.ownership__status'), 'IN SERVICE');
    await textOf(inService.locator('.piece__ownership'), /This piece is with ORBES for a service\. Its history is under SERVICE\./);
    await textOf(inService.getByRole('status'), 'This piece is no longer reported lost.');
    expect(await srv.ctx.db.selectFrom('products').select('status').where('id', '=', serviced.product.id).executeTakeFirstOrThrow()).toEqual({ status: 'SERVICED' });

    // The revoked piece: still the owner's, but no REPORT LOST / STOLEN (the server would refuse it) and no certificate:
    // ORBES Client Services, with their contact.
    const refused = page.getByRole('article', { name: revoked.product.productId });
    await textOf(refused.locator('.ownership__status'), 'REGISTERED TO YOU');
    await countOf(refused.getByRole('button', { name: 'REPORT LOST / STOLEN' }), 0);
    await countOf(refused.locator('.piece__certificate-title'), 0);
    await textOf(refused.locator('.piece__ownership'), /A loss or a theft of this piece cannot be reported here: tell ORBES Client Services\./);
    await visible(refused.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES']);

    // The links of the last piece cannot be read: said, with TRY AGAIN. A link created meanwhile does not stand for
    // the list (the others would be hidden, and could not be withdrawn): the alert stays.
    const sharing = page.getByRole('article', { name: shared.product.productId });
    await textOf(sharing.getByRole('alert'), 'Your certificate links could not be shown just now.');
    await visible(sharing.getByRole('button', { name: 'TRY AGAIN' }));
    const earlier = await srv.ctx.services.ownershipCertificates.create(owner.account.id, shared.product.productId, {}, { type: 'account', id: owner.account.id });
    await sharing.getByRole('button', { name: 'CREATE CERTIFICATE' }).click();
    await sharing.getByRole('button', { name: 'CREATE LINK' }).click();
    await visible(sharing.locator('.certificate-link__value'));
    await textOf(sharing.getByRole('alert'), 'Your certificate links could not be shown just now.');
    await countOf(sharing.locator('.piece__certificate'), 0);
    await keepsFloors(page, ['COPY LINK', 'OPEN LINK', 'TRY AGAIN', 'CREATE CERTIFICATE']);
    // Readable again: TRY AGAIN lists both links, each with WITHDRAW.
    listUnreadable = false;
    await sharing.getByRole('button', { name: 'TRY AGAIN' }).click();
    await countOf(sharing.getByRole('alert'), 0);
    await countOf(sharing.locator('.piece__certificate'), 2);
    await expect.poll(async () => sharing.locator('.piece__certificate-withdraw').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.certificate)), POLL).toContain(earlier.id);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 180_000);

  it('MY PIECES from a direct link: the sign-in, then back to the landing rather than out of the app', async () => {
    const ctx = await mobileContext(browser, { reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (!isExpectedConsole(m) || /Content Security Policy/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const res = await page.goto(`${srv.origin}/verify/pieces`);
    expect(res?.status()).toBe(200);
    await textOf(page.locator('h1'), 'MY PIECES');
    await visible(page.locator('.pieces__signin').getByRole('button', { name: 'SIGN IN' }).first());
    // The app put its landing under MY PIECES (after the new tab's blank page): back stays in the app.
    expect(await page.evaluate(() => history.length)).toBe(3);
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');
    await page.goForward();
    await textOf(page.locator('h1'), 'MY PIECES');
    expect(new URL(page.url()).pathname).toBe('/verify/pieces');
    // An address the app does not know opens the landing, at /verify.
    await page.goto(`${srv.origin}/verify/somewhere/else`);
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');
    expect(problems).toEqual([]);
    await ctx.close();
  }, 120_000);

  it('OWNERSHIP CERTIFICATE (F-06): created in MY PIECES, read by anyone from its link (the token never in a URL the server sees), its PDF; ended by a declaration, then withdrawn', async () => {
    const email = 'louise.martin@example.com';
    const owner = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD, displayName: 'Louise Martin' }, {});
    const piece = await ownedPiece(owner.account.id);
    const productId = piece.product.productId;

    // The owner, in MY PIECES.
    const ownerCtx = await mobileContext(browser, { reducedMotion: 'reduce' });
    await ownerCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.origin });
    const page = await ownerCtx.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (!isExpectedConsole(m) || /Content Security Policy/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${srv.origin}/verify/pieces`);
    const signIn = page.locator('.pieces__signin');
    await signIn.getByLabel('EMAIL').fill(email);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    const card = page.getByRole('article', { name: productId });
    await visible(card);
    await textOf(card.locator('.piece__certificate-title'), 'OWNERSHIP CERTIFICATE');
    await textOf(card.locator('.piece__ownership'), /Share a link to a certificate of this piece with a buyer or an insurer/);

    // CREATE CERTIFICATE: how long it stays valid (30 DAYS chosen), then CREATE LINK.
    await card.getByRole('button', { name: 'CREATE CERTIFICATE' }).click();
    const validity = card.getByRole('group', { name: 'How long the link stays valid' });
    await textsOf(validity.getByRole('button'), ['7 DAYS', '30 DAYS', '90 DAYS']);
    await attrOf(validity.getByRole('button', { name: '30 DAYS' }), 'aria-pressed', 'true');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('30 DAYS');
    await validity.getByRole('button', { name: '90 DAYS' }).click();
    await attrOf(validity.getByRole('button', { name: '90 DAYS' }), 'aria-pressed', 'true');
    await attrOf(validity.getByRole('button', { name: '30 DAYS' }), 'aria-pressed', 'false');
    await keepsFloors(page, ['7 DAYS', '30 DAYS', '90 DAYS', 'CREATE LINK', 'CANCEL']);
    await card.getByRole('button', { name: 'CREATE LINK' }).click();

    // The link, shown once, on ivory; COPY LINK takes the focus and copies it.
    const value = card.locator('.certificate-link__value');
    await visible(value);
    const url = norm(await value.innerText());
    expect(url).toMatch(new RegExp(`^${srv.origin.replace(/\./g, '\\.')}/verify/c#[0-9A-HJKMNP-TV-Z]{52}$`));
    const token = url.split('#')[1];
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('COPY LINK');
    await textOf(card.locator('.certificate-link .certificate-link__label').last(), /^VALID UNTIL \d{1,2} [A-Z]{3} \d{4}$/);
    await card.getByRole('button', { name: 'COPY LINK' }).click();
    await textOf(card.getByRole('status'), 'The link has been copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await attrOf(card.getByRole('link', { name: 'OPEN LINK' }), 'href', url);
    await textsOf(card.locator('.piece__certificate-line'), [expect.stringMatching(/^CREATED \d{1,2} [A-Z]{3} \d{4} · VALID UNTIL \d{1,2} [A-Z]{3} \d{4}$/) as unknown as string]);
    await keepsFloors(page, ['COPY LINK', 'OPEN LINK', 'WITHDRAW', 'CREATE CERTIFICATE']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['COPY LINK', 'OPEN LINK', 'WITHDRAW', 'CREATE CERTIFICATE']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-certificate.png'), fullPage: true });
    const row = await srv.ctx.db.selectFrom('ownership_certificates').selectAll().where('product_id', '=', piece.product.id).executeTakeFirstOrThrow();
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(90 * 86_400_000);

    // A buyer, with no account, opens the link: the record, read live; nothing about the owner; never AUTHENTIC.
    const buyerCtx = await mobileContext(browser, { reducedMotion: 'reduce' });
    const buyer = await buyerCtx.newPage();
    const buyerProblems: string[] = [];
    buyer.on('console', (m) => {
      if (!isExpectedConsole(m) || /Content Security Policy/i.test(m.text())) buyerProblems.push(`console ${m.type()}: ${m.text()}`);
    });
    buyer.on('pageerror', (e) => buyerProblems.push(`pageerror: ${e.message}`));
    const requests: string[] = [];
    const bodies: string[] = [];
    const lookups: string[] = [];
    buyer.on('request', (r) => {
      requests.push(r.url());
      if (r.url().includes('/api/v1/certificates/')) bodies.push(r.postData() ?? '');
      if (new URL(r.url()).pathname === '/api/v1/certificates/lookup') lookups.push(r.postData() ?? '');
    });
    const res = await buyer.goto(url);
    expect(res?.status()).toBe(200);
    await textOf(buyer.locator('h1'), 'OWNERSHIP CERTIFICATE');
    await textOf(buyer.locator('.certificate__state'), 'VALID');
    await textOf(buyer.locator('.certificate__lead'), /It attests this record, not the object it is shown with: to check an object, scan its ORBES CODE\./);
    await textOf(buyer.locator('.certificate__plate .genome__id'), productId);
    expect(await buyer.locator('.certificate__plate').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(246, 242, 234)');
    await countOf(buyer.locator('.certificate__plate .genome-svg--orbit g[data-layer="genome"]'), 8);
    // The shared certificate keeps the SEAL at the GENOME's centre (decision 12): never a collector's monogram.
    await countOf(buyer.locator('.certificate__plate g[data-layer="seal"]'), 1);
    await countOf(buyer.locator('.certificate__plate g[data-layer="monogram"]'), 0);
    await textOf(buyer.locator('.certificate__plate .genome__meta'), `${piece.genome.fingerprint} · GENOME-01`);
    await textsOf(buyer.locator('.certificate__lines .lines__line'), ['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    await textOf(buyer.locator('.certificate__section').first(), /^THE RECORD OWNERSHIP VERIFIED SINCE \d{1,2} [A-Z]{3} \d{4} WARRANTY ACTIVE FROM 20 SEP 2026 UNTIL 20 SEP 2028 LOSS OR THEFT NONE REPORTED$/);
    await textOf(buyer.locator('.certificate__section').last(), /^THIS CERTIFICATE CHECKED \d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} ISSUED \d{1,2} [A-Z]{3} \d{4} VALID UNTIL \d{1,2} [A-Z]{3} \d{4}$/);
    const text = await buyer.locator('main').innerText();
    for (const secret of [email, 'Louise', 'Martin', owner.account.id, row.id]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/AUTHENTIC/);
    expect(await figuresInDisplayFace(buyer)).toEqual([]);
    await keepsFloors(buyer, ['DOWNLOAD PDF', 'SCAN ORBES CODE']);
    for (const width of PHONE_WIDTHS) {
      await buyer.setViewportSize({ width, height: 640 });
      await keepsFloors(buyer, ['DOWNLOAD PDF', 'SCAN ORBES CODE']);
    }
    await buyer.setViewportSize(MOBILE_VIEWPORT);
    await buyer.screenshot({ path: join(OUT_DIR, 'verify-ownership-certificate.png'), fullPage: true });
    // The token went in the body of a POST only: no URL the server received holds it.
    expect(requests.filter((u) => u.includes(token))).toEqual([]);
    expect(bodies).toEqual([JSON.stringify({ token })]);

    // DOWNLOAD PDF: the certificate as it reads now.
    const [download] = await Promise.all([buyer.waitForEvent('download'), buyer.getByRole('button', { name: 'DOWNLOAD PDF' }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^ORBES-ownership-certificate-${productId}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
    const pdfPath = join(srv.workDir, 'certificate.pdf');
    await download.saveAs(pdfPath);
    const pdf = readFileSync(pdfPath).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain(`/URI (${url})`);
    expect(pdf).not.toContain(email);

    // A reload keeps the certificate; back returns to the landing (the link put it under the certificate).
    await buyer.reload();
    await textOf(buyer.locator('.certificate__state'), 'VALID');
    expect(new URL(buyer.url()).pathname).toBe('/verify/c');
    expect(new URL(buyer.url()).hash).toBe(`#${token}`);

    // The owner reports the piece lost: the section goes, and the link reads NO LONGER VALID, with no PDF.
    await card.getByRole('button', { name: 'REPORT LOST / STOLEN' }).click();
    await card.getByRole('button', { name: 'LOST', exact: true }).click();
    await card.getByRole('button', { name: 'CONFIRM REPORT' }).click();
    await textOf(card.locator('.ownership__status'), 'REPORTED LOST');
    await countOf(card.locator('.piece__certificate-title'), 0);
    await buyer.reload();
    await textOf(buyer.locator('.certificate__state'), 'NO LONGER VALID');
    await textOf(buyer.locator('.certificate__lead'), 'This certificate has expired, or the record of its piece has changed since it was issued. Ask the owner of the piece for a new certificate.');
    await countOf(buyer.locator('.certificate__plate'), 0);
    await countOf(buyer.getByRole('button', { name: 'DOWNLOAD PDF' }), 0);
    await keepsFloors(buyer, ['SCAN ORBES CODE']);

    // Found again: the old link stays ended, listed as such, and the owner withdraws it.
    await card.getByRole('button', { name: 'PIECE FOUND' }).click();
    await card.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await card.getByRole('button', { name: 'CONFIRM', exact: true }).click();
    await textOf(card.locator('.ownership__status'), 'REGISTERED TO YOU');
    await textsOf(card.locator('.piece__certificate-line'), [expect.stringMatching(/^CREATED \d{1,2} [A-Z]{3} \d{4} · NO LONGER VALID$/) as unknown as string]);
    await card.getByRole('button', { name: /^WITHDRAW/ }).click();
    await textOf(card.getByRole('status'), 'The link has been withdrawn: it no longer leads to the certificate.');
    await countOf(card.locator('.piece__certificate'), 0);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('OWNERSHIP CERTIFICATE');
    const audit = await srv.ctx.audit.list({ targetId: productId });
    expect(audit.items.filter((e) => e.action.startsWith('ownership.certificate.')).map((e) => [e.action, e.actorId])).toEqual([
      ['ownership.certificate.revoke', owner.account.id],
      ['ownership.certificate.create', owner.account.id],
    ]);

    // Withdrawn, the link reads as one that never existed.
    await buyer.reload();
    await textOf(buyer.locator('.certificate__state'), 'NOT FOUND');
    await textOf(buyer.locator('.certificate__lead'), /This link does not lead to a certificate: it may be incomplete, or withdrawn by its owner\./);
    // An edited fragment is read again at once, each way: the token of a new link, then one that leads nowhere.
    const fresh = await srv.ctx.services.ownershipCertificates.create(owner.account.id, productId, {}, { type: 'account', id: owner.account.id });
    const asked = lookups.length;
    await buyer.evaluate((t) => {
      location.hash = `#${t}`;
    }, fresh.token);
    await textOf(buyer.locator('.certificate__state'), 'VALID');
    await textOf(buyer.locator('.certificate__plate .genome__id'), productId);
    expect(lookups.slice(asked)).toEqual([JSON.stringify({ token: fresh.token })]);
    await buyer.evaluate(() => {
      location.hash = '#not-a-link';
    });
    await textOf(buyer.locator('.certificate__state'), 'NOT FOUND');
    await countOf(buyer.locator('.certificate__plate'), 0);
    expect(lookups.slice(asked)).toEqual([JSON.stringify({ token: fresh.token }), JSON.stringify({ token: 'not-a-link' })]);
    // The address as the PDF letters it under CHECK IT LIVE, typed back as printed: the path in capitals, the code in
    // groups of four. The server sends the path to /verify/c, the browser keeps the fragment, the app reads the code.
    const lettered = certificateLinkLettering(fresh.url);
    const typed = `${new URL(srv.origin).protocol}//${lettered.address}${lettered.code}`;
    expect(typed).toMatch(/\/VERIFY\/C#[0-9A-Z]{4}(-[0-9A-Z]{4}){12}$/);
    const opened = await buyer.goto(typed);
    expect(opened?.status()).toBe(200);
    expect(opened?.request().redirectedFrom()?.url()).toMatch(/\/VERIFY\/C(#.*)?$/);
    await textOf(buyer.locator('.certificate__state'), 'VALID');
    await textOf(buyer.locator('.certificate__plate .genome__id'), productId);
    expect(new URL(buyer.url()).pathname).toBe('/verify/c');
    expect(new URL(buyer.url()).hash).toBe(`#${lettered.code}`);
    expect(lookups.at(-1)).toBe(JSON.stringify({ token: lettered.code }));
    // A link without its fragment leads nowhere; opened directly, back returns to the landing rather than out of the app.
    await buyer.goto(`${srv.origin}/verify/c`);
    await textOf(buyer.locator('.certificate__state'), 'NOT FOUND');
    await buyer.goBack();
    await buyer.locator('.view--now[data-ready]').waitFor();
    expect(new URL(buyer.url()).pathname).toBe('/verify');
    expect(new URL(buyer.url()).hash).toBe('');
    expect(buyerProblems).toEqual([]);
    expect(problems).toEqual([]);
    await buyerCtx.close();
    await ownerCtx.close();
  }, 180_000);

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
    await textOf(page.locator('.n-own__status'), 'STAFF SCAN');
    await textOf(page.locator('.n-own__small'), STAFF_SCAN_NOTE);
    await countOf(page.locator('.n-own form, .n-own button'), 0);

    const scan = await srv.ctx.db.selectFrom('scan_events').select(['event_type', 'admin_id', 'device_hash']).where('product_id', '=', issued.product.id).executeTakeFirstOrThrow();
    expect(scan).toEqual({ event_type: 'ADMIN_TEST', admin_id: seller.id, device_hash: null });
    expect(await srv.ctx.db.selectFrom('scan_tokens').select('id_hash').where('product_id', '=', issued.product.id).execute()).toEqual([]);

    // A piece registered to someone else, its transfer pending: a staff scan earns no window to receive it, so the
    // OWNERSHIP tab says STAFF SCAN and how to receive a piece of one's own, never VERIFY AGAIN (another staff scan).
    const listed = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(listed.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const holder = await srv.ctx.services.auth.registerAccount({ email: `holder-${listed.product.productId.toLowerCase()}@example.com`, password: PASSWORD }, {});
    const holderActor = { type: 'account', id: holder.account.id } as const;
    const first = await srv.ctx.services.verification.verify({ code: listed.code.data }, {});
    await srv.ctx.services.ownership.registerFirst(holder.account.id, { registrationToken: first.registration!.token, claimCode: listed.claimCode! }, holderActor);
    await srv.ctx.services.ownership.initiateTransfer(holder.account.id, listed.product.id, holderActor);
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'staff-registered.png', listed));
    expect(await resultTitle(page)).toBe('AUTHENTIC REGISTERED');
    await attrOf(page.getByRole('tab', { name: 'PRODUCT' }), 'aria-selected', 'true');
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await textOf(page.locator('.n-own__status'), 'STAFF SCAN');
    await textOf(page.locator('.n-own .n-own__heading'), 'RECEIVING THIS PIECE');
    await textOf(page.locator('.n-own__text').last(), RECEIVING.staffScan);
    await countOf(page.getByRole('button', { name: 'VERIFY AGAIN' }), 0);
    await countOf(page.locator('.n-own form'), 0);
    expect(await srv.ctx.db.selectFrom('scan_tokens').select('id_hash').where('product_id', '=', listed.product.id).where('purpose', '=', 'TRANSFER_ACCEPT').execute()).toEqual([]);
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();

    // A code ORBES did not sign, from the same browser: a staff scan takes no report, so WHERE DID YOU SEE OR BUY
    // THIS PIECE? is not offered (the server would refuse it, and scanning again would only make another staff scan).
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[30] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    await uploadPhoto(page, writeCodePng(srv.workDir, 'staff-forged.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await visible(page.locator('.n-result__help'));
    await countOf(page.getByRole('region', { name: 'WHERE DID YOU SEE OR BUY THIS PIECE?' }), 0);
    await countOf(page.locator('.n-report'), 0);
    const forgedScans = await srv.ctx.db.selectFrom('scan_events').select(['event_type', 'result_state']).where('admin_id', '=', seller.id).orderBy('result_state').execute();
    expect(forgedScans).toEqual([
      { event_type: 'ADMIN_TEST', result_state: 'AUTHENTIC_FIRST_REGISTRATION' },
      { event_type: 'ADMIN_TEST', result_state: 'AUTHENTIC_REGISTERED' },
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
    await countOf(page.locator('.n-lines__line, .n-kv'), 0);
    const card = page.getByRole('region', { name: 'DO YOU HOLD THE CERTIFICATE CARD?' });
    await visible(card);
    expect(await page.locator('.n-result__help + .n-result__card').count()).toBe(1);
    await textOf(card.locator('.n-result__card-text'), /certificate card, you may register it in your name with the claim code/);
    // The window's closing time says it is open (C15: in ivory, in place of the state line).
    await textOf(card.locator('.n-own__until'), /^REGISTRATION OPEN UNTIL \d\d:\d\d$/);
    await textOf(card.locator('.n-own__text').first(), 'While its activity is reviewed, this piece can be registered only with the claim code of its certificate card.');
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
    await textOf(card.locator('.n-own__status'), 'REGISTERED TO YOU');
    await textOf(card, /Ownership verified with its claim code/);
    expect(await srv.ctx.services.ownership.currentOwner(issued.product.id)).toBeTruthy();

    // VIEW AS OWNER verifies again: the owner's own piece, with the unusual activity said once. The certificate card
    // made it a first registration: the ceremony (P-D01).
    await page.getByRole('button', { name: 'VIEW AS OWNER' }).click();
    await expect.poll(() => resultTitle(page), { timeout: 30_000 }).toBe('AUTHENTIC OWNERSHIP VERIFIED');
    await textOf(page.locator('.n-ceremony__name'), 'MONOLITHE');
    await attrOf(page.locator('.view--result'), 'data-tone', 'authentic');
    await textOf(page.locator('.n-result__message'), /Unusual activity has been recorded for it/);
    await countOf(page.locator('.n-result__card'), 0);
    await page.getByRole('tab', { name: 'OWNERSHIP' }).click();
    await textOf(page.locator('.n-own__status'), 'REGISTERED TO YOU');
    expect(problems).toEqual([]);
  }, 120_000);

  it('lets the recipient of a transfer receive the piece from an UNUSUAL ACTIVITY result, with the transfer code its owner gave (F-03)', async () => {
    const issued = await srv.issue({ withClaimSecret: true });
    await srv.ctx.services.warranty.activate(issued.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const seller = await srv.ctx.services.auth.registerAccount({ email: 'seller.listed@example.com', password: PASSWORD }, {});
    const sellerActor = { type: 'account', id: seller.account.id } as const;
    const scan = await srv.ctx.services.verification.verify({ code: issued.code.data }, {});
    await srv.ctx.services.ownership.registerFirst(seller.account.id, { registrationToken: scan.registration!.token, claimCode: issued.claimCode! }, sellerActor);
    const { transferCode } = await srv.ctx.services.ownership.initiateTransfer(seller.account.id, issued.product.id, sellerActor);
    // Its code, shown in a second-hand listing, scanned by 22 strangers within a minute: suspicious from the history alone.
    for (let i = 0; i < 22; i++) {
      await srv.ctx.services.verification.verify({ code: issued.code.data }, { deviceHash: `listing-device-${i}`, ipHash: `listing-ip-${i}`, geo: { country: 'FR' } });
    }
    await srv.ctx.services.auth.registerAccount({ email: 'buyer.listed@example.com', password: PASSWORD }, {});

    // The buyer, signed in before the scan.
    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await page.goto(`${srv.origin}/verify/pieces`);
    await page.getByLabel('EMAIL').fill('buyer.listed@example.com');
    await page.getByLabel('PASSWORD').fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await visible(page.getByRole('button', { name: 'CHANGE PASSWORD' }));
    await page.goto(`${srv.origin}/verify`);
    await uploadPhoto(page, writeCodePng(srv.workDir, 'listed.png', issued));
    expect(await resultTitle(page)).toBe('UNUSUAL ACTIVITY DETECTED');
    await countOf(page.getByRole('tab'), 0);
    await countOf(page.locator('.n-lines__line, .n-kv'), 0);
    await countOf(page.getByRole('region', { name: 'DO YOU HOLD THE CERTIFICATE CARD?' }), 0);
    const section = page.getByRole('region', { name: 'DO YOU HOLD A TRANSFER CODE?' });
    await visible(section);
    expect(await page.locator('.n-result__help + .n-result__card').count()).toBe(1);
    await textOf(section.locator('.n-result__card-text'), 'If the owner of this piece has given you a transfer code, you may receive it in your ORBES account with that code.');
    await textOf(section.locator('.n-own__status'), 'REGISTERED TO ITS OWNER');
    await textOf(section, /While its activity is reviewed, this piece can be received only with the transfer code its owner gave you\./);
    await textOf(section.locator('.n-own__heading'), 'RECEIVING THIS PIECE');
    await keepsFloors(page, ['RECEIVE THIS PIECE', 'SIGN OUT', 'SCAN AGAIN']);
    await page.getByRole('textbox', { name: 'TRANSFER CODE' }).fill(transferCode);
    await page.getByRole('button', { name: 'RECEIVE THIS PIECE' }).click();
    await textOf(section.locator('.n-own__status'), 'REGISTERED TO YOU');
    await textOf(section, new RegExp(`The ownership of ${issued.product.productId} has been transferred to your ORBES account\\.`));
    const buyer = await srv.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', 'buyer.listed@example.com').executeTakeFirstOrThrow();
    expect((await srv.ctx.services.ownership.currentOwner(issued.product.id))?.accountId).toBe(buyer.id);
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
    await textOf(card.locator('.n-own__small'), /registration window of this scan has closed\. Scan the code again, then register this piece with the claim code of its certificate card\./);
    await countOf(card.getByRole('button'), 0);
    await countOf(page.getByLabel('CLAIM CODE'), 0);
    // One SCAN AGAIN: the foot's.
    await countOf(page.getByRole('button', { name: 'SCAN AGAIN' }), 1);
    await countOf(page.locator('.n-result__foot').getByRole('button', { name: 'SCAN AGAIN' }), 1);
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
      await visible(page.locator('.n-result__help'));
      await countOf(page.locator('.n-result__card'), 0);
      await countOf(page.getByRole('region', { name: 'DO YOU HOLD THE CERTIFICATE CARD?' }), 0);
      await countOf(page.getByLabel('CLAIM CODE'), 0);
      await countOf(page.getByRole('tab'), 0);
      await visible(page.locator('.n-result__help').getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
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

    // Under the help line: a link (the hairline button stays SCAN AGAIN), an email to Client
    // Services that quotes this scan's reference.
    const help = page.locator('.n-result__help');
    const email = help.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    await visible(email);
    const scan = await srv.ctx.db.selectFrom('scan_events').select(['id', 'result_state']).orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(scan.result_state).toBe('INVALID_SIGNATURE');
    const ref = scan.id.split('-')[0].toUpperCase();
    await textOf(page.locator('.n-result__meta'), new RegExp(`REF ${ref}$`));
    const href = new URL((await email.getAttribute('href'))!);
    expect(href.protocol).toBe('mailto:');
    expect(href.pathname).toBe(CLIENT_SERVICES.email);
    expect(href.searchParams.get('subject')).toBe(`ORBES — REF ${ref} — INVALID SIGNATURE`);
    expect(href.searchParams.get('body')).toMatch(new RegExp(`^\\r\\n\\r\\nREFERENCE: ${ref}\\r\\nRESULT: INVALID SIGNATURE\\r\\nVERIFIED: \\d{1,2} [A-Z]{3} \\d{4} · \\d\\d:\\d\\d \\(UTC[+-]\\d\\d:\\d\\d\\)$`));
    await attrOf(email, 'class', 'n-g n-contact__email');
    await countOf(page.locator('.n-btn:visible'), 1);
    // One line, inside the column (never wider than the page), in a text link's 44 px tap zone.
    expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await linesOf(email)).toBe(1);
    // Then the phone, a tel: link read in Helvetica Neue (figures), and the hours.
    const phone = help.getByRole('link', { name: `Call ORBES Client Services, ${CLIENT_SERVICES.phone}` });
    await attrOf(phone, 'href', 'tel:+33123456789');
    await textOf(phone, CLIENT_SERVICES.phone);
    expect(await phone.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    await textOf(help.locator('.n-contact__hours'), CLIENT_SERVICES.hours);
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
    expect(await page.locator('.n-result__help + .n-report').count()).toBe(1);
    const title = section.locator('.n-report__title');
    await textOf(section.getByRole('heading', { level: 2 }), /^WHERE DID YOU SEE OR BUY THIS PIECE\?/);
    expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('11px');
    expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans/);
    await textOf(section.locator('.n-report__lead'), 'Optional. Your answer stays with this reference, for ORBES Client Services.');
    // C16: a row that opens (+), the question and its sentence; nothing to choose nor to type until it is opened.
    const question = section.getByRole('button', { name: /^WHERE DID YOU SEE OR BUY THIS PIECE\?/ });
    await attrOf(question, 'aria-expanded', 'false');
    expect(await section.locator('form').isHidden()).toBe(true);
    await countOf(page.locator('.n-btn:visible'), 1);
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', 'SCAN AGAIN']);
    await question.click();
    await attrOf(question, 'aria-expanded', 'true');
    // Opened: the four answers, two by two (C15's .opt2), the place, the note and SEND ANSWER.
    await textsOf(section.locator('.n-report__channel'), ['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER']);
    await visible(section.locator('form'));
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', 'BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER', 'SCAN AGAIN']);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 640 });
      await keepsFloors(page, ['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER', 'SCAN AGAIN']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);

    // SEND ANSWER before an answer is chosen says it cannot be used yet (aria-disabled, C15's look kept); pressed from the
    // keyboard all the same, it takes the keyboard to the answers and sends nothing.
    const early = section.getByRole('button', { name: 'SEND ANSWER' });
    await attrOf(early, 'aria-disabled', 'true');
    expect(await early.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await early.focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('BOUTIQUE');
    await attrOf(early, 'aria-disabled', 'true');
    // ONLINE: pressed, then the place, the note and SEND ANSWER (a hairline button, as C15 draws it).
    const online = section.getByRole('button', { name: 'ONLINE' });
    await online.click();
    await attrOf(online, 'aria-pressed', 'true');
    await attrOf(section.getByRole('button', { name: 'BOUTIQUE' }), 'aria-pressed', 'false');
    await attrOf(early, 'aria-disabled', 'false');
    await visible(section.getByLabel('PLACE (OPTIONAL)'));
    await section.getByLabel('PLACE (OPTIONAL)').fill('a marketplace listing');
    await section.getByLabel('NOTE (OPTIONAL)').fill('Offered at a third of the boutique price.');
    await textOf(section.locator('#report-note-hint'), 'Please leave out your name and contact details.');
    const send = section.getByRole('button', { name: 'SEND ANSWER' });
    await attrOf(send, 'class', /\bn-btn--ol\b/);
    await countOf(page.locator('.n-btn:visible'), 2);
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
    await textOf(section.locator('.n-report__kept'), `Your answer is kept with reference ${ref}.`);
    await countOf(section.getByRole('button'), 0);
    await textOf(page.locator('.n-result__meta'), new RegExp(`REF ${ref}$`));
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
    await countOf(page.locator('.n-contact'), 0);
    await visible(page.locator('.n-result__help'));
    // The held read gives up on its own (a few seconds); the next result reads the contact again and shows it.
    await page.waitForTimeout(4_500);
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'stalled-contact-2.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await visible(page.locator('.n-result__help').getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
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
    await countOf(page.locator('.n-contact'), 0);
    await page.getByRole('tab', { name: 'WARRANTY' }).click();
    const panel = page.getByRole('tabpanel');
    await textOf(panel.locator('.n-kv'), /NO LONGER VALID/);
    const email = panel.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' });
    await visible(email);
    const href = new URL((await email.getAttribute('href'))!);
    expect(href.searchParams.get('subject')).toMatch(/^ORBES — REF [0-9A-F]{8} — AUTHENTIC$/);
    expect(href.searchParams.get('body')).toMatch(/\r\nRESULT: AUTHENTIC\r\nWARRANTY: NO LONGER VALID\r\n/);
    await visible(panel.getByRole('link', { name: `Call ORBES Client Services, ${CLIENT_SERVICES.phone}` }));
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'CONTACT ORBES CLIENT SERVICES', CLIENT_SERVICES.phone, 'SCAN ANOTHER']);
    await countOf(page.locator('.n-contact'), 1);
    // A link at the width of a tab panel: one line on this phone and on the narrower ones in use.
    await attrOf(email, 'class', 'n-g n-contact__email');
    await countOf(page.locator('.n-btn:visible'), 1);
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
    await countOf(page.locator('.n-result__footnote'), 0);
    expect(problems).toEqual([]);
  }, 120_000);

  it('shows the photograph of an authentic piece\'s model under its GENOME (F-04, C9), never the piece\'s own (NOCTURNE, decision 9), with its alternative text; none on an invalid signature', async () => {
    // A model of its own, so that no other result of this suite shows a photograph.
    const category = (await srv.ctx.categories.getByCode('J'))!;
    const model = await srv.ctx.db
      .insertInto('models')
      .values({ category_id: category.index, name: 'ECLIPSE', type: 'PENDANT', sku_prefix: 'ECL-PD', default_material: '18K YELLOW GOLD' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const issued = await srv.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: model.id, material: '18K YELLOW GOLD', year: 2026 }, SYSTEM_ACTOR);
    const { media } = srv.ctx.services;
    await media.setModelImage(model.id, { mime: 'image/jpeg', bytes: withJpegSegments(jpegPhoto(640, 480), [SEGMENTS.exif()]) }, SYSTEM_ACTOR);
    await media.setProductPhoto(issued.product.productId, { mime: 'image/jpeg', bytes: jpegPhoto(480, 480) }, SYSTEM_ACTOR);

    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await uploadPhoto(page, writeCodePng(srv.workDir, 'photographed.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    const plate = page.getByRole('region', { name: 'Photograph of the model' });
    await visible(plate);
    // The model's photograph alone, though the piece has one of its own (taken before NOCTURNE): never shown.
    const images = plate.locator('img');
    await countOf(images, 1);
    expect(await images.evaluateAll((els) => els.map((el) => el.getAttribute('alt')))).toEqual(['The ECLIPSE PENDANT model, photographed by ORBES']);
    await textsOf(plate.locator('.n-result__caption'), ['THE MODEL']);
    await textOf(plate.locator('.n-result__photo-note'), 'Photographed by ORBES. Compare it with the piece in your hands.');
    // Decoded by the browser from the stripped file, shown whole (contain) at the column's full width, without the fade.
    await expect.poll(() => images.evaluateAll((els) => els.map((el) => [(el as HTMLImageElement).complete, (el as HTMLImageElement).naturalWidth])), POLL).toEqual([[true, 640]]);
    expect(await images.first().evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
    const frame = (await plate.locator('.n-ph').boundingBox())!;
    expect(frame.width).toBeCloseTo(MOBILE_VIEWPORT.width, 0);
    expect(frame.height).toBeCloseTo(390, 0);
    await countOf(plate.locator('.n-fade'), 0);
    // Under the GENOME (C9), above the model's name and lines.
    const plateBox = (await plate.boundingBox())!;
    const genomeBox = (await page.locator('.n-result__genome').boundingBox())!;
    expect(plateBox.y).toBeGreaterThan(genomeBox.y + genomeBox.height);
    expect(plateBox.y + plateBox.height).toBeLessThan((await page.locator('.n-result__name').boundingBox())!.y);
    expect(await plate.locator('.n-result__caption').first().evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el).fontSize])).toEqual([
      expect.stringMatching(/^"?Gravesend Sans"?,/),
      '9.5px',
    ]);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-result-photographs.png'), fullPage: true });
    // The same frames on the smallest phone in use, without scrolling sideways.
    await page.setViewportSize({ width: 320, height: 640 });
    await keepsFloors(page, ['PRODUCT', 'WARRANTY', 'CARE', 'OWNERSHIP', 'SCAN ANOTHER']);
    await page.setViewportSize(MOBILE_VIEWPORT);

    // The same piece's code with its signature altered: no photograph, nothing of the piece.
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(issued.code.data));
    signature[3] ^= 0x01;
    const forged: IssueResult = { ...issued, code: { ...issued.code, data: toBase64Url(frameCodeData(payloadBytes, signature)) } };
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'photographed-forged.png', forged));
    expect(await resultTitle(page)).toBe('INVALID SIGNATURE');
    await countOf(page.locator('.view--result img'), 0);
    expect(problems).toEqual([]);
  }, 120_000);

  it('THE COLLECTION (P-R02): the lookbook from the landing, a sheet, back to the lookbook then the landing; SEE THE MODEL under an authentic result; THE PRIVATE SALON for an owner signed in, and REQUEST THIS PIECE', async () => {
    // Models of their own, so that no other result of this suite names a sheet.
    const category = (await srv.ctx.categories.getByCode('J'))!;
    const nocturne = await srv.ctx.db.insertInto('collections').values({ name: 'NOCTURNE 2026' }).returning('id').executeTakeFirstOrThrow();
    const model = (name: string, sku: string, collectionId: string | null) =>
      srv.ctx.db.insertInto('models').values({ category_id: category.index, collection_id: collectionId, name, type: 'RING', sku_prefix: sku }).returning('id').executeTakeFirstOrThrow();
    const aurore = await model('AURORE', 'AUR-RG', nocturne.id);
    const zenith = await model('ZENITH', 'ZEN-RG', null);
    const { catalog, media } = srv.ctx.services;
    await media.setModelImage(aurore.id, { mime: 'image/jpeg', bytes: jpegPhoto(600, 600) }, SYSTEM_ACTOR);
    await media.addModelGalleryImage(aurore.id, { mime: 'image/jpeg', bytes: jpegPhoto(400, 300) }, SYSTEM_ACTOR);
    await catalog.updateModel(aurore.id, { slug: 'aurore', lookbook: 'PUBLIC', story: 'The ring of dawn.\n\nCast in Paris.\nPolished by hand.', specs: 'Metal: 925 sterling silver\nWeight: 12 g' }, SYSTEM_ACTOR);
    await catalog.updateModel(zenith.id, { slug: 'zenith', lookbook: 'RESERVED', story: 'Shown to the owners.', priceLabel: '€ 4 800' }, SYSTEM_ACTOR);
    // P-X08: NADIR is in the private salon from PLATINE: a TITANE owner neither sees it nor opens it.
    const nadir = await model('NADIR', 'NAD-RG', null);
    await catalog.updateModel(nadir.id, { slug: 'nadir', lookbook: 'RESERVED', privateMinTier: 2 }, SYSTEM_ACTOR);
    // P-R06: ZENITH is discontinued; its sheet's line says so, with the year.
    const zenithYear = (await catalog.discontinueModel(zenith.id, SYSTEM_ACTOR)).discontinuedAt!.getUTCFullYear();
    const issued = await srv.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: aurore.id, material: '925 STERLING SILVER', year: 2026 }, SYSTEM_ACTOR);

    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // NOW (N3): nothing announced, the newest model of the collection leads it, SEE THE MODEL its sheet; THE COLLECTION
    // is the rail's chapter, at once (no session needed).
    await page.locator('.view--now[data-ready]').waitFor();
    await textOf(page.locator('.now__hero h1'), 'AURORE');
    await attrOf(page.locator('.now__hero').getByRole('link', { name: 'SEE THE MODEL' }), 'href', '/verify/lookbook/aurore');
    const link = page.locator('.n-rail').getByRole('link', { name: 'COLLECTION' });
    await visible(link);
    await attrOf(link, 'href', '/verify/lookbook');
    await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO', 'SEE THE MODEL', 'COLLECTION']);
    await link.click();
    await textOf(page.locator('h1'), 'THE COLLECTION');
    expect(new URL(page.url()).pathname).toBe('/verify/lookbook');

    // The PUBLIC models by collection, the collection's figures in the reading face; nothing reserved, signed out.
    const card = page.locator('article.lookbook-card', { hasText: 'AURORE' });
    await visible(card);
    await textOf(page.locator('.lookbook__group', { has: card }).locator('.lookbook__collection'), 'NOCTURNE 2026');
    await countOf(page.locator('article.lookbook-card', { hasText: 'ZENITH' }), 0);
    await countOf(page.locator('.lookbook__reserved'), 0);
    await textsOf(card.locator('.lookbook-card__name, .lookbook-card__type'), ['AURORE', 'RING']);
    const cover = card.locator('img.lookbook-card__img');
    await attrOf(cover, 'loading', 'lazy');
    await attrOf(cover, 'alt', 'The AURORE RING model, photographed by ORBES');
    await expect.poll(() => cover.evaluate((el) => [(el as HTMLImageElement).complete, (el as HTMLImageElement).naturalWidth, getComputedStyle(el).objectFit]), POLL).toEqual([true, 600, 'contain']);
    expect(await card.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).cursor])).toEqual([PLATE, 'auto']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['SEE THE MODEL', 'SCAN ORBES CODE', ...LEGAL_LINKS]);
    // One line for SEE THE MODEL, two cards to a row, on the phones in use; one to a row on the smallest.
    for (const width of [...PHONE_WIDTHS, MOBILE_VIEWPORT.width]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      expect(await linesOf(card.getByRole('link', { name: 'SEE THE MODEL' })), `${width}`).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
      await keepsFloors(page, ['SEE THE MODEL']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-lookbook.png'), fullPage: true });

    // SEE THE MODEL: its sheet, the cover then the gallery, THE STORY, SPECIFICATIONS, CARE.
    await card.getByRole('link', { name: 'SEE THE MODEL' }).click();
    await textOf(page.locator('h1'), 'AURORE');
    expect(new URL(page.url()).pathname).toBe('/verify/lookbook/aurore');
    await textOf(page.locator('.sheet__collection'), 'NOCTURNE 2026');
    await textOf(page.locator('.sheet__line'), 'RING');
    const photos = page.getByRole('region', { name: 'Photographs of the AURORE model' });
    await countOf(photos.locator('img.sheet-photo__img'), 2);
    await expect.poll(() => photos.locator('img').evaluateAll((els) => els.map((el) => [(el as HTMLImageElement).getAttribute('loading'), (el as HTMLImageElement).naturalWidth])), POLL).toEqual([
      ['eager', 600],
      ['lazy', 400],
    ]);
    // The gallery: the cover across the plate, the last photograph alone on its row centred (the plate's brackets,
    // its last children, do not count).
    expect(await photos.locator('figure.sheet-photo').evaluateAll((els) => els.map((el) => [getComputedStyle(el).gridColumnEnd, getComputedStyle(el).justifySelf]))).toEqual([
      ['-1', 'auto'],
      ['-1', 'center'],
    ]);
    await textsOf(page.locator('.sheet__section .section-label'), ['THE STORY', 'SPECIFICATIONS', 'CARE']);
    await textsOf(page.locator('.sheet__paragraph'), ['The ring of dawn.', 'Cast in Paris. Polished by hand.']);
    expect(await page.locator('.sheet__paragraph').nth(1).evaluate((el) => el.querySelectorAll('br').length)).toBe(1);
    await textsOf(page.locator('.sheet__section .rows__label'), ['METAL', 'WEIGHT']);
    await textsOf(page.locator('.sheet__section .rows__value'), ['925 STERLING SILVER', '12 G']);
    await textOf(page.locator('.sheet__care'), /^Store this piece on its own/);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['THE COLLECTION', ...LEGAL_LINKS]);
    await page.screenshot({ path: join(OUT_DIR, 'verify-lookbook-sheet.png'), fullPage: true });
    // Back from a sheet: the lookbook, then the landing.
    await page.goBack();
    await textOf(page.locator('h1'), 'THE COLLECTION');
    expect(new URL(page.url()).pathname).toBe('/verify/lookbook');
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');

    // Opened directly, a sheet puts the landing and the lookbook under it; its foot's THE COLLECTION goes back there.
    await page.goto(`${srv.origin}/verify/lookbook/AURORE`);
    await textOf(page.locator('h1'), 'AURORE');
    await page.locator('.sheet__foot').getByRole('link', { name: 'THE COLLECTION' }).click();
    await textOf(page.locator('h1'), 'THE COLLECTION');
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    // A model reserved for owners, signed out, and an address that leads nowhere: the same sentence.
    for (const address of ['zenith', 'nowhere']) {
      await page.goto(`${srv.origin}/verify/lookbook/${address}`);
      await textOf(page.locator('.sheet__missing'), 'This model is not in the ORBES collection.');
    }

    // Under an authentic result of a piece of the model: SEE THE MODEL, under the lines; back from the sheet, the lookbook.
    await page.goto(`${srv.origin}/verify`);
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'lookbook.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    const seeModel = page.locator('.n-result__lines').getByRole('link', { name: 'SEE THE MODEL' });
    await attrOf(seeModel, 'href', '/verify/lookbook/aurore');
    await keepsFloors(page, ['SEE THE MODEL', 'SCAN ANOTHER']);
    await seeModel.click();
    await textOf(page.locator('h1'), 'AURORE');
    await page.goBack();
    await textOf(page.locator('h1'), 'THE COLLECTION');

    // P-R06: once its model is discontinued, the piece verifies as before, and its lines end with DISCONTINUED · <year>,
    // the year in the reading face.
    const auroreYear = (await catalog.discontinueModel(aurore.id, SYSTEM_ACTOR)).discontinuedAt!.getUTCFullYear();
    await page.goto(`${srv.origin}/verify`);
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await uploadPhoto(page, writeCodePng(srv.workDir, 'lookbook-discontinued.png', issued));
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await textOf(page.locator('.n-result__name'), 'AURORE');
    await textsOf(page.locator('.n-result__lines .n-lines__line'), ['RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026', `DISCONTINUED · ${auroreYear}`]);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await catalog.reinstateModel(aurore.id, SYSTEM_ACTOR);

    // An owner signed in (MY PIECES) sees THE PRIVATE SALON (P-X08): the reserved models of its tier, priced, and their sheets.
    const email = 'lookbook.owner@example.com';
    const owner = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    await ownedPiece(owner.account.id);
    await page.goto(`${srv.origin}/verify/pieces`);
    const signIn = page.locator('.pieces__signin');
    await signIn.getByLabel('EMAIL').fill(email);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await countOf(page.locator('article.piece'), 1);
    await page.locator('.pieces__foot').getByRole('link', { name: 'THE COLLECTION' }).click();
    await textOf(page.locator('h1'), 'THE COLLECTION');
    const reserved = page.getByRole('region', { name: 'THE PRIVATE SALON' });
    await visible(reserved);
    await textOf(reserved.locator('.lookbook__reserved-lead'), 'Pieces offered to the owners of an ORBES piece, by tier, on request.');
    const zenithCard = reserved.locator('article.lookbook-card', { hasText: 'ZENITH' });
    await visible(zenithCard);
    await textOf(zenithCard.locator('.lookbook-card__price'), '€ 4 800');
    await countOf(reserved.locator('article.lookbook-card', { hasText: 'NADIR' }), 0);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await zenithCard.getByRole('link', { name: 'SEE THE MODEL' }).click();
    await textOf(page.locator('h1'), 'ZENITH');
    await textOf(page.locator('.sheet__line'), `RING · THE PRIVATE SALON · DISCONTINUED · ${zenithYear}`);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await textsOf(page.locator('.sheet__paragraph'), ['Shown to the owners.']);
    // No photograph: no plate.
    await countOf(page.locator('.sheet__photos'), 0);
    // THE PRIVATE SALON on the sheet: its price, the tier it is offered from, REQUEST THIS PIECE (the sheet's one button).
    const salon = page.getByRole('region', { name: 'THE PRIVATE SALON' });
    await textsOf(salon.locator('.rows__label'), ['PRICE', 'OFFERED FROM']);
    await textsOf(salon.locator('.rows__value'), ['€ 4 800', 'TITANE']);
    await countOf(page.locator('.btn'), 1);
    await keepsFloors(page, ['REQUEST THIS PIECE']);
    await salon.getByLabel('A NOTE FOR ORBES CLIENT SERVICES').fill('A size 54, please.');
    await salon.getByRole('button', { name: 'REQUEST THIS PIECE' }).click();
    await textOf(salon.locator('.sheet__requested-text'), 'ORBES Client Services will contact you.');
    await textOf(salon.locator('.ownership__status'), 'REQUESTED');
    // With the contact of ORBES Client Services: the email names the model and the request.
    const mail = new URL((await salon.locator('.contact__email').getAttribute('href'))!);
    expect(mail.searchParams.get('subject')).toBe('ORBES — ZENITH — REQUEST');
    await countOf(page.locator('.btn'), 0);
    const requested = await srv.ctx.db.selectFrom('shop_requests').select(['id', 'note', 'status']).where('account_id', '=', owner.account.id).execute();
    expect(requested).toEqual([{ id: expect.any(String), note: 'A size 54, please.', status: 'OPEN' }]);
    expect(mail.searchParams.get('body')).toContain(`REQUEST: ${requested[0]!.id}`);
    // Back: the lookbook, then the landing (MY PIECES' entry became the lookbook's).
    await page.goBack();
    await textOf(page.locator('h1'), 'THE COLLECTION');
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    // Read again, the sheet still says the piece is requested.
    await page.goto(`${srv.origin}/verify/lookbook/zenith`);
    await textOf(page.getByRole('region', { name: 'THE PRIVATE SALON' }).locator('.sheet__requested-text'), 'ORBES Client Services will contact you.');
    // Closed in the console, the sheet offers REQUEST THIS PIECE again; requested meanwhile from another device, the
    // stale sheet's request (409 SHOP_REQUEST_OPEN) reads the sheet again: REQUESTED with the contact, no failure.
    const desk = await srv.ctx.services.auth.createAdmin({ email: 'salon.desk@orbes.test', password: 'orbes salon desk passphrase', role: 'OPERATOR' }, SYSTEM_ACTOR);
    await srv.ctx.services.salon.close(requested[0]!.id, { note: 'Called the client.', outcome: 'DECLINED' }, { type: 'admin', id: desk.id });
    await page.reload();
    const again = page.getByRole('region', { name: 'THE PRIVATE SALON' });
    await visible(again.getByRole('button', { name: 'REQUEST THIS PIECE' }));
    const elsewhere = await srv.ctx.services.salon.request(owner.account.id, 'zenith', null, { type: 'account', id: owner.account.id });
    await again.getByRole('button', { name: 'REQUEST THIS PIECE' }).click();
    await textOf(again.locator('.sheet__requested-text'), 'ORBES Client Services will contact you.');
    await textOf(again.locator('.ownership__status'), 'REQUESTED');
    await visible(again.locator('.contact__email'));
    await countOf(again.locator('.form__error'), 0);
    await countOf(page.locator('.btn'), 0);
    expect(new URL((await again.locator('.contact__email').getAttribute('href'))!).searchParams.get('body')).toContain(`REQUEST: ${elsewhere.request.id}`);
    // A model above the owner's tier: the same sentence as a model not in the collection.
    await page.goto(`${srv.origin}/verify/lookbook/nadir`);
    await textOf(page.locator('.sheet__missing'), 'This model is not in the ORBES collection.');
    expect(problems).toEqual([]);
  }, 180_000);

  it('THE RELEASES (P-R03): the list from the landing, a release, its sign-in, ENTER THE DRAW and WITHDRAW; YOUR RELEASES in MY PIECES; drawn, the place held, the seed checked on the phone, the entries by rank', async () => {
    const { ctx } = srv;
    // A model of its own, PUBLIC in the lookbook, photographed; a release of two pieces, open since an hour.
    const category = (await ctx.categories.getByCode('J'))!;
    const model = await ctx.db.insertInto('models').values({ category_id: category.index, name: 'ECLIPSE', type: 'PENDANT', sku_prefix: 'ECL-RL' }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.media.setModelImage(model.id, { mime: 'image/jpeg', bytes: jpegPhoto(600, 600) }, SYSTEM_ACTOR);
    await ctx.services.catalog.updateModel(model.id, { slug: 'eclipse', lookbook: 'PUBLIC' }, SYSTEM_ACTOR);
    const staff = await ctx.services.auth.createAdmin({ email: 'releases@orbes.test', password: 'orbes releases passphrase 2026', role: 'ADMIN' }, SYSTEM_ACTOR);
    const actor = { type: 'admin' as const, id: staff.id };
    const drop = await ctx.services.drops.create(
      { modelId: model.id, title: 'ECLIPSE — release I', description: 'Two pieces, cast in Paris.', quantity: 2, opensAt: new Date(Date.now() - 3_600_000), closesAt: new Date(Date.now() + 86_400_000) },
      actor,
    );
    await ctx.services.drops.publish(drop.id, actor);
    // The entrant holds a piece (TITANE): the draw ranks it first, before two accounts that hold none.
    const email = 'release.entrant@example.com';
    const entrant = await ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    await ownedPiece(entrant.account.id);
    for (const n of [1, 2]) {
      const other = await ctx.services.auth.registerAccount({ email: `release.other${n}@example.com`, password: PASSWORD }, {});
      await ctx.services.drops.enter(other.account.id, drop.id, { type: 'account', id: other.account.id });
    }

    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // NOW (N3): the draw open leads it (no LIVE RELEASE announced), SEE THE RELEASE its page; THE RELEASES is the rail's
    // chapter, with its dot.
    await page.locator('.view--now[data-ready]').waitFor();
    await textOf(page.locator('.now__hero .n-lift > p').first(), 'DRAW · ENTRIES OPEN');
    await textOf(page.locator('.now__hero h1'), 'ECLIPSE — RELEASE I');
    await attrOf(page.locator('.now__hero').getByRole('link', { name: 'SEE THE RELEASE' }), 'href', `/verify/releases/${drop.id}`);
    const link = page.locator('.n-rail').getByRole('link', { name: 'RELEASES' });
    await visible(link);
    await attrOf(link, 'href', '/verify/releases');
    await expect.poll(() => link.locator('.n-rail__live').isVisible(), POLL).toBe(true);
    await keepsFloors(page, ['SCAN ORBES CODE', 'UPLOAD A PHOTO', 'SEE THE RELEASE', 'RELEASES']);
    await link.click();
    await textOf(page.locator('h1'), 'THE RELEASES');
    expect(new URL(page.url()).pathname).toBe('/verify/releases');
    const card = page.locator('article.release-card', { hasText: 'ECLIPSE — RELEASE I' });
    await visible(card);
    await textOf(card.locator('.release-card__state'), 'ENTRIES OPEN');
    await textOf(card.locator('.release-card__model'), 'ECLIPSE · PENDANT');
    await textOf(card.locator('.release-card__line'), /^2 PIECES · ENTRIES CLOSE \d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC$/);
    await attrOf(card.locator('img.release-card__img'), 'loading', 'lazy');
    expect(await card.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).cursor])).toEqual([PLATE, 'auto']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['SEE THE RELEASE', 'SCAN ORBES CODE', 'THE COLLECTION', ...LEGAL_LINKS]);
    for (const width of [...PHONE_WIDTHS, MOBILE_VIEWPORT.width]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-releases.png'), fullPage: true });

    // SEE THE RELEASE: its page, its facts in UTC then on the phone's clock, the rule, the seed's fingerprint.
    await card.getByRole('link', { name: 'SEE THE RELEASE' }).click();
    await textOf(page.locator('h1'), 'ECLIPSE — RELEASE I');
    expect(new URL(page.url()).pathname).toBe(`/verify/releases/${drop.id}`);
    await textOf(page.locator('.release__state'), 'ENTRIES OPEN');
    await textOf(page.locator('.release__paragraph'), 'Two pieces, cast in Paris.');
    await textsOf(page.locator('.release__section > .section-label'), ['THE RELEASE', 'YOUR ENTRY', 'THE DRAW']);
    const closes = page.locator('.release__rows .rows__row', { hasText: 'ENTRIES CLOSE' });
    await textOf(closes.locator('.release__utc'), /^\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC$/);
    await textOf(closes.locator('.release__local'), /^\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} on this phone \(UTC\+0[12]:00\)$/);
    await attrOf(page.locator('.release__model-line').getByRole('link', { name: 'SEE THE MODEL' }), 'href', '/verify/lookbook/eclipse');
    await textOf(page.locator('.release__rule'), RELEASES.rule);
    await textOf(page.locator('.release__seed .release__hex'), groupHex(drop.seedHash));
    // Signed out: the sign-in of an account, any account; then ENTER THE DRAW, the page's hairline button.
    const panel = page.locator('.release__signin');
    await textOf(panel.locator('.n-own__lead'), RELEASES.signIn);
    await panel.getByLabel('EMAIL').fill(email);
    await panel.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    const enter = page.getByRole('button', { name: 'ENTER THE DRAW' });
    await visible(enter);
    await textOf(page.locator('.release__sentence'), RELEASES.status.open);
    await attrOf(page.locator('.release__foot .release__scan'), 'class', /\btextlink\b/);
    await keepsFloors(page, ['ENTER THE DRAW', 'SCAN ORBES CODE', 'THE RELEASES', 'SEE THE MODEL', ...LEGAL_LINKS]);
    await enter.click();
    await textOf(page.locator('.release__sentence'), RELEASES.status.entered);
    const mine = await ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop.id).where('account_id', '=', entrant.account.id).executeTakeFirstOrThrow();
    await textOf(page.locator('.release__entry-id'), `YOUR ENTRY ${mine.id}`);
    await attrOf(page.locator('.release__foot .release__scan'), 'class', /\bbtn\b/);
    await page.getByRole('button', { name: 'WITHDRAW' }).click();
    await textOf(page.locator('.release__sentence'), RELEASES.status.withdrawn);
    await page.getByRole('button', { name: 'ENTER THE DRAW' }).click();
    await textOf(page.locator('.release__sentence'), RELEASES.status.entered);
    // The same entry, its id kept.
    await textOf(page.locator('.release__entry-id'), `YOUR ENTRY ${mine.id}`);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await page.screenshot({ path: join(OUT_DIR, 'verify-release.png'), fullPage: true });
    // Back from a release: the list, then the landing.
    await page.goBack();
    await textOf(page.locator('h1'), 'THE RELEASES');
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');

    // MY PIECES groups the account's entries: its release, what it means now, its id.
    await page.goto(`${srv.origin}/verify/pieces`);
    const releases = page.locator('.pieces__releases');
    await textOf(releases.locator('.section-label'), 'YOUR RELEASES');
    await textOf(releases.locator('.pieces__entry-state'), 'ENTRIES OPEN · ENTERED');
    await textOf(releases.locator('.pieces__entry-id'), `YOUR ENTRY ${mine.id}`);
    await attrOf(releases.getByRole('link', { name: 'ECLIPSE — RELEASE I' }), 'href', `/verify/releases/${drop.id}`);
    await attrOf(page.locator('.pieces__foot').getByRole('link', { name: 'THE RELEASES' }), 'href', '/verify/releases');

    // The draw, once the entries are closed (an ADMIN, in the console): the entrant, TITANE, first; a place held.
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - 7_200_000), closes_at: new Date(Date.now() - 1_000) }).where('id', '=', drop.id).execute();
    expect(await ctx.services.drops.draw(drop.id, actor)).toMatchObject({ entries: 3, selected: 2, waitlisted: 1 });
    await page.reload();
    await textOf(releases.locator('.pieces__entry-state'), 'DRAWN · PLACE HELD');
    await textOf(releases.locator('.pieces__entry-sentence'), /^Your place is held until \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} \(UTC\+0[12]:00\) — ORBES Client Services will contact you\.$/);
    await visible(releases.getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
    await releases.getByRole('link', { name: 'ECLIPSE — RELEASE I' }).click();
    await textOf(page.locator('h1'), 'ECLIPSE — RELEASE I');
    // Drawn, the release is over (plan LIVE RELEASE+, decision 30): said so, with the account's part in it.
    await textOf(page.locator('.release__state'), RELEASES.over);
    await textOf(page.locator('.release__part'), RELEASES.past.tookPart);
    await textOf(page.locator('.release__entry .ownership__status'), 'PLACE HELD');
    // The seed, checked on this phone against the fingerprint published with the release; the entries by rank, its own marked.
    const seed = (await ctx.db.selectFrom('drops').select('seed').where('id', '=', drop.id).executeTakeFirstOrThrow()).seed!;
    await textOf(page.locator('.release__seed .release__hex').nth(1), groupHex(Buffer.from(seed).toString('hex')));
    await textOf(page.locator('.release__check'), RELEASES.seedChecked);
    // Its entries by rank, never said how many (no end figure).
    await textOf(page.locator('.release__entries-lead'), RELEASES.entriesLead);
    await countOf(page.locator('.release__item'), 3);
    await textOf(page.locator('.release__item.is-yours .release__item-line'), '1 · TITANE · 0 YEARS');
    await textOf(page.locator('.release__item.is-yours .release__item-id'), mine.id);
    await countOf(page.getByRole('button', { name: 'ENTER THE DRAW' }), 0);
    await countOf(page.getByRole('button', { name: 'WITHDRAW' }), 0);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['CONTACT ORBES CLIENT SERVICES', 'SCAN ORBES CODE', 'THE RELEASES', ...LEGAL_LINKS]);
    // An address under /verify/releases that is none: the list.
    await page.goto(`${srv.origin}/verify/releases/nowhere`);
    await textOf(page.locator('h1'), 'THE RELEASES');
    expect(new URL(page.url()).pathname).toBe('/verify/releases');
    expect(problems).toEqual([]);
  }, 180_000);

  it('THE RELEASES, early access (P-X02): both openings under the state; RESERVE A PLACE for a PLATINE owner, the place held at once; a TITANE owner waits; the privilege said once in MY PIECES (YOUR TIER) and recalled in THE CIRCLE', async () => {
    const { ctx } = srv;
    const category = (await ctx.categories.getByCode('J'))!;
    const model = await ctx.db.insertInto('models').values({ category_id: category.index, name: 'SOLSTICE', type: 'RING', sku_prefix: 'SOL-EA' }).returning('id').executeTakeFirstOrThrow();
    const staff = await ctx.services.auth.createAdmin({ email: 'early.access@orbes.test', password: 'orbes early access passphrase 2026', role: 'ADMIN' }, SYSTEM_ACTOR);
    const actor = { type: 'admin' as const, id: staff.id };
    // Two pieces, entries open to everyone in a day: published inside its early access of 48 hours, which opens with it.
    const drop = await ctx.services.drops.create(
      { modelId: model.id, title: 'SOLSTICE — release I', quantity: 2, opensAt: new Date(Date.now() + 86_400_000), closesAt: new Date(Date.now() + 2 * 86_400_000) },
      actor,
    );
    await ctx.services.drops.publish(drop.id, actor);
    // A PLATINE owner (three pieces) and a TITANE one (one piece).
    const platineEmail = 'early.platine@example.com';
    const platine = await ctx.services.auth.registerAccount({ email: platineEmail, password: PASSWORD }, {});
    for (let i = 0; i < 3; i++) await ownedPiece(platine.account.id);
    const titaneEmail = 'early.titane@example.com';
    const titane = await ctx.services.auth.registerAccount({ email: titaneEmail, password: PASSWORD }, {});
    await ownedPiece(titane.account.id);

    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // The list: EARLY ACCESS while PLATINE and PALLADIUM reserve.
    await page.goto(`${srv.origin}/verify/releases`);
    const card = page.locator('article.release-card', { hasText: 'SOLSTICE — RELEASE I' });
    await textOf(card.locator('.release-card__state'), 'EARLY ACCESS');
    // Its page: both openings under its state, the early access among its facts and its paragraph, the rule.
    await card.getByRole('link', { name: 'SEE THE RELEASE' }).click();
    await textOf(page.locator('h1'), 'SOLSTICE — RELEASE I');
    await textOf(page.locator('.release__state'), 'EARLY ACCESS');
    await textOf(page.locator('.release__access'), /^PLATINE AND PALLADIUM: FROM \d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC · EVERYONE: FROM \d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC$/);
    await textsOf(page.locator('.release__rows .rows__label'), ['PIECES', 'EARLY ACCESS', 'ENTRIES OPEN', 'ENTRIES CLOSE', 'PLACE HELD', 'RESERVED DIRECTLY']);
    await textOf(page.locator('.release__rows .rows__row', { hasText: 'EARLY ACCESS' }).locator('.release__local'), /^\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} on this phone \(UTC\+0[12]:00\)$/);
    const reserved = page.locator('.release__rows .rows__row', { hasText: 'RESERVED DIRECTLY' }).locator('.release__utc');
    await textOf(reserved, '0 OF 2 PIECES');
    await textOf(page.locator('.release__early'), RELEASES.earlyNote);
    await textOf(page.locator('.release__rule'), RELEASES.rule);
    // Signed in as the PLATINE owner: RESERVE A PLACE, the page's hairline button.
    const panel = page.locator('.release__signin');
    await panel.getByLabel('EMAIL').fill(platineEmail);
    await panel.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    const reserve = page.getByRole('button', { name: 'RESERVE A PLACE' });
    await visible(reserve);
    await textOf(
      page.locator('.release__sentence'),
      /^As a PLATINE owner, you may reserve a place now, until entries open to everyone on \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} \(UTC\+0[12]:00\)\. First come, first served, within the pieces of the release\.$/,
    );
    await attrOf(reserve, 'class', /\bbtn\b/);
    await attrOf(page.locator('.release__foot .release__scan'), 'class', /\btextlink\b/);
    await countOf(page.getByRole('button', { name: 'ENTER THE DRAW' }), 0);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['RESERVE A PLACE', 'SCAN ORBES CODE', 'THE RELEASES', ...LEGAL_LINKS]);
    for (const width of [...PHONE_WIDTHS, MOBILE_VIEWPORT.width]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-release-early.png'), fullPage: true });
    await reserve.click();
    // The place held at once until its time, the contact of ORBES Client Services; the page read again counts it.
    await textOf(page.locator('.release__entry .ownership__status'), 'PLACE RESERVED');
    await textOf(page.locator('.release__sentence'), /^You reserved a place directly\. It is held until \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} \(UTC\+0[12]:00\) — ORBES Client Services will contact you\.$/);
    await visible(page.locator('.release__entry').getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }));
    await textOf(reserved, '1 OF 2 PIECES');
    const row = await ctx.db.selectFrom('drop_entries').select(['id', 'status', 'tier', 'rank']).where('drop_id', '=', drop.id).where('account_id', '=', platine.account.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'SELECTED', tier: 2, rank: null });
    await textOf(page.locator('.release__entry-id'), `YOUR ENTRY ${row.id}`);
    await countOf(page.getByRole('button', { name: 'RESERVE A PLACE' }), 0);
    await countOf(page.getByRole('button', { name: 'WITHDRAW' }), 0);
    await attrOf(page.locator('.release__foot .release__scan'), 'class', /\bbtn\b/);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    // MY PIECES: the place reserved among its releases, no EARLY ACCESS block; the privilege among the benefits of
    // YOUR TIER, said once, in the account sheet (decision 10).
    await page.goto(`${srv.origin}/verify/pieces`);
    await textOf(page.locator('.pieces__releases .pieces__entry-state'), 'ENTRIES OPEN SOON · PLACE RESERVED');
    await openAccount(page);
    await textOf(page.locator('.n-account__tier-name'), 'PLATINE');
    await countOf(page.locator('.n-account__benefits:not(.n-account__benefits--next) .n-account__benefit', { hasText: 'Early access to each release' }), 1);
    await page.keyboard.press('Escape');
    await countOf(page.locator('.pieces__early:not([hidden])'), 0);
    await countOf(page.locator('.pieces__early-text'), 0);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    expect(problems).toEqual([]);

    // The TITANE owner: told PLATINE and PALLADIUM owners reserve now, nothing to press; the privilege said under
    // NEXT: PLATINE in MY PIECES, recalled in THE CIRCLE.
    const other = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await other.page.goto(`${srv.origin}/verify/releases/${drop.id}`);
    const signIn = other.page.locator('.release__signin');
    await signIn.getByLabel('EMAIL').fill(titaneEmail);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await textOf(other.page.locator('.release__sentence'), /^PLATINE and PALLADIUM owners are reserving their places now\. Entries open to everyone on .+\.$/);
    await countOf(other.page.getByRole('button', { name: 'RESERVE A PLACE' }), 0);
    await countOf(other.page.getByRole('button', { name: 'ENTER THE DRAW' }), 0);
    await attrOf(other.page.locator('.release__foot .release__scan'), 'class', /\bbtn\b/);
    await other.page.goto(`${srv.origin}/verify/pieces`);
    await countOf(other.page.locator('.pieces__waiting'), 0);
    await visible(other.page.locator('.pieces__lead'));
    await countOf(other.page.locator('.pieces__early:not([hidden])'), 0);
    await openAccount(other.page);
    await textOf(other.page.locator('.n-account__next-label'), 'NEXT: PLATINE');
    await countOf(other.page.locator('.n-account__benefits--next .n-account__benefit', { hasText: 'Early access to each release' }), 1);
    await other.page.keyboard.press('Escape');
    await other.page.goto(`${srv.origin}/verify/circle`);
    await textOf(other.page.locator('.circle__early .section-label'), 'EARLY ACCESS');
    await textOf(other.page.locator('.circle__early-text'), RELEASES.earlyAccess.recall);
    expect(await figuresInDisplayFace(other.page)).toEqual([]);
    expect(other.problems).toEqual([]);
  }, 180_000);

  it('the account sheet (C2), from the header\'s TITANE and monogram: YOUR TIER moved from MY PIECES (P-X04, decision 10): the tier and its pieces, five dots, the benefits, the way to the next tier as ORBES words it; THE CLUB for an account without a piece; SOUND, CHANGE PASSWORD, MY PIECES, the legal pages, SIGN OUT', async () => {
    const { ctx } = srv;
    const email = 'tier.platine@example.com';
    const owner = await ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    for (let i = 0; i < 3; i++) await ownedPiece(owner.account.id);
    // ORBES changed the words of PALLADIUM from the console: the next tier says them.
    const staff = await ctx.services.auth.createAdmin({ email: 'tier.staff@orbes.test', password: 'orbes tier passphrase 2026', role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.club.updateTier('PALLADIUM', 'A commission of your own.\nA yearly visit to the atelier.', { type: 'admin', id: staff.id });

    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await page.goto(`${srv.origin}/verify/pieces`);
    const signIn = page.locator('.pieces__signin');
    // Signed out: SIGN IN in the header (MY PIECES and its sign-in), no account sheet.
    await visible(page.locator('.n-hd').getByRole('link', { name: 'SIGN IN', exact: true }));
    await countOf(page.locator('.n-hd button.n-acct:not([hidden])'), 0);
    await signIn.getByLabel('EMAIL').fill(email);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await countOf(page.locator('article.piece'), 3);
    // MY PIECES no longer holds YOUR TIER.
    await countOf(page.locator('.pieces__tier'), 0);
    await countOf(page.getByText('YOUR TIER', { exact: true }), 0);
    // The header: PLATINE and the monogram, one button named for the account, opening its sheet.
    const account = page.getByRole('button', { name: 'Your account, PLATINE', exact: true });
    await textOf(account, 'PLATINE');
    await attrOf(account, 'aria-haspopup', 'dialog');
    await countOf(account.locator('svg.n-mono path'), 5);
    await account.click();
    const sheet = page.getByRole('dialog', { name: 'YOUR ACCOUNT' });
    await visible(sheet);
    await attrOf(sheet, 'aria-modal', 'true');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id), POLL).toBe('account-title');
    // The page under it is inert and holds still.
    expect(await page.evaluate(() => (document.querySelector('.n-column') as HTMLElement).inert)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.classList.contains('n-locked'))).toBe(true);
    await textOf(sheet.locator('.n-account__email'), email);
    const tier = sheet.locator('.n-account__tier');
    await textOf(tier.locator('#account-tier'), 'YOUR TIER');
    await attrOf(tier, 'aria-labelledby', 'account-tier');
    // PLATINE in the display face, its pieces in the reading face, then its five dots, three of them filled.
    await textOf(tier.locator('.n-account__tier-name'), 'PLATINE');
    await textOf(tier.locator('.n-account__tier-pieces'), '3 pieces held');
    expect(await tier.locator('.n-account__tier-name').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans/);
    expect(await tier.locator('.n-account__tier-pieces').evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/Gravesend/);
    await countOf(tier.locator('.n-meter__dot'), 5);
    await countOf(tier.locator('.n-meter__dot.is-on'), 3);
    // The benefits of TITANE and PLATINE, then PALLADIUM: two more pieces, and what ORBES says it adds.
    await textsOf(tier.locator('.n-account__benefits:not(.n-account__benefits--next) .n-account__benefit'), [
      ...CLUB_TIER_DEFAULT_BENEFITS.TITANE.split('\n'),
      ...CLUB_TIER_DEFAULT_BENEFITS.PLATINE.split('\n'),
    ]);
    await textOf(tier.locator('.n-account__next-label'), 'NEXT: PALLADIUM');
    await textOf(tier.locator('.n-account__next-way'), '2 more pieces registered to your account open PALLADIUM, from 5 pieces held. It adds:');
    await textsOf(tier.locator('.n-account__benefits--next .n-account__benefit'), ['A commission of your own.', 'A yearly visit to the atelier.']);
    // Then SOUND, CHANGE PASSWORD, MY PIECES, the legal pages (their index, a new tab), SIGN OUT.
    await textsOf(sheet.locator('.n-row__label'), ['SOUND', 'CHANGE PASSWORD', 'MY PIECES', 'PRIVACY · TERMS · LEGAL · HELP']);
    await attrOf(sheet.getByRole('link', { name: 'PRIVACY · TERMS · LEGAL · HELP' }), 'href', '/legal');
    await attrOf(sheet.getByRole('link', { name: 'PRIVACY · TERMS · LEGAL · HELP' }), 'target', '_blank');
    await attrOf(sheet.getByRole('link', { name: 'MY PIECES' }), 'href', '/verify/pieces');
    expect(await figuresInDisplayFace(page)).toEqual([]);
    for (const width of [...PHONE_WIDTHS, MOBILE_VIEWPORT.width]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
      expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth), `${width}`).toBe(true);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await keepsFloors(page, ['CHANGE PASSWORD', 'MY PIECES', 'PRIVACY · TERMS · LEGAL · HELP', 'SIGN OUT']);
    // The switch is tapped through its whole row, its label.
    expect((await sheet.locator('label.n-account__sound').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // SOUND: the same switch as the footer's SOUND ON / OFF.
    const sw = sheet.getByRole('switch', { name: 'SOUND' });
    expect(await sw.isChecked()).toBe(true);
    await sheet.locator('label.n-account__sound').click();
    expect(await sw.isChecked()).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('orbes.sound'))).toBe('off');
    // A tap on the dimmed page closes it; focus returns to the account button; the footer says SOUND OFF.
    await page.mouse.click(195, 60);
    await countOf(page.locator('.n-account:not([hidden])'), 0);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('n-acct'))).toBe(true);
    expect(await page.evaluate(() => (document.querySelector('.n-column') as HTMLElement).inert)).toBe(false);
    await textOf(page.getByRole('button', { name: 'SOUND', exact: true }), 'SOUND OFF');
    await page.getByRole('button', { name: 'SOUND', exact: true }).click();
    await textOf(page.getByRole('button', { name: 'SOUND', exact: true }), 'SOUND ON');
    // CHANGE PASSWORD in the sheet (C39): a wrong current password said on its field, then changed; this session stays.
    await account.click();
    await sheet.getByRole('button', { name: 'CHANGE PASSWORD', exact: true }).click();
    await textOf(sheet.locator('.n-account__password-lead'), 'Enter your current password, then a new one. Your other sessions will end; you stay signed in here.');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('account-current-password');
    await sheet.getByLabel('CURRENT PASSWORD').fill('not the password at all');
    await sheet.getByLabel('NEW PASSWORD').fill('a new passphrase of 2026');
    await sheet.locator('form').getByRole('button', { name: 'CHANGE PASSWORD', exact: true }).click();
    await visible(sheet.locator('.form__error'));
    await attrOf(sheet.getByLabel('CURRENT PASSWORD'), 'aria-invalid', 'true');
    await sheet.getByLabel('CURRENT PASSWORD').fill(PASSWORD);
    await sheet.getByLabel('NEW PASSWORD').fill('a new passphrase of 2026');
    await sheet.locator('form').getByRole('button', { name: 'CHANGE PASSWORD', exact: true }).click();
    await textOf(sheet.locator('.n-account__notice'), 'Your password has been changed. Your other sessions have ended.');
    await attrOf(sheet.locator('.n-account__notice'), 'role', 'status');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('CHANGE PASSWORD');
    // MY PIECES closes the sheet and opens the page.
    await sheet.getByRole('link', { name: 'MY PIECES' }).click();
    await countOf(page.locator('.n-account:not([hidden])'), 0);
    await visible(page.locator('#pieces-title'));
    // SIGN OUT: the sheet closes, the header says SIGN IN, MY PIECES offers the sign-in.
    await account.click();
    await sheet.getByRole('button', { name: 'SIGN OUT', exact: true }).click();
    await countOf(page.locator('.n-account:not([hidden])'), 0);
    await visible(page.locator('.n-hd').getByRole('link', { name: 'SIGN IN', exact: true }));
    await visible(page.locator('.pieces__signin'));
    expect(problems).toEqual([]);

    // An account without a piece: THE CLUB, no tier's name nor dots, what a first piece opens; the header names no tier.
    const newcomer = 'tier.newcomer@example.com';
    await ctx.services.auth.registerAccount({ email: newcomer, password: PASSWORD }, {});
    const other = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await other.page.goto(`${srv.origin}/verify/pieces`);
    const otherSignIn = other.page.locator('.pieces__signin');
    await otherSignIn.getByLabel('EMAIL').fill(newcomer);
    await otherSignIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await otherSignIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    // Without a tier, YOUR TIER does not say the early access of PLATINE and PALLADIUM: EARLY ACCESS recalls it.
    await textOf(other.page.locator('.pieces__early .section-label'), 'EARLY ACCESS');
    await textOf(other.page.locator('.pieces__early-text'), RELEASES.earlyAccess.recall);
    const bare = other.page.getByRole('button', { name: 'Your account', exact: true });
    await textOf(bare, '');
    await bare.click();
    const club = other.page.locator('.n-account__tier');
    await textOf(club.locator('#account-tier'), 'THE CLUB');
    await countOf(club.locator('.n-account__tier-name'), 0);
    await countOf(club.locator('.n-meter'), 0);
    await textOf(club.locator('.n-account__next-way'), 'A piece registered to your ORBES account opens TITANE, the first tier of the club:');
    await textsOf(club.locator('.n-account__benefits--next .n-account__benefit'), CLUB_TIER_DEFAULT_BENEFITS.TITANE.split('\n'));
    expect(await figuresInDisplayFace(other.page)).toEqual([]);
    expect(other.problems).toEqual([]);
  }, 180_000);

  it('THE CIRCLE (P-X01): the sign-in, then the feed of an owner from its tier; an invitation answered, a poll voted once and its results, a note\'s photographs and links; THE CIRCLE in MY PIECES; closed to an account without a piece', async () => {
    const { ctx } = srv;
    const { circle, media } = ctx.services;
    const staff = await ctx.services.auth.createAdmin({ email: 'circle.staff@orbes.test', password: 'orbes circle passphrase 2026', role: 'OPERATOR' }, SYSTEM_ACTOR);
    const actor = { type: 'admin' as const, id: staff.id };
    // A release of a model of its own, published: the note links its page.
    const category = (await ctx.categories.getByCode('J'))!;
    const model = await ctx.db.insertInto('models').values({ category_id: category.index, name: 'HALO', type: 'RING', sku_prefix: 'HAL-CR' }).returning('id').executeTakeFirstOrThrow();
    const drop = await ctx.services.drops.create({ modelId: model.id, title: 'HALO — release I', quantity: 1, opensAt: new Date(Date.now() + 3_600_000), closesAt: new Date(Date.now() + 7_200_000) }, actor);
    await ctx.services.drops.publish(drop.id, actor);
    // Four posts: one kept for PLATINE and up, then a poll, an invitation and a note, published in that order.
    const platine = await circle.create({ kind: 'NOTE', title: 'For PLATINE and up' , minTier: 2 }, actor);
    const poll = await circle.create({ kind: 'POLL', title: 'The next stone', pollOptions: ['Onyx', 'Opal', 'Jade'] }, actor);
    const dinner = await circle.create({ kind: 'INVITATION', title: 'Dinner at the atelier', eventAt: new Date(Date.now() + 7 * 86_400_000), eventPlace: 'Paris', capacity: 12 }, actor);
    const note = await circle.create({ kind: 'NOTE', title: 'The atelier at night', body: 'Twelve hands.\n\nOne ring.', dropId: drop.id, externalUrl: 'https://www.youtube.com/watch?v=orbes' }, actor);
    await media.addCirclePostPhoto(note.id, { mime: 'image/jpeg', bytes: jpegPhoto(600, 400) }, actor);
    await media.addCirclePostPhoto(note.id, { mime: 'image/jpeg', bytes: jpegPhoto(400, 600) }, actor);
    for (const p of [platine, poll, dinner, note]) {
      await circle.publish(p.id, actor);
      await new Promise((r) => setTimeout(r, 5));
    }
    // The owner holds one piece: TITANE.
    const email = 'circle.owner@example.com';
    const owner = await ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    await ownedPiece(owner.account.id);

    const { page, problems } = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    // Opened directly, signed out: the sign-in under its sentence.
    await page.goto(`${srv.origin}/verify/circle`);
    await textOf(page.locator('h1'), 'THE CIRCLE');
    const panel = page.locator('.circle__signin');
    await textOf(panel.locator('.n-own__lead'), CIRCLE.signIn);
    await panel.getByLabel('EMAIL').fill(email);
    await panel.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();

    // The feed: the latest published first, nothing kept for PLATINE; each on its ivory plate with its one text link.
    const cards = page.locator('article.circle-card');
    await textsOf(cards.locator('.circle-card__title'), ['THE ATELIER AT NIGHT', 'DINNER AT THE ATELIER', 'THE NEXT STONE']);
    await textsOf(cards.locator('.circle-card__kind'), ['NOTE', 'INVITATION', 'POLL']);
    await textsOf(cards.locator('.circle-card__link'), ['READ THE NOTE', 'SEE THE INVITATION', 'SEE THE POLL']);
    await textOf(cards.nth(1).locator('.circle-card__event'), /^\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC · PARIS$/);
    await attrOf(cards.first().locator('img.circle-card__img'), 'loading', 'lazy');
    await attrOf(cards.first().locator('.circle-card__link'), 'href', `/verify/circle/${note.id}`);
    expect(await cards.first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).cursor])).toEqual([PLATE, 'auto']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['READ THE NOTE', 'SEE THE INVITATION', 'SEE THE POLL', 'SCAN ORBES CODE', 'THE RELEASES', 'THE COLLECTION', 'MY PIECES', ...LEGAL_LINKS]);
    for (const width of [...PHONE_WIDTHS, MOBILE_VIEWPORT.width]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
      await keepsFloors(page, ['SEE THE INVITATION']);
    }
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: join(OUT_DIR, 'verify-circle.png'), fullPage: true });

    // The invitation: WHEN in UTC then on this phone, WHERE, PLACES; YES, then NO, until the event.
    await cards.nth(1).getByRole('link', { name: 'SEE THE INVITATION' }).click();
    await textOf(page.locator('h1'), 'DINNER AT THE ATELIER');
    expect(new URL(page.url()).pathname).toBe(`/verify/circle/${dinner.id}`);
    await textOf(page.locator('.circle-post__kind'), 'INVITATION');
    await textsOf(page.locator('.circle-post__section > .section-label'), ['THE INVITATION', 'YOUR ANSWER']);
    await textsOf(page.locator('.circle-post__rows .rows__label'), ['WHEN', 'WHERE', 'PLACES']);
    const when = page.locator('.circle-post__rows .rows__row', { hasText: 'WHEN' });
    await textOf(when.locator('.circle-post__utc'), /^\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC$/);
    await textOf(when.locator('.circle-post__local'), /^\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} on this phone \(UTC\+0[12]:00\)$/);
    const places = page.locator('.circle-post__rows .rows__row', { hasText: 'PLACES' }).locator('.rows__value');
    await textOf(places, '12 LEFT OF 12');
    const sentence = page.locator('.circle-post__reply .circle-post__sentence');
    await textOf(sentence, CIRCLE.answer.none);
    await keepsFloors(page, ['YES', 'NO', 'SCAN ORBES CODE', 'THE CIRCLE', ...LEGAL_LINKS]);
    await page.locator('.circle-post__choice').getByRole('button', { name: 'YES' }).click();
    await textOf(sentence, CIRCLE.answer.yes);
    await attrOf(page.locator('.circle-post__choice [data-answer=YES]'), 'aria-pressed', 'true');
    await textOf(places, '11 LEFT OF 12');
    await page.locator('.circle-post__choice').getByRole('button', { name: 'NO' }).click();
    await textOf(sentence, CIRCLE.answer.no);
    await attrOf(page.locator('.circle-post__choice [data-answer=NO]'), 'aria-pressed', 'true');
    await textOf(places, '12 LEFT OF 12');
    expect(await ctx.db.selectFrom('circle_rsvps').select('answer').where('post_id', '=', dinner.id).where('account_id', '=', owner.account.id).execute()).toEqual([{ answer: 'NO' }]);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await page.screenshot({ path: join(OUT_DIR, 'verify-circle-invitation.png'), fullPage: true });
    // Back: the feed, which says the answer.
    await page.goBack();
    await textOf(page.locator('h1'), 'THE CIRCLE');
    await textOf(cards.nth(1).locator('.circle-card__mine'), 'YOU ANSWERED NO');

    // The poll: an option chosen, then VOTE, the page's hairline button while it is offered; once voted, the results.
    await cards.nth(2).getByRole('link', { name: 'SEE THE POLL' }).click();
    await textOf(page.locator('h1'), 'THE NEXT STONE');
    await textOf(page.locator('.circle-post__poll .circle-post__sentence'), CIRCLE.pollLead);
    const vote = page.getByRole('button', { name: 'VOTE', exact: true });
    await expect.poll(() => vote.isDisabled(), POLL).toBe(true);
    await attrOf(page.locator('.circle-post__foot .circle-post__scan'), 'class', /\btextlink\b/);
    await keepsFloors(page, ['ONYX', 'OPAL', 'JADE', 'VOTE', 'SCAN ORBES CODE', 'THE CIRCLE']);
    await page.locator('.circle-post__options').getByRole('button', { name: 'OPAL' }).click();
    await attrOf(page.locator('.circle-post__options [data-option="1"]'), 'aria-pressed', 'true');
    await vote.click();
    await textOf(page.locator('.circle-post__poll .circle-post__sentence'), CIRCLE.pollVoted);
    await textsOf(page.locator('.circle-post__result-label'), ['ONYX', 'OPAL', 'JADE']);
    await textsOf(page.locator('.circle-post__result-votes'), ['0 VOTES · 0%', '1 VOTE · 100%', '0 VOTES · 0%']);
    await textOf(page.locator('.circle-post__result.is-mine .circle-post__result-mine'), 'YOUR VOTE');
    await countOf(page.getByRole('button', { name: 'VOTE', exact: true }), 0);
    await attrOf(page.locator('.circle-post__foot .circle-post__scan'), 'class', /\bbtn\b/);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await page.goBack();
    await textOf(cards.nth(2).locator('.circle-card__mine'), 'YOU VOTED');

    // The note: its photographs (the first loaded at once), its paragraphs, its links.
    await cards.first().getByRole('link', { name: 'READ THE NOTE' }).click();
    await textOf(page.locator('h1'), 'THE ATELIER AT NIGHT');
    const photos = page.getByRole('region', { name: 'Photographs of THE ATELIER AT NIGHT' });
    await expect.poll(() => photos.locator('img').evaluateAll((els) => els.map((el) => [(el as HTMLImageElement).getAttribute('loading'), (el as HTMLImageElement).naturalWidth])), POLL).toEqual([
      ['eager', 600],
      ['lazy', 400],
    ]);
    await attrOf(photos.locator('img').first(), 'alt', 'THE ATELIER AT NIGHT, photographed by ORBES');
    await textsOf(page.locator('.circle-post__paragraph'), ['Twelve hands.', 'One ring.']);
    await textsOf(page.locator('.circle-post__link-title'), ['HALO — RELEASE I']);
    await attrOf(page.locator('.circle-post__links').getByRole('link', { name: 'SEE THE RELEASE' }), 'href', `/verify/releases/${drop.id}`);
    const film = page.locator('.circle-post__external');
    await attrOf(film, 'href', 'https://www.youtube.com/watch?v=orbes');
    await attrOf(film, 'target', '_blank');
    await attrOf(film, 'rel', 'noopener noreferrer');
    await attrOf(film, 'aria-label', 'Open the link on youtube.com, in a new tab');
    await textOf(page.locator('.circle-post__host'), 'youtube.com');
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await keepsFloors(page, ['SEE THE RELEASE', 'OPEN THE LINK', 'SCAN ORBES CODE', 'THE CIRCLE', ...LEGAL_LINKS]);
    await page.screenshot({ path: join(OUT_DIR, 'verify-circle-note.png'), fullPage: true });
    // SEE THE RELEASE: its page over the releases' list; back through the list to the note.
    await page.locator('.circle-post__links').getByRole('link', { name: 'SEE THE RELEASE' }).click();
    await textOf(page.locator('h1'), 'HALO — RELEASE I');
    await page.goBack();
    await textOf(page.locator('h1'), 'THE RELEASES');
    await page.goBack();
    await textOf(page.locator('h1'), 'THE ATELIER AT NIGHT');
    // The foot's THE CIRCLE: back to the feed, then the landing.
    await page.locator('.circle-post__foot').getByRole('link', { name: 'THE CIRCLE' }).click();
    await textOf(page.locator('h1'), 'THE CIRCLE');
    expect(new URL(page.url()).pathname).toBe('/verify/circle');
    await page.goBack();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/verify');

    // MY PIECES: THE CIRCLE, for an owner, at the foot.
    await page.goto(`${srv.origin}/verify/pieces`);
    const link = page.locator('.pieces__foot').getByRole('link', { name: 'THE CIRCLE' });
    await visible(link);
    await attrOf(link, 'href', '/verify/circle');
    await link.click();
    await textOf(page.locator('h1'), 'THE CIRCLE');
    // An address under /verify/circle that is none: the feed, its address put back; a post kept for PLATINE: not in the circle.
    await page.goto(`${srv.origin}/verify/circle/nowhere`);
    await textOf(page.locator('h1'), 'THE CIRCLE');
    expect(new URL(page.url()).pathname).toBe('/verify/circle');
    await page.goto(`${srv.origin}/verify/circle/${platine.id}`);
    await textOf(page.locator('.circle-post__missing'), CIRCLE.notFound);
    // A longer feed: twenty posts at a time, then SHOW MORE for the next ones.
    for (let i = 1; i <= 18; i++) await circle.publish((await circle.create({ kind: 'NOTE', title: `Note ${i}` }, actor)).id, actor);
    await page.goto(`${srv.origin}/verify/circle`);
    await countOf(cards, 20);
    const more = page.getByRole('button', { name: 'SHOW MORE' });
    await visible(more);
    await keepsFloors(page, ['SHOW MORE', 'SCAN ORBES CODE']);
    await more.click();
    await countOf(cards, 21);
    await textOf(cards.last().locator('.circle-card__title'), 'THE NEXT STONE');
    await countOf(page.getByRole('button', { name: 'SHOW MORE' }), 0);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    expect(problems).toEqual([]);

    // An account that holds no piece: the circle says it opens once a piece is registered; MY PIECES shows no link to it.
    const stranger = 'circle.stranger@example.com';
    await ctx.services.auth.registerAccount({ email: stranger, password: PASSWORD }, {});
    const other = await openVerify(browser, srv, { reducedMotion: 'reduce' });
    await other.page.goto(`${srv.origin}/verify/circle`);
    const signIn = other.page.locator('.circle__signin');
    await signIn.getByLabel('EMAIL').fill(stranger);
    await signIn.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
    await signIn.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await textOf(other.page.locator('.circle__closed'), CIRCLE.ownersOnly);
    await other.page.goto(`${srv.origin}/verify/pieces`);
    await visible(other.page.locator('.pieces__empty'));
    await countOf(other.page.locator('.pieces__foot').getByRole('link', { name: 'THE CIRCLE' }), 0);
    expect(other.problems).toEqual([]);
  }, 180_000);

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
    // The device has no camera whatever the machine running the test has: getUserMedia answers as a browser does then.
    await page.addInitScript(() => {
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
    });
    await page.reload();
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
    await recordSound(page);
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).click();
    await page.locator('.view--scan').waitFor();
    // The status line is a polite live region.
    await attrOf(page.getByRole('status'), 'aria-live', 'polite');
    await page.locator('.view--scan.is-locked').waitFor({ timeout: 30_000 });
    await textOf(page.getByRole('status'), /ORBES CODE FOUND|VERIFYING…/);
    await page.screenshot({ path: join(OUT_DIR, 'verify-scan-locked.png') });
    expect(await resultTitle(page)).toBe('AUTHENTIC');
    await textOf(page.locator('.n-result__genome .n-gen__id'), issued.product.productId);
    // The sound signature (P-D07): its AudioContext created in the tap SCAN ORBES CODE, the chord as the result appeared.
    await expect.poll(() => soundOf(page), POLL).toEqual({ contexts: [{ activeTap: true, session: 'ambient' }], notes: CHORD });
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

/**
 * A decoder worker that stands in for the real one (P-D10): it answers the warm-up and every frame as a failed read,
 * the first SEALED camera frames with a confident seal (NO_MOONS, confidence 0.9), then with nothing code-like.
 */
const SEALED_FRAMES = 24;
const SEALING_WORKER = `
let frames = 0;
self.addEventListener('message', (ev) => {
  const m = ev.data;
  const camera = m.options && m.options.tryInverted === true;
  const sealed = camera && frames++ < ${SEALED_FRAMES};
  const reply = sealed
    ? { type: 'result', id: m.id, ok: false, reason: 'NO_MOONS', seal: { confidence: 0.9, unitPx: 5 }, timing: { grayMs: 0, decodeMs: 1, totalMs: 1 } }
    : { type: 'result', id: m.id, ok: false, reason: 'NO_SEAL', timing: { grayMs: 0, decodeMs: 1, totalMs: 1 } };
  self.postMessage(reply);
});
self.postMessage({ type: 'ready' });
`;

describe.skipIf(!HAS_CHROMIUM)('verify web app: the scan as a ritual (P-D10)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let issued: IssueResult;

  beforeAll(async () => {
    srv = await startVerifyServer();
    issued = await srv.issue({ serial: 210 });
    browser = await launchChromium({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** The scanner on a decoder that sees a seal for SEALED_FRAMES frames: each --seal-scale written, with its time. */
  async function scanWithSeal(reducedMotion: 'reduce' | 'no-preference'): Promise<{ page: Page; problems: string[]; writes: () => Promise<{ t: number; value: string }[]> }> {
    const { page, problems } = await openVerify(browser, srv, { reducedMotion });
    await page.route(/\/assets\/verify-worker-[A-Z0-9]{8}\.js$/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: SEALING_WORKER }));
    // The worker started on the landing is the real one: a reload starts the stand-in.
    await page.reload();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    await page.evaluate(() => {
      const w = window as unknown as { __seal: { t: number; value: string }[] };
      w.__seal = [];
      const set = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, name: string, value: string | null, priority?: string) {
        if (name === '--seal-scale') w.__seal.push({ t: performance.now(), value: String(value) });
        return set.call(this, name, value, priority);
      };
    });
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).click();
    await page.locator('.view--scan.is-ready').waitFor();
    return { page, problems, writes: () => page.evaluate(() => (window as unknown as { __seal: { t: number; value: string }[] }).__seal) };
  }

  it('tightens the ring around the centre while a seal is seen, at most 4 times a second, then loosens back to the search', async () => {
    const { page, problems, writes } = await scanWithSeal('no-preference');
    // Searching: the sweep turns, the ring at rest.
    const ring = page.locator('.view--scan .n-cam__ring');
    // Seal seen: .is-sealed, the sweep gone, the ring scaled about the orbit's centre (0.95 − 0.07 × 0.8 = 0.894).
    await page.locator('.view--scan.is-sealed').waitFor({ timeout: 10_000 });
    await expect.poll(() => ring.evaluate((el) => getComputedStyle(el).transform), POLL).toBe('matrix(0.894, 0, 0, 0.894, 0, 0)');
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('n-cam-breathe');
    expect(await page.locator('.view--scan .n-cam__sweep').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    // The ring keeps its centre: the orbit's, where C11 sets it (46.445 % of the screen's height, 392 px of 844).
    const box = (await ring.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - MOBILE_VIEWPORT.width / 2)).toBeLessThan(1.5);
    expect(Math.abs(box.y + box.height / 2 - MOBILE_VIEWPORT.height * 0.46445)).toBeLessThan(1.5);
    await page.screenshot({ path: join(OUT_DIR, 'verify-scan-sealed.png') });
    // The decoder stops seeing it: the ring loosens back to the search within SEAL_HOLD_MS, the sweep turning again.
    await expect.poll(() => page.locator('.view--scan.is-sealed').count(), { timeout: 10_000, interval: 50 }).toBe(0);
    await expect.poll(() => ring.evaluate((el) => getComputedStyle(el).transform), POLL).toBe('none');
    await expect.poll(() => page.locator('.view--scan .n-cam__sweep').evaluate((el) => getComputedStyle(el).opacity), POLL).toBe('1');
    // The signal reached the view at most 4 times a second (each one writes the scale), and the scan's screen and
    // controls are as they were: no lock, the status, CLOSE and UPLOAD A PHOTO.
    const seen = await writes();
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen.map((w) => w.value))).toEqual(new Set(['0.894']));
    for (let i = 1; i < seen.length; i++) expect(seen[i].t - seen[i - 1].t).toBeGreaterThanOrEqual(240);
    expect(await page.locator('.view--scan.is-locked').count()).toBe(0);
    expect(await page.evaluate(() => document.body.dataset.screen)).toBe('scan');
    await textOf(page.getByRole('status'), 'SCANNING…');
    await page.getByRole('button', { name: 'CLOSE' }).click();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(problems).toEqual([]);
  }, 120_000);

  it('only steadies the ring when motion is reduced: no tightening, no breathing', async () => {
    const { page, problems } = await scanWithSeal('reduce');
    await page.locator('.view--scan.is-sealed').waitFor({ timeout: 10_000 });
    const ring = page.locator('.view--scan .n-cam__ring');
    expect(await ring.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await ring.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.getByRole('button', { name: 'CLOSE' }).click();
    await page.getByRole('button', { name: 'SCAN ORBES CODE' }).waitFor();
    expect(problems).toEqual([]);
  }, 120_000);

  it('takes the ring up on VERIFYING…, then opens the GENOME plate from its centre', async () => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const { page, problems } = await openVerify(browser, srv, { reducedMotion });
      // The server answers after 2.5 s, so VERIFYING… stays on screen long enough to be looked at.
      await page.route('**/api/v1/verify', async (route) => {
        await new Promise((r) => setTimeout(r, 2_500));
        await route.fallback();
      });
      await uploadPhoto(page, writeCodePng(srv.workDir, `ritual-${reducedMotion}.png`, issued));
      await page.locator('.view--verifying').waitFor();
      await textOf(page.getByRole('status'), 'VERIFYING…');
      // Once the screen has come in (its own fade and rise, not a transition from the screen before).
      await expect.poll(() => page.locator('.view--verifying').evaluate((el) => el.getAnimations().every((a) => a.playState === 'finished')), POLL).toBe(true);
      // The scanner's orbit, at the scanner's size (272 px, C11) and in its place, closed on its four moons, its ring
      // 2 px (C12), the arc travelling (with motion).
      const orbit = page.locator('.view--verifying .n-cam__orbit');
      await countOf(orbit.locator('.n-cam__moon'), 4);
      const ring = (await orbit.locator('.n-cam__ring').boundingBox())!;
      expect(Math.abs(ring.width - 272)).toBeLessThan(1);
      expect(Math.abs(ring.x + ring.width / 2 - MOBILE_VIEWPORT.width / 2)).toBeLessThan(1.5);
      expect(Math.abs(ring.y + ring.height / 2 - MOBILE_VIEWPORT.height * 0.46445)).toBeLessThan(1.5);
      expect(await orbit.locator('.n-cam__ring').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('rgba(246, 242, 234, 0.95) 0px 0px 0px 2px');
      expect(await orbit.locator('.n-cam__sweep').evaluate((el) => getComputedStyle(el).animationName)).toBe(reducedMotion === 'reduce' ? 'none' : 'n-cam-orbit');
      if (reducedMotion === 'no-preference') await page.screenshot({ path: join(OUT_DIR, 'verify-verifying-ring.png') });
      expect(await resultTitle(page)).toBe('AUTHENTIC');
      // The GENOME opens from its centre (a widening circle) with motion; without, it is simply there.
      const plate = page.locator('.view--result .n-result__genome');
      expect(await plate.evaluate((el) => getComputedStyle(el).animationName)).toBe(reducedMotion === 'reduce' ? 'none' : 'genome-open');
      if (reducedMotion === 'no-preference') {
        await expect.poll(() => plate.evaluate((el) => el.getAnimations().every((a) => a.playState === 'finished')), POLL).toBe(true);
        expect(await plate.evaluate((el) => getComputedStyle(el).clipPath)).toBe('circle(75% at 50% 50%)');
      }
      // Nothing of it is left hidden: its label, its figure and the GENOME's id are seen whole.
      await expect.poll(() => plate.evaluate((el) => getComputedStyle(el).opacity), POLL).toBe('1');
      for (const part of ['.n-gen__label', '.n-gen__figure', '.n-gen__fp']) await visible(plate.locator(part));
      await textOf(page.locator('.n-result__genome .n-gen__id'), issued.product.productId);
      expect(problems).toEqual([]);
      await page.context().close();
    }
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
    await textOf(page.locator('.n-message__text'), /allow camera access/);
    await visible(page.getByRole('button', { name: 'UPLOAD A PHOTO' }));
    await visible(page.getByRole('button', { name: 'SCAN AGAIN' }));
    expect(problems).toEqual([]);
  }, 120_000);
});
