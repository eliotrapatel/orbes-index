/**
 * Physical print test sheets (scripts/test-sheets.ts → docs/assets/test-sheets/).
 *
 * What a printer and a tester rely on is checked here: the codes are real
 * CODE-01 artifacts signed with the PUBLIC SAMPLE key (never a production
 * key) and labelled as such; every code sits at its exact physical size with
 * crop marks and a true 10 mm scale bar; every tag, textures included,
 * decodes from a clean raster of the SVG; the PDF is pure vector, A4, and
 * draws the same pages as the SVGs (checked with pdftoppm when the machine
 * has it); the committed files are exactly what the script produces.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { toBase64Url, toHex } from '../../src/core/bytes.js';
import { CODE01_SIZE } from '../../src/core/code/index.js';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import { unframeCodeData } from '../../src/core/payload.js';
import { verifyCodeSignature } from '../../src/core/verify/ed25519.js';
import {
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  PDF_FILENAME,
  RENDITIONS,
  SAMPLE_KEY_ID,
  SAMPLE_LABEL,
  SHEET_SIZES_MM,
  buildTestSheets,
  compactPath,
  pageToSvg,
  parsePath,
  pdfPathOps,
  renderTestSheetFiles,
  samplePublicKey,
  sampleCodeFor,
  sheetsToPdf,
  type PathSeg,
  type SheetPage,
} from '../../scripts/test-sheets.js';
import { createHarness, safeJson } from '../api/support.js';
import { readImage } from '../support/image-io.js';
import { svgToGray, type GrayImage } from '../support/raster.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', 'docs', 'assets', 'test-sheets');
const VECTORS = join(HERE, '..', '..', '..', 'docs', 'vectors', 'code01-sample.json');
const MARGIN = 12;

const PAGES: SheetPage[] = buildTestSheets();
const SVGS = PAGES.map(pageToSvg);

function hasPdftoppm(): boolean {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Rasterise a millimetre window of a page SVG at `pxPerMm`. */
function rasterWindow(svg: string, x: number, y: number, w: number, h: number, pxPerMm: number): GrayImage {
  const windowed = svg.replace(
    `viewBox="0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}" width="${PAGE_WIDTH_MM}mm" height="${PAGE_HEIGHT_MM}mm"`,
    `viewBox="${x} ${y} ${w} ${h}"`,
  );
  expect(windowed).not.toBe(svg);
  return svgToGray(windowed, { widthPx: Math.round(w * pxPerMm) });
}

/** Means of B×B pixel blocks (row-major, partial blocks dropped). */
function blockMeans(img: GrayImage, B: number): Float64Array {
  const bw = Math.floor(img.width / B);
  const bh = Math.floor(img.height / B) - 1; // the last row band may be clipped differently
  const out = new Float64Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) s += img.data[(by * B + y) * img.width + bx * B + x];
      out[by * bw + bx] = s / (B * B);
    }
  }
  return out;
}

/** Every point of every path segment (control points included). */
function points(segs: readonly PathSeg[]): { x: number; y: number }[] {
  return segs.flatMap((s) => (s.c === 'Z' ? [] : s.c === 'Q' ? [{ x: s.qx, y: s.qy }, s] : [s]));
}

