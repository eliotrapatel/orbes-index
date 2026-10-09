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
  // HOW RELEASES WORK (plan NEXT-NINE, FT-01): its terms and THE TIERS' rows at 375, 360 and 320 px too.
  'releases-how',
  // A draw in sizes (plan NEXT LOT §3.6.F): its SIZES row, YOUR SIZE's picker and YOUR SIZES' lines, at 375, 360 and 320 px too.
  'draw-sizes',
  // The collector's side of the orders (plan NEXT LOT §3.6): DELIVERY ADDRESS, ENGRAVING, IN PREPARATION, a return asked
  // with its RETURN ADDRESS, RETURNS AND EXCHANGES' two buttons, YOUR ADDRESSES, at 375, 360 and 320 px too.
  'orders-delivery',
  'orders-case',
  'account-addresses',
  // CREATE ACCOUNT's names, COUNTRY and the optional question with IN A FEW WORDS (plan CUSTOMER INTELLIGENCE §3.1 P.4.1),
  // at 375, 360 and 320 px too.
  'sign-up',
  // YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8): its five groups, the date's three selects, YOUR TASTES two by two
  // with NO LONGER IN THE COLLECTION, at 375, 360 and 320 px too.
  'account-profile',
  'profile-tastes',
];
/** Of NARROW_TOO, opened at the stage's 390 px only: the LIVE room with the guarantee's line. */
const STAGE_ONLY = ['room-guaranteed'];
/** Whether a state is opened at the narrower phones too: by its name (NARROW_STATES), or named in NARROW_TOO. */
const atNarrow = (id: string) => NARROW_STATES.test(id) || (NARROW_TOO.includes(id) && !STAGE_ONLY.includes(id));

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
            for (const width of atNarrow(state.id) ? NARROW : []) {
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

/**
 * SHARE TO STORIES (plan NEXT-NINE, §3.8 BP-10): its three places with the button shown, then the preview open, at the
 * stage's 390 px and at 375, 360 and 320 px: nothing overflows, and the button, SHARE and SAVE IMAGE keep 44 px.
 */
describe.skipIf(!HAS_CHROMIUM)('SHARE TO STORIES: its places and its preview fit every phone (Chromium)', () => {
  it(
    'keeps the button, the preview, SHARE and SAVE IMAGE inside the column at 390, 375, 360 and 320 px, each 44 px high or more',
    async () => {
      const found: string[] = [];
      const states = ['live-confirmed', 'draw-place-held', 'result-ceremony'].map((id) => UI_STATES.find((s) => s.id === id)!);
      const tall = async (page: import('playwright-core').Page, name: string, where: string) => {
        const heights = await page.getByRole('button', { name, exact: true }).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        if (heights.length !== 1 || heights[0]! < 44) found.push(`${where}: ${name} ${heights.join(', ')}`);
      };
      await eachState(
        states,
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          const page = opened.page;
          try {
            // A share sheet that takes a file: SHARE shown beside SAVE IMAGE.
            await page.evaluate(() => {
              Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
              Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.resolve() });
            });
            const open = page.getByRole('button', { name: 'SHARE TO STORIES' });
            await open.waitFor({ state: 'visible', timeout: 20_000 });
            const size = page.viewportSize()!;
            for (const width of [size.width, ...NARROW]) {
              await page.setViewportSize({ width, height: size.height });
              await settle(page, 300);
              for (const line of await overflows(page)) found.push(`${state.id} at ${width} px: ${line}`);
              await tall(page, 'SHARE TO STORIES', `${state.id} at ${width} px`);
            }
            await page.setViewportSize(size);
            await open.click();
            await page.getByRole('dialog', { name: 'Your story card' }).waitFor({ state: 'visible' });
            for (const width of [size.width, ...NARROW]) {
              await page.setViewportSize({ width, height: 640 });
              await settle(page, 300);
              for (const line of await overflows(page)) found.push(`${state.id}, the preview at ${width} px: ${line}`);
              for (const name of ['SHARE', 'SAVE IMAGE']) await tall(page, name, `${state.id}, the preview at ${width} px`);
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    10 * 60_000,
  );
});
