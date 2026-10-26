/**
 * TikTok's Events API (lot M4, K27 A2): one web event per request to `event/track`.
 *
 * The body is built from one AdEvent (tiktokBody, pure): the pixel, the event's name, time and id, the user's hashed
 * email and hashed external id, the account's `ttclid` when held, the user agent recorded with the consent, and a paid
 * order's value and currency. The access token travels in the `Access-Token` header, never in the URL or the body.
 * The test mode adds the console's `test_event_code` (Events Manager's Test events).
 *
 * TikTok answers HTTP 200 to a refused event too: `code` 0 alone means taken.
 * TIKTOK_API_VERSION is checked on the day conversions are switched on.
 */
import type { TikTokAdsKeys } from '../config.js';
import type { AdEventKind } from '../db/schema.js';
import { latestClick, unixSeconds, valueOf, type AdEvent } from './event.js';
import { AdsHttp, AdsHttpError, adsErrorDetail, type AdsSendResult } from './http.js';

export const TIKTOK_API_VERSION = 'v1.3';
export const TIKTOK_BASE_URL = 'https://business-api.tiktok.com';
/** TikTok takes a web event up to 7 days after it happened; an older one is SKIPPED (TOO_OLD). */
export const TIKTOK_MAX_AGE_DAYS = 7;

/** TikTok's standard event of each act. */
export const TIKTOK_EVENT_NAMES: Readonly<Record<AdEventKind, string>> = Object.freeze({
  SIGNUP: 'CompleteRegistration',
  DRAW_ENTRY: 'SubmitForm',
  LIVE_ENTRY: 'Contact',
  PAID_ORDER: 'CompletePayment',
});

export interface TikTokUser {
  email: string;
  external_id: string;
  ttclid?: string;
  user_agent?: string;
}

export interface TikTokEvent {
  event: string;
  event_time: number;
  event_id: string;
  user: TikTokUser;
  properties?: { value: number; currency: string };
}

export interface TikTokBody {
  event_source: 'web';
  event_source_id: string;
  test_event_code?: string;
  data: [TikTokEvent];
}

/** The body of one event. */
export function tiktokBody(event: AdEvent, opts: { pixelCode: string; testEventCode?: string | null }): TikTokBody {
  const value = valueOf(event);
  const user: TikTokUser = { email: event.emailSha256, external_id: event.externalIdSha256 };
  const click = latestClick(event, ['TTCLID']);
  if (click !== null) user.ttclid = click.id;
  if (event.userAgent !== null) user.user_agent = event.userAgent;
  const data: TikTokEvent = { event: TIKTOK_EVENT_NAMES[event.kind], event_time: unixSeconds(event.at), event_id: event.id, user };
  if (value !== null) data.properties = value;
  return opts.testEventCode
    ? { event_source: 'web', event_source_id: opts.pixelCode, test_event_code: opts.testEventCode, data: [data] }
    : { event_source: 'web', event_source_id: opts.pixelCode, data: [data] };
}

export function tiktokUrl(baseUrl: string): string {
  return `${baseUrl}/open_api/${TIKTOK_API_VERSION}/event/track/`;
}

export class TikTokSender {
  constructor(
    private readonly keys: TikTokAdsKeys,
    private readonly http: AdsHttp,
    private readonly opts: { baseUrl?: string } = {},
  ) {}

  /** Sends one event; with `testEventCode`, in TikTok's test mode. Throws AdsHttpError when TikTok refuses it. */
  async send(event: AdEvent, opts: { testEventCode?: string | null } = {}): Promise<AdsSendResult> {
    const secrets = [this.keys.accessToken];
    const body = tiktokBody(event, { pixelCode: this.keys.pixelCode, testEventCode: opts.testEventCode ?? null });
    const res = await this.http.postJson(tiktokUrl(this.opts.baseUrl ?? TIKTOK_BASE_URL), body, { 'access-token': this.keys.accessToken }, { secrets });
    if ((res.json as { code?: unknown } | null)?.code !== 0) throw new AdsHttpError(res.status, adsErrorDetail(res.status, res.text, secrets));
    return { status: res.status, answer: adsErrorDetail(res.status, res.text, secrets) };
  }
}
