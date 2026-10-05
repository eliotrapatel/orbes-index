/**
 * NOCTURNE's content test (plan NOCTURNE, fidelity rule 4: every field and every state). The baseline
 * (test/fixtures/nocturne-baseline.json, recorded by scripts/parity.ts --baseline on the app as it was before NOCTURNE,
 * 5efd4c9) holds every text value each state of /verify and /legal showed on the NOCTURNE demo; this test reaches each
 * state again (test/support/nocturne-states.ts) and checks that each value is still shown there: case-insensitive,
 * whitespace folded, a value « A · B » shown whole or part by part, the parts the server writes («id», «ref», «code»…)
 * read as any word.
 *
 * Nothing may disappear but what MOVED lists: a value moved (or removed) on purpose, with its reason and its new place.
 * Each entry names a value of the baseline, so the list can never excuse a value that was not there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_VARIANTS } from '../support/nocturne-demo.js';
import { BASELINE_FILE, eachState, type Baseline } from '../support/nocturne-stage.js';
import { BOARD_STATES, normalizeText, openState, pageText, shows, stateById, UI_STATES } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;

/** A value moved or removed on purpose: the state it was in, the value, why, and where it is now. */
interface Moved {
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
const MOVED: readonly Moved[] = [];

const movedKey = (state: string, value: string) => `${state}\u0000${normalizeText(value)}`;
const moved = new Set(MOVED.map((m) => movedKey(m.state, m.value)));

describe('NOCTURNE content baseline', () => {
  it('covers every state the stage reaches, and every validated board has its state', () => {
    expect(Object.keys(baseline.states).sort()).toEqual(UI_STATES.map((s) => s.id).sort());
    for (let i = 1; i <= 43; i++) expect(BOARD_STATES[`C${i}`], `C${i}`).toBeDefined();
    for (const id of Object.values(BOARD_STATES)) expect(() => stateById(id)).not.toThrow();
    for (const s of UI_STATES) expect(DEMO_VARIANTS).toContain(s.variant);
  });

  it('records values, and lists no move that is not a value of its state', () => {
    for (const [id, s] of Object.entries(baseline.states)) expect(s.values.length, id).toBeGreaterThan(0);
    for (const m of MOVED) {
      expect(m.reason.trim().length, `${m.state}: ${m.value}`).toBeGreaterThan(0);
      expect(m.now.trim().length, `${m.state}: ${m.value}`).toBeGreaterThan(0);
      expect(baseline.states[m.state]?.values.map(normalizeText), `${m.state}: ${m.value}`).toContain(normalizeText(m.value));
    }
  });
});

describe.skipIf(!HAS_CHROMIUM)('NOCTURNE content: every value of the baseline is still shown in its state (Chromium)', () => {
  it(
    'shows every value of every state, but those moved on purpose',
    async () => {
      const missing: string[] = [];
      await eachState(
        Object.keys(baseline.states).map(stateById),
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          try {
            const text = await pageText(opened.page);
            for (const value of baseline.states[state.id]!.values) {
              if (moved.has(movedKey(state.id, value))) continue;
              if (!shows(text, value)) missing.push(`${state.id}: ${value}`);
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(missing).toEqual([]);
    },
    40 * 60_000,
  );
});
