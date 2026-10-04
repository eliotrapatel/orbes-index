/**
 * The LIVE RELEASE under concurrency (plan of 2026-10-04, Quality bar 2): simultaneous secures and confirms, the
 * engine's pass racing a customer's action at a deadline, entries racing the line's formation at T0, double presses,
 * a restart mid-turn, and the engine's advisory lock.
 *
 * On PGlite (always) the calls are issued together and the database serialises their transactions: every order must
 * give a correct result. On PostgreSQL (opt-in, a pool of 8: true parallelism) the same cases run, and two engines on
 * two pools show that only one ticks, the other taking over when it stops:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/live-concurrency.test.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADVISORY_LOCK, closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { LiveEngine } from '../../src/server/services/live-engine.js';
import { LiveService } from '../../src/server/services/live.js';
import { createTestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, entriesOf, liveFixture, type LiveFixture, type LiveRelease } from '../support/live.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
type Account = Awaited<ReturnType<typeof accountOfTier>>;
const T0 = new Date('2026-12-07T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1000;

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; url: string | null; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, url: null, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const admin = createDb(adminUrl!);
      const name = `orbes_live_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        url: u.toString(),
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        },
      };
    },
  },
];

/** Every outcome of a batch of calls made together: 'ok' or the code of the refusal. */
async function together(calls: (() => Promise<unknown>)[]): Promise<string[]> {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return settled.map((s) => {
    if (s.status === 'fulfilled') return 'ok';
    if (s.reason instanceof DomainError) return s.reason.code;
    throw s.reason;
  });
}

const sorted = (xs: string[]) => [...xs].sort();

