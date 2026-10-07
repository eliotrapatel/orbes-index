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
import { inUseModel, TIER_DOTS, tierDotsOf, tierModel } from '../../src/web/verify/tier-model.js';
import type { ClubStatus, ClubTierName, CreditChannel } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

/** THE PROGRAM's "Credit usable on" by default: every channel. */
const ALL_CHANNELS: CreditChannel[] = ['DRAW', 'LIVE', 'SALON'];

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
      inUse: null,
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

  it('puts the program\'s lines before the tiers\' words, in YOUR TIER and in NEXT (plan NEXT-NINE, BP-19 T10)', () => {
    const s = { ...status(2, 6), program: ['Free shipping on every order.'], next: { ...status(2, 6).next!, program: ['Free express shipping on every order.'] } };
    const m = tierModel(s, 6);
    expect(m.benefits).toEqual(['Free shipping on every order.', ...lines('TITANE'), ...lines('PLATINE')]);
    expect(m.next!.benefits).toEqual(['Free express shipping on every order.', ...lines('PALLADIUM')]);
  });

  it('shows IN USE only when a row exists: the credit and until when, the yearly care, one WELCOME GIFT row for the next order and one per order (plan NEXT-NINE, BP-19 T10)', () => {
    expect(inUseModel({ credit: null, care: null, gifts: [], creditChannels: ALL_CHANNELS })).toBeNull();
    expect(inUseModel(undefined)).toBeNull();
    expect(inUseModel({ credit: { balanceMinor: 5000, currency: 'EUR', expiresAt: '2027-10-06T09:00:00.000Z' }, care: { year: 2026, used: 0, allowance: 1 }, gifts: [], creditChannels: ALL_CHANNELS })).toEqual({
      label: 'IN USE',
      rows: [
        ['CREDIT', '€\u00a050 · UNTIL 6 OCT 2027'],
        ['YEARLY CARE', '0 OF 1 PIECE IN 2026'],
      ],
      note: 'ORBES Client Services takes it off the invoice of a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.',
    });
    expect(inUseModel({ credit: null, care: { year: 2026, used: 2, allowance: 'ALL' }, gifts: [], creditChannels: ALL_CHANNELS })!.rows).toEqual([['YEARLY CARE', 'EVERY PIECE · 2 IN 2026']]);
    expect(inUseModel({ credit: null, care: { year: 2026, used: 1, allowance: 3 }, gifts: [], creditChannels: ALL_CHANNELS })!.rows).toEqual([['YEARLY CARE', '1 OF 3 PIECES IN 2026']]);
    const gifts = inUseModel({
      credit: null,
      care: null,
      gifts: [
        { tier: 'PLATINE', model: 'ORBITAL CHARM', state: 'PENDING', orderReference: null },
        { tier: 'PALLADIUM', model: 'ORBITAL CHARM', state: 'PENDING', orderReference: null },
        { tier: 'PLATINE', model: 'ANNEAU', state: 'WITH_ORDER', orderReference: 'OR-7C21A9F0' },
      ],
      creditChannels: ALL_CHANNELS,
    })!;
    expect(gifts.rows).toEqual([
      ['WELCOME GIFT', 'WITH YOUR NEXT ORDER'],
      ['WELCOME GIFT', 'WITH ORDER OR-7C21A9F0'],
    ]);
    expect(gifts.note).toBeNull();
    // The note follows THE PROGRAM's "Credit usable on": a draw and a LIVE RELEASE only; one channel alone; none known, no note.
    const credit = { balanceMinor: 5000, currency: 'EUR', expiresAt: '2027-10-06T09:00:00.000Z' };
    expect(inUseModel({ credit, care: null, gifts: [], creditChannels: ['DRAW', 'LIVE'] })!.note).toBe('ORBES Client Services takes it off the invoice of a piece from a draw or a LIVE RELEASE.');
    expect(inUseModel({ credit, care: null, gifts: [], creditChannels: ['SALON'] })!.note).toBe('ORBES Client Services takes it off the invoice of a piece from THE PRIVATE SALON.');
    expect(inUseModel({ credit, care: null, gifts: [], creditChannels: [] })).toEqual({ label: 'IN USE', rows: [['CREDIT', '€\u00a050 · UNTIL 6 OCT 2027']], note: null });
    // No tier: no IN USE, whatever is sent.
    expect(tierModel({ ...status(0, 0), inUse: { credit: { balanceMinor: 5000, currency: 'EUR', expiresAt: '2027-10-06T09:00:00.000Z' }, care: null, gifts: [], creditChannels: ALL_CHANNELS } }, 0).inUse).toBeNull();
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
      inUse: null,
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
