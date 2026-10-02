/**
 * Code generator view model: the issue form (raw strings from inputs → the
 * POST /api/admin/products body) and the artifact options (width, theme,
 * label, dpi, K-only black) for downloads, with the print-size advice; the
 * print sheet (options, layout preview, PDFs of 200) and the codes
 * registry's filters, which select a production batch to print; a batch
 * (a template, then a quantity or a CSV of one row per piece, checked line
 * by line, sent as requests of 50, and its results line by line).
 *
 * The client checks shapes and bounds to give immediate feedback; the
 * server re-validates everything with its own strict schema.
 */
import { csvDocument } from '../../../core/render/csv.js';
import { artifactCellMm, layoutSheet } from '../../../core/render/sheet-layout.js';
import type { ArtifactOptions, PrintSheetOptions } from '../api.js';
import { formatCount } from '../format.js';
import {
  AUTH_POLICY_KINDS,
  ARTIFACT_THEMES,
  type ArtifactFormat,
  type ArtifactTheme,
  type CodeFilters,
  type CodeJson,
  type IssueBatchItem,
  type IssueBatchResponse,
  type IssueBatchTemplate,
  type IssueInput,
  type Model,
} from '../types.js';

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
/** Every control character (C0, DEL and C1), as the server's issuance schema refuses them (`\p{Cc}`). */
const CONTROL = /\p{Cc}/u;

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

/** The models offered for new pieces in a category, by name: an inactive model (A-10) is hidden, the server refuses it. */
export function modelsFor(models: readonly Model[], categoryCode: string): Model[] {
  return models.filter((m) => m.active && m.category.code === categoryCode).sort((a, b) => a.name.localeCompare(b.name));
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

/**
 * Only ACTIVE codes print (superseded and revoked ones verify as REVOKED), and only those of a
 * product that may still be printed: the list says so (`printable`), as the batch selection
 * (GET /api/admin/codes/ids) does, so a sheet of 200 is never refused for one code picked by hand.
 */
export function isSheetSelectable(code: Pick<CodeJson, 'status' | 'printable'>): boolean {
  return code.status === 'ACTIVE' && code.printable !== false;
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

// ── Batches ────────────────────────────────────────────────────────────────

/**
 * Bounds of a batch signed from the console. `perRequest` mirrors the
 * server's MAX_ISSUE_BATCH (pieces per POST /api/admin/products/batch), and
 * `maxBodyBytes` keeps every request under its 16 KB body limit
 * (BODY_LIMIT_BYTES) whatever the variants hold: a larger batch is sent as
 * several requests, one after the other. `maxPieces` and `maxFileBytes`
 * bound one batch in the console (one CSV of up to 1 000 pieces).
 */
export const ISSUE_BATCH_LIMITS = Object.freeze({ perRequest: 50, maxBodyBytes: 15_000, maxPieces: 1000, maxFileBytes: 1_048_576 });

/** Certificate cards per POST /api/admin/certificates (the server's MAX_CERTIFICATE_ITEMS). */
export const CERTIFICATE_LIMITS = Object.freeze({ perRequest: 50 });

/** The columns a batch CSV may name on its first line, one row per piece: each optional, no other accepted. */
export const BATCH_COLUMNS = ['variant', 'sku', 'serial'] as const;
export type BatchColumn = (typeof BATCH_COLUMNS)[number];

/** The template of a batch: the issue form without what changes from piece to piece. */
export type BatchTemplateForm = Omit<IssueForm, 'variant' | 'sku' | 'serial'>;

/** One piece as read (raw strings), with the line of the file it starts on (null for a quantity). */
export interface BatchRow {
  line: number | null;
  variant: string;
  sku: string;
  serial: string;
}

/** Something to fix before signing, with its line of the file when it has one. */
export interface BatchProblem {
  line: number | null;
  message: string;
}

/** `delimiter`: null when the first line names one column, so each line is one value (a decimal comma never splits it). */
export type BatchCsv = { ok: true; rows: BatchRow[]; columns: BatchColumn[]; delimiter: ',' | ';' | null } | { ok: false; problems: BatchProblem[] };

const count = (s: string, c: string) => s.split(c).length - 1;

/** The character a decoder puts for bytes it could not read: a letter the file lost. */
const REPLACEMENT = '\uFFFD';

/** How a batch CSV file was read: `windows-1252` when its bytes are not UTF-8 (Excel's plain CSV). */
export type BatchCsvEncoding = 'utf-8' | 'windows-1252';

/**
 * The text of a batch CSV file, from its bytes. UTF-8, with or without its byte-order mark, is read
 * as such. Bytes that are not UTF-8 are read as Windows-1252: Excel saves a plain "CSV" (in France
 * "CSV (séparateur : point-virgule)", the reason semicolons are accepted) in that encoding, so its
 * accents arrive whole instead of as U+FFFD; the console says so above the preview, where they can
 * be checked before anything is signed.
 */
export function decodeBatchCsv(bytes: ArrayBuffer | ArrayBufferView): { text: string; encoding: BatchCsvEncoding } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/**
 * The records of a CSV text (RFC 4180: quoted values may hold the
 * delimiter, quotes doubled, line breaks), each with the line it starts on.
 * A null delimiter never splits a line: each record is one value.
 */
function csvRecords(text: string, delimiter: string | null): { ok: true; records: { line: number; fields: string[] }[] } | { ok: false; problem: BatchProblem } {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
        continue;
      }
      if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      field += c;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      quoteLine = line;
      continue;
    }
    if (c === delimiter) {
      fields.push(field);
      field = '';
      fieldStart = true;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = '';
      fieldStart = true;
      line++;
      recordLine = line;
      continue;
    }
    field += c;
    fieldStart = false;
  }
  if (quoted) return { ok: false, problem: { line: quoteLine, message: 'A quoted value is never closed.' } };
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return { ok: true, records };
}

