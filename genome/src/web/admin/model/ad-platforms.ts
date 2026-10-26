/**
 * Links → Ad platforms (macro scope of 2026-10-20, K27 A1 to A5; lot M4 plan §3.5, step M4.12) — pure helpers, no DOM:
 * the page's words, its sections' lines, its off state and each section's empty state said plainly, the dialogs' checks
 * and what each sends, the events' filter kept in the address (`#/links/ads?status=FAILED&platform=META`).
 *
 *  - CONVERSIONS: ON / OFF, the date it was switched and by whom (Paris time); SWITCH ON / SWITCH OFF (ADMIN, the phrase).
 *  - The three platforms: KEYS PRESENT / KEYS MISSING (never a key), API version, last send, last error, the counts
 *    (queued, sent, failed, skipped); SEND A TEST EVENT (ADMIN, while on) and Meta's and TikTok's test codes.
 *  - CHANNELS (each link channel and its platforms), GOOGLE CONVERSION ACTIONS (the four resource names), CONSENT (this
 *    month's choices, counted), EVENTS (the latest, by status and platform, no person named).
 *  - Words calm, no exclamation mark, never atelier, handmade or craft, never « product » (admin.ad-platforms.test.ts).
 */
import { formatCount } from '../format.js';
import type { AdminRole } from '../types.js';
import {
  AD_EVENT_KINDS,
  AD_EVENT_STATUSES,
  ADS_GOOGLE_ACTION_PATTERN,
  ADS_PLATFORMS,
  ADS_TEST_EVENT_CODE_MAX,
  type AdEventKind,
  type AdEventStatus,
  type AdSkipReason,
  type AdsPlatform,
  type AdsPlatformView,
  type AdsSettings,
  type AdsTestResult,
} from '../types.js';
import { parisDateTime } from './links.js';
import { can } from './permissions.js';

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const AD_PLATFORMS_TEXT = Object.freeze({
  eyebrow: 'Clients · Links',
  title: 'Ad platforms',
  lead: 'Server-side conversions: sign-ups, draw entries, LIVE entries and paid orders, sent from the server to Meta, TikTok or Google for collectors who accept, and only to the platform they came from. No pixel, no platform script, no advertising cookie.',
  links: 'Links',
  conversions: 'Switch',
  conversionsLabel: 'CONVERSIONS',
  on: 'ON',
  off: 'OFF',
  /** The off state, said plainly (plan §3.5). */
  offLine: 'Conversions are off. Nothing is captured or sent, and collectors see no banner.',
  onLine: 'Conversions are on. Collectors see the consent banner and the privacy policy’s advertising section; events go only for those who accept.',
  switched: 'Switched',
  neverSwitched: 'Never switched on.',
  eventsFrom: 'Events from',
  eventsFromNote: 'Acts before this are never sent.',
  switchOn: 'SWITCH ON',
  switchOff: 'SWITCH OFF',
  switchOnTitle: 'SWITCH CONVERSIONS ON',
  switchOffTitle: 'SWITCH CONVERSIONS OFF',
  /** The dialog says what goes live (plan §3.5, word for word). */
  switchOnBody: 'The consent banner and the privacy policy’s advertising section appear at once. Events are sent only for collectors who accept, from now on.',
  switchOffBody: 'The consent banner and the privacy policy’s advertising section disappear at once. Nothing more is captured or sent, and every queued event is cancelled.',
  switchOnHint: 'Conversions can be switched off here at any time.',
  switchOffHint: 'A cancelled event is never sent.',
  switchOnConfirm: 'Switch on',
  switchOffConfirm: 'Switch off',
  switchedOnToast: 'Conversions switched on.',
  switchedOffToast: 'Conversions switched off.',
  platforms: 'Platforms',
  platformsNote: 'Keys live in the server’s .env, never here.',
  keysPresent: 'KEYS PRESENT',
  keysMissing: 'KEYS MISSING',
  apiVersion: 'API version',
  lastSend: 'Last send',
  never: 'Never',
  lastError: 'Last error',
  none: 'None',
  testCode: 'Test code',
  googleTestMode: 'Validate only: Google checks the event without recording it.',
  testCodes: 'Test codes',
  testCodesTitle: 'TEST CODES',
  testCodesBody: 'A test event goes to Meta and TikTok only with their test code, so it never counts as a real one. Each is shown under Test events in the platform’s events manager.',
  testCodesConfirm: 'Save test codes',
  testCodesSaved: 'Test codes saved.',
  testCodeHint: (platform: string) => `From ${platform}’s events manager, Test events. One line, at most ${ADS_TEST_EVENT_CODE_MAX} characters. Empty: none.`,
  testCodeProblem: `A test code is one line of at most ${ADS_TEST_EVENT_CODE_MAX} characters.`,
  sendTest: 'SEND A TEST EVENT',
  sendTestConfirm: 'Send',
  sendTestWorking: 'Sending…',
  testWhileOff: 'A test event can be sent once conversions are on.',
  testNoKeys: 'Its keys are not in the server’s .env.',
  testDone: 'Done',
  taken: 'TAKEN',
  refused: 'REFUSED',
  noAnswer: 'No answer',
  channels: 'Channels',
  channelsNote: 'An act goes to a platform when the channel of its last link is mapped to it, or when the collector clicked one of its ads in the 90 days before.',
  /** CHANNELS with no channel mapped (plan §3.5). */
  channelsEmpty: 'No channel is mapped to a platform yet. Until one is, an act goes to a platform only when the collector clicked one of its ads.',
  noChannel: 'No link channel yet. Add one with Links → Channels.',
  save: 'Save',
  channelSaved: (name: string) => `${name} saved.`,
  googleActions: 'Google conversion actions',
  googleNote: 'An act whose action is not named sends no Google event.',
  notNamed: 'Not named',
  edit: 'Edit',
  googleTitle: 'GOOGLE CONVERSION ACTIONS',
  googleBody: 'Each act’s conversion action in Google Ads, as its resource name. Empty: not named.',
  googleHint: 'customers/<id>/conversionActions/<id>',
  googleProblem: 'A conversion action reads customers/<id>/conversionActions/<id>.',
  googleConfirm: 'Save actions',
  googleSaved: 'Google conversion actions saved.',
  nothingChanged: 'Nothing has changed.',
  consent: 'Consent',
  consentLine: 'Choices made this month in the consent banner and in ACCOUNT, Paris time.',
  /** CONSENT with no choice this month (plan §3.5). */
  consentEmpty: 'No choice made this month.',
  accepted: 'Accepted',
  declined: 'Declined',
  events: 'Events',
  eventsNote: 'The latest 100, newest first. No collector is named.',
  /** EVENTS with no event (plan §3.5). */
  eventsEmpty: 'No event yet.',
  eventsEmptyFiltered: 'No event with this status and platform.',
  eventsFailed: 'The events could not be read. The rest of the page is current.',
  eventsCaption: 'The latest events of the server-side conversions',
  tryAgain: 'Try again',
  created: 'Created',
  act: 'Act',
  attempts: 'Attempts',
  sent: 'Sent',
  error: 'Error',
  allStatuses: 'All statuses',
  allPlatforms: 'All platforms',
  status: 'Status',
  platform: 'Platform',
});

