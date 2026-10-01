import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { TAU, angleOf, deg, type Primitive } from '../../src/core/geometry.js';
import { primitiveToPathData, primitivesToSvg } from '../../src/core/render/svg.js';

const SCALE = 100; // raster pixels per unit
const SIDE = 400; // raster side in pixels, centred on the origin

/** Ink coverage (0..1 per pixel) of path data rendered with resvg on a 4 × 4 unit canvas centred on 0. */
function rasterize(d: string, fillRule: 'nonzero' | 'evenodd' = 'nonzero'): Float64Array {
  const half = SIDE / SCALE / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${2 * half} ${2 * half}" width="${SIDE}" height="${SIDE}">` +
    `<path fill="#000" fill-rule="${fillRule}" d="${d}"/></svg>`;
  const rgba = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;
  const ink = new Float64Array(SIDE * SIDE);
  for (let i = 0; i < ink.length; i++) ink[i] = rgba[4 * i + 3] / 255;
  return ink;
}

const coverage = (ink: Float64Array): number => ink.reduce((s, v) => s + v, 0) / (SCALE * SCALE);

/** Unit-plane coordinates of a pixel centre. */
function pixelPoint(i: number): { x: number; y: number } {
  return { x: ((i % SIDE) + 0.5) / SCALE - SIDE / SCALE / 2, y: (Math.floor(i / SIDE) + 0.5) / SCALE - SIDE / SCALE / 2 };
}

const base = { layer: 'data' as const, cx: 0, cy: 0 };

function lensArea(r: number, d: number): number {
  return 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
}

