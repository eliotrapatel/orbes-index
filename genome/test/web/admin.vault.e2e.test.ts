/**
 * CLUB > THE VAULT, end to end (lot Q3, step Q3.12; plan §4; vault/SCOPE.md E12): the production web build of the console
 * served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider), driven in Chromium
 * (playwright-core). Lean (genome-ci's four shards):
 *
 *  1. The table: New reward adds a € 25 credit and a model to buy at its price; the odds' sum and I WAS THERE's published
 *     odds under it; a row whose odds would make the sum above one in one is refused in its words. The add-on picker
 *     lists no SERVICE add-on.
 *  2. A source's cap set (ADMIN): A NEW PIECE at most 3 per piece.
 *  3. GIVE A VAULT to a collector: the reach first, then GIVE; the report counts it, its CSV saved; the client sheet's
 *     THE VAULT block shows it, offers GIVE A VAULT and no REVOKE.
 *  4. A LIVE release's THE VAULT: Off by default, turned On.
 *  5. No sideways scroll at 1440 and 1024 px.
 * No CSP violation, no page error.
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
import { createManualClock, type Actor } from '../../src/server/types.js';
import { VAULT_COPY } from '../../src/web/admin/model/vault.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createLiveRelease, liveFixtureOn } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OUT_DIR = process.env.ORBES_SHOTS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
const POLL = { timeout: 15_000 };
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

describe.skipIf(!HAS_CHROMIUM)('CLUB > THE VAULT in the console (lot Q3, step Q3.12, E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let collectorId: string;
  let releaseId: string;
  let modelId: string;
  const COLLECTOR = 'vault.collector@example.com';
  const problems: string[] = [];

  async function open(width = 1440, height = 900): Promise<Page> {
    const c = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await p.goto(`${origin}/admin`);
    await p.waitForSelector('[data-testid=login-form]');
    await p.fill('input[name=email]', ADMIN.email);
    await p.fill('input[name=password]', ADMIN.password);
    await p.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const toast = (p: Page, text: string) => p.locator('.toast', { hasText: text }).first().waitFor({ timeout: 15_000 });
  const rowsText = (p: Page) => p.locator('[data-testid=vault-table] tbody tr').allInnerTexts();

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((x) => (location.hash = x), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
  }

  async function confirmed(p: Page): Promise<void> {
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  /**
   * The sideways overflow of the page and of every table under `scope`, in px: none expected. On the client sheet, only
   * its THE VAULT block (`page` false: the sheet's header actions were already past 1024 px before this step).
   */
  const sideways = (p: Page, scope = '[data-testid=vault-tab]', page = true) =>
    p.evaluate(
      ([sel, whole]) => {
        const block = document.querySelector<HTMLElement>(sel as string)!;
        return [
          whole ? document.documentElement.scrollWidth - document.documentElement.clientWidth : Math.round(block.getBoundingClientRect().right - document.documentElement.clientWidth),
          ...[...block.querySelectorAll<HTMLElement>('.table-wrap')].map((w) => w.scrollWidth - w.clientWidth),
        ].filter((x) => x > 1);
      },
      [scope, page] as const,
    );

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      await document.fonts.ready;
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-vault-${name}.png`), fullPage: true });
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-vault-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    const staffId = (await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow()).id;
    const staff: Actor = { type: 'admin', id: staffId };
    // A model sold (the fixture's MONOLITHE) and a LIVE release of it, published, its T0 ahead; a collector; an add-on
    // of each kind: the PRODUCT is offered as a reward, the SERVICE never.
    const f = await liveFixtureOn(ctx, createManualClock(new Date().toISOString()));
    modelId = f.modelId;
    releaseId = (await createLiveRelease(f, { opensAt: new Date(Date.now() + 6 * HOUR) })).id;
    collectorId = (await ctx.services.auth.registerAccount({ email: COLLECTOR, password: 'vault collector passphrase 2026' }, {})).account.id;
    await ctx.services.addons.create({ name: 'POLISHING CLOTH', skuCode: 'ADD-CLOTH', prices: { EUR: 1_500 } }, staff);
    await ctx.services.addons.create({ kind: 'SERVICE', name: 'GIFT WRAPPING', skuCode: 'ADD-WRAP', prices: { EUR: 500 } }, staff);
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
    'the table: a credit and a model added, the odds summed under it, a row above one in one refused, no SERVICE add-on offered; a source\'s cap',
    async () => {
      const p = await open();
      await go(p, '#/club?tab=vault', 'Club');
      await p.waitForSelector('[data-testid=vault-tab]');
      expect(await p.locator('[data-testid=club-tab-vault]').getAttribute('aria-current')).toBe('page');
      // Production's start (N15): the floor alone, at 1 IN 1.
      expect(await rowsText(p)).toHaveLength(1);
      expect(await p.locator('[data-testid=vault-row-odds]').first().textContent()).toBe('1 IN 1');
      await shot(p, 'floor-only');

      // € 25 of house credit at 1 IN 10, 100 of them.
      await p.click('[data-testid=vault-new-reward]');
      await p.selectOption('dialog select[name=kind]', 'CREDIT');
      await p.fill('dialog input[name=amount]', '25');
      await p.fill('dialog input[name=oddsIn]', '10');
      await p.fill('dialog input[name=quantity]', '100');
      await expect.poll(() => p.locator('[data-testid=vault-odds-preview]').textContent(), POLL).toBe('With it, the rewards hold 10.00 % of the draw; I WAS THERE 1 IN 1.');
      await p.click('[data-testid=dialog-confirm]');
      await confirmed(p);
      await toast(p, VAULT_COPY.added);

      // The product picker: the model sold; the add-on picker: the PRODUCT add-on, never the SERVICE.
      await p.click('[data-testid=vault-new-reward]');
      await p.selectOption('dialog select[name=kind]', 'PRODUCT');
      await p.selectOption('dialog select[name=productOf]', 'ADDON');
      const addons = await p.locator('dialog select[name=addonId] option').allTextContents();
      expect(addons).toEqual(['Choose an add-on', 'POLISHING CLOTH']);
      await p.selectOption('dialog select[name=productOf]', 'MODEL');
      await p.selectOption('dialog select[name=modelId]', modelId);
      await p.selectOption('dialog select[name=mode]', 'RIGHT_TO_BUY');
      await p.fill('dialog input[name=oddsIn]', '25');
      await p.fill('dialog input[name=quantity]', '40');
      await p.click('[data-testid=dialog-confirm]');
      await confirmed(p);
      await toast(p, VAULT_COPY.added);
      await expect.poll(() => rowsText(p).then((r) => r.length), POLL).toBe(3);
      expect((await p.locator('[data-testid=vault-row-what]').allTextContents()).map((x) => x.replace(/\u00a0/g, ' '))).toEqual(['The card: the release, or the occasion, and its date', '€ 25 of house credit, 30 days', 'MONOLITHE · RIGHT TO BUY']);
      // 10 % + 4 %: the floor holds 86 %, published as 1 IN 1.
      expect(await p.locator('[data-testid=vault-odds-sum]').textContent()).toBe('The rewards hold 14.00 % of the draw. I WAS THERE holds the rest, published as 1 IN 1 (86.00 %).');

      // A row at 1 IN 1 would make the sum above one: refused in its words, nothing added.
      await p.click('[data-testid=vault-new-reward]');
      await p.selectOption('dialog select[name=kind]', 'GUARANTEED');
      await p.fill('dialog input[name=oddsIn]', '1');
      await p.fill('dialog input[name=quantity]', '1');
      await expect.poll(() => p.locator('[data-testid=vault-odds-preview]').textContent(), POLL).toBe(VAULT_COPY.oddsOver);
      await p.click('[data-testid=dialog-confirm]');
      await expect.poll(() => p.locator('dialog .dialog__error').textContent(), POLL).toBe(VAULT_COPY.oddsOver);
      await p.click('[data-testid=dialog-cancel]');
      await confirmed(p);
      expect(await rowsText(p)).toHaveLength(3);

      // A source's cap (ADMIN): A NEW PIECE, at most 3 per piece.
      await p.click('[data-testid=vault-source-edit-PIECE]');
      await p.fill('dialog input[name=cap]', '3');
      await p.click('[data-testid=dialog-confirm]');
      await confirmed(p);
      await toast(p, VAULT_COPY.sourceSaved);
      await expect.poll(() => p.locator('[data-testid=vault-source-cap]').nth(1).textContent(), POLL).toBe('At most 3 per piece');
      expect((await ctx.db.selectFrom('vault_sources').select('cap').where('source', '=', 'PIECE').executeTakeFirstOrThrow()).cap).toBe(3);
      await shot(p, 'table');
      expect(await sideways(p)).toEqual([]);
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'GIVE A VAULT to a collector, the reach first; the report counts it and saves its CSV; the client sheet reads it, GIVE A VAULT and no REVOKE',
    async () => {
      const p = await open();
      await go(p, '#/club?tab=vault', 'Club');
      await p.click('[data-testid=vault-give]');
      await p.fill('dialog input[name=email]', COLLECTOR);
      await p.fill('dialog textarea[name=note]', 'A thank-you after the call.');
      await p.click('[data-testid=dialog-confirm]');
      await expect.poll(() => p.locator('[data-testid=vault-give-reach]').textContent(), POLL).toBe('Reaches 1 collector: 1 vault each.Nobody left out.');
      await shot(p, 'give-reach');
      await p.click('[data-testid=dialog-confirm]');
      await confirmed(p);
      await toast(p, '1 vault given to 1 collector.');
      const given = await ctx.db.selectFrom('vaults').select(['source', 'note']).where('account_id', '=', collectorId).execute();
      expect(given).toEqual([{ source: 'HOUSE', note: 'A thank-you after the call.' }]);

      // The report: 1 given, the house's.
      await expect.poll(() => p.locator('[data-testid=vault-report-summary] .board__figures').textContent(), POLL).toBe('1 given · 0 opened · 1 waiting · 0 expired · 0 returned');
      const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=vault-report-csv]')]);
      expect(download.suggestedFilename()).toMatch(/^ORBES-vault-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = readFileSync((await download.path())!, 'utf8');
      expect(csv).toContain('"given","house","1"');
      await shot(p, 'report');

      // The client sheet: the vault, read-only; GIVE A VAULT; no REVOKE.
      await go(p, `#/owners/${collectorId}`, COLLECTOR);
      await p.waitForSelector('[data-testid=client-vaults]');
      expect(await p.locator('[data-testid=client-vault-source]').allTextContents()).toEqual(['THE HOUSE']);
      expect(await p.locator('[data-testid=client-vault-state] .status__text').allTextContents()).toEqual(['WAITING']);
      expect(await p.locator('#vaults').innerText()).toContain('A thank-you after the call.');
      expect(await p.locator('[data-testid=client-vault-give]').count()).toBe(1);
      expect(await p.locator('#vaults button', { hasText: /revoke/i }).count()).toBe(0);
      await shot(p, 'client-sheet');
      expect(await sideways(p, '#vaults', false)).toEqual([]);
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'a LIVE release\'s THE VAULT: Off by default, turned On',
    async () => {
      const p = await open();
      await go(p, `#/club/live/${releaseId}`, 'LIVE');
      await p.waitForSelector('[data-testid=live-vault]');
      expect(await p.locator('[data-testid=live-vault] .status__text').textContent()).toBe('Off');
      await p.click('[data-testid=live-vault-switch]');
      await p.click('[data-testid=dialog-confirm]');
      await confirmed(p);
      await expect.poll(() => p.locator('[data-testid=live-vault] .status__text').textContent(), POLL).toBe('On');
      expect((await ctx.db.selectFrom('drops').select('vault_on').where('id', '=', releaseId).executeTakeFirstOrThrow()).vault_on).toBe(true);
      await p.locator('#live-part-vault').scrollIntoViewIfNeeded();
      await shot(p, 'live-switch');
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'never scrolls sideways at 1024 px',
    async () => {
      const p = await open(1024, 768);
      await go(p, '#/club?tab=vault', 'Club');
      await p.waitForSelector('[data-testid=vault-tab]');
      expect(await sideways(p)).toEqual([]);
      await shot(p, 'tab-1024');
      await go(p, `#/owners/${collectorId}`, COLLECTOR);
      await p.waitForSelector('[data-testid=client-vaults]');
      expect(await sideways(p, '#vaults', false)).toEqual([]);
      await p.context().close();
    },
    STEP_TIMEOUT,
  );
});
