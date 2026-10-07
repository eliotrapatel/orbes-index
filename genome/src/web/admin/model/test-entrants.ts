/**
 * Test entrants (plan TEST ENTRANTS, 2026-10-07) — pure helpers, no DOM.
 *
 * Test entrants are ordinary collector accounts of a pool (`test-0001@orbes.test` …) that an ADMIN sends into a draw or
 * a LIVE RELEASE, real ones too: they act through the release's own routes, win like anyone, and their orders are real
 * until END TEST cleans them up.
 *
 *  - What SEND TEST ENTRANTS and ADD MORE send (POST /api/admin/drops/:id/test-runs, /api/admin/test-runs/:id/add): the
 *    number per tier, the arrival, the behaviour, the choices (LIVE) and the profile, as the dialog holds them, their
 *    defaults, and what the server would refuse before anything is sent (its bounds mirrored).
 *  - The phrases typed: `TEST <the release's first 8>` to send, `END TEST <the same>` to end.
 *  - When a test can start on a release (a draw open, or in its early access to reserve; a LIVE RELEASE's room open),
 *    and what each role may do with a run now (ADMIN; an AUDITOR and an OPERATOR read).
 *  - A run as the console says it: its status, its settings in one line, its table by tier with its total, its report's
 *    checks and peaks.
 *  - A test account in the entries' lists: its email ends @orbes.test.
 */
import { formatCount, humanize } from '../format.js';
import { can } from './permissions.js';
import { formatBytes, formatDecimal, formatMs, formatShare } from './system-status.js';
import type { AdminRole, Drop, LiveRelease, TestArrivalMode, TestReport, TestRunMode, TestRunSelected, TestRunSettings, TestRunStatus, TestRunSummary, TestRunTier, TestRunView } from '../types.js';

/** The server's bounds (services/test-entrants.ts, http/schemas.ts). */
export const TEST_ENTRANTS_LIMITS = Object.freeze({
  perPress: 1000,
  perRun: 5000,
  burstSeconds: { min: 1, max: 3600 },
  holdSeconds: { min: 1.5, max: 10 },
  quantity: { min: 1, max: 5 },
  seniority: { min: 0, max: 50 },
  accountAgeDays: { min: 0, max: 3650 },
});

/** The tiers of a press, in the dialog's order, with their key in the body. */
export const TEST_TIERS = Object.freeze([
  { key: 'none', tier: 0, label: 'NO TIER' },
  { key: 'titane', tier: 1, label: 'TITANE' },
  { key: 'platine', tier: 2, label: 'PLATINE' },
  { key: 'palladium', tier: 3, label: 'PALLADIUM' },
] as const);
type TierKey = (typeof TEST_TIERS)[number]['key'];

/** The settings by default: 100 TITANE in a burst of 10 s; PAY 70, RELEASE 20, MISS 10; the seal held 1.5 s; 70 % confirm by themselves. */
export const TEST_DEFAULTS: Readonly<TestRunSettings> = Object.freeze({
  tiers: { none: 0, titane: 100, platine: 0, palladium: 0 },
  arrival: { mode: 'burst' as const, seconds: 10, interestPct: 0 },
  behaviour: { payPct: 70, releasePct: 20, missPct: 10, leavePct: 0, holdSeconds: 1.5, withdrawPct: 0, reservePct: 0, confirmPct: 70 },
  choices: { size: null, quantity: 1, addOnsPct: 0 },
  profile: { seniorityMin: 0, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 720, countries: [], sharedNetworkPct: 0 },
});

/** The arrivals a release offers: all at once, a burst; and on a LIVE RELEASE, spread before the opening. */
export function arrivalOptions(mode: TestRunMode): { value: TestArrivalMode; label: string }[] {
  return [
    { value: 'all', label: 'All at once' },
    { value: 'burst', label: 'A burst over a number of seconds' },
    ...(mode === 'LIVE' ? [{ value: 'before' as const, label: 'Spread from now until the opening (T0)' }] : []),
  ];
}

