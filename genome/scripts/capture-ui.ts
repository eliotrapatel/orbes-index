/**
 * Screenshots of the verification app and the admin console for
 * docs/BRAND-DESIGN-SYSTEM.md, captured from the real system:
 *
 *   production web build (scripts/build-web.ts, into a temp dir)
 *   ─► the real server (createContext + buildApp) on an in-memory PGlite
 *      database holding the demo dataset (seedDemo, memory signing key)
 *   ─► Chromium (playwright-core) with a fake camera that plays simulated
 *      hand-held video of the demo code O26-J-00184 (test/e2e/support.ts)
 *   ─► PNG screenshots, quantised to an exact 256-colour palette
 *
 *   cd genome && npx tsx scripts/capture-ui.ts [--out <dir>] [--raw]
 *
 * Output: docs/assets/ui/*.png (default). --raw keeps Chromium's truecolour
 * PNGs instead of the quantised ones.
 *
 * Captures
 *   verify (390 × 844 CSS px at 2×, iPhone user agent, Europe/Paris)
 *     landing · scanner (searching) · scanner (locked on the code) · result
 *     O26-J-00184 AUTHENTIC — FIRST REGISTRATION · its four tabs ·
 *     VERIFYING… (photo path) · UNUSUAL ACTIVITY (O26-J-00193, reported
 *     stolen) · INVALID SIGNATURE (a demo code with one signature bit flipped)
 *   admin (1440 × 900 CSS px at 1×)
 *     dashboard · product page O26-J-00184 · generator result · Cases (the
 *     demo customers' two reports) · Analytics (the daily statistics of the
 *     last 30 complete days) · the owner sheet of Camille Martin · Team (the
 *     bootstrap ADMIN and two staff accounts created through the auth
 *     service: an OPERATOR still on its temporary password, a RETAIL seller)
 *   admin, sale mode (the phone of verify, after the console's captures: the
 *     lookup records a scan): the RETAIL seller, signed in, at the Paris
 *     boutique, with the in-stock O26-J-00187 read from a photo: READY TO SELL
 *   verify, last (its scans would change the console's figures)
 *     UNUSUAL ACTIVITY with DO YOU HOLD THE CERTIFICATE CARD? (O26-L-00014,
 *     sold and unregistered, with a claim code, after a burst of scans of
 *     copies of its code from 22 sources) · MY PIECES (F-01) of the demo
 *     owner Camille Martin, signed in · the OWNERSHIP CERTIFICATE (F-06)
 *     of one of her pieces, opened by a visitor from its link (full page)
 *   legal (the phone of verify): the FAQ (/legal/faq, J-06), in English
 *
 * Nothing is mocked. Two network holds make transient states capturable:
 * the decoder worker script is held until the scanner has been
 * photographed searching, and POST /api/v1/verify is held while the locked
 * scanner and the VERIFYING… screen are photographed. The one-time claim code
 * on the generator result is hidden with its own control before capture.
 * The 2.2 % film grain (.grain) of verify and of the legal pages is hidden
 * through the CSSOM before each capture: invisible at documentation scale, it would otherwise
 * roughly triple the size of the set.
 *
 * Titles and labels render in the shipped display face, Gravesend Sans,
 * everywhere (captures wait for document.fonts.ready). Reading text uses the
 * system stack: Helvetica Neue on macOS; Chromium on Linux has none and
 * resolves it to Liberation Sans (metric-compatible with Helvetica/Arial).
 * Chrome for Testing on macOS paints the locked scanner's frozen camera
 * frame black: from a Mac, keep docs/assets/ui/verify-03-locked.png from a
 * Linux run (write the set elsewhere with --out and copy the rest).
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { encodeOrbesCode, ORBES_CODE_STYLES, renderOrbesCodeSvg } from '../src/core/code/encoder.js';
import { toBase64Url } from '../src/core/bytes.js';
import { frameCodeData } from '../src/core/payload.js';
import { buildApp } from '../src/server/app.js';
import { testConfig } from '../src/server/config.js';
import { createContext, type AppContext } from '../src/server/context.js';
import { closeDb, createDb, type Db } from '../src/server/db/connection.js';
import { DEMO_FIRST_REGISTRATION_PRODUCT_ID, DEMO_TIMELINE_START, seedDemo } from '../src/server/db/seed/demo.js';
import { MemoryKeyProvider } from '../src/server/keys/memory-provider.js';
import { createManualClock, noopLogger, systemActor } from '../src/server/types.js';
import { cameraClipFrames } from '../test/e2e/support.js';
import { svgToGray } from '../test/support/raster.js';
import { writeY4m } from '../test/support/y4m.js';
import { buildWeb } from './build-web.js';

const GENOME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(GENOME_DIR, '..', 'docs', 'assets', 'ui');
const CHROMIUM_PATH = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Demo pieces used by the captures (scenarios in src/server/db/seed/demo.ts). */
const FIRST_REGISTRATION = DEMO_FIRST_REGISTRATION_PRODUCT_ID; // O26-J-00184, ACTIVATED, unregistered
const UNUSUAL_ACTIVITY = 'O26-J-00193'; // reported STOLEN, scanned by a stranger
const FORGERY_BASE = 'O26-J-00186'; // in stock; its signature gets one flipped bit
const CARD_SECTION = 'O26-L-00014'; // sold (ACTIVATED), unregistered, ships with a claim code
const SALE_PIECE = 'O26-J-00187'; // in stock (ISSUED), never sold: READY TO SELL in the sale mode
const SALE_BOUTIQUE = 'SAINT-HONORÉ'; // the demo point of sale the seller picks (ORBES PARIS — SAINT-HONORÉ)
/** Scans of copies of its code, from this many distinct sources within a minute: velocity ⊕ diversity. */
const CARD_BURST = 22;

