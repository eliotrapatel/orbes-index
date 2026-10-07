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
 * each one finds the demo as the states before it in the baseline's run left it.
 *
 * Nothing may disappear but what MOVED lists: a value moved (or removed) on purpose, with its reason and its new place.
 * Each entry names a value of the baseline, so the list can never excuse a value that was not there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_FILE, eachState, type Baseline } from '../support/nocturne-stage.js';
import { myPiecesTexts, normalizeText, openState, pageTexts, shows, UI_STATES, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

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
export const MOVED: readonly Moved[] = [];

const movedKey = (state: string, value: string) => `${state}\u0000${normalizeText(value)}`;
const moved = new Map(MOVED.map((m) => [movedKey(m.state, m.value), m] as const));

/** A state whose id is one of `names` or starts with one of them and a dash. */
const named =
  (...names: string[]) =>
  (s: UiState) =>
    names.some((n) => s.id === n || s.id.startsWith(`${n}-`));
const full = (s: UiState) => s.variant === 'full';
const accountMessages = named('account-write', 'account-messages');
/** The tier program's states (plan NEXT-NINE, BP-19): a piece's YEARLY CARE. */
const program = named('piece-care');
const ROOM_VARIANTS: readonly string[] = ['room', 'live', 'afterroom', 'afterroom-ends'];

/**
 * The shards of the content test, each a test file: the `full` demo by screen group (its states that write in one
 * shard of their own, in their order), the room's variants, the draws in every state, the extreme content (the stress
 * demo; its account sheet runs with the others) and the other variants. Each holds about twenty states.
 */
export const CONTENT_SHARDS: Readonly<Record<string, (s: UiState) => boolean>> = Object.freeze({
  scan: (s) => full(s) && !s.mutates && named('now', 'scan', 'photo', 'problem')(s),
  results: (s) => full(s) && !s.mutates && named('result')(s),
  // MY PIECES, and the account sheet (C2: its own, over NOW, in the full, draw-leads and stress demos).
  pieces: (s) => (full(s) && !s.mutates && named('pieces', 'piece')(s) && !program(s)) || (named('account')(s) && !accountMessages(s)),
  // The tier program (plan NEXT-NINE, BP-19): a piece's YEARLY CARE at each step, in the full demo.
  program: (s) => full(s) && !s.mutates && program(s),
  // The account sheet's MESSAGES and its write sheet (plan NEXT-NINE, CS-01), in the draw-leads demo, in order.
  messages: accountMessages,
  collection: (s) => full(s) && !s.mutates && named('collection', 'model')(s),
  releases: (s) => full(s) && !s.mutates && named('releases', 'draw', 'live')(s),
  circle: (s) => full(s) && !s.mutates && named('circle', 'post', 'legal', 'certificate')(s),
  writes: (s) => full(s) && !!s.mutates,
  room: (s) => ROOM_VARIANTS.includes(s.variant),
  draws: (s) => s.variant === 'draws',
  stress: (s) => s.variant === 'stress' && !named('account')(s),
  variants: (s) => !full(s) && !ROOM_VARIANTS.includes(s.variant) && s.variant !== 'draws' && s.variant !== 'stress' && !named('account')(s),
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
