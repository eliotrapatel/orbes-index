/**
 * TEST ENTRANTS over HTTP (routes/admin/test-entrants.ts): the bodies' schemas (strict, bounded, the LIVE shares 100 in
 * all), the answers' shapes (`{ run }`, `{ runs }`, the RUNNING test anywhere), ADMIN for every change, an AUDITOR
 * reading the test entrants' emails masked, and the 404s of an unknown release or test.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPhrase } from '../../src/server/services/test-entrants.js';
import { liveFixtureOn, type LiveFixture } from '../support/live.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';
import { poolDraw } from '../support/draws.js';

const HOUR = 3_600_000;

/** A full body, as the console sends one. */
const body = (dropId: string, over: Record<string, unknown> = {}) => ({
  phrase: testPhrase(dropId),
  tiers: { none: 0, titane: 2, platine: 0, palladium: 1 },
  arrival: { mode: 'burst', seconds: 10, interestPct: 0 },
  behaviour: { payPct: 70, releasePct: 20, missPct: 10, leavePct: 0, holdSeconds: 1.5, withdrawPct: 0, reservePct: 0, confirmPct: 70 },
  choices: { size: null, quantity: null, addOnsPct: 0 },
  profile: { seniorityMin: 0, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 720, countries: [], sharedNetworkPct: 0 },
  ...over,
});

