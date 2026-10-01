/**
 * Proof of concept (scripts/poc.ts): the full issue → render → capture →
 * decode → verify flow and every attack, run programmatically with a seeded
 * entropy source, plus unit tests of the pure verification decision and a
 * smoke test of the `npm run poc` entry point.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  POC_CATEGORIES,
  POC_DECOY,
  POC_KEY_ID,
  POC_PRODUCT,
  compareGenome,
  createRegistry,
  decideVerification,
  demoEntropy,
  issueCode,
  runPoc,
  type PocReport,
  type TamperId,
  type VerificationContext,
  type VerificationState,
} from '../../scripts/poc.js';
import {
  CODE01,
  PAYLOAD_V1_LENGTH,
  computeGenome,
  encodePayload,
  equalBytes,
  formatProductId,
  frameCodeData,
  packIdentity,
  parseProductId,
  signingMessage,
  staticCategoryResolver,
  unframeCodeData,
  verifyCodeSignature,
  type ProductIdentity,
} from '../../src/core/index.js';
import { publicKeyFromSeed, signEd25519 } from '../../src/server/crypto/ed25519-node.js';
import { readImage } from '../support/image-io.js';

const GENOME_ROOT = resolve(import.meta.dirname, '../..');
const ISSUED_AT = new Date(Date.UTC(2026, 2, 14));
const categories = staticCategoryResolver([...POC_CATEGORIES]);
const ring = parseProductId(POC_PRODUCT.productId, categories);
const decoy = parseProductId(POC_DECOY.productId, categories);

// ── End-to-end run ─────────────────────────────────────────────────────────

describe('proof of concept run', () => {
  let outDir: string;
  let lines: string[];
  let report: PocReport;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'orbes-poc-'));
    lines = [];
    report = runPoc({ entropy: demoEntropy(2026), issuedAt: ISSUED_AT, outDir, log: (line) => lines.push(line) });
  });

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  const tamper = (id: TamperId) => {
    const outcome = report.tampers.find((t) => t.id === id);
    if (!outcome) throw new Error(`no tamper outcome ${id}`);
    return outcome;
  };

  it('issues O26-J-00184 under key 1 with its GENOME-01 and a valid Ed25519 signature', () => {
    const { payload, payloadBytes, signature, data, genome } = report.issued;
    expect(formatProductId(payload.identity, categories)).toBe('O26-J-00184');
    expect(packIdentity(payload.identity)).toBe(0x341000b8);
    expect(payload.keyId).toBe(POC_KEY_ID);
    expect(genome.fingerprint).toBe('G1-E1DC-BE52');
    expect([payloadBytes.length, signature.length, data.length]).toEqual([13, 64, 79]);
    expect(report.model.codeword.length).toBe(CODE01.ecc.totalBytes);
    expect(report.model.genomeGlyphs).toEqual(genome.glyphs);
    expect(verifyCodeSignature(report.publicKey, payloadBytes, signature)).toBe(true);
  });

  it('decodes the phone capture to exactly the issued bytes and reads the genome', () => {
    const { capture } = report.genuine;
    expect([capture.frame.width, capture.frame.height]).toEqual([1280, 720]);
    expect(capture.result.ok).toBe(true);
    if (!capture.result.ok) return;
    expect(equalBytes(capture.result.data, report.issued.data)).toBe(true);
    expect(capture.result.genome?.glyphs).toEqual(report.issued.genome.glyphs);
  });

  it('verifies the genuine code as AUTHENTIC with the registered product details', () => {
    const { verdict } = report.genuine;
    expect(verdict.state).toBe('AUTHENTIC');
    expect(verdict.genome?.check).toBe('MATCH');
    expect(verdict.product).toEqual({
      productId: 'O26-J-00184',
      model: 'MONOLITHE RING',
      category: 'JEWELRY',
      material: '925 STERLING SILVER',
      createdYear: 2026,
      genomeFingerprint: 'G1-E1DC-BE52',
      keyId: 1,
      issue: 1,
      issuedOn: '2026-03-14',
    });
  });

  it.each<[TamperId, VerificationState, string]>([
    ['a', 'INVALID_SIGNATURE', 'BAD_SIGNATURE'],
    ['b1', 'INVALID_SIGNATURE', 'BAD_SIGNATURE'],
    ['b2', 'GENOME_MISMATCH', 'GENOME_MISMATCH'],
    ['c', 'INVALID_SIGNATURE', 'BAD_SIGNATURE'],
    ['d', 'INVALID_SIGNATURE', 'BAD_SIGNATURE'],
    ['e', 'INVALID_SIGNATURE', 'BAD_SIGNATURE'],
    ['f', 'MALFORMED_CODE', 'DECODE_ECC'],
  ])('attack (%s) is rejected as %s (%s)', (id, state, reason) => {
    const outcome = tamper(id);
    expect(outcome.expected).toBe(state);
    expect(outcome.verdict.state).toBe(state);
    expect(outcome.verdict.reason).toBe(reason);
    expect(outcome.verdict.product).toBeUndefined();
  });

  it('(a) relabels the code as another registered product, and only the signature stops it', () => {
    const { payload } = tamper('a').verdict;
    expect(payload && formatProductId(payload.identity, categories)).toBe(POC_DECOY.productId);
    expect(report.genuine.verdict.payload?.issue).toBe(payload?.issue);
  });

  it('(b1) changes nothing but the signed genome version nibble', () => {
    expect(tamper('b1').verdict.payload).toMatchObject({ genomeVersion: 2, identity: ring });
  });

  it('(b2) keeps the genuine data but prints, and is read with, another product genome', () => {
    const { capture, verdict, printed } = tamper('b2');
    expect(printed && equalBytes(printed, report.issued.data)).toBe(true);
    expect(capture?.result.ok).toBe(true);
    if (!capture?.result.ok) return;
    expect(equalBytes(capture.result.data, report.issued.data)).toBe(true);
    expect(capture.result.genome?.glyphs).toEqual(computeGenome(packIdentity(decoy)).glyphs);
    expect(verdict.genome?.mismatches).toBeGreaterThanOrEqual(2);
  });

  it('(c) differs from the genuine frame in exactly one signature byte', () => {
    const { payload } = tamper('c').verdict;
    expect(payload?.identity).toEqual(ring);
  });

  it('(d) prints a forged code the decoder reads exactly, with the genuine signature reused', () => {
    const { capture, printed } = tamper('d');
    if (!printed || !capture?.result.ok) throw new Error('the forged code did not decode');
    expect(equalBytes(capture.result.data, printed)).toBe(true);
    const forged = unframeCodeData(printed);
    expect(formatProductId(forged.payload.identity, categories)).toBe(POC_DECOY.productId);
    expect(equalBytes(forged.signature, report.issued.signature)).toBe(true);
    expect(capture.result.genome?.glyphs).toEqual(computeGenome(packIdentity(decoy)).glyphs);
  });

  it('(e) prints a random well-formed code naming key 1 that the decoder reads exactly', () => {
    const { capture, printed, verdict } = tamper('e');
    if (!printed || !capture?.result.ok) throw new Error('the random code did not decode');
    expect(equalBytes(capture.result.data, printed)).toBe(true);
    expect(verdict.payload?.keyId).toBe(POC_KEY_ID);
  });

  it('(f) fails to decode rather than returning wrong data', () => {
    const { capture } = tamper('f');
    expect(capture?.frames).toBe(3);
    expect(capture?.result.ok).toBe(false);
  });

  it('passes and tells the story in plain text', () => {
    expect(report.passed).toBe(true);
    const text = lines.join('\n');
    expect(text).not.toContain('\x1b[');
    for (const phrase of [
      'A U T H E N T I C',
      'MONOLITHE RING',
      'JEWELRY · 925 STERLING SILVER · CREATED 2026',
      'INVALID · INVALID SIGNATURE (BAD_SIGNATURE)',
      'INVALID · GENOME MISMATCH (GENOME_MISMATCH)',
      'INVALID · MALFORMED CODE (DECODE_ECC)',
      'PROOF OF CONCEPT PASSED · 8 of 8 outcomes as expected',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('writes the code as SVG and PNG, the genome, and every camera frame', () => {
    expect(report.files.map((f) => basename(f))).toEqual([
      'orbes-code.svg',
      'orbes-code.png',
      'genome.svg',
      'capture.png',
      'tamper-b2-capture.png',
      'tamper-d-forged-code.svg',
      'tamper-d-capture.png',
      'tamper-e-capture.png',
      'tamper-f-capture.png',
    ]);
    const svg = readFileSync(join(outDir, 'orbes-code.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]*viewBox="-25 -25 50 50"/);
    expect(svg).toContain('O26-J-00184');
    const png = readImage(join(outDir, 'orbes-code.png'));
    expect([png.width, png.height]).toEqual([1200, 1200]);
    const frame = readImage(join(outDir, 'capture.png'));
    expect(equalBytes(frame.data, report.genuine.capture.frame.data)).toBe(true);
  });
});

// ── Verification decision ──────────────────────────────────────────────────

describe('decideVerification', () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 ^ i);
  const signer = { keyId: POC_KEY_ID, seed };
  const nonce = Uint8Array.of(0x4f, 0x52, 0x42, 0x53);

  /** A registry holding the ring's issue-1 code, and the key that signed it. */
  function world(): { ctx: VerificationContext; data: Uint8Array; glyphs: number[] } {
    const products = createRegistry(categories);
    const code = issueCode(ring, signer, { issue: 1, issuedAt: ISSUED_AT, nonce });
    products.get(packIdentity(ring))?.codes.set(1, code.payloadBytes);
    return { ctx: { keys: new Map([[POC_KEY_ID, publicKeyFromSeed(seed)]]), products }, data: code.data, glyphs: code.genome.glyphs };
  }

  const reading = (glyphs: readonly (number | null)[], confidence = 0.9) => ({ glyphs, confidence: glyphs.map(() => confidence) });

  /** A frame validly signed by the world's key, for any identity, issue or genome version. */
  function signed(identity: ProductIdentity, fields: { issue?: number; genomeVersion?: number; nonce?: Uint8Array } = {}): Uint8Array {
    const payloadBytes = encodePayload({
      codeVersion: 1,
      genomeVersion: fields.genomeVersion ?? 1,
      keyId: POC_KEY_ID,
      identity,
      issue: fields.issue ?? 1,
      issuedDay: 800,
      nonce: fields.nonce ?? nonce,
    });
    return frameCodeData(payloadBytes, signEd25519(seed, signingMessage(payloadBytes)));
  }

  it('is AUTHENTIC for the registered code and its genome', () => {
    const { ctx, data, glyphs } = world();
    const verdict = decideVerification({ ok: true, data, genome: reading(glyphs) }, ctx);
    expect(verdict).toMatchObject({ state: 'AUTHENTIC', reason: 'VERIFIED', genome: { check: 'MATCH', read: 8, mismatches: 0 } });
    expect(verdict.product?.issuedOn).toBe('2026-03-14');
  });

  it('treats the genome as a cross-check: missing or partial readings never block', () => {
    const { ctx, data, glyphs } = world();
    expect(decideVerification({ ok: true, data, genome: null }, ctx)).toMatchObject({ state: 'AUTHENTIC', genome: { check: 'NOT_READ' } });
    const partial = glyphs.map((g, i) => (i < 5 ? (g + 1) % 16 : null));
    expect(decideVerification({ ok: true, data, genome: reading(partial) }, ctx)).toMatchObject({ state: 'AUTHENTIC', genome: { check: 'INCONCLUSIVE', read: 5 } });
    expect(decideVerification({ ok: true, data, genome: reading(glyphs.map((g) => (g + 1) % 16), 0.3) }, ctx)).toMatchObject({
      state: 'AUTHENTIC',
      genome: { check: 'INCONCLUSIVE', read: 0 },
    });
  });

  it('tolerates one misread glyph and flags two as GENOME_MISMATCH', () => {
    const { ctx, data, glyphs } = world();
    const misread = (n: number) => glyphs.map((g, i) => (i < n ? (g + 1) % 16 : g));
    expect(decideVerification({ ok: true, data, genome: reading(misread(1)) }, ctx)).toMatchObject({ state: 'AUTHENTIC', genome: { mismatches: 1 } });
    expect(decideVerification({ ok: true, data, genome: reading(misread(2)) }, ctx)).toMatchObject({ state: 'GENOME_MISMATCH', genome: { mismatches: 2 } });
  });

  it('is UNKNOWN for a validly signed code the registry does not hold', () => {
    const { ctx } = world();
    const unregistered = { ...ring, serial: ring.serial + 1 };
    const scan = (data: Uint8Array) => decideVerification({ ok: true, data, genome: null }, ctx);
    expect(scan(signed(unregistered))).toMatchObject({ state: 'UNKNOWN', reason: 'PRODUCT_NOT_REGISTERED' });
    expect(scan(signed(ring, { issue: 2 }))).toMatchObject({ state: 'UNKNOWN', reason: 'CODE_NOT_REGISTERED' });
    expect(scan(signed(ring, { nonce: Uint8Array.of(1, 2, 3, 4) }))).toMatchObject({ state: 'UNKNOWN', reason: 'CODE_NOT_REGISTERED' });
  });

  it('checks the signature before the genome version: only a signed unsupported version is MALFORMED', () => {
    const { ctx } = world();
    expect(decideVerification({ ok: true, data: signed(ring, { genomeVersion: 2 }), genome: null }, ctx)).toMatchObject({
      state: 'MALFORMED_CODE',
      reason: 'UNSUPPORTED_GENOME_VERSION',
    });
  });

  it('is INVALID_SIGNATURE for a key id it does not trust', () => {
    const { ctx } = world();
    const otherKey = issueCode(ring, { keyId: 2, seed }, { issue: 1, issuedAt: ISSUED_AT, nonce });
    expect(decideVerification({ ok: true, data: otherKey.data, genome: null }, ctx)).toMatchObject({ state: 'INVALID_SIGNATURE', reason: 'UNKNOWN_KEY' });
  });

  it('is MALFORMED_CODE for decode failures and frames that do not parse', () => {
    const { ctx, data } = world();
    expect(decideVerification({ ok: false, reason: 'NO_SEAL' }, ctx)).toEqual({ state: 'MALFORMED_CODE', reason: 'DECODE_NO_SEAL' });
    const flipped = data.slice();
    flipped[3] ^= 0x10;
    expect(decideVerification({ ok: true, data: flipped, genome: null }, ctx)).toEqual({ state: 'MALFORMED_CODE', reason: 'PAYLOAD_CRC' });
    expect(decideVerification({ ok: true, data: data.subarray(0, 78), genome: null }, ctx)).toEqual({ state: 'MALFORMED_CODE', reason: 'PAYLOAD_LENGTH' });
    const { payloadBytes, signature } = unframeCodeData(data);
    payloadBytes[0] = 0x21; // code version 2
    expect(decideVerification({ ok: true, data: frameCodeData(payloadBytes, signature), genome: null }, ctx)).toEqual({
      state: 'MALFORMED_CODE',
      reason: 'PAYLOAD_VERSION',
    });
  });

  it('never accepts any single-bit edit of the signed bytes, even with the CRC recomputed', () => {
    const { ctx, data, glyphs } = world();
    const { payloadBytes, signature } = unframeCodeData(data);
    const signedBytes = new Uint8Array([...payloadBytes, ...signature]);
    const states = new Set<VerificationState>();
    for (let bit = 0; bit < signedBytes.length * 8; bit++) {
      const edited = signedBytes.slice();
      edited[bit >> 3] ^= 0x80 >> (bit & 7);
      const frame = frameCodeData(edited.subarray(0, PAYLOAD_V1_LENGTH), edited.subarray(PAYLOAD_V1_LENGTH));
      states.add(decideVerification({ ok: true, data: frame, genome: reading(glyphs) }, ctx).state);
    }
    expect([...states].sort()).toEqual(['INVALID_SIGNATURE', 'MALFORMED_CODE']);
  });
});

