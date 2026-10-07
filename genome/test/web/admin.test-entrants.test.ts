/**
 * Test entrants and the server's status in the console (plan TEST ENTRANTS), pure (web/admin/model/test-entrants.ts,
 * model/system-status.ts), the refresh every 2 s (ui/refresh.ts) and the API client (web/admin/api.ts):
 *
 *  - the server's rows, their values and states: amber from 70 % of a limit, red from 90 %; the event loop's p99 at
 *    100 and 250 ms; the pool waiting above 0 and above 5; the disk at 75 and 80 %; the response time, the errors and
 *    the LIVE connections; unread values never a strain; the banner THE SERVER IS STRAINED and the folded line; the
 *    sparklines broken where a value was not read;
 *  - a press of SEND TEST ENTRANTS and ADD MORE: its defaults, what it sends, what the server would refuse (the total
 *    1 to 1 000, 5 000 in a test, the arrival, the shares making 100, the hold, the profile, the early access);
 *  - the phrases, when a test can start, what each role may do, the table by tier with its total, the report's checks
 *    and peaks, a test account by its email (masked or not);
 *  - the refresh: at once, then 2 s after each answer, never two reads at once, paused while the tab is hidden, stopped
 *    by a 401, by its page leaving the screen, and by a navigation;
 *  - the client's paths and bodies, a timer's read never ending the session;
 *  - the statuses and modes as the server's schema has them, and (at compile time) a test, a release's tests, the test
 *    running and the server's status read as the server's services shape them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as serverSchema from '../../src/server/db/schema.js';
import type { SystemStatusView as ServerSystemStatus } from '../../src/server/services/system-status.js';
import type { ActiveTestRun as ServerActiveTestRun, TestRunSummary as ServerTestRunSummary, TestRunView as ServerTestRunView } from '../../src/server/services/test-entrants.js';
import { AdminApi, ApiError, type FetchLike } from '../../src/web/admin/api.js';
import { can } from '../../src/web/admin/model/permissions.js';
import {
  errorsState,
  formatBytes,
  levelState,
  liveState,
  shareState,
  sparkRuns,
  STRAIN,
  statusRows,
  statusSummary,
  strainBanner,
  waitingState,
  worstState,
} from '../../src/web/admin/model/system-status.js';
import {
  checksLine,
  drawTestStart,
  isTestAccount,
  lastSettings,
  liveTestStart,
  parseCountries,
  peakRows,
  pressCount,
  reportScore,
  TEST_DEFAULTS,
  TEST_TIER_COLUMNS,
  testEntrantActions,
  testPhrase,
  testRunActions,
  testRunInput,
  testRunProblem,
  testRunValues,
  testSettingsLine,
  tierRows,
} from '../../src/web/admin/model/test-entrants.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import * as web from '../../src/web/admin/types.js';
import type { SystemSample, SystemStatus, TestRunSettings, TestRunTier } from '../../src/web/admin/types.js';
import type { VisibilitySource } from '../../src/web/admin/ui/attention.js';
import { startRefresh, stopRefreshes } from '../../src/web/admin/ui/refresh.js';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const DROP = '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d';

function sample(at = '2026-10-07T12:00:02.000Z'): SystemSample {
  return {
    at,
    app: { memBytes: 300 * MB, memLimitBytes: GB, memPeakBytes: 400 * MB, cpuCores: 0.25, cpuLimitCores: 1, throttledPct: 0, pids: 20, pidsMax: 1000 },
    host: { memAvailableBytes: 2 * GB, memTotalBytes: 4 * GB, swapUsedBytes: 0, load1: 0.42, load5: 0.38, cpuPct: 12, diskUsedPct: 42 },
    node: { heapUsedBytes: 100 * MB, heapLimitBytes: 2 * GB, rssBytes: 300 * MB, externalBytes: 5 * MB, loopDelayP50Ms: 2, loopDelayP99Ms: 14, loopUtilPct: 12 },
    live: { streams: 1024, releases: 1, accounts: 412 },
    db: { poolTotal: 10, poolIdle: 2, poolWaiting: 0, connections: 12, maxConnections: 100, active: 3, waiting: 0 },
    http: { rps: 12.4, p95Ms: 120, errors5xx: 0, refused429: 0 },
  };
}

const status = (latest: SystemSample, history: SystemSample[] = [latest]): SystemStatus => ({ now: latest.at, latest, history });

describe('the server’s status: its rows and their states', () => {
  it('says each row as the panel shows it, in its order, every state normal', () => {
    const rows = statusRows(status(sample()));
    expect(rows.map((r) => [r.label, r.value, r.note, r.state])).toEqual([
      ['APP MEMORY', '300 MB / 1.0 GB · 29 %', 'PEAK 400 MB', 'normal'],
      ['APP CPU', '0.25 / 1.00 cores · 25 %', 'THROTTLED 0 %', 'normal'],
      ['SERVER MEMORY AVAILABLE', '2.0 GB of 4.0 GB', 'SWAP USED 0 B', 'normal'],
      ['LOAD', '0.42 · 0.38', '1 AND 5 MIN · CPU 12 %', 'normal'],
      ['DISK', '42 %', 'USED ON /', 'normal'],
      ['RESPONSE TIME p95', '120 ms', 'LAST MINUTE', 'normal'],
      ['REQUESTS / s', '12.4', 'LAST MINUTE', 'normal'],
      ['ERRORS AND REFUSALS', '0 · 0', 'ERRORS (5XX) · REFUSED (429), LAST MINUTE', 'normal'],
      ['LIVE CONNECTIONS', '1\u2009024', '412 ACCOUNTS · 1 RELEASE', 'normal'],
      ['DATABASE', '12 / 100 · 12 %', 'POOL 8 OF 10 IN USE · 0 WAITING', 'normal'],
      ['EVENT LOOP DELAY p99', '14 ms', 'p50 2 ms · BUSY 12 %', 'normal'],
      ['HEAP', '100 MB / 2.0 GB · 5 %', 'RESIDENT 300 MB', 'normal'],
    ]);
    expect(strainBanner(rows)).toBeNull();
    expect(statusSummary(rows, '2026-10-07T12:00:02.000Z')).toBe('NORMAL · 07 OCT 2026 · 12:00:02 UTC');
  });

  it('is amber from 70 % of a limit and red from 90 %, the runbook’s and the spec’s own thresholds elsewhere', () => {
    expect([shareState(69, 100), shareState(70, 100), shareState(89.9, 100), shareState(90, 100), shareState(120, 100)]).toEqual(['normal', 'amber', 'amber', 'red', 'red']);
    // Without a limit, a value read is normal; nothing read is unknown, never a strain.
    expect([shareState(5, null), shareState(null, 100), shareState(null, null)]).toEqual(['normal', 'unknown', 'unknown']);
    expect([99, 100, 249, 250].map((ms) => levelState(ms, STRAIN.loopDelayMs))).toEqual(['normal', 'amber', 'amber', 'red']);
    expect([74, 75, 79, 80].map((p) => levelState(p, STRAIN.diskPct))).toEqual(['normal', 'amber', 'amber', 'red']);
    expect([299, 300, 999, 1000].map((ms) => levelState(ms, STRAIN.p95Ms))).toEqual(['normal', 'amber', 'amber', 'red']);
    expect([0, 1, 5, 6, null].map(waitingState)).toEqual(['normal', 'amber', 'amber', 'red', 'unknown']);
    expect([errorsState(0, 0), errorsState(0, 1), errorsState(1, 0), errorsState(5, 40), errorsState(6, 0), errorsState(null, null)]).toEqual(['normal', 'amber', 'amber', 'amber', 'red', 'unknown']);
    expect([liveState(500), liveState(501), liveState(null)]).toEqual(['normal', 'amber', 'unknown']);
    expect([worstState('normal', 'amber'), worstState('red', 'unknown'), worstState()]).toEqual(['amber', 'red', 'unknown']);
  });

  it('puts THE SERVER IS STRAINED over the panel with its red rows; the folded line names them, or the amber ones', () => {
    const s = sample();
    s.app.memBytes = 0.95 * GB;
    s.db.poolWaiting = 6;
    s.node.loopDelayP99Ms = 120;
    const rows = statusRows(status(s));
    const state = (id: string) => rows.find((r) => r.id === id)?.state;
    expect([state('app-memory'), state('database'), state('loop'), state('heap')]).toEqual(['red', 'red', 'amber', 'normal']);
    expect(strainBanner(rows)).toBe('THE SERVER IS STRAINED: APP MEMORY, DATABASE');
    expect(statusSummary(rows, s.at)).toBe('STRAINED: APP MEMORY, DATABASE · 07 OCT 2026 · 12:00:02 UTC');

    const watch = sample();
    watch.host.diskUsedPct = 76;
    watch.http.refused429 = 3;
    const amber = statusRows(status(watch));
    expect(strainBanner(amber)).toBeNull();
    expect(statusSummary(amber, null)).toBe('TO WATCH: DISK, ERRORS AND REFUSALS');

    // The server's CPU drives LOAD; the database's connections against its maximum, as the pool's waiting.
    const busy = sample();
    busy.host.cpuPct = 91;
    busy.db.connections = 75;
    const b = statusRows(status(busy));
    expect([b.find((r) => r.id === 'load')?.state, b.find((r) => r.id === 'database')?.state]).toEqual(['red', 'amber']);
  });

  it('never calls a strain what this server cannot read (macOS, PGlite): unknown, said so', () => {
    const s = sample();
    s.app = { memBytes: null, memLimitBytes: null, memPeakBytes: null, cpuCores: null, cpuLimitCores: null, throttledPct: null, pids: null, pidsMax: null };
    s.host = { memAvailableBytes: null, memTotalBytes: null, swapUsedBytes: null, load1: null, load5: null, cpuPct: null, diskUsedPct: null };
    s.db = { poolTotal: null, poolIdle: null, poolWaiting: null, connections: null, maxConnections: null, active: null, waiting: null };
    const rows = statusRows(status(s));
    for (const id of ['app-memory', 'app-cpu', 'server-memory', 'load', 'disk', 'database']) {
      const r = rows.find((x) => x.id === id)!;
      expect([r.value, r.note, r.state], id).toEqual(['—', 'NOT READ ON THIS SERVER', 'unknown']);
    }
    expect(rows.find((r) => r.id === 'heap')?.state).toBe('normal');
    expect(strainBanner(rows)).toBeNull();
    // Before the first sample, nothing is known.
    const none = statusRows({ now: s.at, latest: null, history: [] });
    expect(none.every((r) => r.state === 'unknown')).toBe(true);
    expect(statusSummary(none, null)).toBe('NOT READ YET');
  });

  it('draws 10 minutes of each row, scaled to its limit, a line broken where a value was not read', () => {
    const a = sample('2026-10-07T12:00:00.000Z');
    const b = sample('2026-10-07T12:00:02.000Z');
    const c = sample('2026-10-07T12:00:04.000Z');
    b.app.memBytes = null;
    c.app.memBytes = 512 * MB;
    const mem = statusRows(status(c, [a, b, c])).find((r) => r.id === 'app-memory')!;
    expect(mem.series).toEqual([300 * MB, null, 512 * MB]);
    expect(mem.ceiling).toBe(GB);
    expect(sparkRuns(mem.series, mem.ceiling)).toEqual([[{ x: 0, y: 300 / 1024 }], [{ x: 1, y: 0.5 }]]);
    expect(sparkRuns([1, 2, 4], 4)).toEqual([[{ x: 0, y: 0.25 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]]);
    expect(sparkRuns([], 1)).toEqual([]);
    // Without a limit, its busiest value; the response time against its 300 ms at least.
    const rps = statusRows(status(c, [a, c])).find((r) => r.id === 'requests')!;
    expect(rps.ceiling).toBe(12.4);
    expect(statusRows(status(c)).find((r) => r.id === 'response')?.ceiling).toBe(300);
  });

  it('says sizes as the console does (1 024-based)', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(3.5 * MB), formatBytes(300 * MB), formatBytes(1.5 * GB), formatBytes(null)]).toEqual(['512 B', '2 KB', '3.5 MB', '300 MB', '1.5 GB', '—']);
  });
});

/** The dialog's values as a draw's dialog holds them: none of a LIVE RELEASE's fields. */
function drawValues(over: Record<string, string> = {}): Record<string, string> {
  const v = testRunValues();
  for (const k of ['interestPct', 'payPct', 'releasePct', 'missPct', 'leavePct', 'holdSeconds', 'size', 'quantity', 'addOnsPct']) delete v[k];
  return { ...v, ...over };
}

