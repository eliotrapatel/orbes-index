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
 *   verify (390 × 844 CSS px at 2×, iPhone user agent, Europe/Paris), in NOCTURNE since its step N9
 *     NOW (the screen /verify opens on; verify-01-landing.png) · scanner (searching) · scanner (locked on the code) · result
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
 *   the LIVE RELEASE (plan of 2026-10-04, Quality bar 7; the phone of verify,
 *     last: its releases, pieces and MONOLITHE's photograph would change the
 *     other captures) · the banner · THE RELEASES with its LIVE cards ·
 *     announced at the silhouette's stage · announced, the name and the
 *     photograph revealed · the room (the closed door, READY CHECK) · the
 *     last minute (the lock turning) · the boutique board (landscape, its
 *     secret link) · T0 (the door opening, its motion held) · the line ·
 *     the turn (both rings half way) · secured (two add-ons, PAY · total) ·
 *     CONFIRMED in ivory · each edge page · the console's live board while
 *     the line runs and the page of a release planned, with its settings
 *     (1440 × 900); the engine runs on the stage, the releases and accounts
 *     made as test/support/live.ts makes them, MONOLITHE's photograph and a
 *     silhouette drawn here (monolitheSvg)
 *   LIVE RELEASE+ (plan of 2026-10-04, its Method: the screens; last: its
 *     releases, orders and pieces would change every other capture), in the
 *     order of its flow (capturePlus), plus-01 to plus-30: THE RELEASES on
 *     LIVE, then on PAST with the collector's part and count · a past release
 *     in its final state · a release announced with its rules in words and A
 *     SURPRISE IN EVERY BOX · not eligible, the releases taken part in
 *     counted · FOR SELECTED COLLECTORS · the after-room's second door, its
 *     page, its turn (the seal held half way), CONFIRMED · the question after
 *     · YOUR ORDERS at each step (RESERVED, SHIPPED with its tracking, DELIVERED,
 *     PAID) · an order's documents, its care guide open · AFTER THE RELEASES;
 *     then the console (1440 × 900): Orders (two late), an order, Atelier,
 *     Invoices, Segments, a segment, Settings, the client sheet, the
 *     Catalogue's Shopify export, a draft release's parts (the after-room,
 *     the access, the surprise, the question after), its best time to open,
 *     PUBLISH with the feasibility check's warnings; then the four printed
 *     documents: the work sheet and the packing slip as the console prints
 *     them, the invoice and the ownership certificate of an order as their
 *     PDFs read (Quick Look on macOS, pdftoppm elsewhere)
 *
 *   --only live   the LIVE RELEASE's captures alone (live-*.png), the others
 *                 left as they are
 *   --only plus   LIVE RELEASE+'s alone (plus-*.png)
 *   --only nocturne
 *                 NOCTURNE's alone (nocturne-*.png; plan NOCTURNE, N9): one or two screens per chapter of the app
 *                 (NOCTURNE_SHOTS), each a state of the parity tool on the NOCTURNE demo (the canvas's content, the
 *                 owner's photographs, a fixed clock), captured as scripts/parity.ts captures it; each variant of the
 *                 demo on a stage of its own. Run last by default, after the demo dataset's stage is left
 *   --only messages
 *                 WRITE TO ORBES CLIENT SERVICES and MESSAGES alone (messages-*-phone.png, messages-*-desk.png; plan
 *                 NEXT-NINE, CS-01): MESSAGES_SHOTS, states of the parity tool, each at a phone's and a desk's size.
 *                 Not run by default (screens for the owner's review, into --out)
 *   --only sizes
 *                 YOUR SIZES alone (sizes-*-phone.png, sizes-*-desk.png; plan NEXT-NINE, AC-01): SIZES_SHOTS, the
 *                 account sheet's view, saved, the salon's picker and REQUESTED with its size, I'LL BE THERE and the
 *                 room with the size preselected, then confirmed; each at a phone's and a desk's size. Not run by
 *                 default (screens for the owner's review, into --out)
 *   --only how
 *                 HOW RELEASES WORK alone (how-releases-work-phone.png, how-releases-work-desk.png; plan NEXT-NINE,
 *                 FT-01): the page at a phone's and a desk's size. Not run by default (screens for the owner's review)
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
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { sql } from 'kysely';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { toBase64Url } from '../src/core/bytes.js';
import { frameCodeData } from '../src/core/payload.js';
import { startLiveEngine, type AppContext } from '../src/server/context.js';
import type { Db } from '../src/server/db/connection.js';
import { DEMO_FIRST_REGISTRATION_PRODUCT_ID, DEMO_TIMELINE_START, seedDemo } from '../src/server/db/seed/demo.js';
import { AtelierService } from '../src/server/services/atelier.js';
import { AuditService } from '../src/server/services/audit.js';
import { deriveDropSeedKey, DropService } from '../src/server/services/drops.js';
import { deriveLiveTurnKey, LiveService } from '../src/server/services/live.js';
import { LiveConsoleService } from '../src/server/services/live-console.js';
import type { LiveEngine } from '../src/server/services/live-engine.js';
import { OrderService, orderReference } from '../src/server/services/orders.js';
import { SalonService } from '../src/server/services/salon.js';
import { sessionCookieName } from '../src/server/services/sessions.js';
import { defaultLocationId, ensureSku, linkDropSizes } from '../src/server/services/stock.js';
import { createManualClock, noopLogger, SYSTEM_ACTOR, systemActor, type ManualClock } from '../src/server/types.js';
import { createLiveRelease, holdPieces, type LiveFixture, type LiveReleaseOptions } from '../test/support/live.js';
import { CHROMIUM_PATH, cameraClip, codeOf, codePhoto, fullScreenshot, gate, hideGrain, MOBILE, mobileContext, sleep, startUiStage, watchPage as watchPageInto, webpOf } from '../test/support/ui-stage.js';
import { eachState } from '../test/support/nocturne-stage.js';
import { openState, ROOM_SIZE_STATES, stateById, type UiState } from '../test/support/nocturne-states.js';
import { buildWeb } from './build-web.js';
import { shoot as shootState } from './parity.js';

const GENOME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(GENOME_DIR, '..', 'docs', 'assets', 'ui');

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
const DESKTOP = { width: 1440, height: 900 } as const;

// ── CLI ────────────────────────────────────────────────────────────────────

type Only = 'live' | 'plus' | 'nocturne' | 'messages' | 'sizes' | 'how';

function parseArgs(argv: string[]): { out: string; raw: boolean; only: Only | null } {
  let out = DEFAULT_OUT;
  let raw = false;
  let only: Only | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = resolve(argv[++i] ?? '');
    else if (argv[i] === '--raw') raw = true;
    else if (argv[i] === '--only' && (argv[i + 1] === 'live' || argv[i + 1] === 'plus' || argv[i + 1] === 'nocturne' || argv[i + 1] === 'messages' || argv[i + 1] === 'sizes' || argv[i + 1] === 'how')) only = argv[++i] as Only;
    else throw new Error(`unknown argument ${argv[i]} (use --out DIR, --raw, --only live, --only plus, --only nocturne, --only messages, --only sizes, --only how)`);
  }
  return { out, raw, only };
}

const log = (line: string) => process.stdout.write(`${line}\n`);
// ── Server ─────────────────────────────────────────────────────────────────

interface Stage {
  origin: string;
  ctx: AppContext;
  db: Db;
  close(): Promise<void>;
}

/**
 * Web build + demo dataset + server (test/support/ui-stage.ts). The context clock follows the seed's manual clock while
 * seeding, then real time, so registration windows and "VERIFIED …" stamps agree with the browser's clock.
 */
async function startStage(workDir: string): Promise<Stage> {
  const webDir = join(workDir, 'web');
  const t0 = Date.now();
  await buildWeb({ outDir: webDir, mode: 'production' });
  log(`web build: ${Date.now() - t0} ms`);

  const seedClock = createManualClock(DEMO_TIMELINE_START);
  let live = false;
  const clock = () => (live ? new Date() : seedClock.now());
  const stage = await startUiStage({
    webDir,
    clock,
    config: { bootstrapAdmin: ADMIN },
    seed: async (ctx) => {
      const t1 = Date.now();
      const seeded = await seedDemo(ctx, { clock: seedClock, now: new Date(), log: noopLogger, accountPassword: OWNER.password });
      live = true;
      log(`demo dataset: ${seeded.products} products, ${seeded.scans} scans, ${seeded.anomalies.open} open anomalies (${Date.now() - t1} ms)`);
    },
  });
  log(`server: ${stage.origin}`);
  return stage;
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

  /** A picture made elsewhere (a PDF's page), saved as the others. */
  png(name: string, png: Buffer): void {
    this.save(name, png);
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
    this.save(name, await fullScreenshot(page));
  }

  /**
   * One element alone, its own box, on white paper `margin` pixels wide all round (a printed sheet and its page's
   * margin), taken with the viewport grown to the document height so no sticky bar of the page crosses it.
   */
  async element(page: Page, selector: string, name: string, margin = 0): Promise<void> {
    const size = page.viewportSize();
    if (!size) throw new Error('page has no viewport');
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (height > size.height) {
      await page.setViewportSize({ width: size.width, height });
      await sleep(400);
    }
    const shot = await page.locator(selector).first().screenshot({ type: 'png' });
    if (height > size.height) await page.setViewportSize(size);
    this.save(name, margin > 0 ? onPaper(shot, margin) : shot);
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

/** A PNG set on white paper, `margin` pixels all round. */
function onPaper(png: Buffer, margin: number): Buffer {
  const src = PNG.sync.read(png);
  const out = new PNG({ width: src.width + 2 * margin, height: src.height + 2 * margin });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, 0, src.width, src.height, margin, margin);
  return PNG.sync.write(out);
}

/** Log a page's errors under `label` (ui-stage.ts watchPage, into this script's log). */
const watchPage = (page: Page, label: string): void => watchPageInto(page, label, log);

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
    await page.waitForSelector('.view--result .n-result__title', { timeout: 20_000 });
    await sleep(2600); // staggered rise of the result blocks
    await page.waitForSelector('.n-own .n-own__switch, .n-own form', { timeout: 10_000 });
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
      await shots.region(page, '.n-result__tabs', name);
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
    await page.waitForFunction(() => document.querySelector('.view--verifying .n-cam__line')?.textContent === 'VERIFYING…', null, { timeout: 20_000 });
    await sleep(1300); // view rise (1.1 s)
    await shots.viewport(page, 'verify-09-verifying');
    hold.open();
    await page.waitForSelector('.view--result .n-result__title', { timeout: 20_000 });
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
    await page.waitForSelector('.view--result .n-result__title', { timeout: 20_000 });
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
    await page.waitForSelector('.view--result .n-result__title', { timeout: 20_000 });
    await page.waitForSelector('.n-result__card .n-own .n-own__switch', { timeout: 10_000 });
    await sleep(2600);
    const state = await page.getAttribute('.view--result', 'data-state');
    if (state !== 'SUSPICIOUS_ACTIVITY') throw new Error(`${CARD_SECTION} verified as ${state}`);
    await shots.full(page, 'verify-10b-unusual-activity-card');
    await context.close();
  } finally {
    await browser.close();
  }
}

/** MY PIECES (F-01): a demo owner's pieces, each on its model's photograph (NOCTURNE, C3), signed in through the account API. */
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
    await page.waitForSelector('.view--pieces article.n-pieces__piece', { timeout: 20_000 });
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

// ── The LIVE RELEASE ───────────────────────────────────────────────────────

/** Wait until `test` holds (polled every 100 ms), or fail with `what`. */
async function until(what: string, test: () => Promise<boolean> | boolean, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** The text of the first element of `selector` once it is `expected` (spaces folded). */
async function untilText(page: Page, selector: string, expected: string | RegExp, timeoutMs = 60_000): Promise<void> {
  const ok = (t: string) => (typeof expected === 'string' ? t === expected : expected.test(t));
  await until(`${selector} to read ${String(expected)}`, async () => ok(((await page.locator(selector).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()), timeoutMs);
}

/**
 * MONOLITHE as the captures show it once revealed (a studio picture of the ring standing in for ORBES's photograph,
 * transparent around the piece so the light sweep follows its shape), or as its silhouette: the same ring, backlit, its
 * form alone. A wide band of polished silver seen from above, an orbit cut around it; drawn as SVG.
 */
function monolitheSvg(kind: 'photo' | 'silhouette'): string {
  const cx = 500;
  const [R, r, k, top, H] = [330, 282, 0.4, 380, 160];
  const bot = top + H;
  const mid = top + H * 0.52;
  const [Ry, ry] = [R * k, r * k];
  /** The band's outline: the top ellipse's far half, the sides, the bottom ellipse's near half. */
  const outline = `M${cx - R},${top} A${R},${Ry} 0 0 1 ${cx + R},${top} L${cx + R},${bot} A${R},${Ry} 0 0 1 ${cx - R},${bot} Z`;
  /** The outer wall facing the camera. */
  const front = `M${cx - R},${top} L${cx - R},${bot} A${R},${Ry} 0 0 0 ${cx + R},${bot} L${cx + R},${top} A${R},${Ry} 0 0 1 ${cx - R},${top} Z`;
  const ellipse = (rx: number, ey: number, y: number) => `M${cx - rx},${y} A${rx},${ey} 0 1 0 ${cx + rx},${y} A${rx},${ey} 0 1 0 ${cx - rx},${y} Z`;
  const nearArc = (rx: number, ey: number, y: number) => `M${cx - rx},${y} A${rx},${ey} 0 0 0 ${cx + rx},${y}`;
  const farArc = (rx: number, ey: number, y: number) => `M${cx - rx},${y} A${rx},${ey} 0 0 1 ${cx + rx},${y}`;
  const stops = (list: [number, string][]) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="1320" height="896" viewBox="60 168 880 597">`;
  if (kind === 'silhouette') {
    return (
      head +
      `<defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#2a2825'], [1, '#100f0e']])}</linearGradient>` +
      `<filter id="halo" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="16"/></filter></defs>` +
      `<path d="${outline}" fill="#f6f2ea" opacity="0.28" filter="url(#halo)"/>` +
      `<path d="${outline}" fill="url(#body)"/>` +
      `<path d="${ellipse(r, ry, top)}" fill="#080808"/>` +
      `<path d="${outline}" fill="none" stroke="#f6f2ea" stroke-opacity="0.62" stroke-width="1.8"/>` +
      `<path d="${ellipse(r, ry, top)}" fill="none" stroke="#f6f2ea" stroke-opacity="0.22" stroke-width="1.2"/>` +
      `</svg>`
    );
  }
  return (
    head +
    `<defs>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="1" y2="0">${stops([[0, '#1b1a19'], [0.05, '#4a4844'], [0.14, '#b7b3ac'], [0.22, '#f1eee8'], [0.29, '#8e8a84'], [0.4, '#3a3835'], [0.53, '#6b6863'], [0.66, '#d6d2cb'], [0.73, '#fbf9f5'], [0.8, '#a29e97'], [0.9, '#3c3a37'], [1, '#161514']])}</linearGradient>` +
    `<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.1"/><stop offset="0.4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.42"/></linearGradient>` +
    `<linearGradient id="face" x1="0" y1="0" x2="1" y2="0">${stops([[0, '#6c6964'], [0.24, '#ebe8e2'], [0.5, '#a5a19a'], [0.76, '#f3f0ea'], [1, '#64615c']])}</linearGradient>` +
    `<linearGradient id="inside" x1="0" y1="0" x2="1" y2="0">${stops([[0, '#252321'], [0.18, '#6f6b65'], [0.33, '#c4c0b9'], [0.5, '#4f4c48'], [0.67, '#b0aca5'], [0.82, '#66625d'], [1, '#201f1d']])}</linearGradient>` +
    `<linearGradient id="depth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.62"/><stop offset="0.65" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `<filter id="blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>` +
    `</defs>` +
    `<ellipse cx="${cx}" cy="${bot + 16}" rx="${R * 0.94}" ry="${Ry * 0.5}" fill="#000" opacity="0.42" filter="url(#blur)"/>` +
    `<path d="${ellipse(r, ry, top)}" fill="url(#inside)"/>` +
    `<path d="${ellipse(r, ry, top)}" fill="url(#depth)"/>` +
    `<path d="${front}" fill="url(#wall)"/>` +
    `<path d="${front}" fill="url(#shade)"/>` +
    `<path d="${nearArc(R, Ry, mid)}" fill="none" stroke="#141312" stroke-opacity="0.55" stroke-width="2.2"/>` +
    `<path d="${nearArc(R, Ry, mid + 2.6)}" fill="none" stroke="#fff" stroke-opacity="0.32" stroke-width="1"/>` +
    `<path d="${ellipse(R, Ry, top)} ${ellipse(r, ry, top)}" fill="url(#face)" fill-rule="evenodd"/>` +
    `<path d="${farArc(R, Ry, top)}" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="1.2"/>` +
    `<path d="${nearArc(R, Ry, top)}" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="1.4"/>` +
    `<path d="${nearArc(r, ry, top)}" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="1.6"/>` +
    `<path d="${nearArc(R, Ry, bot)}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="2"/>` +
    `</svg>`
  );
}

/**
 * The transitions and animations of `selector`'s subtree (the door, the lock, the light) held at `ms` from their start,
 * so a moment of a motion is photographed as it is drawn (their number returned); resumeMotion plays them on.
 */
async function holdMotion(page: Page, selector: string, ms: number): Promise<number> {
  return page.evaluate(
    ([sel, at]) => {
      const root = document.querySelector(sel);
      // The styles brought up to date first: a transition begins with the style change that starts it.
      for (const el of root ? [root, ...root.querySelectorAll('*')] : []) getComputedStyle(el).opacity;
      const motions = root?.getAnimations({ subtree: true }) ?? [];
      for (const a of motions) {
        a.pause();
        a.currentTime = at;
      }
      return motions.length;
    },
    [selector, ms] as const,
  );
}

async function resumeMotion(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    for (const a of document.querySelector(sel)?.getAnimations({ subtree: true }) ?? []) a.play();
  }, selector);
}

/**
 * The LIVE suites' fixture (test/support/live.ts) on the stage: the console's bootstrap ADMIN, the keys as the context
 * derives them, the releases made on the demo's MONOLITHE; the stage's own services, or services on a clock of their
 * own (`clock`) over the same database, for what happened days ago. No model is added: the Catalogue keeps the demo's.
 */
async function stageFixture(stage: Stage, clock?: ManualClock): Promise<LiveFixture> {
  const { ctx, db } = stage;
  const adminId = (await db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow()).id;
  const modelId = (await db.selectFrom('models').select('id').where('sku_prefix', '=', 'MNL-RG').executeTakeFirstOrThrow()).id;
  const seedKey = deriveDropSeedKey(ctx.config);
  const turnKey = deriveLiveTurnKey(ctx.config);
  const base = { db, seedKey, turnKey, admin: { type: 'admin' as const, id: adminId }, modelId };
  if (!clock) return { ...base, clock: createManualClock(new Date()), audit: ctx.audit, drops: ctx.services.drops, live: ctx.services.live, liveConsole: ctx.services.liveConsole };
  const audit = new AuditService({ db, clock: clock.now });
  return {
    ...base,
    clock,
    audit,
    drops: new DropService({ db, audit, seedKey, clock: clock.now }),
    live: new LiveService({ db, audit, seedKey, turnKey, clock: clock.now }),
    liveConsole: new LiveConsoleService({ db, audit, seedKey, publicOrigin: ctx.config.publicOrigin, clock: clock.now }),
  };
}

/**
 * Every state of the vault (plan of 2026-10-04, Quality bar 7), on the phone of verify, with the live engine running:
 * the releases and accounts are made as the LIVE suites make them (test/support/live.ts), on the demo's MONOLITHE, its
 * photograph and a release's silhouette drawn by monolitheSvg. Run last: its pieces, entries and the model's photograph
 * would change the other captures.
 */
async function captureLive(stage: Stage, shots: Shots): Promise<void> {
  const { ctx, db, origin } = stage;
  const engine: LiveEngine = startLiveEngine(ctx, { connection: 'shared' });
  const f: LiveFixture = await stageFixture(stage);
  const monolithe = (await db.selectFrom('models').select('id').where('sku_prefix', '=', 'MNL-RG').executeTakeFirstOrThrow()).id;
  let n = 0;
  /** An ORBES account holding `pieces` pieces of MONOLITHE (its tier: 1 TITANE, 5 PLATINE, 10 PALLADIUM), signed in. */
  const account = async (pieces: number) => {
    const { account: a, session } = await ctx.services.auth.registerAccount({ email: `collector.${++n}@example.com`, password: 'capture-ui-live-password' }, {});
    if (pieces > 0) await holdPieces(db, a.id, pieces, monolithe);
    return { id: a.id, token: session.token, actor: { type: 'account' as const, id: a.id } };
  };
  const release = async (o: Partial<LiveReleaseOptions> & { opensAt: Date }) => {
    const r = await createLiveRelease(f, { modelId: monolithe, priceMinor: 505_000, ...o });
    await db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    return r;
  };
  const statusOf = async (dropId: string, accountId: string) =>
    (await db.selectFrom('live_entries').select('status').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst())?.status ?? null;
  const untilStatus = (dropId: string, accountId: string, status: string) => until(`an entry ${status}`, async () => (await statusOf(dropId, accountId)) === status);
  const entryOf = async (dropId: string, accountId: string) => (await db.selectFrom('live_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirstOrThrow()).id;
  /** Another phone's turn: pressed, held 1.5 s, secured, then confirmed when asked. */
  const secureAs = async (dropId: string, a: { id: string; actor: { type: 'account'; id: string } }, confirm: boolean) => {
    await untilStatus(dropId, a.id, 'TURN');
    const token = (await ctx.services.liveRoom.viewerEntries(dropId, [a.id])).get(a.id)!.turn!.token!;
    await ctx.services.live.press(a.id, dropId, token);
    await sleep(1_500);
    await ctx.services.live.secure(a.id, dropId, token, a.actor);
    if (confirm) await ctx.services.live.confirm(a.id, dropId, a.actor);
  };

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  /** The phone of verify, signed in as `token` when given (its session cookie, as the sign-in sets it). */
  const phone = async (token: string | null, label: string) => {
    const context = await mobileContext(browser);
    if (token) await context.addCookies([{ name: sessionCookieName(ctx.config, 'account'), value: token, url: origin }]);
    const page = await context.newPage();
    watchPage(page, label);
    return { context, page };
  };
  /** A page of the vault at rest: its fonts in, the grain hidden, its screen risen. */
  const settle = async (page: Page, ms = 1_200) => {
    await page.evaluate(() => document.fonts.ready);
    await hideGrain(page);
    await sleep(ms);
  };
  /** The phone's viewport grown to the whole page, at its top: a moment in motion is then photographed whole at once. */
  const wholePage = async (page: Page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width: MOBILE.width, height: Math.max(MOBILE.height, height) });
    await sleep(300);
  };
  try {
    // MONOLITHE photographed (ORBES's picture of the model, revealed at a release's photograph stage).
    await ctx.services.media.setModelImage(monolithe, { mime: 'image/webp', bytes: await webpOf(browser, monolitheSvg('photo')) }, SYSTEM_ACTOR);
    const silhouette = await webpOf(browser, monolitheSvg('silhouette'));

    // The collectors: one who will be there (PLATINE), one ahead of her at T0 (PALLADIUM), the room and the interest
    // (the fourth of the crowd holds no piece: in neither).
    const me = await account(5);
    const rival = await account(10);
    const crowd = await Promise.all([5, 5, 10, 0, 10, 5].map((p) => account(p)));
    const day = 86_400_000;

    // Announced, opening in 2 h 14 min, every stage revealed: I'LL BE THERE counted. The banner counts down to it.
    const later = await release({
      opensAt: new Date(Date.now() + (2 * 3600 + 14 * 60 + 12) * 1000),
      minTier: 2,
      sizes: [{ label: '50', stock: 8 }, { label: '52', stock: 9 }, { label: '54', stock: 8 }],
      quantityLine: '25 PIECES',
      addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
    });
    for (const [i, c] of crowd.entries()) if (i !== 3) await ctx.services.live.setInterest(c.id, later.id, later.sizes[i % 3]!.id, c.actor);
    // Announced in three days, at its silhouette's stage: the name tomorrow, the photograph the day after.
    const veiled = await release({ opensAt: new Date(Date.now() + 3 * day + 6 * 3600_000), minTier: 1, sizes: [{ label: '50', stock: 6 }, { label: '52', stock: 6 }, { label: '54', stock: 6 }], quantityLine: '18 PIECES', published: false });
    await ctx.services.media.setLiveSilhouette(veiled.id, { mime: 'image/webp', bytes: silhouette }, f.admin);
    await db
      .updateTable('drops')
      .set({ name_at: new Date(Date.now() + day), photo_at: new Date(Date.now() + 2 * day), published_at: new Date() })
      .where('id', '=', veiled.id)
      .execute();
    // Planned, announced tomorrow: its settings, every part editable in the console until then.
    const planned = await release({
      opensAt: new Date(Date.now() + 9 * day),
      announceAt: new Date(Date.now() + day),
      minTier: 1,
      sizes: [{ label: '48', stock: 4 }, { label: '50', stock: 7 }, { label: '52', stock: 8 }, { label: '54', stock: 6 }],
      quantityLine: '25 PIECES · NEVER MORE',
      perAccount: 1,
      windows: [{ tier: 3, payMinutes: 10 }],
      addons: [
        { label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 },
        { label: 'GIFT BOX', priceMinor: 9_000 },
        { label: 'ORBES CARE', line: 'Two years of care in the atelier', priceMinor: 12_000 },
      ],
    });
    await ctx.services.media.setLiveSilhouette(planned.id, { mime: 'image/webp', bytes: silhouette }, f.admin);
    await db.updateTable('drops').set({ silhouette_at: new Date(Date.now() + 2 * day), name_at: new Date(Date.now() + 4 * day), photo_at: new Date(Date.now() + 6 * day) }).where('id', '=', planned.id).execute();

    // The banner is MY PIECES' (NOCTURNE N3: on NOW, the release leads the page itself).
    const { context: landing, page: home } = await phone(null, 'live-banner');
    await home.goto(`${origin}/verify/pieces`);
    await home.waitForSelector('a.live-banner');
    await settle(home, 3_200);
    await shots.viewport(home, 'live-01-banner');
    await landing.close();

    // The console, signed in now (the bootstrap ADMIN, 1440 × 900): its live board is photographed while the line runs.
    const desk = await browser.newContext({ viewport: { ...DESKTOP }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Paris' });
    const admin = await desk.newPage();
    watchPage(admin, 'live-console');
    await admin.goto(`${origin}/admin`);
    await admin.waitForSelector('[data-testid=login-form]');
    await admin.fill('input[name=email]', ADMIN.email);
    await admin.fill('input[name=password]', ADMIN.password);
    await admin.click('[data-testid=login-submit]');
    await admin.waitForSelector('.view--dashboard');

    // The release lived through: its room open now, T0 on the minute at least 100 s ahead; 25 pieces, one in size 52.
    const t0 = new Date(Math.ceil((Date.now() + 100_000) / 60_000) * 60_000);
    const r = await release({
      opensAt: t0,
      minTier: 1,
      sizes: [{ label: '50', stock: 12 }, { label: '52', stock: 1 }, { label: '54', stock: 12 }],
      quantityLine: '25 PIECES',
      addons: [
        { label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 },
        { label: 'GIFT BOX', priceMinor: 9_000 },
        { label: 'ORBES CARE', line: 'Two years of care in the atelier', priceMinor: 12_000 },
      ],
    });
    const [s50, s52, s54] = r.sizes;
    await ctx.services.live.enter(rival.id, r.id, { sizeId: s52!.id }, rival.actor);
    for (const [i, c] of crowd.entries()) if (i !== 3) await ctx.services.live.enter(c.id, r.id, { sizeId: (i % 2 ? s50 : s54)!.id }, c.actor);
    await ctx.services.live.setInterest(me.id, r.id, s52!.id, me.actor);
    await ctx.services.live.message(r.id, 'Welcome to the vault. The door opens at the hour.', f.admin);
    const { token: boardToken } = await f.live.issueBoardLink(r.id, f.admin);

    const { context, page } = await phone(me.token, 'live');
    // THE RELEASES: the LIVE cards first, on the vault's plates.
    await page.goto(`${origin}/verify/releases`);
    await page.waitForSelector('article.live-card');
    await settle(page);
    await shots.full(page, 'live-02-releases');
    // B1: announced, at the silhouette's stage (the name and the photograph still to come).
    await page.goto(`${origin}/verify/releases/${veiled.id}`);
    await page.waitForSelector('.n-live__photo--silhouette img');
    await settle(page);
    await shots.full(page, 'live-03-announced-silhouette');
    // B1: announced, the name and the photograph revealed, a size chosen for I'LL BE THERE.
    await page.goto(`${origin}/verify/releases/${later.id}`);
    await page.waitForSelector('.n-live__photo:not(.n-live__photo--silhouette) img');
    await page.waitForSelector('.n-live__there');
    await page.locator('.n-live__there').locator('button.live__size', { hasText: /^52$/ }).click();
    await page.mouse.move(0, 0);
    await settle(page);
    await shots.full(page, 'live-04-announced');
    // B2: the room, the door closed, READY CHECK all ready, the size of I'LL BE THERE preselected.
    await page.goto(`${origin}/verify/releases/${r.id}`);
    await page.waitForSelector('.live-door .live-door__seal');
    await until('READY CHECK', async () => (await page.locator('.live__check').allInnerTexts()).filter((t) => /ready$/i.test(t.trim())).length === 5);
    await settle(page);
    if (t0.getTime() - Date.now() < 62_000) throw new Error('the room was reached inside its last minute: start again');
    await shots.full(page, 'live-05-room');

    // Entered; the last minute: the lock's orbits turning back into alignment, half way.
    await page.getByRole('button', { name: 'ENTER THE ROOM' }).click();
    await untilStatus(r.id, me.id, 'WAITING');
    await page.mouse.move(0, 0);
    await until('the last minute', () => t0.getTime() - Date.now() <= 31_000, 180_000);
    await settle(page, 300);
    await shots.full(page, 'live-06-last-minute');

    // The boutique board, by its secret link, landscape, in the same last minute.
    const screen = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'no-preference' });
    const board = await screen.newPage();
    watchPage(board, 'live-board');
    await board.goto(`${origin}/verify/releases/${r.id}/board#${boardToken}`);
    await board.waitForSelector('.board__door .live-door__seal');
    await settle(board);
    await shots.viewport(board, 'live-07-board');
    await screen.close();

    // T0: the lock aligned, the door opening on the piece, held at 480 ms of its motion.
    await page.waitForFunction(() => document.querySelector('.live-door')?.classList.contains('is-open') === true, null, { timeout: 60_000, polling: 'raf' });
    if ((await holdMotion(page, '.live-door', 480)) === 0) throw new Error('the door opened without its motion');
    await wholePage(page);
    await shots.viewport(page, 'live-08-door-opening');
    await resumeMotion(page, '.live-door');
    await page.setViewportSize({ ...MOBILE });

    // The room at work: three of the crowd secure their piece, two confirm it.
    await Promise.all([secureAs(r.id, crowd[0]!, true), secureAs(r.id, crowd[1]!, false), secureAs(r.id, crowd[2]!, true)]);
    // B3: the line, the rival's turn in size 52 ahead.
    await untilText(page, '.live__ahead', 'YOU ARE NEXT IN SIZE 52');
    await settle(page, 900);
    await shots.full(page, 'live-09-line');
    // The console's live board of the release at that moment, its first screen.
    await admin.evaluate((hash) => (location.hash = hash), `#/club/live/${r.id}`);
    await admin.waitForSelector('[data-testid=live-board-state]');
    await until('the live board', async () => /LIVE/.test((await admin.locator('[data-testid=live-state]').textContent()) ?? ''), 20_000);
    await admin.evaluate(() => document.fonts.ready);
    await admin.mouse.move(0, 0);
    await sleep(1_500);
    await shots.viewport(admin, 'live-23-console-board');

    // B4: a piece has returned, the collector's turn; at half its time, the seal held half way.
    await ctx.services.live.leave(rival.id, r.id, rival.actor);
    await untilText(page, '.live__turn > .live__overline', 'A PIECE HAS RETURNED');
    await settle(page, 300);
    await wholePage(page);
    await untilText(page, '.live__turn-left', '00:15', 30_000);
    const box = (await page.locator('.live-hold').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(700);
    await shots.viewport(page, 'live-10-turn');
    await sleep(1_400);
    await page.mouse.up();
    await page.setViewportSize({ ...MOBILE });
    // B5: the reveal, then the add-ons and PAY with its total.
    await untilText(page, '.live__secured > .live__overline', 'SECURED');
    await sleep(2_600);
    await page.getByRole('button', { name: /ENGRAVING/ }).click();
    await page.getByRole('button', { name: /ORBES CARE/ }).click();
    await page.mouse.move(0, 0);
    await settle(page, 600);
    await shots.full(page, 'live-11-secured');
    // B6: CONFIRMED, out into the light.
    await page.locator('.live__pay').click();
    await untilText(page, 'h1', 'CONFIRMED');
    await settle(page, 1_600);
    await shots.full(page, 'live-12-confirmed');
    await context.close();

    // The edge pages, each with its one action.
    const edge = await release({ opensAt: new Date(Date.now() + 3_000), minTier: 1, sizes: [{ label: '50', stock: 5 }, { label: '52', stock: 1 }], turnSeconds: 60 });
    const ended = await release({ opensAt: new Date(Date.now() + 3_000), sizes: [{ label: '50', stock: 1 }], quantityLine: '1 PIECE', turnSeconds: 300 });
    await sleep(3_500);
    const [e50, e52] = edge.sizes;
    const enter = async (dropId: string, sizeId: string, pieces = 1) => {
      const a = await account(pieces);
      await ctx.services.live.enter(a.id, dropId, { sizeId }, a.actor);
      return a;
    };
    const left = await enter(edge.id, e50!.id);
    await untilStatus(edge.id, left.id, 'TURN');
    await ctx.services.live.leave(left.id, edge.id, left.actor);
    const removed = await enter(edge.id, e50!.id);
    await ctx.services.live.remove(edge.id, await entryOf(edge.id, removed.id), f.admin);
    const missed = await enter(edge.id, e50!.id);
    await untilStatus(edge.id, missed.id, 'TURN');
    // Its turn's deadline brought to a moment after it began: the engine marks it missed.
    await db.updateTable('live_entries').set({ turn_expires_at: sql<Date>`turn_at + interval '1 millisecond'` }).where('drop_id', '=', edge.id).where('account_id', '=', missed.id).execute();
    await untilStatus(edge.id, missed.id, 'MISSED');
    const expired = await enter(edge.id, e50!.id);
    await secureAs(edge.id, expired, false);
    await ctx.services.live.freeHold(edge.id, await entryOf(edge.id, expired.id), f.admin);
    const released = await enter(edge.id, e50!.id);
    await secureAs(edge.id, released, false);
    await ctx.services.live.release(released.id, edge.id, released.actor);
    // Sold out in size 52 for a collector in the line behind its one piece, confirmed by another.
    const buyer = await enter(edge.id, e52!.id);
    await untilStatus(edge.id, buyer.id, 'TURN');
    const late = await enter(edge.id, e52!.id);
    await secureAs(edge.id, buyer, true);
    // Closed at its time before a turn came, the first collector's turn still running (the page whole): the one waiting
    // reads that it has closed; a collector without an entry its final state (plan LIVE RELEASE+, decision 30).
    const first = await enter(ended.id, ended.sizes[0]!.id);
    await untilStatus(ended.id, first.id, 'TURN');
    const waiting = await enter(ended.id, ended.sizes[0]!.id);
    await ctx.db.updateTable('drops').set({ closes_at: new Date() }).where('id', '=', ended.id).execute();
    await untilStatus(ended.id, waiting.id, 'ENDED');
    const outsider = await account(0);
    const nobody = await account(1);
    const pages: [string, string | null, string][] = [
      ['live-13-edge-sign-in', null, edge.id],
      ['live-14-edge-not-eligible', outsider.token, edge.id],
      ['live-15-edge-turn-passed', missed.token, edge.id],
      ['live-16-edge-hold-ended', expired.token, edge.id],
      ['live-17-edge-released', released.token, edge.id],
      ['live-18-edge-left', left.token, edge.id],
      ['live-19-edge-removed', removed.token, edge.id],
      ['live-20-edge-sold-out', late.token, edge.id],
      ['live-21-edge-ended', waiting.token, ended.id],
      ['live-22-edge-over', nobody.token, ended.id],
    ];
    for (const [name, token, dropId] of pages) {
      const { context: c, page: p } = await phone(token, name);
      await p.goto(`${origin}/verify/releases/${dropId}`);
      await p.waitForSelector('.live__edge h1, .n-live__end h1, .n-live__past h1');
      await settle(p);
      await shots.full(p, name);
      await c.close();
    }

    // The console's page of the release planned, announced tomorrow, whole: its publication, its planner and forecast, then
    // its settings, each part with its Edit, the silhouette and the board's link.
    await admin.evaluate((hash) => (location.hash = hash), `#/club/live/${planned.id}`);
    await admin.waitForSelector('#live-part-silhouette');
    await admin.evaluate(() => document.fonts.ready);
    await admin.mouse.move(0, 0);
    await sleep(1_200);
    await shots.full(admin, 'live-24-console-settings');
    await desk.close();
  } finally {
    await browser.close();
    await engine.stop();
  }
}

// ── LIVE RELEASE+ ──────────────────────────────────────────────────────────

/**
 * A PDF's first page as a PNG, drawn by the system's own reader (the file the server sent, as a reader shows it):
 * Quick Look on macOS, Poppler's pdftoppm elsewhere, both at A4's 1 684 pixels high (144 dpi).
 */
function pdfFirstPage(pdf: Uint8Array | string, workDir: string, name: string): Buffer {
  const file = join(workDir, `${name}.pdf`);
  writeFileSync(file, pdf);
  if (process.platform === 'darwin') {
    execFileSync('qlmanage', ['-t', '-s', '1684', '-o', workDir, file], { stdio: 'ignore' });
    return readFileSync(`${file}.png`);
  }
  execFileSync('pdftoppm', ['-png', '-r', '144', '-singlefile', file, join(workDir, name)], { stdio: 'ignore' });
  return readFileSync(join(workDir, `${name}.png`));
}

/**
 * Every new state of LIVE RELEASE+ (plan of 2026-10-04, its Method: the screens; the LIVE RELEASE's Quality bar 7), in
 * the order of its flow: the collector's screens on the phone of verify (the ivory of THE RELEASES, the vault, then MY
 * PIECES), the console's new pages (1 440 × 900), then the four printed documents, black on white.
 *
 * One collector, Hélène Morel (PLATINE, five pieces of MONOLITHE), lived through the releases of the last days on
 * services of their own clock over the stage's database (test/support/live.ts liveFixture, as test/web/verify.orders.e2e
 * does), ORBES Client Services and the atelier following her orders on that clock too: the draw (her place confirmed,
 * then paid: PAID, its piece being made), LIVE I (her piece secured, paid, made at the atelier, shipped by Colissimo and
 * registered by her today: DELIVERED), a request of the private salon accepted (an ORBITE paid, made and shipped by
 * Chronopost: SHIPPED), LIVE II (in the line at the sell-out: the question after on its final page), LIVE III (I'LL BE
 * THERE, never came: the question in MY PIECES). Today, with the live engine running: LIVE IV sells out and its
 * after-room opens its second door a minute later, where she secures an ORBITE (RESERVED); LIVE V is announced for the
 * selected collectors or those who have taken part in three releases, with a surprise in every box; a release for the
 * selected collectors alone has its room open; LIVE VI is a draft with every part of LIVE RELEASE+ set, its stock at a
 * location that holds none of its sizes (the feasibility check's warnings). Run last: its releases, orders and pieces
 * would change the other captures.
 */
async function capturePlus(stage: Stage, shots: Shots, workDir: string): Promise<void> {
  const { ctx, db, origin } = stage;
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const MINUTE = 60_000;
  const modelOf = async (prefix: string) => (await db.selectFrom('models').select('id').where('sku_prefix', '=', prefix).executeTakeFirstOrThrow()).id;
  const monolithe = await modelOf('MNL-RG');
  const orbite = await modelOf('ORB-SG');
  /** `hour`:00 in Paris, `days` from today (summer or winter time read from the zone itself). */
  const parisAt = (days: number, hour: number): Date => {
    const day = new Date(Date.now() + days * DAY).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const asUtc = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
    const offset = Date.parse(asUtc.toLocaleString('en-US', { timeZone: 'Europe/Paris' })) - Date.parse(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(asUtc.getTime() - offset);
  };
  let engine: LiveEngine | null = null;
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    await ctx.services.media.setModelImage(monolithe, { mime: 'image/webp', bytes: await webpOf(browser, monolitheSvg('photo')) }, SYSTEM_ACTOR);

    // ── The collectors ──
    const account = async (email: string, pieces: number) => {
      const { account: a, session } = await ctx.services.auth.registerAccount({ email, password: 'capture-ui-plus-password' }, {});
      if (pieces > 0) await holdPieces(db, a.id, pieces, monolithe);
      return { id: a.id, token: session.token, actor: { type: 'account' as const, id: a.id } };
    };
    const me = await account('helene.morel@example.com', 5);
    const rival = await account('a.lindqvist@example.com', 10);
    const payer = await account('m.okafor@example.com', 1);
    const canceller = await account('j.serrano@example.com', 1);
    const newcomer = await account('t.nguyen@example.com', 0);
    type Who = typeof me;

    // ── The last days, on services of their own clock: the releases, ORBES Client Services and the atelier ──
    const past = await stageFixture(stage, createManualClock(new Date(Date.now() - 9 * DAY)));
    const admin = past.admin;
    /** The past's clock at `hour`:`minute` in Paris, `days` ago: ORBES Client Services and the atelier at work in the day, the releases at 19:00. */
    const on = (days: number, hour: number, minute = 0) => past.clock.set(new Date(parisAt(-days, hour).getTime() + minute * MINUTE));
    const orders = new OrderService({ db, audit: past.audit, clock: past.clock.now });
    const atelier = new AtelierService({ db, audit: past.audit, issuance: ctx.services.issuance, orders, clock: past.clock.now });
    const salon = new SalonService({ db, audit: past.audit, lookbook: ctx.services.lookbook, club: ctx.services.club, clock: past.clock.now });
    const carrier = async (name: string) => (await db.selectFrom('carriers').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
    const benchOf = async (orderId: string) => (await db.selectFrom('bench_items').select('id').where('order_id', '=', orderId).executeTakeFirstOrThrow()).id;
    const titled = async (id: string, title: string) => {
      await db.updateTable('drops').set({ title }).where('id', '=', id).execute();
    };
    /** The turn of `who` in a release of the past: the seal pressed, held 1.5 s, secured, the add-ons, PAY. */
    const buy = async (dropId: string, who: Who, addonIds: string[] = []) => {
      const token = (await past.live.entry(who.id, dropId))!.turn!.token!;
      await past.live.press(who.id, dropId, token);
      past.clock.advance(1_500);
      await past.live.secure(who.id, dropId, token, who.actor);
      if (addonIds.length) await past.live.setAddons(who.id, dropId, addonIds, who.actor);
      past.clock.advance(2_000);
      await past.live.confirm(who.id, dropId, who.actor);
      past.clock.advance(1_000);
    };

    // The draw, nine days ago: the four collectors entered, drawn; two places, held by tier (the PALLADIUM, then
    // Hélène). ORBES Client Services confirms hers: its order, its size and price entered, MONOLITHE in size 54.
    on(9, 12);
    const drawOpens = new Date(past.clock.now().getTime() + HOUR);
    const draw = await past.drops.create({ modelId: monolithe, title: 'MONOLITHE — THE DRAW', quantity: 2, opensAt: drawOpens, closesAt: new Date(drawOpens.getTime() + DAY), earlyAccessHours: 0 }, admin);
    await past.drops.publish(draw.id, admin);
    past.clock.set(new Date(drawOpens.getTime() + MINUTE));
    for (const who of [me, rival, payer, canceller]) await past.drops.enter(who.id, draw.id, who.actor);
    past.clock.set(new Date(drawOpens.getTime() + DAY + MINUTE));
    await past.drops.draw(draw.id, admin);
    on(8, 15);
    const myEntry = await db.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', draw.id).where('account_id', '=', me.id).executeTakeFirstOrThrow();
    if (myEntry.status !== 'SELECTED') throw new Error(`the draw left Hélène ${myEntry.status}`);
    await past.drops.confirm(draw.id, myEntry.id, 'Size 54, confirmed by phone.', admin);
    const drawn = (await db.selectFrom('orders').select('id').where('drop_entry_id', '=', myEntry.id).executeTakeFirstOrThrow()).id;
    on(8, 15, 10);
    await orders.setTerms(drawn, { sizeLabel: '54', priceMinor: 480_000, currency: 'EUR' }, admin);
    await orders.setBuyer(drawn, { name: 'Hélène Morel', address: '14 rue de Turenne\n75004 Paris\nFrance' }, admin);

    // LIVE I, six days ago: four pieces, two of size 54 made in advance at FRANCE WAREHOUSE; ENGRAVING, a surprise.
    const france = await defaultLocationId(db);
    const sku54 = await ensureSku(db, monolithe, '54');
    await ctx.services.stock.adjust({ skuId: sku54, locationId: france, delta: 2, note: 'Two pieces of size 54 finished ahead of LIVE I.' }, admin);
    on(6, 18);
    const live1 = await createLiveRelease(past, {
      modelId: monolithe,
      opensAt: new Date(past.clock.now().getTime() + HOUR),
      priceMinor: 505_000,
      quantityLine: '4 PIECES',
      sizes: [{ label: '52', stock: 2 }, { label: '54', stock: 2 }],
      addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
      surprise: 'A polishing cloth in the house black, folded under the ring.',
    });
    await titled(live1.id, 'MONOLITHE — LIVE I');
    const [l52, l54] = live1.sizes;
    past.clock.advance(HOUR - MINUTE);
    for (const [who, size] of [[me, l52], [rival, l52], [payer, l54], [canceller, l54]] as const) await past.live.enter(who.id, live1.id, { sizeId: size!.id }, who.actor);
    past.clock.advance(MINUTE);
    await past.live.advance(live1.id);
    const engraving = [live1.addons[0]!.id];
    for (const [who, addons] of [[rival, engraving], [me, engraving], [payer, []], [canceller, []]] as const) await buy(live1.id, who, [...addons]);
    const orderOf = async (who: Who, dropId: string) =>
      (await db.selectFrom('orders').select('id').where('account_id', '=', who.id).where('drop_id', '=', dropId).executeTakeFirstOrThrow()).id;
    const mine = await orderOf(me, live1.id);
    const rivals = await orderOf(rival, live1.id);
    const paid = await orderOf(payer, live1.id);
    const cancelled = await orderOf(canceller, live1.id);
    // The engraving the rival asked ORBES Client Services for.
    on(5, 10);
    await orders.setTerms(rivals, { engravingText: 'A. & L.' }, admin);

    // Five days ago, Hélène asks THE PRIVATE SALON for an ORBITE; ORBES Client Services accepts that day: size 54, € 1 900.
    on(5, 11, 30);
    const request = (await db.insertInto('shop_requests').values({ account_id: me.id, model_id: orbite, created_at: past.clock.now() }).returning('id').executeTakeFirstOrThrow()).id;
    on(5, 15);
    await salon.close(request, { note: 'An ORBITE in size 54, for her birthday.', outcome: 'ACCEPTED' }, admin);
    const salonOrder = (await db.selectFrom('orders').select('id').where('shop_request_id', '=', request).executeTakeFirstOrThrow()).id;
    on(5, 15, 10);
    await orders.setTerms(salonOrder, { sizeLabel: '54', priceMinor: 190_000, currency: 'EUR' }, admin);
    await orders.setBuyer(salonOrder, { name: 'Hélène Morel', address: '14 rue de Turenne\n75004 Paris\nFrance' }, admin);

    // Four days ago: LIVE I's pieces paid (one cancelled the next morning), Hélène's engraved, her pieces at the bench.
    on(4, 10);
    await orders.setBuyer(mine, { name: 'Hélène Morel', address: '14 rue de Turenne\n75004 Paris\nFrance' }, admin);
    await orders.setTerms(mine, { engravingText: 'H. M.' }, admin);
    on(4, 11);
    await orders.transition(mine, { to: 'PAID' }, admin);
    on(4, 14);
    const myBench = await benchOf(mine);
    await atelier.start(myBench, admin);
    on(4, 16);
    await orders.transition(salonOrder, { to: 'PAID' }, admin);
    on(4, 17);
    await orders.transition(cancelled, { to: 'PAID' }, admin);
    on(3, 10);
    await orders.transition(cancelled, { to: 'CANCELLED', note: 'The client changed her mind before shipping; refunded in full.' }, admin);
    on(3, 11);
    const salonBench = await benchOf(salonOrder);
    await atelier.start(salonBench, admin);

    // LIVE II, three days ago: one piece; Hélène joins the line behind the newcomer, who secures it: SOLD OUT.
    on(3, 18);
    const live2 = await createLiveRelease(past, { modelId: monolithe, opensAt: new Date(past.clock.now().getTime() + HOUR), priceMinor: 505_000, quantityLine: '1 PIECE', sizes: [{ label: '52', stock: 1 }] });
    await titled(live2.id, 'MONOLITHE — LIVE II');
    past.clock.advance(HOUR - MINUTE);
    await past.live.enter(newcomer.id, live2.id, { sizeId: live2.sizes[0]!.id }, newcomer.actor);
    past.clock.advance(MINUTE);
    await past.live.advance(live2.id);
    await past.live.enter(me.id, live2.id, { sizeId: live2.sizes[0]!.id }, me.actor);
    await buy(live2.id, newcomer);

    // Two days ago: Hélène's LIVE I piece made and shipped by Colissimo; the draw's piece and Michael's paid.
    on(2, 11);
    const done = await atelier.done(myBench, { productionBatch: 'B-2026-10-LIVE-I' }, admin);
    on(2, 15);
    await orders.transition(mine, { to: 'SHIPPED', carrierId: await carrier('Colissimo'), trackingNumber: '6A12345678901', declaredValueMinor: 520_000 }, admin);
    on(2, 16);
    await orders.transition(drawn, { to: 'PAID' }, admin);
    on(2, 16, 30);
    await orders.setBuyer(paid, { name: 'Michael Okafor', address: '22 Kensington Church Street\nLondon W8 4EP\nUnited Kingdom' }, admin);
    await orders.transition(paid, { to: 'PAID' }, admin);
    on(2, 17);
    await atelier.start(await benchOf(drawn), admin);
    // Yesterday: the ORBITE finished and shipped by Chronopost; the rival's engraved piece begun, still to be paid.
    on(1, 10);
    await atelier.done(salonBench, { productionBatch: 'B-2026-10-SALON' }, admin);
    on(1, 11);
    await orders.transition(salonOrder, { to: 'SHIPPED', carrierId: await carrier('Chronopost'), trackingNumber: 'XY482915637FR', declaredValueMinor: 190_000 }, admin);
    on(1, 12);
    const rivalBench = await benchOf(rivals);
    await atelier.start(rivalBench, admin);

    // LIVE III, yesterday: Hélène said I'LL BE THERE and never came; it closed with a piece left.
    on(1, 18);
    const live3 = await createLiveRelease(past, {
      modelId: monolithe,
      opensAt: new Date(past.clock.now().getTime() + HOUR),
      closesAt: new Date(past.clock.now().getTime() + 2 * HOUR),
      priceMinor: 505_000,
      quantityLine: '2 PIECES',
      sizes: [{ label: '52', stock: 2 }],
    });
    await titled(live3.id, 'MONOLITHE — LIVE III');
    await past.live.setInterest(me.id, live3.id, live3.sizes[0]!.id, me.actor);
    past.clock.advance(HOUR - MINUTE);
    await past.live.enter(payer.id, live3.id, { sizeId: live3.sizes[0]!.id }, payer.actor);
    past.clock.advance(MINUTE);
    await past.live.advance(live3.id);
    await buy(live3.id, payer);
    past.clock.advance(HOUR);
    await past.live.advance(live3.id);

    // ── Today: Hélène receives LIVE I's piece and registers it with its claim code (its warranty started at the sale): DELIVERED ──
    const piece = (await db.selectFrom('products').select('id').where('product_id', '=', done.productId).executeTakeFirstOrThrow()).id;
    await ctx.services.warranty.activate(piece, { purchaseDate: new Date().toISOString().slice(0, 10), retailer: 'ORBES PARIS', country: 'FR' }, admin);
    const scan = await ctx.services.verification.verify({ code: (await ctx.services.issuance.printableCode(done.codeId)).data }, {});
    await ctx.services.ownership.registerFirst(me.id, { registrationToken: scan.registration!.token, claimCode: done.claimCode! }, me.actor);
    // A minimum for MONOLITHE in size 54 at FRANCE WAREHOUSE: the atelier suggests what to make.
    await ctx.services.atelier.setThreshold({ skuId: sku54, locationId: france, minimum: 3 }, admin);
    // The Catalogue: MONOLITHE's base price (N2) and its care guide (M6).
    await ctx.services.catalog.updateModel(
      monolithe,
      { basePriceMinor: 505_000, baseCurrency: 'EUR', careGuide: 'Wipe the band with a soft, dry cloth after wearing.\nKeep it in its box, away from perfume and from other pieces.' },
      admin,
    );

    // ── The segments, a release announced for them, one with its room open, one in draft ──
    const selected = await ctx.services.segments.create(
      { name: 'Owners from PLATINE, active this month', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [2, 3] }, { kind: 'ACTIVE', days: 30 }] } },
      admin,
    );
    await ctx.services.segments.create(
      { name: 'Wanted another size at LIVE II', criteria: { match: 'ANY', rules: [{ kind: 'ANSWER', dropId: live2.id, answer: 1 }, { kind: 'SIZE', sizes: ['54'] }] } },
      admin,
    );
    const today = await stageFixture(stage);
    const live5 = await createLiveRelease(today, {
      modelId: monolithe,
      opensAt: parisAt(3, 19),
      priceMinor: 505_000,
      quantityLine: '25 PIECES',
      sizes: [{ label: '50', stock: 8 }, { label: '52', stock: 9 }, { label: '54', stock: 8 }],
      addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
      minParticipations: 3,
      accessSegmentId: selected.id,
      accessCombine: 'OR',
      surprise: 'A silk pouch, hand-stitched in the atelier.',
    });
    await titled(live5.id, 'MONOLITHE — LIVE V');
    const circle = await createLiveRelease(today, {
      modelId: monolithe,
      // On the half hour, 10 to 40 minutes from now: its room, open an hour before, is open.
      opensAt: new Date(Math.ceil((Date.now() + 10 * MINUTE) / (30 * MINUTE)) * 30 * MINUTE),
      roomOpensMinutes: 60,
      priceMinor: 505_000,
      quantityLine: '12 PIECES',
      sizes: [{ label: '52', stock: 6 }, { label: '54', stock: 6 }],
      accessSegmentId: selected.id,
    });
    await titled(circle.id, 'MONOLITHE — FOR THE CIRCLE');
    const logistics = (await db.selectFrom('stock_locations').select('id').where('name', '=', 'LOGISTICS WAREHOUSE').executeTakeFirstOrThrow()).id;
    const live6 = await createLiveRelease(today, {
      modelId: monolithe,
      opensAt: parisAt(10, 19),
      announceAt: parisAt(3, 12),
      published: false,
      priceMinor: 505_000,
      quantityLine: '25 PIECES',
      sizes: [{ label: '50', stock: 8 }, { label: '52', stock: 9 }, { label: '54', stock: 8 }],
      addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
      minParticipations: 2,
      accessSegmentId: selected.id,
      accessCombine: 'OR',
      surprise: 'A silk pouch, hand-stitched in the atelier.',
      afterRoom: { modelId: orbite, priceMinor: 190_000, sizes: [{ label: '52', stock: 4 }, { label: '54', stock: 4 }], addons: [{ label: 'GIFT BOX', line: 'Wrapped by hand in the atelier', priceMinor: 9_000 }] },
    });
    await titled(live6.id, 'MONOLITHE — LIVE VI');
    // Its sizes on sale linked to their SKUs, as the console writes a release; LOGISTICS WAREHOUSE holds all of its
    // size 50 and part of its 52: the feasibility check warns for the rest.
    await linkDropSizes(db, live6.id, monolithe);
    await linkDropSizes(db, live6.afterRoom!.id, orbite);
    await ctx.services.stock.adjust({ skuId: await ensureSku(db, monolithe, '50'), locationId: logistics, delta: 8, note: 'Eight pieces of size 50 received from the atelier.' }, admin);
    await ctx.services.stock.adjust({ skuId: await ensureSku(db, monolithe, '52'), locationId: logistics, delta: 6, note: 'Six pieces of size 52 received from the atelier.' }, admin);
    await ctx.services.liveConsole.update(
      live6.id,
      { stockLocationId: logistics, questionText: 'WHICH SIZE WOULD YOU HAVE CHOSEN?', questionAnswers: ['50', '52', '54', 'ANOTHER SIZE'] },
      admin,
    );

    // ── The phone and the console ──
    const phone = async (token: string, label: string) => {
      const context = await mobileContext(browser);
      await context.addCookies([{ name: sessionCookieName(ctx.config, 'account'), value: token, url: origin }]);
      const page = await context.newPage();
      watchPage(page, label);
      return { context, page };
    };
    const settle = async (page: Page, ms = 1_200) => {
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await hideGrain(page);
      await sleep(ms);
    };

    // ── LIVE IV and its after-room, lived now, the engine running (from here: the releases of the past are over) ──
    engine = startLiveEngine(ctx, { connection: 'shared' });
    const live4 = await createLiveRelease(today, {
      modelId: monolithe,
      opensAt: new Date(Date.now() + HOUR),
      priceMinor: 505_000,
      quantityLine: '1 PIECE',
      sizes: [{ label: '52', stock: 1 }],
      surprise: 'A polishing cloth in the house black, folded under the ring.',
      afterRoom: { modelId: orbite, priceMinor: 190_000, sizes: [{ label: '52', stock: 2 }, { label: '54', stock: 2 }], addons: [{ label: 'GIFT BOX', line: 'Wrapped by hand in the atelier', priceMinor: 9_000 }], delayMinutes: 1, lengthMinutes: 15 },
    });
    await titled(live4.id, 'MONOLITHE — LIVE IV');
    await titled(live4.afterRoom!.id, 'MONOLITHE — LIVE IV · THE AFTER-ROOM');
    const t0 = Date.now() + 2_000;
    await db.updateTable('drops').set({ opens_at: new Date(t0), closes_at: new Date(t0 + HOUR) }).where('id', '=', live4.id).execute();
    for (const who of [rival, me]) await ctx.services.live.enter(who.id, live4.id, { sizeId: live4.sizes[0]!.id }, who.actor);
    const statusIn = async (dropId: string, who: Who) => (await db.selectFrom('live_entries').select('status').where('drop_id', '=', dropId).where('account_id', '=', who.id).executeTakeFirst())?.status ?? null;
    await until('the rival’s turn', async () => (await statusIn(live4.id, rival)) === 'TURN');
    const { context: vault, page } = await phone(me.token, 'plus-after-room');
    await page.goto(`${origin}/verify/releases/${live4.id}`);
    await untilText(page, '.live__place-figure', '2');
    const token = (await ctx.services.liveRoom.viewerEntries(live4.id, [rival.id])).get(rival.id)!.turn!.token!;
    await ctx.services.live.press(rival.id, live4.id, token);
    await sleep(1_500);
    await ctx.services.live.secure(rival.id, live4.id, token, rival.actor);
    await ctx.services.live.confirm(rival.id, live4.id, rival.actor);
    await untilText(page, '.n-live__end .n-live__outcome', 'SOLD OUT');
    // A minute later, in the same vault: the second door.
    await page.locator('.live__after').waitFor({ state: 'visible', timeout: 90_000 });
    await settle(page, 1_600);
    await shots.full(page, 'plus-07-after-room-door');
    await page.getByRole('button', { name: 'ENTER THE AFTER-ROOM' }).click();
    await untilText(page, '.live__join > .live__overline', 'THE AFTER-ROOM');
    await page.locator('.live__join .live__size', { hasText: /^52$/ }).click();
    await settle(page);
    await shots.full(page, 'plus-08-after-room-join');
    await page.getByRole('button', { name: 'ENTER THE LINE' }).click();
    // Her turn, first in the after-room as she was next in the line: at half its time, the seal held half way.
    await untilText(page, '.live__turn > .live__overline', 'YOUR TURN');
    await settle(page, 300);
    const turnPage = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width: MOBILE.width, height: Math.max(MOBILE.height, turnPage) });
    await untilText(page, '.live__turn-left', '00:15', 30_000);
    const seal = (await page.locator('.live-hold').boundingBox())!;
    await page.mouse.move(seal.x + seal.width / 2, seal.y + seal.height / 2);
    await page.mouse.down();
    await sleep(700);
    await shots.viewport(page, 'plus-09-after-room-turn');
    await sleep(1_400);
    await page.mouse.up();
    await page.setViewportSize({ ...MOBILE });
    await untilText(page, '.live__secured > .live__overline', 'SECURED');
    await sleep(2_600);
    await page.getByRole('button', { name: /GIFT BOX/ }).click();
    await page.locator('.live__pay').click();
    await untilText(page, 'h1', 'CONFIRMED');
    await settle(page, 1_600);
    await shots.full(page, 'plus-10-after-room-confirmed');
    await vault.close();

    // ── THE RELEASES: LIVE, then PAST, and a past release ──
    {
      const { context, page: p } = await phone(me.token, 'plus-releases');
      await p.goto(`${origin}/verify/releases`);
      await p.locator('#releases-panel-live article.live-card').first().waitFor({ state: 'visible', timeout: 30_000 });
      await settle(p);
      await shots.full(p, 'plus-01-releases-live');
      await p.getByRole('tab', { name: 'PAST', exact: true }).click();
      await p.locator('.releases__taken').waitFor({ state: 'visible', timeout: 30_000 });
      await p.locator('#releases-panel-past article.release-card').first().waitFor({ state: 'visible' });
      await settle(p);
      await shots.full(p, 'plus-02-releases-past');
      await p.locator('#releases-panel-past article.release-card').filter({ has: p.locator(`#past-${live1.id}-title`) }).getByRole('link', { name: 'SEE THE RELEASE' }).click();
      await p.locator('.n-live__part').waitFor({ state: 'visible', timeout: 30_000 });
      await settle(p);
      await shots.full(p, 'plus-03-past-release');
      await context.close();
    }

    // ── The release announced, its rules in words; who may not enter ──
    const shot = async (who: Who, path: string, ready: string, name: string) => {
      const { context, page: p } = await phone(who.token, name);
      await p.goto(`${origin}${path}`);
      await p.locator(ready).first().waitFor({ state: 'visible', timeout: 30_000 });
      await settle(p);
      await shots.full(p, name);
      await context.close();
    };
    {
      // Hélène chooses her size: I'LL BE THERE is hers to press.
      const { context, page: p } = await phone(me.token, 'plus-04-announced-rules');
      await p.goto(`${origin}/verify/releases/${live5.id}`);
      await p.locator('.n-live__there').locator('button.live__size', { hasText: /^52$/ }).click();
      await settle(p);
      await shots.full(p, 'plus-04-announced-rules');
      await context.close();
    }
    await shot(newcomer, `/verify/releases/${live5.id}`, '.n-live__refusal', 'plus-05-not-eligible-count');
    await shot(newcomer, `/verify/releases/${circle.id}`, '.live__edge h1, .n-live__refusal', 'plus-06-not-eligible-selected');

    // ── The question after, MY PIECES: the orders at each step, an order's documents, the question there ──
    await shot(me, `/verify/releases/${live2.id}`, '.n-live__past .n-question .question__answer', 'plus-11-question-after');
    {
      const { context, page: p } = await phone(me.token, 'plus-pieces');
      await p.goto(`${origin}/verify/pieces`);
      // MY PIECES' tab ORDERS (NOCTURNE, N5: C24), then PIECES for the question after.
      await p.getByRole('tab', { name: /^ORDERS/ }).click({ timeout: 30_000 });
      const section = p.locator('.n-pieces__orders');
      await section.locator('article.n-pieces__order').nth(3).waitFor({ state: 'visible', timeout: 30_000 });
      await settle(p);
      await shots.region(p, '.n-pieces__orders', 'plus-12-your-orders');
      const delivered = section.locator('article.n-pieces__order[data-status="DELIVERED"]');
      await delivered.getByRole('button', { name: /CARE GUIDE/i }).click();
      await delivered.locator('.n-pieces__care-text').waitFor({ state: 'visible' });
      await settle(p, 600);
      await shots.region(p, 'article.n-pieces__order[data-status="DELIVERED"] .n-pieces__documents', 'plus-13-order-documents');
      await p.getByRole('tab', { name: /^PIECES/ }).click();
      const questions = p.locator('section.pieces__questions');
      await questions.locator('.question__answer').first().waitFor({ state: 'visible' });
      await shots.region(p, 'section.pieces__questions', 'plus-14-after-the-releases');
      await context.close();
    }
    // Hélène answers LIVE II's question: ANOTHER SIZE (the second segment's criterion).
    await ctx.services.questions.answer(me.id, live2.id, 1, me.actor);

    // ── The console ──
    /** The console, signed in as the bootstrap ADMIN, in a context of its own. */
    const signIn = async (context: BrowserContext, label: string) => {
      const p = await context.newPage();
      watchPage(p, label);
      await p.goto(`${origin}/admin`);
      await p.waitForSelector('[data-testid=login-form]');
      await p.fill('input[name=email]', ADMIN.email);
      await p.fill('input[name=password]', ADMIN.password);
      await p.click('[data-testid=login-submit]');
      await p.waitForSelector('.view--dashboard');
      return p;
    };
    const desk = await browser.newContext({ viewport: { ...DESKTOP }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Paris' });
    const console_ = await signIn(desk, 'plus-console');
    /** A page of the console at rest: its heading read, its data in, the toasts gone, the pointer away. */
    const go = async (hash: string, heading: string | RegExp, ready: string) => {
      await console_.evaluate((h) => (location.hash = h), hash);
      await untilText(console_, 'h1.page-head__title', heading, 20_000);
      await console_.locator(ready).first().waitFor({ state: 'visible', timeout: 20_000 });
      await console_.evaluate(async () => {
        document.querySelectorAll('.toast').forEach((x) => x.remove());
        await document.fonts.ready;
      });
      await console_.mouse.move(0, 0);
      await sleep(900);
    };
    await go('#/orders', 'Orders', '[data-testid=order-card]');
    await shots.full(console_, 'plus-15-console-orders');
    await go(`#/orders/${mine}`, orderReference(mine), '#order-history');
    await shots.full(console_, 'plus-16-console-order');
    await go('#/atelier', 'Atelier', '[data-testid=bench-group]');
    await shots.full(console_, 'plus-17-console-atelier');
    await go('#/invoices', 'Invoices', '[data-testid=invoice-pdf]');
    await shots.full(console_, 'plus-18-console-invoices');
    await go('#/segments', 'Segments', '[data-testid=segment-row-count]');
    await shots.full(console_, 'plus-19-console-segments');
    await go(`#/segments/${selected.id}`, selected.name, '[data-testid=segment-tree]');
    await untilText(console_, '[data-testid=segment-count]', /\d/, 20_000);
    await shots.full(console_, 'plus-20-console-segment');
    await go('#/settings', 'Settings', '[data-testid=location-add]');
    await shots.full(console_, 'plus-21-console-settings');
    await go(`#/owners/${me.id}`, 'helene.morel@example.com', '#orders tbody tr');
    await shots.full(console_, 'plus-22-console-client');
    await go('#/catalogue', 'Catalogue', '[data-testid=shopify-products-export]');
    await console_.click('[data-testid=shopify-products-export]');
    await console_.locator('[data-testid=shopify-export-summary]').waitFor({ state: 'visible' });
    await console_.mouse.move(0, 0);
    await sleep(600);
    await shots.viewport(console_, 'plus-23-console-catalogue-export');
    await console_.keyboard.press('Escape');
    // LIVE VI, a draft: its parts (the after-room, the access, the surprise, the question after), the best time to
    // open, then PUBLISH and the feasibility check's warnings.
    await go(`#/club/live/${live6.id}`, 'MONOLITHE — LIVE VI', '#live-part-after-room');
    await console_.locator('#live-best-time [data-testid=best-time-suggested]').waitFor({ state: 'visible', timeout: 20_000 });
    // Each part alone, on the console's white page, 40 pixels of it round the part.
    await shots.element(console_, '.live__parts', 'plus-24-console-release-settings', 40);
    await shots.element(console_, '#live-best-time', 'plus-25-console-best-time', 40);
    await console_.click('[data-testid=live-publish]');
    await console_.locator('dialog [data-testid=live-feasibility-line]').waitFor({ state: 'visible', timeout: 20_000 });
    await console_.mouse.move(0, 0);
    await sleep(600);
    await shots.viewport(console_, 'plus-26-console-feasibility');
    await console_.keyboard.press('Escape');

    await desk.close();

    // ── The printed documents, black on white: the console's print pages as printed (A4 at 96 dpi, drawn at 2×) ──
    const paper = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2, locale: 'en-GB', timezoneId: 'Europe/Paris' });
    const print = await signIn(paper, 'plus-print');
    await print.emulateMedia({ media: 'print' });
    for (const [hash, testid, name] of [
      [`#/atelier/sheets?id=${rivalBench}`, 'work-sheet', 'plus-27-work-sheet'],
      [`#/orders/${mine}/slip`, 'packing-slip', 'plus-28-packing-slip'],
    ] as const) {
      await print.evaluate((h) => (location.hash = h), hash);
      await print.locator(`[data-testid=${testid}]`).waitFor({ state: 'visible', timeout: 20_000 });
      await print.evaluate(() => document.fonts.ready);
      await sleep(600);
      // 15 mm of the page's margin round the sheet (2 pixels a CSS pixel, 96 of them an inch).
      await shots.element(print, `[data-testid=${testid}]`, name, Math.round((15 / 25.4) * 96 * 2));
    }
    await paper.close();
    const invoice = (await db.selectFrom('invoices').select('id').where('order_id', '=', mine).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()).id;
    shots.png('plus-29-invoice', pdfFirstPage((await ctx.services.invoices.pdf(invoice)).body, workDir, 'invoice'));
    shots.png('plus-30-certificate', pdfFirstPage((await ctx.services.ownershipCertificates.orderCertificatePdf(me.id, mine)).body, workDir, 'certificate'));
  } finally {
    await browser.close();
    await engine?.stop();
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

// ── NOCTURNE ──────────────────────────────────────────────────────────────

/**
 * NOCTURNE's screens (plan NOCTURNE, step N9), one or two per chapter, in the order of BRAND-DESIGN-SYSTEM §5: each a
 * state of the parity tool (test/support/nocturne-states.ts) on the NOCTURNE demo, the canvas's content on a fixed clock
 * (Monday 5 October 2026, 18:49 in Paris), captured as scripts/parity.ts captures it (the whole page, its motion
 * finished; the camera's viewport alone), with the board it was drawn from.
 */
export const NOCTURNE_SHOTS: readonly { state: string; name: string; board: string }[] = Object.freeze([
  { state: 'now-signed-in', name: 'nocturne-01-now', board: 'C1' },
  { state: 'now-signed-out', name: 'nocturne-02-now-signed-out', board: 'C10' },
  { state: 'now-draw-leads', name: 'nocturne-03-now-draw-leads', board: 'C42' },
  { state: 'now-collection-leads', name: 'nocturne-04-now-collection-leads', board: 'C43' },
  { state: 'account-sheet', name: 'nocturne-05-account', board: 'C2' },
  { state: 'scan-camera', name: 'nocturne-06-camera', board: 'C11' },
  { state: 'scan-verifying', name: 'nocturne-07-verifying', board: 'C12' },
  { state: 'result-first-registration', name: 'nocturne-08-result-first-registration', board: 'C9' },
  { state: 'result-ownership-verified', name: 'nocturne-09-result-yours', board: 'C14' },
  { state: 'result-unusual-card', name: 'nocturne-10-result-unusual', board: 'C15' },
  { state: 'problem-camera-denied', name: 'nocturne-11-problem', board: 'C17' },
  { state: 'pieces', name: 'nocturne-12-my-pieces', board: 'C3' },
  { state: 'piece', name: 'nocturne-13-piece', board: 'C4' },
  { state: 'pieces-orders', name: 'nocturne-14-orders', board: 'C24' },
  { state: 'collection', name: 'nocturne-15-collection', board: 'C5' },
  { state: 'model', name: 'nocturne-16-model', board: 'C6' },
  { state: 'releases', name: 'nocturne-17-releases', board: 'C7' },
  { state: 'releases-past', name: 'nocturne-18-releases-past', board: 'C25' },
  { state: 'draw', name: 'nocturne-19-draw', board: 'C19' },
  { state: 'live-announced', name: 'nocturne-20-live-announced', board: 'C20' },
  { state: 'live-past-secured', name: 'nocturne-21-live-over', board: 'C29' },
  { state: 'circle', name: 'nocturne-22-circle', board: 'C8' },
  { state: 'post-invitation', name: 'nocturne-23-post', board: 'C22' },
  { state: 'pieces-sign-in-refused', name: 'nocturne-24-sign-in', board: 'C18' },
  { state: 'pieces-loading', name: 'nocturne-25-loading', board: 'C40' },
  { state: 'legal-index', name: 'nocturne-26-legal', board: 'C23' },
]);

async function captureNocturne(shots: Shots): Promise<void> {
  const names = new Map(NOCTURNE_SHOTS.map((s) => [s.state, s.name]));
  const failures: string[] = [];
  await eachState(
    NOCTURNE_SHOTS.map((s) => stateById(s.state)),
    async (state, { stage, demo, browser }) => {
      const opened = await openState(browser, stage, demo, state);
      try {
        shots.png(names.get(state.id)!, await shootState(opened.page, state));
      } catch (e) {
        failures.push(`${state.id}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await opened.close();
      }
    },
    log,
  );
  if (failures.length) throw new Error(`${failures.length} NOCTURNE capture(s) failed:\n${failures.join('\n')}`);
}

// ── MESSAGES (plan NEXT-NINE, CS-01) ─────────────────────────────────────

/**
 * WRITE TO ORBES CLIENT SERVICES and MESSAGES (plan NEXT-NINE, CS-01, step 1.6): the write sheet signed in, signed out
 * and sent, MESSAGES empty and with a conversation, NOW's line, each at a phone's size (390 × 844) and a desk's
 * (1440 × 900), as the states of the parity tool reach them on the NOCTURNE demo. `--only messages` writes them alone.
 */
export const MESSAGES_SHOTS: readonly { state: string; name: string }[] = Object.freeze([
  { state: 'account-write', name: 'messages-01-write' },
  { state: 'result-write-signed-out', name: 'messages-02-write-signed-out' },
  { state: 'account-messages-empty', name: 'messages-03-messages-empty' },
  { state: 'account-write-sent', name: 'messages-04-write-sent' },
  { state: 'account-messages-thread', name: 'messages-05-messages-thread' },
  { state: 'now-messages', name: 'messages-06-now-line' },
]);

const DESK = Object.freeze({ width: 1440, height: 900 });

async function captureMessages(shots: Shots): Promise<void> {
  await capturePhonesAndDesks(shots, MESSAGES_SHOTS, 'MESSAGES', stateById);
}

/**
 * Each of `list`'s states at a phone's size, then at a desk's, the phones and the desks each on a demo of their own: a
 * state that writes (a message sent, an answer, sizes saved) runs once per demo, so the desk's is not the phone's
 * written twice.
 */
async function capturePhonesAndDesks(shots: Shots, list: readonly { state: string; name: string }[], label: string, find: (id: string) => UiState): Promise<void> {
  const failures: string[] = [];
  for (const desk of [false, true]) {
    const names = new Map<string, string>();
    const states = list.map((s) => {
      const phone = find(s.state);
      const state = desk ? { ...phone, id: `${phone.id}-desk`, size: DESK } : phone;
      names.set(state.id, `${s.name}-${desk ? 'desk' : 'phone'}`);
      return state;
    });
    await eachState(
      states,
      async (state, { stage, demo, browser }) => {
        const opened = await openState(browser, stage, demo, state);
        try {
          shots.png(names.get(state.id)!, await shootState(opened.page, state));
        } catch (e) {
          failures.push(`${state.id}: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          await opened.close();
        }
      },
      log,
    );
  }
  if (failures.length) throw new Error(`${failures.length} ${label} capture(s) failed:\n${failures.join('\n')}`);
}

// ── YOUR SIZES (plan NEXT-NINE, AC-01) ───────────────────────────────────

/**
 * YOUR SIZES (plan NEXT-NINE, AC-01, step 4.3): the account sheet's view of a collector who saved two sizes, an account's
 * sizes saved (its row's line), THE PRIVATE SALON's picker with the size suggested and REQUESTED · SIZE 54, I'LL BE THERE
 * with its size preselected, and the room's READY CHECK at TO CONFIRM then ready, each at a phone's size and a desk's.
 * `--only sizes` writes them alone.
 */
export const SIZES_SHOTS: readonly { state: string; name: string }[] = Object.freeze([
  { state: 'sizes-view', name: 'sizes-01-view' },
  { state: 'sizes-save', name: 'sizes-02-saved' },
  { state: 'model-salon-sizes', name: 'sizes-03-salon-picker' },
  { state: 'model-salon-size-requested', name: 'sizes-04-salon-requested' },
  { state: 'live-announced-from-yours', name: 'sizes-05-ill-be-there' },
  { state: 'room-from-yours', name: 'sizes-06-room-to-confirm' },
  { state: 'room-from-yours-confirmed', name: 'sizes-07-room-confirmed' },
]);

async function captureSizes(shots: Shots): Promise<void> {
  await capturePhonesAndDesks(shots, SIZES_SHOTS, 'YOUR SIZES', (id) => ROOM_SIZE_STATES.find((s) => s.id === id) ?? stateById(id));
}

// ── HOW RELEASES WORK (plan NEXT-NINE, FT-01) ────────────────────────────

/** HOW RELEASES WORK (plan NEXT-NINE, FT-01, step 5.2) at a phone's size and a desk's. `--only how` writes it alone. */
export const HOW_SHOTS: readonly { state: string; name: string }[] = Object.freeze([{ state: 'releases-how', name: 'how-releases-work' }]);

async function captureHow(shots: Shots): Promise<void> {
  await capturePhonesAndDesks(shots, HOW_SHOTS, 'HOW RELEASES WORK', stateById);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { out, raw, only } = parseArgs(process.argv.slice(2));
  if (only === 'how') {
    const shots = new Shots(out, raw);
    log('HOW RELEASES WORK:');
    await captureHow(shots);
    log(`${shots.written.length} screenshots in ${relative(process.cwd(), out) || '.'}`);
    return;
  }
  if (only === 'sizes') {
    const shots = new Shots(out, raw);
    log('YOUR SIZES:');
    await captureSizes(shots);
    log(`${shots.written.length} screenshots in ${relative(process.cwd(), out) || '.'}`);
    return;
  }
  if (only === 'messages') {
    const shots = new Shots(out, raw);
    log('MESSAGES:');
    await captureMessages(shots);
    log(`${shots.written.length} screenshots in ${relative(process.cwd(), out) || '.'}`);
    return;
  }
  if (only === 'nocturne') {
    const shots = new Shots(out, raw);
    log('NOCTURNE:');
    await captureNocturne(shots);
    log(`${shots.written.length} screenshots in ${relative(process.cwd(), out) || '.'}`);
    return;
  }
  const workDir = mkdtempSync(join(tmpdir(), 'orbes-capture-ui-'));
  let stage: Stage | undefined;
  try {
    stage = await startStage(workDir);
    const shots = new Shots(out, raw);
    if (only === null) {
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
    }
    if (only !== 'plus') {
      log('the LIVE RELEASE:');
      await captureLive(stage, shots);
    }
    if (only !== 'live') {
      log('LIVE RELEASE+:');
      await capturePlus(stage, shots, workDir);
    }
    if (only === null) {
      // On stages of their own (the NOCTURNE demo, a fresh database for each of its variants): this stage is left first.
      await stage.close();
      stage = undefined;
      log('NOCTURNE:');
      await captureNocturne(shots);
    }
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
