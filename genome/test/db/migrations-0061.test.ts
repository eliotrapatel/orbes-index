/**
 * Migration 0061_the_vault (lot Q3, step Q3.1; plan §1.1, §1.3): THE VAULT's tables and columns, on PGlite here and on a
 * real PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL, a throwaway database; skipped without it), the same cases on
 * both:
 *  - the tiers held at the migration (`vault_occasions_before`, N7, N34, D68): on the demo, migration 0061 rolled back
 *    and applied again, a five-piece account holds TIER:1 and TIER:2, a ten-piece one the three, a test entrant nothing,
 *    and each key's count is the club's members at that tier and above (`clubMembersByTier`, test entrants left out);
 *    the SQL's thresholds and excluded statuses are services/club.ts's;
 *  - down to 0060 without rows: exactly the schema of 0060 (PGlite: against a database migrated to 0060 alone), and up
 *    again the latest;
 *  - the seven sources with OP-29's defaults and the I WAS THERE floor inserted; every CHECK, key and trigger of
 *    `vault_sources`, `vault_rewards` (a SERVICE add-on refused as a reward, E7/D64; the floor never deleted nor made
 *    inactive; a reward given never deleted), `vaults` (each source's own occasion, a second vault for one occasion
 *    refused, a vault revoked then given again accepted, RETURNED the only reason and on a PIECE vault only, an opened
 *    vault never revoked, its outcome never rewritten, never deleted), `drops.vault_on` (refused on a draw and an
 *    after-room), `models.vault_only`, `accounts.invited_by` (set once), `invitations` and a VAULT house delivery;
 *  - down refused while any of them exists, naming the counts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { testConfig } from '../../src/server/config.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import * as m0061 from '../../src/server/db/migrations/0061_the_vault.js';
import { isCheckViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { jsonText, VAULT_SOURCES } from '../../src/server/db/schema.js';
import { DEMO_ACCOUNTS, DEMO_TIMELINE_START, seedDemo } from '../../src/server/db/seed/demo.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { activePieceCount, CLUB_EXCLUDED_STATUSES, CLUB_TIER_THRESHOLDS, clubMembersByTier } from '../../src/server/services/club.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, createLiveRelease, holdPieces, liveFixture } from '../support/live.js';

const BEFORE = '0060_release_addons_converted';
const NAME = '0061_the_vault';
/**
 * The migrations after it (lot Q3, step Q3.2: the vault's rewards; lot M4, steps M4.1, M4.5 and M4.9: the margin's settings,
 * the partners, the ad conversions), taken down first and applied again with it.
 */
const LATER = '0062_vault_rewards';
const MARGIN = '0063_margin';
const PARTNERS = '0064_partners';
const LATEST = '0065_ad_conversions';
/** Lot PURGE, step PURGE.2: the test purge, taken down first and applied again with the others. */
const PURGE = '0066_test_purge';
/** Lot PURGE, step PURGE.8: the platform reset, taken down first and applied again with the others. */
const RESET = '0067_platform_reset';
const NOW = new Date('2026-10-01T09:00:00.000Z');
const DAY = 86_400_000;
const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;

/** Every column, index, constraint and trigger of the public schema (as test/db/migrations.test.ts reads it). */
async function snapshotOf(db: Kysely<any>): Promise<string[]> {
  return (
    await sql<{ object: string }>`
      SELECT 'table ' || table_name || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS object
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
      UNION ALL SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%'
      UNION ALL SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
      ORDER BY 1`.execute(db)
  ).rows.map((r) => r.object);
}