const ADMIN = { email: 'console@example.com', password: 'capture-ui-demo-password' };
/** The demo owner whose pieces MY PIECES shows (the demo accounts take this password for the capture). */
const OWNER = { email: 'camille.martin@example.com', password: 'capture-ui-owner-password' };
/** Staff for the Team page: a seller (RETAIL) who signs in to the sale mode, and an OPERATOR on its temporary password. */
const SELLER = { email: 'boutique.paris@example.com', password: 'capture-ui-seller-password' };
const OPERATOR_EMAIL = 'atelier@example.com';
const MOBILE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { out: string; raw: boolean } {
  let out = DEFAULT_OUT;
  let raw = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = resolve(argv[++i] ?? '');
    else if (argv[i] === '--raw') raw = true;
    else throw new Error(`unknown argument ${argv[i]} (use --out DIR, --raw)`);
  }
  return { out, raw };
}

const log = (line: string) => process.stdout.write(`${line}\n`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A promise with its resolver, to hold a routed request until a capture is done. */
function gate(): { promise: Promise<void>; open(): void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

// ── Server ─────────────────────────────────────────────────────────────────

interface Stage {
  origin: string;
  ctx: AppContext;
  db: Db;
  close(): Promise<void>;
}

/**
 * Web build + demo dataset + server. The context clock follows the seed's
 * manual clock while seeding, then real time, so registration windows and
 * "VERIFIED …" stamps agree with the browser's clock.
 */
async function startStage(workDir: string): Promise<Stage> {
  const webDir = join(workDir, 'web');
  const t0 = Date.now();
  await buildWeb({ outDir: webDir, mode: 'production' });
  log(`web build: ${Date.now() - t0} ms`);

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const db = createDb('pglite:memory');
  const seedClock = createManualClock(DEMO_TIMELINE_START);
  let live = false;
  const clock = () => (live ? new Date() : seedClock.now());
  const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
  const ctx = await createContext(config, { db, clock, log: noopLogger, keyProvider: new MemoryKeyProvider({ env: 'test' }), migrate: true });
  const t1 = Date.now();
  const seeded = await seedDemo(ctx, { clock: seedClock, now: new Date(), log: noopLogger, accountPassword: OWNER.password });
  live = true;
  log(`demo dataset: ${seeded.products} products, ${seeded.scans} scans, ${seeded.anomalies.open} open anomalies (${Date.now() - t1} ms)`);

  const app = await buildApp(ctx, { serveStatic: true, staticDir: webDir });
  await app.listen({ port, host: '127.0.0.1' });
  log(`server: ${origin}`);
  return {
    origin,
    ctx,
    db,
    async close() {
      await app.close();
      await ctx.close();
      await closeDb(db);
    },
  };
}

/** The framed data (79 bytes) and genome glyphs of a demo product's current code. */
async function codeOf(db: Db, productId: string): Promise<{ data: Uint8Array; glyphs: number[] }> {
  const row = await db
    .selectFrom('codes as c')
    .innerJoin('products as p', 'p.id', 'c.product_id')
    .innerJoin('genomes as g', 'g.id', 'c.genome_id')
    .select(['c.payload', 'c.signature', 'g.glyphs'])
    .where('p.product_id', '=', productId)
    .orderBy('c.issue', 'desc')
    .executeTakeFirstOrThrow();
  return { data: frameCodeData(row.payload, row.signature), glyphs: [...row.glyphs] };
}

/** The printed artifact (classic style, decor on) on a white card, as a photo of the card would show it. */
function codePhoto(code: { data: Uint8Array; glyphs: readonly number[] }, widthPx = 900): Buffer {
  const model = encodeOrbesCode({ data: code.data, genomeGlyphs: code.glyphs }, { decor: true });
  const inner = renderOrbesCodeSvg(model, ORBES_CODE_STYLES.classic);
  const margin = Math.round(widthPx * 0.18);
  const total = widthPx + 2 * margin;
  const href = `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<image x="${margin}" y="${margin}" width="${widthPx}" height="${widthPx}" xlink:href="${href}"/></svg>`;
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: total }, font: { loadSystemFonts: false }, logLevel: 'off' }).render().asPng());
}

