/**
 * ORBES CODE-01 scan test matrix.
 *
 * Photographs real CODE-01 artifacts (seeded payloads, encoder output) with
 * the deterministic camera simulator under one varied condition at a time,
 * decodes every frame and reports the success rate and decode time per
 * condition, then derives the smallest reliable printed size.
 *
 *   npx tsx scripts/scan-matrix.ts [--trials N] [--only name,name] [--no-write] [--verbose] [--dump DIR]
 *
 * Writes docs/reports/scan-matrix.md (unless --no-write or --only). Same
 * arguments → same frames → same success rates (decode times vary with the
 * machine).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE01_SIZE } from '../src/core/code/profile.js';
import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { renderCode, makeCode, SOURCE_PX_PER_U, type CodeFixture } from '../test/decoder/fixtures.js';
import { writePng } from '../test/support/image-io.js';
import { PRESETS, simulateCapture, type CaptureParams, type Substrate } from '../test/support/camera-sim.js';
import { hashSeed, Prng } from '../test/support/prng.js';
import type { GrayImage } from '../test/support/raster.js';

// ── Conditions ─────────────────────────────────────────────────────────────

/** Data orbit area (u²) and whole-artifact area (u²): occlusion and glare sizes refer to the data area. */
const DATA_AREA = Math.PI * (23 * 23 - 10 * 10);
const SOURCE_AREA = CODE01_SIZE * CODE01_SIZE;

interface Trial {
  params: CaptureParams;
  style?: 'classic' | 'inverted' | 'ivory';
}

interface Level {
  label: string;
  /** Builds the capture for one trial from a per-trial PRNG. */
  trial(rng: Prng): Trial;
}

interface Sweep {
  name: string;
  title: string;
  note: string;
  levels: Level[];
}

/** Random in-plane pose shared by most sweeps: any rotation, modest tilt, off-centre. */
function pose(rng: Prng): CaptureParams {
  return {
    rotationDeg: rng.range(0, 360),
    tiltXDeg: rng.range(-12, 12),
    tiltYDeg: rng.range(-12, 12),
    offset: { x: rng.range(-60, 60), y: rng.range(-40, 40) },
  };
}

/** The typicalPhone preset (hand-held, clutter, paper, blur, noise, JPEG 82) at a given size and random pose. */
function phone(rng: Prng, pxPerU: number, extra: CaptureParams = {}): CaptureParams {
  return { ...PRESETS.typicalPhone, ...pose(rng), codeWidthPx: pxPerU * CODE01_SIZE, ...extra };
}

/** Normalised source position of a point at radius r (u) and angle a (rad, clockwise from north). */
function at(r: number, a: number): { x: number; y: number } {
  return { x: 0.5 + (r * Math.sin(a)) / CODE01_SIZE, y: 0.5 - (r * Math.cos(a)) / CODE01_SIZE };
}

/** Base size for every sweep that is not about size (px per u). */
const BASE_PX_PER_U = 6;

