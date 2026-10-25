/**
 * THE VAULT's sources (lot Q3; plan §2.3, §2b; services/vault.ts, the hooks in the services that make each occasion).
 *
 * The LIVE source (step Q3.5; plan §2.3.1; S E2, round 2, ROUND 5: D4, D6, D7, D8, D9; N19, N20), on the LIVE services
 * as the console and the engine run them (PGlite, a manual clock): the PAY that sells a size out gives a vault to every
 * entry of that size still in the line (QUEUED, a late comer who joined and stayed included, WAITING too), in its
 * transaction, with its FROM ORBES arrival and its audit; never to a LEFT entry, an entry of another size, the buyer, a
 * test entrant or an account not ACTIVE; a 2+ piece entry its size can no longer serve gets none until the size is fully
 * paid (N19); a set's release by its sets; the whole release sold out gives every size's line its vault before the end
 * ENDS it (D6); a release that CLOSES with pieces left gives none, even when a hold pays its last piece after the close,
 * before or after the engine's pass at the close (D8); a long line is given in a few statements, never one per collector; the after-room gives none of its own and a piece won there never takes the vault back (D7, N20); the release's
 * switch off (the default, D4) or the LIVE source off gives none. The switch itself (LiveConsoleService.setVault): off
 * at the creation, on or off until the end, refused on an after-room, after the end and once cancelled, audited.
 *
 * Under concurrency (PGlite always; PostgreSQL in genome-ci, ORBES_TEST_POSTGRES_URL): the PAY that sells a size out
 * racing the LEAVE of those waiting in it never deadlocks; each of them leaves without a vault or keeps one.
 *
 * The other sources and the return (step Q3.6; plan §2.3.2–7, §2.6; D3, D5, D27, D68; N6–N8, N10, N25, N34), on the
 * services as createContext wires them: EACH PIECE BOUGHT at the first registration only (every channel, a piece no order
 * holds, a VAULT order bought under its right to buy; never a VAULT order at 0, a welcome GIFT, an exchange's replacement
 * or a transfer), TITANE at the first registration; A NEW TIER only for a tier first reached after the deploy; A WORN
 * PHOTOGRAPH PUBLISHED, one per piece; A FRIEND'S FIRST PIECE through the personal link (never through a credit to give);
 * A COMPLETE PROFILE on the save that completes it, never for a profile complete before; THE HOUSE to one collector or a
 * segment (test entrants and inactive accounts left out and counted); a returned piece taking its unopened vault back.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, inTransaction, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { soldOutSizes } from '../../src/server/services/live.js';
import { profileMissing } from '../../src/server/services/profiles.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { giveLiveVaults, HOUSE_GIVE_BATCH, inviterOf, pieceBought } from '../../src/server/services/vault.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { createTestDb } from '../support/db.js';
import { packAndShip, stockPieces, type StockedPiece } from '../support/fulfil.js';
import {
  accountOfTier,
  createAccount,
  createLiveRelease,
  createModel,
  createSet,
  createSetLiveRelease,
  entriesOf,
  holdPieces,
  liveFixture,
  pieceSize,
  sizedModel,
  type LiveFixture,
  type LiveRelease,
} from '../support/live.js';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
type Account = Awaited<ReturnType<typeof accountOfTier>>;

async function refusal(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

describe('THE VAULT’s LIVE source (pure)', () => {
  const s = (id: string, stock: number, confirmed: number, piece: number | null = null) => ({ id, piece, stock, confirmed });

  it('names the sizes a PAY sold out: its own fully confirmed, or every size once the release is sold out whole', () => {
    // A model's release: the PAY's own size, once its confirmed pieces are its stock; another size full is not its doing.
    expect(soldOutSizes([s('A', 2, 2), s('B', 2, 1)], ['A'])).toEqual(['A']);
    expect(soldOutSizes([s('A', 2, 2), s('B', 2, 2)], ['A'])).toEqual(['A', 'B']);
    expect(soldOutSizes([s('A', 2, 1), s('B', 1, 1)], ['A'])).toEqual([]);
    // N19: a size whose pieces are not all paid sells nothing out, whoever it can no longer serve.
    expect(soldOutSizes([s('A', 3, 2), s('B', 3, 0)], ['A'])).toEqual([]);
    // A size with no stock is never sold out by a PAY.
    expect(soldOutSizes([s('A', 0, 0), s('B', 2, 1)], ['A'])).toEqual([]);
    // A set's release: by its sets (the scarcest piece's total confirmed: every size), else each own size full.
    expect(soldOutSizes([s('P1', 1, 1, 1), s('Q1', 2, 1, 1), s('P2', 3, 2, 2)], ['P1', 'P2'])).toEqual(['P1']);
    expect(soldOutSizes([s('P1', 1, 1, 1), s('Q1', 2, 1, 1), s('P2', 2, 2, 2)], ['Q1', 'P2'])).toEqual(['P1', 'Q1', 'P2']);
  });
});

describe('THE VAULT’s LIVE source', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let f: LiveFixture;
  let hour = 8;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-02T06:00:00.000Z');
  });
  afterAll(() => t?.close());

  /** A release whose T0 is two hours after the last one's, the clock an hour before it, its vault switched as asked (on by default). */
  async function release(o: Partial<Parameters<typeof createLiveRelease>[1]> & { vault?: boolean; closesInMinutes?: number } = {}): Promise<LiveRelease & { t0: Date }> {
    hour += 2;
    const t0 = new Date(Date.UTC(2026, 10, 3, hour));
    f.clock.set(t0.getTime() - 60 * MINUTE);
    const r = await createLiveRelease(f, { opensAt: t0, ...(o.closesInMinutes ? { closesAt: new Date(t0.getTime() + o.closesInMinutes * MINUTE) } : {}), ...o });
    if (o.vault !== false) await f.liveConsole.setVault(r.id, true, f.admin);
    return { ...r, t0 };
  }
  const enter = (r: { id: string }, a: Account, sizeId: string, quantity?: number) => f.live.enter(a.id, r.id, { sizeId, ...(quantity ? { quantity } : {}) }, a.actor);
  async function pay(r: { id: string }, a: { id: string; actor: Actor }) {
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    f.clock.advance(SECOND);
    return f.live.confirm(a.id, r.id, a.actor);
  }
  const statusOf = async (r: { id: string }, a: { id: string }) =>
    (await t.db.selectFrom('live_entries').select('status').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow()).status;
  /** The LIVE vaults of a release, by account. */
  async function vaultsOf(r: { id: string }) {
    const rows = await t.db.selectFrom('vaults').selectAll().where('drop_id', '=', r.id).orderBy('account_id').execute();
    return rows;
  }
  const holders = async (r: { id: string }) => new Set((await vaultsOf(r)).map((v) => v.account_id));
  const vaultsOfAccount = (a: { id: string }) => t.db.selectFrom('vaults').selectAll().where('account_id', '=', a.id).execute();

  it('gives the line of the size a PAY sells out its vaults: queued and late comers, never the buyer, another size, a LEFT entry or a test entrant', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }] });
    const [s52, s54] = [r.sizes[0]!.id, r.sizes[1]!.id];
    const buyer = await accountOfTier(f, 3);
    const waiting = [await accountOfTier(f, 1), await accountOfTier(f, 0)];
    const other = await accountOfTier(f, 2);
    const leaver = await accountOfTier(f, 0);
    const tester = await accountOfTier(f, 0);
    await t.db.insertInto('test_entrants').values({ account_id: tester.id }).execute();
    f.clock.set(r.t0.getTime() - MINUTE);
    for (const a of [buyer, ...waiting, leaver, tester]) await enter(r, a, s52);
    await enter(r, other, s54);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    expect(await statusOf(r, buyer)).toBe('TURN');
    expect(await statusOf(r, other)).toBe('TURN');
    for (const a of waiting) expect(await statusOf(r, a)).toBe('QUEUED');
    // A late comer joins and stays; another leaves the line.
    f.clock.advance(5 * SECOND);
    const late = await accountOfTier(f, 0);
    await enter(r, late, s52);
    expect(await statusOf(r, late)).toBe('QUEUED');
    await f.live.leave(leaver.id, r.id, leaver.actor);

    const before = f.clock.now();
    await pay(r, buyer);
    const at = f.clock.now();
    expect(at.getTime()).toBeGreaterThan(before.getTime());
    // 52 is sold out; 54 is still in a turn: the release runs on.
    expect((await t.db.selectFrom('drops').select('ended_at').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_at).toBeNull();
    const given = await vaultsOf(r);
    expect(new Set(given.map((v) => v.account_id))).toEqual(new Set([...waiting, late].map((a) => a.id)));
    const entries = await entriesOf(t.db, r.id);
    for (const v of given) {
      expect(v).toMatchObject({ source: 'LIVE', drop_id: r.id, occasion_key: `LIVE:${r.id}`, occasion_index: 1, given_at: at, opened_at: null, revoked_at: null });
      expect(v.entry_id).toBe(entries.find((e) => e.account_id === v.account_id)!.id);
      expect(new Date(v.waits_until).getTime() - at.getTime()).toBe(30 * 24 * 60 * MINUTE);
    }
    // Each its FROM ORBES arrival and its audit, in the PAY's transaction (the system's).
    for (const a of [...waiting, late]) {
      const msg = await t.db.selectFrom('house_deliveries').select(['source', 'title', 'body']).where('account_id', '=', a.id).execute();
      expect(msg).toEqual([{ source: 'VAULT', title: 'A VAULT IS WAITING FOR YOU', body: expect.stringContaining('Your size sold out at the LIVE release of MONOLITHE while you were in the line.') }]);
    }
    const audits = await t.db.selectFrom('audit_logs').select(['actor_type', 'target_id', 'details']).where('action', '=', 'vault.give').where('occurred_at', '=', at).execute();
    expect(audits.map((x) => x.target_id).sort()).toEqual([...waiting, late].map((a) => a.id).sort());
    expect(audits.every((x) => x.actor_type === 'system' && (x.details as { source: string }).source === 'LIVE')).toBe(true);
    // Still QUEUED (SOLD OUT for your size) until the end: the vault waits for them.
    for (const a of [...waiting, late]) expect(await statusOf(r, a)).toBe('QUEUED');

    // 54 sells out: the release is sold out whole; nobody left waiting gets a second vault, the line is ENDED.
    await pay(r, other);
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('SOLD_OUT');
    for (const a of [...waiting, late]) expect(await statusOf(r, a)).toBe('ENDED');
    expect(await vaultsOf(r)).toHaveLength(3);
    for (const a of [buyer, other, leaver, tester]) expect(await vaultsOfAccount(a)).toEqual([]);
  });

  it('counts an entry still WAITING (placed after the line formed) as in the line, and never an account no longer ACTIVE', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 1 }] });
    const s52 = r.sizes[0]!.id;
    const [a, b, c] = [await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0)];
    f.clock.set(r.t0.getTime() - MINUTE);
    for (const x of [a, b, c]) await enter(r, x, s52);
    // Before T0 the line has not formed: every entry WAITING. The source reads them as in the line.
    expect((await entriesOf(t.db, r.id)).map((e) => e.status)).toEqual(['WAITING', 'WAITING', 'WAITING']);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', c.id).execute();
    const d = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    const notes = await giveLiveVaults(t.db, d, [s52], f.clock.now());
    expect(notes.map((n) => n.targetId).sort()).toEqual([a.id, b.id].sort());
    expect(await holders(r)).toEqual(new Set([a.id, b.id]));
    // Given once: a second pass gives nothing more.
    expect(await giveLiveVaults(t.db, d, [s52], f.clock.now())).toEqual([]);
    expect(await vaultsOf(r)).toHaveLength(2);
  });

  it('gives a 2+ piece entry its size can no longer serve nothing while the size is not fully paid, then its vault (N19)', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 3 }], perAccount: 2 });
    const s52 = r.sizes[0]!.id;
    const first = await accountOfTier(f, 3);
    const two = await accountOfTier(f, 2);
    const last = await accountOfTier(f, 0);
    f.clock.set(r.t0.getTime() - MINUTE);
    await enter(r, first, s52, 2);
    await enter(r, two, s52, 2);
    await enter(r, last, s52);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    // 3 pieces: the first takes 2; the pair waits for its 2, the single piece behind it too.
    expect([await statusOf(r, first), await statusOf(r, two), await statusOf(r, last)]).toEqual(['TURN', 'QUEUED', 'QUEUED']);
    await pay(r, first);
    // 2 of 3 paid: SOLD OUT for the pair's size (1 piece left for its 2), but the size is not sold out: no vault.
    expect(await vaultsOf(r)).toEqual([]);
    // The next batch passes the pair over: the single piece behind it takes its turn and pays the size out.
    f.clock.set(r.t0.getTime() + MINUTE);
    await f.live.advance(r.id);
    expect([await statusOf(r, two), await statusOf(r, last)]).toEqual(['QUEUED', 'TURN']);
    await pay(r, last);
    expect(await holders(r)).toEqual(new Set([two.id]));
  });

  it('reads a set’s release by its sizes per piece', async () => {
    const ring = await sizedModel(t.db, 'HALO', ['52', '54']);
    const chain = await sizedModel(t.db, 'LINEA', ['45', '50'], 'NECKLACE');
    const setId = await createSet(f, [ring, chain]);
    hour += 2;
    const t0 = new Date(Date.UTC(2026, 10, 3, hour));
    f.clock.set(t0.getTime() - 60 * MINUTE);
    const r = await createSetLiveRelease(f, { setId, opensAt: t0, sizes: [{ piece: 1, label: '52', stock: 1 }, { piece: 1, label: '54', stock: 1 }, { piece: 2, label: '45', stock: 2 }] });
    await f.liveConsole.setVault(r.id, true, f.admin);
    const choose = (a: string, b: string) => ({ sizes: [{ piece: 1, sizeId: pieceSize(r, 1, a) }, { piece: 2, sizeId: pieceSize(r, 2, b) }] });
    const [x, y, z] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1)];
    f.clock.set(t0.getTime() - MINUTE);
    await f.live.enter(x.id, r.id, choose('52', '45'), x.actor);
    await f.live.enter(y.id, r.id, choose('52', '45'), y.actor);
    await f.live.enter(z.id, r.id, choose('54', '45'), z.actor);
    f.clock.set(t0);
    await f.live.advance(r.id);
    // y waits for the ring's 52 and holds the chain's 45 back for z behind it.
    expect([await statusOf(r, x), await statusOf(r, y), await statusOf(r, z)]).toEqual(['TURN', 'QUEUED', 'QUEUED']);
    // The first set paid sells its ring's 52 out: y, waiting on that size, has its vault; the chain's 45 still has one.
    await pay(r, x);
    expect(await holders(r)).toEqual(new Set([y.id]));
    // The next batch passes y over; z takes the last set: sold out whole, nobody left waiting.
    f.clock.set(t0.getTime() + MINUTE);
    await f.live.advance(r.id);
    expect(await statusOf(r, z)).toBe('TURN');
    await pay(r, z);
    expect(await statusOf(r, y)).toBe('ENDED');
    expect(await vaultsOf(r)).toHaveLength(1);
  });

  it('gives every size’s line its vault when the release sells out whole, before the end ENDS it (D6)', async () => {
    // The switch is off while 52 sells out; on when 54 sells the release out whole: both lines then.
    const r = await release({ sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }], vault: false });
    const [s52, s54] = [r.sizes[0]!.id, r.sizes[1]!.id];
    const [a, b, c, d] = [await accountOfTier(f, 3), await accountOfTier(f, 0), await accountOfTier(f, 3), await accountOfTier(f, 0)];
    f.clock.set(r.t0.getTime() - MINUTE);
    await enter(r, a, s52);
    await enter(r, b, s52);
    await enter(r, c, s54);
    await enter(r, d, s54);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    await pay(r, a);
    expect(await vaultsOf(r)).toEqual([]);
    await f.liveConsole.setVault(r.id, true, f.admin);
    await pay(r, c);
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('SOLD_OUT');
    expect(await holders(r)).toEqual(new Set([b.id, d.id]));
    // Given while they were still in the line: ENDED after, by the same PAY.
    const ended = await t.db.selectFrom('live_entries').select(['account_id', 'ended_at']).where('drop_id', '=', r.id).where('status', '=', 'ENDED').execute();
    expect(new Set(ended.map((e) => e.account_id))).toEqual(new Set([b.id, d.id]));
    for (const v of await vaultsOf(r)) expect(v.given_at).toEqual(ended[0]!.ended_at);
  });

  it('gives nothing when the release CLOSES with pieces left, even when a hold pays its last piece after the close (D8)', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 2 }], payMinutes: 10, closesInMinutes: 5 });
    const s52 = r.sizes[0]!.id;
    const [a, b, c] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 0)];
    f.clock.set(r.t0.getTime() - MINUTE);
    for (const x of [a, b, c]) await enter(r, x, s52);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    await pay(r, a);
    // b secures, then the release closes while its hold runs: c, still waiting, is ENDED without a vault.
    const token = (await f.live.entry(b.id, r.id))!.turn!.token!;
    await f.live.press(b.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(b.id, r.id, token, b.actor);
    f.clock.set(r.t0.getTime() + 5 * MINUTE);
    await f.live.advance(r.id);
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('CLOSED');
    expect(await statusOf(r, c)).toBe('ENDED');
    f.clock.advance(SECOND);
    await f.live.confirm(b.id, r.id, b.actor);
    expect(await statusOf(r, b)).toBe('CONFIRMED');
    expect(await vaultsOf(r)).toEqual([]);
  });

  it('gives nothing when a hold is paid after the close, before the engine’s next pass, selling one size out of a release with pieces left (D8)', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 3 }], payMinutes: 10, closesInMinutes: 5 });
    const [s52, s54] = [r.sizes[0]!.id, r.sizes[1]!.id];
    const [a, b, c] = [await accountOfTier(f, 3), await accountOfTier(f, 0), await accountOfTier(f, 0)];
    f.clock.set(r.t0.getTime() - MINUTE);
    await enter(r, a, s52);
    await enter(r, b, s52);
    await enter(r, c, s54);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    // The close passes and no engine pass has run yet: a's hold pays 52's only piece.
    f.clock.set(r.t0.getTime() + 5 * MINUTE + 100);
    await f.live.confirm(a.id, r.id, a.actor);
    expect(await statusOf(r, a)).toBe('CONFIRMED');
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('CLOSED');
    expect(await statusOf(r, b)).toBe('ENDED');
    expect(await vaultsOf(r)).toEqual([]);
  });

  it('gives a long line its vaults in a few statements, whatever its length, each its arrival and its audit (the release’s row held briefly)', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 1 }] });
    const s52 = r.sizes[0]!.id;
    const line: Account[] = [];
    for (let i = 0; i < 40; i++) line.push(await accountOfTier(f, 0));
    f.clock.set(r.t0.getTime() - MINUTE);
    for (const a of line) await enter(r, a, s52);
    await t.db.updateTable('vault_sources').set({ per_occasion: 2 }).where('source', '=', 'LIVE').execute();
    try {
      let statements = 0;
      const counted = t.db.withPlugin({ transformQuery: (args) => (statements++, args.node), transformResult: async (args) => args.result });
      const d = await t.db.selectFrom('drops').select(['id', 'set_id', 'parent_drop_id', 'vault_on']).where('id', '=', r.id).executeTakeFirstOrThrow();
      const at = f.clock.now();
      const notes = await counted.transaction().execute((tx) => giveLiveVaults(tx, d, [s52], at));
      // The source, the entries, the vaults, the occasion's detail, the arrivals: never one per collector.
      expect(statements).toBeLessThanOrEqual(5);
      expect(notes.map((n) => n.targetId)).toEqual(line.map((a) => a.id).sort());
      expect(notes.every((n) => n.action === 'vault.give' && (n.details as { count: number }).count === 2)).toBe(true);
      const given = await vaultsOf(r);
      expect(given).toHaveLength(80);
      for (const a of line) expect(given.filter((v) => v.account_id === a.id).map((v) => v.occasion_index).sort()).toEqual([1, 2]);
      const arrivals = await t.db.selectFrom('house_deliveries').select(['account_id', 'dedupe_key']).where('account_id', 'in', line.map((a) => a.id)).execute();
      expect(arrivals).toHaveLength(40);
      for (const m of arrivals) expect(m.dedupe_key).toBe(`VAULT:${given.find((v) => v.account_id === m.account_id && v.occasion_index === 1)!.id}`);
      // Given again (a second pass): nothing more.
      expect(await t.db.transaction().execute((tx) => giveLiveVaults(tx, d, [s52], at))).toEqual([]);
      expect(await vaultsOf(r)).toHaveLength(80);
    } finally {
      await t.db.updateTable('vault_sources').set({ per_occasion: 1 }).where('source', '=', 'LIVE').execute();
    }
  });

  it('keeps the vault of a guest who wins a piece in the after-room, which gives none of its own (D7, N20)', async () => {
    const afterModel = await createModel(t.db, 'AFTERGLOW');
    const r = await release({ sizes: [{ label: '52', stock: 1 }], afterRoom: { modelId: afterModel, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }], addonIds: [] } });
    const child = r.afterRoom!.id;
    // The after-room's own switch never turns on.
    expect((await refusal(f.liveConsole.setVault(child, true, f.admin))).code).toBe('LIVE_AFTER_ROOM');
    const s52 = r.sizes[0]!.id;
    const [buyer, g1, g2] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 0)];
    f.clock.set(r.t0.getTime() - MINUTE);
    for (const x of [buyer, g1, g2]) await enter(r, x, s52);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    await pay(r, buyer);
    expect(await holders(r)).toEqual(new Set([g1.id, g2.id]));
    const kept = await vaultsOfAccount(g1);
    // The after-room opens for its guests; the first wins its one piece, which sells it out with the other waiting.
    const opens = (await t.db.selectFrom('drops').select('opens_at').where('id', '=', child).executeTakeFirstOrThrow()).opens_at;
    f.clock.set(opens);
    for (const g of [g1, g2]) await f.live.enter(g.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, g.actor);
    await f.live.advance(child);
    expect([await statusOf({ id: child }, g1), await statusOf({ id: child }, g2)]).toEqual(['TURN', 'QUEUED']);
    await pay({ id: child }, g1);
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', child).executeTakeFirstOrThrow()).ended_reason).toBe('SOLD_OUT');
    expect(await statusOf({ id: child }, g2)).toBe('ENDED');
    // Nothing of the after-room's own; the guest's vault of the release untouched.
    expect(await t.db.selectFrom('vaults').select('id').where('drop_id', '=', child).execute()).toEqual([]);
    expect(await vaultsOfAccount(g1)).toEqual(kept);
    expect(await vaultsOfAccount(g2)).toHaveLength(1);
  });

  it('gives nothing with the release’s switch off (the default) or the LIVE source off', async () => {
    for (const off of ['release', 'source'] as const) {
      const r = await release({ sizes: [{ label: '52', stock: 1 }], vault: off === 'source' });
      if (off === 'source') await t.db.updateTable('vault_sources').set({ enabled: false }).where('source', '=', 'LIVE').execute();
      const s52 = r.sizes[0]!.id;
      const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
      f.clock.set(r.t0.getTime() - MINUTE);
      await enter(r, a, s52);
      await enter(r, b, s52);
      f.clock.set(r.t0);
      await f.live.advance(r.id);
      await pay(r, a);
      expect(await statusOf(r, b)).toBe('ENDED');
      expect(await vaultsOf(r)).toEqual([]);
      await t.db.updateTable('vault_sources').set({ enabled: true }).where('source', '=', 'LIVE').execute();
    }
  });

  it('switches a release’s vault on and off until it ends: off at its creation, never an after-room’s, audited', async () => {
    hour += 2;
    const t0 = new Date(Date.UTC(2026, 10, 3, hour));
    f.clock.set(t0.getTime() - 60 * MINUTE);
    // New live release: off, whatever its settings carry.
    const created = await f.liveConsole.create(
      { pace: { batch: 10, minutes: 1 }, holdMinutes: 0, modelId: f.modelId, title: 'NIGHT', opensAt: t0, closesAt: new Date(t0.getTime() + 60 * MINUTE), priceMinor: 500_000, sizes: [{ label: '52', stock: 2 }], ...({ vaultOn: true } as object) },
      f.admin,
    );
    expect(created.vaultOn).toBe(false);
    expect((await t.db.selectFrom('drops').select('vault_on').where('id', '=', created.id).executeTakeFirstOrThrow()).vault_on).toBe(false);
    // A DRAFT switches; the same value again writes nothing.
    expect((await f.liveConsole.setVault(created.id, true, f.admin)).vaultOn).toBe(true);
    expect((await f.liveConsole.setVault(created.id, true, f.admin)).vaultOn).toBe(true);
    expect((await f.liveConsole.get(created.id)).vaultOn).toBe(true);
    await f.liveConsole.publish(created.id, {}, f.admin);
    // Published and running: still changes.
    f.clock.set(t0.getTime() + MINUTE);
    expect((await f.liveConsole.setVault(created.id, false, f.admin)).vaultOn).toBe(false);
    const audits = await t.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', 'drop.live.vault').where('target_id', '=', created.id).orderBy('id').execute();
    expect(audits).toEqual([
      { actor_type: 'admin', actor_id: f.admin.id, details: { before: false, after: true } },
      { actor_type: 'admin', actor_id: f.admin.id, details: { before: true, after: false } },
    ]);
    // Refused: a value that is not a switch, a customer, after the close (the engine not yet passed), after the end.
    expect((await refusal(f.liveConsole.setVault(created.id, 'on', f.admin))).httpStatus).toBe(400);
    expect((await refusal(f.liveConsole.setVault(created.id, true, { type: 'account', id: (await createAccount(t.db)).id }))).httpStatus).toBe(403);
    f.clock.set(t0.getTime() + 60 * MINUTE);
    expect(await refusal(f.liveConsole.setVault(created.id, true, f.admin))).toMatchObject({ code: 'LIVE_ENDED', httpStatus: 409 });
    await f.live.advance(created.id);
    expect(await refusal(f.liveConsole.setVault(created.id, true, f.admin))).toMatchObject({ code: 'LIVE_ENDED', httpStatus: 409 });
    // Cancelled; unknown.
    const other = await release({ vault: false });
    await f.liveConsole.cancel(other.id, f.admin);
    expect((await refusal(f.liveConsole.setVault(other.id, true, f.admin))).code).toBe('DROP_CANCELLED');
    expect((await refusal(f.liveConsole.setVault('00000000-0000-4000-8000-000000000000', true, f.admin))).httpStatus).toBe(404);
  });
});

