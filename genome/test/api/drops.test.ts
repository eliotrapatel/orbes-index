/**
 * The drops (P-R03): a model released in a limited number of pieces, on a
 * waiting list, drawn by tier.
 *
 *  - the tiers of the club (services/club.ts `tierOf`): the pieces held now,
 *    never a revoked, flagged or retired one, against the code's thresholds
 *    1 / 3 / 5, and the full years since the account's first ownership;
 *  - the console (/api/admin/drops): a DRAFT with its seed drawn, sealed and
 *    committed at creation, edited freely, then only its description once
 *    published; cancelled before its draw only; the draw (ADMIN) after
 *    `closes_at`, once; CONFIRMED, LAPSED after `respond_by` only, OFFER NEXT
 *    while places are left, all under the drop's lock; the customers' emails
 *    masked for an AUDITOR;
 *  - the public pages (/api/v1/drops): never a DRAFT, the seed's SHA-256 from
 *    the publication, the seed once drawn, and the entries by rank with their
 *    tier and seniority, never their accounts; no route returns the seed
 *    before the draw;
 *  - ENTER and WITHDRAW (/api/v1/club/drops/:id/…): any ORBES account,
 *    signed in, its CSRF token sent; the same row again after a withdrawal;
 *    both refused once drawn; the club's status (no-store) with the account's
 *    tier and its entries, its own entry's id among them;
 *  - the draw's rule, checked from what the page publishes: the tier and
 *    seniority read at the draw (pieces given away or received between the
 *    entry and the draw count as they stand then), then
 *    sha256(seed ‖ the entry's id) in hexadecimal; every entry SELECTED when
 *    there are fewer than places;
 *  - a lock withdraws the account's open entries (audited), and the
 *    right-of-access export lists every entry;
 *  - the early access (P-X02): 48 hours by default, 0 to 336, set while a
 *    DRAFT; during it an account PLATINE or PALLADIUM at the moment of its
 *    request reserves a place at once (SELECTED, held, no rank), first come,
 *    first served under the drop's lock, within the pieces; refused outside
 *    it, below PLATINE, twice; once the pieces are held the drop is full;
 *    the draw then gives only the places left.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { CLUB_TIER_THRESHOLDS, fullYears, tierForPieces, tierOf } from '../../src/server/services/club.js';
import { deriveDropSeedKey, drawKey, drawOrder, DropService } from '../../src/server/services/drops.js';
import { testConfig } from '../../src/server/config.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, issue, PASSWORD, safeJson, scanToReceive, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const HOUR = 3_600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface AdminDropJson {
  id: string;
  title: string;
  description: string | null;
  model: { id: string; name: string; type: string; active: boolean };
  quantity: number;
  opensAt: string;
  closesAt: string;
  purchaseWindowHours: number;
  earlyAccessHours: number;
  earlyAccessOpensAt: string | null;
  state: string;
  publishedAt: string | null;
  cancelledAt: string | null;
  drawnAt: string | null;
  seedHash: string;
  seed: string | null;
  entries: Record<string, number>;
  reserved: number;
}

interface EntryJson {
  id: string;
  dropId: string;
  title: string;
  state: string;
  status: string;
  enteredAt: string;
  rank: number | null;
  respondBy: string | null;
  reserved: boolean;
}

interface AdminEntryJson {
  id: string;
  accountId: string;
  email: string;
  status: string;
  tier: number | null;
  seniority: number | null;
  rank: number | null;
  respondBy: string | null;
  reserved: boolean;
  handledBy: { id: string; email: string } | null;
  handledAt: string | null;
  note: string | null;
}

interface SheetJson {
  id: string;
  title: string;
  state: string;
  model: { name: string; type: string; collection: string | null; imageUrl: string | null; lookbook: string | null };
  quantity: number;
  opensAt: string;
  closesAt: string;
  description: string | null;
  purchaseWindowHours: number;
  seedHash: string;
  seed: string | null;
  drawnAt: string | null;
  entries: number | null;
  earlyAccessHours: number;
  earlyAccessOpensAt: string | null;
  earlyAccessOpen: boolean;
  reserved: number;
}

describe('the club tiers (P-R03): pieces held now, thresholds of the code, full years', () => {
  it('reaches TITANE with 1 piece, PLATINE with 3, PALLADIUM with 5: a constant of the code', () => {
    expect([...CLUB_TIER_THRESHOLDS]).toEqual([1, 3, 5]);
    expect([0, 1, 2, 3, 4, 5, 9].map(tierForPieces)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('counts full years in UTC, the day before an anniversary still the year before', () => {
    const from = new Date('2024-03-10T12:00:00Z');
    expect(fullYears(from, new Date('2025-03-10T11:59:59Z'))).toBe(0);
    expect(fullYears(from, new Date('2025-03-10T12:00:00Z'))).toBe(1);
    expect(fullYears(from, new Date('2027-03-09T00:00:00Z'))).toBe(2);
    expect(fullYears(from, from)).toBe(0);
    expect(fullYears(from, new Date('2020-01-01T00:00:00Z'))).toBe(0);
    // 29 February: the anniversary of a year without one is 1 March.
    expect(fullYears(new Date('2024-02-29T00:00:00Z'), new Date('2025-02-28T23:59:59Z'))).toBe(0);
    expect(fullYears(new Date('2024-02-29T00:00:00Z'), new Date('2025-03-01T00:00:00Z'))).toBe(1);
  });

  it('orders a draw by tier, then seniority, then sha256(seed ‖ id in lower-case ASCII) in hexadecimal, then id', () => {
    const seed = new Uint8Array(32).map((_, i) => i);
    const ids = ['8a1d0c55-0000-4000-8000-000000000001', '8A1D0C55-0000-4000-8000-000000000002', '8a1d0c55-0000-4000-8000-000000000003', '8a1d0c55-0000-4000-8000-000000000004'];
    expect(drawKey(seed, ids[1]!)).toBe(createHash('sha256').update(Buffer.concat([Buffer.from(seed), Buffer.from(ids[1]!.toLowerCase(), 'ascii')])).digest('hex'));
    const order = drawOrder(
      [
        { id: ids[0]!, tier: 1, seniority: 0 },
        { id: ids[1]!, tier: 3, seniority: 0 },
        { id: ids[2]!, tier: 1, seniority: 2 },
        { id: ids[3]!, tier: 1, seniority: 0 },
      ],
      seed,
    );
    const lower = (i: number) => ids[i]!.toLowerCase();
    // PALLADIUM first, then the seniority, then the two TITANE of 0 years by their keys.
    const keyed = [lower(0), lower(3)].sort((a, b) => (drawKey(seed, a) < drawKey(seed, b) ? -1 : 1));
    expect(order.map((e) => [e.id, e.rank])).toEqual([
      [lower(1), 1],
      [lower(2), 2],
      [keyed[0], 3],
      [keyed[1], 4],
    ]);
    expect(() => drawOrder([], new Uint8Array(31))).toThrow(RangeError);
  });
});

describe('drops on a waiting list, drawn by tier (P-R03)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let admin: Client;

  const adminUrl = (id = '') => `/api/admin/drops${id ? `/${id}` : ''}`;
  const audits = (action: string, targetId?: string) =>
    h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', action).$if(targetId !== undefined, (q) => q.where('target_id', '=', targetId!)).orderBy('id').execute();
  const accountIdOf = async (email: string) =>
    (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
  const at = (offsetMs: number) => new Date(h.clock.now().getTime() + offsetMs).toISOString();

  /** Fresh console clients (a console session lasts 8 hours; the tests move the clock by days). */
  async function staff(): Promise<void> {
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
  }

  /** A piece registered to the customer behind `c`, through a scan and its registration token. */
  async function ownedPiece(c: Client): Promise<IssueResult> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return p;
  }

  /** A DRAFT opening in `opensIn` ms for `hours` hours. */
  async function draft(body: Partial<Record<string, unknown>> = {}, opensIn = HOUR, hours = 2): Promise<AdminDropJson> {
    const res = await operator.post(adminUrl(), {
      modelId: catalog.modelId,
      title: 'MONOLITHE — the first release',
      quantity: 2,
      opensAt: at(opensIn),
      closesAt: at(opensIn + hours * HOUR),
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return safeJson(res) as AdminDropJson;
  }

  const publish = async (id: string) => {
    const res = await operator.post(`${adminUrl(id)}/publish`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as AdminDropJson;
  };
  const enter = (c: Client, id: string) => c.post(`/api/v1/club/drops/${id}/enter`);
  const withdraw = (c: Client, id: string) => c.post(`/api/v1/club/drops/${id}/withdraw`);
  const status = async (c: Client) => {
    const res = await c.get('/api/v1/club/status');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    return safeJson(res) as { tier: { level: number; name: string | null }; pieces: number; seniority: number; entries: EntryJson[] };
  };
  const sheet = async (id: string) => {
    const res = await h.client().get(`/api/v1/drops/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as SheetJson;
  };
  const adminEntries = async (c: Client, id: string, query = '') => {
    const res = await c.get(`${adminUrl(id)}/entries${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as { items: AdminEntryJson[]; total: number };
  };

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    await staff();
  });
  afterAll(() => h?.close());

  it('reads the tier of an account from the pieces it holds now: never a revoked, flagged or retired one, never pieces it gave away', async () => {
    const { client, email } = await accountClient(h);
    const id = await accountIdOf(email);
    expect(await tierOf(h.ctx.db, id, h.clock.now())).toEqual({ pieces: 0, tier: 0, seniority: 0 });
    expect(await status(client)).toMatchObject({ tier: { level: 0, name: null }, pieces: 0, seniority: 0, entries: [] });
    const pieces: IssueResult[] = [];
    for (let i = 0; i < 5; i++) pieces.push(await ownedPiece(client));
    expect(await status(client)).toMatchObject({ tier: { level: 3, name: 'PALLADIUM' }, pieces: 5 });
    // Revoked, flagged or retired by ORBES: the ownership stays open, the piece no longer counts.
    await h.ctx.services.lifecycle.transition(pieces[0]!.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    await h.ctx.services.lifecycle.transition(pieces[1]!.product.productId, 'RETIRED', { reason: 'test' }, SYSTEM_ACTOR);
    expect(await status(client)).toMatchObject({ tier: { level: 2, name: 'PLATINE' }, pieces: 3 });
    // A piece given away by a transfer leaves the count.
    const offer = safeJson(await client.post('/api/v1/ownership/transfers', { productId: pieces[2]!.product.productId })) as { transferCode: string };
    const recipient = (await accountClient(h)).client;
    expect((await recipient.post('/api/v1/ownership/transfers/accept', await scanToReceive(recipient, pieces[2]!.code.data, offer.transferCode))).statusCode).toBe(200);
    expect(await status(client)).toMatchObject({ tier: { level: 1, name: 'TITANE' }, pieces: 2 });
    expect(await status(recipient)).toMatchObject({ tier: { level: 1, name: 'TITANE' }, pieces: 1, seniority: 0 });
    // Seniority: full years since the first ownership of the account began, ended or not.
    await h.ctx.db
      .updateTable('ownership')
      .set({ started_at: new Date(h.clock.now().getTime() - (2 * 366 + 1) * 24 * HOUR) })
      .where('product_id', '=', pieces[2]!.product.id)
      .where('account_id', '=', id)
      .execute();
    expect((await status(client)).seniority).toBe(2);
    // Signed out: 401, as every route of the club.
    expect((await h.client().get('/api/v1/club/status')).statusCode).toBe(401);
  });

  it('creates a DRAFT with its seed committed, edits it freely, and publishes it; then only its description changes', async () => {
    // Refused before anything is written: a window that closes first, no piece, an unknown or inactive model.
    const bad = async (body: Record<string, unknown>, status = 400, code = 'VALIDATION_FAILED') => {
      const res = await operator.post(adminUrl(), { modelId: catalog.modelId, title: 'X', quantity: 1, opensAt: at(HOUR), closesAt: at(2 * HOUR), ...body });
      expect([res.statusCode, errorOf(res).code], JSON.stringify(body)).toEqual([status, code]);
    };
    await bad({ closesAt: at(HOUR) });
    await bad({ quantity: 0 });
    await bad({ quantity: 10_001 });
    await bad({ purchaseWindowHours: 337 });
    await bad({ title: '' });
    await bad({ seed: 'x' });
    await bad({ modelId: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' }, 404, 'MODEL_NOT_FOUND');
    const inactive = (await h.ctx.db.insertInto('models').values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'OLD', type: 'RING', sku_prefix: 'OLD-DROP', active: false }).returning('id').executeTakeFirstOrThrow()).id;
    await bad({ modelId: inactive }, 409, 'MODEL_INACTIVE');
    expect((await auditor.post(adminUrl(), { modelId: catalog.modelId, title: 'X', quantity: 1, opensAt: at(HOUR), closesAt: at(2 * HOUR) })).statusCode).toBe(403);

    const d = await draft({ description: 'Twelve pieces, cast in Paris.' });
    expect(d).toMatchObject({ state: 'DRAFT', quantity: 2, purchaseWindowHours: 48, publishedAt: null, seed: null, entries: { ENTERED: 0, SELECTED: 0 } });
    expect(d.seedHash).toMatch(/^[0-9a-f]{64}$/);
    // The seed is committed in the audit log at creation; no answer, nor the log, holds the seed itself.
    const created = await audits('drop.create', d.id);
    expect(created).toHaveLength(1);
    expect(created[0]!.details).toMatchObject({ modelId: catalog.modelId, quantity: 2, purchaseWindowHours: 48, seedHash: d.seedHash });
    const row = await h.ctx.db.selectFrom('drops').select(['seed', 'seed_enc']).where('id', '=', d.id).executeTakeFirstOrThrow();
    expect(row.seed).toBeNull();
    expect(row.seed_enc).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/);
    for (const c of [operator, auditor, admin]) expect((await c.get(adminUrl(d.id))).body).not.toContain(row.seed_enc);
    // Not public while a DRAFT.
    expect(errorOf(await h.client().get(`/api/v1/drops/${d.id}`)).code).toBe('DROP_NOT_FOUND');
    expect((safeJson(await h.client().get('/api/v1/drops')) as { drops: { id: string }[] }).drops.map((x) => x.id)).not.toContain(d.id);

    // A DRAFT changes freely, audited with each value before and after (the description as its length and hash).
    const changed = safeJson(await operator.patch(adminUrl(d.id), { title: 'MONOLITHE — release I', quantity: 3, purchaseWindowHours: 24, description: '' })) as AdminDropJson;
    expect(changed).toMatchObject({ title: 'MONOLITHE — release I', quantity: 3, purchaseWindowHours: 24, description: null, seedHash: d.seedHash });
    const update = (await audits('drop.update', d.id))[0]!.details as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(update.after).toMatchObject({ title: 'MONOLITHE — release I', quantity: 3, purchaseWindowHours: 24, description: null });
    expect(update.before.description).toEqual({ length: 29, sha256: createHash('sha256').update('Twelve pieces, cast in Paris.').digest('hex') });
    expect(errorOf(await operator.patch(adminUrl(d.id), { closesAt: at(HOUR - 1000) })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await operator.patch(adminUrl(d.id), {})).code).toBe('VALIDATION_FAILED');

    const published = await publish(d.id);
    expect(published).toMatchObject({ state: 'UPCOMING', publishedAt: h.clock.now().toISOString() });
    expect((await audits('drop.publish', d.id))[0]!.details).toMatchObject({ seedHash: d.seedHash });
    expect(errorOf(await operator.post(`${adminUrl(d.id)}/publish`)).code).toBe('DROP_ALREADY_PUBLISHED');
    // Published: the description only.
    const locked = await operator.patch(adminUrl(d.id), { quantity: 4 });
    expect([locked.statusCode, errorOf(locked).code]).toEqual([409, 'DROP_PUBLISHED']);
    expect((safeJson(await operator.patch(adminUrl(d.id), { description: 'Three pieces.' })) as AdminDropJson).description).toBe('Three pieces.');

    // The public page: the release, its model and the SHA-256 of its seed; never the seed before the draw.
    const s = await sheet(d.id);
    expect(s).toMatchObject({ id: d.id, state: 'UPCOMING', title: 'MONOLITHE — release I', quantity: 3, description: 'Three pieces.', purchaseWindowHours: 24, seedHash: d.seedHash, seed: null, drawnAt: null, entries: null });
    expect(s.model).toEqual({ name: 'MONOLITHE', type: 'RING', collection: expect.any(String), imageUrl: null, lookbook: null });
    const listed = await h.client().get('/api/v1/drops');
    expect(listed.headers['cache-control']).toBe('public, max-age=60');
    expect((safeJson(listed) as { drops: { id: string; state: string }[] }).drops).toContainEqual(expect.objectContaining({ id: d.id, state: 'UPCOMING' }));
    expect(errorOf(await h.client().get(`/api/v1/drops/${d.id}/entries`)).code).toBe('DROP_NOT_DRAWN');
    for (const id of ['nope', '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6']) expect(errorOf(await h.client().get(`/api/v1/drops/${id}`)).code, id).toBe('DROP_NOT_FOUND');

    // A model PUBLIC in the lookbook: the page links its sheet.
    await h.ctx.services.catalog.updateModel(catalog.modelId, { slug: 'monolithe', lookbook: 'PUBLIC' }, SYSTEM_ACTOR);
    expect((await sheet(d.id)).model.lookbook).toBe('monolithe');
  });

  it('lets any signed-in account ENTER an open release, WITHDRAW and enter again on the same row, and lists its entries', async () => {
    const d = await draft();
    await publish(d.id);
    const { client, email } = await accountClient(h);
    const accountId = await accountIdOf(email);
    // Signed out, without the CSRF token, before the opening: refused.
    expect((await h.client().post(`/api/v1/club/drops/${d.id}/enter`)).statusCode).toBe(401);
    expect(errorOf(await client.post(`/api/v1/club/drops/${d.id}/enter`, undefined, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await enter(client, d.id)).code).toBe('DROP_NOT_OPEN');
    expect(errorOf(await enter(client, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6')).code).toBe('DROP_NOT_FOUND');
    expect(errorOf(await client.post(`/api/v1/club/drops/${d.id}/enter`, { tier: 3 })).code).toBe('VALIDATION_FAILED');

    h.clock.advance(HOUR);
    expect((await sheet(d.id)).state).toBe('OPEN');
    const first = await enter(client, d.id);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const entry = (safeJson(first) as { entry: EntryJson }).entry;
    expect(entry).toMatchObject({ dropId: d.id, status: 'ENTERED', state: 'OPEN', rank: null, respondBy: null });
    expect(entry.id).toMatch(UUID_RE);
    expect(errorOf(await enter(client, d.id)).code).toBe('DROP_ALREADY_ENTERED');
    const out = safeJson(await withdraw(client, d.id)) as { entry: EntryJson };
    expect(out.entry).toMatchObject({ id: entry.id, status: 'WITHDRAWN' });
    expect(errorOf(await withdraw(client, d.id)).code).toBe('DROP_NOT_ENTERED');
    const again = safeJson(await enter(client, d.id)) as { entry: EntryJson };
    expect(again.entry).toMatchObject({ id: entry.id, status: 'ENTERED', enteredAt: entry.enteredAt });
    expect(await h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).execute()).toEqual([{ id: entry.id }]);
    // The club's status lists it with its id; the audit log names the drop and the entry, never the email.
    expect((await status(client)).entries).toEqual([expect.objectContaining({ id: entry.id, dropId: d.id, status: 'ENTERED', state: 'OPEN' })]);
    const entered = await audits('drop.enter', d.id);
    expect(entered.map((e) => [e.actor_type, e.actor_id, e.details])).toEqual([
      ['account', accountId, { entryId: entry.id }],
      ['account', accountId, { entryId: entry.id, again: true }],
    ]);
    expect((await audits('drop.withdraw', d.id)).map((e) => e.details)).toEqual([{ entryId: entry.id }]);
    expect(JSON.stringify([...entered, ...(await audits('drop.withdraw', d.id))])).not.toContain(email);
    // The console sees the entry; an AUDITOR reads the email masked.
    expect((await adminEntries(operator, d.id)).items).toEqual([expect.objectContaining({ id: entry.id, accountId, email, status: 'ENTERED' })]);
    expect((await adminEntries(auditor, d.id)).items[0]!.email).toBe(`${email[0]}***${email.slice(email.indexOf('@'))}`);
    expect((safeJson(await auditor.get(adminUrl(d.id))) as AdminDropJson).entries).toMatchObject({ ENTERED: 1, WITHDRAWN: 0 });
  });

  it('draws once after the close: tier and seniority at the draw, then the seed\'s order; the places held 48 hours, the rest on the waiting list, all checkable from the page', async () => {
    const d = await draft({ quantity: 2 });
    await publish(d.id);
    h.clock.advance(HOUR);
    // Five accounts: one holding three pieces (PLATINE), one with a piece of long standing, one that receives three
    // pieces after it entered, one that gives its only piece away after it entered, and one that holds none.
    const platine = await accountClient(h);
    for (let i = 0; i < 3; i++) await ownedPiece(platine.client);
    const senior = await accountClient(h);
    const old = await ownedPiece(senior.client);
    await h.ctx.db.updateTable('ownership').set({ started_at: new Date(h.clock.now().getTime() - 3 * 366 * 24 * HOUR) }).where('product_id', '=', old.product.id).execute();
    const late = await accountClient(h);
    const giver = await accountClient(h);
    const given = await ownedPiece(giver.client);
    const none = await accountClient(h);
    const clients = { platine, senior, late, giver, none };
    for (const [name, c] of Object.entries(clients)) expect((await enter(c.client, d.id)).statusCode, name).toBe(200);
    for (let i = 0; i < 3; i++) await ownedPiece(late.client);
    const offer = safeJson(await giver.client.post('/api/v1/ownership/transfers', { productId: given.product.productId })) as { transferCode: string };
    expect((await none.client.post('/api/v1/ownership/transfers/accept', await scanToReceive(none.client, given.code.data, offer.transferCode))).statusCode).toBe(200);

    // Before the close: refused; an OPERATOR: refused.
    expect(errorOf(await admin.post(`${adminUrl(d.id)}/draw`)).code).toBe('DROP_NOT_CLOSED');
    h.clock.advance(2 * HOUR);
    await staff();
    expect((await sheet(d.id)).state).toBe('CLOSED');
    const forbidden = await operator.post(`${adminUrl(d.id)}/draw`);
    expect([forbidden.statusCode, errorOf(forbidden).code]).toEqual([403, 'FORBIDDEN']);
    // No route gave the seed so far.
    expect((await sheet(d.id)).seed).toBeNull();
    expect((safeJson(await admin.get(adminUrl(d.id))) as AdminDropJson).seed).toBeNull();

    const drawn = await admin.post(`${adminUrl(d.id)}/draw`);
    expect(drawn.statusCode, drawn.body).toBe(200);
    const outcome = safeJson(drawn) as { drop: AdminDropJson; entries: number; places: number; selected: number; waitlisted: number };
    expect(outcome).toMatchObject({ entries: 5, places: 2, selected: 2, waitlisted: 3, drop: { state: 'DRAWN', entries: { SELECTED: 2, WAITLISTED: 3, ENTERED: 0 } } });
    expect(errorOf(await admin.post(`${adminUrl(d.id)}/draw`)).code).toBe('DROP_ALREADY_DRAWN');

    // The page: the seed, which hashes to the commitment published since the publication.
    const s = await sheet(d.id);
    expect(s).toMatchObject({ state: 'DRAWN', entries: 5, drawnAt: h.clock.now().toISOString(), seedHash: d.seedHash });
    expect(s.seed).toMatch(/^[0-9a-f]{64}$/);
    const seed = Buffer.from(s.seed!, 'hex');
    expect(createHash('sha256').update(seed).digest('hex')).toBe(d.seedHash);
    const page = await h.client().get(`/api/v1/drops/${d.id}/entries?pageSize=200`);
    expect(page.headers['cache-control']).toBe('public, max-age=60');
    const published = safeJson(page) as { items: { id: string; tier: number; seniority: number; rank: number }[]; total: number };
    expect(published.total).toBe(5);
    // Each entry by its id, tier, seniority and rank: nothing of its account.
    for (const e of published.items) expect(Object.keys(e).sort()).toEqual(['id', 'rank', 'seniority', 'tier']);
    // The ranks are the rule's, recomputed here from what the page publishes.
    const recomputed = drawOrder(published.items.map((e) => ({ id: e.id, tier: e.tier as 0, seniority: e.seniority })), new Uint8Array(seed));
    expect(published.items.map((e) => [e.id, e.rank])).toEqual(recomputed.map((e) => [e.id, e.rank]));
    // The tiers and seniorities are those of the draw: the received pieces count, the piece given away does not.
    const mine = async (c: Client) => (await status(c)).entries.find((e) => e.dropId === d.id)!;
    const byName: Record<string, { tier: number; seniority: number; rank: number }> = {};
    for (const [name, c] of Object.entries(clients)) {
      const id = (await mine(c.client)).id;
      byName[name] = published.items.find((e) => e.id === id)!;
    }
    expect(byName.platine).toMatchObject({ tier: 2, seniority: 0 });
    expect(byName.late).toMatchObject({ tier: 2, seniority: 0 });
    expect(byName.senior).toMatchObject({ tier: 1, seniority: 3 });
    expect(byName.giver).toMatchObject({ tier: 0, seniority: 0 });
    expect(byName.none).toMatchObject({ tier: 1, seniority: 0 });
    // The two PLATINE first (their order by the seed), then the senior TITANE, then the TITANE of no seniority, then none.
    expect(new Set([byName.platine!.rank, byName.late!.rank])).toEqual(new Set([1, 2]));
    expect([byName.senior!.rank, byName.none!.rank, byName.giver!.rank]).toEqual([3, 4, 5]);
    // Each account reads its own status: the places held 48 hours, the waiting list's ranks.
    const respondBy = new Date(h.clock.now().getTime() + 48 * HOUR).toISOString();
    expect(await mine(platine.client)).toMatchObject({ status: 'SELECTED', respondBy, state: 'DRAWN' });
    expect(await mine(senior.client)).toMatchObject({ status: 'WAITLISTED', rank: 3, respondBy: null });
    // The draw is audited with its counts and the seed it reveals.
    expect((await audits('drop.draw', d.id))[0]!.details).toEqual({ entries: 5, places: 2, selected: 2, waitlisted: 3, seed: s.seed });
    // Entries no longer change once drawn.
    expect(errorOf(await withdraw(platine.client, d.id)).code).toBe('DROP_ALREADY_DRAWN');
    expect(errorOf(await enter((await accountClient(h)).client, d.id)).code).toBe('DROP_ALREADY_DRAWN');
    expect(errorOf(await operator.post(`${adminUrl(d.id)}/cancel`)).code).toBe('DROP_ALREADY_DRAWN');

    // The console: CONFIRMED (the sale concluded), LAPSED only after the place held, then OFFER NEXT.
    const entries = (await adminEntries(operator, d.id)).items;
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    const [first, second, third] = entries;
    expect(errorOf(await operator.post(`${adminUrl(d.id)}/entries/${third!.id}/confirm`)).code).toBe('DROP_ENTRY_NOT_SELECTED');
    const confirmed = safeJson(await operator.post(`${adminUrl(d.id)}/entries/${first!.id}/confirm`, { note: 'Sold in the Paris boutique.' })) as AdminEntryJson;
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', note: 'Sold in the Paris boutique.', handledAt: h.clock.now().toISOString() });
    expect(confirmed.handledBy?.email).toMatch(/^operator-/);
    expect((await audits('drop.entry.confirm', d.id))[0]!.details).toEqual({ entryId: first!.id, rank: 1, noted: true });
    const early = await operator.post(`${adminUrl(d.id)}/entries/${second!.id}/lapse`);
    expect([early.statusCode, errorOf(early).code]).toEqual([409, 'DROP_PLACE_HELD']);
    expect(errorOf(await operator.post(`${adminUrl(d.id)}/offer-next`)).code).toBe('DROP_FULL');
    h.clock.advance(48 * HOUR);
    await staff();
    expect((safeJson(await operator.post(`${adminUrl(d.id)}/entries/${second!.id}/lapse`)) as AdminEntryJson).status).toBe('LAPSED');
    const offered = safeJson(await operator.post(`${adminUrl(d.id)}/offer-next`)) as AdminEntryJson;
    expect(offered).toMatchObject({ id: third!.id, status: 'SELECTED', rank: 3, respondBy: new Date(h.clock.now().getTime() + 48 * HOUR).toISOString() });
    expect((await audits('drop.entry.offer', d.id))[0]!.details).toMatchObject({ entryId: third!.id, rank: 3 });
    expect(errorOf(await operator.post(`${adminUrl(d.id)}/offer-next`)).code).toBe('DROP_FULL');
    // An AUDITOR reads, never acts.
    expect((await auditor.post(`${adminUrl(d.id)}/offer-next`)).statusCode).toBe(403);
    expect((await adminEntries(auditor, d.id, '?status=LAPSED')).items.map((e) => e.id)).toEqual([second!.id]);
  });

  it('selects every entry when there are fewer than places; a cancelled release takes no entry and no draw', async () => {
    const d = await draft({ quantity: 5 });
    await publish(d.id);
    h.clock.advance(HOUR);
    const a = await accountClient(h);
    expect((await enter(a.client, d.id)).statusCode).toBe(200);
    h.clock.advance(2 * HOUR);
    await staff();
    const outcome = safeJson(await admin.post(`${adminUrl(d.id)}/draw`)) as { selected: number; waitlisted: number };
    expect(outcome).toMatchObject({ selected: 1, waitlisted: 0 });
    expect((await status(a.client)).entries.find((e) => e.dropId === d.id)).toMatchObject({ status: 'SELECTED', rank: 1 });
    expect(errorOf(await operator.post(`${adminUrl(d.id)}/offer-next`)).code).toBe('DROP_WAITLIST_EMPTY');

    const c = await draft();
    await publish(c.id);
    h.clock.advance(HOUR);
    const b = await accountClient(h);
    expect((await enter(b.client, c.id)).statusCode).toBe(200);
    const cancelled = safeJson(await operator.post(`${adminUrl(c.id)}/cancel`)) as AdminDropJson;
    expect(cancelled).toMatchObject({ state: 'CANCELLED' });
    expect((await audits('drop.cancel', c.id))[0]!.details).toEqual({ published: true, entered: 1 });
    expect(errorOf(await operator.post(`${adminUrl(c.id)}/cancel`)).code).toBe('DROP_CANCELLED');
    expect(errorOf(await enter((await accountClient(h)).client, c.id)).code).toBe('DROP_CANCELLED');
    expect((await sheet(c.id)).state).toBe('CANCELLED');
    expect((await status(b.client)).entries.find((e) => e.dropId === c.id)).toMatchObject({ status: 'ENTERED', state: 'CANCELLED' });
    h.clock.advance(2 * HOUR);
    await staff();
    expect(errorOf(await admin.post(`${adminUrl(c.id)}/draw`)).code).toBe('DROP_CANCELLED');
    // A release whose entries would already be closed is not published.
    const past = await draft({}, -3 * HOUR, 1);
    expect(errorOf(await operator.post(`${adminUrl(past.id)}/publish`)).code).toBe('DROP_WINDOW_PAST');
  });

  it('withdraws the open entries of an account its lock reaches, audits each, and lists every entry in its export', async () => {
    const open = await draft();
    await publish(open.id);
    const drawnDrop = await draft({ quantity: 1 });
    await publish(drawnDrop.id);
    h.clock.advance(HOUR);
    const { client, email } = await accountClient(h);
    const accountId = await accountIdOf(email);
    expect((await enter(client, drawnDrop.id)).statusCode).toBe(200);
    h.clock.advance(2 * HOUR);
    await staff();
    expect((await admin.post(`${adminUrl(drawnDrop.id)}/draw`)).statusCode).toBe(200);
    // Another release, open again: the account enters it, then is locked.
    const next = await draft({}, HOUR, 4);
    await publish(next.id);
    h.clock.advance(HOUR);
    const entry = (safeJson(await enter(client, next.id)) as { entry: EntryJson }).entry;
    const locked = await admin.post(`/api/admin/owners/${accountId}/lock`);
    expect(locked.statusCode, locked.body).toBe(200);
    expect(safeJson(locked)).toMatchObject({ status: 'LOCKED', dropEntriesWithdrawn: 1 });
    const rows = await h.ctx.db.selectFrom('drop_entries').select(['drop_id', 'status']).where('account_id', '=', accountId).orderBy('created_at').execute();
    expect(rows).toEqual([
      { drop_id: drawnDrop.id, status: 'SELECTED' },
      { drop_id: next.id, status: 'WITHDRAWN' },
    ]);
    expect((await audits('drop.withdraw', next.id)).map((e) => [e.actor_type, e.details])).toEqual([['admin', { entryId: entry.id, reason: 'account_locked' }]]);
    expect((await audits('account.lock', accountId))[0]!.details).toMatchObject({ dropEntriesWithdrawn: 1 });
    // The lock ended the session; signed in again after the unlock, the entry is open again to it.
    expect((await admin.post(`/api/admin/owners/${accountId}/unlock`)).statusCode).toBe(200);
    const back = h.client();
    expect((await back.post('/api/v1/account/login', { email, password: PASSWORD })).statusCode).toBe(200);
    expect((safeJson(await enter(back, next.id)) as { entry: EntryJson }).entry).toMatchObject({ id: entry.id, status: 'ENTERED' });

    const exported = safeJson(await admin.get(`/api/admin/owners/${accountId}/export`)) as { dropEntries: Record<string, unknown>[] };
    expect(exported.dropEntries).toEqual([
      expect.objectContaining({ dropId: drawnDrop.id, status: 'SELECTED', rank: 1, tier: 0, seniority: 0, title: drawnDrop.title }),
      expect.objectContaining({ entryId: entry.id, dropId: next.id, status: 'ENTERED', rank: null }),
    ]);
    for (const e of exported.dropEntries) expect(e).not.toHaveProperty('note');
    expect((await audits('account.export', accountId))[0]!.details).toMatchObject({ dropEntries: 2 });
  });

  it('cannot draw with a seed sealed under another key: the draw fails closed, nothing is written', async () => {
    const d = await draft();
    await publish(d.id);
    h.clock.advance(3 * HOUR);
    const other = new DropService({ db: h.ctx.db, audit: h.ctx.audit, clock: h.clock.now, seedKey: deriveDropSeedKey(testConfig({ cookieSecret: 'another cookie secret of at least thirty-two characters' })) });
    const actor = { type: 'admin' as const, id: (await createAdmin(h.ctx, 'ADMIN')).id };
    await expect(other.draw(d.id, actor)).rejects.toMatchObject({ code: 'DROP_SEED_UNAVAILABLE', httpStatus: 503 });
    expect(await h.ctx.db.selectFrom('drops').select(['seed', 'drawn_at']).where('id', '=', d.id).executeTakeFirstOrThrow()).toEqual({ seed: null, drawn_at: null });
    // The server's own key opens it.
    await expect(h.ctx.services.drops.draw(d.id, actor)).resolves.toMatchObject({ entries: 0, selected: 0 });
  });

  describe('the early access, with a direct reservation (P-X02)', () => {
    const reserve = (c: Client, id: string) => c.post(`/api/v1/club/drops/${id}/reserve`);
    /** An account holding `n` pieces (3 make it PLATINE, 5 PALLADIUM), with its pieces and its id. */
    async function owner(n: number): Promise<{ client: Client; email: string; id: string; pieces: IssueResult[] }> {
      const a = await accountClient(h);
      const pieces: IssueResult[] = [];
      for (let i = 0; i < n; i++) pieces.push(await ownedPiece(a.client));
      return { ...a, id: await accountIdOf(a.email), pieces };
    }
    const entryOf = async (res: Awaited<ReturnType<typeof reserve>>) => {
      expect(res.statusCode, res.body).toBe(200);
      return (safeJson(res) as { entry: EntryJson }).entry;
    };
    const iso = (ms: number) => new Date(ms).toISOString();

    it('sets a DRAFT\'s early access, 48 hours by default, 0 to 336, audited; fixed once published, public with its time, from the publication at the earliest', async () => {
      await staff();
      for (const earlyAccessHours of [-1, 337, 1.5, '48']) {
        const res = await operator.post(adminUrl(), { modelId: catalog.modelId, title: 'X', quantity: 1, opensAt: at(HOUR), closesAt: at(2 * HOUR), earlyAccessHours });
        expect([res.statusCode, errorOf(res).code], String(earlyAccessHours)).toEqual([400, 'VALIDATION_FAILED']);
      }
      const d = await draft({}, 72 * HOUR);
      const opensAt = Date.parse(d.opensAt);
      expect(d).toMatchObject({ earlyAccessHours: 48, earlyAccessOpensAt: iso(opensAt - 48 * HOUR), reserved: 0 });
      expect((await audits('drop.create', d.id))[0]!.details).toMatchObject({ earlyAccessHours: 48 });
      expect(await draft({ earlyAccessHours: 0 }, 72 * HOUR)).toMatchObject({ earlyAccessHours: 0, earlyAccessOpensAt: null });
      // A DRAFT changes it, audited before and after; once published it is fixed.
      expect(safeJson(await operator.patch(adminUrl(d.id), { earlyAccessHours: 24 }))).toMatchObject({ earlyAccessHours: 24, earlyAccessOpensAt: iso(opensAt - 24 * HOUR) });
      expect((await audits('drop.update', d.id)).map((e) => e.details)).toEqual([{ before: { earlyAccessHours: 48 }, after: { earlyAccessHours: 24 } }]);
      expect(errorOf(await operator.patch(adminUrl(d.id), { earlyAccessHours: 400 })).code).toBe('VALIDATION_FAILED');
      await publish(d.id);
      expect((await audits('drop.publish', d.id))[0]!.details).toMatchObject({ earlyAccessHours: 24, earlyAccessOpensAt: iso(opensAt - 24 * HOUR) });
      const fixed = await operator.patch(adminUrl(d.id), { earlyAccessHours: 48 });
      expect([fixed.statusCode, errorOf(fixed).code]).toEqual([409, 'DROP_PUBLISHED']);
      // Public: the early access and its time, not open yet, nothing reserved; in the list too.
      expect(await sheet(d.id)).toMatchObject({ state: 'UPCOMING', earlyAccessHours: 24, earlyAccessOpensAt: iso(opensAt - 24 * HOUR), earlyAccessOpen: false, reserved: 0 });
      const listed = (safeJson(await h.client().get('/api/v1/drops')) as { drops: SheetJson[] }).drops.find((x) => x.id === d.id);
      expect(listed).toMatchObject({ earlyAccessHours: 24, earlyAccessOpensAt: iso(opensAt - 24 * HOUR), earlyAccessOpen: false });
      // Published inside its early access: the reservations open with the publication.
      const late = await draft({}, 10 * HOUR);
      await publish(late.id);
      expect(await sheet(late.id)).toMatchObject({ state: 'UPCOMING', earlyAccessOpensAt: h.clock.now().toISOString(), earlyAccessOpen: true });
      expect((await audits('drop.publish', late.id))[0]!.details).toMatchObject({ earlyAccessOpensAt: h.clock.now().toISOString() });
      // Published once its entries are open: no early access at all.
      const open = await draft({}, -HOUR, 3);
      await publish(open.id);
      expect(await sheet(open.id)).toMatchObject({ state: 'OPEN', earlyAccessHours: 48, earlyAccessOpensAt: null, earlyAccessOpen: false });
    });

    it('reserves a place at once for an account PLATINE or PALLADIUM at its request, during the early access only: refused before it, from the opening, below PLATINE, twice', async () => {
      // Two pieces, entries opening in 72 hours: the early access of 48 hours opens in 24.
      const d = await draft({ quantity: 2 }, 72 * HOUR, 2);
      await publish(d.id);
      const platine = await owner(3);
      const titane = await owner(1);
      const nobody = await accountClient(h);
      const before = await reserve(platine.client, d.id);
      expect([before.statusCode, errorOf(before).code]).toEqual([409, 'DROP_EARLY_ACCESS_NOT_OPEN']);
      expect(errorOf(before).message).toBe(`Direct reservations for this release open on ${iso(Date.parse(d.opensAt) - 48 * HOUR).slice(0, 16).replace('T', ' ')} UTC.`);

      h.clock.advance(24 * HOUR);
      await staff();
      expect(await sheet(d.id)).toMatchObject({ state: 'UPCOMING', earlyAccessOpen: true });
      // Signed out, without the CSRF token, with a body, an unknown release: refused. Below PLATINE: refused, and the
      // account waits for the opening.
      expect((await h.client().post(`/api/v1/club/drops/${d.id}/reserve`)).statusCode).toBe(401);
      expect(errorOf(await platine.client.post(`/api/v1/club/drops/${d.id}/reserve`, undefined, { noCsrf: true })).code).toBe('CSRF_FAILED');
      expect(errorOf(await platine.client.post(`/api/v1/club/drops/${d.id}/reserve`, { tier: 3 })).code).toBe('VALIDATION_FAILED');
      expect(errorOf(await reserve(platine.client, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6')).code).toBe('DROP_NOT_FOUND');
      for (const c of [titane, nobody]) {
        const res = await reserve(c.client, d.id);
        expect([res.statusCode, errorOf(res).code]).toEqual([403, 'DROP_TIER_REQUIRED']);
        expect(errorOf(res).message).toBe('Only PLATINE and PALLADIUM owners reserve a place directly: from 3 pieces held.');
        expect(errorOf(await enter(c.client, d.id)).code).toBe('DROP_NOT_OPEN');
      }
      // PLATINE: the place held at once for the release's window, without a rank, the tier of the moment kept.
      const res = await reserve(platine.client, d.id);
      expect(res.headers['cache-control']).toBe('no-store');
      const entry = await entryOf(res);
      expect(entry).toMatchObject({ dropId: d.id, state: 'UPCOMING', status: 'SELECTED', reserved: true, rank: null, respondBy: iso(h.clock.now().getTime() + 48 * HOUR) });
      expect((await audits('drop.reserve', d.id)).map((e) => [e.actor_type, e.actor_id, e.details])).toEqual([['account', platine.id, { entryId: entry.id, tier: 2, respondBy: entry.respondBy }]]);
      expect(JSON.stringify(await audits('drop.reserve', d.id))).not.toContain(platine.email);
      // Once: again, ENTER and WITHDRAW are refused; the account's status lists it, with its id.
      expect(errorOf(await reserve(platine.client, d.id)).code).toBe('DROP_ALREADY_RESERVED');
      expect(errorOf(await withdraw(platine.client, d.id)).code).toBe('DROP_NOT_ENTERED');
      expect((await status(platine.client)).entries).toEqual([expect.objectContaining({ id: entry.id, dropId: d.id, status: 'SELECTED', reserved: true, rank: null })]);
      // The console and the public page count it (never drawn: no rank, no entry of the draw); the export lists it.
      expect((await adminEntries(operator, d.id)).items).toEqual([expect.objectContaining({ id: entry.id, accountId: platine.id, status: 'SELECTED', reserved: true, tier: 2, seniority: 0, rank: null })]);
      expect(safeJson(await auditor.get(adminUrl(d.id)))).toMatchObject({ reserved: 1, entries: { SELECTED: 1 } });
      expect(await sheet(d.id)).toMatchObject({ reserved: 1, entries: null });
      const exported = safeJson(await admin.get(`/api/admin/owners/${platine.id}/export`)) as { dropEntries: Record<string, unknown>[] };
      expect(exported.dropEntries).toEqual([expect.objectContaining({ entryId: entry.id, dropId: d.id, status: 'SELECTED', tier: 2, rank: null })]);
      // The tier is the one of the request: PLATINE gives a piece away, and is TITANE now.
      const giver = await owner(3);
      const offer = safeJson(await giver.client.post('/api/v1/ownership/transfers', { productId: giver.pieces[0]!.product.productId })) as { transferCode: string };
      const recipient = (await accountClient(h)).client;
      expect((await recipient.post('/api/v1/ownership/transfers/accept', await scanToReceive(recipient, giver.pieces[0]!.code.data, offer.transferCode))).statusCode).toBe(200);
      expect(errorOf(await reserve(giver.client, d.id)).code).toBe('DROP_TIER_REQUIRED');
      // PALLADIUM: its tier kept with its place.
      const palladium = await owner(5);
      const top = await entryOf(await reserve(palladium.client, d.id));
      expect((await adminEntries(operator, d.id)).items.find((e) => e.id === top.id)).toMatchObject({ tier: 3, reserved: true });

      // From the opening (48 hours on): no reservation any more; ENTER for every account but the one that holds a place.
      h.clock.advance(48 * HOUR);
      await staff();
      expect(await sheet(d.id)).toMatchObject({ state: 'OPEN', earlyAccessOpen: false, reserved: 2 });
      const other = await owner(3);
      const closed = await reserve(other.client, d.id);
      expect([closed.statusCode, errorOf(closed).code, errorOf(closed).message]).toEqual([409, 'DROP_EARLY_ACCESS_CLOSED', 'Direct reservations for this release are closed: the places left go to the draw.']);
      expect((await enter(titane.client, d.id)).statusCode).toBe(200);
      expect(errorOf(await enter(platine.client, d.id)).code).toBe('DROP_ALREADY_RESERVED');
      // A release without an early access: never.
      const none = await draft({ earlyAccessHours: 0 }, HOUR, 2);
      await publish(none.id);
      const never = await reserve(platine.client, none.id);
      expect([never.statusCode, errorOf(never).code, errorOf(never).message]).toEqual([409, 'DROP_EARLY_ACCESS_CLOSED', 'This release offers no direct reservation: its places go to the draw.']);
    });

    it('counts the places first come, first served under the drop\'s lock: at its pieces the release is full; a lapse gives one back', async () => {
      // Two pieces, a place held 1 hour; published inside its early access: reservations open at once.
      const d = await draft({ quantity: 2, purchaseWindowHours: 1 }, 10 * HOUR, 2);
      await publish(d.id);
      const accounts = [await owner(3), await owner(3), await owner(5)];
      // Three at once for two places: two hold one, the third is told every piece is held.
      const three = await Promise.all(accounts.map((a) => reserve(a.client, d.id)));
      expect(three.map((r) => r.statusCode).sort()).toEqual([200, 200, 409]);
      const refused = three.findIndex((r) => r.statusCode === 409);
      expect(errorOf(three[refused]!).code).toBe('DROP_FULL');
      const held = await h.ctx.db.selectFrom('drop_entries').select(['id', 'account_id', 'status', 'rank']).where('drop_id', '=', d.id).execute();
      expect(held.map((e) => [e.status, e.rank])).toEqual([
        ['SELECTED', null],
        ['SELECTED', null],
      ]);
      expect(await sheet(d.id)).toMatchObject({ quantity: 2, reserved: 2, earlyAccessOpen: true });
      expect(safeJson(await operator.get(adminUrl(d.id)))).toMatchObject({ reserved: 2, entries: { SELECTED: 2 } });
      const late = accounts[refused]!;
      expect(errorOf(await reserve(late.client, d.id)).code).toBe('DROP_FULL');
      // ORBES Client Services concludes one sale; the other place lapses after its hour, never before: a place is free again.
      const [sold, lapsing] = held;
      expect((await operator.post(`${adminUrl(d.id)}/entries/${sold!.id}/confirm`)).statusCode).toBe(200);
      expect(errorOf(await operator.post(`${adminUrl(d.id)}/entries/${lapsing!.id}/lapse`)).code).toBe('DROP_PLACE_HELD');
      expect(errorOf(await reserve(late.client, d.id)).code).toBe('DROP_FULL');
      h.clock.advance(HOUR);
      await staff();
      expect(safeJson(await operator.post(`${adminUrl(d.id)}/entries/${lapsing!.id}/lapse`))).toMatchObject({ status: 'LAPSED', reserved: true });
      expect(await sheet(d.id)).toMatchObject({ reserved: 1 });
      await entryOf(await reserve(late.client, d.id));
      expect(await sheet(d.id)).toMatchObject({ reserved: 2 });
      // The account whose place lapsed has had its chance: its entry is the lapsed one.
      const lapsedAccount = accounts.find((a) => a.id === lapsing!.account_id)!;
      expect(errorOf(await reserve(lapsedAccount.client, d.id)).code).toBe('DROP_ALREADY_RESERVED');
    });

    it('draws only the places the direct reservations leave, and lists only the entries it ranked', async () => {
      // Three pieces: one reserved then sold, one reserved and held, during the early access; the third goes to the draw.
      const d = await draft({ quantity: 3 }, 10 * HOUR, 2);
      await publish(d.id);
      const [p1, p2] = [await owner(3), await owner(3)];
      const sold = await entryOf(await reserve(p1.client, d.id));
      const kept = await entryOf(await reserve(p2.client, d.id));
      expect((await operator.post(`${adminUrl(d.id)}/entries/${sold.id}/confirm`, { note: 'Sold in the Paris boutique.' })).statusCode).toBe(200);
      // Entries open: a TITANE and two accounts that hold no piece enter.
      h.clock.advance(10 * HOUR);
      await staff();
      expect((await sheet(d.id)).state).toBe('OPEN');
      const entrants = [await owner(1), await owner(0), await owner(0)];
      for (const e of entrants) expect((await enter(e.client, d.id)).statusCode).toBe(200);
      h.clock.advance(2 * HOUR);
      await staff();
      // The draw: three entries for the one place left.
      const outcome = safeJson(await admin.post(`${adminUrl(d.id)}/draw`)) as { drop: AdminDropJson; entries: number; places: number; selected: number; waitlisted: number };
      expect(outcome).toMatchObject({ entries: 3, places: 1, selected: 1, waitlisted: 2 });
      expect(outcome.drop).toMatchObject({ state: 'DRAWN', reserved: 2, entries: { ENTERED: 0, SELECTED: 2, CONFIRMED: 1, WAITLISTED: 2 } });
      expect((await audits('drop.draw', d.id))[0]!.details).toMatchObject({ entries: 3, places: 1, selected: 1, waitlisted: 2 });
      // The page lists the three entries the draw ranked, never the reservations, which keep their place without a rank.
      const page = safeJson(await h.client().get(`/api/v1/drops/${d.id}/entries?pageSize=200`)) as { items: { id: string; rank: number }[]; total: number };
      expect([page.total, page.items.map((e) => e.rank)]).toEqual([3, [1, 2, 3]]);
      for (const reservation of [sold.id, kept.id]) expect(page.items.map((e) => e.id)).not.toContain(reservation);
      expect(await sheet(d.id)).toMatchObject({ state: 'DRAWN', entries: 3, reserved: 2 });
      const mine = async (c: Client) => (await status(c)).entries.find((e) => e.dropId === d.id);
      expect(await mine(p1.client)).toMatchObject({ id: sold.id, status: 'CONFIRMED', reserved: true, rank: null });
      expect(await mine(p2.client)).toMatchObject({ id: kept.id, status: 'SELECTED', reserved: true, rank: null });
      // The TITANE entrant, first of the draw, holds the place it gave; the others wait, by rank.
      expect(await mine(entrants[0]!.client)).toMatchObject({ status: 'SELECTED', rank: 1, reserved: false });
      expect((await mine(entrants[1]!.client))?.status).toBe('WAITLISTED');

      // A release whose every piece is reserved: its draw gives no place, and ranks every entry on the waiting list.
      const full = await draft({ quantity: 1 }, 10 * HOUR, 2);
      await publish(full.id);
      await entryOf(await reserve(p1.client, full.id));
      h.clock.advance(10 * HOUR);
      await staff();
      const waiting = await owner(0);
      expect((await enter(waiting.client, full.id)).statusCode).toBe(200);
      h.clock.advance(2 * HOUR);
      await staff();
      expect(safeJson(await admin.post(`${adminUrl(full.id)}/draw`))).toMatchObject({ entries: 1, places: 0, selected: 0, waitlisted: 1 });
      expect((await status(waiting.client)).entries.find((e) => e.dropId === full.id)).toMatchObject({ status: 'WAITLISTED', rank: 1 });
    });
  });
});