describe('primitiveToPathData', () => {
  it('emits fixed-precision, clockwise outlines split into ≤ 90° arcs', () => {
    expect(primitiveToPathData({ ...base, kind: 'disc', r: 1 })).toBe('M0 -1A1 1 0 0 1 1 0A1 1 0 0 1 0 1A1 1 0 0 1 -1 0A1 1 0 0 1 0 -1Z');
    expect(primitiveToPathData({ ...base, kind: 'disc', cx: 1 / 3, cy: -2 / 3, r: 0.1234567 })).toBe(
      'M0.333 -0.79A0.123 0.123 0 0 1 0.457 -0.667A0.123 0.123 0 0 1 0.333 -0.543A0.123 0.123 0 0 1 0.21 -0.667A0.123 0.123 0 0 1 0.333 -0.79Z',
    );
  });

  it('never prints more than 3 decimals or a negative zero', () => {
    const shapes: Primitive[] = [
      { ...base, kind: 'arc', r: 1.2345678, width: 0.3, start: 0.1, end: 4.9, cap: 'round' },
      { ...base, kind: 'crescent', r: 1, offset: 0.6, angle: deg(33) },
      { ...base, kind: 'halfDisc', r: 0.987654, angle: deg(270) },
    ];
    for (const p of shapes) {
      const numbers = primitiveToPathData(p).match(/-?\d+(\.\d+)?/g) ?? [];
      for (const n of numbers) {
        expect(n).not.toBe('-0');
        expect(n.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
      }
    }
  });

  it('covers the analytic area of every primitive kind within 2 %', () => {
    const r = 1.4;
    const w = 0.4;
    const span = deg(200);
    const inset = Math.asin(w / 2 / r);
    const cases: [Primitive, number][] = [
      [{ ...base, kind: 'disc', r }, Math.PI * r * r],
      [{ ...base, kind: 'ring', r, width: w }, TAU * r * w],
      [{ ...base, kind: 'arc', r, width: w, start: deg(30), end: deg(30) + span, cap: 'butt' }, span * r * w],
      [
        { ...base, kind: 'arc', r, width: w, start: deg(30), end: deg(30) + span, cap: 'round' },
        (span - 2 * inset) * r * w + Math.PI * (w / 2) ** 2,
      ],
      [{ ...base, kind: 'arc', r, width: w, start: 0, end: TAU - 0.01, cap: 'butt' }, (TAU - 0.01) * r * w],
      [{ ...base, kind: 'arc', r: 0.8, width: 1.6, start: deg(10), end: deg(100), cap: 'butt' }, (deg(90) / 2) * 1.6 ** 2],
      [{ ...base, kind: 'halfDisc', r, angle: deg(60) }, (Math.PI * r * r) / 2],
      [{ ...base, kind: 'crescent', r, offset: 0.9, angle: deg(200) }, Math.PI * r * r - lensArea(r, 0.9)],
    ];
    for (const [p, area] of cases) {
      const measured = coverage(rasterize(primitiveToPathData(p)));
      expect(Math.abs(measured - area) / area, `${p.kind} ${JSON.stringify(p)}`).toBeLessThan(0.02);
    }
  });

  it('winds holes against outlines, so nonzero and evenodd fills agree', () => {
    const shapes: Primitive[] = [
      { ...base, kind: 'ring', r: 1, width: 0.3 },
      { ...base, kind: 'arc', r: 1, width: 0.3, start: 0, end: TAU, cap: 'round' },
      { ...base, kind: 'arc', r: 1, width: 0.5, start: deg(-40), end: deg(250), cap: 'round' },
      { ...base, kind: 'arc', r: 1, width: 0.5, start: deg(-40), end: deg(250), cap: 'butt' },
      { ...base, kind: 'crescent', r: 1.2, offset: 0.5, angle: deg(10) },
      { ...base, kind: 'halfDisc', r: 1.2, angle: deg(135) },
    ];
    for (const p of shapes) {
      const d = primitiveToPathData(p);
      expect(rasterize(d, 'nonzero')).toEqual(rasterize(d, 'evenodd'));
    }
  });

  it('keeps round caps inside the angular interval and reaches its bounds', () => {
    const r = 1.2;
    const w = 0.5;
    const start = deg(20);
    const end = deg(110);
    const ink = rasterize(primitiveToPathData({ ...base, kind: 'arc', r, width: w, start, end, cap: 'round' }));
    const tolerance = 1.5 / SCALE / (r - w / 2); // 1.5 px at the inner edge
    let maxAngle = -Infinity;
    let minAngle = Infinity;
    ink.forEach((v, i) => {
      if (v < 0.5) return;
      const { x, y } = pixelPoint(i);
      const a = angleOf(x, y);
      minAngle = Math.min(minAngle, a);
      maxAngle = Math.max(maxAngle, a);
    });
    expect(minAngle).toBeGreaterThan(start - tolerance);
    expect(maxAngle).toBeLessThan(end + tolerance);
    expect(minAngle).toBeLessThan(start + 2 * tolerance);
    expect(maxAngle).toBeGreaterThan(end - 2 * tolerance);
  });

  it('draws a full ring for an arc spanning a whole turn', () => {
    const ring = primitiveToPathData({ ...base, kind: 'ring', r: 1, width: 0.2 });
    expect(primitiveToPathData({ ...base, kind: 'arc', r: 1, width: 0.2, start: 1, end: 1 + TAU, cap: 'round' })).toBe(ring);
    expect(primitiveToPathData({ ...base, kind: 'arc', r: 1, width: 0.2, start: 0, end: TAU - 1e-12, cap: 'butt' })).toBe(ring);
  });

  it('shrinks an arc shorter than its caps to a centred dot that fits the interval', () => {
    const r = 1;
    const span = deg(8);
    const p: Primitive = { ...base, kind: 'arc', r, width: 0.4, start: deg(45), end: deg(45) + span, cap: 'round' };
    const dotRadius = r * Math.sin(span / 2);
    const measured = coverage(rasterize(primitiveToPathData(p)));
    expect(Math.abs(measured - Math.PI * dotRadius ** 2) / (Math.PI * dotRadius ** 2)).toBeLessThan(0.05);
    expect(primitiveToPathData(p)).toMatch(/^M[^M]*Z$/);
  });

  it('draws a ring whose band reaches the centre as a disc', () => {
    expect(primitiveToPathData({ ...base, kind: 'ring', r: 0.5, width: 1 })).toBe(primitiveToPathData({ ...base, kind: 'disc', r: 1 }));
  });

  it('rejects degenerate geometry', () => {
    const bad: Primitive[] = [
      { ...base, kind: 'disc', r: 0 },
      { ...base, kind: 'disc', r: Number.NaN },
      { ...base, kind: 'disc', cx: Number.POSITIVE_INFINITY, r: 1 },
      { ...base, kind: 'ring', r: 1, width: 0 },
      { ...base, kind: 'arc', r: 1, width: 0.2, start: 1, end: 1, cap: 'butt' },
      { ...base, kind: 'arc', r: 1, width: 2.1, start: 0, end: 1, cap: 'butt' },
      { ...base, kind: 'arc', r: 1, width: 2, start: 0, end: 1, cap: 'round' },
      { ...base, kind: 'crescent', r: 1, offset: 0, angle: 0 },
      { ...base, kind: 'crescent', r: 1, offset: 2, angle: 0 },
      { ...base, kind: 'halfDisc', r: 1, angle: Number.NaN },
    ];
    for (const p of bad) expect(() => primitiveToPathData(p), JSON.stringify(p)).toThrow(RangeError);
  });
});

describe('primitivesToSvg', () => {
  const viewBox = { x: -2, y: -2, w: 4, h: 4 };

  it('produces a stable document structure and attribute order', () => {
    const svg = primitivesToSvg(
      [
        { kind: 'disc', layer: 'seal', cx: 0, cy: 0, r: 1 },
        { kind: 'ring', layer: 'seal', cx: 0, cy: 0, r: 1.5, width: 0.2 },
        { kind: 'disc', layer: 'decor', cx: 1, cy: 1, r: 0.25, tone: 0.5 },
      ],
      viewBox,
      { widthMm: 20, title: 'A & B' },
    );
    expect(svg).toBe(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 4 4" width="20mm" height="20mm">',
        '<title>A &#38; B</title>',
        '<rect x="-2" y="-2" width="4" height="4" fill="#ffffff"/>',
        '<g fill="#000000">',
        '<g data-layer="seal">',
        `<path d="${primitiveToPathData({ kind: 'disc', layer: 'seal', cx: 0, cy: 0, r: 1 })}"/>`,
        `<path fill-rule="evenodd" d="${primitiveToPathData({ kind: 'ring', layer: 'seal', cx: 0, cy: 0, r: 1.5, width: 0.2 })}"/>`,
        '</g>',
        '<g data-layer="decor">',
        `<path fill="#808080" d="${primitiveToPathData({ kind: 'disc', layer: 'decor', cx: 1, cy: 1, r: 0.25 })}"/>`,
        '</g>',
        '</g>',
        '</svg>',
        '',
      ].join('\n'),
    );
  });

  it('is byte-for-byte deterministic (snapshot hash)', () => {
    const primitives: Primitive[] = [];
    for (let k = 0; k < 12; k++) {
      primitives.push({ kind: 'arc', layer: 'data', cx: 0, cy: 0, r: 1 + k * 0.07, width: 0.05, start: deg(k * 23), end: deg(k * 23 + 40 + k), cap: k % 2 ? 'round' : 'butt' });
    }
    primitives.push({ kind: 'crescent', layer: 'genome', cx: 0.2, cy: -0.1, r: 0.4, offset: 0.25, angle: deg(77) });
    primitives.push({ kind: 'halfDisc', layer: 'genome', cx: -0.3, cy: 0.4, r: 0.3, angle: deg(190) });
    const svg = primitivesToSvg(primitives, viewBox, { ink: '#111111', paper: '#f7f5f0', widthMm: 12.5 });
    expect(primitivesToSvg(primitives, viewBox, { ink: '#111111', paper: '#f7f5f0', widthMm: 12.5 })).toBe(svg);
    expect(createHash('sha256').update(svg).digest('hex')).toBe('775f8293321db5f38577842787de5dd6f380199432b3e3f88115cfa0c4eaca92');
  });

  it('pre-mixes reduced tones into opaque colours, or falls back to fill-opacity', () => {
    const toned: Primitive[] = [{ kind: 'disc', layer: 'decor', cx: 0, cy: 0, r: 1, tone: 0.25 }];
    expect(primitivesToSvg(toned, viewBox, { ink: '#000', paper: '#fff' })).toContain('<path fill="#bfbfbf" d=');
    expect(primitivesToSvg(toned, viewBox, { ink: '#102030', paper: '#f0e0d0' })).toContain('fill="#b8b0a8"');
    expect(primitivesToSvg(toned, viewBox, { paper: null })).toContain('<path fill-opacity="0.25" d=');
    expect(primitivesToSvg(toned, viewBox, { ink: 'black' })).toContain('fill-opacity="0.25"');
  });

  it('omits the background, decor and zero-tone primitives on request', () => {
    const primitives: Primitive[] = [
      { kind: 'disc', layer: 'data', cx: 0, cy: 0, r: 1 },
      { kind: 'disc', layer: 'decor', cx: 1, cy: 1, r: 0.2 },
      { kind: 'disc', layer: 'data', cx: -1, cy: 1, r: 0.2, tone: 0 },
    ];
    const svg = primitivesToSvg(primitives, viewBox, { paper: null, decor: false });
    expect(svg).not.toContain('<rect');
    expect(svg).not.toContain('decor');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).not.toContain('width="');
    expect(primitivesToSvg(primitives, viewBox).match(/<path /g)).toHaveLength(2);
  });

  it('keeps the viewBox aspect ratio in millimetre sizing', () => {
    expect(primitivesToSvg([], { x: 0, y: 0, w: 50, h: 25 }, { widthMm: 30 })).toContain('width="30mm" height="15mm"');
  });

  it('escapes user-provided strings', () => {
    const svg = primitivesToSvg([], viewBox, { title: '<script>"x"</script>', ink: '"/><script>', paper: "'" });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('<title>&#60;script&#62;&#34;x&#34;&#60;/script&#62;</title>');
  });

  it('rejects invalid tones and view boxes', () => {
    expect(() => primitivesToSvg([{ kind: 'disc', layer: 'decor', cx: 0, cy: 0, r: 1, tone: 1.5 }], viewBox)).toThrow(RangeError);
    expect(() => primitivesToSvg([], { x: 0, y: 0, w: 0, h: 1 })).toThrow(RangeError);
    expect(() => primitivesToSvg([], viewBox, { widthMm: -1 })).toThrow(RangeError);
  });

  it('renders identically to the analytic geometry through resvg', () => {
    const svg = primitivesToSvg([{ kind: 'ring', layer: 'seal', cx: 0, cy: 0, r: 1, width: 0.4 }], viewBox, { widthMm: 10 });
    const rgba = new Resvg(svg, { fitTo: { mode: 'width', value: 400 }, font: { loadSystemFonts: false } }).render().pixels;
    let ink = 0;
    for (let i = 0; i < rgba.length; i += 4) ink += 1 - rgba[i] / 255;
    const area = ink / (100 * 100);
    expect(Math.abs(area - TAU * 0.4) / (TAU * 0.4)).toBeLessThan(0.02);
  });
});
