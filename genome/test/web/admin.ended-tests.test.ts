/**
 * The Ended tests page of the console, `#/settings/tests` (lot PURGE, step PURGE.7, plan §A.6; views/ended-tests.ts,
 * model/test-purge.ts), pure:
 *
 *  - its address, reached from the Settings page (no link of its own in the sidebar);
 *  - its words: the lead, the empty state ("No ended test."), the line said while a read fails (the page reads again
 *    every 2 s while a purge is under way; the loading and the failure of the first read are the console's own);
 *  - PURGE ALL ENDED TESTS: for an ADMIN only, while one ended test at least can be purged; its dialog says how many
 *    tests it purges and how many paused purges go on, what goes and what stays, at most how many of the pool's test
 *    accounts go, each test skipped with its release, when it ended (Paris) and the server's words for why, and a
 *    window or a running test that would refuse it now.
 */
import { describe, expect, it } from 'vitest';
import { can } from '../../src/web/admin/model/permissions.js';
import { canPurgeAll, ENDED_TESTS_TEXT, PURGE_ALL_PHRASE, PURGE_ALL_WHAT, purgeAllDialogText } from '../../src/web/admin/model/test-purge.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import type { EndedTestRun, TestPurgeAllPreview } from '../../src/web/admin/types.js';

const A = '1a2b3c4d-0000-4000-8000-000000000001';
const B = '2b3c4d5e-0000-4000-8000-000000000002';
const C = '3c4d5e6f-0000-4000-8000-000000000003';

function run(id: string, p: Partial<EndedTestRun> = {}): EndedTestRun {
  return {
    id,
    status: 'ENDED',
    createdAt: '2026-10-27T09:00:00.000Z',
    endedAt: '2026-10-27T10:00:00.000Z',
    createdBy: 'console@example.com',
    entrants: 12,
    checksPassed: 5,
    checksTotal: 5,
    report: null,
    purge: null,
    purgeable: true,
    dropId: '9f8e7d6c-0000-4000-8000-0000000000aa',
    dropName: 'MONOLITHE — release I',
    mode: 'DRAW',
    ...p,
  };
}

const preview = (p: Partial<TestPurgeAllPreview> = {}): TestPurgeAllPreview => ({ runs: [A], resumed: [], skipped: [], hold: null, accounts: 12, ...p });

