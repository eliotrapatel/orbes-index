/**
 * The countdown image of a release's CAMPAIGN tab (plan MACRO M1 §2.2, scope C3): one 1080 × 1920 PNG (9:16) for ORBES's
 * own accounts, drawn on a canvas in the console, value for value in the style of the collector's story card
 * (web/verify/story-card.ts, left untouched: the phone stays as it is). It is not a collector's share card (K53 is NO).
 *
 *   TEASER (the default)                        FULL (once the name and photograph are public)
 *   ┌──────────────────────────┐                ┌──────────────────────────┐
 *   │        O R B E S         │ y 132          │        O R B E S         │ the wordmark, Gravesend 500, 44 px, 0.62 em
 *   │                          │                │ ┌──────────────────────┐ │
 *   │            ◎             │ 360 × 360      │ │     (photograph)     │ │ 1080 × 1080 at y 250, faded into the
 *   │                          │ at y 560       │ └──────────────────────┘ │ ground as the story card's
 *   │      ┌───────────┐       │                │      ┌──────────────┐    │
 *   │      │ A RELEASE │       │ y 1040         │      │ LIVE RELEASE │    │ the label in its 2 px hairline box, y 1190
 *   │      └───────────┘       │                │      └──────────────┘    │
 *   │     5 NOVEMBER 2026      │ ivory, 88 px   │        MONOLITHE         │ the name, ivory, 88 px, 0.2 em (fitted
 *   │       20:00 PARIS        │ ash, 34 px     │         IN BLUE          │ as the story card's title)
 *   │                          │                │ 5 NOVEMBER 2026 · 20:00  │ the date, ash, 26 px, 0.42 em
 *   │                          │                │            ◎             │ the monogram, 56 px, ivory at 0.9
 *   │       THEORBES.COM       │ y 1810         │       THEORBES.COM       │ ash, 22 px, 0.5 em, ending at y 1810
 *   └──────────────────────────┘                └──────────────────────────┘ on the ground, #0a0a0a
 *
 * Tracking is drawn letter by letter (Safari lacks `letterSpacing`); figures take the reading face, as the story card's
 * title does. Nothing about an image is stored or sent: it is drawn here (its photograph this origin's media route
 * only), and DOWNLOAD saves the PNG (ui/download.ts).
 */
import { MONOGRAM_ARTBOARD, MONOGRAM_PATHS } from '../../../core/render/monogram.js';
import { COUNTDOWN_WORDS, countdownWords, MEDIA_PATH, type CountdownCardModel } from '../model/campaign.js';

export const COUNTDOWN_CARD = Object.freeze({
  width: 1080,
  height: 1920,
  ground: '#0a0a0a',
  ivory: '#f6f2ea',
  ash: '#a7a29a',
  hairline: 'rgba(246,242,234,0.62)',
  line: 1.2,
  wordmark: Object.freeze({ size: 44, tracking: 0.62, top: 132 }),
  label: Object.freeze({ size: 30, tracking: 0.46, padY: 20, padX: 26, border: 2 }),
  title: Object.freeze({ size: 88, tracking: 0.2, lineHeight: 1.12, long: Object.freeze({ size: 72, tracking: 0.16 }), min: 56, step: 2, maxWidth: 960 }),
  site: Object.freeze({ gap: 26, size: 22, tracking: 0.5, bottom: 1810 }),
  teaser: Object.freeze({
    monogram: Object.freeze({ top: 560, side: 360, alpha: 0.9 }),
    label: Object.freeze({ top: 1040 }),
    title: Object.freeze({ gap: 64 }),
    when: Object.freeze({ gap: 28, size: 34, tracking: 0.42 }),
  }),
  full: Object.freeze({
    photo: Object.freeze({
      top: 250,
      side: 1080,
      fade: Object.freeze([
        [0, '#0a0a0a'],
        [0.09, 'rgba(10,10,10,0.6)'],
        [0.26, 'rgba(10,10,10,0)'],
        [0.6, 'rgba(10,10,10,0)'],
        [1, '#0a0a0a'],
      ] as const),
    }),
    label: Object.freeze({ top: 1190 }),
    title: Object.freeze({ gap: 56 }),
    when: Object.freeze({ gap: 40, size: 26, tracking: 0.42 }),
    monogram: Object.freeze({ side: 56, alpha: 0.9 }),
  }),
});

/** The face the image waits for: Gravesend Sans 500 (brand.css), loaded within 4 s. */
export const COUNTDOWN_FONT = '500 88px "Gravesend Sans"';
export const COUNTDOWN_FONT_MS = 4_000;
export const COUNTDOWN_PHOTO_MS = 8_000;

