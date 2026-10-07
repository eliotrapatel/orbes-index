/**
 * THE HOUSE'S GUARANTEE (plan NEXT-NINE of 2026-10-06, §3.3 IN-01, step 3.1; migration 0029), on the services against a
 * migrated database and a manual clock:
 *
 *  - every refusal of a grant: staff only, an unknown, LOCKED or deleted account, values out of bounds, an unknown
 *    target, a model no longer offered, a chosen release over, closed, an after-room or opening after the validity, no
 *    room (with its figures), a client who already holds a guarantee or a place there;
 *  - what it is set aside for, at the grant and at a publication: a draw and a LIVE RELEASE, a main model covering its
 *    variants and a variant only itself, a collection, the validity against the opening, the grant order while they
 *    fit, never a switch once set aside;
 *  - its computed states (waiting, set aside, entered, used, expired, revoked), never stored;
 *  - a change and a revocation, while bound too (the entry stays as an ordinary one), and never once used;
 *  - carried or expired at a draw, a cancellation and every end of a LIVE RELEASE (sold out, closed, ended, cancelled);
 *  - bound to a LIVE entry already waiting only when its size can still serve it (LIVE stock is checked per size);
 *  - the Grant dialog's defaults (Orders → Settings), ADMIN only;
 *  - the audit log: ids, pieces, dates, shown, whether a note was given; never the note's words.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { endOfParisDay, guaranteeState, GuaranteeService, parisDayPlus } from '../../src/server/services/guarantees.js';
import type { Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createAccount, createCollection, createLiveRelease, createModel, holdPieces, liveFixture, type LiveFixture } from '../support/live.js';

const START = '2026-11-01T09:00:00.000Z';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOTE = 'Met at the Paris boutique: a collector since the first release.';

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e, code).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('the house’s guarantee (IN-01)', () => {
  let t: TestDb;
  let f: LiveFixture;
  let g: GuaranteeService;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, START);
    g = new GuaranteeService({ db: t.db, audit: f.audit, clock: f.clock.now });
  });
  afterAll(() => t.close());

  const now = () => f.clock.now();
  const inDays = (days: number) => new Date(now().getTime() + days * DAY);
  const grant = (accountId: string, input: Partial<Parameters<GuaranteeService['grant']>[1]> & Pick<Parameters<GuaranteeService['grant']>[1], 'scope' | 'targetId'>) =>
    g.grant(accountId, { pieces: 1, validUntil: '2026-12-31', visible: true, ...input }, f.admin);
  /** A draw of `modelId`, opening in `days` days for a day, published unless asked otherwise. */
  async function draw(modelId: string, o: { days?: number; quantity?: number; published?: boolean } = {}) {
    const opensAt = inDays(o.days ?? 2);
    const d = await f.drops.create({ modelId, title: 'A DRAW', quantity: o.quantity ?? 4, opensAt, closesAt: new Date(opensAt.getTime() + DAY), earlyAccessHours: 0 }, f.admin);
    if (o.published !== false) await f.drops.publish(d.id, f.admin);
    return d;
  }
  const row = (id: string) => t.db.selectFrom('house_guarantees').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const audits = async (action: string) =>
    (await t.db.selectFrom('audit_logs').select(['target_id', 'details']).where('action', '=', action).orderBy('id').execute()).map((a) => ({ id: a.target_id, details: a.details as Record<string, unknown> }));
  const stateOf = async (accountId: string, id: string) => (await g.forAccount(accountId)).find((x) => x.id === id)!.state;

  it('is said once valid until the end of a day in Paris, its default from the settings', () => {
    // Winter (UTC+1) and summer (UTC+2) in Paris.
    expect(endOfParisDay('2026-12-31').toISOString()).toBe('2026-12-31T22:59:59.999Z');
    expect(endOfParisDay('2026-07-14').toISOString()).toBe('2026-07-14T21:59:59.999Z');
    expect(() => endOfParisDay('2026-02-30')).toThrow(DomainError);
    expect(parisDayPlus(new Date('2026-11-01T23:30:00Z'), 90)).toBe('2027-01-31');
  });

  it('refuses every grant it cannot keep: staff only, the account, the values, the target, the release and its room, twice', async () => {
    f.clock.set(START);
    const a = await createAccount(t.db);
    const model = await createModel(t.db, 'ORBIT');
    const target = { scope: 'MODEL' as const, targetId: model };
    await rejects(g.grant(a.id, { ...target, pieces: 1, validUntil: '2026-12-31', visible: true }, a.actor), 'FORBIDDEN', 403);
    await rejects(grant('00000000-0000-4000-8000-000000000000', target), 'ACCOUNT_NOT_FOUND', 404);
    const locked = await createAccount(t.db);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    await rejects(grant(locked.id, target), 'ACCOUNT_LOCKED', 403);
    for (const pieces of [0, 6, 1.5]) await rejects(grant(a.id, { ...target, pieces }), 'VALIDATION_FAILED', 400);
    for (const validUntil of ['2026-10-31', '2026-13-01', '2028-12-31', 'soon']) await rejects(grant(a.id, { ...target, validUntil }), 'VALIDATION_FAILED', 400);
    await rejects(grant(a.id, { ...target, note: 'x'.repeat(501) }), 'VALIDATION_FAILED', 400);
    await rejects(grant(a.id, { scope: 'BOUTIQUE' as 'MODEL', targetId: model }), 'VALIDATION_FAILED', 400);
    await rejects(grant(a.id, { scope: 'MODEL', targetId: '00000000-0000-4000-8000-000000000000' }), 'MODEL_NOT_FOUND', 404);
    await rejects(grant(a.id, { scope: 'COLLECTION', targetId: '00000000-0000-4000-8000-000000000000' }), 'COLLECTION_NOT_FOUND', 404);
    await rejects(grant(a.id, { scope: 'RELEASE', targetId: '00000000-0000-4000-8000-000000000000' }), 'DROP_NOT_FOUND', 404);
    const gone = await createModel(t.db, 'GONE');
    await t.db.updateTable('models').set({ active: false }).where('id', '=', gone).execute();
    await rejects(grant(a.id, { scope: 'MODEL', targetId: gone }), 'MODEL_INACTIVE', 409);
    // A chosen release: cancelled or over, its entries closed, an after-room, opening after the validity.
    const cancelled = await draw(model);
    await f.drops.cancel(cancelled.id, f.admin);
    await rejects(grant(a.id, { scope: 'RELEASE', targetId: cancelled.id }), 'GUARANTEE_RELEASE_OVER', 409);
    const ended = await createLiveRelease(f, { opensAt: inDays(1) });
    await t.db.updateTable('drops').set({ ended_at: now(), ended_reason: 'ENDED' }).where('id', '=', ended.id).execute();
    await rejects(grant(a.id, { scope: 'RELEASE', targetId: ended.id }), 'GUARANTEE_RELEASE_OVER', 409);
    const closing = await draw(model, { days: 1 });
    f.clock.set(new Date(Date.parse(START) + 2 * DAY + HOUR));
    await rejects(grant(a.id, { scope: 'RELEASE', targetId: closing.id }), 'GUARANTEE_RELEASE_CLOSED', 409);
    f.clock.set(START);
    const parent = await createLiveRelease(f, { opensAt: inDays(1), afterRoom: { modelId: model, sizes: [{ label: '52', stock: 1 }], priceMinor: 100_000 } as never });
    const afterRoom = await rejects(grant(a.id, { scope: 'RELEASE', targetId: parent.afterRoom!.id }), 'GUARANTEE_RELEASE_CLOSED', 409);
    expect(afterRoom.publicMessage).toBe('An after-room is never covered by a guarantee.');
    const late = await draw(model, { days: 70 });
    await rejects(grant(a.id, { scope: 'RELEASE', targetId: late.id }), 'GUARANTEE_RELEASE_OPENS_LATE', 409);
    // No room: the pieces held or guaranteed, said with the release's figures.
    const small = await draw(model, { quantity: 2 });
    const tooMany = await rejects(grant(a.id, { scope: 'RELEASE', targetId: small.id, pieces: 3 }), 'GUARANTEE_EXCEEDS_RELEASE', 409);
    expect(tooMany.publicMessage).toBe('This release has 2 pieces; 0 are already held or guaranteed.');
    const b = await createAccount(t.db);
    await grant(b.id, { scope: 'RELEASE', targetId: small.id, pieces: 2 });
    expect((await rejects(grant(a.id, { scope: 'RELEASE', targetId: small.id }), 'GUARANTEE_EXCEEDS_RELEASE', 409)).publicMessage).toBe('This release has 2 pieces; 2 are already held or guaranteed.');
    // One ACTIVE guarantee per client and release; a client who already holds a place there likewise.
    const roomy = await draw(model, { quantity: 5 });
    await grant(b.id, { scope: 'RELEASE', targetId: roomy.id });
    await rejects(grant(b.id, { scope: 'RELEASE', targetId: roomy.id }), 'GUARANTEE_ALREADY', 409);
    const live = await createLiveRelease(f, { opensAt: inDays(1), sizes: [{ label: '52', stock: 2 }] });
    expect((await rejects(grant(a.id, { scope: 'RELEASE', targetId: live.id, pieces: 3 }), 'GUARANTEE_EXCEEDS_RELEASE', 409)).publicMessage).toBe('This release has 2 pieces; 0 are already held or guaranteed.');
    // Nothing was written by a refusal.
    expect(await t.db.selectFrom('house_guarantees').select('id').where('account_id', '=', a.id).execute()).toEqual([]);
  });

  it('is set aside at its grant or at the next publication in its scope: a main model covers its variants, a variant itself, a collection its models; never past its validity; in grant order while they fit; never switched', async () => {
    f.clock.set(START);
    const main = await createModel(t.db, 'MONOLITHE');
    await t.db.updateTable('models').set({ variant_label: 'Steel', variant_swatch: '#888888' }).where('id', '=', main).execute();
    const variant = (
      await t.db
        .insertInto('models')
        .values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: `MOB-${Date.now()}`, variant_of: main, variant_label: 'Blue', variant_swatch: '#123456' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const collection = await createCollection(t.db, 'ÉCLIPSE');
    const inCollection = await createModel(t.db, 'ÉCLIPSE RING', collection);
    const [a, b, c, d] = [await createAccount(t.db), await createAccount(t.db), await createAccount(t.db), await createAccount(t.db)];
    const gMain = await grant(a.id, { scope: 'MODEL', targetId: main });
    const gVariant = await grant(b.id, { scope: 'MODEL', targetId: variant });
    const gCollection = await grant(c.id, { scope: 'COLLECTION', targetId: collection });
    const gShort = await grant(d.id, { scope: 'MODEL', targetId: main, validUntil: '2026-11-05' });
    for (const x of [gMain, gVariant, gCollection, gShort]) {
      expect(x.setAsideFor).toBeNull();
      expect(x.guarantee).toMatchObject({ status: 'ACTIVE', state: 'WAITING', release: null });
    }
    // A release of the variant: the main model's guarantee and the variant's own; never one opening after the validity.
    const ofVariant = await draw(variant, { days: 9 });
    expect((await row(gMain.guarantee.id)).covered_drop_id).toBe(ofVariant.id);
    expect((await row(gVariant.guarantee.id)).covered_drop_id).toBe(ofVariant.id);
    expect((await row(gShort.guarantee.id)).covered_drop_id).toBeNull();
    // A variant's guarantee never covers its main model's release; the main model's stays with the first release; the one
    // valid until 5 November takes this release, opening on the 4th.
    const ofMain = await draw(main, { days: 3 });
    expect((await row(gMain.guarantee.id)).covered_drop_id).toBe(ofVariant.id);
    expect((await row(gVariant.guarantee.id)).covered_drop_id).toBe(ofVariant.id);
    expect((await row(gShort.guarantee.id)).covered_drop_id).toBe(ofMain.id);
    expect(await stateOf(a.id, gMain.guarantee.id)).toBe('SET_ASIDE');
    expect((await g.forAccount(a.id))[0]!.release).toEqual({ id: ofVariant.id, title: 'A DRAW', mode: 'DRAW' });
    // A LIVE RELEASE of a model of the collection, published by the console.
    const live = await f.liveConsole.create({ modelId: inCollection, title: 'THE RING', opensAt: inDays(5), closesAt: inDays(6), priceMinor: 100_000, sizes: [{ label: '52', stock: 2 }] } as never, f.admin);
    expect((await row(gCollection.guarantee.id)).covered_drop_id).toBeNull();
    await f.liveConsole.publish(live.id, {}, f.admin);
    expect((await row(gCollection.guarantee.id)).covered_drop_id).toBe(live.id);
    // A grant when a release is published sets it aside at once.
    const e = await createAccount(t.db);
    const now1 = await grant(e.id, { scope: 'MODEL', targetId: main });
    expect(now1.setAsideFor).toEqual({ id: ofMain.id, title: 'A DRAW' });
    // In grant order while they fit: the third waits, then takes the next release; the first never switches.
    const other = await createModel(t.db, 'HALO');
    const r = await draw(other, { days: 10, quantity: 2, published: false });
    const three = [await createAccount(t.db), await createAccount(t.db), await createAccount(t.db)];
    const gs: Awaited<ReturnType<typeof grant>>[] = [];
    for (const x of three) {
      gs.push(await grant(x.id, { scope: 'MODEL', targetId: other }));
      f.clock.advance(1000);
    }
    await f.drops.publish(r.id, f.admin);
    expect(await Promise.all(gs.map(async (x) => (await row(x.guarantee.id)).covered_drop_id))).toEqual([r.id, r.id, null]);
    const earlier = await draw(other, { days: 4, quantity: 2 });
    expect(await Promise.all(gs.map(async (x) => (await row(x.guarantee.id)).covered_drop_id))).toEqual([r.id, r.id, earlier.id]);
    const covers = (await audits('guarantee.cover')).filter((x) => gs.some((y) => y.guarantee.id === x.id));
    expect(covers.map((x) => x.details)).toEqual([
      { accountId: three[0]!.id, dropId: r.id, pieces: 1, by: 'publish' },
      { accountId: three[1]!.id, dropId: r.id, pieces: 1, by: 'publish' },
      { accountId: three[2]!.id, dropId: earlier.id, pieces: 1, by: 'publish' },
    ]);
  });

  it('computes its state, never stores it: waiting, set aside, entered, used, expired, revoked', async () => {
    const base = { status: 'ACTIVE' as const, valid_until: new Date('2026-12-31T22:59:59.999Z'), covered_drop_id: null as string | null };
    const at = new Date('2026-11-01T09:00:00Z');
    expect(guaranteeState(base, null, false, at)).toBe('WAITING');
    expect(guaranteeState({ ...base, covered_drop_id: 'x' }, new Date('2026-12-01T00:00:00Z'), false, at)).toBe('SET_ASIDE');
    expect(guaranteeState({ ...base, covered_drop_id: 'x' }, new Date('2026-12-01T00:00:00Z'), true, at)).toBe('ENTERED');
    // Honoured until its release ends, even past its validity.
    expect(guaranteeState({ ...base, covered_drop_id: 'x' }, new Date('2026-12-30T00:00:00Z'), false, new Date('2027-01-02T00:00:00Z'))).toBe('SET_ASIDE');
    expect(guaranteeState(base, null, false, new Date('2027-01-01T00:00:00Z'))).toBe('EXPIRED');
    expect(guaranteeState({ ...base, covered_drop_id: 'x' }, new Date('2027-02-01T00:00:00Z'), false, new Date('2027-01-01T00:00:00Z'))).toBe('EXPIRED');
    for (const s of ['USED', 'EXPIRED', 'REVOKED'] as const) expect(guaranteeState({ ...base, status: s }, null, false, at)).toBe(s);
    // Through the service: set aside, then entered once its holder enters the draw; the row keeps ACTIVE.
    f.clock.set(START);
    const model = await createModel(t.db, 'STATE');
    const d = await draw(model, { days: 1 });
    const a = await createAccount(t.db);
    const x = await grant(a.id, { scope: 'RELEASE', targetId: d.id, pieces: 2 });
    expect(x.guarantee.state).toBe('SET_ASIDE');
    f.clock.set(new Date(Date.parse(START) + DAY + HOUR));
    await f.drops.enter(a.id, d.id, a.actor);
    expect(await stateOf(a.id, x.guarantee.id)).toBe('ENTERED');
    expect(await t.db.selectFrom('drop_entries').select(['guarantee_id', 'pieces']).where('account_id', '=', a.id).executeTakeFirstOrThrow()).toEqual({ guarantee_id: x.guarantee.id, pieces: 2 });
    expect((await row(x.guarantee.id)).status).toBe('ACTIVE');
    // Waiting past its validity: expired, with no job.
    f.clock.set(START);
    const w = await grant(a.id, { scope: 'MODEL', targetId: await createModel(t.db, 'NEVER'), validUntil: '2026-11-03' });
    f.clock.set('2026-11-04T09:00:00.000Z');
    expect(await stateOf(a.id, w.guarantee.id)).toBe('EXPIRED');
    expect((await row(w.guarantee.id)).status).toBe('ACTIVE');
  });

  it('changes while ACTIVE (its pieces not while its holder has entered, within the room, its validity still covering its release) and is revoked, its entry kept as an ordinary one; never once used', async () => {
    f.clock.set(START);
    const model = await createModel(t.db, 'CHANGE');
    const d = await draw(model, { days: 1, quantity: 3 });
    const [a, b, c] = [await createAccount(t.db), await createAccount(t.db), await createAccount(t.db)];
    const ga = (await grant(a.id, { scope: 'RELEASE', targetId: d.id })).guarantee;
    const gb = (await grant(b.id, { scope: 'RELEASE', targetId: d.id })).guarantee;
    // Its validity still covers its release's opening (2 November): never the 1st.
    await rejects(g.update(ga.id, { validUntil: '2026-11-01' }, f.admin), 'GUARANTEE_RELEASE_OPENS_LATE', 409);
    f.clock.set(new Date(Date.parse(START) + DAY + HOUR));
    await f.drops.enter(a.id, d.id, a.actor);
    await rejects(g.update(ga.id, { pieces: 2 }, f.admin), 'GUARANTEE_IN_USE', 409);
    await rejects(g.update(ga.id, { pieces: 1 }, a.actor), 'FORBIDDEN', 403);
    expect(await g.update(ga.id, { visible: false, note: NOTE }, f.admin)).toMatchObject({ visible: false, note: NOTE, state: 'ENTERED' });
    expect((await audits('guarantee.update')).find((x) => x.id === ga.id)!.details).toEqual({ accountId: a.id, before: { visible: true, noted: false }, after: { visible: false, noted: true } });
    await rejects(g.update(gb.id, { pieces: 3 }, f.admin), 'GUARANTEE_EXCEEDS_RELEASE', 409);
    expect(await g.update(gb.id, { pieces: 2 }, f.admin)).toMatchObject({ pieces: 2 });
    await rejects(g.update('00000000-0000-4000-8000-000000000000', { pieces: 1 }, f.admin), 'GUARANTEE_NOT_FOUND', 404);
    // Revoked while bound: the client's entry stays, an ordinary entry of one piece.
    const revoked = await g.revoke(ga.id, 'Granted by mistake.', f.admin);
    expect(revoked).toMatchObject({ status: 'REVOKED', state: 'REVOKED', revokeNote: 'Granted by mistake.', closedReason: 'REVOKED' });
    expect(await t.db.selectFrom('drop_entries').select(['status', 'guarantee_id', 'pieces']).where('account_id', '=', a.id).executeTakeFirstOrThrow()).toEqual({ status: 'ENTERED', guarantee_id: null, pieces: 1 });
    expect((await audits('guarantee.revoke')).find((x) => x.id === ga.id)!.details).toEqual({ accountId: a.id, coveredDropId: d.id, noted: true });
    await rejects(g.revoke(ga.id, null, f.admin), 'GUARANTEE_CLOSED', 409);
    await rejects(g.update(ga.id, { visible: true }, f.admin), 'GUARANTEE_CLOSED', 409);
    // Used at the draw: never revoked nor changed.
    const gc = (await grant(c.id, { scope: 'RELEASE', targetId: d.id })).guarantee;
    await f.drops.enter(c.id, d.id, c.actor);
    f.clock.set(new Date(Date.parse(START) + 2 * DAY + 2 * HOUR));
    await f.drops.draw(d.id, f.admin);
    await rejects(g.revoke(gc.id, null, f.admin), 'GUARANTEE_USED', 409);
    await rejects(g.update(gc.id, { visible: false }, f.admin), 'GUARANTEE_USED', 409);
    expect(await stateOf(c.id, gc.id)).toBe('USED');
  });

  it('is carried to the next release of its model or collection, or expires with a chosen release, at a draw, a cancellation and every end of a LIVE RELEASE', async () => {
    f.clock.set(START);
    const model = await createModel(t.db, 'CARRY');
    const first = await draw(model, { days: 1 });
    const second = await draw(model, { days: 3 });
    const [a, b] = [await createAccount(t.db), await createAccount(t.db)];
    const carried = (await grant(a.id, { scope: 'MODEL', targetId: model })).guarantee;
    const chosen = (await grant(b.id, { scope: 'RELEASE', targetId: first.id })).guarantee;
    expect((await row(carried.id)).covered_drop_id).toBe(first.id);
    // Drawn without them: the model's carried to the next release, the chosen release's expired with it.
    f.clock.set(new Date(Date.parse(START) + 2 * DAY + HOUR));
    await f.drops.draw(first.id, f.admin);
    expect(await row(carried.id)).toMatchObject({ status: 'ACTIVE', covered_drop_id: second.id });
    expect(await row(chosen.id)).toMatchObject({ status: 'EXPIRED', closed_reason: 'RELEASE_ENDED' });
    expect((await audits('guarantee.carry')).find((x) => x.id === carried.id)!.details).toEqual({ accountId: a.id, from: first.id, to: second.id, reason: 'RELEASE_ENDED' });
    // Cancelled: carried to nothing (it waits), or expired.
    const third = (await grant(b.id, { scope: 'RELEASE', targetId: second.id })).guarantee;
    await f.drops.cancel(second.id, f.admin);
    expect(await row(carried.id)).toMatchObject({ status: 'ACTIVE', covered_drop_id: null, covered_at: null });
    expect(await row(third.id)).toMatchObject({ status: 'EXPIRED', closed_reason: 'RELEASE_CANCELLED' });

    // A LIVE RELEASE sold out, closed, ended by an ADMIN, cancelled: each chosen release's guarantee expires with it.
    f.clock.set(START);
    const T0 = inDays(1);
    const soldOut = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 2 }] });
    const closed = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 1 }] });
    const ended = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 1 }] });
    const toCancel = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 1 }] });
    const holders = [await createAccount(t.db), await createAccount(t.db), await createAccount(t.db), await createAccount(t.db)];
    const ofLive: Awaited<ReturnType<typeof grant>>['guarantee'][] = [];
    for (const [i, r] of [soldOut, closed, ended, toCancel].entries()) ofLive.push((await grant(holders[i]!.id, { scope: 'RELEASE', targetId: r.id })).guarantee);
    // The ended one's holder waits in its room: unbound at the end, its guarantee carried nowhere (a chosen release).
    const model2 = await createModel(t.db, 'CARRY LIVE');
    const live2 = await createLiveRelease(f, { opensAt: T0, modelId: model2, sizes: [{ label: '52', stock: 1 }] });
    const waiting = await createAccount(t.db);
    const ofModel = (await grant(waiting.id, { scope: 'MODEL', targetId: model2 })).guarantee;
    expect((await row(ofModel.id)).covered_drop_id).toBe(live2.id);
    await f.liveConsole.cancel(toCancel.id, f.admin);
    expect(await row(ofLive[3]!.id)).toMatchObject({ status: 'EXPIRED', closed_reason: 'RELEASE_CANCELLED' });
    f.clock.set(new Date(T0.getTime() - 2 * 60_000));
    await f.live.enter(waiting.id, live2.id, { sizeId: live2.sizes[0]!.id }, { type: 'account', id: waiting.id });
    expect(await stateOf(waiting.id, ofModel.id)).toBe('ENTERED');
    await f.live.end(live2.id, f.admin);
    expect(await row(ofModel.id)).toMatchObject({ status: 'ACTIVE', covered_drop_id: null });
    expect((await t.db.selectFrom('live_entries').select(['status', 'guarantee_id']).where('account_id', '=', waiting.id).executeTakeFirstOrThrow())).toEqual({ status: 'ENDED', guarantee_id: null });
    await f.live.end(ended.id, f.admin);
    expect(await row(ofLive[2]!.id)).toMatchObject({ status: 'EXPIRED', closed_reason: 'RELEASE_ENDED' });
    // Sold out: two buyers take both pieces; the holder never came.
    const buyers = [await accountOfTier(f, 0), await accountOfTier(f, 0)];
    for (const x of buyers) await f.live.enter(x.id, soldOut.id, { sizeId: soldOut.sizes[0]!.id }, x.actor);
    f.clock.set(T0);
    await f.live.advance(soldOut.id);
    for (const x of buyers) {
      const token = (await f.live.entry(x.id, soldOut.id))!.turn!.token!;
      await f.live.press(x.id, soldOut.id, token);
      f.clock.advance(1500);
      await f.live.secure(x.id, soldOut.id, token, x.actor);
      await f.live.confirm(x.id, soldOut.id, x.actor);
    }
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', soldOut.id).executeTakeFirstOrThrow()).ended_reason).toBe('SOLD_OUT');
    expect(await row(ofLive[0]!.id)).toMatchObject({ status: 'EXPIRED', closed_reason: 'RELEASE_ENDED' });
    // Closed at its close by the engine.
    f.clock.set(new Date(T0.getTime() + 2 * HOUR));
    await f.live.advance(closed.id);
    expect(await row(ofLive[1]!.id)).toMatchObject({ status: 'EXPIRED', closed_reason: 'RELEASE_ENDED' });
  });

  it('binds an entry already waiting in a LIVE RELEASE only when its size can still serve it; otherwise the entry stays an ordinary one and CHANGE SIZE checks again', async () => {
    f.clock.set(START);
    const model = await createModel(t.db, 'BIND LIVE');
    const T0 = inDays(1);
    const live = await createLiveRelease(f, { opensAt: T0, modelId: model, sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 2 }] });
    const [shown, late] = [await createAccount(t.db), await createAccount(t.db)];
    await grant(shown.id, { scope: 'RELEASE', targetId: live.id });
    f.clock.set(new Date(T0.getTime() - 2 * 60_000));
    // Size 50 holds 1 piece, the shown holder's guaranteed one.
    expect(await f.live.enter(shown.id, live.id, { sizeId: live.sizes[0]!.id }, shown.actor)).toMatchObject({ guaranteed: true });
    await f.live.enter(late.id, live.id, { sizeId: live.sizes[0]!.id }, late.actor);
    // Granted while waiting in size 50: the release has room (3 pieces), its size none: set aside, not bound.
    const lateG = (await grant(late.id, { scope: 'MODEL', targetId: model })).guarantee;
    expect(await row(lateG.id)).toMatchObject({ status: 'ACTIVE', covered_drop_id: live.id });
    const entryOf = () => t.db.selectFrom('live_entries').select(['size_id', 'guarantee_id']).where('account_id', '=', late.id).executeTakeFirstOrThrow();
    expect(await entryOf()).toEqual({ size_id: live.sizes[0]!.id, guarantee_id: null });
    expect(await stateOf(late.id, lateG.id)).toBe('SET_ASIDE');
    expect((await audits('guarantee.grant')).find((x) => x.id === lateG.id)!.details).not.toHaveProperty('entryId');
    // CHANGE SIZE to a size that can serve it: bound.
    expect(await f.live.changeSize(late.id, live.id, { sizeId: live.sizes[1]!.id }, late.actor)).toMatchObject({ guaranteed: true });
    expect(await entryOf()).toEqual({ size_id: live.sizes[1]!.id, guarantee_id: lateG.id });
    expect(await stateOf(late.id, lateG.id)).toBe('ENTERED');
  });

  it('keeps the Grant dialog’s defaults in Orders → Settings: 90 days, 1 piece, shown; set by an ADMIN, audited', async () => {
    f.clock.set(START);
    expect(await g.settings()).toEqual({ validDays: 90, pieces: 1, visible: true, defaultValidUntil: '2027-01-30', updatedAt: null, updatedBy: null });
    await rejects(g.saveSettings({ validDays: 30, pieces: 2, visible: false }, { type: 'account', id: (await createAccount(t.db)).id } as Actor), 'FORBIDDEN', 403);
    for (const bad of [{ validDays: 0, pieces: 1, visible: true }, { validDays: 731, pieces: 1, visible: true }, { validDays: 30, pieces: 6, visible: true }, { validDays: 30, pieces: 1, visible: 'yes' }]) {
      await rejects(g.saveSettings(bad, f.admin), 'VALIDATION_FAILED', 400);
    }
    const saved = await g.saveSettings({ validDays: 30, pieces: 2, visible: false }, f.admin);
    expect(saved).toMatchObject({ validDays: 30, pieces: 2, visible: false, defaultValidUntil: '2026-12-01', updatedBy: { id: f.admin.id } });
    expect((await audits('guarantee.settings')).at(-1)!.details).toEqual({ before: { validDays: 90, pieces: 1, visible: true }, after: { validDays: 30, pieces: 2, visible: false } });
    await g.saveSettings({ validDays: 90, pieces: 1, visible: true }, f.admin);
  });

  it('never writes a note’s words, nor an email, in the audit log', async () => {
    f.clock.set(START);
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, 1, f.modelId);
    const x = await grant(a.id, { scope: 'MODEL', targetId: await createModel(t.db, 'QUIET'), note: NOTE, visible: false });
    await g.update(x.guarantee.id, { note: `${NOTE} Again.` }, f.admin);
    await g.revoke(x.guarantee.id, NOTE, f.admin);
    const logged = JSON.stringify(await t.db.selectFrom('audit_logs').select('details').where('action', 'like', 'guarantee.%').execute());
    expect(logged).not.toContain('Paris boutique');
    expect(logged).not.toContain(a.email);
    expect((await audits('guarantee.grant')).find((y) => y.id === x.guarantee.id)!.details).toMatchObject({ accountId: a.id, scope: 'MODEL', pieces: 1, visible: false, noted: true, coveredDropId: null });
  });
});
