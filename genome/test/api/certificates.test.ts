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
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { createForwardingLogger, loggerOptions } from '../../src/server/http/logging.js';
import { openText } from '../../src/server/crypto/secretbox.js';
import { cardAad, deriveCardClaimKey } from '../../src/server/services/receptions.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
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
    expectAttachment(card, /^application\/pdf$/, new RegExp(`^attachment; filename="ORBES-certificate-${a.product.productId}\\.pdf"$`));
    expect(card.rawPayload.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    const sheet = await post(operator, { items, format: 'pdf', layout: 'sheet' });
    expectAttachment(sheet, /^application\/pdf$/, /^attachment; filename="ORBES-certificates-\d{4}-\d{2}-\d{2}-2-sheet\.pdf"$/);

    const csv = await post(operator, { items, format: 'csv' });
    expectAttachment(csv, /^text\/csv; charset=utf-8/, /^attachment; filename="ORBES-certificates-\d{4}-\d{2}-\d{2}-2\.csv"$/);
    expect(csv.body).toBe(
      // 79t's columns (plan NEXT LOT §3.2): the variant line as printed (none for this model and piece) and the year.
      '"productId","model","variant","material","year","code"\r\n' +
        `"${a.product.productId}","MONOLITHE · RING","","925 STERLING SILVER","20${a.product.productId.slice(1, 3)}","${a.claimCode}"\r\n` +
        `"${b.product.productId}","MONOLITHE · RING","","925 STERLING SILVER","20${b.product.productId.slice(1, 3)}","${b.claimCode}"\r\n`,
    );

    // Audited with product ids, never the codes.
    const entries = (await h.ctx.audit.list({ action: 'certificate.render' })).items;
    expect(entries).toHaveLength(3);
    const last = entries.find((e) => e.details.format === 'csv')!;
    // codeIssues: the issue of the ORBES CODE printed for each product, in productIds order (plan NEXT LOT §3.2).
    expect(last.details).toEqual({
      productIds: [a.product.productId, b.product.productId],
      count: 2,
      format: 'csv',
      layoutStatus: 'VALIDATED',
      codeIssues: [a.code.issue, b.code.issue],
    });
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

    // Named by its row uuid, a refused product is audited under its canonical id, as a render is.
    const byUuid = await post(operator, { items: [{ productId: b.product.id, claimCode: wrong }] });
    expect(byUuid.statusCode).toBe(422);
    const underId = (await h.ctx.audit.list({ action: 'certificate.render_refused', targetId: b.product.productId })).items;
    expect(underId).toHaveLength(1);
    expect(underId[0].details).toMatchObject({ reason: 'CLAIM_CODE_MISMATCH', productIds: [b.product.productId], refused: [b.product.productId] });

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
    // The audit names a product found by its uuid by its canonical id, the unknown one by the reference given.
    const mixed = await post(operator, {
      items: [
        { productId: plain.product.id, claimCode: 'ABCD-EFGH-JKMN' },
        { productId: 'O26-J-99998', claimCode: 'ABCD-EFGH-JKMN' },
      ],
    });
    expect(mixed.statusCode).toBe(404);
    const notFound = (await h.ctx.audit.list({ action: 'certificate.render_refused' })).items.find((e) => (e.details.refused as string[]).includes('O26-J-99998'));
    expect(notFound?.details).toMatchObject({ reason: 'PRODUCT_NOT_FOUND', productIds: [plain.product.productId, 'O26-J-99998'], refused: ['O26-J-99998'] });

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

  it('refuses a piece with no ACTIVE code (409 NO_ACTIVE_CODE), after PRODUCT_NOT_PRINTABLE and before ALREADY_REGISTERED and the claim-code check', async () => {
    // Its code revoked with no new one: the card draws the ORBES CODE, so there is nothing to print.
    const a = await issue(h.ctx, catalog, { withClaimSecret: true });
    const b = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.issuance.revokeCode(a.code.id, 'label damaged', SYSTEM_ACTOR);
    const res = await post(operator, { items: [{ productId: b.product.productId, claimCode: b.claimCode }, { productId: a.product.productId, claimCode: a.claimCode }] });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toEqual({ code: 'NO_ACTIVE_CODE', message: `No active code for ${a.product.productId}: re-issue its code on the product page first.` });
    const refused = (await h.ctx.audit.list({ action: 'certificate.render_refused' })).items.filter((e) => e.details.reason === 'NO_ACTIVE_CODE');
    expect(refused).toHaveLength(1);
    expect(refused[0].details).toEqual({
      reason: 'NO_ACTIVE_CODE',
      productIds: [b.product.productId, a.product.productId],
      refused: [a.product.productId],
      format: 'pdf',
      layout: 'card',
    });

    // Before the claim-code check: a wrong code costs no scrypt and is not the answer.
    const wrong = await post(operator, { items: [{ productId: a.product.productId, claimCode: 'ZZZZ-ZZZZ-ZZZZ' }] });
    expect(errorOf(wrong).code).toBe('NO_ACTIVE_CODE');

    // Several pieces are named together.
    const c = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.issuance.revokeCode(c.code.id, 'label damaged', SYSTEM_ACTOR);
    const both = await post(operator, { items: [{ productId: a.product.productId, claimCode: a.claimCode }, { productId: c.product.productId, claimCode: c.claimCode }] });
    expect(errorOf(both)).toEqual({
      code: 'NO_ACTIVE_CODE',
      message: `No active code for ${a.product.productId}, ${c.product.productId}: re-issue their codes on the product page first.`,
    });

    // After PRODUCT_NOT_PRINTABLE: a revoked piece is refused as such.
    await h.ctx.services.lifecycle.transition(c.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    expect(errorOf(await post(operator, { items: [{ productId: c.product.productId, claimCode: c.claimCode }] })).code).toBe('PRODUCT_NOT_PRINTABLE');

    // Before ALREADY_REGISTERED: a registered piece whose code was then revoked.
    const sold = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.warranty.activate(sold.product.productId, { retailer: 'ORBES RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
    const owner = (await accountClient(h)).client;
    const reg = (safeJson(await owner.post('/api/v1/verify', { code: sold.code.data })) as { registration: { token: string } }).registration;
    expect((await owner.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: sold.claimCode })).statusCode).toBe(201);
    await h.ctx.services.issuance.revokeCode(sold.code.id, 'label damaged', SYSTEM_ACTOR);
    expect(errorOf(await post(operator, { items: [{ productId: sold.product.productId, claimCode: sold.claimCode }] })).code).toBe('NO_ACTIVE_CODE');

    // Re-issued, the piece prints again, and the audit names the new code's issue.
    const next = await h.ctx.services.issuance.reissueCode(a.product.productId, 'new label', SYSTEM_ACTOR);
    expect(next.issue).toBe(a.code.issue + 1);
    const card = await post(operator, { items: [{ productId: a.product.productId, claimCode: a.claimCode }] });
    expectAttachment(card, /^application\/pdf$/, /^attachment; filename="ORBES-certificate-O\d{2}-J-\d{5,6}\.pdf"$/);
    const rendered = (await h.ctx.audit.list({ action: 'certificate.render', targetId: a.product.productId })).items;
    expect(rendered).toHaveLength(1);
    expect(rendered[0].details).toMatchObject({ productIds: [a.product.productId], codeIssues: [next.issue] });

    for (const r of [res, wrong, both, card]) for (const s of spellings(a.claimCode!)) expect(r.body).not.toContain(s);
  });

  it('refuses an ACTIVE code that fails its end-to-end check (409 CODE_INTEGRITY), after NO_ACTIVE_CODE and before the claim-code check, and draws nothing', async () => {
    // As every other print of a code (API §5, §15.4): the card draws the ORBES CODE, so a code that would scan
    // INVALID_SIGNATURE or KEY_REVOKED never goes onto one. The message names the issue and the piece; what failed is logged.
    const refusedFor = async (productId: string) =>
      (await h.ctx.audit.list({ action: 'certificate.render_refused' })).items.filter((e) => e.details.reason === 'CODE_INTEGRITY' && (e.details.refused as string[])[0] === productId);
    const renderedFor = async (productId: string) => (await h.ctx.audit.list({ action: 'certificate.render', targetId: productId })).items;
    const expectRefused = async (p: { product: { productId: string }; code: { issue: number }; claimCode?: string }, detail: string) => {
      const res = await post(operator, { items: [{ productId: p.product.productId, claimCode: p.claimCode }] });
      expect(res.statusCode).toBe(409);
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(errorOf(res)).toEqual({ code: 'CODE_INTEGRITY', message: `Issue ${p.code.issue} of ${p.product.productId} failed its integrity check and cannot be rendered.` });
      expect(res.body).not.toMatch(/mismatch|revoked before|detail/);
      // Before the claim-code check: a wrong code gets the same answer.
      expect(errorOf(await post(operator, { items: [{ productId: p.product.productId, claimCode: 'ZZZZ-ZZZZ-ZZZZ' }] })).code).toBe('CODE_INTEGRITY');
      const refused = await refusedFor(p.product.productId);
      expect(refused).toHaveLength(2);
      expect(refused[0].details).toEqual({ reason: 'CODE_INTEGRITY', productIds: [p.product.productId], refused: [p.product.productId], format: 'pdf', layout: 'card' });
      expect(await renderedFor(p.product.productId)).toHaveLength(0);
      expect(lines.join('')).toContain(detail);
      for (const s of spellings(p.claimCode!)) expect(res.body).not.toContain(s);
    };

    // 1. A code recorded after the compromise date of its key, revoked since: the code stays ACTIVE.
    const before = await issue(h.ctx, catalog, { withClaimSecret: true });
    h.clock.advance(120_000); // two minutes: the compromise below falls between the two codes, the sessions stay open
    const signedLate = await issue(h.ctx, catalog, { withClaimSecret: true });
    const oldKey = (await h.ctx.keys.activeSigner()).keyId;
    await h.ctx.keys.rotate(SYSTEM_ACTOR);
    await h.ctx.keys.revoke(oldKey, { reason: 'compromise', compromisedAt: new Date(h.clock.now().getTime() - 60_000) }, SYSTEM_ACTOR);
    expect((await h.ctx.db.selectFrom('codes').select('status').where('id', '=', signedLate.code.id).executeTakeFirstOrThrow()).status).toBe('ACTIVE');
    await expectRefused(signedLate, 'signing key revoked before this code was recorded');
    // A code recorded before the compromise is still trusted, and prints.
    expectAttachment(await post(operator, { items: [{ productId: before.product.productId, claimCode: before.claimCode }] }), /^application\/pdf$/, /\.pdf"$/);

    // 2. A tampered row: its payload hash no longer matches its payload.
    const tampered = await issue(h.ctx, catalog, { withClaimSecret: true });
    const { payload_hash: hash } = await h.ctx.db.selectFrom('codes').select('payload_hash').where('id', '=', tampered.code.id).executeTakeFirstOrThrow();
    await sql`ALTER TABLE codes DISABLE TRIGGER codes_immutable_identity`.execute(h.ctx.db);
    try {
      await h.ctx.db.updateTable('codes').set({ payload_hash: new Uint8Array(32).fill(7) }).where('id', '=', tampered.code.id).execute();
      await expectRefused(tampered, 'payload hash mismatch');
      // In a batch, the piece at fault is named and nothing is drawn for the others either.
      const ok = await issue(h.ctx, catalog, { withClaimSecret: true });
      const batch = await post(operator, {
        items: [
          { productId: ok.product.productId, claimCode: ok.claimCode },
          { productId: tampered.product.productId, claimCode: tampered.claimCode },
        ],
        layout: 'sheet',
      });
      expect(errorOf(batch).code).toBe('CODE_INTEGRITY');
      expect(await renderedFor(ok.product.productId)).toHaveLength(0);
    } finally {
      await h.ctx.db.updateTable('codes').set({ payload_hash: hash }).where('id', '=', tampered.code.id).execute();
      await sql`ALTER TABLE codes ENABLE TRIGGER codes_immutable_identity`.execute(h.ctx.db);
    }
    expectAttachment(await post(operator, { items: [{ productId: tampered.product.productId, claimCode: tampered.claimCode }] }), /^application\/pdf$/, /\.pdf"$/);
  });

  it("prints 79t's file for a piece of a variant with its size: the variant line in the CSV, a vector PDF of one 95 × 62 mm page", async () => {
    const variant = await operator.post(`/api/admin/models/${catalog.modelId}/variants`, {
      label: 'Blue',
      swatch: '#1F3A6B',
      skuPrefix: `MNL-BL${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      mainLabel: 'Steel',
      mainSwatch: '#C9CCD1',
      // Plan NEXT LOT §3.3: its main model has no size type yet, so the variant is given its own, and its size ticked.
      sizeType: 'BRACELET',
    });
    expect(variant.statusCode, variant.body).toBe(201);
    const blue = (safeJson(variant) as { id: string }).id;
    expect((await operator.request('PUT', `/api/admin/models/${blue}/sizes`, { body: { ticked: ['17'] } })).statusCode).toBe(200);
    const p = await issue(h.ctx, { ...catalog, modelId: blue }, { withClaimSecret: true, variant: '17' });
    const items = [{ productId: p.product.productId, claimCode: p.claimCode }];

    const csv = await post(operator, { items, format: 'csv' });
    expectAttachment(csv, /^text\/csv; charset=utf-8/, /\.csv"$/);
    expect(csv.body.split('\r\n')[1]).toBe(`"${p.product.productId}","MONOLITHE · RING","BLUE  ·  SIZE 17","925 STERLING SILVER","20${p.product.productId.slice(1, 3)}","${p.claimCode}"`);

    const card = await post(operator, { items });
    expectAttachment(card, /^application\/pdf$/, new RegExp(`^attachment; filename="ORBES-certificate-${p.product.productId}\\.pdf"$`));
    // The objects without their (compressed) streams, and the streams inflated.
    const raw = card.rawPayload.toString('latin1');
    const objects = raw.replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, 'stream endstream');
    const streams = [...raw.matchAll(/(?<!end)stream\r?\n([\s\S]*?)endstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
        } catch {
          return m[1]; // a stream left uncompressed
        }
      })
      .join('\n');
    // One page of 95 × 62 mm (in points), drawn as outlines: no font, no image, no text, never the claim code, no PROOF.
    expect(objects).toMatch(/\/Count 1\b/);
    expect(objects).toMatch(/\/MediaBox \[0 0 269\.291339 175\.748031\]/);
    expect(objects).not.toMatch(/\/Font|\/Subtype\s*\/Image|\/XObject|\/Separation|PROOF/);
    expect(streams).toMatch(/\bf\n/); // the drawing was read: the type, the code, the GENOME as filled outlines
    expect(streams).toMatch(/\bW n\n/); // the guilloche's clips
    expect(streams).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\bBI\b|\bDo\b/);
    for (const s of spellings(p.claimCode!)) expect(raw + streams).not.toContain(s);
    const rendered = (await h.ctx.audit.list({ action: 'certificate.render', targetId: p.product.productId })).items;
    expect(rendered.map((e) => e.details)).toEqual([
      { productIds: [p.product.productId], count: 1, format: 'csv', layoutStatus: 'VALIDATED', codeIssues: [1] },
      { productIds: [p.product.productId], count: 1, format: 'pdf', layout: 'card', layoutStatus: 'VALIDATED', codeIssues: [1] },
    ].reverse());
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

  it('bounds the cost of a request: one render at a time per admin, checks stop at the first wrong code', async () => {
    const svc = h.ctx.services.certificates;
    const a = await issue(h.ctx, catalog, { withClaimSecret: true });
    const b = await issue(h.ctx, catalog, { withClaimSecret: true });
    const c = await issue(h.ctx, catalog, { withClaimSecret: true });
    const one: Actor = { type: 'admin', id: 'cost-test-one' };
    const other: Actor = { type: 'admin', id: 'cost-test-other' };
    const items = [
      { productId: a.product.productId, claimCode: a.claimCode! },
      { productId: b.product.productId, claimCode: b.claimCode! },
    ];

    // A second render of the same admin while the first is in progress: 429, nothing audited for it.
    const first = svc.render(items, {}, one);
    const again = svc.render(items, {}, one);
    const elsewhere = svc.render(items, { format: 'csv' }, other);
    await expect(again).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
    await expect(first).resolves.toMatchObject({ contentType: 'application/pdf' });
    await expect(elsewhere).resolves.toMatchObject({ filename: expect.stringMatching(/-2\.csv$/) });
    // Once it is done, the same admin may render again, even after a refusal.
    await expect(svc.render([{ productId: c.product.productId, claimCode: 'ZZZZ-ZZZZ-ZZZZ' }], {}, one)).rejects.toMatchObject({ code: 'CLAIM_CODE_MISMATCH' });
    await expect(svc.render(items, { format: 'csv' }, one)).resolves.toBeTruthy();

    // Wrong codes cost one check: the first mismatch is the refusal, the codes after it are not checked.
    const wrong = svc.render(
      [
        { productId: b.product.productId, claimCode: 'ZZZZ-ZZZZ-ZZZZ' },
        { productId: c.product.productId, claimCode: 'YYYY-YYYY-YYYY' },
      ],
      {},
      one,
    );
    await expect(wrong).rejects.toMatchObject({ code: 'CLAIM_CODE_MISMATCH', internal: { refused: [b.product.productId] } });
    const audited = (await h.ctx.audit.list({ action: 'certificate.render_refused' })).items.filter((e) =>
      (e.details.productIds as string[]).includes(c.product.productId),
    );
    expect(audited.at(0)?.details).toMatchObject({ reason: 'CLAIM_CODE_MISMATCH', refused: [b.product.productId] });
  });

  it('prints the cards of a reception (plan NEXT LOT §3.5.6.5) from their sealed codes, checked like any other; the claim codes never kept in clear, logs included; the sealed copies erased once attached', { timeout: 60_000 }, async () => {
    const staff: Actor = { type: 'admin', id: (await h.ctx.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow()).id };
    const nord = await h.ctx.services.suppliers.create({ name: 'Maison Nord', currency: 'EUR' }, staff);
    await h.ctx.services.suppliers.setModelSupplier(catalog.modelId, { supplierId: nord.id }, staff);
    const sku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
    const location = (await h.ctx.db.selectFrom('stock_locations').select('id').where('name', '=', 'LOGISTICS WAREHOUSE').executeTakeFirstOrThrow()).id;
    const draft = await h.ctx.services.supplierOrders.addToDraft({ skuId: sku, locationId: location, quantity: 2 }, staff);
    await h.ctx.services.supplierOrders.updateDraft(draft.id, { lines: [{ skuId: sku, quantity: 2, unitPriceMinor: 9_000 }], expectedOn: '2026-11-02' }, staff);
    await h.ctx.services.supplierOrders.send(draft.id, staff);
    const reception = await h.ctx.services.receptions.record(draft.id, { lines: [{ skuId: sku, accepted: 2, rejected: 0 }] }, staff, null);
    await h.ctx.services.receptions.confirm(reception.id, staff);
    await h.ctx.services.receptions.issuePending();
    const key = deriveCardClaimKey(h.ctx.config);
    const sealed = await h.ctx.db.selectFrom('card_prints').select(['product_id', 'sealed_claim_code']).where('reception_id', '=', reception.id).execute();
    const codes = sealed.map((c) => openText(key, c.sealed_claim_code!, cardAad(c.product_id)));
    expect(codes).toHaveLength(2);
    const res = await operator.post(`/api/admin/logistics/receptions/${reception.id}/cards`, { layout: 'card' });
    expectAttachment(res, /^application\/pdf$/, /^attachment; filename="ORBES-certificates-\d{4}-\d{2}-\d{2}-2-card\.pdf"$/);
    let kept = await everythingTheServerKept();
    for (const code of codes) for (const s of spellings(code)) expect(kept).not.toContain(s);
    // Attached: no sealed copy left.
    expect((await operator.post(`/api/admin/logistics/receptions/${reception.id}/cards-attached`)).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('card_prints').select('product_id').where('reception_id', '=', reception.id).where('sealed_claim_code', 'is not', null).execute()).toEqual([]);
    kept = await everythingTheServerKept();
    for (const c of sealed) expect(kept).not.toContain(c.sealed_claim_code!);
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
