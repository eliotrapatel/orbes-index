/**
 * SHARE THE GENOME (P-D01): the image the ceremony of a first registration
 * offers to share, drawn on a canvas.
 *
 *   ┌──────────────────────────┐
 *   │          ORBES           │   wordmark, display face
 *   │          GENOME          │   its label, ink-soft
 *   │                          │
 *   │        ◔  ◯  ◕           │   the eight glyphs in their orbit around the
 *   │      ◑    ⦶    ◐         │   ORBES monogram, as the result draws them
 *   │        ◒  ◓  ◖           │   (NOCTURNE, decision 12), from genomeLayout
 *   │                          │   (a Path2D of each primitive and of each of
 *   │                          │   the monogram's outlines), in the ivory
 *   │                          │   colourway's ink
 *   │                          │
 *   │        MONOLITHE         │   the model, display face (figures in the reading face)
 *   │          ORBIT           │   its collection, ink-soft
 *   └──────────────────────────┘   on ivory, 1080 × 1350 (4:5)
 *
 * Neither the identity of the piece (its product id, its fingerprint) nor the
 * account is drawn: only what the ceremony shows of it, the GENOME, the name
 * of its model and its collection.
 *
 * The PNG is prepared when the result is built, before any gesture: Safari
 * forgets the tap that would open the share sheet while a toBlob is awaited.
 * The tap then hands the ready file to navigator.share when navigator.canShare
 * accepts it, and otherwise saves it (saveDownload).
 *
 * Imported statically (the verify app ships one bundle).
 */
import { ORBES_CODE_STYLES } from '../../core/code/styles.js';
import type { Genome } from '../../core/genome/index.js';
import { genomeLayout } from '../../core/genome/render.js';
import { primitiveToPathData } from '../../core/render/svg.js';
import { saveDownload } from '../shared/download.js';
import { CEREMONY } from './copy.js';
import type { CeremonyModel } from './view-model.js';

export const SHARE_IMAGE = Object.freeze({
  width: 1080,
  height: 1350,
  paper: ORBES_CODE_STYLES.ivory.paper,
  ink: ORBES_CODE_STYLES.ivory.ink,
  /** --ink-soft, for the GENOME label and the collection. */
  inkSoft: '#5c5c5c',
  /** The orbit's side, and the height of its centre. */
  orbit: 700,
  orbitY: 640,
});

/** The faces the image is set in: the stacks of --font-display and --font, read from the page. */
export interface ShareFonts {
  display: string;
  reading: string;
}

/** The part of a 2D context the drawing uses (a CanvasRenderingContext2D; a recorder in the tests). */
export interface ShareContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  letterSpacing?: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fill(path: Path2D): void;
}

/** A line of text, split into the runs of the display face and the figures, which take the reading face (as withNumerals). */
export function textRuns(text: string): { text: string; numeral: boolean }[] {
  return text.split(/(\d+)/).flatMap((part, i) => (part === '' ? [] : [{ text: part, numeral: i % 2 === 1 }]));
}

/**
 * One centred line, tracked: each run in its face. The tracking follows every letter, the last one included, so the
 * line is moved by half of it (as text-indent does on screen). Shrunk until it fits the width of the image.
 */
function drawLine(ctx: ShareContext, text: string, y: number, size: number, tracking: number, fonts: ShareFonts, colour: string): void {
  const runs = textRuns(text);
  const maxWidth = SHARE_IMAGE.width - 120;
  let px = size;
  const measure = (): number[] =>
    runs.map((r) => {
      ctx.font = `${r.numeral ? 400 : 500} ${px}px ${r.numeral ? fonts.reading : fonts.display}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * tracking)}px`;
      return ctx.measureText(r.text).width;
    });
  let widths = measure();
  while (widths.reduce((a, b) => a + b, 0) > maxWidth && px > 20) {
    px -= 2;
    widths = measure();
  }
  const total = widths.reduce((a, b) => a + b, 0);
  let x = (SHARE_IMAGE.width - total + px * tracking) / 2;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  runs.forEach((r, i) => {
    ctx.font = `${r.numeral ? 400 : 500} ${px}px ${r.numeral ? fonts.reading : fonts.display}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * tracking)}px`;
    ctx.fillText(r.text, x, y);
    x += widths[i];
  });
}