/** The settings of a run's last press (ADD MORE starts from them), every group complete. */
export function lastSettings(run: Pick<TestRunView, 'settings'> | null): TestRunSettings {
  const all = run ? (Array.isArray(run.settings) ? run.settings : [run.settings]) : [];
  const s: Partial<TestRunSettings> = all.length ? all[all.length - 1] ?? {} : {};
  const d = TEST_DEFAULTS;
  return {
    tiers: { ...d.tiers, ...s.tiers },
    arrival: { ...d.arrival, ...s.arrival },
    behaviour: { ...d.behaviour, ...s.behaviour },
    choices: { ...d.choices, ...s.choices },
    profile: { ...d.profile, ...s.profile, countries: [...(s.profile?.countries ?? d.profile.countries)] },
  };
}

/** The presses of a run: SEND TEST ENTRANTS, then each ADD MORE. */
export function pressCount(run: Pick<TestRunView, 'settings'>): number {
  return Array.isArray(run.settings) ? run.settings.length : 1;
}

/** A run of several presses, said under its test entrants: `In 3 presses: 100, 300 and 1 000.`; null for one press. */
export function pressesLine(run: Pick<TestRunView, 'settings'>): string | null {
  if (!Array.isArray(run.settings) || run.settings.length < 2) return null;
  const sent = run.settings.map((p) => (typeof p.entrants === 'number' ? p.entrants : tierTotal({ ...TEST_DEFAULTS.tiers, ...p.tiers })));
  return `In ${run.settings.length} presses: ${sent.slice(0, -1).map(formatCount).join(', ')} and ${formatCount(sent[sent.length - 1])}.`;
}

/** The dialog's values from settings (the defaults for SEND TEST ENTRANTS, the run's last press for ADD MORE). */
export function testRunValues(s: TestRunSettings = TEST_DEFAULTS): Record<string, string> {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    'tier:none': n(s.tiers.none),
    'tier:titane': n(s.tiers.titane),
    'tier:platine': n(s.tiers.platine),
    'tier:palladium': n(s.tiers.palladium),
    arrival: s.arrival.mode,
    seconds: n(s.arrival.seconds ?? TEST_DEFAULTS.arrival.seconds),
    interestPct: n(s.arrival.interestPct),
    payPct: n(s.behaviour.payPct),
    releasePct: n(s.behaviour.releasePct),
    missPct: n(s.behaviour.missPct),
    leavePct: n(s.behaviour.leavePct),
    holdSeconds: n(s.behaviour.holdSeconds),
    withdrawPct: n(s.behaviour.withdrawPct),
    reservePct: n(s.behaviour.reservePct),
    confirmPct: n(s.behaviour.confirmPct),
    size: s.choices.size ?? '',
    quantity: n(s.choices.quantity),
    addOnsPct: n(s.choices.addOnsPct),
    seniorityMin: n(s.profile.seniorityMin),
    seniorityMax: n(s.profile.seniorityMax),
    ageMin: n(s.profile.accountAgeDaysMin),
    ageMax: n(s.profile.accountAgeDaysMax),
    countries: s.profile.countries.join(', '),
    sharedNetworkPct: n(s.profile.sharedNetworkPct),
  };
}

const WHOLE = /^\s*\d{1,5}\s*$/;
/** A whole number as typed; null when it is not one. */
const whole = (s: string | undefined): number | null => (s !== undefined && WHOLE.test(s) ? Number(s) : null);
/** A share from 0 to 100, whole; null otherwise. */
const pct = (s: string | undefined): number | null => {
  const n = whole(s);
  return n !== null && n <= 100 ? n : null;
};
/** A number of seconds with up to two decimals (`1.5`, `2,25`); null otherwise. */
const seconds = (s: string | undefined): number | null => (s !== undefined && /^\s*\d{1,2}(?:[.,]\d{1,2})?\s*$/.test(s) ? Number(s.trim().replace(',', '.')) : null);

