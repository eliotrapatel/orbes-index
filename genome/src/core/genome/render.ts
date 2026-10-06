/**
 * ORBES GENOME — rendering of glyphs and whole genomes.
 *
 * Two presentations of the same 8 glyphs:
 *   - 'row'   : the glyphs in reading order, separated by small centred points,
 *               as the glyph hints read in plain text ("○ · ◠ · ◝ · …");
 *   - 'orbit' : the glyphs on their orbit around the ORBES SEAL, in exactly the
 *               proportions and positions they occupy in a CODE-01 artifact
 *               (glyph 0 at north, then clockwise every 45°).
 * The orbit's centre is the SEAL by default, as every printed code, label,
 * print file, PDF certificate, the console and the decoder have it (the
 * scanner finds a code by its seal's rings: it is machine-critical). On a
 * collector's screen (NOCTURNE, decision 12) it may be the ORBES monogram
 * instead: `centre: 'monogram'` gives the SEAL's core disc and ring way to
 * the master paths of the monogram (core/render/monogram.ts, placed, never
 * redrawn), in the glyphs' ink, 8 u wide (the seal ring's diameter), centred
 * inside the seal's quiet ring (5.75 u).
 * Restrained by design: one ink on one paper, no gradients.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01 } from '../code/profile.js';
import { polar, type Primitive } from '../geometry.js';
import { monogramHeight, monogramPathData } from '../render/monogram.js';
import { primitivesToSvg, type ViewBox } from '../render/svg.js';
import { genomeVocabulary, type Genome } from './genome.js';

/** What sits at the centre of the orbit: the ORBES SEAL (the default, as printed), or the ORBES monogram (on screen). */
export type GenomeCentre = 'seal' | 'monogram';

export interface GenomeSvgOptions {
  layout?: 'row' | 'orbit';
  /** The orbit's centre (default the SEAL); the row has none. */
  centre?: GenomeCentre;
  ink?: string;
  /** Background colour; null for transparent. */
  paper?: string | null;
  /** Physical glyph diameter in millimetres. Omitted: unitless SVG that scales to its container. */
  glyphSize?: number;
}

/** Primitives of one glyph of a genome version, centred on (cx, cy), ink within radius R. */
export function genomeGlyphPrimitives(glyph: number, cx: number, cy: number, R: number, version = 1): Primitive[] {
  const vocabulary = genomeVocabulary(version);
  if (!(Number.isInteger(glyph) && glyph >= 0 && glyph < vocabulary.length)) throw new RangeError(`invalid glyph index ${glyph}`);
  if (!(Number.isFinite(R) && R > 0)) throw new RangeError(`glyph radius must be positive, got ${R}`);
  return vocabulary[glyph].primitives(cx, cy, R);
}

// Row layout, in units of the glyph radius.
const ROW_PITCH = 3.4;
const ROW_SEPARATOR_RADIUS = 0.13;
const ROW_MARGIN = 0.7;

// Orbit layout, in CODE-01 units: genome orbit, glyph size and seal as printed.
const ORBIT_SEPARATOR_RADIUS = 0.22;
const ORBIT_MARGIN = 1.25;

export interface GenomeLayout {
  primitives: Primitive[];
  viewBox: ViewBox;
  /** Glyph radius in viewBox units (maps glyphSize to a physical size). */
  glyphRadius: number;
  /**
   * The ORBES monogram at the orbit's centre (`centre: 'monogram'`): the master's five outlines as absolute path data
   * in viewBox units, filled with the nonzero rule in the glyphs' ink; absent with the SEAL, and in the row.
   */
  monogram?: string[];
}

/** The monogram's width at the orbit's centre, in CODE-01 units: the seal ring's diameter. */
export const GENOME_MONOGRAM_WIDTH = 2 * CODE01.seal.ringOuter;

