/**
 * The GENOME glyph row, drawn by the core renderer (renderGenomeSvg) exactly
 * as it is defined for print, so the screen, the PDF certificate and the
 * printed code show the same eight glyphs.
 *
 * The glyphs come from the server's verification outcome. They are recomputed
 * here only to cross-check the fingerprint the server sent: a mismatch means
 * an inconsistent response, and the row is then not drawn at all (the
 * fingerprint text still shows what the server said).
 */
import { computeGenome, identityFromGenomeGlyphs, renderGenomeSvg, SUPPORTED_GENOME_VERSIONS, type Genome } from '../../core/genome/index.js';
import { h, parseSvg } from '../shared/dom.js';
import type { GenomeModel } from './view-model.js';

/** The core Genome for a server genome, or null if it is not internally consistent. */
export function genomeFromModel(m: GenomeModel): Genome | null {
  if (!SUPPORTED_GENOME_VERSIONS.includes(m.versionNumber)) return null;
  try {
    const genome = computeGenome(identityFromGenomeGlyphs(m.glyphs, m.versionNumber), m.versionNumber);
    if (genome.fingerprint !== m.fingerprint) return null;
    if (genome.glyphs.some((g, i) => g !== m.glyphs[i])) return null;
    return genome;
  } catch {
    return null;
  }
}

/** The glyph row as an inline SVG in `currentColor`, or null when it cannot be drawn faithfully. */
export function genomeRow(m: GenomeModel, opts: { layout?: 'row' | 'orbit' } = {}): SVGSVGElement | null {
  const genome = genomeFromModel(m);
  if (!genome) return null;
  const svg = parseSvg(renderGenomeSvg(genome, { layout: opts.layout ?? 'row', ink: 'currentColor', paper: null }));
  svg.setAttribute('class', `genome-svg genome-svg--${opts.layout ?? 'row'}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `GENOME ${m.fingerprint}: ${m.ids.map((id) => id.replace(/_/g, ' ').toLowerCase()).join(', ')}`);
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}

/** The GENOME block: label, product id, glyph row, fingerprint. */
export function genomeBlock(m: GenomeModel): HTMLElement {
  const row = genomeRow(m);
  return h(
    'section',
    { class: 'genome', attrs: { 'aria-labelledby': 'genome-label' } },
    h('h2', { class: 'genome__label micro', id: 'genome-label', text: 'GENOME' }),
    h('p', { class: 'genome__id', text: m.id }),
    row ? h('div', { class: 'genome__glyphs' }, row) : null,
    h('p', { class: 'genome__meta nano soft' }, h('span', { text: m.fingerprint }), h('span', { class: 'sep', attrs: { 'aria-hidden': 'true' }, text: '·' }), h('span', { text: m.version })),
  );
}