function sweeps(): Sweep[] {
  const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(2));
  return [
    {
      name: 'size',
      title: 'Module size (typicalPhone preset)',
      note: 'typicalPhone preset (tilt ±12°, blur 0.9 px, noise, JPEG 82, clutter, paper) at a random rotation; px per u = frame pixels per CODE-01 unit (the artifact is 50 u wide).',
      levels: range(2, 6, 0.25).map((ppu) => ({ label: `${ppu.toFixed(2)} px/u`, trial: (rng) => ({ params: phone(rng, ppu) }) })),
    },
    {
      name: 'clean',
      title: 'Clean frontal capture',
      note: 'Face-on, no noise or compression; any in-plane rotation.',
      levels: [3, 3.5, 4, 5].map((ppu) => ({
        label: `${ppu} px/u`,
        trial: (rng) => ({ params: { codeWidthPx: ppu * CODE01_SIZE, rotationDeg: rng.range(0, 360), offset: { x: rng.range(-60, 60), y: rng.range(-40, 40) } } }),
      })),
    },
    {
      name: 'rotation',
      title: 'In-plane rotation',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u, rotation drawn in the given 90° quadrant.`,
      levels: [0, 90, 180, 270].map((q) => ({ label: `${q}–${q + 90}°`, trial: (rng) => ({ params: phone(rng, BASE_PX_PER_U, { rotationDeg: rng.range(q, q + 90) }) }) })),
    },
    {
      name: 'tilt',
      title: 'Out-of-plane tilt',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u (face-on scale), tilt of the given magnitude about a random axis, random rotation.`,
      levels: [20, 30, 40, 45, 50].map((t) => ({
        label: `${t}°`,
        trial: (rng) => {
          const axis = rng.range(0, 2 * Math.PI);
          return { params: phone(rng, BASE_PX_PER_U, { tiltXDeg: t * Math.cos(axis), tiltYDeg: t * Math.sin(axis) }) };
        },
      })),
    },
    {
      name: 'blur',
      title: 'Defocus blur',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u with Gaussian defocus sigma in code units.`,
      levels: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((s) => ({ label: `σ ${s} u`, trial: (rng) => ({ params: phone(rng, BASE_PX_PER_U, { blurSigma: s * BASE_PX_PER_U }) }) })),
    },
    {
      name: 'noise',
      title: 'Sensor noise',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u, Gaussian read noise sigma on the 0–255 scale.`,
      levels: [4, 8, 12, 16, 20].map((n) => ({ label: `σ ${n}`, trial: (rng) => ({ params: phone(rng, BASE_PX_PER_U, { noise: { sigma: n, shot: 0.04 } }) }) })),
    },
    {
      name: 'jpeg',
      title: 'JPEG compression',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u, JPEG quality.`,
      levels: [90, 75, 60, 45, 30].map((q) => ({ label: `q ${q}`, trial: (rng) => ({ params: phone(rng, BASE_PX_PER_U, { jpegQuality: q }) }) })),
    },
    {
      name: 'glare',
      title: 'Specular glare',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u plus a highlight (peak 1.6× full scale) on the data orbits; coverage = area where the highlight adds ≥ 50 % of full scale, as a share of the data area.`,
      levels: [0.05, 0.1, 0.15, 0.2].map((f) => ({
        label: `${Math.round(f * 100)} %`,
        trial: (rng) => {
          const aspect = 0.6;
          // 1.6·exp(−2ρ²) ≥ 0.5 inside ρ² ≤ ln(3.2)/2 → covered area π·a²·aspect·ln(3.2)/2.
          const a = Math.sqrt((f * DATA_AREA) / (Math.PI * aspect * (Math.log(3.2) / 2))) / CODE01_SIZE;
          const c = at(rng.range(13, 20), rng.range(0, 2 * Math.PI));
          return { params: phone(rng, BASE_PX_PER_U, { glare: { ...c, radius: a, aspect, angleDeg: rng.range(0, 180), intensity: 1.6 } }) };
        },
      })),
    },
    {
      name: 'occlusion',
      title: 'Occlusion',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u plus one opaque blob (dark dirt or paper-coloured abrasion) centred on the data orbits, or a 2 u wide strip across the code.`,
      levels: [
        ...[0.05, 0.1, 0.15, 0.2].map((f) => ({
          label: `blob ${Math.round(f * 100)} %`,
          trial: (rng: Prng): Trial => {
            const c = at(rng.range(14, 19), rng.range(0, 2 * Math.PI));
            const level = rng.chance(0.5) ? 0.08 : 0.86;
            return { params: phone(rng, BASE_PX_PER_U, { occlusion: [{ kind: 'blob', ...c, area: (f * DATA_AREA) / SOURCE_AREA, aspect: rng.range(0.5, 1), angleDeg: rng.range(0, 180), level }] }) };
          },
        })),
        ...[
          ['strip 2 u', 6],
          ['strip 2 u, may cross seal', 0],
        ].map(([label, minOffset]) => ({
          label: label as string,
          trial: (rng: Prng): Trial => {
            // 46 u long, 2 u wide, its axis 6–20 u from the centre (never across
            // the seal) or 0–20 u (possibly right across it).
            const half = 23;
            const angle = rng.range(0, 180);
            const c = at(rng.range(minOffset as number, 20), ((angle + 90) * Math.PI) / 180);
            const level = rng.chance(0.5) ? 0.08 : 0.86;
            return { params: phone(rng, BASE_PX_PER_U, { occlusion: [{ kind: 'strip', ...c, area: (2 * half * 2) / SOURCE_AREA, aspect: 1 / half, angleDeg: angle, level }] }) };
          },
        })),
      ],
    },
    {
      name: 'contrast',
      title: 'Low contrast',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u with ink / paper reflectance (luma ≈ 255 × reflectance).`,
      levels: [
        [0.1, 0.86],
        [0.43, 0.86],
        [0.3, 0.6],
        [0.55, 0.9],
        [0.6, 0.86],
      ].map(([ink, paper]) => ({
        label: `${Math.round(ink * 255)} on ${Math.round(paper * 255)}`,
        trial: (rng) => ({ params: phone(rng, BASE_PX_PER_U, { inkLevel: ink, paperLevel: paper }) }),
      })),
    },
    {
      name: 'polarity',
      title: 'Polarity and print style',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u. "inverted" = light ink on a dark substrate (rendered with the inverted style).`,
      levels: [
        { label: 'classic', trial: (rng: Prng): Trial => ({ params: phone(rng, BASE_PX_PER_U) }) },
        { label: 'ivory', trial: (rng: Prng): Trial => ({ params: phone(rng, BASE_PX_PER_U), style: 'ivory' }) },
        { label: 'inverted', trial: (rng: Prng): Trial => ({ params: phone(rng, BASE_PX_PER_U), style: 'inverted' }) },
        {
          label: 'inverted, dark leather',
          trial: (rng: Prng): Trial => ({ params: phone(rng, BASE_PX_PER_U, { substrate: 'leather', paperLevel: 0.75, inkLevel: 0.12 }), style: 'inverted' }),
        },
      ],
    },
    {
      name: 'substrate',
      title: 'Substrates',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u on each simulated material (leather: ink 0.2 on 0.5, gentle bend; metal: ink 0.25 on 0.72).`,
      levels: (['paper', 'textured-paper', 'leather', 'brushed-metal'] as Substrate[]).map((substrate) => ({
        label: substrate,
        trial: (rng: Prng): Trial => {
          const material: CaptureParams =
            substrate === 'leather'
              ? { paperLevel: 0.5, inkLevel: 0.2, curvature: 0.3 }
              : substrate === 'brushed-metal'
                ? { paperLevel: 0.72, inkLevel: 0.25 }
                : {};
          return { params: phone(rng, BASE_PX_PER_U, { substrate, ...material }) };
        },
      })),
    },
    {
      name: 'lighting',
      title: 'Illumination gradient and vignetting',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u with a stronger light gradient (± strength at the frame half-diagonal) and vignetting.`,
      levels: [
        [0.3, 0.3],
        [0.45, 0.45],
        [0.6, 0.6],
      ].map(([strength, vignette]) => ({
        label: `gradient ${strength}, vignette ${vignette}`,
        trial: (rng: Prng): Trial => ({ params: phone(rng, BASE_PX_PER_U, { illumination: { angleDeg: rng.range(0, 360), strength }, vignette }) }),
      })),
    },
    {
      name: 'curvature',
      title: 'Cylindrical curvature',
      note: `typicalPhone at ${BASE_PX_PER_U} px/u wrapped on a cylinder (radians subtended by the artifact width; 0.3–0.5 ≈ a bag panel).`,
      levels: [0.2, 0.35, 0.5, 0.7, 0.9].map((c) => ({ label: `${c} rad`, trial: (rng: Prng): Trial => ({ params: phone(rng, BASE_PX_PER_U, { curvature: c }) }) })),
    },
    {
      name: 'presets',
      title: 'Camera simulator presets',
      note: 'Each preset as defined in test/support/camera-sim.ts (own size and pose), random rotation added.',
      levels: (['clean', 'typicalPhone', 'lowLight', 'glare', 'tilted45', 'leather', 'metal', 'worn', 'small'] as const).map((name) => ({
        label: name,
        trial: (rng: Prng): Trial => ({ params: { ...PRESETS[name], rotationDeg: rng.range(0, 360) } }),
      })),
    },
  ];
}

// ── Runner ─────────────────────────────────────────────────────────────────

interface LevelResult {
  label: string;
  trials: number;
  ok: number;
  times: number[];
  failures: Record<string, number>;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const verbose = process.argv.includes('--verbose');
const dumpIndex = process.argv.indexOf('--dump');
/** Directory receiving failed frames as PNG (diagnostics). */
const dumpDir = dumpIndex >= 0 ? process.argv[dumpIndex + 1] : undefined;
const codes = new Map<number, CodeFixture>();
function codeFor(index: number): CodeFixture {
  let c = codes.get(index);
  if (!c) {
    c = makeCode(index);
    codes.set(index, c);
  }
  return c;
}

/** A distinct code per trial index (cycling through a pool keeps rendering cost bounded). */
const CODE_POOL = 12;

function runLevel(sweep: Sweep, level: Level, trials: number): LevelResult {
  const result: LevelResult = { label: level.label, trials, ok: 0, times: [], failures: {} };
  for (let t = 0; t < trials; t++) {
    const seed = hashSeed('scan-matrix', sweep.name, level.label, t);
    const rng = new Prng(seed);
    const code = codeFor(t % CODE_POOL);
    const { params, style } = level.trial(rng);
    const ppu = (params.codeWidthPx ?? 400) / CODE01_SIZE;
    const source = renderCode(code, Math.max(SOURCE_PX_PER_U, Math.ceil(ppu * 1.5)), style ?? 'classic');
    let frame: GrayImage;
    try {
      frame = simulateCapture(source, params, seed);
    } catch (e) {
      result.failures.SIMULATOR = (result.failures.SIMULATOR ?? 0) + 1;
      console.error(`  simulator rejected ${sweep.name}/${level.label}#${t}: ${(e as Error).message}`);
      continue;
    }
    const res = decodeOrbesCode(frame);
    result.times.push(res.ok ? res.quality.elapsedMs : res.elapsedMs);
    const correct = res.ok && res.data.every((b, i) => b === code.data[i]);
    if (correct) result.ok++;
    else {
      const reason = res.ok ? 'WRONG_DATA' : res.reason;
      result.failures[reason] = (result.failures[reason] ?? 0) + 1;
      if (verbose) console.log(`    ✗ ${sweep.name} / ${level.label} / trial ${t}: ${reason}${res.ok ? '' : ` (${res.detail ?? ''})`}`);
      if (dumpDir) writePng(join(dumpDir, `${sweep.name}-${level.label.replace(/[^\w.-]+/g, '_')}-${t}.png`), frame);
    }
  }
  return result;
}

