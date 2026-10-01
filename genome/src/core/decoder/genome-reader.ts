/**
 * GENOME glyph reading (secondary, human-identity cross-check).
 *
 * Each of the eight glyph positions is resampled through the final code →
 * image homography onto a small square grid in the code plane, then compared
 * by normalised cross-correlation with templates rasterised from the same
 * primitives the encoder draws (genomeGlyphPrimitives). NCC is insensitive to
 * exposure and contrast, so one template set serves every substrate. A glyph
 * whose best match is weak, or barely better than the runner-up, is reported
 * as null rather than guessed. Nothing here can make a decode fail.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01, CODE01_GENOME_CENTERS } from '../code/profile.js';
import { genomeGlyphPrimitives } from '../genome/render.js';
import { GENOME01_GLYPHS } from '../genome/vocabulary.js';
import { angleOf, type Primitive } from '../geometry.js';
import type { Homography } from './homography.js';
import { sampleBilinear, type GrayImage } from './image.js';

/** Grid resolution across the glyph patch and its half-extent (u). */
const GRID = 14;
const HALF_EXTENT = CODE01.genome.glyphRadius * 1.1;
/** Supersampling per grid cell when rasterising templates. */
const SUPER = 4;

/** A glyph is reported only when its template correlates at least this well… */
const MIN_CORRELATION = 0.45;
/** …and clearly better than the runner-up. */
const MIN_MARGIN = 0.06;

/** True when angle `a` lies in the clockwise interval [start, end] (radians, any turn). */
function inSpan(a: number, start: number, end: number): boolean {
  const t = 2 * Math.PI;
  const rel = (((a - start) % t) + t) % t;
  return rel <= end - start;
}

/** True when (x, y) is inked by primitive p (geometry.ts semantics). */
export function primitiveCovers(p: Primitive, x: number, y: number): boolean {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const d = Math.hypot(dx, dy);
  switch (p.kind) {
    case 'disc':
      return d <= p.r;
    case 'ring':
      return Math.abs(d - p.r) <= p.width / 2;
    case 'halfDisc':
      return d <= p.r && dx * Math.sin(p.angle) - dy * Math.cos(p.angle) >= 0;
    case 'crescent': {
      const ox = p.cx + p.offset * Math.sin(p.angle);
      const oy = p.cy - p.offset * Math.cos(p.angle);
      return d <= p.r && Math.hypot(x - ox, y - oy) > p.r;
    }
    case 'arc': {
      const half = p.width / 2;
      if (p.cap === 'butt') return Math.abs(d - p.r) <= half && inSpan(angleOf(dx, dy), p.start, p.end);
      // Round caps lie inside [start, end]: a band over the inset span plus a disc at each end.
      const inset = Math.asin(Math.min(1, half / p.r));
      const a = p.start + inset;
      const b = p.end - inset;
      if (b <= a) {
        const mid = (p.start + p.end) / 2;
        return Math.hypot(x - (p.cx + p.r * Math.sin(mid)), y - (p.cy - p.r * Math.cos(mid))) <= p.r * Math.sin((p.end - p.start) / 2);
      }
      if (Math.abs(d - p.r) <= half && inSpan(angleOf(dx, dy), a, b)) return true;
      for (const e of [a, b]) {
        if (Math.hypot(x - (p.cx + p.r * Math.sin(e)), y - (p.cy - p.r * Math.cos(e))) <= half) return true;
      }
      return false;
    }
  }
}

/** Grid offsets (u) of the patch samples, row-major. */
function gridOffset(k: number): number {
  return -HALF_EXTENT + ((k + 0.5) * 2 * HALF_EXTENT) / GRID;
}

/** Zero-mean, unit-norm vector (null when flat). */
function normalise(v: Float64Array): Float64Array | null {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean;
    norm += v[i] * v[i];
  }
  if (!(norm > 1e-9)) return null;
  const s = 1 / Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] *= s;
  return v;
}

let templates: (Float64Array | null)[] | null = null;

/** Ink coverage templates of the 16 GENOME-01 glyphs, built on first use. */
function glyphTemplates(): (Float64Array | null)[] {
  if (templates) return templates;
  const R = CODE01.genome.glyphRadius;
  templates = GENOME01_GLYPHS.map((g) => {
    const prims = genomeGlyphPrimitives(g.index, 0, 0, R);
    const t = new Float64Array(GRID * GRID);
    const cell = (2 * HALF_EXTENT) / GRID;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        let hits = 0;
        for (let sj = 0; sj < SUPER; sj++) {
          for (let si = 0; si < SUPER; si++) {
            const x = gridOffset(i) + ((si + 0.5) / SUPER - 0.5) * cell;
            const y = gridOffset(j) + ((sj + 0.5) / SUPER - 0.5) * cell;
            if (prims.some((p) => primitiveCovers(p, x, y))) hits++;
          }
        }
        t[j * GRID + i] = hits / (SUPER * SUPER);
      }
    }
    return normalise(t);
  });
  return templates;
}

export interface GenomeRead {
  glyphs: (number | null)[];
  confidence: number[];
}

/**
 * Read the eight glyphs through `h` (true code frame → image). Confidence is
 * the best correlation scaled by its margin over the runner-up, in 0..1.
 */
export function readGenome(img: GrayImage, h: Homography): GenomeRead {
  const tpl = glyphTemplates();
  const glyphs: (number | null)[] = [];
  const confidence: number[] = [];
  const patch = new Float64Array(GRID * GRID);
  for (const c of CODE01_GENOME_CENTERS) {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = c.x + gridOffset(i);
        const y = c.y + gridOffset(j);
        const w = h[6] * x + h[7] * y + h[8];
        // Darkness, so that ink correlates positively with template coverage.
        patch[j * GRID + i] = 255 - sampleBilinear(img, (h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w);
      }
    }
    const v = normalise(patch);
    let best = -1;
    let bestScore = -Infinity;
    let second = -Infinity;
    if (v) {
      tpl.forEach((t, g) => {
        if (!t) return;
        let s = 0;
        for (let k = 0; k < t.length; k++) s += t[k] * v[k];
        if (s > bestScore) {
          second = bestScore;
          bestScore = s;
          best = g;
        } else if (s > second) {
          second = s;
        }
      });
    }
    const margin = bestScore - second;
    const ok = best >= 0 && bestScore >= MIN_CORRELATION && margin >= MIN_MARGIN;
    glyphs.push(ok ? best : null);
    confidence.push(ok ? Math.max(0, Math.min(1, bestScore * Math.min(1, margin / 0.3))) : 0);
  }
  return { glyphs, confidence };
}
