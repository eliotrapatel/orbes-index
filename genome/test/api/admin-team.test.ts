/**
 * Staff accounts from the console (A-02): the Team routes (ADMIN), the
 * temporary password that must be replaced at the first sign-in (403
 * PASSWORD_CHANGE_REQUIRED), the own password change of every role, and the
 * acting admin's email in the audit log and the anomaly triage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { inLogisticsScope, logisticsScope } from '../../src/server/routes/admin/logistics.js';
import { adminClient, createAdmin, createHarness, errorOf, PASSWORD, safeJson, type Client, type Harness } from './support.js';

interface StaffJson {
  id: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  passwordChangeRequired: boolean;
  locked: boolean;
  disabled: boolean;
  createdAt: string;
  stockLocationIds: string[];
}

async function signIn(h: Harness, email: string, password: string): Promise<Client> {
  const c = h.client();
  const res = await c.post('/api/admin/auth/login', { email, password });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return c;
}

describe('Team: staff accounts (A-02)', () => {
  let h: Harness;
  let boss: Client;
  let bossEmail: string;
  let bossId: string;

  beforeAll(async () => {
    h = await createHarness();
    const creds = await createAdmin(h.ctx, 'ADMIN');
    bossEmail = creds.email;
    bossId = creds.id;
    boss = await signIn(h, creds.email, creds.password);
  });
  afterAll(() => h?.close());

  async function newStaff(role: 'OPERATOR' | 'AUDITOR' = 'OPERATOR'): Promise<{ admin: StaffJson; temporaryPassword: string }> {
    const res = await boss.post('/api/admin/admins', { email: `staff-${Math.random().toString(36).slice(2, 8)}@orbes.test`, role });
    expect(res.statusCode, res.body).toBe(201);
    return safeJson(res) as { admin: StaffJson; temporaryPassword: string };
  }

  it('an ADMIN creates OPERATOR and AUDITOR accounts with a temporary password shown once; never an ADMIN', async () => {
    const { admin, temporaryPassword } = await newStaff('AUDITOR');
    expect(admin).toEqual({ id: expect.any(String), email: expect.stringMatching(/^staff-/), role: 'AUDITOR', totpEnabled: false, passwordChangeRequired: true, locked: false, disabled: false, createdAt: expect.any(String), stockLocationIds: [] });
    expect(temporaryPassword).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    const list = safeJson(await boss.get('/api/admin/admins')) as { items: StaffJson[] };
    expect(list.items.find((a) => a.id === admin.id)).toEqual(admin);
    expect(JSON.stringify(list)).not.toContain(temporaryPassword);

    const asAdmin = await boss.post('/api/admin/admins', { email: 'root2@orbes.test', role: 'ADMIN' });
    expect(asAdmin.statusCode).toBe(400);
    expect(errorOf(asAdmin)).toEqual({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/^role: .*shell/) });
    const taken = await boss.post('/api/admin/admins', { email: admin.email.toUpperCase(), role: 'OPERATOR' });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken).code).toBe('EMAIL_TAKEN');
    for (const body of [{ email: 'x@orbes.test' }, { email: 'not an email', role: 'OPERATOR' }, { email: 'x@orbes.test', role: 'OPERATOR', password: 'chosen by the ADMIN' }]) {
      expect((await boss.post('/api/admin/admins', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const entry = (await h.ctx.audit.list({ action: 'admin.create', targetId: admin.id })).items[0];
    expect(entry).toMatchObject({ actorType: 'admin', actorId: bossId, details: { role: 'AUDITOR', passwordChangeRequired: true } });
    expect(JSON.stringify(entry)).not.toContain(temporaryPassword);
  });

  it('the temporary password opens only sign-out, me and the password change until it is replaced', async () => {
    const { admin, temporaryPassword } = await newStaff('OPERATOR');
    const staff = h.client();
    const login = await staff.post('/api/admin/auth/login', { email: admin.email, password: temporaryPassword });
    expect(login.statusCode).toBe(200);
    expect((safeJson(login) as { admin: StaffJson }).admin.passwordChangeRequired).toBe(true);

    for (const [method, url] of [
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/products'],
      ['POST', '/api/admin/auth/totp/setup'],
      ['POST', '/api/admin/collections'],
    ] as const) {
      const res = await staff.request(method, url, method === 'POST' ? { body: {} } : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorOf(res).code, `${method} ${url}`).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const me = await staff.get('/api/admin/auth/me');
    expect(me.statusCode).toBe(200);
    expect((safeJson(me) as { admin: StaffJson }).admin.passwordChangeRequired).toBe(true);

    // A wrong current password is a 400 (a 401 would sign the console out), and the session lives on.
    const wrong = await staff.post('/api/admin/auth/password', { currentPassword: 'not the temporary one', newPassword: 'workshop passphrase 2026' });
    expect(wrong.statusCode).toBe(400);
    expect(errorOf(wrong).code).toBe('CURRENT_PASSWORD_INVALID');
    expect((await staff.get('/api/admin/auth/me')).statusCode).toBe(200);
    const same = await staff.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: temporaryPassword });
    expect(same.statusCode).toBe(400);
    const short = await staff.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'too short' });
    expect(short.statusCode).toBe(400);
    expect(errorOf(short).code).toBe('VALIDATION_FAILED');

    const other = await signIn(h, admin.email, temporaryPassword);
    const changed = await staff.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'workshop passphrase 2026' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(safeJson(changed)).toEqual({ ok: true, admin: { id: admin.id, email: admin.email, role: 'OPERATOR', totpEnabled: false, passwordChangeRequired: false } });
    expect((await staff.get('/api/admin/dashboard')).statusCode).toBe(200);
    expect((await other.get('/api/admin/auth/me')).statusCode).toBe(401); // every other session ended
    expect((await h.client().post('/api/admin/auth/login', { email: admin.email, password: temporaryPassword })).statusCode).toBe(401);
    expect((await h.client().post('/api/admin/auth/login', { email: admin.email, password: 'workshop passphrase 2026' })).statusCode).toBe(200);
    expect((await staff.post('/api/admin/auth/logout')).statusCode).toBe(200);
  });

  it('every role changes its own password at any time (CSRF-protected; the caller stays signed in)', async () => {
    const creds = await createAdmin(h.ctx, 'AUDITOR');
    const a = await signIn(h, creds.email, creds.password);
    const b = await signIn(h, creds.email, creds.password);
    const body = { currentPassword: PASSWORD, newPassword: 'an auditor passphrase of my own' };
    const noCsrf = await a.post('/api/admin/auth/password', body, { noCsrf: true });
    expect(noCsrf.statusCode).toBe(403);
    expect(errorOf(noCsrf).code).toBe('CSRF_FAILED');
    expect((await a.post('/api/admin/auth/password', body)).statusCode).toBe(200);
    expect((await a.get('/api/admin/auth/me')).statusCode).toBe(200);
    expect((await b.get('/api/admin/auth/me')).statusCode).toBe(401);
    expect((await h.ctx.audit.list({ action: 'admin.password_change', targetId: creds.id })).items[0]).toMatchObject({ actorType: 'admin', actorId: creds.id, details: { sessionsRevoked: 1 } });
    expect((await h.client().post('/api/admin/auth/password', body)).statusCode).toBe(401);
  });

  it('changes a role (OPERATOR or AUDITOR); the new role applies at the next request', async () => {
    const { admin, temporaryPassword } = await newStaff('OPERATOR');
    const staff = await signIn(h, admin.email, temporaryPassword);
    expect((await staff.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'operator passphrase 2026' })).statusCode).toBe(200);
    expect((await staff.post('/api/admin/collections', {})).statusCode).toBe(400); // OPERATOR: past the guard

    const res = await boss.patch(`/api/admin/admins/${admin.id}/role`, { role: 'AUDITOR' });
    expect(res.statusCode).toBe(200);
    expect((safeJson(res) as { admin: StaffJson }).admin).toMatchObject({ id: admin.id, role: 'AUDITOR' });
    const now = await staff.post('/api/admin/collections', {});
    expect(now.statusCode).toBe(403);
    expect(errorOf(now).code).toBe('FORBIDDEN');
    expect((await h.ctx.audit.list({ action: 'admin.role_change', targetId: admin.id })).items[0]).toMatchObject({ actorId: bossId, details: { from: 'OPERATOR', to: 'AUDITOR' } });

    expect((await boss.patch(`/api/admin/admins/${admin.id}/role`, { role: 'ADMIN' })).statusCode).toBe(400);
    expect((await boss.patch(`/api/admin/admins/${admin.id}/role`, { role: 'AUDITOR', extra: 1 })).statusCode).toBe(400);
    const unknown = await boss.patch('/api/admin/admins/00000000-0000-4000-8000-000000000000/role', { role: 'AUDITOR' });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('ADMIN_NOT_FOUND');
  });

  it('disabling a departing account refuses its sign-in and ends its sessions at once; enabling restores it', async () => {
    const creds = await createAdmin(h.ctx, 'OPERATOR');
    const s1 = await signIn(h, creds.email, creds.password);
    const s2 = await signIn(h, creds.email, creds.password);
    const off = await boss.post(`/api/admin/admins/${creds.id}/disable`);
    expect(off.statusCode).toBe(200);
    expect(safeJson(off)).toMatchObject({ admin: { id: creds.id, disabled: true }, sessionsRevoked: 2 });
    expect((await s1.get('/api/admin/auth/me')).statusCode).toBe(401);
    expect((await s2.get('/api/admin/dashboard')).statusCode).toBe(401);
    const refused = await h.client().post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(refused.statusCode).toBe(401);
    expect(errorOf(refused).code).toBe('INVALID_CREDENTIALS');
    expect((await boss.post(`/api/admin/admins/${creds.id}/disable`, { reason: 'x' })).statusCode).toBe(400); // no body fields

    const on = await boss.post(`/api/admin/admins/${creds.id}/enable`, {});
    expect(on.statusCode).toBe(200);
    expect(safeJson(on)).toMatchObject({ admin: { id: creds.id, disabled: false }, sessionsRevoked: 0 });
    expect((await h.client().post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    expect((await h.ctx.audit.list({ action: 'admin.disable', targetId: creds.id })).items[0]).toMatchObject({ actorId: bossId, details: { sessionsRevoked: 2 } });
    expect((await h.ctx.audit.list({ action: 'admin.enable', targetId: creds.id })).total).toBe(1);
  });

  it('unlocks a locked account', async () => {
    const creds = await createAdmin(h.ctx, 'AUDITOR');
    for (let i = 0; i < 10; i++) await h.client().post('/api/admin/auth/login', { email: creds.email, password: `wrong password ${i}` });
    const locked = await h.client().post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked).code).toBe('ACCOUNT_LOCKED');
    expect((safeJson(await boss.get('/api/admin/admins')) as { items: StaffJson[] }).items.find((a) => a.id === creds.id)?.locked).toBe(true);
    const res = await boss.post(`/api/admin/admins/${creds.id}/unlock`);
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ admin: { id: creds.id, locked: false } });
    expect((await h.client().post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    expect((await h.ctx.audit.list({ action: 'admin.unlock', targetId: creds.id })).items[0]).toMatchObject({ actorId: bossId, details: { failedLogins: 10, locked: true } });
  });

  it('lists the sessions of an admin (never a token) and ends them', async () => {
    const creds = await createAdmin(h.ctx, 'OPERATOR');
    const s1 = await signIn(h, creds.email, creds.password);
    h.clock.advance(1000);
    await signIn(h, creds.email, creds.password);
    const list = await boss.get(`/api/admin/admins/${creds.id}/sessions`);
    expect(list.statusCode).toBe(200);
    const items = (safeJson(list) as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(2);
    for (const s of items) {
      expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'expiresAt', 'lastSeenAt', 'mfaPassed', 'userAgent']);
      expect(s).toMatchObject({ current: false, mfaPassed: false, userAgent: expect.stringContaining('Mozilla/5.0') });
    }
    expect(list.body).not.toContain(s1.cookies.get('orbes_admin')!);
    expect(list.body).not.toContain(s1.csrf!);
    // Its own list marks the session making the request.
    const own = (safeJson(await boss.get(`/api/admin/admins/${bossId}/sessions`)) as { items: { current: boolean }[] }).items;
    expect(own.filter((s) => s.current)).toHaveLength(1);

    const end = await boss.request('DELETE', `/api/admin/admins/${creds.id}/sessions`);
    expect(end.statusCode).toBe(200);
    expect(safeJson(end)).toEqual({ sessionsRevoked: 2 });
    expect((await s1.get('/api/admin/auth/me')).statusCode).toBe(401);
    expect((safeJson(await boss.get(`/api/admin/admins/${creds.id}/sessions`)) as { items: unknown[] }).items).toEqual([]);
    expect((await h.ctx.audit.list({ action: 'admin.sessions_revoke', targetId: creds.id })).items[0]).toMatchObject({ actorId: bossId, details: { sessionsRevoked: 2 } });
    expect((await boss.get('/api/admin/admins/00000000-0000-4000-8000-000000000000/sessions')).statusCode).toBe(404);
  });

  it('refuses every action on one\'s own account (409 SELF_ACTION)', async () => {
    for (const [method, url, body] of [
      ['PATCH', `/api/admin/admins/${bossId}/role`, { role: 'OPERATOR' }],
      ['POST', `/api/admin/admins/${bossId}/disable`, {}],
      ['POST', `/api/admin/admins/${bossId}/enable`, {}],
      ['POST', `/api/admin/admins/${bossId}/unlock`, {}],
      ['DELETE', `/api/admin/admins/${bossId}/sessions`, undefined],
    ] as const) {
      const res = await boss.request(method, url, body === undefined ? {} : { body });
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(errorOf(res).code, `${method} ${url}`).toBe('SELF_ACTION');
    }
    expect((await boss.get('/api/admin/auth/me')).statusCode).toBe(200);
  });

  it('names the acting console user by email in the audit log (ids stay in the log itself)', async () => {
    const { admin } = await newStaff('AUDITOR');
    type Entry = { actorType: string; actorId: string; actorEmail: string | null; targetType: string | null; targetEmail: string | null };
    const page = safeJson(await boss.get(`/api/admin/audit?action=admin.create&targetId=${admin.id}`)) as { items: Entry[] };
    expect(page.items[0]).toMatchObject({ actorType: 'admin', actorId: bossId, actorEmail: bossEmail, targetType: 'admin', targetEmail: admin.email });
    const system = safeJson(await boss.get('/api/admin/audit?actorType=system')) as { items: Entry[] };
    expect(system.items.length).toBeGreaterThan(0);
    expect(system.items.every((e) => e.actorEmail === null)).toBe(true);
    // Customers stay ids, as actors and as targets.
    await h.client().post('/api/v1/account/register', { email: 'customer-audit@example.com', password: PASSWORD, firstName: 'Customer', lastName: 'Audit', country: 'FR' });
    const customers = safeJson(await boss.get('/api/admin/audit?actorType=account')) as { items: Entry[] };
    expect(customers.items.length).toBeGreaterThan(0);
    expect(customers.items.every((e) => e.actorEmail === null && e.targetEmail === null)).toBe(true);
    expect(JSON.stringify(customers)).not.toContain('customer-audit@example.com');
    const raw = await h.ctx.db.selectFrom('audit_logs').select(['actor_id', 'details']).where('target_id', '=', admin.id).execute();
    expect(JSON.stringify(raw)).not.toContain(bossEmail);
  });

  it('names who triaged an anomaly last (acknowledged, resolved or dismissed)', async () => {
    const op = await createAdmin(h.ctx, 'OPERATOR');
    const operator = await signIn(h, op.email, op.password);
    await h.ctx.services.anomaly.recordFinding({
      type: 'VALID_SIGNATURE_UNREGISTERED',
      severity: 'CRITICAL',
      weight: 100,
      riskScore: 100,
      productId: null,
      codeId: null,
      at: h.clock.now(),
      details: { packedIdentity: 424242 },
    });
    const before = (safeJson(await boss.get('/api/admin/anomalies?severity=CRITICAL')) as { items: { id: string; actorEmail: string | null }[] }).items;
    const target = before.find((a) => a.actorEmail === null)!;
    expect(target).toBeDefined();
    const ack = await operator.patch(`/api/admin/anomalies/${target.id}`, { status: 'ACKNOWLEDGED' });
    expect(ack.statusCode).toBe(200);
    expect(safeJson(ack)).toMatchObject({ id: target.id, status: 'ACKNOWLEDGED', resolvedBy: null, actorEmail: op.email });
    expect((await boss.patch(`/api/admin/anomalies/${target.id}`, { status: 'RESOLVED', note: 'Test print of an unregistered identity' })).statusCode).toBe(200);
    const after = (safeJson(await boss.get('/api/admin/anomalies?status=RESOLVED')) as { items: { id: string; actorEmail: string | null; resolvedBy: string }[] }).items;
    expect(after.find((a) => a.id === target.id)).toMatchObject({ actorEmail: bossEmail, resolvedBy: `admin:${bossId}` });
  });
});

describe('Team: LOGISTICS logins and their locations (plan NEXT LOT §3.5.6.1)', () => {
  let h: Harness;
  let boss: Client;
  let bossId: string;
  let france: string;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    const creds = await createAdmin(h.ctx, 'ADMIN');
    bossId = creds.id;
    boss = await signIn(h, creds.email, creds.password);
    const locations = await h.ctx.services.stock.locations();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
  });
  afterAll(() => h?.close());

  const email = () => `agent-${Math.random().toString(36).slice(2, 8)}@orbes.test`;
  const create = (body: Record<string, unknown>) => boss.post('/api/admin/admins', { email: email(), role: 'LOGISTICS', ...body });

  it('a LOGISTICS login is created with at least one known location, never another role with locations; audited admin.create with them', async () => {
    for (const body of [{}, { stockLocationIds: [] }]) {
      const res = await create(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res)).toEqual({ code: 'VALIDATION_FAILED', message: 'Choose at least one location.' });
    }
    const unknown = await create({ stockLocationIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('STOCK_LOCATION_NOT_FOUND');
    expect((await create({ stockLocationIds: ['not-a-uuid'] })).statusCode).toBe(400);
    const operator = await boss.post('/api/admin/admins', { email: email(), role: 'OPERATOR', stockLocationIds: [france] });
    expect(operator.statusCode).toBe(400);
    expect(errorOf(operator).message).toBe('Only a LOGISTICS login works at locations.');
    expect(await h.ctx.db.selectFrom('admin_users').select('id').where('role', '=', 'LOGISTICS').execute()).toEqual([]);

    const res = await create({ stockLocationIds: [logistics, france, logistics.toUpperCase()] });
    expect(res.statusCode, res.body).toBe(201);
    const { admin } = safeJson(res) as { admin: StaffJson };
    expect(admin).toMatchObject({ role: 'LOGISTICS', passwordChangeRequired: true, stockLocationIds: [france, logistics].sort() });
    expect((safeJson(await boss.get('/api/admin/admins')) as { items: StaffJson[] }).items.find((a) => a.id === admin.id)?.stockLocationIds).toEqual([france, logistics].sort());
    const tied = await h.ctx.db.selectFrom('admin_user_locations').selectAll().where('admin_user_id', '=', admin.id).orderBy('stock_location_id').execute();
    expect(tied.map((r) => [r.stock_location_id, r.created_by])).toEqual([france, logistics].sort().map((id) => [id, bossId]));
    expect((await h.ctx.audit.list({ action: 'admin.create', targetId: admin.id })).items[0]).toMatchObject({
      actorId: bossId,
      details: { role: 'LOGISTICS', stockLocationIds: [france, logistics].sort(), passwordChangeRequired: true },
    });
    expect(await h.ctx.services.auth.adminLocations(admin.id)).toEqual([france, logistics].sort());
  });

  it('a role changed to LOGISTICS takes its locations; a LOGISTICS login keeping its role has them changed; a role changed away clears them, in one transaction each, audited admin.role_change', async () => {
    const created = safeJson(await boss.post('/api/admin/admins', { email: email(), role: 'OPERATOR' })) as { admin: StaffJson };
    const id = created.admin.id;
    const role = (body: Record<string, unknown>) => boss.patch(`/api/admin/admins/${id}/role`, body);
    const locations = () => h.ctx.services.auth.adminLocations(id);
    const lastChange = async () => (await h.ctx.audit.list({ action: 'admin.role_change', targetId: id })).items[0];

    const none = await role({ role: 'LOGISTICS' });
    expect(none.statusCode).toBe(400);
    expect(errorOf(none).message).toBe('Choose at least one location.');
    expect((await h.ctx.db.selectFrom('admin_users').select('role').where('id', '=', id).executeTakeFirstOrThrow()).role).toBe('OPERATOR');

    const toAgent = await role({ role: 'LOGISTICS', stockLocationIds: [france] });
    expect(toAgent.statusCode, toAgent.body).toBe(200);
    expect((safeJson(toAgent) as { admin: StaffJson }).admin).toMatchObject({ role: 'LOGISTICS', stockLocationIds: [france] });
    expect(await locations()).toEqual([france]);
    expect(await lastChange()).toMatchObject({ actorId: bossId, details: { from: 'OPERATOR', to: 'LOGISTICS', stockLocationIds: [france] } });

    // Same role, other locations: the login's locations change (today's early return on the same role kept for the rest).
    const moved = await role({ role: 'LOGISTICS', stockLocationIds: [logistics, france] });
    expect((safeJson(moved) as { admin: StaffJson }).admin.stockLocationIds).toEqual([france, logistics].sort());
    expect(await lastChange()).toMatchObject({ details: { from: 'LOGISTICS', to: 'LOGISTICS', stockLocationIds: [france, logistics].sort() } });
    const kept = await h.ctx.db.selectFrom('admin_user_locations').select(['stock_location_id', 'created_at']).where('admin_user_id', '=', id).where('stock_location_id', '=', france).executeTakeFirstOrThrow();
    const count = async () => (await h.ctx.audit.list({ action: 'admin.role_change', targetId: id })).items.length;
    const before = await count();
    // The same role and the same locations: nothing changes, nothing is audited.
    expect((await role({ role: 'LOGISTICS', stockLocationIds: [france, logistics] })).statusCode).toBe(200);
    expect(await count()).toBe(before);
    await role({ role: 'LOGISTICS', stockLocationIds: [france] });
    expect(await locations()).toEqual([france]);
    // A location kept is kept as it was (its row, its time).
    expect((await h.ctx.db.selectFrom('admin_user_locations').select('created_at').where('admin_user_id', '=', id).where('stock_location_id', '=', france).executeTakeFirstOrThrow()).created_at).toEqual(kept.created_at);

    // Away from LOGISTICS: its locations are deleted with the change, and none may come with it.
    expect((await role({ role: 'AUDITOR', stockLocationIds: [france] })).statusCode).toBe(400);
    expect(await locations()).toEqual([france]);
    const away = await role({ role: 'AUDITOR' });
    expect((safeJson(away) as { admin: StaffJson }).admin).toMatchObject({ role: 'AUDITOR', stockLocationIds: [] });
    expect(await locations()).toEqual([]);
    expect(await lastChange()).toMatchObject({ details: { from: 'LOGISTICS', to: 'AUDITOR' } });
    expect((await lastChange()).details).not.toHaveProperty('stockLocationIds');
  });

  it('a LOGISTICS login signs in, changes its own password and reads its own profile; the scope of its routes is its own locations', async () => {
    const res = await create({ stockLocationIds: [logistics] });
    const { admin, temporaryPassword } = safeJson(res) as { admin: StaffJson; temporaryPassword: string };
    const agent = await signIn(h, admin.email, temporaryPassword);
    expect((await agent.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'agent passphrase 2026' })).statusCode).toBe(200);
    expect((safeJson(await agent.get('/api/admin/auth/me')) as { admin: { role: string } }).admin.role).toBe('LOGISTICS');
    const scope = async (adminId: string, role: string) =>
      logisticsScope(h.ctx, { orbes: { admin: { admin: { id: adminId, role } } } } as unknown as Parameters<typeof logisticsScope>[1]);
    expect(await scope(admin.id, 'LOGISTICS')).toEqual(new Set([logistics]));
    expect(inLogisticsScope(await scope(admin.id, 'LOGISTICS'), logistics.toUpperCase())).toBe(true);
    expect(inLogisticsScope(await scope(admin.id, 'LOGISTICS'), france)).toBe(false);
    // ORBES staff see every location.
    expect(await scope(bossId, 'ADMIN')).toBeNull();
    expect(inLogisticsScope(null, france)).toBe(true);
  });
});

describe('Team: the last active ADMIN (A-02)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('two ADMINs disabling each other at the same moment cannot leave the console without one', async () => {
    const [a, b] = [await createAdmin(h.ctx, 'ADMIN'), await createAdmin(h.ctx, 'ADMIN')];
    const [ca, cb] = [await signIn(h, a.email, a.password), await signIn(h, b.email, b.password)];
    const [ra, rb] = await Promise.all([ca.post(`/api/admin/admins/${b.id}/disable`), cb.post(`/api/admin/admins/${a.id}/disable`)]);
    const codes = [ra, rb].map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const refused = [ra, rb].find((r) => r.statusCode === 409)!;
    expect(errorOf(refused).code).toBe('LAST_ADMIN');
    const active = (await h.ctx.services.auth.listAdmins()).filter((x) => x.role === 'ADMIN' && !x.disabled);
    expect(active).toHaveLength(1);
  });
});

describe('Team: the forced change before enrolment when MFA is enforced (A-02)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ app: { requireAdminMfa: true } });
  });
  afterAll(() => h?.close());

  it('a new staff member replaces the temporary password, then enrols a second factor', async () => {
    const root = await adminClient(h, 'ADMIN');
    // The ADMIN itself has not enrolled: MFA_REQUIRED before it may create anyone.
    expect(errorOf(await root.post('/api/admin/admins', { email: 'new@orbes.test', role: 'OPERATOR' })).code).toBe('MFA_REQUIRED');
    const { temporaryPassword } = await h.ctx.services.auth.createStaff({ email: 'new@orbes.test', role: 'OPERATOR' }, { type: 'system', id: 'test' });
    const staff = await signIn(h, 'new@orbes.test', temporaryPassword);
    expect(errorOf(await staff.get('/api/admin/dashboard')).code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(errorOf(await staff.post('/api/admin/auth/totp/setup')).code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await staff.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'new staff passphrase 2026' })).statusCode).toBe(200);
    expect(errorOf(await staff.get('/api/admin/dashboard')).code).toBe('MFA_REQUIRED');
    const { secret } = safeJson(await staff.post('/api/admin/auth/totp/setup')) as { secret: string };
    expect((await staff.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), h.clock.now().getTime()) })).statusCode).toBe(200);
    expect((await staff.get('/api/admin/dashboard')).statusCode).toBe(200);
  });

  it('once a second factor is enrolled, a password-only session can no longer change the password; enrolling ends those sessions', async () => {
    const creds = await createAdmin(h.ctx, 'OPERATOR');
    // Two sessions opened with the password alone, before enrolment (say, one of them by whoever learnt the password).
    const owner = await signIn(h, creds.email, creds.password);
    const other = await signIn(h, creds.email, creds.password);
    const { secret } = safeJson(await owner.post('/api/admin/auth/totp/setup')) as { secret: string };
    expect((await owner.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), h.clock.now().getTime()) })).statusCode).toBe(200);
    // The enrolment ended the other one, in the same transaction, audited.
    expect((await other.post('/api/admin/auth/password', { currentPassword: creds.password, newPassword: 'taken over passphrase 2026' })).statusCode).toBe(401);
    const entry = (await h.ctx.audit.list({ action: 'admin.totp.enable', targetId: creds.id })).items[0];
    expect(entry.details).toEqual({ sessionsRevoked: 1 });

    // A password-only session of an enrolled admin (one that survived an enrolment from elsewhere): MFA_REQUIRED.
    const late = await createAdmin(h.ctx, 'AUDITOR');
    const kept = await signIn(h, late.email, late.password);
    const gone = await signIn(h, late.email, late.password);
    const lateSecret = (await h.ctx.services.auth.createTotpEnrollment(late.id)).secret;
    const r = await h.ctx.services.auth.enableTotp(late.id, { secret: lateSecret, code: totp(base32Decode(lateSecret), h.clock.now().getTime()) }, { type: 'system', id: 'test' }, { keepToken: kept.cookies.get('orbes_admin') });
    expect(r).toEqual({ sessionsRevoked: 1 });
    expect((await gone.get('/api/admin/auth/me')).statusCode).toBe(401);
    const refused = await kept.post('/api/admin/auth/password', { currentPassword: late.password, newPassword: 'taken over passphrase 2026' });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe('MFA_REQUIRED');
    // Nothing changed: the password still signs in (with the code now).
    expect((await h.client().post('/api/admin/auth/login', { email: late.email, password: late.password, totp: totp(base32Decode(lateSecret), h.clock.now().getTime() + 30_000) })).statusCode).toBe(200);

    // The session that enrolled passed the factor: its own change still works, and ends no one else's.
    expect((await owner.post('/api/admin/auth/password', { currentPassword: creds.password, newPassword: 'enrolled passphrase 2026' })).statusCode).toBe(200);
  });
});
