/**
 * NOCTURNE's chrome and pieces, what they say — pure, no DOM (plan NOCTURNE, step N2).
 *
 *   accountButton()  the header's account button: the tier's name and the monogram (decision 11), or SIGN IN
 *   railLive()       whether the rail's RELEASES carries its dot: a LIVE RELEASE announced, its room open or live, or a
 *                    draw open, soon open or in its early access (the facts NOW's hero follows)
 *   chapterOf()      the chapter of the rail a screen belongs to
 *   swatchGradient() a variant's dot drawn from its swatch with the canvas's soft highlight (build.py .steel/.gold/.blue)
 */
import type { DropCard, LiveBanner } from './types.js';

/** The header's account button: what it reads and its accessible name. */
export interface AccountButtonModel {
  /** Signed in: the account sheet; signed out: the sign-in (MY PIECES). */
  kind: 'account' | 'sign-in';
  /** The words beside the monogram: the tier's name (TITANE), none without a tier; SIGN IN signed out. */
  text: string | null;
  /** The button's name: "Your account, TITANE" (the canvas's), "Your account" without a tier; SIGN IN signed out. */
  label: string;
}

/** The header's account button for a session: signed in with its tier (null while unread or without one), or signed out. */
export function accountButton(signedIn: boolean, tierName: string | null): AccountButtonModel {
  if (!signedIn) return { kind: 'sign-in', text: 'SIGN IN', label: 'SIGN IN' };
  return { kind: 'account', text: tierName, label: tierName ? `Your account, ${tierName}` : 'Your account' };
}

/** Whether a draw is open, soon open or in its early access: entries open now, or published and not yet open. */
export function drawLeads(d: Pick<DropCard, 'state'>): boolean {
  return d.state === 'OPEN' || d.state === 'UPCOMING';
}

/**
 * The rail's RELEASES dot: a LIVE RELEASE announced, its room open or live (the server's pick, GET /api/v1/live/next),
 * or a draw open, soon open or in its early access. No dot when nothing is announced.
 */
export function railLive(live: LiveBanner | null, drops: readonly Pick<DropCard, 'state'>[]): boolean {
  return live !== null || drops.some(drawLeads);
}

/** The screens of the app (main.ts) and the rail's chapters. */
export type ChapterId = 'now' | 'releases' | 'collection' | 'circle' | 'pieces';

/** The chapter a screen belongs to, for the rail's aria-current: a result is read from NOW (C9). */
export function chapterOf(screen: string): ChapterId | null {
  switch (screen) {
    case 'landing':
    case 'result':
      return 'now';
    case 'pieces':
    case 'piece':
      return 'pieces';
    case 'lookbook':
    case 'sheet':
      return 'collection';
    case 'releases':
    case 'release':
    case 'live':
    case 'how':
      return 'releases';
    case 'circle':
    case 'circlePost':
      return 'circle';
    default:
      return null;
  }
}

// ── A variant's dot ────────────────────────────────────────────────────────

/**
 * The canvas draws each finish's dot as a soft diagonal highlight around its colour (build.py: `.steel` #e9e8e4 →
 * #9d9b96 at 55 % → #d7d5d0, and likewise `.gold` and `.blue`). The app has one colour per variant (its swatch,
 * #RRGGBB): the dot takes it at 55 %. The canvas's own three colours take the canvas's own highlights, exactly
 * (CANVAS_SWATCHES); any other colour takes two highlights of itself made lighter in OKLab, by the mean of the canvas's
 * three (its lightness raised by 0.21 at the top left, by 0.16 at the bottom right; its hue and chroma kept).
 */
export const SWATCH_HIGHLIGHT = Object.freeze({ start: 0.21, end: 0.16 });

/** The canvas's three finishes (build.py `.steel`, `.gold`, `.blue`): their colour, then their two highlights. */
export const CANVAS_SWATCHES: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  '#9d9b96': ['#e9e8e4', '#d7d5d0'],
  '#b88a3a': ['#f0d692', '#e6c578'],
  '#16224a': ['#3a4f8f', '#2c3e78'],
});

const HEX = /^#([0-9a-f]{6})$/i;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** A colour made lighter in OKLab by `dL` (its hue and chroma kept, the result held within sRGB). */
export function lighten(hex: string, dL: number): string {
  const [L, A, B] = toOklab(hex);
  return fromOklab([Math.min(1, L + dL), A, B]);
}

/**
 * The background of a variant's dot: its swatch at 55 % between its two highlights (the canvas's own for its three
 * finishes); `none` for a colour that is not #RRGGBB.
 */
export function swatchGradient(swatch: string): string {
  if (!HEX.test(swatch)) return 'none';
  const hex = swatch.toLowerCase();
  const [start, end] = CANVAS_SWATCHES[hex] ?? [lighten(hex, SWATCH_HIGHLIGHT.start), lighten(hex, SWATCH_HIGHLIGHT.end)];
  return `linear-gradient(135deg, ${start}, ${hex} 55%, ${end})`;
}