describe('test sheet content', () => {
  it('is an A4 kit: instructions, then one page per rendition with all seven sizes', () => {
    expect(PAGES).toHaveLength(1 + RENDITIONS.length);
    expect(PAGES[0].tags).toHaveLength(0);
    for (const [i, r] of RENDITIONS.entries()) {
      const page = PAGES[i + 1];
      expect(page.number).toBe(i + 2);
      expect(page.slug).toBe(`page-0${i + 2}-${r.id}`);
      expect(page.tags.map((t) => t.sizeMm).sort((a, b) => a - b)).toEqual([...SHEET_SIZES_MM]);
      expect(new Set(page.tags.map((t) => t.rendition))).toEqual(new Set([r.id]));
    }
    expect(RENDITIONS.map((r) => r.id)).toEqual(['black-on-white', 'white-on-black', 'ivory', 'matte-grey', 'textured-paper', 'black-leather', 'metallic']);
    for (const svg of SVGS) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 210 297" width="210mm" height="297mm">')).toBe(true);
      expect(svg).toContain(SAMPLE_LABEL);
      for (const banned of ['<text', '<image', 'data:', '<script', '@font-face']) expect(svg, banned).not.toContain(banned);
    }
  });

  it('prints real CODE-01 codes signed with the published SAMPLE key, never a production key', () => {
    const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as { publicKeyHex: string };
    const pub = samplePublicKey();
    expect(toHex(pub)).toBe(vectors.publicKeyHex);
    const otherKey = ed25519.getPublicKey(new Uint8Array(32).fill(7));
    const serials = new Set<number>();
    for (const r of RENDITIONS) {
      const code = sampleCodeFor(r);
      const { payload } = unframeCodeData(code.data);
      expect(payload.keyId).toBe(SAMPLE_KEY_ID);
      expect(payload.identity).toEqual(code.identity);
      expect(code.productId).toBe(`O26-J-${900000 + r.index}`);
      expect(verifyCodeSignature(pub, code.payloadBytes, code.signature)).toBe(true);
      expect(verifyCodeSignature(otherKey, code.payloadBytes, code.signature)).toBe(false);
      serials.add(payload.identity.serial);
      // Decor follows the rendition (omitted on engraving).
      expect(code.model.primitives.some((p) => p.layer === 'decor')).toBe(r.decor);
    }
    expect(serials.size).toBe(RENDITIONS.length);
  });

  it('labels every tag with its size in tracked uppercase, SAMPLE - NOT VALID and the code id', () => {
    for (const page of PAGES.slice(1)) {
      const svg = SVGS[page.number - 1];
      for (const t of page.tags) {
        const group = new RegExp(`<g data-tag="${t.rendition}-${t.sizeMm}mm" data-size-mm="${t.sizeMm}">([\\s\\S]*?)\\n</g>`).exec(svg)?.[1];
        expect(group, `${t.rendition} ${t.sizeMm} mm`).toBeDefined();
        const texts = [...group!.matchAll(/data-text="([^"]+)"/g)].map((m) => m[1]);
        expect(texts).toEqual([`${t.sizeMm} MM`, SAMPLE_LABEL, t.productId]);
      }
    }
  });

  it('places every code at its exact physical size, inside its tag, inside the crop marks', () => {
    for (const page of PAGES.slice(1)) {
      const svg = SVGS[page.number - 1];
      const uses = [...svg.matchAll(/<use xlink:href="#code-[a-z-]+" data-size-mm="(\d+)" transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)"\/>/g)];
      expect(uses).toHaveLength(SHEET_SIZES_MM.length);
      for (const m of uses) {
        const size = Number(m[1]);
        expect(Number(m[4]) * CODE01_SIZE).toBeCloseTo(size, 6);
        const t = page.tags.find((x) => x.sizeMm === size)!;
        expect(Number(m[2])).toBeCloseTo(t.code.x + size / 2, 3);
        expect(Number(m[3])).toBeCloseTo(t.code.y + size / 2, 3);
        // The tag frames the code with at least 3 mm of substrate on every side.
        expect(t.code.x - t.tag.x).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(t.tag.x + t.tag.w - (t.code.x + t.code.w)).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(t.code.y - t.tag.y).toBeCloseTo(3, 9);
      }
      // Crop marks: two ticks per corner, four corners per tag, all outside the tag.
      const marks = parsePath(/data-role="crop-marks" d="([^"]+)"/.exec(svg)![1]);
      expect(marks.filter((s) => s.c === 'M')).toHaveLength(8 * page.tags.length);
      for (const p of points(marks)) {
        for (const t of page.tags) {
          const inside = p.x > t.tag.x + 1e-6 && p.x < t.tag.x + t.tag.w - 1e-6 && p.y > t.tag.y + 1e-6 && p.y < t.tag.y + t.tag.h - 1e-6;
          expect(inside).toBe(false);
        }
      }
      // Tags never overlap.
      for (const a of page.tags) {
        for (const b of page.tags) {
          if (a === b) continue;
          const apart = a.tag.x + a.tag.w <= b.tag.x || b.tag.x + b.tag.w <= a.tag.x || a.tag.y + a.tag.h <= b.tag.y || b.tag.y + b.tag.h <= a.tag.y;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('draws a true 10 mm scale bar on every page and a 100 mm ruler on the cover', () => {
    for (const svg of SVGS) {
      const bar = parsePath(/data-role="scale-bar" d="([^"]+)"/.exec(svg)![1]);
      const [m, l] = bar;
      expect(m.c).toBe('M');
      expect(l.c).toBe('L');
      if (m.c === 'M' && l.c === 'L') {
        expect(l.x - m.x).toBeCloseTo(10, 6);
        expect(l.y).toBeCloseTo(m.y, 6);
      }
    }
    const ruler = parsePath(/data-role="ruler-100mm" d="([^"]+)"/.exec(SVGS[0])![1]);
    const xs = points(ruler).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6);
    expect(ruler.filter((s) => s.c === 'M')).toHaveLength(1 + 101);
  });

  it('keeps every mark on the page and all lettering inside the 12 mm margins', () => {
    for (const [i, page] of PAGES.entries()) {
      const svg = SVGS[i];
      let texts = 0;
      for (const m of svg.matchAll(/<path fill="none"[^>]* d="([^"]+)"\/>/g)) {
        const pts = points(parsePath(m[1]));
        const label = /data-text="([^"]*)"/.exec(m[0])?.[1];
        const isText = label !== undefined;
        if (isText) texts++;
        for (const p of pts) {
          const lo = isText ? MARGIN - 0.6 : 0;
          expect(p.x, `page ${page.number}: ${label ?? 'mark'}`).toBeGreaterThanOrEqual(lo);
          expect(p.x, `page ${page.number}: ${label ?? 'mark'}`).toBeLessThanOrEqual(PAGE_WIDTH_MM - lo);
          expect(p.y).toBeGreaterThanOrEqual(isText ? MARGIN - 4 : 0);
          expect(p.y).toBeLessThanOrEqual(PAGE_HEIGHT_MM - (isText ? 4 : 0));
        }
      }
      expect(texts).toBeGreaterThan(20);
    }
  });
});

