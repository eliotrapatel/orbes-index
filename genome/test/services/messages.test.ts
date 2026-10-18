/**
 * MESSAGES (plan NEXT-NINE of 2026-10-06, §3.1 CS-01, step 1.2): MessageService. Every context the collector may attach,
 * labelled by the server, and every one refused; a locked account and the eleventh message of an hour; the statuses, a
 * closed conversation reopened and the waiting time kept; the board in the order of the tier read now (PALLADIUM, then
 * PLATINE, then the rest), the mark lost with the tier; unread and read; staff never open a conversation; two answers
 * and a write at once; audit entries without words; the scan retention keeping a message's REF; the answers unread
 * counted (unreadCount) and each context's `ref` (desktop: a reply on a subject attaches it again).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { MESSAGE_LIMITS, MESSAGE_RATE, accountMessages, normalizeCollectorBody, type MessageContextInput } from '../../src/server/services/messages.js';
import { purgeScanHistory } from '../../src/server/services/scan-retention.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createAccount, createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { poolDraw } from '../support/draws.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('MessageService (CS-01)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let operator: Actor & { id: string };
  let operator2: Actor & { id: string };

  const messages = () => ctx.services.messages;
  const conversationOf = (accountId: string) => t.db.selectFrom('client_conversations').selectAll().where('account_id', '=', accountId).executeTakeFirstOrThrow();
  const audits = (action: string) => t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'actor_id', 'target_id', 'details']).where('action', '=', action).orderBy('id').execute();
  const write = (a: { id: string; actor: Actor }, body: string, context?: MessageContextInput) => messages().write(a.id, { body, ...(context ? { context } : {}) }, a.actor);
  const staff = async (role: 'OPERATOR' | 'ADMIN' = 'OPERATOR') => {
    const email = `cs-${randomUUID()}@orbes.test`;
    const id = (await t.db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role }).returning('id').executeTakeFirstOrThrow()).id;
    return { type: 'admin' as const, id };
  };
  /** A model shown in THE COLLECTION (PUBLIC), or reserved for a tier, or hidden. */
  const lookbookModel = async (name: string, lookbook: 'PUBLIC' | 'RESERVED' | 'HIDDEN', tier = 1) => {
    const id = (
      await t.db
        .insertInto('models')
        .values({ category_id: 1, name, type: 'RING', sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 8)}`, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}`, lookbook, private_min_tier: tier })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    return id;
  };
  const scan = async (o: { at?: Date; state?: string; type?: 'VERIFY' | 'ADMIN_TEST'; productId?: string | null } = {}) =>
    (
      await t.db
        .insertInto('scan_events')
        .values({ occurred_at: o.at ?? clock.now(), event_type: o.type ?? 'VERIFY', result_state: o.state ?? 'INVALID_SIGNATURE', product_id: o.productId ?? null })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** A LIVE sale as a collector lives it: entered before T0, the line at T0, the seal held, PAY; its orders. */
  async function liveSale(a: { id: string; actor: Actor }) {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 5 }] });
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 1 }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').selectAll().where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const order = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).executeTakeFirstOrThrow();
    return { dropId: r.id, entry, order };
  }

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    operator = await staff();
    operator2 = await staff();
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  it('labels every context the account may attach, as the server reads it now, and says where it is in the app', async () => {
    const a = await createAccount(t.db);
    const [piece] = await holdPieces(t.db, a.id, 1, f.modelId);
    const serial = (await t.db.selectFrom('products').select('product_id').where('id', '=', piece!).executeTakeFirstOrThrow()).product_id;
    const sale = await liveSale(a);
    const ref = `LR-${sale.entry.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const orderRef = `OR-${sale.order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const byPiece = await write(a, 'About my ring.', { kind: 'PIECE', id: serial });
    expect(byPiece.message.concerning).toEqual({ kind: 'PIECE', label: `MONOLITHE · ${serial}`, path: `/verify/pieces/${serial}` });
    expect((await write(a, 'Again.', { kind: 'PIECE', id: piece! })).message.concerning?.label).toBe(`MONOLITHE · ${serial}`);
    expect((await write(a, 'About my order.', { kind: 'ORDER', id: sale.order.id })).message.concerning).toEqual({
      kind: 'ORDER',
      label: `ORDER ${orderRef} · MONOLITHE`,
      path: `/verify/pieces?order=${sale.order.id}`,
    });
    expect((await write(a, 'About my release.', { kind: 'RELEASE', id: sale.dropId })).message.concerning).toEqual({
      kind: 'RELEASE',
      label: `LIVE · CONFIRMED · REFERENCE ${ref}`,
      path: `/verify/releases/${sale.dropId}`,
    });
    // A draw: the place held after the draw, the place reserved directly before it opens to everyone, or no entry.
    const draw = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'Monolithe in steel', quantity: 3, opensAt: new Date(clock.now().getTime() + HOUR), closesAt: new Date(clock.now().getTime() + 2 * HOUR), earlyAccessHours: 0 }, f.admin);
    const b = await createAccount(t.db);
    const c = await createAccount(t.db);
    const respondBy = new Date(clock.now().getTime() + 48 * HOUR);
    await t.db.insertInto('drop_entries').values({ drop_id: draw.id, account_id: b.id, status: 'SELECTED', tier: 1, seniority: 0, rank: 1, respond_by: respondBy }).execute();
    await t.db.insertInto('drop_entries').values({ drop_id: draw.id, account_id: c.id, status: 'SELECTED', tier: 2, seniority: 0, respond_by: respondBy }).execute();
    expect((await write(b, 'My place.', { kind: 'RELEASE', id: draw.id })).message.concerning?.label).toBe('MONOLITHE IN STEEL · PLACE HELD');
    expect((await write(c, 'My place.', { kind: 'RELEASE', id: draw.id })).message.concerning?.label).toBe('MONOLITHE IN STEEL · PLACE RESERVED');
    expect((await write(a, 'This draw.', { kind: 'RELEASE', id: draw.id })).message.concerning?.label).toBe('MONOLITHE IN STEEL');
    // A scan of the last 24 hours, signed in or not, by its REF; the warranty tab's adds that it no longer applies.
    const s = await scan({ state: 'INVALID_SIGNATURE' });
    const sref = s.slice(0, 8).toUpperCase();
    expect((await write(a, 'This scan.', { kind: 'SCAN', id: s })).message.concerning).toEqual({ kind: 'SCAN', label: `REF ${sref} · INVALID SIGNATURE`, path: null });
    const w = await scan({ state: 'AUTHENTIC_REGISTERED', productId: piece! });
    const wref = w.slice(0, 8).toUpperCase();
    expect((await write(a, 'The warranty.', { kind: 'SCAN', id: w, about: 'WARRANTY' })).message.concerning?.label).toBe(`REF ${wref} · AUTHENTIC REGISTERED · WARRANTY NO LONGER VALID`);
    const scanRow = await t.db.selectFrom('client_messages').selectAll().where('scan_event_id', '=', w).executeTakeFirstOrThrow();
    expect(scanRow).toMatchObject({ context_kind: 'SCAN', scan_ref: wref, product_id: piece });
    // A model the account's lookbook reaches, with its salon request when it has one; its path by its slug.
    const aurore = await lookbookModel('AURORE', 'PUBLIC');
    const slug = (await t.db.selectFrom('models').select('slug').where('id', '=', aurore).executeTakeFirstOrThrow()).slug;
    expect((await write(a, 'This model.', { kind: 'MODEL', id: aurore })).message.concerning).toEqual({ kind: 'MODEL', label: 'AURORE', path: `/verify/lookbook/${slug}` });
    const eclipse = await lookbookModel('ECLIPSE', 'RESERVED', 1);
    const request = (await t.db.insertInto('shop_requests').values({ account_id: a.id, model_id: eclipse, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow()).id;
    expect((await write(a, 'My request.', { kind: 'MODEL', id: eclipse })).message.concerning?.label).toBe('ECLIPSE · PRIVATE SALON REQUEST');
    expect((await t.db.selectFrom('client_messages').select('shop_request_id').where('model_id', '=', eclipse).executeTakeFirstOrThrow()).shop_request_id).toBe(request);
    // Written from MESSAGES: no context.
    expect((await write(a, 'A general question.')).message.concerning).toBeNull();
    // The thread reads them back the same way, the collector's own only carrying a context.
    const thread = await messages().thread(a.id);
    expect(thread.messages.map((m) => m.concerning?.kind ?? null)).toEqual(['PIECE', 'PIECE', 'ORDER', 'RELEASE', 'RELEASE', 'SCAN', 'SCAN', 'MODEL', 'MODEL', null]);
    expect(thread.messages[0]).toMatchObject({ from: 'YOU', body: 'About my ring.', concerning: { path: `/verify/pieces/${serial}` } });
    // …each with its `ref`, the id a reply attaches again (MessageContextInput.id): a piece's serial (written by its row
    // id too), the order's, the release's, the scan's and the model's id; a message without a context carries none.
    expect(thread.messages.map((m) => m.concerning?.ref ?? null)).toEqual([serial, serial, sale.order.id, sale.dropId, draw.id, s, w, aurore, eclipse, null]);
  });

  it("gives each message's context the id a reply attaches again (`ref`): a reply by it lands on the same thing; none on an answer", async () => {
    const a = await createAccount(t.db);
    const [piece] = await holdPieces(t.db, a.id, 1, f.modelId);
    const sale = await liveSale(a);
    const w = await scan({ state: 'AUTHENTIC_REGISTERED', productId: piece! });
    const aurore = await lookbookModel('AURORE', 'PUBLIC');
    // Written as the app attaches them: the piece by its row id, the scan from the warranty tab.
    const sent: MessageContextInput[] = [
      { kind: 'PIECE', id: piece! },
      { kind: 'ORDER', id: sale.order.id },
      { kind: 'RELEASE', id: sale.dropId },
      { kind: 'SCAN', id: w, about: 'WARRANTY' },
      { kind: 'MODEL', id: aurore },
    ];
    for (const c of sent) await write(a, `About ${c.kind}.`, c);
    const { id } = await conversationOf(a.id);
    clock.advance(MINUTE);
    await messages().answer(id, operator, { body: 'Our answer.' });
    const first = await messages().thread(a.id);
    expect(first.messages.at(-1)).toMatchObject({ from: 'ORBES_CLIENT_SERVICES', concerning: null });
    const mine = first.messages.filter((m) => m.from === 'YOU');
    expect(mine).toHaveLength(sent.length);
    // A reply sent with each `ref` (and `about` where the label says it) is accepted and names the same thing.
    for (const m of mine) {
      const c = m.concerning!;
      expect(c.ref, c.kind).toEqual(expect.any(String));
      const again = await write(a, 'And a reply.', { kind: c.kind, id: c.ref!, ...(c.label.endsWith('WARRANTY NO LONGER VALID') ? { about: 'WARRANTY' as const } : {}) });
      expect(again.message.concerning, c.kind).toEqual({ kind: c.kind, label: c.label, path: c.path });
    }
    // Every `ref` is the account's own: its piece, its order, its scan, or a published release and a model it may read.
    const serial = (await t.db.selectFrom('products').select('product_id').where('id', '=', piece!).executeTakeFirstOrThrow()).product_id;
    expect(mine.map((m) => m.concerning!.ref)).toEqual([serial, sale.order.id, sale.dropId, w, aurore]);
  });

  it("names a model with a variant's label as the app does (modelWithVariant), the main model of its group included", async () => {
    const a = await createAccount(t.db);
    // ZENITH, the main model of its group, carries its own dot (« Steel »): ZENITH IN STEEL, as MY PIECES says it.
    const main = await lookbookModel('ZENITH', 'PUBLIC');
    await t.db.updateTable('models').set({ variant_label: 'Steel', variant_swatch: '#9D9B96' }).where('id', '=', main).execute();
    const [piece] = await holdPieces(t.db, a.id, 1, main);
    const serial = (await t.db.selectFrom('products').select('product_id').where('id', '=', piece!).executeTakeFirstOrThrow()).product_id;
    expect((await write(a, 'My piece.', { kind: 'PIECE', id: serial })).message.concerning?.label).toBe(`ZENITH IN STEEL · ${serial}`);
    expect((await write(a, 'This model.', { kind: 'MODEL', id: main })).message.concerning?.label).toBe('ZENITH IN STEEL');
    expect((await write(a, 'Again.', { kind: 'PIECE', id: piece! })).message.concerning?.label).toBe(`ZENITH IN STEEL · ${serial}`);
    // Without a label, the name alone.
    await t.db.updateTable('models').set({ variant_label: null, variant_swatch: null }).where('id', '=', main).execute();
    expect((await write(a, 'Once more.', { kind: 'PIECE', id: piece! })).message.concerning?.label).toBe(`ZENITH · ${serial}`);
  });

  it('refuses what the account may not attach: another account\'s piece or order, a draft, a LIVE RELEASE not named yet, an unreachable model, an unknown, staff or old scan', async () => {
    const a = await accountOfTier(f, 1);
    const other = await createAccount(t.db);
    const [theirs] = await holdPieces(t.db, other.id, 1, f.modelId);
    const theirSale = await liveSale(other);
    const draft = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'Draft', quantity: 3, opensAt: new Date(clock.now().getTime() + HOUR), closesAt: new Date(clock.now().getTime() + 2 * HOUR), earlyAccessHours: 0 }, f.admin, { publish: false });
    // A LIVE RELEASE announced yesterday whose name is revealed in 5 days, and one published but announced tomorrow.
    const unnamed = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 7 * 24 * HOUR), announceAt: new Date(clock.now().getTime() - 24 * HOUR) });
    await t.db.updateTable('drops').set({ title: 'SECRET MODEL IN BLUE', name_at: new Date(clock.now().getTime() + 5 * 24 * HOUR), photo_at: new Date(clock.now().getTime() + 6 * 24 * HOUR) }).where('id', '=', unnamed.id).execute();
    const unannounced = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 7 * 24 * HOUR), announceAt: new Date(clock.now().getTime() + 24 * HOUR) });
    const hidden = await lookbookModel('HIDDEN', 'HIDDEN');
    const palladium = await lookbookModel('SOLSTICE', 'RESERVED', 3);
    const staffScan = await scan({ type: 'ADMIN_TEST' });
    const old = await scan({ at: new Date(clock.now().getTime() - 24 * HOUR) });
    for (const [context, what] of [
      [{ kind: 'PIECE', id: theirs! }, 'another account\'s piece'],
      [{ kind: 'PIECE', id: 'O26-J-99999' }, 'an unknown piece'],
      [{ kind: 'ORDER', id: theirSale.order.id }, 'another account\'s order'],
      [{ kind: 'RELEASE', id: draft.id }, 'a draft'],
      [{ kind: 'RELEASE', id: unnamed.id }, 'a LIVE RELEASE announced, before its name\'s stage'],
      [{ kind: 'RELEASE', id: unannounced.id }, 'a LIVE RELEASE published, not announced yet'],
      [{ kind: 'RELEASE', id: randomUUID() }, 'an unknown release'],
      [{ kind: 'MODEL', id: hidden }, 'a hidden model'],
      [{ kind: 'MODEL', id: palladium }, 'a model reserved above the account\'s tier'],
      [{ kind: 'SCAN', id: randomUUID() }, 'an unknown scan'],
      [{ kind: 'SCAN', id: staffScan }, 'a staff scan'],
      [{ kind: 'PIECE', id: theirs!, about: 'WARRANTY' }, 'the warranty on a piece'],
      [{ kind: 'ORDER', id: 'OR-12345678' }, 'an order by its reference'],
      [{ kind: 'PLACE', id: randomUUID() }, 'an unknown kind'],
    ] as [MessageContextInput, string][]) {
      const e = await rejects(write(a, 'Hello.', context), 'MESSAGE_CONTEXT_INVALID', 422);
      expect(e.publicMessage, what).toBe('This cannot be attached to your message.');
    }
    const e = await rejects(write(a, 'Hello.', { kind: 'SCAN', id: old }), 'MESSAGE_CONTEXT_EXPIRED', 422);
    expect(e.publicMessage).toBe('This scan is more than 24 hours old. Scan the piece again to write about it, or write from MESSAGES.');
    // Nothing was written by a refusal: not even the conversation.
    expect(await t.db.selectFrom('client_conversations').select('id').where('account_id', '=', a.id).execute()).toHaveLength(0);
  });

  it('checks the words: required, at most 2,000 characters for a collector and 4,000 for an answer, line breaks kept', async () => {
    expect(normalizeCollectorBody('  Line one\r\nLine two  ')).toBe('Line one\nLine two');
    const a = await createAccount(t.db);
    expect((await rejects(write(a, '   '), 'VALIDATION_FAILED', 400)).publicMessage).toBe('Write your message.');
    expect((await rejects(write(a, 'x'.repeat(MESSAGE_LIMITS.collector + 1)), 'VALIDATION_FAILED', 400)).publicMessage).toBe('Your message is limited to 2,000 characters.');
    await write(a, 'x'.repeat(MESSAGE_LIMITS.collector));
    const { id } = await conversationOf(a.id);
    expect((await rejects(messages().answer(id, operator, { body: '' }), 'VALIDATION_FAILED', 400)).publicMessage).toBe('Write the answer.');
    await rejects(messages().answer(id, operator, { body: 'y'.repeat(MESSAGE_LIMITS.staff + 1) }), 'VALIDATION_FAILED', 400);
    await messages().answer(id, operator, { body: 'y'.repeat(MESSAGE_LIMITS.staff) });
  });

  it('refuses a locked account, and the eleventh message within a rolling hour', async () => {
    const locked = await createAccount(t.db);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    await rejects(write(locked, 'Hello.'), 'ACCOUNT_LOCKED', 403);
    const a = await createAccount(t.db);
    for (let i = 0; i < MESSAGE_RATE.messages; i++) {
      await write(a, `Message ${i + 1}.`);
      clock.advance(MINUTE);
    }
    const e = await rejects(write(a, 'One more.'), 'MESSAGE_LIMIT', 429);
    expect(e.publicMessage).toBe('You have written several messages within the hour. Please write again later.');
    // Staff answers do not count; an hour after the first, one more is accepted.
    const { id } = await conversationOf(a.id);
    await messages().answer(id, operator, { body: 'Thank you.' });
    clock.advance(HOUR - MESSAGE_RATE.messages * MINUTE + 1);
    await write(a, 'One more.');
  });

  it('keeps the waiting time while the collector writes again, answers, closes, and reopens a closed conversation when the collector writes again', async () => {
    const a = await createAccount(t.db);
    const first = clock.now();
    await write(a, 'First.');
    clock.advance(10 * MINUTE);
    await write(a, 'Second.');
    let c = await conversationOf(a.id);
    expect(c).toMatchObject({ status: 'TO_ANSWER', answered_by: null, closed_at: null });
    expect(c.waiting_since?.toISOString()).toBe(first.toISOString());
    clock.advance(MINUTE);
    const answered = await messages().answer(c.id, operator, { body: 'Our answer.' });
    expect(answered).toMatchObject({ status: 'ANSWERED', waitingSince: null, answeredBy: { id: operator.id } });
    // The answering staff member stays when another answers.
    await messages().answer(c.id, operator2, { body: 'And more.' });
    expect((await conversationOf(a.id)).answered_by).toBe(operator.id);
    clock.advance(MINUTE);
    await write(a, 'Thanks.');
    c = await conversationOf(a.id);
    expect(c.status).toBe('TO_ANSWER');
    expect(c.waiting_since?.toISOString()).toBe(clock.now().toISOString());
    const closed = await messages().close(c.id, operator);
    expect(closed).toMatchObject({ status: 'CLOSED', closedBy: { id: operator.id }, waitingSince: null });
    await rejects(messages().close(c.id, operator), 'CONVERSATION_CLOSED', 409);
    clock.advance(MINUTE);
    await write(a, 'One more question.');
    c = await conversationOf(a.id);
    expect(c).toMatchObject({ status: 'TO_ANSWER', closed_at: null, closed_by: null });
    const writes = (await audits('message.write')).filter((x) => x.target_id === c.id);
    expect(writes.map((x) => (x.details as { reopened: boolean }).reopened)).toEqual([false, false, false, true]);
    expect(writes.every((x) => x.actor_type === 'account' && x.actor_id === a.id)).toBe(true);
    // Take and assign: who answers; an assignment names an active OPERATOR or ADMIN only.
    await messages().take(c.id, operator2);
    expect((await conversationOf(a.id)).answered_by).toBe(operator2.id);
    const admin = await staff('ADMIN');
    await messages().assign(c.id, operator.id, admin);
    expect((await conversationOf(a.id)).answered_by).toBe(operator.id);
    const assign = (await audits('message.assign')).at(-1)!;
    expect(assign.details).toMatchObject({ before: operator2.id, after: operator.id });
    await rejects(messages().assign(c.id, randomUUID(), admin), 'VALIDATION_FAILED', 400);
    const auditor = (await t.db.insertInto('admin_users').values({ email: `au-${randomUUID()}@orbes.test`, email_normalized: `au-${randomUUID()}@orbes.test`, password_hash: 'x', role: 'AUDITOR' }).returning('id').executeTakeFirstOrThrow()).id;
    await rejects(messages().assign(c.id, auditor, admin), 'VALIDATION_FAILED', 400);
  });

  it('never opens a conversation for staff: an answer needs one the collector opened', async () => {
    await rejects(messages().answer(randomUUID(), operator, { body: 'Hello.' }), 'CONVERSATION_NOT_FOUND', 404);
    await rejects(messages().answer('not-an-id', operator, { body: 'Hello.' }), 'CONVERSATION_NOT_FOUND', 404);
    await rejects(messages().take(randomUUID(), operator), 'CONVERSATION_NOT_FOUND', 404);
    await rejects(messages().close(randomUUID(), operator), 'CONVERSATION_NOT_FOUND', 404);
    const a = await createAccount(t.db);
    expect(await messages().thread(a.id)).toEqual({ messages: [], unread: false });
    expect(await t.db.selectFrom('client_conversations').select('id').where('account_id', '=', a.id).execute()).toEqual([]);
  });

  it('orders the board by the tier read now: PALLADIUM, then PLATINE, then the rest, the longest waiting first; then the others, newest first; the mark goes with the tier', async () => {
    // Earlier tests left their conversations: close them so the board holds only this test's.
    for (const c of await t.db.selectFrom('client_conversations').select('id').where('status', '!=', 'CLOSED').execute()) await messages().close(c.id, operator);
    const none = await accountOfTier(f, 0);
    const titane = await accountOfTier(f, 1);
    const platine = await accountOfTier(f, 2);
    const palladium = await accountOfTier(f, 3);
    const answered = await accountOfTier(f, 3);
    for (const a of [none, titane, answered, platine, palladium]) {
      await write(a, 'Hello.');
      clock.advance(MINUTE);
    }
    await messages().answer((await conversationOf(answered.id)).id, operator, { body: 'Answered.' });
    const board = await messages().board({}, { page: 1, pageSize: 50 }, operator);
    expect(board.items.map((r) => r.account.id)).toEqual([palladium.id, platine.id, none.id, titane.id]);
    expect(board.items.map((r) => r.priority)).toEqual(['PALLADIUM', 'PLATINE', null, null]);
    expect(board.toAnswer).toBe(4);
    expect(await messages().summary()).toEqual({ toAnswer: 4, priority: 2 });
    const all = await messages().board({ status: 'ALL' }, { page: 1, pageSize: 50 }, operator);
    expect(all.items.slice(0, 5).map((r) => r.account.id)).toEqual([palladium.id, platine.id, none.id, titane.id, answered.id]);
    expect(all.items[4]).toMatchObject({ status: 'ANSWERED', answeredBy: { id: operator.id }, lastMessage: { author: 'STAFF', excerpt: 'Answered.' } });
    // Mine, unassigned, and by email.
    expect((await messages().board({ status: 'ALL', who: 'mine' }, { page: 1, pageSize: 50 }, operator)).items.map((r) => r.account.id)).toContain(answered.id);
    expect((await messages().board({ who: 'unassigned' }, { page: 1, pageSize: 50 }, operator)).items).toHaveLength(4);
    expect((await messages().board({ status: 'ALL', q: palladium.email.slice(0, 20) }, { page: 1, pageSize: 50 }, operator)).items.map((r) => r.account.id)).toEqual([palladium.id]);
    // PALLADIUM holds no piece any more: it loses its mark and its place at once.
    await t.db.updateTable('ownership').set({ ended_at: clock.now() }).where('account_id', '=', palladium.id).execute();
    const after = await messages().board({}, { page: 1, pageSize: 50 }, operator);
    expect(after.items.map((r) => r.account.id)).toEqual([platine.id, none.id, titane.id, palladium.id]);
    expect(after.items.map((r) => r.priority)).toEqual(['PLATINE', null, null, null]);
    expect(await messages().summary()).toEqual({ toAnswer: 4, priority: 1 });
  });

  it('puts first and marks the tier THE PROGRAM names (BP-19 T8): from PALLADIUM only, or off, then the longest waiting first only; and gives no answer time anywhere', async () => {
    for (const c of await t.db.selectFrom('client_conversations').select('id').where('status', '!=', 'CLOSED').execute()) await messages().close(c.id, operator);
    const none = await accountOfTier(f, 0);
    const platine = await accountOfTier(f, 2);
    const palladium = await accountOfTier(f, 3);
    for (const a of [none, platine, palladium]) {
      await write(a, 'Hello.');
      clock.advance(MINUTE);
    }
    const admin = await staff('ADMIN');
    const program = await ctx.services.clubProgram.read();
    const order = async () => (await messages().board({}, { page: 1, pageSize: 50 }, operator)).items.map((r) => [r.account.id, r.priority]);
    try {
      // The default, PLATINE: PALLADIUM, then PLATINE, then the rest.
      expect(await order()).toEqual([
        [palladium.id, 'PALLADIUM'],
        [platine.id, 'PLATINE'],
        [none.id, null],
      ]);
      // From PALLADIUM: PLATINE waits with the rest, unmarked.
      await ctx.services.clubProgram.update({ ...program, messagesPriorityMinTier: 3 }, admin);
      expect(await order()).toEqual([
        [palladium.id, 'PALLADIUM'],
        [none.id, null],
        [platine.id, null],
      ]);
      expect(await messages().summary()).toEqual({ toAnswer: 3, priority: 1 });
      // Off: the longest waiting first only, no mark.
      await ctx.services.clubProgram.update({ ...program, messagesPriorityMinTier: 0 }, admin);
      expect(await order()).toEqual([
        [none.id, null],
        [platine.id, null],
        [palladium.id, null],
      ]);
      expect(await messages().summary()).toEqual({ toAnswer: 3, priority: 0 });
      const conv = await messages().conversation((await conversationOf(palladium.id)).id);
      expect(conv.priority).toBeNull();
      // No due time, answer time or SLA in any field.
      expect(JSON.stringify(conv)).not.toMatch(/due|sla|answerBy|deadline/i);
    } finally {
      await ctx.services.clubProgram.update(program, admin);
    }
  });

  it('finds a conversation by a scan\'s REF, and says what it concerns: the latest place, and how many more', async () => {
    const a = await createAccount(t.db);
    const [piece] = await holdPieces(t.db, a.id, 1, f.modelId);
    const s = await scan();
    await write(a, 'This scan.', { kind: 'SCAN', id: s });
    await write(a, 'And my piece.', { kind: 'PIECE', id: piece! });
    await write(a, 'Without a place.');
    const ref = s.slice(0, 8).toUpperCase();
    const found = await messages().board({ status: 'ALL', q: ref.toLowerCase() }, { page: 1, pageSize: 50 }, operator);
    expect(found.items.map((r) => r.account.id)).toEqual([a.id]);
    expect(found.items[0]!.concerns).toMatchObject({ kind: 'PIECE', productId: expect.stringMatching(/^O26-J-/) });
    expect(found.items[0]!.moreConcerns).toBe(1);
    const c = await messages().conversation(found.items[0]!.id);
    expect(c.messages.map((m) => m.concerns?.kind ?? null)).toEqual(['SCAN', 'PIECE', null]);
    expect(c.messages[0]!.concerns).toMatchObject({ scanEventId: s, scanRef: ref, label: `REF ${ref} · INVALID SIGNATURE` });
  });

  it('marks the answers read up to a time, never later than now', async () => {
    const a = await createAccount(t.db);
    await write(a, 'Hello.');
    expect(await messages().unread(a.id)).toEqual({ unread: false });
    const { id } = await conversationOf(a.id);
    clock.advance(MINUTE);
    await messages().answer(id, operator, { body: 'Our answer.' });
    expect(await messages().unread(a.id)).toEqual({ unread: true });
    const thread = await messages().thread(a.id);
    expect(thread.unread).toBe(true);
    expect(thread.messages.at(-1)).toMatchObject({ from: 'ORBES_CLIENT_SERVICES', body: 'Our answer.', concerning: null });
    // Staff are never named to the collector.
    expect(JSON.stringify(thread)).not.toContain(operator.id);
    await messages().markRead(a.id, thread.messages.at(-1)!.at);
    expect(await messages().unread(a.id)).toEqual({ unread: false });
    // A later answer is new again; a time in the future reads up to now only, and an earlier one never goes back.
    clock.advance(MINUTE);
    await messages().answer(id, operator, { body: 'And one more.' });
    await messages().markRead(a.id, new Date(clock.now().getTime() - HOUR));
    expect(await messages().unread(a.id)).toEqual({ unread: true });
    await messages().markRead(a.id, new Date(clock.now().getTime() + HOUR));
    expect((await conversationOf(a.id)).collector_read_at?.toISOString()).toBe(clock.now().toISOString());
    expect(await messages().unread(a.id)).toEqual({ unread: false });
  });

  it('counts the answers unread (unreadCount), as `unread` reads them, for the account alone', async () => {
    const a = await createAccount(t.db);
    const other = await createAccount(t.db);
    // No conversation yet, then only the collector's own words: nothing to read.
    expect(await messages().unreadCount(a.id)).toEqual({ count: 0 });
    await write(a, 'Hello.');
    await write(other, 'Hello too.');
    expect(await messages().unreadCount(a.id)).toEqual({ count: 0 });
    const { id } = await conversationOf(a.id);
    const theirs = (await conversationOf(other.id)).id;
    clock.advance(MINUTE);
    await messages().answer(id, operator, { body: 'One.' });
    const firstAt = clock.now();
    clock.advance(MINUTE);
    await messages().answer(id, operator2, { body: 'Two.' });
    await write(a, 'Thank you.');
    // Two answers unread, whoever wrote them; the collector's own message after them is not counted.
    expect(await messages().unreadCount(a.id)).toEqual({ count: 2 });
    expect(await messages().unread(a.id)).toEqual({ unread: true });
    // Another account's answers are never counted for this one, and this one's never for it.
    expect(await messages().unreadCount(other.id)).toEqual({ count: 0 });
    clock.advance(MINUTE);
    await messages().answer(theirs, operator, { body: 'Yours.' });
    expect(await messages().unreadCount(other.id)).toEqual({ count: 1 });
    expect(await messages().unreadCount(a.id)).toEqual({ count: 2 });
    // Read up to the first answer: the second only; up to now: none, with `unread`.
    await messages().markRead(a.id, firstAt);
    expect(await messages().unreadCount(a.id)).toEqual({ count: 1 });
    await messages().markRead(a.id, clock.now());
    expect(await messages().unreadCount(a.id)).toEqual({ count: 0 });
    expect(await messages().unread(a.id)).toEqual({ unread: false });
    // A later answer is counted again; the account must be an account's id.
    clock.advance(MINUTE);
    await messages().answer(id, operator, { body: 'Three.' });
    expect(await messages().unreadCount(a.id)).toEqual({ count: 1 });
    expect(await messages().unreadCount(other.id)).toEqual({ count: 1 });
    await expect(messages().unreadCount('not-an-id')).rejects.toBeInstanceOf(DomainError);
  });

  it('keeps one conversation consistent under two answers and a write at once', async () => {
    const a = await createAccount(t.db);
    await write(a, 'Hello.');
    const { id } = await conversationOf(a.id);
    clock.advance(MINUTE);
    await Promise.all([messages().answer(id, operator, { body: 'One.' }), messages().answer(id, operator2, { body: 'Two.' }), write(a, 'Three.')]);
    const rows = await t.db.selectFrom('client_messages').select(['author', 'body']).where('conversation_id', '=', id).execute();
    expect(rows.map((r) => r.body).sort()).toEqual(['Hello.', 'One.', 'Three.', 'Two.']);
    const c = await conversationOf(a.id);
    expect(['TO_ANSWER', 'ANSWERED']).toContain(c.status);
    expect(c.waiting_since !== null).toBe(c.status === 'TO_ANSWER');
    expect([operator.id, operator2.id]).toContain(c.answered_by);
    expect(await t.db.selectFrom('client_conversations').select('id').where('account_id', '=', a.id).execute()).toHaveLength(1);
  });

  it('writes no words into the audit log', async () => {
    const a = await createAccount(t.db);
    const secret = `My private words ${randomUUID()}`;
    await write(a, secret);
    const { id } = await conversationOf(a.id);
    const answer = `Our private answer ${randomUUID()}`;
    await messages().answer(id, operator, { body: answer });
    await messages().take(id, operator2);
    await messages().close(id, operator);
    const entries = await t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', id).execute();
    expect(entries.map((e) => e.action).sort()).toEqual(['message.answer', 'message.close', 'message.take', 'message.write']);
    for (const e of entries) {
      const text = JSON.stringify(e.details);
      expect(text).not.toContain('private');
      expect(Object.keys(e.details ?? {}).some((k) => /^(body|words|text)$/i.test(k))).toBe(false);
    }
  });

  it('keeps a message\'s REF when the scan retention deletes its scan, and exports the account\'s messages without who answered', async () => {
    const a = await createAccount(t.db);
    const s = await scan({ at: clock.now() });
    await write(a, 'This scan.', { kind: 'SCAN', id: s });
    const { id } = await conversationOf(a.id);
    await messages().answer(id, operator, { body: 'We looked.' });
    clock.advance(25 * HOUR);
    expect(await purgeScanHistory(t.db, new Date(clock.now().getTime() - HOUR))).toBeGreaterThanOrEqual(1);
    const row = await t.db.selectFrom('client_messages').selectAll().where('conversation_id', '=', id).where('author', '=', 'COLLECTOR').executeTakeFirstOrThrow();
    expect(row).toMatchObject({ scan_event_id: null, scan_ref: s.slice(0, 8).toUpperCase(), context_kind: 'SCAN', context_label: `REF ${s.slice(0, 8).toUpperCase()} · INVALID SIGNATURE` });
    const c = await messages().conversation(id);
    expect(c.messages[0]!.concerns).toMatchObject({ scanEventId: null, scanRef: s.slice(0, 8).toUpperCase() });
    // The collector's thread keeps the label, with no place and no `ref` once the scan is gone: nothing to attach again.
    expect((await messages().thread(a.id)).messages[0]!.concerning).toEqual({ kind: 'SCAN', label: `REF ${s.slice(0, 8).toUpperCase()} · INVALID SIGNATURE`, path: null, ref: null });
    const exported = await accountMessages(t.db, a.id);
    expect(exported).toEqual([
      { at: expect.any(Date), from: 'YOU', body: 'This scan.', concerning: { kind: 'SCAN', label: `REF ${s.slice(0, 8).toUpperCase()} · INVALID SIGNATURE` } },
      { at: expect.any(Date), from: 'ORBES_CLIENT_SERVICES', body: 'We looked.', concerning: null },
    ]);
    expect(JSON.stringify(exported)).not.toContain(operator.id);
  });

  it('labels the place of a house guarantee not shown, used at the draw, PLACE HELD as the release page says it, never a mark of the guarantee', async () => {
    const opensAt = new Date(clock.now().getTime() + 2 * HOUR);
    const guaranteed = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'Monolithe in gold', quantity: 3, opensAt, closesAt: new Date(opensAt.getTime() + HOUR), earlyAccessHours: 0, earlyAccessPlatineHours: 0 }, f.admin);
    const holder = await createAccount(t.db);
    await ctx.services.guarantees.grant(holder.id, { scope: 'RELEASE', targetId: guaranteed.id, pieces: 1, validUntil: '2026-12-31', visible: false }, f.admin);
    clock.set(new Date(opensAt.getTime() + MINUTE));
    await f.drops.enter(holder.id, guaranteed.id, holder.actor);
    clock.advance(HOUR);
    await f.drops.draw(guaranteed.id, f.admin);
    expect(await t.db.selectFrom('drop_entries').select(['status', 'tier', 'rank']).where('drop_id', '=', guaranteed.id).where('account_id', '=', holder.id).executeTakeFirstOrThrow()).toEqual({ status: 'SELECTED', tier: null, rank: null });
    expect((await write(holder, 'My place.', { kind: 'RELEASE', id: guaranteed.id })).message.concerning?.label).toBe('MONOLITHE IN GOLD · PLACE HELD');
    expect((await f.drops.accountEntries(holder.id)).find((e) => e.dropId === guaranteed.id)).toMatchObject({ reserved: false, guaranteed: false });
  });
});
