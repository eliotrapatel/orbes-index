/**
 * NOCTURNE's overflow test (plan NOCTURNE, fidelity rule 5: extreme content). Every extreme case the stage reaches
 * (test/support/nocturne-states.ts, the states marked `stress`: a 24-character model name without a photograph, a
 * 14-character free-text field, six pieces and four orders, eight posts, every empty state, a price in USD and
 * € 125 400, a countdown under an hour and one over 9 days, a long tracking number and the longest host message) is
 * opened on the phone, and nothing may overflow: no sideways scroll, no element with words or a control past the
 * column, no words wider than their box, no words cut (an ellipsis, a clipped box, a clamp).
 *
 * KNOWN lists what the app cut before NOCTURNE, each with its reason: the build either removes it or the owner keeps it.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, overflows, UI_STATES } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

/** What overflowed at 5efd4c9 on purpose: a state, the start of the line overflows() writes, and why. */
const KNOWN: readonly { state: string; starts: string; reason: string }[] = [
  ...['now-stress', 'pieces-stress'].flatMap((state) => [
    {
      state,
      starts: 'span.live-banner__lead «LIVE RELEASE · MONOLITHE ARCHITECTURALE» is wider than its box',
      reason: 'The banner of the LIVE RELEASES is one line: a long name ends in an ellipsis there, whole on its page (live-banner.ts).',
    },
    {
      state,
      starts: 'span.live-banner__lead «LIVE RELEASE · MONOLITHE ARCHITECTURALE» is cut',
      reason: 'The same ellipsis of the one-line banner.',
    },
  ]),
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
