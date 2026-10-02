/**
 * The ORBES monogram: the brand's master vector emblem, an O that holds the
 * R, the B, the E and the S (BRAND-DESIGN-SYSTEM §3.9). One colour, five
 * filled outlines on a 500 × 500 artboard, exactly as the brand exported them
 * (docs/assets/brand/orbes-monogram.svg; test/web/monogram.test.ts checks the
 * paths below against that file).
 *
 * It is an emblem beside the word, never the word: ORBES stays typed in the
 * display face on screen and in the stroked lettering on print. It goes where
 * the brand decided: the browser tab icons, the /verify landing, the console's
 * sign-in and sidebar (genome/src/web/shared/monogram.ts draws it there, in
 * currentColor), and the certificate card (genome/src/server/render/
 * certificate.ts, a flat K fill). It lives in the core because both the web
 * apps and the server's PDF renderer draw it, and the production image ships
 * src/core and src/server only.
 *
 * Never redraw, retouch, recolour or typeset it: update the master file and
 * the paths together.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

/** The master artboard (the SVG export's viewBox). */
export const MONOGRAM_ARTBOARD = Object.freeze({ x: 0, y: 0, w: 500, h: 500 });

/** Accessible name of the emblem when it stands alone. */
export const MONOGRAM_LABEL = 'ORBES';

/**
 * The five outlines of the master file, verbatim, in its order: the O, the R,
 * the B, the E, the S. Filled with the non-zero rule: every counter (the O's,
 * the R's bowl, the B's two) runs against its outline, so it stays open.
 */
