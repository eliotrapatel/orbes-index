/**
 * BCH(15,5) protection of the 5-bit CODE-01 format value, built exactly like
 * QR Code format information: value ‖ remainder(value·x^10 mod 0x537), XORed
 * with 0x5412 so that no valid format word is all-zero (a blank or fully inked
 * ring therefore never reads as valid format information).
 *
 * The code has minimum distance 7: up to 3 bit errors are always corrected,
 * and a caller can judge reliability from the distance to the best and the
 * second-best codeword.
 */

export const FORMAT_GENERATOR = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
export const FORMAT_XOR_MASK = 0x5412;

const VALUE_COUNT = 32;
const WORD_MASK = 0x7fff;

/** Remainder of value·x^10 divided by the generator (10 bits). */
function bchRemainder(value5: number): number {
  let r = value5 << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if (r & (1 << bit)) r ^= FORMAT_GENERATOR << (bit - 10);
  }
  return r;
}

const FORMAT_WORDS: readonly number[] = Array.from(
  { length: VALUE_COUNT },
  (_, v) => ((v << 10) | bchRemainder(v)) ^ FORMAT_XOR_MASK,
);

function popcount15(x: number): number {
  let count = 0;
  for (let w = x; w !== 0; w &= w - 1) count++;
  return count;
}

/** 15-bit masked format word for a value 0..31. Throws RangeError otherwise. */
export function bchFormatEncode(value5: number): number {
  if (!Number.isInteger(value5) || value5 < 0 || value5 >= VALUE_COUNT) {
    throw new RangeError(`format value ${value5} is not an integer in 0..31`);
  }
  return FORMAT_WORDS[value5];
}

/**
 * Nearest-codeword decoding by exhaustive comparison with all 32 words.
 * `distance` is the Hamming distance to the chosen word and `secondDistance`
 * the distance to the runner-up; equal values mean the read is ambiguous (ties
 * resolve to the lowest value, deterministically). Throws RangeError unless
 * `word15` is an integer in 0..0x7FFF.
 */
export function bchFormatDecode(word15: number): { value: number; distance: number; secondDistance: number } {
  if (!Number.isInteger(word15) || word15 < 0 || word15 > WORD_MASK) {
    throw new RangeError(`format word ${word15} is not a 15-bit integer`);
  }
  let value = 0;
  let distance = Infinity;
  let secondDistance = Infinity;
  for (let v = 0; v < VALUE_COUNT; v++) {
    const d = popcount15(word15 ^ FORMAT_WORDS[v]);
    if (d < distance) {
      secondDistance = distance;
      distance = d;
      value = v;
    } else if (d < secondDistance) {
      secondDistance = d;
    }
  }
  return { value, distance, secondDistance };
}
