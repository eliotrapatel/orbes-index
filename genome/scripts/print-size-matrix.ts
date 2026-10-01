/**
 * ORBES CODE-01 print-size matrix (master specification §30).
 *
 * A PHYSICAL model of a phone scanning a printed code, run through the
 * deterministic camera simulator and the reference decoder:
 *
 *   print size (10…50 mm) × substrate (the 7 renditions of the physical test
 *   sheets) × lens-to-code distance (8…25 cm) × phone profile (Android main,
 *   iPhone main, iPhone Pro main; each at 1× and at 2× digital zoom)
 *
 * For every cell the model derives, from the profile's optics and the
 * scanner's own code, what the decoder actually receives:
 *
 *   • stream 1920×1080 (the scanner asks for 1080p), horizontal field of
 *     view across the 1920 px side → focal length in stream pixels;
 *     2× zoom = sensor crop, i.e. focal length × 2 (Chrome maps `zoom` to the
 *     camera's crop region; a 12 MP sensor still has ≥ 1 sensor px per stream
 *     px at 2×), with a softer base blur;
 *   • the scanner decodes only the square under its reticle:
 *     `cameraCrop()` of src/web/verify/capture.ts for a 390×844 CSS px
 *     portrait viewport (849 px of stream, decoded at native resolution);
 *   • px per mm on the code = f / distance; px per u = that × size / 50;
 *   • the code does not fit when its moon circle (58.5 u) exceeds 90 % of the
 *     crop: the user has to step back (cell marked ▲, not simulated);
 *   • defocus: thin-lens blur circle when the code is closer than the minimum
 *     focus distance (lens parked at its closest focus):
 *       c = A·f_px·(s − d) / ((s − f)·d),  A = f/N,  Gaussian σ = c / 4
 *     (the variance of a uniform disc of diameter c); beyond it, a small
 *     residual autofocus error;
 *   • hand-held capture per trial: distance ±7 %, any rotation, tilt ≤ 12°,
 *     off-centre ≤ 5 % of the crop, hand shake ∝ focal length, exposure ±,
 *     illumination gradient, sensor noise; desk clutter beyond the tag.
 *
 * Trials per cell are adaptive and seeded (see `--screen`, `--confirm`):
 * every simulated cell is screened with up to SCREEN trials; cells that pass
 * it are confirmed with CONFIRM trials where that decides a ≥ 95 % claim.
 * Same arguments → same frames → same table, whatever the worker count.
 *
 *   npx tsx scripts/print-size-matrix.ts [--workers N] [--screen N] [--confirm N]
 *        [--only substrate,…] [--profiles id,…] [--no-write] [--out report.md]
 *   npx tsx scripts/print-size-matrix.ts --from-json out/print-size-matrix.json   (report only)
 *
 * Writes docs/reports/print-size-matrix.md (full runs only, or --out) and the
 * raw results to genome/out/print-size-matrix.json (git-ignored).
 */

