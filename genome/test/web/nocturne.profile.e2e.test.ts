/**
 * YOUR PROFILE end to end (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.4, P.8, P.13, P.16; step 1.9), on the
 * NOCTURNE stage (test/support/nocturne-states.ts), outside the content shards, in Chromium at the stage's phone:
 *
 *  - CREATE ACCOUNT with the names, COUNTRY preselected from the connection (the sign-up's answer read as it would be
 *    behind Cloudflare: FR) and HOW DID YOU HEAR ABOUT ORBES? Other with its words; the account sheet then reads YOUR
 *    PROFILE after MESSAGES with its percentage, and the view opens on what was given;
 *  - its states: ONE MOMENT… while it reads (no field, no SAVE); unreadable, the sentence, TRY AGAIN, CANCEL;
 *  - fill and SAVE: CITY, the phone (COUNTRY CODE following COUNTRY), INSTAGRAM, YOUR TASTES; 'Your profile is saved.'
 *    on the account view, the focus on the row, its percentage read again;
 *  - YOUR ADDRESSES and back: ADD AN ADDRESS from the profile, ‹ YOUR PROFILE, what was typed kept, the address read again;
 *  - changed meanwhile by ORBES Client Services: 409, the profile read again and drawn as it is now, the sentence;
 *  - CONFIRM YOUR DATE OF BIRTH: a second press, a change to the date going back to SAVE; then the date read only and
 *    WRITE TO ORBES CLIENT SERVICES opening MESSAGES;
 *  - at 390, 375, 360 and 320 px: no sideways scroll, every control's 44 px zone and 10 px type.
 * No CSP violation, no page error.
 */
import { existsSync } from 'node:fs';
import type { Page, Request } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_PROFILE, MESSAGES, REQUEST_ERRORS, TASTES } from '../../src/web/verify/copy.js';
import { NOCTURNE_ADMIN, NOCTURNE_PASSWORD, type NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, type OpenedState, type UiState } from '../support/nocturne-states.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { CHROMIUM_PATH, type UiStage } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const PROFILE = '**/api/v1/account/profile';
const EMAIL = 'camille.profile@example.com';
const POLL = { timeout: 20_000, interval: 100 };

const signedOut = (id: string, extra: Partial<UiState> = {}): UiState => ({
  id,
  title: 'MY PIECES, signed out: CREATE ACCOUNT, then YOUR PROFILE',
  refs: ['CUSTOMER INTELLIGENCE §3.1'],
  variant: 'full',
  path: () => '/verify/pieces',
  ready: '.view--pieces form',
  ...extra,
});

const sheet = (page: Page) => page.locator('.n-account:not([hidden])');
const view = (page: Page) => page.locator('.n-account:not([hidden]) .n-profile');
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

/** The PUTs of YOUR PROFILE the page sends, as their bodies. */
function puts(page: Page): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/v1/account/profile') out.push(r.postDataJSON() as Record<string, unknown>);
  });
  return out;
}

async function openSheet(page: Page): Promise<void> {
  await page.locator('.n-hd button.n-acct').click();
  await sheet(page).locator('.n-account__tier').waitFor({ timeout: 20_000 });
}

async function openProfile(page: Page): Promise<void> {
  await sheet(page).getByRole('button', { name: /^YOUR PROFILE/ }).click();
  await view(page).waitFor({ timeout: 20_000 });
}

