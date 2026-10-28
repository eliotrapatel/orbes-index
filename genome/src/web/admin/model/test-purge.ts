/**
 * TEST PURGE in the console (lot PURGE, plan §A.6; the owner's answers of 27 Oct 2026, answer 4 and Claude's points 1,
 * 6 and 7), pure: what the PAST TESTS rows of a release and the Ended tests page (`#/settings/tests`) say of a test's
 * purge, which button they show, and the words of the two dialogs (views/test-entrants.ts, views/ended-tests.ts).
 *
 *  - A test's status: its own (ENDED) until its purge is asked, then PURGING (asked when and by whom, the rows deleted
 *    so far), PAUSED (its reason in the server's words, Paris time first: the night's end computed for the date) or
 *    PURGED ("Purged 28 OCT 2026 · 14:05 Paris by …"). An ended test that cannot be purged says why in a muted line
 *    (its release not over; a drawn draw holding real collectors' entries: test releases only, G1).
 *  - PURGE (ADMIN) when the server says it can be pressed; on a PAUSED purge the same request resumes it.
 *  - The dialogs: the phrase (PURGE TEST <the test's first 8>, PURGE ALL TESTS), the authenticator code (a fresh one:
 *    the code of the sign-in was used), what goes and what stays, a drawn draw's ranked list, the orders that keep their
 *    accounts, a window or a running test that would refuse it now; PURGE ALL: how many tests, how many of them are of
 *    a drawn draw, which are skipped and why, and at most how many of the pool's test accounts go.
 */
import { formatCount, humanize } from '../format.js';
import type { AdminRole, EndedTestRun, TestPurgeAllPreview, TestPurgePreview, TestRunPurge, TestRunSummary } from '../types.js';
import type { DialogField } from '../ui/dialog.js';
import { parisDateTime } from './links.js';
import { can } from './permissions.js';

/** The Ended tests page's words (views/ended-tests.ts). */
export const ENDED_TESTS_TEXT = Object.freeze({
  lead: 'Every ended test of every release. PURGE deletes a test’s entries, its cancelled orders, its sessions and its audit entries, a trace of each kept; its report stays here. Everyone reads this page; an ADMIN purges.',
  empty: 'No ended test.',
  unread: 'The tests could not be read just now: they are asked again every 2 seconds.',
});

/** The phrase of PURGE ALL ENDED TESTS. */
export const PURGE_ALL_PHRASE = 'PURGE ALL TESTS';

/** The phrase of one test's PURGE: `PURGE TEST 1A2B3C4D` (the test's id, its first 8 characters), as the server checks it. */
export function purgePhrase(runId: string): string {
  return `PURGE TEST ${runId.slice(0, 8).toUpperCase()}`;
}

/**
 * The authenticator code of a purge's dialog: the dialog's `code` field (one-time-code, numeric, mono), with its hint
 * that a code just used at sign-in is good no more (wait for the next one).
 */
export function purgeCodeField(): DialogField {
  return { name: 'totp', label: 'Authenticator code', kind: 'code', required: true };
}

/** The code typed, its spaces removed (`000 000` is read as `000000`). */
export function typedCode(v: Record<string, string>): string {
  return (v.totp ?? '').replace(/\s+/g, '');
}

/** What blocks a code before it is sent (6 to 8 digits, as the server reads it), or null. */
export function codeProblem(v: Record<string, string>): string | null {
  return /^\d{6,8}$/.test(typedCode(v)) ? null : 'Enter the six digits from your authenticator app.';
}

/** What a purge deletes and keeps (plan §A.6), one test. */
export const PURGE_WHAT =
  'Deletes this test’s entries, its cancelled orders with their events, its sessions and its audit entries (a trace of each entry stays, so the audit check still proves nothing else was removed). Its report stays here. Test accounts no other test uses are deleted.';

/** The same for PURGE ALL ENDED TESTS. */
export const PURGE_ALL_WHAT =
  'Deletes each test’s entries, its cancelled orders with their events, its sessions and its audit entries (a trace of each entry stays, so the audit check still proves nothing else was removed). Each report stays here.';

