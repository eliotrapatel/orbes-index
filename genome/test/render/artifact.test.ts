import { inflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { encodeOrbesCode, renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData, signingMessage } from '../../src/core/payload.js';
import { generateEd25519KeyPair, signEd25519 } from '../../src/server/crypto/ed25519-node.js';
import {
  ARTIFACT_DEFAULTS,
  ARTIFACT_LIMITS,
  ARTIFACT_THEMES,
  ArtifactOptionsError,
  artifactFilename,
  readPngDpi,
  renderArtifact,
  resolveArtifactOptions,
  setPngDpi,
  type ArtifactInput,
  type ArtifactTheme,
} from '../../src/server/render/index.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireDecoder } from './decoder-support.js';

const identity = { year: 2026, categoryIndex: 1, serial: 184 };
const meta = { productId: 'O26-J-00184', issue: 1, createdAt: new Date('2026-02-01T00:00:00.000Z') };
let input: ArtifactInput;
let payload: Uint8Array;
let signature: Uint8Array;

beforeAll(() => {
  payload = encodePayload({ codeVersion: 1, genomeVersion: 1, keyId: 3, identity, issue: 1, issuedDay: 760, nonce: Uint8Array.of(9, 8, 7, 6) });
  const { privateKey } = generateEd25519KeyPair();
  signature = signEd25519(privateKey, signingMessage(payload));
  input = { data: frameCodeData(payload, signature), genomeGlyphs: computeGenome(packIdentity(identity)).glyphs };
});

const latin1 = (b: Uint8Array | string) => (typeof b === 'string' ? b : Buffer.from(b).toString('latin1'));

/** Concatenated, inflated content of every FlateDecode stream in a PDF. */
function pdfStreams(pdf: Uint8Array): string {
  const text = latin1(pdf);
  let out = '';
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = Buffer.from(pdf.subarray(start, end));
    try {
      out += inflateSync(raw).toString('latin1') + '\n';
    } catch {
      out += raw.toString('latin1') + '\n';
    }
    re.lastIndex = end;
  }
  return out;
}

/** The PDF without its (binary) stream bodies: dictionaries and objects only. */
function pdfObjects(pdf: Uint8Array): string {
  return latin1(pdf).replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, 'stream endstream');
}

describe('artifact options', () => {
  it('applies defaults and keeps widths to 0.01 mm', () => {
    expect(resolveArtifactOptions('svg')).toEqual(ARTIFACT_DEFAULTS);
    expect(resolveArtifactOptions('pdf', { widthMm: 12.3456 }).widthMm).toBe(12.35);
  });

  it('names the reference colourway classic; black is a deprecated alias of it', () => {
    expect(ARTIFACT_DEFAULTS.theme).toBe('classic');
    expect(resolveArtifactOptions('svg', { theme: 'black' }).theme).toBe('classic');
    expect(ARTIFACT_THEMES.classic).toEqual({ ink: '#0A0A0A', paper: '#FFFFFF' });
    expect(Object.keys(ARTIFACT_THEMES)).toEqual(['classic', 'inverted', 'ivory']);
  });

  it('refuses widths under 10 mm (below every print and scan study)', () => {
    expect(ARTIFACT_LIMITS.minWidthMm).toBe(10);
    expect(() => resolveArtifactOptions('pdf', { widthMm: 9.99 })).toThrow(/between 10 and 500 mm/);
    expect(resolveArtifactOptions('pdf', { widthMm: 10 }).widthMm).toBe(10);
  });

  it('rejects out-of-range or malformed options', () => {
    const bad: unknown[] = [
      { widthMm: 4.99 },
      { widthMm: 500.01 },
      { widthMm: '30' },
      { widthMm: Number.POSITIVE_INFINITY },
      { dpi: 71 },
      { dpi: 2401 },
      { dpi: 300.5 },
      { theme: 'gold' },
      { decor: 'yes' },
      { label: 1 },
    ];
    for (const o of bad) expect(() => resolveArtifactOptions('png', o as never), JSON.stringify(o)).toThrow(ArtifactOptionsError);
    expect(() => resolveArtifactOptions('gif' as never)).toThrow(ArtifactOptionsError);
  });

  it('caps PNG pixel dimensions (memory bound) but not vector formats', () => {
    expect(() => resolveArtifactOptions('png', { widthMm: 300, dpi: 1200 })).toThrow(/too large/);
    expect(() => resolveArtifactOptions('png', { widthMm: 80, dpi: 2400, label: true })).toThrow(/too large/);
    expect(resolveArtifactOptions('pdf', { widthMm: 300, dpi: 1200 }).widthMm).toBe(300);
    expect(resolveArtifactOptions('png', { widthMm: 60, dpi: 2400 }).dpi).toBe(2400);
  });

  it('builds ASCII file names', () => {
    const o = resolveArtifactOptions('png', { widthMm: 12.5, theme: 'ivory', label: true, dpi: 1200 });
    expect(artifactFilename(meta, o, 'png')).toBe('ORBES-O26-J-00184-I1-ivory-12.5mm-label-1200dpi.png');
    expect(artifactFilename({ productId: 'O26-J-00184"\r\n', issue: 2 }, resolveArtifactOptions('svg'), 'svg')).toBe(
      'ORBES-O26-J-00184-I2-classic-30mm.svg',
    );
  });
});

