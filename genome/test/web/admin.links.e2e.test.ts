/**
 * The console's Links pages, end to end (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.10, steps 4.8 and 4.9): the production
 * web build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core), at a desk's 1 440 px and a phone's 390 px.
 *
 *  1. Empty: the line « No link yet… » with New link, then WITHOUT A LINK's lines and the TOTAL; under Clients after
 *     Segments in the sidebar.
 *  2. New link: the address suggested from the name (-2 when taken), the cost, the dialog's result with both addresses
 *     and Copy, the row under its channel; an address taken by hand refused under its field; Channels: add, move, remove
 *     while unused (« Links use it. » otherwise).
 *  3. With links (arrivals, sign-ups and a purchase written through the real services): the channels' rows and their
 *     links, both attributions side by side, the return, the lines and the TOTAL; the period, the views and the
 *     archived links kept in the address; each figure a link to its collectors, a zero none; a failed read says so with
 *     Try again; the phone's blocks (no table, no sideways scroll).
 *  4. A link's page (step 4.9): where it goes, who made it, its figures first and last, By day, its collectors; a
 *     figure's collectors (#/links/collectors) to the client sheet; Edit (the address never changes), Archive
 *     confirmed and Unarchive; a link that brought nothing yet; the phone.
 *  5. An AUDITOR reads it all, without New link, Channels, Edit nor Archive, the emails masked; RETAIL has no Links.
 *  6. A release's CAMPAIGN tab (plan MACRO M1 §2.2 and §2.4, C2 and C3): on a draw's page, RELEASE · CAMPAIGN; « No
 *     link yet » per channel, MAKE THE LINKS in one click, each channel's link with its address; the countdown image,
 *     TEASER by default then FULL once the name and photograph are public, each downloaded as a 1080 × 1920 PNG; the
 *     readout « Figures appear once entries open. »; a LIVE RELEASE's tab with its readout FINAL; the phone.
 *  7. Links → Ad platforms (lot M4 plan §3.5, step M4.12, K27 A1 to A5): from the Links page, read while off (the off
 *     sentence, the three platforms KEYS MISSING, and the empty states of CHANNELS, CONSENT and EVENTS said plainly); a
 *     channel mapped to Meta; SWITCH ON refused with every key missing (its message read); an AUDITOR reads without a
 *     button; the phone.
 * Screens with ORBES_SCREENSHOTS=1 (genome/out/admin-links-*.png). No CSP violation, no page error.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { AD_PLATFORMS_TEXT as AP } from '../../src/web/admin/model/ad-platforms.js';
import { LINKS_COPY as C } from '../../src/web/admin/model/links.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { GrowthWorld } from '../support/growth.js';
import { jpegPhoto } from '../support/images.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const AUDITOR = { email: 'links.auditor@orbes.test', password: 'links auditor passphrase 2026' };
const RETAIL = { email: 'links.retail@orbes.test', password: 'links retail passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
/** expect.poll's budget (its default, 1 s, is too short on a shared CI runner). */
const POLL = { timeout: 15_000 };
const DAY = 86_400_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** A day `n` days from now, `YYYY-MM-DD` (GrowthWorld's days, at 12:00 UTC). */
const dayFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

describe.skipIf(!HAS_CHROMIUM)('the console\'s Links page (plan CUSTOMER INTELLIGENCE §3.4 A.10, E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  const problems: string[] = [];

  async function open(who: { email: string; password: string }, width = 1440, home = 'Dashboard'): Promise<Page> {
    const c = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await p.goto(`${origin}/admin`);
    await p.waitForSelector('[data-testid=login-form]');
    await p.fill('input[name=email]', who.email);
    await p.fill('input[name=password]', who.password);
    await p.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(home);
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const toast = (p: Page, text: string) => p.locator('.toast', { hasText: text }).first().waitFor({ timeout: 15_000 });
  /** The table's rows as `kind:name` (a heading: `heading-row:…`). */
  const rowNames = (p: Page) =>
    p.locator('[data-testid=links-table] tbody tr').evaluateAll((rows) =>
      rows.map((r) => `${((r as HTMLElement).dataset.key ?? '').split(':')[0]}:${(r.querySelector('.links__name-line, .links__heading')?.textContent ?? '').trim()}`),
    );

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
    await p.waitForSelector('[data-testid=links-report]');
  }

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(() => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-links-${name}.png`), fullPage: true });
  }

  /** No sideways scroll at the page's width. */
  async function fits(p: Page): Promise<void> {
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-links-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...RETAIL, role: 'RETAIL' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    // The recording started ten days ago, so the story below is all after it.
    const start = new Date(Date.now() - 10 * DAY);
    await ctx.db.updateTable('acquisition_state').set({ tracking_started_at: start, conversions_until: start }).execute();
    app = await buildApp(ctx, { serveStatic: true, staticDir: webDir });
    await app.listen({ port, host: '127.0.0.1' });
    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await app?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await t?.close().catch(() => {});
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    expect(problems).toEqual([]);
  });

  it(
    'says there is no link yet, with New link, and still shows the lines without a link and the TOTAL; under Clients after Segments',
    async () => {
      for (const width of [1440, 390]) {
        const p = await open(ADMIN, width);
        await go(p, '#/links', 'Links');
        expect(await p.locator('[data-testid=links-empty] .empty__text').textContent()).toBe(C.empty);
        if (width === 1440) {
          const clients = p.locator('.side__group', { hasText: 'Clients' }).locator('.side__link');
          const routes = await clients.evaluateAll((links) => links.map((a) => a.getAttribute('data-route')));
          expect(routes.slice(routes.indexOf('segments'), routes.indexOf('segments') + 2)).toEqual(['segments', 'links']);
          expect(await p.locator('.side__link.is-active').textContent()).toBe('Links');
          expect(await rowNames(p)).toEqual(['heading-row:WITHOUT A LINK', 'line:Campaign tags', 'line:Referring sites', 'line:Direct', 'line:Before tracking', 'line:Console device', 'total:TOTAL']);
          expect(await p.locator('[data-testid=links-period-all]').getAttribute('aria-current')).toBe('page');
          await shot(p, 'empty');
        } else {
          expect(await p.locator('[data-testid=links-table]').isVisible()).toBe(false);
          expect(await p.locator('[data-testid=links-blocks]').isVisible()).toBe(true);
          await fits(p);
          await shot(p, 'empty-phone');
        }
        await p.context().close();
      }
    },
    STEP_TIMEOUT,
  );

  it(
    'makes a link from New link: its address from the name, its cost, both addresses to copy; a taken address refused under its field; the channels',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/links', 'Links');
      await p.click('[data-testid=links-new]');
      const dlg = p.locator('[data-testid=link-dialog]');
      await dlg.waitFor();
      await dlg.locator('input[name=name]').fill('Instagram bio');
      expect(await dlg.locator('input[name=code]').inputValue()).toBe('instagram-bio');
      await dlg.locator('select[name=channelId]').selectOption({ label: 'Instagram' });
      await dlg.locator('select[name=destination]').selectOption('COLLECTION');
      expect(await dlg.locator('select[name=dropId]').isVisible()).toBe(false);
      await dlg.locator('input[name=cost]').fill('2000');
      await dlg.locator('textarea[name=note]').fill('The bio from 9 October.');
      if (SCREENSHOTS) await p.screenshot({ path: join(OUT_DIR, 'admin-links-new-link.png') });
      await p.click('[data-testid=dialog-confirm]');
      await p.locator('[data-testid=link-ready]').waitFor({ timeout: 15_000 });
      await toast(p, 'Link made.');
      expect(await p.locator('[data-testid=link-ready-address]').textContent()).toBe(`${new URL(origin).host}/go/instagram-bio`);
      expect(await p.locator('[data-testid=link-ready-direct]').textContent()).toBe(`${origin}/verify/lookbook?o=instagram-bio`);
      await p.locator('[data-testid=link-ready] .cbtn', { hasText: 'Copy' }).first().click();
      expect(await p.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/go/instagram-bio`);
      if (SCREENSHOTS) await p.screenshot({ path: join(OUT_DIR, 'admin-links-new-link-ready.png') });
      await p.click('[data-testid=link-done]');
      await p.waitForSelector('[data-testid=link-dialog]', { state: 'detached' });
      await expect.poll(() => rowNames(p), POLL).toEqual(expect.arrayContaining(['channel:INSTAGRAM', 'link:Instagram bio']));
      expect(await p.locator('[data-testid=links-empty]').count()).toBe(0);
      const made = await ctx.db.selectFrom('links').select(['code', 'cost_minor', 'cost_currency', 'destination', 'note']).executeTakeFirstOrThrow();
      expect({ ...made, cost_minor: Number(made.cost_minor) }).toEqual({ code: 'instagram-bio', cost_minor: 200_000, cost_currency: 'EUR', destination: 'COLLECTION', note: 'The bio from 9 October.' });

      // The same name again: -2 suggested; the first's address typed by hand is refused under the field.
      await p.click('[data-testid=links-new]');
      await dlg.waitFor();
      await dlg.locator('input[name=name]').fill('Instagram bio');
      expect(await dlg.locator('input[name=code]').inputValue()).toBe('instagram-bio-2');
      await dlg.locator('input[name=code]').fill('instagram-bio');
      await p.click('[data-testid=dialog-confirm]');
      await expect.poll(() => dlg.locator('.cfield[data-field=code] .cfield__hint').textContent(), POLL).toBe('Another link already uses this address.');
      await dlg.locator('input[name=name]').fill('');
      await p.click('[data-testid=dialog-confirm]');
      expect(await dlg.locator('.cfield[data-field=name] .cfield__hint').textContent()).toBe('Give the link a name.');
      await p.click('[data-testid=dialog-cancel]');
      await p.waitForSelector('[data-testid=link-dialog]', { state: 'detached' });

      // Channels: one added, moved up, removed; Instagram, used, cannot be removed.
      await p.click('[data-testid=links-channels]');
      const ch = p.locator('[data-testid=channels-dialog]');
      await ch.waitFor();
      const names = () => ch.locator('[data-testid=channel-name]').allTextContents();
      expect(await names()).toEqual(['Instagram', 'TikTok', 'Influencers', 'Press', 'Shops', 'Search', 'Other']);
      const instagram = ch.locator('[data-testid=channel]', { has: p.locator('[data-testid=channel-name]', { hasText: /^Instagram$/ }) });
      expect(await instagram.locator('[data-testid=channel-remove]').isDisabled()).toBe(true);
      expect(await instagram.textContent()).toContain('Links use it.');
      await ch.locator('input[name=channelName]').fill('Newsletter');
      await p.click('[data-testid=channels-add]');
      await expect.poll(names, POLL).toEqual(['Instagram', 'TikTok', 'Influencers', 'Press', 'Shops', 'Search', 'Other', 'Newsletter']);
      await ch.locator('[data-testid=channel]').last().locator('[data-testid=channel-up]').click();
      await expect.poll(names, POLL).toEqual(['Instagram', 'TikTok', 'Influencers', 'Press', 'Shops', 'Search', 'Newsletter', 'Other']);
      if (SCREENSHOTS) await p.screenshot({ path: join(OUT_DIR, 'admin-links-channels.png') });
      await ch.locator('[data-testid=channel]').nth(6).locator('[data-testid=channel-remove]').click();
      await expect.poll(names, POLL).toEqual(['Instagram', 'TikTok', 'Influencers', 'Press', 'Shops', 'Search', 'Other']);
      await p.click('[data-testid=channels-done]');
      await p.waitForSelector('[data-testid=channels-dialog]', { state: 'detached' });
      const audits = await ctx.db.selectFrom('audit_logs').select('action').where('action', 'like', 'link%').orderBy('id').execute();
      expect(audits.map((a) => a.action)).toEqual(['link.create', 'link_channel.create', 'link_channel.update', 'link_channel.update', 'link_channel.delete']);
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'shows each link\'s figures twice, first and last, with its return; the views, the period and the archived links in the address; a failed read; the phone\'s blocks',
    async () => {
      // The story, through the real services: six phones through Instagram bio, one signs up and buys (€ 640, a salon
      // order paid tomorrow); one through Léa — TikTok (£ 500) signs up; a campaign and two sites; an archived link.
      const operator = (await ctx.db.selectFrom('admin_users').select('id').where('email', '=', ADMIN.email).executeTakeFirstOrThrow()).id;
      const actor: Actor = { type: 'admin', id: operator };
      const channels = Object.fromEntries((await ctx.services.links.channels()).map((c) => [c.name, c.id]));
      await ctx.services.links.create({ name: 'Story 14 Oct', channelId: channels.Instagram, destination: 'NOW' }, actor);
      await ctx.services.links.create({ name: 'Léa — TikTok', channelId: channels.Influencers, destination: 'RELEASES', cost: { minor: 50_000, currency: 'GBP' } }, actor);
      const press = await ctx.services.links.create({ name: 'Press day', channelId: channels.Press, destination: 'NOW' }, actor);
      await ctx.services.links.archive(press.id, actor);
      let seq = 0;
      const device = async (daysAgo: number) => {
        const at = new Date(Date.now() - daysAgo * DAY);
        const hash = `links${String(++seq).padStart(4, '0')}${'d'.repeat(34)}`;
        const id = (await ctx.db.insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: at, last_seen_at: at }).returning('id').executeTakeFirstOrThrow()).id;
        return { id, hash, at };
      };
      const arrive = (d: { id: number; at: Date }, a: { link?: string; utm?: Record<string, string>; referrer?: string }) => ctx.services.acquisition.arrive({ deviceId: d.id, accountId: null, now: d.at, ...a });
      const signUp = async (d: { hash: string; at: Date }, email: string) => {
        const created = new Date(d.at.getTime() + 3_600_000);
        const id = (await ctx.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'x', country: 'FR', created_at: created }).returning('id').executeTakeFirstOrThrow()).id;
        await ctx.services.tracking.link(d.hash, id, 'SIGN_UP', created);
        return id;
      };
      const phones = [];
      for (let i = 0; i < 6; i++) {
        const d = await device(8);
        await arrive(d, { link: 'instagram-bio' });
        phones.push(d);
      }
      const camille = await signUp(phones[0]!, 'camille@example.com');
      const lea = await device(6);
      await arrive(lea, { link: 'lea-tiktok' });
      await signUp(lea, 'hugo@example.com');
      const story = await device(5);
      await arrive(story, { utm: { source: 'ig', medium: 'story', campaign: 'drop-14', content: 'story-2' } });
      await signUp(story, 'amelia@example.com');
      await arrive(await device(4), { referrer: 'https://www.instagram.com/' });
      await arrive(await device(3), { referrer: 'https://theorbes.com/' });
      await arrive(await device(2), { link: 'press-day' });
      const w = await new GrowthWorld(ctx.db).prepare();
      const model = await w.model('MONOLITHE', { price: [64_000, 'EUR'] });
      // Paid after Instagram bio was made (its RETURN, SINCE MADE counts it): tomorrow at 12:00 UTC, its request today.
      await w.order({ accountId: camille, modelId: model, channel: 'SALON', paid: dayFromNow(1), total: 64_000, currency: 'EUR' });
      await ctx.services.acquisition.recordConversions(new Date(Date.now() + 2 * DAY));

      const p = await open(ADMIN);
      await go(p, '#/links', 'Links');
      expect(await rowNames(p)).toEqual([
        'channel:INSTAGRAM',
        'link:Story 14 Oct',
        'link:Instagram bio',
        'channel:INFLUENCERS',
        'link:Léa — TikTok',
        'channel:PRESS',
        'heading-row:WITHOUT A LINK',
        'line:Campaign tags',
        'line:Referring sites',
        'line:Direct',
        'line:Before tracking',
        'line:Console device',
        'total:TOTAL',
      ]);
      const bio = p.locator('[data-testid=links-table] tr.links__row--link', { hasText: 'Instagram bio' });
      const cells = async (row: typeof bio) => (await row.locator('td').allTextContents()).map((x) => x.replace(/[  ]/g, ' ').trim());
      const bioCells = await cells(bio);
      // LINK · VISITS · FIRST VISITS · first: 4 + RETURN · last: 4 + RETURN · COST.
      expect(bioCells.slice(1)).toEqual(['6', '6', '1', '0', '1', '€ 640', '×0.3Revenue € 640 for € 2 000', '1', '0', '1', '€ 640', '×0.3Revenue € 640 for € 2 000', '€ 2 000']);
      expect(await bio.locator('[data-testid=link-address]').textContent()).toBe(`${new URL(origin).host}/go/instagram-bio`);
      expect(await bio.locator('[data-testid=figure-first-signups]').getAttribute('href')).toMatch(/^#\/links\/collectors\?source=link%3A[0-9a-f-]{36}&name=Instagram%20bio&attribution=first&measure=signups&currency=EUR$/);
      expect(await bio.locator('a[data-testid=figure-first-entries]').count()).toBe(0);
      const leaCells = await cells(p.locator('[data-testid=links-table] tr.links__row--link', { hasText: 'Léa — TikTok' }));
      expect(leaCells.slice(1)).toEqual(['1', '1', '1', '0', '0', '€ 0', 'Not in EUR', '1', '0', '0', '€ 0', 'Not in EUR', '£ 500']);
      const total = await cells(p.locator('[data-testid=links-table] tr.links__row--total'));
      expect(total.slice(1)).toEqual(['11', '11', '3', '0', '1', '€ 640', '', '3', '0', '1', '€ 640', '', '']);
      expect(await p.locator('[data-testid=links-table] th', { hasText: 'FIRST LINK · DISCOVERY' }).getAttribute('colspan')).toBe('5');
      await fits(p);
      // At a desk's 1 440 px the whole table shows, no column past the page.
      expect(await p.locator('.links__desk').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      await shot(p, 'with-links');

      // The archived link, when asked; kept in the address.
      await p.click('[data-testid=links-archived] .ccheck__label');
      await expect.poll(() => p.evaluate(() => location.hash), POLL).toBe('#/links?archived=1');
      await expect.poll(() => rowNames(p), POLL).toContain('link:Press dayARCHIVED');
      // The views.
      await p.click('[data-testid=links-view-campaigns]');
      await expect.poll(() => rowNames(p), POLL).toEqual(['group:ig', 'campaign:ig / story / drop-14', 'heading-row:WITHOUT TAGS', 'line:Links', 'line:Referring sites', 'line:Direct', 'line:Before tracking', 'line:Console device', 'total:TOTAL']);
      expect(await p.locator('[data-testid=links-table] th', { hasText: 'COST' }).count()).toBe(0);
      await shot(p, 'campaigns');
      await p.click('[data-testid=links-view-sites]');
      await expect.poll(() => rowNames(p), POLL).toEqual(expect.arrayContaining(['site:instagram.com', 'site:theorbes.com (ORBES’s site)']));
      await shot(p, 'sites');
      // The period: 7 days, then a CUSTOM one checked before it is asked.
      await go(p, '#/links?period=7', 'Links');
      expect(await p.locator('[data-testid=links-period-7]').getAttribute('aria-current')).toBe('page');
      await go(p, '#/links?period=custom', 'Links');
      await p.fill('[data-testid=links-custom] input[name=from]', dayFromNow(-1));
      await p.fill('[data-testid=links-custom] input[name=to]', dayFromNow(-3));
      await p.click('[data-testid=links-custom] button[type=submit]');
      expect(await p.locator('.links__problem').textContent()).toBe(C.customProblem);
      await p.fill('[data-testid=links-custom] input[name=to]', dayFromNow(0));
      await p.click('[data-testid=links-custom] button[type=submit]');
      await expect.poll(() => p.evaluate(() => location.hash), POLL).toBe(`#/links?period=custom&from=${dayFromNow(-1)}&to=${dayFromNow(0)}`);

      // A read that fails says so, with Try again.
      await p.route('**/api/admin/links?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x"}}' }));
      await go(p, '#/links?period=30', 'Links');
      expect(await p.locator('[data-testid=links-failed] .empty__text').textContent()).toBe(C.failed);
      await p.unroute('**/api/admin/links?*');
      await p.locator('[data-testid=links-failed] .cbtn', { hasText: C.tryAgain }).click();
      await expect.poll(() => p.locator('[data-testid=links-table]').count(), POLL).toBe(1);
      await p.context().close();

      // A phone: the blocks, FIRST and LAST side by side, the selects; no sideways scroll.
      const phone = await open(ADMIN, 390);
      await go(phone, '#/links', 'Links');
      const block = phone.locator('[data-testid=links-blocks] .links__block--link', { hasText: 'Instagram bio' });
      expect((await block.locator('.links__visits').textContent())?.replace(/[  ]/g, ' ')).toBe('Visits 6 · First visits 6');
      expect(await block.locator('.links__col-title').allTextContents()).toEqual(['FIRST', 'LAST']);
      expect(await block.locator('.links__col').first().locator('.links__col-label').allTextContents()).toEqual(['Sign-ups', 'Entries', 'Purchases', 'Revenue', 'Return']);
      expect(await phone.locator('select[name=linksPeriod]').isVisible()).toBe(true);
      await fits(phone);
      await shot(phone, 'with-links-phone');
      await phone.locator('select[name=linksView]').selectOption('sites');
      await expect.poll(() => phone.evaluate(() => location.hash), POLL).toBe('#/links?view=sites');
      await phone.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'opens a link\'s page (step 4.9): where it goes, its figures first and last, by day, its collectors; a figure\'s collectors to the client sheet; Edit, Archive and Unarchive; the phone',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/links', 'Links');
      await p.locator('[data-testid=links-table] [data-testid=link-name]', { hasText: /^Instagram bio$/ }).click();
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Instagram bio');
      expect(await p.locator('.page-head__eyebrow').textContent()).toBe('Clients · Links · Instagram bio');
      expect(await p.locator('[data-testid=link-goes-to]').textContent()).toBe('Goes to THE COLLECTION');
      expect(await p.locator('[data-testid=link-note]').textContent()).toBe('The bio from 9 October.');
      expect(await p.locator('[data-testid=link-facts]').textContent()).toMatch(/Made by console@orbes\.test on \d{2} [A-Z]{3} \d{4} · \d{2}:\d{2} Paris/);
      expect((await p.locator('[data-testid=link-visits]').textContent())?.replace(/[\u2009\u00a0]/g, ' ')).toBe('Visits 6 · First visits 6');
      const first = p.locator('[data-testid=link-first] .link__fig');
      expect((await first.allTextContents()).map((x) => x.replace(/[\u2009\u00a0]/g, ' '))).toEqual(['Sign-ups1', 'Entries0', 'Purchases1', 'Revenue€ 640', 'Return×0.3Revenue € 640 for € 2 000']);
      expect(await p.locator('[data-testid=link-days] .bar').count()).toBeGreaterThanOrEqual(2);
      await expect.poll(() => p.locator('#link-collectors [data-testid=link-collector]').allTextContents(), POLL).toEqual(['camille@example.com']);
      await p.locator('#link-collectors select[name=linkMeasure]').selectOption('purchases');
      await expect.poll(() => p.evaluate(() => location.hash), POLL).toMatch(/measure=purchases/);
      // The list is read again for the new measure: wait for it rather than read it while it reloads (genome-ci).
      await expect.poll(() => p.locator('#link-collectors [data-testid=link-collector]').allTextContents(), POLL).toEqual(['camille@example.com']);
      await p.click('[data-testid=link-collectors-last]');
      await expect.poll(() => p.evaluate(() => location.hash), POLL).toMatch(/attribution=last/);
      await shot(p, 'link');

      // A figure: its collectors, then the client sheet.
      await p.click('[data-testid=link-figure-first-signups]');
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Sign-ups through Instagram bio · first link · all time');
      await expect.poll(() => p.locator('[data-testid=link-collector]').allTextContents(), POLL).toEqual(['camille@example.com']);
      expect(await p.locator('.page-head__actions a', { hasText: 'Instagram bio' }).count()).toBe(1);
      await shot(p, 'collectors');
      await p.locator('[data-testid=link-collector]').first().click();
      await expect.poll(() => p.evaluate(() => location.hash), POLL).toMatch(/^#\/owners\/[0-9a-f-]{36}$/);
      // From the Links page too: the TOTAL's sign-ups, every counted collector.
      await go(p, '#/links', 'Links');
      await p.locator('[data-testid=links-table] tr.links__row--total [data-testid=figure-first-signups]').click();
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Sign-ups · All · first link · all time');
      expect((await p.locator('[data-testid=link-collector]').allTextContents()).sort()).toEqual(['amelia@example.com', 'camille@example.com', 'hugo@example.com']);

      // Edit: renamed; the address never changes; nothing changed says so.
      const id = (await ctx.db.selectFrom('links').select('id').where('code', '=', 'instagram-bio').executeTakeFirstOrThrow()).id;
      await p.evaluate((h) => (location.hash = h), `#/links/${id}`);
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Instagram bio');
      await p.click('[data-testid=link-edit]');
      const dlg = p.locator('[data-testid=link-dialog]');
      await dlg.waitFor();
      expect(await dlg.locator('input[name=code]').count()).toBe(0);
      expect(await dlg.locator('.cfield[data-field=address] .mono').textContent()).toBe(`${new URL(origin).host}/go/instagram-bio`);
      await p.click('[data-testid=dialog-confirm]');
      expect(await dlg.locator('.dialog__error').textContent()).toBe('Nothing has changed.');
      await dlg.locator('input[name=name]').fill('Instagram bio — October');
      await p.click('[data-testid=dialog-confirm]');
      await toast(p, 'Saved.');
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Instagram bio — October');
      // Archive, confirmed; Unarchive.
      await p.click('[data-testid=link-archive]');
      await p.locator('dialog.dialog', { hasText: 'It keeps working where it is posted; it only leaves the list.' }).waitFor();
      await p.click('[data-testid=dialog-confirm]');
      await toast(p, 'Archived.');
      await expect.poll(() => p.locator('[data-testid=link-archived-on]').count(), POLL).toBe(1);
      expect(await p.locator('[data-testid=link-archive]').textContent()).toBe('Unarchive');
      await p.click('[data-testid=link-archive]');
      await toast(p, 'Back in the list.');
      await expect.poll(() => p.locator('[data-testid=link-archived-on]').count(), POLL).toBe(0);
      const audits = await ctx.db.selectFrom('audit_logs').select('action').where('action', 'in', ['link.update', 'link.archive', 'link.unarchive']).orderBy('id').execute();
      expect(audits.map((a) => a.action).slice(-3)).toEqual(['link.update', 'link.archive', 'link.unarchive']);
      // A link that has brought nothing yet.
      const story = (await ctx.db.selectFrom('links').select('id').where('code', '=', 'story-14-oct').executeTakeFirstOrThrow()).id;
      await p.evaluate((h) => (location.hash = h), `#/links/${story}`);
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Story 14 Oct');
      expect(await p.locator('#link-figures .empty__text').textContent()).toBe('No visit yet. The figures appear as people use the link.');
      expect(await p.locator('#link-collectors .empty__text').textContent()).toBe('No collector for this figure in these days.');
      await p.context().close();

      const phone = await open(ADMIN, 390);
      await phone.evaluate((h) => (location.hash = h), `#/links/${id}`);
      await expect.poll(async () => (await title(phone).textContent())?.trim(), POLL).toBe('Instagram bio — October');
      await fits(phone);
      await shot(phone, 'link-phone');
      await phone.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'lets an AUDITOR read every figure without New link nor Channels; RETAIL has no Links',
    async () => {
      const p = await open(AUDITOR);
      await go(p, '#/links', 'Links');
      expect(await p.locator('[data-testid=links-new], [data-testid=links-channels]').count()).toBe(0);
      expect(await p.locator('[data-testid=links-table] tr.links__row--link').count()).toBeGreaterThan(0);
      await shot(p, 'auditor');
      // A link's page: no Edit nor Archive; the collectors' emails masked.
      await p.locator('[data-testid=links-table] [data-testid=link-name]', { hasText: /^Instagram bio — October$/ }).click();
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Instagram bio — October');
      expect(await p.locator('[data-testid=link-edit], [data-testid=link-archive]').count()).toBe(0);
      expect(await p.locator('#link-collectors [data-testid=link-collector]').allTextContents()).toEqual([expect.stringMatching(/^c\*+@example\.com$/)]);
      await shot(p, 'link-auditor');
      await p.context().close();
      const phone = await open(AUDITOR, 390);
      await go(phone, '#/links', 'Links');
      await fits(phone);
      await shot(phone, 'auditor-phone');
      await phone.context().close();
      const r = await open(RETAIL, 1440, 'Sale mode');
      expect(await r.locator('.side__link[data-route=links]').count()).toBe(0);
      await r.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'gives a release a CAMPAIGN tab: its links made in one click, the countdown image TEASER then FULL downloaded as a 1080 × 1920 PNG, the readout (C2, C3)',
    async () => {
      const operator = (await ctx.db.selectFrom('admin_users').select('id').where('email', '=', ADMIN.email).executeTakeFirstOrThrow()).id;
      const actor: Actor = { type: 'admin', id: operator };
      const w = await new GrowthWorld(ctx.db).prepare();
      const model = await w.model('HALO');
      await ctx.services.media.setModelImage(model, { mime: 'image/jpeg', bytes: jpegPhoto(600, 600) }, SYSTEM_ACTOR);
      // A draw in two weeks, published an hour ago (its name and photograph public from then); a LIVE RELEASE opened two days ago.
      const draw = await w.drop({ mode: 'DRAW', modelId: model, title: 'The November draw', opens: dayFromNow(14), quantity: 10 });
      await ctx.db.updateTable('drops').set({ published_at: new Date(Date.now() - 3_600_000) }).where('id', '=', draw.id).execute();
      const live = await w.drop({ mode: 'LIVE', modelId: model, title: 'The October release', opens: dayFromNow(-2), quantity: 3 });
      const channels = await ctx.services.links.channels();
      const pngSize = (b: Buffer) => ({ png: b.subarray(1, 4).toString('latin1'), width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
      const paris = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(`${dayFromNow(14)}T12:00:00.000Z`));

      const p = await open(ADMIN);
      await p.evaluate((h) => (location.hash = h), `#/club/drops/${draw.id}`);
      await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('The November draw');
      expect(await p.locator('[data-testid=release-tab-release]').getAttribute('aria-current')).toBe('page');
      await p.click('[data-testid=release-tab-campaign]');
      await p.locator('[data-testid=campaign-make-links]').waitFor({ timeout: 15_000 });
      expect(await p.locator('[data-testid=release-tab-campaign]').getAttribute('aria-current')).toBe('page');
      expect(await p.locator('[data-testid=campaign-no-link]').count()).toBe(channels.length);
      expect(await p.locator('[data-testid=campaign-readout-empty] .empty__text').textContent()).toBe('Figures appear once entries open.');
      // TEASER by default, drawn in Chromium; FULL can be chosen (published, a photograph).
      await p.locator('[data-testid=campaign-image]').waitFor({ timeout: 15_000 });
      expect(await p.locator('[data-testid=campaign-image-teaser]').getAttribute('aria-pressed')).toBe('true');
      expect(await p.locator('[data-testid=campaign-image]').getAttribute('data-filename')).toBe(`orbes-${paris}-teaser.png`);
      expect(await p.locator('[data-testid=campaign-image]').getAttribute('alt')).not.toMatch(/HALO/);
      await shot(p, 'campaign-draw');

      await p.click('[data-testid=campaign-make-links]');
      await toast(p, `${channels.length} links made.`);
      await expect.poll(() => p.locator('[data-testid=campaign-link-address]').count(), { timeout: 15_000 }).toBe(channels.length);
      expect(await p.locator('[data-testid=campaign-no-link]').count()).toBe(0);
      expect(await p.locator('[data-testid=campaign-make-links]').count()).toBe(0);
      const day = Number(paris.slice(8));
      const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][Number(paris.slice(5, 7)) - 1];
      expect(await p.locator('[data-testid=campaign-link-address]').first().textContent()).toBe(`${new URL(origin).host}/go/release-${day}-${month}-instagram`);
      expect(await ctx.db.selectFrom('audit_logs').select('action').where('action', '=', 'drop.campaign.links').where('target_id', '=', draw.id).execute()).toHaveLength(1);
      await shot(p, 'campaign-draw-links');

      const teaser = p.waitForEvent('download');
      await p.click('[data-testid=campaign-download]');
      const t = await teaser;
      expect(t.suggestedFilename()).toBe(`orbes-${paris}-teaser.png`);
      const teaserPng = readFileSync((await t.path())!);
      expect(pngSize(teaserPng)).toEqual({ png: 'PNG', width: 1080, height: 1920 });

      await p.click('[data-testid=campaign-image-full]');
      await expect.poll(() => p.locator('[data-testid=campaign-image]').getAttribute('data-filename'), { timeout: 15_000 }).toBe(`orbes-${paris}-full.png`);
      expect(await p.locator('[data-testid=campaign-image]').getAttribute('alt')).toMatch(/HALO/);
      const full = p.waitForEvent('download');
      await p.click('[data-testid=campaign-download]');
      const f = await full;
      expect(f.suggestedFilename()).toBe(`orbes-${paris}-full.png`);
      const fullPng = readFileSync((await f.path())!);
      expect(pngSize(fullPng)).toEqual({ png: 'PNG', width: 1080, height: 1920 });
      if (SCREENSHOTS) {
        writeFileSync(join(OUT_DIR, 'admin-links-campaign-teaser.png'), teaserPng);
        writeFileSync(join(OUT_DIR, 'admin-links-campaign-full.png'), fullPng);
      }
      await shot(p, 'campaign-draw-full');
      await p.context().close();

      // A LIVE RELEASE opened two days ago: its links made by the service, one with a cost; its readout FINAL (its close passed).
      const made = await ctx.services.campaign.makeLinks(live.id, actor);
      await ctx.services.links.update(made.made[0]!.id, { cost: { minor: 20_000, currency: 'EUR' } }, actor);
      await w.liveEntry(live, await w.account(dayFromNow(-20).slice(0, 10), 'FR'), dayFromNow(-2));
      const phone = await open(ADMIN, 390);
      await phone.evaluate((h) => (location.hash = h), `#/club/live/${live.id}?tab=campaign`);
      await phone.locator('[data-testid=campaign-readout]').waitFor({ timeout: 15_000 });
      expect(await phone.locator('#campaign-readout .panel__note').textContent()).toBe('Final · Last link · counted collectors only');
      expect(await phone.locator('[data-testid=campaign-readout-row]').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.kind))).toEqual([...made.made.map(() => 'link'), 'other', 'total']);
      await phone.locator('[data-testid=campaign-image]').waitFor({ timeout: 15_000 });
      await fits(phone);
      await shot(phone, 'campaign-live-phone');
      await phone.context().close();
      const desk = await open(ADMIN);
      await desk.evaluate((h) => (location.hash = h), `#/club/live/${live.id}?tab=campaign`);
      await desk.locator('[data-testid=campaign-readout]').waitFor({ timeout: 15_000 });
      await desk.locator('[data-testid=campaign-image]').waitFor({ timeout: 15_000 });
      await shot(desk, 'campaign-live');
      await desk.context().close();
      if (SCREENSHOTS) {
        const tight = await open(ADMIN, 1024);
        await tight.evaluate((h) => (location.hash = h), `#/club/drops/${draw.id}?tab=campaign`);
        await tight.locator('[data-testid=campaign-image]').waitFor({ timeout: 15_000 });
        await fits(tight);
        await shot(tight, 'campaign-draw-1024');
        await tight.context().close();
      }
    },
    STEP_TIMEOUT,
  );

  it(
    'opens Links → Ad platforms: off said plainly, KEYS MISSING, each section\'s empty state; a channel mapped to Meta; SWITCH ON refused with every key missing; an AUDITOR reads (K27, M4.12)',
    async () => {
      const toAds = async (p: Page) => {
        await go(p, '#/links', 'Links');
        await p.click('[data-testid=links-ad-platforms]');
        await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(AP.title);
        expect(await p.evaluate(() => location.hash)).toBe('#/links/ads');
        expect(await p.locator('.side__link.is-active').textContent()).toBe('Links');
      };
      const p = await open(ADMIN);
      await toAds(p);
      // Off, said plainly; never switched; the three platforms without their keys, nothing counted.
      expect([await p.locator('[data-testid=ads-state] .adplat__state-label').textContent(), await p.locator('[data-testid=ads-state] .status__text').textContent()]).toEqual([`${AP.conversionsLabel}:`, AP.off]);
      expect(await p.locator('[data-testid=ads-off]').textContent()).toBe('Conversions are off. Nothing is captured or sent, and collectors see no banner.');
      expect(await p.locator('[data-testid=ads-switched]').textContent()).toBe(AP.neverSwitched);
      expect(await p.locator('[data-testid=ads-platform]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.platform))).toEqual(['META', 'TIKTOK', 'GOOGLE']);
      expect(await p.locator('[data-testid=ads-keys]').allTextContents()).toEqual([AP.keysMissing, AP.keysMissing, AP.keysMissing]);
      expect(await p.locator('[data-testid=ads-api-version]').allTextContents()).toEqual(['v24.0', 'v1.3', 'v22']);
      expect(await p.locator('[data-testid=ads-last-send]').allTextContents()).toEqual([AP.never, AP.never, AP.never]);
      expect(await p.locator('[data-testid=ads-count-SENT]').allTextContents()).toEqual(['0', '0', '0']);
      expect(await p.locator('[data-testid=ads-test]').count()).toBe(0);
      expect(await p.locator('[data-testid=ads-test-off]').textContent()).toBe(AP.testWhileOff);
      // Each section's empty state in its own words.
      expect(await p.locator('[data-testid=ads-channels-empty] .empty__text').textContent()).toBe(AP.channelsEmpty);
      expect(await p.locator('[data-testid=ads-consent-empty] .empty__text').textContent()).toBe(AP.consentEmpty);
      expect(await p.locator('[data-testid=ads-events-empty] .empty__text').textContent()).toBe(AP.eventsEmpty);
      expect(await p.locator('[data-testid=ads-google-action]').allTextContents()).toEqual([AP.notNamed, AP.notNamed, AP.notNamed, AP.notNamed]);
      await shot(p, 'ads-off');

      // A channel mapped to Meta, saved on its own row.
      const instagram = p.locator('[data-testid=ads-channel]', { has: p.locator('[data-testid=ads-channel-name]', { hasText: /^Instagram$/ }) });
      const save = instagram.locator('[data-testid=ads-channel-save]');
      expect(await save.isDisabled()).toBe(true);
      await instagram.locator('[data-testid=ads-channel-META]').click();
      expect(await save.isDisabled()).toBe(false);
      await save.click();
      await toast(p, 'Instagram saved.');
      await expect.poll(() => p.locator('[data-testid=ads-channels-empty]').count(), POLL).toBe(0);
      expect(await instagram.locator('[data-testid=ads-channel-META] input').isChecked()).toBe(true);
      const mapped = await ctx.db.selectFrom('ads_channel_platforms as m').innerJoin('link_channels as c', 'c.id', 'm.channel_id').select(['c.name', 'm.platform']).execute();
      expect(mapped).toEqual([{ name: 'Instagram', platform: 'META' }]);

      // SWITCH ON: the dialog says what goes live, the phrase typed; refused with every key missing, its message read.
      await p.click('[data-testid=ads-switch]');
      await p.locator('dialog.dialog').waitFor();
      expect(await p.locator('[data-testid=ads-switch-body]').textContent()).toBe('The consent banner and the privacy policy’s advertising section appear at once. Events are sent only for collectors who accept, from now on.');
      expect(await p.locator('[data-testid=dialog-confirm]').isDisabled()).toBe(true);
      await p.fill('[data-testid=dialog-phrase]', 'SWITCH ON');
      await p.click('[data-testid=dialog-confirm]');
      await expect.poll(() => p.locator('.dialog__error').textContent(), POLL).toBe('No platform has its keys in the server’s .env: conversions cannot be switched on.');
      await shot(p, 'ads-switch-refused');
      await p.click('[data-testid=dialog-cancel]');
      await p.waitForSelector('dialog.dialog', { state: 'detached' });
      expect(await ctx.db.selectFrom('ads_settings').select(['enabled', 'events_from']).execute()).toEqual([{ enabled: false, events_from: null }]);
      expect((await ctx.db.selectFrom('audit_logs').select('action').where('action', 'like', 'ads.%').execute()).map((a) => a.action)).toEqual(['ads.channels']);
      await p.context().close();

      // An AUDITOR reads it all without a button; the phone fits.
      const a = await open(AUDITOR);
      await toAds(a);
      expect(await a.locator('[data-testid=ads-switch], [data-testid=ads-test-codes], [data-testid=ads-google-edit], [data-testid=ads-channel-save]').count()).toBe(0);
      expect(await a.locator('[data-testid=ads-channel-platforms]').first().textContent()).toBe('Meta');
      await a.context().close();
      const phone = await open(ADMIN, 390);
      await toAds(phone);
      await fits(phone);
      await shot(phone, 'ads-phone');
      await phone.context().close();
    },
    STEP_TIMEOUT,
  );
});
