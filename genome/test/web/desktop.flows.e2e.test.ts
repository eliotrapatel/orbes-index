/**
 * The desktop's flows end to end against the real server (plan DESKTOP §2(j), step 13): the NOCTURNE demo served by
 * buildApp on its in-memory database, driven in Chromium on a computer (a mouse, no touch) at 1440 × 900 and
 * 1024 × 768, dark and light, a fresh stage for each. No hook and no route: every request reaches the server, which
 * the tests read back. On every page reached: the computer's layout in the look's mode, nothing sideways, no label or
 * button on two lines; no page error, console error or CSP report.
 *
 *  - The SCAN page (decision 4): its code decodes to https://verify.theorbes.com/verify (read from the screen, test
 *    support qr-read.ts), whole pixels per module on white with its quiet zone; UPLOAD A PHOTO of a demo code reaches its
 *    real result (AUTHENTIC, SCAN current in the bar); a photo with no code says NO ORBES CODE FOUND; a file that is no
 *    photo, PHOTO NOT READABLE.
 *  - Sign in and create account (decision 6): from a draw, CREATE ACCOUNT opens the sign-in page on its form; the first
 *    and last name, the country and how they heard, then back on the draw, signed in, the account kept by the server with
 *    them; SIGN OUT on YOUR ACCOUNT; from MY PIECES, SIGN IN and back on MY PIECES; FORGOTTEN PASSWORD? and a recovery code
 *    ORBES Client Services issues: SET A NEW PASSWORD, then SIGN IN with it.
 *  - YOUR ACCOUNT's pages (decision 5): YOUR PROFILE saved, YOUR SIZES saved, YOUR ADDRESSES (added, made the default,
 *    edited, removed at the second click: CLICK AGAIN TO REMOVE), CHANGE PASSWORD, YOUR WISHLIST from a model's heart,
 *    each card's line following; LIGHT MODE switched on its page.
 *  - MESSAGES (decision 5, D14): WRITE TO ORBES CLIENT SERVICES on a piece opens MESSAGES on its subject, SEND writes it
 *    there; ORBES Client Services answers: YOUR ACCOUNT's card reads 1 UNREAD; MESSAGES opens on the answer and reads it
 *    (the server's count 0, the card without its line); a reply stays on the piece (its context, `concerning.ref`); on
 *    THE PRIVATE SALON's model, two messages in a row both on the model; a reply on a scan over 24 hours old goes under
 *    GENERAL (no context), MESSAGE SENT, no alert.
 *  - An order's page (decision 5): the RESERVED order's DELIVERY ADDRESS added (saved to YOUR ADDRESSES) and its ENGRAVING
 *    entered, until packing; once the agent begins packing, both locked; the order delivered within 14 days: REQUEST A
 *    RETURN, then RETURN REQUESTED on its page; YOUR NEW CLAIM CODE: SHOW THE CODE, the code, COPY CODE (the clipboard
 *    holds it), the card's computer sentence; DOCUMENTS' ORBES CARE CONDITIONS · PDF saved as a PDF.
 *  - A PLATINE piece's PRIVATE CARE: REQUEST PRIVATE CARE, its return address, CONFIRM REQUEST: REQUESTED, the server's.
 *  - A draw: ENTER THE DRAW, entered (the server's entry), YOUR ENTRY.
 *  - The sign-in page opened from a LIVE RELEASE, then left by the menu: the release's page it kept is let go (no request
 *    of the release once its stages come due).
 *  - The room (decision 7): ENTER THE ROOM, YOU’RE READY; at the turn, the seal held by the mouse, the space bar and Enter
 *    (let go early, the ring empties again), held 1.5 s: SECURED, the server's; the sound off on a computer (SOUND OFF, no
 *    tone played).
 */
import type { Download, Page } from 'playwright-core';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { NOCTURNE_PASSWORD, type NocturneDemo } from '../support/nocturne-demo.js';
import type { NocturneStage } from '../support/nocturne-stage.js';
import { settle, stateById, type UiState } from '../support/nocturne-states.js';
import { codePhoto, sleep } from '../support/ui-stage.js';
import { countPiecesIn, scanIntoParcel } from '../support/fulfil.js';
import { modulesFromPixels, readQr } from '../support/qr-read.js';
import { at, desktopProblems, HAS_CHROMIUM, LOOKS, norm, openIn, POLL, stages, type Look } from './desktop.harness.js';

const TIMEOUT = 8 * 60_000;

/** The sound module's voices and the vibrations asked for (an init script: a string, no transpiler helper in it). */
const STAND_INS = `
  window.__flows = { tones: [], sounds: 0 };
  const begin = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__flows.sounds += 1; return begin.apply(this, a); };
  const proto = (window.AudioContext || window.webkitAudioContext).prototype;
  const create = proto.createOscillator;
  proto.createOscillator = function () {
    const o = create.call(this);
    const set = o.frequency.setValueAtTime.bind(o.frequency);
    o.frequency.setValueAtTime = (v, t) => { window.__flows.tones.push(Math.round(v * 100) / 100); return set(v, t); };
    return o;
  };
`;

/** The page's clock moved on by `window.__skew` ms (an init script: a string, no transpiler helper in it). */
const SKEW = `
  window.__skew = 0;
  const realNow = Date.now;
  Date.now = () => realNow() + window.__skew;
`;

/** A flow's open page and what it collects: problems of layout and errors, checked once the flow ends. */
interface Flow {
  page: Page;
  problems: string[];
  /** The page checked where it stands: the computer's layout in the look, nothing sideways, no label on two lines. */
  holds(where: string, opts?: { h1?: boolean }): Promise<void>;
  close(): Promise<void>;
}

async function flow(st: NocturneStage, look: Look, state: UiState, extra: { permissions?: string[] } = {}): Promise<Flow> {
  const opened = await openIn(st, state, look);
  if (extra.permissions) await opened.context.grantPermissions(extra.permissions, { origin: st.stage.origin });
  const problems: string[] = [];
  return {
    page: opened.page,
    problems,
    holds: async (where, opts) => {
      problems.push(...(await desktopProblems(opened.page, look, `${where} (${look.name})`, opts)));
    },
    close: async () => {
      problems.push(...opened.errors.map((e) => `(${look.name}) ${e}`));
      await opened.close();
    },
  };
}

