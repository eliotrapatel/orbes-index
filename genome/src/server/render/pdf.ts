/**
 * PDF back end (pdfkit). Pure vector: every code primitive becomes a filled
 * path built from the SAME path data as the SVG (`primitiveToPathData`), label
 * lettering and sheet marks are stroked paths. No raster image and no font
 * is ever written, so the file prints crisply at any size and a RIP cannot
 * resample anything machine-critical.
 *
 * Colour: DeviceRGB by default (the screen colours of the theme). With
 * `colorMode: 'k-only'` every colour is written as DeviceCMYK with C = M =
 * Y = 0: a dark ink or paper (the theme's #0A0A0A included) becomes solid
 * K 100 %, a light one no ink (K 0), and a reduced tone the K tint at that
 * tone between the two (decor horizon 35 %, guides 25 %). For print shops
 * that would otherwise convert RGB black into a four-colour rich black. Only
 * neutral colours can be expressed that way.
 *
 * Spot colours: a page may also carry flat fills (`shapes`) in a named spot
 * colour, written as a Separation colour space with a CMYK alternate (how a
 * viewer or an office printer shows it). The certificate card used one for
 * its scratch-off panel until the card 79t, which has none (plan NEXT LOT
 * §3.2). A shape can be set to overprint (OP/op true, OPM 1): its ink is then
 * laid over what is under it instead of knocking it out, so what is printed
 * beneath it stays on its own plate.
 *
 * Plates, layers and links: a page may also carry flat fills drawn first,
 * under everything else (`fills`: the ivory plate of the ownership
 * certificate's GENOME); ordered layers drawn right after them (`layers`, the
 * certificate card 79t, plan NEXT LOT §3.2): a filled path, a stroked path
 * with its own width, caps and joins, and a clipped group (its items drawn
 * inside a clip path). In `k-only` mode a layer may name its K percentage, so
 * a slightly warm grey (#F1F1EE, #B4B4B1) prints as the K tint of the same
 * lightness, which kSolid cannot express; without one, its colour goes
 * through kSolid like any other. And link annotations (`links`: a rectangle that opens a URL, the
 * certificate's live address). A link is the one piece of text a PDF here
 * holds: its URL, in the annotation, never as lettering a font would draw.
 *
 * Pages are sized in millimetres to the artifact (plus label) for single
 * artifacts, or to a standard paper size for multi-up sheets. Output is
 * deterministic for a given input and creation date (pdfkit derives the file
 * ID from the document info).
 */
import PDFDocument from 'pdfkit';
import { TAU, type Primitive } from '../../core/geometry.js';
import { primitiveToPathData } from '../../core/render/svg.js';
import { mixTone, mmToPt, parseHexColor, type ArtifactScene, type StrokePath } from './scene.js';

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
  /** Extra stroked paths in page millimetres (crop marks, footer, card lettering). */
  marks?: readonly StrokePath[];
  /** Colour for `marks` (default black). */
  markColor?: string;
  /** Flat fills in page millimetres, drawn last, over the placements and marks (a spot-colour panel). */
  shapes?: readonly PdfShape[];
  /** Flat fills in page millimetres, drawn first, under the placements and marks (a plate). */
  fills?: readonly PdfShape[];
  /** Ordered layers in page millimetres, drawn right after `fills`, before the placements, marks and shapes. */
  layers?: readonly PdfLayer[];
  /** Link annotations in page millimetres: a rectangle that opens `url` (http or https only). */
  links?: readonly PdfLink[];
}

/** A link annotation: the rectangle (page millimetres, y down) a click opens `url` from. */
export interface PdfLink {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  url: string;
}

/** A named spot colour: a Separation colour space the print shop sees as its own plate. */
export interface PdfSpotColor {
  /** Separation name, e.g. 'ORBES SCRATCH-OFF' (printable ASCII). */
  name: string;
  /** CMYK alternate in percent: how viewers, proofs and office printers show the ink. */
  cmyk: readonly [number, number, number, number];
}

/** A flat fill (aplat). */
export interface PdfShape {
  /** Closed path data in page millimetres. */
  d: string;
  /** '#rrggbb', or the name of a spot colour declared in `PdfMeta.spotColors` (always at 100 % tint). */
  color: string;
  /** Lay the ink over what is under it instead of knocking it out (OP/op true, OPM 1). */
  overprint?: boolean;
  rule?: 'non-zero' | 'even-odd';
}

/** How a layer is inked: its colour ('#rrggbb'), and in `k-only` mode its K percentage when given (0..100). */
export interface PdfLayerInk {
  color: string;
  /** K-only output: this K tint instead of kSolid(color) (required for a colour that is not neutral). */
  k?: number;
}

/** A filled path (non-zero unless said). */
export interface PdfFillLayer extends PdfLayerInk {
  kind: 'fill';
  d: string;
  rule?: 'non-zero' | 'even-odd';
}

/** A stroked path with its own width (mm), caps and joins. */
export interface PdfStrokeLayer extends PdfLayerInk {
  kind: 'stroke';
  d: string;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
}

