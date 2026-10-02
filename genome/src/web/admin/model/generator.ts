/**
 * Code generator view model: the issue form (raw strings from inputs → the
 * POST /api/admin/products body) and the artifact options (width, theme,
 * label, dpi, K-only black) for downloads, with the print-size advice; the
 * print sheet (options, layout preview, PDFs of 200) and the codes
 * registry's filters, which select a production batch to print.
 *
 * The client checks shapes and bounds to give immediate feedback; the
 * server re-validates everything with its own strict schema.
 */
import { artifactCellMm, layoutSheet } from '../../../core/render/sheet-layout.js';
import type { ArtifactOptions, PrintSheetOptions } from '../api.js';
import { formatCount } from '../format.js';
import { AUTH_POLICY_KINDS, ARTIFACT_THEMES, type ArtifactFormat, type ArtifactTheme, type CodeFilters, type CodeJson, type IssueInput, type Model } from '../types.js';

export interface IssueForm {
  categoryCode: string;
  modelId: string;
  collectionId: string;
  material: string;
  variant: string;
  productionBatch: string;
  productionDate: string;
  year: string;
  serial: string;
  sku: string;
  authPolicy: string;
  withClaimSecret: boolean;
}

export type FieldErrors = Partial<Record<keyof IssueForm, string>>;

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate and convert the issue form; empty optional fields are omitted. */
export function buildIssueInput(f: IssueForm, now: Date): Validated<IssueInput> {
  const errors: FieldErrors = {};
  const t = (s: string) => (s ?? '').trim();
  const categoryCode = t(f.categoryCode).toUpperCase();
  if (!/^[A-Z]$/.test(categoryCode)) errors.categoryCode = 'Choose a category.';
  const modelId = t(f.modelId);
  if (!UUID_RE.test(modelId)) errors.modelId = 'Choose a model.';
  const material = t(f.material);
  if (!material) errors.material = 'Material is required.';
  else if (material.length > 200 || CONTROL.test(material)) errors.material = 'Material is too long or contains invalid characters.';

  const text = (k: 'variant' | 'productionBatch', max: number) => {
    const v = t(f[k]);
    if (v && (v.length > max || CONTROL.test(v))) errors[k] = `At most ${max} characters, no control characters.`;
    return v || undefined;
  };
  const variant = text('variant', 100);
  const productionBatch = text('productionBatch', 100);

  const productionDate = t(f.productionDate) || undefined;
  if (productionDate && !isCalendarDate(productionDate)) errors.productionDate = 'Use a valid date (YYYY-MM-DD).';
  else if (productionDate && productionDate > new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)) {
    errors.productionDate = 'Production date cannot be in the future.';
  }

  let year: number | undefined;
  if (t(f.year)) {
    year = Number(t(f.year));
    if (!Number.isInteger(year) || year < 2000 || year > 2099) errors.year = 'Year must be 2000–2099.';
  }
  let serial: number | undefined;
  if (t(f.serial)) {
    serial = Number(t(f.serial));
    if (!/^\d+$/.test(t(f.serial)) || serial < 1 || serial > 999_999) errors.serial = 'Serial must be 1–999 999.';
  }
  const sku = t(f.sku) || undefined;
  if (sku && (sku.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/.test(sku))) errors.sku = 'Letters, digits, space, . _ - / only (64 max).';

  const collectionId = t(f.collectionId) || undefined;
  if (collectionId && !UUID_RE.test(collectionId)) errors.collectionId = 'Invalid collection.';

  const policy = normalizePolicy(f.authPolicy);
  if (policy === null) errors.authPolicy = 'Unknown authentication policy.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      categoryCode,
      modelId,
      material,
      ...(collectionId ? { collectionId } : {}),
      ...(variant ? { variant } : {}),
      ...(productionBatch ? { productionBatch } : {}),
      ...(productionDate ? { productionDate } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(serial !== undefined ? { serial } : {}),
      ...(sku ? { sku } : {}),
      ...(policy && policy !== 'PRINTED_CODE' ? { authPolicy: policy } : {}),
      ...(f.withClaimSecret ? { withClaimSecret: true } : {}),
    },
  };
}

