/**
 * TEST ENTRANTS (the owner's lot of 2026-10-07; migration 0024a): the console sends artificial collectors into a draw
 * or a LIVE RELEASE, to prove its process right, prove it holds a crowd and see it live.
 *
 * A test entrant is an ordinary ORBES account of the pool (`test-0001@orbes.test`, `TEST 0001`, ACTIVE, a password hash
 * no password ever matches): it enters, wins, takes real places and pieces, and PAY or a staff Confirm creates its real
 * orders, exactly as a collector's; public counts and the console's figures count it. Three things only are its own:
 *  - its tier and seniority come from its test row (`test_entrants`), set by the press that sends it, never from pieces
 *    (club.ts `clubStandings`, which every reader of a tier uses: the draw, the early access, the LIVE line, access;
 *    and a segment's TIER rule, segments.ts);
 *  - it counts as owning the release's models and collection for a LIVE RELEASE's rule (live.ts `accessOf`);
 *  - END TEST cleans up after it (below).
 *
 * The pool: a press takes accounts of the pool with no entry in the release and in no RUNNING test, and creates the
 * missing ones, at most TEST_POOL_MAX accounts in all. Each bot of a press gets its test row (its tier from the count
 * asked per tier, its seniority drawn within the profile's range), its country (drawn from the profile's list, or
 * none) and its account's age (`created_at` moved back by a number of days drawn within the profile's range: a new
 * account trips the bot radar). The shares of a press (who reserves, withdraws, pays, …) are exact: 70 % of 10 bots is
 * 7 of them, drawn at random.
 *
 * A run: START (ADMIN, the phrase `TEST <8>`: a draw OPEN, or in its early access when some PLATINE and PALLADIUM are
 * to reserve; a LIVE RELEASE's room open) → RUNNING, its bots acting; ADD MORE (the same phrase) sends up to
 * TEST_PER_PRESS_MAX more into it, TEST_RUN_MAX at most in all; DONE once every bot has acted (a draw's test waits there
 * for the staff's draw); STOP halts the bots at once and cleans nothing (STOPPED); a restart of the server leaves it
 * INTERRUPTED (`boot`). Only a RUNNING test blocks a new one (`test_runs_one_running`): one test at a time.
 *
 * The runner (the MEDIUM method): in this process, each bot acts through this app's own public routes (`app.inject`),
 * signed in with its own session minted here (a collector arrives signed in), with the CSRF token and the Origin the
 * routes require, and from its own address in 100.64.0.0/10 (RFC 6598): its own /24 (100.64.0.0/24, 100.64.1.0/24, …),
 * or the shared 100.127.255.0/24 for the profile's « shared network » share. Validation, guards, rate limits, network
 * hashes, DB-IP and the bot radar all apply. One scheduler loop (every TICK_MS) runs the bots whose next step is due,
 * at most IN_FLIGHT_MAX at a time:
 *  - a draw: ENTER at its arrival (a PLATINE or PALLADIUM drawn to reserve RESERVES while the early access is open; a
 *    bot that cannot enter yet waits for the opening, as a collector does); some WITHDRAW a few seconds later;
 *  - a LIVE RELEASE: I'LL BE THERE first for its share (before T0), ENTER with its size and pieces; then it follows its
 *    turn as a phone whose stream is lost does, reading GET /state every POLL_MS (its turn's secret is there); on its
 *    TURN: PRESS, the hold, SECURE, its add-ons, then PAY or RELEASE MY PLACE after a few seconds; or it misses its turn,
 *    or LEAVES (on its turn, or a while after entering). An after-room is left to the routes, as for anyone.
 * A draw's places confirm themselves from the database (`sweep`, every SWEEP_MS while a draw's test is RUNNING or DONE),
 * so it survives a restart and covers the draw, the early access's reservations and OFFER NEXT alike: a SELECTED test
 * entrant drawn to confirm gets a time 5 to 60 s ahead (`confirm_due_at`), then the staff's Confirm (DropService) runs
 * with the test's ADMIN as its actor; the others keep their place until its time ends, then lapse as anyone's.
 * By hand (ADMIN): CONFIRM a test entrant holding a place (a draw's staff Confirm; on a LIVE RELEASE the bot secures and
 * pays now), RELEASE (a LIVE RELEASE's hold given back now; a draw's place is never given back).
 *
 * END TEST (ADMIN, the phrase `END TEST <8>`; RUNNING, DONE, STOPPED or INTERRUPTED): the bots stopped; the TEST REPORT
 * computed BEFORE the clean-up (`report`, kept on the run: five checks over the whole release, real and test entries
 * together, and the test's peaks); then, for the test's accounts in that release: their open orders cancelled one by one
 * as Client Services cancels one (the stock goes back, a piece to make is cancelled and its identity retired), their
 * ENTERED draw entries WITHDRAWN, their SELECTED, CONFIRMED and WAITLISTED ones LAPSED (`respond_by` = `handled_at` =
 * now, so `drop_entries_lapsed` holds: staff OFFER NEXT to real collectors), their open LIVE entries REMOVED (LiveService
 * REMOVE) and their I'LL BE THERE withdrawn before T0, their sessions ended; ENDED. The accounts stay in the pool.
 * TODO (the next lot's merge): END TEST must also cancel the GIFT orders and the credits the next lot gives at PAY.
 *
 * Audited `test_run.start`, `.add`, `.stop`, `.confirm`, `.release`, `.end` (the ADMIN as actor); each bot's own actions
 * are audited by the routes as any account's; END TEST's clean-up `drop.withdraw`, `drop.entry.lapse` and
 * `drop.live.interest.withdraw` with `reason: "test_ended"`, `drop.live.remove` and `order.cancel` as their services
 * write them.
 */
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import type { AppContext } from '../context.js';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { jsonText, toBytes, type DropMode, type DropRow, type JsonObject, type JsonValue, type TestRunStatus } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import type { Actor } from '../types.js';
import { isAfterRoom } from './after-room.js';
import type { ClubTier } from './club.js';
import { dropNotFound, dropState, drawOrder, inEarlyAccess } from './drops.js';
import { isAnnounced, LIVE_OPEN_STATUSES, LIVE_PER_ACCOUNT, roomOpensAt } from './live.js';
import { orderReference } from './orders.js';
import { sessionCookieName } from './sessions.js';
import { stockLevel } from './stock.js';
import { currentRunPeaks, startRunPeaks, stopRunPeaks } from './system-status.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The bots of one press (START or ADD MORE): 1 to 1 000. */
export const TEST_PER_PRESS_MAX = 1000;
/** The bots of one test, every press together. */
export const TEST_RUN_MAX = 5000;
/** The test accounts of the pool, in all (the owner's cap). */
export const TEST_POOL_MAX = 5000;
/** The pool's addresses: `test-0001@orbes.test`, … (a reserved domain: nobody receives mail there). */
export const TEST_EMAIL_DOMAIN = 'orbes.test';
/** A test account's password hash: not a scrypt encoding, so no password ever matches it (crypto/scrypt.ts verifySecret). */
export const TEST_PASSWORD_HASH = '!test-entrant: never signs in';
/** The tiers as the console names them, 0 to 3. */
export const TEST_TIER_LABELS = Object.freeze(['NO TIER', 'TITANE', 'PLATINE', 'PALLADIUM'] as const);
/** The network the « shared network » share of a press comes from (the bot radar's NETWORK sign). */
export const TEST_SHARED_NETWORK = '100.127.255.0/24';
/** A draw's place confirmed by itself 5 to 60 s after it is held. */
export const TEST_CONFIRM_DELAY_S = Object.freeze({ min: 5, max: 60 });

const TICK_MS = 250;
const SWEEP_MS = 5000;
/** The test's peaks are saved on the run this often while it runs. */
const PEAKS_SAVE_MS = 10_000;
/** Requests of the bots under way at once, at most. */
const IN_FLIGHT_MAX = 32;
/** A phone without its stream reads the room's state every 2 s (routes/live.ts). */
const POLL_MS = 2000;
/** The runner's errors kept per test. */
const ERRORS_KEPT = 20;
/** The test entrants holding a place listed in a view, at most. */
const SELECTED_MAX = 500;
/** Rows per statement of the pool's writes. */
const CHUNK = 500;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** The note END TEST leaves on a draw's place it lapses, and on an order it cancels. */
const END_NOTE = 'END TEST: a test entrant’s place, closed with its test.';
const END_ORDER_NOTE = 'END TEST: a test entrant’s order, cancelled with its test.';

export type TestArrivalMode = 'all' | 'burst' | 'before';
export type TestOutcome = 'PAY' | 'RELEASE' | 'MISS' | 'LEAVE';

/** The settings of a press, every group filled. */
export interface TestRunSettings {
  /** Bots per tier: NO TIER, TITANE, PLATINE, PALLADIUM; 1 to 1 000 in all. */
  tiers: { none: number; titane: number; platine: number; palladium: number };
  /** All at once, evenly over `seconds` (1 to 3 600), or spread from now until T0 (LIVE); the share saying I'LL BE THERE first. */
  arrival: { mode: TestArrivalMode; seconds: number; interestPct: number };
  /** LIVE: PAY, RELEASE MY PLACE, a missed turn, LEAVE (100 in all), the seal held `holdSeconds`; a draw: withdraw, reserve, confirm. */
  behaviour: { payPct: number; releasePct: number; missPct: number; leavePct: number; holdSeconds: number; withdrawPct: number; reservePct: number; confirmPct: number };
  /** LIVE: a size (its id or label; null: one at random), the pieces (1 to 5; null: at random), the share adding an add-on. */
  choices: { size: string | null; quantity: number | null; addOnsPct: number };
  /** Each bot drawn within: its seniority (years), its account's age (days), a country of the list (none: none), the shared network's share. */
  profile: { seniorityMin: number; seniorityMax: number; accountAgeDaysMin: number; accountAgeDaysMax: number; countries: string[]; sharedNetworkPct: number };
}

/** What a press sends: its tiers, and any group, or any field of a group (the others: the run's last press's, or by default). */
export interface TestRunSettingsInput {
  tiers: TestRunSettings['tiers'];
  arrival?: Partial<TestRunSettings['arrival']>;
  behaviour?: Partial<TestRunSettings['behaviour']>;
  choices?: Partial<TestRunSettings['choices']>;
  profile?: Partial<TestRunSettings['profile']>;
}

/** One press of a run (test_runs.settings, oldest first): its settings, when, and the bots it sent. */
export interface TestRunPress extends TestRunSettings {
  at: Date;
  entrants: number;
}

/** The settings by default (the console's): 100 TITANE in a burst of 10 s; pay 70 / release 20 / miss 10; confirm 70 %. */
export const TEST_RUN_DEFAULTS: Readonly<Omit<TestRunSettings, 'tiers'>> = Object.freeze({
  arrival: { mode: 'burst', seconds: 10, interestPct: 0 },
  behaviour: { payPct: 70, releasePct: 20, missPct: 10, leavePct: 0, holdSeconds: 1.5, withdrawPct: 0, reservePct: 0, confirmPct: 70 },
  choices: { size: null, quantity: 1, addOnsPct: 0 },
  profile: { seniorityMin: 0, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 720, countries: [], sharedNetworkPct: 0 },
});

