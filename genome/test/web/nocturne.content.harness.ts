/**
 * NOCTURNE's content test (plan NOCTURNE, fidelity rule 4: every field and every state), shared by its files. The
 * baseline (test/fixtures/nocturne-baseline.json, recorded by scripts/parity.ts --baseline: first on the app as it was
 * before NOCTURNE, 5efd4c9; again at NEXT-NINE step 0 on NOCTURNE's final commit, 52697e3, and at the end of each later
 * step that changes a collector screen) holds every text value each state of /verify and /legal showed on the NOCTURNE
 * demo; the test reaches
 * each state again (test/support/nocturne-states.ts) and checks that each value is still shown there (shows: within one
 * block of words, on word boundaries, case-insensitive, whitespace folded, a value « A · B » shown whole or part by part,
 * the parts the server writes («id», «ref», «code»…) read as any text of their shape).
 *
 * The states are run in shards (CONTENT_SHARDS), one test file each (test/web/nocturne.content-<shard>.e2e.test.ts), so
 * vitest's forks run them side by side, each within its own time limit; test/web/nocturne.content.e2e.test.ts checks that
 * the shards hold every state once. A shard keeps the states of a variant that write (`mutates`) together and in order:
 * each one finds the demo as the states before it in the baseline's run left it. The phone's states run in the phone's
 * shards; a computer's (desk-*, desktop) in the shards desk-1 … desk-12 (test/support/nocturne-states.ts DESK_GROUPS).
 *
 * Nothing may disappear but what MOVED lists: a value moved (or removed) on purpose, with its reason and its new place.
 * Each entry names a value of the baseline, so the list can never excuse a value that was not there. A computer's state
 * made from a phone's (its desk twin) also shows every value of the phone's state, but what the desktop's DESKTOP_MOVED
 * lists (test/web/desktop.content-parity.harness.ts: the desktop's content parity, plan DESKTOP step 13).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_FILE, eachState, type Baseline } from '../support/nocturne-stage.js';
import { DESK_GROUPS, myPiecesTexts, normalizeText, openState, pageTexts, shows, UI_STATES, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';
import { parityMissing, phoneTwin } from './desktop.content-parity.harness.js';

export const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

export function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
}

/** A value moved or removed on purpose: the state it was in, the value, why, and where it is now. */
export interface Moved {
  state: string;
  value: string;
  reason: string;
  now: string;
  /** The value set apart, part by part, in the same state: each part must still be shown there. */
  shownAs?: readonly string[];
}

/**
 * N5 (plan NOCTURNE, screens 3 and 4; C3, C4, C24, C31): MY PIECES was one page, each piece with its GENOME, its tabs
 * and its declarations, then its orders, its releases and the account line. It is now split: the tabs PIECES, ORDERS
 * and RELEASES, the page of each piece (SEE THE PIECE), and the account sheet (C2) for SIGNED IN AS, CHANGE PASSWORD
 * and SIGN OUT. Each of these states showed that one page: a value not shown in the state itself is looked for in
 * every part of the account's MY PIECES (myPiecesTexts), in the same phone, right after.
 */
export const SPLIT: Readonly<{ states: readonly string[]; reason: string; now: string }> = Object.freeze({
  states: [
    'pieces',
    'pieces-warranty',
    'pieces-care',
    'pieces-service',
    'pieces-certificate-choice',
    'pieces-report-choice',
    'pieces-care-guide',
    'pieces-change-password',
    'pieces-incidents',
    'pieces-piece-found',
    'pieces-question-after',
    'pieces-turn-passed',
    'pieces-draws',
    'pieces-stress',
    'pieces-certificate-link',
    'pieces-certificate-withdrawn',
    'live-pieces-turn',
    'pieces-empty',
  ],
  reason: 'N5 (C3, C4, C24, C31): the one page of MY PIECES split into its tabs, the page of each piece and the account sheet.',
  now: 'MY PIECES: PIECES, ORDERS and RELEASES; each piece\'s page (its GENOME, its tabs, its declarations); the account sheet (SIGNED IN AS, CHANGE PASSWORD, SIGN OUT).',
});

/**
 * The values moved or removed on purpose since the baseline was recorded. Empty at NEXT-NINE step 0: NOCTURNE's moves
 * (N1 to N8) were dropped when the baseline was recorded again on NOCTURNE's final commit, since they no longer name a
 * value of it (plan NEXT-NINE, §4, the boards text-diffed). A step that removes or changes a value on purpose lists it
 * here, its reason naming the plan section and the step, until the baseline is recorded again at the step's end.
 */
