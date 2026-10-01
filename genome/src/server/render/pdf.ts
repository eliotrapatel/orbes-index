/**
 * PDF back end (pdfkit). Pure vector: every code primitive becomes a filled
 * path built from the SAME path data as the SVG (`primitiveToPathData`), label
 * lettering and sheet marks are stroked paths. No raster image and no font
 * is ever written, so the file prints crisply at any size and a RIP cannot
 * resample anything machine-critical.
 *
 * Pages are sized in millimetres to the artifact (plus label) for single
 * artifacts, or to a standard paper size for multi-up sheets. Output is
 * deterministic for a given input and creation date (pdfkit derives the file
 * ID from the document info).
 */
import PDFDocument from 'pdfkit';
import { TAU, type Primitive } from '../../core/geometry.js';
import { primitiveToPathData } from '../../core/render/svg.js';
import { mixTone, mmToPt, type ArtifactScene, type StrokePath } from './scene.js';

export interface PdfPlacement {
  scene: ArtifactScene;
  /** Top-left corner of the scene on the page, in millimetres. */
  xMm: number;
  yMm: number;
}

export interface PdfPage {
  widthMm: number;
  heightMm: number;
  placements: readonly PdfPlacement[];
  /** Extra stroked paths in page millimetres (crop marks, footer). */
  marks?: readonly StrokePath[];
  /** Colour for `marks` (default black). */
  markColor?: string;
}

export interface PdfMeta {
  title: string;
  subject?: string;
  keywords?: string;
  /** Recorded as CreationDate/ModDate; also seeds the deterministic file ID. */
  creationDate: Date;
}

const FULL_TURN_EPSILON = 1e-9;

/** Same hole rule as the SVG renderer: rings (and full-turn arcs) are filled even-odd. */
function hasHole(p: Primitive): boolean {
  if (p.kind === 'ring') return p.r - p.width / 2 > 0;
  if (p.kind === 'arc') return p.end - p.start >= TAU - FULL_TURN_EPSILON && p.r - p.width / 2 > 0;
  return false;
}

function drawScene(doc: PDFKit.PDFDocument, scene: ArtifactScene, xMm: number, yMm: number): void {
  const vb = scene.viewBox;
  const s = mmToPt(scene.widthMm) / vb.w;
  doc.save();
  // Scene units → page points; pdfkit's user space is already y-down like SVG.
  doc.transform(s, 0, 0, s, mmToPt(xMm) - vb.x * s, mmToPt(yMm) - vb.y * s);
  if (scene.paper !== null) doc.rect(vb.x, vb.y, vb.w, vb.h).fill(scene.paper);

  for (const p of scene.primitives) {
    const tone = p.tone ?? 1;
    if (!(tone >= 0 && tone <= 1)) throw new RangeError(`tone must be in [0, 1], got ${tone}`);
    if (tone === 0) continue;
    const rule = hasHole(p) ? 'even-odd' : 'non-zero';
    doc.path(primitiveToPathData(p));
    if (tone === 1) {
      doc.fill(scene.ink, rule);
      continue;
    }
    const mixed = mixTone(scene.ink, scene.paper, tone);
    if (mixed !== undefined) {
      doc.fill(mixed, rule);
    } else {
      doc.fillOpacity(tone).fill(scene.ink, rule).fillOpacity(1);
    }
  }

  for (const st of scene.strokes) {
    doc.path(st.d).lineWidth(st.width).lineCap('round').lineJoin('round').stroke(scene.ink);
  }
  doc.restore();
}

/** Render pages to a PDF file. */
export async function renderPdf(pages: readonly PdfPage[], meta: PdfMeta): Promise<Uint8Array> {
  if (pages.length === 0) throw new RangeError('a PDF needs at least one page');
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    pdfVersion: '1.4',
    displayTitle: true,
    info: {
      Title: meta.title,
      Author: 'ORBES',
      Creator: 'ORBES GENOME CODE',
      Producer: 'ORBES GENOME CODE',
      ...(meta.subject ? { Subject: meta.subject } : {}),
      ...(meta.keywords ? { Keywords: meta.keywords } : {}),
      CreationDate: meta.creationDate,
      ModDate: meta.creationDate,
    },
  });

  const chunks: Uint8Array[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('data', (c: Uint8Array) => chunks.push(c));
    doc.on('end', () => resolve());
    doc.on('error', (e: unknown) => reject(e));
  });
  // If drawing throws, that error is the one reported; a stream error after it must not go unhandled.
  finished.catch(() => {});

  try {
    for (const page of pages) {
      doc.addPage({ size: [mmToPt(page.widthMm), mmToPt(page.heightMm)], margin: 0 });
      for (const pl of page.placements) drawScene(doc, pl.scene, pl.xMm, pl.yMm);
      if (page.marks && page.marks.length > 0) {
        doc.save();
        const k = mmToPt(1);
        doc.transform(k, 0, 0, k, 0, 0);
        for (const m of page.marks) {
          doc.path(m.d).lineWidth(m.width).lineCap('round').lineJoin('round').stroke(page.markColor ?? '#000000');
        }
        doc.restore();
      }
    }
  } finally {
    // Always end the stream so a drawing error cannot leave the promise pending forever.
    doc.end();
  }
  await finished;

  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** One artifact on a page sized exactly to it. */
export function sceneToPdf(scene: ArtifactScene, meta: PdfMeta): Promise<Uint8Array> {
  return renderPdf([{ widthMm: scene.widthMm, heightMm: scene.heightMm, placements: [{ scene, xMm: 0, yMm: 0 }] }], meta);
}
