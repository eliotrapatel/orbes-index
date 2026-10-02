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
 */
import type { ClientServices, OwnershipConfirmation, SessionInfo, TransferOffer, VerifyInput, VerifyOutcome } from './types.js';

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
  /** Internal: this is the retry after a CSRF refresh. */
  retried?: boolean;
  /** HTTP cache mode (default no-store; a public, cacheable read may use the browser's cache). */
  cache?: RequestCache;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Largest response body we are willing to parse (verify outcomes are ~2 KB). */
const MAX_RESPONSE_CHARS = 256 * 1024;

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
    return this.request<ClientServices>('GET', '/api/v1/client-services', undefined, { cache: 'default' });
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

  acceptTransfer(transferCode: string): Promise<OwnershipConfirmation> {
    return this.request<OwnershipConfirmation>('POST', '/api/v1/ownership/transfers/accept', { transferCode: transferCode.trim() }, { csrf: true });
  }

  async cancelTransfer(productId: string): Promise<void> {
    await this.request('POST', '/api/v1/ownership/transfers/cancel', { productId }, { csrf: true });
  }

  // ── Transport ────────────────────────────────────────────────────────────

  private remember(s: SessionInfo): void {
    if (typeof s?.csrfToken === 'string' && s.csrfToken.length > 0) this.csrfToken = s.csrfToken;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.csrf && this.csrfToken) headers['x-csrf-token'] = this.csrfToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        cache: opts.cache ?? 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
      throw aborted
        ? new ApiError(0, 'TIMEOUT', 'The request took too long.')
        : new ApiError(0, 'NETWORK', 'The service could not be reached.');
    } finally {
      clearTimeout(timer);
    }

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

/** Map an error response to an ApiError, tolerating bodies that are not the contract shape. */
export function toApiError(status: number, payload: unknown): ApiError {
  const e = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  const code = typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`;
  const message = typeof e?.message === 'string' && e.message.length <= 500 ? e.message : 'The request could not be completed.';
  return new ApiError(status, code, message);
}