describe('admin: test entrants', () => {
  let h: Harness;
  let f: LiveFixture;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  let dropId: string;

  beforeAll(async () => {
    h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    h.app.testEntrants.useTimers(false);
    f = await liveFixtureOn(h.ctx, h.clock);
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    const now = h.clock.now().getTime();
    const d = await poolDraw(h.ctx.services.drops, h.ctx.db, { modelId: f.modelId, title: 'MONOLITHE · DRAW', quantity: 5, opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR), earlyAccessHours: 0 }, f.admin);
    dropId = d.id;
  });
  afterAll(() => h?.close());

  it('validates the body: strict, the tiers 1 to 1 000, the shares 0 to 100 and LIVE\'s 100 in all, the hold 1.5 to 10 s, the ranges in order, ISO countries', async () => {
    const url = `/api/admin/drops/${dropId}/test-runs`;
    for (const bad of [
      {},
      { ...body(dropId), surprise: true },
      body(dropId, { tiers: { none: 0, titane: 0, platine: 0, palladium: 0 } }),
      body(dropId, { tiers: { none: 0, titane: 1001, platine: 0, palladium: 0 } }),
      body(dropId, { tiers: { none: 0, titane: 600, platine: 401, palladium: 0 } }),
      body(dropId, { tiers: { none: -1, titane: 2, platine: 0, palladium: 0 } }),
      body(dropId, { tiers: { titane: 2 } }),
      body(dropId, { arrival: { mode: 'later', interestPct: 0 } }),
      body(dropId, { arrival: { mode: 'burst', seconds: 3601, interestPct: 0 } }),
      body(dropId, { behaviour: { payPct: 70, releasePct: 20, missPct: 20, leavePct: 0, holdSeconds: 1.5, withdrawPct: 0, reservePct: 0, confirmPct: 70 } }),
      body(dropId, { behaviour: { payPct: 70, releasePct: 20, missPct: 10, leavePct: 0, holdSeconds: 1.4, withdrawPct: 0, reservePct: 0, confirmPct: 70 } }),
      body(dropId, { behaviour: { payPct: 70, releasePct: 20, missPct: 10, leavePct: 0, holdSeconds: 1.5, withdrawPct: 101, reservePct: 0, confirmPct: 70 } }),
      body(dropId, { choices: { size: null, quantity: 6, addOnsPct: 0 } }),
      body(dropId, { profile: { seniorityMin: 4, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 720, countries: [], sharedNetworkPct: 0 } }),
      body(dropId, { profile: { seniorityMin: 0, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 3651, countries: [], sharedNetworkPct: 0 } }),
      body(dropId, { profile: { seniorityMin: 0, seniorityMax: 3, accountAgeDaysMin: 30, accountAgeDaysMax: 720, countries: ['FRA'], sharedNetworkPct: 0 } }),
      { ...body(dropId), phrase: '' },
    ]) {
      const res = await admin.post(url, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    // The phrase is the service's: TEST and the release's first 8 characters.
    const wrong = await admin.post(url, { ...body(dropId), phrase: 'TEST 12345678' });
    expect(wrong.statusCode).toBe(400);
    expect(errorOf(wrong).message).toBe(`Type ${testPhrase(dropId)} to confirm.`);
    expect(errorOf(await admin.post(`/api/admin/test-runs/${randomUUID()}/end`, { phrase: 'END TEST', more: 1 })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await admin.post(`/api/admin/test-runs/${randomUUID()}/stop`, { now: true })).code).toBe('VALIDATION_FAILED');
  });

  it('ADMIN only for the changes; an AUDITOR and an OPERATOR read', async () => {
    for (const c of [operator, auditor]) {
      const res = await c.post(`/api/admin/drops/${dropId}/test-runs`, body(dropId));
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
      expect((await c.get(`/api/admin/drops/${dropId}/test-runs/current`)).statusCode).toBe(200);
      expect((await c.get('/api/admin/test-runs/active')).statusCode).toBe(200);
    }
  });

  it('SEND TEST ENTRANTS answers 201 { run }; current, history and the RUNNING test read it; an AUDITOR reads the emails masked; END TEST', async () => {
    const res = await admin.post(`/api/admin/drops/${dropId}/test-runs`, body(dropId));
    expect(res.statusCode).toBe(201);
    const { run } = safeJson(res) as { run: Record<string, unknown> & { id: string; settings: unknown[]; byTier: unknown[] } };
    expect(Object.keys(run).sort()).toEqual(['byTier', 'createdAt', 'createdBy', 'dropId', 'endedAt', 'entrants', 'errors', 'id', 'mode', 'peaks', 'release', 'report', 'selected', 'settings', 'status'].sort());
    expect(run).toMatchObject({ dropId, mode: 'DRAW', status: 'RUNNING', entrants: 3, endedAt: null, report: null, errors: [] });
    expect(run.byTier).toEqual([
      { tier: 0, label: 'NO TIER', entered: 0, inRoom: 0, selected: 0, confirmed: 0, lapsed: 0, released: 0, missed: 0, left: 0, withdrawn: 0 },
      { tier: 1, label: 'TITANE', entered: 0, inRoom: 0, selected: 0, confirmed: 0, lapsed: 0, released: 0, missed: 0, left: 0, withdrawn: 0 },
      { tier: 2, label: 'PLATINE', entered: 0, inRoom: 0, selected: 0, confirmed: 0, lapsed: 0, released: 0, missed: 0, left: 0, withdrawn: 0 },
      { tier: 3, label: 'PALLADIUM', entered: 0, inRoom: 0, selected: 0, confirmed: 0, lapsed: 0, released: 0, missed: 0, left: 0, withdrawn: 0 },
    ]);
    expect(run.settings).toHaveLength(1);
    expect(run.settings[0]).toMatchObject({ entrants: 3, tiers: { none: 0, titane: 2, platine: 0, palladium: 1 }, arrival: { mode: 'burst', seconds: 10 } });
    // A second test while this one runs: 409; the RUNNING test anywhere.
    expect(errorOf(await admin.post(`/api/admin/drops/${dropId}/test-runs`, body(dropId))).code).toBe('TEST_RUNNING');
    expect(safeJson(await auditor.get('/api/admin/test-runs/active'))).toEqual({ run: { id: run.id, dropId, dropName: 'MONOLITHE · DRAW', mode: 'DRAW', status: 'RUNNING', entrants: 3 } });
    // ADD MORE: the phrase and the tiers, the rest kept.
    const more = await admin.post(`/api/admin/test-runs/${run.id}/add`, { phrase: testPhrase(dropId), tiers: { none: 1, titane: 0, platine: 0, palladium: 0 } });
    expect(more.statusCode).toBe(200);
    expect((safeJson(more) as { run: { entrants: number } }).run.entrants).toBe(4);

    // The bots enter; an early reservation is not in this draw, so nobody holds a place: plant one held, for the list.
    h.clock.advance(11_000);
    for (let i = 0; i < 3; i++) {
      await h.app.testEntrants.tick();
      await h.app.testEntrants.settle();
    }
    const bot = await h.ctx.db.selectFrom('test_run_entrants as r').innerJoin('accounts as a', 'a.id', 'r.account_id').select(['r.account_id', 'a.email']).where('r.run_id', '=', run.id).orderBy('a.email').executeTakeFirstOrThrow();
    const now = h.clock.now();
    await h.ctx.db.updateTable('drop_entries').set({ status: 'SELECTED', tier: 1, seniority: 0, respond_by: new Date(now.getTime() + HOUR) }).where('drop_id', '=', dropId).where('account_id', '=', bot.account_id).execute();
    const inClear = (safeJson(await admin.get(`/api/admin/drops/${dropId}/test-runs/current`)) as { run: { selected: { email: string; canConfirm: boolean }[] } }).run;
    expect(inClear.selected).toEqual([expect.objectContaining({ accountId: bot.account_id, email: bot.email, status: 'SELECTED', canConfirm: true, canRelease: false, orderRef: null })]);
    const masked = (safeJson(await auditor.get(`/api/admin/drops/${dropId}/test-runs/current`)) as { run: { selected: { email: string }[] } }).run;
    expect(masked.selected[0]!.email).not.toBe(bot.email);
    expect(masked.selected[0]!.email).toContain('***');
    // CONFIRM by hand: the staff's Confirm; its order created.
    const confirmed = await admin.post(`/api/admin/test-runs/${run.id}/entrants/${bot.account_id}/confirm`);
    expect(confirmed.statusCode).toBe(200);
    expect((safeJson(confirmed) as { run: { selected: { status: string; orderRef: string | null }[] } }).run.selected[0]).toMatchObject({ status: 'CONFIRMED' });
    expect(errorOf(await admin.post(`/api/admin/test-runs/${run.id}/entrants/${bot.account_id}/release`)).code).toBe('TEST_DRAW_NO_RELEASE');

    // Every bot has entered: DONE, which STOP no longer stops and which blocks nothing; END TEST: ENDED with its report.
    expect((safeJson(await auditor.get(`/api/admin/drops/${dropId}/test-runs/current`)) as { run: { status: string } }).run.status).toBe('DONE');
    expect(errorOf(await admin.post(`/api/admin/test-runs/${run.id}/stop`)).code).toBe('TEST_NOT_RUNNING');
    expect(safeJson(await auditor.get('/api/admin/test-runs/active'))).toEqual({ run: null });
    const ended = await admin.post(`/api/admin/test-runs/${run.id}/end`, { phrase: testPhrase(dropId, true) });
    expect(ended.statusCode).toBe(200);
    expect((safeJson(ended) as { run: { status: string; report: { passed: number; total: number } } }).run).toMatchObject({ status: 'ENDED', report: { passed: 5, total: 5 } });
    expect(safeJson(await auditor.get(`/api/admin/drops/${dropId}/test-runs/current`))).toEqual({ run: null });
    const { runs } = safeJson(await auditor.get(`/api/admin/drops/${dropId}/test-runs`)) as { runs: Record<string, unknown>[] };
    expect(runs).toHaveLength(1);
    expect(Object.keys(runs[0]!).sort()).toEqual(['checksPassed', 'checksTotal', 'createdAt', 'createdBy', 'endedAt', 'entrants', 'id', 'peaks', 'report', 'status'].sort());
    expect(runs[0]).toMatchObject({ id: run.id, status: 'ENDED', entrants: 4, checksPassed: 5, checksTotal: 5 });
    const orders = await h.ctx.db.selectFrom('orders').select('status').where('drop_id', '=', dropId).execute();
    expect(orders.map((o) => o.status)).toEqual(['CANCELLED']);
  });

  it('answers 404 for an unknown release or test', async () => {
    const id = randomUUID();
    expect(errorOf(await auditor.get(`/api/admin/drops/${id}/test-runs/current`)).code).toBe('DROP_NOT_FOUND');
    expect(errorOf(await auditor.get(`/api/admin/drops/${id}/test-runs`)).code).toBe('DROP_NOT_FOUND');
    expect(errorOf(await admin.post(`/api/admin/drops/${id}/test-runs`, body(id))).code).toBe('DROP_NOT_FOUND');
    expect(errorOf(await admin.post(`/api/admin/test-runs/${id}/stop`)).code).toBe('TEST_RUN_NOT_FOUND');
    expect(errorOf(await admin.post(`/api/admin/test-runs/${id}/end`, { phrase: 'END TEST X' })).code).toBe('TEST_RUN_NOT_FOUND');
    expect(errorOf(await admin.post(`/api/admin/test-runs/${id}/add`, body(id))).code).toBe('TEST_RUN_NOT_FOUND');
    expect(errorOf(await admin.post(`/api/admin/test-runs/${id}/entrants/${id}/confirm`)).code).toBe('TEST_RUN_NOT_FOUND');
  });
});