/** A clipped group: its items drawn inside the clip path (non-zero unless said), in order. */
export interface PdfClipLayer {
  kind: 'clip';
  clip: string;
  rule?: 'non-zero' | 'even-odd';
  items: readonly PdfLayer[];
}

export type PdfLayer = PdfFillLayer | PdfStrokeLayer | PdfClipLayer;

export interface PdfMeta {
  title: string;
  subject?: string;
  keywords?: string;
  /** Recorded as CreationDate/ModDate; also seeds the deterministic file ID. */
  creationDate: Date;
  /** 'rgb' (default) or 'k-only' (DeviceCMYK, K channel only; neutral colours only). */
  colorMode?: PdfColorMode;
  /** Spot colours that `shapes` may name (spot colours are never converted, whatever the colour mode). */
  spotColors?: readonly PdfSpotColor[];
}

export type PdfColorMode = 'rgb' | 'k-only';

type Cmyk = [number, number, number, number];

/** K-only solid of a neutral colour: dark (≥ 50 % grey) → K 100, light → K 0. */
export function kSolid(color: string): number {
  const rgb = parseHexColor(color);
  if (!rgb || rgb[0] !== rgb[1] || rgb[1] !== rgb[2]) throw new RangeError(`K-only output needs neutral colours, got ${color}`);
  return rgb[0] < 128 ? 100 : 0;
}

const kTint = (percent: number): Cmyk => [0, 0, 0, Math.round(percent * 100) / 100];

const FULL_TURN_EPSILON = 1e-9;

/** Same hole rule as the SVG renderer: rings (and full-turn arcs) are filled even-odd. */
function hasHole(p: Primitive): boolean {
  if (p.kind === 'ring') return p.r - p.width / 2 > 0;
  if (p.kind === 'arc') return p.end - p.start >= TAU - FULL_TURN_EPSILON && p.r - p.width / 2 > 0;
  return false;
}

function drawScene(doc: PDFKit.PDFDocument, scene: ArtifactScene, xMm: number, yMm: number, mode: PdfColorMode): void {
  const kOnly = mode === 'k-only';
  const inkK = kOnly ? kSolid(scene.ink) : 100;
  const paperK = kOnly && scene.paper !== null ? kSolid(scene.paper) : 0;
  const vb = scene.viewBox;
  const s = mmToPt(scene.widthMm) / vb.w;
  doc.save();
  // Scene units → page points; pdfkit's user space is already y-down like SVG.
  doc.transform(s, 0, 0, s, mmToPt(xMm) - vb.x * s, mmToPt(yMm) - vb.y * s);
  if (scene.paper !== null) doc.rect(vb.x, vb.y, vb.w, vb.h).fill(kOnly ? kTint(paperK) : scene.paper);

  for (const p of scene.primitives) {
    const tone = p.tone ?? 1;
    if (!(tone >= 0 && tone <= 1)) throw new RangeError(`tone must be in [0, 1], got ${tone}`);
    if (tone === 0) continue;
    const rule = hasHole(p) ? 'even-odd' : 'non-zero';
    doc.path(primitiveToPathData(p));
    if (kOnly) {
      // The same tone rule as the RGB mix, applied to the K values of paper and ink.
      doc.fill(kTint(paperK + (inkK - paperK) * tone), rule);
      continue;
    }
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
    doc.path(st.d).lineWidth(st.width).lineCap('round').lineJoin('round').stroke(kOnly ? kTint(inkK) : scene.ink);
  }
  doc.restore();
}

const SPOT_NAME_RE = /^[\x21-\x7e](?:[\x20-\x7e]{0,62}[\x21-\x7e])?$/;
/** ExtGState resource name of the overprint state (pdfkit names its opacity states Gs1, Gs2, …). */
const OVERPRINT_GS = 'GsOP';

/** The spot colour API of pdfkit 0.20, absent from its type definitions. */
type SpotColorDoc = PDFKit.PDFDocument & { addSpotColor(name: string, c: number, m: number, y: number, k: number): unknown };

function declareSpotColors(doc: PDFKit.PDFDocument, spots: readonly PdfSpotColor[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const spot of spots) {
    if (!SPOT_NAME_RE.test(spot.name) || spot.name.startsWith('#') || names.has(spot.name)) throw new RangeError(`invalid spot colour name ${JSON.stringify(spot.name)}`);
    if (spot.cmyk.length !== 4 || !spot.cmyk.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) throw new RangeError(`spot colour ${spot.name}: CMYK must be four values in 0..100`);
    (doc as SpotColorDoc).addSpotColor(spot.name, ...(spot.cmyk as [number, number, number, number]));
    names.add(spot.name);
  }
  return names;
}

