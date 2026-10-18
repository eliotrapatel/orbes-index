/**
 * A device as the browser reports it, for the unit tests of the desktop switch (src/web/shared/desktop.ts): the
 * navigator's words (user agent, platform, userAgentData's system, touch points) and the media features the switch
 * reads (the main pointer, hover, the window's width). `installDevice` puts it in place of the page's `navigator` and
 * `matchMedia` (vitest runs in node); the media lists it gives read the device installed now, so a query kept by the
 * module answers for the next device too.
 */
import { vi } from 'vitest';

export interface FakeDevice {
  readonly userAgent: string;
  readonly platform: string;
  /** navigator.userAgentData.platform; absent where the browser has no userAgentData (Safari, Firefox). */
  readonly system?: string;
  readonly touchPoints: number;
  /** The main pointer: a finger (coarse, no hover) or a mouse or trackpad (fine, with hover). */
  readonly pointer: 'coarse' | 'fine';
  /** The window's width in CSS px. */
  readonly width: number;
}

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  ipadChrome: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
} as const;

/** What each device is: a phone or a tablet (`d-touch`), a computer with a touch screen (`d-tap`), a computer. */
export type DeviceKind = 'phone or tablet' | 'touch computer' | 'computer';

/** The devices of the owner's answer Q2, each with what it is (at its own usual width; `at` gives another). */
export const DEVICES: readonly { name: string; kind: DeviceKind; device: FakeDevice }[] = [
  { name: 'an iPhone', kind: 'phone or tablet', device: { userAgent: UA.iphone, platform: 'iPhone', touchPoints: 5, pointer: 'coarse', width: 390 } },
  { name: 'an iPad held by hand (Safari, as a Mac)', kind: 'phone or tablet', device: { userAgent: UA.ipadAsMac, platform: 'MacIntel', touchPoints: 5, pointer: 'coarse', width: 1366 } },
  { name: 'an iPad with its trackpad (Safari, as a Mac)', kind: 'phone or tablet', device: { userAgent: UA.ipadAsMac, platform: 'MacIntel', touchPoints: 5, pointer: 'fine', width: 1366 } },
  { name: 'an iPad with its trackpad (Chrome)', kind: 'phone or tablet', device: { userAgent: UA.ipadChrome, platform: 'iPad', touchPoints: 5, pointer: 'fine', width: 1366 } },
  { name: 'an Android phone', kind: 'phone or tablet', device: { userAgent: UA.androidPhone, platform: 'Linux armv81', system: 'Android', touchPoints: 5, pointer: 'coarse', width: 412 } },
  { name: 'an Android tablet with a trackpad cover (a fine pointer)', kind: 'phone or tablet', device: { userAgent: UA.androidTablet, platform: 'Linux armv81', system: 'Android', touchPoints: 10, pointer: 'fine', width: 1280 } },
  { name: 'an Android tablet with a mouse, its user agent reduced', kind: 'phone or tablet', device: { userAgent: UA.linux, platform: 'Linux armv81', system: 'Android', touchPoints: 10, pointer: 'fine', width: 1280 } },
  // Chrome's "Desktop site" on a large Android tablet with its cover: a Linux computer's user agent and system, its ARM
  // platform and touch points kept (a fingerprint still to be read on a real device, plan review DESK-R).
  { name: 'an Android tablet in Chrome\'s desktop site, with a trackpad cover', kind: 'phone or tablet', device: { userAgent: UA.linux, platform: 'Linux armv8l', system: 'Linux', touchPoints: 10, pointer: 'fine', width: 1280 } },
  { name: 'an Android phone in Firefox (no userAgentData)', kind: 'phone or tablet', device: { userAgent: UA.androidFirefox, platform: 'Linux armv81', touchPoints: 5, pointer: 'coarse', width: 412 } },
  { name: 'a Windows laptop with a touch screen and a trackpad', kind: 'touch computer', device: { userAgent: UA.windows, platform: 'Win32', system: 'Windows', touchPoints: 10, pointer: 'fine', width: 1920 } },
  { name: 'a Windows laptop with a touch screen, in Firefox', kind: 'touch computer', device: { userAgent: UA.windowsFirefox, platform: 'Win32', touchPoints: 10, pointer: 'fine', width: 1536 } },
  { name: 'a Chromebook with a touch screen', kind: 'touch computer', device: { userAgent: UA.chromebook, platform: 'Linux x86_64', system: 'Chrome OS', touchPoints: 10, pointer: 'fine', width: 1366 } },
  { name: 'a Windows laptop folded into a tablet (its main pointer a finger)', kind: 'phone or tablet', device: { userAgent: UA.windows, platform: 'Win32', system: 'Windows', touchPoints: 10, pointer: 'coarse', width: 1280 } },
  { name: 'a Windows computer with a mouse', kind: 'computer', device: { userAgent: UA.windows, platform: 'Win32', system: 'Windows', touchPoints: 0, pointer: 'fine', width: 1920 } },
  { name: 'a Mac', kind: 'computer', device: { userAgent: UA.mac, platform: 'MacIntel', system: 'macOS', touchPoints: 0, pointer: 'fine', width: 1440 } },
  { name: 'a Linux computer', kind: 'computer', device: { userAgent: UA.linux, platform: 'Linux x86_64', system: 'Linux', touchPoints: 0, pointer: 'fine', width: 1440 } },
];

/** The device named, at another width. */
export function at(name: string, width: number): FakeDevice {
  const d = DEVICES.find((x) => x.name === name);
  if (!d) throw new Error(`no device ${name}`);
  return { ...d.device, width };
}

/** Whether `query` (the switch's own: a list of `(feature: value)` joined by `and`) matches on `d`. */
export function matches(query: string, d: FakeDevice): boolean {
  return query.split(/\s+and\s+/).every((part) => {
    const m = /^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/.exec(part.trim());
    if (!m) throw new Error(`a query the fake cannot read: ${query}`);
    const [, feature, value] = m;
    if (feature === 'min-width') return d.width >= Number.parseFloat(value!);
    if (feature === 'max-width') return d.width <= Number.parseFloat(value!);
    if (feature === 'pointer') return value === d.pointer;
    if (feature === 'hover') return value === (d.pointer === 'fine' ? 'hover' : 'none');
    throw new Error(`a feature the fake cannot read: ${feature}`);
  });
}

/** The navigator `d`'s browser gives. */
export function navigatorOf(d: FakeDevice): Record<string, unknown> {
  return { userAgent: d.userAgent, platform: d.platform, maxTouchPoints: d.touchPoints, ...(d.system === undefined ? {} : { userAgentData: { platform: d.system } }) };
}

/** A matchMedia whose lists answer for the device `current()` returns at each read. */
export function matchMediaOf(current: () => FakeDevice): (query: string) => MediaQueryList {
  return (query: string) =>
    ({
      media: query,
      get matches() {
        return matches(query, current());
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
}

let installed: FakeDevice | null = null;

/** Puts `d` in place of the page's navigator and matchMedia (undone by vi.unstubAllGlobals). */
export function installDevice(d: FakeDevice): void {
  installed = d;
  vi.stubGlobal('navigator', navigatorOf(d));
  vi.stubGlobal('matchMedia', matchMediaOf(() => installed!));
}
