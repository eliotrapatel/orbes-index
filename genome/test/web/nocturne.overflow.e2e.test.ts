/**
 * NOCTURNE's overflow test (plan NOCTURNE, fidelity rule 5: extreme content). Every extreme case the stage reaches
 * (test/support/nocturne-states.ts, the states marked `stress`: a 24-character model name without a photograph, a
 * 14-character free-text field, six pieces and four orders, eight posts, every empty state, a price in USD and
 * € 125 400, a countdown under an hour and one over 9 days, a long tracking number and the longest host message) is
 * opened on the phone, and nothing may overflow: no sideways scroll, no element with words or a control past the
 * column or past its parent's box, no box whose content spills out of it, no words wider than their box, no words cut
 * (an ellipsis, a clipped box, a clamp).
 *
 * KNOWN lists what the app cut before NOCTURNE, each with its reason: the build either removes it or the owner keeps it
 * (empty since N3).
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, overflows, settle, UI_STATES } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

/**
 * The narrower phones a screen's extreme cases are opened at too, after the stage's 390 px (fidelity rule 5 holds from
 * 320 px): THE COLLECTION and a model's sheet since N6 (a model's next release a draw, ENTRIES CLOSE … UTC).
 */
const NARROW = [375, 360, 320] as const;
const NARROW_STATES = /^(collection|model)(-|$)/;

/** What overflowed at 5efd4c9 on purpose: a state, the start of the line overflows() writes, and why. */
const KNOWN: readonly { state: string; starts: string; reason: string }[] = [
  // (N3: the resting orbit of the landing's wordmark, which reached past its emblem on purpose, left with the landing:
  // NOW replaces it.)
];

describe.skipIf(!HAS_CHROMIUM)('NOCTURNE overflow: nothing overflows its column in the extreme cases (Chromium)', () => {
  it(
    'keeps every word and control of every extreme case inside its column, uncut',
    async () => {
      const found: string[] = [];
      const stress = UI_STATES.filter((s) => s.stress);
      expect(stress.length).toBeGreaterThan(10);
      await eachState(
        stress,
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          try {
            for (const line of await overflows(opened.page)) {
              if (!KNOWN.some((k) => k.state === state.id && line.startsWith(k.starts))) found.push(`${state.id}: ${line}`);
            }
            // The narrower phones too: the same page, made narrower.
            const size = opened.page.viewportSize()!;
            for (const width of NARROW_STATES.test(state.id) ? NARROW : []) {
              await opened.page.setViewportSize({ width, height: size.height });
              await settle(opened.page, 300);
              for (const line of await overflows(opened.page)) {
                if (!KNOWN.some((k) => k.state === state.id && line.startsWith(k.starts))) found.push(`${state.id} at ${width} px: ${line}`);
              }
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    20 * 60_000,
  );
});
