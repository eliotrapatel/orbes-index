/**
 * ORBES GENOME CODE performance benchmarks.
 *
 *   npx tsx scripts/bench.ts [--only decoder,api,issuance,bundles,growth] [--quick]
 *                            [--frames N] [--free N] [--reps N] [--requests N]
 *                            [--issue N] [--concurrency N] [--no-chromium]
 *                            [--json PATH]
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres \
 *     npx tsx scripts/bench.ts          # adds the real PostgreSQL 16 runs
 *
 * (a) decoder   1280×720 simulated frames (camera simulator, typicalPhone
 *               preset at a random pose: distinct real CODE-01 artifacts; and
 *               code-free frames: a blank tag on a cluttered desk). Decoded
 *               in Node through the web app's frame step (frame-decoder.ts:
 *               RGBA → luma → decodeOrbesCode, camera options) and in
 *               Chromium inside the production decoder Web Worker
 *               (src/web/verify/worker.ts bundled by esbuild with the web
 *               build's targets), frames transferred like the scanner does.
 * (b) api       POST /api/v1/verify through app.inject (no network): 1000
 *               sequential requests over a realistic mix, then the same count
 *               with N in flight; on in-memory PGlite and, when configured,
 *               on a throwaway PostgreSQL database.
 * (c) issuance  issueProduct (serial allocation, Ed25519 sign + self-check,
 *               genome, code, audit chain) sequential and concurrent.
 * (d) bundles   production web build: raw, gzip -9 and brotli -11 sizes.
 * (e) growth    GROWTH (plan NEXT-NINE, BP-29), only with `--only growth`: 50 000
 *               accounts, 100 000 pieces and 40 000 paid orders with their
 *               invoices written in bulk, then GET /api/admin/growth and the first
 *               page of GET /api/admin/growth/collectors through app.inject, as an
 *               AUDITOR, on PGlite and, when configured, on PostgreSQL. bench.ts
 *               has no VPS profile: the VPS figure is the p95 × 2 (the factor of
 *               scripts/live-load.ts `--vps-factor 2`), the target under 1 s
 *               (docs/reports/performance.md, « GROWTH at 100 000 pieces »).
 *
 * Prints markdown tables and writes every number to genome/out/bench/results.json
 * (or --json PATH). Frames and request mixes are seeded: same arguments → same
 * work; times depend on the machine and on what else runs on it.
 */