/** No sideways scroll, every control's 44 px zone and 10 px type, at the stage's phone and the narrower ones. */
async function fitsEveryPhone(page: Page, where: string, failures: string[]): Promise<void> {
  const before = page.viewportSize()!;
  for (const width of [390, 375, 360, 320]) {
    await page.setViewportSize({ width, height: before.height });
    await settle(page, 150);
    const wide = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.n-account__panel');
      return { page: document.documentElement.scrollWidth > window.innerWidth, panel: panel ? panel.scrollWidth > panel.clientWidth : false };
    });
    if (wide.page || wide.panel) failures.push(`${where} at ${width} px: sideways scroll ${JSON.stringify(wide)}`);
    const floors = await tapZoneFloors(page);
    for (const p of floors.problems) failures.push(`${where} at ${width} px: ${p}`);
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
    // The sign-up's answer as behind Cloudflare in France (the stage's connection has no country): COUNTRY preselected.
    state: signedOut('profile-e2e-sign-up', {
      mutates: true,
      routes: async (page) =>
        page.route('**/api/v1/account/sign-up', async (r) => {
          const res = await r.fetch();
          await r.fulfill({ response: res, json: { ...((await res.json()) as object), country: 'FR' } });
        }),
    }),
    check: async ({ page, stage }, _demo, failures) => {
      const sent = puts(page);
      // ── CREATE ACCOUNT: the names, the country preselected, Other with its words ──
      await page.locator('.view--pieces').getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).first().click();
      const form = page.locator('.view--pieces form.form--create');
      await expect.poll(() => form.locator('#auth-country').inputValue(), POLL).toBe('FR');
      await form.getByLabel('FIRST NAME', { exact: true }).fill('Camille');
      await form.getByLabel('LAST NAME', { exact: true }).fill('Laurent');
      await form.getByLabel('EMAIL', { exact: true }).fill(EMAIL);
      await form.getByLabel('PASSWORD', { exact: true }).fill(NOCTURNE_PASSWORD);
      await form.locator('#auth-heard').selectOption({ label: 'Other' });
      await form.getByLabel('IN A FEW WORDS (OPTIONAL)').fill('A dinner in Lyon');
      await form.getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).click();
      await page.locator('.n-hd button.n-acct:not([hidden])').waitFor({ timeout: 20_000 });

      // ── The account sheet: YOUR PROFILE right after MESSAGES, its percentage ──
      await openSheet(page);
      await sheet(page).locator('.n-account__profile-line').waitFor({ timeout: 20_000 });
      const rows = (await sheet(page).locator('.n-account__rows .n-row__label').allInnerTexts()).map(norm);
      expect(rows.slice(0, 4)).toEqual(['MESSAGES', 'YOUR PROFILE', 'YOUR SIZES', 'YOUR ADDRESSES']);
      // The names, the country and how they heard: 3 of the 10 items (the demo's collection offers pieces and finishes).
      expect(norm(await sheet(page).locator('.n-account__profile-line').innerText())).toBe('30% COMPLETE');

      // ── Its states: unreadable (the sentence, TRY AGAIN, CANCEL, no field) ──
      await page.route(PROFILE, (r) => (r.request().method() === 'GET' ? r.abort('internetdisconnected') : r.continue()));
      await page.keyboard.press('Escape');
      await expect.poll(() => page.locator('.n-account:not([hidden])').count(), POLL).toBe(0);
      await openSheet(page);
      await settle(page, 400);
      expect(await sheet(page).locator('.n-account__profile-line').count()).toBe(0);
      await openProfile(page);
      const error = view(page).locator('.n-profile__error');
      await error.waitFor({ timeout: 20_000 });
      expect(await error.innerText()).toBe(`${ACCOUNT_PROFILE.unreadable} ${REQUEST_ERRORS.network}`);
      expect(await view(page).locator('form').count()).toBe(0);
      expect((await view(page).getByRole('button').allInnerTexts()).map(norm)).toEqual(['YOUR ACCOUNT', 'TRY AGAIN', 'CANCEL']);
      // ── Then held: ONE MOMENT…, no field; TRY AGAIN shows the fields once read ──
      await page.unroute(PROFILE);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await page.route(PROFILE, async (r) => {
        if (r.request().method() === 'GET') await held;
        await r.continue().catch(() => {});
      });
      await view(page).getByRole('button', { name: 'TRY AGAIN' }).click();
      await view(page).locator('.n-profile__loading').waitFor({ timeout: 20_000 });
      expect(norm(await view(page).locator('.n-profile__loading').innerText())).toBe('ONE MOMENT…');
      expect(await view(page).locator('form').count()).toBe(0);
      release();
      await view(page).locator('form.form--profile').waitFor({ timeout: 20_000 });
      await page.unroute(PROFILE);

      // ── The view: what was given at sign-up ──
      expect(await view(page).locator('#profile-first-name').inputValue()).toBe('Camille');
      expect(await view(page).locator('#profile-last-name').inputValue()).toBe('Laurent');
      expect(await view(page).locator('#profile-country').inputValue()).toBe('FR');
      expect(await view(page).locator('#profile-phone-code').inputValue()).toBe('FR');
      expect(await view(page).locator('#profile-heard-other').inputValue()).toBe('A dinner in Lyon');
      expect(norm(await view(page).locator('.n-profile__completion').innerText())).toBe(
        'Your profile is 30% complete. Missing: your date of birth, your city, your address, your phone, your Instagram, your favourite pieces and your favourite finishes.',
      );
      expect((await view(page).locator('.n-profile__group-label').allInnerTexts()).map(norm)).toEqual(['YOU', 'WHERE YOU ARE', 'CONTACT', 'YOUR TASTES', 'HOW YOU FOUND ORBES']);
      expect(norm(await view(page).locator('.n-profile__address-none').innerText())).toBe(ACCOUNT_PROFILE.addressNone);
      await fitsEveryPhone(page, 'YOUR PROFILE', failures);

      // ── COUNTRY CODE follows COUNTRY until changed by hand ──
      await view(page).locator('#profile-country').selectOption('IT');
      expect(await view(page).locator('#profile-phone-code').inputValue()).toBe('IT');
      await view(page).locator('#profile-country').selectOption('FR');
      expect(await view(page).locator('#profile-phone-code').inputValue()).toBe('FR');

      // ── YOUR ADDRESSES and back: ADD AN ADDRESS, ‹ YOUR PROFILE, what was typed kept ──
      await view(page).locator('#profile-city').fill('Paris');
      await view(page).locator('#profile-instagram').fill('@Camille.L');
      await view(page).getByRole('button', { name: ACCOUNT_PROFILE.addressAdd }).click();
      const addresses = sheet(page).locator('.n-account__addresses-view');
      await addresses.locator('form').waitFor({ timeout: 20_000 });
      expect(norm(await sheet(page).locator('[data-key="addresses-back"]').innerText())).toBe(ACCOUNT_PROFILE.backToProfile);
      await addresses.locator('input[name="name"]').fill('Camille Laurent');
      await addresses.locator('textarea[name="address"]').fill('8 rue Saint-Honoré\n75001 Paris');
      await addresses.locator('input[name="phone"]').fill('+33 6 12 34 56 78');
      await addresses.getByRole('button', { name: 'SAVE', exact: true }).click();
      await addresses.locator('.n-account__address').first().waitFor({ timeout: 20_000 });
      await sheet(page).locator('[data-key="addresses-back"]').click();
      await view(page).locator('form.form--profile').waitFor({ timeout: 20_000 });
      expect(await view(page).locator('#profile-city').inputValue()).toBe('Paris');
      expect(await view(page).locator('#profile-instagram').inputValue()).toBe('@Camille.L');
      await expect.poll(async () => norm(await view(page).locator('.n-profile__address-line').innerText().catch(() => '')), POLL).toBe('Camille Laurent · 8 rue Saint-Honoré · France DEFAULT');

      // ── Fill and SAVE: the phone, YOUR TASTES ──
      await view(page).locator('#profile-phone-number').fill('06 12 34 56 78');
      const piece = view(page).getByRole('group', { name: TASTES.pieces }).getByRole('button', { name: 'BRACELET' });
      await piece.click();
      expect(await piece.getAttribute('aria-pressed')).toBe('true');
      await view(page).getByRole('group', { name: TASTES.finishes }).getByRole('button', { name: /GOLD/i }).click();
      await view(page).getByRole('button', { name: 'SAVE', exact: true }).click();
      await sheet(page).getByText(ACCOUNT_PROFILE.saved).first().waitFor({ timeout: 20_000 });
      expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key)).toBe('profile');
      expect(norm(await sheet(page).locator('.n-account__profile-line').innerText())).toBe('90% COMPLETE');
      expect(sent.at(-1)).toMatchObject({
        firstName: 'Camille',
        lastName: 'Laurent',
        country: 'FR',
        city: 'Paris',
        phone: { country: 'FR', number: '06 12 34 56 78' },
        instagram: '@Camille.L',
        tastes: { pieces: ['BRACELET'], finishes: ['GOLD'] },
      });
      expect('birthDate' in sent.at(-1)!).toBe(false);
      const id = (await stage.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', EMAIL).executeTakeFirstOrThrow()).id;
      const saved = await stage.ctx.services.profiles.forCollector(id);
      expect(saved.profile).toMatchObject({ city: 'Paris', phone: { country: 'FR', number: '+33612345678' }, instagram: 'camille.l' });

      // ── Changed meanwhile by ORBES Client Services: 409, read again, drawn as it is now ──
      await openProfile(page);
      await view(page).locator('form.form--profile').waitFor({ timeout: 20_000 });
      expect(await view(page).locator('#profile-phone-number').inputValue()).toBe('6 12 34 56 78');
      const now = await stage.ctx.services.profiles.forCollector(id);
      await stage.ctx.services.profiles.saveByStaff(
        id,
        { version: now.profile.version, firstName: 'Camille', lastName: 'Laurent', country: 'FR', city: 'Lyon', phone: now.profile.phone, instagram: 'camille.l', heard: { optionId: now.profile.heard!.optionId, other: now.profile.heard!.other }, tastes: { pieces: ['BRACELET'], finishes: ['GOLD'] } },
        await adminActor(stage),
      );
      await view(page).locator('#profile-city').fill('Nice');
      await view(page).getByRole('button', { name: 'SAVE', exact: true }).click();
      await view(page).locator('.n-profile__note').waitFor({ timeout: 20_000 });
      expect(norm(await view(page).locator('.n-profile__note').innerText())).toBe(ACCOUNT_PROFILE.changed);
      expect(await view(page).locator('.n-profile__note').getAttribute('role')).toBe('alert');
      expect(await view(page).locator('#profile-city').inputValue()).toBe('Lyon');

      // ── CONFIRM YOUR DATE OF BIRTH: a second press; a change to the date goes back to SAVE ──
      await view(page).locator('#profile-dob-day').selectOption('14');
      await view(page).locator('#profile-dob-month').selectOption('03');
      await view(page).locator('#profile-dob-year').selectOption('1994');
      const count = sent.length;
      await view(page).getByRole('button', { name: 'SAVE', exact: true }).click();
      await view(page).getByRole('button', { name: ACCOUNT_PROFILE.birthConfirm }).waitFor({ timeout: 20_000 });
      expect(norm(await view(page).locator('.n-profile__confirm').innerText())).toBe('14 MARCH 1994. Once saved, only ORBES Client Services can change it.');
      expect(sent.length).toBe(count);
      await view(page).locator('#profile-dob-day').selectOption('15');
      await view(page).getByRole('button', { name: 'SAVE', exact: true }).waitFor({ timeout: 20_000 });
      expect(await view(page).locator('.n-profile__confirm').isVisible()).toBe(false);
      await view(page).locator('#profile-dob-day').selectOption('14');
      await view(page).getByRole('button', { name: 'SAVE', exact: true }).click();
      await view(page).getByRole('button', { name: ACCOUNT_PROFILE.birthConfirm }).click();
      await sheet(page).getByText(ACCOUNT_PROFILE.saved).first().waitFor({ timeout: 20_000 });
      expect(sent.at(-1)!.birthDate).toBe('1994-03-14');
      expect(norm(await sheet(page).locator('.n-account__profile-line').innerText())).toBe('COMPLETE');

      // ── The date read only, WRITE TO ORBES CLIENT SERVICES opening MESSAGES ──
      await openProfile(page);
      await view(page).locator('form.form--profile').waitFor({ timeout: 20_000 });
      expect(norm(await view(page).locator('.n-profile__dob-date').innerText())).toBe('14 MARCH 1994');
      expect(await view(page).locator('#profile-dob-day').count()).toBe(0);
      expect(norm(await view(page).locator('.n-profile__dob-set .n-fld__hint').innerText())).toBe(ACCOUNT_PROFILE.birthSet);
      expect(norm(await view(page).locator('.n-profile__completion').innerText())).toBe(ACCOUNT_PROFILE.done);
      await fitsEveryPhone(page, 'YOUR PROFILE complete', failures);
      await view(page).getByRole('button', { name: MESSAGES.write }).click();
      await sheet(page).locator('#account-messages-title').waitFor({ timeout: 20_000 });
      expect(norm(await sheet(page).locator('#account-messages-title').innerText())).toBe(MESSAGES.title);
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1, Chromium)', () => {
  it(
    'signs up with the names and the country preselected, then reads, fills, saves, goes to YOUR ADDRESSES and back, is read again when changed meanwhile, and takes the date of birth once',
    async () => {
      const failures: string[] = [];
      await eachState(
        CASES.map((c) => c.state),
        async (state, run) => {
          const c = CASES.find((x) => x.state.id === state.id)!;
          const opened = await openState(run.browser, run.stage, run.demo, state);
          const problems: string[] = [];
          opened.page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
          opened.page.on('console', (m) => {
            if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
          });
          try {
            await c.check(opened, run.demo, failures);
          } catch (e) {
            failures.push(`${state.id}: ${(e as Error).message}`);
          } finally {
            failures.push(...problems.map((p) => `${state.id}: ${p}`));
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
