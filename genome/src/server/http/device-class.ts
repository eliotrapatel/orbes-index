/**
 * A device's class, read from its request (plan CUSTOMER INTELLIGENCE §3.3 T.8.1): phone, tablet or computer; iPhone,
 * Android or a computer's system; the browser; and where the page was opened (a browser, an app's built-in browser such
 * as Instagram's or TikTok's, or the home screen). Stored on `tracking_devices` and counted in `device_daily_stats`.
 *
 * Pure, no I/O. The raw user agent is read here in memory only and never stored: what leaves is the class (five values
 * from schema.ts's lists). Client hints (`sec-ch-ua-mobile`, `sec-ch-ua-platform`, which Chromium sends over HTTPS
 * without being asked) win over the user agent, which Chrome now reduces. What the page itself says (the home screen,
 * the touch points, the screen's short side) refines it.
 *
 * `isAutomated` tells a robot, a headless browser or a prefetch from a person, so their requests are never recorded.
 */
import type { DeviceBrowser, DeviceKind, DeviceSystem, InApp, OpenedIn } from '../db/schema.js';
import { userAgentFamily } from './client.js';

/** What the request's client hints say (`sec-ch-ua-mobile`, `sec-ch-ua-platform`, the platform unquoted). */
export interface DeviceHints {
  mobile?: '?0' | '?1';
  platform?: string;
}

/** What the page says of itself (sent by the collector app): standalone (home screen), touch points, the screen's short side in CSS pixels. */
export interface DeviceClient {
  standalone: boolean;
  touchPoints: number;
  shortSide: number;
}

export interface DeviceClassInput {
  userAgent: string | null;
  hints: DeviceHints;
  client?: DeviceClient;
}

export interface DeviceClass {
  kind: DeviceKind;
  os: DeviceSystem;
  browser: DeviceBrowser;
  openedIn: OpenedIn;
  /** The app whose built-in browser opened the page; set exactly when openedIn is IN_APP. */
  inApp: InApp | null;
}

