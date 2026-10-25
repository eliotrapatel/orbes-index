/**
 * THE VAULT CARD: the card in the box of every bought piece, beside the MINT
 * CERTIFICATE and the same size, 95 × 62 mm (plan OQ Q3 §5; vault/SCOPE.md H
 * and the card block of 23 Oct 00:09–00:34). One design for everyone: no
 * number, no name. Card millimetres, y down:
 *
 *   FRONT (black)                         BACK (the ivory stock)
 *   ┌──────────────────────────────┐      ┌──────────────────────────────┐
 *   │                              │      │ THE VAULT                    │
 *   │           ╭──THE──╮          │      │ THIS PIECE                   │
 *   │          (  VAULT  )         │      │ OPENS A VAULT                │
 *   │           ╰───────╯          │      │ ─────────────●────────────── │
 *   │   the engraved monogram      │      │ Thank you for your order. …  │
 *   │                              │      │ Open it for a chance to …    │
 *   │                              │      │ ──────────────────────────── │
 *   │                              │      │ I         II          III    │
 *   │                              │      │ REGISTER  FIND YOUR…  OPEN IT│
 *   │                              │      │ ⊕                THEORBES.COM│
 *   └──────────────────────────────┘      └──────────────────────────────┘
 *
 * Every position is the card mockup's (vault/card/vault-card-mockup.html,
 * its two cards drawn 950 × 620 px, ten pixels to the millimetre), measured
 * in Chromium: each line's glyph origin and baseline, the rule, the steps'
 * hairline, the columns, the footer. The front is the mockup's seal: THE and
 * VAULT letter by letter at their tspan positions over the monogram moved
 * 0.49 unit left, centred by ink (SCOPE 23 Oct 00:31–00:34: THE 469.5 /
 * VAULT 470.0 / ring 470.5 on a card centred at 470).
 *
 * Drawn as the certificate card is (./certificate.ts): the type as glyph
 * outlines (./card-text.ts from ./card-type.ts: Gravesend Sans 500 and
 * Helvetica Neue Regular), the monogram from its master outlines
 * (core/render/monogram.ts), no font written, K only. The front's black is
 * K 100 and reaches the bleed; its ivory is the stock left bare (VAULT K 0,
 * THE at the mockup's 85 %, K 15). The engraving, the mockup's two
 * gradients under its veil, prints as K tints of the same coverage: its face
 * on a 0.25 mm grid, its edge in pieces of at most 0.35 mm, each at the K of
 * its middle, one per cent apart, the edge at the 0.1 mm hairline floor
 * (the mockup's 0.55 px is 0.055 mm). The back's stock is never inked: its
 * words in K at the mockup's opacities (THE VAULT 55, the title 100, the
 * sentences 78, the numbers 45, the step words 100, their lines 68, the
 * address 55), the rule's ramps at 35 and its point at 100, the plain
 * hairline above the steps at 12 (CD's `.steps` border-top: no point).
 *
 * Two print files (scripts/vault-card.ts writes them into docs/assets/ with
 * the specimen): the single card, front then back, each page 101 × 68 mm
 * with its TrimBox 95 × 62 mm, 3 mm of bleed on the front's black; and the
 * A4 sheet, eight cards on the certificate's grid with cut marks past the
 * bleed, fronts on page 1, backs on page 2 mirrored for duplex, long edge.
 */
import { absoluteSegments, MONOGRAM_BOUNDS, MONOGRAM_PATHS, monogramPathData } from '../../core/render/monogram.js';
import { cardMetrics, cardText, type CardFaceName, type CardRun } from './card-text.js';
import { fmt, layerSvg, layoutCertificateSheet, PDF_TYPE, CERTIFICATE_SHEET } from './certificate.js';
import { renderPdf, type PdfLayer, type PdfPage } from './pdf.js';
import { gridCutMarks, sheetFooter } from './print-sheet.js';
import { mixTone, type StrokePath } from './scene.js';

export const VAULT_CARD = Object.freeze({
  widthMm: 95,
  heightMm: 62,
  /** The front's black past each trimmed edge. */
  bleedMm: 3,
  /** The front: the mockup's black (K 100) and its ivory (the bare stock). */
  black: '#0B0B0C',
  ivory: '#ECE6DA',
  /** The back's ink, before its opacity. */
  ink: '#141413',
});

