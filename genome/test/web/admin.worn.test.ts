/**
 * The WORN page of the console (plan MACRO M2 §2.4, scope D31 G2; src/web/admin/model/worn.ts): the console's types held
 * to the server's answers at compile time, the page's address, who may review, the credit exactly as it will read (G3:
 * the first name and the country, the Instagram name when chosen, never a variant), the three reasons in staff words and
 * in the owner's, who ended a photograph and why, the published photographs by model, the model filter's choices, the
 * badge and a model page's line, and J/K between the cards. The page is driven in Chromium by admin.e2e.
 */
import { describe, expect, it } from 'vitest';
import type { AdminWornPhoto as ServerWornPhoto, WornSummary as ServerWornSummary } from '../../src/server/services/worn.js';
import { WORN_QUEUES as SERVER_QUEUES } from '../../src/server/services/worn.js';
import { WORN_REFUSALS as SERVER_REFUSALS } from '../../src/server/db/schema.js';
import { CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import {
  consentText,
  creditLine,
  endedWho,
  endedWhy,
  groupByModel,
  modelOptions,
  modelText,
  modelWornText,
  ownerReads,
  refusalOptions,
  refusalProblem,
  statusWords,
  stepCard,
  tabText,
  waitingLine,
  WORN_PAGE_SIZES,
  WORN_QUEUE_OF,
  WORN_REFUSAL_WORDS,
  wornActions,
  wornBadge,
  wornGroupOf,
  wornParams,
} from '../../src/web/admin/model/worn.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import { WORN_QUEUES, WORN_REFUSALS, WORN_STATUSES, type AdminWornPhoto, type WornSummary } from '../../src/web/admin/types.js';

type Iso = string;
type Json<T> = T extends Date ? Iso : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertType = <T extends true>(_: T) => _;
assertType<Same<Json<ServerWornPhoto>, AdminWornPhoto>>(true);
assertType<Same<Json<ServerWornSummary>, WornSummary>>(true);

const MODEL = '0b6d7c4e-2f0a-4c5e-9a51-6f0a8b2d3e10';

function photo(over: Partial<AdminWornPhoto> = {}): AdminWornPhoto {
  return {
    id: '7f1e2d3c-4b5a-4968-8776-655443322110',
    status: 'PENDING',
    piece: { id: 'a1', productId: 'O26-J-00184' },
    model: { id: MODEL, name: 'ORBIT RING', slug: 'orbit-ring', variantLabel: null },
    owner: { accountId: 'b2', email: 'c***@example.com' },
    credit: { firstName: 'Camille', country: 'France', countryCode: 'FR', instagram: null },
    consentVersion: '2026-10-21',
    consentAt: '2026-10-22T08:00:00.000Z',
    sentAt: '2026-10-22T08:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    publishedAt: null,
    endedAt: null,
    refusal: null,
    photoUrl: '/api/admin/worn/7f1e2d3c-4b5a-4968-8776-655443322110/photo',
    width: 900,
    height: 1125,
    shown: false,
    ...over,
  };
}

describe('the WORN page (plan MACRO M2 §2.4)', () => {
  it('holds the server’s lists and reasons, and reviews for an OPERATOR only', () => {
    expect([...WORN_QUEUES]).toEqual([...SERVER_QUEUES]);
    expect([...WORN_REFUSALS]).toEqual([...SERVER_REFUSALS]);
    expect(Object.values(WORN_QUEUE_OF)).toEqual([...WORN_QUEUES]);
    expect(CAPABILITY_MIN_ROLE.reviewWorn).toBe('OPERATOR');
    expect(['AUDITOR', 'OPERATOR', 'ADMIN'].map((r) => wornActions(r as 'AUDITOR').review)).toEqual([false, true, true]);
    expect(WORN_PAGE_SIZES).toEqual({ review: 10, published: 24, ended: 50 });
  });

  it('reads its address: TO REVIEW by default, a model alone opens PUBLISHED of its group, a bad value ignored', () => {
    expect(parseHash('#/worn').name).toBe('worn');
    expect(href('worn', {}, { tab: 'published', model: MODEL })).toBe(`#/worn?tab=published&model=${MODEL}`);
    expect(wornParams({})).toEqual({ tab: 'review', model: null, page: 1 });
    expect(wornParams({ model: MODEL.toUpperCase() })).toEqual({ tab: 'published', model: MODEL, page: 1 });
    expect(wornParams({ tab: 'ended', model: MODEL, page: '3' })).toEqual({ tab: 'ended', model: null, page: 3 });
    expect(wornParams({ tab: 'nope', model: 'x', page: '-2' })).toEqual({ tab: 'review', model: null, page: 1 });
  });

  it('writes the credit exactly as it will read: first name · country, the Instagram name when chosen, never a variant', () => {
    expect(creditLine({ firstName: 'Camille', country: 'France', instagram: null })).toEqual({ line: 'CAMILLE · FRANCE', handle: null, href: null });
    expect(creditLine({ firstName: ' Léa ', country: 'Belgium', instagram: 'lea.b' })).toEqual({ line: 'LÉA · BELGIUM', handle: '@lea.b', href: 'https://www.instagram.com/lea.b/' });
    const p = photo({ model: { id: MODEL, name: 'ORBIT RING', slug: null, variantLabel: 'Blue' } });
    expect(creditLine(p.credit).line).not.toMatch(/BLUE|ORBIT|O26/);
    expect(modelText(p.model)).toBe('ORBIT RING · BLUE');
    expect(consentText(p)).toBe('Version 2026-10-21 · 22 OCT 2026 · 10:00 Paris');
  });

  it('gives each reason in staff words and the words the owner reads, and asks for one', () => {
    expect(Object.keys(WORN_REFUSAL_WORDS)).toEqual([...WORN_REFUSALS]);
    expect(Object.values(WORN_REFUSAL_WORDS).map((w) => w.owner)).toEqual([
      'The piece is not clearly visible.',
      'The photograph is not sharp enough.',
      'This photograph cannot be shown in WORN.',
    ]);
    expect(refusalOptions().map((o) => o.value)).toEqual(['', ...WORN_REFUSALS]);
    expect(refusalOptions()[0]!.disabled).toBe(true);
    expect(refusalProblem('')).toBe('Choose a reason.');
    expect(refusalProblem('UGLY')).toBe('Choose a reason.');
    expect(refusalProblem('QUALITY')).toBeNull();
    expect(ownerReads('QUALITY')).toBe('The photograph is not sharp enough.');
    expect(ownerReads('')).toBeNull();
  });

  it('says why a photograph ended and by whom, every status in words', () => {
    expect(WORN_STATUSES.map((s) => statusWords(s).text)).toEqual(['To review', 'Published', 'Refused', 'Withdrawn', 'Taken down', 'Ended']);
    const by = { id: 'x', email: 'staff@orbes.test' };
    expect([endedWhy(photo({ status: 'REFUSED', refusal: 'QUALITY' })), endedWho(photo({ status: 'REFUSED', reviewedBy: by }))]).toEqual(['Not sharp enough', 'staff@orbes.test']);
    expect([endedWhy(photo({ status: 'TAKEN_DOWN', refusal: 'NOT_SUITABLE' })), endedWho(photo({ status: 'TAKEN_DOWN', reviewedBy: by }))]).toEqual(['Cannot be shown in WORN', 'staff@orbes.test']);
    expect([endedWhy(photo({ status: 'WITHDRAWN' })), endedWho(photo({ status: 'WITHDRAWN' }))]).toEqual(['Withdrawn by its owner', 'The owner']);
    expect([endedWhy(photo({ status: 'ENDED' })), endedWho(photo({ status: 'ENDED' }))]).toEqual(['The piece left its owner', 'ORBES, automatically']);
  });

  it('groups the published photographs by model in their order, and offers the main models to filter by', () => {
    const a = photo({ id: '1', model: { id: 'm1', name: 'ORBIT RING', slug: null, variantLabel: 'Silver' } });
    const b = photo({ id: '2', model: { id: 'm2', name: 'HALO', slug: null, variantLabel: null } });
    const c = photo({ id: '3', model: { id: 'm3', name: 'ORBIT RING', slug: null, variantLabel: 'Blue' } });
    expect(groupByModel([a, b, c]).map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['ORBIT RING', ['1', '3']],
      ['HALO', ['2']],
    ]);
    const models = [
      { id: 'm1', name: 'orbit ring', variantOf: null },
      { id: 'm3', name: 'orbit ring', variantOf: { id: 'm1', name: 'orbit ring', label: 'Silver' } },
      { id: 'm2', name: 'halo', variantOf: null },
    ];
    expect(modelOptions(models)).toEqual([
      { value: '', label: 'All models' },
      { value: 'm2', label: 'HALO' },
      { value: 'm1', label: 'ORBIT RING' },
    ]);
    expect(wornGroupOf(models[1]!)).toBe('m1');
    expect(wornGroupOf(models[0]!)).toBe('m1');
  });

  it('counts the badge, the tabs, the wait and a model page’s line', () => {
    expect([wornBadge(0), wornBadge(3), wornBadge(1200)]).toEqual(['', '3', '1\u2009200']);
    const s: WornSummary = { toReview: 3, published: 8, oldestToReviewAt: '2026-10-22T08:00:00.000Z' };
    expect([tabText('review', s), tabText('published', s), tabText('ended', s), tabText('review', null)]).toEqual([
      { words: 'To review', count: '3' },
      { words: 'Published', count: '8' },
      { words: 'Ended', count: null },
      { words: 'To review', count: null },
    ]);
    expect(waitingLine(s, new Date('2026-10-22T10:30:00.000Z'))).toBe('3 to review · the oldest sent 2 H AGO');
    expect(waitingLine({ ...s, toReview: 0 }, new Date())).toBeNull();
    expect([modelWornText(8), modelWornText(0), modelWornText(null)]).toEqual(['8 published', 'None published', 'Could not be read.']);
  });

  it('moves between the cards with J and K, held within the list', () => {
    expect([stepCard('j', -1, 3), stepCard('k', -1, 3)]).toEqual([0, 2]);
    expect([stepCard('j', 0, 3), stepCard('J', 2, 3), stepCard('k', 1, 3), stepCard('k', 0, 3)]).toEqual([1, 2, 0, 0]);
    expect([stepCard('x', 0, 3), stepCard('j', -1, 0)]).toEqual([null, null]);
  });
});