export const MONOGRAM_PATHS: readonly string[] = Object.freeze([
  'M144.55,398.12c-31.38-12.38-56.17-30.43-74.36-54.16-18.2-23.72-27.29-52.24-27.29-85.54s9.1-61.82,27.29-85.54c18.19-23.72,42.98-41.78,74.36-54.16,31.38-12.38,66.57-18.57,105.56-18.57s74.17,6.19,105.56,18.57c31.38,12.38,56.16,30.43,74.36,54.16,18.19,23.73,27.29,52.24,27.29,85.54s-9.1,61.82-27.29,85.54c-18.2,23.73-42.99,41.78-74.36,54.16-31.39,12.38-66.57,18.57-105.56,18.57s-74.18-6.19-105.56-18.57ZM350.65,389.72c24.69-15.62,41.86-34.99,51.53-58.13,9.65-23.13,14.48-47.52,14.48-73.17s-4.83-50.03-14.48-73.17c-9.66-23.13-26.83-42.51-51.53-58.13-24.7-15.62-58.21-23.43-100.54-23.43s-75.85,7.81-100.54,23.43c-24.7,15.62-41.87,35-51.53,58.13-9.66,23.14-14.48,47.52-14.48,73.17s4.82,50.03,14.48,73.17c9.65,23.14,26.82,42.52,51.53,58.13,24.69,15.62,58.21,23.43,100.54,23.43s75.84-7.81,100.54-23.43Z',
  'M352.34,381.88l-121.64-109.46h-88.22v109.46h-29.41l-.45-245.58h130.55c21.39,0,41.28,1.4,59.7,4.21,18.41,2.81,34.6,9.18,48.57,19.12,13.96,9.94,20.94,24.85,20.94,44.73,0,43.04-36.09,65.6-108.27,67.71l122.53,109.81h-34.31ZM142.49,139.11v130.51h100.7c20.79,0,38.32-1.75,52.58-5.26,14.26-3.51,25.47-10,33.64-19.47,8.17-9.47,12.25-22.98,12.25-40.52s-4.01-31.05-12.03-40.52-19.16-15.96-33.42-19.47c-14.26-3.51-31.93-5.26-53.02-5.26h-100.7Z',
  'M194.39,201.6c22.08.13,40.85,2.59,56.29,7.38,15.44,4.79,23.16,13.96,23.16,27.49,0,10.6-4.98,18.49-14.94,23.66s-20.96,8.37-33,9.58c-12.04,1.22-25.2,1.82-39.48,1.82h-67.5v-134.11h55.79c17.1,0,31.59.54,43.46,1.63,11.87,1.09,22.33,4.02,31.38,8.81,9.05,4.79,13.57,12.17,13.57,22.13,0,12.26-6.39,20.5-19.18,24.72-12.79,4.21-29.31,6.39-49.56,6.51v.38ZM136.1,138.95v61.69h37.86c17.43,0,30.88-.51,40.35-1.53,9.46-1.02,17.19-3.74,23.16-8.14s8.97-11.4,8.97-20.98-3.07-16.41-9.22-20.88c-6.14-4.47-13.95-7.28-23.41-8.43-9.46-1.15-22.17-1.72-38.11-1.72h-39.6ZM186.42,270c14.11,0,25.86-.57,35.24-1.72,9.38-1.15,17.56-4.15,24.53-9,6.97-4.85,10.46-12.45,10.46-22.8s-3.78-18.39-11.33-23.37c-7.56-4.98-16.81-8.05-27.77-9.2-10.96-1.15-25.49-1.72-43.59-1.72h-37.86v67.82h50.31Z',
  'M97.06,379.81h24.03v-108.07h-24.03v-2.21h123.81v27.33h-2.38c-1.88-4.11-3.9-7.71-6.06-10.82-2.17-3.11-4.76-5.74-7.79-7.9-3.03-2.16-6.64-3.76-10.82-4.82-4.19-1.05-9.24-1.58-15.15-1.58h-35.93v48.82h14.07c4.76,0,8.8-.32,12.12-.95,3.32-.63,6.17-1.82,8.55-3.55,2.38-1.74,4.4-4.11,6.06-7.11,1.66-3,3.28-6.87,4.87-11.61h2.38v49.13h-2.38c-1.01-3.05-2.06-6-3.14-8.85s-2.6-5.37-4.55-7.58c-1.95-2.21-4.54-3.97-7.79-5.29-3.25-1.32-7.47-1.97-12.66-1.97h-17.53v57.03h40.91c7.93,0,14.54-1.24,19.8-3.71,5.27-2.47,9.56-5.42,12.88-8.85,3.32-3.42,5.77-6.98,7.36-10.66,1.59-3.69,2.6-6.74,3.03-9.16h2.38v34.6H97.06v-2.21Z',
  'M277,349.42c-16.98-8.48-25.47-19.82-25.47-34,0-6.74,1.77-12.43,5.32-17.09l2.66,1.39c-1.52,2.09-2.73,4.59-3.61,7.5-.89,2.91-1.33,5.64-1.33,8.19,0,8.6,3.67,16.22,11.02,22.84,7.35,6.63,17.68,11.8,30.98,15.52,13.3,3.72,28.7,5.58,46.18,5.58,26.61,0,46.75-3.66,60.44-10.99,13.68-7.32,20.53-17.03,20.53-29.12,0-8.6-3.61-15.69-10.83-21.27-7.22-5.58-16.09-9.94-26.61-13.08-10.52-3.14-24.65-6.57-42.38-10.29-19.26-4.18-34.53-7.96-45.8-11.33-11.28-3.37-20.85-8.25-28.7-14.65-7.86-6.39-11.78-14.59-11.78-24.59,0-12.32,5.13-22.26,15.4-29.82,10.26-7.55,22.74-12.9,37.44-16.04,14.69-3.14,29.39-4.71,44.09-4.71,23.82,0,42.95,3.78,57.4,11.33,14.44,7.56,21.67,17.73,21.67,30.51,0,6.51-1.4,11.74-4.18,15.69l-3.04-1.39c2.79-3.49,4.18-8.25,4.18-14.3,0-11.86-6.84-21.33-20.53-28.42-13.68-7.09-32.06-10.64-55.12-10.64-25.09,0-44.54,3.66-58.35,10.98-13.81,7.32-20.72,16.57-20.72,27.72,0,6.97,3.29,12.73,9.88,17.26,6.59,4.53,14.63,8.2,24.14,10.99s23,6.05,40.48,9.76c19.77,3.96,35.98,7.85,48.65,11.68,12.67,3.84,23.38,9.24,32.12,16.22,8.74,6.97,13.11,16.04,13.11,27.2,0,17.21-9.5,30.51-28.51,39.93-19.01,9.42-43.21,14.12-72.6,14.12-27.12,0-49.17-4.24-66.14-12.73Z',
]);

export interface MonogramBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One absolute segment: M x y · L x y · C x1 y1 x2 y2 x y · Z. */
type Segment = readonly ['M' | 'L', number, number] | readonly ['C', number, number, number, number, number, number] | readonly ['Z'];

