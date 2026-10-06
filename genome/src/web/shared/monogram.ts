/**
 * The ORBES monogram on screen (BRAND-DESIGN-SYSTEM §3.9): the brand's master
 * emblem, five filled outlines (src/core/render/monogram.ts, the paths of
 * docs/assets/brand/orbes-monogram.svg), as inline SVG in currentColor, so it
 * takes the ink of wherever it sits: --ink on paper and on the console's
 * ivory.
 *
 * An emblem beside the word, never the word: ORBES stays typed next to it in
 * the display face (.wordmark). Standing alone, the emblem is an image named
 * ORBES (role="img", aria-label="ORBES"). Beside the typed word, which is
 * where every screen puts it (the /verify landing, the console's sign-in and
 * sidebar), it is decorative and hidden from assistive technology: the word
 * already says ORBES, and a second name would make screen readers say it
 * twice (WCAG technique H2).
 *
 * The viewBox is the ink's box (MONOGRAM_BOUNDS), not the master's 500 × 500
 * artboard, so the stylesheet that places the emblem sets its width and its
 * clear space; its height follows the ink (0.76 of the width). NOCTURNE's
 * canvas places it on its master artboard instead (`artboard`: a square box,
 * the ink centred in it with the master's own margins), sized by the box: the
 * header's 28 px, the footer's 38 px, the loading state's 40 px.
 */
import { MONOGRAM_ARTBOARD, MONOGRAM_BOUNDS, MONOGRAM_LABEL, MONOGRAM_PATHS } from '../../core/render/monogram.js';
import { parseSvg } from './dom.js';

export interface MonogramOptions {
  /** Extra class names (the placing component's own, e.g. 'landing__monogram'). */
  class?: string;
  /** Beside the typed word ORBES: aria-hidden instead of an image named ORBES. */
  decorative?: boolean;
  /** The master's 500 × 500 artboard as the viewBox, not the ink's box (NOCTURNE's square placements). */
  artboard?: boolean;
}

/** The emblem as SVG markup: `monogram` class, the five master outlines, filled with currentColor. */
export function monogramMarkup(opts: MonogramOptions = {}): string {
  const cls = ['monogram', opts.class].filter(Boolean).join(' ');
  if (!/^[\w -]+$/.test(cls)) throw new Error('monogram: invalid class name');
  const b = opts.artboard ? MONOGRAM_ARTBOARD : MONOGRAM_BOUNDS;
  const a11y = opts.decorative ? 'aria-hidden="true"' : `role="img" aria-label="${MONOGRAM_LABEL}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" fill="currentColor" focusable="false" ${a11y}>` +
    MONOGRAM_PATHS.map((d) => `<path d="${d}"/>`).join('') +
    '</svg>'
  );
}

/** The emblem as a live element, for the views. */
export function monogramSvg(opts: MonogramOptions = {}): SVGSVGElement {
  return parseSvg(monogramMarkup(opts));
}
