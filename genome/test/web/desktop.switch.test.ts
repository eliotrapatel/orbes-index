/**
 * The desktop switch (src/web/shared/desktop.ts and its copy before the first paint, src/web/shared/mode-early.ts),
 * as the owner answered Q2 on 2026-10-16: every Android, iPhone and iPad device keeps the phone layout, a tablet
 * with a keyboard or trackpad cover included, and so does any device whose main pointer is a finger (`html.d-touch`);
 * a computer with a touch screen has the desktop layout and is marked `html.d-tap` (its desktop controls' hit areas
 * reach 44 px, shared/desktop-tap.css); a computer's words and its sound (decision D6) read "a computer" whatever the
 * window's width, the 1024 px being the layout's only. The pages themselves (a touch laptop, an iPad with its
 * trackpad, an Android tablet with a fine pointer, a 900 px mouse window) are opened in Chromium by the desktop
 * suites.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_QUERY, isDesktop, onComputer, phoneOrTablet, POINTER_QUERY, tapComputer, touchLayout } from '../../src/web/shared/desktop.js';
import { at, DEVICES, installDevice, matches, matchMediaOf, navigatorOf, type FakeDevice } from '../support/fake-device.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'web');

/** The facts `phoneOrTablet` reads, as the page's navigator and media give them. */
const facts = (d: FakeDevice) => ({ userAgent: d.userAgent, platform: d.platform, system: d.system, touchPoints: d.touchPoints, coarse: d.pointer === 'coarse' });

