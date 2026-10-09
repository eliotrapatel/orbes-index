/**
 * The client sheet's Intelligence in the console (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.4, C.11, §3.4
 * A.10.5, §3.2 W.9, §3.3 T.4.1, step 5.7), as pure functions: the section's words and states, and its blocks 2 to 6 in
 * the words of the section that owns their data: Origin (where the client came from), Wishlist, What they look at,
 * Devices and Places. Block 1, the engagement score, ships with I2. Every time is Paris time, in the console's way of
 * writing dates; an AUDITOR reads every block without the cities.
 */
import { countryName } from '../../../shared/countries.js';
import { formatCount } from '../format.js';
import { parisDateTime } from './links.js';
import { parisDayText, dayText } from './client-profile.js';
import type { CollectorBrowsing, DeviceClassView, OriginSource, OwnerOrigin, StaffWish, ViewPageName } from '../types.js';

export const INTELLIGENCE_COPY = Object.freeze({
  title: 'Intelligence',
  note: 'Recorded on verify.theorbes.com. Staff only.',
  loading: 'Reading the intelligence',
  failed: 'The intelligence could not be read just now.',
  tryAgain: 'Try again',
  retry: 'Retry',
  origin: 'Origin',
  originFailed: 'The origin could not be read just now.',
  wishlist: 'Wishlist',
  wishlistNote: 'Private to the client and the team. No count is shown on the model’s sheet.',
  wishlistEmpty: 'No model wished.',
  wishlistFailed: 'The wishlist could not be read just now.',
  looks: 'What they look at',
  browsingFailed: 'Browsing could not be read just now.',
  nothing: 'Nothing recorded yet.',
  models: 'Most viewed models',
  releases: 'Releases viewed',
  devices: 'Devices',
  places: 'Places',
  placesFoot: 'City and country from the connection, approximate. IP geolocation by ',
  dbIp: 'DB-IP',
  dbIpHref: 'https://db-ip.com',
  citiesWithheld: 'Cities are withheld.',
  showAll: 'Show all',
  showMore: 'Show 50 more',
  withdrawn: '(withdrawn)',
});

/** The section's note: an account older than the recording says when it started (C.4.4). */
export function intelligenceNote(accountCreatedAt: string, recordingSince: string | null): string {
  if (recordingSince && Date.parse(accountCreatedAt) < Date.parse(recordingSince)) return `${INTELLIGENCE_COPY.note} Recording started on ${parisDayText(recordingSince)}.`;
  return INTELLIGENCE_COPY.note;
}

// ── Origin (§3.4 A.10.5) ─────────────────────────────────────────────────────────────────────────────────────────

/** A source in words: a link's name with its channel, `Instagram bio (Instagram)`; a campaign, a site, Direct… */
export function sourceText(s: OriginSource): string {
  return s.kind === 'LINK' && s.channel ? `${s.label} (${s.channel})` : s.label;
}

/** A row of the Origin block: its label, its words, and the link's page when a link's name opens it. */
export interface OriginRow {
  label: string;
  text: string;
  linkId: string | null;
}

export function originRows(o: OwnerOrigin): OriginRow[] {
  const first = o.firstVisit.at && o.firstVisit.source.kind !== 'BEFORE' ? `${parisDateTime(o.firstVisit.at)} · ${sourceText(o.firstVisit.source)}` : sourceText(o.firstVisit.source);
  return [
    { label: 'First visit', text: first, linkId: o.firstVisit.source.linkId },
    { label: 'Signed up through', text: sourceText(o.signUp.source), linkId: o.signUp.source.linkId },
    {
      label: 'Latest order through',
      text: o.lastOrder ? `${sourceText(o.lastOrder.source)} · ${o.lastOrder.reference}` : 'No purchase',
      linkId: o.lastOrder?.source.linkId ?? null,
    },
  ];
}

// ── Wishlist (§3.2 W.9, §3.6 C.4.4) ──────────────────────────────────────────────────────────────────────────────