/** Draw the image: ivory, the wordmark and its label, the GENOME in its orbit, the name of the model and its collection. */
export function drawShareImage(ctx: ShareContext, genome: Pick<Genome, 'glyphs' | 'version'>, names: CeremonyModel, fonts: ShareFonts): void {
  const { width, height, paper, ink, inkSoft, orbit, orbitY } = SHARE_IMAGE;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  drawLine(ctx, 'ORBES', 170, 40, 0.5, fonts, ink);
  drawLine(ctx, 'GENOME', 232, 20, 0.36, fonts, inkSoft);

  // The orbit, as the result draws it (glyph 0 at north, then clockwise around the ORBES monogram), scaled into its square.
  const { primitives, viewBox, monogram } = genomeLayout(genome, 'orbit', { centre: 'monogram' });
  const scale = orbit / Math.max(viewBox.w, viewBox.h);
  ctx.setTransform(scale, 0, 0, scale, width / 2 - (viewBox.x + viewBox.w / 2) * scale, orbitY - (viewBox.y + viewBox.h / 2) * scale);
  ctx.fillStyle = ink;
  // The monogram's outlines first (as the SVG paints them), each counter running against its outline: nonzero.
  for (const d of monogram ?? []) ctx.fill(new Path2D(d));
  for (const p of primitives) {
    const tone = p.tone ?? 1;
    if (tone <= 0) continue;
    ctx.globalAlpha = Math.min(1, tone);
    // Outer contours run clockwise and holes counter-clockwise (core/render/svg.ts): the nonzero rule fills them right.
    ctx.fill(new Path2D(primitiveToPathData(p)));
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  drawLine(ctx, names.name, 1120, 54, 0.3, fonts, ink);
  if (names.collection) drawLine(ctx, names.collection, 1188, 24, 0.24, fonts, inkSoft);
}

/** The stacks of --font-display and --font as the page defines them (brand.css). */
function pageFonts(): ShareFonts {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  const reading = read('--font', 'sans-serif');
  return { display: read('--font-display', reading).replace(/var\(--font\)/, reading), reading };
}

/**
 * The PNG of SHARE THE GENOME, prepared before the gesture that shares it; null when this browser cannot draw it (no
 * canvas, no Path2D), in which case the ceremony offers no SHARE THE GENOME.
 */
export async function prepareShareImage(genome: Pick<Genome, 'glyphs' | 'version'>, names: CeremonyModel): Promise<Blob | null> {
  try {
    if (typeof Path2D !== 'function') return null;
    const fonts = pageFonts();
    // The display face is drawn only once loaded (a canvas never waits for a web font by itself).
    await document.fonts?.load(`500 54px ${fonts.display}`, names.name).catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_IMAGE.width;
    canvas.height = SHARE_IMAGE.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawShareImage(ctx, genome, names, fonts);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

/** What shares the file: the page's navigator, or a stand-in in the tests. */
export interface ShareNavigator {
  share?(data: ShareData): Promise<void>;
  canShare?(data?: ShareData): boolean;
}

/**
 * The tap on SHARE THE GENOME: the ready PNG goes to the share sheet when navigator.canShare accepts a file (called
 * within the tap, before anything is awaited), and is otherwise saved. A share sheet the customer closes is left at
 * that; one the browser refuses saves the file instead.
 */
export function shareGenomeImage(
  blob: Blob,
  nav: ShareNavigator = navigator,
  save: (d: { blob: Blob; filename: string }) => void = saveDownload,
): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], CEREMONY.filename, { type: 'image/png' });
  const data: ShareData = { files: [file], title: CEREMONY.shareTitle };
  let can = false;
  try {
    can = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare(data);
  } catch {
    can = false;
  }
  const saved = (): 'saved' => {
    save({ blob, filename: CEREMONY.filename });
    return 'saved';
  };
  if (!can) return Promise.resolve(saved());
  return nav.share!(data).then(
    () => 'shared' as const,
    (e: unknown) => ((e as { name?: string } | null)?.name === 'AbortError' ? ('cancelled' as const) : saved()),
  );
}
