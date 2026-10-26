/**
 * CLUB > THE VAULT in the console (lot Q3, step Q3.12; plan §4), as pure functions: the table's words and odds (each
 * row's "1 IN N", the floor's published odds, the sum, a save above one in one refused in the server's words), the
 * pickers (a model sold for a product, a vault-only model for a VAULT EDITION, add-ons of kind PRODUCT only: never a
 * SERVICE, E7), the forms, the sources' caps in their own words with OP-29's defaults, GIVE A VAULT's reach, the report's
 * lines, the client sheet's block (GIVE A VAULT, no REVOKE: N36), the LIVE release's switch, VAULT ONLY, the Orders
 * board's Vault, the ENGRAVING's amendment of 25 Oct; the API paths; and, at compile time, that the console reads
 * exactly what the server sends.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { VAULT_SOURCES as SERVER_SOURCES_T } from '../../src/server/db/schema.js';
import { VAULT_REWARD_KINDS as SERVER_KINDS, VAULT_REWARD_MODES as SERVER_MODES, VAULT_SOURCES as SERVER_SOURCES } from '../../src/server/db/schema.js';
import {
  floorOddsIn as serverFloorOddsIn,
  rewardParts as serverRewardParts,
  VAULT_DRAW_PARTS as SERVER_PARTS,
  vaultOddsOver,
  vaultRewardService,
  type AdminVault as ServerAdminVault,
  type HouseGiven as ServerHouseGiven,
  type VaultReport as ServerVaultReport,
  type VaultSettings as ServerVaultSettings,
} from '../../src/server/services/vault.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatCount } from '../../src/web/admin/format.js';
import { ENGRAVING_ADMIN_ONLY, addonFormValues, engravingAdminProblem } from '../../src/web/admin/model/addons.js';
import { CHANNEL_LABELS, orderOrigin } from '../../src/web/admin/model/orders.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import {
  capText,
  clientVaultsNote,
  costText,
  floorOddsIn,
  givenText,
  giveInput,
  giveProblem,
  giveToOptions,
  LIVE_VAULT,
  liveVaultReportFigures,
  liveVaultSwitchable,
  moneyList,
  movedOrder,
  NEW_REWARD_KINDS,
  oddsSumLine,
  oddsText,
  partsShare,
  reachLines,
  reportPeriod,
  reportPeriodProblem,
  reportSummary,
  rewardAddonOptions,
  rewardFormValues,
  rewardInput,
  rewardModelOptions,
  rewardOddsLine,
  rewardParts,
  rewardProblem,
  rewardUnchanged,
  rewardWhat,
  rowOddsText,
  sourceDefaultText,
  sourceInput,
  sourceIsDefault,
  sourceProblem,
  VAULT_COPY,
  VAULT_DRAW_PARTS,
  VAULT_KIND_LABELS,
  VAULT_ONLY,
  VAULT_SOURCE_DEFAULTS,
  VAULT_STATE_LABELS,
  vaultHeldText,
  vaultSourceText,
  vaultStateNote,
} from '../../src/web/admin/model/vault.js';
import type * as web from '../../src/web/admin/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nb = (s: string) => s.replace(/ /g, ' ');

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
// Compile-time: the console reads what the server sends (routes/admin/vault.ts).
export const settingsFit = (s: Json<ServerVaultSettings>): web.VaultSettings => s;
export const reportFit = (r: Json<ServerVaultReport>): web.VaultReport => r;
export const vaultFit = (v: Json<ServerAdminVault>): web.AdminVault => v;
export const givenFit = (g: Json<ServerHouseGiven>): web.VaultGiven => g;
export const sourcesFit = (s: (typeof SERVER_SOURCES_T)[number]): web.VaultSource => s;

function row(over: Partial<web.VaultRewardSetting> = {}): web.VaultRewardSetting {
  return {
    id: 'r1',
    kind: 'CREDIT',
    oddsIn: 10,
    oddsText: '1 IN 10',
    parts: 100_000,
    quantity: 100,
    given: 0,
    left: 100,
    amountMinor: 2_500,
    currency: 'EUR',
    modelId: null,
    modelName: null,
    addonId: null,
    addonName: null,
    mode: null,
    line: null,
    active: true,
    position: 1,
    rare: false,
    ...over,
  };
}

const FLOOR = row({ id: 'floor', kind: 'I_WAS_THERE', oddsIn: null, oddsText: null, parts: 900_000, quantity: null, left: null, amountMinor: null, currency: null, position: 0 });

function settings(rewards: web.VaultRewardSetting[] = [FLOOR, row()]): web.VaultSettings {
  const given = rewards.filter((r) => r.kind !== 'I_WAS_THERE').reduce((n, r) => n + (r.active ? r.parts : 0), 0);
  const floor = Math.max(0, VAULT_DRAW_PARTS - given);
  return { sources: [], rewards, partsGiven: given, floor: { id: 'floor', parts: floor, oddsIn: floorOddsIn(floor), oddsText: null } };
}

function addon(over: Partial<web.AddonView>): web.AddonView {
  return {
    id: 'a1',
    kind: 'PRODUCT',
    name: 'POLISHING CLOTH',
    line: null,
    supplier: null,
    weightG: null,
    position: 1,
    active: true,
    sku: { id: 's', code: 'ADD-CLOTH', shopifyVariantId: null },
    shopifyProductId: null,
    prices: [],
    stock: [],
    offeredAt: { live: true, draw: true, salon: true, orders: true },
    engraving: false,
    textMax: 20,
    releases: 0,
    convertedFrom: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

const model = (over: Partial<web.Model>) => ({ id: 'm1', name: 'MONOLITHE', type: 'RING', variantLabel: null, active: true, vaultOnly: false, ...over }) as web.Model;

describe('CLUB > THE VAULT: the table', () => {
  it('is the Club page\'s fifth tab; its words and kinds are the server\'s; New reward never adds the floor', () => {
    expect([...SERVER_SOURCES]).toEqual(['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE']);
    expect(Object.keys(VAULT_KIND_LABELS).sort()).toEqual([...SERVER_KINDS].sort());
    expect([...SERVER_MODES]).toEqual([...(['FREE', 'RIGHT_TO_BUY'] as const)]);
    expect(NEW_REWARD_KINDS).not.toContain('I_WAS_THERE');
    expect(new Set(NEW_REWARD_KINDS).size).toBe(SERVER_KINDS.length - 1);
    const club = readFileSync(join(ROOT, 'src/web/admin/model/club.ts'), 'utf8');
    expect(club).toContain("{ id: 'vault', label: 'THE VAULT' }");
  });

  it('counts the odds as the server does: each row its parts, the floor the rest, published as 1 IN N; the sum under the table', () => {
    expect(VAULT_DRAW_PARTS).toBe(SERVER_PARTS);
    for (const n of [1, 3, 7, 10, 200, 2_000, 999_999]) expect(rewardParts(n), String(n)).toBe(serverRewardParts(n));
    for (const p of [0, 1, 333_333, 804_500, 1_000_000]) expect(floorOddsIn(p), String(p)).toBe(serverFloorOddsIn(p));
    expect(oddsText(200)).toBe('1 IN 200');
    expect(oddsText(2_000)).toBe(`1 IN ${formatCount(2_000)}`);
    expect(partsShare(195_500)).toBe('19.55 %');
    const s = settings([FLOOR, row(), row({ id: 'r2', kind: 'GUARANTEED', oddsIn: 200, parts: 5_000, amountMinor: null, currency: null })]);
    expect(oddsSumLine(s)).toBe('The rewards hold 10.50 % of the draw. I WAS THERE holds the rest, published as 1 IN 1 (89.50 %).');
    expect(rowOddsText(FLOOR, s.floor)).toBe('1 IN 1');
    expect(rowOddsText(s.rewards[2]!, s.floor)).toBe('1 IN 200');
    expect(oddsSumLine({ partsGiven: 1_000_000, floor: { id: 'f', parts: 0, oddsIn: null, oddsText: null } })).toBe('The rewards hold 100.00 % of the draw. I WAS THERE holds the rest, published as none: the table holds the whole draw.');
  });

  it('says what each row is, a product its mode', () => {
    expect(nb(rewardWhat(row()))).toBe('€ 25 of house credit, 30 days');
    expect(nb(rewardWhat(row({ kind: 'CREDIT_TO_GIVE', amountMinor: 3_000 })))).toBe('€ 30 to give, for a friend’s first piece');
    expect(rewardWhat(row({ kind: 'ADDON', addonName: 'THE TRAVEL CASE', amountMinor: null, currency: null }))).toBe('THE TRAVEL CASE · free on the next order');
    expect(rewardWhat(row({ kind: 'PRODUCT', modelName: 'MONOLITHE IN BLUE', mode: 'FREE' }))).toBe('MONOLITHE IN BLUE · FREE');
    expect(rewardWhat(row({ kind: 'PRODUCT', addonName: 'THE TRAVEL CASE', mode: 'RIGHT_TO_BUY' }))).toBe('THE TRAVEL CASE · RIGHT TO BUY');
    expect(rewardWhat(row({ kind: 'VAULT_EDITION', modelName: 'ECLIPSE', line: 'Made only for the vault.' }))).toBe('ECLIPSE · Made only for the vault.');
    expect(rewardWhat(row({ kind: 'GUARANTEED' }))).toBe('A piece at the next LIVE release');
    expect(rewardWhat(row({ kind: 'THE_PIECE' }))).toBe('The missed model, the collector’s size');
    expect(rewardWhat(FLOOR)).toBe('The card: the release, or the occasion, and its date');
  });

  it('refuses a save that would make the sum above one in one, in the server\'s words; an edit counts its own row once', () => {
    expect(VAULT_COPY.oddsOver).toBe(vaultOddsOver().message);
    const s = settings();
    expect(rewardOddsLine(s, { kind: 'GUARANTEED', oddsIn: '200' }, null)).toBe('With it, the rewards hold 10.50 % of the draw; I WAS THERE 1 IN 1.');
    expect(rewardOddsLine(s, { kind: 'GUARANTEED', oddsIn: '1' }, null)).toBe(VAULT_COPY.oddsOver);
    expect(rewardProblem(s, { kind: 'GUARANTEED', oddsIn: '1', quantity: '1' }, null)).toBe(VAULT_COPY.oddsOver);
    expect(rewardProblem(s, { kind: 'GUARANTEED', oddsIn: '2', quantity: '1' }, null)).toBeNull();
    // The credit itself raised to 1 IN 1: its own 10 % replaced, not added.
    const credit = s.rewards[1]!;
    expect(rewardProblem(s, { ...rewardFormValues(credit), oddsIn: '1' }, credit)).toBeNull();
    // Inactive, it holds nothing; made active again, its parts count.
    const off = settings([FLOOR, row({ active: false }), row({ id: 'r2', oddsIn: 1, parts: 1_000_000 })]);
    expect(rewardProblem(off, { ...rewardFormValues(off.rewards[1]!), active: 'true' }, off.rewards[1]!)).toBe(VAULT_COPY.oddsOver);
    expect(rewardProblem(off, { ...rewardFormValues(off.rewards[1]!), active: '' }, off.rewards[1]!)).toBeNull();
  });

  it('checks a row\'s own fields: the amount, the model or add-on, a quantity never below what was given', () => {
    const s = settings([FLOOR]);
    expect(rewardProblem(s, { kind: 'CREDIT', amount: '', currency: 'EUR', oddsIn: '10', quantity: '1' }, null)).toBe('The amount: in units, 25 or 25.50.');
    expect(rewardProblem(s, { kind: 'CREDIT', amount: '25', currency: 'EUR', oddsIn: '10', quantity: '1' }, null)).toBeNull();
    expect(rewardProblem(s, { kind: 'PRODUCT', productOf: 'MODEL', modelId: '', mode: 'FREE', oddsIn: '10', quantity: '1' }, null)).toBe('Choose the model.');
    expect(rewardProblem(s, { kind: 'VAULT_EDITION', modelId: '', line: '', oddsIn: '10', quantity: '1' }, null)).toBe('Choose the vault-only model.');
    expect(rewardProblem(s, { kind: 'ADDON', addonId: '', oddsIn: '10', quantity: '1' }, null)).toBe('Choose the add-on.');
    expect(rewardProblem(s, { kind: 'GUARANTEED', oddsIn: '0', quantity: '1' }, null)).toMatch(/^The odds: 1 IN a whole number/);
    expect(rewardProblem(s, { kind: 'I_WAS_THERE', oddsIn: '2', quantity: '1' }, null)).toBe('Choose what the reward is.');
    const given = row({ given: 7 });
    expect(rewardProblem(settings([FLOOR, given]), { ...rewardFormValues(given), quantity: '6' }, given)).toBe('The quantity is at least what was given: 7.');
    expect(rewardUnchanged(given, rewardFormValues(given))).toBe(true);
    expect(rewardUnchanged(given, { ...rewardFormValues(given), oddsIn: '11' })).toBe(false);
  });

  it('offers add-ons of kind PRODUCT only: a SERVICE is never in the picker, one sent anyway refused in the server\'s words', () => {
    const list = [addon({ id: 'cloth' }), addon({ id: 'wrap', kind: 'SERVICE', name: 'GIFT WRAPPING' }), addon({ id: 'engr', kind: 'SERVICE', name: 'ENGRAVING', engraving: true }), addon({ id: 'old', name: 'OLD POUCH', active: false })];
    expect(rewardAddonOptions(list).map((o) => o.value)).toEqual(['', 'cloth']);
    // An inactive add-on a row already names stays readable in its Edit.
    expect(rewardAddonOptions(list, 'old').map((o) => o.value)).toEqual(['', 'cloth', 'old']);
    expect(VAULT_COPY.service).toBe(vaultRewardService().message);
    for (const kind of ['ADDON', 'PRODUCT']) {
      expect(rewardProblem(settings([FLOOR]), { kind, productOf: 'ADDON', addonId: 'wrap', mode: 'FREE', oddsIn: '10', quantity: '1' }, null, list), kind).toBe(VAULT_COPY.service);
    }
  });

  it('offers a product the models sold, never a vault-only one; a VAULT EDITION the vault-only ones only', () => {
    const models = [model({ id: 'sold' }), model({ id: 'secret', name: 'ECLIPSE', vaultOnly: true }), model({ id: 'off', active: false })];
    expect(rewardModelOptions(models, 'PRODUCT').map((o) => o.value)).toEqual(['', 'sold']);
    expect(rewardModelOptions(models, 'VAULT_EDITION').map((o) => o.value)).toEqual(['', 'secret']);
  });

  it('sends each kind its own fields, whole', () => {
    expect(rewardInput({ kind: 'CREDIT', amount: '25.50', currency: 'GBP', oddsIn: '10', quantity: '100', modelId: 'x' }, { withKind: true })).toEqual({ kind: 'CREDIT', oddsIn: 10, quantity: 100, amountMinor: 2_550, currency: 'GBP' });
    expect(rewardInput({ kind: 'PRODUCT', productOf: 'ADDON', addonId: 'a', modelId: 'm', mode: 'RIGHT_TO_BUY', oddsIn: '25', quantity: '40' }, { withKind: true })).toEqual({ kind: 'PRODUCT', oddsIn: 25, quantity: 40, addonId: 'a', mode: 'RIGHT_TO_BUY' });
    expect(rewardInput({ kind: 'VAULT_EDITION', modelId: 'm', line: '  Made   only for it. ', oddsIn: '500', quantity: '3', active: 'true' }, { withKind: false })).toEqual({ oddsIn: 500, quantity: 3, modelId: 'm', line: 'Made only for it.', active: true });
    expect(rewardInput({ kind: 'GUARANTEED', oddsIn: '200', quantity: '10', active: '' }, { withKind: false })).toEqual({ oddsIn: 200, quantity: 10, active: false });
  });

  it('moves a row up or down, every row named once', () => {
    const rows = [FLOOR, row(), row({ id: 'r2' })];
    expect(movedOrder(rows, 'r1', -1)).toEqual(['r1', 'floor', 'r2']);
    expect(movedOrder(rows, 'r2', 1)).toBeNull();
    expect(movedOrder(rows, 'floor', -1)).toBeNull();
  });
});

describe('CLUB > THE VAULT: the sources, GIVE A VAULT, the report', () => {
  const src = (over: Partial<web.VaultSourceSetting>): web.VaultSourceSetting => ({ source: 'LIVE', enabled: true, perOccasion: 1, cap: 1, updatedAt: '2026-10-25T10:00:00.000Z', updatedBy: null, ...over });

  it('says each cap in its own words, OP-29\'s defaults beside (D27)', () => {
    expect(capText('LIVE', 1)).toBe('At most 1 per release');
    expect(capText('PIECE', 3)).toBe('At most 3 per piece');
    expect(capText('TIER', 1)).toBe('At most 1 per tier');
    expect(capText('FRIEND', 2)).toBe('At most 2 per friend');
    expect(capText('PROFILE', 1)).toBe('At most 1 ever');
    expect(capText('HOUSE', null)).toBe('None: each gift is its own');
    expect(sourceDefaultText('WORN')).toBe('Default: on · 1 vault · at most 1 per piece');
    expect(sourceDefaultText('HOUSE')).toBe('Default: on · 1 vault · no cap');
    expect(Object.values(VAULT_SOURCE_DEFAULTS).every((d) => d.enabled && d.perOccasion === 1)).toBe(true);
    expect(sourceIsDefault(src({}))).toBe(true);
    expect(sourceIsDefault(src({ cap: 2 }))).toBe(false);
    expect(sourceProblem('LIVE', { perOccasion: '11', cap: '1' })).toBe('Vaults per occasion: a whole number from 1 to 10.');
    expect(sourceProblem('LIVE', { perOccasion: '1', cap: '101' })).toBe('The cap: a whole number from 1 to 100.');
    expect(sourceProblem('HOUSE', { perOccasion: '2', cap: '' })).toBeNull();
    expect(sourceInput('HOUSE', { enabled: 'true', perOccasion: '2', cap: '5' })).toEqual({ enabled: true, perOccasion: 2, cap: null });
    expect(sourceInput('PIECE', { enabled: '', perOccasion: '1', cap: '3' })).toEqual({ enabled: false, perOccasion: 1, cap: 3 });
  });

  it('GIVE A VAULT: a segment only for an ADMIN; the reach first, the left out counted apart (N25)', () => {
    expect(giveToOptions(false).map((o) => o.value)).toEqual(['COLLECTOR']);
    expect(giveToOptions(true).map((o) => o.value)).toEqual(['COLLECTOR', 'SEGMENT']);
    expect(giveProblem({ to: 'COLLECTOR', email: 'nobody' })).toBe('The collector’s email.');
    expect(giveProblem({ to: 'SEGMENT', segmentId: '' })).toBe('Choose the segment.');
    expect(giveInput({ to: 'COLLECTOR', email: ' c@example.com ', note: ' Called. ' }, { dryRun: true })).toEqual({ email: 'c@example.com', note: 'Called.', dryRun: true });
    expect(giveInput({ to: 'SEGMENT', segmentId: 's1', note: '' }, { dryRun: false, giftId: 'g1' })).toEqual({ segmentId: 's1', dryRun: false, giftId: 'g1' });
    expect(giveInput({ note: '' }, { accountId: 'acc', dryRun: true })).toEqual({ accountId: 'acc', dryRun: true });
    const reach: web.VaultGiven = { giftId: null, dryRun: true, reach: 12, accounts: 0, vaults: 0, leftOut: { testEntrants: 2, inactive: 1 } };
    expect(reachLines(reach, 1)).toEqual(['Reaches 12 collectors: 1 vault each.', 'Left out: 2 test entrants, 1 inactive account.']);
    expect(reachLines({ ...reach, reach: 0, leftOut: { testEntrants: 0, inactive: 0 } }, 2)).toEqual(['Reaches nobody: nothing would be given.', 'Nobody left out.']);
    expect(givenText({ ...reach, dryRun: false, accounts: 12, vaults: 12 })).toBe('12 vaults given to 12 collectors.');
    expect(can('OPERATOR', 'giveVault')).toBe(true);
    expect(can('OPERATOR', 'giveVaultToSegment')).toBe(false);
    expect(can('ADMIN', 'giveVaultToSegment')).toBe(true);
    expect([CAPABILITY_MIN_ROLE.manageVaultTable, CAPABILITY_MIN_ROLE.manageVaultSources, CAPABILITY_MIN_ROLE.editEngravingPrices]).toEqual(['OPERATOR', 'ADMIN', 'ADMIN']);
  });

  it('the report: its summary, money per currency, the cost with what is unknown, the period both days or neither', () => {
    const r = { givenTotal: 12, opened: 8, waiting: 3, expired: 1, revoked: 0 } as web.VaultReport;
    expect(reportSummary(r)).toBe('12 given · 8 opened · 3 waiting · 1 expired · 0 returned');
    expect(nb(moneyList([{ currency: 'EUR', minor: 2_500 }, { currency: 'GBP', minor: 1_000 }]))).toBe('€ 25 · £ 10');
    expect(moneyList([])).toBe('—');
    expect(nb(costText({ cost: [{ currency: 'EUR', minor: 4_000 }], costUnknown: 2 }))).toBe('€ 40 · 2 unknown');
    expect(costText({ cost: [], costUnknown: 1 })).toBe('1 unknown');
    expect(costText({ cost: [], costUnknown: 0 })).toBe('—');
    expect(reportPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(reportPeriod({ from: '2026-10-31', to: '2026-10-01' })).toEqual({});
    expect(reportPeriod({ from: '2026-10-01' })).toEqual({});
    expect(reportPeriodProblem('2026-10-02', '2026-10-01')).toBe(VAULT_COPY.periodProblem);
    expect(reportPeriodProblem('', '')).toBeNull();
  });
});

describe('the client sheet, the LIVE release, the catalogue, the orders, the engraving', () => {
  const v = (over: Partial<web.AdminVault>): web.AdminVault => ({
    id: 'v1',
    source: 'LIVE',
    label: 'YOUR SIZE SOLD OUT',
    detail: 'MONOLITHE IN BLUE',
    line: 'YOUR SIZE SOLD OUT · MONOLITHE IN BLUE',
    givenAt: '2026-10-20T10:00:00.000Z',
    waitsUntil: '2026-11-19T10:00:00.000Z',
    state: 'WAITING',
    openedAt: null,
    revokedAt: null,
    revokedReason: null,
    kind: null,
    held: null,
    odds: null,
    rare: null,
    orderId: null,
    givenBy: null,
    note: null,
    ...over,
  });

  it('reads a client\'s vaults: the source, the state (a returned piece\'s RETURNED), what it held with its odds', () => {
    expect(vaultSourceText(v({}))).toBe('LIVE release · MONOLITHE IN BLUE');
    expect(vaultSourceText(v({ source: 'HOUSE', detail: null }))).toBe('THE HOUSE');
    expect(VAULT_STATE_LABELS.REVOKED).toBe('RETURNED');
    expect(vaultStateNote(v({}))).toBe('Until 19 NOV 2026');
    expect(vaultStateNote(v({ state: 'OPENED', openedAt: '2026-10-21T22:30:00.000Z' }))).toBe('Opened 22 OCT 2026');
    expect(vaultHeldText(v({ held: '€25 · HOUSE CREDIT', odds: '1 IN 10' }))).toBe('€25 · HOUSE CREDIT · 1 IN 10');
    expect(vaultHeldText(v({}))).toBe('—');
    expect(clientVaultsNote([v({}), v({ state: 'OPENED' })])).toBe('1 waiting · 2 given');
  });

  it('the client sheet\'s THE VAULT block offers GIVE A VAULT and no REVOKE (N36): no revoke anywhere in the console\'s vault', () => {
    const owner = readFileSync(join(ROOT, 'src/web/admin/views/owner.ts'), 'utf8');
    const block = owner.slice(owner.indexOf('function vaultsPanel('), owner.indexOf('/** N4: the collector\'s orders'));
    expect(block).toContain("testId: 'client-vault-give'");
    expect(block).toContain('giveVaultDialog(ctx, { accountId: o.id');
    expect(block).not.toMatch(/revoke/i);
    expect(readFileSync(join(ROOT, 'src/web/admin/views/vault.ts'), 'utf8')).not.toMatch(/revokeVault|vault-revoke/i);
    expect(Object.getOwnPropertyNames(AdminApi.prototype).filter((n) => /vault/i.test(n) && /revoke/i.test(n))).toEqual([]);
    expect(Object.keys(CAPABILITY_MIN_ROLE).filter((k) => /vault/i.test(k) && /revoke/i.test(k))).toEqual([]);
  });

  it('the LIVE release\'s switch: an OPERATOR\'s until the end, never an after-room\'s; the report\'s figures say no number in a label', () => {
    expect(liveVaultSwitchable({ phase: 'DRAFT', afterRoomOf: null }, true)).toBe(true);
    expect(liveVaultSwitchable({ phase: 'LIVE', afterRoomOf: null }, true)).toBe(true);
    expect(liveVaultSwitchable({ phase: 'ENDED', afterRoomOf: null }, true)).toBe(false);
    expect(liveVaultSwitchable({ phase: 'CANCELLED', afterRoomOf: null }, true)).toBe(false);
    expect(liveVaultSwitchable({ phase: 'LIVE', afterRoomOf: { id: 'x' } }, true)).toBe(false);
    expect(liveVaultSwitchable({ phase: 'LIVE', afterRoomOf: null }, false)).toBe(false);
    expect([LIVE_VAULT.on, LIVE_VAULT.off]).toEqual(['On', 'Off']);
    const figs = liveVaultReportFigures({ on: true, given: 12, opened: 5 });
    expect(figs.map((f) => [f[0], f[1], f[2]])).toEqual([
      ['Vaults given', '12', 'SIZES SOLD OUT, THE LINE STILL WAITING'],
      ['Vaults opened', '5', 'OF 12 GIVEN'],
    ]);
    for (const f of figs) expect(f[0]).not.toMatch(/[0-9]/);
  });

  it('the Orders board reads a VAULT order\'s channel Vault and FROM THE VAULT; VAULT ONLY\'s words', () => {
    expect(CHANNEL_LABELS.VAULT).toBe('Vault');
    expect(orderOrigin({ channel: 'VAULT', release: null })).toBe('FROM THE VAULT');
    expect(orderOrigin({ channel: 'LIVE', release: { title: 'THE MONOLITHE RING' } })).toBe('THE MONOLITHE RING');
    expect(orderOrigin({ channel: 'SALON', release: null })).toBe('PRIVATE SALON');
    expect(VAULT_ONLY.label).toBe('VAULT ONLY');
    expect(VAULT_ONLY.hint).toContain('The lookbook still shows it.');
  });

  it('the ENGRAVING\'s prices and YOUR ORDERS switch are an ADMIN\'s (the amendment of 25 Oct); an OPERATOR keeps every other field', () => {
    const engraving = addon({ id: 'e', kind: 'SERVICE', name: 'ENGRAVING', engraving: true, textMax: 12, prices: [{ currency: 'EUR', priceMinor: 15_000 }] });
    const form = addonFormValues(engraving);
    expect(engravingAdminProblem(engraving, { ...form, name: 'ENGRAVING NEW' }, false)).toBeNull();
    expect(engravingAdminProblem(engraving, { ...form, EUR: '160' }, false)).toBe(ENGRAVING_ADMIN_ONLY.refused);
    expect(engravingAdminProblem(engraving, { ...form, orders: '' }, false)).toBe(ENGRAVING_ADMIN_ONLY.refused);
    expect(engravingAdminProblem(engraving, { ...form, EUR: '160' }, true)).toBeNull();
    // Another add-on's prices stay an OPERATOR's; one made the engraving with a price is an ADMIN's.
    const wrap = addon({ id: 'w', kind: 'SERVICE', name: 'GIFT WRAPPING', prices: [{ currency: 'EUR', priceMinor: 500 }] });
    expect(engravingAdminProblem(wrap, { ...addonFormValues(wrap), EUR: '6' }, false)).toBeNull();
    expect(engravingAdminProblem(wrap, { ...addonFormValues(wrap), engraving: 'true', textMax: '12' }, false)).toBe(ENGRAVING_ADMIN_ONLY.refused);
    // A new engraving: an OPERATOR's only without a price and with YOUR ORDERS off.
    const fresh = { ...addonFormValues(null), kind: 'SERVICE', name: 'ENGRAVING', skuCode: 'ADD-ENG', engraving: 'true', textMax: '12' };
    expect(engravingAdminProblem(null, fresh, false)).toBe(ENGRAVING_ADMIN_ONLY.refused);
    expect(engravingAdminProblem(null, { ...fresh, orders: '' }, false)).toBeNull();
    const server = readFileSync(join(ROOT, 'src/server/routes/admin/addons.ts'), 'utf8');
    expect(server).toContain(ENGRAVING_ADMIN_ONLY.refused);
  });
});

describe('the API paths', () => {
  it('reads and writes CLUB > THE VAULT, the LIVE switch and VAULT ONLY on their routes; the report\'s CSV saved', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push(`${init.method ?? 'GET'} ${url}${init.body ? ` ${String(init.body)}` : ''}`);
      if (String(url).includes('report.csv')) return new Response('"section","item","value"\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8; header=present', 'content-disposition': 'attachment; filename="ORBES-vault-report-2026-10-01-to-2026-10-31.csv"' } });
      if (String(url).includes('/vault/vaults')) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    await api.vaultSettings();
    await api.setVaultSource('PIECE', { enabled: true, perOccasion: 1, cap: 3 });
    await api.createVaultReward({ kind: 'GUARANTEED', oddsIn: 200, quantity: 10 });
    await api.updateVaultReward('r1', { oddsIn: 100, quantity: 10, active: true });
    await api.deactivateVaultReward('r1');
    await api.orderVaultRewards(['f', 'r1']);
    await api.giveVault({ email: 'c@example.com', dryRun: true });
    await api.vaultReport({ from: '2026-10-01', to: '2026-10-31' });
    const csv = await api.vaultReportCsv({ from: '2026-10-01', to: '2026-10-31' });
    expect(await api.clientVaults('acc')).toEqual([]);
    await api.setLiveVault('d1', true);
    await api.setModelVaultOnly('m1', true);
    expect(csv.filename).toBe('ORBES-vault-report-2026-10-01-to-2026-10-31.csv');
    expect(calls).toEqual([
      'GET /api/admin/vault/settings',
      'PUT /api/admin/vault/sources/PIECE {"enabled":true,"perOccasion":1,"cap":3}',
      'POST /api/admin/vault/rewards {"kind":"GUARANTEED","oddsIn":200,"quantity":10}',
      'PUT /api/admin/vault/rewards/r1 {"oddsIn":100,"quantity":10,"active":true}',
      'POST /api/admin/vault/rewards/r1/deactivate {}',
      'POST /api/admin/vault/rewards/order {"ids":["f","r1"]}',
      'POST /api/admin/vault/give {"email":"c@example.com","dryRun":true}',
      'GET /api/admin/vault/report?from=2026-10-01&to=2026-10-31',
      'GET /api/admin/vault/report.csv?from=2026-10-01&to=2026-10-31',
      'GET /api/admin/vault/vaults?account=acc',
      'PUT /api/admin/live/d1/vault {"on":true}',
      'PUT /api/admin/models/m1/vault-only {"vaultOnly":true}',
    ]);
  });
});
