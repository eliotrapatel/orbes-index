import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENOME01_GLYPHS,
  SUPPORTED_GENOME_VERSIONS,
  computeGenome,
  genomePermute,
  genomeUnpermute,
  genomeVocabulary,
  identityFromGenomeGlyphs,
} from '../../src/core/genome/index.js';

/** Packed identity (contract §3): yy:7 | category:5 | serial:20. */
const pack = (year: number, category: number, serial: number): number => (((year - 2000) << 25) | (category << 20) | serial) >>> 0;

/** Independent GENOME-01 reference, written from the specification with node:crypto. */
function referencePermute(x: number): number {
  let left = x >>> 16;
  let right = x & 0xffff;
  for (let i = 0; i < 8; i++) {
    const digest = createHash('sha256')
      .update(Buffer.concat([Buffer.from('ORBES/GENOME-01/F', 'utf8'), Buffer.from([i, right >>> 8, right & 0xff])]))
      .digest();
    [left, right] = [right, (left ^ ((digest[0] << 8) | digest[1])) & 0xffff];
  }
  return ((left << 16) | right) >>> 0;
}

function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

describe('genomePermute (GENOME-01)', () => {
  it('matches the frozen golden vectors', () => {
    const golden: [number, number][] = [
      [0x00000000, 0xa0aa3769],
      [0x00000001, 0xca0f5a33],
      [0x80000000, 0x77af8541],
      [0xffffffff, 0x58ffc8f9],
      [0x341000b8, 0xe1dcbe52],
      [0x341000b9, 0x75ae683e],
      [0x34a000b8, 0x45a4cdb2],
    ];
    for (const [x, y] of golden) {
      expect(genomePermute(x)).toBe(y);
      expect(genomeUnpermute(y)).toBe(x);
    }
  });

  it('matches an independent node:crypto implementation of the specification', () => {
    const next = xorshift32(0xc0ffee);
    for (let k = 0; k < 2000; k++) {
      const x = next();
      expect(genomePermute(x)).toBe(referencePermute(x));
    }
  });

  it('is injective on a contiguous 2^20 range (one year × category, every serial slot)', () => {
    const start = pack(2026, 1, 0);
    const n = 1 << 20;
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = genomePermute(start + i);
    out.sort();
    for (let i = 1; i < n; i++) if (out[i] === out[i - 1]) expect.fail(`collision on 0x${out[i].toString(16)}`);
  });

  it('round-trips 200 000 seeded random u32 values through its inverse', () => {
    const next = xorshift32(0x0b5e5);
    for (let k = 0; k < 200_000; k++) {
      const x = next();
      const y = genomePermute(x);
      if (genomeUnpermute(y) !== x) expect.fail(`round trip failed for 0x${x.toString(16)}`);
    }
  });

  it('scatters adjacent serials into unrelated genomes (avalanche)', () => {
    const start = pack(2026, 10, 1);
    const n = 20_000;
    let changed = 0;
    let previous = computeGenome(start).glyphs;
    for (let i = 1; i <= n; i++) {
      const glyphs = computeGenome(start + i).glyphs;
      changed += glyphs.filter((g, k) => g !== previous[k]).length;
      previous = glyphs;
    }
    // Required: ≥ 5 of 8 on average. Unrelated genomes differ in 8 × 15/16 = 7.5 glyphs.
    expect(changed / n).toBeGreaterThan(7.3);
  });

  it('uses every glyph uniformly at every position', () => {
    const counts = Array.from({ length: 8 }, () => new Array<number>(16).fill(0));
    const start = pack(2027, 3, 0);
    const n = 1 << 16;
    for (let i = 0; i < n; i++) computeGenome(start + i).glyphs.forEach((g, pos) => counts[pos][g]++);
    for (const position of counts) {
      for (const count of position) expect(Math.abs(count - n / 16)).toBeLessThan(0.06 * (n / 16));
    }
  });

  it('rejects anything but u32 integers', () => {
    for (const bad of [-1, 2 ** 32, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '7' as unknown as number]) {
      expect(() => genomePermute(bad)).toThrow(RangeError);
      expect(() => genomeUnpermute(bad)).toThrow(RangeError);
    }
  });
});

