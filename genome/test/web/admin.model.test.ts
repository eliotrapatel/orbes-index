import { afterEach, describe, expect, it, vi } from 'vitest';
import * as serverSchema from '../../src/server/db/schema.js';
import { ANOMALY_SORTS as SERVER_ANOMALY_SORTS } from '../../src/server/services/anomaly.js';
import { ANALYTICS_MAX_DAYS, SIGNAL_STATES as SERVER_SIGNAL_STATES } from '../../src/server/services/scan-stats.js';
import { ROLE_RANK as SERVER_ROLE_RANK } from '../../src/server/http/sessions.js';
import { ARTIFACT_DEFAULTS as SERVER_ARTIFACT_DEFAULTS, ARTIFACT_LIMITS as SERVER_ARTIFACT_LIMITS, MAX_SHEET_ITEMS, planPrintSheet } from '../../src/server/render/artifact.js';
import { SHEET_PAGES } from '../../src/server/render/print-sheet.js';
import { MAX_CODE_IDS } from '../../src/server/routes/admin/codes.js';
import { ARTIFACT_THEME_NAMES as SERVER_THEME_NAMES } from '../../src/server/render/scene.js';
import { ACTIVATABLE_STATUSES } from '../../src/server/services/warranty.js';
import { AUTH_POLICY_KINDS as SERVER_POLICY_KINDS } from '../../src/server/authenticators/index.js';
import { BODY_LIMIT_BYTES } from '../../src/server/app.js';
import { issueBatchBody } from '../../src/server/http/schemas.js';
import { MAX_CERTIFICATE_ITEMS } from '../../src/server/render/certificate.js';
import { MAX_ISSUE_BATCH } from '../../src/server/services/issuance.js';
import { IMAGE_MIME_TYPES as SERVER_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES as SERVER_MAX_IMAGE_BYTES, MAX_IMAGE_SIDE as SERVER_MAX_IMAGE_SIDE } from '../../src/server/media/image.js';
import { fitWithin, modelPhotoImpact, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_MIME_TYPES, PHOTO_QUALITIES, photoFacts, PIECE_PHOTO_IMPACT } from '../../src/web/admin/model/photo.js';
import {
  ANALYTICS_RANGES,
  analyticsKpis,
  analyticsLead,
  analyticsRange,
  axisLevels,
  countryBars,
  countryLabel,
  countryName,
  curve,
  dayReadout,
  dayTicks,
  nearestDay,
  readoutPlacement,
  niceMax,
  signalBars,
  signalCountries,
  stateRows,
  svgPoints,
} from '../../src/web/admin/model/analytics.js';
import {
  anomalyFiltersFrom,
  badgeText,
  consoleTitle,
  countriesLine,
  decisionDanger,
  decisionError,
  decisionNeedsContext,
  decisionOffer,
  decisionPhrase,
  decisionReason,
  decisionSteps,
  decisionSummary,
  hasAnomalyFilters,
  isProductFilter,
  MARK_FIELDS,
  REASON_MAX,
  REVOKE_FIELD,
  scanHref,
  SORT_OPTIONS,
  sortValue,
  typeOptions,
  windowScansHref,
} from '../../src/web/admin/model/anomalies.js';
import { dashboardKpis, severityBars, statusBars } from '../../src/web/admin/model/dashboard.js';
import {
  ARTIFACT_DEFAULTS,
  ARTIFACT_LIMITS,
  ARTIFACT_SIZE_ADVICE,
  artifactSizeAdvice,
  buildArtifactOptions,
  batchSelectLabel,
  buildPrintSheetOptions,
  codeFilterKey,
  codeFiltersFrom,
  hasCodeFilters,
  isSheetSelectable,
  printSheetPreview,
  pruneSheetSelection,
  PRINT_SHEET_LIMITS,
  SHEET_CODE_REFUSALS,
  sheetRefusalText,
  sheetChunks,
  sheetPartFilename,
  type PrintSheetForm,
  BATCH_COLUMNS,
  batchCertificateItems,
  batchPlanText,
  batchProblemText,
  batchRequests,
  batchResultRows,
  batchResultsCsv,
  batchResultsFilename,
  batchSigningOrder,
  batchSummary,
  buildIssueBatch,
  CERTIFICATE_LIMITS,
  decodeBatchCsv,
  ISSUE_BATCH_LIMITS,
  parseBatchCsv,
  quantityRows,
  signBatchLabel,
  type BatchRow,
  type BatchTemplateForm,
  buildIssueInput,
  cellPitchNote,
  formatClaimCode,
  modelsFor,
  normalizePolicy,
  THEME_OPTIONS,
  type ArtifactForm,
  type IssueForm,
} from '../../src/web/admin/model/generator.js';
import { formatCount } from '../../src/web/admin/format.js';
import { carePreview, categoryImpact, collectionImpact, MODEL_STATUS_OPTIONS, modelChange, modelForm, modelImpact } from '../../src/web/admin/model/catalogue.js';
import { ownerSearch } from '../../src/web/admin/model/owners.js';
import { DROP_STATES as SERVER_DROP_STATES, DROP_DESCRIPTION_MAX, DROP_NOTE_MAX, DROP_QUANTITY_MAX, DROP_TITLE_MAX, PURCHASE_WINDOW_HOURS } from '../../src/server/services/drops.js';
import {
  CLUB_TABS,
  clubTab,
  DROP_LIMITS,
  dropActions,
  dropChange,
  dropFormValues,
  dropInput,
  dropPhrase,
  dropProblem,
  entryActions,
  localUtc,
  placesTaken,
  releaseAddress,
  tierName,
  utcInstant,
} from '../../src/web/admin/model/club.js';
import {
  answersLine,
  circleActions,
  circleAddress,
  circleChange,
  circleFormValues,
  circleInput,
  circleLead,
  circleLinkProblem,
  circleMemberBars,
  circleProblem,
  circleVisitDays,
  CIRCLE_LIMITS,
  CIRCLE_LINK_HOSTS,
  linkableDrops,
  linkableModels,
  pollOptionLines,
  pollResultLines,
  tierReach,
} from '../../src/web/admin/model/circle.js';
import {
  CIRCLE_BODY_MAX,
  CIRCLE_CAPACITY_MAX,
  CIRCLE_LINK_HOSTS as SERVER_CIRCLE_LINK_HOSTS,
  CIRCLE_PLACE_MAX,
  CIRCLE_POLL_OPTION_MAX,
  CIRCLE_POLL_OPTIONS,
  CIRCLE_TITLE_MAX,
  CIRCLE_URL_MAX,
  normalizeCircleUrl,
} from '../../src/server/services/circle.js';
import { CIRCLE_PHOTOS_MAX, GALLERY_ALT_MAX } from '../../src/server/services/media.js';
import { DEFAULT_CARE as SHARED_CARE } from '../../src/web/shared/care.js';
import { DEFAULT_CARE as VERIFY_CARE } from '../../src/web/verify/copy.js';
import { can, CAPABILITY_MIN_ROLE, ROLE_RANK, saleOnly } from '../../src/web/admin/model/permissions.js';
import { CLIENT_REGISTRATION, minutesLeft, pieceLines, preselectedRetailer, READY_TO_SELL, retailerLabel, retailerOptions, SALE_CARD_NOTE, saleVerdict } from '../../src/web/admin/model/sale.js';
import { SALE_REFUSALS as SERVER_SALE_REFUSALS, SALE_TOKEN_TTL_MS } from '../../src/server/services/sale.js';
import { SALE_REFUSAL_MESSAGES } from '../../src/server/routes/admin/sale.js';
import { primaryCode, productActions, productAttributes, productSheet } from '../../src/web/admin/model/product.js';
import {
  chainVerdict,
  channelLabel,
  compromiseTime,
  confirmationPhrase,
  keyActions,
  phraseMatches,
  reportWhere,
  revocationTargetError,
  scanReference,
  triageMoves,
} from '../../src/web/admin/model/registry.js';
import { adminState, deviceLabel, newPasswordProblem, PASSWORD_MIN_LENGTH, teamActions } from '../../src/web/admin/model/team.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { PASSWORD_MIN_LENGTH as SERVER_PASSWORD_MIN_LENGTH } from '../../src/server/services/auth.js';
import * as web from '../../src/web/admin/types.js';
import type { AnalyticsData, AnomalyContext, DashboardData, Model, ProductDetail, VerificationState } from '../../src/web/admin/types.js';
import { ApiError } from '../../src/web/admin/api.js';
import { ATTENTION_INTERVAL_MS, startAttentionPoll, type VisibilitySource } from '../../src/web/admin/ui/attention.js';

describe('admin enums mirror the server', () => {
  it('keeps every shared enum identical', () => {
    for (const name of [
      'PRODUCT_STATUSES',
      'OWNERSHIP_STATES',
      'KEY_STATUSES',
      'CODE_STATUSES',
      'ADMIN_ROLES',
      'STAFF_ROLES',
      'SERVICE_TYPES',
      'VERIFICATION_STATES',
      'ANOMALY_SEVERITIES',
      'ANOMALY_STATUSES',
      'REVOCATION_TARGET_TYPES',
      'REPORT_CHANNELS',
      'REPORT_STATUSES',
      'LOOKBOOK_STATES',
      'DROP_ENTRY_STATUSES',
      'CIRCLE_POST_KINDS',
      'CIRCLE_RSVP_ANSWERS',
    ] as const) {
      expect([...web[name]], name).toEqual([...serverSchema[name]]);
    }
    expect([...web.AUTH_POLICY_KINDS]).toEqual([...SERVER_POLICY_KINDS]);
    expect([...web.ANOMALY_SORTS]).toEqual([...SERVER_ANOMALY_SORTS]);
    expect([...web.SCAN_STAT_EVENT_TYPES]).toEqual([...serverSchema.SCAN_STAT_EVENT_TYPES]);
    expect([...web.SIGNAL_STATES]).toEqual([...SERVER_SIGNAL_STATES]);
    expect([...web.SALE_REFUSALS]).toEqual([...SERVER_SALE_REFUSALS]);
    expect([...web.DROP_STATES]).toEqual([...SERVER_DROP_STATES]);
  });

  it('uses the server role ranks and artifact limits', () => {
    expect(ROLE_RANK).toEqual(SERVER_ROLE_RANK);
    for (const k of Object.keys(ARTIFACT_LIMITS) as (keyof typeof ARTIFACT_LIMITS)[]) expect(ARTIFACT_LIMITS[k], k).toBe(SERVER_ARTIFACT_LIMITS[k]);
    expect(ARTIFACT_DEFAULTS).toMatchObject({ widthMm: SERVER_ARTIFACT_DEFAULTS.widthMm, theme: SERVER_ARTIFACT_DEFAULTS.theme, dpi: SERVER_ARTIFACT_DEFAULTS.dpi });
    expect([...web.ARTIFACT_THEMES]).toEqual([...SERVER_THEME_NAMES]);
  });
});

describe('photographs (F-04)', () => {
  it('mirror the server: JPEG or WebP, 1 MiB at most', () => {
    expect(PHOTO_MAX_BYTES).toBe(SERVER_MAX_IMAGE_BYTES);
    expect([...PHOTO_MIME_TYPES]).toEqual([...SERVER_IMAGE_MIME_TYPES]);
    // What the console sends always fits the server's side limit.
    expect(PHOTO_MAX_SIDE).toBeLessThanOrEqual(SERVER_MAX_IMAGE_SIDE);
    expect([...PHOTO_QUALITIES]).toEqual([...PHOTO_QUALITIES].sort((a, b) => b - a));
  });

  it('scales a photograph down to 2 000 px on its longer side, never up', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(8000, 3)).toEqual({ width: 2000, height: 1 });
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 });
  });

  it('says what will be sent, and what a photograph reaches before it is saved', () => {
    // Thousands set with the brand's thin space (formatCount).
    expect(photoFacts(1600, 1200, 319_488)).toBe(`${formatCount(1600)} × ${formatCount(1200)} PX · 312 KB`);
    expect(photoFacts(10, 10, 900)).toBe('10 × 10 PX · 900 B');
    expect(modelPhotoImpact(9)).toBe('Shown at once on the 9 issued pieces of this model above the GENOME of every authentic result on /verify, beside the photograph of the piece when it has one.');
    expect(modelPhotoImpact(1)).toMatch(/^Shown at once on the 1 issued piece of this model/);
    expect(modelPhotoImpact(0)).toMatch(/^No piece has been issued with this model yet/);
    expect(PIECE_PHOTO_IMPACT).toMatch(/compares it with the piece in hand/);
  });

  it('is an OPERATOR\'s to set or remove', () => {
    expect(can('OPERATOR', 'photograph')).toBe(true);
    expect(can('ADMIN', 'photograph')).toBe(true);
    expect(can('AUDITOR', 'photograph')).toBe(false);
    expect(can('RETAIL', 'photograph')).toBe(false);
  });
});

describe('Team page and password change (A-02)', () => {
  const user = { id: 'u', disabled: false, locked: false, passwordChangeRequired: false, totpEnabled: false };

  it('shows one state per console user, the most pressing first', () => {
    expect(adminState(user)).toEqual({ label: 'ACTIVE', tone: 'solid' });
    expect(adminState({ ...user, passwordChangeRequired: true })).toEqual({ label: 'TEMPORARY PASSWORD', tone: 'outline' });
    expect(adminState({ ...user, passwordChangeRequired: true, locked: true })).toEqual({ label: 'LOCKED', tone: 'alert' });
    expect(adminState({ ...user, locked: true, disabled: true })).toEqual({ label: 'DISABLED', tone: 'muted' });
  });

  it('offers nothing on one\'s own row but the reset of one\'s own second factor', () => {
    expect(teamActions(user, 'me')).toEqual({ role: true, disable: true, enable: false, unlock: false, sessions: true, resetTotp: false });
    expect(teamActions({ ...user, locked: true, totpEnabled: true }, 'me')).toEqual({ role: true, disable: true, enable: false, unlock: true, sessions: true, resetTotp: true });
    expect(teamActions({ ...user, disabled: true, locked: true }, 'me')).toEqual({ role: true, disable: false, enable: true, unlock: false, sessions: false, resetTotp: false });
    expect(teamActions({ ...user, id: 'me', locked: true, disabled: true, totpEnabled: true }, 'me')).toEqual({ role: false, disable: false, enable: false, unlock: false, sessions: false, resetTotp: true });
  });

  it('checks a new password as the server will (length after NFKC, repeated, different)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(SERVER_PASSWORD_MIN_LENGTH);
    expect(newPasswordProblem('old passphrase', 'new passphrase 2026', 'new passphrase 2026')).toBeNull();
    expect(newPasswordProblem('', 'new passphrase 2026', 'new passphrase 2026')).toMatch(/current/i);
    expect(newPasswordProblem('old passphrase', 'short pass', 'short pass')).toMatch(/too short/);
    expect(newPasswordProblem('old passphrase', 'new passphrase 2026', 'new passphrase 2027')).toMatch(/differ/);
    expect(newPasswordProblem('same passphrase', 'same passphrase', 'same passphrase')).toMatch(/different/);
    expect(newPasswordProblem('ｓａｍｅ passphrase', 'same passphrase', 'same passphrase')).toMatch(/different/); // NFKC-equal
    expect(newPasswordProblem('old passphrase', '🔒🔒🔒🔒🔒🔒abcdef', '🔒🔒🔒🔒🔒🔒abcdef')).toBeNull(); // 12 code points
  });

  it('names a session\'s device in a few words', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome · macOS');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox · Windows');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge · Windows');
    expect(deviceLabel('curl/8.4.0')).toBe('curl/8.4.0');
    expect(deviceLabel(null)).toBe('Unknown device');
  });
});

