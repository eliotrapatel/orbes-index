import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseUnicodeRange, readWoff2, woff2CodePoints } from './woff2.js';

const FONT = join(dirname(fileURLToPath(import.meta.url)), '../../src/web/shared/fonts/gravesend-sans-500.woff2');

describe('WOFF2 reader (test support)', () => {
  it('reads the directory consistently with the header: the sfnt it rebuilds has the declared size', () => {
    const font = readWoff2(readFileSync(FONT));
    expect(font.tables.map((t) => t.tag)).toEqual(expect.arrayContaining(['cmap', 'head', 'name', 'OS/2', 'CFF ']));
    // sfnt header (12) + one 16-byte record per table + each table padded to 4 bytes.
    const sfnt = 12 + 16 * font.tables.length + font.tables.reduce((n, t) => n + ((t.origLength + 3) & ~3), 0);
    expect(sfnt).toBe(font.totalSfntSize);
    expect(woff2CodePoints(font).has('A'.codePointAt(0)!)).toBe(true);
  });

  it('refuses what is not a WOFF2 file or whose length field lies', () => {
    expect(() => readWoff2(new TextEncoder().encode('wOFF'.padEnd(64, '\0')))).toThrow(/not a WOFF2/);
    const bytes = new Uint8Array(readFileSync(FONT));
    expect(() => readWoff2(bytes.subarray(0, bytes.length - 1))).toThrow(/length/);
  });

  it('parses CSS unicode-range lists', () => {
    expect([...parseUnicodeRange('U+0041-0043, U+00B7')]).toEqual([0x41, 0x42, 0x43, 0xb7]);
    expect(() => parseUnicodeRange('U+4??')).toThrow(/unsupported/);
  });
});
