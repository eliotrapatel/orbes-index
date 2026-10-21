/**
 * A line written for a phone and its words on a computer (src/web/verify/copy.ts `forDevice`, desktop decision 8):
 * each pair read on a phone, a tablet and a computer, the computer's whatever its window's width (decision D6: a
 * narrow or zoomed window still says "on this computer"; shared/desktop.ts `onComputer`), a computer with a touch
 * screen included (Q2); the two clocks of a release ("on this phone" / "on this computer"); and the desktop's own
 * words (DESKTOP) free of "QR" and of the brand lexicon's forbidden words, as every computer line is.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_ADDRESSES, DESKTOP, LIVE, ORDERS, QUESTION, RELEASES, resultMessage, STORY } from '../../src/web/verify/copy.js';
import { releaseTime } from '../../src/web/verify/live-model.js';
import { twoClocks } from '../../src/web/verify/releases-model.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';
import { at, installDevice } from '../support/fake-device.js';

const COPY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'web', 'verify', 'copy.ts');

const SERVER_UNREADABLE = 'This code could not be read. Hold it in even light, holding the camera steady.';

/** Every line `forDevice` chooses, by where it is read, with its phone's words and its computer's. */
const PAIRS: readonly { where: string; read: () => string; phone: string; computer: string }[] = [
  {
    where: 'resultMessage (UNREADABLE CODE)',
    read: () => resultMessage('MALFORMED_CODE', SERVER_UNREADABLE),
    phone: SERVER_UNREADABLE,
    computer: 'This code could not be read. Please upload a sharp, well-lit photo in which the whole code is visible, or scan it with your phone.',
  },
  {
    where: 'ORDERS.claim.card',
    read: () => ORDERS.claim.card,
    phone: 'Your new certificate card, with its ORBES CODE and this claim code (PDF). Print it, or open it on another screen to scan it.',
    computer: 'Your new certificate card, with its ORBES CODE and this claim code (PDF). Print it, or open it on this screen and scan it with your phone.',
  },
  {
    where: 'QUESTION.ask',
    read: () => QUESTION.ask('18 OCT 2026 · 19:00'),
    phone: 'One tap. You may change your answer until 18 OCT 2026 · 19:00.',
    computer: 'One choice. You may change your answer until 18 OCT 2026 · 19:00.',
  },
  {
    where: 'RELEASES.seedChecked',
    read: () => RELEASES.seedChecked,
    phone: 'Checked on this phone: the SHA-256 of the seed is the fingerprint published with the release.',
    computer: 'Checked on this computer: the SHA-256 of the seed is the fingerprint published with the release.',
  },
  {
    where: 'RELEASES.seedMismatch',
    read: () => RELEASES.seedMismatch,
    phone: 'Checked on this phone: the SHA-256 of the seed is not the fingerprint published with the release. ORBES Client Services can assist you.',
    computer: 'Checked on this computer: the SHA-256 of the seed is not the fingerprint published with the release. ORBES Client Services can assist you.',
  },
  { where: 'ACCOUNT_ADDRESSES.removeConfirm', read: () => ACCOUNT_ADDRESSES.removeConfirm, phone: 'TAP AGAIN TO REMOVE', computer: 'CLICK AGAIN TO REMOVE' },
  {
    where: 'ACCOUNT_ADDRESSES.removeConfirmLabel',
    read: () => ACCOUNT_ADDRESSES.removeConfirmLabel('HOME'),
    phone: 'Tap again to remove the address of HOME',
    computer: 'Click again to remove the address of HOME',
  },
  { where: 'LIVE.releaseConfirm', read: () => LIVE.releaseConfirm, phone: 'TAP AGAIN TO RELEASE', computer: 'CLICK AGAIN TO RELEASE' },
  { where: 'LIVE.edge.soldOut.leaveConfirm', read: () => LIVE.edge.soldOut.leaveConfirm, phone: 'TAP AGAIN TO LEAVE', computer: 'CLICK AGAIN TO LEAVE' },
  // The queue's LEAVE THE LINE (lot M1, W6).
  { where: 'LIVE.queue.leaveConfirm', read: () => LIVE.queue.leaveConfirm, phone: 'TAP AGAIN TO LEAVE', computer: 'CLICK AGAIN TO LEAVE' },
  {
    where: 'STORY.cannotShare',
    read: () => STORY.cannotShare,
    phone: 'This browser cannot share an image. Save it, then add it to your story from your photos.',
    computer: 'This browser cannot share an image. Save it, then add it to your story from your phone.',
  },
];

