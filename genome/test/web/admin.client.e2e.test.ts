/**
 * The client sheet and the Shopify exports in the console, end to end (plan LIVE RELEASE+, step S9): the production web
 * build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider, a
 * manual clock) and driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. An OPERATOR opens a collector's sheet (N4): its orders with their steps and dates, each opening its page; the
 *     releases it took part in and the pieces it secured; its answer to the question after; its I'LL BE THERE and what
 *     became of each; its segment; Client Services' notes.
 *  2. The Catalogue (N2, M6): a model's base price and care guide set in its edit, read in the list; the Shopify product
 *     export downloaded in the store's currency (Shopify's columns); the ids Shopify gave its product and a size pasted
 *     back, the model then LINKED.
 *  3. The Orders page (N3): the Shopify order export of the month, the collector by email.
 *  4. An AUDITOR reads the sheet with the email masked, offered no Shopify ids to paste; its order export masked.
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
import { SHOPIFY_ORDER_COLUMNS, SHOPIFY_PRODUCT_COLUMNS } from '../../src/server/services/shopify.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, SYSTEM_ACTOR, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OPERATOR = { email: 'client.operator@orbes.test', password: 'client operator passphrase 2026' };
const AUDITOR = { email: 'client.auditor@orbes.test', password: 'client auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const STEP_TIMEOUT = 180_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const POLL = { timeout: 15_000, interval: 100 };

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

describe.skipIf(!HAS_CHROMIUM)('the client sheet and the Shopify exports in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  /** The collector, its orders and releases. */
  const me = { id: '', email: '' };
  const ids = { live: '', missed: '', draw: '', liveOrder: '', salonOrder: '', drawOrder: '' };
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
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const csp = (p: Page) => p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  const text = async (p: Page, sel: string) => ((await p.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const rowsOf = (p: Page, section: string) => p.locator(`#${section} tbody tr`);

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
  }

  async function confirmDialog(p: Page): Promise<void> {
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  async function shot(p: Page, name: string): Promise<void> {
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      await document.fonts.ready;
    });
    await p.screenshot({ path: join(OUT_DIR, `admin-client-${name}.png`), fullPage: true });
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-client-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    // The fixtures' times, a few hours back from now; the clock then stands at now (the console's sessions).
    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    const start = now - 6 * HOUR;
    const at = (ms: number) => new Date(start + ms);
    clock = createManualClock(new Date(start).toISOString());
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.services.auth.createAdmin({ ...OPERATOR, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    f = await liveFixtureOn(ctx, clock);
    await ctx.db.updateTable('models').set({ default_material: '925 STERLING SILVER', slug: 'monolithe' }).where('id', '=', f.modelId).execute();
    const a = await createAccount(ctx.db);
    Object.assign(me, { id: a.id, email: a.email });

    // A draw it enters, drawn, confirmed with a note.
    const draw = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — release I', quantity: 1, opensAt: at(MINUTE), closesAt: at(2 * MINUTE), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(draw.id, f.admin);
    ids.draw = draw.id;
    // A LIVE RELEASE it secures a piece in, with its engraving; one it said I'LL BE THERE to and missed.
    const live = await createLiveRelease(f, { opensAt: at(30 * MINUTE), sizes: [{ label: '54', stock: 1 }], addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }] });
    const missed = await createLiveRelease(f, { opensAt: at(40 * MINUTE), sizes: [{ label: '52', stock: 1 }] });
    await ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE I' }).where('id', '=', live.id).execute();
    await ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE II' }).where('id', '=', missed.id).execute();
    Object.assign(ids, { live: live.id, missed: missed.id });
    await f.live.setInterest(a.id, missed.id, missed.sizes[0]!.id, a.actor);
    clock.set(at(MINUTE + SECOND));
    await f.drops.enter(a.id, draw.id, a.actor);
    clock.set(at(3 * MINUTE));
    await f.drops.draw(draw.id, f.admin);
    const entry = await ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', draw.id).executeTakeFirstOrThrow();
    await f.drops.confirm(draw.id, entry.id, 'Called the client: the place is confirmed.', f.admin);
    ids.drawOrder = (await ctx.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry.id).executeTakeFirstOrThrow()).id;
    clock.set(at(29 * MINUTE));
    await f.live.enter(a.id, live.id, { sizeId: live.sizes[0]!.id }, a.actor);
    clock.set(at(30 * MINUTE));
    await f.live.advance(live.id);
    clock.advance(2 * SECOND);
    const token = (await f.live.entry(a.id, live.id))!.turn!.token!;
    await f.live.press(a.id, live.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, live.id, token, a.actor);
    await f.live.setAddons(a.id, live.id, live.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, live.id, a.actor);
    ids.liveOrder = (await ctx.db.selectFrom('orders').select('id').where('drop_id', '=', live.id).executeTakeFirstOrThrow()).id;
    clock.set(at(41 * MINUTE));
    await f.live.advance(missed.id);
    await ctx.db.insertInto('release_answers').values({ drop_id: missed.id, account_id: a.id, answer: 2, answered_at: at(2 * HOUR) }).execute();
    // A request of the private salon accepted, priced, its buyer entered, paid, then cancelled with a note.
    clock.set(at(3 * HOUR));
    const request = await ctx.db.insertInto('shop_requests').values({ account_id: a.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded by phone.', outcome: 'ACCEPTED' }, f.admin);
    ids.salonOrder = (await ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await ctx.services.orders.setTerms(ids.salonOrder, { sizeLabel: '58', priceMinor: 480_000, currency: 'EUR' }, f.admin);
    await ctx.services.orders.setBuyer(ids.salonOrder, { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' }, f.admin);
    clock.advance(MINUTE);
    await ctx.services.orders.transition(ids.salonOrder, { to: 'PAID' }, f.admin);
    clock.advance(MINUTE);
    await ctx.services.orders.transition(ids.salonOrder, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin);
    await ctx.services.segments.create({ name: 'Newcomers', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [0] }] } }, f.admin);
    // The model's sizes: 52, 54, 56, 58 (54 and 58 sold; 52 and 56 in stock).
    for (const size of ['52', '56']) await inTransaction(ctx.db, (tx) => ensureSku(tx, f.modelId, size));
    clock.set(new Date(now));

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
  });

  it('opens the client sheet: orders and their steps, releases and pieces secured, answers, interest, tier, segments, notes', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/owners/${me.id}`, me.email);
    expect(await text(p, '[data-testid=owner-tier]')).toBe('None · 0 pieces held');

    expect(await rowsOf(p, 'orders').count()).toBe(3);
    expect(await p.locator('[data-testid=client-order]').allTextContents()).toEqual([orderReference(ids.salonOrder), orderReference(ids.liveOrder), orderReference(ids.drawOrder)]);
    const salon = rowsOf(p, 'orders').nth(0);
    expect((await salon.textContent())!.replace(/\s+/g, ' ')).toMatch(/PRIVATE SALON.*MONOLITHE.*58.*4 800.*CANCELLED/);
    expect(await salon.locator('.client-steps__step').allTextContents()).toEqual([expect.stringMatching(/^RESERVED /), expect.stringMatching(/^PAID /), expect.stringMatching(/^CANCELLED /)]);
    const liveRow = rowsOf(p, 'orders').nth(1);
    expect((await liveRow.textContent())!.replace(/\s+/g, ' ')).toMatch(/LIVE RELEASE.*MONOLITHE — LIVE I.*MONOLITHE.*54.*RESERVED/);
    expect((await rowsOf(p, 'orders').nth(2).textContent())!.replace(/\s+/g, ' ')).toMatch(/DRAW.*ECLIPSE — release I.*To enter.*RESERVED/);
    expect(await text(p, '#orders .panel__note')).toBe('3 orders · 0 late');

    expect(await rowsOf(p, 'releases').count()).toBe(2);
    expect(await text(p, '#releases .panel__note')).toBe('2 releases taken part in · 2 pieces secured');
    expect((await rowsOf(p, 'releases').first().textContent())!.replace(/\s+/g, ' ')).toMatch(/MONOLITHE — LIVE I.*LIVE RELEASE.*SECURED A PIECE.*1/);
    expect((await rowsOf(p, 'answers').first().textContent())!.replace(/\s+/g, ' ')).toMatch(/MONOLITHE — LIVE II.*WHAT WOULD YOU HAVE WANTED\?.*ANOTHER FINISH/);
    expect((await rowsOf(p, 'interest').first().textContent())!.replace(/\s+/g, ' ')).toMatch(/MONOLITHE — LIVE II.*52.*DID NOT COME/);
    expect(await text(p, '[data-testid=client-segments]')).toBe('Newcomers');
    expect(await p.locator('[data-testid=client-note]').allTextContents()).toEqual(['The client withdrew.', 'The sale is concluded by phone.', 'Called the client: the place is confirmed.']);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'sheet');

    // An order opens its page.
    await p.locator('[data-testid=client-order]').nth(1).click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(orderReference(ids.liveOrder));
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('sets a model\'s base price and care guide; exports the products in Shopify\'s format; pastes back the ids Shopify gave', async () => {
    const p = await open(OPERATOR);
    await go(p, '#/catalogue', 'Catalogue');
    const row = p.locator('#models tbody tr', { hasText: 'MONOLITHE' });
    expect(await text(p, '[data-testid=model-base-price]')).toBe('None');
    expect(await text(p, '[data-testid=model-shopify]')).toBe('NOT LINKED');

    await row.locator('[data-testid=edit-model]').click();
    // Not a price: said before anything is sent.
    await p.fill('dialog [name=basePrice]', 'about 4800');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => text(p, 'dialog'), POLL).toContain('The base price is an amount in units: 4800, or 4800.50.');
    await p.fill('dialog [name=basePrice]', '4800.50');
    await p.selectOption('dialog [name=baseCurrency]', 'EUR');
    await p.fill('dialog [name=careGuide]', 'Wipe it with a soft cloth.\nKeep it in its box, away from perfume.');
    await confirmDialog(p);
    await expect.poll(() => text(p, '[data-testid=model-base-price]'), POLL).toBe('€ 4 800.50');
    expect((await ctx.services.catalog.getModel(f.modelId)).careGuide).toBe('Wipe it with a soft cloth.\nKeep it in its box, away from perfume.');

    // The product export: what it holds said first, then the file in Shopify's columns.
    await p.click('[data-testid=shopify-products-export]');
    await expect.poll(() => text(p, '[data-testid=shopify-export-summary]'), POLL).toBe(
      '1 model priced in EUR, each a product with its sizes as variants and its photographs. Each product is a draft, not published: Shopify decides nothing until the store is open.',
    );
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'catalogue-export');
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=dialog-confirm]')]);
    expect(download.suggestedFilename()).toMatch(/^ORBES-shopify-products-EUR-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8').split('\r\n');
    expect(csv[0]).toBe(SHOPIFY_PRODUCT_COLUMNS.map((c) => `"${c}"`).join(','));
    expect(csv.filter((l) => l.includes('"monolithe"'))).toHaveLength(4);
    // A model alone: its sizes as Option1, no Option2 (NOCTURNE N1: Option2 is a model with variants' Size).
    expect(csv[1]).toMatch(/^"MONOLITHE","monolithe","ORBES","RING","false","draft","[^"]+-52","Size","52","","","4800.50","true"/);

    // The ids Shopify gave: the product by its address, one size by its id.
    await row.locator('[data-testid=model-shopify-ids]').click();
    await p.waitForSelector('dialog [name=productId]');
    expect(await p.locator('dialog .cfield__label').allTextContents()).toEqual(['Product', 'Variant', 'Variant', 'Variant', 'Variant']);
    expect(await p.locator('dialog .cfield__hint').allTextContents()).toEqual([
      'Empty: the model is no longer linked, nor its sizes.',
      ...['52', '54', '56', '58'].map((s) => expect.stringMatching(new RegExp(`^Size ${s} · SKU MON-[0-9A-F]{8}-${s}$`))),
    ]);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => text(p, 'dialog'), POLL).toContain('Nothing has changed.');
    await p.fill('dialog [name=productId]', 'https://admin.shopify.com/store/orbes/products/8123456789');
    await p.fill('dialog [name=variant-0]', '44012345678');
    await shot(p, 'catalogue-shopify-ids');
    await confirmDialog(p);
    await expect.poll(() => text(p, '[data-testid=model-shopify]'), POLL).toBe('LINKED · 1 OF 4 SIZES');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'catalogue');
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('exports the month\'s orders in Shopify\'s format from the Orders page, the collector by email', async () => {
    const p = await open(OPERATOR);
    await go(p, '#/orders', 'Orders');
    await p.click('[data-testid=orders-shopify-export]');
    const today = new Date(clock.now()).toISOString().slice(0, 10);
    expect(await p.inputValue('dialog [name=to]')).toBe(today);
    // The fixtures may start the day before: from the day before.
    const from = new Date(clock.now().getTime() - 24 * HOUR).toISOString().slice(0, 10);
    await p.fill('dialog [name=from]', from);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'orders-export');
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=dialog-confirm]')]);
    expect(download.suggestedFilename()).toBe(`ORBES-shopify-orders-${from}-to-${today}.csv`);
    const lines = readFileSync((await download.path())!, 'utf8').split('\r\n');
    expect(lines[0]).toBe(SHOPIFY_ORDER_COLUMNS.map((c) => `"${c}"`).join(','));
    expect(lines.find((l) => l.startsWith(`"${orderReference(ids.liveOrder)}","${me.email}","pending"`))).toBeTruthy();
    expect(lines.some((l) => l.includes('"Jane Doe"'))).toBe(true);
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('an AUDITOR reads the sheet with the email masked, pastes no Shopify id, and its order export is masked', async () => {
    const p = await open(AUDITOR);
    const masked = `${me.email[0]}***${me.email.slice(me.email.indexOf('@'))}`;
    await go(p, `#/owners/${me.id}`, masked);
    expect(await rowsOf(p, 'orders').count()).toBe(3);
    expect(await p.locator('[data-testid=client-note]').count()).toBe(3);
    expect(await p.content()).not.toContain(me.email);
    await shot(p, 'sheet-auditor');
    await go(p, '#/catalogue', 'Catalogue');
    expect(await p.locator('[data-testid=model-shopify-ids]').count()).toBe(0);
    expect(await text(p, '[data-testid=model-shopify]')).toBe('LINKED · 1 OF 4 SIZES');
    await go(p, '#/orders', 'Orders');
    await p.click('[data-testid=orders-shopify-export]');
    const from = new Date(clock.now().getTime() - 24 * HOUR).toISOString().slice(0, 10);
    await p.fill('dialog [name=from]', from);
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=dialog-confirm]')]);
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).not.toContain(me.email);
    expect(csv).not.toContain('Jane Doe');
    expect(csv).toContain(`"${masked}"`);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);
});