/** `PRINTED_CODE+SECURE_NFC` style policy, or null when it names an unknown kind or omits PRINTED_CODE. */
export function normalizePolicy(p: string): string | null {
  const s = (p ?? '').trim().toUpperCase();
  if (!s) return 'PRINTED_CODE';
  const kinds = s.split('+').map((k) => k.trim());
  const known = new Set<string>(AUTH_POLICY_KINDS);
  if (kinds.some((k) => !known.has(k)) || new Set(kinds).size !== kinds.length || !kinds.includes('PRINTED_CODE')) return null;
  return kinds.join('+');
}

/** Policies offered in the generator; hardware kinds are not implemented and degrade to CODE_ONLY assurance. */
export const POLICY_OPTIONS: readonly { value: string; label: string; note: string }[] = [
  { value: 'PRINTED_CODE', label: 'Printed code', note: 'Signature + registry' },
  { value: 'PRINTED_CODE+SECURE_NFC', label: 'Printed code + secure NFC', note: 'Hardware not yet available — verifies as CODE ONLY' },
  { value: 'PRINTED_CODE+SECURE_ELEMENT', label: 'Printed code + secure element', note: 'Hardware not yet available — verifies as CODE ONLY' },
  { value: 'PRINTED_CODE+TAMPER_EVIDENT', label: 'Printed code + tamper-evident seal', note: 'Hardware not yet available — verifies as CODE ONLY' },
];

/** Models of a category, by name. */
export function modelsFor(models: readonly Model[], categoryCode: string): Model[] {
  return models.filter((m) => m.category.code === categoryCode).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Artifacts ──────────────────────────────────────────────────────────────

/** Mirrors the server's ARTIFACT_LIMITS (src/server/render/artifact.ts). */
export const ARTIFACT_LIMITS = Object.freeze({ minWidthMm: 10, maxWidthMm: 500, minDpi: 72, maxDpi: 2400, maxSidePx: 8000 });
export const ARTIFACT_DEFAULTS = Object.freeze({ widthMm: 30, theme: 'classic' as ArtifactTheme, label: false, decor: true, dpi: 600 });

/** Theme menu: the brand system's colourway names (BRAND-DESIGN-SYSTEM §2.7). */
export const THEME_OPTIONS: readonly { value: ArtifactTheme; label: string }[] = Object.freeze([
  { value: 'classic', label: 'CLASSIC — BLACK ON WHITE' },
  { value: 'inverted', label: 'INVERTED — WHITE ON BLACK' },
  { value: 'ivory', label: 'IVORY — INK ON IVORY' },
]);

/**
 * Print sizes (BRAND-DESIGN-SYSTEM §2.6, docs/reports/print-size-matrix.md):
 * 30 mm is the brand minimum for every substrate; under 15 mm a code only
 * reads reliably with 2× camera zoom, so such files are test prints only.
 */
export const ARTIFACT_SIZE_ADVICE = Object.freeze({ recommendedMinMm: 30, testPrintBelowMm: 15 });

export type SizeAdvice = { level: 'ok' } | { level: 'warn' | 'refuse'; message: string };

export function artifactSizeAdvice(widthMm: number, testPrint: boolean): SizeAdvice {
  const A = ARTIFACT_SIZE_ADVICE;
  if (!Number.isFinite(widthMm) || widthMm >= A.recommendedMinMm) return { level: 'ok' };
  if (widthMm < A.testPrintBelowMm) {
    return testPrint
      ? { level: 'warn', message: `Test print: under ${A.testPrintBelowMm} mm codes are not for production.` }
      : { level: 'refuse', message: `Under ${A.testPrintBelowMm} mm only as a test print: check "Test print" to continue.` };
  }
  return { level: 'warn', message: `${widthMm} mm is below the ${A.recommendedMinMm} mm minimum; phones may need to zoom in.` };
}

/** Colourways K-only black can express (neutral paper and ink). */
const K_ONLY_THEMES: readonly ArtifactTheme[] = ['classic', 'inverted'];

export interface ArtifactForm {
  widthMm: string;
  theme: string;
  label: boolean;
  decor: boolean;
  dpi: string;
  /** Allow widths under ARTIFACT_SIZE_ADVICE.testPrintBelowMm (explicit opt-in). */
  testPrint: boolean;
  /** K-only black (PDF; classic and inverted). Ignored for SVG and PNG. */
  kOnly: boolean;
}

export type ArtifactErrors = Partial<Record<'widthMm' | 'theme' | 'dpi' | 'kOnly', string>>;

export function buildArtifactOptions(f: ArtifactForm, format: ArtifactFormat): { ok: true; value: ArtifactOptions } | { ok: false; errors: ArtifactErrors } {
  const errors: ArtifactErrors = {};
  const L = ARTIFACT_LIMITS;
  const widthMm = Number((f.widthMm ?? '').trim() || ARTIFACT_DEFAULTS.widthMm);
  if (!Number.isFinite(widthMm) || widthMm < L.minWidthMm || widthMm > L.maxWidthMm) errors.widthMm = `Width ${L.minWidthMm}–${L.maxWidthMm} mm.`;
  else {
    const advice = artifactSizeAdvice(widthMm, f.testPrint === true);
    if (advice.level === 'refuse') errors.widthMm = advice.message;
  }
  const theme = (f.theme || ARTIFACT_DEFAULTS.theme) as ArtifactTheme;
  if (!ARTIFACT_THEMES.includes(theme)) errors.theme = 'Unknown theme.';
  const kOnly = format === 'pdf' && f.kOnly === true;
  if (kOnly && !K_ONLY_THEMES.includes(theme)) errors.kOnly = 'K-only black needs the classic or inverted colourway.';
  const dpi = Number((f.dpi ?? '').trim() || ARTIFACT_DEFAULTS.dpi);
  if (format === 'png') {
    if (!Number.isInteger(dpi) || dpi < L.minDpi || dpi > L.maxDpi) errors.dpi = `Resolution ${L.minDpi}–${L.maxDpi} dpi.`;
    else if (Number.isFinite(widthMm) && Math.round((widthMm / 25.4) * dpi) > L.maxSidePx) errors.dpi = 'PNG too large: lower the width or resolution.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      widthMm: Math.round(widthMm * 100) / 100,
      theme,
      label: !!f.label,
      decor: f.decor !== false,
      ...(format === 'png' ? { dpi } : {}),
      ...(kOnly ? { kOnly: true } : {}),
    },
  };
}

