/**
 * Reed-Solomon over GF(256) (0x11D, α = 2), shortened to any length n ≤ 255.
 *
 * Conventions (identical to QR Code, so its published vectors apply):
 *   - systematic: codeword = data ‖ parity, nsym parity bytes;
 *   - generator g(x) = ∏_{i=0}^{nsym−1} (x − α^i), i.e. first consecutive root 0;
 *   - byte j of an n-byte codeword is the coefficient of x^(n−1−j), so an error
 *     at byte j has locator X_j = α^(n−1−j).
 *
 * The decoder corrects errors and erasures (bytes known to be unreliable, e.g.
 * cells under glare) together and succeeds whenever 2·errors + erasures ≤ nsym:
 *   syndromes → erasure locator Γ → Berlekamp-Massey seeded with Γ → Chien
 *   search → Forney → syndromes recomputed on the corrected word.
 * That last check means a successful result is always a true codeword. Beyond
 * capacity the decoder either reports failure or, with very low probability for
 * large nsym, lands on a different valid codeword (miscorrection); higher
 * layers (CRC-16, Ed25519) exist to catch that case.
 */

import { gfDiv, gfExp, gfInv, gfMul } from './gf256.js';

export type RsDecodeResult =
  | {
      ok: true;
      /** Corrected codeword (a fresh copy, the input is never modified). */
      codeword: Uint8Array;
      /** First n − nsym bytes of `codeword` (a separate copy). */
      data: Uint8Array;
      /** Corrected bytes that were not flagged as erasures. */
      errors: number;
      /** Number of distinct erasure positions supplied. */
      erasures: number;
      /** Ascending byte indices whose value was changed (errors and erasures alike). */
      positions: number[];
    }
  | { ok: false; reason: 'TOO_MANY_ERRORS' | 'INVALID_INPUT' };

const MAX_CODEWORD_LENGTH = 255;

const INVALID_INPUT: RsDecodeResult = Object.freeze({ ok: false, reason: 'INVALID_INPUT' });
const TOO_MANY_ERRORS: RsDecodeResult = Object.freeze({ ok: false, reason: 'TOO_MANY_ERRORS' });

/** At least one data byte, at least one parity byte, n ≤ 255. */
function isValidShape(n: number, nsym: number): boolean {
  return Number.isInteger(nsym) && nsym >= 1 && n > nsym && n <= MAX_CODEWORD_LENGTH;
}

// ── Encoder ────────────────────────────────────────────────────────────────

const generatorCache = new Map<number, Uint8Array>();

/** g(x) for `nsym` parity bytes, monic, coefficients highest degree first. */
function generatorPoly(nsym: number): Uint8Array {
  const cached = generatorCache.get(nsym);
  if (cached) return cached;
  const g = new Uint8Array(nsym + 1);
  g[0] = 1;
  for (let i = 0; i < nsym; i++) {
    // Multiply the degree-i polynomial held in g[0..i] by (x + α^i), in place.
    // Walking downwards keeps g[j − 1] at its old value when g[j] is updated.
    const root = gfExp(i);
    for (let j = i + 1; j >= 1; j--) g[j] ^= gfMul(g[j - 1], root);
  }
  generatorCache.set(nsym, g);
  return g;
}

/**
 * Systematic encoding: returns data ‖ parity (data.length + nsym bytes).
 * Throws RangeError unless nsym ≥ 1, data.length ≥ 1 and the total is ≤ 255.
 */
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const n = data.length + nsym;
  if (!isValidShape(n, nsym)) {
    throw new RangeError(
      `invalid Reed-Solomon shape: ${data.length} data + ${nsym} parity bytes (need ≥ 1 each, total ≤ 255)`,
    );
  }
  const gen = generatorPoly(nsym);
  const out = new Uint8Array(n);
  out.set(data);
  // LFSR division of data(x)·x^nsym by g(x). The register IS the parity area,
  // highest-degree remainder coefficient first; x^nsym ≡ g(x) − x^nsym because
  // g is monic, hence the feedback taps gen[1..nsym].
  const parity = out.subarray(data.length);
  for (let i = 0; i < data.length; i++) {
    const feedback = data[i] ^ parity[0];
    parity.copyWithin(0, 1);
    parity[nsym - 1] = 0;
    if (feedback !== 0) {
      for (let j = 0; j < nsym; j++) parity[j] ^= gfMul(feedback, gen[j + 1]);
    }
  }
  return out;
}

// ── Decoder ────────────────────────────────────────────────────────────────
//
// Inside the decoder, polynomials are Uint8Arrays with the coefficient of x^i
// at index i (lowest degree first), which keeps BM and Forney index-aligned
// with the syndrome sequence.

/** S_j = r(α^j), j = 0..nsym−1, by Horner's rule over the received bytes. */
function syndromes(word: Uint8Array, nsym: number): Uint8Array {
  const s = new Uint8Array(nsym);
  for (let j = 0; j < nsym; j++) {
    const x = gfExp(j);
    let acc = 0;
    for (let i = 0; i < word.length; i++) acc = gfMul(acc, x) ^ word[i];
    s[j] = acc;
  }
  return s;
}

function isZero(p: Uint8Array): boolean {
  for (let i = 0; i < p.length; i++) if (p[i] !== 0) return false;
  return true;
}

function degree(p: Uint8Array): number {
  let d = p.length - 1;
  while (d > 0 && p[d] === 0) d--;
  return d;
}

function polyEval(p: Uint8Array, x: number): number {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = gfMul(y, x) ^ p[i];
  return y;
}

/**
 * Berlekamp-Massey with erasures (Blahut's formulation). Starting from the
 * erasure locator Γ with register length f = deg Γ makes the algorithm solve
 * only for the unknown error positions, using the nsym − f syndrome
 * combinations not consumed by the erasures. Returns Λ(x) = σ(x)·Γ(x) and the
 * final register length L (= errors + erasures when decodable).
 */
