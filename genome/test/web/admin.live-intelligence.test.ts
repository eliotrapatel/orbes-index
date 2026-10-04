/**
 * The intelligence of a LIVE RELEASE in the console, pure (web/admin/model/live-intelligence.ts) and its API client
 * (web/admin/api.ts): the readings each stage shows; the enums mirrored from the server; figures written as the server
 * writes them in its reasoning (a length of time the same); the sell-out forecast in words; the funnel's bars; the
 * comparison's columns; no figure in a label the display face sets; the client's paths and the report's CSV saved.
 */
import { describe, expect, it } from 'vitest';
import { BOT_SIGNS, duration, LIVE_ALERT_KINDS as SERVER_ALERT_KINDS } from '../../src/server/services/live-insights.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  clockText,
  durationText,
  funnelBars,
  LIVE_ALERT_LABELS,
  LIVE_BOT_SIGN_LABELS,
  LIVE_COMPARISON_COLUMNS,
  LIVE_FUNNEL_LABELS,
  liveReadings,
  pressureText,
  rangeText,
  sellOutText,
  shareText,
} from '../../src/web/admin/model/live-intelligence.js';
import { LIVE_ALERT_KINDS, LIVE_BOT_SIGNS, type LiveComparedRelease } from '../../src/web/admin/types.js';

const ID = '0f8e7d6c-5b4a-4321-8fed-cba987654321';

describe('the readings of a LIVE RELEASE, stage by stage', () => {
  it('plans before the announcement, forecasts until T0, watches from the room, reports once ended, compares always', () => {
    expect(liveReadings({ phase: 'DRAFT', editable: true })).toEqual(['plan', 'forecast', 'comparison']);
    expect(liveReadings({ phase: 'HIDDEN', editable: true })).toEqual(['plan', 'forecast', 'comparison']);
    expect(liveReadings({ phase: 'ANNOUNCED', editable: false })).toEqual(['forecast', 'radar', 'comparison']);
    expect(liveReadings({ phase: 'ROOM', editable: false })).toEqual(['forecast', 'radar', 'bots', 'comparison']);
    expect(liveReadings({ phase: 'LIVE', editable: false })).toEqual(['bots', 'comparison']);
    expect(liveReadings({ phase: 'ENDED', editable: false })).toEqual(['report', 'collectors', 'bots', 'comparison']);
    expect(liveReadings({ phase: 'CANCELLED', editable: false })).toEqual([]);
  });

  it('mirrors the server\'s three alerts and four signs, each named without a figure', () => {
    expect([...LIVE_ALERT_KINDS]).toEqual([...SERVER_ALERT_KINDS]);
    expect([...LIVE_BOT_SIGNS]).toEqual([...BOT_SIGNS]);
    expect(Object.keys(LIVE_ALERT_LABELS)).toEqual([...LIVE_ALERT_KINDS]);
    expect(Object.keys(LIVE_BOT_SIGN_LABELS)).toEqual([...LIVE_BOT_SIGNS]);
    // Set in the display face (column heads, marks' labels): never a figure, never the lexicon's forbidden words.
    const labels = [...Object.values(LIVE_ALERT_LABELS), ...Object.values(LIVE_BOT_SIGN_LABELS), ...Object.values(LIVE_FUNNEL_LABELS), ...LIVE_COMPARISON_COLUMNS.map((c) => c.label)];
    for (const l of labels) expect(l, l).not.toMatch(/\d|!|\bALERT\b|\bWARNING\b|\bproducts?\b|\btokens?\b/i);
  });
});

