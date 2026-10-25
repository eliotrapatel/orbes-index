/**
 * The light mode (src/web/shared/mode.ts, the owner's choice of 2026-10-14: GALLERY WHITE · SOFT) and its preference
 * kept on the device (src/web/shared/prefs.ts `orbes.mode`): light only once turned on, dark the default with nothing
 * stored; the root's attribute the stylesheet reads; the early script's own copy of the key, the value and the bar's
 * colour; the two shells loading it before their stylesheet; the stylesheet's scope (every NOCTURNE screen but the
 * camera, nothing outside the mode). The switch in YOUR ACCOUNT and the screens are checked in Chromium by
 * verify.mode.e2e.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMode, DeviceMode, isLight, MODE_THEME_COLOURS } from '../../src/web/shared/mode.js';
import { lightPref, MODE_LIGHT, MODE_PREF_KEY, setLightPref, SOUND_PREF_KEY, type PrefStorage } from '../../src/web/shared/prefs.js';
import { MODE } from '../../src/web/verify/copy.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'web');
const source = (rel: string) => readFileSync(join(WEB, rel), 'utf8');

/** A Map behind the Storage interface. */
class MemoryStorage implements PrefStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A storage that refuses every access (a private window, storage blocked). */
const REFUSING: PrefStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
  removeItem: () => {
    throw new Error('refused');
  },
};

/** The part of the page's root the mode touches. */
const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

describe('the light mode: its preference on the device', () => {
  it('is off by default and stores nothing until it is turned on; turned off again, the key is removed', () => {
    const storage = new MemoryStorage();
    expect(MODE_PREF_KEY).toBe('orbes.mode');
    expect(MODE_LIGHT).toBe('light');
    expect(MODE_PREF_KEY).not.toBe(SOUND_PREF_KEY);
    expect(lightPref(storage)).toBe(false);
    expect(setLightPref(true, storage)).toBe(true);
    expect([...storage.items]).toEqual([[MODE_PREF_KEY, MODE_LIGHT]]);
    expect(lightPref(storage)).toBe(true);
    expect(setLightPref(false, storage)).toBe(true);
    expect(storage.items.size).toBe(0);
    expect(lightPref(storage)).toBe(false);
  });

  it('reads any other value, a missing storage and a storage that refuses as the default, dark', () => {
    const storage = new MemoryStorage();
    storage.setItem(MODE_PREF_KEY, 'dark');
    expect(lightPref(storage)).toBe(false);
    expect(lightPref(null)).toBe(false);
    expect(lightPref(REFUSING)).toBe(false);
    expect(setLightPref(true, null)).toBe(false);
    expect(setLightPref(true, REFUSING)).toBe(false);
  });
});

describe('the light mode: the root attribute and the device switch', () => {
  it('draws the page from one attribute on the root, set for light and removed for dark', () => {
    const r = root();
    expect(isLight(r)).toBe(false);
    applyMode(true, r);
    expect(r.dataset.mode).toBe('light');
    expect(isLight(r)).toBe(true);
    applyMode(false, r);
    expect('mode' in r.dataset).toBe(false);
    expect(isLight(r)).toBe(false);
  });

  it('opens in the mode kept on the device, and a switch keeps it, draws it and tells the shell', () => {
    const storage = new MemoryStorage();
    const r = root();
    let told = 0;
    const mode = new DeviceMode({ storage, root: r }, () => (told += 1));
    expect(mode.light).toBe(false);
    expect(isLight(r)).toBe(false);
    mode.set(true);
    expect(mode.light).toBe(true);
    expect(isLight(r)).toBe(true);
    expect(storage.getItem(MODE_PREF_KEY)).toBe(MODE_LIGHT);
    expect(told).toBe(1);
    // The next page of the same device opens light.
    const next = root();
    expect(new DeviceMode({ storage, root: next }).light).toBe(true);
    expect(isLight(next)).toBe(true);
    mode.set(false);
    expect(isLight(r)).toBe(false);
    expect(storage.items.size).toBe(0);
    expect(told).toBe(2);
  });

  it('still switches for the page on show when the storage refuses: nothing is kept, the page follows', () => {
    const r = root();
    const mode = new DeviceMode({ storage: REFUSING, root: r });
    expect(mode.light).toBe(false);
    mode.set(true);
    expect(mode.light).toBe(true);
    expect(isLight(r)).toBe(true);
  });

  it('names its switch LIGHT MODE and its two bar colours: NOCTURNE\'s ground and white', () => {
    expect(MODE.label).toBe('LIGHT MODE');
    expect(MODE_THEME_COLOURS).toEqual({ dark: '#0a0a0a', light: '#ffffff' });
  });
});

