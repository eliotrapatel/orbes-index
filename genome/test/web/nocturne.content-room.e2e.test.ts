/** NOCTURNE's content test, shard room (test/web/nocturne.content.harness.ts: CONTENT_SHARDS). */
import { ROOM_SIZE_STATES, stateById } from '../support/nocturne-states.js';
import { contentSuite, hiddenGuaranteeSuite, shownSuite } from './nocturne.content.harness.js';

contentSuite('room');

// Plan NEXT-NINE, IN-01: `roomQuiet` holds a guarantee not shown: let in, with no line of it.
hiddenGuaranteeSuite('room', [{ state: stateById('room-guarantee-hidden'), absent: [/THE HOUSE'S GUARANTEE|first in line in your size|guarantees you/i], present: [/GRANTED/i] }]);

// Plan NEXT-NINE, AC-01: the room of `sized` (a bracelet of 17 cm saved, no I'LL BE THERE): 17 preselected, SIZE 17 · FROM
// YOUR SIZES and READY CHECK's 17 · TO CONFIRM; 17 tapped, the lines go and the size is ready (the state's way there
// waits for its tick). Texts folded to lower case, as pageTexts gives them.
const [fromYours, confirmed] = ROOM_SIZE_STATES;
shownSuite('YOUR SIZES in the room: FROM YOUR SIZES and TO CONFIRM, then ready', [
  { state: fromYours!, present: [/^17 · to confirm$/, /^size 17 · from your sizes$/, /^check it is right for this model before you confirm\.$/] },
  { state: confirmed!, present: [/^your size$/], absent: [/to confirm/, /from your sizes/] },
]);
