/**
 * YOUR WISHLIST end to end (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.10, W.11, W.13; steps 2.5 and 2.6), on the
 * NOCTURNE stage (test/support/nocturne-states.ts), outside the content shards, in Chromium at the stage's phone:
 *
 * The heart on a model's sheet (step 2.5):
 *  - signed in: WISHLIST not pressed, then a tap: busy and disabled while it is sent (PUT), pressed, 'In your wishlist.';
 *    another dot shows its own state with no request (the line gone), back to the dot wished: pressed; a tap again
 *    (DELETE): 'Removed from your wishlist.'; a refusal (409 WISHLIST_FULL) and a connection lost said with the server's
 *    words, nothing flipped; the model hidden meanwhile: the sheet read again, not in the collection;
 *  - its wishlist unreadable: no heart, the rest of the sheet shown;
 *  - signed out: shown, not pressed; a tap sends nothing and says the wishlist is kept in the account, with SIGN IN to
 *    MY PIECES' sign-in;
 *  - at 390 and 320 px: no sideways scroll, every control's 44 px zone and 10 px type.
 * No CSP violation, no page error.
 */
import { existsSync } from 'node:fs';
import type { Page, Request, Route } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { LOOKBOOK, REQUEST_ERRORS, WISHLIST } from '../../src/web/verify/copy.js';
import { NOCTURNE_ADMIN, type NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, type OpenedState, type UiState } from '../support/nocturne-states.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { CHROMIUM_PATH, type UiStage } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const WISH = '**/api/v1/account/wishlist/*';
const POLL = { timeout: 20_000, interval: 100 };

const state = (id: string, extra: Partial<UiState> & Pick<UiState, 'path' | 'ready'>): UiState => ({
  id,
  title: 'YOUR WISHLIST, end to end',
  refs: ['CUSTOMER INTELLIGENCE §3.2 W.10'],
  variant: 'wishlist',
  ...extra,
});
const sheetOf = (key: string) => (d: NocturneDemo) => `/verify/lookbook/${d.slugs[key]}`;

const heart = (page: Page) => page.locator('.view--sheet .n-heart');
const line = (page: Page) => page.locator('.view--sheet .n-model__heart-line');
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

/** The requests of YOUR WISHLIST the page sends, as `METHOD path`. */
function wishRequests(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r: Request) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/v1/account/wishlist')) out.push(`${r.method()} ${path}`);
  });
  return out;
}

/** No sideways scroll, every control's 44 px zone and 10 px type, at the stage's phone and the narrowest. */
async function fitsEveryPhone(page: Page, where: string, failures: string[], widths: readonly number[] = [390, 320]): Promise<void> {
  const before = page.viewportSize()!;
  for (const width of widths) {
    await page.setViewportSize({ width, height: before.height });
    await settle(page, 150);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) failures.push(`${where} at ${width} px: sideways scroll`);
    // The sheet's next release and PAIRS WELL WITH's cards are rows of two lines by their design (C6, BP-34), measured by
    // the styles test: left out here.
    for (const p of (await tapZoneFloors(page, { skip: '.n-model__next, .n-model__pair' })).problems) failures.push(`${where} at ${width} px: ${p}`);
  }
  await page.setViewportSize(before);
}

async function adminActor(stage: UiStage): Promise<{ type: 'admin'; id: string }> {
  const a = await stage.ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', NOCTURNE_ADMIN.email).executeTakeFirstOrThrow();
  return { type: 'admin', id: a.id };
}

type Check = (opened: OpenedState, demo: NocturneDemo, failures: string[]) => Promise<void>;

