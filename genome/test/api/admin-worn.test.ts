/**
 * WORN in the console (plan MACRO M2 §2.2, §2.4 and §2.5, step M2.7; routes/admin/worn.ts): the lists read by an
 * AUDITOR with the owner's email masked (in clear from OPERATOR), the badge, a photograph while live (never stored),
 * PUBLISH, REFUSE and TAKE DOWN by an OPERATOR only (an AUDITOR's 403), a stale review's 409 WORN_STATE, a reason
 * outside the three refused, and each answer never stored.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORN_CONSENT_VERSION } from '../../src/server/services/worn.js';
import { jpegPhoto } from '../support/images.js';
import { createModel, holdPieces } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('WORN in the console (plan MACRO M2 §2.4)', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let modelId = '';

  /** A photograph sent by a new collector, and its owner's email. */
  async function sent(): Promise<{ id: string; email: string }> {
    const { client, email } = await accountClient(h);
    const account = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow();
    const [pid] = await holdPieces(h.ctx.db, account.id, 1, modelId);
    h.clock.advance(60_000);
    const res = await client.request('POST', `/api/v1/account/products/${pid}/worn?consent=${WORN_CONSENT_VERSION}`, { body: Buffer.from(jpegPhoto(40, 30)), headers: { 'content-type': 'image/jpeg' } });
    expect(res.statusCode, res.body).toBe(201);
    return { id: (safeJson(res) as { photo: { id: string } }).photo.id, email };
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-02T10:00:00.000Z');
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    modelId = await createModel(h.ctx.db, 'MONOLITHE');
    await h.ctx.db.updateTable('models').set({ slug: 'monolithe-worn', lookbook: 'PUBLIC', published_at: new Date('2026-01-01T00:00:00Z') }).where('id', '=', modelId).execute();
  });
  afterAll(() => h?.close());

  it('lists TO REVIEW for an AUDITOR with the owner’s email masked, in clear for an OPERATOR, and counts the badge', async () => {
    const a = await sent();
    const b = await sent();
    const list = await auditor.get('/api/admin/worn');
    expect(list.statusCode).toBe(200);
    expect(list.headers['cache-control']).toBe('no-store');
    const page = safeJson(list) as { items: { id: string; owner: { email: string }; photoUrl: string; credit: unknown }[]; total: number };
    expect(page.items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(page.items[0]!.owner.email).toBe(`${a.email[0]}***@example.com`);
    expect(list.body).not.toContain(a.email);
    expect(page.items[0]!.credit).toEqual({ firstName: 'Owner', country: 'France', countryCode: 'FR', instagram: null });
    const clear = safeJson(await operator.get('/api/admin/worn?queue=TO_REVIEW')) as { items: { owner: { email: string } }[] };
    expect(clear.items[0]!.owner.email).toBe(a.email);
    const summary = await auditor.get('/api/admin/worn/summary');
    expect(summary.headers['cache-control']).toBe('no-store');
    expect(safeJson(summary)).toMatchObject({ toReview: 2, published: 0 });
    // The photograph while live, for staff, never stored.
    const photo = await auditor.get(page.items[0]!.photoUrl);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.headers['cache-control']).toBe('no-store');
    const bad = await auditor.get('/api/admin/worn?queue=NOPE');
    expect([bad.statusCode, errorOf(bad).code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('publishes, refuses and takes down by an OPERATOR only; a stale review is 409 WORN_STATE; a reason outside the three is refused', async () => {
    const a = await sent();
    const b = await sent();
    for (const [url, body] of [
      [`/api/admin/worn/${a.id}/publish`, undefined],
      [`/api/admin/worn/${a.id}/refuse`, { refusal: 'QUALITY' }],
    ] as const) {
      const res = await auditor.post(url, body);
      expect([res.statusCode, errorOf(res).code], url).toEqual([403, 'FORBIDDEN']);
    }
    expect((await operator.post(`/api/admin/worn/${a.id}/publish`)).statusCode).toBe(204);
    const again = await operator.post(`/api/admin/worn/${a.id}/publish`);
    expect([again.statusCode, errorOf(again).code]).toEqual([409, 'WORN_STATE']);
    const reason = await operator.post(`/api/admin/worn/${b.id}/refuse`, { refusal: 'UGLY' });
    expect([reason.statusCode, errorOf(reason).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await operator.post(`/api/admin/worn/${b.id}/refuse`, { refusal: 'PIECE_NOT_VISIBLE' })).statusCode).toBe(204);
    expect((await auditor.get(`/api/admin/worn/${b.id}/photo`)).statusCode).toBe(404);
    // PUBLISHED by model, then taken down into ENDED.
    const published = safeJson(await auditor.get(`/api/admin/worn?queue=PUBLISHED&model=${modelId}`)) as { items: { id: string; shown: boolean; reviewedBy: { email: string } }[] };
    expect(published.items.map((i) => [i.id, i.shown])).toEqual([[a.id, true]]);
    expect(published.items[0]!.reviewedBy.email).toMatch(/@/);
    h.clock.advance(60_000);
    expect((await operator.post(`/api/admin/worn/${a.id}/take-down`, { refusal: 'NOT_SUITABLE' })).statusCode).toBe(204);
    const down = await operator.post(`/api/admin/worn/${a.id}/take-down`, { refusal: 'NOT_SUITABLE' });
    expect([down.statusCode, errorOf(down).code]).toEqual([409, 'WORN_STATE']);
    // ENDED: the latest ended first.
    const ended = safeJson(await auditor.get('/api/admin/worn?queue=ENDED')) as { items: { id: string; status: string; refusal: string; photoUrl: string | null }[] };
    expect(ended.items.filter((i) => i.id === a.id || i.id === b.id).map((i) => [i.id, i.status, i.refusal, i.photoUrl])).toEqual([
      [a.id, 'TAKEN_DOWN', 'NOT_SUITABLE', null],
      [b.id, 'REFUSED', 'PIECE_NOT_VISIBLE', null],
    ]);
    const missing = await operator.post('/api/admin/worn/00000000-0000-4000-8000-000000000000/publish');
    expect([missing.statusCode, errorOf(missing).code]).toEqual([404, 'WORN_NOT_FOUND']);
    for (const action of ['worn.publish', 'worn.refuse', 'worn.take_down']) {
      expect((await h.ctx.db.selectFrom('audit_logs').select('actor_type').where('action', '=', action).execute()).map((r) => r.actor_type), action).toContain('admin');
    }
  });
});
