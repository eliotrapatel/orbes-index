/**
 * NOCTURNE's content test (plan NOCTURNE, fidelity rule 4: every field and every state), shared by its files. The
 * baseline (test/fixtures/nocturne-baseline.json, recorded by scripts/parity.ts --baseline on the app as it was before
 * NOCTURNE, 5efd4c9) holds every text value each state of /verify and /legal showed on the NOCTURNE demo; the test reaches
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
import { normalizeText, openState, pageTexts, shows, UI_STATES, type UiState } from '../support/nocturne-states.js';
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
}

/**
 * The values NOCTURNE moves or removes on purpose (none yet: N0 records the app before any change). The later steps
 * add theirs here, e.g. YOUR TIER (decision 10: moved from MY PIECES to the account sheet) and THIS PIECE (decision 9:
 * the piece's own photograph leaves every collector's screen).
 */
export const MOVED: readonly Moved[] = [];

const movedKey = (state: string, value: string) => `${state}\u0000${normalizeText(value)}`;
const moved = new Set(MOVED.map((m) => movedKey(m.state, m.value)));

/** A state whose id is one of `names` or starts with one of them and a dash. */
const named =
  (...names: string[]) =>
  (s: UiState) =>
    names.some((n) => s.id === n || s.id.startsWith(`${n}-`));
const full = (s: UiState) => s.variant === 'full';
const ROOM_VARIANTS: readonly string[] = ['room', 'live', 'afterroom', 'afterroom-ends'];

/**
 * The shards of the content test, each a test file: the `full` demo by screen group (its states that write in one
 * shard of their own, in their order), the room's variants, the draws in every state, and the other variants. Each holds about twenty states.
 */
export const CONTENT_SHARDS: Readonly<Record<string, (s: UiState) => boolean>> = Object.freeze({
  scan: (s) => full(s) && !s.mutates && named('now', 'scan', 'photo', 'problem')(s),
  results: (s) => full(s) && !s.mutates && named('result')(s),
  pieces: (s) => full(s) && !s.mutates && named('pieces')(s),
  collection: (s) => full(s) && !s.mutates && named('collection', 'model')(s),
  releases: (s) => full(s) && !s.mutates && named('releases', 'draw', 'live')(s),
  circle: (s) => full(s) && !s.mutates && named('circle', 'post', 'legal', 'certificate')(s),
  writes: (s) => full(s) && !!s.mutates,
  room: (s) => ROOM_VARIANTS.includes(s.variant),
  draws: (s) => s.variant === 'draws',
  variants: (s) => !full(s) && !ROOM_VARIANTS.includes(s.variant) && s.variant !== 'draws',
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
              for (const value of recorded.values) {
                if (moved.has(movedKey(state.id, value))) continue;
                if (!shows(texts, value)) missing.push(`${state.id}: ${value}`);
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
