/**
 * THE RELEASES' PAST over HTTP (plan LIVE RELEASE+, step S7: choice 5, decisions 28 to 30; services/past-releases.ts,
 * GET /api/v1/releases/past and GET /api/v1/account/participation), with real sessions and the real engine's actions:
 *
 *  - PAST is public and the same for everyone (kept a minute): every release ended, the newest opening first, LIVE
 *    RELEASES (sold out, ended by ORBES, or ended before its name was revealed) and drawn draws together; never a draft,
 *    a cancelled release, an after-room (decision 28), a LIVE RELEASE not ended nor a draw not drawn (those are LIVE's,
 *    and LIVE's draws are those neither drawn nor cancelled), a LIVE RELEASE whose hold still runs after its end (until
 *    it is over), nor one ended before its announcement; a page at a time;
 *  - each card says what was announced and nothing of the end: its photograph, its name, its opening, the quantity line
 *    as announced even after pieces were added live (decision 29), each LIVE part from its stage as it stood at the end
 *    (still unnamed long after the time set for its name, on its card, its page and its rule of access); no count, stock,
 *    reason of the end or interest in the very bytes, nor in a drawn draw's page;
 *  - the account's part: 401 without a session, never kept by a cache; each release taken part in once (an after-room's
 *    under the release it follows), YOU SECURED A PIECE for a LIVE piece confirmed (its after-room's included) or a draw's
 *    entry confirmed, the count the access rule reads; another account's never.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { afterRoomTimes } from '../../src/server/services/after-room.js';
import { participations } from '../../src/server/services/participation.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { jpegPhoto } from '../support/images.js';
import { createLiveRelease, createModel, entriesOf, holdPieces, liveFixtureOn, type LiveFixture, type LiveReleaseOptions } from '../support/live.js';
import { accountClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = '2026-11-02T09:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(START) + ms);

interface Card {
  id: string;
  kind: string;
  title: string | null;
  model: { name: string | null; type: string | null; collection: string | null };
  imageUrl: string | null;
  opensAt: string;
  quantityLine: string;
}

interface Collector {
  client: Client;
  id: string;
  actor: Actor;
}

describe("THE RELEASES' PAST (GET /api/v1/releases/past) and the account's part (GET /api/v1/account/participation)", () => {
  let h: Harness;
  let f: LiveFixture;
  let image: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(START);
    f = await liveFixtureOn(h.ctx, h.clock);
    image = (await h.ctx.services.media.setModelImage(f.modelId, { mime: 'image/jpeg', bytes: jpegPhoto(400, 400) }, SYSTEM_ACTOR)).url;
  });
  afterAll(() => h?.close());

  async function collector(pieces = 0): Promise<Collector> {
    const { client, email } = await accountClient(h);
    const { id } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    if (pieces) await holdPieces(h.ctx.db, id, pieces, f.modelId);
    return { client, id, actor: { type: 'account', id } };
  }

  const release = async (title: string, o: Partial<LiveReleaseOptions> & { opensAt: Date }) => {
    const r = await createLiveRelease(f, { quantityLine: '25 PIECES', ...o });
    await h.ctx.db.updateTable('drops').set({ title }).where('id', '=', r.id).execute();
    return r;
  };

  const holdAndSecure = async (dropId: string, who: Collector) => {
    const token = (await f.live.entry(who.id, dropId))!.turn!.token!;
    await f.live.press(who.id, dropId, token);
    h.clock.advance(1500);
    await f.live.secure(who.id, dropId, token, who.actor);
    await f.live.confirm(who.id, dropId, who.actor);
  };

  it('lists every release ended, newest first, LIVE RELEASES and draws together, as announced; never a draft, a cancelled release, an after-room nor one still to come', async () => {
    const a = await collector();
    const b = await collector();
    const c = await collector(1);
    const outsider = await collector();

    // The draws: one drawn, one still open, one cancelled.
    const draw = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — release I', quantity: 1, opensAt: at(MINUTE), closesAt: at(2 * MINUTE), earlyAccessHours: 0 }, f.admin);
    const open = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — release II', quantity: 1, opensAt: at(MINUTE), closesAt: at(10 * 24 * HOUR), earlyAccessHours: 0 }, f.admin);
    const dropped = await f.drops.create({ modelId: f.modelId, title: 'ECLIPSE — release III', quantity: 1, opensAt: at(3 * MINUTE), closesAt: at(4 * MINUTE), earlyAccessHours: 0 }, f.admin);
    for (const d of [draw, open, dropped]) await f.drops.publish(d.id, f.admin);
    await f.drops.cancel(dropped.id, f.admin);
    // The LIVE RELEASES: one ended by ORBES after a sale, one sold out with its after-room, one ended before its name
    // was revealed, one still to come, one cancelled, one never published.
    const ended = await release('MONOLITHE — LIVE I', { opensAt: at(30 * MINUTE), closesAt: at(90 * MINUTE), sizes: [{ label: '52', stock: 2 }] });
    const sold = await release('MONOLITHE — LIVE II', {
      opensAt: at(60 * MINUTE),
      closesAt: at(120 * MINUTE),
      sizes: [{ label: '52', stock: 1 }],
      afterRoom: { modelId: await createModel(h.ctx.db, 'AFTERGLOW'), priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] },
    });
    const early = await release('NOCTURNE — LIVE', { opensAt: at(5 * HOUR), closesAt: at(6 * HOUR), accessModels: [f.modelId] });
    await h.ctx.db.updateTable('drops').set({ name_at: at(4 * HOUR), photo_at: at(4 * HOUR), description: 'NOCTURNE, cast in Paris.' }).where('id', '=', early.id).execute();
    const coming = await release('MONOLITHE — LIVE III', { opensAt: at(48 * HOUR) });
    const cancelled = await release('MONOLITHE — LIVE IV', { opensAt: at(40 * MINUTE) });
    await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', cancelled.id).execute();
    const draft = await release('MONOLITHE — LIVE V', { opensAt: at(20 * MINUTE), closesAt: at(25 * MINUTE), published: false });

    // The draw: A and B enter, it is drawn, the one selected concluded by ORBES Client Services.
    h.clock.set(at(MINUTE + SECOND));
    for (const x of [a, b]) await f.drops.enter(x.id, draw.id, x.actor);
    h.clock.set(at(3 * MINUTE));
    await f.drops.draw(draw.id, f.admin);
    const selected = await h.ctx.db.selectFrom('drop_entries').select(['id', 'account_id']).where('drop_id', '=', draw.id).where('status', '=', 'SELECTED').executeTakeFirstOrThrow();
    await f.drops.confirm(draw.id, selected.id, null, f.admin);
    const drawBuyer = selected.account_id === a.id ? a : b;

    // LIVE I: A and B in the line; A secures and pays; pieces added live; then ORBES ends it.
    h.clock.set(at(29 * MINUTE));
    for (const x of [a, b]) await f.live.enter(x.id, ended.id, { sizeId: ended.sizes[0]!.id }, x.actor);
    h.clock.set(at(30 * MINUTE));
    await f.live.advance(ended.id);
    h.clock.advance(2 * SECOND);
    await holdAndSecure(ended.id, a);
    await f.live.addPieces(ended.id, ended.sizes[0]!.id, 3, f.admin);
    await f.live.end(ended.id, f.admin);

    // LIVE II: C (TITANE) first in the line secures the one piece: SOLD OUT; B, still waiting, is the after-room's guest
    // and secures its piece there.
    h.clock.set(at(59 * MINUTE));
    for (const x of [c, b]) await f.live.enter(x.id, sold.id, { sizeId: sold.sizes[0]!.id }, x.actor);
    h.clock.set(at(60 * MINUTE));
    await f.live.advance(sold.id);
    h.clock.advance(2 * SECOND);
    await holdAndSecure(sold.id, c);
    expect((await entriesOf(h.ctx.db, sold.id)).map((e) => e.status)).toEqual(['CONFIRMED', 'ENDED']);
    const soldOutAt = (await h.ctx.db.selectFrom('drops').select('ended_at').where('id', '=', sold.id).executeTakeFirstOrThrow()).ended_at!;
    h.clock.set(afterRoomTimes(soldOutAt, 10, 15).opensAt);
    const child = sold.afterRoom!;
    await f.live.enter(b.id, child.id, { sizeId: child.sizes[0]!.id }, b.actor);
    await f.live.advance(child.id);
    h.clock.advance(2 * SECOND);
    await holdAndSecure(child.id, b);

    // NOCTURNE: ended by ORBES before its room opened, its name and photograph never revealed.
    h.clock.set(at(2 * HOUR));
    await f.live.end(early.id, f.admin);
    h.clock.set(at(3 * HOUR));

    // PAST: public, kept a minute, the newest opening first.
    const res = await h.client().get('/api/v1/releases/past');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = safeJson(res) as { items: Card[]; page: number; pageSize: number; total: number };
    expect(body.items.map((x) => x.id)).toEqual([early.id, sold.id, ended.id, draw.id]);
    expect(body.total).toBe(4);
    for (const id of [open.id, dropped.id, coming.id, cancelled.id, draft.id, child.id]) expect(res.body).not.toContain(id);
    const opensOf = async (id: string) => (await h.ctx.db.selectFrom('drops').select('opens_at').where('id', '=', id).executeTakeFirstOrThrow()).opens_at.toISOString();
    expect(body.items).toEqual([
      // Ended before its name's stage: named nowhere, its photograph not shown.
      { id: early.id, kind: 'LIVE', title: null, model: { name: null, type: null, collection: null, variant: null }, imageUrl: null, opensAt: await opensOf(early.id), quantityLine: '25 PIECES' },
      { id: sold.id, kind: 'LIVE', title: 'MONOLITHE — LIVE II', model: { name: 'MONOLITHE', type: 'RING', collection: null, variant: null }, imageUrl: image, opensAt: await opensOf(sold.id), quantityLine: '25 PIECES' },
      // Three pieces added live: the line stays the one announced (decision 29).
      { id: ended.id, kind: 'LIVE', title: 'MONOLITHE — LIVE I', model: { name: 'MONOLITHE', type: 'RING', collection: null, variant: null }, imageUrl: image, opensAt: await opensOf(ended.id), quantityLine: '25 PIECES' },
      { id: draw.id, kind: 'DRAW', title: 'ECLIPSE — release I', model: { name: 'MONOLITHE', type: 'RING', collection: null, variant: null }, imageUrl: image, opensAt: await opensOf(draw.id), quantityLine: '1 PIECE' },
    ]);
    // No end figure in the bytes: no count, stock, reason of the end, interest, entries, seed or price.
    for (const word of ['SOLD_OUT', 'endedReason', 'ended', 'stock', 'interest', 'entries', 'seed', 'price', 'quantity"', 'NOCTURNE']) expect(res.body, word).not.toContain(word);

    // A drawn draw's page, which its card opens: no end figure either (not how many took part, no place reserved
    // directly counted); its ranked entries stay, the draw's verifiable record.
    const drawPage = await h.client().get(`/api/v1/drops/${draw.id}`);
    expect(safeJson(drawPage)).toMatchObject({ id: draw.id, state: 'DRAWN', reserved: 0 });
    expect(drawPage.body).not.toContain('"entries"');
    expect((safeJson(await h.client().get(`/api/v1/drops/${draw.id}/entries`)) as { items: unknown[] }).items).toHaveLength(2);

    // A page at a time.
    const first = safeJson(await h.client().get('/api/v1/releases/past?page=1&pageSize=3')) as { items: Card[]; page: number; pageSize: number; total: number };
    expect([first.items.map((x) => x.id), first.page, first.pageSize, first.total]).toEqual([[early.id, sold.id, ended.id], 1, 3, 4]);
    const second = safeJson(await h.client().get('/api/v1/releases/past?page=2&pageSize=3')) as { items: Card[]; total: number };
    expect([second.items.map((x) => x.id), second.total]).toEqual([[draw.id], 4]);
    expect((safeJson(await h.client().get('/api/v1/releases/past?page=nope&pageSize=-4')) as { page: number }).page).toBe(1);

    // LIVE's draws: neither drawn nor cancelled; LIVE's LIVE RELEASES: none ended.
    const draws = (safeJson(await h.client().get('/api/v1/drops')) as { drops: { id: string }[] }).drops.map((x) => x.id);
    expect(draws).toContain(open.id);
    expect(draws).not.toContain(draw.id);
    expect(draws).not.toContain(dropped.id);
    const lives = (safeJson(await h.client().get('/api/v1/live')) as { releases: { id: string }[] }).releases.map((x) => x.id);
    expect(lives).toEqual([coming.id]);

    // The account's part: 401 signed out; never kept; each release once, the after-room's under its release.
    const signedOut = await h.client().get('/api/v1/account/participation');
    expect([signedOut.statusCode, errorOf(signedOut).code]).toEqual([401, 'UNAUTHORIZED']);
    const part = async (x: Collector) => {
      const r = await x.client.get('/api/v1/account/participation');
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      return safeJson(r) as { count: number; releases: { id: string; secured: boolean }[] };
    };
    const sorted = (rows: { id: string; secured: boolean }[]) => [...rows].sort((p, q) => p.id.localeCompare(q.id));
    expect(await part(a)).toEqual({ count: 2, releases: sorted([{ id: draw.id, secured: drawBuyer === a }, { id: ended.id, secured: true }]) });
    expect(await part(b)).toEqual({ count: 3, releases: sorted([{ id: draw.id, secured: drawBuyer === b }, { id: ended.id, secured: false }, { id: sold.id, secured: true }]) });
    expect(await part(c)).toEqual({ count: 1, releases: [{ id: sold.id, secured: true }] });
    expect(await part(outsider)).toEqual({ count: 0, releases: [] });
    // The count the access rule reads (services/participation.ts).
    for (const x of [a, b, c, outsider]) expect((await part(x)).count).toBe(await participations(h.ctx.db, x.id, h.clock.now()));

    // Past the time set for NOCTURNE's name and photograph, and its room's opening: read as it stood at its end, still
    // named nowhere, on its card, its page, and in the rule of access said to an account the rule leaves out.
    h.clock.set(at(7 * HOUR));
    const later = await h.client().get('/api/v1/releases/past');
    expect((safeJson(later) as { items: Card[] }).items.find((x) => x.id === early.id)).toEqual(body.items[0]);
    expect(later.body).not.toContain('NOCTURNE');
    const page = await h.client().get(`/api/v1/live/${early.id}`);
    expect(safeJson(page)).toMatchObject({ phase: 'ENDED', title: null, name: null, type: null, collection: null, description: null, imageUrl: null, lookbook: null });
    for (const word of ['NOCTURNE', 'MONOLITHE', 'RING', 'Paris']) expect(page.body, word).not.toContain(word);
    const refused = await outsider.client.get(`/api/v1/live/${early.id}/state`);
    expect([refused.statusCode, errorOf(refused)]).toEqual([403, { code: 'LIVE_NOT_ELIGIBLE', message: 'This release is for owners of this model.' }]);
  });

  it('lists and opens a LIVE RELEASE in its final state once over, a hold still running keeping it whole and out of PAST; one ended before its announcement, a cancelled one and an after-room stay the 404 of an unknown release', async () => {
    const pastIds = async () => (safeJson(await h.client().get('/api/v1/releases/past?pageSize=50')) as { items: Card[] }).items.map((x) => x.id);
    const r = await release('MONOLITHE — LIVE VI', { opensAt: new Date(h.clock.now().getTime() + 10 * MINUTE) });
    // A piece held when ORBES ends it: the page stays whole until it is confirmed, and PAST does not list it yet.
    const who = await collector();
    h.clock.advance(5 * MINUTE);
    await f.live.enter(who.id, r.id, { sizeId: r.sizes[0]!.id }, who.actor);
    h.clock.advance(5 * MINUTE);
    await f.live.advance(r.id);
    h.clock.advance(2 * SECOND);
    const token = (await f.live.entry(who.id, r.id))!.turn!.token!;
    await f.live.press(who.id, r.id, token);
    h.clock.advance(1500);
    await f.live.secure(who.id, r.id, token, who.actor);
    await f.live.end(r.id, f.admin);
    expect(safeJson(await h.client().get(`/api/v1/live/${r.id}`))).toMatchObject({ phase: 'ENDED', sizes: [expect.objectContaining({ label: '52' })] });
    expect(await pastIds()).not.toContain(r.id);
    await f.live.confirm(who.id, r.id, who.actor);
    expect(await pastIds()).toContain(r.id);
    const page = safeJson(await h.client().get(`/api/v1/live/${r.id}`)) as Record<string, unknown>;
    expect(page).toMatchObject({ id: r.id, kind: 'LIVE', phase: 'ENDED', title: 'MONOLITHE — LIVE VI', name: 'MONOLITHE', imageUrl: image, quantityLine: '25 PIECES' });
    expect(Object.keys(page).sort()).toEqual(['collection', 'description', 'id', 'imageUrl', 'kind', 'lookbook', 'name', 'opensAt', 'phase', 'quantityLine', 'silhouetteUrl', 'title', 'type', 'variant']);
    // Ended before its announcement: never announced, even once the time set for it has passed.
    const unseen = await release('MONOLITHE — LIVE VIII', { opensAt: new Date(h.clock.now().getTime() + 3 * HOUR), announceAt: new Date(h.clock.now().getTime() + HOUR) });
    expect(errorOf(await h.client().get(`/api/v1/live/${unseen.id}`)).code).toBe('DROP_NOT_FOUND');
    await f.live.end(unseen.id, f.admin);
    h.clock.advance(2 * HOUR);
    expect(errorOf(await h.client().get(`/api/v1/live/${unseen.id}`)).code).toBe('DROP_NOT_FOUND');
    expect(await pastIds()).not.toContain(unseen.id);
    const cancelled = await release('MONOLITHE — LIVE VII', { opensAt: new Date(h.clock.now().getTime() + 10 * MINUTE) });
    await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', cancelled.id).execute();
    expect(errorOf(await h.client().get(`/api/v1/live/${cancelled.id}`)).code).toBe('DROP_NOT_FOUND');
    const child = (await h.ctx.db.selectFrom('drops').select('id').where('parent_drop_id', 'is not', null).executeTakeFirstOrThrow()).id;
    expect(errorOf(await h.client().get(`/api/v1/live/${child}`)).code).toBe('DROP_NOT_FOUND');
  });
});
