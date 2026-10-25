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
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { soldOutSizes } from '../../src/server/services/live.js';
import { giveLiveVaults } from '../../src/server/services/vault.js';
import type { Actor } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import {
  accountOfTier,
  createAccount,
  createLiveRelease,
  createModel,
  createSet,
  createSetLiveRelease,
  entriesOf,
  liveFixture,
  pieceSize,
  sizedModel,
  type LiveFixture,
  type LiveRelease,
} from '../support/live.js';

const SECOND = 1000;
const MINUTE = 60_000;
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
