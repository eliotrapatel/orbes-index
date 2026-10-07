/**
 * HOW RELEASES WORK (plan NEXT-NINE of 2026-10-06, §3.5 FT-01, step 5.2; /verify/releases/how; how-model.ts, copy.ts
 * HOW): the windows said in hours or minutes (120, 240, 90), THE TIERS' rows from the server's figures, the route under
 * THE RELEASES, the client's read of GET /api/v1/releases/rules, and the words: calm (no '!', no lottery, no word of
 * BRAND §4.5), no contact (no '@', mailto or phone number), no "only your account" line, never the place held's 48 hours
 * for an early access, and the draw's order named as RELEASES.rule names it (tier, seniority, seed).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReleaseRules as ServerReleaseRules } from '../../src/server/services/release-rules.js';
import { ApiClient } from '../../src/web/verify/api.js';
import { HOW, LIVE, RELEASES } from '../../src/web/verify/copy.js';
import { earlyText, HOW_PATH, howPageModel, tierRows, windowWords } from '../../src/web/verify/how-model.js';
import { releasesRouteOf } from '../../src/web/verify/releases-model.js';
import type { ReleaseRules } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const RULES: ReleaseRules = {
  tiers: [
    { name: 'TITANE', level: 1, pieces: 1 },
    { name: 'PLATINE', level: 2, pieces: 5 },
    { name: 'PALLADIUM', level: 3, pieces: 10 },
  ],
  earlyAccess: { PALLADIUM: 240, PLATINE: 120 },
  placeHeldHours: 48,
  salonFromTier: 'TITANE',
};

/** Every sentence and label of HOW, its functions called with stand-in figures. */
const words = (): string => {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)('4 hours', '2 hours')));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(HOW);
  return out.join('\n');
};

