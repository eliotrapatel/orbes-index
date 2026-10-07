/**
 * The yearly care (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6, step 2.6; migration 0028), on the services and the
 * routes as createContext and buildApp wire them:
 *
 *  - the allowances: PLATINE 1 piece a year, PALLADIUM every piece, nothing below PLATINE, THE PROGRAM's numbers; the
 *    year is the calendar year in UTC;
 *  - the return name and address are required (400), stored with the request, prefilled from the account's last order
 *    (`addressHint`, null without one, never another account's), in the export, and never in the audit log;
 *  - each staff step runs in one transaction with the service record it opens or closes (a failure rolls both back);
 *    the console's service route refuses YEARLY_CARE;
 *  - the label is a PDF sent as itself: 415 FILE_NOT_PDF for another type or signature, 413 FILE_TOO_LARGE over 2 MiB,
 *    400 without its carrier or tracking number;
 *  - a piece received by transfer (TRANSFERRED) can be cared for, by PLATINE and by PALLADIUM; TITANE, a LOST, STOLEN
 *    or SERVICED piece, a pending transfer and a piece not held are refused;
 *  - two requests at once by a PLATINE account: one wins; cancelling gives the allowance back;
 *  - the full flow opens and closes a YEARLY_CARE record, the piece IN SERVICE and back, listed in SERVICE HISTORY;
 *  - the label is served to its own account only, and erased 30 days after the request ends;
 *  - no message is written and no conversation created by any step; the Messages board and a conversation's head show
 *    the open request's link when the client has a conversation;
 *  - the account's routes: 401 signed out, the CSRF token and the same origin on every write, `no-store`.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { careAllowance, eraseCareLabels, CARE_LABEL_MAX_BYTES } from '../../src/server/services/care.js';
import { DEFAULT_PROGRAM } from '../../src/server/services/club-program.js';
import type { Actor } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from '../api/support.js';
import { holdPieces } from '../support/live.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const ADDRESS = { name: 'Camille Martin', address: '12 rue de la Paix\n75002 Paris\nFrance' };

interface CareJson {
  year: number;
  tier: string | null;
  allowance: number | 'ALL';
  used: number;
  reason: string;
  request: { id: string; status: string; returnName: string; returnAddress: string; label: { carrier: { name: string }; tracking: string; trackingUrl: string; pdf: boolean } | null; return: { tracking: string } | null } | null;
  addressHint?: { name: string; address: string } | null;
}

describe('the yearly care (BP-19 T6)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let carrierId: string;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-07T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    carrierId = (await h.t.db.selectFrom('carriers').select('id').where('active', '=', true).orderBy('name').executeTakeFirstOrThrow()).id;
    const a = await h.t.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: a.id };
  });
  afterAll(() => h?.close());

  /** A signed-in collector holding `n` pieces now (5 PLATINE, 10 PALLADIUM), with their serials. */
  async function collector(n: number) {
    const { client, email } = await accountClient(h);
    const id = (await h.t.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
    const pieces = n ? await holdPieces(h.t.db, id, n, catalog.modelId) : [];
    const serials = pieces.length ? (await h.t.db.selectFrom('products').select(['id', 'product_id']).where('id', 'in', pieces).execute()).map((p) => p.product_id).sort() : [];
    return { client, email, id, serials, actor: { type: 'account', id } as Actor };
  }
  const care = (c: Client, serial: string) => c.get(`/api/v1/account/products/${serial}/care`);
  const ask = (c: Client, serial: string, body: unknown = ADDRESS) => c.post(`/api/v1/account/products/${serial}/care`, body);
  const counts = async () => ({
    messages: Number((await h.t.db.selectFrom('client_messages').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n),
    conversations: Number((await h.t.db.selectFrom('client_conversations').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n),
  });
  const label = (id: string, body: Buffer = PDF, query = `carrierId=${carrierId}&tracking=6A12345678901`, type = 'application/pdf') =>
    operator.request('POST', `/api/admin/care/${id}/label?${query}`, { body, headers: { 'content-type': type } });

  it('gives PLATINE 1 piece a year, PALLADIUM every piece, and nothing below PLATINE; THE PROGRAM sets the numbers', async () => {
    expect(careAllowance(DEFAULT_PROGRAM, 0)).toBe(0);
    expect(careAllowance(DEFAULT_PROGRAM, 1)).toBe(0);
    expect(careAllowance(DEFAULT_PROGRAM, 2)).toBe(1);
    expect(careAllowance(DEFAULT_PROGRAM, 3)).toBe('ALL');
    expect(careAllowance({ carePiecesPlatine: 0, carePiecesPalladium: 2 }, 3)).toBe(2);
    expect(careAllowance({ carePiecesPlatine: 0, carePiecesPalladium: 2 }, 2)).toBe(0);
    const titane = await collector(1);
    const platine = await collector(5);
    const palladium = await collector(10);
    const of = async (c: { client: Client; serials: string[] }) => safeJson(await care(c.client, c.serials[0]!)) as CareJson;
    expect(await of(titane)).toMatchObject({ year: 2026, tier: 'TITANE', allowance: 0, used: 0, reason: 'NOT_INCLUDED', request: null, addressHint: null });
    expect(await of(platine)).toMatchObject({ year: 2026, tier: 'PLATINE', allowance: 1, used: 0, reason: 'AVAILABLE', request: null });
    expect(await of(palladium)).toMatchObject({ year: 2026, tier: 'PALLADIUM', allowance: 'ALL', used: 0, reason: 'AVAILABLE' });
    expect(errorOf(await ask(titane.client, titane.serials[0]!))).toMatchObject({ code: 'CARE_NOT_INCLUDED' });
    // PLATINE: one piece, then the year is used for any other; PALLADIUM: each piece once.
    expect((await ask(platine.client, platine.serials[0]!)).statusCode).toBe(201);
    expect((await of({ client: platine.client, serials: [platine.serials[1]!] })).reason).toBe('USED');
    const used = await ask(platine.client, platine.serials[1]!);
    expect(used.statusCode).toBe(409);
    expect(errorOf(used).code).toBe('CARE_USED');
    for (const s of palladium.serials.slice(0, 3)) expect((await ask(palladium.client, s)).statusCode).toBe(201);
    expect(errorOf(await ask(palladium.client, palladium.serials[0]!)).code).toBe('CARE_ALREADY_REQUESTED');
    expect(await of(palladium)).toMatchObject({ used: 3, reason: 'PIECE_DONE', request: { status: 'REQUESTED' } });
  });

  it('counts the calendar year in UTC: a PLATINE year used on 31 December opens again on 1 January', async () => {
    const before = h.clock.now();
    try {
      h.clock.set('2026-12-31T23:30:00.000Z');
      const p = await collector(5);
      expect((await ask(p.client, p.serials[0]!)).statusCode).toBe(201);
      expect((safeJson(await care(p.client, p.serials[1]!)) as CareJson).reason).toBe('USED');
      h.clock.set('2027-01-01T00:30:00.000Z');
      const next = safeJson(await care(p.client, p.serials[1]!)) as CareJson;
      expect(next).toMatchObject({ year: 2027, used: 0, reason: 'AVAILABLE' });
      expect((await ask(p.client, p.serials[1]!)).statusCode).toBe(201);
      // The piece asked for in 2026 keeps showing its open request in 2027.
      expect((safeJson(await care(p.client, p.serials[0]!)) as CareJson).request).toMatchObject({ status: 'REQUESTED' });
    } finally {
      h.clock.set(before);
    }
  });

  it('requires the name and the address the piece returns to, stores them, prefills them from the last order only, exports them and never audits them', async () => {
    const p = await collector(5);
    for (const body of [{}, { name: 'Camille Martin' }, { name: '  ', address: '12 rue de la Paix' }, { address: 'x', name: '' }]) {
      const res = await ask(p.client, p.serials[0]!, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res)).toEqual({ code: 'VALIDATION_FAILED', message: 'Enter the name and the address the piece returns to.' });
    }
    expect((await ask(p.client, p.serials[0]!, { ...ADDRESS, name: 'x'.repeat(201) })).statusCode).toBe(400);
    expect((await ask(p.client, p.serials[0]!, { ...ADDRESS, extra: true })).statusCode).toBe(400);
    // No order: no hint. An order with an address: its buyer, for this account only.
    expect((safeJson(await care(p.client, p.serials[0]!)) as CareJson).addressHint).toBeNull();
    const location = (await h.t.db.selectFrom('stock_locations').select('id').executeTakeFirstOrThrow()).id;
    const request = await h.t.db.insertInto('shop_requests').values({ account_id: p.id, model_id: catalog.modelId, status: 'CLOSED', created_at: h.clock.now(), handled_at: h.clock.now(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    await h.t.db
      .insertInto('orders')
      .values({ channel: 'SALON', account_id: p.id, model_id: catalog.modelId, location_id: location, shop_request_id: request.id, buyer_name: 'C. Martin', buyer_address: '1 avenue Montaigne\n75008 Paris' })
      .execute();
    expect((safeJson(await care(p.client, p.serials[0]!)) as CareJson).addressHint).toEqual({ name: 'C. Martin', address: '1 avenue Montaigne\n75008 Paris' });
    const other = await collector(5);
    expect((safeJson(await care(other.client, other.serials[0]!)) as CareJson).addressHint).toBeNull();
    // Stored as given (trimmed), shown back; never in the audit log; in the account's export.
    const res = await ask(p.client, p.serials[0]!, { name: '  Camille Martin ', address: ` ${ADDRESS.address} ` });
    expect(res.statusCode, res.body).toBe(201);
    expect((safeJson(res) as CareJson).request).toMatchObject({ status: 'REQUESTED', returnName: 'Camille Martin', returnAddress: ADDRESS.address });
    const audits = await h.t.db.selectFrom('audit_logs').select(['action', 'details']).where('action', 'like', 'care.%').execute();
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      const text = JSON.stringify(a.details);
      expect(text).not.toContain('rue de la Paix');
      expect(text).not.toContain('Camille');
    }
    const exported = await h.ctx.services.owners.exportData(p.id, admin);
    expect(exported.careRequests).toEqual([expect.objectContaining({ productId: p.serials[0], year: 2026, tier: 'PLATINE', status: 'REQUESTED', returnName: 'Camille Martin', returnAddress: ADDRESS.address })]);
    // The console reads the address in clear from OPERATOR, masked for an AUDITOR.
    const id = (safeJson(res) as CareJson).request!.id;
    expect(safeJson(await operator.get(`/api/admin/care/${id}`))).toMatchObject({ returnName: 'Camille Martin', returnAddress: ADDRESS.address, account: { email: p.email } });
    const masked = safeJson(await auditor.get(`/api/admin/care/${id}`)) as { returnName: string; returnAddress: string; account: { email: string } };
    expect(masked.returnName).not.toBe('Camille Martin');
    expect(masked.returnAddress).not.toContain('rue de la Paix');
    expect(masked.account.email).not.toBe(p.email);
    // The request's answer and CANCEL REQUEST's carry the hint too, so the form opens prefilled again after a cancel
    // (to change the address, the collector cancels and asks again); never another account's.
    const hint = { name: 'C. Martin', address: '1 avenue Montaigne\n75008 Paris' };
    expect((safeJson(res) as CareJson).addressHint).toEqual(hint);
    const cancelled = await p.client.post(`/api/v1/account/care/${id}/cancel`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(safeJson(cancelled)).toMatchObject({ reason: 'AVAILABLE', request: { status: 'CANCELLED' }, addressHint: hint });
    const again = await ask(other.client, other.serials[0]!);
    expect(again.statusCode, again.body).toBe(201);
    expect((safeJson(again) as CareJson).addressHint).toBeNull();
  });

  it('cares for a piece received by transfer, by PLATINE and by PALLADIUM', async () => {
    for (const n of [5, 10]) {
      const p = await collector(n);
      await h.t.db.updateTable('products').set({ status: 'TRANSFERRED' }).where('product_id', '=', p.serials[0]!).execute();
      const res = await ask(p.client, p.serials[0]!);
      expect(res.statusCode, `${n} pieces: ${res.body}`).toBe(201);
    }
  });

  it('refuses a LOST, STOLEN or SERVICED piece, a piece whose transfer is pending, and a piece not held', async () => {
    const p = await collector(10);
    for (const [i, status] of (['LOST', 'STOLEN', 'SERVICED'] as const).entries()) {
      await h.t.db.updateTable('products').set({ status }).where('product_id', '=', p.serials[i]!).execute();
      expect((safeJson(await care(p.client, p.serials[i]!)) as CareJson).reason, status).toBe('UNAVAILABLE');
      const res = await ask(p.client, p.serials[i]!);
      expect(res.statusCode, status).toBe(409);
      expect(errorOf(res).code, status).toBe('CARE_UNAVAILABLE');
    }
    const pending = (await h.t.db.selectFrom('products').select('id').where('product_id', '=', p.serials[3]!).executeTakeFirstOrThrow()).id;
    await h.t.db
      .insertInto('ownership_transfers')
      .values({ product_id: pending, from_account_id: p.id, token_hash: new Uint8Array(32).fill(7), expires_at: new Date(h.clock.now().getTime() + 86_400_000) })
      .execute();
    expect(errorOf(await ask(p.client, p.serials[3]!)).code).toBe('CARE_UNAVAILABLE');
    const stranger = await collector(5);
    const res = await ask(stranger.client, p.serials[4]!);
    expect(res.statusCode).toBe(404);
    expect((await care(stranger.client, p.serials[4]!)).statusCode).toBe(404);
  });

  it('lets one of two requests at once by a PLATINE account win, and gives the allowance back when it is cancelled', async () => {
    const p = await collector(5);
    const both = await Promise.allSettled([0, 1].map((i) => h.ctx.services.care.request(p.id, p.serials[i]!, ADDRESS, p.actor)));
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'CARE_USED' });
    expect(await h.t.db.selectFrom('care_requests').select('id').where('account_id', '=', p.id).execute()).toHaveLength(1);
    const won = (both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ request: { id: string } }>).value.request.id;
    const winner = (await h.t.db.selectFrom('care_requests as c').innerJoin('products as p', 'p.id', 'c.product_id').select('p.product_id').where('c.id', '=', won).executeTakeFirstOrThrow()).product_id;
    const loser = p.serials.find((s) => s !== winner && p.serials.indexOf(s) < 2)!;
    // Cancel (the account's, while REQUESTED): the year's allowance is back, for any piece.
    const cancelled = await p.client.post(`/api/v1/account/care/${won}/cancel`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(safeJson(cancelled)).toMatchObject({ used: 0, reason: 'AVAILABLE', request: { status: 'CANCELLED' } });
    expect((await ask(p.client, loser)).statusCode).toBe(201);
    // Once cancelled, it cannot be cancelled again; another account's request is not found.
    expect(errorOf(await p.client.post(`/api/v1/account/care/${won}/cancel`)).code).toBe('CARE_STEP');
    const other = await collector(5);
    expect((await other.client.post(`/api/v1/account/care/${won}/cancel`)).statusCode).toBe(404);
  });

  it('opens and closes a YEARLY_CARE record through the steps, the piece IN SERVICE and back, with no message written and the label for its own account only', async () => {
    const p = await collector(5);
    const before = await counts();
    const id = ((safeJson(await ask(p.client, p.serials[0]!)) as CareJson).request!).id;
    // The label: a PDF sent as itself, of at most 2 MiB, with its carrier and tracking number.
    const text = await label(id, Buffer.from('not a pdf'), undefined, 'text/plain');
    expect(text.statusCode).toBe(415);
    expect(errorOf(text)).toEqual({ code: 'FILE_NOT_PDF', message: 'Send the label itself, as a PDF.' });
    const fake = await label(id, Buffer.from('GIF89a……'));
    expect(fake.statusCode).toBe(415);
    expect(errorOf(fake).code).toBe('FILE_NOT_PDF');
    const json = await operator.post(`/api/admin/care/${id}/label?carrierId=${carrierId}&tracking=6A12345678901`, { pdf: true });
    expect(errorOf(json).code).toBe('FILE_NOT_PDF');
    const big = await label(id, Buffer.concat([PDF, Buffer.alloc(CARE_LABEL_MAX_BYTES)]));
    expect(big.statusCode).toBe(413);
    expect(errorOf(big)).toEqual({ code: 'FILE_TOO_LARGE', message: 'The label is limited to 2 MB.' });
    expect((await label(id, PDF, 'tracking=6A12345678901')).statusCode).toBe(400);
    expect((await label(id, PDF, `carrierId=${carrierId}`)).statusCode).toBe(400);
    const sent = await label(id);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(safeJson(sent)).toMatchObject({ status: 'LABEL_SENT', label: { tracking: '6A12345678901', pdf: true } });
    // The collector reads it in the piece's SERVICE tab, and downloads it; nobody else does.
    const shown = safeJson(await care(p.client, p.serials[0]!)) as CareJson;
    expect(shown.request).toMatchObject({ status: 'LABEL_SENT', label: { tracking: '6A12345678901', pdf: true } });
    expect(shown.request!.label!.trackingUrl).toContain('6A12345678901');
    const pdf = await p.client.get(`/api/v1/account/care/${id}/label.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const stranger = await collector(1);
    expect((await stranger.client.get(`/api/v1/account/care/${id}/label.pdf`)).statusCode).toBe(404);
    // At the atelier: its YEARLY_CARE record open, the piece IN SERVICE.
    const received = safeJson(await operator.post(`/api/admin/care/${id}/receive`)) as { status: string; serviceRecordId: string };
    expect(received.status).toBe('RECEIVED');
    const piece = () => h.t.db.selectFrom('products').select(['status']).where('product_id', '=', p.serials[0]!).executeTakeFirstOrThrow();
    expect((await piece()).status).toBe('SERVICED');
    const record = () => h.t.db.selectFrom('service_records').select(['type', 'status', 'location']).where('id', '=', received.serviceRecordId).executeTakeFirstOrThrow();
    expect(await record()).toEqual({ type: 'YEARLY_CARE', status: 'OPEN', location: 'ORBES atelier' });
    // Shipped back, then completed: the record COMPLETED, the piece back to its status, YEARLY_CARE in SERVICE HISTORY.
    expect(errorOf(await operator.post(`/api/admin/care/${id}/complete`, {})).code).toBe('CARE_STEP');
    const back = await operator.post(`/api/admin/care/${id}/return`, { carrierId, tracking: '6A12345678902' });
    expect(safeJson(back)).toMatchObject({ status: 'RETURNING', return: { tracking: '6A12345678902' } });
    const done = await operator.post(`/api/admin/care/${id}/complete`, { notes: 'Polished, clasp checked.' });
    expect(safeJson(done)).toMatchObject({ status: 'DONE' });
    expect((await record()).status).toBe('COMPLETED');
    expect((await piece()).status).toBe('OWNED');
    const history = safeJson(await p.client.get(`/api/v1/products/${p.serials[0]}/service-history`)) as { services: { type: string; status: string }[] };
    expect(history.services).toEqual([expect.objectContaining({ type: 'YEARLY_CARE', status: 'COMPLETED' })]);
    expect((safeJson(await care(p.client, p.serials[0]!)) as CareJson).request).toMatchObject({ status: 'DONE' });
    // No step wrote a message or opened a conversation.
    expect(await counts()).toEqual(before);
    // The audit log: each step, with the piece and never the address.
    const actions = (await h.t.db.selectFrom('audit_logs').select('action').where('target_id', '=', id).orderBy('id').execute()).map((a) => a.action);
    expect(actions).toEqual(['care.request', 'care.label', 'care.receive', 'care.return', 'care.complete']);
  });

  it('runs a step and its service record in one transaction: a failure rolls both back; the console\'s service routes refuse YEARLY_CARE', async () => {
    const p = await collector(5);
    const id = ((safeJson(await ask(p.client, p.serials[0]!)) as CareJson).request!).id;
    expect((await label(id)).statusCode).toBe(200);
    const fail = `CREATE OR REPLACE FUNCTION care_test_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'RECEIVED' THEN RAISE EXCEPTION 'refused by the test'; END IF; RETURN NEW; END $$`;
    await sql.raw(fail).execute(h.t.db);
    await sql.raw(`CREATE TRIGGER care_test_refuse BEFORE UPDATE ON care_requests FOR EACH ROW EXECUTE FUNCTION care_test_refuse()`).execute(h.t.db);
    try {
      const res = await operator.post(`/api/admin/care/${id}/receive`);
      expect(res.statusCode).toBe(500);
      expect((await h.t.db.selectFrom('care_requests').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status).toBe('LABEL_SENT');
      const product = await h.t.db.selectFrom('products').select(['id', 'status']).where('product_id', '=', p.serials[0]!).executeTakeFirstOrThrow();
      expect(product.status).toBe('OWNED');
      expect(await h.t.db.selectFrom('service_records').select('id').where('product_id', '=', product.id).execute()).toEqual([]);
    } finally {
      await sql.raw(`DROP TRIGGER care_test_refuse ON care_requests`).execute(h.t.db);
      await sql.raw(`DROP FUNCTION care_test_refuse()`).execute(h.t.db);
    }
    const atelier = safeJson(await operator.post(`/api/admin/care/${id}/receive`)) as { status: string; serviceRecordId: string };
    expect(atelier.status).toBe('RECEIVED');
    // Only the care flow closes it too: the product page's complete route refuses it, the record stays OPEN.
    const notClosed = await operator.post(`/api/admin/services/${atelier.serviceRecordId}/complete`, {});
    expect(notClosed.statusCode).toBe(422);
    expect(errorOf(notClosed).code).toBe('VALIDATION_FAILED');
    expect((await h.t.db.selectFrom('service_records').select('status').where('id', '=', atelier.serviceRecordId).executeTakeFirstOrThrow()).status).toBe('OPEN');
    // Only the care flow opens a YEARLY_CARE record: the product page's route refuses it.
    const refused = await operator.post(`/api/admin/products/${p.serials[1]}/services`, { type: 'YEARLY_CARE', location: 'ORBES atelier' });
    expect(refused.statusCode).toBe(422);
    expect(errorOf(refused).code).toBe('VALIDATION_FAILED');
    // ORBES cancels a request at the atelier: its open record is cancelled with it, the piece back to its status.
    const cancelled = safeJson(await operator.post(`/api/admin/care/${id}/cancel`, { note: 'The client asked by phone.' })) as { status: string; serviceRecordId: string; cancelledBy: string; note: string };
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledBy: 'admin', note: 'The client asked by phone.' });
    expect((await h.t.db.selectFrom('service_records').select('status').where('id', '=', cancelled.serviceRecordId).executeTakeFirstOrThrow()).status).toBe('CANCELLED');
    expect((await h.t.db.selectFrom('products').select('status').where('product_id', '=', p.serials[0]!).executeTakeFirstOrThrow()).status).toBe('OWNED');
    expect((await operator.post(`/api/admin/care/${id}/cancel`, {})).statusCode).toBe(400);
  });

  it('erases the label\'s PDF 30 days after its request ended, and only then', async () => {
    const p = await collector(5);
    const id = ((safeJson(await ask(p.client, p.serials[0]!)) as CareJson).request!).id;
    expect((await label(id)).statusCode).toBe(200);
    expect((await operator.post(`/api/admin/care/${id}/cancel`, { note: 'Not needed.' })).statusCode).toBe(200);
    const pdf = () => h.t.db.selectFrom('care_requests').select((eb) => eb('label_pdf', 'is not', null).as('kept')).where('id', '=', id).executeTakeFirstOrThrow();
    expect(await eraseCareLabels(h.t.db, new Date(h.clock.now().getTime() + 29 * 86_400_000))).toBe(0);
    expect((await pdf()).kept).toBe(true);
    // The housekeeping's job (context.ts startHousekeeping, `careLabels`) runs this every pass.
    expect(await eraseCareLabels(h.t.db, new Date(h.clock.now().getTime() + 31 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await pdf()).kept).toBe(false);
    expect((await p.client.get(`/api/v1/account/care/${id}/label.pdf`)).statusCode).toBe(404);
  });

  it('shows an open request on the client\'s Messages row and conversation head, without writing anything there', async () => {
    const p = await collector(5);
    await h.ctx.services.messages.write(p.id, { body: 'A question about my pieces.' }, p.actor);
    const before = await counts();
    const id = ((safeJson(await ask(p.client, p.serials[0]!)) as CareJson).request!).id;
    expect(await counts()).toEqual(before);
    const board = safeJson(await operator.get('/api/admin/messages?status=ALL')) as { items: { account: { id: string }; care: { id: string; serial: string } | null; status: string }[] };
    const row = board.items.find((r) => r.account.id === p.id)!;
    expect(row.care).toEqual({ id, serial: p.serials[0] });
    expect(row.status).toBe('TO_ANSWER');
    const conv = (await h.t.db.selectFrom('client_conversations').select('id').where('account_id', '=', p.id).executeTakeFirstOrThrow()).id;
    expect(safeJson(await operator.get(`/api/admin/messages/${conv}`))).toMatchObject({ care: { id, serial: p.serials[0] }, status: 'TO_ANSWER' });
    // The care page links the conversation; a client without one reads « No conversation yet. » (null).
    expect(safeJson(await operator.get(`/api/admin/care/${id}`))).toMatchObject({ conversation: { conversationId: conv, status: 'TO_ANSWER' } });
    const lone = await collector(5);
    const loneId = ((safeJson(await ask(lone.client, lone.serials[0]!)) as CareJson).request!).id;
    expect(safeJson(await operator.get(`/api/admin/care/${loneId}`))).toMatchObject({ conversation: null });
    expect((await h.t.db.selectFrom('client_conversations').select('id').where('account_id', '=', lone.id).execute())).toEqual([]);
    // Once cancelled, the link goes.
    await p.client.post(`/api/v1/account/care/${id}/cancel`);
    expect((safeJson(await operator.get(`/api/admin/messages/${conv}`)) as { care: unknown }).care).toBeNull();
    // The board, by step, oldest first, the client's email masked for an AUDITOR.
    const requested = safeJson(await auditor.get('/api/admin/care?status=REQUESTED')) as { items: { id: string; account: { email: string }; tier: string; year: number }[] };
    const mine = requested.items.find((r) => r.id === loneId)!;
    expect(mine).toMatchObject({ tier: 'PLATINE', year: 2026 });
    expect(mine.account.email).not.toBe(lone.email);
    expect((await auditor.get('/api/admin/care?status=SOMETHING')).statusCode).toBe(400);
  });

  it('answers 401 signed out, refuses a write without the CSRF token or from another origin, and never lets a cache keep an answer', async () => {
    const p = await collector(5);
    const anon = h.client();
    for (const [method, url, body] of [
      ['GET', `/api/v1/account/products/${p.serials[0]}/care`],
      ['POST', `/api/v1/account/products/${p.serials[0]}/care`, ADDRESS],
      ['POST', `/api/v1/account/care/00000000-0000-4000-8000-000000000000/cancel`],
      ['GET', `/api/v1/account/care/00000000-0000-4000-8000-000000000000/label.pdf`],
    ] as const) {
      expect((await anon.request(method, url, body ? { body } : {})).statusCode, `${method} ${url}`).toBe(401);
    }
    expect(errorOf(await p.client.post(`/api/v1/account/products/${p.serials[0]}/care`, ADDRESS, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect((await p.client.post(`/api/v1/account/products/${p.serials[0]}/care`, ADDRESS, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect(await h.t.db.selectFrom('care_requests').select('id').where('account_id', '=', p.id).execute()).toEqual([]);
    const read = await care(p.client, p.serials[0]!);
    expect(read.headers['cache-control']).toBe('no-store');
  });
});
