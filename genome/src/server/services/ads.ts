/**
 * The server-side conversions to Meta, TikTok and Google (macro scope of 2026-10-20, K27 A1 to A5; lot M4 plan §3.1,
 * §3.2, §3.7; migration 0065), built and switched off: off (the default, and the state at deployment), nothing is
 * captured, queued, sent or shown. One console setting (ADMIN, Links → Ad platforms) switches it on.
 *
 *   state      `state(deviceId, accountId)` → `{ on, choice, textVersion }`: the account's latest choice when signed in,
 *              else the device's; `textVersion` the advertising text's version in force (ADS_TEXT_VERSION).
 *   choose     a collector's choice (A4), the banner's (BANNER) or ACCOUNT's (ACCOUNT): 409 ADS_OFF while off; a new
 *              `ad_consents` row each time (never changed: the proof of consent), with the advertising text's version
 *              and, with GRANTED only, the browser's user agent and the platforms' click ids the address carried
 *              (`ad_clicks`); a DECLINED erases the device's and the account's click ids and cancels the account's
 *              events still QUEUED (withdrawal stops every later event). Not audited: the row is the record, as a vote.
 *   carry      at a sign-up and a sign-in, inside TrackingService.link's transaction (context.ts): a choice the device
 *              made signed out becomes the account's (a new row, at the time it was made) when the account holds none
 *              newer; the device's click ids then take the account (or, when the account's choice is DECLINED, go).
 *   switch     `setSwitch(on, phrase, actor)` (ADMIN, the typed phrase SWITCH ON / SWITCH OFF): on with no platform's
 *              keys in the server's .env is refused (409 ADS_NO_PLATFORM); the first on sets `events_from` (no act
 *              before it is ever sent: no backfill); each on sets the watermark to now (nothing done while off is ever
 *              queued); off cancels every QUEUED event. `setChannelPlatforms` (a link channel mapped to its platforms),
 *              `setGoogleActions` (each act's Google Ads conversion action), `setTestCodes` (Meta's and TikTok's test
 *              event codes), `sendTest(platform)` (ADMIN, only while on: one test event in the platform's test mode, its
 *              answer shown). Audited `ads.switch`, `ads.channels`, `ads.google_actions`, `ads.test_codes`, `ads.test`:
 *              never a key, never an account.
 *   enqueue    the housekeeping's, right after `recordConversions`, only while on: the conversions written since the
 *              watermark, and the ORDER conversions whose order became PAID since the last pass (a paid order is one
 *              act, PAID_ORDER, at its payment, with its value), each acted since the switch on (never before
 *              `events_from`: no backfill; nothing done while off). For each, the platforms
 *              it goes to: only those the collector came from, its last link's channel mapped to the platform or the
 *              account holding that platform's click id clicked within AD_CLICK_WINDOW_DAYS before the act. Never every
 *              platform for every act. Then the consent at the act's time (the account's latest choice made at or before
 *              it: GRANTED only) and the exclusions (test entrants, the team's own accounts, an account not ACTIVE, an
 *              order adsSendsFor leaves out); one row per platform: QUEUED, or SKIPPED with its reason (NOT_READY: the
 *              platform's keys missing, or Google's action for the act not named; NO_CLICK_ID: a Google event without
 *              any Google click id; TOO_OLD: past the platform's age). Its event id is `orbes-<conversion id>`, so a
 *              platform deduplicates a retry. A pass repeated, or overlapping the last one by ENQUEUE_OVERLAP_MS (a row
 *              that committed late), writes nothing twice (`ad_events_key`).
 *   sendDue    every ADS_SENDER.intervalMs (context.ts starts it when a platform has its keys; it does nothing while
 *              off): per platform, the QUEUED events due, ADS_SENDER.batch at most, claimed (attempt counted, a lease
 *              ahead), the account's consent read again (withdrawn, or the account no longer counted: CANCELLED), the
 *              age (TOO_OLD) and the platform's readiness read again, then sent; refused or unanswered, tried again after
 *              1 min, 5 min, 30 min, 2 h, then FAILED. Logs `ad event sent` / `ad event failed` with the platform, kind
 *              and id; never the email nor a key.
 *   purge      the housekeeping's: events AD_EVENT_RETENTION_DAYS after they settled, click ids AD_CLICK_RETENTION_DAYS
 *              after the click, a device's choices made signed out 13 months after they were made (the visits'
 *              months); an account's choices are kept with the account (the proof of consent).
 *   lock       `cancelAccountAdEvents` (OwnerService.lock, in its transaction): the account's QUEUED events cancelled.
 *   access     `accountAdsData` (the right of access, OwnerService.exportData): the account's choices (choice, source,
 *              time, text version), its click ids (kind, time; the id itself), its events (platform, kind, status,
 *              times), and how long each is kept.
 *   console    `read()`: the switch, each platform's readiness (true or false, never a key), API version, last send and
 *              last error, its events counted by status, its test code; the channels and their platforms, the Google
 *              actions, the choices of this Paris month. `events()`: the latest events (kind, platform, status, times,
 *              error); no account, no email.
 *
 * What a platform receives is server/ads/event.ts's AdEvent and nothing else (§3.1); the one outbound client is
 * server/ads/http.ts. A store's order (`shopify_order_id` set) is the store's to report (§3.7, S2): adsSendsFor.
 */
import { sql } from 'kysely';
import type { AdsConfig } from '../config.js';
import { inTransaction, type Db } from '../db/connection.js';
import {
  AD_CLICK_KINDS,
  AD_CLICK_ID_MAX,
  AD_EVENT_ERROR_MAX,
  AD_EVENT_STATUSES,
  AD_USER_AGENT_MAX,
  ADS_GOOGLE_ACTION_PATTERN,
  ADS_PLATFORMS,
  ADS_TEST_EVENT_CODE_MAX,
  type AdClickKind,
  type AdConsentChoice,
  type AdConsentSource,
  type AdEventKind,
  type AdEventStatus,
  type AdSkipReason,
  type AdsPlatform,
  type ConversionKind,
  type OrderRow,
} from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { adEventId, adsExternalIdKey, hashedExternalId, hashEmail, type AdClick, type AdEvent } from '../ads/event.js';
import { GOOGLE_ADS_API_VERSION, GOOGLE_MAX_AGE_DAYS, GoogleSender } from '../ads/google.js';
import { AdsHttp, AdsHttpError, adsErrorDetail, type AdsSendResult } from '../ads/http.js';
import { META_GRAPH_VERSION, META_MAX_AGE_DAYS, MetaSender } from '../ads/meta.js';
import { TIKTOK_API_VERSION, TIKTOK_MAX_AGE_DAYS, TikTokSender } from '../ads/tiktok.js';
import { noopLogger, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import type { AuditService } from './audit.js';
import { houseAccount, notTestEntrant } from './population.js';
import { parisDay, parisMonthStart } from './schedule.js';
import { viewHistoryCutoff } from './tracking.js';

/**
 * The advertising text's version (web/legal/content/privacy-ads.ts ADS_TEXT_VERSION), recorded with each choice. The
 * server cannot read the web's files (Dockerfile): test/services/ads.test.ts holds the two equal.
 */
export const ADS_TEXT_VERSION = '2026-10-26';

/** The phrases the console's switch asks for. */
export const ADS_SWITCH_PHRASES = Object.freeze({ on: 'SWITCH ON', off: 'SWITCH OFF' });

/** The sender's rhythm: a pass every 30 s, 50 events a platform a pass at most, the retries' delays, a claim's lease. */
export const ADS_SENDER = Object.freeze({
  intervalMs: 30_000,
  batch: 50,
  /** After the 1st, 2nd, 3rd and 4th failed attempt; the 5th failure is final (FAILED). */
  retryMs: Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]),
  /** How long a claimed event is kept from another sender while it is being sent. */
  leaseMs: 10 * 60_000,
});

