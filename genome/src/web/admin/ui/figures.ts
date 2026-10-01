/**
 * Genome and code figures, rendered in the browser by the core renderers
 * (the same code the server uses for print artifacts), framed by hairline
 * corner brackets.
 *
 * The code preview needs the framed code data, which the API only returns
 * to an OPERATOR right after issuance or re-issue; read views show the
 * genome only.
 */
import { fromBase64Url } from '../../../core/bytes.js';
import { encodeOrbesCode, renderOrbesCodeSvg } from '../../../core/code/encoder.js';
import { ORBES_CODE_STYLES } from '../../../core/code/styles.js';
import type { Genome } from '../../../core/genome/genome.js';
import { renderGenomeSvg } from '../../../core/genome/render.js';
import { bracket } from '../../shared/corners.js';
import { h, parseSvg } from '../../shared/dom.js';
import type { ArtifactTheme, GenomeJson } from '../types.js';

/** The core `Genome` shape from the API's genome JSON (packedIdentity is not needed for rendering). */
export function toCoreGenome(g: GenomeJson): Genome {
  return { version: g.version, packedIdentity: 0, value: g.value, glyphs: [...g.glyphs], ids: [...g.ids], fingerprint: g.fingerprint };
}

/**
 * SVG markup of a genome. Figures sit on ivory plates, so the glyphs are
 * drawn in the ivory colourway's ink, exactly as the ivory code prints them
 * (BRAND-DESIGN-SYSTEM §2.4).
 */
export function genomeFigureMarkup(g: GenomeJson, layout: 'orbit' | 'row' = 'orbit'): string {
  return renderGenomeSvg(toCoreGenome(g), { layout, ink: ORBES_CODE_STYLES.ivory.ink, paper: null });
}

/** Genome on its orbit around the seal, as in the printed code. */
export function genomeFigure(g: GenomeJson, opts: { layout?: 'orbit' | 'row'; size?: 'lg' | 'md' | 'sm'; framed?: boolean } = {}): HTMLElement {
  const svg = parseSvg(genomeFigureMarkup(g, opts.layout ?? 'orbit'));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Genome ${g.fingerprint}`);
  const fig = h('figure', { class: ['figure', `figure--${opts.size ?? 'md'}`, `figure--${opts.layout ?? 'orbit'}`], data: { testid: 'genome-figure' } }, svg);
  return opts.framed === false ? fig : bracket(fig);
}

export const THEME_COLORS: Readonly<Record<ArtifactTheme, { ink: string; paper: string }>> = Object.freeze({
  classic: ORBES_CODE_STYLES.classic,
  inverted: ORBES_CODE_STYLES.inverted,
  ivory: ORBES_CODE_STYLES.ivory,
});

/**
 * The scannable code from its base64url data and genome glyphs. Throws when
 * the data is not 79 bytes (the encoder validates its input).
 */
export function codeSvgMarkup(data: string, glyphs: readonly number[], theme: ArtifactTheme, decor = true): string {
  const model = encodeOrbesCode({ data: fromBase64Url(data), genomeGlyphs: glyphs }, { decor });
  return renderOrbesCodeSvg(model, { ...THEME_COLORS[theme], decor });
}

export function codeFigure(data: string, glyphs: readonly number[], theme: ArtifactTheme, decor = true): HTMLElement {
  const svg = parseSvg(codeSvgMarkup(data, glyphs, theme, decor));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'ORBES CODE-01 preview');
  return bracket(h('figure', { class: ['figure', 'figure--code', `figure--theme-${theme}`], data: { testid: 'code-figure' } }, svg));
}