/** The faces as the page sets them (brand.css --font-display and --font). */
export interface CountdownFonts {
  display: string;
  reading: string;
}

/** The part of a 2D context the image uses (a CanvasRenderingContext2D; a recorder in the tests). */
export interface CountdownContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fill(path: Path2D): void;
  drawImage(image: CountdownPhoto, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

export type CountdownPhoto = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number };

type Face = 'display' | 'reading';

const fontOf = (fonts: CountdownFonts, px: number, face: Face) => (face === 'reading' ? `400 ${px}px ${fonts.reading}` : `500 ${px}px ${fonts.display}`);

function measure(ctx: CountdownContext, text: string, px: number, tracking: number, fonts: CountdownFonts, figures: boolean): { letters: { ch: string; face: Face; w: number }[]; width: number } {
  const letters = [...text].map((ch) => {
    const face: Face = figures && /\d/.test(ch) ? 'reading' : 'display';
    ctx.font = fontOf(fonts, px, face);
    return { ch, face, w: ctx.measureText(ch).width };
  });
  return { letters, width: letters.reduce((s, l) => s + l.w, 0) + Math.max(0, letters.length - 1) * px * tracking };
}

/** One line centred across the image on `centreY`, letter by letter; its width. */
function drawTracked(ctx: CountdownContext, text: string, centreY: number, px: number, tracking: number, colour: string, fonts: CountdownFonts, figures: boolean): number {
  const { letters, width } = measure(ctx, text, px, tracking, fonts, figures);
  let x = (COUNTDOWN_CARD.width - width) / 2;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const l of letters) {
    ctx.font = fontOf(fonts, px, l.face);
    if (l.ch !== ' ') ctx.fillText(l.ch, x, centreY);
    x += l.w + px * tracking;
  }
  return width;
}

/** The title's size and lines: 88 px at 0.2 em; wider than 960 px: 72 px at 0.16 em, then 2 px less down to 56 px, then broken between words. */
export function countdownTitleFit(ctx: CountdownContext, lines: readonly string[], fonts: CountdownFonts): { size: number; tracking: number; lines: string[] } {
  const t = COUNTDOWN_CARD.title;
  const widest = (px: number, tr: number, ls: readonly string[]) => Math.max(...ls.map((l) => measure(ctx, l, px, tr, fonts, true).width));
  if (widest(t.size, t.tracking, lines) <= t.maxWidth) return { size: t.size, tracking: t.tracking, lines: [...lines] };
  let px = t.long.size;
  const tr = t.long.tracking;
  while (widest(px, tr, lines) > t.maxWidth && px > t.min) px -= t.step;
  if (widest(px, tr, lines) <= t.maxWidth) return { size: px, tracking: tr, lines: [...lines] };
  const out: string[] = [];
  for (const line of lines) {
    let current = '';
    for (const word of line.split(' ')) {
      const next = current ? `${current} ${word}` : word;
      if (current && measure(ctx, next, px, tr, fonts, true).width > t.maxWidth) {
        out.push(current);
        current = word;
      } else current = next;
    }
    if (current) out.push(current);
  }
  return { size: px, tracking: tr, lines: out };
}

const lineBox = (px: number) => px * COUNTDOWN_CARD.line;

/** The boxed label from `top`; its box's bottom. */
function drawLabel(ctx: CountdownContext, text: string, top: number, fonts: CountdownFonts): number {
  const C = COUNTDOWN_CARD;
  const L = C.label;
  const w = measure(ctx, text, L.size, L.tracking, fonts, false).width;
  const boxW = w + 2 * (L.padX + L.size * L.tracking) + 2 * L.border;
  const boxH = lineBox(L.size) + 2 * L.padY + 2 * L.border;
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = L.border;
  ctx.strokeRect((C.width - boxW) / 2 + L.border / 2, top + L.border / 2, boxW - L.border, boxH - L.border);
  drawTracked(ctx, text, top + boxH / 2, L.size, L.tracking, C.ivory, fonts, false);
  return top + boxH;
}

