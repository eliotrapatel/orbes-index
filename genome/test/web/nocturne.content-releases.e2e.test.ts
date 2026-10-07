/**
 * NOCTURNE's content test, shard releases (test/web/nocturne.content.harness.ts: CONTENT_SHARDS); then HOW RELEASES WORK
 * end to end (plan NEXT-NINE of 2026-10-06, §3.5 FT-01, step 5.2), on the same stage (test/support/nocturne-states.ts):
 *
 *  - each place its link stands, as a text link to /verify/releases/how: under THE RELEASES' lead (LIVE and PAST), the
 *    last line of a draw's page, the last line of a LIVE RELEASE's NOCTURNE pages (announced, its final page, an end
 *    page, an after-room's end page), and first in the room's foot: in the app (the same tab, Back returning) while the
 *    collector holds no entry, in a new tab once they hold one (the room stays); none on the boutique board;
 *  - the page: its crumb ‹ THE RELEASES (back to the list), its document title, its three sections, and its figures
 *    those of GET /api/v1/releases/rules (the tiers, THE PROGRAM's windows, the place held), following THE PROGRAM;
 *  - ONE MOMENT… while the figures are read, and its failure with TRY AGAIN.
 */
import { existsSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { NOCTURNE_ADMIN, type NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, stateById, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH, type UiStage } from '../support/ui-stage.js';
import { contentSuite } from './nocturne.content.harness.js';

contentSuite('releases');

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const HOW = '/verify/releases/how';

const derived = (id: string, newId: string, extra: Partial<UiState> = {}): UiState => ({ ...stateById(id), id: newId, ...extra });
const pathOf = (page: Page) => new URL(page.url()).pathname;

interface Rules {
  tiers: { name: string; pieces: number }[];
  earlyAccess: { PALLADIUM: number; PLATINE: number };
  placeHeldHours: number;
}

/** HOW RELEASES WORK on screen, in the app: its title, its three sections, its document title. */
async function howShown(page: Page): Promise<void> {
  await page.locator('.view--how .n-how__back').waitFor({ timeout: 20_000 });
  expect(pathOf(page)).toBe(HOW);
  expect((await page.locator('.view--how h1').innerText()).trim()).toBe('HOW RELEASES WORK');
  expect(await page.locator('.view--how .n-how__section-title').allInnerTexts()).toEqual(['THE WAYS TO TAKE PART', 'HOW THE ORDER IS SET', 'WHAT THE HOUSE NEVER DOES']);
  expect(await page.title()).toBe('HOW RELEASES WORK · ORBES');
}

/** A link to the page: its address, and whether it opens a new tab. */
async function linkOf(page: Page, selector: string): Promise<{ text: string; href: string | null; target: string | null }> {
  const link = page.locator(selector);
  await link.waitFor({ timeout: 20_000 });
  return { text: (await link.innerText()).trim(), href: await link.getAttribute('href'), target: await link.getAttribute('target') };
}

/** `selector`'s link is the last line of `container`: nothing follows it there. */
async function isLast(page: Page, container: string, selector: string): Promise<void> {
  const last = await page.locator(container).first().evaluate((el, sel) => {
    const shown = [...el.children].filter((c) => !(c as HTMLElement).hidden && getComputedStyle(c).display !== 'none');
    return shown.at(-1)?.querySelector(sel) != null;
  }, selector);
  expect(last, `${selector} last in ${container}`).toBe(true);
}

/** Open the page from `selector` in the same tab, check it, then Back to `back`. */
async function opensInApp(page: Page, selector: string, back: string): Promise<void> {
  const tabs = page.context().pages().length;
  expect(await linkOf(page, selector)).toEqual({ text: 'HOW RELEASES WORK', href: HOW, target: null });
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator(selector).click();
  await howShown(page);
  expect(page.context().pages()).toHaveLength(tabs);
  await page.goBack();
  await expect.poll(() => pathOf(page)).toBe(back);
  await expect.poll(() => page.locator('.view--how:visible').count(), { timeout: 10_000 }).toBe(0);
}

async function adminActor(stage: UiStage): Promise<{ type: 'admin'; id: string }> {
  const row = await stage.ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', NOCTURNE_ADMIN.email).executeTakeFirstOrThrow();
  return { type: 'admin', id: row.id };
}

const words = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}` : `${minutes} minutes`);

type Run = { browser: Browser; stage: UiStage; demo: NocturneDemo };
const CASES: { state: UiState; check: (page: Page, run: Run) => Promise<void> }[] = [
  // ── THE RELEASES: under the lead, on LIVE and on PAST; the page's crumb back to the list ──
  {
    state: derived('releases', 'how-e2e-releases'),
    check: async (page) => {
      const lead = await page.locator('.view--releases .n-releases__head').evaluate((head) => [...head.children].map((c) => c.className));
      expect(lead.at(-1)).toContain('n-releases__how');
      await opensInApp(page, '.view--releases .n-releases__how a', '/verify/releases');
      await page.getByRole('tab', { name: 'PAST', exact: true }).click();
      await page.locator('#releases-panel-past article.release-card').first().waitFor({ timeout: 20_000 });
      expect(await linkOf(page, '.view--releases .n-releases__how a')).toEqual({ text: 'HOW RELEASES WORK', href: HOW, target: null });
      // From the list, the crumb ‹ THE RELEASES returns to it.
      await page.locator('.view--releases .n-releases__how a').click();
      await howShown(page);
      const crumb = page.locator('.view--how .n-crumb');
      expect(await crumb.getAttribute('href')).toBe('/verify/releases');
      expect((await crumb.innerText()).trim()).toBe('THE RELEASES');
      await crumb.click();
      await expect.poll(() => pathOf(page)).toBe('/verify/releases');
      await page.locator('.view--releases article').first().waitFor({ timeout: 20_000 });
      expect(await page.title()).not.toContain('HOW RELEASES WORK');
    },
  },
  // ── The page: its figures are the endpoint's, and follow THE PROGRAM (it writes, and puts it back) ──
  {
    state: derived('releases-how', 'how-e2e-figures', { mutates: true }),
    check: async (page, { browser, stage, demo }) => {
      await howShown(page);
      const rules = (await (await page.request.get(new URL('/api/v1/releases/rules', page.url()).href)).json()) as Rules;
      const rows = await page.locator('.view--how .n-how__row').allInnerTexts();
      expect(rows).toEqual(rules.tiers.map((t) => `${t.name} · FROM ${t.pieces} ${t.pieces === 1 ? 'PIECE' : 'PIECES'}`));
      expect(rows).toEqual(['TITANE · FROM 1 PIECE', 'PLATINE · FROM 5 PIECES', 'PALLADIUM · FROM 10 PIECES']);
      const text = (key: string) => page.locator(`.view--how [data-section=ways] [data-term=${key}] .n-how__text`).innerText();
      expect(await text('early')).toContain(`PALLADIUM owners from ${words(rules.earlyAccess.PALLADIUM)} before the opening, PLATINE owners from ${words(rules.earlyAccess.PLATINE)} before`);
      expect(await text('early')).toContain('PALLADIUM owners from 4 hours before the opening, PLATINE owners from 2 hours before');
      expect(await text('draw')).toContain(`held for you ${rules.placeHeldHours} hours`);
      // The crumb of a page opened directly: the list under it.
      await page.locator('.view--how .n-crumb').click();
      await expect.poll(() => pathOf(page)).toBe('/verify/releases');
      // THE PROGRAM's windows changed: the page says the new ones (a new phone, nothing kept a minute).
      const admin = await adminActor(stage);
      const before = await stage.ctx.services.clubProgram.sheet();
      await stage.ctx.services.clubProgram.update({ ...before, earlyAccessPalladiumHours: 6, earlyAccessPlatineHours: 3 }, admin);
      try {
        const again = await openState(browser, stage, demo, derived('releases-how', 'how-e2e-figures-again'));
        try {
          const early = await again.page.locator('.view--how [data-section=ways] [data-term=early] .n-how__text').innerText();
          expect(early).toContain('PALLADIUM owners from 6 hours before the opening, PLATINE owners from 3 hours before');
        } finally {
          await again.close();
        }
      } finally {
        await stage.ctx.services.clubProgram.update({ ...before }, admin);
      }
    },
  },
  // ── A draw's page: the last line, after THE DRAW and THE ENTRIES; Back returns to the draw ──
  {
    state: derived('draw-drawn', 'how-e2e-draw'),
    check: async (page) => {
      await page.locator('.view--release .release__draw').waitFor();
      const order = await page.locator('.view--release .n-release__body').evaluate((body) => [...body.children].map((c) => c.className));
      expect(order.at(-1)).toContain('n-release__how');
      expect(order.at(-2)).toContain('release__draw');
      const back = pathOf(page);
      await opensInApp(page, '.view--release .n-release__how a', back);
    },
  },
  // ── A LIVE RELEASE announced: the last line of the page ──
  {
    state: derived('live-announced-signed-out', 'how-e2e-announced'),
    check: async (page) => {
      await isLast(page, '.view--live .n-live__announced', '.n-live__how-link');
      await opensInApp(page, '.view--live .n-live__how a', pathOf(page));
    },
  },
  // ── Its final page ──
  {
    state: derived('live-past-signed-out', 'how-e2e-past'),
    check: async (page) => {
      await isLast(page, '.view--live .n-live__past', '.n-live__how-link');
      await opensInApp(page, '.view--live .n-live__how a', pathOf(page));
    },
  },
  // ── An end page (C30), after THE RELEASES ──
  {
    state: derived('live-missed', 'how-e2e-missed'),
    check: async (page) => {
      await isLast(page, '.view--live .n-live__end', '.n-live__how-link');
      expect(await linkOf(page, '.view--live .n-live__end .n-live__how a')).toEqual({ text: 'HOW RELEASES WORK', href: HOW, target: null });
    },
  },
  // ── An after-room's end page ──
  {
    state: derived('after-room-ended', 'how-e2e-after-room'),
    check: async (page) => {
      await isLast(page, '.view--live .n-live__end', '.n-live__how-link');
    },
  },
  // ── The room before an entry: first in the vault's foot, in the app ──
  {
    state: derived('room', 'how-e2e-room'),
    check: async (page) => {
      const foot = await page.locator('.view--live .live__foot').evaluate((f) => [...f.children].map((c) => c.className));
      expect(foot[0]).toContain('live__how');
      expect(await linkOf(page, '.view--live .live__foot .live__how')).toEqual({ text: 'HOW RELEASES WORK', href: HOW, target: null });
    },
  },
  // ── In the line, an entry held: a new tab, the room stays ──
  {
    state: derived('live-line', 'how-e2e-line'),
    check: async (page) => {
      const foot = await page.locator('.view--live .live__foot').evaluate((f) => [...f.children].map((c) => c.className));
      expect(foot[0]).toContain('live__how');
      expect(await linkOf(page, '.view--live .live__foot .live__how')).toEqual({ text: 'HOW RELEASES WORK', href: HOW, target: '_blank' });
      expect(await page.locator('.view--live .live__foot .live__how').getAttribute('rel')).toBe('noopener');
      const room = pathOf(page);
      const [tab] = await Promise.all([page.context().waitForEvent('page'), page.locator('.view--live .live__foot .live__how').click()]);
      await tab.waitForLoadState();
      await howShown(tab);
      await tab.close();
      expect(pathOf(page)).toBe(room);
      expect(await page.locator('.view--live .live__ahead').count()).toBe(1);
    },
  },
  // ── CONFIRMED: in the foot, a new tab ──
  {
    state: derived('live-confirmed', 'how-e2e-confirmed'),
    check: async (page) => {
      expect(await linkOf(page, '.view--live .live__foot .live__how')).toEqual({ text: 'HOW RELEASES WORK', href: HOW, target: '_blank' });
    },
  },
  // ── Not on the boutique board ──
  {
    state: derived('board', 'how-e2e-board'),
    check: async (page) => {
      await settle(page, 400);
      const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      expect(hrefs.filter((h) => h.includes('/releases/how'))).toEqual([]);
      expect(await page.locator('body').innerText()).not.toMatch(/HOW RELEASES WORK/);
    },
  },
  // ── ONE MOMENT… while the figures are read ──
  {
    state: derived('releases-how', 'how-e2e-loading', { routes: async (_page, hold) => hold.hold('**/api/v1/releases/rules'), ready: '.view--how .n-how__waiting' }),
    check: async (page) => {
      expect((await page.locator('.view--how .n-how__waiting').innerText()).trim()).toContain('ONE MOMENT…');
      expect(await page.locator('.view--how .n-how__section').count()).toBe(0);
      expect((await page.locator('.view--how h1').innerText()).trim()).toBe('HOW RELEASES WORK');
    },
  },
  // ── Its failure: the sentence and TRY AGAIN, which shows the page once the figures answer ──
  {
    state: derived('releases-how', 'how-e2e-failed', {
      routes: async (page) => page.route('**/api/v1/releases/rules', (r) => r.abort('internetdisconnected')),
      ready: '.view--how .n-how__failed',
    }),
    check: async (page) => {
      const failed = page.locator('.view--how .n-how__failed');
      expect(await failed.locator('.n-failed__sentence').innerText()).toBe('How releases work could not be shown just now.');
      expect(await page.locator('.view--how .n-how__section').count()).toBe(0);
      await page.unroute('**/api/v1/releases/rules');
      await failed.getByRole('button', { name: 'TRY AGAIN' }).click();
      await howShown(page);
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('HOW RELEASES WORK (FT-01, Chromium)', () => {
  it(
    'is linked from THE RELEASES, a draw\'s page, a LIVE RELEASE\'s pages and the room\'s foot (a new tab while entered), never the board; states the endpoint\'s figures; waits and fails as every page',
    async () => {
      const failures: string[] = [];
      await eachState(
        CASES.map((c) => c.state),
        async (state, run) => {
          const c = CASES.find((x) => x.state.id === state.id)!;
          const opened = await openState(run.browser, run.stage, run.demo, state);
          try {
            await c.check(opened.page, run);
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
