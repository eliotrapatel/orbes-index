/**
 * End-to-end: THE RELEASES' LIVE and PAST tabs (plan LIVE RELEASE+, step S7: choice 5, decisions 28 to 30), served by
 * the real server (in-memory database, the real clock), driven in Chromium at a phone's size.
 *
 *  - The tabs: LIVE shown first, the releases to come and under way (a LIVE RELEASE announced, a draw open), never one
 *    ended; PAST, reached by the keyboard (the arrow keys) as by a tap, every release ended, the newest first, LIVE
 *    RELEASES and draws together, each card its photograph, LIVE RELEASE or DRAW, its name, its opening date and its
 *    quantity line as announced, no end figure; a page at a time (SHOW MORE, the keyboard then on the first release it
 *    brought).
 *  - Signed in: « You have taken part in N releases. » at the top of PAST, YOU SECURED A PIECE and YOU TOOK PART on the
 *    releases concerned, nothing on the others; signed out, none of it.
 *  - A card opens the release's page in its final state (decision 30): a LIVE RELEASE in the vault, its piece, its name,
 *    SEE THE MODEL, THIS RELEASE IS OVER, its date and quantity line, the account's part, its description and one
 *    action, never how it ended nor the reservation's page; a draw's page THIS RELEASE IS OVER with the account's part,
 *    its draw's list never saying how many took part. Back returns to PAST.
 *  - On every screen: the text's contrast, no figure in the display face, the floors of BRAND-DESIGN-SYSTEM §3.8, nothing
 *    scrolling sideways at the phone widths. Skipped when Chromium is absent.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { createManualClock, SYSTEM_ACTOR } from '../../src/server/types.js';
import { RELEASES } from '../../src/web/verify/copy.js';
import { PAST_PAGE_SIZE } from '../../src/web/verify/releases-model.js';
import { jpegPhoto } from '../support/images.js';
import { createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { keepsVault, screenChecks } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PHONE_WIDTHS = [360, 375, 320] as const;
/** A card's line: its opening date on the phone's calendar, then its quantity as announced. */
const LINE = (quantity: string) => new RegExp(`^\\d{1,2} [A-Z]{3} \\d{4} · ${quantity}$`);

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

