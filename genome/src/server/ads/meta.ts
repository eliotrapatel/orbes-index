/**
 * Meta's Conversions API (lot M4, K27 A2): one event per request to the dataset's `/events` edge.
 *
 * The body is built from one AdEvent (metaBody, pure): the event's name, time, id and action source (website) with the
 * platform's own address, the user's hashed email, hashed external id and hashed country, `fbc` built from the
 * account's `fbclid` and the time it was read, the user agent recorded with the consent, and a paid order's value and
 * currency. The access token travels in the POST body, never in the URL. The test mode adds the console's
 * `test_event_code`, so the event shows in Events Manager's Test events and is not counted.
 *
 * META_GRAPH_VERSION is checked on the day conversions are switched on: Meta retires its versions.
 */
import type { MetaAdsKeys } from '../config.js';
import type { AdEventKind } from '../db/schema.js';
import { latestClick, sha256Hex, unixSeconds, valueOf, type AdEvent } from './event.js';
import { AdsHttp, AdsHttpError, adsErrorDetail, type AdsSendResult } from './http.js';

export const META_GRAPH_VERSION = 'v24.0';
export const META_BASE_URL = 'https://graph.facebook.com';
/** Meta takes a website event up to 7 days after it happened; an older one is SKIPPED (TOO_OLD). */
export const META_MAX_AGE_DAYS = 7;

/** Meta's standard event of each act. */
export const META_EVENT_NAMES: Readonly<Record<AdEventKind, string>> = Object.freeze({
  SIGNUP: 'CompleteRegistration',
  DRAW_ENTRY: 'SubmitApplication',
  LIVE_ENTRY: 'Lead',
  PAID_ORDER: 'Purchase',
});

export interface MetaUserData {
  em: [string];
  external_id: [string];
  country?: [string];
  fbc?: string;
  client_user_agent?: string;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: MetaUserData;
  custom_data?: { value: number; currency: string };
}

export interface MetaBody {
  data: [MetaEvent];
  access_token: string;
  test_event_code?: string;
}

/** `fb.1.<when the fbclid was read, ms>.<fbclid>`, as Meta builds its click cookie. */
export function metaFbc(fbclid: string, at: Date): string {
  return `fb.1.${at.getTime()}.${fbclid}`;
}

/**
 * The body of one event. `sourceUrl` is the platform's own address (PUBLIC_ORIGIN), which Meta asks of a website
 * event; it names no page and no person.
 */
export function metaBody(event: AdEvent, opts: { accessToken: string; sourceUrl: string; testEventCode?: string | null }): MetaBody {
  const value = valueOf(event);
  const user: MetaUserData = { em: [event.emailSha256], external_id: [event.externalIdSha256] };
  if (event.country !== null) user.country = [sha256Hex(event.country.toLowerCase())];
  const click = latestClick(event, ['FBCLID']);
  if (click !== null) user.fbc = metaFbc(click.id, click.at);
  if (event.userAgent !== null) user.client_user_agent = event.userAgent;
  const data: MetaEvent = {
    event_name: META_EVENT_NAMES[event.kind],
    event_time: unixSeconds(event.at),
    event_id: event.id,
    action_source: 'website',
    event_source_url: opts.sourceUrl,
    user_data: user,
  };
  if (value !== null) data.custom_data = value;
  const body: MetaBody = { data: [data], access_token: opts.accessToken };
  if (opts.testEventCode) body.test_event_code = opts.testEventCode;
  return body;
}

/** The dataset's events edge (no token in it). */
export function metaUrl(baseUrl: string, datasetId: string): string {
  return `${baseUrl}/${META_GRAPH_VERSION}/${encodeURIComponent(datasetId)}/events`;
}

export class MetaSender {
  constructor(
    private readonly keys: MetaAdsKeys,
    private readonly http: AdsHttp,
    private readonly opts: { sourceUrl: string; baseUrl?: string },
  ) {}

  /** Sends one event; with `testEventCode`, in Meta's test mode. Throws AdsHttpError when Meta refuses it. */
  async send(event: AdEvent, opts: { testEventCode?: string | null } = {}): Promise<AdsSendResult> {
    const secrets = [this.keys.accessToken];
    const body = metaBody(event, { accessToken: this.keys.accessToken, sourceUrl: this.opts.sourceUrl, testEventCode: opts.testEventCode ?? null });
    const res = await this.http.postJson(metaUrl(this.opts.baseUrl ?? META_BASE_URL, this.keys.datasetId), body, {}, { secrets });
    // A 2xx answer counts the event received.
    const received = (res.json as { events_received?: unknown } | null)?.events_received;
    if (received !== 1) throw new AdsHttpError(res.status, adsErrorDetail(res.status, res.text, secrets));
    return { status: res.status, answer: adsErrorDetail(res.status, res.text, secrets) };
  }
}
