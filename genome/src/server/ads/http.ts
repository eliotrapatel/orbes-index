/**
 * The advertising client (lot M4, K27 §3.2): the server's one web request out, and only to the ad platforms.
 *
 * Every request is a POST on the global `fetch` (no dependency), to an `https:` URL whose host is one of ADS_HOSTS,
 * checked before anything is sent: no credentials in the URL, no other port, redirects refused (`redirect: 'error'`),
 * at most `timeoutMs` (10 s by default) for the answer and its body, of which 8 KiB at most is read. An error keeps the
 * status and up to AD_EVENT_ERROR_MAX characters of the answer, every token removed (`scrubAdsText`), so it can be stored
 * in `ad_events.last_error` and shown in the console.
 *
 * Base URLs are constructor parameters of the platforms' senders (server/ads/meta.ts, tiktok.ts, google.ts). Tests pass a
 * local fake's `http://127.0.0.1:<port>` and list that origin here (`testOrigins`): only a loopback origin can be listed,
 * so no setting can send an event anywhere else. Production lists none.
 *
 * Nothing calls it while the console's switch is off (TERMS-FACTS N10).
 */
import { AD_EVENT_ERROR_MAX } from '../db/schema.js';

/** The only hosts the server sends a request to: Meta's Graph API, TikTok's Business API, Google Ads' API and OAuth. */
export const ADS_HOSTS = Object.freeze(['graph.facebook.com', 'business-api.tiktok.com', 'googleads.googleapis.com', 'oauth2.googleapis.com'] as const);
export type AdsHost = (typeof ADS_HOSTS)[number];

/** The most of an answer read (bytes); the rest is dropped unread. */
export const ADS_RESPONSE_MAX_BYTES = 8 * 1_024;
/** How long a request and its answer may take, by default (ms). */
export const ADS_TIMEOUT_MS = 10_000;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A platform's answer: its status (2xx), its body as text (cut at ADS_RESPONSE_MAX_BYTES) and its JSON when it is some. */
export interface AdsResponse {
  status: number;
  text: string;
  json: unknown;
  truncated: boolean;
}

/** What a platform answered to an event it took: its status and its answer, as the console shows a test event's. */
export interface AdsSendResult {
  status: number;
  /** `HTTP 200: <answer>`, scrubbed, at most AD_EVENT_ERROR_MAX characters (adsErrorDetail). */
  answer: string;
}

export interface AdsRequestOptions {
  /** Default ADS_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The keys this request carries: each is removed from any error, wherever the answer repeats it. */
  secrets?: readonly string[];
}

/**
 * A request refused or failed: `status` is the platform's (null when nothing was sent, or no answer came), `detail` the
 * line kept for the event and the console: at most AD_EVENT_ERROR_MAX characters, one line, without any token.
 */
export class AdsHttpError extends Error {
  override readonly name = 'AdsHttpError';
  constructor(
    readonly status: number | null,
    readonly detail: string,
    /** True when the request was refused before anything was sent. */
    readonly refused = false,
  ) {
    super(detail);
  }
}

const SECRET_FIELDS = /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token|id[_-]?token|token)(\\?["']?\s*[:=]\s*\\?["']?)[^\s"'&,;}\\]+/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Text of an answer made safe to keep: each listed secret removed wherever it appears, every `access_token=…`,
 * `"refresh_token": "…"`, `client_secret`, `developer_token` and `Bearer …` value removed, control characters turned to
 * spaces and runs of spaces to one.
 */
export function scrubAdsText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret.length > 0) out = out.split(secret).join('[removed]');
  return out
    .replace(SECRET_FIELDS, '$1$2[removed]')
    .replace(BEARER, '$1 [removed]')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
}

/**
 * The line kept of an answer: `HTTP 400: <answer>`, or `NO ANSWER: <why>` when none came; scrubbed, at most
 * AD_EVENT_ERROR_MAX characters. A failed request's error, and a test event's answer in the console.
 */
