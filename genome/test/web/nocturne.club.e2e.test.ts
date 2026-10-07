/**
 * THE CLUB, end to end (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T9, step 2.9), on the NOCTURNE stage
 * (test/support/nocturne-states.ts), outside the content shards:
 *
 *  - the footer's THE CLUB opens /verify/club in the same tab, and Back returns to the screen it was opened from;
 *  - the account sheet's THE CLUB row opens it too, the sheet closed, and Back returns;
 *  - the three ways to the reader's tier and where each leads: YOUR TIER: … › the account sheet (the address kept),
 *    YOUR FIRST PIECE OPENS TITANE › MY PIECES, SIGN IN TO SEE YOUR TIER › MY PIECES' sign-in;
 *  - FROM n PIECES under each tier's name in the reading face, as its lines;
 *  - HOW THE TIERS WORK says the credit's currency as THE PROGRAM sets it (GBP: pounds sterling);
 *  - no link to HOW RELEASES WORK anywhere on the page;
 *  - ONE MOMENT… while GET /api/v1/the-club is held, and its failure with TRY AGAIN, which shows the tiers once it
 *    answers.
 */
import { existsSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { NOCTURNE_ADMIN, type NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, stateById, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH, type UiStage } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const CLUB = '/verify/club';
const TIERS = ['TITANE', 'PLATINE', 'PALLADIUM'];

/** A state of the stage under a new id (the full demo, THE CLUB's own states, or the landing). */
const derived = (id: string, newId: string, extra: Partial<UiState> = {}): UiState => ({ ...stateById(id), id: newId, ...extra });
const landing = (newId: string, as?: string): UiState => ({
  id: newId,
  title: 'The landing, to open THE CLUB from',
  refs: ['BP-19'],
  variant: 'full',
  ...(as ? { as } : {}),
  path: () => '/verify',
  ready: 'footer.n-foot',
});

const pathOf = (page: Page) => new URL(page.url()).pathname;

/** THE CLUB on screen: its title, its three plates, the way to the reader's tier. */
async function clubShown(page: Page): Promise<void> {
  await page.locator('.view--club .n-club__way').waitFor({ timeout: 20_000 });
  expect(pathOf(page)).toBe(CLUB);
  expect((await page.locator('.view--club h1').innerText()).trim()).toBe('THE CLUB');
  expect(await page.locator('.view--club .n-club__name').allInnerTexts()).toEqual(TIERS);
}

/** The way to the reader's tier: its words, the address it names, and where it was told to lead. */
async function wayOf(page: Page): Promise<{ text: string; href: string | null; to: string | null; target: string | null }> {
  const link = page.locator('.view--club .n-club__yours');
  return {
    text: (await link.innerText()).replace(/\s+/g, ' ').replace(/\s*›\s*$/, '').trim(),
    href: await link.getAttribute('href'),
    to: await link.getAttribute('data-to'),
    target: await link.getAttribute('target'),
  };
}

/** No link to HOW RELEASES WORK, and not its name, anywhere on the page (§3.2.3, §3.5). */
async function noHowLink(page: Page): Promise<void> {
  const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => /\/verify\/releases\/how/i.test(h))).toEqual([]);
  expect(await page.locator('body').innerText()).not.toMatch(/HOW RELEASES WORK/i);
}

/** The demo's console user, as THE PROGRAM's changes are signed. */
async function adminActor(stage: UiStage): Promise<{ type: 'admin'; id: string }> {
  const row = await stage.ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', NOCTURNE_ADMIN.email).executeTakeFirstOrThrow();
  return { type: 'admin', id: row.id };
}

