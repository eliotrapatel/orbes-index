/**
 * The LIVE RELEASES' customer API and real time (plan of 2026-10-04, step L2; routes/live.ts, services/live-room.ts,
 * http/live-stream.ts):
 *
 *  - every public surface (the list, the page, the banner, the .ics, the board) 404 before the announcement, for a
 *    draft, a cancelled release, a draw, an unknown or malformed id; each stage (silhouette, name, photograph) never
 *    before its time, read in the very bytes each surface answers; an ended release leaves the list and the banner, its
 *    page once over in its final state (plan LIVE RELEASE+, decision 30: what was announced, never an end figure);
 *  - the account's routes: I'LL BE THERE and its withdrawal, ENTER, CHANGE SIZE (before T0 only), LEAVE, PRESS,
 *    SECURE (the gesture's rule), the add-ons, PAY, RELEASE MY PLACE and the second chance, the state with the room and
 *    the account's own entry (its place, those ahead, its turn's secret), MY PIECES; the network's keyed hash kept;
 *  - who reads the room: 401 without a session, 403 LIVE_NOT_ELIGIBLE (the rule in words, the release's own model
 *    unnamed before its stage) for an account the rule leaves out, the state of an entrant whatever its tier now, a REMOVED entry's state but not its stream;
 *  - CSRF and the same-origin rule on every mutation, the board's included;
 *  - the rate group `live`: an account's budget, its network's;
 *  - the streams over HTTP: the first events, then only what changed, the server's time in each, a heartbeat after 20 s
 *    of quiet, the turn's secret to its own account only, at most two per account, a disconnection that frees its
 *    place, one frame and one read of the entries per pulse whatever the audience, the last frame then the end once
 *    over (204 afterwards), the end of a REMOVED entry's stream, the end of a stream whose session has ended (signed
 *    out, account locked), the server's shutdown with streams open;
 *  - the board by its secret link only: valid, missing, malformed, wrong, another release's, replaced, revoked, a stream
 *    open on a link replaced or revoked ended at the next pulse; never a person in its answers, never indexed;
 *  - the clock for the page's sync, the .ics (its alarm, its lines).
 */
import { createHash } from 'node:crypto';
import { ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LIVE_HEARTBEAT_MS, LIVE_STREAMS_PER_ACCOUNT, liveRetryMs } from '../../src/server/http/live-stream.js';
import { LIVE_NETWORK_RATE_FACTOR } from '../../src/server/http/rate-limit.js';
import { LIVE_GESTURE_MIN_MS, liveNetworkHash } from '../../src/server/services/live.js';
import { foldIcsLine, liveStages } from '../../src/server/services/live-room.js';
import { jpegPhoto } from '../support/images.js';
import { createCollection, createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture, type LiveRelease, type LiveReleaseOptions } from '../support/live.js';
import { openSse } from '../support/sse.js';
import { accountClient, adminClient, createHarness, errorOf, ORIGIN, safeJson, type Client, type Harness } from './support.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = '2026-11-02T09:00:00.000Z';

interface Member {
  client: Client;
  id: string;
  email: string;
}

/** A registered, signed-in customer holding `pieces` pieces of the fixture's model (its tier: 1 TITANE, 3 PLATINE, 5 PALLADIUM). */
async function member(h: Harness, f: LiveFixture, pieces = 0, ip?: string): Promise<Member> {
  const { client, email } = await accountClient(h, ip ? { ip } : {});
  const { id } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
  if (pieces) await holdPieces(h.ctx.db, id, pieces, f.modelId);
  return { client, id, email };
}

/** A release opening in `inMinutes` (its room 5 minutes before), announced now unless said otherwise. */
async function release(h: Harness, f: LiveFixture, o: Partial<LiveReleaseOptions> & { inMinutes?: number } = {}): Promise<LiveRelease> {
  const opensAt = new Date(h.clock.now().getTime() + (o.inMinutes ?? 30) * MINUTE);
  return createLiveRelease(f, { opensAt, closesAt: new Date(opensAt.getTime() + HOUR), ...o });
}

const advance = (h: Harness, id: string) => h.ctx.services.live.advance(id);

/** Every LIVE RELEASE still current cancelled: the list and the banner then show only a test's own. */
const clearReleases = (h: Harness) =>
  h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('mode', '=', 'LIVE').where('cancelled_at', 'is', null).where('ended_at', 'is', null).execute();

