/**
 * The PDF writer's layers (render/pdf.ts, plan NEXT LOT §3.2, step 2.2): a
 * page's ordered layers, drawn right after its fills: filled paths, stroked
 * paths with their own caps and joins, and clipped groups. In K-only mode a
 * layer may name its K tint, so 79t's warm greys print as K tints of the same
 * lightness; the file stays vector, K only, without a font or any text, and
 * deterministic.
 */
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderPdf, type PdfPage } from '../../src/server/render/index.js';

const DATE = new Date('2026-10-07T12:00:00.000Z');
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

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

const pdfObjects = (pdf: Uint8Array) => latin1(pdf).replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, 'stream endstream');

/** A page in the shape of 79t's monogram: a rule, a clipped guilloche, a knocked-out year. */
const PAGE: PdfPage = {
  widthMm: 95,
  heightMm: 62,
  placements: [],
  fills: [{ d: 'M0 0L1 0L1 1Z', color: '#000000' }],
  layers: [
    { kind: 'stroke', d: 'M40 5.25H5.25V56.75H40', width: 0.1125, cap: 'butt', join: 'miter', color: '#0A0A0A' },
    {
      kind: 'clip',
      clip: 'M60 15L80 15L80 30L60 30Z',
      items: [
        { kind: 'fill', d: 'M59 14L81 14L81 31L59 31Z', color: '#F1F1EE', k: 5.9 },
        { kind: 'stroke', d: 'M59 20C65 19 70 21 81 20', width: 0.06, cap: 'round', join: 'round', color: '#B4B4B1', k: 29.8 },
      ],
    },
    { kind: 'stroke', d: 'M70 22L72 22', width: 0.33, cap: 'round', join: 'round', color: '#FFFFFF', k: 0 },
    { kind: 'fill', d: 'M70 22L72 22L72 24Z', color: '#FFFFFF', k: 0, rule: 'even-odd' },
  ],
};

describe('PDF layers', () => {
  it('draws the layers in order after the fills, in page millimetres: strokes with their caps and joins, a clip around its items', async () => {
    const content = pdfStreams(await renderPdf([PAGE], { title: 'layers', creationDate: DATE, colorMode: 'k-only' }));
    const fill = content.indexOf('0 0 m');
    const rule = content.indexOf('40 5.25 m');
    const clip = content.indexOf('60 15 m');
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(rule).toBeGreaterThan(fill);
    expect(clip).toBeGreaterThan(rule);
    // The rule: butt caps (0 J), mitre joins (0 j), its width in millimetres under the page's mm transform.
    expect(content.slice(rule)).toMatch(/^40 5\.25 m[\s\S]*?0\.1125 w\n0 J\n0 j\n[\s\S]*?S\n/);
    // The clip: a non-zero W, its items inside save/restore, the clip ended without painting (n).
    expect(content.slice(clip)).toMatch(/^60 15 m[\s\S]*?h\nW n\n[\s\S]*?Q\n/);
    const group = content.slice(clip, content.indexOf('Q', clip));
    // K 5.9 and K 29.8 (pdfkit writes the percentage over 100, with the float's last digits).
    expect(group).toMatch(/\n0 0 0 0\.0590*(?:\d{0,4})? scn\nf\n/);
    expect(group).toMatch(/\n0 0 0 0\.298 SCN\nS\n/);
    expect(group).toMatch(/0\.06 w\n1 J\n1 j\n/);
    // After the group: the knock-out stroke and its even-odd fill, in no ink (K 0).
    const after = content.slice(content.indexOf('Q', clip));
    expect(after).toContain('0 0 0 0 SCN');
    expect(after).toMatch(/0 0 0 0 scn\nf\*\n/);
  });

  it('K only: every layer colour is C = M = Y = 0, a named K tint used as given, otherwise kSolid', async () => {
    const content = pdfStreams(await renderPdf([PAGE], { title: 'layers', creationDate: DATE, colorMode: 'k-only' }));
    expect(content).not.toMatch(/DeviceRGB/);
    for (const m of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) (scn|SCN)/g)) expect([m[1], m[2], m[3]]).toEqual(['0', '0', '0']);
    // The rule's #0A0A0A without a K: kSolid's solid black.
    expect(content).toContain('0 0 0 1 SCN');
    // A warm grey without its K cannot be written in K only.
    const warm: PdfPage = { ...PAGE, layers: [{ kind: 'fill', d: 'M0 0L1 0L1 1Z', color: '#F1F1EE' }] };
    await expect(renderPdf([warm], { title: 't', creationDate: DATE, colorMode: 'k-only' })).rejects.toThrow(/neutral colours/);
    const bad: PdfPage = { ...PAGE, layers: [{ kind: 'fill', d: 'M0 0L1 0L1 1Z', color: '#000000', k: 101 }] };
    await expect(renderPdf([bad], { title: 't', creationDate: DATE, colorMode: 'k-only' })).rejects.toThrow(/0\.\.100/);
    const named: PdfPage = { ...PAGE, layers: [{ kind: 'fill', d: 'M0 0L1 0L1 1Z', color: 'ORBES SCRATCH-OFF' }] };
    await expect(renderPdf([named], { title: 't', creationDate: DATE, colorMode: 'k-only' })).rejects.toThrow(/#rrggbb/);
    const thin: PdfPage = { ...PAGE, layers: [{ kind: 'stroke', d: 'M0 0L1 0', width: 0, cap: 'butt', join: 'miter', color: '#000000' }] };
    await expect(renderPdf([thin], { title: 't', creationDate: DATE, colorMode: 'k-only' })).rejects.toThrow(/positive width/);
  });

  it('RGB mode writes each layer in its own colour', async () => {
    const content = pdfStreams(await renderPdf([PAGE], { title: 'layers', creationDate: DATE }));
    expect(content).toContain('/DeviceRGB cs');
    expect(content).toMatch(/0\.945098\d* 0\.945098\d* 0\.933333\d* scn/);
  });

  it('stays vector: no font, no image, no text; and deterministic', async () => {
    const meta = { title: 'layers', creationDate: DATE, colorMode: 'k-only' as const };
    const a = await renderPdf([PAGE], meta);
    expect(pdfObjects(a)).not.toMatch(/\/Font|\/Subtype\s*\/Image|\/XObject|\/DCTDecode|\/JPXDecode|\/Separation/);
    expect(pdfStreams(a)).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\bBI\b|\bDo\b/);
    const b = await renderPdf([PAGE], meta);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // A page without layers is written exactly as before them.
    const plain: PdfPage = { widthMm: 10, heightMm: 10, placements: [], fills: [{ d: 'M0 0L5 0L5 5Z', color: '#000000' }] };
    expect(Buffer.from(await renderPdf([plain], meta)).equals(Buffer.from(await renderPdf([{ ...plain, layers: [] }], meta)))).toBe(true);
  });
});