describe('HOW RELEASES WORK (how-model.ts)', () => {
  it('says a window of whole hours in hours, any other in minutes, and none for 0', () => {
    expect(windowWords(120)).toBe('2 hours');
    expect(windowWords(240)).toBe('4 hours');
    expect(windowWords(90)).toBe('90 minutes');
    expect(windowWords(60)).toBe('1 hour');
    expect(windowWords(1)).toBe('1 minute');
    for (const none of [0, -60, 1.5, Number.NaN, null, undefined, '120']) expect(windowWords(none)).toBeNull();
  });

  it('says the usual early access from the server\'s windows, PLATINE\'s left out when it has none', () => {
    expect(earlyText(240, 120)).toContain('PALLADIUM owners from 4 hours before the opening, PLATINE owners from 2 hours before.');
    expect(earlyText(240, 90)).toContain('PALLADIUM owners from 4 hours before the opening, PLATINE owners from 90 minutes before.');
    expect(earlyText(360, 0)).toContain('PALLADIUM owners from 6 hours before the opening.');
    expect(earlyText(360, 0)).not.toContain('PLATINE owners from');
    expect(earlyText(120, 120)).toContain('PALLADIUM and PLATINE owners from 2 hours before the opening.');
    expect(earlyText(0, 0)).toBe(HOW.ways.early.none);
    for (const t of [earlyText(240, 120), earlyText(240, 90), earlyText(0, 0)]) {
      expect(t).toContain('first come, first served');
      expect(t).not.toMatch(/48/);
    }
  });

  it('draws THE TIERS\' rows from the figures sent, TITANE first, and leaves out what is not a tier', () => {
    expect(tierRows(RULES)).toEqual(['TITANE · FROM 1 PIECE', 'PLATINE · FROM 5 PIECES', 'PALLADIUM · FROM 10 PIECES']);
    // Other figures, other rows: nothing is typed into the copy.
    expect(tierRows({ tiers: [{ name: 'TITANE', level: 1, pieces: 2 }, { name: 'PLATINE', level: 2, pieces: 7 }, { name: 'PALLADIUM', level: 3, pieces: 12 }] })).toEqual([
      'TITANE · FROM 2 PIECES',
      'PLATINE · FROM 7 PIECES',
      'PALLADIUM · FROM 12 PIECES',
    ]);
    expect(tierRows({ tiers: [{ name: 'TITANE', level: 1, pieces: 0 }] })).toEqual([]);
    expect(tierRows({ tiers: null as unknown as ReleaseRules['tiers'] })).toEqual([]);
  });

  it('builds the page: its three sections in order, their terms, the server\'s figures in their sentences', () => {
    const m = howPageModel(RULES);
    expect(m.title).toBe('HOW RELEASES WORK');
    expect(m.lead).toBe(HOW.lead);
    expect(m.sections.map((s) => s.title)).toEqual(['THE WAYS TO TAKE PART', 'HOW THE ORDER IS SET', 'WHAT THE HOUSE NEVER DOES']);
    expect(m.sections.map((s) => s.terms.map((t) => t.term))).toEqual([
      ['DRAW', 'EARLY ACCESS', 'LIVE RELEASE', 'THE PRIVATE SALON'],
      ['THE TIERS', 'IN A DRAW', 'IN A LIVE RELEASE'],
      ['NO PAID PRIORITY', 'NO AUCTIONS', 'A FIXED QUANTITY', 'ONE COLLECTOR, ONE ACCOUNT', 'A RETURNED PIECE'],
    ]);
    const [ways, order] = m.sections;
    expect(ways!.terms[0]!.text).toContain('A place drawn is held for you 48 hours unless the release’s page says otherwise');
    expect(ways!.terms[1]!.text).toContain('PALLADIUM owners from 4 hours before the opening, PLATINE owners from 2 hours before');
    expect(ways!.terms[1]!.text).not.toContain('48 hours');
    expect(order!.terms[0]!.rows).toEqual(['TITANE · FROM 1 PIECE', 'PLATINE · FROM 5 PIECES', 'PALLADIUM · FROM 10 PIECES']);
    // Another place held and other windows, from the server: the page follows.
    const other = howPageModel({ ...RULES, placeHeldHours: 72, earlyAccess: { PALLADIUM: 90, PLATINE: 30 } });
    expect(other.sections[0]!.terms[0]!.text).toContain('held for you 72 hours');
    expect(other.sections[0]!.terms[1]!.text).toContain('PALLADIUM owners from 90 minutes before the opening, PLATINE owners from 30 minutes before');
  });

  it('lives at /verify/releases/how, under THE RELEASES, never a release', () => {
    expect(HOW_PATH).toBe('/verify/releases/how');
    expect(releasesRouteOf(HOW_PATH)).toEqual({ release: null, how: true });
    expect(releasesRouteOf('/verify/releases/HOW/')).toEqual({ release: null, how: true });
    expect(releasesRouteOf('/verify/releases/how/x')).toEqual({ release: null });
    expect(releasesRouteOf('/verify/releases/hows')).toEqual({ release: null });
    const main = readFileSync(new URL('../../src/web/verify/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("releases.how ? 'how'");
    expect(main).toContain('HOW.documentTitle');
    expect(HOW.documentTitle).toBe('HOW RELEASES WORK · ORBES');
  });

  it('reads GET /api/v1/releases/rules, kept by the browser a minute, and refuses figures that are not whole numbers in their place', async () => {
    const answers: unknown[] = [
      RULES,
      { ...RULES, placeHeldHours: 0 },
      { ...RULES, earlyAccess: { PALLADIUM: 240 } },
      { ...RULES, tiers: RULES.tiers.slice(0, 2) },
      { ...RULES, tiers: [...RULES.tiers].reverse() },
      { ...RULES, earlyAccess: { PALLADIUM: 1.5, PLATINE: 0 } },
    ];
    const calls: { url: string; cache?: RequestCache }[] = [];
    const api = new ApiClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), cache: init?.cache });
        return new Response(JSON.stringify(answers.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    expect(await api.releaseRules()).toEqual(RULES);
    expect(calls[0]).toEqual({ url: '/api/v1/releases/rules', cache: 'default' });
    for (let i = 0; i < 5; i++) await expect(api.releaseRules()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('takes the server\'s shape as it is (services/release-rules.ts)', () => {
    const fromServer = (r: ServerReleaseRules): ReleaseRules => r;
    expect(fromServer(RULES as ServerReleaseRules)).toBe(RULES);
  });
});

describe('HOW RELEASES WORK: its words', () => {
  const all = words();

  it('is calm: no exclamation mark, never lottery, no word of BRAND §4.5', () => {
    expect(all.length).toBeGreaterThan(1500);
    expect(all).not.toContain('!');
    expect(all).not.toMatch(/lottery/i);
    expect(findForbidden(all, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });

  it('holds no contact and no "only your account" line, in its words or its view', () => {
    const view = readFileSync(new URL('../../src/web/verify/views/how.ts', import.meta.url), 'utf8');
    const model = readFileSync(new URL('../../src/web/verify/how-model.ts', import.meta.url), 'utf8');
    for (const text of [all, view, model]) {
      expect(text).not.toMatch(/only your account/i);
      expect(text).not.toContain('@');
      expect(text).not.toMatch(/mailto|tel:/i);
      expect(text).not.toMatch(/\+?\d[\d .]{7,}\d/);
    }
    expect(view).not.toMatch(/contactLines|contactBlock|writeButton|CONTACT\./);
  });

  it('types no figure the server sends: no tier threshold, no window, no place held', () => {
    const copy = readFileSync(new URL('../../src/web/verify/copy.ts', import.meta.url), 'utf8');
    // The group's code, its comments left out (they may show an example).
    const group = copy
      .slice(copy.indexOf('export const HOW = '), copy.indexOf('export const CIRCLE = '))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(group.length).toBeGreaterThan(1000);
    expect(group).not.toMatch(/\b(?:48|4|2|5|10) (?:hours?|minutes?|pieces?|PIECES?)\b/);
    // Never the place held's time for an early access.
    expect(earlyText(RULES.earlyAccess.PALLADIUM, RULES.earlyAccess.PLATINE)).not.toContain('48 hours');
  });

  it('names the order of a draw as RELEASES.rule does: tier, then seniority, then the seed; a LIVE RELEASE\'s as LIVE.rule: tier, then chance', () => {
    const at = (text: string, ...keys: string[]) => keys.map((k) => text.toLowerCase().indexOf(k));
    const how = at(HOW.order.draw.text, 'tier', 'seniority', 'seed');
    const rule = at(RELEASES.rule, 'tier', 'seniority', 'seed');
    for (const order of [how, rule]) {
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    const live = at(HOW.order.live.text, 'by tier', 'at random');
    const liveRule = at(LIVE.rule(true), 'by tier', 'at random');
    for (const order of [live, liveRule]) {
      expect(order.every((i) => i >= 0)).toBe(true);
      expect(order[0]).toBeLessThan(order[1]!);
    }
    // The guaranteed places first, as both rules say (IN-01).
    expect(HOW.order.draw.text).toMatch(/^Places guaranteed by ORBES are selected first/);
    expect(HOW.order.live.text).toMatch(/^Places guaranteed by ORBES come first in their size/);
    // The LIVE seed is not said (§6).
    expect(HOW.order.live.text).not.toMatch(/seed/i);
  });
});
