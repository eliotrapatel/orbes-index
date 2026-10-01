import { describe, expect, it } from 'vitest';
import { LABEL_CHARSET, measureText, STROKE_RATIO, textRun } from '../../src/server/render/label-font.js';

/** Endpoints of every M/L/A command in absolute path data. */
function endpoints(d: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /([MLA])([^MLAZ]*)/g;
  for (const m of d.matchAll(re)) {
    const n = m[2].trim().split(/[ ,]+/).map(Number);
    out.push([n[n.length - 2], n[n.length - 1]]);
  }
  return out;
}

describe('label lettering', () => {
  it('covers the characters of product ids, the brand line and sheet captions', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/· ') expect(LABEL_CHARSET.has(ch), ch).toBe(true);
  });

  it('draws every glyph inside its advance box, with arcs continuous from the pen', () => {
    for (const ch of LABEL_CHARSET) {
      if (ch === ' ') continue;
      const run = textRun(ch, { capHeight: 10, x: 0, baseline: 10, align: 'start' });
      expect(run.d.length, ch).toBeGreaterThan(0);
      for (const [x, y] of endpoints(run.d)) {
        expect(x, `${ch} x`).toBeGreaterThanOrEqual(-0.05);
        expect(x, `${ch} x`).toBeLessThanOrEqual(run.width + 0.05);
        expect(y, `${ch} y`).toBeGreaterThanOrEqual(-0.05);
        expect(y, `${ch} y`).toBeLessThanOrEqual(10.05);
      }
    }
  });

  it('measures, aligns and tracks consistently', () => {
    const cap = 2;
    const w = measureText('O26-J-00184', 0.32) * cap;
    const mid = textRun('O26-J-00184', { capHeight: cap, tracking: 0.32, x: 0, baseline: 0 });
    expect(mid.width).toBeCloseTo(w, 9);
    expect(mid.strokeWidth).toBeCloseTo(cap * STROKE_RATIO, 9);
    const xs = endpoints(mid.d).map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-w / 2 - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(w / 2 + 0.01);

    const start = textRun('AB', { capHeight: 1, x: 5, baseline: 0, align: 'start' });
    const end = textRun('AB', { capHeight: 1, x: 5, baseline: 0, align: 'end' });
    expect(Math.min(...endpoints(start.d).map(([x]) => x))).toBeCloseTo(5, 3);
    expect(Math.max(...endpoints(end.d).map(([x]) => x))).toBeLessThanOrEqual(5.001);
    expect(measureText('A', 1)).toBe(measureText('A', 0)); // tracking only between letters
    expect(measureText('AA', 1) - measureText('AA', 0)).toBeCloseTo(1, 9);
    expect(measureText('')).toBe(0);
  });

  it('uppercases input, is deterministic, and refuses unsupported characters', () => {
    const a = textRun('orbes', { capHeight: 1, x: 0, baseline: 1 });
    expect(a.d).toBe(textRun('ORBES', { capHeight: 1, x: 0, baseline: 1 }).d);
    expect(a.d).toMatch(/^[MLAZ0-9 .\-]+$/);
    expect(() => textRun('O26?', { capHeight: 1, x: 0, baseline: 1 })).toThrow(RangeError);
    expect(() => textRun('<script>', { capHeight: 1, x: 0, baseline: 1 })).toThrow(RangeError);
    expect(() => textRun('A', { capHeight: 0, x: 0, baseline: 1 })).toThrow(RangeError);
    expect(() => textRun('A', { capHeight: 1, tracking: -1, x: 0, baseline: 1 })).toThrow(RangeError);
  });

  it('splits arcs into pieces of at most 90° (no large-arc flags)', () => {
    const o = textRun('O', { capHeight: 10, x: 0, baseline: 10, align: 'start' });
    const arcs = o.d.match(/A[^MLAZ]*/g) ?? [];
    expect(arcs).toHaveLength(4);
    for (const a of arcs) expect(a).toMatch(/^A5 5 0 0 1 /);
  });
});
