/**
 * Seeded pseudo-random numbers for deterministic tests and simulations.
 *
 * Generator: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator,
 * PractRand-clean, period ≥ 2^32) seeded through splitmix32, so that nearby
 * seeds (0, 1, 2, …) still produce unrelated streams. Never use Math.random in
 * tests: every random choice must be reproducible from a seed.
 */

/** 32-bit finaliser from MurmurHash3: a cheap bijective avalanche on u32. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Combine seeds and labels into one u32 seed (FNV-1a over the parts, then
 * avalanched). Used to derive independent, stable sub-streams, e.g.
 * `hashSeed(seed, 'noise')`.
 */
export function hashSeed(...parts: readonly (number | string)[]): number {
  let h = 0x811c9dc5;
  const mix = (byte: number): void => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const part of parts) {
    // A type tag keeps 1 and '1' apart; the length prefix keeps ('ab','c') and ('a','bc') apart.
    const text = (typeof part === 'number' ? 'n' : 's') + String(part);
    mix(text.length);
    mix(text.length >>> 8);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      mix(c);
      mix(c >>> 8);
    }
  }
  return fmix32(h);
}

/**
 * Standard normal quantile Φ⁻¹(p) for p in (0, 1), by Acklam's rational
 * approximation (relative error < 1.2e-9).
 */
export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`p must be in (0, 1), got ${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number): number =>
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export class Prng {
  /** u32 seed this generator was built from (used by `fork`). */
  readonly seed: number;
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spareNormal: number | null = null;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff
      ? seed
      : hashSeed(seed);
    // splitmix32 expands the seed into the four state words.
    let x = this.seed;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      return fmix32(x);
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.u32(); // standard sfc32 warm-up
  }

  /** Uniform u32. */
  u32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.u32() / 0x1_0000_0000;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** Gaussian sample (Box–Muller; the second value of each pair is cached). */
  normal(mean = 0, sd = 1): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mean + sd * z;
    }
    const r = Math.sqrt(-2 * Math.log(1 - this.float())); // 1 − u ∈ (0, 1]: log never sees 0
    const theta = 2 * Math.PI * this.float();
    this.spareNormal = r * Math.sin(theta);
    return mean + sd * r * Math.cos(theta);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Uniformly chosen element. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() from an empty list');
    return items[Math.floor(this.float() * items.length)];
  }

  /**
   * Independent child stream identified by `label`. It depends only on this
   * generator's seed and the label, never on how many values were drawn, so
   * adding a random feature does not reshuffle the others.
   */
  fork(label: string): Prng {
    return new Prng(hashSeed(this.seed, label));
  }
}
