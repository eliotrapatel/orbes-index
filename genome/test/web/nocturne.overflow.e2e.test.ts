/**
 * NOCTURNE's overflow test (plan NOCTURNE, fidelity rule 5: extreme content). Every extreme case the stage reaches
 * (test/support/nocturne-states.ts, the states marked `stress`: a 24-character model name without a photograph, a
 * 14-character free-text field, ten pieces and four orders, eight posts, every empty state, a price in USD and
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
 * 320 px): THE COLLECTION and a model's sheet since N6 (a model's next release a draw, ENTRIES CLOSE … UTC); THE
 * RELEASES, a draw's page and a LIVE RELEASE's pages since N7 (a date of THE REVEALS held whole while it fits); THE
 * CIRCLE, a post, the sign-in and the legal pages since N8 (a post's duo, rows and results, the four tabs in French);
 * MY PIECES and a piece that could not be shown since N9 (C40); YOUR SIZES' view in the account sheet (plan NEXT-NINE,
 * AC-01).
 */
const NARROW = [375, 360, 320] as const;
const NARROW_STATES = /^(collection|model|releases|live-|draw|circle|post|legal|pieces-sign|pieces-failed|piece-failed|sizes-view)(-|$)/;
/**
 * Screens that are not extreme cases but hold the longest lines: N7's THE REVEALS of a release not yet revealed (C7,
 * C28); N8's feed with an invitation's YES / NO (C8), an invitation's and a poll's rows, duo and results (C22, C34),
 * MY PIECES' sign-in refused (C18) and the French legal pages, their four tabs on two lines (C23, C41); N9's
 * could-not-be-shown of MY PIECES, a piece, THE CIRCLE and a post, each with the reason the browser gives (C40).
 */
const NARROW_TOO = [
  'releases', 'live-veiled', 'circle', 'post-invitation', 'post-poll', 'post-poll-voted', 'pieces-sign-in-refused', 'legal-terms-fr', 'legal-faq-fr', 'pieces-failed', 'piece-failed', 'circle-failed', 'post-failed',
  // The tier program (plan NEXT-NINE, BP-19): THE CLUB, IN USE and the yearly care's block at 375, 360 and 320 px too.
  'club', 'club-platine', 'account-sheet-in-use', 'piece-care-request', 'piece-care-requested', 'piece-care-label', 'piece-care-returning',
  // THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01): its box, GUARANTEED BY THE HOUSE, the account sheet's blocks, the
  // LIVE RELEASE's line, at 375, 360 and 320 px too (the room at the stage's 390 px).
  'draw-guaranteed', 'draw-guaranteed-entered', 'draw-guaranteed-drawn', 'draw-guarantee-account', 'draw-guarantee-pieces', 'live-announced-guaranteed', 'room-guaranteed',
  // YOUR SIZES (plan NEXT-NINE, AC-01): its view in the account sheet, the salon's size picker and I'LL BE THERE with the
  // size it preselects, at 375, 360 and 320 px too.
  'sizes-view', 'model-salon-sizes', 'model-salon-size-requested', 'live-announced-from-yours',
];

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
      const narrowToo = UI_STATES.filter((s) => !s.stress && NARROW_TOO.includes(s.id));
      expect(narrowToo.map((s) => s.id).sort()).toEqual([...NARROW_TOO].sort());
      await eachState(
        [...stress, ...narrowToo],
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
