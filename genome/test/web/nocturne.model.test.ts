/**
 * NOCTURNE's chrome and pieces, what they say (src/web/verify/nocturne-model.ts): the header's account button (the
 * tier's name and the monogram, decision 11; SIGN IN signed out), the rail's RELEASES dot (the facts NOW's hero follows),
 * the chapter of each screen, and a variant's dot drawn from its swatch with the canvas's soft highlight.
 */
import { describe, expect, it } from 'vitest';
import { accountButton, chapterOf, lighten, railLive, swatchGradient, SWATCH_HIGHLIGHT } from '../../src/web/verify/nocturne-model.js';
import type { LiveBanner } from '../../src/web/verify/types.js';

describe('NOCTURNE: the header\'s account button (decision 11)', () => {
  it('names the tier beside the monogram, the button "Your account, TITANE"; the monogram alone without a tier; SIGN IN signed out', () => {
    expect(accountButton(true, 'TITANE')).toEqual({ kind: 'account', text: 'TITANE', label: 'Your account, TITANE' });
    expect(accountButton(true, 'PALLADIUM')).toEqual({ kind: 'account', text: 'PALLADIUM', label: 'Your account, PALLADIUM' });
    expect(accountButton(true, null)).toEqual({ kind: 'account', text: null, label: 'Your account' });
    expect(accountButton(false, 'TITANE')).toEqual({ kind: 'sign-in', text: 'SIGN IN', label: 'SIGN IN' });
  });
});

describe('NOCTURNE: the rail', () => {
  const live = { id: 'r' } as unknown as LiveBanner;

  it('dots RELEASES while a LIVE RELEASE is announced, its room open or live, or a draw is open, soon open or in its early access', () => {
    expect(railLive(live, [])).toBe(true);
    expect(railLive(null, [{ state: 'OPEN' }])).toBe(true);
    expect(railLive(null, [{ state: 'UPCOMING' }])).toBe(true);
    for (const state of ['CLOSED', 'DRAWN', 'CANCELLED'] as const) expect(railLive(null, [{ state }]), state).toBe(false);
    expect(railLive(null, [])).toBe(false);
  });

  it('underlines the chapter of each screen: a result is read from NOW; the scan, the room and the board have none', () => {
    expect(chapterOf('landing')).toBe('now');
    expect(chapterOf('result')).toBe('now');
    expect(chapterOf('pieces')).toBe('pieces');
    expect(chapterOf('lookbook')).toBe('collection');
    expect(chapterOf('sheet')).toBe('collection');
    expect(chapterOf('releases')).toBe('releases');
    expect(chapterOf('release')).toBe('releases');
    expect(chapterOf('circle')).toBe('circle');
    expect(chapterOf('circlePost')).toBe('circle');
    for (const s of ['scan', 'verifying', 'message', 'board', 'certificate']) expect(chapterOf(s), s).toBeNull();
  });
});

describe('NOCTURNE: a variant\'s dot, drawn from its swatch', () => {
  /** A colour's OKLab lightness (to check the highlight's step). */
  const lightness = (hex: string): number => {
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  };

  it('sets any other swatch at 55 % between two highlights of itself, made lighter in OKLab', () => {
    const g = swatchGradient('#7A5C3E');
    const m = /^linear-gradient\(135deg, (#[0-9a-f]{6}), #7a5c3e 55%, (#[0-9a-f]{6})\)$/.exec(g);
    expect(m, g).not.toBeNull();
    expect(lightness(m![1]!) - lightness('#7a5c3e')).toBeCloseTo(SWATCH_HIGHLIGHT.start, 2);
    expect(lightness(m![2]!) - lightness('#7a5c3e')).toBeCloseTo(SWATCH_HIGHLIGHT.end, 2);
  });

  it('draws the canvas\'s three finishes with the canvas\'s own gradients, exactly', () => {
    // build.py: .steel #e9e8e4 → #9d9b96 → #d7d5d0; .gold #f0d692 → #b88a3a → #e6c578; .blue #3a4f8f → #16224a → #2c3e78.
    expect(swatchGradient('#9D9B96')).toBe('linear-gradient(135deg, #e9e8e4, #9d9b96 55%, #d7d5d0)');
    expect(swatchGradient('#B88A3A')).toBe('linear-gradient(135deg, #f0d692, #b88a3a 55%, #e6c578)');
    expect(swatchGradient('#16224a')).toBe('linear-gradient(135deg, #3a4f8f, #16224a 55%, #2c3e78)');
  });

  it('keeps a highlight within sRGB, and draws nothing from a colour that is not #RRGGBB', () => {
    expect(lighten('#ffffff', 0.21)).toBe('#ffffff');
    expect(lighten('#000000', 0)).toBe('#000000');
    expect(swatchGradient('steel')).toBe('none');
    expect(swatchGradient('#fff')).toBe('none');
  });
});