export function adsErrorDetail(status: number | null, text: string, secrets: readonly string[] = []): string {
  const head = status === null ? 'NO ANSWER' : `HTTP ${status}`;
  const body = scrubAdsText(text, secrets);
  const line = body === '' ? head : `${head}: ${body}`;
  return [...line].length <= AD_EVENT_ERROR_MAX ? line : [...line].slice(0, AD_EVENT_ERROR_MAX - 1).join('') + '…';
}

export interface AdsHttpOptions {
  /**
   * Tests only: local origins (`http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://[::1]:<port>`) a fake
   * platform answers on. Any other origin is refused here, at construction.
   */
  testOrigins?: readonly string[];
}

/** The one outbound client. */
export class AdsHttp {
  private readonly testOrigins: ReadonlySet<string>;

  constructor(opts: AdsHttpOptions = {}) {
    const origins = new Set<string>();
    for (const o of opts.testOrigins ?? []) {
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new Error(`ads: not an origin: ${o}`);
      }
      if (u.protocol !== 'http:' || !LOOPBACK_HOSTS.has(u.hostname) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
        throw new Error(`ads: a test origin is a loopback http origin, not ${o}`);
      }
      origins.add(u.origin);
    }
    this.testOrigins = origins;
  }

  /** Whether a request may go to this URL: https to one of ADS_HOSTS on its default port, or a listed test origin. */
  allows(url: string): boolean {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.username || u.password) return false;
    if (this.testOrigins.has(u.origin)) return true;
    return u.protocol === 'https:' && u.port === '' && (ADS_HOSTS as readonly string[]).includes(u.hostname);
  }

  /** POST a JSON body. */
  postJson(url: string, body: unknown, headers: Readonly<Record<string, string>> = {}, opts: AdsRequestOptions = {}): Promise<AdsResponse> {
    return this.post(url, JSON.stringify(body), 'application/json', headers, opts);
  }

  /** POST a form (application/x-www-form-urlencoded), as OAuth's token endpoint takes it. */
  postForm(url: string, form: Readonly<Record<string, string>>, headers: Readonly<Record<string, string>> = {}, opts: AdsRequestOptions = {}): Promise<AdsResponse> {
    return this.post(url, new URLSearchParams(form).toString(), 'application/x-www-form-urlencoded', headers, opts);
  }

  private async post(url: string, body: string, contentType: string, headers: Readonly<Record<string, string>>, opts: AdsRequestOptions): Promise<AdsResponse> {
    const secrets = opts.secrets ?? [];
    // The host first: nothing is sent anywhere else.
    if (!this.allows(url)) throw new AdsHttpError(null, adsErrorDetail(null, `refused: ${hostOf(url)} is not an ad platform's host`), true);
    const signal = AbortSignal.timeout(opts.timeoutMs ?? ADS_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': contentType, accept: 'application/json' },
        body,
        redirect: 'error',
        signal,
      });
    } catch (err) {
      throw new AdsHttpError(null, adsErrorDetail(null, reasonOf(err), secrets));
    }
    let read: { text: string; truncated: boolean };
    try {
      read = await readCapped(res);
    } catch (err) {
      throw new AdsHttpError(res.status, adsErrorDetail(res.status, reasonOf(err), secrets));
    }
    if (res.status < 200 || res.status > 299) throw new AdsHttpError(res.status, adsErrorDetail(res.status, read.text, secrets));
    let json: unknown = null;
    if (!read.truncated && read.text !== '') {
      try {
        json = JSON.parse(read.text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, text: read.text, json, truncated: read.truncated };
  }
}

/** The answer's body, ADS_RESPONSE_MAX_BYTES at most: the rest is cancelled unread. */
async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  if (res.body === null) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = ADS_RESPONSE_MAX_BYTES - size;
    if (value.byteLength >= room) {
      if (room > 0) chunks.push(value.subarray(0, room));
      size += Math.min(room, value.byteLength);
      truncated = value.byteLength > room;
      if (truncated) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      continue;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)), truncated };
}

/** Why a request failed, in words: the error's own, or its cause's (fetch says "fetch failed" and keeps the reason in its cause). */
function reasonOf(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'an invalid URL';
  }
}
