/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11; services/question.ts), against a migrated database
 * and a manual clock, with known figures:
 *
 *  - its words: the default question and its three answers, or the console's (2 to 6 answers, both or neither, each
 *    once), on by default, turned off and kept; checked and audited with the release's settings;
 *  - who is asked, from the release's final end for seven days: on its end page who took part without securing a piece;
 *    in MY PIECES who said I'LL BE THERE and never had a place in the line; never who secured one, who was removed, who
 *    never came near it;
 *  - the final end: an after-room opened at the sell-out holds the question until it ends (its recorded end, else its
 *    close once passed), so that its guests are asked after their second door, never one who secured a piece there; an
 *    after-room never opened (NOT_SOLD_OUT) leaves the release's own end; a turn still running after a CLOSED end is
 *    asked once it has run out;
 *  - one tap, changeable while open, audited `drop.live.answer`; refused before the end, after the week, to anyone
 *    not asked, out of the answers;
 *  - the console's count: who is asked in each place, how many answered, each answer's count; the right of access.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { LIVE_QUESTION_DEFAULT } from '../../src/server/services/live.js';
import { afterRoomTimes } from '../../src/server/services/after-room.js';
import { accountReleaseAnswers, cleanQuestionWords, LIVE_QUESTION_OPEN_DAYS, QuestionService, questionWindow, releaseFinalEnd, releaseQuestion } from '../../src/server/services/question.js';
import type { Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, createModel, entriesOf, liveFixture, type LiveFixture } from '../support/live.js';

