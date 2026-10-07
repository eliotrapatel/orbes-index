/** NOCTURNE's content test, shard stress (test/web/nocturne.content.harness.ts: CONTENT_SHARDS). */
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, overflows, settle, stateById } from '../support/nocturne-states.js';
import { contentSuite, HAS_CHROMIUM } from './nocturne.content.harness.js';

contentSuite('stress');

/** One per model of the family (`models_variant_label_key`): the main model's, then its variant's. */
const LONGEST = { main: 'Polished steel with a brushed outer band', variant: 'Brushed cobalt with a polished inner rim' } as const;
const WIDTHS = [375, 360, 320] as const;
/** Each state's line, and the label it shows: the piece to scan is of the variant, the registered one of the main model. */
const LINES: Readonly<Record<string, { selector: string; label: string }>> = {
  'result-stress': { selector: '.n-result__variant', label: LONGEST.variant },
  'piece-stress': { selector: '.piece__variant', label: LONGEST.main },
  'pieces-stress': { selector: '.n-pieces__variant', label: LONGEST.main },
};

/**
 * The variant line's extreme case (plan NEXT LOT §3.1, edge cases): the longest label a model can carry (40 characters,
 * `models_variant_label_check`) on the stress demo's 24-character model and its variant, set for this test only (the
 * baseline keeps the demo's labels). On a result, a piece's page and MY PIECES, the line shows whole under the name and
 * wraps like the lines under it: nothing overflows at the stage's 390 px nor at 375, 360 and 320 px.
 */
describe.skipIf(!HAS_CHROMIUM)('NOCTURNE stress: the longest variant label (plan NEXT LOT §3.1)', () => {
  it(
    'shows a 40-character label whole under the model name, with nothing overflowing at 390, 375, 360 and 320 px',
    async () => {
      expect(LONGEST.main).toHaveLength(40);
      expect(LONGEST.variant).toHaveLength(40);
      const found: string[] = [];
      let seen = 0;
      await eachState(
        Object.keys(LINES).map(stateById),
        async (state, { stage, demo, browser }) => {
          // The 24-character model (« Polished ») and its variant (« Brushed cobalt »): the pieces these states show.
          await stage.db.updateTable('models').set({ variant_label: LONGEST.main }).where('sku_prefix', '=', 'MNL-AR').execute();
          await stage.db.updateTable('models').set({ variant_label: LONGEST.variant }).where('sku_prefix', '=', 'MNL-AR-BC').execute();
          const opened = await openState(browser, stage, demo, state);
          try {
            const size = opened.page.viewportSize()!;
            for (const width of [size.width, ...WIDTHS]) {
              if (width !== size.width) {
                await opened.page.setViewportSize({ width, height: size.height });
                await settle(opened.page, 300);
              }
              const { selector, label } = LINES[state.id]!;
              const line = opened.page.locator(selector).first();
              expect((await line.innerText()).replace(/\s+/g, ' ').trim(), `${state.id} at ${width} px`).toBe(label.toUpperCase());
              for (const o of await overflows(opened.page)) found.push(`${state.id} at ${width} px: ${o}`);
              seen += 1;
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(seen).toBe(Object.keys(LINES).length * (WIDTHS.length + 1));
      expect(found).toEqual([]);
    },
    10 * 60_000,
  );
});