function falsePositiveTrials(trials: number): { frames: number; positives: number } {
  let positives = 0;
  let frames = 0;
  const blank: GrayImage = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
  for (let t = 0; t < trials; t++) {
    const rng = new Prng(hashSeed('scan-matrix-fp', t));
    // Clutter scene with no code, and pure noise.
    const scene = simulateCapture(blank, { ...PRESETS.typicalPhone, ...pose(rng), sheetMargin: 0.2 }, t);
    const noise: GrayImage = { width: 640, height: 480, data: Uint8Array.from({ length: 640 * 480 }, () => rng.int(0, 255)) };
    for (const img of [scene, noise]) {
      frames++;
      if (decodeOrbesCode(img, { tryMirrored: true }).ok) positives++;
    }
  }
  return { frames, positives };
}

// ── Report ─────────────────────────────────────────────────────────────────

function fmtRate(r: LevelResult): string {
  return `${((100 * r.ok) / Math.max(1, r.trials)).toFixed(0)} %`;
}

function fmtFailures(f: Record<string, number>): string {
  const parts = Object.entries(f)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(', ') : '—';
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const trials = Number(arg('--trials') ?? 20);
  const only = arg('--only')?.split(',');
  const write = !args.includes('--no-write') && !only;
  const selected = sweeps().filter((s) => !only || only.includes(s.name));

  // Warm up the JIT so the first condition's timings are representative.
  decodeOrbesCode(simulateCapture(renderCode(codeFor(0), SOURCE_PX_PER_U), { codeWidthPx: 300 }, 1));

  const results: { sweep: Sweep; levels: LevelResult[] }[] = [];
  for (const sweep of selected) {
    console.log(`\n${sweep.title}`);
    const levels: LevelResult[] = [];
    for (const level of sweep.levels) {
      const r = runLevel(sweep, level, trials);
      levels.push(r);
      console.log(
        `  ${level.label.padEnd(26)} ${fmtRate(r).padStart(5)}  median ${percentile(r.times, 0.5).toFixed(0).padStart(4)} ms  p95 ${percentile(r.times, 0.95).toFixed(0).padStart(4)} ms  ${fmtFailures(r.failures)}`,
      );
    }
    results.push({ sweep, levels });
  }
  const fp = only ? null : falsePositiveTrials(Math.max(10, trials));
  if (fp) console.log(`\nFalse positives: ${fp.positives} / ${fp.frames} code-free frames`);
  if (write && fp) writeReport(results, fp, trials);
}

