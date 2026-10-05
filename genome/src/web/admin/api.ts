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
  AdminProfile,
  AdminSession,
  AdminSessionInfo,
  AdminUser,
  AnalyticsData,
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
  LiveReservation,
  LiveResolution,
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
  Items,
  KeyJson,
  LifecycleSnapshot,
  Model,
  ModelChange,
  OwnerList,
  OwnerLock,
  ShopRequest,
  ShopRequestOutcome,
  ShopRequestStatus,
  OwnerSheet,
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
  /** PDF only: 'card' (default, 85 × 55 mm pages) or 'sheet' (A4, ten cards). */
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

  /** A staff account (OPERATOR, AUDITOR or RETAIL) with a temporary password, returned once. */
  createStaff(email: string, role: StaffRole): Promise<StaffCreated> {
    return this.post('/api/admin/admins', { email, role });
  }

  setAdminRole(adminId: string, role: StaffRole): Promise<{ admin: AdminUser }> {
    return this.patch(`/api/admin/admins/${encodeURIComponent(adminId)}/role`, { role });
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

  /** The panel The Circle (P-X01): the members of the club by tier now, the visits of the same window by day. */
  circleStats(q: { days?: number; from?: string; to?: string } = {}): Promise<CircleStats> {
    return this.get('/api/admin/analytics/circle', q);
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

  /** The owner's sheet: pieces, transfers in progress, latest scans. */
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

  liveReservations(id: string, page = 1, pageSize = 50): Promise<Paged<LiveReservation>> {
    return this.get(`/api/admin/live/${encodeURIComponent(id)}/reservations`, { page, pageSize });
  }

  /** Every confirmed reservation as a CSV (the emails masked for an AUDITOR). */
  async liveReservationsCsv(id: string): Promise<Download> {
    const res = await this.request<Response>('GET', `/api/admin/live/${encodeURIComponent(id)}/reservations.csv`, { raw: true });
    return toDownload(res, 'orbes-live-reservations.csv');
  }

  /** CONCLUDED or CANCELLED, with an optional note (Client Services). */
  resolveLiveReservation(id: string, entryId: string, resolution: LiveResolution, note: string): Promise<LiveReservation> {
    return this.post(`/api/admin/live/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/resolve`, note ? { resolution, note } : { resolution });
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

  // ── The Club: drops (P-R03) ──────────────────────────────────────────────

  drops(page = 1, pageSize = 50): Promise<Paged<Drop>> {
    return this.get('/api/admin/drops', { page, pageSize });
  }

  drop(id: string): Promise<Drop> {
    return this.get(`/api/admin/drops/${encodeURIComponent(id)}`);
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

  dropEntries(id: string, q: { status?: DropEntryStatus; page?: number; pageSize?: number } = {}): Promise<Paged<DropEntry>> {
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

  /** OFFER NEXT: the first of the waiting list, SELECTED. */
  offerNextDropEntry(id: string): Promise<DropEntry> {
    return this.post(`/api/admin/drops/${encodeURIComponent(id)}/offer-next`);
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