/**
 * Read a batch CSV: one row per piece, the first line naming its columns
 * (variant, sku, serial; any of them, in any order, case-insensitive). A
 * byte-order mark is dropped, and the delimiter is the comma or, as
 * spreadsheets write it in France, the semicolon (the one the first line
 * that is not blank uses most). A first line that names one column holds
 * neither: each line is then one value, so `7,5 ML` stays one variant.
 * Blank lines are skipped; a row may stop short of the last columns (empty
 * values), never run past them. A value with U+FFFD (a letter the file's
 * encoding lost) is refused. Every problem names its line.
 */
export function parseBatchCsv(input: string): BatchCsv {
  const text = (input ?? '').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? '';
  const [semicolons, commas] = [count(firstLine, ';'), count(firstLine, ',')];
  const delimiter = semicolons === 0 && commas === 0 ? null : semicolons > commas ? ';' : ',';
  const parsed = csvRecords(text, delimiter);
  if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
  const records = parsed.records.filter((r) => r.fields.some((f) => f.trim() !== ''));
  const header = records[0];
  if (!header) return { ok: false, problems: [{ line: null, message: 'The file is empty.' }] };

  const names = header.fields.map((f) => f.trim().toLowerCase());
  const known = new Set<string>(BATCH_COLUMNS);
  if (!names.some((n) => known.has(n))) {
    return { ok: false, problems: [{ line: header.line, message: `Name the columns on the first line: ${BATCH_COLUMNS.join(', ')} (each optional).` }] };
  }
  const problems: BatchProblem[] = [];
  names.forEach((n, i) => {
    if (n === '') return;
    if (!known.has(n)) problems.push({ line: header.line, message: `Unknown column "${header.fields[i].trim().slice(0, 40)}": the columns are ${BATCH_COLUMNS.join(', ')}.` });
    else if (names.indexOf(n) !== i) problems.push({ line: header.line, message: `The column "${n}" appears twice.` });
  });
  if (problems.length > 0) return { ok: false, problems };

  const rows: BatchRow[] = [];
  for (const r of records.slice(1)) {
    const extra = r.fields.slice(names.length).filter((f) => f.trim() !== '');
    // A value in a column without a name (or past the last one) is most often a comma that was not quoted.
    const unnamed = names.some((n, i) => n === '' && (r.fields[i] ?? '').trim() !== '');
    if (extra.length > 0 || unnamed) {
      problems.push({ line: r.line, message: `${r.fields.length} values for ${names.filter((n) => n !== '').length} named columns: quote a value that holds "${delimiter ?? ','}".` });
      continue;
    }
    if (r.fields.some((f) => f.includes(REPLACEMENT))) {
      problems.push({ line: r.line, message: `A character could not be read (${REPLACEMENT}): save the file as CSV UTF-8, then choose it again.` });
      continue;
    }
    const value = (c: BatchColumn) => {
      const i = names.indexOf(c);
      return i < 0 ? '' : (r.fields[i] ?? '');
    };
    rows.push({ line: r.line, variant: value('variant'), sku: value('sku'), serial: value('serial') });
  }
  if (problems.length > 0) return { ok: false, problems };
  if (rows.length === 0) return { ok: false, problems: [{ line: null, message: 'The file has no piece under its first line.' }] };
  if (rows.length > ISSUE_BATCH_LIMITS.maxPieces) {
    return { ok: false, problems: [{ line: null, message: `The file holds ${formatCount(rows.length)} pieces; a batch holds at most ${formatCount(ISSUE_BATCH_LIMITS.maxPieces)}.` }] };
  }
  return { ok: true, rows, columns: BATCH_COLUMNS.filter((c) => names.includes(c)), delimiter };
}

