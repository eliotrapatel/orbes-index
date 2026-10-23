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
 *  4. A size nothing calls for keeps Add to supplier order (pieces ordered in advance, typed); never for an AUDITOR or
 *     the agent.
 *  5. ORDER A MODEL (plan MACRO M3 §3.3, Z1 and Z2): Settings → Locations' SERVES set by Edit countries (a country moved
 *     from another location said before and after); Order a model: a model without an offered size, then a model's
 *     pieces proposed by size and location from its orders, two lines edited (the total and its warning), Escape asking
 *     before the changes are discarded, ADD TO DRAFTS naming and linking the two drafts, the draft read; never for an
 *     AUDITOR.
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
/** expect.poll's budget (its default, 1 s, is too short on a shared CI runner). */
const POLL = { timeout: 15_000 };

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
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
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

  /** A salon order of a size at FRANCE WAREHOUSE, priced (of MONOLITHE unless another model is given). */
  async function salonOrder(size: string, modelId = catalog.modelId): Promise<string> {
    const account = await createAccount(h.t.db);
    const request = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
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
    await expect.poll(() => row54.locator('[data-testid=stock-to-order]').textContent(), POLL).toBe('TO ORDER2');
    expect(await row54.locator('[data-testid=stock-add-to-order]').getAttribute('class')).toBe('cbtn cbtn--secondary');
    await row54.locator('[data-testid=stock-add-to-order]').click();
    expect(await a.locator('dialog .dialog__text').textContent()).toBe('The pieces of MONOLITHE · 54 go to the draft of its supplier, to deliver to FRANCE WAREHOUSE. You confirm the draft before it is sent.');
    expect(await a.locator('dialog input[name=quantity]').inputValue()).toBe('2');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Added to the draft.")');
    await expect.poll(() => row54.locator('[data-testid=stock-to-order]').count(), POLL).toBe(0);

    // To order: 52 for its waiting order; ORBITE 48 without a supplier, apart.
    await a.click('.side__link[data-route=supplierOrders]');
    await expect.poll(async () => (await title(a).textContent())?.trim(), POLL).toBe('Supplier orders');
    const group = a.locator('[data-testid=proposal-group]', { hasText: 'MAISON NORD · FRANCE WAREHOUSE' });
    await expect.poll(() => group.locator('tbody tr').count(), POLL).toBe(2);
    expect(await group.locator('thead th').allTextContents()).toEqual(['Model', 'Variant', 'Size', 'Waiting orders', 'Under the minimum', 'Expected', 'In the draft', 'To order']);
    expect(await group.locator('[data-testid=proposal-to-order]').allTextContents()).toEqual(['1', '0']);
    expect(await a.locator('[data-testid=proposal-no-supplier]').textContent()).toBe('No supplier set for ORBITE · 48: set it on the model’s page.');
    await shot(a, 'proposal');
    await group.locator('[data-testid=proposal-add]').click();
    await a.waitForSelector('.toast:has-text("Added to the draft.")');
    await expect.poll(() => group.locator('[data-testid=proposal-to-order]').allTextContents(), POLL).toEqual(['0', '0']);
    expect(await a.locator('#supplier-orders-list [data-testid=supplier-order-status]').allTextContents()).toEqual(['DRAFT']);

    // The draft: Edit, a line added then removed, Mark sent refused without its prices, then sent.
    await group.locator('[data-testid=proposal-draft]').click();
    await expect.poll(() => a.locator('[data-testid=supplier-order-mark]').textContent(), POLL).toBe('DRAFT');
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
    await expect.poll(() => a.locator('dialog select[name=skuId] option').count(), POLL).toBeGreaterThan(1);
    await a.selectOption('dialog select[name=skuId]', other);
    await a.fill('dialog input[name=quantity]', '3');
    await confirmDialog(a);
    await expect.poll(() => a.locator('#supplier-order-lines tbody tr').count(), POLL).toBe(3);
    await a.locator('#supplier-order-lines tbody tr', { hasText: 'ORBITE' }).locator('[data-testid=line-remove]').click();
    await confirmDialog(a);
    await expect.poll(() => a.locator('#supplier-order-lines tbody tr').count(), POLL).toBe(2);
    await a.click('[data-testid=supplier-order-send]');
    expect(await a.locator('dialog .dialog__text').textContent()).toBe('The order is SENT: its lines and prices no longer change. Download its PDF and send it to the supplier yourself.');
    await a.click('[data-testid=dialog-confirm]');
    await expect.poll(() => a.locator('dialog .dialog__error').textContent(), POLL).toBe('Before it is sent, an order needs at least one line, a unit price on each, its currency and its expected delivery date.');
    await a.click('[data-testid=dialog-cancel]');
    for (let i = 0; i < 2; i++) {
      await a.locator('#supplier-order-lines tbody tr').nth(i).locator('[data-testid=line-edit]').click();
      await a.fill('dialog input[name=unitPrice]', '120');
      await confirmDialog(a);
      await a.waitForSelector('dialog.dialog', { state: 'detached' });
    }
    await expect.poll(async () => (await a.locator('[data-testid=supplier-order-total]').textContent())?.replace(/\s/g, ' '), POLL).toBe('€ 385');
    await shot(a, 'draft');
    await a.click('[data-testid=supplier-order-send]');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Supplier order sent.")');
    await expect.poll(() => a.locator('[data-testid=supplier-order-mark]').textContent(), POLL).toBe('SENT');
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
    await expect.poll(() => a.locator('[data-testid=supplier-order-mark]').textContent(), POLL).toBe('EXPECTED');
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
    await expect.poll(() => a.locator('[data-testid=invoice-paid]').textContent(), POLL).not.toBe('—');
    expect(await a.locator('#supplier-order-history tbody tr').count()).toBeGreaterThan(4);
    await shot(a, 'order');
    await go(a, '#/supplier-orders', 'Supplier orders');
    const listed = a.locator('#supplier-orders-list tbody tr');
    expect((await listed.locator('td').allTextContents()).map((x) => x.replace(/\s/g, ' '))).toEqual([reference, 'MAISON NORD', 'FRANCE WAREHOUSE', 'EXPECTED', '0 / 3', '€ 385', '20 NOV 2026', 'MN-2026-114 · PAID']);
    await a.selectOption('[data-testid=supplier-orders-status]', 'DRAFT');
    await expect.poll(() => a.locator('#supplier-orders-list .empty__text').textContent(), POLL).toBe('No supplier order yet: the console proposes one under To order.');
    await go(a, `#/logistics?tab=stock&locationId=${france}`, 'Logistics');
    await expect.poll(() => row54.locator('[data-testid=stock-expected]').textContent(), POLL).toBe('2');
    for (const p of [a]) {
      expect(await figuresInDisplayFace(p)).toEqual([]);
      expect(await csp(p)).toEqual([]);
    }

    // An AUDITOR reads, without one action; the agent never reaches the page.
    const r = await open(auditorLogin, 'Dashboard');
    await go(r, '#/supplier-orders', 'Supplier orders');
    expect(await r.locator('[data-testid=proposal-add], [data-testid=supplier-create]').count()).toBe(0);
    await r.locator('[data-testid=supplier-order-link]').first().click();
    await expect.poll(async () => (await title(r).textContent())?.trim(), POLL).toBe(reference);
    expect(await r.locator('[data-testid=supplier-order-cancel-rest], [data-testid=invoice-enter], [data-testid=line-edit]').count()).toBe(0);
    const g = await open(agentLogin, 'Logistics');
    await g.evaluate(() => (location.hash = '#/supplier-orders'));
    await expect.poll(() => g.evaluate(() => location.hash), POLL).toBe('#/logistics');
    expect(await g.evaluate(async () => (await fetch('/api/admin/supplier-orders')).status)).toBe(403);

    // Ordered in advance: 54, which nothing calls for any more (its minimum is covered by what is expected: no TO ORDER),
    // keeps Add to supplier order; its pieces are typed, and go to a new draft of its supplier. The AUDITOR and the
    // agent read the Stock without it.
    expect(await row54.locator('[data-testid=stock-to-order]').count()).toBe(0);
    // The button is emphasised only where the console suggests it (TO ORDER): quiet here.
    expect(await row54.locator('[data-testid=stock-add-to-order]').getAttribute('class')).toBe('cbtn cbtn--ghost');
    await row54.locator('[data-testid=stock-add-to-order]').click();
    expect(await a.locator('dialog input[name=quantity]').inputValue()).toBe('');
    await a.click('[data-testid=dialog-confirm]');
    await expect.poll(() => a.locator('dialog .dialog__error').textContent(), POLL).toBe('Complete the required fields.');
    await a.fill('dialog input[name=quantity]', '500');
    await confirmDialog(a);
    await expect
      .poll(() => h.t.db.selectFrom('supplier_order_lines as l').innerJoin('supplier_orders as o', 'o.id', 'l.supplier_order_id').select(['l.sku_id', 'l.quantity', 'o.location_id']).where('o.status', '=', 'DRAFT').execute())
      .toEqual([{ sku_id: sku54, quantity: 500, location_id: france }]);
    await expect.poll(() => row54.locator('[data-testid=stock-add-to-order]').count(), POLL).toBe(1);
    expect(await row54.locator('[data-testid=stock-to-order]').count()).toBe(0);
    expect(await csp(a)).toEqual([]);
    for (const p of [r, g]) {
      await go(p, '#/logistics?tab=stock', 'Logistics');
      await expect.poll(() => p.locator('#logistics-stock tbody tr').count(), POLL).toBeGreaterThan(0);
      expect(await p.locator('[data-testid=stock-add-to-order]').count()).toBe(0);
    }
    for (const p of [a, r, g]) await p.context().close();
  }, STEP_TIMEOUT);

  it('sets the countries each location serves, then orders a model by size and location, its lines edited, into the drafts', async () => {
    // ECLIPSE: 50, 52 and 54 offered, from MAISON SUD; two orders of 52 at FRANCE WAREHOUSE, one of 54 at LOGISTICS WAREHOUSE.
    const sud = await h.ctx.services.suppliers.create({ name: 'MAISON SUD', currency: 'EUR' }, admin);
    const eclipse = (await seedCatalog(h.ctx)).modelId;
    await h.t.db.updateTable('models').set({ name: 'ECLIPSE' }).where('id', '=', eclipse).execute();
    const sizes: Record<string, string> = {};
    for (const size of ['50', '52', '54']) sizes[size] = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, eclipse, size));
    await h.ctx.services.suppliers.setModelSupplier(eclipse, { supplierId: sud.id }, admin);
    await salonOrder('52', eclipse);
    await salonOrder('52', eclipse);
    const far = await salonOrder('54', eclipse);
    await h.t.db.updateTable('orders').set({ location_id: warehouse }).where('id', '=', far).execute();
    // NOVA: no size declared.
    const nova = (await seedCatalog(h.ctx)).modelId;
    await h.t.db.updateTable('models').set({ name: 'NOVA' }).where('id', '=', nova).execute();

    // Settings → Locations: the lead, SERVES empty; LOGISTICS WAREHOUSE serves Belgium; FRANCE WAREHOUSE takes it, with France.
    const a = await open(ADMIN, 'Dashboard');
    await go(a, '#/settings', 'Settings');
    expect(await a.locator('[data-testid=locations-lead]').textContent()).toBe(
      'A collector counts at the location that serves their country when ORBES orders a model by size. A country no location serves counts at the default location.',
    );
    expect(await a.locator('#settings-locations thead th').allTextContents()).toEqual(['Location', 'Address', 'Serves', 'Default', 'Shopify', '']);
    expect(await a.locator('[data-testid=location-serves]').allTextContents()).toEqual(['—', '—']);
    const row = (name: string) => a.locator('#settings-locations tbody tr', { hasText: name });
    await row('LOGISTICS WAREHOUSE').locator('[data-testid=location-countries-edit]').click();
    await a.selectOption('dialog [data-testid=countries-add]', 'BE');
    await expect.poll(() => a.locator('dialog [data-testid=countries-chosen] .chip').allTextContents(), POLL).toEqual(['Belgium×']);
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Countries saved.")');
    await expect.poll(() => row('LOGISTICS WAREHOUSE').locator('[data-testid=location-serves] .chip').allTextContents(), POLL).toEqual(['Belgium']);
    await row('FRANCE WAREHOUSE').locator('[data-testid=location-countries-edit]').click();
    expect(await a.locator('dialog [data-testid=countries-chosen]').textContent()).toBe('None chosen: as the default location, it counts every country no other location serves.');
    await a.selectOption('dialog [data-testid=countries-add]', 'FR');
    await a.selectOption('dialog [data-testid=countries-add]', 'BE');
    await expect.poll(() => a.locator('dialog [data-testid=countries-moving]').textContent(), POLL).toBe('Belgium moves here from LOGISTICS WAREHOUSE.');
    await shot(a, 'countries', { dialog: true });
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Countries saved. Belgium moved here from LOGISTICS WAREHOUSE.")');
    await expect.poll(() => row('FRANCE WAREHOUSE').locator('[data-testid=location-serves] .chip').allTextContents(), POLL).toEqual(['Belgium', 'France']);
    expect(await row('LOGISTICS WAREHOUSE').locator('[data-testid=location-serves]').textContent()).toBe('—');
    expect(await h.t.db.selectFrom('stock_location_countries').select(['country', 'location_id']).orderBy('country').execute()).toEqual([
      { country: 'BE', location_id: france },
      { country: 'FR', location_id: france },
    ]);
    await shot(a, 'locations');

    // Order a model: NOVA has no offered size.
    await go(a, '#/supplier-orders', 'Supplier orders');
    await a.click('[data-testid=split-open]');
    const panel = a.locator('dialog[data-testid=split-dialog]');
    await panel.waitFor();
    expect(await panel.locator('[data-testid=split-location]').count()).toBe(2);
    await a.click('[data-testid=split-propose]');
    expect(await panel.locator('[data-testid=split-ask-error]').textContent()).toBe('Choose a model.');
    await a.selectOption('[data-testid=split-model]', nova);
    await a.fill('[data-testid=split-pieces]', '10');
    await a.click('[data-testid=split-propose]');
    await expect.poll(() => panel.locator('[data-testid=split-no-sizes] .empty__text').textContent(), POLL).toBe('This model has no offered size: declare its sizes in the Catalogue.');
    expect(await panel.locator('[data-testid=split-add]').isDisabled()).toBe(true);

    // ECLIPSE, 10 pieces at both locations: 52 at FRANCE weighs 2, 54 at LOGISTICS 1: 7 and 3.
    await a.selectOption('[data-testid=split-model]', eclipse);
    await a.click('[data-testid=split-propose]');
    const rows = panel.locator('[data-testid=split-row]');
    await expect.poll(() => rows.count(), POLL).toBe(6);
    expect(await panel.locator('thead th').allTextContents()).toEqual(['Size', 'Location', 'Orders', 'Saved sizes', 'Proposed', 'To order']);
    const cells = async () => (await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(1, 5).map((td) => td.textContent).join(' | '))));
    expect(await cells()).toEqual([
      'FRANCE WAREHOUSE | 0 | 0 | 0',
      'LOGISTICS WAREHOUSE | 0 | 0 | 0',
      'FRANCE WAREHOUSE | 2 | 0 | 7',
      'LOGISTICS WAREHOUSE | 0 | 0 | 0',
      'FRANCE WAREHOUSE | 0 | 0 | 0',
      'LOGISTICS WAREHOUSE | 1 | 0 | 3',
    ]);
    expect(await panel.locator('[data-testid=split-to-order]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toEqual(['0', '0', '7', '0', '0', '3']);
    expect(await panel.locator('[data-testid=split-total]').textContent()).toBe('10 of 10 pieces');
    expect(await panel.locator('[data-testid=split-warning]').isVisible()).toBe(false);
    expect(await panel.locator('[data-testid=split-source]').textContent()).toMatch(/^From 3 orders, net of size exchanges, and 0 saved sizes\./);
    expect(await panel.locator('[data-testid=split-unmatched]').count()).toBe(0);

    // Two lines changed: 54 at LOGISTICS to 4, 50 at FRANCE to 2: 13 of 10, said, never refused.
    const qty = (i: number) => panel.locator('[data-testid=split-to-order]').nth(i);
    await qty(5).fill('4');
    await expect.poll(() => panel.locator('[data-testid=split-total]').textContent(), POLL).toBe('11 of 10 pieces');
    await qty(0).fill('2');
    await expect.poll(() => panel.locator('[data-testid=split-warning]').textContent(), POLL).toBe('3 more than the 10 asked.');
    expect(await panel.locator('[data-testid=split-total]').textContent()).toBe('13 of 10 pieces');
    expect(await panel.locator('[data-testid=split-add]').isDisabled()).toBe(false);
    await shot(a, 'order-a-model', { dialog: true });
    // Escape asks before the changed lines are discarded; staying keeps them.
    await a.keyboard.press('Escape');
    await expect.poll(() => a.locator('dialog.dialog .dialog__title').allTextContents(), POLL).toContain('Discard the split?');
    await a.click('[data-testid=dialog-cancel]');
    expect(await qty(0).inputValue()).toBe('2');

    // ADD TO DRAFTS: MAISON SUD's draft at each location, named in the toast and linked in the panel.
    await a.click('[data-testid=split-add]');
    await expect.poll(() => panel.locator('[data-testid=split-draft]').count(), POLL).toBe(2);
    const refs = await panel.locator('[data-testid=split-draft]').allTextContents();
    for (const ref of refs) expect(ref).toMatch(/^SO-[0-9A-F]{8}$/);
    await a.waitForSelector(`.toast:has-text("13 pieces added to 2 drafts: ${refs.join(', ')}.")`);
    expect(await panel.locator('.split__draft-words').allTextContents()).toEqual(['MAISON SUD · FRANCE WAREHOUSE · 9 pieces on 2 lines', 'MAISON SUD · LOGISTICS WAREHOUSE · 4 pieces on 1 line']);
    const drafted = await h.t.db
      .selectFrom('supplier_order_lines as l')
      .innerJoin('supplier_orders as o', 'o.id', 'l.supplier_order_id')
      .select(['l.sku_id', 'l.quantity', 'o.location_id', 'o.status'])
      .where('o.supplier_id', '=', sud.id)
      .orderBy('l.quantity')
      .execute();
    expect(drafted).toEqual([
      { sku_id: sizes['50'], quantity: 2, location_id: france, status: 'DRAFT' },
      { sku_id: sizes['54'], quantity: 4, location_id: warehouse, status: 'DRAFT' },
      { sku_id: sizes['52'], quantity: 7, location_id: france, status: 'DRAFT' },
    ]);
    await shot(a, 'order-a-model-added', { dialog: true });
    // The draft read: its link closes the panel and opens it.
    await panel.locator('[data-testid=split-draft]').first().click();
    await expect.poll(async () => (await title(a).textContent())?.trim(), POLL).toBe(refs[0]);
    expect(await a.locator('dialog[data-testid=split-dialog]').count()).toBe(0);
    await expect.poll(() => a.locator('#supplier-order-lines tbody tr').count(), POLL).toBe(2);
    expect(await a.locator('[data-testid=supplier-order-mark]').textContent()).toBe('DRAFT');
    expect(await figuresInDisplayFace(a)).toEqual([]);
    expect(await csp(a)).toEqual([]);

    // An AUDITOR reads the page without Order a model.
    const r = await open(auditorLogin, 'Dashboard');
    await go(r, '#/supplier-orders', 'Supplier orders');
    expect(await r.locator('[data-testid=split-open]').count()).toBe(0);
    for (const p of [a, r]) await p.context().close();
  }, STEP_TIMEOUT);
});