/** The devices each pair is read on, and whose words they read. */
const READERS: readonly [string, number, 'phone' | 'computer'][] = [
  ['an iPhone', 390, 'phone'],
  ['an Android phone', 412, 'phone'],
  ['an iPad with its trackpad (Safari, as a Mac)', 1366, 'phone'],
  ['an Android tablet with a trackpad cover (a fine pointer)', 1280, 'phone'],
  ['a Mac', 1440, 'computer'],
  // D6: a computer's window under 1024 px (or a page zoomed to 150 %) keeps a computer's words.
  ['a Mac', 900, 'computer'],
  ['a Windows computer with a mouse', 683, 'computer'],
  // Q2: a computer with a touch screen is a computer.
  ['a Windows laptop with a touch screen and a trackpad', 1920, 'computer'],
  ['a Windows laptop with a touch screen and a trackpad', 900, 'computer'],
];

/** Every string a value says (a function called with sample words). */
const said = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => unknown)('PLATINE', 'SUNDAY 11 OCTOBER', '19:00'))] : v && typeof v === 'object' ? Object.values(v).flatMap(said) : [];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a line for a phone and its words on a computer (forDevice)', () => {
  it('lists every pair of copy.ts: one entry here for each forDevice call', () => {
    const calls = [...readFileSync(COPY, 'utf8').matchAll(/\bforDevice\(/g)].length; // its definition is `forDevice = (`
    expect(calls).toBe(PAIRS.length);
  });

  it('reads the phone\'s words outside a browser (the tests, the server)', () => {
    for (const p of PAIRS) expect(p.read(), p.where).toBe(p.phone);
  });

  it.each(READERS)('on %s at %i px, reads the %s\'s words', (name, width, words) => {
    installDevice(at(name, width));
    for (const p of PAIRS) expect(p.read(), p.where).toBe(words === 'computer' ? p.computer : p.phone);
  });

  it('keeps every other result\'s sentence as the server wrote it, on both', () => {
    installDevice(at('a Mac', 1440));
    expect(resultMessage('AUTHENTIC_REGISTERED', 'A sentence of the server.')).toBe('A sentence of the server.');
    expect(resultMessage('MALFORMED_CODE', '')).toBe('');
  });

  it('writes every computer line calmly: no exclamation mark, no word of §4.5', () => {
    const words = PAIRS.map((p) => p.computer).join('\n');
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});

describe('a release\'s two clocks: "on this phone", "on this computer"', () => {
  const AT = '2026-10-11T17:00:00.000Z';

  it.each(READERS)('on %s at %i px, the local clock is the %s\'s', (name, width, words) => {
    installDevice(at(name, width));
    const live = releaseTime(AT, 'America/New_York');
    expect(live.local).toMatch(words === 'computer' ? / ON THIS COMPUTER$/ : / ON THIS PHONE$/);
    const clocks = twoClocks(AT, -240);
    expect(clocks.local).toMatch(words === 'computer' ? / on this computer \(UTC-04:00\)$/ : / on this phone \(UTC-04:00\)$/);
  });

  it('says no second clock where the zones agree, on either', () => {
    installDevice(at('a Mac', 900));
    expect(releaseTime(AT, 'Europe/Paris').local).toBeNull();
    expect(twoClocks(AT, 0).local).toBeNull();
  });
});

describe('the desktop\'s own words (DESKTOP)', () => {
  const words = said(DESKTOP).join('\n');

  it('says them all', () => {
    expect(words.length).toBeGreaterThan(500);
  });

  it('never names the code "QR" (the brand lexicon keeps the word out of the copy), even in its screen reader\'s name', () => {
    expect(words).not.toMatch(/\bQR\b/i);
    expect(DESKTOP.scanPage.qrLabel).toContain(DESKTOP.scanPage.address);
  });

  it('writes them calmly: no exclamation mark, no word of §4.5', () => {
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});