describe('the light mode: before the first paint, and its stylesheet', () => {
  it('the early script holds the same key, value and colour as the modules, with no import and no name left on the page', () => {
    const early = source('shared/mode-early.ts');
    const code = early.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain(`localStorage.getItem('${MODE_PREF_KEY}') !== '${MODE_LIGHT}'`);
    expect(code).toContain(`dataset.mode = '${MODE_LIGHT}'`);
    expect(code).toContain(`'${MODE_THEME_COLOURS.light}'`);
    expect(code).not.toMatch(/\bimport\b|\bexport\b/);
    expect(code.trim().startsWith('(() => {')).toBe(true);
    expect(code.trim().endsWith('})();')).toBe(true);
  });

  it('each shell loads its mode entry as a plain script before its stylesheet, and each entry is the early script alone', () => {
    for (const app of ['verify', 'legal']) {
      const html = source(`${app}/index.html`);
      const script = html.indexOf('<script src="./mode.ts"></script>');
      expect(script, app).toBeGreaterThan(-1);
      expect(script, app).toBeLessThan(html.indexOf('<link rel="stylesheet" href="./styles.css">'));
      expect(script, app).toBeGreaterThan(html.indexOf('<meta name="theme-color"'));
      expect(source(`${app}/mode.ts`).replace(/\/\*[\s\S]*?\*\//g, '').trim(), app).toBe("import '../shared/mode-early.js';");
      // The light sheet after NOCTURNE's own, in both apps.
      const css = source(`${app}/styles.css`);
      expect(css.indexOf('@import "../shared/light.css";'), app).toBeGreaterThan(css.indexOf('@import "../shared/nocturne.css";'));
    }
  });

  it('the stylesheet touches nothing outside the mode: every rule is under the root\'s attribute, on a NOCTURNE screen that is not the camera nor THE VAULT page (lot Q3 §3.5, D41: dark in light mode)', () => {
    const css = source('shared/light.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2]!.trim());
    expect(selectors.length).toBeGreaterThan(8);
    for (const group of selectors) {
      // The selector list split at its top-level commas (the exception's own :not() list holds one).
      for (const sel of group.split(/,(?![^()]*\))\s*\n?/)) {
        expect(sel.startsWith('[data-mode="light"] body.nocturne:not([data-screen="scan"], [data-screen="vault"])') || sel === 'html[data-mode="light"]:has(> body.nocturne:not([data-screen="scan"], [data-screen="vault"]))', sel).toBe(true);
      }
    }
    // Colours only come from the palette: white, NOCTURNE's ground as the ink, neutral greys.
    const colours = new Set([...css.matchAll(/#[0-9a-f]{6}\b/g)].map((m) => m[0]));
    expect([...colours].sort()).toEqual(['#0a0a0a', '#5e5e5e', '#949494', '#f6f6f6', '#ffffff']);
    for (const m of css.matchAll(/rgba\(([^)]+)\)/g)) expect(['10, 10, 10', '255, 255, 255'], m[0]).toContain(m[1]!.split(',').slice(0, 3).join(',').trim());
  });
});
