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
 *
 * And the documents of ADD-ONS ONE SYSTEM (lot Q2, step Q2.11; plan §6, §7):
 *
 *  - docs/ARCHITECTURE.md B.20, "Add-ons, one system", carries the Shopify fit (D9, D26 to D28; macro scope S1 to S7)
 *    in its five lines, S2, S3, S4, S5 and S7, and names the code it describes by the names the code has;
 *  - docs/API.md: the admin add-on bodies (`kind`, `offeredAt`, `engraving`, `textMax` within the code's bounds),
 *    `GET /api/admin/addons?moment=`, the releases' `addonIds`, `PUT /api/v1/live/:id/addons` with `items`, the entry
 *    without the release add-ons, the engraving-prices routes gone, the new error codes with the code's own words;
 *  - docs/DATABASE.md: 0059 and 0060, `drop_addons` and `addon_conversions` with the code's bounds, the three tables
 *    dropped, `orders.addons` and `engraving_minor` kept as history, the newest migration the code's;
 *  - docs/SECURITY-MODEL.md and docs/THREAT-MODEL.md: the switches and picks the server's, the words never logged,
 *    the sentinel that holds what a collector reads;
 *  - docs/BRAND-DESIGN-SYSTEM.md's 5b, the matrix's 5b states, COMPLIANCE §13's Q2 deployment.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { ADDON_CONVERSION_SOURCES, ADDON_KINDS, ADDON_PICK_POSITION_MAX, ADDON_TEXT_MAX, LIVE_HOLD_MINUTES } from '../../src/server/db/schema.js';
import { READ_WAIT_MS } from '../../src/server/services/live-frames.js';
import { LIVE_QUEUE_FAR_POLL_MS } from '../../src/server/services/live-queue.js';
import { LIVE } from '../../src/web/verify/copy.js';
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
    // Since lot Q2 the newest is 0060 (below); 0058 stays named among them.
    expect(db).toMatch(/The application now runs on `0001` to `00\d\d`/);
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

const Q2 = section(architecture, '### B.20');

describe('ARCHITECTURE B.20: Add-ons, one system, and its Shopify fit (D9, D26 to D28)', () => {
  it('states the five lines of the Shopify fit, S2, S3, S4, S5 and S7, under the scope’s rule', () => {
    expect(Q2).toContain('**The Shopify fit** (D9, D26 to D28; macro scope S1 to S7, "No design may assume the platform is the only place people pay")');
    expect(Q2).toContain('**S2** (PAY, the hand-off): PAY\'s total is the exact order with its units, and every unit, a service\'s included, is a line item of that order\'s checkout and of the order export');
    expect(Q2).toContain('**S3** (fulfilment): packed by the platform, one checklist line per add-on, a service\'s included');
    expect(Q2).toContain('**S4** (stock): the platform holds the stock truth of a product add-on, as lot M3; a service has none to push.');
    expect(Q2).toContain('**S5** (catalogue mapping): one Shopify product of one variant per add-on, a service included');
    expect(Q2).toContain('*Requires shipping* `false` and no weight');
    expect(Q2).toContain('**S7** (perks at checkout): an add-on never counts toward the tier, and no perk changes.');
    expect(Q2).toContain('S1 and S6 do not change');
    // The service's row as the export writes it.
    expect(source('server/services/shopify.ts')).toContain("'Requires shipping': a.kind === 'SERVICE' ? 'false' : 'true'");
  });

  it('names the catalogue, the offer rule, the picks, the engraving and the conversion by the names the code has', () => {
    const named: [string, string[]][] = [
      ['server/services/addons.ts', ['defaultPick', 'checkPick', 'writePick']],
      ['server/services/order-addons.ts', ['addonOffer', 'setChoices', 'carryChoices', 'engravingUnits', 'ordersEngraving', 'addEngravingUnit', 'removeEngravingUnit']],
      ['server/services/sku-owner.ts', ['addonServiceSku', 'assertNotServiceSku']],
      ['web/verify/live-model.ts', ['securedAddons', 'securedChoice', 'engravingProblem', 'securedColumn']],
      ['web/admin/views/addons.ts', ['pickField']],
    ];
    for (const [file, names] of named) {
      const code = source(file);
      for (const name of names) {
        expect(Q2, name).toContain(`\`${name}\``);
        expect(code, `${file} ${name}`).toMatch(new RegExp(`export (async )?(function|const) ${name}\\b|function ${name}\\b`));
      }
    }
    for (const name of ['0059_addons_one_system', '0060_release_addons_converted']) {
      expect(Q2).toContain(`\`${name}\``);
      expect(Object.keys(MIGRATIONS)).toContain(name);
    }
    for (const name of ['order_addon_items_kind_guard', 'drop_addons', 'addon_conversions', 'addon_choices.text']) expect(Q2).toContain(`\`${name}\``);
    expect(existsSync(join(REPO, 'genome/src/web/verify/views/secured-addons.ts'))).toBe(true);
  });
});

describe('the other documents of ADD-ONS ONE SYSTEM (plan §6)', () => {
  const api = readDoc('docs/API.md');

  it('API: the admin add-on bodies, the form list, the releases’ picks and the collector’s rows', () => {
    const catalogue = section(api, '### 16.47');
    expect(ADDON_KINDS).toEqual(['PRODUCT', 'SERVICE']);
    expect(catalogue).toContain('`{ "kind"?: "PRODUCT"\\|"SERVICE", "name": 1–40');
    expect(catalogue).toContain(`"engraving"?: boolean, "textMax"?: ${ADDON_TEXT_MAX.min}–${ADDON_TEXT_MAX.max}`);
    expect(catalogue).toContain('"offeredAt"?: { "live"?, "draw"?, "salon"?, "orders"? }');
    expect(catalogue).toContain('**`?moment=LIVE\\|DRAW&currency=EUR`**');
    expect(catalogue).toContain('`why` `SWITCH_OFF` (its moment\'s switch is off) or `NO_PRICE`');
    // The release forms' list as the route serves it.
    expect(source('server/routes/admin/addons.ts')).toContain('addons.pickable(q.moment, q.currency)');
    expect(source('server/services/addons.ts')).toContain("const why = !r.on ? 'SWITCH_OFF' : priceMinor === null ? 'NO_PRICE' : null;");
    // The releases' picks.
    expect(section(api, '### 16.23')).toContain(`\`addonIds\` (lot Q2, ADD-ONS ONE SYSTEM, steps Q2.3 and Q2.4, D2, D3: the release add-ons of before, \`addons\`, are gone and refused as unknown), the catalogue add-ons offered at its purchase, in order, each once, at most ${ADDON_PICK_POSITION_MAX}`);
    expect(section(api, '### 16.19')).toContain(`\`addonIds\` (lot Q2, ADD-ONS ONE SYSTEM, step Q2.3, D3), the catalogue add-ons offered on its places held, in order, each once, at most ${ADDON_PICK_POSITION_MAX}`);
    // The collector's rows on a LIVE hold.
    const live = section(api, '### 10.12');
    expect(live).toContain('| `PUT /api/v1/live/:id/addons` | `{ "items": [ { "addonId", "text"? } ] }` |');
    expect(live).not.toContain('"addonIds": []');
    expect(live).not.toMatch(/^\s*"addons": \[/m);
    for (const field of ['`addonOffer`', '`addonItems`', '`legacyAddons`', '`textMax`', '`whileAvailable: true`']) expect(live, field).toContain(field);
    expect(source('server/http/schemas.ts')).toContain('z.strictObject({ addonId: uuid, text:');
    expect(section(api, '### 10.30')).toContain('**ONE OFFER RULE**');
  });

  it('API: the engraving-prices routes removed, and the error codes in the code’s own words', () => {
    expect(api).not.toMatch(/^\| (GET|PUT) \| `\/api\/admin\/orders\/engraving-prices` \|/m);
    expect(source('server/routes/admin/orders.ts')).not.toContain('engraving-prices');
    expect(api).not.toContain('LIVE_ADDON_UNKNOWN');
    expect(source('server/services/live.ts')).not.toContain('LIVE_ADDON_UNKNOWN');
    const words: [string, string, string][] = [
      ['ADDON_SERVICE', 'server/services/sku-owner.ts', ' is a service: it has no stock.'],
      ['ADDON_KIND_FIXED', 'server/services/addons.ts', 'An add-on’s type never changes: set this one aside and create the other.'],
      ['ADDON_ENGRAVING_TAKEN', 'server/services/addons.ts', 'Another add-on is the engraving: set it aside first.'],
      ['ADDON_ENGRAVING_FIXED', 'server/services/addons.ts', 'This add-on is on orders as the engraving: it stays the engraving. Set it aside to stop offering it.'],
    ];
    for (const [code, file, sentence] of words) {
      expect(api, code).toMatch(new RegExp(`^\\| \`${code}\` \\| 409 \\|`, 'm'));
      expect(api, code).toContain(sentence);
      expect(source(file), code).toContain(sentence);
    }
    // ADDON_NOT_OFFERED widened: the switch and the pick, as the service says them.
    const order = source('server/services/order-addons.ts');
    expect(order).toContain('is not one of this release’s add-ons.');
    expect(api).toContain('*GIFT WRAPPING is not one of this release’s add-ons.*');
    expect(api).toContain('*GIFT WRAPPING is not offered in YOUR ORDERS.*');
  });

  it('DATABASE: 0059 and 0060, the pick and the record within the code’s bounds, the three tables dropped, the history kept', () => {
    const db = readDoc('docs/DATABASE.md');
    const newest = Object.keys(MIGRATIONS).at(-1)!;
    expect(newest).toBe('0060_release_addons_converted');
    expect(db).toContain('The application now runs on `0001` to `0060`');
    expect(db).toContain('`0059_addons_one_system` (lot Q2, ADD-ONS ONE SYSTEM:');
    expect(db).toContain('`0060_release_addons_converted` (lot Q2: `addon_conversions` (§5.140)');
    expect(db).toContain('### 5.139 `drop_addons`');
    expect(db).toContain(`\`position\` (\`drop_addons_position_check\`, 1–${ADDON_PICK_POSITION_MAX}: no other cap, N12)`);
    expect(db).toContain('### 5.140 `addon_conversions`');
    expect(db).toContain(`\`${ADDON_CONVERSION_SOURCES[0]}\` or \`${ADDON_CONVERSION_SOURCES[1]}\``);
    expect(db).toContain(`\`addon_items_text_max_check\` (${ADDON_TEXT_MAX.min}–${ADDON_TEXT_MAX.max})`);
    expect(db).toContain('`order_addon_items_kind_guard`');
    expect(db).toContain('Re-created by migration `0059_addons_one_system` (lot Q2, D4) with `AND u.location_id IS NOT NULL`');
    for (const table of ['5.41 `live_addons`', '5.42 `live_entry_addons`', '5.89 `engraving_prices`']) {
      expect(section(db, `### ${table}`), table).toMatch(/^\s*\*\*Dropped by migration `0060_release_addons_converted`/);
    }
    expect(db).toContain('**History since lot Q2** (migration `0060`, N15)');
    expect(source('server/db/migrations/0060_release_addons_converted.ts')).toContain('DROP TABLE');
  });

  it('SECURITY-MODEL and THREAT-MODEL: the switches and picks the server’s, the words never logged, the sentinel', () => {
    const sentinel = 'test/security/collector-never-sees-staff-data.test.ts';
    const security = readDoc('docs/SECURITY-MODEL.md');
    expect(security).toContain('**Add-ons, one system: the switches and the picks the server\'s**');
    expect(security).toContain('**every switch and every pick is enforced on the server**');
    expect(security).toContain('**never in the audit log, the order\'s events or the journal** (`drop.live.addons` records `text: true`');
    expect(security).toContain(`The sentinel \`${sentinel}\` builds a LIVE hold with a product and a service chosen`);
    const threat = readDoc('docs/THREAT-MODEL.md');
    expect(threat).toContain('| **AO. An add-on taken where it is not offered, or the engraving\'s words leaked**');
    expect(threat).toContain(`the sentinel \`${sentinel}\` looks for its kind, stock, supplier, SKU, switches, releases and another release's pick`);
    // The sentinel still looks for them.
    const test = readDoc(join('genome', sentinel));
    for (const key of ["'kind'", "'offeredAt'"]) expect(test, key).toContain(key);
    // The words are never in the audit: the hold's audit says only that they were given.
    expect(source('server/services/order-addons.ts')).toMatch(/text: true/);
  });

  it('BRAND, the matrix and COMPLIANCE: 5b drawn, its states listed, the Q2 deployment recorded', () => {
    const brand = section(readDoc('docs/BRAND-DESIGN-SYSTEM.md'), '### Lot Q1');
    expect(LIVE.addonText.label).toBe('YOUR TEXT');
    expect(brand).toContain('- **5b, SECURED with add-ons** (lot Q2 of 2026-10-25');
    expect(brand).toContain('**The mark is a 9 px ring**');
    expect(brand).toContain('**that lights into the Horizon\'s point when chosen**');
    expect(brand).toContain('**a faint light pooled above it at 7 % at most**');
    expect(brand).toContain('**YOUR TEXT**');
    expect(source('web/verify/house.css')).toContain('rgba(246, 242, 234, 0.07)');
    const matrix = readDoc('docs/launch/NOCTURNE-MATRIX.md');
    const states = readDoc('genome/test/support/nocturne-states.ts');
    for (const id of ['addons-hold', 'addons-hold-text-error', 'addons-hold-light', 'addons-hold-stress', 'addons-pay', 'live-secured', 'set-live-secured']) {
      expect(matrix, id).toMatch(new RegExp(`^\\| \`${id}\` \\|`, 'm'));
      expect(states, id).toContain(`id: '${id}'`);
    }
    const desk15 = states.slice(states.indexOf("'desk-15': ["), states.indexOf('],', states.indexOf("'desk-15': [")));
    const count = desk15.split('onDesk(').length - 1;
    expect(matrix).toContain(`| \`desk-15\` | ${count} |`);
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 13.');
    expect(compliance).toContain('**Le déploiement ADD-ONS ONE SYSTEM**');
    expect(compliance).toContain('`0059_addons_one_system` et `0060_release_addons_converted`');
    expect(compliance).toContain('(launch/DEPLOY-OQ-Q2.md)');
  });
});
