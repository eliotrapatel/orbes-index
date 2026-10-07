/**
 * SHARE TO STORIES (plan NEXT-NINE of 2026-10-06, §3.8 BP-10): the story card a collector may share after a LIVE RELEASE
 * is CONFIRMED, after a draw's place is SELECTED, and at the end of a first registration. One 1080 × 1920 PNG (9:16),
 * design A NOCTURNE, value for value from the owner's chosen mockup (cards-a.html):
 *
 *   ┌──────────────────────────┐
 *   │        O R B E S         │   the wordmark, Gravesend 500, 44 px, tracked 0.62 em, top at y 132
 *   │ ┌──────────────────────┐ │
 *   │ │                      │ │   the model's photograph, a 1080 × 1080 window at y 250, scaled to the full width
 *   │ │     (photograph)     │ │   (cropped only if taller), fading into the ground: ink 0 %, 0.6 at 9 %, clear from
 *   │ │                      │ │   26 % to 60 %, ink 100 %
 *   │ └──────────────────────┘ │
 *   │      ┌───────────┐       │   the status label in a 2 px hairline box (padding 20/26 px), from y 1190:
 *   │      │ CONFIRMED │       │   CONFIRMED (LIVE RELEASE), SELECTED (draw) or REGISTERED (registration)
 *   │      └───────────┘       │
 *   │       LIVE RELEASE       │   the eyebrow, 56 px below, ash, 26 px, 0.42 em
 *   │        MONOLITHE         │   the title, 36 px below, ivory, 88 px, line height 1.12, 0.2 em, split as
 *   │         IN BLUE          │   modelTitle() splits it; a line wider than 960 px: 72 px at 0.16 em, then 2 px less
 *   │                          │   down to 56 px (and, still too wide there, broken between its words)
 *   │     8 OCTOBER 2026       │   the date, 40 px below, ash, 26 px, 0.42 em, its figures in Gravesend (an exception)
 *   │            ◎             │   the monogram, 56 × 56, ivory at 0.9 (MONOGRAM_PATHS, 5 Path2D)
 *   │       THEORBES.COM       │   26 px below it, ash, 22 px, 0.5 em; the foot ends at y 1810 (the mockup's bottom: 110 px)
 *   └──────────────────────────┘   on the ground, #0a0a0a
 *
 * Tracking is drawn letter by letter, so Safari, which lacks `letterSpacing`, draws the same wide capitals. Figures of the
 * eyebrow and the title take the reading face (as withNumerals does on screen); the date's stay in Gravesend, as the
 * chosen mockup sets them.
 *
 * Never on the card: the GENOME, the account, an email or a name, the entry id or a REFERENCE, a rank, a size, a
 * quantity, a price, the product id, the fingerprint or the scan's REF. Nothing about a card is stored or sent to ORBES:
 * it is drawn on the phone (its photograph this origin's media route only, MEDIA_URL), before any tap (Safari forgets a
 * tap while a toBlob is awaited), and handed to the phone's share sheet or saved.
 *
 * Imported statically (the verify app ships one bundle).
 */
import { MONOGRAM_ARTBOARD, MONOGRAM_PATHS } from '../../core/render/monogram.js';
import { saveDownload } from '../shared/download.js';
import { STORY } from './copy.js';
import { pageFonts, type ShareFonts, type ShareNavigator } from './share-image.js';
import { formatDateLong, MEDIA_URL, modelWithVariant, upper } from './view-model.js';

/** The card's layout (a code constant, plan §1.1): every value of cards-a.html, the app's colour tokens for its hex. */
export const STORY_CARD = Object.freeze({
  width: 1080,
  height: 1920,
  /** --vault-ground */
  ground: '#0a0a0a',
  /** --vault-ink */
  ivory: '#f6f2ea',
  /** --vault-soft */
  ash: '#a7a29a',
  hairline: 'rgba(246,242,234,0.62)',
  /** A line's box, as a browser's normal line height sets it, its text centred in it. */
  line: 1.2,
  wordmark: Object.freeze({ size: 44, tracking: 0.62, top: 132 }),
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
  label: Object.freeze({ top: 1190, size: 30, tracking: 0.46, padY: 20, padX: 26, border: 2 }),
  eyebrow: Object.freeze({ gap: 56, size: 26, tracking: 0.42 }),
  title: Object.freeze({ gap: 36, size: 88, tracking: 0.2, lineHeight: 1.12, long: Object.freeze({ size: 72, tracking: 0.16 }), min: 56, step: 2, maxWidth: 960 }),
  date: Object.freeze({ gap: 40, size: 26, tracking: 0.42 }),
  monogram: Object.freeze({ side: 56, alpha: 0.9 }),
  site: Object.freeze({ gap: 26, size: 22, tracking: 0.5, bottom: 1810 }),
});