describe('SVG', () => {
  it('unlabeled artifacts are exactly the core renderer output', async () => {
    const r = await renderArtifact(input, 'svg', { widthMm: 22 }, meta);
    const model = encodeOrbesCode(input, { decor: true });
    const expected = renderOrbesCodeSvg(model, { ...ARTIFACT_THEMES.classic, decor: true, widthMm: 22, title: 'ORBES CODE O26-J-00184' });
    expect(r.body).toBe(expected);
    expect(r.contentType).toBe('image/svg+xml; charset=utf-8');
  });

  it.each(['classic', 'inverted', 'ivory'] as ArtifactTheme[])('theme %s sets paper and ink', async (theme) => {
    const r = await renderArtifact(input, 'svg', { theme }, meta);
    const body = r.body as string;
    expect(body).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-25 -25 50 50"/);
    expect(body).toContain(`fill="${ARTIFACT_THEMES[theme].paper}"`);
    expect(body).toContain(`<g fill="${ARTIFACT_THEMES[theme].ink}">`);
  });

  it('labeled artifacts extend the viewBox and add stroked lettering below the quiet zone', async () => {
    const r = await renderArtifact(input, 'svg', { label: true, widthMm: 50 }, meta);
    const body = r.body as string;
    expect(body).toContain('viewBox="-25 -25 50 57.5" width="50mm" height="57.5mm"');
    const label = body.slice(body.indexOf('data-layer="label"'));
    expect(label).toContain('stroke-linecap="round"');
    expect(label).not.toContain('<text'); // no font dependency
    // Every lettering coordinate lies below the code's quiet zone (y > 25) and inside the artifact.
    const ys = [...label.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => Number(m[2]));
    expect(ys.length).toBeGreaterThan(20);
    expect(Math.min(...ys)).toBeGreaterThan(25.5);
    expect(Math.max(...ys)).toBeLessThan(32.5);
    expect(body.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('decor can be omitted', async () => {
    const withDecor = (await renderArtifact(input, 'svg', {}, meta)).body as string;
    const without = (await renderArtifact(input, 'svg', { decor: false }, meta)).body as string;
    expect(withDecor).toContain('data-layer="decor"');
    expect(without).not.toContain('data-layer="decor"');
  });
});

describe('PNG', () => {
  it('has the PNG signature, exact pixel size for widthMm × dpi, and records the dpi', async () => {
    const r = await renderArtifact(input, 'png', { widthMm: 25.4, dpi: 400 }, meta);
    const bytes = r.body as Uint8Array;
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const img = PNG.sync.read(Buffer.from(bytes));
    expect([img.width, img.height]).toEqual([400, 400]);
    expect(readPngDpi(bytes)).toBeCloseTo(400, 0);

    const labeled = PNG.sync.read(Buffer.from((await renderArtifact(input, 'png', { widthMm: 25.4, dpi: 400, label: true }, meta)).body as Uint8Array));
    expect([labeled.width, labeled.height]).toEqual([400, 460]);
  });

  it.each(['classic', 'inverted', 'ivory'] as ArtifactTheme[])('theme %s: paper in the corner, ink at the seal core', async (theme) => {
    const img = PNG.sync.read(Buffer.from((await renderArtifact(input, 'png', { theme, widthMm: 20, dpi: 300 }, meta)).body as Uint8Array));
    const px = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return '#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const c = Math.floor(img.width / 2);
    expect(px(1, 1)).toBe(ARTIFACT_THEMES[theme].paper.toUpperCase());
    expect(px(c, c)).toBe(ARTIFACT_THEMES[theme].ink.toUpperCase());
  });

  it('setPngDpi replaces an existing pHYs chunk and refuses non-PNG input', async () => {
    const bytes = (await renderArtifact(input, 'png', { dpi: 300 }, meta)).body as Uint8Array;
    const again = setPngDpi(bytes, 1200);
    expect(readPngDpi(again)).toBeCloseTo(1200, 0);
    expect(again.length).toBe(bytes.length); // replaced, not duplicated
    expect(PNG.sync.read(Buffer.from(again)).width).toBe(PNG.sync.read(Buffer.from(bytes)).width);
    expect(() => setPngDpi(new Uint8Array(20), 300)).toThrow(RangeError);
  });

  describe('decodes back with the core decoder', () => {
    const cases: [string, Parameters<typeof renderArtifact>[2]][] = [
      ['classic', { theme: 'classic', widthMm: 30, dpi: 300 }],
      ['ivory', { theme: 'ivory', widthMm: 30, dpi: 300 }],
      ['inverted', { theme: 'inverted', widthMm: 30, dpi: 300 }],
      ['labeled, no decor', { label: true, decor: false, widthMm: 30, dpi: 300 }],
    ];
    it.each(cases)('%s', async (_name, opts) => {
      const decoder = await requireDecoder();
      const img = PNG.sync.read(Buffer.from((await renderArtifact(input, 'png', opts, meta)).body as Uint8Array));
      const res = decoder.decodeOrbesCode(decoder.rgbaToGray(img.data, img.width, img.height), { tryInverted: true, readGenome: true });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.payloadBytes).toEqual(payload);
      expect(res.signature).toEqual(signature);
      expect(res.data).toEqual(input.data);
      // A clean digital render needs no error correction at all.
      expect(res.quality.rsErrors + res.quality.rsErasures).toBe(0);
      expect(res.quality.inverted).toBe(opts.theme === 'inverted');
      // The genome orbit reads back as the signed identity's genome.
      expect(res.genome?.glyphs).toEqual(input.genomeGlyphs);
    });
  });
});

// pdftoppm (poppler) is a system tool, not a project dependency: this cross-check runs where it exists.
const hasPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPdftoppm)('PDF rasterised by an independent renderer (poppler)', () => {
  it.each(['classic', 'ivory'] as ArtifactTheme[])('%s, labeled: decodes back to the same code', async (theme) => {
    const decoder = await requireDecoder();
    const pdf = (await renderArtifact(input, 'pdf', { theme, label: true, widthMm: 30 }, meta)).body as Uint8Array;
    const dir = mkdtempSync(join(tmpdir(), 'orbes-pdf-'));
    try {
      writeFileSync(join(dir, 'a.pdf'), pdf);
      execFileSync('pdftoppm', ['-r', '300', '-png', '-singlefile', join(dir, 'a.pdf'), join(dir, 'a')]);
      const img = PNG.sync.read(readFileSync(join(dir, 'a.png')));
      // 30 × 34.5 mm at 300 dpi = 354.3 × 407.5 px (poppler rounds up).
      expect(Math.abs(img.width - 354.3)).toBeLessThan(1);
      expect(Math.abs(img.height - 407.5)).toBeLessThan(1);
      const res = decoder.decodeOrbesCode(decoder.rgbaToGray(img.data, img.width, img.height), { readGenome: true });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual(input.data);
        expect(res.genome?.glyphs).toEqual(input.genomeGlyphs);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PDF', () => {
  it('is a single page sized to the artifact (+ label area)', async () => {
    const plain = latin1((await renderArtifact(input, 'pdf', { widthMm: 25.4 }, meta)).body);
    expect(plain.startsWith('%PDF-1.4\n')).toBe(true);
    expect(plain.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(plain).toMatch(/\/MediaBox \[0 0 72 72\]/);
    expect(plain).toMatch(/\/Count 1\b/);
    const labeled = latin1((await renderArtifact(input, 'pdf', { widthMm: 50.8, label: true }, meta)).body);
    expect(labeled).toMatch(/\/MediaBox \[0 0 144 165\.6\]/);
    expect(labeled).toMatch(/\/Title \d+ 0 R/);
    expect(labeled).toContain('(ORBES CODE O26-J-00184)');
  });

  it('is pure vector: filled paths and stroked lettering, no raster image, no font', async () => {
    const pdf = (await renderArtifact(input, 'pdf', { label: true }, meta)).body as Uint8Array;
    // Dictionaries only: compressed stream bytes could contain any byte sequence by chance.
    expect(pdfObjects(pdf)).not.toMatch(/\/Subtype\s*\/Image|\/XObject|\/Font|\/DCTDecode|\/JPXDecode/);
    const content = pdfStreams(pdf);
    expect(content).not.toMatch(/\bBI\b|\bDo\b|\bTj\b|\bTJ\b|\bBT\b/); // no inline images, XObjects or text
    const model = encodeOrbesCode(input, { decor: true });
    const fills = (content.match(/\bf\*?\n/g) ?? []).length;
    // One fill per primitive plus the paper rectangle.
    expect(fills).toBe(model.primitives.length + 1);
    expect((content.match(/\bc\n/g) ?? []).length).toBeGreaterThan(1000); // arcs become Bézier curves
    expect(content).toMatch(/\bS\n/); // stroked label
  });

  it('is deterministic for the same creation date', async () => {
    const a = (await renderArtifact(input, 'pdf', {}, meta)).body as Uint8Array;
    const b = (await renderArtifact(input, 'pdf', {}, meta)).body as Uint8Array;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = (await renderArtifact(input, 'pdf', {}, { ...meta, createdAt: new Date('2026-02-02T00:00:00Z') })).body as Uint8Array;
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('K-only black (print shops): every colour is a DeviceCMYK K value, never RGB rich black', async () => {
    const r = await renderArtifact(input, 'pdf', { kOnly: true, label: true }, meta);
    expect(r.filename).toBe('ORBES-O26-J-00184-I1-classic-30mm-label-K.pdf');
    const content = pdfStreams(r.body as Uint8Array);
    expect(content).toMatch(/\/DeviceCMYK cs/);
    expect(content).toMatch(/\/DeviceCMYK CS/); // stroked label lettering too
    expect(content).not.toMatch(/\/DeviceRGB/);
    expect(content).toContain('0 0 0 1 scn'); // ink: K 100 %
    expect(content).toContain('0 0 0 0 scn'); // white paper: no ink
    // Reduced tones become K tints at the same tone: horizon 35 %, guides 25 %.
    expect(content).toContain('0 0 0 0.35 scn');
    expect(content).toContain('0 0 0 0.25 scn');
    for (const m of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) scn/g)) expect([m[1], m[2], m[3]]).toEqual(['0', '0', '0']);

    const inverted = pdfStreams((await renderArtifact(input, 'pdf', { kOnly: true, theme: 'inverted' }, meta)).body as Uint8Array);
    expect(inverted).toContain('0 0 0 1 scn'); // the black paper
    expect(inverted).toContain('0 0 0 0 scn'); // the white ink is knocked out
  });

  it('K-only black is a PDF option for the neutral colourways only', () => {
    expect(() => resolveArtifactOptions('pdf', { kOnly: true, theme: 'ivory' })).toThrow(/classic or inverted/);
    expect(() => resolveArtifactOptions('svg', { kOnly: true })).toThrow(/PDF/);
    expect(() => resolveArtifactOptions('png', { kOnly: true })).toThrow(/PDF/);
    expect(() => resolveArtifactOptions('pdf', { kOnly: 'yes' } as never)).toThrow(ArtifactOptionsError);
    expect(resolveArtifactOptions('pdf', {}).kOnly).toBe(false);
  });

  it('uses even-odd only for primitives with holes and the theme colours', async () => {
    const content = pdfStreams((await renderArtifact(input, 'pdf', { theme: 'ivory' }, meta)).body as Uint8Array);
    expect(content).toMatch(/\bf\*\n/); // rings
    // Ivory paper #F6F2EA as DeviceRGB components.
    expect(content).toContain(`${246 / 255} ${242 / 255} ${234 / 255} scn`);
  });
});
