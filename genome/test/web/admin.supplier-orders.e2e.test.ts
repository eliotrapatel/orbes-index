/**
 * Supplier orders in the console, end to end (plan NEXT LOT of 2026-10-07, §3.5.4.2; step 5.11d): the production web
 * build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. ORBES's Stock: a size under its minimum is TO ORDER, Add to supplier order puts it in its supplier's draft.
 *  2. To order: an order waiting for stock and that size, per supplier and location, a size without a supplier apart;
 *     Add to the draft; the draft's page: Edit, a line added then removed, Mark sent refused while a price is missing,
 *     then sent; its PDF; Confirmed by the supplier; Expected in the Stock; the invoice entered and paid; the list.
 *  3. An AUDITOR reads the page and the order without one action; a LOGISTICS login never reaches them.
 * No CSP violation, no page error, no figure in the display face.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { createAccount } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;

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

describe.skipIf(!HAS_CHROMIUM)('Supplier orders in the console (plan NEXT LOT §3.5.4.2, E2E, Chromium)', () => {
  let workDir: string;
  let h: Harness;
  let origin: string;
  let browser: Browser;
  let catalog: Catalog;
  let admin: Actor;
  let france: string;
  let warehouse: string;
  let agentLogin: { email: string; password: string };
  let sku52: string;
  let sku54: string;
  const problems: string[] = [];

  async function open(who: { email: string; password: string }, heading: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
    const c = await browser.newContext({ viewport, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
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
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe(heading);
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const csp = (p: Page) => p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((x) => (location.hash = x), hash);
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
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-supplier-orders-${name}.png`), fullPage: !opts.dialog });
  }

  /** A salon order of a size at FRANCE WAREHOUSE, priced. */
  async function salonOrder(size: string): Promise<string> {
    const account = await createAccount(h.t.db);
    const request = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    return id;
  }

  let auditorLogin: { email: string; password: string };
  let other: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-supplier-orders-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    h = await createHarness({ config: { publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN }, app: { serveStatic: true, staticDir: webDir } });
    h.clock.set(new Date());
    catalog = await seedCatalog(h.ctx);
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    warehouse = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    admin = { type: 'admin', id: (await h.t.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow()).id };
    agentLogin = await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [france] });
    auditorLogin = await createAdmin(h.ctx, 'AUDITOR');
    await h.t.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    sku52 = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
    sku54 = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '54'));
    // A second model, its size without a supplier.
    const second = await seedCatalog(h.ctx);
    other = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, second.modelId, '48'));
    await h.t.db.updateTable('models').set({ name: 'ORBITE' }).where('id', '=', second.modelId).execute();
    await h.app.listen({ port, host: '127.0.0.1' });
    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await h?.close().catch(() => {});
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    expect(problems).toEqual([]);
  });

  it('proposes what is missing, makes the draft, sends it with its PDF, and follows it to its paid invoice', async () => {
    const nord = await h.ctx.services.suppliers.create({ name: 'MAISON NORD', currency: 'EUR' }, admin);
    await h.ctx.services.suppliers.setModelSupplier(catalog.modelId, { supplierId: nord.id }, admin);
    // A paid salon order of 52 with nothing in stock waits; 54 at FRANCE WAREHOUSE is under its minimum of 2; ORBITE 48 too.
    const waiting = await salonOrder('52');
    expect((await h.t.db.selectFrom('orders').select('reservation').where('id', '=', waiting).executeTakeFirstOrThrow()).reservation).toBe('AWAITING');
    await h.ctx.services.logistics.setMinimum({ skuId: sku54, locationId: france, minimum: 2 }, admin);
    await h.ctx.services.logistics.setMinimum({ skuId: other, locationId: france, minimum: 1 }, admin);
    const code54 = (await h.t.db.selectFrom('skus').select('code').where('id', '=', sku54).executeTakeFirstOrThrow()).code;

    // ORBES's Stock: 54 TO ORDER 2, Add to supplier order.
    const a = await open(ADMIN, 'Dashboard');
    await go(a, `#/logistics?tab=stock&locationId=${france}`, 'Logistics');
    const row54 = a.locator('#logistics-stock tbody tr', { has: a.locator('.cell-sub.mono', { hasText: new RegExp(`^${code54}$`) }) });
    await expect.poll(() => row54.locator('[data-testid=stock-to-order]').textContent()).toBe('TO ORDER2');
    await row54.locator('[data-testid=stock-add-to-order]').click();
    expect(await a.locator('dialog .dialog__text').textContent()).toBe('The pieces of MONOLITHE · 54 go to the draft of its supplier, to deliver to FRANCE WAREHOUSE. You confirm the draft before it is sent.');
    expect(await a.locator('dialog input[name=quantity]').inputValue()).toBe('2');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Added to the draft.")');
    await expect.poll(() => row54.locator('[data-testid=stock-to-order]').count()).toBe(0);

    // To order: 52 for its waiting order; ORBITE 48 without a supplier, apart.
    await a.click('.side__link[data-route=supplierOrders]');
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Supplier orders');
    const group = a.locator('[data-testid=proposal-group]', { hasText: 'MAISON NORD · FRANCE WAREHOUSE' });
    await expect.poll(() => group.locator('tbody tr').count()).toBe(2);
    expect(await group.locator('thead th').allTextContents()).toEqual(['Model', 'Variant', 'Size', 'Waiting orders', 'Under the minimum', 'Expected', 'In the draft', 'To order']);
    expect(await group.locator('[data-testid=proposal-to-order]').allTextContents()).toEqual(['1', '0']);
    expect(await a.locator('[data-testid=proposal-no-supplier]').textContent()).toBe('No supplier set for ORBITE · 48: set it on the model’s page.');
    await shot(a, 'proposal');
    await group.locator('[data-testid=proposal-add]').click();
    await a.waitForSelector('.toast:has-text("Added to the draft.")');
    await expect.poll(() => group.locator('[data-testid=proposal-to-order]').allTextContents()).toEqual(['0', '0']);
    expect(await a.locator('#supplier-orders-list [data-testid=supplier-order-status]').allTextContents()).toEqual(['DRAFT']);

    // The draft: Edit, a line added then removed, Mark sent refused without its prices, then sent.
    await group.locator('[data-testid=proposal-draft]').click();
    await expect.poll(() => a.locator('[data-testid=supplier-order-mark]').textContent()).toBe('DRAFT');
    const reference = (await title(a).textContent())!.trim();
    expect(reference).toMatch(/^SO-[0-9A-F]{8}$/);
    expect(await a.locator('#supplier-order-lines tbody tr').count()).toBe(2);
    await a.click('[data-testid=supplier-order-edit]');
    await a.fill('dialog input[name=expectedOn]', '2026-11-20');
    await a.fill('dialog input[name=shipping]', '25');
    await a.fill('dialog textarea[name=note]', 'Deliver in the morning.');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Supplier order saved.")');
    await a.click('[data-testid=line-add]');
    await expect.poll(() => a.locator('dialog select[name=skuId] option').count()).toBeGreaterThan(1);
    await a.selectOption('dialog select[name=skuId]', other);
    await a.fill('dialog input[name=quantity]', '3');
    await confirmDialog(a);
    await expect.poll(() => a.locator('#supplier-order-lines tbody tr').count()).toBe(3);
    await a.locator('#supplier-order-lines tbody tr', { hasText: 'ORBITE' }).locator('[data-testid=line-remove]').click();
    await confirmDialog(a);
    await expect.poll(() => a.locator('#supplier-order-lines tbody tr').count()).toBe(2);
    await a.click('[data-testid=supplier-order-send]');
    expect(await a.locator('dialog .dialog__text').textContent()).toBe('The order is SENT: its lines and prices no longer change. Download its PDF and send it to the supplier yourself.');
    await a.click('[data-testid=dialog-confirm]');
    await expect.poll(() => a.locator('dialog .dialog__error').textContent()).toBe('Before it is sent, an order needs at least one line, a unit price on each, its currency and its expected delivery date.');
    await a.click('[data-testid=dialog-cancel]');
    for (let i = 0; i < 2; i++) {
      await a.locator('#supplier-order-lines tbody tr').nth(i).locator('[data-testid=line-edit]').click();
      await a.fill('dialog input[name=unitPrice]', '120');
      await confirmDialog(a);
      await a.waitForSelector('dialog.dialog', { state: 'detached' });
    }
    await expect.poll(async () => (await a.locator('[data-testid=supplier-order-total]').textContent())?.replace(/\s/g, ' ')).toBe('€ 385');
    await shot(a, 'draft');
    await a.click('[data-testid=supplier-order-send]');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Supplier order sent.")');
    await expect.poll(() => a.locator('[data-testid=supplier-order-mark]').textContent()).toBe('SENT');
    expect(await a.locator('[data-testid=line-edit]').count()).toBe(0);
    const [pdf] = await Promise.all([a.waitForEvent('download'), a.click('[data-testid=supplier-order-pdf]')]);
    expect(pdf.suggestedFilename()).toBe(`ORBES-${reference}.pdf`);
    // The PDF itself, kept beside the captures for the owner's review (plan NEXT LOT step 5.14).
    if (SCREENSHOTS) {
      mkdirSync(OUT_DIR, { recursive: true });
      await pdf.saveAs(join(OUT_DIR, 'admin-supplier-orders-order.pdf'));
    }

    // Confirmed by the supplier; the Stock reads what it owes.
    await a.click('[data-testid=supplier-order-confirmed]');
    expect(await a.locator('dialog input[name=expectedOn]').inputValue()).toBe('2026-11-20');
    await confirmDialog(a);
    await expect.poll(() => a.locator('[data-testid=supplier-order-mark]').textContent()).toBe('EXPECTED');
    // The invoice, entered then paid.
    await a.click('[data-testid=invoice-enter]');
    await a.fill('dialog input[name=number]', 'MN-2026-114');
    await a.fill('dialog input[name=amount]', '385');
    await a.fill('dialog input[name=date]', '2026-11-21');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Invoice saved.")');
    await a.click('[data-testid=invoice-paid-button]');
    expect(await a.locator('dialog .dialog__text').textContent()).toBe('ORBES has paid this invoice.');
    await confirmDialog(a);
    await expect.poll(() => a.locator('[data-testid=invoice-paid]').textContent()).not.toBe('—');
    expect(await a.locator('#supplier-order-history tbody tr').count()).toBeGreaterThan(4);
    await shot(a, 'order');
    await go(a, '#/supplier-orders', 'Supplier orders');
    const listed = a.locator('#supplier-orders-list tbody tr');
    expect((await listed.locator('td').allTextContents()).map((x) => x.replace(/\s/g, ' '))).toEqual([reference, 'MAISON NORD', 'FRANCE WAREHOUSE', 'EXPECTED', '0 / 3', '€ 385', '20 NOV 2026', 'MN-2026-114 · PAID']);
    await a.selectOption('[data-testid=supplier-orders-status]', 'DRAFT');
    await expect.poll(() => a.locator('#supplier-orders-list .empty__text').textContent()).toBe('No supplier order yet: the console proposes one under To order.');
    await go(a, `#/logistics?tab=stock&locationId=${france}`, 'Logistics');
    await expect.poll(() => row54.locator('[data-testid=stock-expected]').textContent()).toBe('2');
    for (const p of [a]) {
      expect(await figuresInDisplayFace(p)).toEqual([]);
      expect(await csp(p)).toEqual([]);
    }

    // An AUDITOR reads, without one action; the agent never reaches the page.
    const r = await open(auditorLogin, 'Dashboard');
    await go(r, '#/supplier-orders', 'Supplier orders');
    expect(await r.locator('[data-testid=proposal-add], [data-testid=supplier-create]').count()).toBe(0);
    await r.locator('[data-testid=supplier-order-link]').first().click();
    await expect.poll(async () => (await title(r).textContent())?.trim()).toBe(reference);
    expect(await r.locator('[data-testid=supplier-order-cancel-rest], [data-testid=invoice-enter], [data-testid=line-edit]').count()).toBe(0);
    const g = await open(agentLogin, 'Logistics');
    await g.evaluate(() => (location.hash = '#/supplier-orders'));
    await expect.poll(() => g.evaluate(() => location.hash)).toBe('#/logistics');
    expect(await g.evaluate(async () => (await fetch('/api/admin/supplier-orders')).status)).toBe(403);
    for (const p of [a, r, g]) await p.context().close();
  }, STEP_TIMEOUT);
});