/** A quantity of identical pieces (the same variant and SKU, serials allocated), or why not. */
export function quantityRows(quantity: string, variant: string, sku: string): { ok: true; rows: BatchRow[] } | { ok: false; error: string } {
  const q = (quantity ?? '').trim();
  const n = Number(q);
  if (!/^\d+$/.test(q) || n < 1 || n > ISSUE_BATCH_LIMITS.maxPieces) return { ok: false, error: `A quantity of 1 to ${formatCount(ISSUE_BATCH_LIMITS.maxPieces)}.` };
  return { ok: true, rows: Array.from({ length: n }, () => ({ line: null, variant, sku, serial: '' })) };
}

const PIECE_FIELDS = { variant: 'Variant', sku: 'SKU', serial: 'Serial' } as const;

export type BatchBuild =
  | { ok: true; template: IssueBatchTemplate; items: IssueBatchItem[]; lines: (number | null)[] }
  | { ok: false; templateErrors: FieldErrors; problems: BatchProblem[] };

/** The highest serial of a year and category (the server's SERIAL_MAX). */
const SERIAL_MAX = 999_999;

/**
 * The template and the pieces of a batch, checked with buildIssueInput (the
 * generator's own rules): the template's errors go on its fields, a piece's
 * on its line. Two pieces may not ask for the same serial, and a serial may
 * not leave the pieces allocated after it without one (they are signed after
 * every named serial, above the highest: batchSigningOrder).
 */
export function buildIssueBatch(f: BatchTemplateForm, rows: readonly BatchRow[], now: Date): BatchBuild {
  const shared = buildIssueInput({ ...f, variant: '', sku: '', serial: '' }, now);
  const problems: BatchProblem[] = [];
  const add = (p: BatchProblem) => {
    if (!problems.some((q) => q.line === p.line && q.message === p.message)) problems.push(p);
  };
  if (rows.length === 0) add({ line: null, message: 'Add at least one piece.' });
  if (rows.length > ISSUE_BATCH_LIMITS.maxPieces) add({ line: null, message: `A batch holds at most ${formatCount(ISSUE_BATCH_LIMITS.maxPieces)} pieces.` });
  const items: IssueBatchItem[] = [];
  const serials = new Map<number, number | null>();
  for (const r of rows) {
    const built = buildIssueInput({ ...f, variant: r.variant, sku: r.sku, serial: r.serial }, now);
    if (!built.ok) {
      // The template's errors are the same on every line: they are reported once, on its fields.
      for (const [k, label] of Object.entries(PIECE_FIELDS) as [keyof typeof PIECE_FIELDS, string][]) {
        const msg = built.errors[k];
        if (msg) add({ line: r.line, message: msg.startsWith(label) ? msg : `${label}: ${msg}` });
      }
      continue;
    }
    const { variant, sku, serial } = built.value;
    if (serial !== undefined) {
      if (serials.has(serial)) {
        const first = serials.get(serial);
        add({ line: r.line, message: first === null || first === undefined ? `Serial ${serial} is asked for twice.` : `Serial ${serial} is already on line ${first}.` });
        continue;
      }
      serials.set(serial, r.line);
    }
    items.push({ ...(variant ? { variant } : {}), ...(sku ? { sku } : {}), ...(serial !== undefined ? { serial } : {}) });
  }
  const allocated = rows.length - serials.size;
  if (problems.length === 0 && allocated > 0 && serials.size > 0) {
    const top = Math.max(...serials.keys());
    if (top + allocated > SERIAL_MAX) {
      const pieces = `${formatCount(allocated)} ${allocated === 1 ? 'piece' : 'pieces'}`;
      add({ line: serials.get(top) ?? null, message: `Serial ${top} leaves no serial for the ${pieces} allocated after it: sign it apart, or give them serials.` });
    }
  }
  if (!shared.ok || problems.length > 0) return { ok: false, templateErrors: shared.ok ? {} : shared.errors, problems };
  return { ok: true, template: shared.value, items, lines: rows.map((r) => r.line) };
}

