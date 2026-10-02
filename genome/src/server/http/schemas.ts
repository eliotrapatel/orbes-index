/**
 * Request schemas (zod) for every route.
 *
 * Bodies are strict objects: unknown keys are rejected (400), so a typo or a
 * smuggled field never silently does nothing. Every string is length-bounded.
 * Services re-validate their own inputs; these schemas are the outer wall
 * (shape, types, sizes), the services own the business rules.
 *
 * Query strings are lenient about unknown keys (cache busters) but strict
 * about the values of the keys they know.
 */
import { z } from 'zod';
import {
  ANOMALY_SEVERITIES,
  ANOMALY_STATUSES,
  CODE_STATUSES,
  PRODUCT_STATUSES,
  REVOCATION_TARGET_TYPES,
  SERVICE_TYPES,
  VERIFICATION_STATES,
} from '../db/schema.js';
import { pageRequest, type PageRequest } from '../types.js';
import { fromZod } from './errors.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse `value` or throw a 400 VALIDATION_FAILED DomainError. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw fromZod(r.error);
  return r.data;
}

const bodyError = (iss: { code: string; input?: unknown }) =>
  iss.code === 'invalid_type' ? 'The request body must be a JSON object' : undefined;

/** A strict JSON-object body. */
export const body = <S extends z.ZodRawShape>(shape: S) => z.strictObject(shape, { error: bodyError });

/** A strict body that may also be omitted entirely (no Content-Type, no payload). */
export const optionalBody = <S extends z.ZodRawShape>(shape: S) =>
  z.preprocess((v) => (v === undefined || v === null ? {} : v), body(shape));

/** Routes without a body: nothing, or an empty JSON object (anything else is an unknown field). */
export const emptyBody = optionalBody({});

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Bounded text; control characters (other than tab/newline) refused. */
export const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? 'Required' : `At least ${min} characters`)
    .max(max, `At most ${max} characters`)
    .refine((s) => !CONTROL_CHARS.test(s), 'Contains invalid characters');

/** Optional text where '' and null mean "not given" (admin forms send empty strings). */
export const optionalText = (max: number) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), text(max).optional());

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_PRODUCT_ID_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export const uuid = z.string().trim().regex(UUID_RE, 'Must be a UUID').transform((s) => s.toLowerCase());

/** A product reference: canonical id (O26-J-00184) or row uuid. */
export const productRef = z
  .string()
  .trim()
  .max(64, 'Invalid product id')
  .refine((s) => CANONICAL_PRODUCT_ID_RE.test(s) || UUID_RE.test(s), 'Invalid product id')
  .transform((s) => (UUID_RE.test(s) ? s.toLowerCase() : s.toUpperCase()));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a valid date');

const isoDateTime = z
  .string()
  .max(40)
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), 'Must be an ISO 8601 date-time with a time zone')
  .transform((s) => new Date(s));

/** A query value where an empty or blank string means "not given" (filter forms send empty fields). */
const queryOptional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

/** A production batch as recorded at issuance (trimmed, ≤ 100 characters), matched exactly. */
const productionBatch = queryOptional(text(100));

const country = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Must be an ISO 3166-1 alpha-2 country code')
  .transform((s) => s.toUpperCase());

const queryBool = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined;
  if (v === 'true' || v === '1' || v === true) return true;
  if (v === 'false' || v === '0' || v === false) return false;
  return v;
}, z.boolean().optional());

const queryNumber = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : v),
  z.number().finite().optional(),
);

/** Lenient pagination (contract: ?page=1&pageSize=50, max 200): garbage → defaults, sizes clamped. */
export function pageOf(query: unknown): PageRequest {
  const q = (query && typeof query === 'object' ? query : {}) as { page?: unknown; pageSize?: unknown };
  return pageRequest({ page: q.page, pageSize: q.pageSize });
}

// ── Public ─────────────────────────────────────────────────────────────────

/**
 * Contract §2.4 VerifyInput. The code is base64url of the 79-byte framed data (≤ 200 chars), but only
 * the type and a hard size bound are checked here: step 1 makes any decode failure (alphabet, length,
 * framing) the MALFORMED_CODE state, recorded as a scan, so the service must see it.
 */
export const verifyBody = body({
  code: z.string().max(1024, 'At most 1024 characters'),
  genome: z
    .strictObject({
      glyphs: z.array(z.union([z.number().int().min(0).max(15), z.null()])).length(8),
      confidence: z.array(z.number().min(0).max(1)).length(8).optional(),
    })
    .optional(),
  client: z
    .strictObject({
      rsErrors: z.number().int().min(0).max(255).optional(),
      rsErasures: z.number().int().min(0).max(255).optional(),
      moduleSizePx: z.number().min(0).max(10_000).optional(),
      decodeMs: z.number().min(0).max(600_000).optional(),
      source: z.enum(['camera', 'upload']).optional(),
    })
    .optional(),
});
export type VerifyBody = z.infer<typeof verifyBody>;