import { fork, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '../src/core/bytes.js';
import { CODE01, CODE01_SIZE } from '../src/core/code/profile.js';
import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { cameraCrop } from '../src/web/verify/capture.js';
import { makeCode, renderCode, type CodeFixture, type CodeStyle } from '../test/decoder/fixtures.js';
import { simulateCapture, type CaptureParams, type Substrate } from '../test/support/camera-sim.js';
import { hashSeed, Prng } from '../test/support/prng.js';
import { RENDITIONS, SCAN_DISTANCES_CM, SHEET_SIZES_MM, type Rendition } from './test-sheets.js';

// ── Phone and scanner model ────────────────────────────────────────────────

export interface PhoneProfile {
  id: string;
  label: string;
  family: 'android' | 'iphone' | 'iphone-pro';
  /** Horizontal field of view across the 1920 px side of the 1080p stream. */
  hfovDeg: number;
  /** Closest distance the main camera can focus at. */
  minFocusMm: number;
  /** Physical focal length and f-number (aperture diameter = f / N) for the defocus model. */
  focalMm: number;
  fNumber: number;
  zoom: 1 | 2;
  /** Gaussian sigma (stream px) of lens + demosaicing + ISP at best focus. */
  baseBlurPx: number;
}

const ANDROID = { family: 'android', hfovDeg: 68, minFocusMm: 80, focalMm: 5.2, fNumber: 1.8 } as const;
const IPHONE = { family: 'iphone', hfovDeg: 67, minFocusMm: 120, focalMm: 5.7, fNumber: 1.6 } as const;
const IPHONE_PRO = { family: 'iphone-pro', hfovDeg: 70, minFocusMm: 200, focalMm: 6.86, fNumber: 1.78 } as const;

export const PROFILES: readonly PhoneProfile[] = [
  { id: 'android-1x', label: 'Android main, 1×', ...ANDROID, zoom: 1, baseBlurPx: 0.75 },
  { id: 'android-2x', label: 'Android main, 2× zoom', ...ANDROID, zoom: 2, baseBlurPx: 1.0 },
  { id: 'iphone-1x', label: 'iPhone main, 1×', ...IPHONE, zoom: 1, baseBlurPx: 0.75 },
  { id: 'iphone-2x', label: 'iPhone main, 2× zoom', ...IPHONE, zoom: 2, baseBlurPx: 1.0 },
  { id: 'iphone-pro-1x', label: 'iPhone Pro main, 1×', ...IPHONE_PRO, zoom: 1, baseBlurPx: 0.75 },
  { id: 'iphone-pro-2x', label: 'iPhone Pro main, 2× zoom', ...IPHONE_PRO, zoom: 2, baseBlurPx: 1.0 },
];

export const STREAM = { width: 1920, height: 1080 } as const;
/** Reference phone viewport (CSS px, portrait) and the scanner's reticle rule (styles.css: min(66vw, 40vh, 340px)). */
export const VIEWPORT = { width: 390, height: 844 } as const;
const RETICLE_CSS_PX = Math.min(0.66 * VIEWPORT.width, 0.4 * VIEWPORT.height, 340);
/** The square the scanner hands to the decoder (portrait stream 1080×1920). */
export const CROP = cameraCrop({ width: STREAM.height, height: STREAM.width }, VIEWPORT, RETICLE_CSS_PX);
/** Moon discs reach 27.5 + 1.75 u from the centre: at any rotation the code needs a 58.5 u circle. */
const MOON_CIRCLE_U = 2 * (CODE01.moons.orbitRadius + CODE01.moons.radius);
const FIT_FRACTION = 0.9;

export function focalPx(p: PhoneProfile): number {
  return (p.zoom * (STREAM.width / 2)) / Math.tan(((p.hfovDeg / 2) * Math.PI) / 180);
}

/** Stream pixels per millimetre on a code at `distanceMm`, face-on. */
export function pxPerMm(p: PhoneProfile, distanceMm: number): number {
  return focalPx(p) / distanceMm;
}

/** Defocus blur-circle diameter (stream px) of a code at `distanceMm`; 0 at or beyond the minimum focus distance. */
export function defocusCirclePx(p: PhoneProfile, distanceMm: number): number {
  const s = p.minFocusMm;
  if (distanceMm >= s) return 0;
  const aperture = p.focalMm / p.fNumber;
  return (aperture * focalPx(p) * (s - distanceMm)) / ((s - p.focalMm) * distanceMm);
}

/** True when the whole code (moons included, any rotation) fits the decoded crop with a 10 % margin. */
export function fitsCrop(p: PhoneProfile, sizeMm: number, distanceMm: number): boolean {
  const ppu = (pxPerMm(p, distanceMm) * sizeMm) / CODE01_SIZE;
  return ppu * MOON_CIRCLE_U <= FIT_FRACTION * CROP.sw;
}

// ── Substrates (one per test-sheet rendition) ─────────────────────────────

interface SubstrateModel {
  style: CodeStyle;
  /** Reflectances of the source's light and dark tones (camera-sim paperLevel / inkLevel). */
  light: number;
  dark: number;
  texture: Substrate;
  /** Printed surface around the code: 'tag' = 3 mm cut-out tag on a desk, 'surface' = it fills the view. */
  surround: 'tag' | 'surface';
  /** Radius of curvature of the surface (mm), or 0 for flat. */
  bendRadiusMm: number;
  /** Specular highlight on the surface (metal). */
  glare: boolean;
  note: string;
}

const SUBSTRATE_MODELS: Readonly<Record<string, SubstrateModel>> = {
  'black-on-white': { style: 'classic', light: 0.86, dark: 0.07, texture: 'paper', surround: 'tag', bendRadiusMm: 0, glare: false, note: 'ink 0.07 on paper 0.86, paper fibre texture' },
  'white-on-black': { style: 'inverted', light: 0.8, dark: 0.06, texture: 'paper', surround: 'tag', bendRadiusMm: 0, glare: false, note: 'white 0.80 on black 0.06, inverted polarity' },
  ivory: { style: 'ivory', light: 0.86, dark: 0.07, texture: 'paper', surround: 'tag', bendRadiusMm: 0, glare: false, note: 'ivory style (#111111 on #F6F2EA) mapped to 0.07…0.86' },
  'matte-grey': { style: 'classic', light: 0.79, dark: 0.07, texture: 'paper', surround: 'tag', bendRadiusMm: 0, glare: false, note: 'ink 0.07 on 92 % grey 0.79' },
  'textured-paper': { style: 'classic', light: 0.84, dark: 0.09, texture: 'textured-paper', surround: 'tag', bendRadiusMm: 0, glare: false, note: 'textured stock, ink 0.09 on 0.84' },
  'black-leather': { style: 'inverted', light: 0.62, dark: 0.09, texture: 'leather', surround: 'surface', bendRadiusMm: 150, glare: false, note: 'light ink 0.62 on leather 0.09, pebble grain, bag panel bent at R 150 mm' },
  metallic: { style: 'classic', light: 0.62, dark: 0.25, texture: 'brushed-metal', surround: 'surface', bendRadiusMm: 0, glare: true, note: 'engraving 0.25 on brushed metal 0.62, specular stripe, no decor' },
};

function modelFor(r: Rendition): SubstrateModel {
  const m = SUBSTRATE_MODELS[r.id];
  if (!m) throw new Error(`no simulator model for rendition ${r.id}`);
  return m;
}

// ── Trials ─────────────────────────────────────────────────────────────────

const TAG_PAD_MM = 3;
const CODE_POOL = 6;
/** Source rasters at a few fixed resolutions keep the render cache effective. */
const SOURCE_LADDER = [16, 24, 32, 48];

const codePool = new Map<string, CodeFixture>();
function poolCode(index: number, decor: boolean): CodeFixture {
  const key = `${index}/${decor}`;
  let c = codePool.get(key);
  if (!c) {
    c = makeCode(7000 + index, { decor });
    codePool.set(key, c);
  }
  return c;
}

export interface TrialSetup {
  params: CaptureParams;
  /** Face-on px per u at the trial's actual distance. */
  pxPerU: number;
  blurSigmaPx: number;
}

/** Capture parameters of one hand-held trial (pure function of its seed). */
export function trialSetup(r: Rendition, p: PhoneProfile, sizeMm: number, distanceCm: number, rng: Prng): TrialSetup {
  const m = modelFor(r);
  const f = focalPx(p);
  const dist = distanceCm * 10 * rng.range(0.93, 1.07);
  const pxPerU = ((f / dist) * sizeMm) / CODE01_SIZE;
  const defocus = defocusCirclePx(p, dist) / 4;
  const autofocus = dist >= p.minFocusMm ? rng.range(0, 0.35) : 0;
  const blurSigmaPx = Math.hypot(p.baseBlurPx, defocus, autofocus);
  const tilt = rng.range(0, 12);
  const axis = rng.range(0, 2 * Math.PI);
  const exposure = rng.range(0.9, 1.04);
  const shake = rng.range(0, 1.2) * p.zoom;
  const margin = m.surround === 'surface' ? Infinity : TAG_PAD_MM / sizeMm;
  const params: CaptureParams = {
    frame: { width: CROP.sw, height: CROP.sw },
    downscale: CROP.sw / CROP.tw,
    focalLengthPx: f,
    codeWidthPx: pxPerU * CODE01_SIZE,
    rotationDeg: rng.range(0, 360),
    tiltXDeg: tilt * Math.cos(axis),
    tiltYDeg: tilt * Math.sin(axis),
    offset: { x: rng.range(-0.05, 0.05) * CROP.sw, y: rng.range(-0.05, 0.05) * CROP.sw },
    barrelK1: 0.02,
    curvature: m.bendRadiusMm > 0 ? sizeMm / m.bendRadiusMm : 0,
    sheetMargin: margin,
    background: { kind: 'clutter', level: 0.3, contrast: 0.5 },
    substrate: m.texture,
    paperLevel: Math.min(1, m.light * exposure),
    inkLevel: Math.min(1, m.dark * exposure),
    illumination: { angleDeg: rng.range(0, 360), strength: rng.range(0.05, 0.2) },
    vignette: 0.08,
    blurSigma: blurSigmaPx,
    ...(shake >= 0.3 ? { motionBlur: { lengthPx: shake, angleDeg: rng.range(0, 180) } } : {}),
    noise: { sigma: rng.range(1.2, 2.6), shot: 0.06 },
    ...(m.glare
      ? { glare: { x: rng.range(0.3, 0.7), y: rng.range(0.3, 0.7), radius: 0.45, aspect: 0.12, angleDeg: rng.range(0, 180), intensity: rng.range(0.25, 0.55) } }
      : {}),
  };
  return { params, pxPerU, blurSigmaPx };
}

/** One seeded trial: simulate, decode as the scanner would, compare all 79 bytes. */
function runTrial(r: Rendition, p: PhoneProfile, sizeMm: number, distanceCm: number, t: number): { ok: boolean; reason: string } {
  const rng = new Prng(hashSeed('print-size-matrix', r.id, p.id, distanceCm, sizeMm, t));
  const { params, pxPerU } = trialSetup(r, p, sizeMm, distanceCm, rng);
  const code = poolCode(t % CODE_POOL, r.decor);
  const srcPxPerU = SOURCE_LADDER.find((s) => s >= 1.5 * pxPerU) ?? SOURCE_LADDER[SOURCE_LADDER.length - 1];
  const source = renderCode(code, srcPxPerU, modelFor(r).style);
  const frame = simulateCapture(source, params, rng.u32());
  // The scanner always allows inverted reading. For dark-on-light codes the
  // inverted pass cannot yield the encoded bytes (it looks for a light seal),
  // so it is skipped there: same outcome, half the cost of a failed frame.
  const res = decodeOrbesCode(frame, { tryInverted: r.polarity === 'light-on-dark', tryMirrored: false, readGenome: false });
  if (!res.ok) return { ok: false, reason: res.reason };
  return res.data.every((b, i) => b === code.data[i]) ? { ok: true, reason: '' } : { ok: false, reason: 'WRONG_DATA' };
}

// ── Adaptive trials per row ────────────────────────────────────────────────

export type CellStatus = 'overflow' | 'skipped' | 'measured';

export interface Cell {
  sizeMm: number;
  status: CellStatus;
  trials: number;
  ok: number;
  failures: Record<string, number>;
  /** ≥ 95 % with ≥ CONFIRM trials. */
  confirmed: boolean;
  /** Confirmed, or all screening trials passed and the next smaller size in the row is reliable. */
  reliable: boolean;
  inferred: boolean;
}

export interface RowJob {
  rendition: string;
  profile: string;
  distanceCm: number;
  screen: number;
  confirm: number;
}

export interface RowResult extends RowJob {
  cells: Cell[];
  trialsRun: number;
  /** Wall time and CPU time (user + system) of the row in its worker. */
  ms: number;
  cpuMs: number;
}

/** Most failures a CONFIRM-trial cell may have and still be ≥ 95 %. */
function allowedFailures(n: number): number {
  return Math.floor(n * 0.05 + 1e-9);
}

function extend(cell: Cell, upTo: number, run: (t: number) => { ok: boolean; reason: string }, stopAt: number): number {
  let ran = 0;
  while (cell.trials < upTo && cell.trials - cell.ok < stopAt) {
    const res = run(cell.trials);
    cell.trials++;
    ran++;
    if (res.ok) cell.ok++;
    else cell.failures[res.reason] = (cell.failures[res.reason] ?? 0) + 1;
  }
  return ran;
}

/**
 * One (substrate, profile, distance) row. Sizes are screened from the largest
 * down with up to `screen` trials each, a cell stopping at its 2nd failure;
 * after two consecutive sizes with no success, smaller sizes are not run
 * (same blur in pixels, fewer pixels per u). Then, from the smallest size
 * up, cells with at most one screening failure are extended to `confirm`
 * trials (stopping once they can no longer reach 95 %) until one is
 * confirmed; larger cells that passed every screening trial inherit
 * reliability from it, larger cells with a screening failure are extended
 * too.
 */
export function runRow(job: RowJob): RowResult {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  const r = RENDITIONS.find((x) => x.id === job.rendition);
  const p = PROFILES.find((x) => x.id === job.profile);
  if (!r || !p) throw new Error(`unknown job ${job.rendition}/${job.profile}`);
  const stopAt = Math.max(2, allowedFailures(job.confirm) + 1);
  const cells: Cell[] = SHEET_SIZES_MM.map((sizeMm) => ({
    sizeMm,
    status: fitsCrop(p, sizeMm, job.distanceCm * 10) ? 'measured' : 'overflow',
    trials: 0,
    ok: 0,
    failures: {},
    confirmed: false,
    reliable: false,
    inferred: false,
  }));
  let trialsRun = 0;
  let zeroStreak = 0;
  for (const cell of [...cells].reverse()) {
    if (cell.status === 'overflow') continue;
    if (zeroStreak >= 2) {
      cell.status = 'skipped';
      continue;
    }
    trialsRun += extend(cell, job.screen, (t) => runTrial(r, p, cell.sizeMm, job.distanceCm, t), stopAt);
    zeroStreak = cell.ok === 0 ? zeroStreak + 1 : 0;
  }
  let previousReliable = false;
  for (const cell of cells) {
    if (cell.status !== 'measured') {
      previousReliable = false;
      continue;
    }
    const screenFailures = cell.trials - cell.ok;
    const cleanScreen = screenFailures === 0 && cell.trials >= job.screen;
    if (cleanScreen && previousReliable) {
      cell.reliable = true;
      cell.inferred = true;
    } else if (screenFailures <= allowedFailures(job.confirm) && cell.trials >= Math.min(job.screen, 2)) {
      trialsRun += extend(cell, job.confirm, (t) => runTrial(r, p, cell.sizeMm, job.distanceCm, t), stopAt);
      cell.confirmed = cell.trials >= job.confirm && cell.ok >= 0.95 * cell.trials;
      cell.reliable = cell.confirmed;
    }
    previousReliable = cell.reliable;
  }
  const cpu = process.cpuUsage(cpu0);
  return { ...job, cells, trialsRun, ms: performance.now() - t0, cpuMs: (cpu.user + cpu.system) / 1000 };
}

// ── Parallel driver ────────────────────────────────────────────────────────

async function runParallel(jobs: RowJob[], workers: number, onDone: (r: RowResult, done: number) => void): Promise<RowResult[]> {
  const results: RowResult[] = [];
  const queue = [...jobs];
  const script = fileURLToPath(import.meta.url);
  let done = 0;
  const spawnOne = (): Promise<void> =>
    new Promise((resolveWorker, reject) => {
      const child: ChildProcess = fork(script, ['--worker'], { execArgv: process.execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const next = (): void => {
        const job = queue.shift();
        if (job) child.send(job);
        else child.send('exit');
      };
      child.on('message', (msg: RowResult) => {
        results.push(msg);
        done++;
        onDone(msg, done);
        next();
      });
      child.on('exit', (code) => (code === 0 ? resolveWorker() : reject(new Error(`worker exited with code ${code}`))));
      child.on('error', reject);
      next();
    });
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, jobs.length)) }, spawnOne));
  return results;
}