/** The card's words, word for word as SCOPE H and the card mockup set them (D13 'we', D14 THEORBES.COM, D47). */
export const VAULT_CARD_COPY = Object.freeze({
  front: Object.freeze({ the: 'THE', vault: 'VAULT' }),
  over: 'THE VAULT',
  /** CD: `THIS PIECE<br>OPENS A VAULT`. */
  title: Object.freeze(['THIS PIECE', 'OPENS A VAULT'] as const),
  /** The second on its own line (SCOPE 23 Oct 00:23). */
  sentences: Object.freeze([
    'Thank you for your order. With this piece, we have added a vault to your account.',
    'Open it for a chance to win a prize or to unlock an access we reserve for our collectors.',
  ] as const),
  steps: Object.freeze([
    Object.freeze({ number: 'I', word: 'REGISTER', line: 'Your piece, with the code on its certificate.' }),
    Object.freeze({ number: 'II', word: 'FIND YOUR VAULT', line: 'In YOUR ACCOUNT, under THE VAULT. It is kept for 30 days.' }),
    Object.freeze({ number: 'III', word: 'OPEN IT', line: 'Press and hold its door. What it holds is yours.' }),
  ]),
  address: 'THEORBES.COM',
});

/** The steps' lines as the mockup wraps them in their columns. */
const STEP_LINES: readonly (readonly string[])[] = [
  ['Your piece, with the code on its', 'certificate.'],
  ['In YOUR ACCOUNT, under THE', 'VAULT. It is kept for 30 days.'],
  ['Press and hold its door. What it', 'holds is yours.'],
];

/** One line of type: its face, size (the em, mm), tracking (em), K and the mockup's opacity. */
interface TypeSpec {
  face: CardFaceName;
  size: number;
  tracking: number;
  /** The ink's coverage: the mockup's opacity of its colour. */
  alpha: number;
}

/**
 * The back, from the mockup measured in Chromium (px ÷ 10): glyph origins (x) and baselines (y), mm from the card's
 * top-left corner. Sizes are the CSS font sizes, tracking the letter-spacing in ems.
 */
export const VAULT_CARD_BACK = Object.freeze({
  /** The content's left and right edges (padding 72 px). */
  x0: 7.2,
  x1: 87.8,
  over: Object.freeze({ face: 'gravesend', size: 1.3, tracking: 0.42, alpha: 0.55, baseline: 6.6 } as const),
  title: Object.freeze({ face: 'gravesend', size: 3.0, tracking: 0.2, alpha: 1, baselines: [12.2, 16.25] } as const),
  /** The horizon: 1 px high, 35 % ink from 15 % to 85 % of its length, ramps to nothing at both ends; its 5 px point. */
  rule: Object.freeze({ top: 19.3, height: 0.1, alpha: 0.35, ramp: 0.15, pointCentreY: 19.35, pointRadius: 0.25 }),
  sentences: Object.freeze({ face: 'regular', size: 1.9, tracking: 0, alpha: 0.78, baselines: [23.7, 26.6438] } as const),
  /** CD's `.steps` border-top: a plain hairline at 12 %, no point. */
  hairline: Object.freeze({ top: 30.4875, height: 0.1, alpha: 0.12 }),
  /** The three columns' left edges and width (a 3-column grid, 30 px gaps). */
  columns: Object.freeze({ x: [7.2, 35.0656, 62.9328] as const, width: 24.8672 }),
  number: Object.freeze({ face: 'gravesend', size: 1.1, tracking: 0.3, alpha: 0.45, baseline: 34.1875 } as const),
  word: Object.freeze({ face: 'gravesend', size: 1.3, tracking: 0.3, alpha: 1, baseline: 36.5875 } as const),
  line: Object.freeze({ face: 'regular', size: 1.5, tracking: 0, alpha: 0.68, baselines: [38.9875, 41.1625] } as const),
  address: Object.freeze({ face: 'gravesend', size: 1.3, tracking: 0.42, alpha: 0.55, x: 70.7906, baseline: 56.7 } as const),
  /** The ORBES monogram: the mockup's 30 px symbol (viewBox ±7.4) at (72, 546) px, its master scaled by 0.033782 from (−8.4493, −8.73). */
  monogram: Object.freeze({ boxX: 7.2, boxY: 54.6, boxMm: 3, viewHalf: 7.4, scale: 0.033782, offsetX: -8.4493, offsetY: -8.73 }),
});