/** One tier's bots of a run, by what they did (a draw: entered, in the draw, SELECTED…; a LIVE RELEASE: in the room, a turn or hold…). */
export interface TestRunTier {
  tier: ClubTier;
  label: (typeof TEST_TIER_LABELS)[number];
  entered: number;
  inRoom: number;
  selected: number;
  confirmed: number;
  lapsed: number;
  released: number;
  missed: number;
  left: number;
  withdrawn: number;
}

/** A test entrant holding a place: a draw's SELECTED or CONFIRMED, a LIVE turn, hold or CONFIRMED. */
export interface TestRunSelected {
  accountId: string;
  /** As stored; the routes mask it for an AUDITOR. */
  email: string;
  tier: ClubTier;
  status: string;
  /** A draw's `respond_by`; a LIVE hold's end, or its turn's. */
  respondBy: Date | null;
  orderRef: string | null;
  canConfirm: boolean;
  canRelease: boolean;
}

/** One check of a TEST REPORT: passed or failed, said in one plain line. */
export interface TestReportCheck {
  id: 'ONE_ENTRY' | 'ORDER' | 'ONE_PLACE' | 'STOCK' | 'ORDERS';
  label: string;
  pass: boolean;
  line: string;
}

/** The TEST REPORT, computed at END TEST before the clean-up: five checks over the whole release, and the test's peaks. */
export interface TestReport {
  at: Date;
  checks: TestReportCheck[];
  passed: number;
  total: number;
  peaks: JsonObject | null;
}

/** GET /api/admin/drops/:id/test-runs/current: a run and what its bots did. */
export interface TestRunView {
  id: string;
  dropId: string;
  mode: DropMode;
  status: TestRunStatus;
  createdAt: Date;
  endedAt: Date | null;
  /** The ADMIN who started it (email). */
  createdBy: string;
  /** Each press, oldest first: its settings, its time and its bots. */
  settings: TestRunPress[];
  entrants: number;
  byTier: TestRunTier[];
  /** The release's entries: real, test (any test's), all. */
  release: { real: number; test: number; total: number };
  selected: TestRunSelected[];
  /** The runner's last errors, oldest first (this process's memory). */
  errors: { at: Date; message: string }[];
  report: TestReport | null;
  peaks: JsonObject | null;
}

/** GET /api/admin/drops/:id/test-runs: a release's tests, newest first. */
export interface TestRunSummary {
  id: string;
  status: TestRunStatus;
  createdAt: Date;
  endedAt: Date | null;
  createdBy: string;
  entrants: number;
  /** Null until END TEST. */
  checksPassed: number | null;
  checksTotal: number | null;
  report: TestReport | null;
  peaks: JsonObject | null;
}

/** GET /api/admin/test-runs/active: the RUNNING test, whatever its release. */
export interface ActiveTestRun {
  id: string;
  dropId: string;
  dropName: string;
  mode: DropMode;
  status: TestRunStatus;
  entrants: number;
}

/** One request to this app's own routes (Fastify's `app.inject`), as a phone sends it. */
export type TestInject = (request: {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers: Record<string, string>;
  payload?: string;
  remoteAddress: string;
}) => Promise<{ statusCode: number; body: string }>;

export interface TestEntrantServiceDeps {
  ctx: Pick<AppContext, 'db' | 'audit' | 'sessions' | 'config' | 'clock' | 'log' | 'services'>;
  inject: TestInject;
}

// ── Errors ─────────────────────────────────────────────────────────────────

const testRunNotFound = () => notFound('Test', 'TEST_RUN_NOT_FOUND');
const testEntrantNotFound = () => notFound('Test entrant', 'TEST_ENTRANT_NOT_FOUND');
const testRunning = () => conflict('TEST_RUNNING', 'A test is running: one test at a time. STOP it, or wait until it is done.');
const testNotRunning = (what: string) => conflict('TEST_NOT_RUNNING', `${what} only while the test is running.`);
const testEnded = () => conflict('TEST_ENDED', 'This test has ended.');
const testEnding = () => conflict('TEST_ENDING', 'END TEST is already under way for this test.');
const drawNotOpen = () => conflict('TEST_DRAW_NOT_OPEN', 'Start the test while the draw is open.');
const roomNotOpen = () => conflict('TEST_ROOM_NOT_OPEN', 'Start the test once the room is open.');
const poolFull = (needed: number, left: number) =>
  conflict('TEST_POOL_FULL', `The pool holds at most ${TEST_POOL_MAX} test accounts: this press needs ${needed} more, and ${left} can still be made.`);
const runFull = (left: number) => conflict('TEST_RUN_FULL', `A test sends at most ${TEST_RUN_MAX} test entrants: ${left} more can still be sent.`);
const placeNotHeld = () => conflict('TEST_PLACE_NOT_HELD', 'This test entrant holds no place to confirm.');
const holdNotHeld = () => conflict('TEST_HOLD_NOT_HELD', 'This test entrant holds no piece to release.');
const drawNoRelease = () => conflict('TEST_DRAW_NO_RELEASE', 'A draw’s place is never given back: CONFIRM it, or let it lapse.');

function assertAdmin(actor: Actor): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only an ORBES admin can run a test.');
  return actor.id.toLowerCase();
}