function workerLoop(): void {
  process.on('message', (msg: RowJob | 'exit') => {
    if (msg === 'exit') process.exit(0);
    process.send!(runRow(msg));
  });
}

// ── Report ─────────────────────────────────────────────────────────────────

const GENOME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPORT = resolve(GENOME_ROOT, '../docs/reports/print-size-matrix.md');
const DEFAULT_JSON = resolve(GENOME_ROOT, 'out/print-size-matrix.json');

/** Short fingerprint of the decoder sources the run used (results change when they do). */
function decoderFingerprint(): string {
  const dir = resolve(GENOME_ROOT, 'src/core/decoder');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const text = files.map((f) => `${f}\n${readFileSync(join(dir, f), 'utf8')}`).join('\n');
  return toHex(sha256(utf8(text))).slice(0, 12);
}

type Key = `${string}|${string}|${number}`;
const keyOf = (rendition: string, profile: string, distanceCm: number): Key => `${rendition}|${profile}|${distanceCm}`;

function heat(cell: Cell): string {
  if (cell.status === 'overflow') return '▲';
  if (cell.status === 'skipped') return '·';
  const rate = cell.ok / Math.max(1, cell.trials);
  const glyph = rate >= 0.95 ? '█' : rate >= 0.75 ? '▓' : rate >= 0.4 ? '▒' : rate > 0 ? '░' : '';
  const frac = `${cell.ok}/${cell.trials}`;
  const text = cell.confirmed ? `**${frac}**` : cell.inferred ? `${frac}°` : frac;
  return glyph ? `${glyph} ${text}` : text;
}

