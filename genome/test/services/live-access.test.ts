/**
 * The access rules of a LIVE RELEASE beyond the tier and the pieces (plan LIVE RELEASE+, choices 3, 4, 27 and decision
 * 32; services/live.ts, live-room.ts, live-console.ts), against a migrated database and a manual clock:
 *
 *  - the rules in words: « collectors who have taken part in 3 releases », « selected collectors » (never the segment's
 *    name), joined by « or » with OR, one collector who meets them all with AND; the refusal with the account's count,
 *    or « This release is for selected collectors. » when the segment is all it lacks;
 *  - taking part (the release itself never counted) and the segment, combined with the tier and the pieces by AND or
 *    OR, read at I'LL BE THERE, at the entry and at SECURE, and when the room is read;
 *  - the public page: the rule in words, A SURPRISE IN EVERY BOX as a flag, never the surprise's description;
 *  - the console: the settings (the releases taken part in, the segment, AND or OR, the surprise and its description)
 *    checked, audited, and the release as it reads them; the surprise on each order and piece to make of the release.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { accessAccounts, accessOf, liveRefusal, liveRuleText, type LiveAccessRule } from '../../src/server/services/live.js';
import { GuaranteeService } from '../../src/server/services/guarantees.js';
import { LiveInsightsService } from '../../src/server/services/live-insights.js';
import { LiveRoomService } from '../../src/server/services/live-room.js';
import { SegmentService } from '../../src/server/services/segments.js';
import type { Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, holdPieces, liveFixture, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;

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

const none = { models: [], collection: null };
const rule = (r: Partial<LiveAccessRule>): LiveAccessRule => ({ minTier: 0, ...none, ...r });

describe('the rules in words (choice 4, decision 32)', () => {
  it('says each rule; with AND one collector who meets them all, with OR the rules joined by « or »', () => {
    expect(liveRuleText(rule({ minParticipations: 3 }))).toBe('collectors who have taken part in 3 releases');
    expect(liveRuleText(rule({ minParticipations: 1 }))).toBe('collectors who have taken part in 1 release');
    expect(liveRuleText(rule({ segment: true }))).toBe('selected collectors');
    expect(liveRuleText(rule({ minTier: 2, minParticipations: 3 }))).toBe('owners from PLATINE who have taken part in 3 releases');
    expect(liveRuleText(rule({ minTier: 2, segment: true, minParticipations: 2 }))).toBe('selected owners from PLATINE who have taken part in 2 releases');
    expect(liveRuleText(rule({ segment: true, minParticipations: 3 }))).toBe('selected collectors who have taken part in 3 releases');
    expect(liveRuleText(rule({ minTier: 1, models: [{ id: 'm', name: 'MONOLITHE' }], segment: true }))).toBe('selected owners of MONOLITHE');
    expect(liveRuleText(rule({ minTier: 2, minParticipations: 3, combine: 'OR' }))).toBe('owners from PLATINE or collectors who have taken part in 3 releases');
    expect(liveRuleText(rule({ minParticipations: 3, segment: true, combine: 'OR' }))).toBe('collectors who have taken part in 3 releases or selected collectors');
    expect(liveRuleText(rule({ minTier: 3, models: [{ id: 'm', name: 'MONOLITHE' }], segment: true, combine: 'OR' }))).toBe('owners from PALLADIUM or owners of MONOLITHE or selected collectors');
    // TITANE is any owner: a model named adds nobody to it with OR.
    expect(liveRuleText(rule({ minTier: 1, models: [{ id: 'm', name: 'MONOLITHE' }], combine: 'OR' }))).toBe('owners');
    // Without a rule of its own, OR or AND, every account.
    expect(liveRuleText(rule({ combine: 'OR' }))).toBe('every ORBES account');
    expect(liveRuleText(rule({}))).toBe('every ORBES account');
    // The LIVE plan's own words stay.
    expect(liveRuleText(rule({ minTier: 2, models: [{ id: 'm', name: 'MONOLITHE' }] }))).toBe('owners from PLATINE of MONOLITHE');
  });

  it('refuses with the rule, the releases taken part in, or « This release is for selected collectors. » when the segment is all that lacks', () => {
    const counted = rule({ minParticipations: 3 });
    expect(liveRefusal(counted, { missing: 'PARTICIPATION', participations: 1 })).toBe('This release is for collectors who have taken part in 3 releases. You have taken part in 1 release.');
    expect(liveRefusal(counted, { missing: 'PARTICIPATION', participations: 0 })).toBe('This release is for collectors who have taken part in 3 releases. You have taken part in 0 releases.');
    expect(liveRefusal(rule({ segment: true }), { missing: 'SEGMENT', participations: null })).toBe('This release is for selected collectors.');
    expect(liveRefusal(rule({ minTier: 2, segment: true }), { missing: 'SEGMENT', participations: null })).toBe('This release is for selected collectors.');
    expect(liveRefusal(rule({ minTier: 2, segment: true }), { missing: 'TIER', participations: null })).toBe('This release is for selected owners from PLATINE.');
    expect(liveRefusal(rule({ minTier: 2, minParticipations: 2, combine: 'OR' }), { missing: 'TIER', participations: 1 })).toBe(
      'This release is for owners from PLATINE or collectors who have taken part in 2 releases. You have taken part in 1 release.',
    );
    expect(liveRefusal(rule({ minTier: 2 }))).toBe('This release is for owners from PLATINE.');
  });
});

describe('a release’s rules, read at each step', () => {
  let t: TestDb;
  let f: LiveFixture;
  let room: LiveRoomService;
  let segments: SegmentService;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-01T09:00:00.000Z');
    room = new LiveRoomService({ db: t.db, turnKey: f.turnKey, publicOrigin: 'https://verify.orbes.test', clock: f.clock.now });
    segments = new SegmentService({ db: t.db, audit: f.audit, clock: f.clock.now });
  });
  afterAll(() => t.close());

  /** A draw drawn now, every account of `who` entered in it: each has taken part in one more release. */
  async function pastDraw(who: { id: string; actor: Actor }[]): Promise<string> {
    const T = new Date(f.clock.now().getTime() + MINUTE);
    const d = await f.drops.create({ modelId: f.modelId, title: 'A DRAW', quantity: 1, opensAt: T, closesAt: new Date(T.getTime() + MINUTE), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(d.id, f.admin);
    f.clock.set(new Date(T.getTime() + 1000));
    for (const a of who) await f.drops.enter(a.id, d.id, a.actor);
    f.clock.set(new Date(T.getTime() + 2 * MINUTE));
    await f.drops.draw(d.id, f.admin);
    return d.id;
  }

  const holdAndSecure = async (dropId: string, accountId: string, actor: Actor) => {
    const token = (await f.live.entry(accountId, dropId))!.turn!.token!;
    await f.live.press(accountId, dropId, token);
    f.clock.advance(1500);
    return f.live.secure(accountId, dropId, token, actor);
  };

  it('taking part, at least N releases: counted at I’LL BE THERE, the entry and SECURE, the release itself never', async () => {
    const regular = await accountOfTier(f, 0);
    const newcomer = await accountOfTier(f, 0);
    await pastDraw([regular, newcomer]);
    await pastDraw([regular]);
    const T0 = new Date(f.clock.now().getTime() + 2 * HOUR);
    const r = await createLiveRelease(f, { opensAt: T0, minParticipations: 2, sizes: [{ label: '52', stock: 2 }] });
    expect((await room.sheet(r.id)).phase).toBe('ANNOUNCED');
    expect(await room.sheet(r.id)).toMatchObject({ access: { minTier: 0, text: 'collectors who have taken part in 2 releases' }, surprise: false });
    expect(await accessOf(t.db, (await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow()), newcomer.id, f.clock.now())).toEqual({
      allowed: false,
      tier: 0,
      missing: 'PARTICIPATION',
      participations: 1,
    });
    const refused = await rejects(f.live.setInterest(newcomer.id, r.id, r.sizes[0]!.id, newcomer.actor), 'LIVE_NOT_ELIGIBLE', 403);
    expect(refused.message).toBe('This release is for collectors who have taken part in 2 releases. You have taken part in 1 release.');
    await rejects(room.viewer(newcomer.id, r.id, 'state'), 'LIVE_NOT_ELIGIBLE', 403);
    await f.live.setInterest(regular.id, r.id, r.sizes[0]!.id, regular.actor);
    expect((await room.viewer(regular.id, r.id, 'state')).access).toEqual({ allowed: true, tier: 0, missing: null, participations: 2 });
    // In the room, then in the line at T0: this release is never one of the two.
    f.clock.set(new Date(T0.getTime() - MINUTE));
    await f.live.enter(regular.id, r.id, { sizeId: r.sizes[0]!.id }, regular.actor);
    await rejects(f.live.enter(newcomer.id, r.id, { sizeId: r.sizes[0]!.id }, newcomer.actor), 'LIVE_NOT_ELIGIBLE', 403);
    f.clock.set(T0);
    await f.live.advance(r.id);
    expect((await f.live.access(regular.id, r.id)).access.participations).toBe(2);
    await holdAndSecure(r.id, regular.id, regular.actor);
    expect((await f.live.entry(regular.id, r.id))?.status).toBe('SECURED');
  });

  it('a segment, read live: its members enter; one who leaves it before SECURE is refused « This release is for selected collectors. »', async () => {
    const s = await segments.create({ name: 'Size 60', criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['60'] }] } }, f.admin);
    const member = await accountOfTier(f, 0);
    const [piece] = await holdPieces(t.db, member.id, 1, f.modelId, { variant: '60' });
    const outsider = await accountOfTier(f, 3);
    const T0 = new Date(f.clock.now().getTime() + 2 * HOUR);
    const r = await createLiveRelease(f, { opensAt: T0, accessSegmentId: s.id, sizes: [{ label: '56', stock: 1 }] });
    const sheet = await room.sheet(r.id);
    expect(sheet).toMatchObject({ access: { text: 'selected collectors' } });
    // The segment's name is never said.
    expect(JSON.stringify(sheet)).not.toContain('Size 60');
    const refused = await rejects(f.live.setInterest(outsider.id, r.id, r.sizes[0]!.id, outsider.actor), 'LIVE_NOT_ELIGIBLE', 403);
    expect(refused.message).toBe('This release is for selected collectors.');
    f.clock.set(new Date(T0.getTime() - MINUTE));
    await f.live.enter(member.id, r.id, { sizeId: r.sizes[0]!.id }, member.actor);
    f.clock.set(T0);
    await f.live.advance(r.id);
    // The piece in size 60 leaves the account (its ownership ended): no longer a member, at SECURE.
    await t.db.updateTable('ownership').set({ ended_at: f.clock.now(), ended_reason: 'TRANSFERRED' }).where('product_id', '=', piece!).execute();
    const late = await rejects(holdAndSecure(r.id, member.id, member.actor), 'LIVE_NOT_ELIGIBLE', 403);
    expect(late.message).toBe('This release is for selected collectors.');
  });

  it('AND: every rule; OR: any one, the rules joined by « or » on the page', async () => {
    const s = await segments.create({ name: 'The answer', criteria: { match: 'ALL', rules: [{ kind: 'COUNTRY', countries: ['JP'] }] } }, f.admin);
    const platine = await accountOfTier(f, 2);
    const titane = await accountOfTier(f, 1);
    const japan = await accountOfTier(f, 1);
    await t.db.updateTable('accounts').set({ country: 'JP' }).where('id', 'in', [japan.id]).execute();
    const T0 = new Date(f.clock.now().getTime() + 2 * HOUR);
    const and = await createLiveRelease(f, { opensAt: T0, minTier: 2, accessSegmentId: s.id });
    const or = await createLiveRelease(f, { opensAt: T0, minTier: 2, accessSegmentId: s.id, accessCombine: 'OR' });
    expect(await room.sheet(and.id)).toMatchObject({ access: { text: 'selected owners from PLATINE' } });
    expect(await room.sheet(or.id)).toMatchObject({ access: { text: 'owners from PLATINE or selected collectors' } });
    const andRow = await t.db.selectFrom('drops').selectAll().where('id', '=', and.id).executeTakeFirstOrThrow();
    const orRow = await t.db.selectFrom('drops').selectAll().where('id', '=', or.id).executeTakeFirstOrThrow();
    const now = f.clock.now();
    expect(await accessOf(t.db, andRow, platine.id, now)).toMatchObject({ allowed: false, missing: 'SEGMENT' });
    expect(await accessOf(t.db, andRow, japan.id, now)).toMatchObject({ allowed: false, missing: 'TIER' });
    expect(await accessOf(t.db, orRow, platine.id, now)).toMatchObject({ allowed: true, missing: null });
    expect(await accessOf(t.db, orRow, japan.id, now)).toMatchObject({ allowed: true, missing: null });
    expect(await accessOf(t.db, orRow, titane.id, now)).toMatchObject({ allowed: false, missing: 'TIER' });
    await f.live.setInterest(japan.id, or.id, or.sizes[0]!.id, japan.actor);
    const refused = await rejects(f.live.setInterest(titane.id, or.id, or.sizes[0]!.id, titane.actor), 'LIVE_NOT_ELIGIBLE', 403);
    expect(refused.message).toBe('This release is for owners from PLATINE or selected collectors.');
    expect((await rejects(f.live.setInterest(platine.id, and.id, and.sizes[0]!.id, platine.actor), 'LIVE_NOT_ELIGIBLE')).message).toBe('This release is for selected collectors.');
  });

  it('lets the holder of the house’s guarantee in whatever the rule (plan NEXT-NINE, IN-01): at I’LL BE THERE, the entry, the room and SECURE, its turn used', async () => {
    const s = await segments.create({ name: 'Nobody', criteria: { match: 'ALL', rules: [{ kind: 'COUNTRY', countries: ['IS'] }] } }, f.admin);
    const holder = await accountOfTier(f, 0);
    const outsider = await accountOfTier(f, 0);
    const T0 = new Date(f.clock.now().getTime() + 2 * HOUR);
    const r = await createLiveRelease(f, { opensAt: T0, minTier: 3, accessSegmentId: s.id, minParticipations: 3, sizes: [{ label: '52', stock: 1 }] });
    const row = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    expect(await accessOf(t.db, row, holder.id, f.clock.now())).toMatchObject({ allowed: false, missing: 'TIER' });
    await new GuaranteeService({ db: t.db, audit: f.audit, clock: f.clock.now }).grant(holder.id, { scope: 'RELEASE', targetId: r.id, pieces: 1, validUntil: '2026-12-31', visible: false }, f.admin);
    // Its rule alone would not let it in: the guarantee does, and nothing in the access says why.
    expect(await accessOf(t.db, row, holder.id, f.clock.now())).toEqual({ allowed: true, tier: 0, missing: null, participations: 0 });
    expect(await accessOf(t.db, row, outsider.id, f.clock.now())).toMatchObject({ allowed: false });
    await f.live.setInterest(holder.id, r.id, r.sizes[0]!.id, holder.actor);
    expect((await room.viewer(holder.id, r.id, 'state')).access.allowed).toBe(true);
    await rejects(room.viewer(outsider.id, r.id, 'state'), 'LIVE_NOT_ELIGIBLE', 403);
    f.clock.set(new Date(T0.getTime() - MINUTE));
    await f.live.enter(holder.id, r.id, { sizeId: r.sizes[0]!.id }, holder.actor);
    f.clock.set(T0);
    await f.live.advance(r.id);
    // Its turn used the guarantee: SECURE still lets it through.
    expect((await t.db.selectFrom('house_guarantees').select('status').where('account_id', '=', holder.id).executeTakeFirstOrThrow()).status).toBe('USED');
    await holdAndSecure(r.id, holder.id, holder.actor);
    expect((await f.live.entry(holder.id, r.id))?.status).toBe('SECURED');
  });

  it('counts the accounts the rules let in, in one query, as the entry reads each one: the planner’s eligible collectors', async () => {
    const s = await segments.create({ name: 'Buyers or Italy', criteria: { match: 'ANY', rules: [{ kind: 'SECURED', min: 1 }, { kind: 'COUNTRY', countries: ['IT'] }] } }, f.admin);
    const italy = await accountOfTier(f, 0);
    await t.db.updateTable('accounts').set({ country: 'IT' }).where('id', '=', italy.id).execute();
    const T0 = new Date(f.clock.now().getTime() + 2 * HOUR);
    const variants = [
      await createLiveRelease(f, { opensAt: T0, minTier: 2, minParticipations: 1, accessCombine: 'OR' }),
      await createLiveRelease(f, { opensAt: T0, minParticipations: 2, accessSegmentId: s.id }),
      await createLiveRelease(f, { opensAt: T0, minTier: 1, accessSegmentId: s.id, accessCombine: 'OR' }),
      await createLiveRelease(f, { opensAt: T0, accessModels: [f.modelId], minParticipations: 1 }),
    ];
    const accounts = await t.db.selectFrom('accounts').select('id').where('status', '=', 'ACTIVE').execute();
    const now = f.clock.now();
    for (const v of variants) {
      const row = await t.db.selectFrom('drops').selectAll().where('id', '=', v.id).executeTakeFirstOrThrow();
      const set = (await accessAccounts(t.db, row, now))!;
      for (const a of accounts) expect(set.has(a.id), `${v.id} ${a.id}`).toBe((await accessOf(t.db, row, a.id, now)).allowed);
    }
    // A release of the tier and pieces alone: the planner counts them itself.
    const plain = await createLiveRelease(f, { opensAt: T0, minTier: 2 });
    expect(await accessAccounts(t.db, await t.db.selectFrom('drops').selectAll().where('id', '=', plain.id).executeTakeFirstOrThrow(), now)).toBeNull();
    // The forecast's eligible accounts are those the rules let in.
    const insights = new LiveInsightsService({ db: t.db, clock: f.clock.now });
    const row = await t.db.selectFrom('drops').selectAll().where('id', '=', variants[2]!.id).executeTakeFirstOrThrow();
    expect((await insights.forecast(variants[2]!.id)).eligible).toBe((await accessAccounts(t.db, row, now))!.size);
  });

  it('says A SURPRISE IN EVERY BOX as a flag, never its description; each order and piece to make carries the description', async () => {
    const buyer = await accountOfTier(f, 0);
    const T0 = new Date(f.clock.now().getTime() + 2 * HOUR);
    const r = await createLiveRelease(f, { opensAt: T0, surprise: 'A silk pouch, hand-stitched.' });
    const sheet = await room.sheet(r.id);
    expect(sheet).toMatchObject({ surprise: true });
    expect(JSON.stringify(sheet)).not.toContain('silk');
    expect((await room.list()).find((c) => c.id === r.id)).toMatchObject({ surprise: true });
    f.clock.set(new Date(T0.getTime() - MINUTE));
    await f.live.enter(buyer.id, r.id, { sizeId: r.sizes[0]!.id }, buyer.actor);
    f.clock.set(T0);
    await f.live.advance(r.id);
    await holdAndSecure(r.id, buyer.id, buyer.actor);
    await f.live.confirm(buyer.id, r.id, buyer.actor);
    const order = await t.db.selectFrom('orders').select(['id', 'surprise']).where('live_entry_id', 'in', t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id)).executeTakeFirstOrThrow();
    expect(order.surprise).toBe('A silk pouch, hand-stitched.');
    // No piece in stock: a piece to make, its work sheet with the surprise.
    const bench = await t.db.selectFrom('bench_items').select('surprise').where('order_id', '=', order.id).executeTakeFirstOrThrow();
    expect(bench.surprise).toBe('A silk pouch, hand-stitched.');
  });

  describe('the console’s settings', () => {
    const base = () => ({
      modelId: f.modelId,
      title: 'MONOLITHE — LIVE',
      opensAt: new Date(f.clock.now().getTime() + 3 * HOUR),
      closesAt: new Date(f.clock.now().getTime() + 4 * HOUR),
      priceMinor: 480_000,
      sizes: [{ label: '52', stock: 2 }],
    });

    it('sets the releases taken part in, a segment, AND or OR and the surprise; reads them back; audits them', async () => {
      const s = await segments.create({ name: 'Collectors of record', criteria: { match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] } }, f.admin);
      const created = await f.liveConsole.create({ ...base(), minTier: 2, minParticipations: 3, accessSegmentId: s.id, accessCombine: 'OR', surpriseEnabled: true, surpriseText: '  A silk pouch.  ' }, f.admin);
      expect(created.access).toEqual({
        models: [],
        collection: null,
        minParticipations: 3,
        segment: { id: s.id, name: 'Collectors of record' },
        combine: 'OR',
        text: 'owners from PLATINE or collectors who have taken part in 3 releases or selected collectors',
      });
      expect(created.surprise).toEqual({ enabled: true, text: 'A silk pouch.' });
      const row = await t.db.selectFrom('drops').select(['min_participations', 'access_segment_id', 'access_combine', 'surprise_enabled', 'surprise_text']).where('id', '=', created.id).executeTakeFirstOrThrow();
      expect(row).toEqual({ min_participations: 3, access_segment_id: s.id, access_combine: 'OR', surprise_enabled: true, surprise_text: 'A silk pouch.' });
      const create = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', created.id).where('action', '=', 'drop.live.create').executeTakeFirstOrThrow();
      expect(create.details).toMatchObject({ minParticipations: 3, accessSegmentId: s.id, accessCombine: 'OR', surpriseEnabled: true, surprise: { length: 13 } });
      // The description is internal: the audit keeps its length and fingerprint, never its words.
      expect(JSON.stringify(create.details)).not.toContain('silk');
      // Off: the description is kept for later, the boxes hold nothing.
      const off = await f.liveConsole.update(created.id, { surpriseEnabled: false, minParticipations: null, accessSegmentId: null, accessCombine: 'AND' }, f.admin);
      expect(off.surprise).toEqual({ enabled: false, text: 'A silk pouch.' });
      expect(off.access).toMatchObject({ minParticipations: null, segment: null, combine: 'AND', text: 'owners from PLATINE' });
      const update = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', created.id).where('action', '=', 'drop.live.update').executeTakeFirstOrThrow();
      expect(update.details).toMatchObject({ before: { surpriseEnabled: true, minParticipations: 3, accessCombine: 'OR' }, after: { surpriseEnabled: false, minParticipations: null, accessCombine: 'AND' } });
    });

    it('refuses a surprise without its description, an unknown segment, a count out of bounds, another way to combine', async () => {
      await rejects(f.liveConsole.create({ ...base(), surpriseEnabled: true }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.create({ ...base(), surpriseEnabled: true, surpriseText: 'x'.repeat(501) }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.create({ ...base(), accessSegmentId: '00000000-0000-4000-8000-000000000000' }, f.admin), 'SEGMENT_NOT_FOUND', 404);
      await rejects(f.liveConsole.create({ ...base(), minParticipations: 0 }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.create({ ...base(), minParticipations: 101 }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.create({ ...base(), accessCombine: 'XOR' as never }, f.admin), 'VALIDATION_FAILED', 400);
    });

    it('writes the release’s post of the circle with the rule in words, never the segment’s name', async () => {
      const s = await segments.create({ name: 'Secret circle', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [3] }] } }, f.admin);
      const created = await f.liveConsole.create({ ...base(), accessSegmentId: s.id, minParticipations: 2 }, f.admin);
      await f.liveConsole.publish(created.id, { circlePost: true }, f.admin);
      const post = await t.db.selectFrom('circle_posts').select('body').where('drop_id', '=', created.id).executeTakeFirstOrThrow();
      expect(post.body).toContain('For selected collectors who have taken part in 2 releases.');
      expect(post.body).not.toContain('Secret circle');
    });

    it('writes the release’s post of the circle for every owner when OR opens it beyond the tier, and rewrites a scheduled one', async () => {
      // OR with a rule beside the tier: a TITANE owner who has taken part may enter, so reads the post.
      const open = await f.liveConsole.create({ ...base(), minTier: 3, minParticipations: 2, accessCombine: 'OR' }, f.admin);
      await f.liveConsole.publish(open.id, { circlePost: true }, f.admin);
      const opened = await t.db.selectFrom('circle_posts').select(['body', 'min_tier']).where('drop_id', '=', open.id).executeTakeFirstOrThrow();
      expect(opened.body).toContain('For owners from PALLADIUM or collectors who have taken part in 2 releases.');
      expect(opened.min_tier).toBe(1);
      // OR with the tier alone limits as AND does.
      const alone = await f.liveConsole.create({ ...base(), minTier: 3, accessCombine: 'OR' }, f.admin);
      await f.liveConsole.publish(alone.id, { circlePost: true }, f.admin);
      expect((await t.db.selectFrom('circle_posts').select('min_tier').where('drop_id', '=', alone.id).executeTakeFirstOrThrow()).min_tier).toBe(3);
      // Announced later: the scheduled post follows the rules changed from AND to OR, and back.
      const later = await f.liveConsole.create({ ...base(), announceAt: new Date(f.clock.now().getTime() + HOUR), minTier: 3, minParticipations: 2 }, f.admin);
      await f.liveConsole.publish(later.id, { circlePost: true }, f.admin);
      const scheduled = await t.db.selectFrom('circle_posts').select(['id', 'min_tier']).where('drop_id', '=', later.id).executeTakeFirstOrThrow();
      expect(scheduled.min_tier).toBe(3);
      const minTier = async () => (await t.db.selectFrom('circle_posts').select('min_tier').where('id', '=', scheduled.id).executeTakeFirstOrThrow()).min_tier;
      await f.liveConsole.update(later.id, { accessCombine: 'OR' }, f.admin);
      expect(await minTier()).toBe(1);
      const rewrite = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'circle.post.update').where('target_id', '=', scheduled.id).executeTakeFirstOrThrow();
      expect(rewrite.details).toMatchObject({ before: { minTier: 3 }, after: { minTier: 1 }, by: 'drop.live.update' });
      await f.liveConsole.update(later.id, { accessCombine: 'AND' }, f.admin);
      expect(await minTier()).toBe(3);
    });
  });
});