/** Fake-camera clip: hand-held portrait video (camera simulator) of the code on a desk, looped by Chromium. */
function cameraClip(code: { data: Uint8Array; glyphs: readonly number[] }, path: string): void {
  const model = encodeOrbesCode({ data: code.data, genomeGlyphs: code.glyphs }, { decor: true });
  const source = svgToGray(renderOrbesCodeSvg(model, ORBES_CODE_STYLES.classic), { widthPx: 800 });
  writeY4m(path, cameraClipFrames(source, { n: 8, seed: 3 }), 15);
}

// ── Screenshots ────────────────────────────────────────────────────────────

class Shots {
  readonly written: string[] = [];
  constructor(
    private readonly outDir: string,
    private readonly raw: boolean,
  ) {
    mkdirSync(outDir, { recursive: true });
  }

  private save(name: string, png: Buffer): void {
    const path = join(this.outDir, `${name}.png`);
    writeFileSync(path, this.raw ? png : quantizePng(png));
    this.written.push(path);
    log(`  ${name}.png  ${(statSync(path).size / 1024).toFixed(0)} KB`);
  }

  async viewport(page: Page, name: string): Promise<void> {
    this.save(name, await page.screenshot({ type: 'png' }));
  }

  /**
   * The whole page with the viewport grown to the document height, so
   * viewport-relative layout (100svh views, sticky sidebar, corner brackets)
   * frames the full composition rather than its first screen only.
   */
  async full(page: Page, name: string): Promise<void> {
    const size = page.viewportSize();
    if (!size) throw new Error('page has no viewport');
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (height > size.height) {
      await page.setViewportSize({ width: size.width, height });
      await sleep(400);
    }
    this.save(name, await page.screenshot({ type: 'png' }));
    if (height > size.height) await page.setViewportSize(size);
  }

  /**
   * A full-width band around one block (the page gutters frame it as on
   * screen), taken with the viewport grown to the document height so no
   * fixed element (corner brackets) falls inside the band.
   */
  async region(page: Page, selector: string, name: string, padY = 28): Promise<void> {
    const size = page.viewportSize();
    if (!size) throw new Error('page has no viewport');
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (height > size.height) {
      await page.setViewportSize({ width: size.width, height });
      await sleep(400);
    }
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`${selector} is not visible`);
    const y = Math.max(0, Math.floor(box.y - padY));
    this.save(name, await page.screenshot({ type: 'png', clip: { x: 0, y, width: size.width, height: Math.ceil(box.y + box.height + padY) - y } }));
    if (height > size.height) await page.setViewportSize(size);
  }
}

