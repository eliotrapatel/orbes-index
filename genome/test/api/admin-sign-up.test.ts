/**
 * The console's Sign-up page's routes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.10 and P.16, step 1.7; API
 * §16.38): the answers to « How did you hear about ORBES? ».
 *
 *  - GET lists every answer, offered or set aside, Other last, with how many counted collectors gave each (test
 *    entrants and the team's own accounts left out); everyone in the console from AUDITOR reads it;
 *  - an ADMIN adds one (last before Other), renames it, sets it aside and offers it again, and reorders every answer but
 *    Other at once; at most 12 offered, Other included; Other always stays offered; a label once, whatever the case;
 *  - each change audited `heard_option.*` with the labels (house words), nothing audited when nothing changed;
 *  - OPERATOR, AUDITOR, RETAIL and LOGISTICS never change them (403).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

interface Answer {
  id: string;
  label: string;
  other: boolean;
  active: boolean;
  position: number;
  given: number;
}

describe('the answers to « How did you hear about ORBES? » (plan CUSTOMER INTELLIGENCE §3.1 P.10)', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    h = await createHarness();
    admin = await adminClient(h, 'ADMIN');
  });
  afterAll(() => h?.close());

  const list = async (c: Client = admin) => (safeJson(await c.get('/api/admin/heard-options')) as { options: Answer[] }).options;
  const labels = (xs: Answer[]) => xs.map((x) => x.label);
  const byLabel = async (label: string) => (await list()).find((x) => x.label === label)!;
  const audits = async (action: string) => (await h.ctx.audit.list({ action })).items;

  it('lists the first boot’s answers in their order, Other last, with how many counted collectors gave each, to every role from AUDITOR', async () => {
    const instagram = (await byLabel('Instagram')).id;
    const other = (await byLabel('Other')).id;
    // Two collectors through the sign-up; a test entrant and a team account with the same answer are left out.
    for (const answer of [{ optionId: instagram }, { optionId: instagram }, { optionId: other, other: 'A pop-up' }]) {
      const res = await h.client().post('/api/v1/account/register', { email: `heard-${randomUUID().slice(0, 8)}@example.com`, password: 'correct horse battery staple', firstName: 'Ada', lastName: 'Lovelace', country: 'FR', heard: answer });
      expect(res.statusCode).toBe(201);
    }
    const entrant = await createAccount(h.ctx.db);
    await h.ctx.db.insertInto('test_entrants').values({ account_id: entrant.id }).execute();
    await h.ctx.db.insertInto('account_profiles').values({ account_id: entrant.id, first_name: 'Test', last_name: 'Entrant', heard_option_id: instagram, heard_at: new Date() }).execute();
    const team = await createAccount(h.ctx.db);
    await h.ctx.db.insertInto('account_profiles').values({ account_id: team.id, first_name: 'Team', last_name: 'Member', heard_option_id: instagram, heard_at: new Date() }).execute();
    await h.ctx.db.insertInto('admin_users').values({ email: team.email, email_normalized: team.email, password_hash: 'scrypt$x', role: 'OPERATOR' }).execute();

    for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) {
      const res = await (await adminClient(h, role)).get('/api/admin/heard-options');
      expect(res.statusCode, role).toBe(200);
      const options = (safeJson(res) as { options: Answer[] }).options;
      expect(labels(options)).toEqual(['Instagram', 'TikTok', 'A friend', 'The press', 'A shop', 'A web search', 'An influencer', 'Other']);
      expect(options.map((x) => [x.other, x.active, x.position])).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((p) => [p === 8, true, p]));
      expect(options.find((x) => x.label === 'Instagram')!.given).toBe(2);
      expect(options.find((x) => x.label === 'Other')!.given).toBe(1);
      expect(options.find((x) => x.label === 'TikTok')!.given).toBe(0);
    }
  });

  it('adds an answer last before Other (201), refuses a label taken whatever the case, an empty or a too long one, and audits it with its label', async () => {
    const res = await admin.post('/api/admin/heard-options', { label: '  A podcast ' });
    expect(res.statusCode).toBe(201);
    const options = (safeJson(res) as { options: Answer[] }).options;
    expect(labels(options).slice(-2)).toEqual(['A podcast', 'Other']);
    expect(options.map((x) => x.position)).toEqual(options.map((_, i) => i + 1));
    const created = options.find((x) => x.label === 'A podcast')!;
    expect(await audits('heard_option.create')).toEqual([expect.objectContaining({ actorType: 'admin', targetType: 'heard_option', targetId: created.id, details: { label: 'A podcast' } })]);
    for (const [label, code, message] of [
      ['a PODCAST', 'HEARD_LABEL_TAKEN', 'This answer exists already.'],
      ['   ', 'VALIDATION_FAILED', 'Enter the answer.'],
      ['x'.repeat(41), 'VALIDATION_FAILED', 'An answer is 40 characters at most.'],
      ['<b>', 'VALIDATION_FAILED', 'The answer contains characters that cannot be kept.'],
    ] as const) {
      const bad = await admin.post('/api/admin/heard-options', { label });
      expect(bad.statusCode, label).toBe(code === 'HEARD_LABEL_TAKEN' ? 409 : 400);
      expect(errorOf(bad)).toEqual({ code, message });
    }
    expect(errorOf(await admin.post('/api/admin/heard-options', { label: 'X', active: true })).code).toBe('VALIDATION_FAILED');
  });

  it('renames, sets aside and offers again; Other is never set aside; nothing changed, nothing audited', async () => {
    const press = await byLabel('The press');
    const renamed = await admin.patch(`/api/admin/heard-options/${press.id}`, { label: 'The press and magazines' });
    expect(renamed.statusCode).toBe(200);
    expect((safeJson(renamed) as { options: Answer[] }).options.find((x) => x.id === press.id)).toMatchObject({ label: 'The press and magazines', active: true });
    const aside = await admin.patch(`/api/admin/heard-options/${press.id}`, { active: false });
    expect((safeJson(aside) as { options: Answer[] }).options.find((x) => x.id === press.id)).toMatchObject({ active: false });
    // Set aside: no longer offered at sign-up, still listed here.
    expect((safeJson(await h.client().get('/api/v1/account/sign-up')) as { heard: { id: string }[] }).heard.map((x) => x.id)).not.toContain(press.id);
    await admin.patch(`/api/admin/heard-options/${press.id}`, { active: true });
    expect((await byLabel('The press and magazines')).active).toBe(true);
    const updates = await audits('heard_option.update');
    // The audit log lists the newest first.
    expect(updates.map((e) => e.details).reverse()).toEqual([
      { before: { label: 'The press', active: true }, after: { label: 'The press and magazines', active: true } },
      { before: { label: 'The press and magazines', active: true }, after: { label: 'The press and magazines', active: false } },
      { before: { label: 'The press and magazines', active: false }, after: { label: 'The press and magazines', active: true } },
    ]);
    // The same label again, or nothing at all: no change, no entry.
    expect((await admin.patch(`/api/admin/heard-options/${press.id}`, { label: 'The press and magazines' })).statusCode).toBe(200);
    expect((await admin.patch(`/api/admin/heard-options/${press.id}`, {})).statusCode).toBe(200);
    expect(await audits('heard_option.update')).toHaveLength(3);
    const other = await byLabel('Other');
    const stays = await admin.patch(`/api/admin/heard-options/${other.id}`, { active: false });
    expect(stays.statusCode).toBe(409);
    expect(errorOf(stays)).toEqual({ code: 'HEARD_OTHER_STAYS', message: 'Other stays offered.' });
    expect((await admin.patch(`/api/admin/heard-options/${other.id}`, { label: 'Something else' })).statusCode).toBe(200);
    expect((await byLabel('Something else')).other).toBe(true);
    await admin.patch(`/api/admin/heard-options/${other.id}`, { label: 'Other' });
    const taken = await admin.patch(`/api/admin/heard-options/${press.id}`, { label: 'instagram' });
    expect(errorOf(taken)).toEqual({ code: 'HEARD_LABEL_TAKEN', message: 'This answer exists already.' });
    const unknown = await admin.patch(`/api/admin/heard-options/${randomUUID()}`, { active: false });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('HEARD_OPTION_NOT_FOUND');
  });

  it('offers 12 answers at most, Other included: adding or offering again a thirteenth is refused', async () => {
    // 9 offered now (8 presets and A podcast): three more reach 12.
    for (const label of ['A newsletter', 'A store window', 'A gift']) expect((await admin.post('/api/admin/heard-options', { label })).statusCode).toBe(201);
    expect((await list()).filter((x) => x.active)).toHaveLength(12);
    const limit = await admin.post('/api/admin/heard-options', { label: 'A thirteenth' });
    expect(limit.statusCode).toBe(409);
    expect(errorOf(limit)).toEqual({ code: 'HEARD_LIMIT', message: 'At most 12 answers are offered at once. Set one aside first.' });
    const gift = await byLabel('A gift');
    await admin.patch(`/api/admin/heard-options/${gift.id}`, { active: false });
    expect((await admin.post('/api/admin/heard-options', { label: 'A thirteenth' })).statusCode).toBe(201);
    const again = await admin.patch(`/api/admin/heard-options/${gift.id}`, { active: true });
    expect(errorOf(again).code).toBe('HEARD_LIMIT');
  });

  it('reorders every answer but Other at once, Other last; a partial order, a duplicate or Other itself is refused; audited with the labels', async () => {
    const before = await list();
    const others = before.filter((x) => !x.other);
    const reversed = [...others].reverse().map((x) => x.id);
    const res = await admin.request('PUT', '/api/admin/heard-options/order', { body: { ids: reversed } });
    expect(res.statusCode).toBe(200);
    const after = (safeJson(res) as { options: Answer[] }).options;
    expect(after.map((x) => x.id)).toEqual([...reversed, before.find((x) => x.other)!.id]);
    expect(after.map((x) => x.position)).toEqual(after.map((_, i) => i + 1));
    expect((await audits('heard_option.order')).map((e) => e.details)).toEqual([{ labels: [...others].reverse().map((x) => x.label) }]);
    // The same order again: no change, no entry.
    expect((await admin.request('PUT', '/api/admin/heard-options/order', { body: { ids: reversed } })).statusCode).toBe(200);
    expect(await audits('heard_option.order')).toHaveLength(1);
    const otherId = before.find((x) => x.other)!.id;
    for (const ids of [reversed.slice(1), [...reversed, reversed[0]], [...reversed, otherId], [...reversed.slice(1), randomUUID()], ['not-an-id']]) {
      const bad = await admin.request('PUT', '/api/admin/heard-options/order', { body: { ids } });
      expect(bad.statusCode).toBe(400);
      expect(errorOf(bad)).toEqual({ code: 'VALIDATION_FAILED', message: 'Reorder every answer at once.' });
    }
  });

  it('lets only an ADMIN change the answers: OPERATOR, AUDITOR, RETAIL and LOGISTICS get 403; a collector’s session is not a console one', async () => {
    const id = (await byLabel('TikTok')).id;
    for (const role of ['OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const) {
      const c = await adminClient(h, role);
      for (const res of [
        await c.post('/api/admin/heard-options', { label: 'Refused' }),
        await c.patch(`/api/admin/heard-options/${id}`, { active: false }),
        await c.request('PUT', '/api/admin/heard-options/order', { body: { ids: [id] } }),
      ]) {
        expect(res.statusCode, role).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
      if (role === 'RETAIL' || role === 'LOGISTICS') expect((await c.get('/api/admin/heard-options')).statusCode, role).toBe(403);
    }
    const collector = await accountClient(h);
    expect((await collector.client.get('/api/admin/heard-options')).statusCode).toBe(401);
    expect((await byLabel('TikTok')).active).toBe(true);
  });

});
