/**
 * Payload size comparison behind CRYPTOGRAPHY §3.1 ("Why not CBOR or JSON").
 *
 *   npx tsx scripts/payload-encodings.ts          # Markdown table on stdout
 *   npx tsx scripts/payload-encodings.ts --json   # machine-readable
 *
 * Encodes the fields of the sample code (docs/vectors/code01-sample.json:
 * O26-J-00184, GENOME-01, key 1, issue 1, issued day 745, nonce 4f524253) in
 * the chosen fixed binary layout and in the alternatives, and derives what
 * each would cost in the printed code. CBOR is the core deterministic
 * encoding of RFC 8949 §4.2.1 (shortest heads, definite lengths, map keys
 * sorted by the bytewise order of their encodings), written out below so
 * the figures need no CBOR library. Deterministic: same output every run.
 */
import { pathToFileURL } from 'node:url';
import { CODE01, CODE01_DATA_BITS } from '../src/core/code/profile.js';
import { encodePayload, SIGNATURE_LENGTH, type CodePayloadV1 } from '../src/core/payload.js';

// ── Minimal deterministic CBOR (RFC 8949 §4.2.1) ───────────────────────────

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`CBOR argument ${n}`);
  const m = major << 5;
  if (n < 24) return [m | n];
  if (n < 0x100) return [m | 24, n];
  if (n < 0x10000) return [m | 25, n >> 8, n & 0xff];
  if (n < 0x1_0000_0000) return [m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  throw new RangeError('CBOR argument too large for this sketch');
}

function compareBytes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export function cborEncode(v: Cbor): Uint8Array {
  const out: number[] = [];
  const enc = (x: Cbor): number[] => {
    if (typeof x === 'number') return head(0, x);
    if (typeof x === 'string') {
      const b = [...new TextEncoder().encode(x)];
      return [...head(3, b.length), ...b];
    }
    if (x instanceof Uint8Array) return [...head(2, x.length), ...x];
    const entries = [...x].map(([k, val]) => ({ k: enc(k), v: enc(val) })).sort((a, b) => compareBytes(a.k, b.k));
    return [...head(5, entries.length), ...entries.flatMap((e) => [...e.k, ...e.v])];
  };
  out.push(...enc(v));
  return Uint8Array.from(out);
}

// ── The sample code's fields ───────────────────────────────────────────────

const SAMPLE: CodePayloadV1 = {
  codeVersion: 1,
  genomeVersion: 1,
  keyId: 1,
  identity: { year: 2026, categoryIndex: 1, serial: 184 },
  issue: 1,
  issuedDay: 745,
  nonce: Uint8Array.of(0x4f, 0x52, 0x42, 0x53),
};
const SAMPLE_PRODUCT_ID = 'O26-J-00184';
const SAMPLE_PACKED_IDENTITY = 0x341000b8;
const SAMPLE_GENOME_ID = 'G1-E1DC-BE52';

export interface EncodingRow {
  name: string;
  payloadBytes: number;
  /** payload ‖ signature (64) ‖ CRC-16 (2). */
  framedBytes: number;
  /** framed data + the same 85 Reed-Solomon parity bytes as CODE-01. */
  codewordBytes: number;
  /** A GF(256) Reed-Solomon block holds at most 255 bytes. */
  rsBlocks: number;
  /** Data-orbit cells needed relative to CODE-01 (same parity per block). */
  cellsVsCode01: number;
}

const PARITY = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes; // 85

function row(name: string, payloadBytes: number): EncodingRow {
  const framedBytes = payloadBytes + SIGNATURE_LENGTH + 2;
  const rsBlocks = framedBytes + PARITY <= 255 ? 1 : Math.ceil(framedBytes / (255 - PARITY));
  const codewordBytes = framedBytes + rsBlocks * PARITY;
  return { name, payloadBytes, framedBytes, codewordBytes, rsBlocks, cellsVsCode01: (codewordBytes * 8) / CODE01_DATA_BITS - 1 };
}

/** Every encoding of CRYPTOGRAPHY §3.1, measured on the sample code. */
export function payloadEncodings(): EncodingRow[] {
  const fixed = encodePayload(SAMPLE);
  const intKeys = (identity: Cbor) =>
    new Map<Cbor, Cbor>([
      [0, SAMPLE.codeVersion],
      [1, SAMPLE.genomeVersion],
      [2, SAMPLE.keyId],
      [3, identity],
      [4, SAMPLE.issue],
      [5, SAMPLE.issuedDay],
      [6, SAMPLE.nonce],
    ]);
  const stringKeys = new Map<Cbor, Cbor>([
    ['code_version', SAMPLE.codeVersion],
    ['genome_version', SAMPLE.genomeVersion],
    ['key_id', SAMPLE.keyId],
    ['product_id', SAMPLE_PRODUCT_ID],
    ['issue', SAMPLE.issue],
    ['issued_day', SAMPLE.issuedDay],
    ['nonce', SAMPLE.nonce],
    ['genome_id', SAMPLE_GENOME_ID],
  ]);
  const json = JSON.stringify({
    code_version: SAMPLE.codeVersion,
    genome_version: SAMPLE.genomeVersion,
    key_id: SAMPLE.keyId,
    product_id: SAMPLE_PRODUCT_ID,
    issue: SAMPLE.issue,
    issued_day: SAMPLE.issuedDay,
    nonce: Buffer.from(SAMPLE.nonce).toString('base64url'),
    genome_id: SAMPLE_GENOME_ID,
  });
  return [
    row('Fixed binary (chosen)', fixed.length),
    row('Deterministic CBOR, integer keys, packed identity', cborEncode(intKeys(SAMPLE_PACKED_IDENTITY)).length),
    row('Deterministic CBOR, integer keys, text product ID', cborEncode(intKeys(SAMPLE_PRODUCT_ID)).length),
    row('Deterministic CBOR, field-name keys (incl. genome_id)', cborEncode(stringKeys).length),
    row('JSON, field-name keys (incl. genome_id)', new TextEncoder().encode(json).length),
  ];
}

function markdown(rows: EncodingRow[]): string {
  const lines = ['| Encoding | Bytes | Framed data with signature + CRC | Effect on the code |', '|---|---:|---:|---|'];
  for (const r of rows) {
    const effect =
      r.rsBlocks === 1 && r.codewordBytes === CODE01.ecc.totalBytes
        ? `RS(${r.codewordBytes},${r.framedBytes}), 1 344 cells, 50 u`
        : `${r.codewordBytes}-byte codeword${r.rsBlocks > 1 ? ` in ${r.rsBlocks} RS blocks` : ''}, ${r.cellsVsCode01 >= 0 ? '+' : ''}${Math.round(r.cellsVsCode01 * 100)} % data cells`;
    lines.push(`| ${r.name} | ${r.payloadBytes} | ${r.framedBytes} | ${effect} |`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = payloadEncodings();
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(rows, null, 2)}\n` : `${markdown(rows)}\n`);
}

export { markdown as payloadEncodingsMarkdown };