function watchPage(page: Page, label: string): void {
  page.on('pageerror', (e) => log(`  [${label}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') log(`  [${label}] console: ${m.text()}`);
  });
}

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { ...MOBILE },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'en-GB',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'no-preference',
  });
}

/** Hide the film grain overlay (CSSOM only: the page CSP forbids style attributes in markup). */
async function hideGrain(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.grain');
    if (el) el.style.visibility = 'hidden';
  });
}

// ── Verify app ─────────────────────────────────────────────────────────────

async function captureVerify(stage: Stage, shots: Shots, workDir: string): Promise<void> {
  const firstRegistration = await codeOf(stage.db, FIRST_REGISTRATION);
  const clip = join(workDir, 'camera.y4m');
  cameraClip(firstRegistration, clip);

  // ── Camera path: landing → scanner → code found → result ─────────────
  const camera = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`],
  });
  try {
    const context = await mobileContext(camera);
    const worker = gate();
    const verify = gate();
    // Hold the decoder bundle (the landing page warms the worker) and the verification call.
    await context.route('**/assets/verify-worker-*.js', async (route) => {
      await worker.promise;
      await route.continue();
    });
    await context.route('**/api/v1/verify', async (route) => {
      await verify.promise;
      await route.continue();
    });
    const page = await context.newPage();
    watchPage(page, 'verify');
    await page.goto(`${stage.origin}/verify`);
    await page.waitForSelector('.landing__scan');
    await page.evaluate(() => document.fonts.ready);
    await hideGrain(page);
    await sleep(3200); // orbit fade 0.4 s + 2.4 s, actions rise 0.6 s + 1.6 s
    await shots.viewport(page, 'verify-01-landing');

    await page.click('.landing__scan');
    await page.waitForSelector('.view--scan.is-ready');
    await sleep(1600); // video fade-in (1.2 s), first frames
    await shots.viewport(page, 'verify-02-scanning');

    worker.open();
    await page.waitForSelector('.view--scan.is-locked', { timeout: 20_000 });
    await sleep(1600); // ORBES CODE FOUND (0.42 s), then VERIFYING…; veil and moons settle (1.4 s)
    await shots.viewport(page, 'verify-03-locked');

    verify.open();
    await page.waitForSelector('.view--result .result__title', { timeout: 20_000 });
    await sleep(2600); // staggered rise of the result blocks
    await page.waitForSelector('.ownership .auth__switch, .ownership form', { timeout: 10_000 });
    await sleep(300);
    const state = await page.getAttribute('.view--result', 'data-state');
    if (state !== 'AUTHENTIC_FIRST_REGISTRATION') throw new Error(`${FIRST_REGISTRATION} verified as ${state}`);
    await shots.full(page, 'verify-04-result-first-registration');

    const tabs: [string, string][] = [
      ['product', 'verify-05-tab-product'],
      ['warranty', 'verify-06-tab-warranty'],
      ['care', 'verify-07-tab-care'],
      ['ownership', 'verify-08-tab-ownership'],
    ];
    for (const [id, name] of tabs) {
      await page.click(`#tab-${id}`);
      await sleep(900); // panel fade (0.7 s), underline draw
      await shots.region(page, '.tabs', name);
    }
    await context.close();
  } finally {
    await camera.close();
  }

  // ── Photo path: VERIFYING…, UNUSUAL ACTIVITY, INVALID SIGNATURE ──────
  const plain = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await mobileContext(plain);
    const page = await context.newPage();
    watchPage(page, 'verify-photo');

    const upload = async (png: Buffer, name: string) => {
      await page.goto(`${stage.origin}/verify`);
      await page.waitForSelector('.landing__scan');
      await hideGrain(page);
      await page.setInputFiles('#photo-input', { name, mimeType: 'image/png', buffer: png });
    };

    // Unusual activity, holding the verification call to photograph VERIFYING….
    const hold = gate();
    await page.route('**/api/v1/verify', async (route) => {
      await hold.promise;
      await route.continue();
    });
    await upload(codePhoto(await codeOf(stage.db, UNUSUAL_ACTIVITY)), 'orbes-code.png');
    await page.waitForFunction(() => document.querySelector('.verifying__status')?.textContent === 'VERIFYING…', null, { timeout: 20_000 });
    await sleep(1300); // view rise (1.1 s)
    await shots.viewport(page, 'verify-09-verifying');
    hold.open();
    await page.waitForSelector('.view--result .result__title', { timeout: 20_000 });
    await sleep(2600);
    const unusual = await page.getAttribute('.view--result', 'data-state');
    if (unusual !== 'SUSPICIOUS_ACTIVITY') throw new Error(`${UNUSUAL_ACTIVITY} verified as ${unusual}`);
    await shots.full(page, 'verify-10-unusual-activity');
    await page.unroute('**/api/v1/verify');

    // Invalid signature: a genuine demo payload whose signature has one flipped bit.
    const base = await codeOf(stage.db, FORGERY_BASE);
    const forged = base.data.slice();
    forged[13 + 17] ^= 0x04; // payload (13 bytes) ‖ signature (64) ‖ CRC: flip a signature bit…
    const reframed = frameCodeData(forged.subarray(0, 13), forged.subarray(13, 77)); // …and recompute the CRC
    await upload(codePhoto({ data: reframed, glyphs: base.glyphs }), 'orbes-code.png');
    await page.waitForSelector('.view--result .result__title', { timeout: 20_000 });
    await sleep(2600);
    const invalid = await page.getAttribute('.view--result', 'data-state');
    if (invalid !== 'INVALID_SIGNATURE') throw new Error(`forged code verified as ${invalid}`);
    await shots.full(page, 'verify-11-invalid-signature');
    await context.close();
  } finally {
    await plain.close();
  }
}

