/**
 * YOUR WISHLIST's model (src/web/verify/wishlist-model.ts; plan CUSTOMER INTELLIGENCE §3.2 W.10, W.13): the heart's
 * state per dot (the wished addresses the account may open now; signed out, shown and not pressed; unreadable, not
 * shown), and the words of WISHLIST. Pure: no DOM. The heart itself is driven in Chromium by
 * test/web/nocturne.wishlist.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { WISHLIST } from '../../src/web/verify/copy.js';
import type { WishlistItem } from '../../src/web/verify/types.js';
import { heartState, wishedSlugs } from '../../src/web/verify/wishlist-model.js';

const AT = '2026-10-05T16:49:00.000Z';
const shown = (slug: string, extra: Partial<Extract<WishlistItem, { state: 'SHOWN' }>> = {}): WishlistItem => ({
  state: 'SHOWN',
  slug,
  name: 'MONOLITHE',
  variant: null,
  type: 'BRACELET',
  collection: 'ORBITAL',
  imageUrl: null,
  discontinuedYear: null,
  reserved: false,
  addedAt: AT,
  ...extra,
});
const notShown = (slug: string): WishlistItem => ({ state: 'NOT_SHOWN', slug, name: 'ZENITH', variant: null, addedAt: AT });

describe('the heart (plan CUSTOMER INTELLIGENCE §3.2 W.10.1)', () => {
  it('presses the dots the account wishes for and may open now, each dot its own address', () => {
    const wished = wishedSlugs({ items: [shown('monolithe-blue', { variant: { label: 'Blue', swatch: '#16224A' } }), notShown('zenith'), shown('../x')] });
    expect([...wished]).toEqual(['monolithe-blue']);
    // MONOLITHE in blue is wished, not MONOLITHE in steel or in gold: a dot switched reads its own state, with no request.
    expect(heartState(true, wished, 'monolithe-blue')).toEqual({ shown: true, pressed: true });
    expect(heartState(true, wished, 'monolithe')).toEqual({ shown: true, pressed: false });
    expect(heartState(true, wished, 'monolithe-gold')).toEqual({ shown: true, pressed: false });
    // A model wished but no longer shown to the reader presses no heart (its sheet does not open anyway).
    expect(heartState(true, wished, 'zenith')).toEqual({ shown: true, pressed: false });
  });

  it('is shown and not pressed signed out; not shown when the wishlist or the session could not be read', () => {
    expect(heartState(false, null, 'monolithe')).toEqual({ shown: true, pressed: false });
    expect(heartState(true, null, 'monolithe')).toEqual({ shown: false, pressed: false });
    expect(heartState(null, new Set(['monolithe']), 'monolithe')).toEqual({ shown: false, pressed: false });
    expect([...wishedSlugs(null)]).toEqual([]);
    expect([...wishedSlugs({ items: [] })]).toEqual([]);
  });

  it('says WISHLIST, then In your wishlist. or Removed from your wishlist.; signed out, that the wishlist is kept in the account', () => {
    expect(WISHLIST.heart).toBe('WISHLIST');
    expect(WISHLIST.added).toBe('In your wishlist.');
    expect(WISHLIST.removed).toBe('Removed from your wishlist.');
    expect(WISHLIST.failed).toBe('Your wishlist could not be changed just now.');
    expect(WISHLIST.signedOut).toBe('Your wishlist is kept in your ORBES account.');
    expect(WISHLIST.signIn).toBe('SIGN IN');
  });

  it('counts the wishlist on its own row only: NONE YET, 1 MODEL, 3 MODELS', () => {
    expect([0, 1, 3, 200].map(WISHLIST.count)).toEqual(['NONE YET', '1 MODEL', '3 MODELS', '200 MODELS']);
  });
});