const CASES: { state: UiState; check: Check }[] = [
  {
    // Signed out: the heart shown, not pressed; a tap sends nothing.
    state: state('wishlist-e2e-heart-signed-out', { path: sheetOf('steel'), ready: '.view--sheet .n-heart' }),
    check: async ({ page }, _demo, failures) => {
      const sent = wishRequests(page);
      expect(await heart(page).getAttribute('aria-pressed')).toBe('false');
      expect(norm(await heart(page).innerText())).toBe(WISHLIST.heart);
      await page.getByRole('button', { name: WISHLIST.heart, exact: true }).click();
      await line(page).waitFor({ timeout: 20_000 });
      expect(norm(await line(page).innerText())).toBe(`${WISHLIST.signedOut} ${WISHLIST.signIn}`);
      expect(await line(page).getAttribute('role')).toBe('status');
      expect(await heart(page).getAttribute('aria-pressed')).toBe('false');
      await fitsEveryPhone(page, 'the heart signed out', failures);
      expect(sent).toEqual([]);
      // SIGN IN: MY PIECES' sign-in.
      await line(page).getByRole('link', { name: WISHLIST.signIn, exact: true }).click();
      await page.waitForURL(/\/verify\/pieces$/);
      await page.locator('.view--pieces form').first().waitFor({ timeout: 20_000 });
    },
  },
  {
    // The wishlist unreadable: no heart (never a wrong state), the rest of the sheet as it is.
    state: state('wishlist-e2e-heart-unreadable', {
      as: 'you',
      path: sheetOf('steel'),
      routes: async (page) => page.route('**/api/v1/account/wishlist', (r: Route) => r.abort('internetdisconnected')),
      ready: '.view--sheet .sheet__body section',
    }),
    check: async ({ page }) => {
      await settle(page, 300);
      expect(await heart(page).count()).toBe(0);
      expect(norm(await page.locator('#sheet-title').innerText())).toBe('MONOLITHE');
      expect(await page.locator('.n-model__dots').count()).toBe(1);
    },
  },
  {
    // Signed in: pressed and unpressed, each dot its own state, the refusals said, the model hidden meanwhile.
    state: state('wishlist-e2e-heart', { as: 'you', path: sheetOf('blue'), mutates: true, ready: '.view--sheet .n-heart' }),
    check: async ({ page, stage }, _demo, failures) => {
      const sent = wishRequests(page);
      expect(await heart(page).getAttribute('aria-pressed')).toBe('false');
      expect(await line(page).count()).toBe(0);
      // A tap: busy and disabled while the PUT is held, then pressed with its line.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await page.route(WISH, async (r) => {
        await held;
        await r.continue();
      });
      await heart(page).click();
      await expect.poll(() => heart(page).getAttribute('aria-busy'), POLL).toBe('true');
      expect(await heart(page).isDisabled()).toBe(true);
      release();
      await expect.poll(() => heart(page).getAttribute('aria-pressed'), POLL).toBe('true');
      await page.unroute(WISH);
      expect(await heart(page).getAttribute('aria-busy')).toBe('false');
      expect(norm(await line(page).innerText())).toBe(WISHLIST.added);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('n-heart'))).toBe(true);
      expect(sent).toContain('PUT /api/v1/account/wishlist/monolithe-blue');
      // The heart's path filled once pressed, in the ivory of the words.
      expect(await page.locator('.view--sheet .n-heart .n-ic path').evaluate((p) => getComputedStyle(p).fill)).toBe('rgb(246, 242, 234)');
      await fitsEveryPhone(page, 'the heart pressed', failures);
      // Another dot: its own state, read from the list already loaded (no request), the line gone.
      const before = sent.length;
      await page.locator('.n-model__dots').getByRole('button', { name: 'Steel' }).click();
      await page.waitForURL(/\/verify\/lookbook\/monolithe$/);
      await expect.poll(() => heart(page).getAttribute('aria-pressed'), POLL).toBe('false');
      expect(await line(page).count()).toBe(0);
      await page.locator('.n-model__dots').getByRole('button', { name: 'Blue' }).click();
      await expect.poll(() => heart(page).getAttribute('aria-pressed'), POLL).toBe('true');
      expect(sent.length).toBe(before);
      // Tapped again: removed.
      await heart(page).click();
      await expect.poll(() => heart(page).getAttribute('aria-pressed'), POLL).toBe('false');
      expect(norm(await line(page).innerText())).toBe(WISHLIST.removed);
      expect(sent.at(-1)).toBe('DELETE /api/v1/account/wishlist/monolithe-blue');
      expect(await stage.ctx.db.selectFrom('account_wishes').select('model_id').where('removed_at', 'is', null).execute()).toEqual([]);
      // Refused (the 201st): the server's words after the sentence, nothing flipped.
      const full = 'Your wishlist holds up to 200 models. Remove one to add another.';
      await page.route(WISH, (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'WISHLIST_FULL', message: full } }) }));
      await heart(page).click();
      await expect.poll(async () => norm(await line(page).innerText()), POLL).toBe(`${WISHLIST.failed} ${full}`);
      expect(await heart(page).getAttribute('aria-pressed')).toBe('false');
      await page.unroute(WISH);
      // The connection lost: said, nothing flipped.
      await page.route(WISH, (r) => r.abort('internetdisconnected'));
      await heart(page).click();
      await expect.poll(async () => norm(await line(page).innerText()), POLL).toBe(`${WISHLIST.failed} ${REQUEST_ERRORS.network}`);
      expect(await heart(page).getAttribute('aria-pressed')).toBe('false');
      await page.unroute(WISH);
      // The model hidden meanwhile: the PUT answers 404, the sheet is read again and says it is not in the collection.
      const blue = await stage.ctx.db.selectFrom('models').select('id').where('slug', '=', 'monolithe-blue').executeTakeFirstOrThrow();
      await stage.ctx.services.catalog.updateModel(blue.id, { lookbook: 'HIDDEN' }, await adminActor(stage));
      await heart(page).click();
      await page.locator('.view--sheet[data-state="missing"]').waitFor({ timeout: 20_000 });
      expect(norm(await page.locator('#sheet-title').innerText())).toBe(LOOKBOOK.notFound);
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10, Chromium)', () => {
  it(
    'presses and unpresses the heart of the dot shown, each dot its own, says each refusal, and keeps the wishlist in the account when signed out',
    async () => {
      const failures: string[] = [];
      await eachState(
        CASES.map((c) => c.state),
        async (s, run) => {
          const c = CASES.find((x) => x.state.id === s.id)!;
          const opened = await openState(run.browser, run.stage, run.demo, s);
          const problems: string[] = [];
          opened.page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
          opened.page.on('console', (m) => {
            if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
          });
          try {
            await c.check(opened, run.demo, failures);
          } catch (e) {
            failures.push(`${s.id}: ${(e as Error).message}`);
          } finally {
            failures.push(...problems.map((p) => `${s.id}: ${p}`));
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