/** The monogram, `side` square, centred across the image from `top`. */
function drawMonogram(ctx: CountdownContext, top: number, side: number, alpha: number): void {
  const scale = side / MONOGRAM_ARTBOARD.w;
  ctx.setTransform(scale, 0, 0, scale, (COUNTDOWN_CARD.width - side) / 2, top);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COUNTDOWN_CARD.ivory;
  for (const d of MONOGRAM_PATHS) ctx.fill(new Path2D(d));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

/** The title's lines from `top`; the bottom of the last. */
function drawTitle(ctx: CountdownContext, lines: readonly string[], top: number, fonts: CountdownFonts): number {
  const fit = countdownTitleFit(ctx, lines, fonts);
  const step = fit.size * COUNTDOWN_CARD.title.lineHeight;
  let y = top;
  for (const line of fit.lines) {
    drawTracked(ctx, line, y + step / 2, fit.size, fit.tracking, COUNTDOWN_CARD.ivory, fonts, true);
    y += step;
  }
  return y;
}

/** Draw the image: TEASER without a photograph, FULL with its photograph (`photo`). */
export function drawCountdownCard(ctx: CountdownContext, m: CountdownCardModel, photo: CountdownPhoto | null, fonts: CountdownFonts): void {
  const C = COUNTDOWN_CARD;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, C.width, C.height);

  if (m.kind === 'full') {
    const P = C.full.photo;
    const pw = photo ? photo.naturalWidth || photo.width : 0;
    const ph = photo ? photo.naturalHeight || photo.height : 0;
    if (photo && pw > 0 && ph > 0) {
      const scaled = (ph * P.side) / pw;
      if (scaled >= P.side) ctx.drawImage(photo, 0, (ph - pw) / 2, pw, pw, 0, P.top, P.side, P.side);
      else ctx.drawImage(photo, 0, 0, pw, ph, 0, P.top + (P.side - scaled) / 2, P.side, scaled);
    }
    const fade = ctx.createLinearGradient(0, P.top, 0, P.top + P.side);
    for (const [at, colour] of P.fade) fade.addColorStop(at, colour);
    ctx.fillStyle = fade;
    ctx.fillRect(0, P.top, P.side, P.side);
  }

  drawTracked(ctx, COUNTDOWN_WORDS.wordmark, C.wordmark.top + lineBox(C.wordmark.size) / 2, C.wordmark.size, C.wordmark.tracking, C.ivory, fonts, false);

  const siteTop = C.site.bottom - lineBox(C.site.size);
  if (m.kind === 'teaser') {
    const T = C.teaser;
    drawMonogram(ctx, T.monogram.top, T.monogram.side, T.monogram.alpha);
    const below = drawLabel(ctx, m.label, T.label.top, fonts);
    const end = drawTitle(ctx, m.title, below + T.title.gap, fonts);
    drawTracked(ctx, m.when, end + T.when.gap + lineBox(T.when.size) / 2, T.when.size, T.when.tracking, C.ash, fonts, true);
  } else {
    const F = C.full;
    const below = drawLabel(ctx, m.label, F.label.top, fonts);
    const end = drawTitle(ctx, m.title, below + F.title.gap, fonts);
    drawTracked(ctx, m.when, end + F.when.gap + lineBox(F.when.size) / 2, F.when.size, F.when.tracking, C.ash, fonts, true);
    drawMonogram(ctx, siteTop - C.site.gap - F.monogram.side, F.monogram.side, F.monogram.alpha);
  }
  drawTracked(ctx, COUNTDOWN_WORDS.site, siteTop + lineBox(C.site.size) / 2, C.site.size, C.site.tracking, C.ash, fonts, false);
}

// ── Preparing ──────────────────────────────────────────────────────────────

/** The console's faces, as brand.css sets them. */
export function consoleFonts(): CountdownFonts {
  const css = getComputedStyle(document.documentElement);
  const reading = css.getPropertyValue('--font').trim() || 'sans-serif';
  const display = (css.getPropertyValue('--font-display').trim() || reading).replace(/var\(--font\)/, reading);
  return { display, reading };
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * The image's PNG, drawn as soon as it is chosen, before DOWNLOAD is pressed; null when this browser cannot draw it (no
 * canvas, no Path2D, no fonts API), when FULL's photograph is not decoded within 8 s or the display face not loaded
 * within 4 s.
 */
export async function prepareCountdownCard(m: CountdownCardModel): Promise<Blob | null> {
  try {
    if (typeof Path2D !== 'function' || !document.fonts) return null;
    let photo: HTMLImageElement | null = null;
    const face = within(document.fonts.load(COUNTDOWN_FONT, countdownWords(m).join(' ')), COUNTDOWN_FONT_MS);
    if (m.kind === 'full') {
      if (!m.photo || !MEDIA_PATH.test(m.photo) || typeof Image !== 'function') return null;
      const img = new Image();
      img.decoding = 'async';
      img.src = m.photo;
      photo = await within(img.decode().then(() => img), COUNTDOWN_PHOTO_MS);
      if (!photo) return null;
    }
    if ((await face) === null || !document.fonts.check(COUNTDOWN_FONT)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = COUNTDOWN_CARD.width;
    canvas.height = COUNTDOWN_CARD.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawCountdownCard(ctx, m, photo, consoleFonts());
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}
