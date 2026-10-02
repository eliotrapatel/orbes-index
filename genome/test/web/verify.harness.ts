/**
 * End-to-end harness for the verification web app: a real server (buildApp
 * on an in-memory database, listening on an ephemeral port) serving a fresh
 * web build, a seeded catalogue, issued products, PNG renderings of their
 * codes, and a Chromium page through playwright-core.
 *
 * Shared by test/web/verify.e2e.test.ts and the screenshot script
 * (scripts are not allowed to own test helpers, so it lives here).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright-core';
import { buildWeb } from '../../scripts/build-web.js';
import { fromBase64Url } from '../../src/core/bytes.js';
import { encodeOrbesCode, renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig, type AppConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import type { IssueProductInput, IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { simulateCapture } from '../support/camera-sim.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { svgToGray, type GrayImage } from '../support/raster.js';
import { writeY4m } from '../support/y4m.js';

export const CHROMIUM_PATH = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/** iPhone 12–15 logical viewport. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

export interface VerifyServer {
  origin: string;
  ctx: AppContext;
  app: FastifyInstance;
  webDir: string;
  workDir: string;
  modelId: string;
  issue(extra?: Partial<IssueProductInput>): Promise<IssueResult>;
  close(): Promise<void>;
}

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

/**
 * Build the web apps into a temp dir and start the API + static server on 127.0.0.1.
 * `clientServices`: the ORBES Client Services contact the server publishes (none by default).
 */
export async function startVerifyServer(opts: { rateLimits?: { verifyPerMinute?: number }; clientServices?: AppConfig['clientServices'] } = {}): Promise<VerifyServer> {
  const workDir = mkdtempSync(join(tmpdir(), 'orbes-verify-e2e-'));
  const webDir = join(workDir, 'web');
  await buildWeb({ outDir: webDir, mode: 'production' });

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let t: TestDb | undefined;
  let ctx: AppContext | undefined;
  let app: FastifyInstance | undefined;
  try {
    t = await createTestDb();
    const config = testConfig({
      publicOrigin: origin,
      host: '127.0.0.1',
      port,
      rateLimits: { verifyPerMinute: opts.rateLimits?.verifyPerMinute ?? 600 },
      ...(opts.clientServices ? { clientServices: opts.clientServices } : {}),
    });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    const c = ctx;
    if (!(await c.categories.getByCode('J'))) await c.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    const category = (await c.categories.getByCode('J'))!;
    const collection = await c.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    const model = await c.db
      .insertInto('models')
      .values({
        category_id: category.index,
        collection_id: collection.id,
        name: 'MONOLITHE',
        type: 'RING',
        sku_prefix: 'MNL',
        default_material: '925 STERLING SILVER',
        care_instructions: 'Store on its own in the ORBES pouch. Wipe with a soft, dry cloth after wearing; avoid perfume, chlorine and abrasive cleaners.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    app = await buildApp(ctx, { serveStatic: true, staticDir: webDir });
    await app.listen({ port, host: '127.0.0.1' });
    const a = app;
    const db = t;
    return {
      origin,
      ctx: c,
      app: a,
      webDir,
      workDir,
      modelId: model.id,
      issue: (extra = {}) =>
        c.services.issuance.issueProduct({ categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER', year: 2026, ...extra }, SYSTEM_ACTOR),
      async close() {
        await a.close();
        await c.close();
        await db.close();
        rmSync(workDir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await app?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await t?.close().catch(() => {});
    rmSync(workDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * A PNG of an issued code exactly as printed: the framed data from the
 * registry, the core encoder and SVG renderer, rasterised by resvg on a white
 * card with a generous margin (as a photo of the card would show it).
 */
export function renderCodePng(issued: IssueResult, opts: { widthPx?: number; marginPx?: number } = {}): Uint8Array {
  const width = opts.widthPx ?? 900;
  const margin = opts.marginPx ?? Math.round(width * 0.18);
  const model = encodeOrbesCode({ data: fromBase64Url(issued.code.data), genomeGlyphs: issued.genome.glyphs }, { decor: true });
  const inner = renderOrbesCodeSvg(model, { ink: '#0a0a0a', paper: '#ffffff' });
  const total = width + 2 * margin;
  const href = `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}">` +
    `<rect width="${total}" height="${total}" fill="#f6f2ea"/>` +
    `<image x="${margin}" y="${margin}" width="${width}" height="${width}" xlink:href="${href}"/></svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: total }, font: { loadSystemFonts: false }, logLevel: 'off' }).render().asPng();
  return new Uint8Array(png);
}

export function writeCodePng(dir: string, name: string, issued: IssueResult, opts?: { widthPx?: number; marginPx?: number }): string {
  const path = join(dir, name);
  writeFileSync(path, renderCodePng(issued, opts));
  return path;
}

/**
 * A short portrait clip (as a phone's rear camera delivers it) of the issued
 * code held in front of the camera — slight rotation and tilt, soft focus,
 * sensor noise — for Chromium's fake capture device. Chromium loops it.
 */
export function writeCameraY4m(path: string, issued: IssueResult, opts: { width?: number; height?: number; codeWidthPx?: number; frames?: number } = {}): void {
  const width = opts.width ?? 720;
  const height = opts.height ?? 1280;
  const model = encodeOrbesCode({ data: fromBase64Url(issued.code.data), genomeGlyphs: issued.genome.glyphs }, { decor: true });
  const source = svgToGray(renderOrbesCodeSvg(model, { ink: '#0a0a0a', paper: '#ffffff' }), { widthPx: 1000 });
  const frames: GrayImage[] = [];
  const n = opts.frames ?? 6;
  for (let i = 0; i < n; i++) {
    frames.push(
      simulateCapture(
        source,
        {
          frame: { width, height },
          codeWidthPx: opts.codeWidthPx ?? 400,
          rotationDeg: 7 + i * 0.6,
          tiltXDeg: 9,
          tiltYDeg: -6,
          sheetMargin: 0.35,
          background: 0.78,
          paperLevel: 0.93,
          inkLevel: 0.08,
          illumination: { angleDeg: 300, strength: 0.08 },
          vignette: 0.12,
          blurSigma: 0.7,
          noise: { sigma: 2.2, shot: 0.02 },
        },
        1000 + i,
      ),
    );
  }
  writeY4m(path, frames, 10);
}

export async function launchChromium(extra: LaunchOptions = {}): Promise<Browser> {
  return chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, ...extra, args: ['--no-sandbox', ...(extra.args ?? [])] });
}

export async function mobileContext(browser: Browser, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<BrowserContext> {
  return browser.newContext({
    viewport: MOBILE_VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    reducedMotion: opts.reducedMotion ?? 'no-preference',
    locale: 'en-GB',
    timezoneId: 'Europe/Paris',
  });
}
