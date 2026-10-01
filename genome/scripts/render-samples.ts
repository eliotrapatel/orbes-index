/**
 * Renders the reference ORBES CODE-01 samples.
 *
 *   npx tsx scripts/render-samples.ts
 *
 * Writes docs/assets/orbes-code-sample{,-inverted,-ivory}.svg and PNG previews
 * of each into genome/out/ (git-ignored). The sample is a realistic, fully
 * valid code: year 2026, category index 1, serial 184 (packed identity
 * 0x341000B8, genome G1-E1DC-BE52), signed with a fixed, publicly known SAMPLE
 * key. Ed25519 is deterministic, so re-running reproduces every file byte for
 * byte. Before writing anything the script reads its own cells back through
 * the decoder-side path (unmask, Reed-Solomon, CRC, signature) and aborts if
 * the sample would not verify.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Resvg } from '@resvg/resvg-js';
import { utf8 } from '../src/core/bytes.js';
import {
  CODE01,
  ORBES_CODE_STYLES,
  decodeCellsToCodeword,
  encodeOrbesCode,
  maskPenalty,
  renderOrbesCodeSvg,
  type OrbesCodeModel,
} from '../src/core/code/index.js';
import { rsDecode } from '../src/core/ecc/index.js';
import { computeGenome, type Genome } from '../src/core/genome/index.js';
import { packIdentity, type ProductIdentity } from '../src/core/identity.js';
import { encodePayload, frameCodeData, issuedDayFromDate, signingMessage, unframeCodeData } from '../src/core/payload.js';
import { verifyCodeSignature } from '../src/core/verify/ed25519.js';

const GENOME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(GENOME_ROOT, '../docs/assets');
const PREVIEWS = resolve(GENOME_ROOT, 'out');
const PREVIEW_WIDTH_PX = 1200;

/** Never a production key: derived from a public string so anyone can reproduce the samples. */
const SAMPLE_SECRET_KEY = sha256(utf8('ORBES CODE-01 public sample key - never valid in production'));

const SAMPLE_IDENTITY: ProductIdentity = { year: 2026, categoryIndex: 1, serial: 184 };

function sampleInput(): { data: Uint8Array; genome: Genome } {
  const payload = encodePayload({
    codeVersion: 1,
    genomeVersion: 1,
    keyId: 1,
    identity: SAMPLE_IDENTITY,
    issue: 1,
    issuedDay: issuedDayFromDate(new Date(Date.UTC(2026, 0, 15))),
    nonce: Uint8Array.of(0x4f, 0x52, 0x42, 0x53),
  });
  const signature = ed25519.sign(signingMessage(payload), SAMPLE_SECRET_KEY);
  return { data: frameCodeData(payload, signature), genome: computeGenome(packIdentity(SAMPLE_IDENTITY)) };
}

/** Reads the printed cells back the way a decoder does and checks the signature. */
function assertVerifies(model: OrbesCodeModel): void {
  const read = rsDecode(decodeCellsToCodeword(model.cells, model.mask).codeword, CODE01.ecc.totalBytes - CODE01.ecc.dataBytes);
  if (!read.ok || read.errors !== 0) throw new Error('sample cells do not decode cleanly');
  const { payloadBytes, signature } = unframeCodeData(read.data);
  if (!verifyCodeSignature(ed25519.getPublicKey(SAMPLE_SECRET_KEY), payloadBytes, signature)) {
    throw new Error('sample signature does not verify');
  }
}

const SAMPLES = [
  { name: 'orbes-code-sample', style: ORBES_CODE_STYLES.classic },
  { name: 'orbes-code-sample-inverted', style: ORBES_CODE_STYLES.inverted },
  { name: 'orbes-code-sample-ivory', style: ORBES_CODE_STYLES.ivory },
] as const;

function main(): void {
  const { data, genome } = sampleInput();
  const model = encodeOrbesCode({ data, genomeGlyphs: genome.glyphs });
  assertVerifies(model);
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(PREVIEWS, { recursive: true });
  for (const { name, style } of SAMPLES) {
    const svg = renderOrbesCodeSvg(model, { ...style, title: 'ORBES CODE-01 sample' });
    writeFileSync(resolve(ASSETS, `${name}.svg`), svg);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: PREVIEW_WIDTH_PX }, font: { loadSystemFonts: false } })
      .render()
      .asPng();
    writeFileSync(resolve(PREVIEWS, `${name}.png`), png);
  }
  const penalty = maskPenalty(model.cells);
  const ink = model.cells.reduce((sum, c) => sum + c, 0);
  console.log(
    `genome ${genome.fingerprint} · mask ${model.mask} · format word 0x${model.formatWord.toString(16)} · ink ${ink}/${model.cells.length} cells · ` +
      `penalty ${penalty.total.toFixed(2)} (runs ${penalty.runs}, balance ${penalty.balance.toFixed(2)}, patches ${penalty.patches.toFixed(2)}) · ` +
      `${model.primitives.length} primitives`,
  );
  console.log(`wrote ${SAMPLES.length} SVGs to ${ASSETS} and PNG previews to ${PREVIEWS}`);
}

main();