/** Each platform by its name, and the API it reaches (A2). */
export const PLATFORM_LABELS: Readonly<Record<AdsPlatform, string>> = Object.freeze({ META: 'Meta', TIKTOK: 'TikTok', GOOGLE: 'Google' });
export const PLATFORM_APIS: Readonly<Record<AdsPlatform, string>> = Object.freeze({ META: 'Conversions API', TIKTOK: 'Events API', GOOGLE: 'Google Ads conversion import' });

/** Each act (A3). */
export const ACT_LABELS: Readonly<Record<AdEventKind, string>> = Object.freeze({ SIGNUP: 'Sign-up', DRAW_ENTRY: 'Draw entry', LIVE_ENTRY: 'LIVE entry', PAID_ORDER: 'Paid order' });

export const EVENT_STATUS_LABELS: Readonly<Record<AdEventStatus, string>> = Object.freeze({ QUEUED: 'QUEUED', SENT: 'SENT', FAILED: 'FAILED', SKIPPED: 'SKIPPED', CANCELLED: 'CANCELLED' });

export const SKIP_LABELS: Readonly<Record<AdSkipReason, string>> = Object.freeze({ TOO_OLD: 'Too old', NO_CLICK_ID: 'No click id', NOT_READY: 'Not ready' });

/** The counts a platform shows (plan §3.5: queued, sent, failed, skipped), in that order. */
export const COUNTED_STATUSES: readonly AdEventStatus[] = Object.freeze(['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const satisfies readonly AdEventStatus[]);
export const COUNT_LABELS: Readonly<Record<AdEventStatus, string>> = Object.freeze({ QUEUED: 'Queued', SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Skipped', CANCELLED: 'Cancelled' });

/** The Google conversion actions' fields, in the acts' order, and the body key of each. */
export const GOOGLE_ACTION_FIELDS: readonly { kind: AdEventKind; name: 'signup' | 'drawEntry' | 'liveEntry' | 'paidOrder' }[] = Object.freeze([
  { kind: 'SIGNUP', name: 'signup' },
  { kind: 'DRAW_ENTRY', name: 'drawEntry' },
  { kind: 'LIVE_ENTRY', name: 'liveEntry' },
  { kind: 'PAID_ORDER', name: 'paidOrder' },
] as const);

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a role may do here: an ADMIN switches, maps, names and tests; every reader of Links reads. */
export function adPlatformActions(role: AdminRole | null, s: Pick<AdsSettings, 'on'>): { manage: boolean; test: boolean } {
  const manage = can(role, 'manageAdPlatforms');
  return { manage, test: manage && s.on };
}

/** `Switched on 26 OCT 2026 · 10:00 Paris by a@orbes.test`, or null when it never was. */
export function switchLine(s: Pick<AdsSettings, 'on' | 'switchedAt' | 'switchedBy'>): string | null {
  if (!s.switchedAt) return null;
  return `${s.on ? 'Switched on' : 'Switched off'} ${parisDateTime(s.switchedAt)}${s.switchedBy ? ` by ${s.switchedBy.email}` : ''}`;
}

/** KEYS PRESENT / KEYS MISSING. */
export const keysLabel = (p: Pick<AdsPlatformView, 'ready'>): string => (p.ready ? AD_PLATFORMS_TEXT.keysPresent : AD_PLATFORMS_TEXT.keysMissing);

/** The platform's last send in Paris time, or Never. */
export const lastSendText = (p: Pick<AdsPlatformView, 'lastSentAt'>): string => (p.lastSentAt ? parisDateTime(p.lastSentAt) : AD_PLATFORMS_TEXT.never);

/** The platform's last error and when, or null. */
export function lastErrorText(p: Pick<AdsPlatformView, 'lastError'>): { error: string; at: string } | null {
  return p.lastError ? { error: p.lastError.error, at: parisDateTime(p.lastError.at) } : null;
}

/** The four counts of a platform, labelled. */
export function countCells(p: Pick<AdsPlatformView, 'counts'>): { status: AdEventStatus; label: string; value: string }[] {
  return COUNTED_STATUSES.map((status) => ({ status, label: COUNT_LABELS[status], value: formatCount(p.counts[status] ?? 0) }));
}

/** Meta's and TikTok's test code, or Google's test mode. */
export function testCodeText(p: Pick<AdsPlatformView, 'platform' | 'testCode'>): string {
  if (p.platform === 'GOOGLE') return AD_PLATFORMS_TEXT.googleTestMode;
  return p.testCode ?? AD_PLATFORMS_TEXT.none;
}

/** True when at least one channel maps to a platform. */
export const anyChannelMapped = (s: Pick<AdsSettings, 'channels'>): boolean => s.channels.some((c) => c.platforms.length > 0);

/** A channel's platforms in words: `Meta · Google`, or None. */
export function channelPlatformsText(platforms: readonly AdsPlatform[]): string {
  const ordered = ADS_PLATFORMS.filter((p) => platforms.includes(p));
  return ordered.length ? ordered.map((p) => PLATFORM_LABELS[p]).join(' · ') : AD_PLATFORMS_TEXT.none;
}

/** The platforms ticked, in the platforms' order; whether they differ from the channel's. */
export function channelChange(current: readonly AdsPlatform[], ticked: readonly AdsPlatform[]): { platforms: AdsPlatform[]; changed: boolean } {
  const platforms = ADS_PLATFORMS.filter((p) => ticked.includes(p));
  const had = ADS_PLATFORMS.filter((p) => current.includes(p));
  return { platforms, changed: platforms.join() !== had.join() };
}

// ── SEND A TEST EVENT ────────────────────────────────────────────────────────────────────────────────────────────

/** What the test sends, said before it goes. */
export function testEventBody(p: Pick<AdsPlatformView, 'platform' | 'testCode'>): string {
  const name = PLATFORM_LABELS[p.platform];
  if (p.platform === 'GOOGLE') return 'One sign-up, checked by Google Ads without being recorded (validate only), with the first conversion action named, for the house’s test address, never a collector’s.';
  if (!p.testCode) return `${name}’s test code is not set: save it with Test codes first, so the test never counts as a real event.`;
  return `One sign-up in ${name}’s test mode, with the test code ${p.testCode}, for the house’s test address, never a collector’s. ${name} shows it under Test events.`;
}

/** The test's answer: TAKEN or REFUSED, its HTTP status, the platform's words. */
export function testResultLines(r: AdsTestResult): { mark: string; ok: boolean; status: string; answer: string } {
  return {
    mark: r.ok ? AD_PLATFORMS_TEXT.taken : AD_PLATFORMS_TEXT.refused,
    ok: r.ok,
    status: r.status === null ? AD_PLATFORMS_TEXT.noAnswer : `HTTP ${r.status}`,
    answer: r.answer.trim() === '' ? '—' : r.answer,
  };
}

// ── Test codes ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface TestCodesForm {
  meta: string;
  tiktok: string;
}

export function testCodesForm(s: Pick<AdsSettings, 'platforms'>): TestCodesForm {
  const of = (platform: AdsPlatform) => s.platforms.find((p) => p.platform === platform)?.testCode ?? '';
  return { meta: of('META'), tiktok: of('TIKTOK') };
}

/** A problem with the codes typed, or null (as the server: one line, at most 40 characters). */
export function testCodesProblem(v: Partial<TestCodesForm>, current?: TestCodesForm): string | null {
  for (const x of [v.meta ?? '', v.tiktok ?? '']) {
    const t = x.trim();
    if ([...t].length > ADS_TEST_EVENT_CODE_MAX || /[\p{Cc}]/u.test(t)) return AD_PLATFORMS_TEXT.testCodeProblem;
  }
  if (current && (v.meta ?? '').trim() === current.meta && (v.tiktok ?? '').trim() === current.tiktok) return AD_PLATFORMS_TEXT.nothingChanged;
  return null;
}

/** What Test codes sends: each code trimmed, empty as null. */
export function testCodesInput(v: Partial<TestCodesForm>): { meta: string | null; tiktok: string | null } {
  const clean = (x: string | undefined) => (x === undefined || x.trim() === '' ? null : x.trim());
  return { meta: clean(v.meta), tiktok: clean(v.tiktok) };
}

// ── Google conversion actions ────────────────────────────────────────────────────────────────────────────────────

export type GoogleActionsForm = Record<(typeof GOOGLE_ACTION_FIELDS)[number]['name'], string>;

export function googleActionsForm(s: Pick<AdsSettings, 'googleActions'>): GoogleActionsForm {
  return Object.fromEntries(GOOGLE_ACTION_FIELDS.map((f) => [f.name, s.googleActions[f.kind] ?? ''])) as GoogleActionsForm;
}

/** A problem with the actions typed, or null (as the server's pattern). */
export function googleActionsProblem(v: Partial<GoogleActionsForm>, current?: GoogleActionsForm): string | null {
  for (const f of GOOGLE_ACTION_FIELDS) {
    const t = (v[f.name] ?? '').trim();
    if (t !== '' && !ADS_GOOGLE_ACTION_PATTERN.test(t)) return AD_PLATFORMS_TEXT.googleProblem;
  }
  if (current && GOOGLE_ACTION_FIELDS.every((f) => (v[f.name] ?? '').trim() === current[f.name])) return AD_PLATFORMS_TEXT.nothingChanged;
  return null;
}

/** What GOOGLE CONVERSION ACTIONS sends: the four, trimmed, empty as null. */
export function googleActionsInput(v: Partial<GoogleActionsForm>): Record<keyof GoogleActionsForm, string | null> {
  return Object.fromEntries(GOOGLE_ACTION_FIELDS.map((f) => [f.name, (v[f.name] ?? '').trim() === '' ? null : (v[f.name] ?? '').trim()])) as Record<keyof GoogleActionsForm, string | null>;
}

// ── Consent ──────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-10` → `October 2026`. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** True when nobody chose this month. */
export const consentEmpty = (s: Pick<AdsSettings, 'consent'>): boolean => s.consent.granted + s.consent.declined === 0;

// ── Events ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EventsFilter {
  status: AdEventStatus | null;
  platform: AdsPlatform | null;
}

/** The events' filter from the address; anything else is read as none. */
export function eventsFilter(query: Record<string, string | undefined>): EventsFilter {
  const status = (AD_EVENT_STATUSES as readonly string[]).includes(query.status ?? '') ? (query.status as AdEventStatus) : null;
  const platform = (ADS_PLATFORMS as readonly string[]).includes(query.platform ?? '') ? (query.platform as AdsPlatform) : null;
  return { status, platform };
}

/** The address's query for a filter: only what is set. */
export function eventsQuery(f: EventsFilter): Record<string, string> {
  return { ...(f.status ? { status: f.status } : {}), ...(f.platform ? { platform: f.platform } : {}) };
}

/** EVENTS' empty state: none at all, or none for this filter. */
export const eventsEmptyText = (f: EventsFilter): string => (f.status || f.platform ? AD_PLATFORMS_TEXT.eventsEmptyFiltered : AD_PLATFORMS_TEXT.eventsEmpty);

/** The filter's selects' options. */
export const statusOptions = (): { value: string; label: string }[] => [{ value: '', label: AD_PLATFORMS_TEXT.allStatuses }, ...AD_EVENT_STATUSES.map((s) => ({ value: s, label: EVENT_STATUS_LABELS[s] }))];
export const platformOptions = (): { value: string; label: string }[] => [{ value: '', label: AD_PLATFORMS_TEXT.allPlatforms }, ...ADS_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))];

/** Every act, in order (for the Google section). */
export const ACTS: readonly AdEventKind[] = AD_EVENT_KINDS;
