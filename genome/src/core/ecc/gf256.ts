/**
 * Arithmetic in GF(2^8) built on the primitive polynomial
 * x^8 + x^4 + x^3 + x^2 + 1 (0x11D) with generator α = 2: the field used by
 * QR Code and Data Matrix, so their published test vectors apply unchanged.
 *
 * Elements are integers 0..255. Addition and subtraction are XOR. Products go
 * through exp/log tables; the exp table is doubled (510 entries used) so that
 * log(a) + log(b) ≤ 508 indexes it directly with no modulo in the hot path.
 * Operands are not range-checked: callers pass bytes.
 */

export const GF256_PRIMITIVE_POLY = 0x11d;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= GF256_PRIMITIVE_POLY;
  }
  for (let i = 255; i < EXP.length; i++) EXP[i] = EXP[i - 255];
}

/** α^e for any integer exponent; negative exponents give inverses (α^255 = 1). */
export function gfExp(e: number): number {
  const r = e % 255;
  return EXP[r < 0 ? r + 255 : r];
}

/** Discrete logarithm base α, in 0..254. Throws RangeError for 0. */
export function gfLog(a: number): number {
  if (a === 0) throw new RangeError('log(0) is undefined in GF(256)');
  return LOG[a];
}

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** a / b. Throws RangeError when b = 0. */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('division by zero in GF(256)');
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
}

/** Multiplicative inverse. Throws RangeError for 0. */
export function gfInv(a: number): number {
  if (a === 0) throw new RangeError('0 has no inverse in GF(256)');
  return EXP[255 - LOG[a]];
}
