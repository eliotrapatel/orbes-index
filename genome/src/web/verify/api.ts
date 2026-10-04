/**
 * Fetch wrapper for the public and account API (PLATFORM-CONTRACTS §3).
 *
 * - Same-origin JSON only; cookies travel with `credentials: 'same-origin'`
 *   (the session cookie is httpOnly, the page never sees it).
 * - CSRF: login, register and the session probe (/account/session) return
 *   the session's CSRF token; it is kept in memory only and sent as
 *   `x-csrf-token` on every unsafe request. A 403 CSRF_FAILED (token rotated
 *   by a login elsewhere, or a reloaded page) refreshes the token once through
 *   the probe and retries. The probe answers 200 `{ account: null }` when
 *   signed out, so a signed-out visit logs no 401 in the browser console.
 * - Every failure becomes an ApiError with the server's public `{ code,
 *   message }`, or NETWORK / TIMEOUT / BAD_RESPONSE for transport problems.
 *   Server messages are written for customers and safe to display.
 * - The ownership certificate's PDF (F-06) is the one answer that is not
 *   JSON: it comes back as a blob with its file name, for the page to save.
 */
import type {
  CertificateLookup,
  CertificateOffer,
  CircleAnswer,
  CircleFeed,
  CirclePost,
  ClientServices,
  ClubEntry,
  ClubStatus,
  DrawEntriesPage,
  DropCard,
  DropSheet,
  DownloadedFile,
  IncidentReport,
  IncidentResolution,
  IncidentType,
  LookbookCard,
  LookbookSheet,
  OwnedPiece,
  OwnerCertificate,
  OwnershipConfirmation,
  RecoveryResult,
  ReportInput,
  ServiceRecord,
  SessionInfo,
  ShopRequest,
  TransferOffer,
  VerifyInput,
  VerifyOutcome,
} from './types.js';

export type TransportCode = 'NETWORK' | 'TIMEOUT' | 'BAD_RESPONSE';

export class ApiError extends Error {
  constructor(
    /** HTTP status, 0 for transport failures. */
    readonly status: number,
    /** Server error code (e.g. RATE_LIMITED, CSRF_FAILED) or a TransportCode. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface ApiClientOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Prefix for API paths (default '' = same origin). */
  base?: string;
  /** Per-request timeout (default 15 s). */
  timeoutMs?: number;
}

interface RequestOptions {
  /** Send the CSRF token (unsafe account routes). */
  csrf?: boolean;
  /** This request's own timeout (default: the client's). */
  timeoutMs?: number;
  /** Internal: this is the retry after a CSRF refresh. */
  retried?: boolean;
  /** HTTP cache mode (default no-store; a public, cacheable read may use the browser's cache). */
  cache?: RequestCache;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** The contact of ORBES Client Services is optional: its read gives up early, and is tried again with the next result. */
export const CONTACT_TIMEOUT_MS = 4_000;
/** Largest response body we are willing to parse (verify outcomes are ~2 KB). */
const MAX_RESPONSE_CHARS = 256 * 1024;
/** Largest file we are willing to take (a certificate's PDF is about 40 KB). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

type Method = 'GET' | 'POST' | 'DELETE';

export class ApiClient {
  private csrfToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions = {}) {
    // Bound: calling an unbound window.fetch throws "Illegal invocation" in some browsers.
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.base = opts.base ?? '';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Whether a CSRF token (hence, most likely, a session) is known. */
  get hasSession(): boolean {
    return this.csrfToken !== undefined;
  }

  /** Forget the session token (after logout or a 401). */
  forgetSession(): void {
    this.csrfToken = undefined;
  }

  // ── Public ───────────────────────────────────────────────────────────────

  verify(input: VerifyInput): Promise<VerifyOutcome> {
    return this.request<VerifyOutcome>('POST', '/api/v1/verify', input);
  }