/**
 * The front: the mockup's 300 px seal (viewBox ±18) centred on the card, so one seal unit is 300 / 36 px = 5/6 mm.
 * The monogram is its mask's: translate(−0.49 0) scale(2.8378), then the symbol's translate(−8.4493 −8.73)
 * scale(0.033782). THE (2.5 units, 85 %) and VAULT (7.4 units) at their tspan origins.
 */
export const VAULT_CARD_FRONT = Object.freeze({
  centreX: 47.5,
  centreY: 31,
  unitMm: 5 / 6,
  monogram: Object.freeze({ shiftX: -0.49, scale: 2.8378, symbolScale: 0.033782, symbolX: -8.4493, symbolY: -8.73 }),
  the: Object.freeze({ size: 2.5, baseline: -3.25, alpha: 0.85, x: [-4.296, -1.569, 1.574] as const }),
  vault: Object.freeze({ size: 7.4, baseline: 4.97, alpha: 1, x: [-16.726, -9.397, -1.831, 6.016, 12.553] as const }),
  /** The engraving's face and edge: gradients from (−16, −18) to (14, 18), as [offset, opacity] stops. */
  fill: Object.freeze([[0, 0.17], [0.42, 0.05], [0.58, 0.09], [1, 0.03]] as const),
  edge: Object.freeze([[0, 0.62], [0.45, 0.16], [0.6, 0.3], [1, 0.12]] as const),
  gradientFrom: Object.freeze([-16, -18] as const),
  gradientTo: Object.freeze([14, 18] as const),
  /** The veil over the engraving: the black from 72 % at (0.8, 5.1) to nothing at 17 × 7.5 units, inside ±18 × ±9. */
  veil: Object.freeze({ cx: 0.8, cy: 5.1, rx: 17, ry: 7.5, halfW: 18, halfH: 9, stops: Object.freeze([[0, 0.72], [0.6, 0.35], [1, 0]] as const) }),
  /** The print's rendering of the gradients: the face's grid and the edge's pieces, mm. */
  gridMm: 0.25,
  pieceMm: 0.35,
  edgeWidthMm: 0.1,
});

/** The fixed date of the print files (byte-for-byte reproducible): the lot's day. */
export const VAULT_CARD_DATE = new Date('2026-10-25T00:00:00.000Z');

export type VaultCardLayout = 'single' | 'sheet';

export interface RenderedVaultCard {
  contentType: string;
  body: Uint8Array;
  filename: string;
}

/** A face laid out: its layers in page millimetres, and where things went (for the checks). */
export interface VaultCardFace {
  layers: PdfLayer[];
  /** Text runs as drawn: their words, baseline and ink. */
  runs: { text: string; baseline: number; left: number; right: number }[];
  /** Plain rectangles (the rule's ramps, its middle, the hairline) and the point, page millimetres. */
  rects: { name: string; x: number; y: number; w: number; h: number; k: number }[];
  /** The monogram's ink box, and on the front its O's. */
  monogram: { x: number; y: number; w: number; h: number };
  ring?: { x: number; y: number; w: number; h: number };
}

const kOf = (alpha: number): number => Math.round(alpha * 100 * 100) / 100;

