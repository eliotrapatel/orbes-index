/** NOCTURNE's content test, shard room (test/web/nocturne.content.harness.ts: CONTENT_SHARDS). */
import { stateById } from '../support/nocturne-states.js';
import { contentSuite, hiddenGuaranteeSuite } from './nocturne.content.harness.js';

contentSuite('room');

// Plan NEXT-NINE, IN-01: `roomQuiet` holds a guarantee not shown: let in, with no line of it.
hiddenGuaranteeSuite('room', [{ state: stateById('room-guarantee-hidden'), absent: [/THE HOUSE'S GUARANTEE|first in line in your size|guarantees you/i], present: [/GRANTED/i] }]);
