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
 * YOUR WISHLIST, its row and its page (step 2.6):
 *  - the account sheet's row after YOUR ADDRESSES, NONE YET, then 3 MODELS; it opens /verify/wishlist (the sheet closed);
 *  - the page: ‹ YOUR ACCOUNT (the sheet again), the title and its sentence, the cards the latest first (MONOLITHE in
 *    blue, in gold DISCONTINUED · 2026, ZENITH hidden since: NOT IN THE COLLECTION NOW, no photograph, no link); REMOVE
 *    refused (the card stays, the sentence and the server's words), then done (the card goes, the line names it, the
 *    focus on the next card's SEE THE MODEL); SEE THE MODEL opens its sheet, that dot;
 *  - its states: unreadable (TRY AGAIN, then read), empty (THE COLLECTION), signed out (SIGN IN);
 *  - at 320, 390 and 1280 px, with the 200-wish stress list and a 60-character name: no sideways scroll.
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
  variant: 'wishes',
  ...extra,
});
const sheetOf = (key: string) => (d: NocturneDemo) => `/verify/lookbook/${d.slugs[key]}`;

const heart = (page: Page) => page.locator('.view--sheet .n-heart');
const wishPage = (page: Page) => page.locator('.view--wishlist');
const cardsOf = (page: Page) => page.locator('.view--wishlist .n-wishlist__card');
const accountSheet = (page: Page) => page.locator('.n-account:not([hidden])');

