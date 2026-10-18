/**
 * Preferences kept on this device, in the browser's local storage: the sound
 * signature of the verify app (P-D07), SOUND ON / OFF at the foot of its
 * landing, and the light mode (LIGHT MODE in YOUR ACCOUNT, shared/light.css).
 *
 *   key           value                     absent (the default)
 *   orbes.sound   "off" once turned off     the sound is on
 *   orbes.mode    "light" once turned on    NOCTURNE's dark
 *
 * Nothing here is sent to ORBES: a preference stays on the device that set it
 * (the privacy policy says so). Local storage can be missing or refuse every
 * access (a private window, storage blocked by the browser, a full quota):
 * each read and write is wrapped, a read that fails gives the default and a
 * write that fails is dropped, so the page works the same without it.
 */

/** The part of a Storage the preferences use (window.localStorage; a map in the tests). */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The key of the sound preference (P-D07): the privacy policy names it. */
export const SOUND_PREF_KEY = 'orbes.sound';
/** Its one stored value: the sound was turned off. Turned back on, the key is removed (the default). */
export const SOUND_OFF = 'off';
/**
 * Desktop (BRIEF §5.10): a computer's default is off, so turning the sound on there is kept as such (a phone
 * keeps its key removed for on, its default).
 */
export const SOUND_ON = 'on';

/** The key of the light mode's preference: shared/mode-early.ts reads it by name (the privacy policy's sentence on
 *  the device's preferences names it from its next version on). */
export const MODE_PREF_KEY = 'orbes.mode';
/** Its one stored value: the light mode was turned on. Turned back off, the key is removed (the default, dark). */
export const MODE_LIGHT = 'light';

/** This browser's local storage, or null where it cannot be reached (reading `localStorage` itself may throw). */
export function deviceStorage(): PrefStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The value kept under `key`, or null (none kept, or the storage cannot be read). */
export function readPref(key: string, storage: PrefStorage | null = deviceStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Keep `value` under `key` (null removes it); false when the storage refused it. */
export function writePref(key: string, value: string | null, storage: PrefStorage | null = deviceStorage()): boolean {
  if (!storage) return false;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the sound signature plays (P-D07): on unless it was turned off on this device. Desktop: `fallback`
 * is the default when nothing is kept (off on a computer, BRIEF §5.10), and a kept `on` reads on.
 */
export function soundPref(storage: PrefStorage | null = deviceStorage(), fallback = true): boolean {
  const kept = readPref(SOUND_PREF_KEY, storage);
  if (kept === SOUND_OFF) return false;
  if (kept === SOUND_ON) return true;
  return fallback;
}

/**
 * Keep the sound preference: off is stored, on removes the key (the default). Desktop: `keepOn` (a computer,
 * whose default is off) stores on as well.
 */
export function setSoundPref(on: boolean, storage: PrefStorage | null = deviceStorage(), keepOn = false): boolean {
  return writePref(SOUND_PREF_KEY, on ? (keepOn ? SOUND_ON : null) : SOUND_OFF, storage);
}

/** Whether the light mode is on: off (NOCTURNE's dark) unless it was turned on on this device. */
export function lightPref(storage: PrefStorage | null = deviceStorage()): boolean {
  return readPref(MODE_PREF_KEY, storage) === MODE_LIGHT;
}

/** Keep the light mode's preference: light is stored, dark removes the key (the default). */
export function setLightPref(light: boolean, storage: PrefStorage | null = deviceStorage()): boolean {
  return writePref(MODE_PREF_KEY, light ? MODE_LIGHT : null, storage);
}