// ── Under concurrency ───────────────────────────────────────────────────────

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
      const name = `orbes_vault_live_${randomBytes(6).toString('hex')}`;
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
  describe.skipIf(backend.skip)(`THE VAULT’s LIVE source under concurrency, on ${backend.name}`, () => {
    let h: { db: Db; close(): Promise<void> };
    let f: LiveFixture;
    beforeAll(async () => {
      h = await backend.open();
      f = await liveFixture(h.db, '2026-12-08T09:00:00.000Z');
    });
    afterAll(() => h?.close());

    it('the PAY that sells a size out racing the LEAVE of those waiting in it never deadlocks: each leaves without a vault or keeps one', async () => {
      const t0 = new Date('2026-12-08T10:00:00.000Z');
      const r = await createLiveRelease(f, { opensAt: t0, sizes: [{ label: '52', stock: 1 }] });
      await f.liveConsole.setVault(r.id, true, f.admin);
      const buyer = await accountOfTier(f, 3);
      const waiting: Account[] = [];
      for (let i = 0; i < 6; i++) waiting.push(await accountOfTier(f, 0));
      f.clock.set(t0.getTime() - MINUTE);
      for (const a of [buyer, ...waiting]) await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      f.clock.set(t0);
      await f.live.advance(r.id);
      const token = (await f.live.entry(buyer.id, r.id))!.turn!.token!;
      await f.live.press(buyer.id, r.id, token);
      f.clock.advance(1500);
      await f.live.secure(buyer.id, r.id, token, buyer.actor);
      f.clock.advance(SECOND);
      const settled = await Promise.allSettled([f.live.confirm(buyer.id, r.id, buyer.actor), ...waiting.map((a) => f.live.leave(a.id, r.id, a.actor))]);
      // Every outcome a result or a worded refusal (the line ENDED before a LEAVE): never a deadlock or another failure.
      for (const s of settled) if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(DomainError);
      expect(settled[0]!.status).toBe('fulfilled');
      const vaults = await h.db.selectFrom('vaults').select('account_id').where('drop_id', '=', r.id).execute();
      const holding = new Set(vaults.map((v) => v.account_id));
      expect(holding.size).toBe(vaults.length);
      for (const a of waiting) {
        const e = await h.db.selectFrom('live_entries').select('status').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
        expect(e.status === 'LEFT' ? !holding.has(a.id) : e.status === 'ENDED' && holding.has(a.id)).toBe(true);
      }
    });
  });
}