describe('sample codes against the verification service', () => {
  it('are rejected as INVALID SIGNATURE by a verifier holding its own key (what the sheets promise)', async () => {
    const h = await createHarness();
    try {
      const c = h.client();
      for (const r of RENDITIONS) {
        const res = await c.post('/api/v1/verify', { code: toBase64Url(sampleCodeFor(r).data) });
        expect(res.statusCode, res.body).toBe(200);
        expect((safeJson(res) as { state: string }).state, r.id).toBe('INVALID_SIGNATURE');
      }
    } finally {
      await h.close();
    }
  }, 60_000);
});

describe('test sheet decodability', () => {
  it('every tag of every rendition decodes from a clean raster of its SVG (textures and labels included)', () => {
    const pxPerU = 6;
    for (const page of PAGES.slice(1)) {
      const r = RENDITIONS[page.number - 2];
      const code = sampleCodeFor(r);
      const svg = SVGS[page.number - 1];
      for (const t of page.tags) {
        const pxPerMm = (pxPerU * CODE01_SIZE) / t.sizeMm;
        const img = rasterWindow(svg, t.tag.x - 1, t.tag.y - 1, t.tag.w + 2, t.tag.h + 2, pxPerMm);
        const res = decodeOrbesCode(img, { tryInverted: true });
        expect(res.ok, `${r.id} ${t.sizeMm} mm: ${res.ok ? '' : `${res.reason} ${res.detail ?? ''}`}`).toBe(true);
        if (res.ok) {
          expect(toHex(res.data)).toBe(toHex(code.data));
          expect(res.quality.inverted).toBe(r.polarity === 'light-on-dark');
          expect(verifyCodeSignature(samplePublicKey(), res.payloadBytes, res.signature)).toBe(true);
        }
      }
    }
  }, 90_000);
});

