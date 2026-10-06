/**
 * End-to-end: the legal pages (J-06), built and served by the real server
 * (the harness of the verification app, which builds every app), in
 * Chromium at a phone viewport: the language chosen by ?lang=, then the
 * browser's, and said in <html lang>; the switch that keeps the page and its
 * section; the links between the pages that keep the language; the index
 * and an unknown path put back to /legal; the four pages with no field to
 * complete in sight; the display face for titles and labels in both
 * languages (its subset carries the accented capitals), the reading face for
 * figures and text; the contact of ORBES Client Services when
 * the server publishes one, and none otherwise; the floors of §3.8 on every
 * control (the links inside a sentence aside); the print view; since NOCTURNE (step N8) the app's ground, header,
 * rail and footer, every section open, the reading measure.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync } from 'node:fs';
import type { Browser, ConsoleMessage, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOCUMENTS } from '../../src/web/legal/content/index.js';
import { RESALE_GUIDANCE } from '../../src/web/verify/copy.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { CHROMIUM_PATH, launchChromium, MOBILE_VIEWPORT, startVerifyServer, type VerifyServer } from './verify.harness.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const CLIENT_SERVICES = { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' };
const POLL = { timeout: 15_000, interval: 100 };
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}
const family = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).fontFamily);

interface Opened {
  page: Page;
  problems: string[];
}

describe.skipIf(!HAS_CHROMIUM)('legal pages (Chromium, mobile)', () => {
  let srv: VerifyServer;
  let browser: Browser;

  beforeAll(async () => {
    srv = await startVerifyServer({ clientServices: CLIENT_SERVICES });
    browser = await launchChromium();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** A phone whose browser speaks `locale`, on `path`; console errors and CSP reports collected. */
  async function open(path: string, locale = 'en-GB'): Promise<Opened> {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const res = await page.goto(`${srv.origin}${path}`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()['cache-control']).toBe('no-cache');
    expect(res?.headers()['content-security-policy']).toMatch(/^default-src 'self'/);
    await page.locator('main.legal h1').waitFor();
    await page.evaluate(() => document.fonts.ready);
    return { page, problems };
  }

  const langOf = (page: Page) => page.evaluate(() => document.documentElement.lang);

  it('chooses the language by ?lang=, then by the browser, and says it in <html lang>', async () => {
    for (const [path, locale, lang, title] of [
      ['/legal/privacy', 'en-GB', 'en', 'PRIVACY POLICY'],
      ['/legal/privacy', 'fr-FR', 'fr', 'POLITIQUE DE CONFIDENTIALITÉ'],
      ['/legal/privacy?lang=en', 'fr-FR', 'en', 'PRIVACY POLICY'],
      ['/legal/privacy?lang=fr', 'en-GB', 'fr', 'POLITIQUE DE CONFIDENTIALITÉ'],
      ['/legal/privacy', 'de-DE', 'en', 'PRIVACY POLICY'],
    ] as const) {
      const { page, problems } = await open(path, locale);
      expect(await langOf(page), `${path} ${locale}`).toBe(lang);
      await textOf(page.locator('h1'), title);
      expect(await page.title()).toBe(`${DOCUMENTS.privacy[lang].title} — ORBES`);
      await textOf(page.locator('.legal__version'), lang === 'en' ? /^Version of \d{1,2} [A-Z][a-z]+ \d{4}$/ : /^Version du \d{1,2}(er)? [a-zéû]+ \d{4}$/);
      expect(problems).toEqual([]);
      await page.context().close();
    }
  }, 120_000);

  it('switches the language on the same page and section, and keeps it from page to page', async () => {
    const { page, problems } = await open('/legal/faq#transfer');
    await expect.poll(() => page.evaluate(() => document.getElementById('transfer')!.getBoundingClientRect().top), POLL).toBeLessThan(80);
    const current = page.getByRole('navigation', { name: 'Legal pages' }).locator('[aria-current="page"]');
    await textOf(current, 'HELP');
    // Each language is named in its own words.
    const french = page.getByRole('navigation', { name: 'Language' }).getByRole('link', { name: 'FRANÇAIS' });
    expect(await french.getAttribute('lang')).toBe('fr');
    expect(await french.getAttribute('href')).toBe('/legal/faq?lang=fr#transfer');
    await french.click();
    await page.waitForURL(`${srv.origin}/legal/faq?lang=fr#transfer`);
    await textOf(page.locator('h1'), 'QUESTIONS FRÉQUENTES');
    expect(await langOf(page)).toBe('fr');
    await textOf(page.locator('#transfer'), 'COMMENT TRANSMETTRE UNE PIÈCE ?');
    // From page to page, the language stays.
    await page.getByRole('navigation', { name: 'Pages légales' }).getByRole('link', { name: 'CONDITIONS' }).click();
    await page.waitForURL(`${srv.origin}/legal/terms?lang=fr`);
    expect(await langOf(page)).toBe('fr');
    await textOf(page.locator('h1'), "CONDITIONS GÉNÉRALES D'UTILISATION");
    // A link inside a sentence too: the legal notice, from article 1.
    await page.locator('#article-1').locator('xpath=..').getByRole('link', { name: 'mentions légales' }).click();
    await page.waitForURL(`${srv.origin}/legal/notice?lang=fr`);
    await textOf(page.locator('h1'), 'MENTIONS LÉGALES');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('keeps the section the reader has moved to: a link inside the page moves the switch along', async () => {
    const { page, problems } = await open('/legal/privacy?lang=en');
    const french = page.getByRole('navigation', { name: 'Language' }).getByRole('link', { name: 'FRANÇAIS' });
    expect(await french.getAttribute('href')).toBe('/legal/privacy?lang=fr');
    // "see Cookies", in the list of what a verification records.
    await page.locator('#verification').locator('xpath=..').getByRole('link', { name: 'Cookies', exact: true }).click();
    await page.waitForURL(`${srv.origin}/legal/privacy?lang=en#cookies`);
    await expect.poll(() => french.getAttribute('href'), POLL).toBe('/legal/privacy?lang=fr#cookies');
    await french.click();
    await page.waitForURL(`${srv.origin}/legal/privacy?lang=fr#cookies`);
    expect(await langOf(page)).toBe('fr');
    await textOf(page.locator('#cookies'), 'COOKIES');
    await expect.poll(() => page.evaluate(() => document.getElementById('cookies')!.getBoundingClientRect().top), POLL).toBeLessThan(80);
    // And back: ENGLISH follows the address too.
    const english = page.getByRole('navigation', { name: 'Langue' }).getByRole('link', { name: 'ENGLISH' });
    expect(await english.getAttribute('href')).toBe('/legal/privacy?lang=en#cookies');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it("links the terms' cross-references to their articles, as C23 draws them, in both languages", async () => {
    for (const lang of ['en', 'fr'] as const) {
      const { page, problems } = await open(`/legal/terms?lang=${lang}`);
      const article = (n: number) => page.locator(`#article-${n}`).locator('xpath=..');
      // Article 1: "MY PIECES also presents ORBES Care (article 11)"; article 13: "the owners from a tier (article 12)".
      const care = article(1).locator('a[href="#article-11"]');
      await textOf(care, 'article 11');
      expect(await care.getAttribute('class')).toMatch(/\bn-ivc\b.*\bn-u\b/);
      // Held whole on its line: the word never ends a line without its figure.
      expect(await care.evaluate((a) => getComputedStyle(a).whiteSpace)).toBe('nowrap');
      expect(await care.evaluate((a) => a.getClientRects().length)).toBe(1);
      await textOf(article(13).locator('a[href="#article-12"]').first(), 'article 12');
      // A reference to an article the document does not have stays plain text; the text itself is unchanged.
      expect(await page.locator('a[href^="#article-"]').evaluateAll((as) => as.every((a) => document.getElementById(a.getAttribute('href')!.slice(1)) !== null))).toBe(true);
      await care.click();
      await page.waitForURL(`${srv.origin}/legal/terms?lang=${lang}#article-11`);
      await expect.poll(() => page.evaluate(() => document.getElementById('article-11')!.getBoundingClientRect().top), POLL).toBeLessThan(80);
      expect(problems).toEqual([]);
      await page.context().close();
    }
  }, 120_000);

  it('shows the four pages from their index, and the index for any other path, its address put back to /legal', async () => {
    const { page, problems } = await open('/legal/cookies?lang=en');
    expect(new URL(page.url()).pathname).toBe('/legal');
    expect(new URL(page.url()).search).toBe('?lang=en');
    await textOf(page.locator('h1'), 'LEGAL INFORMATION');
    const items = page.locator('.legal-index__link');
    await expect.poll(() => items.locator('.legal-index__title').allInnerTexts(), POLL).toEqual(['PRIVACY POLICY', 'TERMS OF USE', 'LEGAL NOTICE', 'FREQUENTLY ASKED QUESTIONS']);
    expect(await items.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual([
      '/legal/privacy?lang=en',
      '/legal/terms?lang=en',
      '/legal/notice?lang=en',
      '/legal/faq?lang=en',
    ]);
    for (const page_ of ['privacy', 'terms', 'notice', 'faq'] as const) {
      for (const lang of ['en', 'fr'] as const) {
        await page.goto(`${srv.origin}/legal/${page_}?lang=${lang}`);
        await page.locator('main.legal h1').waitFor();
        expect(await page.locator('main.legal section').count(), `${page_}.${lang}`).toBe(DOCUMENTS[page_][lang].sections.length);
        const text = await page.locator('main.legal').innerText();
        // No field to complete in sight: the company reads ORBES.
        expect(text, `${page_}.${lang}`).not.toMatch(/COMPLÉTER|\[|\]|\*\*/);
      }
    }
    // The legal notice names the publisher ORBES; the FAQ answers a buyer with the sentence /verify shows.
    await page.goto(`${srv.origin}/legal/notice?lang=en`);
    await textOf(page.locator('#publisher').locator('xpath=..').locator('.legal__item').first(), 'Company name: CONGLOMERAT LLC');
    await page.goto(`${srv.origin}/legal/faq?lang=en`);
    await textOf(page.locator('#second-hand').locator('xpath=..').locator('.legal__text').first(), RESALE_GUIDANCE);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('stands on NOCTURNE\'s ground with the app\'s header, rail and footer, every section open, its text at the reading measure (C23, C41)', async () => {
    const { page, problems } = await open('/legal/terms?lang=en');
    // The ground and the column (choice 5), Safari's bars in ink (addition 13).
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(10, 10, 10)');
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#0a0a0a');
    // The header: ORBES, and VERIFY A PIECE back to the app.
    await textOf(page.locator('.legal-head .n-wm'), 'ORBES');
    expect(await page.locator('.legal-head').getByRole('link', { name: 'VERIFY A PIECE' }).getAttribute('href')).toBe('/verify');
    // The rail: the app's five chapters, each into /verify, none current here; RELEASES' dot only when a release is announced.
    const rail = page.getByRole('navigation', { name: 'Main' });
    expect(await rail.getByRole('link').evaluateAll((els) => els.map((el) => [el.textContent, el.getAttribute('href'), el.getAttribute('aria-current')]))).toEqual([
      ['NOW', '/verify', null],
      ['RELEASES', '/verify/releases', null],
      ['COLLECTION', '/verify/lookbook', null],
      ['CIRCLE', '/verify/circle', null],
      ['PIECES', '/verify/pieces', null],
    ]);
    expect(await rail.locator('.n-rail__live').isVisible()).toBe(false);
    expect(await rail.getAttribute('lang')).toBeNull();
    // The four pages as underlined tabs, TERMS current; the version, then ENGLISH (current, ivory) · FRANÇAIS.
    await textOf(page.getByRole('navigation', { name: 'Legal pages' }).locator('[aria-current="page"]'), 'TERMS');
    await textOf(page.locator('.legal-meta .legal__version'), /^Version of /);
    expect(await page.getByRole('navigation', { name: 'Language' }).getByRole('link', { name: 'ENGLISH' }).evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).textDecorationLine])).toEqual(['rgb(246, 242, 234)', 'underline']);
    // Every section open, each heading with its text under it; the text 16/1.65 at most 34 em (about 68 characters).
    expect(await page.locator('.legal__section').count()).toBe(DOCUMENTS.terms.en.sections.length);
    expect(await page.locator('.legal__section button, .legal__section [aria-expanded]').count()).toBe(0);
    const text = page.locator('.legal__text').first();
    expect(await text.evaluate((el) => { const cs = getComputedStyle(el); return [cs.fontSize, cs.lineHeight, cs.maxWidth, cs.color]; })).toEqual(['16px', '26.4px', '544px', 'rgb(167, 162, 154)']);
    // The footer: the four pages, VERIFY A PIECE, DB-IP, © ORBES · GENOME CODE · PARIS (in ash); no SCAN ring here.
    const foot = page.locator('.legal-foot');
    expect(await foot.getByRole('navigation', { name: 'Legal information' }).getByRole('link').allInnerTexts()).toEqual(['PRIVACY', 'TERMS', 'LEGAL', 'HELP']);
    expect(await foot.getByRole('link', { name: 'VERIFY A PIECE' }).getAttribute('href')).toBe('/verify');
    await textOf(foot.locator('.legal-foot__meta'), '© ORBES · GENOME CODE · PARIS');
    expect(await foot.locator('.legal-foot__meta').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(167, 162, 154)');
    expect(await page.locator('.n-scan').count()).toBe(0);
    // In French, the four pages wrap on a phone and nothing scrolls sideways.
    await page.goto(`${srv.origin}/legal/terms?lang=fr`);
    await page.locator('main.legal h1').waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
    }
    // The rail's words are the app's, in English, and a French page says so.
    expect(await page.getByRole('navigation', { name: 'Main' }).getAttribute('lang')).toBe('en');
    expect(problems).toEqual([]);
    // RELEASES' dot is read from each public route on its own: a release announced shows it though the draws fail.
    await page.route('**/api/v1/live/next', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: { id: 'announced' } }) }));
    await page.route('**/api/v1/drops', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.reload();
    await page.getByRole('navigation', { name: 'Main' }).locator('.n-rail__live').waitFor({ state: 'visible' });
    // The dot is said to a screen reader: RELEASES LIVE (its word visually hidden).
    expect(await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'RELEASES LIVE', exact: true }).count()).toBe(1);
    // The one problem is the draws' refusal itself, as the browser reports it.
    for (const p of problems) expect(p).toMatch(/status of 503/);
    await page.context().close();
  }, 120_000);

  it('sets titles and labels in Gravesend Sans in both languages, every figure and what is read in Helvetica Neue', async () => {
    const { page, problems } = await open('/legal/terms?lang=en');
    const gravesend = /^"?Gravesend Sans"?/;
    const helvetica = /^"?Helvetica Neue"?/;
    expect(await family(page.locator('h1'))).toMatch(gravesend);
    expect(await family(page.locator('#article-8'))).toMatch(gravesend);
    expect(await family(page.locator('#article-8 .legal__figure'))).toMatch(helvetica);
    expect(await family(page.locator('.legal__text').first())).toMatch(helvetica);
    expect(await family(page.locator('.legal__version'))).toMatch(helvetica);
    expect(await family(page.getByRole('navigation', { name: 'Legal pages' }).getByRole('link', { name: 'TERMS' }))).toMatch(gravesend);
    // FRANÇAIS too, on the English page: its Ç is in the subset.
    expect(await family(page.getByRole('link', { name: 'FRANÇAIS' }))).toMatch(gravesend);
    // No visible display text holds a one or a zero (Gravesend's one is its capital I).
    const displayFigures = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
          .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
          .filter((t) => /[0-9]/.test(t)),
      );
    expect(await displayFigures()).toEqual([]);
    await page.goto(`${srv.origin}/legal/terms?lang=fr`);
    await page.locator('main.legal h1').waitFor();
    await page.evaluate(() => document.fonts.ready);
    expect(await family(page.locator('h1'))).toMatch(gravesend);
    expect(await family(page.locator('#article-8'))).toMatch(gravesend);
    expect(await family(page.locator('#article-8 .legal__figure'))).toMatch(helvetica);
    expect(await family(page.getByRole('navigation', { name: 'Pages légales' }).getByRole('link', { name: 'MENTIONS LÉGALES', exact: true }))).toMatch(gravesend);
    expect(await family(page.locator('.legal-head .n-wm'))).toMatch(gravesend);
    expect(await family(page.getByRole('link', { name: 'ENGLISH' }))).toMatch(gravesend);
    expect(await family(page.locator('.legal__text').first())).toMatch(helvetica);
    expect(await displayFigures()).toEqual([]);
    // Every letter of the French titles and labels is drawn by Gravesend itself, not by the fallback, glyph by glyph:
    // the face that covers them is the one file, already loaded.
    const uncovered = await page.evaluate(async () => {
      const shown = [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join(''))
        .join('')
        .toUpperCase();
      const letters = [...new Set(shown.replace(/[^\p{L}«»]/gu, ''))];
      const out: string[] = [];
      for (const ch of letters) if ((await document.fonts.load('500 16px "Gravesend Sans"', ch)).length === 0) out.push(ch);
      return { out, letters: letters.join('') };
    });
    expect(uncovered.letters).toMatch(/É/);
    expect(uncovered.out).toEqual([]);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('shows the contact of ORBES Client Services the server publishes, and nothing when there is none', async () => {
    const { page, problems } = await open('/legal/notice?lang=en');
    const contact = page.locator('.legal__contact');
    await expect.poll(() => contact.isVisible(), POLL).toBe(true);
    expect(await contact.getByRole('link', { name: `Write to ORBES Client Services: ${CLIENT_SERVICES.email}` }).getAttribute('href')).toBe(`mailto:${CLIENT_SERVICES.email}`);
    expect(await contact.getByRole('link', { name: `Call ORBES Client Services: ${CLIENT_SERVICES.phone}` }).getAttribute('href')).toBe('tel:+33123456789');
    await textOf(contact.locator('.legal__contact-hours'), CLIENT_SERVICES.hours);
    // Nothing configured: no contact, and no empty place.
    await page.route('**/api/v1/client-services', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`${srv.origin}/legal/privacy?lang=en`);
    await page.locator('main.legal h1').waitFor();
    await page.waitForTimeout(300);
    expect(await page.locator('.legal__contact').isVisible()).toBe(false);
    expect(await page.locator('.legal__contact a').count()).toBe(0);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('keeps the floors of §3.8 on every control at every phone width, the links inside a sentence aside', async () => {
    const { page, problems } = await open('/legal/terms?lang=fr');
    for (const path of ['/legal/terms?lang=fr', '/legal/privacy?lang=en', '/legal/notice?lang=fr', '/legal?lang=en', '/legal/faq?lang=fr']) {
      await page.goto(`${srv.origin}${path}`);
      await page.locator('main.legal h1').waitFor();
      for (const width of [390, 375, 360, 320]) {
        await page.setViewportSize({ width, height: MOBILE_VIEWPORT.height });
        const { checked, problems: floors } = await tapZoneFloors(page, { skip: '.legal__link' });
        expect(floors, `${path} at ${width}`).toEqual([]);
        expect(checked.length, path).toBeGreaterThanOrEqual(8);
      }
      await page.setViewportSize(MOBILE_VIEWPORT);
    }
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('prints the text alone: no header, rail or navigation, the address of a link outside the site after it', async () => {
    const { page, problems } = await open('/legal/notice?lang=en');
    await page.emulateMedia({ media: 'print' });
    for (const sel of ['.legal-head', '.legal-rail', '.legal-pages', '.legal-lang', '.legal-foot__pages', '.legal-foot__link']) {
      expect(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).display), sel).toBe('none');
    }
    const dbip = page.locator('#credits').locator('xpath=..').getByRole('link', { name: 'IP Geolocation by DB-IP' });
    expect(await dbip.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('" (https://db-ip.com)"');
    expect(await page.locator('h1').isVisible()).toBe(true);
    // A real PDF of the page: the text is there.
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);
});
