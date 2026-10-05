/**
 * NOCTURNE's overflow test (plan NOCTURNE, fidelity rule 5: extreme content). Every extreme case the stage reaches
 * (test/support/nocturne-states.ts, the states marked `stress`: a 24-character model name without a photograph, a
 * 14-character free-text field, six pieces and four orders, eight posts, every empty state, a price in USD and
 * € 125 400, a countdown under an hour and one over 9 days, a long tracking number and the longest host message) is
 * opened on the phone, and nothing may overflow: no sideways scroll, no element with words or a control past the
 * column or past its parent's box, no box whose content spills out of it, no words wider than their box, no words cut
 * (an ellipsis, a clipped box, a clamp).
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
  // The resting orbit round the wordmark of today's landing: a drawing (aria-hidden, absolutely placed, inset -15 %) that
  // reaches past the emblem on purpose. NOW replaces the landing (N3).
  ...['now-empty', 'now-stress'].flatMap((state) =>
    ['div.landing__center spills out of its box', 'div.landing__emblem spills out of its box'].map((starts) => ({
      state,
      starts,
      reason: 'The resting orbit (.landing__orbit, inset -15 %) is a drawing round the wordmark, wider than its emblem on purpose.',
    })),
  ),
  // A defect of the app at 5efd4c9, found by the check of a box's content and of a parent's edges: the tracking number of
  // 27 characters is one word the row's value does not break, so it pushes the row past its plate and into the page's
  // margin (to 388 of 390 px). The build removes it (N2's rows break a long value, N5 checks MY PIECES' orders).
  ...[
    'section.pieces__orders spills out of its box',
    'ul.pieces__order-list spills out of its box',
    'li.pieces__order-item spills out of its box',
    'article.pieces__order spills out of its box',
    'dl.rows.pieces__order-shipment spills out of its box',
    'div.rows__row spills out of its box',
    'dd.rows__value «XY48291563748201937465012FR» reaches past its parent div.rows__row',
  ].map((starts) => ({
    state: 'pieces-stress',
    starts,
    reason: 'The long tracking number is not broken in its row at 5efd4c9: it reaches into the page margin. NOCTURNE removes it.',
  })),
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
