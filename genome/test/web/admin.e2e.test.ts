/**
 * Admin console end to end: the production web build served by the real
 * Fastify app (in-memory PGlite, bootstrap admin from the config, memory key
 * provider) and driven in Chromium through playwright-core.
 *
 * Flow: sign in → create a model in the catalogue → issue a product with the
 * generator (claim code shown once, its certificate card, code preview) → download the SVG and
 * decode it with the core decoder after rasterising it with resvg, then
 * verify the decoded data through the public API → product page (spec §22)
 * → warranty activation and code re-issue → key rotation → audit chain
 * verification → a batch of 120 products from a CSV (preview, requests of
 * 50, results piece by piece, the page held until the claim codes are saved,
 * certificate cards) and a quantity → sign out. Also: anomaly triage (the badge and the tab title,
 * the filters, a finding's scans, one dialog that marks the piece, revokes its
 * code and resolves the finding), TOTP enrolment + two-step sign-in, and the
 * read-only AUDITOR console. No CSP violation or page error is tolerated.
 *
 * Set ORBES_SCREENSHOTS=1 to write 1440×900 screenshots of the dashboard,
 * the generator result and the product page to genome/out/.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { equalBytes, fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import { encodePayload, frameCodeData, issuedDayFromDate, signingMessage } from '../../src/core/payload.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { ANOMALY_TYPES } from '../../src/server/services/anomaly.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { svgToGray } from '../support/raster.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 120_000;

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

const hex = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Visible text set in Gravesend Sans that holds a one or a zero: none should (its one is its capital I, its
 * zero an O). Identifiers, codes and counts read in Helvetica Neue; a fixed label (24 h, SHA-256) may keep its figures.
 */
async function figuresInDisplayFace(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
      .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
      .filter((t) => /[01]/.test(t)),
  );
}

/**
 * A registry with some history, so the dashboard and lists show real
 * shapes: products across statuses, scans from several countries, an
 * impossible-travel finding, a lost product scanned, and a validly signed
 * code for an identity that was never registered (CRITICAL).
 */