// ── Print sheets ───────────────────────────────────────────────────────────

/**
 * Mirrors the server's print-sheet bounds: `maxCodes` codes per PDF (MAX_SHEET_ITEMS), `maxSelection`
 * codes in one selection (MAX_CODE_IDS, what a batch selection may hold), the pages of SHEET_PAGES.
 */
export const PRINT_SHEET_LIMITS = Object.freeze({ maxCodes: 200, maxSelection: 1000, pages: ['A4', 'A3', 'LETTER'] as const });
export type SheetPage = (typeof PRINT_SHEET_LIMITS.pages)[number];

export interface PrintSheetForm extends ArtifactForm {
  page: string;
}

/** Only ACTIVE codes print: superseded and revoked ones verify as REVOKED. */
export function isSheetSelectable(code: Pick<CodeJson, 'status'>): boolean {
  return code.status === 'ACTIVE';
}

export function buildPrintSheetOptions(
  f: PrintSheetForm,
  selected: number,
): { ok: true; value: PrintSheetOptions } | { ok: false; errors: ArtifactErrors & { codes?: string; page?: string } } {
  const errors: ArtifactErrors & { codes?: string; page?: string } = {};
  if (selected < 1 || selected > PRINT_SHEET_LIMITS.maxSelection) errors.codes = `Select 1 to ${formatCount(PRINT_SHEET_LIMITS.maxSelection)} active codes.`;
  const page = (f.page || 'A4') as SheetPage;
  if (!PRINT_SHEET_LIMITS.pages.includes(page)) errors.page = 'Page must be A4, A3 or LETTER.';
  const artifact = buildArtifactOptions(f, 'pdf');
  if (!artifact.ok) Object.assign(errors, artifact.errors);
  if (!artifact.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  const { widthMm, theme, label, decor, kOnly } = artifact.value;
  return { ok: true, value: { widthMm, theme, label, decor, page, ...(kOnly ? { kOnly } : {}) } };
}

/** A selection as the PDFs it prints as: `size` codes each (the server's 200), in selection order. */
export function sheetChunks<T>(items: readonly T[], size: number = PRINT_SHEET_LIMITS.maxCodes): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * The file name of one part of a selection printed as several PDFs (and
 * manifests): `…-30mm-part-2-of-3.pdf`, `…-30mm-part-2-of-3-manifest.csv`.
 * A selection that fits one PDF keeps the server's name.
 */
export function sheetPartFilename(filename: string, part: number, parts: number): string {
  if (parts <= 1) return filename;
  const m = /(?:-manifest)?\.[A-Za-z0-9]+$/.exec(filename);
  const at = m ? m.index : filename.length;
  return `${filename.slice(0, at)}-part-${part}-of-${parts}${filename.slice(at)}`;
}

export type SheetPreview =
  | { ok: true; perPage: number; columns: number; rows: number; pages: number; files: number; text: string }
  | { ok: false; text: string };

/**
 * The layout preview shown before rendering ("35 per A4 · 4 pages"), from
 * the core's layoutSheet and cell size: the server lays out the PDF with the
 * same functions, so the preview is what prints. A selection over 200 codes
 * prints as several PDFs of 200 (sheetChunks): its pages are summed.
 */
export function printSheetPreview(f: Pick<PrintSheetForm, 'widthMm' | 'label' | 'page'>, count: number): SheetPreview {
  const raw = Number((f.widthMm ?? '').trim() || ARTIFACT_DEFAULTS.widthMm);
  if (!Number.isFinite(raw) || raw < ARTIFACT_LIMITS.minWidthMm || raw > ARTIFACT_LIMITS.maxWidthMm) return { ok: false, text: '' };
  const page = (f.page || 'A4') as SheetPage;
  if (!PRINT_SHEET_LIMITS.pages.includes(page)) return { ok: false, text: '' };
  const cell = artifactCellMm(Math.round(raw * 100) / 100, !!f.label);
  let grid;
  try {
    grid = layoutSheet(cell.widthMm, cell.heightMm, 1, { page });
  } catch {
    return { ok: false, text: 'The code does not fit on this page size.' };
  }
  const perPage = grid.columns * grid.rows;
  const sizes = sheetChunks(Array.from({ length: Math.max(0, count) }), PRINT_SHEET_LIMITS.maxCodes).map((c) => c.length);
  const pages = sizes.reduce((sum, n) => sum + layoutSheet(cell.widthMm, cell.heightMm, n, { page }).pages.length, 0);
  const files = sizes.length;
  let text = `${formatCount(perPage)} per ${page}`;
  if (count > 0) text += ` · ${formatCount(pages)} ${pages === 1 ? 'page' : 'pages'}`;
  if (files > 1) text += ` · ${files} PDFs of up to ${PRINT_SHEET_LIMITS.maxCodes} codes`;
  return { ok: true, perPage, columns: grid.columns, rows: grid.rows, pages, files, text };
}

// ── Codes registry filters ─────────────────────────────────────────────────

/** The filters of the codes list, from the route query. */
export function codeFiltersFrom(query: Readonly<Record<string, string | undefined>>): CodeFilters {
  const out: CodeFilters = {};
  for (const k of ['productionBatch', 'modelId', 'status', 'issuedFrom', 'issuedTo'] as const) {
    const v = query[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/** One string per set of filters: a print-sheet selection belongs to the filters it was made under. */
export function codeFilterKey(f: CodeFilters): string {
  return JSON.stringify([f.productionBatch ?? '', f.modelId ?? '', f.status ?? '', f.issuedFrom ?? '', f.issuedTo ?? '']);
}

export function hasCodeFilters(f: CodeFilters): boolean {
  return codeFilterKey(f) !== codeFilterKey({});
}

/**
 * The label of the button that selects every printable code of the filters
 * ("Select the 120 codes of this batch"), in three parts: the count in the
 * middle reads in the reading face inside the display-face button (BRAND §3.1).
 */
export function batchSelectLabel(f: CodeFilters, n: number): readonly [string, string, string] {
  const rest = `${n === 1 ? 'code' : 'codes'} ${f.productionBatch ? 'of this batch' : 'that match'}`;
  return ['Select the ', formatCount(n), ` ${rest}`];
}

/**
 * Physical cell pitch for the chosen width, for the operator's print sanity
 * check: CODE-01 is 50 u wide including its quiet zone, 1 u = cell pitch.
 */
export function cellPitchNote(widthMm: number): string {
  if (!Number.isFinite(widthMm) || widthMm <= 0) return '';
  return `Cell pitch ${(widthMm / 50).toFixed(2)} mm`;
}

/** Claim codes are `XXXX-XXXX-XXXX` Crockford base32; group defensively for display. */
export function formatClaimCode(code: string): string {
  const s = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : code;
}