describe('a press of SEND TEST ENTRANTS and ADD MORE', () => {
  it('starts from the owner’s defaults and sends every group with the phrase', () => {
    expect(TEST_DEFAULTS).toEqual({
      tiers: { none: 0, titane: 100, platine: 0, palladium: 0 },
      arrival: { mode: 'burst', seconds: 10, interestPct: 0 },
      behaviour: { payPct: 70, releasePct: 20, missPct: 10, leavePct: 0, holdSeconds: 1.5, withdrawPct: 0, reservePct: 0, confirmPct: 70 },
      choices: { size: null, quantity: 1, addOnsPct: 0 },
      profile: { seniorityMin: 0, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 720, countries: [], sharedNetworkPct: 0 },
    });
    expect(testRunInput('LIVE', testRunValues(), 'TEST 8A1D0C55')).toEqual({ phrase: 'TEST 8A1D0C55', ...TEST_DEFAULTS });
    // A LIVE RELEASE's choices typed: a size, pieces at random, a burst left for all at once (no seconds sent).
    const live = testRunInput('LIVE', { ...testRunValues(), size: 's52', quantity: '', arrival: 'all', holdSeconds: '2,25', countries: 'fr, JP fr', 'tier:none': '', 'tier:palladium': '20' }, 'TEST 8A1D0C55');
    expect(live.choices).toEqual({ size: 's52', quantity: null, addOnsPct: 0 });
    expect(live.arrival).toEqual({ mode: 'all', interestPct: 0 });
    expect(live.behaviour.holdSeconds).toBe(2.25);
    expect(live.profile.countries).toEqual(['FR', 'JP']);
    expect(live.tiers).toEqual({ none: 0, titane: 100, platine: 0, palladium: 20 });
    // A draw's: no size, no add-ons, no I'LL BE THERE; the LIVE behaviour at its defaults.
    const draw = testRunInput('DRAW', drawValues({ reservePct: '40', confirmPct: '100' }), 'TEST 8A1D0C55');
    expect(draw.choices).toEqual({ size: null, quantity: 1, addOnsPct: 0 });
    expect(draw.arrival).toEqual({ mode: 'burst', seconds: 10, interestPct: 0 });
    expect(draw.behaviour).toEqual({ ...TEST_DEFAULTS.behaviour, reservePct: 40, confirmPct: 100 });
  });

  it('refuses what the server would, before anything is sent', () => {
    const live = (over: Record<string, string>, opts = {}) => testRunProblem('LIVE', { ...testRunValues(), ...over }, opts);
    const draw = (over: Record<string, string>, opts = {}) => testRunProblem('DRAW', drawValues(over), opts);
    expect([live({}), draw({})]).toEqual([null, null]);
    expect(live({ 'tier:titane': '0' })).toBe('Send at least 1 test entrant.');
    expect(live({ 'tier:titane': '' })).toBe('Send at least 1 test entrant.');
    expect(live({ 'tier:titane': 'ten' })).toBe('Type a whole number of test entrants for each tier (0, or empty, for none).');
    expect(live({ 'tier:titane': '1001' })).toBe('At most 1\u2009000 test entrants per press: 1\u2009001 now.');
    expect(live({ 'tier:titane': '600', 'tier:palladium': '400' })).toBeNull();
    expect(live({}, { already: 4950 })).toBe('A test holds at most 5\u2009000 test entrants: 50 more at most.');
    expect(live({ 'tier:titane': '50' }, { already: 4950 })).toBeNull();
    expect(draw({ arrival: 'before' })).toBe('Choose how the test entrants arrive.');
    expect(live({ arrival: 'before', seconds: '' })).toBeNull();
    expect([live({ seconds: '0' }), live({ seconds: '3601' }), live({ arrival: 'all', seconds: '' })]).toEqual(['A burst lasts 1 to 3\u2009600 seconds.', 'A burst lasts 1 to 3\u2009600 seconds.', null]);
    expect(live({ missPct: '5' })).toBe('PAY, RELEASE, MISS and LEAVE make 100 % together: 95 % now.');
    expect(live({ payPct: '101' })).toBe('PAY, RELEASE, MISS and LEAVE are each 0 to 100 %.');
    expect([live({ holdSeconds: '1.4' }), live({ holdSeconds: '10.5' }), live({ holdSeconds: '10' }), live({ holdSeconds: '1,5' })]).toEqual([
      'The seal is held 1.5 to 10 seconds.',
      'The seal is held 1.5 to 10 seconds.',
      null,
      null,
    ]);
    expect([live({ quantity: '6' }), live({ quantity: '' }), live({ quantity: '5' })]).toEqual(['Each takes 1 to 5 pieces, or a number at random.', null, null]);
    expect(live({ interestPct: '120' })).toBe('The share that says I’LL BE THERE is 0 to 100 %.');
    expect(draw({ confirmPct: '' })).toBe('The share that confirms by itself is 0 to 100 %.');
    // A draw in its early access only: a test needs PLATINE and PALLADIUM that reserve.
    expect(draw({}, { earlyOnly: true })).toBe('Only the early access is open: set a share of PLATINE and PALLADIUM that reserves.');
    expect(draw({ reservePct: '50' }, { earlyOnly: true })).toBeNull();
    expect(live({ seniorityMin: '5', seniorityMax: '3' })).toBe('Seniority runs from 0 to 50 years, from the lower to the higher.');
    expect(live({ seniorityMax: '51' })).toBe('Seniority runs from 0 to 50 years, from the lower to the higher.');
    expect(live({ ageMax: '3651' })).toBe('An account’s age runs from 0 to 3\u2009650 days, from the lower to the higher.');
    expect(live({ countries: 'FR, jp; usa' })).toBe('USA is not a country’s two letters (FR, JP).');
    expect(live({ sharedNetworkPct: '' })).toBe('The share on one shared network is 0 to 100 %.');
    expect(parseCountries(' fr, JP  fr;us ')).toEqual(['FR', 'JP', 'US']);
    expect(parseCountries('')).toEqual([]);
  });

  it('starts ADD MORE from the run’s last press, whichever way the server keeps its presses', () => {
    const first: TestRunSettings = { ...TEST_DEFAULTS, tiers: { none: 0, titane: 10, platine: 0, palladium: 0 } };
    const second = { tiers: { none: 0, titane: 0, platine: 0, palladium: 300 }, arrival: { mode: 'all' as const, interestPct: 0 } } as unknown as TestRunSettings;
    const run = { settings: [first, second] };
    expect(pressCount(run)).toBe(2);
    expect(lastSettings(run)).toEqual({ ...TEST_DEFAULTS, tiers: { none: 0, titane: 0, platine: 0, palladium: 300 }, arrival: { mode: 'all', seconds: 10, interestPct: 0 } });
    expect(lastSettings({ settings: first })).toEqual(first);
    expect(pressCount({ settings: first })).toBe(1);
    expect(lastSettings(null)).toEqual(TEST_DEFAULTS);
    expect(testRunValues(lastSettings(run))['tier:palladium']).toBe('300');
  });

  it('says a press’s settings in one line', () => {
    expect(testSettingsLine('DRAW', TEST_DEFAULTS)).toBe(
      '100 TITANE · a burst of 10 s · withdraw 0 % · reserve 0 % · confirm by themselves 70 % · seniority 0–3 yrs · accounts 30–720 days old · no country · shared network 0 %',
    );
    expect(testSettingsLine('LIVE', { ...TEST_DEFAULTS, tiers: { none: 5, titane: 100, platine: 0, palladium: 1 }, choices: { size: 's52', quantity: null, addOnsPct: 30 }, profile: { ...TEST_DEFAULTS.profile, countries: ['FR', 'JP'] } }, [{ id: 's52', label: '52' }])).toBe(
      '5 NO TIER + 100 TITANE + 1 PALLADIUM · a burst of 10 s · PAY 70 % · RELEASE 20 % · MISS 10 % · LEAVE 0 % · the seal held 1.5 s · size 52, pieces at random · add-ons 30 % · seniority 0–3 yrs · accounts 30–720 days old · from FR, JP · shared network 0 %',
    );
  });
});

