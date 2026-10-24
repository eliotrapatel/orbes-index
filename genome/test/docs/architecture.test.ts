/**
 * The documents of ONE QUEUE (lot Q1, step Q1.13; plan §6, §7) against the code they describe:
 *
 *  - docs/ARCHITECTURE.md B.19, the LIVE engine's single waiting line, carries the Shopify fit (D53; macro scope S1 to
 *    S7, "No design may assume the platform is the only place people pay") in its three lines, S2 (PAY, the single
 *    hand-off point for a future Shopify checkout of that exact order), S4 (the band shows the platform's stock,
 *    `drop_sizes`, and ADD PIECES is the event a sync pushes) and S7 (the tier order unchanged), and names the code it
 *    describes by the names the code has (the engine's batches, the frame gate, the snapshot, the sounds);
 *  - docs/API.md §10.12 documents what a phone receives since ONE QUEUE (the entry's own five figures, the room without
 *    the line's length or the pieces held, `pollMs` from its own estimate), never lot M1's queue frame or `ahead`;
 *  - docs/SECURITY-MODEL.md and docs/THREAT-MODEL.md say the pace is hidden and name the sentinel that holds it;
 *  - docs/DATABASE.md documents 0058 and the meaning of `admitted_at` / `admitted_batch`, with the hold's bounds the
 *    code's;
 *  - docs/BRAND-DESIGN-SYSTEM.md's lot Q1 lists every designed sound of a LIVE RELEASE the code ships, by its file.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE_HOLD_MINUTES } from '../../src/server/db/schema.js';
import { READ_WAIT_MS } from '../../src/server/services/live-frames.js';
import { LIVE_QUEUE_FAR_POLL_MS } from '../../src/server/services/live-queue.js';
import { LIVE_GAIN, LIVE_SOUNDS, SFX_AT } from '../../src/web/verify/live-sound.js';
import { REPO, readDoc, section } from './lexicon.js';

const architecture = readDoc('docs/ARCHITECTURE.md');
const b19 = section(architecture, '### B.19');
const source = (path: string): string => readDoc(join('genome/src', path));

describe('ARCHITECTURE B.19: the LIVE engine of ONE QUEUE and its Shopify fit (D53)', () => {
  it('states the three lines of the Shopify fit, S2, S4 and S7, under the scope’s rule', () => {
    expect(b19).toContain('**The Shopify fit** (D53; macro scope S1 to S7, "No design may assume the platform is the only place people pay")');
    expect(b19).toContain('**S2**: PAY is the single hand-off point for a future Shopify checkout of that exact order');
    expect(b19).toContain('**S4**: the band shows the platform\'s stock (`drop_sizes`), and ADD PIECES is the event a sync pushes');
    expect(b19).toContain('**S7** (perks at checkout): the perks stay with the checkout; PAY carries the order\'s total and applies none of them');
    expect(b19).toContain('The tier order is unchanged (the line at T0 by the tier read then');
    expect(b19).toContain('S1, S3, S5 and S6 do not change');
  });

  it('names the engine, the frame gate, the snapshot and the sounds by the names the code has', () => {
    const live = source('server/services/live.ts');
    for (const name of ['giveDue', 'batchGrants', 'paceNextAt', 'holdEndsAt', 'giveTurnsAtOnce', 'setTurns']) {
      expect(b19, name).toContain(`\`${name}\``);
      expect(live, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(source('server/services/live-frames.ts')).toContain('export class LiveFrameGate');
    expect(b19).toContain('`LiveFrameGate`');
    expect(b19).toContain('`READ_WAIT_MS`');
    expect(READ_WAIT_MS).toBe(60_000);
    expect(b19).toContain('60 s at most');
    const queue = source('server/services/live-queue.ts');
    for (const name of ['liveQueueSnapshot', 'queuePlaces', 'closeGuard']) {
      expect(b19, name).toContain(`\`${name}\``);
      expect(queue, name).toMatch(new RegExp(`export (async )?function ${name}\\b`));
    }
    // The sounds as static assets: the build's loader, the engine, its gain, the welcome's memory.
    expect(source('../scripts/build-web.ts')).toContain("'.mp3': 'file'");
    expect(b19).toContain('`/assets/<name>-<hash>.mp3`');
    expect(b19).toContain('`SFX_AT`');
    expect(LIVE_GAIN).toBe(0.9);
    expect(b19).toContain('a gain of 0.9');
    expect(LIVE_SOUNDS).toHaveLength(11);
    expect(b19).toContain('eleven LIVE files');
    expect(b19).toContain('`orbes.live.welcome`');
    for (const file of ['server/services/live-queue.ts', 'server/services/live-frames.ts', 'web/verify/live-sound.ts', 'web/verify/live-horizon.ts', 'web/verify/live-seal.ts']) {
      expect(existsSync(join(REPO, 'genome/src', file)), file).toBe(true);
    }
  });
});

describe('the other documents of ONE QUEUE (plan §6)', () => {
  it('API §10.12: the entry’s own five figures, the room without the line or the pieces held, no queue frame', () => {
    const api = readDoc('docs/API.md');
    const live = section(api, '### 10.12');
    expect(live).toContain('`{ "place", "waitMs", "paused", "next", "out" }`');
    expect(live).toContain('"sizes": [{ "id", "label", "piece"?, "stock", "left", "serves", "out" }], "pieces"?: [{ "piece", "name", "variant", "imageUrl", "sizes" }]');
    expect(live).not.toMatch(/"line", "quantity"|"held", "sizes"|"nextBatchAt"|`etaAt`|`ahead`/);
    expect(live).toContain('the `queue` event of lot M1 is gone');
    // pollMs: from the entry's own estimate, within the code's bounds.
    expect(LIVE_QUEUE_FAR_POLL_MS).toEqual({ min: 10_000, max: 60_000, held: 30_000 });
    expect(live).toContain('`pollMs` is a quarter of its own estimate, within 10 000 and 60 000 ms in whole seconds, and 30 000 while the batches are held');
    // The console's routes and the engine's audit.
    const console = section(api, '### 16.23');
    for (const route of ['/api/admin/live/:id/hold/shorten', '/api/admin/live/:id/hold/end']) expect(console).toContain(`\`${route}\``);
    expect(console).toContain('`drop.live.batch` for each batch that gave a turn');
    expect(console).toContain('`pace` and `holdMinutes`');
    expect(console).toContain(`\`holdMinutes\` ${LIVE_HOLD_MINUTES.min}–${LIVE_HOLD_MINUTES.max}`);
  });

  it('SECURITY-MODEL and THREAT-MODEL: the pace hidden, held by the sentinel', () => {
    const sentinel = 'test/security/collector-never-sees-staff-data.test.ts';
    expect(existsSync(join(REPO, 'genome', sentinel))).toBe(true);
    const security = readDoc('docs/SECURITY-MODEL.md');
    expect(security).toContain('**ONE QUEUE: the pace hidden**');
    expect(security).toContain(`The sentinel \`${sentinel}\``);
    const threat = readDoc('docs/THREAT-MODEL.md');
    expect(threat).toContain('| **AN. The pace read from the page, or ONE QUEUE gamed**');
    expect(threat).toContain(`The sentinel \`${sentinel}\``);
  });

  it('DATABASE: 0058 and what admitted_at and admitted_batch mean since', () => {
    const db = readDoc('docs/DATABASE.md');
    expect(source('server/db/migrate.ts')).toContain('0058_one_queue');
    expect(db).toContain('`0058_one_queue` (lot Q1, ONE QUEUE:');
    expect(db).toContain('The application now runs on `0001` to `0058`');
    expect(db).toContain(`\`CHECK (pace_hold_minutes BETWEEN ${LIVE_HOLD_MINUTES.min} AND ${LIVE_HOLD_MINUTES.max})\``);
    expect(db).toContain('**"given its turn by batch N at the batch\'s logical time"**');
  });

  it('BRAND lot Q1: every designed sound the code ships, by its file, with its cue', () => {
    const brand = section(readDoc('docs/BRAND-DESIGN-SYSTEM.md'), '### Lot Q1');
    for (const name of LIVE_SOUNDS) expect(brand, name).toContain(`| \`${name}.mp3\` |`);
    // Each cue the table says is the code's offset (SFX_AT, seconds from the passage's start).
    expect(SFX_AT.draw).toEqual([['draw', 0.85]]);
    expect(SFX_AT.open).toEqual([['opening', 0.4], ['welcome', 3.0]]);
    expect(SFX_AT.turn).toEqual([['turn', 0.3]]);
    expect(SFX_AT.secured).toEqual([['secured', 0.6]]);
    expect(SFX_AT.sold).toEqual([['sold-out', 0.25]]);
    expect(SFX_AT.confirmed).toEqual([['confirmed', 0.6]]);
    expect(SFX_AT.after).toEqual([['after-room', 1.15]]);
    expect(brand).toContain('0.85 s after 00:00');
    expect(brand).toContain('0.6 s into the CONFIRMED moment');
    expect(brand).toContain("1.15 s into the after-room's door");
    expect(brand).toContain('0.4 s into THE OPENING');
    expect(brand).toContain('3.0 s into THE OPENING');
    expect(brand).toContain('0.3 s after the turn appears');
    expect(brand).toContain('0.6 s into SECURED');
    expect(brand).toContain('0.25 s into SOLD OUT');
  });
});