/** The countries typed (`FR, JP`, `fr jp`): upper case, each once; the empty list for none. */
export function parseCountries(text: string | undefined): string[] {
  return [...new Set((text ?? '').split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
}

/** The test entrants per tier as typed: an empty count is 0; null when one is not a whole number. */
export function tierCounts(v: Record<string, string>): TestRunSettings['tiers'] | null {
  const out = { none: 0, titane: 0, platine: 0, palladium: 0 } as Record<TierKey, number>;
  for (const t of TEST_TIERS) {
    const raw = v[`tier:${t.key}`] ?? '';
    if (raw.trim() === '') continue;
    const n = whole(raw);
    if (n === null) return null;
    out[t.key] = n;
  }
  return out;
}

/** The test entrants of a press, every tier together. */
export function tierTotal(t: TestRunSettings['tiers']): number {
  return t.none + t.titane + t.platine + t.palladium;
}

/** A field's value, or its default when the dialog does not show it (the other release's fields). */
const valueOf = (v: Record<string, string>, k: string): string => v[k] ?? testRunValues()[k] ?? '';

/**
 * What the server would refuse in a press, said before anything is sent; null when it can go. `already`: the run's test
 * entrants before ADD MORE (5 000 in all). `earlyOnly`: a draw in its early access only, where a test needs a share that
 * reserves.
 */
export function testRunProblem(mode: TestRunMode, v: Record<string, string>, opts: { already?: number; earlyOnly?: boolean } = {}): string | null {
  const L = TEST_ENTRANTS_LIMITS;
  const tiers = tierCounts(v);
  if (!tiers) return 'Type a whole number of test entrants for each tier (0, or empty, for none).';
  const total = tierTotal(tiers);
  if (total < 1) return 'Send at least 1 test entrant.';
  if (total > L.perPress) return `At most ${formatCount(L.perPress)} test entrants per press: ${formatCount(total)} now.`;
  const already = opts.already ?? 0;
  if (already + total > L.perRun) return `A test holds at most ${formatCount(L.perRun)} test entrants: ${formatCount(Math.max(0, L.perRun - already))} more at most.`;

  const arrival = valueOf(v, 'arrival');
  if (!arrivalOptions(mode).some((o) => o.value === arrival)) return 'Choose how the test entrants arrive.';
  if (arrival === 'burst') {
    const s = whole(valueOf(v, 'seconds'));
    if (s === null || s < L.burstSeconds.min || s > L.burstSeconds.max) return `A burst lasts ${L.burstSeconds.min} to ${formatCount(L.burstSeconds.max)} seconds.`;
  }

  if (mode === 'LIVE') {
    if (pct(valueOf(v, 'interestPct')) === null) return 'The share that says I’LL BE THERE is 0 to 100 %.';
    const shares = (['payPct', 'releasePct', 'missPct', 'leavePct'] as const).map((k) => pct(valueOf(v, k)));
    if (shares.some((x) => x === null)) return 'PAY, RELEASE, MISS and LEAVE are each 0 to 100 %.';
    const sum = shares.reduce<number>((a, x) => a + (x ?? 0), 0);
    if (sum !== 100) return `PAY, RELEASE, MISS and LEAVE make 100 % together: ${sum} % now.`;
    const hold = seconds(valueOf(v, 'holdSeconds'));
    if (hold === null || hold < L.holdSeconds.min || hold > L.holdSeconds.max) return `The seal is held ${L.holdSeconds.min} to ${L.holdSeconds.max} seconds.`;
    const q = valueOf(v, 'quantity');
    if (q.trim() !== '') {
      const n = whole(q);
      if (n === null || n < L.quantity.min || n > L.quantity.max) return `Each takes ${L.quantity.min} to ${L.quantity.max} pieces, or a number at random.`;
    }
    if (pct(valueOf(v, 'addOnsPct')) === null) return 'The share that adds add-ons is 0 to 100 %.';
  } else {
    for (const [k, what] of [
      ['withdrawPct', 'withdraws'],
      ['reservePct', 'reserves during the early access'],
      ['confirmPct', 'confirms by itself'],
    ] as const) {
      if (pct(valueOf(v, k)) === null) return `The share that ${what} is 0 to 100 %.`;
    }
    if (opts.earlyOnly && pct(valueOf(v, 'reservePct')) === 0) return 'Only the early access is open: set a share of PLATINE and PALLADIUM that reserves.';
  }

  const sMin = whole(valueOf(v, 'seniorityMin'));
  const sMax = whole(valueOf(v, 'seniorityMax'));
  if (sMin === null || sMax === null || sMax > L.seniority.max || sMin > sMax) return `Seniority runs from ${L.seniority.min} to ${L.seniority.max} years, from the lower to the higher.`;
  const aMin = whole(valueOf(v, 'ageMin'));
  const aMax = whole(valueOf(v, 'ageMax'));
  if (aMin === null || aMax === null || aMax > L.accountAgeDays.max || aMin > aMax) return `An account’s age runs from ${L.accountAgeDays.min} to ${formatCount(L.accountAgeDays.max)} days, from the lower to the higher.`;
  const bad = parseCountries(valueOf(v, 'countries')).find((c) => !/^[A-Z]{2}$/.test(c));
  if (bad) return `${bad} is not a country’s two letters (FR, JP).`;
  if (pct(valueOf(v, 'sharedNetworkPct')) === null) return 'The share on one shared network is 0 to 100 %.';
  return null;
}

/** The body of a press from the dialog's values (checked by testRunProblem first): every group, with the phrase typed. */
export function testRunInput(mode: TestRunMode, v: Record<string, string>, phrase: string): TestRunSettings & { phrase: string } {
  const num = (k: string) => Number(valueOf(v, k).trim());
  const arrival = valueOf(v, 'arrival') as TestArrivalMode;
  const quantity = valueOf(v, 'quantity').trim();
  return {
    phrase,
    tiers: tierCounts(v) ?? { ...TEST_DEFAULTS.tiers },
    arrival: { mode: arrival, ...(arrival === 'burst' ? { seconds: num('seconds') } : {}), interestPct: mode === 'LIVE' ? num('interestPct') : 0 },
    behaviour: {
      payPct: num('payPct'),
      releasePct: num('releasePct'),
      missPct: num('missPct'),
      leavePct: num('leavePct'),
      holdSeconds: seconds(valueOf(v, 'holdSeconds')) ?? TEST_DEFAULTS.behaviour.holdSeconds,
      withdrawPct: num('withdrawPct'),
      reservePct: num('reservePct'),
      confirmPct: num('confirmPct'),
    },
    choices: {
      size: mode === 'LIVE' && valueOf(v, 'size') ? valueOf(v, 'size') : null,
      quantity: quantity === '' ? null : Number(quantity),
      addOnsPct: mode === 'LIVE' ? num('addOnsPct') : 0,
    },
    profile: {
      seniorityMin: num('seniorityMin'),
      seniorityMax: num('seniorityMax'),
      accountAgeDaysMin: num('ageMin'),
      accountAgeDaysMax: num('ageMax'),
      countries: parseCountries(valueOf(v, 'countries')),
      sharedNetworkPct: num('sharedNetworkPct'),
    },
  };
}

/** The phrase typed before SEND TEST ENTRANTS and ADD MORE (`TEST 1A2B3C4D`) or END TEST (`END TEST 1A2B3C4D`): the release's first 8. */
export function testPhrase(action: 'send' | 'end', dropId: string): string {
  return `${action === 'end' ? 'END TEST' : 'TEST'} ${dropId.slice(0, 8).toUpperCase()}`;
}

/** Whether a test can start on the release now, a draw only in its early access (`earlyOnly`), and the line that says it. */
export interface TestStart {
  open: boolean;
  earlyOnly: boolean;
  line: string;
}

/** A draw: open to entries, or in its early access (then the test needs a share that reserves). */
export function drawTestStart(d: Pick<Drop, 'state' | 'earlyAccessOpensAt' | 'opensAt'>, now: Date): TestStart {
  if (d.state === 'OPEN') {
    return { open: true, earlyOnly: false, line: 'Entries are open: test entrants enter through the release’s own routes, each signed in on its own network, and are drawn with the real entries.' };
  }
  const t = now.getTime();
  if (d.state === 'UPCOMING' && d.earlyAccessOpensAt && Date.parse(d.earlyAccessOpensAt) <= t && t < Date.parse(d.opensAt)) {
    return { open: true, earlyOnly: true, line: 'The early access is open: the PLATINE and PALLADIUM test entrants set to reserve do so now; entries open to the others at the time above.' };
  }
  return { open: false, earlyOnly: false, line: 'A test starts while the draw is open, or during its early access to reserve.' };
}

/** A LIVE RELEASE: from its room's opening until it ends. */
export function liveTestStart(r: Pick<LiveRelease, 'phase' | 'endedAt'>): TestStart {
  if ((r.phase === 'ROOM' || r.phase === 'LIVE') && r.endedAt === null) {
    return { open: true, earlyOnly: false, line: 'The room is open: test entrants enter through the release’s own routes, each signed in on its own network, and take their turns like everyone.' };
  }
  return { open: false, earlyOnly: false, line: 'A test starts once the room is open, until the release ends.' };
}

/** What `role` may do with the release's test now: send one (no test of it running), add more and stop (running), end it. */
export function testRunActions(run: Pick<TestRunView, 'status'> | null, role: AdminRole | null | undefined, start: TestStart): { send: boolean; addMore: boolean; stop: boolean; end: boolean } {
  const admin = can(role, 'runTestEntrants');
  const running = run?.status === 'RUNNING';
  return { send: admin && start.open && !running, addMore: admin && running, stop: admin && running, end: admin && run !== null && run.status !== 'ENDED' };
}

/** What `role` may do with a test entrant holding a place: CONFIRM, and RELEASE on a LIVE RELEASE, as the server allows. */
export function testEntrantActions(run: Pick<TestRunView, 'mode' | 'status'>, e: Pick<TestRunSelected, 'canConfirm' | 'canRelease'>, role: AdminRole | null | undefined): { confirm: boolean; release: boolean } {
  const admin = can(role, 'runTestEntrants') && run.status !== 'ENDED';
  return { confirm: admin && e.canConfirm, release: admin && run.mode === 'LIVE' && e.canRelease };
}

/** What a run's status means, said under it. */
export function testRunLine(run: Pick<TestRunView, 'mode' | 'status'>): string {
  switch (run.status) {
    case 'RUNNING':
      return 'Its test entrants are acting. STOP halts them at once and cleans nothing; END TEST cleans up.';
    case 'DONE':
      return run.mode === 'DRAW'
        ? 'Every test entrant has acted. The places drawn confirm by themselves at the share set, the others lapse as usual. END TEST cleans up.'
        : 'Every test entrant has finished. END TEST cleans up.';
    case 'STOPPED':
      return 'Stopped: its test entrants no longer act, and nothing was cleaned. END TEST cleans up.';
    case 'INTERRUPTED':
      return 'A restart or a deployment interrupted it: its test entrants no longer act. END TEST still cleans up.';
    default:
      return 'Ended: its orders cancelled, its entries closed and its places freed; the test accounts are kept for the next test.';
  }
}

/** The settings of a press in one line, as the run's panel says them (`sizes`: a LIVE RELEASE's, to name the size chosen). */
export function testSettingsLine(mode: TestRunMode, s: TestRunSettings, sizes: readonly { id: string; label: string }[] = []): string {
  const tiers = TEST_TIERS.filter((t) => s.tiers[t.key] > 0).map((t) => `${formatCount(s.tiers[t.key])} ${t.label}`);
  const arrival = s.arrival.mode === 'all' ? 'all at once' : s.arrival.mode === 'burst' ? `a burst of ${formatCount(s.arrival.seconds ?? 0)} s` : 'spread until T0';
  const b = s.behaviour;
  const p = s.profile;
  const parts = [tiers.length ? tiers.join(' + ') : 'none', arrival];
  if (mode === 'LIVE') {
    if (s.arrival.interestPct > 0) parts.push(`${s.arrival.interestPct} % I’LL BE THERE first`);
    parts.push(`PAY ${b.payPct} % · RELEASE ${b.releasePct} % · MISS ${b.missPct} % · LEAVE ${b.leavePct} %`, `the seal held ${b.holdSeconds} s`);
    const size = s.choices.size === null ? 'a size at random' : `size ${sizes.find((x) => x.id === s.choices.size)?.label ?? s.choices.size}`;
    const pieces = s.choices.quantity === null ? 'pieces at random' : `${s.choices.quantity} ${s.choices.quantity === 1 ? 'piece' : 'pieces'}`;
    parts.push(`${size}, ${pieces}`, `add-ons ${s.choices.addOnsPct} %`);
  } else {
    parts.push(`withdraw ${b.withdrawPct} %`, `reserve ${b.reservePct} %`, `confirm by themselves ${b.confirmPct} %`);
  }
  parts.push(
    `seniority ${p.seniorityMin}–${p.seniorityMax} yrs`,
    `accounts ${formatCount(p.accountAgeDaysMin)}–${formatCount(p.accountAgeDaysMax)} days old`,
    p.countries.length ? `from ${p.countries.join(', ')}` : 'no country',
    `shared network ${p.sharedNetworkPct} %`,
  );
  return parts.join(' · ');
}

/** The counts of a tier's row. */
export type TestTierCounts = Omit<TestRunTier, 'tier' | 'label'>;
const COUNT_KEYS = ['entered', 'inRoom', 'selected', 'confirmed', 'lapsed', 'released', 'missed', 'left', 'withdrawn'] as const satisfies readonly (keyof TestTierCounts)[];

/** The columns of the table by tier: a draw's, a LIVE RELEASE's. */
export const TEST_TIER_COLUMNS: Readonly<Record<TestRunMode, readonly { key: keyof TestTierCounts; label: string }[]>> = Object.freeze({
  DRAW: [
    { key: 'entered', label: 'Entered' },
    { key: 'selected', label: 'Selected' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'lapsed', label: 'Lapsed' },
    { key: 'withdrawn', label: 'Withdrawn' },
  ],
  LIVE: [
    { key: 'entered', label: 'Entered' },
    { key: 'inRoom', label: 'In the room' },
    { key: 'selected', label: 'Selected' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'released', label: 'Released' },
    { key: 'missed', label: 'Missed' },
    { key: 'left', label: 'Left' },
  ],
});

/** The table by tier: the four tiers in order (a tier the server left out at 0), then their total. */
export function tierRows(byTier: readonly TestRunTier[]): { label: string; total: boolean; counts: TestTierCounts }[] {
  const zero = (): TestTierCounts => Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as TestTierCounts;
  const rows = TEST_TIERS.map((t) => {
    const r = byTier.find((x) => x.tier === t.tier);
    const counts = zero();
    if (r) for (const k of COUNT_KEYS) counts[k] = r[k] ?? 0;
    return { label: t.label, total: false, counts };
  });
  const total = zero();
  for (const r of rows) for (const k of COUNT_KEYS) total[k] += r.counts[k];
  return [...rows, { label: 'TOTAL', total: true, counts: total }];
}

/** A report's checks as `5/5`; `—` without a report. */
export function checksLine(s: Pick<TestRunSummary, 'checksPassed' | 'checksTotal'>): string {
  return s.checksPassed === null || s.checksTotal === null ? '—' : `${s.checksPassed}/${s.checksTotal}`;
}

/** A report's checks passed, of all. */
export function reportScore(r: TestReport): { passed: number; total: number } {
  return { passed: r.checks.filter((c) => c.pass).length, total: r.checks.length };
}

const PEAK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  memBytes: 'APP MEMORY',
  appMemBytes: 'APP MEMORY',
  cpuCores: 'APP CPU',
  appCpuCores: 'APP CPU',
  p95Ms: 'RESPONSE TIME p95',
  loopDelayP99Ms: 'EVENT LOOP DELAY p99',
  streams: 'LIVE CONNECTIONS',
  liveStreams: 'LIVE CONNECTIONS',
  connections: 'DATABASE CONNECTIONS',
  dbConnections: 'DATABASE CONNECTIONS',
  poolWaiting: 'DATABASE WAITING',
  errors5xx: 'ERRORS (5XX)',
  refused429: 'REFUSED (429)',
});

