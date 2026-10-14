/**
 * The light mode (the owner's choice of 2026-10-14: GALLERY WHITE · SOFT): a collector's own choice, LIGHT MODE in
 * YOUR ACCOUNT, kept on the device (shared/prefs.ts `orbes.mode`); NOCTURNE's dark stays the default.
 *
 * The mode is one attribute on the page's root, `<html data-mode="light">`; shared/light.css draws every NOCTURNE
 * screen from it. Three screens keep their own look whatever the mode: the LIVE RELEASE's room (not a NOCTURNE
 * screen: the vault), the camera (`body[data-screen="scan"]`) and the shared ownership certificate (its paper).
 * shared/mode-early.ts sets the attribute before the page first paints, so a light page never opens dark.
 */
import { lightPref, setLightPref, type PrefStorage, deviceStorage } from './prefs.js';

/** The switch YOUR ACCOUNT shows (LIGHT MODE). */
export interface ModeSwitch {
  readonly light: boolean;
  set(light: boolean): void;
}

/** The browser's bar colour (`<meta name="theme-color">`) of each ground. */
export const MODE_THEME_COLOURS = Object.freeze({ dark: '#0a0a0a', light: '#ffffff' });

/** Whether the page is drawn light now. */
export function isLight(root: HTMLElement = document.documentElement): boolean {
  return root.dataset.mode === 'light';
}

/** Draw the page in the mode: the root's attribute, set or removed. */
export function applyMode(light: boolean, root: HTMLElement = document.documentElement): void {
  if (light) root.dataset.mode = 'light';
  else delete root.dataset.mode;
}

/** The mode of this device: read once, switched from YOUR ACCOUNT. `onChange` runs after each switch (the bar colour). */
export class DeviceMode implements ModeSwitch {
  private on: boolean;

  constructor(
    private readonly env: { storage: PrefStorage | null; root: HTMLElement } = { storage: deviceStorage(), root: document.documentElement },
    private readonly onChange: () => void = () => undefined,
  ) {
    this.on = lightPref(env.storage);
    applyMode(this.on, env.root);
  }

  get light(): boolean {
    return this.on;
  }

  set(light: boolean): void {
    this.on = light;
    setLightPref(light, this.env.storage);
    applyMode(light, this.env.root);
    this.onChange();
  }
}
