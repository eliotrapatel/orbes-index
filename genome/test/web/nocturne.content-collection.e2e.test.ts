/**
 * NOCTURNE's content test, shard collection (test/web/nocturne.content.harness.ts: CONTENT_SHARDS); then a model's
 * sheet's foot end to end (plan NEXT-NINE of 2026-10-06), on the same stage (test/support/nocturne-states.ts):
 *
 *  - THE RELEASES OF THIS MODEL (§3.6 CO-01, step 6.1): MONOLITHE's four past releases, after CARE, the newest first,
 *    each with its exact words and accessible name, the same whichever dot is chosen and from a variant's address; a row
 *    opens its release's page; none for a model never released (ZENITH); on the stress stage, nine releases: the six
 *    newest, then SHOW ALL 9 RELEASES unfolds the rest in place and the focus moves to the seventh.
 */
import { existsSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, stateById, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';
import { contentSuite } from './nocturne.content.harness.js';

contentSuite('collection');

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

const derived = (id: string, newId: string, extra: Partial<UiState> = {}): UiState => ({ ...stateById(id), id: newId, ...extra });
const pathOf = (page: Page) => new URL(page.url()).pathname;

/** MONOLITHE's past releases on the demo, the newest first: each row's words, as the sheet shows them. */
const MONOLITHE_ROWS = [
  ['5 OCT 2026', 'LIVE RELEASE · IN STEEL'],
  ['28 SEP 2026', 'LIVE RELEASE · IN GOLD'],
  ['14 SEP 2026', 'DRAW · IN GOLD'],
  ['10 SEP 2026', 'DRAW · IN STEEL'],
];
const MONOLITHE_LABELS = [
  'LIVE RELEASE, 5 OCT 2026, in steel: see the release',
  'LIVE RELEASE, 28 SEP 2026, in gold: see the release',
  'DRAW, 14 SEP 2026, in gold: see the release',
  'DRAW, 10 SEP 2026, in steel: see the release',
];

/** The rows of THE RELEASES OF THIS MODEL: each one's title and line, its accessible name, its address. */
async function releaseRows(page: Page): Promise<{ words: string[][]; labels: (string | null)[]; hrefs: (string | null)[] }> {
  const rows = page.locator('.view--sheet .n-model__releases .n-model__release');
  const words = await rows.evaluateAll((els) => els.map((el) => [el.querySelector('.n-acc__title')?.textContent ?? '', el.querySelector('.n-acc__line')?.textContent ?? '']));
  return {
    words,
    labels: await rows.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
    hrefs: await rows.evaluateAll((els) => els.map((el) => el.getAttribute('href'))),
  };
}

/** The sheet's sections in order, by their heading's id (the gallery has none). */
async function sectionOrder(page: Page): Promise<string[]> {
  return page.locator('.view--sheet .n-model__body').evaluate((body) => [...body.querySelectorAll(':scope > section')].map((s) => s.querySelector(':scope > h2')?.id ?? s.className));
}

const CASES: { state: UiState; check: (page: Page) => Promise<void> }[] = [
  // ── MONOLITHE: its four releases after CARE, the newest first; a dot changes nothing; a row opens its page ──
  {
    state: derived('model', 'co01-model'),
    check: async (page) => {
      await page.locator('.view--sheet .n-model__releases').waitFor({ timeout: 20_000 });
      const order = await sectionOrder(page);
      expect(order.at(-1)).toBe('sheet-releases');
      expect(order.at(-2)).toBe('sheet-care');
      expect((await page.locator('#sheet-releases').innerText()).trim()).toBe('THE RELEASES OF THIS MODEL');
      expect(await page.locator('.n-model__releases').getAttribute('aria-labelledby')).toBe('sheet-releases');
      const rows = await releaseRows(page);
      expect(rows.words).toEqual(MONOLITHE_ROWS);
      expect(rows.labels).toEqual(MONOLITHE_LABELS);
      for (const href of rows.hrefs) expect(href).toMatch(/^\/verify\/releases\/[0-9a-f-]{36}$/);
      // Four rows: no SHOW ALL, no quantity, no title, no mark of the reader's part.
      expect(await page.locator('.n-model__releases-all').count()).toBe(0);
      expect(await page.locator('.n-model__releases').innerText()).not.toMatch(/PIECES|YOU TOOK PART|YOU SECURED|MONOLITHE IN/);
      // A dot chosen: the same rows (they cover every variant).
      await page.locator('.n-model__dots').getByRole('button', { name: 'Blue' }).click();
      await page.waitForURL(/\/verify\/lookbook\/monolithe-blue$/);
      expect((await releaseRows(page)).words).toEqual(MONOLITHE_ROWS);
      // A row opens its release's page (the past LIVE RELEASE of 28 September, its final page).
      const href = rows.hrefs[1]!;
      await page.getByRole('link', { name: MONOLITHE_LABELS[1]! }).click();
      await expect.poll(() => pathOf(page)).toBe(href);
      await page.locator('.view--live .n-live__past').waitFor({ timeout: 20_000 });
    },
  },
  // ── A variant's address, signed out: the same rows ──
  {
    state: derived('model-gold', 'co01-model-gold'),
    check: async (page) => {
      await page.locator('.view--sheet .n-model__releases').waitFor({ timeout: 20_000 });
      const rows = await releaseRows(page);
      expect(rows.words).toEqual(MONOLITHE_ROWS);
      expect(rows.labels).toEqual(MONOLITHE_LABELS);
    },
  },
  // ── A model never released (ZENITH): no section, no empty sentence ──
  {
    state: derived('model-salon', 'co01-never-released'),
    check: async (page) => {
      await page.locator('#sheet-care').waitFor({ timeout: 20_000 });
      expect(await page.locator('.n-model__releases').count()).toBe(0);
      expect(await page.locator('.view--sheet').innerText()).not.toContain('THE RELEASES OF THIS MODEL');
      expect((await sectionOrder(page)).at(-1)).toBe('sheet-care');
    },
  },
  // ── Nine releases (the stress stage): six, then SHOW ALL 9 RELEASES in place, the focus on the seventh ──
  {
    state: derived('model-stress', 'co01-show-all'),
    check: async (page) => {
      await page.locator('.view--sheet .n-model__releases').waitFor({ timeout: 20_000 });
      const six = await releaseRows(page);
      expect(six.words).toEqual([
        ['27 SEP 2026', 'LIVE RELEASE · IN BRUSHED COBALT'],
        ['24 SEP 2026', 'DRAW · IN POLISHED'],
        ['21 SEP 2026', 'DRAW · IN BRUSHED COBALT'],
        ['18 SEP 2026', 'LIVE RELEASE · IN POLISHED'],
        ['15 SEP 2026', 'DRAW · IN POLISHED'],
        ['12 SEP 2026', 'DRAW · IN BRUSHED COBALT'],
      ]);
      const more = page.locator('.view--sheet .n-model__releases-all');
      expect((await more.innerText()).trim()).toBe('SHOW ALL 9 RELEASES');
      expect(await more.evaluate((el) => el.tagName)).toBe('BUTTON');
      expect(await more.evaluate((el) => getComputedStyle(el.parentElement!).textAlign)).toBe('center');
      await more.click();
      await expect.poll(() => page.locator('.view--sheet .n-model__release').count()).toBe(9);
      const all = await releaseRows(page);
      expect(all.words.slice(0, 6)).toEqual(six.words);
      expect(all.words.slice(6)).toEqual([
        ['9 SEP 2026', 'LIVE RELEASE · IN POLISHED'],
        ['6 SEP 2026', 'DRAW · IN BRUSHED COBALT'],
        ['3 SEP 2026', 'DRAW · IN POLISHED'],
      ]);
      expect(await page.locator('.view--sheet .n-model__releases-all').count()).toBe(0);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('LIVE RELEASE, 9 SEP 2026, in polished: see the release');
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('THE RELEASES OF THIS MODEL (CO-01, Chromium)', () => {
  it(
    'lists a model\'s past releases after CARE, the newest first, the same for every dot, each opening its page; none for a model never released; six, then SHOW ALL N RELEASES',
    async () => {
      const failures: string[] = [];
      await eachState(
        CASES.map((c) => c.state),
        async (state, run) => {
          const c = CASES.find((x) => x.state.id === state.id)!;
          const opened = await openState(run.browser, run.stage, run.demo, state);
          try {
            await c.check(opened.page);
          } catch (e) {
            failures.push(`${state.id}: ${(e as Error).message}`);
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(failures).toEqual([]);
    },
    12 * 60_000,
  );
});