const T0 = new Date('2026-11-02T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60_000;
const DAY = 86_400_000;

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

describe('the words of the question after', () => {
  it('reads the default question when none is written, a draw and an after-room ask none, turned off asks none', () => {
    const live = { mode: 'LIVE' as const, parent_drop_id: null, question_enabled: null, question_text: null, question_answers: null };
    expect(releaseQuestion(live)).toEqual({ text: 'WHAT WOULD YOU HAVE WANTED?', answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'], custom: false });
    expect(releaseQuestion({ ...live, question_text: 'WHICH FINISH?', question_answers: ['GOLD', 'SILVER'] })).toEqual({ text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER'], custom: true });
    expect(releaseQuestion({ ...live, question_enabled: false })).toBeNull();
    expect(releaseQuestion({ ...live, mode: 'DRAW' })).toBeNull();
    expect(releaseQuestion({ ...live, parent_drop_id: '00000000-0000-4000-8000-000000000001' })).toBeNull();
  });

  it('cleans the console’s words: both or neither, 2 to 6 answers of one line each, each once; the default’s own words as the default', () => {
    expect(cleanQuestionWords(null, null)).toEqual({ text: null, answers: null });
    expect(cleanQuestionWords('  ', [])).toEqual({ text: null, answers: null });
    expect(cleanQuestionWords('  WHICH   FINISH? ', [' GOLD', 'SILVER '])).toEqual({ text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER'] });
    expect(cleanQuestionWords(LIVE_QUESTION_DEFAULT.text, [...LIVE_QUESTION_DEFAULT.answers])).toEqual({ text: null, answers: null });
    for (const [text, answers] of [
      ['WHICH?', null],
      [null, ['A', 'B']],
      ['WHICH?', ['ONLY ONE']],
      ['WHICH?', ['A', 'B', 'C', 'D', 'E', 'F', 'G']],
      ['WHICH?', ['GOLD', 'gold']],
      ['WHICH?', ['A', 'x'.repeat(41)]],
      ['x'.repeat(121), ['A', 'B']],
      ['WHICH?\u0007', ['A', 'B']],
    ] as const) {
      expect(() => cleanQuestionWords(text, answers), JSON.stringify([text, answers])).toThrow(DomainError);
    }
  });

  it('is open from the final end for seven days: the release’s own, or its opened after-room’s', () => {
    expect(questionWindow({ ended_at: null }, T0)).toBeNull();
    expect(questionWindow({ ended_at: T0 }, T0)).toEqual({ opensAt: T0, closesAt: new Date(T0.getTime() + LIVE_QUESTION_OPEN_DAYS * DAY) });
    expect(LIVE_QUESTION_OPEN_DAYS).toBe(7);
    // An after-room opened at the sell-out: its recorded end; before it, its close once passed (a CLOSED end's moment).
    const room = { ended_at: T0, after_room_id: '00000000-0000-4000-8000-000000000001', after_room_ended_at: null, after_room_closes_at: at(25 * MINUTE) };
    expect(releaseFinalEnd(room, at(10 * MINUTE))).toBeNull();
    expect(questionWindow(room, at(25 * MINUTE))).toEqual({ opensAt: at(25 * MINUTE), closesAt: at(25 * MINUTE + 7 * DAY) });
    expect(releaseFinalEnd({ ...room, after_room_ended_at: at(12 * MINUTE) }, at(12 * MINUTE))).toEqual(at(12 * MINUTE));
  });
});

describe('the question after a release', () => {
  let t: TestDb;
  let f: LiveFixture;
  let questions: QuestionService;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-01T09:00:00.000Z');
    questions = new QuestionService({ db: t.db, audit: f.audit, clock: f.clock.now });
  });
  afterAll(() => t.close());

  const answers = async (dropId: string) =>
    (await t.db.selectFrom('audit_logs').select(['action', 'actor_id', 'details']).where('target_id', '=', dropId).where('action', '=', 'drop.live.answer').orderBy('id').execute()).map((a) => ({
      actor: a.actor_id,
      details: a.details,
    }));

  it('asks who took part without a piece on its end page, who said I’LL BE THERE and never came in MY PIECES, for seven days, one tap, changeable', async () => {
    f.clock.set('2026-11-01T09:00:00.000Z');
    const r = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 1 }] });
    const size = r.sizes[0]!.id;
    // A secures the piece (PALLADIUM: first in the line); B and C wait in the line; D and E said I'LL BE THERE, D never
    // came, E entered the room and left it before T0; G was removed from the line; F never came near it.
    const [a, b, c, d, e, g, x] = [await accountOfTier(f, 3), await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0)];
    for (const p of [a, b, d, e]) await f.live.setInterest(p.id, r.id, size, p.actor);
    f.clock.set(at(-MINUTE));
    for (const p of [a, b, c, e, g]) await f.live.enter(p.id, r.id, { sizeId: size }, p.actor);
    await f.live.leave(e.id, r.id, e.actor);
    f.clock.set(T0);
    await f.live.advance(r.id);
    const removed = (await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', g.id).executeTakeFirstOrThrow()).id;
    await f.live.remove(r.id, removed, f.admin);
    f.clock.advance(2 * SECOND);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);

    // Before the end: asked of nobody, refused.
    expect(await questions.forAccount(b.id, r.id)).toBeNull();
    await rejects(questions.answer(b.id, r.id, 1, b.actor), 'LIVE_QUESTION_CLOSED', 409);
    const waiting = await f.liveConsole.get(r.id);
    expect(waiting.question).toMatchObject({ enabled: true, state: 'WAITING', opensAt: null, closesAt: null, custom: false });

    await f.live.confirm(a.id, r.id, a.actor);
    await f.live.advance(r.id);
    const end = (await t.db.selectFrom('drops').select(['ended_at', 'ended_reason']).where('id', '=', r.id).executeTakeFirstOrThrow());
    expect(end.ended_reason).toBe('SOLD_OUT');
    const closesAt = new Date(end.ended_at!.getTime() + 7 * DAY);

    // The end page: B and C took part without a piece.
    const asked = { dropId: r.id, name: 'MONOLITHE', opensAt: T0, text: 'WHAT WOULD YOU HAVE WANTED?', answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'], answer: null, closesAt };
    expect(await questions.forAccount(b.id, r.id)).toEqual({ ...asked, asked: 'TOOK_PART' });
    expect(await questions.forAccount(c.id, r.id)).toEqual({ ...asked, asked: 'TOOK_PART' });
    // MY PIECES: D never came, E left the room before T0.
    expect(await questions.forAccount(d.id, r.id)).toEqual({ ...asked, asked: 'INTEREST' });
    expect(await questions.forPieces(d.id)).toEqual([{ ...asked, asked: 'INTEREST' }]);
    expect(await questions.forPieces(e.id)).toEqual([{ ...asked, asked: 'INTEREST' }]);
    expect(await questions.forPieces(b.id)).toEqual([]);
    // Never asked: A secured a piece, G was removed, X never came near it.
    for (const p of [a, g, x]) {
      expect(await questions.forAccount(p.id, r.id)).toBeNull();
      await rejects(questions.answer(p.id, r.id, 1, p.actor), 'LIVE_QUESTION_NOT_ASKED', 403);
    }
    await rejects(questions.answer(b.id, r.id, 4, b.actor), 'VALIDATION_FAILED', 400);
    await rejects(questions.answer(b.id, '00000000-0000-4000-8000-000000000009', 1, b.actor), 'DROP_NOT_FOUND', 404);

    // One tap, then another answer: changed in place, each audited by its position.
    expect(await questions.answer(b.id, r.id, 2, b.actor)).toMatchObject({ answer: 2, asked: 'TOOK_PART' });
    f.clock.advance(MINUTE);
    expect(await questions.answer(b.id, r.id, 3, b.actor)).toMatchObject({ answer: 3 });
    expect(await questions.answer(b.id, r.id, 3, b.actor)).toMatchObject({ answer: 3 });
    expect(await questions.answer(d.id, r.id, 1, d.actor)).toMatchObject({ answer: 1, asked: 'INTEREST' });
    expect(await answers(r.id)).toEqual([
      { actor: b.id, details: { answer: 2 } },
      { actor: b.id, details: { answer: 3, before: 2 } },
      { actor: d.id, details: { answer: 1 } },
    ]);
    const stored = await t.db.selectFrom('release_answers').select(['account_id', 'answer', 'answered_at']).where('drop_id', '=', r.id).orderBy('answer').execute();
    expect(stored).toEqual([
      { account_id: d.id, answer: 1, answered_at: f.clock.now() },
      { account_id: b.id, answer: 3, answered_at: f.clock.now() },
    ]);

    // The console: 2 asked on the end page (B, C), 2 in MY PIECES (D, E), 2 answers.
    const read = await f.liveConsole.get(r.id);
    expect(read.question).toEqual({
      text: 'WHAT WOULD YOU HAVE WANTED?',
      answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'],
      custom: false,
      enabled: true,
      state: 'OPEN',
      opensAt: end.ended_at,
      closesAt,
      asked: { tookPart: 2, interest: 2 },
      answered: 2,
      tally: [
        { answer: 1, label: 'ANOTHER SIZE', count: 1 },
        { answer: 2, label: 'ANOTHER FINISH', count: 0 },
        { answer: 3, label: 'ANOTHER PRICE BAND', count: 1 },
      ],
    });

    // The right of access.
    expect(await accountReleaseAnswers(t.db, b.id)).toEqual([{ dropId: r.id, title: 'LIVE', question: 'WHAT WOULD YOU HAVE WANTED?', answer: 3, answerText: 'ANOTHER PRICE BAND', answeredAt: f.clock.now() }]);

    // Seven days after the end: closed, the answers kept.
    f.clock.set(new Date(closesAt.getTime() - 1));
    expect(await questions.forAccount(c.id, r.id)).toMatchObject({ asked: 'TOOK_PART' });
    f.clock.set(closesAt);
    expect(await questions.forAccount(c.id, r.id)).toBeNull();
    expect(await questions.forPieces(d.id)).toEqual([]);
    await rejects(questions.answer(c.id, r.id, 1, c.actor), 'LIVE_QUESTION_CLOSED', 409);
    expect((await f.liveConsole.get(r.id)).question).toMatchObject({ state: 'CLOSED', answered: 2 });
  });

  it('asks its own words when the console rewrote them, and nothing once turned off', async () => {
    f.clock.set('2026-11-05T09:00:00.000Z');
    const opensAt = new Date('2026-11-06T10:00:00.000Z');
    const created = await f.liveConsole.create(
      { modelId: f.modelId, title: 'WORDS', opensAt, closesAt: new Date(opensAt.getTime() + 3_600_000), priceMinor: 100_000, sizes: [{ label: '52', stock: 1 }], questionText: 'WHICH FINISH?', questionAnswers: ['GOLD', 'SILVER', 'BLACK'] },
      f.admin,
    );
    expect(created.question).toMatchObject({ enabled: true, custom: true, text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER', 'BLACK'], state: 'WAITING' });
    const create = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', created.id).where('action', '=', 'drop.live.create').executeTakeFirstOrThrow();
    expect(create.details).toMatchObject({ questionEnabled: true, question: { text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER', 'BLACK'] } });
    // Both or neither; turned off keeps the words; the default's words read as the default.
    await rejects(f.liveConsole.update(created.id, { questionText: null }, f.admin), 'VALIDATION_FAILED', 400);
    const off = await f.liveConsole.update(created.id, { questionEnabled: false }, f.admin);
    expect(off.question).toMatchObject({ enabled: false, state: 'OFF', text: 'WHICH FINISH?' });
    const back = await f.liveConsole.update(created.id, { questionEnabled: true, questionText: null, questionAnswers: null }, f.admin);
    expect(back.question).toMatchObject({ enabled: true, custom: false, text: 'WHAT WOULD YOU HAVE WANTED?' });
    const updates = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', created.id).where('action', '=', 'drop.live.update').orderBy('id').execute();
    expect(updates.map((u) => u.details)).toEqual([
      { before: { questionEnabled: true }, after: { questionEnabled: false } },
      { before: { questionEnabled: false, question: { text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER', 'BLACK'] } }, after: { questionEnabled: true, question: null } },
    ]);

    // Turned off on a release that ends: asked of nobody.
    f.clock.set('2026-11-05T09:00:00.000Z');
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 1 }] });
    await t.db.updateTable('drops').set({ question_enabled: false }).where('id', '=', r.id).execute();
    const b = await accountOfTier(f, 0);
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor);
    f.clock.set(new Date(opensAt.getTime() + 2 * 3_600_000));
    await f.live.advance(r.id);
    expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('CLOSED');
    expect(await questions.forAccount(b.id, r.id)).toBeNull();
    await rejects(questions.answer(b.id, r.id, 1, b.actor), 'LIVE_QUESTION_CLOSED', 409);
    expect((await f.liveConsole.get(r.id)).question).toMatchObject({ enabled: false, state: 'OFF', asked: { tookPart: 1, interest: 0 }, answered: 0 });
  });

  it('is never asked through an after-room (the same 404 as an unknown release), and an unknown account answers nothing', async () => {
    f.clock.set('2026-11-08T09:00:00.000Z');
    const afterModel = (await t.db.selectFrom('models').select('id').where('id', '=', f.modelId).executeTakeFirstOrThrow()).id;
    const r = await createLiveRelease(f, { opensAt: new Date('2026-11-09T10:00:00.000Z'), afterRoom: { modelId: afterModel, priceMinor: 1000, sizes: [{ label: '54', stock: 1 }] } });
    const b = await accountOfTier(f, 0);
    await rejects(questions.forAccount(b.id, r.afterRoom!.id), 'DROP_NOT_FOUND', 404);
    await rejects(questions.answer(b.id, r.afterRoom!.id, 1, b.actor), 'DROP_NOT_FOUND', 404);
    expect((await f.liveConsole.get(r.afterRoom!.id)).question).toBeNull();
    const ghost: Actor = { type: 'account', id: '00000000-0000-4000-8000-000000000001' };
    await rejects(questions.answer(ghost.id!, r.id, 1, ghost), 'FORBIDDEN', 403);
  });

  /** Holds the seal of the account's turn, then secures it. */
  const holdAndSecure = async (dropId: string, p: { id: string; actor: Actor }) => {
    const token = (await f.live.entry(p.id, dropId))!.turn!.token!;
    await f.live.press(p.id, dropId, token);
    f.clock.advance(1500);
    await f.live.secure(p.id, dropId, token, p.actor);
  };
  const endOf = async (dropId: string) => (await t.db.selectFrom('drops').select(['ended_at', 'ended_reason', 'published_at', 'cancelled_at']).where('id', '=', dropId).executeTakeFirstOrThrow());

  it('waits for an opened after-room to end: its guests are asked after their second door, never one who secured a piece there', async () => {
    f.clock.set('2026-11-11T09:00:00.000Z');
    const opensAt = new Date('2026-11-12T10:00:00.000Z');
    const afterModel = await createModel(t.db, 'AFTERGLOW');
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 1 }], afterRoom: { modelId: afterModel, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] } });
    const child = r.afterRoom!.id;
    // A (PALLADIUM, first in line) secures the one piece; three others wait in the line: the sell-out makes them its guests.
    // They share a tier, so the opening's draw orders them: B, C and D are named by the places it gives. E said I'LL BE
    // THERE and never came.
    const [a, x, y, z, e] = [await accountOfTier(f, 3), await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0), await accountOfTier(f, 0)];
    await f.live.setInterest(e.id, r.id, r.sizes[0]!.id, e.actor);
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    for (const p of [a, x, y, z]) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
    f.clock.set(opensAt);
    await f.live.advance(r.id);
    const line = (await entriesOf(t.db, r.id)).map((row) => row.account_id);
    const [b, c, d] = [x, y, z].sort((p, q) => line.indexOf(p.id) - line.indexOf(q.id)) as [typeof x, typeof x, typeof x];
    f.clock.advance(2 * SECOND);
    await holdAndSecure(r.id, a);
    await f.live.confirm(a.id, r.id, a.actor);
    const soldOut = await endOf(r.id);
    expect(soldOut.ended_reason).toBe('SOLD_OUT');
    expect((await endOf(child)).published_at).toEqual(soldOut.ended_at);

    // From the sell-out to the after-room's end, asked of nobody: its guests wait for their second door.
    const door = afterRoomTimes(soldOut.ended_at!, 10, 15);
    for (const moment of [soldOut.ended_at!, new Date(door.opensAt.getTime() - SECOND)]) {
      f.clock.set(moment);
      for (const p of [b, c, d, e]) expect(await questions.forAccount(p.id, r.id), moment.toISOString()).toBeNull();
      await rejects(questions.answer(b.id, r.id, 1, b.actor), 'LIVE_QUESTION_CLOSED', 409);
      expect(await questions.forPieces(e.id)).toEqual([]);
      expect((await f.liveConsole.get(r.id)).question).toMatchObject({ enabled: true, state: 'WAITING', opensAt: null, closesAt: null });
    }
    // The after-room opens: B and C enter it, B first in its line, D never comes. Still asked of nobody.
    f.clock.set(door.opensAt);
    for (const p of [c, b]) await f.live.enter(p.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, p.actor);
    await f.live.advance(child);
    expect((await entriesOf(t.db, child)).map((x) => [x.account_id, x.status])).toEqual([
      [b.id, 'TURN'],
      [c.id, 'QUEUED'],
    ]);
    f.clock.advance(2 * SECOND);
    await holdAndSecure(child, b);
    for (const p of [b, c, d]) expect(await questions.forAccount(p.id, r.id)).toBeNull();
    await rejects(questions.answer(c.id, r.id, 1, c.actor), 'LIVE_QUESTION_CLOSED', 409);
    // B pays: the after-room sells out, the release's final end. Asked: C and D (took part, no piece); E in MY PIECES.
    await f.live.confirm(b.id, child, b.actor);
    const last = await endOf(child);
    expect(last.ended_reason).toBe('SOLD_OUT');
    expect(last.ended_at!.getTime()).toBeGreaterThan(soldOut.ended_at!.getTime());
    const closesAt = new Date(last.ended_at!.getTime() + 7 * DAY);
    expect(await questions.forAccount(c.id, r.id)).toMatchObject({ asked: 'TOOK_PART', closesAt });
    expect(await questions.forAccount(d.id, r.id)).toMatchObject({ asked: 'TOOK_PART', closesAt });
    expect(await questions.forPieces(e.id)).toEqual([expect.objectContaining({ dropId: r.id, asked: 'INTEREST', closesAt })]);
    // Never asked: A secured a piece in the release, B in its after-room.
    for (const p of [a, b]) {
      expect(await questions.forAccount(p.id, r.id)).toBeNull();
      await rejects(questions.answer(p.id, r.id, 1, p.actor), 'LIVE_QUESTION_NOT_ASKED', 403);
    }
    expect(await questions.answer(c.id, r.id, 2, c.actor)).toMatchObject({ answer: 2, asked: 'TOOK_PART' });
    expect((await f.liveConsole.get(r.id)).question).toMatchObject({ state: 'OPEN', opensAt: last.ended_at, closesAt, asked: { tookPart: 2, interest: 1 }, answered: 1 });
    // A week after the after-room's end, not the release's: closed.
    f.clock.set(new Date(closesAt.getTime() - 1));
    expect(await questions.forAccount(d.id, r.id)).toMatchObject({ asked: 'TOOK_PART' });
    f.clock.set(closesAt);
    expect(await questions.forAccount(d.id, r.id)).toBeNull();
    expect((await f.liveConsole.get(r.id)).question).toMatchObject({ state: 'CLOSED' });
  });

  it('opens at an after-room’s close once passed, the engine yet to record it; at the release’s own end when the after-room never opened', async () => {
    // An after-room nobody enters: open at its close, before and after the engine records it there.
    f.clock.set('2026-11-14T09:00:00.000Z');
    const opensAt = new Date('2026-11-15T10:00:00.000Z');
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 1 }], afterRoom: { modelId: f.modelId, priceMinor: 1000, sizes: [{ label: '54', stock: 1 }] } });
    const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    for (const p of [a, b]) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
    f.clock.set(opensAt);
    await f.live.advance(r.id);
    f.clock.advance(2 * SECOND);
    await holdAndSecure(r.id, a);
    await f.live.confirm(a.id, r.id, a.actor);
    const door = afterRoomTimes((await endOf(r.id)).ended_at!, 10, 15);
    f.clock.set(new Date(door.closesAt.getTime() - 1));
    expect(await questions.forAccount(b.id, r.id)).toBeNull();
    f.clock.set(door.closesAt);
    const opened = { asked: 'TOOK_PART', closesAt: new Date(door.closesAt.getTime() + 7 * DAY) };
    expect((await endOf(r.afterRoom!.id)).ended_at).toBeNull();
    expect(await questions.forAccount(b.id, r.id)).toMatchObject(opened);
    expect((await f.liveConsole.get(r.id)).question).toMatchObject({ state: 'OPEN', opensAt: door.closesAt });
    await f.live.advance(r.afterRoom!.id);
    expect(await endOf(r.afterRoom!.id)).toMatchObject({ ended_reason: 'CLOSED', ended_at: door.closesAt });
    expect(await questions.forAccount(b.id, r.id)).toMatchObject(opened);

    // An after-room never opened (the release CLOSED, NOT_SOLD_OUT): the release's own end. A turn still running after
    // it (300 s to hold the seal) is asked once it has run out, as the one waiting behind it is at once.
    f.clock.set('2026-11-14T09:00:00.000Z');
    const closed = await createLiveRelease(f, { opensAt, closesAt: new Date(opensAt.getTime() + MINUTE), turnSeconds: 300, sizes: [{ label: '52', stock: 1 }], afterRoom: { modelId: f.modelId, priceMinor: 1000, sizes: [{ label: '54', stock: 1 }] } });
    const [p, q] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    for (const x of [p, q]) await f.live.enter(x.id, closed.id, { sizeId: closed.sizes[0]!.id }, x.actor);
    f.clock.set(opensAt);
    await f.live.advance(closed.id);
    f.clock.set(new Date(opensAt.getTime() + MINUTE));
    await f.live.advance(closed.id);
    const end = await endOf(closed.id);
    expect(end).toMatchObject({ ended_reason: 'CLOSED', ended_at: new Date(opensAt.getTime() + MINUTE) });
    expect((await endOf(closed.afterRoom!.id)).cancelled_at).toEqual(end.ended_at);
    expect((await entriesOf(t.db, closed.id)).map((x) => [x.account_id, x.status])).toEqual([
      [p.id, 'TURN'],
      [q.id, 'ENDED'],
    ]);
    const asked = { asked: 'TOOK_PART', closesAt: new Date(end.ended_at!.getTime() + 7 * DAY) };
    expect(await questions.forAccount(q.id, closed.id)).toMatchObject(asked);
    expect(await questions.forAccount(p.id, closed.id)).toBeNull();
    await rejects(questions.answer(p.id, closed.id, 1, p.actor), 'LIVE_QUESTION_NOT_ASKED', 403);
    expect((await f.liveConsole.get(closed.id)).question).toMatchObject({ state: 'OPEN', opensAt: end.ended_at, asked: { tookPart: 1, interest: 0 } });
    // Its turn runs out: MISSED, then asked.
    f.clock.set(new Date(opensAt.getTime() + 301 * SECOND));
    await f.live.advance(closed.id);
    expect((await entriesOf(t.db, closed.id))[0]!.status).toBe('MISSED');
    expect(await questions.forAccount(p.id, closed.id)).toMatchObject(asked);
    expect((await f.liveConsole.get(closed.id)).question).toMatchObject({ asked: { tookPart: 2, interest: 0 } });
  });
});
