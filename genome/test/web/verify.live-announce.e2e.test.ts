/**
 * End-to-end: a LIVE RELEASE announced (plan of 2026-10-04, The experience 1 and 11, the banner; Quality bar items 3 and
 * 4), served by the real server with the live engine ticking (in-memory database, the real clock), driven in Chromium.
 *
 *  - THE RELEASES as the release calendar: a release's card says the reveals still to come and their times, then each
 *    stage at its own (the silhouette, the name, the photograph), never before it, the page reading the releases again
 *    then; N COLLECTORS WILL BE THERE; a release leaves the list at its end, and within a minute when sold out before it.
 *  - The release's page announced: THE REVEALS; I'LL BE THERE with a size, its public count following, another size
 *    changing it, WITHDRAW; read again, the size said; signed out, the sign-in under it; outside the rule, the rule and
 *    why.
 *  - The banner on /verify and MY PIECES, an ink strip: LIVE RELEASE · OPENS IN hh:mm:ss, the name once revealed, THE
 *    ROOM IS OPEN, LIVE NOW, hidden at the end; it opens the release's page.
 *  - The boutique board by its secret link only (landscape): the countdown, the door, the pieces left overall, live; the
 *    secret never in an address; never indexed; no person, no count of the room, no host message, no size; the door
 *    open at T0; SOLD OUT said at the end; without its secret, with a wrong one, or once revoked: not available.
 *
 * On every vault screen: the text's contrast computed from the page's own colours, at most one primary action, no
 * figure in the display face, the floors of BRAND-DESIGN-SYSTEM §3.8 (vault-checks.ts). Skipped when Chromium is absent.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLiveEngine } from '../../src/server/context.js';
import type { LiveEngine } from '../../src/server/services/live-engine.js';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { createManualClock, SYSTEM_ACTOR } from '../../src/server/types.js';
import { BANNER_REFRESH_MS } from '../../src/web/verify/views/live-banner.js';
import { jpegPhoto } from '../support/images.js';
import { createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture, type LiveRelease, type LiveReleaseOptions } from '../support/live.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { keepsVault } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const INK = 'rgb(10, 10, 10)';
const SECOND = 1000;

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function textOf(loc: Locator, expected: string | RegExp, timeout = POLL.timeout): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), { ...POLL, timeout }).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), { ...POLL, timeout }).toMatch(expected);
}
const visible = (loc: Locator, timeout = POLL.timeout) => loc.waitFor({ state: 'visible', timeout });

/** Until `at` (ms, the server's clock is this machine's), `hidden` keeps holding, checked every 150 ms: never before its time. */
async function holdsUntil(at: number, hidden: () => Promise<void>): Promise<void> {
  while (Date.now() < at - 250) {
    await hidden();
    await sleep(150);
  }
}

interface Watched {
  page: Page;
  context: BrowserContext;
  problems: string[];
  /** Every address the page asked for. */
  urls: string[];
}