export const MOVED: readonly Moved[] = [
  // ONE QUEUE (lot Q1, step Q1.3; plan §1.3, §3.3, §3.11): the classic line screen and M1's queue page give way to the one
  // queue (LIVE NOW, YOUR PLACE in your size, ESTIMATED … LEFT, the one note); SOLD OUT for your size says its one sentence.
  { state: 'live-queue', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'live-queue', value: '412', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 203' },
  { state: 'live-queue', value: 'ESTIMATED ENTRY 19:00 PARIS', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 16 MINUTES LEFT' },
  { state: 'live-queue', value: 'ABOUT 11 MIN', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 16 MINUTES LEFT' },
  { state: 'live-queue', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'live-queue-paused', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'live-queue-paused', value: '12', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 6' },
  { state: 'live-queue-paused', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'live-queue-error', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'live-queue-error', value: '412', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 203' },
  { state: 'live-queue-error', value: 'ESTIMATED ENTRY 19:00 PARIS', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 16 MINUTES LEFT' },
  { state: 'live-queue-error', value: 'ABOUT 11 MIN', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 16 MINUTES LEFT' },
  { state: 'live-queue-error', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'live-queue-stress', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'live-queue-stress', value: '4999', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 1733' },
  { state: 'live-queue-stress', value: 'ESTIMATED ENTRY 20:54 PARIS', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 2 H 11 MIN LEFT' },
  { state: 'live-queue-stress', value: 'ABOUT 2 H 05', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 2 H 11 MIN LEFT' },
  { state: 'live-queue-stress', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'live-queue-loading', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'live-queue-loading', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'set-live-line', value: '5', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 1' },
  { state: 'set-live-line', value: 'YOU ARE NEXT IN YOUR SIZES', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): never an ‘ahead of you’ line', now: 'nowhere: YOUR PLACE in your sizes says it' },
  { state: 'set-live-line', value: '2 HELD SETS MAY RETURN', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D25; ANSWERS r15, CURRENT STATE I): no held line, never a held figure', now: 'nowhere' },
  { state: 'set-live-line', value: 'When your turn comes, the seal appears here: press and hold it to secure your set. Keep this page open.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21, N2): the one merged note, in SETS’ words', now: 'When your turn comes, the seal appears here: press and hold it to secure your set. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'live-sold-out-size', value: 'YOUR PLACE 7', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size, the drawn place staying in the console', now: 'YOUR PLACE 1' },
  { state: 'live-sold-out-size', value: 'Every piece in your size is reserved. You keep your place should ORBES add one, or you may leave.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D27; ANSWERS C6, r13): the one sentence of SOLD OUT for your size', now: 'Every piece in your size is reserved. You keep your place should ORBES add more, or you may leave.' },
  { state: 'set-live-sold-out', value: 'YOUR PLACE 2', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size, the drawn place staying in the console', now: 'YOUR PLACE 1' },
  { state: 'desk-live-queue', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'desk-live-queue', value: '412', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 203' },
  { state: 'desk-live-queue', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'desk-live-queue', value: 'ESTIMATED ENTRY 19:00 PARIS', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 16 MINUTES LEFT' },
  { state: 'desk-live-queue', value: 'ABOUT 11 MIN', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D20; ANSWERS C3, r12, OP-11): never a clock time; the time left only, in the decided words', now: 'ESTIMATED 16 MINUTES LEFT' },
  { state: 'desk-live-queue-paused', value: 'THE QUEUE', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS C3, r12): never THE QUEUE overline, LIVE NOW only', now: 'LIVE NOW, the one queue’s overline' },
  { state: 'desk-live-queue-paused', value: '12', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 6' },
  { state: 'desk-live-queue-paused', value: 'Keep this page open. Your place is kept if you leave and come back.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21; ANSWERS «Kept from both screens»): the one merged note', now: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'desk-set-live-line', value: '2 HELD SETS MAY RETURN', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D25; ANSWERS r15, CURRENT STATE I): no held line, never a held figure', now: 'nowhere' },
  { state: 'desk-set-live-line', value: 'When your turn comes, the seal appears here: press and hold it to secure your set. Keep this page open.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D21, N2): the one merged note, in SETS’ words', now: 'When your turn comes, the seal appears here: press and hold it to secure your set. Keep this page open; if you close it, your place is kept when you come back.' },
  { state: 'desk-set-live-line', value: '5', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 1' },
  { state: 'desk-set-live-line', value: 'YOU ARE NEXT IN YOUR SIZES', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): never an ‘ahead of you’ line', now: 'nowhere: YOUR PLACE in your sizes says it' },
  { state: 'desk-live-sold-out-size', value: 'Every piece in your size is reserved. You keep your place should ORBES add one, or you may leave.', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D27; ANSWERS C6, r13): the one sentence of SOLD OUT for your size', now: 'Every piece in your size is reserved. You keep your place should ORBES add more, or you may leave.' },
  { state: 'desk-live-sold-out-size', value: '7', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 1' },
  { state: 'desk-set-live-sold-out', value: '2', reason: 'ONE QUEUE, lot Q1 step Q1.3 (D19; ANSWERS C3): YOUR PLACE is the place in your size (one number), the drawn place staying in the console', now: 'YOUR PLACE 1' },
  // ONE QUEUE (lot Q1, step Q1.8; plan §3.3, §3.6, §3.11): SOLD OUT for your size is titled SOLD OUT only, its size on
  // the line under it; the one queue (live-queue, MK Q1) is shown on its own release of the mockup's figures (the queue's
  // first release, every piece held, is the error, stress, no-photograph and reading states' still).
  { state: 'live-sold-out-size', value: 'SOLD OUT IN SIZE 17', reason: 'ONE QUEUE, lot Q1 step Q1.8 (D27; ANSWERS C6, r12): the title reads SOLD OUT only, never SOLD OUT IN SIZE 52', now: 'SOLD OUT, then SIZE 17 · 1 PIECE under it', shownAs: ['SOLD OUT', 'SIZE 17 · 1 PIECE'] },
  { state: 'desk-live-sold-out-size', value: 'SOLD OUT IN SIZE 17', reason: 'ONE QUEUE, lot Q1 step Q1.8 (D27; ANSWERS C6, r12): the title reads SOLD OUT only, never SOLD OUT IN SIZE 52', now: 'SOLD OUT over the centre, SIZE 17 · 1 PIECE in the corner', shownAs: ['SOLD OUT', 'SIZE 17 · 1 PIECE'] },
  { state: 'set-live-sold-out', value: 'HALO · SOLD OUT IN SIZE 56', reason: 'ONE QUEUE, lot Q1 step Q1.8 (D27, N2; ANSWERS C6, r12): SOLD OUT only, its piece and size said in its one sentence', now: 'SOLD OUT, then «Every HALO in size 56 is reserved…»', shownAs: ['SOLD OUT', 'Every HALO in size 56 is reserved.'] },
  { state: 'desk-set-live-sold-out', value: 'HALO · SOLD OUT IN SIZE 56', reason: 'ONE QUEUE, lot Q1 step Q1.8 (D27, N2; ANSWERS C6, r12): SOLD OUT only, its piece and size said in its one sentence', now: 'SOLD OUT, then «Every HALO in size 56 is reserved…»', shownAs: ['SOLD OUT', 'Every HALO in size 56 is reserved.'] },
  { state: 'live-queue', value: '203', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1): the one queue shown on the mockup’s figures, its own release (queueWait)', now: 'YOUR PLACE 4' },
  { state: 'live-queue', value: 'ESTIMATED 16 MINUTES LEFT', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1): the one queue shown on the mockup’s figures, its own release (queueWait)', now: 'ESTIMATED 5 MINUTES LEFT' },
  { state: 'live-queue', value: '0 OF 9 LEFT · 0 IN SIZE 17', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1, Q8): the one queue shown on the mockup’s figures; every piece of a size held is live-queue-held', now: '176 OF 300 LEFT · 3 IN SIZE 17' },
  { state: 'desk-live-queue', value: '203', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1): the one queue shown on the mockup’s figures, its own release (queueWait)', now: 'YOUR PLACE 4' },
  { state: 'desk-live-queue', value: 'ESTIMATED 16 MINUTES LEFT', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1): the one queue shown on the mockup’s figures, its own release (queueWait)', now: 'ESTIMATED 5 MINUTES LEFT' },
  { state: 'desk-live-queue', value: '0 OF 9 LEFT · 0 IN SIZE 17', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1, Q8): the one queue shown on the mockup’s figures; every piece of a size held is live-queue-held', now: '176 OF 300 LEFT · 3 IN SIZE 17' },
  { state: 'desk-live-queue', value: '5240 IN THE ROOM', reason: 'ONE QUEUE, lot Q1 step Q1.8 (plan §3.11; MK Q1): the one queue shown on its own release, its own room', now: '128 IN THE ROOM' },
  { state: 'live-secured', value: 'PAY · € 5 200', reason: 'ONE QUEUE, lot Q1 step Q1.10 (OP-9, D39, D40; MK #secured): PAY reads the total, then the time to pay, inside its light', now: 'PAY € 5 200 · 08:11', shownAs: ['PAY', '€ 5 200'] },
  { state: 'live-secured', value: 'TO CONFIRM', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D39; MK #secured): the time to pay lives inside PAY; TO CONFIRM goes, the button says it', now: 'inside PAY (· 08:11); «08:11 TO CONFIRM» its description, read by a screen reader' },
  { state: 'desk-live-secured', value: 'PAY · € 5 200', reason: 'ONE QUEUE, lot Q1 step Q1.10 (OP-9, D39, D40; MK #secured): PAY reads the total, then the time to pay, inside its light', now: 'PAY € 5 200 · 08:11', shownAs: ['PAY', '€ 5 200'] },
  { state: 'desk-live-secured', value: 'TO CONFIRM', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D39; MK #secured): the time to pay lives inside PAY; TO CONFIRM goes, the button says it', now: 'inside PAY (· 08:11); «08:11 TO CONFIRM» its description, read by a screen reader' },
  { state: 'addons-hold', value: 'PAY · € 5 260', reason: 'ONE QUEUE, lot Q1 step Q1.10 (OP-9, D39, D40; MK #secured): PAY reads the total, then the time to pay, inside its light; ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D15, D36): its total the piece € 5 050 and ENGRAVING € 40', now: 'PAY € 5 090 · 08:11', shownAs: ['PAY', '€ 5 090'] },
  { state: 'addons-hold', value: 'TO CONFIRM', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D39; MK #secured): the time to pay lives inside PAY; TO CONFIRM goes, the button says it', now: 'inside PAY (· 08:11); «08:11 TO CONFIRM» its description, read by a screen reader' },
  { state: 'desk-addons-hold', value: 'PAY · € 5 260', reason: 'ONE QUEUE, lot Q1 step Q1.10 (OP-9, D39, D40; MK #secured): PAY reads the total, then the time to pay, inside its light; ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D15, D36): its total the piece € 5 050 and ENGRAVING € 40', now: 'PAY € 5 090 · 08:11', shownAs: ['PAY', '€ 5 090'] },
  { state: 'desk-addons-hold', value: 'TO CONFIRM', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D39; MK #secured): the time to pay lives inside PAY; TO CONFIRM goes, the button says it', now: 'inside PAY (· 08:11); «08:11 TO CONFIRM» its description, read by a screen reader' },
  { state: 'set-live-secured', value: 'PAY · € 12 090', reason: 'ONE QUEUE, lot Q1 step Q1.10 (OP-9, D39, D40; MK #secured): PAY reads the total, then the time to pay, inside its light', now: 'PAY € 12 090 · 07:08', shownAs: ['PAY', '€ 12 090'] },
  { state: 'set-live-secured', value: 'TO CONFIRM', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D39; MK #secured): the time to pay lives inside PAY; TO CONFIRM goes, the button says it', now: 'inside PAY (· 07:08); «07:08 TO CONFIRM» its description, read by a screen reader' },
  { state: 'desk-set-live-secured', value: 'PAY · € 12 090', reason: 'ONE QUEUE, lot Q1 step Q1.10 (OP-9, D39, D40; MK #secured): PAY reads the total, then the time to pay, inside its light', now: 'PAY € 12 090 · 07:08', shownAs: ['PAY', '€ 12 090'] },
  { state: 'desk-set-live-secured', value: 'TO CONFIRM', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D39; MK #secured): the time to pay lives inside PAY; TO CONFIRM goes, the button says it', now: 'inside PAY (· 07:08); «07:08 TO CONFIRM» its description, read by a screen reader' },
  { state: 'live-turn', value: 'MONOLITHE · SIZE 16 · € 5 050', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D34, r10; MK #turn): the name with its variant, then the choice with its price, on two lines', now: 'MONOLITHE IN BLUE, then SIZE 16 · 1 PIECE · € 5 050', shownAs: ['MONOLITHE', 'SIZE 16', '€ 5 050'] },
  { state: 'set-live-turn', value: 'THE ORBITAL SET · SIZE 16 · 54 · 42 · € 12 000', reason: 'ONE QUEUE, lot Q1 step Q1.10 (D32, D34, N2; MK #turn): the set’s name, then its choice with its price, on two lines', now: 'THE ORBITAL SET, then SIZE 16 · 54 · 42 · 1 SET · € 12 000', shownAs: ['THE ORBITAL SET', 'SIZE 16 · 54 · 42', '€ 12 000'] },
  // ONE QUEUE (lot Q1, step Q1.12; D13, L2): the terms' article 13 changes two sentences only, in EN and FR, on the phone and
  // the computer; "What ORBES may do" and every other text unchanged.
  { state: 'legal-terms', value: 'The pace. A release may admit its line in batches, a number of accounts every few minutes, in the line\'s order; the page shows your place and an estimated time; your place is kept.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r10): the terms\' pace sentence, turns at the release\'s pace after an optional wait following the opening, no figure', now: 'The pace. A release gives turns at its pace, a number of turns every few minutes, in the line\'s order, after an optional wait following the opening; the page shows your place and an estimated time; your place is kept.' },
  { state: 'legal-terms', value: 'A piece that returns. A piece whose turn passes, whose hold ends, that is given back, or whose entry ORBES removes returns to the line: the next account in the line for its size gets a turn at once.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r4): the terms\' «returns at once» sentence, a returned piece offered with the next turns, at once in an after-room', now: 'A piece that returns. A piece whose turn passes, whose hold ends, that is given back, or whose entry ORBES removes returns to the line and is offered with the release\'s next turns, at its pace; in an after-room, the next account in its line for its size gets a turn at once.' },
  { state: 'legal-terms-fr', value: 'Le rythme. Une sortie peut admettre sa file par lots, un nombre de comptes toutes les quelques minutes, dans l\'ordre de la file ; la page montre votre place et une heure estimée ; votre place est gardée.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r10): the terms\' pace sentence, turns at the release\'s pace after an optional wait following the opening, no figure', now: 'Le rythme. Une sortie donne les tours à son rythme, un nombre de tours toutes les quelques minutes, dans l\'ordre de la file, après une attente éventuelle suivant l\'ouverture ; la page montre votre place et un temps d\'attente estimé ; votre place est gardée.' },
  { state: 'legal-terms-fr', value: 'Une pièce qui revient. Une pièce dont le tour passe, dont la tenue prend fin, qui est rendue, ou dont ORBES retire l\'entrée, revient à la file : le compte suivant de la file dans sa taille reçoit aussitôt un tour.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r4): the terms\' «returns at once» sentence, a returned piece offered with the next turns, at once in an after-room', now: 'Une pièce qui revient. Une pièce dont le tour passe, dont la tenue prend fin, qui est rendue, ou dont ORBES retire l\'entrée, revient à la file et est proposée avec les tours suivants de la sortie, à son rythme ; dans une salle d\'après, le compte suivant de sa file dans sa taille reçoit aussitôt un tour.' },
  { state: 'desk-legal-terms', value: 'The pace. A release may admit its line in batches, a number of accounts every few minutes, in the line\'s order; the page shows your place and an estimated time; your place is kept.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r10): the terms\' pace sentence, turns at the release\'s pace after an optional wait following the opening, no figure', now: 'The pace. A release gives turns at its pace, a number of turns every few minutes, in the line\'s order, after an optional wait following the opening; the page shows your place and an estimated time; your place is kept.' },
  { state: 'desk-legal-terms', value: 'A piece that returns. A piece whose turn passes, whose hold ends, that is given back, or whose entry ORBES removes returns to the line: the next account in the line for its size gets a turn at once.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r4): the terms\' «returns at once» sentence, a returned piece offered with the next turns, at once in an after-room', now: 'A piece that returns. A piece whose turn passes, whose hold ends, that is given back, or whose entry ORBES removes returns to the line and is offered with the release\'s next turns, at its pace; in an after-room, the next account in its line for its size gets a turn at once.' },
  { state: 'desk-legal-terms-fr', value: 'Le rythme. Une sortie peut admettre sa file par lots, un nombre de comptes toutes les quelques minutes, dans l\'ordre de la file ; la page montre votre place et une heure estimée ; votre place est gardée.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r10): the terms\' pace sentence, turns at the release\'s pace after an optional wait following the opening, no figure', now: 'Le rythme. Une sortie donne les tours à son rythme, un nombre de tours toutes les quelques minutes, dans l\'ordre de la file, après une attente éventuelle suivant l\'ouverture ; la page montre votre place et un temps d\'attente estimé ; votre place est gardée.' },
  { state: 'desk-legal-terms-fr', value: 'Une pièce qui revient. Une pièce dont le tour passe, dont la tenue prend fin, qui est rendue, ou dont ORBES retire l\'entrée, revient à la file : le compte suivant de la file dans sa taille reçoit aussitôt un tour.', reason: 'ONE QUEUE, lot Q1 step Q1.12 (D13, L2; ANSWERS B12, r4): the terms\' «returns at once» sentence, a returned piece offered with the next turns, at once in an after-room', now: 'Une pièce qui revient. Une pièce dont le tour passe, dont la tenue prend fin, qui est rendue, ou dont ORBES retire l\'entrée, revient à la file et est proposée avec les tours suivants de la sortie, à son rythme ; dans une salle d\'après, le compte suivant de sa file dans sa taille reçoit aussitôt un tour.' },
  // ADD-ONS ONE SYSTEM (lot Q2, step Q2.4; plan §3.4, §3.7, D2, D36): the release add-ons go; each world's releases pick
  // catalogue services (ENGRAVING, GIFT BOX; the 'addons' world the mockup's three): MOVED in addons-hold and addons-pay
  // (+ their desk twins). Lot Q2, step Q2.8 (5b, N2): one list titled ADD-ONS (live-secured and set-live-secured show
  // every value of theirs again), its rows tapped, no stepper; ADD TO YOUR ORDER and the steppers' figures go.
  { state: 'addons-hold', value: '+ € 150', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'Your initials inside the band', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'GIFT BOX', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: '+ € 90', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'POLISHING CLOTH', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'A soft cloth to keep the metal bright.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: '2', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'CHAIN EXTENDER', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'Five centimetres more, to wear it longer.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: '+ € 30', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'TRAVEL POUCH', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: '+ € 45', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'THE TRAVEL CASE FOR TWO PIECES, LINED', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'Lined to keep two pieces apart, with its own cloth, for the longest journeys.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: '+ € 12 450.50', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-hold', value: 'PAY € 5 260 · 08:11', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: '+ € 150', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'Your initials inside the band', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'GIFT BOX', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: '+ € 90', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'POLISHING CLOTH', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'A soft cloth to keep the metal bright.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: '2', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'CHAIN EXTENDER', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'Five centimetres more, to wear it longer.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: '+ € 30', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'TRAVEL POUCH', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: '+ € 45', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'THE TRAVEL CASE FOR TWO PIECES, LINED', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'Lined to keep two pieces apart, with its own cloth, for the longest journeys.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: '+ € 12 450.50', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold', value: 'PAY € 5 260 · 08:11', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: '+ € 150', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'Your initials inside the band', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'GIFT BOX', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: '+ € 90', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'POLISHING CLOTH', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'A soft cloth to keep the metal bright.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: '2', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'CHAIN EXTENDER', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'Five centimetres more, to wear it longer.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: '+ € 30', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'TRAVEL POUCH', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: '+ € 45', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'THE TRAVEL CASE FOR TWO PIECES, LINED', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'Lined to keep two pieces apart, with its own cloth, for the longest journeys.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: '+ € 12 450.50', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'desk-addons-hold-1024', value: 'PAY € 5 260 · 08:11', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D2, D36; plan §3.4, §3.7): the release add-ons are gone; the \'addons\' release picks exactly the mockup\'s three (GIFT WRAPPING, ENGRAVING repriced € 40, THE TRAVEL CASE), its hold choosing ENGRAVING « M. B. »; M3\'s four are no longer its pick', now: '5b (Q2.8): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 (chosen, YOUR TEXT « M. B. » 5 / 12), THE TRAVEL CASE + € 60; PAY € 5 090 · 08:11' },
  { state: 'addons-pay', value: 'THE CHAIN EXTENDER COULD NOT BE ADDED: NONE LEFT.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'THE TRAVEL CASE COULD NOT BE ADDED: NONE LEFT.' },
  { state: 'addons-pay', value: '€ 150', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'ENGRAVING € 40' },
  { state: 'addons-pay', value: 'POLISHING CLOTH × 2', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'nowhere: the hold chose ENGRAVING only' },
  { state: 'addons-pay', value: '€ 30', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'nowhere: the hold chose ENGRAVING only' },
  { state: 'addons-pay', value: '€ 5 230', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'TOTAL € 5 090' },
  { state: 'desk-addons-pay', value: 'THE CHAIN EXTENDER COULD NOT BE ADDED: NONE LEFT.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'THE TRAVEL CASE COULD NOT BE ADDED: NONE LEFT.' },
  { state: 'desk-addons-pay', value: '€ 150', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'ENGRAVING € 40' },
  { state: 'desk-addons-pay', value: 'POLISHING CLOTH × 2', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'nowhere: the hold chose ENGRAVING only' },
  { state: 'desk-addons-pay', value: '€ 30', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'nowhere: the hold chose ENGRAVING only' },
  { state: 'desk-addons-pay', value: '€ 5 230', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.4 (D36; plan §3.4): PAY with THE TRAVEL CASE chosen and its last unit taken, the hold\'s ENGRAVING sold at € 40', now: 'TOTAL € 5 090' },
  { state: 'addons-hold', value: 'ADD TO YOUR ORDER', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'ADD-ONS, the rows GIFT WRAPPING, ENGRAVING (chosen), THE TRAVEL CASE, M3\'s note under them' },
  { state: 'addons-hold', value: '1', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'nowhere: a row is chosen or not (its ring lit into the point)' },
  { state: 'addons-hold', value: '0', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'nowhere: a row is chosen or not (its ring lit into the point)' },
  { state: 'desk-addons-hold', value: 'ADD TO YOUR ORDER', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'ADD-ONS, the rows GIFT WRAPPING, ENGRAVING (chosen), THE TRAVEL CASE, M3\'s note under them' },
  { state: 'desk-addons-hold', value: '1', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'nowhere: a row is chosen or not (its ring lit into the point)' },
  { state: 'desk-addons-hold', value: '0', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'nowhere: a row is chosen or not (its ring lit into the point)' },
  { state: 'desk-addons-hold-1024', value: 'ADD TO YOUR ORDER', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'ADD-ONS, the rows GIFT WRAPPING, ENGRAVING (chosen), THE TRAVEL CASE, M3\'s note under them' },
  { state: 'desk-addons-hold-1024', value: '1', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'nowhere: a row is chosen or not (its ring lit into the point)' },
  { state: 'desk-addons-hold-1024', value: '0', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.8 (5b; N1, N2; MK #secured-addons): one list titled ADD-ONS, each add-on a row you tap (one per piece), no stepper and its figures', now: 'nowhere: a row is chosen or not (its ring lit into the point)' },
  // ADD-ONS ONE SYSTEM (lot Q2, step Q2.10; D29, L2): the terms' article 13 "Your piece" and article 14 "Delivery" and
  // "Add-ons" change only the sentences that became false, in EN and FR, on the phone and the computer; every other text unchanged.
  { state: 'legal-terms', value: 'Your piece. Once secured, the piece is held for you for 5 minutes, unless the release sets another time (from 1 to 60 minutes, which may differ by tier). Meanwhile you may choose the options the release offers, at most 6, for example an engraving or a gift box, each at the price the release sets, kept as it was when you chose it; then press PAY, or give the piece back with RELEASE MY PLACE. A piece not confirmed in time is no longer held, and its options lapse with it.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D25, L2): the terms\' article 13 "Your piece", the add-ons the release offers, one for each piece, or one for each set, at the price shown; never the release\'s options, at most 6', now: 'Your piece. Once secured, the piece is held for you for 5 minutes, unless the release sets another time (from 1 to 60 minutes, which may differ by tier). Meanwhile you may choose the add-ons the release offers (article 14), for example an engraving or a gift wrapping, one for each piece, or one for each set, each at the price shown; then press PAY, or give the piece back with RELEASE MY PLACE. A piece not confirmed in time is no longer held, and its options lapse with it.' },
  { state: 'legal-terms', value: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving that is not one of the options of its release is charged at the price shown; once the order is paid, it has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D4, L2): the terms\' article 14 "Delivery", an engraving is an add-on, charged at the price shown', now: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving is an add-on (below), charged at the price shown; one chosen with the purchase keeps its place on the order and only its words change; any other, once the order is paid, has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.' },
  { state: 'legal-terms', value: 'Add-ons. ORBES may offer add-ons: items sold with a piece, each at the price shown in the currency of its order. An add-on has no ORBES CODE and never counts toward the tier (article 12). It is offered when you confirm a purchase: on a piece held in a LIVE RELEASE, on a place held in a release with a price, and in a request of the private salon. It is added to the order when the order is created, if one is still in stock; otherwise it is left out, and the order goes ahead without it. In YOUR ORDERS, you may add an add-on to an order, or remove it, until its packing begins, never on a welcome gift or a size exchange; ORBES Client Services may do so until its parcel is packed. An order holds at most 3 of each add-on. Once the order is paid, an add-on added has its own invoice, and one removed a credit note. An add-on ships with its order, is cancelled with it and is returned with it; a size exchange leaves it with you.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D3, D4, N8, L2): the terms\' article 14 "Add-ons", offered where ORBES offers it (YOUR ORDERS included), stock only for an add-on with stock, YOUR ORDERS what ORBES offers there', now: 'Add-ons. ORBES may offer add-ons: items sold with a piece, each at the price shown in the currency of its order. An add-on has no ORBES CODE and never counts toward the tier (article 12). It is offered where ORBES offers it: when you confirm a purchase, among those its release offers (on a piece held in a LIVE RELEASE, on a place held in a release with a price), in a request of the private salon, and in YOUR ORDERS. It is added to the order when the order is created; an add-on with stock only if one is still in stock (some, such as an engraving or a gift wrapping, are services without stock); otherwise it is left out, and the order goes ahead without it. In YOUR ORDERS, you may add an add-on ORBES offers there to an order, or remove it, until its packing begins, never on a welcome gift or a size exchange; ORBES Client Services may do so until its parcel is packed. An order holds at most 3 of each add-on. Once the order is paid, an add-on added has its own invoice, and one removed a credit note. An add-on ships with its order, is cancelled with it and is returned with it; a size exchange leaves it with you.' },
  { state: 'legal-terms-fr', value: 'Votre pièce. Une fois sécurisée, la pièce vous est tenue pendant 5 minutes, sauf si la sortie fixe un autre délai (de 1 à 60 minutes, qui peut varier selon le palier). Pendant ce temps, vous pouvez choisir les options que propose la sortie, 6 au plus, par exemple une gravure ou un coffret, chacune au prix que fixe la sortie, gardé tel qu\'il était quand vous l\'avez choisie ; puis presser PAY, ou rendre la pièce avec RELEASE MY PLACE. Une pièce qui n\'est pas confirmée à temps n\'est plus tenue, et ses options tombent avec elle.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D25, L2): the terms\' article 13 «Votre pièce», the add-ons the release offers, one for each piece, or one for each set, at the price shown; never the release\'s options, at most 6', now: 'Votre pièce. Une fois sécurisée, la pièce vous est tenue pendant 5 minutes, sauf si la sortie fixe un autre délai (de 1 à 60 minutes, qui peut varier selon le palier). Pendant ce temps, vous pouvez choisir les articles complémentaires que propose la sortie (article 14), par exemple une gravure ou un emballage cadeau, un pour chaque pièce, ou un pour chaque ensemble, chacun au prix affiché ; puis presser PAY, ou rendre la pièce avec RELEASE MY PLACE. Une pièce qui n\'est pas confirmée à temps n\'est plus tenue, et ses options tombent avec elle.' },
  { state: 'legal-terms-fr', value: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure qui n\'est pas une option de sa sortie est facturée au prix affiché ; une fois la commande payée, elle a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D4, L2): the terms\' article 14 «Livraison», an engraving is an add-on, charged at the price shown', now: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure est un article complémentaire (ci-dessous), facturée au prix affiché ; celle choisie avec l\'achat reste sur la commande et seuls ses mots changent ; toute autre, une fois la commande payée, a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.' },
  { state: 'legal-terms-fr', value: 'Articles complémentaires. ORBES peut proposer des articles complémentaires (add-ons) : des articles vendus avec une pièce, chacun au prix affiché dans la devise de sa commande. Un article complémentaire n\'a pas d\'ORBES CODE et ne compte jamais pour le palier (article 12). Il est proposé quand vous confirmez un achat : sur une pièce tenue dans une LIVE RELEASE, sur une place réservée dans une sortie avec un prix, et dans une demande du salon privé. Il est ajouté à la commande quand elle est créée, s\'il en reste en stock ; sinon il est laissé de côté, et la commande se fait sans lui. Dans YOUR ORDERS, vous pouvez ajouter un article complémentaire à une commande, ou le retirer, jusqu\'au début de son emballage, jamais sur un cadeau de bienvenue ni sur un échange de taille ; ORBES Client Services peut le faire jusqu\'à la fermeture de son colis. Une commande compte au plus 3 de chaque article complémentaire. Une fois la commande payée, un article complémentaire ajouté a sa propre facture, et un article retiré un avoir. Un article complémentaire est expédié avec sa commande, annulé avec elle et retourné avec elle ; un échange de taille vous le laisse.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D3, D4, N8, L2): the terms\' article 14 «Articles complémentaires», offered where ORBES offers it (YOUR ORDERS included), stock only for an add-on with stock, YOUR ORDERS what ORBES offers there', now: 'Articles complémentaires. ORBES peut proposer des articles complémentaires (add-ons) : des articles vendus avec une pièce, chacun au prix affiché dans la devise de sa commande. Un article complémentaire n\'a pas d\'ORBES CODE et ne compte jamais pour le palier (article 12). Il est proposé là où ORBES le propose : quand vous confirmez un achat, parmi ceux que propose sa sortie (sur une pièce tenue dans une LIVE RELEASE, sur une place réservée dans une sortie avec un prix), dans une demande du salon privé, et dans YOUR ORDERS. Il est ajouté à la commande quand elle est créée ; un article complémentaire avec stock seulement s\'il en reste en stock (certains, comme une gravure ou un emballage cadeau, sont des services sans stock) ; sinon il est laissé de côté, et la commande se fait sans lui. Dans YOUR ORDERS, vous pouvez ajouter à une commande un article complémentaire qu\'ORBES y propose, ou le retirer, jusqu\'au début de son emballage, jamais sur un cadeau de bienvenue ni sur un échange de taille ; ORBES Client Services peut le faire jusqu\'à la fermeture de son colis. Une commande compte au plus 3 de chaque article complémentaire. Une fois la commande payée, un article complémentaire ajouté a sa propre facture, et un article retiré un avoir. Un article complémentaire est expédié avec sa commande, annulé avec elle et retourné avec elle ; un échange de taille vous le laisse.' },
  { state: 'desk-legal-terms', value: 'Your piece. Once secured, the piece is held for you for 5 minutes, unless the release sets another time (from 1 to 60 minutes, which may differ by tier). Meanwhile you may choose the options the release offers, at most 6, for example an engraving or a gift box, each at the price the release sets, kept as it was when you chose it; then press PAY, or give the piece back with RELEASE MY PLACE. A piece not confirmed in time is no longer held, and its options lapse with it.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D25, L2): the terms\' article 13 "Your piece", the add-ons the release offers, one for each piece, or one for each set, at the price shown; never the release\'s options, at most 6', now: 'Your piece. Once secured, the piece is held for you for 5 minutes, unless the release sets another time (from 1 to 60 minutes, which may differ by tier). Meanwhile you may choose the add-ons the release offers (article 14), for example an engraving or a gift wrapping, one for each piece, or one for each set, each at the price shown; then press PAY, or give the piece back with RELEASE MY PLACE. A piece not confirmed in time is no longer held, and its options lapse with it.' },
  { state: 'desk-legal-terms', value: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving that is not one of the options of its release is charged at the price shown; once the order is paid, it has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D4, L2): the terms\' article 14 "Delivery", an engraving is an add-on, charged at the price shown', now: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving is an add-on (below), charged at the price shown; one chosen with the purchase keeps its place on the order and only its words change; any other, once the order is paid, has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.' },
  { state: 'desk-legal-terms', value: 'Add-ons. ORBES may offer add-ons: items sold with a piece, each at the price shown in the currency of its order. An add-on has no ORBES CODE and never counts toward the tier (article 12). It is offered when you confirm a purchase: on a piece held in a LIVE RELEASE, on a place held in a release with a price, and in a request of the private salon. It is added to the order when the order is created, if one is still in stock; otherwise it is left out, and the order goes ahead without it. In YOUR ORDERS, you may add an add-on to an order, or remove it, until its packing begins, never on a welcome gift or a size exchange; ORBES Client Services may do so until its parcel is packed. An order holds at most 3 of each add-on. Once the order is paid, an add-on added has its own invoice, and one removed a credit note. An add-on ships with its order, is cancelled with it and is returned with it; a size exchange leaves it with you.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D3, D4, N8, L2): the terms\' article 14 "Add-ons", offered where ORBES offers it (YOUR ORDERS included), stock only for an add-on with stock, YOUR ORDERS what ORBES offers there', now: 'Add-ons. ORBES may offer add-ons: items sold with a piece, each at the price shown in the currency of its order. An add-on has no ORBES CODE and never counts toward the tier (article 12). It is offered where ORBES offers it: when you confirm a purchase, among those its release offers (on a piece held in a LIVE RELEASE, on a place held in a release with a price), in a request of the private salon, and in YOUR ORDERS. It is added to the order when the order is created; an add-on with stock only if one is still in stock (some, such as an engraving or a gift wrapping, are services without stock); otherwise it is left out, and the order goes ahead without it. In YOUR ORDERS, you may add an add-on ORBES offers there to an order, or remove it, until its packing begins, never on a welcome gift or a size exchange; ORBES Client Services may do so until its parcel is packed. An order holds at most 3 of each add-on. Once the order is paid, an add-on added has its own invoice, and one removed a credit note. An add-on ships with its order, is cancelled with it and is returned with it; a size exchange leaves it with you.' },
  { state: 'desk-legal-terms-fr', value: 'Votre pièce. Une fois sécurisée, la pièce vous est tenue pendant 5 minutes, sauf si la sortie fixe un autre délai (de 1 à 60 minutes, qui peut varier selon le palier). Pendant ce temps, vous pouvez choisir les options que propose la sortie, 6 au plus, par exemple une gravure ou un coffret, chacune au prix que fixe la sortie, gardé tel qu\'il était quand vous l\'avez choisie ; puis presser PAY, ou rendre la pièce avec RELEASE MY PLACE. Une pièce qui n\'est pas confirmée à temps n\'est plus tenue, et ses options tombent avec elle.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D25, L2): the terms\' article 13 «Votre pièce», the add-ons the release offers, one for each piece, or one for each set, at the price shown; never the release\'s options, at most 6', now: 'Votre pièce. Une fois sécurisée, la pièce vous est tenue pendant 5 minutes, sauf si la sortie fixe un autre délai (de 1 à 60 minutes, qui peut varier selon le palier). Pendant ce temps, vous pouvez choisir les articles complémentaires que propose la sortie (article 14), par exemple une gravure ou un emballage cadeau, un pour chaque pièce, ou un pour chaque ensemble, chacun au prix affiché ; puis presser PAY, ou rendre la pièce avec RELEASE MY PLACE. Une pièce qui n\'est pas confirmée à temps n\'est plus tenue, et ses options tombent avec elle.' },
  { state: 'desk-legal-terms-fr', value: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure qui n\'est pas une option de sa sortie est facturée au prix affiché ; une fois la commande payée, elle a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D4, L2): the terms\' article 14 «Livraison», an engraving is an add-on, charged at the price shown', now: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure est un article complémentaire (ci-dessous), facturée au prix affiché ; celle choisie avec l\'achat reste sur la commande et seuls ses mots changent ; toute autre, une fois la commande payée, a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.' },
  { state: 'desk-legal-terms-fr', value: 'Articles complémentaires. ORBES peut proposer des articles complémentaires (add-ons) : des articles vendus avec une pièce, chacun au prix affiché dans la devise de sa commande. Un article complémentaire n\'a pas d\'ORBES CODE et ne compte jamais pour le palier (article 12). Il est proposé quand vous confirmez un achat : sur une pièce tenue dans une LIVE RELEASE, sur une place réservée dans une sortie avec un prix, et dans une demande du salon privé. Il est ajouté à la commande quand elle est créée, s\'il en reste en stock ; sinon il est laissé de côté, et la commande se fait sans lui. Dans YOUR ORDERS, vous pouvez ajouter un article complémentaire à une commande, ou le retirer, jusqu\'au début de son emballage, jamais sur un cadeau de bienvenue ni sur un échange de taille ; ORBES Client Services peut le faire jusqu\'à la fermeture de son colis. Une commande compte au plus 3 de chaque article complémentaire. Une fois la commande payée, un article complémentaire ajouté a sa propre facture, et un article retiré un avoir. Un article complémentaire est expédié avec sa commande, annulé avec elle et retourné avec elle ; un échange de taille vous le laisse.', reason: 'ADD-ONS ONE SYSTEM, lot Q2 step Q2.10 (D29, D3, D4, N8, L2): the terms\' article 14 «Articles complémentaires», offered where ORBES offers it (YOUR ORDERS included), stock only for an add-on with stock, YOUR ORDERS what ORBES offers there', now: 'Articles complémentaires. ORBES peut proposer des articles complémentaires (add-ons) : des articles vendus avec une pièce, chacun au prix affiché dans la devise de sa commande. Un article complémentaire n\'a pas d\'ORBES CODE et ne compte jamais pour le palier (article 12). Il est proposé là où ORBES le propose : quand vous confirmez un achat, parmi ceux que propose sa sortie (sur une pièce tenue dans une LIVE RELEASE, sur une place réservée dans une sortie avec un prix), dans une demande du salon privé, et dans YOUR ORDERS. Il est ajouté à la commande quand elle est créée ; un article complémentaire avec stock seulement s\'il en reste en stock (certains, comme une gravure ou un emballage cadeau, sont des services sans stock) ; sinon il est laissé de côté, et la commande se fait sans lui. Dans YOUR ORDERS, vous pouvez ajouter à une commande un article complémentaire qu\'ORBES y propose, ou le retirer, jusqu\'au début de son emballage, jamais sur un cadeau de bienvenue ni sur un échange de taille ; ORBES Client Services peut le faire jusqu\'à la fermeture de son colis. Une commande compte au plus 3 de chaque article complémentaire. Une fois la commande payée, un article complémentaire ajouté a sa propre facture, et un article retiré un avoir. Un article complémentaire est expédié avec sa commande, annulé avec elle et retourné avec elle ; un échange de taille vous le laisse.' },
  // The review of lot Q2 (L2, same version 2026-10-25): "Delivery" says an engraving chosen with the purchase keeps its
  // place on the order and only its words change; any other has its own invoice once paid, and a credit note if removed.
  { state: 'legal-terms', value: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving is an add-on (below), charged at the price shown; once the order is paid, it has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, the review of lot Q2 (L2): the terms\' article 14 "Delivery", an engraving chosen with the purchase keeps its place on the order, its words alone changing; any other has its own invoice once paid', now: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving is an add-on (below), charged at the price shown; one chosen with the purchase keeps its place on the order and only its words change; any other, once the order is paid, has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.' },
  { state: 'legal-terms-fr', value: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure est un article complémentaire (ci-dessous), facturée au prix affiché ; une fois la commande payée, elle a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, the review of lot Q2 (L2): the terms\' article 14 «Livraison», an engraving chosen with the purchase keeps its place on the order, its words alone changing; any other has its own invoice once paid', now: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure est un article complémentaire (ci-dessous), facturée au prix affiché ; celle choisie avec l\'achat reste sur la commande et seuls ses mots changent ; toute autre, une fois la commande payée, a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.' },
  { state: 'desk-legal-terms', value: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving is an add-on (below), charged at the price shown; once the order is paid, it has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, the review of lot Q2 (L2): the terms\' article 14 "Delivery", an engraving chosen with the purchase keeps its place on the order, its words alone changing; any other has its own invoice once paid', now: 'Delivery. You enter on the order, in YOUR ORDERS, the delivery name, address, country and phone, and any engraving, until its packing begins; ORBES Client Services may enter or change them too. An engraving is an add-on (below), charged at the price shown; one chosen with the purchase keeps its place on the order and only its words change; any other, once the order is paid, has its own invoice, and a credit note if it is removed. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier\'s own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.' },
  { state: 'desk-legal-terms-fr', value: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure est un article complémentaire (ci-dessous), facturée au prix affiché ; une fois la commande payée, elle a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.', reason: 'ADD-ONS ONE SYSTEM, the review of lot Q2 (L2): the terms\' article 14 «Livraison», an engraving chosen with the purchase keeps its place on the order, its words alone changing; any other has its own invoice once paid', now: 'Livraison. Vous saisissez sur la commande, dans YOUR ORDERS, le nom, l\'adresse, le pays et le téléphone de livraison, et une éventuelle gravure, jusqu\'au début de son emballage ; ORBES Client Services peut aussi les saisir ou les changer. Une gravure est un article complémentaire (ci-dessous), facturée au prix affiché ; celle choisie avec l\'achat reste sur la commande et seuls ses mots changent ; toute autre, une fois la commande payée, a sa propre facture, et un avoir si elle est retirée. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l\'enregistre, ou dès que le compte qui l\'a passée enregistre sa pièce (article 7) pendant qu\'elle est SHIPPED.' },
];

/**
 * The states removed on purpose since the baseline was recorded, each with its reason and where its values went; gone
 * from the baseline with them (MOVED records a value; these, a whole screen). Kept until the baseline is recorded again.
 */
export const REMOVED_STATES: readonly { state: string; reason: string; now: string }[] = [
  { state: 'live-line', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS r1, C3; plan §3.11): the classic line screen gives way to the one queue', now: 'live-queue and its states (LIVE NOW, YOUR PLACE in your size, ESTIMATED … LEFT, the one note)' },
  { state: 'live-queue-admitted', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS r1, C3; plan §3.11): M1’s admitted queue page gives way to the one queue, never a batch said', now: 'live-queue; the turn itself (live-turn)' },
  { state: 'desk-live-line', reason: 'ONE QUEUE, lot Q1 step Q1.3 (ANSWERS r1, C3; plan §3.11): the computer’s line screen gives way to the one queue', now: 'desk-live-queue and its states' },
];

const movedKey = (state: string, value: string) => `${state}\u0000${normalizeText(value)}`;
const moved = new Map(MOVED.map((m) => [movedKey(m.state, m.value), m] as const));

/** A state whose id is one of `names` or starts with one of them and a dash. */
const named =
  (...names: string[]) =>
  (s: UiState) =>
    names.some((n) => s.id === n || s.id.startsWith(`${n}-`));
const full = (s: UiState) => s.variant === 'full';
const accountMessages = named('account-write', 'account-messages');
/** The birthday credit's stage (plan CUSTOMER INTELLIGENCE §3.5 SB.4.5): IN USE, BIRTHDAY CREDIT, for an account without a tier. */
const birthday = (s: UiState) => s.variant === 'birthday-credit';
/** PRIVATE CARE used for another piece (plan ORBES CARE, step 1.4), on its own stage: THE PROGRAM's PLATINE at 1 piece a year. */
const careUsed = (s: UiState) => s.variant === 'care-used';
/** ORBES CARE (plan ORBES CARE, step 5.1), on its own stage: each warranty, each moment of a claim, a lifetime certificate, a warranty credit. */
const orbesCare = (s: UiState) => s.variant === 'orbes-care';
/**
 * The tier program's states (plan NEXT-NINE, BP-19) in the full demo: a piece's YEARLY CARE, THE CLUB, IN USE; the
 * birthday credit under IN USE, and PRIVATE CARE used for another piece, each on its own stage.
 */
const program = (s: UiState) => (full(s) && !s.mutates && named('piece-care', 'club', 'account-sheet-in-use')(s)) || birthday(s) || careUsed(s);
const ROOM_VARIANTS: readonly string[] = ['room', 'live', 'afterroom', 'afterroom-ends'];
/** YOUR PROFILE's stage (plan CUSTOMER INTELLIGENCE §3.1 P.8): account-profile, then profile-tastes. */
const profile = (s: UiState) => s.variant === 'account-profile';
/** YOUR WISHLIST's stage (plan CUSTOMER INTELLIGENCE §3.2 W.10): the heart pressed on a sheet; the page, empty then with three. */
const wishlist = (s: UiState) => s.variant === 'wishes';
/** The stages of MY PIECES' orders that their one state writes (plan NEXT LOT §3.4, §3.6). */
const ORDER_STAGES: readonly string[] = ['claim-waiting', 'orders-delivery', 'orders-case'];

/**
 * The phone's shards, each a test file: the `full` demo by screen group (its states that write in one
 * shard of their own, in their order), the room's variants, the draws in every state, the extreme content (the stress
 * demo; its account sheet runs with the others) and the other variants. Each holds about twenty states.
 */
const PHONE_SHARDS: Readonly<Record<string, (s: UiState) => boolean>> = Object.freeze({
  scan: (s) => full(s) && !s.mutates && named('now', 'scan', 'photo', 'problem')(s),
  // The results, and CREATE ACCOUNT on its own (plan CUSTOMER INTELLIGENCE §3.1 P.4.1: sign-up), beside the result's.
  results: (s) => full(s) && !s.mutates && named('result', 'sign-up')(s),
  // MY PIECES, and the account sheet (C2: its own, over NOW, in the full, draw-leads and stress demos); YOUR NEW CLAIM
  // CODE waiting on an order (plan NEXT LOT §3.4), and the collector's side of the orders (§3.6: orders-delivery,
  // orders-case; YOUR ADDRESSES, an account state), each on its own stage.
  pieces: (s) => ((full(s) && !s.mutates && named('pieces', 'piece')(s)) || (named('account')(s) && !accountMessages(s)) || ORDER_STAGES.includes(s.variant)) && !program(s) && !profile(s),
  // The tier program (plan NEXT-NINE, BP-19), in the full demo: a piece's YEARLY CARE at each step, THE CLUB, IN USE;
  // the birthday credit under IN USE (plan CUSTOMER INTELLIGENCE §3.5 SB.4.5: birthday-credit), on its own stage.
  program,
  // YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8), on its own stage, its two states in order.
  profile,
  // YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10), on its own stage, its states in order.
  wishlist,
  // The account sheet's MESSAGES and its write sheet (plan NEXT-NINE, CS-01), in the draw-leads demo, in order; FROM ORBES
  // (lot M2: NOW's line of a house message, MESSAGES' two parts), on its own stage (house), its writes last.
  messages: (s) => accountMessages(s) || s.variant === 'house',
  // THE COLLECTION and a model's sheet, with PAIRS WELL WITH as picked (plan NEXT-NINE, BP-34: the pairs stage).
  collection: (s) => (full(s) || s.variant === 'pairs') && !s.mutates && named('collection', 'model')(s),
  releases: (s) => full(s) && !s.mutates && named('releases', 'draw', 'live')(s),
  circle: (s) => full(s) && !s.mutates && named('circle', 'post', 'legal', 'certificate')(s),
  writes: (s) => full(s) && !!s.mutates,
  room: (s) => ROOM_VARIANTS.includes(s.variant),
  // ORBES CARE (plan ORBES CARE, step 5.1), on its own stage (orbes-care), its states in order; THE SET's releases, its
  // draws and YOUR ORDERS (lot M3, K44), on theirs (set; the queue's shard holds the one queue's every state, lot Q1).
  care: (s) => orbesCare(s) || s.variant === 'set',
  // The draws in every state; a draw in sizes (plan NEXT LOT §3.6.F) and a draw FOR SELECTED COLLECTORS (plan MACRO M1
  // §3.3, F4), each on its own stage.
  draws: (s) => s.variant === 'draws' || s.variant === 'draw-sizes' || s.variant === 'draw-selected',
  stress: (s) => s.variant === 'stress' && !named('account')(s),
  // The queue of a paced release (macro scope of 2026-10-20, W2, W5, W6; lot M1, step M1.5; the one queue in every state,
  // lot Q1), on its own stage: the room's shard holds its limit of states; THE SET's LIVE RELEASE (lot M3, K44), on its own.
  queue: (s) => s.variant === 'queue' || s.variant === 'set-live',
  // The emails' screens (lot M1, step M1.19, E1–E3), on their own stage (the emails' channel on), their writes last.
  email: (s) => s.variant === 'email',
  // WORN (lot M2, D31), on its own stage: a piece's block in each state (the pieces' shard holds its limit of states);
  // the catalogue add-ons (lot M3, D2), on theirs: the hold, a place held, the salon, YOUR ORDERS and ADD AN ADD-ON.
  worn: (s) => s.variant === 'worn' || s.variant === 'addons',
  variants: (s) => !full(s) && !ROOM_VARIANTS.includes(s.variant) && s.variant !== 'queue' && s.variant !== 'email' && s.variant !== 'house' && s.variant !== 'worn' && s.variant !== 'addons' && s.variant !== 'draws' && s.variant !== 'draw-sizes' && s.variant !== 'draw-selected' && s.variant !== 'set' && s.variant !== 'set-live' && s.variant !== 'stress' && s.variant !== 'pairs' && !ORDER_STAGES.includes(s.variant) && !named('account')(s) && !profile(s) && !wishlist(s) && !birthday(s) && !careUsed(s) && !orbesCare(s),
});

/** A computer's state (desktop: test/support/nocturne-states.ts DESK_STATES), never in a phone's shard. */
const onComputer = (s: UiState) => s.id.startsWith('desk-');

/**
 * The shards of the content test, each a test file: the phone's (PHONE_SHARDS, each its predicate on the phone's states
 * alone), then a computer's (desk-1 … desk-12, DESK_GROUPS: about twenty states each, a stage's writes in one).
 */
export const CONTENT_SHARDS: Readonly<Record<string, (s: UiState) => boolean>> = Object.freeze({
  ...Object.fromEntries(Object.entries(PHONE_SHARDS).map(([name, pick]) => [name, (s: UiState) => !onComputer(s) && pick(s)])),
  ...Object.fromEntries(Object.entries(DESK_GROUPS).map(([name, states]) => [name, (s: UiState) => states.includes(s)])),
});

/** The states of shard `name`, in the order of UI_STATES. */
export function contentShard(name: string): UiState[] {
  const pick = CONTENT_SHARDS[name];
  if (!pick) throw new Error(`no content shard ${name}`);
  return UI_STATES.filter(pick);
}

/** Each shard's time limit: well under CI's, about twice what it takes on a laptop. */
export const SHARD_TIMEOUT_MS = 8 * 60_000;

/** The content test of shard `name`: every value of the baseline of each of its states, still shown in that state. */
export function contentSuite(name: string): void {
  const states = contentShard(name);
  describe.skipIf(!HAS_CHROMIUM)(`NOCTURNE content, ${name}: every value of the baseline is still shown in its state (Chromium)`, () => {
    it(
      `shows every value of the ${states.length} states of ${name}, but those moved on purpose`,
      async () => {
        const baseline = readBaseline();
        expect(states.length).toBeGreaterThan(0);
        const missing: string[] = [];
        await eachState(
          states,
          async (state, { stage, demo, browser }) => {
            const recorded = baseline.states[state.id];
            if (!recorded) throw new Error(`${state.id}: not in the baseline (scripts/parity.ts --baseline --states ${state.id})`);
            const opened = await openState(browser, stage, demo, state);
            try {
              const texts = await pageTexts(opened.page);
              /** What is not shown in the state itself: the text looked for, and how it is reported. */
              const unseen: { text: string; label: string }[] = [];
              for (const value of recorded.values) {
                const m = moved.get(movedKey(state.id, value));
                if (m) {
                  // Set apart on purpose: each of its parts is still shown there.
                  for (const part of m.shownAs ?? []) if (!shows(texts, part)) unseen.push({ text: part, label: `${part} (of «${value}»)` });
                  continue;
                }
                if (!shows(texts, value)) unseen.push({ text: value, label: value });
              }
              // MY PIECES split (N5): what its one page showed is shown in one of its parts.
              const parts = unseen.length > 0 && SPLIT.states.includes(state.id) ? await myPiecesTexts(opened) : null;
              for (const u of unseen) if (!parts || !shows(parts, u.text)) missing.push(`${state.id}: ${u.label}`);
              // The Cinema room's ground (desktop-room.ts): marked bare exactly when it shows no photograph, from the
              // room's first screen on (M3.19's verification: a first screen without one kept the frame's ground).
              const ground = await opened.page.evaluate(() => {
                const g = document.querySelector('.d-room__photo');
                if (!g) return null;
                const shown = [...g.querySelectorAll('img')].some((i) => i.hasAttribute('src'));
                return g.classList.contains('is-bare') === shown ? (shown ? 'its ground has a photograph but is marked bare' : 'its ground has no photograph but is not marked bare') : null;
              });
              if (ground) missing.push(`${state.id}: ${ground}`);
              // What else the state holds (a geometry: nocturne-states.ts UiState.check).
              if (state.check) for (const problem of await state.check(opened.page)) missing.push(`${state.id}: ${problem}`);
              // A computer's state (desk-*) made from a phone's: every word of the phone's state is shown on the computer
              // too, or moved on purpose (desktop.content-parity.harness.ts DESKTOP_MOVED); read last, as it may leave
              // the state for the page a value moved to.
              const twin = phoneTwin(state);
              if (twin) {
                const phone = baseline.states[twin];
                if (!phone) throw new Error(`${state.id}: its phone state ${twin} is not in the baseline`);
                // A value MOVED on the phone (gone from it on purpose) is not asked of its computer twin either.
                const kept = phone.values.filter((value) => !moved.has(movedKey(twin, value)));
                for (const value of await parityMissing(opened, state, twin, kept)) missing.push(`${state.id}: the phone's «${value}» (${twin}) is not shown on the computer`);
              }
            } finally {
              await opened.close();
            }
          },
          () => {},
        );
        expect(missing).toEqual([]);
      },
      SHARD_TIMEOUT_MS,
    );
  });
}

/**
 * Plan NEXT-NINE, IN-01: a guarantee not shown to its holder leaves no mark for it anywhere in the app. Each case opens a
 * state (or a state's way there for another account) and checks that none of `absent` is shown, while each of
 * `present` still is (the public GUARANTEED lines of a drawn release, unmarked).
 */
export function hiddenGuaranteeSuite(name: string, cases: readonly { state: UiState; absent: readonly RegExp[]; present?: readonly RegExp[] }[]): void {
  describe.skipIf(!HAS_CHROMIUM)(`THE HOUSE'S GUARANTEE not shown, ${name}: no mark for its holder (Chromium)`, () => {
    it(
      `shows no box, block, line, label nor YOURS of a guarantee not shown in ${cases.length} screens`,
      async () => {
        const found: string[] = [];
        await eachState(
          cases.map((c) => c.state),
          async (state, { stage, demo, browser }) => {
            const c = cases.find((x) => x.state === state)!;
            const opened = await openState(browser, stage, demo, state);
            try {
              const texts = await pageTexts(opened.page);
              for (const re of c.absent) if (texts.some((t) => re.test(t))) found.push(`${state.id}: shows ${re}`);
              for (const re of c.present ?? []) if (!texts.some((t) => re.test(t))) found.push(`${state.id}: does not show ${re}`);
            } finally {
              await opened.close();
            }
          },
          () => {},
        );
        expect(found).toEqual([]);
      },
      SHARD_TIMEOUT_MS,
    );
  });
}

/**
 * Plan NEXT-NINE, AC-01: states kept out of UI_STATES (a shard at its limit, ROOM_SIZE_STATES), each reached on its demo
 * and checked by its words: each of `present` shown, none of `absent`.
 */
export function shownSuite(name: string, cases: readonly { state: UiState; present: readonly RegExp[]; absent?: readonly RegExp[] }[]): void {
  describe.skipIf(!HAS_CHROMIUM)(`${name} (Chromium)`, () => {
    it(
      `shows what each of ${cases.length} screens says, and nothing it no longer says`,
      async () => {
        const found: string[] = [];
        await eachState(
          cases.map((c) => c.state),
          async (state, { stage, demo, browser }) => {
            const c = cases.find((x) => x.state === state)!;
            const opened = await openState(browser, stage, demo, state);
            try {
              const texts = await pageTexts(opened.page);
              for (const re of c.present) if (!texts.some((t) => re.test(t))) found.push(`${state.id}: does not show ${re}`);
              for (const re of c.absent ?? []) if (texts.some((t) => re.test(t))) found.push(`${state.id}: shows ${re}`);
            } finally {
              await opened.close();
            }
          },
          () => {},
        );
        expect(found).toEqual([]);
      },
      SHARD_TIMEOUT_MS,
    );
  });
}

/**
 * ONE QUEUE (lot Q1, step Q1.8; plan §3.3; OP-6, N10; MK Q3, Q4, #confirmed, #after-door): the header's notice on the
 * queue says FROM ORBES alone, the release's PAUSED (or THE QUEUE IS PAUSED) with its line inside the screen, above its
 * frozen time, never twice; CONFIRMED and the after-room's door show no notice at all. Each case: whether FROM ORBES
 * shows, and the pause words the screen shows once (null: none anywhere).
 */
export function noticeSuite(name: string, cases: readonly { state: UiState; fromOrbes: boolean; paused: string | null }[]): void {
  describe.skipIf(!HAS_CHROMIUM)(`${name} (Chromium)`, () => {
    it(
      `shows FROM ORBES and the pause as the mockup draws them, never twice, in ${cases.length} screens`,
      async () => {
        const found: string[] = [];
        await eachState(
          cases.map((c) => c.state),
          async (state, { stage, demo, browser }) => {
            const c = cases.find((x) => x.state === state)!;
            const opened = await openState(browser, stage, demo, state);
            try {
              const seen = await opened.page.evaluate(() => {
                const shown = (el: Element) => el.checkVisibility() && el.getBoundingClientRect().width > 1;
                const notice = document.querySelector('.live__notice');
                const words = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0 && shown(el) && /^(PAUSED|THE QUEUE IS PAUSED)$/.test((el.textContent ?? '').trim()));
                return {
                  message: [...(notice?.querySelectorAll('.live__message') ?? [])].filter(shown).length,
                  noticePaused: notice?.querySelectorAll('.live__paused').length ?? 0,
                  paused: words.map((el) => (el.textContent ?? '').trim()),
                  inScreen: words.every((el) => el.matches('.live__queue-paused')),
                };
              });
              const want = { message: c.fromOrbes ? 1 : 0, noticePaused: 0, paused: c.paused ? [c.paused] : [], inScreen: true };
              if (JSON.stringify(seen) !== JSON.stringify(want)) found.push(`${state.id}: ${JSON.stringify(seen)}, not ${JSON.stringify(want)}`);
            } finally {
              await opened.close();
            }
          },
          () => {},
        );
        expect(found).toEqual([]);
      },
      SHARD_TIMEOUT_MS,
    );
  });
}