describe('computeGenome', () => {
  it('derives value, glyphs, ids and fingerprint deterministically', () => {
    const genome = computeGenome(0x341000b8);
    expect(genome).toEqual({
      version: 1,
      packedIdentity: 0x341000b8,
      value: 0xe1dcbe52,
      glyphs: [14, 1, 13, 12, 11, 14, 5, 2],
      ids: [
        'QUARTER_ORB_SW',
        'RING_POINT',
        'QUARTER_ORB_SE',
        'QUARTER_ORB_NE',
        'ARC_PAIR_NWSE',
        'QUARTER_ORB_SW',
        'HALF_ARC_E',
        'SMALL_ORBIT',
      ],
      fingerprint: 'G1-E1DC-BE52',
    });
    expect(computeGenome(0x341000b8, 1)).toEqual(genome);
    expect(computeGenome(0).fingerprint).toBe('G1-A0AA-3769');
    expect(computeGenome(1).fingerprint).toBe('G1-CA0F-5A33');
  });

  it('reads glyphs as nibbles, most significant first, and names them from the vocabulary', () => {
    const next = xorshift32(42);
    for (let k = 0; k < 500; k++) {
      const genome = computeGenome(next());
      expect(genome.glyphs).toHaveLength(8);
      expect(genome.glyphs.reduce((v, g) => (v << 4) | g, 0) >>> 0).toBe(genome.value);
      expect(genome.ids).toEqual(genome.glyphs.map((g) => GENOME01_GLYPHS[g].id));
      expect(genome.fingerprint).toMatch(/^G1-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(parseInt(genome.fingerprint.slice(3).replace('-', ''), 16)).toBe(genome.value);
    }
  });

  it('only accepts supported versions', () => {
    expect(SUPPORTED_GENOME_VERSIONS).toEqual([1]);
    expect(Object.isFrozen(SUPPORTED_GENOME_VERSIONS)).toBe(true);
    expect(genomeVocabulary(1)).toBe(GENOME01_GLYPHS);
    for (const version of [0, 2, 15, 1.5, Number.NaN]) {
      expect(() => computeGenome(1, version)).toThrow(RangeError);
      expect(() => identityFromGenomeGlyphs([0, 0, 0, 0, 0, 0, 0, 0], version)).toThrow(RangeError);
      expect(() => genomeVocabulary(version)).toThrow(RangeError);
    }
  });

  it('rejects identities that are not u32 integers', () => {
    expect(() => computeGenome(-1)).toThrow(RangeError);
    expect(() => computeGenome(2 ** 32)).toThrow(RangeError);
    expect(() => computeGenome(0.5)).toThrow(RangeError);
  });
});

describe('identityFromGenomeGlyphs', () => {
  it('inverts computeGenome', () => {
    const next = xorshift32(7);
    for (let k = 0; k < 5000; k++) {
      const packed = next();
      expect(identityFromGenomeGlyphs(computeGenome(packed).glyphs)).toBe(packed);
    }
    expect(identityFromGenomeGlyphs([14, 1, 13, 12, 11, 14, 5, 2])).toBe(pack(2026, 1, 184));
    expect(identityFromGenomeGlyphs([15, 15, 15, 15, 15, 15, 15, 15])).toBe(genomeUnpermute(0xffffffff));
  });

  it('rejects malformed glyph sequences', () => {
    const bad: number[][] = [[], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [16, 0, 0, 0, 0, 0, 0, 0], [0, -1, 0, 0, 0, 0, 0, 0], [0, 0, 1.5, 0, 0, 0, 0, 0], [0, 0, 0, Number.NaN, 0, 0, 0, 0]];
    for (const glyphs of bad) expect(() => identityFromGenomeGlyphs(glyphs), JSON.stringify(glyphs)).toThrow(RangeError);
  });
});
