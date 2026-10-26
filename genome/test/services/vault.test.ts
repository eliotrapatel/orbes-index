/**
 * THE VAULT's rules (lot Q3, step Q3.3; plan §2.1, §2.5 states, §2.7, §2b; services/vault.ts).
 *
 * Pure: the occasions' keys, the computed states, the draw's parts and the floor's published odds, the arrival's words in
 * the "we" of ROUND 5, what an OPENED row says it held.
 *
 * On the services as createContext wires them (PGlite, the clock fixed): the seven sources and their defaults (OP-29);
 * a vault given with its 30 days (D17), its FROM ORBES arrival (D18) and its audit (`vault.give`, never the house's
 * note); the cap reached on a second pass and a retry; vaults per occasion and the cap as settings, no cap; a source
 * switched off, a LIVE release's own switch; never a test entrant at any source, the house's included (D9), nor a
 * LOCKED account; no account-age rule (D22); the unique key twice (two gives at once, a duplicate refused by the table, a
 * returned piece's vault given again); the states and THE VAULT page's data (YOUR VAULTS oldest first with their labels
 * and WAITS UNTIL as Paris days, OPENED newest first, EXPIRED and REVOKED in neither, the ledger per N21, the waiting
 * count); CLUB > THE VAULT's settings (the odds' sum refused above one, the floor's published odds, a service refused
 * as a reward, a VAULT EDITION's model, the quantity never below what was given, the floor fixed, the sources' limits,
 * each write audited).
 *
 * The opening (step Q3.4; plan §2.2, §2.4, §2.7): the draw's walk over its parts and the floor's rest, where each kind
 * goes, a reward's 30 days, the credit to give's code and its lookup, the vault's € and its FROM ORBES receipt; on the
 * service with an injected random: each branch by its parts (rare GUARANTEED), the outcome written once with its row
 * given + 1, its receipt and its audit, an opened vault read again (never a second draw), a row run out sent to the card
 * at the card's published odds (never changed), the card's line for a LIVE vault and another (N4), the refusals
 * (another account's, expired, returned, locked), and which rows can give (quantity, add-on never a service, model, a
 * unit to reserve, THE PIECE only for a LIVE vault).
 *
 * Under concurrency (PGlite always; PostgreSQL in genome-ci, ORBES_TEST_POSTGRES_URL): four processes giving one
 * occasion give one vault and one message; two opens of one vault at once draw once; six openings at once, a row of
 * quantity 1 drawn by all given exactly once (the table read shared, the row counted before its delivery).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { AuditService } from '../../src/server/services/audit.js';
import { ProfileService } from '../../src/server/services/profiles.js';
import { TasteService } from '../../src/server/services/tastes.js';
import {
  drawRow,
  floorOddsIn,
  giveVault,
  hashVaultGiftCode,
  occasionKey,
  oddsText,
  rewardParts,
  rewardPick,
  vaultGiftCode,
  vaultHeld,
  vaultRewardUntil,
  vaultState,
  VaultService,
  vaultWhereOf,
  VAULT_DRAW_PARTS,
  VAULT_WAIT_MS,
  type DrawRow,
  type VaultOccasion,
} from '../../src/server/services/vault.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { VaultRewardKind } from '../../src/server/db/schema.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { vaultArrivedWords, vaultMoney, vaultOpenedWords, vaultSourceLine, VAULT_REVEAL, VAULT_SOURCE_LABELS } from '../../src/shared/house-words.js';
import { createTestDb } from '../support/db.js';
import { createAccount, createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const z = (iso: string) => new Date(iso);

describe('THE VAULT (pure)', () => {
  it('keys each occasion as the caps count it', () => {
    const id = randomUUID();
    expect(occasionKey({ source: 'LIVE', accountId: id, dropId: id.toUpperCase(), entryId: id })).toBe(`LIVE:${id}`);
    expect(occasionKey({ source: 'PIECE', accountId: id, productId: id })).toBe(`PIECE:${id}`);
    expect(occasionKey({ source: 'TIER', accountId: id, tier: 2 })).toBe('TIER:2');
    expect(occasionKey({ source: 'WORN', accountId: id, productId: id, wornPhotoId: randomUUID() })).toBe(`WORN:${id}`);
    expect(occasionKey({ source: 'FRIEND', accountId: randomUUID(), friendAccountId: id })).toBe(`FRIEND:${id}`);
    expect(occasionKey({ source: 'PROFILE', accountId: id })).toBe('PROFILE');
    expect(occasionKey({ source: 'HOUSE', accountId: id, giftId: id, givenBy: randomUUID() })).toBe(`HOUSE:${id}`);
  });

  it('computes a vault’s state: WAITING for 30 days, then EXPIRED; OPENED; REVOKED', () => {
    const given = z('2026-11-01T20:00:00.000Z');
    const v = { opened_at: null, revoked_at: null, waits_until: new Date(given.getTime() + VAULT_WAIT_MS) };
    expect(VAULT_WAIT_MS).toBe(30 * DAY);
    expect(vaultState(v, given)).toBe('WAITING');
    expect(vaultState(v, new Date(given.getTime() + VAULT_WAIT_MS - 1))).toBe('WAITING');
    expect(vaultState(v, new Date(given.getTime() + VAULT_WAIT_MS))).toBe('EXPIRED');
    expect(vaultState({ ...v, opened_at: z('2026-11-02T10:00:00Z') }, new Date(given.getTime() + 40 * DAY))).toBe('OPENED');
    expect(vaultState({ ...v, revoked_at: z('2026-11-02T10:00:00Z') }, given)).toBe('REVOKED');
  });

  it('gives each row round(1 000 000 / N) of the draw and the floor the rest, its published odds 1 IN round(1 / remainder)', () => {
    expect(VAULT_DRAW_PARTS).toBe(1_000_000);
    expect([1, 2, 3, 10, 200, 1_000_000].map(rewardParts)).toEqual([1_000_000, 500_000, 333_333, 100_000, 5_000, 1]);
    expect(floorOddsIn(1_000_000)).toBe(1);
    expect(floorOddsIn(250_000)).toBe(4);
    expect(floorOddsIn(1)).toBe(1_000_000);
    expect(floorOddsIn(0)).toBeNull();
    expect(oddsText(200)).toBe('1 IN 200');
  });

  it('words the arrival in the vault’s "we", for each source, one vault or more, never "the house kept / set aside"', () => {
    expect(vaultArrivedWords({ source: 'LIVE', detail: 'MONOLITHE IN BLUE', count: 1, until: '2026-11-27' })).toEqual({
      title: 'A VAULT IS WAITING FOR YOU',
      body: 'Your size sold out at the LIVE release of MONOLITHE IN BLUE while you were in the line. We have added a vault to your account. It is kept until 27 November 2026. Open it in YOUR ACCOUNT, under THE VAULT.',
    });
    expect(vaultArrivedWords({ source: 'PIECE', detail: 'MONOLITHE IN STEEL', count: 1, until: '2026-11-27' }).body).toBe(
      'With your new piece, MONOLITHE IN STEEL, we have added a vault to your account. It is kept until 27 November 2026. Open it in YOUR ACCOUNT, under THE VAULT.',
    );
    expect(vaultArrivedWords({ source: 'TIER', detail: 'PLATINE', count: 1, until: '2026-11-30' }).body).toBe(
      'You have reached PLATINE. We have added a vault to your account. It is kept until 30 November 2026. Open it in YOUR ACCOUNT, under THE VAULT.',
    );
    expect(vaultArrivedWords({ source: 'HOUSE', detail: null, count: 2, until: '2026-12-01' })).toEqual({
      title: '2 VAULTS ARE WAITING FOR YOU',
      body: 'We have added 2 vaults to your account. They are kept until 1 December 2026. Open them in YOUR ACCOUNT, under THE VAULT.',
    });
    for (const source of ['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE'] as const) {
      const w = vaultArrivedWords({ source, detail: null, count: 1, until: '2026-11-27' });
      expect(w.body).toMatch(/[Ww]e have added a vault to your account\./);
      expect(`${w.title} ${w.body}`).not.toMatch(/house kept|set aside|paid|ORBES/i);
    }
  });

  it('labels each source (the mockup’s four word for word) and says what an OPENED row held (€ kept, OP-32)', () => {
    expect(VAULT_SOURCE_LABELS).toEqual({
      LIVE: 'YOUR SIZE SOLD OUT',
      PIECE: 'A NEW PIECE',
      TIER: 'A NEW TIER',
      WORN: 'A PHOTOGRAPH IN WORN',
      FRIEND: 'A FRIEND’S FIRST PIECE',
      PROFILE: 'A COMPLETE PROFILE',
      HOUSE: 'FROM THE HOUSE',
    });
    expect(vaultSourceLine('LIVE', 'MONOLITHE IN BLUE')).toBe('YOUR SIZE SOLD OUT · MONOLITHE IN BLUE');
    expect(vaultSourceLine('TIER', 'PLATINE')).toBe('A NEW TIER · PLATINE');
    expect(vaultSourceLine('PROFILE', null)).toBe('A COMPLETE PROFILE');
    expect(vaultHeld('CREDIT', '€25')).toBe('€25 · HOUSE CREDIT');
    expect(vaultHeld('I_WAS_THERE', 'I WAS THERE')).toBe('I WAS THERE');
    expect(vaultHeld('CREDIT_TO_GIVE', '€30 TO GIVE')).toBe('€30 TO GIVE');
  });
});

describe('THE VAULT’s rules (VaultService, giveVault)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let staff: Actor & { id: string };

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    staff = f.admin;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const vault = () => ctx.services.vault;
  const piece = async (accountId: string) => (await holdPieces(t.db, accountId, 1, f.modelId))[0]!;
  const vaultsOf = (accountId: string) => t.db.selectFrom('vaults').selectAll().where('account_id', '=', accountId).orderBy('given_at').orderBy('occasion_index').execute();
  const arrivalsOf = (accountId: string) => t.db.selectFrom('house_deliveries').selectAll().where('account_id', '=', accountId).where('source', '=', 'VAULT').orderBy('delivered_at').execute();
  const gives = (accountId: string) =>
    t.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', 'vault.give').where('target_id', '=', accountId).orderBy('id').execute();
  const setSource = (source: string, enabled: boolean, perOccasion: number, cap: number | null) => vault().setSource(source, { enabled, perOccasion, cap }, staff);
  const testEntrant = async () => {
    const a = await createAccount(t.db);
    await t.db.insertInto('test_entrants').values({ account_id: a.id }).execute();
    return a;
  };
  /** A vault opened, its outcome written as the opening writes it (step Q3.4): the floor here. */
  const openAt = async (vaultId: string, at: Date, kind: 'I_WAS_THERE' | 'CREDIT' = 'I_WAS_THERE') => {
    const floor = await t.db.selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
    await t.db
      .updateTable('vaults')
      .set({ opened_at: at, reward_id: floor.id, reward_kind: kind, prize: kind === 'CREDIT' ? '€25' : 'I WAS THERE', odds_text: '1 IN 1', rare: false })
      .where('id', '=', vaultId)
      .execute();
  };

  it('starts with the seven sources at OP-29’s defaults and the I WAS THERE floor alone, at 1 IN 1', async () => {
    const s = await vault().settings();
    expect(s.sources.map((x) => [x.source, x.enabled, x.perOccasion, x.cap])).toEqual([
      ['LIVE', true, 1, 1],
      ['PIECE', true, 1, 1],
      ['TIER', true, 1, 1],
      ['WORN', true, 1, 1],
      ['FRIEND', true, 1, 1],
      ['PROFILE', true, 1, 1],
      ['HOUSE', true, 1, null],
    ]);
    expect(s.rewards).toEqual([expect.objectContaining({ kind: 'I_WAS_THERE', oddsIn: null, quantity: null, active: true, parts: 1_000_000 })]);
    expect(s.partsGiven).toBe(0);
    expect(s.floor).toEqual({ id: s.rewards[0]!.id, parts: 1_000_000, oddsIn: 1, oddsText: '1 IN 1' });
  });

  it('gives a vault for 30 days with its FROM ORBES arrival in the "we" of the vault, audited without a note; a brand-new account too (no age rule)', async () => {
    const a = await createAccount(t.db);
    const p = await piece(a.id);
    const now = clock.now();
    const given = await vault().give({ source: 'PIECE', accountId: a.id, productId: p }, now);
    expect(given.skipped).toBeNull();
    expect(given.vaults).toEqual([
      { id: expect.any(String), accountId: a.id, source: 'PIECE', occasionKey: `PIECE:${p}`, occasionIndex: 1, givenAt: now, waitsUntil: new Date(now.getTime() + 30 * DAY) },
    ]);
    const [v] = await vaultsOf(a.id);
    expect(v).toMatchObject({ source: 'PIECE', product_id: p, occasion_key: `PIECE:${p}`, occasion_index: 1, opened_at: null, revoked_at: null });
    expect(new Date(v!.waits_until).getTime() - new Date(v!.given_at).getTime()).toBe(30 * DAY);
    const arrivals = await arrivalsOf(a.id);
    expect(arrivals).toEqual([
      expect.objectContaining({
        id: given.deliveryId,
        source: 'VAULT',
        moment: null,
        house_message_id: null,
        piece_ref: null,
        dedupe_key: `VAULT:${v!.id}`,
        title: 'A VAULT IS WAITING FOR YOU',
        body: 'With your new piece, MONOLITHE, we have added a vault to your account. It is kept until 2 December 2026. Open it in YOUR ACCOUNT, under THE VAULT.',
        read_at: null,
      }),
    ]);
    expect(await gives(a.id)).toEqual([{ actor_type: 'system', actor_id: null, details: { source: 'PIECE', occasionKey: `PIECE:${p}`, count: 1, vaults: [v!.id] } }]);

    // A second pass and a retry of the same occasion give nothing (the cap per piece, 1), and no second message.
    expect(await vault().give({ source: 'PIECE', accountId: a.id, productId: p })).toMatchObject({ vaults: [], skipped: 'CAP', deliveryId: null, notes: [] });
    await inTransaction(t.db, async (tx) => {
      expect((await giveVault(tx, { source: 'PIECE', accountId: a.id, productId: p }, clock.now())).skipped).toBe('CAP');
    });
    expect(await vaultsOf(a.id)).toHaveLength(1);
    expect(await arrivalsOf(a.id)).toHaveLength(1);
    // Another piece is another occasion.
    expect((await vault().give({ source: 'PIECE', accountId: a.id, productId: await piece(a.id) })).vaults).toHaveLength(1);
  });

  it('names each occasion’s detail in its arrival: the release’s piece, the tier reached, the house’s gift by its staff member', async () => {
    const a = await createAccount(t.db);
    const blue = await t.db.insertInto('models').values({ category_id: 1, name: 'MONOLITHE', variant_label: 'Blue', variant_swatch: '#1F3A5F', type: 'RING', sku_prefix: `MON-${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow();
    const r = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + HOUR), modelId: blue.id });
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', r.id).execute();
    const at = clock.now();
    clock.set(new Date(at.getTime() + HOUR - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const live = await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id });
    expect(live.vaults).toHaveLength(1);
    await vault().give({ source: 'TIER', accountId: a.id, tier: 2 });
    const gift = randomUUID();
    const house = await vault().give({ source: 'HOUSE', accountId: a.id, giftId: gift, givenBy: staff.id, note: '  For the evening.  ' });
    expect(house.vaults).toHaveLength(1);
    // The three at one instant: each its own message.
    const bodies = (await arrivalsOf(a.id)).map((d) => d.body);
    expect(bodies).toHaveLength(3);
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Your size sold out at the LIVE release of MONOLITHE IN BLUE while you were in the line\. We have added a vault to your account\./),
        expect.stringMatching(/^You have reached PLATINE\. We have added a vault to your account\./),
        expect.stringMatching(/^We have added a vault to your account\. It is kept until /),
      ]),
    );
    const v = (await vaultsOf(a.id)).find((x) => x.source === 'HOUSE')!;
    expect(v).toMatchObject({ given_by: staff.id, note: 'For the evening.', occasion_key: `HOUSE:${gift}`, segment_id: null });
    const audit = (await gives(a.id)).at(-1)!;
    expect(audit).toMatchObject({ actor_type: 'admin', actor_id: staff.id, details: { source: 'HOUSE', occasionKey: `HOUSE:${gift}`, count: 1, segmentId: null, note: true } });
    expect(JSON.stringify(audit.details)).not.toContain('evening');
    // A blank note is no note: given, stored null, audited without one.
    const blankGift = randomUUID();
    expect((await vault().give({ source: 'HOUSE', accountId: a.id, giftId: blankGift, givenBy: staff.id, note: '   ' })).vaults).toHaveLength(1);
    expect((await vaultsOf(a.id)).find((x) => x.occasion_key === `HOUSE:${blankGift}`)).toMatchObject({ note: null });
    expect((await gives(a.id)).at(-1)!.details).toMatchObject({ occasionKey: `HOUSE:${blankGift}`, note: false });
    clock.set(at);
  });

  it('gives per occasion as many as set, up to the cap, and without a cap every time; nothing while a source is off', async () => {
    const a = await createAccount(t.db);
    await setSource('TIER', true, 2, 1);
    const two = await vault().give({ source: 'TIER', accountId: a.id, tier: 1 });
    expect(two.vaults.map((v) => v.occasionIndex)).toEqual([1, 2]);
    // One message for the occasion's two vaults.
    expect((await arrivalsOf(a.id)).map((d) => [d.title, d.dedupe_key])).toEqual([['2 VAULTS ARE WAITING FOR YOU', `VAULT:${two.vaults[0]!.id}`]]);
    expect((await vault().give({ source: 'TIER', accountId: a.id, tier: 1 })).skipped).toBe('CAP');
    // The cap raised to two occasions: one more occasion of the same tier gives two more, then none.
    await setSource('TIER', true, 2, 2);
    expect((await vault().give({ source: 'TIER', accountId: a.id, tier: 1 })).vaults.map((v) => v.occasionIndex)).toEqual([3, 4]);
    expect((await vault().give({ source: 'TIER', accountId: a.id, tier: 1 })).skipped).toBe('CAP');
    // No cap: each occasion gives.
    await setSource('TIER', true, 1, null);
    expect((await vault().give({ source: 'TIER', accountId: a.id, tier: 1 })).vaults.map((v) => v.occasionIndex)).toEqual([5]);
    expect((await vault().give({ source: 'TIER', accountId: a.id, tier: 1 })).vaults.map((v) => v.occasionIndex)).toEqual([6]);
    // Off: nothing at all.
    await setSource('TIER', false, 1, 1);
    expect(await vault().give({ source: 'TIER', accountId: a.id, tier: 2 })).toMatchObject({ vaults: [], skipped: 'SOURCE_OFF' });
    await setSource('TIER', true, 1, 1);
    expect(await vaultsOf(a.id)).toHaveLength(6);
    // The house: no cap, each gift its own key.
    for (let i = 0; i < 3; i++) expect((await vault().give({ source: 'HOUSE', accountId: a.id, giftId: randomUUID(), givenBy: staff.id })).vaults).toHaveLength(1);
  });

  it('gives nothing for a LIVE release whose vault is off (D4: off by default)', async () => {
    const a = await createAccount(t.db);
    const at = clock.now();
    const r = await createLiveRelease(f, { opensAt: new Date(at.getTime() + HOUR) });
    clock.set(new Date(at.getTime() + HOUR - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    clock.set(at);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    expect((await t.db.selectFrom('drops').select('vault_on').where('id', '=', r.id).executeTakeFirstOrThrow()).vault_on).toBe(false);
    expect(await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).toMatchObject({ vaults: [], skipped: 'RELEASE_OFF' });
    await setSource('LIVE', false, 1, 1);
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', r.id).execute();
    expect((await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).skipped).toBe('SOURCE_OFF');
    await setSource('LIVE', true, 1, 1);
    expect((await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).vaults).toHaveLength(1);
    expect((await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).skipped).toBe('CAP');
  });

  it('never gives a test entrant a vault, at any source, the house’s included (D9), nor a LOCKED account, nor for a test entrant’s first piece', async () => {
    const te = await testEntrant();
    const p = await piece(te.id);
    const occasions: VaultOccasion[] = [
      { source: 'PIECE', accountId: te.id, productId: p },
      { source: 'TIER', accountId: te.id, tier: 1 },
      { source: 'PROFILE', accountId: te.id },
      { source: 'FRIEND', accountId: te.id, friendAccountId: (await createAccount(t.db)).id },
      { source: 'HOUSE', accountId: te.id, giftId: randomUUID(), givenBy: staff.id },
    ];
    for (const o of occasions) expect((await vault().give(o)).skipped).toBe('TEST_ENTRANT');
    // A collector invited a test entrant: its first piece gives the collector nothing.
    const inviter = await createAccount(t.db);
    expect((await vault().give({ source: 'FRIEND', accountId: inviter.id, friendAccountId: te.id })).skipped).toBe('TEST_ENTRANT');
    const locked = await createAccount(t.db);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    expect((await vault().give({ source: 'PROFILE', accountId: locked.id })).skipped).toBe('NOT_ACTIVE');
    expect((await vault().give({ source: 'PROFILE', accountId: randomUUID() })).skipped).toBe('NOT_ACTIVE');
    for (const id of [te.id, inviter.id, locked.id]) {
      expect(await vaultsOf(id)).toEqual([]);
      expect(await arrivalsOf(id)).toEqual([]);
    }
    await expect(vault().give({ source: 'FRIEND', accountId: te.id, friendAccountId: te.id })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(vault().give({ source: 'PIECE', accountId: te.id, productId: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('holds the unique key: two gives at once give one; the table refuses a duplicate; a returned piece’s vault can be given again', async () => {
    const a = await createAccount(t.db);
    const p = await piece(a.id);
    const both = await Promise.all([0, 1].map(() => vault().give({ source: 'PIECE', accountId: a.id, productId: p })));
    expect(both.map((g) => g.vaults.length).sort()).toEqual([0, 1]);
    const [v] = await vaultsOf(a.id);
    await expect(
      t.db
        .insertInto('vaults')
        .values({ account_id: a.id, source: 'PIECE', product_id: p, occasion_key: `PIECE:${p}`, occasion_index: 1, given_at: clock.now(), waits_until: new Date(clock.now().getTime() + 30 * DAY) })
        .execute(),
    ).rejects.toThrow(/vaults_occasion_key/);
    // A returned piece takes its unopened vault back (step Q3.6 writes it): the occasion can give again.
    await t.db.updateTable('vaults').set({ revoked_at: clock.now(), revoked_reason: 'RETURNED' }).where('id', '=', v!.id).execute();
    const again = await vault().give({ source: 'PIECE', accountId: a.id, productId: p });
    expect(again.vaults.map((x) => x.occasionIndex)).toEqual([1]);
    expect(await arrivalsOf(a.id)).toHaveLength(2);
  });

  it('reads THE VAULT page: YOUR VAULTS oldest first with their lines and WAITS UNTIL as Paris days, OPENED newest first, EXPIRED and REVOKED in neither', async () => {
    const a = await createAccount(t.db);
    const start = clock.now();
    const blue = await t.db.insertInto('models').values({ category_id: 1, name: 'ORBITE', variant_label: 'Steel', variant_swatch: '#8A8D91', type: 'RING', sku_prefix: `ORB-${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow();
    const [steel] = await holdPieces(t.db, a.id, 1, blue.id);
    // 2 November 09:00 UTC: a piece; then (a day later) a tier; then a profile; then a returned piece's vault.
    const first = (await vault().give({ source: 'PIECE', accountId: a.id, productId: steel! }, start)).vaults[0]!;
    const tier = (await vault().give({ source: 'TIER', accountId: a.id, tier: 2 }, new Date(start.getTime() + DAY))).vaults[0]!;
    const profile = (await vault().give({ source: 'PROFILE', accountId: a.id }, new Date(start.getTime() + 2 * DAY))).vaults[0]!;
    const returned = (await vault().give({ source: 'PIECE', accountId: a.id, productId: await piece(a.id) }, new Date(start.getTime() + 3 * DAY))).vaults[0]!;
    await t.db.updateTable('vaults').set({ revoked_at: new Date(start.getTime() + 4 * DAY), revoked_reason: 'RETURNED' }).where('id', '=', returned.id).execute();

    const now = new Date(start.getTime() + 5 * DAY);
    let page = await vault().forAccount(a.id, now);
    expect(page.waiting.map((d) => [d.label, d.detail, d.line, d.waitsUntilDay])).toEqual([
      ['A NEW PIECE', 'ORBITE IN STEEL', 'A NEW PIECE · ORBITE IN STEEL', '2026-12-02'],
      ['A NEW TIER', 'PLATINE', 'A NEW TIER · PLATINE', '2026-12-03'],
      ['A COMPLETE PROFILE', null, 'A COMPLETE PROFILE', '2026-12-04'],
    ]);
    expect(page.waiting[0]).toMatchObject({ id: first.id, source: 'PIECE', givenAt: start, waitsUntil: new Date(start.getTime() + 30 * DAY) });
    expect(page.opened).toEqual([]);
    expect(page.waitingCount).toBe(3);
    expect(await vault().waitingCount(a.id, now)).toBe(3);

    // Opened: the tier's, then the profile's (newest first); the piece's vault expires unopened past its 30 days.
    await openAt(tier.id, new Date(start.getTime() + 6 * DAY), 'CREDIT');
    await openAt(profile.id, new Date(start.getTime() + 7 * DAY));
    page = await vault().forAccount(a.id, new Date(start.getTime() + 30 * DAY));
    expect(page.waiting).toEqual([]);
    expect(page.waitingCount).toBe(0);
    expect(page.opened.map((o) => [o.id, o.label, o.openedDay, o.kind, o.prize, o.held])).toEqual([
      [profile.id, 'A COMPLETE PROFILE', '2026-11-09', 'I_WAS_THERE', 'I WAS THERE', 'I WAS THERE'],
      [tier.id, 'A NEW TIER', '2026-11-08', 'CREDIT', '€25', '€25 · HOUSE CREDIT'],
    ]);
    // Just before its end the first still waits: its WAITS UNTIL is the Paris day of given + 30 days.
    page = await vault().forAccount(a.id, new Date(start.getTime() + 30 * DAY - 1));
    expect(page.waiting.map((d) => d.id)).toEqual([first.id]);
    await expect(vault().forAccount('nope')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    expect(await vault().waitingCount('nope')).toBe(0);
  });

  it('reads the ledger per N21: the next LIVE release with its vault on, the tier’s progress or the highest, the profile, a source off hidden', async () => {
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, 7, f.modelId);
    const now = clock.now();
    // The releases of the tests above, their vault switched off: only this test's count.
    await t.db.updateTable('drops').set({ vault_on: false }).where('vault_on', '=', true).execute();
    const later = await createLiveRelease(f, { opensAt: new Date(now.getTime() + 9 * DAY) });
    const sooner = await createLiveRelease(f, { opensAt: new Date(now.getTime() + 2 * DAY) });
    await createLiveRelease(f, { opensAt: new Date(now.getTime() + DAY) }); // its vault off: not the next
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', 'in', [later.id, sooner.id]).execute();
    const ledger = (await vault().forAccount(a.id, now)).ledger;
    expect(ledger).toEqual([
      { source: 'LIVE', next: '2026-11-04' },
      { source: 'PIECE' },
      { source: 'TIER', tier: 'PLATINE', pieces: 7, next: { tier: 'PALLADIUM', pieces: 10, away: 3 } },
      { source: 'WORN' },
      { source: 'FRIEND' },
      { source: 'PROFILE', done: false, percent: expect.any(Number) },
      { source: 'HOUSE' },
    ]);
    await t.db.updateTable('drops').set({ vault_on: false }).where('id', 'in', [later.id, sooner.id]).execute();
    await holdPieces(t.db, a.id, 3, f.modelId);
    await setSource('WORN', false, 1, 1);
    const after = (await vault().forAccount(a.id, now)).ledger;
    expect(after.map((r) => r.source)).toEqual(['LIVE', 'PIECE', 'TIER', 'FRIEND', 'PROFILE', 'HOUSE']);
    expect(after[0]).toEqual({ source: 'LIVE', next: null });
    expect(after[2]).toEqual({ source: 'TIER', tier: 'PALLADIUM', pieces: 10, next: null });
    await setSource('WORN', true, 1, 1);
    const none = await createAccount(t.db);
    expect((await vault().forAccount(none.id, now)).ledger[2]).toEqual({ source: 'TIER', tier: null, pieces: 0, next: { tier: 'TITANE', pieces: 1, away: 1 } });
  });

  it('sets the house table: the odds’ sum never above one in one, the floor’s published odds the remainder’s, each write audited', async () => {
    const credit = await vault().createReward({ kind: 'CREDIT', oddsIn: 2, quantity: 50, amountMinor: 2500, currency: 'EUR' }, staff);
    expect(credit.partsGiven).toBe(500_000);
    expect(credit.floor).toMatchObject({ parts: 500_000, oddsIn: 2, oddsText: '1 IN 2' });
    const row = credit.rewards.find((r) => r.kind === 'CREDIT')!;
    expect(row).toMatchObject({ oddsIn: 2, oddsText: '1 IN 2', parts: 500_000, quantity: 50, given: 0, left: 50, amountMinor: 2500, currency: 'EUR', active: true, rare: false });
    const guaranteed = await vault().createReward({ kind: 'GUARANTEED', oddsIn: 4, quantity: 3 }, staff);
    expect(guaranteed.floor).toMatchObject({ parts: 250_000, oddsText: '1 IN 4' });
    expect(guaranteed.rewards.find((r) => r.kind === 'GUARANTEED')!.rare).toBe(true);
    // Above one in one: refused, nothing written.
    await expect(vault().createReward({ kind: 'GUARANTEED', oddsIn: 3, quantity: 1 }, staff)).rejects.toMatchObject({ code: 'VAULT_ODDS_OVER', httpStatus: 409 });
    expect((await vault().settings()).rewards).toHaveLength(3);
    // Exactly one in one is allowed: the floor then has no odds of its own.
    const full = await vault().createReward({ kind: 'THE_PIECE', oddsIn: 4, quantity: 1 }, staff);
    expect(full.floor).toMatchObject({ parts: 0, oddsIn: null, oddsText: null });
    const thePiece = full.rewards.find((r) => r.kind === 'THE_PIECE')!;
    await vault().deactivateReward(thePiece.id, staff);
    // Made active again only while the odds allow it.
    await vault().updateReward(row.id, { oddsIn: 2, quantity: 50, amountMinor: 3000, currency: 'EUR' }, staff);
    await vault().updateReward(thePiece.id, { oddsIn: 4, quantity: 1, active: true }, staff);
    await expect(vault().updateReward(thePiece.id, { oddsIn: 3, quantity: 1, active: true }, staff)).rejects.toMatchObject({ code: 'VAULT_ODDS_OVER' });
    await vault().deactivateReward(thePiece.id, staff);
    // The quantity is never below what was given; a row keeps its kind; the floor is fixed.
    await t.db.updateTable('vault_rewards').set({ given: 5 }).where('id', '=', row.id).execute();
    await expect(vault().updateReward(row.id, { oddsIn: 2, quantity: 4, amountMinor: 3000, currency: 'EUR' }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(vault().updateReward(row.id, { kind: 'CREDIT_TO_GIVE', oddsIn: 2, quantity: 50, amountMinor: 3000, currency: 'EUR' }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const floor = (await vault().settings()).floor;
    await expect(vault().deactivateReward(floor.id, staff)).rejects.toMatchObject({ code: 'VAULT_FLOOR_FIXED' });
    await expect(vault().updateReward(floor.id, { oddsIn: 2, quantity: 1 }, staff)).rejects.toMatchObject({ code: 'VAULT_FLOOR_FIXED' });
    await expect(vault().createReward({ kind: 'I_WAS_THERE', oddsIn: 2, quantity: 1 }, staff)).rejects.toMatchObject({ code: 'VAULT_FLOOR_FIXED' });
    // The order: every row once.
    const ids = (await vault().settings()).rewards.map((r) => r.id).reverse();
    expect((await vault().orderRewards(ids, staff)).rewards.map((r) => r.id)).toEqual(ids);
    await expect(vault().orderRewards(ids.slice(1), staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // A collector or a stranger cannot write.
    await expect(vault().createReward({ kind: 'GUARANTEED', oddsIn: 100, quantity: 1 }, { type: 'account', id: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const actions = await t.db.selectFrom('audit_logs').select(['action', 'actor_id']).where('action', 'like', 'vault.reward.%').orderBy('id').execute();
    expect(actions.map((x) => x.action)).toEqual([
      'vault.reward.create',
      'vault.reward.create',
      'vault.reward.create',
      'vault.reward.deactivate',
      'vault.reward.update',
      'vault.reward.update',
      'vault.reward.deactivate',
      'vault.reward.order',
    ]);
    expect(actions.every((x) => x.actor_id === staff.id)).toBe(true);
  });

  it('refuses a service as a reward (E7), names a vault-only model for a VAULT EDITION only, and checks each kind’s fields', async () => {
    const service = await ctx.services.addons.create(
      { kind: 'SERVICE', name: `GIFT WRAPPING ${randomUUID().slice(0, 4)}`, skuCode: `ADD-WRAP-${randomUUID().slice(0, 6)}`, prices: { EUR: 900 } },
      staff,
    );
    const cloth = await ctx.services.addons.create({ name: `Polishing Cloth ${randomUUID().slice(0, 4)}`, skuCode: `ADD-CLOTH-${randomUUID().slice(0, 6)}`, prices: { EUR: 1500 } }, staff);
    await expect(vault().createReward({ kind: 'ADDON', oddsIn: 100, quantity: 10, addonId: service.id }, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_SERVICE', httpStatus: 409 });
    await expect(vault().createReward({ kind: 'PRODUCT', oddsIn: 100, quantity: 10, addonId: service.id, mode: 'FREE' }, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_SERVICE' });
    const addon = await vault().createReward({ kind: 'ADDON', oddsIn: 100, quantity: 10, addonId: cloth.id }, staff);
    expect(addon.rewards.find((r) => r.addonId === cloth.id)).toMatchObject({ kind: 'ADDON', addonName: cloth.name, parts: 10_000 });
    // A VAULT EDITION names a model marked vault-only; a vault-only model is never a PRODUCT (never sold).
    const edition = await createModel(t.db, 'ECLIPSE');
    await expect(vault().createReward({ kind: 'VAULT_EDITION', oddsIn: 1000, quantity: 5, modelId: edition, line: 'Made only for the vault, never sold.' }, staff)).rejects.toMatchObject({ code: 'VAULT_EDITION_MODEL' });
    await t.db.updateTable('models').set({ vault_only: true }).where('id', '=', edition).execute();
    const made = await vault().createReward({ kind: 'VAULT_EDITION', oddsIn: 1000, quantity: 5, modelId: edition, line: '  Made only for the vault,   never sold. ' }, staff);
    expect(made.rewards.find((r) => r.modelId === edition)).toMatchObject({ kind: 'VAULT_EDITION', modelName: 'ECLIPSE', line: 'Made only for the vault, never sold.', rare: true });
    await expect(vault().createReward({ kind: 'PRODUCT', oddsIn: 1000, quantity: 5, modelId: edition, mode: 'RIGHT_TO_BUY' }, staff)).rejects.toMatchObject({ code: 'VAULT_ONLY_PRODUCT' });
    const product = await vault().createReward({ kind: 'PRODUCT', oddsIn: 1000, quantity: 5, modelId: f.modelId, mode: 'RIGHT_TO_BUY' }, staff);
    expect(product.rewards.find((r) => r.kind === 'PRODUCT')).toMatchObject({ modelName: 'MONOLITHE', mode: 'RIGHT_TO_BUY', addonId: null });
    // Once a row has given, what it gave is read from it: its model, add-on and mode stay (its odds and quantity move).
    const productRow = product.rewards.find((r) => r.kind === 'PRODUCT')!;
    const addonRow = addon.rewards.find((r) => r.addonId === cloth.id)!;
    await t.db.updateTable('vault_rewards').set({ given: 1 }).where('id', 'in', [productRow.id, addonRow.id]).execute();
    const other = await createModel(t.db, 'HALO');
    await expect(vault().updateReward(productRow.id, { oddsIn: 1000, quantity: 5, modelId: other, mode: 'RIGHT_TO_BUY' }, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_GIVEN', httpStatus: 409, message: 'This reward was given: add another row.' });
    await expect(vault().updateReward(productRow.id, { oddsIn: 1000, quantity: 5, modelId: f.modelId, mode: 'FREE' }, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_GIVEN' });
    await expect(vault().updateReward(addonRow.id, { kind: 'ADDON', oddsIn: 100, quantity: 10, addonId: (await ctx.services.addons.create({ name: `Pouch ${randomUUID().slice(0, 4)}`, skuCode: `ADD-POUCH-${randomUUID().slice(0, 6)}`, prices: { EUR: 900 } }, staff)).id }, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_GIVEN' });
    await vault().updateReward(productRow.id, { oddsIn: 2000, quantity: 3, modelId: f.modelId, mode: 'RIGHT_TO_BUY' }, staff);
    // Each kind's own fields.
    const bad = (input: Record<string, unknown>) => expect(vault().createReward({ oddsIn: 100, quantity: 1, ...input }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await bad({ kind: 'CREDIT', amountMinor: 2500, currency: 'JPY' });
    await bad({ kind: 'CREDIT_TO_GIVE', amountMinor: 0, currency: 'EUR' });
    await bad({ kind: 'PRODUCT', modelId: f.modelId, addonId: cloth.id, mode: 'FREE' });
    await bad({ kind: 'PRODUCT', modelId: f.modelId });
    await bad({ kind: 'ADDON' });
    await bad({ kind: 'GUARANTEED', oddsIn: 0 });
    await bad({ kind: 'GUARANTEED', oddsIn: 1_000_001 });
    await bad({ kind: 'GUARANTEED', quantity: -1 });
    await bad({ kind: 'NOTHING' });
    await expect(vault().createReward({ kind: 'ADDON', oddsIn: 100, quantity: 1, addonId: randomUUID() }, staff)).rejects.toMatchObject({ code: 'ADDON_NOT_FOUND' });
  });

  it('sets each source’s switch and limits (OP-29), the house never capped, audited vault.settings', async () => {
    const s = await vault().setSource('WORN', { enabled: true, perOccasion: 3, cap: 2 }, staff);
    expect(s.sources.find((x) => x.source === 'WORN')).toMatchObject({ enabled: true, perOccasion: 3, cap: 2, updatedBy: { id: staff.id } });
    await expect(vault().setSource('HOUSE', { enabled: true, perOccasion: 1, cap: 5 }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(vault().setSource('WORN', { enabled: true, perOccasion: 11, cap: 1 }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(vault().setSource('WORN', { enabled: true, perOccasion: 1, cap: 101 }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(vault().setSource('BIRTHDAY', { enabled: true, perOccasion: 1, cap: 1 }, staff)).rejects.toMatchObject({ code: 'VAULT_SOURCE_NOT_FOUND' });
    await vault().setSource('WORN', { enabled: true, perOccasion: 1, cap: 1 }, staff);
    const logged = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'vault.settings').where('target_id', '=', 'WORN').orderBy('id').execute();
    expect(logged.at(-2)!.details).toEqual({ source: 'WORN', before: { enabled: true, perOccasion: 1, cap: 1 }, after: { enabled: true, perOccasion: 3, cap: 2 } });
  });
});

// ── The opening's draw (step Q3.4) ─────────────────────────────────────────

describe('THE VAULT’s opening: the draw (pure)', () => {
  it('walks the active rows in the table’s order, each its round(1 000 000 / N) parts, the floor the rest', () => {
    const rows = [
      { id: 'a', kind: 'CREDIT' as const, odds_in: 10 },
      { id: 'floor', kind: 'I_WAS_THERE' as const, odds_in: null },
      { id: 'b', kind: 'GUARANTEED' as const, odds_in: 4 },
      { id: 'c', kind: 'ADDON' as const, odds_in: 200 },
    ];
    expect(drawRow(rows, 0)?.id).toBe('a');
    expect(drawRow(rows, 99_999)?.id).toBe('a');
    expect(drawRow(rows, 100_000)?.id).toBe('b');
    expect(drawRow(rows, 349_999)?.id).toBe('b');
    expect(drawRow(rows, 350_000)?.id).toBe('c');
    expect(drawRow(rows, 354_999)?.id).toBe('c');
    expect(drawRow(rows, 355_000)).toBeNull();
    expect(drawRow(rows, VAULT_DRAW_PARTS - 1)).toBeNull();
    expect(drawRow([], 0)).toBeNull();
  });

  it('says where each kind goes, when a reward ends, the credit to give’s code and its lookup, the vault’s € and its receipt', () => {
    expect((['CREDIT', 'CREDIT_TO_GIVE', 'GUARANTEED', 'ADDON', 'PRODUCT', 'VAULT_EDITION', 'THE_PIECE', 'I_WAS_THERE'] as const).map(vaultWhereOf)).toEqual([
      'ACCOUNT', 'ACCOUNT', 'ACCOUNT', 'ORDERS', 'ORDERS', 'ORDERS', 'ORDERS', 'NONE',
    ]);
    // 30 days, the opening's Paris day the first: opened 2 November (Paris), it ends with 1 December, Paris.
    expect(vaultRewardUntil(z('2026-11-02T09:00:00.000Z')).toISOString()).toBe('2026-12-01T22:59:59.999Z');
    expect(vaultRewardUntil(z('2026-11-01T23:30:00.000Z')).toISOString()).toBe('2026-12-01T22:59:59.999Z');
    const key = new Uint8Array(randomBytes(32));
    const id = randomUUID();
    const code = vaultGiftCode(id, key);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(vaultGiftCode(id.toUpperCase(), key)).toBe(code);
    expect(vaultGiftCode(randomUUID(), key)).not.toBe(code);
    expect(vaultGiftCode(id, new Uint8Array(randomBytes(32)))).not.toBe(code);
    const grouped = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    expect(Buffer.from(hashVaultGiftCode(grouped.toLowerCase(), key)!)).toEqual(Buffer.from(hashVaultGiftCode(code, key)!));
    expect(hashVaultGiftCode(code, key)!.length).toBe(32);
    for (const bad of ['', 'ABC', `${code}X`, 'UUUU-UUUU-UUUU', 42, null]) expect(hashVaultGiftCode(bad, key)).toBeUndefined();
    expect(vaultMoney(2_500, 'EUR')).toBe('€25');
    expect(vaultMoney(3_050, 'GBP')).toBe('£30.50');
    expect(vaultMoney(100_000_00, 'USD')).toBe('$100 000');
    expect(vaultMoney(2_500, 'CHF')).toBe('CHF 25');
    expect(vaultOpenedWords({ prize: '€25', line: VAULT_REVEAL.credit, where: 'ACCOUNT' })).toEqual({ title: 'FROM THE VAULT', body: 'Your vault held €25 · House credit, valid 30 days. It is in YOUR ACCOUNT.' });
    expect(vaultOpenedWords({ prize: 'POLISHING CLOTH', line: VAULT_REVEAL.addon, where: 'ORDERS' }).body).toBe('Your vault held POLISHING CLOTH · Free on your next order. It is in YOUR ORDERS.');
    expect(vaultOpenedWords({ prize: 'I WAS THERE', line: VAULT_REVEAL.card.other, where: 'NONE' }).body).toBe('Your vault held I WAS THERE · Your card. Save it. It is under THE VAULT.');
    for (const w of [VAULT_REVEAL.credit, VAULT_REVEAL.addon, VAULT_REVEAL.guaranteed.line, VAULT_REVEAL.rightToBuy, VAULT_REVEAL.free, VAULT_REVEAL.toGive.line, VAULT_REVEAL.card.release]) {
      expect(w).not.toMatch(/house kept|set aside|paid|odds/i);
    }
    // OP-22, word for word; the reference's demo lines (plan §3.11).
    expect(VAULT_REVEAL.guaranteed).toEqual({ prize: 'GUARANTEED', line: 'A piece at the next LIVE release.' });
    expect(VAULT_REVEAL.thePiece.line('MONOLITHE IN BLUE', '52')).toBe('MONOLITHE IN BLUE, size 52. Free.');
    expect(VAULT_REVEAL.toGive.prize('€30')).toBe('€30 TO GIVE');
  });

  it('draws with crypto.randomInt alone, never Math.random', () => {
    const source = readFileSync(new URL('../../src/server/services/vault.ts', import.meta.url), 'utf8');
    expect(source).toContain('randomInt(max)');
    expect(source).not.toMatch(/Math\.random/);
  });
});

describe('THE VAULT’s opening: the draw (VaultService.open)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let staff: Actor & { id: string };
  /** The next draw's figure, and how many draws were made. */
  let next = 0;
  let draws = 0;
  let opener: VaultService;
  let france: string;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    staff = f.admin as Actor & { id: string };
    opener = new VaultService({
      db: t.db,
      audit: ctx.audit,
      profiles: ctx.services.profiles,
      clock: clock.now,
      random: (max) => {
        expect(max).toBe(VAULT_DRAW_PARTS);
        draws++;
        return next;
      },
    });
    france = (await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const vault = () => ctx.services.vault;
  const houseVault = async (accountId: string) => (await vault().give({ source: 'HOUSE', accountId, giftId: randomUUID(), givenBy: staff.id })).vaults[0]!;
  const rowOf = (id: string) => t.db.selectFrom('vault_rewards').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const vaultRow = (id: string) => t.db.selectFrom('vaults').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const floorRow = () => t.db.selectFrom('vault_rewards').selectAll().where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
  const receipts = (accountId: string) => t.db.selectFrom('house_deliveries').selectAll().where('account_id', '=', accountId).where('dedupe_key', 'like', 'VAULT_OPENED:%').execute();
  const opens = (vaultId: string) => t.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', 'vault.open').where('target_id', '=', vaultId).execute();

  it('draws on the server, writes the outcome once, gives its row one more, delivers it and says so FROM ORBES; the card when the floor is drawn, at its published odds', async () => {
    const credit = (await vault().createReward({ kind: 'CREDIT', oddsIn: 10, quantity: 1, amountMinor: 2_500, currency: 'EUR' }, staff)).rewards.find((r) => r.kind === 'CREDIT')!;
    await vault().createReward({ kind: 'CREDIT_TO_GIVE', oddsIn: 4, quantity: 100, amountMinor: 3_000, currency: 'EUR' }, staff);
    await vault().createReward({ kind: 'GUARANTEED', oddsIn: 200, quantity: 5 }, staff);
    // The card holds what the table leaves: 1 000 000 − 100 000 − 250 000 − 5 000 = 645 000 parts, published 1 IN 2.
    expect((await vault().settings()).floor).toMatchObject({ parts: 645_000, oddsText: '1 IN 2' });

    const a = await createAccount(t.db);
    const first = await houseVault(a.id);
    next = 0;
    const before = draws;
    const now = clock.now();
    const reveal = await opener.open(a.id, first.id);
    expect(draws).toBe(before + 1);
    expect(reveal).toEqual({ vaultId: first.id, kind: 'CREDIT', prize: '€25', line: 'House credit, valid 30 days.', odds: '1 IN 10', rare: false, where: 'ACCOUNT', openedAt: now, giftCode: null });
    const v = await vaultRow(first.id);
    expect(v).toMatchObject({ reward_id: credit.id, reward_kind: 'CREDIT', prize: '€25', prize_line: 'House credit, valid 30 days.', odds_text: '1 IN 10', rare: false, value_minor: 2_500, currency: 'EUR', cost_minor: 2_500, guarantee_id: null, gift_id: null, offer_until: null });
    expect(v.opened_at).toEqual(now);
    expect(v.grant_id).not.toBeNull();
    expect((await rowOf(credit.id)).given).toBe(1);
    expect((await receipts(a.id)).map((d) => [d.source, d.dedupe_key, d.title, d.body])).toEqual([
      ['VAULT', `VAULT_OPENED:${first.id}`, 'FROM THE VAULT', 'Your vault held €25 · House credit, valid 30 days. It is in YOUR ACCOUNT.'],
    ]);
    expect(await opens(first.id)).toEqual([
      { actor_type: 'account', actor_id: a.id, details: { source: 'HOUSE', kind: 'CREDIT', rare: false, rewardId: credit.id, grantId: v.grant_id } },
    ]);

    // Opened again (a lost answer, a second press): its outcome, never a second draw, no second message.
    next = 999_999;
    expect(await opener.open(a.id, first.id)).toEqual(reveal);
    expect(draws).toBe(before + 1);
    expect((await rowOf(credit.id)).given).toBe(1);
    expect(await receipts(a.id)).toHaveLength(1);
    expect(await opens(first.id)).toHaveLength(1);

    // Each branch by its parts: CREDIT TO GIVE from 100 000, GUARANTEED (rare) from 350 000, the card from 355 000.
    const b = await createAccount(t.db);
    next = 100_000;
    expect(await opener.open(b.id, (await houseVault(b.id)).id)).toMatchObject({ kind: 'CREDIT_TO_GIVE', prize: '€30 TO GIVE', line: 'For a friend’s first piece.', odds: '1 IN 4', rare: false, where: 'ACCOUNT' });
    next = 354_999;
    expect(await opener.open(b.id, (await houseVault(b.id)).id)).toMatchObject({ kind: 'GUARANTEED', prize: 'GUARANTEED', line: 'A piece at the next LIVE release.', odds: '1 IN 200', rare: true, where: 'ACCOUNT' });
    next = 355_000;
    const floorBefore = (await floorRow()).given;
    const card = await opener.open(b.id, (await houseVault(b.id)).id);
    expect(card).toMatchObject({ kind: 'I_WAS_THERE', prize: 'I WAS THERE', line: 'Your card. Save it.', odds: '1 IN 2', rare: false, where: 'NONE', giftCode: null });
    expect((await floorRow()).given).toBe(floorBefore + 1);
  });

  it('sends a row that runs out to the card at the card’s published odds, which never change; the row given stays as it was', async () => {
    const credit = (await vault().settings()).rewards.find((r) => r.kind === 'CREDIT')!;
    expect(credit).toMatchObject({ quantity: 1, given: 1, left: 0 });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const floorBefore = (await floorRow()).given;
    next = 0;
    const reveal = await opener.open(a.id, v.id);
    // Drawn: the credit (1 IN 10), run out: the card, at its own published odds, never the credit's.
    expect(reveal).toMatchObject({ kind: 'I_WAS_THERE', prize: 'I WAS THERE', odds: '1 IN 2', rare: false, where: 'NONE' });
    expect(await vaultRow(v.id)).toMatchObject({ reward_kind: 'I_WAS_THERE', odds_text: '1 IN 2', grant_id: null, value_minor: null, cost_minor: 0 });
    expect((await rowOf(credit.id)).given).toBe(1);
    expect((await floorRow()).given).toBe(floorBefore + 1);
    expect((await opens(v.id))[0]!.details).toMatchObject({ kind: 'I_WAS_THERE', toTheCard: true });
    // The table's published odds are unchanged by it: the card still 1 IN 2, the credit still 1 IN 10.
    const s = await vault().settings();
    expect(s.floor.oddsText).toBe('1 IN 2');
    expect(s.rewards.find((r) => r.id === credit.id)).toMatchObject({ oddsText: '1 IN 10', active: true });
    // The card's line names a release only for a LIVE vault (N4).
    const blue = await t.db.insertInto('models').values({ category_id: 1, name: 'MONOLITHE', variant_label: 'Blue', variant_swatch: '#1F3A5F', type: 'RING', sku_prefix: `MON-${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow();
    const r = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + HOUR), modelId: blue.id });
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', r.id).execute();
    const start = clock.now();
    clock.set(new Date(start.getTime() + HOUR - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const live = (await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).vaults[0]!;
    next = VAULT_DRAW_PARTS - 1;
    expect(await opener.open(a.id, live.id)).toMatchObject({ kind: 'I_WAS_THERE', line: 'Your card for this release. Save it.' });
  });

  it('refuses another account’s vault (404), an expired one, a returned piece’s, a locked account; unknown ids read as not found', async () => {
    const a = await createAccount(t.db);
    const other = await createAccount(t.db);
    const v = await houseVault(a.id);
    await expect(opener.open(other.id, v.id)).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND', httpStatus: 404 });
    await expect(opener.open(a.id, randomUUID())).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
    await expect(opener.open('nope', v.id)).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
    await expect(opener.open(a.id, 'nope')).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
    // Past its 30 days.
    await expect(opener.open(a.id, v.id, new Date(new Date(v.waitsUntil).getTime()))).rejects.toMatchObject({ code: 'VAULT_EXPIRED', httpStatus: 409 });
    // A returned piece's.
    const [p] = await holdPieces(t.db, a.id, 1, f.modelId);
    const piece = (await vault().give({ source: 'PIECE', accountId: a.id, productId: p! })).vaults[0]!;
    await t.db.updateTable('vaults').set({ revoked_at: clock.now(), revoked_reason: 'RETURNED' }).where('id', '=', piece.id).execute();
    await expect(opener.open(a.id, piece.id)).rejects.toMatchObject({ code: 'VAULT_REVOKED', httpStatus: 409 });
    // A locked account.
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
    await expect(opener.open(a.id, v.id)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', httpStatus: 403 });
    await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', a.id).execute();
    expect((await vaultRow(v.id)).opened_at).toBeNull();
  });

  it('tells which rows can give (plan §2.2): its quantity, its add-on (never a service), its model, its usual price, a unit to reserve, THE PIECE only for a LIVE vault', async () => {
    const a = await createAccount(t.db);
    const v = await vaultRow((await houseVault(a.id)).id);
    const base: Omit<DrawRow, 'kind'> = { id: randomUUID(), odds_in: 10, quantity: null, given: 0, amount_minor: null, currency: null, model_id: null, addon_id: null, mode: null, line: null, position: 1, created_at: clock.now() };
    const pick = (row: Partial<DrawRow> & { kind: VaultRewardKind }, onto = v) => inTransaction(t.db, (tx) => rewardPick(tx, { ...base, ...row }, onto));
    expect(await pick({ kind: 'GUARANTEED', quantity: 3, given: 3 })).toEqual({ ok: false, why: 'QUANTITY' });
    expect(await pick({ kind: 'GUARANTEED', quantity: 3, given: 2 })).toMatchObject({ ok: true });
    // An add-on set aside, or a service (E7: never one; the table refuses it, a row may still name one changed since).
    const cloth = await ctx.services.addons.create({ name: 'POLISHING CLOTH', skuCode: `ADD-CLOTH-${randomUUID().slice(0, 6)}`, prices: { EUR: 1_500 }, weightG: 20 }, staff);
    const wrap = await ctx.services.addons.create({ kind: 'SERVICE', name: 'GIFT WRAPPING', skuCode: `ADD-WRAP-${randomUUID().slice(0, 6)}`, prices: { EUR: 500 }, offeredAt: { live: true, draw: true, salon: true, orders: true } }, staff);
    expect(await pick({ kind: 'ADDON', addon_id: cloth.id })).toEqual({ ok: true, prize: 'POLISHING CLOTH', line: 'Free on your next order.', addonId: cloth.id });
    expect(await pick({ kind: 'PRODUCT', addon_id: cloth.id, mode: 'RIGHT_TO_BUY' })).toMatchObject({ ok: true, line: 'Yours to buy at its price, for 24 hours.' });
    expect(await pick({ kind: 'ADDON', addon_id: wrap.id })).toEqual({ ok: false, why: 'ADDON' });
    expect(await pick({ kind: 'PRODUCT', addon_id: wrap.id, mode: 'FREE' })).toEqual({ ok: false, why: 'ADDON' });
    await t.db.updateTable('addon_items').set({ active: false }).where('id', '=', cloth.id).execute();
    expect(await pick({ kind: 'ADDON', addon_id: cloth.id })).toEqual({ ok: false, why: 'ADDON' });
    // A model: offered, not vault-only for a PRODUCT, vault-only for a VAULT EDITION; under its RIGHT TO BUY, a usual
    // price to buy it at; won FREE, a unit to reserve (step Q3.7: the unit itself, its SKU locked).
    const model = await createModel(t.db, 'ECLIPSE');
    expect(await pick({ kind: 'PRODUCT', model_id: model, mode: 'RIGHT_TO_BUY' })).toEqual({ ok: false, why: 'PRICE' });
    await t.db.updateTable('models').set({ base_price_minor: 120_000, base_currency: 'EUR' }).where('id', '=', model).execute();
    expect(await pick({ kind: 'PRODUCT', model_id: model, mode: 'RIGHT_TO_BUY' })).toEqual({ ok: true, prize: 'ECLIPSE', line: 'Yours to buy at its price, for 24 hours.' });
    expect(await pick({ kind: 'PRODUCT', model_id: model, mode: 'FREE' })).toEqual({ ok: false, why: 'NO_UNIT' });
    expect(await pick({ kind: 'VAULT_EDITION', model_id: model })).toEqual({ ok: false, why: 'MODEL' });
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, model, '52'));
    await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted.' }, staff);
    const unit = { modelId: model, skuId: sku, label: '52', locationId: france };
    expect(await pick({ kind: 'PRODUCT', model_id: model, mode: 'FREE' })).toEqual({ ok: true, prize: 'ECLIPSE', line: 'Yours, free. In YOUR ORDERS.', unit });
    await t.db.updateTable('models').set({ vault_only: true }).where('id', '=', model).execute();
    expect(await pick({ kind: 'PRODUCT', model_id: model, mode: 'RIGHT_TO_BUY' })).toEqual({ ok: false, why: 'MODEL' });
    // The reveal says the kind, as the reference's REWARDS, without its number (SCOPE ROUND 5 "Numbers: REMOVE").
    expect(await pick({ kind: 'VAULT_EDITION', model_id: model })).toEqual({ ok: true, prize: 'VAULT EDITION', line: 'Made only for the vault. Free.', unit });
    expect(await pick({ kind: 'VAULT_EDITION', model_id: model, line: 'Made only for the vault, never sold.' })).toMatchObject({ ok: true, prize: 'VAULT EDITION', line: 'Made only for the vault, never sold.' });
    await t.db.updateTable('models').set({ active: false }).where('id', '=', model).execute();
    expect(await pick({ kind: 'VAULT_EDITION', model_id: model })).toEqual({ ok: false, why: 'MODEL' });
    // THE PIECE: never for a vault without a release (N5); a LIVE vault's, a unit of its model in the entry's size.
    expect(await pick({ kind: 'THE_PIECE' })).toEqual({ ok: false, why: 'NOT_LIVE' });
    const ring = await createModel(t.db, 'ANNEAU');
    const r = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + HOUR), modelId: ring, sizes: [{ label: '54', stock: 1 }] });
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', r.id).execute();
    const start = clock.now();
    clock.set(new Date(start.getTime() + HOUR - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const live = await vaultRow((await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).vaults[0]!.id);
    expect(await pick({ kind: 'THE_PIECE' }, live)).toEqual({ ok: false, why: 'NO_UNIT' });
    const other = await inTransaction(t.db, (tx) => ensureSku(tx, ring, '56'));
    await ctx.services.stock.adjust({ skuId: other, locationId: france, delta: 1, note: 'Counted.' }, staff);
    expect(await pick({ kind: 'THE_PIECE' }, live)).toEqual({ ok: false, why: 'NO_UNIT' });
    const own = await inTransaction(t.db, (tx) => ensureSku(tx, ring, '54'));
    await ctx.services.stock.adjust({ skuId: own, locationId: france, delta: 1, note: 'Counted.' }, staff);
    expect(await pick({ kind: 'THE_PIECE' }, live)).toEqual({ ok: true, prize: 'THE PIECE', line: 'ANNEAU, size 54. Free.', unit: { modelId: ring, skuId: own, label: '54', locationId: france } });
  });

  it('gives the card in place of a row that cannot give: a product won free with no unit to reserve', async () => {
    // The table: a free piece of a model without a unit, alone above the floor (the others made inactive).
    for (const r of (await vault().settings()).rewards) if (r.kind !== 'I_WAS_THERE' && r.active) await vault().deactivateReward(r.id, staff);
    const model = await createModel(t.db, 'ORBITE');
    await inTransaction(t.db, (tx) => ensureSku(tx, model, null));
    const product = (await vault().createReward({ kind: 'PRODUCT', oddsIn: 2, quantity: 5, modelId: model, mode: 'FREE' }, staff)).rewards.find((r) => r.kind === 'PRODUCT' && r.active)!;
    const a = await createAccount(t.db);
    next = 0;
    const v = await houseVault(a.id);
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'I_WAS_THERE', odds: '1 IN 2' });
    expect((await rowOf(product.id)).given).toBe(0);
    expect(await vaultRow(v.id)).toMatchObject({ order_id: null, offer_until: null });
  });
});

// ── Under concurrency ──────────────────────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

const BACKENDS: { name: string; skip: boolean; open(): Promise<{ db: Db; close(): Promise<void> }> }[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const admin = createDb(adminUrl!);
      const name = `orbes_vault_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        },
      };
    },
  },
];

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`THE VAULT’s giving on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    beforeAll(async () => {
      ({ db, close } = await backend.open());
    }, 60_000);
    afterAll(() => close?.());

    it('four processes giving one occasion give one vault and one message; two occasions at once of one account each give theirs; two opens at once draw once', async () => {
      const clock = createManualClock('2026-11-02T09:00:00.000Z');
      const services = [0, 1, 2, 3].map(() => {
        const audit = new AuditService({ db, clock: clock.now });
        return new VaultService({ db, audit, profiles: new ProfileService({ db, audit, tastes: new TasteService({ db, clock: clock.now }), clock: clock.now }), clock: clock.now });
      });
      await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
      const model = await createModel(db, 'MONOLITHE');
      const a = await createAccount(db);
      const [p] = await holdPieces(db, a.id, 1, model);
      const results = await Promise.all(services.map((s) => s.give({ source: 'PIECE', accountId: a.id, productId: p! })));
      expect(results.reduce((n, r) => n + r.vaults.length, 0)).toBe(1);
      expect(results.filter((r) => r.skipped === 'CAP')).toHaveLength(3);
      expect(await db.selectFrom('vaults').select('id').where('account_id', '=', a.id).execute()).toHaveLength(1);
      expect(await db.selectFrom('house_deliveries').select('id').where('account_id', '=', a.id).where('source', '=', 'VAULT').execute()).toHaveLength(1);
      expect(await db.selectFrom('audit_logs').select('id').where('action', '=', 'vault.give').where('target_id', '=', a.id).execute()).toHaveLength(1);
      const tiers = await Promise.all([1, 2, 3].map((tier) => services[tier]!.give({ source: 'TIER', accountId: a.id, tier: tier as 1 | 2 | 3 })));
      expect(tiers.map((r) => r.vaults.length)).toEqual([1, 1, 1]);

      // Two opens of one vault at once (step Q3.4): one draw, one outcome answered to both, one receipt.
      const [v] = (await services[0]!.give({ source: 'PROFILE', accountId: a.id })).vaults;
      const floor = await db.selectFrom('vault_rewards').select('given').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
      const [one, two] = await Promise.all([services[1]!.open(a.id, v!.id), services[2]!.open(a.id, v!.id)]);
      expect(one).toEqual(two);
      expect(one).toMatchObject({ kind: 'I_WAS_THERE', odds: '1 IN 1' });
      expect((await db.selectFrom('vault_rewards').select('given').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow()).given).toBe(floor.given + 1);
      expect(await db.selectFrom('house_deliveries').select('id').where('dedupe_key', '=', `VAULT_OPENED:${v!.id}`).execute()).toHaveLength(1);
      expect(await db.selectFrom('audit_logs').select('id').where('action', '=', 'vault.open').where('target_id', '=', v!.id).execute()).toHaveLength(1);
    });

    it('six openings at once never wait for each other on the table: a row of quantity 1 drawn by all is given exactly once, the others the card', async () => {
      const clock = createManualClock('2026-11-03T09:00:00.000Z');
      // Every draw lands on the table's first part: the CREDIT row below.
      const services = [0, 1, 2, 3, 4, 5].map(() => {
        const audit = new AuditService({ db, clock: clock.now });
        return new VaultService({ db, audit, profiles: new ProfileService({ db, audit, tastes: new TasteService({ db, clock: clock.now }), clock: clock.now }), clock: clock.now, random: () => 0 });
      });
      const email = `vault-staff-${randomUUID()}@orbes.test`;
      const staffId = (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
      const table = await services[0]!.createReward({ kind: 'CREDIT', oddsIn: 2, quantity: 1, amountMinor: 2500, currency: 'EUR' }, { type: 'admin', id: staffId });
      const row = table.rewards.find((r) => r.kind === 'CREDIT')!;
      const vaults: { account: string; vault: string }[] = [];
      for (let i = 0; i < 6; i++) {
        const a = await createAccount(db);
        vaults.push({ account: a.id, vault: (await services[0]!.give({ source: 'PROFILE', accountId: a.id })).vaults[0]!.id });
      }
      const reveals = await Promise.all(vaults.map((x, i) => services[i]!.open(x.account, x.vault)));
      expect(reveals.filter((r) => r.kind === 'CREDIT')).toHaveLength(1);
      expect(reveals.filter((r) => r.kind === 'I_WAS_THERE')).toHaveLength(5);
      expect((await db.selectFrom('vault_rewards').select('given').where('id', '=', row.id).executeTakeFirstOrThrow()).given).toBe(1);
      expect(await db.selectFrom('vaults').select('id').where('reward_id', '=', row.id).execute()).toHaveLength(1);
      await services[0]!.deactivateReward(row.id, { type: 'admin', id: staffId });
    });
  });
}
