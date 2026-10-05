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
  CIRCLE_POST_KINDS,
  CIRCLE_RSVP_ANSWERS,
  CLUB_TIER_NAMES,
  CODE_STATUSES,
  DROP_ENTRY_STATUSES,
  INVOICE_KINDS,
  LIVE_ENTRY_STATUSES,
  LOOKBOOK_STATES,
  ORDER_CHANNELS,
  PRODUCT_STATUSES,
  REPORT_CHANNELS,
  REPORT_STATUSES,
  RETURN_OUTCOMES,
  REVOCATION_TARGET_TYPES,
  SERVICE_TYPES,
  SHOP_REQUEST_OUTCOMES,
  SHOP_REQUEST_STATUSES,
  STAFF_ROLES,
  VERIFICATION_STATES,
} from '../db/schema.js';
import { ATELIER_MAKE_MAX, BENCH_VIEWS, ISSUE_TEXT_LIMITS, THRESHOLD_MAX, WORK_SHEETS_MAX } from '../services/atelier.js';
import { MODEL_IDENTITY_MESSAGE } from '../services/catalog.js';
import { ANOMALY_SORTS, ANOMALY_TYPES } from '../services/anomaly.js';
import { CIRCLE_BODY_MAX, CIRCLE_CAPACITY_MAX, CIRCLE_PLACE_MAX, CIRCLE_POLL_OPTION_MAX, CIRCLE_POLL_OPTIONS, CIRCLE_TITLE_MAX, CIRCLE_URL_MAX } from '../services/circle.js';
import { CLUB_TIER_BENEFITS_MAX } from '../services/club.js';
import { DROP_DESCRIPTION_MAX, DROP_NOTE_MAX, DROP_QUANTITY_MAX, DROP_TITLE_MAX, EARLY_ACCESS_HOURS, PURCHASE_WINDOW_HOURS } from '../services/drops.js';
import { MAX_ISSUE_BATCH } from '../services/issuance.js';
import { AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES } from '../services/after-room.js';
import { LIVE_ADD_PIECES, LIVE_ADDONS_MAX, LIVE_EXTEND_MINUTES, LIVE_MESSAGE_MAX, LIVE_PAY_MINUTES, LIVE_PER_ACCOUNT, LIVE_ROOM_OPENS_MINUTES, LIVE_SIZE_STOCK_MAX, LIVE_TURN_SECONDS } from '../services/live.js';
import {
  LIVE_ACCESS_MODELS_MAX,
  LIVE_ADDON_LIMITS,
  LIVE_CURRENCIES,
  LIVE_PRICE_MAX_MINOR,
  LIVE_QUANTITY_LINE_MAX,
  LIVE_SIZES,
} from '../services/live-console.js';
import { PRICE_LABEL_MAX, SLUG_MAX, SPECS_MAX, STORY_MAX } from '../services/lookbook.js';
import { CIRCLE_PHOTOS_MAX, GALLERY_ALT_MAX, GALLERY_MAX } from '../services/media.js';
import { SHOP_NOTE_MAX, SHOP_RESOLUTION_MAX } from '../services/salon.js';
import { CERTIFICATE_MAX_DAYS, CERTIFICATE_MIN_DAYS } from '../services/ownership-certificates.js';
import { ANALYTICS_MAX_DAYS, daySpan } from '../services/scan-stats.js';
import { BOARD_SEARCH_MAX, ORDER_ALERT_LIMITS } from '../services/fulfilment.js';
import { ORDER_AMOUNT_MAX_MINOR, ORDER_CURRENCIES, ORDER_TEXT_LIMITS } from '../services/orders.js';
import { CARRIER_NAME_MAX, LOCATION_NAME_MAX, STOCK_MOVE_MAX, STOCK_NOTE_MAX, TRACKING_URL_MAX } from '../services/stock.js';
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

/** A stored photograph's name: the hex SHA-256 of its bytes, any case. */
const sha256Hex = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'Must be a SHA-256 in hexadecimal')
  .transform((s) => s.toLowerCase());

/** GET /api/v1/media/:sha256 (§8.6): a stored photograph, named by the hex SHA-256 of its bytes. */
export const mediaParams = z.object({ sha256: sha256Hex });

/**
 * GET /api/v1/lookbook/:slug and /api/v1/club/lookbook/:slug (§8.8, §10.9, P-R02): the address of a sheet. Any string the
 * router passes (≤ 128 characters): one that is no address answers like an unknown one, 404 LOOKBOOK_NOT_FOUND.
 */
export const lookbookParams = z.object({ slug: z.string().max(128) });

