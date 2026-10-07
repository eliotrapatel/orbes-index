/**
 * YOUR SIZES in the account sheet, end to end (plan NEXT-NINE of 2026-10-06, §3.4 AC-01), on the NOCTURNE stage
 * (test/support/nocturne-states.ts), outside the content shards: the view's fields open only on the sizes as read for
 * the account signed in, so that SAVE never clears a size the collector was not shown.
 *
 *  - GET /api/v1/account/sizes held: the row says nothing of the sizes, the view says ONE MOMENT… and shows no field and
 *    no SAVE; once it answers, the fields hold the sizes saved, and SAVE sends them as they were;
 *  - its failure: the sentence with the server's message, TRY AGAIN and CANCEL, no field and no SAVE, and no PUT;
 *    TRY AGAIN shows the sizes once it answers;
 *  - signed out and another account signed in, in the same tab: nothing of the first account's sizes on the row or in
 *    the fields; the second account's own (none) once read.
 */
import { existsSync } from 'node:fs';
import type { Page, Request } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { REQUEST_ERRORS } from '../../src/web/verify/copy.js';
import { NOCTURNE_PASSWORD, type NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, type OpenedState, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const SIZES = '**/api/v1/account/sizes';
const SAVED = ['52', '17', '', ''];
const KINDS = ['ring', 'bracelet', 'wrist', 'necklace'];

/** The landing of `sized` (a ring of 52 and a bracelet of 17 cm saved), to open the account sheet from. */
const landing = (id: string, extra: Partial<UiState> = {}): UiState => ({
  id,
  title: 'The landing, signed in, to open YOUR SIZES from',
  refs: ['AC-01'],
  variant: 'full',
  as: 'sized',
  path: () => '/verify',
  ready: '.n-hd button.n-acct:not([hidden])',
  ...extra,
});

/** A gate: requests wait at it until it opens. */
function gate(): { promise: Promise<void>; open(): void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

/** The PUTs of YOUR SIZES the page sends, as their bodies. */
function puts(page: Page): unknown[] {
  const out: unknown[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/v1/account/sizes') out.push(r.postDataJSON());
  });
  return out;
}

async function openSheet(page: Page): Promise<void> {
  await page.locator('.n-hd button.n-acct').click();
  await page.locator('.n-account:not([hidden]) .n-account__tier').waitFor({ timeout: 20_000 });
}

async function openSizes(page: Page): Promise<void> {
  await page.locator('.n-account').getByRole('button', { name: /^YOUR SIZES/ }).click();
  await page.locator('.n-account:not([hidden]) .n-account__sizes-view').waitFor({ timeout: 20_000 });
}

const view = (page: Page) => page.locator('.n-account:not([hidden]) .n-account__sizes-view');
const fieldValues = (page: Page) => page.evaluate((kinds) => kinds.map((k) => (document.querySelector(`#account-size-${k}`) as HTMLSelectElement | null)?.value ?? null), KINDS);

/** The view while its sizes are unknown: no field, no SAVE. */
async function noFields(page: Page): Promise<void> {
  expect(await view(page).locator('select').count()).toBe(0);
  expect(await view(page).locator('form').count()).toBe(0);
  expect(await view(page).getByRole('button', { name: 'SAVE' }).count()).toBe(0);
}

type Check = (opened: OpenedState, demo: NocturneDemo) => Promise<void>;

const CASES: { state: UiState; check: Check }[] = [
  // ── Its failure: the sentence, the server's message, TRY AGAIN, no SAVE, no PUT; TRY AGAIN shows the sizes ──
  {
    state: landing('sizes-e2e-failed', {
      routes: async (page) => page.route(SIZES, (r) => (r.request().method() === 'GET' ? r.abort('internetdisconnected') : r.continue())),
    }),
    check: async ({ page }) => {
      const sent = puts(page);
      await openSheet(page);
      await settle(page, 400);
      expect(await page.locator('.n-account__sizes-line').count()).toBe(0);
      await openSizes(page);
      const error = view(page).locator('.n-account__sizes-error');
      await error.waitFor({ timeout: 20_000 });
      expect(await error.innerText()).toBe(`Your sizes could not be shown just now. ${REQUEST_ERRORS.network}`);
      expect(await error.getAttribute('role')).toBe('alert');
      await noFields(page);
      expect(await view(page).getByRole('button').allInnerTexts()).toEqual(['TRY AGAIN', 'CANCEL']);
      // CANCEL goes back; the view opened again is still without a field.
      await view(page).getByRole('button', { name: 'CANCEL' }).click();
      await openSizes(page);
      await error.waitFor({ timeout: 20_000 });
      await noFields(page);
      // The server answers again: TRY AGAIN shows the sizes saved.
      await page.unroute(SIZES);
      await view(page).getByRole('button', { name: 'TRY AGAIN' }).click();
      await view(page).locator('form').waitFor({ timeout: 20_000 });
      expect(await fieldValues(page)).toEqual(SAVED);
      expect(await view(page).locator('.n-account__sizes-error').count()).toBe(0);
      await view(page).getByRole('button', { name: 'CANCEL' }).click();
      await page.locator('.n-account__sizes-line', { hasText: 'RING 52 · BRACELET 17 CM' }).waitFor({ timeout: 20_000 });
      expect(sent).toEqual([]);
    },
  },
  // ── Held: ONE MOMENT…, no field; once read, the sizes saved, and SAVE sends them as they were (last: it writes) ──
  {
    state: landing('sizes-e2e-held', { routes: async (_page, hold) => hold.hold(SIZES), mutates: true }),
    check: async ({ page, holds }) => {
      const sent = puts(page);
      await openSheet(page);
      expect(await page.locator('.n-account__sizes-line').count()).toBe(0);
      await openSizes(page);
      expect((await view(page).locator('.n-account__sizes-loading').innerText()).trim()).toBe('ONE MOMENT…');
      expect(await view(page).locator('.n-account__sizes-loading').getAttribute('role')).toBe('status');
      await noFields(page);
      holds.releaseAll();
      await view(page).locator('form').waitFor({ timeout: 20_000 });
      expect(await fieldValues(page)).toEqual(SAVED);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('account-sizes-title');
      await view(page).getByRole('button', { name: 'SAVE' }).click();
      await page.getByText('Your sizes are saved.').first().waitFor({ timeout: 20_000 });
      expect(sent).toEqual([{ sizes: { RING: 52, BRACELET: 17, WRIST: null, NECKLACE: null } }]);
      expect((await page.locator('.n-account__sizes-line').innerText()).trim()).toBe('RING 52 · BRACELET 17 CM');
    },
  },
  // ── Signed out, another account signed in, in the same tab: nothing of the first account's sizes (last: its SIGN OUT
  // ends the session of `sized` the others open with) ──
  {
    state: landing('sizes-e2e-another-account', { mutates: true }),
    check: async ({ page }, demo) => {
      const sent = puts(page);
      await openSheet(page);
      await page.locator('.n-account__sizes-line', { hasText: 'RING 52 · BRACELET 17 CM' }).waitFor({ timeout: 20_000 });
      await page.locator('.n-account').getByRole('button', { name: 'SIGN OUT' }).click();
      await page.locator('.n-hd a.n-acct:not([hidden])').waitFor({ timeout: 20_000 });
      // The second account's sizes held while it signs in and opens the sheet.
      const held = gate();
      await page.route(SIZES, async (r) => {
        if (r.request().method() === 'GET') await held.promise;
        await r.continue().catch(() => {});
      });
      await page.locator('.n-hd a.n-acct').click();
      await page.locator('input[name=email]').first().waitFor({ timeout: 20_000 });
      await page.locator('input[name=email]').first().fill(demo.accounts.sizer!.email);
      await page.locator('input[name=password]').first().fill(NOCTURNE_PASSWORD);
      await page.locator('form button[type=submit]').first().click();
      await page.locator('.n-hd button.n-acct:not([hidden])').waitFor({ timeout: 20_000 });
      await openSheet(page);
      await settle(page, 400);
      expect(await page.locator('.n-account__sizes-line').count()).toBe(0);
      await openSizes(page);
      expect((await view(page).locator('.n-account__sizes-loading').innerText()).trim()).toBe('ONE MOMENT…');
      await noFields(page);
      held.open();
      await view(page).locator('form').waitFor({ timeout: 20_000 });
      expect(await fieldValues(page)).toEqual(['', '', '', '']);
      await view(page).getByRole('button', { name: 'CANCEL' }).click();
      await page.locator('.n-account__sizes-line', { hasText: /^NOT SET$/ }).waitFor({ timeout: 20_000 });
      expect(sent).toEqual([]);
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('YOUR SIZES in the account sheet (AC-01, Chromium)', () => {
  it(
    'opens its fields only on the sizes read for the account signed in: ONE MOMENT… while they are read, the sentence and TRY AGAIN with no SAVE when they cannot be, nothing of an earlier account',
    async () => {
      const failures: string[] = [];
      await eachState(
        CASES.map((c) => c.state),
        async (state, run) => {
          const c = CASES.find((x) => x.state.id === state.id)!;
          const opened = await openState(run.browser, run.stage, run.demo, state);
          try {
            await c.check(opened, run.demo);
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