/** The classes shared/mode-early.ts puts on the root of a page opened on `d` (the script run as the shell runs it). */
function earlyClasses(d: FakeDevice): string[] {
  const { code } = transformSync(readFileSync(join(WEB, 'shared/mode-early.ts'), 'utf8'), { loader: 'ts', format: 'iife' });
  const classes = new Set<string>();
  const root = { dataset: {} as Record<string, string>, classList: { add: (c: string) => classes.add(c), contains: (c: string) => classes.has(c) }, appendChild: () => undefined };
  runInNewContext(code, {
    localStorage: { getItem: () => null },
    navigator: navigatorOf(d),
    matchMedia: matchMediaOf(() => d),
    document: {
      documentElement: root,
      querySelector: () => null,
      // The scrollbar probe: a gutter of 0 (overlay scrollbars), so only the switch's marks are read here.
      createElement: () => ({ style: {}, offsetWidth: 100, clientWidth: 100, remove: () => undefined }),
    },
  });
  return [...classes].filter((c) => c === 'd-touch' || c === 'd-tap').sort();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the desktop switch: who has the phone layout (Q2)', () => {
  it.each(DEVICES.map((d) => [d.name, d.kind, d.device] as const))('%s is a %s', (_name, kind, device) => {
    expect(phoneOrTablet(facts(device))).toBe(kind === 'phone or tablet');
    installDevice(device);
    expect(touchLayout()).toBe(kind === 'phone or tablet');
    expect(tapComputer()).toBe(kind === 'touch computer');
  });

  it('marks the page before its first paint as the module decides: d-touch for a phone or a tablet, d-tap for a touch computer, nothing for a computer', () => {
    for (const { name, kind, device } of DEVICES) {
      const want = kind === 'phone or tablet' ? ['d-touch'] : kind === 'touch computer' ? ['d-tap'] : [];
      expect(earlyClasses(device), name).toEqual(want);
    }
  });

  it('keeps an iPad that asks for the computer\'s site a tablet: a Mac never has touch points', () => {
    const mac = DEVICES.find((d) => d.name === 'a Mac')!.device;
    expect(phoneOrTablet(facts({ ...mac, touchPoints: 0 }))).toBe(false);
    expect(phoneOrTablet(facts({ ...mac, touchPoints: 5 }))).toBe(true);
    expect(phoneOrTablet(facts({ ...mac, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', touchPoints: 5 }))).toBe(true);
  });

  it('reads the browser\'s system first: an Android device with a reduced user agent is still a tablet, a Windows one with touch a computer', () => {
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    expect(phoneOrTablet({ userAgent: linux, platform: 'Linux armv81', system: 'Android', touchPoints: 10, coarse: false })).toBe(true);
    expect(phoneOrTablet({ userAgent: linux, platform: 'Linux x86_64', system: 'Linux', touchPoints: 10, coarse: false })).toBe(false);
    for (const system of ['iOS', 'iPadOS', 'android']) expect(phoneOrTablet({ userAgent: linux, platform: '', system, touchPoints: 0, coarse: false }), system).toBe(true);
  });

  it('keeps an Android tablet whose Chrome asks for the computer\'s site a tablet: an ARM platform with touch points, never a Chromebook', () => {
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const armChromebook = 'Mozilla/5.0 (X11; CrOS aarch64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    for (const platform of ['Linux armv8l', 'Linux armv7l', 'Linux aarch64']) {
      expect(phoneOrTablet({ userAgent: linux, platform, system: 'Linux', touchPoints: 10, coarse: false }), platform).toBe(true);
      expect(phoneOrTablet({ userAgent: linux, platform, system: 'Linux', touchPoints: 0, coarse: false }), `${platform}, no touch`).toBe(false);
    }
    expect(phoneOrTablet({ userAgent: armChromebook, platform: 'Linux aarch64', system: 'Chrome OS', touchPoints: 10, coarse: false })).toBe(false);
  });

  it('once the page is marked d-touch it stays a phone or a tablet, as its styles do', () => {
    installDevice(at('a Windows laptop with a touch screen and a trackpad', 1920));
    expect(touchLayout()).toBe(false);
    vi.stubGlobal('document', { documentElement: { classList: { contains: (c: string) => c === 'd-touch' } } });
    expect(touchLayout()).toBe(true);
    expect(isDesktop()).toBe(false);
    expect(onComputer()).toBe(false);
  });

  it('is never a computer outside a browser (the tests, the server)', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(touchLayout()).toBe(false);
    expect(tapComputer()).toBe(false);
    expect(onComputer()).toBe(false);
  });
});

describe('the desktop layout and a computer\'s words (D6)', () => {
  it('holds the layout\'s query and the pointer\'s: the width for the layout only', () => {
    expect(DESKTOP_QUERY).toBe('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
    expect(POINTER_QUERY).toBe('(hover: hover) and (pointer: fine)');
    expect(DESKTOP_QUERY.endsWith(POINTER_QUERY)).toBe(true);
  });

  it.each([
    ['a Mac', 1440, { desktop: true, computer: true }],
    ['a Mac', 1024, { desktop: true, computer: true }],
    ['a Mac', 900, { desktop: false, computer: true }],
    ['a Mac', 683, { desktop: false, computer: true }],
    ['a Windows computer with a mouse', 1023, { desktop: false, computer: true }],
    ['a Windows laptop with a touch screen and a trackpad', 1920, { desktop: true, computer: true }],
    ['a Windows laptop with a touch screen and a trackpad', 1366, { desktop: true, computer: true }],
    ['a Windows laptop with a touch screen and a trackpad', 900, { desktop: false, computer: true }],
    ['a Chromebook with a touch screen', 1366, { desktop: true, computer: true }],
    ['an iPad with its trackpad (Safari, as a Mac)', 1366, { desktop: false, computer: false }],
    ['an iPad held by hand (Safari, as a Mac)', 1366, { desktop: false, computer: false }],
    ['an Android tablet with a trackpad cover (a fine pointer)', 1280, { desktop: false, computer: false }],
    ['a Windows laptop folded into a tablet (its main pointer a finger)', 1280, { desktop: false, computer: false }],
    ['an iPhone', 390, { desktop: false, computer: false }],
  ] as const)('%s at %i px: %o', (name, width, want) => {
    const device = at(name, width);
    installDevice(device);
    expect(isDesktop()).toBe(want.desktop);
    expect(onComputer()).toBe(want.computer);
    // The layout is the stylesheet's own query on a device that is not a phone or a tablet.
    expect(isDesktop()).toBe(matches(DESKTOP_QUERY, device) && !phoneOrTablet(facts(device)));
  });

  it('answers for the window as it is now: a computer\'s window resized across 1024 px changes its layout, never its words', () => {
    installDevice(at('a Mac', 1440));
    expect([isDesktop(), onComputer()]).toEqual([true, true]);
    installDevice(at('a Mac', 900));
    expect([isDesktop(), onComputer()]).toEqual([false, true]);
    installDevice(at('a Mac', 1280));
    expect([isDesktop(), onComputer()]).toEqual([true, true]);
  });
});
