/**
 * Code artifacts: options, defaults and limits, and the one entry point that
 * turns framed code data + genome into SVG, PNG or PDF (contract §2.3
 * renderCode). Also multi-up print sheets for batch production.
 *
 * All formats come from one CODE-01 model and one scene, so they share their
 * geometry exactly; only the back end differs.
 */
import { encodeOrbesCode } from '../../core/code/encoder.js';
import { CODE01_SIZE } from '../../core/code/profile.js';
import { renderPdf, sceneToPdf, type PdfPage } from './pdf.js';
import { pixelsFor, svgToPng } from './png.js';
import {
  buildArtifactScene,
  cropMarks,
  layoutSheet,
  LABEL_LAYOUT,
  sceneToSvg,
  sheetFooter,
  SHEET_PAGES,
  type SheetPageSize,
} from './print-sheet.js';
import { ARTIFACT_THEME_NAMES, type ArtifactScene, type ArtifactTheme } from './scene.js';

export type ArtifactFormat = 'svg' | 'png' | 'pdf';
export const ARTIFACT_FORMATS: readonly ArtifactFormat[] = ['svg', 'png', 'pdf'];

export interface ArtifactOptions {
  /** Physical width of the code (quiet zone included), mm. */
  widthMm?: number;
  theme?: ArtifactTheme;
  /** Decorative hairlines (never needed for decoding). */
  decor?: boolean;
  /** PNG resolution. */
  dpi?: number;
  /** Add the print label (product id + ORBES) under the code. */
  label?: boolean;
}

export type ResolvedArtifactOptions = Required<ArtifactOptions>;

export const ARTIFACT_DEFAULTS: Readonly<ResolvedArtifactOptions> = Object.freeze({
  widthMm: 30,
  theme: 'black',
  decor: true,
  dpi: 600,
  label: false,
});

/**
 * Bounds. Below 5 mm a cell is under 0.1 mm, beyond what jewelry engraving or
 * label printers resolve. Pixel caps bound the memory of one rasterisation
 * (RGBA: 40 Mpx ≈ 160 MB) so a request cannot exhaust the server.
 */
export const ARTIFACT_LIMITS = Object.freeze({
  minWidthMm: 5,
  maxWidthMm: 500,
  minDpi: 72,
  maxDpi: 2400,
  maxSidePx: 8000,
  maxPixels: 40_000_000,
});

export const CONTENT_TYPES: Readonly<Record<ArtifactFormat, string>> = Object.freeze({
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  pdf: 'application/pdf',
});

/** Invalid artifact options; the message is safe to show to an admin. */
export class ArtifactOptionsError extends RangeError {
  override readonly name = 'ArtifactOptionsError';
}

export function isArtifactFormat(v: unknown): v is ArtifactFormat {
  return typeof v === 'string' && (ARTIFACT_FORMATS as readonly string[]).includes(v);
}

/** Apply defaults and validate. Widths are kept to 0.01 mm (they appear in file names). */
export function resolveArtifactOptions(format: ArtifactFormat, opts: ArtifactOptions = {}): ResolvedArtifactOptions {
  if (!isArtifactFormat(format)) throw new ArtifactOptionsError('Unknown artifact format.');
  if (opts === null || typeof opts !== 'object') throw new ArtifactOptionsError('Invalid artifact options.');
  const L = ARTIFACT_LIMITS;
  const widthMm = opts.widthMm ?? ARTIFACT_DEFAULTS.widthMm;
  if (typeof widthMm !== 'number' || !Number.isFinite(widthMm) || widthMm < L.minWidthMm || widthMm > L.maxWidthMm) {
    throw new ArtifactOptionsError(`Width must be between ${L.minWidthMm} and ${L.maxWidthMm} mm.`);
  }
  const theme = opts.theme ?? ARTIFACT_DEFAULTS.theme;
  if (!ARTIFACT_THEME_NAMES.includes(theme)) throw new ArtifactOptionsError(`Theme must be one of ${ARTIFACT_THEME_NAMES.join(', ')}.`);
  const decor = opts.decor ?? ARTIFACT_DEFAULTS.decor;
  const label = opts.label ?? ARTIFACT_DEFAULTS.label;
  if (typeof decor !== 'boolean' || typeof label !== 'boolean') throw new ArtifactOptionsError('decor and label must be booleans.');
  const dpi = opts.dpi ?? ARTIFACT_DEFAULTS.dpi;
  if (typeof dpi !== 'number' || !Number.isInteger(dpi) || dpi < L.minDpi || dpi > L.maxDpi) {
    throw new ArtifactOptionsError(`Resolution must be an integer between ${L.minDpi} and ${L.maxDpi} dpi.`);
  }
  const resolved: ResolvedArtifactOptions = { widthMm: Math.round(widthMm * 100) / 100, theme, decor, dpi, label };
  if (format === 'png') {
    const { w, h } = pngSize(resolved);
    if (w > L.maxSidePx || h > L.maxSidePx || w * h > L.maxPixels) {
      throw new ArtifactOptionsError('The requested PNG is too large; lower the width or the resolution.');
    }
  }
  return resolved;
}

function pngSize(o: ResolvedArtifactOptions): { w: number; h: number } {
  const w = pixelsFor(o.widthMm, o.dpi);
  const h = Math.round((w * (CODE01_SIZE + (o.label ? LABEL_LAYOUT.height : 0))) / CODE01_SIZE);
  return { w, h };
}

export interface ArtifactInput {
  /** Framed code data (79 bytes: payload ‖ signature ‖ CRC-16). */
  data: Uint8Array;
  /** The 8 genome glyphs of the signed identity. */
  genomeGlyphs: readonly number[];
}