describe('permissions', () => {
  it('follows AUDITOR < OPERATOR < ADMIN', () => {
    expect(can('AUDITOR', 'read')).toBe(true);
    expect(can('AUDITOR', 'issue')).toBe(false);
    expect(can('AUDITOR', 'download')).toBe(false);
    expect(can('OPERATOR', 'issue')).toBe(true);
    expect(can('OPERATOR', 'download')).toBe(true);
    expect(can('OPERATOR', 'manageKeys')).toBe(false);
    expect(can('OPERATOR', 'revokeProduct')).toBe(false);
    expect(can('ADMIN', 'manageKeys')).toBe(true);
    // The Cases queue: an AUDITOR reads it, an OPERATOR closes a case (PATCH /api/admin/reports/:id).
    expect(can('AUDITOR', 'closeCase')).toBe(false);
    expect(can('OPERATOR', 'closeCase')).toBe(true);
    // Owners (A-06): an AUDITOR reads emails masked; locking and exporting an account are an ADMIN's.
    expect(can('AUDITOR', 'readClientEmails')).toBe(false);
    expect(can('OPERATOR', 'readClientEmails')).toBe(true);
    expect(can('OPERATOR', 'lockAccount')).toBe(false);
    expect(can('OPERATOR', 'exportAccount')).toBe(false);
    expect(can('ADMIN', 'lockAccount')).toBe(true);
    expect(can('ADMIN', 'exportAccount')).toBe(true);
    // The catalogue (A-10): an OPERATOR edits models and collections (PATCH), an ADMIN (de)activates a category.
    expect(can('AUDITOR', 'editCatalog')).toBe(false);
    expect(can('OPERATOR', 'editCatalog')).toBe(true);
    expect(can('OPERATOR', 'activateCategory')).toBe(false);
    expect(can('ADMIN', 'activateCategory')).toBe(true);
    // The Club's drops (P-R03): an OPERATOR creates, publishes, cancels and concludes; the draw is an ADMIN's.
    expect(can('AUDITOR', 'manageDrops')).toBe(false);
    expect(can('OPERATOR', 'manageDrops')).toBe(true);
    expect(can('OPERATOR', 'drawDrop')).toBe(false);
    expect(can('ADMIN', 'drawDrop')).toBe(true);
    // The Club's circle (P-X01): an OPERATOR writes, publishes, withdraws and photographs; an AUDITOR reads.
    expect(can('AUDITOR', 'manageCircle')).toBe(false);
    expect(can('OPERATOR', 'manageCircle')).toBe(true);
    expect(can(null, 'read')).toBe(false);
    for (const cap of Object.keys(CAPABILITY_MIN_ROLE) as (keyof typeof CAPABILITY_MIN_ROLE)[]) expect(can('ADMIN', cap), cap).toBe(true);
  });

  it('puts RETAIL under AUDITOR: the sale mode only (A-08)', () => {
    const caps = Object.keys(CAPABILITY_MIN_ROLE) as (keyof typeof CAPABILITY_MIN_ROLE)[];
    expect(caps.filter((c) => can('RETAIL', c))).toEqual(['sell']);
    // The sale mode starts warranties: the seller, OPERATOR and ADMIN sell; the read-only AUDITOR does not (as the server).
    for (const role of ['OPERATOR', 'ADMIN'] as const) expect(can(role, 'sell'), role).toBe(true);
    expect(can('AUDITOR', 'sell')).toBe(false);
    expect(caps.filter((c) => can('AUDITOR', c) && !can('OPERATOR', c))).toEqual([]);
    expect(can('OPERATOR', 'manageRetailers')).toBe(false);
    expect(can('ADMIN', 'manageRetailers')).toBe(true);
    expect(saleOnly('RETAIL')).toBe(true);
    for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) expect(saleOnly(role), role).toBe(false);
    expect(saleOnly(null)).toBe(false);
    // A role this console does not know is refused everywhere, as on the server.
    expect(can('SELLER' as never, 'sell')).toBe(false);
  });
});

describe('the Club\'s drops (P-R03)', () => {
  const base: web.Drop = {
    id: '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d',
    title: 'MONOLITHE — release I',
    description: null,
    model: { id: 'm1', name: 'MONOLITHE', type: 'RING', active: true },
    quantity: 2,
    opensAt: '2026-10-12T10:00:00.000Z',
    closesAt: '2026-10-14T10:00:00.000Z',
    purchaseWindowHours: 48,
    state: 'DRAFT',
    publishedAt: null,
    cancelledAt: null,
    drawnAt: null,
    createdAt: '2026-10-04T10:00:00.000Z',
    createdBy: null,
    seedHash: 'ab'.repeat(32),
    seed: null,
    entries: { ENTERED: 0, SELECTED: 0, WAITLISTED: 0, CONFIRMED: 0, LAPSED: 0, WITHDRAWN: 0 },
  };
  const values = (extra: Record<string, string> = {}) => ({ ...dropFormValues(base, new Date()), ...extra });

  it('holds the server\'s bounds, and reads the times of the dialog in UTC', () => {
    expect(DROP_LIMITS).toMatchObject({ title: DROP_TITLE_MAX, description: DROP_DESCRIPTION_MAX, quantity: DROP_QUANTITY_MAX, note: DROP_NOTE_MAX });
    expect([DROP_LIMITS.windowMin, DROP_LIMITS.windowMax, DROP_LIMITS.windowDefault]).toEqual([PURCHASE_WINDOW_HOURS.min, PURCHASE_WINDOW_HOURS.max, PURCHASE_WINDOW_HOURS.default]);
    expect(localUtc('2026-10-12T10:05:00.000Z')).toBe('2026-10-12T10:05');
    expect(utcInstant('2026-10-12T10:05')).toBe('2026-10-12T10:05:00.000Z');
    expect(utcInstant('12/10/2026')).toBeNull();
    expect(localUtc(null)).toBe('');
    // A new release opens tomorrow at 10:00 UTC, for two days, a place held 48 hours.
    expect(dropFormValues(null, new Date('2026-10-04T22:30:00Z'))).toMatchObject({ opensAt: '2026-10-05T10:00', closesAt: '2026-10-07T10:00', quantity: '1', purchaseWindowHours: '48' });
  });

  it('says what the server would refuse before anything is sent, and sends only what changed', () => {
    expect(dropProblem(values())).toBeNull();
    expect(dropProblem(values({ modelId: '' }))).toBe('Choose the model of the release.');
    expect(dropProblem(values({ title: ' ' }))).toBe('Give the release a title.');
    expect(dropProblem(values({ quantity: '0' }))).toMatch(/^A release has 1 to/);
    expect(dropProblem(values({ quantity: '1.5' }))).toMatch(/^A release has 1 to/);
    expect(dropProblem(values({ closesAt: values().opensAt }))).toBe('Entries close after they open.');
    expect(dropProblem(values({ opensAt: '' }))).toMatch(/^Use the date and time pickers/);
    expect(dropProblem(values({ purchaseWindowHours: '337' }))).toBe('A place is held 1 to 336 hours.');
    expect(dropInput(values({ description: '  ' }))).toMatchObject({ modelId: 'm1', quantity: 2, description: null, opensAt: base.opensAt, closesAt: base.closesAt, purchaseWindowHours: 48 });
    expect(dropChange(base, values())).toEqual({});
    expect(dropChange(base, values({ quantity: '3', closesAt: '2026-10-15T10:00', description: 'Three pieces.' }))).toEqual({ quantity: 3, closesAt: '2026-10-15T10:00:00.000Z', description: 'Three pieces.' });
  });

  it('offers each action to the role and in the state the server allows it', () => {
    expect(dropActions(base, 'OPERATOR')).toEqual({ edit: true, describe: false, publish: true, cancel: true, draw: false, offerNext: false });
    expect(dropActions(base, 'AUDITOR')).toEqual({ edit: false, describe: false, publish: false, cancel: false, draw: false, offerNext: false });
    const published = { ...base, state: 'OPEN' as const, publishedAt: '2026-10-05T10:00:00.000Z' };
    expect(dropActions(published, 'OPERATOR')).toMatchObject({ edit: false, describe: true, publish: false, cancel: true, draw: false });
    const closed = { ...published, state: 'CLOSED' as const };
    expect(dropActions(closed, 'OPERATOR').draw).toBe(false);
    expect(dropActions(closed, 'ADMIN').draw).toBe(true);
    const drawn = { ...closed, state: 'DRAWN' as const, drawnAt: '2026-10-14T11:00:00.000Z', entries: { ...base.entries, SELECTED: 1, CONFIRMED: 0, WAITLISTED: 3, LAPSED: 1 } };
    expect(placesTaken(drawn)).toBe(1);
    expect(dropActions(drawn, 'OPERATOR')).toMatchObject({ cancel: false, draw: false, offerNext: true });
    expect(dropActions({ ...drawn, entries: { ...drawn.entries, CONFIRMED: 1 } }, 'OPERATOR').offerNext).toBe(false);
    expect(dropActions({ ...drawn, entries: { ...drawn.entries, WAITLISTED: 0 } }, 'OPERATOR').offerNext).toBe(false);
    expect(dropActions({ ...base, state: 'CANCELLED', cancelledAt: '2026-10-06T00:00:00.000Z' }, 'OPERATOR')).toMatchObject({ edit: false, publish: false, cancel: false });
    expect(dropPhrase('draw', base)).toBe('DRAW 8A1D0C55');
    expect(dropPhrase('cancel', base)).toBe('CANCEL 8A1D0C55');
    expect(releaseAddress(base)).toBe(`/verify/releases/${base.id}`);
  });

  it('confirms a place held at any time, lapses it only once its time has passed', () => {
    const entry: web.DropEntry = { id: 'e', accountId: 'a', email: 'a@example.com', status: 'SELECTED', enteredAt: '', tier: 1, seniority: 0, rank: 1, respondBy: '2026-10-16T11:00:00.000Z', handledBy: null, handledAt: null, note: null };
    expect(entryActions(entry, 'OPERATOR', new Date('2026-10-16T10:59:59Z'))).toEqual({ confirm: true, lapse: false });
    expect(entryActions(entry, 'OPERATOR', new Date('2026-10-16T11:00:00Z'))).toEqual({ confirm: true, lapse: true });
    expect(entryActions(entry, 'AUDITOR', new Date('2026-10-17T00:00:00Z'))).toEqual({ confirm: false, lapse: false });
    expect(entryActions({ ...entry, status: 'WAITLISTED' }, 'OPERATOR', new Date('2026-10-17T00:00:00Z'))).toEqual({ confirm: false, lapse: false });
    expect([0, 1, 2, 3, null].map(tierName)).toEqual(['None', 'TITANE', 'PLATINE', 'PALLADIUM', '—']);
  });

  it('opens on the Drops tab, then the Circle tab (P-X01)', () => {
    expect(CLUB_TABS.map((t) => t.id)).toEqual(['drops', 'circle']);
    expect(clubTab({})).toBe('drops');
    expect(clubTab({ tab: 'nope' })).toBe('drops');
    expect(clubTab({ tab: 'circle' })).toBe('circle');
  });

  it('gives each state and status a tone: a place held waits for ORBES Client Services, as an open case does', () => {
    expect(SERVER_DROP_STATES.map((s) => toneOf('drop', s))).toEqual(['outline', 'outline', 'solid', 'outline', 'solid', 'muted']);
    expect(serverSchema.DROP_ENTRY_STATUSES.map((s) => toneOf('dropEntry', s))).toEqual(['outline', 'alert', 'outline', 'solid', 'muted', 'muted']);
    expect(toneOf('dropEntry', 'SELECTED')).toBe(toneOf('case', 'OPEN'));
  });
});

describe('the Club\'s circle (P-X01)', () => {
  const base: web.CirclePost = {
    id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c9d',
    kind: 'INVITATION',
    title: 'Dinner at the atelier',
    body: 'Twelve places.',
    minTier: 1,
    eventAt: '2026-10-12T19:00:00.000Z',
    eventPlace: 'Paris',
    capacity: 12,
    pollOptions: null,
    drop: null,
    model: null,
    externalUrl: null,
    published: false,
    publishedAt: null,
    createdAt: '2026-10-04T10:00:00.000Z',
    createdBy: null,
    photos: [],
    answers: { YES: 3, NO: 1 },
    results: null,
  };
  const values = (p: web.CirclePost, extra: Record<string, string> = {}) => ({ ...circleFormValues(p.kind, p, new Date()), ...extra });

  it('holds the server\'s bounds and its hosts', () => {
    expect(CIRCLE_LIMITS).toMatchObject({
      title: CIRCLE_TITLE_MAX,
      body: CIRCLE_BODY_MAX,
      place: CIRCLE_PLACE_MAX,
      capacity: CIRCLE_CAPACITY_MAX,
      optionsMin: CIRCLE_POLL_OPTIONS.min,
      optionsMax: CIRCLE_POLL_OPTIONS.max,
      option: CIRCLE_POLL_OPTION_MAX,
      url: CIRCLE_URL_MAX,
      photos: CIRCLE_PHOTOS_MAX,
      alt: GALLERY_ALT_MAX,
    });
    expect([...CIRCLE_LINK_HOSTS]).toEqual([...SERVER_CIRCLE_LINK_HOSTS]);
    // The console refuses the links the server refuses, and lets through those it keeps.
    for (const link of ['https://www.youtube.com/watch?v=x', 'https://vimeo.com/1', 'https://theorbes.com/', 'http://theorbes.com/', 'https://example.com/', 'https://user:pw@vimeo.com/', 'https://vimeo.com:8080/', 'vimeo.com/1']) {
      let server: boolean;
      try {
        normalizeCircleUrl(link);
        server = true;
      } catch {
        server = false;
      }
      expect(circleLinkProblem(link) === null, link).toBe(server);
    }
    expect(circleLinkProblem('')).toBeNull();
  });

  it('opens a new post of each kind with the fields of its kind, an invitation a week ahead at 19:00 UTC', () => {
    expect(circleFormValues('INVITATION', null, new Date('2026-10-04T22:30:00Z'))).toMatchObject({ eventAt: '2026-10-11T19:00', minTier: '1', capacity: '' });
    expect(circleFormValues('NOTE', null, new Date()).eventAt).toBe('');
    expect(circleFormValues('POLL', { ...base, kind: 'POLL', pollOptions: ['Gold', 'Platinum'] }, new Date()).pollOptions).toBe('Gold\nPlatinum');
    expect(pollOptionLines(' Gold \r\n\n Platinum\n')).toEqual(['Gold', 'Platinum']);
  });

  it('says what the server would refuse before anything is sent, and sends the fields of its kind only, then only what changed', () => {
    expect(circleProblem('INVITATION', values(base))).toBeNull();
    expect(circleProblem('INVITATION', values(base, { title: ' ' }))).toBe('Give the post a title.');
    expect(circleProblem('INVITATION', values(base, { eventAt: '' }))).toMatch(/^Use the date and time picker/);
    expect(circleProblem('INVITATION', values(base, { capacity: '0' }))).toMatch(/^An invitation has 1 to/);
    expect(circleProblem('INVITATION', values(base, { capacity: '' }))).toBeNull();
    expect(circleProblem('INVITATION', values(base, { externalUrl: 'https://example.com' }))).toMatch(/^A link is an https address on theorbes\.com, youtube\.com, vimeo\.com/);
    expect(circleProblem('POLL', { ...values(base), pollOptions: 'Gold' })).toMatch(/^A poll has 2 to 6 options/);
    expect(circleProblem('POLL', { ...values(base), pollOptions: 'Gold\ngold' })).toBe('Each option of a poll is different.');
    expect(circleProblem('POLL', { ...values(base), pollOptions: `Gold\n${'x'.repeat(41)}` })).toMatch(/^An option has at most 40/);
    expect(circleProblem('NOTE', { title: 'A note', body: '', minTier: '1' })).toBeNull();
    expect(circleInput('NOTE', { title: ' A note ', body: '', minTier: '2', eventAt: '2026-10-12T19:00', pollOptions: 'A\nB', dropId: '', modelId: '', externalUrl: '' })).toEqual({
      kind: 'NOTE',
      title: 'A note',
      body: null,
      minTier: 2,
      dropId: null,
      modelId: null,
      externalUrl: null,
    });
    expect(circleInput('POLL', { title: 'Q', body: '', minTier: '1', pollOptions: 'A\nB', dropId: '', modelId: '', externalUrl: '' }).pollOptions).toEqual(['A', 'B']);
    expect(circleInput('INVITATION', values(base, { capacity: '' }))).toMatchObject({ eventAt: base.eventAt, eventPlace: 'Paris', capacity: null });
    expect(circleChange(base, values(base))).toEqual({});
    expect(circleChange(base, values(base, { capacity: '', eventAt: '2026-10-12T20:00', body: '', minTier: '2' }))).toEqual({ capacity: null, eventAt: '2026-10-12T20:00:00.000Z', body: null, minTier: 2 });
    const poll = { ...base, kind: 'POLL' as const, eventAt: null, eventPlace: null, capacity: null, pollOptions: ['Gold', 'Platinum'] };
    expect(circleChange(poll, values(poll))).toEqual({});
    expect(circleChange(poll, values(poll, { pollOptions: 'Gold\nPlatinum\nTitanium' }))).toEqual({ pollOptions: ['Gold', 'Platinum', 'Titanium'] });
  });

  it('offers each action to the role that may take it, says the post\'s reach, its answers and its results', () => {
    expect(circleActions(base, 'OPERATOR')).toEqual({ edit: true, publish: true, unpublish: false, photograph: true });
    expect(circleActions({ published: true }, 'OPERATOR')).toEqual({ edit: true, publish: false, unpublish: true, photograph: true });
    expect(circleActions({ published: true }, 'AUDITOR')).toEqual({ edit: false, publish: false, unpublish: false, photograph: false });
    expect([1, 2, 3].map(tierReach)).toEqual(['TITANE and up', 'PLATINE and up', 'PALLADIUM']);
    expect(circleLead(base)).toMatch(/^Not in the circle/);
    expect(circleLead({ ...base, published: true, minTier: 3 })).toBe('In the circle on /verify: the PALLADIUM owners read it.');
    expect(circleAddress(base)).toBe(`/verify/circle/${base.id}`);
    expect(answersLine(base)).toBe('3 yes · 1 no · 9 of 12 places left');
    expect(answersLine({ ...base, capacity: null })).toBe('3 yes · 1 no');
    expect(pollResultLines({ pollOptions: ['Gold', 'Platinum'], results: { counts: [1, 3], total: 4 } })).toEqual([
      { option: 'Gold', votes: 1, share: '25%' },
      { option: 'Platinum', votes: 3, share: '75%' },
    ]);
    // The links offered: a release not cancelled, a model shown in the lookbook; the post's own kept.
    const drop = (id: string, state: web.DropState) => ({ id, title: id, state }) as web.Drop;
    expect(linkableDrops([drop('a', 'OPEN'), drop('b', 'CANCELLED'), drop('c', 'DRAFT')], null).map((d) => d.value)).toEqual(['a', 'c']);
    expect(linkableDrops([drop('b', 'CANCELLED')], 'b').map((d) => d.value)).toEqual(['b']);
    const model = (id: string, lookbook: web.LookbookState) => ({ id, name: 'M', type: 'RING', lookbook }) as web.Model;
    expect(linkableModels([model('h', 'HIDDEN'), model('p', 'PUBLIC'), model('r', 'RESERVED')], null).map((m) => m.value)).toEqual(['p', 'r']);
  });

  it('reads the panel of Analytics: the members by tier, the days the circle was visited', () => {
    const stats: web.CircleStats = {
      from: '2026-10-01',
      to: '2026-10-03',
      days: 3,
      members: { TITANE: 6, PLATINE: 3, PALLADIUM: 1, total: 10 },
      visits: { total: 5, daily: [{ day: '2026-10-01', visits: 2 }, { day: '2026-10-02', visits: 0 }, { day: '2026-10-03', visits: 3 }] },
    };
    expect(circleMemberBars(stats).map((b) => [b.label, b.value, b.fraction, b.share])).toEqual([
      ['TITANE', 6, 1, '60%'],
      ['PLATINE', 3, 0.5, '30%'],
      ['PALLADIUM', 1, 1 / 6, '10%'],
    ]);
    expect(circleVisitDays(stats)).toEqual([{ day: '2026-10-03', visits: 3 }, { day: '2026-10-01', visits: 2 }]);
  });

  it('gives a post and an answer their tones', () => {
    expect([toneOf('circle', 'PUBLISHED'), toneOf('circle', 'UNPUBLISHED')]).toEqual(['solid', 'outline']);
    expect(serverSchema.CIRCLE_RSVP_ANSWERS.map((a) => toneOf('circleAnswer', a))).toEqual(['solid', 'muted']);
  });
});

