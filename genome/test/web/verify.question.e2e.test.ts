/**
 * End-to-end: the question after a LIVE RELEASE (plan LIVE RELEASE+, step S8: choice 11), served by the real server
 * (in-memory database, the real clock), driven in Chromium at a phone's size.
 *
 *  - Still in the line when the release closes at its time, on the page being looked at: CLOSED, then ONE QUESTION,
 *    answered there (no second door: the release's end is its final end).
 *  - On the release's end page, in the vault: ONE QUESTION for the collector who was in the line without a piece, the
 *    default question and its three answers, pressed like the sign-in's switch; one tap records it, another changes it
 *    (from the keyboard too, the focus kept); a reload shows it as answered; never for the collector who secured the
 *    piece, never signed out, never in MY PIECES for them.
 *  - In MY PIECES, in the ivory: AFTER THE RELEASES for the collector who said I'LL BE THERE and did not come, the release
 *    by its name and date, one tap; never on the release's page for them.
 *  - On every screen: the text's contrast, no figure in the display face, the floors of BRAND-DESIGN-SYSTEM §3.8, nothing
 *    scrolling sideways at the phone widths. Skipped when Chromium is absent.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { createManualClock } from '../../src/server/types.js';
import { LIVE, QUESTION, RELEASES } from '../../src/web/verify/copy.js';
import { createLiveRelease, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { keepsVault, screenChecks } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;
const PHONE_WIDTHS = [360, 375, 320] as const;
const ANSWERS = ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'];
/** Until when, on the phone's calendar. */
const UNTIL = /^One tap\. You may change your answer until \d{1,2} [A-Z]{3} \d{4}\.$/;
const THANKS = /^Thank you: your answer is recorded\. You may change it until \d{1,2} [A-Z]{3} \d{4}\.$/;

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}
const visible = (loc: Locator) => loc.waitFor({ state: 'visible', timeout: POLL.timeout });

interface Phone {
  page: Page;
  context: BrowserContext;
  problems: string[];
}