export interface ArtifactMeta {
  /** Canonical product id (label text, file name, titles). */
  productId: string;
  /** Code issue (file name). */
  issue: number;
  /** PDF creation date (deterministic output). */
  createdAt: Date;
}

export interface RenderedArtifact {
  contentType: string;
  body: Uint8Array | string;
  filename: string;
}

/** Render one code artifact. Options are validated (ArtifactOptionsError). */
export async function renderArtifact(
  input: ArtifactInput,
  format: ArtifactFormat,
  options: ArtifactOptions,
  meta: ArtifactMeta,
): Promise<RenderedArtifact> {
  const o = resolveArtifactOptions(format, options);
  const model = encodeOrbesCode({ data: input.data, genomeGlyphs: input.genomeGlyphs }, { decor: o.decor });
  const scene = buildArtifactScene(model, { widthMm: o.widthMm, theme: o.theme, label: o.label, productId: meta.productId });
  const filename = artifactFilename(meta, o, format);
  switch (format) {
    case 'svg':
      return { contentType: CONTENT_TYPES.svg, body: sceneToSvg(model, scene, o.decor), filename };
    case 'png': {
      const svg = sceneToSvg(model, scene, o.decor);
      const body = await svgToPng(svg, { widthPx: pngSize(o).w, dpi: o.dpi });
      return { contentType: CONTENT_TYPES.png, body, filename };
    }
    case 'pdf': {
      const body = await sceneToPdf(scene, {
        title: scene.title,
        subject: 'ORBES CODE-01 print artifact',
        keywords: `ORBES, ${meta.productId}`,
        creationDate: meta.createdAt,
      });
      return { contentType: CONTENT_TYPES.pdf, body, filename };
    }
  }
}

/** `ORBES-O26-J-00184-I1-black-30mm[-label][-600dpi].ext` — ASCII only, safe in Content-Disposition. */
export function artifactFilename(meta: Pick<ArtifactMeta, 'productId' | 'issue'>, o: ResolvedArtifactOptions, format: ArtifactFormat): string {
  const id = meta.productId.replace(/[^A-Za-z0-9-]/g, '');
  const parts = ['ORBES', id, `I${meta.issue}`, o.theme, `${o.widthMm}mm`];
  if (o.label) parts.push('label');
  if (format === 'png') parts.push(`${o.dpi}dpi`);
  return `${parts.join('-')}.${format}`;
}

// ── Print sheets ───────────────────────────────────────────────────────────

export interface PrintSheetItem extends ArtifactInput {
  productId: string;
}

export interface PrintSheetOptions {
  widthMm?: number;
  theme?: ArtifactTheme;
  decor?: boolean;
  /** Labels are on by default on sheets: cut pieces must stay identifiable. */
  label?: boolean;
  page?: SheetPageSize;
  cropMarks?: boolean;
}

// Bounds one request: ~55 KB of PDF and ~30 ms of rendering per code.
export const MAX_SHEET_ITEMS = 200;

/** Multi-up PDF of labeled artifacts with crop marks and a 10 mm scale bar. */
export async function renderPrintSheet(
  items: readonly PrintSheetItem[],
  options: PrintSheetOptions,
  meta: { createdAt: Date; caption?: string },
): Promise<RenderedArtifact> {
  if (items.length < 1 || items.length > MAX_SHEET_ITEMS) {
    throw new ArtifactOptionsError(`A print sheet holds 1 to ${MAX_SHEET_ITEMS} codes.`);
  }
  const page = options.page ?? 'A4';
  if (!(page in SHEET_PAGES)) throw new ArtifactOptionsError('Page must be A4, A3 or LETTER.');
  const o = resolveArtifactOptions('pdf', {
    widthMm: options.widthMm ?? 25,
    theme: options.theme ?? 'black',
    decor: options.decor ?? true,
    label: options.label ?? true,
  });
  const scenes: ArtifactScene[] = items.map((it) =>
    buildArtifactScene(encodeOrbesCode({ data: it.data, genomeGlyphs: it.genomeGlyphs }, { decor: o.decor }), {
      widthMm: o.widthMm,
      theme: o.theme,
      label: o.label,
      productId: it.productId,
    }),
  );
  const cellW = scenes[0].widthMm;
  const cellH = scenes[0].heightMm;
  let layout;
  try {
    layout = layoutSheet(cellW, cellH, scenes.length, { page });
  } catch {
    throw new ArtifactOptionsError('The artifact is too large for this page size.');
  }
  const day = meta.createdAt.toISOString().slice(0, 10);
  const caption = meta.caption ?? `ORBES PRINT SHEET · ${day} · ${items.length} CODES`;
  const pages: PdfPage[] = layout.pages.map((placements, pageIndex) => ({
    widthMm: layout.pageWidthMm,
    heightMm: layout.pageHeightMm,
    placements: placements.map((p) => ({ scene: scenes[p.index], xMm: p.xMm, yMm: p.yMm })),
    marks: [...(options.cropMarks === false ? [] : [cropMarks(placements, cellW, cellH)]), ...sheetFooter(layout, pageIndex, caption)],
  }));
  const body = await renderPdf(pages, {
    title: caption,
    subject: 'ORBES CODE-01 print sheet',
    creationDate: meta.createdAt,
  });
  const filename = `ORBES-sheet-${day}-${items.length}-${o.theme}-${o.widthMm}mm.pdf`;
  return { contentType: CONTENT_TYPES.pdf, body, filename };
}
