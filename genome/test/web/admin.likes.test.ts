/**
 * What they like in the console (plan CUSTOMER INTELLIGENCE §3.2 W.8, §3.6 C.6.3 item 4, C.6.5; step 9.4;
 * web/admin/model/likes.ts): the panel's words as the plan writes them, a most wished row's name and mark, the change
 * against the previous period, the share, the retired mark, the withheld median, the links' labels (question 16: a most
 * wished model or collection opens who wishes for it), the slices each figure opens, which figures are links (each most
 * wished row, models and collections, and 'Collectors with a wishlist'; none on 'Added', the wishes added or removed,
 * nor anything when `raw` is false), MOST VIEWED's note past the 13 months of detail, and What they look at under ALL
 * VISITORS (§3.3 T.4.2): its words, Time spent's comparison and the table beside Views by day.
 */
import { describe, expect, it } from 'vitest';
import * as model from '../../src/web/admin/model/likes.js';
import {
  changeWords,
  LIKES_COPY,
  LIKES_SLICES,
  lookDayRows,
  medianWords,
  modelWords,
  reachWords,
  seenFromWords,
  shareWords,
  tasteLabel,
  tasteWords,
  timeCompareWords,
  wishedCollectionLabel,
  wishedModelLabel,
  wishedLink,
  wishedName,
  wishlistLabel,
  wishlistLink,
} from '../../src/web/admin/model/likes.js';

