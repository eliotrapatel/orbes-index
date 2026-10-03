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
  REPORT_CHANNELS,
  REPORT_STATUSES,
  REVOCATION_TARGET_TYPES,
  SERVICE_TYPES,
  STAFF_ROLES,
  VERIFICATION_STATES,
} from '../db/schema.js';
import { MODEL_IDENTITY_MESSAGE } from '../services/catalog.js';
import { ANOMALY_SORTS, ANOMALY_TYPES } from '../services/anomaly.js';
import { MAX_ISSUE_BATCH } from '../services/issuance.js';
import { ANALYTICS_MAX_DAYS, daySpan } from '../services/scan-stats.js';
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

/** Optional text where null, '' and blank text mean "not given" (admin forms send empty strings). */
export const optionalText = (max: number) =>
  z.preprocess((v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v), text(max).optional());

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

/** A calendar day, YYYY-MM-DD, from year 0001: JavaScript reads year 0000, PostgreSQL has none. */
const isoDate = z
  .string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a valid date');

/** The first instant PostgreSQL stores as one of the common era (0001-01-01, UTC). */
const FIRST_INSTANT_MS = Date.parse('0001-01-01T00:00:00.000Z');
/**
 * The last instant of a four-digit year (9999-12-31, UTC). A later one (`9999-12-31T23:00:00-05:00`)
 * is in year 10000, which PGlite sends as `+010000-…` and PostgreSQL refuses: refused here (400).
 */
const LAST_INSTANT_MS = Date.parse('9999-12-31T23:59:59.999Z');

const isoDateTime = z
  .string()
  .max(40)
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), 'Must be an ISO 8601 date-time with a time zone')
  .refine((s) => !(Date.parse(s) < FIRST_INSTANT_MS), 'Must be on or after 0001-01-01 (UTC)')
  .refine((s) => !(Date.parse(s) > LAST_INSTANT_MS), 'Must be on or before 9999-12-31 (UTC)')
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

/**
 * POST /api/v1/reports (§8.5): where the customer saw or bought the piece of a scan that was not
 * authentic. `where` and `note` are optional free text ('' and null mean "not given").
 */
export const reportBody = body({
  scanId: uuid,
  channel: z.enum(REPORT_CHANNELS),
  where: optionalText(200),
  note: optionalText(500),
});

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

/** POST /api/v1/account/password (§10.7): the policy of `newPassword` is the service's (≥ 12 characters…). */
export const changePasswordBody = body({ currentPassword: password, newPassword: password });

/**
 * POST /api/v1/account/recover (§10.8): the code given by ORBES Client Services, any accepted spelling
 * (XXXX-XXXX-XXXX, lower case, spaces); a malformed one is refused like a wrong one, by the service.
 */
export const recoverAccountBody = body({
  email,
  recoveryCode: z.string().trim().min(1, 'Required').max(32, 'Invalid recovery code'),
  newPassword: password,
});

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

/** POST /api/admin/auth/password: the signed-in admin's own password (the policy is checked by AuthService). */
export const adminPasswordChangeBody = body({ currentPassword: password, newPassword: password });

// ── Admin: console users (Team page, ADMIN) ────────────────────────────────

const staffRole = z.enum(STAFF_ROLES, { error: 'Must be OPERATOR, AUDITOR or RETAIL (the ADMIN role is granted from the shell)' });

export const createStaffBody = body({ email, role: staffRole });

export const adminRoleBody = body({ role: staffRole });

// ── Ownership ──────────────────────────────────────────────────────────────

export const registerOwnershipBody = body({
  registrationToken: z.string().trim().min(1, 'Required').max(128, 'Invalid registration token').regex(BASE64URL_RE, 'Invalid registration token'),
  claimCode: z.preprocess((v) => (v === '' ? null : v), z.string().max(32, 'Invalid claim code').nullable().optional()),
});

export const productRefBody = body({ productId: productRef });

const transferCode = z.string().trim().min(1, 'Required').max(32, 'Invalid transfer code');
/** VerifyOutcome.transfer.token (F-03): a scan token, base64url. A missing one is the service's to refuse (TRANSFER_SCAN_REQUIRED). */
const transferToken = z.string().trim().min(1, 'Required').max(128, 'Invalid scan').regex(BASE64URL_RE, 'Invalid scan').optional();

/**
 * POST /api/v1/ownership/transfers/accept (§11.3, F-03): the transfer code, the piece the recipient scanned
 * (`productId`, required) and the transfer token of that scan.
 */
export const acceptTransferBody = body({ transferCode, productId: productRef, transferToken });

/**
 * The same body with TRANSFER_ACCEPT_REQUIRE_PRODUCT=false: an acceptance assisted by ORBES Client Services may
 * name no piece. Whatever is sent is still checked by the service.
 */
export const assistedAcceptTransferBody = body({ transferCode, productId: productRef.optional(), transferToken });

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