describe('path pipeline (shared by the SVG and PDF back ends)', () => {
  it('compacts path data losslessly at the requested precision, with no drift', () => {
    const d = 'M10.004 20.006L30.111 20.006L30.111 40.2A5 5 0 0 1 35.2 45.3Q36 47 38.123 46.987Z M1 1h2v3l-1 -1z';
    const segs = parsePath(d);
    const compact = compactPath(segs, 2);
    expect(compact.length).toBeLessThan(d.length);
    const back = parsePath(compact);
    expect(back.map((s) => s.c)).toEqual(segs.map((s) => s.c));
    back.forEach((s, i) => {
      const o = segs[i];
      if (s.c === 'Z' || o.c === 'Z') return;
      expect(s.x).toBeCloseTo(Math.round(o.x * 100) / 100, 9);
      expect(s.y).toBeCloseTo(Math.round(o.y * 100) / 100, 9);
    });
    // 1000 small steps: absolute positions stay exact (offsets are taken between rounded points).
    let walk = 'M0 0';
    for (let k = 1; k <= 1000; k++) walk += `L${(k * 0.0137).toFixed(4)} ${(Math.sin(k) * 3).toFixed(4)}`;
    const last = parsePath(compactPath(parsePath(walk), 2)).at(-1)!;
    expect(last.c === 'L' && Math.abs(last.x - Math.round(13.7 * 100) / 100)).toBeLessThan(1e-9);
  });

  it('converts arcs to cubic Béziers that stay on the circle (radial error < 3e-4 r)', () => {
    for (const [sweep, large] of [
      [1, 0],
      [0, 0],
      [1, 1],
      [0, 1],
    ]) {
      const r = 7.3;
      const a0 = 0.4;
      const a1 = a0 + (sweep ? 1 : -1) * (large ? 4.5 : 1.3);
      const p0 = { x: 3 + r * Math.cos(a0), y: -2 + r * Math.sin(a0) };
      const p1 = { x: 3 + r * Math.cos(a1), y: -2 + r * Math.sin(a1) };
      const ops = pdfPathOps(parsePath(`M${p0.x} ${p0.y}A${r} ${r} 0 ${large} ${sweep} ${p1.x} ${p1.y}`));
      const curves = ops.split('\n').filter((l) => l.endsWith(' c'));
      expect(curves.length).toBe(large ? 3 : 1);
      let start = p0;
      for (const c of curves) {
        const [x1, y1, x2, y2, x3, y3] = c.split(' ').slice(0, 6).map(Number);
        for (let t = 0; t <= 1; t += 0.125) {
          const u = 1 - t;
          const x = u * u * u * start.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          const y = u * u * u * start.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
          expect(Math.abs(Math.hypot(x - 3, y + 2) - r)).toBeLessThan(3e-4 * r + 1e-3);
        }
        start = { x: x3, y: y3 };
      }
      expect(start.x).toBeCloseTo(p1.x, 3);
      expect(start.y).toBeCloseTo(p1.y, 3);
    }
  });
});

