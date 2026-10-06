/**
 * End-to-end: a LIVE RELEASE in the built verification app (plan of 2026-10-04, Quality bar item 4), served by the real
 * server with the live engine ticking (in-memory database, the real clock), driven in Chromium at a phone viewport.
 *
 *  - Announced: its vault plate in THE RELEASES among the draws' ivory ones, then its page (B1): the piece, OPENS IN,
 *    the time in Paris then on this phone, the rule, ADD TO CALENDAR.
 *  - The room (B2): the model, its price and the quantity line; the closed door, its lock the seal; READY CHECK; the size
 *    of I'LL BE THERE preselected; ENTER; the size changeable until T0. The last minute the lock's orbits turn back, the last ten seconds tick (ten soft voices
 *    of the sound module); at T0 the lock aligns and the door opens on the piece under its light sweep.
 *  - The line (B3): the place, who is ahead in the size, the pieces left and held, the size never offered again.
 *  - The turn (B4), a piece returned: a pointer let go too early resets the seal; held, it secures the piece. The
 *    reveal (B5), even when the stream says SECURED before the secure's own answer: P-D01's motion on the seal's glyphs,
 *    the chord, the vibrations; the add-ons, PAY · total, 5:00.
 *  - CONFIRMED (B6), out into the light: ivory; the reservation in MY PIECES, and its order (plan LIVE RELEASE+).
 *  - A phone whose clock is wrong counts on the server's; the host message under the header.
 *  - With reduced motion and no stream (the state polled every 2 s): no orbit turned, no reveal motion; after T0, its one
 *    piece in another collector's turn, the size still offered then ENTER THE LINE, behind; the piece returned; a pause
 *    said under the header, the seal not offered and its time still; the seal held from the keyboard (the space bar); a
 *    pause on the piece held, its time to confirm still; RELEASE MY PLACE confirmed by a second tap.
 *  - Every edge page: not signed in, not eligible, turn passed, hold ended, place released, left the line, removed, sold
 *    out in your size, the release closed before your turn; past its end, its final state for one not in it (plan LIVE
 *    RELEASE+, decision 30); the release's end said once the room says its reason, when the entry's end is read first.
 *  - A collector entered on another phone, back in the room: a tap there makes the ten ticks heard; untouched, silence.
 *  - The LIVE RELEASES refused (429, their own rate group): THE RELEASES still shows the draws and says the LIVE half is
 *    missing; a draw's address shows its draw; a LIVE one says its failure, TRY AGAIN reading it again.
 *
 * On every screen: the text's contrast on its ground computed from the page's own colours (at least 4.5 : 1), at most
 * one primary action (filled ivory), no figure in the display face, and the floors of BRAND-DESIGN-SYSTEM §3.8 (44 px
 * zones, 10 px type, nothing scrolling sideways). The page says the place and the turn aloud (aria-live).
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLiveEngine } from '../../src/server/context.js';
import type { LiveEngine } from '../../src/server/services/live-engine.js';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { createManualClock, SYSTEM_ACTOR } from '../../src/server/types.js';
import { LIVE, RELEASES } from '../../src/web/verify/copy.js';
import { jpegPhoto } from '../support/images.js';
import { createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture, type LiveRelease, type LiveReleaseOptions } from '../support/live.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { focusRingContrast, keepsVault, screenChecks } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const IVORY = 'rgb(246, 242, 234)';
const GROUND = 'rgb(10, 10, 10)';

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}
const visible = (loc: Locator, timeout = POLL.timeout) => loc.waitFor({ state: 'visible', timeout });

interface Watched {
  page: Page;
  context: BrowserContext;
  problems: string[];
}

/** The page's stand-ins: the vibrations asked for, and the frequency of every voice the sound module schedules. */
const STAND_INS = `
  window.__live = { vibrations: [], tones: [] };
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__live.vibrations.push(p); return true; } });
  const proto = (window.AudioContext || window.webkitAudioContext).prototype;
  const create = proto.createOscillator;
  proto.createOscillator = function () {
    const o = create.call(this);
    const set = o.frequency.setValueAtTime.bind(o.frequency);
    o.frequency.setValueAtTime = (v, t) => { window.__live.tones.push(Math.round(v * 100) / 100); return set(v, t); };
    return o;
  };
`;

const live = (page: Page) => page.evaluate(() => (window as unknown as { __live: { vibrations: unknown[]; tones: number[] } }).__live);

