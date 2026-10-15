/**
 * The warranty claims' routes (plan ORBES CARE of 2026-10-15, §2(c) « Routes », §2(f), step 1.7;
 * routes/admin/warranty-claims.ts, routes/admin/care.ts, routes/account.ts), as buildApp wires them:
 *
 *  - every console route: GET the Claims tab and a claim (AUDITOR, the clients' emails masked for an AUDITOR, in clear
 *    from OPERATOR); POST open, receive, decide, legal, ship and cancel (OPERATOR: Client Services take every step,
 *    answer 11); the roles themselves are probed in admin-roles.test.ts;
 *  - the label goes through PRIVATE CARE's upload path, POST /api/admin/care/:id/label, for both kinds of id: a care
 *    request's is the request's, a claim's is the claim's; the same PDF checks (415, 400) for both; an id of neither is
 *    404 as before;
 *  - the collector: the piece's care status carries its claim (`claim`, with `opens`), the claim's label is downloaded
 *    by its own account only (404 for any other), and nothing of the claim's staff side reaches it;
 *  - the bodies are strict (400 VALIDATION_FAILED for an unknown field, a bad outcome or basis).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountClient, adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';
import { holdPieces } from '../support/live.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const NOTE = 'Staff note ZWQ: the clasp, by phone.';

interface ClaimJson {
  id: string;
  status: string;
  basis: string;
  outcome: string | null;
  account: { id: string; email: string } | null;
  registeredOwner: { id: string; email: string } | null;
  label: { tracking: string; pdf: boolean } | null;
  serviceRecordId: string | null;
  note: string | null;
  continues: string | null;
  decision: { outcomes: string[]; refusalReasons: string[] };
}

describe('the warranty claims’ routes (plan ORBES CARE, step 1.7)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let carrierId: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-15T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    carrierId = (await h.t.db.selectFrom('carriers').select('id').where('active', '=', true).orderBy('name').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  /** A signed-in collector holding one piece (its 2-year warranty started on 1 March 2026), with its conversation. */
  async function collector() {
    const { client, email } = await accountClient(h);
    const id = (await h.t.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
    const [productUuid] = await holdPieces(h.t.db, id, 1, catalog.modelId);
    const serial = (await h.t.db.selectFrom('products').select('product_id').where('id', '=', productUuid!).executeTakeFirstOrThrow()).product_id;
    await h.t.db.insertInto('warranties').values({ product_id: productUuid!, purchase_date: '2026-03-01', start_date: '2026-03-01', duration_months: 24, end_date: '2028-03-01', lifetime: false }).execute();
    const conversationId = (await h.t.db.insertInto('client_conversations').values({ account_id: id, status: 'ANSWERED', last_message_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow()).id;
    return { client, email, id, serial, conversationId };
  }
  const label = (id: string, body: Buffer = PDF, type = 'application/pdf') =>
    operator.request('POST', `/api/admin/care/${id}/label?carrierId=${carrierId}&tracking=6A12345678901`, { body, headers: { 'content-type': type } });
  const care = (c: Client, serial: string) => c.get(`/api/v1/account/products/${serial}/care`);

  it('opens, labels, receives, decides and ships a claim through the routes, as an OPERATOR; the collector follows it and downloads its label', async () => {
    const c = await collector();
    const opened = await operator.post('/api/admin/warranty-claims', { conversationId: c.conversationId, productId: c.serial, basis: 'WARRANTY', note: NOTE });
    expect(opened.statusCode, opened.body).toBe(201);
    const claim = safeJson(opened) as ClaimJson;
    expect(claim).toMatchObject({ status: 'OPEN', basis: 'TWO_YEARS', account: { id: c.id, email: c.email }, registeredOwner: { id: c.id }, note: NOTE });
    expect(claim.decision.outcomes).toEqual(['REPLACEMENT', 'REPAIR', 'REFUSED']);
    // The collector's ORBES CARE tab: the claim with the care status, no staff side.
    const status = await care(c.client, c.serial);
    expect(status.statusCode).toBe(200);
    const s = safeJson(status) as { opens: unknown; claim: Record<string, unknown> | null };
    expect(s.opens).toEqual({ tier: 'PLATINE', allowance: 'ALL' });
    expect(s.claim).toMatchObject({ id: claim.id, status: 'OPEN', basis: 'TWO_YEARS', label: null });
    for (const k of ['note', 'openedBy', 'decidedBy']) expect(Object.keys(s.claim!)).not.toContain(k);
    expect(status.body).not.toContain(NOTE);
    // The label through the care upload path, the claim answered.
    expect((await label(claim.id, Buffer.from('not a pdf'))).statusCode).toBe(415);
    expect((await label(claim.id, Buffer.from('{}'), 'application/json')).statusCode).toBe(415);
    const missing = await operator.request('POST', `/api/admin/care/${claim.id}/label?carrierId=${carrierId}`, { body: PDF, headers: { 'content-type': 'application/pdf' } });
    expect(missing.statusCode).toBe(400);
    const labelled = await label(claim.id);
    expect(labelled.statusCode, labelled.body).toBe(200);
    expect(safeJson(labelled)).toMatchObject({ id: claim.id, status: 'LABEL_SENT', label: { tracking: '6A12345678901', pdf: true } });
    expect((safeJson(await care(c.client, c.serial)) as { claim: { label: { pdf: boolean } } }).claim.label).toMatchObject({ pdf: true, tracking: '6A12345678901' });
    // Its label: the account's own only.
    const pdf = await c.client.get(`/api/v1/account/warranty-claims/${claim.id}/label.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(String(pdf.headers['content-disposition'])).toContain(`ORBES-WARRANTY-CLAIM-${c.serial}-LABEL.pdf`);
    const other = await collector();
    expect((await other.client.get(`/api/v1/account/warranty-claims/${claim.id}/label.pdf`)).statusCode).toBe(404);
    expect((await h.client().get(`/api/v1/account/warranty-claims/${claim.id}/label.pdf`)).statusCode).toBe(401);
    // Received, decided (REPAIR), shipped back.
    expect((await operator.post(`/api/admin/warranty-claims/${claim.id}/receive`, { extra: true })).statusCode).toBe(400);
    const received = await operator.post(`/api/admin/warranty-claims/${claim.id}/receive`);
    expect(received.statusCode, received.body).toBe(200);
    expect(safeJson(received)).toMatchObject({ status: 'RECEIVED', serviceRecordId: expect.any(String) });
    expect((await operator.post(`/api/admin/warranty-claims/${claim.id}/decide`, { outcome: 'TELEPORT' })).statusCode).toBe(400);
    const credit = await operator.post(`/api/admin/warranty-claims/${claim.id}/decide`, { outcome: 'VALUE_CREDIT' });
    expect(credit.statusCode).toBe(422);
    expect(errorOf(credit).code).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    const decided = await operator.post(`/api/admin/warranty-claims/${claim.id}/decide`, { outcome: 'REPAIR' });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(safeJson(decided)).toMatchObject({ status: 'DECIDED', outcome: 'REPAIR' });
    expect(errorOf(await operator.post(`/api/admin/warranty-claims/${claim.id}/decide`, { outcome: 'REPAIR' })).code).toBe('CLAIM_STEP');
    const shipped = await operator.post(`/api/admin/warranty-claims/${claim.id}/ship`, { carrierId, tracking: '6A99999999999' });
    expect(shipped.statusCode, shipped.body).toBe(200);
    expect(safeJson(shipped)).toMatchObject({ status: 'DONE', return: { tracking: '6A99999999999' } });
    expect((safeJson(await care(c.client, c.serial)) as { claim: { status: string; outcome: string; return: { tracking: string } } }).claim).toMatchObject({ status: 'DONE', outcome: 'REPAIR', return: { tracking: '6A99999999999' } });
    // The audit names the OPERATOR who took each step.
    const steps = await h.t.db.selectFrom('audit_logs').select(['action', 'actor_type']).where('target_id', '=', claim.id).orderBy('id').execute();
    expect(steps.map((r) => r.action)).toEqual(['warranty.claim.open', 'warranty.claim.label', 'warranty.claim.receive', 'warranty.claim.decide', 'warranty.claim.ship']);
    expect(new Set(steps.map((r) => r.actor_type))).toEqual(new Set(['admin']));
  });

  it('the label path still serves PRIVATE CARE’s requests, and answers 404 for an id of neither', async () => {
    const { client, email } = await accountClient(h);
    const id = (await h.t.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
    const pieces = await holdPieces(h.t.db, id, 5, catalog.modelId);
    const serial = (await h.t.db.selectFrom('products').select('product_id').where('id', '=', pieces[0]!).executeTakeFirstOrThrow()).product_id;
    const asked = await client.post(`/api/v1/account/products/${serial}/care`, { name: 'Camille Martin', address: '12 rue de la Paix\n75002 Paris' });
    expect(asked.statusCode, asked.body).toBe(201);
    const requestId = (safeJson(asked) as { request: { id: string } }).request.id;
    const res = await label(requestId);
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ id: requestId, status: 'LABEL_SENT', year: 2026 });
    const none = await label('5b0a7c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b');
    expect(none.statusCode).toBe(404);
    expect(errorOf(none).code).toBe('CARE_REQUEST_NOT_FOUND');
  });

  it('closes a claim, moves a received 2-year claim to the legal guarantee, and lists the claims; an AUDITOR reads the emails masked', async () => {
    const c = await collector();
    const open = async () => safeJson(await operator.post('/api/admin/warranty-claims', { conversationId: c.conversationId, productId: c.serial, basis: 'WARRANTY' })) as ClaimJson;
    const a = await open();
    expect((await operator.post(`/api/admin/warranty-claims/${a.id}/cancel`, {})).statusCode).toBe(400);
    const closed = await operator.post(`/api/admin/warranty-claims/${a.id}/cancel`, { note: 'The client withdrew.' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(safeJson(closed)).toMatchObject({ status: 'CANCELLED', note: 'The client withdrew.' });
    // A boutique sale (no order): the legal guarantee needs the receipt in the note.
    const b = await open();
    expect((await label(b.id)).statusCode).toBe(200);
    expect((await operator.post(`/api/admin/warranty-claims/${b.id}/receive`)).statusCode).toBe(200);
    expect((await operator.post(`/api/admin/warranty-claims/${b.id}/legal`, { note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect(errorOf(await operator.post(`/api/admin/warranty-claims/${b.id}/legal`)).message).toBe('Write the receipt of the boutique sale in the note.');
    const moved = await operator.post(`/api/admin/warranty-claims/${b.id}/legal`, { note: 'Receipt 4471, boutique Paris, 1 March 2026.' });
    expect(moved.statusCode, moved.body).toBe(200);
    const legal = safeJson(moved) as ClaimJson;
    expect(legal).toMatchObject({ basis: 'LEGAL', status: 'RECEIVED', continues: b.id });
    expect(legal.decision.outcomes).toEqual(['REPLACEMENT', 'REPAIR', 'PRICE_REDUCTION', 'REFUND', 'REFUSED']);
    // The Claims tab: the claims under way first; `?status=`.
    const list = safeJson(await operator.get('/api/admin/warranty-claims')) as { items: ClaimJson[]; total: number };
    expect(list.items[0]!.id).toBe(legal.id);
    expect(list.items.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id, legal.id]));
    expect(list.items.find((r) => r.id === legal.id)!.account!.email).toBe(c.email);
    expect((safeJson(await operator.get('/api/admin/warranty-claims?status=CANCELLED')) as { items: ClaimJson[] }).items.every((r) => r.status === 'CANCELLED')).toBe(true);
    expect((await operator.get('/api/admin/warranty-claims?status=LOST')).statusCode).toBe(400);
    // An AUDITOR: the emails masked, in the list and the sheet.
    const masked = safeJson(await auditor.get('/api/admin/warranty-claims')) as { items: ClaimJson[] };
    expect(masked.items.find((r) => r.id === legal.id)!.account!.email).not.toBe(c.email);
    const sheet = safeJson(await auditor.get(`/api/admin/warranty-claims/${legal.id}`)) as ClaimJson;
    expect(sheet.account!.email).not.toBe(c.email);
    expect(sheet.registeredOwner!.email).not.toBe(c.email);
    expect((safeJson(await operator.get(`/api/admin/warranty-claims/${legal.id}`)) as ClaimJson).registeredOwner!.email).toBe(c.email);
    expect((await operator.get('/api/admin/warranty-claims/5b0a7c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b')).statusCode).toBe(404);
  });

  it('refuses a malformed opening: an unknown field, a basis of neither kind, no piece; the registered owner only', async () => {
    const c = await collector();
    const other = await collector();
    expect((await operator.post('/api/admin/warranty-claims', { conversationId: c.conversationId, productId: c.serial, basis: 'WARRANTY', photo: 'x' })).statusCode).toBe(400);
    expect((await operator.post('/api/admin/warranty-claims', { conversationId: c.conversationId, productId: c.serial, basis: 'LIFETIME' })).statusCode).toBe(400);
    expect((await operator.post('/api/admin/warranty-claims', { conversationId: c.conversationId, basis: 'WARRANTY' })).statusCode).toBe(400);
    const notOwner = await operator.post('/api/admin/warranty-claims', { conversationId: other.conversationId, productId: c.serial, basis: 'WARRANTY' });
    expect(notOwner.statusCode).toBe(409);
    expect(errorOf(notOwner)).toEqual({ code: 'CLAIM_NOT_REGISTERED', message: 'Only the registered owner of a piece can claim under its warranty.' });
    expect((await operator.post('/api/admin/warranty-claims', { conversationId: null, productId: c.serial, basis: 'WARRANTY' })).statusCode).toBe(409);
  });
});
