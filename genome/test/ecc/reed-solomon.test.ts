import { describe, expect, it } from 'vitest';
import { CODE01 } from '../../src/core/code/profile.js';
import { rsDecode, rsEncode, type RsDecodeResult } from '../../src/core/ecc/reed-solomon.js';

const CODE01_K = CODE01.ecc.dataBytes; // 79
const CODE01_NSYM = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes; // 85
const CODE01_T = Math.floor(CODE01_NSYM / 2); // 42

// ── Deterministic randomness ───────────────────────────────────────────────

/** mulberry32: small, fast, seedable; every test owns its own stream. */
function prng(seed: number): { int(maxExclusive: number): number; bytes(length: number): Uint8Array } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    int: (maxExclusive) => next() % maxExclusive,
    bytes: (length) => Uint8Array.from({ length }, () => next() & 0xff),
  };
}

type Rng = ReturnType<typeof prng>;

/** `count` distinct positions in [0, n), ascending (partial Fisher-Yates). */
function pickPositions(rng: Rng, n: number, count: number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + rng.int(n - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((x, y) => x - y);
}

/** XOR a non-zero value into each position, so every listed byte really changes. */
function corrupt(rng: Rng, word: Uint8Array, positions: readonly number[]): Uint8Array {
  const out = word.slice();
  for (const p of positions) out[p] ^= 1 + rng.int(255);
  return out;
}

/** Random (k, nsym) with k ≥ 1, nsym ≥ 1, k + nsym ≤ 255. */
function randomShape(rng: Rng): { k: number; nsym: number } {
  const n = 2 + rng.int(254);
  const nsym = 1 + rng.int(n - 1);
  return { k: n - nsym, nsym };
}

// ── Independent reference (bit-serial field arithmetic, long division) ─────

function refMul(a: number, b: number): number {
  let product = 0;
  for (let x = a, y = b; y !== 0; y >>= 1) {
    if (y & 1) product ^= x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return product;
}

function refPow2(e: number): number {
  let v = 1;
  for (let i = 0; i < e; i++) v = refMul(v, 2);
  return v;
}

/** Parity by schoolbook long division of data·x^nsym by ∏(x − α^i). */
function referenceParity(data: Uint8Array, nsym: number): Uint8Array {
  let gen = [1];
  for (let i = 0; i < nsym; i++) {
    const root = refPow2(i);
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((c, j) => {
      next[j] ^= c;
      next[j + 1] ^= refMul(c, root);
    });
    gen = next;
  }
  const rem = [...data, ...new Array<number>(nsym).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = rem[i];
    if (coef !== 0) for (let j = 0; j < gen.length; j++) rem[i + j] ^= refMul(gen[j], coef);
  }
  return Uint8Array.from(rem.slice(data.length));
}

/** Evaluate the received polynomial (first byte = highest degree) at α^j. */
function refSyndrome(word: Uint8Array, j: number): number {
  const x = refPow2(j);
  return word.reduce((acc, byte) => refMul(acc, x) ^ byte, 0);
}

// ── Assertions ─────────────────────────────────────────────────────────────

function expectDecoded(
  result: RsDecodeResult,
  original: Uint8Array,
  nsym: number,
  expected: { errors: number; erasures: number; positions: number[] },
): void {
  if (!result.ok) expect.fail(`decode failed: ${result.reason}`);
  expect(result.codeword).toEqual(original);
  expect(result.data).toEqual(original.subarray(0, original.length - nsym));
  expect({ errors: result.errors, erasures: result.erasures, positions: result.positions }).toEqual(expected);
}

/** The safety property: whatever happens, never hand back a non-codeword. */
function expectCodewordIfOk(result: RsDecodeResult, nsym: number): void {
  if (!result.ok) return;
  expect(rsEncode(result.data, nsym)).toEqual(result.codeword);
  expect(2 * result.errors + result.erasures).toBeLessThanOrEqual(nsym);
}

// ── Encoder ────────────────────────────────────────────────────────────────

describe('rsEncode', () => {
  it('matches the published QR "HELLO WORLD" 1-M example', () => {
    const data = Uint8Array.from([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
    const codeword = rsEncode(data, 10);
    expect(codeword).toHaveLength(26);
    expect(codeword.subarray(0, 16)).toEqual(data);
    expect([...codeword.subarray(16)]).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('matches the ISO/IEC 18004 "01234567" 1-M example', () => {
    const data = Uint8Array.from([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]);
    expect([...rsEncode(data, 10).subarray(16)]).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });

  it('matches an independent long-division reference on random shapes, CODE-01 and n = 255', () => {
    const rng = prng(1);
    const shapes = [
      { k: CODE01_K, nsym: CODE01_NSYM },
      { k: 223, nsym: 32 },
      { k: 1, nsym: 254 },
      { k: 254, nsym: 1 },
      ...Array.from({ length: 40 }, () => randomShape(rng)),
    ];
    for (const { k, nsym } of shapes) {
      const data = rng.bytes(k);
      const codeword = rsEncode(data, nsym);
      expect(codeword.subarray(0, k)).toEqual(data);
      expect(codeword.subarray(k)).toEqual(referenceParity(data, nsym));
    }
  });

  it('produces words that vanish at the generator roots α^0 … α^(nsym−1)', () => {
    const rng = prng(2);
    for (let trial = 0; trial < 20; trial++) {
      const { k, nsym } = randomShape(rng);
      const codeword = rsEncode(rng.bytes(k), nsym);
      for (let j = 0; j < nsym; j++) expect(refSyndrome(codeword, j)).toBe(0);
    }
  });

  it('does not modify its input', () => {
    const data = prng(3).bytes(CODE01_K);
    const copy = data.slice();
    rsEncode(data, CODE01_NSYM);
    expect(data).toEqual(copy);
  });

  it('throws RangeError on impossible shapes', () => {
    const data = new Uint8Array(10);
    for (const nsym of [0, -1, 1.5, Number.NaN, 246]) expect(() => rsEncode(data, nsym)).toThrow(RangeError);
    expect(() => rsEncode(new Uint8Array(0), 4)).toThrow(RangeError);
  });
});

// ── Decoder: within capacity ───────────────────────────────────────────────

describe('rsDecode within capacity (2·errors + erasures ≤ nsym)', () => {
  it('returns an intact codeword unchanged', () => {
    const codeword = rsEncode(prng(10).bytes(CODE01_K), CODE01_NSYM);
    expectDecoded(rsDecode(codeword, CODE01_NSYM), codeword, CODE01_NSYM, { errors: 0, erasures: 0, positions: [] });
  });

  it('corrects exactly t = ⌊nsym/2⌋ random errors on 300 random shapes', () => {
    const rng = prng(11);
    for (let trial = 0; trial < 300; trial++) {
      const { k, nsym } = randomShape(rng);
      const codeword = rsEncode(rng.bytes(k), nsym);
      const t = Math.floor(nsym / 2);
      const positions = pickPositions(rng, k + nsym, t);
      const received = corrupt(rng, codeword, positions);
      expectDecoded(rsDecode(received, nsym), codeword, nsym, { errors: t, erasures: 0, positions });
    }
  });

  it(`corrects ${CODE01_T} random errors in CODE-01 RS(${CODE01.ecc.totalBytes},${CODE01_K}) (300 trials)`, () => {
    const rng = prng(12);
    for (let trial = 0; trial < 300; trial++) {
      const codeword = rsEncode(rng.bytes(CODE01_K), CODE01_NSYM);
      const positions = pickPositions(rng, codeword.length, CODE01_T);
      const received = corrupt(rng, codeword, positions);
      expectDecoded(rsDecode(received, CODE01_NSYM), codeword, CODE01_NSYM, {
        errors: CODE01_T,
        erasures: 0,
        positions,
      });
    }
  });

  it('corrects up to nsym erasures with no errors', () => {
    const rng = prng(13);
    const shapes = [{ k: CODE01_K, nsym: CODE01_NSYM }, ...Array.from({ length: 150 }, () => randomShape(rng))];
    for (const { k, nsym } of shapes) {
      const codeword = rsEncode(rng.bytes(k), nsym);
      const erased = pickPositions(rng, k + nsym, 1 + rng.int(nsym));
      // Erased bytes get arbitrary values; some may coincide with the truth.
      const received = codeword.slice();
      for (const p of erased) received[p] = rng.int(256);
      const changed = erased.filter((p) => received[p] !== codeword[p]);
      expectDecoded(rsDecode(received, nsym, erased), codeword, nsym, {
        errors: 0,
        erasures: erased.length,
        positions: changed,
      });
    }
  });

  it('corrects mixed errors and erasures whenever 2e + f ≤ nsym', () => {
    const rng = prng(14);
    const cases: { k: number; nsym: number; e?: number; f?: number }[] = [
      { k: CODE01_K, nsym: CODE01_NSYM, e: 42, f: 1 },
      { k: CODE01_K, nsym: CODE01_NSYM, e: 30, f: 25 },
      { k: CODE01_K, nsym: CODE01_NSYM, e: 1, f: 83 },
      { k: CODE01_K, nsym: CODE01_NSYM, e: 0, f: 85 },
      ...Array.from({ length: 300 }, () => randomShape(rng)),
    ];
    for (const c of cases) {
      const n = c.k + c.nsym;
      const e = c.e ?? rng.int(Math.floor(c.nsym / 2) + 1);
      const f = c.f ?? rng.int(c.nsym - 2 * e + 1);
      const codeword = rsEncode(rng.bytes(c.k), c.nsym);
      const touched = pickPositions(rng, n, e + f);
      // Shuffle the roles so erasures and errors interleave across the word.
      const roles = pickPositions(rng, e + f, f);
      const erased = roles.map((i) => touched[i]);
      const errorPositions = touched.filter((p) => !erased.includes(p));
      const received = corrupt(rng, codeword, errorPositions);
      for (const p of erased) received[p] = rng.int(256);
      const changed = touched.filter((p) => received[p] !== codeword[p]);
      expectDecoded(rsDecode(received, c.nsym, erased), codeword, c.nsym, {
        errors: e,
        erasures: f,
        positions: changed,
      });
    }
  });

  it('handles errors at the extremities, in data only and in parity only', () => {
    const rng = prng(15);
    const n = CODE01.ecc.totalBytes;
    const codeword = rsEncode(rng.bytes(CODE01_K), CODE01_NSYM);
    const layouts = [
      [0, n - 1],
      Array.from({ length: CODE01_T }, (_, i) => i), // first 42 bytes (data)
      Array.from({ length: CODE01_T }, (_, i) => n - CODE01_T + i), // last 42 bytes (parity)
    ];
    for (const positions of layouts) {
      const received = corrupt(rng, codeword, positions);
      expectDecoded(rsDecode(received, CODE01_NSYM), codeword, CODE01_NSYM, {
        errors: positions.length,
        erasures: 0,
        positions,
      });
    }
  });

  it('works at full length n = 255', () => {
    const rng = prng(16);
    for (const nsym of [1, 2, 32, 100, 254]) {
      const codeword = rsEncode(rng.bytes(255 - nsym), nsym);
      const positions = pickPositions(rng, 255, Math.floor(nsym / 2));
      const received = corrupt(rng, codeword, positions);
      expectDecoded(rsDecode(received, nsym), codeword, nsym, {
        errors: positions.length,
        erasures: 0,
        positions,
      });
    }
  });

  it('dedupes erasure positions and accepts them in any order', () => {
    const rng = prng(17);
    const codeword = rsEncode(rng.bytes(20), 6);
    const received = codeword.slice();
    received[3] ^= 0x55;
    received[17] ^= 0x01;
    received[8] ^= 0xff; // unflagged error
    const result = rsDecode(received, 6, [17, 3, 17, 3, 3, 12]);
    // 3 distinct erasures (12 is correct as received) + 1 error: 2·1 + 3 ≤ 6.
    expectDecoded(result, codeword, 6, { errors: 1, erasures: 3, positions: [3, 8, 17] });
  });

  it('never modifies the received word or the erasure list', () => {
    const rng = prng(18);
    const codeword = rsEncode(rng.bytes(CODE01_K), CODE01_NSYM);
    const received = corrupt(rng, codeword, pickPositions(rng, codeword.length, 20));
    const snapshot = received.slice();
    const erasures = Object.freeze([5, 9, 5]);
    const result = rsDecode(received, CODE01_NSYM, erasures);
    expect(result.ok).toBe(true);
    expect(received).toEqual(snapshot);
    expect(erasures).toEqual([5, 9, 5]);
  });
});

// ── Decoder: beyond capacity ───────────────────────────────────────────────

describe('rsDecode beyond capacity', () => {
  it('is an exact bounded-distance decoder for t = 1 (brute-force oracle)', () => {
    // For nsym = 2 the decoder must succeed iff some codeword lies within
    // Hamming distance 1 of the received word, and must return that codeword.
    const rng = prng(20);
    const k = 10;
    const nsym = 2;
    const n = k + nsym;
    const isCodeword = (w: Uint8Array): boolean => refSyndrome(w, 0) === 0 && refSyndrome(w, 1) === 0;
    let successes = 0;
    let failures = 0;
    for (let trial = 0; trial < 300; trial++) {
      const base = rsEncode(rng.bytes(k), nsym);
      const received = corrupt(rng, base, pickPositions(rng, n, trial % 3)); // 0, 1 or 2 errors
      let oracle: Uint8Array | null = isCodeword(received) ? received : null;
      for (let p = 0; p < n && oracle === null; p++) {
        for (let delta = 1; delta < 256 && oracle === null; delta++) {
          const candidate = received.slice();
          candidate[p] ^= delta;
          if (isCodeword(candidate)) oracle = candidate;
        }
      }
      const result = rsDecode(received, nsym);
      if (oracle === null) {
        expect(result).toEqual({ ok: false, reason: 'TOO_MANY_ERRORS' });
        failures++;
      } else {
        if (!result.ok) expect.fail(`trial ${trial}: oracle found a codeword, decoder failed`);
        expect(result.codeword).toEqual(oracle);
        successes++;
      }
    }
    expect(successes).toBeGreaterThan(0);
    expect(failures).toBeGreaterThan(0);
  });

  it('never returns a non-codeword on small codes, where miscorrections are frequent', () => {
    const rng = prng(21);
    let miscorrections = 0;
    let trials = 0;
    for (let nsym = 1; nsym <= 8; nsym++) {
      for (let trial = 0; trial < 400; trial++) {
        const k = 1 + rng.int(30);
        const n = k + nsym;
        const codeword = rsEncode(rng.bytes(k), nsym);
        const e = Math.min(n, Math.floor(nsym / 2) + 1 + rng.int(4));
        const received = corrupt(rng, codeword, pickPositions(rng, n, e));
        const result = rsDecode(received, nsym);
        expectCodewordIfOk(result, nsym);
        trials++;
        if (result.ok) miscorrections++;
      }
    }
    // The property above is only meaningful if miscorrections actually occurred.
    expect(miscorrections).toBeGreaterThan(0);
    console.info(`small codes (nsym 1..8): ${miscorrections}/${trials} beyond-capacity reads landed on another codeword`);
  });

  it(`reports failure for CODE-01 beyond ${CODE01_T} errors (empirical miscorrection rate)`, () => {
    // A random word lies within distance 42 of some RS(164,79) codeword with
    // probability ≈ C(164,42)·255^42 / 256^85 ≈ 2^−210, so any miscorrection
    // observed here would indicate a decoder bug rather than bad luck.
    const rng = prng(22);
    const trials = 2000;
    let miscorrections = 0;
    for (let trial = 0; trial < trials; trial++) {
      const codeword = rsEncode(rng.bytes(CODE01_K), CODE01_NSYM);
      const e = CODE01_T + 1 + rng.int(CODE01.ecc.totalBytes - CODE01_T);
      const received = corrupt(rng, codeword, pickPositions(rng, codeword.length, e));
      const result = rsDecode(received, CODE01_NSYM);
      expectCodewordIfOk(result, CODE01_NSYM);
      if (result.ok) miscorrections++;
      else expect(result.reason).toBe('TOO_MANY_ERRORS');
    }
    console.info(`RS(164,79) beyond capacity (43..164 errors): ${miscorrections}/${trials} miscorrections`);
    expect(miscorrections).toBe(0);
  });

  it('rejects one symbol beyond capacity in mixed errors/erasures (2e + f = nsym + 1)', () => {
    const rng = prng(23);
    for (let trial = 0; trial < 200; trial++) {
      const f = 1 + 2 * rng.int(43); // odd, so (nsym + 1 − f) is even
      const e = (CODE01_NSYM + 1 - f) / 2;
      const codeword = rsEncode(rng.bytes(CODE01_K), CODE01_NSYM);
      const touched = pickPositions(rng, codeword.length, e + f);
      const erased = touched.slice(0, f);
      const received = corrupt(rng, codeword, touched); // every touched byte really differs
      const result = rsDecode(received, CODE01_NSYM, erased);
      expectCodewordIfOk(result, CODE01_NSYM);
      expect(result.ok).toBe(false);
    }
  });

  it('fails cleanly with more erasures than parity bytes', () => {
    const codeword = rsEncode(new Uint8Array(10), 4);
    expect(rsDecode(codeword, 4, [0, 1, 2, 3, 4])).toEqual({ ok: false, reason: 'TOO_MANY_ERRORS' });
  });

  it('never throws on arbitrary bytes and erasure lists', () => {
    const rng = prng(24);
    for (let trial = 0; trial < 1000; trial++) {
      const { k, nsym } = randomShape(rng);
      const n = k + nsym;
      const received = rng.bytes(n);
      const erasures = Array.from({ length: rng.int(nsym + 3) }, () => rng.int(n));
      const result = rsDecode(received, nsym, erasures);
      expectCodewordIfOk(result, nsym);
    }
  });
});

// ── Decoder: misuse ────────────────────────────────────────────────────────

describe('rsDecode input validation', () => {
  const invalid = { ok: false, reason: 'INVALID_INPUT' };
  const word = rsEncode(new Uint8Array(12), 8);

  it.each([0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 20, 21])('rejects nsym = %s', (nsym) => {
    expect(rsDecode(word, nsym)).toEqual(invalid);
  });

  it('rejects codewords longer than 255 bytes', () => {
    expect(rsDecode(new Uint8Array(256), 10)).toEqual(invalid);
  });

  it.each([[[-1]], [[20]], [[1.5]], [[Number.NaN]], [[0, 3, 99]]])('rejects erasure list %j', (erasures) => {
    expect(rsDecode(word, 8, erasures)).toEqual(invalid);
  });
});

// ── Performance ────────────────────────────────────────────────────────────

describe('rsDecode performance', () => {
  it(`decodes RS(164,79) with ${CODE01_T} errors in well under 5 ms on average`, () => {
    const rng = prng(30);
    const inputs = Array.from({ length: 200 }, () => {
      const codeword = rsEncode(rng.bytes(CODE01_K), CODE01_NSYM);
      return corrupt(rng, codeword, pickPositions(rng, codeword.length, CODE01_T));
    });
    for (const received of inputs.slice(0, 20)) rsDecode(received, CODE01_NSYM); // JIT warm-up
    const start = performance.now();
    for (const received of inputs) {
      if (!rsDecode(received, CODE01_NSYM).ok) expect.fail('decode failed');
    }
    const averageMs = (performance.now() - start) / inputs.length;
    console.info(`RS(164,79) decode with ${CODE01_T} errors: ${averageMs.toFixed(3)} ms average`);
    expect(averageMs).toBeLessThan(5);
  });
});
