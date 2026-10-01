/**
 * Code generator view model: the issue form (raw strings from inputs → the
 * POST /api/admin/products body) and the artifact options (width, theme,
 * label, dpi) for downloads.
 *
 * The client checks shapes and bounds to give immediate feedback; the
 * server re-validates everything with its own strict schema.
 */
import type { ArtifactOptions } from '../api.js';
import { AUTH_POLICY_KINDS, ARTIFACT_THEMES, type ArtifactFormat, type ArtifactTheme, type IssueInput, type Model } from '../types.js';

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
export const ARTIFACT_LIMITS = Object.freeze({ minWidthMm: 5, maxWidthMm: 500, minDpi: 72, maxDpi: 2400, maxSidePx: 8000 });
export const ARTIFACT_DEFAULTS = Object.freeze({ widthMm: 30, theme: 'black' as ArtifactTheme, label: false, decor: true, dpi: 600 });

export interface ArtifactForm {
  widthMm: string;
  theme: string;
  label: boolean;
  decor: boolean;
  dpi: string;
}

export function buildArtifactOptions(f: ArtifactForm, format: ArtifactFormat): Validated<ArtifactOptions> {
  const errors: Record<string, string> = {};
  const L = ARTIFACT_LIMITS;
  const widthMm = Number((f.widthMm ?? '').trim() || ARTIFACT_DEFAULTS.widthMm);
  if (!Number.isFinite(widthMm) || widthMm < L.minWidthMm || widthMm > L.maxWidthMm) errors.widthMm = `Width ${L.minWidthMm}–${L.maxWidthMm} mm.`;
  const theme = (f.theme || ARTIFACT_DEFAULTS.theme) as ArtifactTheme;
  if (!ARTIFACT_THEMES.includes(theme)) errors.theme = 'Unknown theme.';
  const dpi = Number((f.dpi ?? '').trim() || ARTIFACT_DEFAULTS.dpi);
  if (format === 'png') {
    if (!Number.isInteger(dpi) || dpi < L.minDpi || dpi > L.maxDpi) errors.dpi = `Resolution ${L.minDpi}–${L.maxDpi} dpi.`;
    else if (Number.isFinite(widthMm) && Math.round((widthMm / 25.4) * dpi) > L.maxSidePx) errors.dpi = 'PNG too large: lower the width or resolution.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors: errors as FieldErrors };
  return {
    ok: true,
    value: {
      widthMm: Math.round(widthMm * 100) / 100,
      theme,
      label: !!f.label,
      decor: f.decor !== false,
      ...(format === 'png' ? { dpi } : {}),
    },
  };
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
