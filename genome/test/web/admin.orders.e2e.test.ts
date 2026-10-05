/**
 * The orders, the atelier and their settings in the console, end to end (plan LIVE RELEASE+, step S2): the production
 * web build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. The board: six columns, the cards of every channel (a private-salon order reserved three days ago stands out as
 *     late, a LIVE RELEASE's piece with its add-on, the collector's LR- reference and the surprise), the filters (late
 *     only, a channel, a search), the CSV.
 *  2. An order's page: its terms and its buyer entered, MARK PAID; its piece made at the atelier (START, DONE: the claim
 *     code shown once), linked to it; SHIP with a carrier, the tracking number and its link, a declared value; MARK
 *     DELIVERED; its history. Its packing slip: the piece, its size, add-ons, engraving and surprise, never a price; in
 *     print, the slip alone. A piece picked from the stock for an order holding one, paid: no SHIP until it is linked.
 *  3. The atelier: a minimum set, its suggestion confirmed into pieces to make for the stock; their work sheets, each
 *     with its reference and its ORBES code drawn at 30 mm (in print too); the CSV of what to make.
 *  4. Returns and invoices (step S4): the delivered order's invoice on its page (its PDF); its piece registered by its
 *     buyer, a return opened back to stock: the new claim code shown once with its card to download, the return and
 *     the credit note on the page; the Invoices page (Clients): the month's documents, their totals, a PDF, the CSV.
 *  5. The settings (ADMIN): the delays of the alerts, a carrier added with its tracking link's example, a location
 *     renamed.
 *  6. An AUDITOR reads the board, an order and the invoices, the emails and the buyer masked, without one action; no
 *     work sheet.
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
import { inTransaction } from '../../src/server/db/connection.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OPERATOR = { email: 'orders.operator@orbes.test', password: 'orders operator passphrase 2026' };
const AUDITOR = { email: 'orders.auditor@orbes.test', password: 'orders auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

describe.skipIf(!HAS_CHROMIUM)('the orders and the atelier in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let modelId: string;
  let admin: Actor;
  /** The server's clock runs `offset` ms from real time: three days back while the late order is made. */
  let offset = 0;
  const problems: string[] = [];
  /** The orders made for the scenes: a salon order reserved three days ago, a LIVE RELEASE's piece, a salon order held in stock. */
  const o = { late: '', live: '', stock: '' };
  let liveEntryId = '';
  let stockPiece = '';
  let collector = '';
  /** The claim code the atelier showed once for the late order's piece: its buyer registers the piece with it. */
  let lateClaim = '';

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

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
  }

  /** A print page has no page title: its document says it. */
  async function goPrint(p: Page, hash: string, testid: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await p.waitForSelector(`[data-testid=${testid}]`, { timeout: 15_000 });
  }

  async function confirmDialog(p: Page, phrase?: string): Promise<void> {
    if (phrase) await p.fill('[data-testid=dialog-phrase]', phrase);
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

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-orders-${name}.png`), fullPage: true });
  }

  /** A request of the private salon closed as ACCEPTED: its order, its size entered. */
  async function salonOrder(size: string): Promise<{ id: string; email: string }> {
    const account = await createAccount(ctx.db);
    const request = await ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: ctx.clock() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const order = await ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    await ctx.services.orders.setTerms(order.id, { sizeLabel: size }, admin);
    return { id: order.id, email: account.email };
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-orders-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    offset = -3 * DAY;
    ctx = await createContext(config, { db: t.db, clock: () => new Date(Date.now() + offset), keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    modelId = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await ctx.services.auth.createAdmin({ ...OPERATOR, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    const row = await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow();
    admin = { type: 'admin', id: row.id };

    // Three days ago: a salon order, reserved, its piece to make.
    const late = await salonOrder('52');
    o.late = late.id;
    collector = late.email;
    offset = 0;

    // A LIVE RELEASE's piece, confirmed now with its engraving add-on; its surprise as the release would carry it.
    const drop = await ctx.services.drops.create({ modelId, title: 'THE VAULT RING', quantity: 3, opensAt: new Date(Date.now() + 2 * MINUTE), closesAt: new Date(Date.now() + HOUR), earlyAccessHours: 0 }, admin);
    await ctx.db
      .updateTable('drops')
      .set({ mode: 'LIVE', live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1, price_minor: 480_000, currency: 'EUR', quantity_line: '3 PIECES', published_at: new Date() })
      .where('id', '=', drop.id)
      .execute();
    const size = await ctx.db.insertInto('drop_sizes').values({ drop_id: drop.id, label: '54', position: 1, stock: 3 }).returning('id').executeTakeFirstOrThrow();
    const addon = await ctx.db.insertInto('live_addons').values({ drop_id: drop.id, label: 'ENGRAVING', line: null, price_minor: 15_000, position: 1 }).returning('id').executeTakeFirstOrThrow();
    const buyer = await createAccount(ctx.db);
    await ctx.services.live.enter(buyer.id, drop.id, { sizeId: size.id, quantity: 1 }, buyer.actor);
    offset = 3 * MINUTE;
    await ctx.services.live.advance(drop.id);
    const token = (await ctx.services.live.entry(buyer.id, drop.id))!.turn!.token!;
    await ctx.services.live.press(buyer.id, drop.id, token);
    offset += 1500;
    await ctx.services.live.secure(buyer.id, drop.id, token, buyer.actor);
    await ctx.services.live.setAddons(buyer.id, drop.id, [addon.id], buyer.actor);
    await ctx.services.live.confirm(buyer.id, drop.id, buyer.actor);
    offset = 0;
    const entry = await ctx.db.selectFrom('live_entries').select('id').where('account_id', '=', buyer.id).executeTakeFirstOrThrow();
    liveEntryId = entry.id;
    o.live = (await ctx.db.selectFrom('orders').select('id').where('live_entry_id', '=', entry.id).executeTakeFirstOrThrow()).id;
    await ctx.db.updateTable('orders').set({ surprise: 'A silk pouch' }).where('id', '=', o.live).execute();
    await ctx.db.updateTable('bench_items').set({ surprise: 'A silk pouch' }).where('order_id', '=', o.live).execute();

    // A piece made in advance, counted in stock at FRANCE WAREHOUSE, and a salon order that holds it.
    const issued = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, variant: '56', material: '925 STERLING SILVER', withClaimSecret: true }, admin);
    stockPiece = issued.product.productId;
    const france = (await ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const sku = await inTransaction(ctx.db, (tx) => ensureSku(tx, modelId, '56'));
    await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted at the atelier.' }, admin);
    o.stock = (await salonOrder('56')).id;

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

  it('shows every order by step, the late one standing out, narrowed by the filters; the CSV', async () => {
    const p = await open(OPERATOR);
    // Its links in the sidebar: Orders and Invoices (Clients), Atelier (Registry), the settings from both; SIGN OUT still
    // within 900 px.
    for (const label of ['Orders', 'Invoices', 'Atelier']) expect(await p.locator('.side__link', { hasText: new RegExp(`^${label}$`) }).count(), label).toBe(1);
    expect(await p.locator('.side__link', { hasText: /^Settings$/ }).count()).toBe(0);
    for (const id of ['sign-out', 'change-password']) {
      const box = (await p.locator(`[data-testid=${id}]`).boundingBox())!;
      expect(box.y + box.height, id).toBeLessThanOrEqual(900);
    }
    await p.locator('.side__link', { hasText: /^Orders$/ }).click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Orders');
    expect(await p.locator('.board__title').allTextContents()).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']);
    const reserved = p.locator('[data-testid=column-RESERVED] [data-testid=order-card]');
    await expect.poll(() => reserved.count()).toBe(3);
    expect(await p.locator('[data-testid=orders-summary]').textContent()).toContain('3 orders · 1 late');
    expect(await p.locator('[data-testid=late-RESERVED]').textContent()).toBe('1 late');
    // The longest waiting first: the late one, with why.
    const first = reserved.first();
    expect(await first.getAttribute('data-order')).toBe(o.late);
    expect(await first.getAttribute('class')).toContain('ocard--late');
    expect(await first.textContent()).toContain('LATE · NOT PAID');
    expect(await first.textContent()).toMatch(/In this step 3 d/);
    expect(await first.textContent()).toContain(collector);
    const live = p.locator(`[data-order="${o.live}"]`);
    expect(await live.textContent()).toContain('THE VAULT RING');
    expect(await live.textContent()).toContain('MONOLITHE · 54');
    expect(await live.textContent()).toContain('ENGRAVING');
    expect(await live.textContent()).toContain('Surprise: A silk pouch');
    expect(await live.textContent()).toContain(`LR-${liveEntryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`);
    expect(await p.locator(`[data-order="${o.stock}"]`).textContent()).toContain('In stock at FRANCE WAREHOUSE');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'board');

    // Late only; a channel; a search by reference.
    await p.locator('label.ccheck', { hasText: 'Late only' }).click();
    await expect.poll(() => p.locator('[data-testid=order-card]').count()).toBe(1);
    await p.locator('label.ccheck', { hasText: 'Late only' }).click();
    await expect.poll(() => p.locator('[data-testid=order-card]').count()).toBe(3);
    await p.selectOption('select[name=channel]', 'LIVE');
    await expect.poll(() => p.locator('[data-testid=order-card]').count()).toBe(1);
    await p.selectOption('select[name=channel]', '');
    await p.fill('input[name=q]', orderReference(o.stock));
    await p.press('input[name=q]', 'Enter');
    await expect.poll(() => p.locator('[data-testid=order-card]').count()).toBe(1);
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=orders-csv]')]);
    expect(download.suggestedFilename()).toMatch(/^ORBES-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8').trim().split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain(`"${orderReference(o.stock)}"`);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('takes an order through its steps: terms, buyer, paid; its piece made and linked; shipped and delivered; its packing slip without a price; a piece picked from the stock before it ships', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/orders/${o.late}`, orderReference(o.late));
    expect(await p.locator('[data-testid=order-late]').textContent()).toContain('Reserved for over 2 days, not paid yet.');
    expect(await p.locator('[data-testid=order-holds]').textContent()).toBe('To make');
    expect(await p.locator('#order-step').textContent()).toContain('Its piece is being made at the atelier; its price is to be entered.');
    // Only the steps that apply: no SHIP, no DELIVERED before it is paid; not paid before it is priced (its invoice).
    expect(await p.locator('[data-testid=order-ship]').count()).toBe(0);
    expect(await p.locator('[data-testid=order-deliver]').count()).toBe(0);
    expect(await p.locator('[data-testid=order-pay]').count()).toBe(0);

    await p.click('[data-testid=order-terms]');
    await p.fill('dialog input[name=price]', '4 800');
    await p.selectOption('dialog select[name=currency]', 'EUR');
    await p.fill('dialog input[name=engraving]', 'A. & L.');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-facts').textContent()).toMatch(/€\s4\s800/u);
    expect(await p.locator('#order-facts').textContent()).toContain('A. & L.');
    // Paid before its buyer is entered, its invoice would carry the account's email only: the dialog says so.
    await p.click('[data-testid=order-pay]');
    await expect.poll(() => p.locator('dialog [data-testid=pay-no-buyer]').textContent()).toBe(
      'No buyer is entered on the order: its invoice will carry the account’s email only. An invoice is never changed: enter the buyer first.',
    );
    await p.click('[data-testid=dialog-cancel]');
    await p.waitForSelector('dialog.dialog', { state: 'detached' });
    await p.click('[data-testid=order-buyer]');
    await p.fill('dialog input[name=name]', 'Jane Doe');
    await p.fill('dialog textarea[name=address]', '1 rue de la Paix\n75002 Paris\nFrance');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=buyer-name]').textContent()).toBe('Jane Doe');
    await p.click('[data-testid=order-pay]');
    await p.fill('dialog textarea[name=note]', 'Paid by transfer.');
    expect(await p.locator('dialog [data-testid=pay-no-buyer]').count()).toBe(0);
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-step .osteps__step.is-current .osteps__label').textContent()).toBe('PAID');
    expect(await p.locator('[data-testid=order-late]').count()).toBe(0);
    expect(await p.locator('#order-history tbody tr').first().textContent()).toContain('Paid by transfer.');
    await shot(p, 'order-paid');

    // The atelier makes its piece: started, finished; its claim code shown once.
    await go(p, '#/atelier', 'Atelier');
    const group = p.locator('[data-testid=bench-group]', { hasText: 'PRIVATE SALON · MONOLITHE · 52' });
    expect(await group.locator('tbody tr').count()).toBe(1);
    expect(await group.textContent()).toContain('Engraving: A. & L.');
    await group.locator('[data-testid=bench-start]').click();
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=bench-group]', { hasText: 'PRIVATE SALON · MONOLITHE · 52' }).locator('[data-testid=bench-done]').count()).toBe(1);
    await p.locator('[data-testid=bench-group]', { hasText: 'PRIVATE SALON · MONOLITHE · 52' }).locator('[data-testid=bench-done]').click();
    expect(await p.inputValue('dialog input[name=material]')).toBe('925 STERLING SILVER');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog [data-testid=claim-code]').textContent()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    lateClaim = (await p.locator('dialog [data-testid=claim-code]').textContent())!;
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=bench-group]', { hasText: 'PRIVATE SALON · MONOLITHE · 52' }).count()).toBe(0);

    // Linked to its order, which ships: a carrier, the tracking number with its link, a declared value.
    await go(p, `#/orders/${o.late}`, orderReference(o.late));
    await expect.poll(() => p.locator('[data-testid=order-holds]').textContent()).toMatch(/^Piece O26-J-\d{5}$/);
    await p.click('[data-testid=order-ship]');
    await p.selectOption('dialog select[name=carrierId]', { label: 'Colissimo' });
    await p.fill('dialog input[name=trackingNumber]', '6A12345678901');
    await p.fill('dialog input[name=declaredValue]', '4800');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=order-tracking]').getAttribute('href')).toBe('https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901');
    expect(await p.locator('#order-shipment').textContent()).toMatch(/€\s4\s800/u);
    await p.click('[data-testid=order-deliver]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-step .osteps__step.is-current .osteps__label').textContent()).toBe('DELIVERED');
    expect(await p.locator('#order-history tbody tr').allTextContents()).toHaveLength(8);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'order-delivered');

    // Its packing slip: the piece, its size, the engraving; never a price nor the declared value.
    await p.click('a.cbtn:has-text("Packing slip")');
    await p.waitForSelector('[data-testid=packing-slip]');
    const slip = (await p.locator('[data-testid=packing-slip]').textContent())!;
    expect(await p.locator('[data-testid=slip-reference]').textContent()).toBe(orderReference(o.late));
    expect(await p.locator('[data-testid=slip-size]').textContent()).toBe('52');
    expect(await p.locator('[data-testid=slip-engraving]').textContent()).toBe('A. & L.');
    expect(await p.locator('[data-testid=slip-buyer-name]').textContent()).toBe('Jane Doe');
    expect(slip).not.toMatch(/€|4\s800|4800|480000/u);
    expect(await p.locator('[data-testid=packing-slip]').getAttribute('lang')).toBe('en');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'slip');
    await p.emulateMedia({ media: 'print' });
    expect(await p.locator('.side').isVisible()).toBe(false);
    expect(await p.locator('.printbar').isVisible()).toBe(false);
    expect(await p.locator('[data-testid=packing-slip]').isVisible()).toBe(true);
    await p.emulateMedia({ media: 'screen' });

    // The LIVE order's slip: its add-on and its surprise.
    await goPrint(p, `#/orders/${o.live}/slip`, 'packing-slip');
    expect(await p.locator('[data-testid=slip-addons]').textContent()).toBe('ENGRAVING');
    expect(await p.locator('[data-testid=slip-surprise]').textContent()).toBe('A silk pouch');
    expect(await p.locator('[data-testid=slip-source]').textContent()).toMatch(/^LR-/);

    // A piece picked from the stock for the order holding one, priced and paid: it ships only once its piece is linked.
    await ctx.services.orders.setTerms(o.stock, { priceMinor: 300_000, currency: 'EUR' }, admin);
    await ctx.services.orders.transition(o.stock, { to: 'PAID' }, admin);
    await go(p, `#/orders/${o.stock}`, orderReference(o.stock));
    expect(await p.locator('#order-step').textContent()).toContain('Link its piece from the stock.');
    expect(await p.locator('[data-testid=order-ship]').count()).toBe(0);
    await p.click('[data-testid=order-link]');
    await p.fill('dialog input[name=productId]', stockPiece.toLowerCase());
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=order-holds]').textContent()).toBe(`Piece ${stockPiece}`);
    expect(await p.locator('[data-testid=order-link]').count()).toBe(0);
    expect(await p.locator('[data-testid=order-ship]').count()).toBe(1);
    expect(await p.locator('#order-step').textContent()).not.toContain('Link its piece from the stock.');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('sets a minimum and confirms its suggestion; prints the work sheets, each code at 30 mm; the CSV of what to make', async () => {
    const p = await open(OPERATOR);
    await go(p, '#/atelier', 'Atelier');
    // The LIVE order's piece to make, its add-on and surprise.
    const liveGroup = p.locator('[data-testid=bench-group]', { hasText: 'THE VAULT RING · MONOLITHE · 54' });
    expect(await liveGroup.textContent()).toContain('ENGRAVING');
    expect(await liveGroup.textContent()).toContain('Surprise: A silk pouch');
    await p.click('[data-testid=stock-minimum]');
    await p.selectOption('dialog select[name=skuId]', { label: 'MONOLITHE · 54 · MNL-RG-54' });
    await p.selectOption('dialog select[name=locationId]', { label: 'LOGISTICS WAREHOUSE' });
    await p.fill('dialog input[name=minimum]', '2');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=stock-suggestions]').textContent()).toMatch(/^1 minimum is not reached/);
    const row = p.locator('#atelier-stock tbody tr', { has: p.locator('[data-testid=stock-suggestion]') });
    expect(await row.textContent()).toContain('LOGISTICS WAREHOUSE');
    await row.locator('[data-testid=stock-make]').click();
    expect(await p.inputValue('dialog input[name=quantity]')).toBe('2');
    await confirmDialog(p);
    const stockGroup = p.locator('[data-testid=bench-group]', { hasText: 'FOR STOCK · MONOLITHE · 54' });
    await expect.poll(() => stockGroup.locator('tbody tr').count()).toBe(2);
    expect(await stockGroup.locator('.bench__counts').textContent()).toBe('2 to make');
    expect(await p.locator('[data-testid=stock-suggestions]').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'atelier');

    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=atelier-csv]')]);
    expect(download.suggestedFilename()).toMatch(/^ORBES-atelier-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(readFileSync((await download.path())!, 'utf8')).toContain('"FOR STOCK","MONOLITHE","54"');

    // Their work sheets: the reference and the ORBES code, drawn at 30 mm.
    await stockGroup.locator('a.cbtn', { hasText: 'Work sheets' }).click();
    await p.waitForSelector('[data-testid=work-sheet]');
    expect(await p.locator('[data-testid=work-sheet]').count()).toBe(2);
    const references = await p.locator('[data-testid=sheet-reference]').allTextContents();
    expect(references.every((r) => /^O26-J-\d{5}$/.test(r))).toBe(true);
    expect(await p.locator('[data-testid=sheet-for]').first().textContent()).toBe('The stock');
    const width = await p.locator('[data-testid=sheet-code] svg').first().evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeCloseTo((30 / 25.4) * 96, 0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'sheets');
    await p.emulateMedia({ media: 'print' });
    expect(await p.locator('.printbar').isVisible()).toBe(false);
    expect(Number.parseFloat(await p.locator('[data-testid=sheet-code] svg').first().evaluate((el) => getComputedStyle(el).width))).toBeCloseTo((30 / 25.4) * 96, 1);
    expect(await p.locator('[data-testid=work-sheet]').first().evaluate((el) => getComputedStyle(el).breakAfter)).toBe('page');
    await p.emulateMedia({ media: 'screen' });
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('returns and invoices: the invoice on the order\'s page; a return back to stock, the new claim code once with its card; the Invoices page, its PDFs and its CSV', async () => {
    // The late order, delivered, its piece registered by its buyer (its warranty started at the sale).
    const piece = await ctx.db.selectFrom('orders as o').innerJoin('products as p', 'p.id', 'o.product_id').select(['p.id', 'p.product_id', 'o.account_id']).where('o.id', '=', o.late).executeTakeFirstOrThrow();
    const code = await ctx.db.selectFrom('codes').select('id').where('product_id', '=', piece.id).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow();
    await ctx.services.warranty.activate(piece.id, { purchaseDate: new Date().toISOString().slice(0, 10), retailer: 'ORBES PARIS', country: 'FR' }, admin);
    const scan = await ctx.services.verification.verify({ code: (await ctx.services.issuance.printableCode(code.id)).data }, {});
    await ctx.services.ownership.registerFirst(piece.account_id, { registrationToken: scan.registration!.token, claimCode: lateClaim }, { type: 'account', id: piece.account_id });

    const p = await open(OPERATOR);
    await go(p, `#/orders/${o.late}`, orderReference(o.late));
    // Its invoice, issued when it was paid: its PDF.
    const documents = p.locator('#order-documents tbody tr');
    await expect.poll(() => documents.count()).toBe(1);
    expect(await documents.first().textContent()).toMatch(/INV-\d{4}-000001\s*Invoice/);
    expect(await documents.first().textContent()).toMatch(/€\s4\s800/u);
    const [invoicePdf] = await Promise.all([p.waitForEvent('download'), documents.first().locator('[data-testid=document-pdf]').click()]);
    expect(invoicePdf.suggestedFilename()).toMatch(/^ORBES-invoice-INV-\d{4}-000001\.pdf$/);
    expect(readFileSync((await invoicePdf.path())!).subarray(0, 5).toString()).toBe('%PDF-');

    // A return back to stock: where, and why.
    await p.click('[data-testid=order-return]');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Complete the required fields.');
    await p.selectOption('dialog select[name=outcome]', 'RESTOCKED');
    await expect.poll(() => p.locator('dialog').textContent()).toContain('with a new claim code for its new certificate card');
    await p.fill('dialog textarea[name=note]', 'Returned unworn within the delay.');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Choose the location the piece goes back to.');
    await p.selectOption('dialog select[name=locationId]', { label: 'FRANCE WAREHOUSE' });
    await p.click('[data-testid=dialog-confirm]');
    // Back to stock: the new claim code, once, with its card (ORBES took the ownership back).
    await expect.poll(() => p.locator('dialog [data-testid=claim-code]').textContent()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const fresh = (await p.locator('dialog [data-testid=claim-code]').textContent())!;
    expect(fresh).not.toBe(lateClaim);
    const [card] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=return-card]')]);
    expect(card.suggestedFilename()).toMatch(/\.pdf$/);
    await shot(p, 'return-claim-code');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-step .osteps__step.is-current .osteps__label').textContent()).toBe('RETURNED');
    expect(await p.locator('[data-testid=return-outcome]').textContent()).toBe('Back to stock · FRANCE WAREHOUSE');
    expect(await p.locator('#order-return').textContent()).toContain('Taken back by ORBES from its buyer');
    await expect.poll(() => documents.count()).toBe(2);
    expect(await documents.nth(1).textContent()).toMatch(/CN-\d{4}-000001\s*Credit note/);
    expect(await p.locator('[data-testid=order-return]').count()).toBe(0);
    expect(await p.locator('body').textContent()).not.toContain(fresh);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'order-returned');

    // The Invoices page: the month's documents, the latest first, and their totals.
    await p.locator('.side__link', { hasText: /^Invoices$/ }).click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Invoices');
    const rows = p.locator('#invoices-list tbody tr');
    await expect.poll(() => rows.count()).toBe(3);
    const texts = await rows.allTextContents();
    expect(texts[0]).toMatch(/CN-\d{4}-000001\s*Credit note/);
    expect(texts[0]).toContain('Jane Doe');
    expect(texts[0]).toMatch(/Cancels INV-\d{4}-000001/);
    expect(texts.some((x) => /INV-\d{4}-000002/.test(x) && x.includes(orderReference(o.stock)))).toBe(true);
    expect(texts.some((x) => /INV-\d{4}-000001/.test(x) && /Cancelled by CN-\d{4}-000001/.test(x))).toBe(true);
    const totals = await p.locator('#invoices-totals tbody tr').textContent();
    expect(totals).toMatch(/EUR\s*€\s7\s800\s*€\s4\s800\s*€\s3\s000/u);
    // One kind; a search; the order's page from its reference.
    await p.selectOption('select[name=kind]', 'CREDIT_NOTE');
    await expect.poll(() => rows.count()).toBe(1);
    // The month's totals stay the whole month's, whatever the list keeps.
    expect(await p.locator('#invoices-totals tbody tr').textContent()).toBe(totals);
    await p.selectOption('select[name=kind]', '');
    await p.fill('input[name=q]', orderReference(o.stock));
    await p.press('input[name=q]', 'Enter');
    await expect.poll(() => rows.count()).toBe(1);
    const [pdf] = await Promise.all([p.waitForEvent('download'), rows.first().locator('[data-testid=invoice-pdf]').click()]);
    expect(pdf.suggestedFilename()).toMatch(/^ORBES-invoice-INV-\d{4}-000002\.pdf$/);
    const [csv] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=invoices-csv]')]);
    expect(csv.suggestedFilename()).toMatch(/^ORBES-invoices-\d{4}-\d{2}\.csv$/);
    const lines = readFileSync((await csv.path())!, 'utf8').trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('"vat rate","vat","total"');
    await p.fill('input[name=q]', '');
    await p.press('input[name=q]', 'Enter');
    await expect.poll(() => rows.count()).toBe(3);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'invoices');
    await rows.first().locator('a.idlink').click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe(orderReference(o.late));
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('changes the settings (ADMIN): the delays of the alerts, a carrier with its tracking link, a location renamed', async () => {
    const p = await open(ADMIN);
    // An ADMIN's sidebar (Team too) still fits a 900 px screen with its foot.
    for (const id of ['sign-out', 'change-password']) {
      const box = (await p.locator(`[data-testid=${id}]`).boundingBox())!;
      expect(box.y + box.height, id).toBeLessThanOrEqual(900);
    }
    await go(p, '#/orders', 'Orders');
    await p.click('a.cbtn:has-text("Settings")');
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Settings');
    expect(await p.locator('[data-testid=alert-reserved]').textContent()).toBe('Over 2 days');
    await p.click('[data-testid=alerts-edit]');
    await p.fill('dialog input[name=reservedDays]', '0');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Reserved: 1 to 90 days.');
    await p.fill('dialog input[name=reservedDays]', '5');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=alert-reserved]').textContent()).toBe('Over 5 days');

    await p.click('[data-testid=carrier-add]');
    await p.fill('dialog input[name=name]', 'FedEx');
    await p.fill('dialog input[name=trackingUrl]', 'https://www.fedex.com/fedextrack/?trknbr={tracking}');
    await expect.poll(() => p.locator('dialog [data-testid=carrier-example]').textContent()).toBe('With 6A12345678901: https://www.fedex.com/fedextrack/?trknbr=6A12345678901');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=carrier-name]').allTextContents()).toContain('FedEx');

    await p.locator('#settings-locations tbody tr', { hasText: 'LOGISTICS WAREHOUSE' }).locator('[data-testid=location-rename]').click();
    await p.fill('dialog input[name=name]', 'LOGISTICS PARTNER');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=location-name]').allTextContents()).toEqual(['FRANCE WAREHOUSE', 'LOGISTICS PARTNER']);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'settings');

    // The board says the new delay: the order of three days ago is no longer late.
    await go(p, '#/orders', 'Orders');
    expect(await p.locator('[data-testid=orders-summary]').textContent()).toContain('Reserved 5 days');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('lets an AUDITOR read the board and an order, the emails and the buyer masked, without one action; no work sheet', async () => {
    const a = await open(AUDITOR);
    await go(a, '#/orders', 'Orders');
    await expect.poll(() => a.locator('[data-testid=order-card]').count()).toBe(3);
    expect(await a.locator('body').textContent()).not.toContain(collector);
    expect(await a.locator(`[data-order="${o.late}"]`).textContent()).toContain(`${collector[0]}***@example.com`);
    await go(a, `#/orders/${o.late}`, orderReference(o.late));
    expect(await a.locator('[data-testid=buyer-name]').textContent()).toBe('J*** D***');
    expect(await a.locator('[data-testid=buyer-address]').textContent()).toBe('***');
    for (const action of ['order-pay', 'order-ship', 'order-deliver', 'order-cancel', 'order-return', 'order-terms', 'order-buyer', 'order-location', 'order-link']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    // Its documents read; on the Invoices page, the buyer masked.
    await expect.poll(() => a.locator('#order-documents tbody tr').count()).toBe(2);
    await go(a, '#/invoices', 'Invoices');
    await expect.poll(() => a.locator('#invoices-list tbody tr').count()).toBe(3);
    expect(await a.locator('[data-testid=invoice-buyer]').first().textContent()).toBe('J*** D***');
    expect(await a.locator('#invoices-list').textContent()).not.toContain('Jane Doe');
    await go(a, `#/orders/${o.late}`, orderReference(o.late));
    await a.click('a.cbtn:has-text("Packing slip")');
    await a.waitForSelector('[data-testid=packing-slip]');
    expect(await a.locator('[data-testid=slip-buyer-name]').textContent()).toBe('J*** D***');
    await go(a, '#/atelier', 'Atelier');
    for (const action of ['bench-start', 'bench-done', 'bench-cancel', 'stock-make', 'stock-minimum', 'stock-correct']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    expect(await a.locator('a.cbtn', { hasText: /Work sheet/ }).count()).toBe(0);
    await go(a, '#/atelier/sheets?origin=STOCK', 'Work sheets');
    expect(await a.locator('.empty__text').textContent()).toBe('A work sheet carries the piece’s ORBES code: an OPERATOR prints it.');
    await go(a, '#/settings', 'Settings');
    for (const action of ['alerts-edit', 'carrier-add', 'carrier-edit', 'location-add', 'location-rename']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    expect(await figuresInDisplayFace(a)).toEqual([]);
    expect(await csp(a)).toEqual([]);
    await a.context().close();
  }, STEP_TIMEOUT);
});