function berlekampMassey(synd: Uint8Array, gamma: Uint8Array): { lambda: Uint8Array; length: number } {
  const nsym = synd.length;
  const f = gamma.length - 1;
  const lambda = new Uint8Array(nsym + 1);
  const b = new Uint8Array(nsym + 1);
  lambda.set(gamma);
  b.set(gamma);
  let length = f;
  // Massey's invariants: before step r, deg Λ ≤ L ≤ r − 1 and deg B ≤ r − 1 − L + f,
  // so x·B and the updated Λ have degree ≤ r ≤ nsym. The shift never drops a
  // coefficient and indices above r never need to be touched.
  for (let r = f + 1; r <= nsym; r++) {
    let delta = 0;
    for (let i = 0; i < r; i++) delta ^= gfMul(lambda[i], synd[r - 1 - i]);
    b.copyWithin(1, 0, nsym); // B ← x·B
    b[0] = 0;
    if (delta === 0) continue;
    if (2 * length <= r + f - 1) {
      // Λ ← Λ − Δ·x·B and B ← Δ⁻¹·Λ_old, both from the old values.
      const inv = gfInv(delta);
      for (let i = 0; i <= r; i++) {
        const old = lambda[i];
        lambda[i] = old ^ gfMul(delta, b[i]);
        b[i] = gfMul(inv, old);
      }
      length = r + f - length;
    } else {
      for (let i = 0; i <= r; i++) lambda[i] ^= gfMul(delta, b[i]);
    }
  }
  return { lambda, length };
}

/**
 * Chien search: ascending byte positions p in [0, n) with Λ(X_p⁻¹) = 0.
 * Locators beyond the (shortened) codeword are never visited, so roots there
 * simply go missing from the result.
 */
function chienSearch(locator: Uint8Array, n: number): number[] {
  const positions: number[] = [];
  for (let p = 0; p < n; p++) {
    if (polyEval(locator, gfExp(p - (n - 1))) === 0) positions.push(p);
  }
  return positions;
}

/**
 * Decode an n-byte codeword (n ≤ 255) with nsym parity bytes. `erasures` lists
 * byte indices known to be unreliable; duplicates are ignored. Never throws:
 * malformed parameters (nsym < 1, n ≤ nsym, n > 255, erasure index not an
 * integer in [0, n)) yield INVALID_INPUT, uncorrectable data TOO_MANY_ERRORS.
 */
export function rsDecode(codeword: Uint8Array, nsym: number, erasures: readonly number[] = []): RsDecodeResult {
  const n = codeword.length;
  if (!isValidShape(n, nsym)) return INVALID_INPUT;
  const erased = new Set<number>();
  for (const p of erasures) {
    if (!Number.isInteger(p) || p < 0 || p >= n) return INVALID_INPUT;
    erased.add(p);
  }
  const f = erased.size;
  if (f > nsym) return TOO_MANY_ERRORS;

  const word = codeword.slice();
  const k = n - nsym;
  const synd = syndromes(word, nsym);
  if (isZero(synd)) return success(word, k, 0, f, []);

  // Γ(x) = ∏ (1 + X_p·x) over erased positions p.
  const gamma = new Uint8Array(f + 1);
  gamma[0] = 1;
  let gammaDegree = 0;
  for (const p of erased) {
    const x = gfExp(n - 1 - p);
    gammaDegree++;
    for (let i = gammaDegree; i >= 1; i--) gamma[i] ^= gfMul(gamma[i - 1], x);
  }

  const { lambda, length } = berlekampMassey(synd, gamma);
  // e = length − f errors are only uniquely decodable when 2e + f ≤ nsym; a
  // locator whose degree differs from its register length has a root at 0,
  // which no codeword position can produce.
  if (2 * length - f > nsym || degree(lambda) !== length) return TOO_MANY_ERRORS;

  // Λ must split into distinct roots that all lie inside the codeword.
  const locator = lambda.subarray(0, length + 1);
  const positions = chienSearch(locator, n);
  if (positions.length !== length) return TOO_MANY_ERRORS;

  // Forney (first consecutive root 0): Y = X·Ω(X⁻¹) / Λ'(X⁻¹), where
  // Ω(x) = S(x)·Λ(x) mod x^nsym. Because Λ generates the whole syndrome
  // sequence, the coefficients of degree ≥ L vanish and Ω has L terms. Λ' is
  // the formal derivative, which in characteristic 2 keeps only odd terms.
  const omega = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    let acc = 0;
    for (let j = 0; j <= i; j++) acc ^= gfMul(locator[j], synd[i - j]);
    omega[i] = acc;
  }
  const derivative = new Uint8Array(length);
  for (let i = 1; i <= length; i += 2) derivative[i - 1] = locator[i];

  for (const p of positions) {
    const x = gfExp(n - 1 - p);
    const xInv = gfInv(x);
    const denominator = polyEval(derivative, xInv);
    if (denominator === 0) return TOO_MANY_ERRORS;
    word[p] ^= gfMul(x, gfDiv(polyEval(omega, xInv), denominator));
  }

  if (!isZero(syndromes(word, nsym))) return TOO_MANY_ERRORS;

  const changed = positions.filter((p) => word[p] !== codeword[p]);
  const errors = changed.reduce((count, p) => count + (erased.has(p) ? 0 : 1), 0);
  return success(word, k, errors, f, changed);
}

function success(word: Uint8Array, k: number, errors: number, erasures: number, positions: number[]): RsDecodeResult {
  return { ok: true, codeword: word, data: word.slice(0, k), errors, erasures, positions };
}
