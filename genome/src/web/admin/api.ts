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
 * - Artifacts are attachments: they are fetched as blobs and saved by the UI.
 */
import type {
  AdminProfile,
  AdminSession,
  AdminUser,
  AnomalyRecord,
  AnomalyStatus,
  ArtifactFormat,
  ArtifactTheme,
  AuditEntry,
  CaseRecord,
  Category,
  ChainVerification,
  CodeJson,
  Collection,
  DashboardData,
  GenomeJson,
  IssueInput,
  IssueResponse,
  IssuedCodeJson,
  Items,
  KeyJson,
  LifecycleSnapshot,
  Model,
  OwnerRecord,
  Paged,
  ProductDetail,
  ProductOverview,
  ProductStatus,
  RevocationRecord,
  RevocationTargetType,
  ScanRecord,
  ServiceRecord,
  ServiceType,
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
  /** Return the raw Response (artifacts). */
  raw?: boolean;
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
    let body: string | undefined;
    if (opts.body !== undefined) {
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
      this.onUnauthorized?.();
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

  // ── Dashboard & catalogue ────────────────────────────────────────────────

  dashboard(): Promise<DashboardData> {
    return this.get('/api/admin/dashboard');
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

  // ── Products ─────────────────────────────────────────────────────────────

  products(q: { status?: string; category?: string; q?: string; page?: number; pageSize?: number } = {}): Promise<Paged<ProductOverview>> {
    return this.get('/api/admin/products', q);
  }

  product(productId: string): Promise<ProductDetail> {
    return this.get(`/api/admin/products/${encodeURIComponent(productId)}`);
  }

  issue(input: IssueInput): Promise<IssueResponse> {
    return this.post('/api/admin/products', input);
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

  activateWarranty(productId: string, input: { purchaseDate?: string; retailer?: string; country?: string }): Promise<{ warranty: WarrantyRecord }> {
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

  codes(page = 1, pageSize = 50): Promise<Paged<CodeJson>> {
    return this.get('/api/admin/codes', { page, pageSize });
  }

  // ── Registries ───────────────────────────────────────────────────────────

  scans(q: { productId?: string; state?: string; scanId?: string; page?: number; pageSize?: number } = {}): Promise<Paged<ScanRecord>> {
    return this.get('/api/admin/scans', q);
  }

  owners(page = 1, pageSize = 50): Promise<Paged<OwnerRecord>> {
    return this.get('/api/admin/owners', { page, pageSize });
  }

  warranties(q: { status?: string; page?: number; pageSize?: number } = {}): Promise<Paged<WarrantyRecord>> {
    return this.get('/api/admin/warranties', q);
  }

  anomalies(q: { id?: string; status?: string; severity?: string; page?: number; pageSize?: number } = {}): Promise<Paged<AnomalyRecord>> {
    return this.get('/api/admin/anomalies', q);
  }

  /** The Cases queue: customers' reports on scans that were not authentic. */
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