describe('sale mode view model (A-08)', () => {
  const shops: web.Retailer[] = [
    { id: 'a', name: 'ORBES Paris — Saint-Honoré', city: 'Paris', country: 'FR', active: true, createdAt: '', updatedAt: '' },
    { id: 'b', name: 'ORBES.COM — Online boutique', city: null, country: 'DE', active: true, createdAt: '', updatedAt: '' },
    { id: 'c', name: 'Pop-up Cannes', city: 'Cannes', country: 'FR', active: false, createdAt: '', updatedAt: '' },
  ];
  const piece: NonNullable<web.SaleLookup['piece']> = {
    productId: 'O26-J-00184',
    status: 'ISSUED',
    category: { code: 'J', name: 'Jewelry' },
    collection: 'ORBIT',
    model: 'MONOLITHE',
    type: 'RING',
    variant: '52',
    material: '925 sterling silver',
    createdYear: 2026,
    registered: false,
    warranty: { status: 'NOT_STARTED', startDate: null, endDate: null },
  };

  it('names a point of sale, lists the active ones and preselects the one this phone used last', () => {
    expect(retailerLabel(shops[0])).toBe('ORBES Paris — Saint-Honoré · Paris · FR');
    expect(retailerLabel(shops[1])).toBe('ORBES.COM — Online boutique · DE');
    expect(retailerOptions(shops).map((o) => o.value)).toEqual(['a', 'b']);
    expect(preselectedRetailer(shops, 'b')).toBe('b');
    expect(preselectedRetailer(shops, 'c')).toBe(''); // closed since: chosen again
    expect(preselectedRetailer(shops, null)).toBe('');
    expect(preselectedRetailer([shops[0], shops[2]], null)).toBe('a'); // the only active one
    expect(preselectedRetailer([], 'a')).toBe('');
  });

  it('says what to do with a looked-up piece', () => {
    const ready = saleVerdict({ state: 'AUTHENTIC', piece, sale: { token: 't', expiresAt: '2026-10-02T10:10:00.000Z' }, refusal: null });
    expect(ready).toMatchObject({ label: 'READY TO SELL', tone: 'solid', canActivate: true, message: READY_TO_SELL });
    // Only what the lookup proved (BRAND §4.1): never "registered" or "never sold" beside "Client account".
    expect(READY_TO_SELL).not.toMatch(/registered|never sold/i);
    const refused = (code: web.SaleRefusal, state: web.VerificationState = 'AUTHENTIC') =>
      saleVerdict({ state, piece: code === 'NOT_AUTHENTIC' ? null : piece, sale: null, refusal: { code, message: SALE_REFUSAL_MESSAGES[code] } });
    expect(refused('WARRANTY_ACTIVE')).toMatchObject({ label: 'ALREADY SOLD', canActivate: false, message: SALE_REFUSAL_MESSAGES.WARRANTY_ACTIVE });
    expect(refused('ALREADY_REGISTERED')).toMatchObject({ label: 'ALREADY SOLD', tone: 'outline', canActivate: false, message: SALE_REFUSAL_MESSAGES.ALREADY_REGISTERED });
    expect(refused('WARRANTY_VOID')).toMatchObject({ label: 'WARRANTY VOID', tone: 'alert', canActivate: false });
    expect(refused('NOT_FOR_SALE').label).toBe('NOT FOR SALE');
    expect(refused('NOT_AUTHENTIC', 'INVALID_SIGNATURE')).toMatchObject({ label: 'INVALID SIGNATURE', tone: 'critical', canActivate: false });
    expect(refused('NOT_AUTHENTIC', 'SUSPICIOUS_ACTIVITY')).toMatchObject({ label: 'SUSPICIOUS ACTIVITY', tone: 'alert' });
    // No token, no activation, whatever else the answer says.
    expect(saleVerdict({ state: 'AUTHENTIC', piece, sale: null, refusal: null }).canActivate).toBe(false);
    expect(pieceLines(piece)).toEqual(['MONOLITHE · RING · 52', '925 STERLING SILVER · JEWELRY · ORBIT']);
    expect(pieceLines({ ...piece, variant: null, collection: null })).toEqual(['MONOLITHE · RING', '925 STERLING SILVER · JEWELRY']);
  });

  it('counts the minutes a scan stays valid and tells the client where to register', () => {
    const now = new Date('2026-10-02T10:00:00.000Z');
    expect(minutesLeft(new Date(now.getTime() + SALE_TOKEN_TTL_MS).toISOString(), now)).toBe(10);
    expect(minutesLeft('2026-10-02T10:00:30.000Z', now)).toBe(1);
    expect(minutesLeft('2026-10-02T09:00:00.000Z', now)).toBe(0);
    expect(minutesLeft('garbage', now)).toBe(0);
    expect(CLIENT_REGISTRATION).toBe('Register your piece with its card at theorbes.com/verify.');
    // The card's claim code registers the piece in the client's name; it proves the card is in hand, never ownership
    // (BRAND §4.1, §4.6, the words of §4.4).
    expect(SALE_CARD_NOTE).toBe('Hand over the certificate card: with the claim code under its scratch-off panel, they register the piece in their name.');
    expect(SALE_CARD_NOTE).not.toMatch(/prove|theirs|owner|guarantee/i);
  });
});

describe('tones', () => {
  it('reserves red for critical facts only', () => {
    expect(toneOf('severity', 'CRITICAL')).toBe('critical');
    expect(toneOf('verification', 'INVALID_SIGNATURE')).toBe('critical');
    const reds = serverSchema.PRODUCT_STATUSES.filter((s) => toneOf('product', s) === 'critical');
    expect(reds).toEqual([]);
    expect(toneOf('product', 'REVOKED')).toBe('alert');
    expect(toneOf('code', 'SUPERSEDED')).toBe('muted');
    expect(toneOf('product', 'SOMETHING_NEW')).toBe('outline');
    expect(toneOf('product', null)).toBe('muted');
    // An open case waits for staff, as an open anomaly does; a closed one recedes.
    expect(toneOf('case', 'OPEN')).toBe(toneOf('anomaly', 'OPEN'));
    expect(toneOf('case', 'CLOSED')).toBe('muted');
    // A model's place in the lookbook (P-R02): shown to everyone, to owners only, or nowhere.
    expect(serverSchema.LOOKBOOK_STATES.map((s) => toneOf('lookbook', s))).toEqual(['muted', 'solid', 'outline']);
    expect([toneOf('catalogue', 'ACTIVE'), toneOf('catalogue', 'INACTIVE')]).toEqual(['solid', 'muted']);
    // A locked account needs attention; every account status has its tone.
    expect(toneOf('account', 'ACTIVE')).toBe('solid');
    expect(toneOf('account', 'LOCKED')).toBe('alert');
    expect(toneOf('account', 'DELETED')).toBe('muted');
    for (const st of serverSchema.ACCOUNT_STATUSES) expect(toneOf('account', st)).not.toBe('critical');
  });
});