/**
 * GET /api/v1/drops/:id and /entries, POST /api/v1/club/drops/:id/enter, /withdraw (§8.9, §10.10, P-R03) and /reserve
 * (P-X02): a drop's id. Any string the router passes (≤ 64 characters): one that is no id answers like an unknown drop,
 * 404 DROP_NOT_FOUND.
 */
export const publicDropParams = z.object({ id: z.string().max(64) });

/**
 * GET /api/v1/club/circle/:id, POST …/rsvp and …/vote (P-X01): a post of the circle. Any string the router passes (≤ 64
 * characters): one that is no id answers like an unknown post, 404 CIRCLE_POST_NOT_FOUND.
 */
export const publicCircleParams = z.object({ id: z.string().max(64) });

/**
 * POST /api/v1/club/lookbook/:slug/request (P-X08, REQUEST THIS PIECE): the account's note for ORBES Client Services,
 * optional (blank text or `null`: none; the body itself may be left out), at most 500 characters once trimmed.
 */
export const salonRequestBody = optionalBody({
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), text(SHOP_NOTE_MAX).nullable().optional()),
});

/** POST /api/v1/club/circle/:id/rsvp (P-X01): the account's answer to an invitation, YES or NO. */
export const circleRsvpBody = body({ answer: z.enum(CIRCLE_RSVP_ANSWERS) });

/** POST /api/v1/club/circle/:id/vote (P-X01): the index of one option of the poll, from 0. */
export const circleVoteBody = body({
  option: z
    .number()
    .int('Must be the index of an option')
    .min(0, 'Must be the index of an option')
    .max(CIRCLE_POLL_OPTIONS.max - 1, 'Must be the index of an option'),
});

// ── The LIVE RELEASES (routes/live.ts) ─────────────────────────────────────

/**
 * /api/v1/live/:id/… : a LIVE RELEASE's id. Any string the router passes (≤ 64 characters): one that is no id answers like
 * an unknown release, 404 DROP_NOT_FOUND.
 */
export const liveParams = z.object({ id: z.string().max(64) });

/** An id the service checks against the release's own (a size, an add-on): one that is not answers 400 LIVE_SIZE_UNKNOWN or LIVE_ADDON_UNKNOWN. */
const liveRef = z.string().max(64);

/** PUT /api/v1/live/:id/interest: I'LL BE THERE, in this size. */
export const liveInterestBody = body({ sizeId: liveRef });

/** POST /api/v1/live/:id/enter and /size: the size, and the pieces (1 by default; up to the release's own limit, at most 5). */
export const liveEntryBody = body({
  sizeId: liveRef,
  quantity: z.number().int('Must be a whole number of pieces').min(1, 'At least 1 piece').max(LIVE_PER_ACCOUNT.max, `At most ${LIVE_PER_ACCOUNT.max} pieces`).optional(),
});

/** POST /api/v1/live/:id/press and /secure: the turn's secret, as the account's state gave it. */
export const liveTurnBody = body({ token: z.string().trim().min(1, 'Required').max(128, 'Invalid turn').regex(BASE64URL_RE, 'Invalid turn') });

/** PUT /api/v1/live/:id/addons: the add-ons chosen for the piece held, each once, at most six (none: an empty list). */
export const liveAddonsBody = body({ addonIds: z.array(liveRef).max(LIVE_ADDONS_MAX, `At most ${LIVE_ADDONS_MAX} add-ons`) });

/**
 * POST /api/v1/live/:id/board and /board/stream: the board link's secret, from the fragment of its address (never in a
 * request line or a log). Missing or malformed, it answers like a wrong one: 404 DROP_NOT_FOUND.
 */
export const liveBoardBody = optionalBody({ token: z.string().max(256).optional() });

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

/**
 * POST /api/v1/ownership/incidents/resolve (§11.6, PIECE FOUND): the piece, and the account's password, typed again: a
 * session alone (one left open on another device, or taken) does not make a piece reported lost read as clean.
 */
export const resolveIncidentBody = body({ productId: productRef, currentPassword: password });

export const productParams = z.object({ productId: productRef });

// ── Ownership certificates (F-06) ──────────────────────────────────────────

/** POST /api/v1/ownership/certificates (§11.7): the piece, and how many days its link lives (1 to 90; 30 when omitted). */
export const createCertificateBody = body({
  productId: productRef,
  validDays: z
    .number()
    .int('Must be a whole number of days')
    .min(CERTIFICATE_MIN_DAYS, `At least ${CERTIFICATE_MIN_DAYS} day`)
    .max(CERTIFICATE_MAX_DAYS, `At most ${CERTIFICATE_MAX_DAYS} days`)
    .optional(),
});

/** DELETE /api/v1/ownership/certificates/:id (§11.7). */
export const certificateParams = z.object({ id: uuid });

