/**
 * The device's class (plan CUSTOMER INTELLIGENCE §3.3 T.8.1, T.14; src/server/http/device-class.ts): a matrix of real
 * user agents, the client hints winning over a reduced agent, the page's own word (home screen, touch, short side), and
 * the automated requests that are never recorded. Pure functions: no database, no server.
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_BROWSERS, DEVICE_KINDS, DEVICE_SYSTEMS, IN_APPS, OPENED_IN } from '../../src/server/db/schema.js';
import { classifyDevice, clientHintsOf, isAutomated, type DeviceClass } from '../../src/server/http/device-class.js';
import { userAgentFamily } from '../../src/server/http/client.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  // iPadOS asks for the desktop site by default: it reads as a Mac, but has touch.
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  androidChromePhone: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidChromeTablet: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 346.0.0.29.92 (iPhone15,2; iOS 17_6; fr_FR; fr; scale=3.00; 1179x2556; 634826386)',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 Instagram 349.0.0.39.105 Android (34/14; 480dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; fr_FR; 634826385)',
  tiktokIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR ByteFullLocale/fr',
  tiktokAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 trill_360504 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/36.5.4 ByteLocale/fr ByteFullLocale/fr Region/FR BytedanceWebview/d8a21c6',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/481.0.0.48.106;FBBV/634720372;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]',
  threads: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 349.0.0.21.106 (iPhone15,2; iOS 17_6; fr_FR; fr; scale=3.00; 1179x2556; 635000000)',
  snapchat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.10.0.42 (like Safari/8618.3.11.10.5, panda)',
  pinterest: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
  linkedin: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1563',
  google: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/333.0.676775632 Mobile/15E148 Safari/604.1',
  wechat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800323c) NetType/WIFI Language/zh_CN',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.14.0',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
} as const;

const AUTOMATED = {
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  curl: 'curl/8.7.1',
  headlessChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.28 Safari/537.36',
  lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  puppeteer: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Puppeteer',
  playwright: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.31 Safari/537.36 Playwright/1.48',
  phantom: 'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1',
} as const;

const of = (ua: string, extra: Partial<Parameters<typeof classifyDevice>[0]> = {}): DeviceClass => classifyDevice({ userAgent: ua, hints: {}, ...extra });
const phoneTouch = { standalone: false, touchPoints: 5, shortSide: 390 };
const tabletTouch = { standalone: false, touchPoints: 5, shortSide: 820 };
const desk = { standalone: false, touchPoints: 0, shortSide: 900 };

describe('classifyDevice', () => {
  it('reads each agent of the matrix: kind, system, browser, and where it was opened', () => {
    const expected: [keyof typeof UA, DeviceClass, Parameters<typeof classifyDevice>[0]['client']?][] = [
      ['iphoneSafari', { kind: 'PHONE', os: 'IOS', browser: 'SAFARI', openedIn: 'BROWSER', inApp: null }],
      ['iphoneChrome', { kind: 'PHONE', os: 'IOS', browser: 'CHROME', openedIn: 'BROWSER', inApp: null }],
      ['ipad', { kind: 'TABLET', os: 'IOS', browser: 'SAFARI', openedIn: 'BROWSER', inApp: null }],
      ['ipadDesktop', { kind: 'TABLET', os: 'IOS', browser: 'SAFARI', openedIn: 'BROWSER', inApp: null }, tabletTouch],
      ['androidChromePhone', { kind: 'PHONE', os: 'ANDROID', browser: 'CHROME', openedIn: 'BROWSER', inApp: null }],
      ['androidChromeTablet', { kind: 'TABLET', os: 'ANDROID', browser: 'CHROME', openedIn: 'BROWSER', inApp: null }],
      ['samsung', { kind: 'PHONE', os: 'ANDROID', browser: 'SAMSUNG', openedIn: 'BROWSER', inApp: null }],
      ['instagramIos', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'INSTAGRAM' }],
      ['instagramAndroid', { kind: 'PHONE', os: 'ANDROID', browser: 'CHROME', openedIn: 'IN_APP', inApp: 'INSTAGRAM' }],
      ['tiktokIos', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'TIKTOK' }],
      ['tiktokAndroid', { kind: 'PHONE', os: 'ANDROID', browser: 'CHROME', openedIn: 'IN_APP', inApp: 'TIKTOK' }],
      ['facebook', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'FACEBOOK' }],
      ['threads', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'THREADS' }],
      ['snapchat', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'SNAPCHAT' }],
      ['pinterest', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'PINTEREST' }],
      ['linkedin', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'LINKEDIN' }],
      ['google', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'GOOGLE' }],
      ['wechat', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'WECHAT' }],
      ['line', { kind: 'PHONE', os: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', inApp: 'LINE' }],
      ['androidWebview', { kind: 'PHONE', os: 'ANDROID', browser: 'CHROME', openedIn: 'IN_APP', inApp: 'OTHER' }],
      ['macSafari', { kind: 'COMPUTER', os: 'MACOS', browser: 'SAFARI', openedIn: 'BROWSER', inApp: null }, desk],
      ['macChrome', { kind: 'COMPUTER', os: 'MACOS', browser: 'CHROME', openedIn: 'BROWSER', inApp: null }],
      ['windowsEdge', { kind: 'COMPUTER', os: 'WINDOWS', browser: 'EDGE', openedIn: 'BROWSER', inApp: null }],
      ['linuxFirefox', { kind: 'COMPUTER', os: 'LINUX', browser: 'FIREFOX', openedIn: 'BROWSER', inApp: null }],
      ['chromeOs', { kind: 'COMPUTER', os: 'CHROMEOS', browser: 'CHROME', openedIn: 'BROWSER', inApp: null }],
      ['operaWindows', { kind: 'COMPUTER', os: 'WINDOWS', browser: 'OPERA', openedIn: 'BROWSER', inApp: null }],
    ];
    for (const [name, want, client] of expected) expect(of(UA[name], client ? { client } : {}), name).toEqual(want);
  });

  it('gives only values the database takes, and the app exactly when opened in one', () => {
    const agents = [...Object.values(UA), ...Object.values(AUTOMATED), '', 'Mozilla/5.0', 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80)'];
    for (const ua of agents) {
      for (const client of [undefined, phoneTouch, tabletTouch, desk, { standalone: true, touchPoints: 5, shortSide: 390 }]) {
        const c = of(ua, client ? { client } : {});
        expect(DEVICE_KINDS).toContain(c.kind);
        expect(DEVICE_SYSTEMS).toContain(c.os);
        expect(DEVICE_BROWSERS).toContain(c.browser);
        expect(OPENED_IN).toContain(c.openedIn);
        expect(c.openedIn === 'IN_APP', ua).toBe(c.inApp !== null);
        if (c.inApp !== null) expect(IN_APPS).toContain(c.inApp);
      }
    }
  });

  it('lets the client hints win over a reduced agent', () => {
    // Chrome's reduced agent on a Windows machine or a phone; the hints say what it is.
    const reducedDesktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    expect(of(reducedDesktop, { hints: { mobile: '?0', platform: 'Linux' } })).toMatchObject({ kind: 'COMPUTER', os: 'LINUX' });
    expect(of(reducedDesktop, { hints: { platform: 'Chrome OS' } })).toMatchObject({ kind: 'COMPUTER', os: 'CHROMEOS' });
    expect(of(reducedDesktop, { hints: { platform: 'macOS' } })).toMatchObject({ kind: 'COMPUTER', os: 'MACOS' });
    expect(of(reducedDesktop, { hints: { mobile: '?1', platform: 'Android' } })).toMatchObject({ kind: 'PHONE', os: 'ANDROID' });
    // An Android saying ?0 is a tablet, whatever its agent says.
    expect(of(UA.androidChromePhone, { hints: { mobile: '?0', platform: 'Android' } })).toMatchObject({ kind: 'TABLET', os: 'ANDROID' });
    expect(of(UA.androidChromeTablet, { hints: { mobile: '?1', platform: 'Android' } })).toMatchObject({ kind: 'PHONE', os: 'ANDROID' });
    // A platform it does not know is left to the agent.
    expect(of(UA.windowsEdge, { hints: { platform: 'Unknown' } })).toMatchObject({ os: 'WINDOWS' });
  });

  it('reads the page\'s own word: the home screen, the touch points and the short side', () => {
    expect(of(UA.iphoneSafari, { client: { standalone: true, touchPoints: 5, shortSide: 390 } })).toEqual({ kind: 'PHONE', os: 'IOS', browser: 'SAFARI', openedIn: 'HOME_SCREEN', inApp: null });
    // The home screen wins over an app's pattern: never both.
    expect(of(UA.instagramIos, { client: { standalone: true, touchPoints: 5, shortSide: 390 } })).toMatchObject({ openedIn: 'HOME_SCREEN', inApp: null });
    // A Mac without touch stays a computer; with touch it is an iPad asking for the desktop site.
    expect(of(UA.macSafari, { client: desk })).toMatchObject({ kind: 'COMPUTER', os: 'MACOS' });
    expect(of(UA.ipadDesktop, { client: tabletTouch })).toMatchObject({ kind: 'TABLET', os: 'IOS' });
    expect(of(UA.ipadDesktop)).toMatchObject({ kind: 'COMPUTER', os: 'MACOS' });
    // A touch screen under 600 px on its short side is a phone, whatever else is unknown.
    expect(of('Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5', { client: phoneTouch })).toMatchObject({ kind: 'PHONE' });
    expect(of('Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5')).toMatchObject({ kind: 'UNKNOWN', os: 'OTHER' });
    // Nonsense from the page is ignored.
    expect(of(UA.macSafari, { client: { standalone: 'yes', touchPoints: -3, shortSide: Number.NaN } as never })).toMatchObject({ kind: 'COMPUTER', openedIn: 'BROWSER' });
  });

  it('never throws, and reads nothing as UNKNOWN and OTHER', () => {
    expect(classifyDevice({ userAgent: null, hints: {} })).toEqual({ kind: 'UNKNOWN', os: 'OTHER', browser: 'OTHER', openedIn: 'BROWSER', inApp: null });
    expect(of('x'.repeat(10_000))).toEqual({ kind: 'UNKNOWN', os: 'OTHER', browser: 'OTHER', openedIn: 'BROWSER', inApp: null });
  });
});

describe('clientHintsOf', () => {
  it('keeps ?0 and ?1, and a plain platform unquoted; drops anything else', () => {
    expect(clientHintsOf({ 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' })).toEqual({ mobile: '?1', platform: 'Android' });
    expect(clientHintsOf({ 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Chrome OS"' })).toEqual({ mobile: '?0', platform: 'Chrome OS' });
    expect(clientHintsOf({ 'sec-ch-ua-mobile': ['?1', '?0'] })).toEqual({ mobile: '?1' });
    expect(clientHintsOf({ 'sec-ch-ua-mobile': '1', 'sec-ch-ua-platform': '"<script>"' })).toEqual({});
    expect(clientHintsOf({ 'sec-ch-ua-platform': `"${'a'.repeat(100)}"` })).toEqual({});
    expect(clientHintsOf({})).toEqual({});
  });
});

describe('isAutomated', () => {
  it('is true for crawlers, previews and scripts, and for headless browsers and audit tools that userAgentFamily reads as a browser', () => {
    for (const [name, ua] of Object.entries(AUTOMATED)) expect(isAutomated(ua, {}), name).toBe(true);
    // The raw test is needed: the family alone reads these as ordinary browsers.
    for (const ua of [AUTOMATED.headlessChrome, AUTOMATED.lighthouse, AUTOMATED.puppeteer, AUTOMATED.playwright, AUTOMATED.phantom]) {
      expect(userAgentFamily(ua), ua).not.toMatch(/^Bot\//);
    }
    expect(userAgentFamily(AUTOMATED.headlessChrome)).toBe('Chrome/Linux');
  });

  it('is true for a prefetch, by either header', () => {
    expect(isAutomated(UA.iphoneSafari, { 'sec-purpose': 'prefetch' })).toBe(true);
    expect(isAutomated(UA.macChrome, { 'sec-purpose': 'prefetch;prerender' })).toBe(true);
    expect(isAutomated(UA.windowsEdge, { purpose: 'prefetch' })).toBe(true);
    expect(isAutomated(UA.windowsEdge, { purpose: ['prefetch'] })).toBe(true);
  });

  it('is false for every person of the matrix', () => {
    for (const [name, ua] of Object.entries(UA)) expect(isAutomated(ua, { 'sec-fetch-mode': 'cors' }), name).toBe(false);
    expect(isAutomated(null, {})).toBe(false);
  });
});
