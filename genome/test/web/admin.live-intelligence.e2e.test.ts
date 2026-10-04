/**
 * The intelligence of the LIVE RELEASES in the console, end to end (step L6): the production web build of the console
 * served by the real Fastify app (in-memory PGlite, a manual clock for the server, so a release's stages pass at once),
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. A draft: the release planner (its suggested quantity and size mix from the eligible collectors' sizes) and the
 *     audience forecast, each with how it is read; the comparison with a past release run before it.
 *  2. Its room open: the demand radar (ADD PIECES suggested, with what the quantity line promised) and the bot radar; an
 *     ADMIN removes a flagged entry in one tap.
 *  3. Live: the board's stream brings the live alerts (the line stalled while the engine stops; cleared once it runs) and
 *     the live sell-out forecast, per size.
 *  4. Ended: the release report (its funnel, its CSV downloaded) and the collector insights.
 *  5. An AUDITOR reads the same with the emails masked, and no REMOVE.
 * No CSP violation, no page error, no figure in the display face.
 */
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
import { liveNetworkHash } from '../../src/server/services/live.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const AUDITOR = { email: 'intel.auditor@orbes.test', password: 'intel auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 240_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

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

describe.skipIf(!HAS_CHROMIUM)('the intelligence of the LIVE RELEASES in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  const problems: string[] = [];

  async function open(who: { email: string; password: string }): Promise<Page> {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await p.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __csp: string[] }).__csp ??= [];
        (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
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
  const csp = (p: Page) => p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  const fig = (p: Page, id: string) => p.locator(`[data-testid=${id}] .kpi__value`);

  /** The release's page, read anew (from another page first, so a page already open is drawn again). */
  async function page(p: Page, id: string, heading: string): Promise<void> {
    await p.evaluate(() => (location.hash = '#/club?tab=drops'));
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('Club');
    await p.evaluate((h) => (location.hash = h), `#/club/live/${id}`);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
  }

  /** Visible text in Gravesend Sans holding a one or a zero (its one is its capital I): none should. */
  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-live-${name}.png`), fullPage: true });
  }

  let seq = 0;
  /** An ACTIVE account holding `pieces` rings of the model in `size`, created long ago unless said. */
  async function collector(pieces: number, size: string | null, createdAgoMs = 400 * 24 * HOUR) {
    const email = `intel.collector${++seq}@example.com`;
    const { account } = await ctx.services.auth.registerAccount({ email, password: 'intel collector passphrase 2026' }, {});
    await ctx.db.updateTable('accounts').set({ created_at: new Date(clock.now().getTime() - createdAgoMs) }).where('id', '=', account.id).execute();
    if (pieces) await holdPieces(ctx.db, account.id, pieces, f.modelId, { variant: size });
    return { id: account.id, email, actor: { type: 'account', id: account.id } as Actor };
  }

  async function secure(a: { id: string; actor: Actor }, dropId: string): Promise<void> {
    const e = await ctx.services.live.entry(a.id, dropId);
    await ctx.services.live.press(a.id, dropId, e!.turn!.token!);
    clock.advance(1500);
    await ctx.services.live.secure(a.id, dropId, e!.turn!.token!, a.actor);
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-intel-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    clock = createManualClock(new Date());
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true, clock: clock.now });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    f = await liveFixtureOn(ctx, clock);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    const row = await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow();
    admin = { type: 'admin', id: row.id };
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

  it('plans, forecasts, watches, alerts, reports and compares a release, each reading with how it is read', async () => {
    const people = [await collector(5, '52'), await collector(3, '52'), await collector(1, '54'), await collector(1, '52'), await collector(0, null)];

    // A past release, run and closed: the comparison's other column.
    const pastT0 = new Date(clock.now().getTime() + HOUR);
    const past = await createLiveRelease(f, { opensAt: pastT0, closesAt: new Date(pastT0.getTime() + HOUR), sizes: [{ label: '52', stock: 1 }] });
    clock.set(new Date(pastT0.getTime() - MINUTE));
    await ctx.services.live.enter(people[0]!.id, past.id, { sizeId: past.sizes[0]!.id }, people[0]!.actor);
    await ctx.services.live.enter(people[1]!.id, past.id, { sizeId: past.sizes[0]!.id }, people[1]!.actor);
    clock.set(pastT0);
    await ctx.services.live.advance(past.id);
    await secure(people[0]!, past.id);
    await ctx.services.live.confirm(people[0]!.id, past.id, people[0]!.actor);
    await ctx.services.live.advance(past.id);
    expect((await ctx.db.selectFrom('drops').select('ended_reason').where('id', '=', past.id).executeTakeFirstOrThrow()).ended_reason).toBe('SOLD_OUT');

    // 1. A draft: its planner and its forecast.
    const start = clock.now().getTime();
    const draft = await ctx.services.liveConsole.create(
      {
        modelId: f.modelId,
        title: 'THE VAULT RING',
        opensAt: new Date(start + 2 * HOUR),
        closesAt: new Date(start + 3 * HOUR),
        priceMinor: 480_000,
        turnSeconds: 10,
        sizes: [
          { label: '52', stock: 1 },
          { label: '54', stock: 1 },
        ],
        quantityLine: '2 PIECES · NEVER MORE',
      },
      admin,
    );
    const p = await open(ADMIN);
    await page(p, draft.id, 'THE VAULT RING');
    await expect.poll(() => p.locator('#live-plan').count()).toBe(1);
    // Every ACTIVE account may enter: the five collectors.
    expect(await fig(p, 'live-plan-eligible').textContent()).toBe('5');
    expect(await p.locator('[data-testid=live-plan-why] li').count()).toBeGreaterThan(1);
    expect(await p.locator('[data-testid=live-forecast-why] li').count()).toBeGreaterThan(1);
    await expect.poll(() => p.locator('[data-testid=live-forecast-capacity]').textContent()).toContain('WITHIN THE ROOM’S LIMIT');
    expect(await p.locator('#live-comparison tbody tr').count()).toBe(2);
    expect(await p.locator('#live-comparison tbody tr.is-current').textContent()).toContain('THE VAULT RING');
    expect(await p.locator('#live-radar, #live-bots, #live-report').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'intel-plan');

    // 2. Published; its room open: the radar and the bot radar. Three from one network; the last a new account.
    await ctx.services.liveConsole.publish(draft.id, {}, admin);
    const t0 = new Date(start + 2 * HOUR);
    clock.set(new Date(t0.getTime() - 2 * MINUTE));
    const fresh = await collector(0, null, 2 * HOUR);
    const entrants = [people[1]!, people[2]!, people[3]!, fresh];
    for (const [i, a] of entrants.entries()) {
      await ctx.services.live.enter(a.id, draft.id, { sizeId: draft.sizes[i % 2]!.id }, a.actor, { networkHash: liveNetworkHash(ctx.config.ipHashPepper, i < 3 ? `203.0.113.${i + 1}` : '198.51.100.4') });
    }
    await page(p, draft.id, 'THE VAULT RING');
    await expect.poll(() => p.locator('#live-radar').count()).toBe(1);
    expect(await fig(p, 'live-radar-people').textContent()).toBe('4');
    expect(await p.locator('[data-testid=live-radar-add]').allTextContents()).toEqual(['Add 1', 'Add 1']);
    expect(await p.locator('[data-testid=live-radar-promise]').textContent()).toContain('« 2 PIECES · NEVER MORE »');
    expect(await fig(p, 'live-bots-flagged').textContent()).toBe('4');
    expect(await p.locator('#live-bots tbody tr', { hasText: fresh.email }).textContent()).toContain('NEW ACCOUNT');
    expect(await p.locator('#live-plan').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'intel-radar');
    // One tap: the new account's entry is removed.
    await p.locator('#live-bots tbody tr', { hasText: fresh.email }).locator('[data-testid=live-bots-remove]').click();
    await expect.poll(async () => (await ctx.services.live.entry(fresh.id, draft.id))?.status).toBe('REMOVED');
    await expect.poll(() => p.locator('#live-bots tbody tr', { hasText: fresh.email }).locator('[data-testid=live-bots-remove]').count()).toBe(0);

    // 3. T0: a turn in each size; the engine then stops and the turns run out: the stream brings the alerts.
    clock.set(t0);
    await ctx.services.live.advance(draft.id);
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent(), { timeout: 15_000 }).toBe('LIVE');
    clock.set(new Date(t0.getTime() + 21 * SECOND));
    await expect.poll(() => p.locator('[data-testid=live-alerts] [data-testid=live-alert-line_stalled]').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('[data-testid=live-alert-line_stalled]').textContent()).toContain('LINE STALLED');
    expect(await p.locator('[data-testid=live-sellout-text]').textContent()).toBeTruthy();
    expect(await p.locator('[data-testid=live-size-sellout]').count()).toBe(2);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'intel-alerts');
    await ctx.services.live.advance(draft.id);
    await expect.poll(() => p.locator('[data-testid=live-alerts]').count(), { timeout: 15_000 }).toBe(0);

    // 4. One secures and pays; an ADMIN ends it: the report and the collectors.
    const turns = await ctx.db.selectFrom('live_entries').select('account_id').where('drop_id', '=', draft.id).where('status', '=', 'TURN').execute();
    const buyer = entrants.find((a) => a.id === turns[0]!.account_id)!;
    await secure(buyer, draft.id);
    await ctx.services.live.confirm(buyer.id, draft.id, buyer.actor);
    await ctx.services.live.end(draft.id, admin);
    await expect.poll(() => p.locator('#live-report').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('[data-testid=live-report-funnel] .bar').count()).toBe(6);
    expect(await fig(p, 'live-report-confirmed').textContent()).toBe('1');
    expect(await p.locator('[data-testid=live-report-why] li').count()).toBeGreaterThan(3);
    expect(await p.locator('[data-testid=live-report-no-addition]').textContent()).toContain('« 2 PIECES · NEVER MORE »');
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=live-report-csv]')]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^ORBES-live-${draft.id.slice(0, 8).toUpperCase()}-report-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    expect(readFileSync((await download.path())!, 'utf8')).toContain('"funnel","confirmed","1"');
    // Who came without a piece: the two whose turns ran out (a removed entry left out).
    await expect.poll(() => p.locator('#live-collectors [data-testid=live-collectors-account]').count()).toBe(2);
    expect(await p.locator('[data-testid=live-collectors-repeat]').textContent()).toMatch(/^1 · /);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'intel-report');
    expect(await csp(p)).toEqual([]);
    await p.context().close();

    // 5. An AUDITOR: the same readings, the emails masked, no REMOVE.
    const a = await open(AUDITOR);
    await page(a, draft.id, 'THE VAULT RING');
    await expect.poll(() => a.locator('#live-collectors [data-testid=live-collectors-account]').count()).toBe(2);
    for (const email of await a.locator('#live-collectors [data-testid=live-collectors-account], #live-bots [data-testid=live-bots-account]').allTextContents()) expect(email).toMatch(/^.\*\*\*@example\.com$/);
    expect(await a.locator('[data-testid=live-bots-remove]').count()).toBe(0);
    expect(await csp(a)).toEqual([]);
    await a.context().close();
  }, STEP_TIMEOUT);
});