/**
 * POST /api/v1/certificates/lookup and /pdf (§8.7): the token of the link's fragment, in any spelling. Only its type
 * and a size bound are checked here: a token that cannot be one answers 404, as an unknown one does (the service's).
 */
export const certificateTokenBody = body({ token: z.string().trim().min(1, 'Required').max(128, 'Invalid certificate link') });

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
 * A model's change (A-10): its name, default material, care instructions, collection and `active`, and its lookbook
 * (P-R02: `lookbook`, `slug`, `story`, `specs`), at least one. `''`/`null` clears the material, the care instructions,
 * the collection, the slug (while the model was never published), the story, the specifications or the price of the
 * private salon (P-X08: `priceLabel`, and `privateMinTier` 1 to 3). The service holds
 * the rules of the lookbook (the slug's form and uniqueness, the lines of the specifications). Never `category`,
 * `categoryCode` nor `skuPrefix` (400); any other field is unknown (400).
 */
export const updateModelBody = body({
  name: text(100).optional(),
  defaultMaterial: z.preprocess((v) => (v === '' ? null : v), text(200).nullable().optional()),
  careInstructions: z.preprocess((v) => (v === '' ? null : v), text(2000).nullable().optional()),
  collectionId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
  active: z.boolean().optional(),
  lookbook: z.enum(LOOKBOOK_STATES).optional(),
  slug: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(SLUG_MAX, `At most ${SLUG_MAX} characters`).nullable().optional()),
  story: z.preprocess((v) => (v === '' ? null : v), text(STORY_MAX).nullable().optional()),
  specs: z.preprocess((v) => (v === '' ? null : v), text(SPECS_MAX).nullable().optional()),
  priceLabel: z.preprocess((v) => (v === '' ? null : v), text(PRICE_LABEL_MAX).nullable().optional()),
  privateMinTier: z.number().int('Must be a tier: 1, 2 or 3').min(1, 'At least 1 (TITANE)').max(3, 'At most 3 (PALLADIUM)').optional(),
  category: modelIdentity,
  categoryCode: modelIdentity,
  skuPrefix: modelIdentity,
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field of the model to change');

/** DELETE /api/admin/models/:id/gallery/:sha256 (P-R02): a photograph of the model's gallery. */
export const galleryImageParams = z.object({ id: uuid, sha256: sha256Hex });

/**
 * PATCH /api/admin/models/:id/gallery (P-R02): every photograph of the gallery once, in the new order, each with its
 * alternative text (`''`/`null`: the sheet's default; left out: unchanged). The service checks the list against the gallery.
 */
export const galleryOrderBody = body({
  images: z
    .array(
      z.strictObject({
        sha256: sha256Hex,
        alt: z.preprocess((v) => (v === '' ? null : v), text(GALLERY_ALT_MAX).nullable().optional()),
      }),
    )
    .max(GALLERY_MAX, `At most ${GALLERY_MAX} photographs`),
});

// ── Admin: drops (P-R03) ───────────────────────────────────────────────────

export const dropParams = z.object({ id: uuid });

export const dropEntryParams = z.object({ id: uuid, entryId: uuid });

const dropTitle = text(DROP_TITLE_MAX);
const dropQuantity = z.number().int('Must be a whole number of pieces').min(1, 'At least 1 piece').max(DROP_QUANTITY_MAX, `At most ${DROP_QUANTITY_MAX} pieces`);
const purchaseWindowHours = z
  .number()
  .int('Must be a whole number of hours')
  .min(PURCHASE_WINDOW_HOURS.min, `At least ${PURCHASE_WINDOW_HOURS.min} hour`)
  .max(PURCHASE_WINDOW_HOURS.max, `At most ${PURCHASE_WINDOW_HOURS.max} hours`);
/** P-X02: the early access before the opening, 0 (none) to 336 hours. */
const earlyAccessHours = z
  .number()
  .int('Must be a whole number of hours')
  .min(EARLY_ACCESS_HOURS.min, `At least ${EARLY_ACCESS_HOURS.min} hours`)
  .max(EARLY_ACCESS_HOURS.max, `At most ${EARLY_ACCESS_HOURS.max} hours`);

/**
 * POST /api/admin/drops (§16.19): a DRAFT of a model's release, its entries' window (`closesAt` after `opensAt`), its
 * pieces, how long a place drawn is held (48 hours when omitted) and its early access (P-X02: the hours before the
 * opening when PLATINE and PALLADIUM reserve a place directly, 48 when omitted, 0 for none). The description is plain
 * text ('' and null: none).
 */
export const createDropBody = body({
  modelId: uuid,
  title: dropTitle,
  description: z.preprocess((v) => (v === '' ? null : v), text(DROP_DESCRIPTION_MAX).nullable().optional()),
  quantity: dropQuantity,
  opensAt: isoDateTime,
  closesAt: isoDateTime,
  purchaseWindowHours: purchaseWindowHours.optional(),
  earlyAccessHours: earlyAccessHours.optional(),
}).refine((b) => b.closesAt.getTime() > b.opensAt.getTime(), { message: 'Entries close after they open', path: ['closesAt'] });

/**
 * PATCH /api/admin/drops/:id (§16.19): any field while the drop is a DRAFT; once published, `description` only (the
 * service's rule, 409 DROP_PUBLISHED). At least one field; '' and null clear the description.
 */
export const updateDropBody = body({
  modelId: uuid.optional(),
  title: dropTitle.optional(),
  description: z.preprocess((v) => (v === '' ? null : v), text(DROP_DESCRIPTION_MAX).nullable().optional()),
  quantity: dropQuantity.optional(),
  opensAt: isoDateTime.optional(),
  closesAt: isoDateTime.optional(),
  purchaseWindowHours: purchaseWindowHours.optional(),
  earlyAccessHours: earlyAccessHours.optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field of the release to change');

/** GET /api/admin/drops/:id/entries: one status, or every entry. */
export const dropEntriesQuery = z.object({ status: queryOptional(z.enum(DROP_ENTRY_STATUSES)) });

/** POST …/entries/:entryId/confirm and …/lapse: the console's note on the entry, optional ('' and null: none). */
export const dropEntryNoteBody = optionalBody({
  note: z.preprocess((v) => (v === '' ? null : v), text(DROP_NOTE_MAX).nullable().optional()),
});

// ── Admin: the LIVE RELEASES (routes/admin/live.ts) ────────────────────────

/** '' as the console's forms send an empty field: null. */
const emptyToNull = (v: unknown) => (v === '' ? null : v);

export const liveAdminParams = z.object({ id: uuid });

export const liveAdminEntryParams = z.object({ id: uuid, entryId: uuid });

const whole = (min: number, max: number, unit: string) =>
  z.number().int(`Must be a whole number of ${unit}`).min(min, `At least ${min} ${unit}`).max(max, `At most ${max} ${unit}`);
const livePrice = z.number().int('Must be a whole number of cents').min(0, 'At least 0').max(LIVE_PRICE_MAX_MINOR, `At most ${LIVE_PRICE_MAX_MINOR} cents`);
const liveTime = z.preprocess(emptyToNull, isoDateTime.nullable().optional());
const liveSizes = z
  .array(z.strictObject({ id: uuid.nullable().optional(), label: text(LIVE_SIZES.label), stock: whole(0, LIVE_SIZE_STOCK_MAX, 'pieces') }))
  .min(LIVE_SIZES.min, `At least ${LIVE_SIZES.min} size`)
  .max(LIVE_SIZES.max, `At most ${LIVE_SIZES.max} sizes`);
const liveAddons = z
  .array(
    z.strictObject({
      id: uuid.nullable().optional(),
      label: text(LIVE_ADDON_LIMITS.label),
      line: z.preprocess(emptyToNull, text(LIVE_ADDON_LIMITS.line).nullable().optional()),
      priceMinor: livePrice,
    }),
  )
  .max(LIVE_ADDONS_MAX, `At most ${LIVE_ADDONS_MAX} add-ons`);
/** The settings of a LIVE RELEASE (services/live-console.ts holds their rules: the times' order, the totals, the lists' ids). */
const liveSettingsFields = {
  modelId: uuid,
  title: dropTitle,
  description: z.preprocess(emptyToNull, text(DROP_DESCRIPTION_MAX).nullable().optional()),
  opensAt: isoDateTime,
  closesAt: isoDateTime,
  roomOpensMinutes: whole(LIVE_ROOM_OPENS_MINUTES.min, LIVE_ROOM_OPENS_MINUTES.max, 'minutes').optional(),
  turnSeconds: whole(LIVE_TURN_SECONDS.min, LIVE_TURN_SECONDS.max, 'seconds').optional(),
  payMinutes: whole(LIVE_PAY_MINUTES.min, LIVE_PAY_MINUTES.max, 'minutes').optional(),
  perAccount: whole(LIVE_PER_ACCOUNT.min, LIVE_PER_ACCOUNT.max, 'pieces').optional(),
  priceMinor: livePrice,
  currency: z.enum(LIVE_CURRENCIES).optional(),
  minTier: z.number().int('Must be a tier: 0 to 3').min(0, 'At least 0 (every ORBES account)').max(3, 'At most 3 (PALLADIUM)').optional(),
  tierPriority: z.boolean().optional(),
  accessModelIds: z.array(uuid).max(LIVE_ACCESS_MODELS_MAX, `At most ${LIVE_ACCESS_MODELS_MAX} models`).optional(),
  accessCollectionId: z.preprocess(emptyToNull, uuid.nullable().optional()),
  sizes: liveSizes,
  quantityLine: z.preprocess(emptyToNull, text(LIVE_QUANTITY_LINE_MAX).nullable().optional()),
  addons: liveAddons.optional(),
  announceAt: liveTime,
  silhouetteAt: liveTime,
  nameAt: liveTime,
  photoAt: liveTime,
  tierWindows: z
    .array(
      z.strictObject({
        tier: z.number().int('Must be a tier: 0 to 3').min(0, 'At least 0').max(3, 'At most 3'),
        turnSeconds: whole(LIVE_TURN_SECONDS.min, LIVE_TURN_SECONDS.max, 'seconds').nullable().optional(),
        payMinutes: whole(LIVE_PAY_MINUTES.min, LIVE_PAY_MINUTES.max, 'minutes').nullable().optional(),
      }),
    )
    .max(4, 'At most one override per tier')
    .optional(),
  /** The after-room (plan LIVE RELEASE+, choice 2): its model, price, sizes and stock, add-ons, delay and length; null: none. */
  afterRoom: z
    .strictObject({
      modelId: uuid,
      priceMinor: livePrice,
      sizes: liveSizes,
      addons: liveAddons.optional(),
      delayMinutes: whole(AFTER_ROOM_DELAY_MINUTES.min, AFTER_ROOM_DELAY_MINUTES.max, 'minutes').optional(),
      lengthMinutes: whole(AFTER_ROOM_LENGTH_MINUTES.min, AFTER_ROOM_LENGTH_MINUTES.max, 'minutes').optional(),
    })
    .nullable()
    .optional(),
};

/** POST /api/admin/live: a LIVE RELEASE, a DRAFT, with its settings (the defaults for those left out). */
export const createLiveBody = body(liveSettingsFields).refine((b) => b.closesAt.getTime() > b.opensAt.getTime(), { message: 'The release ends after T0', path: ['closesAt'] });

/** PATCH /api/admin/live/:id: any setting until the announcement; a list given replaces the release's. At least one. */
export const updateLiveBody = body(Object.fromEntries(Object.entries(liveSettingsFields).map(([k, v]) => [k, (v as z.ZodType).optional()])) as {
  [K in keyof typeof liveSettingsFields]: z.ZodOptional<(typeof liveSettingsFields)[K]>;
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one setting of the release to change');

/** POST /api/admin/live/:id/publish: with a post of the owners' circle linking the release, or not. */
export const publishLiveBody = optionalBody({ circlePost: z.boolean().optional() });

/** POST /api/admin/live/:id/extend: the end of the sales moved later by 1 to 240 minutes. */
export const liveExtendBody = body({ minutes: whole(LIVE_EXTEND_MINUTES.min, LIVE_EXTEND_MINUTES.max, 'minutes') });

/** POST /api/admin/live/:id/stock: ADD PIECES to a size. */
export const liveStockBody = body({ sizeId: uuid, pieces: whole(LIVE_ADD_PIECES.min, LIVE_ADD_PIECES.max, 'pieces') });

/** POST /api/admin/live/:id/messages: one line for the room. */
export const liveMessageBody = body({ text: text(LIVE_MESSAGE_MAX).refine((s) => !/[\r\n]/.test(s), 'One line') });

/** GET /api/admin/live/:id/entries: one status, the open ones (OPEN), or every entry. */
export const liveEntriesQuery = z.object({ status: queryOptional(z.enum(['OPEN', ...LIVE_ENTRY_STATUSES])) });

// ── Admin: the circle (P-X01) ──────────────────────────────────────────────

export const circlePostParams = z.object({ id: uuid });

/** DELETE /api/admin/circle/posts/:id/photos/:sha256: a photograph of the post. */
export const circlePhotoParams = z.object({ id: uuid, sha256: sha256Hex });

const circleTier = z.number().int('Must be a tier: 1, 2 or 3').min(1, 'At least 1 (TITANE)').max(3, 'At most 3 (PALLADIUM)');
const circleCapacity = z.number().int('Must be a whole number of places').min(1, 'At least 1 place').max(CIRCLE_CAPACITY_MAX, `At most ${CIRCLE_CAPACITY_MAX} places`);
const circlePollOptions = z
  .array(text(CIRCLE_POLL_OPTION_MAX))
  .min(CIRCLE_POLL_OPTIONS.min, `At least ${CIRCLE_POLL_OPTIONS.min} options`)
  .max(CIRCLE_POLL_OPTIONS.max, `At most ${CIRCLE_POLL_OPTIONS.max} options`);
/** The fields of a post, each optional; '' and null clear an optional one. The service holds the rules of each kind. */
const circleFields = {
  title: text(CIRCLE_TITLE_MAX).optional(),
  body: z.preprocess(emptyToNull, text(CIRCLE_BODY_MAX).nullable().optional()),
  minTier: circleTier.optional(),
  eventAt: z.preprocess(emptyToNull, isoDateTime.nullable().optional()),
  eventPlace: z.preprocess(emptyToNull, text(CIRCLE_PLACE_MAX).nullable().optional()),
  capacity: circleCapacity.nullable().optional(),
  pollOptions: circlePollOptions.nullable().optional(),
  dropId: z.preprocess(emptyToNull, uuid.nullable().optional()),
  modelId: z.preprocess(emptyToNull, uuid.nullable().optional()),
  externalUrl: z.preprocess(emptyToNull, z.string().trim().max(CIRCLE_URL_MAX, `At most ${CIRCLE_URL_MAX} characters`).nullable().optional()),
};

/**
 * POST /api/admin/circle/posts (P-X01): a post, not published yet: its kind (NOTE, INVITATION, POLL), its title, and
 * the fields of its kind (an invitation's `eventAt`, `eventPlace` and `capacity`, a poll's `pollOptions`), its tier
 * (1 by default) and its links. The service refuses the fields of another kind and the hosts off its list.
 */
export const createCirclePostBody = body({ kind: z.enum(CIRCLE_POST_KINDS), ...circleFields, title: text(CIRCLE_TITLE_MAX) });

/** PATCH /api/admin/circle/posts/:id: any field but the kind (an unknown field, `kind` included, is 400); at least one. */
export const updateCirclePostBody = body(circleFields).refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field of the post to change');

/** GET /api/admin/circle/posts/:id/answers: one answer, or every one. */
export const circleAnswersQuery = z.object({ answer: queryOptional(z.enum(CIRCLE_RSVP_ANSWERS)) });

/**
 * PATCH /api/admin/circle/posts/:id/photos: every photograph of the post once, in the new order, each with its
 * alternative text (`''`/`null`: the post's default; left out: unchanged).
 */
export const circlePhotoOrderBody = body({
  images: z
    .array(
      z.strictObject({
        sha256: sha256Hex,
        alt: z.preprocess((v) => (v === '' ? null : v), text(GALLERY_ALT_MAX).nullable().optional()),
      }),
    )
    .max(CIRCLE_PHOTOS_MAX, `At most ${CIRCLE_PHOTOS_MAX} photographs`),
});

// ── Admin: the club's tiers (P-X04) ───────────────────────────────────────

/** PATCH /api/admin/club/tiers/:tier: TITANE, PLATINE or PALLADIUM, as written. */
export const clubTierParams = z.object({ tier: z.enum(CLUB_TIER_NAMES) });

/**
 * PATCH /api/admin/club/tiers/:tier: the tier's benefits, one per line (the service drops blank lines and the spaces
 * around each, then holds them to 600 characters and 8 lines); `null` or `''` restores the words by default.
 */
export const updateClubTierBody = body({
  benefits: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), text(CLUB_TIER_BENEFITS_MAX * 2).nullable()),
});

// ── Admin: the private salon's requests (P-X08) ──────────────────────────

/** GET /api/admin/club/requests: OPEN or CLOSED, or every request. */
export const shopRequestsQuery = z.object({ status: queryOptional(z.enum(SHOP_REQUEST_STATUSES)) });

export const shopRequestParams = z.object({ id: uuid });

/**
 * POST /api/admin/club/requests/:id/close: a note is required, what was done for the client or why nothing was, and the
 * outcome: ACCEPTED (the sale concluded: its order is created) or DECLINED.
 */
export const closeShopRequestBody = body({ note: text(SHOP_RESOLUTION_MAX), outcome: z.enum(SHOP_REQUEST_OUTCOMES) });

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

// ── Admin: the orders (plan LIVE RELEASE+, routes/admin/orders.ts) ─────────

export const orderParams = z.object({ id: uuid });

/** GET /api/admin/orders and its CSV: one channel, one release, one location, the late ones, a search. */
export const orderBoardQuery = z.object({
  channel: queryOptional(z.enum(ORDER_CHANNELS)),
  dropId: queryOptional(uuid),
  locationId: queryOptional(uuid),
  late: queryBool,
  q: queryOptional(z.string().trim().max(BOARD_SEARCH_MAX, `At most ${BOARD_SEARCH_MAX} characters`)),
});

const orderNote = z.preprocess(emptyToNull, text(ORDER_TEXT_LIMITS.note).nullable().optional());
const orderAmount = z.number().int('Must be a whole number of cents').min(0, 'At least 0').max(ORDER_AMOUNT_MAX_MINOR, `At most ${ORDER_AMOUNT_MAX_MINOR} cents`);

/**
 * POST /api/admin/orders/:id/transition: the next step and what it requires (services/orders.ts holds which step
 * follows which): PAID; SHIPPED with an active carrier, the tracking number and the value declared for the insurance;
 * DELIVERED; CANCELLED with a note. A return is opened elsewhere.
 */
export const orderTransitionBody = z.discriminatedUnion('to', [
  body({ to: z.literal('PAID'), note: orderNote }),
  body({
    to: z.literal('SHIPPED'),
    carrierId: uuid,
    trackingNumber: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/, 'A tracking number has 3 to 40 letters and digits'),
    declaredValueMinor: orderAmount.nullable().optional(),
    note: orderNote,
  }),
  body({ to: z.literal('DELIVERED'), note: orderNote }),
  body({ to: z.literal('CANCELLED'), note: text(ORDER_TEXT_LIMITS.note) }),
]);

/** POST /api/admin/orders/:id/location: where the order is served from (what it holds moves with it). */
export const orderLocationBody = body({ locationId: uuid });

/**
 * PATCH /api/admin/orders/:id/terms: a draw's or a salon's size (`null`: one size), price and currency (both or
 * neither), and any order's engraving text (`null` or '' clears it). At least one.
 */
export const orderTermsBody = body({
  sizeLabel: z.preprocess(emptyToNull, text(ORDER_TEXT_LIMITS.size).nullable().optional()),
  priceMinor: orderAmount.nullable().optional(),
  currency: z.enum(ORDER_CURRENCIES).nullable().optional(),
  engravingText: z.preprocess(emptyToNull, text(ORDER_TEXT_LIMITS.engraving).nullable().optional()),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one term of the order to change');

/** PUT /api/admin/orders/:id/buyer: the buyer's name and address (decision 31); `null` or '' clears one. */
export const orderBuyerBody = body({
  name: z.preprocess(emptyToNull, text(ORDER_TEXT_LIMITS.buyerName).nullable()),
  address: z.preprocess(emptyToNull, text(ORDER_TEXT_LIMITS.buyerAddress).nullable()),
});

/** POST /api/admin/orders/:id/piece: the piece picked from the stock to fulfil the order, by its reference. */
export const orderPieceBody = body({ productId: productRef });

/**
 * POST /api/admin/orders/:id/return (choice 20): where the piece goes, back to stock at a location (RESTOCKED) or to
 * the archive (ARCHIVED, no location), and a note.
 */
export const orderReturnBody = body({
  outcome: z.enum(RETURN_OUTCOMES),
  locationId: uuid.nullable().optional(),
  note: text(ORDER_TEXT_LIMITS.note),
}).refine((b) => (b.outcome === 'RESTOCKED') === Boolean(b.locationId), { message: 'A piece back to stock goes to a location; one archived, to none', path: ['locationId'] });

// ── Admin: the invoices (plan LIVE RELEASE+, M7: routes/admin/invoices.ts) ─

/** A month, `YYYY-MM` (UTC). */
const invoiceMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'A month reads YYYY-MM');

/** GET /api/admin/invoices: a month's documents (the current one by default), one kind, a number or an order's reference. */
export const invoiceListQuery = z.object({
  month: queryOptional(invoiceMonth),
  kind: queryOptional(z.enum(INVOICE_KINDS)),
  q: queryOptional(z.string().trim().max(40, 'At most 40 characters')),
});

/** GET /api/admin/invoices.csv: the month's CSV for the accountant. */
export const invoiceCsvQuery = z.object({ month: invoiceMonth });

export const invoiceParams = z.object({ id: uuid });

/** GET /api/v1/account/orders/:id/…: one of the account's orders (MY PIECES, M6). */
export const accountOrderParams = z.object({ id: uuid });

/** PUT /api/admin/orders/alerts: the delays of the alerts (M3), in days. */
export const orderAlertsBody = body({
  reservedDays: whole(ORDER_ALERT_LIMITS.reservedDays.min, ORDER_ALERT_LIMITS.reservedDays.max, 'days'),
  readyDays: whole(ORDER_ALERT_LIMITS.readyDays.min, ORDER_ALERT_LIMITS.readyDays.max, 'days'),
  shippedDays: whole(ORDER_ALERT_LIMITS.shippedDays.min, ORDER_ALERT_LIMITS.shippedDays.max, 'days'),
  unregisteredDays: whole(ORDER_ALERT_LIMITS.unregisteredDays.min, ORDER_ALERT_LIMITS.unregisteredDays.max, 'days'),
});

// ── Admin: locations and carriers (routes/admin/logistics.ts) ─────────────

export const logisticsParams = z.object({ id: uuid });

export const createLocationBody = body({ name: text(LOCATION_NAME_MAX) });

/** PATCH /api/admin/locations/:id: its name, or made the default (`isDefault: true`). At least one. */
export const updateLocationBody = body({ name: text(LOCATION_NAME_MAX).optional(), isDefault: z.literal(true).optional() }).refine(
  (b) => Object.values(b).some((v) => v !== undefined),
  'Send at least one field of the location to change',
);

export const createCarrierBody = body({ name: text(CARRIER_NAME_MAX), trackingUrl: text(TRACKING_URL_MAX) });

/** PATCH /api/admin/carriers/:id: its name, its tracking link, whether it is offered. At least one. */
export const updateCarrierBody = body({ name: text(CARRIER_NAME_MAX).optional(), trackingUrl: text(TRACKING_URL_MAX).optional(), active: z.boolean().optional() }).refine(
  (b) => Object.values(b).some((v) => v !== undefined),
  'Send at least one field of the carrier to change',
);

// ── Admin: the atelier (routes/admin/atelier.ts) ──────────────────────────

/** GET /api/admin/atelier/stock: one model, one location. */
export const atelierStockQuery = z.object({ modelId: queryOptional(uuid), locationId: queryOptional(uuid) });


/** POST /api/admin/atelier/stock/transfer: pieces of a SKU moved from one location to another. */
export const stockTransferBody = body({ skuId: uuid, fromLocationId: uuid, toLocationId: uuid, quantity: whole(1, STOCK_MOVE_MAX, 'pieces'), note: z.preprocess(emptyToNull, text(STOCK_NOTE_MAX).nullable().optional()) });

/** POST /api/admin/atelier/stock/adjust: a count corrected, up or down, with why. */
export const stockAdjustBody = body({
  skuId: uuid,
  locationId: uuid,
  delta: z.number().int('Must be a whole number of pieces').min(-STOCK_MOVE_MAX, `At least -${STOCK_MOVE_MAX}`).max(STOCK_MOVE_MAX, `At most ${STOCK_MOVE_MAX}`).refine((n) => n !== 0, 'Not 0'),
  note: text(STOCK_NOTE_MAX),
});

/** PUT /api/admin/atelier/thresholds: a SKU's minimum at a location (L2), or none (`null`). */
export const stockThresholdBody = body({ skuId: uuid, locationId: uuid, minimum: whole(1, THRESHOLD_MAX, 'pieces').nullable() });

/** POST /api/admin/atelier/make: pieces to make for the stock (a suggestion confirmed). */
export const makeForStockBody = body({ skuId: uuid, locationId: uuid, quantity: whole(1, ATELIER_MAKE_MAX, 'pieces') });

const benchOrigin = z.union([uuid, z.enum(['SALON', 'STOCK'])]);

/** GET /api/admin/atelier/bench and its CSV: open, finished, cancelled or all; one origin (a release, SALON, STOCK), one SKU, one location. */
export const benchQuery = z.object({ view: queryOptional(z.enum(BENCH_VIEWS)), origin: queryOptional(benchOrigin), skuId: queryOptional(uuid), locationId: queryOptional(uuid) });

export const benchParams = z.object({ id: uuid });

/** POST /api/admin/atelier/bench/:id/done: what the atelier says of the finished piece; a claim code unless refused. */
export const benchDoneBody = optionalBody({
  material: z.preprocess(emptyToNull, text(ISSUE_TEXT_LIMITS.material).nullable().optional()),
  productionBatch: z.preprocess(emptyToNull, text(ISSUE_TEXT_LIMITS.productionBatch).nullable().optional()),
  productionDate: z.preprocess(emptyToNull, isoDate.nullable().optional()),
  withClaimSecret: z.boolean().optional(),
});

/** POST /api/admin/atelier/sheets: the work sheets of the pieces named, or of those an origin, a SKU and a location keep. */
export const workSheetsBody = body({
  benchItemIds: z.array(uuid).min(1, 'At least one piece').max(WORK_SHEETS_MAX, `At most ${WORK_SHEETS_MAX} pieces`).optional(),
  origin: benchOrigin.optional(),
  skuId: uuid.optional(),
  locationId: uuid.optional(),
}).refine((b) => !(b.benchItemIds && (b.origin || b.skuId || b.locationId)), 'Name the pieces, or narrow by origin, SKU and location: not both');

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