/** A click id counts for an act clicked at most this many days before it. */
export const AD_CLICK_WINDOW_DAYS = 90;
/** An event is erased this many days after it settled (sent, failed, skipped or cancelled). */
export const AD_EVENT_RETENTION_DAYS = 90;
/** A click id is erased this many days after the click. */
export const AD_CLICK_RETENTION_DAYS = 90;
/** The candidates' window reaches back this far before the watermark: a row that committed a little late is still judged. */
export const ENQUEUE_OVERLAP_MS = 60 * 60_000;
/** The console's list of events, at most. */
export const AD_EVENTS_LIST_MAX = 100;

/** How old an act may be when its event goes: Meta and TikTok take 7 days, Google 90 (older: SKIPPED, TOO_OLD). */
export const AD_MAX_AGE_DAYS: Readonly<Record<AdsPlatform, number>> = Object.freeze({ META: META_MAX_AGE_DAYS, TIKTOK: TIKTOK_MAX_AGE_DAYS, GOOGLE: GOOGLE_MAX_AGE_DAYS });
/** Each platform's API version, pinned in its sender and checked on the day conversions are switched on. */
export const ADS_API_VERSIONS: Readonly<Record<AdsPlatform, string>> = Object.freeze({ META: META_GRAPH_VERSION, TIKTOK: TIKTOK_API_VERSION, GOOGLE: GOOGLE_ADS_API_VERSION });
/** The click ids of each platform. */
export const PLATFORM_CLICKS: Readonly<Record<AdsPlatform, readonly AdClickKind[]>> = Object.freeze({ META: ['FBCLID'], TIKTOK: ['TTCLID'], GOOGLE: ['GCLID', 'GBRAID', 'WBRAID'] });
/** The address's parameter of each click id (web/verify/arrival.ts reads these). */
export const CLICK_PARAMS: Readonly<Record<AdClickKind, string>> = Object.freeze({ FBCLID: 'fbclid', TTCLID: 'ttclid', GCLID: 'gclid', GBRAID: 'gbraid', WBRAID: 'wbraid' });

/** The act a conversion's event reports: an ORDER conversion is sent once its order is paid, as PAID_ORDER. */
export const EVENT_KIND_OF: Readonly<Record<ConversionKind, AdEventKind>> = Object.freeze({ SIGNUP: 'SIGNUP', DRAW_ENTRY: 'DRAW_ENTRY', LIVE_ENTRY: 'LIVE_ENTRY', ORDER: 'PAID_ORDER' });

/** The Google Ads conversion action's column of each act. */
const GOOGLE_ACTION_COLUMN = {
  SIGNUP: 'google_action_signup',
  DRAW_ENTRY: 'google_action_draw_entry',
  LIVE_ENTRY: 'google_action_live_entry',
  PAID_ORDER: 'google_action_paid_order',
} as const satisfies Record<AdEventKind, string>;

/** The words kept on an event cancelled, by why. */
export const AD_CANCELLED_WORDS = Object.freeze({
  switchedOff: 'Conversions were switched off.',
  withdrawn: 'The collector withdrew their consent.',
  notCounted: 'The account is no longer active or counted.',
  locked: 'The account was locked.',
});

/** How long each part of the right of access is kept (its retention statements). */
export const AD_RETENTION_WORDS: readonly string[] = Object.freeze([
  'Each advertising choice is kept with the account, as the proof of consent; a choice made on a device while signed out is kept 13 months.',
  `Each click id is kept ${AD_CLICK_RETENTION_DAYS} days after the click.`,
  `Each event is kept ${AD_EVENT_RETENTION_DAYS} days after it was sent, failed, skipped or cancelled.`,
]);

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A click id as the address carries it: 1 to AD_CLICK_ID_MAX printable characters, no space. */
const CLICK_ID = new RegExp(`^[!-~]{1,${AD_CLICK_ID_MAX}}$`);
/** The house's test address, hashed in a test event: never a collector's. */
const TEST_EMAIL = 'ads-test@theorbes.com';

// ── Shapes ─────────────────────────────────────────────────────────────────

/** What the collector app reads (GET /api/v1/consent, GET /api/v1/account/ads-consent). */
export interface AdsState {
  on: boolean;
  /** The account's latest choice when signed in, else the device's; null: none. */
  choice: AdConsentChoice | null;
  /** The advertising text's version in force. */
  textVersion: string;
}

/** The click ids the address carried, by their parameter (`fbclid`, `ttclid`, `gclid`, `gbraid`, `wbraid`). */
export type ClickParams = Partial<Record<(typeof CLICK_PARAMS)[AdClickKind], string>>;

export interface ChooseInput {
  /** The device (tracking_devices.id), or its pseudonym (`deviceHash`: its row written when the choice is). */
  deviceId?: number | null;
  deviceHash?: string | null;
  accountId: string | null;
  choice: AdConsentChoice;
  source: AdConsentSource;
  userAgent: string | null;
  clicks?: ClickParams | null;
}

export interface AdsPlatformView {
  platform: AdsPlatform;
  /** Its keys are in the server's .env: true or false, never a key. */
  ready: boolean;
  apiVersion: string;
  lastSentAt: Date | null;
  lastError: { error: string; at: Date } | null;
  counts: Record<AdEventStatus, number>;
  /** Meta's and TikTok's test event code; null for Google (its test mode is validateOnly). */
  testCode: string | null;
}

export interface AdsSettingsView {
  on: boolean;
  eventsFrom: Date | null;
  switchedAt: Date | null;
  switchedBy: { id: string; email: string } | null;
  phrases: { on: string; off: string };
  platforms: AdsPlatformView[];
  channels: { id: string; name: string; platforms: AdsPlatform[] }[];
  googleActions: Record<AdEventKind, string | null>;
  /** The choices made this Paris month. */
  consent: { month: string; granted: number; declined: number };
}

export interface AdEventView {
  id: number;
  platform: AdsPlatform;
  kind: AdEventKind;
  status: AdEventStatus;
  skipReason: AdSkipReason | null;
  attempts: number;
  createdAt: Date;
  notBefore: Date;
  sentAt: Date | null;
  settledAt: Date | null;
  lastError: string | null;
}

export interface AdsTestResult {
  platform: AdsPlatform;
  ok: boolean;
  /** The platform's HTTP status; null when no answer came. */
  status: number | null;
  /** Its answer, scrubbed of every key, at most AD_EVENT_ERROR_MAX characters. */
  answer: string;
}

export interface EnqueueReport {
  queued: number;
  skipped: number;
}