describe('a release’s test', () => {
  it('asks to type TEST and END TEST with the release’s first 8', () => {
    expect([testPhrase('send', DROP), testPhrase('end', DROP)]).toEqual(['TEST 8A1D0C55', 'END TEST 8A1D0C55']);
  });

  it('starts while a draw is open or in its early access, and while a LIVE RELEASE’s room is open', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    const d = (state: string, earlyAccessOpensAt: string | null = null) => ({ state, earlyAccessOpensAt, opensAt: '2026-10-07T13:00:00.000Z' }) as Parameters<typeof drawTestStart>[0];
    expect(drawTestStart(d('OPEN'), now)).toMatchObject({ open: true, earlyOnly: false });
    expect(drawTestStart(d('UPCOMING', '2026-10-07T11:00:00.000Z'), now)).toMatchObject({ open: true, earlyOnly: true });
    expect(drawTestStart(d('UPCOMING', '2026-10-07T12:30:00.000Z'), now)).toMatchObject({ open: false });
    expect(drawTestStart(d('UPCOMING'), now)).toMatchObject({ open: false });
    for (const state of ['DRAFT', 'CLOSED', 'DRAWN', 'CANCELLED']) expect(drawTestStart(d(state), now), state).toEqual({ open: false, earlyOnly: false, line: 'A test starts while the draw is open, or during its early access to reserve.' });
    expect(['ROOM', 'LIVE'].map((phase) => liveTestStart({ phase, endedAt: null } as Parameters<typeof liveTestStart>[0]).open)).toEqual([true, true]);
    for (const phase of ['DRAFT', 'HIDDEN', 'ANNOUNCED', 'ENDED', 'CANCELLED']) expect(liveTestStart({ phase, endedAt: null } as Parameters<typeof liveTestStart>[0]).open, phase).toBe(false);
    expect(liveTestStart({ phase: 'LIVE', endedAt: '2026-10-07T11:59:00.000Z' }).line).toBe('A test starts once the room is open, until the release ends.');
  });

  it('lets an ADMIN send, add, stop and end; an AUDITOR and an OPERATOR only read', () => {
    const open = { open: true, earlyOnly: false, line: '' };
    const closed = { ...open, open: false };
    expect(testRunActions(null, 'ADMIN', open)).toEqual({ send: true, addMore: false, stop: false, end: false });
    expect(testRunActions(null, 'ADMIN', closed)).toEqual({ send: false, addMore: false, stop: false, end: false });
    expect(testRunActions({ status: 'RUNNING' }, 'ADMIN', open)).toEqual({ send: false, addMore: true, stop: true, end: true });
    // Only RUNNING blocks a new test; END TEST on DONE, STOPPED and INTERRUPTED.
    for (const status of ['DONE', 'STOPPED', 'INTERRUPTED'] as const) expect(testRunActions({ status }, 'ADMIN', open), status).toEqual({ send: true, addMore: false, stop: false, end: true });
    expect(testRunActions({ status: 'ENDED' }, 'ADMIN', open).end).toBe(false);
    for (const role of ['OPERATOR', 'AUDITOR', 'RETAIL'] as const) expect(testRunActions({ status: 'RUNNING' }, role, open), role).toEqual({ send: false, addMore: false, stop: false, end: false });
    expect([can('ADMIN', 'runTestEntrants'), can('OPERATOR', 'runTestEntrants'), can('AUDITOR', 'runTestEntrants')]).toEqual([true, false, false]);

    const e = { canConfirm: true, canRelease: true };
    expect(testEntrantActions({ mode: 'DRAW', status: 'DONE' }, e, 'ADMIN')).toEqual({ confirm: true, release: false });
    expect(testEntrantActions({ mode: 'LIVE', status: 'RUNNING' }, e, 'ADMIN')).toEqual({ confirm: true, release: true });
    expect(testEntrantActions({ mode: 'LIVE', status: 'RUNNING' }, { canConfirm: false, canRelease: false }, 'ADMIN')).toEqual({ confirm: false, release: false });
    expect(testEntrantActions({ mode: 'LIVE', status: 'RUNNING' }, e, 'OPERATOR')).toEqual({ confirm: false, release: false });
    expect([toneOf('testRun', 'RUNNING'), toneOf('testRun', 'STOPPED'), toneOf('testRun', 'INTERRUPTED'), toneOf('testRun', 'ENDED')]).toEqual(['solid', 'alert', 'alert', 'muted']);
  });

  it('counts its test entrants by tier, every tier in order, with their total', () => {
    const tier = (t: number, label: TestRunTier['label'], n: Partial<TestRunTier>): TestRunTier => ({ tier: t, label, entered: 0, inRoom: 0, selected: 0, confirmed: 0, lapsed: 0, released: 0, missed: 0, left: 0, withdrawn: 0, ...n });
    const rows = tierRows([tier(3, 'PALLADIUM', { entered: 20, selected: 20, confirmed: 14 }), tier(1, 'TITANE', { entered: 100, selected: 5, confirmed: 3, lapsed: 1, withdrawn: 4 })]);
    expect(rows.map((r) => r.label)).toEqual(['NO TIER', 'TITANE', 'PLATINE', 'PALLADIUM', 'TOTAL']);
    expect(rows[0].counts.entered).toBe(0);
    expect(rows[4]).toEqual({ label: 'TOTAL', total: true, counts: { entered: 120, inRoom: 0, selected: 25, confirmed: 17, lapsed: 1, released: 0, missed: 0, left: 0, withdrawn: 4 } });
    expect(TEST_TIER_COLUMNS.DRAW.map((c) => c.key)).toEqual(['entered', 'selected', 'confirmed', 'lapsed', 'withdrawn']);
    expect(TEST_TIER_COLUMNS.LIVE.map((c) => c.key)).toEqual(['entered', 'inRoom', 'selected', 'confirmed', 'released', 'missed', 'left']);
  });

  it('says its report’s checks and its peaks', () => {
    expect([checksLine({ checksPassed: 5, checksTotal: 5 }), checksLine({ checksPassed: 4, checksTotal: 5 }), checksLine({ checksPassed: null, checksTotal: null })]).toEqual(['5/5', '4/5', '—']);
    expect(reportScore({ checks: [{ id: 'a', label: 'A', pass: true, line: '' }, { id: 'b', label: 'B', pass: false, line: '' }] })).toEqual({ passed: 1, total: 2 });
    // The server's peaks (services/system-status.ts RunPeaks); a value it could not read, a dash.
    expect(peakRows({ appMemBytes: 412 * MB, appCpuCores: 0.62, p95Ms: 180, loopDelayP99Ms: 22, liveStreams: 1024, dbConnections: 14, poolWaiting: null, errors5xx: 0, refused429: 3 })).toEqual([
      { label: 'APP MEMORY', value: '412 MB' },
      { label: 'APP CPU', value: '0.62 cores' },
      { label: 'RESPONSE TIME p95', value: '180 ms' },
      { label: 'EVENT LOOP DELAY p99', value: '22 ms' },
      { label: 'LIVE CONNECTIONS', value: '1\u2009024' },
      { label: 'DATABASE CONNECTIONS', value: '14' },
      { label: 'DATABASE WAITING', value: '—' },
      { label: 'ERRORS (5XX)', value: '0' },
      { label: 'REFUSED (429)', value: '3' },
    ]);
    // Grouped peaks are read through; a name the console does not know is said from its key.
    expect(peakRows({ app: { memBytes: 2048 }, queueDepthMs: 5, note: 'x' })).toEqual([
      { label: 'APP MEMORY', value: '2 KB' },
      { label: 'QUEUE DEPTH', value: '5 ms' },
    ]);
    expect(peakRows(null)).toEqual([]);
  });

  it('knows a test account by its email, masked for an AUDITOR or not', () => {
    expect(['test-0001@orbes.test', 't***@orbes.test', ' TEST-0042@ORBES.TEST ', 'collector@example.com', 'x@orbes.testing', ''].map(isTestAccount)).toEqual([true, true, true, false, false, false]);
  });
});