type Run = { browser: Browser; stage: UiStage; demo: NocturneDemo };
const CASES: { state: UiState; check: (page: Page, run: Run) => Promise<void> }[] = [
  // ── The footer, signed out: the same tab, Back returns; SIGN IN TO SEE YOUR TIER › MY PIECES' sign-in ──
  {
    state: landing('club-e2e-footer'),
    check: async (page) => {
      const pages = page.context().pages().length;
      const link = page.locator('footer.n-foot a', { hasText: 'THE CLUB' });
      expect(await link.getAttribute('href')).toBe(CLUB);
      expect(await link.getAttribute('target')).toBeNull();
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await clubShown(page);
      expect(page.context().pages()).toHaveLength(pages);
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('club-title');
      // FROM n PIECES in the reading face, as the tier's lines; its name in the display face.
      const faces = await page.locator('.view--club .n-club__plate').first().evaluate((plate) => {
        const font = (sel: string) => getComputedStyle(plate.querySelector(sel)!).fontFamily;
        return { name: font('.n-club__name'), from: font('.n-club__from'), line: font('.n-club__line') };
      });
      expect(faces.from).toBe(faces.line);
      expect(faces.from).not.toBe(faces.name);
      expect(await page.locator('.view--club .n-club__from').allInnerTexts()).toEqual(['FROM 1 PIECE', 'FROM 5 PIECES', 'FROM 10 PIECES']);
      await noHowLink(page);
      // Back: the landing again, in the same tab.
      await page.goBack();
      await expect.poll(() => pathOf(page)).toBe('/verify');
      await page.locator('footer.n-foot').waitFor();
      await expect.poll(() => page.locator('.view--club:visible').count(), { timeout: 10_000 }).toBe(0);
      await page.goForward();
      await clubShown(page);
      // Signed out: MY PIECES' sign-in.
      expect(await wayOf(page)).toEqual({ text: 'SIGN IN TO SEE YOUR TIER', href: '/verify/pieces', to: 'signIn', target: null });
      await page.locator('.view--club .n-club__yours').click();
      await expect.poll(() => pathOf(page)).toBe('/verify/pieces');
      await page.locator('input[name=email]').first().waitFor({ timeout: 20_000 });
      expect(await page.locator('input[type=password]').count()).toBeGreaterThan(0);
      expect(page.context().pages()).toHaveLength(pages);
    },
  },
  // ── The account sheet's row, signed in at PLATINE; YOUR TIER: … › the account sheet over THE CLUB ──
  {
    state: landing('club-e2e-account', 'platine'),
    check: async (page, { stage, demo }) => {
      const account = page.locator('.n-hd button.n-acct');
      await account.click();
      const sheet = page.locator('.n-account:not([hidden])');
      await sheet.locator('.n-account__tier').waitFor({ timeout: 20_000 });
      const row = sheet.locator('[data-key=club]');
      expect(await row.getAttribute('href')).toBe(CLUB);
      expect(await row.getAttribute('target')).toBeNull();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await clubShown(page);
      await expect.poll(() => page.locator('.n-account:not([hidden])').count()).toBe(0);
      await noHowLink(page);
      // YOUR TIER: PLATINE · n PIECES HELD, n the pieces the account holds now (GET /api/v1/club/status).
      const held = await stage.ctx.services.club.status(demo.accounts.platine!.id);
      expect(held.tier?.name).toBe('PLATINE');
      const way = await wayOf(page);
      expect(way).toEqual({ text: `YOUR TIER: PLATINE · ${held.pieces} PIECES HELD`, href: null, to: 'account', target: null });
      const yours = page.locator('.view--club .n-club__yours');
      await yours.click();
      await page.locator('.n-account:not([hidden]) .n-account__tier').waitFor({ timeout: 20_000 });
      expect(pathOf(page)).toBe(CLUB);
      // Closed: THE CLUB still there, the focus back on the link.
      await page.keyboard.press('Escape');
      await expect.poll(() => page.locator('.n-account:not([hidden])').count()).toBe(0);
      await expect.poll(() => yours.evaluate((el) => el === document.activeElement)).toBe(true);
      // Back: the landing again.
      await page.goBack();
      await expect.poll(() => pathOf(page)).toBe('/verify');
      await page.locator('footer.n-foot').waitFor();
      await expect.poll(() => page.locator('.view--club:visible').count(), { timeout: 10_000 }).toBe(0);
    },
  },
  // ── An account without a piece: YOUR FIRST PIECE OPENS TITANE › MY PIECES, signed in ──
  {
    state: derived('club-no-piece', 'club-e2e-newcomer'),
    check: async (page) => {
      await clubShown(page);
      expect(await wayOf(page)).toEqual({ text: 'YOUR FIRST PIECE OPENS TITANE', href: '/verify/pieces', to: 'pieces', target: null });
      await page.locator('.view--club .n-club__yours').click();
      await expect.poll(() => pathOf(page)).toBe('/verify/pieces');
      await page.locator('.view--pieces').waitFor({ timeout: 20_000 });
      await settle(page, 400);
      expect(await page.locator('.view--pieces input[type=password]').count()).toBe(0);
      await page.goBack();
      await clubShown(page);
    },
  },
  // ── ONE MOMENT… while the club is read ──
  {
    state: derived('club', 'club-e2e-loading', { routes: async (_page, hold) => hold.hold('**/api/v1/the-club'), ready: '.view--club .n-club__waiting' }),
    check: async (page) => {
      expect((await page.locator('.view--club .n-club__waiting').innerText()).trim()).toContain('ONE MOMENT…');
      expect(await page.locator('.view--club .n-club__tier').count()).toBe(0);
    },
  },
  // ── Its failure: the sentence and TRY AGAIN, which shows the tiers once the club answers ──
  {
    state: derived('club', 'club-e2e-failed', {
      routes: async (page) => page.route('**/api/v1/the-club', (r) => r.abort('internetdisconnected')),
      ready: '.view--club .n-club__failed',
    }),
    check: async (page) => {
      const failed = page.locator('.view--club .n-club__failed');
      expect(await failed.locator('.n-failed__sentence').innerText()).toBe('The club could not be shown just now.');
      expect(await failed.locator('[role=alert]').count()).toBe(1);
      expect(await page.locator('.view--club .n-club__tier').count()).toBe(0);
      await page.unroute('**/api/v1/the-club');
      await failed.getByRole('button', { name: 'TRY AGAIN' }).click();
      await clubShown(page);
      expect(await page.locator('.view--club .n-club__failed').count()).toBe(0);
    },
  },
  // ── The credit's currency, as THE PROGRAM sets it (last: it writes, and puts it back) ──
  {
    state: derived('club', 'club-e2e-currency', { mutates: true }),
    check: async (page, { browser, stage, demo }) => {
      const rules = () => page.locator('.view--club .n-club__rule').allInnerTexts();
      expect(await rules()).toContain('The credit applies to orders in euros.');
      const admin = await adminActor(stage);
      const before = await stage.ctx.services.clubProgram.sheet();
      await stage.ctx.services.clubProgram.update({ ...before, creditCurrency: 'GBP' }, admin);
      try {
        // A new phone, so that no answer kept a minute stands in for the new one.
        const again = await openState(browser, stage, demo, derived('club', 'club-e2e-currency-gbp'));
        try {
          const lines = await again.page.locator('.view--club .n-club__rule').allInnerTexts();
          expect(lines).toContain('The credit applies to orders in pounds sterling.');
          expect(lines.join('\n')).not.toContain('euros');
        } finally {
          await again.close();
        }
      } finally {
        await stage.ctx.services.clubProgram.update({ ...before, creditCurrency: before.creditCurrency }, admin);
      }
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('THE CLUB (BP-19 T9, Chromium)', () => {
  it(
    'opens from the footer and from the account sheet in the same tab with Back returning, leads each reader to their tier, says the credit\'s currency, links nowhere near HOW RELEASES WORK, and waits and fails as every page',
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
    10 * 60_000,
  );
});