/** The apps whose built-in browser is recognised, checked before any browser (Threads first: its agent is Instagram's family). */
const IN_APP_PATTERNS: readonly (readonly [InApp, RegExp])[] = [
  ['THREADS', /Barcelona/],
  ['INSTAGRAM', /Instagram/],
  ['TIKTOK', /musical_ly|BytedanceWebview|TikTok/],
  ['FACEBOOK', /FBAN|FBAV|FB_IAB/],
  ['SNAPCHAT', /Snapchat/],
  ['PINTEREST', /Pinterest/],
  ['LINKEDIN', /LinkedInApp/],
  ['GOOGLE', /GSA\//],
  ['WECHAT', /MicroMessenger/],
  ['LINE', / Line\//],
];
/** An Android WebView inside an app not named above. */
const ANDROID_WEBVIEW = /; wv\)/;

/** `userAgentFamily`'s browser → the stored browser. Bot and Other read OTHER. */
const BROWSERS: Readonly<Record<string, DeviceBrowser>> = {
  Safari: 'SAFARI',
  Chrome: 'CHROME',
  Firefox: 'FIREFOX',
  Edge: 'EDGE',
  Samsung: 'SAMSUNG',
  Opera: 'OPERA',
  WebView: 'WEBVIEW',
};

/** `sec-ch-ua-platform` (unquoted, case-insensitive) → the system. Anything else is left to the user agent. */
const PLATFORMS: Readonly<Record<string, DeviceSystem>> = {
  android: 'ANDROID',
  ios: 'IOS',
  macos: 'MACOS',
  windows: 'WINDOWS',
  'chrome os': 'CHROMEOS',
  chromeos: 'CHROMEOS',
  'chromium os': 'CHROMEOS',
  linux: 'LINUX',
};

/**
 * Headless browsers and audit tools whose user agent `userAgentFamily` reads as an ordinary browser (`Chrome/Linux`,
 * `Other/…`): read on the raw string, in memory only.
 */
const AUTOMATED_AGENT = /HeadlessChrome|Chrome-Lighthouse|Lighthouse|PhantomJS|Puppeteer|Playwright/i;

const MAX_AGENT = 512;

function osOf(ua: string, hints: DeviceHints, client: DeviceClient | undefined): DeviceSystem {
  const hinted = hints.platform === undefined ? undefined : PLATFORMS[hints.platform.trim().toLowerCase()];
  if (hinted) return hinted;
  if (/iPhone|iPad|iPod/.test(ua)) return 'IOS';
  // An iPad asking for the desktop site reads as a Mac; only its touch points tell it apart.
  if (/Macintosh/.test(ua) && (client?.touchPoints ?? 0) > 1) return 'IOS';
  if (/Android/.test(ua)) return 'ANDROID';
  if (/CrOS/.test(ua)) return 'CHROMEOS';
  if (/Windows NT/.test(ua)) return 'WINDOWS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'MACOS';
  if (/Linux/.test(ua)) return 'LINUX';
  return 'OTHER';
}

function kindOf(ua: string, os: DeviceSystem, hints: DeviceHints, client: DeviceClient | undefined): DeviceKind {
  const touch = (client?.touchPoints ?? 0) > 0;
  const ipad = /iPad/.test(ua) || (os === 'IOS' && /Macintosh/.test(ua));
  // An Android is a phone when it says so: the hint first, else « Mobile » in its agent.
  const androidPhone = os === 'ANDROID' && (hints.mobile !== undefined ? hints.mobile === '?1' : /Mobile/.test(ua));
  if (/iPhone|iPod/.test(ua) || androidPhone || hints.mobile === '?1' || (touch && client !== undefined && client.shortSide > 0 && client.shortSide < 600)) {
    return 'PHONE';
  }
  if (ipad || os === 'ANDROID') return 'TABLET';
  if (os === 'WINDOWS' || os === 'MACOS' || os === 'LINUX' || os === 'CHROMEOS') return 'COMPUTER';
  return 'UNKNOWN';
}

/** The class of the device behind a request. Never throws; what cannot be read is UNKNOWN or OTHER. */
export function classifyDevice(input: DeviceClassInput): DeviceClass {
  const ua = typeof input.userAgent === 'string' ? input.userAgent.slice(0, MAX_AGENT) : '';
  const hints = input.hints ?? {};
  const client = validClient(input.client);
  const os = osOf(ua, hints, client);
  const kind = kindOf(ua, os, hints, client);
  const family = userAgentFamily(ua);
  const browser: DeviceBrowser = (family ? BROWSERS[family.split('/')[0]] : undefined) ?? 'OTHER';
  let inApp: InApp | null = IN_APP_PATTERNS.find(([, re]) => re.test(ua))?.[0] ?? null;
  if (!inApp && os === 'ANDROID' && ANDROID_WEBVIEW.test(ua)) inApp = 'OTHER';
  if (client?.standalone) return { kind, os, browser, openedIn: 'HOME_SCREEN', inApp: null };
  return { kind, os, browser, openedIn: inApp ? 'IN_APP' : 'BROWSER', inApp };
}

/**
 * The client hints of a request (`sec-ch-ua-mobile`, `sec-ch-ua-platform`): the mobile flag when it is exactly ?0 or ?1,
 * the platform unquoted when it is a short plain word. Anything else is dropped, never guessed.
 */
export function clientHintsOf(headers: Record<string, string | string[] | undefined>): DeviceHints {
  const first = (name: string): string | undefined => {
    const v = headers[name];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s.length <= 64 ? s.trim() : undefined;
  };
  const out: DeviceHints = {};
  const mobile = first('sec-ch-ua-mobile');
  if (mobile === '?0' || mobile === '?1') out.mobile = mobile;
  const platform = first('sec-ch-ua-platform')?.replace(/^"(.*)"$/, '$1').trim();
  if (platform && /^[A-Za-z][A-Za-z ]{0,30}$/.test(platform)) out.platform = platform;
  return out;
}

/**
 * True for a request no person made: a crawler or script (`userAgentFamily`'s Bot), a headless browser or audit tool
 * (read on the raw agent, which `userAgentFamily` reads as Chrome or Other), or a prefetch (`sec-purpose`, `purpose`).
 */
export function isAutomated(userAgent: string | null | undefined, headers: Record<string, string | string[] | undefined>): boolean {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, MAX_AGENT) : '';
  if (userAgentFamily(ua)?.startsWith('Bot/')) return true;
  if (AUTOMATED_AGENT.test(ua)) return true;
  for (const name of ['sec-purpose', 'purpose']) {
    const v = headers[name];
    for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string' && /prefetch/i.test(s)) return true;
  }
  return false;
}

function validClient(c: DeviceClient | undefined): DeviceClient | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { standalone: c.standalone === true, touchPoints: n(c.touchPoints), shortSide: n(c.shortSide) };
}