describe('the refresh every 2 s (ui/refresh.ts)', () => {
  class FakeDoc implements VisibilitySource {
    hidden = false;
    private readonly listeners = new Set<() => void>();
    addEventListener(_type: 'visibilitychange', fn: () => void): void {
      this.listeners.add(fn);
    }
    removeEventListener(_type: 'visibilitychange', fn: () => void): void {
      this.listeners.delete(fn);
    }
    show(hidden: boolean): void {
      this.hidden = hidden;
      for (const fn of this.listeners) fn();
    }
    get watched(): number {
      return this.listeners.size;
    }
  }
  afterEach(() => {
    stopRefreshes();
    vi.useRealTimers();
  });

  it('reads at once, then 2 s after each answer while the tab is shown; hidden, it waits until shown again', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    let n = 0;
    const load = vi.fn(async () => ++n);
    const seen: number[] = [];
    const r = startRefresh({ load, apply: (v) => seen.push(v), everyMs: 2000, doc });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
    doc.show(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    doc.show(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([1, 2, 3]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toEqual([1, 2, 3, 4]);
    // After an action: now, then every 2 s from it.
    await r.now();
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    r.stop();
    expect(doc.watched).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('never asks a slow server twice at once, and keeps the last value when a read fails', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    let inFlight = 0;
    let most = 0;
    let calls = 0;
    const failed: unknown[] = [];
    const seen: number[] = [];
    startRefresh({
      load: async () => {
        calls++;
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        inFlight--;
        if (calls === 2) throw new ApiError(503, 'UNAVAILABLE', 'Down.');
        return calls;
      },
      apply: (v) => seen.push(v),
      failed: (e) => failed.push(e),
      everyMs: 2000,
      doc,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(most).toBe(1);
    // 5 s a read, 2 s between: 0–5, 7–12, 14–19, 21–26, the fifth from 28.
    expect(calls).toBe(5);
    expect(seen).toEqual([1, 3, 4]);
    expect(failed).toHaveLength(1);
  });

  it('stops at a 401, once its page has left the screen, and at a navigation', async () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    const ended = vi.fn(async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'Sign in.');
    });
    startRefresh({ load: ended, apply: () => {}, everyMs: 2000, doc });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ended).toHaveBeenCalledTimes(1);

    // A page drawn but never shown (the console moved on while it was read): its first read only.
    const owner = { isConnected: false };
    const unseen = vi.fn(async () => 1);
    startRefresh({ load: unseen, apply: () => {}, everyMs: 2000, doc, owner });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unseen).toHaveBeenCalledTimes(1);

    const a = vi.fn(async () => 1);
    const b = vi.fn(async () => 2);
    startRefresh({ load: a, apply: () => {}, everyMs: 2000, doc });
    startRefresh({ load: b, apply: () => {}, everyMs: 2000, doc, immediate: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 1]);
    stopRefreshes();
    await vi.advanceTimersByTimeAsync(20_000);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 1]);
    expect(doc.watched).toBe(0);
  });
});