/**
 * The certificate-card section of an UNUSUAL ACTIVITY result: a sold, unregistered piece with a
 * claim code whose code has been scanned from many places at once (copies), so the next scan is
 * unusual from its history alone and still offers registration with the claim code. Run after the
 * console captures: the burst adds scans and an anomaly to the demo registry.
 */
async function captureVerifyCard(stage: Stage, shots: Shots): Promise<void> {
  const code = await codeOf(stage.db, CARD_SECTION);
  const data = toBase64Url(code.data);
  for (let i = 0; i < CARD_BURST; i++) {
    await stage.ctx.services.verification.verify({ code: data }, { deviceHash: `capture-copy-device-${i}`, ipHash: `capture-copy-ip-${i}`, geo: { country: 'FR' } });
  }
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await mobileContext(browser);
    const page = await context.newPage();
    watchPage(page, 'verify-card');
    await page.goto(`${stage.origin}/verify`);
    await page.waitForSelector('.landing__scan');
    await hideGrain(page);
    await page.setInputFiles('#photo-input', { name: 'orbes-code.png', mimeType: 'image/png', buffer: codePhoto(code) });
    await page.waitForSelector('.view--result .result__title', { timeout: 20_000 });
    await page.waitForSelector('.result__card .ownership .auth__switch', { timeout: 10_000 });
    await sleep(2600);
    const state = await page.getAttribute('.view--result', 'data-state');
    if (state !== 'SUSPICIOUS_ACTIVITY') throw new Error(`${CARD_SECTION} verified as ${state}`);
    await shots.full(page, 'verify-10b-unusual-activity-card');
    await context.close();
  } finally {
    await browser.close();
  }
}