function minReliableSize(results: { sweep: Sweep; levels: LevelResult[] }[]): number | null {
  const size = results.find((r) => r.sweep.name === 'size');
  if (!size) return null;
  // Smallest size from which every larger size also reaches 95 %.
  let min: number | null = null;
  for (let i = size.levels.length - 1; i >= 0; i--) {
    const r = size.levels[i];
    if (r.ok / r.trials >= 0.95) min = Number.parseFloat(r.label);
    else break;
  }
  return min;
}

function writeReport(results: { sweep: Sweep; levels: LevelResult[] }[], fp: { frames: number; positives: number }, trials: number): void {
  const lines: string[] = [];
  const all = results.flatMap((r) => r.levels.flatMap((l) => l.times));
  const minPpu = minReliableSize(results);
  lines.push('# ORBES CODE-01 — scan test matrix');
  lines.push('');
  lines.push('Generated by `npx tsx scripts/scan-matrix.ts` (camera simulator `test/support/camera-sim.ts`, decoder `src/core/decoder/`).');
  lines.push(
    `Every condition runs ${trials} seeded trials, each with a real CODE-01 artifact (seeded payload, CRC-valid frame, encoder output) photographed in a 1280×720 frame and decoded with default options. A trial succeeds only when the decoded 79 data bytes equal the encoded ones. Times are decoder wall-clock time per frame on the machine that generated this report (median / 95th percentile), single-threaded Node.js.`,
  );
  lines.push('');
  lines.push(`Overall: median ${percentile(all, 0.5).toFixed(0)} ms, p95 ${percentile(all, 0.95).toFixed(0)} ms per frame. False positives: **${fp.positives} / ${fp.frames}** code-free frames (desk clutter scenes and uniform noise, mirrored reading enabled).`);
  lines.push('');
  for (const { sweep, levels } of results) {
    lines.push(`## ${sweep.title}`);
    lines.push('');
    lines.push(sweep.note);
    lines.push('');
    lines.push('| Condition | Success | Median | p95 | Failures |');
    lines.push('|---|---:|---:|---:|---|');
    for (const r of levels) {
      lines.push(`| ${r.label} | ${fmtRate(r)} | ${percentile(r.times, 0.5).toFixed(0)} ms | ${percentile(r.times, 0.95).toFixed(0)} ms | ${fmtFailures(r.failures)} |`);
    }
    lines.push('');
  }
  lines.push('## Smallest reliable printed size');
  lines.push('');
  if (minPpu === null) {
    lines.push('The size sweep never reached 95 % success; no reliable size can be stated.');
  } else {
    const mm = (pxPerMm: number) => ((CODE01_SIZE * minPpu) / pxPerMm).toFixed(1);
    lines.push(
      `Under the typicalPhone preset the decoder reaches ≥ 95 % success from **${minPpu.toFixed(2)} px per u** upward. The printed artifact is 50 u wide (quiet zone included), so it must span at least ${(CODE01_SIZE * minPpu).toFixed(0)} frame pixels. Converted to print sizes under stated assumptions about the phone:`,
    );
    lines.push('');
    lines.push('| Assumed capture | Sampling | Smallest reliable artifact (50 u) | Cell pitch |');
    lines.push('|---|---:|---:|---:|');
    lines.push(`| 1080p stream, phone 12–15 cm away | ≈ 10 px/mm | **${mm(10)} mm** | ${(minPpu / 10).toFixed(2)} mm |`);
    lines.push(`| 1080p stream, phone 8–10 cm away (close focus) | ≈ 16 px/mm | **${mm(16)} mm** | ${(minPpu / 16).toFixed(2)} mm |`);
    lines.push('');
    lines.push(
      'Honest caveats: these figures come from a simulator, not from real phones. They assume the phone actually focuses at that distance (many main cameras cannot focus closer than 8–10 cm, which is why the close-up row is the optimistic bound), that the scanner receives the full-resolution stream rather than a downscaled preview, and print or engraving that holds the 0.28 u gaps between rings at that pitch. Allow a margin of at least 1.5× over these minima for production artwork; real-device validation remains necessary before committing to a minimum size.',
    );
  }
  lines.push('');
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'reports', 'scan-matrix.md');
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`\nWrote ${out}`);
}

main();