/** No sideways scroll at a phone's 320 and 390 px and a desk's 1280 px; the phone's controls at their floors. */
async function fitsPhoneAndDesk(page: Page, where: string, failures: string[]): Promise<void> {
  const before = page.viewportSize()!;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : before.height });
    await settle(page, 150);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) failures.push(`${where} at ${width} px: sideways scroll`);
    if (width < 1280) for (const p of (await tapZoneFloors(page)).problems) failures.push(`${where} at ${width} px: ${p}`);
  }
  await page.setViewportSize(before);
}
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
    // YOUR WISHLIST signed out: kept in the account, SIGN IN.
    state: state('wishlist-e2e-page-signed-out', { path: () => '/verify/wishlist', ready: '.view--wishlist .n-wishlist__signed-out' }),
    check: async ({ page }, _demo, failures) => {
      expect(norm(await wishPage(page).locator('.n-wishlist__signed-out').innerText())).toBe(`${WISHLIST.signedOut} ${WISHLIST.signIn}`);
      await fitsPhoneAndDesk(page, 'YOUR WISHLIST signed out', failures);
      await wishPage(page).getByRole('link', { name: WISHLIST.signIn, exact: true }).click();
      await page.waitForURL(/\/verify\/pieces$/);
    },
  },
  {
    // Unreadable: the sentence, the server's words, TRY AGAIN; read again, empty: its sentence and THE COLLECTION.
    state: state('wishlist-e2e-page-unreadable', {
      as: 'you',
      path: () => '/verify/wishlist',
      routes: async (page) => page.route('**/api/v1/account/wishlist', (r: Route) => r.abort('internetdisconnected')),
      ready: '.view--wishlist .n-wishlist__failed',
    }),
    check: async ({ page }, _demo, failures) => {
      const failed = wishPage(page).locator('.n-wishlist__failed');
      expect(norm(await failed.innerText())).toBe(`${WISHLIST.unreadable} ${REQUEST_ERRORS.network} ${WISHLIST.retry}`);
      await page.unroute('**/api/v1/account/wishlist');
      await failed.getByRole('button', { name: WISHLIST.retry }).click();
      const empty = wishPage(page).locator('.n-wishlist__empty');
      await empty.waitFor({ timeout: 20_000 });
      expect(norm(await empty.innerText())).toBe(`${WISHLIST.empty} ${WISHLIST.collection}`);
      expect(await wishPage(page).getAttribute('data-state')).toBe('empty');
      await fitsPhoneAndDesk(page, 'YOUR WISHLIST empty', failures);
      await empty.getByRole('link', { name: WISHLIST.collection, exact: true }).click();
      await page.waitForURL(/\/verify\/lookbook$/);
    },
  },
  {
    // The row, then the page with three wishes: REMOVE refused and done, SEE THE MODEL, the crumb; then the stress list.
    state: state('wishlist-e2e-page', { as: 'you', path: () => '/verify', mutates: true, ready: '.view--now[data-ready]' }),
    check: async ({ page, stage }, demo, failures) => {
      const you = demo.accounts.you!;
      const { db, services } = stage.ctx;
      // The row, after YOUR ADDRESSES: NONE YET.
      await page.locator('.n-hd button.n-acct').click();
      await accountSheet(page).locator('.n-account__wishlist-line').waitFor({ timeout: 20_000 });
      const rows = (await accountSheet(page).locator('.n-account__rows .n-row__label').allInnerTexts()).map(norm);
      expect(rows.slice(rows.indexOf('YOUR ADDRESSES'), rows.indexOf('YOUR ADDRESSES') + 3)).toEqual(['YOUR ADDRESSES', 'YOUR WISHLIST', 'SOUND']);
      expect(norm(await accountSheet(page).locator('.n-account__wishlist-line').innerText())).toBe('NONE YET');
      await page.keyboard.press('Escape');
      // Three wishes: MONOLITHE in blue now, in gold two days before (discontinued since), ZENITH five days before (hidden since).
      const id = async (slug: string) => (await db.selectFrom('models').select('id').where('slug', '=', slug).executeTakeFirstOrThrow()).id;
      const admin = await adminActor(stage);
      const [gold, zenith] = [await id('monolithe-gold'), await id('zenith')];
      await services.wishlist.add(you.id, 'monolithe-blue');
      await db
        .insertInto('account_wishes')
        .values([
          { account_id: you.id, model_id: gold, added_at: new Date(Date.parse('2026-10-03T16:49:00Z')) },
          { account_id: you.id, model_id: zenith, added_at: new Date(Date.parse('2026-09-30T16:49:00Z')) },
        ])
        .execute();
      await services.catalog.discontinueModel(gold, admin);
      await services.catalog.updateModel(zenith, { lookbook: 'HIDDEN' }, admin);
      await page.locator('.n-hd button.n-acct').click();
      await expect.poll(async () => norm(await accountSheet(page).locator('.n-account__wishlist-line').innerText()), POLL).toBe('3 MODELS');
      // The row opens the page, the sheet closed.
      await accountSheet(page).getByRole('link', { name: /^YOUR WISHLIST/ }).click();
      await page.waitForURL(/\/verify\/wishlist$/);
      await cardsOf(page).first().waitFor({ timeout: 20_000 });
      expect(await accountSheet(page).count()).toBe(0);
      expect(norm(await page.locator('#wishlist-title').innerText())).toBe(WISHLIST.title);
      expect(norm(await wishPage(page).locator('.n-wishlist__lead').innerText())).toBe(WISHLIST.lead);
      expect(await cardsOf(page).count()).toBe(3);
      const lines = (await cardsOf(page).locator('.n-wishlist__line').allInnerTexts()).map(norm);
      expect(lines).toEqual(['BRACELET · IN BLUE', 'BRACELET · IN GOLD · DISCONTINUED · 2026', WISHLIST.notShown]);
      expect((await cardsOf(page).locator('.n-wishlist__name').allInnerTexts()).map(norm)).toEqual(['MONOLITHE', 'MONOLITHE', 'ZENITH']);
      // The model not shown now: no photograph, no link, REMOVE.
      const hidden = cardsOf(page).nth(2);
      expect(await hidden.locator('img').count()).toBe(0);
      expect(await hidden.getByRole('link').count()).toBe(0);
      expect((await hidden.getByRole('button').allInnerTexts()).map(norm)).toEqual([WISHLIST.remove]);
      // The photographs: whole and faded, the first two eager.
      expect(await cardsOf(page).locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('loading')))).toEqual(['eager', 'eager']);
      await fitsPhoneAndDesk(page, 'YOUR WISHLIST', failures);
      // ‹ YOUR ACCOUNT: the account sheet again.
      await wishPage(page).getByRole('button', { name: WISHLIST.back }).click();
      await accountSheet(page).waitFor({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      await expect.poll(() => accountSheet(page).count(), POLL).toBe(0);
      // REMOVE refused: the card stays, the sentence and the server's words.
      await page.route(WISH, (r) => (r.request().method() === 'DELETE' ? r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Try again in a moment.' } }) }) : r.continue()));
      await cardsOf(page).first().getByRole('button', { name: WISHLIST.remove }).click();
      await expect.poll(async () => norm(await wishPage(page).locator('.n-wishlist__status').innerText()), POLL).toBe(`${WISHLIST.failed} Try again in a moment.`);
      expect(await cardsOf(page).count()).toBe(3);
      await page.unroute(WISH);
      // REMOVE: the card goes, the line names it, the focus on the next card's SEE THE MODEL.
      await cardsOf(page).first().getByRole('button', { name: WISHLIST.remove }).click();
      await expect.poll(() => cardsOf(page).count(), POLL).toBe(2);
      expect(norm(await wishPage(page).locator('.n-wishlist__status').innerText())).toBe(WISHLIST.removedNamed('MONOLITHE IN BLUE'));
      expect(await wishPage(page).locator('.n-wishlist__status').getAttribute('role')).toBe('status');
      expect(await page.evaluate(() => document.activeElement?.closest('[data-wish]')?.getAttribute('data-wish'))).toBe('monolithe-gold');
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(WISHLIST.seeModel);
      expect(await db.selectFrom('account_wishes').select('model_id').where('account_id', '=', you.id).where('removed_at', 'is', null).execute()).toHaveLength(2);
      // SEE THE MODEL: its sheet, that dot.
      await cardsOf(page).first().getByRole('link', { name: WISHLIST.seeModel }).click();
      await page.waitForURL(/\/verify\/lookbook\/monolithe-gold$/);
      await page.locator('.view--sheet .n-model__dots [aria-pressed="true"]').waitFor({ timeout: 20_000 });
      expect(norm(await page.locator('.view--sheet .n-model__dots [aria-pressed="true"]').innerText())).toBe('Gold');
      // The stress list: 200 wishes, a 60-character name, every one but the first not shown now.
      const long = 'MONOLITHE ARCHITECTURALE DU SOIR AUX REFLETS DE LAQUES BLEUE';
      expect(long).toHaveLength(60);
      const items = [
        { state: 'SHOWN', slug: 'monolithe', name: long, variant: { label: 'Steel', swatch: '#9D9B96' }, type: 'BRACELET', collection: 'ORBITAL', imageUrl: null, discontinuedYear: 2026, reserved: true, addedAt: '2026-10-05T16:49:00.000Z' },
        ...Array.from({ length: 199 }, (_, i) => ({ state: 'NOT_SHOWN', slug: `wish-${i}`, name: i % 2 ? long : `MODEL ${i}`, variant: i % 3 ? null : { label: 'Blue', swatch: '#16224A' }, addedAt: '2026-10-01T16:49:00.000Z' })),
      ];
      await page.route('**/api/v1/account/wishlist', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, max: 200 }) }));
      await page.goto(`${stage.origin}/verify/wishlist`);
      await expect.poll(() => cardsOf(page).count(), POLL).toBe(200);
      // A wish not shown now with a variant: its name alone as the heading, its variant once, on the line under it.
      const hiddenBlue = cardsOf(page).nth(1);
      expect(norm(await hiddenBlue.locator('.n-wishlist__name').innerText())).toBe('MODEL 0');
      expect(norm(await hiddenBlue.locator('.n-wishlist__line').innerText())).toBe(`${LOOKBOOK.releases.variant('Blue')} · ${WISHLIST.notShown}`);
      expect(norm(await hiddenBlue.innerText()).split('BLUE')).toHaveLength(2);
      await fitsPhoneAndDesk(page, 'YOUR WISHLIST, 200 wishes', failures);
      await page.unroute('**/api/v1/account/wishlist');
    },
  },
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
      const blueId = (await stage.ctx.db.selectFrom('models').select('id').where('slug', '=', 'monolithe-blue').executeTakeFirstOrThrow()).id;
      expect(await stage.ctx.db.selectFrom('account_wishes').select('model_id').where('model_id', '=', blueId).where('removed_at', 'is', null).execute()).toEqual([]);
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
      await stage.ctx.services.catalog.updateModel(blueId, { lookbook: 'HIDDEN' }, await adminActor(stage));
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