/** The letter in `/api/admin/categories/:code/active`, any case. */
export const categoryParams = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]$/, 'Must be a single letter A–Z')
    .transform((s) => s.toUpperCase()),
});

/** ADMIN: a category stops (false) or starts again (true) receiving new products; its pieces verify either way. */
export const categoryActiveBody = body({ active: z.boolean() });

export const catalogParams = z.object({ id: uuid });

export const updateCollectionBody = body({ name: text(100) });

/** Named here so that sending one says why (the service's own words): a model's identity is written in the pieces already issued. */
const modelIdentity = z.never({ error: MODEL_IDENTITY_MESSAGE }).optional();

/**
 * A model's change (A-10): its name, default material, care instructions, collection and `active`, at least one.
 * `''`/`null` clears the material, the care instructions or the collection. Never `category`, `categoryCode` nor
 * `skuPrefix` (400); any other field is unknown (400).
 */
export const updateModelBody = body({
  name: text(100).optional(),
  defaultMaterial: z.preprocess((v) => (v === '' ? null : v), text(200).nullable().optional()),
  careInstructions: z.preprocess((v) => (v === '' ? null : v), text(2000).nullable().optional()),
  collectionId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
  active: z.boolean().optional(),
  category: modelIdentity,
  categoryCode: modelIdentity,
  skuPrefix: modelIdentity,
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field of the model to change');

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

/** An optional field where '' and null mean "not given" (admin forms send empty fields). */
const formOptional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

/**
 * A batch of pieces to issue (POST /api/admin/products/batch): the fields they share, then 1 to
 * MAX_ISSUE_BATCH lines of what changes from one piece to the next. The shapes and bounds of
 * POST /api/admin/products; the issuance service applies its rules to every line before it signs any.
 */
export const issueBatchBody = body({
  template: z.strictObject({
    categoryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]$/, 'Must be a single letter A–Z')
      .transform((s) => s.toUpperCase()),
    modelId: uuid,
    collectionId: formOptional(uuid),
    material: text(200),
    productionBatch: optionalText(100),
    productionDate: formOptional(isoDate),
    year: formOptional(z.number().int('Must be a whole year').min(2000, 'Must be 2000–2099').max(2099, 'Must be 2000–2099')),
    authPolicy: formOptional(z.string().trim().max(200, 'At most 200 characters')),
    withClaimSecret: formOptional(z.boolean()),
  }),
  items: z
    .array(
      z.strictObject({
        variant: optionalText(100),
        sku: formOptional(
          z
            .string()
            .trim()
            .max(64, 'At most 64 characters')
            .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, 'Letters, digits, space, dot, underscore, hyphen and slash only'),
        ),
        serial: formOptional(z.number().int('Must be a whole number').min(1, 'Must be 1–999999').max(999_999, 'Must be 1–999999')),
      }),
    )
    .min(1, 'Add at least one piece')
    .max(MAX_ISSUE_BATCH, `At most ${MAX_ISSUE_BATCH} pieces per request`),
});

export const transitionBody = body({
  to: z.enum(PRODUCT_STATUSES),
  reason: z.preprocess((v) => (v === '' ? null : v), z.string().max(1000, 'At most 1000 characters').nullable().optional()),
});

export const optionalReasonBody = optionalBody({
  reason: z.preprocess((v) => (v === '' ? null : v), z.string().max(1000, 'At most 1000 characters').nullable().optional()),
});

export const requiredReasonBody = body({ reason: text(500) });

/**
 * `retailerId` (A-08): a point of sale of the register, whose country is the default purchase country.
 * The free-text `retailer` stays accepted (history, API callers); the console sends `retailerId` only.
 */