const TOKEN = /([MmLlHhVvCcSsZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([\s,]+)|(.)/g;

/**
 * Path data → absolute segments. Reads the commands the master uses (M L H V
 * C S Z, absolute or relative, with implicit repeats); S becomes the C it
 * stands for, H and V become L. Anything else is refused: a new master that
 * needs more must extend this, not be drawn wrong.
 */
export function absoluteSegments(d: string): Segment[] {
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(TOKEN)) {
    if (m[4] !== undefined) throw new RangeError(`monogram: unsupported path data at "${m[4]}"`);
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }
  const out: Segment[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Second control point of the previous C, for the reflection of S.
  let lastC: [number, number] | null = null;
  const num = (): number => {
    const v = tokens[i++];
    if (typeof v !== 'number') throw new RangeError('monogram: path data is missing a number');
    return v;
  };
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++] as string;
    else if (cmd === '' || cmd === 'Z' || cmd === 'z') throw new RangeError('monogram: a number without a command');
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = ox + num();
        y = oy + num();
        [startX, startY] = [x, y];
        out.push(['M', x, y]);
        cmd = rel ? 'l' : 'L'; // further pairs are line-tos
        lastC = null;
        break;
      }
      case 'L':
        x = ox + num();
        y = oy + num();
        out.push(['L', x, y]);
        lastC = null;
        break;
      case 'H':
        x = ox + num();
        out.push(['L', x, y]);
        lastC = null;
        break;
      case 'V':
        y = oy + num();
        out.push(['L', x, y]);
        lastC = null;
        break;
      case 'C': {
        const [x1, y1, x2, y2] = [ox + num(), oy + num(), ox + num(), oy + num()];
        x = ox + num();
        y = oy + num();
        out.push(['C', x1, y1, x2, y2, x, y]);
        lastC = [x2, y2];
        break;
      }
      case 'S': {
        const [x1, y1] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const [x2, y2] = [ox + num(), oy + num()];
        x = ox + num();
        y = oy + num();
        out.push(['C', x1, y1, x2, y2, x, y]);
        lastC = [x2, y2];
        break;
      }
      case 'Z':
        out.push(['Z']);
        [x, y] = [startX, startY];
        lastC = null;
        break;
      default:
        throw new RangeError(`monogram: unsupported command ${cmd}`);
    }
  }
  return out;
}

/** Extremes of one cubic coordinate on [0, 1]: the end points and the roots of its derivative. */
function cubicExtremes(p0: number, p1: number, p2: number, p3: number): number[] {
  const at = (t: number) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
  // B'(t)/3 = a t² + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) roots.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a));
  }
  return [p0, p3, ...roots.filter((t) => t > 0 && t < 1).map(at)];
}

/** Exact bounding box of the ink of some path data (curves included, not just their control points). */
export function pathBounds(paths: readonly string[]): MonogramBox {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (xs: number[], ys: number[]) => {
    minX = Math.min(minX, ...xs);
    maxX = Math.max(maxX, ...xs);
    minY = Math.min(minY, ...ys);
    maxY = Math.max(maxY, ...ys);
  };
  for (const d of paths) {
    let [x, y] = [0, 0];
    for (const s of absoluteSegments(d)) {
      if (s[0] === 'Z') continue;
      if (s[0] === 'C') {
        add(cubicExtremes(x, s[1], s[3], s[5]), cubicExtremes(y, s[2], s[4], s[6]));
        [x, y] = [s[5], s[6]];
      } else {
        add([s[1]], [s[2]]);
        [x, y] = [s[1], s[2]];
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The ink's bounding box on the artboard (the outer edge of the O), rounded
 * outward to 0.01: about 414 × 317 units, wider than tall by 1.31. Screens
 * and print place the emblem by this box, so its clear space is set by
 * whoever places it, not by the artboard's empty margins.
 */
export const MONOGRAM_BOUNDS: Readonly<MonogramBox> = (() => {
  const b = pathBounds(MONOGRAM_PATHS);
  // Outward to 0.01, past the float noise of the sums (42.9 + 414.42 is not exactly 457.32).
  const down = (v: number) => Math.floor(v * 100 + 1e-6) / 100;
  const up = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;
  const [x, y] = [down(b.x), down(b.y)];
  return Object.freeze({ x, y, w: up(b.x + b.w - x), h: up(b.y + b.h - y) });
})();

/** Height of the emblem drawn `width` wide (same units). */
export function monogramHeight(width: number): number {
  return (width * MONOGRAM_BOUNDS.h) / MONOGRAM_BOUNDS.w;
}

/** Fixed-precision number: 3 decimals, no trailing zeros, never "-0". */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`non-finite coordinate ${n}`);
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * The five outlines placed with the top-left corner of their ink box at
 * (x, y) and `width` wide, as absolute path data (M, L, C, Z only, three
 * decimals): what a renderer without transforms, such as the certificate
 * card's flat fills, draws. Absolute coordinates, so rounding never
 * accumulates along a contour.
 */
export function monogramPathData(place: { x: number; y: number; width: number }): string[] {
  if (!(place.width > 0)) throw new RangeError('monogram: width must be positive');
  const k = place.width / MONOGRAM_BOUNDS.w;
  const X = (v: number) => fmt(place.x + (v - MONOGRAM_BOUNDS.x) * k);
  const Y = (v: number) => fmt(place.y + (v - MONOGRAM_BOUNDS.y) * k);
  return MONOGRAM_PATHS.map((d) =>
    absoluteSegments(d)
      .map((s) => {
        if (s[0] === 'Z') return 'Z';
        if (s[0] === 'C') return `C${X(s[1])} ${Y(s[2])} ${X(s[3])} ${Y(s[4])} ${X(s[5])} ${Y(s[6])}`;
        return `${s[0]}${X(s[1])} ${Y(s[2])}`;
      })
      .join(''),
  );
}