describe('What they like (§3.2 W.8, §3.6 C.6.3 item 4)', () => {
  it('writes the plan’s titles, tabs, figures, notes and empty states', () => {
    expect(LIKES_COPY).toMatchObject({
      title: 'What they like',
      tabs: { pieces: 'FAVOURITE PIECES', finishes: 'FINISHES', wished: 'MOST WISHED', viewed: 'MOST VIEWED', held: 'PIECES HELD' },
      wishedSwitch: { models: 'MODELS', collections: 'COLLECTIONS' },
      viewedSwitch: { models: 'MODELS', releases: 'RELEASES', collectors: 'COLLECTORS', visitors: 'ALL VISITORS' },
      withWishlist: 'Collectors with a wishlist',
      wishesAdded: 'Wishes added',
      wishesRemoved: 'Wishes removed',
      mostWishedModels: 'Most wished models',
      mostWishedCollections: 'Most wished collections',
      rowsOpen: 'Each row opens the collectors who wish for it.',
      noCount: 'No count is shown on the model’s sheet.',
      monthly: 'Older than 13 months: monthly totals, without filters.',
      favouritePieces: 'Favourite pieces',
      favouriteFinishes: 'Favourite finishes',
      noneChosen: 'None chosen',
      columns: { collectorsWishing: 'Collectors wishing', addedInPeriod: 'Added in the period', chosen: 'Chosen in the period', collectorsWhoLooked: 'Collectors who looked', timeSpent: 'Time spent', medianTime: 'Median time per collector' },
      empty: { wishes: 'No wish in this period.', pieces: 'No collector has chosen a favourite piece yet.', finishes: 'No collector has chosen a favourite finish yet.' },
    });
    const words = JSON.stringify(LIKES_COPY);
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/atelier|handmade|craft|\bproducts?\b/i);
  });

  it('names a most wished row with its dot, and marks a model not shown in THE COLLECTION now', () => {
    expect(modelWords({ name: 'MONOLITHE', variant: 'Blue' })).toBe('MONOLITHE · Blue');
    expect(modelWords({ name: 'ORBITE', variant: null })).toBe('ORBITE');
    expect(modelWords({ name: null, variant: null })).toBe('(withdrawn)');
    expect(wishedName({ name: 'MONOLITHE', variant: 'Blue', state: 'SHOWN' })).toBe('MONOLITHE · Blue');
    expect(wishedName({ name: 'ORBITE', variant: null, state: 'HIDDEN' })).toBe('ORBITE (hidden)');
    expect(wishedName({ name: 'MONOLITHE', variant: 'Steel', state: 'DISCONTINUED' })).toBe('MONOLITHE · Steel (discontinued)');
    expect(wishedName({ name: 'NOCTURNE', variant: null, state: 'RESERVED' })).toBe('NOCTURNE (the private salon)');
  });

  it('writes the change against the previous period, the share, the retired mark and the withheld median', () => {
    expect(changeWords(54, 42)).toBe('+12');
    expect(changeWords(1, 4)).toBe('−3');
    expect(changeWords(7, 7)).toBe('0');
    expect(changeWords(7, null)).toBe('—');
    expect(changeWords(2_400, 1_200)).toBe('+1\u2009200');
    expect(shareWords(18)).toBe('18 % of collectors');
    expect(shareWords(null)).toBeNull();
    expect(tasteWords({ label: 'Gold', retired: true })).toBe('Gold (no longer in the collection)');
    expect(tasteWords({ label: 'RING', retired: false })).toBe('RING');
    expect(medianWords(null)).toBe('Fewer than 3 collectors');
    expect(medianWords(45)).toBe('45 s');
    expect(medianWords(38 * 60)).toBe('38 min');
  });

  it('labels each link by what it opens (question 16): a most wished model or collection, a favourite, the collectors with a wishlist', () => {
    expect(wishedModelLabel(42, { name: 'MONOLITHE', variant: 'Blue' })).toBe('Open the 42 collectors who wish for MONOLITHE · Blue');
    expect(wishedModelLabel(1, { name: 'ORBITE', variant: null })).toBe('Open the 1 collector who wishes for ORBITE');
    expect(wishedCollectionLabel(12, 'ORBITAL')).toBe('Open the 12 collectors who wish for a model of ORBITAL');
    expect(tasteLabel(31, 'PIECE', { label: 'RING' })).toBe('Open the 31 collectors whose favourite pieces include RING');
    expect(tasteLabel(3, 'FINISH', { label: 'Gold' })).toBe('Open the 3 collectors whose favourite finishes include Gold');
    expect(wishlistLabel(54)).toBe('Open the 54 collectors with a wishlist');
    for (const label of [wishedModelLabel(2, { name: 'A', variant: null }), wishedCollectionLabel(2, 'B'), tasteLabel(2, 'PIECE', { label: 'C' }), wishlistLabel(2)]) {
      expect(label).not.toContain('!');
      expect(label).not.toMatch(/\bproducts?\b/i);
    }
  });

  it('names the slice each figure opens, as §3.6 C.6.5 lists them', () => {
    expect(LIKES_SLICES.haswish()).toBe('haswish');
    expect(LIKES_SLICES.wishmodel('m-1')).toBe('wishmodel:m-1');
    expect(LIKES_SLICES.wishcollection('c-1')).toBe('wishcollection:c-1');
    expect(LIKES_SLICES.favpiece('RING')).toBe('favpiece:RING');
    expect(LIKES_SLICES.favfinish('GOLD')).toBe('favfinish:GOLD');
    expect(LIKES_SLICES.viewedModel('m-2')).toBe('viewed:m-2');
    expect(LIKES_SLICES.viewedRelease('d-1')).toBe('viewed:r:d-1');
    expect(LIKES_SLICES.holds('m-3')).toBe('holds:m-3');
  });

  it('links each most wished row (models and collections) and the collectors with a wishlist, none on Added nor when raw is false', () => {
    const main = { modelId: 'm-1', name: 'MONOLITHE', variant: 'Silver', wished: 42 };
    const dot = { modelId: 'm-2', name: 'MONOLITHE', variant: 'Blue', wished: 1 };
    const orbital = { collectionId: 'c-1', name: 'ORBITAL', collectors: 12 };
    expect(wishedLink(true, 'model', main)).toEqual({ slice: 'wishmodel:m-1', label: 'Open the 42 collectors who wish for MONOLITHE · Silver' });
    expect(wishedLink(true, 'model', dot)).toEqual({ slice: 'wishmodel:m-2', label: 'Open the 1 collector who wishes for MONOLITHE · Blue' });
    expect(wishedLink(true, 'collection', orbital)).toEqual({ slice: 'wishcollection:c-1', label: 'Open the 12 collectors who wish for a model of ORBITAL' });
    expect(wishlistLink(true, 54)).toEqual({ slice: 'haswish', label: 'Open the 54 collectors with a wishlist' });
    // From the monthly totals (raw: false) nothing names a collector: no row, nor the wishlist figure, is a link.
    expect(wishedLink(false, 'model', main)).toBeNull();
    expect(wishedLink(false, 'collection', orbital)).toBeNull();
    expect(wishlistLink(false, 54)).toBeNull();
    expect(wishlistLink(true, null)).toBeNull();
    // 'Added' ('Added in the period'), 'Wishes added' and 'Wishes removed' count wishes: the module links nothing else.
    expect(Object.keys(model).filter((k) => /Link$/.test(k)).sort()).toEqual(['wishedLink', 'wishlistLink']);
  });

  it('writes MOST VIEWED’s note when the period reaches past the 13 months of detail, in the console’s date format', () => {
    expect(reachWords('2025-09-08')).toBe('Filters other than the country reach back 13 months, to 08 SEP 2025.');
    expect(reachWords('2025-09-14')).toBe('Filters other than the country reach back 13 months, to 14 SEP 2025.');
    expect(reachWords(null)).toBeNull();
  });

  it('writes What they look at under ALL VISITORS (§3.3 T.4.2): its four figures, Views by day and Pages', () => {
    expect(LIKES_COPY.look).toMatchObject({
      title: 'What they look at',
      views: 'Views',
      timeSpent: 'Time spent',
      visitors: 'Visitors',
      collectorsSeen: 'Collectors seen',
      viewsByDay: 'Views by day',
      pages: 'Pages',
      shareOfTime: 'Share of time',
      previous: 'The previous period',
    });
    expect(seenFromWords('2025-09-14')).toBe('Counted from 14 SEP 2025.');
    expect(seenFromWords(null)).toBeNull();
  });

  it('compares Time spent with the previous period as a count is compared: the change in time and in per cent, the time before', () => {
    expect(timeCompareWords(3 * 3600 + 720, 3 * 3600)).toEqual({ change: '+12 min (+7%)', before: '3 h before' });
    expect(timeCompareWords(1800, 3600)).toEqual({ change: '−30 min (−50%)', before: '1 h before' });
    expect(timeCompareWords(60, 0)).toEqual({ change: 'new', before: null });
    expect(timeCompareWords(0, 0)).toEqual({ change: '—', before: null });
    expect(timeCompareWords(60, 60)).toEqual({ change: '0 (0%)', before: '1 min before' });
    expect(timeCompareWords(60, null)).toBeNull();
  });

  it('groups the table beside Views by day as Over time does: by day up to 31 days, by week up to 120, by month beyond, the previous period at the same rank', () => {
    const days = (from: string, n: number, views = (i: number) => i) => {
      const out: { day: string; views: number }[] = [];
      const d = new Date(`${from}T12:00:00Z`);
      for (let i = 0; i < n; i++, d.setUTCDate(d.getUTCDate() + 1)) out.push({ day: d.toISOString().slice(0, 10), views: views(i) });
      return out;
    };
    const month = lookDayRows(days('2026-09-15', 30), days('2026-08-16', 30, () => 2));
    expect(month.unit).toBe('day');
    expect(month.rows).toHaveLength(30);
    expect(month.rows[0]).toEqual({ from: '2026-09-15', to: '2026-09-15', views: 0, previous: { from: '2026-08-16', to: '2026-08-16', views: 2 } });
    const quarter = lookDayRows(days('2026-07-17', 90, () => 1), null);
    expect(quarter.unit).toBe('week');
    expect(quarter.rows).toHaveLength(13);
    expect(quarter.rows[0]).toEqual({ from: '2026-07-17', to: '2026-07-23', views: 7, previous: null });
    expect(quarter.rows[12]).toEqual({ from: '2026-10-09', to: '2026-10-14', views: 6, previous: null }); // the last six days
    const year = lookDayRows(days('2025-10-15', 365, () => 1), null);
    expect(year.unit).toBe('month');
    expect(year.rows).toHaveLength(13);
    expect(year.rows[0]).toEqual({ from: '2025-10-15', to: '2025-10-31', views: 17, previous: null });
    expect(year.rows[12]).toEqual({ from: '2026-10-01', to: '2026-10-14', views: 14, previous: null });
    expect(year.rows.reduce((s, r) => s + r.views, 0)).toBe(365);
  });
});