/** MY PIECES (F-01): a demo owner's pieces, each on its ivory plate, signed in through the account API. */
async function captureVerifyPieces(stage: Stage, shots: Shots): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await mobileContext(browser);
    const page = await context.newPage();
    watchPage(page, 'verify-pieces');
    await page.goto(`${stage.origin}/verify`);
    await page.waitForSelector('.landing__scan');
    const status = await page.evaluate(
      async (c) => (await fetch('/api/v1/account/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) })).status,
      OWNER,
    );
    if (status !== 200) throw new Error(`${OWNER.email} could not sign in (${status})`);
    await page.goto(`${stage.origin}/verify/pieces`);
    await page.waitForSelector('article.piece .genome-svg', { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await hideGrain(page);
    await sleep(1400); // view rise (1.1 s)
    await shots.viewport(page, 'verify-12-my-pieces');
    await context.close();
  } finally {
    await browser.close();
  }
}

/**
 * The OWNERSHIP CERTIFICATE (F-06): the demo owner signs in through the account API and creates a link to a
 * certificate of a piece of theirs; a visitor without any account opens it.
 */
async function captureVerifyCertificate(stage: Stage, shots: Shots): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const owner = await mobileContext(browser);
    const page = await owner.newPage();
    watchPage(page, 'verify-certificate-owner');
    await page.goto(`${stage.origin}/verify`);
    await page.waitForSelector('.landing__scan');
    const url = await page.evaluate(async (c) => {
      const json = { 'content-type': 'application/json' };
      const login = await fetch('/api/v1/account/login', { method: 'POST', headers: json, body: JSON.stringify(c) });
      if (login.status !== 200) throw new Error(`sign-in ${login.status}`);
      const { csrfToken } = (await login.json()) as { csrfToken: string };
      const { products } = (await (await fetch('/api/v1/account/products')).json()) as { products: { productId: string; incident: string | null }[] };
      const piece = products.find((p) => p.incident === null);
      if (!piece) throw new Error('no piece to certify');
      const res = await fetch('/api/v1/ownership/certificates', { method: 'POST', headers: { ...json, 'x-csrf-token': csrfToken }, body: JSON.stringify({ productId: piece.productId, validDays: 90 }) });
      if (res.status !== 201) throw new Error(`certificate ${res.status}`);
      return ((await res.json()) as { url: string }).url;
    }, OWNER);
    await owner.close();

    const visitor = await mobileContext(browser);
    const view = await visitor.newPage();
    watchPage(view, 'verify-certificate');
    await view.goto(url);
    await view.waitForSelector('.certificate__plate .genome-svg', { timeout: 20_000 });
    await view.evaluate(() => document.fonts.ready);
    await hideGrain(view);
    await sleep(600);
    await shots.full(view, 'verify-13-ownership-certificate');
    await visitor.close();
  } finally {
    await browser.close();
  }
}

// ── Admin console ──────────────────────────────────────────────────────────

async function captureAdmin(stage: Stage, shots: Shots): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { ...DESKTOP }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Paris' });
    const page = await context.newPage();
    watchPage(page, 'admin');
    await page.goto(`${stage.origin}/admin`);
    await page.waitForSelector('[data-testid=login-form]');
    await page.fill('input[name=email]', ADMIN.email);
    await page.fill('input[name=password]', ADMIN.password);
    await page.click('[data-testid=login-submit]');
    await page.waitForSelector('.view--dashboard');
    await page.evaluate(() => document.fonts.ready);
    await sleep(1800); // bar fills (1.4 s)
    await shots.viewport(page, 'admin-01-dashboard');

    await page.goto(`${stage.origin}/admin#/products/${FIRST_REGISTRATION}`);
    await page.waitForSelector('.view--product [data-testid=product-sheet]');
    await sleep(900);
    await shots.viewport(page, 'admin-02-product');

    await page.goto(`${stage.origin}/admin#/generator`);
    await page.waitForSelector('[data-testid=issue-form]');
    await page.selectOption('select[name=categoryCode]', 'J');
    const model = await page.$eval('select[name=modelId]', (s) => [...(s as HTMLSelectElement).options].find((o) => o.textContent?.includes('MNL-RG'))?.value ?? '');
    if (model) await page.selectOption('select[name=modelId]', model);
    await page.fill('input[name=variant]', '52');
    await page.fill('input[name=productionBatch]', 'B-2026-10-A');
    await page.click('[data-testid=issue-submit]');
    await page.waitForSelector('[data-testid=claim-code]', { timeout: 20_000 });
    // The claim code is a one-time secret: hide it with the console's own control before capture.
    await page.getByRole('button', { name: 'I have recorded it — hide' }).click();
    await page.waitForSelector('[data-testid=code-figure]');
    await page.mouse.move(0, 0);
    await sleep(900);
    await shots.full(page, 'admin-03-generator-result');

    // Cases (C-02): the demo customers' answers to WHERE DID YOU SEE OR BUY THIS PIECE?
    await page.goto(`${stage.origin}/admin#/cases`);
    await page.waitForSelector('.view--cases [data-testid=case-where]');
    await sleep(900);
    await shots.viewport(page, 'admin-04-cases');

    // Analytics (A-09): the daily statistics the demo seed counted, as housekeeping does every night.
    await page.goto(`${stage.origin}/admin#/analytics?days=30`);
    await page.waitForSelector('.view--analytics [data-testid=analytics-trend]');
    await sleep(1200);
    await shots.full(page, 'admin-05-analytics');

    // The owner sheet (A-06) of the demo owner whose pieces MY PIECES shows.
    const owner = await stage.db.selectFrom('accounts').select('id').where('email_normalized', '=', OWNER.email).executeTakeFirstOrThrow();
    await page.goto(`${stage.origin}/admin#/owners/${owner.id}`);
    await page.waitForSelector('.view--owner [data-testid=owner-scan]');
    await sleep(900);
    await shots.viewport(page, 'admin-06-owner');

    // Team (A-02, A-08): the bootstrap ADMIN and the two staff accounts of addStaff.
    await page.goto(`${stage.origin}/admin#/team`);
    await page.waitForSelector(`[data-testid=admin-users] tr:has-text("${OPERATOR_EMAIL}")`);
    await sleep(900);
    await shots.viewport(page, 'admin-07-team');
    await context.close();
  } finally {
    await browser.close();
  }
}

