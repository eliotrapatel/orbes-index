/**
 * Test entrants and the server's status in the console, end to end (plan TEST ENTRANTS): the production web build of
 * the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider), its test
 * entrants acting through the app's own routes, driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. A draw open: the Server panel on the right of its page, its twelve rows read every 2 s; SEND TEST ENTRANTS (the
 *     dialog's total, the phrase) sends 12 test entrants, 8 TITANE and 4 PALLADIUM; the test's panel follows them,
 *     RUNNING then DONE, by tier, the release's entries real, test and in all; each entry of a test account carries
 *     TEST. Drawn, the test entrants holding a place are listed with CONFIRM; one is confirmed by hand. An AUDITOR
 *     reads it all, its emails masked, without a button. END TEST (the phrase): PAST TESTS keeps it, 5/5, its report
 *     with its five checks and its peaks.
 *  2. A LIVE RELEASE's room open: a test sent from its page; the Drops tab shows it running, wherever it is, and STOP
 *     halts it; the release's page then says STOPPED; a second test sent, the first one's END TEST under PAST TESTS
 *     still cleans it up, and the second ends from the top.
 *  3. Under 1 100 px the Server panel comes first, folded to its one line, which opens it.
 * No CSP violation, no page error, no figure in the display face.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { poolDraw, withDrawSizes } from '../support/draws.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const AUDITOR = { email: 'tests.auditor@orbes.test', password: 'tests auditor passphrase 2026' };
const STEP_TIMEOUT = 240_000;
const HOUR = 3_600_000;

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

describe.skipIf(!HAS_CHROMIUM)('test entrants and the server’s status in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let modelId: string;
  let admin: Actor;
  const problems: string[] = [];

  async function open(who: { email: string; password: string }, width = 1440): Promise<Page> {
    const c = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
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
  const text = async (p: Page, testId: string) => ((await p.locator(`[data-testid=${testId}]`).first().textContent()) ?? '').trim();

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
  }

  async function confirmDialog(p: Page, phrase?: string): Promise<void> {
    if (phrase) await p.fill('[data-testid=dialog-phrase]', phrase);
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 30_000 });
  }

  /** Visible text in Gravesend Sans holding a one or a zero (its one is its capital I): none should. */
  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-tests-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    const collection = await ctx.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    modelId = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, collection_id: collection.id, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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

  it('sends test entrants into a draw, follows them by tier, confirms one by hand, and ends the test with its report', async () => {
    const soon = Date.now() + HOUR;
    const drop = await poolDraw(ctx.services.drops, ctx.db, { modelId, title: 'MONOLITHE — release I', quantity: 20, opensAt: new Date(soon), closesAt: new Date(soon + 2 * HOUR), earlyAccessHours: 0 }, admin);
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - HOUR), closes_at: new Date(Date.now() + 2 * HOUR) }).where('id', '=', drop.id).execute();
    const real = await ctx.services.auth.registerAccount({ email: 'tests.collector@example.com', password: 'tests collector passphrase 2026' }, {});
    await ctx.services.drops.enter(real.account.id, drop.id, { type: 'account', id: real.account.id });
    const id8 = drop.id.slice(0, 8).toUpperCase();

    const p = await open(ADMIN);
    await go(p, `#/club/drops/${drop.id}`, 'MONOLITHE — release I');
    // The Server panel on the right: its twelve rows, read from the server.
    await p.waitForSelector('[data-testid=server-rows]');
    expect(await p.locator('[data-testid=server-rows] .sstatus__row').count()).toBe(12);
    const [main, aside] = await Promise.all([p.locator('.with-server__main').boundingBox(), p.locator('.with-server__aside').boundingBox()]);
    expect(aside!.x).toBeGreaterThan(main!.x + main!.width);
    expect(await p.locator('[data-testid=server-toggle]').isVisible()).toBe(false);
    expect(await text(p, 'test-start-line')).toContain('Entries are open');
    expect(await p.locator('[data-testid=test-past]').textContent()).toContain('No past test of this release.');

    // SEND TEST ENTRANTS: the defaults, the total said under the fields, the phrase.
    await p.click('[data-testid=test-send]');
    await p.waitForSelector('dialog.dialog');
    expect(await p.inputValue('dialog input[name="tier:titane"]')).toBe('100');
    expect(await p.inputValue('dialog input[name=confirmPct]')).toBe('70');
    expect(await p.locator('dialog input[name=payPct]').count()).toBe(0);
    await p.fill('dialog input[name="tier:titane"]', '8');
    await p.fill('dialog input[name="tier:palladium"]', '4');
    await p.fill('dialog input[name=seconds]', '2');
    // None confirms by itself: the one confirmed below is confirmed by hand.
    await p.fill('dialog input[name=confirmPct]', '0');
    await expect.poll(() => text(p, 'test-total')).toBe('12 test entrants in this press.');
    expect(await p.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await confirmDialog(p, `TEST ${id8}`);
    await expect.poll(() => text(p, 'test-status'), { timeout: 30_000 }).toBe('DONE');
    expect(await text(p, 'test-entrants-count')).toBe('12');
    expect(await text(p, 'test-settings')).toContain('8 TITANE + 4 PALLADIUM · a burst of 2 s · withdraw 0 % · reserve 0 % · confirm by themselves 0 %');
    expect((await p.locator('[data-testid=test-release] .kpi__value').allTextContents()).map((x) => x.trim())).toEqual(['1', '12', '13']);
    expect((await p.locator('[data-testid=test-tiers] tbody tr').last().locator('td').allTextContents()).map((x) => x.trim())).toEqual(['TOTAL', '12', '0', '0', '0', '0']);
    await p.reload();
    await expect.poll(() => p.locator('#entries [data-testid=test-tag]').count()).toBe(12);
    expect(await p.locator('#entries tbody tr', { hasText: 'tests.collector@example.com' }).locator('[data-testid=test-tag]').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);

    // Drawn: the test entrants holding a place, each with CONFIRM; one confirmed by hand.
    await ctx.db.updateTable('drops').set({ closes_at: new Date(Date.now() - 1000) }).where('id', '=', drop.id).execute();
    await ctx.services.drops.draw(drop.id, admin);
    await p.reload();
    await expect.poll(() => p.locator('[data-testid=test-selected] tbody tr').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const held = p.locator('[data-testid=test-selected] tbody tr', { has: p.locator('[data-testid=test-entrant-confirm]') }).first();
    const email = ((await held.locator('a').textContent()) ?? '').trim();
    expect(email).toMatch(/^test-\d{4,}@orbes\.test$/);
    await held.locator('[data-testid=test-entrant-confirm]').click();
    await confirmDialog(p);
    await expect.poll(async () => (await p.locator('[data-testid=test-selected] tbody tr', { hasText: email }).textContent()) ?? '', { timeout: 15_000 }).toContain('CONFIRMED');

    // An AUDITOR reads the test, the emails masked, without a button.
    const a = await open(AUDITOR);
    await go(a, `#/club/drops/${drop.id}`, 'MONOLITHE — release I');
    await a.waitForSelector('[data-testid=test-status]');
    expect(await a.locator('#test-entrants button').count()).toBe(0);
    expect(await a.locator('[data-testid=server-test-stop]').count()).toBe(0);
    expect((await a.locator('[data-testid=test-selected] tbody a').first().textContent())?.trim()).toMatch(/^t\*\*\*@orbes\.test$/);
    expect(await a.locator('#entries [data-testid=test-tag]').count()).toBeGreaterThan(0);
    await a.context().close();

    // END TEST: the phrase, then PAST TESTS with its report.
    await p.click('[data-testid=test-end]');
    await p.waitForSelector('dialog.dialog--danger');
    await confirmDialog(p, `END TEST ${id8}`);
    await expect.poll(() => p.locator('[data-testid=test-status]').count(), { timeout: 30_000 }).toBe(0);
    await expect.poll(() => text(p, 'test-past-checks')).toBe('5/5');
    await p.click('[data-testid=test-report]');
    await p.waitForSelector('dialog.dialog');
    expect(await p.locator('dialog [data-testid=test-report-check]').count()).toBe(5);
    expect(await p.locator('dialog [data-testid=test-report-check][data-pass=true]').count()).toBe(5);
    expect(await p.locator('dialog').textContent()).toContain('Peaks while it ran');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await p.click('[data-testid=dialog-cancel]');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('sends test entrants into a draw in sizes (plan NEXT LOT §3.6.F): Choices · size as for a LIVE RELEASE, each bot in the size chosen, the report 5/5', async () => {
    // Its sizes are its model's (§5.1 #20): MONOLITHE, of no type for its other releases here, given 16 and 17 for the draw.
    const drop = await withDrawSizes(ctx.db, modelId, ['16', '17'], async () => {
      const created = await ctx.services.drops.create(
        { modelId, title: 'MONOLITHE — release in sizes', sizes: [{ label: '16', pieces: 3 }, { label: '17', pieces: 2 }], opensAt: new Date(Date.now() + HOUR), closesAt: new Date(Date.now() + 2 * HOUR), earlyAccessHours: 0 },
        admin,
      );
      return ctx.services.drops.publish(created.id, admin);
    }, 'BRACELET');
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - HOUR), closes_at: new Date(Date.now() + 2 * HOUR) }).where('id', '=', drop.id).execute();
    const s17 = drop.sizes.find((z) => z.label === '17')!.id;
    const id8 = drop.id.slice(0, 8).toUpperCase();
    const p = await open(ADMIN);
    await go(p, `#/club/drops/${drop.id}`, 'MONOLITHE — release in sizes');
    await p.click('[data-testid=test-send]');
    await p.waitForSelector('dialog.dialog');
    // Choices · size: at random among the draw's sizes, or one of them; no pieces nor add-ons (a LIVE RELEASE's only).
    expect(await p.locator('dialog select[name=size] option').allTextContents()).toEqual(['At random among the release’s sizes', '16', '17']);
    expect(await p.locator('dialog [name=quantity]').count()).toBe(0);
    await p.selectOption('dialog select[name=size]', s17);
    await p.fill('dialog input[name="tier:titane"]', '4');
    await p.fill('dialog input[name=seconds]', '1');
    await p.fill('dialog input[name=confirmPct]', '0');
    await confirmDialog(p, `TEST ${id8}`);
    await expect.poll(() => text(p, 'test-status'), { timeout: 30_000 }).toBe('DONE');
    expect(await text(p, 'test-settings')).toContain('confirm by themselves 0 % · size 17 · seniority');
    await p.reload();
    await expect.poll(() => p.locator('#entries [data-testid=test-tag]').count()).toBe(4);
    expect(await p.locator('#entries [data-testid=entry-size]').allTextContents()).toEqual(['Size 17', 'Size 17', 'Size 17', 'Size 17']);
    // Drawn per size, then END TEST: the report 5/5.
    await ctx.db.updateTable('drops').set({ closes_at: new Date(Date.now() - 1000) }).where('id', '=', drop.id).execute();
    await ctx.services.drops.draw(drop.id, admin);
    await p.reload();
    await p.waitForSelector('[data-testid=test-end]');
    await p.click('[data-testid=test-end]');
    await p.waitForSelector('dialog.dialog--danger');
    await confirmDialog(p, `END TEST ${id8}`);
    await expect.poll(() => text(p, 'test-past-checks'), { timeout: 30_000 }).toBe('5/5');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('shows a LIVE RELEASE’s test running on the Drops tab, where STOP halts it; END TEST still cleans up', async () => {
    const r = await ctx.services.liveConsole.create({ modelId, title: 'THE VAULT RING', opensAt: new Date(Date.now() + 2 * HOUR), closesAt: new Date(Date.now() + 3 * HOUR), priceMinor: 480_000, sizes: [{ label: '52', stock: 3 }] }, admin);
    await ctx.services.liveConsole.publish(r.id, {}, admin);
    // The room open, T0 in two minutes: test entrants spread until then keep the test running.
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() + 120_000), closes_at: new Date(Date.now() + HOUR) }).where('id', '=', r.id).execute();
    const id8 = r.id.slice(0, 8).toUpperCase();

    const p = await open(ADMIN);
    await go(p, `#/club/live/${r.id}`, 'THE VAULT RING');
    await p.click('[data-testid=test-send]');
    await p.waitForSelector('dialog.dialog');
    expect(await p.locator('dialog input[name=payPct]').inputValue()).toBe('70');
    expect(await p.locator('dialog select[name=size] option').allTextContents()).toEqual(['At random among the release’s sizes', '52']);
    await p.fill('dialog input[name="tier:titane"]', '4');
    await p.selectOption('dialog select[name=arrival]', 'before');
    await confirmDialog(p, `TEST ${id8}`);
    await expect.poll(() => text(p, 'test-status'), { timeout: 15_000 }).toBe('RUNNING');

    const d = await open(ADMIN);
    await go(d, '#/club?tab=drops', 'Club');
    await expect.poll(() => text(d, 'server-test-release'), { timeout: 15_000 }).toBe('THE VAULT RING');
    expect(await text(d, 'server-test-entrants')).toBe('LIVE RELEASE · 4 test entrants');
    await d.click('[data-testid=server-test-stop]');
    await expect.poll(() => d.locator('[data-testid=server-test]').isHidden(), { timeout: 15_000 }).toBe(true);
    await d.context().close();

    await expect.poll(() => text(p, 'test-status'), { timeout: 15_000 }).toBe('STOPPED');
    expect(await p.locator('[data-testid=test-stop]').count()).toBe(0);
    expect(await p.locator('[data-testid=test-send]').count()).toBe(1);
    // A second test sent meanwhile: the STOPPED one goes under PAST TESTS with its END TEST, which still cleans it up.
    await p.click('[data-testid=test-send]');
    await p.waitForSelector('dialog.dialog');
    await p.fill('dialog input[name="tier:titane"]', '2');
    await p.selectOption('dialog select[name=arrival]', 'before');
    await confirmDialog(p, `TEST ${id8}`);
    await expect.poll(() => text(p, 'test-status'), { timeout: 15_000 }).toBe('RUNNING');
    // STOP keeps its focus while the test's figures change under it (read again every 2 s).
    await p.focus('[data-testid=test-stop]');
    const fan = await ctx.services.auth.registerAccount({ email: 'tests.fan@example.com', password: 'tests fan passphrase 2026' }, {});
    const size = await ctx.db.selectFrom('drop_sizes').select('id').where('drop_id', '=', r.id).executeTakeFirstOrThrow();
    await ctx.services.live.enter(fan.account.id, r.id, { sizeId: size.id }, { type: 'account', id: fan.account.id });
    await expect.poll(async () => (await p.locator('[data-testid=test-release] .kpi__value').first().textContent())?.trim(), { timeout: 15_000 }).toBe('1');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('test-stop');
    await expect.poll(() => p.locator('[data-testid=test-past-end]').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('[data-testid=test-past-checks]').allTextContents()).toEqual(['—']);
    await p.click('[data-testid=test-past-end]');
    await p.waitForSelector('dialog.dialog--danger');
    await confirmDialog(p, `END TEST ${id8}`);
    await expect.poll(() => text(p, 'test-past-checks'), { timeout: 30_000 }).toMatch(/^\d\/5$/);
    expect(await p.locator('[data-testid=test-past-end]').count()).toBe(0);
    expect(await text(p, 'test-status')).toBe('RUNNING');
    // The test sent since ends from the top.
    await p.click('[data-testid=test-end]');
    await confirmDialog(p, `END TEST ${id8}`);
    await expect.poll(async () => (await p.locator('[data-testid=test-past-checks]').allTextContents()).filter((x) => /^\d\/5$/.test(x)).length, { timeout: 30_000 }).toBe(2);
    expect(await p.locator('[data-testid=test-status]').count()).toBe(0);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('puts the Server panel first under 1 100 px, folded to its one line, which opens it', async () => {
    const p = await open(ADMIN, 1000);
    await go(p, '#/club?tab=drops', 'Club');
    await p.waitForSelector('[data-testid=server-rows]', { state: 'attached' });
    const [main, aside] = await Promise.all([p.locator('.with-server__main').boundingBox(), p.locator('.with-server__aside').boundingBox()]);
    expect(aside!.y).toBeLessThan(main!.y);
    expect(await p.locator('[data-testid=server-rows]').isVisible()).toBe(false);
    await expect.poll(() => text(p, 'server-summary')).toMatch(/UTC$/);
    await p.click('[data-testid=server-toggle]');
    expect(await p.locator('[data-testid=server-rows]').isVisible()).toBe(true);
    expect(await p.getAttribute('[data-testid=server-toggle]', 'aria-expanded')).toBe('true');
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await p.context().close();
  }, STEP_TIMEOUT);
});
