/**
 * The console's part of step S8 of LIVE RELEASE+, pure (web/admin/model/live.ts, model/best-time.ts) and its API client:
 *
 *  - the question after (choice 11): its bounds and default mirror the server's; its dialog's values, what it would
 *    refuse and what it sends (the default question as null and null); its line, its state and its answers counted;
 *  - the release's stock location (choice 16) with its sizes and at creation;
 *  - the size mix proposed at creation (choice 13) written as the sizes' lines; the feasibility check (choice 12) in a line;
 *  - the best time to open (choice 10): the tiers and country read from the address, the headline, the release's T0,
 *    the 24 columns, the table's hours and the countries;
 *  - the client's paths.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_QUESTION_DEFAULT as SERVER_QUESTION_DEFAULT } from '../../src/server/services/live.js';
import { LIVE_QUESTION_LIMITS, LIVE_QUESTION_OPEN_DAYS } from '../../src/server/services/question.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  BEST_TIME_TIERS,
  bestTimeCountry,
  bestTimeCountryBars,
  bestTimeHeadline,
  bestTimeReleaseLine,
  bestTimeRows,
  bestTimeTier,
  bestTimeWho,
  hourColumns,
  hourText,
  shareText,
} from '../../src/web/admin/model/best-time.js';
import {
  feasibilityLine,
  LIVE_LIMITS,
  LIVE_QUESTION_DEFAULT,
  livePartChange,
  livePartProblem,
  livePartValues,
  newLiveInput,
  newLiveValues,
  questionAnswers,
  questionLine,
  questionStateLine,
  questionTallyRows,
  sizeMixLine,
  sizeMixText,
} from '../../src/web/admin/model/live.js';
import type { BestTime, LiveQuestion, LiveRelease } from '../../src/web/admin/types.js';

const ID = '0f8e7d6c-5b4a-4321-8fed-cba987654321';
const DEFAULT_ANSWERS = ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'];

function question(o: Partial<LiveQuestion> = {}): LiveQuestion {
  return {
    text: 'WHAT WOULD YOU HAVE WANTED?',
    answers: [...DEFAULT_ANSWERS],
    custom: false,
    enabled: true,
    state: 'WAITING',
    opensAt: null,
    closesAt: null,
    asked: { tookPart: 0, interest: 0 },
    answered: 0,
    tally: DEFAULT_ANSWERS.map((label, i) => ({ answer: i + 1, label, count: 0 })),
    ...o,
  };
}

/** The fields of a release the parts read. */
const release = (o: Partial<LiveRelease> = {}) => ({ question: question(), locationId: null, location: { id: 'l1', name: 'FRANCE WAREHOUSE' }, sizes: [{ id: 's52', label: '52', stock: 3 }], quantity: 3, quantityLine: '3 PIECES', ...o }) as unknown as LiveRelease;

