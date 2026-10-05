/**
 * The stage of the screen captures (scripts/capture-ui.ts, scripts/parity.ts) and of the NOCTURNE browser tests: the
 * production web build served by the real server (createContext + buildApp) on an in-memory PGlite database, on a clock
 * the caller hands over, and the pieces every capture shares: the phone (390 × 844 at 2×, an iPhone's user agent, Paris),
 * the film grain hidden through the CSSOM, a printed code photographed or filmed for the scanner, an SVG drawn as a WebP.
 *
 * Scripts are not allowed to own test helpers (test/web/verify.harness.ts), so the stage lives here and the scripts
 * import it.
 */
import { createServer } from 'node:net';
import { Resvg } from '@resvg/resvg-js';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { encodeOrbesCode, ORBES_CODE_STYLES, renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { frameCodeData } from '../../src/core/payload.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig, type ConfigOverrides } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import type { Db } from '../../src/server/db/connection.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { noopLogger, type Clock } from '../../src/server/types.js';
import { cameraClipFrames } from '../e2e/support.js';
import { createTestDb } from './db.js';
import { svgToGray } from './raster.js';
import { writeY4m } from './y4m.js';

export const CHROMIUM_PATH = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/** The phone of every capture: an iPhone 12–15's logical viewport. */
export const MOBILE = Object.freeze({ width: 390, height: 844 });
export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A promise with its resolver, to hold a routed request until a capture is done. */
export function gate(): { promise: Promise<void>; open(): void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

export async function freePort(): Promise<number> {
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

export interface UiStage {
  origin: string;
  ctx: AppContext;
  db: Db;
  app: FastifyInstance;
  close(): Promise<void>;
}

export interface UiStageOptions {
  /** A web build (scripts/build-web.ts, production mode) the server serves as it is. */
  webDir: string;
  /** Every service's clock: the seed's while seeding, then the capture's. */
  clock: Clock;
  /** Merged into the test configuration (its public origin, host and port are the stage's). */
  config?: ConfigOverrides;
  /** Run on the context before the server listens: the dataset of the captures. */
  seed?(ctx: AppContext): Promise<void>;
}

/** The server of the captures on a fresh, migrated in-memory database (test/support/db.ts), listening on 127.0.0.1. */
export async function startUiStage(opts: UiStageOptions): Promise<UiStage> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const t = await createTestDb();
  let ctx: AppContext | undefined;
  let app: FastifyInstance | undefined;
  try {
    const config = testConfig({ ...opts.config, publicOrigin: origin, host: '127.0.0.1', port });
    ctx = await createContext(config, { db: t.db, clock: opts.clock, log: noopLogger, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await opts.seed?.(ctx);
    app = await buildApp(ctx, { serveStatic: true, staticDir: opts.webDir });
    await app.listen({ port, host: '127.0.0.1' });
    const [c, a] = [ctx, app];
    return {
      origin,
      ctx: c,
      db: t.db,
      app: a,
      async close() {
        await a.close();
        await c.close();
        await t.close();
      },
    };
  } catch (e) {
    await app?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await t.close().catch(() => {});
    throw e;
  }
}

/** The phone of verify: 390 × 844 CSS px at 2×, touch, an iPhone's user agent, English, Paris. */
export async function mobileContext(browser: Browser, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { ...MOBILE },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: 'en-GB',
    timezoneId: 'Europe/Paris',
    reducedMotion: opts.reducedMotion ?? 'no-preference',
  });
}

/** Hide the film grain overlay (CSSOM only: the page CSP forbids style attributes in markup). */
export async function hideGrain(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.grain');
    if (el) el.style.visibility = 'hidden';
  });
}

/** The framed data (79 bytes) and genome glyphs of a piece's current code. */
export async function codeOf(db: Db, productId: string): Promise<{ data: Uint8Array; glyphs: number[] }> {
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
export function codePhoto(code: { data: Uint8Array; glyphs: readonly number[] }, widthPx = 900): Buffer {
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
export function cameraClip(code: { data: Uint8Array; glyphs: readonly number[] }, path: string): void {
  const model = encodeOrbesCode({ data: code.data, genomeGlyphs: code.glyphs }, { decor: true });
  const source = svgToGray(renderOrbesCodeSvg(model, ORBES_CODE_STYLES.classic), { widthPx: 800 });
  writeY4m(path, cameraClipFrames(source, { n: 8, seed: 3 }), 15);
}

/** An SVG drawn by Chromium into a canvas, saved as a WebP with its transparency (the media store takes JPEG or WebP). */
export async function webpOf(browser: Browser, svg: string): Promise<Uint8Array> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const data = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.9);
    }, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    if (!data.startsWith('data:image/webp;base64,')) throw new Error('Chromium could not encode a WebP');
    return new Uint8Array(Buffer.from(data.slice('data:image/webp;base64,'.length), 'base64'));
  } finally {
    await context.close();
  }
}

/** Log a page's errors (an uncaught exception, a console error) under `label`. */
export function watchPage(page: Page, label: string, log: (line: string) => void): void {
  page.on('pageerror', (e) => log(`  [${label}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') log(`  [${label}] console: ${m.text()}`);
  });
}