/**
 * Two staff accounts for the Team page, through the auth service as the console and the shell create them:
 * an OPERATOR from the Team page (a temporary password, never used here) and a RETAIL seller with a known
 * password (as `scripts/admin.ts create` makes one), who signs in to the sale mode.
 */
async function addStaff(stage: Stage): Promise<void> {
  const actor = systemActor('capture-ui');
  await stage.ctx.services.auth.createStaff({ email: OPERATOR_EMAIL, role: 'OPERATOR' }, actor);
  await stage.ctx.services.auth.createAdmin({ ...SELLER, role: 'RETAIL' }, actor);
}

/**
 * The sale mode (A-08) on the seller's phone: signed in as RETAIL, the Paris boutique chosen, an in-stock
 * piece read from a photo through the sale view's own photo reader. Run after the console captures: the
 * lookup records a staff scan. The warranty is not started.
 */
async function captureSale(stage: Stage, shots: Shots): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await mobileContext(browser);
    const page = await context.newPage();
    watchPage(page, 'sale');
    await page.goto(`${stage.origin}/admin`);
    await page.waitForSelector('[data-testid=login-form]');
    await page.fill('input[name=email]', SELLER.email);
    await page.fill('input[name=password]', SELLER.password);
    await page.click('[data-testid=login-submit]');
    await page.waitForSelector('[data-testid=sale-shell] [data-testid=sale-retailer]');
    const boutique = await page.$eval(
      '[data-testid=sale-retailer]',
      (s, name) => [...(s as HTMLSelectElement).options].find((o) => o.textContent?.includes(name))?.value ?? '',
      SALE_BOUTIQUE,
    );
    if (!boutique) throw new Error(`no point of sale named ${SALE_BOUTIQUE}`);
    await page.selectOption('[data-testid=sale-retailer]', boutique);
    await page.setInputFiles('[data-testid=sale-photo]', { name: 'orbes-code.png', mimeType: 'image/png', buffer: codePhoto(await codeOf(stage.db, SALE_PIECE)) });
    await page.waitForSelector('[data-testid=sale-verdict]', { timeout: 20_000 });
    const verdict = (await page.textContent('[data-testid=sale-verdict]'))?.trim();
    if (verdict !== 'READY TO SELL') throw new Error(`${SALE_PIECE} reads ${verdict} in the sale mode`);
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await sleep(1200);
    await shots.full(page, 'admin-08-sale');
    await context.close();
  } finally {
    await browser.close();
  }
}

/** The FAQ of the legal pages (J-06), on the phone of verify (English: the browser's language). */
async function captureLegal(stage: Stage, shots: Shots): Promise<void> {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await mobileContext(browser);
    const page = await context.newPage();
    watchPage(page, 'legal');
    await page.goto(`${stage.origin}/legal/faq`);
    await page.waitForSelector('.legal__section');
    await page.evaluate(() => document.fonts.ready);
    await hideGrain(page);
    await sleep(600);
    await shots.viewport(page, 'legal-01-faq');
    await context.close();
  } finally {
    await browser.close();
  }
}

// ── PNG quantisation ───────────────────────────────────────────────────────
//
// Variance-split median cut to at most 256 colours, each palette entry
// snapped to the most frequent exact colour of its box (so the brand's flat
// colours, #FFFFFF, #0A0A0A, #F6F2EA, #8A1C1C, survive bit-exact), nearest-
// colour mapping without dithering, written as an 8-bit indexed PNG.

