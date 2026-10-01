import { describe, expect, it } from 'vitest';
import { hashSeed, inverseNormalCdf, Prng } from './prng.js';

const draw = (rng: Prng, n: number): number[] => Array.from({ length: n }, () => rng.u32());

describe('Prng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(draw(new Prng(42), 32)).toEqual(draw(new Prng(42), 32));
    expect(draw(new Prng('scan-matrix'), 32)).toEqual(draw(new Prng('scan-matrix'), 32));
    expect(draw(new Prng(1), 32)).not.toEqual(draw(new Prng(2), 32));
    expect(draw(new Prng(1), 32)).not.toEqual(draw(new Prng('1'), 32));
  });

  it('float() stays in [0, 1) with a uniform mean', () => {
    const rng = new Prng(7);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const x = rng.float();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20_000).toBeCloseTo(0.5, 1);
  });

  it('int(a, b) is inclusive on both ends and rejects bad ranges', () => {
    const rng = new Prng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = rng.int(-2, 3);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(rng.int(5, 5)).toBe(5);
    expect(() => rng.int(3, 2)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });

  it('normal() has the requested mean and standard deviation', () => {
    const rng = new Prng(11);
    const n = 40_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const z = rng.normal(10, 3);
      sum += z;
      sq += z * z;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(10, 1);
    expect(Math.sqrt(sq / n - mean * mean)).toBeCloseTo(3, 1);
  });

  it('pick() reaches every element and rejects empty lists', () => {
    const rng = new Prng(5);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set(Array.from({ length: 200 }, () => rng.pick(items)));
    expect(seen).toEqual(new Set(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('fork() depends only on the seed and label, not on prior draws', () => {
    const used = new Prng(9);
    draw(used, 100);
    expect(draw(used.fork('noise'), 8)).toEqual(draw(new Prng(9).fork('noise'), 8));
    expect(draw(new Prng(9).fork('noise'), 8)).not.toEqual(draw(new Prng(9).fork('glare'), 8));
  });
});

describe('hashSeed', () => {
  it('separates part boundaries and types', () => {
    expect(hashSeed('ab', 'c')).not.toBe(hashSeed('a', 'bc'));
    expect(hashSeed(1)).not.toBe(hashSeed('1'));
    expect(hashSeed(1.5)).not.toBe(hashSeed(1));
    expect(hashSeed(7, 'x')).toBe(hashSeed(7, 'x'));
    expect(hashSeed(7, 'x')).toBeGreaterThanOrEqual(0);
    expect(hashSeed(7, 'x')).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('inverseNormalCdf', () => {
  it('matches reference quantiles and is antisymmetric', () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 9);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 5);
    expect(inverseNormalCdf(0.001)).toBeCloseTo(-3.090232, 5);
    expect(inverseNormalCdf(0.8413447)).toBeCloseTo(1, 5);
    for (const p of [1e-6, 0.01, 0.2, 0.4]) expect(inverseNormalCdf(p)).toBeCloseTo(-inverseNormalCdf(1 - p), 6);
  });

  it('rejects probabilities outside (0, 1)', () => {
    for (const p of [0, 1, -0.1, Number.NaN]) expect(() => inverseNormalCdf(p)).toThrow(RangeError);
  });
});