/** Down to 0060 (0067, 0066, 0065, 0064, 0063, 0062, then 0061, reverted). */
async function downTo0060(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** What names an object of 0061 in a snapshot. */
const VAULT_OBJECTS = /\b(vault_\w+|vaults\w*|invitations\w*|invited_\w+|accounts_invited\w*|orbes_vault\w*)\b/;

/**
 * The cases, on a database at the latest migration with no business data; `ctx` its application context once
 * `beforeAll` made it. They run in order: the demo first (0061 rolled back and applied again on it), then the down to
 * 0060 without rows, then the rows, then the down refused.
 */
function cases(state: { db: () => Db; ctx: () => AppContext; clock: () => ManualClock; schemaAt0060: () => Promise<string[] | null> }) {
  const db = () => state.db();

  it('holds, on the demo, each account\'s tiers at the migration: a five-piece account TIER:1 and TIER:2, a ten-piece one the three, a test entrant nothing, each key\'s count the club\'s members at that tier and above', async () => {
    // The SQL's literals are the club's.
    expect([...m0061.TIER_THRESHOLDS]).toEqual([...CLUB_TIER_THRESHOLDS]);
    expect([...m0061.EXCLUDED_STATUSES]).toEqual([...CLUB_EXCLUDED_STATUSES]);
    expect(m0061.OCCASIONS_BEFORE_INSERT).toContain(`(VALUES (1, ${CLUB_TIER_THRESHOLDS[0]}), (2, ${CLUB_TIER_THRESHOLDS[1]}), (3, ${CLUB_TIER_THRESHOLDS[2]}))`);
    await seedDemo(state.ctx(), { clock: state.clock(), now: NOW, accountPassword: 'demo-account-password-2026' });
    const accounts = await db().selectFrom('accounts').select(['id', 'email', 'status']).where('email', 'in', DEMO_ACCOUNTS.map((a) => a.email)).execute();
    const byEmail = new Map(accounts.map((a) => [a.email, a]));
    const lucas = byEmail.get('lucas.weber@example.com')!;
    const camille = byEmail.get('camille.martin@example.com')!;
    expect(await activePieceCount(db(), lucas.id)).toBe(5);
    expect(await activePieceCount(db(), camille.id)).toBe(10);
    // A collector holding a piece made a test entrant: it never gets a vault, so nothing is written for it.
    let entrant: string | undefined;
    for (const a of accounts) {
      if (a.id !== lucas.id && a.id !== camille.id && (await activePieceCount(db(), a.id)) >= 1) {
        entrant = a.id;
        break;
      }
    }
    expect(entrant).toBeDefined();
    await db().insertInto('test_entrants').values({ account_id: entrant! }).execute();
    expect(accounts.every((a) => a.status === 'ACTIVE')).toBe(true);

    // 0061 rolled back and applied again on the demo: `up` writes the tiers held then. The demo's example rewards (step
    // Q3.12, OP-27), never given, are taken out first: `down` refuses while a reward other than the floor exists.
    await db().deleteFrom('vault_rewards').where('kind', '<>', 'I_WAS_THERE').where('given', '=', 0).execute();
    expect(await downTo0060(db())).toEqual([RESET, PURGE, LATEST, PARTNERS, MARGIN, LATER, NAME]);
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER, MARGIN, PARTNERS, LATEST, PURGE, RESET]);
    const keys = async (account: string) =>
      (await db().selectFrom('vault_occasions_before').select('occasion_key').where('account_id', '=', account).orderBy('occasion_key').execute()).map((r) => r.occasion_key);
    expect(await keys(lucas.id)).toEqual(['TIER:1', 'TIER:2']);
    expect(await keys(camille.id)).toEqual(['TIER:1', 'TIER:2', 'TIER:3']);
    expect(await keys(entrant!)).toEqual([]);
    const counts = Object.fromEntries(
      (await db().selectFrom('vault_occasions_before').select((eb) => ['occasion_key', eb.fn.countAll<number>().as('n')]).groupBy('occasion_key').execute()).map((r) => [r.occasion_key, Number(r.n)]),
    );
    const members = await clubMembersByTier(db(), CLUB_TIER_THRESHOLDS, { withoutTestEntrants: true });
    expect(members.PLATINE).toBeGreaterThanOrEqual(1);
    expect(counts).toEqual({ 'TIER:1': members.total, 'TIER:2': members.PLATINE + members.PALLADIUM, 'TIER:3': members.PALLADIUM });
  }, 240_000);

  it('rolls back to the schema of 0060 exactly without rows, and applies again to the latest', async () => {
    const latest = await snapshotOf(db());
    // 0067, 0066, 0065, 0064, 0063 and 0062 down first: the schema 0061 left, which this case reads.
    const rs = await createMigrator(db()).migrateTo(NAME);
    if (rs.error) throw rs.error;
    const at0061 = await snapshotOf(db());
    expect(at0061.filter((o) => VAULT_OBJECTS.test(o)).length).toBeGreaterThan(20);
    expect(await downTo0060(db())).toEqual([NAME]);
    const without = await snapshotOf(db());
    expect(without.filter((o) => VAULT_OBJECTS.test(o))).toEqual([]);
    const at0060 = await state.schemaAt0060();
    if (at0060) expect(without).toEqual(at0060);
    // What 0061 added, beside its own tables: its columns and constraints on drops, models, accounts and house_deliveries.
    const added = at0061.filter((o) => !without.includes(o) && !/^(table|index|constraint|trigger) (vault_|vaults|invitations)/.test(o) && !/^index CREATE (UNIQUE )?INDEX (vault_|vaults|invitations)/.test(o));
    expect(added.filter((o) => o.startsWith('table ')).sort()).toEqual([
      'table accounts invited_at timestamp with time zone YES ',
      'table accounts invited_by uuid YES ',
      'table drops vault_on boolean NO false',
      'table models vault_only boolean NO false',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger accounts accounts_invited_once']);
    expect(added.filter((o) => o.startsWith('constraint house_deliveries ')).map((o) => o.split(' ')[2]).sort()).toEqual(['house_deliveries_source', 'house_deliveries_source_check']);
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER, MARGIN, PARTNERS, LATEST, PURGE, RESET]);
    expect(await snapshotOf(db())).toEqual(latest);
  });

  it('inserts the seven sources with OP-29\'s defaults and the I WAS THERE floor; a source keeps its name, is never deleted, and its limits are bounded', async () => {
    const sources = await db().selectFrom('vault_sources').select(['source', 'enabled', 'per_occasion', 'cap', 'updated_by']).execute();
    expect(sources.sort((a, b) => VAULT_SOURCES.indexOf(a.source) - VAULT_SOURCES.indexOf(b.source))).toEqual(
      VAULT_SOURCES.map((source) => ({ source, enabled: true, per_occasion: 1, cap: source === 'HOUSE' ? null : 1, updated_by: null })),
    );
    expect(await db().selectFrom('vault_rewards').select(['kind', 'odds_in', 'quantity', 'given', 'active', 'position', 'amount_minor', 'model_id', 'addon_id', 'mode', 'line', 'created_by']).execute()).toEqual([
      { kind: 'I_WAS_THERE', odds_in: null, quantity: null, given: 0, active: true, position: 0, amount_minor: null, model_id: null, addon_id: null, mode: null, line: null, created_by: null },
    ]);
    const set = (v: Record<string, unknown>, source = 'LIVE') => db().updateTable('vault_sources').set(v as never).where('source', '=', source as never).execute();
    await expect(set({ per_occasion: 0 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_sources_per_occasion_check'));
    await expect(set({ per_occasion: 11 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_sources_per_occasion_check'));
    await expect(set({ cap: 0 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_sources_cap_check'));
    await expect(set({ cap: 101 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_sources_cap_check'));
    await expect(set({ cap: 1 }, 'HOUSE')).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_sources_house_cap'));
    await expect(sql`UPDATE vault_sources SET source = 'PIECE' WHERE source = 'LIVE'`.execute(db())).rejects.toSatisfy(isGuardViolation);
    await expect(db().deleteFrom('vault_sources').where('source', '=', 'PROFILE').execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db().insertInto('vault_sources').values({ source: 'BIRTHDAY' as never }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_sources_source_check'));
    // Every limit a setting (OP-29): no cap, or several per occasion.
    await set({ cap: null, per_occasion: 10 }, 'WORN');
    await set({ enabled: false }, 'PROFILE');
  });

  it('holds the one house table: each kind with its own fields, a SERVICE add-on never a reward, the floor once and never inactive nor deleted, a reward given never deleted', async () => {
    const f = await liveFixture(db(), '2026-11-20T10:00:00.000Z');
    const product = await db().insertInto('addon_items').values({ name: 'TRAVEL CASE V0061' }).returning('id').executeTakeFirstOrThrow();
    const service = await db().insertInto('addon_items').values({ name: 'ENGRAVING V0061', kind: 'SERVICE', engraving: true }).returning('id').executeTakeFirstOrThrow();
    const wrapping = await db().insertInto('addon_items').values({ name: 'GIFT WRAPPING V0061', kind: 'SERVICE' }).returning('id').executeTakeFirstOrThrow();
    const reward = (v: Record<string, unknown>) => db().insertInto('vault_rewards').values(v as never).returning(['id', 'given', 'active', 'position']).executeTakeFirstOrThrow();
    const by = { created_by: f.admin.id, updated_by: f.admin.id };
    const credit = await reward({ kind: 'CREDIT', odds_in: 200, quantity: 10, amount_minor: 2500, currency: 'EUR', position: 1, ...by });
    expect(credit).toEqual({ id: expect.any(String), given: 0, active: true, position: 1 });
    await reward({ kind: 'ADDON', odds_in: 50, quantity: 5, addon_id: product.id, position: 2, ...by });
    await reward({ kind: 'GUARANTEED', odds_in: 2000, quantity: 1, position: 3, ...by });
    await reward({ kind: 'PRODUCT', odds_in: 1000, quantity: 1, model_id: f.modelId, mode: 'FREE', position: 4, ...by });
    await reward({ kind: 'PRODUCT', odds_in: 100, quantity: 3, addon_id: product.id, mode: 'RIGHT_TO_BUY', position: 5, ...by });
    await reward({ kind: 'VAULT_EDITION', odds_in: 5000, quantity: 1, model_id: f.modelId, line: 'Made only for the vault, never sold.', position: 6, ...by });
    await reward({ kind: 'THE_PIECE', odds_in: 10000, quantity: 1, position: 7, ...by });
    await reward({ kind: 'CREDIT_TO_GIVE', odds_in: 400, quantity: 20, amount_minor: 3000, currency: 'EUR', position: 8, ...by });

    // No access, status or service reward (E7, D64): a SERVICE add-on refused as an ADDON or a PRODUCT, at insert and at update.
    for (const v of [{ kind: 'ADDON', addon_id: service.id }, { kind: 'PRODUCT', addon_id: wrapping.id, mode: 'FREE' }]) {
      await expect(reward({ odds_in: 10, quantity: 1, ...v })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_addon_product'));
    }
    const addon = await reward({ kind: 'ADDON', odds_in: 60, quantity: 1, addon_id: product.id });
    await expect(db().updateTable('vault_rewards').set({ addon_id: wrapping.id }).where('id', '=', addon.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_addon_product'));
    // Each kind with its own fields.
    await expect(reward({ kind: 'CREDIT', odds_in: 10, quantity: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_amount'));
    await expect(reward({ kind: 'GUARANTEED', odds_in: 10, quantity: 1, amount_minor: 100, currency: 'EUR' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_amount'));
    await expect(reward({ kind: 'CREDIT', odds_in: 10, quantity: 1, amount_minor: 100 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_amount'));
    await expect(reward({ kind: 'CREDIT', quantity: 1, amount_minor: 100, currency: 'EUR' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_floor'));
    await expect(reward({ kind: 'CREDIT', odds_in: 10, amount_minor: 100, currency: 'EUR' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_floor'));
    await expect(reward({ kind: 'GUARANTEED', odds_in: 0, quantity: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_odds_in_check'));
    await expect(reward({ kind: 'GUARANTEED', odds_in: 1_000_001, quantity: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_odds_in_check'));
    // (A negative quantity breaks its own CHECK and the given ≤ quantity one: either may be read first.)
    await expect(reward({ kind: 'GUARANTEED', odds_in: 10, quantity: -1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_quantity_check') || isCheckViolation(e, 'vault_rewards_given_limit'));
    await expect(reward({ kind: 'PRODUCT', odds_in: 10, quantity: 1, model_id: f.modelId })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_mode'));
    await expect(reward({ kind: 'PRODUCT', odds_in: 10, quantity: 1, model_id: f.modelId, addon_id: product.id, mode: 'FREE' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_product'));
    await expect(reward({ kind: 'PRODUCT', odds_in: 10, quantity: 1, mode: 'FREE' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_product'));
    await expect(reward({ kind: 'VAULT_EDITION', odds_in: 10, quantity: 1, addon_id: product.id })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_product'));
    await expect(reward({ kind: 'THE_PIECE', odds_in: 10, quantity: 1, model_id: f.modelId })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_product'));
    await expect(reward({ kind: 'GUARANTEED', odds_in: 10, quantity: 1, mode: 'FREE' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_mode'));
    await expect(reward({ kind: 'PRODUCT', odds_in: 10, quantity: 1, model_id: f.modelId, mode: 'PAID' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_mode_check'));
    await expect(reward({ kind: 'GUARANTEED', odds_in: 10, quantity: 1, line: 'A line.' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_line'));
    await expect(reward({ kind: 'VAULT_EDITION', odds_in: 10, quantity: 1, model_id: f.modelId, line: 'x'.repeat(121) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_line_check'));
    await expect(reward({ kind: 'ACCESS', odds_in: 10, quantity: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_kind_check'));
    // The floor: once, never inactive, never deleted, never another kind.
    const floor = await db().selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
    await expect(reward({ kind: 'I_WAS_THERE' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'vault_rewards_floor_key'));
    await expect(reward({ kind: 'I_WAS_THERE', odds_in: 2, quantity: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_floor'));
    await expect(db().updateTable('vault_rewards').set({ active: false }).where('id', '=', floor.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_floor_active'));
    await expect(db().deleteFrom('vault_rewards').where('id', '=', floor.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`UPDATE vault_rewards SET kind = 'CREDIT_TO_GIVE' WHERE id = ${credit.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    // The quantity is the limit (OP-26); a reward given is only made inactive, one never given may go.
    await expect(db().updateTable('vault_rewards').set({ given: 11 }).where('id', '=', credit.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_rewards_given_limit'));
    await db().updateTable('vault_rewards').set({ given: 10 }).where('id', '=', credit.id).execute();
    await expect(db().deleteFrom('vault_rewards').where('id', '=', credit.id).execute()).rejects.toSatisfy(isGuardViolation);
    await db().updateTable('vault_rewards').set({ active: false }).where('id', '=', credit.id).execute();
    await db().deleteFrom('vault_rewards').where('id', '=', addon.id).execute();
    // The floor given: its count only (no limit).
    await db().updateTable('vault_rewards').set({ given: 3 }).where('id', '=', floor.id).execute();
  });

  it('holds each vault to its source\'s occasion, one per occasion and index while not revoked, 30 days to wait, RETURNED the only taking-back, the outcome written once, never deleted', async () => {
    const f = await liveFixture(db(), '2026-11-21T10:00:00.000Z');
    const account = await createAccount(db());
    const friend = await createAccount(db());
    const release = await createLiveRelease(f, { opensAt: new Date('2026-11-22T10:00:00Z') });
    const entry = await db()
      .insertInto('live_entries')
      .values({ drop_id: release.id, account_id: account.id, size_id: release.sizes[0]!.id, quantity: 1, tier: 1, status: 'QUEUED', position: 1, queued_at: new Date('2026-11-22T10:00:00Z') })
      .returning('id')
      .executeTakeFirstOrThrow();
    const [piece, second] = await holdPieces(db(), account.id, 2, f.modelId);
    const segment = await db().insertInto('segments').values({ name: `VAULT V0061 ${randomUUID().slice(0, 8)}`, criteria: jsonText({}), created_by: f.admin.id }).returning('id').executeTakeFirstOrThrow();
    const other = await db().insertInto('segments').values({ name: `VAULT V0061 ${randomUUID().slice(0, 8)}`, criteria: jsonText({}), created_by: f.admin.id }).returning('id').executeTakeFirstOrThrow();
    const floor = await db().selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
    const given = new Date('2026-11-21T10:00:00.000Z');
    const waits = new Date(given.getTime() + 30 * DAY);
    const give = (v: Record<string, unknown>) =>
      db().insertInto('vaults').values({ account_id: account.id, given_at: given, waits_until: waits, occasion_index: 1, ...v } as never).returning(['id', 'waits_until', 'opened_at', 'revoked_at']).executeTakeFirstOrThrow();

    const live = await give({ source: 'LIVE', drop_id: release.id, entry_id: entry.id, occasion_key: `LIVE:${release.id}` });
    expect(live).toEqual({ id: expect.any(String), waits_until: waits, opened_at: null, revoked_at: null });
    const pieceVault = await give({ source: 'PIECE', product_id: piece, occasion_key: `PIECE:${piece}` });
    const tier = await give({ source: 'TIER', tier: 2, occasion_key: 'TIER:2' });
    const profile = await give({ source: 'PROFILE', occasion_key: 'PROFILE' });
    await give({ source: 'FRIEND', friend_account_id: friend.id, occasion_key: `FRIEND:${friend.id}` });
    const house = await give({ source: 'HOUSE', given_by: f.admin.id, segment_id: segment.id, note: 'Thank you for the evening.', occasion_key: `HOUSE:${randomUUID()}` });
    await give({ source: 'HOUSE', given_by: f.admin.id, occasion_key: `HOUSE:${randomUUID()}` });

    // Each source its own occasion, its key held to its columns.
    const occasion = (v: Record<string, unknown>) => expect(give(v)).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_occasion'));
    await occasion({ source: 'LIVE', drop_id: release.id, occasion_key: `LIVE:${release.id}`, occasion_index: 2 });
    await occasion({ source: 'LIVE', drop_id: release.id, entry_id: entry.id, product_id: piece, occasion_key: `LIVE:${release.id}`, occasion_index: 2 });
    await occasion({ source: 'PIECE', product_id: second, occasion_key: `PIECE:${piece}` });
    await occasion({ source: 'TIER', tier: 3, occasion_key: 'TIER:2' });
    await occasion({ source: 'FRIEND', friend_account_id: account.id, occasion_key: `FRIEND:${account.id}` });
    await occasion({ source: 'PROFILE', occasion_key: 'PROFILE', product_id: piece, occasion_index: 2 });
    await occasion({ source: 'HOUSE', occasion_key: `HOUSE:${randomUUID()}` });
    await occasion({ source: 'HOUSE', given_by: f.admin.id, occasion_key: 'HOUSE:a gift' });
    await occasion({ source: 'TIER', tier: 1, note: 'A note.', occasion_key: 'TIER:1' });
    await occasion({ source: 'WORN', product_id: piece, occasion_key: `WORN:${piece}` });
    await expect(give({ source: 'TIER', tier: 4, occasion_key: 'TIER:4' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_tier_check'));
    await expect(give({ source: 'BIRTHDAY', occasion_key: 'BIRTHDAY' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_source_check') || isCheckViolation(e, 'vaults_occasion'));
    await expect(give({ source: 'TIER', tier: 1, occasion_key: 'TIER:1', occasion_index: 0 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_occasion_index_check'));
    // 30 days to wait, fixed (D17).
    await expect(give({ source: 'TIER', tier: 1, occasion_key: 'TIER:1', waits_until: new Date(given.getTime() + 29 * DAY) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_waits'));

    // One per occasion and index: a second pass never gives it twice; another index (per occasion above 1) is another vault.
    await expect(give({ source: 'TIER', tier: 2, occasion_key: 'TIER:2' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'vaults_occasion_key'));
    await expect(give({ source: 'LIVE', drop_id: release.id, entry_id: entry.id, occasion_key: `LIVE:${release.id}` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'vaults_occasion_key'));
    await give({ source: 'TIER', tier: 2, occasion_key: 'TIER:2', occasion_index: 2 });

    // Taken back: a returned piece only (D5, N36), RETURNED the only reason, both or neither; then the piece's vault given again.
    const revoke = (id: string, v: Record<string, unknown>) => db().updateTable('vaults').set(v as never).where('id', '=', id).execute();
    const at = new Date('2026-11-25T10:00:00.000Z');
    await expect(revoke(pieceVault.id, { revoked_at: at, revoked_reason: 'REVOKED' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_revoked_reason_check'));
    await expect(revoke(pieceVault.id, { revoked_at: at })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_revoked'));
    await expect(revoke(tier.id, { revoked_at: at, revoked_reason: 'RETURNED' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_revoked'));
    await revoke(pieceVault.id, { revoked_at: at, revoked_reason: 'RETURNED' });
    await expect(revoke(pieceVault.id, { revoked_at: null, revoked_reason: null })).rejects.toSatisfy(isGuardViolation);
    const again = await give({ source: 'PIECE', product_id: piece, occasion_key: `PIECE:${piece}` });

    // Opened once: the outcome with its opening, written once and never after; an opened vault is never taken back.
    const opened = { opened_at: at, reward_id: floor.id, reward_kind: 'I_WAS_THERE', prize: 'I WAS THERE', prize_line: 'The release and its date.', odds_text: '1 IN 1', rare: false };
    await expect(revoke(tier.id, { prize: 'I WAS THERE' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_outcome'));
    await expect(revoke(tier.id, { opened_at: at })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_outcome'));
    await expect(revoke(tier.id, { ...opened, odds_text: 'ONE IN 2' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_odds_text_check'));
    await expect(revoke(tier.id, { ...opened, value_minor: 2500 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_outcome'));
    await expect(revoke(again.id, { ...opened, revoked_at: at, revoked_reason: 'RETURNED' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_opened_or_revoked'));
    await revoke(again.id, opened);
    await expect(revoke(again.id, { revoked_at: at, revoked_reason: 'RETURNED' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_opened_or_revoked'));
    await revoke(profile.id, { ...opened, value_minor: 2500, currency: 'EUR', cost_minor: 2500 });
    await expect(revoke(profile.id, { prize: 'EUR 30' })).rejects.toSatisfy(isGuardViolation);
    await expect(revoke(profile.id, { opened_at: null })).rejects.toSatisfy(isGuardViolation);
    await expect(revoke(profile.id, { cost_minor: 0 })).rejects.toSatisfy(isGuardViolation);
    // What it was given for never changes; a segment's id is only cleared.
    await expect(revoke(tier.id, { occasion_key: 'TIER:3', tier: 3 })).rejects.toSatisfy(isGuardViolation);
    await expect(revoke(tier.id, { account_id: friend.id })).rejects.toSatisfy(isGuardViolation);
    await expect(revoke(house.id, { note: 'Another note.' })).rejects.toSatisfy(isGuardViolation);
    await expect(revoke(house.id, { segment_id: other.id })).rejects.toSatisfy(isGuardViolation);
    await revoke(house.id, { segment_id: null });
    // Never deleted.
    await expect(db().deleteFrom('vaults').where('id', '=', live.id).execute()).rejects.toSatisfy(isGuardViolation);
  });

  it('holds the switch on each LIVE release (refused on a draw and an after-room), the vault-only model, the inviter set once, the invitation\'s code and a vault\'s house message', async () => {
    const f = await liveFixture(db(), '2026-11-23T10:00:00.000Z');
    const release = await createLiveRelease(f, { opensAt: new Date('2026-11-24T10:00:00Z'), afterRoom: { modelId: f.modelId, sizes: [{ label: '52', stock: 1 }], priceMinor: 100_000 } as never });
    const draw = await poolDraw(f.drops, db(), { modelId: f.modelId, title: 'DRAW V0061', quantity: 2, opensAt: new Date('2026-11-25T10:00:00Z'), closesAt: new Date('2026-11-26T10:00:00Z'), earlyAccessHours: 0 }, f.admin, { publish: false });
    const vaultOn = (id: string) => db().updateTable('drops').set({ vault_on: true }).where('id', '=', id).execute();
    expect((await db().selectFrom('drops').select('vault_on').where('id', '=', release.id).executeTakeFirstOrThrow()).vault_on).toBe(false);
    await vaultOn(release.id);
    await expect(vaultOn(release.afterRoom!.id)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_vault_on'));
    await expect(vaultOn(draw.id)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_vault_on'));

    const model = await db().updateTable('models').set({ vault_only: true }).where('id', '=', f.modelId).returning('vault_only').executeTakeFirstOrThrow();
    expect(model.vault_only).toBe(true);

    const inviter = await createAccount(db());
    const invited = await createAccount(db());
    const someone = await createAccount(db());
    const invite = (id: string, v: Record<string, unknown>) => db().updateTable('accounts').set(v as never).where('id', '=', id).execute();
    await expect(invite(invited.id, { invited_by: inviter.id })).rejects.toSatisfy((e) => isCheckViolation(e, 'accounts_invited'));
    await expect(invite(invited.id, { invited_by: invited.id, invited_at: new Date() })).rejects.toSatisfy((e) => isCheckViolation(e, 'accounts_invited'));
    await invite(invited.id, { invited_by: inviter.id, invited_at: new Date('2026-11-23T10:05:00Z') });
    await expect(invite(invited.id, { invited_by: someone.id })).rejects.toSatisfy(isGuardViolation);
    await expect(invite(invited.id, { invited_by: null, invited_at: null })).rejects.toSatisfy(isGuardViolation);
    await expect(invite(invited.id, { invited_at: new Date('2026-11-24T10:05:00Z') })).rejects.toSatisfy(isGuardViolation);
    await invite(invited.id, { display_name: 'A FRIEND' });

    const code = 'ABCD2345EFGH';
    await db().insertInto('invitations').values({ account_id: inviter.id, code }).execute();
    for (const bad of ['ABCD2345EFGI', 'abcd2345efgh', 'ABCD2345EFG', 'ABCD-2345-EFGH']) {
      await expect(db().insertInto('invitations').values({ account_id: someone.id, code: bad }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'invitations_code_check'));
    }
    await expect(db().insertInto('invitations').values({ account_id: someone.id, code }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'invitations_code_key'));
    await expect(db().insertInto('invitations').values({ account_id: inviter.id, code: 'ZZZZ2345EFGH' }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'invitations_pkey'));
    await expect(sql`UPDATE invitations SET code = 'ZZZZ2345EFGH' WHERE account_id = ${inviter.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    await expect(db().deleteFrom('invitations').where('account_id', '=', inviter.id).execute()).rejects.toSatisfy(isGuardViolation);

    // A vault's arrival: its words rendered, no moment, no message, no piece reference.
    const vault = await db().selectFrom('vaults').select(['id', 'account_id']).where('source', '=', 'TIER').executeTakeFirstOrThrow();
    const delivery = { account_id: vault.account_id, source: 'VAULT', title: 'A VAULT IS WAITING FOR YOU', body: 'We have added a vault to your account.', dedupe_key: `VAULT:${vault.id}` };
    await expect(db().insertInto('house_deliveries').values({ ...delivery, moment: 'FIRST_REGISTRATION' } as never).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_deliveries_source'));
    await expect(db().insertInto('house_deliveries').values({ ...delivery, body: null } as never).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_deliveries_source'));
    await expect(db().insertInto('house_deliveries').values({ ...delivery, piece_ref: 'O26-J-00184' } as never).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_deliveries_source'));
    await expect(db().insertInto('house_deliveries').values({ ...delivery, source: 'LETTER' } as never).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_deliveries_source_check') || isCheckViolation(e, 'house_deliveries_source'));
    const row = await db().insertInto('house_deliveries').values(delivery as never).returning(['source', 'moment', 'house_message_id', 'piece_ref']).executeTakeFirstOrThrow();
    expect(row).toEqual({ source: 'VAULT', moment: null, house_message_id: null, piece_ref: null });
  });

  it('refuses to roll back while anything of the vault exists, naming the counts', async () => {
    const n = async (query: string) => Number((await sql<{ n: string | number }>`${sql.raw(`SELECT count(*) AS n FROM ${query}`)}`.execute(db())).rows[0]!.n);
    const vaults = await n('vaults');
    const rewards = await n(`vault_rewards WHERE kind <> 'I_WAS_THERE'`);
    expect(vaults).toBeGreaterThan(5);
    expect(rewards).toBeGreaterThan(5);
    await expect(downTo0060(db())).rejects.toThrow(
      `migration 0061_the_vault cannot be rolled back: ${vaults} vaults, 1 invitations, 1 invited accounts, 1 vault messages, ${rewards} vault rewards, 2 vault source settings, 1 releases with their vault on and 1 vault-only models exist`,
    );
    expect((await createMigrator(db()).getMigrations()).filter((m) => m.executedAt).map((m) => m.name).at(-1)).toBe(RESET);
  });
}

describe('migration 0061_the_vault (PGlite)', () => {
  let t: TestDb;
  let ctx: AppContext;
  const clock = createManualClock(DEMO_TIMELINE_START);
  beforeAll(async () => {
    t = await createTestDb();
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
  }, 120_000);
  afterAll(async () => {
    await ctx?.close();
    await t?.close();
  });
  cases({
    db: () => t.db,
    ctx: () => ctx,
    clock: () => clock,
    schemaAt0060: async () => {
      const fresh = await createTestDb({ migrated: false });
      try {
        const rs = await createMigrator(fresh.db).migrateTo(BEFORE);
        if (rs.error) throw rs.error;
        return await snapshotOf(fresh.db);
      } finally {
        await fresh.close();
      }
    },
  });
});

describe.skipIf(!pgUrl)('migration 0061_the_vault (PostgreSQL)', () => {
  let admin: Db;
  let db: Db;
  let ctx: AppContext;
  const clock = createManualClock(DEMO_TIMELINE_START);
  const dbName = `orbes_t_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = createDb(pgUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(pgUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 4 });
    await migrateToLatest(db);
    ctx = await createContext(testConfig(), { db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
  }, 120_000);
  afterAll(async () => {
    await ctx?.close();
    if (db) await closeDb(db).catch(() => undefined);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });
  cases({ db: () => db, ctx: () => ctx, clock: () => clock, schemaAt0060: async () => null });
});
