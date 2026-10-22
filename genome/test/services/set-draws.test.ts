/**
 * A set's draw (macro scope of 2026-10-20, K44 T1 and T2; plan MACRO M3 §5.1 and §5.2, step M3.15; services/drops.ts):
 *
 *  - created with its set (`setId` in place of `modelId`) and its sizes per piece, each one of its piece's model's sizes,
 *    its quantity in sets; the worded refusals; a set set aside; audited with each size's piece;
 *  - a DRAFT changed per piece, or to another set with its sizes, never to a model (nor a model's to a set); published
 *    only when each piece's sizes add up to the same sets (409 DROP_SET_SIZES_UNEVEN); the house's guarantee never set
 *    aside for it nor used in it;
 *  - ENTER, CHANGE SIZE and RESERVE with a size per piece (422 DROP_SET_SIZES; DROP_SIZE_FULL naming the piece);
 *  - the draw filled by every size (an entry SELECTED while each of its sizes has a piece left), checked from what the
 *    page publishes and the seed; OFFER NEXT the first by rank whose sizes all fit; CONFIRMED making the set sale.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { drawOrder, type AdminDrop, type DrawSizeInput } from '../../src/server/services/drops.js';
import { fromHex } from '../../src/core/bytes.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';

const HOUR = 3_600_000;

async function rejects(p: Promise<unknown>, code: string, status?: number, message?: string): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code, (e as DomainError).publicMessage).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  if (message !== undefined) expect((e as DomainError).publicMessage).toBe(message);
  return e as DomainError;
}

describe('a set\'s draw (macro scope K44 T1, T2; plan MACRO M3 §5.1)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  let ring: { id: string; name: string };
  let chain: { id: string; name: string };
  let setId: string;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    ring = await sizedModel('HALO', ['50', '52', '54']);
    chain = await sizedModel('LINEA', ['45', '50'], 'NECKLACE');
    setId = (await ctx.services.sets.create({ name: `THE PAIR ${randomUUID().slice(0, 6)}`, code: `PAIR-${randomUUID().slice(0, 6).toUpperCase()}`, modelIds: [ring.id, chain.id] }, admin)).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const drops = () => ctx.services.drops;
  const at = (ms: number) => new Date(clock.now().getTime() + ms);
  const auditsOf = (targetId: string, action: string) =>
    t.db.selectFrom('audit_logs').select('details').where('target_id', '=', targetId).where('action', '=', action).orderBy('id').execute();

  /** A model of `type` (its kind the same) whose sizes `labels` are declared, each its own SKU. */
  async function sizedModel(name: string, labels: readonly string[], type: 'RING' | 'NECKLACE' = 'RING'): Promise<{ id: string; name: string }> {
    const prefix = `SET-${randomUUID().slice(0, 8)}`;
    const full = `${name} ${prefix}`;
    const id = (
      await t.db
        .insertInto('models')
        .values({ category_id: 1, name: full, type, sku_prefix: prefix, size_type: type, size_kind: type })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const l of labels) await t.db.insertInto('skus').values({ model_id: id, size_label: l, code: `${prefix}-${l}` }).execute();
    return { id, name: full };
  }

  /** A draw of the set in `sizes` (each with its piece), opening in `opensIn`, published unless asked otherwise. */
  async function setDraw(sizes: DrawSizeInput[], o: { opensIn?: number; early?: number; published?: boolean; set?: string } = {}): Promise<AdminDrop> {
    const opensAt = at(o.opensIn ?? HOUR);
    const d = await drops().create(
      { setId: o.set ?? setId, title: 'THE PAIR — A DRAW', sizes, opensAt, closesAt: new Date(opensAt.getTime() + 2 * HOUR), earlyAccessHours: o.early ?? 0, earlyAccessPlatineHours: o.early ?? 0 },
      admin,
    );
    if (o.published !== false) await drops().publish(d.id, admin);
    return drops().get(d.id);
  }
  const sid = (d: AdminDrop, piece: number, label: string) => d.sizes.find((s) => s.piece === piece && s.label === label)!.id;
  const choose = (d: AdminDrop, a: string, b: string) => ({ sizes: [{ piece: 1, sizeId: sid(d, 1, a) }, { piece: 2, sizeId: sid(d, 2, b) }] });

  it('creates a set\'s draw with its sizes per piece, its quantity in sets; refuses a model and a set together or neither, a size without its piece, a piece without sizes, a size its piece\'s model does not declare, a set set aside; audited', async () => {
    const opensAt = at(HOUR);
    const base = { title: 'A SET DRAW', opensAt, closesAt: new Date(opensAt.getTime() + HOUR) };
    const ok = [{ piece: 1, label: '52', pieces: 2 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 3 }];
    const refused = async (input: Record<string, unknown>, message: string) => {
      await rejects(drops().create({ ...base, ...input } as never, admin), 'VALIDATION_FAILED', 400, message);
    };
    await refused({ modelId: ring.id, setId, sizes: ok }, 'A release sells a model or a set: give one of them.');
    await refused({ sizes: ok }, 'A release sells a model or a set: give one of them.');
    await refused({ setId, sizes: [{ label: '52', pieces: 1 }, { piece: 2, label: '45', pieces: 1 }] }, 'Each size of a set’s release names its piece, 1 to 2.');
    await refused({ setId, sizes: [{ piece: 3, label: '52', pieces: 1 }] }, 'Each size of a set’s release names its piece, 1 to 2.');
    await refused({ setId, sizes: [{ piece: 1, label: '52', pieces: 1 }, { piece: 2, label: '45', pieces: 0 }] }, 'Each piece of a set’s release has 1 to 24 sizes with pieces.');
    await refused({ modelId: ring.id, sizes: [{ piece: 1, label: '52', pieces: 1 }] }, 'A model’s release gives its sizes without a piece.');
    await rejects(drops().create({ ...base, setId: randomUUID(), sizes: ok }, admin), 'SET_NOT_FOUND', 404);
    // A size of the other piece's model: not declared by this piece's.
    await rejects(drops().create({ ...base, setId, sizes: [{ piece: 1, label: '45', pieces: 1 }, { piece: 2, label: '45', pieces: 1 }] }, admin), 'SIZE_NOT_DECLARED', 400);
    // A set set aside takes no new release.
    await ctx.services.sets.setAside(setId, admin);
    await rejects(drops().create({ ...base, setId, sizes: ok }, admin), 'SET_SET_ASIDE', 409);
    await ctx.services.sets.reinstate(setId, admin);
    expect(await t.db.selectFrom('drops').select('id').where('title', '=', 'A SET DRAW').execute()).toEqual([]);

    const d = await drops().create({ ...base, setId, sizes: ok }, admin);
    expect(d.quantity).toBe(3);
    expect(d.model).toEqual({ id: setId, name: d.set!.name, type: 'SET', active: true, variant: null });
    expect(d.set!.pieces.map((p) => [p.piece, p.model.id])).toEqual([
      [1, ring.id],
      [2, chain.id],
    ]);
    expect(d.sizes.map((s) => [s.piece, s.label, s.pieces])).toEqual([
      [1, '52', 2],
      [1, '54', 1],
      [2, '45', 3],
    ]);
    // Each size linked to its piece's model's SKU.
    const linked = await t.db.selectFrom('drop_sizes as s').innerJoin('skus as k', 'k.id', 's.sku_id').select(['s.piece', 's.label', 'k.model_id']).where('s.drop_id', '=', d.id).orderBy('s.position').execute();
    expect(linked).toEqual([
      { piece: 1, label: '52', model_id: ring.id },
      { piece: 1, label: '54', model_id: ring.id },
      { piece: 2, label: '45', model_id: chain.id },
    ]);
    const [audit] = await auditsOf(d.id, 'drop.create');
    expect(audit!.details).toMatchObject({ setId, quantity: 3, sizes: [{ piece: 1, label: '52', pieces: 2 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 3 }] });
    expect(audit!.details).not.toHaveProperty('modelId');
  });

  it('changes a set\'s DRAFT per piece or to another set with its sizes, never to a model (nor a model\'s to a set); publishes it only when each piece adds up to the same sets; no guarantee set aside or used', async () => {
    const holder = await createAccount(t.db);
    const g = await ctx.services.guarantees.grant(holder.id, { scope: 'MODEL', targetId: ring.id, pieces: 1, validUntil: '2026-12-31', visible: true }, admin);
    const d = await setDraw([{ piece: 1, label: '52', pieces: 2 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 2 }], { published: false });
    expect(d.quantity).toBe(2);
    await rejects(
      drops().publish(d.id, admin),
      'DROP_SET_SIZES_UNEVEN',
      409,
      `Each piece’s sizes add up to the same number of sets: ${ring.name} 3, ${chain.name} 2.`,
    );
    await rejects(drops().update(d.id, { modelId: ring.id }, admin), 'VALIDATION_FAILED', 400, 'A set’s release sells its set: its pieces are the set’s.');
    const other = (await ctx.services.sets.create({ name: `THE TRIO ${randomUUID().slice(0, 6)}`, code: `TRIO-${randomUUID().slice(0, 6).toUpperCase()}`, modelIds: [chain.id, ring.id] }, admin)).id;
    await rejects(drops().update(d.id, { setId: other }, admin), 'VALIDATION_FAILED', 400, 'Give the sizes of the new set’s pieces with it.');
    const opensAt = at(HOUR);
    const model = await drops().create({ modelId: ring.id, title: 'A MODEL DRAW', sizes: [{ label: '52', pieces: 1 }], opensAt, closesAt: new Date(opensAt.getTime() + HOUR) }, admin);
    await rejects(drops().update(model.id, { setId }, admin), 'VALIDATION_FAILED', 400, 'A model’s release sells its model: a set is sold by a release of its own.');

    // Another set: its pieces in its order, the sizes linked to them; then back, evened.
    const moved = await drops().update(d.id, { setId: other, sizes: [{ piece: 1, label: '50', pieces: 2 }, { piece: 2, label: '52', pieces: 2 }] }, admin);
    expect([moved.set!.id, moved.quantity, moved.sizes.map((s) => [s.piece, s.label])]).toEqual([other, 2, [[1, '50'], [2, '52']]]);
    const back = await drops().update(d.id, { setId, sizes: [{ piece: 1, label: '52', pieces: 2 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 2 }, { piece: 2, label: '50', pieces: 1 }] }, admin);
    expect([back.set!.id, back.quantity]).toEqual([setId, 3]);
    const updates = await auditsOf(d.id, 'drop.update');
    expect(updates[0]!.details).toMatchObject({ before: { setId }, after: { setId: other } });
    const published = await drops().publish(d.id, admin);
    expect([published.state, published.quantity]).toEqual(['UPCOMING', 3]);
    const [pub] = await auditsOf(d.id, 'drop.publish');
    expect((pub!.details as { sizes: unknown[] }).sizes).toHaveLength(4);
    // The house's guarantee of one of its models is never set aside for it, nor used by its holder's entry.
    expect((await t.db.selectFrom('house_guarantees').select('covered_drop_id').where('id', '=', g.guarantee.id).executeTakeFirstOrThrow()).covered_drop_id).toBeNull();
    clock.advance(HOUR + 60_000);
    const e = await drops().enter(holder.id, d.id, holder.actor, choose(back, '52', '45'));
    expect([e.guaranteed, e.pieces]).toEqual([false, 1]);
    expect((await t.db.selectFrom('drop_entries').select('guarantee_id').where('id', '=', e.id).executeTakeFirstOrThrow()).guarantee_id).toBeNull();
  });

  it('ENTERS with a size per piece, CHANGES any of them, WITHDRAWS and enters again; refuses no sizes, a size alone, a piece missing or twice, a size of another piece; a model\'s draw refuses sizes per piece', async () => {
    const d = await setDraw([{ piece: 1, label: '52', pieces: 1 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 1 }, { piece: 2, label: '50', pieces: 1 }]);
    clock.advance(HOUR + 60_000);
    const a = await createAccount(t.db);
    const enter = (input: Parameters<ReturnType<typeof drops>['enter']>[3]) => drops().enter(a.id, d.id, a.actor, input);
    await rejects(enter({}), 'DROP_SET_SIZES', 422, 'Choose a size for each piece of the set.');
    await rejects(enter({ sizeId: sid(d, 1, '52') }), 'DROP_SET_SIZES', 422, 'Choose a size for each piece of the set.');
    await rejects(enter({ sizes: [{ piece: 1, sizeId: sid(d, 1, '52') }] }), 'DROP_SET_SIZES', 422, `Choose a size for ${chain.name}.`);
    await rejects(enter({ sizes: [{ piece: 1, sizeId: sid(d, 1, '52') }, { piece: 1, sizeId: sid(d, 1, '54') }] }), 'DROP_SET_SIZES', 422, `Choose one size for ${ring.name}.`);
    await rejects(enter({ sizes: [{ piece: 1, sizeId: sid(d, 2, '45') }, { piece: 2, sizeId: sid(d, 2, '50') }] }), 'DROP_SET_SIZES', 422, `This size is not offered for ${ring.name}.`);
    await rejects(enter({ sizes: [{ piece: 3, sizeId: sid(d, 1, '52') }] }), 'DROP_SET_SIZES', 422, 'This set has no such piece.');
    expect(await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).execute()).toEqual([]);

    const e = await enter(choose(d, '52', '45'));
    expect([e.status, e.size, e.sizes]).toEqual([
      'ENTERED',
      null,
      [
        { piece: 1, id: sid(d, 1, '52'), label: '52' },
        { piece: 2, id: sid(d, 2, '45'), label: '45' },
      ],
    ]);
    expect((await auditsOf(d.id, 'drop.enter'))[0]!.details).toMatchObject({ entryId: e.id, sizes: [{ piece: 1, sizeId: sid(d, 1, '52') }, { piece: 2, sizeId: sid(d, 2, '45') }] });
    // The account's entry and the console's entry read its sizes; the console's sizes count it in each.
    expect((await drops().entryFor(a.id, d.id)).entry!.sizes!.map((s) => s.label)).toEqual(['52', '45']);
    const counted = await drops().get(d.id);
    expect(counted.sizes.map((s) => [s.piece, s.label, s.entered])).toEqual([
      [1, '52', 1],
      [1, '54', 0],
      [2, '45', 1],
      [2, '50', 0],
    ]);
    expect((await drops().entries(d.id, { sizeId: sid(d, 2, '45') }, { page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual([e.id]);
    expect((await drops().entries(d.id, { sizeId: sid(d, 2, '50') }, { page: 1, pageSize: 10 })).total).toBe(0);

    // CHANGE SIZE: one piece, the other kept; the same again changes nothing; a size of another piece refused.
    const changed = await drops().changeSize(a.id, d.id, { sizes: [{ piece: 2, sizeId: sid(d, 2, '50') }] }, a.actor);
    expect(changed.sizes!.map((s) => s.label)).toEqual(['52', '50']);
    await drops().changeSize(a.id, d.id, { sizes: [{ piece: 2, sizeId: sid(d, 2, '50') }] }, a.actor);
    const sizeAudits = await auditsOf(d.id, 'drop.size');
    expect(sizeAudits).toHaveLength(1);
    expect(sizeAudits[0]!.details).toMatchObject({ sizes: [{ piece: 2, sizeId: sid(d, 2, '50') }], before: [{ piece: 1, sizeId: sid(d, 1, '52') }, { piece: 2, sizeId: sid(d, 2, '45') }] });
    await rejects(drops().changeSize(a.id, d.id, { sizes: [{ piece: 2, sizeId: sid(d, 1, '54') }] }, a.actor), 'DROP_SET_SIZES', 422);
    await rejects(drops().changeSize(a.id, d.id, { sizeId: sid(d, 1, '54') }, a.actor), 'DROP_SET_SIZES', 422);

    // WITHDRAW keeps its sizes; ENTER again takes new ones, the same row.
    const out = await drops().withdraw(a.id, d.id, a.actor);
    expect([out.status, out.sizes!.map((s) => s.label)]).toEqual(['WITHDRAWN', ['52', '50']]);
    const again = await enter(choose(d, '54', '45'));
    expect([again.id, again.sizes!.map((s) => s.label)]).toEqual([e.id, ['54', '45']]);
    // The right-of-access export lists the sizes per piece.
    const exported = await ctx.services.owners.exportData(a.id, admin);
    expect(exported.dropEntries.find((x) => x.entryId === e.id)!.sizes).toEqual([{ piece: 1, size: '54' }, { piece: 2, size: '45' }]);

    // A model's draw: sizes per piece refused.
    const opensAt = at(-60_000);
    const model = await drops().create({ modelId: ring.id, title: 'A MODEL DRAW', sizes: [{ label: '52', pieces: 1 }], opensAt, closesAt: new Date(opensAt.getTime() + 2 * HOUR) }, admin);
    await drops().publish(model.id, admin);
    await rejects(drops().enter(a.id, model.id, a.actor, { sizes: [{ piece: 1, sizeId: model.sizes[0]!.id }] }), 'VALIDATION_FAILED', 400, 'This release sells one model: choose its size.');
  });

  it('RESERVES every size it takes during the early access: the piece named when one of its sizes is taken, DROP_FULL at the sets; the page says each size\'s pieces and fullness', async () => {
    const d = await setDraw([{ piece: 1, label: '52', pieces: 1 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 2 }], { opensIn: 10 * HOUR, early: 48 });
    const [p1, p2, p3] = [await accountOfTier(f, 3), await accountOfTier(f, 3), await accountOfTier(f, 3)];
    const r1 = await drops().reserve(p1.id, d.id, p1.actor, choose(d, '52', '45'));
    expect([r1.status, r1.reserved, r1.sizes!.map((s) => s.label)]).toEqual(['SELECTED', true, ['52', '45']]);
    await rejects(drops().reserve(p2.id, d.id, p2.actor, choose(d, '52', '45')), 'DROP_SIZE_FULL', 409, `Every ${ring.name} in size 52 has been reserved.`);
    await rejects(drops().reserve(p2.id, d.id, p2.actor, { sizeId: sid(d, 1, '54') }), 'DROP_SET_SIZES', 422);
    await drops().reserve(p2.id, d.id, p2.actor, choose(d, '54', '45'));
    await rejects(drops().reserve(p3.id, d.id, p3.actor, choose(d, '54', '45')), 'DROP_FULL', 409);
    const page = await drops().sheet(d.id);
    expect([page.quantity, page.reserved, page.full]).toEqual([2, 2, true]);
    expect(page.sizes.map((s) => [s.piece, s.label, s.pieces, s.reserved, s.full])).toEqual([
      [1, '52', 1, 1, true],
      [1, '54', 1, 1, true],
      [2, '45', 2, 2, true],
    ]);
    // A place reserved directly keeps its sizes.
    clock.advance(10 * HOUR + 60_000);
    await rejects(drops().changeSize(p1.id, d.id, choose(d, '54', '45'), p1.actor), 'DROP_SIZE_FIXED', 409);
  });

  it('draws by every size (an entry SELECTED while each of its sizes has a piece left, else WAITLISTED), checkable from the page and the seed; OFFER NEXT the first by rank whose sizes all fit; CONFIRMED makes the set sale, one order per piece in its size', async () => {
    const d = await setDraw([{ piece: 1, label: '52', pieces: 1 }, { piece: 1, label: '54', pieces: 1 }, { piece: 2, label: '45', pieces: 1 }, { piece: 2, label: '50', pieces: 1 }]);
    // The tiers fix the draw's order: PALLADIUM, PLATINE, TITANE, then no tier.
    const [p, q, r, s] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0)];
    clock.advance(HOUR + 60_000);
    const entry = new Map<string, string>();
    for (const [a, one, two] of [[p, '52', '45'], [q, '52', '50'], [r, '54', '50'], [s, '54', '50']] as const) entry.set(a.id, (await drops().enter(a.id, d.id, a.actor, choose(d, one, two))).id);
    clock.advance(2 * HOUR);
    const drawn = await drops().draw(d.id, admin);
    expect([drawn.entries, drawn.places, drawn.selected, drawn.waitlisted]).toEqual([4, 2, 2, 2]);
    expect(drawn.sizes.map((z) => [z.piece, z.label, z.places, z.selected, z.waitlisted])).toEqual([
      [1, '52', 1, 1, 1],
      [1, '54', 1, 1, 1],
      [2, '45', 1, 1, 0],
      [2, '50', 1, 1, 2],
    ]);
    const status = async () => new Map((await t.db.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', d.id).execute()).map((x) => [x.id, x.status]));
    const statuses = await status();
    expect([p, q, r, s].map((a) => statuses.get(entry.get(a.id)!))).toEqual(['SELECTED', 'WAITLISTED', 'SELECTED', 'WAITLISTED']);

    // Anyone checks every status from what the page publishes: the seed, each entry's tier, seniority and sizes, each size's pieces.
    const page = await drops().sheet(d.id);
    expect(page.set!.pieces.map((x) => [x.piece, x.name, x.type])).toEqual([
      [1, ring.name, 'RING'],
      [2, chain.name, 'NECKLACE'],
    ]);
    expect(page.model.type).toBe('SET');
    const listed = (await drops().drawEntries(d.id, { page: 1, pageSize: 50 })).items;
    expect(listed.every((x) => x.size === null && x.sizes!.length === 2)).toBe(true);
    const order = drawOrder(listed.map((x) => ({ id: x.id, tier: x.tier as 0 | 1 | 2 | 3, seniority: x.seniority })), fromHex(page.seed!));
    const left = new Map(page.sizes.map((z) => [z.id, z.pieces]));
    const expected = new Map<string, string>();
    for (const o of order) {
      const mine = listed.find((x) => x.id === o.id)!.sizes!.map((z) => z.id);
      const fits = mine.every((z) => left.get(z)! >= 1);
      if (fits) for (const z of mine) left.set(z, left.get(z)! - 1);
      expected.set(o.id, fits ? 'SELECTED' : 'WAITLISTED');
      expect(listed.find((x) => x.id === o.id)!.rank).toBe(o.rank);
    }
    expect(expected).toEqual(statuses);

    // OFFER NEXT: the sets held at the quantity, full; R lapsed, Q (first by rank) still needs 52, held by P: S gets it.
    await rejects(drops().offerNext(d.id, admin), 'DROP_FULL', 409, 'Every piece of this release is held or sold.');
    clock.advance(49 * HOUR);
    await drops().lapse(d.id, entry.get(r.id)!, null, admin);
    const offered = await drops().offerNext(d.id, admin);
    expect([offered.id, offered.status, offered.sizes!.map((z) => z.label)]).toEqual([entry.get(s.id), 'SELECTED', ['54', '50']]);
    expect((await auditsOf(d.id, 'drop.entry.offer'))[0]!.details).toMatchObject({ entryId: entry.get(s.id), sizes: [{ piece: 1, sizeId: sid(d, 1, '54') }, { piece: 2, sizeId: sid(d, 2, '50') }] });
    // P lapsed: Q still waits for 50 (held by S): no entry on the waiting list fits.
    await drops().lapse(d.id, entry.get(p.id)!, null, admin);
    await rejects(drops().offerNext(d.id, admin), 'DROP_FULL', 409, 'No entry on the waiting list fits the pieces left: each of its sizes needs one.');
    await rejects(drops().offerNext(d.id, admin, { sizeId: randomUUID() }), 'DROP_SIZE_UNKNOWN', 404);

    // CONFIRMED: the set sale, one order per piece in its piece's model and size, travelling together.
    const confirmed = await drops().confirm(d.id, entry.get(s.id)!, null, admin);
    expect(confirmed.status).toBe('CONFIRMED');
    const sale = await t.db.selectFrom('set_sales').selectAll().where('drop_id', '=', d.id).executeTakeFirstOrThrow();
    expect([sale.set_id, sale.account_id]).toEqual([setId, s.id]);
    const orders = await t.db
      .selectFrom('orders as o')
      .innerJoin('skus as k', 'k.id', 'o.sku_id')
      .select(['o.id', 'o.set_piece', 'o.model_id', 'k.size_label', 'o.with_order_id', 'o.drop_entry_id'])
      .where('o.set_sale_id', '=', sale.id)
      .orderBy('o.set_piece')
      .execute();
    expect(orders.map((o) => [o.set_piece, o.model_id, o.size_label, o.drop_entry_id])).toEqual([
      [1, ring.id, '54', entry.get(s.id)],
      [2, chain.id, '50', entry.get(s.id)],
    ]);
    expect([orders[0]!.with_order_id, orders[1]!.with_order_id]).toEqual([null, orders[0]!.id]);
  });
});
