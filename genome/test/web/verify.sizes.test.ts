/**
 * YOUR SIZES on /verify (plan NEXT-NINE of 2026-10-06, §3.4 AC-01, step 4.3), as sizes-model.ts reads them: each field's
 * choices (NOT SET, then the server's range in the collector's units), how a size reads (52, 16.5 CM), the row's line
 * (RING 52 · WRIST 16.5 CM, or NOT SET), the form read back as the sizes saved, and the words, held to the server's
 * ranges (services/sizes.ts), the lexicon and the house's voice. Pure: no DOM; the sheet is driven in Chromium by the
 * nocturne.content and nocturne.overflow shards.
 */
import { describe, expect, it } from 'vitest';
import { SIZE_KINDS as SERVER_SIZE_KINDS, SIZE_RANGES as SERVER_SIZE_RANGES, toMm } from '../../src/server/services/sizes.js';
import { ACCOUNT_SIZES } from '../../src/web/verify/copy.js';
import { NO_SIZES, SIZE_FIELDS, SIZE_KINDS, SIZE_RANGES, sizeFieldValue, sizeOptions, sizesFromForm, sizesSummary, sizeText } from '../../src/web/verify/sizes-model.js';
import { brandForbiddenTerms, findForbidden } from '../docs/lexicon.js';

describe('YOUR SIZES (AC-01)', () => {
  it('offers each kind\'s range in its unit, NOT SET first, every value one the server saves', () => {
    expect(SIZE_KINDS).toEqual([...SERVER_SIZE_KINDS]);
    const counts = Object.fromEntries(SIZE_KINDS.map((k) => [k, sizeOptions(k).length]));
    // NOT SET, then: rings 40 to 76; bracelets 14 to 24 cm by 0.5; wrists 12 to 24 cm by 0.5; necklaces 35 to 100 cm by 1.
    expect(counts).toEqual({ RING: 38, BRACELET: 22, WRIST: 26, NECKLACE: 67 });
    for (const k of SIZE_KINDS) {
      const [none, ...values] = sizeOptions(k);
      expect(none).toEqual({ value: '', label: 'NOT SET' });
      // The server's range, in whole millimetres, from the collector's first and last values.
      const r = SERVER_SIZE_RANGES[k];
      expect(toMm(k, Number(values[0]!.value)), k).toBe(r.min);
      expect(toMm(k, Number(values.at(-1)!.value)), k).toBe(r.max);
      for (const v of values) expect(() => toMm(k, Number(v.value)), `${k} ${v.value}`).not.toThrow();
      expect(values.length, k).toBe((r.max - r.min) / r.step + 1);
      expect([SIZE_RANGES[k].min, SIZE_RANGES[k].max], k).toEqual([Number(values[0]!.value), Number(values.at(-1)!.value)]);
    }
    expect(sizeOptions('BRACELET').slice(1, 4).map((o) => o.label)).toEqual(['14 CM', '14.5 CM', '15 CM']);
    expect(sizeOptions('RING').slice(1, 3).map((o) => [o.value, o.label])).toEqual([
      ['40', '40'],
      ['41', '41'],
    ]);
  });

  it('reads a size as 52 or 16.5 CM, and the row\'s line in the order ring, bracelet, wrist, necklace, or NOT SET', () => {
    expect(sizeText('RING', 52)).toBe('52');
    expect(sizeText('WRIST', 16.5)).toBe('16.5 CM');
    expect(sizeText('NECKLACE', 45)).toBe('45 CM');
    expect(sizesSummary({ ...NO_SIZES, WRIST: 16.5, RING: 52 })).toBe('RING 52 · WRIST 16.5 CM');
    expect(sizesSummary({ RING: 52, BRACELET: 18, WRIST: 16.5, NECKLACE: 45 })).toBe('RING 52 · BRACELET 18 CM · WRIST 16.5 CM · NECKLACE 45 CM');
    expect(sizesSummary(NO_SIZES)).toBe('NOT SET');
    expect(sizesSummary(null)).toBe('NOT SET');
  });

  it('opens each field on the size saved, or NOT SET; reads the form back as the sizes saved whole, NOT SET cleared', () => {
    expect(sizeFieldValue('RING', 52)).toBe('52');
    expect(sizeFieldValue('WRIST', 16.5)).toBe('16.5');
    expect(sizeFieldValue('WRIST', null)).toBe('');
    // A value the field does not offer (never saved by the server) opens on NOT SET.
    expect(sizeFieldValue('WRIST', 16.2)).toBe('');
    expect(sizesFromForm({ RING: '52', BRACELET: '', WRIST: '16.5', NECKLACE: '' })).toEqual({ RING: 52, BRACELET: null, WRIST: 16.5, NECKLACE: null });
    expect(sizesFromForm({ RING: '', BRACELET: '', WRIST: '', NECKLACE: '' })).toEqual(NO_SIZES);
  });

  it('says its words as the plan has them: the units only, no guide to measuring, no exclamation mark', () => {
    expect(ACCOUNT_SIZES).toMatchObject({
      row: 'YOUR SIZES',
      notSet: 'NOT SET',
      title: 'YOUR SIZES',
      lead: 'Your sizes preselect the size of a release or a request, for a model of that kind. You confirm it each time.',
      ring: 'RING SIZE',
      ringHint: 'French size.',
      bracelet: 'BRACELET SIZE',
      wrist: 'WRIST, FOR WATCHES',
      necklace: 'NECKLACE LENGTH',
      cmHint: 'In centimetres.',
      save: 'SAVE',
      cancel: 'CANCEL',
      saved: 'Your sizes are saved.',
      failed: 'Your sizes could not be saved just now.',
      // The view while the sizes are read, and when they cannot be (no field, no SAVE): the house's ONE MOMENT… and TRY AGAIN.
      loading: 'ONE MOMENT…',
      unreadable: 'Your sizes could not be shown just now.',
      retry: 'TRY AGAIN',
      short: { RING: 'RING', BRACELET: 'BRACELET', WRIST: 'WRIST', NECKLACE: 'NECKLACE' },
    });
    expect(SIZE_FIELDS.map((f) => [f.kind, f.label, f.hint])).toEqual([
      ['RING', 'RING SIZE', 'French size.'],
      ['BRACELET', 'BRACELET SIZE', 'In centimetres.'],
      ['WRIST', 'WRIST, FOR WATCHES', 'In centimetres.'],
      ['NECKLACE', 'NECKLACE LENGTH', 'In centimetres.'],
    ]);
    const words = Object.values(ACCOUNT_SIZES).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v))).join('\n');
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/measure|guide|tape/i);
    expect(findForbidden(words, brandForbiddenTerms())).toEqual([]);
  });
});
