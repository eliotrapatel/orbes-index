/**
 * WRITE TO ORBES CLIENT SERVICES and MESSAGES, end to end (plan NEXT-NINE of 2026-10-06, §3.1 CS-01, steps 1.4 and
 * 1.5), on the NOCTURNE stage (test/support/nocturne-states.ts), outside the content shards:
 *
 *  - each site shows the button, with what it attaches: a scan with a problem, the warranty tab of a warranty that no
 *    longer applies, a piece, MY PIECES' orders and releases, a draw's page, the LIVE RELEASE's CONFIRMED screen (the
 *    house's hairline `btn`) and YOUR ENTRY IS REMOVED, a salon request on its model's sheet;
 *  - signed out, the sheet leads through the sign-in to the form, its context kept (its FORGOTTEN PASSWORD? shows the
 *    email from the first open); SEND, MESSAGE SENT, SEE MESSAGES shows the message;
 *  - every site sends once, and the label the sheet shows under CONCERNING is the one the server stores (a variant's
 *    piece, order and release named as the server names them);
 *  - the console answers (the service, as the board does); NOW shows its line and the account sheet NEW; the collector
 *    reads (the line goes) and replies;
 *  - FORGOTTEN PASSWORD shows the email alone, no phone and no hours;
 *  - no sideways scroll at 390, 375, 360 and 320 px, the button on one line.
 */
import { existsSync } from 'node:fs';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { NOCTURNE_ADMIN, NOCTURNE_CLIENT_SERVICES, NOCTURNE_PASSWORD, type NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, stateById, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH, codePhoto, type UiStage } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const WRITE = 'WRITE TO ORBES CLIENT SERVICES';
const WIDTHS = [390, 375, 360, 320] as const;

/** A state of the stage under a new id, run after the others of its variant (it writes). */
const writing = (id: string, newId: string, extra: Partial<UiState> = {}): UiState => ({ ...stateById(id), id: newId, mutates: true, ...extra });

/** The buttons WRITE TO ORBES CLIENT SERVICES of the page, with what each attaches. */
const buttons = (page: Page, within = 'body') =>
  page.locator(`${within} button`, { hasText: WRITE }).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => ({ kind: (e as HTMLElement).dataset.context ?? null, id: (e as HTMLElement).dataset.contextId ?? null, about: (e as HTMLElement).dataset.contextAbout ?? null, cls: e.className })),
  );

