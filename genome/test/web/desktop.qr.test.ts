/**
 * The SCAN page's code (desktop, BRIEF §5.4, plan §2(j)): shared/qr.ts against fixed reference matrices and read back by
 * the tests' own reader (test/support/qr-read.ts, written from ISO/IEC 18004 apart from the encoder).
 *
 *  - The reference matrices (test/fixtures/qr-reference.json: the SCAN page's address and three more, versions 1, 3, 5
 *    and 8, recorded at desktop step 13 and read then by Chromium's BarcodeDetector on macOS, the system's own reader):
 *    qrModules draws each of them module for module.
 *  - The SCAN page's address (DESKTOP.scanPage.url): byte mode, level M, the smallest version that holds it (3), read
 *    back as the address itself.
 *  - Texts of every length that fills a version 1 to 10 and the next byte over, plain and UTF-8 (é, ’, —): each read back
 *    whole, in the smallest version that holds its bytes, its format and version information valid, every block's
 *    Reed–Solomon syndromes zero.
 *  - A text longer than a version 40 at level M holds is refused (RangeError); the quiet zone is 4 modules.
 *  - The reader is no rubber stamp: a module turned in the data, in the format information, in a finder or in the version
 *    information makes it fail.
 *
 * The code drawn on the page (qrSvg, its whole pixels per module, its quiet zone) is read from a screenshot by
 * test/web/desktop.flows.e2e.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QR_QUIET, qrModules } from '../../src/web/shared/qr.js';
import { DESKTOP } from '../../src/web/verify/copy.js';
import { BYTE_CAPACITY_M, readQr } from '../support/qr-read.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'qr-reference.json');
interface Reference {
  text: string;
  bytes: number;
  version: number;
  mask: number;
  rows: string[];
}
const REFERENCES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { codes: Reference[] }).codes;

const rows = (m: readonly (readonly boolean[])[]) => m.map((r) => r.map((d) => (d ? '#' : '.')).join(''));
const bytes = (t: string) => new TextEncoder().encode(t).length;
/** The smallest version (1 to 10) whose byte capacity at level M holds `n` bytes. */
const smallest = (n: number) => BYTE_CAPACITY_M.findIndex((c) => c >= n) + 1;
const flip = (m: boolean[][], x: number, y: number) => m.map((r, j) => r.map((d, i) => (i === x && j === y ? !d : d)));

describe('the SCAN page’s code: shared/qr.ts (byte mode, level M)', () => {
  it('draws each reference matrix module for module', () => {
    expect(REFERENCES.map((r) => r.version)).toEqual([3, 1, 5, 8]);
    for (const ref of REFERENCES) {
      expect(bytes(ref.text)).toBe(ref.bytes);
      expect(rows(qrModules(ref.text))).toEqual(ref.rows);
      expect(readQr(ref.rows.map((r) => [...r].map((c) => c === '#')))).toEqual({ version: ref.version, level: 'M', mask: ref.mask, text: ref.text });
    }
  });

  it('codes the SCAN page’s address: version 3, level M, read back as the address', () => {
    expect(DESKTOP.scanPage.url).toBe('https://verify.theorbes.com/verify');
    const m = qrModules(DESKTOP.scanPage.url);
    expect(m).toHaveLength(29);
    const read = readQr(m);
    expect(read).toMatchObject({ version: 3, level: 'M', text: DESKTOP.scanPage.url });
    expect(read.version).toBe(smallest(bytes(DESKTOP.scanPage.url)));
    // Drawn the same each time (no state kept between codes).
    expect(rows(qrModules(DESKTOP.scanPage.url))).toEqual(rows(m));
  });

  it('reads back every length that fills a version 1 to 10, and the byte over, in the smallest version that holds it', () => {
    const lengths = [1, ...BYTE_CAPACITY_M.flatMap((c) => [c, c + 1])].filter((n) => n <= BYTE_CAPACITY_M.at(-1)!);
    for (const n of lengths) {
      for (const text of ['V'.repeat(n), `${'é’—'.repeat(Math.floor(n / 8))}${'x'.repeat(n - 8 * Math.floor(n / 8))}`]) {
        const m = qrModules(text);
        const read = readQr(m);
        expect(read.text).toBe(text);
        expect(read.level).toBe('M');
        expect(read.version).toBe(smallest(bytes(text)));
        expect(m).toHaveLength(17 + 4 * read.version);
      }
    }
  });

  it('refuses a text longer than a version 40 holds; its quiet zone is 4 modules', () => {
    expect(qrModules('x'.repeat(2331))).toHaveLength(177);
    expect(() => qrModules('x'.repeat(2332))).toThrow(RangeError);
    expect(QR_QUIET).toBe(4);
  });

  it('the reader fails on a module turned in the data, the format, a finder or the version information', () => {
    const v3 = qrModules(DESKTOP.scanPage.url);
    // A data module (bottom right, the first codeword's), a format bit (top left), the top-left finder's core.
    expect(() => readQr(flip(v3, 28, 28))).toThrow(/Reed–Solomon/);
    expect(() => readQr(flip(v3, 2, 8))).toThrow(/format information/);
    expect(() => readQr(flip(v3, 3, 3))).toThrow(/finder/);
    const v8 = qrModules(REFERENCES[3]!.text);
    expect(() => readQr(flip(v8, 49 - 11, 0))).toThrow(/version information/);
  });
});