describe('compareGenome', () => {
  it('counts only confident, non-null glyphs', () => {
    const expected = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(compareGenome(expected, null)).toEqual({ check: 'NOT_READ', read: 0, mismatches: 0 });
    expect(compareGenome(expected, { glyphs: [0, 1, 2, 3, 4, 5, 9, null], confidence: [1, 1, 1, 1, 1, 1, 1, 1] })).toEqual({
      check: 'MATCH',
      read: 7,
      mismatches: 1,
    });
    expect(compareGenome(expected, { glyphs: [9, 9, 2, 3, 4, 5, 6, 7], confidence: [0.4, 0.4, 1, 1, 1, 1, 1, 1] })).toEqual({
      check: 'MATCH',
      read: 6,
      mismatches: 0,
    });
  });
});

describe('issuance', () => {
  it('is deterministic for a given key, identity and nonce', () => {
    const seed = new Uint8Array(32).fill(7);
    const issue = () => issueCode(ring, { keyId: 1, seed }, { issue: 1, issuedAt: ISSUED_AT, nonce: Uint8Array.of(9, 9, 9, 9) });
    expect(equalBytes(issue().data, issue().data)).toBe(true);
  });

  it('draws reproducible entropy from a seed', () => {
    expect(demoEntropy(1)(16)).toEqual(demoEntropy(1)(16));
    expect(demoEntropy(1)(16)).not.toEqual(demoEntropy(2)(16));
  });
});

// ── npm run poc ────────────────────────────────────────────────────────────

describe('npm run poc', () => {
  const run = promisify(execFile);

  it('runs end to end and exits 0', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'orbes-poc-cli-'));
    try {
      const { stdout } = await run(process.execPath, ['--import', 'tsx', 'scripts/poc.ts', '--seed', '11', '--out', outDir], {
        cwd: GENOME_ROOT,
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 120_000,
      });
      expect(stdout).toContain('PROOF OF CONCEPT PASSED');
      expect(stdout).not.toContain('\x1b[');
      expect(readFileSync(join(outDir, 'orbes-code.svg'), 'utf8')).toMatch(/^<svg/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid seed with exit code 2', async () => {
    await expect(run(process.execPath, ['--import', 'tsx', 'scripts/poc.ts', '--seed', 'abc'], { cwd: GENOME_ROOT })).rejects.toMatchObject({ code: 2 });
  });
});