/** A piecewise linear ramp of [offset, value] stops, clamped at both ends. */
function ramp(stops: readonly (readonly [number, number])[], t: number): number {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, v1] = stops[i];
    if (t <= t1) {
      const [t0, v0] = stops[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return stops[stops.length - 1][1];
}

const rectPath = (x: number, y: number, w: number, h: number): string => `M${fmt(x)} ${fmt(y)}L${fmt(x + w)} ${fmt(y)}L${fmt(x + w)} ${fmt(y + h)}L${fmt(x)} ${fmt(y + h)}Z`;

/** A line of type with its first glyph's origin at x, as the browser sets it (the ink starts one side bearing in). */
function lineAt(text: string, spec: TypeSpec, x: number, baseline: number): CardRun {
  const type = { face: spec.face, size: spec.size, tracking: spec.tracking };
  return cardText(text, { ...type, x: x + cardMetrics(text, type).lsb, baseline });
}

// ── The front ──────────────────────────────────────────────────────────────

/** The engraving's ivory coverage at a point of the seal (seal units): its gradient under the veil. */
function engraving(stops: readonly (readonly [number, number])[], sx: number, sy: number): number {
  const F = VAULT_CARD_FRONT;
  const [ax, ay] = F.gradientFrom;
  const [bx, by] = F.gradientTo;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, ((sx - ax) * dx + (sy - ay) * dy) / (dx * dx + dy * dy)));
  const V = F.veil;
  let veil = 0;
  if (Math.abs(sx) <= V.halfW && Math.abs(sy) <= V.halfH) {
    const r = Math.sqrt(((sx - V.cx) / V.rx) ** 2 + ((sy - V.cy) / V.ry) ** 2);
    veil = r >= 1 ? 0 : ramp(V.stops, r);
  }
  return ramp(stops, t) * (1 - veil);
}

/** K of an ivory coverage on the black: the bare stock is K 0, the black K 100; whole per cents. */
const kOnBlack = (coverage: number): number => Math.round(100 * (1 - coverage));