interface Entry {
  rgb: number;
  r: number;
  g: number;
  b: number;
  n: number;
}

interface Box {
  items: Entry[];
  score: number;
}

function box(items: Entry[]): Box {
  if (items.length < 2) return { items, score: 0 };
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const e of items) {
    n += e.n;
    r += e.r * e.n;
    g += e.g * e.n;
    b += e.b * e.n;
  }
  r /= n;
  g /= n;
  b /= n;
  let score = 0;
  for (const e of items) score += e.n * ((e.r - r) ** 2 + (e.g - g) ** 2 + (e.b - b) ** 2);
  return { items, score };
}

function medianCut(entries: Entry[], k: number): number[] {
  const boxes = [box(entries)];
  while (boxes.length < k) {
    let bi = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i].score > boxes[bi].score) bi = i;
    const { items, score } = boxes[bi];
    if (score <= 0) break;
    const range = (key: 'r' | 'g' | 'b') => {
      let lo = 255;
      let hi = 0;
      for (const e of items) {
        lo = Math.min(lo, e[key]);
        hi = Math.max(hi, e[key]);
      }
      return hi - lo;
    };
    const ranges = { r: range('r'), g: range('g'), b: range('b') };
    const ch = (['r', 'g', 'b'] as const).reduce((a, c) => (ranges[c] > ranges[a] ? c : a), 'r' as 'r' | 'g' | 'b');
    const sorted = [...items].sort((a, c) => a[ch] - c[ch]);
    const total = sorted.reduce((s, e) => s + e.n, 0);
    let acc = 0;
    let split = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].n;
      split = i + 1;
      if (acc >= total / 2) break;
    }
    boxes.splice(bi, 1, box(sorted.slice(0, split)), box(sorted.slice(split)));
  }
  return boxes.map((b) => b.items.reduce((m, e) => (e.n > m.n ? e : m)).rgb);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export function quantizePng(input: Buffer, maxColors = 256): Buffer {
  const img = PNG.sync.read(input);
  const { width, height, data } = img;
  const count = new Map<number, number>();
  for (let o = 0; o < data.length; o += 4) {
    const c = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  const entries: Entry[] = [...count].map(([rgb, n]) => ({ rgb, r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255, n }));
  const palette = entries.length <= maxColors ? entries.map((e) => e.rgb) : medianCut(entries, maxColors);
  const pal = palette.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const);
  const index = new Map<number, number>();
  for (const e of entries) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const d = (e.r - pal[i][0]) ** 2 + (e.g - pal[i][1]) ** 2 + (e.b - pal[i][2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
        if (d === 0) break;
      }
    }
    index.set(e.rgb, best);
  }
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    rows[row] = 0; // filter: none (best for indexed images)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rows[row + 1 + x] = index.get((data[o] << 16) | (data[o + 1] << 8) | data[o + 2])!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = Buffer.from(pal.flatMap((p) => [...p]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { out, raw } = parseArgs(process.argv.slice(2));
  const workDir = mkdtempSync(join(tmpdir(), 'orbes-capture-ui-'));
  let stage: Stage | undefined;
  try {
    stage = await startStage(workDir);
    const shots = new Shots(out, raw);
    log('verify:');
    await captureVerify(stage, shots, workDir);
    log('admin:');
    await addStaff(stage);
    await captureAdmin(stage, shots);
    log('admin, sale mode:');
    await captureSale(stage, shots);
    log('verify, certificate-card section:');
    await captureVerifyCard(stage, shots);
    log('verify, my pieces:');
    await captureVerifyPieces(stage, shots);
    log('verify, ownership certificate:');
    await captureVerifyCertificate(stage, shots);
    log('legal:');
    await captureLegal(stage, shots);
    const total = readdirSync(out)
      .filter((f) => f.endsWith('.png'))
      .reduce((s, f) => s + statSync(join(out, f)).size, 0);
    log(`${shots.written.length} screenshots in ${relative(process.cwd(), out) || '.'} — ${(total / 1024 / 1024).toFixed(2)} MB in the directory`);
  } finally {
    await stage?.close().catch(() => {});
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`capture-ui: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exitCode = 1;
});