async function seedRegistry(ctx: AppContext, modelId: string): Promise<IssueResult[]> {
  const { issuance, lifecycle, warranty, verification } = ctx.services;
  const issued: IssueResult[] = [];
  for (let i = 0; i < 9; i++) {
    issued.push(
      await issuance.issueProduct(
        { categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, variant: String(48 + i), productionBatch: 'B-2026-09-A', productionDate: '2026-09-01' },
        SYSTEM_ACTOR,
      ),
    );
  }
  const id = (i: number) => issued[i].product.productId;
  for (let i = 0; i < 6; i++) await warranty.activate(id(i), { purchaseDate: '2026-09-12', retailer: 'ORBES PARIS — RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
  for (let i = 0; i < 3; i++) await lifecycle.transition(id(i), 'OWNED', { reason: 'Sold in boutique' }, SYSTEM_ACTOR);
  await lifecycle.transition(id(4), 'LOST', { reason: 'Reported by client services' }, SYSTEM_ACTOR);

  const scan = (i: number, device: string, country: string) =>
    verification.verify({ code: issued[i].code.data }, { deviceHash: hex(device), ipHash: hex(`ip-${device}`), geo: { country }, userAgentFamily: 'Mobile Safari' });
  for (let i = 0; i < 6; i++) await scan(i, `device-${i}`, i % 2 ? 'FR' : 'GB');
  await scan(0, 'device-0', 'FR');
  await scan(0, 'device-travel', 'JP'); // FR → JP within seconds
  await scan(4, 'device-lost', 'IT'); // a LOST product is scanned

  const signer = await ctx.keys.activeSigner();
  const category = (await ctx.categories.getByCode('J'))!;
  const payload = encodePayload({
    codeVersion: 1,
    genomeVersion: 1,
    keyId: signer.keyId,
    identity: { year: 2026, categoryIndex: category.index, serial: 990_001 },
    issue: 1,
    issuedDay: issuedDayFromDate(new Date()),
    nonce: new Uint8Array([9, 8, 7, 6]),
  });
  const signature = await signer.sign(signingMessage(payload));
  await verification.verify({ code: toBase64Url(frameCodeData(payload, signature)) }, { deviceHash: hex('device-unregistered'), geo: { country: 'CN' } });
  return issued;
}

describe.skipIf(!HAS_CHROMIUM)('admin console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let modelId: string;
  const problems: string[] = [];
  let issuedProductId = '';
  /** The pieces seedRegistry issued: the first one travelled from France to Japan in seconds. */
  let seeded: IssueResult[] = [];

  async function watch(p: Page): Promise<void> {
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    // Injected through CDP (not subject to the page CSP): records any policy violation.
    await p.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __csp: string[] }).__csp ??= [];
        (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
  }

  async function cspViolations(p: Page): Promise<string[]> {
    return p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  }

  async function signIn(p: Page, email: string, password: string): Promise<void> {
    await p.goto(`${origin}/admin`);
    await p.waitForSelector('[data-testid=login-form]');
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', password);
    await p.click('[data-testid=login-submit]');
  }

  const title = (p: Page) => p.locator('h1.page-head__title');

  async function go(p: Page, hash: string, heading: string | RegExp): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toMatch(heading instanceof RegExp ? heading : new RegExp(`^${heading}$`, 'i'));
  }

  async function confirmDialog(p: Page, phrase?: string): Promise<void> {
    if (phrase) await p.fill('[data-testid=dialog-phrase]', phrase);
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  async function shot(p: Page, name: string, opts: { full?: boolean } = {}): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    // Top of the page, without transient notices.
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((t) => t.remove());
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await p.waitForTimeout(400); // let the entrance fade settle
    await p.screenshot({ path: join(OUT_DIR, `admin-${name}.png`) });
    if (opts.full) await p.screenshot({ path: join(OUT_DIR, `admin-${name}-full.png`), fullPage: true });
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });

    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });

    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    await ctx.categories.create({ code: 'L', name: 'Leather goods', warrantyMonths: 24 }, SYSTEM_ACTOR);
    const collection = await ctx.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    const model = await ctx.db
      .insertInto('models')
      .values({
        category_id: (await ctx.categories.getByCode('J'))!.index,
        collection_id: collection.id,
        name: 'MONOLITHE',
        type: 'RING',
        sku_prefix: 'MNL-RG',
        default_material: '925 STERLING SILVER',
        care_instructions: 'Wipe with a soft, dry cloth.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    modelId = model.id;
    seeded = await seedRegistry(ctx, modelId);

    app = await buildApp(ctx, { serveStatic: true, staticDir: webDir });
    await app.listen({ port, host: '127.0.0.1' });

    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    page = await context.newPage();
    await watch(page);
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await app?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await t?.close().catch(() => {});
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('serves the console shell under the strict CSP', async () => {
    const res = await fetch(`${origin}/admin`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    const html = await res.text();
    expect(html).not.toMatch(/<style|\sstyle=|<script>(?!<)/i);
    expect(html).toMatch(/<script type="module" src="\/assets\/admin-[A-Z0-9]{8}\.js"><\/script>/);
  });

  it('refuses a wrong password, then signs the bootstrap admin in', async () => {
    await page.goto(`${origin}/admin`);
    await page.waitForSelector('[data-testid=login-form]');
    // The wordmark and the sign-in labels in the display face, fetched once through the preload; inputs read in Helvetica Neue.
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Gravesend Sans').map((f) => f.status))).toEqual(['loaded']);
    for (const selector of ['.login__wordmark', '.login__title', '.cfield__label', '[data-testid=login-submit]']) {
      expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily), selector).toMatch(/^"?Gravesend Sans"?,/);
    }
    expect(await page.locator('input[name=email]').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.woff2')).length)).toBe(1);
    // The monogram over the typed word, in ink, decorative beside it (BRAND §3.9).
    const loginMono = page.locator('.login__main > svg.monogram.login__monogram');
    expect(await loginMono.locator('path').count()).toBe(5);
    expect(await loginMono.getAttribute('aria-hidden')).toBe('true');
    expect(await loginMono.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(10, 10, 10)');
    const [mono, word] = [(await loginMono.boundingBox())!, (await page.locator('.login__wordmark').boundingBox())!];
    expect(mono.width).toBeCloseTo(72, 0);
    expect(mono.x + mono.width / 2).toBeCloseTo(word.x + word.width / 2, 0);
    expect(mono.y + mono.height).toBeLessThan(word.y);
    await shot(page, 'login');
    expect(await page.isVisible('input[name=totp]')).toBe(false);
    await signIn(page, ADMIN.email, 'not the password at all');
    await expect.poll(async () => page.locator('.login__error').textContent()).toMatch(/invalid email or password/i);
    expect(await page.inputValue('input[name=password]')).toBe('');

    await page.fill('input[name=password]', ADMIN.password);
    await page.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Dashboard');
    // Dashboard figures come from the seeded registry.
    expect(await page.locator('.kpi').first().locator('.kpi__value').textContent()).toBe('9');
    expect(await page.locator('.side__link.is-active').textContent()).toBe('Dashboard');
    // The sidebar's monogram, over the word and left-aligned with it; the link is named by its words.
    const sideMono = page.locator('a.side__brand > svg.monogram.side__monogram');
    expect(await sideMono.getAttribute('aria-hidden')).toBe('true');
    expect((await sideMono.boundingBox())!.width).toBeCloseTo(44, 0);
    expect((await sideMono.boundingBox())!.x).toBeCloseTo((await page.locator('.side__wordmark').boundingBox())!.x, 0);
    expect(await page.getByRole('link', { name: /^orbes\s*genome console$/i }).count()).toBe(1);
    expect(await page.locator('.bar').count()).toBeGreaterThanOrEqual(8);
    // Counts, the key id and dates read in Helvetica Neue.
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'dashboard', { full: true });
  }, STEP_TIMEOUT);

  it('creates a model in the catalogue', async () => {
    await go(page, '#/catalogue', 'Catalogue');
    await page.getByRole('button', { name: 'New model' }).click();
    await page.selectOption('dialog select[name=categoryCode]', 'J');
    await page.fill('dialog input[name=name]', 'ECLIPSE');
    await page.fill('dialog input[name=type]', 'PENDANT');
    await page.fill('dialog input[name=skuPrefix]', 'ECL-PD');
    await page.fill('dialog input[name=defaultMaterial]', '18K YELLOW GOLD');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Model created.")');
    await expect.poll(() => page.locator('td:has-text("ECL-PD")').count()).toBe(1);
    await shot(page, 'catalogue');
  }, STEP_TIMEOUT);

  it('issues a product with the generator and shows the one-time claim code', async () => {
    await go(page, '#/generator', 'Issue a product');
    await page.selectOption('select[name=categoryCode]', 'J');
    await page.selectOption('select[name=modelId]', modelId);
    expect(await page.inputValue('input[name=material]')).toBe('925 STERLING SILVER'); // model default
    await page.fill('input[name=variant]', '52');
    await page.fill('input[name=productionBatch]', 'B-2026-10-A');
    // Pin the identity year so the expected id does not depend on the date the suite runs.
    await page.fill('input[name=year]', '2026');
    expect(await page.locator('.gen__identity-id').textContent()).toBe('O26-J-·····');
    expect(await page.isChecked('input[name=withClaimSecret]')).toBe(true);
    await shot(page, 'generator-form');

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/products') && r.request().method() === 'POST'),
      page.click('[data-testid=issue-submit]'),
    ]);
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { product: { productId: string }; code: { data: string; id: string }; claimCode: string };
    issuedProductId = body.product.productId;
    expect(issuedProductId).toMatch(/^O26-J-\d{5}$/);
    expect(issuedProductId).toBe('O26-J-00010');

    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe(issuedProductId);
    expect(await page.locator('[data-testid=claim-code]').textContent()).toBe(body.claimCode);
    expect(body.claimCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await page.locator('[data-testid=genome-figure] svg path').count()).toBeGreaterThan(8);
    expect(await page.locator('[data-testid=code-figure] svg path').count()).toBeGreaterThan(100);
    await shot(page, 'generator', { full: true });

    // Theme switch re-renders the same code on ivory.
    await page.selectOption('select[name=theme]', 'ivory');
    await page.waitForSelector('[data-testid=code-figure].figure--theme-ivory');

    // The certificate card that carries the claim code, checked against its hash by the server.
    const [card] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-certificate]')]);
    expect(card.suggestedFilename()).toBe(`ORBES-certificate-${issuedProductId}-PROOF.pdf`);
    expect(readFileSync((await card.path())!).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    // Hiding drops the only copy the console holds, and the card download goes with it.
    await page.getByRole('button', { name: /I have recorded it/ }).click();
    expect(await page.locator('[data-testid=claim-code]').textContent()).not.toContain(body.claimCode.slice(0, 4));
    expect(await page.locator('[data-testid=download-certificate]').count()).toBe(0);
    await page.selectOption('select[name=theme]', 'classic');
    expect(await page.locator('select[name=theme] option').allTextContents()).toEqual(['CLASSIC — BLACK ON WHITE', 'INVERTED — WHITE ON BLACK', 'IVORY — INK ON IVORY']);

    // Print size: a quiet warning under 30 mm, a refusal under 15 mm unless marked as a test print.
    await page.fill('input[name=widthMm]', '25');
    await expect.poll(() => page.locator('[data-testid=artifact-size-advice]').textContent()).toMatch(/below the 30 mm minimum/);
    await page.fill('input[name=widthMm]', '12');
    await page.click('[data-testid=download-svg]');
    await expect.poll(() => page.locator('.artifact__error').textContent()).toMatch(/test print/);
    await page.fill('input[name=widthMm]', '30');
    await expect.poll(() => page.locator('[data-testid=artifact-size-advice]').textContent()).toBe('');

    // ── Download the SVG, rasterise it, decode it, verify it ──────────────
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-svg]')]);
    expect(download.suggestedFilename()).toMatch(/^ORBES-O26-J-00010-I1-classic-30mm\.svg$/);
    const svg = readFileSync((await download.path())!, 'utf8');
    expect(svg).toMatch(/^<svg[^>]+viewBox="/);
    expect(svg).toContain('</svg>');
    const decoded = decodeOrbesCode(svgToGray(svg, { widthPx: 900 }), { readGenome: true });
    expect(decoded.ok, decoded.ok ? '' : `${decoded.reason} ${decoded.detail ?? ''}`).toBe(true);
    if (!decoded.ok) return;
    expect(equalBytes(decoded.data, fromBase64Url(body.code.data))).toBe(true);
    const verify = await fetch(`${origin}/api/v1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ code: toBase64Url(decoded.data) }),
    });
    const outcome = (await verify.json()) as { state: string; product?: { productId: string } };
    expect(outcome.state).toMatch(/^AUTHENTIC/);
    expect(outcome.product?.productId).toBe(issuedProductId);
  }, STEP_TIMEOUT);

  it('opens the product page (spec §22) and runs product actions', async () => {
    await page.getByRole('link', { name: 'Open product page' }).click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe(issuedProductId);
    const row = (key: string) => page.locator(`[data-testid=product-sheet] [data-row=${key}]`);
    await expect.poll(() => row('code').textContent()).toContain('ACTIVE');
    expect(await row('signature').textContent()).toContain('VALID');
    expect(await row('scans').textContent()).toMatch(/^Scan count1/i);
    expect(await row('warranty').textContent()).toContain('NOT STARTED');
    expect(await page.locator('.side__link.is-active').textContent()).toBe('Products');
    // The title is the product id: it reads in Helvetica Neue, like the crumb and the panel notes.
    expect(await title(page).evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    expect(await figuresInDisplayFace(page)).toEqual([]);

    await page.click('[data-testid=action-warranty]');
    // The dialog's eyebrow is the product id, and no field label carries a figure: nothing there in Gravesend.
    await page.waitForSelector('dialog.dialog .dialog__eyebrow');
    expect((await page.locator('dialog.dialog .dialog__eyebrow').textContent())?.trim()).toBe(issuedProductId);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await confirmDialog(page);
    await expect.poll(() => row('warranty').textContent()).toContain('ACTIVE');
    await expect.poll(() => row('status').textContent()).toContain('ACTIVATED');
    await shot(page, 'product', { full: true });

    // Extend the warranty by 12 months (the dialog's default).
    await page.click('[data-testid=action-warranty-extend]');
    await confirmDialog(page);
    await expect.poll(async () => (await ctx.services.warranty.get(issuedProductId))?.durationMonths).toBe(36);

    // Re-issue: the new code is signed and previewed; the old one is superseded.
    await page.click('[data-testid=action-reissue]');
    await page.fill('dialog textarea[name=reason]', 'Engraving damaged during sizing');
    await confirmDialog(page);
    await page.waitForSelector('#fresh-code [data-testid=code-figure] svg');
    await expect.poll(() => row('code').textContent()).toContain('Issue 2');
    expect(await page.locator('#codes tbody tr').count()).toBe(2);
    expect(await page.locator('#codes tbody tr').nth(1).textContent()).toContain('SUPERSEDED');
  }, STEP_TIMEOUT);

  it('downloads a print sheet of codes selected in the codes list', async () => {
    await go(page, '#/codes', 'Codes');
    const picks = page.locator('[data-testid=sheet-select]');
    await expect.poll(() => picks.count()).toBeGreaterThan(2);
    await picks.nth(0).check();
    await picks.nth(1).check();
    await expect.poll(() => page.locator('[data-testid=sheet-count]').textContent()).toBe('2 codes selected');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-sheet]')]);
    expect(download.suggestedFilename()).toMatch(/^ORBES-sheet-\d{4}-\d{2}-\d{2}-2-classic-30mm\.pdf$/);
    expect(readFileSync((await download.path())!).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, STEP_TIMEOUT);

  it('lists the product, filters by status and opens it from the table', async () => {
    await go(page, `#/products?q=${issuedProductId}`, 'Products');
    expect(await page.locator('table.table tbody tr').count()).toBe(1);
    await go(page, '#/products?status=LOST', 'Products');
    await expect.poll(() => page.locator('table.table tbody tr').count()).toBe(1);
    await go(page, '#/products', 'Products');
    await shot(page, 'products');
    for (const [hash, heading, name] of [
      ['#/genomes', 'Genomes', 'genomes'],
      ['#/codes', 'Codes', 'codes'],
      ['#/scans', 'Verification events', 'scans'],
      ['#/owners', 'Owners', 'owners'],
      ['#/warranties', 'Warranties', 'warranties'],
      ['#/revocations', 'Revocations', 'revocations'],
    ] as const) {
      await go(page, hash, heading);
      expect(await page.locator('.failure').count(), hash).toBe(0);
      await shot(page, name);
    }
    await go(page, '#/anomalies?status=OPEN', 'Anomalies');
    expect(await page.locator('table.table tbody tr').count()).toBeGreaterThanOrEqual(2);
    await shot(page, 'anomalies');
    expect(await page.locator('.status--critical').count()).toBeGreaterThanOrEqual(1);
  }, STEP_TIMEOUT);

  it('triages an anomaly', async () => {
    await go(page, '#/anomalies?status=OPEN&severity=CRITICAL', 'Anomalies');
    await page.locator('[data-testid=triage]').first().click();
    // Resolving needs a note: the dialog refuses without one.
    await page.selectOption('dialog select[name=status]', 'RESOLVED');
    await page.click('[data-testid=dialog-confirm]');
    await expect.poll(() => page.locator('.dialog__error').textContent()).toMatch(/note/i);
    await page.selectOption('dialog select[name=status]', 'ACKNOWLEDGED');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("ACKNOWLEDGED")');
    await go(page, '#/anomalies?status=ACKNOWLEDGED', 'Anomalies');
    await expect.poll(() => page.locator('table.table tbody tr').count()).toBe(1);
  }, STEP_TIMEOUT);

  it('resolves an anomaly and revokes its code in one dialog; the badge and the tab title follow', async () => {
    const piece = seeded[0];
    const pid = piece.product.productId;
    const { anomaly } = ctx.services;
    const travel = (await anomaly.list({ productId: pid, type: 'IMPOSSIBLE_TRAVEL' }, { page: 1, pageSize: 10 })).items[0];
    const jp = await ctx.db.selectFrom('scan_events').select('id').where('product_id', '=', piece.product.id).where('country', '=', 'JP').executeTakeFirstOrThrow();
    expect(travel).toMatchObject({ status: 'OPEN', severity: 'HIGH', details: { scanEventId: jp.id } });

    // The badge on Anomalies and the tab title count the OPEN HIGH and CRITICAL findings.
    const before = (await anomaly.summary()).attention;
    expect(before).toBeGreaterThanOrEqual(2);
    const badge = page.locator('.side__link[data-route=anomalies] [data-testid=anomaly-badge]');
    await go(page, `#/products/${pid}`, pid);
    await expect.poll(() => badge.locator('.side__badge-count').textContent()).toBe(String(before));
    expect(await badge.isVisible()).toBe(true);
    expect(await badge.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    await expect.poll(() => page.title()).toBe(`(${before}) ${pid} — ORBES Genome Console`);

    // Triage from the product page: the list of this piece's findings, with every type the server records.
    await page.click('#anomalies a.cbtn:has-text("Triage")');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/anomalies?productId=${pid}`);
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Anomalies');
    expect(await page.title()).toBe(`(${before}) Anomalies — ORBES Genome Console`);
    expect(await page.inputValue('input[name=productId]')).toBe(pid);
    const ofPiece = (await anomaly.list({ productId: pid }, { page: 1, pageSize: 50 })).total;
    await expect.poll(() => page.locator('table.table tbody tr').count()).toBe(ofPiece);
    expect(await page.locator('select[name=type] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['', ...ANOMALY_TYPES]);
    expect(await page.locator('select[name=sort] option').allTextContents()).toEqual(['Severity, then risk', 'Risk', 'Last seen']);
    await page.selectOption('select[name=type]', 'IMPOSSIBLE_TRAVEL');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/anomalies?productId=${pid}&type=IMPOSSIBLE_TRAVEL`);
    await page.selectOption('select[name=sort]', 'risk');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/anomalies?productId=${pid}&type=IMPOSSIBLE_TRAVEL&sort=risk`);
    await expect.poll(() => page.locator('table.table tbody tr').count()).toBe(1);

    // The detail: the piece's scans in the finding's window, their countries, the devices, the scan that raised it.
    await page.click('[data-testid=anomaly-details]');
    await page.waitForSelector('#finding [data-testid=anomaly-timeline]');
    expect(await page.locator('table.table tbody tr.is-current').count()).toBe(1);
    const scans = page.locator('[data-testid=anomaly-timeline] .timeline__item');
    expect(await scans.count()).toBe(3);
    expect(await page.locator('.timeline__item--trigger').getAttribute('data-scan')).toBe(jp.id);
    expect(await page.locator('.timeline__item--trigger .timeline__who').textContent()).toMatch(/^JP/);
    const fact = (label: string) => page.locator('#finding .deflist__row', { has: page.locator('.deflist__label', { hasText: label }) }).locator('.deflist__value');
    expect(await fact('Countries').textContent()).toBe('FR 1 · GB 1 · JP 1');
    expect(await fact('Distinct devices').textContent()).toBe('2');
    expect(await fact('Code').textContent()).toBe('Issue 1ACTIVE');
    expect(await figuresInDisplayFace(page)).toEqual([]);

    // The triggering scan opens in Verification events, marked, within the second it was made in.
    await page.click('[data-testid=trigger-scan]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Verification events');
    await page.waitForSelector('[data-testid=scans-window]');
    await expect.poll(() => page.locator('table.table tbody tr.is-current').count()).toBe(1);
    expect(await page.locator('table.table tbody tr.is-current').getAttribute('aria-current')).toBe('true');
    await page.goBack();
    await page.waitForSelector('#finding [data-testid=anomaly-timeline]');

    // One dialog: mark the piece, revoke its code, resolve the finding. The code's revocation asks for its phrase.
    await page.click('[data-testid=detail-triage]');
    await page.waitForSelector('dialog.dialog');
    const phrase = page.locator('[data-testid=dialog-phrase]');
    expect(await phrase.isVisible()).toBe(false);
    await page.selectOption('dialog select[name=status]', 'RESOLVED');
    // The boxes are ticked through their labels, as a pointer does (the drawn mark covers the input).
    await page.locator('dialog label.ccheck', { hasText: 'Mark the piece COUNTERFEIT FLAGGED' }).click();
    await page.locator('dialog label.ccheck', { hasText: 'Revoke the code (issue 1)' }).click();
    expect(await page.getByLabel('Mark the piece COUNTERFEIT FLAGGED').isChecked()).toBe(true);
    expect(await page.getByLabel('Mark the piece STOLEN').isChecked()).toBe(false);
    expect(await page.getByLabel('Revoke the code (issue 1)').isChecked()).toBe(true);
    expect(await phrase.isVisible()).toBe(true);
    expect(await page.locator('dialog.dialog .cfield__phrase').textContent()).toBe('REVOKE ISSUE 1');
    expect(await page.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await page.fill('dialog textarea[name=note]', 'Seized at a market stall in Lyon');
    await page.fill('[data-testid=dialog-phrase]', 'REVOKE ISSUE 1');
    expect(await figuresInDisplayFace(page)).toEqual([]);

    // A step that fails stops the chain and the dialog says which steps were done.
    const revokeUrl = `**/api/admin/codes/${piece.code.id}/revoke`;
    await page.route(revokeUrl, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The server is busy.' } }) }));
    await page.click('[data-testid=dialog-confirm]');
    await expect.poll(() => page.locator('.dialog__error').textContent()).toMatch(/^Revoke the code: The server is busy\. The steps done stay done/);
    const report = page.locator('[data-testid=decision-steps] .steps__item');
    expect(await report.evaluateAll((items) => items.map((i) => `${i.querySelector('.steps__label')?.textContent} ${(i as HTMLElement).dataset.state}`))).toEqual([
      'Mark the piece COUNTERFEIT FLAGGED done',
      'Revoke the code failed',
      'Record the finding RESOLVED pending',
    ]);
    expect((await ctx.services.lifecycle.snapshot(piece.product.id)).status).toBe('COUNTERFEIT_FLAGGED');
    expect((await anomaly.get(travel.id)).status).toBe('OPEN');

    // Confirming again runs the rest only: the piece is not marked twice.
    await page.unroute(revokeUrl);
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Finding RESOLVED · piece COUNTERFEIT FLAGGED · code revoked.")');
    const marks = (await ctx.services.lifecycle.history(pid)).filter((e) => e.to === 'COUNTERFEIT_FLAGGED');
    expect(marks).toHaveLength(1);
    expect(marks[0].reason).toBe(`Anomaly ${travel.id} (IMPOSSIBLE TRAVEL): Seized at a market stall in Lyon`);
    const code = await ctx.db.selectFrom('codes').select(['status', 'revocation_reason']).where('id', '=', piece.code.id).executeTakeFirstOrThrow();
    expect(code).toEqual({ status: 'REVOKED', revocation_reason: `Anomaly ${travel.id} (IMPOSSIBLE TRAVEL): Seized at a market stall in Lyon` });
    expect(await anomaly.get(travel.id)).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Seized at a market stall in Lyon' });

    // The finding has left the badge and the title.
    await expect.poll(() => badge.locator('.side__badge-count').textContent()).toBe(String(before - 1));
    await expect.poll(() => page.title()).toBe(`(${before - 1}) Anomalies — ORBES Genome Console`);
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('rotates the signing key with a typed confirmation', async () => {
    await go(page, '#/keys', 'Signing keys');
    expect(await page.locator('table.table tbody tr').count()).toBe(1);
    await page.click('[data-testid=key-rotate]');
    expect(await page.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await page.fill('[data-testid=dialog-phrase]', 'rotat');
    expect(await page.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await shot(page, 'dialog');
    await confirmDialog(page, 'ROTATE');
    await page.waitForSelector('.toast:has-text("New signing key active.")');
    await expect.poll(() => page.locator('table.table tbody tr').count()).toBe(2);
    const rows = await page.locator('table.table tbody tr').allTextContents();
    expect(rows[0]).toMatch(/#2.*ACTIVE/);
    expect(rows[1]).toMatch(/#1.*RETIRED/);
    await shot(page, 'keys');
  }, STEP_TIMEOUT);

  it('revokes a product only after the typed phrase, then reinstates it', async () => {
    const pid = 'O26-J-00009';
    const row = (key: string) => page.locator(`[data-testid=product-sheet] [data-row=${key}]`);
    await go(page, `#/products/${pid}`, pid);
    await page.click('[data-testid=action-transition]');
    await page.selectOption('dialog select[name=to]', 'REVOKED');
    await page.fill('dialog textarea[name=reason]', 'Counterfeit investigation');
    await page.click('[data-testid=dialog-confirm]');
    // Second step: the irreversible move needs the exact phrase.
    await page.waitForSelector('[data-testid=dialog-phrase]');
    // The phrase to retype names the product: it reads in Helvetica Neue, as the eyebrow does.
    expect(await page.locator('dialog.dialog .cfield__phrase').textContent()).toBe(`REVOKE ${pid}`);
    expect(await page.locator('dialog.dialog .cfield__phrase').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await page.fill('[data-testid=dialog-phrase]', 'REVOKE O26-J-00008');
    expect(await page.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await confirmDialog(page, `revoke ${pid.toLowerCase()}`);
    await expect.poll(() => row('status').textContent()).toContain('REVOKED');

    await page.click('[data-testid=action-reinstate]');
    await confirmDialog(page);
    await expect.poll(() => row('status').textContent()).toContain('ISSUED');

    await go(page, '#/revocations', 'Revocations');
    await expect.poll(() => page.locator(`td a:has-text("${pid}")`).count()).toBe(1);
  }, STEP_TIMEOUT);

  it('verifies the audit chain', async () => {
    await go(page, '#/audit', 'Audit log');
    expect(await page.locator('table.table tbody tr').count()).toBeGreaterThan(10);
    await expect.poll(() => page.locator('td:has-text("key.rotate")').count()).toBeGreaterThanOrEqual(1);
    await page.click('[data-testid=audit-verify]');
    await page.waitForSelector('[data-testid=chain-result][data-ok=true]');
    expect(await page.locator('[data-testid=chain-result]').textContent()).toMatch(/CHAIN INTACT.*entries re-hashed/);
    await shot(page, 'audit');
  }, STEP_TIMEOUT);

  it('prints a production batch of 120 codes in two clicks: the layout before, the manifest after', async () => {
    const batch = 'B-2026-10-120';
    const pieces: IssueResult[] = [];
    for (let i = 0; i < 120; i++) {
      pieces.push(
        await ctx.services.issuance.issueProduct(
          { categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, variant: `Size ${44 + (i % 16)}`, productionBatch: batch, productionDate: '2026-10-01' },
          SYSTEM_ACTOR,
        ),
      );
    }
    const pick = page.locator('[data-testid=sheet-select-batch]');
    const count = page.locator('[data-testid=sheet-count]');
    const preview = page.locator('[data-testid=sheet-preview]');

    // From the batch's products to its codes.
    await go(page, `#/products?productionBatch=${batch}`, 'Products');
    await expect.poll(() => page.locator('.pager__range').textContent()).toMatch(/of 120$/);
    await page.click('a.cbtn:has-text("Print this batch")');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Codes');
    expect(await page.inputValue('input[name=productionBatch]')).toBe(batch);
    await expect.poll(() => pick.textContent()).toBe('Select the 120 codes of this batch');
    expect(await count.textContent()).toBe('No code selected');
    expect(await preview.textContent()).toBe('30 per A4');

    // Click 1: the whole batch, across the list's three pages; the layout shows before anything renders.
    await pick.click();
    await expect.poll(() => count.textContent()).toBe('120 codes selected');
    expect(await preview.textContent()).toBe('30 per A4 · 4 pages');
    expect(await page.locator('[data-testid=sheet-select]:checked').count()).toBe(50);
    // Counts and the preview read in Helvetica Neue, the button's count too (BRAND §3.1).
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await page.click('.pager button:has-text("Next")');
    await expect.poll(() => page.locator('.pager__page').textContent()).toBe('2 / 3');
    await expect.poll(() => page.locator('[data-testid=sheet-select]:checked').count()).toBe(50);
    expect(await count.textContent()).toBe('120 codes selected');

    // Click 2: one PDF of 120 labelled codes on 4 A4 pages.
    const [sheet] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-sheet]')]);
    expect(sheet.suggestedFilename()).toMatch(/^ORBES-sheet-\d{4}-\d{2}-\d{2}-120-classic-30mm\.pdf$/);
    const pdf = readFileSync((await sheet.path())!).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toMatch(/\/Count 4\b/);

    // The manifest: which label is where, in serial order, page by page.
    const [manifest] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-manifest]')]);
    expect(manifest.suggestedFilename()).toBe(sheet.suggestedFilename().replace(/\.pdf$/, '-manifest.csv'));
    const rows = readFileSync((await manifest.path())!, 'utf8').trimEnd().split('\r\n');
    expect(rows).toHaveLength(121);
    expect(rows[0]).toBe('"page","row","column","productId","sku","variant","material","codeId"');
    expect(rows[1]).toBe(`"1","1","1","${pieces[0].product.productId}","${pieces[0].product.sku}","Size 44","925 STERLING SILVER","${pieces[0].code.id}"`);
    expect(rows[120]).toMatch(new RegExp(`^"4","6","5","${pieces[119].product.productId}",`));

    // Other filters, from the filter bar: the batch's selection is dropped.
    await page.fill('input[name=productionBatch]', 'B-2026-09-A');
    await page.fill('input[name=issuedFrom]', '2026-01-01');
    expect(await page.getAttribute('input[name=issuedTo]', 'min')).toBe('2026-01-01');
    await page.click('[data-testid=codes-apply]');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/codes?productionBatch=B-2026-09-A&issuedFrom=2026-01-01');
    await expect.poll(() => count.textContent()).toBe('No code selected');
    await expect.poll(() => pick.textContent()).toMatch(/^Select the \d+ codes of this batch$/);
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('prints a selection over 200 codes as PDFs of 200, named by part', async () => {
    const batch = 'B-2026-10-201';
    for (let i = 0; i < 201; i++) {
      await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, productionBatch: batch }, SYSTEM_ACTOR);
    }
    const count = page.locator('[data-testid=sheet-count]');
    await go(page, `#/codes?productionBatch=${batch}`, 'Codes');
    await page.click('[data-testid=sheet-select-batch]');
    await expect.poll(() => count.textContent()).toBe('201 codes selected');
    // 200 codes on 7 pages of 30, then 1 on a last page.
    expect(await page.locator('[data-testid=sheet-preview]').textContent()).toBe('30 per A4 · 8 pages · 2 PDFs of up to 200 codes');
    const files: string[] = [];
    const saved = new Promise<void>((resolve) => {
      page.on('download', async (d) => {
        files.push(d.suggestedFilename());
        if (files.length === 2) resolve();
      });
    });
    await page.click('[data-testid=download-sheet]');
    await saved;
    expect(files).toEqual([
      expect.stringMatching(/^ORBES-sheet-\d{4}-\d{2}-\d{2}-200-classic-30mm-part-1-of-2\.pdf$/),
      expect.stringMatching(/^ORBES-sheet-\d{4}-\d{2}-\d{2}-1-classic-30mm-part-2-of-2\.pdf$/),
    ]);
    page.removeAllListeners('download');
    await expect.poll(() => page.locator('[data-testid=download-sheet]').textContent()).toBe('Download print sheet');

    // A selection the next test expects the sign-out to forget.
    await go(page, '#/codes', 'Codes');
    await page.locator('[data-testid=sheet-select]').first().check();
    await expect.poll(() => count.textContent()).toBe('1 code selected');
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('issues 120 products from a CSV in one gesture: the preview, requests of 50, the results piece by piece, the batch in Products', async () => {
    const batch = 'B-2026-10-CSV';
    // A spreadsheet's export: byte-order mark, semicolons, CRLF; a size per piece, the SKU of the first ten given.
    const lines = ['variant;sku', ...Array.from({ length: 120 }, (_, i) => `Size ${44 + (i % 16)};${i < 10 ? `MNL-RG-${44 + i}-P` : ''}`)];
    const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
    const results = page.locator('[data-testid=batch-results] tbody tr');
    const unloadPrevented = () =>
      page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });

    // The two modes, as links in the page head.
    await go(page, '#/generator', 'Issue a product');
    expect(await page.locator('.gen__mode[aria-current=page]').textContent()).toBe('Single piece');
    await page.click('[data-testid=mode-batch]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Issue a batch');
    expect(await page.evaluate(() => location.hash)).toBe('#/generator?mode=batch');
    expect(await page.locator('.gen__mode[aria-current=page]').textContent()).toBe('Batch');
    expect(await page.locator('.gen__mode').first().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans"?,/);

    // The template: what every piece shares.
    await page.selectOption('select[name=categoryCode]', 'J');
    await page.selectOption('select[name=modelId]', modelId);
    expect(await page.inputValue('input[name=material]')).toBe('925 STERLING SILVER');
    await page.fill('input[name=productionBatch]', batch);
    await page.fill('input[name=year]', '2026');
    expect(await page.isChecked('input[name=withClaimSecret]')).toBe(true);

    // A file with a wrong line is refused, line by line, before anything is signed.
    await page.setInputFiles('[data-testid=batch-file]', { name: 'wrong.csv', mimeType: 'text/csv', buffer: Buffer.from('variant;sku\nSize 52;-bad\nSize 54;MNL\n') });
    await expect.poll(() => page.locator('[data-testid=batch-problems] li').allTextContents()).toEqual(['Line 2 · SKU: Letters, digits, space, . _ - / only (64 max).']);
    await page.click('[data-testid=batch-submit]');
    await expect.poll(() => page.locator('[data-testid=batch-form] .form-error').textContent()).toBe('Fix the pieces listed above.');

    // The production file: its first rows and the plan, before anything is signed.
    await page.setInputFiles('[data-testid=batch-file]', { name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect.poll(() => page.locator('[data-testid=batch-plan]').textContent()).toBe('120 pieces · 3 requests of up to 50');
    expect(await page.locator('[data-testid=batch-problems] li').count()).toBe(0);
    expect(await page.locator('[data-testid=batch-count]').textContent()).toBe('120');
    const preview = page.locator('[data-testid=batch-preview] tbody tr');
    expect(await preview.count()).toBe(10);
    expect(await preview.first().textContent()).toBe('2Size 44MNL-RG-44-PNext');
    expect(await page.locator('[data-testid=batch-submit]').textContent()).toBe('Sign 120 products');
    // The count in the button and the plan read in Helvetica Neue (BRAND §3.1).
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'generator-batch', { full: true });

    // One gesture: the browser sends three requests, of 50, 50 and 20 pieces, one after the other.
    const sent: number[] = [];
    const onRequest = (r: { url(): string; postData(): string | null }) => {
      if (r.url().endsWith('/api/admin/products/batch')) sent.push((JSON.parse(r.postData() ?? '{}') as { items: unknown[] }).items.length);
    };
    page.on('request', onRequest);
    await page.click('[data-testid=batch-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim(), { timeout: 120_000 }).toBe('Batch signed');
    page.off('request', onRequest);
    expect(sent).toEqual([50, 50, 20]);
    expect(await page.locator('.page-head__lead').textContent()).toBe(`120 of 120 pieces signed. Production batch ${batch}.`);
    expect(await results.count()).toBe(120);
    expect(new Set(await page.locator('[data-testid=batch-results] .status__text').allTextContents())).toEqual(new Set(['ISSUED']));
    const first = await results.first().locator('td').allTextContents();
    expect([first[0], first[3], first[4]]).toEqual(['2', 'Size 44', 'MNL-RG-44-P']);
    expect(first[2]).toMatch(/^O26-J-\d{5}$/);
    expect(first[6]).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // A piece without a SKU gets the model's prefix and its variant.
    expect(await results.nth(10).locator('td').nth(4).textContent()).toBe('MNL-RG-SIZE-54');
    expect(new Set(await results.locator('td:nth-child(7)').allTextContents()).size).toBe(120);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'generator-batch-result');

    // Until the claim codes are saved, leaving asks first: closing the tab, and the console's own links.
    expect(await unloadPrevented()).toBe(true);
    await page.click('.side__link[data-route=products]');
    await page.waitForSelector('dialog.dialog');
    expect(await page.locator('dialog.dialog .dialog__title').textContent()).toBe('Leave this page?');
    expect(await page.locator('dialog.dialog .dialog__text').textContent()).toMatch(/^The 120 claim codes of this batch are on this page and nowhere else\./);
    await page.click('[data-testid=dialog-cancel]');
    await page.waitForSelector('dialog.dialog', { state: 'detached' });
    expect(await page.evaluate(() => location.hash)).toBe('#/generator?mode=batch');
    expect(await results.count()).toBe(120);

    // The results file, with the claim codes: saved, the page is no longer held.
    const [resultsFile] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=batch-download-results]')]);
    expect(resultsFile.suggestedFilename()).toMatch(new RegExp(`^ORBES-batch-${batch}-\\d{4}-\\d{2}-\\d{2}-120-results\\.csv$`));
    const rows = readFileSync((await resultsFile.path())!, 'utf8').trimEnd().split('\r\n');
    expect(rows).toHaveLength(121);
    expect(rows[0]).toBe('"line","piece","status","productId","sku","variant","serial","codeId","claimCode","message"');
    expect(rows[1]).toBe(`"2","1","ISSUED","${first[2]}","MNL-RG-44-P","Size 44","${first[5]}","${await ctx.db.selectFrom('codes as c').innerJoin('products as p', 'p.id', 'c.product_id').select('c.id').where('p.product_id', '=', first[2]).executeTakeFirstOrThrow().then((r) => r.id)}","${first[6]}",""`);
    await expect.poll(() => page.locator('[data-testid=batch-saved]').textContent()).toBe('Results saved, with the claim codes.');
    expect(await unloadPrevented()).toBe(false);

    // The certificate cards (D-01), A4 sheets in requests of 50: each claim code is checked against its hash by the server.
    await page.selectOption('select[name=certificateLayout]', 'sheet');
    const cards: string[] = [];
    const three = new Promise<void>((resolve) => {
      page.on('download', (d) => {
        cards.push(d.suggestedFilename());
        if (cards.length === 3) resolve();
      });
    });
    await page.click('[data-testid=batch-certificates]');
    await three;
    page.removeAllListeners('download');
    expect(cards).toEqual([
      expect.stringMatching(/^ORBES-certificates-\d{4}-\d{2}-\d{2}-50-sheet-PROOF-part-1-of-3\.pdf$/),
      expect.stringMatching(/^ORBES-certificates-\d{4}-\d{2}-\d{2}-50-sheet-PROOF-part-2-of-3\.pdf$/),
      expect.stringMatching(/^ORBES-certificates-\d{4}-\d{2}-\d{2}-20-sheet-PROOF-part-3-of-3\.pdf$/),
    ]);
    await expect.poll(() => page.locator('[data-testid=batch-saved]').textContent()).toBe('Certificate cards saved, in 3 files.');

    // All 120 in Products, under the same production batch.
    await page.click('a.cbtn:has-text("Open in Products")');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Products');
    expect(await page.evaluate(() => location.hash)).toBe(`#/products?productionBatch=${batch}`);
    await expect.poll(() => page.locator('.pager__range').textContent()).toMatch(/of 120$/);
    const stored = await ctx.db.selectFrom('products').select(['variant', 'sku', 'serial', 'claim_secret_hash']).where('production_batch', '=', batch).orderBy('serial').execute();
    expect(stored).toHaveLength(120);
    expect(stored[0]).toMatchObject({ variant: 'Size 44', sku: 'MNL-RG-44-P' });
    expect(stored.every((s) => s.claim_secret_hash !== null)).toBe(true);
    expect(new Set(stored.map((s) => s.serial)).size).toBe(120);
    expect(await cspViolations(page)).toEqual([]);
  }, 240_000);

  it('signs a quantity of identical pieces; hiding the claim codes releases the page', async () => {
    await go(page, '#/generator?mode=batch', 'Issue a batch');
    await page.selectOption('select[name=categoryCode]', 'J');
    await page.selectOption('select[name=modelId]', modelId);
    await page.fill('input[name=productionBatch]', 'B-2026-10-QTY');
    await page.selectOption('select[name=source]', 'quantity');
    expect(await page.isVisible('[data-testid=batch-file]')).toBe(false);
    await page.fill('input[name=quantity]', '2');
    await page.fill('input[name=variant]', '50 ML');
    await expect.poll(() => page.locator('[data-testid=batch-plan]').textContent()).toBe('2 pieces · one request');
    expect(await page.locator('[data-testid=batch-preview] th').first().textContent()).toBe('Piece');
    await page.click('[data-testid=batch-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Batch signed');
    const rows = page.locator('[data-testid=batch-results] tbody tr');
    expect(await rows.count()).toBe(2);
    expect(await rows.locator('td:nth-child(4)').allTextContents()).toEqual(['50 ML', '50 ML']);
    await page.getByRole('button', { name: /I have recorded them/ }).click();
    expect(await rows.locator('td:nth-child(7)').allTextContents()).toEqual(['•••• - •••• - ••••', '•••• - •••• - ••••']);
    expect(await page.locator('[data-testid=batch-certificates]').count()).toBe(0);
    expect(
      await page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      }),
    ).toBe(false);
    // Nothing held any more: another batch starts without a question.
    await page.click('[data-testid=batch-again]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Issue a batch');
    expect(await page.locator('dialog.dialog').count()).toBe(0);
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('signs out', async () => {
    await page.click('[data-testid=sign-out]');
    await page.waitForSelector('[data-testid=login-form]');
    const me = await page.evaluate(async () => (await fetch('/api/admin/auth/me')).status);
    expect(me).toBe(401);
    // The re-issued code previewed earlier in this tab is forgotten with the session.
    await page.fill('input[name=email]', ADMIN.email);
    await page.fill('input[name=password]', ADMIN.password);
    await page.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Dashboard');
    await go(page, `#/products/${issuedProductId}`, issuedProductId);
    expect(await page.locator('#fresh-code').count()).toBe(0);
    // So is a print-sheet selection.
    await go(page, '#/codes', 'Codes');
    expect(await page.locator('[data-testid=sheet-count]').textContent()).toBe('No code selected');
    await page.click('[data-testid=sign-out]');
    await page.waitForSelector('[data-testid=login-form]');
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('enrols TOTP and then requires the code at sign-in', async () => {
    const operator = { email: 'workshop@orbes.test', password: 'workshop passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...operator, role: 'OPERATOR' }, SYSTEM_ACTOR);
    const p = await context.newPage();
    await watch(p);
    await signIn(p, operator.email, operator.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    // OPERATOR: no key management in the console.
    expect(await p.locator('.side__link', { hasText: 'Generator' }).count()).toBe(1);

    await go(p, '#/security', 'Security');
    await p.click('[data-testid=totp-begin]');
    const secret = ((await p.locator('[data-testid=totp-secret]').textContent()) ?? '').replace(/\s/g, '');
    await shot(p, 'security');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await p.fill('input[name=code]', totp(base32Decode(secret), Date.now()));
    await p.click('[data-testid=totp-confirm]');
    await expect.poll(async () => p.locator('.side__role').textContent()).toContain('2FA');

    await p.click('[data-testid=sign-out]');
    await p.fill('input[name=email]', operator.email);
    await p.fill('input[name=password]', operator.password);
    await p.click('[data-testid=login-submit]');
    await p.waitForSelector('input[name=totp]:visible');
    await shot(p, 'login-totp');
    // The enrolment consumed the current step; the next one is within the accepted window.
    await p.fill('input[name=totp]', totp(base32Decode(secret), Date.now() + 30_000));
    await p.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    expect(await cspViolations(p)).toEqual([]);
    await p.close();

    // The device is lost: an ADMIN resets the operator's second factor from the security page.
    const operatorId = (await ctx.services.auth.listAdmins()).find((a) => a.email === operator.email)!.id;
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await adminContext.newPage();
    await watch(a);
    await signIn(a, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Dashboard');
    await go(a, '#/security', 'Security');
    const userRow = a.locator('[data-testid=admin-users] tr', { hasText: operator.email });
    await userRow.locator('[data-testid=reset-totp]').click();
    await confirmDialog(a, `RESET 2FA ${operator.email}`);
    await expect.poll(async () => (await ctx.services.auth.getAdmin(operatorId)).totpEnabled).toBe(false);
    await expect.poll(() => userRow.textContent()).toContain('NOT ENROLLED');
    expect(await cspViolations(a)).toEqual([]);
    await a.click('[data-testid=sign-out]');
    await adminContext.close();
  }, STEP_TIMEOUT);

  it('gives an AUDITOR a read-only console', async () => {
    const auditor = { email: 'audit@orbes.test', password: 'auditor passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...auditor, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, auditor.email, auditor.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    expect(await p.locator('.side__link', { hasText: 'Generator' }).count()).toBe(0);
    await go(p, `#/products/${issuedProductId}`, issuedProductId);
    expect(await p.locator('#actions').count()).toBe(0);
    expect(await p.locator('#artifacts').count()).toBe(0);
    expect(await p.locator('[data-testid=product-sheet] [data-row=signature]').textContent()).toContain('VALID');
    // Anomalies: the badge and every finding's detail, no decision.
    await go(p, '#/anomalies', 'Anomalies');
    await expect.poll(() => p.locator('[data-testid=anomaly-badge] .side__badge-count').textContent()).toBe(String((await ctx.services.anomaly.summary()).attention));
    expect(await p.locator('[data-testid=anomaly-details]').count()).toBeGreaterThan(0);
    expect(await p.locator('[data-testid=triage]').count()).toBe(0);
    await p.locator('[data-testid=anomaly-details]').first().click();
    await p.waitForSelector('#finding');
    expect(await p.locator('[data-testid=detail-triage]').count()).toBe(0);
    await go(p, '#/keys', 'Signing keys');
    expect(await p.locator('[data-testid=key-rotate]').count()).toBe(0);
    await go(p, '#/audit', 'Audit log');
    await p.click('[data-testid=audit-verify]');
    await p.waitForSelector('[data-testid=chain-result][data-ok=true]');
    expect(await cspViolations(p)).toEqual([]);
    await c.close();
  }, STEP_TIMEOUT);

  it('raised no page error or CSP violation', () => {
    expect(problems).toEqual([]);
  });
});