export const warrantyActivateBody = optionalBody({
  purchaseDate: z.preprocess((v) => (v === '' || v === null ? undefined : v), isoDate.optional()),
  retailer: z.preprocess((v) => (v === '' ? null : v), z.string().max(200, 'At most 200 characters').nullable().optional()),
  retailerId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
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

// ── Admin: points of sale and the sale mode (A-08) ──────────────────────────

export const retailerParams = z.object({ id: uuid });

export const retailerListQuery = z.object({ active: queryBool });

export const createRetailerBody = body({
  name: text(120),
  city: optionalText(80),
  country: z.preprocess((v) => (v === '' ? null : v), country.nullable().optional()),
});

/** Rename, move or (de)activate; at least one field. A point of sale is never deleted. */
export const updateRetailerBody = body({
  name: text(120).optional(),
  city: z.preprocess((v) => (v === '' ? null : v), text(80).nullable().optional()),
  country: z.preprocess((v) => (v === '' ? null : v), country.nullable().optional()),
  active: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');

/** POST /api/admin/sale/lookup: what the sale mode's decoder read, in the shape of a verification (§9.1). */
export const saleLookupBody = verifyBody;

export const saleActivateBody = body({
  token: z.string().trim().min(1, 'Required').max(128, 'Invalid sale token').regex(BASE64URL_RE, 'Invalid sale token'),
  retailerId: uuid,
});

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

const DAY_MS = 86_400_000;

/**
 * One end of a time window: an ISO 8601 date-time with its zone, or a UTC day (`YYYY-MM-DD`), which
 * stands for its first millisecond as a start (`from`) and its last as an end (`to`). Both ends are included.
 */
const windowBound = (end: 'from' | 'to') =>
  z.union([
    isoDate.transform((d) => new Date(Date.parse(`${d}T00:00:00.000Z`) + (end === 'to' ? DAY_MS - 1 : 0))),
    isoDateTime,
  ]);

/**
 * Filters of the scans registry (GET /api/admin/scans): the product, the result, one scan (a case's link to
 * its scan), and the window `from`–`to` the scans were made in (both included), e.g. the window of an anomaly.
 */
export const scanListQuery = z
  .object({
    productId: queryOptional(productRef),
    state: queryOptional(z.enum(VERIFICATION_STATES)),
    /** One scan (a case's link to its scan). */
    scanId: queryOptional(uuid),
    from: queryOptional(windowBound('from')),
    to: queryOptional(windowBound('to')),
  })
  .refine((q) => !q.from || !q.to || q.from.getTime() <= q.to.getTime(), { message: 'from must not be after to', path: ['to'] });

/**
 * Filters and order of the anomalies list (GET /api/admin/anomalies). `type` is one of the types the
 * service can record (ANOMALY_TYPES, derived from ANOMALY_WEIGHTS); `sort` defaults to severity.
 */
export const anomalyListQuery = z.object({
  status: queryOptional(z.enum(ANOMALY_STATUSES)),
  severity: queryOptional(z.enum(ANOMALY_SEVERITIES)),
  type: queryOptional(z.enum(ANOMALY_TYPES)),
  productId: queryOptional(productRef),
  sort: queryOptional(z.enum(ANOMALY_SORTS)),
  /** One anomaly (a case's link to the anomaly its scan took part in). */
  id: queryOptional(uuid),
});

export const anomalyParams = z.object({ id: uuid });

/** A customer account (`accounts.id`): its sheet, recovery code, lock and export (§16.10–16.13). */
export const ownerParams = z.object({ id: uuid });

/**
 * The owners list (§16.2): every account, or one exact email (normalised by the service, as at sign-in), or the
 * REF printed under a result (`REF 1A2B3C4D`, any case, or a whole scan id; parsed by the service). One or none.
 */
export const ownerListQuery = z
  .object({
    email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(3, 'Enter the whole email address').max(254, 'At most 254 characters').optional()),
    ref: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1, 'Required').max(64, 'At most 64 characters').optional()),
  })
  .refine((q) => q.email === undefined || q.ref === undefined, { message: 'Search by email or by REF, not both', path: ['ref'] });

export const anomalyPatchBody = body({
  status: z.enum(ANOMALY_STATUSES),
  note: z.preprocess((v) => (v === '' ? null : v), z.string().max(2000, 'At most 2000 characters').nullable().optional()),
});

/** The Cases queue (§16.8): OPEN or CLOSED, one scan's case, or the cases of an anomaly's scans. */
export const reportListQuery = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  scanId: uuid.optional(),
  anomalyId: uuid.optional(),
});

export const reportParams = z.object({ id: uuid });

/** Closing a case needs a note: what was done for the customer, or why nothing was. */
export const reportPatchBody = body({
  status: z.literal('CLOSED'),
  note: text(2000),
});

/**
 * The window of the daily scan statistics (GET /api/admin/analytics): the UTC days `from` to `to`, both
 * included, at most ANALYTICS_MAX_DAYS (366). Without `from`, the window is the `days` days (default 30)
 * that end on `to`; `to` defaults to the last complete day (scan-stats.ts `analyticsWindow`). `from` and
 * `days` are exclusive.
 */
export const analyticsQuery = z
  .object({
    from: queryOptional(isoDate),
    to: queryOptional(isoDate),
    days: queryOptional(
      z.preprocess(
        (v) => (typeof v === 'string' && /^\s*\d{1,4}\s*$/.test(v) ? Number(v) : v),
        z.number().int('Must be a whole number of days').min(1, 'At least 1 day').max(ANALYTICS_MAX_DAYS, `At most ${ANALYTICS_MAX_DAYS} days`),
      ),
    ),
  })
  .refine((q) => q.from === undefined || q.days === undefined, { message: 'Give either from or days, not both', path: ['days'] })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to', path: ['to'] })
  .refine((q) => !q.from || !q.to || daySpan(q.from, q.to) <= ANALYTICS_MAX_DAYS, {
    message: `The window is at most ${ANALYTICS_MAX_DAYS} days`,
    path: ['to'],
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

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
