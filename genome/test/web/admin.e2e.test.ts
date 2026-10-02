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
 * verification → sign out. Also: TOTP enrolment + two-step sign-in, the
 * Team page (A-02: a staff account, its temporary password and forced first
 * change, the own password change, a role change, a departure), the
 * read-only AUDITOR console, and the sale mode on a 390 px phone (A-08: the
 * points of sale, a RETAIL account and its first sign-in in the sale shell,
 * a sale through the phone's camera in under 20 s, nothing else reachable).
 * No CSP violation or page error is tolerated.
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
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { svgToGray } from '../support/raster.js';
import { writePng } from '../support/image-io.js';
import { writeY4m } from '../support/y4m.js';
import { cameraClipFrames, codeSource, launchCamera, mobileContext, phonePhoto, printedCodeOf } from '../e2e/support.js';

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
    await seedRegistry(ctx, modelId);
    // The register of points of sale (A-08): the warranty dialog picks from it.
    await ctx.services.retailers.create({ name: 'ORBES Paris — Saint-Honoré', city: 'Paris', country: 'FR' }, SYSTEM_ACTOR);

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
    // The point of sale is chosen from the register (A-08), never typed.
    expect(await page.locator('dialog input[name=retailer]').count()).toBe(0);
    expect(await page.locator('dialog select[name=retailerId] option').allTextContents()).toEqual(['None recorded', 'ORBES Paris — Saint-Honoré · Paris · FR']);
    await page.selectOption('dialog select[name=retailerId]', { label: 'ORBES Paris — Saint-Honoré · Paris · FR' });
    await confirmDialog(page);
    await expect.poll(() => row('warranty').textContent()).toContain('ACTIVE');
    await expect.poll(() => row('status').textContent()).toContain('ACTIVATED');
    // Shown by its name, the country taken from it.
    expect(await ctx.services.warranty.get(issuedProductId)).toMatchObject({ retailer: 'ORBES Paris — Saint-Honoré', country: 'FR' });
    await expect.poll(() => page.locator('#warranty').textContent()).toContain('ORBES Paris — Saint-Honoré · FR');
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
    // S-07: the piece issued above, scanned outside the console while still in stock, under its console name.
    const unsold = page.locator('table.table tbody tr', { hasText: 'UNSOLD PIECE SCANNED' });
    expect(await unsold.count()).toBe(1);
    expect(await unsold.textContent()).toContain(issuedProductId);
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

    // The device is lost: an ADMIN resets the operator's second factor from the Team page.
    const operatorId = (await ctx.services.auth.listAdmins()).find((a) => a.email === operator.email)!.id;
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await adminContext.newPage();
    await watch(a);
    await signIn(a, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Dashboard');
    await go(a, '#/team', 'Team');
    const userRow = a.locator('[data-testid=admin-users] tr', { hasText: operator.email });
    await userRow.locator('[data-testid=reset-totp]').click();
    await confirmDialog(a, `RESET 2FA ${operator.email}`);
    await expect.poll(async () => (await ctx.services.auth.getAdmin(operatorId)).totpEnabled).toBe(false);
    await expect.poll(() => userRow.textContent()).toContain('NOT ENROLLED');
    expect(await cspViolations(a)).toEqual([]);
    await a.click('[data-testid=sign-out]');
    await adminContext.close();
  }, STEP_TIMEOUT);

  it('manages the team: a staff account, its temporary password, its first sign-in, a role change and its departure', async () => {
    const staffEmail = 'atelier@orbes.test';
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await adminContext.newPage();
    await watch(a);
    await signIn(a, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Dashboard');
    // The ADMIN's sidebar, its longest: SIGN OUT and CHANGE PASSWORD show on a 900 px screen without scrolling it.
    for (const id of ['sign-out', 'change-password']) {
      const box = (await a.locator(`[data-testid=${id}]`).boundingBox())!;
      expect(box.y + box.height, id).toBeLessThanOrEqual(900);
      expect(box.x + box.width, id).toBeLessThanOrEqual(248 - 32);
    }
    await a.locator('.side__link', { hasText: 'Team' }).click();
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Team');
    expect(await a.locator('.side__link.is-active').textContent()).toBe('Team');
    // One's own row offers nothing but its own second factor.
    const selfRow = a.locator('[data-testid=admin-users] tr', { hasText: ADMIN.email });
    expect(await selfRow.locator('[data-testid=team-disable], [data-testid=team-role]').count()).toBe(0);

    await a.click('[data-testid=team-create]');
    await a.fill('dialog input[name=email]', staffEmail);
    await a.selectOption('dialog select[name=role]', 'OPERATOR');
    await confirmDialog(a);
    const temporary = ((await a.locator('[data-testid=temporary-password]').textContent()) ?? '').trim();
    expect(temporary).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    const staffRow = a.locator('[data-testid=admin-users] tr', { hasText: staffEmail });
    await expect.poll(() => staffRow.textContent()).toContain('TEMPORARY PASSWORD');
    expect(await figuresInDisplayFace(a)).toEqual([]);
    await shot(a, 'team');
    await a.click('[data-testid=temporary-password-hide]');
    expect(await a.locator('[data-testid=temporary-password]').count()).toBe(0);

    // The staff member's first sign-in: only the new password, whatever the address.
    const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const s = await staffContext.newPage();
    await watch(s);
    await signIn(s, staffEmail, temporary);
    await expect.poll(async () => (await title(s).textContent())?.trim()).toBe('New password');
    // The screen is the change itself: no CHANGE PASSWORD beside it, whose dialog would leave this form asking for a temporary password that no longer works.
    expect(await s.locator('[data-testid=change-password]').count()).toBe(0);
    expect(await s.isVisible('[data-testid=sign-out]')).toBe(true);
    expect(await s.locator('[data-testid=password-form]').textContent()).toContain('capitals and dashes included');
    await shot(s, 'password');
    await go(s, '#/products', 'New password');
    await s.fill('input[name=currentPassword]', 'not the temporary password');
    await s.fill('input[name=newPassword]', 'atelier passphrase 2026');
    await s.fill('input[name=confirmPassword]', 'atelier passphrase 2026');
    await s.click('[data-testid=password-save]');
    await expect.poll(() => s.locator('[data-testid=password-form] .form-error').textContent()).toMatch(/current password is not correct/i);
    expect(await s.isVisible('[data-testid=login-form]')).toBe(false); // a refusal, not a sign-out
    await s.fill('input[name=currentPassword]', temporary);
    await s.click('[data-testid=password-save]');
    await expect.poll(async () => (await title(s).textContent())?.trim()).toBe('Dashboard');
    expect(await s.locator('.side__role').textContent()).toContain('OPERATOR');
    expect(await s.locator('.side__link', { hasText: 'Team' }).count()).toBe(0);

    // Later, a voluntary change from the foot of the sidebar.
    await s.click('[data-testid=change-password]');
    await shot(s, 'password-dialog');
    await s.fill('dialog input[name=currentPassword]', 'atelier passphrase 2026');
    await s.fill('dialog input[name=newPassword]', 'atelier passphrase 2027');
    await s.fill('dialog input[name=confirmPassword]', 'atelier passphrase 2028');
    await s.click('[data-testid=dialog-confirm]');
    await expect.poll(() => s.locator('.dialog__error').textContent()).toMatch(/differ/);
    await s.fill('dialog input[name=confirmPassword]', 'atelier passphrase 2027');
    await confirmDialog(s);
    await s.waitForSelector('.toast:has-text("Password changed.")');

    // The ADMIN changes the role, then the staff member leaves: their open console is signed out.
    await a.reload();
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Team');
    await expect.poll(() => staffRow.textContent()).toContain('ACTIVE');
    await staffRow.locator('[data-testid=team-role]').click();
    await a.selectOption('dialog select[name=role]', 'AUDITOR');
    await confirmDialog(a);
    await expect.poll(() => staffRow.textContent()).toContain('AUDITOR');
    await staffRow.locator('[data-testid=team-sessions]').click();
    await expect.poll(() => a.locator('dialog.dialog tbody tr').count()).toBe(1);
    expect(await a.locator('dialog.dialog tbody tr').textContent()).toMatch(/Chrome · macOS|Chrome · Linux/);
    await shot(a, 'team-sessions');
    await a.click('[data-testid=dialog-cancel]');
    await staffRow.locator('[data-testid=team-disable]').click();
    expect(await a.locator('dialog.dialog--danger').count()).toBe(1);
    await confirmDialog(a);
    await expect.poll(() => staffRow.textContent()).toContain('DISABLED');
    await s.evaluate(() => (location.hash = '#/products'));
    await s.waitForSelector('[data-testid=login-form]');
    await expect.poll(() => s.locator('.login__error').textContent()).toMatch(/session has ended/i);

    // Who did it: the audit log and the anomaly triage name the console user by email.
    await go(a, '#/audit?action=admin.disable', 'Audit log');
    await expect.poll(() => a.locator('table.table tbody tr').first().textContent()).toContain(ADMIN.email);
    expect(await a.locator('table.table tbody tr').first().textContent()).toContain(staffEmail); // the account acted upon
    await go(a, '#/anomalies?status=OPEN', 'Anomalies');
    expect(await a.locator('[data-testid=anomaly-actor]').count()).toBe(0); // never triaged
    await a.locator('[data-testid=triage]').first().click();
    await a.selectOption('dialog select[name=status]', 'ACKNOWLEDGED');
    await confirmDialog(a);
    await go(a, '#/anomalies?status=ACKNOWLEDGED', 'Anomalies');
    await expect.poll(() => a.locator('[data-testid=anomaly-actor]').first().textContent()).toBe(`by ${ADMIN.email}`);
    expect(await cspViolations(a)).toEqual([]);
    expect(await cspViolations(s)).toEqual([]);
    await staffContext.close();
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
    await go(p, '#/keys', 'Signing keys');
    expect(await p.locator('[data-testid=key-rotate]').count()).toBe(0);
    await go(p, '#/audit', 'Audit log');
    await p.click('[data-testid=audit-verify]');
    await p.waitForSelector('[data-testid=chain-result][data-ok=true]');
    expect(await cspViolations(p)).toEqual([]);
    await c.close();
  }, STEP_TIMEOUT);

  it('sells from a phone (A-08, 390 px): a RETAIL account from the Team page, its own password in the sale shell, a sale in under 20 s, nothing else', async () => {
    const seller = { email: 'boutique@orbes.test', password: 'boutique passphrase 2026' };
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await adminContext.newPage();
    await watch(a);
    await signIn(a, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Dashboard');
    for (const label of ['Points of sale', 'Sale mode']) expect(await a.locator('.side__link', { hasText: label }).count(), label).toBe(1);

    // A point of sale added from the console.
    await go(a, '#/retailers', 'Points of sale');
    await a.click('[data-testid=retailer-create]');
    await a.fill('dialog input[name=name]', 'ORBES London — Mount Street');
    await a.fill('dialog input[name=city]', 'London');
    await a.fill('dialog input[name=country]', 'gb');
    await confirmDialog(a);
    await expect.poll(() => a.locator('table.table tbody tr', { hasText: 'ORBES London — Mount Street' }).count()).toBe(1);
    await shot(a, 'retailers');
    const london = (await ctx.services.retailers.list()).find((r) => r.name === 'ORBES London — Mount Street')!;
    expect(london).toMatchObject({ city: 'London', country: 'GB', active: true });

    // The seller's account: RETAIL, with a temporary password.
    await go(a, '#/team', 'Team');
    await a.click('[data-testid=team-create]');
    await a.fill('dialog input[name=email]', seller.email);
    await a.selectOption('dialog select[name=role]', 'RETAIL');
    await confirmDialog(a);
    const temporary = ((await a.locator('[data-testid=temporary-password]').textContent()) ?? '').trim();
    expect(temporary).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    await expect.poll(() => a.locator('[data-testid=admin-users] tr', { hasText: seller.email }).textContent()).toContain('RETAIL');

    // The piece on the counter, filmed by the phone's camera (Chromium's fake device plays a hand-held clip).
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, variant: '54' }, SYSTEM_ACTOR);
    const clip = join(workDir, 'sale-piece.y4m');
    writeY4m(clip, cameraClipFrames(codeSource(printedCodeOf(piece)), { n: 8, seed: 3 }), 15, { range: 'limited' });
    const phoneBrowser = await launchCamera(clip);
    try {
      const phone = await mobileContext(phoneBrowser, { reducedMotion: 'reduce' });
      const p = await phone.newPage();
      await watch(p);
      await signIn(p, seller.email, temporary);
      // The first sign-in: the new password, framed by the sale shell (no console sidebar).
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('New password');
      expect(await p.locator('[data-testid=sale-shell]').count()).toBe(1);
      expect(await p.locator('.side').count()).toBe(0);
      expect(await p.locator('[data-testid=change-password]').count()).toBe(0);
      expect(await p.isVisible('[data-testid=sign-out]')).toBe(true);
      await p.fill('input[name=currentPassword]', temporary);
      await p.fill('input[name=newPassword]', seller.password);
      await p.fill('input[name=confirmPassword]', seller.password);
      await p.click('[data-testid=password-save]');
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Sale mode');
      expect(await p.locator('.saleshell__role').textContent()).toBe('RETAIL');
      expect(await p.locator('[data-testid=to-console]').count()).toBe(0);
      expect(await p.locator('[data-testid=change-password]').count()).toBe(1);
      await shot(p, 'sale-ready');

      // Nothing of the registry: every other address leads back to the sale mode, and the server refuses it.
      for (const hash of ['#/dashboard', '#/products', '#/owners', '#/scans', `#/products/${piece.product.productId}`, '#/team', '#/retailers']) {
        await p.evaluate((h) => (location.hash = h), hash);
        await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).toBe('#/sale');
      }
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Sale mode');
      const refused = await p.evaluate(async () =>
        Promise.all(['/api/admin/products', '/api/admin/scans', '/api/admin/owners', '/api/admin/dashboard', '/api/admin/codes'].map(async (u) => (await fetch(u)).status)),
      );
      expect(refused).toEqual([403, 403, 403, 403, 403]);

      // A phone screen: nothing wider than it, the controls a thumb's size.
      expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      for (const id of ['sale-scan', 'sale-upload', 'sale-retailer', 'sign-out', 'change-password']) {
        expect((await p.locator(`[data-testid=${id}]`).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
      }

      // The sale (acceptance: under 20 s from the phone): the point of sale, the scan, the piece, one gesture.
      const started = Date.now();
      await p.selectOption('[data-testid=sale-retailer]', london.id);
      await p.click('[data-testid=sale-scan]');
      await p.locator('[data-testid=sale-camera]').waitFor();
      expect((await p.locator('[data-testid=sale-camera]').boundingBox())!.width).toBeLessThanOrEqual(390);
      await p.locator('[data-testid=sale-verdict]').waitFor({ timeout: 30_000 });
      expect(await p.locator('[data-testid=sale-verdict]').textContent()).toBe('READY TO SELL');
      expect(await p.locator('[data-testid=sale-product]').textContent()).toBe(piece.product.productId);
      expect(await p.locator('[data-testid=sale-product]').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Helvetica Neue"?,/);
      await shot(p, 'sale-piece');
      await p.click('[data-testid=sale-activate]');
      await p.locator('[data-testid=sale-done]').waitFor({ timeout: 15_000 });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(20_000);
      expect(await p.locator('[data-testid=sale-client-note]').textContent()).toBe('Register your piece with its card at theorbes.com/verify.');
      expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await shot(p, 'sale-done');

      // In the registry: the warranty at that point of sale, the scan under the seller's name, no anomaly.
      expect(await ctx.services.warranty.get(piece.product.productId)).toMatchObject({ status: 'ACTIVE', retailer: 'ORBES London — Mount Street', retailerId: london.id, country: 'GB' });
      const sellerId = (await ctx.services.auth.findAdminByEmail(seller.email))!.id;
      expect(await ctx.db.selectFrom('scan_events').select(['event_type', 'admin_id', 'result_state']).where('product_id', '=', piece.product.id).execute()).toEqual([
        { event_type: 'ADMIN_TEST', admin_id: sellerId, result_state: 'AUTHENTIC' },
      ]);
      expect(await ctx.db.selectFrom('anomalies').select('id').where('product_id', '=', piece.product.id).execute()).toEqual([]);

      // NEXT SALE scans again: the same piece is now sold.
      await p.click('[data-testid=sale-next]');
      await expect.poll(() => p.locator('[data-testid=sale-verdict]').textContent(), { timeout: 30_000 }).toBe('ALREADY SOLD');
      expect(await p.locator('[data-testid=sale-activate]').count()).toBe(0);

      // Without a usable camera, a photo of the piece does the same (the verification app's photo reader).
      const other = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, variant: '56' }, SYSTEM_ACTOR);
      const photo = join(workDir, 'sale-photo.png');
      writePng(photo, phonePhoto(codeSource(printedCodeOf(other))));
      await p.setInputFiles('[data-testid=sale-photo]', photo);
      await expect.poll(() => p.locator('[data-testid=sale-product]').textContent(), { timeout: 30_000 }).toBe(other.product.productId);
      expect(await p.locator('[data-testid=sale-verdict]').textContent()).toBe('READY TO SELL');
      expect(await ctx.db.selectFrom('scan_events').select('client_metrics').where('product_id', '=', other.product.id).executeTakeFirstOrThrow()).toMatchObject({ client_metrics: { source: 'upload' } });

      // The point of sale stays chosen on this phone.
      await p.reload();
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Sale mode');
      expect(await p.inputValue('[data-testid=sale-retailer]')).toBe(london.id);
      expect(await cspViolations(p)).toEqual([]);
      await phone.close();
    } finally {
      await phoneBrowser.close();
    }

    // The console names the seller on the scan.
    await go(a, `#/scans?productId=${piece.product.productId}`, 'Verification events');
    await expect.poll(() => a.locator('[data-testid=scan-staff]').first().textContent()).toBe(`by ${seller.email}`);
    // An ADMIN opens the sale mode too, in the same phone-first shell, and comes back with CONSOLE.
    await a.locator('.side__link', { hasText: 'Sale mode' }).click();
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Sale mode');
    expect(await a.locator('.side').count()).toBe(0);
    await a.click('[data-testid=to-console]');
    await expect.poll(async () => (await title(a).textContent())?.trim()).toBe('Dashboard');
    expect(await cspViolations(a)).toEqual([]);
    await adminContext.close();
  }, STEP_TIMEOUT);

  it('raised no page error or CSP violation', () => {
    expect(problems).toEqual([]);
  });
});
