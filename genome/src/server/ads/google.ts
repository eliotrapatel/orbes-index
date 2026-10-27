/**
 * Google Ads' offline click conversions, with enhanced conversions' hashed email (lot M4, K27 A2): one conversion per
 * `uploadClickConversions` request.
 *
 * The body is built from one AdEvent (googleBody, pure): the owner's conversion action of the act (entered in the
 * console), its time, the account's Google click id (the latest `gclid`, `gbraid` or `wbraid`; Google takes one, and
 * a conversion without any is SKIPPED, NO_CLICK_ID), the event id as `orderId` (Google deduplicates a retry by it), a
 * paid order's value and currency, the hashed email beside a `gclid`, and the user's consent to the data sent
 * (GRANTED: nothing is sent otherwise). The test mode is `validateOnly`: Google checks the upload and records nothing.
 *
 * Every request carries an OAuth access token, obtained from the refresh token at `oauth2.googleapis.com/token` and
 * kept in memory until shortly before it expires, with the `developer-token` header and, when the customer is reached
 * through a manager account, `login-customer-id`. Google answers HTTP 200 to a refused conversion too: a
 * `partialFailureError` says so.
 *
 * GOOGLE_ADS_API_VERSION is checked on the day conversions are switched on: Google retires its versions.
 */
import type { GoogleAdsKeys } from '../config.js';
import { ADS_GOOGLE_ACTION_PATTERN } from '../db/schema.js';
import { latestClick, valueOf, type AdClick, type AdEvent } from './event.js';
import { AdsHttp, AdsHttpError, adsErrorDetail, type AdsSendResult } from './http.js';

export const GOOGLE_ADS_API_VERSION = 'v22';
export const GOOGLE_ADS_BASE_URL = 'https://googleads.googleapis.com';
export const GOOGLE_OAUTH_BASE_URL = 'https://oauth2.googleapis.com';
/** Google takes a click conversion up to 90 days after its click; an older act is SKIPPED (TOO_OLD). */
export const GOOGLE_MAX_AGE_DAYS = 90;
/** An access token is renewed this long before Google says it expires (ms). */
export const GOOGLE_TOKEN_MARGIN_MS = 60_000;

export interface GoogleConversion {
  conversionAction: string;
  conversionDateTime: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  orderId: string;
  conversionValue?: number;
  currencyCode?: string;
  userIdentifiers?: [{ hashedEmail: string }];
  consent: { adUserData: 'GRANTED' };
}

export interface GoogleBody {
  conversions: [GoogleConversion];
  partialFailure: true;
  validateOnly: boolean;
}

/** The Google click id a conversion is attributed to: the latest the account holds, or null (NO_CLICK_ID). */
export function googleClick(event: Pick<AdEvent, 'clicks'>): AdClick | null {
  return latestClick(event, ['GCLID', 'GBRAID', 'WBRAID']);
}

/** `yyyy-mm-dd hh:mm:ss+00:00`, as Google takes a conversion's time. */
export function googleDateTime(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
}

/** The body of one conversion, for the act's conversion action. Throws when the account holds no Google click id. */
export function googleBody(event: AdEvent, opts: { conversionAction: string; validateOnly: boolean }): GoogleBody {
  if (!ADS_GOOGLE_ACTION_PATTERN.test(opts.conversionAction)) throw new Error('ads: not a Google Ads conversion action');
  const click = googleClick(event);
  if (click === null) throw new Error('ads: a Google conversion needs a Google click id');
  const value = valueOf(event);
  const c: GoogleConversion = { conversionAction: opts.conversionAction, conversionDateTime: googleDateTime(event.at), orderId: event.id, consent: { adUserData: 'GRANTED' } };
  if (click.kind === 'GCLID') c.gclid = click.id;
  else if (click.kind === 'GBRAID') c.gbraid = click.id;
  else c.wbraid = click.id;
  if (value !== null) {
    c.conversionValue = value.value;
    c.currencyCode = value.currency;
  }
  // Enhanced conversions match the hashed email beside a gclid; an app's gbraid or wbraid carries the click alone.
  if (click.kind === 'GCLID') c.userIdentifiers = [{ hashedEmail: event.emailSha256 }];
  return { conversions: [ordered(c)], partialFailure: true, validateOnly: opts.validateOnly };
}

