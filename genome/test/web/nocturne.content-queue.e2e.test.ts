/** NOCTURNE's content test, shard queue (test/web/nocturne.content.harness.ts: CONTENT_SHARDS). */
import { stateById } from '../support/nocturne-states.js';
import { contentSuite, noticeSuite } from './nocturne.content.harness.js';

contentSuite('queue');

// ONE QUEUE (lot Q1, step Q1.8; OP-6, N10; MK Q3, Q4): on the queue FROM ORBES alone above, the release's PAUSED (Q3) or
// THE QUEUE IS PAUSED (Q4) inside the screen above its frozen time, once.
noticeSuite('The one queue’s notice: FROM ORBES alone, the pause above the frozen time', [
  { state: stateById('live-queue-release-paused'), fromOrbes: true, paused: 'PAUSED' },
  { state: stateById('live-queue-paused'), fromOrbes: true, paused: 'THE QUEUE IS PAUSED' },
]);
