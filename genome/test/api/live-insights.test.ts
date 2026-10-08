/**
 * The console's intelligence on the LIVE RELEASES over HTTP (step L6: routes/admin/live.ts, services/live-insights.ts):
 * a release run from its room to its close, every reading read at its moment by an AUDITOR (the emails masked) and an
 * OPERATOR (in clear): the planner, the audience forecast and the demand radar before T0; the bot radar; the live board
 * and the console's stream carrying the live alerts (the line stalled while the engine stops) and the live sell-out
 * forecast; the release report and its CSV, the collector insights and the release comparison once it is over; 404 for a
 * draw or an unknown release. The figures themselves are test/services/live-insights.test.ts's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveNetworkHash } from '../../src/server/services/live.js';
import { LIVE_ROOM_CAPACITY } from '../../src/server/services/live-insights.js';
import { createAccount, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { openSse } from '../support/sse.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';
import { poolDraw } from '../support/draws.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const START = '2026-11-16T09:00:00.000Z';

type Json = Record<string, any>;

describe('LIVE RELEASES: the console’s intelligence over HTTP', () => {
  let h: Harness;
  let f: LiveFixture;
  let base: string;
  let op: Client;
  let auditor: Client;

  const iso = (ms: number) => new Date(h.clock.now().getTime() + ms).toISOString();
  const read = async (c: Client, path: string): Promise<Json> => {
    const res = await c.get(path);
    expect(res.statusCode, `${path} ${res.body}`).toBe(200);
    return safeJson(res) as Json;
  };
  const masked = (email: string) => `${email[0]}***@example.com`;

  beforeAll(async () => {
    h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    h.clock.set(START);
    f = await liveFixtureOn(h.ctx, h.clock);
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(h.app.server.address() as { port: number }).port}`;
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  it('reads every reading at its moment, its reasoning with it, the emails masked for an AUDITOR', async () => {
    const created = await op.post('/api/admin/live', {
      modelId: f.modelId,
      title: 'THE MONOLITHE RING',
      opensAt: iso(10 * MINUTE),
      closesAt: iso(70 * MINUTE),
      priceMinor: 480_000,
      quantityLine: '2 PIECES · NEVER MORE',
      sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const r = safeJson(created) as Json;
    const [s52, s54] = r.sizes as Json[];

    // Before the announcement: the planner and the forecast read the eligible accounts.
    const plan = await read(auditor, `/api/admin/live/${r.id}/plan`);
    expect(plan).toMatchObject({ modelType: 'RING', sizes: [{ label: '52' }, { label: '54' }] });
    expect(plan.reasoning.length).toBeGreaterThan(1);
    const forecast = await read(auditor, `/api/admin/live/${r.id}/forecast`);
    expect(forecast).toMatchObject({ capacity: LIVE_ROOM_CAPACITY.inRoom, aboveCapacity: false });
    expect(forecast).not.toHaveProperty('capacityProvisional');
    expect(forecast.reasoning.join(' ')).toContain('in the room the load test measured the server to hold');

    expect((await op.post(`/api/admin/live/${r.id}/publish`, {})).statusCode).toBe(200);
    h.clock.advance(6 * MINUTE);
    const people = [];
    for (let i = 0; i < 4; i++) {
      const a = await createAccount(h.ctx.db);
      await holdPieces(h.ctx.db, a.id, 1, f.modelId);
      people.push(a);
    }
    // Three from one network, the first a new account; the last on its own.
    await h.ctx.db.updateTable('accounts').set({ created_at: new Date(h.clock.now().getTime() - 2 * 3_600_000) }).where('id', '=', people[0]!.id).execute();
    for (const [i, a] of people.entries()) {
      const ip = i < 3 ? `203.0.113.${20 + i}` : '198.51.100.9';
      await f.live.enter(a.id, r.id, { sizeId: (i % 2 ? s54 : s52)!.id }, a.actor, { networkHash: liveNetworkHash(h.ctx.config.ipHashPepper, ip), country: i < 2 ? 'FR' : null });
    }

    const radar = await read(auditor, `/api/admin/live/${r.id}/radar`);
    expect(radar).toMatchObject({ roomOpen: true, formed: false, inRoom: 4, quantityLine: '2 PIECES · NEVER MORE' });
    expect(radar.sizes.map((s: Json) => [s.label, s.demand, s.addPieces])).toEqual([
      ['52', 2, 1],
      ['54', 2, 1],
    ]);
    expect(radar.reasoning.join(' ')).toContain('The announcement says « 2 PIECES · NEVER MORE »');

    const bots = await read(auditor, `/api/admin/live/${r.id}/bots`);
    expect(bots).toMatchObject({ entries: 4, flagged: 3, bySign: { NEW_ACCOUNT: 1, NETWORK: 3 } });
    expect(bots.items[0]).toMatchObject({ accountId: people[0]!.id, email: masked(people[0]!.email), signs: ['NEW_ACCOUNT', 'NETWORK'], open: true });
    expect((await read(op, `/api/admin/live/${r.id}/bots`)).items[0].email).toBe(people[0]!.email);

    // T0: the line forms, a turn in each size; then the engine stops and both turns run out.
    h.clock.advance(4 * MINUTE);
    await f.live.advance(r.id);
    const started = (await read(op, `/api/admin/live/${r.id}/board`)).board;
    expect(started.alerts).toEqual([]);
    expect(started.sellOut).toMatchObject({ outlook: 'NO_PACE', sizes: [{ size: { label: '52' } }, { size: { label: '54' } }] });
    h.clock.advance(41 * SECOND);
    const stalled = (await read(auditor, `/api/admin/live/${r.id}/board`)).board;
    expect(stalled.alerts.map((a: Json) => [a.kind, a.size.label])).toEqual([
      ['LINE_STALLED', '52'],
      ['LINE_STALLED', '54'],
    ]);
    expect(stalled.alerts[0].reasoning[1]).toContain('The engine gives a due turn within a second');
    // The console's stream carries them too.
    const stream = await openSse(base, `/api/admin/live/${r.id}/stream`, { cookies: auditor.cookies });
    expect(stream.status).toBe(200);
    const event = await stream.next((e) => e.event === 'console');
    expect(((event.data.board as Json).alerts as Json[]).map((a) => a.kind)).toEqual(['LINE_STALLED', 'LINE_STALLED']);
    stream.close();

    // The engine runs again: the next in each line has its turn; one secures and pays, the sales close.
    await f.live.advance(r.id);
    expect((await read(op, `/api/admin/live/${r.id}/board`)).board.alerts).toEqual([]);
    // In 52 the second of the line (by the seed) has its turn now.
    const in52 = [people[0]!, people[2]!];
    const views = await Promise.all(in52.map((p) => f.live.entry(p.id, r.id)));
    const i = views.findIndex((v) => v!.status === 'TURN');
    expect(views[1 - i]!.status).toBe('MISSED');
    const buyer = in52[i]!;
    const turn = views[i]!;
    await f.live.press(buyer.id, r.id, turn.turn!.token!);
    h.clock.advance(1500);
    await f.live.secure(buyer.id, r.id, turn.turn!.token!, buyer.actor);
    await f.live.confirm(buyer.id, r.id, buyer.actor);
    const sold = (await read(op, `/api/admin/live/${r.id}/board`)).board;
    expect(sold.alerts.map((a: Json) => [a.kind, a.size?.label])).toEqual([['SIZE_SOLD_OUT', '52']]);
    h.clock.set(new Date(Date.parse(r.closesAt) + 31 * SECOND));
    await f.live.advance(r.id);

    const report = await read(auditor, `/api/admin/live/${r.id}/report`);
    expect(report).toMatchObject({ final: true, endedReason: 'CLOSED', quantityLine: '2 PIECES · NEVER MORE' });
    expect(report.funnel.map((s: Json) => [s.step, s.people])).toEqual([
      ['INTEREST', 0],
      ['ROOM', 4],
      ['TURN', 4],
      ['SECURED', 1],
      ['CONFIRMED', 1],
      ['CONCLUDED', 0],
    ]);
    expect(JSON.stringify(report)).not.toContain('@');
    const csv = await auditor.get(`/api/admin/live/${r.id}/report.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="ORBES-live-[0-9A-F]{8}-report-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(csv.body).toContain('"funnel","confirmed","1"');

    const collectors = await read(auditor, `/api/admin/live/${r.id}/collectors`);
    expect(collectors.byCountry.map((c: Json) => [c.country, c.entered])).toEqual([
      ['FR', 2],
      [null, 2],
    ]);
    expect(collectors.unsecured.total).toBe(3);
    expect(collectors.unsecured.items.every((x: Json) => /^.\*\*\*@example\.com$/.test(x.email))).toBe(true);
    expect((await read(op, `/api/admin/live/${r.id}/collectors`)).unsecured.items.map((x: Json) => x.email).sort()).toEqual(
      people.filter((p) => p.id !== buyer.id).map((p) => p.email).sort(),
    );

    const comparison = await read(auditor, `/api/admin/live/${r.id}/comparison`);
    expect(comparison.releases.find((x: Json) => x.current)).toMatchObject({ id: r.id, stock: 2, room: 4, confirmedPieces: 1, sellThrough: 0.5 });
  });

  it('answers 404 for an unknown release and for a draw', async () => {
    const draw = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'A DRAW', quantity: 3, opensAt: new Date(h.clock.now().getTime() + 3_600_000), closesAt: new Date(h.clock.now().getTime() + 7_200_000), earlyAccessHours: 0 }, f.admin, { publish: false });
    for (const id of ['00000000-0000-4000-8000-000000000000', draw.id]) {
      for (const path of ['plan', 'forecast', 'radar', 'bots', 'report', 'report.csv', 'collectors', 'comparison']) {
        const res = await auditor.get(`/api/admin/live/${id}/${path}`);
        expect([path, res.statusCode, errorOf(res).code]).toEqual([path, 404, 'DROP_NOT_FOUND']);
      }
    }
  });
});