describe('the Ended tests page', () => {
  it('is #/settings/tests, reached from the Settings page', () => {
    expect(href('endedTests')).toBe('#/settings/tests');
    expect(parseHash('#/settings/tests').name).toBe('endedTests');
    expect(parseHash('#/settings').name).toBe('settings');
    expect(parseHash('#/settings/emails').name).toBe('emailSettings');
  });

  it('says what it is, that it is empty, and that a read failed', () => {
    expect(ENDED_TESTS_TEXT).toEqual({
      lead: 'Every ended test of every release. PURGE deletes a test’s entries, its cancelled orders, its sessions and its audit entries, a trace of each kept; its report stays here. Everyone reads this page; an ADMIN purges.',
      empty: 'No ended test.',
      unread: 'The tests could not be read just now: they are asked again every 2 seconds.',
    });
  });

  it('offers PURGE ALL ENDED TESTS to an ADMIN while one ended test at least can be purged (a paused one too)', () => {
    const notTest = { reason: 'PURGE_NOT_TEST', message: 'This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.' };
    expect(canPurgeAll([run(A)], 'ADMIN')).toBe(true);
    expect(canPurgeAll([run(A, { purgeable: notTest }), run(B, { purge: { state: 'PAUSED', reason: 'SQLSTATE_23503', message: 'Stopped.', requestedAt: null, requestedBy: null, purgedAt: null, all: false, deleted: null, kept: null, progress: null }, purgeable: true })], 'ADMIN')).toBe(true);
    expect(canPurgeAll([run(A, { purgeable: notTest }), run(B, { purgeable: { reason: 'PURGE_DONE', message: 'This test is already purged.' } })], 'ADMIN')).toBe(false);
    expect(canPurgeAll([], 'ADMIN')).toBe(false);
    for (const role of ['OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const) expect(canPurgeAll([run(A)], role), role).toBe(false);
    expect(can('ADMIN', 'purgeTests')).toBe(true);
    expect(PURGE_ALL_PHRASE).toBe('PURGE ALL TESTS');
  });

  it('says in PURGE ALL’s dialog how many tests, the paused purges resumed, what goes, the pool’s accounts, each test skipped with its release (Paris) and why, and a window now', () => {
    const rows = [
      run(A),
      run(B, { dropName: 'THE VAULT RING', mode: 'LIVE', endedAt: '2026-07-14T10:00:00.000Z' }),
      run(C, { dropName: 'MONOLITHE — release II', endedAt: '2026-10-28T14:05:00.000Z' }),
    ];
    expect(purgeAllDialogText(preview(), rows)).toEqual({
      lines: [
        '1 ended test is purged.',
        PURGE_ALL_WHAT,
        'Then the test pool’s accounts no other test uses are deleted: up to 12 (an order, the founding list or an invitation keeps an account).',
      ],
      skipped: [],
      hold: null,
    });
    expect(PURGE_ALL_WHAT).toBe(
      'Deletes each test’s entries, its cancelled orders with their events, its sessions and its audit entries (a trace of each entry stays, so the audit check still proves nothing else was removed). Each report stays here.',
    );
    const night = "The platform's night maintenance runs from 04:00 to 06:30 Paris (03:00–05:30 UTC). Try again at 06:30.";
    const text = purgeAllDialogText(
      preview({
        runs: [A, C],
        resumed: [B],
        skipped: [
          { runId: B, reason: 'PURGE_RELEASE_NOT_OVER', message: 'Purge once the release is over.' },
          { runId: C, reason: 'PURGE_NOT_TEST', message: 'This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.' },
          { runId: '4d5e6f70-0000-4000-8000-000000000004', reason: 'PURGE_RUNS_NOT_ENDED', message: 'Another test of this release has not ended. END TEST on it first.' },
        ],
        hold: { reason: 'PURGE_WINDOW', message: night },
        accounts: 1204,
      }),
      rows,
    );
    expect(text.lines[0]).toBe('2 ended tests are purged, and 1 paused purge goes on.');
    expect(text.lines.at(-1)).toBe('3 ended tests are skipped:');
    expect(text.lines[2]).toMatch(/^Then the test pool’s accounts no other test uses are deleted: up to 1.204 \(/);
    // Each skipped test by its release and when it ended, Paris time (summer: UTC + 2; winter: UTC + 1), with the server's words.
    expect(text.skipped).toEqual([
      'THE VAULT RING · ended 14 JUL 2026 · 12:00 Paris: Purge once the release is over.',
      'MONOLITHE — release II · ended 28 OCT 2026 · 15:05 Paris: This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.',
      'Test 4D5E6F70: Another test of this release has not ended. END TEST on it first.',
    ]);
    expect(text.hold).toBe(night);
    expect(purgeAllDialogText(preview({ runs: [], resumed: [A, B] }), rows).lines[0]).toBe('2 paused purges go on.');
    expect(purgeAllDialogText(preview({ runs: [], resumed: [A] }), rows).lines[0]).toBe('1 paused purge goes on.');
    expect(purgeAllDialogText(preview({ runs: [A, B, C] }), rows).lines[0]).toBe('3 ended tests are purged.');
    expect(purgeAllDialogText(preview({ runs: [] }), rows).lines[0]).toBe('No ended test can be purged now.');
    // Every account of the pool still used by a test that stays.
    expect(purgeAllDialogText(preview({ accounts: 0 }), rows).lines[2]).toBe('No test account of the pool is deleted now: a test that stays still uses each of them.');
    expect(purgeAllDialogText(preview({ skipped: [{ runId: B, reason: 'PURGE_RELEASE_NOT_OVER', message: 'Purge once the release is over.' }] }), rows).lines.at(-1)).toBe('1 ended test is skipped:');
  });
});
