# Engineering contracts (internal)

Binding interfaces between modules. Implementations must match these signatures exactly so independently built modules compose. Conventions:

- ESM + TypeScript strict. Relative imports use the `.js` extension (`import { x } from './foo.js'`).
- `src/core/**` is **isomorphic**: no `node:*` imports, no DOM globals at module top level, no `Buffer`. Use `Uint8Array`. Hashing via `@noble/hashes` (`import { sha256 } from '@noble/hashes/sha2.js'`). Ed25519 via `@noble/curves/ed25519.js`.
- Tests: Vitest, under `test/<area>/*.test.ts`. Run with `npx vitest run test/<area>`.
- Do not edit `package.json`. Do not run git commands that change state (the orchestrator commits).
- Geometry: see `src/core/geometry.ts` (primitives, y-down plane, angles clockwise from north).
- CODE-01 layout: see `src/core/code/profile.ts` (single source of truth).

---

## 1. Bytes — `src/core/bytes.ts`

```ts
export function concatBytes(...parts: Uint8Array[]): Uint8Array;
export function toHex(b: Uint8Array): string;                 // lowercase
export function fromHex(s: string): Uint8Array;               // strict, throws on odd/invalid
export function toBase64Url(b: Uint8Array): string;           // no padding
export function fromBase64Url(s: string): Uint8Array;         // strict alphabet, throws
export function utf8(s: string): Uint8Array;
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean; // length + content
export function readU16BE(b: Uint8Array, o: number): number;
export function readU32BE(b: Uint8Array, o: number): number;
export function writeU16BE(b: Uint8Array, o: number, v: number): void;
export function writeU32BE(b: Uint8Array, o: number, v: number): void;
```

## 2. Error correction — `src/core/ecc/`

`gf256.ts`: GF(2^8), primitive polynomial **0x11D**, generator α = 2, exp/log tables.

`reed-solomon.ts` (systematic, codeword = data ‖ parity, generator roots α^0 … α^(nsym−1), i.e. fcr = 0, same convention as QR):

```ts
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array; // returns full codeword (data.length + nsym)
export type RsDecodeResult =
  | { ok: true; codeword: Uint8Array; data: Uint8Array; errors: number; erasures: number; positions: number[] }
  | { ok: false; reason: 'TOO_MANY_ERRORS' | 'INVALID_INPUT' };
export function rsDecode(codeword: Uint8Array, nsym: number, erasures?: readonly number[]): RsDecodeResult;
```

- Errors-and-erasures decoding (Berlekamp-Massey with erasure locator initialisation, Chien search, Forney). Guarantees correction whenever `2·errors + erasures ≤ nsym`.
- After correction, the syndromes are recomputed and must be zero. Otherwise return `ok:false`. Never return a "corrected" word that is not a codeword. Never throw on bad data.
- `n = codeword.length ≤ 255`.

`bch.ts` — format word:

```ts
export const FORMAT_GENERATOR = 0x537;  // BCH(15,5)
export const FORMAT_XOR_MASK = 0x5412;
export function bchFormatEncode(value5: number): number;                 // 15-bit word (masked)
export function bchFormatDecode(word15: number): { value: number; distance: number; secondDistance: number };
```

`crc16.ts`: `export function crc16(bytes: Uint8Array): number;` CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0). Check value for ASCII "123456789" is **0x29B1**.

## 3. Product identity — `src/core/identity.ts`

Canonical product identity `O{YY}-{C}-{NNNNN}` e.g. `O26-J-00184`.

```ts
export interface ProductIdentity { year: number; categoryIndex: number; serial: number }
// year: 2000..2099 · categoryIndex: 1..31 (0 reserved) · serial: 1..999_999
export interface CategoryInfo { code: string; index: number; name: string }   // code: single A–Z letter
export interface CategoryResolver { byCode(code: string): CategoryInfo | undefined; byIndex(index: number): CategoryInfo | undefined }
export function packIdentity(id: ProductIdentity): number;   // u32: (year-2000)<<25 | categoryIndex<<20 | serial
export function unpackIdentity(packed: number): ProductIdentity; // validates ranges, throws IdentityError
export function formatProductId(id: ProductIdentity, resolver: CategoryResolver): string; // serial zero-padded to ≥5 digits
export function parseProductId(s: string, resolver: CategoryResolver): ProductIdentity;   // strict canonical: /^O(\d{2})-([A-Z])-(\d{5,6})$/ and a 6-digit serial must not start with 0
export class IdentityError extends Error {}
export function staticCategoryResolver(list: CategoryInfo[]): CategoryResolver; // helper for tests/tools
```

