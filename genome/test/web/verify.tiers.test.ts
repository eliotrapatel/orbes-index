/**
 * The club's tier at the head of MY PIECES (P-X04, tier-model.ts): the badge (the tier's name, and the pieces it
 * counts in words the reading face sets), the benefits of the tier and of those below it, the way to the next tier
 * (how many more pieces, from how many, what it adds), PALLADIUM the highest, THE CLUB and what a first piece opens
 * for an account without a tier, the note when a listed piece counts for none; a malformed answer shows less, never
 * something wrong. The copy held to the lexicon, and to the server's tiers. Plan NEXT-NINE, BP-19 T1: the tiers at 1, 5
 * and 10 pieces, and the meter of ten dots, one per piece up to PALLADIUM (TIER_DOTS, read from the status's
 * `tierThresholds`, never a typed 5). Pure: no DOM; the page is driven in Chromium by verify.e2e.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLUB_TIER_DEFAULT_BENEFITS, CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS, benefitLines } from '../../src/server/services/club.js';
import { TIER } from '../../src/web/verify/copy.js';
import { TIER_DOTS, tierDotsOf, tierModel } from '../../src/web/verify/tier-model.js';
import type { ClubStatus, ClubTierName } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const lines = (name: keyof typeof CLUB_TIER_DEFAULT_BENEFITS) => benefitLines(CLUB_TIER_DEFAULT_BENEFITS[name]);

/** A status as the server sends it for `pieces` held now (services/club.ts ClubService.status). */
function status(level: 0 | 1 | 2 | 3, pieces: number): ClubStatus {
  const names: readonly ClubTierName[] = CLUB_TIER_NAMES;
  const next = level < 3 ? names[level]! : null;
  return {
    tier: { level, name: level === 0 ? null : CLUB_TIER_NAMES[level - 1]! },
    pieces,
    seniority: 0,
    benefits: CLUB_TIER_NAMES.slice(0, level).flatMap((n) => lines(n)),
    next: next ? { level: (level + 1) as 1 | 2 | 3, name: next, pieces: CLUB_TIER_THRESHOLDS[level]!, missing: CLUB_TIER_THRESHOLDS[level]! - pieces, benefits: lines(next) } : null,
    tierThresholds: [...CLUB_TIER_THRESHOLDS],
    entries: [],
  };
}

