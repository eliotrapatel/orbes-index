/**
 * CRYPTOGRAPHY §3.1 (why the payload is a fixed binary layout, not CBOR or
 * JSON) publishes figures computed by scripts/payload-encodings.ts: the
 * table in the document must be exactly the script's output.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cborEncode, payloadEncodings, payloadEncodingsMarkdown } from '../../scripts/payload-encodings.js';

const DOC = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/CRYPTOGRAPHY.md');

describe('payload encodings (CRYPTOGRAPHY §3.1)', () => {
  it('encodes deterministic CBOR per RFC 8949 §4.2.1 (shortest heads, sorted map keys)', () => {
    expect([...cborEncode(23)]).toEqual([0x17]);
    expect([...cborEncode(24)]).toEqual([0x18, 0x18]);
    expect([...cborEncode(745)]).toEqual([0x19, 0x02, 0xe9]);
    expect([...cborEncode(0x341000b8)]).toEqual([0x1a, 0x34, 0x10, 0x00, 0xb8]);
    expect([...cborEncode('ab')]).toEqual([0x62, 0x61, 0x62]);
    expect([...cborEncode(Uint8Array.of(1, 2))]).toEqual([0x42, 1, 2]);
    // RFC 8949 §4.2.1: keys ordered by their encoded bytes ("b" (0x61 0x62) before "aa" (0x62 …)).
    expect([...cborEncode(new Map<string | number, number>([['aa', 1], ['b', 2], [10, 3]]))]).toEqual([0xa3, 0x0a, 0x03, 0x61, 0x62, 0x02, 0x62, 0x61, 0x61, 0x01]);
  });

  it('measures the fixed layout at 13 bytes / RS(164,79) and every alternative as larger', () => {
    const rows = payloadEncodings();
    expect(rows[0]).toMatchObject({ payloadBytes: 13, framedBytes: 79, codewordBytes: 164, rsBlocks: 1, cellsVsCode01: 0 });
    for (const r of rows.slice(1)) expect(r.payloadBytes).toBeGreaterThan(13);
  });

  it('is the table CRYPTOGRAPHY §3.1 publishes', () => {
    const doc = readFileSync(DOC, 'utf8');
    for (const line of payloadEncodingsMarkdown(payloadEncodings()).split('\n')) expect(doc).toContain(line);
  });
});