import { DECODER_LATENCY_BUDGET_MS, decoderBudgetIssues } from './decoder-budget.js';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { availableParallelism, cpus, loadavg, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { chromium } from 'playwright-core';
import { fromBase64Url, toBase64Url } from '../src/core/bytes.js';
import { frameCodeData, unframeCodeData } from '../src/core/payload.js';
import { buildApp } from '../src/server/app.js';
import { testConfig } from '../src/server/config.js';
import { createContext, type AppContext } from '../src/server/context.js';
import { closeDb, createDb, type Db } from '../src/server/db/connection.js';
import { MemoryKeyProvider } from '../src/server/keys/memory-provider.js';
import type { IssueResult } from '../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../src/server/types.js';
import { handleDecode } from '../src/web/verify/frame-decoder.js';
import type { DecodeRequest } from '../src/web/verify/protocol.js';
import { capture, makeCode } from '../test/decoder/fixtures.js';
import { PRESETS, simulateCapture } from '../test/support/camera-sim.js';
import { Prng } from '../test/support/prng.js';
import { grayToRgba, type GrayImage } from '../test/support/raster.js';
import { seedGrowthHouse } from '../test/support/growth.js';
import { BROWSER_TARGETS, buildWeb } from './build-web.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM_PATH = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ORIGIN = 'https://verify.orbes.bench';

// ── Options ────────────────────────────────────────────────────────────────

type Section = 'decoder' | 'api' | 'issuance' | 'bundles' | 'growth';

interface Options {
  only: Set<Section>;
  frames: number;
  free: number;
  reps: number;
  warmup: number;
  requests: number;
  issue: number;
  concurrency: number;
  chromium: boolean;
  json: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    only: new Set(['decoder', 'api', 'issuance', 'bundles']),
    frames: 24,
    free: 12,
    reps: 3,
    warmup: 6,
    requests: 1000,
    issue: 200,
    concurrency: 8,
    chromium: true,
    json: join(ROOT, 'out', 'bench', 'results.json'),
  };
  const num = (v: string | undefined, name: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} needs a positive integer`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') {
      const list = (argv[++i] ?? '').split(',').map((s) => s.trim()) as Section[];
      for (const s of list) if (!['decoder', 'api', 'issuance', 'bundles', 'growth'].includes(s)) throw new Error(`unknown section ${s}`);
      o.only = new Set(list);
    } else if (a === '--quick') Object.assign(o, { frames: 6, free: 4, reps: 1, warmup: 2, requests: 200, issue: 40 });
    else if (a === '--frames') o.frames = num(argv[++i], a);
    else if (a === '--free') o.free = num(argv[++i], a);
    else if (a === '--reps') o.reps = num(argv[++i], a);
    else if (a === '--requests') o.requests = num(argv[++i], a);
    else if (a === '--issue') o.issue = num(argv[++i], a);
    else if (a === '--concurrency') o.concurrency = num(argv[++i], a);
    else if (a === '--no-chromium') o.chromium = false;
    else if (a === '--json') o.json = resolve(argv[++i] ?? '');
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

// ── Statistics ─────────────────────────────────────────────────────────────

interface Stats {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
}

/** Nearest-rank percentiles. */
function stats(values: readonly number[]): Stats {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, mean: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN, min: NaN };
  const q = (p: number) => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n, mean: r(v.reduce((a, b) => a + b, 0) / n), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(v[n - 1]), min: r(v[0]) };
}

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function table(head: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

const log = (s = '') => process.stdout.write(`${s}\n`);

// ── Machine ────────────────────────────────────────────────────────────────

function machineInfo(): Record<string, unknown> {
  let model = cpus()[0]?.model ?? 'unknown';
  try {
    model = /model name\s*:\s*(.+)/.exec(readFileSync('/proc/cpuinfo', 'utf8'))?.[1]?.trim() ?? model;
  } catch {
    // not Linux
  }
  let nproc = availableParallelism();
  try {
    nproc = Number(execFileSync('nproc', { encoding: 'utf8' }).trim()) || nproc;
  } catch {
    // keep availableParallelism()
  }
  return {
    nproc,
    cpuModel: model,
    memoryGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    kernel: release(),
    node: process.version,
    loadAverageAtStart: loadavg().map((x) => Math.round(x * 100) / 100),
  };
}

// ── (a) Decoder ────────────────────────────────────────────────────────────

interface Frame {
  kind: 'code' | 'free';
  gray: GrayImage;
  /** base64url of the framed data the frame carries (null: code-free). */
  expect: string | null;
}

/** typicalPhone at a random pose (any rotation, tilt ±12°, off-centre), like the scan matrix. */
function phonePose(rng: Prng) {
  return {
    ...PRESETS.typicalPhone,
    rotationDeg: rng.range(0, 360),
    tiltXDeg: rng.range(-12, 12),
    tiltYDeg: rng.range(-12, 12),
    offset: { x: rng.range(-60, 60), y: rng.range(-40, 40) },
  };
}

function benchFrames(nCode: number, nFree: number): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < nCode; i++) {
    const rng = new Prng(`bench-code#${i}`);
    const code = makeCode(5000 + i);
    // 8 px per CODE-01 unit: the typicalPhone size (a 400 px wide artifact in a 1280×720 frame).
    frames.push({ kind: 'code', gray: capture(code, 8, phonePose(rng), rng.u32()), expect: toBase64Url(code.data) });
  }
  const blank: GrayImage = { width: 800, height: 800, data: new Uint8Array(800 * 800).fill(255) };
  for (let i = 0; i < nFree; i++) {
    const rng = new Prng(`bench-free#${i}`);
    frames.push({ kind: 'free', gray: simulateCapture(blank, { ...phonePose(rng), codeWidthPx: 400 }, rng.u32()), expect: null });
  }
  return frames;
}

interface DecodeSample {
  kind: 'code' | 'free';
  ok: boolean;
  correct: boolean;
  /** Node: wall time of the frame step. Chromium: page → worker → page round trip. */
  wallMs: number;
  /** Inside the frame step: RGBA → luma, decodeOrbesCode, total. */
  grayMs: number;
  decodeMs: number;
  reason: string | null;
}

interface DecoderRun {
  env: string;
  coldFirstFrameMs: number;
  samples: DecodeSample[];
}

const CAMERA_OPTIONS: DecodeRequest['options'] = { tryInverted: true, tryMirrored: false, readGenome: true };

function decodeInNode(frames: Frame[], reps: number, warmup: number): DecoderRun {
  const rgba = frames.map((f) => grayToRgba(f.gray));
  const run = (i: number, id: number) => {
    const f = frames[i];
    const req: DecodeRequest = { type: 'decode', id, width: f.gray.width, height: f.gray.height, buffer: rgba[i].buffer as ArrayBuffer, options: CAMERA_OPTIONS };
    const t0 = performance.now();
    const reply = handleDecode(req);
    const wallMs = performance.now() - t0;
    const correct = reply.ok && reply.decoded.code === f.expect;
    return { reply, wallMs, correct };
  };
  const cold = run(0, 0).wallMs;
  for (let w = 0; w < warmup; w++) run(w % frames.length, 0);
  const samples: DecodeSample[] = [];
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < frames.length; i++) {
      const { reply, wallMs, correct } = run(i, i);
      samples.push({
        kind: frames[i].kind,
        ok: reply.ok,
        correct: frames[i].kind === 'code' ? correct : !reply.ok,
        wallMs,
        grayMs: reply.timing.grayMs,
        decodeMs: reply.timing.decodeMs,
        reason: reply.ok ? null : reply.reason,
      });
    }
  }
  return { env: `Node ${process.version}`, coldFirstFrameMs: cold, samples };
}