describe('the intelligence\'s figures in the console', () => {
  it('writes shares, pressures, lengths of time and instants', () => {
    expect(shareText(0.4166)).toBe('42 %');
    expect(shareText(null)).toBe('—');
    expect(pressureText(7 / 3)).toBe('2.33');
    expect(pressureText(null)).toBe('—');
    for (const ms of [0, 35_000, 60_000, 245_000, 3_600_000, 3_720_000]) expect(durationText(ms)).toBe(duration(ms));
    expect(durationText(null)).toBe('—');
    expect(clockText('2026-11-02T10:09:05.000Z')).toBe('10:09:05 UTC');
    expect(clockText('2026-11-02T10:09:05.000Z', false)).toBe('10:09:05');
    expect(clockText(null)).toBe('—');
    expect(rangeText({ low: 750, high: 1500 })).toBe('750 – 1\u2009500');
    expect(rangeText({ low: 4, high: 4 })).toBe('4');
  });

  it('says the sell-out forecast in a few words, outlook by outlook', () => {
    const at = '2026-11-02T10:10:00.000Z';
    expect(sellOutText({ outlook: 'SOLD_OUT', at, expectedLeft: null })).toBe('Sold out at 10:10:00 UTC');
    expect(sellOutText({ outlook: 'SELLS_OUT', at, expectedLeft: null })).toBe('Sold out about 10:10:00 UTC');
    expect(sellOutText({ outlook: 'LINE_SHORT', at: null, expectedLeft: 2 })).toBe('About 2 left once the line is served');
    expect(sellOutText({ outlook: 'CLOSE_FIRST', at: null, expectedLeft: 1 })).toBe('About 1 left at the close');
    expect(sellOutText({ outlook: 'PARTIAL', at: null, expectedLeft: 3 })).toBe('About 3 left');
    expect(sellOutText({ outlook: 'NO_PACE', at: null, expectedLeft: null })).toBe('No pace yet');
  });

  it('draws the funnel as bars against its largest step, each its share of the step before', () => {
    const bars = funnelBars([
      { step: 'INTEREST', people: 12, share: null },
      { step: 'ROOM', people: 9, share: 0.75 },
      { step: 'TURN', people: 6, share: 6 / 9 },
      { step: 'SECURED', people: 5, share: 5 / 6 },
      { step: 'CONFIRMED', people: 4, share: 0.8 },
      { step: 'CONCLUDED', people: 0, share: 0 },
    ]);
    expect(bars.map((b) => [b.label, b.value, b.fraction, b.share])).toEqual([
      ['I’LL BE THERE', 12, 1, ''],
      ['ENTERED', 9, 0.75, '75 %'],
      ['HAD A TURN', 6, 0.5, '67 %'],
      ['HELD THE SEAL', 5, 5 / 12, '83 %'],
      ['PRESSED PAY', 4, 4 / 12, '80 %'],
      ['CONCLUDED', 0, 0, '0 %'],
    ]);
  });

  it('sets the releases side by side, figure by figure', () => {
    const x: LiveComparedRelease = {
      id: ID,
      title: 'THE MONOLITHE RING',
      current: true,
      opensAt: '2026-11-02T10:00:00.000Z',
      endedReason: 'CLOSED',
      currency: 'EUR',
      priceMinor: 480_000,
      stock: 5,
      added: 1,
      interest: 12,
      room: 9,
      presentAtT0: 8,
      turns: 6,
      secured: 5,
      confirmedPieces: 4,
      sellThrough: 0.8,
      sellOutMs: null,
      missedShare: 1 / 6,
      expired: 1,
      conversion: 2 / 3,
      piecesRevenueMinor: 1_920_000,
      addonsRevenueMinor: 30_000,
    };
    expect(LIVE_COMPARISON_COLUMNS.map((c) => [c.label, c.cell(x)])).toEqual([
      ['Pieces', '5 (1 added)'],
      ['Price', '€ 4 800'],
      ['Interest', '12'],
      ['Room', '9'],
      ['Line at the opening', '8'],
      ['Turns', '6'],
      ['Confirmed', '4'],
      ['Sell-through', '80 %'],
      ['Sold out in', '—'],
      ['Missed', '17 %'],
      ['Revenue', '€ 19 500'],
    ]);
  });
});

describe('AdminApi: the intelligence', () => {
  it('reads each reading on its path, and saves the report\'s CSV', async () => {
    const calls: string[] = [];
    const answers: Response[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push(`${init.method} ${url}`);
      return answers.shift() ?? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch, onUnauthorized: () => undefined });
    await api.liveReleasePlan(ID);
    await api.liveAudienceForecast(ID);
    await api.liveDemandRadar(ID);
    await api.liveBotRadar(ID);
    await api.liveReport(ID);
    await api.liveCollectors(ID);
    await api.liveComparison(ID);
    answers.push(new Response('"section","item","value"\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8; header=present', 'content-disposition': 'attachment; filename="ORBES-live-0F8E7D6C-report-2026-11-10.csv"' } }));
    const csv = await api.liveReportCsv(ID);
    expect(calls).toEqual(['plan', 'forecast', 'radar', 'bots', 'report', 'collectors', 'comparison', 'report.csv'].map((p) => `GET /api/admin/live/${ID}/${p}`));
    expect(csv.filename).toBe('ORBES-live-0F8E7D6C-report-2026-11-10.csv');
    expect(await csv.blob.text()).toBe('"section","item","value"\r\n');
  });
});
