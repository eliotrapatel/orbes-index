/**
 * THE CIRCLE (P-X01): the feed and a post as /verify shows them (circle-model.ts): the addresses, the cards of the
 * feed (kind, tiers, day, an invitation's event in UTC, what the reader did, the link named after the kind), a post's
 * photographs and their alternative texts, an invitation's facts (UTC then the phone's clock, the place, the places
 * left) and what its answer means now, a poll's options and its results only once voted, and the links (a release, a
 * model, an address of another site on the code's hosts only, its host shown). Pure: no DOM. The pages are driven in
 * Chromium by verify.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CIRCLE_LINK_HOSTS as SERVER_HOSTS, circleLinkHost } from '../../src/server/services/circle.js';
import {
  CIRCLE_LINK_HOSTS,
  CIRCLE_PATH,
  circleCards,
  circlePostModel,
  circlePostPath,
  circleRouteOf,
  externalLink,
  isCirclePostId,
} from '../../src/web/verify/circle-model.js';
import { CIRCLE } from '../../src/web/verify/copy.js';
import type { CircleCard, CirclePost } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const ID = '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c9d';
const DROP = '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d';
const media = (n: number) => `/api/v1/media/${n.toString(16).padStart(2, '0').repeat(32)}`;

function card(extra: Partial<CircleCard> = {}): CircleCard {
  return {
    id: ID,
    kind: 'NOTE',
    title: 'From the atelier',
    minTier: 1,
    publishedAt: '2026-10-03T09:00:00.000Z',
    cover: null,
    eventAt: null,
    eventPlace: null,
    answer: null,
    voted: false,
    ...extra,
  };
}

function post(extra: Partial<CirclePost> = {}): CirclePost {
  return {
    ...card(),
    body: 'First paragraph.\n\nSecond.',
    photos: [],
    invitation: null,
    poll: null,
    links: { drop: null, model: null, external: null },
    ...extra,
  };
}

const invitation = (extra: Partial<NonNullable<CirclePost['invitation']>> = {}, answer: CirclePost['answer'] = null) =>
  post({
    kind: 'INVITATION',
    title: 'Dinner at the atelier',
    answer,
    eventAt: '2026-10-12T17:00:00.000Z',
    eventPlace: 'Paris',
    invitation: { eventAt: '2026-10-12T17:00:00.000Z', place: 'Paris', capacity: 12, placesLeft: 3, open: true, ...extra },
  });

describe('the circle\'s addresses (P-X01)', () => {
  it('reads the feed and a post by its id under /verify/circle; anything else under it is the feed', () => {
    expect(CIRCLE_PATH).toBe('/verify/circle');
    expect(circlePostPath(ID)).toBe(`/verify/circle/${ID}`);
    expect(circleRouteOf('/verify/circle')).toEqual({ post: null });
    expect(circleRouteOf('/verify/circle/')).toEqual({ post: null });
    expect(circleRouteOf(`/verify/circle/${ID.toUpperCase()}`)).toEqual({ post: ID });
    expect(circleRouteOf('/verify/circle/nowhere')).toEqual({ post: null });
    expect(circleRouteOf('/verify/circles')).toBeNull();
    expect(circleRouteOf('/verify/releases')).toBeNull();
    expect(isCirclePostId(ID)).toBe(true);
    expect(isCirclePostId('nope')).toBe(false);
  });

  it('opens only an https link on the server\'s hosts, and names its host as the server does', () => {
    expect([...CIRCLE_LINK_HOSTS]).toEqual([...SERVER_HOSTS]);
    for (const url of ['https://www.youtube.com/watch?v=x', 'https://vimeo.com/1', 'https://theorbes.com/atelier']) {
      expect(externalLink(url), url).toEqual({ href: url, host: circleLinkHost(url) });
    }
    for (const url of ['http://theorbes.com/', 'https://example.com/', 'https://theorbes.com.example.com/', 'javascript:alert(1)', 'not a link', null]) expect(externalLink(url), String(url)).toBeNull();
  });
});

describe('the feed (P-X01)', () => {
  it('names each post by its kind, its tiers above the first, its day, and its link after its kind', () => {
    const [note, kept, poll] = circleCards([
      card({ cover: { url: media(1), alt: null } }),
      card({ id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c90', kind: 'INVITATION', title: 'Dinner 2026', minTier: 2, eventAt: '2026-10-12T17:00:00.000Z', eventPlace: 'Paris', answer: 'YES' }),
      card({ id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c91', kind: 'POLL', title: 'Which stone?', minTier: 3, voted: true, cover: { url: 'https://example.com/x.jpg', alt: 'x' } }),
    ]);
    expect(note).toMatchObject({ kindLabel: 'NOTE', title: 'FROM THE ATELIER', date: '3 OCT 2026', reach: null, event: null, mine: null, linkLabel: 'READ THE NOTE', href: `/verify/circle/${ID}` });
    expect(note!.image).toEqual({ src: media(1), alt: 'FROM THE ATELIER, photographed by ORBES' });
    expect(kept).toMatchObject({ kindLabel: 'INVITATION', reach: 'PLATINE AND PALLADIUM', event: '12 OCT 2026 · 17:00 UTC · PARIS', mine: 'YOU ANSWERED YES', linkLabel: 'SEE THE INVITATION' });
    // A photograph from anywhere but this origin's media route is no photograph.
    expect(poll).toMatchObject({ reach: 'PALLADIUM', mine: 'YOU VOTED', linkLabel: 'SEE THE POLL', image: null });
    expect(circleCards([card({ id: 'nope' })])).toEqual([]);
  });

  it('names an invitation\'s experience of the tier program above its title (plan NEXT-NINE, BP-19 T7), and nothing for another kind', () => {
    const [evening, preview, partner, plain, note] = circleCards([
      card({ kind: 'INVITATION', experience: 'MEMBERS_EVENING' }),
      card({ id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c92', kind: 'INVITATION', experience: 'LAUNCH_PREVIEW' }),
      card({ id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c93', kind: 'INVITATION', experience: 'PARTNER_EXPERIENCE' }),
      card({ id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c94', kind: 'INVITATION', experience: null }),
      card({ id: '3c2b1a00-4b2e-4f3a-9c1d-0e5f6a7b8c95', kind: 'NOTE', experience: 'MEMBERS_EVENING' }),
    ]);
    expect([evening, preview, partner, plain, note].map((c) => c!.experience)).toEqual(['MEMBERS’ EVENING', 'LAUNCH PREVIEW', 'PARTNER EXPERIENCE', null, null]);
    expect(circlePostModel(invitation({}), 0).experience).toBeNull();
    expect(circlePostModel({ ...invitation({}), experience: 'MEMBERS_EVENING' }, 0).experience).toBe('MEMBERS’ EVENING');
  });
});

describe('a post (P-X01)', () => {
  it('shows its photographs once each, the operator\'s text else its title\'s, and its body', () => {
    const m = circlePostModel(post({ photos: [{ url: media(1), alt: ' The atelier ' }, { url: media(2), alt: null }, { url: media(1), alt: null }, { url: '/elsewhere.jpg', alt: 'x' }] }), 0);
    expect(m.photos).toEqual([
      { src: media(1), alt: 'The atelier' },
      { src: media(2), alt: 'FROM THE ATELIER, photographed by ORBES' },
    ]);
    expect(m).toMatchObject({ kindLabel: 'NOTE', title: 'FROM THE ATELIER', body: 'First paragraph.\n\nSecond.', invitation: null, poll: null });
    expect(circlePostModel(post({ body: '   ' }), 0).body).toBeNull();
  });

  it('says an invitation\'s time in UTC then on the phone, its place and places, and what its answer means now', () => {
    const m = circlePostModel(invitation(), 120);
    expect(m.invitation!.rows).toEqual([
      { label: 'WHEN', value: '12 OCT 2026 · 17:00 UTC', local: '12 OCT 2026 · 19:00 on this phone (UTC+02:00)' },
      { label: 'WHERE', value: 'PARIS' },
      { label: 'PLACES', value: '3 LEFT OF 12' },
    ]);
    expect(m.invitation).toMatchObject({ answer: null, open: true, full: false, sentence: CIRCLE.answer.none });
    expect(circlePostModel(invitation({}, 'YES'), 0).invitation?.sentence).toBe(CIRCLE.answer.yes);
    expect(circlePostModel(invitation({}, 'NO'), 0).invitation?.sentence).toBe(CIRCLE.answer.no);
    // Every place taken: YES is no longer offered to whoever has none of them; one who said YES keeps it.
    expect(circlePostModel(invitation({ placesLeft: 0 }), 0).invitation).toMatchObject({ full: true, sentence: CIRCLE.answer.full, rows: expect.arrayContaining([{ label: 'PLACES', value: 'NONE LEFT OF 12' }]) });
    expect(circlePostModel(invitation({ placesLeft: 0 }, 'YES'), 0).invitation).toMatchObject({ full: false, sentence: CIRCLE.answer.yes });
    expect(circlePostModel(invitation({ open: false }, 'YES'), 0).invitation).toMatchObject({ open: false, sentence: CIRCLE.answer.closed });
    // No limit: no row of places; in UTC on a phone in UTC, said once.
    const free = circlePostModel(invitation({ capacity: null, placesLeft: null, place: null }), 0);
    expect(free.invitation!.rows).toEqual([{ label: 'WHEN', value: '12 OCT 2026 · 17:00 UTC', local: null }]);
  });

  it('offers a poll\'s options until the reader votes, then its results, the reader\'s own marked', () => {
    const open = circlePostModel(post({ kind: 'POLL', poll: { options: ['Gold', 'Platinum 950'], vote: null, results: null } }), 0);
    expect(open.poll).toEqual({
      options: [
        { index: 0, label: 'GOLD', chosen: false },
        { index: 1, label: 'PLATINUM 950', chosen: false },
      ],
      voted: false,
      results: null,
      sentence: CIRCLE.pollLead,
    });
    const voted = circlePostModel(post({ kind: 'POLL', voted: true, poll: { options: ['Gold', 'Platinum 950'], vote: 1, results: { counts: [1, 3], total: 4 } } }), 0);
    expect(voted.poll).toMatchObject({
      voted: true,
      sentence: CIRCLE.pollVoted,
      results: [
        { label: 'GOLD', votes: '1 VOTE', share: '25%', mine: false },
        { label: 'PLATINUM 950', votes: '3 VOTES', share: '75%', mine: true },
      ],
    });
  });

  it('links a release by its id, a model by its address, and an address of another site on the code\'s hosts only', () => {
    const m = circlePostModel(
      post({
        links: {
          drop: { id: DROP, title: 'Monolithe — release II' },
          model: { slug: 'monolithe-ring', name: 'Monolithe', type: 'Ring' },
          external: { url: 'https://www.youtube.com/watch?v=orbes', host: 'youtube.com' },
        },
      }),
      0,
    );
    expect(m.links).toEqual({
      release: { id: DROP, href: `/verify/releases/${DROP}`, title: 'MONOLITHE — RELEASE II' },
      model: { slug: 'monolithe-ring', title: 'MONOLITHE · RING' },
      external: { href: 'https://www.youtube.com/watch?v=orbes', host: 'youtube.com' },
    });
    const bad = circlePostModel(
      post({ links: { drop: { id: 'nope', title: 'x' }, model: { slug: 'Not A Slug', name: 'x', type: 'y' }, external: { url: 'https://example.com/', host: 'example.com' } } }),
      0,
    );
    expect(bad.links).toEqual({ release: null, model: null, external: null });
  });

  it('writes its copy in the house\'s words: no word of BRAND §4.5, no exclamation mark', () => {
    const lines: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') lines.push(v);
      else if (typeof v === 'function') lines.push(String((v as (...a: unknown[]) => unknown)(2, 12)));
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(CIRCLE);
    expect(lines.length).toBeGreaterThan(30);
    expect(findForbidden(lines.join('\n'), [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(lines.join('\n')).not.toContain('!');
  });
});