const text = (page: Page, selector: string) => page.locator(selector).first().innerText().then(norm);
const visible = (page: Page, selector: string) => page.locator(selector).first().waitFor({ state: 'visible', timeout: 20_000 });
const pathOf = (page: Page) => new URL(page.url()).pathname;
/** The top bar's account (its link, or SIGN IN), the one shown. */
const ACCOUNT = 'header.n-hd a.n-acct:not([hidden])';
const admin = async (st: NocturneStage) => ({ type: 'admin' as const, id: (await st.stage.ctx.db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id });

describe.skipIf(!HAS_CHROMIUM)('desktop flows against the real server (Chromium, a computer)', () => {
  const { withStage } = stages();

  for (const [n, look] of LOOKS.entries()) {
    it(
      `${look.name}: the SCAN page: its code decodes to the app’s address; UPLOAD A PHOTO reaches the real result, NO ORBES CODE FOUND and PHOTO NOT READABLE`,
      async () => {
        await withStage('full', async (st) => {
          const f = await flow(st, look, at('full', '/verify/scan', '.view--scanpage .d-scanpage__code svg'));
          const { page } = f;
          try {
            await f.holds('the SCAN page');
            // The code as the screen shows it: whole pixels per module, white round it, read back.
            const svg = page.locator('.view--scanpage svg.d-scanpage__qr');
            expect(await svg.getAttribute('aria-label')).toBe('A code for your phone’s camera: it opens verify.theorbes.com/verify');
            const count = Number(await svg.getAttribute('data-modules'));
            const box = (await svg.boundingBox())!;
            expect(box.width).toBeCloseTo(box.height, 3);
            expect((box.width / count) % 1).toBe(0);
            expect(box.width / count).toBeGreaterThanOrEqual(4);
            const shot = PNG.sync.read(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } }));
            const modules = modulesFromPixels(new Uint8Array(shot.data), shot.width, { x: 0, y: 0, size: shot.width }, count, 4);
            expect(readQr(modules)).toMatchObject({ level: 'M', text: 'https://verify.theorbes.com/verify' });
            expect(norm(await page.locator('.view--scanpage').innerText())).not.toMatch(/\bQR\b/i);
            expect(await text(page, '.view--scanpage .d-scanpage__address')).toMatch(/^verify\.theorbes\.com\/verify$/i);

            // UPLOAD A PHOTO of the piece to register: its real result.
            const upload = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
              const chooser = page.waitForEvent('filechooser');
              await page.getByRole('button', { name: 'UPLOAD A PHOTO', exact: true }).click();
              await (await chooser).setFiles(file);
            };
            await upload({ name: 'orbes-code.png', mimeType: 'image/png', buffer: codePhoto(st.demo.codes.first!) });
            await page.locator('.view--result .n-result__title').waitFor({ timeout: 30_000 });
            await settle(page, 600);
            expect(await text(page, '.view--result .n-result__title')).toMatch(/AUTHENTIC/);
            expect(norm(await page.locator('.view--result').innerText())).toMatch(/FIRST REGISTRATION/);
            expect(await page.locator('header.n-hd a.n-hd__scan').getAttribute('aria-current')).toBe('page');
            expect(await st.stage.ctx.db.selectFrom('scan_events').select('id').executeTakeFirst()).toBeTruthy();
            await f.holds('the result of a photo');

            // A photo with no code, then a file that is no photo.
            for (const [file, title] of [
              [{ name: 'blank.png', mimeType: 'image/png', buffer: blankPng() }, 'NO ORBES CODE FOUND'],
              [{ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not a photo at all') }, 'PHOTO NOT READABLE'],
            ] as const) {
              await page.goto(`${st.stage.origin}/verify/scan`);
              await page.locator('.view--scanpage .d-scanpage__code svg').waitFor();
              await upload(file);
              await page.locator('.view--message').waitFor({ timeout: 30_000 });
              await expect.poll(() => text(page, '.view--message h1'), POLL).toBe(title);
              await f.holds(title);
            }
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: CREATE ACCOUNT from a draw and back to it; SIGN OUT; SIGN IN from MY PIECES and back; FORGOTTEN PASSWORD? with a recovery code`,
      async () => {
        await withStage('full', async (st) => {
          const email = `desk.${n}@example.com`;
          const f = await flow(st, look, at('full', (d) => `/verify/releases/${d.releases.draw}`, '.view--release .d-signin-line'));
          const { page } = f;
          try {
            const draw = pathOf(page);
            await f.holds('a draw, signed out');
            // CREATE ACCOUNT: the sign-in page on its form, the place's lead under the title.
            await page.locator('.view--release .d-signin-line').getByRole('link', { name: 'CREATE ACCOUNT', exact: true }).first().click();
            const form = page.locator('.view--signin form.form--create');
            await form.waitFor({ timeout: 20_000 });
            expect(pathOf(page)).toBe('/verify/sign-in');
            await f.holds('CREATE ACCOUNT');
            await form.getByLabel('FIRST NAME', { exact: true }).fill('Ines');
            await form.getByLabel('LAST NAME', { exact: true }).fill('Moreau');
            await form.getByLabel('EMAIL', { exact: true }).fill(email);
            await form.getByLabel('PASSWORD', { exact: true }).fill(NOCTURNE_PASSWORD);
            await form.locator('#auth-country').selectOption('FR');
            await form.locator('#auth-heard').selectOption({ label: 'A friend' });
            await form.getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).click();
            // Back on the draw, signed in: ENTER THE DRAW in the sign-in line's place.
            await page.getByRole('button', { name: 'ENTER THE DRAW', exact: true }).first().waitFor({ timeout: 20_000 });
            expect(pathOf(page)).toBe(draw);
            expect(await page.locator(ACCOUNT).getAttribute('href')).toBe('/verify/account');
            const account = await st.stage.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow();
            const profile = (await st.stage.ctx.services.profiles.forCollector(account.id)).profile;
            expect([profile.firstName, profile.lastName, profile.country, profile.heard?.optionId ? 'heard' : null]).toEqual(['Ines', 'Moreau', 'FR', 'heard']);
            await f.holds('the draw, signed in');

            // SIGN OUT on YOUR ACCOUNT: NOW, signed out.
            await page.locator(ACCOUNT).click();
            await page.locator('.view--account .d-acct__cards').waitFor({ timeout: 20_000 });
            await page.getByRole('button', { name: 'SIGN OUT', exact: true }).click();
            await page.locator('.view--now').waitFor({ timeout: 20_000 });
            await expect.poll(() => page.locator(ACCOUNT).innerText().then(norm), POLL).toBe('SIGN IN');

            // SIGN IN from MY PIECES, back on MY PIECES.
            await page.locator('header.n-hd a.n-rail__link', { hasText: /^PIECES/ }).click();
            await page.locator('.view--pieces .d-signin-line').getByRole('link', { name: 'SIGN IN', exact: true }).click();
            const signIn = page.locator('.view--signin form').first();
            await signIn.waitFor({ timeout: 20_000 });
            await signIn.locator('input[type=email]').fill(email);
            await signIn.locator('input[type=password]').fill(NOCTURNE_PASSWORD);
            await signIn.getByRole('button', { name: 'SIGN IN', exact: true }).click();
            await page.locator('.view--pieces .n-pieces__panel').waitFor({ timeout: 20_000 });
            expect(pathOf(page)).toBe('/verify/pieces');

            // FORGOTTEN PASSWORD? on the sign-in page: a recovery code from ORBES Client Services, a new password, then signed in with it.
            await page.locator(ACCOUNT).click();
            await page.locator('.view--account .d-acct__cards').waitFor({ timeout: 20_000 });
            await page.getByRole('button', { name: 'SIGN OUT', exact: true }).click();
            await page.locator('.view--now').waitFor({ timeout: 20_000 });
            await page.locator(ACCOUNT).click();
            await page.locator('.view--signin form').first().waitFor({ timeout: 20_000 });
            await page.getByRole('button', { name: 'FORGOTTEN PASSWORD?', exact: true }).click();
            await expect.poll(async () => norm(await page.locator('.view--signin').innerText()), POLL).toMatch(/FORGOTTEN PASSWORD/);
            expect(await page.locator('.view--signin').getByRole('link', { name: 'CONTACT ORBES CLIENT SERVICES' }).getAttribute('href')).toMatch(/^mailto:clientservices@example\.com\?/);
            await f.holds('FORGOTTEN PASSWORD');
            await page.getByRole('button', { name: 'I HAVE A RECOVERY CODE', exact: true }).click();
            const issued = await st.stage.ctx.services.recovery.issue(account.id, await admin(st));
            const recover = page.locator('.view--signin form').first();
            await recover.getByLabel('EMAIL', { exact: true }).fill(email);
            await recover.getByLabel('RECOVERY CODE', { exact: true }).fill(issued.recoveryCode);
            await recover.getByLabel('NEW PASSWORD', { exact: true }).fill(`${NOCTURNE_PASSWORD}-2`);
            await recover.getByRole('button', { name: 'SET NEW PASSWORD', exact: true }).click();
            await expect.poll(async () => norm(await page.locator('.view--signin').innerText()), POLL).toMatch(/Your password has been changed: sign in with it\./);
            await f.holds('the password set again');
            const again = page.locator('.view--signin form').first();
            if ((await again.locator('input[type=password]').count()) === 0) await page.getByRole('button', { name: 'BACK TO SIGN IN', exact: true }).click();
            await again.locator('input[type=email]').fill(email);
            await again.locator('input[type=password]').fill(`${NOCTURNE_PASSWORD}-2`);
            await again.getByRole('button', { name: 'SIGN IN', exact: true }).click();
            await expect.poll(() => page.locator(ACCOUNT).getAttribute('href'), POLL).toBe('/verify/account');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: YOUR ACCOUNT’s pages: YOUR PROFILE, YOUR SIZES, YOUR ADDRESSES, CHANGE PASSWORD and YOUR WISHLIST, each card following; LIGHT MODE`,
      async () => {
        await withStage('full', async (st) => {
          const sizer = st.demo.accounts.sizer!;
          const f = await flow(st, look, at('full', '/verify/account', '.view--account .d-acct__cards', { as: 'sizer' }));
          const { page } = f;
          const card = (key: string) => page.locator(`.view--account a.d-acct__card[href="${key}"]`);
          const back = async () => {
            await page.locator('.view--account a[href="/verify/account"]').first().click();
            await page.locator('.view--account .d-acct__cards').waitFor({ timeout: 20_000 });
          };
          try {
            await f.holds('YOUR ACCOUNT');
            // ── YOUR PROFILE ──
            await card('/verify/account/profile').click();
            const profile = page.locator('.view--account form.form--profile');
            await profile.waitFor({ timeout: 20_000 });
            expect(pathOf(page)).toBe('/verify/account/profile');
            await f.holds('YOUR PROFILE');
            await profile.locator('#profile-first-name').fill('Sacha');
            await profile.locator('#profile-last-name').fill('Girard');
            await profile.locator('#profile-country').selectOption('FR');
            await profile.locator('#profile-city').fill('Lyon');
            await profile.getByRole('button', { name: 'SAVE', exact: true }).click();
            await expect.poll(() => (st.stage.ctx.services.profiles.forCollector(sizer.id).then((r) => r.profile.city)), POLL).toBe('Lyon');
            await page.locator('.view--account .d-acct__cards').waitFor({ timeout: 20_000 });
            await expect.poll(() => text(page, '.view--account a.d-acct__card[href="/verify/account/profile"]'), POLL).toMatch(/YOUR PROFILE \d+% COMPLETE/);
            expect(await text(page, '.view--account a.d-acct__card[href="/verify/account/profile"]')).not.toMatch(/ 0% COMPLETE/);

            // ── YOUR SIZES ──
            await card('/verify/account/sizes').click();
            await page.locator('#account-size-ring').waitFor({ timeout: 20_000 });
            await f.holds('YOUR SIZES');
            await page.selectOption('#account-size-ring', '52');
            await page.getByRole('button', { name: 'SAVE', exact: true }).click();
            await page.getByText('Your sizes are saved.').first().waitFor({ timeout: 20_000 });
            await expect.poll(() => text(page, '.view--account a.d-acct__card[href="/verify/account/sizes"]'), POLL).toMatch(/RING 52/);

            // ── YOUR ADDRESSES: two added, the second made the default, the first edited, then removed ──
            await card('/verify/account/addresses').click();
            const view = page.locator('.view--account .d-acct__sub--addresses');
            await view.waitFor({ timeout: 20_000 });
            await f.holds('YOUR ADDRESSES');
            for (const [name, address, country, phone] of [
              ['Sacha Girard', '3 place Bellecour\n69002 Lyon', 'FR', '+33 6 11 22 33 44'],
              ['Sacha Girard', '10 Downing Street\nLondon SW1A 2AA', 'GB', '+44 20 7946 0001'],
            ] as const) {
              await view.getByRole('button', { name: 'ADD AN ADDRESS', exact: true }).click();
              await view.getByLabel('NAME', { exact: true }).fill(name);
              await view.getByLabel('ADDRESS', { exact: true }).fill(address);
              await view.getByLabel('COUNTRY', { exact: true }).selectOption(country);
              await view.getByLabel('PHONE', { exact: true }).fill(phone);
              await f.holds('YOUR ADDRESSES, a new address');
              await view.getByRole('button', { name: 'SAVE', exact: true }).click();
              await page.getByText('Your address is saved.').first().waitFor({ timeout: 20_000 });
            }
            await expect.poll(async () => (await st.stage.ctx.services.addresses.list(sizer.id)).addresses.length, POLL).toBe(2);
            await view.getByRole('button', { name: 'Make the address of Sacha Girard your default' }).first().click();
            await expect.poll(async () => (await st.stage.ctx.services.addresses.list(sizer.id)).addresses.find((a) => a.isDefault)?.country, POLL).toBe('GB');
            await view.getByRole('button', { name: 'Edit the address of Sacha Girard' }).last().click();
            await view.getByLabel('ADDRESS', { exact: true }).fill('4 place Bellecour\n69002 Lyon');
            await view.getByRole('button', { name: 'SAVE', exact: true }).click();
            await expect.poll(async () => (await st.stage.ctx.services.addresses.list(sizer.id)).addresses.some((a) => a.address.startsWith('4 place Bellecour')), POLL).toBe(true);
            const remove = view.getByRole('button', { name: 'Remove the address of Sacha Girard' }).last();
            await remove.click();
            await expect.poll(() => view.getByRole('button', { name: 'Click again to remove the address of Sacha Girard' }).count(), POLL).toBe(1);
            expect(norm(await view.innerText())).toMatch(/CLICK AGAIN TO REMOVE/);
            await view.getByRole('button', { name: 'Click again to remove the address of Sacha Girard' }).click();
            await page.getByText('The address is removed.').first().waitFor({ timeout: 20_000 });
            await expect.poll(async () => (await st.stage.ctx.services.addresses.list(sizer.id)).addresses.length, POLL).toBe(1);
            await back();
            await expect.poll(() => text(page, '.view--account a.d-acct__card[href="/verify/account/addresses"]'), POLL).toMatch(/1 SAVED/);

            // ── CHANGE PASSWORD ──
            await card('/verify/account/password').click();
            const password = page.locator('.view--account form').first();
            await password.waitFor({ timeout: 20_000 });
            await f.holds('CHANGE PASSWORD');
            await password.getByLabel('CURRENT PASSWORD', { exact: true }).fill(NOCTURNE_PASSWORD);
            await password.getByLabel('NEW PASSWORD', { exact: true }).fill(`${NOCTURNE_PASSWORD}-new`);
            await password.getByRole('button', { name: 'CHANGE PASSWORD', exact: true }).click();
            await page.getByText('Your password has been changed. Your other sessions have ended.').first().waitFor({ timeout: 20_000 });

            // ── YOUR WISHLIST: a model's heart, then its page; REMOVE ──
            await page.goto(`${st.stage.origin}/verify/lookbook/${st.demo.slugs.blue}`);
            await page.locator('.view--sheet').waitFor({ timeout: 20_000 });
            const heart = page.locator('.view--sheet button.n-heart').first();
            await heart.click();
            await expect.poll(() => heart.getAttribute('aria-pressed'), POLL).toBe('true');
            await page.goto(`${st.stage.origin}/verify/account`);
            await expect.poll(() => text(page, '.view--account a.d-acct__card[href="/verify/account/wishlist"]'), POLL).toMatch(/1 MODEL/);
            await card('/verify/account/wishlist').click();
            await page.locator('.view--wishlist[data-state="ready"], .view--wishlist .d-wish__name').first().waitFor({ timeout: 20_000 });
            expect(norm(await page.locator('.view--wishlist').innerText())).toMatch(/MONOLITHE/);
            await f.holds('YOUR WISHLIST');
            await page.locator('.view--wishlist button.n-wishlist__remove').first().click();
            await expect.poll(async () => (await st.stage.ctx.db.selectFrom('account_wishes').select('model_id').where('account_id', '=', sizer.id).where('removed_at', 'is', null).execute()).length, POLL).toBe(0);

            // ── LIGHT MODE on YOUR ACCOUNT: the page in the other mode, kept on the device ──
            await page.goto(`${st.stage.origin}/verify/account`);
            await page.locator('.view--account .d-acct__cards').waitFor({ timeout: 20_000 });
            await page.getByRole('switch', { name: 'LIGHT MODE' }).click({ force: true });
            await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode === 'light'), POLL).toBe(!look.light);
            expect(await page.evaluate(() => localStorage.getItem('orbes.mode'))).toBe(look.light ? null : 'light');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: MESSAGES: written from a piece on its subject, answered: 1 UNREAD, read, a reply on the same subject; a model’s subject written twice; a reply on a scan over 24 hours old, under GENERAL`,
      async () => {
        await withStage('full', async (st) => {
          const you = st.demo.accounts.you!;
          const f = await flow(st, look, at('full', (d) => `/verify/pieces/${d.pieces.yours}`, '.view--piece .n-piece__article', { as: 'you' }));
          const { page } = f;
          try {
            await page.locator('.view--piece').getByRole('button', { name: 'WRITE TO ORBES CLIENT SERVICES' }).first().click();
            const box = page.locator('.d-msg #messages-reply, .d-msg textarea').first();
            await box.waitFor({ timeout: 20_000 });
            expect(pathOf(page)).toMatch(/^\/verify\/messages\/piece-/);
            await f.holds('MESSAGES on a piece');
            await box.fill('Could the clasp be looked at during my visit to Paris?');
            await page.locator('.d-msg').getByRole('button', { name: 'SEND', exact: true }).click();
            await page.locator('.d-msg__sent, .d-msg ol.d-msg__conversation').first().waitFor({ timeout: 20_000 });
            await expect.poll(async () => (await st.stage.ctx.services.messages.thread(you.id)).messages.filter((m) => m.body.startsWith('Could the clasp')).length, POLL).toBe(1);
            const sent = (await st.stage.ctx.services.messages.thread(you.id)).messages.find((m) => m.body.startsWith('Could the clasp'))!;
            expect(sent.concerning?.kind).toBe('PIECE');

            // ORBES Client Services answers: YOUR ACCOUNT's card reads 1 UNREAD, the subject NEW.
            const conversation = await st.stage.ctx.db.selectFrom('client_conversations').select('id').where('account_id', '=', you.id).executeTakeFirstOrThrow();
            await st.stage.ctx.services.messages.answer(conversation.id, await admin(st), { body: 'Of course: come to the Paris boutique, we will look at it with you.' });
            await page.goto(`${st.stage.origin}/verify/account`);
            await expect.poll(() => text(page, '.view--account a.d-acct__card[href="/verify/messages"]'), POLL).toBe('MESSAGES 1 UNREAD');
            await f.holds('YOUR ACCOUNT, an answer unread');
            await page.locator('.view--account a.d-acct__card[href="/verify/messages"]').click();
            await page.locator('.d-msg ol.d-msg__conversation').waitFor({ timeout: 20_000 });
            await expect.poll(async () => norm(await page.locator('.d-msg ol.d-msg__conversation').innerText()), POLL).toMatch(/Of course: come to the Paris boutique/);
            await f.holds('MESSAGES, the answer');
            await expect.poll(async () => (await st.stage.ctx.services.messages.unreadCount(you.id)).count, POLL).toBe(0);
            // A reply stays on the piece.
            await page.locator('.d-msg textarea').first().fill('Thank you, I will come on Saturday.');
            await page.locator('.d-msg').getByRole('button', { name: 'SEND', exact: true }).click();
            await expect.poll(async () => (await st.stage.ctx.services.messages.thread(you.id)).messages.find((m) => m.body.startsWith('Thank you, I will come'))?.concerning?.ref ?? null, POLL).toBe(sent.concerning!.ref);
            await page.goto(`${st.stage.origin}/verify/account`);
            await page.locator('.view--account .d-acct__cards').waitFor({ timeout: 20_000 });
            await settle(page, 600);
            expect(await text(page, '.view--account a.d-acct__card[href="/verify/messages"]')).toBe('MESSAGES');
            // THE PRIVATE SALON's model requested (a subject with no id in its address): written twice in a row, both on the model.
            await page.goto(`${st.stage.origin}/verify/lookbook/${st.demo.slugs.zenith}`);
            await page.locator('.view--sheet').getByRole('button', { name: 'REQUEST THIS PIECE', exact: true }).click();
            await page.locator('.view--sheet .sheet__requested').waitFor({ timeout: 20_000 });
            await page.locator('.view--sheet').getByRole('button', { name: 'WRITE TO ORBES CLIENT SERVICES' }).first().click();
            await page.locator('.d-msg textarea').first().waitFor({ timeout: 20_000 });
            for (const body of ['Is ZENITH made in other sizes?', 'And in another finish?']) {
              await page.locator('.d-msg textarea').first().fill(body);
              await page.locator('.d-msg').getByRole('button', { name: 'SEND', exact: true }).click();
              await expect.poll(async () => (await st.stage.ctx.services.messages.thread(you.id)).messages.find((m) => m.body === body)?.concerning?.kind ?? null, POLL).toBe('MODEL');
              await expect.poll(async () => norm(await page.locator('.d-msg ol.d-msg__conversation').innerText()), POLL).toContain(body);
            }
            await f.holds('MESSAGES on a model');
            // A scan written about, answered the next day: the reply on its subject (the scan now over 24 hours old, which
            // the server no longer attaches) goes under GENERAL, as the phone sends a reply: MESSAGE SENT, no alert.
            const scan = await st.stage.ctx.db.selectFrom('scan_events').select('id').where('event_type', '!=', 'ADMIN_TEST').where('result_state', 'is not', null).orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
            await st.stage.ctx.db.updateTable('scan_events').set({ occurred_at: st.clock.now() }).where('id', '=', scan.id).execute();
            const onScan = (await st.stage.ctx.services.messages.write(you.id, { body: 'Is this the piece I was shown in the boutique?', context: { kind: 'SCAN', id: scan.id } }, you.actor)).message;
            expect(onScan.concerning?.kind).toBe('SCAN');
            await st.stage.ctx.db.updateTable('scan_events').set({ occurred_at: new Date(st.clock.now().getTime() - 25 * 3_600_000) }).where('id', '=', scan.id).execute();
            await page.goto(`${st.stage.origin}/verify/messages/scan-${scan.id.slice(0, 8)}`);
            await expect.poll(async () => norm(await page.locator('.d-msg ol.d-msg__conversation').innerText()), POLL).toContain('Is this the piece I was shown in the boutique?');
            await page.locator('.d-msg textarea').first().fill('Thank you for your answer.');
            await page.locator('.d-msg').getByRole('button', { name: 'SEND', exact: true }).click();
            await expect
              .poll(async () => {
                const reply = (await st.stage.ctx.services.messages.thread(you.id)).messages.find((m) => m.body === 'Thank you for your answer.');
                return reply ? (reply.concerning ?? null) : 'not written';
              }, POLL)
              .toBeNull();
            await expect.poll(() => text(page, '.d-msg .d-msg__sent'), POLL).toBe('MESSAGE SENT');
            expect(await page.locator('.d-msg [role="alert"]:not([hidden])').count()).toBe(0);
            await f.holds('MESSAGES, a reply under GENERAL');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: an order’s page: DELIVERY ADDRESS and ENGRAVING until packing, then locked; a return within 14 days; YOUR NEW CLAIM CODE and COPY CODE; ORBES CARE CONDITIONS · PDF`,
      async () => {
        // The full demo: you's RESERVED order (address, engraving, its conditions), its delivered draw (a return).
        await withStage('full', async (st) => {
          const you = st.demo.accounts.you!;
          const f = await flow(st, look, at('full', '/verify/pieces', '.view--pieces .n-pieces__panel', { as: 'you' }));
          const { page } = f;
          const order = async (row: RegExp) => {
            await page.goto(`${st.stage.origin}/verify/pieces`);
            await page.getByRole('tab', { name: /^ORDERS\s*\d*$/ }).first().click();
            await page.locator('.view--pieces .d-orow', { hasText: row }).first().click();
            await page.locator('.view--order .d-order__head').waitFor({ timeout: 20_000 });
            await settle(page, 300);
          };
          try {
            await order(/RESERVED/);
            expect(pathOf(page)).toMatch(/^\/verify\/orders\/OR-[0-9A-F]{8}$/);
            await f.holds('an order’s page');
            const reserved = (await st.stage.ctx.db.selectFrom('orders').select('id').where('account_id', '=', you.id).where('status', '=', 'RESERVED').executeTakeFirstOrThrow()).id;
            // DELIVERY ADDRESS: added in place, saved to YOUR ADDRESSES.
            await page.locator('.view--order').getByRole('button', { name: 'ADD THE DELIVERY ADDRESS', exact: true }).click();
            const form = page.locator('.view--order form').first();
            await form.getByLabel('NAME', { exact: true }).fill('Camille Laurent');
            await form.getByLabel('ADDRESS', { exact: true }).fill('8 rue Saint-Honoré\n75001 Paris');
            await form.getByLabel('COUNTRY', { exact: true }).selectOption('FR');
            await form.getByLabel('PHONE', { exact: true }).fill('+33 6 12 34 56 78');
            await f.holds('DELIVERY ADDRESS, its form');
            await form.getByRole('button', { name: 'CONFIRM', exact: true }).click();
            await expect.poll(async () => norm(await page.locator('.view--order .d-order__row--address').innerText()), POLL).toMatch(/Camille Laurent 8 rue Saint-Honoré 75001 Paris France/);
            expect((await st.stage.ctx.services.addresses.list(you.id)).addresses.map((a) => a.name)).toEqual(['Camille Laurent']);
            // ENGRAVING: the release's add-on, its words entered.
            await page.locator('.view--order').getByRole('button', { name: 'ENTER YOUR ENGRAVING', exact: true }).click();
            await page.locator('.view--order').getByLabel('YOUR ENGRAVING', { exact: true }).fill('C.L.');
            await page.locator('.view--order').getByRole('button', { name: 'SAVE', exact: true }).click();
            await expect.poll(async () => norm(await page.locator('.view--order').innerText()), POLL).toMatch(/« C\.L\. »/);
            expect((await st.stage.ctx.db.selectFrom('orders').select('engraving_text').where('id', '=', reserved).executeTakeFirstOrThrow()).engraving_text).toBe('C.L.');
            await f.holds('the order, its address and engraving');
            // DOCUMENTS: ORBES CARE CONDITIONS · PDF saved as a PDF.
            const download = page.waitForEvent('download');
            await page.locator('.view--order button.pieces__order-document', { hasText: 'ORBES CARE CONDITIONS' }).first().click();
            const pdf = await readDownload(await download);
            expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

            // The order delivered on 22 September: RETURNS AND EXCHANGES until 6 OCT, REQUEST A RETURN.
            await order(/DELIVERED/);
            const returns = page.locator('.view--order .d-order__row--returns');
            await returns.waitFor({ timeout: 20_000 });
            expect(norm(await returns.innerText())).toMatch(/until 6 OCT 2026/);
            // EXCHANGE THE SIZE: its sizes in stock, CANCEL; then REQUEST A RETURN.
            await returns.getByRole('button', { name: 'EXCHANGE THE SIZE', exact: true }).click();
            await page.locator('.view--order').getByRole('group', { name: 'THE NEW SIZE' }).waitFor({ timeout: 20_000 });
            await f.holds('EXCHANGE THE SIZE, its form');
            await page.locator('.view--order').getByRole('button', { name: 'CANCEL', exact: true }).first().click();
            await returns.getByRole('button', { name: 'REQUEST A RETURN', exact: true }).waitFor({ timeout: 20_000 });
            await returns.getByRole('button', { name: 'REQUEST A RETURN', exact: true }).click();
            const ask = page.locator('.view--order form').first();
            await ask.getByLabel('REASON', { exact: true }).selectOption('SIZE');
            await ask.getByLabel('YOUR NOTE', { exact: true }).fill('A size smaller, please.');
            await f.holds('REQUEST A RETURN, its form');
            await ask.getByRole('button', { name: 'SEND THE REQUEST', exact: true }).click();
            await expect.poll(async () => norm(await page.locator('.view--order').innerText()), POLL).toMatch(/RETURN REQUESTED · 5 OCT 2026/);
            expect(await st.stage.ctx.db.selectFrom('order_cases').select('kind').where('opened_by_id', '=', you.id).executeTakeFirst()).toMatchObject({ kind: 'RETURN' });
            await f.holds('RETURN REQUESTED');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
        // Packing begun (orders-delivery's stage): the address and the engraving locked on its page.
        await withStage('orders-delivery', async (st) => {
          const f = await flow(st, look, stateById('desk-order-delivery'));
          try {
            const page = f.page;
            expect(norm(await page.locator('.view--order .d-order__row--address').innerText())).toMatch(/Packing has begun\. To change the address, write to ORBES Client Services\./);
            expect(norm(await page.locator('.view--order').innerText())).toMatch(/Packing has begun\. The engraving no longer changes\./);
            expect(await page.locator('.view--order').getByRole('button', { name: /^(CHANGE|ADD THE DELIVERY ADDRESS|CHANGE THE ENGRAVING|ADD AN ENGRAVING)$/ }).count()).toBe(0);
            await f.holds('an order packing');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
        // YOUR NEW CLAIM CODE (claim-waiting's stage): SHOW THE CODE, the code, COPY CODE.
        await withStage('claim-waiting', async (st) => {
          const f = await flow(st, look, stateById('desk-order-claim-waiting'), { permissions: ['clipboard-read', 'clipboard-write'] });
          const { page } = f;
          try {
            await page.locator('.view--order').getByRole('button', { name: 'SHOW THE CODE', exact: true }).click();
            const code = page.locator('.view--order .pieces__claim').getByText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/).first();
            await code.waitFor({ timeout: 20_000 });
            const shown = norm(await code.innerText());
            expect(norm(await page.locator('.view--order .pieces__claim').innerText())).toMatch(/Print it, or open it on this screen and scan it with your phone\./);
            await page.locator('.view--order').getByRole('button', { name: 'COPY CODE', exact: true }).click();
            await page.getByText('The claim code has been copied.').first().waitFor({ timeout: 20_000 });
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
            // Shipped: REGISTER THIS PIECE offered with it.
            expect(await page.locator('.view--order').getByRole('button', { name: /^Register your .* with this claim code$/ }).count()).toBe(1);
            await f.holds('YOUR NEW CLAIM CODE, shown');
            // An order still to ship: the code, how the piece registers once it has arrived, no REGISTER THIS PIECE.
            const unshipped = await paidWithNewCode(st);
            await page.goto(`${st.stage.origin}/verify/orders/${unshipped}`);
            await page.locator('.view--order .d-order__head').waitFor({ timeout: 20_000 });
            await page.locator('.view--order').getByRole('button', { name: 'SHOW THE CODE', exact: true }).click();
            await page.locator('.view--order .pieces__claim').getByText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/).first().waitFor({ timeout: 20_000 });
            expect(norm(await page.locator('.view--order .pieces__claim').innerText())).toMatch(/Once your piece has arrived, register it by scanning the ORBES CODE on your new card, then entering this claim code\./);
            expect(await page.locator('.view--order').getByRole('button', { name: /^Register your .* with this claim code$/ }).count()).toBe(0);
            await f.holds('YOUR NEW CLAIM CODE, an order still to ship');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: PRIVATE CARE requested on a PLATINE piece; a draw entered`,
      async () => {
        await withStage('full', async (st) => {
          const voter = st.demo.accounts.voter1!;
          const f = await flow(st, look, stateById('piece-care-available'));
          const { page } = f;
          try {
            await f.holds('PRIVATE CARE');
            await page.locator('.view--piece').getByRole('button', { name: 'REQUEST PRIVATE CARE', exact: true }).click();
            const form = page.locator('.view--piece .piece__yearly-care form').first();
            await form.waitFor({ timeout: 20_000 });
            await form.getByLabel('NAME', { exact: true }).fill('Owner One');
            await form.getByLabel('ADDRESS', { exact: true }).fill('1 rue de la Paix\n75002 Paris\nFrance');
            await f.holds('PRIVATE CARE, its request');
            await form.getByRole('button', { name: 'CONFIRM REQUEST', exact: true }).click();
            await expect.poll(async () => norm(await page.locator('.view--piece .piece__yearly-care').innerText()), POLL).toMatch(/REQUESTED · 5 OCT 2026.*CANCEL REQUEST/);
            expect(await st.stage.ctx.db.selectFrom('care_requests').select('status').where('account_id', '=', voter.id).executeTakeFirst()).toBeTruthy();
            await f.holds('PRIVATE CARE requested');
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
          const d = await flow(st, look, at('full', (demo: NocturneDemo) => `/verify/releases/${demo.releases.draw}`, '.view--release section', { as: 'you' }));
          try {
            await d.page.locator('.view--release').getByLabel('YOUR ENTRY').getByRole('button', { name: 'ENTER THE DRAW', exact: true }).click();
            await d.page.getByText('You are entered in the draw.', { exact: false }).first().waitFor({ timeout: 20_000 });
            expect(await st.stage.ctx.db.selectFrom('drop_entries').select('id').where('account_id', '=', st.demo.accounts.you!.id).where('drop_id', '=', st.demo.releases.draw!).executeTakeFirst()).toBeTruthy();
            expect(norm(await d.page.locator('.view--release').innerText())).toMatch(/YOUR ENTRY/);
            await d.holds('a draw entered');
          } finally {
            await d.close();
          }
          expect(d.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: the room: ENTER THE ROOM; at the turn, the seal held by the mouse, the space bar and Enter, SECURED; the sound off`,
      async () => {
        await withStage('room', async (st) => {
          const f = await flow(st, look, stateById('room'));
          try {
            expect(await text(f.page, 'button.live__sound')).toBe('SOUND OFF');
            await f.page.getByRole('button', { name: 'ENTER THE ROOM', exact: true }).click();
            await f.page.getByText('YOU’RE READY').first().waitFor({ timeout: 20_000 });
            await f.holds('the room, entered', { h1: false });
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
        await withStage('live', async (st) => {
          const f = await flow(st, look, { ...stateById('live-turn'), routes: async (page) => page.addInitScript({ content: STAND_INS }) });
          const { page } = f;
          try {
            const turn = page.locator('.view--live .live__turn');
            const seal = page.locator('.view--live .live-hold');
            const holding = () => turn.getAttribute('class').then((c) => /is-holding/.test(c ?? ''));
            const box = (await seal.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            // Let go early, each way: the ring empties again, nothing secured.
            await page.mouse.down();
            await expect.poll(holding, POLL).toBe(true);
            await sleep(300);
            await page.mouse.up();
            await expect.poll(holding, POLL).toBe(false);
            await seal.focus();
            for (const key of [' ', 'Enter']) {
              await page.keyboard.down(key);
              await expect.poll(holding, POLL).toBe(true);
              await sleep(300);
              await page.keyboard.up(key);
              await expect.poll(holding, POLL).toBe(false);
            }
            const turnId = st.demo.accounts.turn!.id;
            const status = () => st.stage.ctx.db.selectFrom('live_entries').select('status').where('account_id', '=', turnId).executeTakeFirst().then((r) => r?.status ?? null);
            expect(await status()).toBe('TURN');
            // Held 1.5 s, by this look's way: SECURED. The stage's clock is fixed: the server, which times the hold from its
            // press, sees the 1.5 s pass as the page holds (its clock moved on by them once the press is in).
            const way = (['mouse', ' ', 'Enter', 'mouse'] as const)[n]!;
            const pressed = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/v1\/live\/[^/]+\/press$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
            if (way === 'mouse') await page.mouse.down();
            else {
              await seal.focus();
              await page.keyboard.down(way);
            }
            await (await pressed).response();
            st.clock.advance(2_000);
            await sleep(2_100);
            if (way === 'mouse') await page.mouse.up();
            else await page.keyboard.up(way);
            await page.locator('.view--live .live__secured').first().waitFor({ timeout: 20_000 });
            await expect.poll(status, POLL).toBe('SECURED');
            // A computer starts with the sound off: no tone and no designed sound (lot Q1 §3.10) played, none fetched, SOUND
            // OFF in the room's foot.
            expect(await page.evaluate(() => (window as unknown as { __flows: { tones: number[] } }).__flows.tones)).toEqual([]);
            expect(await page.evaluate(() => (window as unknown as { __flows: { sounds: number } }).__flows.sounds)).toBe(0);
            expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.mp3$/.test(e.name)).length)).toBe(0);
            expect(await text(page, 'button.live__sound')).toBe('SOUND OFF');
            await f.holds('SECURED', { h1: false });
          } finally {
            await f.close();
          }
          expect(f.problems).toEqual([]);
        });
      },
      TIMEOUT,
    );
  }

  it(
    'the sign-in page opened from a LIVE RELEASE and left by the menu lets the release go: no request of it once on THE RELEASES',
    async () => {
      await withStage('full', async (st) => {
        const f = await flow(st, LOOKS[0]!, { ...stateById('live-announced-signed-out'), routes: async (page) => page.addInitScript({ content: SKEW }) });
        const { page } = f;
        try {
          const release = pathOf(page).split('/').pop()!;
          await page.locator(ACCOUNT).click();
          await page.locator('.view--signin form').first().waitFor({ timeout: 20_000 });
          await page.locator('header.n-hd a.n-rail__link', { hasText: /^RELEASES/ }).click();
          await page.locator('.view--releases').waitFor({ timeout: 20_000 });
          await settle(page, 600);
          const asked: string[] = [];
          page.on('request', (r) => {
            const path = new URL(r.url()).pathname;
            if (path.startsWith(`/api/v1/live/${release}`)) asked.push(path);
          });
          // Every stage of the release due on the page's clock: a release's page still kept would read it again.
          await page.evaluate(() => {
            (window as unknown as { __skew: number }).__skew = 60 * 24 * 3_600_000;
          });
          await sleep(2_000);
          expect(asked).toEqual([]);
        } finally {
          await f.close();
        }
        expect(f.problems).toEqual([]);
      });
    },
    TIMEOUT,
  );
});

/**
 * An order of `you` paid and still to ship (desktop step 11's leftover, plan §2(j) D10): ORBES Client Services sells a
 * MONOLITHE in blue through THE PRIVATE SALON (size 16), its piece counted in and bound by the packing scan, its warranty
 * started; the card lost, a new claim code made for its buyer (SOLD). Its reference.
 */
async function paidWithNewCode(st: NocturneStage): Promise<string> {
  const { db, services } = st.stage.ctx;
  const a = await admin(st);
  const you = st.demo.accounts.you!;
  const blue = (await db.selectFrom('models').select('id').where('slug', '=', st.demo.slugs.blue!).executeTakeFirstOrThrow()).id;
  const request = await db.insertInto('shop_requests').values({ account_id: you.id, model_id: blue, created_at: new Date('2026-10-05T16:49:00.000Z') }).returning('id').executeTakeFirstOrThrow();
  await services.salon.close(request.id, { note: 'A MONOLITHE in blue, size 16.', outcome: 'ACCEPTED' }, a);
  const order = await db.selectFrom('orders').select(['id', 'location_id']).where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
  const sku = (await db.selectFrom('skus').select('id').where('model_id', '=', blue).where('size_label', '=', '16').executeTakeFirstOrThrow()).id;
  const piece = await services.issuance.issueProduct({ categoryCode: 'J', year: 2026, modelId: blue, variant: '16', material: '925 STERLING SILVER, BLUE LACQUER', withClaimSecret: true }, a);
  await countPiecesIn(st.stage.ctx, { skuId: sku, locationId: order.location_id, productRefs: [piece.product.productId] }, a);
  await services.orders.setTerms(order.id, { sizeLabel: '16', priceMinor: 420_000, currency: 'EUR' }, a);
  await services.orders.setBuyer(order.id, { name: 'Camille Laurent', address: '14 rue de Turenne\n75004 Paris\nFrance', country: 'FR' }, a);
  await services.orders.transition(order.id, { to: 'PAID' }, a);
  await scanIntoParcel(st.stage.ctx, order.id, { pieces: { [order.id]: piece.product.productId } }, a);
  await services.warranty.activate(piece.product.id, { purchaseDate: '2026-10-05', retailer: 'ORBES PARIS', country: 'FR' }, a);
  const situation = await services.claimRenewals.situation(piece.product.productId);
  await services.claimRenewals.renew(piece.product.productId, { reason: 'Card lost', expect: 'SOLD', after: situation.lastRenewalId }, a);
  return `OR-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** A download's bytes. */
async function readDownload(d: Download): Promise<Buffer> {
  const stream = await d.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** A white card with no code on it (NO ORBES CODE FOUND). */
function blankPng(): Buffer {
  const png = new PNG({ width: 600, height: 600 });
  png.data.fill(255);
  return PNG.sync.write(png);
}