// ── The other sources and the return (step Q3.6; plan §2.3.2–7, §2.6) ─────

describe('THE VAULT’s other sources and the return', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Actor;
  let admin: Actor;
  let agent: Actor;
  let france: string;
  let colissimo: string;
  let size = 40;
  const issued = new Map<string, StockedPiece>();

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    agent = { type: 'admin', id: (await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [france] })).id };
    colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  const db = () => h.t.db;
  const scope = () => new Set([france]);
  const cases = () => h.ctx.services.orderCases;
  const vault = () => h.ctx.services.vault;
  const row = (id: string) => db().selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const skuOf = (label: string) => h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, label));
  const freshSize = () => String((size += 2));
  const actorOf = (accountId: string): Actor => ({ type: 'account', id: accountId });

  /** A salon order of a size of its own for `accountId`, priced and paid, its piece stocked, packed and shipped. */
  async function shippedOrder(accountId: string): Promise<{ id: string; skuId: string; piece: StockedPiece }> {
    const label = freshSize();
    const skuId = await skuOf(label);
    const request = await db().insertInto('shop_requests').values({ account_id: accountId, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(MINUTE);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, operator);
    const id = (await db().selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: label, priceMinor: 420_000, currency: 'EUR' }, operator);
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(id, { to: 'PAID' }, operator);
    for (const p of await stockPieces(h.ctx, { skuId, locationId: france, count: 1, forOrderIds: [id] }, operator)) issued.set(p.uuid, p);
    await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, operator);
    return { id, skuId, piece: issued.get((await row(id)).product_id!)! };
  }

  /** A piece in stock that no order holds, ACTIVATED: a counter sale, a piece claimed with its code. */
  async function pieceSoldApart(): Promise<StockedPiece> {
    const [p] = await stockPieces(h.ctx, { skuId: await skuOf(freshSize()), locationId: france, count: 1 }, operator);
    await h.ctx.services.lifecycle.transition(p!.productId, 'ACTIVATED', { reason: 'sold' }, SYSTEM_ACTOR);
    return p!;
  }

  /** Its first registration by `accountId`: the scan, then REGISTER with the claim code. */
  async function register(accountId: string, piece: StockedPiece) {
    const scan = await h.ctx.services.verification.verify({ code: piece.data }, {});
    h.clock.advance(MINUTE);
    return h.ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode: piece.claimCode ?? null }, actorOf(accountId));
  }

  const vaultsOf = (accountId: string) => db().selectFrom('vaults').selectAll().where('account_id', '=', accountId).orderBy('given_at').orderBy('occasion_key').execute();
  /** The account's vaults not revoked, by occasion (a VAULT order's own HOUSE vault left out). */
  const keysOf = async (accountId: string) => (await vaultsOf(accountId)).filter((v) => v.revoked_at === null && v.source !== 'HOUSE').map((v) => v.occasion_key).sort();
  const arrivals = async (accountId: string) => (await db().selectFrom('house_deliveries').select('title').where('account_id', '=', accountId).where('source', '=', 'VAULT').execute()).length;
  const account = async () => (await createAccount(db())).id;

  /** A HOUSE vault of `accountId`, opened as `kind` (a VAULT order names one). */
  async function openedVault(accountId: string, kind: 'PRODUCT' | 'VAULT_EDITION' | 'THE_PIECE'): Promise<string> {
    const given = new Date(h.clock.now().getTime() - 2 * DAY);
    const floor = await db().selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
    const v = await db()
      .insertInto('vaults')
      .values({ account_id: accountId, source: 'HOUSE', given_by: admin.id!, occasion_key: `HOUSE:${randomUUID()}`, occasion_index: 1, given_at: given, waits_until: new Date(given.getTime() + 30 * DAY) })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db()
      .updateTable('vaults')
      .set({ opened_at: new Date(given.getTime() + HOUR), reward_id: floor.id, reward_kind: kind, prize: 'MONOLITHE', odds_text: '1 IN 200', rare: kind !== 'PRODUCT' } as never)
      .where('id', '=', v.id)
      .execute();
    return v.id;
  }

  /** A VAULT order of `accountId` holding `piece` (a product won free at 0, or bought under its right to buy). */
  async function vaultOrder(accountId: string, piece: StockedPiece, priceMinor: number): Promise<string> {
    const vaultId = await openedVault(accountId, 'PRODUCT');
    const sku = await db().selectFrom('products').select('sku_id').where('id', '=', piece.uuid).executeTakeFirstOrThrow();
    const reservedAt = h.clock.now();
    const o = await db()
      .insertInto('orders')
      .values({
        channel: 'VAULT',
        vault_id: vaultId,
        account_id: accountId,
        model_id: catalog.modelId,
        location_id: france,
        sku_id: sku.sku_id,
        reservation: priceMinor === 0 ? 'STOCK' : 'AWAITING',
        price_minor: priceMinor,
        currency: 'EUR',
        reserved_at: reservedAt,
        claim_by: priceMinor === 0 ? new Date(reservedAt.getTime() + 30 * DAY) : null,
        product_id: piece.uuid,
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    return o.id;
  }

  describe('EACH PIECE BOUGHT', () => {
    it('opens a PIECE vault at a bought piece’s first registration, with TITANE’s at the first piece (not through the grants), each with its FROM ORBES arrival and audit', async () => {
      const buyer = await account();
      const first = await shippedOrder(buyer);
      expect(await keysOf(buyer)).toEqual([]);
      await register(buyer, first.piece);
      const at = h.clock.now();
      expect(await keysOf(buyer)).toEqual([`PIECE:${first.piece.uuid}`, 'TIER:1']);
      const piece = (await vaultsOf(buyer)).find((v) => v.source === 'PIECE')!;
      expect(piece).toMatchObject({ product_id: first.piece.uuid, occasion_index: 1, given_at: at, waits_until: new Date(at.getTime() + 30 * DAY), opened_at: null, revoked_at: null });
      expect((await vaultsOf(buyer)).find((v) => v.source === 'TIER')).toMatchObject({ tier: 1, given_at: at });
      expect(await arrivals(buyer)).toBe(2);
      const audited = await db().selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'vault.give').where('target_id', '=', buyer).execute();
      expect(audited.map((a) => [a.actor_type, (a.details as { source: string }).source]).sort()).toEqual([['system', 'PIECE'], ['system', 'TIER']]);
      // The order went DELIVERED in the same registration.
      expect((await row(first.id)).status).toBe('DELIVERED');
      // A second piece bought: its own PIECE vault; TITANE once.
      const second = await shippedOrder(buyer);
      await register(buyer, second.piece);
      expect(await keysOf(buyer)).toEqual([`PIECE:${first.piece.uuid}`, `PIECE:${second.piece.uuid}`, 'TIER:1'].sort());
    });

    it('opens one for a piece no order holds (a counter sale, a piece claimed with its code)', async () => {
      const buyer = await account();
      const piece = await pieceSoldApart();
      await register(buyer, piece);
      expect(await keysOf(buyer)).toEqual([`PIECE:${piece.uuid}`, 'TIER:1']);
    });

    it('a VAULT order bought under a RIGHT TO BUY opens its PIECE vault at the first registration; a VAULT order at 0 (a product won free) opens none', async () => {
      const winner = await account();
      const bought = await pieceSoldApart();
      await vaultOrder(winner, bought, 95_000);
      await register(winner, bought);
      expect(await keysOf(winner)).toEqual([`PIECE:${bought.uuid}`, 'TIER:1']);
      const won = await pieceSoldApart();
      await vaultOrder(winner, won, 0);
      await register(winner, won);
      expect(await keysOf(winner)).toEqual([`PIECE:${bought.uuid}`, 'TIER:1']);
      // And the rule read on its own (N8): a welcome GIFT and an EXCHANGE's replacement were not bought either.
      const gift = await pieceSoldApart();
      const salon = (await shippedOrder(winner)).id;
      const grant = await db().insertInto('tier_grants').values({ account_id: winner, tier: 2, kind: 'GIFT', granted_at: h.clock.now(), model_id: catalog.modelId }).returning('id').executeTakeFirstOrThrow();
      await db()
        .insertInto('orders')
        .values({ channel: 'GIFT', account_id: winner, model_id: catalog.modelId, with_order_id: salon, gift_grant_id: grant.id, price_minor: 0, currency: 'EUR', status: 'PAID', paid_at: h.clock.now(), location_id: france, product_id: gift.uuid } as never)
        .execute();
      expect(await inTransaction(db(), (tx) => pieceBought(tx, gift.uuid))).toBe(false);
      expect(await inTransaction(db(), (tx) => pieceBought(tx, bought.uuid))).toBe(true);
      expect(await inTransaction(db(), (tx) => pieceBought(tx, won.uuid))).toBe(false);
    });

    it('a transfer opens no PIECE vault (first registration only); the recipient’s first tier gives its own', async () => {
      const owner = await account();
      const next = await account();
      const { piece } = await shippedOrder(owner);
      await register(owner, piece);
      const offer = await h.ctx.services.ownership.initiateTransfer(owner, piece.productId, actorOf(owner));
      const scan = await h.ctx.services.verification.verify({ code: piece.data }, { accountId: next });
      await h.ctx.services.ownership.acceptTransfer(next, { transferCode: offer.transferCode, productId: piece.productId, transferToken: scan.transfer!.token }, actorOf(next));
      expect(await keysOf(next)).toEqual(['TIER:1']);
      expect(await keysOf(owner)).toEqual([`PIECE:${piece.uuid}`, 'TIER:1']);
    });
  });

  describe('a returned piece', () => {
    it('a RETURN decided with the piece back revokes its unopened PIECE vault (RETURNED), never its TIER vault; an opened one keeps what it held', async () => {
      const buyer = await account();
      const kept = await shippedOrder(buyer);
      const back = await shippedOrder(buyer);
      await register(buyer, kept.piece);
      await register(buyer, back.piece);
      // The first piece's vault opened (I WAS THERE, the floor), then both pieces returned.
      const opened = (await vaultsOf(buyer)).find((v) => v.occasion_key === `PIECE:${kept.piece.uuid}`)!;
      await vault().open(buyer, opened.id);
      for (const o of [kept, back]) {
        const c = await cases().open(o.id, { kind: 'RETURN', reason: 'NOT_AS_EXPECTED', note: 'Returned.' }, operator);
        await cases().receive(c.id, { pieceState: 'OK' }, agent, scope());
        await cases().decide(c.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' }, operator, { admin: false });
      }
      const after = await vaultsOf(buyer);
      expect(after.find((v) => v.occasion_key === `PIECE:${back.piece.uuid}`)).toMatchObject({ revoked_reason: 'RETURNED', revoked_at: h.clock.now(), opened_at: null });
      expect(after.find((v) => v.id === opened.id)).toMatchObject({ revoked_at: null, opened_at: expect.any(Date), reward_kind: 'I_WAS_THERE' });
      expect(after.find((v) => v.source === 'TIER')).toMatchObject({ revoked_at: null });
      const revoked = await db().selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'vault.revoke').where('target_id', '=', buyer).execute();
      expect(revoked).toEqual([{ actor_type: 'system', details: expect.objectContaining({ source: 'PIECE', occasionKey: `PIECE:${back.piece.uuid}`, reason: 'RETURNED' }) }]);
      // The forAccount page no longer shows the returned piece's vault.
      expect((await vault().forAccount(buyer)).waiting.map((d) => d.id)).not.toContain(after.find((v) => v.occasion_key === `PIECE:${back.piece.uuid}`)!.id);
    });

    it('an exchange keeps the first piece’s vault, and its replacement opens none', async () => {
      const buyer = await account();
      const first = await shippedOrder(buyer);
      await register(buyer, first.piece);
      const other = freshSize();
      const otherSku = await skuOf(other);
      for (const p of await stockPieces(h.ctx, { skuId: otherSku, locationId: france, count: 1 }, operator)) issued.set(p.uuid, p);
      const c = await cases().open(first.id, { kind: 'EXCHANGE', reason: 'SIZE', exchangeSkuId: otherSku, note: 'One size up.' }, operator);
      await cases().receive(c.id, { pieceState: 'OK' }, agent, scope());
      const decided = await cases().decide(c.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'Exchanged.' }, operator, { admin: false });
      expect((await vaultsOf(buyer)).find((v) => v.source === 'PIECE')).toMatchObject({ product_id: first.piece.uuid, revoked_at: null });
      const exchange = decided.case.decision!.exchangeOrder!.id;
      await packAndShip(h.ctx, exchange, { carrierId: colissimo, trackingNumber: '6A12345678902' }, operator);
      const replacement = issued.get((await row(exchange)).product_id!)!;
      await register(buyer, replacement);
      expect(await keysOf(buyer)).toEqual([`PIECE:${first.piece.uuid}`, 'TIER:1']);
    });
  });

  describe('A NEW TIER', () => {
    it('an account holding PLATINE before the deploy reads its status and gets no vault; a tier first reached after it gives one, once', async () => {
      const held = await account();
      // Five pieces held at the migration: 0061 wrote TIER:1 and TIER:2 in vault_occasions_before (the fixture does).
      await holdPieces(db(), held, 5, catalog.modelId, { year: 2024 });
      expect((await db().selectFrom('vault_occasions_before').select('occasion_key').where('account_id', '=', held).orderBy('occasion_key').execute()).map((r) => r.occasion_key)).toEqual(['TIER:1', 'TIER:2']);
      await h.ctx.services.club.status(held);
      expect(await keysOf(held)).toEqual([]);
      // Ten pieces after the deploy: PALLADIUM is first reached now.
      await holdPieces(db(), held, 5, catalog.modelId, { year: 2024, beforeVault: false });
      await h.ctx.services.club.status(held);
      expect(await keysOf(held)).toEqual(['TIER:3']);
      expect(await arrivals(held)).toBe(1);
      await h.ctx.services.club.status(held);
      await h.ctx.services.tierGrants.ensure(held);
      expect((await vaultsOf(held)).length).toBe(1);
      // An account at PLATINE reached after the deploy, without a write that gave it: its status read gives both.
      const late = await account();
      await holdPieces(db(), late, 5, catalog.modelId, { year: 2024, beforeVault: false });
      await h.ctx.services.club.status(late);
      expect(await keysOf(late)).toEqual(['TIER:1', 'TIER:2']);
      // A test entrant never.
      const tester = await account();
      await db().insertInto('test_entrants').values({ account_id: tester }).execute();
      await holdPieces(db(), tester, 5, catalog.modelId, { year: 2024, beforeVault: false });
      await h.ctx.services.club.status(tester);
      expect(await keysOf(tester)).toEqual([]);
    });
  });

  describe('A WORN PHOTOGRAPH PUBLISHED', () => {
    it('gives its sender a vault at the publication, at most one per piece; a photograph taken down keeps it; a refusal gives none', async () => {
      const owner = await account();
      const { piece } = await shippedOrder(owner);
      await register(owner, piece);
      const ownership = await db().selectFrom('ownership').select('id').where('product_id', '=', piece.uuid).where('ended_at', 'is', null).executeTakeFirstOrThrow();
      const photo = Buffer.from('a photograph');
      const send = async () =>
        (
          await db()
            .insertInto('worn_photos')
            .values({
              product_id: piece.uuid,
              ownership_id: ownership.id,
              account_id: owner,
              model_id: catalog.modelId,
              photo,
              photo_mime: 'image/jpeg',
              photo_sha256: createHash('sha256').update(photo).digest('hex'),
              width: 10,
              height: 10,
              credit_first_name: 'Camille',
              credit_country: 'FR',
              consent_at: h.clock.now(),
              consent_version: '2026-10-25',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const refused = await send();
      await h.ctx.services.worn.refuse(refused, 'QUALITY', operator);
      expect(await keysOf(owner)).not.toContain(`WORN:${piece.uuid}`);
      const first = await send();
      await h.ctx.services.worn.publish(first, operator);
      const worn = (await vaultsOf(owner)).filter((v) => v.source === 'WORN');
      expect(worn).toMatchObject([{ product_id: piece.uuid, worn_photo_id: first, occasion_key: `WORN:${piece.uuid}` }]);
      await h.ctx.services.worn.takeDown(first, 'QUALITY', operator);
      const second = await send();
      await h.ctx.services.worn.publish(second, operator);
      expect((await vaultsOf(owner)).filter((v) => v.source === 'WORN')).toMatchObject([{ worn_photo_id: first, revoked_at: null }]);
    });
  });

  describe('A FRIEND’S FIRST PIECE', () => {
    it('the personal link is made once; a sign-up with its code is invited (an unknown code ignored); the friend’s first piece gives the inviter one vault, never at the next', async () => {
      const inviter = await account();
      const { code } = await vault().invitation(inviter);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(await vault().invitation(inviter)).toEqual({ code });
      expect(await inviterOf(db(), code.toLowerCase())).toBe(inviter);
      expect(await inviterOf(db(), 'ZZZZZZZZZZZZ')).toBeNull();
      const signUp = (invite: string | null) =>
        h.ctx.services.auth.registerAccount({ email: `friend-${randomUUID()}@example.com`, password: 'correct horse battery staple', firstName: 'Ana', lastName: 'Silva', country: 'PT', invite });
      const friend = (await signUp(`${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`)).account.id;
      const stranger = (await signUp('ZZZZZZZZZZZZ')).account.id;
      expect(await db().selectFrom('accounts').select(['invited_by', 'invited_at']).where('id', '=', friend).executeTakeFirstOrThrow()).toEqual({ invited_by: inviter, invited_at: h.clock.now() });
      expect(await db().selectFrom('accounts').select('invited_by').where('id', '=', stranger).executeTakeFirstOrThrow()).toEqual({ invited_by: null });
      const audited = await db().selectFrom('audit_logs').select('details').where('action', '=', 'account.register').where('target_id', '=', friend).executeTakeFirstOrThrow();
      expect(audited.details).toMatchObject({ invitedBy: inviter });
      // CREATE ACCOUNT sends it (POST /api/v1/account/register's optional `invite`).
      const email = `joined-${randomUUID()}@example.com`;
      const created = await h.client().post('/api/v1/account/register', { email, password: 'correct horse battery staple', firstName: 'Ines', lastName: 'Costa', country: 'PT', invite: code });
      expect(created.statusCode, created.body).toBe(201);
      expect(await db().selectFrom('accounts').select('invited_by').where('email_normalized', '=', email).executeTakeFirstOrThrow()).toEqual({ invited_by: inviter });
      await register(friend, (await shippedOrder(friend)).piece);
      expect((await vaultsOf(inviter)).map((v) => [v.source, v.friend_account_id])).toEqual([['FRIEND', friend]]);
      await register(friend, (await shippedOrder(friend)).piece);
      expect((await vaultsOf(inviter)).length).toBe(1);
      // A locked account has no link to give.
      const locked = await account();
      await db().updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked).execute();
      await expect(vault().invitation(locked)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    it('a friend who accepted a CREDIT TO GIVE is never invited by it: their first piece gives the giver no FRIEND vault', async () => {
      const giver = await account();
      const v = await vault().give({ source: 'HOUSE', accountId: giver, giftId: randomUUID(), givenBy: admin.id! });
      const reward = await vault().createReward({ kind: 'CREDIT_TO_GIVE', oddsIn: 1, quantity: 5, amountMinor: 3_000, currency: 'EUR' }, operator);
      try {
        const opened = await vault().open(giver, v.vaults[0]!.id);
        const friend = await account();
        await vault().acceptGift(friend, opened.giftCode!);
        expect(await db().selectFrom('accounts').select(['invited_by', 'invited_at']).where('id', '=', friend).executeTakeFirstOrThrow()).toEqual({ invited_by: null, invited_at: null });
        await register(friend, (await shippedOrder(friend)).piece);
        expect((await vaultsOf(giver)).filter((x) => x.source === 'FRIEND')).toEqual([]);
      } finally {
        await vault().deactivateReward(reward.rewards.find((r) => r.kind === 'CREDIT_TO_GIVE')!.id, operator);
      }
    });
  });

  describe('A COMPLETE PROFILE', () => {
    const complete = async (accountId: string, version: number, heard: string) =>
      h.ctx.services.profiles.save(
        accountId,
        { version, firstName: 'Camille', lastName: 'Durand', country: 'FR', city: 'Lyon', phone: { country: 'FR', number: '+33612345678' }, birthDate: '1994-03-14', instagram: '@camille.dl', heard: { optionId: heard } },
        actorOf(accountId),
      );
    const address = (accountId: string) => h.ctx.services.addresses.create(accountId, { name: 'Camille Durand', address: '1 rue de Test\n69001 Lyon', country: 'FR', phone: '+33612345678' }, actorOf(accountId));

    it('a profile completed by a save after the deploy gets one vault (the address book’s first address included), never a second', async () => {
      const heard = (await h.ctx.services.profiles.offeredHeard())[0]!.id;
      // Completed by YOUR PROFILE's save, the address already saved.
      const a = await account();
      await address(a);
      expect(await keysOf(a)).toEqual([]);
      await complete(a, 0, heard);
      expect(await keysOf(a)).toEqual(['PROFILE']);
      expect(await profileMissing(db(), a)).toEqual([]);
      await h.ctx.services.profiles.save(a, { version: 1, city: 'Paris' }, actorOf(a));
      expect((await vaultsOf(a)).length).toBe(1);
      // Completed by the first address, the profile saved before.
      const b = await account();
      await complete(b, 0, heard);
      expect(await keysOf(b)).toEqual([]);
      await address(b);
      expect(await keysOf(b)).toEqual(['PROFILE']);
    });

    it('a profile complete before the deploy and saved again gets no vault', async () => {
      const heard = (await h.ctx.services.profiles.offeredHeard())[0]!.id;
      const a = await account();
      // Before the deploy: no source gave a vault (the PROFILE source off stands for it).
      const before = (await vault().settings()).sources.find((s) => s.source === 'PROFILE')!;
      await vault().setSource('PROFILE', { enabled: false, perOccasion: before.perOccasion, cap: before.cap }, admin);
      try {
        await address(a);
        await complete(a, 0, heard);
      } finally {
        await vault().setSource('PROFILE', { enabled: true, perOccasion: before.perOccasion, cap: before.cap }, admin);
      }
      expect(await profileMissing(db(), a)).toEqual([]);
      await h.ctx.services.profiles.save(a, { version: 1, city: 'Marseille' }, actorOf(a));
      expect(await keysOf(a)).toEqual([]);
    });
  });

  describe('THE HOUSE', () => {
    it('gives one collector (by account or email) or each member of a segment as it reads now, in batches, test entrants and inactive accounts left out and counted', async () => {
      const one = await createAccount(db());
      const byEmail = await vault().giveFromHouse({ email: one.email.toUpperCase(), note: '  For the evening.  ' }, operator);
      expect(byEmail).toMatchObject({ dryRun: false, reach: 1, accounts: 1, vaults: 1, leftOut: { testEntrants: 0, inactive: 0 } });
      expect(await vaultsOf(one.id)).toMatchObject([{ source: 'HOUSE', occasion_key: `HOUSE:${byEmail.giftId}`, given_by: operator.id, note: 'For the evening.', segment_id: null }]);
      await expect(vault().giveFromHouse({ accountId: randomUUID() }, operator)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', httpStatus: 404 });
      await expect(vault().giveFromHouse({ accountId: one.id, segmentId: randomUUID() }, operator)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(vault().giveFromHouse({ accountId: one.id }, actorOf(one.id))).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const members = [await account(), await account()];
      const tester = await account();
      const locked = await account();
      await db().insertInto('test_entrants').values({ account_id: tester }).execute();
      await db().updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked).execute();
      await db().updateTable('accounts').set({ country: 'IS' }).where('id', 'in', [...members, tester, locked]).execute();
      const segment = await h.ctx.services.segments.create({ name: `Iceland ${randomUUID().slice(0, 4)}`, criteria: { match: 'ALL', rules: [{ kind: 'COUNTRY', countries: ['IS'] }] } }, admin);
      const dry = await vault().giveFromHouse({ segmentId: segment.id, dryRun: true }, admin);
      expect(dry).toEqual({ giftId: null, dryRun: true, reach: 2, accounts: 0, vaults: 0, leftOut: { testEntrants: 1, inactive: 1 } });
      expect(await keysOf(members[0]!)).toEqual([]);
      const given = await vault().giveFromHouse({ segmentId: segment.id }, admin);
      expect(given).toMatchObject({ dryRun: false, reach: 2, accounts: 2, vaults: 2, leftOut: { testEntrants: 1, inactive: 1 } });
      for (const m of members) expect(await vaultsOf(m)).toMatchObject([{ source: 'HOUSE', occasion_key: `HOUSE:${given.giftId}`, segment_id: segment.id, given_by: admin.id }]);
      for (const m of [tester, locked]) expect(await vaultsOf(m)).toEqual([]);
      // The segment deleted later: its gifts keep their vaults and lose its id.
      await h.ctx.services.segments.remove(segment.id, admin);
      for (const m of members) expect(await vaultsOf(m)).toMatchObject([{ occasion_key: `HOUSE:${given.giftId}`, segment_id: null }]);
      expect(HOUSE_GIVE_BATCH).toBe(500);
      // THE HOUSE switched off: refused with its words.
      const house = (await vault().settings()).sources.find((s) => s.source === 'HOUSE')!;
      await vault().setSource('HOUSE', { enabled: false, perOccasion: house.perOccasion, cap: house.cap }, admin);
      try {
        await expect(vault().giveFromHouse({ accountId: one.id }, operator)).rejects.toMatchObject({ code: 'VAULT_SOURCE_OFF', httpStatus: 409 });
      } finally {
        await vault().setSource('HOUSE', { enabled: true, perOccasion: house.perOccasion, cap: house.cap }, admin);
      }
    });
  });
});
