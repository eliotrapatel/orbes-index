/**
 * End-to-end: the after-room of a LIVE RELEASE (plan LIVE RELEASE+, choice 2 and decision 28) in the built verification
 * app, served by the real server with the live engine ticking (in-memory database, the real clock), driven in Chromium
 * at a phone viewport.
 *
 *  - A collector still in the line when the last piece is secured reads SOLD OUT; the after-room's delay later, in the
 *    same vault, the second door: THE AFTER-ROOM · A SECOND DOOR, the door and its lock, when it closes, ENTER THE
 *    AFTER-ROOM (said aloud as it appears).
 *  - Its page, read through the release: THE AFTER-ROOM over it, its own model and price, its size, the place kept from
 *    the line; the turn and the seal held, the add-on, PAY · total; CONFIRMED in ivory, THE AFTER-ROOM · its model; its
 *    order at the after-room's price; MY PIECES lists it as THE AFTER-ROOM, its link through the release.
 *  - Nobody else: another collector, and a visitor, at its address are shown the release's own page instead, its address
 *    put back; the door never shows to the collector who secured the release's last piece.
 *
 * On every vault screen: the text's contrast on its ground (at least 4.5 : 1), at most one primary action, no figure in
 * the display face, the floors of BRAND-DESIGN-SYSTEM §3.8. Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLiveEngine } from '../../src/server/context.js';
import type { LiveEngine } from '../../src/server/services/live-engine.js';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { createManualClock } from '../../src/server/types.js';
import { LIVE, RELEASES } from '../../src/web/verify/copy.js';
import { createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { keepsVault, screenChecks } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const IVORY = 'rgb(246, 242, 234)';

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

describe.skipIf(!HAS_CHROMIUM)('the after-room of a LIVE RELEASE in /verify (Chromium, phone)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let engine: LiveEngine;
  let f: LiveFixture;
  let n = 0;

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    f = await liveFixtureOn(srv.ctx, createManualClock(new Date()));
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
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email: `after.e2e.${++n}@example.com`, password: PASSWORD }, {});
    if (pieces > 0) await holdPieces(srv.ctx.db, a.id, pieces, f.modelId);
    return { id: a.id, token: session.token, actor: { type: 'account' as const, id: a.id } };
  }

  /** A phone, signed in as `token` when given (its session cookie, as the sign-in sets it). */
  async function phone(token: string | null): Promise<Watched> {
    const context = await mobileContext(browser, {});
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

  const statusOf = async (dropId: string, accountId: string) =>
    (await srv.ctx.db.selectFrom('live_entries').select('status').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst())?.status ?? null;

  it('SOLD OUT, then the second door its delay later, for those still in the line; the after-room in the same vault: their place, the turn, the add-on, PAY, CONFIRMED; nobody else sees it', async () => {
    const afterModel = await createModel(srv.ctx.db, 'AFTERGLOW');
    // The release and its after-room set in the console, the room still to open; then brought to the next seconds.
    const r = await createLiveRelease(f, {
      opensAt: new Date(Date.now() + 3_600_000),
      priceMinor: 505_000,
      quantityLine: '1 PIECE',
      sizes: [{ label: '52', stock: 1 }],
      afterRoom: { modelId: afterModel, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }], addons: [{ label: 'GIFT BOX', line: 'Wrapped by hand', priceMinor: 5_000 }], delayMinutes: 1, lengthMinutes: 15 },
    });
    const child = r.afterRoom!.id;
    await srv.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    await srv.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE · THE AFTER-ROOM' }).where('id', '=', child).execute();
    const t0 = Date.now() + 2_000;
    await srv.ctx.db.updateTable('drops').set({ opens_at: new Date(t0), closes_at: new Date(t0 + 3_600_000) }).where('id', '=', r.id).execute();
    // A PALLADIUM collector ahead in the line; the collector behind; another who never came.
    const rival = await account(5);
    const me = await account(0);
    const stranger = await account(5);
    for (const a of [rival, me]) await srv.ctx.services.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    await expect.poll(async () => statusOf(r.id, rival.id), POLL).toBe('TURN');

    // The collector's phone on the release's page: in the line, behind the rival's turn.
    const { page, problems } = await phone(me.token);
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(page.locator('.live__place-figure'), '2');

    const reads: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === `/api/v1/live/${r.id}/state`) reads.push(req.url());
    });
    // The rival holds the seal and pays: the last piece, SOLD OUT. The after-room opens a minute after (its delay, the
    // least there is).
    const token = (await srv.ctx.services.liveRoom.viewerEntries(r.id, [rival.id])).get(rival.id)!.turn!.token!;
    await srv.ctx.services.live.press(rival.id, r.id, token);
    await sleep(1_500);
    await srv.ctx.services.live.secure(rival.id, r.id, token, rival.actor);
    await srv.ctx.services.live.confirm(rival.id, r.id, rival.actor);
    const opensAt = (await srv.ctx.db.selectFrom('drops').select('opens_at').where('id', '=', child).executeTakeFirstOrThrow()).opens_at.getTime();
    expect(opensAt - Date.now()).toBeGreaterThan(55_000);
    expect(await srv.ctx.db.selectFrom('after_room_guests').select('position').where('drop_id', '=', child).execute()).toEqual([{ position: 1 }]);

    // SOLD OUT: the release's end, nothing of a second door yet.
    await textOf(page.locator('.n-live__end .n-live__outcome'), 'SOLD OUT');
    expect(await page.locator('.live__after').count()).toBe(0);
    await keepsVault(page, null, ['THE RELEASES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-after-room-sold-out.png'), fullPage: true });

    // The second door, at its time, in the same vault, said aloud: its time came with the collector's own entry, in the
    // stream's last event; the page asks nothing more of the server (a sell-out sends no wave of reads).
    await visible(page.locator('.live__after'), 75_000);
    expect(Date.now()).toBeGreaterThanOrEqual(opensAt - 1_000);
    expect(reads).toEqual([]);
    await textOf(page.locator('.live__after > .live__overline'), 'THE AFTER-ROOM');
    await textOf(page.locator('.live__after > h1'), 'A SECOND DOOR');
    await textOf(page.locator('.live__after-text'), LIVE.afterRoom.text);
    await textOf(page.locator('.live__after-until'), /^OPEN UNTIL \d{2}:\d{2}$/);
    expect(await page.locator('.live-door--after').getAttribute('aria-hidden')).toBe('true');
    expect(await page.locator('.live-door--after .live-seal__ring').count()).toBe(13);
    await expect.poll(() => page.locator('[role="status"][aria-live="polite"]').innerText()).toBe(LIVE.afterRoom.announce);
    expect(await page.locator('.view--live').evaluate((el) => el.classList.contains('vault'))).toBe(true);
    await keepsVault(page, 'ENTER THE AFTER-ROOM', ['ENTER THE AFTER-ROOM', 'THE RELEASES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-after-room-door.png'), fullPage: true });

    // Its page, read through the release: its model, its one size, the place kept from the line.
    await page.getByRole('button', { name: 'ENTER THE AFTER-ROOM' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/verify/releases/${r.id}/after-room`);
    await textOf(page.locator('.live__join > .live__overline'), 'THE AFTER-ROOM');
    await textOf(page.locator('.live__join > h1'), 'AFTERGLOW');
    // Its price, read here first (the door says neither the model nor the price).
    await textOf(page.locator('.live__join > .live__offer'), '€ 900 · 1 PIECE');
    await textOf(page.locator('.live__join-line'), LIVE.afterRoom.joinLine);
    expect(await page.locator('.live__size').getAttribute('aria-pressed')).toBe('true');
    await keepsVault(page, 'ENTER THE LINE', ['ONE SIZE', 'ENTER THE LINE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-after-room-join.png'), fullPage: true });
    await page.getByRole('button', { name: 'ENTER THE LINE' }).click();

    // Its turn at once (its one piece, the first place): the seal held, the reveal, the add-on, PAY.
    await textOf(page.locator('.live__turn > .live__overline'), 'YOUR TURN');
    expect(await srv.ctx.db.selectFrom('live_entries').select('position').where('drop_id', '=', child).where('account_id', '=', me.id).executeTakeFirstOrThrow()).toEqual({ position: 1 });
    await keepsVault(page, null, ['THE RELEASES']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-after-room-turn.png'), fullPage: true });
    const seal = page.locator('.live-hold');
    const box = (await seal.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(2_100);
    await page.mouse.up();
    await textOf(page.locator('.live__secured > .live__overline').first(), 'SECURED');
    const pay = page.locator('.live__pay');
    await textOf(pay, 'PAY · € 900');
    await page.getByRole('button', { name: /GIFT BOX/ }).click();
    await textOf(pay, 'PAY · € 950');
    await keepsVault(page, 'PAY · € 950', ['GIFT BOX + € 50', 'PAY · € 950', 'RELEASE MY PLACE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-after-room-secured.png'), fullPage: true });
    await pay.click();

    // CONFIRMED, out into the light: the after-room's piece; its order at its price.
    await textOf(page.locator('h1'), 'CONFIRMED');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(IVORY);
    await textOf(page.locator('.live__confirmed-of'), 'THE AFTER-ROOM · AFTERGLOW');
    await textOf(page.locator('.live__receipt .rows__row', { hasText: 'TOTAL' }), 'TOTAL € 950');
    const light = await screenChecks(page);
    expect([light.contrast, light.figures]).toEqual([[], []]);
    expect((await tapZoneFloors(page)).problems).toEqual([]);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(OUT_DIR, 'verify-after-room-confirmed.png'), fullPage: true });
    expect(await statusOf(child, me.id)).toBe('CONFIRMED');
    expect(await srv.ctx.db.selectFrom('orders').select(['drop_id', 'price_minor', 'model_id']).where('account_id', '=', me.id).execute()).toEqual([
      { drop_id: child, price_minor: 90_000, model_id: afterModel },
    ]);

    // MY PIECES: the after-room's entry, its link through the release it follows; the release's own, ended.
    await page.getByRole('link', { name: 'MY PIECES' }).click();
    // Its tab RELEASES (C31).
    await page.getByRole('tab', { name: /^RELEASES/ }).click();
    const entry = page.locator('.pieces__entry-card', { hasText: 'THE AFTER-ROOM · CONFIRMED' });
    await visible(entry);
    expect(await entry.getByRole('link', { name: 'MONOLITHE — LIVE · THE AFTER-ROOM' }).getAttribute('href')).toBe(`/verify/releases/${r.id}/after-room`);
    await textOf(page.locator('.pieces__entry-card', { hasText: 'LIVE RELEASE · ENDED' }).locator('.pieces__entry-sentence'), LIVE.sentence.ENDED);
    await entry.getByRole('link', { name: 'MONOLITHE — LIVE · THE AFTER-ROOM' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/verify/releases/${r.id}/after-room`);
    await textOf(page.locator('h1'), 'CONFIRMED');
    expect(problems).toEqual([]);

    // Nobody else: another collector, and a visitor, at its address read the release's own page in its final state (plan
    // LIVE RELEASE+, decision 30), its address put back; the rival who secured the release's last piece reads it too, its
    // part said, and never sees a door.
    for (const who of [stranger.token, null, rival.token]) {
      const other = await phone(who);
      await other.page.goto(`${srv.origin}/verify/releases/${r.id}/after-room`);
      await expect.poll(() => new URL(other.page.url()).pathname, POLL).toBe(`/verify/releases/${r.id}`);
      await textOf(other.page.locator('h1'), 'MONOLITHE');
      await textOf(other.page.locator('.live__past-status'), RELEASES.over);
      if (who === rival.token) await textOf(other.page.locator('.live__past-part'), RELEASES.past.secured);
      await sleep(500);
      expect(await other.page.locator('.live__after').count()).toBe(0);
      expect(other.problems).toEqual([]);
      await other.context.close();
    }
  }, 300_000);
});