function rowLayout(genome: Pick<Genome, 'glyphs' | 'version'>): GenomeLayout {
  const primitives: Primitive[] = [];
  genome.glyphs.forEach((g, i) => {
    if (i > 0) primitives.push({ kind: 'disc', layer: 'decor', cx: (i - 0.5) * ROW_PITCH, cy: 0, r: ROW_SEPARATOR_RADIUS });
    primitives.push(...genomeGlyphPrimitives(g, i * ROW_PITCH, 0, 1, genome.version));
  });
  const edge = 1 + ROW_MARGIN;
  return {
    primitives,
    viewBox: { x: -edge, y: -edge, w: (genome.glyphs.length - 1) * ROW_PITCH + 2 * edge, h: 2 * edge },
    glyphRadius: 1,
  };
}

function orbitLayout(genome: Pick<Genome, 'glyphs' | 'version'>, centre: GenomeCentre): GenomeLayout {
  const { seal } = CODE01;
  const { orbitRadius, glyphRadius, stepRad } = CODE01.genome;
  const ringWidth = seal.ringOuter - seal.gapOuter;
  const primitives: Primitive[] =
    centre === 'seal'
      ? [
          { kind: 'disc', layer: 'seal', cx: 0, cy: 0, r: seal.coreRadius },
          { kind: 'ring', layer: 'seal', cx: 0, cy: 0, r: seal.gapOuter + ringWidth / 2, width: ringWidth },
        ]
      : [];
  genome.glyphs.forEach((g, i) => {
    const c = polar(orbitRadius, i * stepRad);
    primitives.push(...genomeGlyphPrimitives(g, c.x, c.y, glyphRadius, genome.version));
    const dot = polar(orbitRadius, (i + 0.5) * stepRad);
    primitives.push({ kind: 'disc', layer: 'decor', cx: dot.x, cy: dot.y, r: ORBIT_SEPARATOR_RADIUS });
  });
  const edge = orbitRadius + glyphRadius + ORBIT_MARGIN;
  const viewBox = { x: -edge, y: -edge, w: 2 * edge, h: 2 * edge };
  if (centre === 'seal') return { primitives, viewBox, glyphRadius };
  const width = GENOME_MONOGRAM_WIDTH;
  const monogram = monogramPathData({ x: -width / 2, y: -monogramHeight(width) / 2, width });
  return { primitives, viewBox, glyphRadius, monogram };
}

/**
 * Geometry of a genome presentation, for renderers other than SVG (PDF labels and cards, specimen sheets, the image
 * SHARE THE GENOME draws). `centre` is the orbit's (the SEAL by default).
 */
export function genomeLayout(genome: Pick<Genome, 'glyphs' | 'version'>, layout: 'row' | 'orbit' = 'row', opts: { centre?: GenomeCentre } = {}): GenomeLayout {
  if (genome.glyphs.length !== CODE01.genome.count) throw new RangeError(`a genome has ${CODE01.genome.count} glyphs, got ${genome.glyphs.length}`);
  const centre = opts.centre ?? 'seal';
  if (centre !== 'seal' && centre !== 'monogram') throw new RangeError(`unknown genome centre ${String(centre)}`);
  if (layout === 'row') return rowLayout(genome);
  if (layout === 'orbit') return orbitLayout(genome, centre);
  throw new RangeError(`unknown genome layout ${String(layout)}`);
}

/** Standalone SVG of a genome. */
export function renderGenomeSvg(genome: Genome, opts: GenomeSvgOptions = {}): string {
  const { primitives, viewBox, glyphRadius, monogram } = genomeLayout(genome, opts.layout, { centre: opts.centre });
  let widthMm: number | undefined;
  if (opts.glyphSize !== undefined) {
    if (!(Number.isFinite(opts.glyphSize) && opts.glyphSize > 0)) throw new RangeError(`glyphSize must be positive, got ${opts.glyphSize}`);
    widthMm = (opts.glyphSize * viewBox.w) / (2 * glyphRadius);
  }
  return primitivesToSvg(primitives, viewBox, {
    ink: opts.ink,
    paper: opts.paper,
    widthMm,
    title: `ORBES GENOME ${genome.fingerprint}`,
    ...(monogram ? { paths: [{ layer: 'monogram', d: monogram }] } : {}),
  });
}
