/**
 * The light mode on the real screens (src/web/shared/light.css, the owner's choice of 2026-10-14: GALLERY WHITE ·
 * SOFT): LIGHT MODE in YOUR ACCOUNT, under SOUND, off by default; turned on, the NOCTURNE screens stand on white with
 * NOCTURNE's ground as their ink, the choice is kept on the device, Safari's bars follow, and a page opened again is
 * light before the app's own script has run; the legal pages follow; turned off, nothing is left. Its values are
 * light.css's own, as Chromium computes them.
 */
import { existsSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, stateById } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const WHITE = 'rgb(255, 255, 255)';
const INK = 'rgb(10, 10, 10)';
const IVORY = 'rgb(246, 242, 234)';
const NONE = 'rgba(0, 0, 0, 0)';

/** What the page shows of the mode: the root's attribute, the grounds, the ink, the bar's colour, the key kept. */
function shown(page: Page): Promise<{ mode: string | null; html: string; body: string; ink: string; bar: string | null; kept: string | null }> {
  return page.evaluate(() => ({
    mode: document.documentElement.getAttribute('data-mode'),
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color,
    bar: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    kept: localStorage.getItem('orbes.mode'),
  }));
}

const style = (page: Page, selector: string, prop: string, pseudo?: string) =>
  page.evaluate(({ selector, prop, pseudo }) => getComputedStyle(document.querySelector(selector)!, pseudo ?? null).getPropertyValue(prop), { selector, prop, pseudo });

describe.skipIf(!HAS_CHROMIUM)('the light mode: LIGHT MODE in YOUR ACCOUNT (GALLERY WHITE · SOFT, Chromium)', () => {
  it(
    'is off by default; on, the NOCTURNE screens turn white and the choice stays on the device, before the first paint of the next page and on the legal pages; off, nothing is left',
    async () => {
      let ran = false;
      await eachState(
        [stateById('account-sheet')],
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          const page = opened.page;
          try {
            const sheet = page.locator('.n-account__panel:not(.n-write__panel)');
            const sw = sheet.getByRole('switch', { name: 'LIGHT MODE' });
            // The default: NOCTURNE's dark, nothing kept.
            expect(await sw.isChecked()).toBe(false);
            expect(await shown(page)).toEqual({ mode: null, html: INK, body: INK, ink: IVORY, bar: '#0a0a0a', kept: null });
            // The switch is tapped through its whole row, under SOUND.
            expect((await sheet.locator('label.n-account__mode').boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await sheet.locator('label.n-account__mode').click();
            expect(await sw.isChecked()).toBe(true);
            expect(await shown(page)).toEqual({ mode: 'light', html: WHITE, body: WHITE, ink: INK, bar: '#ffffff', kept: 'light' });
            // light.css's five pieces, on NOW under the sheet: a plate is a fine line with no fill and no inner frame,
            // a photograph has no fade at its top, an outlined button a firm line, the SCAN ring a white disc.
            expect(await style(page, '.n-card', 'background-color')).toBe(NONE);
            expect(await style(page, '.n-card', 'box-shadow')).toBe('rgba(10, 10, 10, 0.2) 0px 0px 0px 1px inset');
            expect(await style(page, '.n-card', 'box-shadow', '::before')).toBe('none');
            expect(await style(page, '.n-fade', 'display', '::before')).toBe('none');
            expect(await style(page, '.n-btn--ol', 'box-shadow')).toBe('rgba(10, 10, 10, 0.78) 0px 0px 0px 1px inset');
            expect(await style(page, '.n-scan__ring', 'background-color')).toBe(WHITE);
            // A filled button: NOCTURNE's ground with white words.
            expect(await style(page, '.n-btn:not(.n-btn--ol)', 'background-color')).toBe(INK);
            expect(await style(page, '.n-btn:not(.n-btn--ol)', 'color')).toBe(WHITE);

            // The page opened again with the app's own script held back: the early script alone has drawn it light.
            await page.route(/\/assets\/verify-(?!mode-)[^/]*\.js$/, (route) => route.abort());
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.documentElement.getAttribute('data-mode') === 'light', undefined, { timeout: 20_000 });
            expect(await shown(page)).toEqual({ mode: 'light', html: WHITE, body: WHITE, ink: INK, bar: '#ffffff', kept: 'light' });
            await page.unroute(/\/assets\/verify-(?!mode-)[^/]*\.js$/);

            // The legal pages follow the same device's choice.
            await page.goto(`${stage.origin}/legal/privacy`, { waitUntil: 'domcontentloaded' });
            await page.locator('.nocturne h1').first().waitFor({ timeout: 20_000 });
            const legal = await shown(page);
            expect({ mode: legal.mode, html: legal.html, body: legal.body, ink: legal.ink, bar: legal.bar }).toEqual({ mode: 'light', html: WHITE, body: WHITE, ink: INK, bar: '#ffffff' });

            // Back in the app, turned off: NOCTURNE's dark again, the key removed.
            await page.goto(`${stage.origin}/verify`, { waitUntil: 'domcontentloaded' });
            await page.locator('.n-hd button.n-acct').click();
            await sheet.locator('label.n-account__mode').waitFor({ timeout: 20_000 });
            expect(await sw.isChecked()).toBe(true);
            await sheet.locator('label.n-account__mode').click();
            expect(await sw.isChecked()).toBe(false);
            expect(await shown(page)).toEqual({ mode: null, html: INK, body: INK, ink: IVORY, bar: '#0a0a0a', kept: null });
            ran = true;
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(ran).toBe(true);
    },
    6 * 60_000,
  );
});
