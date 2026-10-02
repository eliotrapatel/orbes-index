/**
 * A minimal WOFF2 reader for tests (W3C WOFF 2.0 §4–5): the header, the table
 * directory and the Brotli stream (node:zlib), enough to check what a shipped
 * web font contains: its character map, names and weight class.
 *
 * Only untransformed tables are read; glyf/loca and hmtx may be transformed
 * and are listed but not decoded. Font collections are refused.
 */
import { brotliDecompressSync } from 'node:zlib';

/** Known table tags, indexed by the 6-bit flag of a directory entry (WOFF2 §5.1). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
] as const;

export interface Woff2Table {
  tag: string;
  origLength: number;
  /** Length in the decompressed stream (the transformed length when transformed). */
  length: number;
  transformed: boolean;
}

export interface Woff2Font {
  /** sfnt flavour: 'OTTO' (CFF outlines) or '\0\1\0\0' (TrueType). */
  flavor: string;
  totalSfntSize: number;
  tables: Woff2Table[];
  /** Untransformed table bytes by tag. */
  data: Map<string, Uint8Array>;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

export function readWoff2(bytes: Uint8Array): Woff2Font {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 48 || ascii(bytes, 0) !== 'wOF2') throw new Error('not a WOFF2 file');
  const flavor = ascii(bytes, 4);
  if (flavor === 'ttcf') throw new Error('font collections are not supported');
  if (v.getUint32(8) !== bytes.length) throw new Error('WOFF2 length field does not match the file');
  const numTables = v.getUint16(12);
  const totalSfntSize = v.getUint32(16);
  const totalCompressedSize = v.getUint32(20);

  let p = 48;
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[p++];
      if (i === 0 && b === 0x80) throw new Error('UIntBase128 with a leading zero');
      value = value * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
    throw new Error('UIntBase128 longer than 5 bytes');
  };
  const tables: Woff2Table[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[p++];
    const index = flags & 0x3f;
    let tag: string;
    if (index === 63) {
      tag = ascii(bytes, p);
      p += 4;
    } else {
      tag = KNOWN_TAGS[index];
      if (!tag) throw new Error(`unknown table index ${index}`);
    }
    const version = flags >> 6;
    // glyf and loca: version 0 is the transform, 3 the null transform; every other table: 0 is null.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const origLength = base128();
    const length = transformed ? base128() : origLength;
    tables.push({ tag, origLength, length, transformed });
  }

  const stream = brotliDecompressSync(bytes.subarray(p, p + totalCompressedSize));
  const data = new Map<string, Uint8Array>();
  let at = 0;
  for (const t of tables) {
    if (!t.transformed) data.set(t.tag, new Uint8Array(stream.subarray(at, at + t.length)));
    at += t.length;
  }
  if (at !== stream.length) throw new Error(`decompressed stream is ${stream.length} bytes, the directory says ${at}`);
  return { flavor, totalSfntSize, tables, data };
}

function table(font: Woff2Font, tag: string): DataView {
  const t = font.data.get(tag);
  if (!t) throw new Error(`no ${tag} table`);
  return new DataView(t.buffer, t.byteOffset, t.byteLength);
}

/** Code points the font maps to a glyph (cmap format 12, else format 4, of a Unicode subtable). */
export function woff2CodePoints(font: Woff2Font): Set<number> {
  const v = table(font, 'cmap');
  const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
  for (let i = 0; i < v.getUint16(2); i++) {
    const offset = v.getUint32(4 + i * 8 + 4);
    subtables.push({ platform: v.getUint16(4 + i * 8), encoding: v.getUint16(4 + i * 8 + 2), offset, format: v.getUint16(offset) });
  }
  const unicode = (s: (typeof subtables)[number]) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
  const sub = subtables.find((s) => unicode(s) && s.format === 12) ?? subtables.find((s) => unicode(s) && s.format === 4);
  if (!sub) throw new Error('no Unicode cmap subtable of format 4 or 12');
  const out = new Set<number>();
  const o = sub.offset;
  if (sub.format === 12) {
    for (let g = 0, n = v.getUint32(o + 12); g < n; g++) {
      const start = v.getUint32(o + 16 + g * 12);
      const end = v.getUint32(o + 16 + g * 12 + 4);
      const glyph = v.getUint32(o + 16 + g * 12 + 8);
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
    }
    return out;
  }
  const segs = v.getUint16(o + 6) / 2;
  const ends = o + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const rangeOffsets = deltas + segs * 2;
  for (let s = 0; s < segs; s++) {
    const end = v.getUint16(ends + s * 2);
    const start = v.getUint16(starts + s * 2);
    const delta = v.getUint16(deltas + s * 2);
    const rangeOffset = v.getUint16(rangeOffsets + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        glyph = v.getUint16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(c);
    }
  }
  return out;
}

/** Windows (platform 3) names by name id, decoded from UTF-16BE. */
export function woff2Names(font: Woff2Font): Map<number, string> {
  const v = table(font, 'name');
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (v.getUint16(r) !== 3) continue;
    const id = v.getUint16(r + 6);
    const length = v.getUint16(r + 8);
    const offset = strings + v.getUint16(r + 10);
    let s = '';
    for (let k = 0; k < length; k += 2) s += String.fromCharCode(v.getUint16(offset + k));
    if (!out.has(id)) out.set(id, s);
  }
  return out;
}

/** OS/2 usWeightClass (400 regular, 500 medium, 700 bold). */
export function woff2WeightClass(font: Woff2Font): number {
  return table(font, 'OS/2').getUint16(4);
}

/** Parse a CSS unicode-range value (`U+0020-007E, U+00B7, …`) into its code points. */
export function parseUnicodeRange(value: string): Set<number> {
  const out = new Set<number>();
  for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i.exec(part);
    if (!m) throw new Error(`unsupported unicode-range part "${part}"`);
    const start = Number.parseInt(m[1], 16);
    const end = m[2] ? Number.parseInt(m[2], 16) : start;
    for (let c = start; c <= end; c++) out.add(c);
  }
  return out;
}