describe.skipIf(!HAS_CHROMIUM)('a LIVE RELEASE in /verify, the vault (Chromium, phone)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let engine: LiveEngine;
  let f: LiveFixture;
  let n = 0;

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    f = await liveFixtureOn(srv.ctx, createManualClock(new Date()));
    await srv.ctx.services.media.setModelImage(f.modelId, { mime: 'image/jpeg', bytes: jpegPhoto(600, 600) }, SYSTEM_ACTOR);
    engine = startLiveEngine(srv.ctx, { connection: 'shared' });
    browser = await launchChromium();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await engine?.stop();
    await srv?.close();
  });

  /** An ORBES account holding `pieces` pieces (its tier: 1 TITANE, 3 PLATINE, 5 PALLADIUM). */
  async function account(pieces: number) {
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email: `live.e2e.${++n}@example.com`, password: PASSWORD }, {});
    if (pieces > 0) await holdPieces(srv.ctx.db, a.id, pieces, f.modelId);
    return { id: a.id, token: session.token, actor: { type: 'account' as const, id: a.id } };
  }

  async function release(o: Partial<LiveReleaseOptions> & { opensAt: Date }): Promise<LiveRelease> {
    const r = await createLiveRelease(f, { priceMinor: 505_000, quantityLine: '25 PIECES', ...o });
    await srv.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    return r;
  }

  /** A phone, signed in as `token` when given (its session cookie, as the sign-in sets it). */
  async function phone(token: string | null, opts: { reducedMotion?: 'reduce' | 'no-preference'; skewMs?: number; noStream?: boolean } = {}): Promise<Watched> {
    const context = await mobileContext(browser, { reducedMotion: opts.reducedMotion });
    if (token) await context.addCookies([{ name: sessionCookieName(srv.ctx.config, 'account'), value: token, url: srv.origin }]);
    await context.addInitScript(STAND_INS);
    // A phone whose own clock is wrong: the page counts on the server's.
    if (opts.skewMs) await context.addInitScript(`{ const now = Date.now.bind(Date); Date.now = () => now() + ${opts.skewMs}; }`);
    // A browser (or a network) where no stream reaches the page: it polls the state.
    if (opts.noStream) await context.addInitScript('delete window.EventSource;');
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`);
      if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    return { page, context, problems };
  }

  /** The live view's own state: an entry's status in the database. */
  const statusOf = async (dropId: string, accountId: string) =>
    (await srv.ctx.db.selectFrom('live_entries').select(['status', 'size_id']).where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst()) ?? null;

  /** The turn's secret of an account (its own state), for the services that act as another phone. */
  async function turnToken(dropId: string, accountId: string): Promise<string> {
    const views = await srv.ctx.services.liveRoom.viewerEntries(dropId, [accountId]);
    return views.get(accountId)!.turn!.token!;
  }

  /** Another phone secures its turn (press, hold, secure), then confirms it when asked. */
  async function secureAs(dropId: string, a: { id: string; actor: { type: 'account'; id: string } }, confirm: boolean): Promise<void> {
    await expect.poll(async () => (await statusOf(dropId, a.id))?.status, POLL).toBe('TURN');
    const token = await turnToken(dropId, a.id);
    await srv.ctx.services.live.press(a.id, dropId, token);
    await sleep(1_500);
    await srv.ctx.services.live.secure(a.id, dropId, token, a.actor);
    if (confirm) await srv.ctx.services.live.confirm(a.id, dropId, a.actor);
  }

  it('announced → the room → the door at T0 → the line → the turn (a pointer hold) → the reveal and the add-ons → PAY → CONFIRMED in ivory', async () => {
    const t0 = new Date(Date.now() + 45_000);
    const r = await release({ opensAt: t0, minTier: 1, sizes: [{ label: '50', stock: 2 }, { label: '52', stock: 1 }], addons: [{ label: 'ENGRAVING', line: 'Your initials', priceMinor: 15_000 }, { label: 'GIFT BOX', priceMinor: 9_000 }] });
    const later = await release({ opensAt: new Date(Date.now() + 3 * 86_400_000), roomOpensMinutes: 5, minTier: 2 });
    const [s50, s52] = r.sizes;
    // A PALLADIUM collector in size 52 is ahead at T0; the collector said I'LL BE THERE in size 52.
    const rival = await account(5);
    await srv.ctx.services.live.enter(rival.id, r.id, { sizeId: s52!.id }, rival.actor);
    const me = await account(1);
    await srv.ctx.services.live.setInterest(me.id, r.id, s52!.id, me.actor);
    await srv.ctx.services.live.message(r.id, 'Welcome to the vault.', f.admin);
    // This phone's clock runs 37 minutes ahead: the countdown, the ticks and the door keep to the server's time.
    const { page, problems } = await phone(me.token, { skewMs: 37 * 60_000 });

    // THE RELEASES: the LIVE RELEASES first, on vault plates.
    await page.goto(`${srv.origin}/verify/releases`);
    const card = page.locator('article.live-card').filter({ has: page.locator(`#release-${later.id}-title`) });
    await visible(card);
    await textOf(card.locator('.live-card__kind'), 'LIVE RELEASE');
    await textOf(card.locator('.live-card__title'), 'MONOLITHE');
    await textOf(card.locator('.live-card__line'), '€ 5 050 · 25 PIECES · ONE PER COLLECTOR');
    await textOf(card.locator('.live-card__access'), 'FOR OWNERS FROM PLATINE');
    await textOf(card.locator('.live-card__when').first(), /^[A-Z]+DAY \d{1,2} [A-Z]+ · \d{2}:\d{2} PARIS$/);
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GROUND);
    await textOf(page.locator('article.live-card').filter({ has: page.locator(`#release-${r.id}-title`) }).locator('.live-card__kind'), 'LIVE RELEASE · THE ROOM IS OPEN');
    await keepsVault(page, null, ['SEE THE RELEASE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-releases.png'), fullPage: true });

    // B1: the release announced, three days ahead.
    await card.getByRole('link', { name: 'SEE THE RELEASE' }).click();
    expect(new URL(page.url()).pathname).toBe(`/verify/releases/${later.id}`);
    await textOf(page.locator('h1'), 'MONOLITHE');
    await textOf(page.locator('.live__screen > .live__overline').first(), 'LIVE RELEASE');
    await textOf(page.locator('.live__price'), '€ 5 050');
    await expect.poll(async () => (await page.locator('.live__unit-label').allInnerTexts()).map(norm)).toEqual(['DAYS', 'HOURS', 'MINUTES']);
    await textOf(page.locator('.live__facts'), 'FOR OWNERS FROM PLATINE 25 PIECES · ONE PER COLLECTOR THE ROOM OPENS 5 MINUTES BEFORE');
    expect(await page.getByRole('link', { name: 'ADD TO CALENDAR' }).getAttribute('href')).toBe(`/api/v1/live/${later.id}/calendar.ics`);
    expect(await page.locator('.view--live').evaluate((el) => el.classList.contains('vault'))).toBe(true);
    // The ground follows into the vault (its colour eased in 0.9 s).
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(GROUND);
    await keepsVault(page, null, ['ADD TO CALENDAR', 'THE RELEASES', 'SOUND ON']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-announced.png'), fullPage: true });

    // B2: the room, open. The door closed, its lock the seal (the specimen: thirteen orbits, eight glyphs).
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(page.locator('.live__room > .live__overline'), 'THE ROOM IS OPEN');
    // The model, its price and the quantity line.
    await textOf(page.locator('.live__room > h1'), 'MONOLITHE');
    await textOf(page.locator('.live__room > .live__offer'), '€ 5 050 · 25 PIECES');
    await visible(page.locator('.live-door .live-door__seal'));
    expect(await page.locator('.live-door__seal .live-seal__ring').count()).toBe(13);
    expect(await page.locator('.live-door__seal g[data-layer="genome"]').count()).toBe(8);
    expect(await page.locator('.live-door').getAttribute('aria-hidden')).toBe('true');
    await textOf(page.locator('.live__presence'), '1 IN THE ROOM');
    // The latest host message, under the header.
    await textOf(page.locator('.live__notice .live__message'), 'FROM ORBES Welcome to the vault.');
    // The countdown on ORBES time, not this phone's.
    await expect.poll(async () => {
      const [m, s] = (await page.locator('.live__count').innerText()).split(':').map(Number);
      return Math.abs(m! * 60 + s! - (t0.getTime() - Date.now()) / 1000);
    }, POLL).toBeLessThan(2);
    await expect.poll(async () => (await page.locator('.live__check').allInnerTexts()).map(norm), POLL).toEqual([
      'SIGNED IN ready',
      'ACCESS TITANE ready',
      'SIZE 52 ready',
      'CONNECTION LIVE ready',
      'CLOCK SYNCED TO ORBES ready',
    ]);
    // The size of I'LL BE THERE preselected, outlined; ENTER THE ROOM the one filled action.
    const size = (label: string) => page.locator('.live__size', { hasText: label });
    expect(await size('52').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('.live__picker').evaluate((el) => el.classList.contains('is-choosing'))).toBe(true);
    await keepsVault(page, 'ENTER THE ROOM', ['50', '52', 'ENTER THE ROOM']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-room.png'), fullPage: true });
    // The keyboard's focus shows on the filled action and on the size chosen (its inner outline the choice): ivory outside.
    expect(await focusRingContrast(page, size('52'))).toBeGreaterThanOrEqual(3);
    expect(await focusRingContrast(page, page.getByRole('button', { name: 'ENTER THE ROOM' }))).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'ENTER THE ROOM' }).click();
    await visible(page.getByText(LIVE.youreReady));
    expect(await statusOf(r.id, me.id)).toEqual({ status: 'WAITING', size_id: s52!.id });
    // Entered: the size chosen is the filled one; it changes until T0.
    await keepsVault(page, '52', ['50', '52', 'LEAVE THE ROOM']);
    expect(await focusRingContrast(page, size('52'))).toBeGreaterThanOrEqual(3);
    await size('50').click();
    await expect.poll(async () => (await statusOf(r.id, me.id))?.size_id, POLL).toBe(s50!.id);
    await expect.poll(() => size('50').getAttribute('aria-pressed')).toBe('true');
    await size('52').click();
    await expect.poll(async () => (await statusOf(r.id, me.id))?.size_id, POLL).toBe(s52!.id);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-ready.png'), fullPage: true });

    // The last minute: the lock's orbits turned, turning back; the last ten seconds tick.
    await expect.poll(() => page.locator('.live-door__seal .live-seal__ring').first().evaluate((g) => (g as SVGGElement).style.transform), POLL).toMatch(/^rotate\(-?\d/);
    const turned = await page.locator('.live-door__seal .live-seal__ring').evaluateAll((gs) => gs.map((g) => (g as SVGGElement).style.transform));
    expect(new Set(turned).size).toBeGreaterThan(1);
    // T0: the lock aligned, the door open on the piece under its light, the places drawn.
    await expect.poll(() => page.locator('.live-door').getAttribute('class'), { timeout: 45_000, interval: 50 }).toMatch(/is-aligned/);
    expect(await page.locator('.live-door__seal .live-seal__ring').evaluateAll((gs) => gs.every((g) => /rotate\((-)?0(\.00)?deg\)/.test((g as SVGGElement).style.transform)))).toBe(true);
    await expect.poll(() => page.locator('.live-door').getAttribute('class')).toMatch(/is-open/);
    await textOf(page.locator('.live__room > .live__overline'), 'LIVE NOW');
    await visible(page.getByText(LIVE.drawing));
    expect(await page.locator('.live-door .live__sweep').evaluate((el) => getComputedStyle(el).animationName)).toBe('live-sweep');
    expect(Date.now()).toBeGreaterThanOrEqual(t0.getTime() - 1_000);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-open.png') });
    const ticks = (await live(page)).tones.filter((t) => t === 1318.51);
    expect(ticks).toHaveLength(10);

    // B3: the line. The rival has the turn in size 52: the collector is next, the piece held may return.
    await textOf(page.locator('.live__place-figure'), '2');
    await textOf(page.locator('.live__ahead'), 'YOU ARE NEXT IN SIZE 52');
    await textOf(page.locator('.live__left'), '2 OF 3 LEFT · 0 IN SIZE 52');
    await textOf(page.locator('.live__held'), '1 HELD PIECE MAY RETURN');
    expect(await page.locator('.live__meter .live__cell').count()).toBe(3);
    expect(await page.locator('.live__size').count()).toBe(0);
    await expect.poll(() => page.locator('[role="status"][aria-live="polite"]').innerText()).toBe('Your place: 2. You are next in size 52.');
    await keepsVault(page, null, ['THE RELEASES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-line.png'), fullPage: true });

    // B4: the rival lets its turn go: a piece has returned, the collector's turn, said aloud, the seal focused.
    await srv.ctx.services.live.leave(rival.id, r.id, rival.actor);
    await textOf(page.locator('.live__turn > .live__overline'), 'A PIECE HAS RETURNED');
    await expect.poll(() => page.locator('[aria-live="assertive"]').innerText()).toBe(LIVE.announce.returned);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('live-hold'))).toBe(true);
    await textOf(page.locator('.live__turn-left'), /^00:(2\d|30)$/);
    await textOf(page.locator('.live__turn-piece'), 'MONOLITHE · SIZE 52 · € 5 050');
    await keepsVault(page, null, ['THE RELEASES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-turn.png'), fullPage: true });
    const seal = page.locator('.live-hold');
    const box = (await seal.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(240);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Let go too early: the ring resets, nothing is secured.
    await page.mouse.down();
    await sleep(500);
    expect(await page.locator('.live__turn').getAttribute('class')).toMatch(/is-holding/);
    await page.mouse.up();
    await expect.poll(() => page.locator('.live__turn').getAttribute('class')).not.toMatch(/is-holding/);
    expect(await page.locator('.live-hold__fill').getAttribute('stroke-dashoffset')).toBe((2 * Math.PI * 116).toFixed(2));
    await expect.poll(() => page.locator('[role="status"][aria-live="polite"]').innerText()).toBe(LIVE.announce.reset);
    expect((await statusOf(r.id, me.id))?.status).toBe('TURN');
    // The secure's own answer held back 3 s: the stream says SECURED first, and the reveal still plays.
    let answered = false;
    await page.route(
      (u) => u.pathname === `/api/v1/live/${r.id}/secure`,
      async (route) => {
        const response = await route.fetch();
        await sleep(3_000);
        answered = true;
        await route.fulfill({ response });
      },
    );
    // Held: the ring fills, the piece is secured.
    await page.mouse.down();
    await sleep(2_100);
    await page.mouse.up();

    // B5: the reveal (P-D01's motion on the seal's glyphs), the chord, the vibrations; then the add-ons and PAY.
    await textOf(page.locator('.live__secured > .live__overline').first(), 'SECURED');
    expect(answered).toBe(false);
    expect(await page.locator('.live__secured').getAttribute('class')).toMatch(/is-revealing/);
    expect(await page.locator('.live__piece-seal g[data-layer="genome"]').first().evaluate((g) => getComputedStyle(g).animationName)).toBe('ceremony-glyph');
    await expect.poll(async () => (await live(page)).tones.filter((t) => t === 293.66).length).toBe(1);
    expect((await live(page)).vibrations).toEqual(expect.arrayContaining([12, [18, 90, 18]]));
    await expect.poll(() => page.locator('[role="status"][aria-live="polite"]').innerText()).toBe(LIVE.announce.secured('MONOLITHE'));
    await textOf(page.locator('.live__secured-at'), /^SECURED AT \d{2}:\d{2}:\d{2}$/);
    await textOf(page.locator('.live__deadline'), /^0[45]:\d{2} TO CONFIRM$/);
    // The answer, once it comes, plays nothing twice.
    await expect.poll(() => answered, POLL).toBe(true);
    await page.unroute((u) => u.pathname === `/api/v1/live/${r.id}/secure`);
    await sleep(300);
    expect((await live(page)).tones.filter((t) => t === 293.66)).toHaveLength(1);
    expect(await page.locator('.live__secured').getAttribute('class')).toMatch(/is-revealing/);
    const pay = page.locator('.live__pay');
    await textOf(pay, 'PAY · € 5 050');
    await keepsVault(page, 'PAY · € 5 050', ['ENGRAVING + € 150', 'GIFT BOX + € 90', 'PAY · € 5 050', 'RELEASE MY PLACE']);
    await page.getByRole('button', { name: /ENGRAVING/ }).click();
    await textOf(pay, 'PAY · € 5 200');
    expect(await page.getByRole('button', { name: /ENGRAVING/ }).getAttribute('aria-pressed')).toBe('true');
    await keepsVault(page, 'PAY · € 5 200');
    expect(await focusRingContrast(page, pay)).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-secured.png'), fullPage: true });
    await pay.click();

    // B6: CONFIRMED, out into the light.
    await textOf(page.locator('h1'), 'CONFIRMED');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(IVORY);
    expect(await page.locator('.view--live').evaluate((el) => [el.classList.contains('vault'), el.classList.contains('is-light')])).toEqual([false, true]);
    await textOf(page.locator('.live__confirmed-text'), 'Your piece is reserved in size 52. ORBES Client Services will contact you to settle payment and delivery.');
    const entryId = (await srv.ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', me.id).executeTakeFirstOrThrow()).id;
    const reference = `LR-${entryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await textOf(page.locator('.live__receipt .rows__row').last(), `REFERENCE ${reference}`);
    await textOf(page.locator('.live__receipt .rows__row', { hasText: 'TOTAL' }), 'TOTAL € 5 200');
    await textOf(page.locator('.live__receipt .rows__row', { hasText: 'ENGRAVING' }), 'ENGRAVING € 150');
    expect((await statusOf(r.id, me.id))?.status).toBe('CONFIRMED');
    const light = await screenChecks(page);
    expect(light.contrast).toEqual([]);
    expect(light.figures).toEqual([]);
    expect((await tapZoneFloors(page)).problems).toEqual([]);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-confirmed.png'), fullPage: true });

    // MY PIECES keeps it.
    await page.getByRole('link', { name: 'MY PIECES' }).click();
    const entry = page.locator('.pieces__entry-card', { hasText: 'LIVE RELEASE' });
    await visible(entry);
    await textOf(entry.locator('.pieces__entry-state'), 'LIVE RELEASE · CONFIRMED');
    // Its payment and delivery are its order's steps, below (the vault's CONFIRMED screen said it at that moment).
    await textOf(entry.locator('.pieces__entry-sentence'), 'You secured your piece in size 52. Its steps follow in YOUR ORDERS.');
    await textOf(entry.locator('.pieces__entry-id'), `REFERENCE ${reference}`);
    expect(await entry.getByRole('link', { name: 'MONOLITHE — LIVE' }).getAttribute('href')).toBe(`/verify/releases/${r.id}`);
    // …and its order (plan LIVE RELEASE+, choice 6): RESERVED, with its size and its add-on as sold.
    const order = page.locator('.pieces__order', { hasText: 'LIVE RELEASE · MONOLITHE — LIVE' });
    await visible(order);
    await textOf(order.locator('.pieces__order-step[aria-current="step"]'), /^RESERVED \d{1,2} [A-Z]{3} \d{4}$/);
    await textOf(order.locator('.pieces__order-rows .rows__row', { hasText: 'ENGRAVING' }), 'ENGRAVING € 150');
    expect(problems).toEqual([]);
  }, 240_000);

  it('with reduced motion and no stream: no orbit turned, no reveal; after T0, its one piece in a turn, the size still offered, ENTER THE LINE, behind; the state polled; a pause; the seal held from the keyboard; a pause on the piece held; RELEASE MY PLACE on a second tap', async () => {
    const r = await release({ opensAt: new Date(Date.now() + 4_000), sizes: [{ label: 'ONE SIZE', stock: 1 }] });
    // A collector in the room before T0: at T0 the one piece is in its turn.
    const first = await account(0);
    await srv.ctx.services.live.enter(first.id, r.id, { sizeId: r.sizes[0]!.id }, first.actor);
    const me = await account(0);
    const { page, problems } = await phone(me.token, { reducedMotion: 'reduce', noStream: true });
    const polls: number[] = [];
    page.on('request', (req) => {
      if (req.url().endsWith(`/api/v1/live/${r.id}/state`)) polls.push(Date.now());
    });
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    // The room (or, past T0 already, the line to join): no orbit is turned when motion is reduced.
    await visible(page.locator('.live__room, .live__join'));
    expect(await page.locator('.live-seal__ring').evaluateAll((gs) => gs.every((g) => (g as SVGGElement).style.transform === ''))).toBe(true);
    await textOf(page.locator('.live__join > .live__overline'), 'LIVE NOW');
    await textOf(page.locator('.live__join-line'), LIVE.joinLine);
    // Arrived after T0, its one piece in the first collector's turn (none free, one that may return): the size is still
    // offered, as the server takes a late entry while a piece is not confirmed.
    await expect.poll(async () => (await statusOf(r.id, first.id))?.status, POLL).toBe('TURN');
    await textOf(page.locator('.live__join .live__left'), '0 OF 1 LEFT');
    // A one-size release: its one size preselected.
    const only = page.locator('.live__size');
    expect(await only.getAttribute('aria-pressed')).toBe('true');
    expect([await only.isEnabled(), await only.getAttribute('aria-label')]).toEqual([true, null]);
    expect(await page.getByRole('button', { name: 'ENTER THE LINE' }).isEnabled()).toBe(true);
    await keepsVault(page, 'ENTER THE LINE', ['ONE SIZE', 'ENTER THE LINE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-join.png'), fullPage: true });
    await page.getByRole('button', { name: 'ENTER THE LINE' }).click();
    // Behind the first collector: the line, the held piece that may return.
    await textOf(page.locator('.live__place-figure'), '2');
    await textOf(page.locator('.live__held'), '1 HELD PIECE MAY RETURN');
    expect((await statusOf(r.id, me.id))?.status).toBe('QUEUED');
    // The first collector lets the turn go: the piece has returned. The keyboard holds the seal with the space bar.
    await srv.ctx.services.live.leave(first.id, r.id, first.actor);
    await textOf(page.locator('.live__turn > .live__overline'), 'A PIECE HAS RETURNED');
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('live-hold'))).toBe(true);
    // Without a stream the page reads the state every two seconds, and follows the room all the same.
    expect(await page.evaluate(() => 'EventSource' in window)).toBe(false);
    await expect.poll(() => polls.length, POLL).toBeGreaterThan(2);
    const gaps = polls.slice(1).map((t, i) => t - polls[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(1_500);
    // Paused by ORBES: said under the header, the seal not offered, its time standing still; then resumed.
    await srv.ctx.services.live.pause(r.id, f.admin);
    await textOf(page.locator('.live__notice .live__paused'), `PAUSED ${LIVE.pausedLine}`);
    expect(await page.locator('.live-hold').getAttribute('aria-disabled')).toBe('true');
    const frozen = await page.locator('.live__turn-left').innerText();
    await sleep(2_500);
    expect(await page.locator('.live__turn-left').innerText()).toBe(frozen);
    await keepsVault(page, null);
    await srv.ctx.services.live.resume(r.id, f.admin);
    await expect.poll(() => page.locator('.live__notice .live__paused').count(), POLL).toBe(0);
    expect(await page.locator('.live-hold').getAttribute('aria-disabled')).toBe('false');
    await page.locator('.live-hold').focus();
    await page.keyboard.down(' ');
    await sleep(2_100);
    await page.keyboard.up(' ');
    await textOf(page.locator('.live__secured > .live__overline').first(), 'SECURED');
    expect(await page.locator('.live__secured').getAttribute('class')).not.toMatch(/is-revealing/);
    // Paused with the piece held: the time to confirm stands still across the polls (each moves the deadline by the
    // pause so far), then runs again.
    await srv.ctx.services.live.pause(r.id, f.admin);
    await textOf(page.locator('.live__notice .live__paused'), `PAUSED ${LIVE.pausedLine}`);
    const held = await page.locator('.live__deadline-time').innerText();
    await sleep(4_500);
    expect(await page.locator('.live__deadline-time').innerText()).toBe(held);
    await srv.ctx.services.live.resume(r.id, f.admin);
    await expect.poll(() => page.locator('.live__notice .live__paused').count(), POLL).toBe(0);
    await expect.poll(() => page.locator('.live__deadline-time').innerText(), POLL).not.toBe(held);
    // RELEASE MY PLACE: the first tap asks again, the second gives the piece back.
    await page.getByRole('button', { name: 'RELEASE MY PLACE' }).click();
    await visible(page.getByRole('button', { name: LIVE.releaseConfirm }));
    expect((await statusOf(r.id, me.id))?.status).toBe('SECURED');
    await page.getByRole('button', { name: LIVE.releaseConfirm }).click();
    await textOf(page.locator('h1'), LIVE.edge.released.title);
    await textOf(page.locator('.live__edge .live__note'), LIVE.edge.released.text);
    await keepsVault(page, null, ['THE RELEASES']);
    expect(await page.locator('.live__foot .live__releases').count()).toBe(0);
    expect((await statusOf(r.id, me.id))?.status).toBe('RELEASED');
    expect(problems).toEqual([]);
  }, 120_000);

  it('follows its stream from the line through a sell-out to SOLD OUT: the entry ENDED read before the room over, no state read again', async () => {
    const r = await release({ opensAt: new Date(Date.now() + 3_000), sizes: [{ label: '52', stock: 1 }], turnSeconds: 60 });
    const buyer = await account(5);
    await srv.ctx.services.live.enter(buyer.id, r.id, { sizeId: r.sizes[0]!.id }, buyer.actor);
    await expect.poll(async () => (await statusOf(r.id, buyer.id))?.status, POLL).toBe('TURN');
    // In the line behind the one piece, held in the buyer's turn.
    const me = await account(1);
    await srv.ctx.services.live.enter(me.id, r.id, { sizeId: r.sizes[0]!.id }, me.actor);
    const { page, problems } = await phone(me.token);
    const reads: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === `/api/v1/live/${r.id}/state`) reads.push(req.url());
    });
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(page.locator('.live__place-figure'), '2');
    await textOf(page.locator('.live__held'), '1 HELD PIECE MAY RETURN');
    const before = reads.length;
    // The buyer confirms the last piece: SOLD OUT, the line ENDED in the same transaction; the stream's last chunk
    // brings the entry first, then the room over.
    await secureAs(r.id, buyer, true);
    await textOf(page.locator('h1'), LIVE.edge.ended.SOLD_OUT.title);
    await textOf(page.locator('.live__edge .live__note').first(), LIVE.edge.ended.SOLD_OUT.text);
    expect(await page.getByRole('button', { name: LIVE.edge.soldOut.leave }).count()).toBe(0);
    expect((await statusOf(r.id, me.id))?.status).toBe('ENDED');
    await sleep(2_500);
    expect(reads.length).toBe(before);
    expect(problems).toEqual([]);
  }, 60_000);

  it('says every edge page plainly, each with one action: not signed in, not eligible, turn passed, hold ended, left, removed, sold out in your size, ended; past its end, its final state', async () => {
    const r = await release({ opensAt: new Date(Date.now() + 3_000), minTier: 1, sizes: [{ label: '50', stock: 5 }, { label: '52', stock: 1 }], turnSeconds: 60 });
    const ended = await release({ opensAt: new Date(Date.now() + 3_000), sizes: [{ label: '50', stock: 1 }], turnSeconds: 300 });
    await sleep(3_500);
    const [s50, s52] = r.sizes;
    const enter = async (dropId: string, sizeId: string, pieces = 1) => {
      const a = await account(pieces);
      await srv.ctx.services.live.enter(a.id, dropId, { sizeId }, a.actor);
      return a;
    };
    const entryOf = async (dropId: string, accountId: string) => (await srv.ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirstOrThrow()).id;

    const left = await enter(r.id, s50!.id);
    await expect.poll(async () => (await statusOf(r.id, left.id))?.status, POLL).toBe('TURN');
    await srv.ctx.services.live.leave(left.id, r.id, left.actor);
    const removed = await enter(r.id, s50!.id);
    await srv.ctx.services.live.remove(r.id, await entryOf(r.id, removed.id), f.admin);
    const missed = await enter(r.id, s50!.id);
    await expect.poll(async () => (await statusOf(r.id, missed.id))?.status, POLL).toBe('TURN');
    // Its turn's deadline brought to a moment after it began (long past): the engine marks it missed.
    await srv.ctx.db.updateTable('live_entries').set({ turn_expires_at: sql<Date>`turn_at + interval '1 millisecond'` }).where('drop_id', '=', r.id).where('account_id', '=', missed.id).execute();
    await expect.poll(async () => (await statusOf(r.id, missed.id))?.status, POLL).toBe('MISSED');
    const expired = await enter(r.id, s50!.id);
    await secureAs(r.id, expired, false);
    await srv.ctx.services.live.freeHold(r.id, await entryOf(r.id, expired.id), f.admin);
    // Sold out in size 52: its one piece confirmed by another collector, after this one joined the line behind.
    const buyer = await enter(r.id, s52!.id);
    await expect.poll(async () => (await statusOf(r.id, buyer.id))?.status, POLL).toBe('TURN');
    const late = await enter(r.id, s52!.id);
    await secureAs(r.id, buyer, true);
    // The release closed at its time before a turn came, the first collector's turn still running to its deadline (the
    // page whole, its phase ENDED): the one waiting reads that it has closed; a collector without an entry its final
    // state (plan LIVE RELEASE+, decision 30).
    const first = await enter(ended.id, ended.sizes[0]!.id);
    await expect.poll(async () => (await statusOf(ended.id, first.id))?.status, POLL).toBe('TURN');
    const waiting = await enter(ended.id, ended.sizes[0]!.id);
    await srv.ctx.db.updateTable('drops').set({ closes_at: new Date() }).where('id', '=', ended.id).execute();
    await expect.poll(async () => (await statusOf(ended.id, waiting.id))?.status, POLL).toBe('ENDED');
    expect((await statusOf(ended.id, first.id))?.status).toBe('TURN');
    const outsider = await account(0);
    const nobody = await account(1);

    const cases: { name: string; token: string | null; dropId: string; title: string; text?: string; action: string | null; controls?: string[] }[] = [
      { name: 'signed-out', token: null, dropId: r.id, title: LIVE.edge.signIn.title, action: null, controls: ['SIGN IN', 'CREATE ACCOUNT'] },
      { name: 'not-eligible', token: outsider.token, dropId: r.id, title: 'FOR OWNERS', text: `This release is for owners. ${LIVE.edge.notEligible.text}`, action: null, controls: ['THE RELEASES'] },
      { name: 'left', token: left.token, dropId: r.id, title: LIVE.edge.left.title, text: LIVE.edge.left.text, action: null, controls: ['THE RELEASES'] },
      { name: 'removed', token: removed.token, dropId: r.id, title: LIVE.edge.removed.title, text: LIVE.edge.removed.text, action: null, controls: ['THE RELEASES'] },
      { name: 'missed', token: missed.token, dropId: r.id, title: LIVE.edge.missed.title, text: LIVE.edge.missed.text, action: null, controls: ['THE RELEASES'] },
      { name: 'expired', token: expired.token, dropId: r.id, title: LIVE.edge.expired.title, text: LIVE.edge.expired.text, action: null, controls: ['THE RELEASES'] },
      { name: 'sold-out', token: late.token, dropId: r.id, title: LIVE.edge.soldOut.title('52'), text: LIVE.edge.soldOut.none, action: null, controls: [LIVE.edge.soldOut.leave] },
      { name: 'ended', token: waiting.token, dropId: ended.id, title: LIVE.edge.ended.CLOSED.title, text: LIVE.edge.ended.CLOSED.text, action: null, controls: ['THE RELEASES'] },
      { name: 'past', token: nobody.token, dropId: ended.id, title: 'MONOLITHE', action: null, controls: ['THE RELEASES'] },
    ];
    for (const c of cases) {
      const { page, context, problems } = await phone(c.token);
      await page.goto(`${srv.origin}/verify/releases/${c.dropId}`);
      await textOf(page.locator('h1'), c.title);
      if (c.text) await textOf(page.locator('.live__edge .live__note').first(), c.text);
      expect(await page.locator('.view--live').evaluate((el) => el.classList.contains('vault')), c.name).toBe(true);
      await keepsVault(page, c.action, c.controls);
      // One action: a hairline button (or the sign-in's form, its button NOCTURNE's, hairline in the vault), never two.
      expect(await page.locator('.live__edge .btn:visible, .live__past .btn:visible, .live__edge .n-btn:visible').count(), c.name).toBe(1);
      if (c.name === 'past') await textOf(page.locator('.live__past-status'), RELEASES.over);
      await page.screenshot({ path: join(OUT_DIR, `verify-live-edge-${c.name}.png`), fullPage: true });
      expect(problems, c.name).toEqual([]);
      await context.close();
    }

    // The entry's end read before the room's reason (the room and the entries are read apart): the page follows the room
    // until it says why, and its words follow it.
    const { page, context, problems } = await phone(waiting.token);
    let behind = 0;
    await page.route(
      (u) => u.pathname === `/api/v1/live/${ended.id}/state`,
      async (route) => {
        if (behind++ > 0) return route.continue();
        const response = await route.fetch();
        const state = (await response.json()) as { room: Record<string, unknown> };
        await route.fulfill({ response, json: { ...state, room: { ...state.room, phase: 'LIVE', over: false, endedReason: null } } });
      },
    );
    await page.goto(`${srv.origin}/verify/releases/${ended.id}`);
    await textOf(page.locator('h1'), LIVE.edge.ended.CLOSED.title);
    await textOf(page.locator('.live__edge .live__note').first(), LIVE.edge.ended.CLOSED.text);
    expect(behind).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await context.close();
  }, 180_000);

  it('a collector entered on another phone, back in the room: a tap or a key there makes the ten ticks heard; untouched, the room keeps silent', async () => {
    const t0 = new Date(Date.now() + 25_000);
    const r = await release({ opensAt: t0, minTier: 1, sizes: [{ label: '50', stock: 2 }] });
    const me = await account(1);
    await srv.ctx.services.live.enter(me.id, r.id, { sizeId: r.sizes[0]!.id }, me.actor);
    const quiet = await phone(me.token);
    const back = await phone(me.token);
    for (const p of [quiet, back]) {
      await p.page.goto(`${srv.origin}/verify/releases/${r.id}`);
      await visible(p.page.getByText(LIVE.youreReady));
    }
    // A tap on the room's title, nothing that acts: the gesture alone.
    await back.page.locator('.live__room > h1').click();
    for (const p of [quiet, back]) await expect.poll(() => p.page.locator('.live-door').getAttribute('class'), { timeout: 45_000, interval: 100 }).toMatch(/is-open/);
    expect((await live(back.page)).tones.filter((t) => t === 1318.51)).toHaveLength(10);
    expect((await live(quiet.page)).tones).toEqual([]);
    for (const p of [quiet, back]) {
      expect(p.problems).toEqual([]);
      await p.context.close();
    }
  }, 120_000);

  it('while the room reads who you are: the monogram breathing above ONE MOMENT… (addition 14, C40), then the room', async () => {
    const r = await release({ opensAt: new Date(Date.now() + 120_000) });
    const me = await account(1);
    const { page, context, problems } = await phone(me.token);
    // The account's standing held back: the page knows the room is open, not yet who is in it.
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    const state = (u: URL) => u.pathname === `/api/v1/live/${r.id}/state`;
    await page.route(state, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    const loading = page.locator('.live__waiting .n-loading');
    await visible(loading);
    expect(await loading.locator('svg.n-breath').count()).toBe(1);
    expect(await loading.locator('svg.n-breath').getAttribute('aria-hidden')).toBe('true');
    await textOf(loading.locator('.n-loading__text'), LIVE.loading);
    expect(await loading.locator('.n-loading__text').getAttribute('role')).toBe('status');
    expect(await loading.locator('[aria-busy]').count()).toBe(0);
    expect(await page.locator('#live-title').innerText()).toBe(LIVE.kind);
    // The same piece as every page's loading: 40 px, ivory, ONE MOMENT… 16 px under it.
    const box = await loading.locator('svg.n-breath').boundingBox();
    expect([box?.width, box?.height]).toEqual([40, 40]);
    expect(await loading.locator('.n-loading__text').evaluate((el) => getComputedStyle(el).color)).toBe(IVORY);
    // Answered (this read and the ones after it pass through).
    answer();
    await textOf(page.locator('.live__room > .live__overline'), 'THE ROOM IS OPEN');
    expect(await page.locator('.n-loading').count()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);

  it('the LIVE RELEASES refused (429): THE RELEASES keeps the draws and says the LIVE half missing; a draw\'s address shows its draw; a LIVE one its failure, then TRY AGAIN', async () => {
    const r = await release({ opensAt: new Date(Date.now() + 2 * 86_400_000) });
    const draw = await f.drops.create({ modelId: f.modelId, title: 'MONOLITHE — release II', quantity: 2, opensAt: new Date(Date.now() - 3_600_000), closesAt: new Date(Date.now() + 86_400_000), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(draw.id, f.admin);
    const { page, context, problems } = await phone(null);
    // The rate group of the LIVE RELEASES refuses this phone: their list and every release's page.
    const refused = (u: URL) => u.pathname === '/api/v1/live' || /^\/api\/v1\/live\/[0-9a-f-]{36}$/.test(u.pathname);
    await page.route(refused, (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again in a moment.' } }) }),
    );

    await page.goto(`${srv.origin}/verify/releases`);
    const card = page.locator('article.release-card', { hasText: 'MONOLITHE — RELEASE II' });
    await visible(card);
    await textOf(page.locator('.releases__partial .form__error'), RELEASES.liveFailed);
    expect(await page.locator('article.live-card').count()).toBe(0);

    // A draw's address: its draw, read when the LIVE page cannot be.
    await page.goto(`${srv.origin}/verify/releases/${draw.id}`);
    await textOf(page.locator('h1'), 'MONOLITHE — RELEASE II');
    expect(await page.locator('.view--live').count()).toBe(0);

    // A LIVE RELEASE's address: no draw by that id either, so its failure, said in the vault; TRY AGAIN reads it again.
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(page.locator('.live__edge .form__error'), /^The release could not be shown just now\. Too many attempts\./);
    await page.unroute(refused);
    await page.getByRole('button', { name: 'TRY AGAIN' }).click();
    await textOf(page.locator('h1'), 'MONOLITHE');
    await textOf(page.locator('.live__screen > .live__overline').first(), 'LIVE RELEASE');

    // THE RELEASES again, answered: the LIVE half back, TRY AGAIN gone.
    await page.goto(`${srv.origin}/verify/releases`);
    await visible(page.locator('article.live-card').filter({ has: page.locator(`#release-${r.id}-title`) }));
    expect(await page.locator('.releases__partial').count()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);
});