/** Lay out the front with its top-left corner at (ox, oy), page millimetres. The black plate is the page's (see frontPlate). */
export function layoutVaultCardFront(ox = 0, oy = 0): VaultCardFace {
  const F = VAULT_CARD_FRONT;
  const u = F.unitMm;
  const cx = ox + F.centreX;
  const cy = oy + F.centreY;
  const M = F.monogram;
  // Artboard → seal units → page millimetres.
  const sealX = (x: number) => M.shiftX + M.scale * (M.symbolX + M.symbolScale * x);
  const sealY = (y: number) => M.scale * (M.symbolY + M.symbolScale * y);
  const pageX = (sx: number) => cx + sx * u;
  const pageY = (sy: number) => cy + sy * u;
  const mono = { x: pageX(sealX(MONOGRAM_BOUNDS.x)), y: pageY(sealY(MONOGRAM_BOUNDS.y)), w: MONOGRAM_BOUNDS.w * M.scale * M.symbolScale * u, h: 0 };
  mono.h = (mono.w * MONOGRAM_BOUNDS.h) / MONOGRAM_BOUNDS.w;
  const outlines = monogramPathData({ x: mono.x, y: mono.y, width: mono.w }).join('');
  const layers: PdfLayer[] = [];
  const display = (coverage: number) => mixTone(VAULT_CARD.ivory, VAULT_CARD.black, coverage) as string;

  // The face: a grid of cells, each at the K of its middle, in runs of one K, clipped to the outlines.
  const g = F.gridMm;
  const byK = new Map<number, string>();
  const rows = Math.ceil(mono.h / g);
  const cols = Math.ceil(mono.w / g);
  for (let r = 0; r < rows; r++) {
    const y = mono.y + r * g;
    let runStart = 0;
    let runK = -1;
    const flush = (end: number) => {
      if (runK >= 0 && runK < 100) byK.set(runK, (byK.get(runK) ?? '') + rectPath(mono.x + runStart * g, y, (end - runStart) * g, g));
    };
    for (let c = 0; c <= cols; c++) {
      const k = c === cols ? -2 : kOnBlack(engraving(F.fill, (mono.x + (c + 0.5) * g - cx) / u, (y + g / 2 - cy) / u));
      if (k !== runK) {
        flush(c);
        runStart = c;
        runK = k;
      }
    }
  }
  const faceItems: PdfLayer[] = [...byK.entries()].sort((a, b) => b[0] - a[0]).map(([k, d]) => ({ kind: 'fill', d, color: display(1 - k / 100), k }));
  layers.push({ kind: 'clip', clip: outlines, items: faceItems });

  // The edge: each outline segment cut into pieces of at most pieceMm, each stroked at the K of its middle.
  const edges = new Map<number, string>();
  let last: { k: number; x: number; y: number } | null = null;
  const piece = (k: number, x0: number, y0: number, seg: string, x1: number, y1: number) => {
    if (k >= 100) {
      last = null;
      return;
    }
    const cont = last !== null && last.k === k && last.x === x0 && last.y === y0;
    edges.set(k, (edges.get(k) ?? '') + (cont ? '' : `M${fmt(x0)} ${fmt(y0)}`) + seg);
    last = { k, x: x1, y: y1 };
  };
  const kAt = (x: number, y: number) => kOnBlack(engraving(F.edge, (x - cx) / u, (y - cy) / u));
  for (const d of MONOGRAM_PATHS) {
    let [px, py] = [0, 0];
    let [startX, startY] = [0, 0];
    last = null;
    for (const s of absoluteSegments(d)) {
      if (s[0] === 'M') {
        [px, py] = [pageX(sealX(s[1])), pageY(sealY(s[2]))];
        [startX, startY] = [px, py];
        last = null;
        continue;
      }
      if (s[0] === 'L' || s[0] === 'Z') {
        const [x1, y1] = s[0] === 'L' ? [pageX(sealX(s[1])), pageY(sealY(s[2]))] : [startX, startY];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - px, y1 - py) / F.pieceMm));
        for (let i = 0; i < n; i++) {
          const [ax, ay] = [px + ((x1 - px) * i) / n, py + ((y1 - py) * i) / n];
          const [bx, by] = [px + ((x1 - px) * (i + 1)) / n, py + ((y1 - py) * (i + 1)) / n];
          piece(kAt((ax + bx) / 2, (ay + by) / 2), ax, ay, `L${fmt(bx)} ${fmt(by)}`, bx, by);
        }
        [px, py] = [x1, y1];
        continue;
      }
      // A cubic: cut by de Casteljau into n equal parameter steps, n from its control polygon's length.
      if (s[0] !== 'C') continue;
      const [, c1x, c1y, c2x, c2y, ex, ey] = s as readonly ['C', number, number, number, number, number, number];
      const p = [
        [px, py],
        [pageX(sealX(c1x)), pageY(sealY(c1y))],
        [pageX(sealX(c2x)), pageY(sealY(c2y))],
        [pageX(sealX(ex)), pageY(sealY(ey))],
      ];
      const hull = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) + Math.hypot(p[3][0] - p[2][0], p[3][1] - p[2][1]);
      const n = Math.max(1, Math.ceil(hull / F.pieceMm));
      for (let i = 0; i < n; i++) {
        const [a, b, c, e] = subCubic(p, i / n, (i + 1) / n);
        const mid = subCubic(p, (i + 0.5) / n, (i + 0.5) / n)[0];
        piece(kAt(mid[0], mid[1]), a[0], a[1], `C${fmt(b[0])} ${fmt(b[1])} ${fmt(c[0])} ${fmt(c[1])} ${fmt(e[0])} ${fmt(e[1])}`, e[0], e[1]);
      }
      [px, py] = [p[3][0], p[3][1]];
    }
  }
  for (const [k, d] of [...edges.entries()].sort((a, b) => b[0] - a[0])) {
    layers.push({ kind: 'stroke', d, width: F.edgeWidthMm, cap: 'round', join: 'round', color: display(1 - k / 100), k });
  }

  // THE and VAULT, letter by letter at the mockup's origins.
  const runs: VaultCardFace['runs'] = [];
  for (const [word, spec] of [
    [VAULT_CARD_COPY.front.the, F.the],
    [VAULT_CARD_COPY.front.vault, F.vault],
  ] as const) {
    let d = '';
    let left = Infinity;
    let right = -Infinity;
    [...word].forEach((ch, i) => {
      const run = lineAt(ch, { face: 'gravesend', size: spec.size * u, tracking: 0, alpha: spec.alpha }, pageX(spec.x[i]), pageY(spec.baseline));
      d += run.d;
      left = Math.min(left, run.inkLeft);
      right = Math.max(right, run.inkRight);
    });
    const k = kOnBlack(spec.alpha);
    layers.push({ kind: 'fill', d, color: display(spec.alpha), k });
    runs.push({ text: word, baseline: pageY(spec.baseline), left, right });
  }

  // The O's own ink box, for the centring check.
  const o = monogramPathData({ x: mono.x, y: mono.y, width: mono.w })[0];
  const ringPts = [...o.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const ox0 = Math.min(...ringPts.filter((_, i) => i % 2 === 0));
  const ox1 = Math.max(...ringPts.filter((_, i) => i % 2 === 0));
  const oy0 = Math.min(...ringPts.filter((_, i) => i % 2 === 1));
  const oy1 = Math.max(...ringPts.filter((_, i) => i % 2 === 1));
  return { layers, runs, rects: [], monogram: mono, ring: { x: ox0, y: oy0, w: ox1 - ox0, h: oy1 - oy0 } };
}