// ── Accounts & admin auth ──────────────────────────────────────────────────

const email = z.string().trim().min(3, 'Required').max(254, 'At most 254 characters');
const password = z.string().min(1, 'Required').max(1024, 'At most 1024 characters');

export const registerAccountBody = body({
  email,
  password,
  displayName: z.preprocess((v) => (v === '' ? null : v), z.string().max(80, 'At most 80 characters').nullable().optional()),
  country: z.preprocess((v) => (v === '' ? null : v), country.nullable().optional()),
});

export const loginBody = body({ email, password });

export const adminLoginBody = body({
  email,
  password,
  totp: z.preprocess((v) => (v === '' ? null : v), z.string().max(16).regex(/^[0-9 ]+$/, 'Must be digits').nullable().optional()),
});

export const adminParams = z.object({ id: uuid });

export const totpEnableBody = body({
  secret: z.string().trim().min(16).max(128).regex(/^[A-Za-z2-7=\s]+$/, 'Must be base32'),
  code: z.string().trim().min(6).max(16).regex(/^[0-9 ]+$/, 'Must be digits'),
});

// ── Ownership ──────────────────────────────────────────────────────────────

export const registerOwnershipBody = body({
  registrationToken: z.string().trim().min(1, 'Required').max(128, 'Invalid registration token').regex(BASE64URL_RE, 'Invalid registration token'),
  claimCode: z.preprocess((v) => (v === '' ? null : v), z.string().max(32, 'Invalid claim code').nullable().optional()),
});

export const productRefBody = body({ productId: productRef });

export const acceptTransferBody = body({ transferCode: z.string().trim().min(1, 'Required').max(32, 'Invalid transfer code') });

export const incidentBody = body({ productId: productRef, type: z.enum(['LOST', 'STOLEN']) });

export const productParams = z.object({ productId: productRef });

// ── Admin: catalogue ───────────────────────────────────────────────────────

export const createCategoryBody = body({
  code: z.string().trim().length(1, 'Must be a single letter A–Z'),
  name: text(64),
  warrantyMonths: z.number().int().min(0).max(600).optional(),
});

export const createCollectionBody = body({ name: text(100) });

export const createModelBody = body({
  categoryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]$/, 'Must be a single letter A–Z')
    .transform((s) => s.toUpperCase()),
  collectionId: z.preprocess((v) => (v === '' || v === null ? undefined : v), uuid.optional()),
  name: text(100),
  type: text(60),
  skuPrefix: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(32, 'At most 32 characters')
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits, dot, underscore and hyphen only')
    .transform((s) => s.toUpperCase()),
  defaultMaterial: optionalText(200),
  careInstructions: optionalText(2000),
});

// ── Admin: products ────────────────────────────────────────────────────────

export const productListQuery = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  category: z
    .string()
    .trim()
    .regex(/^[A-Za-z]$/, 'Must be a single letter A–Z')
    .transform((s) => s.toUpperCase())
    .optional(),
  q: z.string().trim().max(64, 'At most 64 characters').optional(),
  productionBatch,
});

export const transitionBody = body({
  to: z.enum(PRODUCT_STATUSES),
  reason: z.preprocess((v) => (v === '' ? null : v), z.string().max(1000, 'At most 1000 characters').nullable().optional()),
});

export const optionalReasonBody = optionalBody({
  reason: z.preprocess((v) => (v === '' ? null : v), z.string().max(1000, 'At most 1000 characters').nullable().optional()),
});

export const requiredReasonBody = body({ reason: text(500) });

export const warrantyActivateBody = optionalBody({
  purchaseDate: z.preprocess((v) => (v === '' || v === null ? undefined : v), isoDate.optional()),
  retailer: z.preprocess((v) => (v === '' ? null : v), z.string().max(200, 'At most 200 characters').nullable().optional()),
  country: z.preprocess((v) => (v === '' ? null : v), country.nullable().optional()),
});

export const openServiceBody = body({
  type: z.enum(SERVICE_TYPES),
  location: z.preprocess((v) => (v === '' ? null : v), z.string().max(200, 'At most 200 characters').nullable().optional()),
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().max(4000, 'At most 4000 characters').nullable().optional()),
  performedBy: z.preprocess((v) => (v === '' ? null : v), z.string().max(200, 'At most 200 characters').nullable().optional()),
});

export const warrantyExtendBody = body({
  months: z.number().int('Must be a whole number of months').min(1, 'At least 1 month').max(120, 'At most 120 months'),
});