Packed layout (32 bits, big-endian when serialized): `yy:7 | category:5 | serial:20`.

## 4. Canonical payload — `src/core/payload.ts`

```ts
export const PAYLOAD_V1_LENGTH = 13;
export const SIGNATURE_LENGTH = 64;
export const CODE_DATA_V1_LENGTH = 79;          // payload ‖ signature ‖ crc16
export const SIGNING_DOMAIN_V1 = 'ORBES-CODE/v1'; // signing message = utf8(domain) ‖ 0x00 ‖ payloadBytes
export const ISSUED_DAY_EPOCH_UTC = Date.UTC(2024, 0, 1);

export interface CodePayloadV1 {
  codeVersion: 1;
  genomeVersion: number;      // 1..15
  keyId: number;              // 1..255 (0 reserved)
  identity: ProductIdentity;
  issue: number;              // 1..255 code issue counter for this product (re-issue after revocation/damage)
  issuedDay: number;          // days since 2024-01-01 UTC, 0..65535
  nonce: Uint8Array;          // 4 bytes, random per issued code
}
// byte 0      : codeVersion<<4 | genomeVersion
// byte 1      : keyId
// bytes 2..5  : packed identity (u32 BE)
// byte 6      : issue
// bytes 7..8  : issuedDay (u16 BE)
// bytes 9..12 : nonce
export function encodePayload(p: CodePayloadV1): Uint8Array;            // 13 bytes, validates
export function decodePayload(b: Uint8Array): CodePayloadV1;            // strict: exact length, ranges, reserved values → PayloadError
export function signingMessage(payloadBytes: Uint8Array): Uint8Array;
export function frameCodeData(payloadBytes: Uint8Array, signature: Uint8Array): Uint8Array; // 79 bytes
export function unframeCodeData(data: Uint8Array): { payloadBytes: Uint8Array; signature: Uint8Array; payload: CodePayloadV1 }; // checks CRC → PayloadError('CRC')
export function issuedDayFromDate(d: Date): number;
export function dateFromIssuedDay(day: number): Date;
export class PayloadError extends Error { code: 'LENGTH' | 'VERSION' | 'RANGE' | 'CRC' | 'RESERVED' | 'UNSUPPORTED_VERSION'; codeVersion?: number }
```

`src/core/code-profiles.ts` — code-version registry (ORBES-CODE-SPEC §12):

```ts
export interface CodeProfileEntry<P = unknown> {
  version: number; id: string; layout: typeof CODE01; dataLength: number; signingDomain: string;
  unframe(data: Uint8Array): { payloadBytes: Uint8Array; signature: Uint8Array; payload: P };   // strict, throws PayloadError
  signingMessage(payloadBytes: Uint8Array): Uint8Array;
}
export type CodeProfileRegistry<P = unknown> = ReadonlyMap<number, CodeProfileEntry<P>>;
export const CODE01_PROFILE: CodeProfileEntry<CodePayloadV1>;
export const CODE_PROFILES: CodeProfileRegistry<CodePayloadV1>;          // {1 → CODE-01}
export function codeVersionOf(data: Uint8Array): number;                  // high nibble of byte 0
// Dispatch on the high nibble. Unregistered version 1..8 with an intact envelope
// (≥ 67 bytes, CRC-16 trailer) → PayloadError('UNSUPPORTED_VERSION', codeVersion); else 'VERSION'.
export function unframeAnyCodeData<P>(data: Uint8Array, profiles: CodeProfileRegistry<P>): { codeVersion: number; profile: CodeProfileEntry<P>; payloadBytes; signature; payload: P };
```

`src/core/verify/ed25519.ts` (isomorphic, noble):

```ts
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean; // never throws
export function verifyCodeSignature(publicKey: Uint8Array, payloadBytes: Uint8Array, signature: Uint8Array): boolean;
```

The server signs with `node:crypto` (see the server contracts). Signatures are standard RFC 8032 Ed25519 (pure, not prehashed).

## 5. Genome — `src/core/genome/`

