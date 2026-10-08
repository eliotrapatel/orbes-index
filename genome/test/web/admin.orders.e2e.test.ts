/**
 * The orders, the atelier and their settings in the console, end to end (plan LIVE RELEASE+, step S2): the production
 * web build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. The board: six columns, the cards of every channel (a private-salon order reserved three days ago stands out as
 *     late, a LIVE RELEASE's piece with its add-on, the collector's LR- reference and the surprise), the filters (late
 *     only, a channel, a search), the CSV.
 *  2. An order's page: its terms and its buyer entered, MARK PAID; waiting for supplier stock (plan NEXT LOT §3.5), a
 *     piece received in stock serves it; its Shipping section (§3.5.4.4): Start packing, the card scanned by its photo,
 *     the packing photo, the checklist, Packed, Ship with a carrier, the tracking number and its link, a declared value;
 *     Mark delivered; its history. Its packing slip: the piece, its size, add-ons, engraving and surprise, never a
 *     price; in print, the slip alone. An order holding a piece in stock, paid: it ships with its parcel, no Link a piece.
 *  3. The Atelier's old addresses (#/atelier, its work sheets) lead to Logistics (§3.5.4.5).
 *  4. Returns and invoices (step S4): the delivered order's invoice on its page (its PDF); its piece registered by its
 *     buyer, a return opened as an order case (§3.5.4.4), the parcel back at the agent, decided back to stock: the new
 *     claim code shown once with its card to download, the return and the credit note on the page; the Invoices page (Clients): the month's documents, their totals, a PDF, the CSV.
 *  5. The settings (ADMIN): the delays of the alerts, a carrier added with its tracking link's example, a location
 *     renamed.
 *  6. An AUDITOR reads the board, an order and the invoices, the emails and the buyer masked, without one action.
 * No CSP violation, no page error, no figure in the display face.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { fromBase64Url } from '../../src/core/bytes.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { orderReference } from '../../src/server/services/orders.js';
import { sizesForExchange } from '../../src/server/services/sizes.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { codeSource, phonePhoto } from '../e2e/support.js';
import { stockPiece as stockPieceFor, stockPieces, type StockedPiece } from '../support/fulfil.js';
import { writePng } from '../support/image-io.js';
import { jpegPhoto } from '../support/images.js';
import { createAccount, holdPieces } from '../support/live.js';

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

  /**
   * The phone's twin of a screen the next nine adds (plan NEXT-NINE, Phase 10: every new screen at a phone's size and a
   * desk's): the whole page at 390 × 844, then the desk's size again.
   */
  async function phoneTwin(p: Page, file: string): Promise<void> {
    const desk = p.viewportSize() ?? { width: 1440, height: 900 };
    await p.setViewportSize({ width: 390, height: 844 });
    try {
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      await p.screenshot({ path: join(OUT_DIR, file), fullPage: true });
    } finally {
      await p.setViewportSize(desk);
    }
  }

  async function shot(p: Page, name: string, opts: { phone?: boolean } = {}): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      // From the top: a page captured whole while scrolled draws its sticky sidebar and bar where it stopped.
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-orders-${name}.png`), fullPage: true });
    if (opts.phone) await phoneTwin(p, `admin-orders-${name}-phone.png`);
  }

  /** A photo of a piece's card, its ORBES CODE as printed (the scan's photo fallback). */
  function cardPhoto(piece: StockedPiece, name: string): string {
    const file = join(workDir, name);
    writePng(file, phonePhoto(codeSource({ data: fromBase64Url(piece.data), genomeGlyphs: piece.glyphs })));
    return file;
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

    // Three days ago: a salon order, reserved, waiting for supplier stock.
    const late = await salonOrder('52');
    o.late = late.id;
    collector = late.email;
    offset = 0;

    // A LIVE RELEASE's piece, confirmed now with its engraving add-on; its surprise as the release would carry it.
    const drop = await ctx.services.drops.create({ modelId, title: 'THE VAULT RING', quantity: 3, opensAt: new Date(Date.now() + 2 * MINUTE), closesAt: new Date(Date.now() + HOUR), earlyAccessHours: 0 }, admin);
    await ctx.db
      .updateTable('drops')
      .set({ mode: 'LIVE', early_access_platine_hours: null, live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1, price_minor: 480_000, currency: 'EUR', quantity_line: '3 PIECES', published_at: new Date() })
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
    // Logistics in the Atelier's place (plan NEXT LOT §3.5.4.1, step 5.11a).
    for (const label of ['Orders', 'Invoices', 'Logistics']) expect(await p.locator('.side__link', { hasText: new RegExp(`^${label}$`) }).count(), label).toBe(1);
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

  it('takes an order through its steps: terms, buyer, paid; waiting for supplier stock, then served from stock; packed, shipped and delivered from its Shipping section; its packing slip without a price', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/orders/${o.late}`, orderReference(o.late));
    expect(await p.locator('[data-testid=order-late]').textContent()).toContain('Reserved for over 2 days, not paid yet.');
    expect(await p.locator('[data-testid=order-holds]').textContent()).toBe('Awaiting stock');
    expect(await p.locator('#order-step').textContent()).toContain('It waits for supplier stock; its price is to be entered.');
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

    // No piece is made for it (plan NEXT LOT §3.5): a piece of its size received in stock at its location serves it.
    const late = await ctx.db.selectFrom('orders').select(['sku_id', 'location_id']).where('id', '=', o.late).executeTakeFirstOrThrow();
    const [made] = await stockPieces(ctx, { skuId: late.sku_id!, locationId: late.location_id, count: 1, material: '925 STERLING SILVER', forOrderIds: [o.late] }, admin);
    lateClaim = made!.claimCode!;
    await p.reload();
    await expect.poll(() => p.locator('[data-testid=order-holds]').textContent()).toBe('In stock at FRANCE WAREHOUSE');
    expect(await p.locator('[data-testid=order-link]').count()).toBe(0);
    expect(await p.locator('#order-step').textContent()).toContain('It ships with its parcel: the agent packs it and scans its card (Shipping).');

    // Its Shipping section: the agent's steps, from here (plan NEXT LOT §3.5.4.4).
    await p.click('[data-testid=parcel-start]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=parcel-step]').textContent()).toBe('PACKING');
    await p.setInputFiles('[data-testid=parcel-scan-photo]', cardPhoto(made!, 'late-card.png'));
    await p.waitForSelector(`.toast:has-text("${made!.productId}: the right piece.")`, { timeout: 30_000 });
    await expect.poll(() => p.locator('[data-testid=order-holds]').textContent()).toBe(`Piece ${made!.productId}`);
    const photo = join(workDir, 'parcel.jpg');
    writeFileSync(photo, jpegPhoto(1200, 900));
    await p.setInputFiles('[data-testid=parcel-photo-file]', photo);
    await p.waitForSelector('.toast:has-text("Photo added.")');
    await expect.poll(() => p.locator('[data-testid=parcel-photo-view]').count()).toBe(1);
    for (const line of await p.locator('[data-testid=parcel-check]').all()) await line.click();
    await p.click('[data-testid=parcel-packed]');
    await expect.poll(() => p.locator('[data-testid=parcel-step]').textContent()).toBe('PACKED');
    // Ship: a carrier, the tracking number with its link, a declared value (ORBES's, in the order's currency).
    await p.click('[data-testid=parcel-ship]');
    await p.selectOption('dialog select[name=carrierId]', { label: 'Colissimo' });
    await p.fill('dialog input[name=trackingNumber]', '6A12345678901');
    await p.fill(`dialog input[name=declared_${o.late}]`, '4800');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=parcel-tracking]').getAttribute('href')).toBe('https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901');
    expect(await p.locator('[data-testid=order-declared]').textContent()).toMatch(/€\s4\s800/u);
    await shot(p, 'order-shipping');
    await p.click('#order-shipping [data-testid=parcel-delivered]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-step .osteps__step.is-current .osteps__label').textContent()).toBe('DELIVERED');
    const history = (await p.locator('#order-history tbody tr').allTextContents()).join('\n');
    for (const step of ['Piece held in stock', 'Packing started', 'Card scanned', 'Photo added', 'Packed', 'Shipped', 'Delivered']) expect(history, step).toContain(step);
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

    // The order holding a piece in stock, priced and paid: it ships with its parcel; no Link a piece any more.
    await ctx.services.orders.setTerms(o.stock, { priceMinor: 300_000, currency: 'EUR' }, admin);
    await ctx.services.orders.transition(o.stock, { to: 'PAID' }, admin);
    await go(p, `#/orders/${o.stock}`, orderReference(o.stock));
    expect(await p.locator('#order-step').textContent()).toContain('It ships with its parcel: the agent packs it and scans its card (Shipping).');
    expect(await p.locator('[data-testid=order-link]').count()).toBe(0);
    expect(await p.locator('[data-testid=parcel-step]').textContent()).toBe('READY TO PACK');
    expect(await p.locator('[data-testid=parcel-start]').count()).toBe(1);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('leads the Atelier\'s old addresses to Logistics, where a minimum is set (plan NEXT LOT §3.5.4.5)', async () => {
    const p = await open(OPERATOR);
    expect(await p.locator('.side__link', { hasText: /^Atelier$/ }).count()).toBe(0);
    for (const old of ['#/atelier', '#/atelier/sheets?origin=STOCK']) {
      await p.evaluate((x) => (location.hash = x), old);
      await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/logistics');
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Logistics');
    }
    await p.click('[data-testid=logistics-tab-stock]');
    const row = p.locator('#logistics-stock tbody tr', { hasText: 'MNL-RG-54' }).filter({ hasText: 'LOGISTICS WAREHOUSE' });
    await row.locator('[data-testid=stock-minimum]').click();
    await p.fill('dialog input[name=minimum]', '2');
    await confirmDialog(p);
    await expect.poll(() => row.locator('[data-testid=stock-to-order]').textContent()).toBe('TO ORDER2');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('returns and invoices: the invoice on the order\'s page; a return back to stock, the new claim code once with its card; the Invoices page, its PDFs and its CSV', async () => {
    // The late order, delivered, its piece registered by its buyer (its warranty started when it shipped).
    const piece = await ctx.db.selectFrom('orders as o').innerJoin('products as p', 'p.id', 'o.product_id').select(['p.id', 'p.product_id', 'o.account_id']).where('o.id', '=', o.late).executeTakeFirstOrThrow();
    const code = await ctx.db.selectFrom('codes').select('id').where('product_id', '=', piece.id).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow();
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

    // A return, as an order case (plan NEXT LOT §3.5.4.4): opened by Client Services, the parcel back at the agent.
    await p.click('[data-testid=order-return]');
    expect(await p.locator('dialog .dialog__text').first().textContent()).toBe('The collector sends the piece back at their cost. The agent records it when it arrives; you then decide.');
    // A size exchange's New size: every size listed, those not in stock greyed out (disabled), never chosen (§3.5.4.4).
    const exchange = await sizesForExchange(ctx.db, o.late);
    expect(exchange.some((x) => !x.selectable)).toBe(true);
    await p.selectOption('dialog select[name=kind]', 'EXCHANGE');
    const sizeOptions = await p.locator('dialog select[name=exchangeSkuId] option').evaluateAll((els) => (els as HTMLOptionElement[]).map((x) => ({ value: x.value, disabled: x.disabled })));
    expect(sizeOptions).toEqual([{ value: '', disabled: false }, ...exchange.map((x) => ({ value: x.skuId, disabled: !x.selectable }))]);
    await p.selectOption('dialog select[name=kind]', 'RETURN');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Complete the required fields.');
    await p.selectOption('dialog select[name=reason]', 'SIZE');
    await p.fill('dialog textarea[name=note]', 'Returned unworn within the delay.');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Return opened.")');
    await expect.poll(() => p.locator('[data-testid=order-case-status]').textContent()).toBe('OPEN');
    expect(await p.locator('[data-testid=order-case-kind]').textContent()).toBe('RETURN');
    expect(await p.locator('[data-testid=order-case-decide]').count()).toBe(0);
    expect(await p.locator('[data-testid=order-return]').count()).toBe(0);
    const opened = (await ctx.services.orderCases.forOrder(o.late))[0]!;
    await ctx.services.orderCases.receive(opened.id, { pieceState: 'OK', note: 'Unworn, in its box.' }, admin, null);
    await p.reload();
    await expect.poll(() => p.locator('[data-testid=order-case-status]').textContent()).toBe('RECEIVED');
    // Decided back to stock: where, and why.
    await p.click('[data-testid=order-case-decide]');
    expect(await p.locator('dialog [data-testid=case-received-state]').textContent()).toBe('The agent recorded the piece: OK. Unworn, in its box.');
    await p.selectOption('dialog select[name=decision]', 'REFUND');
    await p.selectOption('dialog select[name=pieceTo]', 'RESTOCKED');
    expect(await p.locator('dialog select[name=locationId]').inputValue()).not.toBe('');
    await p.fill('dialog textarea[name=note]', 'Returned unworn within the delay.');
    await p.click('[data-testid=dialog-confirm]');
    // Back to stock: the new claim code, once, with its card (ORBES took the ownership back).
    await expect.poll(() => p.locator('dialog [data-testid=claim-code]').textContent()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const fresh = (await p.locator('dialog [data-testid=claim-code]').textContent())!;
    expect(fresh).not.toBe(lateClaim);
    // Its words unchanged since the dialog became the one New claim code shares (plan NEXT LOT §3.4).
    expect(await p.locator('dialog .dialog__text').first().textContent()).toBe(
      'The piece’s next buyer registers it with this code; the card that left with it no longer does. Shown once: download its certificate card now. Only its hash is kept.',
    );
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

    // SHIPPING (BP-19 T2), optional: none preset, a rate set, refused when it is not an amount, cleared again.
    expect(await p.locator('#settings-shipping [data-testid^=rate-]').allTextContents()).toEqual(Array(8).fill('—'));
    await p.click('[data-testid=shipping-edit]');
    await p.fill('dialog input[name="EUR-STANDARD"]', 'twenty');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('EUR Standard: an amount in units, 20 or 20.50, or empty for none.');
    await p.fill('dialog input[name="EUR-STANDARD"]', '20');
    await p.fill('dialog input[name="EUR-EXPRESS"]', '40');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid="rate-EUR-STANDARD"]').textContent()).toBe('€\u00a020');
    expect(await p.locator('[data-testid="rate-EUR-EXPRESS"]').textContent()).toBe('€\u00a040');
    expect(await p.locator('[data-testid="rate-GBP-STANDARD"]').textContent()).toBe('—');
    expect(await ctx.db.selectFrom('shipping_rates').select(['currency', 'service', 'fee_minor']).orderBy('service', 'desc').execute()).toEqual([
      { currency: 'EUR', service: 'STANDARD', fee_minor: 2000 },
      { currency: 'EUR', service: 'EXPRESS', fee_minor: 4000 },
    ]);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'settings', { phone: true });
    await p.click('[data-testid=shipping-edit]');
    await p.fill('dialog input[name="EUR-STANDARD"]', '');
    await p.fill('dialog input[name="EUR-EXPRESS"]', '');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid="rate-EUR-STANDARD"]').textContent()).toBe('—');
    expect(await ctx.db.selectFrom('shipping_rates').selectAll().execute()).toEqual([]);

    // The board says the new delay: the order of three days ago is no longer late.
    await go(p, '#/orders', 'Orders');
    expect(await p.locator('[data-testid=orders-summary]').textContent()).toContain('Reserved 5 days');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('lets an AUDITOR read the board and an order, the emails and the buyer masked, without one action', async () => {
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
    // Its Order case and Shipping read, without one action.
    for (const action of ['order-case-decide', 'order-case-cancel', 'parcel-start', 'parcel-ship', 'parcel-delivered', 'parcel-report']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    await go(a, '#/logistics?tab=stock', 'Logistics');
    for (const action of ['stock-transfer', 'stock-minimum', 'stock-correct', 'stock-count-in', 'stock-add-to-order']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    await go(a, '#/settings', 'Settings');
    for (const action of ['alerts-edit', 'carrier-add', 'carrier-edit', 'location-add', 'location-rename', 'shipping-edit']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    expect(await figuresInDisplayFace(a)).toEqual([]);
    expect(await csp(a)).toEqual([]);
    await a.context().close();
  }, STEP_TIMEOUT);

  // Last: its orders would change the counts of the scenes before it.
  it('takes a tier\'s credit off an order and chooses its welcome gift\'s size before MARK PAID (BP-19 T5), the saved size a hint only (AC-01)', async () => {
    // A gift model of two sizes, one piece of each in stock, THE PROGRAM's gift of PLATINE; a PLATINE account's salon order.
    const france = (await ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const gift = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, name: 'JONC', type: 'RING', sku_prefix: 'JNC-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const size of ['50', '52']) await ctx.services.stock.adjust({ skuId: await inTransaction(ctx.db, (tx) => ensureSku(tx, gift, size)), locationId: france, delta: 1, note: 'Counted.' }, admin);
    await ctx.services.clubProgram.update({ ...(await ctx.services.clubProgram.read()), giftPlatineModelId: gift }, admin);
    const account = await createAccount(ctx.db);
    await holdPieces(ctx.db, account.id, 5, modelId);
    // AC-01: the gift model reads a ring size, and the collector saved 52 in YOUR SIZES: a hint on Choose size, never a choice.
    await ctx.db.updateTable('models').set({ size_kind: 'RING' }).where('id', '=', gift).execute();
    await ctx.services.sizes.set(account.id, { RING: 52 }, { type: 'account', id: account.id });
    const request = await ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: ctx.clock() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const parent = (await ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).where('channel', '=', 'SALON').executeTakeFirstOrThrow()).id;
    await ctx.services.orders.setTerms(parent, { sizeLabel: '58', priceMinor: 300_000, currency: 'EUR' }, admin);
    await ctx.services.orders.setBuyer(parent, { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris\nFrance' }, admin);
    const giftOrder = (await ctx.db.selectFrom('orders').select('id').where('with_order_id', '=', parent).where('channel', '=', 'GIFT').executeTakeFirstOrThrow()).id;

    const p = await open(OPERATOR);
    await go(p, `#/orders/${parent}`, orderReference(parent));
    expect(await p.locator('[data-testid=order-gift]').textContent()).toBe(`${orderReference(giftOrder)} · JONC · Size to choose`);
    expect(await p.locator('[data-testid=order-credit-available]').textContent()).toMatch(/^PLATINE €\s50 until \d{2} [A-Z]{3} \d{4}$/u);
    expect(await p.locator('[data-testid=order-credit-applied]').textContent()).toBe('None');
    // Not paid before the gift's size is chosen.
    expect(await p.locator('[data-testid=order-pay]').count()).toBe(0);
    expect(await p.locator('#order-step').textContent()).toContain('Choose the welcome gift’s size first.');
    // APPLY CREDIT, prefilled with what the order takes: € 50.
    await p.click('[data-testid=order-credit-apply]');
    expect(await p.locator('dialog input[name=amount]').inputValue()).toBe('50');
    await p.fill('dialog input[name=amount]', '60');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toContain('At most €');
    await p.fill('dialog input[name=amount]', '50');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=order-credit-applied]').textContent()).toMatch(/^\u2212 €\s50 \(PLATINE\)$/u);
    expect(await p.locator('[data-testid=order-credit-available]').textContent()).toBe('None');
    expect(await p.locator('[data-testid=order-credit-remove]').count()).toBe(1);
    // The gift's page: its tier and its order; its size chosen among its model's.
    await p.click('[data-testid=order-gift]');
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe(orderReference(giftOrder));
    expect(await p.locator('.page-head').textContent()).toContain(`Welcome gift · PLATINE · travels with ${orderReference(parent)}`);
    expect(await p.locator('[data-testid=order-pay]').count()).toBe(0);
    expect(await p.locator('#order-step').textContent()).toContain('Its size is to be chosen.');
    expect(await p.locator('[data-testid=order-size]').textContent()).toBe('To be confirmed');
    // CHOOSE SIZE, its own dialog; EDIT holds no size.
    expect(await p.locator('[data-testid=order-gift-size]').textContent()).toBe('Choose size');
    await p.click('[data-testid=order-terms]');
    expect(await p.locator('dialog select[name=giftSize]').count()).toBe(0);
    await p.click('[data-testid=dialog-cancel]');
    await p.waitForSelector('dialog.dialog', { state: 'detached' });
    await p.click('[data-testid=order-gift-size]');
    expect(await p.locator('dialog.dialog .dialog__title').textContent()).toBe('Choose size');
    expect(await p.locator('dialog select[name=giftSize] option').allTextContents()).toEqual(['Choose a size', '50 · 1 available', '52 · 1 available']);
    expect(await p.locator('dialog [data-testid=order-gift-saved-size]').textContent()).toBe('Saved size: 52 (YOUR SIZES)');
    expect(await p.locator('dialog select[name=giftSize]').inputValue()).toBe('');
    await p.selectOption('dialog select[name=giftSize]', '52');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-step').textContent()).toContain(`It is paid with ${orderReference(parent)}.`);
    expect(await p.locator('[data-testid=order-size]').textContent()).toBe('52');
    expect(await p.locator('[data-testid=order-gift-size]').count()).toBe(0);
    await shot(p, 'gift-order', { phone: true });
    // Back to its order: MARK PAID, the invoice less the credit.
    await go(p, `#/orders/${parent}`, orderReference(parent));
    await p.click('[data-testid=order-pay]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#order-step .osteps__step.is-current .osteps__label').textContent()).toBe('PAID');
    await expect.poll(() => p.locator('#order-documents tbody tr').first().textContent()).toMatch(/€\s2\s950/u);
    expect(await p.locator('#order-history').textContent()).toContain('Credit applied');
    await shot(p, 'credit-paid', { phone: true });
    // The gift, paid with its order, ships in its order's parcel (plan NEXT LOT §3.5.6.6): its Shipping section is that
    // parcel's, keyed by its order; no Ship of its own any more.
    await go(p, `#/orders/${giftOrder}`, orderReference(giftOrder));
    expect(await p.locator('[data-testid=order-ship]').count()).toBe(0);
    expect((await ctx.services.logistics.parcel(giftOrder, null)).id).toBe(parent);
    expect((await ctx.services.logistics.parcel(giftOrder, null)).orders.map((x) => x.orderId)).toEqual([parent, giftOrder]);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
    await ctx.db.deleteFrom('club_program_settings').execute();
  }, STEP_TIMEOUT);

  it('keeps the Shipment section of an order shipped before Logistics: its carrier, its tracking link and its declared value, never a parcel NOT READY (plan NEXT LOT §3.5.8)', async () => {
    // Shipped from its order as before H2: no parcel's shipment, the carrier and tracking number on the order.
    const legacy = (await salonOrder('60')).id;
    await ctx.services.orders.setTerms(legacy, { priceMinor: 480_000, currency: 'EUR' }, admin);
    await ctx.services.orders.transition(legacy, { to: 'PAID' }, admin);
    await stockPieceFor(ctx, { orderId: legacy }, admin);
    const colissimo = (await ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    await ctx.services.orders.transition(legacy, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A98765432109', declaredValueMinor: 480_000 }, admin);
    expect((await ctx.services.logistics.parcel(legacy, null)).shipment).toBeNull();

    const p = await open(OPERATOR);
    await go(p, `#/orders/${legacy}`, orderReference(legacy));
    await expect.poll(() => p.locator('#order-step .osteps__step.is-current .osteps__label').textContent()).toBe('SHIPPED');
    const shipment = p.locator('#order-shipment');
    expect(await shipment.locator('.panel__title').textContent()).toBe('Shipment');
    expect(await shipment.textContent()).toContain('Colissimo');
    expect(await shipment.locator('[data-testid=order-tracking]').textContent()).toBe('6A98765432109');
    expect(await shipment.locator('[data-testid=order-tracking]').getAttribute('href')).toBe('https://www.laposte.fr/outils/suivre-vos-envois?code=6A98765432109');
    expect(await shipment.textContent()).toMatch(/Declared value\s*€\s4\s800/u);
    // No parcel's Shipping section with its NOT READY step; delivered from its step, as before.
    expect(await p.locator('#order-shipping').count()).toBe(0);
    expect(await p.locator('[data-testid=parcel-step]').count()).toBe(0);
    expect(await p.locator('body').textContent()).not.toContain('NOT READY');
    expect(await p.locator('[data-testid=order-deliver]').count()).toBe(1);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await csp(p)).toEqual([]);
    await shot(p, 'order-shipped-before-logistics');
    await p.context().close();
  }, STEP_TIMEOUT);
});