export interface AdsSendReport {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

/** The right of access's part (OwnerService.exportData `advertising`). */
export interface ExportedAdvertising {
  choices: { choice: AdConsentChoice; source: AdConsentSource; chosenAt: Date; textVersion: string }[];
  clicks: { kind: AdClickKind; clickedAt: Date; clickId: string }[];
  events: { platform: AdsPlatform; kind: AdEventKind; status: AdEventStatus; createdAt: Date; sentAt: Date | null; settledAt: Date | null }[];
  /** How long each is kept. */
  retention: string[];
}

/** One platform's sender, as the service uses it (server/ads/meta.ts, tiktok.ts, google.ts). */
export interface AdsPlatformSender {
  send(event: AdEvent, opts: { testEventCode?: string | null; conversionAction?: string; validateOnly?: boolean }): Promise<AdsSendResult>;
}

export interface AdsServiceDeps {
  db: Db;
  audit: AuditService;
  /** The platforms' keys (config.ads): a platform is ready when its keys are set. */
  keys: AdsConfig;
  /** COOKIE_SECRET, the external id's key's root (server/ads/event.ts). */
  cookieSecret: string;
  /** PUBLIC_ORIGIN, Meta's `event_source_url`. */
  publicOrigin: string;
  clock?: Clock;
  log?: Logger;
  /**
   * Tests only: a local fake's origin (test/support/fake-ads.ts), every platform's base URL and the client's one test
   * origin. Production gives none: the platforms' own hosts.
   */
  testOrigin?: string;
  /** Tests only: the senders themselves. */
  senders?: Partial<Record<AdsPlatform, AdsPlatformSender>>;
}

// ── The predicates ─────────────────────────────────────────────────────────

/**
 * Whether the platform reports an order's payment (§3.1, §3.7; one predicate, as M1's platformSendsOrderEmails): never a
 * welcome GIFT nor a size EXCHANGE, never a VAULT order at 0 (won, not bought; a RIGHT TO BUY order is a purchase like
 * any), never an order paid on the Shopify store (its own channel apps and consent report it, S2).
 */
export function adsSendsFor(order: Pick<OrderRow, 'channel' | 'price_minor' | 'shopify_order_id' | 'exchange_of_order_id'>): boolean {
  if (order.channel === 'GIFT' || order.channel === 'EXCHANGE' || order.exchange_of_order_id !== null) return false;
  if (order.channel === 'VAULT' && order.price_minor !== null && Number(order.price_minor) === 0) return false;
  return order.shopify_order_id === null;
}

/** The platforms an act goes to: those its last link's channel maps to, and those whose click id the account held. */
export function platformsFor(mapped: readonly string[], clickKinds: readonly string[]): AdsPlatform[] {
  return ADS_PLATFORMS.filter((p) => mapped.includes(p) || PLATFORM_CLICKS[p].some((k) => clickKinds.includes(k)));
}

/** The click ids of the address (`fbclid` …), checked, by their kind; an empty or malformed one is dropped. */
export function clicksOf(params: ClickParams | null | undefined): { kind: AdClickKind; id: string }[] {
  const out: { kind: AdClickKind; id: string }[] = [];
  if (!params) return out;
  for (const kind of AD_CLICK_KINDS) {
    const id = params[CLICK_PARAMS[kind]];
    if (typeof id === 'string' && CLICK_ID.test(id)) out.push({ kind, id });
  }
  return out;
}

/** A user agent as a choice records it: trimmed, one line, at most AD_USER_AGENT_MAX characters; null when empty. */
export function recordedUserAgent(userAgent: string | null | undefined): string | null {
  if (typeof userAgent !== 'string') return null;
  const one = userAgent.replace(/[\p{Cc}]/gu, ' ').trim();
  return one === '' ? null : [...one].slice(0, AD_USER_AGENT_MAX).join('');
}

function adminOf(actor: Actor): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID.test(actor.id)) throw forbidden('Only ORBES staff change the ad platforms.');
  return actor.id;
}

/** 409 ADS_OFF: a choice while the switch is off. */
export const adsOff = () => conflict('ADS_OFF', 'Conversions are off: there is no advertising choice to make.');
const noPlatform = (detail: string) => conflict('ADS_NO_PLATFORM', detail);
const channelNotFound = () => notFound('Channel', 'CHANNEL_NOT_FOUND');

function errorWords(e: unknown): { status: number | null; detail: string; refused: boolean } {
  if (e instanceof AdsHttpError) return { status: e.status, detail: e.detail.slice(0, AD_EVENT_ERROR_MAX) || 'failed', refused: e.refused };
  const text = adsErrorDetail(null, String((e as Error)?.message ?? e));
  return { status: null, detail: text.slice(0, AD_EVENT_ERROR_MAX) || 'failed', refused: true };
}

/** One candidate act of enqueue. */
interface Candidate {
  conversion_id: string | number;
  kind: ConversionKind;
  act_at: Date;
  mapped: string[] | null;
  click_kinds: string[] | null;
  consent: AdConsentChoice | null;
  channel: OrderRow['channel'] | null;
  price_minor: string | number | null;
  shopify_order_id: string | null;
  exchange_of_order_id: string | null;
}

/** A claimed event with what sending it needs. */
interface Claimed {
  id: string | number;
  platform: AdsPlatform;
  conversion_id: string | number;
  kind: AdEventKind;
  attempts: number;
}

// ── The service ────────────────────────────────────────────────────────────

