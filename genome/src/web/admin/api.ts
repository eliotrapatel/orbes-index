/**
 * Admin API client (PLATFORM-CONTRACTS §3, admin routes).
 *
 * - Same-origin fetch with the `orbes_admin` httpOnly cookie; the console
 *   never sees the session token itself.
 * - Every unsafe request carries `x-csrf-token`, taken from login or
 *   GET /api/admin/auth/me. If the server answers CSRF_FAILED (the token
 *   rotated, e.g. after a login in another tab) the token is refreshed once
 *   and the request retried: the CSRF guard runs before any handler, so the
 *   first attempt cannot have had an effect.
 * - Errors are always `ApiError(status, code, message)`; the message is the
 *   server's public message (never a stack trace).
 * - A 401 ends the session through `onUnauthorized`, except for a request
 *   made in the background (the Anomalies badge's refresh): a timer never
 *   decides what happens to the page on screen; the admin's next action does.
 * - Artifacts are attachments: they are fetched as blobs and saved by the UI.
 */
import type {
  Guarantee,
  GuaranteeChange,
  GuaranteeGrant,
  GuaranteeInput,
  GuaranteeSettings,
  ReleaseGuarantee,
  AdminProfile,
  BestTime,
  LiveFeasibility,
  LiveSizeMix,
  Carrier,
  HeardOptionView,
  LinkAttribution,
  LinkChannelView,
  LinkDestinations,
  LinkFigureCollectors,
  LinkInput,
  LinkMeasure,
  LinkReport,
  LinksReport,
  LinksView,
  LinkView,
  InvoiceFilters,
  InvoiceList,
  OrderAlertDelays,
  OrderAlertSettings,
  OrderBoard,
  OrderBoardFilters,
  OrderDetail,
  OrderCaseDecided,
  OrderCaseRecord,
  OrderCaseReason,
  OrderTermsChange,
  OrderTransitionInput,
  StockLocation,
  AdminSession,
  AdminSessionInfo,
  AdminUser,
  AnalyticsData,
  GrowthCollectors,
  GrowthRelease,
  GrowthReport,
  StaffDocument,
  StaffDocumentSummary,
  AnomalyContext,
  AnomalyFilters,
  AnomalyRecord,
  AnomalyStatus,
  AnomalySummary,
  ArtifactFormat,
  ArtifactTheme,
  AuditEntry,
  CaseRecord,
  Category,
  ChainVerification,
  CodeFilters,
  CodeIds,
  CodeJson,
  Collection,
  CircleAnswer,
  CirclePost,
  CirclePostChange,
  CirclePostInput,
  CircleRsvpAnswer,
  CircleStats,
  ClubProgram,
  ClubProgramSheet,
  ClubTierName,
  ClubTierSheet,
  DashboardData,
  DrawOutcome,
  Drop,
  DropChange,
  DropEntry,
  DropEntryStatus,
  DropInput,
  LiveAudienceForecast,
  LiveBoard,
  LiveBotRadar,
  LiveCard,
  LiveCollectorInsights,
  LiveDemandRadar,
  LiveEntry,
  LiveEntryStatus,
  LiveRelease,
  LiveReleaseComparison,
  LiveReleasePlan,
  LiveReleaseReport,
  LiveSettings,
  LiveSettingsChange,
  LiveState,
  GenomeJson,
  IssueBatchItem,
  IssueBatchResponse,
  IssueBatchTemplate,
  IssueInput,
  IssueResponse,
  IssuedCodeJson,
  ClaimRenewal,
  ClaimSituation,
  Items,
  StockLevel,
  KeyJson,
  LifecycleSnapshot,
  Model,
  ModelChange,
  ModelSizeRemoved,
  ModelSizes,
  ModelSizesChange,
  ModelSupplierChange,
  Supplier,
  SupplierInput,
  SupplierDraftChange,
  SupplierOrderDetail,
  SupplierOrderListItem,
  SupplierOrderProposal,
  SupplierOrderStatus,
  CaseToReceive,
  LogisticsStock,
  ParcelsBoard,
  ReceptionInput,
  ReceptionOrder,
  ReceptionsBoard,
  ReceptionView,
  SupplierReturnItem,
  PackingScan,
  ShippingOrderView,
  StockCorrection,
  StockCorrections,
  StockCorrectionStatus,
  SizeType,
  VariantInput,
  OwnerList,
  ShippingRate,
  ShippingRatesSheet,
  EngravingPricesSheet,
  HouseCurrency,
  ShopifyLink,
  ShopifyProduct,
  OwnerLock,
  ShopRequest,
  ShopRequestOutcome,
  ClientConversationStatus,
  Conversation,
  CareRequestStatus,
  CareRow,
  CareSheet,
  ConversationPage,
  MessagesSummary,
  ShopRequestStatus,
  OwnerSheet,
  ClientProfile,
  ClientProfileInput,
  PrivateNote,
  PrivateNotes,
  TagSuggestion,
  OwnerIntelligence,
  Paged,
  RecoveryCode,
  ProductDetail,
  ProductPhoto,
  ProductOverview,
  ProductStatus,
  Retailer,
  RevocationRecord,
  RevocationTargetType,
  SaleActivation,
  SaleLookup,
  ScanRecord,
  ServiceRecord,
  ServiceType,
  StaffCreated,
  StaffRole,
  StatusChange,
  TotpEnrollment,
  WarrantyRecord,
  Segment,
  SegmentGroup,
  SegmentName,
  SegmentOptions,
  ActiveTestRun,
  SystemStatus,
  TestRunAddInput,
  TestRunInput,
  TestRunSummary,
  TestRunView,
} from './types.js';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  fetch?: FetchLike;
  /** Prefix for every path (tests); default '' (same origin). */
  base?: string;
  /** Called when an authenticated request answers 401 (session expired or logged out elsewhere). */
  onUnauthorized?: () => void;
  timeoutMs?: number;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

/** `?a=1&b=x` from defined, non-empty values; '' when nothing is left. */
export function buildQuery(q: Query | undefined): string {
  if (!q) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** File name from a Content-Disposition header, restricted to safe characters. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  let name = '';
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      name = '';
    }
  }
  if (!name && plain) name = (plain[1] ?? plain[2] ?? '').trim();
  // Never let a header pick a path or hidden file on the operator's disk.
  name = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return name.slice(0, 120) || fallback;
}

const SAFE = new Set(['GET', 'HEAD']);
const NO_SESSION_PATHS = ['/api/admin/auth/login', '/api/admin/auth/me'];

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** A body that is not JSON: a photograph sent as itself (F-04), with its own Content-Type. */
  upload?: { type: string; data: Blob };
  /** Return the raw Response (artifacts). */
  raw?: boolean;
  /** Made by a timer, not by the admin: a 401 is thrown to the caller without calling `onUnauthorized`. */
  background?: boolean;
}

export interface ArtifactOptions {
  widthMm?: number;
  theme?: ArtifactTheme;
  decor?: boolean;
  label?: boolean;
  dpi?: number;
  /** PDF only: K-only black for print shops. */
  kOnly?: boolean;
}

export interface PrintSheetOptions {
  widthMm?: number;
  theme?: ArtifactTheme;
  decor?: boolean;
  label?: boolean;
  kOnly?: boolean;
  page?: 'A4' | 'A3' | 'LETTER';
  cropMarks?: boolean;
}

/** One certificate card: the claim code shown at issuance, sent back only to be printed. */
export interface CertificateItem {
  productId: string;
  claimCode: string;
}

export interface CertificateOptions {
  /** 'pdf' (default) or 'csv' (variable-data file for a print shop). */
  format?: 'pdf' | 'csv';
  /** PDF only: 'card' (default, 95 × 62 mm pages) or 'sheet' (A4, eight cards). */
  layout?: 'card' | 'sheet';
}

export interface Download {
  blob: Blob;
  filename: string;
  contentType: string;
}

export class AdminApi {
  private csrf: string | null = null;
  private readonly fetchFn: FetchLike;
  private readonly base: string;
  private readonly timeoutMs: number;
  onUnauthorized: (() => void) | undefined;

  constructor(opts: ApiOptions = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.base = opts.base ?? '';
    this.onUnauthorized = opts.onUnauthorized;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  get csrfToken(): string | null {
    return this.csrf;
  }

  setCsrf(token: string | null): void {
    this.csrf = token;
  }

  // ── Transport ────────────────────────────────────────────────────────────

  async request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
    const m = method.toUpperCase();
    const headers: Record<string, string> = { accept: opts.raw ? '*/*' : 'application/json' };
    let body: string | Blob | undefined;
    if (opts.upload) {
      headers['content-type'] = opts.upload.type;
      body = opts.upload.data;
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (!SAFE.has(m) && this.csrf) headers['x-csrf-token'] = this.csrf;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path + buildQuery(opts.query), {
        method: m,
        headers,
        body,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new ApiError(0, aborted ? 'TIMEOUT' : 'NETWORK', aborted ? 'The server took too long to answer.' : 'The console could not reach the server.');
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (res.ok) {
      if (opts.raw) return res as unknown as T;
      if (res.status === 204) return undefined as T;
      try {
        return (await res.json()) as T;
      } catch {
        throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent an unreadable response.');
      }
    }

    const err = await toApiError(res);
    const pathOnly = path.split('?')[0];
    if (err.status === 403 && err.code === 'CSRF_FAILED' && !retried && !NO_SESSION_PATHS.includes(pathOnly)) {
      await this.me();
      return this.request<T>(method, path, opts, true);
    }
    if (err.status === 401 && !NO_SESSION_PATHS.includes(pathOnly)) {
      this.csrf = null;
      if (!opts.background) this.onUnauthorized?.();
    }
    throw err;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body: body ?? {} });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string, totp?: string): Promise<AdminSession> {
    const s = await this.request<AdminSession>('POST', '/api/admin/auth/login', {
      body: { email, password, ...(totp ? { totp } : {}) },
    });
    this.csrf = s.csrfToken;
    return s;
  }

  async me(): Promise<AdminSession> {
    const s = await this.get<AdminSession>('/api/admin/auth/me');
    this.csrf = s.csrfToken;
    return s;
  }

  async logout(): Promise<void> {
    try {
      await this.post('/api/admin/auth/logout');
    } finally {
      this.csrf = null;
    }
  }

  totpSetup(): Promise<TotpEnrollment> {
    return this.post('/api/admin/auth/totp/setup');
  }