/** Smallest reliable size of a row, or null. */
function rowMinimum(row: RowResult | undefined): number | null {
  const c = row?.cells.find((x) => x.reliable);
  return c ? c.sizeMm : null;
}

interface Minimum {
  sizeMm: number;
  distances: number[];
}

/** Smallest size reliable at some distance (best distance), with every distance where it is. */
function bestDistanceMinimum(rows: ReadonlyMap<Key, RowResult>, rendition: string, profile: string): Minimum | null {
  for (const size of SHEET_SIZES_MM) {
    const distances = SCAN_DISTANCES_CM.filter((d) => rows.get(keyOf(rendition, profile, d))?.cells.find((c) => c.sizeMm === size)?.reliable);
    if (distances.length > 0) return { sizeMm: size, distances };
  }
  return null;
}

/** Smallest size reliable at two neighbouring distances (users do not hold an exact distance). */
function robustMinimum(rows: ReadonlyMap<Key, RowResult>, rendition: string, profile: string): Minimum | null {
  for (const size of SHEET_SIZES_MM) {
    const ok = SCAN_DISTANCES_CM.map((d) => rows.get(keyOf(rendition, profile, d))?.cells.find((c) => c.sizeMm === size)?.reliable === true);
    const distances = SCAN_DISTANCES_CM.filter((_, i) => ok[i] && (ok[i - 1] || ok[i + 1]));
    if (distances.length > 0) return { sizeMm: size, distances };
  }
  return null;
}

function fmtMin(m: Minimum | null, ran: boolean): string {
  if (!ran) return 'not run';
  if (!m) return 'none ≤ 50 mm';
  return `**${m.sizeMm} mm** @ ${m.distances.join(', ')} cm`;
}

const nextSize = (mm: number): number => SHEET_SIZES_MM.find((s) => s > mm) ?? mm;

interface UseCase {
  name: string;
  substrates: string[];
  why: string;
}

const USE_CASES: readonly UseCase[] = [
  { name: 'Jewelry tags', substrates: ['black-on-white', 'ivory', 'metallic'], why: 'small card hang tags and engraved metal plates' },
  { name: 'Leather goods', substrates: ['black-leather', 'white-on-black', 'ivory'], why: 'print or foil on dark leather, plus the ivory swing tag' },
  { name: 'Certificates and cards', substrates: ['black-on-white', 'ivory', 'matte-grey', 'textured-paper'], why: 'paper stocks, including textured and grey' },
];

const BASE_PROFILES = ['android-1x', 'iphone-1x', 'iphone-pro-1x'];

interface RunInfo {
  screen: number;
  confirm: number;
  workers: number;
  wallMs: number;
  loadAvg: number;
  decoder: string;
  date: string;
  path: string;
}