export const completeServiceBody = optionalBody({
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().max(4000, 'At most 4000 characters').nullable().optional()),
});

export const serviceParams = z.object({ id: uuid });

// ── Admin: codes, artifacts, revocations ───────────────────────────────────

export const codeParams = z.object({ codeId: uuid });

/**
 * Filters of the codes registry (GET /api/admin/codes and /api/admin/codes/ids): the product's
 * production batch (exact) and model, the code's status, and the UTC days it was issued in
 * (`issuedFrom` to `issuedTo`, both included).
 */
export const codeListQuery = z
  .object({
    productionBatch,
    modelId: queryOptional(uuid),
    status: queryOptional(z.enum(CODE_STATUSES)),
    issuedFrom: queryOptional(isoDate),
    issuedTo: queryOptional(isoDate),
  })
  .refine((q) => !q.issuedFrom || !q.issuedTo || q.issuedFrom <= q.issuedTo, { message: 'issuedFrom must not be after issuedTo', path: ['issuedTo'] });
export type CodeListQuery = z.infer<typeof codeListQuery>;

export const artifactParams = z.object({ codeId: uuid, format: z.enum(['svg', 'png', 'pdf']) });

/** classic | inverted | ivory; `black` stays accepted as a deprecated alias of classic. */
const artifactTheme = z.enum(['classic', 'inverted', 'ivory', 'black']);

export const artifactQuery = z.object({
  widthMm: queryNumber,
  theme: artifactTheme.optional(),
  decor: queryBool,
  label: queryBool,
  dpi: queryNumber,
  kOnly: queryBool,
});

/** Multi-up PDF print sheet (extension of the contract's artifact route; 200 codes fit in the 16 KB body). */
export const printSheetBody = body({
  codeIds: z.array(uuid).min(1, 'Select at least one code').max(200, 'At most 200 codes per sheet'),
  widthMm: z.number().finite().optional(),
  theme: artifactTheme.optional(),
  decor: z.boolean().optional(),
  label: z.boolean().optional(),
  kOnly: z.boolean().optional(),
  page: z.enum(['A4', 'A3', 'LETTER']).optional(),
  cropMarks: z.boolean().optional(),
});

/**
 * Certificate cards (§15.7): each claim code travels once, in the body (never a URL), is checked
 * against its product's hash and never stored. Messages never repeat a submitted value.
 */
export const certificateBody = body({
  items: z
    .array(
      z.strictObject({
        productId: productRef,
        claimCode: z.string().max(32, 'Invalid claim code'),
      }),
    )
    .min(1, 'Add at least one product')
    .max(50, 'At most 50 products per request'),
  format: z.enum(['pdf', 'csv']).optional(),
  layout: z.enum(['card', 'sheet']).optional(),
});

export const createRevocationBody = body({
  targetType: z.enum(REVOCATION_TARGET_TYPES),
  targetId: z.string().trim().min(1, 'Required').max(64, 'At most 64 characters'),
  reason: text(500),
});

// ── Admin: scans, anomalies, warranties, audit ─────────────────────────────

export const scanListQuery = z.object({
  productId: productRef.optional(),
  state: z.enum(VERIFICATION_STATES).optional(),
});

export const anomalyListQuery = z.object({
  status: z.enum(ANOMALY_STATUSES).optional(),
  severity: z.enum(ANOMALY_SEVERITIES).optional(),
});

export const anomalyParams = z.object({ id: uuid });

export const anomalyPatchBody = body({
  status: z.enum(ANOMALY_STATUSES),
  note: z.preprocess((v) => (v === '' ? null : v), z.string().max(2000, 'At most 2000 characters').nullable().optional()),
});

export const warrantyListQuery = z.object({
  status: z.enum(['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'VOID']).optional(),
});

export const auditListQuery = z.object({
  action: z
    .string()
    .trim()
    .max(200)
    .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/, 'Invalid action')
    .optional(),
  actorType: z.enum(['admin', 'account', 'system']).optional(),
  actorId: z.string().trim().max(200).optional(),
  targetType: z.string().trim().max(64).optional(),
  targetId: z.string().trim().max(200).optional(),
});

// ── Admin: keys ────────────────────────────────────────────────────────────

export const keyParams = z.object({
  keyId: z
    .string()
    .regex(/^\d{1,3}$/, 'Invalid key id')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 255, 'Invalid key id'),
});

export const rotateKeyBody = optionalBody({
  kid: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().max(64).optional()),
});

export const revokeKeyBody = body({
  reason: text(500),
  compromisedAt: z.preprocess((v) => (v === '' || v === null ? undefined : v), isoDateTime.optional()),
});