  /** Change the signed-in admin's own password; this session stays, every other one ends. */
  changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true; admin: AdminProfile }> {
    return this.post('/api/admin/auth/password', { currentPassword, newPassword });
  }

  /** Enrol TOTP. The server replaces the session by a new, MFA-passed one: keep its CSRF token. */
  async totpEnable(secret: string, code: string): Promise<{ ok: true; mfaPassed: true; csrfToken: string }> {
    const r = await this.post<{ ok: true; mfaPassed: true; csrfToken: string }>('/api/admin/auth/totp/enable', { secret, code });
    if (typeof r?.csrfToken === 'string' && r.csrfToken) this.csrf = r.csrfToken;
    return r;
  }

  // ── Console users (ADMIN) ────────────────────────────────────────────────

  admins(): Promise<Items<AdminUser>> {
    return this.get('/api/admin/admins');
  }

  resetAdminTotp(adminId: string): Promise<{ admin: AdminProfile }> {
    return this.post(`/api/admin/admins/${encodeURIComponent(adminId)}/totp/reset`);
  }

  /** A staff account (OPERATOR, AUDITOR, RETAIL, or LOGISTICS with its locations) with a temporary password, returned once. */
  createStaff(email: string, role: StaffRole, stockLocationIds?: readonly string[]): Promise<StaffCreated> {
    return this.post('/api/admin/admins', { email, role, ...(role === 'LOGISTICS' ? { stockLocationIds } : {}) });
  }

  /** A role changed; LOGISTICS with its locations (also how a LOGISTICS login's locations change). */
  setAdminRole(adminId: string, role: StaffRole, stockLocationIds?: readonly string[]): Promise<{ admin: AdminUser }> {
    return this.patch(`/api/admin/admins/${encodeURIComponent(adminId)}/role`, { role, ...(role === 'LOGISTICS' ? { stockLocationIds } : {}) });
  }

  disableAdmin(adminId: string): Promise<{ admin: AdminUser; sessionsRevoked: number }> {
    return this.post(`/api/admin/admins/${encodeURIComponent(adminId)}/disable`);
  }

  enableAdmin(adminId: string): Promise<{ admin: AdminUser; sessionsRevoked: number }> {
    return this.post(`/api/admin/admins/${encodeURIComponent(adminId)}/enable`);
  }

  unlockAdmin(adminId: string): Promise<{ admin: AdminUser }> {
    return this.post(`/api/admin/admins/${encodeURIComponent(adminId)}/unlock`);
  }

  adminSessions(adminId: string): Promise<Items<AdminSessionInfo>> {
    return this.get(`/api/admin/admins/${encodeURIComponent(adminId)}/sessions`);
  }

  revokeAdminSessions(adminId: string): Promise<{ sessionsRevoked: number }> {
    return this.del(`/api/admin/admins/${encodeURIComponent(adminId)}/sessions`);
  }

  // ── Dashboard & catalogue ────────────────────────────────────────────────

  dashboard(): Promise<DashboardData> {
    return this.get('/api/admin/dashboard');
  }

  /** Daily scan statistics: the `days` complete days to yesterday (UTC), or the days `from` to `to` (at most 366). */
  documents(): Promise<{ documents: StaffDocumentSummary[] }> {
    return this.get('/api/admin/documents');
  }

  document(id: string): Promise<StaffDocument> {
    return this.get(`/api/admin/documents/${encodeURIComponent(id)}`);
  }

  analytics(q: { days?: number; from?: string; to?: string } = {}): Promise<AnalyticsData> {
    return this.get('/api/admin/analytics', q);
  }

  /** The best time to open (plan LIVE RELEASE+, choice 10): a tier and above, everywhere or in one country, over `days`. */
  bestTime(q: { days?: number; tier?: number; country?: string } = {}): Promise<BestTime> {
    return this.get('/api/admin/analytics/best-time', q);
  }

  /** The panel The Circle (P-X01): the members of the club by tier now, the visits of the same window by day. */
  circleStats(q: { days?: number; from?: string; to?: string } = {}): Promise<CircleStats> {
    return this.get('/api/admin/analytics/circle', q);
  }

  /** GROWTH (plan NEXT-NINE, BP-29): the report of the last 12 or 24 months, in one currency. */
  growth(q: { months?: number; currency?: string } = {}): Promise<GrowthReport> {
    return this.get('/api/admin/growth', q);
  }

  /** COLLECTORS BY VALUE: a page of 25, the highest value first; the emails masked for an AUDITOR by the server. */
  growthCollectors(q: { currency?: string; page?: number } = {}): Promise<GrowthCollectors> {
    return this.get('/api/admin/growth/collectors', q);
  }

  /** GROWTH's Latest releases: the 6 latest past their opening. */
  growthReleases(): Promise<Items<GrowthRelease>> {
    return this.get('/api/admin/growth/releases');
  }

  categories(): Promise<Items<Category>> {
    return this.get('/api/admin/categories');
  }

  createCategory(input: { code: string; name: string; warrantyMonths?: number }): Promise<Category> {
    return this.post('/api/admin/categories', input);
  }

  collections(): Promise<Items<Collection>> {
    return this.get('/api/admin/collections');
  }

  createCollection(name: string): Promise<Collection> {
    return this.post('/api/admin/collections', { name });
  }

  renameCollection(id: string, name: string): Promise<Collection> {
    return this.patch(`/api/admin/collections/${encodeURIComponent(id)}`, { name });
  }

  /** ADMIN: a category stops (false) or starts again (true) receiving new products. */
  setCategoryActive(code: string, active: boolean): Promise<Category> {
    return this.post(`/api/admin/categories/${encodeURIComponent(code)}/active`, { active });
  }

  models(): Promise<Items<Model>> {
    return this.get('/api/admin/models');
  }

  createModel(input: {
    categoryCode: string;
    name: string;
    type: string;
    skuPrefix: string;
    collectionId?: string;
    defaultMaterial?: string;
    careInstructions?: string;
    /** Plan NEXT LOT §3.3: required since H1. */
    sizeType: SizeType;
  }): Promise<Model> {
    return this.post('/api/admin/models', input);
  }

  /** One model, as the list has it (the Lookbook page, P-R02). */
  model(id: string): Promise<Model> {
    return this.get(`/api/admin/models/${encodeURIComponent(id)}`);
  }

  updateModel(id: string, change: ModelChange): Promise<Model> {
    return this.patch(`/api/admin/models/${encodeURIComponent(id)}`, change);
  }

  /** NOCTURNE N1, ADD A VARIANT: a variant of the model, copied from it, with its own label, colour and SKU prefix. */
  createVariant(id: string, input: VariantInput): Promise<Model> {
    return this.post(`/api/admin/models/${encodeURIComponent(id)}/variants`, input);
  }

  /** AC-01: a model's Sizes, its size kind and its sizes' fits (AUDITOR). */
  modelSizes(id: string): Promise<ModelSizes> {
    return this.get(`/api/admin/models/${encodeURIComponent(id)}/sizes`);
  }

  /** AC-01, OPERATOR: a model's size type or the sizes ticked (plan NEXT LOT §3.3), its size kind, or a size's fit (in whole millimetres). */
  setModelSizes(id: string, change: ModelSizesChange): Promise<ModelSizes> {
    return this.request('PUT', `/api/admin/models/${encodeURIComponent(id)}/sizes`, { body: change });
  }

  /** Plan NEXT LOT §3.3, OPERATOR: one size taken off a model: removed when nothing uses it, otherwise set aside. */
  removeModelSize(id: string, skuId: string): Promise<ModelSizeRemoved> {
    return this.post(`/api/admin/models/${encodeURIComponent(id)}/sizes/${encodeURIComponent(skuId)}/remove`, {});
  }

  /** Plan NEXT LOT §3.5.4.5, OPERATOR: a model's supplier and its sizes' own; answers its Sizes section. */
  setModelSupplier(id: string, change: ModelSupplierChange): Promise<ModelSizes> {
    return this.request('PUT', `/api/admin/models/${encodeURIComponent(id)}/supplier`, { body: change });
  }

  // ── Suppliers (plan NEXT LOT §3.5.6.2) ───────────────────────────────────

  /** AUDITOR: every supplier, by name. */
  suppliers(): Promise<Items<Supplier>> {
    return this.get('/api/admin/suppliers');
  }

  /** OPERATOR. */
  createSupplier(input: SupplierInput): Promise<Supplier> {
    return this.post('/api/admin/suppliers', input);
  }

  /** AUDITOR: the supplier orders, the newest first (`status`, `supplierId` to narrow). */
  supplierOrders(f: { status?: SupplierOrderStatus; supplierId?: string } = {}): Promise<Items<SupplierOrderListItem>> {
    return this.get('/api/admin/supplier-orders', { status: f.status, supplierId: f.supplierId });
  }

  /** AUDITOR: what is missing, per supplier and location (the orders waiting for stock, the stock under its minimum). */
  supplierOrderProposal(f: { locationId?: string; supplierId?: string } = {}): Promise<SupplierOrderProposal> {
    return this.get('/api/admin/supplier-orders/proposal', { locationId: f.locationId, supplierId: f.supplierId });
  }

  /** OPERATOR: pieces of a size added to its supplier's draft to a location (the draft made when there is none). */
  addToSupplierDraft(input: { skuId: string; locationId: string; quantity: number; from?: 'PROPOSAL' | 'RELEASE' }): Promise<SupplierOrderDetail> {
    return this.post('/api/admin/supplier-orders/draft-lines', input);
  }

  /** AUDITOR: one supplier order, its lines, receptions, returns, invoice and history. */
  supplierOrder(id: string): Promise<SupplierOrderDetail> {
    return this.get(`/api/admin/supplier-orders/${encodeURIComponent(id)}`);
  }

  /** OPERATOR: a draft changed (its lines whole, currency, shipping, expected date, note). */
  updateSupplierDraft(id: string, change: SupplierDraftChange): Promise<SupplierOrderDetail> {
    return this.patch(`/api/admin/supplier-orders/${encodeURIComponent(id)}`, change);
  }

  /** OPERATOR: a draft deleted (it never left ORBES). */
  discardSupplierDraft(id: string): Promise<void> {
    return this.request('DELETE', `/api/admin/supplier-orders/${encodeURIComponent(id)}`, { body: {} });
  }

  /** OPERATOR: DRAFT → SENT; its lines and prices no longer change. */
  sendSupplierOrder(id: string): Promise<SupplierOrderDetail> {
    return this.post(`/api/admin/supplier-orders/${encodeURIComponent(id)}/send`, {});
  }

  /** OPERATOR: SENT → EXPECTED, the date the supplier confirmed. */
  supplierConfirmed(id: string, expectedOn: string | null): Promise<SupplierOrderDetail> {
    return this.post(`/api/admin/supplier-orders/${encodeURIComponent(id)}/supplier-confirmed`, expectedOn ? { expectedOn } : {});
  }

  /** OPERATOR: what has not arrived stops being expected. */
  cancelSupplierRest(id: string, note: string): Promise<SupplierOrderDetail> {
    return this.post(`/api/admin/supplier-orders/${encodeURIComponent(id)}/cancel-rest`, { note });
  }

  /** AUDITOR: the supplier order's PDF, ORBES-SO-7C21A0B9.pdf (ORBES sends it to the supplier itself). */
  async supplierOrderPdf(id: string): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/supplier-orders/${encodeURIComponent(id)}/pdf`, { raw: true });
    return toDownload(res, 'ORBES-supplier-order.pdf');
  }

  /** OPERATOR: the supplier's invoice (number, amount, date). */
  setSupplierInvoice(id: string, input: { number: string; amountMinor: number; date: string }): Promise<SupplierOrderDetail> {
    return this.request('PUT', `/api/admin/supplier-orders/${encodeURIComponent(id)}/invoice`, { body: input });
  }

  /** OPERATOR: ORBES has paid the supplier's invoice. */
  markSupplierInvoicePaid(id: string): Promise<SupplierOrderDetail> {
    return this.post(`/api/admin/supplier-orders/${encodeURIComponent(id)}/invoice/paid`, {});
  }

  /** OPERATOR: the supplier's answer to rejected pieces: a replacement, or a credit with its amount. */
  settleSupplierReturn(id: string, input: { settlement: 'REPLACEMENT' | 'CREDIT'; creditMinor?: number | null; note?: string | null }): Promise<SupplierOrderDetail> {
    return this.post(`/api/admin/supplier-returns/${encodeURIComponent(id)}/settle`, input);
  }

  /** OPERATOR: the fields given changed, or the supplier set inactive. */
  updateSupplier(id: string, change: SupplierInput): Promise<Supplier> {
    return this.patch(`/api/admin/suppliers/${encodeURIComponent(id)}`, change);
  }

  /** Plan NEXT LOT §3.3, OPERATOR: a set-aside size offered again. */
  reinstateModelSize(id: string, skuId: string): Promise<ModelSizes> {
    return this.post(`/api/admin/models/${encodeURIComponent(id)}/sizes/${encodeURIComponent(skuId)}/reinstate`, {});
  }

  /** BP-34, OPERATOR: the models a main model's sheet ends with (PAIRS WELL WITH), in their order: none, two or three. */
  setModelPairs(id: string, models: readonly string[]): Promise<Model> {
    return this.request('PUT', `/api/admin/models/${encodeURIComponent(id)}/pairs`, { body: { models } });
  }

  // ── Shopify readiness (plan LIVE RELEASE+, N2 and N3): files in Shopify's formats, nothing sent to it ──

  /** N2: the product CSV of the models priced in the store's currency. */
  async shopifyProductsCsv(currency: string): Promise<Download> {
    const res = await this.request<Response>('GET', '/api/admin/shopify/products.csv', { raw: true, query: { currency } });
    return toDownload(res, `ORBES-shopify-products-${currency}.csv`);
  }

  /** N2: a model's Shopify product, its sizes and their ids. */
  modelShopify(id: string): Promise<ShopifyProduct> {
    return this.get(`/api/admin/models/${encodeURIComponent(id)}/shopify`);
  }

  /** N2, OPERATOR: the product's and the variants' ids pasted back from Shopify. */
  linkModelShopify(id: string, link: ShopifyLink): Promise<ShopifyProduct> {
    return this.request('PUT', `/api/admin/models/${encodeURIComponent(id)}/shopify`, { body: link });
  }

  /** N3: the order CSV of the orders reserved from one day to another (UTC, both included); emails and buyers masked for an AUDITOR. */
  async shopifyOrdersCsv(from: string, to: string): Promise<Download> {
    const res = await this.request<Response>('GET', '/api/admin/shopify/orders.csv', { raw: true, query: { from, to } });
    return toDownload(res, `ORBES-shopify-orders-${from}-to-${to}.csv`);
  }

  /** P-R06, ADMIN: the model discontinued (inactive, said DISCONTINUED on its pieces' results). */
  discontinueModel(id: string): Promise<Model> {
    return this.post(`/api/admin/models/${encodeURIComponent(id)}/discontinue`, {});
  }

  /** P-R06, ADMIN: the discontinued model reinstated (active again). */
  reinstateModel(id: string): Promise<Model> {
    return this.post(`/api/admin/models/${encodeURIComponent(id)}/reinstate`, {});
  }

  /** A photograph for the gallery of the model's lookbook sheet (P-R02): the image itself, added last. */
  addGalleryImage(id: string, photo: Blob): Promise<Model> {
    return this.request('POST', `/api/admin/models/${encodeURIComponent(id)}/gallery`, { upload: { type: photo.type || 'image/jpeg', data: photo } });
  }

  removeGalleryImage(id: string, sha256: string): Promise<Model> {
    return this.del(`/api/admin/models/${encodeURIComponent(id)}/gallery/${encodeURIComponent(sha256)}`);
  }

  /** The gallery's order and alternative texts: every photograph once, in the new order ('' alt: the sheet's default). */
  arrangeGallery(id: string, images: { sha256: string; alt: string }[]): Promise<Model> {
    return this.patch(`/api/admin/models/${encodeURIComponent(id)}/gallery`, { images });
  }

  /** The model's reference photograph (F-04): the image itself (JPEG or WebP, ≤ 1 MiB), not JSON. */
  setModelImage(id: string, photo: Blob): Promise<Model> {
    return this.request('POST', `/api/admin/models/${encodeURIComponent(id)}/image`, { upload: { type: photo.type || 'image/jpeg', data: photo } });
  }

  removeModelImage(id: string): Promise<Model> {
    return this.del(`/api/admin/models/${encodeURIComponent(id)}/image`);
  }

  /** The photograph of one piece (F-04), offered at issuance and on the product page. */
  setProductPhoto(productId: string, photo: Blob): Promise<ProductPhoto> {
    return this.request('POST', `/api/admin/products/${encodeURIComponent(productId)}/photo`, { upload: { type: photo.type || 'image/jpeg', data: photo } });
  }

  removeProductPhoto(productId: string): Promise<ProductPhoto> {
    return this.del(`/api/admin/products/${encodeURIComponent(productId)}/photo`);
  }

  // ── Products ─────────────────────────────────────────────────────────────

  products(q: { status?: string; category?: string; q?: string; productionBatch?: string; page?: number; pageSize?: number } = {}): Promise<Paged<ProductOverview>> {
    return this.get('/api/admin/products', q);
  }

  product(productId: string): Promise<ProductDetail> {
    return this.get(`/api/admin/products/${encodeURIComponent(productId)}`);
  }

  issue(input: IssueInput): Promise<IssueResponse> {
    return this.post('/api/admin/products', input);
  }

  /** Up to 50 pieces sharing a template, one result each; pieces already signed stay signed whatever happens to the others. */
  issueBatch(template: IssueBatchTemplate, items: readonly IssueBatchItem[]): Promise<IssueBatchResponse> {
    return this.post('/api/admin/products/batch', { template, items: [...items] });
  }

  transition(productId: string, to: ProductStatus, reason?: string): Promise<{ statusChange: StatusChange; lifecycle: LifecycleSnapshot }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/transitions`, { to, ...(reason ? { reason } : {}) });
  }

  reinstate(productId: string, reason?: string): Promise<{ statusChange: StatusChange; lifecycle: LifecycleSnapshot }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/reinstate`, reason ? { reason } : {});
  }

  reissueCode(productId: string, reason: string): Promise<{ code: IssuedCodeJson }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/codes/reissue`, { reason });
  }

  /**
   * NEW CLAIM CODE (plan NEXT LOT §3.4): the situation the dialog showed and the newest new claim code it saw. A piece in
   * stock answers its code once (no-store); a sold piece's code goes to its buyer and never comes back here.
   */
  renewClaimCode(productId: string, input: { reason: string; expect: ClaimSituation; after: string | null }): Promise<ClaimRenewal> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/claim-code`, input);
  }

  /** `retailerId`: a point of sale of the register (the console never sends the free-text `retailer` any more). */
  activateWarranty(productId: string, input: { purchaseDate?: string; retailerId?: string; retailer?: string; country?: string }): Promise<{ warranty: WarrantyRecord }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/warranty/activate`, input);
  }

  extendWarranty(productId: string, months: number): Promise<{ warranty: WarrantyRecord }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/warranty/extend`, { months });
  }

  voidWarranty(productId: string, reason?: string): Promise<{ warranty: WarrantyRecord }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/warranty/void`, reason ? { reason } : {});
  }

  openService(productId: string, input: { type: ServiceType; location?: string; notes?: string; performedBy?: string }): Promise<{ service: ServiceRecord }> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/services`, input);
  }

  completeService(serviceId: string, notes?: string): Promise<{ service: ServiceRecord }> {
    return this.post(`/api/admin/services/${encodeURIComponent(serviceId)}/complete`, notes ? { notes } : {});
  }

  confirmOwnership(productId: string): Promise<unknown> {
    return this.post(`/api/admin/products/${encodeURIComponent(productId)}/ownership/confirm`);
  }

  // ── Codes & artifacts ────────────────────────────────────────────────────

  async artifact(codeId: string, format: ArtifactFormat, opts: ArtifactOptions = {}): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/codes/${encodeURIComponent(codeId)}/artifact.${format}`, {
      raw: true,
      query: {
        widthMm: opts.widthMm,
        theme: opts.theme,
        decor: opts.decor,
        label: opts.label,
        dpi: format === 'png' ? opts.dpi : undefined,
        kOnly: format === 'pdf' && opts.kOnly ? true : undefined,
      },
    });
    return toDownload(res, `orbes-code.${format}`);
  }

  /** One PDF of several codes with labels and crop marks (POST: it carries a list; audited per code). */
  async printSheet(codeIds: readonly string[], opts: PrintSheetOptions = {}): Promise<Download> {
    const res = await this.request<Response>('POST', '/api/admin/codes/print-sheet', { raw: true, body: { codeIds: [...codeIds], ...opts } });
    return toDownload(res, 'orbes-print-sheet.pdf');
  }

  /** The sheet's manifest (CSV): page, row and column of each code, in the order of the PDF made from the same request. */
  async printSheetManifest(codeIds: readonly string[], opts: PrintSheetOptions = {}): Promise<Download> {
    const res = await this.request<Response>('POST', '/api/admin/codes/print-sheet/manifest', { raw: true, body: { codeIds: [...codeIds], ...opts } });
    return toDownload(res, 'orbes-print-sheet-manifest.csv');
  }

  /**
   * Certificate cards carrying claim codes (POST: the codes travel in the body, never in a URL).
   * The server checks each code against its product's hash and audits product ids only.
   */
  async certificates(items: readonly CertificateItem[], opts: CertificateOptions = {}): Promise<Download> {
    const body = { items: items.map((i) => ({ productId: i.productId, claimCode: i.claimCode })), ...opts };
    const res = await this.request<Response>('POST', '/api/admin/certificates', { raw: true, body });
    return toDownload(res, opts.format === 'csv' ? 'orbes-certificates.csv' : 'orbes-certificate.pdf');
  }

  revokeCode(codeId: string, reason: string): Promise<{ code: CodeJson }> {
    return this.post(`/api/admin/codes/${encodeURIComponent(codeId)}/revoke`, { reason });
  }

  genomes(page = 1, pageSize = 50): Promise<Paged<GenomeJson>> {
    return this.get('/api/admin/genomes', { page, pageSize });
  }

  codes(filters: CodeFilters = {}, page = 1, pageSize = 50): Promise<Paged<CodeJson>> {
    return this.get('/api/admin/codes', { ...filters, page, pageSize });
  }

  /** Ids of the printable codes of a filter (a production batch), for a print sheet. */
  codeIds(filters: CodeFilters): Promise<CodeIds> {
    return this.get('/api/admin/codes/ids', { ...filters });
  }

  // ── Registries ───────────────────────────────────────────────────────────

  /** `from` / `to`: ISO 8601 instants or UTC days, both included (the window of an anomaly); `scanId`: one scan (a case's). */
  scans(
    q: { productId?: string; state?: string; scanId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
  ): Promise<Paged<ScanRecord>> {
    return this.get('/api/admin/scans', q);
  }

  /** Customer accounts; `email` finds one exact address, `ref` the accounts behind the REF under a result (with its scans). */
  owners(q: { email?: string; ref?: string; page?: number; pageSize?: number } = {}): Promise<OwnerList> {
    return this.get('/api/admin/owners', q);
  }

  /** The owner's sheet: pieces, transfers in progress, latest scans; the client sheet (N4): orders, releases, answers, interest, segments, notes. */
  owner(accountId: string): Promise<OwnerSheet> {
    return this.get(`/api/admin/owners/${encodeURIComponent(accountId)}`);
  }

  /** ADMIN: lock the account (its sessions end, its pending transfers are cancelled, its certificate links withdrawn). */
  lockOwner(accountId: string): Promise<OwnerLock> {
    return this.post(`/api/admin/owners/${encodeURIComponent(accountId)}/lock`);
  }

  /** ADMIN: unlock the account. */
  unlockOwner(accountId: string): Promise<{ status: 'ACTIVE' }> {
    return this.post(`/api/admin/owners/${encodeURIComponent(accountId)}/unlock`);
  }

  /** IN-01, OPERATOR: grant THE HOUSE'S GUARANTEE to the client. */
  grantGuarantee(accountId: string, input: GuaranteeInput): Promise<GuaranteeGrant> {
    return this.post(`/api/admin/owners/${encodeURIComponent(accountId)}/guarantees`, input);
  }

  /** IN-01, OPERATOR: change a guarantee's pieces, validity, shown or note. */
  changeGuarantee(id: string, change: GuaranteeChange): Promise<{ guarantee: Guarantee }> {
    return this.request('PATCH', `/api/admin/guarantees/${encodeURIComponent(id)}`, { body: change });
  }

  /** IN-01, OPERATOR: revoke a guarantee, with an optional note. */
  revokeGuarantee(id: string, note: string | null): Promise<{ guarantee: Guarantee }> {
    return this.post(`/api/admin/guarantees/${encodeURIComponent(id)}/revoke`, note ? { note } : {});
  }

  /** IN-01: a release's guarantees (a draw's or a LIVE RELEASE's), the emails masked for an AUDITOR. */
  releaseGuarantees(dropId: string): Promise<Items<ReleaseGuarantee>> {
    return this.get(`/api/admin/drops/${encodeURIComponent(dropId)}/guarantees`);
  }

  /** IN-01: the Grant dialog's defaults (Orders → Settings, House guarantee). */
  guaranteeSettings(): Promise<GuaranteeSettings> {
    return this.get('/api/admin/settings/guarantees');
  }

  /** IN-01, ADMIN: those defaults, changed. */
  setGuaranteeSettings(input: Pick<GuaranteeSettings, 'validDays' | 'pieces' | 'visible'>): Promise<GuaranteeSettings> {
    return this.request('PUT', '/api/admin/settings/guarantees', { body: input });
  }

  /** ADMIN: everything held about the account (right of access), as a JSON file. */
  async exportOwner(accountId: string): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/owners/${encodeURIComponent(accountId)}/export`, { raw: true });
    return toDownload(res, 'orbes-account.json');
  }

  /** ADMIN: a one-time recovery code for a client who forgot the password (after an identity check). Shown once. */
  issueRecoveryCode(accountId: string): Promise<RecoveryCode> {
    return this.post(`/api/admin/owners/${encodeURIComponent(accountId)}/recovery-code`);
  }

  warranties(q: { status?: string; page?: number; pageSize?: number } = {}): Promise<Paged<WarrantyRecord>> {
    return this.get('/api/admin/warranties', q);
  }

  anomalies(q: AnomalyFilters & { page?: number; pageSize?: number } = {}): Promise<Paged<AnomalyRecord>> {
    return this.get('/api/admin/anomalies', { ...q });
  }

  /** OPEN findings by severity, the badge count (OPEN HIGH + CRITICAL) and the known types. */
  anomalySummary(opts: { background?: boolean } = {}): Promise<AnomalySummary> {
    return this.request('GET', '/api/admin/anomalies/summary', { background: opts.background === true });
  }

  /** The scans around one finding, its code and what its product's lifecycle allows. */
  anomalyContext(id: string): Promise<AnomalyContext> {
    return this.get(`/api/admin/anomalies/${encodeURIComponent(id)}/context`);
  }

  /** The Cases queue: customers' reports on scans that were not authentic. */
  // ── The Club: the LIVE RELEASES ──────────────────────────────────────────

  liveReleases(page = 1, pageSize = 50): Promise<Paged<LiveCard>> {
    return this.get('/api/admin/live', { page, pageSize });
  }

  liveRelease(id: string): Promise<LiveRelease> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}`);
  }

  createLiveRelease(input: LiveSettings): Promise<LiveRelease> {
    return this.post('/api/admin/live', input);
  }

  /** Any setting, until the announcement (409 LIVE_ANNOUNCED after). */
  updateLiveRelease(id: string, change: LiveSettingsChange): Promise<LiveRelease> {
    return this.patch(`/api/admin/live/${encodeURIComponent(id)}`, change);
  }

  publishLiveRelease(id: string, circlePost: boolean): Promise<LiveRelease> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/publish`, { circlePost });
  }

  /** The release's post of the circle, shown from its announcement: added once published, until then. */
  postLiveCircle(id: string): Promise<LiveRelease> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/circle-post`);
  }

  /** The release's post of the circle, not shown yet, withdrawn. */
  withdrawLiveCircle(id: string): Promise<LiveRelease> {
    return this.del(`/api/admin/live/${encodeURIComponent(id)}/circle-post`);
  }

  cancelLiveRelease(id: string): Promise<LiveRelease> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/cancel`);
  }

  /** The silhouette, sent as the image itself (JPEG or WebP, at most 1 MiB). */
  setLiveSilhouette(id: string, photo: Blob): Promise<LiveRelease> {
    return this.request('POST', `/api/admin/live/${encodeURIComponent(id)}/silhouette`, { upload: { type: photo.type || 'image/jpeg', data: photo } });
  }

  removeLiveSilhouette(id: string): Promise<LiveRelease> {
    return this.del(`/api/admin/live/${encodeURIComponent(id)}/silhouette`);
  }

  /** A new link for the boutique board: its address, with its secret, in this answer only. */
  issueLiveBoardLink(id: string): Promise<{ url: string; issuedAt: string }> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/board-link`);
  }

  revokeLiveBoardLink(id: string): Promise<LiveRelease> {
    return this.del(`/api/admin/live/${encodeURIComponent(id)}/board-link`);
  }

  /** The live board; `background` for a refresh made by a timer (a 401 then leaves the page to the admin's next action). */
  liveBoard(id: string, opts: { background?: boolean } = {}): Promise<{ now: string; board: LiveBoard }> {
    return this.request('GET', `/api/admin/live/${encodeURIComponent(id)}/board`, { background: opts.background === true });
  }

  /** The address of the board's stream (an EventSource reads it with the console's cookie). */
  liveStreamUrl(id: string): string {
    return `${this.base}/api/admin/live/${encodeURIComponent(id)}/stream`;
  }

  liveEntries(id: string, q: { status?: LiveEntryStatus | 'OPEN'; page?: number; pageSize?: number } = {}): Promise<Paged<LiveEntry>> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/entries`, q);
  }

  pauseLive(id: string): Promise<LiveState> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/pause`);
  }

  resumeLive(id: string): Promise<LiveState> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/resume`);
  }

  extendLive(id: string, minutes: number): Promise<LiveState> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/extend`, { minutes });
  }

  /** ADD PIECES to a size. */
  addLivePieces(id: string, sizeId: string, pieces: number): Promise<LiveState> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/stock`, { sizeId, pieces });
  }

  messageLive(id: string, text: string): Promise<{ id: string; text: string; createdAt: string }> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/messages`, { text });
  }

  /** END NOW (ADMIN; the console asks for a typed phrase first). */
  endLive(id: string): Promise<LiveState> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/end`);
  }

  freeLiveHold(id: string, entryId: string): Promise<LiveEntry> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/free`);
  }

  letInLiveEntry(id: string, entryId: string): Promise<LiveEntry> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/let-in`);
  }

  /** REMOVE from the release (ADMIN). */
  removeLiveEntry(id: string, entryId: string): Promise<LiveEntry> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/remove`);
  }

  // ── Orders (plan LIVE RELEASE+) ──────────────────────────────────────────

  /** The fulfilment board: every order the filters keep, by step (the emails masked for an AUDITOR). */
  orderBoard(f: OrderBoardFilters = {}): Promise<OrderBoard> {
    return this.get('/api/admin/orders', { channel: f.channel, dropId: f.dropId, locationId: f.locationId, late: f.late ? 'true' : undefined, q: f.q });
  }

  /** Every order the same filters keep, as a CSV (the emails and the buyers masked for an AUDITOR). */
  async ordersCsv(f: OrderBoardFilters = {}): Promise<Download> {
    const res = await this.request<Response>('GET', '/api/admin/orders.csv', {
      raw: true,
      query: { channel: f.channel, dropId: f.dropId, locationId: f.locationId, late: f.late ? 'true' : undefined, q: f.q },
    });
    return toDownload(res, 'orbes-orders.csv');
  }

  order(id: string): Promise<OrderDetail> {
    return this.get(`/api/admin/orders/${encodeURIComponent(id)}`);
  }

  /** OPERATOR: the order's next step (PAID, SHIPPED, DELIVERED, CANCELLED) with what it requires. */
  transitionOrder(id: string, input: OrderTransitionInput): Promise<OrderDetail> {
    return this.post(`/api/admin/orders/${encodeURIComponent(id)}/transition`, input);
  }

  /** OPERATOR: served from another location (what it holds moves with it). */
  changeOrderLocation(id: string, locationId: string): Promise<OrderDetail> {
    return this.post(`/api/admin/orders/${encodeURIComponent(id)}/location`, { locationId });
  }

  /** OPERATOR: a draw's or a salon's size, price and currency; any order's engraving text. */
  setOrderTerms(id: string, change: OrderTermsChange): Promise<OrderDetail> {
    return this.patch(`/api/admin/orders/${encodeURIComponent(id)}/terms`, change);
  }

  /** OPERATOR: APPLY CREDIT (plan NEXT-NINE, BP-19 T5): a tier's credit taken off the order's invoice. */
  applyOrderCredit(id: string, amountMinor: number): Promise<OrderDetail> {
    return this.post(`/api/admin/orders/${encodeURIComponent(id)}/credit`, { amountMinor });
  }

  /** OPERATOR: REMOVE CREDIT: what was taken off the order given back. */
  removeOrderCredit(id: string): Promise<OrderDetail> {
    return this.request('DELETE', `/api/admin/orders/${encodeURIComponent(id)}/credit`);
  }

  /** OPERATOR: the buyer's name and address (null clears one); plan NEXT LOT §3.6.B: its country and phone (null clears one, left out kept). */
  setOrderBuyer(id: string, buyer: { name: string | null; address: string | null; country?: string | null; phone?: string | null }): Promise<OrderDetail> {
    return this.request('PUT', `/api/admin/orders/${encodeURIComponent(id)}/buyer`, { body: buyer });
  }

  /** OPERATOR: Open a return (plan NEXT LOT §3.5.4.4): a return or a size exchange, its reason and Client Services' note. */
  openOrderCase(id: string, input: { kind: 'RETURN' | 'EXCHANGE'; reason: OrderCaseReason; exchangeSkuId?: string | null; note: string }): Promise<OrderCaseRecord> {
    return this.post(`/api/admin/orders/${encodeURIComponent(id)}/case`, input);
  }

  /** AUDITOR: one order case (its notes withheld from an AUDITOR). */
  orderCase(id: string): Promise<OrderCaseRecord> {
    return this.get(`/api/admin/order-cases/${encodeURIComponent(id)}`);
  }

  /** OPERATOR (a lost parcel and the archive: ADMIN): ORBES's decision; a piece back to stock's new claim code, once. */
  decideOrderCase(id: string, input: { decision: 'REFUND' | 'EXCHANGE' | 'RESHIP'; pieceTo?: 'RESTOCKED' | 'ARCHIVED' | null; locationId?: string | null; note?: string | null }): Promise<OrderCaseDecided> {
    return this.post(`/api/admin/order-cases/${encodeURIComponent(id)}/decide`, input);
  }

  /** OPERATOR: the order case ended with no decision, with a note. */
  cancelOrderCase(id: string, note: string): Promise<OrderCaseRecord> {
    return this.post(`/api/admin/order-cases/${encodeURIComponent(id)}/cancel`, { note });
  }

  // ── Invoices (plan LIVE RELEASE+, M7) ────────────────────────────────────

  /** A month's invoices and credit notes (the current month by default), with their totals; the buyer masked for an AUDITOR. */
  invoices(f: InvoiceFilters = {}): Promise<InvoiceList> {
    return this.get('/api/admin/invoices', { month: f.month, kind: f.kind, q: f.q });
  }

  /** The month's CSV for the accountant. */
  async invoicesCsv(month: string): Promise<Download> {
    const res = await this.request<Response>('GET', '/api/admin/invoices.csv', { raw: true, query: { month } });
    return toDownload(res, `ORBES-invoices-${month}.csv`);
  }

  /** One document's PDF. */
  async invoicePdf(id: string): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/invoices/${encodeURIComponent(id)}/pdf`, { raw: true });
    return toDownload(res, 'ORBES-invoice.pdf');
  }

  // ── Segments (plan LIVE RELEASE+, choice 27) ─────────────────────────────

  /** Every segment, by name, with its members now and what uses it. */
  async segments(): Promise<Segment[]> {
    return (await this.get<{ items: Segment[] }>('/api/admin/segments')).items;
  }

  /** Every segment's id and name, by name: the choices of a release's access rule and a post's audience (no count read). */
  async segmentNames(): Promise<SegmentName[]> {
    return (await this.get<{ items: SegmentName[] }>('/api/admin/segments/names')).items;
  }

  segment(id: string): Promise<Segment> {
    return this.get(`/api/admin/segments/${encodeURIComponent(id)}`);
  }

  /** What the builder names: the releases, models, collections, sizes and countries known. */
  segmentOptions(): Promise<SegmentOptions> {
    return this.get('/api/admin/segments/options');
  }

  /** The members criteria being built would have now (OPERATOR); a background read, as the builder asks it at each change. */
  segmentCount(criteria: SegmentGroup): Promise<{ count: number }> {
    return this.request('POST', '/api/admin/segments/count', { body: { criteria }, background: true });
  }

  createSegment(input: { name: string; criteria: SegmentGroup }): Promise<Segment> {
    return this.post('/api/admin/segments', input);
  }

  updateSegment(id: string, change: { name?: string; criteria?: SegmentGroup }): Promise<Segment> {
    return this.patch(`/api/admin/segments/${encodeURIComponent(id)}`, change);
  }

  deleteSegment(id: string): Promise<void> {
    return this.del(`/api/admin/segments/${encodeURIComponent(id)}`);
  }

  /** A segment's members now, as a CSV (emails masked for an AUDITOR). */
  async segmentCsv(id: string): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/segments/${encodeURIComponent(id)}/members.csv`, { raw: true });
    return toDownload(res, 'orbes-segment.csv');
  }

  orderAlerts(): Promise<OrderAlertSettings> {
    return this.get('/api/admin/orders/alerts');
  }

  /** ADMIN: the delays after which an order stands out. */
  setOrderAlerts(delays: OrderAlertDelays): Promise<OrderAlertSettings> {
    return this.request('PUT', '/api/admin/orders/alerts', { body: delays });
  }

  /** SHIPPING (BP-19 T2): the optional rates below the free shipping of the tiers. */
  shippingRates(): Promise<ShippingRatesSheet> {
    return this.get('/api/admin/orders/shipping-rates');
  }

  /** ADMIN: the rates set whole; a rate left out is cleared. */
  setShippingRates(rates: ShippingRate[]): Promise<ShippingRatesSheet> {
    return this.request('PUT', '/api/admin/orders/shipping-rates', { body: { rates } });
  }

  /** ENGRAVING (plan NEXT LOT §3.6.C): the engraving's price per currency. */
  engravingPrices(): Promise<EngravingPricesSheet> {
    return this.get('/api/admin/orders/engraving-prices');
  }

  /** ADMIN: the engraving's prices set whole; null: no engraving in that currency. */
  setEngravingPrices(prices: Record<HouseCurrency, number | null>): Promise<EngravingPricesSheet> {
    return this.request('PUT', '/api/admin/orders/engraving-prices', { body: { prices } });
  }

  // ── Locations and carriers ───────────────────────────────────────────────

  locations(): Promise<Items<StockLocation>> {
    return this.get('/api/admin/locations');
  }

  /** ADMIN. */
  createLocation(name: string): Promise<StockLocation> {
    return this.post('/api/admin/locations', { name });
  }

  /** ADMIN: renamed, made the default, or its postal address (null clears it; plan NEXT LOT §3.5.4.5). */
  updateLocation(id: string, change: { name?: string; isDefault?: true; address?: string | null }): Promise<StockLocation> {
    return this.patch(`/api/admin/locations/${encodeURIComponent(id)}`, change);
  }

  carriers(): Promise<Items<Carrier>> {
    return this.get('/api/admin/carriers');
  }

  /** ADMIN. */
  createCarrier(input: { name: string; trackingUrl: string }): Promise<Carrier> {
    return this.post('/api/admin/carriers', input);
  }

  /** ADMIN: its name, its tracking link, offered or set aside. */
  updateCarrier(id: string, change: { name?: string; trackingUrl?: string; active?: boolean }): Promise<Carrier> {
    return this.patch(`/api/admin/carriers/${encodeURIComponent(id)}`, change);
  }

  // ── The client sheet's Profile (plan CUSTOMER INTELLIGENCE §3.1 P.6.5, P.6.6, P.9.2; API §16.36) ──

  /** OPERATOR+: Edit the profile, with the `version` read (409 PROFILE_CHANGED when the client saved in between). */
  saveClientProfile(accountId: string, input: ClientProfileInput): Promise<{ profile: ClientProfile }> {
    return this.request('PUT', `/api/admin/owners/${encodeURIComponent(accountId)}/profile`, { body: input });
  }

  /** OPERATOR+: Change the date of birth (null removes it), with the `version` read; `why` is kept as a private note. */
  setClientBirthDate(accountId: string, input: { version: number; birthDate: string | null; why: string }): Promise<{ profile: ClientProfile }> {
    return this.request('PUT', `/api/admin/owners/${encodeURIComponent(accountId)}/birth-date`, { body: input });
  }

  /** OPERATOR+: Edit the address: the default address changed, or the first one added as the default. */
  saveClientAddress(accountId: string, input: { name: string; address: string; country: string; phone: string }): Promise<{ profile: ClientProfile }> {
    return this.request('PUT', `/api/admin/owners/${encodeURIComponent(accountId)}/default-address`, { body: input });
  }

  // ── The client sheet's tags and private notes (plan CUSTOMER INTELLIGENCE §3.6 C.4.3, C.9; API §16.36) ──

  /** AUDITOR+: the client sheet's Intelligence, read after the sheet; the cities withheld for an AUDITOR. */
  ownerIntelligence(accountId: string): Promise<OwnerIntelligence> {
    return this.get(`/api/admin/owners/${encodeURIComponent(accountId)}/intelligence`);
  }

  /** AUDITOR+: the tags in use, the most used first (50 at most), or VIP, PRESS and FRIEND OF THE HOUSE while none is. */
  tagSuggestions(): Promise<{ items: TagSuggestion[] }> {
    return this.get('/api/admin/tags');
  }

  /** OPERATOR+: a tag added (in capitals by the server); the client's tags after it. */
  addClientTag(accountId: string, tag: string): Promise<{ tags: string[] }> {
    return this.post(`/api/admin/owners/${encodeURIComponent(accountId)}/tags`, { tag });
  }

  /** OPERATOR+: a tag removed. */
  removeClientTag(accountId: string, tag: string): Promise<void> {
    return this.del(`/api/admin/owners/${encodeURIComponent(accountId)}/tags/${encodeURIComponent(tag)}`);
  }

  /** AUDITOR+: every private note not removed, the newest first. */
  clientNotes(accountId: string): Promise<PrivateNotes> {
    return this.get(`/api/admin/owners/${encodeURIComponent(accountId)}/notes`, { all: 1 });
  }

  /** OPERATOR+: a private note added. */
  addClientNote(accountId: string, text: string): Promise<PrivateNote> {
    return this.post(`/api/admin/owners/${encodeURIComponent(accountId)}/notes`, { text });
  }

  /** OPERATOR+ (its writer) or ADMIN: a private note removed from the sheet. */
  removeClientNote(accountId: string, noteId: string): Promise<void> {
    return this.del(`/api/admin/owners/${encodeURIComponent(accountId)}/notes/${encodeURIComponent(noteId)}`);
  }

  // ── The Sign-up page (plan CUSTOMER INTELLIGENCE §3.1 P.10; API §16.38) ──

  /** AUDITOR+: the answers to « How did you hear about ORBES? », each with how many counted collectors gave it. */
  heardOptions(): Promise<{ options: HeardOptionView[] }> {
    return this.get('/api/admin/heard-options');
  }

  /** ADMIN: a new answer, offered, last before Other. */
  createHeardOption(label: string): Promise<{ options: HeardOptionView[] }> {
    return this.post('/api/admin/heard-options', { label });
  }

  /** ADMIN: renamed, set aside or offered again. */
  updateHeardOption(id: string, change: { label?: string; active?: boolean }): Promise<{ options: HeardOptionView[] }> {
    return this.patch(`/api/admin/heard-options/${encodeURIComponent(id)}`, change);
  }

  /** ADMIN: every answer but Other, in its new order (Other stays last). */
  orderHeardOptions(ids: string[]): Promise<{ options: HeardOptionView[] }> {
    return this.request('PUT', '/api/admin/heard-options/order', { body: { ids } });
  }

  // ── Links (plan CUSTOMER INTELLIGENCE §3.4 A.7.2, A.10; API §16.35) ──

  /** AUDITOR+: the report of a period of Paris days (both or neither), on one view, the archived links listed or not. */
  linksReport(q: { from?: string | null; to?: string | null; currency?: string | null; view?: LinksView; archived?: boolean } = {}): Promise<LinksReport> {
    return this.get('/api/admin/links', { from: q.from, to: q.to, currency: q.currency, view: q.view, archived: q.archived ? 'true' : undefined });
  }

  /** AUDITOR+: one link, its figures, its days and its return, for a period of Paris days. */
  linkReport(id: string, q: { from?: string | null; to?: string | null; currency?: string | null } = {}): Promise<LinkReport> {
    return this.get(`/api/admin/links/${encodeURIComponent(id)}`, { from: q.from, to: q.to, currency: q.currency });
  }

  /** AUDITOR+: the collectors behind a figure, 25 a page; their emails masked for an AUDITOR. */
  linkCollectors(q: {
    source: string;
    attribution: LinkAttribution;
    measure: LinkMeasure;
    from?: string | null;
    to?: string | null;
    currency?: string | null;
    page?: number;
  }): Promise<LinkFigureCollectors> {
    return this.get('/api/admin/acquisition/collectors', { ...q, page: q.page && q.page > 1 ? q.page : undefined });
  }

  /** AUDITOR+: the releases and models the New link dialog offers. */
  linkDestinations(): Promise<LinkDestinations> {
    return this.get('/api/admin/links/destinations');
  }

  /** OPERATOR+: a link made (and its LINK source); 409 LINK_CODE_TAKEN when its address is taken. */
  async createLink(input: LinkInput): Promise<LinkView> {
    return (await this.post<{ link: LinkView }>('/api/admin/links', input)).link;
  }

  /** OPERATOR+: its name, channel, destination, cost and note; never its address. */
  async updateLink(id: string, change: Partial<Omit<LinkInput, 'code'>>): Promise<LinkView> {
    return (await this.patch<{ link: LinkView }>(`/api/admin/links/${encodeURIComponent(id)}`, change)).link;
  }

  /** OPERATOR+: out of the list's default view (it keeps redirecting and counting), or back. */
  async archiveLink(id: string, archived: boolean): Promise<LinkView> {
    return (await this.post<{ link: LinkView }>(`/api/admin/links/${encodeURIComponent(id)}/${archived ? 'archive' : 'unarchive'}`)).link;
  }

  /** AUDITOR+: the channels in their order, each with how many links name it. */
  async linkChannels(): Promise<LinkChannelView[]> {
    return (await this.get<{ channels: LinkChannelView[] }>('/api/admin/link-channels')).channels;
  }

  /** OPERATOR+: a channel added, last unless a place is given. */
  async createLinkChannel(input: { name: string; position?: number }): Promise<LinkChannelView> {
    return (await this.post<{ channel: LinkChannelView }>('/api/admin/link-channels', input)).channel;
  }

  /** OPERATOR+: renamed or moved. */
  async updateLinkChannel(id: string, change: { name?: string; position?: number }): Promise<LinkChannelView> {
    return (await this.patch<{ channel: LinkChannelView }>(`/api/admin/link-channels/${encodeURIComponent(id)}`, change)).channel;
  }

  /** OPERATOR+: removed while no link names it (409 CHANNEL_IN_USE otherwise). */
  async deleteLinkChannel(id: string): Promise<void> {
    await this.del(`/api/admin/link-channels/${encodeURIComponent(id)}`);
  }

  // ── Logistics (plan NEXT LOT §3.5.6.9; the agent's locations only, for a LOGISTICS login) ──

  /** LOGISTICS and AUDITOR+: every size at each location; expected, to order and NO PIECE for ORBES staff only. */
  logisticsStock(f: { locationId?: string; modelId?: string } = {}): Promise<LogisticsStock> {
    return this.get('/api/admin/logistics/stock', { locationId: f.locationId, modelId: f.modelId });
  }

  /** LOGISTICS and AUDITOR+: the corrections, the newest first, and how many wait for ORBES. */
  stockCorrections(f: { status?: StockCorrectionStatus } = {}): Promise<StockCorrections> {
    return this.get('/api/admin/logistics/corrections', { status: f.status });
  }

  /** LOGISTICS: a correction proposed for ORBES to approve; OPERATOR+: applied at once. */
  proposeCorrection(input: { skuId: string; locationId: string; delta: number; reason: string }): Promise<StockCorrection> {
    return this.post('/api/admin/logistics/corrections', input);
  }

  /** OPERATOR: the agent's correction approved: the count moves. */
  approveCorrection(id: string): Promise<StockCorrection> {
    return this.post(`/api/admin/logistics/corrections/${encodeURIComponent(id)}/approve`, {});
  }

  /** OPERATOR: the agent's correction declined, with ORBES's note. */
  declineCorrection(id: string, note: string): Promise<StockCorrection> {
    return this.post(`/api/admin/logistics/corrections/${encodeURIComponent(id)}/decline`, { note });
  }

  /** OPERATOR: pieces of a size moved between locations; the destination's waiting orders served. */
  logisticsTransfer(input: { skuId: string; fromLocationId: string; toLocationId: string; quantity: number; note?: string }): Promise<{ transferId: string; from: StockLevel; to: StockLevel }> {
    return this.post('/api/admin/logistics/transfers', input);
  }

  /** OPERATOR: a size's minimum at a location, or none. */
  setLogisticsMinimum(input: { skuId: string; locationId: string; minimum: number | null }): Promise<void> {
    return this.request('PUT', '/api/admin/logistics/minimums', { body: input });
  }

  /** OPERATOR: named pieces of a size enter the stock with their ORBES identity; the count does not move. */
  countIn(input: { skuId: string; productIds: string[]; note: string }): Promise<{ skuId: string; productIds: string[]; unbacked: number }> {
    return this.post('/api/admin/logistics/count-in', input);
  }

  /** LOGISTICS and AUDITOR+: To ship, On its way, and the scope's locations. */
  parcels(f: { locationId?: string } = {}): Promise<ParcelsBoard> {
    return this.get('/api/admin/logistics/orders', { locationId: f.locationId });
  }

  /** LOGISTICS and AUDITOR+: to confirm, cards to print, back to the supplier; the supplier orders expected for ORBES staff only. */
  receptions(f: { locationId?: string } = {}): Promise<ReceptionsBoard> {
    return this.get('/api/admin/logistics/receptions', { locationId: f.locationId });
  }

  /** LOGISTICS and OPERATOR+: the open supplier order of that reference (from its delivery note), its lines without a price. */
  findReception(reference: string): Promise<ReceptionOrder> {
    return this.get('/api/admin/logistics/receptions/supplier-order', { reference });
  }

  /** LOGISTICS and OPERATOR+: an open supplier order's lines, without a price, for a reception being counted. */
  receptionLines(supplierOrderId: string): Promise<ReceptionOrder> {
    return this.get(`/api/admin/logistics/receptions/lines/${encodeURIComponent(supplierOrderId)}`);
  }

  /** LOGISTICS and AUDITOR+: one reception. */
  reception(id: string): Promise<ReceptionView> {
    return this.get(`/api/admin/logistics/receptions/${encodeURIComponent(id)}`);
  }

  /** LOGISTICS and OPERATOR+: a delivery counted against its supplier order (TO_CONFIRM). */
  recordReception(input: ReceptionInput & { supplierOrderId: string }): Promise<ReceptionView> {
    return this.post('/api/admin/logistics/receptions', input);
  }

  /** LOGISTICS and OPERATOR+: counted again, until ORBES confirms it. */
  updateReception(id: string, input: ReceptionInput): Promise<ReceptionView> {
    return this.request('PUT', `/api/admin/logistics/receptions/${encodeURIComponent(id)}`, { body: input });
  }

  /** OPERATOR: sent back to the agent, with ORBES's note. */
  sendBackReception(id: string, note: string): Promise<ReceptionView> {
    return this.post(`/api/admin/logistics/receptions/${encodeURIComponent(id)}/send-back`, { note });
  }

  /** OPERATOR: confirmed: the identities are issued, the pieces enter the stock. */
  confirmReception(id: string): Promise<ReceptionView> {
    return this.post(`/api/admin/logistics/receptions/${encodeURIComponent(id)}/confirm`, {});
  }

  /** LOGISTICS and OPERATOR+: a run of the reception's cards as a PDF (no-store); the pieces skipped, by serial and why. */
  async receptionCards(id: string, input: { layout: 'card' | 'sheet'; run?: number }): Promise<Download & { printed: number; skipped: { productId: string; reason: string }[] }> {
    const res = await this.request<Response>('POST', `/api/admin/logistics/receptions/${encodeURIComponent(id)}/cards`, { raw: true, body: input });
    const skipped = (res.headers.get('x-orbes-cards-skipped') ?? '')
      .split(',')
      .filter((x) => x !== '')
      .map((x) => {
        const i = x.lastIndexOf(':');
        return { productId: x.slice(0, i), reason: x.slice(i + 1) };
      });
    const printed = Number(res.headers.get('x-orbes-cards-printed') ?? '0');
    return { ...(await toDownload(res, 'ORBES-cards.pdf')), printed, skipped };
  }

  /** LOGISTICS and OPERATOR+: every card is with its piece; the sealed codes are erased. */
  cardsAttached(id: string): Promise<ReceptionView> {
    return this.post(`/api/admin/logistics/receptions/${encodeURIComponent(id)}/cards-attached`, {});
  }

  /** LOGISTICS and OPERATOR+: rejected pieces sent back to their supplier (a carrier and a tracking number when there are). */
  supplierReturnSent(id: string, input: { carrierId?: string | null; trackingNumber?: string | null }): Promise<SupplierReturnItem> {
    return this.post(`/api/admin/logistics/supplier-returns/${encodeURIComponent(id)}/sent`, input);
  }

  /** LOGISTICS and AUDITOR+: a parcel, keyed by any of its orders (no price, email, account nor release; its carriers). */
  parcel(orderId: string): Promise<ShippingOrderView> {
    return this.get(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}`);
  }

  /** LOGISTICS and OPERATOR+: Start packing (the collector can no longer change the address or the engraving). */
  startPacking(orderId: string): Promise<ShippingOrderView> {
    return this.post(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}/packing`, {});
  }

  /** LOGISTICS and OPERATOR+: a card's ORBES CODE scanned (the body of /verify); the right piece bound to its order. */
  scanPackingCard(orderId: string, input: { code: string; genome?: { glyphs: (number | null)[]; confidence?: number[] }; client?: Record<string, unknown> }): Promise<PackingScan> {
    return this.post(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}/packing/scan`, input);
  }

  /** LOGISTICS and OPERATOR+: the packed parcel's photo, a JPEG of at most 1 MiB (seen by ORBES only). */
  setPackingPhoto(orderId: string, photo: Blob): Promise<ShippingOrderView> {
    return this.request('PUT', `/api/admin/logistics/orders/${encodeURIComponent(orderId)}/packing/photo`, { upload: { type: 'image/jpeg', data: photo } });
  }

  /** LOGISTICS and OPERATOR+: Packed, the checklist's lines ticked by key. */
  checkPacked(orderId: string, ticked: string[]): Promise<ShippingOrderView> {
    return this.post(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}/packing/check`, { ticked });
  }

  /** LOGISTICS and OPERATOR+: Ship; a declared value per order from ORBES staff only (403 from the agent). */
  shipParcel(orderId: string, input: { carrierId: string; trackingNumber: string; declaredValues?: { orderId: string; minor: number | null }[] }): Promise<ShippingOrderView> {
    return this.post(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}/ship`, input);
  }

  /** LOGISTICS and OPERATOR+: the parcel reached the collector. */
  markParcelDelivered(orderId: string): Promise<ShippingOrderView> {
    return this.post(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}/delivered`, {});
  }

  /** LOGISTICS and OPERATOR+: a parcel problem reported (an order case ORBES decides). */
  reportParcel(orderId: string, input: { kind: 'BACK_TO_SENDER' | 'LOST' | 'DAMAGED'; note: string }): Promise<{ id: string }> {
    return this.post(`/api/admin/logistics/orders/${encodeURIComponent(orderId)}/order-case`, input);
  }

  /** LOGISTICS and AUDITOR+: the parcels expected back at the scope's locations (Returns → To receive). */
  casesToReceive(f: { locationId?: string } = {}): Promise<Items<CaseToReceive>> {
    return this.get('/api/admin/logistics/order-cases', { locationId: f.locationId });
  }

  /** LOGISTICS and OPERATOR+: the parcel back at the agent, the piece OK or damaged; ORBES then decides. */
  receiveCase(id: string, input: { pieceState: 'OK' | 'DAMAGED'; note?: string | null }): Promise<{ id: string; status: string; kind: string }> {
    return this.post(`/api/admin/logistics/order-cases/${encodeURIComponent(id)}/received`, input);
  }

  // ── The Club: the LIVE RELEASES' intelligence ────────────────────────────

  /** The release planner: the quantity and size mix suggested. */
  liveReleasePlan(id: string): Promise<LiveReleasePlan> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/plan`);
  }

  /** The audience forecast: the room expected at T0. */
  liveAudienceForecast(id: string): Promise<LiveAudienceForecast> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/forecast`);
  }

  /** The demand radar, before T0. */
  liveDemandRadar(id: string): Promise<LiveDemandRadar> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/radar`);
  }

  /** The bot radar (the emails masked for an AUDITOR). */
  liveBotRadar(id: string): Promise<LiveBotRadar> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/bots`);
  }

  /** The release report. */
  liveReport(id: string): Promise<LiveReleaseReport> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/report`);
  }

  /** The release report as a CSV. */
  async liveReportCsv(id: string): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/live/${encodeURIComponent(id)}/report.csv`, { raw: true });
    return toDownload(res, 'orbes-live-report.csv');
  }

  /** The collector insights (the emails masked for an AUDITOR). */
  liveCollectors(id: string): Promise<LiveCollectorInsights> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/collectors`);
  }

  /** The release beside the others whose T0 has passed. */
  liveComparison(id: string): Promise<LiveReleaseComparison> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/comparison`);
  }

  /** The best time to open the release: its tiers' activity by hour, Paris time, and its T0's. */
  liveBestTime(id: string, q: { days?: number; country?: string } = {}): Promise<BestTime> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/best-time`, q);
  }

  /** The feasibility check before publishing: each size against the stock at the release's location (warnings only). */
  liveFeasibility(id: string): Promise<LiveFeasibility> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/feasibility`);
  }

  /** The size mix a new release of a model is proposed: the stock at the location first, then the planner. */
  liveSizeMix(modelId: string, locationId?: string | null): Promise<LiveSizeMix> {
    return this.get('/api/admin/live/size-mix', { modelId, ...(locationId ? { locationId } : {}) });
  }

  // ── The Club: drops (P-R03) ──────────────────────────────────────────────

  drops(page = 1, pageSize = 50): Promise<Paged<Drop>> {
    return this.get('/api/admin/drops', { page, pageSize });
  }

  drop(id: string): Promise<Drop> {
    return this.get(`/api/admin/drops/${encodeURIComponent(id)}`);
  }

  /** Plan NEXT LOT §3.5.4.3: a draw's stock check, each size against the stock at its location (warnings only). */
  dropFeasibility(id: string): Promise<LiveFeasibility> {
    return this.get(`/api/admin/drops/${encodeURIComponent(id)}/feasibility`);
  }

  createDrop(input: DropInput): Promise<Drop> {
    return this.post('/api/admin/drops', input);
  }

  updateDrop(id: string, change: DropChange): Promise<Drop> {
    return this.patch(`/api/admin/drops/${encodeURIComponent(id)}`, change);
  }

  publishDrop(id: string): Promise<Drop> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/publish`);
  }

  cancelDrop(id: string): Promise<Drop> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/cancel`);
  }

  /** ADMIN: the draw, once, after its entries close. */
  drawDrop(id: string): Promise<DrawOutcome> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/draw`);
  }

  /** Its entries; plan NEXT LOT §3.6.F: `sizeId`, one size's. */
  dropEntries(id: string, q: { status?: DropEntryStatus; sizeId?: string; page?: number; pageSize?: number } = {}): Promise<Paged<DropEntry>> {
    return this.get(`/api/admin/drops/${encodeURIComponent(id)}/entries`, q);
  }

  /** CONFIRMED: the sale concluded by ORBES Client Services. */
  confirmDropEntry(id: string, entryId: string, note: string): Promise<DropEntry> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/confirm`, note ? { note } : {});
  }

  /** LAPSED, once the place held has passed its time. */
  lapseDropEntry(id: string, entryId: string, note: string): Promise<DropEntry> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/lapse`, note ? { note } : {});
  }

  /** OFFER NEXT: the first of the waiting list, SELECTED; plan NEXT LOT §3.6.F: of one size's in a draw with sizes. */
  offerNextDropEntry(id: string, sizeId?: string | null): Promise<DropEntry> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/offer-next`, sizeId ? { sizeId } : undefined);
  }

  // ── Test entrants and the server's status (plan TEST ENTRANTS) ───────────

  /** SEND TEST ENTRANTS (ADMIN, phrase TEST <8>): a draw open, or a LIVE RELEASE's room open; one test at a time. */
  startTestRun(dropId: string, input: TestRunInput): Promise<{ run: TestRunView }> {
    return this.post(`/api/admin/drops/${encodeURIComponent(dropId)}/test-runs`, input);
  }

  /** ADD MORE (ADMIN, the same phrase): up to 1 000 more into a RUNNING test, 5 000 in all. */
  addTestEntrants(runId: string, input: TestRunAddInput): Promise<{ run: TestRunView }> {
    return this.post(`/api/admin/test-runs/${encodeURIComponent(runId)}/add`, input);
  }

  /** STOP (ADMIN, one press): the test entrants stop at once; nothing is cleaned. */
  stopTestRun(runId: string): Promise<{ run: TestRunView }> {
    return this.post(`/api/admin/test-runs/${encodeURIComponent(runId)}/stop`);
  }

  /** CONFIRM a test entrant holding a place (ADMIN): a draw's staff Confirm; on a LIVE RELEASE, it secures and pays now. */
  confirmTestEntrant(runId: string, accountId: string): Promise<{ run: TestRunView }> {
    return this.post(`/api/admin/test-runs/${encodeURIComponent(runId)}/entrants/${encodeURIComponent(accountId)}/confirm`);
  }

  /** RELEASE a test entrant's place (ADMIN, a LIVE RELEASE only): RELEASE MY PLACE now. */
  releaseTestEntrant(runId: string, accountId: string): Promise<{ run: TestRunView }> {
    return this.post(`/api/admin/test-runs/${encodeURIComponent(runId)}/entrants/${encodeURIComponent(accountId)}/release`);
  }

  /** END TEST (ADMIN, phrase END TEST <8>): the report, then the clean-up of the test's orders, entries and places. */
  endTestRun(runId: string, phrase: string): Promise<{ run: TestRunView }> {
    return this.post(`/api/admin/test-runs/${encodeURIComponent(runId)}/end`, { phrase });
  }

  /** The release's newest test not ended, or null; `background` for the refresh made by a timer. */
  currentTestRun(dropId: string, opts: { background?: boolean } = {}): Promise<{ run: TestRunView | null }> {
    return this.request('GET', `/api/admin/drops/${encodeURIComponent(dropId)}/test-runs/current`, { background: opts.background === true });
  }

  /** The release's tests, newest first, each with its report once ended. */
  testRuns(dropId: string, opts: { background?: boolean } = {}): Promise<{ runs: TestRunSummary[] }> {
    return this.request('GET', `/api/admin/drops/${encodeURIComponent(dropId)}/test-runs`, { background: opts.background === true });
  }

  /** The RUNNING test, whatever its release, or null (the Drops tab). */
  activeTestRun(opts: { background?: boolean } = {}): Promise<{ run: ActiveTestRun | null }> {
    return this.request('GET', '/api/admin/test-runs/active', { background: opts.background === true });
  }

  /** The server's status: its latest sample and the last 10 minutes. */
  systemStatus(opts: { background?: boolean } = {}): Promise<SystemStatus> {
    return this.request('GET', '/api/admin/system/status', { background: opts.background === true });
  }

  // ── The Club: the circle (P-X01) ─────────────────────────────────────────

  circlePosts(page = 1, pageSize = 50): Promise<Paged<CirclePost>> {
    return this.get('/api/admin/circle/posts', { page, pageSize });
  }

  circlePost(id: string): Promise<CirclePost> {
    return this.get(`/api/admin/circle/posts/${encodeURIComponent(id)}`);
  }

  createCirclePost(input: CirclePostInput): Promise<CirclePost> {
    return this.post('/api/admin/circle/posts', input);
  }

  updateCirclePost(id: string, change: CirclePostChange): Promise<CirclePost> {
    return this.patch(`/api/admin/circle/posts/${encodeURIComponent(id)}`, change);
  }

  publishCirclePost(id: string): Promise<CirclePost> {
    return this.post(`/api/admin/circle/posts/${encodeURIComponent(id)}/publish`);
  }

  unpublishCirclePost(id: string): Promise<CirclePost> {
    return this.post(`/api/admin/circle/posts/${encodeURIComponent(id)}/unpublish`);
  }

  circleAnswers(id: string, q: { answer?: CircleRsvpAnswer; page?: number; pageSize?: number } = {}): Promise<Paged<CircleAnswer>> {
    return this.get(`/api/admin/circle/posts/${encodeURIComponent(id)}/answers`, q);
  }

  /** A photograph for a post of the circle: the image itself, added last (4 at most). */
  addCirclePhoto(id: string, photo: Blob): Promise<CirclePost> {
    return this.request('POST', `/api/admin/circle/posts/${encodeURIComponent(id)}/photos`, { upload: { type: photo.type || 'image/jpeg', data: photo } });
  }

  removeCirclePhoto(id: string, sha256: string): Promise<CirclePost> {
    return this.del(`/api/admin/circle/posts/${encodeURIComponent(id)}/photos/${encodeURIComponent(sha256)}`);
  }

  /** The order and alternative texts of a post's photographs: every one once, in the new order ('' alt: the post's default). */
  arrangeCirclePhotos(id: string, images: { sha256: string; alt: string }[]): Promise<CirclePost> {
    return this.patch(`/api/admin/circle/posts/${encodeURIComponent(id)}/photos`, { images });
  }

  // ── The Club: the tiers (P-X04) ──────────────────────────────────────────

  clubTiers(): Promise<Items<ClubTierSheet>> {
    return this.get('/api/admin/club/tiers');
  }

  /** A tier's benefits, one per line; null restores the words by default. */
  updateClubTier(tier: ClubTierName, benefits: string | null): Promise<ClubTierSheet> {
    return this.patch(`/api/admin/club/tiers/${encodeURIComponent(tier)}`, { benefits });
  }

  /** THE PROGRAM (BP-19 T2): the figures of the tiers' benefits, the gift models, each tier's lines. */
  clubProgram(): Promise<ClubProgramSheet> {
    return this.get('/api/admin/club/program');
  }

  /** ADMIN: THE PROGRAM changed whole. */
  updateClubProgram(program: ClubProgram): Promise<ClubProgramSheet> {
    return this.request('PUT', '/api/admin/club/program', { body: program });
  }

  // ── MESSAGES (plan NEXT-NINE, CS-01) ─────────────────────────────────────

  /** The board: To answer by default (or ANSWERED, CLOSED, ALL); Mine or Unassigned; an email or a REF. */
  messages(q: { status?: ClientConversationStatus | 'ALL'; who?: 'mine' | 'unassigned'; q?: string; page?: number; pageSize?: number } = {}): Promise<ConversationPage> {
    return this.get('/api/admin/messages', q);
  }

  /** The sidebar's badge; `background` for the refresh made by a timer (a 401 never signs the admin out). */
  messagesSummary(opts: { background?: boolean } = {}): Promise<MessagesSummary> {
    return this.request('GET', '/api/admin/messages/summary', { background: opts.background === true });
  }

  conversation(id: string): Promise<Conversation> {
    return this.get(`/api/admin/messages/${encodeURIComponent(id)}`);
  }

  /** OPERATOR: an answer, read by the client in their account, signed ORBES Client Services. */
  answerConversation(id: string, body: string): Promise<Conversation> {
    return this.post(`/api/admin/messages/${encodeURIComponent(id)}/answer`, { body });
  }

  /** OPERATOR: the reader answers this conversation from now. */
  takeConversation(id: string): Promise<Conversation> {
    return this.post(`/api/admin/messages/${encodeURIComponent(id)}/take`);
  }

  /** ADMIN: an active OPERATOR or ADMIN answers this conversation from now. */
  assignConversation(id: string, adminId: string): Promise<Conversation> {
    return this.post(`/api/admin/messages/${encodeURIComponent(id)}/assign`, { adminId });
  }

  /** OPERATOR: CLOSED; the client writing again reopens it. */
  closeConversation(id: string): Promise<Conversation> {
    return this.post(`/api/admin/messages/${encodeURIComponent(id)}/close`);
  }

  // ── The yearly care (plan NEXT-NINE, BP-19 T6) ───────────────────────────

  /** The Yearly care board: a step's tab, oldest first; a year. */
  careRequests(q: { status?: CareRequestStatus; year?: number; page?: number; pageSize?: number } = {}): Promise<Paged<CareRow>> {
    return this.get('/api/admin/care', q);
  }

  careRequest(id: string): Promise<CareSheet> {
    return this.get(`/api/admin/care/${encodeURIComponent(id)}`);
  }

  /** OPERATOR: SEND LABEL, the PDF itself (at most 2 MB), its carrier and tracking number. */
  sendCareLabel(id: string, pdf: Blob, carrierId: string, tracking: string): Promise<CareSheet> {
    return this.request('POST', `/api/admin/care/${encodeURIComponent(id)}/label`, { query: { carrierId, tracking }, upload: { type: 'application/pdf', data: pdf } });
  }

  /** OPERATOR: RECEIVED AT THE ATELIER, the YEARLY_CARE record opened. */
  receiveCare(id: string): Promise<CareSheet> {
    return this.post(`/api/admin/care/${encodeURIComponent(id)}/receive`);
  }

  /** OPERATOR: SHIP BACK, to the address the client gave. */
  shipCareBack(id: string, carrierId: string, tracking: string): Promise<CareSheet> {
    return this.post(`/api/admin/care/${encodeURIComponent(id)}/return`, { carrierId, tracking });
  }

  /** OPERATOR: COMPLETE, the notes going to the service record. */
  completeCare(id: string, notes: string): Promise<CareSheet> {
    return this.post(`/api/admin/care/${encodeURIComponent(id)}/complete`, notes.trim() ? { notes } : {});
  }

  /** OPERATOR: CANCEL, with a note, before the piece is shipped back. */
  cancelCare(id: string, note: string): Promise<CareSheet> {
    return this.post(`/api/admin/care/${encodeURIComponent(id)}/cancel`, { note });
  }

  // ── The Club: the private salon's requests (P-X08) ───────────────────────

  /** The requests, OPEN first, then the newest; or those of one status. */
  shopRequests(q: { status?: ShopRequestStatus; page?: number; pageSize?: number } = {}): Promise<Paged<ShopRequest>> {
    return this.get('/api/admin/club/requests', q);
  }

  /** OPERATOR: close a request with a note, what was done for the client, and its outcome (ACCEPTED creates its order). */
  closeShopRequest(id: string, note: string, outcome: ShopRequestOutcome): Promise<ShopRequest> {
    return this.post(`/api/admin/club/requests/${encodeURIComponent(id)}/close`, { note, outcome });
  }

  cases(q: { status?: string; scanId?: string; anomalyId?: string; page?: number; pageSize?: number } = {}): Promise<Paged<CaseRecord>> {
    return this.get('/api/admin/reports', q);
  }

  closeCase(id: string, note: string): Promise<CaseRecord> {
    return this.patch(`/api/admin/reports/${encodeURIComponent(id)}`, { status: 'CLOSED', note });
  }

  updateAnomaly(id: string, status: AnomalyStatus, note?: string): Promise<AnomalyRecord> {
    return this.patch(`/api/admin/anomalies/${encodeURIComponent(id)}`, { status, ...(note ? { note } : {}) });
  }

  revocations(page = 1, pageSize = 50): Promise<Paged<RevocationRecord>> {
    return this.get('/api/admin/revocations', { page, pageSize });
  }

  createRevocation(targetType: RevocationTargetType, targetId: string, reason: string): Promise<RevocationRecord> {
    return this.post('/api/admin/revocations', { targetType, targetId, reason });
  }

  // ── Points of sale and the sale mode (A-08) ──────────────────────────────

  /** The register; `activeOnly` for the lists a sale is chosen from. Every role, RETAIL included. */
  retailers(opts: { activeOnly?: boolean } = {}): Promise<Items<Retailer>> {
    return this.get('/api/admin/retailers', opts.activeOnly ? { active: true } : undefined);
  }

  createRetailer(input: { name: string; city?: string; country?: string }): Promise<{ retailer: Retailer }> {
    return this.post('/api/admin/retailers', input);
  }

  /** Rename, move, deactivate or reactivate (a point of sale is never deleted). */
  updateRetailer(retailerId: string, input: { name?: string; city?: string | null; country?: string | null; active?: boolean }): Promise<{ retailer: Retailer }> {
    return this.patch(`/api/admin/retailers/${encodeURIComponent(retailerId)}`, input);
  }

  /** What the decoder read, judged as /api/v1/verify would; a token comes back when the piece can be sold. */
  saleLookup(input: { code: string; genome?: { glyphs: (number | null)[]; confidence?: number[] }; client?: Record<string, unknown> }): Promise<SaleLookup> {
    return this.post('/api/admin/sale/lookup', input);
  }

  /** Start the warranty of the looked-up piece today, at this point of sale. */
  saleActivate(token: string, retailerId: string): Promise<SaleActivation> {
    return this.post('/api/admin/sale/activate', { token, retailerId });
  }

  // ── Keys ─────────────────────────────────────────────────────────────────

  keys(): Promise<Items<KeyJson>> {
    return this.get('/api/admin/keys');
  }

  rotateKey(kid?: string): Promise<KeyJson> {
    return this.post('/api/admin/keys/rotate', kid ? { kid } : {});
  }

  retireKey(keyId: number): Promise<KeyJson> {
    return this.post(`/api/admin/keys/${keyId}/retire`);
  }

  revokeKey(keyId: number, reason: string, compromisedAt?: string): Promise<KeyJson> {
    return this.post(`/api/admin/keys/${keyId}/revoke`, { reason, ...(compromisedAt ? { compromisedAt } : {}) });
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  audit(q: { action?: string; actorType?: string; targetType?: string; targetId?: string; page?: number; pageSize?: number } = {}): Promise<Paged<AuditEntry>> {
    return this.get('/api/admin/audit', q);
  }

  verifyAudit(): Promise<ChainVerification> {
    return this.get('/api/admin/audit/verify');
  }
}

async function toDownload(res: Response, fallback: string): Promise<Download> {
  const blob = await res.blob();
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { blob, contentType, filename: filenameFromDisposition(res.headers.get('content-disposition'), fallback) };
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = res.status >= 500 ? 'The server could not complete the request.' : 'The request was refused.';
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    if (body?.error && typeof body.error.code === 'string') code = body.error.code;
    if (body?.error && typeof body.error.message === 'string') message = body.error.message;
  } catch {
    /* non-JSON error (proxy page): keep the generic message */
  }
  return new ApiError(res.status, code, message);
}
