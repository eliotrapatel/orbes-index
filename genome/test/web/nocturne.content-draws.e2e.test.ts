/** NOCTURNE's content test, shard draws (test/web/nocturne.content.harness.ts: CONTENT_SHARDS). */
import { stateById } from '../support/nocturne-states.js';
import { contentSuite, hiddenGuaranteeSuite } from './nocturne.content.harness.js';

contentSuite('draws');

// Plan NEXT-NINE, IN-01: `quiet` holds a guarantee not shown on the open draw and on the drawn one.
const MARK = /THE HOUSE'S GUARANTEE|guaranteed place|guarantees you|with the house's guarantee/i;
const as = (id: string, over: Record<string, unknown>) => ({ ...stateById(id), id: `${id}-as-quiet`, ...over }) as ReturnType<typeof stateById>;
hiddenGuaranteeSuite('draws', [
  // The drawn release: its GUARANTEED lines, unmarked: no YOURS, no box.
  { state: stateById('draw-guaranteed-hidden'), absent: [MARK, /\bYOURS\b/], present: [/GUARANTEED . 1 PIECE/i, /GUARANTEED BY THE HOUSE/i] },
  // The open draw it is set aside for: no box.
  { state: as('draw-guaranteed', { as: 'quiet', ready: '.view--release .release__status' }), absent: [MARK] },
  // Its account sheet: no block.
  { state: as('draw-guarantee-account', { as: 'quiet', ready: '.n-account:not([hidden]) .n-account__rows' }), absent: [MARK] },
  // MY PIECES, RELEASES: no label beside its entry.
  { state: as('draw-guarantee-pieces', { as: 'quiet', ready: '.view--pieces .pieces__releases' }), absent: [MARK] },
]);