/** The face the card waits for: Gravesend Sans 500 (brand.css), loaded within 4 s, then checked. */
export const STORY_FONT = '500 88px "Gravesend Sans"';
/** How long the photograph and the face may take before the card is given up (no button then). */
export const STORY_PHOTO_MS = 8_000;
export const STORY_FONT_MS = 4_000;

/** Where the card comes from: the three places the owner named. */
export type StoryOrigin = 'live' | 'draw' | 'registered';

/**
 * What a card is made of, as each place has it. `at`: the moment whose day the card says (T0; the draw, or the day a
 * place was reserved; the registration); `zone`: this phone's time zone (an IANA name), or its minutes east of UTC.
 */
export interface StoryInput {
  photo: string | null | undefined;
  /** The model's name (live, registered), or the name a draw's title begins with. */
  model: string | null | undefined;
  /** The model's variant (live, registered): MONOLITHE IN BLUE. */
  variant?: string | null;
  /** A draw's title: MONOLITHE, THE OCTOBER DRAW. */
  title?: string | null;
  /** A piece's type and collection (registered): BRACELET · ORBITAL. */
  type?: string | null;
  collection?: string | null;
  at: string | number | null | undefined;
  zone: string | number;
}

/** A card's words and its photograph: nothing else is drawn. */
export interface StoryCardModel {
  origin: StoryOrigin;
  /** This origin's media route (MEDIA_URL). */
  photo: string;
  status: string;
  eyebrow: string;
  /** The title on its lines: [MONOLITHE, IN BLUE]. */
  title: string[];
  /** 8 OCTOBER 2026 */
  date: string;
}

/**
 * A title whose model's name begins it, on two lines (`MONOLITHE` / `IN BLUE`, `MONOLITHE,` / `THE OCTOBER DRAW`), as
 * views/nocturne.ts modelTitle() sets a hero's title; any other title on one line.
 */
export function storyTitleLines(text: string, model: string | null | undefined): string[] {
  const name = model ? model.trim().toUpperCase() : '';
  const rest = name && text.startsWith(name) ? text.slice(name.length) : null;
  const m = rest !== null ? /^(,?)\s+(\S.*)$/.exec(rest) : null;
  return m ? [`${name}${m[1]}`, m[2]!] : [text];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** `8 OCTOBER 2026`: the day of `at` on this phone's calendar (its zone, or its offset east of UTC); '' when unreadable. */
export function storyDate(at: string | number | null | undefined, zone: string | number): string {
  const t = typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(t)) return '';
  let ymd: string;
  if (typeof zone === 'number') {
    const d = new Date(t + zone * 60_000);
    ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  } else {
    let f = dayFormatters.get(zone);
    if (!f) {
      try {
        f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' });
      } catch {
        f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
      }
      dayFormatters.set(zone, f);
    }
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    ymd = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }
  const long = formatDateLong(ymd);
  return MONTHS.some((m) => long.includes(m)) ? long.toUpperCase() : '';
}

/**
 * The card of `origin`, from what its place shows: null without a photograph of this origin's media route, a title or a
 * date (no card, so no button). LIVE: CONFIRMED · LIVE RELEASE · MONOLITHE / IN BLUE · the day of T0 (an after-room's
 * piece too). DRAW: SELECTED · DRAW · its title · the day of the draw or of the reservation. REGISTERED: REGISTERED ·
 * type and collection · the model with its variant · the registration day.
 */
export function storyCardModel(origin: StoryOrigin, d: StoryInput): StoryCardModel | null {
  if (typeof d.photo !== 'string' || !MEDIA_URL.test(d.photo)) return null;
  const date = storyDate(d.at, d.zone);
  const model = upper(d.model);
  let eyebrow: string;
  let text: string;
  if (origin === 'draw') {
    eyebrow = STORY.kind.draw;
    text = upper(d.title);
  } else {
    eyebrow = origin === 'live' ? STORY.kind.live : [upper(d.type), upper(d.collection)].filter((x) => x.length > 0).join(' · ');
    text = model ? upper(modelWithVariant(model, d.variant)) : '';
  }
  if (!text || !date || !eyebrow) return null;
  return { origin, photo: d.photo, status: STORY.status[origin], eyebrow, title: storyTitleLines(text, model || null), date };
}

/** The card's words, top to bottom: its alternative text (joined by '. ') and what the tests read. */
export function storyWords(m: StoryCardModel): string[] {
  return [STORY.wordmark, m.status, m.eyebrow, m.title.join(' '), m.date, STORY.site];
}

// ── Drawing ────────────────────────────────────────────────────────────────