/**
 * The order the pieces of a batch are sent in, as indexes: those that name their serial first, then
 * those whose serial is allocated, each group in the batch's order (the server signs a request in the
 * same order). Over several requests, an allocated serial (the highest + 1) then never takes the
 * serial a piece of a later request names.
 */
export function batchSigningOrder(items: readonly IssueBatchItem[]): number[] {
  const named: number[] = [];
  const allocated: number[] = [];
  items.forEach((item, i) => (item.serial !== undefined ? named : allocated).push(i));
  return [...named, ...allocated];
}

/** "Line 4 · SKU: …", or the message alone when it has no line. */
export function batchProblemText(p: BatchProblem): string {
  return p.line === null ? p.message : `Line ${p.line} · ${p.message}`;
}

/**
 * The requests a batch is signed in, in order: at most `perRequest` pieces
 * each, and every body (template and pieces, as JSON) at most
 * `maxBodyBytes` in UTF-8. `start` is the index of a request's first piece.
 */
export function batchRequests<T extends IssueBatchItem>(template: IssueBatchTemplate, items: readonly T[], limits: { perRequest: number; maxBodyBytes: number } = ISSUE_BATCH_LIMITS): { start: number; items: T[] }[] {
  const enc = new TextEncoder();
  const bytes = (v: unknown) => enc.encode(JSON.stringify(v)).length;
  const base = bytes({ template, items: [] });
  const out: { start: number; items: T[] }[] = [];
  let current: T[] = [];
  let size = base;
  items.forEach((item, i) => {
    const itemBytes = bytes(item);
    // Each piece after the first adds its JSON and one comma.
    if (current.length > 0 && (current.length >= limits.perRequest || size + 1 + itemBytes > limits.maxBodyBytes)) {
      out.push({ start: i - current.length, items: current });
      current = [];
      size = base;
    }
    size += itemBytes + (current.length > 0 ? 1 : 0);
    current.push(item);
  });
  if (current.length > 0) out.push({ start: items.length - current.length, items: current });
  return out;
}

/** The plan shown before signing: "120 pieces · 3 requests of up to 50". */
export function batchPlanText(pieces: number, requests: number): string {
  const what = `${formatCount(pieces)} ${pieces === 1 ? 'piece' : 'pieces'}`;
  if (pieces < 1) return 'No piece yet';
  return requests > 1 ? `${what} · ${formatCount(requests)} requests of up to ${ISSUE_BATCH_LIMITS.perRequest}` : `${what} · one request`;
}

/** "Sign 120 products", in three parts: the count reads in the reading face inside the display-face button (BRAND §3.1). */
export function signBatchLabel(n: number): readonly [string, string, string] {
  if (n < 1) return ['Sign the batch', '', ''];
  return ['Sign ', formatCount(n), n === 1 ? ' product' : ' products'];
}

/**
 * What became of a piece. ISSUED, FAILED (refused, by itself or with its
 * request) and SKIPPED (the batch stopped before it) come from the server;
 * NOT_SENT: an earlier request failed, so the console sent nothing more;
 * NO_ANSWER: its request got no answer (network, timeout), so the server may
 * have signed it: look in Products before signing it again.
 */
export type BatchOutcome = 'ISSUED' | 'FAILED' | 'SKIPPED' | 'NOT_SENT' | 'NO_ANSWER';

export interface BatchResultRow {
  /** 1-based position in the batch. */
  piece: number;
  /** The CSV line, null for a quantity. */
  line: number | null;
  status: BatchOutcome;
  productId?: string;
  codeId?: string;
  serial?: number;
  sku?: string;
  variant?: string | null;
  claimCode?: string;
  message?: string;
}

/** How one request of a batch ended. */
export type BatchPart = { start: number; count: number } & (
  | { kind: 'answered'; response: IssueBatchResponse }
  | { kind: 'refused'; message: string }
  | { kind: 'unanswered'; message: string }
);

export const BATCH_OUTCOME_LABELS: Readonly<Record<BatchOutcome, string>> = Object.freeze({
  ISSUED: 'ISSUED',
  FAILED: 'NOT SIGNED',
  SKIPPED: 'NOT ATTEMPTED',
  NOT_SENT: 'NOT SENT',
  NO_ANSWER: 'NO ANSWER',
});

/**
 * One row per piece, in the batch's order, from the requests sent (pieces of no request were not
 * sent). A piece not signed keeps what was asked for it (variant, SKU, serial); a signed one shows
 * what the server recorded. `order` maps a position in the requests to the piece's index in the
 * batch (batchSigningOrder); the requests are in the batch's order without it.
 */