/** The segment of a cubic between parameters t0 and t1, as its four control points. */
function subCubic(p: readonly (readonly number[])[], t0: number, t1: number): [number, number][] {
  const at = (t: number): [number, number] => {
    const m = 1 - t;
    return [0, 1].map((j) => m * m * m * p[0][j] + 3 * m * m * t * p[1][j] + 3 * m * t * t * p[2][j] + t * t * t * p[3][j]) as [number, number];
  };
  const d = (t: number): [number, number] => {
    const m = 1 - t;
    return [0, 1].map((j) => 3 * m * m * (p[1][j] - p[0][j]) + 6 * m * t * (p[2][j] - p[1][j]) + 3 * t * t * (p[3][j] - p[2][j])) as [number, number];
  };
  const a = at(t0);
  const e = at(t1);
  const h = (t1 - t0) / 3;
  const da = d(t0);
  const de = d(t1);
  return [a, [a[0] + da[0] * h, a[1] + da[1] * h], [e[0] - de[0] * h, e[1] - de[1] * h], e];
}

/** The front's black: a rectangle in page millimetres, drawn first (the cards' bleed, or the sheet's grid and its bleed). */
export function frontPlate(x: number, y: number, w: number, h: number): PdfLayer {
  return { kind: 'fill', d: rectPath(x, y, w, h), color: VAULT_CARD.black, k: 100 };
}

// ── The back ───────────────────────────────────────────────────────────────

