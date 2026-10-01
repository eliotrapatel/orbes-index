/**
 * Generates the normative CODE-01 / GENOME-01 test vectors published in
 * docs/vectors/code01-sample.json and quoted in docs/ORBES-CODE-SPEC.md.
 *
 *   npx tsx scripts/spec-vectors.ts
 *
 * The sample key is derived from a public string: it is NOT and never will be
 * an ORBES production key. Ed25519 is deterministic, so the output is stable.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '../src/core/bytes.js';
import { CODE01, CODE01_RINGS, encodeOrbesCode } from '../src/core/code/index.js';
import { crc16 } from '../src/core/ecc/crc16.js';
import { computeGenome } from '../src/core/genome/index.js';
import { packIdentity, type ProductIdentity } from '../src/core/identity.js';
import { encodePayload, frameCodeData, issuedDayFromDate, signingMessage } from '../src/core/payload.js';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/vectors/code01-sample.json');

const secretKey = sha256(utf8('ORBES CODE-01 public sample key - never valid in production'));
const publicKey = ed25519.getPublicKey(secretKey);
const identity: ProductIdentity = { year: 2026, categoryIndex: 1, serial: 184 };
const packed = packIdentity(identity);
const payload = encodePayload({
  codeVersion: 1,
  genomeVersion: 1,
  keyId: 1,
  identity,
  issue: 1,
  issuedDay: issuedDayFromDate(new Date(Date.UTC(2026, 0, 15))),
  nonce: Uint8Array.of(0x4f, 0x52, 0x42, 0x53),
});
const message = signingMessage(payload);
const signature = ed25519.sign(message, secretKey);
const data = frameCodeData(payload, signature);
const genome = computeGenome(packed);
const model = encodeOrbesCode({ data, genomeGlyphs: genome.glyphs });

const rings = CODE01_RINGS.map((ring) => ({
  index: ring.index,
  radius: ring.radius,
  cells: ring.cells,
  bits: Array.from(model.cells.subarray(ring.offset, ring.offset + ring.cells)).join(''),
}));

const vectors = {
  description: 'ORBES CODE-01 / GENOME-01 sample vectors. Sample key only, never valid in production.',
  sampleSecretKeySeedHex: toHex(secretKey),
  publicKeyHex: toHex(publicKey),
  productId: 'O26-J-00184',
  identity,
  packedIdentityHex: packed.toString(16).padStart(8, '0'),
  genome: {
    version: genome.version,
    valueHex: genome.value.toString(16).padStart(8, '0'),
    glyphs: genome.glyphs,
    ids: genome.ids,
    fingerprint: genome.fingerprint,
  },
  payloadHex: toHex(payload),
  signingMessageHex: toHex(message),
  signatureHex: toHex(signature),
  crc16Hex: crc16(data.subarray(0, 77)).toString(16).padStart(4, '0'),
  framedDataHex: toHex(data),
  codewordHex: toHex(model.codeword),
  eccBytes: CODE01.ecc.totalBytes - CODE01.ecc.dataBytes,
  mask: model.mask,
  formatWordHex: model.formatWord.toString(16).padStart(4, '0'),
  formatWordBits: model.formatWord.toString(2).padStart(15, '0'),
  rings,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors, null, 2) + '\n');
console.log(JSON.stringify({ ...vectors, rings: `${rings.length} rings` }, null, 2));
