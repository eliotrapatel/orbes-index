/**
 * Logistics in the console, end to end (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.4.1; steps 5.11a to 5.11c): the
 * production web build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key
 * provider) and driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. Stock and Corrections: the agent (a LOGISTICS login of FRANCE WAREHOUSE) reads every size of its location, 0
 *     included, without what ORBES alone reads, and proposes two corrections; ORBES approves one (the count moves) and
 *     declines the other with a note, which the agent then reads. ORBES's Stock: every location, the Location filter,
 *     a count no identity backs marked NO PIECE with the notice over the table, its piece counted in.
 *  2. Returns: a delivered order's return opened by Client Services is to receive at the agent's location; the agent
 *     records the parcel back, the piece OK, and the order case reads RECEIVED for ORBES to decide.
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
import { orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { packAndShip, stockPieces } from '../support/fulfil.js';
import { createAccount } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
const MINUTE = 60_000;

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

describe.skipIf(!HAS_CHROMIUM)('Logistics in the console (plan NEXT LOT §3.5.3, E2E, Chromium)', () => {
  let workDir: string;
  let h: Harness;
  let origin: string;
  let browser: Browser;
  let catalog: Catalog;
  let admin: Actor;
  let france: string;
  let warehouse: string;
  let colissimo: string;
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
    await p.screenshot({ path: join(OUT_DIR, `admin-logistics-${name}.png`), fullPage: !opts.dialog });
  }

  const tabs = (p: Page) => p.locator('.logistics__tabs .range__tab');
  const tabTexts = async (p: Page) => (await tabs(p).allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
  const stockRow = (p: Page, code: string, location?: string) =>
    p.locator('#logistics-stock tbody tr', { has: p.locator('.cell-sub.mono', { hasText: new RegExp(`^${code}$`) }) }).filter(location ? { hasText: location } : {});

  /** A salon order of a size at FRANCE WAREHOUSE, priced. */
  async function salonOrder(size: string): Promise<string> {
    const account = await createAccount(h.t.db);
    const request = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    return id;
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-logistics-e2e-'));
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
    colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    admin = { type: 'admin', id: (await h.t.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow()).id };
    agentLogin = await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [france] });
    await h.t.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    sku52 = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
    sku54 = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '54'));
    await h.app.listen({ port, host: '127.0.0.1' });
    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await h?.close().catch(() => {});
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    expect(problems).toEqual([]);
  });

  it('the agent reads its stock and proposes corrections; ORBES approves one and declines the other; ORBES reads every location, a count no piece backs, and counts its piece in', async () => {
    await stockPieces(h.ctx, { skuId: sku52, locationId: france, count: 2, material: '925 STERLING SILVER' }, admin);
    const sku = (await h.t.db.selectFrom('skus').select('code').where('id', '=', sku52).executeTakeFirstOrThrow()).code;
    const code54 = (await h.t.db.selectFrom('skus').select('code').where('id', '=', sku54).executeTakeFirstOrThrow()).code;

    // The agent: its sign-in lands on Logistics, Stock first, its counters beside the tabs.
    const g = await open(agentLogin, 'Logistics');
    expect(await tabTexts(g)).toEqual(['Stock', 'Returns (0)', 'Corrections (0)']);
    expect(await g.locator('[data-testid=logistics-tab-stock]').getAttribute('aria-current')).toBe('page');
    // One location: no Location filter, no Location column; never what ORBES alone reads.
    expect(await g.locator('[data-testid=logistics-location]').count()).toBe(0);
    expect(await g.locator('#logistics-stock thead th').allTextContents()).toEqual(['Model', 'Variant', 'Size', 'On hand', 'Reserved', 'Available', 'Waiting', 'Minimum', '']);
    expect(await g.locator('#logistics-stock .panel__text').textContent()).toBe(
      'Every size of every model and variant at your locations, 0 included. On hand is what the stock holds; reserved, what orders hold; waiting, the orders without a piece yet.',
    );
    expect(await stockRow(g, sku).locator('td').allTextContents()).toEqual(['MONOLITHE', '—', `52${sku}`, '2', '0', '2', '0', '—', 'Propose a correction']);
    expect(await stockRow(g, code54).locator('td').nth(3).textContent()).toBe('0');
    expect(await g.locator('[data-testid=stock-no-piece], [data-testid=stock-to-order], [data-testid=stock-unbacked]').count()).toBe(0);
    await shot(g, 'agent-stock');

    // Two proposals: one down (a piece damaged), one up (the clock moves on: the newest first).
    h.clock.advance(MINUTE);
    await stockRow(g, sku).locator('[data-testid=stock-propose]').click();
    expect(await g.locator('dialog .dialog__title').textContent()).toBe('Propose a correction');
    expect(await g.locator('dialog .dialog__eyebrow').textContent()).toBe('MONOLITHE · 52 · FRANCE WAREHOUSE');
    expect(await g.locator('dialog .dialog__text').textContent()).toBe('A count, a piece found or damaged: ORBES approves it before the stock moves.');
    await g.fill('dialog input[name=delta]', '0');
    await g.fill('dialog textarea[name=reason]', 'Counted.');
    await g.click('[data-testid=dialog-confirm]');
    await expect.poll(() => g.locator('dialog .dialog__error').textContent()).toBe('Correct the count by a number of pieces, up (12) or down (-2).');
    await g.fill('dialog input[name=delta]', '-1');
    await g.fill('dialog textarea[name=reason]', 'One piece scratched in its box.');
    await shot(g, 'agent-propose', { dialog: true });
    await confirmDialog(g);
    await g.waitForSelector('.toast:has-text("Correction proposed: ORBES approves it.")');
    h.clock.advance(MINUTE);
    await stockRow(g, sku).locator('[data-testid=stock-propose]').click();
    await g.fill('dialog input[name=delta]', '3');
    await g.fill('dialog textarea[name=reason]', 'Found on the shelf.');
    await confirmDialog(g);
    // Nothing moved yet.
    await expect.poll(() => stockRow(g, sku).locator('td').nth(3).textContent()).toBe('2');
    await expect.poll(() => tabTexts(g)).toEqual(['Stock', 'Returns (0)', 'Corrections (2)']);
    await g.click('[data-testid=logistics-tab-corrections]');
    // Its two, and ORBES's own count of the pieces, applied at once.
    await expect.poll(() => g.locator('[data-testid=correction-status]').allTextContents()).toEqual(['TO APPROVE', 'TO APPROVE', 'APPROVED']);
    expect(await g.locator('[data-testid=correction-delta]').allTextContents()).toEqual(['+3', '-1', '+2']);
    expect(await g.locator('[data-testid=correction-approve]').count()).toBe(0);

    // ORBES: Logistics in the sidebar, in the Atelier's place; every location, its filter, its columns.
    const a = await open(ADMIN, 'Dashboard');
    const registry = a.locator('.side__group', { hasText: 'Registry' }).locator('.side__link');
    expect(await registry.evaluateAll((links) => links.map((x) => x.getAttribute('data-route')))).toEqual(['products', 'genomes', 'codes', 'catalogue', 'logistics', 'supplierOrders']);
    await a.click('.side__link[data-route=logistics]');
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Logistics');
    expect(await a.locator('.side__link.is-active').textContent()).toBe('Logistics');
    expect(await tabTexts(a)).toEqual(['Stock', 'Returns (0)', 'Corrections (2)']);
    expect(await a.locator('#logistics-stock thead th').allTextContents()).toEqual(['Model', 'Variant', 'Size', 'Location', 'On hand', 'Reserved', 'Available', 'Waiting', 'Minimum', 'To order', '']);
    await expect.poll(() => stockRow(a, sku).count()).toBe(2);
    await a.selectOption('[data-testid=logistics-location]', warehouse);
    await expect.poll(() => stockRow(a, sku).count()).toBe(1);
    expect(await stockRow(a, sku).locator('td').nth(3).textContent()).toBe('LOGISTICS WAREHOUSE');
    await a.selectOption('[data-testid=logistics-location]', '');
    await expect.poll(() => stockRow(a, sku).count()).toBe(2);

    // The agent's corrections: the one down approved, the one up declined with a note.
    await a.click('[data-testid=logistics-tab-corrections]');
    await expect.poll(() => a.locator('[data-testid=correction-approve]').count()).toBe(2);
    expect(await a.locator('#logistics-corrections .panel__text').textContent()).toBe('A correction proposed by the agent moves the stock only once ORBES approves it.');
    const down = a.locator('#logistics-corrections tbody tr', { hasText: 'scratched' });
    await down.locator('[data-testid=correction-approve]').click();
    expect(await a.locator('dialog .dialog__text').first().textContent()).toBe('The count of MONOLITHE · 52 at FRANCE WAREHOUSE moves by -1.');
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Correction approved.")');
    const up = a.locator('#logistics-corrections tbody tr', { hasText: 'Found on the shelf.' });
    await up.locator('[data-testid=correction-decline]').click();
    await a.fill('dialog textarea[name=note]', 'Counted again at ORBES: two pieces.');
    await shot(a, 'decline', { dialog: true });
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Correction declined.")');
    await expect.poll(() => tabTexts(a)).toEqual(['Stock', 'Returns (0)', 'Corrections (0)']);
    expect(await a.locator('[data-testid=correction-status]').allTextContents()).toEqual(['DECLINEDCounted again at ORBES: two pieces.', 'APPROVED', 'APPROVED']);
    await shot(a, 'corrections');

    // The agent reads both, ORBES's note with the declined one; the stock moved by the approved one only.
    await g.reload();
    await expect.poll(() => g.locator('[data-testid=correction-status] .status__text').allTextContents()).toEqual(['DECLINED', 'APPROVED', 'APPROVED']);
    expect(await g.locator('[data-testid=correction-note]').allTextContents()).toEqual(['Counted again at ORBES: two pieces.']);
    await g.click('[data-testid=logistics-tab-stock]');
    await expect.poll(() => stockRow(g, sku).locator('td').nth(3).textContent()).toBe('1');

    // A count no ORBES identity backs (a hand count of before): NO PIECE for ORBES, with the notice; never for the agent.
    await h.ctx.services.stock.adjust({ skuId: sku54, locationId: france, delta: 1, note: 'Counted by hand.' }, admin);
    await a.click('[data-testid=logistics-tab-stock]');
    await expect.poll(() => a.locator('[data-testid=stock-unbacked]').textContent()).toBe(
      '1 size has pieces counted that no ORBES identity backs. An order holding them cannot be packed: count their pieces in, or correct the count down.',
    );
    const row54 = stockRow(a, code54, 'FRANCE WAREHOUSE');
    expect(await row54.locator('[data-testid=stock-no-piece]').textContent()).toBe('NO PIECE · 1');
    expect(await stockRow(a, sku, 'FRANCE WAREHOUSE').locator('[data-testid=stock-count-in]').count()).toBe(0);
    await g.reload();
    await expect.poll(() => stockRow(g, code54).locator('td').nth(3).textContent()).toBe('1');
    expect(await g.locator('[data-testid=stock-no-piece], [data-testid=stock-unbacked]').count()).toBe(0);
    // Its piece, a one-off of the Generator, counted in.
    const oneOff = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: catalog.modelId, material: '925 STERLING SILVER', variant: '54' }, admin);
    await row54.locator('[data-testid=stock-count-in]').click();
    expect(await a.locator('dialog .dialog__text').textContent()).toBe(
      'Name the pieces of MONOLITHE · 54 that are on the shelf: they enter the stock with their ORBES identity. The count does not move.',
    );
    await a.fill('dialog textarea[name=serials]', 'O26-J-99999');
    await a.fill('dialog textarea[name=note]', 'The one-off on the shelf.');
    await a.click('[data-testid=dialog-confirm]');
    await expect.poll(() => a.locator('dialog .dialog__error').textContent()).toBe('Product not found.');
    await a.fill('dialog textarea[name=serials]', oneOff.product.productId.toLowerCase());
    await shot(a, 'count-in', { dialog: true });
    await confirmDialog(a);
    await a.waitForSelector('.toast:has-text("Pieces counted in.")');
    await expect.poll(() => a.locator('[data-testid=stock-unbacked]').count()).toBe(0);
    expect(await a.locator('[data-testid=stock-no-piece]').count()).toBe(0);
    await shot(a, 'staff-stock');
    for (const p of [a, g]) {
      expect(await figuresInDisplayFace(p)).toEqual([]);
      expect(await csp(p)).toEqual([]);
      await p.context().close();
    }
  }, STEP_TIMEOUT);

  it('lists a return to receive at the agent\'s location; the agent records the parcel back, and ORBES then decides', async () => {
    const orderId = await salonOrder('52');
    await h.ctx.services.orders.setBuyer(orderId, { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris' }, admin);
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(orderId, { to: 'PAID' }, admin);
    await packAndShip(h.ctx, orderId, { carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    await h.ctx.services.logistics.markDelivered(orderId, admin, null);
    const opened = await h.ctx.services.orderCases.open(orderId, { kind: 'RETURN', reason: 'SIZE', note: 'Too small.' }, admin);
    const reference = orderReference(orderId);

    const g = await open(agentLogin, 'Logistics');
    expect(await tabTexts(g)).toEqual(['Stock', 'Returns (1)', 'Corrections (0)']);
    await g.click('[data-testid=logistics-tab-returns]');
    await expect.poll(() => g.locator('#logistics-returns thead th').allTextContents()).toEqual(['Order', 'Kind', 'Piece', 'Opened on', '']);
    const row = g.locator('#logistics-returns tbody tr');
    expect(await row.count()).toBe(1);
    // The agent reads the reference only, never a link to the order's page.
    expect(await row.locator('td').first().textContent()).toBe(reference);
    expect(await row.locator('a').count()).toBe(0);
    expect(await row.locator('[data-testid=case-kind]').textContent()).toBe('RETURN');
    expect(await row.locator('td').nth(2).textContent()).toBe('MONOLITHE · 52');
    await row.locator('[data-testid=case-received]').click();
    expect(await g.locator('dialog .dialog__title').textContent()).toBe('The parcel is back');
    expect(await g.locator('dialog .dialog__text').textContent()).toBe('ORBES then decides: back to stock, a refund, or the other size.');
    await g.click('[data-testid=dialog-confirm]');
    await expect.poll(() => g.locator('dialog .dialog__error').textContent()).toBe('Complete the required fields.');
    await g.selectOption('dialog select[name=pieceState]', 'OK');
    await g.fill('dialog textarea[name=note]', 'In its box, unworn.');
    await shot(g, 'received', { dialog: true });
    await confirmDialog(g);
    await g.waitForSelector('.toast:has-text("Recorded: ORBES decides.")');
    await expect.poll(() => g.locator('#logistics-returns .empty__text').textContent()).toBe('No parcel expected back.');
    expect(await tabTexts(g)).toEqual(['Stock', 'Returns (0)', 'Corrections (0)']);
    expect(await h.ctx.services.orderCases.get(opened.id)).toMatchObject({ status: 'RECEIVED', received: { pieceState: 'OK', note: 'In its box, unworn.' } });
    expect(await csp(g)).toEqual([]);
    await g.context().close();
  }, STEP_TIMEOUT);
});