/** Lay out the back with its top-left corner at (ox, oy), page millimetres. Its stock is never inked. */
export function layoutVaultCardBack(ox = 0, oy = 0): VaultCardFace {
  const B = VAULT_CARD_BACK;
  const layers: PdfLayer[] = [];
  const runs: VaultCardFace['runs'] = [];
  const rects: VaultCardFace['rects'] = [];
  const display = (alpha: number) => mixTone(VAULT_CARD.ink, VAULT_CARD.ivory, alpha) as string;
  const type = (text: string, spec: TypeSpec, x: number, baseline: number) => {
    const run = lineAt(text, spec, ox + x, oy + baseline);
    layers.push({ kind: 'fill', d: run.d, color: display(spec.alpha), k: kOf(spec.alpha) });
    runs.push({ text, baseline: oy + baseline, left: run.inkLeft, right: Math.max(run.inkRight, run.drawnRight) });
  };
  const rect = (name: string, x: number, y: number, w: number, h: number, alpha: number) => {
    layers.push({ kind: 'fill', d: rectPath(ox + x, oy + y, w, h), color: display(alpha), k: kOf(alpha) });
    rects.push({ name, x: ox + x, y: oy + y, w, h, k: kOf(alpha) });
  };

  type(VAULT_CARD_COPY.over, B.over, B.x0, B.over.baseline);
  VAULT_CARD_COPY.title.forEach((line, i) => type(line, B.title, B.x0, B.title.baselines[i]));

  // The horizon: its ramps in steps of at most 0.4 mm (each one a hair longer, so no seam shows between them), its middle, its point.
  const R = B.rule;
  const length = B.x1 - B.x0;
  const rampMm = length * R.ramp;
  const steps = Math.ceil(rampMm / 0.4);
  const stepMm = rampMm / steps;
  for (let i = 0; i < steps; i++) {
    const a = (R.alpha * (i + 0.5)) / steps;
    rect(`rule-in-${i}`, B.x0 + i * stepMm, R.top, stepMm + 0.02, R.height, a);
    rect(`rule-out-${i}`, B.x1 - (i + 1) * stepMm - 0.02, R.top, stepMm + 0.02, R.height, a);
  }
  rect('rule', B.x0 + rampMm, R.top, length - 2 * rampMm, R.height, R.alpha);
  const pr = R.pointRadius;
  const px = ox + (B.x0 + B.x1) / 2;
  const py = oy + R.pointCentreY;
  // A circle as four cubic quarters (kappa 0.5523).
  const kq = 0.5523 * pr;
  layers.push({
    kind: 'fill',
    d: `M${fmt(px + pr)} ${fmt(py)}C${fmt(px + pr)} ${fmt(py + kq)} ${fmt(px + kq)} ${fmt(py + pr)} ${fmt(px)} ${fmt(py + pr)}C${fmt(px - kq)} ${fmt(py + pr)} ${fmt(px - pr)} ${fmt(py + kq)} ${fmt(px - pr)} ${fmt(py)}C${fmt(px - pr)} ${fmt(py - kq)} ${fmt(px - kq)} ${fmt(py - pr)} ${fmt(px)} ${fmt(py - pr)}C${fmt(px + kq)} ${fmt(py - pr)} ${fmt(px + pr)} ${fmt(py - kq)} ${fmt(px + pr)} ${fmt(py)}Z`,
    color: VAULT_CARD.ink,
    k: 100,
  });
  rects.push({ name: 'point', x: px - pr, y: py - pr, w: 2 * pr, h: 2 * pr, k: 100 });

  VAULT_CARD_COPY.sentences.forEach((line, i) => type(line, B.sentences, B.x0, B.sentences.baselines[i]));

  // The plain hairline between the sentences and the steps.
  const H = B.hairline;
  rect('hairline', B.x0, H.top, length, H.height, H.alpha);

  VAULT_CARD_COPY.steps.forEach((step, i) => {
    const x = B.columns.x[i];
    type(step.number, B.number, x, B.number.baseline);
    type(step.word, B.word, x, B.word.baseline);
    STEP_LINES[i].forEach((line, j) => type(line, B.line, x, B.line.baselines[j]));
  });

  // The footer: the ORBES monogram, then THEORBES.COM.
  const M = B.monogram;
  const k = M.boxMm / (2 * M.viewHalf);
  const mono = {
    x: ox + M.boxX + (M.offsetX + M.scale * MONOGRAM_BOUNDS.x + M.viewHalf) * k,
    y: oy + M.boxY + (M.offsetY + M.scale * MONOGRAM_BOUNDS.y + M.viewHalf) * k,
    w: MONOGRAM_BOUNDS.w * M.scale * k,
    h: MONOGRAM_BOUNDS.h * M.scale * k,
  };
  layers.push({ kind: 'fill', d: monogramPathData({ x: mono.x, y: mono.y, width: mono.w }).join(''), color: VAULT_CARD.ink, k: 100 });
  type(VAULT_CARD_COPY.address, B.address, B.address.x, B.address.baseline);

  return { layers, runs, rects, monogram: mono };
}

// ── Print files ────────────────────────────────────────────────────────────

/** Cut marks on the sheet start past the front's bleed and stay clear of an office printer's edge. */
const SHEET_TICKS = Object.freeze({ gapMm: VAULT_CARD.bleedMm + 1, lengthMm: 2 });

/** The single card's pages: the front with its bleed, then the back, each 101 × 68 mm with its TrimBox. */
export function vaultCardSinglePages(): PdfPage[] {
  const { widthMm: w, heightMm: h, bleedMm: b } = VAULT_CARD;
  const page = (layers: PdfLayer[]): PdfPage => ({ widthMm: w + 2 * b, heightMm: h + 2 * b, layers, placements: [], trimBox: { xMm: b, yMm: b, wMm: w, hMm: h } });
  return [page([frontPlate(0, 0, w + 2 * b, h + 2 * b), ...layoutVaultCardFront(b, b).layers]), page(layoutVaultCardBack(b, b).layers)];
}