async function until(condition: () => Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`the LIVE RELEASE under concurrency, on ${backend.name}`, () => {
    let handle: Awaited<ReturnType<Backend['open']>>;
    let f: LiveFixture;

    beforeAll(async () => {
      handle = await backend.open();
      f = await liveFixture(handle.db, '2026-12-06T09:00:00.000Z');
    });
    afterAll(() => handle?.close());

    const release = (o: Partial<Parameters<typeof createLiveRelease>[1]> = {}) => {
      f.clock.set('2026-12-06T09:00:00.000Z');
      return createLiveRelease(f, { opensAt: T0, ...o });
    };
    /** Accounts entered in the room, then the line formed at T0: they are returned in the order of the line. */
    async function lineOf(r: LiveRelease, tiers: (0 | 1 | 2 | 3)[]) {
      const people: Account[] = [];
      f.clock.set(at(-60 * SECOND));
      for (const tier of tiers) {
        const a = await accountOfTier(f, tier);
        await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
        people.push(a);
      }
      f.clock.set(T0);
      await f.live.advance(r.id);
      const rows = await entriesOf(handle.db, r.id);
      return rows.map((x) => people.find((p) => p.id === x.account_id)!);
    }
    const token = async (r: LiveRelease, accountId: string) => (await f.live.entry(accountId, r.id))!.turn!.token!;
    const statusOf = async (r: LiveRelease, accountId: string) =>
      (await handle.db.selectFrom('live_entries').select('status').where('drop_id', '=', r.id).where('account_id', '=', accountId).executeTakeFirstOrThrow()).status;
    const held = async (r: LiveRelease) =>
      Number(
        (
          await handle.db
            .selectFrom('live_entries')
            .select((eb) => eb.fn.sum<number>('quantity').as('n'))
            .where('drop_id', '=', r.id)
            .where('status', 'in', ['TURN', 'SECURED', 'CONFIRMED'])
            .executeTakeFirstOrThrow()
        ).n ?? 0,
      );
    const auditCount = async (r: LiveRelease, action: string) =>
      Number((await handle.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).where('target_id', '=', r.id).where('action', '=', action).executeTakeFirstOrThrow()).n);

    it('secures held together never pass the stock, and one turn secures once', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 4 }] });
      const line = await lineOf(r, [3, 2, 2, 1, 0, 0]);
      const turns = line.slice(0, 4);
      const tokens = await Promise.all(turns.map((p) => token(r, p.id)));
      expect(await together(turns.map((p, i) => () => f.live.press(p.id, r.id, tokens[i]!)))).toEqual(['ok', 'ok', 'ok', 'ok']);
      f.clock.set(at(1500));
      const outcomes = await together([...turns.map((p, i) => () => f.live.secure(p.id, r.id, tokens[i]!, p.actor)), () => f.live.secure(turns[0]!.id, r.id, tokens[0]!, turns[0]!.actor)]);
      expect(sorted(outcomes)).toEqual(['LIVE_NOT_YOUR_TURN', 'ok', 'ok', 'ok', 'ok']);
      for (const p of turns) expect(await statusOf(r, p.id)).toBe('SECURED');
      expect(await held(r)).toBe(4);
      expect(await auditCount(r, 'drop.live.secure')).toBe(4);
    });

    it('the last pieces confirmed together end the release once, SOLD_OUT, the line ENDED', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 2 }] });
      const line = await lineOf(r, [3, 2, 1]);
      for (const p of line.slice(0, 2)) {
        f.clock.set(T0);
        await f.live.press(p.id, r.id, await token(r, p.id));
        f.clock.set(at(1500));
        await f.live.secure(p.id, r.id, await token(r, p.id), p.actor);
      }
      f.clock.set(at(5 * SECOND));
      const outcomes = await together([...line.slice(0, 2).map((p) => () => f.live.confirm(p.id, r.id, p.actor)), () => f.live.confirm(line[0]!.id, r.id, line[0]!.actor)]);
      expect(sorted(outcomes)).toEqual(['LIVE_NOT_SECURED', 'ok', 'ok']);
      const d = await handle.db.selectFrom('drops').select(['ended_at', 'ended_reason']).where('id', '=', r.id).executeTakeFirstOrThrow();
      expect(d).toEqual({ ended_at: at(5 * SECOND), ended_reason: 'SOLD_OUT' });
      expect(await statusOf(r, line[2]!.id)).toBe('ENDED');
      expect(await auditCount(r, 'drop.live.end')).toBe(1);
      expect(await auditCount(r, 'drop.live.confirm')).toBe(2);
    });

    it('the engine racing a SECURE at a deadline: before it, secured and never missed; at it, refused and MISSED, never both', async () => {
      for (const offset of [-1, 0]) {
        const r = await release({ sizes: [{ label: '52', stock: 1 }] });
        const [first, second] = await lineOf(r, [3, 0]);
        const t = await token(r, first!.id);
        f.clock.set(at(20 * SECOND));
        await f.live.press(first!.id, r.id, t);
        f.clock.set(at(30 * SECOND + offset));
        const outcomes = await together([() => f.live.secure(first!.id, r.id, t, first!.actor), () => f.live.advance(r.id), () => f.live.advance(r.id)]);
        if (offset < 0) {
          expect(outcomes).toEqual(['ok', 'ok', 'ok']);
          expect(await statusOf(r, first!.id)).toBe('SECURED');
          expect(await statusOf(r, second!.id)).toBe('QUEUED');
        } else {
          expect(outcomes).toEqual(['LIVE_TURN_PASSED', 'ok', 'ok']);
          const row = await handle.db.selectFrom('live_entries').select(['status', 'ended_at', 'secured_at']).where('drop_id', '=', r.id).where('account_id', '=', first!.id).executeTakeFirstOrThrow();
          expect(row).toEqual({ status: 'MISSED', ended_at: at(30 * SECOND), secured_at: null });
          expect(await statusOf(r, second!.id)).toBe('TURN');
        }
        expect(await held(r)).toBe(1);
      }
    });

    it('the engine racing PAY at the end of a hold: before it, confirmed and never expired; at it, refused and EXPIRED', async () => {
      for (const offset of [-1, 0]) {
        const r = await release({ sizes: [{ label: '52', stock: 1 }], addons: [{ label: 'GIFT BOX', priceMinor: 5_000 }] });
        const [first, second] = await lineOf(r, [3, 0]);
        const t = await token(r, first!.id);
        await f.live.press(first!.id, r.id, t);
        f.clock.set(at(1500));
        const secured = await f.live.secure(first!.id, r.id, t, first!.actor);
        await f.live.setAddons(first!.id, r.id, [r.addons[0]!.id], first!.actor);
        f.clock.set(new Date(secured.hold!.expiresAt.getTime() + offset));
        const outcomes = await together([() => f.live.confirm(first!.id, r.id, first!.actor), () => f.live.advance(r.id)]);
        if (offset < 0) {
          expect(outcomes).toEqual(['ok', 'ok']);
          expect(await statusOf(r, first!.id)).toBe('CONFIRMED');
          expect((await f.live.entry(first!.id, r.id))!.addons).toHaveLength(1);
        } else {
          expect(outcomes).toEqual(['LIVE_HOLD_ENDED', 'ok']);
          expect(await statusOf(r, first!.id)).toBe('EXPIRED');
          expect((await f.live.entry(first!.id, r.id))!.addons).toEqual([]);
          expect(await statusOf(r, second!.id)).toBe('TURN');
        }
      }
    });

    it('a piece given back while the engine runs goes to the next in line once', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const line = await lineOf(r, [3, 2, 1, 0]);
      const t = await token(r, line[0]!.id);
      await f.live.press(line[0]!.id, r.id, t);
      f.clock.set(at(1500));
      await f.live.secure(line[0]!.id, r.id, t, line[0]!.actor);
      f.clock.set(at(3 * SECOND));
      expect(await together([() => f.live.release(line[0]!.id, r.id, line[0]!.actor), () => f.live.advance(r.id), () => f.live.advance(r.id), () => f.live.leave(line[3]!.id, r.id, line[3]!.actor)])).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect([await statusOf(r, line[1]!.id), await statusOf(r, line[2]!.id)]).toEqual(['TURN', 'QUEUED']);
      expect(await held(r)).toBe(1);
    });

    it('arrivals at T0 racing the line’s formation: the room first, by its rule, then the arrivals, every place once', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 2 }] });
      f.clock.set(at(-30 * SECOND));
      const room = [];
      for (const tier of [3, 2, 1, 0] as const) {
        const a = await accountOfTier(f, tier);
        await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
        room.push(a);
      }
      const late = [await accountOfTier(f, 3), await accountOfTier(f, 3), await accountOfTier(f, 0)];
      f.clock.set(T0);
      const outcomes = await together([...late.map((a) => () => f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor)), () => f.live.advance(r.id), () => f.live.advance(r.id)]);
      expect(outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
      const rows = await entriesOf(handle.db, r.id);
      expect(rows.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(rows.slice(0, 4).map((x) => x.account_id)).toEqual(room.map((a) => a.id));
      expect(new Set(rows.slice(4).map((x) => x.account_id))).toEqual(new Set(late.map((a) => a.id)));
      expect(await auditCount(r, 'drop.live.queue')).toBe(1);
      expect(rows.map((x) => x.status)).toEqual(['TURN', 'TURN', 'QUEUED', 'QUEUED', 'QUEUED', 'QUEUED', 'QUEUED']);
    });

    it('double presses: the last press counts; a SECURE needs 1.4 s from it', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const [first] = await lineOf(r, [0]);
      const t = await token(r, first!.id);
      f.clock.set(at(SECOND));
      expect(await together([() => f.live.press(first!.id, r.id, t), () => f.live.press(first!.id, r.id, t)])).toEqual(['ok', 'ok']);
      f.clock.set(at(2 * SECOND));
      await f.live.press(first!.id, r.id, t);
      f.clock.set(at(2 * SECOND + 1399));
      // 2.4 s after the first press, but 1.399 s after the last: too short. Two SECUREs together are both refused.
      expect(await together([() => f.live.secure(first!.id, r.id, t, first!.actor), () => f.live.secure(first!.id, r.id, t, first!.actor)])).toEqual(['LIVE_HOLD_TOO_SHORT', 'LIVE_HOLD_TOO_SHORT']);
      // A SECURE 1.4 s after the last press, racing a new press: whichever comes first decides, never both.
      f.clock.set(at(2 * SECOND + 1400));
      const [secure, press] = await together([() => f.live.secure(first!.id, r.id, t, first!.actor), () => f.live.press(first!.id, r.id, t)]);
      const row = await handle.db.selectFrom('live_entries').select(['status', 'gesture_ms', 'press_started_at']).where('drop_id', '=', r.id).executeTakeFirstOrThrow();
      if (secure === 'ok') {
        expect(press).toBe('LIVE_NOT_YOUR_TURN');
        expect([row.status, row.gesture_ms]).toEqual(['SECURED', 1400]);
      } else {
        expect([secure, press]).toEqual(['LIVE_HOLD_TOO_SHORT', 'ok']);
        expect([row.status, row.press_started_at]).toEqual(['TURN', at(2 * SECOND + 1400)]);
      }
    });

    it('a restart mid-turn: the turn’s secret and its deadline survive; the new engine marks the miss at its deadline; a wrong key fails closed', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 2 }] });
      const people: Account[] = [];
      f.clock.set(at(-30 * SECOND));
      for (const tier of [3, 2, 0] as const) {
        const a = await accountOfTier(f, tier);
        await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
        people.push(a);
      }
      // The first process: its engine forms the line and gives the turns, then the process stops mid-turn.
      f.clock.set(T0);
      const first = new LiveEngine({ db: handle.db, live: f.live, connection: handle.url ? 'reserved' : 'shared', tickMs: 20, standbyMs: 50 });
      first.start();
      await until(async () => (await entriesOf(handle.db, r.id)).filter((x) => x.status === 'TURN').length === 2);
      await first.stop();
      expect(first.leading).toBe(false);
      const line = (await entriesOf(handle.db, r.id)).map((x) => people.find((p) => p.id === x.account_id)!);
      const tokenBefore = await token(r, line[0]!.id);
      // The second process: a new service on the same database, the same keys.
      const live = new LiveService({ db: handle.db, audit: f.audit, seedKey: f.seedKey, turnKey: f.turnKey, clock: f.clock.now });
      expect((await live.entry(line[0]!.id, r.id))!.turn!.token).toBe(tokenBefore);
      f.clock.set(at(10 * SECOND));
      await live.press(line[0]!.id, r.id, tokenBefore);
      f.clock.set(at(11500));
      expect((await live.secure(line[0]!.id, r.id, tokenBefore, line[0]!.actor)).status).toBe('SECURED');
      // The other turn ran out while no engine ran: the new engine marks it at its deadline and serves the next.
      f.clock.set(at(3 * 60 * SECOND));
      const second = new LiveEngine({ db: handle.db, live, tickMs: 20, standbyMs: 50, connection: handle.url ? 'reserved' : 'shared' });
      const report = await second.tick();
      expect(report.failed).toBe(0);
      expect(report.releases.find((x) => x.dropId === r.id)).toMatchObject({ missed: 1, turns: 1 });
      const missed = await handle.db.selectFrom('live_entries').select(['status', 'ended_at']).where('drop_id', '=', r.id).where('account_id', '=', line[1]!.id).executeTakeFirstOrThrow();
      expect(missed).toEqual({ status: 'MISSED', ended_at: at(30 * SECOND) });
      expect(await statusOf(r, line[2]!.id)).toBe('TURN');

      // A process with another server secret cannot read the seed: the line is not formed, nothing changes, the
      // engine reports the failure and goes on with the other releases.
      const other = await release({ sizes: [{ label: '52', stock: 1 }] });
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-30 * SECOND));
      await f.live.enter(a.id, other.id, { sizeId: other.sizes[0]!.id }, a.actor);
      const wrong = new LiveService({ db: handle.db, audit: f.audit, seedKey: new Uint8Array(32).fill(7), turnKey: f.turnKey, clock: f.clock.now });
      f.clock.set(T0);
      await expect(wrong.advance(other.id)).rejects.toMatchObject({ code: 'DROP_SEED_UNAVAILABLE', httpStatus: 503 });
      const failing = await new LiveEngine({ db: handle.db, live: wrong }).tick();
      expect(failing.failed).toBeGreaterThanOrEqual(1);
      expect(await statusOf(other, a.id)).toBe('WAITING');
      expect((await f.live.advance(other.id))!.queued).toBe(1);
    });

    it('the engine leads under its advisory lock, ticks, and hands the lock back when it stops', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      f.clock.set(at(-30 * SECOND));
      const a = await accountOfTier(f, 0);
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      f.clock.set(T0);
      const locks = async () =>
        Number(
          (
            await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid = ${ADVISORY_LOCK.LIVE_ENGINE}::oid`.execute(handle.db)
          ).rows[0]!.n,
        );
      const engine = new LiveEngine({ db: handle.db, live: f.live, connection: handle.url ? 'reserved' : 'shared', tickMs: 20, standbyMs: 50 });
      engine.start();
      engine.start();
      await until(async () => (await statusOf(r, a.id)) === 'TURN');
      expect(engine.leading).toBe(true);
      expect(await locks()).toBe(1);
      await engine.stop();
      expect(engine.leading).toBe(false);
      expect(await locks()).toBe(0);
    });

    if (!backend.skip && backend.name === 'PGlite') {
      it('reserves one connection while leading (PostgreSQL’s mode), and gives it back when it stops', async () => {
        const r = await release({ sizes: [{ label: '52', stock: 1 }] });
        f.clock.set(at(-30 * SECOND));
        const a = await accountOfTier(f, 0);
        await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
        f.clock.set(T0);
        const engine = new LiveEngine({ db: handle.db, live: f.live, connection: 'reserved', tickMs: 20, standbyMs: 50 });
        engine.start();
        // PGlite has one connection: while the engine holds it, nothing else runs; its passes run on it.
        await new Promise((resolve) => setTimeout(resolve, 150));
        await engine.stop();
        expect(await statusOf(r, a.id)).toBe('TURN');
      });
    }

    if (backend.name === 'PostgreSQL') {
      it('two processes: only one engine ticks; when it stops, the other takes over', async () => {
        const r = await release({ sizes: [{ label: '52', stock: 1 }], turnSeconds: 10 });
        await lineOf(r, [3, 0]);
        const other = createDb(handle.url!, { poolMax: 2 });
        const liveB = new LiveService({ db: other, audit: f.audit, seedKey: f.seedKey, turnKey: f.turnKey, clock: f.clock.now });
        const a = new LiveEngine({ db: handle.db, live: f.live, connection: 'reserved', tickMs: 20, standbyMs: 50 });
        const b = new LiveEngine({ db: other, live: liveB, connection: 'reserved', tickMs: 20, standbyMs: 50 });
        try {
          a.start();
          await until(async () => a.leading);
          b.start();
          await new Promise((resolve) => setTimeout(resolve, 300));
          expect([a.leading, b.leading]).toEqual([true, false]);
          await a.stop();
          await until(async () => b.leading);
          // b ticks: the first turn runs out and the next gets it.
          f.clock.set(at(11 * SECOND));
          await until(async () => (await entriesOf(handle.db, r.id)).map((x) => x.status).join() === 'MISSED,TURN');
        } finally {
          await a.stop();
          await b.stop();
          await closeDb(other);
        }
      });
    }
  });
}