export function batchResultRows(lines: readonly (number | null)[], items: readonly IssueBatchItem[], parts: readonly BatchPart[], order?: readonly number[]): BatchResultRow[] {
  const rows: BatchResultRow[] = lines.map((line, i) => ({
    piece: i + 1,
    line,
    status: 'NOT_SENT',
    ...(items[i]?.variant !== undefined ? { variant: items[i].variant } : {}),
    ...(items[i]?.sku !== undefined ? { sku: items[i].sku } : {}),
    ...(items[i]?.serial !== undefined ? { serial: items[i].serial } : {}),
    message: 'Not sent: an earlier request failed.',
  }));
  for (const part of parts) {
    for (let k = 0; k < part.count; k++) {
      const at = part.start + k;
      const row = rows[order ? (order[at] ?? -1) : at];
      if (!row) continue;
      if (part.kind === 'refused') Object.assign(row, { status: 'FAILED', message: part.message });
      else if (part.kind === 'unanswered') Object.assign(row, { status: 'NO_ANSWER', message: part.message });
      else {
        const l = part.response.items.find((x) => x.index === k);
        if (!l) Object.assign(row, { status: 'NO_ANSWER', message: 'The server did not report this piece: look for it in Products.' });
        else if (l.status === 'ISSUED') {
          const { productId, codeId, serial, sku, variant, claimCode } = l;
          Object.assign(row, { status: 'ISSUED', productId, codeId, serial, sku, variant, ...(claimCode ? { claimCode } : {}), message: undefined });
        } else if (l.status === 'FAILED') Object.assign(row, { status: 'FAILED', message: l.error.message });
        else Object.assign(row, { status: 'SKIPPED', message: 'Not attempted: the batch stopped before this piece.' });
      }
    }
  }
  return rows;
}

export interface BatchSummary {
  pieces: number;
  issued: number;
  notIssued: number;
  noAnswer: number;
  claimCodes: number;
  /** The lead of the result: "118 of 120 pieces signed · 2 not signed". */
  text: string;
}

export function batchSummary(rows: readonly BatchResultRow[]): BatchSummary {
  const issued = rows.filter((r) => r.status === 'ISSUED').length;
  const noAnswer = rows.filter((r) => r.status === 'NO_ANSWER').length;
  const notIssued = rows.length - issued - noAnswer;
  const claimCodes = rows.filter((r) => r.claimCode).length;
  let text = `${formatCount(issued)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'piece' : 'pieces'} signed`;
  if (notIssued > 0) text += ` · ${formatCount(notIssued)} not signed`;
  if (noAnswer > 0) text += ` · ${formatCount(noAnswer)} without an answer: look for them in Products before signing them again`;
  return { pieces: rows.length, issued, notIssued, noAnswer, claimCodes, text: `${text}.` };
}

/**
 * The results of a batch as a CSV (one row per piece, the claim codes
 * included while the console holds them): the operator's record of what was
 * signed, which serial went to which line, and why a piece was not signed.
 */
export function batchResultsCsv(rows: readonly BatchResultRow[]): string {
  return csvDocument([
    ['line', 'piece', 'status', 'productId', 'sku', 'variant', 'serial', 'codeId', 'claimCode', 'message'],
    ...rows.map((r) => [
      r.line === null ? '' : String(r.line),
      String(r.piece),
      BATCH_OUTCOME_LABELS[r.status],
      r.productId ?? '',
      r.sku ?? '',
      r.variant ?? '',
      r.serial === undefined ? '' : String(r.serial),
      r.codeId ?? '',
      r.claimCode ? formatClaimCode(r.claimCode) : '',
      r.message ?? '',
    ]),
  ]);
}

/** `ORBES-batch-B-2026-10-A-2026-10-02-120-results.csv` (the production batch, when there is one, in file-safe characters). */
export function batchResultsFilename(productionBatch: string | undefined, now: Date, pieces: number): string {
  const day = now.toISOString().slice(0, 10);
  const batch = (productionBatch ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60);
  return `ORBES-batch-${batch ? `${batch}-` : ''}${day}-${pieces}-results.csv`;
}

/** The certificate cards a batch can print: its signed pieces that hold a claim code, in order. */
export function batchCertificateItems(rows: readonly BatchResultRow[]): { productId: string; claimCode: string }[] {
  return rows.flatMap((r) => (r.status === 'ISSUED' && r.productId && r.claimCode ? [{ productId: r.productId, claimCode: r.claimCode }] : []));
}