  /** How ORBES Client Services is reached (`{}` when nothing is configured); the browser may keep it 5 minutes. */
  clientServices(): Promise<ClientServices> {
    return this.request<ClientServices>('GET', '/api/v1/client-services', undefined, { cache: 'default', timeoutMs: CONTACT_TIMEOUT_MS });
  }

  /**
   * Where the customer saw or bought the piece of a result that was not authentic, attached to its scan
   * (no session needed: the server checks the origin). Empty optional fields are left out.
   */
  async report(input: ReportInput): Promise<void> {
    const body: Record<string, string> = { scanId: input.scanId, channel: input.channel };
    if (input.where && input.where.trim()) body.where = input.where.trim();
    if (input.note && input.note.trim()) body.note = input.note.trim();
    await this.request('POST', '/api/v1/reports', body);
  }

  // ── The lookbook (P-R02) ─────────────────────────────────────────────────

  /** The PUBLIC models, by collection, without their stories; the same for everyone, so the browser may keep it 5 minutes. */
  async lookbook(): Promise<LookbookCard[]> {
    const r = await this.request<{ models?: unknown }>('GET', '/api/v1/lookbook', undefined, { cache: 'default' });
    if (!Array.isArray(r?.models)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.models as LookbookCard[];
  }

  /** A PUBLIC model's sheet (404 LOOKBOOK_NOT_FOUND for any other address); the browser may keep it 5 minutes. */
  lookbookSheet(slug: string): Promise<LookbookSheet> {
    return this.request<LookbookSheet>('GET', `/api/v1/lookbook/${encodeURIComponent(slug)}`, undefined, { cache: 'default' });
  }

  /** The RESERVED models, for an account that holds a piece (the club; 403 OWNERS_ONLY otherwise, 401 signed out). */
  async clubLookbook(): Promise<LookbookCard[]> {
    const r = await this.request<{ models?: unknown }>('GET', '/api/v1/club/lookbook');
    if (!Array.isArray(r?.models)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.models as LookbookCard[];
  }

  /** A sheet, PUBLIC or RESERVED, for an account that holds a piece (the club). */
  clubLookbookSheet(slug: string): Promise<LookbookSheet> {
    return this.request<LookbookSheet>('GET', `/api/v1/club/lookbook/${encodeURIComponent(slug)}`);
  }

  /** P-X08, REQUEST THIS PIECE: a model of THE PRIVATE SALON, with the account's optional note (409 SHOP_REQUEST_OPEN while one is open). */
  async requestPiece(slug: string, note: string | null): Promise<ShopRequest> {
    const r = await this.request<{ request?: ShopRequest }>('POST', `/api/v1/club/lookbook/${encodeURIComponent(slug)}/request`, note ? { note } : {}, { csrf: true });
    if (!r?.request || typeof r.request.id !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.request;
  }

  // ── The releases (P-R03) ─────────────────────────────────────────────────

  /**
   * The published releases, the latest opening first. Read afresh each time (the server lets a shared cache keep it a
   * minute): an opening, a close or a draw shows at once on this phone.
   */
  async drops(): Promise<DropCard[]> {
    const r = await this.request<{ drops?: unknown }>('GET', '/api/v1/drops');
    if (!Array.isArray(r?.drops)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.drops as DropCard[];
  }

  /** A release's page (404 DROP_NOT_FOUND for one ORBES has not published), read afresh: its draw shows at once. */
  drop(id: string): Promise<DropSheet> {
    return this.request<DropSheet>('GET', `/api/v1/drops/${encodeURIComponent(id)}`);
  }

  /** A page of a drawn release's entries, by rank (409 DROP_NOT_DRAWN before the draw). */
  async drawEntries(id: string, page: number, pageSize = 100): Promise<DrawEntriesPage> {
    const r = await this.request<DrawEntriesPage>('GET', `/api/v1/drops/${encodeURIComponent(id)}/entries?page=${page}&pageSize=${pageSize}`);
    if (!Array.isArray(r?.items) || typeof r.total !== 'number') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** The signed-in account's tier and entries (the club; 401 signed out). */
  async clubStatus(): Promise<ClubStatus> {
    const r = await this.request<ClubStatus>('GET', '/api/v1/club/status');
    if (!Array.isArray(r?.entries)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** ENTER THE DRAW of an open release (the same entry again after a withdrawal). */
  async enterDrop(id: string): Promise<ClubEntry> {
    const r = await this.request<{ entry?: ClubEntry }>('POST', `/api/v1/club/drops/${encodeURIComponent(id)}/enter`, undefined, { csrf: true });
    if (!r?.entry) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entry;
  }

  /** WITHDRAW from a release's draw, before it takes place. */
  async withdrawDrop(id: string): Promise<ClubEntry> {
    const r = await this.request<{ entry?: ClubEntry }>('POST', `/api/v1/club/drops/${encodeURIComponent(id)}/withdraw`, undefined, { csrf: true });
    if (!r?.entry) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entry;
  }

  /**
   * RESERVE A PLACE (P-X02): during a release's early access, a PLATINE or PALLADIUM account holds a place at once (403
   * DROP_TIER_REQUIRED below, 409 outside the early access or once every piece is held).
   */
  async reserveDrop(id: string): Promise<ClubEntry> {
    const r = await this.request<{ entry?: ClubEntry }>('POST', `/api/v1/club/drops/${encodeURIComponent(id)}/reserve`, undefined, { csrf: true });
    if (!r?.entry) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entry;
  }

  // ── The circle (P-X01) ───────────────────────────────────────────────────

  /** A page of the circle's feed, the latest first, without the posts' bodies (403 OWNERS_ONLY without a piece, 401 signed out). */
  async circle(page = 1, pageSize = 20): Promise<CircleFeed> {
    const r = await this.request<CircleFeed>('GET', `/api/v1/club/circle?page=${page}&pageSize=${pageSize}`);
    if (!Array.isArray(r?.items) || typeof r.total !== 'number') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** A post of the circle (404 CIRCLE_POST_NOT_FOUND below its tier, unpublished or unknown). */
  circlePost(id: string): Promise<CirclePost> {
    return this.request<CirclePost>('GET', `/api/v1/club/circle/${encodeURIComponent(id)}`);
  }

  /** YES or NO to an invitation, until its event begins (409 CIRCLE_FULL past its places). Answered with the post. */
  circleAnswer(id: string, answer: CircleAnswer): Promise<CirclePost> {
    return this.request<CirclePost>('POST', `/api/v1/club/circle/${encodeURIComponent(id)}/rsvp`, { answer }, { csrf: true });
  }

  /** One vote in a poll, by the index of its option; final. Answered with the post, its results shown. */
  circleVote(id: string, option: number): Promise<CirclePost> {
    return this.request<CirclePost>('POST', `/api/v1/club/circle/${encodeURIComponent(id)}/vote`, { option }, { csrf: true });
  }

  // ── Account ──────────────────────────────────────────────────────────────

  /** The current session, or null when signed out (GET /account/session; a 401 also reads as signed out). */
  async me(): Promise<SessionInfo | null> {
    try {
      const s = await this.request<SessionInfo | { account: null }>('GET', '/api/v1/account/session');
      if (!s || s.account === null || typeof s.account !== 'object') {
        this.forgetSession();
        return null;
      }
      this.remember(s as SessionInfo);
      return s as SessionInfo;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.forgetSession();
        return null;
      }
      throw e;
    }
  }

  async login(email: string, password: string): Promise<SessionInfo> {
    const s = await this.request<SessionInfo>('POST', '/api/v1/account/login', { email, password });
    this.remember(s);
    return s;
  }

  async register(email: string, password: string, displayName?: string): Promise<SessionInfo> {
    const body: Record<string, string> = { email, password };
    if (displayName && displayName.trim()) body.displayName = displayName.trim();
    const s = await this.request<SessionInfo>('POST', '/api/v1/account/register', body);
    this.remember(s);
    return s;
  }

  /**
   * Change the password with the current one (C-04): this session stays, the others end. A wrong current
   * password is a 400 CURRENT_PASSWORD_INVALID, never a 401, so the page stays signed in.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('POST', '/api/v1/account/password', { currentPassword, newPassword }, { csrf: true });
  }

  /**
   * Set a new password with the one-time code of ORBES Client Services (C-04). Session-less (the server checks
   * the origin): no session is opened, and every session of the account ends, this page's too.
   */
  async recoverAccount(email: string, recoveryCode: string, newPassword: string): Promise<RecoveryResult> {
    const r = await this.request<RecoveryResult>('POST', '/api/v1/account/recover', { email, recoveryCode: recoveryCode.trim(), newPassword });
    this.forgetSession();
    return r;
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/api/v1/account/logout', undefined, { csrf: true });
    } finally {
      this.forgetSession();
    }
  }

  // ── Ownership ────────────────────────────────────────────────────────────

  registerProduct(registrationToken: string, claimCode?: string): Promise<OwnershipConfirmation> {
    const body: Record<string, string> = { registrationToken };
    if (claimCode && claimCode.trim()) body.claimCode = claimCode.trim();
    return this.request<OwnershipConfirmation>('POST', '/api/v1/ownership/register', body, { csrf: true });
  }

  initiateTransfer(productId: string): Promise<TransferOffer> {
    return this.request<TransferOffer>('POST', '/api/v1/ownership/transfers', { productId }, { csrf: true });
  }

  /**
   * RECEIVE THIS PIECE (F-03): the transfer code, for the piece this scan read (`productId`), with the transfer
   * window of that scan (`transferToken`, VerifyOutcome.transfer). A code of another piece is refused (409).
   */
  acceptTransfer(transferCode: string, productId: string, transferToken: string): Promise<OwnershipConfirmation> {
    return this.request<OwnershipConfirmation>('POST', '/api/v1/ownership/transfers/accept', { transferCode: transferCode.trim(), productId, transferToken }, { csrf: true });
  }

  async cancelTransfer(productId: string): Promise<void> {
    await this.request('POST', '/api/v1/ownership/transfers/cancel', { productId }, { csrf: true });
  }

  // ── My pieces (F-01) ─────────────────────────────────────────────────────

  /** The signed-in owner's pieces, newest acquisition first (GET /account/products; a 401 when signed out). */
  async products(): Promise<OwnedPiece[]> {
    const r = await this.request<{ products?: unknown }>('GET', '/api/v1/account/products');
    if (!Array.isArray(r?.products)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.products as OwnedPiece[];
  }

  /** The after-sales services of one of the owner's pieces, oldest first; staff notes stay internal. */
  async serviceHistory(productId: string): Promise<ServiceRecord[]> {
    const r = await this.request<{ services?: unknown }>('GET', `/api/v1/products/${encodeURIComponent(productId)}/service-history`);
    if (!Array.isArray(r?.services)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.services as ServiceRecord[];
  }

  /** REPORT LOST / STOLEN: from then on every scan of the piece shows UNUSUAL ACTIVITY, and a pending transfer is cancelled. */
  reportIncident(productId: string, type: IncidentType): Promise<IncidentReport> {
    return this.request<IncidentReport>('POST', '/api/v1/ownership/incidents', { productId, type }, { csrf: true });
  }

  /**
   * PIECE FOUND: withdraws a loss the owner reported themselves (a theft stays with ORBES Client Services), with the
   * account's password typed again. A wrong one is 400 CURRENT_PASSWORD_INVALID: the session stays.
   */
  resolveIncident(productId: string, currentPassword: string): Promise<IncidentResolution> {
    return this.request<IncidentResolution>('POST', '/api/v1/ownership/incidents/resolve', { productId, currentPassword }, { csrf: true });
  }

  // ── Ownership certificates (F-06) ────────────────────────────────────────

  /** CREATE CERTIFICATE (MY PIECES): a link to the live record of one of the owner's pieces, valid `validDays` days; shown once. */
  createCertificate(productId: string, validDays: number): Promise<CertificateOffer> {
    return this.request<CertificateOffer>('POST', '/api/v1/ownership/certificates', { productId, validDays }, { csrf: true });
  }

  /** The owner's links still open (not withdrawn, not expired), newest first. */
  async certificates(): Promise<OwnerCertificate[]> {
    const r = await this.request<{ certificates?: unknown }>('GET', '/api/v1/ownership/certificates');
    if (!Array.isArray(r?.certificates)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.certificates as OwnerCertificate[];
  }

  /** WITHDRAW: the link then answers as one that never existed. */
  async revokeCertificate(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/ownership/certificates/${encodeURIComponent(id)}`, undefined, { csrf: true });
  }

  /** The certificate behind a link (no session needed): the token, from the link's fragment, travels in the body. */
  lookupCertificate(token: string): Promise<CertificateLookup> {
    return this.request<CertificateLookup>('POST', '/api/v1/certificates/lookup', { token });
  }

  /** The certificate as a PDF, to save (a 409 once it is no longer valid). */
  async certificatePdf(token: string): Promise<DownloadedFile> {
    const res = await this.send('POST', '/api/v1/certificates/pdf', { token }, {});
    if (!res.ok) throw toApiError(res.status, await readJson(res));
    const type = res.headers.get('content-type') ?? '';
    const blob = await res.blob();
    if (!type.startsWith('application/pdf') || blob.size === 0 || blob.size > MAX_FILE_BYTES) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
    return { blob, filename: filenameOf(res.headers.get('content-disposition'), 'ORBES-ownership-certificate.pdf') };
  }

  // ── Transport ────────────────────────────────────────────────────────────

  private remember(s: SessionInfo): void {
    if (typeof s?.csrfToken === 'string' && s.csrfToken.length > 0) this.csrfToken = s.csrfToken;
  }

  /** One request on the wire: transport failures become NETWORK or TIMEOUT. The response is the caller's to read. */
  private async send(method: Method, path: string, body: unknown, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.csrf && this.csrfToken) headers['x-csrf-token'] = this.csrfToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        cache: opts.cache ?? 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      return res;
    } catch (e) {
      const aborted = controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
      throw aborted
        ? new ApiError(0, 'TIMEOUT', 'The request took too long.')
        : new ApiError(0, 'NETWORK', 'The service could not be reached.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const res = await this.send(method, path, body, opts);
    const payload = await readJson(res);
    if (res.ok) {
      if (payload === undefined && res.status !== 204) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
      return payload as T;
    }

    const err = toApiError(res.status, payload);
    // One CSRF refresh per request: the token may have rotated since we last saw it.
    if (opts.csrf && !opts.retried && err.code === 'CSRF_FAILED') {
      const session = await this.me();
      if (session) return this.request<T>(method, path, body, { ...opts, retried: true });
    }
    if (err.status === 401) this.forgetSession();
    throw err;
  }
}

async function readJson(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (!text || text.length > MAX_RESPONSE_CHARS) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The file name of a `Content-Disposition: attachment; filename="…"` header, else `fallback`. */
export function filenameOf(disposition: string | null, fallback: string): string {
  const m = /filename="([A-Za-z0-9._-]{1,120})"/.exec(disposition ?? '');
  return m ? m[1] : fallback;
}

/** Map an error response to an ApiError, tolerating bodies that are not the contract shape. */
export function toApiError(status: number, payload: unknown): ApiError {
  const e = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  const code = typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`;
  const message = typeof e?.message === 'string' && e.message.length <= 500 ? e.message : 'The request could not be completed.';
  return new ApiError(status, code, message);
}

/**
 * `p`'s value, or `fallback` when `p` has not settled within `ms`; `p` itself
 * runs on (a read that answers late can still fill a cache). `p` must not reject.
 */
export function settledWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
