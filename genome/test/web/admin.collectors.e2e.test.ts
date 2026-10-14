/**
 * The console's Collectors page, end to end (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6, C.13
 * « admin.collectors.e2e.test.ts »; steps 9.9 to 9.11): the production web build of the console served by the real
 * Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider), driven in Chromium (playwright-core), at a desk's
 * 1 440 px and a phone's 375 px, over a small house written straight into the tables: six counted collectors, a test
 * entrant and a team account (both left out of every figure).
 *
 *  9.9  The controls (the period with CUSTOM and its refusal, Compare, the scope, the five filters with Clear filters,
 *       Read at · Read again), all kept in the address; the view in words; At a glance's six KPIs with their
 *       comparison; Who they are (AGES, COUNTRIES and CITIES as given and from the connection); each figure a link with
 *       its aria-label, an AUDITOR's cities none; at 375 px the KPIs two by two, the filters folded into « Filters (1) »
 *       opened as a sheet, no sideways scroll.
 *  9.10 Each panel and tab: Where they come from (SOURCES, HOW THEY HEARD, LINKS, CAMPAIGNS, REFERRING SITES, FIRST
 *       VISITS), What they like (the Wishlists figures, FAVOURITE PIECES, FINISHES, MOST WISHED models and collections,
 *       MOST VIEWED by collectors and by every visitor, PIECES HELD), Devices (BY COLLECTORS, BY VISITS, ALL DEVICES),
 *       Engagement (SCORE SPREAD, THE FIVE PARTS, ACTIVE AND DORMANT, MONTHLY COHORTS), Over time (a figure and a split);
 *       a most wished model's row opens the collectors who wish for it (question 16).
 *  9.11 Figure → list → sheet: a KPI, a country, a most wished row open the list (#/collectors/list), its title naming the
 *       figure, ordered by email, its pager, Back to the figures to the same view, a row to the client sheet; an
 *       AUDITOR's list masks the emails and shows no city.
 *  9.12 Export (CSV): an ADMIN's dialog counts the collectors of the page's five filters, Export downloads the file of
 *       those collectors (test entrant and team account left out) and a toast counts them; an OPERATOR and an AUDITOR
 *       see no button.
 *
 * Screens with ORBES_SCREENSHOTS=1 (genome/out/admin-collectors-*.png). No CSP violation, no page error.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { parisDay } from '../../src/server/services/schedule.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { GrowthWorld } from '../support/growth.js';
import { seedScore } from '../support/scores.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const AUDITOR = { email: 'collectors.auditor@orbes.test', password: 'collectors auditor passphrase 2026' };
const OPERATOR = { email: 'collectors.operator@orbes.test', password: 'collectors operator passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 240_000;
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

/** The house's collectors, as the figures count them. */
interface Collector {
  key: string;
  id?: string;
  email: string;
  country: string | null;
  daysAgo: number;
  birth: string | null;
  city: string | null;
  place: [string, string] | null;
  score: number | null;
}

/** Ages are counted on the Paris day: these dates of birth give 25–34, 35–44, 25–34. */
const HOUSE: Collector[] = [
  { key: 'a', email: 'a.collector@example.com', country: 'FR', daysAgo: 3, birth: '1995-05-02', city: 'Lyon', place: ['FR', 'Paris'], score: 72 },
  { key: 'b', email: 'b.collector@example.com', country: 'FR', daysAgo: 10, birth: '1988-01-01', city: 'lyon', place: ['FR', 'Lyon'], score: 54 },
  { key: 'c', email: 'c.collector@example.com', country: 'IT', daysAgo: 60, birth: null, city: 'Milano', place: ['IT', 'Milan'], score: 40 },
  { key: 'd', email: 'd.collector@example.com', country: 'GB', daysAgo: 5, birth: '2000-06-01', city: 'London', place: null, score: null },
  { key: 'e', email: 'e.collector@example.com', country: 'FR', daysAgo: 20, birth: null, city: null, place: null, score: null },
  { key: 'f', email: 'f.collector@example.com', country: null, daysAgo: 2, birth: null, city: null, place: null, score: null },
];