/** Runs in the page. Plain JS (a string): the bundler must not rewrite it. */
const PAGE_BENCH = `async (cfg) => {
  const worker = new Worker('/worker.js', { type: 'module', name: 'orbes-decoder-bench' });
  await new Promise((resolve, reject) => {
    worker.onmessage = (e) => { if (e.data && e.data.type === 'ready') resolve(); };
    worker.onerror = (e) => reject(new Error('worker failed: ' + (e.message || 'error')));
  });
  const frames = [];
  for (const f of cfg.frames) {
    const gray = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
    const rgba = new Uint8ClampedArray(f.width * f.height * 4);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = gray[i]; rgba[p + 3] = 255; }
    frames.push({ ...f, rgba });
  }
  let id = 0;
  const decode = (f) => new Promise((resolve) => {
    // A fresh buffer per frame, transferred (zero copy) like the scanner's ImageData.
    const buffer = f.rgba.buffer.slice(0);
    const myId = ++id;
    worker.onmessage = (e) => {
      const m = e.data;
      if (!m || m.type !== 'result' || m.id !== myId) return;
      resolve({ wallMs: performance.now() - t0, ok: m.ok === true, code: m.ok ? m.decoded.code : null, reason: m.ok ? null : m.reason, timing: m.timing });
    };
    const t0 = performance.now();
    worker.postMessage({ type: 'decode', id: myId, width: f.width, height: f.height, buffer, options: cfg.options }, [buffer]);
  });
  const cold = await decode(frames[0]);
  for (let w = 0; w < cfg.warmup; w++) await decode(frames[w % frames.length]);
  const results = [];
  for (let r = 0; r < cfg.reps; r++) {
    for (let i = 0; i < frames.length; i++) results.push({ i, ...(await decode(frames[i])) });
  }
  worker.terminate();
  return { cold: cold.wallMs, results, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
}`;