describe.skipIf(!HAS_CHROMIUM)("THE RELEASES' LIVE and PAST tabs, a past release's final state (Chromium)", () => {
  let srv: VerifyServer;
  let browser: Browser;
  let f: LiveFixture;
  let n = 0;
  /** The releases of the suite. */
  let live: { id: string };
  let draw: { id: string };
  let coming: { id: string };
  let open: { id: string };
  let older: string[];
  /** Secured a piece in the LIVE RELEASE, took part in the draw. */
  let collector: { id: string; token: string };
  /** Took part in nothing. */
  let newcomer: { id: string; token: string };

  async function account(pieces = 0) {
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email: `past.${++n}@example.com`, password: PASSWORD }, {});
    if (pieces > 0) await holdPieces(srv.ctx.db, a.id, pieces, f.modelId);
    return { id: a.id, token: session.token, actor: { type: 'account' as const, id: a.id } };
  }

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    f = await liveFixtureOn(srv.ctx, createManualClock(new Date()));
    const { ctx } = srv;
    // NOCTURNE, photographed, PUBLIC in the lookbook: its LIVE RELEASE's page links its sheet.
    const nocturne = await createModel(ctx.db, 'NOCTURNE');
    await ctx.services.media.setModelImage(nocturne, { mime: 'image/jpeg', bytes: jpegPhoto(600, 600) }, SYSTEM_ACTOR);
    await ctx.services.catalog.updateModel(nocturne, { slug: 'nocturne', lookbook: 'PUBLIC' }, SYSTEM_ACTOR);
    await ctx.services.media.setModelImage(f.modelId, { mime: 'image/jpeg', bytes: jpegPhoto(500, 500) }, SYSTEM_ACTOR);
    const a = await account();
    // The other entrant holds a piece (TITANE): the draw ranks it first.
    const b = await account(1);
    collector = a;
    newcomer = await account();

    // A draw of one piece: the collector and another enter; drawn; the other's place concluded, the collector waiting.
    const d = await ctx.services.drops.create(
      { modelId: f.modelId, title: 'ECLIPSE — release I', quantity: 1, opensAt: new Date(Date.now() - 2 * HOUR), closesAt: new Date(Date.now() + DAY), earlyAccessHours: 0 },
      f.admin,
    );
    await ctx.services.drops.publish(d.id, f.admin);
    for (const x of [a, b]) await ctx.services.drops.enter(x.id, d.id, x.actor);
    await ctx.db.updateTable('drops').set({ closes_at: new Date(Date.now() - 1000) }).where('id', '=', d.id).execute();
    await ctx.services.drops.draw(d.id, f.admin);
    const other = await ctx.db.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', d.id).where('account_id', '=', b.id).executeTakeFirstOrThrow();
    expect(other.status).toBe('SELECTED');
    await ctx.services.drops.confirm(d.id, other.id, null, f.admin);
    draw = d;

    // A LIVE RELEASE live since a minute: the collector joins the line, secures and pays; ORBES then ends it.
    const r = await createLiveRelease(f, { modelId: nocturne, opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + HOUR), quantityLine: '25 PIECES', sizes: [{ label: '52', stock: 2 }] });
    await ctx.db.updateTable('drops').set({ title: 'NOCTURNE — LIVE', description: 'Twenty-five rings, cast in Paris.' }).where('id', '=', r.id).execute();
    await ctx.services.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    await ctx.services.live.advance(r.id);
    const token = (await ctx.services.live.entry(a.id, r.id))!.turn!.token!;
    await ctx.services.live.press(a.id, r.id, token);
    await sleep(1_600);
    await ctx.services.live.secure(a.id, r.id, token, a.actor);
    await ctx.services.live.confirm(a.id, r.id, a.actor);
    // Pieces added live: the line stays the one announced.
    await ctx.services.live.addPieces(r.id, r.sizes[0]!.id, 3, f.admin);
    await ctx.services.live.end(r.id, f.admin);
    live = r;

    // Older draws, drawn long ago: PAST shows them a page at a time.
    older = [];
    for (let i = 0; i < PAST_PAGE_SIZE; i++) {
      const x = await ctx.services.drops.create(
        { modelId: f.modelId, title: `ARCHIVE — release ${i + 1}`, quantity: 2, opensAt: new Date(Date.now() + HOUR), closesAt: new Date(Date.now() + 2 * HOUR), earlyAccessHours: 0 },
        f.admin,
      );
      await ctx.services.drops.publish(x.id, f.admin);
      // Its dates moved to the past it stands for (the console publishes a release only ahead of its entries), then drawn.
      await ctx.db
        .updateTable('drops')
        .set({ opens_at: new Date(Date.now() - (3 + i) * DAY), closes_at: new Date(Date.now() - (2 + i) * DAY), published_at: new Date(Date.now() - (4 + i) * DAY) })
        .where('id', '=', x.id)
        .execute();
      await ctx.services.drops.draw(x.id, f.admin);
      older.push(x.id);
    }
    // To come: a LIVE RELEASE announced, a draw open.
    coming = await createLiveRelease(f, { opensAt: new Date(Date.now() + 2 * DAY), quantityLine: '12 PIECES' });
    await ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', coming.id).execute();
    open = await ctx.services.drops.create({ modelId: f.modelId, title: 'ECLIPSE — release II', quantity: 3, opensAt: new Date(Date.now() - HOUR), closesAt: new Date(Date.now() + DAY), earlyAccessHours: 0 }, f.admin);
    await ctx.services.drops.publish(open.id, f.admin);
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

  /** The ivory pages: every text at 4.5 : 1, no figure in the display face, the floors of §3.8, nothing scrolling sideways. */
  async function keepsBrand(page: Page, controls: string[]): Promise<void> {
    const checks = await screenChecks(page);
    expect(checks.contrast).toEqual([]);
    expect(checks.figures).toEqual([]);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    expect(floors.checked).toEqual(expect.arrayContaining(controls));
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  const tab = (page: Page, name: 'LIVE' | 'PAST') => page.getByRole('tab', { name, exact: true });
  const pastCard = (page: Page, id: string) => page.locator('#releases-panel-past article.release-card').filter({ has: page.locator(`#past-${id}-title`) });

  it('LIVE first, the releases to come; PAST by the keyboard, every release ended, the newest first, as announced, a page at a time; signed out, no part said', async () => {
    const { page, context, problems } = await phone(null);
    await page.goto(`${srv.origin}/verify/releases`);
    await visible(page.getByRole('tablist', { name: 'THE RELEASES' }));
    expect(await tab(page, 'LIVE').getAttribute('aria-selected')).toBe('true');
    expect(await tab(page, 'PAST').getAttribute('aria-selected')).toBe('false');
    // LIVE: the LIVE RELEASE announced and the open draw; nothing ended.
    const livePanel = page.locator('#releases-panel-live');
    await visible(livePanel.locator(`#release-${coming.id}-title`));
    await visible(livePanel.locator(`#release-${open.id}-title`));
    for (const id of [live.id, draw.id, ...older]) expect(await page.locator(`#release-${id}-title`).count(), id).toBe(0);
    await keepsBrand(page, ['LIVE', 'PAST', 'SEE THE RELEASE']);

    // PAST from the keyboard: the arrow moves the selection and the focus; the LIVE panel hidden.
    await tab(page, 'LIVE').focus();
    await page.keyboard.press('ArrowRight');
    expect(await tab(page, 'PAST').evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await tab(page, 'PAST').getAttribute('aria-selected')).toBe('true');
    expect(await tab(page, 'PAST').getAttribute('tabindex')).toBe('0');
    expect(await tab(page, 'LIVE').getAttribute('tabindex')).toBe('-1');
    expect(await livePanel.isHidden()).toBe(true);
    const panel = page.locator('#releases-panel-past');
    expect(await panel.getAttribute('role')).toBe('tabpanel');
    expect(await panel.getAttribute('aria-labelledby')).toBe('releases-tab-past');
    // The newest first: the LIVE RELEASE ended a moment ago, the draw, then the older draws; a page of them.
    const cards = panel.locator('article.release-card');
    await expect.poll(() => cards.count(), POLL).toBe(PAST_PAGE_SIZE);
    const ids = await cards.evaluateAll((els) => els.map((el) => el.querySelector('h2')!.id.replace(/^past-|-title$/g, '')));
    expect(ids).toEqual([live.id, draw.id, ...older.slice(0, PAST_PAGE_SIZE - 2)]);
    const first = pastCard(page, live.id);
    // NOCTURNE (C25): its kind and date, its title, its model, its quantity as announced.
    await textOf(first.locator('.release-card__state'), /^LIVE RELEASE · \d{1,2} [A-Z]{3} \d{4}$/);
    await textOf(first.locator('.release-card__title'), 'NOCTURNE');
    await textOf(first.locator('.release-card__model'), 'RING');
    await textOf(first.locator('.release-card__line'), '25 PIECES');
    expect(await first.locator('img.release-card__img').getAttribute('src')).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
    const second = pastCard(page, draw.id);
    await textOf(second.locator('.release-card__state'), /^DRAW · \d{1,2} [A-Z]{3} \d{4}$/);
    await textOf(second.locator('.release-card__title'), 'ECLIPSE — RELEASE I');
    await textOf(second.locator('.release-card__model'), 'MONOLITHE · RING');
    await textOf(second.locator('.release-card__line'), '1 PIECE');
    // Signed out: no part said.
    expect(await page.locator('.releases__taken').isHidden()).toBe(true);
    expect(await panel.locator('.release-card__mark:visible').count()).toBe(0);
    // No end figure, no DRAWN mark anywhere in PAST.
    const text = norm(await panel.innerText());
    for (const word of ['SOLD OUT', 'DRAWN', 'ENDED', 'CLOSED', 'COLLECTORS', 'took part in the draw', 'LEFT', '28 PIECES']) expect(text, word).not.toContain(word);
    await keepsBrand(page, ['LIVE', 'PAST', 'SEE THE RELEASE', RELEASES.past.more]);
    await page.screenshot({ path: join(OUT_DIR, 'verify-releases-past.png'), fullPage: true });

    // SHOW MORE: the rest, the keyboard on the first release it brought; no SHOW MORE once all are shown.
    await panel.getByRole('button', { name: RELEASES.past.more }).click();
    await expect.poll(() => cards.count(), POLL).toBe(PAST_PAGE_SIZE + 2);
    expect(await pastCard(page, older[PAST_PAGE_SIZE - 2]!).getByRole('link', { name: 'SEE THE RELEASE' }).evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await panel.getByRole('button', { name: RELEASES.past.more }).count()).toBe(0);
    // A tap goes back to LIVE.
    await tab(page, 'LIVE').click();
    expect(await livePanel.isVisible()).toBe(true);
    expect(await panel.isHidden()).toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);

  it('signed in: the releases taken part in at the top, each card its part; a card opens its final state, back returns to PAST', async () => {
    const { page, context, problems } = await phone(collector.token);
    await page.goto(`${srv.origin}/verify/releases`);
    await tab(page, 'PAST').click();
    await textOf(page.locator('.releases__taken'), 'You have taken part in 2 releases.');
    await textOf(pastCard(page, live.id).locator('.release-card__mark'), RELEASES.past.secured);
    await textOf(pastCard(page, draw.id).locator('.release-card__mark'), RELEASES.past.tookPart);
    expect(await pastCard(page, older[0]!).locator('.release-card__mark').isHidden()).toBe(true);
    await keepsBrand(page, ['PAST', 'SEE THE RELEASE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-releases-past-signed-in.png'), fullPage: true });

    // The LIVE RELEASE: its final state, never how it ended; the piece secured, its reservation in the ivory kept from
    // the room (NOCTURNE, C29).
    await pastCard(page, live.id).getByRole('link', { name: 'SEE THE RELEASE' }).click();
    expect(new URL(page.url()).pathname).toBe(`/verify/releases/${live.id}`);
    await textOf(page.locator('.live__past h1'), 'NOCTURNE');
    expect(await page.locator('.view--live').getAttribute('data-screen')).toBe('past');
    expect(await page.locator('.view--live').evaluate((el) => el.classList.contains('vault'))).toBe(true);
    await textOf(page.locator('.n-live__kind'), /^LIVE RELEASE · [A-Z]+DAY \d{1,2} [A-Z]+$/);
    await textOf(page.locator('.n-live__type'), 'RING');
    await textOf(page.locator('.live__past-status'), RELEASES.over);
    await textOf(page.locator('.n-live__pieces-line'), '25 PIECES');
    await textOf(page.locator('.live__past-part'), RELEASES.past.secured);
    await textOf(page.locator('.live__past .n-live__description'), 'Twenty-five rings, cast in Paris.');
    expect(await page.locator('.live__past .n-live__img').getAttribute('src')).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
    expect(await page.locator('.n-live__see').getAttribute('href')).toBe('/verify/lookbook/nocturne');
    const receipt = page.locator('.n-live__receipt');
    await textOf(receipt.locator('h2'), 'CONFIRMED');
    await textOf(receipt.locator('.n-kv__row', { hasText: 'SIZE' }), 'SIZE 52');
    await textOf(receipt.locator('.n-kv__row', { hasText: 'REFERENCE' }), /^REFERENCE LR-[0-9A-Z]{8}$/);
    const words = norm(await page.locator('main').innerText());
    for (const word of ['SOLD OUT', 'HAS ENDED', 'IN THE ROOM', 'LEFT', 'COLLECTORS', '28 PIECES']) expect(words, word).not.toContain(word);
    // THE RELEASES once (the crumb): the foot does not say it twice.
    expect(await page.getByRole('link', { name: 'THE RELEASES', exact: true }).count()).toBe(1);
    await keepsVault(page, null, ['SEE THE MODEL', 'THE RELEASES', 'MY PIECES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-past.png'), fullPage: true });

    // Back: THE RELEASES on PAST, as left.
    await page.goBack();
    await visible(pastCard(page, live.id));
    expect(await tab(page, 'PAST').getAttribute('aria-selected')).toBe('true');

    // The draw: its page says it is over, the account's part; its list of entries, never how many.
    await pastCard(page, draw.id).getByRole('link', { name: 'SEE THE RELEASE' }).click();
    await textOf(page.locator('h1'), 'ECLIPSE — RELEASE I');
    await textOf(page.locator('.release__state'), RELEASES.over);
    await textOf(page.locator('.release__part'), RELEASES.past.tookPart);
    await textOf(page.locator('.release__entries-lead'), RELEASES.entriesLead);
    await expect.poll(() => page.locator('.release__item').count(), POLL).toBe(2);
    const drawWords = norm(await page.locator('main').innerText());
    for (const word of ['took part in the draw', 'RESERVED DIRECTLY', 'DRAWN ·']) expect(drawWords, word).not.toContain(word);
    await keepsBrand(page, ['THE RELEASES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-release-past-draw.png'), fullPage: true });
    // Its THE RELEASES: back to PAST.
    await page.locator('.release__crumb').click();
    await visible(pastCard(page, draw.id));
    expect(await tab(page, 'PAST').getAttribute('aria-selected')).toBe('true');
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);

  it('a collector who took part in nothing reads « You have taken part in 0 releases. » and no mark; signed out, a past page says no part, its one action THE RELEASES', async () => {
    const fresh = await phone(newcomer.token);
    await fresh.page.goto(`${srv.origin}/verify/releases`);
    await tab(fresh.page, 'PAST').click();
    await textOf(fresh.page.locator('.releases__taken'), 'You have taken part in 0 releases.');
    await visible(pastCard(fresh.page, live.id));
    expect(await fresh.page.locator('.release-card__mark:visible').count()).toBe(0);
    expect(fresh.problems).toEqual([]);
    await fresh.context.close();

    const { page, context, problems } = await phone(null);
    await page.goto(`${srv.origin}/verify/releases/${live.id}`);
    await textOf(page.locator('.live__past-status'), RELEASES.over);
    await sleep(500);
    expect(await page.locator('.live__past-part').isHidden()).toBe(true);
    await keepsVault(page, null, ['THE RELEASES']);
    expect(await page.locator('.n-live__receipt').count()).toBe(0);
    await page.locator('.live__past').getByRole('link', { name: 'THE RELEASES' }).click();
    await visible(page.getByRole('tablist', { name: 'THE RELEASES' }));
    expect(new URL(page.url()).pathname).toBe('/verify/releases');
    expect(problems).toEqual([]);
    await context.close();
  }, 60_000);
});
