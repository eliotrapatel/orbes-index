/**
 * The GENOME figure, drawn by the core renderer (renderGenomeSvg) exactly as
 * it is defined for print, so the screen, the PDF certificate and the printed
 * code show the same eight glyphs.
 *
 * The result page draws them in their orbit (glyph 0 at north, then
 * clockwise, each glyph in its absolute orientation), as they sit on the piece
 * and in the console: the customer compares the screen with the object at a
 * glance, without unrolling the orbit in their head. On a collector's screens
 * (a result, a piece, the ceremony of a first registration) the GENOME is drawn
 * in ivory on the ground, the ORBES monogram at the orbit's centre in place of
 * the SEAL (NOCTURNE, decision 12); the shared ownership certificate keeps its
 * ivory plate, the ivory colourway's ink and the SEAL, as the printed code, the
 * PDF certificate and the console draw it.
 *
 * The glyphs come from the server's verification outcome. They are recomputed
 * here only to cross-check the fingerprint the server sent: a mismatch means
 * an inconsistent response, and the row is then not drawn at all (the
 * fingerprint text still shows what the server said).
 */
import { ORBES_CODE_STYLES } from '../../core/code/styles.js';
import { computeGenome, identityFromGenomeGlyphs, renderGenomeSvg, SUPPORTED_GENOME_VERSIONS, type Genome } from '../../core/genome/index.js';
import type { GenomeCentre } from '../../core/genome/render.js';
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

/** The ink of the GENOME on a collector's screen (NOCTURNE): the ivory of the ground's text, --vault-ink. */
export const GENOME_SCREEN_INK = '#f6f2ea';

export interface GenomeDrawing {
  layout?: 'row' | 'orbit';
  /** The orbit's centre: the SEAL (default, as printed) or the ORBES monogram (a collector's screen, decision 12). */
  centre?: GenomeCentre;
  /** The ink: the ivory colourway's (default, on an ivory plate, as the ivory code prints it) or GENOME_SCREEN_INK. */
  ink?: string;
}

/**
 * SVG markup of the GENOME (glyph row by default, or the orbit), or null when it cannot be drawn faithfully. By
 * default as the console draws it: around the SEAL, in the ivory colourway's ink, exactly as the ivory code prints it
 * (BRAND-DESIGN-SYSTEM §2.4), for an ivory plate.
 */
export function genomeRowMarkup(m: GenomeModel, opts: GenomeDrawing = {}): string | null {
  const genome = genomeFromModel(m);
  if (!genome) return null;
  return renderGenomeSvg(genome, { layout: opts.layout ?? 'row', ...(opts.centre ? { centre: opts.centre } : {}), ink: opts.ink ?? ORBES_CODE_STYLES.ivory.ink, paper: null });
}

/** The GENOME as an inline SVG, or null when it cannot be drawn faithfully. */
export function genomeRow(m: GenomeModel, opts: GenomeDrawing = {}): SVGSVGElement | null {
  const markup = genomeRowMarkup(m, opts);
  if (markup === null) return null;
  const svg = parseSvg(markup);
  svg.setAttribute('class', `genome-svg genome-svg--${opts.layout ?? 'row'}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `GENOME ${m.fingerprint}: ${m.ids.map((id) => id.replace(/_/g, ' ').toLowerCase()).join(', ')}`);
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}

/**
 * The GENOME block: label, product id, the glyphs in their orbit, fingerprint. On a result the label GENOME is the
 * block's heading; in MY PIECES (`titleId`), where each piece has its plate, the product id is (an h2 with that id,
 * which names the piece), and GENOME stays its label. On a collector's screen the orbit is drawn in ivory around the
 * ORBES monogram, with its glow (NOCTURNE, decision 12); `seal` draws it as printed, around the SEAL in the ivory
 * colourway's ink, on the shared ownership certificate's ivory plate.
 */
export function genomeBlock(m: GenomeModel, opts: { titleId?: string; seal?: boolean } = {}): HTMLElement {
  const figure = opts.seal ? genomeRow(m, { layout: 'orbit' }) : genomeRow(m, { layout: 'orbit', centre: 'monogram', ink: GENOME_SCREEN_INK });
  if (figure && !opts.seal) figure.classList.add('n-glow');
  const titled = opts.titleId !== undefined;
  return h(
    'section',
    { class: 'genome', attrs: { 'aria-labelledby': titled ? opts.titleId : 'genome-label' } },
    titled ? h('p', { class: 'genome__label micro', text: 'GENOME' }) : h('h2', { class: 'genome__label micro', id: 'genome-label', text: 'GENOME' }),
    titled ? h('h2', { class: 'genome__id', id: opts.titleId, text: m.id }) : h('p', { class: 'genome__id', text: m.id }),
    figure ? h('div', { class: 'genome__glyphs' }, figure) : null,
    h('p', { class: 'genome__meta micro soft' }, h('span', { text: m.fingerprint }), h('span', { class: 'sep', attrs: { 'aria-hidden': 'true' }, text: '·' }), h('span', { text: m.version })),
  );
}

/**
 * The GENOME as NOCTURNE draws it on a result (n.py genome(), C9 and C13–C16; the ceremony's, C36): its label, the
 * orbit in ivory with its glow and the ORBES monogram at its centre (decision 12), 200 px (220 px in the ceremony of a
 * first registration), then the product id and the fingerprint with its version, centred. Its figures in the reading
 * face (the plan's Type rule). The figure is left out when it cannot be drawn faithfully; the words stay.
 */
export function nocturneGenome(m: GenomeModel, opts: { size?: 200 | 220; extraClass?: string } = {}): HTMLElement {
  const figure = genomeRow(m, { layout: 'orbit', centre: 'monogram', ink: GENOME_SCREEN_INK });
  if (figure) figure.classList.add('n-glow');
  const box = figure ? h('div', { class: ['n-gen__figure', opts.size === 220 ? 'n-gen__figure--220' : null] }, figure) : null;
  return h(
    'section',
    { class: ['n-gen', opts.extraClass], attrs: { 'aria-labelledby': 'genome-label' } },
    h('h2', { class: 'n-g n-lb n-gen__label', id: 'genome-label', text: 'GENOME' }),
    box,
    h('p', { class: 'n-g n-gen__id n-num' }, ...digitsApart(m.id)),
    h('p', { class: 'n-gen__fp n-num', text: `${m.fingerprint} · ${m.version}` }),
  );
}

/** A label's figures in the reading face (`.numeral`), its letters in Gravesend. */
function digitsApart(text: string): (string | HTMLSpanElement)[] {
  return text.split(/(\d+)/).flatMap((part, i): (string | HTMLSpanElement)[] => (part === '' ? [] : i % 2 === 1 ? [h('span', { class: 'numeral', text: part })] : [part]));
}