export class AdsService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly keys: AdsConfig;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly externalKey: Uint8Array;
  private readonly senders: Partial<Record<AdsPlatform, AdsPlatformSender>>;
  private timer: NodeJS.Timeout | null = null;
  private timers = false;
  private running: Promise<void> | null = null;

  constructor(deps: AdsServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.keys = deps.keys;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.externalKey = adsExternalIdKey(deps.cookieSecret);
    const http = new AdsHttp(deps.testOrigin ? { testOrigins: [deps.testOrigin] } : {});
    const base = deps.testOrigin ? { baseUrl: deps.testOrigin } : {};
    const built: Partial<Record<AdsPlatform, AdsPlatformSender>> = {};
    if (deps.keys.meta) built.META = new MetaSender(deps.keys.meta, http, { sourceUrl: deps.publicOrigin, ...base });
    if (deps.keys.tiktok) built.TIKTOK = new TikTokSender(deps.keys.tiktok, http, base);
    if (deps.keys.google) {
      const google = new GoogleSender(deps.keys.google, http, { ...base, ...(deps.testOrigin ? { oauthBaseUrl: deps.testOrigin } : {}), now: () => this.clock().getTime() });
      built.GOOGLE = { send: (event, opts) => google.send(event, { conversionAction: opts.conversionAction ?? '', validateOnly: opts.validateOnly ?? false }) };
    }
    this.senders = { ...built, ...deps.senders };
  }

  /** Whether a platform's keys are in the server's .env. */
  ready(platform: AdsPlatform): boolean {
    return this.senders[platform] !== undefined;
  }

  /** The platforms whose keys are set. */
  readyPlatforms(): AdsPlatform[] {
    return ADS_PLATFORMS.filter((p) => this.ready(p));
  }

  /** Whether the switch is on (no row: off). */
  async isOn(db: Db = this.db): Promise<boolean> {
    const s = await db.selectFrom('ads_settings').select('enabled').where('id', '=', 1).executeTakeFirst();
    return s?.enabled === true;
  }

  // ── The collector's choice ───────────────────────────────────────────────

  /** 409 ADS_OFF while the switch is off (ACCOUNT's row reads it, as the release notices' EMAIL_OFF). */
  async requireOn(): Promise<void> {
    if (!(await this.isOn())) throw adsOff();
  }

  /** The tracking device of a pseudonym (tracking_devices.device_hash), or null when it was never seen. */
  async deviceIdOf(deviceHash: string | null | undefined, db: Db = this.db): Promise<number | null> {
    if (typeof deviceHash !== 'string' || deviceHash === '') return null;
    const d = await db.selectFrom('tracking_devices').select('id').where('device_hash', '=', deviceHash).executeTakeFirst();
    return d ? Number(d.id) : null;
  }

  /** `{ on, choice, textVersion }`: the account's latest choice when signed in, else the device's (see the header). */
  async state(deviceId: number | null, accountId: string | null, db: Db = this.db): Promise<AdsState> {
    if (!(await this.isOn(db))) return { on: false, choice: null, textVersion: ADS_TEXT_VERSION };
    return { on: true, choice: await this.latestChoice(db, deviceId, accountId), textVersion: ADS_TEXT_VERSION };
  }

  private async latestChoice(db: Db, deviceId: number | null, accountId: string | null): Promise<AdConsentChoice | null> {
    if (accountId === null && deviceId === null) return null;
    const row = await db
      .selectFrom('ad_consents')
      .select('choice')
      .$if(accountId !== null, (qb) => qb.where('account_id', '=', accountId!))
      .$if(accountId === null, (qb) => qb.where('device_id', '=', deviceId!))
      .orderBy('chosen_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.choice ?? null;
  }

  /** A choice (see the header); the state after it. 409 ADS_OFF while off. */
  async choose(input: ChooseInput): Promise<AdsState> {
    if (input.choice !== 'GRANTED' && input.choice !== 'DECLINED') throw validationError('A choice is GRANTED or DECLINED.');
    if (input.accountId !== null && (typeof input.accountId !== 'string' || !UUID.test(input.accountId))) throw validationError('Not an account.');
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // FOR SHARE: a switch off waits for the choice, and its cancellation then sees what this choice queued nothing for.
      const s = await tx.selectFrom('ads_settings').select('enabled').where('id', '=', 1).forShare().executeTakeFirst();
      if (s?.enabled !== true) throw adsOff();
      let deviceId = input.deviceId ?? null;
      if (deviceId === null && input.deviceHash) {
        const row = await tx
          .insertInto('tracking_devices')
          .values({ device_hash: input.deviceHash, first_seen_at: now, last_seen_at: now })
          .onConflict((oc) => oc.column('device_hash').doUpdateSet({ last_seen_at: sql`greatest(tracking_devices.last_seen_at, excluded.last_seen_at)` }))
          .returning('id')
          .executeTakeFirstOrThrow();
        deviceId = Number(row.id);
      }
      if (deviceId === null && input.accountId === null) throw validationError('A choice is made on a device or an account.');
      const granted = input.choice === 'GRANTED';
      await tx
        .insertInto('ad_consents')
        .values({
          device_id: deviceId,
          account_id: input.accountId,
          choice: input.choice,
          source: input.source,
          text_version: ADS_TEXT_VERSION,
          user_agent: granted ? recordedUserAgent(input.userAgent) : null,
          chosen_at: now,
        })
        .execute();
      if (granted) {
        const clicks = clicksOf(input.clicks);
        if (clicks.length > 0 && deviceId !== null) {
          await tx
            .insertInto('ad_clicks')
            .values(clicks.map((c) => ({ device_id: deviceId!, account_id: input.accountId, kind: c.kind, click_id: c.id, clicked_at: now })))
            .onConflict((oc) => oc.columns(['device_id', 'kind', 'click_id']).doNothing())
            .execute();
        }
      } else {
        // Withdrawn: the click ids go, and nothing more is sent for the account.
        await tx
          .deleteFrom('ad_clicks')
          .where((eb) => eb.or([...(deviceId !== null ? [eb('device_id', '=', deviceId)] : []), ...(input.accountId !== null ? [eb('account_id', '=', input.accountId)] : [])]))
          .execute();
        if (input.accountId !== null) await cancelAccountAdEvents(tx, input.accountId, now, AD_CANCELLED_WORDS.withdrawn);
      }
      return { on: true, choice: input.choice, textVersion: ADS_TEXT_VERSION };
    });
  }

  /**
   * At a sign-up or a sign-in (TrackingService.link's attach, in its transaction): the device's choice made signed out
   * becomes the account's when the account holds none newer (a new row, at the time it was made); the device's click
   * ids take the account, or go when the account's choice is DECLINED. Nothing when the device made no choice.
   */
  async carry(tx: Db, deviceId: number, accountId: string): Promise<void> {
    const device = await tx
      .selectFrom('ad_consents')
      .select(['choice', 'source', 'text_version', 'user_agent', 'chosen_at'])
      .where('device_id', '=', deviceId)
      .where('account_id', 'is', null)
      .orderBy('chosen_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    const unattached = await tx.selectFrom('ad_clicks').select('id').where('device_id', '=', deviceId).where('account_id', 'is', null).limit(1).executeTakeFirst();
    if (!device && !unattached) return;
    if (device) {
      const newer = await tx
        .selectFrom('ad_consents')
        .select('id')
        .where('account_id', '=', accountId)
        .where('chosen_at', '>=', device.chosen_at)
        .limit(1)
        .executeTakeFirst();
      if (!newer) {
        await tx
          .insertInto('ad_consents')
          .values({ device_id: deviceId, account_id: accountId, choice: device.choice, source: device.source, text_version: device.text_version, user_agent: device.user_agent, chosen_at: device.chosen_at })
          .execute();
      }
    }
    if (!unattached) return;
    const latest = await this.latestChoice(tx, deviceId, accountId);
    if (latest === 'GRANTED') await tx.updateTable('ad_clicks').set({ account_id: accountId }).where('device_id', '=', deviceId).where('account_id', 'is', null).execute();
    else await tx.deleteFrom('ad_clicks').where('device_id', '=', deviceId).where('account_id', 'is', null).execute();
  }

  // ── The console ──────────────────────────────────────────────────────────

  /** The settings row, written at the first save (no row: off). */
  private async settingsRow(tx: Db) {
    await tx.insertInto('ads_settings').values({ id: 1 }).onConflict((oc) => oc.column('id').doNothing()).execute();
    return tx.selectFrom('ads_settings').selectAll().where('id', '=', 1).forUpdate().executeTakeFirstOrThrow();
  }

  /**
   * SWITCH ON / SWITCH OFF (ADMIN, the typed phrase): on refused while no platform has its keys (409 ADS_NO_PLATFORM);
   * the first on sets `events_from`; each on sets the watermark to now; off cancels every QUEUED event. Audited
   * `ads.switch`; nothing when unchanged.
   */
  async setSwitch(on: boolean, phrase: string, actor: Actor): Promise<AdsSettingsView> {
    const by = adminOf(actor);
    const wanted = on ? ADS_SWITCH_PHRASES.on : ADS_SWITCH_PHRASES.off;
    if (typeof phrase !== 'string' || phrase.trim().toUpperCase() !== wanted) throw validationError(`Type ${wanted} to confirm.`);
    if (on && this.readyPlatforms().length === 0) throw noPlatform('No platform has its keys in the server’s .env: conversions cannot be switched on.');
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const s = await this.settingsRow(tx);
      if (s.enabled === on) return;
      if (on) {
        await tx
          .updateTable('ads_settings')
          .set({ enabled: true, events_from: s.events_from ?? now, switched_at: now, switched_by: by, enqueued_until: now, updated_by: by })
          .where('id', '=', 1)
          .execute();
        await this.audit.record({ actor, action: 'ads.switch', targetType: 'ads_settings', targetId: '1', details: { on: true, first: s.events_from === null } }, tx);
      } else {
        await tx.updateTable('ads_settings').set({ enabled: false, switched_at: now, switched_by: by, updated_by: by }).where('id', '=', 1).execute();
        const r = await tx
          .updateTable('ad_events')
          .set({ status: 'CANCELLED', settled_at: now, last_error: AD_CANCELLED_WORDS.switchedOff })
          .where('status', '=', 'QUEUED')
          .executeTakeFirst();
        await this.audit.record({ actor, action: 'ads.switch', targetType: 'ads_settings', targetId: '1', details: { on: false, cancelled: Number(r.numUpdatedRows ?? 0) } }, tx);
      }
    });
    return this.read();
  }

  /** A link channel's platforms (none: unmapped). Audited `ads.channels`; nothing when unchanged. 404 CHANNEL_NOT_FOUND. */
  async setChannelPlatforms(channelId: string, platforms: readonly AdsPlatform[], actor: Actor): Promise<AdsSettingsView> {
    const by = adminOf(actor);
    if (typeof channelId !== 'string' || !UUID.test(channelId)) throw channelNotFound();
    const wanted = ADS_PLATFORMS.filter((p) => platforms.includes(p));
    if (platforms.some((p) => !(ADS_PLATFORMS as readonly string[]).includes(p))) throw validationError(`A platform is one of ${ADS_PLATFORMS.join(', ')}.`);
    await inTransaction(this.db, async (tx) => {
      // FOR SHARE: a channel being removed waits, or is gone (LinkService.deleteChannel takes its mapping with it).
      const channel = await tx.selectFrom('link_channels').select(['id', 'name']).where('id', '=', channelId).forShare().executeTakeFirst();
      if (!channel) throw channelNotFound();
      await this.settingsRow(tx);
      const before = (await tx.selectFrom('ads_channel_platforms').select('platform').where('channel_id', '=', channelId).execute()).map((r) => r.platform);
      const had = ADS_PLATFORMS.filter((p) => before.includes(p));
      if (had.join() === wanted.join()) return;
      await tx.deleteFrom('ads_channel_platforms').where('channel_id', '=', channelId).execute();
      if (wanted.length > 0) await tx.insertInto('ads_channel_platforms').values(wanted.map((platform) => ({ channel_id: channelId, platform }))).execute();
      await tx.updateTable('ads_settings').set({ updated_by: by }).where('id', '=', 1).execute();
      await this.audit.record({ actor, action: 'ads.channels', targetType: 'link_channel', targetId: channelId, details: { channel: channel.name, from: had, to: wanted } }, tx);
    });
    return this.read();
  }

  /** Each act's Google Ads conversion action (null: not named). Audited `ads.google_actions` with what changed. */
  async setGoogleActions(actions: Partial<Record<AdEventKind, string | null>>, actor: Actor): Promise<AdsSettingsView> {
    const by = adminOf(actor);
    const next: Partial<Record<(typeof GOOGLE_ACTION_COLUMN)[AdEventKind], string | null>> = {};
    for (const [kind, column] of Object.entries(GOOGLE_ACTION_COLUMN) as [AdEventKind, (typeof GOOGLE_ACTION_COLUMN)[AdEventKind]][]) {
      const v = actions[kind];
      if (v === undefined) continue;
      const value = v === null || v.trim() === '' ? null : v.trim();
      if (value !== null && !ADS_GOOGLE_ACTION_PATTERN.test(value)) throw validationError('A conversion action reads customers/<id>/conversionActions/<id>.');
      next[column] = value;
    }
    await inTransaction(this.db, async (tx) => {
      const s = await this.settingsRow(tx);
      const changed = Object.entries(next).filter(([column, value]) => s[column as keyof typeof s] !== value);
      if (changed.length === 0) return;
      await tx
        .updateTable('ads_settings')
        .set({ ...Object.fromEntries(changed), updated_by: by })
        .where('id', '=', 1)
        .execute();
      const details = Object.fromEntries(changed.map(([column, value]) => [column, { from: s[column as keyof typeof s] ?? null, to: value }]));
      await this.audit.record({ actor, action: 'ads.google_actions', targetType: 'ads_settings', targetId: '1', details }, tx);
    });
    return this.read();
  }

  /** Meta's and TikTok's test event codes (null: none). Audited `ads.test_codes` with whether each is set. */
  async setTestCodes(codes: { meta?: string | null; tiktok?: string | null }, actor: Actor): Promise<AdsSettingsView> {
    const by = adminOf(actor);
    const clean = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v.trim() === '') return null;
      const t = v.trim();
      if ([...t].length > ADS_TEST_EVENT_CODE_MAX || /[\p{Cc}]/u.test(t)) throw validationError(`A test event code is one line of at most ${ADS_TEST_EVENT_CODE_MAX} characters.`);
      return t;
    };
    const meta = clean(codes.meta);
    const tiktok = clean(codes.tiktok);
    await inTransaction(this.db, async (tx) => {
      const s = await this.settingsRow(tx);
      const set: { meta_test_event_code?: string | null; tiktok_test_event_code?: string | null } = {};
      if (meta !== undefined && meta !== s.meta_test_event_code) set.meta_test_event_code = meta;
      if (tiktok !== undefined && tiktok !== s.tiktok_test_event_code) set.tiktok_test_event_code = tiktok;
      if (Object.keys(set).length === 0) return;
      await tx.updateTable('ads_settings').set({ ...set, updated_by: by }).where('id', '=', 1).execute();
      const after = { meta: 'meta_test_event_code' in set ? set.meta_test_event_code : s.meta_test_event_code, tiktok: 'tiktok_test_event_code' in set ? set.tiktok_test_event_code : s.tiktok_test_event_code };
      await this.audit.record({ actor, action: 'ads.test_codes', targetType: 'ads_settings', targetId: '1', details: { meta: after.meta !== null, tiktok: after.tiktok !== null } }, tx);
    });
    return this.read();
  }

  /**
   * SEND A TEST EVENT (ADMIN, only while on): one sign-up in the platform's test mode (Meta's and TikTok's test event
   * code, Google's validateOnly), for the house's test address, never a collector's; its answer shown. 409 ADS_OFF,
   * ADS_NO_PLATFORM (its keys missing); 400 without the test code (Meta, TikTok) or a Google action. Audited `ads.test`.
   */
  async sendTest(platform: AdsPlatform, actor: Actor): Promise<AdsTestResult> {
    adminOf(actor);
    if (!(ADS_PLATFORMS as readonly string[]).includes(platform)) throw validationError(`A platform is one of ${ADS_PLATFORMS.join(', ')}.`);
    const s = await this.db.selectFrom('ads_settings').selectAll().where('id', '=', 1).executeTakeFirst();
    if (s?.enabled !== true) throw conflict('ADS_OFF', 'Conversions are off: switch them on to send a test event.');
    const sender = this.senders[platform];
    if (!sender) throw noPlatform(`${platform} has no keys in the server’s .env.`);
    const now = this.clock();
    const testCode = platform === 'META' ? s.meta_test_event_code : platform === 'TIKTOK' ? s.tiktok_test_event_code : null;
    const action = s.google_action_signup ?? s.google_action_draw_entry ?? s.google_action_live_entry ?? s.google_action_paid_order;
    if (platform !== 'GOOGLE' && !testCode) throw validationError(`Enter ${platform === 'META' ? 'Meta' : 'TikTok'}’s test event code first: without it the test would count as a real event.`);
    if (platform === 'GOOGLE' && !action) throw validationError('Name a Google conversion action first.');
    const event: AdEvent = {
      id: `orbes-test-${now.getTime()}`,
      kind: 'SIGNUP',
      at: now,
      emailSha256: hashEmail(TEST_EMAIL),
      externalIdSha256: hashedExternalId(this.externalKey, 'orbes-test'),
      country: null,
      clicks: platform === 'GOOGLE' ? [{ kind: 'GCLID', id: 'ORBES-TEST', at: now }] : [],
      userAgent: null,
      value: null,
    };
    let result: AdsTestResult;
    try {
      const r = await sender.send(event, platform === 'GOOGLE' ? { conversionAction: action!, validateOnly: true } : { testEventCode: testCode });
      result = { platform, ok: true, status: r.status, answer: r.answer };
    } catch (e) {
      const w = errorWords(e);
      result = { platform, ok: false, status: w.status, answer: w.detail };
    }
    await this.audit.record({ actor, action: 'ads.test', targetType: 'ads_settings', targetId: '1', details: { platform, ok: result.ok, status: result.status } });
    return result;
  }

  /** The console's page (see the header): never a key, never an account. */
  async read(): Promise<AdsSettingsView> {
    const now = this.clock();
    const s = await this.db
      .selectFrom('ads_settings as s')
      .leftJoin('admin_users as u', 'u.id', 's.switched_by')
      .selectAll('s')
      .select('u.email as switched_by_email')
      .where('s.id', '=', 1)
      .executeTakeFirst();
    const counts = await this.db.selectFrom('ad_events').select(['platform', 'status', (eb) => eb.fn.countAll<string>().as('n')]).groupBy(['platform', 'status']).execute();
    const last = await sql<{ platform: AdsPlatform; sent_at: Date | null; error: string | null; error_at: Date | null }>`
      SELECT p.platform,
             (SELECT max(e.sent_at) FROM ad_events e WHERE e.platform = p.platform) AS sent_at,
             f.last_error AS error, f.at AS error_at
        FROM (VALUES ('META'), ('TIKTOK'), ('GOOGLE')) AS p (platform)
        LEFT JOIN LATERAL (
          SELECT e.last_error, coalesce(e.settled_at, e.created_at) AS at FROM ad_events e
           WHERE e.platform = p.platform AND e.last_error IS NOT NULL AND e.status IN ('FAILED', 'QUEUED')
           ORDER BY coalesce(e.settled_at, e.created_at) DESC, e.id DESC LIMIT 1) f ON true`.execute(this.db);
    const channels = await this.db.selectFrom('link_channels').select(['id', 'name']).orderBy('position').orderBy('name').execute();
    const mapping = await this.db.selectFrom('ads_channel_platforms').select(['channel_id', 'platform']).execute();
    const month = parisDay(now).slice(0, 7);
    const choices = await sql<{ choice: AdConsentChoice; n: string }>`
      SELECT c.choice, count(*) AS n FROM ad_consents c
       WHERE c.chosen_at >= ${parisMonthStart(month)}::timestamptz
         -- A choice carried to the account at its sign-up is the same choice: counted once.
         AND NOT EXISTS (SELECT 1 FROM ad_consents o WHERE o.device_id = c.device_id AND o.chosen_at = c.chosen_at AND o.choice = c.choice AND o.id < c.id)
       GROUP BY c.choice`.execute(this.db);
    const platforms: AdsPlatformView[] = ADS_PLATFORMS.map((platform) => {
      const l = last.rows.find((r) => r.platform === platform);
      const byStatus = Object.fromEntries(AD_EVENT_STATUSES.map((st) => [st, Number(counts.find((c) => c.platform === platform && c.status === st)?.n ?? 0)])) as Record<AdEventStatus, number>;
      return {
        platform,
        ready: this.ready(platform),
        apiVersion: ADS_API_VERSIONS[platform],
        lastSentAt: l?.sent_at ? new Date(l.sent_at) : null,
        lastError: l?.error ? { error: l.error, at: new Date(l.error_at!) } : null,
        counts: byStatus,
        testCode: platform === 'META' ? (s?.meta_test_event_code ?? null) : platform === 'TIKTOK' ? (s?.tiktok_test_event_code ?? null) : null,
      };
    });
    return {
      on: s?.enabled === true,
      eventsFrom: s?.events_from ?? null,
      switchedAt: s?.switched_at ?? null,
      switchedBy: s?.switched_by && s.switched_by_email ? { id: s.switched_by, email: s.switched_by_email } : null,
      phrases: { on: ADS_SWITCH_PHRASES.on, off: ADS_SWITCH_PHRASES.off },
      platforms,
      channels: channels.map((c) => ({ id: c.id, name: c.name, platforms: ADS_PLATFORMS.filter((p) => mapping.some((m) => m.channel_id === c.id && m.platform === p)) })),
      googleActions: {
        SIGNUP: s?.google_action_signup ?? null,
        DRAW_ENTRY: s?.google_action_draw_entry ?? null,
        LIVE_ENTRY: s?.google_action_live_entry ?? null,
        PAID_ORDER: s?.google_action_paid_order ?? null,
      },
      consent: {
        month,
        granted: Number(choices.rows.find((r) => r.choice === 'GRANTED')?.n ?? 0),
        declined: Number(choices.rows.find((r) => r.choice === 'DECLINED')?.n ?? 0),
      },
    };
  }

  /** The latest events, newest first, by status and platform: kind, platform, status, times, error; no account, no email. */
  async events(filters: { status?: AdEventStatus; platform?: AdsPlatform; limit?: number } = {}): Promise<{ events: AdEventView[] }> {
    const limit = Math.min(AD_EVENTS_LIST_MAX, Math.max(1, Math.floor(filters.limit ?? AD_EVENTS_LIST_MAX)));
    const rows = await this.db
      .selectFrom('ad_events')
      .select(['id', 'platform', 'kind', 'status', 'skip_reason', 'attempts', 'created_at', 'not_before', 'sent_at', 'settled_at', 'last_error'])
      .$if(filters.status !== undefined, (qb) => qb.where('status', '=', filters.status!))
      .$if(filters.platform !== undefined, (qb) => qb.where('platform', '=', filters.platform!))
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return {
      events: rows.map((r) => ({
        id: Number(r.id),
        platform: r.platform,
        kind: r.kind,
        status: r.status,
        skipReason: r.skip_reason,
        attempts: Number(r.attempts),
        createdAt: r.created_at,
        notBefore: r.not_before,
        sentAt: r.sent_at,
        settledAt: r.settled_at,
        lastError: r.last_error,
      })),
    };
  }

  // ── The housekeeping ─────────────────────────────────────────────────────

  /**
   * The housekeeping's pass, right after `recordConversions` (see the header): the acts written or paid since the
   * watermark judged, their events written QUEUED or SKIPPED, the watermark moved to now. Nothing while off.
   */
  async enqueue(now: Date = this.clock()): Promise<EnqueueReport> {
    const report: EnqueueReport = { queued: 0, skipped: 0 };
    await inTransaction(this.db, async (tx) => {
      // FOR UPDATE: two passes, or a pass and a switch, one after the other.
      const s = await tx.selectFrom('ads_settings').selectAll().where('id', '=', 1).forUpdate().executeTakeFirst();
      if (!s || !s.enabled || s.events_from === null) return;
      const since = new Date(Math.max((s.enqueued_until ?? s.switched_at ?? now).getTime() - ENQUEUE_OVERLAP_MS, (s.switched_at ?? s.events_from).getTime()));
      // Acted while on: from the switch on (never before `events_from`, the first); nothing done while off is queued.
      const from = s.switched_at ?? s.events_from;
      const clickFrom = sql`(cand.act_at - make_interval(days => ${AD_CLICK_WINDOW_DAYS}))`;
      const judged = sql<Candidate>`
        WITH cand AS (
          SELECT c.id AS conversion_id, c.kind, c.account_id, c.last_source_id, c.at AS act_at,
                 NULL::text AS channel, NULL::bigint AS price_minor, NULL::text AS shopify_order_id, NULL::uuid AS exchange_of_order_id
            FROM acquisition_conversions c
           WHERE c.kind IN ('SIGNUP', 'DRAW_ENTRY', 'LIVE_ENTRY')
             AND c.created_at >= ${since}::timestamptz AND c.created_at <= ${now}::timestamptz AND c.at >= ${from}::timestamptz
          UNION ALL
          SELECT c.id, c.kind, c.account_id, c.last_source_id, o.paid_at,
                 o.channel, o.price_minor, o.shopify_order_id, o.exchange_of_order_id
            FROM acquisition_conversions c
            JOIN orders o ON o.id = c.ref_id
           WHERE c.kind = 'ORDER' AND o.paid_at IS NOT NULL AND o.paid_at >= ${from}::timestamptz
             AND greatest(c.created_at, o.paid_at) >= ${since}::timestamptz AND greatest(c.created_at, o.paid_at) <= ${now}::timestamptz)
        SELECT cand.conversion_id, cand.kind, cand.act_at, cand.channel, cand.price_minor, cand.shopify_order_id, cand.exchange_of_order_id,
               (SELECT array_agg(DISTINCT m.platform) FROM acquisition_sources src
                  JOIN links l ON l.id = src.link_id
                  JOIN ads_channel_platforms m ON m.channel_id = l.channel_id
                 WHERE src.id = cand.last_source_id) AS mapped,
               (SELECT array_agg(DISTINCT k.kind) FROM ad_clicks k
                 WHERE k.account_id = cand.account_id AND k.clicked_at <= cand.act_at AND k.clicked_at > ${clickFrom}) AS click_kinds,
               (SELECT ac.choice FROM ad_consents ac
                 WHERE ac.account_id = cand.account_id AND ac.chosen_at <= cand.act_at
                 ORDER BY ac.chosen_at DESC, ac.id DESC LIMIT 1) AS consent
          FROM cand
          JOIN accounts a ON a.id = cand.account_id
         WHERE a.status = 'ACTIVE' AND ${notTestEntrant('cand.account_id')} AND NOT ${houseAccount('cand.account_id')}
         ORDER BY cand.act_at, cand.conversion_id`;
      const rows = (await judged.execute(tx)).rows;
      const values: { platform: AdsPlatform; conversion_id: number; kind: AdEventKind; status: AdEventStatus; skip_reason: AdSkipReason | null; not_before: Date; created_at: Date; settled_at: Date | null }[] = [];
      for (const c of rows) {
        // The consent at the act's time: GRANTED, or nothing at all.
        if (c.consent !== 'GRANTED') continue;
        if (c.kind === 'ORDER' && !adsSendsFor({ channel: c.channel!, price_minor: c.price_minor === null ? null : Number(c.price_minor), shopify_order_id: c.shopify_order_id, exchange_of_order_id: c.exchange_of_order_id })) continue;
        const kind = EVENT_KIND_OF[c.kind];
        const actAt = new Date(c.act_at);
        const clickKinds = c.click_kinds ?? [];
        for (const platform of platformsFor(c.mapped ?? [], clickKinds)) {
          const reason = this.skipReason(platform, kind, actAt, clickKinds, s, now);
          values.push({
            platform,
            conversion_id: Number(c.conversion_id),
            kind,
            status: reason === null ? 'QUEUED' : 'SKIPPED',
            skip_reason: reason,
            not_before: now,
            created_at: now,
            settled_at: reason === null ? null : now,
          });
        }
      }
      // Written once per platform, conversion and act: what a pass before wrote (the overlap) is neither written nor counted again.
      for (let i = 0; i < values.length; i += 500) {
        const written = await tx
          .insertInto('ad_events')
          .values(values.slice(i, i + 500))
          .onConflict((oc) => oc.columns(['platform', 'conversion_id', 'kind']).doNothing())
          .returning(['status'])
          .execute();
        for (const w of written) report[w.status === 'QUEUED' ? 'queued' : 'skipped'] += 1;
      }
      await tx.updateTable('ads_settings').set({ enqueued_until: now }).where('id', '=', 1).execute();
    });
    return report;
  }

  /** Why an event cannot go (null: it can): its platform not ready, no Google click id, past the platform's age. */
  private skipReason(
    platform: AdsPlatform,
    kind: AdEventKind,
    actAt: Date,
    clickKinds: readonly string[],
    s: { google_action_signup: string | null; google_action_draw_entry: string | null; google_action_live_entry: string | null; google_action_paid_order: string | null },
    now: Date,
  ): AdSkipReason | null {
    if (!this.ready(platform)) return 'NOT_READY';
    if (platform === 'GOOGLE') {
      if (!PLATFORM_CLICKS.GOOGLE.some((k) => clickKinds.includes(k))) return 'NO_CLICK_ID';
      if (!s[GOOGLE_ACTION_COLUMN[kind]]) return 'NOT_READY';
    }
    if (now.getTime() - actAt.getTime() > AD_MAX_AGE_DAYS[platform] * DAY_MS) return 'TOO_OLD';
    return null;
  }

  /** One pass of the sender (see the header). Nothing while off. */
  async sendDue(now: Date = this.clock()): Promise<AdsSendReport> {
    const report: AdsSendReport = { sent: 0, retried: 0, failed: 0, skipped: 0, cancelled: 0 };
    const s = await this.db.selectFrom('ads_settings').selectAll().where('id', '=', 1).executeTakeFirst();
    if (!s?.enabled) return report;
    for (const platform of ADS_PLATFORMS) {
      const rows = await this.claim(platform, now);
      for (const row of rows) report[await this.sendOne(row, s, now)] += 1;
    }
    return report;
  }

  /** A platform's QUEUED events due, oldest first, each one's attempt counted and its time moved a lease ahead. */
  private async claim(platform: AdsPlatform, now: Date): Promise<Claimed[]> {
    const lease = new Date(now.getTime() + ADS_SENDER.leaseMs);
    return inTransaction(this.db, async (tx) => {
      const due = await tx
        .selectFrom('ad_events')
        .select('id')
        .where('status', '=', 'QUEUED')
        .where('platform', '=', platform)
        .where('not_before', '<=', now)
        .orderBy('not_before')
        .orderBy('id')
        .limit(ADS_SENDER.batch)
        .forUpdate()
        .skipLocked()
        .execute();
      if (due.length === 0) return [];
      const rows = await tx
        .updateTable('ad_events')
        .set((eb) => ({ attempts: eb('attempts', '+', 1), not_before: lease }))
        .where(
          'id',
          'in',
          due.map((d) => d.id),
        )
        .returning(['id', 'platform', 'conversion_id', 'kind', 'attempts'])
        .execute();
      return rows.sort((a, b) => Number(a.id) - Number(b.id)) as Claimed[];
    });
  }

  /** An event's end: SENT, SKIPPED or CANCELLED, settled now (only while it is still QUEUED). */
  private async settle(row: Claimed, set: { status: 'SENT' | 'SKIPPED' | 'CANCELLED' | 'FAILED'; skip_reason?: AdSkipReason; last_error?: string | null }, now: Date): Promise<void> {
    await this.db
      .updateTable('ad_events')
      .set({ status: set.status, skip_reason: set.skip_reason ?? null, last_error: set.last_error ?? null, settled_at: now, ...(set.status === 'SENT' ? { sent_at: now } : {}) })
      .where('id', '=', row.id as number)
      .where('status', '=', 'QUEUED')
      .execute();
  }

  private async sendOne(row: Claimed, s: { google_action_signup: string | null; google_action_draw_entry: string | null; google_action_live_entry: string | null; google_action_paid_order: string | null }, now: Date): Promise<keyof AdsSendReport> {
    const built = await this.eventOf(row);
    if ('cancel' in built) {
      await this.settle(row, { status: 'CANCELLED', last_error: built.cancel }, now);
      this.log.info({ platform: row.platform, kind: row.kind, id: Number(row.id) }, 'ad event cancelled');
      return 'cancelled';
    }
    const reason = this.skipReason(
      row.platform,
      row.kind,
      built.event.at,
      built.event.clicks.map((c) => c.kind),
      s,
      now,
    );
    if (reason !== null) {
      await this.settle(row, { status: 'SKIPPED', skip_reason: reason }, now);
      return 'skipped';
    }
    try {
      await this.senders[row.platform]!.send(built.event, row.platform === 'GOOGLE' ? { conversionAction: s[GOOGLE_ACTION_COLUMN[row.kind]]! } : {});
    } catch (e) {
      return this.failed(row, e, now);
    }
    await this.settle(row, { status: 'SENT' }, now);
    this.log.info({ platform: row.platform, kind: row.kind, id: Number(row.id) }, 'ad event sent');
    return 'sent';
  }

  /** A failed attempt: tried again later, or FAILED (refused before sending, or its retries used). */
  private async failed(row: Claimed, e: unknown, now: Date): Promise<'retried' | 'failed'> {
    const w = errorWords(e);
    const final = w.refused || row.attempts > ADS_SENDER.retryMs.length;
    if (final) {
      await this.settle(row, { status: 'FAILED', last_error: w.detail }, now);
    } else {
      const delay = ADS_SENDER.retryMs[Math.max(0, row.attempts - 1)]!;
      await this.db
        .updateTable('ad_events')
        .set({ not_before: new Date(now.getTime() + delay), last_error: w.detail })
        .where('id', '=', row.id as number)
        .where('status', '=', 'QUEUED')
        .execute();
    }
    this.log.warn({ platform: row.platform, kind: row.kind, id: Number(row.id), attempts: row.attempts, final, status: w.status }, 'ad event failed');
    return final ? 'failed' : 'retried';
  }

  /**
   * The AdEvent of a claimed row, read now (§3.1: what is sent, at most), or why it is cancelled: the account no longer
   * ACTIVE, a test entrant or one of the team's, or its choice now not GRANTED (withdrawn since the act).
   */
  private async eventOf(row: Claimed): Promise<{ event: AdEvent } | { cancel: string }> {
    const r = (
      await sql<{
        account_id: string;
        email: string;
        country: string | null;
        status: string;
        counted: boolean;
        act_at: Date;
        choice_now: AdConsentChoice | null;
        user_agent: string | null;
        order_id: string | null;
        invoice_minor: string | number | null;
        invoice_currency: string | null;
        price_minor: string | number | null;
        currency: string | null;
      }>`
        SELECT c.account_id, a.email, a.country, a.status,
               (${notTestEntrant('c.account_id')} AND NOT ${houseAccount('c.account_id')}) AS counted,
               CASE WHEN c.kind = 'ORDER' THEN o.paid_at ELSE c.at END AS act_at,
               (SELECT n.choice FROM ad_consents n WHERE n.account_id = c.account_id ORDER BY n.chosen_at DESC, n.id DESC LIMIT 1) AS choice_now,
               (SELECT g.user_agent FROM ad_consents g WHERE g.account_id = c.account_id AND g.choice = 'GRANTED'
                   AND g.chosen_at <= CASE WHEN c.kind = 'ORDER' THEN o.paid_at ELSE c.at END
                 ORDER BY g.chosen_at DESC, g.id DESC LIMIT 1) AS user_agent,
               o.id AS order_id, i.total_minor AS invoice_minor, i.currency AS invoice_currency, o.price_minor, o.currency
          FROM acquisition_conversions c
          JOIN accounts a ON a.id = c.account_id
          LEFT JOIN orders o ON c.kind = 'ORDER' AND o.id = c.ref_id
          LEFT JOIN LATERAL (
            SELECT iv.total_minor, iv.currency FROM invoices iv
             WHERE iv.order_id = o.id AND iv.kind = 'INVOICE' AND iv.supplements_invoice_id IS NULL
             ORDER BY iv.issued_at, iv.id LIMIT 1) i ON true
         WHERE c.id = ${row.conversion_id}`.execute(this.db)
    ).rows[0];
    if (!r || r.status !== 'ACTIVE' || !r.counted) return { cancel: AD_CANCELLED_WORDS.notCounted };
    if (r.choice_now !== 'GRANTED') return { cancel: AD_CANCELLED_WORDS.withdrawn };
    const actAt = new Date(r.act_at);
    const clicks = await this.db
      .selectFrom('ad_clicks')
      .select(['kind', 'click_id', 'clicked_at'])
      .where('account_id', '=', r.account_id)
      .where('kind', 'in', [...PLATFORM_CLICKS[row.platform]])
      .where('clicked_at', '<=', actAt)
      .where('clicked_at', '>', new Date(actAt.getTime() - AD_CLICK_WINDOW_DAYS * DAY_MS))
      .orderBy('clicked_at')
      .orderBy('id')
      .execute();
    let value: AdEvent['value'] = null;
    if (row.kind === 'PAID_ORDER') {
      // The main invoice's total; an order paid without one (none in practice: an invoice is issued at PAID), its price.
      const minor = r.invoice_minor ?? r.price_minor ?? 0;
      const currency = r.invoice_currency ?? r.currency ?? 'EUR';
      value = { minor: Number(minor), currency };
    }
    const event: AdEvent = {
      id: adEventId(Number(row.conversion_id)),
      kind: row.kind,
      at: actAt,
      emailSha256: hashEmail(r.email),
      externalIdSha256: hashedExternalId(this.externalKey, r.account_id),
      country: r.country && /^[A-Z]{2}$/.test(r.country.trim()) ? r.country.trim() : null,
      clicks: clicks.map((c): AdClick => ({ kind: c.kind, id: c.click_id, at: new Date(c.clicked_at) })),
      userAgent: r.user_agent,
      value,
    };
    return { event };
  }

  /**
   * The housekeeping's (see the header): events AD_EVENT_RETENTION_DAYS after they settled, click ids
   * AD_CLICK_RETENTION_DAYS after the click, a device's choices made signed out after 13 Paris months. The rows erased.
   */
  async purge(now: Date = this.clock()): Promise<number> {
    const events = await this.db.deleteFrom('ad_events').where('settled_at', '<', new Date(now.getTime() - AD_EVENT_RETENTION_DAYS * DAY_MS)).executeTakeFirst();
    const clicks = await this.db.deleteFrom('ad_clicks').where('clicked_at', '<', new Date(now.getTime() - AD_CLICK_RETENTION_DAYS * DAY_MS)).executeTakeFirst();
    const consents = await this.db.deleteFrom('ad_consents').where('account_id', 'is', null).where('chosen_at', '<', viewHistoryCutoff(now)).executeTakeFirst();
    return Number(events.numDeletedRows ?? 0) + Number(clicks.numDeletedRows ?? 0) + Number(consents.numDeletedRows ?? 0);
  }

  // ── The sender's timer ───────────────────────────────────────────────────

  /** At the process's start (context.ts), when a platform has its keys: a pass now, then every ADS_SENDER.intervalMs. */
  start(): void {
    if (this.readyPlatforms().length === 0 || this.timers) return;
    this.timers = true;
    this.schedule(0);
  }

  /** At the process's close: no new pass; the one under way finishes. */
  async stop(): Promise<void> {
    this.timers = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  private schedule(ms: number): void {
    if (!this.timers) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = (async () => {
      try {
        await this.sendDue(this.clock());
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'ads: a pass of the sender failed');
      }
    })();
    await this.running;
    this.running = null;
    this.schedule(ADS_SENDER.intervalMs);
  }
}

