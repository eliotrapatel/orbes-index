/**
 * The I WAS THERE image (lot Q3, step Q3.11; plan §3.9; D11 "I WAS THERE card: the release and its date", round 2 "SAVE
 * IMAGE only"; N4 for a vault without a release): one 1080 × 1350 PNG drawn on the phone (or the computer) as story-card.ts
 * draws, in the vault's black, then saved through shared/download.ts. No mockup draws it: it is shown on the owner's
 * review board (N33, HANDOVER).
 *
 *   ┌───────────────────────────┐
 *   │          O R B E S        │   the wordmark, 40 px, tracked 0.62 em, ivory
 *   │                           │
 *   │            (◎)            │   the ORBES monogram engraved: 360 px, ivory at 0.14 (the door's emblem, faint)
 *   │                           │
 *   │      I  W A S  T H E R E  │   78 px, tracked 0.2 em, ivory
 *   │   ───────────────────     │   the horizon: a hairline dissolving at its ends
 *   │        LIVE RELEASE       │   ash, 26 px, 0.42 em (or the occasion's label: A NEW TIER)
 *   │         MONOLITHE         │   ivory, 56 px, 0.18 em, split as the story card splits a model's name
 *   │          IN BLUE          │
 *   │       3 OCTOBER 2026      │   ash, 26 px, 0.42 em
 *   └───────────────────────────┘   on the ground #0a0a0a
 *
 * Never on it: a number, a place, a size, a price, an odds, the account, an email or a name. Nothing is stored or sent.
 */
import { MONOGRAM_ARTBOARD, MONOGRAM_PATHS } from '../../../core/render/monogram.js';
import { saveDownload } from '../../shared/download.js';
import { VAULT } from '../copy.js';
import { pageFonts, type ShareFonts } from '../share-image.js';
import type { IWasThereInput } from '../vault-model.js';

export const I_WAS_THERE = Object.freeze({
  width: 1080,
  height: 1350,
  ground: '#0a0a0a',
  ivory: '#f6f2ea',
  ash: '#a7a29a',
  line: 1.2,
  wordmark: Object.freeze({ size: 40, tracking: 0.62, top: 120 }),
  monogram: Object.freeze({ side: 360, top: 250, alpha: 0.14 }),
  title: Object.freeze({ size: 78, tracking: 0.2, top: 720 }),
  horizon: Object.freeze({ gap: 56, width: 620 }),
  eyebrow: Object.freeze({ gap: 56, size: 26, tracking: 0.42 }),
  name: Object.freeze({ gap: 30, size: 56, tracking: 0.18, lineHeight: 1.14, min: 36, maxWidth: 940 }),
  date: Object.freeze({ gap: 34, size: 26, tracking: 0.42 }),
});

/** The face the image waits for. */
const FONT = '500 78px "Gravesend Sans"';
const FONT_MS = 4_000;

/** The part of a 2D context the image uses (a CanvasRenderingContext2D; a recorder in the tests). */
export interface IWasThereContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fill(path: Path2D): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

/** The image's words, top to bottom (its alternative text, and what the tests read). */
export function iWasThereWords(m: IWasThereInput): string[] {
  return [VAULT.image.wordmark, VAULT.image.title, m.eyebrow, m.name ?? '', m.date].filter((w) => w.length > 0);
}

/** A name on its lines: the model's name first (`MONOLITHE` / `IN BLUE`), any other on one line. */
export function nameLines(name: string | null): string[] {
  if (!name) return [];
  const m = /^(\S+)\s+(IN\s+.+)$/.exec(name);
  return m ? [m[1]!, m[2]!] : [name];
}

function measure(ctx: IWasThereContext, text: string, px: number, tracking: number, fonts: ShareFonts): number {
  let w = 0;
  for (const ch of text) {
    ctx.font = /\d/.test(ch) ? `400 ${px}px ${fonts.reading}` : `500 ${px}px ${fonts.display}`;
    w += ctx.measureText(ch).width;
  }
  return w + Math.max(0, [...text].length - 1) * px * tracking;
}

