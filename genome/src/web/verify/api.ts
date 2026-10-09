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
 * - The ownership certificate's PDF (F-06) and an order's documents (an
 *   invoice, a credit note, the order's ownership certificate: M6) are the
 *   answers that are not JSON: each comes back as a blob with its file name,
 *   for the page to save.
 * - A LIVE RELEASE's stream is no fetch: the page opens an EventSource on
 *   `liveStreamUrl` (same origin, the session cookie with it). The boutique
 *   board's is a POST (its secret in the body), read as a stream of bytes.
 */
import type {
  AccountAddresses,
  AccountProfileInput,
  AccountProfileView,
  AccountMessage,
  AccountSizes,
  DeliveryAddressInput,
  OrderCaseRequest,
  AccountThread,
  MessageContextInput,
  AccountOrder,
  AccountQuestion,
  OrderCareGuide,
  CertificateLookup,
  CertificateOffer,
  CircleAnswer,
  CircleFeed,
  CirclePost,
  ClaimCodeReading,
  ClientServices,
  ClubEntry,
  ClubLookbook,
  ClubStatus,
  DrawEntriesPage,
  DropCard,
  DropSheet,
  DrawEntryRead,
  DownloadedFile,
  IncidentReport,
  IncidentResolution,
  IncidentType,
  LiveAccountEntry,
  LiveBanner,
  LiveBoard,
  LiveCard,
  LiveEndedSheet,
  LiveEntry,
  LiveInterest,
  LiveSheet,
  LiveState,
  LookbookCard,
  LookbookSheet,
  OwnedPiece,
  OwnerCertificate,
  PieceCare,
  ReleaseRules,
  TheClub,
  OwnershipConfirmation,
  Participation,
  PastReleasesPage,
  RecoveryResult,
  ReportInput,
  SalonOpening,
  ServiceRecord,
  SessionInfo,
  HeardOption,
  ShopRequest,
  SignUpInput,
  SignUpOptions,
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
/** A LIVE RELEASE's clock sync gives up on a slow round trip (it is no use for the sync), and its state polled every 2 s on one that hangs. */
export const LIVE_CLOCK_TIMEOUT_MS = 4_000;
export const LIVE_STATE_TIMEOUT_MS = 6_000;
/** Largest response body we are willing to parse (verify outcomes are ~2 KB). */
const MAX_RESPONSE_CHARS = 256 * 1024;
/** Largest file we are willing to take (a certificate's PDF is about 40 KB). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A question after as the server sent it, checked; null for none or for one this app could not read. */
function questionOf(q: AccountQuestion | null): AccountQuestion | null {
  if (!q) return null;
  const ok =
    typeof q.dropId === 'string' &&
    typeof q.text === 'string' &&
    Array.isArray(q.answers) &&
    q.answers.length >= 2 &&
    q.answers.every((a) => typeof a === 'string') &&
    (q.answer === null || (Number.isInteger(q.answer) && q.answer >= 1 && q.answer <= q.answers.length)) &&
    (q.asked === 'TOOK_PART' || q.asked === 'INTEREST') &&
    typeof q.closesAt === 'string';
  if (!ok) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
  return q;
}

/** An order's documents saved as PDFs (GET /api/v1/account/orders/:id/<kind>.pdf). */
export type OrderDocumentKind = 'invoice' | 'credit-note' | 'certificate';

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

  /**
   * The RESERVED models, for an account that holds a piece (the club; 403 OWNERS_ONLY otherwise, 401 signed out); when its
   * tier reaches none, the tier that opens THE PRIVATE SALON (NOCTURNE), null when none does or the answer names none.
   */
  async clubLookbook(): Promise<ClubLookbook> {
    const r = await this.request<{ models?: unknown; opensAt?: unknown }>('GET', '/api/v1/club/lookbook');
    if (!Array.isArray(r?.models)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    const o = r.opensAt as Partial<SalonOpening> | null | undefined;
    const opensAt =
      o && typeof o === 'object' && (o.level === 2 || o.level === 3) && (o.name === 'PLATINE' || o.name === 'PALLADIUM') && Number.isSafeInteger(o.pieces) && o.pieces! > 0
        ? { level: o.level, name: o.name, pieces: o.pieces! }
        : null;
    return { models: r.models as LookbookCard[], opensAt };
  }

  /** A sheet, PUBLIC or RESERVED, for an account that holds a piece (the club). */
  clubLookbookSheet(slug: string): Promise<LookbookSheet> {
    return this.request<LookbookSheet>('GET', `/api/v1/club/lookbook/${encodeURIComponent(slug)}`);
  }

  /** P-X08, REQUEST THIS PIECE: a model of THE PRIVATE SALON, with the account's optional note (409 SHOP_REQUEST_OPEN while one is open). */
  async requestPiece(slug: string, note: string | null, size: string | null = null): Promise<ShopRequest> {
    // AC-01: the size asked, or none (NOT SURE YET, a model of one size).
    const body = { ...(note ? { note } : {}), ...(size ? { size } : {}) };
    const r = await this.request<{ request?: ShopRequest }>('POST', `/api/v1/club/lookbook/${encodeURIComponent(slug)}/request`, body, { csrf: true });
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

  /**
   * THE RELEASES' PAST (plan LIVE RELEASE+, choice 5): a page of the releases ended, the newest first, LIVE RELEASES and
   * draws together. Read afresh (the server lets a shared cache keep it a minute).
   */
  async pastReleases(page: number, pageSize: number): Promise<PastReleasesPage> {
    const r = await this.request<PastReleasesPage>('GET', `/api/v1/releases/past?page=${page}&pageSize=${pageSize}`);
    if (!Array.isArray(r?.items) || typeof r.total !== 'number') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** The releases the signed-in account took part in, each with whether it secured a piece there (401 signed out). */
  async participation(): Promise<Participation> {
    const r = await this.request<Participation>('GET', '/api/v1/account/participation');
    if (!Array.isArray(r?.releases) || typeof r.count !== 'number') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /**
   * The question after a LIVE RELEASE for the signed-in account (plan LIVE RELEASE+, choice 11): null when it is not
   * asked of it, or no longer open (401 signed out).
   */
  async question(id: string): Promise<AccountQuestion | null> {
    const r = await this.request<{ question?: AccountQuestion | null }>('GET', `/api/v1/live/${encodeURIComponent(id)}/question`);
    if (!r || !('question' in r)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return questionOf(r.question ?? null);
  }

  /** One tap: the answer chosen (its position, from 1), changeable while the question is open. */
  async answer(id: string, answer: number): Promise<AccountQuestion> {
    const r = await this.request<{ question?: AccountQuestion | null }>('PUT', `/api/v1/live/${encodeURIComponent(id)}/answer`, { answer }, { csrf: true });
    const q = questionOf(r?.question ?? null);
    if (!q) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return q;
  }

  /** The questions MY PIECES asks: after the releases the account said I'LL BE THERE to and did not come to (401 signed out). */
  async questions(): Promise<AccountQuestion[]> {
    const r = await this.request<{ questions?: unknown }>('GET', '/api/v1/account/questions');
    if (!Array.isArray(r?.questions)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.questions.map((q) => questionOf(q as AccountQuestion)).filter((q): q is AccountQuestion => q !== null);
  }

  /** The signed-in account's tier and entries (the club; 401 signed out). */
  async clubStatus(): Promise<ClubStatus> {
    const r = await this.request<ClubStatus>('GET', '/api/v1/club/status');
    if (!Array.isArray(r?.entries)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** THE CLUB (plan NEXT-NINE, BP-19 T9): every tier and what it gives, for everyone; the browser may keep it a minute. */
  async theClub(): Promise<TheClub> {
    const r = await this.request<TheClub>('GET', '/api/v1/the-club', undefined, { cache: 'default' });
    if (!Array.isArray(r?.tiers) || !Array.isArray(r.tierThresholds)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /**
   * HOW RELEASES WORK's figures (plan NEXT-NINE, FT-01): the same for everyone; the browser may keep them a minute. An
   * answer whose figures are not whole numbers in their place is refused, so the page never states a wrong one.
   */
  async releaseRules(): Promise<ReleaseRules> {
    const r = await this.request<ReleaseRules>('GET', '/api/v1/releases/rules', undefined, { cache: 'default' });
    const whole = (v: unknown, min: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min;
    const ok =
      Array.isArray(r?.tiers) &&
      r.tiers.length === 3 &&
      r.tiers.every((t, i) => t?.name === (['TITANE', 'PLATINE', 'PALLADIUM'] as const)[i] && whole(t.pieces, 1)) &&
      whole(r.earlyAccess?.PALLADIUM, 0) &&
      whole(r.earlyAccess?.PLATINE, 0) &&
      whole(r.placeHeldHours, 1);
    if (!ok) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /**
   * Plan NEXT LOT §3.6.F: the account's entry in a draw (null when it has none) and the size YOUR SIZES suggests among
   * its sizes; read afresh (404 DROP_NOT_FOUND for an unknown or unpublished draw).
   */
  async drawEntry(id: string): Promise<DrawEntryRead> {
    const r = await this.request<DrawEntryRead>('GET', `/api/v1/club/drops/${encodeURIComponent(id)}/entry`);
    if (!r || typeof r !== 'object' || !('entry' in r) || !('savedSize' in r)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /**
   * ENTER THE DRAW of an open release (the same entry again after a withdrawal); plan NEXT LOT §3.6.F: in the size chosen
   * of a draw with sizes (400 DROP_SIZE_REQUIRED without one).
   */
  async enterDrop(id: string, sizeId?: string | null): Promise<ClubEntry> {
    const r = await this.request<{ entry?: ClubEntry }>('POST', `/api/v1/club/drops/${encodeURIComponent(id)}/enter`, sizeId ? { sizeId } : undefined, { csrf: true });
    if (!r?.entry) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entry;
  }

  /** Plan NEXT LOT §3.6.F: an entry's size changed, while entries are open (409 DROP_SIZE_FIXED for a place reserved directly). */
  async changeDrawSize(id: string, sizeId: string): Promise<ClubEntry> {
    const r = await this.request<{ entry?: ClubEntry }>('POST', `/api/v1/club/drops/${encodeURIComponent(id)}/size`, { sizeId }, { csrf: true });
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
   * DROP_TIER_REQUIRED below, 409 outside the early access or once every piece is held); plan NEXT LOT §3.6.F: in the
   * size chosen of a draw with sizes (409 DROP_SIZE_FULL once every piece of it is reserved).
   */
  async reserveDrop(id: string, sizeId?: string | null): Promise<ClubEntry> {
    const r = await this.request<{ entry?: ClubEntry }>('POST', `/api/v1/club/drops/${encodeURIComponent(id)}/reserve`, sizeId ? { sizeId } : undefined, { csrf: true });
    if (!r?.entry) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entry;
  }

  // ── The LIVE RELEASES (plan of 2026-10-04) ───────────────────────────────

  /** THE RELEASES' LIVE half: every LIVE RELEASE announced and not ended, the next opening first; read afresh. */
  async liveReleases(): Promise<LiveCard[]> {
    const r = await this.request<{ releases?: unknown }>('GET', '/api/v1/live');
    if (!Array.isArray(r?.releases)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.releases as LiveCard[];
  }

  /** A LIVE RELEASE's page, each stage from its time (404 DROP_NOT_FOUND for any other id, a draw's included). */
  liveRelease(id: string): Promise<LiveSheet | LiveEndedSheet> {
    return this.request<LiveSheet | LiveEndedSheet>('GET', `/api/v1/live/${encodeURIComponent(id)}`);
  }

  /**
   * The after-room of release `parentId` (plan LIVE RELEASE+, choice 2), for one of its guests from its T0: its page,
   * whose own id the room's routes then take (401 signed out; 404 for anyone else, before its T0, and without one).
   */
  async liveAfterRoom(parentId: string): Promise<LiveSheet | LiveEndedSheet> {
    const r = await this.request<LiveSheet | LiveEndedSheet>('GET', `/api/v1/live/${encodeURIComponent(parentId)}/after-room`);
    if (!r || typeof r.id !== 'string' || r.afterRoom?.parentId !== parentId) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** The server's time, for the page's clock sync (one of its three round trips). */
  async liveClock(): Promise<string> {
    const r = await this.request<{ now?: unknown }>('GET', '/api/v1/live/clock', undefined, { timeoutMs: LIVE_CLOCK_TIMEOUT_MS });
    if (typeof r?.now !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.now;
  }

  /** The room and the account's own standing (401 signed out, 403 LIVE_NOT_ELIGIBLE with the rule in words). */
  async liveState(id: string): Promise<LiveState> {
    const r = await this.request<LiveState>('GET', `/api/v1/live/${encodeURIComponent(id)}/state`, undefined, { timeoutMs: LIVE_STATE_TIMEOUT_MS });
    if (!r?.room || typeof r.now !== 'string' || !r.access) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** The address of a release's stream (SSE: `room` and `you` events), for an EventSource. */
  liveStreamUrl(id: string): string {
    return `${this.base}/api/v1/live/${encodeURIComponent(id)}/stream`;
  }

  /** The account's entries in the LIVE RELEASES, with their releases (MY PIECES). */
  async liveMine(): Promise<LiveAccountEntry[]> {
    const r = await this.request<{ entries?: unknown }>('GET', '/api/v1/live/mine');
    if (!Array.isArray(r?.entries)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entries as LiveAccountEntry[];
  }

  /** The banner of /verify and MY PIECES: the release live now, else the room open, else the next announced; null when none. */
  async liveNext(): Promise<LiveBanner | null> {
    const r = await this.request<{ release?: unknown }>('GET', '/api/v1/live/next');
    if (!r || typeof r !== 'object' || !('release' in r)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return (r.release ?? null) as LiveBanner | null;
  }

  /** I'LL BE THERE, with a size, until T0 (the same again with another size changes it). */
  async liveInterest(id: string, sizeId: string): Promise<LiveInterest> {
    const r = await this.request<{ interest?: LiveInterest }>('PUT', `/api/v1/live/${encodeURIComponent(id)}/interest`, { sizeId }, { csrf: true });
    if (!r?.interest || typeof r.interest.size?.id !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.interest;
  }

  /** I'LL BE THERE withdrawn, until T0. */
  async liveWithdrawInterest(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/live/${encodeURIComponent(id)}/interest`, undefined, { csrf: true });
  }

  /**
   * The boutique board, by its link's secret (from the page's fragment, sent in the body: never in an address or a log);
   * 404 DROP_NOT_FOUND for a secret that is not the release's own, revoked, or a release not announced or over.
   */
  async liveBoard(id: string, token: string): Promise<LiveBoard & { now: string }> {
    const r = await this.request<LiveBoard & { now: string }>('POST', `/api/v1/live/${encodeURIComponent(id)}/board`, { token }, { timeoutMs: LIVE_STATE_TIMEOUT_MS });
    if (typeof r?.now !== 'string' || typeof r.left !== 'number' || !r.release) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /**
   * The board's stream (SSE, `board` events), opened by a POST with the secret in its body: no EventSource can, so the
   * page reads the body itself. Its body, once the server has accepted it; null (204) when the release is over; the same
   * refusals as liveBoard otherwise. It runs until `signal` aborts it, the server ends it, or the network drops it.
   */
  async liveBoardStream(id: string, token: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/api/v1/live/${encodeURIComponent(id)}/board/stream`, {
        method: 'POST',
        headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'The service could not be reached.');
    }
    if (!res.ok) throw toApiError(res.status, await readJson(res));
    if (res.status === 204) return null;
    if (!res.body || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
    return res.body;
  }

  /** ENTER the room (before T0) or the line (after it), with a size and, where the release allows more, a quantity. */
  liveEnter(id: string, sizeId: string, quantity?: number): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'enter', quantity === undefined ? { sizeId } : { sizeId, quantity });
  }

  /** CHANGE SIZE (and quantity), before T0 only (409 LIVE_SIZE_LOCKED from T0 on). */
  liveSize(id: string, sizeId: string, quantity?: number): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'size', quantity === undefined ? { sizeId } : { sizeId, quantity });
  }

  /** LEAVE the room or the line. */
  liveLeave(id: string): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'leave', {});
  }

  /** The seal pressed: the server notes the time with the turn's secret. */
  livePress(id: string, token: string): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'press', { token });
  }

  /** The seal held: the piece secured, when the press is at least 1.4 s old on the server's clock. */
  liveSecure(id: string, token: string): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'secure', { token });
  }

  /** The add-ons of the piece held, all of them at once (none: an empty list). */
  liveAddons(id: string, addonIds: readonly string[]): Promise<LiveEntry> {
    return this.liveAction('PUT', id, 'addons', { addonIds: [...addonIds] });
  }

  /** PAY (a placeholder): the piece held becomes a reservation ORBES Client Services concludes. */
  liveConfirm(id: string): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'confirm', {});
  }

  /** RELEASE MY PLACE: the piece held goes back to the line. */
  liveGiveBack(id: string): Promise<LiveEntry> {
    return this.liveAction('POST', id, 'release', {});
  }

  private async liveAction(method: Method, id: string, action: string, body: Record<string, unknown>): Promise<LiveEntry> {
    const r = await this.request<{ entry?: LiveEntry }>(method, `/api/v1/live/${encodeURIComponent(id)}/${action}`, body, { csrf: true });
    if (!r?.entry || typeof r.entry.status !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.entry;
  }

  // ── The circle (P-X01) ───────────────────────────────────────────────────

  /**
   * A page of the circle's feed, the latest first, without the posts' bodies (403 OWNERS_ONLY without a piece, 401 signed
   * out). Its first page counts a visit, but `visit: false` (NOW's read of its next invitation).
   */
  async circle(page = 1, pageSize = 20, opts: { visit?: boolean } = {}): Promise<CircleFeed> {
    const r = await this.request<CircleFeed>('GET', `/api/v1/club/circle?page=${page}&pageSize=${pageSize}${opts.visit === false ? '&visit=0' : ''}`);
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

  /**
   * CREATE ACCOUNT (plan CUSTOMER INTELLIGENCE §3.1 P.7): the names and the country, and the answer to « How did you
   * hear about ORBES? » when one is chosen (Other's words only with Other); the session it opens.
   */
  async register(input: SignUpInput): Promise<SessionInfo> {
    const body: Record<string, unknown> = { email: input.email, password: input.password, firstName: input.firstName, lastName: input.lastName, country: input.country };
    if (input.heard) body.heard = input.heard.other ? { optionId: input.heard.optionId, other: input.heard.other } : { optionId: input.heard.optionId };
    const s = await this.request<SessionInfo>('POST', '/api/v1/account/register', body);
    this.remember(s);
    return s;
  }

  /** What CREATE ACCOUNT offers (GET /api/v1/account/sign-up): the connection's country to preselect, the answers. */
  async signUpOptions(): Promise<SignUpOptions> {
    const r = await this.request<Partial<SignUpOptions>>('GET', '/api/v1/account/sign-up');
    if (!r || !Array.isArray(r.heard) || (r.country !== null && typeof r.country !== 'string')) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return { country: r.country ?? null, heard: r.heard.filter((o): o is HeardOption => !!o && typeof o.id === 'string' && typeof o.label === 'string' && typeof o.other === 'boolean') };
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

  /** MY PIECES' orders (plan LIVE RELEASE+, choice 6): the account's own, one per piece, the latest first (a 401 when signed out). */
  async orders(): Promise<AccountOrder[]> {
    const r = await this.request<{ orders?: unknown }>('GET', '/api/v1/account/orders');
    if (!Array.isArray(r?.orders)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.orders as AccountOrder[];
  }

  /** One of an order's documents as a PDF, to save (M6): its invoice, its credit note, or its ownership certificate. */
  async orderDocument(orderId: string, document: OrderDocumentKind): Promise<DownloadedFile> {
    const res = await this.send('GET', `/api/v1/account/orders/${encodeURIComponent(orderId)}/${document}.pdf`, undefined, {});
    if (!res.ok) throw toApiError(res.status, await readJson(res));
    const type = res.headers.get('content-type') ?? '';
    const blob = await res.blob();
    if (!type.startsWith('application/pdf') || blob.size === 0 || blob.size > MAX_FILE_BYTES) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
    return { blob, filename: filenameOf(res.headers.get('content-disposition'), `ORBES-${document}.pdf`) };
  }

  /** Another document of an order (plan NEXT LOT §3.6.C: a supplementary invoice, a credit note for single lines), by its number. */
  async orderDocumentByNumber(orderId: string, number: string): Promise<DownloadedFile> {
    const res = await this.send('GET', `/api/v1/account/orders/${encodeURIComponent(orderId)}/documents/${encodeURIComponent(number)}`, undefined, {});
    if (!res.ok) throw toApiError(res.status, await readJson(res));
    const type = res.headers.get('content-type') ?? '';
    const blob = await res.blob();
    if (!type.startsWith('application/pdf') || blob.size === 0 || blob.size > MAX_FILE_BYTES) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
    return { blob, filename: filenameOf(res.headers.get('content-disposition'), `ORBES-${number}.pdf`) };
  }

  /** REQUEST A RETURN or EXCHANGE THE SIZE (plan NEXT LOT §3.6.D): the order case opens at once; the order after it. */
  async requestOrderCase(orderId: string, input: OrderCaseRequest): Promise<AccountOrder> {
    const r = await this.request<{ order?: AccountOrder }>('POST', `/api/v1/account/orders/${encodeURIComponent(orderId)}/case`, input, { csrf: true });
    if (!r?.order || typeof r.order.id !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.order;
  }

  /** An order's engraving (plan NEXT LOT §3.6.C): its words, or null to remove it; the order after it. */
  async setEngraving(orderId: string, text: string | null): Promise<AccountOrder> {
    const path = `/api/v1/account/orders/${encodeURIComponent(orderId)}/engraving`;
    const r = text === null ? await this.request<{ order?: AccountOrder }>('DELETE', path, undefined, { csrf: true }) : await this.request<{ order?: AccountOrder }>('PUT', path, { text }, { csrf: true });
    if (!r?.order || typeof r.order.id !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.order;
  }

  // ── A new claim code on an order (plan NEXT LOT §3.4; API §10.20) ─────────

  /**
   * SHOW THE CODE: the new claim code ORBES Client Services made for the order's piece, answered once (a POST, never on a
   * page load); 409 CLAIM_CODE_UNAVAILABLE once read, withdrawn or no longer to be shown.
   */
  async revealClaimCode(orderId: string): Promise<ClaimCodeReading> {
    const r = await this.request<Partial<ClaimCodeReading>>('POST', `/api/v1/account/orders/${encodeURIComponent(orderId)}/claim-code`, undefined, { csrf: true });
    if (typeof r?.claimCode !== 'string' || r.claimCode.length === 0 || typeof r.productId !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return { claimCode: r.claimCode, productId: r.productId };
  }

  /** SAVE YOUR NEW CARD: the new certificate card of the order's piece, with this claim code (PDF); the code in the body, never in a URL. */
  async newClaimCard(orderId: string, claimCode: string): Promise<DownloadedFile> {
    const path = `/api/v1/account/orders/${encodeURIComponent(orderId)}/claim-card.pdf`;
    let res = await this.send('POST', path, { claimCode }, { csrf: true });
    if (!res.ok) {
      let err = toApiError(res.status, await readJson(res));
      // One CSRF refresh, as request() does: the token may have rotated since it was last seen.
      if (err.code === 'CSRF_FAILED' && (await this.me())) {
        res = await this.send('POST', path, { claimCode }, { csrf: true });
        if (!res.ok) err = toApiError(res.status, await readJson(res));
      }
      if (!res.ok) {
        if (err.status === 401) this.forgetSession();
        throw err;
      }
    }
    const type = res.headers.get('content-type') ?? '';
    const blob = await res.blob();
    if (!type.startsWith('application/pdf') || blob.size === 0 || blob.size > MAX_FILE_BYTES) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
    return { blob, filename: filenameOf(res.headers.get('content-disposition'), 'ORBES-certificate-card.pdf') };
  }

  /** REGISTER THIS PIECE: the order's piece registered to the account with its new claim code, without a scan (a shipped order). */
  registerFromOrder(orderId: string, claimCode: string): Promise<OwnershipConfirmation> {
    return this.request<OwnershipConfirmation>('POST', `/api/v1/account/orders/${encodeURIComponent(orderId)}/register`, { claimCode: claimCode.trim() }, { csrf: true });
  }

  /** The care guide of an order's model (M6): its own words, or null for the house's general care text. */
  async orderCareGuide(orderId: string): Promise<OrderCareGuide> {
    const r = await this.request<{ careGuide?: OrderCareGuide }>('GET', `/api/v1/account/orders/${encodeURIComponent(orderId)}/care-guide`);
    if (!r?.careGuide || typeof r.careGuide.model !== 'string' || (r.careGuide.text !== null && typeof r.careGuide.text !== 'string')) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.careGuide;
  }

  /** The after-sales services of one of the owner's pieces, oldest first; staff notes stay internal. */
  async serviceHistory(productId: string): Promise<ServiceRecord[]> {
    const r = await this.request<{ services?: unknown }>('GET', `/api/v1/products/${encodeURIComponent(productId)}/service-history`);
    if (!Array.isArray(r?.services)) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.services as ServiceRecord[];
  }

  // ── YEARLY CARE (plan NEXT-NINE, BP-19 T6; API §10.18) ──────────────────

  /** The yearly care of one of the account's pieces: its allowance, its request, and the address of the last order. */
  async pieceCare(productId: string): Promise<PieceCare> {
    const r = await this.request<PieceCare>('GET', `/api/v1/account/products/${encodeURIComponent(productId)}/care`);
    if (!r || typeof r.year !== 'number' || typeof r.reason !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** REQUEST YEARLY CARE, with the name and the address the piece returns to. */
  async requestCare(productId: string, name: string, address: string): Promise<PieceCare> {
    const r = await this.request<PieceCare>('POST', `/api/v1/account/products/${encodeURIComponent(productId)}/care`, { name, address }, { csrf: true });
    if (!r || typeof r.year !== 'number') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** CANCEL REQUEST, while it is REQUESTED. */
  async cancelCare(id: string): Promise<PieceCare> {
    const r = await this.request<PieceCare>('POST', `/api/v1/account/care/${encodeURIComponent(id)}/cancel`, undefined, { csrf: true });
    if (!r || typeof r.year !== 'number') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r;
  }

  /** DOWNLOAD LABEL: the prepaid label, as a PDF to save. */
  async careLabel(id: string): Promise<DownloadedFile> {
    const res = await this.send('GET', `/api/v1/account/care/${encodeURIComponent(id)}/label.pdf`, undefined, {});
    if (!res.ok) throw toApiError(res.status, await readJson(res));
    const type = res.headers.get('content-type') ?? '';
    const blob = await res.blob();
    if (!type.startsWith('application/pdf') || blob.size === 0 || blob.size > MAX_FILE_BYTES) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response.');
    return { blob, filename: filenameOf(res.headers.get('content-disposition'), 'ORBES-yearly-care-label.pdf') };
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

  // ── MESSAGES (plan NEXT-NINE, CS-01; API §10.17) ─────────────────────────

  /** The account's conversation with ORBES Client Services, oldest first, and whether an answer is unread (401 signed out). */
  async messages(): Promise<AccountThread> {
    const r = await this.request<{ messages?: unknown; unread?: unknown }>('GET', '/api/v1/account/messages');
    if (!Array.isArray(r?.messages) || typeof r.unread !== 'boolean') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return { messages: r.messages as AccountMessage[], unread: r.unread };
  }

  /** WRITE TO ORBES CLIENT SERVICES: the words, and what they concern (none from MESSAGES). */
  async writeMessage(body: string, context: MessageContextInput | null): Promise<AccountMessage> {
    const r = await this.request<{ message?: AccountMessage }>('POST', '/api/v1/account/messages', context ? { body, context } : { body }, { csrf: true });
    if (!r?.message || typeof r.message.id !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.message;
  }

  /** The conversation read up to `upTo` (the latest message on screen). */
  async readMessages(upTo: string): Promise<void> {
    await this.request('POST', '/api/v1/account/messages/read', { upTo }, { csrf: true });
  }

  /** YOUR SIZES (AC-01): the sizes the account saved, in its units; null where none is. */
  async sizes(): Promise<AccountSizes> {
    const r = await this.request<{ sizes?: AccountSizes }>('GET', '/api/v1/account/sizes');
    if (!r?.sizes || typeof r.sizes !== 'object') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.sizes;
  }

  /** YOUR SIZES saved whole: a kind null is cleared. */
  async saveSizes(sizes: AccountSizes): Promise<AccountSizes> {
    const r = await this.request<{ sizes?: AccountSizes }>('PUT', '/api/v1/account/sizes', { sizes }, { csrf: true });
    if (!r?.sizes || typeof r.sizes !== 'object') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.sizes;
  }

  // ── YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.6.2, P.6.3; API §10.25) ──

  /** YOUR PROFILE: the profile, what may be chosen, the default address in short, how complete it is. */
  async profile(): Promise<AccountProfileView> {
    return checkedProfile(await this.request<AccountProfileView>('GET', '/api/v1/account/profile'));
  }

  /** YOUR PROFILE saved whole, with the version read (409 PROFILE_CHANGED when it changed meanwhile); the profile after it. */
  async saveProfile(input: AccountProfileInput): Promise<AccountProfileView> {
    return checkedProfile(await this.request<AccountProfileView>('PUT', '/api/v1/account/profile', input, { csrf: true }));
  }

  // ── YOUR ADDRESSES and an order's delivery address (plan NEXT LOT §3.6.B; API §10.21) ──

  /** YOUR ADDRESSES: the saved addresses and the registration country. */
  async addresses(): Promise<AccountAddresses> {
    return checkedAddresses(await this.request<AccountAddresses>('GET', '/api/v1/account/addresses'));
  }

  /** ADD AN ADDRESS, the default when asked (MY DEFAULT ADDRESS) or when it is the first. */
  async createAddress(address: DeliveryAddressInput, isDefault: boolean): Promise<AccountAddresses> {
    return checkedAddresses(await this.request<AccountAddresses>('POST', '/api/v1/account/addresses', { ...address, isDefault }, { csrf: true }));
  }

  /** EDIT: an address's four fields, whole. */
  async updateAddress(id: string, address: DeliveryAddressInput): Promise<AccountAddresses> {
    return checkedAddresses(await this.request<AccountAddresses>('PUT', `/api/v1/account/addresses/${encodeURIComponent(id)}`, address, { csrf: true }));
  }

  /** REMOVE: the address deleted (the default removed, the oldest left becomes the default). */
  async removeAddress(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/account/addresses/${encodeURIComponent(id)}`, undefined, { csrf: true });
  }

  /** MAKE DEFAULT. */
  async makeDefaultAddress(id: string): Promise<void> {
    await this.request('POST', `/api/v1/account/addresses/${encodeURIComponent(id)}/default`, {}, { csrf: true });
  }

  /** An order's delivery address: a saved one, or a new one (saved to YOUR ADDRESSES when asked); the order after it. */
  async setOrderAddress(orderId: string, choice: { addressId: string } | { address: DeliveryAddressInput; save: boolean }): Promise<AccountOrder> {
    const r = await this.request<{ order?: AccountOrder }>('PUT', `/api/v1/account/orders/${encodeURIComponent(orderId)}/address`, choice, { csrf: true });
    if (!r?.order || typeof r.order.id !== 'string') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.order;
  }

  /** Whether an answer is unread: NOW's line and the account sheet's NEW. */
  async messagesUnread(): Promise<boolean> {
    const r = await this.request<{ unread?: unknown }>('GET', '/api/v1/account/messages/unread');
    if (typeof r?.unread !== 'boolean') throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
    return r.unread;
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

/** YOUR ADDRESSES as the server answers it, or BAD_RESPONSE. */
/** YOUR PROFILE as the server answers it, or BAD_RESPONSE. */
function checkedProfile(r: AccountProfileView | null | undefined): AccountProfileView {
  if (!r || !r.profile || typeof r.profile.version !== 'number' || !r.options || !Array.isArray(r.options.heard) || !r.completion || typeof r.completion.percent !== 'number') {
    throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
  }
  return r;
}

function checkedAddresses(r: AccountAddresses | undefined): AccountAddresses {
  if (!r || !Array.isArray(r.addresses) || (r.defaultCountry !== null && typeof r.defaultCountry !== 'string')) throw new ApiError(200, 'BAD_RESPONSE', 'Unexpected response.');
  return r;
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