describe.skipIf(!HAS_CHROMIUM)('a LIVE RELEASE announced: the calendar, I’LL BE THERE, the banner, the boutique board (Chromium)', () => {
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
    const email = `live.announce.${++n}@example.com`;
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    if (pieces > 0) await holdPieces(srv.ctx.db, a.id, pieces, f.modelId);
    return { id: a.id, email, token: session.token, actor: { type: 'account' as const, id: a.id } };
  }

  async function release(o: Partial<LiveReleaseOptions> & { opensAt: Date }): Promise<LiveRelease> {
    const r = await createLiveRelease(f, { priceMinor: 505_000, ...o });
    await srv.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    return r;
  }

  /** Every LIVE RELEASE still current cancelled: the list, the banner and the boards then show only a test's own. */
  const clear = () => srv.ctx.db.updateTable('drops').set({ cancelled_at: new Date() }).where('mode', '=', 'LIVE').where('cancelled_at', 'is', null).where('ended_at', 'is', null).execute();

  async function watch(context: BrowserContext, token: string | null): Promise<Watched> {
    if (token) await context.addCookies([{ name: sessionCookieName(srv.ctx.config, 'account'), value: token, url: srv.origin }]);
    const page = await context.newPage();
    const problems: string[] = [];
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`);
      if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    return { page, context, problems, urls };
  }

  /** A phone, signed in as `token` when given. */
  const phone = async (token: string | null) => watch(await mobileContext(browser), token);

  /** A boutique's screen: landscape, no touch. */
  const screen = async () =>
    watch(await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'no-preference' }), null);

  const interestOf = async (dropId: string, accountId: string) =>
    (await srv.ctx.db.selectFrom('live_interest as i').innerJoin('drop_sizes as s', 's.id', 'i.size_id').select('s.label').where('i.drop_id', '=', dropId).where('i.account_id', '=', accountId).executeTakeFirst())?.label ?? null;

  it('THE RELEASES as the release calendar: the reveals to come, each stage at its time and never before, the count; a release leaves it at its end', async () => {
    await clear();
    const t = Date.now();
    // A model of its own, its photograph ORBES's; a silhouette uploaded for the release.
    const nocturne = await createModel(srv.ctx.db, 'NOCTURNE');
    const photo = jpegPhoto(520, 520);
    const photoSha = createHash('sha256').update(photo).digest('hex');
    await srv.ctx.services.media.setModelImage(nocturne, { mime: 'image/jpeg', bytes: photo }, SYSTEM_ACTOR);
    const shadow = jpegPhoto(40, 40);
    const shadowSha = createHash('sha256').update(shadow).digest('hex');
    await srv.ctx.db.insertInto('media_objects').values({ sha256: shadowSha, mime: 'image/jpeg', bytes: shadow, width: 40, height: 40 }).execute();
    const [silhouetteAt, nameAt, photoAt] = [t + 8 * SECOND, t + 14 * SECOND, t + 20 * SECOND];
    const r = await release({ modelId: nocturne, opensAt: new Date(t + 85 * SECOND), roomOpensMinutes: 1 });
    await srv.ctx.db
      .updateTable('drops')
      .set({ title: 'NOCTURNE — LIVE', silhouette_sha256: shadowSha, silhouette_at: new Date(silhouetteAt), name_at: new Date(nameAt), photo_at: new Date(photoAt) })
      .where('id', '=', r.id)
      .execute();
    const fan = await account(1);
    await srv.ctx.services.live.setInterest(fan.id, r.id, r.sizes[0]!.id, fan.actor);
    // Another release, its room open: live at its T0, then over at its end.
    const ending = await release({ opensAt: new Date(t + 5 * SECOND), closesAt: new Date(t + 26 * SECOND), roomOpensMinutes: 1 });

    const { page, problems } = await phone(null);
    await page.goto(`${srv.origin}/verify/releases`);
    const card = page.locator('article.live-card').filter({ has: page.locator(`#release-${r.id}-title`) });
    const other = page.locator('article.live-card').filter({ has: page.locator(`#release-${ending.id}-title`) });
    await visible(card);
    // The stages to come, in order (those at the same minute said together on one line).
    const stages = async () => (await card.locator('.live-card__reveal-stage').allInnerTexts()).map(norm).join(' AND ');
    await textOf(card.locator('.live-card__title'), 'TO BE REVEALED');
    expect(await stages()).toBe('THE SILHOUETTE AND THE NAME AND THE PHOTOGRAPH');
    for (const when of await card.locator('.live-card__reveal-when').allInnerTexts()) expect(norm(when)).toMatch(/^[A-Z]+DAY \d{1,2} [A-Z]+ · \d{2}:\d{2} PARIS$/);
    await textOf(card.locator('.live-card__interest'), '1 COLLECTOR WILL BE THERE');
    await visible(card.locator('.live-card__seal'));
    await textOf(other.locator('.live-card__kind'), 'LIVE RELEASE · THE ROOM IS OPEN');
    await keepsVault(page, null, ['SEE THE RELEASE']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-calendar.png'), fullPage: true });

    // Nothing of a stage before its time: not on screen, not in the page.
    const hidden = (words: string[]) => async () => {
      const html = await page.content();
      for (const w of words) expect(html, w).not.toContain(w);
    };
    await holdsUntil(silhouetteAt, hidden(['NOCTURNE', shadowSha, photoSha]));
    await visible(card.locator('.live-card__img--silhouette'));
    expect(Date.now()).toBeGreaterThanOrEqual(silhouetteAt);
    expect(await card.locator('.live-card__img--silhouette').getAttribute('src')).toBe(`/api/v1/media/${shadowSha}`);
    expect(await stages()).toBe('THE NAME AND THE PHOTOGRAPH');
    // The release live now at its T0 (its card read again then).
    await textOf(other.locator('.live-card__kind'), 'LIVE RELEASE · LIVE NOW');

    await holdsUntil(nameAt, hidden(['NOCTURNE', photoSha]));
    await textOf(card.locator('.live-card__title'), 'NOCTURNE');
    expect(Date.now()).toBeGreaterThanOrEqual(nameAt);
    expect(await stages()).toBe('THE PHOTOGRAPH');

    await holdsUntil(photoAt, hidden([photoSha]));
    await visible(card.locator('.live-card__img--photo'));
    expect(Date.now()).toBeGreaterThanOrEqual(photoAt);
    await expect.poll(() => card.locator('.live-card__reveals').count()).toBe(0);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-calendar-revealed.png'), fullPage: true });

    // The end: the release leaves THE RELEASES (choice 32), the other stays.
    await holdsUntil(t + 26 * SECOND, async () => expect(await other.count()).toBe(1));
    await expect.poll(() => other.count(), POLL).toBe(0);
    expect(Date.now()).toBeGreaterThanOrEqual(t + 26 * SECOND);
    expect(await card.count()).toBe(1);
    expect(problems).toEqual([]);
  }, 90_000);

  it('THE RELEASES open while a release is live: sold out long before its end, it leaves the list within the minute the banner takes', async () => {
    await clear();
    const t = Date.now();
    const live = await release({ opensAt: new Date(t + 2 * SECOND), closesAt: new Date(t + 2 * 3_600_000), roomOpensMinutes: 1 });
    const { page, problems } = await phone(null);
    // This page's timers on a clock the test moves on (its time still flowing meanwhile).
    await page.clock.install();
    await page.goto(`${srv.origin}/verify/releases`);
    const card = page.locator('article.live-card').filter({ has: page.locator(`#release-${live.id}-title`) });
    await textOf(card.locator('.live-card__kind'), 'LIVE RELEASE · LIVE NOW');
    // Sold out at once: ended long before its time, its end two hours away.
    await srv.ctx.db.updateTable('drops').set({ ended_at: new Date(), ended_reason: 'SOLD_OUT' }).where('id', '=', live.id).execute();
    await page.clock.fastForward(BANNER_REFRESH_MS - 5 * SECOND);
    await sleep(500);
    expect(await card.count()).toBe(1);
    await page.clock.fastForward(10 * SECOND);
    await expect.poll(() => card.count(), POLL).toBe(0);
    expect(await page.locator('article.live-card').count()).toBe(0);
    expect(problems).toEqual([]);
  }, 60_000);

  it('the page announced: THE REVEALS; I’LL BE THERE with a size and its public count, changed, withdrawn; signed out the sign-in; outside the rule, the rule and why', async () => {
    await clear();
    const r = await release({ opensAt: new Date(Date.now() + 2 * 86_400_000), minTier: 1, sizes: [{ label: '50', stock: 2 }, { label: '52', stock: 2 }, { label: '54', stock: 1 }] });
    await srv.ctx.db.updateTable('drops').set({ photo_at: new Date(Date.now() + 86_400_000) }).where('id', '=', r.id).execute();
    const [s50, , s54] = r.sizes;
    const fan = await account(1);
    await srv.ctx.services.live.setInterest(fan.id, r.id, s50!.id, fan.actor);
    const me = await account(1);
    const { page, problems } = await phone(me.token);
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    const there = page.locator('.live__there');
    const size = (label: string) => there.locator('.live__size', { hasText: label });
    await textOf(page.locator('.live__reveals'), /^THE REVEALS THE PHOTOGRAPH [A-Z]+DAY \d{1,2} [A-Z]+ · \d{2}:\d{2} PARIS$/);
    await textOf(there.locator('.live__there-count'), '1 COLLECTOR WILL BE THERE');
    const action = there.getByRole('button', { name: 'I’LL BE THERE' });
    await visible(action);
    expect(await action.isDisabled()).toBe(true);
    expect(await there.locator('.live__qty').count()).toBe(0);
    await size('52').click();
    expect(await action.isDisabled()).toBe(false);
    await keepsVault(page, 'I’LL BE THERE', ['50', '52', '54', 'I’LL BE THERE', 'ADD TO CALENDAR']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-there.png'), fullPage: true });
    await action.click();
    await textOf(there.locator('.live__there-said'), 'YOU’LL BE THERE · SIZE 52');
    await textOf(there.locator('.live__there-count'), '2 COLLECTORS WILL BE THERE');
    expect(await interestOf(r.id, me.id)).toBe('52');
    // Said: the size chosen is the filled one; another size changes it; WITHDRAW takes it back.
    await keepsVault(page, '52', ['50', '52', '54', 'WITHDRAW']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-there-said.png'), fullPage: true });
    await size('54').click();
    await textOf(there.locator('.live__there-said'), 'YOU’LL BE THERE · SIZE 54');
    await expect.poll(() => interestOf(r.id, me.id), POLL).toBe('54');
    await textOf(there.locator('.live__there-count'), '2 COLLECTORS WILL BE THERE');
    await there.getByRole('button', { name: 'WITHDRAW' }).click();
    await visible(action);
    await textOf(there.locator('.live__there-count'), '1 COLLECTOR WILL BE THERE');
    await expect.poll(() => interestOf(r.id, me.id), POLL).toBeNull();
    // Said again, then read again: the size said, the count everyone's.
    await size('50').click();
    await action.click();
    await textOf(there.locator('.live__there-said'), 'YOU’LL BE THERE · SIZE 50');
    await page.reload();
    await textOf(page.locator('.live__there-said'), 'YOU’LL BE THERE · SIZE 50');
    await textOf(page.locator('.live__there-count'), '2 COLLECTORS WILL BE THERE');
    expect(await page.locator('.live__there .live__size', { hasText: '50' }).getAttribute('aria-pressed')).toBe('true');
    expect(problems).toEqual([]);

    // Signed out: the count, and I'LL BE THERE opens the sign-in under it; signed in, the size and the action.
    const late = await account(3);
    const anon = await phone(null);
    await anon.page.goto(`${srv.origin}/verify/releases/${r.id}`);
    const anonThere = anon.page.locator('.live__there');
    await textOf(anonThere.locator('.live__there-count'), '2 COLLECTORS WILL BE THERE');
    expect(await anonThere.locator('.live__size').count()).toBe(0);
    await anonThere.getByRole('button', { name: 'I’LL BE THERE' }).click();
    const panel = anonThere.locator('.live__there-panel');
    await visible(panel.getByLabel('EMAIL'));
    await keepsVault(anon.page, null);
    await anon.page.screenshot({ path: join(OUT_DIR, 'verify-live-there-signin.png'), fullPage: true });
    await panel.getByLabel('EMAIL').fill(late.email);
    await panel.getByLabel('PASSWORD').fill(PASSWORD);
    await panel.locator('form').getByRole('button', { name: 'SIGN IN' }).click();
    await visible(anonThere.locator('.live__size', { hasText: '54' }));
    await anonThere.locator('.live__size', { hasText: '54' }).click();
    await anonThere.getByRole('button', { name: 'I’LL BE THERE' }).click();
    await textOf(anonThere.locator('.live__there-said'), 'YOU’LL BE THERE · SIZE 54');
    expect(await interestOf(r.id, late.id)).toBe('54');
    expect(s54).toBeDefined();
    expect(anon.problems).toEqual([]);

    // Outside the rule: the rule, and why; no size, no action.
    const outsider = await account(0);
    const out = await phone(outsider.token);
    await out.page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(out.page.locator('.live__there-rule'), 'This release is for owners. Your ORBES account does not meet the rule of this release.');
    await textOf(out.page.locator('.live__there-count'), '3 COLLECTORS WILL BE THERE');
    expect(await out.page.locator('.live__there .live__size').count()).toBe(0);
    expect(await out.page.getByRole('button', { name: 'I’LL BE THERE' }).count()).toBe(0);
    await keepsVault(out.page, null);
    expect(await interestOf(r.id, outsider.id)).toBeNull();
    expect(out.problems).toEqual([]);
    for (const w of [page, anon.page, out.page]) await w.context().close();
  }, 90_000);

  it('the banner on /verify and MY PIECES: OPENS IN to T0, the name once revealed, THE ROOM IS OPEN, LIVE NOW, hidden at the end; it opens the release', async () => {
    await clear();
    const t = Date.now();
    const announced = await release({ opensAt: new Date(t + 2 * 3_600_000) });
    await srv.ctx.db.updateTable('drops').set({ name_at: new Date(t + 6 * SECOND) }).where('id', '=', announced.id).execute();
    const { page, problems } = await phone(null);
    await page.goto(`${srv.origin}/verify`);
    const banner = page.locator('a.live-banner');
    await visible(banner);
    await textOf(banner, /^LIVE RELEASE · OPENS IN 01:59:\d{2}$/);
    // The countdown on the server's clock, to T0.
    await expect.poll(async () => {
      const [hh, mm, ss] = norm(await banner.locator('.live-banner__clock').innerText()).split(':').map(Number);
      return Math.abs(hh! * 3600 + mm! * 60 + ss! - (t + 2 * 3_600_000 - Date.now()) / 1000);
    }, POLL).toBeLessThan(2);
    expect(await banner.getAttribute('href')).toBe(`/verify/releases/${announced.id}`);
    // The house style: an ink strip, one line, its tap zone and type above the floors, its text at AA on the ink.
    const look = await banner.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { bg: s.backgroundColor, color: s.color, height: r.height, width: r.width, top: r.top, font: s.fontSize, family: s.fontFamily };
    });
    expect(look).toMatchObject({ bg: INK, color: 'rgb(255, 255, 255)', top: 0, width: 390, font: '10px' });
    expect(look.height).toBeGreaterThanOrEqual(56);
    expect(look.family).toMatch(/^"?Gravesend Sans/);
    // Nothing drawn over it: the page's corner marks lie under the strip.
    const [strip, corners] = await page.evaluate(() => [getComputedStyle(document.querySelector('.live-banner-host')!).zIndex, getComputedStyle(document.querySelector('.corners')!).zIndex].map(Number));
    expect(strip).toBeGreaterThan(corners!);
    expect(await banner.locator('.live-banner__clock').evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/Gravesend/);
    // One line on one baseline: the countdown's figures on the labels' own, the line centred in the strip.
    const line = await banner.evaluate((el) => {
      const baseline = (node: Element) => {
        const probe = document.createElement('span');
        probe.style.display = 'inline-block';
        probe.style.height = '0';
        node.append(probe);
        const y = probe.getBoundingClientRect().bottom;
        probe.remove();
        return y;
      };
      const strip = el.getBoundingClientRect();
      const row = el.querySelector('.live-banner__line')!.getBoundingClientRect();
      return {
        lead: baseline(el.querySelector('.live-banner__lead')!),
        state: baseline(el.querySelector('.live-banner__state')!),
        clock: baseline(el.querySelector('.live-banner__clock')!),
        offCentre: Math.abs(row.top + row.height / 2 - (strip.top + strip.height / 2)),
      };
    });
    expect(Math.abs(line.clock - line.state)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(line.lead - line.state)).toBeLessThanOrEqual(0.5);
    expect(line.offCentre).toBeLessThanOrEqual(1);
    expect((await tapZoneFloors(page)).problems).toEqual([]);
    // Its name at its stage, never before.
    await holdsUntil(t + 6 * SECOND, async () => expect(await page.content()).not.toContain('MONOLITHE'));
    await textOf(banner, /^LIVE RELEASE · MONOLITHE · OPENS IN 01:59:\d{2}$/);
    expect(Date.now()).toBeGreaterThanOrEqual(t + 6 * SECOND);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-banner.png') });
    // It opens the release's page (and is gone from it); back, the landing and the banner again.
    await banner.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/verify/releases/${announced.id}`);
    await visible(page.locator('.live__announced'));
    expect(await page.locator('.live-banner-host').isHidden()).toBe(true);
    await page.goBack();
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/verify');
    await visible(banner);

    // The room open, then live, then over: on MY PIECES, then gone.
    await srv.ctx.db.updateTable('drops').set({ cancelled_at: new Date() }).where('id', '=', announced.id).execute();
    const u = Date.now();
    const soon = await release({ opensAt: new Date(u + 5 * SECOND), closesAt: new Date(u + 10 * SECOND), roomOpensMinutes: 1 });
    await page.goto(`${srv.origin}/verify/pieces`);
    await textOf(banner, 'LIVE RELEASE · MONOLITHE · THE ROOM IS OPEN');
    expect(await banner.getAttribute('href')).toBe(`/verify/releases/${soon.id}`);
    // MY PIECES makes room for it: its wordmark below the strip.
    const below = await page.evaluate(() => document.querySelector('.pieces__wordmark')!.getBoundingClientRect().top - document.querySelector('.live-banner')!.getBoundingClientRect().bottom);
    expect(below).toBeGreaterThanOrEqual(40);
    await sleep(1_200);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-banner-pieces.png') });
    await textOf(banner, 'LIVE RELEASE · MONOLITHE · LIVE NOW', 10_000);
    expect(Date.now()).toBeGreaterThanOrEqual(u + 5 * SECOND - 1_000);
    await holdsUntil(u + 10 * SECOND, async () => expect(await banner.isVisible()).toBe(true));
    await expect.poll(() => page.locator('.live-banner-host').isHidden(), POLL).toBe(true);
    expect(await page.evaluate(() => 'banner' in document.body.dataset)).toBe(false);
    // Read again, there is none.
    await page.reload();
    await visible(page.locator('.pieces__title'));
    await sleep(1_000);
    expect(await page.locator('.live-banner-host').isHidden()).toBe(true);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 90_000);

  it('the boutique board by its secret link only: landscape, the vault; the countdown, the door, the pieces left, live; the door at T0; SOLD OUT; revoked, not available', async () => {
    await clear();
    const t = Date.now();
    const t0 = t + 14 * SECOND;
    const r = await release({ opensAt: new Date(t0), roomOpensMinutes: 1, sizes: [{ label: 'K41', stock: 2 }], quantityLine: '2 PIECES' });
    const [a, b] = [await account(3), await account(1)];
    for (const x of [a, b]) await srv.ctx.services.live.enter(x.id, r.id, { sizeId: r.sizes[0]!.id }, x.actor);
    await srv.ctx.services.live.message(r.id, 'A word for the room only.', f.admin);
    const { token } = await f.live.issueBoardLink(r.id, f.admin);

    const { page, problems, urls } = await screen();
    const res = await page.goto(`${srv.origin}/verify/releases/${r.id}/board#${token}`);
    // Never indexed: the server says so, and the page.
    expect(res!.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
    await textOf(page.locator('.board__overline'), 'THE ROOM IS OPEN');
    await textOf(page.locator('.board__title'), 'MONOLITHE');
    await textOf(page.locator('.board__quantity'), '2 PIECES');
    await textOf(page.locator('.board__count-label'), 'UNTIL THE OPENING');
    await expect.poll(async () => (await page.locator('.board__countdown .live__unit-label').allInnerTexts()).map(norm)).toEqual(['HOURS', 'MINUTES', 'SECONDS']);
    await textOf(page.locator('.board__left-line'), '2 OF 2 LEFT');
    await textOf(page.locator('.board__status'), 'LIVE');
    expect(await page.locator('.board__door').getAttribute('class')).not.toMatch(/is-open/);
    expect(await page.locator('.board__door .live-door__seal .live-seal__ring').count()).toBe(13);
    // No person, no count of the room, no host message, no size, no stage name: nothing of them in the page.
    const html = await page.content();
    for (const word of [a.email, b.email, 'IN THE ROOM', 'A word for the room', 'FROM ORBES', 'K41', 'YOUR SIZE']) expect(html, word).not.toContain(word);
    // Its secret in no address it asked for (the fragment never leaves the page): it reads the board by POST.
    expect(urls.filter((u) => u.includes(token))).toEqual([]);
    expect(urls).toEqual(expect.arrayContaining([`${srv.origin}/verify/releases/${r.id}/board`, `${srv.origin}/api/v1/live/${r.id}/board`, `${srv.origin}/api/v1/live/${r.id}/board/stream`]));
    // Landscape: the door beside the release; the vault's checks, its one control FULL SCREEN.
    const [door, info] = await Promise.all([page.locator('.board__door').boundingBox(), page.locator('.board__info').boundingBox()]);
    expect(info!.x).toBeGreaterThan(door!.x + door!.width);
    // The ground of the vault (eased in from the page's).
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(INK);
    await keepsVault(page, null, ['FULL SCREEN']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-board.png') });

    // T0: the lock aligns, the door opens on the piece, LIVE NOW; the pieces left follow the line, live.
    await expect.poll(() => page.locator('.board__door').getAttribute('class'), { timeout: 20_000, interval: 50 }).toMatch(/is-aligned/);
    expect(Date.now()).toBeGreaterThanOrEqual(t0 - 1_000);
    await expect.poll(() => page.locator('.board__door').getAttribute('class')).toMatch(/is-open/);
    await textOf(page.locator('.board__overline'), 'LIVE NOW');
    expect(await page.locator('.board__count').isHidden()).toBe(true);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-board-open.png') });
    for (const x of [a, b]) await expect.poll(async () => (await srv.ctx.db.selectFrom('live_entries').select('status').where('drop_id', '=', r.id).where('account_id', '=', x.id).executeTakeFirst())?.status, POLL).toBe('TURN');
    const secure = async (x: typeof a) => {
      const views = await srv.ctx.services.liveRoom.viewerEntries(r.id, [x.id]);
      const turn = views.get(x.id)!.turn!.token!;
      await srv.ctx.services.live.press(x.id, r.id, turn);
      await sleep(1_500);
      await srv.ctx.services.live.secure(x.id, r.id, turn, x.actor);
      await srv.ctx.services.live.confirm(x.id, r.id, x.actor);
    };
    // Both pieces in a turn: none left now (as the room counts them), live on the board.
    await textOf(page.locator('.board__left-line'), '0 OF 2 LEFT');
    await textOf(page.locator('.board__overline'), 'LIVE NOW');
    await Promise.all([secure(a), secure(b)]);
    // Sold out: the end said, the last board kept on show.
    await textOf(page.locator('.board__overline'), 'SOLD OUT');
    await textOf(page.locator('.board__left-line'), '0 OF 2 LEFT');
    await expect.poll(() => page.locator('.board__status').isHidden(), POLL).toBe(true);
    await sleep(1_500);
    await textOf(page.locator('.board__overline'), 'SOLD OUT');
    await keepsVault(page, null, ['FULL SCREEN']);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-board-sold-out.png') });
    expect(problems).toEqual([]);

    // Another release's board: without its secret, with a wrong one, another release's: not available; revoked, it closes.
    const next = await release({ opensAt: new Date(Date.now() + 3 * 86_400_000) });
    const { token: nextToken } = await f.live.issueBoardLink(next.id, f.admin);
    const unavailable = async (address: string) => {
      await page.goto(address);
      await textOf(page.locator('.board__title'), 'THIS BOARD IS NOT AVAILABLE');
      expect(await page.locator('.board__door').count()).toBe(0);
      expect(await page.content()).not.toContain('MONOLITHE');
    };
    await unavailable(`${srv.origin}/verify/releases/${next.id}/board`);
    await unavailable(`${srv.origin}/verify/releases/${next.id}/board#${'A'.repeat(43)}`);
    await unavailable(`${srv.origin}/verify/releases/${next.id}/board#${token}`);
    await keepsVault(page, null);
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-board-unavailable.png') });
    await page.goto(`${srv.origin}/verify/releases/${next.id}/board#${nextToken}`);
    await textOf(page.locator('.board__overline'), 'LIVE RELEASE');
    await textOf(page.locator('.board__count-label'), 'OPENS IN');
    await expect.poll(async () => (await page.locator('.board__countdown .live__unit-label').allInnerTexts()).map(norm)).toEqual(['DAYS', 'HOURS', 'MINUTES']);
    await textOf(page.locator('.board__status'), 'LIVE');
    await f.live.revokeBoardLink(next.id, f.admin);
    await textOf(page.locator('.board__title'), 'THIS BOARD IS NOT AVAILABLE', 15_000);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);
});