/** A drawn draw (D15): its ranked list is public. */
export const PURGE_DRAWN_LINE = 'This draw was drawn: once purged, its public ranked list no longer matches its seed.';

/** PURGE ALL's tests of a drawn draw (D15), or null when none. */
export function drawnAllLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 of these tests is of a drawn draw: once purged, its public ranked list no longer matches its seed.'
    : `${formatCount(n)} of these tests are of drawn draws: once purged, their public ranked lists no longer match their seeds.`;
}

/** The orders a purge keeps with their accounts. */
export function blockingLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 order stays with its account (an invoice, a parcel or a return holds it).'
    : `${formatCount(n)} orders stay with their accounts (an invoice, a parcel or a return holds them).`;
}

/** The reasons a muted line never states: the status says them (not ended, being purged, purged). */
const SAID_BY_STATUS: ReadonlySet<string> = new Set(['PURGE_NOT_ENDED', 'PURGE_IN_PROGRESS', 'PURGE_DONE']);

/** The pauses that clear by themselves (a window, a test running): the page reads the test again until they do. */
const SELF_CLEARING: ReadonlySet<string> = new Set(['PURGE_WINDOW', 'PURGE_TEST_RUNNING']);

type PurgeRow = Pick<TestRunSummary, 'status' | 'purge' | 'purgeable'>;

/**
 * A test's status as its row shows it: the test's own until its purge is asked, then PURGING, PAUSED or PURGED; the
 * line under it (who asked and how far it is, the pause's reason, when it was purged and by whom), and, for someone who
 * may purge, why an ended test cannot be (muted). `tone` is the tone table's key (model/tone.ts 'testRun').
 */
export function purgeStatus(x: PurgeRow, role: AdminRole | null | undefined): { tone: string; label: string; line: string | null; muted: boolean } {
  const p = x.purge ?? null;
  if (p?.state === 'DONE') return { tone: 'PURGED', label: 'PURGED', line: purgedLine(p), muted: false };
  if (p?.state === 'PAUSED') return { tone: 'PAUSED', label: 'PAUSED', line: p.message ?? 'Paused.', muted: false };
  if (p?.state === 'PURGING') return { tone: 'PURGING', label: 'PURGING', line: purgingLine(p), muted: false };
  return { tone: x.status, label: humanize(x.status), line: reasonLine(x, role), muted: true };
}

/** `Purged 28 OCT 2026 · 14:05 Paris by console@example.com` (A6.prog). */
export function purgedLine(p: Pick<TestRunPurge, 'purgedAt' | 'requestedBy'>): string {
  return `Purged ${parisDateTime(p.purgedAt)}${p.requestedBy ? ` by ${p.requestedBy}` : ''}`;
}

/** `Asked 28 OCT 2026 · 14:05 Paris by …; 1 204 rows deleted so far.` */
function purgingLine(p: TestRunPurge): string {
  const asked = `Asked ${parisDateTime(p.requestedAt)}${p.requestedBy ? ` by ${p.requestedBy}` : ''}${p.all ? ' with every ended test' : ''}`;
  const rows = p.progress?.rows ?? 0;
  return rows > 0 ? `${asked}; ${formatCount(rows)} ${rows === 1 ? 'row' : 'rows'} deleted so far.` : `${asked}.`;
}

/** Why an ended test cannot be purged, for someone who may purge (G1's words for a drawn draw holding real entries); null otherwise. */
export function reasonLine(x: PurgeRow, role: AdminRole | null | undefined): string | null {
  if (!can(role, 'purgeTests') || x.purge || x.purgeable === undefined || x.purgeable === true) return null;
  return SAID_BY_STATUS.has(x.purgeable.reason) ? null : x.purgeable.message;
}

/**
 * The button a row shows: PURGE, RESUME PURGE on a purge stopped for good that the server would resume (a step the
 * database refused), or none; a purge paused for a window or a running test goes on by itself (no button).
 */