// ── The account's life ─────────────────────────────────────────────────────

/**
 * The account's events still QUEUED cancelled (OwnerService.lock, in its transaction; a withdrawal), settled now with
 * why. The number cancelled; events already sent, failed, skipped or cancelled are left as they are.
 */
export async function cancelAccountAdEvents(tx: Db, accountId: string, now: Date, reason: string = AD_CANCELLED_WORDS.locked): Promise<number> {
  const r = await tx
    .updateTable('ad_events')
    .set({ status: 'CANCELLED', settled_at: now, last_error: reason })
    .where('status', '=', 'QUEUED')
    .where('conversion_id', 'in', (eb) => eb.selectFrom('acquisition_conversions').select('id').where('account_id', '=', accountId))
    .executeTakeFirst();
  return Number(r.numUpdatedRows ?? 0);
}

/** The right of access's part (see ExportedAdvertising), oldest first. */
export async function accountAdsData(tx: Db, accountId: string): Promise<ExportedAdvertising> {
  const choices = await tx.selectFrom('ad_consents').select(['choice', 'source', 'chosen_at', 'text_version']).where('account_id', '=', accountId).orderBy('chosen_at').orderBy('id').execute();
  const clicks = await tx.selectFrom('ad_clicks').select(['kind', 'clicked_at', 'click_id']).where('account_id', '=', accountId).orderBy('clicked_at').orderBy('id').execute();
  const events = await tx
    .selectFrom('ad_events as e')
    .innerJoin('acquisition_conversions as c', 'c.id', 'e.conversion_id')
    .select(['e.platform', 'e.kind', 'e.status', 'e.created_at', 'e.sent_at', 'e.settled_at'])
    .where('c.account_id', '=', accountId)
    .orderBy('e.created_at')
    .orderBy('e.id')
    .execute();
  return {
    choices: choices.map((c) => ({ choice: c.choice, source: c.source, chosenAt: c.chosen_at, textVersion: c.text_version })),
    clicks: clicks.map((c) => ({ kind: c.kind, clickedAt: c.clicked_at, clickId: c.click_id })),
    events: events.map((e) => ({ platform: e.platform, kind: e.kind, status: e.status, createdAt: e.created_at, sentAt: e.sent_at, settledAt: e.settled_at })),
    retention: [...AD_RETENTION_WORDS],
  };
}