describe.skipIf(!HAS_CHROMIUM)('the question after a LIVE RELEASE (Chromium)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let f: LiveFixture;
  let n = 0;
  let release: { id: string };
  let buyer: { id: string; token: string };
  let taker: { id: string; token: string };
  let absent: { id: string; token: string };

  async function account() {
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email: `question.${++n}@example.com`, password: PASSWORD }, {});
    return { id: a.id, token: session.token, actor: { type: 'account' as const, id: a.id } };
  }

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    f = await liveFixtureOn(srv.ctx, createManualClock(new Date()));
    const { ctx } = srv;
    const nocturne = await createModel(ctx.db, 'NOCTURNE');
    const b = await account();
    const t = await account();
    const a = await account();
    buyer = b;
    taker = t;
    absent = a;
    // A LIVE RELEASE of one piece, live since a minute. The absent collector had said I'LL BE THERE before T0.
    const r = await createLiveRelease(f, { modelId: nocturne, opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + HOUR), quantityLine: '1 PIECE', sizes: [{ label: '52', stock: 1 }] });
    await ctx.db.insertInto('live_interest').values({ drop_id: r.id, account_id: a.id, size_id: r.sizes[0]!.id, created_at: new Date(Date.now() - 2 * HOUR) }).execute();
    // The buyer then the taker join the line; the buyer secures and pays: SOLD OUT, the taker's place ended by it.
    for (const x of [b, t]) await ctx.services.live.enter(x.id, r.id, { sizeId: r.sizes[0]!.id }, x.actor);
    await ctx.services.live.advance(r.id);
    const token = (await ctx.services.live.entry(b.id, r.id))!.turn!.token!;
    await ctx.services.live.press(b.id, r.id, token);
    await sleep(1_600);
    await ctx.services.live.secure(b.id, r.id, token, b.actor);
    await ctx.services.live.confirm(b.id, r.id, b.actor);
    await ctx.services.live.advance(r.id);
    const ended = await ctx.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow();
    expect(ended.ended_reason).toBe('SOLD_OUT');
    release = r;
    browser = await launchChromium();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function phone(token: string | null): Promise<Phone> {
    const context = await mobileContext(browser);
    if (token) await context.addCookies([{ name: sessionCookieName(srv.ctx.config, 'account'), value: token, url: srv.origin }]);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`);
      if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    return { page, context, problems };
  }

  async function sideways(page: Page): Promise<void> {
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  const answer = (scope: Locator, label: string) => scope.getByRole('button', { name: label, exact: true });
  const pressed = async (scope: Locator) => scope.locator('.question__answer').evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed')));
  const stored = async (accountId: string) =>
    (await srv.ctx.db.selectFrom('release_answers').select('answer').where('drop_id', '=', release.id).where('account_id', '=', accountId).executeTakeFirst())?.answer ?? null;

  it('asks the collector in the line without a piece on the release’s end page: one tap, another, from the keyboard too, kept after a reload', async () => {
    const { page, context, problems } = await phone(taker.token);
    await page.goto(`${srv.origin}/verify/releases/${release.id}`);
    await textOf(page.locator('.live__past-status'), RELEASES.over);
    const block = page.locator('.live__past .question');
    await visible(block);
    await textOf(block.locator('.question__label'), QUESTION.label);
    await textOf(block.locator('.question__text'), 'WHAT WOULD YOU HAVE WANTED?');
    expect(await block.locator('.question__release').isHidden()).toBe(true);
    const group = block.getByRole('group', { name: 'WHAT WOULD YOU HAVE WANTED?' });
    await visible(group);
    expect(await block.locator('.question__answer').allInnerTexts()).toEqual(ANSWERS);
    expect(await pressed(block)).toEqual(['false', 'false', 'false']);
    await textOf(block.locator('.question__note'), UNTIL);
    await textOf(page.locator('.live__past-part'), RELEASES.past.tookPart);
    // One action still: THE RELEASES; the answers are pressed options, never a hairline button.
    expect(await page.locator('.live__past .btn:visible').count()).toBe(1);
    await keepsVault(page, null, [...ANSWERS, 'THE RELEASES']);
    await sideways(page);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-question.png'), fullPage: true });

    // One tap; then another: changed in place.
    await answer(block, 'ANOTHER FINISH').click();
    await expect.poll(() => pressed(block), POLL).toEqual(['false', 'true', 'false']);
    await textOf(block.locator('.question__note'), THANKS);
    expect(await stored(taker.id)).toBe(2);
    await answer(block, 'ANOTHER PRICE BAND').click();
    await expect.poll(() => pressed(block), POLL).toEqual(['false', 'false', 'true']);
    expect(await stored(taker.id)).toBe(3);
    // From the keyboard: Enter on ANOTHER SIZE, the focus staying on it.
    await answer(block, 'ANOTHER SIZE').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => pressed(block), POLL).toEqual(['true', 'false', 'false']);
    expect(await answer(block, 'ANOTHER SIZE').evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await stored(taker.id)).toBe(1);
    // The rule under an answer fades in and out (--t-med): the screen once still.
    await sleep(900);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-question-answered.png'), fullPage: true });

    // A reload: answered.
    await page.reload();
    await visible(page.locator('.live__past .question'));
    await expect.poll(() => pressed(page.locator('.live__past .question')), POLL).toEqual(['true', 'false', 'false']);
    await textOf(page.locator('.live__past .question .question__note'), THANKS);
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);

  it('asks the collector still in the line when the release closes at its time on the page it is looking at: CLOSED, then ONE QUESTION, answered there', async () => {
    const { ctx } = srv;
    const first = await account();
    const waiting = await account();
    // One piece, its first collector's turn long enough to run past the end; the second in the line behind it.
    const r = await createLiveRelease(f, { opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + HOUR), quantityLine: '1 PIECE', sizes: [{ label: '52', stock: 1 }], turnSeconds: 300 });
    for (const x of [first, waiting]) await ctx.services.live.enter(x.id, r.id, { sizeId: r.sizes[0]!.id }, x.actor);
    await ctx.services.live.advance(r.id);
    expect((await ctx.services.live.entry(first.id, r.id))?.status).toBe('TURN');
    const { page, context, problems } = await phone(waiting.token);
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(page.locator('.live__place-figure'), '2');
    expect(await page.locator('.question').count()).toBe(0);

    // The release reaches its closing time: CLOSED, the line ENDED; the page follows it there and asks.
    await ctx.db.updateTable('drops').set({ closes_at: new Date() }).where('id', '=', r.id).execute();
    await ctx.services.live.advance(r.id);
    const ended = await ctx.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow();
    expect(ended.ended_reason).toBe('CLOSED');
    expect((await ctx.services.live.entry(waiting.id, r.id))?.status).toBe('ENDED');
    await textOf(page.locator('h1'), LIVE.edge.ended.CLOSED.title);
    await textOf(page.locator('.live__edge .live__note').first(), LIVE.edge.ended.CLOSED.text);
    const block = page.locator('.live__edge .question');
    await visible(block);
    await textOf(block.locator('.question__label'), QUESTION.label);
    await textOf(block.locator('.question__text'), 'WHAT WOULD YOU HAVE WANTED?');
    expect(await block.locator('.question__answer').allInnerTexts()).toEqual(ANSWERS);
    expect(await pressed(block)).toEqual(['false', 'false', 'false']);
    await textOf(block.locator('.question__note'), UNTIL);
    // Its one action still: THE RELEASES.
    expect(await page.locator('.live__edge .btn:visible').count()).toBe(1);
    await keepsVault(page, null, [...ANSWERS, 'THE RELEASES']);
    await sideways(page);
    await answer(block, 'ANOTHER FINISH').click();
    await expect.poll(() => pressed(block), POLL).toEqual(['false', 'true', 'false']);
    await textOf(block.locator('.question__note'), THANKS);
    const answered = await ctx.db.selectFrom('release_answers').select('answer').where('drop_id', '=', r.id).where('account_id', '=', waiting.id).executeTakeFirst();
    expect(answered?.answer).toBe(2);
    await sleep(900);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-question-closed.png'), fullPage: true });
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);

  it('never asks the buyer, nor anyone signed out; asks the one who said I’LL BE THERE and did not come in MY PIECES only', async () => {
    for (const token of [buyer.token, null, absent.token]) {
      const { page, context, problems } = await phone(token);
      await page.goto(`${srv.origin}/verify/releases/${release.id}`);
      await textOf(page.locator('.live__past-status'), RELEASES.over);
      await sleep(600);
      expect(await page.locator('.live__past .question').isHidden(), String(token)).toBe(true);
      expect(problems).toEqual([]);
      await context.close();
    }

    // The buyer's MY PIECES: no question.
    const own = await phone(buyer.token);
    await own.page.goto(`${srv.origin}/verify/pieces`);
    await visible(own.page.locator('#pieces-title'));
    await visible(own.page.getByRole('tab', { name: /^ORDERS/ }));
    expect(await own.page.locator('.pieces__questions').count()).toBe(0);
    await own.context.close();

    const { page, context, problems } = await phone(absent.token);
    await page.goto(`${srv.origin}/verify/pieces`);
    const section = page.locator('.pieces__questions');
    await visible(section);
    await textOf(section.locator('#pieces-questions'), QUESTION.piecesTitle);
    await textOf(section.locator('.pieces__questions-lead'), QUESTION.piecesLead);
    const block = section.locator('.question');
    await textOf(block.locator('.question__release'), /^NOCTURNE · \d{1,2} [A-Z]{3} \d{4}$/);
    await textOf(block.locator('.question__text'), 'WHAT WOULD YOU HAVE WANTED?');
    expect(await pressed(block)).toEqual(['false', 'false', 'false']);
    await answer(block, 'ANOTHER SIZE').click();
    await expect.poll(() => pressed(block), POLL).toEqual(['true', 'false', 'false']);
    await textOf(block.locator('.question__note'), THANKS);
    expect(await stored(absent.id)).toBe(1);
    const checks = await screenChecks(page);
    expect(checks.contrast).toEqual([]);
    expect(checks.figures).toEqual([]);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    expect(floors.checked).toEqual(expect.arrayContaining(ANSWERS));
    await sideways(page);
    await section.scrollIntoViewIfNeeded();
    await sleep(900);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-question.png'), fullPage: true });
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);
});
