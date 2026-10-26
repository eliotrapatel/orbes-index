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
 *    dropped, `orders.addons` and `engraving_minor` kept as history, 0060 among the code's migrations;
 *  - docs/SECURITY-MODEL.md and docs/THREAT-MODEL.md: the switches and picks the server's, the words never logged,
 *    the sentinel that holds what a collector reads;
 *  - docs/BRAND-DESIGN-SYSTEM.md's 5b, the matrix's 5b states, COMPLIANCE §13's Q2 deployment.
 *
 * And the documents of THE VAULT (lot Q3, step Q3.15; plan §7, §8):
 *
 *  - docs/ARCHITECTURE.md B.21, THE VAULT, carries the Shopify fit (D60; macro scope S1 to S7) in its six lines, S2 to
 *    S7, and names the code it describes by the names the code has (the sources' hooks, the draw, the deliveries);
 *  - docs/API.md §10.32 and §16.50: every route of THE VAULT as the routes register it, the register's `invite`, the
 *    opening's limit, the error codes in the code's own words, no revoke route;
 *  - docs/DATABASE.md: 0061 and 0062 among the code's migrations, their six tables (§5.141 to §5.146) within the
 *    code's bounds, the outcome written once, the down steps;
 *  - docs/SECURITY-MODEL.md and docs/THREAT-MODEL.md: the server's draw, the idempotent opening, the codes, the caps,
 *    the test entrants, the farming (row AP), the sentinel;
 *  - docs/BRAND-DESIGN-SYSTEM.md's lot Q3 (the five sounds and their cues, the gesture's and the opening's figures),
 *    the matrix's vault states and the desk-16 and desk-17 counts, SALES-PLAYBOOK's two copies, COMPLIANCE §13's Q3.
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
import { VAULT_OPEN_PER_MINUTE } from '../../src/server/http/rate-limit.js';
import { INVITATION_CODE_PATTERN, VAULT_CAP, VAULT_NOTE_MAX, VAULT_ODDS_IN_MAX, VAULT_OCCASION_INDEX_MAX, VAULT_PER_OCCASION, VAULT_REWARD_KINDS, VAULT_SOURCES, VAULT_WAIT_DAYS } from '../../src/server/db/schema.js';
import { VAULT_CARD_LINE } from '../../src/server/services/parcels.js';
import { VAULT_SOUNDS } from '../../src/web/verify/live-sound.js';
import { DRAW_PX, HOLD_MS, OPENING_MS, RARE_K, RESET_MS, VIBRATION } from '../../src/web/verify/vault/vault-opening.js';
import { CALM_SHARE, FLOAT_AX, FLOAT_AY, HELD_MS, HELD_SHARE } from '../../src/web/verify/vault/vault-float.js';
import { DESK_GROUPS, PHONE_STATES } from '../support/nocturne-states.js';
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
    // Since lot Q3 the newest is later (0061…); 0059 and 0060 stay named among them.
    expect(Object.keys(MIGRATIONS)).toContain('0060_release_addons_converted');
    expect(db).toMatch(/The application now runs on `0001` to `00\d\d`/);
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

const Q3 = section(architecture, '### B.21');

describe('ARCHITECTURE B.21: THE VAULT and its Shopify fit (D60, plan §8)', () => {
  it('states the six lines of the Shopify fit, S2 to S7, under the scope’s rule', () => {
    expect(Q3).toContain('**The Shopify fit** (D60; macro scope S1 to S7, "No design may assume the platform is the only place people pay")');
    expect(Q3).toContain('**S2** (payments): a right to buy is an order of the platform paid as every platform order, later through a Shopify checkout for that exact order; a VAULT order at 0 is a platform order with no checkout.');
    expect(Q3).toContain('**S3** (fulfilment): every VAULT order is packed and shipped by the platform');
    expect(Q3).toContain('**S4** (stock): the units won and the VAULT EDITION\'s come out of the platform\'s stock like any order\'s');
    expect(Q3).toContain('**S5** (catalogue mapping): a vault-only model is left out of the product export and maps, by its pasted ids only, to a Shopify product kept unpublished');
    expect(Q3).toContain('**S6** (ownership): a Shopify piece registered to its buyer, automatically or by its claim code, opens its PIECE vault at that first registration');
    expect(Q3).toContain('**S7** (perks at checkout): a VAULT credit is a credit like the others, applied at checkout as the platform\'s credits will be');
    expect(Q3).toContain('S1 does not change');
    // The export's own words: a VAULT order's source, a vault-only model never a line.
    const shopify = source('server/services/shopify.ts');
    expect(Q3).toContain('*Source* `orbes-vault`');
    expect(shopify).toContain('« orbes-vault »');
    expect(shopify).toContain(".where('vault_only', '=', false)");
    // M4's margin (D61).
    expect(Q3).toContain('renumbering its migrations after `0062`');
  });

  it('names the sources, the draw and the deliveries by the names the code has', () => {
    const named: [string, string[]][] = [
      ['server/services/vault.ts', ['giveVault', 'giveLiveVaults', 'giveFirstRegistrationVaults', 'giveTierVaults', 'giveProfileVault', 'revokeReturnedPieceVaults', 'orderOfABoughtPiece', 'vaultState', 'drawRow', 'rewardPick', 'vaultGiftCode', 'hashVaultGiftCode']],
      ['server/services/live.ts', ['soldOutSizes']],
      ['server/services/order-addons.ts', ['attachVaultAddons']],
      ['server/services/guarantees.ts', ['grantFromVault']],
      ['server/services/parcels.ts', ['vaultCardOrders', 'checklistOf']],
      ['server/services/vault-orders.ts', ['assertSellable', 'assertSetSellable']],
    ];
    for (const [file, names] of named) {
      const code = source(file);
      for (const name of names) {
        expect(Q3, name).toContain(`\`${name}\``);
        expect(code, `${file} ${name}`).toMatch(new RegExp(`export (async )?function ${name}\\b`));
      }
    }
    const vault = source('server/services/vault.ts');
    for (const method of ['open', 'buy', 'giveFromHouse', 'expireClaims']) {
      expect(Q3, method).toContain(method === 'open' ? '`VaultService.open`' : `\`${method}\``);
      expect(vault, method).toMatch(new RegExp(`\\n  async ${method}\\(`));
    }
    expect(vault).toContain("import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';");
    expect(Q3).toContain('`crypto.randomInt` over 1 000 000 parts');
    for (const name of ['0061_the_vault', '0062_vault_rewards']) {
      expect(Q3).toContain(`\`${name}\``);
      expect(Object.keys(MIGRATIONS)).toContain(name);
    }
    for (const file of ['web/verify/views/vault-page.ts', 'web/verify/vault-model.ts', 'web/verify/vault/vault-box.ts', 'web/verify/vault/live-vault.ts', 'web/verify/vault/i-was-there.ts', 'web/admin/views/vault.ts', 'server/render/vault-card.ts', 'server/routes/admin/vault.ts']) {
      expect(existsSync(join(REPO, 'genome/src', file)), file).toBe(true);
    }
  });
});

describe('the other documents of THE VAULT (plan §7)', () => {
  const api = readDoc('docs/API.md');
  const collector = section(api, '### 10.32');
  const console = section(api, '### 16.50');

  it('API §10.32: every collector route as account.ts registers it, the opening’s limit, the register’s invite', () => {
    const routes = source('server/routes/account.ts');
    const paths: [string, string][] = [
      ['GET', '/api/v1/account/vaults'],
      ['GET', '/api/v1/account/vaults/summary'],
      ['GET', '/api/v1/account/vaults/live/:dropId'],
      ['POST', '/api/v1/account/vaults/:id/open'],
      ['POST', '/api/v1/account/vaults/invite'],
      ['GET', '/api/v1/account/vaults/gifts/:code'],
      ['POST', '/api/v1/account/vaults/gifts/:code/accept'],
      ['GET', '/api/v1/account/vaults/rights-to-buy'],
      ['POST', '/api/v1/account/vaults/:id/buy'],
      ['GET', '/api/v1/account/orders/:id/claim'],
      ['POST', '/api/v1/account/orders/:id/claim'],
    ];
    for (const [method, path] of paths) {
      expect(collector, path).toContain(`| ${method} | \`${path}\` |`);
      expect(api, path).toContain(`| ${method} | \`${path}\` | Account |`);
      expect(routes, path).toContain(`app.${method.toLowerCase()}('${path}'`);
    }
    expect(VAULT_OPEN_PER_MINUTE).toBe(10);
    expect(collector).toContain(`**At most ${VAULT_OPEN_PER_MINUTE} openings a minute per account**`);
    expect(collector).toContain('**a vault already opened answers its outcome again**');
    expect(collector).toContain('**No answer carries THE VAULT\'s table, its odds or its quantities**');
    // The gift's two routes share the `auth` budget, as the code says.
    expect(routes).toContain("app.get('/api/v1/account/vaults/gifts/:code', { config: { rateGroup: 'auth' } }");
    expect(routes).toContain("app.post('/api/v1/account/vaults/gifts/:code/accept', { config: { rateGroup: 'auth' } }");
    // The register's invite: in the body's schema, documented as never a refusal.
    expect(section(api, '### 10.1 ')).toContain('| `invite` | string \\| null | no |');
    expect(section(api, '### 10.1 ')).toContain('**an unknown or malformed code is ignored, never a refusal**');
    expect(source('server/http/schemas.ts')).toContain("invite: z.string().max(64, 'At most 64 characters').nullable().optional(),");
  });

  it('API §16.50: every console route as admin/vault.ts registers it, with its role, and no revoke route', () => {
    const routes = source('server/routes/admin/vault.ts');
    const paths: [string, string, string][] = [
      ['GET', '/api/admin/vault/settings', 'AUDITOR'],
      ['PUT', '/api/admin/vault/sources/:source', 'ADMIN'],
      ['POST', '/api/admin/vault/rewards', 'OPERATOR'],
      ['PUT', '/api/admin/vault/rewards/:id', 'OPERATOR'],
      ['POST', '/api/admin/vault/rewards/:id/deactivate', 'OPERATOR'],
      ['POST', '/api/admin/vault/rewards/order', 'OPERATOR'],
      ['POST', '/api/admin/vault/give', 'OPERATOR (a segment: ADMIN)'],
      ['GET', '/api/admin/vault/report', 'AUDITOR'],
      ['GET', '/api/admin/vault/report.csv', 'AUDITOR'],
      ['GET', '/api/admin/vault/vaults', 'AUDITOR'],
    ];
    for (const [method, path, role] of paths) {
      expect(api, path).toContain(`| ${method} | \`${path}\` | ${role} |`);
      expect(routes, path).toContain(`app.${method.toLowerCase()}('${path}'`);
    }
    expect(console).toContain('| GET | `/api/admin/vault/vaults?account=` | AUDITOR |');
    expect(source('server/routes/admin/live.ts')).toContain("app.put('/api/admin/live/:id/vault'");
    expect(source('server/routes/admin/catalog.ts')).toContain("app.put('/api/admin/models/:id/vault-only'");
    expect(api).toContain('| PUT | `/api/admin/live/:id/vault` | OPERATOR | yes | admin |');
    expect(api).toContain('| PUT | `/api/admin/models/:id/vault-only` | OPERATOR | yes | admin |');
    // N36: no revoke route anywhere, in the code or the contract.
    expect(routes).not.toMatch(/revoke'/);
    expect(console).toContain('**Read-only: no route takes a vault back** (N36)');
    expect(api).not.toMatch(/\| (POST|PUT|DELETE) \| `\/api\/admin\/vault\/vaults\/:id/);
  });

  it('API: the error codes in the code’s own words, and no VAULT_OPENED answered', () => {
    const words: [string, number, string, string][] = [
      ['VAULT_EXPIRED', 409, 'server/services/vault.ts', 'This vault was kept 30 days and can no longer be opened.'],
      ['VAULT_REVOKED', 409, 'server/services/vault.ts', 'This vault went back with its piece.'],
      ['VAULT_GIFT_ENDED', 409, 'server/services/vault.ts', 'This credit can no longer be accepted.'],
      ['VAULT_GIFT_NOT_FOR_YOU', 409, 'server/services/vault.ts', 'This credit is yours to give to a friend.'],
      ['VAULT_ODDS_OVER', 409, 'server/services/vault.ts', 'The odds of the active rewards add up to more than one in one. Lower one first.'],
      ['VAULT_REWARD_SERVICE', 409, 'server/services/vault.ts', 'A service cannot be a vault’s reward.'],
      ['VAULT_EDITION_MODEL', 409, 'server/services/vault.ts', 'A VAULT EDITION is a model marked vault-only. Mark the model first.'],
      ['VAULT_ONLY_PRODUCT', 409, 'server/services/vault.ts', 'A vault-only model is never sold: give it as a VAULT EDITION.'],
      ['VAULT_REWARD_GIVEN', 409, 'server/services/vault.ts', 'This reward was given: add another row.'],
      ['VAULT_FLOOR_FIXED', 409, 'server/services/vault.ts', 'I WAS THERE is the floor: it is always there, its odds the rest.'],
      ['VAULT_SOURCE_OFF', 409, 'server/services/vault.ts', 'THE HOUSE is switched off in CLUB > THE VAULT. Switch it on first.'],
      ['VAULT_SIZE_NONE_LEFT', 409, 'server/services/vault-orders.ts', 'None is left in that size. Your piece stays in its size.'],
      ['MODEL_VAULT_ONLY', 409, 'server/services/vault-orders.ts', 'This model is made only for the vault: it is never sold.'],
      ['ORDER_VAULT_UNCLAIMED', 409, 'server/services/orders.ts', 'A piece won in a vault keeps the unit held for its winner until it is claimed: its location, size and price do not change before.'],
      ['ORDER_VAULT_NO_UNIT', 409, 'server/services/orders.ts', 'A piece won in a vault never waits for stock: none is available there in its size.'],
      ['ORDER_VAULT_PRICE', 409, 'server/services/orders.ts', 'A piece won in a vault stays free, and one bought from a vault keeps its price.'],
    ];
    for (const [code, status, file, sentence] of words) {
      expect(api, code).toMatch(new RegExp(`^\\| \`${code}\` \\| ${status} \\|`, 'm'));
      expect(api, code).toContain(sentence);
      expect(source(file), code).toContain(sentence);
    }
    expect(source('server/services/vault-orders.ts')).toContain("conflict('VAULT_OFFER_ENDED', words)");
    expect(source('server/services/vault.ts')).toContain("export const VAULT_BUY_ENDED = 'The 24 hours to buy it are over.';");
    expect(source('server/services/vault.ts')).toContain("export const VAULT_CLAIM_ENDED = 'The 30 days to claim it are over.';");
    for (const sentence of ['The 24 hours to buy it are over.', 'The 30 days to claim it are over.']) expect(collector).toContain(sentence);
    for (const code of ['VAULT_NOT_FOUND', 'VAULT_GIFT_NOT_FOUND', 'VAULT_SOURCE_NOT_FOUND', 'VAULT_REWARD_NOT_FOUND']) expect(api, code).toMatch(new RegExp(`^\\| \`${code}\` \\| 404 \\|`, 'm'));
    // Plan §2.9 named VAULT_OPENED; §2.9 itself makes an opened vault answer its outcome: no code throws it.
    expect(source('server/services/vault.ts')).not.toContain("'VAULT_OPENED'");
    expect(collector).toContain('No route answers `VAULT_OPENED`');
  });

  it('DATABASE: 0061 and 0062, the six tables within the code’s bounds, the outcome written once, the down steps', () => {
    const db = readDoc('docs/DATABASE.md');
    expect(db).toMatch(/The application now runs on `0001` to `00\d\d`/);
    expect(db).toContain('`0061_the_vault` (lot Q3, THE VAULT:');
    expect(db).toContain('`0062_vault_rewards` (lot Q3: the links into what delivers a reward');
    expect(db).toContain('the paused lot M4 renumbers its own after `0062`');
    for (const [n, table] of [['5.141', 'vault_sources'], ['5.142', 'vault_rewards'], ['5.143', 'vaults'], ['5.144', 'vault_occasions_before'], ['5.145', 'invitations'], ['5.146', 'vault_gifts']]) {
      expect(db, table).toContain(`### ${n} \`${table}\``);
    }
    const sources = section(db, '### 5.141');
    expect(sources).toContain(`\`${VAULT_SOURCES.join('`, `')}\``);
    expect(sources).toContain(`${VAULT_PER_OCCASION.min}–${VAULT_PER_OCCASION.max}, \`VAULT_PER_OCCASION\``);
    expect(sources).toContain(`${VAULT_CAP.min}–${VAULT_CAP.max}, \`VAULT_CAP\``);
    const rewards = section(db, '### 5.142');
    expect(rewards).toContain(`\`${VAULT_REWARD_KINDS.join('`, `')}\` (\`VAULT_REWARD_KINDS\`)`);
    expect(VAULT_ODDS_IN_MAX).toBe(1_000_000);
    expect(rewards).toContain('`vault_rewards_odds_in_check` 1–1 000 000 (`VAULT_ODDS_IN_MAX`)');
    expect(rewards).toContain('`vault_rewards_addon_product`');
    const vaults = section(db, '### 5.143');
    expect(vaults).toContain(`\`waits_until = given_at + interval '${VAULT_WAIT_DAYS * 24} hours'\``);
    expect(vaults).toContain(`1–1 000 (\`VAULT_OCCASION_INDEX_MAX\`, ${VAULT_PER_OCCASION.max} per occasion × a cap of ${VAULT_CAP.max})`);
    expect(VAULT_OCCASION_INDEX_MAX).toBe(1000);
    expect(vaults).toContain(`1–${VAULT_NOTE_MAX} characters`);
    expect(vaults).toContain('*a vault\'s outcome is written once, at its opening*');
    expect(vaults).toContain('*a vault is revoked, never deleted*');
    expect(INVITATION_CODE_PATTERN.source).toBe('^[0-9A-HJKMNP-TV-Z]{12}$');
    expect(section(db, '### 5.145')).toContain('12 characters of Crockford\'s base32, `INVITATION_CODE_PATTERN`');
    expect(section(db, '### 5.146')).toContain('**the code itself never stored**');
    // The words the doc quotes are the migrations' own.
    const m61 = source('server/db/migrations/0061_the_vault.ts');
    const m62 = source('server/db/migrations/0062_vault_rewards.ts');
    for (const words of ["a vault''s outcome is written once, at its opening", 'a vault is revoked, never deleted', 'an invitation link is made once', "an account''s inviter is set once", 'a vault source is switched off, never deleted']) {
      expect(m61, words).toContain(words);
      expect(db, words).toContain(words.replace("''", "'"));
    }
    expect(m62).toContain("RAISE EXCEPTION 'a vault''s offer is used once'");
    expect(db).toContain('`0062` refuses, naming the counts, while a VAULT credit, a VAULT order, a LIVE guarantee, a VAULT unit, a credit to give or a vault\'s offer exists');
    expect(db).toContain('`0061` refuses, naming the counts, while a vault, an invitation, an invited account, a vault message, a reward other than the floor');
    expect(db).toContain('| Vaults | Lot Q3 (`vaults`, `VaultService.expireClaims`');
  });

  it('SECURITY-MODEL and THREAT-MODEL: the server’s draw, the idempotent opening, the codes, the caps, the farming', () => {
    const sentinel = 'test/security/collector-never-sees-staff-data.test.ts';
    const security = readDoc('docs/SECURITY-MODEL.md');
    expect(security).toContain('**THE VAULT: the draw the server\'s, each vault given once, nothing of the table sent**');
    expect(security).toContain('**an opened vault answers its outcome again**');
    expect(security).toContain('**a test entrant never gets one**');
    expect(security).toContain('**no route takes a vault back** (N36)');
    expect(security).toContain(`The sentinel \`${sentinel}\` gives the collector house vaults`);
    const threat = readDoc('docs/THREAT-MODEL.md');
    expect(threat).toContain('| THE VAULT (lot Q3) |');
    expect(threat).toContain('| **AP. THE VAULT farmed, its draw steered or replayed, or a credit to give stolen**');
    expect(threat).toContain(`The sentinel \`${sentinel}\` finds no house note, no giver and no row of the table`);
    // The sentinel still reads THE VAULT's replies.
    const test = readDoc(join('genome', sentinel));
    for (const path of ["'/api/v1/account/vaults'", "'/api/v1/account/vaults/summary'", "'/api/v1/account/vaults/rights-to-buy'", "'POST /api/v1/account/vaults/:id/open'"]) expect(test, path).toContain(path);
  });

  it('BRAND lot Q3: the five sounds and their cues, the gesture and the opening as the code has them', () => {
    const brand = section(readDoc('docs/BRAND-DESIGN-SYSTEM.md'), '### Lot Q3');
    for (const name of VAULT_SOUNDS) expect(brand, name).toContain(`| \`${name}.mp3\` |`);
    expect(SFX_AT.vault).toEqual([['vault-unlock', 0], ['vault-halves', 0.1], ['vault-lid', 2], ['vault-reveal', 3.4]]);
    expect(SFX_AT.vaultRare.map(([n]) => n)).toEqual(['vault-unlock', 'vault-halves', 'vault-lid', 'vault-rare']);
    expect(brand).toContain('| `vault-reveal.mp3` | 3.4 s, the warm tone at the prize (take 3) |');
    expect(brand).toContain('| `vault-rare.mp3` | 3.4 s × 1.4');
    expect([HOLD_MS, RESET_MS, DRAW_PX, OPENING_MS, RARE_K]).toEqual([1500, 380, 110, 6550, 1.4]);
    expect([...VIBRATION]).toEqual([16, 40, 26]);
    expect([FLOAT_AX, FLOAT_AY, HELD_SHARE, HELD_MS, CALM_SHARE]).toEqual([11, 14, 0.4, 250, 0.3]);
    for (const said of ['**press and hold** (1.5 s, `HOLD_MS`)', '**draw it down** (110 px, `DRAW_PX`)', 'settles it back in 380 ms (`RESET_MS`)', '6.55 s (`OPENING_MS`)', '**× 1.4 for a rare reward** (`RARE_K`', 'up to 11° × 14° (`FLOAT_AX`, `FLOAT_AY`)', 'the vibration `[16, 40, 26]`', 'a slow float at 30 % (`CALM_SHARE`)']) {
      expect(brand, said).toContain(said);
    }
    expect(brand).toContain('**every vault screen stays dark in light mode**');
    expect(brand).toContain('from 1.8 s over 1.25 s to 16 %');
    expect(source('web/verify/house.css')).toContain('animation: vlt-pagedim 1.25s cubic-bezier(0.16, 1, 0.3, 1) 1.8s backwards;');
  });

  it('the matrix, the playbook and COMPLIANCE: the vault states, THE VAULT CARD at packing, the Q3 deployment', () => {
    const matrix = readDoc('docs/launch/NOCTURNE-MATRIX.md');
    const vaultStates = PHONE_STATES.filter((s) => s.variant === 'vault').map((s) => s.id);
    expect(vaultStates).toHaveLength(20);
    for (const id of vaultStates) expect(matrix, id).toMatch(new RegExp(`^\\| \`${id}\` \\|`, 'm'));
    for (const shard of ['desk-16', 'desk-17']) expect(matrix, shard).toContain(`| \`${shard}\` | ${DESK_GROUPS[shard]!.length} |`);
    const desk = Object.values(DESK_GROUPS).flat().length;
    expect(matrix).toContain(`${desk} states beside the phone's ${PHONE_STATES.length} (since lot Q3)`);
    // Both copies of the playbook, identical, with THE VAULT CARD's line as the checklist writes it.
    const playbook = readDoc('docs/launch/SALES-PLAYBOOK.md');
    expect(readDoc('genome/src/server/documents/SALES-PLAYBOOK.md')).toBe(playbook);
    expect(VAULT_CARD_LINE).toBe('THE VAULT CARD');
    expect(playbook).toContain('### THE VAULT CARD dans le colis');
    expect(playbook).toContain(`la liste d'emballage porte la ligne \`${VAULT_CARD_LINE}\``);
    expect(playbook).toContain('### THE VAULT : les coffres des collectionneurs');
    for (const answer of ['**« Je n\'ai pas reçu de coffre. »**', '**« Ma pièce est repartie. »**', '**La pièce offerte.**', '**Le crédit à offrir.**', '**GIVE A VAULT, le geste de la maison.**']) expect(playbook, answer).toContain(answer);
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 13.');
    expect(compliance).toContain('**Le déploiement THE VAULT**');
    expect(compliance).toContain('`0061_the_vault` et `0062_vault_rewards`');
    expect(compliance).toContain('**Les règles du tirage promotionnel sont dans les conditions**');
    expect(compliance).toContain('`2026-10-26`');
    expect(compliance).toContain('(launch/DEPLOY-OQ-Q3.md)');
  });
});