function writeReport(results: RowResult[], opts: RunInfo): void {
  const rows = new Map<Key, RowResult>(results.map((r) => [keyOf(r.rendition, r.profile, r.distanceCm), r]));
  const totalTrials = results.reduce((s, r) => s + r.trialsRun, 0);
  const cells = results.flatMap((r) => r.cells);
  const count = (pred: (c: Cell) => boolean): number => cells.filter(pred).length;
  const L: string[] = [];
  const minutes = (opts.wallMs / 60000).toFixed(1);
  const cpuMinutes = results.reduce((s, r) => s + r.cpuMs, 0) / 60000;

  L.push('# ORBES CODE-01 — print-size matrix (simulation)');
  L.push('');
  L.push(
    'Generated by `npx tsx scripts/print-size-matrix.ts` (camera simulator `test/support/camera-sim.ts`, reference decoder `src/core/decoder/`, scanner crop `src/web/verify/capture.ts`). Physical counterpart: the A4 test kit in [`docs/assets/test-sheets/`](../assets/test-sheets/) (`scripts/test-sheets.ts`), whose seven renditions are the seven substrates below.',
  );
  L.push('');
  L.push(
    `**This is a simulation.** It answers "what does the decoder receive from a typical phone at this size and distance, and can it read that?" under a stated optical model. It does not replace the physical sheets: every minimum below must be confirmed with them on real phones before it becomes a production rule (see [Limitations](#limitations)).`,
  );
  L.push('');
  L.push(
    `Run: ${results.length} rows (substrate × profile × distance) × ${SHEET_SIZES_MM.length} sizes = ${cells.length} cells; ${count((c) => c.status === 'overflow')} cells where the code does not fit the scanner crop (▲, physical, not simulated), ${count((c) => c.status === 'skipped')} cells not run below two 0 % sizes (·), ${count((c) => c.status === 'measured')} cells simulated with **${totalTrials} decoded frames**: ${cpuMinutes.toFixed(1)} CPU-minutes (${((1000 * cpuMinutes * 60) / Math.max(1, totalTrials)).toFixed(0)} ms per simulated and decoded frame), ${minutes} min wall time on ${opts.workers} worker processes (machine load average ${opts.loadAvg.toFixed(1)} at the end of the run; on ${opts.workers} otherwise idle cores the wall time is about ${(cpuMinutes / opts.workers).toFixed(1)} min). Decoder sources fingerprint \`${opts.decoder}\` (SHA-256 of \`src/core/decoder/*.ts\`), run of ${opts.date}.`,
  );
  L.push('');

  // Method.
  L.push('## Method');
  L.push('');
  L.push('### Phone profiles');
  L.push('');
  L.push('| Profile | HFOV (1920 px side) | Focal length | Min. focus | Lens (defocus model) | Base blur σ |');
  L.push('|---|---:|---:|---:|---|---:|');
  for (const p of PROFILES) {
    L.push(`| ${p.label} | ${p.hfovDeg}° | ${focalPx(p).toFixed(0)} px | ${p.minFocusMm / 10} cm | f ${p.focalMm} mm, f/${p.fNumber} | ${p.baseBlurPx} px |`);
  }
  L.push('');
  L.push(
    `- **Stream and crop.** The scanner requests a 1920×1080 stream and decodes only the square under its reticle (\`cameraCrop\`, reticle \`min(66vw, 40vh, 340px)\`, ×${1.45} margin). For a ${VIEWPORT.width}×${VIEWPORT.height} CSS px portrait viewport that is **${CROP.sw}×${CROP.sw} stream px decoded at ${CROP.tw} px** (no downscale). Every trial simulates exactly that window; the principal point is its centre.`,
  );
  L.push(
    '- **Sampling.** px/mm = f / distance; px per u = px/mm × size / 50 (the 50 u artifact includes its quiet zone). 2× zoom doubles f (sensor crop; Chrome maps the `zoom` constraint to the camera crop region) with a softer base blur (σ 1.0 px instead of 0.75 px: less sensor oversampling).',
  );
  L.push(
    `- **Fit.** At any rotation the code needs a ${MOON_CIRCLE_U} u circle (moons included). When it exceeds ${FIT_FRACTION * 100} % of the crop the code cannot be read whole: ▲, the user must step back. Such cells are not simulated.`,
  );
  L.push(
    '- **Defocus.** Closer than the minimum focus distance s, the lens stays at s and a point spreads into a blur circle of diameter c = A·f_px·(s − d) / ((s − f)·d) with A = f/N (thin lens). It is simulated as a Gaussian of the same variance, σ = c/4. At or beyond s, autofocus is assumed to work with a residual σ ≤ 0.35 px.',
  );
  L.push(
    '- **Hand-held trial.** Distance ±7 %, any in-plane rotation, tilt 0–12° about a random axis, centre within ±5 % of the crop, hand shake 0–1.2 px × zoom (line blur), exposure ×0.90–1.04, illumination gradient 5–20 %, vignetting, barrel distortion k1 = 0.02, Gaussian read noise σ 1.2–2.6 plus shot noise, desk clutter beyond the printed surface. No JPEG: camera frames reach the scanner uncompressed.',
  );
  L.push(
    '- **Decode.** `decodeOrbesCode` with the scanner\'s options (inverted reading for light-on-dark substrates; skipped for dark-on-light ones, where an inverted pass cannot return the encoded bytes; genome reading off, it never gates decoding). A trial succeeds only when all 79 data bytes equal the encoded ones. Codes: a pool of 6 seeded CODE-01 artifacts (with decor, except on metal).',
  );
  L.push('');
  L.push('### Substrates');
  L.push('');
  L.push('| Substrate (test-sheet page) | Simulator model |');
  L.push('|---|---|');
  for (const r of RENDITIONS) L.push(`| ${r.name.toLowerCase()} (page ${r.index + 1}) | ${modelFor(r).note}; ${modelFor(r).surround === 'tag' ? `cut-out tag (${TAG_PAD_MM} mm margin) on a cluttered desk` : 'the surface fills the view'} |`);
  L.push('');
  L.push('### Trials per cell (N)');
  L.push('');
  L.push(
    `Adaptive, seeded, identical whatever the worker count. **Screening:** every simulated cell gets up to **${opts.screen}** trials, sizes from the largest down, stopping at the 2nd failure; after two consecutive sizes with no success the smaller sizes of that row are not run (same blur in pixels and fewer pixels per u: they cannot do better). **Confirmation:** from the smallest size up, a cell with at most one screening failure is extended to **N = ${opts.confirm}** trials (stopping at the 2nd failure) until one cell of the row reaches ≥ 95 % (≥ ${opts.confirm - allowedFailures(opts.confirm)}/${opts.confirm}); larger sizes that passed all their screening trials are then marked reliable by monotonicity (°), larger sizes with a screening failure are extended too. A confirmed ${opts.confirm}/${opts.confirm} cell bounds the true failure rate below ${(100 * (1 - 0.05 ** (1 / opts.confirm))).toFixed(0)} % at 95 % confidence (one-sided Clopper-Pearson), ${opts.confirm - 1}/${opts.confirm} below ${(100 * binomUpper(opts.confirm, opts.confirm - 1)).toFixed(0)} %: "≥ 95 %" is the observed rate, not a guarantee.`,
  );
  L.push('');

  // Physical sampling table.
  L.push('### Physical sampling (nominal distance, no jitter)');
  L.push('');
  L.push('px/mm on the code, the resulting px per u for the smallest and largest sizes, and the defocus blur σ (stream px) closer than the minimum focus. ▲ marks the first size that no longer fits the crop. The decoder needs ≈ 2.5–3.5 px per u ([scan-matrix](scan-matrix.md); ORBES-CODE-SPEC §10 targets ≥ 3.5).');
  L.push('');
  L.push(`| Profile | ${SCAN_DISTANCES_CM.map((d) => `${d} cm`).join(' | ')} |`);
  L.push(`|---|${SCAN_DISTANCES_CM.map(() => '---').join('|')}|`);
  for (const p of PROFILES) {
    const cellsTxt = SCAN_DISTANCES_CM.map((d) => {
      const mmPx = pxPerMm(p, d * 10);
      const blur = defocusCirclePx(p, d * 10) / 4;
      const over = SHEET_SIZES_MM.find((s) => !fitsCrop(p, s, d * 10));
      return `${mmPx.toFixed(1)} px/mm · 10 mm ${((mmPx * 10) / 50).toFixed(1)} px/u${blur > 0 ? ` · **σ ${blur.toFixed(1)} px**` : ''}${over ? ` · ▲ ≥ ${over} mm` : ''}`;
    });
    L.push(`| ${p.label} | ${cellsTxt.join(' | ')} |`);
  }
  L.push('');

  // Summary.
  L.push('## Smallest reliable size');
  L.push('');
  L.push(
    '**Best distance:** the smallest size reading ≥ 95 % at one or more distances, and those distances. **Robust:** the smallest size reading ≥ 95 % at two neighbouring distances, since nobody holds a phone at an exact distance; this is the figure the recommendation uses.',
  );
  L.push('');
  for (const [title, fn] of [
    ['Robust (two neighbouring distances)', robustMinimum],
    ['Best distance', bestDistanceMinimum],
  ] as const) {
    L.push(`### ${title}`);
    L.push('');
    L.push(`| Substrate | ${PROFILES.map((p) => p.label).join(' | ')} |`);
    L.push(`|---|${PROFILES.map(() => '---').join('|')}|`);
    for (const r of RENDITIONS) {
      L.push(`| ${r.name.toLowerCase()} | ${PROFILES.map((p) => fmtMin(fn(rows, r.id, p.id), rows.has(keyOf(r.id, p.id, SCAN_DISTANCES_CM[0])))).join(' | ')} |`);
    }
    L.push('');
  }

  // Recommendation.
  const universal = (rendition: string): number | null => {
    let worst = 0;
    for (const id of BASE_PROFILES) {
      const m = robustMinimum(rows, rendition, id);
      if (!m) return null;
      worst = Math.max(worst, m.sizeMm);
    }
    return worst;
  };
  const withZoom = (rendition: string): number | null => {
    let worst = 0;
    for (const base of BASE_PROFILES) {
      const a = robustMinimum(rows, rendition, base);
      const b = robustMinimum(rows, rendition, base.replace('-1x', '-2x'));
      const best = Math.min(a?.sizeMm ?? Infinity, b?.sizeMm ?? Infinity);
      if (!Number.isFinite(best)) return null;
      worst = Math.max(worst, best);
    }
    return worst;
  };
  L.push('## Recommendation');
  L.push('');
  L.push(
    '"Simulated minimum" = the largest robust minimum over the three phone families at 1× (the scanner cannot count on zoom: browsers expose it unevenly, and the iPhone Pro main camera does not focus closer than ≈ 20 cm). "With 2× zoom" = the same when each family may use whichever of 1× and 2× works better. "Recommended" adds one size step to the simulated minimum: the simulator is optimistic (see limitations), and print gain, wear and engraving tolerances eat into the margin.',
  );
  L.push('');
  L.push('| Substrate | Simulated minimum (1×, all phones) | With 2× zoom | Recommended, pending physical confirmation |');
  L.push('|---|---:|---:|---:|');
  for (const r of RENDITIONS) {
    const u = universal(r.id);
    const z = withZoom(r.id);
    L.push(`| ${r.name.toLowerCase()} | ${u === null ? '> 50 mm' : `${u} mm`} | ${z === null ? '> 50 mm' : `${z} mm`} | ${u === null ? '—' : `**${nextSize(u)} mm**`} |`);
  }
  L.push('');
  L.push('| Use case | Substrates considered | Simulated minimum | Recommended minimum print size |');
  L.push('|---|---|---:|---:|');
  for (const uc of USE_CASES) {
    const mins = uc.substrates.map(universal);
    const known = mins.every((m) => m !== null);
    const worst = known ? Math.max(...(mins as number[])) : null;
    L.push(
      `| **${uc.name}** (${uc.why}) | ${uc.substrates.map((s) => RENDITIONS.find((r) => r.id === s)!.name.toLowerCase()).join(', ')} | ${worst === null ? '> 50 mm' : `${worst} mm`} | ${worst === null ? 'not reached' : `**${nextSize(worst)} mm**`} |`,
    );
  }
  L.push('');
  const allMins = RENDITIONS.map((r) => universal(r.id));
  const overall = allMins.every((m) => m !== null) ? Math.max(...(allMins as number[])) : null;
  const span = (values: number[]): string => {
    const finite = values.filter(Number.isFinite);
    if (finite.length === 0) return '> 50 mm';
    const lo = Math.min(...finite);
    const hi = Math.max(...values);
    return lo === hi ? `${lo} mm` : `${lo}–${Number.isFinite(hi) ? hi : '> 50'} mm`;
  };
  const robustAcross = (profile: string): number[] => RENDITIONS.map((r) => robustMinimum(rows, r.id, profile)?.sizeMm ?? Infinity);
  /** 1× and 2× profiles reading `size` robustly on every substrate. */
  const readersAt = (size: number, ids: readonly string[]): string[] =>
    ids.filter((id) => robustAcross(id).every((m) => m <= size)).map((id) => PROFILES.find((p) => p.id === id)!.label);
  const proPx10 = (pxPerMm(PROFILES.find((p) => p.id === 'iphone-pro-1x')!, 200) * 10) / CODE01_SIZE;
  L.push(
    `Reading the tables: the binding constraint is focus, not resolution. Android main cameras focus at 8 cm and reach small sizes (robust minimum ${span(robustAcross('android-1x'))} across substrates); the iPhone Pro main camera cannot focus closer than ≈ 20 cm, where a 10 mm code is about ${proPx10.toFixed(1)} px per u, below what the decoder needs (robust minimum ${span(robustAcross('iphone-pro-1x'))}). Moving closer than the minimum focus blurs faster than it magnifies. 2× zoom restores the small sizes at 20–25 cm where the browser exposes it. ${overall === null ? '' : `A single rule for every substrate and phone at 1× would be **${overall} mm simulated, ${nextSize(overall)} mm recommended**.`}`,
  );
  L.push('');
  const known = allMins.filter((m): m is number => m !== null);
  if (known.length > 0) {
    L.push(
      `Substrates: in this simulation the substrate moves the 1× minimum by ${Math.min(...known) === Math.max(...known) ? 'nothing' : `at most one size step (${span(known)})`}. The decoder's local thresholds absorb the modelled contrasts and textures. Real leather grain, foil and engraved metal are harsher than these models (see limitations), so the physical sheets matter most on those materials.`,
    );
    L.push('');
  }
  const zoomMins = RENDITIONS.map((r) => withZoom(r.id));
  const zoomFloor = zoomMins.every((m) => m !== null) ? Math.max(...(zoomMins as number[])) : null;
  const all = PROFILES.map((p) => p.id);
  const smallest = SHEET_SIZES_MM[0];
  L.push('**Guidance**, all of it pending physical confirmation:');
  L.push('');
  if (overall !== null) {
    L.push(
      `- **Universal rule — ${nextSize(overall)} mm.** Every simulated phone reads it at two or more neighbouring distances without zoom (simulated minimum ${overall} mm, plus one size step). Certificates and cards, which have room, and leather goods should use it or larger.`,
    );
  }
  if (zoomFloor !== null) {
    const floor = nextSize(zoomFloor);
    const at1x = readersAt(floor, BASE_PROFILES);
    const missing = BASE_PROFILES.filter((id) => !at1x.includes(PROFILES.find((p) => p.id === id)!.label));
    const fragile = missing
      .map((id) => {
        const p = PROFILES.find((x) => x.id === id)!;
        const where = SCAN_DISTANCES_CM.filter((d) => RENDITIONS.every((r) => rows.get(keyOf(r.id, id, d))?.cells.find((c) => c.sizeMm === floor)?.reliable));
        return `${p.label} ${where.length ? `only at ${where.join(', ')} cm` : 'not at all'}`;
      })
      .join('; ');
    L.push(
      `- **Zoom-assisted floor — ${floor} mm** (simulated ${zoomFloor} mm when 2× zoom may be used, plus one step). Without zoom it is read robustly by ${at1x.length ? at1x.join('; ') : 'no 1× profile'}${fragile ? `; ${fragile} on every substrate` : ''}. Acceptable for jewelry tags that cannot fit the universal size, provided the scanner offers zoom and tells users of phones that cannot focus close to hold the phone further away and zoom in.`,
    );
  }
  L.push(
    `- **${smallest} mm** is read robustly on every substrate only by ${readersAt(smallest, all).join('; ') || 'no profile'}: not a production size for an audience with mixed phones.`,
  );
  L.push(
    `- **Scanner.** Its "Move a little closer" hint (after NO_MOONS failures, src/web/verify/capture.ts \`scanHint\`) pushes phones that cannot focus that close into defocus; most failures here are ECC / FORMAT (blur, too few pixels), not NO_MOONS. For small codes, a "hold about 20 cm away and zoom" hint and a prominent zoom control are what make the iPhone Pro rows above reachable.`,
  );
  L.push('');

  // Heat maps.
  L.push('## Success heat maps');
  L.push('');
  L.push(
    `Cells: successful decodes / trials. **Bold** = confirmed ≥ 95 % with ${opts.confirm} trials; ° = all ${opts.screen} screening trials passed and the next smaller size at that distance is reliable (reliable by monotonicity); plain = measured, not reliable. █ ≥ 95 %, ▓ ≥ 75 %, ▒ ≥ 40 %, ░ > 0 %. ▲ = the code does not fit the scanner crop at that distance (step back). · = not run (two larger sizes already read 0 %). σ = nominal blur (stream px) of the row.`,
  );
  L.push('');
  for (const r of RENDITIONS) {
    L.push(`### ${r.name.charAt(0)}${r.name.slice(1).toLowerCase()} (test-sheet page ${r.index + 1})`);
    L.push('');
    L.push(`| Profile | Distance | px/mm | σ px | ${SHEET_SIZES_MM.map((s) => `${s} mm`).join(' | ')} |`);
    L.push(`|---|---:|---:|---:|${SHEET_SIZES_MM.map(() => '---').join('|')}|`);
    for (const p of PROFILES) {
      SCAN_DISTANCES_CM.forEach((d, i) => {
        const row = rows.get(keyOf(r.id, p.id, d));
        const blur = Math.hypot(p.baseBlurPx, defocusCirclePx(p, d * 10) / 4);
        const sizes = SHEET_SIZES_MM.map((s) => {
          const c = row?.cells.find((x) => x.sizeMm === s);
          return c ? heat(c) : 'n/a';
        });
        L.push(`| ${i === 0 ? `**${p.label}**` : ''} | ${d} cm | ${pxPerMm(p, d * 10).toFixed(1)} | ${blur.toFixed(1)} | ${sizes.join(' | ')} |`);
      });
    }
    L.push('');
  }

  // Failure reasons.
  const reasons: Record<string, number> = {};
  for (const c of cells) for (const [k, v] of Object.entries(c.failures)) reasons[k] = (reasons[k] ?? 0) + v;
  L.push('## Failure reasons');
  L.push('');
  L.push(
    `Over all failed trials: ${
      Object.entries(reasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none'
    }. NO_SEAL / NO_MOONS: the finder did not lock (blur or too few pixels); FORMAT / ECC / CRC: the code was found but the cells were too degraded; WRONG_DATA would be a miscorrection (expected 0).`,
  );
  L.push('');

  L.push('## Limitations');
  L.push('');
  for (const item of [
    '**Simulation only.** No real phone was used. The physical test sheets exist precisely to confirm or overturn these numbers; until they have been run on real Android phones, iPhones and an iPhone Pro, every minimum here is a hypothesis.',
    '**Optimistic camera.** The simulator models a pinhole camera with Gaussian blur, sensor noise and a fixed tone mapping. It does not model demosaicing artefacts, ISP sharpening halos, temporal denoising, rolling shutter, auto-exposure or autofocus hunting, or video-pipeline downscaling some browsers apply. Real phones lose resolution to these, so real minima are likely somewhat larger.',
    '**Defocus model.** Thin lens with a Gaussian of matched variance instead of the true disc-shaped PSF (whose MTF has zeros and contrast reversal); lens parameters are typical values, not measurements of a given model. Phones that switch to an ultra-wide macro camera at close range (some iPhone Pro models in the native camera app) are not modelled: in the browser the main camera is the conservative assumption.',
    '**Field of view and crop.** One HFOV per family (±2.5° shifts px/mm by ≈ ±4 %), one 1080p stream, one reference viewport (390×844 CSS px). A browser that delivers 720p instead has a third fewer pixels per u at the same distance. Larger or smaller screens change the crop, not the sampling.',
    '**Zoom.** Modelled as a true sensor crop (full resolution). A browser that upscales a 1080p stream digitally gains nothing; whether a given browser exposes `zoom` at all varies.',
    '**Substrates.** Simulated by reflectance levels and the simulator\'s procedural textures, whose feature size is tied to the image (about one texel per frame pixel), not to physical millimetres. Real leather grain, foil sparkle, engraving burr and metal specularity are not reproduced; the metallic model has one soft specular stripe only.',
    '**Printing.** Sources are perfect vector renderings: no print gain, toner scatter or engraving tolerance. ORBES-CODE-SPEC §9 allows ±0.12 u of ink spread; at 10 mm that is ±24 µm, at the edge of office printers.',
    `**Statistics.** N = ${opts.confirm} trials for confirmed cells, ${opts.screen} for screened ones; "reliable by monotonicity" cells rely on the physical argument that a larger code at the same distance sees the same blur in pixels with more pixels per u. Rates near the threshold carry wide intervals.`,
    '**Decoder version.** Results are for the decoder at the time of the run; re-run after decoder changes (deterministic, so differences are real).',
  ]) {
    L.push(`- ${item}`);
  }
  L.push('');
  writeFileSync(opts.path, `${L.join('\n')}\n`);
  console.log(`\nWrote ${opts.path}`);
}