function drawShapes(doc: PDFKit.PDFDocument, shapes: readonly PdfShape[], spots: ReadonlySet<string>, mode: PdfColorMode, overprint: () => PDFKit.PDFKitReference): void {
  doc.save();
  const k = mmToPt(1);
  doc.transform(k, 0, 0, k, 0, 0);
  for (const shape of shapes) {
    let color: string | Cmyk;
    if (spots.has(shape.color)) color = shape.color;
    else if (parseHexColor(shape.color)) color = mode === 'k-only' ? kTint(kSolid(shape.color)) : shape.color;
    else throw new RangeError(`unknown colour ${JSON.stringify(shape.color)}: not hex and not a declared spot colour`);
    doc.save();
    if (shape.overprint) {
      doc.page.ext_gstates[OVERPRINT_GS] = overprint();
      doc.addContent(`/${OVERPRINT_GS} gs`);
    }
    doc.path(shape.d).fill(color, shape.rule ?? 'non-zero');
    doc.restore();
  }
  doc.restore();
}

/** A layer's colour in the output's mode. */
function layerColor(ink: PdfLayerInk, mode: PdfColorMode): string | Cmyk {
  if (!parseHexColor(ink.color)) throw new RangeError(`a layer's colour is '#rrggbb', got ${JSON.stringify(ink.color)}`);
  if (ink.k !== undefined && !(Number.isFinite(ink.k) && ink.k >= 0 && ink.k <= 100)) throw new RangeError(`a layer's K is a percentage in 0..100, got ${ink.k}`);
  if (mode !== 'k-only') return ink.color;
  return kTint(ink.k ?? kSolid(ink.color));
}

/** Draw layers in page millimetres, in order (the transform to millimetres is the caller's). */
function drawLayers(doc: PDFKit.PDFDocument, layers: readonly PdfLayer[], mode: PdfColorMode): void {
  for (const layer of layers) {
    if (layer.kind === 'fill') {
      doc.path(layer.d).fill(layerColor(layer, mode), layer.rule ?? 'non-zero');
    } else if (layer.kind === 'stroke') {
      if (!(Number.isFinite(layer.width) && layer.width > 0)) throw new RangeError('a stroke layer needs a positive width');
      doc.path(layer.d).lineWidth(layer.width).lineCap(layer.cap).lineJoin(layer.join).stroke(layerColor(layer, mode));
    } else if (layer.kind === 'clip') {
      doc.save();
      doc.path(layer.clip).clip(layer.rule ?? 'non-zero');
      drawLayers(doc, layer.items, mode);
      doc.restore();
    } else {
      throw new RangeError(`unknown layer kind ${JSON.stringify((layer as { kind: unknown }).kind)}`);
    }
  }
}

const LINK_URL_RE = /^https?:\/\/[\x21-\x7e]{1,2000}$/;

function addLinks(doc: PDFKit.PDFDocument, links: readonly PdfLink[]): void {
  for (const l of links) {
    if (!LINK_URL_RE.test(l.url)) throw new RangeError('a link opens an http(s) URL of printable ASCII');
    if (![l.xMm, l.yMm, l.wMm, l.hMm].every(Number.isFinite) || l.wMm <= 0 || l.hMm <= 0) throw new RangeError('a link needs a positive rectangle');
    doc.link(mmToPt(l.xMm), mmToPt(l.yMm), mmToPt(l.wMm), mmToPt(l.hMm), l.url);
  }
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

  const mode = meta.colorMode ?? 'rgb';
  // One overprint state per document, created on first use.
  let overprintState: PDFKit.PDFKitReference | undefined;
  const overprint = (): PDFKit.PDFKitReference => {
    if (!overprintState) {
      overprintState = doc.ref({ Type: 'ExtGState', OP: true, op: true, OPM: 1 });
      overprintState.end(undefined);
    }
    return overprintState;
  };
  try {
    const spots = declareSpotColors(doc, meta.spotColors ?? []);
    for (const page of pages) {
      doc.addPage({ size: [mmToPt(page.widthMm), mmToPt(page.heightMm)], margin: 0 });
      if (page.fills && page.fills.length > 0) drawShapes(doc, page.fills, spots, mode, overprint);
      if (page.layers && page.layers.length > 0) {
        doc.save();
        const k = mmToPt(1);
        doc.transform(k, 0, 0, k, 0, 0);
        drawLayers(doc, page.layers, mode);
        doc.restore();
      }
      for (const pl of page.placements) drawScene(doc, pl.scene, pl.xMm, pl.yMm, mode);
      if (page.marks && page.marks.length > 0) {
        doc.save();
        const k = mmToPt(1);
        doc.transform(k, 0, 0, k, 0, 0);
        for (const m of page.marks) {
          const markColor = page.markColor ?? '#000000';
          doc.path(m.d).lineWidth(m.width).lineCap('round').lineJoin('round').stroke(mode === 'k-only' ? kTint(kSolid(markColor)) : markColor);
        }
        doc.restore();
      }
      if (page.shapes && page.shapes.length > 0) drawShapes(doc, page.shapes, spots, mode, overprint);
      if (page.links && page.links.length > 0) addLinks(doc, page.links);
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