describe.skipIf(!HAS_CHROMIUM)('the console\'s Collectors page (plan CUSTOMER INTELLIGENCE §3.6 C.6, E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  const problems: string[] = [];
  const ids: Record<string, string> = {};
  const models: Record<string, string> = {};

  async function open(who: { email: string; password: string }, width = 1440): Promise<Page> {
    const c = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, acceptDownloads: true, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
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
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const text = async (p: Page, sel: string) => ((await p.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const hashOf = (p: Page) => p.evaluate(() => decodeURIComponent(location.hash));
  /** A panel read: its body holds no loading line any more. */
  const loaded = (p: Page, panel: string) => p.waitForSelector(`[data-testid=collectors-panel-${panel}]:not([aria-busy]) .panel__body > :not(.loading)`, { timeout: 30_000 });

  /** Marks the page shown, so the next one is told apart from it. */
  const mark = (p: Page) => p.evaluate(() => document.querySelectorAll('[data-testid=collectors]').forEach((e) => ((e as HTMLElement).dataset.old = '1')));
  /** The page after a choice: its address, then a new page with At a glance and Who they are read. */
  async function settled(p: Page, hash: string | RegExp): Promise<void> {
    if (typeof hash === 'string') await expect.poll(() => hashOf(p), { timeout: 15_000 }).toBe(hash);
    else await expect.poll(() => hashOf(p), { timeout: 15_000 }).toMatch(hash);
    await p.waitForSelector('[data-testid=collectors]:not([data-old])', { timeout: 15_000 });
    await loaded(p, 'overview');
    await loaded(p, 'who');
  }
  /** Does `fn` (a click) and waits for the page it leads to. */
  async function act(p: Page, fn: () => Promise<unknown>, hash: string | RegExp): Promise<void> {
    await mark(p);
    await fn();
    await settled(p, hash);
  }

  async function go(p: Page, hash: string): Promise<void> {
    await mark(p);
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('Collectors');
    await settled(p, decodeURIComponent(hash));
  }

  /** Every panel read. */
  const allLoaded = async (p: Page) => {
    for (const panel of ['overview', 'who', 'origin', 'likes', 'devices', 'engagement', 'trends']) await loaded(p, panel);
  };
  /** A table's body rows as their cells' texts joined by ' | '. */
  const rowsOf = (p: Page, sel: string) =>
    p.locator(`${sel} tbody tr`).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' | ')));

  /** The KPIs as `label: value`. */
  const kpis = (p: Page) => p.locator('[data-testid=collectors-kpis] .kpi').evaluateAll((els) => els.map((e) => `${e.querySelector('.kpi__label')?.textContent}: ${e.querySelector('.kpi__value')?.textContent}`));
  /** A bar list's rows as `label count`. */
  const bars = (p: Page, testid: string) =>
    p.locator(`[data-testid=${testid}] .bar`).evaluateAll((els) => els.map((e) => `${e.querySelector('.bar__label')?.textContent?.trim()} ${e.querySelector('.bar__value')?.textContent?.trim()}`));

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-collectors-${name}.png`), fullPage: true });
  }

  /** No sideways scroll at the page's width. */
  async function fits(p: Page): Promise<void> {
    const wide = await p.evaluate(() => {
      const w = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= w) return [];
      return [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > w + 0.5 && !e.closest('.table-wrap, .collectors__tabs, .collectors__periods, .collectors__scope'))
        .slice(0, 8)
        .map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).replace(/ /g, '.')} ${Math.round(e.getBoundingClientRect().right)}`);
    });
    expect(wide).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-collectors-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...OPERATOR, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();

    const now = Date.now();
    const account = async (email: string, country: string | null, daysAgo: number) =>
      (await ctx.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused', country, created_at: new Date(now - daysAgo * DAY) }).returning('id').executeTakeFirstOrThrow()).id;
    const profile = async (id: string, c: Pick<Collector, 'birth' | 'city'>) => {
      if (!c.birth && !c.city) return;
      await ctx.db
        .insertInto('account_profiles')
        .values({ account_id: id, birth_date: c.birth, birth_date_by: c.birth ? 'COLLECTOR' : null, birth_date_at: c.birth ? new Date(now - 30 * DAY) : null, city: c.city })
        .execute();
    };
    const scoredAt = new Date(now - 2 * 3_600_000);
    for (const c of HOUSE) {
      const id = await account(c.email, c.country, c.daysAgo);
      ids[c.key] = id;
      c.id = id;
      await profile(id, c);
      if (c.place) {
        const place = (await ctx.services.places.idOf(c.place[0], c.place[1]))!;
        await ctx.db.insertInto('collector_places').values({ account_id: id, place_id: place, days: 3, first_day: parisDay(new Date(now - 9 * DAY)), last_day: parisDay(new Date(now - DAY)) }).execute();
      }
      if (c.score !== null) await seedScore(ctx.db, id, c.score, scoredAt);
    }
    await ctx.db.insertInto('engagement_runs').values({ day: parisDay(scoredAt), formula: 1, started_at: new Date(scoredAt.getTime() - 3_000), finished_at: scoredAt, accounts: 3, changed: 3, bands: [0, 0, 0, 0, 1, 1, 0, 1, 0, 0], duration_ms: 3_000 }).execute();
    // Left out of every figure: a test entrant and a team account (a console login's email), each with a profile and a score.
    const entrant = await account(`entrant-${randomUUID()}@orbes.test`, 'FR', 4);
    await ctx.db.insertInto('test_entrants').values({ account_id: entrant }).execute();
    await profile(entrant, { birth: '1990-01-01', city: 'Lyon' });
    await seedScore(ctx.db, entrant, 90, scoredAt);
    const team = await account(OPERATOR.email, 'FR', 4);
    await profile(team, { birth: '1990-01-01', city: 'Lyon' });
    await seedScore(ctx.db, team, 90, scoredAt);

    // What they like, their devices and where they came from (step 9.10): a model and its Blue dot in ORBITAL, two wishes,
    // favourite pieces and finishes, a piece held, devices with their views, a first source; the recording 40 days old.
    const started = new Date(now - 40 * DAY);
    await ctx.db.updateTable('tracking_state').set({ started_at: started }).execute();
    await ctx.db.updateTable('acquisition_state').set({ tracking_started_at: started, conversions_until: started }).execute();
    const world = await new GrowthWorld(ctx.db).prepare();
    const orbital = (await ctx.db.insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;
    models.mono = await world.model('MONOLITHE', { collectionId: orbital, label: 'Silver', swatch: '#C0C0C0' });
    models.blue = await world.model('MONOLITHE', { variantOf: models.mono, label: 'Blue', swatch: '#1F3A93', collectionId: orbital });
    await ctx.db
      .insertInto('account_wishes')
      .values([
        { account_id: ids.a!, model_id: models.blue, added_at: new Date(now - 2 * DAY) },
        { account_id: ids.b!, model_id: models.mono, added_at: new Date(now - 4 * DAY) },
        { account_id: entrant, model_id: models.mono, added_at: new Date(now - 4 * DAY) },
      ])
      .execute();
    await ctx.db
      .insertInto('account_tastes')
      .values([
        { account_id: ids.a!, kind: 'PIECE', value_key: 'RING', label: 'Ring', created_at: new Date(now - 2 * DAY) },
        { account_id: ids.b!, kind: 'PIECE', value_key: 'RING', label: 'Ring', created_at: new Date(now - 4 * DAY) },
        { account_id: ids.a!, kind: 'FINISH', value_key: 'BLUE', label: 'Blue', created_at: new Date(now - 2 * DAY) },
      ])
      .execute();
    const piece = await world.piece(models.blue);
    await world.own(ids.a!, piece, 'FIRST_REGISTRATION', parisDay(new Date(now - 3 * DAY)));
    const paris = (await ctx.services.places.idOf('FR', 'Paris'))!;
    const device = async (account: string, kind: 'PHONE' | 'COMPUTER', os: 'IOS' | 'MACOS', browser: 'SAFARI' | 'CHROME') => {
      const id = (
        await ctx.db
          .insertInto('tracking_devices')
          .values({ device_hash: `e2e${account.replace(/-/g, '')}`.slice(0, 43).padEnd(43, 'x'), kind, os, browser, opened_in: 'BROWSER', in_app: null, account_id: account, linked_at: new Date(now - 3 * DAY), first_seen_at: new Date(now - 3 * DAY), last_seen_at: new Date(now - DAY) })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await ctx.db.insertInto('tracking_device_accounts').values({ device_id: id, account_id: account, first_via: 'SIGN_UP', first_linked_at: new Date(now - 3 * DAY), last_linked_at: new Date(now - 3 * DAY) }).execute();
      await ctx.db
        .insertInto('collector_views')
        .values([
          { at: new Date(now - 2 * DAY), device_id: id, account_id: account, page: 10, subject: models.mono, seconds: 40, place_id: paris },
          { at: new Date(now - DAY), device_id: id, account_id: account, page: 10, subject: models.blue, seconds: 20, place_id: paris },
        ])
        .execute();
    };
    await device(ids.a!, 'PHONE', 'IOS', 'SAFARI');
    await device(ids.b!, 'COMPUTER', 'MACOS', 'CHROME');
    const site = (await ctx.db.insertInto('acquisition_sources').values({ kind: 'SITE', site: 'instagram.com', key: 'S:instagram.com' }).returning('id').executeTakeFirstOrThrow()).id;
    await ctx.db.insertInto('account_sources').values({ account_id: ids.a!, first_source_id: site, first_seen_at: new Date(now - 3 * DAY - 3_600_000), set_at: new Date(now - 3 * DAY), set_by: 'SIGN_UP' }).execute();

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
    'reads At a glance and Who they are under the controls, every figure a link to its collectors, the view in words (step 9.9)',
    async () => {
      const p = await open(ADMIN);
      await p.click('.side__link[data-route=collectors]');
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Collectors');
      await loaded(p, 'overview');
      await loaded(p, 'who');
      expect(await p.locator('main section.collectors__panel .panel__title').allTextContents()).toEqual(expect.arrayContaining(['At a glance', 'Who they are']));
      // The controls, the defaults marked.
      expect(await p.locator('[data-testid=collectors-period-30d]').getAttribute('aria-current')).toBe('page');
      expect(await p.locator('.collectors__periods .range__tab').allInnerTexts()).toEqual(['LAST 7 DAYS', 'LAST 30 DAYS', 'LAST 90 DAYS', 'LAST 12 MONTHS', 'CUSTOM']);
      expect(await p.locator('[data-testid=collectors-scope-all]').getAttribute('aria-current')).toBe('page');
      expect(await p.locator('[data-testid=collectors-compare] input').isChecked()).toBe(true);
      expect(await text(p, '[data-testid=collectors-words]')).toMatch(/^All collectors\. Last 30 days, \d{2} [A-Z]{3}( \d{4})? to \d{2} [A-Z]{3} \d{4}, compared with .+\.$/);
      expect(await text(p, '[data-testid=collectors-read-at]')).toMatch(/^Read at \d{2}:\d{2}$/);

      // At a glance: six collectors (the test entrant and the team account left out), five new in 30 days.
      expect(await kpis(p)).toEqual(['Collectors: 6', 'New collectors: 5', 'First visits: 0', 'Active: 2', 'Median score: 54', 'Wishes added: 2']);
      const collectors = p.locator('[data-testid=collectors-kpis] .kpi[data-key=collectors] a');
      expect(await collectors.getAttribute('aria-label')).toBe('Open the 6 collectors of this view');
      expect(await p.locator('[data-testid=collectors-kpis] .kpi[data-key=newCollectors] .collectors__change').textContent()).toBe('new');
      expect(await p.locator('[data-testid=collectors-kpis] .kpi[data-key=firstVisits] a').getAttribute('aria-label')).toBe('Open the 1 collector whose first visit fell in the period');
      expect(await p.locator('[data-testid=collectors-kpis] .kpi[data-key=active] a').getAttribute('aria-label')).toBe('Open the 2 collectors active in the period');

      // Who they are: AGES in their order, then COUNTRIES and CITIES, as given and from the connection.
      expect(await bars(p, 'collectors-ages')).toEqual(['Under 18 0', '18–24 0', '25–34 2', '35–44 1', '45–54 0', '55–64 0', '65 and over 0', 'Not given 3']);
      expect(await text(p, '[data-testid=collectors-ages-note]')).toBe('Age today, from the date of birth the client entered. Median: 31.');
      expect(await p.locator('[data-testid=collectors-ages] .bar[data-key="25-34"] a').getAttribute('aria-label')).toBe('Open the 2 collectors aged 25–34');
      await p.click('[data-testid=collectors-who-tabs] [data-key=countries]');
      expect(await bars(p, 'collectors-countries')).toEqual(['FR · France 3', 'GB · United Kingdom 1', 'IT · Italy 1', 'Not given 1']);
      expect(await p.locator('[data-testid=collectors-countries] .bar[data-key=FR] a').getAttribute('aria-label')).toBe('Open the 3 collectors in France');
      // With the scope ALL, each row compares what is new in each period.
      expect(await text(p, '[data-testid=collectors-countries] .bar[data-key=FR] .collectors__change')).toBe('+3 new');
      expect(await text(p, '[data-testid=collectors-countries] .bar[data-key=FR] .collectors__before')).toBe('0 before');
      await p.click('[data-testid=collectors-who-side] [data-key=connection]');
      expect(await bars(p, 'collectors-countries')).toEqual(['FR · France 2', 'IT · Italy 1', 'Unknown 3']);
      await p.click('[data-testid=collectors-who-tabs] [data-key=cities]');
      await p.click('[data-testid=collectors-who-side] [data-key=given]');
      expect(await bars(p, 'collectors-cities')).toEqual(['Lyon 2', 'London 1', 'Milano 1', 'Not given 2']);
      expect(await p.locator('[data-testid=collectors-cities] .bar[data-key=lyon] a').getAttribute('aria-label')).toBe('Open the 2 collectors in Lyon');
      await p.click('[data-testid=collectors-who-side] [data-key=connection]');
      expect(await bars(p, 'collectors-cities')).toEqual(['Paris · France 1', 'Lyon · France 1', 'Milan · Italy 1', 'Unknown 3']);
      expect(await p.locator('[data-testid=collectors-dbip]').count()).toBe(1);
      await shot(p, 'desk');
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'keeps every control in the address: the period, CUSTOM refused then applied, Compare, the scope, a filter and Clear filters (step 9.9)',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/collectors');
      await act(p, () => p.click('[data-testid=collectors-period-7d]'), '#/collectors?p=7d');
      expect(await text(p, '[data-testid=collectors-words]')).toMatch(/^All collectors\. Last 7 days, /);
      expect(await kpis(p)).toEqual(['Collectors: 6', 'New collectors: 3', 'First visits: 0', 'Active: 2', 'Median score: 54', 'Wishes added: 2']);

      // CUSTOM: dates out of bounds are refused under them, then two good days are applied.
      await act(p, () => p.click('[data-testid=collectors-period-custom]'), /^#\/collectors\?p=custom&from=/);
      const custom = p.locator('[data-testid=collectors-custom]');
      await custom.locator('input[name=from]').fill('2025-12-01');
      await custom.locator('button[type=submit]').click();
      expect(await text(p, '[data-testid=collectors-custom] .collectors__problem')).toBe('Choose dates from 1 Jan 2026 to today, at most two years apart.');
      await custom.locator('input[name=from]').fill('2026-01-01');
      await act(p, () => custom.locator('button[type=submit]').click(), /^#\/collectors\?p=custom&from=2026-01-01&to=\d{4}-\d{2}-\d{2}$/);
      expect(await text(p, '[data-testid=collectors-words]')).toMatch(/^All collectors\. From 01 JAN( 2026)? to /);

      // Compare off, then the scope NEW IN THE PERIOD, then a country, then Clear filters.
      await go(p, '#/collectors');
      await act(p, () => p.click('[data-testid=collectors-compare] .ccheck__mark'), '#/collectors?cmp=0');
      expect(await p.locator('[data-testid=collectors-kpis] .collectors__change').count()).toBe(0);
      expect(await text(p, '[data-testid=collectors-words]')).toMatch(/\d{4}\.$/);
      await act(p, () => p.click('[data-testid=collectors-scope-new]'), '#/collectors?cmp=0&scope=new');
      expect((await kpis(p))[0]).toBe('Collectors: 5');
      await p.click('[data-testid=collectors-country] summary');
      await act(p, () => p.locator('[data-testid=collectors-country] label', { hasText: 'FR · France' }).click(), '#/collectors?cmp=0&scope=new&c=FR');
      expect((await kpis(p))[0]).toBe('Collectors: 3');
      expect(await text(p, '[data-testid=collectors-words]')).toMatch(/^Collectors new in the period in France\. Last 30 days, /);
      expect(await p.locator('[data-testid=collectors-country] summary').textContent()).toBe('Country · 1');
      await act(p, () => p.click('[data-testid=collectors-clear]'), '#/collectors?cmp=0&scope=new');
      // A view of no collector: each panel says so, with Clear filters.
      await go(p, '#/collectors?sc=95-100');
      expect(await text(p, '[data-testid=collectors-panel-who] [data-testid=collectors-no-match] .empty__text')).toBe('No collector matches these filters.');
      expect(await text(p, '[data-testid=collectors-panel-who] [data-testid=collectors-no-match] .cbtn')).toBe('Clear filters');
      // Read again reads every panel again.
      await go(p, '#/collectors');
      await p.click('[data-testid=collectors-read-again]');
      await loaded(p, 'overview');
      expect((await kpis(p))[0]).toBe('Collectors: 6');
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'ticks two countries in a row from the open list, the list (and at 375 px the sheet) kept open, the page in place (step 9.9)',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/collectors');
      await p.evaluate(() => window.scrollTo(0, 40));
      await p.click('[data-testid=collectors-country] summary');
      const y = await p.evaluate(() => window.scrollY);
      expect(y).toBeGreaterThan(0);
      await act(p, () => p.locator('[data-testid=collectors-country] label', { hasText: 'FR · France' }).click(), '#/collectors?c=FR');
      expect(await p.locator('[data-testid=collectors-country]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
      expect(await p.evaluate(() => window.scrollY)).toBe(y);
      await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe('collectors-country-FR');
      await act(p, () => p.locator('[data-testid=collectors-country] label', { hasText: 'IT · Italy' }).click(), '#/collectors?c=FR,IT');
      expect(await p.locator('[data-testid=collectors-country]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
      expect(await p.locator('[data-testid=collectors-country] summary').textContent()).toBe('Country · 2');
      expect((await kpis(p))[0]).toBe('Collectors: 4');
      await p.context().close();

      const phone = await open(ADMIN, 375);
      await go(phone, '#/collectors');
      const fold = phone.locator('[data-testid=collectors-filters-fold]');
      expect(await fold.getAttribute('aria-expanded')).toBe('false');
      await fold.click();
      expect(await fold.getAttribute('aria-expanded')).toBe('true');
      await phone.click('[data-testid=collectors-country] summary');
      await act(phone, () => phone.locator('[data-testid=collectors-country] label', { hasText: 'FR · France' }).click(), '#/collectors?c=FR');
      expect(await phone.locator('[data-testid=collectors-filters]').isVisible()).toBe(true);
      expect(await phone.locator('[data-testid=collectors-filters-fold]').getAttribute('aria-expanded')).toBe('true');
      expect(await text(phone, '[data-testid=collectors-filters-fold]')).toBe('Filters (1)');
      await act(phone, () => phone.locator('[data-testid=collectors-country] label', { hasText: 'IT · Italy' }).click(), '#/collectors?c=FR,IT');
      expect(await phone.locator('[data-testid=collectors-filters]').isVisible()).toBe(true);
      expect(await phone.locator('[data-testid=collectors-country] summary').textContent()).toBe('Country · 2');
      await phone.click('[data-testid=collectors-filters-done]');
      expect(await phone.locator('[data-testid=collectors-filters]').isVisible()).toBe(false);
      expect(await phone.locator('[data-testid=collectors-filters-fold]').getAttribute('aria-expanded')).toBe('false');
      await phone.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'lays the page out at 375 px: the KPIs two by two, the filters folded into « Filters (1) » and opened as a sheet, no sideways scroll; an AUDITOR’s cities open nothing (step 9.9)',
    async () => {
      const phone = await open(ADMIN, 375);
      await go(phone, '#/collectors?c=FR');
      await fits(phone);
      expect(await phone.locator('[data-testid=collectors-filters]').isVisible()).toBe(false);
      expect(await text(phone, '[data-testid=collectors-filters-fold]')).toBe('Filters (1)');
      expect(await phone.evaluate(() => getComputedStyle(document.querySelector('[data-testid=collectors-kpis]')!).gridTemplateColumns.split(' ').length)).toBe(2);
      await shot(phone, 'phone');
      await phone.click('[data-testid=collectors-filters-fold]');
      expect(await phone.locator('[data-testid=collectors-filters]').isVisible()).toBe(true);
      expect(await phone.evaluate(() => getComputedStyle(document.querySelector('[data-testid=collectors-filters]')!).position)).toBe('fixed');
      await shot(phone, 'phone-filters');
      await phone.click('[data-testid=collectors-filters-done]');
      expect(await phone.locator('[data-testid=collectors-filters]').isVisible()).toBe(false);
      await phone.click('[data-testid=collectors-who-tabs] [data-key=cities]');
      await fits(phone);
      await phone.context().close();

      const auditor = await open(AUDITOR);
      await go(auditor, '#/collectors');
      await auditor.click('[data-testid=collectors-who-tabs] [data-key=countries]');
      expect(await auditor.locator('[data-testid=collectors-countries] a').count()).toBe(4);
      await auditor.click('[data-testid=collectors-who-tabs] [data-key=cities]');
      expect(await bars(auditor, 'collectors-cities')).toEqual(['Lyon 2', 'London 1', 'Milano 1', 'Not given 2']);
      expect(await auditor.locator('[data-testid=collectors-cities] a').count()).toBe(0);
      expect(await text(auditor, '[data-testid=collectors-panel-who] .growth__line')).toBe('An AUDITOR does not open the collectors of a city.');
      await auditor.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'draws Where they come from, What they like, Devices, Engagement and Over time, each tab, every figure of collectors a link (step 9.10)',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/collectors');
      await allLoaded(p);
      expect(await p.locator('main section.collectors__panel > .panel__head .panel__title').allTextContents()).toEqual(['At a glance', 'Who they are', 'Where they come from', 'What they like', 'Devices', 'Engagement', 'Over time']);

      // Where they come from: A came first from instagram.com, the others before the recording or directly.
      const origin = '[data-testid=collectors-panel-origin]';
      expect(await p.locator(`${origin} [data-testid=collectors-origin-tabs] .range__tab`).allTextContents()).toEqual(['SOURCES', 'HOW THEY HEARD', 'LINKS', 'CAMPAIGNS', 'REFERRING SITES', 'FIRST VISITS']);
      const sources = await bars(p, 'collectors-sources');
      expect(sources).toEqual(expect.arrayContaining(['Referring sites 1']));
      expect(await p.locator('[data-testid=collectors-sources] .bar[data-key="kind:SITE"] a').getAttribute('aria-label')).toBe('Open the 1 collector who first came from Referring sites');
      await p.click(`${origin} [data-key=heard]`);
      expect(await bars(p, 'collectors-heard')).toEqual(expect.arrayContaining(['Not answered 6']));
      await p.click(`${origin} [data-key=links]`);
      expect(await text(p, `${origin} .empty__text`)).toBe('No link has brought a collector in this view.');
      await p.click(`${origin} [data-key=campaigns]`);
      expect(await text(p, `${origin} .empty__text`)).toBe('No campaign tag in this view.');
      await p.click(`${origin} [data-key=sites]`);
      expect(await bars(p, 'collectors-sites')).toEqual(expect.arrayContaining(['instagram.com 1', 'Other sites 0']));
      expect(await p.locator('[data-testid=collectors-sites] .bar[data-key="site:instagram.com"] a').getAttribute('href')).toContain('slice=referrer%3Ainstagram.com');
      await p.click(`${origin} [data-key=visits]`);
      expect(await p.locator(`${origin} [data-testid=collectors-first-visits-chart] .collectors__col`).count()).toBe(30);
      expect(await text(p, `${origin} [data-testid=collectors-became]`)).toMatch(/^\d+ first visits? became collectors \(\d+%\)\.$/);

      // What they like: the Wishlists figures, then each tab; a most wished model's row opens who wishes for it.
      const likes = '[data-testid=collectors-panel-likes]';
      expect(await p.locator(`${likes} [data-testid=collectors-wishlists] .kpi__value`).allTextContents()).toEqual(['2', '2', '0']);
      expect(await p.locator(`${likes} [data-testid=collectors-wishlists] a`).getAttribute('aria-label')).toBe('Open the 2 collectors with a wishlist');
      expect(await p.locator(`${likes} [data-testid=collectors-likes-tabs] .range__tab`).allTextContents()).toEqual(['FAVOURITE PIECES', 'FINISHES', 'MOST WISHED', 'MOST VIEWED', 'PIECES HELD']);
      expect(await rowsOf(p, likes)).toEqual(['1 | MONOLITHE · Silver (hidden) | RING | ORBITAL | 2 | 2 | +2 | ', ' | MONOLITHE · Blue (hidden) | RING | ORBITAL | 1 | 1 | +1 | ']);
      // Each row ends with a bar (§3.2 W.8), filled as its Wished is to the most wished.
      expect(await p.locator(`${likes} tbody tr .collectors__cell-bar .bar__fill`).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue('--f')))).toEqual(['1', '0.5']);
      const wished = p.locator(`${likes} tbody tr`).first().locator('a');
      expect(await wished.getAttribute('aria-label')).toBe('Open the 2 collectors who wish for MONOLITHE · Silver');
      expect(decodeURIComponent((await wished.getAttribute('href'))!)).toContain(`slice=wishmodel:${models.mono}`);
      expect(await p.locator(`${likes} .growth__line`).allTextContents()).toEqual(['Each row opens the collectors who wish for it.', 'No count is shown on the model’s sheet.']);
      await p.click(`${likes} [data-testid=collectors-wished-side] [data-key=collections]`);
      expect(await rowsOf(p, likes)).toEqual(['ORBITAL | 2 | +2']);
      expect(await p.locator(`${likes} tbody a`).getAttribute('aria-label')).toBe('Open the 2 collectors who wish for a model of ORBITAL');
      await p.click(`${likes} [data-testid=collectors-likes-tabs] [data-key=pieces]`);
      expect(await rowsOf(p, likes)).toEqual(['Ring (no longer in the collection) | 2 | 2 | +2', 'None chosen | 4 |  | ']);
      await p.click(`${likes} [data-testid=collectors-likes-tabs] [data-key=finishes]`);
      expect(await rowsOf(p, likes)).toEqual(['Blue (no longer in the collection) | 1 | 1 | +1', 'None chosen | 5 |  | ']);
      await p.click(`${likes} [data-testid=collectors-likes-tabs] [data-key=viewed]`);
      expect(await rowsOf(p, likes)).toEqual(['MONOLITHE · Silver | 2 | 4 | 2 min | Fewer than 3 collectors', 'MONOLITHE · Blue | 2 | 2 | 40 s | Fewer than 3 collectors']);
      await p.click(`${likes} [data-testid=collectors-viewed-who] [data-key=visitors]`);
      // Every visitor's figures come from the daily totals, not counted yet for these days.
      expect(await text(p, `${likes} .empty__text`)).toBe('No model looked at in this period.');
      await p.click(`${likes} [data-testid=collectors-likes-tabs] [data-key=held]`);
      expect(await rowsOf(p, likes)).toEqual(['MONOLITHE · Silver | 1 | 1', 'MONOLITHE · Blue | 1 | 1']);

      // Devices: each collector under the device used most; only BY COLLECTORS opens collectors.
      const devices = '[data-testid=collectors-panel-devices]';
      expect(await bars(p, 'collectors-devices-device')).toEqual(['Phone 1', 'Tablet 0', 'Computer 1']);
      expect(await p.locator('[data-testid=collectors-devices-system] .bar[data-key=IOS] a').getAttribute('aria-label')).toBe('Open the 1 collector whose main system is iPhone');
      expect(await bars(p, 'collectors-devices-browsers')).toEqual(['Chrome 1', 'Safari 1']);
      // At 1,440 px, compared: the three lists side by side, each row's bar drawn and its comparison inside its own column.
      const outside = await p.evaluate(() => {
        const lists = document.querySelector('[data-testid=collectors-panel-devices] .collectors__lists')!;
        const rows = [...lists.querySelectorAll('[data-testid^=collectors-devices-] .bar')];
        const bad = rows.flatMap((row) => {
          const column = row.closest('.collectors__lists > div')!.getBoundingClientRect();
          const cmp = row.querySelector('.collectors__cmp')!.getBoundingClientRect();
          const track = row.querySelector('.bar__track')!.getBoundingClientRect();
          const key = (row as HTMLElement).dataset.key;
          return [cmp.right > column.right + 0.5 ? `${key} cmp ${Math.round(cmp.right)} > ${Math.round(column.right)}` : null, track.width > 0 ? null : `${key} track 0`].filter((x) => x !== null);
        });
        return { columns: getComputedStyle(lists).gridTemplateColumns.split(' ').length, compared: lists.querySelectorAll('.collectors__bars--cmp').length, rows: rows.length, bad };
      });
      expect(outside).toMatchObject({ columns: 3, compared: 4, bad: [] });
      expect(outside.rows).toBeGreaterThan(0);
      await p.click(`${devices} [data-key=byVisits]`);
      expect(await p.locator(`${devices} [data-testid=collectors-devices-device] a`).count()).toBe(0);
      await p.click(`${devices} [data-key=allDevices]`);
      expect(await p.locator(`${devices} .collectors__tab-body .growth__line`).first().textContent()).toBe('Every device seen, anonymous included: only the country filter applies.');

      // Engagement: the spread of this morning's scores, the five parts, active and dormant, the cohorts.
      expect(await bars(p, 'collectors-spread')).toEqual(['0–9 0', '10–19 0', '20–29 0', '30–39 0', '40–49 1', '50–59 1', '60–69 0', '70–79 1', '80–89 0', '90–100 0', 'Not measured 3']);
      expect(await p.locator('[data-testid=collectors-spread] .bar[data-key="70-79"] a').getAttribute('aria-label')).toBe('Open the 1 collector with a score of 70–79');
      expect(await p.locator('[data-testid=collectors-parts] li').allTextContents()).toEqual(['Recency 25.0 / 25', 'Frequency 18.3 / 20', 'Spend 11.3 / 25', 'Release speed 0.7 / 10', 'Attendance 0.0 / 20']);
      expect(await p.locator('[data-testid=collectors-parts] a').first().getAttribute('aria-label')).toBe('Open the 3 collectors behind the average of Recency');
      expect(await bars(p, 'collectors-status')).toEqual(['Active 2', 'Dormant 0', 'Never active since sign-up 4']);
      expect(await p.locator('[data-testid=collectors-panel-engagement] tbody tr').count()).toBe(12);

      // Over time: the figure and the split, every point in the table a link.
      const trends = '[data-testid=collectors-panel-trends]';
      expect(await p.locator(`${trends} [data-testid=collectors-trend-chart] polyline`).count()).toBeGreaterThan(0);
      expect(await p.locator(`${trends} tbody tr`).count()).toBe(30);
      expect(await p.locator(`${trends} tbody tr`).last().locator('td').nth(1).textContent()).toBe('6');
      await p.locator(`${trends} [data-testid=collectors-trend-split]`).selectOption('country');
      await loaded(p, 'trends');
      await expect.poll(async () => (await p.locator(`${trends} [data-testid=collectors-trend-legend] li`).allTextContents()).sort()).toEqual(['FR · France', 'GB · United Kingdom', 'IT · Italy', 'Not given']);
      expect(await p.locator(`${trends} [data-testid=collectors-trend-legend] li`).first().textContent()).toBe('FR · France');
      const fr = p.locator(`${trends} tbody tr`).last().locator('td').nth(2).locator('a');
      expect(await fr.getAttribute('aria-label')).toMatch(/^Open the 3 collectors behind collectors in \d{2} [A-Z]{3} \d{4}, FR · France$/);
      expect(decodeURIComponent((await fr.getAttribute('href'))!)).toMatch(/slice=bucket:trend:collectors:\d{4}-\d{2}-\d{2}:FR&figure=collectors&split=country$/);
      await p.locator(`${trends} [data-testid=collectors-trend-figure]`).selectOption('medianscore');
      await loaded(p, 'trends');
      await expect.poll(() => p.locator(`${trends} thead th`).first().textContent()).toBe('Period');
      await shot(p, 'panels');
      await p.context().close();

      const phone = await open(ADMIN, 375);
      await go(phone, '#/collectors');
      await allLoaded(phone);
      for (const tab of ['links', 'campaigns', 'visits']) {
        await phone.click(`${origin} [data-key=${tab}]`);
        await fits(phone);
      }
      await phone.click(`${likes} [data-testid=collectors-likes-tabs] [data-key=viewed]`);
      await fits(phone);
      await shot(phone, 'panels-phone');
      await phone.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'opens a figure\'s collectors, ordered by email, back to the figures with the same view, a row to its client sheet; an AUDITOR reads emails masked and no city (step 9.11)',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/collectors?c=FR');
      const listed = async () => {
        await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).not.toBe('Collectors');
        await p.waitForSelector('[data-testid=collectors-list]');
      };
      const emails = () => p.locator('[data-testid=collectors-list-row]').allTextContents();

      // A KPI: the collectors of the view, France here.
      await p.click('[data-testid=collectors-kpis] .kpi[data-key=collectors] a');
      await listed();
      expect(await title(p).textContent()).toBe('The collectors of this view');
      expect(await p.locator('.page-head__eyebrow').textContent()).toBe('Collectors');
      expect(await text(p, '.page-head__lead')).toMatch(/^Collectors in France\. Last 30 days, /);
      expect(await emails()).toEqual(['a.collector@example.com', 'b.collector@example.com', 'e.collector@example.com']);
      expect(await p.locator('[data-testid=collectors-list] thead th').allTextContents()).toEqual(['Email', 'Name', 'Country', 'City', 'Tier', 'Joined', 'Last seen']);
      expect(await rowsOf(p, '[data-testid=collectors-list]')).toEqual([
        expect.stringMatching(/^a\.collector@example\.com \| — \| FR · France \| Lyon \| TITANE \| \d{2} [A-Z]{3} \d{4} \| \d{2} [A-Z]{3} \d{4} · \d{2}:\d{2} Paris$/),
        expect.stringMatching(/^b\.collector@example\.com \| — \| FR · France \| lyon \| — \| /),
        expect.stringMatching(/^e\.collector@example\.com \| — \| FR · France \| — \| — \| \d{2} [A-Z]{3} \d{4} \| —$/),
      ]);
      expect(await text(p, '.pager__range')).toBe('1–3 of 3');
      expect(await text(p, '[data-testid=collectors-list-note]')).toBe('Read now: a figure read a few minutes ago may differ by a few.');
      await shot(p, 'list');
      // Back to the figures: the same view.
      await mark(p);
      await p.click('[data-testid=collectors-list-back]');
      await settled(p, '#/collectors?c=FR');

      // A country's bar, then a most wished model's row (question 16), then a row to the client sheet.
      await p.click('[data-testid=collectors-who-tabs] [data-key=countries]');
      await p.click('[data-testid=collectors-countries] .bar[data-key=FR] a');
      await listed();
      expect(await title(p).textContent()).toBe('Country: France');
      expect(await emails()).toEqual(['a.collector@example.com', 'b.collector@example.com', 'e.collector@example.com']);
      await go(p, '#/collectors');
      await loaded(p, 'likes');
      await p.locator('[data-testid=collectors-panel-likes] tbody tr').first().locator('a').click();
      await listed();
      expect(await title(p).textContent()).toMatch(/^Wish for MONOLITHE · Silver on \d{2} [A-Z]{3} \d{4}$/);
      expect(await emails()).toEqual(['a.collector@example.com', 'b.collector@example.com']);
      await p.locator('[data-testid=collectors-list-row]', { hasText: 'b.collector@example.com' }).click();
      await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('b.collector@example.com');
      expect(await hashOf(p)).toBe(`#/owners/${ids.b}`);
      await p.context().close();

      // An AUDITOR: the emails masked, no City column; a figure of no collector says so.
      const a = await open(AUDITOR);
      await a.evaluate(() => (location.hash = '#/collectors/list?slice=country:FR'));
      await a.waitForSelector('[data-testid=collectors-list]');
      expect(await a.locator('[data-testid=collectors-list] thead th').allTextContents()).toEqual(['Email', 'Name', 'Country', 'Tier', 'Joined', 'Last seen']);
      const masked = await a.locator('[data-testid=collectors-list-row]').allTextContents();
      expect(masked).toHaveLength(3);
      for (const e of masked) expect(e).not.toMatch(/^[abe]\.collector@example\.com$/);
      await a.evaluate(() => (location.hash = '#/collectors/list?slice=score:90-100'));
      await expect.poll(() => a.locator('[data-testid=collectors-list] .empty__text').textContent().catch(() => null), { timeout: 15_000 }).toBe('No collector in this figure now.');
      await a.setViewportSize({ width: 375, height: 812 });
      await a.evaluate(() => (location.hash = '#/collectors/list?slice=all'));
      await a.waitForSelector('[data-testid=collectors-list-row]');
      await fits(a);
      await a.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'exports the collectors of the page\'s five filters for an ADMIN: the dialog counts them, the file downloads, a toast counts its rows; no button for an OPERATOR nor an AUDITOR (step 9.12)',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/collectors?c=FR&scope=new&p=7d');
      await p.click('[data-testid=collectors-export]');
      await p.waitForSelector('dialog.dialog[open]');
      expect(await text(p, 'dialog.dialog .dialog__title')).toBe('Export the collectors');
      // The five filters only: France's three collectors, whatever the period and the scope.
      expect(await text(p, '[data-testid=collectors-export-body]')).toBe(
        'One row per collector, with everything held: profile, tastes, wishlist, where they came from, devices, places, the score and its parts, and what they looked at. Only the five filters of the page apply: 3 collectors. The file is made now and is not kept on the server. The export is recorded in the audit log.',
      );
      await shot(p, 'export');
      const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=dialog-confirm]')]);
      expect(download.suggestedFilename()).toBe(`orbes-collectors-${parisDay(new Date())}.csv`);
      const csv = readFileSync((await download.path())!, 'utf8');
      const lines = csv.split('\r\n').filter((l) => l !== '');
      expect(lines).toHaveLength(4);
      expect(lines[0]!.split('","')).toHaveLength(76);
      for (const k of ['a', 'b', 'e']) expect(csv).toContain(`"${HOUSE.find((c) => c.key === k)!.email}"`);
      expect(csv).not.toContain(OPERATOR.email);
      expect(csv).not.toContain('@orbes.test');
      await expect.poll(() => p.locator('.toast__text').last().textContent(), { timeout: 15_000 }).toBe('Exported 3 collectors.');
      expect(await p.locator('dialog.dialog[open]').count()).toBe(0);
      const audited = await ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'collectors.export').execute();
      expect(audited).toHaveLength(1);
      await p.context().close();

      for (const who of [OPERATOR, AUDITOR]) {
        const o = await open(who);
        await go(o, '#/collectors');
        await o.waitForSelector('[data-testid=collectors-read-again]');
        expect(await o.locator('[data-testid=collectors-export]').count(), who.email).toBe(0);
        await o.context().close();
      }
    },
    STEP_TIMEOUT,
  );
});
