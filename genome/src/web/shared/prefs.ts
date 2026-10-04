/**
 * Preferences kept on this device, in the browser's local storage: today only
 * the sound signature of the verify app (P-D07), SOUND ON / OFF at the foot of
 * its landing.
 *
 *   key           value                     absent (the default)
 *   orbes.sound   "off" once turned off     the sound is on
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

/** Whether the sound signature plays (P-D07): on unless it was turned off on this device. */
export function soundPref(storage: PrefStorage | null = deviceStorage()): boolean {
  return readPref(SOUND_PREF_KEY, storage) !== SOUND_OFF;
}

/** Keep the sound preference: off is stored, on removes the key (the default). */
export function setSoundPref(on: boolean, storage: PrefStorage | null = deviceStorage()): boolean {
  return writePref(SOUND_PREF_KEY, on ? null : SOUND_OFF, storage);
}