```ts
// vocabulary.ts
export interface GlyphDef { index: number; id: string; name: string; family: string; hint: string; /* unicode approximation */
  primitives(cx: number, cy: number, R: number): Primitive[] }   // layer 'genome', all ink within radius R
export const GENOME01_GLYPHS: readonly GlyphDef[];               // exactly 16, index = position

// genome.ts
export interface Genome { version: number; packedIdentity: number; value: number; glyphs: number[]; ids: string[]; fingerprint: string }
export function computeGenome(packedIdentity: number, version?: number): Genome;   // default version 1
export function identityFromGenomeGlyphs(glyphs: readonly number[], version?: number): number; // inverse → packed identity
export function genomePermute(x: number): number;          // GENOME-01 public bijection on u32 (Feistel, 8 rounds, SHA-256 round fn)
export function genomeUnpermute(y: number): number;
export const SUPPORTED_GENOME_VERSIONS: readonly number[];   // [1]

// render.ts
export function genomeGlyphPrimitives(glyph: number, cx: number, cy: number, R: number, version?: number): Primitive[];
export function renderGenomeSvg(genome: Genome, opts?: { layout?: 'row' | 'orbit'; ink?: string; paper?: string | null; glyphSize?: number }): string;
```

GENOME-01 value → glyphs: 8 nibbles of `value`, most significant first. Glyph 0 sits at north in the code (angle 0), then clockwise every 45°. Fingerprint format: `G1-XXXX-XXXX` (uppercase hex of `value`).

## 6. Shared SVG renderer — `src/core/render/svg.ts`

```ts
export interface SvgStyle { ink?: string; paper?: string | null; decor?: boolean; widthMm?: number; title?: string; }
export function primitivesToSvg(primitives: readonly Primitive[], viewBox: { x: number; y: number; w: number; h: number }, style?: SvgStyle): string;
export function primitiveToPathData(p: Primitive): string; // used by the PDF renderer too
```

Deterministic output (fixed decimal precision, stable attribute order), so snapshot tests work.

## 7. Encoder — `src/core/code/encoder.ts`

```ts
export interface EncodeInput { data: Uint8Array /* 79 bytes */; genomeGlyphs: readonly number[] /* 8 */; codeVersion?: number /* default 1; must be in the registry */; mask?: number /* force mask */ }
export interface OrbesCodeModel {
  profile: 'CODE-01'; codeVersion: number; mask: number; formatWord: number;
  codeword: Uint8Array;   // 164 bytes (data ‖ RS parity)
  cells: Uint8Array;      // CODE01_TOTAL_CELLS, final printed state (1 = ink), mask applied
  genomeGlyphs: number[];
  primitives: Primitive[]; // seal, moons, polaris halo, format/data arcs, genome glyphs, decor
}
export function encodeOrbesCode(input: EncodeInput, opts?: { decor?: boolean; codeProfiles?: CodeProfileRegistry }): OrbesCodeModel;
export function renderOrbesCodeSvg(model: OrbesCodeModel, style?: SvgStyle): string; // viewBox −25..25
```

## 8. Decoder — `src/core/decoder/`

```ts
export interface GrayImage { width: number; height: number; data: Uint8Array }  // 8-bit luma, row-major
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage;
export interface DecodeOptions { tryInverted?: boolean; tryMirrored?: boolean; readGenome?: boolean; maxSealCandidates?: number; codeProfiles?: CodeProfileRegistry /* default CODE_PROFILES */ }
export type DecodeResult =
  | { ok: true; data: Uint8Array; payloadBytes: Uint8Array; signature: Uint8Array;
      codeVersion: number; mask: number;
      genome: { glyphs: (number | null)[]; confidence: number[] } | null;
      quality: { rsErrors: number; rsErasures: number; contrast: number; moduleSizePx: number; inverted: boolean; mirrored: boolean; orientation: number; elapsedMs: number };
      geometry: { center: { x: number; y: number }; moons: { x: number; y: number }[]; homography: number[] } }
  | { ok: false; reason: 'NO_SEAL' | 'NO_MOONS' | 'FORMAT' | 'ECC' | 'CRC' | 'PAYLOAD'; detail?: string;
      seal?: { confidence: number; unitPx: number };   // NO_MOONS: most code-like seal found (0–1 share of data orbits with arc texture)
      moduleSizePx?: number;                             // FORMAT…PAYLOAD: px per u of the code located but not read
      elapsedMs: number };
export function decodeOrbesCode(img: GrayImage, opts?: DecodeOptions): DecodeResult;
export const MAX_RS_ERASURES = 70;   // decode.ts: Reed-Solomon never erases more bytes (miscorrection safety, ORBES-CODE-SPEC §11)
```

`seal` and `moduleSizePx` serve scan guidance only; they never change whether a decode succeeds.

The decoder never verifies signatures. That is the server's job. It returns the bytes it read.