/** The conversion's fields in one fixed order, whichever were set. */
function ordered(c: GoogleConversion): GoogleConversion {
  const out: Partial<GoogleConversion> = {};
  for (const k of ['conversionAction', 'conversionDateTime', 'gclid', 'gbraid', 'wbraid', 'orderId', 'conversionValue', 'currencyCode', 'userIdentifiers', 'consent'] as const) {
    if (c[k] !== undefined) (out as Record<string, unknown>)[k] = c[k];
  }
  return out as GoogleConversion;
}

export function googleUrl(baseUrl: string, customerId: string): string {
  return `${baseUrl}/${GOOGLE_ADS_API_VERSION}/customers/${encodeURIComponent(customerId)}:uploadClickConversions`;
}

export function googleTokenUrl(oauthBaseUrl: string): string {
  return `${oauthBaseUrl}/token`;
}

export class GoogleSender {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly keys: GoogleAdsKeys,
    private readonly http: AdsHttp,
    private readonly opts: { baseUrl?: string; oauthBaseUrl?: string; now?: () => number } = {},
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private secrets(): string[] {
    return [this.keys.refreshToken, this.keys.clientSecret, this.keys.developerToken, ...(this.token ? [this.token.value] : [])];
  }

  /** An access token: the one in memory while it is good, else a new one from the refresh token. */
  async accessToken(): Promise<string> {
    if (this.token !== null && this.token.expiresAt - GOOGLE_TOKEN_MARGIN_MS > this.now()) return this.token.value;
    this.token = null;
    const res = await this.http.postForm(
      googleTokenUrl(this.opts.oauthBaseUrl ?? GOOGLE_OAUTH_BASE_URL),
      { grant_type: 'refresh_token', client_id: this.keys.clientId, client_secret: this.keys.clientSecret, refresh_token: this.keys.refreshToken },
      {},
      { secrets: this.secrets() },
    );
    const answer = res.json as { access_token?: unknown; expires_in?: unknown } | null;
    const value = answer?.access_token;
    const expiresIn = answer?.expires_in;
    if (typeof value !== 'string' || !/^[!-~]{1,4096}$/.test(value) || typeof expiresIn !== 'number' || !(expiresIn > 0)) {
      throw new AdsHttpError(res.status, adsErrorDetail(res.status, `no access token in the answer: ${res.text}`, [...this.secrets(), ...(typeof value === 'string' ? [value] : [])]));
    }
    this.token = { value, expiresAt: this.now() + expiresIn * 1_000 };
    return value;
  }

  /** Uploads one conversion; with `validateOnly`, in Google's test mode. Throws AdsHttpError when Google refuses it. */
  async send(event: AdEvent, opts: { conversionAction: string; validateOnly?: boolean }): Promise<AdsSendResult> {
    const body = googleBody(event, { conversionAction: opts.conversionAction, validateOnly: opts.validateOnly ?? false });
    const token = await this.accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'developer-token': this.keys.developerToken };
    if (this.keys.loginCustomerId !== null) headers['login-customer-id'] = this.keys.loginCustomerId;
    let res;
    try {
      res = await this.http.postJson(googleUrl(this.opts.baseUrl ?? GOOGLE_ADS_BASE_URL, this.keys.customerId), body, headers, { secrets: this.secrets() });
    } catch (err) {
      // A token Google no longer takes is dropped: the next attempt asks for a new one.
      if (err instanceof AdsHttpError && err.status === 401) this.token = null;
      throw err;
    }
    const failure = (res.json as { partialFailureError?: { code?: unknown } } | null)?.partialFailureError;
    if (res.json === null || (failure !== undefined && failure !== null && failure.code !== 0)) throw new AdsHttpError(res.status, adsErrorDetail(res.status, res.text, this.secrets()));
    return { status: res.status, answer: adsErrorDetail(res.status, res.text, this.secrets()) };
  }
}