describe('AdminApi: test entrants and the server’s status', () => {
  it('sends each on its path with its body, a timer’s read never ending the session', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers: Response[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return answers.shift() ?? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    let unauthorized = 0;
    const api = new AdminApi({ fetch, onUnauthorized: () => unauthorized++ });
    api.setCsrf('tok');
    const input = { phrase: 'TEST 8A1D0C55', ...TEST_DEFAULTS };
    await api.startTestRun(DROP, input);
    await api.addTestEntrants('run1', { phrase: 'TEST 8A1D0C55', tiers: { none: 0, titane: 0, platine: 50, palladium: 50 } });
    await api.stopTestRun('run1');
    await api.confirmTestEntrant('run1', 'acc1');
    await api.releaseTestEntrant('run1', 'acc1');
    await api.endTestRun('run1', 'END TEST 8A1D0C55');
    await api.currentTestRun(DROP);
    await api.testRuns(DROP);
    await api.activeTestRun();
    await api.systemStatus();
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `POST /api/admin/drops/${DROP}/test-runs`,
      'POST /api/admin/test-runs/run1/add',
      'POST /api/admin/test-runs/run1/stop',
      'POST /api/admin/test-runs/run1/entrants/acc1/confirm',
      'POST /api/admin/test-runs/run1/entrants/acc1/release',
      'POST /api/admin/test-runs/run1/end',
      `GET /api/admin/drops/${DROP}/test-runs/current`,
      `GET /api/admin/drops/${DROP}/test-runs`,
      'GET /api/admin/test-runs/active',
      'GET /api/admin/system/status',
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : c.init.body));
    expect(bodies[0]).toEqual(input);
    expect(bodies[1]).toEqual({ phrase: 'TEST 8A1D0C55', tiers: { none: 0, titane: 0, platine: 50, palladium: 50 } });
    expect(bodies[5]).toEqual({ phrase: 'END TEST 8A1D0C55' });
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);

    // The panels' reads every 2 s answered 401: thrown, the session left to the admin's next action.
    const denied = () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    answers.push(denied(), denied(), denied(), denied());
    await expect(api.systemStatus({ background: true })).rejects.toMatchObject({ status: 401 });
    await expect(api.activeTestRun({ background: true })).rejects.toMatchObject({ status: 401 });
    await expect(api.currentTestRun(DROP, { background: true })).rejects.toMatchObject({ status: 401 });
    await expect(api.testRuns(DROP, { background: true })).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(0);
  });
});

describe('the console reads what the server sends', () => {
  it('keeps the statuses and modes of a test as the server does', () => {
    expect([...web.TEST_RUN_STATUSES]).toEqual([...serverSchema.TEST_RUN_STATUSES]);
    expect([...web.TEST_RUN_MODES]).toEqual([...serverSchema.DROP_MODES]);
  });
});

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
// Compile-time: a test, a release's tests, the test running and the server's status are what the server sends (spec §5, §7).
export const testRunFits = (r: Json<ServerTestRunView>): web.TestRunView => r;
export const testRunSummaryFits = (r: Json<ServerTestRunSummary>): web.TestRunSummary => r;
export const activeTestRunFits = (r: Json<ServerActiveTestRun>): web.ActiveTestRun => r;
export const systemStatusFits = (s: Json<ServerSystemStatus>): web.SystemStatus => s;