describe('the tier at the head of MY PIECES (P-X04)', () => {
  it('names the tier, counts its pieces, lists its benefits and the way to the next tier', () => {
    expect(tierModel(status(1, 1), 1)).toEqual({
      label: 'YOUR TIER',
      badge: { name: 'TITANE', pieces: '1 piece held' },
      meter: { on: 1, of: 10 },
      benefits: lines('TITANE'),
      next: { label: 'NEXT: PLATINE', sentence: '4 more pieces registered to your account open PLATINE, from 5 pieces held. It adds:', benefits: lines('PLATINE') },
      top: null,
      note: null,
    });
    // Four pieces are TITANE still: one more opens PLATINE, from five.
    expect(tierModel(status(1, 4), 4).next?.sentence).toBe('1 more piece registered to your account opens PLATINE, from 5 pieces held. It adds:');
    const platine = tierModel(status(2, 6), 6);
    expect(platine.badge).toEqual({ name: 'PLATINE', pieces: '6 pieces held' });
    expect(platine.meter).toEqual({ on: 6, of: 10 });
    expect(platine.benefits).toEqual([...lines('TITANE'), ...lines('PLATINE')]);
    expect(platine.next).toEqual({ label: 'NEXT: PALLADIUM', sentence: '4 more pieces registered to your account open PALLADIUM, from 10 pieces held. It adds:', benefits: lines('PALLADIUM') });
    expect(tierModel(status(2, 9), 9).next?.sentence).toBe('1 more piece registered to your account opens PALLADIUM, from 10 pieces held. It adds:');
  });

  it('says PALLADIUM is the highest, with every benefit and no next tier', () => {
    const m = tierModel(status(3, 12), 12);
    expect(m.badge).toEqual({ name: 'PALLADIUM', pieces: '12 pieces held' });
    // Every dot filled, never more than the meter holds.
    expect(m.meter).toEqual({ on: 10, of: 10 });
    expect(m.benefits).toEqual([...lines('TITANE'), ...lines('PLATINE'), ...lines('PALLADIUM')]);
    expect(m.next).toBeNull();
    expect(m.top).toBe(TIER.top);
  });

  it('gives an account without a tier THE CLUB and what a first piece opens, without a badge', () => {
    const m = tierModel(status(0, 0), 0);
    expect(m).toEqual({
      label: 'THE CLUB',
      badge: null,
      meter: null,
      benefits: [],
      next: { label: 'NEXT: TITANE', sentence: 'A piece registered to your ORBES account opens TITANE, the first tier of the club:', benefits: lines('TITANE') },
      top: null,
      note: null,
    });
  });

  it('says why a listed piece counts for no tier (revoked or retired by ORBES)', () => {
    expect(tierModel(status(1, 2), 3).note).toBe(TIER.counted);
    expect(tierModel(status(0, 0), 1).note).toBe(TIER.counted);
    expect(tierModel(status(1, 2), 2).note).toBeNull();
  });

  it('reads a malformed answer defensively: less is shown, never something wrong', () => {
    // An older server, without benefits or a next tier: the badge alone.
    const bare = tierModel({ tier: { level: 2, name: 'PLATINE' }, pieces: 5 });
    expect(bare).toMatchObject({ badge: { name: 'PLATINE', pieces: '5 pieces held' }, meter: { on: 5, of: TIER_DOTS }, benefits: [], next: null });
    // A next tier that does not follow the account's, a level out of range, non-text benefits.
    const odd = tierModel({ ...status(1, 1), next: { level: 3, name: 'PALLADIUM', pieces: 10, missing: 9, benefits: ['x'] } });
    expect(odd.next).toBeNull();
    expect(tierModel({ tier: { level: 7 as 0, name: null }, pieces: 2, benefits: ['A'], next: null }).badge).toBeNull();
    const noisy = tierModel({ ...status(1, 1), benefits: ['  The circle.  ', '', 3 as unknown as string] });
    expect(noisy.benefits).toEqual(['The circle.']);
    // A missing count of pieces still reads, at least one more piece.
    expect(tierModel({ ...status(1, 1), next: { level: 2, name: 'PLATINE', pieces: 5, missing: 0, benefits: [] } }).next?.sentence).toMatch(/^1 more piece /);
    // Thresholds missing, malformed or out of bounds: the meter keeps TIER_DOTS.
    for (const tierThresholds of [undefined, [], [1, 5], [1, 5, 0], [1, 5, 10.5], [1, 5, 99], ['1', '5', '10']]) {
      expect(tierDotsOf({ tierThresholds }), JSON.stringify(tierThresholds)).toBe(TIER_DOTS);
    }
  });

  it('draws the meter as one dot per piece up to PALLADIUM: TIER_DOTS, the status\'s last threshold, ten (plan NEXT-NINE, BP-19 T1)', () => {
    expect(TIER_DOTS).toBe(CLUB_TIER_THRESHOLDS[2]);
    expect(TIER_DOTS).toBe(10);
    expect(tierDotsOf(status(2, 5))).toBe(CLUB_TIER_THRESHOLDS[2]);
    // The status decides: a server whose PALLADIUM started from 12 would draw 12.
    expect(tierDotsOf({ tierThresholds: [1, 6, 12] })).toBe(12);
    // tierDots draws the count it is given, never a typed five (views/nocturne.ts), and the account sheet gives it the model's.
    const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/verify', rel), 'utf8');
    const nocturne = src('views/nocturne.ts');
    const body = nocturne.slice(nocturne.indexOf('export function tierDots('), nocturne.indexOf('\n}\n', nocturne.indexOf('export function tierDots(')));
    expect(body).toContain('Array.from({ length: total }');
    expect(body).not.toMatch(/\b5\b/);
    expect(src('views/account.ts')).toContain('tierDots(m.meter.on, m.meter.of, { start: true })');
  });

  it('writes its copy within the lexicon: no word of §4.5, no "!", the tiers named as the server names them', () => {
    const copy = [TIER.label, TIER.noneLabel, TIER.pieces(1), TIER.pieces(5), TIER.next('PLATINE'), TIER.nextWay('PLATINE', 4, 5), TIER.first('TITANE'), TIER.top, TIER.counted];
    expect(findForbidden(copy.join('\n'), [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(copy.join('\n')).not.toContain('!');
    expect(TIER.top).toContain(CLUB_TIER_NAMES[2]);
    // The default words of the benefits, shown to owners on /verify, too.
    expect(findForbidden(Object.values(CLUB_TIER_DEFAULT_BENEFITS).join('\n'), [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});
