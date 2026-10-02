/**
 * POST /api/admin/certificates (§15.7): certificate cards that carry a
 * product's claim code. The claim code comes back from the console, is
 * checked against the product's hash, printed, and never kept: not in the
 * database, the audit log, the server log or an error body. Only OPERATOR
 * (and ADMIN) may ask; refusals are audited with product ids only.
 *
 * The harness runs with the production logger configuration at level
 * `trace` and the services' logger attached to it, as in src/server/index.ts,
 * and captures every line.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { createForwardingLogger, loggerOptions } from '../../src/server/http/logging.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('certificate cards API', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  const lines: string[] = [];
  const sink = { write: (s: string) => lines.push(s) };

  beforeAll(async () => {
    const log = createForwardingLogger(sink);
    h = await createHarness({ app: { logger: { ...(loggerOptions({ logLevel: 'trace' }) as object), stream: sink } }, context: { log } });
    log.attach(h.app.log);
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  /** Every spelling of a claim code a leak could take. */
  const spellings = (code: string) => [code, code.replace(/-/g, ''), code.replace(/-/g, ' '), code.toLowerCase()];

  async function everythingTheServerKept(): Promise<string> {
    const tables = await h.ctx.db
      .selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_schema' as never, '=', 'public' as never)
      .execute();
    let dump = '';
    for (const t of tables as { table_name: string }[]) {
      const rows = await h.ctx.db.selectFrom(t.table_name as never).selectAll().execute();
      dump += JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));
    }
    return dump + lines.join('');
  }

  const post = (c: Client, body: unknown, opts = {}) => c.post('/api/admin/certificates', body, opts);

  function expectAttachment(res: LightMyRequestResponse, type: RegExp, name: RegExp): void {
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toMatch(type);
    expect(res.headers['content-disposition']).toMatch(name);
    expect(res.headers['cache-control']).toBe('no-store');
  }

  it('renders a card, a sheet and the print-shop CSV for verified claim codes (OPERATOR)', async () => {
    const a = await issue(h.ctx, catalog, { withClaimSecret: true });
    const b = await issue(h.ctx, catalog, { withClaimSecret: true });
    const items = [
      { productId: a.product.productId, claimCode: a.claimCode },
      // Any spelling a person may type is accepted, as at registration.
      { productId: b.product.id, claimCode: ` ${b.claimCode!.toLowerCase().replace(/-/g, ' ')} ` },
    ];

    const card = await post(operator, { items: items.slice(0, 1) });
    expectAttachment(card, /^application\/pdf$/, new RegExp(`^attachment; filename="ORBES-certificate-${a.product.productId}-PROOF\\.pdf"$`));
    expect(card.rawPayload.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    const sheet = await post(operator, { items, format: 'pdf', layout: 'sheet' });
    expectAttachment(sheet, /^application\/pdf$/, /^attachment; filename="ORBES-certificates-\d{4}-\d{2}-\d{2}-2-sheet-PROOF\.pdf"$/);

    const csv = await post(operator, { items, format: 'csv' });
    expectAttachment(csv, /^text\/csv; charset=utf-8/, /^attachment; filename="ORBES-certificates-\d{4}-\d{2}-\d{2}-2\.csv"$/);
    expect(csv.body).toBe(
      '"productId","model","material","code"\r\n' +
        `"${a.product.productId}","MONOLITHE · RING","925 STERLING SILVER","${a.claimCode}"\r\n` +
        `"${b.product.productId}","MONOLITHE · RING","925 STERLING SILVER","${b.claimCode}"\r\n`,
    );

    // Audited with product ids, never the codes.
    const entries = (await h.ctx.audit.list({ action: 'certificate.render' })).items;
    expect(entries).toHaveLength(3);
    const last = entries.find((e) => e.details.format === 'csv')!;
    expect(last.details).toEqual({ productIds: [a.product.productId, b.product.productId], count: 2, format: 'csv', layoutStatus: 'PROOF' });
    expect(entries.find((e) => e.targetId === a.product.productId)?.details).toMatchObject({ format: 'pdf', layout: 'card', count: 1 });
    expect(entries.every((e) => e.actorType === 'admin' && e.ipHash)).toBe(true);

    // The codes were checked, printed and returned to the operator who issued them: never kept.
    const kept = await everythingTheServerKept();
    expect(kept).toContain(a.product.productId); // the dump does cover the rows and the log
    expect(kept).toContain('"url":"/api/admin/certificates"');
    for (const s of [...spellings(a.claimCode!), ...spellings(b.claimCode!)]) expect(kept).not.toContain(s);
  });

  it('refuses a code that does not match its product: 422 CLAIM_CODE_MISMATCH, audited without the code', async () => {
    const a = await issue(h.ctx, catalog, { withClaimSecret: true });
    const b = await issue(h.ctx, catalog, { withClaimSecret: true });
    const wrong = 'ZZZZ-ZZZZ-ZZZZ';
    const res = await post(operator, { items: [{ productId: a.product.productId, claimCode: a.claimCode }, { productId: b.product.productId, claimCode: wrong }] });
    expect(res.statusCode).toBe(422);
    const err = errorOf(res);
    expect(err.code).toBe('CLAIM_CODE_MISMATCH');
    expect(err.message).toContain(b.product.productId);
    expect(err.message).not.toContain(a.product.productId);

    // A malformed code can match nothing: the same refusal, and its text is not repeated either.
    const odd = 'not a claim code!';
    const malformed = await post(operator, { items: [{ productId: a.product.productId, claimCode: odd }] });
    expect(malformed.statusCode).toBe(422);
    expect(errorOf(malformed).code).toBe('CLAIM_CODE_MISMATCH');
    // Schema refusals do not repeat it either.
    const long = 'Q'.repeat(40);
    const tooLong = await post(operator, { items: [{ productId: a.product.productId, claimCode: long }] });
    expect(tooLong.statusCode).toBe(400);
    expect(errorOf(tooLong).code).toBe('VALIDATION_FAILED');

    for (const r of [res, malformed, tooLong]) {
      for (const s of [...spellings(a.claimCode!), ...spellings(wrong), odd, long]) expect(r.body).not.toContain(s);
    }

    const refused = (await h.ctx.audit.list({ action: 'certificate.render_refused' })).items.filter((e) => e.details.reason === 'CLAIM_CODE_MISMATCH');
    expect(refused).toHaveLength(2);
    expect(refused.find((e) => (e.details.productIds as string[]).length === 2)?.details).toEqual({
      reason: 'CLAIM_CODE_MISMATCH',
      productIds: [a.product.productId, b.product.productId],
      refused: [b.product.productId],
      format: 'pdf',
      layout: 'card',
    });
    // Nothing was rendered for the refused requests.
    expect((await h.ctx.audit.list({ action: 'certificate.render', targetId: a.product.productId })).items).toHaveLength(0);

    // The rejection was logged, without any code.
    expect(lines.some((l) => l.includes('CLAIM_CODE_MISMATCH'))).toBe(true);
    const kept = await everythingTheServerKept();
    for (const s of [...spellings(a.claimCode!), ...spellings(wrong), odd, long]) expect(kept).not.toContain(s);
  });

  it('refuses products without a claim code, unknown, registered or out of circulation', async () => {
    const plain = await issue(h.ctx, catalog, { withClaimSecret: false });
    const none = await post(operator, { items: [{ productId: plain.product.productId, claimCode: 'ABCD-EFGH-JKMN' }] });
    expect(none.statusCode).toBe(422);
    expect(errorOf(none).code).toBe('NO_CLAIM_SECRET');

    const unknown = await post(operator, { items: [{ productId: 'O26-J-99999', claimCode: 'ABCD-EFGH-JKMN' }] });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown)).toEqual({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found: O26-J-99999.' });

    // Registered: the claim code has been used, a new card would be worthless.
    const sold = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.warranty.activate(sold.product.productId, { retailer: 'ORBES RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
    const owner = (await accountClient(h)).client;
    const reg = (safeJson(await owner.post('/api/v1/verify', { code: sold.code.data })) as { registration: { token: string } }).registration;
    expect((await owner.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: sold.claimCode })).statusCode).toBe(201);
    const registered = await post(operator, { items: [{ productId: sold.product.productId, claimCode: sold.claimCode }] });
    expect(registered.statusCode).toBe(409);
    expect(errorOf(registered).code).toBe('ALREADY_REGISTERED');

    const revoked = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.lifecycle.transition(revoked.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    const gone = await post(operator, { items: [{ productId: revoked.product.productId, claimCode: revoked.claimCode }] });
    expect(gone.statusCode).toBe(409);
    expect(errorOf(gone).code).toBe('PRODUCT_NOT_PRINTABLE');

    const reasons = (await h.ctx.audit.list({ action: 'certificate.render_refused' })).items.map((e) => e.details.reason);
    for (const r of ['NO_CLAIM_SECRET', 'PRODUCT_NOT_FOUND', 'ALREADY_REGISTERED', 'PRODUCT_NOT_PRINTABLE']) expect(reasons).toContain(r);
  });

  it('validates the request: bounds, duplicates, formats, unknown fields', async () => {
    const a = await issue(h.ctx, catalog, { withClaimSecret: true });
    const item = { productId: a.product.productId, claimCode: a.claimCode };
    const bad = [
      {},
      { items: [] },
      { items: Array.from({ length: 51 }, () => item) },
      { items: [item, { productId: a.product.id, claimCode: a.claimCode }] },
      { items: [item], format: 'docx' },
      { items: [item], layout: 'poster' },
      { items: [{ ...item, note: 'x' }] },
      { items: [{ productId: 'nope', claimCode: a.claimCode }] },
    ];
    for (const body of bad) {
      const res = await post(operator, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      for (const s of spellings(a.claimCode!)) expect(res.body).not.toContain(s);
    }
    expect(errorOf(await post(operator, bad[3])).message).toBe(`${a.product.productId} appears more than once.`);
  });

  it('is OPERATOR-only and CSRF-protected', async () => {
    const a = await issue(h.ctx, catalog, { withClaimSecret: true });
    const body = { items: [{ productId: a.product.productId, claimCode: a.claimCode }] };
    const denied = await post(auditor, body);
    expect(denied.statusCode).toBe(403);
    expect(errorOf(denied).code).toBe('FORBIDDEN');
    const noCsrf = await post(operator, body, { noCsrf: true });
    expect(noCsrf.statusCode).toBe(403);
    expect(errorOf(noCsrf).code).toBe('CSRF_FAILED');
    expect((await post(h.client(), body)).statusCode).toBe(401);
    // Refused before the service: nothing audited for these.
    expect((await h.ctx.audit.list({ targetId: a.product.productId, action: 'certificate.render_refused' })).items).toHaveLength(0);
    const kept = await everythingTheServerKept();
    for (const s of spellings(a.claimCode!)) expect(kept).not.toContain(s);
  });
});