/** One line centred across the image on `centreY`, letter by letter (Safari has no letterSpacing). */
function line(ctx: IWasThereContext, text: string, centreY: number, px: number, tracking: number, colour: string, fonts: ShareFonts): void {
  let x = (I_WAS_THERE.width - measure(ctx, text, px, tracking, fonts)) / 2;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const ch of text) {
    ctx.font = /\d/.test(ch) ? `400 ${px}px ${fonts.reading}` : `500 ${px}px ${fonts.display}`;
    if (ch !== ' ') ctx.fillText(ch, x, centreY);
    x += ctx.measureText(ch).width + px * tracking;
  }
}

/** Draw the image: the ground, the wordmark, the monogram engraved, I WAS THERE, the horizon, the release and its date. */
export function drawIWasThere(ctx: IWasThereContext, m: IWasThereInput, fonts: ShareFonts): void {
  const C = I_WAS_THERE;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, C.width, C.height);
  const box = (px: number) => px * C.line;
  line(ctx, VAULT.image.wordmark, C.wordmark.top + box(C.wordmark.size) / 2, C.wordmark.size, C.wordmark.tracking, C.ivory, fonts);

  const scale = C.monogram.side / MONOGRAM_ARTBOARD.w;
  ctx.setTransform(scale, 0, 0, scale, (C.width - C.monogram.side) / 2, C.monogram.top);
  ctx.globalAlpha = C.monogram.alpha;
  ctx.fillStyle = C.ivory;
  for (const d of MONOGRAM_PATHS) ctx.fill(new Path2D(d));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  let y = C.title.top;
  line(ctx, VAULT.image.title, y + box(C.title.size) / 2, C.title.size, C.title.tracking, C.ivory, fonts);
  y += box(C.title.size) + C.horizon.gap;
  const hz = ctx.createLinearGradient((C.width - C.horizon.width) / 2, 0, (C.width + C.horizon.width) / 2, 0);
  hz.addColorStop(0, 'rgba(246,242,234,0)');
  hz.addColorStop(0.5, 'rgba(246,242,234,0.42)');
  hz.addColorStop(1, 'rgba(246,242,234,0)');
  ctx.fillStyle = hz;
  ctx.fillRect((C.width - C.horizon.width) / 2, y, C.horizon.width, 1);
  y += 1 + C.eyebrow.gap;
  if (m.eyebrow) {
    line(ctx, m.eyebrow, y + box(C.eyebrow.size) / 2, C.eyebrow.size, C.eyebrow.tracking, C.ash, fonts);
    y += box(C.eyebrow.size);
  }
  const lines = nameLines(m.name);
  if (lines.length > 0) {
    y += C.name.gap;
    let px: number = C.name.size;
    while (px > C.name.min && Math.max(...lines.map((l) => measure(ctx, l, px, C.name.tracking, fonts))) > C.name.maxWidth) px -= 2;
    for (const l of lines) {
      line(ctx, l, y + (px * C.name.lineHeight) / 2, px, C.name.tracking, C.ivory, fonts);
      y += px * C.name.lineHeight;
    }
  }
  if (m.date) {
    y += C.date.gap;
    line(ctx, m.date, y + box(C.date.size) / 2, C.date.size, C.date.tracking, C.ash, fonts);
  }
}

/** The PNG, drawn once the display face is loaded; null when this browser cannot draw it. */
export async function prepareIWasThere(m: IWasThereInput): Promise<Blob | null> {
  try {
    if (typeof Path2D !== 'function' || !document.fonts) return null;
    await Promise.race([document.fonts.load(FONT, iWasThereWords(m).join(' ')), new Promise((r) => setTimeout(r, FONT_MS))]).catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = I_WAS_THERE.width;
    canvas.height = I_WAS_THERE.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawIWasThere(ctx, m, pageFonts());
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

/** SAVE THE IMAGE: drawn, then saved (shared/download.ts); false when it could not be drawn. */
export async function saveIWasThere(m: IWasThereInput, save: (d: { blob: Blob; filename: string }) => void = saveDownload): Promise<boolean> {
  const blob = await prepareIWasThere(m);
  if (!blob) return false;
  save({ blob, filename: VAULT.image.filename });
  return true;
}
