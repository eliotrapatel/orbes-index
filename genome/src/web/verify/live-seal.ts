/**
 * The seal of the LIVE RELEASE's vault (plan of 2026-10-04, The VAULT look): the ORBES CODE drawn in ivory by the core
 * renderer (encodeOrbesCode, primitivesToSvg), from a fixed SPECIMEN payload, never a piece's code. It is the lock of
 * the vault's door, the seal a collector presses and holds in their turn, and the piece secured.
 *
 *   <svg class="live-seal">            viewBox −25 −25 50 50, as the printed code
 *     <g class="live-seal__fixed">     the hairlines, the seal, the four moons and polaris's halo
 *     <g class="live-seal__ring">  ×13 each data orbit on its own (format and data cells), so the lock can turn them
 *     <g class="live-seal__genome">    the eight GENOME glyphs, one `data-layer="genome"` group each, `--i` its order
 *
 * The ink is `currentColor` (ivory on the vault's ground): the colour is the stylesheet's. The specimen's 79 bytes come
 * from a fixed generator: no signature verifies them, so a camera pointed at the screen reads no piece.
 */
import { encodeOrbesCode } from '../../core/code/encoder.js';
import { CODE01, CODE01_GENOME_CENTERS, CODE01_RINGS, CODE01_SIZE } from '../../core/code/profile.js';
import { genomeGlyphPrimitives } from '../../core/genome/render.js';
import type { Primitive } from '../../core/geometry.js';
import { primitivesToSvg, type ViewBox } from '../../core/render/svg.js';
import { parseSvg, s } from '../shared/dom.js';

/** The specimen's GENOME: eight glyphs of GENOME-01, glyph 0 at north. */
export const SPECIMEN_GLYPHS: readonly number[] = Object.freeze([2, 9, 5, 14, 0, 11, 7, 12]);

/** The specimen's 79 bytes: a fixed xorshift sequence (no payload, no signature, no CRC that holds). */
export function specimenData(): Uint8Array {
  const out = new Uint8Array(CODE01.ecc.dataBytes);
  let x = 0x0be52026;
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = (x >>> 0) & 0xff;
  }
  return out;
}

const VIEW: ViewBox = { x: -CODE01_SIZE / 2, y: -CODE01_SIZE / 2, w: CODE01_SIZE, h: CODE01_SIZE };

interface SealMarkup {
  fixed: string;
  rings: string[];
  glyphs: string[];
}

let markup: SealMarkup | null = null;

/** The specimen's parts as SVG markup of the core renderer, built once. */
function sealMarkup(): SealMarkup {
  if (markup) return markup;
  const model = encodeOrbesCode({ data: specimenData(), genomeGlyphs: SPECIMEN_GLYPHS }, { decor: true });
  const render = (primitives: Primitive[]) => primitivesToSvg(primitives, VIEW, { ink: 'currentColor', paper: null });
  const ringOf = (p: Primitive) => ((p.layer === 'format' || p.layer === 'data') && p.cx === 0 && p.cy === 0 ? CODE01_RINGS.findIndex((r) => Math.abs(r.radius - p.r) < 1e-9) : -1);
  const fixed = model.primitives.filter((p) => p.layer !== 'genome' && ringOf(p) < 0);
  markup = {
    fixed: render(fixed),
    rings: CODE01_RINGS.map((_, k) => render(model.primitives.filter((p) => ringOf(p) === k))),
    glyphs: SPECIMEN_GLYPHS.map((g, i) => render(genomeGlyphPrimitives(g, CODE01_GENOME_CENTERS[i]!.x, CODE01_GENOME_CENTERS[i]!.y, CODE01.genome.glyphRadius))),
  };
  return markup;
}

/** The ink group of a rendered part (`<g fill="currentColor">…`), as a live element. */
function inkOf(svg: string): SVGGElement {
  const g = parseSvg(svg).querySelector('g');
  if (!g) throw new Error('live-seal: empty part');
  return g as SVGGElement;
}

/** The number of data orbits the lock turns. */
export const SEAL_RINGS = CODE01_RINGS.length;

/** The specimen seal as a decorative inline SVG (`className` its classes): the lock, the seal to hold, the piece's seal. */
export function sealSvg(className: string): SVGSVGElement {
  const m = sealMarkup();
  const root = s('svg', { class: `live-seal ${className}`.trim(), viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`, 'aria-hidden': 'true', focusable: 'false' });
  root.appendChild(s('g', { class: 'live-seal__fixed' }, inkOf(m.fixed)));
  m.rings.forEach((ring, k) => root.appendChild(s('g', { class: 'live-seal__ring', 'data-ring': k }, inkOf(ring))));
  const genome = s('g', { class: 'live-seal__genome' });
  m.glyphs.forEach((glyph, i) => {
    const g = inkOf(glyph);
    // Each glyph its own group of the layer genome, as the ceremony (P-D01) reveals them: `--i` its order, set through the CSSOM.
    const layer = g.querySelector<SVGGElement>('g[data-layer="genome"]') ?? g;
    layer.style.setProperty('--i', String(i));
    genome.appendChild(g);
  });
  root.appendChild(genome);
  return root;
}

/** Turn the lock's orbits (degrees, one per data orbit), through the CSSOM. */
export function turnRings(svg: SVGSVGElement, angles: (ring: number) => number): void {
  svg.querySelectorAll<SVGGElement>('.live-seal__ring').forEach((g, k) => {
    g.style.transform = `rotate(${angles(k).toFixed(2)}deg)`;
  });
}
