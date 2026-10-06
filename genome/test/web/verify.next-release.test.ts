/**
 * A model's next release (plan NOCTURNE, screen 5, step N6; C6): the plate row of its sheet, read from THE RELEASES'
 * lists (next-release-model.ts). Pure: no DOM; the sheet is driven in Chromium by verify.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { nextRelease } from '../../src/web/verify/next-release-model.js';
import type { DropCard, LiveCard } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';
import { LOOKBOOK } from '../../src/web/verify/copy.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Monday 5 October 2026, 18:49 in Paris (the boards' NOW). */
const NOW = Date.parse('2026-10-05T16:49:00Z');
const SLUGS = ['monolithe', 'monolithe-gold', 'monolithe-blue'];

function live(extra: Partial<LiveCard> = {}): LiveCard {
  return {
    id: ID(1),
    kind: 'LIVE',
    phase: 'ANNOUNCED',
    revealed: { silhouette: true, name: true, photo: true },
    stages: { silhouetteAt: '2026-10-01T10:00:00Z', nameAt: '2026-10-01T10:00:00Z', photoAt: '2026-10-01T10:00:00Z' },
    reveals: [],
    title: 'MONOLITHE IN BLUE',
    name: 'MONOLITHE',
    variant: 'Blue',
    type: 'BRACELET',
    collection: 'ORBITAL',
    silhouetteUrl: null,
    imageUrl: null,
    lookbook: 'monolithe-blue',
    announcedAt: '2026-10-01T10:00:00Z',
    roomOpensAt: '2026-10-08T18:45:00Z',
    opensAt: '2026-10-08T19:00:00Z',
    closesAt: '2026-10-08T19:30:00Z',
    priceMinor: 505_000,
    currency: 'EUR',
    quantityLine: '25 PIECES',
    perAccount: 1,
    access: { minTier: 1, text: 'owners' },
    surprise: false,
    interest: 5,
    ...extra,
  };
}

function draw(extra: Partial<DropCard> = {}): DropCard {
  return {
    id: ID(2),
    title: 'MONOLITHE, THE OCTOBER DRAW',
    state: 'OPEN',
    model: { name: 'MONOLITHE', type: 'BRACELET', collection: 'ORBITAL', imageUrl: null, lookbook: 'monolithe', variant: 'Steel' },
    quantity: 12,
    opensAt: '2026-10-05T10:00:00Z',
    closesAt: '2026-10-11T18:00:00Z',
    earlyAccessHours: 0,
    earlyAccessOpensAt: null,
    earlyAccessOpen: false,
    priceMinor: 420_000,
    currency: 'EUR',
    ...extra,
  };
}

describe('a model\'s next release (NOCTURNE N6, C6)', () => {
  it('says a LIVE RELEASE of the model or a variant as C6 draws it: its kind, then its variant, its weekday and hour in Paris', () => {
    expect(nextRelease(SLUGS, [live()], [draw()], NOW)).toEqual({
      id: ID(1),
      href: `/verify/releases/${ID(1)}`,
      kind: 'LIVE RELEASE',
      variant: 'IN BLUE,',
      when: 'THURSDAY 21:00 PARIS',
    });
    // Its room open, then live: its kind says so (no countdown on the row).
    expect(nextRelease(SLUGS, [live({ phase: 'ROOM' })], [], NOW)!.kind).toBe('LIVE RELEASE · THE ROOM IS OPEN');
    expect(nextRelease(SLUGS, [live({ phase: 'LIVE' })], [], NOW)!.kind).toBe('LIVE RELEASE · LIVE NOW');
    // Six days ahead or more: its date too, never a weekday that could be this one's or next week's.
    expect(nextRelease(SLUGS, [live({ opensAt: '2026-10-22T19:00:00Z' })], [], NOW)!.when).toBe('THURSDAY 22 OCTOBER · 21:00 PARIS');
    // A model without variants: no variant named.
    expect(nextRelease(['orbe'], [live({ lookbook: 'orbe', variant: null })], [], NOW)!.variant).toBeNull();
  });

  it('leads with a LIVE RELEASE, the first to open, before any draw; else the draw open, soon open or in its early access that opens first', () => {
    const later = live({ id: ID(3), opensAt: '2026-10-15T19:00:00Z' });
    expect(nextRelease(SLUGS, [later, live()], [draw()], NOW)!.id).toBe(ID(1));
    expect(nextRelease(SLUGS, [], [draw({ id: ID(4), opensAt: '2026-10-09T10:00:00Z', state: 'UPCOMING' }), draw()], NOW)).toEqual({
      id: ID(2),
      href: `/verify/releases/${ID(2)}`,
      kind: 'DRAW · ENTRIES OPEN',
      variant: 'IN STEEL,',
      when: 'ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC',
    });
    expect(nextRelease(SLUGS, [], [draw({ state: 'UPCOMING', opensAt: '2026-10-09T10:00:00Z' })], NOW)).toMatchObject({ kind: 'DRAW · ENTRIES OPEN SOON', when: 'ENTRIES OPEN 9 OCT 2026 · 10:00 UTC' });
    expect(nextRelease(SLUGS, [], [draw({ state: 'UPCOMING', opensAt: '2026-10-09T10:00:00Z', earlyAccessHours: 48, earlyAccessOpensAt: '2026-10-07T10:00:00Z', earlyAccessOpen: true })], NOW)!.kind).toBe(
      'DRAW · EARLY ACCESS',
    );
  });

  it('says nothing of another model, of a release ended or drawn, of one whose model is not named yet, or of what is not a release', () => {
    expect(nextRelease(SLUGS, [live({ lookbook: 'orbe' })], [draw({ model: { ...draw().model, lookbook: null } })], NOW)).toBeNull();
    expect(nextRelease(SLUGS, [live({ lookbook: null, name: null, title: null })], [], NOW)).toBeNull();
    for (const state of ['CLOSED', 'DRAWN', 'CANCELLED'] as const) expect(nextRelease(SLUGS, [], [draw({ state })], NOW), state).toBeNull();
    expect(nextRelease(SLUGS, [live({ id: 'not-an-id' })], [draw({ id: 'x' })], NOW)).toBeNull();
    expect(nextRelease(SLUGS, [], [], NOW)).toBeNull();
  });

  it('writes in the lexicon', () => {
    const words = [LOOKBOOK.next.variant('Blue'), LOOKBOOK.next.week('THURSDAY', '21:00'), LOOKBOOK.next.opens('9 OCT 2026 · 10:00'), LOOKBOOK.next.closes('11 OCT 2026 · 18:00')].join('\n');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(words).not.toContain('!');
  });
});
