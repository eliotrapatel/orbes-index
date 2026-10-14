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
 *
 * Screens with ORBES_SCREENSHOTS=1 (genome/out/admin-collectors-*.png). No CSP violation, no page error.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

  async function open(who: { email: string; password: string }, width = 1440): Promise<Page> {
    const c = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
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
      expect(await kpis(p)).toEqual(['Collectors: 6', 'New collectors: 5', 'First visits: 0', 'Active: 0', 'Median score: 54', 'Wishes added: 0']);
      const collectors = p.locator('[data-testid=collectors-kpis] .kpi[data-key=collectors] a');
      expect(await collectors.getAttribute('aria-label')).toBe('Open the 6 collectors of this view');
      expect(await p.locator('[data-testid=collectors-kpis] .kpi[data-key=newCollectors] .collectors__change').textContent()).toBe('new');
      expect(await p.locator('[data-testid=collectors-kpis] .kpi[data-key=firstVisits] a').count()).toBe(0);

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
      expect(await kpis(p)).toEqual(['Collectors: 6', 'New collectors: 3', 'First visits: 0', 'Active: 0', 'Median score: 54', 'Wishes added: 0']);

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
});
