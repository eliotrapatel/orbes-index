/**
 * ORBES GENOME — deterministic product genome.
 *
 * GENOME-01 value = genomePermute(packedIdentity), where packedIdentity is the
 * u32 canonical product identity (src/core/identity.ts). The value is read as
 * 8 nibbles, most significant first; each nibble selects one of the 16 glyphs
 * of the GENOME-01 vocabulary.
 *
 * genomePermute is a balanced 8-round Feistel network on 32 bits whose round
 * function is a domain-separated SHA-256. A Feistel network is a bijection
 * whatever its round function, hence:
 *   - uniqueness: two distinct identities can never share a genome, so no
 *     collision handling exists anywhere in the system;
 *   - determinism: the same identity and version always give the same genome;
 *   - invertibility: a genome read from a product maps back to its identity.
 * The permutation only scatters neighbouring serials into unrelated-looking
 * genomes. It is PUBLIC and keyless and is NOT a security mechanism: anyone can
 * compute or invert it. Authenticity comes exclusively from the Ed25519
 * signature over the canonical payload.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { GENOME01_GLYPHS, type GlyphDef } from './vocabulary.js';

export interface Genome {
  version: number;
  packedIdentity: number;
  /** genomePermute(packedIdentity) for GENOME-01. */
  value: number;
  /** 8 glyph indices (0..15), most significant nibble first; glyph 0 sits at code north. */
  glyphs: number[];
  /** Glyph ids matching `glyphs`. */
  ids: string[];
  /** `G{version}-XXXX-XXXX`, uppercase hex of `value`. */
  fingerprint: string;
}

export const SUPPORTED_GENOME_VERSIONS: readonly number[] = Object.freeze([1]);

const GLYPH_COUNT = 8;
const GLYPH_BITS = 4;
const FEISTEL_ROUNDS = 8;
// ASCII by construction; spelled out byte by byte so that importing this
// module touches no host global (TextEncoder) at load time.
const ROUND_DOMAIN = Uint8Array.from('ORBES/GENOME-01/F', (c) => c.charCodeAt(0));

/** Round-function input: domain ‖ round index ‖ be16(right half). Reused scratch buffer. */
const roundInput = new Uint8Array(ROUND_DOMAIN.length + 3);
roundInput.set(ROUND_DOMAIN);

/**
 * Memo of F(round, half). Each round has only 2^16 inputs, so the whole table
 * is bounded (8 × 64 Ki entries, 2 MiB) and bulk work such as batch issuance or
 * registry audits avoids most hashing. Allocated on first use; an entry stores
 * F | 0x10000 so that 0 means "not computed yet".
 */
let roundMemo: Uint32Array | undefined;

/** F_i(R) = first two bytes (big-endian) of SHA-256("ORBES/GENOME-01/F" ‖ i ‖ be16(R)). */
function roundFunction(round: number, half: number): number {
  roundMemo ??= new Uint32Array(FEISTEL_ROUNDS << 16);
  const slot = (round << 16) | half;
  let entry = roundMemo[slot];
  if (entry === 0) {
    const n = ROUND_DOMAIN.length;
    roundInput[n] = round;
    roundInput[n + 1] = half >>> 8;
    roundInput[n + 2] = half & 0xff;
    const digest = sha256(roundInput);
    entry = 0x10000 | (digest[0] << 8) | digest[1];
    roundMemo[slot] = entry;
  }
  return entry & 0xffff;
}

function requireU32(x: number, what: string): void {
  if (!(Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) throw new RangeError(`${what} must be a u32 integer, got ${x}`);
}

/** GENOME-01 public bijection on u32 (8-round Feistel, SHA-256 round function). */
export function genomePermute(x: number): number {
  requireU32(x, 'genome input');
  let left = x >>> 16;
  let right = x & 0xffff;
  for (let i = 0; i < FEISTEL_ROUNDS; i++) {
    const next = (left ^ roundFunction(i, right)) & 0xffff;
    left = right;
    right = next;
  }
  return ((left << 16) | right) >>> 0;
}

/** Inverse of genomePermute: genomeUnpermute(genomePermute(x)) === x for every u32 x. */
export function genomeUnpermute(y: number): number {
  requireU32(y, 'genome value');
  let left = y >>> 16;
  let right = y & 0xffff;
  for (let i = FEISTEL_ROUNDS - 1; i >= 0; i--) {
    const previous = (right ^ roundFunction(i, left)) & 0xffff;
    right = left;
    left = previous;
  }
  return ((left << 16) | right) >>> 0;
}

interface GenomeScheme {
  permute(x: number): number;
  unpermute(y: number): number;
  vocabulary: readonly GlyphDef[];
}

/** Version registry: every genome version ever issued stays computable. */
const SCHEMES: ReadonlyMap<number, GenomeScheme> = new Map([
  [1, { permute: genomePermute, unpermute: genomeUnpermute, vocabulary: GENOME01_GLYPHS }],
]);

function scheme(version: number): GenomeScheme {
  const s = SCHEMES.get(version);
  if (!s) throw new RangeError(`unsupported genome version ${version}`);
  return s;
}

/** Glyph vocabulary of a genome version (index = glyph value). */
export function genomeVocabulary(version = 1): readonly GlyphDef[] {
  return scheme(version).vocabulary;
}

const hex16 = (v: number): string => v.toString(16).toUpperCase().padStart(4, '0');

export function computeGenome(packedIdentity: number, version = 1): Genome {
  const { permute, vocabulary } = scheme(version);
  requireU32(packedIdentity, 'packed identity');
  const value = permute(packedIdentity);
  const glyphs = Array.from({ length: GLYPH_COUNT }, (_, i) => (value >>> ((GLYPH_COUNT - 1 - i) * GLYPH_BITS)) & 0xf);
  return {
    version,
    packedIdentity,
    value,
    glyphs,
    ids: glyphs.map((g) => vocabulary[g].id),
    fingerprint: `G${version}-${hex16(value >>> 16)}-${hex16(value & 0xffff)}`,
  };
}

/** Inverse of computeGenome(…).glyphs: the packed identity a glyph sequence encodes. */
export function identityFromGenomeGlyphs(glyphs: readonly number[], version = 1): number {
  const { unpermute, vocabulary } = scheme(version);
  if (glyphs.length !== GLYPH_COUNT) throw new RangeError(`a genome has ${GLYPH_COUNT} glyphs, got ${glyphs.length}`);
  let value = 0;
  for (const g of glyphs) {
    if (!(Number.isInteger(g) && g >= 0 && g < vocabulary.length)) throw new RangeError(`invalid glyph index ${g}`);
    value = ((value << GLYPH_BITS) | g) >>> 0;
  }
  return unpermute(value);
}