/** The A4 sheet: eight fronts on the certificate's grid with the black past its outer edges, then eight backs mirrored for duplex, long edge. */
export function vaultCardSheetPages(): PdfPage[] {
  const sheet = layoutCertificateSheet(8);
  const { widthMm: w, heightMm: h, bleedMm: b } = VAULT_CARD;
  const { columns, rows } = CERTIFICATE_SHEET;
  const slots = sheet.pages[0];
  const [x0, y0] = [slots[0].xMm, slots[0].yMm];
  const cuts = gridCutMarks(x0, y0, columns, rows, w, h, SHEET_TICKS);
  const caption = (side: string) => `ORBES THE VAULT CARD · ${side}`;
  const marks = (pageIndex: number, side: string): StrokePath[] => [cuts, ...sheetFooter({ ...sheet, pages: [slots, slots] }, pageIndex, caption(side), CERTIFICATE_SHEET.footer)];
  const fronts: PdfPage = {
    widthMm: sheet.pageWidthMm,
    heightMm: sheet.pageHeightMm,
    layers: [frontPlate(x0 - b, y0 - b, columns * w + 2 * b, rows * h + 2 * b), ...slots.flatMap((s) => layoutVaultCardFront(s.xMm, s.yMm).layers)],
    placements: [],
    marks: marks(0, 'FRONTS'),
    markColor: '#0A0A0A',
  };
  // Long-edge duplex turns the sheet about its vertical axis: the back of the card in column c prints in column (columns − 1 − c).
  const backs: PdfPage = {
    widthMm: sheet.pageWidthMm,
    heightMm: sheet.pageHeightMm,
    layers: slots.flatMap((s) => layoutVaultCardBack(sheet.pageWidthMm - s.xMm - w, s.yMm).layers),
    placements: [],
    marks: marks(1, 'BACKS · DUPLEX LONG EDGE'),
    markColor: '#0A0A0A',
  };
  return [fronts, backs];
}

/** THE VAULT CARD as a print file: the single card (front, back) or the A4 sheet of eight. K only, no font, reproducible. */
export async function renderVaultCardPdf(layout: VaultCardLayout, createdAt: Date = VAULT_CARD_DATE): Promise<RenderedVaultCard> {
  if (layout !== 'single' && layout !== 'sheet') throw new RangeError('layout must be single or sheet');
  const single = layout === 'single';
  const body = await renderPdf(single ? vaultCardSinglePages() : vaultCardSheetPages(), {
    title: single ? 'ORBES THE VAULT CARD' : 'ORBES THE VAULT CARD · A4 SHEET OF 8',
    subject: single
      ? 'THE VAULT CARD, 95 × 62 mm: the front with 3 mm of bleed, then the back'
      : 'THE VAULT CARD, eight on A4 with cut marks: the fronts, then the backs for duplex printing, long edge',
    keywords: 'ORBES, THE VAULT, card',
    creationDate: createdAt,
    colorMode: 'k-only',
  });
  return { contentType: PDF_TYPE, body, filename: single ? 'vault-card-single.pdf' : 'vault-card-sheet.pdf' };
}

/** The mockup's ground around the two cards. */
const SPECIMEN_GROUND = '#2A2826';

/**
 * SVG of the two faces side by side as the card mockup shows them (4 mm around and between them, on its ground):
 * the specimen the console's Documents shows. Not a production file: the PDFs print the same geometry in K.
 */
export function vaultCardSpecimenSvg(): string {
  const { widthMm: w, heightMm: h } = VAULT_CARD;
  const gap = 4;
  const W = 3 * gap + 2 * w;
  const H = 2 * gap + h;
  const defs: string[] = [];
  const ids = { next: 1, prefix: 'vault-card-clip-' };
  const front = layoutVaultCardFront(gap, gap);
  const back = layoutVaultCardBack(2 * gap + w, gap);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,
    '<title>THE VAULT CARD, front and back</title>',
    ...(() => {
      const body = [
        `<rect data-layer="ground" width="${W}" height="${H}" fill="${SPECIMEN_GROUND}"/>`,
        `<g data-layer="front"><rect x="${gap}" y="${gap}" width="${w}" height="${h}" fill="${VAULT_CARD.black}"/>`,
        ...front.layers.map((l) => layerSvg(l, ids, defs)),
        '</g>',
        `<g data-layer="back"><rect x="${2 * gap + w}" y="${gap}" width="${w}" height="${h}" fill="${VAULT_CARD.ivory}"/>`,
        ...back.layers.map((l) => layerSvg(l, ids, defs)),
        '</g>',
      ];
      return [`<defs>${defs.join('')}</defs>`, ...body];
    })(),
    '</svg>',
    '',
  ].join('\n');
}
