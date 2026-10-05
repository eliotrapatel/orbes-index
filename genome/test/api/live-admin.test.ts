/**
 * The LIVE RELEASES in the console (plan of 2026-10-04, The console; step L4: routes/admin/live.ts,
 * services/live-console.ts, MediaService's silhouette, the console's stream of http/live-stream.ts):
 *
 *  - create a LIVE RELEASE with every setting and its defaults (the room 5 minutes before T0, a turn of 30 s, 5 minutes to
 *    pay, one piece per person, the tier priority, « N PIECES », EUR), its seed sealed and committed, audited; every
 *    refusal of its settings (the sizes and their total, the add-ons, the currency, the times and the stages in order, the
 *    models and the collection of its rule, the per-tier windows);
 *  - edit everything before the announcement (a published release announced later too), the lists replaced, their ids
 *    kept, the quantity line following the stock while it is the default, nothing written when nothing changes; after
 *    the announcement only ADD PIECES raises the stock (409 LIVE_ANNOUNCED), and not before it (409 LIVE_NOT_ANNOUNCED); a
 *    published release keeps its announcement time;
 *  - publish, with a post of the circle shown from the announcement and kept in step until then, its link naming the
 *    release once its name is revealed; that post added or withdrawn after the publication until the announcement;
 *    cancel before the room opens only, the scheduled post withdrawn;
 *  - the silhouette (an image body), the boutique board's link issued once and revoked;
 *  - the live board and the console's stream: the counters per size and overall, the line with the emails masked for an
 *    AUDITOR (in its stream too, which follows a change of role and ends with its session), the controls with their roles
 *    (OPERATOR: pause, resume, extend, add pieces, free a hold, let in, message; ADMIN: end now, remove), each audited;
 *    a host message only from the announcement to the end;
 *  - Client Services: the confirmed reservations followed as orders on the Orders board (plan LIVE RELEASE+: the LIVE
 *    plan's list, its CSV and its resolution retired), one per piece with its add-ons, narrowed to the release, paid or
 *    cancelled there; the orders' CSV (masked for an AUDITOR, no formula run).
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_CIRCLE_TITLE, liveReference } from '../../src/server/services/live-console.js';
import { jpegPhoto } from '../support/images.js';
import { createAccount, createCollection, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { openSse } from '../support/sse.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, ORIGIN, safeJson, type Client, type Harness } from './support.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = '2026-11-09T09:00:00.000Z';

type Json = Record<string, any>;

describe('LIVE RELEASES: the console', () => {
  let h: Harness;
  let f: LiveFixture;
  let base: string;
  let op: Client;
  let auditor: Client;
  let admin: Client;

  const iso = (ms: number) => new Date(h.clock.now().getTime() + ms).toISOString();
  /** The body of a new release opening in `inMinutes`, for an hour, with two sizes. */
  const settings = (o: Json = {}): Json => ({
    modelId: f.modelId,
    title: 'THE MONOLITHE RING',
    opensAt: iso((o.inMinutes ?? 60) * MINUTE),
    closesAt: iso(((o.inMinutes ?? 60) + 60) * MINUTE),
    priceMinor: 480_000,
    sizes: [
      { label: '52', stock: 3 },
      { label: '54', stock: 2 },
    ],
    ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'inMinutes')),
  });
  const create = async (o: Json = {}): Promise<Json> => {
    const res = await op.post('/api/admin/live', settings(o));
    expect(res.statusCode, res.body).toBe(201);
    return safeJson(res) as Json;
  };
  const audits = (action: string, targetId: string) =>
    h.ctx.db.selectFrom('audit_logs').select(['action', 'details', 'actor_id']).where('action', '=', action).where('target_id', '=', targetId).orderBy('id').execute();
  /** An account allowed in, holding `pieces` pieces of the fixture's model. */
  const customer = async (pieces = 1) => {
    const a = await createAccount(h.ctx.db);
    if (pieces) await holdPieces(h.ctx.db, a.id, pieces, f.modelId);
    return a;
  };
  /** The account's turn taken: the seal pressed, held 1.5 s, secured. */
  const secure = async (a: { id: string; actor: any }, dropId: string) => {
    const e = await f.live.entry(a.id, dropId);
    const token = e!.turn!.token!;
    await f.live.press(a.id, dropId, token);
    h.clock.advance(1500);
    return f.live.secure(a.id, dropId, token, a.actor);
  };

  beforeAll(async () => {
    h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    h.clock.set(START);
    f = await liveFixtureOn(h.ctx, h.clock);
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(h.app.server.address() as { port: number }).port}`;
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
  });
  afterAll(() => h?.close());

  describe('create and edit', () => {
    it('creates a DRAFT with every setting, its defaults, its seed committed, audited', async () => {
      const r = await create();
      expect(r).toMatchObject({
        phase: 'DRAFT',
        editable: true,
        title: 'THE MONOLITHE RING',
        model: { id: f.modelId, name: 'MONOLITHE' },
        roomOpensMinutes: 5,
        turnSeconds: 30,
        payMinutes: 5,
        perAccount: 1,
        tierPriority: true,
        minTier: 0,
        priceMinor: 480_000,
        currency: 'EUR',
        quantity: 5,
        quantityLine: '5 PIECES',
        sizes: [
          { label: '52', stock: 3 },
          { label: '54', stock: 2 },
        ],
        addons: [],
        tierWindows: [],
        access: { models: [], collection: null, text: 'every ORBES account' },
        announceAt: null,
        silhouette: null,
        boardLink: null,
        circlePosts: [],
        publishedAt: null,
        stages: null,
      });
      expect(r.seedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.roomOpensAt).toBe(new Date(Date.parse(r.opensAt) - 5 * MINUTE).toISOString());
      const row = await h.ctx.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ mode: 'LIVE', early_access_hours: 0, drawn_at: null });
      expect(JSON.stringify(r)).not.toContain('seed_enc');
      const [created] = await audits('drop.live.create', r.id);
      expect(created!.details).toMatchObject({ sizes: ['52:3', '54:2'], quantityLine: '5 PIECES', priceMinor: 480_000, seedHash: r.seedHash });
      // Listed with the draws apart: the LIVE list has it, the draw's list does not.
      const list = safeJson(await auditor.get('/api/admin/live')) as { items: Json[] };
      expect(list.items.map((x) => x.id)).toContain(r.id);
      expect((safeJson(await auditor.get('/api/admin/drops')) as { items: Json[] }).items.map((x) => x.id)).not.toContain(r.id);
    });

    it('takes every LIVE setting: access by tier, models and collection, windows per tier, add-ons, stages, a quantity line', async () => {
      const other = await createModel(h.ctx.db, 'NOCTURNE');
      const collection = await createCollection(h.ctx.db, 'ORBIT LIVE');
      const r = await create({
        inMinutes: 6 * 60,
        description: 'A ring of the vault.',
        roomOpensMinutes: 10,
        turnSeconds: 45,
        payMinutes: 8,
        perAccount: 2,
        currency: 'CHF',
        minTier: 2,
        tierPriority: false,
        accessModelIds: [other, f.modelId],
        accessCollectionId: collection,
        quantityLine: '5 PIECES · NEVER MORE',
        addons: [
          { label: 'ENGRAVING', line: 'Your initials, by hand', priceMinor: 15_000 },
          { label: 'GIFT BOX', priceMinor: 0 },
        ],
        announceAt: iso(HOUR),
        silhouetteAt: iso(2 * HOUR),
        nameAt: iso(3 * HOUR),
        photoAt: iso(4 * HOUR),
        tierWindows: [
          { tier: 3, payMinutes: 10 },
          { tier: 2, turnSeconds: 60, payMinutes: null },
        ],
      });
      expect(r).toMatchObject({
        description: 'A ring of the vault.',
        roomOpensMinutes: 10,
        turnSeconds: 45,
        payMinutes: 8,
        perAccount: 2,
        currency: 'CHF',
        minTier: 2,
        tierPriority: false,
        quantityLine: '5 PIECES · NEVER MORE',
        addons: [
          { label: 'ENGRAVING', line: 'Your initials, by hand', priceMinor: 15_000 },
          { label: 'GIFT BOX', line: null, priceMinor: 0 },
        ],
        tierWindows: [
          { tier: 2, turnSeconds: 60, payMinutes: null },
          { tier: 3, turnSeconds: null, payMinutes: 10 },
        ],
        access: { collection: { id: collection, name: 'ORBIT LIVE' }, text: 'owners from PLATINE of MONOLITHE, NOCTURNE or the ORBIT LIVE collection' },
      });
      expect(r.announceAt).toBe(iso(HOUR));
      expect(r.photoAt).toBe(iso(4 * HOUR));
    });

    it('refuses settings outside the rules, each with its reason', async () => {
      const inactive = await createModel(h.ctx.db, 'RETIRED');
      await h.ctx.db.updateTable('models').set({ active: false }).where('id', '=', inactive).execute();
      const cases: [Json, number, string | RegExp][] = [
        [{ sizes: [] }, 400, 'VALIDATION_FAILED'],
        [{ sizes: [{ label: '52', stock: 0 }] }, 400, /1 to 10000 pieces in all/],
        [{ sizes: [{ label: '52', stock: 1 }, { label: '52', stock: 1 }] }, 400, /listed twice/],
        [{ sizes: [{ label: 'S', stock: 1 }, { label: 's', stock: 1 }] }, 400, /listed twice/],
        [{ sizes: Array.from({ length: 25 }, (_, i) => ({ label: `S${i}`, stock: 1 })) }, 400, 'VALIDATION_FAILED'],
        [{ addons: Array.from({ length: 7 }, (_, i) => ({ label: `A${i}`, priceMinor: 1 })) }, 400, 'VALIDATION_FAILED'],
        [{ currency: 'JPY' }, 400, 'VALIDATION_FAILED'],
        [{ priceMinor: -1 }, 400, 'VALIDATION_FAILED'],
        [{ perAccount: 6 }, 400, 'VALIDATION_FAILED'],
        [{ turnSeconds: 9 }, 400, 'VALIDATION_FAILED'],
        [{ quantityLine: 'X'.repeat(41) }, 400, 'VALIDATION_FAILED'],
        [{ closesAt: iso(30 * MINUTE) }, 400, /ends after T0/],
        [{ inMinutes: 4 }, 400, /room would already be open/],
        [{ announceAt: iso(-MINUTE) }, 400, /announcement comes later than now/],
        [{ announceAt: iso(58 * MINUTE) }, 400, /before the room opens/],
        [{ silhouetteAt: iso(20 * MINUTE), nameAt: iso(10 * MINUTE) }, 400, /The name is revealed after/],
        [{ announceAt: iso(20 * MINUTE), silhouetteAt: iso(10 * MINUTE) }, 400, /The silhouette is revealed after/],
        [{ photoAt: iso(57 * MINUTE) }, 400, /The photograph is revealed before the room opens/],
        // An empty stage is at the announcement: a name set after it leaves the photograph before the name.
        [{ nameAt: iso(20 * MINUTE) }, 400, /The photograph is revealed after the announcement and the stages before it/],
        [{ tierWindows: [{ tier: 1 }] }, 400, /sets its turn, its time to pay, or both/],
        [{ tierWindows: [{ tier: 1, turnSeconds: 20 }, { tier: 1, payMinutes: 2 }] }, 400, /one override at most/],
        [{ modelId: '00000000-0000-4000-8000-000000000000' }, 404, 'MODEL_NOT_FOUND'],
        [{ modelId: inactive }, 409, 'MODEL_INACTIVE'],
        [{ accessModelIds: ['00000000-0000-4000-8000-000000000000'] }, 404, 'MODEL_NOT_FOUND'],
        [{ accessCollectionId: '00000000-0000-4000-8000-000000000000' }, 404, 'COLLECTION_NOT_FOUND'],
        [{ unknownField: true }, 400, 'VALIDATION_FAILED'],
      ];
      for (const [o, status, expected] of cases) {
        const res = await op.post('/api/admin/live', settings(o));
        expect([JSON.stringify(o).slice(0, 60), res.statusCode]).toEqual([JSON.stringify(o).slice(0, 60), status]);
        const e = errorOf(res);
        if (typeof expected === 'string') expect(e.code).toBe(expected);
        else expect(e.message).toMatch(expected);
      }
      expect(errorOf(await auditor.post('/api/admin/live', settings())).code).toBe('FORBIDDEN');
    });

    it('edits everything before the announcement: the lists replaced with their ids kept, the default quantity line following the stock', async () => {
      const r = await create();
      const [s52, s54] = r.sizes as Json[];
      const res = await op.patch(`/api/admin/live/${r.id}`, {
        sizes: [{ id: s54!.id, label: '54', stock: 4 }, { label: '56', stock: 1 }, { id: s52!.id, label: '52', stock: 3 }],
        addons: [{ label: 'ENGRAVING', priceMinor: 9_000 }],
        title: 'THE RING',
      });
      expect(res.statusCode, res.body).toBe(200);
      const e = safeJson(res) as Json;
      expect(e.sizes.map((x: Json) => [x.label, x.stock])).toEqual([['54', 4], ['56', 1], ['52', 3]]);
      expect(e.sizes[0].id).toBe(s54!.id);
      expect(e.sizes[2].id).toBe(s52!.id);
      expect(e).toMatchObject({ quantity: 8, quantityLine: '8 PIECES', title: 'THE RING' });
      const [update] = await audits('drop.live.update', r.id);
      expect(update!.details).toMatchObject({ before: { title: 'THE MONOLITHE RING', sizes: ['52:3', '54:2'], quantityLine: '5 PIECES' }, after: { title: 'THE RING', quantityLine: '8 PIECES' } });
      // A quantity line of the console's own stays as written.
      const own = safeJson(await op.patch(`/api/admin/live/${r.id}`, { quantityLine: '8 PIECES · NEVER MORE' })) as Json;
      const more = safeJson(await op.patch(`/api/admin/live/${r.id}`, { sizes: [...own.sizes, { label: '58', stock: 2 }] })) as Json;
      expect(more).toMatchObject({ quantity: 10, quantityLine: '8 PIECES · NEVER MORE' });
      // The same settings again: nothing written.
      const n = (await audits('drop.live.update', r.id)).length;
      expect((await op.patch(`/api/admin/live/${r.id}`, { title: 'THE RING', turnSeconds: 30 })).statusCode).toBe(200);
      expect(await audits('drop.live.update', r.id)).toHaveLength(n);
      // A size of another release is not this one's to keep.
      const other = await create();
      expect(errorOf(await op.patch(`/api/admin/live/${r.id}`, { sizes: [{ id: other.sizes[0].id, label: '60', stock: 1 }] })).message).toMatch(/one of the release’s/);
      expect(errorOf(await op.patch(`/api/admin/live/${r.id}`, {})).code).toBe('VALIDATION_FAILED');
      expect(errorOf(await auditor.patch(`/api/admin/live/${r.id}`, { title: 'X' })).code).toBe('FORBIDDEN');
      expect(errorOf(await op.patch('/api/admin/live/00000000-0000-4000-8000-000000000000', { title: 'X' })).code).toBe('DROP_NOT_FOUND');
      // A draw is not a LIVE RELEASE here, nor a LIVE RELEASE a draw there.
      const draw = await f.drops.create({ modelId: f.modelId, title: 'A DRAW', quantity: 3, opensAt: new Date(iso(HOUR)), closesAt: new Date(iso(2 * HOUR)) }, f.admin);
      expect(errorOf(await op.get(`/api/admin/live/${draw.id}`)).code).toBe('DROP_NOT_FOUND');
      expect(errorOf(await op.patch(`/api/admin/drops/${r.id}`, { title: 'X' })).code).toBe('DROP_LIVE');
    });

    it('keeps a published release editable until its announcement, then only its stock rises (ADD PIECES)', async () => {
      const r = await create({ inMinutes: 3 * 60, announceAt: iso(HOUR) });
      const published = safeJson(await op.post(`/api/admin/live/${r.id}/publish`, {})) as Json;
      expect(published).toMatchObject({ phase: 'HIDDEN', editable: true });
      expect((await op.patch(`/api/admin/live/${r.id}`, { priceMinor: 500_000 })).statusCode).toBe(200);
      // Until the announcement the stock is a setting, its default quantity line following it: no ADD PIECES yet.
      const early = await op.post(`/api/admin/live/${r.id}/stock`, { sizeId: r.sizes[0].id, pieces: 2 });
      expect(early.statusCode).toBe(409);
      expect(errorOf(early)).toMatchObject({ code: 'LIVE_NOT_ANNOUNCED', message: expect.stringMatching(/in the settings until the announcement/) });
      expect(await audits('drop.live.stock', r.id)).toHaveLength(0);
      // Emptied once published, the announcement would be the publication, past: refused, the release still hidden.
      const emptied = await op.patch(`/api/admin/live/${r.id}`, { announceAt: null });
      expect(emptied.statusCode).toBe(400);
      expect(errorOf(emptied).message).toBe('A published release keeps an announcement time; set one later than now.');
      expect(safeJson(await op.get(`/api/admin/live/${r.id}`)) as Json).toMatchObject({ phase: 'HIDDEN', editable: true, quantityLine: '5 PIECES', sizes: [{ stock: 3 }, { stock: 2 }] });
      h.clock.advance(HOUR);
      const announced = safeJson(await op.get(`/api/admin/live/${r.id}`)) as Json;
      expect(announced).toMatchObject({ phase: 'ANNOUNCED', editable: false, priceMinor: 500_000 });
      const refused = await op.patch(`/api/admin/live/${r.id}`, { sizes: [{ id: r.sizes[0].id, label: '52', stock: 9 }] });
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).code).toBe('LIVE_ANNOUNCED');
      const raised = await op.post(`/api/admin/live/${r.id}/stock`, { sizeId: r.sizes[0].id, pieces: 2 });
      expect(raised.statusCode, raised.body).toBe(200);
      expect((safeJson(await op.get(`/api/admin/live/${r.id}`)) as Json).sizes[0]).toMatchObject({ label: '52', stock: 5 });
      const [stock] = await audits('drop.live.stock', r.id);
      expect(stock!.details).toMatchObject({ pieces: 2, before: 3, after: 5, quantityLine: '5 PIECES' });
      // The stock never goes down: there is no way to.
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/stock`, { sizeId: r.sizes[0].id, pieces: -1 })).code).toBe('VALIDATION_FAILED');
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/stock`, { sizeId: r.sizes[0].id, pieces: 0 })).code).toBe('VALIDATION_FAILED');
    });

    it('sets the after-room with the release (plan LIVE RELEASE+, choice 2): its own page never set, published, cancelled nor listed on its own', async () => {
      const afterRoom = { modelId: f.modelId, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 2 }], addons: [{ label: 'GIFT BOX', priceMinor: 5_000 }], delayMinutes: 5 };
      const r = await create({ afterRoom });
      expect(r.afterRoom).toMatchObject({ state: 'WAITING', priceMinor: 90_000, delayMinutes: 5, lengthMinutes: 15, quantity: 2, sizes: [{ label: 'ONE SIZE', stock: 2 }], guests: 0 });
      expect(r.afterRoomOf).toBeNull();
      const child = r.afterRoom.id as string;
      // The schema's bounds and shape; the service's rules behind them.
      for (const bad of [{ ...afterRoom, delayMinutes: 0 }, { ...afterRoom, lengthMinutes: 121 }, { ...afterRoom, sizes: [] }, { ...afterRoom, colour: 'ivory' }, { ...afterRoom, priceMinor: -1 }]) {
        const res = await op.patch(`/api/admin/live/${r.id}`, { afterRoom: bad });
        expect([res.statusCode, errorOf(res).code]).toEqual([400, 'VALIDATION_FAILED']);
      }
      const longer = await op.patch(`/api/admin/live/${r.id}`, { afterRoom: { ...afterRoom, lengthMinutes: 30 } });
      expect(longer.statusCode, longer.body).toBe(200);
      expect((safeJson(longer) as Json).afterRoom).toMatchObject({ id: child, lengthMinutes: 30 });
      expect((await audits('drop.live.update', r.id)).at(-1)!.details).toMatchObject({ before: { afterRoom: { lengthMinutes: 15 } }, after: { afterRoom: { lengthMinutes: 30 } } });
      // Its own page: read by an AUDITOR, never set, published, cancelled, posted or given a board.
      expect(safeJson(await auditor.get(`/api/admin/live/${child}`))).toMatchObject({ id: child, afterRoomOf: { id: r.id }, editable: false, phase: 'DRAFT', afterRoom: null });
      for (const [method, url, body] of [
        ['PATCH', `/api/admin/live/${child}`, { priceMinor: 1 }],
        ['POST', `/api/admin/live/${child}/publish`, {}],
        ['POST', `/api/admin/live/${child}/cancel`, {}],
        ['POST', `/api/admin/live/${child}/circle-post`, {}],
        ['POST', `/api/admin/live/${child}/board-link`, {}],
      ] as const) {
        const res = await op.request(method, url, { body });
        expect([url, res.statusCode, errorOf(res).code]).toEqual([url, 409, 'LIVE_AFTER_ROOM']);
      }
      const silhouette = await op.request('POST', `/api/admin/live/${child}/silhouette`, { body: Buffer.from(jpegPhoto(12, 16)), headers: { 'content-type': 'image/jpeg' } });
      expect([silhouette.statusCode, errorOf(silhouette).code]).toEqual([404, 'DROP_NOT_FOUND']);
      const list = safeJson(await auditor.get('/api/admin/live?pageSize=100')) as { items: { id: string }[] };
      expect(list.items.map((x) => x.id)).toContain(r.id);
      expect(list.items.map((x) => x.id)).not.toContain(child);
      // Off: removed.
      const off = await op.patch(`/api/admin/live/${r.id}`, { afterRoom: null });
      expect((safeJson(off) as Json).afterRoom).toBeNull();
      expect((await auditor.get(`/api/admin/live/${child}`)).statusCode).toBe(404);
    });
  });

  describe('publish and cancel', () => {
    it('publishes with a post of the circle shown from the announcement, kept in step, its link naming the release only once revealed', async () => {
      const t0 = h.clock.now().getTime();
      const r = await create({ inMinutes: 5 * 60, minTier: 2, announceAt: iso(HOUR), nameAt: iso(2 * HOUR), photoAt: iso(2 * HOUR), quantityLine: '5 PIECES · NEVER MORE', accessModelIds: [f.modelId] });
      const res = await op.post(`/api/admin/live/${r.id}/publish`, { circlePost: true });
      expect(res.statusCode, res.body).toBe(200);
      const p = safeJson(res) as Json;
      expect(p.circlePosts).toHaveLength(1);
      expect(p.circlePosts[0].publishedAt).toBe(new Date(t0 + HOUR).toISOString());
      const post = await h.ctx.db.selectFrom('circle_posts').selectAll().where('id', '=', p.circlePosts[0].id).executeTakeFirstOrThrow();
      expect(post).toMatchObject({ kind: 'NOTE', title: LIVE_CIRCLE_TITLE, min_tier: 2, drop_id: r.id });
      expect(post.body).toContain('Paris time, 5 minutes before the release.');
      expect(post.body).toContain('5 PIECES · NEVER MORE · €\u00a04\u00a0800. For owners from PLATINE of this model.');
      expect(post.body).not.toContain('MONOLITHE');
      expect((await audits('drop.live.publish', r.id))[0]!.details).toMatchObject({ circlePostId: post.id });
      expect((await audits('circle.post.create', post.id))[0]!.details).toMatchObject({ by: 'drop.live.publish', minTier: 2 });

      // A PLATINE owner of the circle reads nothing of it before the announcement.
      const { client, email } = await accountClient(h);
      const { id: memberId } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
      await holdPieces(h.ctx.db, memberId, 3, f.modelId);
      const feed = async () => (safeJson(await client.get('/api/v1/club/circle')) as { items: Json[] }).items.map((x) => x.id);
      expect(await feed()).not.toContain(post.id);
      expect((await client.get(`/api/v1/club/circle/${post.id}`)).statusCode).toBe(404);

      // Moved with the release while it is not shown.
      expect((await op.patch(`/api/admin/live/${r.id}`, { announceAt: iso(90 * MINUTE) })).statusCode).toBe(200);
      const moved = await h.ctx.db.selectFrom('circle_posts').select('published_at').where('id', '=', post.id).executeTakeFirstOrThrow();
      expect(moved.published_at!.toISOString()).toBe(new Date(t0 + 90 * MINUTE).toISOString());
      expect((await audits('circle.post.update', post.id))[0]!.details).toMatchObject({ by: 'drop.live.update' });

      h.clock.advance(90 * MINUTE);
      expect(await feed()).toContain(post.id);
      const shown = safeJson(await client.get(`/api/v1/club/circle/${post.id}`)) as Json;
      expect(shown.links.drop).toEqual({ id: r.id, title: 'LIVE RELEASE' });
      h.clock.advance(30 * MINUTE);
      expect((safeJson(await client.get(`/api/v1/club/circle/${post.id}`)) as Json).links.drop).toEqual({ id: r.id, title: 'THE MONOLITHE RING' });
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/publish`, {})).code).toBe('DROP_ALREADY_PUBLISHED');
    });

    it('refuses a publication whose room would already be open or whose stage now comes before the announcement', async () => {
      const r = await create({ inMinutes: 20 });
      h.clock.advance(16 * MINUTE);
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/publish`, {})).message).toMatch(/room would already be open/);
      const s = await create({ inMinutes: 3 * 60, silhouetteAt: iso(30 * MINUTE), nameAt: iso(30 * MINUTE), photoAt: iso(30 * MINUTE) });
      h.clock.advance(HOUR);
      expect(errorOf(await op.post(`/api/admin/live/${s.id}/publish`, {})).message).toMatch(/revealed after the announcement/);
    });

    it('cancels before the room opens only, withdrawing a post not shown yet', async () => {
      const r = await create({ inMinutes: 3 * 60, announceAt: iso(HOUR) });
      const p = safeJson(await op.post(`/api/admin/live/${r.id}/publish`, { circlePost: true })) as Json;
      const c = safeJson(await op.post(`/api/admin/live/${r.id}/cancel`, {})) as Json;
      expect(c).toMatchObject({ phase: 'CANCELLED', editable: false });
      expect((await h.ctx.db.selectFrom('circle_posts').select('published_at').where('id', '=', p.circlePosts[0].id).executeTakeFirstOrThrow()).published_at).toBeNull();
      expect((await audits('circle.post.unpublish', p.circlePosts[0].id))[0]!.details).toMatchObject({ by: 'drop.live.cancel' });
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/cancel`, {})).code).toBe('DROP_CANCELLED');
      expect(errorOf(await op.patch(`/api/admin/live/${r.id}`, { title: 'X' })).code).toBe('DROP_CANCELLED');

      const open = await create({ inMinutes: 10 });
      await op.post(`/api/admin/live/${open.id}/publish`, {});
      h.clock.advance(6 * MINUTE);
      const refused = await op.post(`/api/admin/live/${open.id}/cancel`, {});
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).code).toBe('LIVE_ROOM_OPEN');
    });
  });

  describe('the post of the circle after the publication', () => {
    it('adds and withdraws the release’s post of the circle once published, until its announcement, audited', async () => {
      const r = await create({ inMinutes: 60, announceAt: iso(20 * MINUTE) });
      const at = new Date(r.announceAt).toISOString();
      const path = `/api/admin/live/${r.id}/circle-post`;
      // A draft's post is chosen when it is published.
      expect(errorOf(await op.post(path, {})).code).toBe('DROP_NOT_PUBLISHED');
      await op.post(`/api/admin/live/${r.id}/publish`, {});
      expect((await auditor.post(path, {})).statusCode).toBe(403);
      expect((await auditor.request('DELETE', path)).statusCode).toBe(403);
      expect(errorOf(await op.request('DELETE', path)).code).toBe('LIVE_NO_CIRCLE_POST');
      expect(errorOf(await op.post(path, { circlePost: true })).code).toBe('VALIDATION_FAILED');

      const added = await op.post(path, {});
      expect(added.statusCode, added.body).toBe(200);
      const { circlePosts } = safeJson(added) as Json;
      expect(circlePosts).toEqual([{ id: expect.any(String), publishedAt: at }]);
      const post = await h.ctx.db.selectFrom('circle_posts').selectAll().where('id', '=', circlePosts[0].id).executeTakeFirstOrThrow();
      expect(post).toMatchObject({ kind: 'NOTE', title: LIVE_CIRCLE_TITLE, min_tier: 1, drop_id: r.id });
      expect(post.body).toContain('Paris time, 5 minutes before the release.');
      expect((await audits('circle.post.create', post.id))[0]!.details).toMatchObject({ dropId: r.id, minTier: 1, publishedAt: at });
      expect(errorOf(await op.post(path, {})).code).toBe('LIVE_CIRCLE_POSTED');
      // Kept in step with the release, as the publication's.
      expect((await op.patch(`/api/admin/live/${r.id}`, { announceAt: iso(30 * MINUTE) })).statusCode).toBe(200);
      expect((await h.ctx.db.selectFrom('circle_posts').select('published_at').where('id', '=', post.id).executeTakeFirstOrThrow()).published_at!.toISOString()).toBe(iso(30 * MINUTE));

      const withdrawn = await op.request('DELETE', path);
      expect(withdrawn.statusCode, withdrawn.body).toBe(200);
      expect((safeJson(withdrawn) as Json).circlePosts).toEqual([{ id: post.id, publishedAt: null }]);
      expect((await audits('circle.post.unpublish', post.id))[0]!.details).toMatchObject({ dropId: r.id });
      expect(errorOf(await op.request('DELETE', path)).code).toBe('LIVE_NO_CIRCLE_POST');

      // Posted again, then announced: the choice is fixed.
      const again = safeJson(await op.post(path, {})) as Json;
      expect(again.circlePosts.filter((p: Json) => p.publishedAt !== null)).toHaveLength(1);
      h.clock.advance(30 * MINUTE);
      expect(errorOf(await op.request('DELETE', path)).code).toBe('LIVE_ANNOUNCED');
      expect(errorOf(await op.post(path, {})).code).toBe('LIVE_ANNOUNCED');

      const cancelled = await create({ inMinutes: 60, announceAt: iso(20 * MINUTE) });
      await op.post(`/api/admin/live/${cancelled.id}/publish`, {});
      await op.post(`/api/admin/live/${cancelled.id}/cancel`, {});
      expect(errorOf(await op.post(`/api/admin/live/${cancelled.id}/circle-post`, {})).code).toBe('DROP_CANCELLED');
    });
  });

  describe('the silhouette and the board link', () => {
    it('sets and removes the silhouette until the announcement (an image body, OPERATOR)', async () => {
      const r = await create({ inMinutes: 3 * 60, announceAt: iso(HOUR) });
      const photo = jpegPhoto(12, 16);
      const upload = (c: Client) => c.request('POST', `/api/admin/live/${r.id}/silhouette`, { body: Buffer.from(photo), headers: { 'content-type': 'image/jpeg' } });
      expect((await upload(auditor)).statusCode).toBe(403);
      const res = await upload(op);
      expect(res.statusCode, res.body).toBe(200);
      const s = (safeJson(res) as Json).silhouette;
      expect(s.url).toBe(`/api/v1/media/${s.sha256}`);
      expect((await audits('drop.live.silhouette.set', r.id))[0]!.details).toMatchObject({ sha256: s.sha256, previous: null });
      expect((await op.request('POST', `/api/admin/live/${r.id}/silhouette`, { body: { x: 1 } })).statusCode).toBe(415);
      const removed = await op.request('DELETE', `/api/admin/live/${r.id}/silhouette`);
      expect((safeJson(removed) as Json).silhouette).toBeNull();
      expect(await h.ctx.db.selectFrom('media_objects').select('sha256').where('sha256', '=', s.sha256).executeTakeFirst()).toBeUndefined();
      await upload(op);
      await op.post(`/api/admin/live/${r.id}/publish`, {});
      h.clock.advance(HOUR);
      expect(errorOf(await upload(op)).code).toBe('LIVE_ANNOUNCED');
      expect(errorOf(await op.request('DELETE', `/api/admin/live/${r.id}/silhouette`)).code).toBe('LIVE_ANNOUNCED');
    });

    it('issues the board link once, with its secret in the fragment, and revokes it', async () => {
      const r = await create();
      const res = await op.post(`/api/admin/live/${r.id}/board-link`, {});
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const { url, issuedAt } = safeJson(res) as Json;
      expect(url).toMatch(new RegExp(`^${ORIGIN}/verify/releases/${r.id}/board#[A-Za-z0-9_-]{43}$`));
      const token = url.split('#')[1];
      const after = safeJson(await op.get(`/api/admin/live/${r.id}`)) as Json;
      expect(after.boardLink).toEqual({ issuedAt });
      expect(JSON.stringify(after)).not.toContain(token);
      expect(JSON.stringify(await h.ctx.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).execute())).not.toContain(token);
      expect((await auditor.post(`/api/admin/live/${r.id}/board-link`, {})).statusCode).toBe(403);
      const revoked = await op.request('DELETE', `/api/admin/live/${r.id}/board-link`);
      expect((safeJson(revoked) as Json).boardLink).toBeNull();
      expect(errorOf(await op.request('DELETE', `/api/admin/live/${r.id}/board-link`)).code).toBe('LIVE_NO_BOARD_LINK');
    });
  });

  describe('the live board, its stream and its controls', () => {
    it('counts per size and overall, lists the line with the emails masked for an AUDITOR, and runs every control with its role', async () => {
      const r = await create({ inMinutes: 10, perAccount: 2, addons: [{ label: 'ENGRAVING', priceMinor: 9_000 }] });
      await op.post(`/api/admin/live/${r.id}/publish`, {});
      const [s52, s54] = r.sizes as Json[];
      h.clock.advance(6 * MINUTE);
      const people = [];
      for (const pieces of [5, 3, 1, 0, 1]) people.push(await customer(pieces));
      await f.live.enter(people[0]!.id, r.id, { sizeId: s52!.id, quantity: 2 }, people[0]!.actor);
      await f.live.enter(people[1]!.id, r.id, { sizeId: s52!.id }, people[1]!.actor);
      await f.live.enter(people[2]!.id, r.id, { sizeId: s54!.id }, people[2]!.actor);
      await f.live.enter(people[3]!.id, r.id, { sizeId: s54!.id }, people[3]!.actor);
      await f.live.setInterest(people[4]!.id, r.id, s54!.id, people[4]!.actor).catch(() => undefined);

      const before = safeJson(await auditor.get(`/api/admin/live/${r.id}/board`)) as { board: Json };
      expect(before.board).toMatchObject({ phase: 'ROOM', paused: false, totals: { inRoom: 4, waiting: 4, line: 0 }, lineTotal: 4 });
      expect(before.board.line.map((e: Json) => e.email).sort()).toEqual(people.slice(0, 4).map((p) => `${p.email[0]}***@example.com`).sort());
      const clear = safeJson(await op.get(`/api/admin/live/${r.id}/board`)) as { board: Json };
      expect(clear.board.line.map((e: Json) => e.email).sort()).toEqual(people.slice(0, 4).map((p) => p.email).sort());

      h.clock.advance(4 * MINUTE);
      await f.live.advance(r.id);
      const live = (safeJson(await op.get(`/api/admin/live/${r.id}/board`)) as { board: Json }).board;
      // 52: PALLADIUM (2 pieces) then PLATINE; 54: TITANE then none. Turns while pieces are free.
      expect(live.sizes.map((s: Json) => [s.label, s.stock, s.left, s.held, s.turns, s.line])).toEqual([
        ['52', 3, 0, 3, 2, 0],
        ['54', 2, 0, 2, 2, 0],
      ]);
      expect(live.line.map((e: Json) => [e.position, e.status])).toEqual([
        [1, 'TURN'],
        [2, 'TURN'],
        [3, 'TURN'],
        [4, 'TURN'],
      ]);

      // OPERATOR: pause and resume; an AUDITOR reads only.
      for (const [path, body] of [['pause', {}], ['resume', {}], ['extend', { minutes: 15 }], ['stock', { sizeId: s54!.id, pieces: 1 }], ['messages', { text: 'The vault opens.' }]] as const) {
        expect([path, (await auditor.post(`/api/admin/live/${r.id}/${path}`, body)).statusCode]).toEqual([path, 403]);
      }
      expect((await op.post(`/api/admin/live/${r.id}/pause`, {})).statusCode).toBe(200);
      expect((safeJson(await op.get(`/api/admin/live/${r.id}/board`)) as { board: Json }).board.paused).toBe(true);
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/pause`, {})).code).toBe('LIVE_ALREADY_PAUSED');
      expect((await op.post(`/api/admin/live/${r.id}/resume`, {})).statusCode).toBe(200);
      const extended = safeJson(await op.post(`/api/admin/live/${r.id}/extend`, { minutes: 15 })) as Json;
      expect(extended.closesAt).toBe(new Date(Date.parse(r.closesAt) + 15 * MINUTE).toISOString());
      const message = await op.post(`/api/admin/live/${r.id}/messages`, { text: 'The vault opens.' });
      expect(message.statusCode).toBe(201);
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/messages`, { text: 'two\nlines' })).code).toBe('VALIDATION_FAILED');
      expect((safeJson(await op.get(`/api/admin/live/${r.id}/board`)) as { board: Json }).board.message).toMatchObject({ text: 'The vault opens.' });

      // Secure, then free the hold (OPERATOR): the piece goes on.
      await secure(people[0]!, r.id);
      const held = (safeJson(await op.get(`/api/admin/live/${r.id}/entries?status=SECURED`)) as { items: Json[] }).items;
      expect(held.map((e) => e.accountId)).toEqual([people[0]!.id]);
      expect(held[0]!.gestureMs).toBe(1500);
      expect((await auditor.post(`/api/admin/live/${r.id}/entries/${held[0]!.id}/free`, {})).statusCode).toBe(403);
      const freed = safeJson(await op.post(`/api/admin/live/${r.id}/entries/${held[0]!.id}/free`, {})) as Json;
      expect(freed).toMatchObject({ status: 'EXPIRED', email: people[0]!.email });

      // Let in (OPERATOR): a person in the line takes their turn now, within the free pieces of its size (52: the two freed).
      const late = await customer(0);
      await f.live.enter(late.id, r.id, { sizeId: s52!.id }, late.actor);
      const lateEntry = (await f.live.entry(late.id, r.id))!;
      expect(lateEntry.status).toBe('QUEUED');
      expect((await auditor.post(`/api/admin/live/${r.id}/entries/${lateEntry.id}/let-in`, {})).statusCode).toBe(403);
      const letIn = safeJson(await op.post(`/api/admin/live/${r.id}/entries/${lateEntry.id}/let-in`, {})) as Json;
      expect(letIn).toMatchObject({ status: 'TURN', letIn: true, email: late.email });
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/entries/${lateEntry.id}/let-in`, {})).code).toBe('LIVE_ENTRY_NOT_QUEUED');
      // 54 has no free piece: refused; ADD PIECES then gives the first in line its turn (the engine's rule).
      const late54 = await customer(0);
      await f.live.enter(late54.id, r.id, { sizeId: s54!.id }, late54.actor);
      const entry54 = (await f.live.entry(late54.id, r.id))!;
      expect(errorOf(await op.post(`/api/admin/live/${r.id}/entries/${entry54.id}/let-in`, {})).code).toBe('LIVE_NO_FREE_PIECE');
      expect((safeJson(await op.post(`/api/admin/live/${r.id}/stock`, { sizeId: s54!.id, pieces: 1 })) as Json).sizes[1]).toMatchObject({ label: '54', stock: 3 });
      expect((await f.live.entry(late54.id, r.id))!.status).toBe('TURN');

      // ADMIN only: remove, and end now.
      const someone = (await f.live.entry(people[1]!.id, r.id))!;
      expect((await op.post(`/api/admin/live/${r.id}/entries/${someone.id}/remove`, {})).statusCode).toBe(403);
      expect((safeJson(await admin.post(`/api/admin/live/${r.id}/entries/${someone.id}/remove`, {})) as Json).status).toBe('REMOVED');
      expect((await op.post(`/api/admin/live/${r.id}/end`, {})).statusCode).toBe(403);
      const ended = safeJson(await admin.post(`/api/admin/live/${r.id}/end`, {})) as Json;
      expect(ended).toMatchObject({ endedReason: 'ENDED' });
      for (const action of ['pause', 'resume', 'extend', 'stock', 'message', 'free', 'let_in', 'remove', 'end']) {
        expect([action, (await audits(`drop.live.${action}`, r.id)).length > 0]).toEqual([action, true]);
      }
      const all = (safeJson(await auditor.get(`/api/admin/live/${r.id}/entries`)) as { items: Json[]; total: number });
      expect(all.total).toBe(6);
      expect(all.items.every((e) => /^\w\*\*\*@example\.com$/.test(e.email))).toBe(true);
      expect((safeJson(await op.get(`/api/admin/live/${r.id}/entries?status=OPEN`)) as { items: Json[] }).items.every((e) => ['WAITING', 'QUEUED', 'TURN', 'SECURED'].includes(e.status))).toBe(true);
      expect(errorOf(await op.get(`/api/admin/live/${r.id}/entries?status=GONE`)).code).toBe('VALIDATION_FAILED');
    });

    it('takes a host message from the announcement to the end of the sales only', async () => {
      const r = await create({ inMinutes: 40, announceAt: iso(20 * MINUTE) });
      const write = (text: string) => op.post(`/api/admin/live/${r.id}/messages`, { text });
      expect(errorOf(await write('Soon.')).code).toBe('DROP_NOT_FOUND');
      await op.post(`/api/admin/live/${r.id}/publish`, {});
      const early = await write('Soon.');
      expect(early.statusCode).toBe(409);
      expect(errorOf(early)).toMatchObject({ code: 'LIVE_NOT_ANNOUNCED', message: expect.stringMatching(/from its announcement/) });
      h.clock.advance(20 * MINUTE);
      expect((await write('The room opens at seven.')).statusCode).toBe(201);
      // The sales end 100 minutes after the creation.
      h.clock.advance(80 * MINUTE);
      expect(errorOf(await write('Too late.')).code).toBe('LIVE_ENDED');
      expect((await audits('drop.live.message', r.id)).map((a) => (a.details as Json).text)).toEqual(['The room opens at seven.']);
      expect(await h.ctx.db.selectFrom('live_messages').select('text').where('drop_id', '=', r.id).execute()).toEqual([{ text: 'The room opens at seven.' }]);
    });

    it('streams the board to a console, masked for an AUDITOR, following its role, ending with its session or the release', async () => {
      const draft = await create();
      const refused = await openSse(base, `/api/admin/live/${draft.id}/stream`, { cookies: op.cookies });
      expect(refused.status).toBe(204);
      expect((await openSse(base, `/api/admin/live/${draft.id}/stream`)).status).toBe(401);

      const r = await create({ inMinutes: 10 });
      await op.post(`/api/admin/live/${r.id}/publish`, {});
      h.clock.advance(6 * MINUTE);
      const a = await customer(1);
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0].id }, a.actor);

      const staff = await createAdmin(h.ctx, 'AUDITOR');
      const watcher = h.client();
      await watcher.post('/api/admin/auth/login', { email: staff.email, password: staff.password });
      const masked = await openSse(base, `/api/admin/live/${r.id}/stream`, { cookies: watcher.cookies });
      expect(masked.status).toBe(200);
      expect(masked.headers['content-type']).toMatch(/^text\/event-stream/);
      const first = await masked.next((e) => e.event === 'console');
      expect(first.data.now).toBe(h.clock.now().toISOString());
      expect((first.data.board as Json).line[0].email).toBe(`${a.email[0]}***@example.com`);
      const inClear = await openSse(base, `/api/admin/live/${r.id}/stream`, { cookies: op.cookies });
      expect(((await inClear.next((e) => e.event === 'console')).data.board as Json).line[0].email).toBe(a.email);

      // Only what changed: a pulse with nothing new sends nothing; a new entry does.
      await h.app.liveHub.pulse();
      expect(masked.events.filter((e) => e.event === 'console')).toHaveLength(1);
      const b = await customer(2);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[1].id }, b.actor);
      await h.app.liveHub.pulse();
      const second = await masked.next((e) => e.event === 'console' && (e.data.board as Json).lineTotal === 2, 1);
      expect((second.data.board as Json).totals.inRoom).toBe(2);

      // Promoted to OPERATOR: the next event reads the emails in clear.
      await h.ctx.db.updateTable('admin_users').set({ role: 'OPERATOR' }).where('id', '=', staff.id).execute();
      await h.app.liveHub.pulse();
      const promoted = await masked.next((e) => e.event === 'console' && (e.data.board as Json).line.some((x: Json) => x.email === a.email), 2);
      expect(promoted).toBeTruthy();

      // Signed out: its stream ends at the next pulse; the other stays.
      await watcher.post('/api/admin/auth/logout', {});
      await h.app.liveHub.pulse();
      await masked.next(() => false).catch(() => undefined);
      expect(masked.ended).toBe(true);
      expect(inClear.ended).toBe(false);

      // The release over: the last board, then the end.
      await admin.post(`/api/admin/live/${r.id}/end`, {});
      await h.app.liveHub.pulse();
      await inClear.next((e) => e.event === 'console' && (e.data.board as Json).over === true);
      await inClear.next(() => false).catch(() => undefined);
      expect(inClear.ended).toBe(true);
      expect((await openSse(base, `/api/admin/live/${r.id}/stream`, { cookies: op.cookies })).status).toBe(204);
    });
  });

  describe('Client Services: the orders', () => {
    it('follows the confirmed reservations as orders, one per piece, narrowed to the release; pays or cancels them there; the LIVE list is retired; a CSV', async () => {
      const r = await create({ inMinutes: 10, perAccount: 2, addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }, { label: '=GIFT BOX', priceMinor: 0 }] });
      await op.post(`/api/admin/live/${r.id}/publish`, {});
      h.clock.advance(6 * MINUTE);
      const a = await customer(5);
      const b = await customer(1);
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0].id, quantity: 2 }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[1].id }, b.actor);
      h.clock.advance(4 * MINUTE);
      await f.live.advance(r.id);
      await secure(a, r.id);
      await secure(b, r.id);
      const addons = (safeJson(await op.get(`/api/admin/live/${r.id}`)) as Json).addons as Json[];
      await f.live.setAddons(a.id, r.id, [addons[0]!.id, addons[1]!.id], a.actor);
      // b's only add-on starts with « = »: its CSV cell starts with it, read as text.
      await f.live.setAddons(b.id, r.id, [addons[1]!.id], b.actor);
      await f.live.confirm(a.id, r.id, a.actor);
      h.clock.advance(SECOND);
      await f.live.confirm(b.id, r.id, b.actor);

      // The LIVE plan's list, its CSV and its resolution are retired.
      for (const [method, url] of [
        ['GET', `/api/admin/live/${r.id}/reservations`],
        ['GET', `/api/admin/live/${r.id}/reservations.csv`],
        ['POST', `/api/admin/live/${r.id}/entries/${r.id}/resolve`],
      ] as const) {
        expect((await op.request(method, url, method === 'POST' ? { body: { resolution: 'CONCLUDED' } } : {})).statusCode, url).toBe(404);
      }

      const ea = (await f.live.entry(a.id, r.id))!;
      const eb = (await f.live.entry(b.id, r.id))!;
      const board = safeJson(await op.get(`/api/admin/orders?dropId=${r.id}`)) as { columns: { status: string; total: number; items: Json[] }[] };
      const reserved = board.columns.find((c) => c.status === 'RESERVED')!;
      expect(reserved.total).toBe(3);
      expect(board.columns.filter((c) => c.status !== 'RESERVED').every((c) => c.total === 0)).toBe(true);
      const cardsOf = (entryId: string) => reserved.items.filter((x) => x.sourceReference === liveReference(entryId));
      expect(cardsOf(ea.id)).toHaveLength(2);
      expect(cardsOf(ea.id)[0]).toMatchObject({ channel: 'LIVE', release: { id: r.id }, account: { email: a.email }, sizeLabel: '52', addons: [{ label: 'ENGRAVING' }, { label: '=GIFT BOX' }] });
      expect(cardsOf(eb.id)).toMatchObject([{ account: { email: b.email }, sizeLabel: '54', addons: [{ label: '=GIFT BOX' }] }]);
      const masked = safeJson(await auditor.get(`/api/admin/orders?dropId=${r.id}`)) as typeof board;
      expect(masked.columns[0]!.items.map((x) => x.account.email)).toContain(`${a.email[0]}***@example.com`);
      expect(JSON.stringify(masked)).not.toContain(a.email);

      // Paid and cancelled on the orders, each step with Client Services' note.
      for (const card of cardsOf(ea.id)) {
        expect((await auditor.post(`/api/admin/orders/${card.id}/transition`, { to: 'PAID' })).statusCode).toBe(403);
        const paid = safeJson(await op.post(`/api/admin/orders/${card.id}/transition`, { to: 'PAID', note: 'Paid by transfer; delivered in Paris.' })) as { order: Json };
        expect(paid.order).toMatchObject({ status: 'PAID', priceMinor: 480_000, currency: 'EUR' });
      }
      const [cb] = cardsOf(eb.id);
      expect(errorOf(await op.post(`/api/admin/orders/${cb!.id}/transition`, { to: 'CANCELLED' })).code).toBe('VALIDATION_FAILED');
      expect((safeJson(await op.post(`/api/admin/orders/${cb!.id}/transition`, { to: 'CANCELLED', note: 'The client withdrew.' })) as { order: Json }).order).toMatchObject({ status: 'CANCELLED' });
      expect(errorOf(await op.post(`/api/admin/orders/${cb!.id}/transition`, { to: 'PAID' })).code).toBe('ORDER_TRANSITION_NOT_ALLOWED');
      // A cancellation gives no piece back to the line.
      expect((await f.live.entry(b.id, r.id))!.status).toBe('CONFIRMED');
      const other = await customer(0);
      await f.live.enter(other.id, r.id, { sizeId: r.sizes[1].id }, other.actor).catch((e) => expect((e as { code: string }).code).toBe('LIVE_SIZE_SOLD_OUT'));
      // The release report reads the outcome from the orders.
      const report = safeJson(await op.get(`/api/admin/live/${r.id}/report`)) as { funnel: { step: string; people: number }[]; cancelled: Json };
      expect(report.funnel.find((x) => x.step === 'CONCLUDED')!.people).toBe(1);
      expect(report.cancelled).toEqual({ reservations: 1, pieces: 1 });

      const csv = await op.get(`/api/admin/orders.csv?dropId=${r.id}`);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8; header=present');
      expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="ORBES-orders-\d{4}-\d{2}-\d{2}\.csv"$/);
      const lines = csv.body.trimEnd().split('\r\n');
      expect(lines).toHaveLength(4);
      const aLine = lines.find((l) => l.includes(liveReference(ea.id)))!;
      expect(aLine).toContain(`"${liveReference(ea.id)}","LIVE","THE MONOLITHE RING","${a.email}"`);
      expect(aLine).toContain('"EUR","4800.00","ENGRAVING (150.00); =GIFT BOX (0.00)"');
      // No formula run: a cell starting with « = » is prefixed with an apostrophe.
      expect(lines.find((l) => l.includes(liveReference(eb.id)))).toContain(`"'=GIFT BOX (0.00)"`);
      const maskedCsv = await auditor.get(`/api/admin/orders.csv?dropId=${r.id}`);
      expect(maskedCsv.body).not.toContain(a.email);
      expect(maskedCsv.body).toContain(`${a.email[0]}***@example.com`);
      expect(createHash('sha256').update(maskedCsv.body).digest('hex')).not.toBe(createHash('sha256').update(csv.body).digest('hex'));
    });
  });

  describe('the post of the circle after the end', () => {
    it('never names, in its post of the circle, a release ended before its name, even once the time set for its name has passed', async () => {
      const r = await create({ inMinutes: 3 * 60, announceAt: iso(10 * MINUTE), nameAt: iso(30 * MINUTE), photoAt: iso(30 * MINUTE), accessModelIds: [f.modelId] });
      const p = safeJson(await op.post(`/api/admin/live/${r.id}/publish`, { circlePost: true })) as Json;
      const { client, email } = await accountClient(h);
      const { id: memberId } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
      await holdPieces(h.ctx.db, memberId, 1, f.modelId);
      const link = async () => ((safeJson(await client.get(`/api/v1/club/circle/${p.circlePosts[0].id}`)) as Json).links as Json).drop;
      h.clock.advance(15 * MINUTE);
      expect(await link()).toEqual({ id: r.id, title: 'LIVE RELEASE' });
      await f.live.end(r.id, f.admin);
      h.clock.advance(30 * MINUTE);
      expect(await link()).toEqual({ id: r.id, title: 'LIVE RELEASE' });
    });
  });
});