/** No sideways scroll at each phone width; the button on one line. */
async function fitsEveryWidth(page: Page, what: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await settle(page, 200);
    const r = await page.evaluate((label) => {
      const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const b = [...document.querySelectorAll('button')].filter((e) => e.textContent?.trim() === label && (e as HTMLElement).offsetParent !== null) as HTMLElement[];
      // One line: its words never wrap (its height that of one line of its type, its text never wider than it).
      const wraps = b.filter((e) => e.scrollWidth > e.clientWidth + 1 || [...e.getClientRects()].length > 1 || (() => {
        const range = document.createRange();
        range.selectNodeContents(e);
        return range.getClientRects().length > 1;
      })());
      return { over, wraps: wraps.length };
    }, WRITE);
    expect(r.over, `${what} at ${width} px: sideways scroll`).toBeLessThanOrEqual(0);
    expect(r.wraps, `${what} at ${width} px: the button wraps`).toBe(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

/**
 * The write sheet. The order sheets of YOUR ORDERS (views/order-sheet.ts, plan NEXT LOT §3.6) sit on the same plate
 * (`n-write`) with their own class, `n-osheet`, and stay in the page, hidden, beside it.
 */
const WRITE_SHEET = '.n-write:not(.n-osheet)';

/**
 * WRITE TO ORBES CLIENT SERVICES opened from `button` and sent, signed in: the label the sheet showed under CONCERNING
 * and the one the server stored (client_messages.context_label), which must be the same. The sheet closed again.
 */
async function sendFrom(page: Page, stage: UiStage, button: Locator, body: string): Promise<{ sheet: string; stored: string | null }> {
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const sheet = page.locator(WRITE_SHEET);
  await sheet.locator('textarea').waitFor({ timeout: 15_000 });
  const label = (await sheet.locator('[data-testid=write-concerning]').innerText()).trim();
  await sheet.locator('textarea').fill(body);
  await sheet.getByRole('button', { name: 'SEND' }).click();
  await sheet.locator('.n-write__sent').waitFor({ timeout: 15_000 });
  const row = await stage.ctx.db.selectFrom('client_messages').select('context_label').where('body', '=', body).executeTakeFirstOrThrow();
  await page.keyboard.press('Escape');
  await expect.poll(() => sheet.isHidden()).toBe(true);
  return { sheet: label, stored: row.context_label };
}

/** The label the sheet shows for `button`, opened and closed without sending. */
async function concerningOf(page: Page, button: Locator): Promise<string> {
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const sheet = page.locator(WRITE_SHEET);
  await sheet.locator('[data-testid=write-concerning]').waitFor({ timeout: 15_000 });
  const label = (await sheet.locator('[data-testid=write-concerning]').innerText()).trim();
  await page.keyboard.press('Escape');
  await expect.poll(() => sheet.isHidden()).toBe(true);
  return label;
}

/** The demo's console user, as the Messages board's answers are signed. */
async function adminActor(stage: UiStage): Promise<{ type: 'admin'; id: string }> {
  const row = await stage.ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', NOCTURNE_ADMIN.email).executeTakeFirstOrThrow();
  return { type: 'admin', id: row.id };
}

type Check = (page: Page, demo: NocturneDemo, stage: UiStage) => Promise<void>;

const CASES: { state: UiState; check: Check }[] = [
  // ── Site 1, then the whole way: signed out, the sign-in, SEND, the answer, NOW, NEW, READ, the reply ──
  {
    state: writing('result-invalid', 'messages-write-signed-out'),
    check: async (page, demo, stage) => {
      const help = page.locator('.n-result__help');
      expect(await help.locator('p.n-tx').innerText()).toBe('ORBES Client Services can help with any question about this piece. The reference below is attached to your message.');
      const [b] = await buttons(page, '.n-result__help');
      expect(b).toMatchObject({ kind: 'SCAN', about: null });
      expect(b!.id).toMatch(/^[0-9a-f-]{36}$/);
      // No email, phone or hours on the result.
      expect(await page.locator('a[href^="mailto:"], a[href^="tel:"]').count()).toBe(0);
      expect(await page.locator('body').innerText()).not.toContain(NOCTURNE_CLIENT_SERVICES.hours);
      await fitsEveryWidth(page, 'the result');
      const reference = (await page.locator('.n-result__meta-value').last().innerText()).trim();

      // Signed out: the sentence, then the sign-in; once signed in, the form, its context kept.
      await help.getByRole('button', { name: WRITE }).click();
      const sheet = page.locator(WRITE_SHEET);
      await sheet.locator('#write-title').waitFor();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('write-title');
      expect(await sheet.innerText()).toContain('Sign in or create an ORBES account to write to ORBES Client Services. Their answer will appear in your account.');
      expect(await sheet.locator('textarea').count()).toBe(0);
      // FORGOTTEN PASSWORD? from this first open: ORBES Client Services' email alone, as on the result's own panel.
      await sheet.getByRole('button', { name: 'FORGOTTEN PASSWORD?' }).click();
      await sheet.locator('#recover-title').waitFor();
      await expect.poll(() => sheet.locator('a[href^="mailto:"]').allInnerTexts()).toEqual(['CONTACT ORBES CLIENT SERVICES']);
      expect(await sheet.locator('a[href^="tel:"]').count()).toBe(0);
      await sheet.getByRole('button', { name: 'BACK TO SIGN IN' }).click();
      await sheet.locator('input[name=email]').fill(demo.accounts.you!.email);
      await sheet.locator('input[name=password]').fill(NOCTURNE_PASSWORD);
      await sheet.locator('form button[type=submit]').click();
      await sheet.locator('textarea').waitFor({ timeout: 15_000 });
      expect(await sheet.locator('[data-testid=write-concerning]').innerText()).toBe(`REF ${reference} · INVALID SIGNATURE`);
      expect(await sheet.innerText()).toContain('Please leave out passwords and card numbers.');
      expect(await sheet.innerText()).toContain('The answer will appear in your account, under MESSAGES.');
      await fitsEveryWidth(page, 'the write sheet');
      // The words checked here, as the server writes them; then sent.
      await sheet.getByRole('button', { name: 'SEND' }).click();
      expect(await sheet.locator('.form__error').innerText()).toBe('Write your message.');
      await sheet.locator('textarea').fill('Where was this piece made?\nI saw it online.');
      await sheet.getByRole('button', { name: 'SEND' }).click();
      await sheet.locator('.n-write__sent').waitFor();
      // The label shown is the one stored.
      const stored = await stage.ctx.db.selectFrom('client_messages').select('context_label').where('body', '=', 'Where was this piece made?\nI saw it online.').executeTakeFirstOrThrow();
      expect(stored.context_label).toBe(`REF ${reference} · INVALID SIGNATURE`);
      expect((await sheet.locator('.n-write__sent').innerText()).replace(/\s+/g, ' ')).toBe(
        'MESSAGE SENT Your message is with ORBES Client Services. Their answer will appear in your account, under MESSAGES. SEE MESSAGES CLOSE',
      );
      // SEE MESSAGES: the account sheet on MESSAGES, the message there with its context (a scan: no link).
      await sheet.getByRole('button', { name: 'SEE MESSAGES' }).click();
      const account = page.locator('.n-account:not(.n-write):not([hidden])');
      await account.locator('[data-testid=message]').first().waitFor();
      const first = account.locator('[data-testid=message]').first();
      expect(await first.locator('.n-messages__author').innerText()).toMatch(/^YOU · \d{1,2} [A-Z]{3} 2026 · \d{2}:\d{2}$/);
      expect((await first.locator('.n-messages__concerning').innerText()).replace(/\s+/g, ' ')).toBe(`CONCERNING REF ${reference} · INVALID SIGNATURE`);
      expect(await first.locator('.n-messages__concerning a, .n-messages__concerning button').count()).toBe(0);
      expect(await first.locator('.n-messages__body').innerText()).toBe('Where was this piece made?\nI saw it online.');
      expect(await account.locator('label', { hasText: 'YOUR REPLY' }).count()).toBe(1);
      await fitsEveryWidth(page, 'MESSAGES');

      // The console answers (as its board does): NOW's line, the sheet's NEW.
      const you = demo.accounts.you!;
      const conversation = await stage.ctx.db.selectFrom('client_conversations').select('id').where('account_id', '=', you.id).executeTakeFirstOrThrow();
      await stage.ctx.services.messages.answer(conversation.id, await adminActor(stage), { body: 'It was made at the ORBES atelier in Paris.' });
      await page.goto(`${stage.origin}/verify`);
      await page.locator('.view--now[data-ready]').waitFor();
      const line = page.locator('.now__messages');
      expect((await line.innerText()).replace(/\s+/g, ' ')).toBe('MESSAGES ORBES Client Services has answered you. READ');
      // Right under the hero, before YOUR PIECES.
      const order = await page.locator('.view--now > section').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      expect(order.indexOf('MESSAGES')).toBe(order.indexOf('Your pieces') - 1);
      await page.locator('button.n-acct').click();
      const row = page.locator('.n-account__messages');
      await expect.poll(() => row.innerText()).toMatch(/^MESSAGES\s+NEW$/);
      await page.locator('.n-account__close').first().click();
      // READ: MESSAGES, the answer signed ORBES CLIENT SERVICES, never a name; the line goes.
      await line.getByRole('button', { name: 'READ' }).click();
      await account.locator('[data-testid=message]').nth(1).waitFor();
      const answer = account.locator('[data-testid=message]').nth(1);
      expect(await answer.locator('.n-messages__author').innerText()).toMatch(/^ORBES CLIENT SERVICES · /);
      expect(await account.innerText()).not.toContain(NOCTURNE_ADMIN.email);
      await expect.poll(() => page.locator('.now__messages').count()).toBe(0);
      expect((await stage.ctx.services.messages.unread(you.id)).unread).toBe(false);
      // The reply, from MESSAGES: no context.
      await account.locator('textarea').fill('Thank you.');
      await account.getByRole('button', { name: 'SEND' }).click();
      await expect.poll(() => account.locator('[data-testid=message]').count()).toBe(3);
      expect(await account.locator('[data-testid=message]').nth(2).locator('.n-messages__concerning').count()).toBe(0);
      // Back to the sheet: NEW is gone.
      await account.getByRole('button', { name: 'YOUR ACCOUNT' }).click();
      expect((await page.locator('.n-account__messages').innerText()).trim()).toBe('MESSAGES');
      const c = await stage.ctx.services.messages.conversation(conversation.id);
      expect(c.status).toBe('TO_ANSWER');
      expect(c.messages.map((m) => m.author)).toEqual(['COLLECTOR', 'STAFF', 'COLLECTOR']);
    },
  },
  // ── Sites 3, 4, 5 and 6 (MY PIECES, a piece, a draw's page), and site 9 (the salon) ──
  {
    state: writing('pieces-orders', 'messages-pieces-orders'),
    check: async (page, _demo, stage) => {
      const orders = await page.locator('.view--pieces article.n-pieces__order').count();
      expect(orders).toBeGreaterThan(0);
      const b = await buttons(page, '.view--pieces');
      expect(b.filter((x) => x.kind === 'ORDER')).toHaveLength(orders);
      // Under the reference, before DOCUMENTS.
      const between = await page.locator('article.n-pieces__order').first().evaluate((a) => {
        const ref = a.querySelector('.n-pieces__order-reference')!;
        const btn = [...a.querySelectorAll('button')].find((x) => x.textContent === 'WRITE TO ORBES CLIENT SERVICES')!;
        return ref.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING;
      });
      expect(between).toBeTruthy();
      await fitsEveryWidth(page, 'ORDERS');
      // Sent from the order of a variant (MONOLITHE IN GOLD): the sheet names its model as the server stores it.
      const writes = page.locator('.view--pieces article.n-pieces__order').getByRole('button', { name: WRITE });
      const labels: string[] = [];
      for (let i = 0; i < orders; i++) labels.push(await concerningOf(page, writes.nth(i)));
      const variant = labels.findIndex((l) => /^ORDER OR-[0-9A-F]{8} · [A-Z ]+ IN [A-Z ]+$/.test(l));
      expect(variant, labels.join(' | ')).toBeGreaterThanOrEqual(0);
      const sent = await sendFrom(page, stage, writes.nth(variant), 'About my order of a variant.');
      expect(sent.sheet).toBe(labels[variant]);
      expect(sent.stored).toBe(sent.sheet);
    },
  },
  {
    state: writing('pieces-releases', 'messages-pieces-releases'),
    check: async (page, demo, stage) => {
      const b = await buttons(page, '.view--pieces');
      expect(b.length).toBeGreaterThan(0);
      expect(b.every((x) => x.kind === 'RELEASE' && /^[0-9a-f-]{36}$/.test(x.id ?? ''))).toBe(true);
      // The draw the account concluded: its page shows the button under the entry's actions.
      const steel = demo.releases['draw:MONOLITHE IN STEEL']!;
      expect(b.map((x) => x.id)).toContain(steel);
      const fromList = await sendFrom(page, stage, page.locator('.view--pieces').getByRole('button', { name: WRITE }).first(), 'About a release of MY PIECES.');
      expect(fromList.stored).toBe(fromList.sheet);
      await page.goto(`${page.url().split('/verify')[0]}/verify/releases/${steel}`);
      await page.locator('.view--release .n-release__status').waitFor();
      expect((await buttons(page, '.view--release')).map((x) => [x.kind, x.id])).toEqual([['RELEASE', steel]]);
      await fitsEveryWidth(page, "a draw's page");
      const fromDraw = await sendFrom(page, stage, page.locator('.view--release').getByRole('button', { name: WRITE }), "About a draw's page.");
      expect(fromDraw.sheet).toMatch(/^MONOLITHE IN STEEL · /);
      expect(fromDraw.stored).toBe(fromDraw.sheet);
    },
  },
  {
    state: writing('piece-boutique', 'messages-piece-boutique'),
    check: async (page, demo, stage) => {
      expect(await buttons(page, '.n-piece__ownership')).toEqual([expect.objectContaining({ kind: 'PIECE', id: demo.pieces.yours })]);
      expect(await page.locator('a[href^="mailto:"], a[href^="tel:"]').count()).toBe(0);
      await fitsEveryWidth(page, 'a piece');
      // A main model with a variant's label (MONOLITHE IN STEEL): named so by the sheet and by the server.
      const sent = await sendFrom(page, stage, page.locator('.n-piece__ownership').getByRole('button', { name: WRITE }), 'About my piece.');
      expect(sent.sheet).toBe(`MONOLITHE IN STEEL · ${demo.pieces.yours}`);
      expect(sent.stored).toBe(sent.sheet);
    },
  },
  {
    state: stateById('model-salon-requested'),
    check: async (page, _demo, stage) => {
      const b = await buttons(page, '.view--sheet');
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ kind: 'MODEL' });
      expect(b[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
      // Opened, the sheet names the request.
      await page.locator('.view--sheet').getByRole('button', { name: WRITE }).click();
      expect(await page.locator(WRITE_SHEET).locator('[data-testid=write-concerning]').innerText()).toMatch(/· PRIVATE SALON REQUEST$/);
      await page.keyboard.press('Escape');
      await expect.poll(() => page.locator(WRITE_SHEET).isHidden()).toBe(true);
      await fitsEveryWidth(page, 'the salon');
      const sent = await sendFrom(page, stage, page.locator('.view--sheet').getByRole('button', { name: WRITE }), 'About my salon request.');
      expect(sent.stored).toBe(sent.sheet);
    },
  },
  // ── FORGOTTEN PASSWORD: the email alone ──
  {
    state: stateById('result-forgotten-password'),
    check: async (page) => {
      const own = page.locator('.n-own');
      expect(await own.locator('a[href^="mailto:"]').allInnerTexts()).toEqual(['CONTACT ORBES CLIENT SERVICES']);
      const href = (await own.locator('a[href^="mailto:"]').getAttribute('href'))!;
      expect(decodeURIComponent(href)).toContain('subject=ORBES — FORGOTTEN PASSWORD');
      expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
      const text = await page.locator('body').innerText();
      expect(text).not.toContain(NOCTURNE_CLIENT_SERVICES.phone);
      expect(text).not.toContain(NOCTURNE_CLIENT_SERVICES.hours);
    },
  },
  // ── Site 2: the warranty tab of a warranty that no longer applies (written last: it voids a warranty) ──
  {
    state: writing('result-first-registration-warranty', 'messages-warranty-void', {
      act: async (run) => {
        await run.stage.ctx.services.warranty.void(run.demo.pieces.first!, 'Test of the warranty tab.', await adminActor(run.stage));
        await run.page.locator('.view--now[data-ready]').waitFor();
        await run.page.setInputFiles('#photo-input', { name: 'orbes-code.png', mimeType: 'image/png', buffer: codePhoto(run.demo.codes.first!) });
        await run.page.locator('.view--result .n-result__title').waitFor({ timeout: 30_000 });
        await run.page.getByRole('tab', { name: 'WARRANTY', exact: true }).first().click();
      },
    }),
    check: async (page) => {
      const b = await buttons(page, '.n-result__panel');
      expect(b).toEqual([expect.objectContaining({ kind: 'SCAN', about: 'WARRANTY' })]);
      await page.locator('.n-result__panel').getByRole('button', { name: WRITE }).click();
      // Signed out: the sign-in first.
      expect(await page.locator(WRITE_SHEET).innerText()).toContain('Sign in or create an ORBES account');
      await page.keyboard.press('Escape');
    },
  },
  // ── Sites 7 and 8: the LIVE RELEASE ──
  {
    state: writing('live-confirmed', 'messages-live-confirmed'),
    check: async (page, _demo, stage) => {
      const confirmed = page.locator('.live__confirmed');
      const b = await buttons(page, '.live__confirmed');
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ kind: 'RELEASE' });
      // The house's full-width hairline button, under the CLIENT SERVICES overline, before MY PIECES; no contact block.
      expect(b[0]!.cls.split(/\s+/)).toEqual(expect.arrayContaining(['btn', 'btn--block']));
      const order = await confirmed.evaluate((el) => [...el.children].map((c) => c.className));
      const title = order.findIndex((c) => c.includes('live__cs-title'));
      expect(order[title + 1]).toContain('btn');
      expect(await confirmed.locator('.contact').count()).toBe(0);
      await confirmed.getByRole('button', { name: WRITE }).click();
      expect(await page.locator(WRITE_SHEET).locator('[data-testid=write-concerning]').innerText()).toMatch(/· CONFIRMED · REFERENCE LR-[0-9A-F]{8}$/);
      await page.keyboard.press('Escape');
      await fitsEveryWidth(page, 'CONFIRMED');
      // The release by its title (MONOLITHE IN BLUE), as the server stores it.
      const sent = await sendFrom(page, stage, confirmed.getByRole('button', { name: WRITE }), 'About my confirmed entry.');
      expect(sent.sheet).toMatch(/^MONOLITHE IN BLUE · CONFIRMED · REFERENCE LR-[0-9A-F]{8}$/);
      expect(sent.stored).toBe(sent.sheet);
    },
  },
  {
    state: writing('live-removed', 'messages-live-removed'),
    check: async (page, _demo, stage) => {
      const b = await buttons(page, '.n-live__contact');
      expect(b).toEqual([expect.objectContaining({ kind: 'RELEASE' })]);
      expect(await page.locator('a[href^="mailto:"], a[href^="tel:"]').count()).toBe(0);
      await fitsEveryWidth(page, 'YOUR ENTRY IS REMOVED');
      const sent = await sendFrom(page, stage, page.locator('.n-live__contact').getByRole('button', { name: WRITE }), 'About my entry removed.');
      expect(sent.sheet).toBe('MONOLITHE IN BLUE · REMOVED');
      expect(sent.stored).toBe(sent.sheet);
    },
  },
];

describe.skipIf(!HAS_CHROMIUM)('WRITE TO ORBES CLIENT SERVICES and MESSAGES (CS-01, Chromium)', () => {
  it(
    'shows the button at each site, leads through the sign-in to the form, sends, shows the answer, NOW\'s line and NEW, reads and replies; FORGOTTEN PASSWORD keeps the email alone; nothing scrolls sideways',
    async () => {
      const failures: string[] = [];
      await eachState(
        CASES.map((c) => c.state),
        async (state, { stage, demo, browser }) => {
          const c = CASES.find((x) => x.state.id === state.id)!;
          const opened = await openState(browser, stage, demo, state);
          try {
            await c.check(opened.page, demo, stage);
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
    15 * 60_000,
  );
});