/** After a model not shown in THE COLLECTION now: '(hidden)' or '(discontinued)'. */
export function wishMark(w: Pick<StaffWish, 'state'>): string | null {
  if (w.state === 'HIDDEN') return '(hidden)';
  if (w.state === 'DISCONTINUED') return '(discontinued)';
  return null;
}

// ── What they look at (§3.3 T.4.1) ───────────────────────────────────────────────────────────────────────────────

/** A length of time: `45 s`, `38 min`, `3 h 12 min`. */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The pages in words (the collector app's screens). */
export const PAGE_WORDS: Readonly<Record<ViewPageName | 'OTHER', string>> = Object.freeze({
  SCAN: 'Scans',
  NOW: 'NOW',
  RESULT: 'Scan results',
  MY_PIECES: 'My pieces',
  MY_ORDERS: 'My orders',
  MY_RELEASES: 'My releases',
  PIECE: 'A piece',
  CERTIFICATE: 'Certificates',
  COLLECTION: 'The collection',
  MODEL: 'Models',
  CLUB: 'The club',
  RELEASES: 'Releases',
  RELEASE: 'A release',
  LIVE: 'LIVE rooms',
  AFTER_ROOM: 'After the room',
  HOW: 'How releases work',
  CIRCLE: 'The circle',
  POST: 'Circle posts',
  ACCOUNT: 'The account',
  MESSAGES: 'Messages',
  SIGN_IN: 'Sign in',
  SIGN_UP: 'Create account',
  SIZES: 'Your sizes',
  ADDRESSES: 'Your addresses',
  PROFILE: 'Your profile',
  WISHLIST: 'Your wishlist',
  OTHER: 'Other',
});

const SYSTEM_WORDS: Readonly<Record<DeviceClassView['system'], string>> = { IOS: 'iOS', ANDROID: 'Android', MACOS: 'macOS', WINDOWS: 'Windows', CHROMEOS: 'ChromeOS', LINUX: 'Linux', OTHER: '' };
const BROWSER_WORDS: Readonly<Record<DeviceClassView['browser'], string>> = { SAFARI: 'Safari', CHROME: 'Chrome', FIREFOX: 'Firefox', EDGE: 'Edge', SAMSUNG: 'Samsung Internet', OPERA: 'Opera', WEBVIEW: 'WebView', OTHER: '' };
const KIND_WORDS: Readonly<Record<DeviceClassView['kind'], string>> = { PHONE: 'Phone', TABLET: 'Tablet', COMPUTER: 'Computer', UNKNOWN: 'Device' };
/** The apps' names. */
export const APP_WORDS: Readonly<Record<NonNullable<DeviceClassView['app']>, string>> = Object.freeze({
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
  THREADS: 'Threads',
  SNAPCHAT: 'Snapchat',
  PINTEREST: 'Pinterest',
  LINKEDIN: 'LinkedIn',
  GOOGLE: 'Google',
  WECHAT: 'WeChat',
  LINE: 'LINE',
  OTHER: 'Other app',
});

/** A device's name: `iPhone`, `iPad`, `Android phone`, `Computer · macOS`. */
export function deviceName(d: Pick<DeviceClassView, 'kind' | 'system'>): string {
  if (d.system === 'IOS' && d.kind === 'PHONE') return 'iPhone';
  if (d.system === 'IOS' && d.kind === 'TABLET') return 'iPad';
  if (d.system === 'ANDROID' && d.kind === 'PHONE') return 'Android phone';
  if (d.system === 'ANDROID' && d.kind === 'TABLET') return 'Android tablet';
  const system = SYSTEM_WORDS[d.system];
  if (d.kind === 'UNKNOWN') return system || KIND_WORDS.UNKNOWN;
  return system ? `${KIND_WORDS[d.kind]} · ${system}` : KIND_WORDS[d.kind];
}

/** A device and its browser outside an app: `iPhone · Safari`, `Computer · macOS · Chrome`, `iPhone`. */
export function deviceText(d: DeviceClassView): string {
  const browser = d.openedIn === 'IN_APP' ? '' : BROWSER_WORDS[d.browser];
  return browser ? `${deviceName(d)} · ${browser}` : deviceName(d);
}

/** Where it was opened: `Browser`, `Home screen`, or the app's name. */
export function openedInText(d: Pick<DeviceClassView, 'openedIn' | 'app'>): string {
  if (d.openedIn === 'IN_APP') return APP_WORDS[d.app ?? 'OTHER'];
  return d.openedIn === 'HOME_SCREEN' ? 'Home screen' : 'Browser';
}

/** A place from the connection: `Paris, France`, or the country alone (no city, or withheld). */
export function placeText(p: { country: string; city: string | null }): string {
  const country = p.country === 'ZZ' ? 'Unknown country' : countryName(p.country);
  return p.city ? `${p.city}, ${country}` : country;
}

/** Whether nothing at all is recorded for the account: the block says « Nothing recorded yet. ». */
export function nothingRecorded(b: CollectorBrowsing): boolean {
  return b.lastSeen === null && b.views.count === 0 && b.scans.count === 0 && b.older === null && b.devices.length === 0 && b.places.length === 0;
}

/** « Before the account » in its four forms (T.4.1). */
export function beforeAccountText(b: CollectorBrowsing['beforeAccount']): string {
  switch (b.kind) {
    case 'BROWSED':
      return `Browsed ${plural(b.days, 'day', 'days')} before signing up, from ${parisDayText(b.from)}: ${plural(b.views, 'view', 'views')}, ${plural(b.scans, 'scan', 'scans')}.`;
    case 'FIRST_VISIT':
      return 'Signed up on the first visit.';
    case 'NOTHING':
      return 'Nothing recorded before the account.';
    case 'OLDER':
      return `The account is older than the recording, which started on ${parisDayText(b.startedAt)}.`;
  }
}

/** The block's rows, top to bottom (T.4.1): label, words, and a note under them. */
export function browsingRows(b: CollectorBrowsing): { label: string; text: string; note?: string }[] {
  const last = b.lastSeen
    ? [parisDateTime(b.lastSeen.at), b.lastSeen.device ? deviceName(b.lastSeen.device) : null, b.lastSeen.place ? placeText(b.lastSeen.place) : null].filter((x): x is string => x !== null).join(' · ')
    : '—';
  const older = b.older ? `Before ${dayText(b.older.before)}: ${plural(b.older.views, 'view', 'views')}, ${durationText(b.older.seconds)} (summary).` : undefined;
  const scans =
    b.scans.count === 0
      ? '0 scans'
      : [plural(b.scans.count, 'scan', 'scans'), b.scans.beforeAccount > 0 ? `${formatCount(b.scans.beforeAccount)} before the account` : null, b.scans.firstAt ? `first on ${parisDayText(b.scans.firstAt)}` : null]
          .filter((x): x is string => x !== null)
          .join(' · ');
  return [
    { label: 'Last seen', text: last },
    { label: 'Active days', text: `${formatCount(b.activeDays.last30)} of the last 30 days · ${formatCount(b.activeDays.last90)} of the last 90` },
    { label: 'Views', text: `${formatCount(b.views.count)} in the last 13 months · ${durationText(b.views.seconds)}`, note: older },
    { label: 'Before the account', text: beforeAccountText(b.beforeAccount) },
    { label: 'Scans', text: scans },
    { label: 'Pages', text: b.pages.length ? b.pages.map((p) => `${PAGE_WORDS[p.page]} ${p.share} %`).join(' · ') : '—' },
  ];
}

/** A release viewed: its views and time, and `· LIVE room 38 min` when the collector stayed in the room. */
export function releaseTimeText(r: { seconds: number; live: boolean; liveSeconds: number }): string {
  return r.live && r.liveSeconds > 0 ? `${durationText(r.seconds)} · LIVE room ${durationText(r.liveSeconds)}` : durationText(r.seconds);
}

/** « Show all » under the five most viewed: shown while more models were viewed than the sheet lists. */
export function showAllModels(b: Pick<CollectorBrowsing, 'models' | 'modelsViewed'>): boolean {
  return b.modelsViewed > b.models.length;
}