/** The part of a 2D context the card uses (a CanvasRenderingContext2D; a recorder in the tests). */
export interface StoryContext {
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
  drawImage(image: StoryPhoto, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

/** The photograph, decoded: an image element (its natural size), or a stand-in in the tests. */
export type StoryPhoto = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number };

type Face = 'display' | 'reading';

/** The face of one letter: a figure of the eyebrow or the title in the reading face; every other letter in the display face. */
function fontOf(fonts: ShareFonts, px: number, face: Face): string {
  return face === 'reading' ? `400 ${px}px ${fonts.reading}` : `500 ${px}px ${fonts.display}`;
}

/** Each letter's face and width at `px`; the tracking follows every letter but the last. */
function measure(ctx: StoryContext, text: string, px: number, tracking: number, fonts: ShareFonts, figures: boolean): { letters: { ch: string; face: Face; w: number }[]; width: number } {
  const letters = [...text].map((ch) => {
    const face: Face = figures && /\d/.test(ch) ? 'reading' : 'display';
    ctx.font = fontOf(fonts, px, face);
    return { ch, face, w: ctx.measureText(ch).width };
  });
  const width = letters.reduce((s, l) => s + l.w, 0) + Math.max(0, letters.length - 1) * px * tracking;
  return { letters, width };
}

/** One line, centred across the card on `centreY`, drawn letter by letter. */
function drawTracked(ctx: StoryContext, text: string, centreY: number, px: number, tracking: number, colour: string, fonts: ShareFonts, figures: boolean): number {
  const { letters, width } = measure(ctx, text, px, tracking, fonts, figures);
  let x = (STORY_CARD.width - width) / 2;
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

/**
 * The title's size and lines: 88 px at 0.2 em; a line wider than 960 px drops it to 72 px at 0.16 em, then 2 px at a time
 * down to 56 px; a line still too wide there is broken between its words.
 */
export function storyTitleFit(ctx: StoryContext, lines: readonly string[], fonts: ShareFonts): { size: number; tracking: number; lines: string[] } {
  const t = STORY_CARD.title;
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

/** Draw the card: the ground, the photograph and its fade, the wordmark, the label, the words, the monogram, THEORBES.COM. */
export function drawStoryCard(ctx: StoryContext, m: StoryCardModel, photo: StoryPhoto, fonts: ShareFonts): void {
  const C = STORY_CARD;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, C.width, C.height);

  // The photograph: scaled to the full width, cropped (centred) only when taller than its window, centred in it when wider.
  const pw = photo.naturalWidth || photo.width;
  const ph = photo.naturalHeight || photo.height;
  if (pw > 0 && ph > 0) {
    const scaled = (ph * C.photo.side) / pw;
    if (scaled >= C.photo.side) {
      const sh = pw;
      ctx.drawImage(photo, 0, (ph - sh) / 2, pw, sh, 0, C.photo.top, C.photo.side, C.photo.side);
    } else {
      ctx.drawImage(photo, 0, 0, pw, ph, 0, C.photo.top + (C.photo.side - scaled) / 2, C.photo.side, scaled);
    }
  }
  const fade = ctx.createLinearGradient(0, C.photo.top, 0, C.photo.top + C.photo.side);
  for (const [at, colour] of C.photo.fade) fade.addColorStop(at, colour);
  ctx.fillStyle = fade;
  ctx.fillRect(0, C.photo.top, C.photo.side, C.photo.side);

  const lineBox = (px: number) => px * C.line;
  drawTracked(ctx, STORY.wordmark, C.wordmark.top + lineBox(C.wordmark.size) / 2, C.wordmark.size, C.wordmark.tracking, C.ivory, fonts, false);

  // The status label in its hairline box: the tracking given back on both sides, as the mockup's padding does.
  const L = C.label;
  const labelWidth = measure(ctx, m.status, L.size, L.tracking, fonts, false).width;
  const boxW = labelWidth + 2 * (L.padX + L.size * L.tracking) + 2 * L.border;
  const boxH = lineBox(L.size) + 2 * L.padY + 2 * L.border;
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = L.border;
  ctx.strokeRect((C.width - boxW) / 2 + L.border / 2, L.top + L.border / 2, boxW - L.border, boxH - L.border);
  drawTracked(ctx, m.status, L.top + boxH / 2, L.size, L.tracking, C.ivory, fonts, false);

  let y = L.top + boxH + C.eyebrow.gap;
  drawTracked(ctx, m.eyebrow, y + lineBox(C.eyebrow.size) / 2, C.eyebrow.size, C.eyebrow.tracking, C.ash, fonts, true);
  y += lineBox(C.eyebrow.size) + C.title.gap;

  const fit = storyTitleFit(ctx, m.title, fonts);
  const titleLine = fit.size * C.title.lineHeight;
  for (const line of fit.lines) {
    drawTracked(ctx, line, y + titleLine / 2, fit.size, fit.tracking, C.ivory, fonts, true);
    y += titleLine;
  }
  y += C.date.gap;
  // The date's figures stay in Gravesend, as the chosen mockup sets them (a recorded exception).
  drawTracked(ctx, m.date, y + lineBox(C.date.size) / 2, C.date.size, C.date.tracking, C.ash, fonts, false);

  // The foot: the monogram, then THEORBES.COM, ending at y 1810.
  const siteTop = C.site.bottom - lineBox(C.site.size);
  const monoTop = siteTop - C.site.gap - C.monogram.side;
  const scale = C.monogram.side / MONOGRAM_ARTBOARD.w;
  ctx.setTransform(scale, 0, 0, scale, (C.width - C.monogram.side) / 2, monoTop);
  ctx.globalAlpha = C.monogram.alpha;
  ctx.fillStyle = C.ivory;
  for (const d of MONOGRAM_PATHS) ctx.fill(new Path2D(d));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  drawTracked(ctx, STORY.site, siteTop + lineBox(C.site.size) / 2, C.site.size, C.site.tracking, C.ash, fonts, false);
}

// ── Preparing ──────────────────────────────────────────────────────────────

/** `p`, or null once `ms` have passed (or when it fails). */
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
 * The card's PNG, drawn as soon as its place is built, before any tap; null when this browser cannot draw it (no canvas,
 * no Path2D, no fonts API), when the photograph is not decoded within 8 s or the display face not loaded within 4 s:
 * then its place offers no SHARE TO STORIES.
 */
export async function prepareStoryCard(m: StoryCardModel): Promise<Blob | null> {
  try {
    if (typeof Path2D !== 'function' || typeof Image !== 'function' || !document.fonts || !MEDIA_URL.test(m.photo)) return null;
    const img = new Image();
    img.decoding = 'async';
    img.src = m.photo;
    const [photo, face] = await Promise.all([
      within(img.decode().then(() => img), STORY_PHOTO_MS),
      within(document.fonts.load(STORY_FONT, [...storyWords(m)].join(' ')), STORY_FONT_MS),
    ]);
    if (!photo || face === null || !document.fonts.check(STORY_FONT)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = STORY_CARD.width;
    canvas.height = STORY_CARD.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawStoryCard(ctx, m, photo, pageFonts());
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

/** A card being prepared, and its PNG once it is (undefined while it is drawn, null when there is none). */
export interface PreparedStory {
  ready: Promise<Blob | null>;
  blob: Blob | null | undefined;
}

/**
 * The cards of a page, each prepared once per entry: a screen built again (the LIVE RELEASE's CONFIRMED, a draw's YOUR
 * ENTRY) reuses its card, drawn again only when its words change.
 */
export class StoryCards {
  private readonly cards = new Map<string, { words: string; card: PreparedStory }>();

  constructor(private readonly prepare: (m: StoryCardModel) => Promise<Blob | null> = prepareStoryCard) {}

  card(key: string, m: StoryCardModel): PreparedStory {
    const words = JSON.stringify([m.photo, ...storyWords(m)]);
    const known = this.cards.get(key);
    if (known && known.words === words) return known.card;
    const card: PreparedStory = { ready: Promise.resolve(null), blob: undefined };
    card.ready = this.prepare(m).then(
      (b) => (card.blob = b ?? null),
      () => (card.blob = null),
    );
    this.cards.set(key, { words, card });
    return card;
  }
}

// ── Sharing ────────────────────────────────────────────────────────────────

function storyData(blob: Blob): ShareData {
  return { files: [new File([blob], STORY.filename, { type: 'image/png' })], title: STORY.shareTitle };
}

/** Whether this browser's share sheet takes the card's file (asked synchronously, as the tap does). */
export function canShareStory(blob: Blob, nav: ShareNavigator = navigator): boolean {
  try {
    return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare(storyData(blob));
  } catch {
    return false;
  }
}

/**
 * SHARE: the ready PNG goes to the phone's share sheet (the file alone, titled ORBES: no text, no link) when
 * navigator.canShare accepts it, asked within the tap before anything is awaited; otherwise it is saved. A share sheet
 * the collector closes (AbortError) is left at that; a share the browser refuses saves the file instead.
 */
export function shareStoryCard(
  blob: Blob,
  nav: ShareNavigator = navigator,
  save: (d: { blob: Blob; filename: string }) => void = saveDownload,
): Promise<'shared' | 'saved' | 'cancelled'> {
  const data = storyData(blob);
  let can = false;
  try {
    can = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare(data);
  } catch {
    can = false;
  }
  const saved = (): 'saved' => {
    save({ blob, filename: STORY.filename });
    return 'saved';
  };
  if (!can) return Promise.resolve(saved());
  return nav.share!(data).then(
    () => 'shared' as const,
    (e: unknown) => ((e as { name?: string } | null)?.name === 'AbortError' ? ('cancelled' as const) : saved()),
  );
}