describe('test sheet PDF', () => {
  it('is an 8-page A4 vector PDF: no fonts, no images, one Form XObject per code page', async () => {
    const pdf = Buffer.from(await sheetsToPdf(PAGES)).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.match(/\/Type \/Page\n/g)).toHaveLength(PAGES.length);
    expect(pdf.match(/\/MediaBox \[0 0 595\.275591 841\.889764\]/g)).toHaveLength(PAGES.length);
    expect(pdf).not.toMatch(/\/Font\b/);
    expect(pdf).not.toMatch(/\/Subtype \/Image/);
    expect(pdf.match(/\/Subtype \/Form/g)).toHaveLength(RENDITIONS.length);
    expect(pdf).toContain('SAMPLE - NOT VALID');
  });

  it.runIf(hasPdftoppm())(
    'draws the same pages as the SVGs, and its codes decode (rasterised with pdftoppm)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'orbes-sheets-'));
      try {
        const pdfPath = join(ASSETS, PDF_FILENAME);
        // Whole pages at 100 dpi against resvg at the same scale. Splash and resvg draw
        // hairline strokes with different weights, so pages are compared as 2 mm block
        // averages: geometry must agree, stroke rendering may differ. (Calibration: the
        // aligned pages score ≤ 2.8 mean / ≤ 44 max; shifting one by 1 mm scores
        // ≥ 3.4 mean and ≥ 56 max.)
        const dpi = 100;
        execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-png', pdfPath, join(dir, 'p')]);
        for (const page of PAGES) {
          const fromPdf = readImage(join(dir, `p-${page.number}.png`));
          const fromSvg = svgToGray(SVGS[page.number - 1], { widthPx: fromPdf.width });
          // The two rasterisers round the page height differently by at most one row.
          expect(Math.abs(fromSvg.height - fromPdf.height)).toBeLessThanOrEqual(1);
          const a = blockMeans(fromPdf, 8);
          const b = blockMeans(fromSvg, 8);
          let sum = 0;
          let max = 0;
          for (let k = 0; k < Math.min(a.length, b.length); k++) {
            const d = Math.abs(a[k] - b[k]);
            sum += d;
            max = Math.max(max, d);
          }
          expect(sum / a.length, `page ${page.number} mean block difference`).toBeLessThan(3.2);
          expect(max, `page ${page.number} worst block difference`).toBeLessThan(50);
        }
        // The 20 mm and 10 mm codes of every rendition page, cropped from the PDF at ≈ 6 px per u.
        for (const page of PAGES.slice(1)) {
          const code = sampleCodeFor(RENDITIONS[page.number - 2]);
          for (const size of [10, 20]) {
            const t = page.tags.find((x) => x.sizeMm === size)!;
            const res = Math.round((6 * CODE01_SIZE * 25.4) / size);
            const k = res / 25.4;
            const args = ['-r', String(res), '-gray', '-png', '-f', String(page.number), '-l', String(page.number)];
            args.push('-x', String(Math.floor((t.tag.x - 1) * k)), '-y', String(Math.floor((t.tag.y - 1) * k)));
            args.push('-W', String(Math.ceil((t.tag.w + 2) * k)), '-H', String(Math.ceil((t.tag.h + 2) * k)));
            const out = join(dir, `crop-${page.number}-${size}`);
            execFileSync('pdftoppm', [...args, '-singlefile', pdfPath, out]);
            const r = decodeOrbesCode(readImage(`${out}.png`), { tryInverted: true });
            expect(r.ok, `page ${page.number}, ${size} mm`).toBe(true);
            if (r.ok) expect(toHex(r.data)).toBe(toHex(code.data));
          }
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    90_000,
  );
});

describe('committed test sheets', () => {
  it('are byte-for-byte what scripts/test-sheets.ts produces (run it after any change)', async () => {
    const files = await renderTestSheetFiles();
    expect(files.map((f) => f.name)).toEqual([...PAGES.map((p) => `${p.slug}.svg`), PDF_FILENAME]);
    for (const f of files) {
      const path = join(ASSETS, f.name);
      expect(existsSync(path), `${path} missing: run npx tsx scripts/test-sheets.ts`).toBe(true);
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(f.bytes)), `${f.name} is stale: run npx tsx scripts/test-sheets.ts`).toBe(true);
    }
    // Reasonably small: the whole kit stays under 2.5 MB, the PDF under 1 MB.
    const total = files.reduce((s, f) => s + f.bytes.length, 0);
    expect(total).toBeLessThan(2.5 * 1024 * 1024);
    expect(files.find((f) => f.name === PDF_FILENAME)!.bytes.length).toBeLessThan(1024 * 1024);
  });
});