export function purgeAction(x: PurgeRow, role: AdminRole | null | undefined): 'purge' | 'resume' | null {
  if (!can(role, 'purgeTests') || x.purgeable !== true) return null;
  if (x.purge?.state === 'PAUSED') return SELF_CLEARING.has(x.purge.reason ?? '') ? null : 'resume';
  return x.purge ? null : 'purge';
}

/** Whether a purge of these rows is under way (PURGING, or paused until a window or a running test clears): read them again every 2 s. */
export function purgeUnderWay(rows: readonly PurgeRow[]): boolean {
  return rows.some((r) => r.purge?.state === 'PURGING' || (r.purge?.state === 'PAUSED' && SELF_CLEARING.has(r.purge.reason ?? '')));
}

/** PURGE ALL ENDED TESTS on the Ended tests page: for an ADMIN, while one ended test at least can be purged. */
export function canPurgeAll(rows: readonly PurgeRow[], role: AdminRole | null | undefined): boolean {
  return can(role, 'purgeTests') && rows.some((r) => r.purgeable === true);
}

/** One test's dialog: its title, its lines (what goes, a drawn draw, the orders kept), the window or running test now. */
export function purgeDialogText(preview: Pick<TestPurgePreview, 'drawn' | 'blockingOrders' | 'hold'>, resume: TestRunPurge | null): { title: string; confirm: string; lines: string[]; hold: string | null } {
  const lines = [
    ...(resume ? [resume.message ?? 'This purge is paused.', 'Resuming goes on where it stopped; nothing already deleted comes back.'] : []),
    PURGE_WHAT,
    ...(preview.drawn ? [PURGE_DRAWN_LINE] : []),
    ...[blockingLine(preview.blockingOrders)].filter((l): l is string => l !== null),
  ];
  return { title: resume ? 'Resume the purge' : 'Purge the test', confirm: resume ? 'Resume purge' : 'Purge test', lines, hold: preview.hold?.message ?? null };
}

/**
 * PURGE ALL's dialog: how many tests (and paused purges resumed), what goes, how many are of a drawn draw (D15), the
 * pool's accounts, and each test skipped with its release and its words.
 */
export function purgeAllDialogText(preview: TestPurgeAllPreview, rows: readonly Pick<EndedTestRun, 'id' | 'dropName' | 'endedAt'>[]): { lines: string[]; skipped: string[]; hold: string | null } {
  const n = preview.runs.length;
  const r = preview.resumed.length;
  const tests = n === 1 ? '1 ended test is purged' : `${formatCount(n)} ended tests are purged`;
  const goOn = r === 1 ? '1 paused purge goes on' : `${formatCount(r)} paused purges go on`;
  const first = n > 0 ? (r > 0 ? `${tests}, and ${goOn}.` : `${tests}.`) : r > 0 ? `${goOn.charAt(0).toUpperCase()}${goOn.slice(1)}.` : 'No ended test can be purged now.';
  const byId = new Map(rows.map((x) => [x.id, x]));
  const skipped = preview.skipped.map((s) => {
    const row = byId.get(s.runId);
    return `${row ? `${row.dropName} · ended ${parisDateTime(row.endedAt)}` : `Test ${s.runId.slice(0, 8).toUpperCase()}`}: ${s.message}`;
  });
  const k = preview.skipped.length;
  return {
    lines: [
      first,
      PURGE_ALL_WHAT,
      ...[drawnAllLine(preview.drawn)].filter((l): l is string => l !== null),
      preview.accounts > 0
        ? `Then the test pool’s accounts no other test uses are deleted: up to ${formatCount(preview.accounts)} (an order, the founding list or an invitation keeps an account).`
        : 'No test account of the pool is deleted now: a test that stays still uses each of them.',
      ...(k > 0 ? [k === 1 ? '1 ended test is skipped:' : `${formatCount(k)} ended tests are skipped:`] : []),
    ],
    skipped,
    hold: preview.hold?.message ?? null,
  };
}
