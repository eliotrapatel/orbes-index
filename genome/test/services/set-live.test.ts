/**
 * A set's LIVE RELEASE (macro scope of 2026-10-20, K44 T1, T2 and T4; plan MACRO M3 §5.1 and §5.2, step M3.16;
 * services/live.ts, live-room.ts, live-console.ts, live-insights.ts, release-stock.ts):
 *
 *  - created by the console with its set (`setId` in place of `modelId`) and its sizes per piece, each linked to its
 *    piece's model's SKU, its quantity its sets on sale (the smallest of its pieces' totals), « N SETS »; its pieces per
 *    person as sets, within 5 ÷ its pieces; the worded refusals; never an after-room; a set's release stays a set's;
 *  - I'LL BE THERE, ENTER and CHANGE SIZE with a size per piece (422 LIVE_SET_SIZES), its quantity in sets (T4);
 *  - the turns by every size: an entry that does not fit yet holds back its sizes, entries needing other sizes go on, one
 *    that can never be served is passed over; PAY makes one set sale per set, one order per piece (T2); SOLD_OUT by sets;
 *  - LET IN within each of its sizes' free pieces; ADD PIECES to one size of one piece, the sets on sale its smallest
 *    piece's total; the pace with a set;
 *  - the views per piece: the room's pieces and sizes, the public card's set at its stages, the console's board and
 *    entries, the feasibility and the size mix per piece, the insights' sizes per piece; a lock withdraws the interest.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { onSaleOf, removeAccountLiveEntries, setTurns } from '../../src/server/services/live.js';
import { LiveInsightsService } from '../../src/server/services/live-insights.js';
import { LiveRoomService } from '../../src/server/services/live-room.js';
import { createTestDb, type TestDb } from '../support/db.js';
import {
  accountOfTier,
  createLiveRelease,
  createSet,
  createSetLiveRelease,
  liveFixture,
  pieceSize,
  sizedModel,
  type LiveFixture,
  type SetLiveRelease,
} from '../support/live.js';

const MINUTE = 60_000;
type Account = Awaited<ReturnType<typeof accountOfTier>>;

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('the set rule of the turns (pure)', () => {
  const sizes = (o: Record<string, [number, number]>) => new Map(Object.entries(o).map(([k, [free, servable]]) => [k, { free, servable }]));
  const e = (id: string, sizeIds: string[], quantity = 1) => ({ id, sizeIds, quantity });

  it('an entry takes its turn when each of its sizes has free pieces; one that does not fit holds back its sizes, others go on', () => {
    const turns = setTurns([e('E1', ['A', 'X']), e('E2', ['A', 'Y']), e('E3', ['B', 'X']), e('E4', ['B', 'Y'])], sizes({ A: [1, 1], B: [2, 2], X: [2, 2], Y: [1, 1] }));
    // E1 takes A and X; E2 does not fit (A gone) and holds back A and Y; E3 needs neither: it goes on; E4 needs Y: it waits.
    expect(turns.map((t) => t.id)).toEqual(['E1', 'E3']);
  });

  it('passes over an entry that wants more than one of its sizes can ever give; its quantity counts in each size', () => {
    expect(setTurns([e('E1', ['A', 'X'], 2), e('E2', ['A', 'X'])], sizes({ A: [1, 1], X: [3, 3] })).map((t) => t.id)).toEqual(['E2']);
    expect(setTurns([e('E1', ['A', 'X'], 2), e('E2', ['A', 'Y'])], sizes({ A: [3, 3], X: [2, 2], Y: [1, 1] })).map((t) => t.id)).toEqual(['E1', 'E2']);
    // A model's release is the same rule with one size per entry: the first that does not fit stops its size.
    expect(setTurns([e('E1', ['A'], 2), e('E2', ['A']), e('E3', ['B'])], sizes({ A: [1, 2], B: [1, 1] })).map((t) => t.id)).toEqual(['E3']);
  });

  it('sells a set as its scarcest piece: the sets on sale', () => {
    expect(onSaleOf([{ piece: 1, stock: 2 }, { piece: 1, stock: 1 }, { piece: 2, stock: 5 }])).toBe(3);
    expect(onSaleOf([{ piece: null, stock: 2 }, { piece: null, stock: 3 }])).toBe(5);
  });
});

describe('a set\'s LIVE RELEASE (macro scope K44 T1, T2, T4; plan MACRO M3 §5.1)', () => {
  let t: TestDb;
  let f: LiveFixture;
  let ring: string;
  let chain: string;
  let setId: string;
  let room: LiveRoomService;
  let insights: LiveInsightsService;
  let hour = 10;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-12-01T08:00:00.000Z');
    ring = await sizedModel(t.db, 'HALO', ['52', '54']);
    chain = await sizedModel(t.db, 'LINEA', ['45', '50'], 'NECKLACE');
    setId = await createSet(f, [ring, chain]);
    room = new LiveRoomService({ db: t.db, turnKey: f.turnKey, publicOrigin: 'https://verify.orbes.test', clock: f.clock.now });
    insights = new LiveInsightsService({ db: t.db, clock: f.clock.now });
  });
  afterAll(() => t?.close());

  const nameOf = async (id: string) => (await t.db.selectFrom('models').select('name').where('id', '=', id).executeTakeFirstOrThrow()).name;
  /** A new set release, its T0 an hour later than the last one's, the clock an hour before it. */
  async function release(o: Partial<Parameters<typeof createSetLiveRelease>[1]> & { sizes: { piece: number; label: string; stock: number }[] }): Promise<SetLiveRelease & { t0: Date }> {
    hour += 2;
    const t0 = new Date(Date.UTC(2026, 11, 2, hour));
    f.clock.set(t0.getTime() - 60 * MINUTE);
    return { ...(await createSetLiveRelease(f, { setId, opensAt: t0, ...o })), t0 };
  }
  const choose = (r: SetLiveRelease, a: string, b: string) => ({ sizes: [{ piece: 1, sizeId: pieceSize(r, 1, a) }, { piece: 2, sizeId: pieceSize(r, 2, b) }] });
  async function pay(r: { id: string }, a: Account) {
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    return f.live.confirm(a.id, r.id, a.actor);
  }
  const statusOf = async (r: { id: string }, a: Account) =>
    (await t.db.selectFrom('live_entries').select('status').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow()).status;

  it('is created by the console with its set and its sizes per piece, its quantity its sets on sale, « N SETS »; refused in words; stays a set\'s', async () => {
    const t0 = new Date('2026-12-02T09:00:00.000Z');
    f.clock.set('2026-12-02T08:00:00.000Z');
    const base = { title: 'THE PAIR — LIVE', opensAt: t0, closesAt: new Date(t0.getTime() + 60 * MINUTE), priceMinor: 200_000 };
    const sizes = [
      { piece: 1, label: '52', stock: 2 },
      { piece: 1, label: '54', stock: 1 },
      { piece: 2, label: '45', stock: 1 },
      { piece: 2, label: '50', stock: 4 },
    ];
    const lc = f.liveConsole;
    expect(await refusal(lc.create({ ...base, modelId: ring, setId, sizes }, f.admin))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'A release sells a model or a set: give one of them.' });
    expect(await refusal(lc.create({ ...base, sizes }, f.admin))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'A release sells a model or a set: give one of them.' });
    expect(await refusal(lc.create({ ...base, setId, sizes: [{ label: '52', stock: 1 }] }, f.admin))).toMatchObject({ message: 'Each size of a set’s release names its piece, 1 to 4.' });
    expect(await refusal(lc.create({ ...base, setId, sizes: [...sizes, { piece: 3, label: '52', stock: 1 }] }, f.admin))).toMatchObject({ message: 'Each size of a set’s release names its piece, 1 to 2.' });
    expect(await refusal(lc.create({ ...base, setId, sizes: sizes.filter((s) => s.piece === 1) }, f.admin))).toMatchObject({
      message: `Give ${await nameOf(chain)} its sizes: each piece of a set’s release has 1 to 24 sizes.`,
    });
    expect(await refusal(lc.create({ ...base, setId, sizes: [{ piece: 1, label: '45', stock: 1 }, { piece: 2, label: '45', stock: 1 }] }, f.admin))).toMatchObject({ code: 'SIZE_NOT_DECLARED' });
    expect(await refusal(lc.create({ ...base, setId, sizes, perAccount: 6 }, f.admin))).toMatchObject({ message: 'A person secures 1 to 5 sets.' });
    expect(await refusal(lc.create({ ...base, setId: '00000000-0000-4000-8000-000000000000', sizes }, f.admin))).toMatchObject({ code: 'SET_NOT_FOUND', status: 404 });
    expect(await refusal(lc.create({ ...base, setId, sizes, afterRoom: { modelId: ring, priceMinor: 1, sizes: [{ label: '52', stock: 1 }] } }, f.admin))).toMatchObject({ code: 'AFTER_ROOM_SET', status: 409 });
    expect(await t.db.selectFrom('drops').select('id').where('set_id', '=', setId).where('mode', '=', 'LIVE').execute()).toEqual([]);

    const r = await lc.create({ ...base, setId, sizes, perAccount: 2 }, f.admin);
    expect(r).toMatchObject({ quantity: 3, quantityLine: '3 SETS', perAccount: 2, model: { id: setId, type: 'SET', active: true }, afterRoom: null });
    expect(r.set).toMatchObject({ id: setId, pieces: [{ piece: 1, model: { id: ring } }, { piece: 2, model: { id: chain } }] });
    expect(r.sizes.map((s) => [s.piece, s.label, s.stock])).toEqual([[1, '52', 2], [1, '54', 1], [2, '45', 1], [2, '50', 4]]);
    const linked = await t.db.selectFrom('drop_sizes as s').innerJoin('skus as k', 'k.id', 's.sku_id').select(['s.piece', 'k.model_id']).where('s.drop_id', '=', r.id).orderBy('s.position').execute();
    expect(linked.map((x) => [x.piece, x.model_id])).toEqual([[1, ring], [1, ring], [2, chain], [2, chain]]);
    const created = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).where('action', '=', 'drop.live.create').executeTakeFirstOrThrow();
    expect(created.details).toMatchObject({ modelId: null, setId, sizes: ['1:52:2', '1:54:1', '2:45:1', '2:50:4'] });
    expect((await lc.list({ page: 1, pageSize: 50 })).items.find((c) => c.id === r.id)).toMatchObject({ model: { type: 'SET' }, set: { id: setId } });

    // A set's release stays a set's: another set comes with its sizes; never a model; a model's never takes a set.
    expect(await refusal(lc.update(r.id, { modelId: ring }, f.admin))).toMatchObject({ message: 'A set’s release sells its set: its pieces are the set’s.' });
    const other = await createSet(f, [chain, ring], 'THE OTHER PAIR');
    expect(await refusal(lc.update(r.id, { setId: other }, f.admin))).toMatchObject({ message: 'Give the sizes of the new set’s pieces with it.' });
    const moved = await lc.update(r.id, { setId: other, sizes: [{ piece: 1, label: '50', stock: 2 }, { piece: 2, label: '52', stock: 2 }] }, f.admin);
    expect(moved).toMatchObject({ quantity: 2, quantityLine: '2 SETS', model: { id: other } });
    const plain = await createLiveRelease(f, { opensAt: t0, published: false });
    expect(await refusal(lc.update(plain.id, { setId }, f.admin))).toMatchObject({ message: 'A model’s release sells its model: a set is sold by a release of its own.' });
    expect(await refusal(lc.update(plain.id, { sizes: [{ piece: 1, label: '52', stock: 1 }] }, f.admin))).toMatchObject({ message: 'A model’s release gives its sizes without a piece.' });
  });

  it('takes I\'LL BE THERE, ENTER and CHANGE SIZE with a size per piece, its quantity in sets (T4); a lock withdraws its interest', async () => {
    const r = await release({ sizes: [{ piece: 1, label: '52', stock: 2 }, { piece: 1, label: '54', stock: 2 }, { piece: 2, label: '45', stock: 2 }, { piece: 2, label: '50', stock: 2 }] });
    const a = await accountOfTier(f, 1);
    const ringName = await nameOf(ring);
    const chainName = await nameOf(chain);
    expect(await refusal(f.live.setInterest(a.id, r.id, { sizeId: pieceSize(r, 1, '52') }, a.actor))).toMatchObject({ code: 'LIVE_SET_SIZES', status: 422, message: 'Choose a size for each piece of the set.' });
    expect(await refusal(f.live.setInterest(a.id, r.id, { sizes: [{ piece: 1, sizeId: pieceSize(r, 1, '52') }] }, a.actor))).toMatchObject({ message: `Choose a size for ${chainName}.` });
    expect(await refusal(f.live.setInterest(a.id, r.id, { sizes: [{ piece: 1, sizeId: pieceSize(r, 2, '45') }, { piece: 2, sizeId: pieceSize(r, 2, '45') }] }, a.actor))).toMatchObject({
      message: `This size is not offered for ${ringName}.`,
    });
    const interest = await f.live.setInterest(a.id, r.id, choose(r, '52', '45'), a.actor);
    expect(interest).toMatchObject({ size: { id: pieceSize(r, 1, '52'), label: '52' }, sizes: [{ piece: 1, label: '52' }, { piece: 2, label: '45' }] });
    expect((await f.live.setInterest(a.id, r.id, choose(r, '52', '50'), a.actor)).sizes?.map((s) => s.label)).toEqual(['52', '50']);
    await f.live.setInterest(a.id, r.id, choose(r, '52', '50'), a.actor);
    expect((await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).where('action', '=', 'drop.live.interest').orderBy('id').execute()).map((x) => x.details)).toEqual([
      expect.objectContaining({ sizes: [{ piece: 1, sizeId: pieceSize(r, 1, '52') }, { piece: 2, sizeId: pieceSize(r, 2, '45') }] }),
      expect.objectContaining({ sizesBefore: [{ piece: 1, sizeId: pieceSize(r, 1, '52') }, { piece: 2, sizeId: pieceSize(r, 2, '45') }] }),
    ]);
    // The console's board counts it in each of its sizes; withdrawn, nothing is left.
    const board = (await f.liveConsole.board(r.id))!;
    expect(board.sizes.map((s) => [s.piece, s.label, s.interest])).toEqual([[1, '52', 1], [1, '54', 0], [2, '45', 0], [2, '50', 1]]);
    expect(board.totals.interest).toBe(1);
    await f.live.withdrawInterest(a.id, r.id, a.actor);
    expect(await t.db.selectFrom('live_interest_sizes').select('piece').where('drop_id', '=', r.id).execute()).toEqual([]);
    // A lock withdraws an interest in a set's release not opened yet, its sizes per piece first.
    const locked = await accountOfTier(f, 0);
    await f.live.setInterest(locked.id, r.id, choose(r, '54', '45'), locked.actor);
    const gone = await inTransaction(t.db, (tx) => removeAccountLiveEntries(tx, locked.id, f.admin, f.clock.now()));
    expect(gone.interest).toEqual([{ dropId: r.id }]);
    expect(await t.db.selectFrom('live_interest').select('account_id').where('drop_id', '=', r.id).execute()).toEqual([]);

    // The room: ENTER with every piece's size, a quantity in sets (one per person here).
    f.clock.set(r.t0.getTime() - 4 * MINUTE);
    expect(await refusal(f.live.enter(a.id, r.id, { sizeId: pieceSize(r, 1, '52') }, a.actor))).toMatchObject({ code: 'LIVE_SET_SIZES' });
    expect(await refusal(f.live.enter(a.id, r.id, { ...choose(r, '52', '45'), quantity: 2 }, a.actor))).toMatchObject({ code: 'LIVE_QUANTITY_INVALID', message: 'This release offers one set per person.' });
    const entry = await f.live.enter(a.id, r.id, choose(r, '52', '45'), a.actor);
    expect(entry).toMatchObject({ status: 'WAITING', quantity: 1, size: { label: '52' }, sizes: [{ piece: 1, label: '52' }, { piece: 2, label: '45' }] });
    // CHANGE SIZE: any of its pieces, the others kept.
    const changed = await f.live.changeSize(a.id, r.id, { sizes: [{ piece: 2, sizeId: pieceSize(r, 2, '50') }] }, a.actor);
    expect(changed.sizes?.map((s) => s.label)).toEqual(['52', '50']);
    const size = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).where('action', '=', 'drop.live.size').executeTakeFirstOrThrow();
    expect(size.details).toMatchObject({ before: { sizes: [{ piece: 1 }, { piece: 2, sizeId: pieceSize(r, 2, '45') }] }, sizes: [{ piece: 1 }, { piece: 2, sizeId: pieceSize(r, 2, '50') }] });
    expect(await refusal(f.live.changeSize(a.id, r.id, { sizeId: pieceSize(r, 1, '54') }, a.actor))).toMatchObject({ code: 'LIVE_SET_SIZES' });
    // A model's release names one size, never a size per piece.
    const plain = await createLiveRelease(f, { opensAt: new Date(r.t0.getTime() + 60 * MINUTE) });
    expect(await refusal(f.live.setInterest(a.id, plain.id, choose(r, '52', '45'), a.actor))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This release sells one model: choose its size.' });
    // The account's export names each piece's size.
    const { accountLiveData } = await import('../../src/server/services/live.js');
    expect((await accountLiveData(t.db, a.id)).entries.find((x) => x.dropId === r.id)).toMatchObject({ size: '52', sizes: [{ piece: 1, size: '52' }, { piece: 2, size: '50' }] });
  });

  it('gives the turns by every size: an entry that does not fit holds back its sizes, others go on; PAY makes a set sale per set, an order per piece; SOLD_OUT by sets', async () => {
    // 52 × 1 and 54 × 2 for the ring, 45 × 2 and 50 × 1 for the chain: 3 sets on sale.
    const r = await release({ sizes: [{ piece: 1, label: '52', stock: 1 }, { piece: 1, label: '54', stock: 2 }, { piece: 2, label: '45', stock: 2 }, { piece: 2, label: '50', stock: 1 }] });
    // The line by tier: E1 first (PALLADIUM) … E4 last.
    const [e1, e2, e3, e4] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0)];
    f.clock.set(r.t0.getTime() - 4 * MINUTE);
    await f.live.enter(e1!.id, r.id, choose(r, '52', '45'), e1!.actor);
    await f.live.enter(e2!.id, r.id, choose(r, '52', '50'), e2!.actor);
    await f.live.enter(e3!.id, r.id, choose(r, '54', '45'), e3!.actor);
    await f.live.enter(e4!.id, r.id, choose(r, '54', '50'), e4!.actor);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    // E2 waits for 52 and holds 50 back; E3 needs neither and goes on; E4 needs 50 and waits behind E2.
    expect([await statusOf(r, e1!), await statusOf(r, e2!), await statusOf(r, e3!), await statusOf(r, e4!)]).toEqual(['TURN', 'QUEUED', 'TURN', 'QUEUED']);
    expect((await f.live.entry(e4!.id, r.id))!.ahead).toBe(1);

    // The room per piece, its figures in sets; the console's board and line per piece.
    const frame = (await room.frame(r.id))!;
    expect(frame.room).toMatchObject({ quantity: 3, left: 1, held: 2 });
    expect(frame.room.pieces?.map((p) => [p.piece, p.sizes.map((s) => [s.label, s.left, s.held])])).toEqual([
      [1, [['52', 0, 1], ['54', 1, 1]]],
      [2, [['45', 0, 2], ['50', 1, 0]]],
    ]);
    const board = (await f.liveConsole.board(r.id))!;
    expect(board).toMatchObject({ quantity: 3, totals: { stock: 3, left: 1, held: 2, turns: 2, line: 2 } });
    expect(board.pieces?.map((p) => [p.piece, p.stock])).toEqual([[1, 3], [2, 3]]);
    expect(board.sizes.map((s) => [s.piece, s.label, s.turns, s.line])).toEqual([[1, '52', 1, 1], [1, '54', 1, 1], [2, '45', 2, 0], [2, '50', 0, 2]]);
    expect(board.line.find((x) => x.accountId === e2!.id)?.sizes?.map((s) => s.label)).toEqual(['52', '50']);

    // E1 pays: one set sale, an order per piece in its own size, the shipping on the first.
    const paid = await pay(r, e1!);
    expect(paid.status).toBe('CONFIRMED');
    const sale = await t.db.selectFrom('set_sales').selectAll().where('drop_id', '=', r.id).where('account_id', '=', e1!.id).executeTakeFirstOrThrow();
    expect(sale).toMatchObject({ set_id: setId, price_minor: 200_000, currency: 'EUR' });
    const orders = await t.db.selectFrom('orders').select(['model_id', 'size_label', 'set_piece', 'piece', 'with_order_id', 'price_minor']).where('set_sale_id', '=', sale.id).orderBy('set_piece').execute();
    expect(orders.map((o) => [o.model_id, o.size_label, o.set_piece, o.piece])).toEqual([[ring, '52', 1, 1], [chain, '45', 2, 2]]);
    expect(orders[0]!.with_order_id).toBeNull();
    expect(orders[0]!.price_minor! + orders[1]!.price_minor!).toBe(200_000);
    // 52 is confirmed in full: E2 can never be served and is passed over; E4 takes its turn (54 and 50 free).
    await f.live.advance(r.id);
    expect([await statusOf(r, e2!), await statusOf(r, e4!)]).toEqual(['QUEUED', 'TURN']);
    await pay(r, e3!);
    await pay(r, e4!);
    // Three sets confirmed of three on sale: SOLD_OUT, E2 ended.
    expect(await t.db.selectFrom('drops').select(['ended_reason']).where('id', '=', r.id).executeTakeFirstOrThrow()).toEqual({ ended_reason: 'SOLD_OUT' });
    expect(await statusOf(r, e2!)).toBe('ENDED');
    expect(await t.db.selectFrom('orders').select('id').where('drop_id', '=', r.id).execute()).toHaveLength(6);
    expect(await t.db.selectFrom('set_sales').select('id').where('drop_id', '=', r.id).execute()).toHaveLength(3);

    // The insights per piece: a size sold out in a piece, the report's sizes per piece and its sets.
    const d = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    const report = await insights.report(r.id);
    expect(report.sizes.map((s) => [s.piece, s.label, s.stock, s.confirmedPieces])).toEqual([[1, '52', 1, 1], [1, '54', 2, 2], [2, '45', 2, 2], [2, '50', 1, 1]]);
    expect(report.sellOutMs).not.toBeNull();
    // Next time in sets: the three sold and E2's, never served (each set counted once, in its first piece's sizes).
    expect(report.next.quantity).toBe(4);
    expect(report.sizes.find((s) => s.label === '50')).toMatchObject({ unservedPeople: 1, nextDemand: 2 });
    expect(report.reasoning[1]).toMatch(/^Sold out /);
    f.clock.set(d.opens_at.getTime() + 5 * MINUTE);
    const comparison = await insights.comparison(r.id);
    expect(comparison.releases.find((x) => x.current)).toMatchObject({ stock: 3, confirmedPieces: 3 });
  });

  it('lets an entry in within each of its sizes, ADD PIECES raises one size of one piece (the sets on sale its smallest piece\'s total), the pace admits a set entry as any', async () => {
    const r = await release({ sizes: [{ piece: 1, label: '52', stock: 2 }, { piece: 2, label: '45', stock: 1 }], pace: { batch: 1, minutes: 10 } });
    expect((await f.liveConsole.get(r.id)).quantity).toBe(1);
    const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 1)];
    f.clock.set(r.t0.getTime() - 4 * MINUTE);
    await f.live.enter(a!.id, r.id, choose(r, '52', '45'), a!.actor);
    await f.live.enter(b!.id, r.id, choose(r, '52', '45'), b!.actor);
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    // The first batch admits one: A's turn; B waits for its batch.
    expect([await statusOf(r, a!), await statusOf(r, b!)]).toEqual(['TURN', 'QUEUED']);
    expect((await f.live.entry(b!.id, r.id))!.queue).toMatchObject({ place: 1 });
    const entryB = (await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', b!.id).executeTakeFirstOrThrow()).id;
    // 45 has no free piece: LET IN is refused, though 52 has one.
    expect(await refusal(f.live.letIn(r.id, entryB, f.admin))).toMatchObject({ code: 'LIVE_NO_FREE_PIECE' });
    // ADD PIECES to the chain's 45: two sets on sale; the line serves B at once once admitted (LET IN admits it).
    const state = await f.live.addPieces(r.id, pieceSize(r, 2, '45'), 1, f.admin);
    expect(state).toMatchObject({ quantity: 2, sizes: [{ label: '52', stock: 2, piece: 1 }, { label: '45', stock: 2, piece: 2 }] });
    const stock = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).where('action', '=', 'drop.live.stock').executeTakeFirstOrThrow();
    expect(stock.details).toMatchObject({ piece: 2, size: '45', pieces: 1, before: 1, after: 2, quantity: 2, quantityLine: '1 SET' });
    expect(await statusOf(r, b!)).toBe('QUEUED');
    const let_in = await f.live.letIn(r.id, entryB, f.admin);
    expect(let_in).toMatchObject({ status: 'TURN', letIn: true, sizes: [{ piece: 1, label: '52' }, { piece: 2, label: '45' }] });
    // ADD PIECES to the ring: still two sets (the chain's 2 the smallest).
    expect((await f.live.addPieces(r.id, pieceSize(r, 1, '52'), 3, f.admin)).quantity).toBe(2);
    expect((await insights.radar(r.id)).sizes.map((s) => [s.piece, s.label])).toEqual([[1, '52'], [2, '45']]);
  });

  it('PAY makes one set sale per set of the entry (two sets, four orders), and the views and checks read per piece', async () => {
    const r = await release({ sizes: [{ piece: 1, label: '52', stock: 2 }, { piece: 1, label: '54', stock: 1 }, { piece: 2, label: '45', stock: 3 }], perAccount: 2 });
    // Before its name's stage nothing names it; then the set and its pieces, their photographs side by side at theirs.
    const card = (await room.list()).find((c) => c.id === r.id)!;
    expect(card).toMatchObject({ name: expect.stringMatching(/^THE PAIR /), type: 'SET', imageUrl: null, perAccount: 2, quantityLine: '3 SETS' });
    expect(card.set?.pieces.map((p) => [p.piece, p.name])).toEqual([[1, await nameOf(ring)], [2, await nameOf(chain)]]);
    const sheet = await room.sheet(r.id);
    expect('sizes' in sheet ? sheet.sizes.map((s) => [s.piece, s.label]) : null).toEqual([[1, '52'], [1, '54'], [2, '45']]);
    const feasibility = await f.liveConsole.feasibility(r.id);
    expect(feasibility.sizes.map((l) => [l.piece, l.label, l.skuWords])).toEqual([
      [1, '52', `${await nameOf(ring)} · 52`],
      [1, '54', `${await nameOf(ring)} · 54`],
      [2, '45', `${await nameOf(chain)} · 45`],
    ]);
    const mix = await insights.setSizeMix(setId, null);
    expect(mix.pieces.map((p) => [p.piece, p.mix.model.id])).toEqual([[1, ring], [2, chain]]);

    const a = await accountOfTier(f, 2);
    f.clock.set(r.t0.getTime() - 4 * MINUTE);
    await f.live.enter(a.id, r.id, { ...choose(r, '52', '45'), quantity: 2 }, a.actor);
    expect(await refusal(f.live.changeSize(a.id, r.id, { sizes: [{ piece: 1, sizeId: pieceSize(r, 1, '54') }] }, a.actor))).toMatchObject({ code: 'LIVE_SIZE_SOLD_OUT' });
    f.clock.set(r.t0);
    await f.live.advance(r.id);
    const confirmed = await pay(r, a);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', quantity: 2 });
    const sales = await t.db.selectFrom('set_sales').select('id').where('drop_id', '=', r.id).execute();
    expect(sales).toHaveLength(2);
    const orders = await t.db.selectFrom('orders').select(['piece', 'set_piece', 'size_label', 'with_order_id']).where('drop_id', '=', r.id).orderBy('piece').execute();
    expect(orders.map((o) => [o.piece, o.set_piece, o.size_label])).toEqual([[1, 1, '52'], [2, 2, '45'], [3, 1, '52'], [4, 2, '45']]);
    expect(orders.slice(1).every((o) => o.with_order_id !== null)).toBe(true);
    // The live alert of a size sold out names the ring's 52 (its two pieces confirmed).
    const d = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    const signals = await insights.signals(d, f.clock.now());
    expect(signals.alerts.filter((x) => x.kind === 'SIZE_SOLD_OUT').map((x) => x.size?.label)).toEqual(['52']);
  });

  it('counts a set as one per person (T4): a set of three pieces sold 5 per person, two sets making six orders, numbered past the fifth', async () => {
    const third = await sizedModel(t.db, 'ORBIT', ['48', '50']);
    const trio = await createSet(f, [ring, chain, third], 'THE TRIO');
    hour += 2;
    const t0 = new Date(Date.UTC(2026, 11, 2, hour));
    f.clock.set(t0.getTime() - 60 * MINUTE);
    const r = await createSetLiveRelease(f, { setId: trio, opensAt: t0, perAccount: 5, sizes: [{ piece: 1, label: '52', stock: 3 }, { piece: 2, label: '45', stock: 3 }, { piece: 3, label: '48', stock: 3 }] });
    expect(await f.liveConsole.get(r.id)).toMatchObject({ perAccount: 5, quantity: 3 });
    const a = await accountOfTier(f, 2);
    const sizes = { sizes: [{ piece: 1, sizeId: pieceSize(r, 1, '52') }, { piece: 2, sizeId: pieceSize(r, 2, '45') }, { piece: 3, sizeId: pieceSize(r, 3, '48') }] };
    f.clock.set(t0.getTime() - 4 * MINUTE);
    expect(await refusal(f.live.enter(a.id, r.id, { ...sizes, quantity: 6 }, a.actor))).toMatchObject({ code: 'LIVE_QUANTITY_INVALID', message: 'This release offers 1 to 5 sets per person.' });
    await f.live.enter(a.id, r.id, { ...sizes, quantity: 2 }, a.actor);
    f.clock.set(t0);
    await f.live.advance(r.id);
    expect(await pay(r, a)).toMatchObject({ status: 'CONFIRMED', quantity: 2 });
    const orders = await t.db.selectFrom('orders').select(['piece', 'set_piece', 'model_id']).where('drop_id', '=', r.id).orderBy('piece').execute();
    expect(orders.map((o) => [o.piece, o.set_piece, o.model_id])).toEqual([[1, 1, ring], [2, 2, chain], [3, 3, third], [4, 1, ring], [5, 2, chain], [6, 3, third]]);
    expect(await t.db.selectFrom('set_sales').select('id').where('drop_id', '=', r.id).execute()).toHaveLength(2);
  });
});