/** A peak's name from its key: `loopDelayP99Ms` → `LOOP DELAY P99`, its unit left to its value. */
function peakLabel(key: string): string {
  return PEAK_LABELS[key] ?? humanize(key.replace(/(Bytes|Ms|Pct|Cores)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

/** A peak's value by its key's unit: bytes, milliseconds, a share, cores, or a count. */
function peakValue(key: string, v: number): string {
  if (/Bytes$/.test(key)) return formatBytes(v);
  if (/Ms$/.test(key)) return formatMs(v);
  if (/Pct$/.test(key)) return formatShare(v, { pct: true });
  if (/Cores$/.test(key)) return `${formatDecimal(v)} cores`;
  return Number.isInteger(v) ? formatCount(v) : formatDecimal(v);
}

/**
 * A run's peaks as rows (`APP MEMORY`, `412 MB`; `—` for a value this server cannot read), a group's (`{ app: { memBytes } }`)
 * read through; anything else left out.
 */
export function peakRows(peaks: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const walk = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && Number.isFinite(v)) out.push({ label: peakLabel(k), value: peakValue(k, v) });
      else if (v === null) out.push({ label: peakLabel(k), value: '—' });
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v as Record<string, unknown>);
    }
  };
  if (peaks) walk(peaks);
  return out;
}

/** A test account of the pool: its email (masked or not) ends @orbes.test. */
export function isTestAccount(email: string | null | undefined): boolean {
  return /@orbes\.test$/i.test((email ?? '').trim());
}

/** The status of a run, said in capitals (`INTERRUPTED`). */
export function testRunStatusLabel(status: TestRunStatus): string {
  return humanize(status);
}
