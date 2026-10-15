/**
 * The warranty claims in the console, end to end (plan ORBES CARE of 2026-10-15, §2(b), step 3.2): the production web
 * build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider), driven
 * in Chromium (playwright-core) at 1440 × 900 by an OPERATOR session (answer 11: Client Services take every step).
 *
 *  1. A lifetime piece's claim opened from the client's conversation (Open a warranty claim names Lifetime warranty,
 *     read from the piece); its page at each step: SEND LABEL (the PDF), REFUSE's lifetime reasons, RECEIVED, DECIDE
 *     with the free replacement (the same piece, new, or a credit of its value), the replacement's identity, SHIP; the
 *     free replacement then used.
 *  2. The replacement's page: Lifetime, no Extend warranty, its free replacement used; the claimed piece's Warranty
 *     claims table. Its own claim: only the 30 % credit (THE PROGRAM's rate), and what it gives.
 *  3. A 2-year piece's claim (Open a warranty claim names 2-year warranty (defects only)): DECIDE offers a repair or the
 *     same piece new, never a credit, and its five reasons; MOVE TO THE LEGAL GUARANTEE leads to the LEGAL claim (each
 *     page links the other), whose DECIDE offers the legal guarantee's outcomes and its three reasons; a refund.
 *  4. Open a legal-guarantee claim from a piece page (a buyer without an ORBES account, the receipt in the note).
 *  5. Warranties → Claims: the claims under way first, the status filter, a row to its page; an AUDITOR reads a claim
 *     without one action.
 * No CSP violation, no page error.
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
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, holdPieces } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OPERATOR = { email: 'claims.operator@orbes.test', password: 'claims operator passphrase 2026' };
const AUDITOR = { email: 'claims.auditor@orbes.test', password: 'claims auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 240_000;
const POLL = { timeout: 15_000 };
const PDF = { name: 'label.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1') };
const LIFETIME_REASONS = [
  'Lost',
  'Theft reported',
  'Scratched',
  'Damaged on purpose',
  'Damaged by someone else',
  'Altered or repaired outside ORBES',
  'No tarnish, fading or accidental break',
  'Warranty no longer valid',
];

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

describe.skipIf(!HAS_CHROMIUM)('the warranty claims in the console (E2E, Chromium; plan ORBES CARE, step 3.2)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  const problems: string[] = [];
  let client: { id: string; email: string };
  let conversationId: string;
  /** The client's pieces: two lifetime (LUNE), one 2-year (SELLIER); an ISSUED LUNE identity for a replacement; a boutique sale's piece. */
  const serial: Record<'lifetime' | 'lifetime2' | 'twoYears' | 'spare' | 'boutique', string> = { lifetime: '', lifetime2: '', twoYears: '', spare: '', boutique: '' };
  const uuid: Record<string, string> = {};

  async function open(who: { email: string; password: string }): Promise<Page> {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
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

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
  }

  async function confirm(p: Page): Promise<void> {
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  async function cancel(p: Page): Promise<void> {
    await p.click('[data-testid=dialog-cancel]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  const options = (p: Page, name: string) => p.locator(`dialog select[name=${name}] option`).allTextContents();
  const status = (p: Page) => p.locator('[data-testid=claim-status]').textContent();
  const actions = (p: Page) => p.locator('.page-head button[data-testid^=claim-]').allTextContents();

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

  /** Captures for the owner (ORBES_SCREENSHOTS=1): the page whole, a dialog as it shows, and the phone's twin. */
  async function shot(p: Page, name: string, opts: { phone?: boolean; dialog?: boolean } = {}): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-claims-${name}.png`), fullPage: !opts.dialog });
    if (opts.phone) await phoneTwin(p, `admin-claims-${name}-phone.png`);
  }

  async function claimOf(productUuid: string): Promise<string> {
    return (await ctx.db.selectFrom('warranty_claims').select('id').where('product_id', '=', productUuid).orderBy('opened_at', 'desc').orderBy('id').executeTakeFirstOrThrow()).id;
  }

  /** A claim taken to RECEIVED through the service (its label and receipt are the first test's). */
  async function received(productSerial: string): Promise<string> {
    const admin = await ctx.db.selectFrom('admin_users').select('id').where('email', '=', OPERATOR.email).executeTakeFirstOrThrow();
    const actor = { type: 'admin' as const, id: admin.id };
    const carrier = await ctx.db.selectFrom('carriers').select('id').where('active', '=', true).executeTakeFirstOrThrow();
    const c = await ctx.services.warrantyClaims.open({ conversationId, productId: productSerial, basis: 'WARRANTY' }, actor);
    await ctx.services.warrantyClaims.label(c.id, { pdf: new Uint8Array(PDF.buffer), carrierId: carrier.id, tracking: '6A00000000001' }, actor);
    await ctx.services.warrantyClaims.receive(c.id, actor);
    return c.id;
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-claims-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...OPERATOR, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    if (!(await ctx.db.selectFrom('carriers').select('id').where('active', '=', true).executeTakeFirst())) {
      await ctx.db.insertInto('carriers').values({ name: 'Colissimo', tracking_url: 'https://track.test/{tracking}' }).execute();
    }
    const category = (await ctx.categories.getByCode('J'))!.index;
    const model = async (name: string, prefix: string, lifetime: boolean) =>
      (
        await ctx.db
          .insertInto('models')
          .values({ category_id: category, name, type: 'RING', sku_prefix: prefix, default_material: '925 STERLING SILVER', warranty_lifetime: lifetime, base_price_minor: 45_000, base_currency: 'EUR' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const lune = await model('LUNE', 'LUN-CLM', true);
    const sellier = await model('SELLIER', 'SEL-CLM', false);
    client = await createAccount(ctx.db);
    const [l1, l2] = await holdPieces(ctx.db, client.id, 2, lune);
    const [t1] = await holdPieces(ctx.db, client.id, 1, sellier);
    // The boutique sale's piece: held by another account, its buyer without an ORBES account of record.
    const other = await createAccount(ctx.db);
    const [b1] = await holdPieces(ctx.db, other.id, 1, sellier);
    for (const [id, lifetime] of [[l1!, true], [l2!, true], [t1!, false], [b1!, false]] as const) {
      await ctx.db
        .insertInto('warranties')
        .values({ product_id: id, purchase_date: '2026-03-01', start_date: '2026-03-01', duration_months: 24, end_date: lifetime ? null : '2028-03-01', lifetime })
        .execute();
    }
    // An ISSUED LUNE identity, never sold: the replacement.
    const [spare] = await holdPieces(ctx.db, other.id, 1, lune);
    await ctx.db.deleteFrom('ownership').where('product_id', '=', spare!).execute();
    await ctx.db.updateTable('products').set({ status: 'ISSUED', ownership_state: 'UNREGISTERED' }).where('id', '=', spare!).execute();
    for (const [k, id] of [['lifetime', l1!], ['lifetime2', l2!], ['twoYears', t1!], ['spare', spare!], ['boutique', b1!]] as const) {
      serial[k] = (await ctx.db.selectFrom('products').select('product_id').where('id', '=', id).executeTakeFirstOrThrow()).product_id;
      uuid[k] = id;
    }
    // The client writes to Client Services about a piece: a claim is a normal message (answer 3).
    await ctx.services.messages.write(client.id, { body: 'My ring has tarnished.', context: { kind: 'PIECE', id: serial.lifetime } }, { type: 'account', id: client.id });
    conversationId = (await ctx.db.selectFrom('client_conversations').select('id').where('account_id', '=', client.id).executeTakeFirstOrThrow()).id;
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

  it('opens a lifetime piece’s claim from the conversation and takes each step as an OPERATOR, the free replacement then used', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/messages/${conversationId}`, client.email);
    await p.click('[data-testid=open-claim]');
    // First the piece: the three the client holds.
    expect(await options(p, 'piece')).toEqual([`${serial.lifetime} · LUNE`, `${serial.lifetime2} · LUNE`, `${serial.twoYears} · SELLIER`]);
    await p.selectOption('dialog select[name=piece]', serial.lifetime);
    await p.click('[data-testid=dialog-confirm]');
    // Then what it is claimed under: the warranty named as the server records it, read from the piece.
    await expect.poll(() => p.locator('dialog [data-testid=claim-open-text]').allTextContents(), POLL).toEqual(['Lifetime warranty']);
    expect(await options(p, 'basis')).toEqual(['ORBES warranty', 'Legal guarantee, until 01 MAR 2028']);
    await p.selectOption('dialog select[name=basis]', 'LEGAL');
    await expect.poll(() => p.locator('dialog [data-testid=claim-open-text]').allTextContents(), POLL).toEqual(['Legal guarantee: replacement, repair, price reduction or refund; never a credit.']);
    await p.selectOption('dialog select[name=basis]', 'WARRANTY');
    await p.fill('dialog textarea[name=note]', 'Tarnished, by phone.');
    await shot(p, 'open', { dialog: true });
    await confirm(p);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(serial.lifetime);
    expect(await p.locator('[data-testid=claim-basis]').textContent()).toBe('Lifetime warranty');
    expect(await status(p)).toBe('Open');
    expect(await p.locator('[data-testid=claim-client]').textContent()).toBe(client.email);
    expect(await p.locator('[data-testid=claim-free]').textContent()).toBe('Available');
    expect(await actions(p)).toEqual(['Send label', 'Refuse', 'Close']);
    // REFUSE lists the lifetime warranty's reasons (every one but Warranty ended).
    await p.click('[data-testid=claim-refuse]');
    expect((await options(p, 'reason')).slice(1)).toEqual(LIFETIME_REASONS);
    await cancel(p);
    // SEND LABEL: the PDF, a carrier, the tracking number.
    await p.click('[data-testid=claim-label]');
    const carrier = await p.locator('dialog select[name=carrierId] option').nth(1).getAttribute('value');
    await p.selectOption('dialog select[name=carrierId]', carrier!);
    await p.fill('dialog input[name=tracking]', '6A12345678901');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent(), POLL).toBe('Choose the label, a PDF.');
    await p.setInputFiles('dialog [data-testid=claim-label-file]', PDF);
    await confirm(p);
    await expect.poll(() => status(p), POLL).toBe('Label sent');
    expect(await p.locator('[data-testid=claim-label-shipment]').textContent()).toMatch(/ · 6A12345678901$/);
    expect(await actions(p)).toEqual(['Received', 'Close']);
    // RECEIVED: the INSPECTION record opened.
    await p.click('[data-testid=claim-receive]');
    await confirm(p);
    await expect.poll(() => status(p), POLL).toBe('With ORBES');
    expect(await actions(p)).toEqual(['Decide']);
    // DECIDE: the free replacement still available: the same piece new; LUNE still made, no credit of its value (answer 4);
    // no 30 % credit.
    await p.click('[data-testid=claim-decide]');
    expect(await options(p, 'outcome')).toEqual(['Choose a decision', 'Replace with the same piece, new', 'Refuse']);
    await cancel(p);
    // LUNE no longer made: the credit of its value is offered too (LUNE made again once decided).
    await ctx.db.updateTable('models').set({ active: false, discontinued_at: new Date() }).where('name', '=', 'LUNE').execute();
    await p.reload();
    await expect.poll(() => status(p), POLL).toBe('With ORBES');
    await p.click('[data-testid=claim-decide]');
    expect(await options(p, 'outcome')).toEqual(['Choose a decision', 'Replace with the same piece, new', 'Credit of its value (model no longer made)', 'Refuse']);
    await p.selectOption('dialog select[name=outcome]', 'REFUSED');
    expect((await options(p, 'reason')).slice(1)).toEqual(LIFETIME_REASONS);
    await p.selectOption('dialog select[name=outcome]', 'VALUE_CREDIT');
    await expect.poll(() => p.locator('dialog [data-testid=claim-decision-value]').textContent(), POLL).toBe('Value of the piece: € 450.');
    await p.selectOption('dialog select[name=outcome]', 'REPLACEMENT');
    await p.fill('dialog input[name=replacement]', serial.spare);
    await shot(p, 'decide-lifetime', { dialog: true });
    await confirm(p);
    await expect.poll(() => status(p), POLL).toBe('Decided');
    await ctx.db.updateTable('models').set({ active: true, discontinued_at: null }).where('name', '=', 'LUNE').execute();
    expect(await p.locator('[data-testid=claim-decision]').textContent()).toBe(`Replaced · by ${serial.spare}`);
    // SHIP: the new piece; DONE.
    await p.click('[data-testid=claim-ship]');
    await p.selectOption('dialog select[name=carrierId]', carrier!);
    await p.fill('dialog input[name=tracking]', '6A99999999999');
    await confirm(p);
    await expect.poll(() => status(p), POLL).toBe('Done');
    expect(await actions(p)).toEqual([]);
    expect(await p.locator('[data-testid=claim-free]').textContent()).toMatch(/^Used · \d{2} [A-Z]{3} \d{4} · claim$/);
    await shot(p, 'claim-done', { phone: true });
    // Nothing was written in the client's messages.
    expect((await ctx.db.selectFrom('client_messages').select('author').execute()).filter((m) => m.author === 'STAFF')).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('reads the replacement’s page (Lifetime, no Extend warranty, its free replacement used) and offers its own claim only the 30 % credit', async () => {
    const p = await open(OPERATOR);
    // The claimed piece's page: its Warranty claims table links the claim.
    await go(p, `#/products/${serial.lifetime}`, serial.lifetime);
    expect(await p.locator('#warranty [data-testid=piece-claim]').count()).toBe(1);
    // The replacement: its warranty started at shipment, of its model's kind.
    await go(p, `#/products/${serial.spare}`, serial.spare);
    expect(await p.locator('[data-testid=warranty-period]').textContent()).toMatch(/^\d{2} [A-Z]{3} \d{4} → Lifetime$/);
    expect(await p.locator('#warranty .deflist__row', { hasText: 'Period' }).textContent()).toContain('Lifetime');
    expect(await p.locator('[data-testid=action-warranty-extend]').count()).toBe(0);
    expect(await p.locator('[data-testid=free-replacement]').textContent()).toMatch(/^Used · \d{2} [A-Z]{3} \d{4} · claim$/);
    expect(await p.locator('.sheet__row--warranty .sheet__note').textContent()).toMatch(/ → Lifetime$/);
    await shot(p, 'piece-lifetime', { phone: true });
    // The client registers it; its own claim: no free replacement of its own (answer 4), only the 30 % credit.
    await ctx.db.insertInto('ownership').values({ product_id: uuid.spare!, account_id: client.id, acquired_via: 'FIRST_REGISTRATION', started_at: new Date() }).execute();
    await ctx.db.updateTable('products').set({ status: 'OWNED', ownership_state: 'OWNED' }).where('id', '=', uuid.spare!).execute();
    const id = await received(serial.spare);
    await go(p, `#/warranty-claims/${id}`, serial.spare);
    expect(await p.locator('[data-testid=claim-free]').textContent()).toMatch(/^Used · /);
    await p.click('[data-testid=claim-decide]');
    expect(await options(p, 'outcome')).toEqual(['Choose a decision', '30 % credit', 'Refuse']);
    await p.selectOption('dialog select[name=outcome]', 'PART_CREDIT');
    await expect.poll(() => p.locator('dialog [data-testid=claim-decision-note]').textContent(), POLL).toBe(
      'A credit of € 135 (30 % of € 450), valid 12 months. The piece returns to the client.',
    );
    await confirm(p);
    await expect.poll(() => status(p), POLL).toBe('Decided');
    expect(await p.locator('[data-testid=claim-decision]').textContent()).toMatch(/^30 % credit · € 135 until \d{2} [A-Z]{3} \d{4}$/);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('takes a 2-year claim: a repair or the same piece new, never a credit; moved to the legal guarantee, then refunded', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/messages/${conversationId}`, client.email);
    await p.click('[data-testid=open-claim]');
    await p.selectOption('dialog select[name=piece]', serial.twoYears);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog [data-testid=claim-open-text]').allTextContents(), POLL).toEqual(['2-year warranty (defects only)']);
    await cancel(p);
    const id = await received(serial.twoYears);
    await go(p, `#/warranty-claims/${id}`, serial.twoYears);
    expect(await p.locator('[data-testid=claim-basis]').textContent()).toBe('2-year warranty');
    expect(await p.locator('[data-testid=claim-free]').count()).toBe(0);
    expect(await actions(p)).toEqual(['Decide', 'Move to the legal guarantee']);
    await p.click('[data-testid=claim-decide]');
    expect(await options(p, 'outcome')).toEqual(['Choose a decision', 'Replace with the same piece, new', 'Repaired', 'Refuse']);
    await p.selectOption('dialog select[name=outcome]', 'REFUSED');
    expect((await options(p, 'reason')).slice(1)).toEqual(['Lost', 'Theft reported', 'No manufacturing defect', 'Warranty ended', 'Warranty no longer valid']);
    await shot(p, 'decide-two-years', { dialog: true });
    await cancel(p);
    // MOVE TO THE LEGAL GUARANTEE: a boutique sale (no order), the receipt in the note; the LEGAL claim's page follows.
    await p.click('[data-testid=claim-legal]');
    await p.fill('dialog textarea[name=note]', 'Receipt 4471, ORBES Paris, 1 March 2026.');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('[data-testid=claim-basis]').textContent(), POLL).toBe('Legal guarantee');
    expect(await status(p)).toBe('With ORBES');
    expect(await p.locator('[data-testid=claim-continues]').textContent()).toBe('The 2-year claim');
    await p.click('[data-testid=claim-decide]');
    expect(await options(p, 'outcome')).toEqual(['Choose a decision', 'Replace with the same piece, new', 'Repaired', 'Price reduction', 'Refund', 'Refuse']);
    await p.selectOption('dialog select[name=outcome]', 'REFUSED');
    expect((await options(p, 'reason')).slice(1)).toEqual(['Damaged on purpose', 'Damaged by someone else', 'No lack of conformity']);
    // A refund: the price paid, entered (a boutique sale, no order).
    await p.selectOption('dialog select[name=outcome]', 'REFUND');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent(), POLL).toBe('Enter the amount, in units.');
    await p.fill('dialog input[name=amount]', '450');
    await shot(p, 'decide-legal', { dialog: true });
    await confirm(p);
    await expect.poll(() => status(p), POLL).toBe('Done');
    expect(await p.locator('[data-testid=claim-decision]').textContent()).toBe('Refunded · € 450');
    // The 2-year claim links the one continuing it.
    await go(p, `#/warranty-claims/${id}`, serial.twoYears);
    expect(await status(p)).toBe('Closed');
    expect(await p.locator('[data-testid=claim-continued]').textContent()).toBe('The legal guarantee’s claim');
    await p.context().close();
  }, STEP_TIMEOUT);

  it('opens a legal-guarantee claim from a piece page for a buyer without an ORBES account', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/products/${serial.boutique}`, serial.boutique);
    await p.click('[data-testid=action-legal-claim]');
    expect(await p.locator('dialog [data-testid=legal-claim-until]').textContent()).toBe('The legal guarantee applies until 01 MAR 2028.');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent(), POLL).toBe('Complete the required fields.');
    await p.fill('dialog textarea[name=note]', 'Receipt 5120, ORBES Paris, 1 March 2026.');
    await confirm(p);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(serial.boutique);
    expect(await p.locator('[data-testid=claim-basis]').textContent()).toBe('Legal guarantee');
    expect(await p.locator('[data-testid=claim-client]').textContent()).toBe('No ORBES account');
    expect(await p.locator('[data-testid=claim-conversation]').textContent()).toBe('No conversation');
    // One claim at a time: the piece page no longer offers it.
    await go(p, `#/products/${serial.boutique}`, serial.boutique);
    expect(await p.locator('[data-testid=action-legal-claim]').count()).toBe(0);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('lists the claims under Warranties → Claims, the ones under way first; an AUDITOR reads a claim without one action', async () => {
    const p = await open(OPERATOR);
    await go(p, '#/warranties', 'Warranties');
    expect(await p.locator('.page-head').textContent()).toContain('Started on the purchase date, for life or for 2 years, as its model says.');
    // A lifetime warranty reads End Lifetime and Months —.
    const row = p.locator('table.table tbody tr', { hasText: serial.lifetime2 });
    expect((await row.locator('td').allTextContents()).slice(3, 5)).toEqual(['Lifetime', '—']);
    await p.click('[data-testid=warranties-tab-claims]');
    // The claims under way first (the newest first), then the others; the 2-year claim moved and the LEGAL claim
    // continuing it share their opening.
    await expect.poll(() => p.locator('[data-testid=claim-row-status]').count(), POLL).toBe(5);
    const statuses = await p.locator('[data-testid=claim-row-status]').allTextContents();
    expect(statuses.slice(0, 2)).toEqual(['Open', 'Decided']);
    expect(statuses.slice(2).sort()).toEqual(['Closed', 'Done', 'Done']);
    await shot(p, 'claims-tab', { phone: true });
    await p.selectOption('select[name=status]', 'DONE');
    await expect.poll(() => p.locator('[data-testid=claim-row-status]').allTextContents(), POLL).toEqual(['Done', 'Done']);
    // A row opens its claim (its Opened cell: the piece and the client cells are their own links).
    await p.locator('table.table tbody tr').first().locator('td').first().click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toMatch(/^O26-J-\d{5}$/);
    expect(await status(p)).toBe('Done');
    await p.context().close();
    // An AUDITOR reads a claim, the client's email masked, without one action; no Open a warranty claim on the conversation.
    const a = await open(AUDITOR);
    await go(a, `#/warranty-claims/${await claimOf(uuid.spare!)}`, serial.spare);
    expect(await actions(a)).toEqual([]);
    expect(await a.locator('[data-testid=claim-client]').textContent()).not.toBe(client.email);
    await a.evaluate((h) => (location.hash = h), `#/messages/${conversationId}`);
    await a.waitForSelector('[data-testid=conversation-client]', POLL);
    expect(await a.locator('[data-testid=open-claim]').count()).toBe(0);
    await a.context().close();
  }, STEP_TIMEOUT);
});
