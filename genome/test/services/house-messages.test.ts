/**
 * The custom house messages (macro scope of 2026-10-20, D24 M2; lot M2 plan §1.3, §1.4, step M2.3;
 * services/house-messages.ts).
 *
 * Pure: a Paris date and time read as an instant (CET, CEST, the night the clocks go back, a time that does not exist),
 * an audience checked (exactly one of a segment and a tier) and named.
 *
 * On the services as createContext wires them (PGlite, the clock fixed): a draft written, refused when its words or
 * audience are not right, changed; its reach counted for a segment and for a tier and above, test entrants and LOCKED
 * accounts out; sent now and scheduled at a Paris time (422 HOUSE_SEND_PAST, the phrase SEND), delivered by the
 * sender's pass at its time and not before, its audience frozen at the delivery and its reach recorded; read and counted
 * read; the SENT guard; cancelled; SEGMENT_IN_USE for a draft and a scheduled message, and a sent one keeping its
 * segment's name once the segment is deleted; a message that cannot be delivered leaving the others go; the audit with
 * the words as their length and SHA-256; the moments' figures and preview; the HouseSender loop.
 *
 * Under concurrency (PGlite always; PostgreSQL in genome-ci, ORBES_TEST_POSTGRES_URL): two senders deliver a scheduled
 * message once (FOR UPDATE SKIP LOCKED).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { AuditService } from '../../src/server/services/audit.js';
import { cleanAudience, HOUSE_SENDER, HouseMessageService, HouseSender, tierAudienceLabel } from '../../src/server/services/house-messages.js';
import { parisLocalInstant } from '../../src/server/services/schedule.js';
import { createManualClock, type Actor, type Logger, type ManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { createAccount, createModel, holdPieces, liveFixtureOn } from '../support/live.js';

const z = (iso: string) => new Date(iso);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('a Paris date and time, and an audience (pure)', () => {
  it('reads YYYY-MM-DDTHH:MM in Paris: CET, CEST, the earlier of a doubled hour, nothing for a time that does not exist', () => {
    expect(parisLocalInstant('2027-01-15T18:00')?.toISOString()).toBe('2027-01-15T17:00:00.000Z');
    expect(parisLocalInstant('2027-07-15T18:00')?.toISOString()).toBe('2027-07-15T16:00:00.000Z');
    // 25 October 2026: 02:30 happens twice (CEST, then CET): the first.
    expect(parisLocalInstant('2026-10-25T02:30')?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(parisLocalInstant('2026-10-25T03:30')?.toISOString()).toBe('2026-10-25T02:30:00.000Z');
    // 28 March 2027: from 02:00 to 03:00 at once.
    expect(parisLocalInstant('2027-03-28T02:30')).toBeNull();
    expect(parisLocalInstant('2027-03-28T03:00')?.toISOString()).toBe('2027-03-28T01:00:00.000Z');
    for (const bad of ['2027-02-30T10:00', '2027-01-15T24:00', '2027-01-15T10:60', '2027-01-15 10:00', '2027-01-15T10:00Z', '']) expect(parisLocalInstant(bad)).toBeNull();
  });

  it('takes exactly one of a segment and a tier (422 HOUSE_AUDIENCE otherwise) and names a tier and above', () => {
    const id = randomUUID();
    expect(cleanAudience({ segmentId: id.toUpperCase() })).toEqual({ segmentId: id });
    expect(cleanAudience({ tier: 2, segmentId: null })).toEqual({ tier: 2 });
    for (const bad of [{}, { segmentId: id, tier: 1 }, null, { segmentId: null, tier: null }]) expect(() => cleanAudience(bad)).toThrow(expect.objectContaining({ code: 'HOUSE_AUDIENCE', httpStatus: 422 }));
    expect(() => cleanAudience({ tier: 4 })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => cleanAudience({ segmentId: 'nope' })).toThrow(expect.objectContaining({ code: 'SEGMENT_NOT_FOUND' }));
    expect([1, 2, 3].map((t) => tierAudienceLabel(t as 1 | 2 | 3))).toEqual(['TITANE and above', 'PLATINE and above', 'PALLADIUM']);
  });
});

describe('the custom house messages (HouseMessageService)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: AppContext;
  let clock: ManualClock;
  let staff: Actor & { id: string };
  let modelId: string;
  const lines: { level: string; o: unknown; msg: unknown }[] = [];
  const log: Logger = {
    info: (o: unknown, msg?: unknown) => void lines.push({ level: 'info', o, msg }),
    warn: (o: unknown, msg?: unknown) => void lines.push({ level: 'warn', o, msg }),
    error: (o: unknown, msg?: unknown) => void lines.push({ level: 'error', o, msg }),
  };

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2027-01-10T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, log, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    const f = await liveFixtureOn(ctx, clock);
    staff = f.admin;
    modelId = f.modelId;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const house = () => ctx.services.houseMessages;
  /** An ACTIVE account holding `pieces` pieces (1 TITANE, 5 PLATINE, 10 PALLADIUM), with a first name when given. */
  const collector = async (pieces: number, firstName?: string) => {
    const a = await createAccount(t.db);
    if (pieces > 0) await holdPieces(t.db, a.id, pieces, modelId);
    if (firstName) await t.db.insertInto('account_profiles').values({ account_id: a.id, first_name: firstName }).execute();
    return a;
  };
  const deliveriesOf = (messageId: string) => t.db.selectFrom('house_deliveries').select(['account_id', 'source', 'dedupe_key', 'delivered_at', 'read_at', 'title', 'body']).where('house_message_id', '=', messageId).execute();
  const audits = (targetId: string) => t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'details']).where('target_type', '=', 'house_message').where('target_id', '=', targetId).orderBy('id').execute();

  it('writes a draft and refuses words or an audience that are not right', async () => {
    const m = await house().create({ title: '  A WORD FROM ORBES  ', body: 'Dear {firstName},\r\n\r\nThe house thanks you.', audience: { tier: 1 } }, staff);
    expect(m).toMatchObject({
      title: 'A WORD FROM ORBES',
      body: 'Dear {firstName},\n\nThe house thanks you.',
      status: 'DRAFT',
      audience: { segmentId: null, tier: 1, label: 'TITANE and above' },
      sendAt: null,
      reach: null,
      read: null,
      shareRead: null,
      createdBy: { id: staff.id },
      sentBy: null,
    });
    expect(typeof m.reachNow).toBe('number');
    const bad = async (input: { title?: unknown; body?: unknown; audience?: unknown }, code: string, status: number) =>
      expect(house().create({ title: 'T', body: 'B', audience: { tier: 1 }, ...input } as never, staff)).rejects.toMatchObject({ code, httpStatus: status });
    await bad({ title: '' }, 'VALIDATION_FAILED', 400);
    await bad({ title: 'ONE\nTWO' }, 'VALIDATION_FAILED', 400);
    await bad({ title: 'T'.repeat(81) }, 'VALIDATION_FAILED', 400);
    await bad({ body: '   ' }, 'VALIDATION_FAILED', 400);
    await bad({ body: 'B'.repeat(2001) }, 'VALIDATION_FAILED', 400);
    // {firstName} is a custom message's only placeholder.
    await bad({ body: '{piece} is yours.' }, 'HOUSE_PLACEHOLDER', 422);
    await bad({ audience: {} }, 'HOUSE_AUDIENCE', 422);
    await bad({ audience: { tier: 1, segmentId: randomUUID() } }, 'HOUSE_AUDIENCE', 422);
    await bad({ audience: { segmentId: randomUUID() } }, 'SEGMENT_NOT_FOUND', 404);
    await expect(house().create({ title: 'T', body: 'B', audience: { tier: 1 } }, { type: 'account', id: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(house().message(randomUUID())).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_NOT_FOUND', httpStatus: 404 });
  });

  it('counts an audience now: a segment or a tier and above, ACTIVE accounts only, never a test entrant', async () => {
    const [platine, entrant, locked] = [await collector(5), await collector(5), await collector(5)];
    await t.db.insertInto('test_entrants').values({ account_id: entrant.id, tier: 2 }).execute();
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    const before = { 1: (await house().count({ tier: 1 })).count, 2: (await house().count({ tier: 2 })).count, 3: (await house().count({ tier: 3 })).count };
    const s = await ctx.services.segments.create({ name: 'Size M', criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['M'] }] } }, staff);
    expect(await house().count({ segmentId: s.id })).toEqual({ count: 0 });
    for (const a of [platine, entrant, locked]) await holdPieces(t.db, a.id, 1, modelId, { variant: 'M' });
    expect(await house().count({ segmentId: s.id })).toEqual({ count: 1 });
    // The tiers counted alike: a new TITANE adds to TITANE and above only.
    const extra = await collector(1);
    expect((await house().count({ tier: 1 })).count).toBe(before[1] + 1);
    expect((await house().count({ tier: 2 })).count).toBe(before[2]);
    expect((await house().count({ tier: 3 })).count).toBe(before[3]);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', extra.id).execute();
  });

  it('schedules at a Paris time, delivers at it and not before, the audience frozen at the delivery, and counts who read it', async () => {
    clock.set('2027-02-01T09:00:00Z');
    const s = await ctx.services.segments.create({ name: 'Size 61', criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['61'] }] } }, staff);
    const [camille, nobody, leaves, entrant] = [await collector(1, 'Camille'), await collector(1), await collector(1), await collector(1)];
    for (const a of [camille, nobody, leaves, entrant]) await holdPieces(t.db, a.id, 1, modelId, { variant: '61' });
    await t.db.insertInto('test_entrants').values({ account_id: entrant.id, tier: 1 }).execute();
    const m = await house().create({ title: 'FOR {firstName}', body: 'Dear {firstName},\n\nA word for the size 61.', audience: { segmentId: s.id } }, staff);
    expect(m.reachNow).toBe(3);

    // The phrase, a time past, a time that does not exist, too far ahead.
    await expect(house().send(m.id, { at: '2027-02-01T18:00', phrase: 'send it' }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(house().send(m.id, { at: '2027-02-01T09:59', phrase: 'SEND' }, staff)).rejects.toMatchObject({ code: 'HOUSE_SEND_PAST', httpStatus: 422 });
    await expect(house().send(m.id, { at: '2027-03-28T02:30', phrase: 'SEND' }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(house().send(m.id, { at: '2028-02-03T10:00', phrase: 'SEND' }, staff)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // 18:00 Paris (CET): 17:00 UTC.
    const scheduled = await house().send(m.id, { at: '2027-02-01T18:00', phrase: 'send' }, staff);
    expect(scheduled).toMatchObject({ status: 'SCHEDULED', sendAt: z('2027-02-01T17:00:00Z'), sentBy: { id: staff.id }, reach: null, reachNow: 3 });

    // Before its time: nothing.
    clock.set('2027-02-01T16:59:59Z');
    expect(await house().deliverDue(clock.now())).toEqual({ messages: 0, deliveries: 0 });
    // One is locked and one joins the segment before the time: the audience is read at the delivery.
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', leaves.id).execute();
    const joins = await collector(1);
    await holdPieces(t.db, joins.id, 1, modelId, { variant: '61' });
    clock.set('2027-02-01T17:00:30Z');
    expect(await house().deliverDue(clock.now())).toEqual({ messages: 1, deliveries: 3 });
    const delivered = await deliveriesOf(m.id);
    expect(delivered.map((d) => d.account_id).sort()).toEqual([camille.id, nobody.id, joins.id].sort());
    for (const d of delivered) expect(d).toMatchObject({ source: 'CUSTOM', dedupe_key: `CUSTOM:${m.id}:${d.account_id}`, delivered_at: z('2027-02-01T17:00:30Z'), read_at: null, title: null, body: null });
    // Frozen: one who joins after the delivery receives nothing, a second pass nothing again.
    const late = await collector(1);
    await holdPieces(t.db, late.id, 1, modelId, { variant: '61' });
    expect(await house().deliverDue(clock.now())).toEqual({ messages: 0, deliveries: 0 });
    expect(await deliveriesOf(m.id)).toHaveLength(3);
    expect(lines.some((l) => l.msg === 'house messages' && (l.o as { deliveries?: number }).deliveries === 3)).toBe(true);

    // The collector reads it with its first name filled; nobody without one reads none.
    const page = await house().list(camille.id);
    expect(page.messages[0]).toMatchObject({ source: 'CUSTOM', moment: null, title: 'FOR Camille', body: 'Dear Camille,\n\nA word for the size 61.', pieceRef: null, unread: true });
    expect((await house().list(nobody.id)).messages[0]).toMatchObject({ title: 'FOR', body: 'Dear ,\n\nA word for the size 61.' });
    expect((await house().list(late.id)).total).toBe(0);

    // Sent: its reach, then who read it.
    expect(await house().message(m.id)).toMatchObject({ status: 'SENT', sentAt: z('2027-02-01T17:00:30Z'), reach: 3, read: 0, shareRead: 0, reachNow: null, audience: { segmentId: s.id, label: 'Size 61' } });
    clock.set('2027-02-01T18:00:00Z');
    await house().markRead(camille.id, clock.now());
    expect(await house().message(m.id)).toMatchObject({ reach: 3, read: 1, shareRead: 1 / 3 });
    const listed = await house().messages({ status: 'SENT' }, { page: 1, pageSize: 50 });
    expect(listed.items.find((x) => x.id === m.id)).toMatchObject({ reach: 3, read: 1 });

    // Once sent it never changes: edit, reschedule, cancel, delete.
    await expect(house().update(m.id, { title: 'AGAIN' }, staff)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_SENT', httpStatus: 409 });
    await expect(house().send(m.id, { phrase: 'SEND' }, staff)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_SENT' });
    await expect(house().cancel(m.id, staff)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_SENT' });
    await expect(house().remove(m.id, staff)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_SENT' });
    // And the database holds it so too.
    await expect(t.db.updateTable('house_messages').set({ title: 'CHANGED' }).where('id', '=', m.id).execute()).rejects.toThrow();

    // The audit: the words as their length and SHA-256, the audience as the segment's id; the delivery by the system.
    const trail = await audits(m.id);
    expect(trail.map((a) => a.action)).toEqual(['house.message.create', 'house.message.schedule', 'house.message.delivered']);
    expect(trail[0]!.details).toEqual({
      title: { length: 15, sha256: sha('FOR {firstName}') },
      body: { length: 'Dear {firstName},\n\nA word for the size 61.'.length, sha256: sha('Dear {firstName},\n\nA word for the size 61.') },
      audience: { segmentId: s.id },
    });
    expect(trail[1]!.details).toEqual({ sendAt: '2027-02-01T17:00:00.000Z', audience: { segmentId: s.id }, reach: 3, rescheduled: false });
    expect([trail[2]!.actor_type, trail[2]!.details]).toEqual(['system', { id: m.id, reach: 3 }]);
    const text = JSON.stringify(trail);
    expect(text).not.toMatch(/FOR |Dear|Camille|size 61|@example\.com/);
  });

  it('sends now: the next pass delivers it; edits, reschedules and cancels a scheduled one; deletes only a draft', async () => {
    clock.set('2027-03-01T09:00:00Z');
    const a = await collector(10);
    const now = await house().create({ title: 'NOW', body: 'For PALLADIUM.', audience: { tier: 3 } }, staff);
    const sent = await house().send(now.id, { phrase: 'SEND' }, staff);
    expect(sent).toMatchObject({ status: 'SCHEDULED', sendAt: z('2027-03-01T09:00:00Z') });
    // The minute under way counts as now: 09:00 typed at 09:00:40 sends now.
    clock.set('2027-03-01T09:00:40Z');
    const sameMinute = await house().create({ title: 'SAME MINUTE', body: 'Words.', audience: { tier: 3 } }, staff);
    expect(await house().send(sameMinute.id, { at: '2027-03-01T10:00', phrase: 'SEND' }, staff)).toMatchObject({ sendAt: z('2027-03-01T09:00:40Z') });
    expect((await house().deliverDue(clock.now())).messages).toBe(2);
    expect((await deliveriesOf(now.id)).map((d) => d.account_id)).toContain(a.id);
    expect((await audits(now.id)).map((x) => x.action)).toEqual(['house.message.create', 'house.message.send', 'house.message.delivered']);
    expect((await house().message(now.id)).audience.label).toBe('PALLADIUM');

    const later = await house().create({ title: 'LATER', body: 'Words.', audience: { tier: 2 } }, staff);
    await house().send(later.id, { at: '2027-03-02T18:00', phrase: 'SEND' }, staff);
    // A scheduled message is edited (it keeps its time) and rescheduled until it goes.
    const edited = await house().update(later.id, { title: 'LATER STILL', audience: { tier: 1 } }, staff);
    expect(edited).toMatchObject({ status: 'SCHEDULED', title: 'LATER STILL', audience: { tier: 1 }, sendAt: z('2027-03-02T17:00:00Z') });
    expect((await audits(later.id)).at(-1)!.details).toEqual({ title: { length: 11, sha256: sha('LATER STILL') }, audience: { before: { tier: 2 }, after: { tier: 1 } } });
    // Nothing changed: nothing written.
    const n = (await audits(later.id)).length;
    await house().update(later.id, { title: 'LATER STILL' }, staff);
    expect(await audits(later.id)).toHaveLength(n);
    expect(await house().send(later.id, { at: '2027-03-03T08:15', phrase: 'SEND' }, staff)).toMatchObject({ sendAt: z('2027-03-03T07:15:00Z') });
    expect((await audits(later.id)).at(-1)).toMatchObject({ action: 'house.message.schedule', details: { rescheduled: true } });
    await expect(house().remove(later.id, staff)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_STATE', httpStatus: 409 });
    const cancelled = await house().cancel(later.id, staff);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', sendAt: null, cancelledBy: { id: staff.id }, audience: { tier: 1, label: 'TITANE and above' } });
    expect(cancelled.cancelledAt).toEqual(clock.now());
    clock.set('2027-03-04T09:00:00Z');
    expect(await house().deliverDue(clock.now())).toEqual({ messages: 0, deliveries: 0 });
    for (const call of [() => house().update(later.id, { title: 'X' }, staff), () => house().send(later.id, { phrase: 'SEND' }, staff), () => house().cancel(later.id, staff), () => house().remove(later.id, staff)]) {
      await expect(call()).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_STATE' });
    }

    const draft = await house().create({ title: 'DRAFT', body: 'Words.', audience: { tier: 1 } }, staff);
    await expect(house().cancel(draft.id, staff)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_STATE' });
    await house().remove(draft.id, staff);
    await expect(house().message(draft.id)).rejects.toMatchObject({ code: 'HOUSE_MESSAGE_NOT_FOUND' });
    expect((await audits(draft.id)).map((x) => [x.action, x.details])).toEqual([
      ['house.message.create', expect.anything()],
      ['house.message.delete', { title: { length: 5, sha256: sha('DRAFT') }, body: { length: 6, sha256: sha('Words.') }, audience: { tier: 1 } }],
    ]);
    const all = await house().messages({}, { page: 1, pageSize: 200 });
    expect(all.items[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(all.items.at(-1)!.createdAt.getTime());
    expect((await house().messages({ status: 'CANCELLED' }, { page: 1, pageSize: 50 })).items.map((x) => x.id)).toEqual([later.id]);
  });

  it('keeps a segment while a draft or a scheduled message names it (SEGMENT_IN_USE); a sent one keeps its name after', async () => {
    clock.set('2027-04-01T09:00:00Z');
    const s = await ctx.services.segments.create({ name: 'The first owners', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [1] }] } }, staff);
    const draft = await house().create({ title: 'DRAFT', body: 'Words.', audience: { segmentId: s.id } }, staff);
    expect((await ctx.services.segments.get(s.id)).usedBy.houseMessages).toEqual([{ id: draft.id, title: 'DRAFT', status: 'DRAFT' }]);
    await expect(ctx.services.segments.remove(s.id, staff)).rejects.toMatchObject({ code: 'SEGMENT_IN_USE', httpStatus: 409, message: expect.stringContaining('or of a house message') });
    await house().send(draft.id, { at: '2027-04-02T10:00', phrase: 'SEND' }, staff);
    expect((await ctx.services.segments.get(s.id)).usedBy.houseMessages).toEqual([{ id: draft.id, title: 'DRAFT', status: 'SCHEDULED' }]);
    await expect(ctx.services.segments.remove(s.id, staff)).rejects.toMatchObject({ code: 'SEGMENT_IN_USE' });
    clock.set('2027-04-02T08:00:01Z');
    await house().deliverDue(clock.now());
    const cancelled = await house().create({ title: 'CANCELLED', body: 'Words.', audience: { segmentId: s.id } }, staff);
    await house().send(cancelled.id, { at: '2027-04-05T10:00', phrase: 'SEND' }, staff);
    await house().cancel(cancelled.id, staff);
    expect((await ctx.services.segments.get(s.id)).usedBy.houseMessages).toEqual([]);
    // Renamed after the sending: the sent message keeps the name it went with.
    await ctx.services.segments.update(s.id, { name: 'Renamed' }, staff);
    await ctx.services.segments.remove(s.id, staff);
    expect(await house().message(draft.id)).toMatchObject({ status: 'SENT', audience: { segmentId: null, tier: null, label: 'The first owners' } });
    expect(await house().message(cancelled.id)).toMatchObject({ status: 'CANCELLED', audience: { segmentId: null, label: 'The first owners' } });
  });

  it('leaves a message it cannot deliver for the next pass and delivers the others', async () => {
    clock.set('2027-05-01T09:00:00Z');
    const s = await ctx.services.segments.create({ name: 'Broken later', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [3] }] } }, staff);
    const broken = await house().create({ title: 'BROKEN', body: 'Words.', audience: { segmentId: s.id } }, staff);
    const fine = await house().create({ title: 'FINE', body: 'Words.', audience: { tier: 3 } }, staff);
    await house().send(broken.id, { phrase: 'SEND' }, staff);
    clock.advance(1000);
    await house().send(fine.id, { phrase: 'SEND' }, staff);
    // The segment's rule tree no longer reads (written by hand): the first message due fails, the second goes.
    await t.db.updateTable('segments').set({ criteria: sql`'{"match":"SOME","rules":[]}'::jsonb` }).where('id', '=', s.id).execute();
    expect(await house().deliverDue(clock.now())).toMatchObject({ messages: 1 });
    expect((await house().message(broken.id)).status).toBe('SCHEDULED');
    expect((await house().message(fine.id)).status).toBe('SENT');
    expect(lines.some((l) => l.level === 'error' && l.msg === 'a house message could not be delivered' && (l.o as { id?: string }).id === broken.id)).toBe(true);
    await house().cancel(broken.id, staff);
  });

  it('gives the console each moment’s figures and a preview with example values', async () => {
    clock.set('2027-06-01T09:00:00Z');
    const moments = ctx.services.houseMoments;
    const a = await collector(1);
    const at = clock.now();
    await t.db
      .insertInto('house_deliveries')
      .values([
        { account_id: a.id, source: 'MOMENT', moment: 'NINETY_DAYS', title: 'WHAT IS NEW', body: 'Words.', dedupe_key: `NINETY_DAYS:${a.id}:2027-01-01`, delivered_at: z('2027-01-01T09:00:00Z'), read_at: z('2027-01-02T09:00:00Z') },
        { account_id: a.id, source: 'MOMENT', moment: 'NINETY_DAYS', title: 'WHAT IS NEW', body: 'Words.', dedupe_key: `NINETY_DAYS:${a.id}:2027-05-20`, delivered_at: z('2027-05-25T09:00:00Z') },
      ])
      .execute();
    const listed = await moments.moments(at);
    expect(listed.map((m) => m.moment)).toEqual(['FIRST_REGISTRATION', 'BIRTHDAY_CREDIT', 'CREDIT_EXPIRING', 'PRIVATE_CARE', 'OWNERSHIP_YEAR', 'NINETY_DAYS']);
    expect(listed.find((m) => m.moment === 'NINETY_DAYS')!.figures).toEqual({ delivered30: 1, read30: 0, delivered: 2, read: 1 });
    expect(listed.find((m) => m.moment === 'BIRTHDAY_CREDIT')!.figures).toEqual({ delivered30: 0, read30: 0, delivered: 0, read: 0 });

    const p = await moments.preview('FIRST_REGISTRATION');
    expect(p).toMatchObject({ moment: 'FIRST_REGISTRATION', title: 'YOUR FIRST PIECE', links: ['CARE', 'SIZES'] });
    expect(p.body).toMatch(/^\S.* is registered to you\./);
    expect(p.values).toEqual({ firstName: 'Camille', piece: expect.any(String) });
    const b = await moments.preview('BIRTHDAY_CREDIT', { title: 'FOR {firstName}', body: null });
    expect(b).toMatchObject({ title: 'FOR Camille', body: 'A credit of € 20 is yours until 1 July 2027.' });
    expect((await moments.preview('PRIVATE_CARE')).body).toBe('From PLATINE, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.');
    await expect(moments.preview('BIRTHDAY_CREDIT', { body: '{piece}' })).rejects.toMatchObject({ code: 'HOUSE_PLACEHOLDER' });
    await expect(moments.preview('NOPE')).rejects.toMatchObject({ code: 'HOUSE_MOMENT_NOT_FOUND' });
  });

  it('runs the sender every interval until it is stopped', async () => {
    clock.set('2027-07-01T09:00:00Z');
    await collector(10);
    const m = await house().create({ title: 'LOOP', body: 'Words.', audience: { tier: 3 } }, staff);
    await house().send(m.id, { phrase: 'SEND' }, staff);
    expect(HOUSE_SENDER.intervalMs).toBe(30_000);
    const sender = new HouseSender({ messages: house(), clock: clock.now, log, intervalMs: 20 });
    sender.start();
    try {
      for (let i = 0; i < 200 && (await house().message(m.id)).status !== 'SENT'; i++) await new Promise((r) => setTimeout(r, 10));
    } finally {
      await sender.stop();
    }
    expect((await house().message(m.id)).status).toBe('SENT');
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
      const name = `orbes_house_msg_${randomBytes(6).toString('hex')}`;
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
  describe.skipIf(backend.skip)(`the house messages on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    beforeAll(async () => {
      ({ db, close } = await backend.open());
    }, 60_000);
    afterAll(() => close?.());

    it('two senders deliver a scheduled message once (FOR UPDATE SKIP LOCKED)', async () => {
      const clock = createManualClock('2027-03-02T09:00:00.000Z');
      const senders = [0, 1, 2, 3].map(() => new HouseMessageService({ db, audit: new AuditService({ db, clock: clock.now }), clock: clock.now }));
      await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
      const email = `house-${randomUUID()}@orbes.test`;
      const admin = await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
      const staffActor: Actor = { type: 'admin', id: admin.id };
      const model = await createModel(db, 'MONOLITHE');
      const accounts: string[] = [];
      for (let i = 0; i < 12; i++) {
        const a = await createAccount(db);
        await holdPieces(db, a.id, 1, model);
        accounts.push(a.id);
      }
      const ids: string[] = [];
      for (const title of ['ONE', 'TWO']) {
        const m = await senders[0]!.create({ title, body: 'Words.', audience: { tier: 1 } }, staffActor);
        await senders[0]!.send(m.id, { phrase: 'SEND' }, staffActor);
        ids.push(m.id);
      }
      const passes = await Promise.all(senders.map((s) => s.deliverDue(clock.now())));
      expect(passes.reduce((n, p) => n + p.messages, 0)).toBe(2);
      expect(passes.reduce((n, p) => n + p.deliveries, 0)).toBe(24);
      for (const id of ids) {
        const rows = await db.selectFrom('house_deliveries').select('account_id').where('house_message_id', '=', id).execute();
        expect(rows.map((r) => r.account_id).sort()).toEqual([...accounts].sort());
      }
      const audited = await db.selectFrom('audit_logs').select('details').where('action', '=', 'house.message.delivered').execute();
      expect(audited).toHaveLength(2);
    });
  });
}