describe('owners search (A-06)', () => {
  it('reads an email, or the REF under a result, from one field', () => {
    expect(ownerSearch('')).toBeNull();
    expect(ownerSearch('   ')).toBeNull();
    expect(ownerSearch(undefined)).toBeNull();
    expect(ownerSearch(' Jane@Example.com ')).toEqual({ kind: 'email', email: 'Jane@Example.com' });
    for (const ref of ['1a2b3c4d', '1A2B3C4D', 'REF 1A2B3C4D', 'ref:1a2b3c4d']) expect(ownerSearch(ref), ref).toEqual({ kind: 'ref', ref: '1A2B3C4D' });
    expect(ownerSearch('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toEqual({ kind: 'ref', ref: '1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D' });
    for (const bad of ['jane', '1A2B3C4', 'O26-J-00184', 'REF']) expect(ownerSearch(bad)?.kind, bad).toBe('invalid');
  });
});

describe('cases', () => {
  it('says where the customer saw or bought the piece as the verify app asked it, then the place', () => {
    expect(['BOUTIQUE', 'ONLINE', 'PRIVATE', 'OTHER'].map(channelLabel)).toEqual(['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER']);
    expect(channelLabel(null)).toBe('—');
    expect(reportWhere({ channel: 'ONLINE', place: 'a marketplace listing' })).toBe('ONLINE · a marketplace listing');
    expect(reportWhere({ channel: 'PRIVATE', place: null })).toBe('PRIVATE SALE');
  });

  it('names a scan by the reference the customer reads under the result', () => {
    expect(scanReference('1f3079f7-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe('1F3079F7');
    expect(scanReference('nope')).toBe('—');
    expect(scanReference(null)).toBe('—');
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────

const dashboard: DashboardData = {
  generatedAt: '2026-10-01T12:00:00.000Z',
  products: {
    total: 30,
    byStatus: { ISSUED: 10, ACTIVATED: 0, REGISTERED: 0, OWNED: 20, TRANSFERRED: 0, SERVICED: 0, RESOLD: 0, RETIRED: 0, REVOKED: 0, COUNTERFEIT_FLAGGED: 0, LOST: 0, STOLEN: 0 },
  },
  scans: { last24h: 1520, last7d: 9001 },
  anomalies: { open: 3, openBySeverity: { LOW: 0, MEDIUM: 1, HIGH: 1, CRITICAL: 1 } },
  activeKey: { keyId: 2, kid: 'orbes-2026-10', activatedAt: '2026-10-01T00:00:00.000Z' },
  recentEvents: [],
};

describe('dashboard view model', () => {
  it('scales status bars to the largest value and keeps primary zero rows', () => {
    const rows = statusBars(dashboard.products.byStatus);
    expect(rows.map((r) => r.key)).toEqual(['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED']);
    const owned = rows.find((r) => r.key === 'OWNED')!;
    expect(owned.fraction).toBe(1);
    expect(owned.share).toBe('67%');
    expect(rows.find((r) => r.key === 'ISSUED')!.fraction).toBe(0.5);
    expect(rows.find((r) => r.key === 'ACTIVATED')!.fraction).toBe(0);
    // A non-primary status appears as soon as it has products.
    expect(statusBars({ ...dashboard.products.byStatus, STOLEN: 1 }).map((r) => r.key)).toContain('STOLEN');
  });

  it('lists severities most severe first, all four always shown', () => {
    const rows = severityBars(dashboard.anomalies.openBySeverity);
    expect(rows.map((r) => r.key)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    expect(rows[0].tone).toBe('critical');
    expect(severityBars({}).every((r) => r.fraction === 0 && r.share === '0%')).toBe(true);
  });

  it('flags a missing signing key and critical anomalies', () => {
    const k = dashboardKpis(dashboard);
    expect(k.map((x) => x.value)).toEqual(['30', '1 520', '3', '#2']);
    expect(k[2].tone).toBe('critical');
    const none = dashboardKpis({ ...dashboard, activeKey: null, anomalies: { open: 0, openBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } } });
    expect(none[3]).toMatchObject({ value: '—', tone: 'critical' });
    expect(none[2].tone).toBe('solid');
  });
});

// ── Product page ───────────────────────────────────────────────────────────

function detail(over: Partial<ProductDetail> = {}): ProductDetail {
  const base: ProductDetail = {
    product: {
      id: '11111111-1111-4111-8111-111111111111',
      productId: 'O26-J-00184',
      packedIdentity: 1,
      year: 2026,
      categoryIndex: 1,
      categoryCode: 'J',
      serial: 184,
      sku: 'MNL-RG-52',
      modelId: '22222222-2222-4222-8222-222222222222',
      collectionId: null,
      variant: '52',
      material: '925 STERLING SILVER',
      productionBatch: 'B-1',
      productionDate: '2026-09-01',
      status: 'OWNED',
      ownershipState: 'OWNED',
      authPolicy: 'PRINTED_CODE',
      hasClaimSecret: true,
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      category: { index: 1, code: 'J', name: 'Jewelry' },
      model: { id: '22222222-2222-4222-8222-222222222222', name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL-RG', care: null, imageUrl: null },
      collection: 'ORBIT',
      photoUrl: null,
    },
    genome: {
      id: 'g',
      productId: 'O26-J-00184',
      version: 1,
      versionLabel: 'GENOME-01',
      value: 0x12345678,
      glyphs: [1, 2, 3, 4, 5, 6, 7, 8],
      ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      pattern: 'a·b·c·d·e·f·g·h',
      fingerprint: 'G1-1234-5678',
      createdAt: '2026-09-02T10:00:00.000Z',
    },
    genomes: [],
    codes: [
      {
        id: 'c1',
        productId: 'O26-J-00184',
        keyId: 1,
        codeVersion: 1,
        issue: 1,
        issuedDay: 1000,
        issuedAt: '2026-09-02',
        nonce: '01020304',
        payloadHash: 'ab'.repeat(32),
        status: 'SUPERSEDED',
        revokedAt: null,
        revocationReason: null,
        createdAt: '2026-09-02T10:00:00.000Z',
        verification: { valid: true, keyStatus: 'RETIRED' },
      },
      {
        id: 'c2',
        productId: 'O26-J-00184',
        keyId: 2,
        codeVersion: 1,
        issue: 2,
        issuedDay: 1001,
        issuedAt: '2026-09-03',
        nonce: '05060708',
        payloadHash: 'cd'.repeat(32),
        status: 'ACTIVE',
        revokedAt: null,
        revocationReason: null,
        createdAt: '2026-09-03T10:00:00.000Z',
        verification: { valid: true, keyStatus: 'ACTIVE' },
      },
    ],
    scans: { count: 14, lastAt: '2026-09-30T08:00:00.000Z' },
    ownership: {
      current: { accountId: 'acc', acquiredVia: 'FIRST_REGISTRATION', verified: true, since: '2026-09-04T00:00:00.000Z', transferPending: false },
      owners: [],
      transfers: [],
    },
    warranty: {
      productId: 'O26-J-00184',
      purchaseDate: '2026-09-04',
      retailer: 'ORBES PARIS',
      retailerId: null,
      country: 'FR',
      startDate: '2026-09-04',
      endDate: '2028-09-04',
      durationMonths: 24,
      voidedAt: null,
      voidReason: null,
      status: 'ACTIVE',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    services: [],
    anomalies: [],
    statusHistory: [],
    lifecycle: { status: 'OWNED', allowed: ['TRANSFERRED', 'SERVICED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'], returnTo: null, canReinstate: false },
  };
  return { ...base, ...over };
}

describe('product view model (spec §22)', () => {
  it('lays out the spec §22 sheet in order', () => {
    const rows = productSheet(detail());
    expect(rows.map((r) => r.label.toUpperCase())).toEqual(['PRODUCT', 'LIFECYCLE', 'GENOME', 'CODE STATUS', 'SIGNATURE', 'SCAN COUNT', 'OWNERSHIP', 'WARRANTY', 'ANOMALIES']);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.product.value).toBe('O26-J-00184');
    expect(by.genome).toMatchObject({ value: 'G1-1234-5678', mono: true });
    expect(by.code).toMatchObject({ value: 'ACTIVE', tone: 'solid' });
    expect(by.code.note).toContain('Issue 2');
    expect(by.signature).toMatchObject({ value: 'VALID', tone: 'solid' });
    expect(by.scans.value).toBe('14');
    expect(by.ownership.note).toContain('Verified');
    expect(by.warranty).toMatchObject({ value: 'ACTIVE' });
    expect(by.warranty.note).toBe('04 SEP 2026 → 04 SEP 2028');
    expect(by.anomalies).toMatchObject({ value: 'NONE', tone: 'solid' });
  });

  it('reports an invalid live signature and open critical anomalies in red', () => {
    const d = detail({
      anomalies: [
        { id: 'x', productId: 'O26-J-00184', productUuid: null, codeId: null, type: 'CODE_MISMATCH', severity: 'CRITICAL', riskScore: 100, details: {}, status: 'OPEN', occurrences: 1, firstSeenAt: '', lastSeenAt: '', resolvedBy: null, resolvedAt: null, resolutionNote: null, actorEmail: null },
        { id: 'y', productId: 'O26-J-00184', productUuid: null, codeId: null, type: 'SCAN_VELOCITY', severity: 'MEDIUM', riskScore: 35, details: {}, status: 'RESOLVED', occurrences: 1, firstSeenAt: '', lastSeenAt: '', resolvedBy: null, resolvedAt: null, resolutionNote: null, actorEmail: null },
      ],
    });
    d.codes[1] = { ...d.codes[1], verification: { valid: false, reason: 'SIGNATURE_INVALID', keyStatus: 'ACTIVE' } };
    const by = Object.fromEntries(productSheet(d).map((r) => [r.key, r]));
    expect(by.signature).toMatchObject({ value: 'INVALID', tone: 'critical', note: 'SIGNATURE INVALID' });
    expect(by.anomalies).toMatchObject({ value: '1 OPEN', tone: 'critical' });
  });

  it('handles a product without codes, owner or warranty', () => {
    const d = detail({ codes: [], warranty: null, ownership: { current: null, owners: [], transfers: [] }, genome: null });
    const by = Object.fromEntries(productSheet({ ...d, product: { ...d.product, ownershipState: 'UNREGISTERED' } }).map((r) => [r.key, r]));
    expect(by.code.value).toBe('NONE');
    expect(by.signature.value).toBe('—');
    expect(by.warranty).toMatchObject({ value: 'NOT STARTED', note: 'Not activated' });
    expect(by.ownership).toMatchObject({ value: 'UNREGISTERED', note: 'No registered owner' });
    expect(by.genome.value).toBe('NONE');
    expect(primaryCode([])).toBeNull();
  });

  it('picks the ACTIVE code, else the latest issue', () => {
    const d = detail();
    expect(primaryCode(d.codes)?.issue).toBe(2);
    expect(primaryCode(d.codes.map((c) => ({ ...c, status: 'REVOKED' as const })))?.issue).toBe(2);
  });

  it('offers actions by role and state', () => {
    const d = detail();
    const admin = productActions(d, 'ADMIN');
    expect(admin.transitions).toContain('REVOKED');
    expect(admin.revocableCodeId).toBe('c2');
    expect(admin.canReissue).toBe(true);
    expect(admin.canActivateWarranty).toBe(false); // already started
    expect(admin.canVoidWarranty).toBe(true);
    expect(admin.canOpenService).toBe(true);
    expect(admin.canConfirmOwnership).toBe(false); // verified

    const op = productActions(d, 'OPERATOR');
    expect(op.transitions).not.toContain('REVOKED');
    expect(op.transitions).not.toContain('RETIRED'); // terminal, verifies as REVOKED: ADMIN only
    expect(admin.transitions).toContain('RETIRED');
    expect(op.transitions).toContain('LOST');
    expect(op.revocableCodeId).toBeNull();
    expect(op.canDownload).toBe(true);

    const auditor = productActions(d, 'AUDITOR');
    expect(auditor).toMatchObject({ transitions: [], canReissue: false, canDownload: false, canVoidWarranty: false, canOpenService: false, revocableCodeId: null });
  });

  it('follows the server rules for warranty, re-issue and ownership confirmation', () => {
    const issued = detail({ warranty: null, lifecycle: { status: 'ISSUED', allowed: ['ACTIVATED'], returnTo: null, canReinstate: false } });
    expect(productActions(issued, 'OPERATOR').canActivateWarranty).toBe(true);
    // Extension needs a started, non-void warranty (server: WARRANTY_NOT_STARTED / WARRANTY_VOID).
    expect(productActions(issued, 'OPERATOR').canExtendWarranty).toBe(false);
    expect(productActions(detail(), 'OPERATOR').canExtendWarranty).toBe(true);
    expect(productActions(detail(), 'AUDITOR').canExtendWarranty).toBe(false);
    const voided = detail();
    voided.warranty = { ...voided.warranty!, voidedAt: '2026-05-01T00:00:00.000Z', status: 'VOID' };
    expect(productActions(voided, 'OPERATOR').canExtendWarranty).toBe(false);
    for (const s of serverSchema.PRODUCT_STATUSES) {
      const d = detail({ warranty: null, lifecycle: { status: s, allowed: [], returnTo: null, canReinstate: false } });
      expect(productActions(d, 'OPERATOR').canActivateWarranty, s).toBe(ACTIVATABLE_STATUSES.includes(s));
    }
    // A pre-sale service (SERVICED, returning to ISSUED) is closed before the sale (409 WARRANTY_ACTIVATION_NOT_ALLOWED).
    const inspected = detail({ warranty: null, lifecycle: { status: 'SERVICED', allowed: ['ISSUED'], returnTo: 'ISSUED', canReinstate: false } });
    expect(productActions(inspected, 'OPERATOR').canActivateWarranty).toBe(false);
    const repaired = detail({ warranty: null, lifecycle: { status: 'SERVICED', allowed: ['OWNED'], returnTo: 'OWNED', canReinstate: false } });
    expect(productActions(repaired, 'OPERATOR').canActivateWarranty).toBe(true);
    const stolen = detail({ lifecycle: { status: 'STOLEN', allowed: ['OWNED', 'RETIRED'], returnTo: 'OWNED', canReinstate: false } });
    expect(productActions(stolen, 'OPERATOR').canReissue).toBe(false);
    const maxed = detail();
    maxed.codes[1] = { ...maxed.codes[1], issue: 255 };
    expect(productActions(maxed, 'OPERATOR').canReissue).toBe(false);
    const unverified = detail({ ownership: { current: { accountId: 'a', acquiredVia: 'FIRST_REGISTRATION', verified: false, since: '', transferPending: false }, owners: [], transfers: [] } });
    expect(productActions(unverified, 'OPERATOR').canConfirmOwnership).toBe(true);
    const revoked = detail({ lifecycle: { status: 'REVOKED', allowed: [], returnTo: 'OWNED', canReinstate: true } });
    expect(productActions(revoked, 'OPERATOR').canReinstate).toBe(false);
    expect(productActions(revoked, 'ADMIN').canReinstate).toBe(true);
  });

  it('lists catalogue attributes without cryptographic material', () => {
    const attrs = productAttributes(detail());
    expect(attrs.map((a) => a.label)).toContain('Production batch');
    expect(JSON.stringify(attrs)).not.toMatch(/payload|signature|nonce/i);
    expect(attrs.find((a) => a.label === 'Serial')?.value).toBe('00184');
  });
});

// ── Generator ──────────────────────────────────────────────────────────────

const form = (over: Partial<IssueForm> = {}): IssueForm => ({
  categoryCode: 'J',
  modelId: '22222222-2222-4222-8222-222222222222',
  collectionId: '',
  material: ' 925 STERLING SILVER ',
  variant: '',
  productionBatch: '',
  productionDate: '',
  year: '',
  serial: '',
  sku: '',
  authPolicy: 'PRINTED_CODE',
  withClaimSecret: false,
  ...over,
});
const NOW = new Date('2026-10-01T12:00:00Z');

describe('generator view model', () => {
  it('builds the minimal issue body, omitting empty optional fields', () => {
    const r = buildIssueInput(form(), NOW);
    expect(r).toEqual({ ok: true, value: { categoryCode: 'J', modelId: '22222222-2222-4222-8222-222222222222', material: '925 STERLING SILVER' } });
  });

  it('passes every optional field through when given', () => {
    const r = buildIssueInput(
      form({
        categoryCode: 'j',
        collectionId: '33333333-3333-4333-8333-333333333333',
        variant: '52',
        productionBatch: 'B-1',
        productionDate: '2026-09-30',
        year: '2026',
        serial: '184',
        sku: 'MNL-RG-52',
        authPolicy: 'printed_code+secure_nfc',
        withClaimSecret: true,
      }),
      NOW,
    );
    expect(r.ok && r.value).toEqual({
      categoryCode: 'J',
      modelId: '22222222-2222-4222-8222-222222222222',
      material: '925 STERLING SILVER',
      collectionId: '33333333-3333-4333-8333-333333333333',
      variant: '52',
      productionBatch: 'B-1',
      productionDate: '2026-09-30',
      year: 2026,
      serial: 184,
      sku: 'MNL-RG-52',
      authPolicy: 'PRINTED_CODE+SECURE_NFC',
      withClaimSecret: true,
    });
  });

  it('reports field errors', () => {
    const r = buildIssueInput(
      form({ categoryCode: '', modelId: 'x', material: '', productionDate: '2026-02-30', year: '1999', serial: '1.5', sku: '-bad', authPolicy: 'SECURE_NFC' }),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['authPolicy', 'categoryCode', 'material', 'modelId', 'productionDate', 'serial', 'sku', 'year']);
    const future = buildIssueInput(form({ productionDate: '2026-10-05' }), NOW);
    expect(!future.ok && future.errors.productionDate).toMatch(/future/);
    const control = buildIssueInput(form({ variant: 'a\u0007b' }), NOW);
    expect(!control.ok && control.errors.variant).toBeTruthy();
  });

  it('normalises authentication policies like the server', () => {
    expect(normalizePolicy('')).toBe('PRINTED_CODE');
    expect(normalizePolicy(' printed_code + tamper_evident ')).toBe('PRINTED_CODE+TAMPER_EVIDENT');
    expect(normalizePolicy('SECURE_NFC')).toBeNull();
    expect(normalizePolicy('PRINTED_CODE+PRINTED_CODE')).toBeNull();
    expect(normalizePolicy('PRINTED_CODE+QUANTUM')).toBeNull();
  });

  it('offers the active models of a category, sorted by name: an inactive model is hidden (A-10)', () => {
    const m = (name: string, code: string, active = true) => ({ id: name, name, category: { code }, active }) as unknown as Model;
    expect(modelsFor([m('ZETA', 'J'), m('ALPHA', 'J'), m('BAG', 'L'), m('HALO', 'J', false)], 'J').map((x) => x.name)).toEqual(['ALPHA', 'ZETA']);
    expect(modelsFor([m('HALO', 'J', false)], 'J')).toEqual([]);
  });

  it('validates artifact options within the server bounds', () => {
    const f = (o: Partial<ArtifactForm>): ArtifactForm => ({ widthMm: '30', theme: 'classic', label: false, decor: true, dpi: '', testPrint: false, kOnly: false, ...o });
    const ok = buildArtifactOptions(f({ widthMm: '25.555', theme: 'ivory', label: true, decor: false, dpi: '1200' }), 'png');
    expect(ok).toEqual({ ok: true, value: { widthMm: 25.56, theme: 'ivory', label: true, decor: false, dpi: 1200 } });
    const svg = buildArtifactOptions(f({ widthMm: '', theme: '', dpi: 'garbage' }), 'svg');
    expect(svg).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: false, decor: true } });
    expect(buildArtifactOptions(f({ widthMm: '9.5', testPrint: true }), 'pdf').ok).toBe(false); // under the server floor
    expect(buildArtifactOptions(f({ theme: 'neon' }), 'svg').ok).toBe(false);
    expect(buildArtifactOptions(f({ dpi: '71' }), 'png').ok).toBe(false);
    const huge = buildArtifactOptions(f({ widthMm: '500', dpi: '2400' }), 'png');
    expect(!huge.ok && huge.errors).toMatchObject({ dpi: expect.stringMatching(/too large/) });
    expect(cellPitchNote(30)).toBe('Cell pitch 0.60 mm');
    expect(cellPitchNote(Number.NaN)).toBe('');
  });

  it('names the colourways classic / inverted / ivory, labelled as in the brand system', () => {
    expect([...web.ARTIFACT_THEMES]).toEqual(['classic', 'inverted', 'ivory']);
    expect(ARTIFACT_DEFAULTS.theme).toBe('classic');
    expect(THEME_OPTIONS).toEqual([
      { value: 'classic', label: 'CLASSIC — BLACK ON WHITE' },
      { value: 'inverted', label: 'INVERTED — WHITE ON BLACK' },
      { value: 'ivory', label: 'IVORY — INK ON IVORY' },
    ]);
  });

  it('warns under 30 mm and refuses under 15 mm unless the file is marked as a test print', () => {
    const f = (widthMm: string, testPrint = false): ArtifactForm => ({ widthMm, theme: 'classic', label: false, decor: true, dpi: '', testPrint, kOnly: false });
    expect(ARTIFACT_SIZE_ADVICE).toEqual({ recommendedMinMm: 30, testPrintBelowMm: 15 });
    expect(artifactSizeAdvice(30, false)).toEqual({ level: 'ok' });
    expect(artifactSizeAdvice(25, false)).toEqual({ level: 'warn', message: expect.stringMatching(/below the 30 mm minimum/) });
    expect(artifactSizeAdvice(14.5, false)).toEqual({ level: 'refuse', message: expect.stringMatching(/Under 15 mm.*test print/) });
    expect(artifactSizeAdvice(14.5, true)).toEqual({ level: 'warn', message: expect.stringMatching(/test print/i) });
    expect(buildArtifactOptions(f('25'), 'pdf').ok).toBe(true);
    const refused = buildArtifactOptions(f('12'), 'pdf');
    expect(!refused.ok && refused.errors).toMatchObject({ widthMm: expect.stringMatching(/test print/) });
    expect(buildArtifactOptions(f('12', true), 'pdf')).toMatchObject({ ok: true, value: { widthMm: 12 } });
  });

  it('offers K-only black for PDF in the neutral colourways only', () => {
    const f = (o: Partial<ArtifactForm>): ArtifactForm => ({ widthMm: '30', theme: 'classic', label: false, decor: true, dpi: '', testPrint: false, kOnly: true, ...o });
    expect(buildArtifactOptions(f({}), 'pdf')).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: false, decor: true, kOnly: true } });
    expect(buildArtifactOptions(f({}), 'svg')).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: false, decor: true } });
    const ivory = buildArtifactOptions(f({ theme: 'ivory' }), 'pdf');
    expect(!ivory.ok && ivory.errors).toMatchObject({ kOnly: expect.stringMatching(/classic or inverted/) });
  });

  it('builds print-sheet options for 1 to 1 000 selected ACTIVE codes (printed as PDFs of 200)', () => {
    expect(PRINT_SHEET_LIMITS).toEqual({ maxCodes: 200, maxSelection: 1000, pages: ['A4', 'A3', 'LETTER'] });
    expect(PRINT_SHEET_LIMITS.maxCodes).toBe(MAX_SHEET_ITEMS);
    expect(PRINT_SHEET_LIMITS.maxSelection).toBe(MAX_CODE_IDS);
    expect([...PRINT_SHEET_LIMITS.pages]).toEqual(Object.keys(SHEET_PAGES));
    const f: PrintSheetForm = { widthMm: '', theme: 'classic', label: true, decor: true, dpi: '', testPrint: false, kOnly: false, page: 'A4' };
    expect(buildPrintSheetOptions(f, 2)).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: true, decor: true, page: 'A4' } });
    expect(buildPrintSheetOptions({ ...f, kOnly: true, page: 'A3' }, 2)).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: true, decor: true, page: 'A3', kOnly: true } });
    const none = buildPrintSheetOptions(f, 0);
    expect(!none.ok && none.errors).toMatchObject({ codes: 'Select 1 to 1\u2009000 active codes.' });
    expect(buildPrintSheetOptions(f, 201).ok).toBe(true);
    expect(buildPrintSheetOptions(f, 1000).ok).toBe(true);
    expect(buildPrintSheetOptions(f, 1001).ok).toBe(false);
    expect(buildPrintSheetOptions({ ...f, page: 'B5' }, 1).ok).toBe(false);
    expect(buildPrintSheetOptions({ ...f, widthMm: '12' }, 1).ok).toBe(false); // test-print rule applies to sheets too
    expect(isSheetSelectable({ status: 'ACTIVE' })).toBe(true);
    for (const status of ['SUPERSEDED', 'REVOKED'] as const) expect(isSheetSelectable({ status })).toBe(false);
    // The ACTIVE code of a LOST, STOLEN, RETIRED, REVOKED or flagged piece: the list says it does not print.
    expect(isSheetSelectable({ status: 'ACTIVE', printable: false })).toBe(false);
    expect(isSheetSelectable({ status: 'ACTIVE', printable: true })).toBe(true);
  });

  it('drops from the selection a code revoked (or a piece made unprintable) after it was picked, as soon as the view knows it', () => {
    const selection = () => new Set(['a', 'b', 'c', 'd']);
    // The page shows b revoked since, and c whose piece was reported stolen: neither has a box left to untick.
    let s = selection();
    const page = [
      { id: 'a', status: 'ACTIVE' as const, printable: true },
      { id: 'b', status: 'REVOKED' as const, printable: false },
      { id: 'c', status: 'ACTIVE' as const, printable: false },
      { id: 'x', status: 'SUPERSEDED' as const, printable: false },
    ];
    expect(pruneSheetSelection(s, page, null)).toEqual(['b', 'c']);
    expect([...s]).toEqual(['a', 'd']);
    // The complete batch of the filters lists every printable code: d, on another page, is no longer in it.
    s = selection();
    expect(pruneSheetSelection(s, [], { ids: ['a', 'b', 'c'], truncated: false })).toEqual(['d']);
    expect([...s]).toEqual(['a', 'b', 'c']);
    // A truncated batch proves nothing about the codes it leaves out; nothing to drop, nothing dropped.
    s = selection();
    expect(pruneSheetSelection(s, [], { ids: ['a'], truncated: true })).toEqual([]);
    expect(pruneSheetSelection(s, page.slice(0, 1), null)).toEqual([]);
    expect(s.size).toBe(4);
    // A refused part names the piece; the panel says how to leave it out.
    expect(SHEET_CODE_REFUSALS).toEqual(['CODE_NOT_ACTIVE', 'PRODUCT_NOT_PRINTABLE', 'CODE_INTEGRITY']);
    expect(sheetRefusalText('Only the active code of a product can be rendered: issue 1 of O26-J-00184 is REVOKED.')).toBe(
      'Only the active code of a product can be rendered: issue 1 of O26-J-00184 is REVOKED. Leave it out: it leaves the selection as soon as the list shows it (filter by its production batch), or clear the selection.',
    );
  });

  it('previews the layout before rendering ("35 per A4 · 4 pages") with the grid the server prints', () => {
    const f: PrintSheetForm = { widthMm: '25', theme: 'classic', label: true, decor: true, dpi: '', testPrint: false, kOnly: false, page: 'A4' };
    // 25 mm labelled: 5 columns × 7 rows on A4.
    expect(printSheetPreview(f, 0)).toEqual({ ok: true, perPage: 35, columns: 5, rows: 7, pages: 0, files: 0, text: '35 per A4' });
    expect(printSheetPreview(f, 1).text).toBe('35 per A4 · 1 page');
    expect(printSheetPreview(f, 120)).toMatchObject({ perPage: 35, pages: 4, files: 1, text: '35 per A4 · 4 pages' });
    // The console's default, 30 mm: 30 per A4, so a batch of 120 is four full pages.
    expect(printSheetPreview({ ...f, widthMm: '' }, 120).text).toBe('30 per A4 · 4 pages');
    expect(printSheetPreview({ ...f, widthMm: '30', label: false }, 10).text).toBe('35 per A4 · 1 page');
    expect(printSheetPreview({ ...f, widthMm: '30', page: 'A3' }, 120).text).toBe('63 per A3 · 2 pages');
    // Over 200 codes: PDFs of 200, pages summed (200 = 6 pages of 35, then 1 for the last 10).
    expect(printSheetPreview(f, 210)).toMatchObject({ pages: 7, files: 2, text: '35 per A4 · 7 pages · 2 PDFs of up to 200 codes' });
    expect(printSheetPreview(f, 1000)).toMatchObject({ pages: 30, files: 5 });
    // Nothing to show for an unusable width; a refusal when the code does not fit the page.
    expect(printSheetPreview({ ...f, widthMm: 'abc' }, 3)).toEqual({ ok: false, text: '' });
    expect(printSheetPreview({ ...f, widthMm: '5' }, 3)).toEqual({ ok: false, text: '' });
    expect(printSheetPreview({ ...f, page: 'B5' }, 3)).toEqual({ ok: false, text: '' });
    expect(printSheetPreview({ ...f, widthMm: '250' }, 3)).toEqual({ ok: false, text: 'The code does not fit on this page size.' });
    // Exactly what the server lays out for the same options.
    for (const [widthMm, label, page, count] of [['25', true, 'A4', 120], ['30', false, 'LETTER', 77], ['42.25', true, 'A3', 200], ['60', true, 'A4', 13]] as const) {
      const preview = printSheetPreview({ widthMm, label, page }, count);
      const plan = planPrintSheet(count, { widthMm: Number(widthMm), label, page });
      expect(preview).toMatchObject({ ok: true, columns: plan.layout.columns, rows: plan.layout.rows, pages: plan.layout.pages.length });
    }
  });

  it('splits a selection into PDFs of 200 and names the parts', () => {
    const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
    const parts = sheetChunks(ids);
    expect(parts.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(parts.flat()).toEqual(ids);
    expect(sheetChunks([])).toEqual([]);
    expect(sheetChunks(ids.slice(0, 120))).toEqual([ids.slice(0, 120)]);
    expect(sheetPartFilename('ORBES-sheet-2026-10-02-200-classic-30mm.pdf', 1, 1)).toBe('ORBES-sheet-2026-10-02-200-classic-30mm.pdf');
    expect(sheetPartFilename('ORBES-sheet-2026-10-02-200-classic-30mm.pdf', 2, 3)).toBe('ORBES-sheet-2026-10-02-200-classic-30mm-part-2-of-3.pdf');
    expect(sheetPartFilename('ORBES-sheet-2026-10-02-50-classic-30mm-K-manifest.csv', 3, 3)).toBe('ORBES-sheet-2026-10-02-50-classic-30mm-K-part-3-of-3-manifest.csv');
  });

  it('reads the codes filters from the route and keys a selection to them (not to the page)', () => {
    const f = codeFiltersFrom({ productionBatch: ' B-2026-09-A ', status: 'ACTIVE', page: '3', modelId: '', issuedFrom: '2026-09-01' });
    expect(f).toEqual({ productionBatch: 'B-2026-09-A', status: 'ACTIVE', issuedFrom: '2026-09-01' });
    expect(codeFilterKey(f)).toBe(codeFilterKey(codeFiltersFrom({ productionBatch: 'B-2026-09-A', status: 'ACTIVE', issuedFrom: '2026-09-01', page: '1' })));
    expect(codeFilterKey(f)).not.toBe(codeFilterKey({ ...f, status: 'REVOKED' }));
    expect(codeFilterKey({ productionBatch: 'A', status: '' })).not.toBe(codeFilterKey({ productionBatch: '', status: 'A' }));
    expect(hasCodeFilters({})).toBe(false);
    expect(hasCodeFilters(codeFiltersFrom({ page: '2' }))).toBe(false);
    expect(hasCodeFilters(f)).toBe(true);
    expect(batchSelectLabel(f, 120)).toEqual(['Select the ', '120', ' codes of this batch']);
    expect(batchSelectLabel({ status: 'ACTIVE' }, 1000).join('')).toBe('Select the 1\u2009000 codes that match');
    expect(batchSelectLabel(f, 1).join('')).toBe('Select the 1 code of this batch');
  });

  it('only an ADMIN manages console users', () => {
    expect(can('ADMIN', 'manageAdmins')).toBe(true);
    expect(can('OPERATOR', 'manageAdmins')).toBe(false);
  });

  it('groups claim codes for display', () => {
    expect(formatClaimCode('ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN');
    expect(formatClaimCode('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    expect(formatClaimCode('short')).toBe('short');
  });
});

// ── Batches ────────────────────────────────────────────────────────────────

describe('batch issuance view model', () => {
  const T: BatchTemplateForm = {
    categoryCode: 'J',
    modelId: '22222222-2222-4222-8222-222222222222',
    collectionId: '',
    material: '925 STERLING SILVER',
    productionBatch: 'B-2026-10-A',
    productionDate: '2026-10-01',
    year: '2026',
    authPolicy: 'PRINTED_CODE',
    withClaimSecret: true,
  };
  const row = (line: number | null, variant = '', sku = '', serial = ''): BatchRow => ({ line, variant, sku, serial });

  it('mirrors the server: 50 pieces per request under its 16 KB body limit, 50 cards per certificate request, the same columns', () => {
    expect(ISSUE_BATCH_LIMITS.perRequest).toBe(MAX_ISSUE_BATCH);
    expect(ISSUE_BATCH_LIMITS.maxBodyBytes).toBeLessThan(BODY_LIMIT_BYTES);
    expect(CERTIFICATE_LIMITS.perRequest).toBe(MAX_CERTIFICATE_ITEMS);
    expect(Object.keys(issueBatchBody.shape.items.element.shape)).toEqual([...BATCH_COLUMNS]);
    expect(Object.keys(issueBatchBody.shape.template.shape).sort()).toEqual(Object.keys(T).sort());
  });

  it('reads a spreadsheet CSV: byte-order mark, semicolons, CRLF, quotes, blank lines, any column order', () => {
    const csv = '\uFEFFSKU;Variant;serial\r\nMNL-RG-52;"Size 52; polished";\r\n\r\n;"Size ""54""";12\r\nMNL-RG-56;Size 56\r\n';
    const r = parseBatchCsv(csv);
    expect(r).toEqual({
      ok: true,
      delimiter: ';',
      columns: ['variant', 'sku', 'serial'],
      rows: [
        { line: 2, variant: 'Size 52; polished', sku: 'MNL-RG-52', serial: '' },
        { line: 4, variant: 'Size "54"', sku: '', serial: '12' },
        // A row may stop before the last columns.
        { line: 5, variant: 'Size 56', sku: 'MNL-RG-56', serial: '' },
      ],
    });
    // Commas by default; one column is enough; a quoted line break keeps the line count right.
    const commas = parseBatchCsv('variant,sku\n"Size\n52",X-1\nSize 54,X-2');
    expect(commas.ok && commas.rows.map((x) => [x.line, x.variant, x.sku])).toEqual([
      [2, 'Size\n52', 'X-1'],
      [4, 'Size 54', 'X-2'],
    ]);
    expect(commas.ok && commas.delimiter).toBe(',');
    const one = parseBatchCsv('variant\n50 ML\n100 ML\n');
    expect(one.ok && one.rows.map((x) => x.variant)).toEqual(['50 ML', '100 ML']);
    expect(one.ok && one.columns).toEqual(['variant']);
  });

  it('reads a file of one column as one value per line: a decimal comma never splits it', () => {
    // Excel (France) writes it unquoted: its delimiter is the semicolon, so it never quotes a comma.
    expect(parseBatchCsv('variant\r\n7,5 ML\r\n')).toEqual({ ok: true, delimiter: null, columns: ['variant'], rows: [{ line: 2, variant: '7,5 ML', sku: '', serial: '' }] });
    // A quoted value still reads as one, quotes undone.
    const quoted = parseBatchCsv('variant\n"Size ""52""; polished"\n12,5 cm\n');
    expect(quoted.ok && quoted.rows.map((r) => r.variant)).toEqual(['Size "52"; polished', '12,5 cm']);
  });

  it('takes the delimiter from the first line that is not blank', () => {
    const r = parseBatchCsv('\r\n  \r\nvariant;sku\r\n7,5 ML;MNL-RG-75\r\n');
    expect(r).toEqual({ ok: true, delimiter: ';', columns: ['variant', 'sku'], rows: [{ line: 4, variant: '7,5 ML', sku: 'MNL-RG-75', serial: '' }] });
  });

  it('reads a UTF-8 file as such, and a file that is not UTF-8 as Windows-1252 (Excel\'s plain CSV), accents whole', () => {
    // "variant;sku" then "Écrin doré;" in Windows-1252: É is 0xC9, é 0xE9 (neither is valid UTF-8 there).
    const cp1252 = new Uint8Array([...Buffer.from('variant;sku\r\n', 'latin1'), 0xc9, ...Buffer.from('crin dor', 'latin1'), 0xe9, ...Buffer.from(';\r\n', 'latin1')]);
    const legacy = decodeBatchCsv(cp1252);
    expect(legacy).toEqual({ text: 'variant;sku\r\nÉcrin doré;\r\n', encoding: 'windows-1252' });
    const parsed = parseBatchCsv(legacy.text);
    expect(parsed.ok && parsed.rows.map((r) => r.variant)).toEqual(['Écrin doré']);
    // Read as UTF-8 (Blob.text()), the same bytes would have become U+FFFD.
    expect(new TextDecoder().decode(cp1252)).toContain('\uFFFD');
    // UTF-8, with its byte-order mark: as is (the mark is dropped).
    expect(decodeBatchCsv(new TextEncoder().encode('\uFEFFvariant\nÉcrin\n'))).toEqual({ text: 'variant\nÉcrin\n', encoding: 'utf-8' });
    expect(decodeBatchCsv(new TextEncoder().encode('variant\n€ 12\n')).encoding).toBe('utf-8');
  });

  it('refuses a value that lost a letter (U+FFFD), on its line, before anything is signed', () => {
    const r = parseBatchCsv('variant;sku\nSize 52;MNL\n\uFFFDcrin;MNL\nSize 54;MN\uFFFD\n');
    expect(!r.ok && r.problems.map(batchProblemText)).toEqual([
      'Line 3 · A character could not be read (\uFFFD): save the file as CSV UTF-8, then choose it again.',
      'Line 4 · A character could not be read (\uFFFD): save the file as CSV UTF-8, then choose it again.',
    ]);
  });

  it('names the line of every problem in the file', () => {
    const problems = (csv: string) => {
      const r = parseBatchCsv(csv);
      return r.ok ? [] : r.problems.map(batchProblemText);
    };
    expect(problems('')).toEqual(['The file is empty.']);
    expect(problems('\uFEFF\r\n\r\n')).toEqual(['The file is empty.']);
    expect(problems('52,MNL-RG-52\n54,MNL-RG-54')).toEqual(['Line 1 · Name the columns on the first line: variant, sku, serial (each optional).']);
    expect(problems('variant,size\n52,L')).toEqual(['Line 1 · Unknown column "size": the columns are variant, sku, serial.']);
    expect(problems('variant,Variant\n52,54')).toEqual(['Line 1 · The column "variant" appears twice.']);
    expect(problems('variant,sku\nSize 52, gold,MNL\nSize 54,MNL\nSize 56,MNL,extra')).toEqual([
      'Line 2 · 3 values for 2 named columns: quote a value that holds ",".',
      'Line 4 · 3 values for 2 named columns: quote a value that holds ",".',
    ]);
    expect(problems('variant,sku\n52,X\n"54,Y\n56,Z')).toEqual(['Line 3 · A quoted value is never closed.']);
    expect(problems('variant,sku\n')).toEqual(['The file has no piece under its first line.']);
    expect(problems(`variant\n${Array.from({ length: 1001 }, (_, i) => String(i)).join('\n')}`)).toEqual(['The file holds 1 001 pieces; a batch holds at most 1 000.']);
    // An empty trailing column (a spreadsheet's extra delimiter) is ignored while it stays empty.
    expect(parseBatchCsv('variant;sku;\n52;X;\n').ok).toBe(true);
  });

  it('checks the template once and every piece with the generator rules, line by line', () => {
    const ok = buildIssueBatch(T, [row(2, 'Size 52'), row(3, '', 'MNL-RG-X'), row(4, '', '', '12')], NOW);
    expect(ok).toEqual({
      ok: true,
      template: {
        categoryCode: 'J',
        modelId: '22222222-2222-4222-8222-222222222222',
        material: '925 STERLING SILVER',
        productionBatch: 'B-2026-10-A',
        productionDate: '2026-10-01',
        year: 2026,
        withClaimSecret: true,
      },
      items: [{ variant: 'Size 52' }, { sku: 'MNL-RG-X' }, { serial: 12 }],
      lines: [2, 3, 4],
    });
    const bad = buildIssueBatch(T, [row(2, 'a\u0007b'), row(3, '', '-bad'), row(4, '', '', '0'), row(5, '', '', '12'), row(6, '', '', '12')], NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.templateErrors).toEqual({});
      expect(bad.problems.map(batchProblemText)).toEqual([
        'Line 2 · Variant: At most 100 characters, no control characters.',
        'Line 3 · SKU: Letters, digits, space, . _ - / only (64 max).',
        'Line 4 · Serial must be 1–999 999.',
        'Line 6 · Serial 12 is already on line 5.',
      ]);
    }
    // A C1 control is refused here as the server refuses it (\p{Cc}), before any request is signed.
    const c1 = buildIssueBatch(T, [row(2, 'Size 50'), row(3, 'Size\u008552')], NOW);
    expect(!c1.ok && c1.problems.map(batchProblemText)).toEqual(['Line 3 · Variant: At most 100 characters, no control characters.']);
    expect(buildIssueBatch({ ...T, material: '925\u009fSILVER' }, [row(2)], NOW)).toMatchObject({ ok: false, templateErrors: { material: expect.any(String) } });
    // The template's errors go on its fields, once, not on every line.
    const template = buildIssueBatch({ ...T, material: '', productionDate: '2026-02-30' }, [row(2), row(3)], NOW);
    expect(!template.ok && template).toMatchObject({ templateErrors: { material: expect.any(String), productionDate: expect.any(String) }, problems: [] });
    expect(buildIssueBatch(T, [], NOW)).toMatchObject({ ok: false, problems: [{ line: null, message: 'Add at least one piece.' }] });
  });

  it('sends the pieces that name their serial first, and refuses a serial that leaves the others none', () => {
    // [allocated, allocated, serial 12]: serial 12 goes first, so the allocated ones never take it.
    const items = [{ variant: '50' }, { variant: '52' }, { serial: 12 }, {}, { serial: 7 }];
    const order = batchSigningOrder(items);
    expect(order).toEqual([2, 4, 0, 1, 3]);
    // The results come back in the batch's order, whatever the order sent.
    const sent = order.map((i) => items[i]);
    const issued = (index: number, serial: number) => ({ index, status: 'ISSUED' as const, productId: `O26-J-${String(serial).padStart(5, '0')}`, codeId: `c${serial}`, serial, sku: 'MNL-RG', variant: null });
    const rows = batchResultRows([2, 3, 4, 5, 6], items, [
      { start: 0, count: 3, kind: 'answered', response: { issued: 3, failed: 0, skipped: 0, items: [issued(0, 12), issued(1, 7), issued(2, 13)] } },
      { start: 3, count: 2, kind: 'refused', message: 'Not signed: the session ended before this request. Sign in again, then sign this piece.' },
    ], order);
    expect(sent[0]).toEqual({ serial: 12 });
    expect(rows.map((r) => [r.line, r.status, r.serial ?? null])).toEqual([
      [2, 'ISSUED', 13],
      [3, 'FAILED', null],
      [4, 'ISSUED', 12],
      [5, 'FAILED', null],
      [6, 'ISSUED', 7],
    ]);
    expect(batchSigningOrder([{}, {}])).toEqual([0, 1]);

    // Serial 999 999 would leave the two allocated pieces nothing (they come after it, above it).
    const high = buildIssueBatch(T, [row(2, '', '', '999999'), row(3), row(4)], NOW);
    expect(!high.ok && high.problems.map(batchProblemText)).toEqual(['Line 2 · Serial 999999 leaves no serial for the 2 pieces allocated after it: sign it apart, or give them serials.']);
    expect(buildIssueBatch(T, [row(2, '', '', '999998'), row(3)], NOW).ok).toBe(true);
    expect(buildIssueBatch(T, [row(2, '', '', '999999'), row(3, '', '', '5')], NOW).ok).toBe(true);
  });

  it('turns a quantity into identical pieces, and reports a piece error once', () => {
    expect(quantityRows('3', '50 ML', '')).toEqual({ ok: true, rows: [row(null, '50 ML'), row(null, '50 ML'), row(null, '50 ML')] });
    for (const q of ['0', '1001', '2.5', 'abc', '']) expect(quantityRows(q, '', '').ok, q).toBe(false);
    expect(quantityRows('1000', '', '').ok).toBe(true);
    const bad = quantityRows('120', 'a\u0007b', '');
    const refused = buildIssueBatch(T, bad.ok ? bad.rows : [], NOW);
    expect(!refused.ok && refused.problems.map(batchProblemText)).toEqual(['Variant: At most 100 characters, no control characters.']);
    const good = quantityRows('120', '50 ML', '');
    const fine = buildIssueBatch(T, good.ok ? good.rows : [], NOW);
    expect(fine.ok && fine.items.length).toBe(120);
    expect(fine.ok && fine.items[0]).toEqual({ variant: '50 ML' });
    expect(fine.ok && fine.lines.every((l) => l === null)).toBe(true);
  });

  it('sends a batch as requests of at most 50 pieces, every body under the byte budget, in order', () => {
    const template = { categoryCode: 'J', modelId: T.modelId, material: T.material, productionBatch: 'B-1' };
    const items = Array.from({ length: 120 }, (_, i) => ({ variant: `Size ${i}` }));
    const parts = batchRequests(template, items);
    expect(parts.map((p) => [p.start, p.items.length])).toEqual([
      [0, 50],
      [50, 50],
      [100, 20],
    ]);
    expect(parts.flatMap((p) => p.items)).toEqual(items);
    // Long variants in three-byte characters: the bytes decide before the count does.
    const heavy = Array.from({ length: 120 }, () => ({ variant: '€'.repeat(100), sku: 'X'.repeat(64) }));
    const split = batchRequests(template, heavy);
    expect(split.length).toBe(4); // 3 by the count alone
    expect(split[0].items.length).toBeLessThan(50);
    for (const p of split) {
      const bytes = new TextEncoder().encode(JSON.stringify({ template, items: p.items })).length;
      expect(bytes).toBeLessThanOrEqual(ISSUE_BATCH_LIMITS.maxBodyBytes);
      expect(p.items.length).toBeLessThanOrEqual(50);
    }
    expect(split.flatMap((p) => p.items)).toEqual(heavy);
    expect(split.map((p) => p.start)).toEqual(split.map((_, i) => split.slice(0, i).reduce((n, q) => n + q.items.length, 0)));
    expect(batchRequests(template, [])).toEqual([]);
    expect(batchPlanText(120, 3)).toBe('120 pieces · 3 requests of up to 50');
    expect(batchPlanText(1, 1)).toBe('1 piece · one request');
    expect(batchPlanText(1000, 20)).toBe('1 000 pieces · 20 requests of up to 50');
    expect(signBatchLabel(120)).toEqual(['Sign ', '120', ' products']);
    expect(signBatchLabel(1).join('')).toBe('Sign 1 product');
    expect(signBatchLabel(0).join('')).toBe('Sign the batch');
  });

  it('gives every piece its outcome, from the answers, a refusal, no answer, or nothing sent', () => {
    const lines = [2, 3, 4, 5, 6, 7, 8];
    const items = [{ variant: '50' }, { serial: 7 }, { variant: '54' }, { variant: '56' }, {}, {}, {}];
    const issued = (index: number, n: number) => ({ index, status: 'ISSUED' as const, productId: `O26-J-0000${n}`, codeId: `c${n}`, serial: n, sku: 'MNL-RG', variant: null, claimCode: `AAAA-BBBB-CCC${n}` });
    const rows = batchResultRows(lines, items, [
      {
        start: 0,
        count: 3,
        kind: 'answered',
        response: { issued: 2, failed: 1, skipped: 0, items: [issued(0, 1), { index: 1, status: 'FAILED', error: { code: 'SERIAL_TAKEN', message: 'This serial number is already used.' } }, issued(2, 2)] },
      },
      { start: 3, count: 1, kind: 'answered', response: { issued: 0, failed: 0, skipped: 1, items: [{ index: 0, status: 'SKIPPED' }] } },
      { start: 4, count: 1, kind: 'unanswered', message: 'No answer.' },
      { start: 5, count: 1, kind: 'refused', message: 'A batch is already being signed.' },
    ]);
    expect(rows.map((r) => [r.piece, r.line, r.status])).toEqual([
      [1, 2, 'ISSUED'],
      [2, 3, 'FAILED'],
      [3, 4, 'ISSUED'],
      [4, 5, 'SKIPPED'],
      [5, 6, 'NO_ANSWER'],
      [6, 7, 'FAILED'],
      [7, 8, 'NOT_SENT'],
    ]);
    expect(rows[0]).toMatchObject({ productId: 'O26-J-00001', codeId: 'c1', serial: 1, sku: 'MNL-RG', variant: null, claimCode: 'AAAA-BBBB-CCC1' });
    expect(rows[0].message).toBeUndefined();
    // What was asked for stays on a piece that was not signed.
    expect(rows[1]).toMatchObject({ serial: 7, message: 'This serial number is already used.' });
    expect(rows[3]).toMatchObject({ variant: '56', message: 'Not attempted: the batch stopped before this piece.' });
    expect(rows[5].message).toBe('A batch is already being signed.');
    expect(rows[6].message).toBe('Not sent: an earlier request failed.');

    const sum = batchSummary(rows);
    expect(sum).toMatchObject({ pieces: 7, issued: 2, notIssued: 4, noAnswer: 1, claimCodes: 2 });
    expect(sum.text).toBe('2 of 7 pieces signed · 4 not signed · 1 without an answer: look for them in Products before signing them again.');
    expect(batchSummary(rows.slice(0, 1)).text).toBe('1 of 1 piece signed.');
    expect(batchCertificateItems(rows)).toEqual([
      { productId: 'O26-J-00001', claimCode: 'AAAA-BBBB-CCC1' },
      { productId: 'O26-J-00002', claimCode: 'AAAA-BBBB-CCC2' },
    ]);
  });

  it('writes the results as a CSV a spreadsheet cannot run, named after the production batch', () => {
    const csv = batchResultsCsv([
      { piece: 1, line: 2, status: 'ISSUED', productId: 'O26-J-00001', codeId: 'c1', serial: 1, sku: 'MNL-RG-52', variant: '=SUM(A1)', claimCode: 'aaaabbbbcccc' },
      { piece: 2, line: null, status: 'FAILED', serial: 7, message: 'This serial number is already used.' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      '"line","piece","status","productId","sku","variant","serial","codeId","claimCode","message"',
      `"2","1","ISSUED","O26-J-00001","MNL-RG-52","'=SUM(A1)","1","c1","AAAA-BBBB-CCCC",""`,
      '"","2","NOT SIGNED","","","","7","","","This serial number is already used."',
      '',
    ]);
    expect(batchResultsFilename('B-2026-10-A', NOW, 120)).toBe('ORBES-batch-B-2026-10-A-2026-10-01-120-results.csv');
    expect(batchResultsFilename('Lot été / 2026', NOW, 3)).toBe('ORBES-batch-Lot-t-2026-2026-10-01-3-results.csv');
    expect(batchResultsFilename(undefined, NOW, 3)).toBe('ORBES-batch-2026-10-01-3-results.csv');
  });
});

// ── Registry rules ─────────────────────────────────────────────────────────

describe('registry view rules', () => {
  it('offers the anomaly triage workflow', () => {
    expect(triageMoves('OPEN').map((m) => m.to)).toEqual(['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']);
    expect(triageMoves('ACKNOWLEDGED').map((m) => m.to)).toEqual(['RESOLVED', 'DISMISSED', 'OPEN']);
    expect(triageMoves('RESOLVED')).toEqual([{ to: 'OPEN', label: 'Reopen', noteRequired: true }]);
    expect(triageMoves('OPEN').filter((m) => m.noteRequired).map((m) => m.to)).toEqual(['RESOLVED', 'DISMISSED']);
  });

  it('derives key actions and confirmation phrases', () => {
    expect(keyActions({ status: 'ACTIVE' })).toEqual({ canRetire: true, canRevoke: true, canAmend: false });
    expect(keyActions({ status: 'RETIRED' })).toEqual({ canRetire: false, canRevoke: true, canAmend: false });
    expect(keyActions({ status: 'REVOKED' })).toEqual({ canRetire: false, canRevoke: false, canAmend: true });
    expect(confirmationPhrase('revoke-key', 3)).toBe('REVOKE KEY 3');
    expect(confirmationPhrase('revoke-product', 'O26-J-00184')).toBe('REVOKE O26-J-00184');
    expect(confirmationPhrase('revoke-code', 2)).toBe('REVOKE ISSUE 2');
    expect(confirmationPhrase('reset-totp', 'ops@theorbes.com')).toBe('RESET 2FA ops@theorbes.com');
    expect(phraseMatches('  revoke   key 3 ', 'REVOKE KEY 3')).toBe(true);
    expect(phraseMatches('REVOKE KEY 4', 'REVOKE KEY 3')).toBe(false);
    expect(phraseMatches('', 'ROTATE')).toBe(false);
  });

  it('converts a UTC compromise time and refuses the future', () => {
    expect(compromiseTime('', NOW)).toEqual({ ok: true, iso: null });
    expect(compromiseTime('2026-09-30T08:15', NOW)).toEqual({ ok: true, iso: '2026-09-30T08:15:00.000Z' });
    expect(compromiseTime('2026-10-02T00:00', NOW).ok).toBe(false);
    expect(compromiseTime('yesterday', NOW).ok).toBe(false);
  });

  it('checks revocation targets by type', () => {
    expect(revocationTargetError('CODE', '11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(revocationTargetError('CODE', 'O26-J-00184')).toMatch(/UUID/);
    expect(revocationTargetError('PRODUCT', 'o26-j-00184')).toBeNull();
    expect(revocationTargetError('PRODUCT', 'ring')).toMatch(/product id/);
    expect(revocationTargetError('KEY', '255')).toBeNull();
    expect(revocationTargetError('KEY', '0')).toMatch(/1 to 255/);
    expect(revocationTargetError('KEY', '')).toBe('Enter the target.');
  });

  it('states the audit chain verdict', () => {
    expect(chainVerdict({ ok: true, checked: 1204, head: { id: 1204, hash: 'f'.repeat(64) } })).toMatchObject({ title: 'Chain intact', tone: 'solid' });
    expect(chainVerdict({ ok: true, checked: 1204, head: { id: 1204, hash: 'f'.repeat(64) } }).detail).toContain('1 204 entries');
    const bad = chainVerdict({ ok: false, checked: 41, firstBadId: 42, head: null });
    expect(bad).toMatchObject({ title: 'Chain broken', tone: 'critical' });
    expect(bad.detail).toContain('#42');
  });
});

describe('catalogue edits (A-10)', () => {
  const model = {
    id: 'm1',
    name: 'MONOLITHE',
    type: 'RING',
    skuPrefix: 'MNL-RG',
    category: { index: 1, code: 'J', name: 'Jewelry' },
    collection: { id: 'c1', name: 'ORBIT' },
    defaultMaterial: '925 STERLING SILVER',
    careInstructions: 'Polish with a soft dry cloth.',
    active: true,
    products: 184,
    createdAt: '2026-10-01T08:00:00.000Z',
  } as Model;

  it('sends only what differs, trimmed; never the category nor the SKU prefix', () => {
    const f = modelForm(model);
    expect(f).toEqual({ name: 'MONOLITHE', defaultMaterial: '925 STERLING SILVER', careInstructions: 'Polish with a soft dry cloth.', collectionId: 'c1', status: 'active' });
    expect(modelChange(model, f)).toEqual({});
    expect(modelChange(model, { ...f, name: ' MONOLITHE ', careInstructions: ' Polish with a soft dry cloth.\n' })).toEqual({});
    expect(modelChange(model, { ...f, name: 'MONOLITHE II', defaultMaterial: '  ', careInstructions: 'Wipe it.', collectionId: '', status: 'inactive' })).toEqual({
      name: 'MONOLITHE II',
      defaultMaterial: '',
      careInstructions: 'Wipe it.',
      collectionId: '',
      active: false,
    });
    const bare = { ...model, collection: null, defaultMaterial: null, careInstructions: null, active: false };
    expect(modelForm(bare)).toMatchObject({ defaultMaterial: '', careInstructions: '', collectionId: '', status: 'inactive' });
    expect(modelChange(bare, { ...modelForm(bare), status: 'active', collectionId: 'c2' })).toEqual({ active: true, collectionId: 'c2' });
    for (const change of [modelChange(model, { ...f, name: 'X' }), modelChange(bare, { ...modelForm(bare), name: 'Y' })]) {
      expect(Object.keys(change)).not.toEqual(expect.arrayContaining(['skuPrefix']));
      expect(Object.keys(change)).not.toEqual(expect.arrayContaining(['categoryCode']));
    }
    expect(MODEL_STATUS_OPTIONS.map((o) => o.value)).toEqual(['active', 'inactive']);
  });

  it('says how many issued pieces a change touches before it is saved', () => {
    // The collection only of the pieces without one of their own (product_overview: the piece's, else the model's).
    expect(modelImpact(184)).toBe(
      'Touches 184 issued pieces: the result of each on /verify reads this model’s name and care instructions, and its collection unless the piece has its own, as soon as they are saved.',
    );
    expect(modelImpact(1)).toMatch(/^Touches 1 issued piece: /);
    expect(modelImpact(12480).startsWith(`Touches ${formatCount(12480)} issued pieces: `)).toBe(true);
    expect(modelImpact(0)).toMatch(/^Touches no issued piece yet\. /);
    expect(collectionImpact(2)).toBe('Touches 2 issued pieces: the result of each on /verify reads the new name as soon as it is saved.');
    expect(collectionImpact(0)).toBe('Touches no issued piece yet.');
    // A category: its pieces counted first, and none of their results changes.
    expect(categoryImpact(9, true)).toBe(
      'Its 9 issued pieces keep verifying as before: no public result changes. No new piece can be issued in it, and the generator stops offering it; it can be activated again.',
    );
    expect(categoryImpact(1, true)).toMatch(/^Its 1 issued piece keeps verifying as before: /);
    expect(categoryImpact(0, true)).toBe('No piece has been issued in this category yet. No new piece can be issued in it, and the generator stops offering it; it can be activated again.');
    expect(categoryImpact(12480, false)).toBe(
      `The category receives new pieces again: the generator offers it with its active models. Its ${formatCount(12480)} issued pieces keep verifying as before: no public result changes.`,
    );
    expect(categoryImpact(0, false)).toBe('The category receives new pieces again: the generator offers it with its active models.');
  });

  it('previews the care block with the words /verify shows: the instructions trimmed, else the general care text', () => {
    expect(carePreview('  Wipe with a soft, dry cloth.  ')).toEqual({ text: 'Wipe with a soft, dry cloth.', general: false });
    expect(carePreview('')).toEqual({ text: VERIFY_CARE, general: true });
    expect(carePreview(null)).toEqual({ text: VERIFY_CARE, general: true });
    // One text, shared: the console's fallback is the verification app's.
    expect(SHARED_CARE).toBe(VERIFY_CARE);
  });
});

// ── Anomaly triage ─────────────────────────────────────────────────────────

describe('anomaly triage view model', () => {
  const ID = '0b4f6a8e-2c1d-4e5f-8a9b-0c1d2e3f4a5b';
  const CODE = '7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
  const context = (over: Partial<AnomalyContext> = {}): AnomalyContext => ({
    anomaly: {
      id: ID,
      productId: 'O26-J-00184',
      productUuid: '11111111-1111-4111-8111-111111111111',
      codeId: CODE,
      type: 'IMPOSSIBLE_TRAVEL',
      severity: 'HIGH',
      riskScore: 60,
      details: { scanEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      status: 'OPEN',
      occurrences: 1,
      firstSeenAt: '2026-10-01T10:00:00.000Z',
      lastSeenAt: '2026-10-01T10:01:00.000Z',
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      actorEmail: null,
    },
    window: { from: '2026-09-30T10:00:00.000Z', to: '2026-10-01T11:01:00.000Z' },
    scans: { total: 0, truncated: false, items: [] },
    countries: [],
    devices: 0,
    trigger: null,
    code: { id: CODE, issue: 1, status: 'ACTIVE' },
    product: { productId: 'O26-J-00184', lifecycle: { status: 'OWNED', allowed: ['TRANSFERRED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN', 'REVOKED'], returnTo: null, canReinstate: false } },
    ...over,
  });

  it('keeps the filters and the order in the URL; the default order stays out of it', () => {
    expect(anomalyFiltersFrom({ status: 'OPEN', type: ' IMPOSSIBLE_TRAVEL ', productId: 'O26-J-00184', sort: 'risk', severity: '', page: '2' })).toEqual({
      status: 'OPEN',
      type: 'IMPOSSIBLE_TRAVEL',
      productId: 'O26-J-00184',
      sort: 'risk',
    });
    expect(hasAnomalyFilters({ sort: 'risk' })).toBe(false);
    expect(hasAnomalyFilters({ productId: 'O26-J-00184' })).toBe(true);
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(['', 'risk', 'lastSeen']);
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['Severity, then risk', 'Risk', 'Last seen']);
    // Every non-default option is an order the server knows.
    for (const o of SORT_OPTIONS.slice(1)) expect(web.ANOMALY_SORTS).toContain(o.value);
    expect([sortValue(undefined), sortValue('severity'), sortValue('lastSeen')]).toEqual(['', '', 'lastSeen']);
  });

  it('filters by a full product id or uuid only, as the server reads it', () => {
    for (const ok of ['', '  ', 'O26-J-00184', 'o26-j-00184', 'O26-J-990001', '11111111-1111-4111-8111-111111111111']) expect(isProductFilter(ok), ok).toBe(true);
    for (const bad of ['ABC', 'O26-J', 'O26-J-184', 'O26-JJ-00184', 'O26-J-00184x', '11111111-1111-4111-8111']) expect(isProductFilter(bad), bad).toBe(false);
  });

  it('offers every type the server lists (and keeps a type of the URL it no longer lists)', () => {
    const types = ['IMPOSSIBLE_TRAVEL', 'UNSOLD_PIECE_SCAN'];
    expect(typeOptions(types)).toEqual([
      { value: '', label: 'All types' },
      { value: 'IMPOSSIBLE_TRAVEL', label: 'IMPOSSIBLE TRAVEL' },
      // S-07: the console's name of the type, not its code read aloud.
      { value: 'UNSOLD_PIECE_SCAN', label: 'UNSOLD PIECE SCANNED' },
    ]);
    expect(typeOptions(types, 'OLD_TYPE').map((o) => o.value)).toEqual(['', 'IMPOSSIBLE_TRAVEL', 'UNSOLD_PIECE_SCAN', 'OLD_TYPE']);
  });

  it('counts OPEN HIGH + CRITICAL in the badge and prefixes the tab title with it', () => {
    expect([badgeText(0), badgeText(-1), badgeText(Number.NaN), badgeText(3), badgeText(99), badgeText(100)]).toEqual(['', '', '', '3', '99', '99+']);
    expect(consoleTitle('Anomalies', 3)).toBe('(3) Anomalies — ORBES Genome Console');
    expect(consoleTitle('Dashboard', 0)).toBe('Dashboard — ORBES Genome Console');
  });

  it("links a finding's window and its triggering scan into Verification events", () => {
    const c = context();
    expect(windowScansHref(c)).toBe('#/scans?productId=O26-J-00184&from=2026-09-30T10%3A00%3A00.000Z&to=2026-10-01T11%3A01%3A00.000Z');
    expect(windowScansHref(context({ product: null }))).toBeNull();
    // The second the scan was made in, with the scan marked.
    expect(scanHref({ id: 'scan-1', occurredAt: '2026-10-01T10:01:00.420Z' }, 'O26-J-00184')).toBe(
      '#/scans?productId=O26-J-00184&from=2026-10-01T10%3A01%3A00.000Z&to=2026-10-01T10%3A01%3A00.999Z&scan=scan-1',
    );
    expect(scanHref({ id: 'scan-2', occurredAt: '2026-10-01T10:01:00.000Z' }, null)).toBe('#/scans?from=2026-10-01T10%3A01%3A00.000Z&to=2026-10-01T10%3A01%3A00.999Z&scan=scan-2');
    expect(
      countriesLine([
        { country: 'FR', scans: 1204 },
        { country: null, scans: 2 },
      ]),
    ).toBe('FR 1 204 · UNKNOWN 2');
  });

  it('offers the marks the lifecycle allows (OPERATOR) and the ACTIVE code (ADMIN), only for a finding that can be resolved', () => {
    const open = triageMoves('OPEN');
    expect(decisionOffer(context(), 'ADMIN', open)).toEqual({
      productId: 'O26-J-00184',
      marks: ['COUNTERFEIT_FLAGGED', 'STOLEN'],
      revoke: { codeId: CODE, issue: 1 },
    });
    expect(decisionOffer(context(), 'OPERATOR', open)).toMatchObject({ marks: ['COUNTERFEIT_FLAGGED', 'STOLEN'], revoke: null });
    expect(decisionOffer(context(), 'AUDITOR', open)).toMatchObject({ marks: [], revoke: null });
    // Closed findings only reopen.
    expect(decisionOffer(context(), 'ADMIN', triageMoves('RESOLVED'))).toMatchObject({ marks: [], revoke: null });
    // A STOLEN piece cannot be marked again; a revoked code is not offered.
    const stolen = context({ product: { productId: 'O26-J-00184', lifecycle: { status: 'STOLEN', allowed: ['OWNED', 'RETIRED', 'REVOKED'], returnTo: 'OWNED', canReinstate: false } }, code: { id: CODE, issue: 1, status: 'REVOKED' } });
    expect(decisionOffer(stolen, 'ADMIN', open)).toMatchObject({ marks: [], revoke: null });
    // No context (an identity never registered): nothing to act on.
    expect(decisionOffer(null, 'ADMIN', open)).toEqual({ productId: null, marks: [], revoke: null });
    expect(decisionNeedsContext(context().anomaly, 'OPERATOR')).toBe(true);
    expect(decisionNeedsContext({ ...context().anomaly, productUuid: null, codeId: null }, 'ADMIN')).toBe(false);
    expect(decisionNeedsContext({ ...context().anomaly, status: 'DISMISSED' }, 'ADMIN')).toBe(false);
    expect(decisionNeedsContext(context().anomaly, 'AUDITOR')).toBe(false);
  });

  it('chains the actions in order: mark, revoke, then record the decision', () => {
    const offer = decisionOffer(context(), 'ADMIN', triageMoves('OPEN'));
    const v = { status: 'RESOLVED', note: 'Seized in Lyon', [MARK_FIELDS.COUNTERFEIT_FLAGGED]: 'true', [REVOKE_FIELD]: 'true' };
    const steps = decisionSteps(v, offer);
    expect(steps.map((s) => s.key)).toEqual(['mark:COUNTERFEIT_FLAGGED', `revoke:${CODE}`, 'status:RESOLVED']);
    expect(steps.map((s) => s.label)).toEqual(['Mark the piece COUNTERFEIT FLAGGED', 'Revoke the code', 'Record the finding RESOLVED']);
    expect(decisionSummary(steps)).toBe('Finding RESOLVED · piece COUNTERFEIT FLAGGED · code revoked.');
    expect(decisionSteps({ status: 'ACKNOWLEDGED' }, offer).map((s) => s.key)).toEqual(['status:ACKNOWLEDGED']);
    // A box the offer does not hold is ignored (a stale form never acts beyond what the role may do).
    expect(decisionSteps({ status: 'RESOLVED', note: 'x', [REVOKE_FIELD]: 'true' }, decisionOffer(context(), 'OPERATOR', triageMoves('OPEN'))).map((s) => s.kind)).toEqual(['status']);
  });

  it('checks the decision: a note to close, one mark at a time, and acting on the piece resolves', () => {
    const moves = triageMoves('OPEN');
    const offer = decisionOffer(context(), 'ADMIN', moves);
    expect(decisionError({ status: 'RESOLVED', note: ' ' }, offer, moves)).toMatch(/note/);
    expect(decisionError({ status: 'RESOLVED', note: 'x', [MARK_FIELDS.COUNTERFEIT_FLAGGED]: 'true', [MARK_FIELDS.STOLEN]: 'true' }, offer, moves)).toMatch(/not both/);
    expect(decisionError({ status: 'ACKNOWLEDGED', [REVOKE_FIELD]: 'true' }, offer, moves)).toMatch(/choose Resolve/);
    expect(decisionError({ status: 'RESOLVED', note: 'x', [MARK_FIELDS.STOLEN]: 'true', [REVOKE_FIELD]: 'true' }, offer, moves)).toBeNull();
    expect(decisionError({ status: 'ACKNOWLEDGED' }, offer, moves)).toBeNull();
    // Revoking the code asks for the product page's typed phrase.
    expect(decisionPhrase({ status: 'RESOLVED', [REVOKE_FIELD]: 'true' }, offer)).toBe(confirmationPhrase('revoke-code', 1));
    expect(decisionPhrase({ status: 'RESOLVED', [MARK_FIELDS.STOLEN]: 'true' }, offer)).toBeNull();
  });

  it('keeps a mark or a revocation already done in the decision when it is retried after a partial failure', () => {
    const moves = triageMoves('OPEN');
    const offer = decisionOffer(context(), 'ADMIN', moves);
    // First attempt: the mark is set, the revocation fails (a 503, say).
    const first = { status: 'RESOLVED', note: 'Seized in Lyon', [MARK_FIELDS.COUNTERFEIT_FLAGGED]: 'true', [REVOKE_FIELD]: 'true' };
    const done = new Set(decisionSteps(first, offer).slice(0, 1).map((s) => s.key));
    expect([...done]).toEqual(['mark:COUNTERFEIT_FLAGGED']);
    // The retry with both boxes unticked and Dismiss: refused, the piece is already marked and that resolves the finding.
    const retry = { status: 'DISMISSED', note: 'A false alarm after all' };
    expect(decisionError(retry, offer, moves, done)).toBe('The piece was already marked or its code revoked by this decision: it resolves the finding. Choose Resolve.');
    // Without the earlier attempt the same values would be a plain dismissal.
    expect(decisionError(retry, offer, moves)).toBeNull();
    // A second, different mark is still one too many.
    expect(decisionError({ status: 'RESOLVED', note: 'x', [MARK_FIELDS.STOLEN]: 'true' }, offer, moves, done)).toMatch(/not both/);
    // Resolving: the done mark stays a step (skipped when run), so the summary names it, ticked or not.
    const resolved = decisionSteps({ status: 'RESOLVED', note: 'Seized in Lyon' }, offer, done);
    expect(resolved.map((s) => s.key)).toEqual(['mark:COUNTERFEIT_FLAGGED', 'status:RESOLVED']);
    expect(decisionSummary(resolved)).toBe('Finding RESOLVED · piece COUNTERFEIT FLAGGED.');
    // Nothing done needs confirming again: the retry is not destructive unless it still revokes.
    expect(decisionDanger({ status: 'RESOLVED', note: 'x', [MARK_FIELDS.COUNTERFEIT_FLAGGED]: 'true' }, offer, done)).toBe(false);
    expect(decisionDanger({ status: 'RESOLVED', note: 'x', [REVOKE_FIELD]: 'true' }, offer, done)).toBe(true);
    // Once the revocation is done too, its typed phrase is no longer asked.
    const both = new Set([...done, `revoke:${CODE}`]);
    expect(decisionPhrase({ status: 'RESOLVED', [REVOKE_FIELD]: 'true' }, offer, done)).toBe(confirmationPhrase('revoke-code', 1));
    expect(decisionPhrase({ status: 'RESOLVED', [REVOKE_FIELD]: 'true' }, offer, both)).toBeNull();
    expect(decisionSummary(decisionSteps({ status: 'RESOLVED', note: 'x' }, offer, both))).toBe('Finding RESOLVED · piece COUNTERFEIT FLAGGED · code revoked.');
  });

  it('marks the dialog destructive when it revokes the code or flags the piece COUNTERFEIT, as the product page does', () => {
    const offer = decisionOffer(context(), 'ADMIN', triageMoves('OPEN'));
    expect(decisionDanger({ status: 'RESOLVED' }, offer)).toBe(false);
    expect(decisionDanger({ status: 'RESOLVED', [MARK_FIELDS.STOLEN]: 'true' }, offer)).toBe(false);
    expect(decisionDanger({ status: 'RESOLVED', [MARK_FIELDS.COUNTERFEIT_FLAGGED]: 'true' }, offer)).toBe(true);
    expect(decisionDanger({ status: 'RESOLVED', [REVOKE_FIELD]: 'true' }, offer)).toBe(true);
    // A box the offer does not hold (OPERATOR: no revocation) changes nothing.
    expect(decisionDanger({ status: 'RESOLVED', [REVOKE_FIELD]: 'true' }, decisionOffer(context(), 'OPERATOR', triageMoves('OPEN')))).toBe(false);
  });

  it('cites the finding in every reason, within each route limit', () => {
    const a = context().anomaly;
    expect(decisionReason(a, ' Seized in Lyon ', REASON_MAX.transition)).toBe(`Anomaly ${ID} (IMPOSSIBLE TRAVEL): Seized in Lyon`);
    expect(decisionReason(a, undefined, REASON_MAX.revoke)).toBe(`Anomaly ${ID} (IMPOSSIBLE TRAVEL)`);
    const long = decisionReason(a, 'x'.repeat(2000), REASON_MAX.revoke);
    expect(long).toHaveLength(500);
    expect(long.startsWith(`Anomaly ${ID}`)).toBe(true);
    expect(REASON_MAX).toEqual({ transition: 1000, revoke: 500 });
  });
});

describe('anomaly badge refresh', () => {
  class FakeDoc implements VisibilitySource {
    hidden = false;
    private readonly listeners = new Set<() => void>();
    addEventListener(_type: 'visibilitychange', fn: () => void): void {
      this.listeners.add(fn);
    }
    removeEventListener(_type: 'visibilitychange', fn: () => void): void {
      this.listeners.delete(fn);
    }
    show(hidden: boolean): void {
      this.hidden = hidden;
      for (const fn of this.listeners) fn();
    }
    get watched(): number {
      return this.listeners.size;
    }
  }
  afterEach(() => vi.useRealTimers());

  it('asks at once, then every minute while the tab is visible; a hidden tab stops asking until shown again', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    let count = 3;
    const load = vi.fn(async () => count);
    const shown: number[] = [];
    const poll = startAttentionPoll({ load, apply: (n) => shown.push(n), doc });
    expect(ATTENTION_INTERVAL_MS).toBe(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shown).toEqual([3]);
    count = 4;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown).toEqual([3, 4]);

    doc.show(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(load).toHaveBeenCalledTimes(2);
    count = 1;
    doc.show(false); // shown again: asks at once, then every minute
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([3, 4, 1]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(4);

    // A navigation asks now.
    await poll.refresh();
    expect(load).toHaveBeenCalledTimes(5);
    poll.stop();
    expect(doc.watched).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('keeps the last count when a request fails, and applies only the latest answer', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    const answers: { resolve: (n: number) => void; reject: (e: Error) => void }[] = [];
    const shown: number[] = [];
    const poll = startAttentionPoll({ load: () => new Promise<number>((resolve, reject) => answers.push({ resolve, reject })), apply: (n) => shown.push(n), doc });
    void poll.refresh();
    answers[1].resolve(2); // the newer answer first
    answers[0].resolve(7); // a slow, older one never overwrites it
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([2]);
    void poll.refresh();
    answers[2].reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([2]);
    poll.stop();
  });

  it('never ends the session: a 401 stops the refresh and tells the console, which keeps the page', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    const load = vi.fn(async (): Promise<number> => {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
    });
    const ended = vi.fn();
    const shown: number[] = [];
    startAttentionPoll({ load, apply: (n) => shown.push(n), onEnded: ended, doc });
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(doc.watched).toBe(0);
    // Nothing more is asked: not every minute, not when the tab is shown again.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    doc.show(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shown).toEqual([]);
  });

  it('takes the count a view has just read, without asking at once, and newer than an answer on its way', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    const answers: ((n: number) => void)[] = [];
    const load = vi.fn(() => new Promise<number>((resolve) => answers.push(resolve)));
    const shown: number[] = [];
    const poll = startAttentionPoll({ load, apply: (n) => shown.push(n), immediate: false, doc });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).not.toHaveBeenCalled();
    poll.set(5);
    expect(shown).toEqual([5]);
    await vi.advanceTimersByTimeAsync(60_000); // the minute's request, slow to answer
    poll.set(4); // the view reads a newer count meanwhile
    answers[0](9);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([5, 4]);
    poll.stop();
    poll.set(1);
    expect(shown).toEqual([5, 4]);
  });
});

// ── Analytics (A-09) ───────────────────────────────────────────────────────

function analyticsData(): AnalyticsData {
  const zero = () => Object.fromEntries(web.VERIFICATION_STATES.map((st) => [st, 0])) as Record<VerificationState, number>;
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
  const daily = days.map((day) => ({ day, total: 0, byState: zero() }));
  daily[1].byState.AUTHENTIC = 6;
  daily[1].byState.INVALID_SIGNATURE = 2;
  daily[1].total = 8;
  daily[3].byState.AUTHENTIC = 3;
  daily[3].byState.SUSPICIOUS_ACTIVITY = 1;
  daily[3].byState.UNKNOWN = 1;
  daily[3].total = 5;
  const byState = zero();
  for (const d of daily) for (const st of web.VERIFICATION_STATES) byState[st] += d.byState[st];
  const country = (code: string, states: Partial<Record<VerificationState, number>>) => {
    const b = { ...zero(), ...states };
    const total = Object.values(b).reduce((a, n) => a + n, 0);
    const signals = web.SIGNAL_STATES.reduce((a, st) => a + b[st], 0);
    return { country: code, total, signals, byState: b };
  };
  return {
    from: days[0],
    to: days[3],
    days: 4,
    through: days[3],
    total: 13,
    byState,
    byEventType: { VERIFY: 13, REGISTER: 0, TRANSFER: 0 },
    signals: { INVALID_SIGNATURE: 2, UNKNOWN: 1, MALFORMED_CODE: 0, SUSPICIOUS_ACTIVITY: 1, total: 4 },
    daily,
    countries: [country('FR', { AUTHENTIC: 7, SUSPICIOUS_ACTIVITY: 1 }), country('CN', { INVALID_SIGNATURE: 2 }), country('GB', { AUTHENTIC: 2 }), country('ZZ', { UNKNOWN: 1 })],
  };
}

describe('analytics view model', () => {
  it('offers 30 and 90 days, 90 by default, within the server bound', () => {
    expect([...ANALYTICS_RANGES]).toEqual([30, 90]);
    expect(Math.max(...ANALYTICS_RANGES)).toBeLessThanOrEqual(ANALYTICS_MAX_DAYS);
    expect(analyticsRange({ days: '30' })).toBe(30);
    expect(analyticsRange({ days: '90' })).toBe(90);
    for (const days of [undefined, '', '7', '366', 'abc']) expect(analyticsRange({ days }), String(days)).toBe(90);
  });

  it('names countries in English, the unknown location as such', () => {
    expect(countryName('FR')).toBe('France');
    expect(countryName('ZZ')).toBe('Unknown');
    expect(countryLabel('JP')).toBe('JP · Japan');
    expect(countryLabel('ZZ')).toBe('Unknown location');
  });

  it('states the four figures; an invalid signature turns the signals red', () => {
    const d = analyticsData();
    expect(analyticsKpis(d).map((k) => [k.label, k.value, k.note, k.tone])).toEqual([
      ['Scans', '13', 'IN 4 DAYS', 'solid'],
      ['Authentic', '9', '69% OF SCANS', 'solid'],
      ['Counterfeit signals', '4', '2 INVALID SIGNATURES', 'critical'],
      ['Countries', '3', 'MOST SCANS: FRANCE', 'solid'],
    ]);
    const quiet = { ...d, signals: { ...d.signals, INVALID_SIGNATURE: 0, total: 2 }, countries: d.countries.filter((c) => c.country !== 'CN') };
    expect(analyticsKpis(quiet)[2]).toMatchObject({ note: 'IN 2 COUNTRIES', tone: 'solid' });
    expect(analyticsKpis({ ...quiet, signals: { ...quiet.signals, UNKNOWN: 0, SUSPICIOUS_ACTIVITY: 0, total: 0 }, countries: [] })[2]).toMatchObject({ value: '0', note: 'NONE' });
    expect(analyticsLead(d)).toBe(
      "Complete days from 28 SEP 2026 to 01 OCT 2026, in UTC. Today's scans are counted after midnight UTC; staff scans never are. The counts stay after the scan history is purged.",
    );
    // Counted only up to an earlier day (a housekeeping pass failed): the days after it are said to be uncounted, not empty.
    expect(analyticsLead({ ...d, through: '2026-09-29' })).toBe(
      "Counted through 29 SEP 2026 only: the days after it are not counted yet and read 0. Complete days from 28 SEP 2026 to 01 OCT 2026, in UTC. Today's scans are counted after midnight UTC; staff scans never are. The counts stay after the scan history is purged.",
    );
    // A window that ends before the last counted day is whole.
    expect(analyticsLead({ ...d, through: '2026-10-05' })).not.toMatch(/Counted through/);
  });

  it('draws the curve against a 1, 2 or 5 ceiling, in fractions of the plot', () => {
    expect([0, 1, 3, 7, 10, 11, 260].map(niceMax)).toEqual([1, 1, 5, 10, 10, 20, 500]);
    // The half is labelled only when it is a whole number of scans.
    expect(axisLevels(10)).toEqual([
      { value: 10, y: 1 },
      { value: 5, y: 0.5 },
      { value: 0, y: 0 },
    ]);
    expect(axisLevels(5).map((l) => l.value)).toEqual([5, 0]);
    expect(axisLevels(1).map((l) => l.value)).toEqual([1, 0]);
    expect(axisLevels(2).map((l) => l.value)).toEqual([2, 1, 0]);
    const points = curve([0, 5, 10], 10);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]);
    expect(svgPoints(points, 1000, 200)).toBe('0,200 500,100 1000,0');
    expect(curve([3], 5)).toEqual([{ x: 0.5, y: 0.6 }]);
    expect(svgPoints(curve([1, 2, 0], 3), 1000, 40)).toBe('0,26.67 500,13.33 1000,40');
  });

  it('labels five days along the axis, the first and the last among them, and reads the nearest day', () => {
    const ninety = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 6, 4) + i * 86_400_000).toISOString().slice(0, 10));
    const ticks = dayTicks(ninety);
    expect(ticks.map((t) => t.label)).toEqual(['04 JUL', '26 JUL', '18 AUG', '09 SEP', '01 OCT']);
    expect(ticks[0]).toMatchObject({ index: 0, x: 0 });
    expect(ticks.at(-1)).toMatchObject({ index: 89, x: 1 });
    expect(dayTicks(ninety.slice(0, 3)).map((t) => t.index)).toEqual([0, 1, 2]);
    expect(dayTicks(['2026-10-01'])).toEqual([{ index: 0, x: 0.5, label: '01 OCT' }]);
    expect(dayTicks([])).toEqual([]);
    expect([nearestDay(0, 90), nearestDay(0.5, 90), nearestDay(1, 90), nearestDay(-1, 90), nearestDay(2, 90), nearestDay(0.7, 1)]).toEqual([0, 45, 89, 0, 89, 0]);
  });

  it("opens the day's readout where the plot has room, never past its edges, and clear of the day's point", () => {
    const desktop = { width: 1000, height: 200 };
    const phone = { width: 316, height: 200 };
    const box = { width: 250, height: 100 };
    // Beside the cursor: on the right while it fits, then on the left.
    expect(readoutPlacement({ x: 0.5, y: 1 }, box, desktop)).toEqual({ dx: 16, low: false });
    expect(readoutPlacement({ x: 0.9, y: 1 }, box, desktop)).toEqual({ dx: -266, low: false });
    expect(readoutPlacement({ x: 0, y: 0 }, box, phone)).toEqual({ dx: 16, low: false });
    expect(readoutPlacement({ x: 1, y: 0 }, box, phone)).toEqual({ dx: -266, low: false });
    // A phone, a day near the middle (37 % to 50 % of the window overflowed by up to 40 px before): over the cursor, inside the plot.
    for (const x of [0.37, 0.45, 0.5, 0.6]) {
      const { dx } = readoutPlacement({ x, y: 0 }, box, phone);
      const left = x * phone.width + dx;
      expect(left, String(x)).toBeGreaterThanOrEqual(0);
      expect(left + box.width, String(x)).toBeLessThanOrEqual(phone.width);
    }
    expect(readoutPlacement({ x: 0.5, y: 0 }, box, phone)).toEqual({ dx: -125, low: false });
    // Over the cursor, at the foot of the plot when the readout at its top would cover the point.
    expect(readoutPlacement({ x: 0.5, y: 1 }, box, phone).low).toBe(true);
    expect(readoutPlacement({ x: 0.5, y: 0.55 }, box, phone).low).toBe(true);
    expect(readoutPlacement({ x: 0.5, y: 0.4 }, box, phone).low).toBe(false);
    // Covered either way: the side away from the point.
    expect(readoutPlacement({ x: 0.5, y: 0.5 }, { width: 250, height: 180 }, phone).low).toBe(false);
    expect(readoutPlacement({ x: 0.5, y: 0.6 }, { width: 250, height: 180 }, phone).low).toBe(true);
    // Wider than the plot: its right edge on the plot's, the overflow on the side of the axis labels.
    expect(readoutPlacement({ x: 0.5, y: 0 }, { width: 400, height: 100 }, phone)).toEqual({ dx: -242, low: false });
  });

  it('reads a day: its count first, then each state seen that day', () => {
    const d = analyticsData();
    expect(dayReadout(d, 1)).toEqual({
      day: '29 SEP 2026',
      total: '8 SCANS',
      lines: [
        { label: 'AUTHENTIC', value: '6', tone: 'solid' },
        { label: 'INVALID SIGNATURE', value: '2', tone: 'critical' },
      ],
    });
    expect(dayReadout(d, 0)).toEqual({ day: '28 SEP 2026', total: '0 SCANS', lines: [] });
    expect(dayReadout(d, 9).total).toBe('—');
  });

  it('gives every state its row: curve, total, share, busiest day and a link to its scans', () => {
    const rows = stateRows(analyticsData());
    expect(rows.map((r) => r.state)).toEqual([...web.VERIFICATION_STATES]);
    const invalid = rows.find((r) => r.state === 'INVALID_SIGNATURE')!;
    expect(invalid).toMatchObject({ label: 'INVALID SIGNATURE', tone: 'critical', total: 2, share: '15%', values: [0, 2, 0, 0], peak: '2 ON 29 SEP 2026' });
    // The window's days as instants, the last day whole: the scans view reads it 00:00:00 → 23:59:59 UTC.
    expect(invalid.link).toBe('#/scans?state=INVALID_SIGNATURE&from=2026-09-28T00%3A00%3A00.000Z&to=2026-10-01T23%3A59%3A59.999Z');
    expect(rows.find((r) => r.state === 'REVOKED')).toMatchObject({ total: 0, share: '0%', peak: '' });
    expect(rows.find((r) => r.state === 'MALFORMED_CODE')!.tone).toBe('muted');
  });

  it('ranks the countries by scans, and the countries of the signals by signals, red where a signature failed', () => {
    const d = analyticsData();
    expect(countryBars(d).map((b) => [b.label, b.value, b.fraction, b.share, b.tone])).toEqual([
      ['FR · France', 8, 1, '62%', 'solid'],
      ['CN · China', 2, 0.25, '15%', 'solid'],
      ['GB · United Kingdom', 2, 0.25, '15%', 'solid'],
      ['Unknown location', 1, 0.125, '8%', 'solid'],
    ]);
    expect(countryBars(d, 2)).toHaveLength(2);
    expect(signalCountries(d).map((c) => c.country)).toEqual(['CN', 'FR', 'ZZ']);
    expect(signalBars(d).map((b) => [b.key, b.value, b.fraction, b.share, b.tone])).toEqual([
      ['CN', 2, 1, '50%', 'critical'],
      ['FR', 1, 0.5, '25%', 'solid'],
      ['ZZ', 1, 0.5, '25%', 'solid'],
    ]);
  });
});