function knownId(id: string, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

/** The phrase a press or END TEST asks for: `TEST 1A2B3C4D`, `END TEST 1A2B3C4D` (the release's id, its first 8 characters). */
export function testPhrase(dropId: string, end = false): string {
  return `${end ? 'END TEST' : 'TEST'} ${dropId.slice(0, 8).toUpperCase()}`;
}

function checkPhrase(typed: unknown, wanted: string): void {
  if (typeof typed !== 'string' || typed.trim().replace(/\s+/g, ' ').toUpperCase() !== wanted) throw validationError(`Type ${wanted} to confirm.`);
}

// ── Settings ───────────────────────────────────────────────────────────────

const given = <T extends object>(o: Partial<T> | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

function whole(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw validationError(`${what}: a whole number from ${min} to ${max}.`);
  return v;
}

function percent(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw validationError(`${what}: a share from 0 to 100 %.`);
  return v;
}

/**
 * A press's settings: its tiers (1 to TEST_PER_PRESS_MAX bots), and each other group as `base` holds it (the run's last
 * press, or TEST_RUN_DEFAULTS) with the fields the press sends; checked whole (the LIVE shares 100 in all, a range's
 * ends in order, a DRAW never arriving « before »).
 */
export function testRunSettings(input: TestRunSettingsInput, base: Readonly<Omit<TestRunSettings, 'tiers'>>, mode: DropMode): TestRunSettings {
  const t = input?.tiers;
  if (!t || typeof t !== 'object') throw validationError('Say how many test entrants of each tier.');
  const tiers = {
    none: whole(t.none, 0, TEST_PER_PRESS_MAX, 'NO TIER'),
    titane: whole(t.titane, 0, TEST_PER_PRESS_MAX, 'TITANE'),
    platine: whole(t.platine, 0, TEST_PER_PRESS_MAX, 'PLATINE'),
    palladium: whole(t.palladium, 0, TEST_PER_PRESS_MAX, 'PALLADIUM'),
  };
  const total = tiers.none + tiers.titane + tiers.platine + tiers.palladium;
  if (total < 1 || total > TEST_PER_PRESS_MAX) throw validationError(`Send 1 to ${TEST_PER_PRESS_MAX} test entrants per press.`);
  const arrival = { ...base.arrival, ...given(input.arrival) };
  const behaviour = { ...base.behaviour, ...given(input.behaviour) };
  const choices = { ...base.choices, ...given(input.choices) };
  const profile = { ...base.profile, ...given(input.profile) };
  if (!['all', 'burst', 'before'].includes(arrival.mode)) throw validationError('Arrival: all at once, a burst, or before the opening.');
  if (arrival.mode === 'before' && mode !== 'LIVE') throw validationError('Arrival before the opening is for a LIVE RELEASE.');
  const out: TestRunSettings = {
    tiers,
    arrival: { mode: arrival.mode, seconds: whole(arrival.seconds, 1, 3600, 'The burst’s seconds'), interestPct: percent(arrival.interestPct, 'I’LL BE THERE') },
    behaviour: {
      payPct: percent(behaviour.payPct, 'PAY'),
      releasePct: percent(behaviour.releasePct, 'RELEASE'),
      missPct: percent(behaviour.missPct, 'Missed turns'),
      leavePct: percent(behaviour.leavePct, 'LEAVE'),
      holdSeconds: behaviour.holdSeconds,
      withdrawPct: percent(behaviour.withdrawPct, 'Withdraw'),
      reservePct: percent(behaviour.reservePct, 'Reserve in early access'),
      confirmPct: percent(behaviour.confirmPct, 'Auto-confirm'),
    },
    choices: {
      size: choices.size === null || choices.size === undefined || (typeof choices.size === 'string' && choices.size.trim() === '') ? null : String(choices.size).trim(),
      quantity: choices.quantity === null || choices.quantity === undefined ? null : whole(choices.quantity, 1, LIVE_PER_ACCOUNT.max, 'Pieces'),
      addOnsPct: percent(choices.addOnsPct, 'Add-ons'),
    },
    profile: {
      seniorityMin: whole(profile.seniorityMin, 0, 50, 'Seniority from'),
      seniorityMax: whole(profile.seniorityMax, 0, 50, 'Seniority to'),
      accountAgeDaysMin: whole(profile.accountAgeDaysMin, 0, 3650, 'Account age from'),
      accountAgeDaysMax: whole(profile.accountAgeDaysMax, 0, 3650, 'Account age to'),
      countries: [...new Set((Array.isArray(profile.countries) ? profile.countries : []).map((c) => String(c).trim().toUpperCase()))],
      sharedNetworkPct: percent(profile.sharedNetworkPct, 'Shared network'),
    },
  };
  const b = out.behaviour;
  if (typeof b.holdSeconds !== 'number' || !Number.isFinite(b.holdSeconds) || b.holdSeconds < 1.5 || b.holdSeconds > 10) throw validationError('The seal is held 1.5 to 10 seconds.');
  if (Math.abs(b.payPct + b.releasePct + b.missPct + b.leavePct - 100) > 1e-9) throw validationError('PAY, RELEASE, missed turns and LEAVE make 100 % together.');
  if (out.profile.seniorityMin > out.profile.seniorityMax) throw validationError('Seniority: from is at most to.');
  if (out.profile.accountAgeDaysMin > out.profile.accountAgeDaysMax) throw validationError('Account age: from is at most to.');
  if (out.profile.countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw validationError('Countries are two-letter codes (FR, GB, …).');
  return out;
}

const pressSettings = (p: TestRunPress): Omit<TestRunSettings, 'tiers'> => ({ arrival: p.arrival, behaviour: p.behaviour, choices: p.choices, profile: p.profile });

// ── Shares and draws ───────────────────────────────────────────────────────

/** `xs` in a random order (Fisher–Yates). */
function shuffled<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** `n` flags, exactly round(n × pct / 100) of them true, in a random order. */
export function shareOf(n: number, pct: number): boolean[] {
  const k = Math.min(n, Math.max(0, Math.round((n * pct) / 100)));
  return shuffled(Array.from({ length: n }, (_, i) => i < k));
}

/** `n` values split as `pcts` says (largest remainders, so the counts make `n`), in a random order. */
export function splitOf<K extends string>(n: number, pcts: Record<K, number>): K[] {
  const keys = Object.keys(pcts) as K[];
  const exact = keys.map((k) => (n * pcts[k]) / 100);
  const counts = exact.map(Math.floor);
  const order = keys.map((_, i) => i).sort((a, b) => exact[b]! - counts[b]! - (exact[a]! - counts[a]!));
  for (let r = n - counts.reduce((s, c) => s + c, 0), i = 0; r > 0; r--, i++) counts[order[i % order.length]!]!++;
  return shuffled(keys.flatMap((k, i) => Array.from({ length: counts[i]! }, () => k)));
}

/** A whole number from `min` to `max`, both included. */
const between = (min: number, max: number): number => (max <= min ? min : randomInt(min, max + 1));
const pick = <T>(xs: readonly T[]): T => xs[randomInt(xs.length)]!;
const chunks = <T>(xs: readonly T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** The address of bot `i` of a run: its own /24 of 100.64.0.0/10 (16 382 of them), or the shared one. */
export function testNetwork(i: number, shared: boolean): { network: string; ip: string } {
  if (shared) return { network: TEST_SHARED_NETWORK, ip: `100.127.255.${between(1, 254)}` };
  const prefix = `100.${64 + (i >> 8)}.${i & 255}`;
  return { network: `${prefix}.0/24`, ip: `${prefix}.${between(1, 254)}` };
}

// ── The runner's bots ──────────────────────────────────────────────────────

/** What a bot was drawn to do (test_run_entrants.plan). */
interface BotPlan {
  /** Its place among the run's bots. */
  i: number;
  ip: string;
  tier: ClubTier;
  /** When it arrives, and how long after its press (a bot that cannot enter a draw yet comes that long after the opening). */
  arriveAt: string;
  offsetMs: number;
  /** A draw: it reserves during the early access, withdraws after entering, confirms its place by itself. */
  reserve?: boolean;
  withdraw?: boolean;
  confirm?: boolean;
  /** A LIVE RELEASE: I'LL BE THERE first, its size and pieces, an add-on, what it does on its turn, how long it holds the seal. */
  interest?: boolean;
  sizeId?: string;
  quantity?: number;
  addOns?: boolean;
  outcome?: TestOutcome;
  holdMs?: number;
}

type BotStep = 'ARRIVE' | 'WITHDRAW' | 'WATCH' | 'SECURE' | 'DECIDE' | 'DONE';

interface Bot {
  accountId: string;
  email: string;
  plan: BotPlan;
  step: BotStep;
  /** When its next step is due, on the server's clock (ms). */
  at: number;
  busy: boolean;
  /** Its request under way, if any. */
  pending: Promise<void> | null;
  session: { cookie: string; csrf: string } | null;
  token: string | null;
  /** A LEAVE bot leaves the line at this time, if its turn has not come first. */
  leaveAt: number;
  /** Driven by hand (CONFIRM, RELEASE): no human delay before PAY. */
  now: boolean;
}

interface ActiveRun {
  id: string;
  drop: DropRow;
  mode: DropMode;
  addons: string[];
  bots: Bot[];
  /** Where the next tick starts reading the bots, so every one gets its turn under load. */
  cursor: number;
  peaksSavedAt: number;
}

interface CallResult {
  ok: boolean;
  status: number;
  code: string | null;
  json: Record<string, unknown> | null;
}

// ── Service ────────────────────────────────────────────────────────────────

export class TestEntrantService {
  private readonly ctx: TestEntrantServiceDeps['ctx'];
  private readonly db: Db;
  private readonly inject: TestInject;
  private run: ActiveRun | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly errors = new Map<string, { at: Date; message: string }[]>();
  private readonly ending = new Set<string>();
  private tickTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private sweeping: Promise<number> | null = null;
  private timers = true;
  /** How a bot driven by hand waits for its hold (tests on a manual clock replace it). */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  constructor(deps: TestEntrantServiceDeps) {
    this.ctx = deps.ctx;
    this.db = deps.ctx.db;
    this.inject = deps.inject;
  }

  private now(): Date {
    return this.ctx.clock();
  }

  // ── Life of the process ──────────────────────────────────────────────────

  /** At the app's start: a test left RUNNING by the previous process is INTERRUPTED (its bots are gone); the sweeper starts. */
  async boot(): Promise<string[]> {
    const rows = await this.db.updateTable('test_runs').set({ status: 'INTERRUPTED' }).where('status', '=', 'RUNNING').returning('id').execute();
    if (rows.length > 0) this.ctx.log.warn({ runs: rows.map((r) => r.id) }, 'test entrants: a test left running by the previous process is INTERRUPTED');
    this.startSweeper();
    return rows.map((r) => r.id);
  }

  /** At the app's close: the bots stop (the test stays RUNNING: the next start INTERRUPTS it), the requests under way finish. */
  async close(): Promise<void> {
    this.useTimers(false);
    this.run = null;
    await this.settle();
    await this.sweeping;
  }

  /** The scheduler's and the sweeper's timers on or off (tests drive `tick` and `sweep` themselves). */
  useTimers(on: boolean): void {
    this.timers = on;
    if (!on) {
      if (this.tickTimer) clearInterval(this.tickTimer);
      if (this.sweepTimer) clearInterval(this.sweepTimer);
      this.tickTimer = null;
      this.sweepTimer = null;
    } else {
      this.startSweeper();
      if (this.run) this.startTicking();
    }
  }

  private startSweeper(): void {
    if (!this.timers || this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((e) => this.ctx.log.error({ err: { message: (e as Error)?.message } }, 'test entrants: the sweep failed'));
    }, SWEEP_MS);
    this.sweepTimer.unref();
  }

  private startTicking(): void {
    if (!this.timers || this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.tick().catch((e) => this.ctx.log.error({ err: { message: (e as Error)?.message } }, 'test entrants: a tick failed'));
    }, TICK_MS);
    this.tickTimer.unref();
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // ── The console's actions ────────────────────────────────────────────────

  /**
   * SEND TEST ENTRANTS (POST /api/admin/drops/:id/test-runs, ADMIN): the phrase `TEST <8>`, then a press into a draw OPEN
   * (or in its early access when PLATINE and PALLADIUM are to reserve) or a LIVE RELEASE whose room is open. Refused:
   * another test RUNNING (409 TEST_RUNNING), the release not open (409), the pool full (409 TEST_POOL_FULL). Audited
   * `test_run.start`.
   */
  async start(dropId: string, input: TestRunSettingsInput & { phrase: string }, actor: Actor): Promise<TestRunView> {
    const admin = assertAdmin(actor);
    const id = knownId(dropId, dropNotFound);
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirst();
    if (!d) throw dropNotFound();
    checkPhrase(input?.phrase, testPhrase(id));
    const settings = testRunSettings(input, TEST_RUN_DEFAULTS, d.mode);
    const now = this.now();
    this.assertOpen(d, settings, now);
    const { runId, bots } = await inTransaction(this.db, async (tx) => {
      if (await tx.selectFrom('test_runs').select('id').where('status', '=', 'RUNNING').executeTakeFirst()) throw testRunning();
      let run: { id: string };
      try {
        run = await tx
          .insertInto('test_runs')
          .values({ drop_id: id, mode: d.mode, settings: jsonText([]), entrants: 0, created_by: admin, created_at: now })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (e) {
        if (isUniqueViolation(e, 'test_runs_one_running')) throw testRunning();
        throw e;
      }
      const bots = await this.press(tx, run.id, d, settings, 0, now);
      await this.ctx.audit.record(
        { actor, action: 'test_run.start', targetType: 'test_run', targetId: run.id, details: { dropId: id, mode: d.mode, entrants: bots.length, tiers: settings.tiers } },
        tx,
      );
      return { runId: run.id, bots };
    });
    await this.begin(runId, d, bots);
    return this.view(runId);
  }

  /**
   * ADD MORE (POST /api/admin/test-runs/:id/add, ADMIN): the same phrase and body (groups left out keep the run's last
   * settings), up to TEST_PER_PRESS_MAX more into a RUNNING test, TEST_RUN_MAX in all. Audited `test_run.add`.
   */
  async addMore(runId: string, input: TestRunSettingsInput & { phrase: string }, actor: Actor): Promise<TestRunView> {
    assertAdmin(actor);
    const id = knownId(runId, testRunNotFound);
    const now = this.now();
    const { d, bots } = await inTransaction(this.db, async (tx) => {
      const run = await tx.selectFrom('test_runs').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!run) throw testRunNotFound();
      checkPhrase(input?.phrase, testPhrase(run.drop_id));
      if (run.status !== 'RUNNING') throw testNotRunning('ADD MORE sends test entrants');
      const presses = run.settings as unknown as TestRunPress[];
      const last = presses.at(-1);
      const settings = testRunSettings(input, last ? pressSettings(last) : TEST_RUN_DEFAULTS, run.mode);
      const n = settings.tiers.none + settings.tiers.titane + settings.tiers.platine + settings.tiers.palladium;
      if (run.entrants + n > TEST_RUN_MAX) throw runFull(TEST_RUN_MAX - run.entrants);
      const d = await tx.selectFrom('drops').selectAll().where('id', '=', run.drop_id).executeTakeFirstOrThrow();
      this.assertOpen(d, settings, now);
      const bots = await this.press(tx, id, d, settings, run.entrants, now);
      await this.ctx.audit.record(
        { actor, action: 'test_run.add', targetType: 'test_run', targetId: id, details: { dropId: d.id, entrants: bots.length, total: run.entrants + bots.length, tiers: settings.tiers } },
        tx,
      );
      return { d, bots };
    });
    await this.begin(id, d, bots);
    return this.view(id);
  }

  /** STOP (POST /api/admin/test-runs/:id/stop, ADMIN, one press): the bots halt at once, nothing is cleaned; STOPPED. Audited `test_run.stop`. */
  async stop(runId: string, actor: Actor): Promise<TestRunView> {
    assertAdmin(actor);
    const id = knownId(runId, testRunNotFound);
    const run = await this.db.selectFrom('test_runs').select(['id', 'status', 'drop_id', 'entrants']).where('id', '=', id).executeTakeFirst();
    if (!run) throw testRunNotFound();
    if (run.status !== 'RUNNING') throw testNotRunning('STOP stops a test');
    this.halt(id);
    await inTransaction(this.db, async (tx) => {
      const peaks = stopRunPeaks(id);
      const stopped = await tx
        .updateTable('test_runs')
        .set({ status: 'STOPPED', ...(peaks ? { peaks: jsonText(peaks) } : {}) })
        .where('id', '=', id)
        .where('status', '=', 'RUNNING')
        .returning('id')
        .executeTakeFirst();
      if (!stopped) throw testNotRunning('STOP stops a test');
      await this.ctx.audit.record({ actor, action: 'test_run.stop', targetType: 'test_run', targetId: id, details: { dropId: run.drop_id, entrants: run.entrants } }, tx);
    });
    return this.view(id);
  }

  /**
   * CONFIRM by hand (POST /api/admin/test-runs/:id/entrants/:accountId/confirm, ADMIN): a draw's SELECTED place
   * confirmed by the staff's Confirm (its order created); on a LIVE RELEASE the bot, on its turn or holding its piece,
   * secures it and pays now. Audited `test_run.confirm`.
   */
  async confirmEntrant(runId: string, accountId: string, actor: Actor): Promise<TestRunView> {
    assertAdmin(actor);
    const { run, member } = await this.member(runId, accountId);
    if (run.mode === 'DRAW') {
      const e = await this.db.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', run.drop_id).where('account_id', '=', member.account_id).executeTakeFirst();
      if (!e || e.status !== 'SELECTED') throw placeNotHeld();
      await this.ctx.services.drops.confirm(run.drop_id, e.id, null, actor);
      await this.outcome(run.id, member.account_id, 'CONFIRMED');
      await this.ctx.audit.record({ actor, action: 'test_run.confirm', targetType: 'test_run', targetId: run.id, details: { accountId: member.account_id, entryId: e.id } });
    } else {
      const e = await this.db.selectFrom('live_entries').select(['id', 'status']).where('drop_id', '=', run.drop_id).where('account_id', '=', member.account_id).executeTakeFirst();
      if (!e || (e.status !== 'TURN' && e.status !== 'SECURED')) throw placeNotHeld();
      await this.byHand(run, member, 'PAY');
      await this.ctx.audit.record({ actor, action: 'test_run.confirm', targetType: 'test_run', targetId: run.id, details: { accountId: member.account_id, entryId: e.id } });
    }
    return this.view(run.id);
  }

  /** RELEASE by hand (…/release, ADMIN; a LIVE RELEASE only): the bot gives its held piece back now. Audited `test_run.release`. */
  async releaseEntrant(runId: string, accountId: string, actor: Actor): Promise<TestRunView> {
    assertAdmin(actor);
    const { run, member } = await this.member(runId, accountId);
    if (run.mode === 'DRAW') throw drawNoRelease();
    const e = await this.db.selectFrom('live_entries').select(['id', 'status']).where('drop_id', '=', run.drop_id).where('account_id', '=', member.account_id).executeTakeFirst();
    if (!e || e.status !== 'SECURED') throw holdNotHeld();
    await this.byHand(run, member, 'RELEASE');
    await this.ctx.audit.record({ actor, action: 'test_run.release', targetType: 'test_run', targetId: run.id, details: { accountId: member.account_id, entryId: e.id } });
    return this.view(run.id);
  }

  /**
   * END TEST (POST /api/admin/test-runs/:id/end, ADMIN, the phrase `END TEST <8>`; RUNNING, DONE, STOPPED or
   * INTERRUPTED): the bots stopped, the TEST REPORT computed and kept, then the clean-up (see the file header); ENDED.
   * Audited `test_run.end` with the checks passed and what was cleaned.
   */
  async end(runId: string, phrase: string, actor: Actor): Promise<TestRunView> {
    const admin = assertAdmin(actor);
    const id = knownId(runId, testRunNotFound);
    const run = await this.db.selectFrom('test_runs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!run) throw testRunNotFound();
    checkPhrase(phrase, testPhrase(run.drop_id, true));
    if (run.status === 'ENDED') throw testEnded();
    if (this.ending.has(id)) throw testEnding();
    this.ending.add(id);
    try {
      // 1. The bots stop, their requests under way finish; a RUNNING or DONE test is STOPPED first, so the sweeper confirms
      // nothing more during the clean-up, and a clean-up cut short leaves a test END TEST takes again.
      if (run.status === 'RUNNING' || run.status === 'DONE') {
        this.halt(id);
        const peaks = run.status === 'RUNNING' ? stopRunPeaks(id) : null;
        await this.db
          .updateTable('test_runs')
          .set({ status: 'STOPPED', ...(peaks ? { peaks: jsonText(peaks) } : {}) })
          .where('id', '=', id)
          .where('status', 'in', ['RUNNING', 'DONE'])
          .execute();
        await this.settle();
        await this.sweeping;
      }
      const d = await this.db.selectFrom('drops').selectAll().where('id', '=', run.drop_id).executeTakeFirstOrThrow();
      // 2. The report, before anything is cleaned (kept from a first END TEST cut short).
      let report = run.report as unknown as TestReport | null;
      if (!report) {
        const peaks = (await this.db.selectFrom('test_runs').select('peaks').where('id', '=', id).executeTakeFirstOrThrow()).peaks;
        report = { ...(await this.report(d, this.now())), peaks: (peaks as JsonObject | null) ?? null };
        await this.db.updateTable('test_runs').set({ report: jsonText(report) }).where('id', '=', id).execute();
      }
      // 3. The clean-up of the test's accounts in that release.
      const accounts = (await this.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', id).execute()).map((r) => r.account_id);
      const cleaned = await this.cleanUp(d, accounts, actor);
      // 4. ENDED.
      await inTransaction(this.db, async (tx) => {
        const now = this.now();
        await tx.updateTable('test_runs').set({ status: 'ENDED', ended_at: now, ended_by: admin }).where('id', '=', id).where('status', '!=', 'ENDED').execute();
        await this.ctx.audit.record(
          { actor, action: 'test_run.end', targetType: 'test_run', targetId: id, details: { dropId: d.id, from: run.status, checksPassed: report.passed, checksTotal: report.total, cleaned } },
          tx,
        );
      });
      return this.view(id);
    } finally {
      this.ending.delete(id);
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** A release's newest test not ended, or null (404 DROP_NOT_FOUND for an unknown release). */
  async current(dropId: string): Promise<TestRunView | null> {
    const id = knownId(dropId, dropNotFound);
    if (!(await this.db.selectFrom('drops').select('id').where('id', '=', id).executeTakeFirst())) throw dropNotFound();
    const run = await this.db.selectFrom('test_runs').select('id').where('drop_id', '=', id).where('status', '!=', 'ENDED').orderBy('created_at', 'desc').orderBy('id').limit(1).executeTakeFirst();
    return run ? this.view(run.id) : null;
  }

  /** A release's tests, newest first (404 DROP_NOT_FOUND for an unknown release). */
  async list(dropId: string): Promise<TestRunSummary[]> {
    const id = knownId(dropId, dropNotFound);
    if (!(await this.db.selectFrom('drops').select('id').where('id', '=', id).executeTakeFirst())) throw dropNotFound();
    const rows = await this.db
      .selectFrom('test_runs as r')
      .innerJoin('admin_users as a', 'a.id', 'r.created_by')
      .select(['r.id', 'r.status', 'r.created_at', 'r.ended_at', 'a.email', 'r.entrants', 'r.report', 'r.peaks'])
      .where('r.drop_id', '=', id)
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id')
      .execute();
    return rows.map((r) => {
      const report = r.report as unknown as TestReport | null;
      return {
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        endedAt: r.ended_at,
        createdBy: r.email,
        entrants: r.entrants,
        checksPassed: report ? report.passed : null,
        checksTotal: report ? report.total : null,
        report,
        peaks: (r.peaks as JsonObject | null) ?? null,
      };
    });
  }

  /** The RUNNING test, whatever its release, or null (the Drops tab). */
  async active(): Promise<ActiveTestRun | null> {
    const r = await this.db
      .selectFrom('test_runs as r')
      .innerJoin('drops as d', 'd.id', 'r.drop_id')
      .select(['r.id', 'r.drop_id', 'd.title', 'r.mode', 'r.status', 'r.entrants'])
      .where('r.status', '=', 'RUNNING')
      .executeTakeFirst();
    return r ? { id: r.id, dropId: r.drop_id, dropName: r.title, mode: r.mode, status: r.status, entrants: r.entrants } : null;
  }

  /** One run as the console reads it (404 TEST_RUN_NOT_FOUND). */
  async view(runId: string): Promise<TestRunView> {
    const id = knownId(runId, testRunNotFound);
    const run = await this.db
      .selectFrom('test_runs as r')
      .innerJoin('admin_users as a', 'a.id', 'r.created_by')
      .selectAll('r')
      .select('a.email as created_email')
      .where('r.id', '=', id)
      .executeTakeFirst();
    if (!run) throw testRunNotFound();
    const live = run.mode === 'LIVE';
    const entries = live ? 'live_entries' : 'drop_entries';
    const counted = await sql<{ tier: number; status: string | null; n: number }>`
      SELECT (r.plan->>'tier')::int AS tier, e.status, count(*)::int AS n
        FROM test_run_entrants AS r
        LEFT JOIN ${sql.table(entries)} AS e ON e.drop_id = ${run.drop_id} AND e.account_id = r.account_id
       WHERE r.run_id = ${id}
       GROUP BY 1, 2`.execute(this.db);
    const byTier: TestRunTier[] = TEST_TIER_LABELS.map((label, tier) => ({
      tier: tier as ClubTier, label, entered: 0, inRoom: 0, selected: 0, confirmed: 0, lapsed: 0, released: 0, missed: 0, left: 0, withdrawn: 0,
    }));
    for (const c of counted.rows) {
      const t = byTier[Math.min(3, Math.max(0, Number(c.tier)))]!;
      const n = Number(c.n);
      if (c.status === null) continue;
      t.entered += n;
      const s = c.status;
      if (live) {
        if ((LIVE_OPEN_STATUSES as readonly string[]).includes(s)) t.inRoom += n;
        if (s === 'TURN' || s === 'SECURED') t.selected += n;
        if (s === 'CONFIRMED') t.confirmed += n;
        if (s === 'EXPIRED') t.lapsed += n;
        if (s === 'RELEASED') t.released += n;
        if (s === 'MISSED') t.missed += n;
        if (s === 'LEFT') t.left += n;
      } else {
        if (s === 'ENTERED' || s === 'WAITLISTED') t.inRoom += n;
        if (s === 'SELECTED') t.selected += n;
        if (s === 'CONFIRMED') t.confirmed += n;
        if (s === 'LAPSED') t.lapsed += n;
        if (s === 'WITHDRAWN') t.withdrawn += n;
      }
    }
    const totals = await sql<{ total: number; test: number }>`
      SELECT count(*)::int AS total, count(t.account_id)::int AS test
        FROM ${sql.table(entries)} AS e LEFT JOIN test_entrants AS t ON t.account_id = e.account_id
       WHERE e.drop_id = ${run.drop_id}`.execute(this.db);
    const total = Number(totals.rows[0]?.total ?? 0);
    const test = Number(totals.rows[0]?.test ?? 0);
    const open = run.status !== 'ENDED';
    const held = live
      ? await this.db
          .selectFrom('test_run_entrants as r')
          .innerJoin('live_entries as e', (j) => j.onRef('e.account_id', '=', 'r.account_id').on('e.drop_id', '=', run.drop_id))
          .innerJoin('accounts as a', 'a.id', 'r.account_id')
          .select((eb) => [
            'r.account_id', 'a.email', 'r.plan', 'e.status',
            eb.fn.coalesce('e.hold_expires_at', 'e.turn_expires_at').as('respond_by'),
            eb.selectFrom('orders as o').select('o.id').whereRef('o.live_entry_id', '=', 'e.id').orderBy('o.piece').limit(1).as('order_id'),
          ])
          .where('r.run_id', '=', id)
          .where('e.status', 'in', ['TURN', 'SECURED', 'CONFIRMED'])
          .orderBy('e.status')
          .orderBy('a.email')
          .limit(SELECTED_MAX)
          .execute()
      : await this.db
          .selectFrom('test_run_entrants as r')
          .innerJoin('drop_entries as e', (j) => j.onRef('e.account_id', '=', 'r.account_id').on('e.drop_id', '=', run.drop_id))
          .innerJoin('accounts as a', 'a.id', 'r.account_id')
          .select((eb) => [
            'r.account_id', 'a.email', 'r.plan', 'e.status', 'e.respond_by',
            eb.selectFrom('orders as o').select('o.id').whereRef('o.drop_entry_id', '=', 'e.id').limit(1).as('order_id'),
          ])
          .where('r.run_id', '=', id)
          .where('e.status', 'in', ['SELECTED', 'CONFIRMED'])
          .orderBy('e.status')
          .orderBy('a.email')
          .limit(SELECTED_MAX)
          .execute();
    const selected: TestRunSelected[] = held.map((h) => ({
      accountId: h.account_id,
      email: h.email,
      tier: Math.min(3, Math.max(0, Number((h.plan as unknown as BotPlan).tier) || 0)) as ClubTier,
      status: h.status,
      respondBy: h.respond_by ? new Date(h.respond_by) : null,
      orderRef: h.order_id ? orderReference(h.order_id) : null,
      canConfirm: open && (live ? h.status === 'TURN' || h.status === 'SECURED' : h.status === 'SELECTED'),
      canRelease: open && live && h.status === 'SECURED',
    }));
    return {
      id: run.id,
      dropId: run.drop_id,
      mode: run.mode,
      status: run.status,
      createdAt: run.created_at,
      endedAt: run.ended_at,
      createdBy: run.created_email,
      settings: run.settings as unknown as TestRunPress[],
      entrants: run.entrants,
      byTier,
      release: { real: total - test, test, total },
      selected,
      errors: [...(this.errors.get(id) ?? [])],
      report: (run.report as unknown as TestReport | null) ?? null,
      peaks: (run.peaks as JsonObject | null) ?? null,
    };
  }

  // ── The pool and a press ─────────────────────────────────────────────────

  /** Refused unless a draw is OPEN (or in its early access, some to reserve), or a LIVE RELEASE's room is open and not over. */
  private assertOpen(d: DropRow, s: TestRunSettings, now: Date): void {
    if (d.mode === 'DRAW') {
      const early = s.behaviour.reservePct > 0 && s.tiers.platine + s.tiers.palladium > 0 && inEarlyAccess(d, now);
      if (dropState(d, now) !== 'OPEN' && !early) throw drawNotOpen();
      return;
    }
    const over = d.cancelled_at !== null || d.ended_at !== null || now.getTime() >= d.closes_at.getTime();
    if (!d.published_at || isAfterRoom(d) || !isAnnounced(d, now) || now.getTime() < roomOpensAt(d).getTime() || over) throw roomNotOpen();
  }

  /**
   * One press, in the run's transaction: its bots taken from the pool (created when short), each given its tier,
   * seniority, country, account age, network and plan; the press appended to the run's settings. Returns its bots.
   */
  private async press(tx: Db, runId: string, d: DropRow, s: TestRunSettings, already: number, now: Date): Promise<Bot[]> {
    const n = s.tiers.none + s.tiers.titane + s.tiers.platine + s.tiers.palladium;
    const sizes = d.mode === 'LIVE' ? await tx.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', d.id).orderBy('position').execute() : [];
    let chosen: { id: string; stock: number } | null = null;
    if (d.mode === 'LIVE' && s.choices.size !== null) {
      const want = s.choices.size.toLowerCase();
      chosen = sizes.find((z) => z.id.toLowerCase() === want || z.label.toLowerCase() === want) ?? null;
      if (!chosen) throw validationError('Choose one of the sizes of this release.');
    }
    const offered = sizes.filter((z) => z.stock > 0);
    const perAccount = d.per_account ?? LIVE_PER_ACCOUNT.default;
    const accounts = await this.takePool(tx, d, n, now);

    // The bots' tiers in a random order; then each share exact, drawn at random.
    const tiers = shuffled([
      ...Array<ClubTier>(s.tiers.none).fill(0),
      ...Array<ClubTier>(s.tiers.titane).fill(1),
      ...Array<ClubTier>(s.tiers.platine).fill(2),
      ...Array<ClubTier>(s.tiers.palladium).fill(3),
    ]);
    const shared = shareOf(n, s.profile.sharedNetworkPct);
    const interest = shareOf(n, s.arrival.interestPct);
    const withdraw = shareOf(n, s.behaviour.withdrawPct);
    const confirm = shareOf(n, s.behaviour.confirmPct);
    const addOns = shareOf(n, s.choices.addOnsPct);
    const outcomes = splitOf<TestOutcome>(n, { PAY: s.behaviour.payPct, RELEASE: s.behaviour.releasePct, MISS: s.behaviour.missPct, LEAVE: s.behaviour.leavePct });
    const reservers = tiers.map((t, k) => (t >= 2 ? k : -1)).filter((k) => k >= 0);
    const reserve = new Set(shuffled(reservers).slice(0, Math.round((reservers.length * s.behaviour.reservePct) / 100)));
    const span = s.arrival.mode === 'all' ? 0 : s.arrival.mode === 'burst' ? s.arrival.seconds * 1000 : Math.max(0, d.opens_at.getTime() - now.getTime());

    const bots: Bot[] = [];
    const rows: { account_id: string; tier: number; seniority: number; country: string | null; created_at: Date }[] = [];
    const members: { run_id: string; account_id: string; network: string; plan: string; updated_at: Date }[] = [];
    accounts.forEach((a, k) => {
      const i = already + k;
      const where = testNetwork(i, shared[k]!);
      const offsetMs = n <= 1 ? 0 : Math.round((span * k) / n);
      const plan: BotPlan = { i, ip: where.ip, tier: tiers[k]!, arriveAt: new Date(now.getTime() + offsetMs).toISOString(), offsetMs };
      if (d.mode === 'DRAW') {
        plan.reserve = reserve.has(k);
        plan.withdraw = !plan.reserve && withdraw[k]!;
        plan.confirm = confirm[k]!;
      } else {
        const size = chosen ?? (offered.length ? pick(offered) : sizes[0]);
        const most = Math.max(1, Math.min(perAccount, size?.stock ?? 1));
        plan.interest = interest[k]!;
        plan.sizeId = size?.id ?? '';
        plan.quantity = s.choices.quantity === null ? between(1, most) : Math.min(s.choices.quantity, most);
        plan.addOns = addOns[k]!;
        plan.outcome = outcomes[k]!;
        plan.holdMs = Math.round(s.behaviour.holdSeconds * 1000);
      }
      rows.push({
        account_id: a.id,
        tier: plan.tier,
        seniority: between(s.profile.seniorityMin, s.profile.seniorityMax),
        country: s.profile.countries.length ? pick(s.profile.countries) : null,
        created_at: new Date(now.getTime() - between(s.profile.accountAgeDaysMin, s.profile.accountAgeDaysMax) * DAY_MS),
      });
      members.push({ run_id: runId, account_id: a.id, network: where.network, plan: jsonText(plan as unknown as JsonValue), updated_at: now });
      bots.push({ accountId: a.id, email: a.email, plan, step: 'ARRIVE', at: now.getTime() + offsetMs, busy: false, pending: null, session: null, token: null, leaveAt: Infinity, now: false });
    });
    for (const part of chunks(rows)) {
      await sql`
        UPDATE test_entrants AS t SET tier = v.tier, seniority = v.seniority
          FROM (VALUES ${sql.join(part.map((r) => sql`(${r.account_id}::uuid, ${r.tier}::smallint, ${r.seniority}::smallint)`))}) AS v(id, tier, seniority)
         WHERE t.account_id = v.id`.execute(tx);
      await sql`
        UPDATE accounts AS a SET country = v.country, created_at = v.created_at
          FROM (VALUES ${sql.join(part.map((r) => sql`(${r.account_id}::uuid, ${r.country}::char(2), ${r.created_at}::timestamptz)`))}) AS v(id, country, created_at)
         WHERE a.id = v.id`.execute(tx);
    }
    for (const part of chunks(members)) await tx.insertInto('test_run_entrants').values(part).execute();
    const pressed: TestRunPress = { ...s, at: now, entrants: n };
    await sql`
      UPDATE test_runs SET settings = settings || ${jsonText([pressed as unknown as JsonValue])}::jsonb, entrants = entrants + ${n}
       WHERE id = ${runId}`.execute(tx);
    return bots;
  }

  /**
   * `n` accounts of the pool for release `d`: ACTIVE, with no entry in it (a draw's or a LIVE one) and in no RUNNING test;
   * the missing ones created (`test-NNNN@orbes.test`, `TEST NNNN`, a password hash nothing matches, a test row), within
   * TEST_POOL_MAX accounts in all (409 TEST_POOL_FULL).
   */
  private async takePool(tx: Db, d: DropRow, n: number, now: Date): Promise<{ id: string; email: string }[]> {
    const free = await sql<{ id: string; email: string }>`
      SELECT t.account_id AS id, a.email
        FROM test_entrants AS t JOIN accounts AS a ON a.id = t.account_id
       WHERE a.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM drop_entries AS e WHERE e.drop_id = ${d.id} AND e.account_id = t.account_id)
         AND NOT EXISTS (SELECT 1 FROM live_entries AS e WHERE e.drop_id = ${d.id} AND e.account_id = t.account_id)
         AND NOT EXISTS (SELECT 1 FROM test_run_entrants AS r JOIN test_runs AS x ON x.id = r.run_id
                          WHERE r.account_id = t.account_id AND (x.status = 'RUNNING' OR x.drop_id = ${d.id}))
       ORDER BY a.email_normalized
       LIMIT ${n}
       FOR UPDATE OF t`.execute(tx);
    const out = [...free.rows];
    const missing = n - out.length;
    if (missing <= 0) return out;
    const pool = Number((await tx.selectFrom('test_entrants').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    if (pool + missing > TEST_POOL_MAX) throw poolFull(missing, Math.max(0, TEST_POOL_MAX - pool));
    const top = await sql<{ n: number | null }>`
      SELECT max(substring(email_normalized from '^test-([0-9]+)@orbes\\.test$')::int) AS n
        FROM accounts WHERE email_normalized LIKE 'test-%@orbes.test'`.execute(tx);
    let next = Number(top.rows[0]?.n ?? 0) + 1;
    while (out.length < n) {
      const want = Math.min(CHUNK, n - out.length);
      const values = Array.from({ length: want }, (_, k) => {
        const number = String(next + k).padStart(4, '0');
        const email = `test-${number}@${TEST_EMAIL_DOMAIN}`;
        return { email, email_normalized: email, password_hash: TEST_PASSWORD_HASH, display_name: `TEST ${number}`, created_at: now, updated_at: now };
      });
      next += want;
      // A number some account already uses (never a test account then) is skipped.
      const made = await tx.insertInto('accounts').values(values).onConflict((oc) => oc.column('email_normalized').doNothing()).returning(['id', 'email']).execute();
      if (made.length) await tx.insertInto('test_entrants').values(made.map((m) => ({ account_id: m.id, created_at: now }))).execute();
      out.push(...made);
    }
    return out;
  }

  // ── The runner ───────────────────────────────────────────────────────────

  /** A press's bots into the runner (a new test, or ADD MORE into the one under way), its peaks followed. */
  private async begin(runId: string, d: DropRow, bots: Bot[]): Promise<void> {
    if (this.run?.id !== runId) {
      const addons = d.mode === 'LIVE' ? (await this.db.selectFrom('live_addons').select('id').where('drop_id', '=', d.id).orderBy('position').execute()).map((a) => a.id) : [];
      this.run = { id: runId, drop: d, mode: d.mode, addons, bots: [], cursor: 0, peaksSavedAt: this.now().getTime() };
      startRunPeaks(runId);
    }
    this.run.bots.push(...bots);
    this.startTicking();
  }

  /** The runner forgets the test `runId` (STOP, END TEST): no new request; the ones under way finish. */
  private halt(runId: string): void {
    if (this.run?.id !== runId) return;
    this.run = null;
    this.stopTicking();
  }

  /**
   * One pass of the scheduler: the bots whose next step is due act, at most IN_FLIGHT_MAX requests at a time; the test's
   * peaks saved every PEAKS_SAVE_MS; DONE once every bot has acted. One pass at a time (a call during one gets that one).
   */
  tick(): Promise<void> {
    this.ticking ??= this.tickOnce().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async tickOnce(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const now = this.now().getTime();
    const count = run.bots.length;
    const from = run.cursor;
    for (let k = 0; k < count && this.inFlight.size < IN_FLIGHT_MAX; k++) {
      const bot = run.bots[(from + k) % count]!;
      if (bot.busy || bot.step === 'DONE' || bot.at > now) continue;
      this.launch(run, bot);
      run.cursor = (from + k + 1) % count;
    }
    if (now - run.peaksSavedAt >= PEAKS_SAVE_MS) {
      run.peaksSavedAt = now;
      const peaks = currentRunPeaks(run.id);
      if (peaks) await this.db.updateTable('test_runs').set({ peaks: jsonText(peaks) }).where('id', '=', run.id).where('status', '=', 'RUNNING').execute();
    }
    if (this.inFlight.size === 0 && run.bots.every((b) => b.step === 'DONE')) await this.done(run);
  }

  /** Every request of the bots under way, finished (tests; the close). */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private launch(run: ActiveRun, bot: Bot): void {
    bot.busy = true;
    const p: Promise<void> = this.act(run, bot)
      .catch((e) => {
        this.error(run.id, `${bot.email}: ${(e as Error)?.message ?? String(e)}`);
        bot.at = this.now().getTime() + POLL_MS;
      })
      .finally(() => {
        bot.busy = false;
        bot.pending = null;
        this.inFlight.delete(p);
      });
    bot.pending = p;
    this.inFlight.add(p);
  }

  /** Every bot has acted: the test is DONE (a draw's waits there for the staff's draw), its peaks kept. */
  private async done(run: ActiveRun): Promise<void> {
    if (this.run !== run) return;
    this.halt(run.id);
    const peaks = stopRunPeaks(run.id);
    await this.db
      .updateTable('test_runs')
      .set({ status: 'DONE', ...(peaks ? { peaks: jsonText(peaks) } : {}) })
      .where('id', '=', run.id)
      .where('status', '=', 'RUNNING')
      .execute();
  }

  /** A bot's due step. */
  private async act(run: ActiveRun, bot: Bot): Promise<void> {
    const now = this.now().getTime();
    const id = run.drop.id;
    const plan = bot.plan;
    if (run.mode === 'DRAW') {
      if (bot.step === 'WITHDRAW') {
        const w = await this.call(run, bot, 'POST', `/api/v1/club/drops/${id}/withdraw`, 'WITHDRAW');
        return this.finish(run, bot, w.ok ? 'WITHDRAWN' : 'ENTERED');
      }
      // ARRIVE: a reservation during the early access, else ENTER once the draw is open (a bot early waits for it).
      if (plan.reserve && inEarlyAccess(run.drop, new Date(now))) {
        const r = await this.call(run, bot, 'POST', `/api/v1/club/drops/${id}/reserve`, 'RESERVE');
        if (r.ok) return this.finish(run, bot, 'RESERVED');
        if (r.code !== 'DROP_FULL' && r.code !== 'DROP_EARLY_ACCESS_CLOSED') return this.finish(run, bot, 'REFUSED');
      }
      if (now < run.drop.opens_at.getTime()) {
        bot.at = run.drop.opens_at.getTime() + plan.offsetMs;
        return;
      }
      const e = await this.call(run, bot, 'POST', `/api/v1/club/drops/${id}/enter`, 'ENTER');
      if (!e.ok) return this.finish(run, bot, 'REFUSED');
      if (plan.withdraw) {
        bot.step = 'WITHDRAW';
        bot.at = this.now().getTime() + between(2000, 10_000);
        return;
      }
      return this.finish(run, bot, 'ENTERED');
    }
    const live = `/api/v1/live/${id}`;
    switch (bot.step) {
      case 'ARRIVE': {
        if (plan.interest && now < run.drop.opens_at.getTime()) await this.call(run, bot, 'PUT', `${live}/interest`, 'I’LL BE THERE', { sizeId: plan.sizeId });
        const e = await this.call(run, bot, 'POST', `${live}/enter`, 'ENTER', { sizeId: plan.sizeId, quantity: plan.quantity });
        if (!e.ok) return this.finish(run, bot, 'REFUSED');
        bot.step = 'WATCH';
        if (plan.outcome === 'LEAVE') bot.leaveAt = this.now().getTime() + between(5000, 60_000);
        bot.at = this.nextWatch(run, bot);
        return;
      }
      case 'WATCH': {
        const r = await this.call(run, bot, 'GET', `${live}/state`, 'STATE');
        if (!r.ok) {
          // Refused for a while (429, a restart): it looks again; shut out (403, 404): it is done.
          if (r.status === 429 || r.status >= 500 || r.status === 0) bot.at = this.now().getTime() + POLL_MS;
          else return this.finish(run, bot, 'GONE');
          return;
        }
        const entry = (r.json?.entry ?? null) as { status: string; turn: { token: string | null } | null } | null;
        if (!entry) return this.finish(run, bot, 'GONE');
        switch (entry.status) {
          case 'WAITING':
          case 'QUEUED':
            if (plan.outcome === 'LEAVE' && now >= bot.leaveAt) return this.leave(run, bot);
            bot.at = this.nextWatch(run, bot);
            return;
          case 'TURN': {
            if (!bot.now && plan.outcome === 'LEAVE') return this.leave(run, bot);
            // A missed turn: it does nothing until the turn runs out.
            const token = entry.turn?.token ?? null;
            if ((!bot.now && plan.outcome === 'MISS') || !token) {
              bot.at = this.now().getTime() + POLL_MS;
              return;
            }
            const p = await this.call(run, bot, 'POST', `${live}/press`, 'PRESS', { token });
            if (!p.ok) {
              bot.at = this.now().getTime() + POLL_MS;
              return;
            }
            bot.token = token;
            bot.step = 'SECURE';
            bot.at = this.now().getTime() + (plan.holdMs ?? 1500);
            return;
          }
          case 'SECURED':
            bot.step = 'DECIDE';
            bot.at = this.now().getTime();
            return;
          default:
            // CONFIRMED, MISSED, EXPIRED, RELEASED, LEFT, REMOVED, ENDED: it is done.
            return this.finish(run, bot, entry.status);
        }
      }
      case 'SECURE': {
        const s = await this.call(run, bot, 'POST', `${live}/secure`, 'SECURE', { token: bot.token });
        if (!s.ok) {
          bot.step = 'WATCH';
          bot.at = this.now().getTime() + (bot.now ? 0 : POLL_MS);
          return;
        }
        if (plan.addOns && run.addons.length) await this.call(run, bot, 'PUT', `${live}/addons`, 'ADD-ONS', { addonIds: [pick(run.addons)] });
        bot.step = 'DECIDE';
        // A collector pays a few seconds after securing; a bot driven by hand at once.
        bot.at = this.now().getTime() + (bot.now ? 0 : between(2000, 10_000));
        return;
      }
      case 'DECIDE': {
        const release = plan.outcome === 'RELEASE';
        const r = await this.call(run, bot, 'POST', `${live}/${release ? 'release' : 'confirm'}`, release ? 'RELEASE' : 'PAY');
        if (r.ok) return this.finish(run, bot, release ? 'RELEASED' : 'CONFIRMED');
        bot.step = 'WATCH';
        bot.at = this.now().getTime() + POLL_MS;
        return;
      }
      default:
        return;
    }
  }

  /** When a LIVE bot reads its state next: from T0 on (nothing moves before), every POLL_MS; a LEAVE bot at its time too. */
  private nextWatch(run: ActiveRun, bot: Bot): number {
    const now = this.now().getTime();
    const t0 = run.drop.opens_at.getTime();
    const next = now < t0 ? t0 + between(0, POLL_MS) : now + POLL_MS;
    return Math.min(next, bot.leaveAt);
  }

  private async leave(run: ActiveRun, bot: Bot): Promise<void> {
    const r = await this.call(run, bot, 'POST', `/api/v1/live/${run.drop.id}/leave`, 'LEAVE');
    if (r.ok) return this.finish(run, bot, 'LEFT');
    bot.leaveAt = Infinity;
    bot.at = this.now().getTime() + POLL_MS;
  }

  private async finish(run: ActiveRun, bot: Bot, outcome: string): Promise<void> {
    bot.step = 'DONE';
    await this.outcome(run.id, bot.accountId, outcome);
  }

  private async outcome(runId: string, accountId: string, outcome: string): Promise<void> {
    await this.db.updateTable('test_run_entrants').set({ outcome, updated_at: this.now() }).where('run_id', '=', runId).where('account_id', '=', accountId).execute();
  }

  /**
   * One request of a bot through the app's routes, as its phone sends it: its session (minted on its first request), the
   * CSRF token and the site's Origin on a change, its own address. A refusal is kept among the test's errors.
   */
  private async call(run: ActiveRun, bot: Bot, method: 'GET' | 'POST' | 'PUT', url: string, what: string, body?: unknown): Promise<CallResult> {
    if (!bot.session) {
      const s = await this.ctx.sessions.create({ subjectType: 'account', subjectId: bot.accountId, userAgent: UA });
      bot.session = { cookie: `${sessionCookieName(this.ctx.config, 'account')}=${s.token}`, csrf: s.csrfToken };
    }
    const headers: Record<string, string> = { 'user-agent': UA, cookie: bot.session.cookie };
    if (method !== 'GET') {
      headers.origin = this.ctx.config.publicOrigin;
      headers['x-csrf-token'] = bot.session.csrf;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.inject({ method, url, headers, remoteAddress: bot.plan.ip, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      json = null;
    }
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const code = ok ? null : ((json?.error as { code?: string } | undefined)?.code ?? `HTTP_${res.statusCode}`);
    if (!ok) this.error(run.id, `${what} refused for ${bot.email}: ${res.statusCode} ${code}`);
    return { ok, status: res.statusCode, code, json };
  }

  private error(runId: string, message: string): void {
    const list = this.errors.get(runId) ?? [];
    list.push({ at: this.now(), message });
    if (list.length > ERRORS_KEPT) list.splice(0, list.length - ERRORS_KEPT);
    this.errors.set(runId, list);
  }

  /** The run and the bot `accountId` of it (404 TEST_RUN_NOT_FOUND, TEST_ENTRANT_NOT_FOUND; 409 TEST_ENDED). */
  private async member(runId: string, accountId: string) {
    const id = knownId(runId, testRunNotFound);
    const account = knownId(accountId, testEntrantNotFound);
    const run = await this.db.selectFrom('test_runs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!run) throw testRunNotFound();
    if (run.status === 'ENDED') throw testEnded();
    const member = await this.db
      .selectFrom('test_run_entrants as r')
      .innerJoin('accounts as a', 'a.id', 'r.account_id')
      .select(['r.account_id', 'r.plan', 'a.email'])
      .where('r.run_id', '=', id)
      .where('r.account_id', '=', account)
      .executeTakeFirst();
    if (!member) throw testEntrantNotFound();
    return { run, member };
  }

  /**
   * A LIVE bot driven by hand: it reads its state, and on its turn presses, holds the seal and secures, then PAYS
   * (`PAY`) or gives its piece back (`RELEASE`) at once. The runner's own bot, when it runs, waits meanwhile.
   */
  private async byHand(run: { id: string; drop_id: string }, member: { account_id: string; plan: unknown; email: string }, outcome: 'PAY' | 'RELEASE'): Promise<void> {
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', run.drop_id).executeTakeFirstOrThrow();
    const own = this.run?.id === run.id ? this.run.bots.find((b) => b.accountId === member.account_id) : undefined;
    if (own?.pending) await own.pending;
    const plan = { ...(member.plan as BotPlan), outcome };
    const bot: Bot = own ?? { accountId: member.account_id, email: member.email, plan, step: 'WATCH', at: 0, busy: false, pending: null, session: null, token: null, leaveAt: Infinity, now: true };
    bot.plan = plan;
    bot.now = true;
    bot.busy = true;
    if (bot.step === 'DONE' || bot.step === 'ARRIVE') bot.step = 'WATCH';
    bot.at = 0;
    const acting = (b: Bot) => b.step !== 'DONE';
    const active: ActiveRun = this.run?.id === run.id ? this.run : { id: run.id, drop: d, mode: d.mode, addons: [], bots: [], cursor: 0, peaksSavedAt: 0 };
    try {
      for (let steps = 0; steps < 8 && acting(bot); steps++) {
        const wait = bot.at - this.now().getTime();
        if (wait > 0) await this.sleep(wait);
        await this.act(active, bot);
      }
    } finally {
      bot.busy = false;
    }
  }

  // ── The draw's confirmations by themselves ───────────────────────────────

  /**
   * The sweeper (every SWEEP_MS, from the database: a restart changes nothing): while a draw's test is RUNNING or DONE,
   * each of its test entrants holding a SELECTED place and drawn to confirm gets its time, 5 to 60 s ahead; once due,
   * the staff's Confirm (DropService) with the test's ADMIN as actor creates its order. One pass at a time. Returns the
   * places confirmed.
   */
  sweep(): Promise<number> {
    this.sweeping ??= this.sweepOnce().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async sweepOnce(): Promise<number> {
    const waiting = await this.db.selectFrom('test_runs').select('id').where('status', 'in', ['RUNNING', 'DONE']).where('mode', '=', 'DRAW').limit(1).executeTakeFirst();
    if (!waiting) return 0;
    const now = this.now();
    await sql`
      UPDATE test_run_entrants AS r
         SET confirm_due_at = ${now}::timestamptz + make_interval(secs => ${TEST_CONFIRM_DELAY_S.min} + floor(random() * ${TEST_CONFIRM_DELAY_S.max - TEST_CONFIRM_DELAY_S.min + 1})),
             updated_at = ${now}
        FROM test_runs AS x, drop_entries AS e
       WHERE x.id = r.run_id AND x.status IN ('RUNNING', 'DONE') AND x.mode = 'DRAW'
         AND e.drop_id = x.drop_id AND e.account_id = r.account_id AND e.status = 'SELECTED'
         AND r.confirm_due_at IS NULL AND r.plan @> '{"confirm": true}'::jsonb`.execute(this.db);
    const due = await this.db
      .selectFrom('test_run_entrants as r')
      .innerJoin('test_runs as x', 'x.id', 'r.run_id')
      .innerJoin('drop_entries as e', (j) => j.onRef('e.drop_id', '=', 'x.drop_id').onRef('e.account_id', '=', 'r.account_id'))
      .innerJoin('accounts as a', 'a.id', 'r.account_id')
      .select(['r.run_id', 'r.account_id', 'x.drop_id', 'x.created_by', 'e.id as entry_id', 'a.email'])
      .where('x.status', 'in', ['RUNNING', 'DONE'])
      .where('x.mode', '=', 'DRAW')
      .where('e.status', '=', 'SELECTED')
      .where('r.confirm_due_at', '<=', now)
      .where((eb) => eb.or([eb('r.outcome', 'is', null), eb('r.outcome', '!=', 'NOT_CONFIRMED')]))
      .orderBy('r.confirm_due_at')
      .limit(CHUNK)
      .execute();
    let confirmed = 0;
    for (const p of due) {
      try {
        await this.ctx.services.drops.confirm(p.drop_id, p.entry_id, null, { type: 'admin', id: p.created_by });
        await this.outcome(p.run_id, p.account_id, 'CONFIRMED');
        confirmed++;
      } catch (e) {
        this.error(p.run_id, `CONFIRM refused for ${p.email}: ${e instanceof DomainError ? e.code : (e as Error)?.message}`);
        await this.outcome(p.run_id, p.account_id, 'NOT_CONFIRMED');
      }
    }
    return confirmed;
  }

  // ── END TEST ─────────────────────────────────────────────────────────────

  /**
   * The clean-up of the test's accounts in release `d`, each step through the path that does it for anyone: the open
   * orders cancelled one by one (OrderService), a LIVE RELEASE's open entries REMOVED (LiveService) and the I'LL BE THERE
   * withdrawn before T0, a draw's ENTERED entries WITHDRAWN and its places LAPSED (under the release's lock, as a lock
   * of an account withdraws them), the sessions ended. Returns what it did.
   */
  private async cleanUp(d: DropRow, accounts: readonly string[], actor: Actor) {
    const cleaned = { ordersCancelled: 0, entriesWithdrawn: 0, placesLapsed: 0, entriesRemoved: 0, interestWithdrawn: 0, sessionsEnded: 0 };
    if (accounts.length === 0) return cleaned;
    if (d.mode === 'LIVE') {
      for (const ids of chunks(accounts)) {
        const open = await this.db.selectFrom('live_entries').select('id').where('drop_id', '=', d.id).where('account_id', 'in', ids).where('status', 'in', [...LIVE_OPEN_STATUSES]).execute();
        for (const e of open) {
          try {
            await this.ctx.services.live.remove(d.id, e.id, actor);
            cleaned.entriesRemoved++;
          } catch (err) {
            if (!(err instanceof DomainError)) throw err;
          }
        }
      }
      cleaned.interestWithdrawn = await this.withdrawInterest(d, accounts, actor);
    }
    for (const ids of chunks(accounts)) {
      const orders = await this.db.selectFrom('orders').select('id').where('drop_id', '=', d.id).where('account_id', 'in', ids).where('status', 'in', ['RESERVED', 'PAID']).orderBy('reserved_at').execute();
      for (const o of orders) {
        await this.ctx.services.orders.transition(o.id, { to: 'CANCELLED', note: END_ORDER_NOTE }, actor);
        cleaned.ordersCancelled++;
      }
    }
    if (d.mode === 'DRAW') Object.assign(cleaned, await this.closeDrawEntries(d, accounts, actor));
    for (const ids of chunks(accounts)) {
      const r = await this.db.deleteFrom('sessions').where('subject_type', '=', 'account').where('subject_id', 'in', ids).executeTakeFirst();
      cleaned.sessionsEnded += Number(r.numDeletedRows);
    }
    return cleaned;
  }

  /**
   * A draw's entries of the test's accounts closed, under the release's row lock (FOR UPDATE, as the console's actions
   * take it): ENTERED → WITHDRAWN; SELECTED, CONFIRMED and WAITLISTED → LAPSED with `respond_by` and `handled_at` now
   * (`drop_entries_lapsed`: a place lapses at or after its time), the rank kept (the draw's public list is unchanged).
   * Audited `drop.withdraw` and `drop.entry.lapse` with `reason: "test_ended"`.
   */
  private async closeDrawEntries(d: DropRow, accounts: readonly string[], actor: Actor): Promise<{ entriesWithdrawn: number; placesLapsed: number }> {
    return inTransaction(this.db, async (tx) => {
      await tx.selectFrom('drops').select('id').where('id', '=', d.id).forUpdate().execute();
      const now = this.now();
      const withdrawn: { id: string }[] = [];
      const lapsed: { id: string; rank: number | null; status: string }[] = [];
      for (const ids of chunks(accounts)) {
        const before = await tx
          .selectFrom('drop_entries')
          .select(['id', 'rank', 'status'])
          .where('drop_id', '=', d.id)
          .where('account_id', 'in', ids)
          .where('status', 'in', ['SELECTED', 'CONFIRMED', 'WAITLISTED'])
          .forUpdate()
          .execute();
        withdrawn.push(...(await tx.updateTable('drop_entries').set({ status: 'WITHDRAWN' }).where('drop_id', '=', d.id).where('account_id', 'in', ids).where('status', '=', 'ENTERED').returning('id').execute()));
        if (before.length) {
          await tx
            .updateTable('drop_entries')
            .set({ status: 'LAPSED', respond_by: now, handled_at: now, handled_by: actor.id!, note: END_NOTE })
            .where('id', 'in', before.map((e) => e.id))
            .execute();
          lapsed.push(...before);
        }
      }
      for (const e of withdrawn) await this.ctx.audit.record({ actor, action: 'drop.withdraw', targetType: 'drop', targetId: d.id, details: { entryId: e.id, reason: 'test_ended' } }, tx);
      for (const e of lapsed) {
        await this.ctx.audit.record({ actor, action: 'drop.entry.lapse', targetType: 'drop', targetId: d.id, details: { entryId: e.id, rank: e.rank, from: e.status, reason: 'test_ended' } }, tx);
      }
      return { entriesWithdrawn: withdrawn.length, placesLapsed: lapsed.length };
    });
  }

  /** The test's I'LL BE THERE in a LIVE RELEASE not opened yet, withdrawn (audited `drop.live.interest.withdraw`, `reason: "test_ended"`). */
  private async withdrawInterest(d: DropRow, accounts: readonly string[], actor: Actor): Promise<number> {
    if (this.now().getTime() >= d.opens_at.getTime()) return 0;
    return inTransaction(this.db, async (tx) => {
      let n = 0;
      for (const ids of chunks(accounts)) {
        const gone = await tx.deleteFrom('live_interest').where('drop_id', '=', d.id).where('account_id', 'in', ids).returning('account_id').execute();
        for (const _ of gone) await this.ctx.audit.record({ actor, action: 'drop.live.interest.withdraw', targetType: 'drop', targetId: d.id, details: { reason: 'test_ended' } }, tx);
        n += gone.length;
      }
      return n;
    });
  }

  // ── The TEST REPORT ──────────────────────────────────────────────────────

  /** The five checks over the whole release `d` (real and test entries together), now. */
  async report(d: DropRow, now: Date): Promise<Omit<TestReport, 'peaks'>> {
    const checks = d.mode === 'DRAW' ? await this.drawChecks(d) : await this.liveChecks(d, now);
    const passed = checks.filter((c) => c.pass).length;
    return { at: now, checks, passed, total: checks.length };
  }

  private async drawChecks(d: DropRow): Promise<TestReportCheck[]> {
    const entries = await this.db.selectFrom('drop_entries').select(['id', 'account_id', 'status', 'tier', 'seniority', 'rank']).where('drop_id', '=', d.id).execute();
    const checks: TestReportCheck[] = [oneEntry(entries)];

    // 2. The draw's order: tier, then seniority, then the seed's key, recomputed from the seed it revealed.
    if (!d.drawn_at || !d.seed) {
      checks.push({ id: 'ORDER', label: 'The draw’s order', pass: true, line: 'Not drawn yet: nothing to check.' });
    } else {
      const ranked = entries.filter((e) => e.rank !== null).sort((a, b) => a.rank! - b.rank!);
      const seed = toBytes(d.seed);
      const recomputed = drawOrder(ranked.map((e) => ({ id: e.id, tier: (e.tier ?? 0) as ClubTier, seniority: e.seniority ?? 0 })), seed);
      const out = ranked.findIndex((e, i) => i > 0 && ((ranked[i - 1]!.tier ?? 0) < (e.tier ?? 0) || ((ranked[i - 1]!.tier ?? 0) === (e.tier ?? 0) && (ranked[i - 1]!.seniority ?? 0) < (e.seniority ?? 0))));
      const moved = recomputed.findIndex((c, i) => c.id !== ranked[i]!.id.toLowerCase() || c.rank !== ranked[i]!.rank);
      checks.push(
        out >= 0
          ? { id: 'ORDER', label: 'The draw’s order', pass: false, line: `Rank ${ranked[out]!.rank} stands above a higher tier or seniority.` }
          : moved >= 0
            ? { id: 'ORDER', label: 'The draw’s order', pass: false, line: `Rank ${ranked[moved]!.rank} is not where the seed puts it.` }
            : { id: 'ORDER', label: 'The draw’s order', pass: true, line: `${count(ranked.length, 'entry', 'entries')} ranked by tier, then seniority, then the seed: the order checks out.` },
      );
    }

    // 3. Nobody holds two places.
    const places = new Map<string, number>();
    for (const e of entries) if (e.status === 'SELECTED' || e.status === 'CONFIRMED') places.set(e.account_id, (places.get(e.account_id) ?? 0) + 1);
    const twice = [...places.values()].filter((n) => n > 1).length;
    checks.push(onePlace(twice, ''));

    // 4. Stock: the places held or sold within the release's pieces, one order per confirmed place, no stock below zero.
    const held = entries.filter((e) => e.status === 'SELECTED' || e.status === 'CONFIRMED').length;
    const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
    const orders = await this.db
      .selectFrom('orders as o')
      .innerJoin('drop_entries as e', 'e.id', 'o.drop_entry_id')
      .select(['o.id', 'o.drop_entry_id', 'o.sku_id', 'o.location_id', 'o.reservation'])
      .where('e.drop_id', '=', d.id)
      .execute();
    const forConfirmed = orders.filter((o) => confirmed.some((e) => e.id === o.drop_entry_id)).length;
    const negative = await this.negativeStock(orders);
    checks.push(
      stock(
        held <= d.quantity && forConfirmed === confirmed.length && negative === 0,
        held > d.quantity
          ? `${count(held, 'place')} held or sold for ${count(d.quantity, 'piece')}.`
          : forConfirmed !== confirmed.length
            ? `${count(confirmed.length, 'place')} confirmed, ${count(forConfirmed, 'order')}.`
            : negative > 0
              ? `${negative} stock ${negative === 1 ? 'line is' : 'lines are'} below zero.`
              : `${held} of ${count(d.quantity, 'place')} held or sold, ${confirmed.length} confirmed with ${count(forConfirmed, 'order')}; no stock below zero.`,
      ),
    );

    // 5. Every confirmed place has its order.
    const missing = confirmed.filter((e) => !orders.some((o) => o.drop_entry_id === e.id)).length;
    checks.push(ordersCheck(missing, confirmed.length));
    return checks;
  }

  private async liveChecks(d: DropRow, now: Date): Promise<TestReportCheck[]> {
    const entries = await this.db
      .selectFrom('live_entries')
      .select(['id', 'account_id', 'status', 'quantity', 'tier', 'position', 'queued_at', 'size_id'])
      .where('drop_id', '=', d.id)
      .execute();
    const checks: TestReportCheck[] = [oneEntry(entries)];

    // 2. The line at T0: by tier (high first) when the release gives tier priority.
    const atT0 = entries.filter((e) => e.position !== null && e.queued_at !== null && new Date(e.queued_at).getTime() === d.opens_at.getTime()).sort((a, b) => a.position! - b.position!);
    if (now.getTime() < d.opens_at.getTime() || atT0.length === 0) {
      checks.push({ id: 'ORDER', label: 'The line’s order', pass: true, line: 'The line has not formed yet: nothing to check.' });
    } else if (d.tier_priority === false) {
      checks.push({ id: 'ORDER', label: 'The line’s order', pass: true, line: `${atT0.length} in the line at T0, the tiers together (no tier priority).` });
    } else {
      const out = atT0.findIndex((e, i) => i > 0 && atT0[i - 1]!.tier < e.tier);
      checks.push(
        out >= 0
          ? { id: 'ORDER', label: 'The line’s order', pass: false, line: `Place ${atT0[out]!.position} stands behind a lower tier.` }
          : { id: 'ORDER', label: 'The line’s order', pass: true, line: `${atT0.length} placed at T0 by tier, the highest first.` },
      );
    }

    // 3. Nobody holds two places: one open or confirmed entry per account, the release and its after-room together; 1 to 5 pieces each.
    const children = await this.db.selectFrom('drops').select('id').where('parent_drop_id', '=', d.id).execute();
    const family = children.length
      ? await this.db.selectFrom('live_entries').select(['account_id', 'status']).where('drop_id', 'in', [d.id, ...children.map((c) => c.id)]).execute()
      : entries;
    const holding = new Map<string, number>();
    for (const e of family) if ((LIVE_OPEN_STATUSES as readonly string[]).includes(e.status) || e.status === 'CONFIRMED') holding.set(e.account_id, (holding.get(e.account_id) ?? 0) + 1);
    const twice = [...holding.values()].filter((n) => n > 1).length;
    const perAccount = d.per_account ?? LIVE_PER_ACCOUNT.max;
    const outOfBounds = entries.filter((e) => e.quantity < 1 || e.quantity > perAccount).length;
    checks.push(
      outOfBounds > 0
        ? { id: 'ONE_PLACE', label: 'Nobody holds two places', pass: false, line: `${outOfBounds} ${outOfBounds === 1 ? 'entry asks' : 'entries ask'} for pieces outside 1 to ${perAccount}.` }
        : onePlace(twice, `; every entry asks for 1 to ${perAccount} pieces`),
    );

    // 4. Stock: per size, the pieces in a turn, held or sold within its stock; one order per piece confirmed; no stock below zero.
    const sizes = await this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', d.id).execute();
    const over = sizes.filter((z) => entries.filter((e) => e.size_id === z.id && (e.status === 'TURN' || e.status === 'SECURED' || e.status === 'CONFIRMED')).reduce((n, e) => n + e.quantity, 0) > z.stock);
    const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
    const pieces = confirmed.reduce((n, e) => n + e.quantity, 0);
    const orders = await this.db
      .selectFrom('orders as o')
      .innerJoin('live_entries as e', 'e.id', 'o.live_entry_id')
      .select(['o.id', 'o.live_entry_id', 'o.sku_id', 'o.location_id', 'o.reservation'])
      .where('e.drop_id', '=', d.id)
      .execute();
    const forConfirmed = orders.filter((o) => confirmed.some((e) => e.id === o.live_entry_id)).length;
    const negative = await this.negativeStock(orders);
    checks.push(
      stock(
        over.length === 0 && forConfirmed === pieces && negative === 0,
        over.length > 0
          ? `Size ${over[0]!.label}: more pieces held or sold than its ${over[0]!.stock}.`
          : forConfirmed !== pieces
            ? `${count(pieces, 'piece')} confirmed, ${count(forConfirmed, 'order')}.`
            : negative > 0
              ? `${negative} stock ${negative === 1 ? 'line is' : 'lines are'} below zero.`
              : `${count(pieces, 'piece')} confirmed with ${count(forConfirmed, 'order')}, every size within its stock; no stock below zero.`,
      ),
    );

    // 5. Every confirmed place has its orders, one per piece.
    const missing = confirmed.filter((e) => orders.filter((o) => o.live_entry_id === e.id).length < e.quantity).length;
    checks.push(ordersCheck(missing, confirmed.length));
    return checks;
  }

  /** The stock lines (a SKU at a location) of `orders` whose available count is below zero. */
  private async negativeStock(orders: readonly { sku_id: string | null; location_id: string }[]): Promise<number> {
    const pairs = [...new Map(orders.filter((o) => o.sku_id !== null).map((o) => [`${o.sku_id} ${o.location_id}`, o])).values()];
    let negative = 0;
    for (const o of pairs) {
      const level = await stockLevel(this.db, o.sku_id!, o.location_id);
      if (level.onHand < 0 || level.available < 0) negative++;
    }
    return negative;
  }
}

// ── The report's lines ─────────────────────────────────────────────────────

/** `1 order`, `3 orders`; `1 entry`, `3 entries`. */
const count = (n: number, word: string, words = `${word}s`): string => `${n} ${n === 1 ? word : words}`;

function oneEntry(entries: readonly { account_id: string }[]): TestReportCheck {
  const accounts = new Set(entries.map((e) => e.account_id)).size;
  return entries.length === accounts
    ? { id: 'ONE_ENTRY', label: 'One entry per account', pass: true, line: `${count(entries.length, 'entry', 'entries')}, ${count(accounts, 'account')}: one each.` }
    : { id: 'ONE_ENTRY', label: 'One entry per account', pass: false, line: `${count(entries.length, 'entry', 'entries')} for ${count(accounts, 'account')}: ${entries.length - accounts} too many.` };
}

function onePlace(twice: number, more: string): TestReportCheck {
  return twice === 0
    ? { id: 'ONE_PLACE', label: 'Nobody holds two places', pass: true, line: `Nobody holds two places${more}.` }
    : { id: 'ONE_PLACE', label: 'Nobody holds two places', pass: false, line: `${twice} ${twice === 1 ? 'account holds' : 'accounts hold'} two places.` };
}

function stock(pass: boolean, line: string): TestReportCheck {
  return { id: 'STOCK', label: 'Stock matches the orders', pass, line };
}

function ordersCheck(missing: number, confirmed: number): TestReportCheck {
  return missing === 0
    ? { id: 'ORDERS', label: 'Every confirmed place has its order', pass: true, line: `${confirmed} confirmed ${confirmed === 1 ? 'place has its order' : 'places have their orders'}.` }
    : { id: 'ORDERS', label: 'Every confirmed place has its order', pass: false, line: `${missing} of ${confirmed} confirmed ${confirmed === 1 ? 'place has' : 'places have'} no order.` };
}