const until = async (test: () => boolean) => {
  for (let i = 0; i < 200 && !test(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(test()).toBe(true);
};

// ── The suite ──────────────────────────────────────────────────────────────

describe('LIVE RELEASES: the customer API and real time', () => {
  let h: Harness;
  let f: LiveFixture;
  let base: string;

  beforeAll(async () => {
    h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    h.clock.set(START);
    f = await liveFixtureOn(h.ctx, h.clock);
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(h.app.server.address() as { port: number }).port}`;
  });
  afterAll(() => h?.close());

  describe('every public surface waits for the announcement', () => {
    it('answers 404 before it, for a draft, a cancelled release, a draw, an unknown or malformed id; then the release appears', async () => {
      const r = await release(h, f, { announceAt: new Date(h.clock.now().getTime() + HOUR), inMinutes: 3 * 60, minTier: 0 });
      const viewer = await member(h, f, 1);
      // Every account mutation answers as for an unknown release before the announcement: an id says nothing of it.
      const mutations = (id: string, sizeId: string): [string, string, unknown][] => [
        ['PUT', `/api/v1/live/${id}/interest`, { sizeId }],
        ['DELETE', `/api/v1/live/${id}/interest`, undefined],
        ['POST', `/api/v1/live/${id}/enter`, { sizeId }],
        ['POST', `/api/v1/live/${id}/size`, { sizeId }],
        ['POST', `/api/v1/live/${id}/leave`, {}],
        ['POST', `/api/v1/live/${id}/press`, { token: 'abc' }],
        ['POST', `/api/v1/live/${id}/secure`, { token: 'abc' }],
        ['PUT', `/api/v1/live/${id}/addons`, { addonIds: [] }],
        ['POST', `/api/v1/live/${id}/confirm`, {}],
        ['POST', `/api/v1/live/${id}/release`, {}],
      ];
      const unknown = async (id: string, sizeId: string) => {
        for (const [method, url, body] of mutations(id, sizeId)) {
          const res = await viewer.client.request(method, url, { body });
          expect([method, url, res.statusCode, errorOf(res).code]).toEqual([method, url, 404, 'DROP_NOT_FOUND']);
        }
      };
      const { token } = await f.live.issueBoardLink(r.id, f.admin);
      const c = h.client();
      const hidden = async () => {
        for (const url of [`/api/v1/live/${r.id}`, `/api/v1/live/${r.id}/calendar.ics`]) {
          const res = await c.get(url);
          expect([url, res.statusCode]).toEqual([url, 404]);
          expect(errorOf(res).code).toBe('DROP_NOT_FOUND');
        }
        expect(errorOf(await c.post(`/api/v1/live/${r.id}/board`, { token })).code).toBe('DROP_NOT_FOUND');
        expect((safeJson(await c.get('/api/v1/live')) as { releases: { id: string }[] }).releases.map((x) => x.id)).not.toContain(r.id);
        expect((safeJson(await c.get('/api/v1/live/next')) as { release: { id: string } | null }).release?.id).not.toBe(r.id);
        for (const res of [
          await viewer.client.get(`/api/v1/live/${r.id}/state`),
          await viewer.client.get(`/api/v1/live/${r.id}/stream`),
          await viewer.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } }),
        ]) {
          expect(res.statusCode).toBe(404);
          expect(errorOf(res).code).toBe('DROP_NOT_FOUND');
        }
      };
      await hidden();
      await unknown(r.id, r.sizes[0]!.id);
      const board = await openSse(base, `/api/v1/live/${r.id}/board/stream`, { method: 'POST', body: { token }, origin: ORIGIN });
      expect(board.status).toBe(404);
      // Cancelled before its announcement: the same 404, never 409 DROP_CANCELLED.
      const early = await release(h, f, { announceAt: new Date(h.clock.now().getTime() + HOUR), inMinutes: 3 * 60 });
      await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', early.id).execute();
      await unknown(early.id, early.sizes[0]!.id);

      h.clock.advance(HOUR);
      expect((await c.get(`/api/v1/live/${r.id}`)).statusCode).toBe(200);
      expect((safeJson(await c.get('/api/v1/live')) as { releases: { id: string }[] }).releases.map((x) => x.id)).toContain(r.id);
      expect((await viewer.client.get(`/api/v1/live/${r.id}/state`)).statusCode).toBe(200);
      expect((await c.post(`/api/v1/live/${r.id}/board`, { token })).statusCode).toBe(200);

      const draft = await release(h, f, { published: false });
      const draw = await f.drops.create({ modelId: f.modelId, title: 'A DRAW', quantity: 3, opensAt: new Date(h.clock.now().getTime() + HOUR), closesAt: new Date(h.clock.now().getTime() + 2 * HOUR) }, f.admin);
      await f.drops.publish(draw.id, f.admin);
      const cancelled = await release(h, f);
      await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', cancelled.id).execute();
      for (const id of [draft.id, draw.id, cancelled.id, '00000000-0000-4000-8000-000000000000', 'not-an-id']) {
        for (const url of [`/api/v1/live/${id}`, `/api/v1/live/${id}/calendar.ics`]) expect(errorOf(await c.get(url)).code).toBe('DROP_NOT_FOUND');
      }
      expect(errorOf(await viewer.client.get(`/api/v1/live/${draw.id}/state`)).code).toBe('DROP_NOT_FOUND');
    });

    it('reveals each stage at its time, never before, on the page, the list, the banner, the .ics and the board', async () => {
      await clearReleases(h);
      const t = h.clock.now().getTime();
      const sha = createHash('sha256').update(jpegPhoto(8, 8)).digest('hex');
      const photo = jpegPhoto(10, 10);
      const photoSha = createHash('sha256').update(photo).digest('hex');
      await h.ctx.db.insertInto('media_objects').values({ sha256: sha, mime: 'image/jpeg', bytes: jpegPhoto(8, 8), width: 8, height: 8 }).execute();
      await h.ctx.db.insertInto('media_objects').values({ sha256: photoSha, mime: 'image/jpeg', bytes: photo, width: 10, height: 10 }).execute();
      const modelId = (await h.ctx.db.insertInto('models').values({ category_id: 1, name: 'NOCTURNE', type: 'CUFF', sku_prefix: 'NOC-STAGE', image_sha256: photoSha }).returning('id').executeTakeFirstOrThrow()).id;
      const r = await release(h, f, { modelId, inMinutes: 5 * 60, accessModels: [modelId] });
      await h.ctx.db
        .updateTable('drops')
        .set({ title: 'THE NOCTURNE CUFF', description: 'A cuff of the night.', silhouette_at: new Date(t + HOUR), name_at: new Date(t + 2 * HOUR), photo_at: new Date(t + 3 * HOUR), silhouette_sha256: sha })
        .where('id', '=', r.id)
        .execute();
      const { token } = await f.live.issueBoardLink(r.id, f.admin);
      const c = h.client();
      const surfaces = async () => {
        const sheet = await c.get(`/api/v1/live/${r.id}`);
        const list = await c.get('/api/v1/live');
        const card = (safeJson(list) as { releases: Record<string, unknown>[] }).releases.find((x) => x.id === r.id)!;
        const banner = await c.get('/api/v1/live/next');
        const ics = await c.get(`/api/v1/live/${r.id}/calendar.ics`);
        const board = await c.post(`/api/v1/live/${r.id}/board`, { token });
        return { sheet: sheet.body, card: JSON.stringify(card), banner: banner.body, ics: ics.body, board: board.body, json: safeJson(sheet) as Record<string, unknown> };
      };
      const leaks = (s: Awaited<ReturnType<typeof surfaces>>, word: string) => Object.entries(s).filter(([k, v]) => k !== 'json' && String(v).includes(word)).map(([k]) => k);
      // An account the rule leaves out reads the rule in its 403s (the state, the stream, I'LL BE THERE): the same stage.
      const outsider = await member(h, f, 0);
      const refusals = async () =>
        Promise.all(
          [
            outsider.client.get(`/api/v1/live/${r.id}/state`),
            outsider.client.get(`/api/v1/live/${r.id}/stream`),
            outsider.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } }),
          ].map(async (p) => {
            const res = await p;
            expect(res.statusCode).toBe(403);
            return errorOf(res);
          }),
        );

      // Announced: the price, the quantity line, the rule (the release's own model unnamed), no stage.
      let s = await surfaces();
      expect(s.json).toMatchObject({ phase: 'ANNOUNCED', revealed: { silhouette: false, name: false, photo: false }, title: null, name: null, silhouetteUrl: null, imageUrl: null, description: null, priceMinor: 505_000, quantityLine: '2 PIECES' });
      expect(s.json.access).toEqual({ minTier: 0, text: 'owners of this model' });
      expect(await refusals()).toEqual(Array(3).fill({ code: 'LIVE_NOT_ELIGIBLE', message: 'This release is for owners of this model.' }));
      expect(s.json.stages).toEqual({ silhouetteAt: new Date(t + HOUR).toISOString(), nameAt: new Date(t + 2 * HOUR).toISOString(), photoAt: new Date(t + 3 * HOUR).toISOString() });
      for (const word of ['NOCTURNE', 'CUFF', 'night', sha, photoSha]) expect(leaks(s, word)).toEqual([]);
      // The calendar of the reveals: each stage to come and its time, never what it shows.
      expect(s.json.reveals).toEqual([
        { stage: 'SILHOUETTE', at: new Date(t + HOUR).toISOString() },
        { stage: 'NAME', at: new Date(t + 2 * HOUR).toISOString() },
        { stage: 'PHOTO', at: new Date(t + 3 * HOUR).toISOString() },
      ]);
      expect(JSON.parse(s.card).reveals).toEqual(s.json.reveals);
      // The banner knows when the name comes (it reads the release again then), never the name before it.
      expect((JSON.parse(s.banner) as { release: unknown }).release).toMatchObject({ id: r.id, phase: 'ANNOUNCED', name: null, nameAt: new Date(t + 2 * HOUR).toISOString() });

      // The silhouette.
      h.clock.set(t + HOUR);
      s = await surfaces();
      expect(s.json).toMatchObject({ revealed: { silhouette: true, name: false, photo: false }, silhouetteUrl: `/api/v1/media/${sha}`, name: null, imageUrl: null });
      expect(leaks(s, sha).sort()).toEqual(['board', 'card', 'sheet']);
      for (const word of ['NOCTURNE', 'CUFF', 'night', photoSha]) expect(leaks(s, word)).toEqual([]);
      expect((s.json.reveals as { stage: string }[]).map((x) => x.stage)).toEqual(['NAME', 'PHOTO']);

      // The name: the title, the model, its type, the description; the rule names it; the banner and the .ics too.
      h.clock.set(t + 2 * HOUR - 1);
      expect(leaks(await surfaces(), 'NOCTURNE')).toEqual([]);
      expect(JSON.stringify(await refusals())).not.toContain('NOCTURNE');
      h.clock.set(t + 2 * HOUR);
      expect(await refusals()).toEqual(Array(3).fill({ code: 'LIVE_NOT_ELIGIBLE', message: 'This release is for owners of NOCTURNE.' }));
      s = await surfaces();
      expect(s.json).toMatchObject({ revealed: { name: true, photo: false }, title: 'THE NOCTURNE CUFF', name: 'NOCTURNE', type: 'CUFF', description: 'A cuff of the night.', imageUrl: null });
      expect(s.json.access).toEqual({ minTier: 0, text: 'owners of NOCTURNE' });
      expect(leaks(s, 'NOCTURNE').sort()).toEqual(['banner', 'board', 'card', 'ics', 'sheet']);
      expect(leaks(s, photoSha)).toEqual([]);
      expect((s.json.reveals as { stage: string }[]).map((x) => x.stage)).toEqual(['PHOTO']);

      // The photograph.
      h.clock.set(t + 3 * HOUR);
      s = await surfaces();
      expect(s.json).toMatchObject({ revealed: { photo: true }, imageUrl: `/api/v1/media/${photoSha}` });
      expect(leaks(s, photoSha).sort()).toEqual(['board', 'card', 'sheet']);
      expect(s.json.reveals).toEqual([]);
      await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', r.id).execute();

      // Without a silhouette uploaded, nor a photograph of the model, the calendar promises only the name.
      const bare = await release(h, f, { inMinutes: 5 * 60 });
      await h.ctx.db.updateTable('drops').set({ silhouette_at: new Date(t + 4 * HOUR), name_at: new Date(t + 4 * HOUR), photo_at: new Date(t + 4 * HOUR) }).where('id', '=', bare.id).execute();
      expect((safeJson(await c.get(`/api/v1/live/${bare.id}`)) as { reveals: unknown }).reveals).toEqual([{ stage: 'NAME', at: new Date(t + 4 * HOUR).toISOString() }]);
      await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', bare.id).execute();
    });

    it('never names the model’s collection in the rule before the name’s stage: the list, the page, the 403s and the circle’s post', async () => {
      const t = h.clock.now().getTime();
      const collectionId = await createCollection(h.ctx.db, 'SOLSTICE');
      const modelId = await createModel(h.ctx.db, 'EQUINOX', collectionId);
      const r = await release(h, f, { modelId, inMinutes: 5 * 60, accessCollectionId: collectionId, published: false });
      await h.ctx.db.updateTable('drops').set({ name_at: new Date(t + 2 * HOUR), photo_at: new Date(t + 2 * HOUR) }).where('id', '=', r.id).execute();
      await h.ctx.services.liveConsole.publish(r.id, { circlePost: true }, f.admin);
      const post = await h.ctx.db.selectFrom('circle_posts').select('body').where('drop_id', '=', r.id).executeTakeFirstOrThrow();
      const c = h.client();
      const outsider = await member(h, f, 0);
      const said = async () => {
        const list = (safeJson(await c.get('/api/v1/live')) as { releases: { id: string; access: unknown }[] }).releases.find((x) => x.id === r.id)!;
        const sheet = safeJson(await c.get(`/api/v1/live/${r.id}`)) as { access: unknown };
        const refusals = await Promise.all(
          [
            outsider.client.get(`/api/v1/live/${r.id}/state`),
            outsider.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } }),
          ].map(async (p) => errorOf(await p).message),
        );
        return { list: list.access, sheet: sheet.access, refusals };
      };

      // Before the name: « this model’s collection » wherever the rule is said; the post never names it.
      expect(await said()).toEqual({
        list: { minTier: 0, text: 'owners of this model’s collection' },
        sheet: { minTier: 0, text: 'owners of this model’s collection' },
        refusals: Array(2).fill('This release is for owners of this model’s collection.'),
      });
      expect(post.body).toContain('For owners of this model’s collection.');
      expect(post.body).not.toContain('SOLSTICE');
      // At the name: the collection by its name; the post, written once, still never names the piece.
      h.clock.set(t + 2 * HOUR);
      expect(await said()).toEqual({
        list: { minTier: 0, text: 'owners of the SOLSTICE collection' },
        sheet: { minTier: 0, text: 'owners of the SOLSTICE collection' },
        refusals: Array(2).fill('This release is for owners of the SOLSTICE collection.'),
      });
      // A collection other than the model's own is named from the announcement: it says nothing of the piece.
      const other = await createCollection(h.ctx.db, 'MERIDIAN');
      const r2 = await release(h, f, { modelId, inMinutes: 5 * 60, accessCollectionId: other });
      await h.ctx.db.updateTable('drops').set({ name_at: new Date(t + 4 * HOUR), photo_at: new Date(t + 4 * HOUR) }).where('id', '=', r2.id).execute();
      expect((safeJson(await c.get(`/api/v1/live/${r2.id}`)) as { access: unknown }).access).toEqual({ minTier: 0, text: 'owners of the MERIDIAN collection' });
      for (const id of [r.id, r2.id]) await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', id).execute();
    });

    it('reveals every stage at the room’s opening at the latest, and never names a stage in the room or the account’s state', async () => {
      const r = await release(h, f, { inMinutes: 10 });
      const t = h.clock.now().getTime();
      await h.ctx.db.updateTable('drops').set({ silhouette_at: new Date(t + 4 * MINUTE), name_at: new Date(t + 4 * MINUTE), photo_at: new Date(t + 4 * MINUTE) }).where('id', '=', r.id).execute();
      const d = await h.ctx.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
      expect(liveStages(d, new Date(t + 4 * MINUTE - 1))).toMatchObject({ silhouette: false, name: false, photo: false });
      expect(liveStages(d, new Date(t + 5 * MINUTE))).toMatchObject({ silhouette: true, name: true, photo: true });
      // Out of order, the later stages wait for the earlier ones; all are in by the room's opening.
      const odd = { ...d, announce_at: null, silhouette_at: new Date(t + 4 * MINUTE), name_at: new Date(t + MINUTE), photo_at: new Date(t + HOUR) };
      expect(liveStages(odd, new Date(t + 2 * MINUTE))).toMatchObject({ silhouette: false, name: false, photo: false });
      expect(liveStages(odd, new Date(t + 4 * MINUTE))).toMatchObject({ silhouette: true, name: true, photo: false, photoAt: new Date(t + 5 * MINUTE) });
      expect(liveStages({ ...d, published_at: null }, new Date(t))).toBeNull();

      const m = await member(h, f, 1);
      const state = await m.client.get(`/api/v1/live/${r.id}/state`);
      expect(state.statusCode).toBe(200);
      expect(state.body).not.toContain('MONOLITHE');
      expect(state.body).not.toContain('"title"');
    });

    it('takes an ended release out of the list and the banner, its page in its final state: what was announced, never an end figure', async () => {
      const r = await release(h, f, { inMinutes: 6, quantityLine: '25 PIECES' });
      await h.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE', description: 'Cast in Paris.' }).where('id', '=', r.id).execute();
      const c = h.client();
      expect((safeJson(await c.get('/api/v1/live/next')) as { release: { id: string } }).release.id).toBe(r.id);
      // Pieces added live: the quantity line stays the one announced (plan LIVE RELEASE+, decision 29).
      await f.live.addPieces(r.id, r.sizes[0]!.id, 3, f.admin);
      await f.live.end(r.id, f.admin);
      const opensAt = (await h.ctx.db.selectFrom('drops').select('opens_at').where('id', '=', r.id).executeTakeFirstOrThrow()).opens_at;
      const ended = await c.get(`/api/v1/live/${r.id}`);
      expect(safeJson(ended)).toEqual({
        id: r.id,
        kind: 'LIVE',
        phase: 'ENDED',
        title: 'MONOLITHE — LIVE',
        name: 'MONOLITHE',
        // NOCTURNE N1: the model's label among its variants; none here.
        variant: null,
        type: 'RING',
        collection: null,
        description: 'Cast in Paris.',
        silhouetteUrl: null,
        imageUrl: null,
        lookbook: null,
        opensAt: opensAt.toISOString(),
        quantityLine: '25 PIECES',
      });
      // No end figure: no size or stock, no count, no reason of the end, no interest, no price.
      for (const word of ['sizes', 'stock', 'interest', 'endedReason', 'SOLD_OUT', 'priceMinor', 'access']) expect(ended.body, word).not.toContain(word);
      expect((safeJson(await c.get('/api/v1/live')) as { releases: { id: string }[] }).releases.map((x) => x.id)).not.toContain(r.id);
      expect((safeJson(await c.get('/api/v1/live/next')) as { release: { id: string } | null }).release?.id).not.toBe(r.id);
      expect(errorOf(await c.get(`/api/v1/live/${r.id}/calendar.ics`)).code).toBe('DROP_NOT_FOUND');
    });
  });

  describe('the banner, the list and the page', () => {
    it('shows the release live now first, then the room open, then the next announced; the page with its sizes, add-ons and interest', async () => {
      await clearReleases(h);
      const c = h.client();
      // No server time in a public answer kept 15 s: the banner syncs with /clock.
      expect(safeJson(await c.get('/api/v1/live/next'))).toEqual({ release: null });
      const later = await release(h, f, { inMinutes: 120, minTier: 2 });
      const soon = await release(h, f, { inMinutes: 4, sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 3 }], addons: [{ label: 'ENGRAVING', line: 'Your initials', priceMinor: 15_000 }], perAccount: 2 });
      const banner = safeJson(await c.get('/api/v1/live/next')) as { release: Record<string, unknown> };
      expect(banner.release).toEqual({ id: soon.id, phase: 'ROOM', name: 'MONOLITHE', variant: null, nameAt: expect.any(String), roomOpensAt: expect.any(String), opensAt: expect.any(String), closesAt: expect.any(String) });
      const list = safeJson(await c.get('/api/v1/live')) as { releases: Record<string, unknown>[] };
      expect(list.releases.map((x) => x.id)).toEqual([soon.id, later.id]);
      expect(list.releases[1]).toMatchObject({ kind: 'LIVE', phase: 'ANNOUNCED', access: { minTier: 2, text: 'owners from PLATINE' }, perAccount: 1, currency: 'EUR' });
      const fan = await member(h, f, 1);
      expect((await fan.client.request('PUT', `/api/v1/live/${soon.id}/interest`, { body: { sizeId: soon.sizes[1]!.id } })).statusCode).toBe(200);
      expect((await fan.client.request('PUT', `/api/v1/live/${later.id}/interest`, { body: { sizeId: later.sizes[0]!.id } })).statusCode).toBe(403);
      // The count of I'LL BE THERE is public: on each card of the calendar, as on the page.
      expect((safeJson(await c.get('/api/v1/live')) as { releases: Record<string, unknown>[] }).releases.map((x) => [x.id, x.interest])).toEqual([
        [soon.id, 1],
        [later.id, 0],
      ]);
      const sheet = await c.get(`/api/v1/live/${soon.id}`);
      expect(sheet.headers['cache-control']).toBe('public, max-age=15');
      expect(safeJson(sheet)).toMatchObject({
        phase: 'ROOM',
        sizes: [{ id: soon.sizes[0]!.id, label: '50', stock: 1 }, { id: soon.sizes[1]!.id, label: '52', stock: 3 }],
        addons: [{ id: soon.addons[0]!.id, label: 'ENGRAVING', line: 'Your initials', priceMinor: 15_000 }],
        interest: 1,
        perAccount: 2,
        roomOpensMinutes: 5,
        turnSeconds: 30,
        payMinutes: 5,
        tierPriority: true,
      });
      h.clock.advance(4 * MINUTE);
      expect((safeJson(await c.get('/api/v1/live/next')) as { release: { id: string; phase: string } }).release).toMatchObject({ id: soon.id, phase: 'LIVE' });
      for (const r of [soon, later]) await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', r.id).execute();
    });

    it('serves the server’s time for the clock sync, never stored', async () => {
      const res = await h.client().get('/api/v1/live/clock');
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(safeJson(res)).toEqual({ now: h.clock.now().toISOString() });
    });

    it('gives ADD TO CALENDAR: the room’s opening, an alarm 10 minutes before, the page’s address, no personal data', async () => {
      const r = await release(h, f, { inMinutes: 45 });
      const res = await h.client().get(`/api/v1/live/${r.id}/calendar.ics`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="orbes-live-release.ics"');
      const body = res.body;
      expect(body.endsWith('\r\n')).toBe(true);
      expect(body.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
      const unfolded = body.replace(/\r\n /g, '');
      const room = new Date(h.clock.now().getTime() + 40 * MINUTE).toISOString().replace(/[-:]/g, '').replace('.000', '');
      expect(unfolded).toContain(`DTSTART:${room}`);
      expect(unfolded).toContain('SUMMARY:LIVE RELEASE · MONOLITHE · ORBES');
      expect(unfolded).toContain(`URL:${ORIGIN}/verify/releases/${r.id}`);
      expect(unfolded).toContain(`UID:live-${r.id}@verify.orbes.test`);
      expect(unfolded).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]+\r\nTRIGGER:-PT10M\r\nEND:VALARM/);
      expect(unfolded).not.toMatch(/@example\.com|ATTENDEE|ORGANIZER/);
      // RFC 5545 folding: 75 octets per line, never inside a character.
      const folded = foldIcsLine(`DESCRIPTION:${'é'.repeat(80)}`);
      expect(folded.split('\r\n ').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
      expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'é'.repeat(80)}`);
    });
  });

  describe('the account’s routes', () => {
    it('I’LL BE THERE with a size, counted on the page, changed, withdrawn; the account’s state and its sign-in rules', async () => {
      const r = await release(h, f, { inMinutes: 60, sizes: [{ label: '50', stock: 2 }, { label: '52', stock: 2 }], minTier: 1 });
      const fan = await member(h, f, 1);
      const put = await fan.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } });
      expect(put.statusCode).toBe(200);
      expect(safeJson(put)).toEqual({ interest: { dropId: r.id, size: { id: r.sizes[0]!.id, label: '50' }, since: h.clock.now().toISOString() } });
      expect((safeJson(await h.client().get(`/api/v1/live/${r.id}`)) as { interest: number }).interest).toBe(1);
      await fan.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[1]!.id } });
      const state = safeJson(await fan.client.get(`/api/v1/live/${r.id}/state`)) as Record<string, unknown>;
      expect(state).toMatchObject({ now: h.clock.now().toISOString(), entry: null, interest: { size: { label: '52' } }, access: { allowed: true, tier: 1, missing: null }, room: { id: r.id, phase: 'ANNOUNCED', inRoom: 0, line: 0, quantity: 4, left: 4, held: 0 } });
      expect(errorOf(await fan.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: 'nope' } })).code).toBe('LIVE_SIZE_UNKNOWN');
      expect(errorOf(await fan.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id, extra: 1 } })).code).toBe('VALIDATION_FAILED');
      const del = await fan.client.request('DELETE', `/api/v1/live/${r.id}/interest`);
      expect(safeJson(del)).toEqual({ interest: null });
      expect(errorOf(await fan.client.request('DELETE', `/api/v1/live/${r.id}/interest`)).code).toBe('LIVE_NOT_INTERESTED');

      const anon = h.client();
      for (const res of [
        await anon.get(`/api/v1/live/${r.id}/state`),
        await anon.get(`/api/v1/live/${r.id}/stream`),
        await anon.get('/api/v1/live/mine'),
        await anon.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id }),
        await anon.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } }),
      ]) {
        expect(res.statusCode).toBe(401);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      // A member the rule leaves out: the rule in words, never the room.
      const outsider = await member(h, f, 0);
      for (const res of [await outsider.client.get(`/api/v1/live/${r.id}/state`), await outsider.client.get(`/api/v1/live/${r.id}/stream`)]) {
        expect(res.statusCode).toBe(403);
        expect(errorOf(res)).toEqual({ code: 'LIVE_NOT_ELIGIBLE', message: 'This release is for owners.' });
      }
      expect(errorOf(await outsider.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } })).code).toBe('LIVE_NOT_ELIGIBLE');
    });

    it('preselects the size YOUR SIZES matches among the sizes with stock, only without an entry or an interest, in the state and the stream\'s first frame, writing nothing (AC-01)', async () => {
      await h.ctx.db.updateTable('models').set({ size_kind: 'RING' }).where('id', '=', f.modelId).execute();
      try {
        const r = await release(h, f, { inMinutes: 4, sizes: [{ label: '50', stock: 2 }, { label: 'SIZE 52', stock: 1 }, { label: '54', stock: 0 }], minTier: 1 });
        const m = await member(h, f, 1);
        const state = async () => safeJson(await m.client.get(`/api/v1/live/${r.id}/state`)) as { savedSize: unknown; entry: unknown; interest: unknown };
        expect((await state()).savedSize).toBeNull();
        expect((await m.client.request('PUT', '/api/v1/account/sizes', { body: { sizes: { RING: 52 } } })).statusCode).toBe(200);
        const counts = async () => ({
          audit: Number((await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n),
          entries: (await h.ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).execute()).length,
          interest: (await h.ctx.db.selectFrom('live_interest').select('size_id').where('drop_id', '=', r.id).execute()).length,
        });
        const before = await counts();
        expect(await state()).toMatchObject({ entry: null, interest: null, savedSize: { id: r.sizes[1]!.id, label: 'SIZE 52' } });
        const s = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
        expect((await s.next((e) => e.event === 'you')).data).toEqual({ now: h.clock.now().toISOString(), entry: null, savedSize: { id: r.sizes[1]!.id, label: 'SIZE 52' } });
        s.close();
        // Nothing written by reading it.
        expect(await counts()).toEqual(before);
        // A saved size whose release size has no stock preselects nothing.
        await m.client.request('PUT', '/api/v1/account/sizes', { body: { sizes: { RING: 54 } } });
        expect((await state()).savedSize).toBeNull();
        await m.client.request('PUT', '/api/v1/account/sizes', { body: { sizes: { RING: 52 } } });
        // I'LL BE THERE given: its size is the account's, nothing is preselected; withdrawn, the saved size again.
        await m.client.request('PUT', `/api/v1/live/${r.id}/interest`, { body: { sizeId: r.sizes[0]!.id } });
        expect(await state()).toMatchObject({ interest: { size: { label: '50' } }, savedSize: null });
        await m.client.request('DELETE', `/api/v1/live/${r.id}/interest`);
        expect((await state()).savedSize).toMatchObject({ label: 'SIZE 52' });
        // An entry: its size is the account's, nothing is preselected, in the state or a stream's first frame.
        expect((await m.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id })).statusCode).toBe(200);
        expect((await state()).savedSize).toBeNull();
        const again = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
        expect((await again.next((e) => e.event === 'you')).data).toMatchObject({ entry: { size: { label: '50' } }, savedSize: null });
        again.close();
      } finally {
        await h.ctx.db.updateTable('models').set({ size_kind: null }).where('id', '=', f.modelId).execute();
      }
    });

    it('refuses every mutation without the session’s CSRF token or from another origin, the board’s too', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      const m = await member(h, f, 1);
      const calls: [string, string, unknown][] = [
        ['POST', `/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id }],
        ['POST', `/api/v1/live/${r.id}/size`, { sizeId: r.sizes[0]!.id }],
        ['POST', `/api/v1/live/${r.id}/leave`, {}],
        ['POST', `/api/v1/live/${r.id}/press`, { token: 'abc' }],
        ['POST', `/api/v1/live/${r.id}/secure`, { token: 'abc' }],
        ['PUT', `/api/v1/live/${r.id}/addons`, { addonIds: [] }],
        ['POST', `/api/v1/live/${r.id}/confirm`, {}],
        ['POST', `/api/v1/live/${r.id}/release`, {}],
        ['PUT', `/api/v1/live/${r.id}/interest`, { sizeId: r.sizes[0]!.id }],
        ['DELETE', `/api/v1/live/${r.id}/interest`, undefined],
      ];
      for (const [method, url, body] of calls) {
        const noToken = await m.client.request(method, url, { body, noCsrf: true });
        expect([url, noToken.statusCode, errorOf(noToken).code]).toEqual([url, 403, 'CSRF_FAILED']);
        const foreign = await m.client.request(method, url, { body, origin: 'https://elsewhere.example' });
        expect([url, foreign.statusCode, errorOf(foreign).code]).toEqual([url, 403, 'CSRF_FAILED']);
      }
      expect(await h.ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).execute()).toEqual([]);
      const { token } = await f.live.issueBoardLink(r.id, f.admin);
      expect(errorOf(await h.client({ origin: 'https://elsewhere.example' }).post(`/api/v1/live/${r.id}/board`, { token })).code).toBe('CSRF_FAILED');
    });

    it('ENTER, CHANGE SIZE before T0, the line at T0, PRESS and SECURE with the gesture, the add-ons, PAY; MY PIECES', async () => {
      const r = await release(h, f, { inMinutes: 4, sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 1 }], addons: [{ label: 'GIFT BOX', priceMinor: 5_000 }], perAccount: 2 });
      const [a, b, c] = [await member(h, f, 5, '198.51.100.7'), await member(h, f, 1), await member(h, f, 1)];
      const enter = await a.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[1]!.id });
      expect(enter.statusCode).toBe(200);
      expect((safeJson(enter) as { entry: Record<string, unknown> }).entry).toMatchObject({ status: 'WAITING', size: { label: '52' }, quantity: 1, position: null, ahead: null, turn: null });
      const row = await h.ctx.db.selectFrom('live_entries').select(['network_hash']).where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
      expect(row.network_hash).toEqual(liveNetworkHash(h.ctx.config.ipHashPepper, '198.51.100.7'));
      expect(errorOf(await a.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[1]!.id })).code).toBe('LIVE_ALREADY_ENTERED');
      expect(errorOf(await a.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[1]!.id, quantity: 6 })).code).toBe('VALIDATION_FAILED');
      const changed = safeJson(await a.client.post(`/api/v1/live/${r.id}/size`, { sizeId: r.sizes[0]!.id })) as { entry: Record<string, unknown> };
      expect(changed.entry).toMatchObject({ status: 'WAITING', size: { label: '50' } });
      await b.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      await c.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      const left = safeJson(await c.client.post(`/api/v1/live/${r.id}/leave`, {})) as { entry: Record<string, unknown> };
      expect(left.entry).toMatchObject({ status: 'LEFT' });
      await c.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });

      // T0: the line by tier (PALLADIUM first), a turn for the first of size 50, the others behind with those ahead.
      h.clock.advance(4 * MINUTE);
      await advance(h, r.id);
      expect(errorOf(await b.client.post(`/api/v1/live/${r.id}/size`, { sizeId: r.sizes[1]!.id })).code).toBe('LIVE_SIZE_LOCKED');
      const sa = safeJson(await a.client.get(`/api/v1/live/${r.id}/state`)) as { entry: { status: string; position: number; turn: { token: string; expiresAt: string } }; room: Record<string, unknown> };
      expect(sa.entry).toMatchObject({ status: 'TURN', position: 1 });
      expect(sa.entry.turn.expiresAt).toBe(new Date(h.clock.now().getTime() + 30 * SECOND).toISOString());
      expect(sa.room).toMatchObject({ phase: 'LIVE', inRoom: 3, line: 2, left: 1, held: 1, sizes: [{ label: '50', stock: 1, left: 0, held: 1 }, { label: '52', stock: 1, left: 1, held: 0 }] });
      const others = [safeJson(await b.client.get(`/api/v1/live/${r.id}/state`)), safeJson(await c.client.get(`/api/v1/live/${r.id}/state`))] as { entry: { status: string; ahead: number; turn: unknown } }[];
      expect(others.map((o) => o.entry.status)).toEqual(['QUEUED', 'QUEUED']);
      expect(others.map((o) => o.entry.ahead).sort()).toEqual([0, 1]);
      expect(others.map((o) => o.entry.turn)).toEqual([null, null]);

      // The seal: the turn's secret, held at least 1.4 s on the server's clock.
      const token = sa.entry.turn.token;
      expect(errorOf(await b.client.post(`/api/v1/live/${r.id}/press`, { token })).code).toBe('LIVE_NOT_YOUR_TURN');
      expect(errorOf(await a.client.post(`/api/v1/live/${r.id}/secure`, { token })).code).toBe('LIVE_HOLD_TOO_SHORT');
      expect(errorOf(await a.client.post(`/api/v1/live/${r.id}/press`, { token: 'x'.repeat(43) })).code).toBe('LIVE_TURN_CHANGED');
      expect((await a.client.post(`/api/v1/live/${r.id}/press`, { token })).statusCode).toBe(200);
      h.clock.advance(LIVE_GESTURE_MIN_MS - 1);
      expect(errorOf(await a.client.post(`/api/v1/live/${r.id}/secure`, { token })).code).toBe('LIVE_HOLD_TOO_SHORT');
      h.clock.advance(1);
      const secured = safeJson(await a.client.post(`/api/v1/live/${r.id}/secure`, { token })) as { entry: Record<string, unknown> };
      expect(secured.entry).toMatchObject({ status: 'SECURED', turn: { token: null }, hold: { expiresAt: new Date(h.clock.now().getTime() + 5 * MINUTE).toISOString() } });

      // The add-ons, then PAY.
      expect(errorOf(await a.client.request('PUT', `/api/v1/live/${r.id}/addons`, { body: { addonIds: ['nope'] } })).code).toBe('LIVE_ADDON_UNKNOWN');
      const withBox = safeJson(await a.client.request('PUT', `/api/v1/live/${r.id}/addons`, { body: { addonIds: [r.addons[0]!.id] } })) as { entry: Record<string, unknown> };
      expect(withBox.entry).toMatchObject({ addons: [{ id: r.addons[0]!.id, label: 'GIFT BOX', priceMinor: 5_000 }], totalMinor: 510_000, currency: 'EUR' });
      const paid = safeJson(await a.client.post(`/api/v1/live/${r.id}/confirm`, {})) as { entry: Record<string, unknown> };
      expect(paid.entry).toMatchObject({ status: 'CONFIRMED', confirmedAt: h.clock.now().toISOString() });
      expect(errorOf(await a.client.post(`/api/v1/live/${r.id}/confirm`, {})).code).toBe('LIVE_NOT_SECURED');

      // MY PIECES: the entry with its release.
      const mine = safeJson(await a.client.get('/api/v1/live/mine')) as { entries: { release: Record<string, unknown>; entry: Record<string, unknown> }[] };
      expect(mine.entries.find((e) => e.release.id === r.id)).toMatchObject({ release: { name: 'MONOLITHE', phase: 'LIVE' }, entry: { status: 'CONFIRMED', addons: [{ label: 'GIFT BOX' }] } });
      expect((safeJson(await b.client.get('/api/v1/live/mine')) as { entries: unknown[] }).entries).toHaveLength(1);
      expect(JSON.stringify(await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', r.id).execute())).not.toMatch(/@example\.com/);
    });

    it('RELEASE MY PLACE gives the piece to the next at once; an entrant reads its state whatever its tier now; a REMOVED one too', async () => {
      const r = await release(h, f, { inMinutes: 4, minTier: 1 });
      await h.ctx.db.updateTable('drop_sizes').set({ stock: 1 }).where('drop_id', '=', r.id).execute();
      const a = await member(h, f, 5);
      const b = await member(h, f, 1);
      for (const m of [a, b]) await m.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      h.clock.advance(4 * MINUTE);
      await advance(h, r.id);
      const token = (safeJson(await a.client.get(`/api/v1/live/${r.id}/state`)) as { entry: { turn: { token: string } } }).entry.turn.token;
      await a.client.post(`/api/v1/live/${r.id}/press`, { token });
      h.clock.advance(2 * SECOND);
      await a.client.post(`/api/v1/live/${r.id}/secure`, { token });
      const released = safeJson(await a.client.post(`/api/v1/live/${r.id}/release`, {})) as { entry: Record<string, unknown> };
      expect(released.entry).toMatchObject({ status: 'RELEASED' });
      expect((safeJson(await b.client.get(`/api/v1/live/${r.id}/state`)) as { entry: Record<string, unknown> }).entry).toMatchObject({ status: 'TURN', turn: { token: expect.any(String) } });
      // b gives its piece away: no longer allowed in, it still reads its own entry.
      await h.ctx.db.updateTable('ownership').set({ ended_at: h.clock.now() }).where('account_id', '=', b.id).execute();
      expect((await b.client.get(`/api/v1/live/${r.id}/state`)).statusCode).toBe(200);
      const entry = await h.ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', b.id).executeTakeFirstOrThrow();
      await f.live.remove(r.id, entry.id, f.admin);
      expect((safeJson(await b.client.get(`/api/v1/live/${r.id}/state`)) as { entry: Record<string, unknown> }).entry).toMatchObject({ status: 'REMOVED' });
      const stream = await b.client.get(`/api/v1/live/${r.id}/stream`);
      expect(stream.statusCode).toBe(403);
      expect(errorOf(stream).code).toBe('LIVE_REMOVED');
    });
  });

  describe('the rate group live', () => {
    it('limits an account, and its network, each to its own budget', async () => {
      const g = await createHarness({ config: { rateLimits: { apiPerMinute: 3 } }, app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
      try {
        g.clock.set(START);
        const gf = await liveFixtureOn(g.ctx, g.clock);
        const r = await createLiveRelease(gf, { opensAt: new Date(g.clock.now().getTime() + HOUR) });
        // The account's own budget: 3 a minute, whatever address it uses.
        const m = await member(g, gf, 1, '192.0.2.1');
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await m.client.get(`/api/v1/live/${r.id}/state`)).statusCode);
        expect(statuses).toEqual([200, 200, 200, 429]);
        const limited = await m.client.get('/api/v1/live/mine');
        expect(errorOf(limited).code).toBe('RATE_LIMITED');
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        // Another account on the same network keeps its own.
        const other = await member(g, gf, 1, '192.0.2.1');
        expect((await other.client.get(`/api/v1/live/${r.id}/state`)).statusCode).toBe(200);
        // The network's: 3 × LIVE_NETWORK_RATE_FACTOR a minute for everyone behind one address, then 429.
        const visitor = g.client({ ip: '192.0.2.99' });
        const budget = 3 * LIVE_NETWORK_RATE_FACTOR;
        for (let i = 0; i < budget; i++) expect((await visitor.get(`/api/v1/live/${r.id}`)).statusCode).toBe(200);
        expect(errorOf(await visitor.get('/api/v1/live/clock')).code).toBe('RATE_LIMITED');
        expect((await g.client({ ip: '192.0.2.100' }).get('/api/v1/live/clock')).statusCode).toBe(200);
      } finally {
        await g.close();
      }
    });
  });

  describe('the streams', () => {
    it('spreads the reconnection of each stream between 2 and 5 seconds', () => {
      expect(liveRetryMs(() => 0)).toBe(2000);
      expect(liveRetryMs(() => 0.5)).toBe(3500);
      expect(liveRetryMs(() => 0.9999999)).toBe(4999);
      expect(liveRetryMs(() => 1)).toBe(4999);
    });

    it('opens only for a signed-in account allowed in: the room and its own entry, then only what changed, the server’s time in each', async () => {
      const r = await release(h, f, { inMinutes: 4, minTier: 1 });
      const m = await member(h, f, 1);
      expect((await openSse(base, `/api/v1/live/${r.id}/stream`)).status).toBe(401);
      const outsider = await member(h, f, 0);
      const refused = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: outsider.client.cookies });
      expect([refused.status, (refused.body as { error: { code: string } }).error.code]).toEqual([403, 'LIVE_NOT_ELIGIBLE']);

      const s = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(s.headers['cache-control']).toBe('no-store');
      expect(s.headers['x-accel-buffering']).toBe('no');
      expect(s.headers['content-security-policy']).toContain("default-src 'self'");
      const room = await s.next((e) => e.event === 'room');
      expect(room.data).toMatchObject({ now: h.clock.now().toISOString(), id: r.id, phase: 'ROOM', paused: false, over: false, inRoom: 0, line: 0, left: 2, held: 0, message: null });
      // The first frame also says which size YOUR SIZES preselects (AC-01): none saved here.
      expect((await s.next((e) => e.event === 'you')).data).toEqual({ now: h.clock.now().toISOString(), entry: null, savedSize: null });
      expect(s.retry).toBeGreaterThanOrEqual(2000);
      expect(s.retry).toBeLessThan(5000);

      // Nothing changed: nothing sent. Then an entry: the room and its own entry.
      const count = s.events.length;
      await h.app.liveHub.pulse();
      await m.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      h.clock.advance(SECOND);
      await h.app.liveHub.pulse();
      const you = await s.next((e) => e.event === 'you', count);
      expect(you.data).toMatchObject({ now: h.clock.now().toISOString(), entry: { status: 'WAITING', size: { label: '52' } } });
      expect((await s.next((e) => e.event === 'room', count)).data).toMatchObject({ inRoom: 1, now: h.clock.now().toISOString() });
      expect(s.events.slice(count).map((e) => e.event).sort()).toEqual(['room', 'you']);

      // A host message reaches the room; the turn's secret reaches its own account only.
      await h.ctx.services.live.message(r.id, 'The atelier is ready.', f.admin);
      const watcher = await member(h, f, 1);
      const w = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: watcher.client.cookies });
      await w.next((e) => e.event === 'you');
      h.clock.advance(4 * MINUTE);
      await advance(h, r.id);
      const before = s.events.length;
      await h.app.liveHub.pulse();
      expect((await s.next((e) => e.event === 'room', before)).data).toMatchObject({ phase: 'LIVE', message: { text: 'The atelier is ready.' }, held: 1, left: 1 });
      const turn = (await s.next((e) => e.event === 'you' && (e.data.entry as { status?: string } | null)?.status === 'TURN', before)).data.entry as { turn: { token: string } };
      expect(turn.turn.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(w.events)).not.toContain(turn.turn.token);
      expect(JSON.stringify(s.events)).not.toContain(m.email);
      // The console's pause reaches every screen.
      const paused = s.events.length;
      await f.live.pause(r.id, f.admin);
      await h.app.liveHub.pulse();
      expect((await s.next((e) => e.event === 'room', paused)).data).toMatchObject({ paused: true });
      expect((await w.next((e) => e.event === 'room' && e.data.paused === true)).data).toMatchObject({ phase: 'LIVE' });
      await f.live.resume(r.id, f.admin);
      s.close();
      w.close();
      await until(() => h.app.liveHub.open.streams === 0);
    });

    it('keeps a quiet stream open with a heartbeat every 20 s', async () => {
      const r = await release(h, f, { inMinutes: 30 });
      const m = await member(h, f, 1);
      const s = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
      await s.next((e) => e.event === 'you');
      h.clock.advance(LIVE_HEARTBEAT_MS - SECOND);
      await h.app.liveHub.pulse();
      expect(s.comments).toEqual([]);
      h.clock.advance(SECOND);
      await h.app.liveHub.pulse();
      await until(() => s.comments.length === 1);
      s.close();
      await until(() => h.app.liveHub.open.streams === 0);
    });

    it('allows two streams per account; a third is refused until one closes', async () => {
      const r = await release(h, f, { inMinutes: 30 });
      const m = await member(h, f, 1);
      const open = [];
      for (let i = 0; i < LIVE_STREAMS_PER_ACCOUNT; i++) open.push(await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies }));
      expect(open.map((s) => s.status)).toEqual([200, 200]);
      const third = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
      expect([third.status, (third.body as { error: { code: string } }).error.code]).toEqual([429, 'LIVE_STREAMS_LIMIT']);
      expect(h.app.liveHub.open.accounts.get(m.id)).toBe(2);
      // Another account is not counted against it.
      const other = await member(h, f, 1);
      const theirs = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: other.client.cookies });
      expect(theirs.status).toBe(200);
      // A disconnection frees its place at once.
      open[0]!.close();
      await until(() => h.app.liveHub.open.accounts.get(m.id) === 1);
      const again = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
      expect(again.status).toBe(200);
      for (const s of [open[1]!, theirs, again]) s.close();
      await until(() => h.app.liveHub.open.streams === 0 && h.app.liveHub.open.accounts.size === 0);
    });

    it('builds a release’s room once per pulse, reads all its viewers’ entries at once and writes its event once, each stream one chunk, whatever their number', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      const viewers = [];
      for (let i = 0; i < 6; i++) viewers.push(await member(h, f, 1));
      const streams = [];
      for (const v of viewers) streams.push(await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: v.client.cookies }));
      for (const s of streams) await s.next((e) => e.event === 'you');
      const frame = vi.spyOn(h.ctx.services.liveRoom, 'frame');
      const entries = vi.spyOn(h.ctx.services.liveRoom, 'viewerEntries');
      expect((await viewers[0]!.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id })).statusCode).toBe(200);
      const stringify = vi.spyOn(JSON, 'stringify');
      const write = vi.spyOn(ServerResponse.prototype, 'write');
      try {
        await h.app.liveHub.pulse();
        expect(frame).toHaveBeenCalledTimes(1);
        expect(entries).toHaveBeenCalledTimes(1);
        expect(entries.mock.calls[0]![1]).toHaveLength(6);
        // The room serialised once for the six; each viewer written once: its own entry first when it changed, then the
        // room, the same bytes for all.
        expect(stringify.mock.calls.filter(([v]) => typeof v === 'object' && v !== null && 'inRoom' in v)).toHaveLength(1);
        const chunks = write.mock.calls.map(([c]) => String(c)).filter((c) => c.startsWith('event: '));
        expect(chunks).toHaveLength(6);
        expect(chunks.every((c) => c.split('event: room\n').length === 2)).toBe(true);
        expect(new Set(chunks.map((c) => c.slice(c.indexOf('event: room\n')))).size).toBe(1);
        expect(chunks.filter((c) => c.startsWith('event: you\n'))).toHaveLength(1);
      } finally {
        stringify.mockRestore();
        write.mockRestore();
        frame.mockRestore();
        entries.mockRestore();
      }
      for (const s of streams) await s.next((e) => e.event === 'room' && e.data.inRoom === 1);
      expect((await streams[0]!.next((e) => e.event === 'you' && e.data.entry !== null)).data).toMatchObject({ now: h.clock.now().toISOString(), entry: { status: 'WAITING' } });
      for (const s of streams) s.close();
      await until(() => h.app.liveHub.open.streams === 0);
    });

    it('sends the last frame once the release is over and ends the streams; asked again, 204', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      await h.ctx.db.updateTable('drop_sizes').set({ stock: 1 }).where('drop_id', '=', r.id).execute();
      const a = await member(h, f, 1);
      await a.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      h.clock.advance(4 * MINUTE);
      await advance(h, r.id);
      const s = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: a.client.cookies });
      const token = ((await s.next((e) => e.event === 'you')).data.entry as { turn: { token: string } }).turn.token;
      await a.client.post(`/api/v1/live/${r.id}/press`, { token });
      h.clock.advance(2 * SECOND);
      await a.client.post(`/api/v1/live/${r.id}/secure`, { token });
      await a.client.post(`/api/v1/live/${r.id}/confirm`, {});
      // The server's status times the responses (test entrants §7): a stream served, open for minutes, is not one of them.
      const timed = vi.spyOn(h.app.systemStatus.http, 'record');
      await h.app.liveHub.pulse();
      expect((await s.next((e) => e.event === 'room' && e.data.over === true)).data).toMatchObject({ phase: 'ENDED', endedReason: 'SOLD_OUT', left: 0 });
      expect((await s.next((e) => e.event === 'you' && (e.data.entry as { status: string }).status === 'CONFIRMED')).data).toBeTruthy();
      await until(() => s.ended);
      const after = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: a.client.cookies });
      expect(after.status).toBe(204);
      expect(h.app.liveHub.open.accounts.size).toBe(0);
      await until(() => timed.mock.calls.length > 0);
      expect(timed.mock.calls.map(([status]) => status)).toEqual([204]);
      timed.mockRestore();
    });

    it('says the end once the engine has recorded it, each viewer’s final entry before the room over; the page whole while a hold runs after an END', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      await h.ctx.db.updateTable('drop_sizes').set({ stock: 1 }).where('drop_id', '=', r.id).execute();
      const [a, b] = [await member(h, f, 5), await member(h, f, 1)];
      for (const m of [a, b]) await m.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      h.clock.advance(4 * MINUTE);
      await advance(h, r.id);
      const [sa, sb] = [await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: a.client.cookies }), await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: b.client.cookies })];
      const token = ((await sa.next((e) => e.event === 'you')).data.entry as { turn: { token: string } }).turn.token;
      expect((await sb.next((e) => e.event === 'you')).data.entry).toMatchObject({ status: 'QUEUED' });
      await a.client.post(`/api/v1/live/${r.id}/press`, { token });
      h.clock.advance(2 * SECOND);
      await a.client.post(`/api/v1/live/${r.id}/secure`, { token });

      // Ended by ORBES with a hold running: the line ENDED at once, the hold confirmable until its deadline; the room is
      // not over yet, and the page stays whole (its phase ENDED) so PAY can be pressed.
      await f.live.end(r.id, f.admin);
      const sheet = safeJson(await h.client().get(`/api/v1/live/${r.id}`)) as { phase: string; sizes: unknown[] };
      expect(sheet.phase).toBe('ENDED');
      expect(sheet.sizes).toHaveLength(1);
      const from = sb.events.length;
      await h.app.liveHub.pulse();
      const ended = await sb.next((e) => e.event === 'you' && (e.data.entry as { status: string }).status === 'ENDED', from);
      expect((await sb.next((e) => e.event === 'room', from)).data).toMatchObject({ phase: 'ENDED', endedReason: 'ENDED', over: false });
      expect(sb.events.indexOf(ended)).toBeLessThan(sb.events.findIndex((e, i) => i >= from && e.event === 'room'));

      // PAY: no hold left, the release over. Each stream's last chunk: its own entry, then the room over.
      await a.client.post(`/api/v1/live/${r.id}/confirm`, {});
      const fromA = sa.events.length;
      await h.app.liveHub.pulse();
      const confirmed = await sa.next((e) => e.event === 'you' && (e.data.entry as { status: string }).status === 'CONFIRMED', fromA);
      const over = await sa.next((e) => e.event === 'room' && e.data.over === true, fromA);
      expect(sa.events.indexOf(confirmed)).toBeLessThan(sa.events.indexOf(over));
      await until(() => sa.ended && sb.ended);
      const final = safeJson(await h.client().get(`/api/v1/live/${r.id}`)) as Record<string, unknown>;
      expect(final).toMatchObject({ id: r.id, kind: 'LIVE', phase: 'ENDED' });
      expect(final).not.toHaveProperty('sizes');

      // The clock past the close before the engine's pass: the phase says ENDED, the room is not over, its entry open.
      const c = await release(h, f, { inMinutes: 4 });
      const m = await member(h, f, 1);
      await m.client.post(`/api/v1/live/${c.id}/enter`, { sizeId: c.sizes[0]!.id });
      h.clock.advance(4 * MINUTE + HOUR);
      const before = safeJson(await m.client.get(`/api/v1/live/${c.id}/state`)) as { room: Record<string, unknown>; entry: { status: string } };
      expect([before.room.phase, before.room.over, before.entry.status]).toEqual(['ENDED', false, 'WAITING']);
      expect((safeJson(await h.client().get(`/api/v1/live/${c.id}`)) as { sizes?: unknown }).sizes).toBeDefined();
      await advance(h, c.id);
      const after = safeJson(await m.client.get(`/api/v1/live/${c.id}/state`)) as { room: Record<string, unknown>; entry: { status: string } };
      expect([after.room.over, after.room.endedReason, after.entry.status]).toEqual([true, 'CLOSED', 'ENDED']);
    });

    it('ends a REMOVED entry’s stream after its last event', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      const a = await member(h, f, 1);
      await a.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      const s = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: a.client.cookies });
      await s.next((e) => e.event === 'you');
      const entry = await h.ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
      await f.live.remove(r.id, entry.id, f.admin);
      await h.app.liveHub.pulse();
      expect((await s.next((e) => e.event === 'you' && (e.data.entry as { status: string } | null)?.status === 'REMOVED')).data).toBeTruthy();
      await until(() => s.ended);
      expect(h.app.liveHub.open.streams).toBe(0);
    });

    it('ends a stream once its session has ended: signed out, its account locked; another account’s stays open', async () => {
      const r = await release(h, f, { inMinutes: 30 });
      const [a, b, c] = [await member(h, f, 1), await member(h, f, 1), await member(h, f, 1)];
      const [sa, sb, sc] = [
        await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: a.client.cookies }),
        await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: b.client.cookies }),
        await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: c.client.cookies }),
      ];
      for (const s of [sa, sb, sc]) await s.next((e) => e.event === 'you');
      await h.app.liveHub.pulse();
      expect([sa.ended, sb.ended, sc.ended]).toEqual([false, false, false]);

      const signedOut = new Map(a.client.cookies);
      expect((await a.client.post('/api/v1/account/logout', {})).statusCode).toBeLessThan(300);
      await h.ctx.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', b.id).execute();
      await h.app.liveHub.pulse();
      await until(() => sa.ended && sb.ended);
      expect(sc.ended).toBe(false);
      expect(h.app.liveHub.open.accounts.has(a.id) || h.app.liveHub.open.accounts.has(b.id)).toBe(false);
      // Its EventSource reconnecting goes through the session's guard again.
      expect((await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: signedOut })).status).toBe(401);
      expect((await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: b.client.cookies })).status).toBe(401);
      sc.close();
      await until(() => h.app.liveHub.open.streams === 0);
    });

    it('ends the streams of a cancelled release', async () => {
      const r = await release(h, f, { inMinutes: 30 });
      const a = await member(h, f, 1);
      const s = await openSse(base, `/api/v1/live/${r.id}/stream`, { cookies: a.client.cookies });
      await s.next((e) => e.event === 'you');
      await h.ctx.db.updateTable('drops').set({ cancelled_at: h.clock.now() }).where('id', '=', r.id).execute();
      await h.app.liveHub.pulse();
      await until(() => s.ended);
      expect(h.app.liveHub.open.streams).toBe(0);
    });
  });

  describe('the boutique board', () => {
    it('answers only its secret link: valid, then missing, malformed, wrong, another release’s, replaced, revoked', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      const other = await release(h, f, { inMinutes: 4 });
      const a = await member(h, f, 1);
      await a.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id });
      const { token } = await f.live.issueBoardLink(r.id, f.admin);
      const { token: otherToken } = await f.live.issueBoardLink(other.id, f.admin);
      const c = h.client();

      const ok = await c.post(`/api/v1/live/${r.id}/board`, { token });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(ok.headers['cache-control']).toBe('no-store');
      const board = safeJson(ok) as Record<string, unknown>;
      expect(Object.keys(board).sort()).toEqual(['closesAt', 'id', 'left', 'now', 'opensAt', 'over', 'paused', 'phase', 'quantity', 'quantityLine', 'release', 'roomOpensAt'].sort());
      expect(board).toMatchObject({ id: r.id, phase: 'ROOM', left: 2, quantity: 2, release: { name: 'MONOLITHE', revealed: { name: true } } });
      for (const secret of [a.email, a.id]) expect(ok.body).not.toContain(secret);
      const s = await openSse(base, `/api/v1/live/${r.id}/board/stream`, { method: 'POST', body: { token }, origin: ORIGIN });
      expect(s.status).toBe(200);
      expect(s.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect((await s.next((e) => e.event === 'board')).data).toMatchObject({ now: h.clock.now().toISOString(), left: 2 });
      expect(s.events.map((e) => e.event)).toEqual(['board']);

      const refused = async (id: string, body: unknown) => {
        const res = await c.post(`/api/v1/live/${id}/board`, body);
        expect([res.statusCode, errorOf(res).code]).toEqual([404, 'DROP_NOT_FOUND']);
        expect((await openSse(base, `/api/v1/live/${id}/board/stream`, { method: 'POST', body, origin: ORIGIN })).status).toBe(404);
      };
      await refused(r.id, undefined);
      await refused(r.id, {});
      await refused(r.id, { token: 'short' });
      await refused(r.id, { token: 'A'.repeat(43) });
      await refused(r.id, { token: otherToken });
      await refused(other.id, { token });
      const { token: replaced } = await f.live.issueBoardLink(r.id, f.admin);
      await refused(r.id, { token });
      // A stream open on the old link ends at the next pulse, without another event; the new link's stays open.
      const sent = s.events.length;
      await h.app.liveHub.pulse();
      await until(() => s.ended);
      expect(s.events.length).toBe(sent);
      expect((await c.post(`/api/v1/live/${r.id}/board`, { token: replaced })).statusCode).toBe(200);
      const s2 = await openSse(base, `/api/v1/live/${r.id}/board/stream`, { method: 'POST', body: { token: replaced }, origin: ORIGIN });
      await s2.next((e) => e.event === 'board');
      await h.app.liveHub.pulse();
      expect(s2.ended).toBe(false);
      await f.live.revokeBoardLink(r.id, f.admin);
      await refused(r.id, { token: replaced });
      await h.app.liveHub.pulse();
      await until(() => s2.ended);
      await expect(f.live.revokeBoardLink(r.id, f.admin)).rejects.toMatchObject({ code: 'LIVE_NO_BOARD_LINK' });
      expect(
        (await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', r.id).where('action', 'like', 'drop.live.board.%').orderBy('id').execute()).map((x) => [x.action, x.details]),
      ).toEqual([
        ['drop.live.board.issue', {}],
        ['drop.live.board.issue', { replaced: true }],
        ['drop.live.board.revoke', {}],
      ]);
      expect(JSON.stringify(await h.ctx.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).execute())).not.toContain(replaced);
      expect(h.app.liveHub.open.streams).toBe(0);
    });

    it('closes once the release is over', async () => {
      const r = await release(h, f, { inMinutes: 4 });
      const { token } = await f.live.issueBoardLink(r.id, f.admin);
      const s = await openSse(base, `/api/v1/live/${r.id}/board/stream`, { method: 'POST', body: { token }, origin: ORIGIN });
      await s.next((e) => e.event === 'board');
      h.clock.advance(4 * MINUTE);
      await f.live.end(r.id, f.admin);
      await h.app.liveHub.pulse();
      expect((await s.next((e) => e.event === 'board' && e.data.over === true)).data).toMatchObject({ phase: 'ENDED' });
      await until(() => s.ended);
      expect(errorOf(await h.client().post(`/api/v1/live/${r.id}/board`, { token })).code).toBe('DROP_NOT_FOUND');
    });
  });

  describe('the after-room (plan LIVE RELEASE+, choice 2 and decision 28)', () => {
    it('is its guests\' alone, from its T0: read through its release, on no public surface, unknown to anyone else', async () => {
      await clearReleases(h);
      const afterModel = await createModel(h.ctx.db, 'AFTERGLOW');
      const r = await release(h, f, {
        inMinutes: 10,
        sizes: [{ label: '52', stock: 1 }],
        afterRoom: { modelId: afterModel, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }], delayMinutes: 2, lengthMinutes: 5 },
      });
      const child = r.afterRoom!.id;
      const buyer = await member(h, f, 1);
      const guest = await member(h, f, 0);
      const other = await member(h, f, 5);
      const t0 = (await h.ctx.db.selectFrom('drops').select('opens_at').where('id', '=', r.id).executeTakeFirstOrThrow()).opens_at.getTime();
      h.clock.set(new Date(t0 - MINUTE));
      for (const m of [buyer, guest]) expect((await m.client.post(`/api/v1/live/${r.id}/enter`, { sizeId: r.sizes[0]!.id })).statusCode).toBe(200);
      h.clock.set(new Date(t0));
      await advance(h, r.id);
      // TITANE before an account without a tier: the buyer's turn; then the seal held and PAY: SOLD OUT.
      const token = (safeJson(await buyer.client.get(`/api/v1/live/${r.id}/state`)) as { entry: { turn: { token: string } } }).entry.turn.token;
      expect((await buyer.client.post(`/api/v1/live/${r.id}/press`, { token })).statusCode).toBe(200);
      h.clock.advance(LIVE_GESTURE_MIN_MS + 100);
      expect((await buyer.client.post(`/api/v1/live/${r.id}/secure`, { token })).statusCode).toBe(200);
      expect((await buyer.client.post(`/api/v1/live/${r.id}/confirm`, {})).statusCode).toBe(200);
      const soldOut = h.clock.now().getTime();
      const opensAt = new Date(soldOut + 2 * MINUTE).toISOString();
      const closesAt = new Date(soldOut + 7 * MINUTE).toISOString();

      // The guest's own entry in the release says when the second door appears; nobody else's.
      const state = (m: Member) => m.client.get(`/api/v1/live/${r.id}/state`).then((res) => safeJson(res) as { entry: { status: string; afterRoom: unknown } | null });
      expect(await state(guest)).toMatchObject({ entry: { status: 'ENDED', afterRoom: { opensAt, closesAt } } });
      expect((await state(buyer)).entry!.afterRoom).toBeNull();
      expect((await state(other)).entry).toBeNull();
      // Before its T0, its page is unknown to its guest too; signed out, 401.
      const page = (m: Member) => m.client.get(`/api/v1/live/${r.id}/after-room`);
      expect(errorOf(await page(guest)).code).toBe('DROP_NOT_FOUND');
      expect((await h.client().get(`/api/v1/live/${r.id}/after-room`)).statusCode).toBe(401);

      // From its T0: its guest reads it, never kept; anyone else, the same 404 as an unknown release.
      h.clock.set(opensAt);
      const res = await page(guest);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(safeJson(res)).toMatchObject({ id: child, kind: 'LIVE', phase: 'LIVE', name: 'AFTERGLOW', priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }], afterRoom: { parentId: r.id } });
      for (const m of [buyer, other]) {
        expect(errorOf(await page(m)).code).toBe('DROP_NOT_FOUND');
        for (const [method, url, body] of [
          ['GET', `/api/v1/live/${child}/state`, undefined],
          ['GET', `/api/v1/live/${child}/stream`, undefined],
          ['POST', `/api/v1/live/${child}/enter`, { sizeId: r.afterRoom!.sizes[0]!.id }],
          ['PUT', `/api/v1/live/${child}/interest`, { sizeId: r.afterRoom!.sizes[0]!.id }],
        ] as const) {
          const x = await m.client.request(method, url, { body });
          expect([url, x.statusCode, errorOf(x).code]).toEqual([url, 404, 'DROP_NOT_FOUND']);
        }
      }
      // On no public surface: its page, its .ics, the list, the banner, a board.
      const c = h.client();
      for (const url of [`/api/v1/live/${child}`, `/api/v1/live/${child}/calendar.ics`]) expect([url, errorOf(await c.get(url)).code]).toEqual([url, 'DROP_NOT_FOUND']);
      expect((safeJson(await c.get('/api/v1/live')) as { releases: { id: string }[] }).releases.map((x) => x.id)).not.toContain(child);
      expect((safeJson(await c.get('/api/v1/live/next')) as { release: { id: string } | null }).release?.id).not.toBe(child);
      expect(errorOf(await c.post(`/api/v1/live/${child}/board`, { token: 'A'.repeat(43) })).code).toBe('DROP_NOT_FOUND');
      // Nor in the circle: a post never links it.
      const admin = await adminClient(h, 'OPERATOR');
      expect(errorOf(await admin.post('/api/admin/circle/posts', { kind: 'NOTE', title: 'A SECOND DOOR', dropId: child })).code).toBe('DROP_NOT_FOUND');

      // Its guest enters at its place, follows it, and finds it in MY PIECES through the release it follows.
      const entered = await guest.client.post(`/api/v1/live/${child}/enter`, { sizeId: r.afterRoom!.sizes[0]!.id });
      expect(safeJson(entered)).toMatchObject({ entry: { status: 'QUEUED', position: 1 } });
      expect(safeJson(await guest.client.get(`/api/v1/live/${child}/state`))).toMatchObject({ entry: { status: 'QUEUED', afterRoom: null } });
      const mine = (safeJson(await guest.client.get('/api/v1/live/mine')) as { entries: { release: { id: string; afterRoomOf: string | null } }[] }).entries;
      expect(mine.find((x) => x.release.id === child)?.release.afterRoomOf).toBe(r.id);
      expect(mine.find((x) => x.release.id === r.id)?.release.afterRoomOf).toBeNull();
    });
  });

  it('ends every stream when the server shuts down', async () => {
    const g = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    g.clock.set(START);
    const gf = await liveFixtureOn(g.ctx, g.clock);
    const r = await createLiveRelease(gf, { opensAt: new Date(g.clock.now().getTime() + HOUR) });
    const m = await member(g, gf, 1);
    await g.app.listen({ port: 0, host: '127.0.0.1' });
    const s = await openSse(`http://127.0.0.1:${(g.app.server.address() as { port: number }).port}`, `/api/v1/live/${r.id}/stream`, { cookies: m.client.cookies });
    await s.next((e) => e.event === 'you');
    await g.close();
    await until(() => s.ended);
  });
});
