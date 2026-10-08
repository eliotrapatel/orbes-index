/**
 * A model's declared sizes in the console, end to end (plan NEXT LOT §3.3, step 3.6): the production web build of the
 * console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and driven in Chromium
 * (playwright-core) at 1440 × 900.
 *
 *  1. A model of before its size type: the Catalogue says « Size type to give », its page « To give »; Edit size type
 *     preselects Ring size from its Type and says what giving it does; Tick sizes ticks three sizes from the list, each
 *     its own SKU; the stock page lists each at every location at 0.
 *  2. Remove an unused size (removed, its SKU gone); remove a used one (set aside, still on the stock page where it has
 *     stock, marked Set aside), the last offered size never removable; then reinstate it.
 *  3. ADD A VARIANT says which sizes it copies, and the variant's page has them under its own prefix.
 *  4. A LIVE RELEASE's sizes (the variant's, nothing in stock): the size mix names the model's sizes, and an undeclared
 *     size is refused with them.
 *  5. The suppliers added on Supplier orders (plan NEXT LOT §3.5.4.2), a currency without cents refused; the model's
 *     supplier and a size's own set from its Sizes section (§3.5.4.5).
 *  6. An AUDITOR reads the section, without one action.
 * No CSP violation, no page error, no figure in the display face.
 */
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
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const AUDITOR = { email: 'sizes.auditor@orbes.test', password: 'sizes auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
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

describe.skipIf(!HAS_CHROMIUM)('a model\'s declared sizes in the console (plan NEXT LOT §3.3, E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let modelId: string;
  let admin: Actor;
  let france: string;
  const problems: string[] = [];

  async function open(who: { email: string; password: string }): Promise<Page> {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
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

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
  }

  async function confirmDialog(p: Page): Promise<void> {
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  /** Visible text in Gravesend Sans holding a one or a zero (its one is its capital I): none should. */
  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  async function shot(p: Page, name: string, opts: { dialog?: boolean } = {}): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      // From the top: a page captured whole while scrolled draws its sticky sidebar where it stopped.
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-sizes-${name}.png`), fullPage: !opts.dialog });
  }

  const rows = (p: Page) => p.locator('#sizes [data-testid=model-sizes] tbody tr');
  const sizeRow = (p: Page, label: string) => rows(p).filter({ has: p.locator('[data-testid=model-size-label]', { hasText: new RegExp(`^${label}$`) }) });

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-sizes-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    // A model of before H1: no size type yet (as the models that exist when it ships).
    modelId = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, name: 'HALO', type: 'SIGNET RING', sku_prefix: 'HAL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    admin = { type: 'admin', id: (await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow()).id };
    france = (await ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
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

  it('gives a model its type, ticks its sizes, and sees each at 0 at every location on the stock page', async () => {
    const p = await open(ADMIN);
    await go(p, '#/catalogue', 'Catalogue');
    expect(await p.locator('#models tbody tr', { hasText: 'HAL-RG' }).locator('[data-testid=model-size-type]').textContent()).toBe('Size type to give');
    await go(p, `#/catalogue/${modelId}`, 'HALO');
    expect(await p.locator('#sizes [data-testid=model-size-kind]').textContent()).toBe('To give');
    expect(await p.locator('#sizes [data-testid=model-size-type-note]').allTextContents()).toEqual(['Its sizes are kept as they are until you give it its type.']);
    expect(await p.locator('#sizes .empty').textContent()).toContain('No sizes yet. Give this model its size type, then tick its sizes.');
    expect(await p.locator('#sizes [data-testid=model-sizes-intro]').textContent()).toBe(
      'The sizes this model is made in. Each size is its own SKU, with its own stock in LOGISTICS, at 0 to begin with. New releases, supplier orders and the private salon offer only the sizes offered here.',
    );
    // No list yet: nothing to tick.
    expect(await p.locator('[data-testid=model-sizes-tick]').count()).toBe(0);

    // Size type: preselected from its Type's whole word RING; what giving it does, said before anything is sent.
    await p.click('[data-testid=model-size-kind-edit]');
    expect(await p.locator('dialog [data-testid=size-type-text]').textContent()).toBe(
      'A ring’s sizes are ticked from French sizes 40 to 76, a bracelet’s from 14 to 24 cm by 0.5 cm, a necklace’s from 35 to 100 cm by 1 cm. A watch, like a model of one size, has a single SKU: HAL-RG.',
    );
    expect(await p.locator('dialog select[name=sizeType]').inputValue()).toBe('RING');
    expect(await p.locator('dialog [data-testid=size-type-live]').allTextContents()).toEqual(['Then tick its sizes.']);
    await p.selectOption('dialog select[name=sizeType]', 'WATCH');
    expect(await p.locator('dialog [data-testid=size-type-live]').allTextContents()).toEqual(['Its one size, ONE SIZE (SKU HAL-RG), is offered at once.']);
    await p.selectOption('dialog select[name=sizeType]', 'RING');
    await shot(p, 'size-type-dialog', { dialog: true });
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Sizes saved.")');
    await expect.poll(() => p.locator('#sizes [data-testid=model-size-kind]').textContent()).toBe('Ring size · French sizes 40 to 76');

    // Tick sizes: the list's 37 sizes, none ticked; three ticked, the line saying so; nothing ticked is refused.
    await p.click('[data-testid=model-sizes-tick]');
    expect(await p.locator('dialog .dialog__eyebrow').textContent()).toBe('HALO · HAL-RG · Ring size');
    expect(await p.locator('dialog [data-testid=size-grid] input[type=checkbox]').count()).toBe(37);
    expect(await p.locator('dialog [data-testid=size-grid] .ccheck__label').evaluateAll((els) => [els[0]!.textContent, els.at(-1)!.textContent])).toEqual(['40', '76']);
    expect(await p.locator('dialog [data-testid=size-grid-caption]').count()).toBe(0);
    expect(await p.locator('dialog [data-testid=size-tick-line]').textContent()).toBe('Nothing changes.');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Leave at least one size offered.');
    for (const size of ['50', '52', '54']) await p.locator('dialog label.ccheck', { hasText: new RegExp(`^${size}$`) }).click();
    await expect.poll(() => p.locator('dialog [data-testid=size-tick-line]').textContent()).toBe('Adds 50, 52, 54.');
    await shot(p, 'tick-dialog', { dialog: true });
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Sizes saved.")');
    await expect.poll(() => p.locator('#sizes [data-testid=model-size-label]').allTextContents()).toEqual(['50', '52', '54']);
    expect(await rows(p).locator('td:nth-child(2)').allTextContents()).toEqual(['HAL-RG-50', 'HAL-RG-52', 'HAL-RG-54']);
    expect(await p.locator('#sizes [data-testid=model-size-state]').allTextContents()).toEqual(['Offered', 'Offered', 'Offered']);
    expect(await p.locator('#sizes [data-testid=model-sizes-count]').textContent()).toBe('3 offered');
    expect(await figuresInDisplayFace(p)).toEqual([]);

    // The stock page (Logistics → Stock, in the Atelier's place, plan NEXT LOT §3.5.4.1): each size at every location, at 0.
    await go(p, '#/logistics?tab=stock', 'Logistics');
    const stock = p.locator('#logistics-stock tbody tr', { hasText: 'HAL-RG-' });
    await expect.poll(() => stock.count()).toBe(6);
    expect(await stock.evaluateAll((trs) => trs.map((tr) => [tr.querySelector('.cell-sub.mono')?.textContent, tr.children[3]?.textContent, tr.children[4]?.textContent]))).toEqual([
      ['HAL-RG-50', 'FRANCE WAREHOUSE', '0'],
      ['HAL-RG-50', 'LOGISTICS WAREHOUSE', '0'],
      ['HAL-RG-52', 'FRANCE WAREHOUSE', '0'],
      ['HAL-RG-52', 'LOGISTICS WAREHOUSE', '0'],
      ['HAL-RG-54', 'FRANCE WAREHOUSE', '0'],
      ['HAL-RG-54', 'LOGISTICS WAREHOUSE', '0'],
    ]);
    await shot(p, 'stock-at-0');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('removes an unused size, sets a used one aside (still on the stock page where it has stock), keeps the last offered, then reinstates it', async () => {
    const p = await open(ADMIN);
    await go(p, `#/catalogue/${modelId}`, 'HALO');
    // 54: nothing uses it, removed with its SKU.
    await sizeRow(p, '54').locator('[data-testid=model-size-remove]').click();
    expect(await p.locator('dialog .dialog__title').textContent()).toBe('Remove size 54');
    expect(await p.locator('dialog [data-testid=size-remove-text]').allTextContents()).toEqual(['Size 54 has no stock, order or piece: it is removed, with its SKU HAL-RG-54.']);
    expect(await p.locator('[data-testid=dialog-confirm]').textContent()).toBe('Remove');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Size removed.")');
    await expect.poll(() => p.locator('#sizes [data-testid=model-size-label]').allTextContents()).toEqual(['50', '52']);
    expect(await ctx.db.selectFrom('skus').select('code').where('code', '=', 'HAL-RG-54').execute()).toEqual([]);

    // 52: two pieces counted in at FRANCE WAREHOUSE, so set aside.
    const s52 = (await ctx.db.selectFrom('skus').select('id').where('code', '=', 'HAL-RG-52').executeTakeFirstOrThrow()).id;
    await ctx.services.stock.adjust({ skuId: s52, locationId: france, delta: 2, note: 'Counted.' }, admin);
    await p.reload();
    await expect.poll(() => sizeRow(p, '52').count(), { timeout: 15_000 }).toBe(1);
    await sizeRow(p, '52').locator('[data-testid=model-size-remove]').click();
    expect(await p.locator('dialog [data-testid=size-remove-text]').allTextContents()).toEqual([
      'Size 52 has stock, orders or pieces, so it is set aside. New releases, supplier orders and the private salon no longer offer it. Its stock, pieces, orders and history keep it, and you can reinstate it.',
    ]);
    expect(await p.locator('[data-testid=dialog-confirm]').textContent()).toBe('Set aside');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Size set aside.")');
    await expect.poll(() => sizeRow(p, '52').locator('[data-testid=model-size-state]').textContent()).toMatch(/^Set aside · \d{2} [A-Z]{3} \d{4}$/);
    expect(await p.locator('#sizes [data-testid=model-sizes-count]').textContent()).toBe('1 offered · 1 set aside');
    // The last offered size: Remove is not pressed, and says why.
    const last = sizeRow(p, '50').locator('[data-testid=model-size-remove]');
    expect(await last.isDisabled()).toBe(true);
    expect(await last.getAttribute('title')).toBe('A model keeps at least one size offered.');
    expect(await sizeRow(p, '52').locator('[data-testid=model-size-reinstate]').count()).toBe(1);
    await shot(p, 'set-aside');

    // The stock page (Logistics → Stock): 52 only where it has stock, marked Set aside; the sizes offered (what a supplier
    // order's line or a correction may name) 50 only.
    await go(p, '#/logistics?tab=stock', 'Logistics');
    const stock = p.locator('#logistics-stock tbody tr', { hasText: 'HAL-RG-52' });
    await expect.poll(() => stock.count()).toBe(1);
    expect(await stock.locator('td').nth(3).textContent()).toBe('FRANCE WAREHOUSE');
    expect(await stock.locator('[data-testid=stock-set-aside]').textContent()).toBe('Set aside');
    expect(await stock.locator('[data-testid=stock-add-to-order]').count()).toBe(0);
    const offered = await p.evaluate(async () => ((await (await fetch('/api/admin/logistics/stock')).json()) as { skus: { code: string }[] }).skus.map((k) => k.code));
    expect(offered.filter((c) => c.startsWith('HAL-RG'))).toEqual(['HAL-RG-50']);

    // Reinstated: offered again.
    await go(p, `#/catalogue/${modelId}`, 'HALO');
    await sizeRow(p, '52').locator('[data-testid=model-size-reinstate]').click();
    expect(await p.locator('dialog .dialog__title').textContent()).toBe('Reinstate size 52');
    expect(await p.locator('dialog .dialog__text').textContent()).toBe('New releases, supplier orders and the private salon offer it again.');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Size reinstated.")');
    await expect.poll(() => p.locator('#sizes [data-testid=model-size-state]').allTextContents()).toEqual(['Offered', 'Offered']);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('adds a variant, which copies the sizes under its own prefix; the LIVE dialog refuses a size the model does not have', async () => {
    const p = await open(ADMIN);
    await go(p, `#/catalogue/${modelId}`, 'HALO');
    await p.click('[data-testid=variant-add]');
    await p.fill('dialog input[name=mainLabel]', 'Silver');
    await p.fill('dialog input[name=label]', 'Blue');
    await expect.poll(() => p.locator('dialog [data-testid=variant-sizes]').textContent()).toBe(
      'Its sizes are copied: Ring size, 50, 52. Each gets its own SKU under its own prefix (HAL-BL-50), at 0 in LOGISTICS. Change them on its page; later changes to this model never reach it.',
    );
    await shot(p, 'add-variant', { dialog: true });
    await p.click('[data-testid=dialog-confirm]');
    // Its reference photograph's dialog next, left for later; then its page.
    await p.waitForSelector('dialog [data-testid=photo-impact]', { timeout: 15_000 });
    await p.click('[data-testid=dialog-cancel]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('HALO · BLUE');
    await expect.poll(() => p.locator('#sizes [data-testid=model-size-label]').allTextContents()).toEqual(['50', '52']);
    expect(await rows(p).locator('td:nth-child(2)').allTextContents()).toEqual(['HAL-BL-50', 'HAL-BL-52']);
    expect(await p.locator('#sizes [data-testid=model-size-kind]').textContent()).toBe('Ring size · French sizes 40 to 76');

    // A LIVE RELEASE of the variant, nothing in stock: the size mix names its sizes; an undeclared size is refused, its
    // sizes listed.
    const variantId = (await ctx.db.selectFrom('models').select('id').where('variant_of', '=', modelId).executeTakeFirstOrThrow()).id;
    await go(p, '#/club?tab=drops', 'Club');
    await p.click('[data-testid=live-new]');
    await p.selectOption('dialog select[name=modelId]', variantId);
    await expect.poll(() => p.locator('dialog [data-testid=live-size-mix-line]').textContent(), { timeout: 15_000 }).toBe(
      'Nothing in stock and nothing the planner can tell apart yet: set the sizes by hand, among 50 · 52.',
    );
    await p.fill('dialog input[name=title]', 'THE HALO RING');
    const t0 = new Date(Date.now() + 6 * HOUR);
    const local = (d: Date) => d.toISOString().slice(0, 16);
    await p.fill('dialog input[name=opensAt]', local(t0));
    await p.fill('dialog input[name=closesAt]', local(new Date(t0.getTime() + HOUR)));
    await p.fill('dialog input[name=price]', '4 800');
    await p.fill('dialog textarea[name=sizes]', '52 = 2\n53 = 1');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent(), { timeout: 15_000 }).toBe('Size 53 is not one of HALO · BLUE’s sizes (50, 52). Add it on the model’s page, in the Catalogue.');
    await shot(p, 'live-refused', { dialog: true });
    await p.click('[data-testid=dialog-cancel]');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('adds the suppliers on Supplier orders (plan NEXT LOT §3.5.4.2), then gives the model its supplier and a size its own (§3.5.4.5)', async () => {
    const p = await open(ADMIN);
    await p.locator('.side__link', { hasText: 'Supplier orders' }).click();
    await expect.poll(async () => (await p.locator('h1.page-head__title').textContent())?.trim()).toBe('Supplier orders');
    expect(await p.locator('#suppliers .empty').textContent()).toContain('No supplier yet: add the first one.');
    await shot(p, 'suppliers-empty');
    // A currency without cents is refused, in the dialog.
    await p.click('[data-testid=supplier-create]');
    await p.fill('dialog input[name=name]', 'NORD RINGS');
    await p.fill('dialog input[name=contactName]', 'A. Martin');
    await p.fill('dialog input[name=email]', 'orders@nord.example');
    await p.fill('dialog input[name=currency]', 'jpy');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('This currency is not supported: choose one with cents.');
    await p.fill('dialog input[name=currency]', 'eur');
    await shot(p, 'supplier-dialog', { dialog: true });
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Supplier added.")');
    await p.click('[data-testid=supplier-create]');
    await p.fill('dialog input[name=name]', 'SOUTH SETTINGS');
    await p.fill('dialog input[name=currency]', 'GBP');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#suppliers tbody tr').count()).toBe(2);
    expect(await p.locator('#suppliers tbody tr').first().textContent()).toContain('orders@nord.example');

    // The model's Sizes section: no supplier yet; the model's and one size's own set in one dialog.
    await go(p, `#/catalogue/${modelId}`, 'HALO · SILVER');
    expect(await p.locator('#sizes [data-testid=model-supplier]').textContent()).toBe('No supplier yet.');
    expect(await p.locator('#sizes [data-testid=model-size-supplier]').allTextContents()).toEqual(['', '']);
    await p.click('[data-testid=model-supplier-edit]');
    const size52 = (await ctx.db.selectFrom('skus').select('id').where('code', '=', 'HAL-RG-52').executeTakeFirstOrThrow()).id;
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Nothing has changed.');
    await p.selectOption('dialog select[name=supplier]', { label: 'NORD RINGS' });
    await p.selectOption(`dialog select[name=size_${size52}]`, { label: 'SOUTH SETTINGS' });
    await shot(p, 'model-supplier-dialog', { dialog: true });
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Supplier saved.")');
    await expect.poll(() => p.locator('#sizes [data-testid=model-supplier]').textContent()).toBe('NORD RINGS');
    expect(await p.locator('#sizes [data-testid=model-size-supplier]').allTextContents()).toEqual(['', 'SOUTH SETTINGS']);
    await shot(p, 'model-supplier');
    await go(p, '#/supplier-orders', 'Supplier orders');
    expect(await p.locator('#suppliers tbody tr', { hasText: 'NORD RINGS' }).locator('td:nth-child(4)').textContent()).toBe('1');
    await shot(p, 'suppliers');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('an AUDITOR reads the section without one action', async () => {
    const p = await open(AUDITOR);
    await go(p, `#/catalogue/${modelId}`, 'HALO · SILVER');
    await expect.poll(() => p.locator('#sizes [data-testid=model-size-label]').allTextContents()).toEqual(['50', '52']);
    expect(await p.locator('#sizes [data-testid=model-size-kind]').textContent()).toBe('Ring size · French sizes 40 to 76');
    expect(await p.locator('#sizes button').count()).toBe(0);
    await p.context().close();
  }, STEP_TIMEOUT);
});