async function bundleWorker(): Promise<{ code: string; bytes: number }> {
  const r = await esbuild.build({
    entryPoints: [join(ROOT, 'src', 'web', 'verify', 'worker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: BROWSER_TARGETS,
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const code = r.outputFiles[0].text;
  return { code, bytes: Buffer.byteLength(code) };
}

async function decodeInChromium(frames: Frame[], reps: number, warmup: number): Promise<DecoderRun & { browser: string; workerBytes: number }> {
  const worker = await bundleWorker();
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset="utf-8"><title>ORBES decoder bench</title><body></body>');
    } else if (url === '/worker.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.end(worker.code);
    } else if (url.startsWith('/frame/')) {
      const f = frames[Number(url.slice(7))];
      if (!f) return void res.writeHead(404).end();
      res.setHeader('content-type', 'application/octet-stream');
      res.end(Buffer.from(f.gray.data.buffer, f.gray.data.byteOffset, f.gray.data.byteLength));
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    const cfg = {
      frames: frames.map((f, i) => ({ url: `/frame/${i}`, width: f.gray.width, height: f.gray.height })),
      options: CAMERA_OPTIONS,
      reps,
      warmup,
    };
    const out = (await page.evaluate(`(${PAGE_BENCH})(${JSON.stringify(cfg)})`)) as {
      cold: number;
      results: { i: number; wallMs: number; ok: boolean; code: string | null; reason: string | null; timing: { grayMs: number; decodeMs: number } }[];
      userAgent: string;
      hardwareConcurrency: number;
    };
    const samples: DecodeSample[] = out.results.map((r) => {
      const f = frames[r.i];
      return {
        kind: f.kind,
        ok: r.ok,
        correct: f.kind === 'code' ? r.ok && r.code === f.expect : !r.ok,
        wallMs: r.wallMs,
        grayMs: r.timing.grayMs,
        decodeMs: r.timing.decodeMs,
        reason: r.reason,
      };
    });
    return { env: `Chromium ${browser.version()} (headless, Web Worker)`, browser: browser.version(), coldFirstFrameMs: out.cold, samples, workerBytes: worker.bytes };
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function summarizeDecoder(run: DecoderRun) {
  const by = (kind: 'code' | 'free') => {
    const s = run.samples.filter((x) => x.kind === kind);
    const reasons: Record<string, number> = {};
    for (const x of s) if (x.reason) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
    return {
      samples: s.length,
      decodedCorrectly: s.filter((x) => x.correct).length,
      wallMs: stats(s.map((x) => x.wallMs)),
      decodeMs: stats(s.map((x) => x.decodeMs)),
      grayMs: stats(s.map((x) => x.grayMs)),
      reasons,
    };
  };
  return { env: run.env, coldFirstFrameMs: Math.round(run.coldFirstFrameMs * 10) / 10, code: by('code'), free: by('free') };
}

async function benchDecoder(o: Options) {
  log('## (a) Decoder latency, 1280×720 frames\n');
  const t0 = performance.now();
  const frames = benchFrames(o.frames, o.free);
  log(`generated ${frames.length} frames (${o.frames} with a code, ${o.free} code-free) in ${fmt((performance.now() - t0) / 1000)} s`);
  const node = summarizeDecoder(decodeInNode(frames, o.reps, o.warmup));
  let browser: (ReturnType<typeof summarizeDecoder> & { workerBundleBytes: number }) | null = null;
  if (o.chromium && existsSync(CHROMIUM_PATH)) {
    const run = await decodeInChromium(frames, o.reps, o.warmup);
    browser = { ...summarizeDecoder(run), workerBundleBytes: run.workerBytes };
  } else log('(Chromium run skipped)');
  const rows: (string | number)[][] = [];
  for (const r of [node, browser]) {
    if (!r) continue;
    for (const kind of ['code', 'free'] as const) {
      const k = r[kind];
      rows.push([
        r.env,
        kind === 'code' ? 'typicalPhone, code' : 'code-free',
        `${k.decodedCorrectly}/${k.samples}`,
        fmt(k.wallMs.p50),
        fmt(k.wallMs.p95),
        fmt(k.wallMs.max),
        fmt(k.decodeMs.p50),
        fmt(k.grayMs.p50),
      ]);
    }
  }
  log(table(['environment', 'frames', 'correct', 'p50 ms', 'p95 ms', 'max ms', 'decode p50', 'RGBA→luma p50'], rows));
  log(`\ncold first frame: Node ${fmt(node.coldFirstFrameMs)} ms${browser ? `, Chromium worker ${fmt(browser.coldFirstFrameMs)} ms` : ''}\n`);
  // ORBES-CODE-SPEC §10 budget, judged on the production path (the Chromium worker) only.
  let budget: { checked: boolean; issues: string[] } = { checked: false, issues: [] };
  if (browser) {
    const issues = decoderBudgetIssues({ code: { p50: browser.code.wallMs.p50 }, free: { p50: browser.free.wallMs.p50, p95: browser.free.wallMs.p95 } });
    budget = { checked: true, issues };
    const b = DECODER_LATENCY_BUDGET_MS;
    log(`latency budget (ORBES-CODE-SPEC §10: code p50 < ${b.codeP50} ms; code-free p50 < ${b.freeP50} ms, p95 < ${b.freeP95} ms): ${issues.length === 0 ? 'PASS' : `FAIL — ${issues.join('; ')}`}\n`);
    if (issues.length > 0) process.exitCode = 1;
  } else log('latency budget: not checked (no Chromium run)\n');
  return { frames: { code: o.frames, free: o.free, width: 1280, height: 720, reps: o.reps, warmup: o.warmup }, node, chromium: browser, budget };
}

// ── (b) Verify API and (c) issuance: shared world ──────────────────────────

interface World {
  label: string;
  ctx: AppContext;
  app: FastifyInstance;
  modelId: string;
  collectionId: string;
  close(): Promise<void>;
}

async function openWorld(label: string, databaseUrl: string, onClose: () => Promise<void> = async () => {}): Promise<World> {
  const config = testConfig({
    databaseUrl,
    publicOrigin: ORIGIN,
    rateLimits: { verifyPerMinute: 10_000_000, authPerMinute: 10_000_000, adminPerMinute: 10_000_000 },
  });
  const ctx = await createContext(config, { migrate: true, ensureActiveKey: true, keyProvider: new MemoryKeyProvider({ env: 'test' }) });
  try {
    const app = await buildApp(ctx, { serveStatic: false });
    if (!(await ctx.categories.getByCode('J'))) await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    const category = (await ctx.categories.getByCode('J'))!;
    const col = await ctx.db.insertInto('collections').values({ name: `ORBIT-${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow();
    const model = await ctx.db
      .insertInto('models')
      .values({
        category_id: category.index,
        collection_id: col.id,
        name: 'MONOLITHE',
        type: 'RING',
        sku_prefix: `MNL-${randomUUID().slice(0, 6).toUpperCase()}`,
        default_material: '925 STERLING SILVER',
        care_instructions: 'Wipe with a soft, dry cloth after wearing.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      label,
      ctx,
      app,
      modelId: model.id,
      collectionId: col.id,
      async close() {
        await app.close();
        await ctx.close();
        await onClose();
      },
    };
  } catch (e) {
    await ctx.close().catch(() => {});
    await onClose().catch(() => {});
    throw e;
  }
}

function issueOne(w: World): Promise<IssueResult> {
  return w.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: w.modelId, collectionId: w.collectionId, material: '925 STERLING SILVER', year: 2026 }, SYSTEM_ACTOR);
}

interface Seeded {
  issued: IssueResult[];
  activated: IssueResult[];
  owned: IssueResult[];
  superseded: IssueResult[];
}

/** 40 issued, 30 sold (warranty activated, unregistered), 20 owned, 10 with a superseded code. */
async function seed(w: World): Promise<Seeded> {
  const s: Seeded = { issued: [], activated: [], owned: [], superseded: [] };
  const activate = (r: IssueResult) =>
    w.ctx.services.warranty.activate(r.product.productId, { purchaseDate: new Date().toISOString().slice(0, 10), retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
  for (let i = 0; i < 40; i++) s.issued.push(await issueOne(w));
  for (let i = 0; i < 30; i++) {
    const r = await issueOne(w);
    await activate(r);
    s.activated.push(r);
  }
  for (let i = 0; i < 20; i++) {
    const r = await issueOne(w);
    await activate(r);
    const email = `owner-${randomUUID()}@example.com`;
    const account = await w.ctx.db
      .insertInto('accounts')
      .values({ email, email_normalized: email, password_hash: 'scrypt$15$8$1$x$y' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const out = await w.ctx.services.verification.verify({ code: r.code.data }, { deviceHash: 'seed-device' });
    if (!out.registration) throw new Error(`seed: expected a registration token, got ${out.state}`);
    await w.ctx.services.ownership.registerFirst(account.id, { registrationToken: out.registration.token }, { type: 'account', id: account.id });
    s.owned.push(r);
  }
  for (let i = 0; i < 10; i++) {
    const r = await issueOne(w);
    await w.ctx.services.issuance.reissueCode(r.product.productId, 'damaged label', SYSTEM_ACTOR);
    s.superseded.push(r);
  }
  return s;
}

interface VerifyRequest {
  kind: 'issued' | 'activated' | 'owned' | 'superseded' | 'invalid-signature' | 'malformed';
  body: unknown;
  device: number;
  ip: number;
}

function flipSignatureBit(code: string): string {
  const { payloadBytes, signature } = unframeCodeData(fromBase64Url(code));
  const sig = signature.slice();
  sig[5] ^= 0x10;
  return toBase64Url(frameCodeData(payloadBytes, sig));
}

/**
 * The request mix, seeded: 5 % invalid signatures (flipped bit, valid CRC),
 * 5 % malformed codes (corrupted framing), 90 % genuine codes spread over the
 * seeded products (issued 40 %, sold 30 %, owned 20 %, superseded 10 %), each
 * with the genome reading and client metrics the web app sends; 30 devices
 * (server-issued device cookies) behind 40 addresses.
 */
function requestMix(s: Seeded, n: number, label: string): VerifyRequest[] {
  const rng = new Prng(`verify-mix/${label}`);
  const genuine = (r: IssueResult) => ({
    code: r.code.data,
    genome: { glyphs: [...r.genome.glyphs], confidence: r.genome.glyphs.map(() => Math.round(rng.range(0.6, 0.99) * 1000) / 1000) },
    client: { rsErrors: rng.int(0, 6), rsErasures: 0, moduleSizePx: Math.round(rng.range(4, 9) * 100) / 100, decodeMs: rng.int(40, 300), source: 'camera' as const },
  });
  const out: VerifyRequest[] = [];
  for (let i = 0; i < n; i++) {
    const device = rng.int(0, 29);
    const ip = rng.int(0, 39);
    const slot = i % 20;
    if (slot === 0) {
      out.push({ kind: 'invalid-signature', body: { code: flipSignatureBit(rng.pick(s.issued).code.data) }, device, ip });
    } else if (slot === 1) {
      const raw = fromBase64Url(rng.pick(s.issued).code.data);
      raw[rng.int(0, raw.length - 1)] ^= 0xff; // breaks the CRC
      out.push({ kind: 'malformed', body: { code: toBase64Url(raw) }, device, ip });
    } else {
      const u = rng.float();
      const kind = u < 0.4 ? 'issued' : u < 0.7 ? 'activated' : u < 0.9 ? 'owned' : 'superseded';
      out.push({ kind, body: genuine(rng.pick(s[kind])), device, ip });
    }
  }
  return out;
}

interface Sample {
  ms: number;
  status: number;
  state: string;
  kind: VerifyRequest['kind'];
}

async function inject(w: World, req: VerifyRequest, devices: Map<number, string>): Promise<Sample> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    origin: ORIGIN,
  };
  const cookie = devices.get(req.device);
  if (cookie) headers.cookie = cookie;
  const payload = JSON.stringify(req.body);
  const t0 = performance.now();
  const res = await w.app.inject({ method: 'POST', url: '/api/v1/verify', headers, payload, remoteAddress: `198.51.100.${req.ip + 1}` });
  const ms = performance.now() - t0;
  const set = (res.cookies as { name: string; value: string }[]).find((c) => c.name === 'orbes_device');
  if (set) devices.set(req.device, `orbes_device=${set.value}`);
  let state = `HTTP ${res.statusCode}`;
  try {
    state = (JSON.parse(res.body) as { state?: string }).state ?? state;
  } catch {
    // keep the status
  }
  return { ms, status: res.statusCode, state, kind: req.kind };
}

function summarizeSamples(samples: Sample[]) {
  const states: Record<string, number> = {};
  for (const s of samples) states[s.state] = (states[s.state] ?? 0) + 1;
  const byKind: Record<string, Stats> = {};
  for (const kind of new Set(samples.map((s) => s.kind))) byKind[kind] = stats(samples.filter((s) => s.kind === kind).map((s) => s.ms));
  return { latencyMs: stats(samples.map((s) => s.ms)), states, byKind, non200: samples.filter((s) => s.status !== 200).length };
}

async function benchApi(w: World, s: Seeded, o: Options) {
  const devices = new Map<number, string>();
  // Warm-up (JIT, prepared statements, caches): not measured.
  for (const req of requestMix(s, 50, `${w.label}/warmup`)) await inject(w, req, devices);

  const sequential: Sample[] = [];
  const t0 = performance.now();
  for (const req of requestMix(s, o.requests, `${w.label}/sequential`)) sequential.push(await inject(w, req, devices));
  const seqWall = performance.now() - t0;

  const queue = requestMix(s, o.requests, `${w.label}/concurrent`);
  const concurrent: Sample[] = [];
  let next = 0;
  const t1 = performance.now();
  await Promise.all(
    Array.from({ length: o.concurrency }, async () => {
      while (next < queue.length) {
        const req = queue[next++];
        concurrent.push(await inject(w, req, devices));
      }
    }),
  );
  const conWall = performance.now() - t1;
  return {
    sequential: { ...summarizeSamples(sequential), requests: o.requests, wallS: Math.round(seqWall) / 1000, perSecond: Math.round((o.requests / seqWall) * 1000 * 10) / 10 },
    concurrent: { ...summarizeSamples(concurrent), requests: o.requests, inFlight: o.concurrency, wallS: Math.round(conWall) / 1000, perSecond: Math.round((o.requests / conWall) * 1000 * 10) / 10 },
  };
}

async function benchIssuance(w: World, o: Options) {
  const seqMs: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < o.issue; i++) {
    const t = performance.now();
    await issueOne(w);
    seqMs.push(performance.now() - t);
  }
  const seqWall = performance.now() - t0;
  const conMs: number[] = [];
  let left = o.issue;
  const t1 = performance.now();
  await Promise.all(
    Array.from({ length: o.concurrency }, async () => {
      while (left > 0) {
        left--;
        const t = performance.now();
        await issueOne(w);
        conMs.push(performance.now() - t);
      }
    }),
  );
  const conWall = performance.now() - t1;
  return {
    sequential: { issued: o.issue, perSecond: Math.round((o.issue / seqWall) * 1000 * 10) / 10, latencyMs: stats(seqMs) },
    concurrent: { issued: o.issue, inFlight: o.concurrency, perSecond: Math.round((o.issue / conWall) * 1000 * 10) / 10, latencyMs: stats(conMs) },
  };
}

async function benchDatabase(label: string, open: () => Promise<World>, o: Options) {
  log(`### ${label}\n`);
  const w = await open();
  try {
    let serverVersion: string | null = null;
    try {
      serverVersion = (await sql<{ v: string }>`SELECT current_setting('server_version') AS v`.execute(w.ctx.db)).rows[0]?.v ?? null;
    } catch {
      serverVersion = null;
    }
    const t0 = performance.now();
    const seeded = await seed(w);
    const seedS = Math.round(performance.now() - t0) / 1000;
    const result: Record<string, unknown> = { label, serverVersion, seed: { products: 100, seconds: seedS } };
    if (o.only.has('api')) {
      const api = await benchApi(w, seeded, o);
      result.api = api;
      const row = (name: string, r: ReturnType<typeof summarizeSamples> & { perSecond: number }) => [
        name,
        r.latencyMs.n,
        fmt(r.latencyMs.p50),
        fmt(r.latencyMs.p95),
        fmt(r.latencyMs.p99),
        fmt(r.latencyMs.max),
        fmt(r.perSecond),
        r.non200,
      ];
      log(table(['POST /api/v1/verify', 'n', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'req/s', 'non-200'], [row('sequential', api.sequential), row(`${o.concurrency} in flight`, api.concurrent)]));
      log(`\nstates (sequential): ${JSON.stringify(api.sequential.states)}`);
      log(`p95 by request kind (sequential): ${Object.entries(api.sequential.byKind).map(([k, v]) => `${k} ${fmt(v.p95)}`).join(', ')}\n`);
    }
    if (o.only.has('issuance')) {
      const iss = await benchIssuance(w, o);
      result.issuance = iss;
      log(
        table(
          ['issueProduct', 'n', 'products/s', 'p50 ms', 'p95 ms', 'max ms'],
          [
            ['sequential', iss.sequential.issued, fmt(iss.sequential.perSecond), fmt(iss.sequential.latencyMs.p50), fmt(iss.sequential.latencyMs.p95), fmt(iss.sequential.latencyMs.max)],
            [`${o.concurrency} in flight`, iss.concurrent.issued, fmt(iss.concurrent.perSecond), fmt(iss.concurrent.latencyMs.p50), fmt(iss.concurrent.latencyMs.p95), fmt(iss.concurrent.latencyMs.max)],
          ],
        ),
      );
      log('');
    }
    return result;
  } finally {
    await w.close();
  }
}

async function benchDatabases(o: Options) {
  log('## (b) Verify API latency and (c) issuance throughput\n');
  const out: Record<string, unknown> = {};
  out.pglite = await benchDatabase('PGlite (in-memory, WASM)', () => openWorld('pglite', 'pglite:memory'), o);
  const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
  if (pgUrl) {
    const admin: Db = createDb(pgUrl);
    const dbName = `orbes_bench_${randomBytes(6).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(pgUrl);
    u.pathname = `/${dbName}`;
    try {
      out.postgres = await benchDatabase('PostgreSQL (pg pool of 10, localhost)', () => openWorld('postgres', u.toString()), o);
    } finally {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  } else {
    log('(PostgreSQL skipped: set ORBES_TEST_POSTGRES_URL to a role with CREATEDB)\n');
    out.postgres = null;
  }
  return out;
}

// ── (d) Bundles ────────────────────────────────────────────────────────────

async function benchBundles() {
  log('## (d) Web bundle sizes (production build)\n');
  const dir = mkdtempSync(join(tmpdir(), 'orbes-bench-web-'));
  try {
    const built = await buildWeb({ outDir: join(dir, 'web'), mode: 'production' });
    const files: { app: string; role: string; path: string; raw: number; gzip: number; brotli: number }[] = [];
    const measure = (app: string, role: string, path: string) => {
      const bytes = readFileSync(join(built.outDir, path));
      files.push({
        app,
        role,
        path,
        raw: statSync(join(built.outDir, path)).size,
        gzip: gzipSync(bytes, { level: 9 }).length,
        brotli: brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).length,
      });
    };
    for (const app of built.apps) {
      measure(app.name, 'html', `${app.name}/index.html`);
      for (const [ref, url] of Object.entries(app.assets)) {
        const role = ref === 'main.ts' ? 'main js' : ref === 'worker.ts' ? 'worker js' : ref === 'styles.css' ? 'css' : ref;
        measure(app.name, role, url.replace(/^\//, ''));
      }
    }
    const firstLoad = (app: string) => {
      const f = files.filter((x) => x.app === app && ['html', 'main js', 'css'].includes(x.role));
      return { raw: f.reduce((a, b) => a + b.raw, 0), gzip: f.reduce((a, b) => a + b.gzip, 0), brotli: f.reduce((a, b) => a + b.brotli, 0) };
    };
    const apps = [...new Set(files.map((f) => f.app))];
    log(table(['app', 'file', 'raw', 'gzip -9', 'brotli -11'], files.map((f) => [f.app, f.role, kb(f.raw), kb(f.gzip), kb(f.brotli)])));
    log('');
    log(table(['app', 'first load (html + js + css)', 'gzip -9', 'brotli -11'], apps.map((a) => [a, kb(firstLoad(a).raw), kb(firstLoad(a).gzip), kb(firstLoad(a).brotli)])));
    log('');
    return { files, firstLoad: Object.fromEntries(apps.map((a) => [a, firstLoad(a)])) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── (e) GROWTH at 100 000 pieces ───────────────────────────────────────────

/** The size of the house GROWTH is measured on (plan NEXT-NINE, §3.9 Tests: Load). */
const GROWTH_BENCH = Object.freeze({ accounts: 50_000, pieces: 100_000, orders: 40_000 });
/** bench.ts has no VPS profile: the VPS figure is the measured p95 × this (scripts/live-load.ts `--vps-factor 2`). */
const GROWTH_VPS_FACTOR = 2;
/** The VPS figure GROWTH must stay under, in milliseconds. */
const GROWTH_VPS_TARGET_MS = 1000;

async function benchGrowth(label: string, open: () => Promise<World>, o: Options) {
  log(`### ${label}\n`);
  const w = await open();
  try {
    const t0 = performance.now();
    await seedGrowthHouse(w.ctx.db, { modelId: w.modelId, ...GROWTH_BENCH });
    const seedS = Math.round(performance.now() - t0) / 1000;
    const counts = await sql<{ accounts: number; pieces: number; orders: number; invoices: number }>`
      SELECT (SELECT count(*) FROM accounts)::int AS accounts, (SELECT count(*) FROM products)::int AS pieces,
             (SELECT count(*) FROM orders)::int AS orders, (SELECT count(*) FROM invoices)::int AS invoices`.execute(w.ctx.db);
    // An AUDITOR's session, as the console reads the page.
    const email = `growth-auditor-${randomUUID().slice(0, 8)}@orbes.bench`;
    const password = 'growth bench passphrase 2026';
    await w.ctx.services.auth.createAdmin({ email, password, role: 'AUDITOR' }, SYSTEM_ACTOR);
    const login = await w.app.inject({ method: 'POST', url: '/api/admin/auth/login', headers: { origin: ORIGIN }, payload: { email, password } });
    if (login.statusCode !== 200) throw new Error(`growth bench: login ${login.statusCode} ${login.body}`);
    const cookie = (login.cookies as { name: string; value: string }[]).map((c) => `${c.name}=${c.value}`).join('; ');
    const timed = async (url: string) => {
      const ms: number[] = [];
      for (let i = 0; i < o.warmup + o.reps * 5; i++) {
        const s0 = performance.now();
        const res = await w.app.inject({ method: 'GET', url, headers: { cookie } });
        const dt = performance.now() - s0;
        if (res.statusCode !== 200) throw new Error(`growth bench: ${url} ${res.statusCode} ${res.body.slice(0, 200)}`);
        if (i >= o.warmup) ms.push(dt);
      }
      return stats(ms);
    };
    const report = await timed('/api/admin/growth');
    const collectors = await timed('/api/admin/growth/collectors');
    const vps = (s: Stats) => Math.round(s.p95 * GROWTH_VPS_FACTOR * 10) / 10;
    const row = (name: string, s: Stats) => [name, s.n, fmt(s.p50), fmt(s.p95), fmt(s.max), fmt(vps(s)), vps(s) < GROWTH_VPS_TARGET_MS ? 'yes' : 'NO'];
    log(`house: ${counts.rows[0]!.accounts} accounts, ${counts.rows[0]!.pieces} pieces, ${counts.rows[0]!.orders} orders, ${counts.rows[0]!.invoices} invoices and credit notes (written in ${seedS} s)\n`);
    log(table(['GET', 'n', 'p50 ms', 'p95 ms', 'max ms', `VPS (p95 × ${GROWTH_VPS_FACTOR}) ms`, `under ${GROWTH_VPS_TARGET_MS} ms`], [row('/api/admin/growth', report), row('/api/admin/growth/collectors (page 1)', collectors)]));
    log('');
    return { label, house: counts.rows[0], seedSeconds: seedS, report: { latencyMs: report, vpsMs: vps(report) }, collectors: { latencyMs: collectors, vpsMs: vps(collectors) }, vpsFactor: GROWTH_VPS_FACTOR, targetMs: GROWTH_VPS_TARGET_MS };
  } finally {
    await w.close();
  }
}

async function benchGrowthDatabases(o: Options) {
  log('## (e) GROWTH at 100 000 pieces\n');
  const out: Record<string, unknown> = {};
  const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
  if (pgUrl) {
    const admin: Db = createDb(pgUrl);
    const dbName = `orbes_bench_${randomBytes(6).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(pgUrl);
    u.pathname = `/${dbName}`;
    try {
      out.postgres = await benchGrowth('PostgreSQL (pg pool of 10, localhost)', () => openWorld('postgres', u.toString()), o);
    } finally {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  } else {
    log('(PostgreSQL skipped: set ORBES_TEST_POSTGRES_URL to a role with CREATEDB; measured on PGlite)\n');
    out.postgres = null;
  }
  out.pglite = await benchGrowth('PGlite (in-memory, WASM)', () => openWorld('pglite', 'pglite:memory'), o);
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const started = new Date();
  const machine = machineInfo();
  log(`# ORBES benchmarks — ${started.toISOString()}\n`);
  log(`machine: ${machine.nproc} × ${machine.cpuModel}, ${machine.memoryGiB} GiB, ${machine.node}, load ${JSON.stringify(machine.loadAverageAtStart)}\n`);
  const results: Record<string, unknown> = { startedAt: started.toISOString(), machine, options: { ...o, only: [...o.only] } };
  if (o.only.has('decoder')) results.decoder = await benchDecoder(o);
  if (o.only.has('api') || o.only.has('issuance')) results.databases = await benchDatabases(o);
  if (o.only.has('bundles')) results.bundles = await benchBundles();
  if (o.only.has('growth')) results.growth = await benchGrowthDatabases(o);
  (results.machine as Record<string, unknown>).loadAverageAtEnd = loadavg().map((x) => Math.round(x * 100) / 100);
  results.durationS = Math.round((Date.now() - started.getTime()) / 100) / 10;
  mkdirSync(dirname(o.json), { recursive: true });
  writeFileSync(o.json, `${JSON.stringify(results, null, 2)}\n`);
  log(`results: ${o.json} (${results.durationS} s)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
});
