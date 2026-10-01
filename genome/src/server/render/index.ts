/** Server-side artifact rendering: SVG (core renderer), PNG (resvg), PDF (pdfkit, pure vector). */
export {
  ARTIFACT_DEFAULTS,
  ARTIFACT_FORMATS,
  ARTIFACT_LIMITS,
  ArtifactOptionsError,
  CONTENT_TYPES,
  MAX_SHEET_ITEMS,
  artifactFilename,
  isArtifactFormat,
  renderArtifact,
  renderPrintSheet,
  resolveArtifactOptions,
  type ArtifactFormat,
  type ArtifactInput,
  type ArtifactMeta,
  type ArtifactOptions,
  type PrintSheetItem,
  type PrintSheetOptions,
  type RenderedArtifact,
  type ResolvedArtifactOptions,
} from './artifact.js';
export { renderPdf, sceneToPdf, type PdfMeta, type PdfPage, type PdfPlacement } from './pdf.js';
export { PNG_SIGNATURE, pixelsFor, readPngDpi, setPngDpi, svgToPng } from './png.js';
export {
  LABEL_LAYOUT,
  SHEET_FOOTER_MM,
  SHEET_PAGES,
  buildArtifactScene,
  cropMarks,
  labelStrokes,
  layoutSheet,
  sceneToSvg,
  sheetFooter,
  type SheetLayout,
  type SheetPageSize,
} from './print-sheet.js';
export { LABEL_CHARSET, measureText, textRun } from './label-font.js';
export { ARTIFACT_THEMES, ARTIFACT_THEME_NAMES, mixTone, mmToPt, type ArtifactScene, type ArtifactTheme, type StrokePath, type ViewBox } from './scene.js';
