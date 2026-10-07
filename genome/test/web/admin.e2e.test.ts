/**
 * Admin console end to end: the production web build served by the real
 * Fastify app (in-memory PGlite, bootstrap admin from the config, memory key
 * provider) and driven in Chromium through playwright-core.
 *
 * Flow: sign in → create a model in the catalogue → edit a model (its care
 * block as the client reads it), a collection and a category → issue a product with the
 * generator (claim code shown once, its certificate card, code preview) → download the SVG and
 * decode it with the core decoder after rasterising it with resvg, then
 * verify the decoded data through the public API → the photograph of the
 * piece, added at issuance (F-04) → product page (spec §22) → warranty
 * activation and code re-issue → a model's reference photograph from the
 * catalogue, both photographs on the product page and on /verify, the
 * piece's removed → a model's sheet in the lookbook from its Lookbook page
 * (P-R02: its place and address, its story and specifications previewed as
 * the client reads them, its gallery added, ordered, described and trimmed,
 * then read by the public API) → key rotation → audit chain
 * verification → a batch of 120 products from a CSV (preview, requests of
 * 50, results piece by piece, the page held until the claim codes are saved,
 * certificate cards) and a quantity → sign out. Also: a customer's report
 * followed from the Cases queue to its scan, anomaly and piece, then closed;
 * a one-time recovery code issued from an owner's row (C-04); a client found
 * by email and by REF, the owner's sheet, its lock, unlock and export (A-06);
 * the Club page (P-R03: its one link in the Clients group, the sidebar still
 * fitting a 900 px screen; a release created with its early access (P-X02),
 * edited, published, drawn by an
 * ADMIN after a typed phrase, an entry confirmed, another lapsed after its
 * time, the next offered; read by an AUDITOR, emails masked, without an
 * action; P-X01: its Circle tab, an invitation and a poll written in their
 * dialogs, a photograph added, published, the answers and the results read,
 * an option refused once voted; the panel The Circle of Analytics; read by an
 * AUDITOR, emails masked, without an action; P-X04: its Tiers tab, a tier's
 * words edited in their dialog and restored to the default, the tier on an
 * owner's sheet, read by an AUDITOR without an action);
 * the Analytics view (90 and 30 days, its cursor, the countries of the
 * counterfeit signals), anomaly triage (the badge and the tab title, the
 * filters, a finding's scans, one dialog that marks the piece, revokes its
 * code and resolves the finding), TOTP enrolment + two-step sign-in, the
 * Team page (A-02: a staff account, its temporary password and forced first
 * change, the own password change, a role change, a departure), the
 * read-only AUDITOR console (emails masked), and the sale mode on a 390 px
 * phone (A-08: the points of sale, a RETAIL account and its first sign-in in
 * the sale shell, a sale through the phone's camera in under 20 s, nothing
 * else reachable). The AUDITOR reads a model's Lookbook page without its
 * edits. No CSP violation or page error is tolerated.
 *
 * Set ORBES_SCREENSHOTS=1 to write 1440×900 screenshots of the dashboard,
 * the generator result and the product page to genome/out/.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { PNG } from 'pngjs';
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
import { CLUB_TIER_DEFAULT_BENEFITS } from '../../src/server/services/club.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { aggregateScanStats, daySpan, lastCompleteDay, utcDay } from '../../src/server/services/scan-stats.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { jpegPhoto } from '../support/images.js';
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

/** A colour photograph of `width` × `height` (a smooth gradient) written as a PNG, for the console's photograph chooser. */
function writePhotoPng(path: string, width: number, height: number): string {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = Math.round((x / width) * 255);
      png.data[i + 1] = Math.round((y / height) * 255);
      png.data[i + 2] = 150;
      png.data[i + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
  return path;
}

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
 * impossible-travel finding, a lost product scanned (and reported by the
 * stranger who scanned it), and a validly signed code for an identity that
 * was never registered (CRITICAL).
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
  const lost = await scan(4, 'device-lost', 'IT'); // a LOST product is scanned
  // ...and the stranger who scanned it says where they saw it: a case in the Cases queue (C-02).
  await ctx.services.reports.submit(
    { scanId: lost.scanId, channel: 'ONLINE', place: 'a marketplace listing', note: 'Offered at a third of the boutique price.' },
    { type: 'system', id: 'public' },
  );

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

  it('edits the catalogue (A-10): a model with its care block as the client reads it, a collection, a category', async () => {
    await go(page, '#/catalogue', 'Catalogue');
    const model = (sku: string) => page.locator('#models tbody tr', { hasText: sku });
    const impact = page.locator('dialog [data-testid=catalogue-impact]');
    await model('MNL-RG').locator('[data-testid=edit-model]').click();
    const preview = page.locator('dialog [data-testid=care-preview]');
    await preview.waitFor();
    // Before anything is saved: the issued pieces the change reaches; the category and SKU prefix are no fields.
    expect(await impact.textContent()).toMatch(/^Touches 9 issued pieces: the result of each on \/verify reads/);
    expect(await page.locator('dialog [name=skuPrefix], dialog [name=categoryCode], dialog [name=type]').count()).toBe(0);
    expect(await preview.locator('.care-preview__text').textContent()).toBe('Wipe with a soft, dry cloth.');
    // The preview follows the field: the instructions, or the general care text of /verify when there are none.
    await page.fill('dialog textarea[name=careInstructions]', '   ');
    await expect.poll(() => preview.getAttribute('data-general')).toBe('true');
    expect(await preview.locator('.care-preview__text').textContent()).toMatch(/^Store this piece on its own, away from humidity/);
    const care = 'Wipe with a soft, dry cloth after wearing. Store it on its own, away from perfume.';
    await page.fill('dialog textarea[name=careInstructions]', care);
    await expect.poll(() => preview.locator('.care-preview__text').textContent()).toBe(care);
    expect(await preview.getAttribute('data-general')).toBe('false');
    // Set as /verify's CARE tab: the tab in the display face, the words in .prose (Helvetica Neue 13 px, line 1.75, --ink-soft).
    expect(await preview.locator('.care-preview__tab').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans"?,/);
    const set = await preview.locator('.care-preview__text').evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontFamily.split(',')[0].replace(/"/g, ''), s.fontSize, s.lineHeight, s.color];
    });
    expect(set).toEqual(['Helvetica Neue', '13px', '22.75px', 'rgb(92, 92, 92)']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Model saved.")');
    expect(await ctx.services.catalog.getModel(modelId)).toMatchObject({ careInstructions: care, name: 'MONOLITHE', active: true, products: 9 });

    // The model created above leaves the range: inactive, and the generator no longer offers it.
    await model('ECL-PD').locator('[data-testid=edit-model]').click();
    await impact.waitFor();
    expect(await impact.textContent()).toMatch(/^Touches no issued piece yet\./);
    await page.click('[data-testid=dialog-confirm]');
    await expect.poll(() => page.locator('dialog .dialog__error').textContent()).toBe('Nothing has changed.');
    await page.selectOption('dialog select[name=status]', 'inactive');
    await confirmDialog(page);
    await expect.poll(() => model('ECL-PD').locator('[data-testid=model-active] .status__text').textContent()).toBe('INACTIVE');
    expect(await model('MNL-RG').locator('[data-testid=model-active] .status__text').textContent()).toBe('ACTIVE');

    // A collection renamed, then named again as it was: each time, the pieces it is shown on are said first.
    const collection = page.locator('#collections tbody tr').first();
    await collection.locator('[data-testid=rename-collection]').click();
    await impact.waitFor();
    expect(await impact.textContent()).toBe('Touches 9 issued pieces: the result of each on /verify reads the new name as soon as it is saved.');
    await page.fill('dialog input[name=name]', 'ORBIT NOIR');
    await confirmDialog(page);
    await expect.poll(() => collection.textContent()).toContain('ORBIT NOIR');
    expect((await ctx.services.catalog.getModel(modelId)).collection?.name).toBe('ORBIT NOIR');
    await collection.locator('[data-testid=rename-collection]').click();
    await page.fill('dialog input[name=name]', 'ORBIT');
    await confirmDialog(page);
    await expect.poll(() => collection.textContent()).not.toContain('NOIR');

    // An ADMIN deactivates a category: the generator stops offering it; activated again, it is offered again.
    const leather = page.locator('#categories tbody tr', { hasText: 'LEATHER GOODS' });
    await leather.locator('[data-testid=toggle-category]').click();
    // Said first, as for a model or a collection: the pieces it touches (none issued here), and that none changes.
    await impact.waitFor();
    expect(await impact.textContent()).toBe('No piece has been issued in this category yet. No new piece can be issued in it, and the generator stops offering it; it can be activated again.');
    await confirmDialog(page);
    await expect.poll(() => leather.locator('.status__text').textContent()).toBe('INACTIVE');
    expect(await leather.locator('[data-testid=toggle-category]').textContent()).toBe('Activate');
    await go(page, '#/generator', 'Issue a product');
    expect(await page.locator('select[name=categoryCode] option').allTextContents()).toEqual(['JEWELRY · J']);
    await page.selectOption('select[name=categoryCode]', 'J');
    expect(await page.locator('select[name=modelId] option').allTextContents()).toEqual(['MONOLITHE · RING · MNL-RG']);
    await go(page, '#/catalogue', 'Catalogue');
    await leather.locator('[data-testid=toggle-category]').click();
    await confirmDialog(page);
    await expect.poll(() => leather.locator('.status__text').textContent()).toBe('ACTIVE');
    const audited = await ctx.db.selectFrom('audit_logs').select('action').where('action', 'in', ['model.update', 'collection.update', 'category.activate', 'category.deactivate']).orderBy('id').execute();
    expect(audited.map((a) => a.action)).toEqual(['model.update', 'model.update', 'collection.update', 'collection.update', 'category.deactivate', 'category.activate']);

    // P-R06: an ADMIN discontinues the model that left the range, after its typed phrase; reinstated the same way, it is
    // offered again; discontinued once more, it stays out of the generator. Its edit then has no status.
    const eclipse = model('ECL-PD');
    await eclipse.locator('[data-testid=discontinue-model]').click();
    await impact.waitFor();
    expect(await impact.textContent()).toMatch(/^No piece has been issued with this model yet\. The result of each on \/verify, its sheet in the lookbook and their ownership certificates say DISCONTINUED · \d{4}\. It stays inactive/);
    expect(await page.locator('dialog.dialog .cfield__phrase').textContent()).toBe('DISCONTINUE ECL-PD');
    expect(await page.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await page.fill('[data-testid=dialog-phrase]', 'DISCONTINUE ECL');
    expect(await page.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await confirmDialog(page, 'DISCONTINUE ECL-PD');
    await page.waitForSelector('.toast:has-text("Model discontinued.")');
    await expect.poll(() => eclipse.locator('[data-testid=model-active] .status__text').textContent()).toBe('DISCONTINUED');
    const eclipseId = (await ctx.db.selectFrom('models').select('id').where('sku_prefix', '=', 'ECL-PD').executeTakeFirstOrThrow()).id;
    expect(await ctx.services.catalog.getModel(eclipseId)).toMatchObject({ active: false, discontinuedAt: expect.any(Date) });
    await eclipse.locator('[data-testid=edit-model]').click();
    await page.locator('dialog [data-testid=model-discontinued-note]').waitFor();
    expect(await page.locator('dialog select[name=status]').count()).toBe(0);
    await page.click('[data-testid=dialog-cancel]');
    await page.waitForSelector('dialog.dialog', { state: 'detached' });
    await eclipse.locator('[data-testid=reinstate-model]').click();
    await impact.waitFor();
    expect(await impact.textContent()).toMatch(/^Discontinued in \d{4}\. Reinstated, it is active again/);
    await confirmDialog(page, 'REINSTATE ECL-PD');
    await expect.poll(() => eclipse.locator('[data-testid=model-active] .status__text').textContent()).toBe('ACTIVE');
    expect(await ctx.services.catalog.getModel(eclipseId)).toMatchObject({ active: true, discontinuedAt: null });
    await eclipse.locator('[data-testid=discontinue-model]').click();
    await confirmDialog(page, 'discontinue  ecl-pd');
    await expect.poll(() => eclipse.locator('[data-testid=model-active] .status__text').textContent()).toBe('DISCONTINUED');
    const lifecycle = await ctx.db.selectFrom('audit_logs').select('action').where('action', 'in', ['model.discontinue', 'model.reinstate']).orderBy('id').execute();
    expect(lifecycle.map((a) => a.action)).toEqual(['model.discontinue', 'model.reinstate', 'model.discontinue']);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await go(page, '#/generator', 'Issue a product');
    await page.selectOption('select[name=categoryCode]', 'J');
    expect(await page.locator('select[name=modelId] option').allTextContents()).toEqual(['MONOLITHE · RING · MNL-RG']);
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('issues a product with the generator and shows the one-time claim code', async () => {
    await go(page, '#/generator', 'Issue a product');
    await page.selectOption('select[name=categoryCode]', 'J');
    await page.selectOption('select[name=modelId]', modelId);
    expect(await page.inputValue('input[name=material]')).toBe('925 STERLING SILVER'); // model default
    // NOCTURNE N1: the piece's field set at issuance is its size.
    expect(await page.locator('.cfield', { has: page.locator('input[name=variant]') }).locator('.cfield__label').textContent()).toMatch(/^Size/);
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

    // No photograph of the piece is offered at issuance (NOCTURNE, decision 9: the model's is the reference for a piece).
    expect(await page.locator('#piece-photo').count()).toBe(0);
    expect(await page.locator('[data-testid=add-piece-photo]').count()).toBe(0);
    expect(await page.getByText('Add a photo of this piece').count()).toBe(0);
    expect((await ctx.db.selectFrom('products').select('photo_sha256').where('product_id', '=', issuedProductId).executeTakeFirstOrThrow()).photo_sha256).toBeNull();
    expect(await cspViolations(page)).toEqual([]);
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

  it('sets a model\'s reference photograph in the catalogue (F-04): shown with the piece\'s own on the product page, and alone on /verify (NOCTURNE, decision 9)', async () => {
    await go(page, '#/catalogue', 'Catalogue');
    const row = page.locator('#models tbody tr', { hasText: 'MNL-RG' });
    expect(await row.locator('.photo-thumb--empty').count()).toBe(1);
    await row.locator('[data-testid=model-photo]').click();
    // Before anything is saved: the results it reaches.
    await expect.poll(() => page.locator('dialog [data-testid=photo-impact]').textContent()).toMatch(/^Shown at once on the 10 issued pieces of this model above the GENOME/);
    await page.click('[data-testid=dialog-confirm]');
    await expect.poll(() => page.locator('dialog .dialog__error').textContent()).toBe('Choose a photograph first.');
    // A large photograph is sent at 2 000 px on its longer side.
    await page.setInputFiles('dialog [data-testid=photo-file]', writePhotoPng(join(workDir, 'model.png'), 2400, 1600));
    await expect.poll(() => page.locator('dialog [data-testid=photo-facts]').textContent()).toMatch(/^To be sent: 2\s000 × 1\s333 PX · \d+ KB$/);
    expect(await page.locator('dialog .dialog__error').textContent()).toBe('');
    await shot(page, 'catalogue-photo-dialog');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Photograph saved.")');
    await expect.poll(() => row.locator('img.photo-thumb').count()).toBe(1);
    const model = await ctx.services.catalog.getModel(modelId);
    const stored = await ctx.db.selectFrom('media_objects').selectAll().where('sha256', '=', model.imageUrl!.split('/').pop()!).executeTakeFirstOrThrow();
    expect([stored.mime, stored.width, stored.height]).toEqual(['image/jpeg', 2000, 1333]);
    expect(stored.bytes.length).toBeLessThanOrEqual(1024 * 1024);

    // A photograph of the piece taken before NOCTURNE (decision 9): kept in the records, for ORBES staff.
    await ctx.services.media.setProductPhoto(issuedProductId, { mime: 'image/jpeg', bytes: jpegPhoto(480, 480) }, SYSTEM_ACTOR);
    // The product page: the piece's own photograph and the model's.
    await go(page, `#/products/${issuedProductId}`, issuedProductId);
    const photos = page.locator('#photographs');
    await expect.poll(() => photos.locator('img.photo-thumb').count()).toBe(2);
    // In view, so that both load (the thumbs load lazily).
    await photos.scrollIntoViewIfNeeded();
    expect(await photos.locator('[data-testid=model-photo] img').getAttribute('src')).toBe(model.imageUrl);
    const pieceUrl = await photos.locator('[data-testid=product-photo] img').getAttribute('src');
    await expect.poll(() => photos.locator('img.photo-thumb').evaluateAll((els) => els.map((el) => (el as HTMLImageElement).naturalWidth > 0))).toEqual([true, true]);
    await photos.scrollIntoViewIfNeeded();
    if (SCREENSHOTS) await page.screenshot({ path: join(OUT_DIR, 'admin-product-photographs.png') });
    // /verify shows the model's alone on the piece's authentic result (its ACTIVE code, re-issued above), never the piece's own.
    const active = await ctx.db.selectFrom('codes as c').innerJoin('products as p', 'p.id', 'c.product_id').select(['c.payload', 'c.signature']).where('p.product_id', '=', issuedProductId).where('c.status', '=', 'ACTIVE').executeTakeFirstOrThrow();
    const verified = (await (
      await fetch(`${origin}/api/v1/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: toBase64Url(frameCodeData(active.payload, active.signature)) }) })
    ).json()) as { state: string; product?: { imageUrl?: string; photoUrl?: string } };
    expect(verified.state).toMatch(/^AUTHENTIC/);
    expect(verified.product).toMatchObject({ imageUrl: model.imageUrl });
    expect(verified.product).not.toHaveProperty('photoUrl');
    expect(pieceUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);

    // Removed from the product page: the box marks the dialog destructive; the piece then shows its model's alone.
    await page.click('[data-testid=product-photo-edit]');
    await page.locator('dialog label.ccheck', { hasText: 'Remove the current photograph' }).click();
    expect(await page.locator('dialog input[name=remove]').isChecked()).toBe(true);
    expect(await page.locator('dialog.dialog--danger').count()).toBe(1);
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Photograph removed.")');
    await expect.poll(() => page.locator('#photographs img.photo-thumb').count()).toBe(1);
    const audited = await ctx.db.selectFrom('audit_logs').select('action').where('action', 'like', '%.photo.%').orderBy('id').execute();
    expect(audited.map((a) => a.action)).toEqual(['product.photo.set', 'product.photo.remove']);
    expect((await ctx.db.selectFrom('audit_logs').select('action').where('action', '=', 'model.image.set').execute()).length).toBe(1);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('sets a model\'s sheet in the lookbook from the Catalogue (P-R02): its place and address, its story and specifications as the client reads them, its gallery', async () => {
    await go(page, '#/catalogue', 'Catalogue');
    const row = page.locator('#models tbody tr', { hasText: 'MNL-RG' });
    expect(await row.locator('[data-testid=model-lookbook-state]').textContent()).toBe('HIDDEN');
    await row.locator('[data-testid=model-lookbook]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim(), { timeout: 15_000 }).toBe('MONOLITHE');
    expect(new URL(page.url()).hash).toBe(`#/catalogue/${modelId}`);
    // Under the Catalogue, which the sidebar marks; no link of its own there.
    await expect.poll(() => page.locator('.side__link.is-active').textContent()).toBe('Catalogue');
    expect(await page.locator('.side__link[href*="/catalogue/"]').count()).toBe(0);
    expect(await page.locator('[data-testid=lookbook-state]').textContent()).toBe('HIDDEN');

    // The story, previewed as the client reads it while it is typed: a hidden model's sheet is not public.
    await page.click('[data-testid=story-edit]');
    await page.fill('dialog textarea[name=story]', 'The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.');
    await expect.poll(() => page.locator('dialog [data-testid=story-preview] .sheet-preview__paragraph').count()).toBe(2);
    expect(await page.locator('dialog [data-testid=story-preview] .sheet-preview__paragraph').nth(1).evaluate((el) => el.querySelectorAll('br').length)).toBe(1);
    await shot(page, 'lookbook-story-dialog');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Story saved.")');
    await expect.poll(() => page.locator('[data-testid=story-shown] .sheet-preview__paragraph').count()).toBe(2);

    // The specifications: a label with a figure is said before anything is sent, as the server would say it.
    await page.click('[data-testid=specs-edit]');
    await page.fill('dialog textarea[name=specs]', 'Size 52: yes');
    await page.click('[data-testid=dialog-confirm]');
    await expect.poll(() => page.locator('dialog .dialog__error').textContent()).toMatch(/^Specifications, line 1: a label has no figure/);
    await page.fill('dialog textarea[name=specs]', 'Metal: 925 sterling silver\nWeight: 12 g');
    await expect.poll(() => page.locator('dialog [data-testid=specs-preview] .sheet-preview__row').count()).toBe(2);
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Specifications saved.")');

    // Publication: Public, at the address proposed from the name; once published, the address is no longer a field.
    await page.click('[data-testid=lookbook-edit]');
    expect(await page.inputValue('dialog input[name=slug]')).toBe('monolithe');
    expect(await page.locator('dialog [data-testid=lookbook-impact]').textContent()).toMatch(/Its address is fixed once it is first shown/);
    await page.selectOption('dialog select[name=lookbook]', 'PUBLIC');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Publication saved.")');
    await expect.poll(() => page.locator('[data-testid=lookbook-state]').textContent()).toBe('PUBLIC');
    expect(await page.locator('[data-testid=lookbook-address]').textContent()).toBe('/verify/lookbook/monolithe');
    await page.click('[data-testid=lookbook-edit]');
    expect(await page.locator('dialog input[name=slug]').count()).toBe(0);
    await page.click('[data-testid=dialog-cancel]');

    // The gallery: two photographs through the photograph dialog, the second moved first, given its text, the other removed.
    for (const [name, w, h] of [['gallery-1.png', 1200, 900], ['gallery-2.png', 900, 1200]] as const) {
      await page.click('[data-testid=gallery-add]');
      expect(await page.locator('dialog [data-testid=photo-impact]').textContent()).toMatch(/^Shown at once on the model’s sheet \(everyone\), after its cover/);
      await page.setInputFiles('dialog [data-testid=photo-file]', writePhotoPng(join(workDir, name), w, h));
      await expect.poll(() => page.locator('dialog [data-testid=photo-facts]').textContent()).toMatch(/^To be sent: /);
      await confirmDialog(page);
      await page.waitForSelector('.toast:has-text("Photograph added.")');
    }
    const items = page.locator('[data-testid=gallery-item]');
    await expect.poll(() => items.count()).toBe(2);
    const second = (await items.nth(1).getAttribute('data-sha256'))!;
    await items.nth(1).locator('[data-testid=gallery-earlier]').click();
    await expect.poll(() => items.first().getAttribute('data-sha256')).toBe(second);
    expect(await items.first().locator('[data-testid=gallery-earlier]').isDisabled()).toBe(true);
    await items.first().locator('[data-testid=gallery-alt]').click();
    await page.fill('dialog input[name=alt]', 'The ring on its side, the stone up');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Alternative text saved.")');
    await expect.poll(() => items.first().locator('[data-testid=gallery-alt-text]').textContent()).toBe('The ring on its side, the stone up');
    await items.nth(1).locator('[data-testid=gallery-remove]').click();
    expect(await page.locator('dialog.dialog--danger').count()).toBe(1);
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Photograph removed.")');
    await expect.poll(() => items.count()).toBe(1);
    await shot(page, 'lookbook', { full: true });

    // What /verify reads now: the sheet as the console set it.
    const sheet = (await (await fetch(`${origin}/api/v1/lookbook/monolithe`)).json()) as { lookbook: string; story: string; specs: unknown; gallery: { url: string; alt: string | null }[] };
    expect(sheet).toMatchObject({
      lookbook: 'PUBLIC',
      story: 'The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.',
      specs: [
        { label: 'Metal', value: '925 sterling silver' },
        { label: 'Weight', value: '12 g' },
      ],
      gallery: [{ url: `/api/v1/media/${second}`, alt: 'The ring on its side, the stone up' }],
    });
    const actions = (await ctx.db.selectFrom('audit_logs').select('action').where('target_id', '=', modelId).where('action', 'like', 'model.%').orderBy('id').execute()).map((a) => a.action);
    expect(actions.filter((a) => a.startsWith('model.gallery.'))).toEqual(['model.gallery.add', 'model.gallery.add', 'model.gallery.update', 'model.gallery.update', 'model.gallery.remove']);
    // Back to the Catalogue: the model's row says where it stands.
    await page.click('a.cbtn:has-text("All models")');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Catalogue');
    await expect.poll(() => row.locator('[data-testid=model-lookbook-state]').textContent()).toBe('PUBLIC');
    expect(await figuresInDisplayFace(page)).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
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
    // Its scans in Verification events list the same signal under the same name among their reasons.
    await go(page, `#/scans?productId=${issuedProductId}`, 'Verification events');
    const reasons = page.locator('table.table tbody tr .cell-details');
    await expect.poll(() => reasons.filter({ hasText: 'ANOMALY: UNSOLD PIECE SCANNED' }).count()).toBeGreaterThanOrEqual(1);
    expect(await reasons.filter({ hasText: /UNSOLD PIECE SCAN(?!NED)/ }).count()).toBe(0);
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

  it('follows a customer\'s report from the Cases queue to its scan, its anomaly and its piece, then closes it with a note', async () => {
    const rows = page.locator('table.table tbody tr');
    await go(page, '#/cases', 'Cases');
    // Cases sits in the Activity group of the menu, after Anomalies (whose link carries the triage badge); Analytics follows it.
    const activity = page.locator('.side__group', { hasText: 'Activity' }).locator('.side__link');
    expect(await activity.evaluateAll((links) => links.map((a) => a.getAttribute('data-route')))).toEqual(['scans', 'anomalies', 'cases', 'analytics']);
    expect(await activity.locator('nth=2').textContent()).toBe('Cases');
    await expect.poll(() => rows.count()).toBe(1);
    expect(await rows.first().locator('[data-testid=case-where]').textContent()).toBe('ONLINE · a marketplace listing');
    expect(await rows.first().textContent()).toContain('Offered at a third of the boutique price.');
    // The stranger's scan (from Italy, seconds after one in Great Britain) took part in the LOST_STOLEN_SCAN and
    // IMPOSSIBLE_TRAVEL findings, both HIGH: the case names the one with the higher risk.
    const finding = (await rows.first().locator('[data-testid=case-anomaly]').textContent()) ?? '';
    expect(['IMPOSSIBLE TRAVEL', 'LOST STOLEN SCAN']).toContain(finding);
    expect(await rows.first().textContent()).toMatch(new RegExp(`SUSPICIOUS ACTIVITY.*${finding}.*HIGH.*O26-J-00005.*OPEN`));
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'cases');

    // Its scan: Verification events narrowed to that one, which leads back to its case.
    await rows.first().locator('[data-testid=case-scan]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Verification events');
    await expect.poll(() => rows.count()).toBe(1);
    expect(await page.locator('[data-testid=narrowed]').textContent()).toMatch(/One verification event/i);
    expect(await page.locator('[data-testid=scan-report]').textContent()).toBe('ONLINE');
    expect(await rows.first().textContent()).toMatch(/a marketplace listing.*Offered at a third of the boutique price\..*OPEN/);
    await page.locator('[data-testid=scan-report]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Cases');
    await expect.poll(() => rows.count()).toBe(1);

    // Its anomaly: the finding the scan took part in, with the case counted.
    await rows.first().locator('[data-testid=case-anomaly]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Anomalies');
    await expect.poll(() => rows.count()).toBe(1);
    expect(await rows.first().textContent()).toContain(finding);
    expect(await page.locator('[data-testid=anomaly-reports]').textContent()).toBe('1 case');
    // The latest answer as the scans list shows it: where, and the customer's note.
    expect(await page.locator('[data-testid=anomaly-report-note]').textContent()).toBe('Offered at a third of the boutique price.');
    // The finding's detail says it too: its cases, and the reported scan marked in the window's timeline, each
    // leading back to the queue.
    await rows.first().locator('[data-testid=anomaly-details]').click();
    await page.waitForSelector('#finding');
    expect(await page.locator('[data-testid=finding-cases]').textContent()).toBe('1 case');
    await expect.poll(() => page.locator('#finding [data-testid=timeline-report]').count()).toBe(1);
    expect(await page.locator('#finding [data-testid=timeline-report]').textContent()).toBe('Customer report: ONLINE · a marketplace listing · OPEN');
    await page.locator('[data-testid=finding-cases]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Cases');
    await expect.poll(() => rows.count()).toBe(1);
    await page.goBack();
    await page.waitForSelector('#finding');
    await page.locator('#finding [data-testid=timeline-report] a').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Cases');
    await expect.poll(() => rows.count()).toBe(1);
    await page.goBack();
    await page.waitForSelector('#finding');
    await page.locator('[data-testid=narrowed]').getByText('Show all').click();
    await expect.poll(() => rows.count()).toBeGreaterThan(1);

    // Its piece.
    await go(page, '#/cases', 'Cases');
    await rows.first().locator('[data-testid=case-piece]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('O26-J-00005');

    // Closing needs a note; then the case reads CLOSED, by whom and why, and leaves the OPEN filter.
    await go(page, '#/cases', 'Cases');
    await page.click('[data-testid=close-case]');
    await page.click('[data-testid=dialog-confirm]');
    await expect.poll(() => page.locator('.dialog__error').textContent()).toBe('Complete the required fields.');
    await page.fill('dialog textarea[name=note]', 'Listing reported to the platform.');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Case closed.")');
    await expect.poll(() => rows.first().textContent()).toMatch(/CLOSED.*console@orbes\.test.*Listing reported to the platform\./);
    expect(await page.locator('[data-testid=close-case]').count()).toBe(0);
    await go(page, '#/cases?status=OPEN', 'Cases');
    await expect.poll(() => page.locator('.empty__text').textContent()).toBe('No case matches these filters.');
  }, STEP_TIMEOUT);

  it('issues a one-time recovery code from an owner\'s row, shown once, which the client then uses', async () => {
    const email = 'lost.password@example.com';
    const owner = await ctx.services.auth.registerAccount({ email, password: 'correct horse battery staple' }, {});
    await go(page, '#/owners', 'Owners');
    const row = page.locator('table.table tbody tr', { hasText: email });
    await expect.poll(() => row.count()).toBe(1);
    // An ADMIN, after an identity check: the dialog says what the code does before it exists.
    await row.locator('[data-testid=issue-recovery-code]').click();
    await expect.poll(() => page.locator('dialog.dialog').textContent()).toMatch(/Only after checking the identity of the client\..*expires after 30 minutes.*paused for 72 hours/);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/admin/owners/${owner.account.id}/recovery-code`) && r.request().method() === 'POST'),
      confirmDialog(page),
    ]);
    expect(response.status()).toBe(201);
    expect(response.headers()['cache-control']).toBe('no-store');
    const code = page.locator('[data-testid=recovery-code]');
    await expect.poll(() => code.textContent()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const recoveryCode = (await code.textContent())!;
    expect(await page.locator('.claim--recovery').textContent()).toContain(`For ${email}, valid once until`);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'owners-recovery-code');
    // Hidden once given: the console keeps no copy, and the row now says a code is open.
    await page.click('[data-testid=hide-recovery-code]');
    await expect.poll(() => page.locator('[data-testid=recovery-code]').count()).toBe(0);
    await expect.poll(() => row.locator('[data-testid=owner-status]').textContent()).toMatch(/ACTIVE.*Recovery code open until/);
    expect(await page.content()).not.toContain(recoveryCode);
    // The client enters it on /verify: the row then says that transfers are paused.
    await ctx.services.recovery.recover({ email, recoveryCode, newPassword: 'a brand new passphrase' });
    await go(page, '#/warranties', 'Warranties');
    await go(page, '#/owners', 'Owners');
    await expect.poll(() => row.locator('[data-testid=owner-status]').textContent()).toMatch(/ACTIVE.*Transfers paused until/);
    expect(await row.locator('[data-testid=owner-status]').textContent()).not.toMatch(/Recovery code open/);
  }, STEP_TIMEOUT);

  it('finds a client by email and by the REF under a result, opens the sheet, locks and unlocks the account, and exports its data', async () => {
    const email = 'sheet.client@example.com';
    const password = 'correct horse battery staple';
    const client = await ctx.services.auth.registerAccount({ email, password, displayName: 'Ada Client', country: 'FR' }, {});
    // A piece registered to the client from a scan made while signed in: its REF is the scan id's first block.
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, variant: '58' }, SYSTEM_ACTOR);
    await ctx.services.warranty.activate(piece.product.productId, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS — RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
    const scan = await ctx.services.verification.verify({ code: piece.code.data }, { accountId: client.account.id, deviceHash: hex('device-sheet'), geo: { country: 'FR' } });
    await ctx.services.ownership.registerFirst(client.account.id, { registrationToken: scan.registration!.token }, { type: 'account', id: client.account.id });
    const ref = scan.scanId.slice(0, 8).toUpperCase();
    const rows = page.locator('table.table tbody tr');
    const search = async (q: string) => {
      await page.fill('[data-testid=owner-search] input[name=q]', q);
      await page.press('[data-testid=owner-search] input[name=q]', 'Enter');
    };

    // By exact email, in any case: one account, which opens its sheet.
    await go(page, '#/owners', 'Owners');
    await search(email.toUpperCase());
    await expect.poll(() => rows.count()).toBe(1);
    expect(await page.locator('[data-testid=narrowed]').textContent()).toContain(`Search: ${email.toUpperCase()}`);
    await rows.first().locator('[data-testid=owner-link]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe(email);
    expect(await page.locator('#account').textContent()).toMatch(/ACTIVE.*Ada Client.*FR/);
    expect(await page.locator('#pieces').textContent()).toContain(piece.product.productId);
    expect(await page.locator('#transfers .empty__text').textContent()).toBe('No transfer in progress.');
    expect(await page.locator('#scans').textContent()).toContain(ref);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'owner-sheet', { full: true });

    // The recovery code from the sheet too (the mechanism of C-04): shown once above the sheet, then hidden; the
    // account then reads that a code is open.
    await page.click('[data-testid=issue-recovery-code]');
    await expect.poll(() => page.locator('dialog.dialog').textContent()).toMatch(/Only after checking the identity of the client\./);
    await confirmDialog(page);
    await expect.poll(() => page.locator('[data-testid=recovery-code]').textContent()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await page.click('[data-testid=hide-recovery-code]');
    await expect.poll(() => page.locator('[data-testid=recovery-code]').count()).toBe(0);
    await expect.poll(() => page.locator('#account [data-testid=owner-status]').textContent()).toMatch(/ACTIVE.*Recovery code open until/);

    // Lock: the dialog says what it does; the sheet then reads LOCKED and offers the unlock; the client cannot sign in.
    await page.click('[data-testid=lock-account]');
    await expect.poll(() => page.locator('dialog.dialog').textContent()).toMatch(/Every session of the account ends now.*cannot sign in or use a recovery code/);
    await confirmDialog(page);
    // The lock revoked the code just issued, and says so.
    await page.waitForSelector('.toast:has-text("Account locked.")');
    expect(await page.locator('.toast', { hasText: 'Account locked.' }).textContent()).toContain('the open recovery code revoked');
    await expect.poll(() => page.locator('#account [data-testid=owner-status]').textContent()).toMatch(/LOCKED/);
    expect(await page.locator('#account [data-testid=owner-status]').textContent()).not.toMatch(/Recovery code open/);
    expect(await page.locator('[data-testid=lock-account]').count()).toBe(0);
    expect(await page.locator('[data-testid=issue-recovery-code]').count()).toBe(0);
    await expect(ctx.services.auth.login({ email, password }, {})).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', httpStatus: 403 });
    await page.click('[data-testid=unlock-account]');
    await confirmDialog(page);
    await page.waitForSelector('.toast:has-text("Account unlocked.")');
    await expect.poll(() => page.locator('#account [data-testid=owner-status]').textContent()).toMatch(/ACTIVE/);
    expect((await ctx.services.auth.login({ email, password }, {})).account.id).toBe(client.account.id);

    // The right-of-access export: a JSON file of what the registry holds about the account.
    const [exported] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-account]')]);
    expect(exported.suggestedFilename()).toMatch(new RegExp(`^orbes-account-${client.account.id.slice(0, 8)}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
    const data = JSON.parse(readFileSync((await exported.path())!, 'utf8'));
    expect(data).toMatchObject({ format: 'orbes.account-export', account: { id: client.account.id, email, status: 'ACTIVE' } });
    expect(data.pieces.map((x: { productId: string }) => x.productId)).toEqual([piece.product.productId]);
    expect(data.activity.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['account.register', 'account.lock', 'account.unlock']));

    // By the REF the client reads from under a result: the scan, its piece, who scanned it and the piece's owner.
    await go(page, '#/owners', 'Owners');
    await search(`REF ${ref}`);
    const reference = page.locator('#reference');
    await expect.poll(() => reference.locator('tbody tr').count()).toBe(1);
    expect(await reference.locator('.panel__note').textContent()).toContain(`REF ${ref}`);
    expect(await reference.locator('tbody tr').first().textContent()).toMatch(new RegExp(`REF ${ref}.*AUTHENTIC FIRST REGISTRATION.*${piece.product.productId}.*${email}.*${email}`));
    await expect.poll(() => page.locator('#accounts tbody tr').count()).toBe(1);
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'owners-reference');
    await reference.locator('[data-testid=ref-scan]').click();
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Verification events');
    await expect.poll(() => rows.count()).toBe(1);

    // A search that is neither an email nor a REF is said on the field.
    await go(page, '#/owners', 'Owners');
    await search('ada');
    await expect.poll(() => page.locator('[data-testid=owner-search] .cfield__hint').textContent()).toBe('Enter an exact email, or a REF of 8 characters (0–9, A–F).');
    expect(await page.locator('[data-testid=owner-search] .cfield__hint').isVisible()).toBe(true);
    expect(await page.locator('.empty__text').textContent()).toBe('Nothing searched.');

    // The product page leads to the owner's sheet.
    await go(page, `#/products/${piece.product.productId}`, piece.product.productId);
    await page.click('[data-testid=current-owner]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe(email);
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
    const confirmButton = page.locator('[data-testid=dialog-confirm]');
    const destructive = () => page.locator('dialog.dialog').evaluate((d) => d.classList.contains('dialog--danger'));
    expect(await phrase.isVisible()).toBe(false);
    await page.selectOption('dialog select[name=status]', 'RESOLVED');
    // Resolving alone is not destructive: no oxblood rule, the primary confirm.
    expect(await destructive()).toBe(false);
    expect(await confirmButton.getAttribute('class')).toContain('cbtn--primary');
    // The boxes are ticked through their labels, as a pointer does (the drawn mark covers the input).
    await page.locator('dialog label.ccheck', { hasText: 'Mark the piece COUNTERFEIT FLAGGED' }).click();
    // Flagging the piece is (BRAND §6, as on the product page): the 3 px oxblood rule and a danger confirm.
    expect(await destructive()).toBe(true);
    expect(await confirmButton.getAttribute('class')).toContain('cbtn--danger');
    expect(await page.locator('dialog.dialog').evaluate((d) => getComputedStyle(d).borderTopWidth)).toBe('3px');
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
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await page.route(revokeUrl, async (r) => {
      await answered;
      await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The server is busy.' } }) });
    });
    const transitions: string[] = [];
    const onTransition = (r: { url(): string; method(): string }) => {
      if (r.method() === 'POST' && r.url().endsWith('/transitions')) transitions.push(r.url());
    };
    page.on('request', onTransition);
    await page.click('[data-testid=dialog-confirm]');
    // While a step is in flight, typing in the note never makes Confirm pressable, and a second submission is ignored.
    await expect.poll(() => confirmButton.getAttribute('aria-busy')).toBe('true');
    await page.focus('dialog textarea[name=note]');
    await page.keyboard.type(' x');
    expect(await confirmButton.isDisabled()).toBe(true);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.locator('dialog form').evaluate((f) => (f as HTMLFormElement).requestSubmit());
    expect(await confirmButton.isDisabled()).toBe(true);
    answer();
    await expect.poll(() => page.locator('.dialog__error').textContent()).toMatch(/^Revoke the code: The server is busy\. The steps done stay done/);
    page.off('request', onTransition);
    expect(transitions).toHaveLength(1);
    const report = page.locator('[data-testid=decision-steps] .steps__item');
    expect(await report.evaluateAll((items) => items.map((i) => `${i.querySelector('.steps__label')?.textContent} ${(i as HTMLElement).dataset.state}`))).toEqual([
      'Mark the piece COUNTERFEIT FLAGGED done',
      'Revoke the code failed',
      'Record the finding RESOLVED pending',
    ]);
    expect((await ctx.services.lifecycle.snapshot(piece.product.id)).status).toBe('COUNTERFEIT_FLAGGED');
    expect((await anomaly.get(travel.id)).status).toBe('OPEN');
    // The mark is part of the decision now: its box stays ticked and locked, so the retry can only resolve.
    const markBox = page.locator('dialog input[name=markCounterfeit]');
    expect([await markBox.isChecked(), await markBox.isDisabled()]).toEqual([true, true]);
    expect(await page.locator('dialog input[name=revokeCode]').isDisabled()).toBe(false);

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

  it('keeps the anomaly filters on screen: a partial product id is said on its field, a refused filter keeps the form', async () => {
    await go(page, '#/anomalies', 'Anomalies');
    await page.fill('input[name=productId]', 'O26-J');
    await page.click('[data-testid=anomalies-apply]');
    await expect.poll(() => page.locator('.cfield[data-field=productId] .cfield__hint').textContent()).toBe('Enter a full product id (O26-J-00184).');
    expect(await page.evaluate(() => location.hash)).toBe('#/anomalies');
    expect(await page.getAttribute('input[name=productId]', 'aria-invalid')).toBe('true');
    expect(await page.locator('table.table').count()).toBe(1);

    // A filter the server refuses (a URL typed by hand): the form, the refusal, and the way back.
    await go(page, '#/anomalies?type=NOT_A_TYPE', 'Anomalies');
    await page.waitForSelector('[data-testid=anomalies-refused]');
    expect(await page.locator('[data-testid=anomalies-refused] .failure__text').textContent()).toMatch(/^type: /);
    expect(await page.inputValue('select[name=type]')).toBe('NOT_A_TYPE');
    expect(await page.locator('form[aria-label="Filter anomalies"]').count()).toBe(1);
    await page.click('[data-testid=anomalies-refused] a.cbtn:has-text("Clear filters")');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/anomalies');
    await page.waitForSelector('table.table');
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

  it('reads the staff documents in the console: the playbook with its contents and tables, the kit with its card', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go(page, '#/documents', 'Documents');
    await expect.poll(() => page.locator('[data-testid=documents] .docs__card').count()).toBe(2);
    await page.click('[data-testid=document-sales-playbook]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Sales and shipping playbook');
    const article = page.locator('.doc__article');
    await expect.poll(() => article.locator('h2.md__h2').count()).toBeGreaterThan(5);
    expect(await article.locator('table.md__table').count()).toBeGreaterThan(2);
    expect(await article.locator('blockquote.md__quote').count()).toBeGreaterThan(0);
    expect(await article.locator('pre.md__pre').count()).toBeGreaterThan(0);
    expect(await article.textContent()).not.toMatch(/\*\*|\]\(|^#/m);
    // The contents column scrolls to a section without leaving the route.
    const before = await page.evaluate(() => location.hash);
    await page.locator('.doc__toc-link').nth(3).click();
    expect(await page.evaluate(() => location.hash)).toBe(before);
    mkdirSync(OUT_DIR, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(OUT_DIR, 'admin-documents-playbook.png') });
    // A link to the other document opens it in the console; the kit shows the certificate card specimen.
    await go(page, '#/documents/packaging-kit', 'Packaging kit');
    const img = page.locator('.doc__article img.md__img').first();
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: join(OUT_DIR, 'admin-documents-kit.png') });
    await go(page, '#/documents', 'Documents');
    await page.screenshot({ path: join(OUT_DIR, 'admin-documents.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  it('reads the scans of 90 days by result and the countries of the counterfeit signals on one page (Analytics)', async () => {
    // A history the daily statistics count: complete days, several countries, staff scans left out.
    const midnight = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const at = (daysAgo: number) => new Date(midnight - daysAgo * 86_400_000 + 12 * 3_600_000);
    const history: [number, string | null, string, number, ('VERIFY' | 'ADMIN_TEST')?][] = [
      [3, 'FR', 'AUTHENTIC', 5],
      [3, 'GB', 'AUTHENTIC_OWNERSHIP_VERIFIED', 2],
      [3, 'CN', 'INVALID_SIGNATURE', 2],
      [3, null, 'UNKNOWN', 1],
      [3, 'FR', 'AUTHENTIC', 4, 'ADMIN_TEST'],
      [20, 'IT', 'SUSPICIOUS_ACTIVITY', 1],
      [20, 'FR', 'AUTHENTIC', 3],
      [60, 'JP', 'MALFORMED_CODE', 1],
      [60, 'US', 'AUTHENTIC', 2],
      [120, 'BR', 'AUTHENTIC', 7],
    ];
    for (const [daysAgo, country, state, n, type] of history) {
      for (let i = 0; i < n; i++) {
        await ctx.db.insertInto('scan_events').values({ occurred_at: at(daysAgo), event_type: type ?? 'VERIFY', country, result_state: state }).execute();
      }
    }
    await aggregateScanStats(ctx.db, new Date());

    await page.click('.side__link[data-route=analytics]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Analytics');
    expect(await page.locator('.side__link.is-active').textContent()).toBe('Analytics');
    // Ninety days by default: four figures, the curve of every day, one curve per state.
    expect(await page.locator('[data-testid=range-90]').getAttribute('aria-current')).toBe('page');
    const kpis = page.locator('.view--analytics .kpi');
    expect(await kpis.locator('.kpi__value').allTextContents()).toEqual(['17', '12', '5', '6']);
    expect(await kpis.nth(2).getAttribute('class')).toContain('kpi--critical');
    const trend = page.locator('[data-testid=analytics-trend]');
    expect((await trend.locator('polyline.trend__line').getAttribute('points'))!.split(' ')).toHaveLength(90);
    expect(await page.locator('.trend__tick').count()).toBe(5);
    const states = page.locator('[data-testid=analytics-states] .srow');
    expect(await states.count()).toBe(9);
    expect(await page.locator('.srow[data-state=INVALID_SIGNATURE] svg.spark').getAttribute('class')).toBe('spark spark--critical');
    expect(await page.locator('.srow[data-state=INVALID_SIGNATURE] .srow__value').textContent()).toBe('2');
    expect(await page.locator('.srow.srow--zero').count()).toBe(3);
    expect(await page.locator('.srow[data-state=INVALID_SIGNATURE] a.srow__label').getAttribute('href')).toMatch(
      /^#\/scans\?state=INVALID_SIGNATURE&from=\d{4}-\d{2}-\d{2}T00%3A00%3A00\.000Z&to=\d{4}-\d{2}-\d{2}T23%3A59%3A59\.999Z$/,
    );
    // The countries: France first (its staff scans not counted); the signals, China first, in oxblood (its signatures did not verify).
    const countries = page.locator('.panel--countries .bar');
    expect(await countries.first().locator('.bar__label').textContent()).toBe('FR · France');
    expect(await countries.first().locator('.bar__value').textContent()).toBe('8');
    expect(await countries.count()).toBe(7);
    const signals = page.locator('.panel--signals');
    expect(await signals.locator('.bar .bar__label').allTextContents()).toEqual(['CN · China', 'IT · Italy', 'JP · Japan', 'Unknown location']);
    expect(await signals.locator('.bar').first().locator('.bar__fill').getAttribute('class')).toContain('bar__fill--critical');
    const breakdown = page.locator('.panel--signal-table table.table tbody tr');
    expect(await breakdown.count()).toBe(4);
    expect(await breakdown.first().locator('td').allTextContents()).toEqual(['CN · China', '2', '0', '0', '0', '2', '2']);
    expect(await breakdown.nth(1).locator('td').allTextContents()).toEqual(['IT · Italy', '0', '0', '0', '1', '1', '1']);
    // The cursor reads a day from the keyboard: three days ago, its ten scans, state by state.
    await trend.focus();
    await page.keyboard.press('End');
    const back = daySpan(utcDay(at(3)), lastCompleteDay(new Date())) - 1;
    for (let i = 0; i < back; i++) await page.keyboard.press('ArrowLeft');
    const tip = page.locator('[data-testid=analytics-tip]');
    await expect.poll(() => tip.isVisible()).toBe(true);
    expect(await tip.locator('.trend__tip-total').textContent()).toBe('10 SCANS');
    expect(await tip.locator('.trend__tip-line').allTextContents()).toEqual(['AUTHENTIC5', 'AUTHENTIC OWNERSHIP VERIFIED2', 'UNKNOWN1', 'INVALID SIGNATURE2']);
    expect(await trend.getAttribute('aria-valuetext')).toContain('10 SCANS');
    // And from the pointer, over the last day.
    const box = (await trend.boundingBox())!;
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await expect.poll(() => tip.locator('.trend__tip-total').textContent()).toBe('0 SCANS');
    expect(await page.locator('table.table caption', { hasText: 'Scans per day' }).count()).toBe(1);
    // Counts and dates read in Helvetica Neue, as everywhere in the console.
    expect(await figuresInDisplayFace(page)).toEqual([]);
    await shot(page, 'analytics', { full: true });

    // On a phone, the readout stays on the screen whatever the day: beside the cursor where the plot has room, over it
    // near the middle, clear of the day's point; the page never scrolls sideways.
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await trend.focus();
      await page.keyboard.press('Home');
      const misplaced: string[] = [];
      for (let day = 0; day < 90; day++) {
        if (day > 0) await page.keyboard.press('ArrowRight');
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const readout = document.querySelector<HTMLElement>('[data-testid=analytics-tip]')!;
          const t = readout.getBoundingClientRect();
          const d = document.querySelector('.trend__dot')!.getBoundingClientRect();
          const cx = d.left + d.width / 2;
          const cy = d.top + d.height / 2;
          return {
            hidden: readout.hidden,
            overflow: de.scrollWidth - de.clientWidth,
            left: Math.round(t.left),
            right: Math.round(t.right),
            viewport: de.clientWidth,
            coversPoint: cx > t.left && cx < t.right && cy > t.top && cy < t.bottom,
          };
        });
        if (m.hidden || m.overflow !== 0 || m.left < 0 || m.right > m.viewport || m.coversPoint) misplaced.push(`day ${day}: ${JSON.stringify(m)}`);
      }
      expect(misplaced).toEqual([]);
      expect(await trend.getAttribute('aria-valuenow')).toBe('89');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    // Thirty days: Japan and the United States fall out of the window.
    await page.click('[data-testid=range-30]');
    await expect.poll(() => kpis.first().locator('.kpi__value').textContent()).toBe('14');
    expect(await page.evaluate(() => location.hash)).toBe('#/analytics?days=30');
    expect((await trend.locator('polyline.trend__line').getAttribute('points'))!.split(' ')).toHaveLength(30);
    expect(await signals.locator('.bar .bar__label').allTextContents()).toEqual(['CN · China', 'IT · Italy', 'Unknown location']);
    // A state's scans open in Verification events over the window's whole days, its last day to 23:59:59.
    await page.click('.srow[data-state=INVALID_SIGNATURE] a.srow__label');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Verification events');
    expect(await page.locator('[data-testid=scans-window]').textContent()).toMatch(/^Window \d{2} [A-Z]{3} \d{4} · 00:00:00 UTC → \d{2} [A-Z]{3} \d{4} · 23:59:59 UTC/);
    expect(await page.locator('table.table tbody tr').count()).toBeGreaterThanOrEqual(2);
    expect(await cspViolations(page)).toEqual([]);
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
    // NOCTURNE N1: the size's column is `size` (the files of before name it `variant`, read as it below).
    const lines = ['size;sku', ...Array.from({ length: 120 }, (_, i) => `Size ${44 + (i % 16)};${i < 10 ? `MNL-RG-${44 + i}-P` : ''}`)];
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

    // Excel's plain CSV is Windows-1252: read as such, its accents whole, and said above the preview.
    const legacy = Buffer.concat([Buffer.from('variant;sku\r\n', 'latin1'), Buffer.from([0xc9]), Buffer.from('crin 7,5 cm;\r\n', 'latin1')]);
    await page.setInputFiles('[data-testid=batch-file]', { name: 'excel.csv', mimeType: 'text/csv', buffer: legacy });
    await page.waitForSelector('[data-testid=batch-encoding]');
    expect(await page.locator('[data-testid=batch-preview] tbody tr td').nth(1).textContent()).toBe('Écrin 7,5 cm');
    expect(await page.locator('[data-testid=batch-problems] li').count()).toBe(0);

    // The production file: its first rows and the plan, before anything is signed.
    await page.setInputFiles('[data-testid=batch-file]', { name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect.poll(() => page.locator('[data-testid=batch-plan]').textContent()).toBe('120 pieces · 3 requests of up to 50');
    expect(await page.locator('[data-testid=batch-problems] li').count()).toBe(0);
    expect(await page.locator('[data-testid=batch-count]').textContent()).toBe('120');
    expect(await page.locator('[data-testid=batch-encoding]').count()).toBe(0); // UTF-8 this time
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
    expect(rows[0]).toBe('"line","piece","status","productId","sku","size","serial","codeId","claimCode","message"');
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

  it("keeps a batch's claim codes on screen when the session ends: the badge's refresh never signs out, and the codes can still be saved", async () => {
    const rows = page.locator('[data-testid=batch-results] tbody tr');
    const unloadPrevented = () =>
      page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
    await go(page, '#/generator?mode=batch', 'Issue a batch');
    await page.selectOption('select[name=categoryCode]', 'J');
    await page.selectOption('select[name=modelId]', modelId);
    await page.fill('input[name=productionBatch]', 'B-2026-10-HELD');
    await page.selectOption('select[name=source]', 'quantity');
    await page.fill('input[name=quantity]', '2');
    await page.click('[data-testid=batch-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Batch signed');
    const codes = await rows.locator('td:nth-child(7)').allTextContents();
    expect(codes.every((c) => /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c))).toBe(true);

    // The badge's refresh runs on a timer: its 401 never signs the admin out, nor replaces the page.
    const summaryUrl = '**/api/admin/anomalies/summary';
    await page.route(summaryUrl, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }) }));
    await Promise.all([page.waitForResponse(summaryUrl), page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))]);
    await page.unroute(summaryUrl);
    expect((await title(page).textContent())?.trim()).toBe('Batch signed');
    expect(await page.locator('[data-testid=login-form]').count()).toBe(0);
    expect(await rows.locator('td:nth-child(7)').allTextContents()).toEqual(codes);
    expect(await unloadPrevented()).toBe(true);

    // The session ends for good (its absolute lifetime): a request the admin makes meets it, and the page stays.
    await ctx.db.deleteFrom('sessions').where('subject_type', '=', 'admin').execute();
    await page.click('[data-testid=batch-certificates]');
    const ended = page.locator('.toast--error .toast__text', { hasText: 'Your session has ended. This page stays open' });
    await ended.waitFor();
    expect(await page.locator('[data-testid=login-form]').count()).toBe(0);
    expect(await rows.locator('td:nth-child(7)').allTextContents()).toEqual(codes);
    expect(await unloadPrevented()).toBe(true);

    // The results file needs no session: the claim codes are saved, the page released.
    const [file] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=batch-download-results]')]);
    const saved = readFileSync((await file.path())!, 'utf8').trimEnd().split('\r\n');
    expect(saved).toHaveLength(3);
    expect(saved.slice(1).map((l) => l.split('","')[8])).toEqual(codes);
    expect(await unloadPrevented()).toBe(false);

    // Leaving it signs in again, saying why; the notice about the page goes with it.
    await page.click('.side__link[data-route=products]');
    await page.waitForSelector('[data-testid=login-form]');
    expect(await page.locator('.login__error').textContent()).toBe('Your session has ended. Sign in again.');
    expect(await ended.count()).toBe(0);
    await page.fill('input[name=email]', ADMIN.email);
    await page.fill('input[name=password]', ADMIN.password);
    await page.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Products');
    expect(await cspViolations(page)).toEqual([]);
  }, STEP_TIMEOUT);

  it('shows the pieces signed before the session ended mid-batch, with their claim codes, and holds the page', async () => {
    const rows = page.locator('[data-testid=batch-results] tbody tr');
    await go(page, '#/generator?mode=batch', 'Issue a batch');
    await page.selectOption('select[name=categoryCode]', 'J');
    await page.selectOption('select[name=modelId]', modelId);
    await page.fill('input[name=productionBatch]', 'B-2026-10-ENDED');
    await page.selectOption('select[name=source]', 'quantity');
    await page.fill('input[name=quantity]', '51');
    await expect.poll(() => page.locator('[data-testid=batch-plan]').textContent()).toBe('51 pieces · 2 requests of up to 50');
    // The session ends between the two requests: the second one answers 401.
    const batchUrl = '**/api/admin/products/batch';
    let sent = 0;
    await page.route(batchUrl, async (r) => {
      if (++sent === 2) await ctx.db.deleteFrom('sessions').where('subject_type', '=', 'admin').execute();
      await r.continue();
    });
    await page.click('[data-testid=batch-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim(), { timeout: 120_000 }).toBe('Batch partly signed');
    await page.unroute(batchUrl);
    expect(sent).toBe(2);
    expect(await page.locator('.page-head__lead').textContent()).toBe('50 of 51 pieces signed · 1 not signed. Production batch B-2026-10-ENDED.');
    expect(await rows.count()).toBe(51);
    const codes = await rows.locator('td:nth-child(7)').allTextContents();
    expect(codes.slice(0, 50).every((c) => /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c))).toBe(true);
    expect(await rows.nth(50).locator('.status__text').textContent()).toBe('NOT SIGNED');
    expect(await rows.nth(50).locator('td').last().textContent()).toBe('Not signed: the session ended before this request. Sign in again, then sign this piece.');
    await page.locator('.toast--error .toast__text', { hasText: 'Your session has ended. This page stays open' }).waitFor();
    expect(await page.locator('[data-testid=login-form]').count()).toBe(0);

    // The 50 claim codes are held: leaving asks first, then signs in again.
    await page.click('.side__link[data-route=dashboard]');
    await page.waitForSelector('dialog.dialog');
    expect(await page.locator('dialog.dialog .dialog__text').textContent()).toMatch(/^The 50 claim codes of this batch are on this page and nowhere else\./);
    await page.click('[data-testid=dialog-confirm]');
    await page.waitForSelector('[data-testid=login-form]');
    expect(await page.locator('.login__error').textContent()).toBe('Your session has ended. Sign in again.');
    await page.fill('input[name=email]', ADMIN.email);
    await page.fill('input[name=password]', ADMIN.password);
    await page.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(page).textContent())?.trim()).toBe('Dashboard');
    expect(await cspViolations(page)).toEqual([]);
  }, 240_000);

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

  it('runs a release from the Club page (P-R03): created, edited, published; drawn by an ADMIN after a typed phrase; a sale confirmed, a place lapsed after its time, the next offered; an AUDITOR reads', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    // Club in the Clients group after Owners, then Segments, Orders and Invoices (plan LIVE RELEASE+, with Atelier in
    // the Registry), Messages first (plan NEXT-NINE, CS-01), Yearly care after Warranties (BP-19 T6); the ADMIN's sidebar,
    // twenty-six links, still fits a 900 px screen.
    const clients = p.locator('.side__group', { hasText: 'Clients' }).locator('.side__link');
    expect(await clients.evaluateAll((links) => links.map((a) => a.getAttribute('data-route')))).toEqual(['messages', 'owners', 'club', 'segments', 'orders', 'invoices', 'warranties', 'care', 'retailers', 'sale']);
    expect(await p.locator('.side__link').count()).toBe(26);
    for (const id of ['sign-out', 'change-password']) {
      const box = (await p.locator(`[data-testid=${id}]`).boundingBox())!;
      expect(box.y + box.height, id).toBeLessThanOrEqual(900);
    }
    await p.locator('.side__link', { hasText: 'Club' }).click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Club');
    expect(await p.locator('.side__link.is-active').textContent()).toBe('Club');
    await expect.poll(() => p.locator('[data-testid=club-tab-drops]').getAttribute('aria-current')).toBe('page');

    // A new release: a draft, its seed committed at once.
    await p.click('[data-testid=drop-new]');
    await p.selectOption('dialog select[name=modelId]', modelId);
    await p.fill('dialog input[name=title]', 'MONOLITHE — release I');
    await p.fill('dialog input[name=quantity]', '3');
    const opens = new Date(Date.now() - 3_600_000);
    const closes = new Date(Date.now() + 3_600_000);
    const local = (d: Date) => d.toISOString().slice(0, 16);
    await p.fill('dialog input[name=opensAt]', local(opens));
    await p.fill('dialog input[name=closesAt]', local(closes));
    // The early access by tier (P-X02, BP-19 T3): THE PROGRAM's 4 and 2 hours by default, set here to 24 and 12.
    expect(await p.inputValue('dialog input[name=earlyAccessHours]')).toBe('4');
    expect(await p.inputValue('dialog input[name=earlyAccessPlatineHours]')).toBe('2');
    await p.fill('dialog input[name=earlyAccessHours]', '24');
    await p.fill('dialog input[name=earlyAccessPlatineHours]', '12');
    await confirmDialog(p);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('MONOLITHE — release I');
    const dropId = decodeURIComponent(new URL(p.url()).hash.split('/').pop()!);
    await expect.poll(() => p.locator('[data-testid=drop-state]').textContent()).toBe('DRAFT');
    await expect.poll(() => p.locator('[data-testid=drop-early-access]').textContent()).toMatch(
      /^PALLADIUM 24 hours · from \d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC; PLATINE 12 hours · from (?:\d{1,2} [A-Z]{3} \d{4} · )?\d{2}:\d{2} UTC$/,
    );
    expect(await p.locator('[data-testid=drop-reserved]').textContent()).toBe('0 of 3');
    const seedHash = (await ctx.db.selectFrom('drops').select('seed_hash').where('id', '=', dropId).executeTakeFirstOrThrow()).seed_hash;
    expect(await p.locator('[data-testid=drop-seed-hash] .mono').getAttribute('title')).toBe(Buffer.from(seedHash).toString('hex'));
    expect(await p.locator('[data-testid=drop-seed]').count()).toBe(0);
    // A draft changes freely: two pieces instead of three.
    await p.click('[data-testid=drop-edit]');
    await p.fill('dialog input[name=quantity]', '2');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#release .deflist__row', { hasText: 'Pieces' }).locator('.deflist__value').textContent()).toBe('2');
    // Published: its page on /verify; only the description changes from then on. Its entries are open already: no early access.
    await p.click('[data-testid=drop-publish]');
    await expect.poll(() => p.locator('dialog').textContent()).toContain('Direct reservations of PLATINE and PALLADIUM owners: none.');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=drop-state]').textContent()).toBe('OPEN');
    await expect.poll(() => p.locator('[data-testid=drop-early-access]').textContent()).toBe('None');
    expect(await p.locator('[data-testid=drop-edit]').count()).toBe(0);
    expect(await p.locator('[data-testid=drop-page]').getAttribute('href')).toBe(`/verify/releases/${dropId}`);
    await p.click('[data-testid=drop-describe]');
    await p.fill('dialog textarea[name=description]', 'Two pieces, cast in Paris.');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#release').textContent()).toContain('Two pieces, cast in Paris.');
    expect(await figuresInDisplayFace(p)).toEqual([]);

    // Three accounts enter on /verify; one holds a piece (TITANE): the draw ranks it first.
    const entrants: string[] = [];
    for (const n of [1, 2, 3]) {
      const a = await ctx.services.auth.registerAccount({ email: `club.entrant${n}@example.com`, password: 'club entrant passphrase 2026' }, {});
      entrants.push(a.account.id);
    }
    const owned = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, withClaimSecret: true }, SYSTEM_ACTOR);
    await ctx.services.warranty.activate(owned.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = await ctx.services.verification.verify({ code: owned.code.data }, {});
    await ctx.services.ownership.registerFirst(entrants[0]!, { registrationToken: scan.registration!.token, claimCode: owned.claimCode! }, { type: 'account', id: entrants[0]! });
    for (const id of entrants) await ctx.services.drops.enter(id, dropId, { type: 'account', id });
    await p.reload();
    await expect.poll(() => p.locator('#entries tbody tr').count()).toBe(3);
    // The entries close; an OPERATOR never draws, an ADMIN does, once, after the phrase.
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - 7_200_000), closes_at: new Date(Date.now() - 1_000) }).where('id', '=', dropId).execute();
    await p.reload();
    await expect.poll(() => p.locator('[data-testid=drop-state]').textContent()).toBe('CLOSED');
    await p.click('[data-testid=drop-draw]');
    await expect.poll(() => p.locator('dialog [data-testid=dialog-confirm]').isDisabled()).toBe(true);
    await confirmDialog(p, `DRAW ${dropId.slice(0, 8).toUpperCase()}`);
    await p.waitForSelector('.toast:has-text("Drawn: 2 places held, 1 on the waiting list.")');
    await expect.poll(() => p.locator('[data-testid=drop-state]').textContent()).toBe('DRAWN');
    await expect.poll(() => p.locator('[data-testid=drop-seed]').count()).toBe(1);
    const rows = p.locator('#entries tbody tr');
    await expect.poll(() => rows.locator('td.col--num').first().textContent()).toBe('1');
    expect(await rows.first().textContent()).toContain('TITANE');
    expect(await rows.first().textContent()).toContain('club.entrant1@example.com');
    expect(await rows.nth(2).locator('[data-testid=entry-status]').textContent()).toContain('WAITLISTED');
    // The first sale concluded; the second place lapses only after its time.
    await rows.first().locator('[data-testid=entry-confirm]').click();
    await p.fill('dialog textarea[name=note]', 'Sold in the Paris boutique.');
    await confirmDialog(p);
    await expect.poll(() => rows.first().locator('[data-testid=entry-status]').textContent()).toContain('CONFIRMED');
    expect(await rows.nth(1).locator('[data-testid=entry-lapse]').count()).toBe(0);
    await ctx.db.updateTable('drop_entries').set({ respond_by: new Date(Date.now() - 1_000) }).where('drop_id', '=', dropId).where('rank', '=', 2).execute();
    await p.reload();
    await rows.nth(1).locator('[data-testid=entry-lapse]').click();
    await confirmDialog(p);
    await expect.poll(() => rows.nth(1).locator('[data-testid=entry-status]').textContent()).toContain('LAPSED');
    await p.click('[data-testid=drop-offer-next]');
    await confirmDialog(p);
    await expect.poll(() => rows.nth(2).locator('[data-testid=entry-status]').textContent()).toContain('SELECTED');
    expect(await p.locator('[data-testid=drop-offer-next]').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'club-drop', { full: true });
    // The Drops tab lists it, its row leading to its page.
    await go(p, '#/club', 'Club');
    await expect.poll(() => p.locator('#drops tbody tr', { hasText: 'MONOLITHE — release I' }).count()).toBe(1);
    expect(await cspViolations(p)).toEqual([]);
    await c.close();

    // An AUDITOR reads the Club and the release, the emails masked, without an action.
    const auditor = { email: 'club.audit@orbes.test', password: 'club auditor passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...auditor, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const ac = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await ac.newPage();
    await watch(ap);
    await signIn(ap, auditor.email, auditor.password);
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('Dashboard');
    await go(ap, '#/club', 'Club');
    expect(await ap.locator('[data-testid=drop-new]').count()).toBe(0);
    await ap.locator('#drops [data-testid=drop-link]', { hasText: 'MONOLITHE — release I' }).click();
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('MONOLITHE — release I');
    await expect.poll(() => ap.locator('#entries tbody tr').count()).toBe(3);
    for (const shown of await ap.locator('[data-testid=entry-account]').allTextContents()) expect(shown).toMatch(/^c\*\*\*@example\.com$/);
    for (const action of ['drop-edit', 'drop-describe', 'drop-publish', 'drop-cancel', 'drop-draw', 'drop-offer-next', 'entry-confirm', 'entry-lapse']) {
      expect(await ap.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    expect(await cspViolations(ap)).toEqual([]);
    await ac.close();
  }, STEP_TIMEOUT);

  it('writes in the circle from the Club page (P-X01): an invitation and a poll in their dialogs, a photograph, published; the answers and the results; the panel of Analytics; an AUDITOR reads', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    await go(p, '#/club', 'Club');
    await p.click('[data-testid=club-tab-circle]');
    await expect.poll(() => p.locator('[data-testid=club-tab-circle]').getAttribute('aria-current')).toBe('page');
    expect(await p.evaluate(() => location.hash)).toBe('#/club?tab=circle');
    expect(await p.locator('.side__link.is-active').textContent()).toBe('Club');
    await expect.poll(() => p.locator('#circle .empty__text').count()).toBe(1);

    // An invitation: the fields of its kind only; refused before anything is sent when a link goes elsewhere.
    await p.click('[data-testid=circle-new-invitation]');
    expect(await p.locator('dialog select[name=minTier] option').allTextContents()).toEqual(['Every owner (TITANE and up)', 'PLATINE and PALLADIUM', 'PALLADIUM only']);
    expect(await p.locator('dialog [name=pollOptions]').count()).toBe(0);
    // An experience of the tier program (plan NEXT-NINE, BP-19 T7) locks the tier to THE PROGRAM's; None gives it back.
    expect(await p.locator('dialog select[name=experience] option').allTextContents()).toEqual(['None', 'Members’ evening', 'Launch preview', 'Partner experience']);
    await p.selectOption('dialog select[name=experience]', 'MEMBERS_EVENING');
    expect(await p.locator('dialog select[name=minTier]').isDisabled()).toBe(true);
    expect(await p.locator('dialog select[name=minTier]').inputValue()).toBe('2');
    expect(await p.locator('dialog .cfield[data-field=minTier] .cfield__hint').textContent()).toBe('Set in Club → Tiers, THE PROGRAM.');
    await p.selectOption('dialog select[name=experience]', '');
    expect(await p.locator('dialog select[name=minTier]').isDisabled()).toBe(false);
    await p.selectOption('dialog select[name=minTier]', '1');
    await p.fill('dialog input[name=title]', 'Dinner at the atelier');
    await p.fill('dialog textarea[name=body]', 'Twelve places.\n\nThe whole team.');
    const event = new Date(Date.now() + 7 * 86_400_000);
    await p.fill('dialog input[name=eventAt]', event.toISOString().slice(0, 16));
    await p.fill('dialog input[name=eventPlace]', 'ORBES atelier, Paris');
    await p.fill('dialog input[name=capacity]', '2');
    await p.fill('dialog input[name=externalUrl]', 'https://example.com/film');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toMatch(/^A link is an https address on theorbes\.com, youtube\.com, vimeo\.com/);
    await p.fill('dialog input[name=externalUrl]', 'https://vimeo.com/1');
    await confirmDialog(p);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dinner at the atelier');
    const postId = decodeURIComponent(new URL(p.url()).hash.split('/').pop()!);
    expect(new URL(p.url()).hash).toBe(`#/club/circle/${postId}`);
    await expect.poll(() => p.locator('.side__link.is-active').textContent()).toBe('Club');
    await expect.poll(() => p.locator('[data-testid=circle-state]').textContent()).toBe('Not published');
    // Its text as a member reads it.
    await expect.poll(() => p.locator('[data-testid=circle-text] .sheet-preview__paragraph').count()).toBe(2);
    expect(await p.locator('#post .deflist__row', { hasText: 'Places' }).locator('.deflist__value').textContent()).toBe('2');
    expect(await p.locator('[data-testid=circle-external]').getAttribute('rel')).toBe('noopener noreferrer');

    // A photograph, through the photograph dialog.
    await p.click('[data-testid=circle-photo-add]');
    await p.setInputFiles('dialog [data-testid=photo-file]', writePhotoPng(join(workDir, 'circle.png'), 1200, 800));
    await expect.poll(() => p.locator('dialog [data-testid=photo-facts]').textContent()).toMatch(/^To be sent: /);
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Photograph added.")');
    await expect.poll(() => p.locator('[data-testid=circle-photo]').count()).toBe(1);

    // Published: its page on /verify; then two owners answer, the second refused once the places are taken.
    await p.click('[data-testid=circle-publish]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=circle-state]').textContent()).toBe('Published');
    expect(await p.locator('[data-testid=circle-page]').getAttribute('href')).toBe(`/verify/circle/${postId}`);
    const owners: string[] = [];
    for (const n of [1, 2, 3]) {
      const a = await ctx.services.auth.registerAccount({ email: `circle.owner${n}@example.com`, password: 'circle owner passphrase 2026' }, {});
      const owned = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, withClaimSecret: true }, SYSTEM_ACTOR);
      await ctx.services.warranty.activate(owned.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
      const scan = await ctx.services.verification.verify({ code: owned.code.data }, {});
      await ctx.services.ownership.registerFirst(a.account.id, { registrationToken: scan.registration!.token, claimCode: owned.claimCode! }, { type: 'account', id: a.account.id });
      owners.push(a.account.id);
    }
    await ctx.services.circle.rsvp(owners[0]!, postId, 'YES', { type: 'account', id: owners[0]! });
    await ctx.services.circle.rsvp(owners[1]!, postId, 'NO', { type: 'account', id: owners[1]! });
    await ctx.services.circle.rsvp(owners[2]!, postId, 'YES', { type: 'account', id: owners[2]! });
    await expect(ctx.services.circle.rsvp(owners[1]!, postId, 'YES', { type: 'account', id: owners[1]! })).rejects.toMatchObject({ code: 'CIRCLE_FULL' });
    await p.reload();
    await expect.poll(() => p.locator('#answers tbody tr').count()).toBe(3);
    expect(await p.locator('#answers .panel__note').textContent()).toBe('2 yes · 1 no · 0 of 2 places left');
    expect(await p.locator('[data-testid=answer-account]').allTextContents()).toEqual(expect.arrayContaining(['circle.owner1@example.com', 'circle.owner2@example.com']));
    await p.selectOption('#answers select[name=answer]', 'NO');
    await expect.poll(() => p.locator('#answers tbody tr').count()).toBe(1);
    expect(await p.locator('[data-testid=answer-account]').textContent()).toBe('circle.owner2@example.com');
    // A change: three places; a capacity under its YES is the server's refusal, said in the dialog.
    await p.click('[data-testid=circle-edit]');
    await p.fill('dialog input[name=capacity]', '1');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('2 places are taken already: the capacity cannot go under that.');
    await p.fill('dialog input[name=capacity]', '3');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Post saved.")');
    await expect.poll(() => p.locator('#post .deflist__row', { hasText: 'Places' }).locator('.deflist__value').textContent()).toBe('3');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'club-circle-post', { full: true });

    // A poll: its options one per line; once voted, its results, and its options no longer change.
    await go(p, '#/club?tab=circle', 'Club');
    await p.click('[data-testid=circle-new-poll]');
    await p.fill('dialog input[name=title]', 'The next stone');
    await p.fill('dialog textarea[name=pollOptions]', 'Onyx\nOpal\nJade');
    await p.selectOption('dialog select[name=minTier]', '1');
    await confirmDialog(p);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('The next stone');
    const pollId = decodeURIComponent(new URL(p.url()).hash.split('/').pop()!);
    await p.click('[data-testid=circle-publish]');
    await confirmDialog(p);
    await ctx.services.circle.vote(owners[0]!, pollId, 1);
    await ctx.services.circle.vote(owners[1]!, pollId, 1);
    await ctx.services.circle.vote(owners[2]!, pollId, 2);
    await p.reload();
    await expect.poll(() => p.locator('#results .bar').count()).toBe(3);
    expect(await p.locator('#results .bar__label').allTextContents()).toEqual(['Onyx', 'Opal', 'Jade']);
    expect(await p.locator('#results .bar__value').allTextContents()).toEqual(['0', '2', '1']);
    expect(await p.locator('#results .panel__note').textContent()).toBe('3 votes');
    await p.click('[data-testid=circle-edit]');
    await p.fill('dialog textarea[name=pollOptions]', 'Onyx\nOpal');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Votes have been cast: the options of this poll no longer change.');
    await p.click('[data-testid=dialog-cancel]');
    // Withdrawn: out of the circle, its votes kept.
    await p.click('[data-testid=circle-unpublish]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=circle-state]').textContent()).toBe('Not published');
    // The tab lists both, its rows leading to their pages.
    await go(p, '#/club?tab=circle', 'Club');
    await expect.poll(() => p.locator('#circle tbody tr').count()).toBe(2);
    expect(await p.locator('#circle [data-testid=circle-link]').allTextContents()).toEqual(['The next stone', 'Dinner at the atelier']);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'club-circle', { full: true });

    // Analytics: the panel The Circle, the members by tier now, the visits by day (none counted before today).
    await ctx.services.circle.feed(owners[0]!, { page: 1, pageSize: 20 });
    await go(p, '#/analytics?days=30', 'Analytics');
    const panel = p.locator('.panel--circle');
    await expect.poll(() => panel.locator('[data-testid=circle-members] .bar__label').allTextContents()).toEqual(['TITANE', 'PLATINE', 'PALLADIUM']);
    // The accounts the club counts now: ACTIVE, holding a piece that is neither revoked, flagged nor retired.
    const members = await ctx.db
      .selectFrom('ownership as o')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .innerJoin('products as pr', 'pr.id', 'o.product_id')
      .select('o.account_id')
      .where('o.ended_at', 'is', null)
      .where('a.status', '=', 'ACTIVE')
      .where('pr.status', 'not in', ['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'])
      .distinct()
      .execute();
    expect(await panel.locator('.panel__note').textContent()).toMatch(new RegExp(`^${members.length} members? · 0 visits · counted per day, without any account$`));
    expect(await panel.locator('[data-testid=circle-visits] .empty__text').textContent()).toBe('No visit of the circle in these days.');
    // The kpis of the scans stay four: the panel adds none.
    expect(await p.locator('.view--analytics .kpi').count()).toBe(4);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await cspViolations(p)).toEqual([]);
    await c.close();

    // An AUDITOR reads the circle and its answers, the emails masked, without an action.
    const auditor = { email: 'circle.audit@orbes.test', password: 'circle auditor passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...auditor, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const ac = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await ac.newPage();
    await watch(ap);
    await signIn(ap, auditor.email, auditor.password);
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('Dashboard');
    await go(ap, '#/club?tab=circle', 'Club');
    for (const action of ['circle-new-note', 'circle-new-invitation', 'circle-new-poll']) expect(await ap.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    await ap.locator('#circle [data-testid=circle-link]', { hasText: 'Dinner at the atelier' }).click();
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('Dinner at the atelier');
    await expect.poll(() => ap.locator('#answers tbody tr').count()).toBe(3);
    for (const shown of await ap.locator('[data-testid=answer-account]').allTextContents()) expect(shown).toMatch(/^c\*\*\*@example\.com$/);
    for (const action of ['circle-edit', 'circle-publish', 'circle-unpublish', 'circle-photo-add', 'circle-photo-remove', 'circle-photo-alt']) {
      expect(await ap.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    expect(await cspViolations(ap)).toEqual([]);
    await ac.close();
  }, STEP_TIMEOUT);

  it('sets the words of the tiers from the Club page (P-X04): edited in their dialog, restored to the default; the tier on an owner\'s sheet; an AUDITOR reads', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    await go(p, '#/club', 'Club');
    await p.click('[data-testid=club-tab-tiers]');
    await expect.poll(() => p.locator('[data-testid=club-tab-tiers]').getAttribute('aria-current')).toBe('page');
    expect(await p.evaluate(() => location.hash)).toBe('#/club?tab=tiers');
    expect(await p.locator('.side__link.is-active').textContent()).toBe('Club');
    // The three tiers, each from its threshold, with the words by default.
    await expect.poll(() => p.locator('.tiers .panel:not(#tier-program) .panel__title').allTextContents()).toEqual(['TITANE', 'PLATINE', 'PALLADIUM']);
    expect(await p.locator('.tiers .deflist__row', { hasText: 'Reached' }).locator('.deflist__value').evaluateAll((els) => els.map((e) => e.firstChild?.textContent))).toEqual([
      'From 1 piece held',
      'From 5 pieces held',
      'From 10 pieces held',
    ]);
    expect(await p.locator('[data-testid=tier-benefits-PLATINE] li').allTextContents()).toEqual(CLUB_TIER_DEFAULT_BENEFITS.PLATINE.split('\n'));
    for (const t of ['TITANE', 'PLATINE', 'PALLADIUM']) expect(await p.locator(`[data-testid=tier-words-${t}]`).textContent(), t).toBe('Default');
    expect(await p.locator('[data-testid^=tier-restore-]').count()).toBe(0);

    // Edited: refused unchanged, then saved, one benefit per line; read by the club at once.
    await p.click('[data-testid=tier-edit-PLATINE]');
    expect(await p.locator('dialog textarea[name=benefits]').inputValue()).toBe(CLUB_TIER_DEFAULT_BENEFITS.PLATINE);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Nothing has changed.');
    await p.fill('dialog textarea[name=benefits]', 'Priority care for your pieces.\n\nA private viewing of each release.');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=tier-benefits-PLATINE] li').allTextContents()).toEqual(['Priority care for your pieces.', 'A private viewing of each release.']);
    await expect.poll(() => p.locator('[data-testid=tier-words-PLATINE] .status__text').textContent()).toBe('Edited');
    expect(await p.locator('[data-testid=tier-words-PLATINE] .cell-sub').textContent()).toMatch(/UTC$/);
    expect((await ctx.db.selectFrom('club_tiers').select(['tier', 'benefits']).execute())).toEqual([{ tier: 'PLATINE', benefits: 'Priority care for your pieces.\nA private viewing of each release.' }]);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'club-tiers', { full: true });
    // Restored: the row goes, the words by default are back.
    await p.click('[data-testid=tier-restore-PLATINE]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=tier-words-PLATINE]').textContent()).toBe('Default');
    expect(await p.locator('[data-testid=tier-benefits-PLATINE] li').allTextContents()).toEqual(CLUB_TIER_DEFAULT_BENEFITS.PLATINE.split('\n'));
    expect(await ctx.db.selectFrom('club_tiers').selectAll().execute()).toEqual([]);
    expect(await cspViolations(p)).toEqual([]);

    // An owner's sheet: the tier in the club now, from the pieces held.
    const a = await ctx.services.auth.registerAccount({ email: 'tier.owner@example.com', password: 'tier owner passphrase 2026' }, {});
    for (let i = 0; i < 5; i++) {
      const owned = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, withClaimSecret: true }, SYSTEM_ACTOR);
      await ctx.services.warranty.activate(owned.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
      const scan = await ctx.services.verification.verify({ code: owned.code.data }, {});
      await ctx.services.ownership.registerFirst(a.account.id, { registrationToken: scan.registration!.token, claimCode: owned.claimCode! }, { type: 'account', id: a.account.id });
    }
    await go(p, `#/owners/${a.account.id}`, 'tier.owner@example.com');
    await expect.poll(() => p.locator('[data-testid=owner-tier]').textContent()).toBe('PLATINE · 5 pieces held');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await c.close();

    // An AUDITOR reads the tiers, without an action.
    const auditor = { email: 'tiers.audit@orbes.test', password: 'tiers auditor passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...auditor, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const ac = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await ac.newPage();
    await watch(ap);
    await signIn(ap, auditor.email, auditor.password);
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('Dashboard');
    await go(ap, '#/club?tab=tiers', 'Club');
    await expect.poll(() => ap.locator('.tiers .panel:not(#tier-program) .panel__title').count()).toBe(3);
    expect(await ap.locator('[data-testid^=tier-edit-], [data-testid^=tier-restore-]').count()).toBe(0);
    expect(await cspViolations(ap)).toEqual([]);
    await ac.close();
  }, STEP_TIMEOUT);

  it('sets THE PROGRAM from Club → Tiers (plan NEXT-NINE, BP-19 T2): the figures read, refused before sending, saved whole by an ADMIN, each tier\'s lines following; an OPERATOR reads', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    await go(p, '#/club?tab=tiers', 'Club');
    // THE PROGRAM first, above the three tiers, with the defaults.
    await expect.poll(() => p.locator('.tiers .panel__title').allTextContents()).toEqual(['THE PROGRAM', 'TITANE', 'PLATINE', 'PALLADIUM']);
    expect(await p.locator('[data-testid=program-early]').textContent()).toBe('PALLADIUM 4 hours · PLATINE 2 hours');
    expect(await p.locator('[data-testid=program-shipping]').textContent()).toBe('PLATINE Standard · PALLADIUM Express');
    expect(await p.locator('[data-testid=program-care]').textContent()).toBe('PLATINE 1 piece a year · PALLADIUM Every piece');
    expect(await p.locator('[data-testid=program-priority]').textContent()).toBe('From PLATINE');
    expect(await p.locator('[data-testid=program-gift-platine]').textContent()).toBe('None');
    expect(await p.locator('[data-testid=program-credit-platine]').textContent()).toBe('€\u00a050 · valid 12 months');
    expect(await p.locator('[data-testid=program-credit-channels]').textContent()).toBe('Draw, LIVE RELEASE, The private salon');
    expect(await p.locator('[data-testid=program-changed]').textContent()).toBe('The defaults');
    // Each tier lists its program's lines as /verify will show them, above its words.
    expect(await p.locator('[data-testid=tier-program-TITANE]').textContent()).toBe('None');
    expect(await p.locator('[data-testid=tier-program-PLATINE] li').first().textContent()).toBe(
      'Early access to each draw: a place reserved directly 2 hours before entries open to everyone, unless its page says otherwise.',
    );
    expect(await p.locator('[data-testid=tier-program-PALLADIUM] li').allTextContents()).toContain('Free express shipping on every order.');

    // Refused before anything is sent: PALLADIUM after PLATINE; unchanged.
    await p.click('[data-testid=program-edit]');
    expect(await p.locator('dialog input[name=earlyAccessPalladiumHours]').inputValue()).toBe('4');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Nothing has changed.');
    await p.fill('dialog input[name=earlyAccessPalladiumHours]', '1');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('PALLADIUM’s early access starts no later than PLATINE’s.');
    // Saved: 6 hours and 3, the welcome gift of PALLADIUM, a credit of € 75 for PLATINE, express for PLATINE too.
    await p.fill('dialog input[name=earlyAccessPalladiumHours]', '6');
    await p.fill('dialog input[name=earlyAccessPlatineHours]', '3');
    await p.selectOption('dialog select[name=shippingFreePlatine]', 'EXPRESS');
    const giftLabel = await p.locator(`dialog select[name=giftPalladiumModelId] option[value="${modelId}"]`).textContent();
    expect(giftLabel).toMatch(/ · (one size|\d+ sizes) · \d+ available$/);
    await p.selectOption('dialog select[name=giftPalladiumModelId]', modelId);
    await p.fill('dialog input[name=creditPlatine]', '75');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=program-early]').textContent()).toBe('PALLADIUM 6 hours · PLATINE 3 hours');
    expect(await p.locator('[data-testid=program-shipping]').textContent()).toBe('PLATINE Express · PALLADIUM Express');
    expect(await p.locator('[data-testid=program-credit-platine]').textContent()).toBe('€\u00a075 · valid 12 months');
    expect(await p.locator('[data-testid=program-changed]').textContent()).toMatch(new RegExp(`^Changed by ${ADMIN.email.replace('.', '\\.')} on .+ UTC$`));
    const giftName = (await p.locator('[data-testid=program-gift-palladium]').textContent())!;
    expect(await p.locator('[data-testid=tier-program-PALLADIUM] li').allTextContents()).toContain(`A welcome gift, ${giftName}, added to your next order.`);
    expect(await p.locator('[data-testid=tier-program-PLATINE] li').allTextContents()).toContain('Free express shipping on every order.');
    const row = await ctx.db.selectFrom('club_program_settings').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ early_access_palladium_hours: 6, early_access_platine_hours: 3, shipping_free_platine: 'EXPRESS', gift_palladium_model_id: modelId, credit_platine_minor: 7500 });
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'club-program', { full: true });
    expect(await cspViolations(p)).toEqual([]);
    await c.close();

    // An OPERATOR reads THE PROGRAM without Edit program (an ADMIN's), and still edits the words of a tier.
    const operator = { email: 'program.operator@orbes.test', password: 'program operator passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...operator, role: 'OPERATOR' }, SYSTEM_ACTOR);
    const oc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const op = await oc.newPage();
    await watch(op);
    await signIn(op, operator.email, operator.password);
    await expect.poll(async () => (await title(op).textContent())?.trim()).toBe('Dashboard');
    await go(op, '#/club?tab=tiers', 'Club');
    await expect.poll(() => op.locator('[data-testid=program-early]').textContent()).toBe('PALLADIUM 6 hours · PLATINE 3 hours');
    expect(await op.locator('[data-testid=program-edit]').count()).toBe(0);
    expect(await op.locator('[data-testid^=tier-edit-]').count()).toBe(3);
    expect(await cspViolations(op)).toEqual([]);
    await oc.close();
    // Back to the defaults for the steps that follow.
    await ctx.db.deleteFrom('club_program_settings').execute();
  }, STEP_TIMEOUT);

  it('handles a yearly care from Clients → Yearly care (plan NEXT-NINE, BP-19 T6): the return address the client gave, the label sent as a PDF, the piece received; the client\'s Messages row links it; an AUDITOR reads it masked', async () => {
    // The PLATINE owner of the Tiers step asks for the yearly care of a piece, and has written once to Client Services.
    const owner = await ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', 'tier.owner@example.com').executeTakeFirstOrThrow();
    const serial = (
      await ctx.db.selectFrom('ownership as o').innerJoin('products as p', 'p.id', 'o.product_id').select('p.product_id').where('o.account_id', '=', owner.id).where('o.ended_at', 'is', null).orderBy('p.product_id').executeTakeFirstOrThrow()
    ).product_id;
    const actor = { type: 'account' as const, id: owner.id };
    await ctx.services.messages.write(owner.id, { body: 'A question about my pieces.' }, actor);
    const asked = await ctx.services.care.request(owner.id, serial, { name: 'Ada Owner', address: '12 rue de la Paix\n75002 Paris' }, actor);
    const careId = asked.request!.id;
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    // Its link in the sidebar, under Clients after Warranties.
    expect(await p.locator('.side__link[data-route=care]').textContent()).toBe('Yearly care');
    // The client's Messages row links the open request.
    await go(p, '#/messages', 'Messages');
    await expect.poll(() => p.locator('[data-testid=conversation-care]').first().textContent()).toBe(`Yearly care · ${serial}`);
    await p.click('[data-testid=conversation-care]');
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe(serial);
    // The board: Requested first; the request's page with the address the client gave, in clear.
    await go(p, '#/care', 'Yearly care');
    await expect.poll(() => p.locator('[data-testid=care-piece]').allTextContents()).toContain(serial);
    await go(p, `#/care/${careId}`, serial);
    expect(await p.locator('[data-testid=care-status]').textContent()).toBe('Requested');
    expect(await p.locator('[data-testid=care-return-address]').innerText()).toBe('Ada Owner\n12 rue de la Paix\n75002 Paris');
    expect(await p.locator('[data-testid=care-conversation]').textContent()).toBe('To answer');
    // SEND LABEL: refused without the PDF; then the PDF, a carrier and the tracking number.
    await p.click('[data-testid=care-label]');
    const carrier = await p.locator('dialog select[name=carrierId] option').nth(1).getAttribute('value');
    await p.selectOption('dialog select[name=carrierId]', carrier!);
    await p.fill('dialog input[name=tracking]', '6A12345678901');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Choose the label, a PDF.');
    await p.setInputFiles('dialog [data-testid=care-label-file]', { name: 'label.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1') });
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=care-status]').textContent()).toBe('Label sent');
    expect(await p.locator('[data-testid=care-label-shipment]').textContent()).toMatch(/ · 6A12345678901$/);
    // RECEIVED AT THE ATELIER: the YEARLY CARE record opened.
    await p.click('[data-testid=care-receive]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=care-status]').textContent()).toBe('At the atelier');
    const record = await ctx.db.selectFrom('service_records as s').innerJoin('products as p', 'p.id', 's.product_id').select(['s.type', 's.status']).where('p.product_id', '=', serial).executeTakeFirstOrThrow();
    expect(record).toEqual({ type: 'YEARLY_CARE', status: 'OPEN' });
    // Nothing was written in the client's messages.
    expect((await ctx.db.selectFrom('client_messages').select('author').execute()).filter((m) => m.author === 'STAFF')).toEqual([]);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'yearly-care', { full: true });
    expect(await cspViolations(p)).toEqual([]);
    await c.close();
    // An AUDITOR reads the request, the address and the email masked, without an action.
    const auditor = { email: 'care.audit@orbes.test', password: 'care auditor passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...auditor, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const ac = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await ac.newPage();
    await watch(ap);
    await signIn(ap, auditor.email, auditor.password);
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('Dashboard');
    await go(ap, `#/care/${careId}`, serial);
    expect(await ap.locator('[data-testid=care-return-address]').innerText()).not.toContain('rue de la Paix');
    expect(await ap.locator('button[data-testid=care-label], button[data-testid=care-receive], button[data-testid=care-return], button[data-testid=care-complete], button[data-testid=care-cancel]').count()).toBe(0);
    expect(await cspViolations(ap)).toEqual([]);
    await ac.close();
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
    // Reads the points of sale, never sells (A-08): the sale mode starts warranties, which an AUDITOR cannot.
    expect(await p.locator('.side__link', { hasText: 'Points of sale' }).count()).toBe(1);
    expect(await p.locator('.side__link', { hasText: 'Sale mode' }).count()).toBe(0);
    await go(p, '#/sale', 'Sale mode');
    await p.waitForSelector('[data-testid=sale-not-offered]');
    expect(await p.locator('[data-testid=sale-scan]').count()).toBe(0);
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
    // Owners read with every email masked, without the recovery code reserved to an ADMIN (A-06).
    await go(p, '#/owners', 'Owners');
    await expect.poll(() => p.locator('table.table tbody tr').count()).toBeGreaterThanOrEqual(2);
    expect(await p.locator('[data-testid=issue-recovery-code]').count()).toBe(0);
    for (const shown of await p.locator('[data-testid=owner-link]').allTextContents()) expect(shown).toMatch(/^[^@*]\*\*\*@[^@]+$/);
    expect(await p.locator('.page-head__lead').textContent()).toContain('Emails are masked for your role.');
    // The sheet reads, masked, without the lock, the export or the recovery code.
    await p.locator('table.table tbody tr', { hasText: 's***@example.com' }).locator('[data-testid=owner-link]').click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('s***@example.com');
    expect(await p.locator('#pieces tbody tr').count()).toBe(1);
    for (const action of ['lock-account', 'unlock-account', 'export-account', 'issue-recovery-code']) expect(await p.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    for (const email of ['sheet.client@example.com', 'lost.password@example.com']) expect(await p.content()).not.toContain(email);
    // The catalogue reads, without its edits (A-10); a model's Lookbook page reads too, without its edits (P-R02).
    await go(p, '#/catalogue', 'Catalogue');
    await expect.poll(() => p.locator('#models tbody tr').count()).toBe(2);
    for (const action of ['edit-model', 'rename-collection', 'toggle-category', 'model-photo', 'discontinue-model', 'reinstate-model']) expect(await p.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    await p.locator('#models tbody tr', { hasText: 'MNL-RG' }).locator('[data-testid=model-lookbook]').click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('MONOLITHE');
    await p.waitForSelector('[data-testid=story-shown]');
    for (const action of ['lookbook-edit', 'salon-edit', 'story-edit', 'specs-edit', 'gallery-add', 'gallery-earlier', 'gallery-alt', 'gallery-remove']) expect(await p.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    // The Cases queue reads, without the action that closes a case.
    await go(p, '#/cases', 'Cases');
    await expect.poll(() => p.locator('table.table tbody tr').count()).toBe(1);
    expect(await p.locator('[data-testid=close-case]').count()).toBe(0);
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
      /** The computed font size of the first match, in px: iOS Safari zooms into a field under 16 px (BRAND §3.1). */
      const fontPx = (sel: string) => p.locator(sel).first().evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      await p.goto(`${origin}/admin`);
      await p.waitForSelector('[data-testid=login-form]');
      for (const sel of ['input[name=email]', 'input[name=password]']) expect(await fontPx(sel), sel).toBeGreaterThanOrEqual(16);
      await signIn(p, seller.email, temporary);
      // The first sign-in: the new password, framed by the sale shell (no console sidebar).
      await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('New password');
      expect(await p.locator('[data-testid=sale-shell]').count()).toBe(1);
      expect(await p.locator('.side').count()).toBe(0);
      expect(await p.locator('[data-testid=change-password]').count()).toBe(0);
      expect(await p.isVisible('[data-testid=sign-out]')).toBe(true);
      for (const sel of ['input[name=currentPassword]', 'input[name=newPassword]', 'input[name=confirmPassword]']) expect(await fontPx(sel), sel).toBeGreaterThanOrEqual(16);
      for (const sel of ['[data-testid=password-save]', '.saleshell .cfield__label']) expect(await fontPx(sel), sel).toBeGreaterThanOrEqual(10);
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
      // Read at arm's length: the point of sale at 16 px (no zoom when it is focused), buttons and labels at the 10 px floor.
      expect(await fontPx('[data-testid=sale-retailer]')).toBeGreaterThanOrEqual(16);
      for (const sel of ['[data-testid=sale-scan]', '[data-testid=sale-upload]', '.saleshell .cfield__label']) expect(await fontPx(sel), sel).toBeGreaterThanOrEqual(10);

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

  it('sets the private salon of a Reserved model from the Catalogue and closes an owner\'s request from the Club page (P-X08); an AUDITOR reads, the emails masked', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    // A model of its own, Reserved in the lookbook.
    const category = (await ctx.categories.getByCode('J'))!;
    const solstice = await ctx.db.insertInto('models').values({ category_id: category.index, name: 'SOLSTICE', type: 'RING', sku_prefix: 'SOL-RG' }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.catalog.updateModel(solstice.id, { slug: 'solstice', lookbook: 'RESERVED' }, SYSTEM_ACTOR);
    await go(p, `#/catalogue/${solstice.id}`, 'SOLSTICE');
    expect(await p.locator('[data-testid=salon-price]').textContent()).toBe('None shown');
    expect(await p.locator('[data-testid=salon-tier]').textContent()).toBe('TITANE');
    // Its price and tier in their dialog: refused unchanged, then saved, the price as the server keeps it.
    await p.click('[data-testid=salon-edit]');
    expect(await p.locator('dialog [data-testid=salon-impact]').textContent()).toMatch(/in the private salon now\.$/);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Nothing has changed.');
    await p.fill('dialog input[name=priceLabel]', '  €   4 800 ');
    await p.selectOption('dialog select[name=minTier]', '2');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Private salon saved.")');
    await expect.poll(() => p.locator('[data-testid=salon-price]').textContent()).toBe('€ 4 800');
    expect(await p.locator('[data-testid=salon-tier]').textContent()).toBe('PLATINE');
    expect(await ctx.db.selectFrom('models').select(['price_label', 'private_min_tier']).where('id', '=', solstice.id).executeTakeFirstOrThrow()).toEqual({ price_label: '€ 4 800', private_min_tier: 2 });
    expect(await figuresInDisplayFace(p)).toEqual([]);

    // A PLATINE owner requests it on /verify (the service, as REQUEST THIS PIECE calls it).
    const a = await ctx.services.auth.registerAccount({ email: 'vesper.owner@example.com', password: 'salon owner passphrase 2026' }, {});
    for (let i = 0; i < 5; i++) {
      const owned = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', year: 2026, withClaimSecret: true }, SYSTEM_ACTOR);
      await ctx.services.warranty.activate(owned.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
      const scan = await ctx.services.verification.verify({ code: owned.code.data }, {});
      await ctx.services.ownership.registerFirst(a.account.id, { registrationToken: scan.registration!.token, claimCode: owned.claimCode! }, { type: 'account', id: a.account.id });
    }
    await ctx.services.salon.request(a.account.id, 'solstice', 'A size 54, and a call after six.', { type: 'account', id: a.account.id });

    // The Club's Requests tab: the open request, its client (in clear for an ADMIN), its model and price, its note.
    await go(p, '#/club', 'Club');
    await p.click('[data-testid=club-tab-requests]');
    await expect.poll(() => p.locator('[data-testid=club-tab-requests]').getAttribute('aria-current')).toBe('page');
    expect(await p.evaluate(() => location.hash)).toBe('#/club?tab=requests');
    const row = p.locator('#requests tbody tr', { hasText: 'vesper.owner@example.com' });
    await expect.poll(() => row.count()).toBe(1);
    expect(await row.locator('[data-testid=request-model]').textContent()).toBe('SOLSTICE');
    expect(await row.locator('.cell-sub').first().textContent()).toBe('RING · € 4 800');
    expect(await row.locator('[data-testid=request-note]').textContent()).toBe('A size 54, and a call after six.');
    expect(await row.locator('.status__text').textContent()).toBe('OPEN');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'club-requests', { full: true });
    // Closed with a note and its outcome: the row says the outcome, who closed it and what was done; ACCEPTED created
    // the request's order (plan LIVE RELEASE+).
    await row.locator('[data-testid=close-request]').click();
    await p.fill('dialog textarea[name=note]', 'Called the client: a fitting on Tuesday.');
    await p.selectOption('dialog select[name=outcome]', 'ACCEPTED');
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Request closed.")');
    await expect.poll(() => row.locator('.status__text').textContent()).toBe('CLOSED');
    expect(await row.locator('[data-testid=request-outcome]').textContent()).toMatch(/^ACCEPTED · /);
    expect(await row.locator('.cell-details').last().textContent()).toBe('Called the client: a fitting on Tuesday.');
    expect(await row.locator('[data-testid=close-request]').count()).toBe(0);
    expect(await ctx.db.selectFrom('shop_requests').select(['status', 'outcome', 'resolution_note']).where('account_id', '=', a.account.id).execute()).toEqual([
      { status: 'CLOSED', outcome: 'ACCEPTED', resolution_note: 'Called the client: a fitting on Tuesday.' },
    ]);
    expect(await ctx.db.selectFrom('orders').select(['channel', 'status']).where('account_id', '=', a.account.id).execute()).toEqual([{ channel: 'SALON', status: 'RESERVED' }]);
    // Narrowed to the open requests: none is left.
    await p.selectOption('#requests select[name=status]', 'OPEN');
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/club?tab=requests&status=OPEN');
    await expect.poll(() => p.locator('#requests tbody tr', { hasText: 'vesper.owner@example.com' }).count()).toBe(0);
    expect(await cspViolations(p)).toEqual([]);
    await c.close();

    // An AUDITOR reads the requests, the client's email masked, without an action; and the salon of the model, without Edit.
    await ctx.services.salon.request(a.account.id, 'solstice', null, { type: 'account', id: a.account.id });
    const auditor = { email: 'salon.audit@orbes.test', password: 'salon auditor passphrase 2026' };
    await ctx.services.auth.createAdmin({ ...auditor, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const ac = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await ac.newPage();
    await watch(ap);
    await signIn(ap, auditor.email, auditor.password);
    await expect.poll(async () => (await title(ap).textContent())?.trim()).toBe('Dashboard');
    await go(ap, '#/club?tab=requests&status=OPEN', 'Club');
    await expect.poll(() => ap.locator('#requests [data-testid=request-client]').allTextContents()).toEqual(['v***@example.com']);
    expect(await ap.locator('[data-testid=close-request]').count()).toBe(0);
    await go(ap, `#/catalogue/${solstice.id}`, 'SOLSTICE');
    await expect.poll(() => ap.locator('[data-testid=salon-price]').textContent()).toBe('€ 4 800');
    expect(await ap.locator('[data-testid=salon-edit]').count()).toBe(0);
    expect(await cspViolations(ap)).toEqual([]);
    await ac.close();
  }, STEP_TIMEOUT);

  it('adds a variant to a model from its page (NOCTURNE N1): VARIANTS, ADD A VARIANT with the main model\'s own dot, its reference photograph, its page naming its main model; the Catalogue names both', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    await watch(p);
    await signIn(p, ADMIN.email, ADMIN.password);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    // A model of its own, with what ADD A VARIANT copies.
    const main = await ctx.services.catalog.createModel({ categoryCode: 'J', name: 'CONSTELLATION', type: 'PENDANT', skuPrefix: 'CST-PD', careInstructions: 'Wipe it with a soft, dry cloth.' }, SYSTEM_ACTOR);
    await ctx.services.catalog.updateModel(main.id, { story: 'Seven stones, as the stars of the north.', specs: 'Metal: 18k white gold' }, SYSTEM_ACTOR);
    await go(p, `#/catalogue/${main.id}`, 'CONSTELLATION');
    const section = p.locator('#variants');
    await expect.poll(() => section.locator('[data-testid=variant-own]').textContent()).toBe('None');
    expect(await section.locator('[data-testid=variant-list]').textContent()).toContain('No variant yet.');
    // ADD A VARIANT: the main model's own dot first (it has none yet), then the variant's; refused while a label is missing.
    await p.click('[data-testid=variant-add]');
    expect(await p.locator('dialog [data-testid=variant-impact]').textContent()).toMatch(/^A model of its own, copied from this one: its type, collection, story, specifications and care\./);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Complete the required fields.');
    await p.fill('dialog input[name=mainLabel]', 'Silver');
    await p.fill('dialog input[name=mainSwatch]', '#d7d5d0');
    // A label of the group is another dot's: said before anything is sent.
    await p.fill('dialog input[name=label]', 'silver');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('This model or another of its variants already has this label.');
    await p.fill('dialog input[name=label]', 'Night blue');
    await p.fill('dialog input[name=swatch]', '#16224a');
    // The SKU prefix proposed from the main model's and the label, sent when the field is left empty.
    await expect.poll(() => p.locator('dialog [data-testid=variant-prefix]').textContent()).toBe('SKU prefix: CST-NI');
    await p.click('[data-testid=dialog-confirm]');
    // Its photographs next: the reference photograph's dialog opens on the variant created (left for later here), then its own page.
    await p.waitForSelector('dialog [data-testid=photo-impact]', { timeout: 15_000 });
    await expect.poll(() => p.locator('dialog .dialog__eyebrow').textContent()).toBe('CONSTELLATION · CST-NI');
    await p.click('[data-testid=dialog-cancel]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('CONSTELLATION · NIGHT BLUE');
    const variant = await ctx.db.selectFrom('models').selectAll().where('variant_of', '=', main.id).executeTakeFirstOrThrow();
    expect([variant.sku_prefix, variant.variant_label, variant.variant_swatch, variant.story, variant.specs, variant.care_instructions, variant.lookbook]).toEqual([
      'CST-NI',
      'Night blue',
      '#16224A',
      'Seven stones, as the stars of the north.',
      'Metal: 18k white gold',
      'Wipe it with a soft, dry cloth.',
      'HIDDEN',
    ]);
    expect(new URL(p.url()).hash).toBe(`#/catalogue/${variant.id}`);
    // A variant's page names its main model; it adds no variant of its own.
    await expect.poll(() => p.locator('[data-testid=variant-main]').textContent()).toBe('CONSTELLATION · SILVER');
    expect(await p.locator('[data-testid=variant-own]').textContent()).toBe('Night blue · #16224A');
    expect(await p.locator('[data-testid=variant-add]').count()).toBe(0);
    // Its main model's page lists it, with its dot; the main model's own dot given.
    await p.click('[data-testid=variant-main]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('CONSTELLATION · SILVER');
    expect(await p.locator('[data-testid=variant-own]').textContent()).toBe('Silver · #D7D5D0');
    expect(await p.locator('[data-testid=variant-list] tbody tr').count()).toBe(1);
    expect(await p.locator('[data-testid=variant-list] tbody tr').textContent()).toContain('Night blue');
    await shot(p, 'model-variants', { full: true });
    // The Catalogue says where each stands; a choice of a model names its label.
    await go(p, '#/catalogue', 'Catalogue');
    expect(await p.locator('#models tbody tr', { hasText: 'CST-NI' }).locator('[data-testid=model-variant]').textContent()).toBe('Variant of CONSTELLATION · NIGHT BLUE');
    expect(await p.locator('#models tbody tr', { hasText: 'CST-PD' }).locator('[data-testid=model-variant]').textContent()).toBe('SILVER · 1 variant');
    const actions = (await ctx.db.selectFrom('audit_logs').select(['action', 'target_id']).where('action', '=', 'model.variant.create').execute()).map((a) => a.target_id);
    expect(actions).toEqual([variant.id]);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await cspViolations(p)).toEqual([]);
    await c.close();
  }, STEP_TIMEOUT);

  it('raised no page error or CSP violation', () => {
    expect(problems).toEqual([]);
  });
});
