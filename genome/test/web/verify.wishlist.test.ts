/**
 * YOUR WISHLIST's model (src/web/verify/wishlist-model.ts; plan CUSTOMER INTELLIGENCE §3.2 W.10, W.13): the heart's
 * state per dot (the wished addresses the account may open now; signed out, shown and not pressed; unreadable, not
 * shown), the account sheet's row (WISHLIST.count), the page's cards (wishlistCards: each line, the NOT IN THE
 * COLLECTION NOW row, the photograph from this origin only), its address, and the words of WISHLIST. Pure: no DOM. The
 * heart and the page themselves are driven in Chromium by test/web/nocturne.wishlist.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { WISHLIST } from '../../src/web/verify/copy.js';
import type { WishlistItem } from '../../src/web/verify/types.js';
import { heartState, isWishlistPath, wishedSlugs, wishlistCards, wishlistCount, WISHLIST_PATH } from '../../src/web/verify/wishlist-model.js';

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

describe('YOUR WISHLIST, the row and the page (plan CUSTOMER INTELLIGENCE §3.2 W.10.2)', () => {
  it('counts on the row only what it holds, and nothing when unreadable', () => {
    expect(wishlistCount({ items: [] })).toBe('NONE YET');
    expect(wishlistCount({ items: [shown('monolithe')] })).toBe('1 MODEL');
    expect(wishlistCount({ items: [shown('a'), shown('b'), notShown('c')] })).toBe('3 MODELS');
    expect(wishlistCount(null)).toBeNull();
  });

  it('opens at /verify/wishlist', () => {
    expect(WISHLIST_PATH).toBe('/verify/wishlist');
    expect(isWishlistPath('/verify/wishlist')).toBe(true);
    expect(isWishlistPath('/VERIFY/Wishlist/')).toBe(true);
    expect(isWishlistPath('/verify/wishlist/x')).toBe(false);
  });

  it("draws each wish as THE COLLECTION's card, its line naming the variant, the salon and the year discontinued; a model not shown now by its name alone", () => {
    const cards = wishlistCards([
      shown('monolithe-blue', { variant: { label: 'Blue', swatch: '#16224A' }, imageUrl: `/api/v1/media/${'a'.repeat(64)}` }),
      shown('monolithe-gold', { variant: { label: 'Gold', swatch: '#B88A3A' }, discontinuedYear: 2026, imageUrl: 'https://elsewhere.example/x.jpg' }),
      shown('zenith', { name: 'Zenith', collection: null, reserved: true }),
      { state: 'NOT_SHOWN', slug: 'halo', name: 'HALO', variant: { label: 'Gold', swatch: '#B88A3A' }, addedAt: AT },
      notShown('../x'),
      shown('blank', { name: '  ' }),
    ]);
    expect(cards).toEqual([
      {
        kind: 'shown',
        slug: 'monolithe-blue',
        href: '/verify/lookbook/monolithe-blue',
        name: 'MONOLITHE',
        title: 'MONOLITHE IN BLUE',
        collection: 'ORBITAL',
        line: 'BRACELET · IN BLUE',
        image: { src: `/api/v1/media/${'a'.repeat(64)}`, alt: expect.stringContaining('MONOLITHE') },
      },
      // A photograph from anywhere but this origin's media route is dropped; the words stay.
      { kind: 'shown', slug: 'monolithe-gold', href: '/verify/lookbook/monolithe-gold', name: 'MONOLITHE', title: 'MONOLITHE IN GOLD', collection: 'ORBITAL', line: 'BRACELET · IN GOLD · DISCONTINUED · 2026', image: null },
      { kind: 'shown', slug: 'zenith', href: '/verify/lookbook/zenith', name: 'ZENITH', title: 'ZENITH', collection: null, line: 'BRACELET · THE PRIVATE SALON', image: null },
      // Not shown now: its name and variant, NOT IN THE COLLECTION NOW, no photograph and no address.
      { kind: 'hidden', slug: 'halo', name: 'HALO', title: 'HALO IN GOLD', line: 'IN GOLD · NOT IN THE COLLECTION NOW' },
    ]);
    expect(wishlistCards(null)).toEqual([]);
    expect(wishlistCards([notShown('zenith')])).toEqual([{ kind: 'hidden', slug: 'zenith', name: 'ZENITH', title: 'ZENITH', line: 'NOT IN THE COLLECTION NOW' }]);
  });

  it('says the page in the words of W.10.4', () => {
    expect(WISHLIST.removedNamed('MONOLITHE IN BLUE')).toBe('MONOLITHE IN BLUE is removed from your wishlist.');
    expect([WISHLIST.back, WISHLIST.title, WISHLIST.seeModel, WISHLIST.remove, WISHLIST.collection]).toEqual(['YOUR ACCOUNT', 'YOUR WISHLIST', 'SEE THE MODEL', 'REMOVE', 'THE COLLECTION']);
    expect(WISHLIST.unreadable).toBe('Your wishlist could not be shown just now.');
  });
});
