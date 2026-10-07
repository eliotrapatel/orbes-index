/**
 * THE CLUB (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T9; /verify/club; club-model.ts): its lead from the server's
 * thresholds (never typed in the copy), a plate per tier with FROM n PIECES and its lines, the welcome gift's photograph
 * only from this origin's media route, HOW THE TIERS WORK with the credit's currency from the setting, the way to the
 * reader's tier (signed in, without a tier, signed out), and no link to HOW RELEASES WORK.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUB_PATH, clubPageModel, isClubPath } from '../../src/web/verify/club-model.js';
import { CLUB_PAGE } from '../../src/web/verify/copy.js';
import type { TheClub } from '../../src/web/verify/types.js';

const MEDIA = `/api/v1/media/${'ab'.repeat(32)}`;
const club = (over: Partial<TheClub> = {}): TheClub => ({
  tiers: [
    { name: 'TITANE', level: 1, pieces: 1, lines: ['The owners’ circle: its notes, its invitations and its polls.'] },
    { name: 'PLATINE', level: 2, pieces: 5, lines: ['Free shipping on every order.', '  '] },
    { name: 'PALLADIUM', level: 3, pieces: 10, lines: ['Free express shipping on every order.'] },
  ],
  tierThresholds: [1, 5, 10],
  creditCurrency: 'EUR',
  gifts: [],
  ...over,
});

describe('THE CLUB (club-model.ts)', () => {
  it('lives at /verify/club', () => {
    expect(CLUB_PATH).toBe('/verify/club');
    expect(isClubPath('/verify/club')).toBe(true);
    expect(isClubPath('/verify/CLUB/')).toBe(true);
    expect(isClubPath('/verify/club/x')).toBe(false);
  });

  it('says the thresholds the server sends, each tier from its pieces, and its lines', () => {
    const m = clubPageModel(club(), { signedIn: false });
    expect(m.title).toBe('THE CLUB');
    expect(m.lead).toBe('Your tier is set by the pieces registered to your ORBES account now: TITANE from 1 piece, PLATINE from 5, PALLADIUM from 10.');
    expect(m.tiers.map((t) => [t.name, t.from, t.lines])).toEqual([
      ['TITANE', 'FROM 1 PIECE', ['The owners’ circle: its notes, its invitations and its polls.']],
      ['PLATINE', 'FROM 5 PIECES', ['Free shipping on every order.']],
      ['PALLADIUM', 'FROM 10 PIECES', ['Free express shipping on every order.']],
    ]);
    // Other figures from the server, other words: never a figure of the copy.
    expect(clubPageModel(club({ tierThresholds: [2, 6, 12] }), { signedIn: false }).lead).toBe('Your tier is set by the pieces registered to your ORBES account now: TITANE from 2 pieces, PLATINE from 6, PALLADIUM from 12.');
    expect(clubPageModel(club({ tierThresholds: [1, 5] }), { signedIn: false }).lead).toBeNull();
    const copy = readFileSync(new URL('../../src/web/verify/copy.ts', import.meta.url), 'utf8');
    const group = copy.slice(copy.indexOf('export const CLUB_PAGE'), copy.indexOf('});', copy.indexOf('export const CLUB_PAGE')));
    expect(group).not.toMatch(/from (1|5|10)\b|FROM (1|5|10)\b/);
  });

  it('says the credit\'s currency from the setting, in HOW THE TIERS WORK', () => {
    const how = (code: string) => clubPageModel(club({ creditCurrency: code }), { signedIn: false }).how;
    expect(how('EUR')).toEqual({
      label: 'HOW THE TIERS WORK',
      lines: [
        'Your tier follows the pieces registered to you at every moment: a piece passed on, revoked or retired by ORBES counts for no tier, and your tier follows at once.',
        'The welcome gift and the credit are given once per tier and per account.',
        'The credit applies to orders in euros.',
        'Free shipping applies to deliveries, not to returns.',
        'Each draw’s page gives its own early access times.',
      ],
    });
    expect(how('GBP').lines).toContain('The credit applies to orders in pounds sterling.');
    expect(how('USD').lines).toContain('The credit applies to orders in US dollars.');
    expect(how('CHF').lines).toContain('The credit applies to orders in Swiss francs.');
  });

  it('shows a welcome gift\'s photograph from this origin\'s media route only, with its name in capitals', () => {
    const m = clubPageModel(club({ gifts: [{ tier: 'PALLADIUM', model: 'Orbital charm', imageUrl: MEDIA }, { tier: 'PLATINE', model: 'X', imageUrl: 'https://example.com/x.jpg' }] }), { signedIn: false });
    expect(m.tiers.find((t) => t.name === 'PALLADIUM')!.gift).toEqual({ src: MEDIA, alt: 'ORBITAL CHARM, photographed by ORBES', model: 'ORBITAL CHARM' });
    expect(m.tiers.find((t) => t.name === 'PLATINE')!.gift).toBeNull();
  });

  it('leads to the reader\'s tier: the account sheet signed in, MY PIECES without a tier, its sign-in signed out', () => {
    expect(clubPageModel(club(), { signedIn: true, status: { tier: { level: 2, name: 'PLATINE' }, pieces: 6 } }).yours).toEqual({ text: 'YOUR TIER: PLATINE · 6 PIECES HELD', to: 'account' });
    expect(clubPageModel(club(), { signedIn: true, status: { tier: { level: 1, name: 'TITANE' }, pieces: 1 } }).yours).toEqual({ text: 'YOUR TIER: TITANE · 1 PIECE HELD', to: 'account' });
    expect(clubPageModel(club(), { signedIn: true, status: { tier: { level: 0, name: null }, pieces: 0 } }).yours).toEqual({ text: 'YOUR FIRST PIECE OPENS TITANE', to: 'pieces' });
    expect(clubPageModel(club(), { signedIn: false }).yours).toEqual({ text: 'SIGN IN TO SEE YOUR TIER', to: 'signIn' });
    expect(clubPageModel(club(), { signedIn: true, status: null }).yours).toBeNull();
  });

  it('has no link to HOW RELEASES WORK, and its words are calm', () => {
    const view = readFileSync(new URL('../../src/web/verify/views/club.ts', import.meta.url), 'utf8');
    const model = readFileSync(new URL('../../src/web/verify/club-model.ts', import.meta.url), 'utf8');
    for (const src of [view, model]) {
      expect(src).not.toMatch(/releases\/how|HOW RELEASES WORK'|RELEASES\.how|RELEASES_PATH/);
    }
    const words = Object.values(CLUB_PAGE).map((v) => (typeof v === 'function' ? String((v as (...a: unknown[]) => unknown)(1, 5, 10)) : String(v)));
    for (const w of words) expect(w).not.toContain('!');
  });
});