describe('the question after in the console', () => {
  it('mirrors the server: its bounds, its default words, a week open', () => {
    expect(LIVE_LIMITS.question).toEqual({ ...LIVE_QUESTION_LIMITS });
    expect({ text: LIVE_QUESTION_DEFAULT.text, answers: [...LIVE_QUESTION_DEFAULT.answers] }).toEqual({ text: SERVER_QUESTION_DEFAULT.text, answers: [...SERVER_QUESTION_DEFAULT.answers] });
    expect(LIVE_QUESTION_OPEN_DAYS).toBe(7);
    expect(questionStateLine(question())).toBe('Asked at the release’s end, for 7 days');
  });

  it('fills its dialog with the question asked, one answer per line, and sends only what changed: the default as null and null', () => {
    const r = release();
    const v = livePartValues(r, 'question');
    expect(v).toEqual({ enabled: 'true', text: 'WHAT WOULD YOU HAVE WANTED?', answers: 'ANOTHER SIZE\nANOTHER FINISH\nANOTHER PRICE BAND' });
    expect(livePartChange(r, 'question', v)).toEqual({});
    expect(livePartChange(r, 'question', { ...v, enabled: '' })).toEqual({ questionEnabled: false });
    expect(livePartChange(r, 'question', { enabled: 'true', text: ' WHICH  FINISH? ', answers: 'GOLD\n\n  SILVER \n' })).toEqual({ questionText: 'WHICH FINISH?', questionAnswers: ['GOLD', 'SILVER'] });
    // Emptied: the default question.
    const custom = release({ question: question({ custom: true, text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER'] }) });
    expect(livePartValues(custom, 'question')).toEqual({ enabled: 'true', text: 'WHICH FINISH?', answers: 'GOLD\nSILVER' });
    expect(livePartChange(custom, 'question', { enabled: 'true', text: '', answers: '' })).toEqual({ questionText: null, questionAnswers: null });
    // The default's own words typed back: the default, so nothing changes on a default question.
    expect(livePartChange(custom, 'question', { enabled: 'true', text: 'WHAT WOULD YOU HAVE WANTED?', answers: DEFAULT_ANSWERS.join('\n') })).toEqual({ questionText: null, questionAnswers: null });
    expect(livePartChange(r, 'question', { enabled: 'true', text: 'WHAT WOULD YOU HAVE WANTED?', answers: DEFAULT_ANSWERS.join('\n') })).toEqual({});
    // Turned off, its words kept in the dialog.
    expect(livePartValues(release({ question: question({ enabled: false }) }), 'question').enabled).toBe('');
    expect(questionAnswers(' A \r\nB\n\n')).toEqual(['A', 'B']);
  });

  it('refuses before sending what the server would: both or neither, 2 to 6 answers of one line, each once', () => {
    const r = release();
    const ok = { enabled: 'true', text: 'WHICH FINISH?', answers: 'GOLD\nSILVER' };
    expect(livePartProblem(r, 'question', ok)).toBeNull();
    expect(livePartProblem(r, 'question', { enabled: 'true', text: '', answers: '' })).toBeNull();
    expect(livePartProblem(r, 'question', { ...ok, text: '' })).toBe('The question is one line of 1 to 120 characters (empty with no answer: the default question).');
    expect(livePartProblem(r, 'question', { ...ok, text: 'x'.repeat(121) })).toMatch(/^The question is one line of 1 to 120/);
    expect(livePartProblem(r, 'question', { ...ok, answers: 'GOLD' })).toBe('The question has 2 to 6 answers, one per line.');
    expect(livePartProblem(r, 'question', { ...ok, answers: 'A\nB\nC\nD\nE\nF\nG' })).toBe('The question has 2 to 6 answers, one per line.');
    expect(livePartProblem(r, 'question', { ...ok, answers: 'A\nB\nC\nD\nE\nF' })).toBeNull();
    expect(livePartProblem(r, 'question', { ...ok, answers: `GOLD\n${'x'.repeat(41)}` })).toBe(`An answer has at most 40 characters: ${'x'.repeat(41)}.`);
    expect(livePartProblem(r, 'question', { ...ok, answers: 'GOLD\ngold' })).toBe('The answer gold is listed twice.');
  });

  it('says the question, where it stands and each answer counted', () => {
    expect(questionLine(question())).toBe('WHAT WOULD YOU HAVE WANTED? · ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND (the default question)');
    expect(questionLine(question({ custom: true, text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER'] }))).toBe('WHICH FINISH? · GOLD · SILVER');
    expect(questionLine(question({ enabled: false }))).toBe('Not asked');
    expect(questionStateLine(question({ state: 'OFF' }))).toBe('Not asked');
    expect(questionStateLine(question({ state: 'OPEN', closesAt: '2026-11-17T19:00:00.000Z' }))).toBe('Open until 17 NOV 2026 · 19:00 UTC');
    expect(questionStateLine(question({ state: 'CLOSED', closesAt: '2026-11-17T19:00:00.000Z' }))).toBe('Closed on 17 NOV 2026 · 19:00 UTC');
    const counted = question({ state: 'OPEN', answered: 4, tally: [{ answer: 1, label: 'ANOTHER SIZE', count: 3 }, { answer: 2, label: 'ANOTHER FINISH', count: 0 }, { answer: 3, label: 'ANOTHER PRICE BAND', count: 1 }] });
    expect(questionTallyRows(counted)).toEqual([
      { key: '1', label: 'ANOTHER SIZE', value: 3, fraction: 1, share: '75%', tone: 'solid' },
      { key: '2', label: 'ANOTHER FINISH', value: 0, fraction: 0, share: '0%', tone: 'solid' },
      { key: '3', label: 'ANOTHER PRICE BAND', value: 1, fraction: 1 / 3, share: '25%', tone: 'solid' },
    ]);
    expect(questionTallyRows(question()).map((x) => [x.fraction, x.share])).toEqual([[0, '0%'], [0, '0%'], [0, '0%']]);
  });
});

describe('the release and the stock in the console', () => {
  it('names the stock location at creation and with the sizes: empty is the default one', () => {
    const v = newLiveValues(new Date('2026-11-09T09:00:00.000Z'));
    expect(v.locationId).toBe('');
    const base = { ...v, modelId: 'm1', title: 'T', price: '4800' };
    expect(newLiveInput(base)).not.toHaveProperty('stockLocationId');
    expect(newLiveInput({ ...base, locationId: 'l2' })).toMatchObject({ stockLocationId: 'l2' });
    const r = release();
    const sizes = livePartValues(r, 'sizes');
    expect(sizes.locationId).toBe('');
    expect(livePartChange(r, 'sizes', sizes)).toEqual({});
    expect(livePartChange(r, 'sizes', { ...sizes, locationId: 'l2' })).toEqual({ stockLocationId: 'l2' });
    expect(livePartChange(release({ locationId: 'l2' }), 'sizes', { ...sizes, locationId: '' })).toEqual({ stockLocationId: null });
  });

  it('writes the size mix as the sizes’ lines and says where each size’s pieces come from', () => {
    const mix = {
      sizes: [
        { label: '52', stock: 4, fromStock: 4, fromDemand: 0 },
        { label: '54', stock: 5, fromStock: 1, fromDemand: 4 },
        { label: '56', stock: 3, fromStock: 0, fromDemand: 3 },
      ],
    };
    expect(sizeMixText(mix)).toBe('52 = 4\n54 = 5\n56 = 3');
    expect(sizeMixLine(mix)).toBe('52 = 4 (4 in stock) · 54 = 5 (1 in stock, 4 to make) · 56 = 3 (3 to make)');
    expect(sizeMixText({ sizes: [] })).toBeNull();
  });

  it('says the feasibility check in one line', () => {
    expect(feasibilityLine({ short: 0, location: { id: 'l1', name: 'FRANCE WAREHOUSE' } })).toBe('Every piece on sale is covered at FRANCE WAREHOUSE.');
    expect(feasibilityLine({ short: 1, location: { id: 'l1', name: 'FRANCE WAREHOUSE' } })).toBe('1 piece on sale would be made to order once sold (FRANCE WAREHOUSE).');
    expect(feasibilityLine({ short: 5, location: null })).toBe('5 pieces on sale would be made to order once sold (no location).');
  });
});

describe('the best time to open in the console', () => {
  const hours = (fill: Record<number, Partial<BestTime['hours'][number]>>): BestTime['hours'] =>
    Array.from({ length: 24 }, (_, hour) => ({ hour, signIns: 0, scans: 0, activity: 0, byTier: [0, 0, 0, 0], past: { releases: 0, present: 0 }, ...fill[hour] }));
  const best: BestTime = {
    days: 30,
    from: '2026-10-11T13:00:00.000Z',
    to: '2026-11-10T13:00:00.000Z',
    minTier: 2,
    country: null,
    hours: hours({ 8: { signIns: 1, activity: 1, byTier: [1, 0, 1, 0] }, 19: { signIns: 2, scans: 1, activity: 3, byTier: [0, 0, 3, 0], past: { releases: 1, present: 1 } }, 21: { byTier: [2, 0, 0, 0] } }),
    countries: [
      { country: 'FR', activity: 3, peakHour: 19 },
      { country: 'ZZ', activity: 1, peakHour: 8 },
    ],
    total: 4,
    suggested: { hour: 19, activity: 3, share: 0.75 },
    release: { hour: 20, activity: 0, share: 0 },
    pastReleases: 1,
    reasoning: [],
  };

  it('reads the tier and the country from the address, everyone and everywhere by default', () => {
    expect(BEST_TIME_TIERS.map((t) => [t.tier, t.label])).toEqual([[0, 'Everyone'], [1, 'From TITANE'], [2, 'From PLATINE'], [3, 'PALLADIUM']]);
    expect([bestTimeTier({}), bestTimeTier({ tier: '2' }), bestTimeTier({ tier: '4' }), bestTimeTier({ tier: 'x' })]).toEqual([0, 2, 0, 0]);
    expect([bestTimeCountry({}), bestTimeCountry({ country: ' fr ' }), bestTimeCountry({ country: 'FRA' })]).toEqual([null, 'FR', null]);
  });

  it('says the suggested hour, Paris time, with its share of the tiers’ activity, and the release’s T0 beside it', () => {
    expect([hourText(8), hourText(19), shareText(0.234)]).toEqual(['08:00', '19:00', '23 %']);
    expect(bestTimeWho(best)).toBe('collectors from PLATINE');
    expect(bestTimeWho({ minTier: 0, country: 'FR' })).toBe('every collector in FR · France');
    expect(bestTimeHeadline(best)).toBe('19:00 Paris · 75 % of the activity of collectors from PLATINE');
    expect(bestTimeHeadline({ ...best, suggested: null })).toBe('No activity counted in these days: no hour stands out yet.');
    expect(bestTimeReleaseLine(best)).toBe('Its T0 · 20:00 Paris · 0 % of that activity');
    expect(bestTimeReleaseLine({ release: null })).toBeNull();
  });

  it('draws the 24 hours against the busiest, lists the hours with anything to say and the countries with their busiest hour', () => {
    const cols = hourColumns(best);
    expect(cols).toHaveLength(24);
    expect(cols[19]).toEqual({ hour: 19, value: 3, fraction: 1, suggested: true, release: false, past: true, label: '19:00: 3, suggested' });
    expect(cols[20]).toEqual({ hour: 20, value: 0, fraction: 0, suggested: false, release: true, past: false, label: '20:00: 0, its T0' });
    expect(cols[8]!.fraction).toBeCloseTo(1 / 3);
    // 21:00 has activity from other tiers only: still a row of the table.
    expect(bestTimeRows(best).map((h) => h.hour)).toEqual([8, 19, 21]);
    expect(bestTimeCountryBars(best)).toEqual([
      { key: 'FR', label: 'FR · France · 19:00', value: 3, fraction: 1, share: '75%', tone: 'solid' },
      { key: 'ZZ', label: 'Unknown location · 08:00', value: 1, fraction: 1 / 3, share: '25%', tone: 'solid' },
    ]);
  });
});

describe('AdminApi: step S8', () => {
  it('reads the best time, the feasibility check and the size mix on their paths', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch, onUnauthorized: () => {} });
    await api.bestTime({ days: 90, tier: 2, country: 'FR' });
    await api.bestTime();
    await api.liveBestTime(ID, { days: 30 });
    await api.liveFeasibility(ID);
    await api.liveSizeMix('m1', 'l2');
    await api.liveSizeMix('m1', null);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/analytics/best-time?days=90&tier=2&country=FR',
      'GET /api/admin/analytics/best-time',
      `GET /api/admin/live/${ID}/best-time?days=30`,
      `GET /api/admin/live/${ID}/feasibility`,
      'GET /api/admin/live/size-mix?modelId=m1&locationId=l2',
      'GET /api/admin/live/size-mix?modelId=m1',
    ]);
  });
});