/** One-sided 95 % Clopper-Pearson upper bound on the failure rate after `ok` successes in `n` trials. */
function binomUpper(n: number, ok: number): number {
  const k = n - ok; // failures
  if (k >= n) return 1;
  // Bisection on p: P(X ≤ k | n, p) = 0.05.
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 60; it++) {
    const p = (lo + hi) / 2;
    let cdf = 0;
    let term = (1 - p) ** n;
    for (let i = 0; i <= k; i++) {
      cdf += term;
      term *= ((n - i) / (i + 1)) * (p / (1 - p));
    }
    if (cdf > 0.05) lo = p;
    else hi = p;
  }
  return hi;
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const screen = Number(arg('--screen') ?? 4);
  const confirm = Number(arg('--confirm') ?? 20);
  const workers = Number(arg('--workers') ?? Math.max(1, Math.min(4, availableParallelism())));
  const only = arg('--only')?.split(',');
  const profiles = arg('--profiles')?.split(',');
  const out = arg('--out');
  const fromJson = arg('--from-json');
  if (fromJson) {
    const saved = JSON.parse(readFileSync(resolve(fromJson), 'utf8')) as { info: Omit<RunInfo, 'path'>; results: RowResult[] };
    writeReport(saved.results, { ...saved.info, path: out ? resolve(out) : DEFAULT_REPORT });
    return;
  }
  const write = out !== undefined || (!args.includes('--no-write') && !only && !profiles);
  if (!(screen >= 2 && confirm >= screen && workers >= 1)) throw new Error('need --screen ≥ 2, --confirm ≥ --screen, --workers ≥ 1');

  const jobs: RowJob[] = [];
  for (const r of RENDITIONS.filter((x) => !only || only.includes(x.id))) {
    for (const p of PROFILES.filter((x) => !profiles || profiles.includes(x.id))) {
      for (const d of SCAN_DISTANCES_CM) jobs.push({ rendition: r.id, profile: p.id, distanceCm: d, screen, confirm });
    }
  }
  // Heaviest rows first (strong defocus → large blur kernels, slow failed decodes) for load balance.
  const cost = (j: RowJob): number => defocusCirclePx(PROFILES.find((p) => p.id === j.profile)!, j.distanceCm * 10);
  jobs.sort((a, b) => cost(b) - cost(a));

  console.log(`Crop ${CROP.sw}×${CROP.sw} stream px → ${CROP.tw} px; ${jobs.length} rows; screen ${screen}, confirm ${confirm}; ${workers} workers`);
  const t0 = performance.now();
  const results = await runParallel(jobs, workers, (r, done) => {
    const line = r.cells.map((c) => (c.status === 'overflow' ? '▲' : c.status === 'skipped' ? '·' : `${c.ok}/${c.trials}${c.reliable ? (c.inferred ? '°' : '✓') : ''}`)).join(' ');
    console.log(`[${String(done).padStart(3)}/${jobs.length}] ${r.rendition.padEnd(15)} ${r.profile.padEnd(14)} ${String(r.distanceCm).padStart(2)} cm  ${line}  (${r.trialsRun} trials, ${(r.ms / 1000).toFixed(1)} s)`);
  });
  const wallMs = performance.now() - t0;
  console.log(`\n${results.reduce((s, r) => s + r.trialsRun, 0)} trials in ${(wallMs / 60000).toFixed(1)} min`);
  const cpuMin = results.reduce((s, r) => s + r.cpuMs, 0) / 60000;
  console.log(`CPU time ${cpuMin.toFixed(1)} min; load average ${loadavg()[0].toFixed(1)}`);
  const info = { screen, confirm, workers, wallMs, loadAvg: loadavg()[0], decoder: decoderFingerprint(), date: new Date().toISOString().slice(0, 10) };
  if (!write) return;
  const json = out ? resolve(out).replace(/\.md$/, '') + '.json' : DEFAULT_JSON;
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify({ info, results }));
  console.log(`Raw results: ${json}`);
  writeReport(results, { ...info, path: out ? resolve(out) : DEFAULT_REPORT });
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--worker')) {
    workerLoop();
  } else {
    main().catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
  }
}

