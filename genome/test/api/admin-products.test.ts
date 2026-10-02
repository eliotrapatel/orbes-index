import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, accountClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('admin products, codes and records', () => {
  let h: Harness;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  let modelId: string;
  let collectionId: string;

  beforeAll(async () => {
    h = await createHarness();
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  async function issueViaApi(extra: Record<string, unknown> = {}) {
    const res = await operator.post('/api/admin/products', { categoryCode: 'J', modelId, material: '925 STERLING SILVER', ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return safeJson(res) as { product: any; genome: any; code: any; claimCode?: string };
  }

  describe('catalogue', () => {
    it('creates a category (ADMIN), a collection and a model (OPERATOR)', async () => {
      const cat = await admin.post('/api/admin/categories', { code: 'J', name: 'Jewelry', warrantyMonths: 24 });
      expect(cat.statusCode).toBe(201);
      expect(safeJson(cat)).toMatchObject({ code: 'J', name: 'Jewelry', warrantyMonths: 24, active: true, index: expect.any(Number) });
      expect((await admin.post('/api/admin/categories', { code: 'J', name: 'Again' })).statusCode).toBe(409);
      expect((await admin.post('/api/admin/categories', { code: 'JJ', name: 'Bad' })).statusCode).toBe(400);

      const col = await operator.post('/api/admin/collections', { name: 'ORBIT' });
      expect(col.statusCode).toBe(201);
      collectionId = (safeJson(col) as any).id;
      expect((await operator.post('/api/admin/collections', { name: 'ORBIT' })).statusCode).toBe(409);

      const model = await operator.post('/api/admin/models', {
        categoryCode: 'j',
        collectionId,
        name: 'MONOLITHE',
        type: 'RING',
        skuPrefix: 'mnl-rg',
        defaultMaterial: '925 STERLING SILVER',
        careInstructions: 'Polish with a soft dry cloth.',
      });
      expect(model.statusCode, model.body).toBe(201);
      const m = safeJson(model) as any;
      expect(m).toMatchObject({ name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL-RG', category: { code: 'J' }, collection: { id: collectionId, name: 'ORBIT' } });
      modelId = m.id;
      expect((await operator.post('/api/admin/models', { categoryCode: 'J', name: 'X', type: 'Y', skuPrefix: 'MNL-RG' })).statusCode).toBe(409);
      expect((await operator.post('/api/admin/models', { categoryCode: 'Q', name: 'X', type: 'Y', skuPrefix: 'NEW' })).statusCode).toBe(404);

      const lists = await Promise.all(['/api/admin/categories', '/api/admin/collections', '/api/admin/models'].map((u) => auditor.get(u)));
      for (const l of lists) {
        expect(l.statusCode).toBe(200);
        expect((safeJson(l) as any).items.length).toBeGreaterThanOrEqual(1);
      }
      expect((safeJson(lists[1]) as any).items[0].models).toBe(1);

      // Catalogue writes are audited with the admin actor and hashed IP.
      const audit = await h.ctx.db.selectFrom('audit_logs').selectAll().where('action', 'in', ['collection.create', 'model.create', 'category.create']).execute();
      expect(audit.map((a) => a.action).sort()).toEqual(['category.create', 'collection.create', 'model.create']);
      for (const a of audit) {
        expect(a.actor_type).toBe('admin');
        expect(a.ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }
    });
  });

  describe('products', () => {
    it('issues a product with a claim code and returns the scannable code once', async () => {
      const r = await issueViaApi({ withClaimSecret: true, variant: 'Size 52', productionDate: '2026-01-15' });
      expect(r.product).toMatchObject({ productId: expect.stringMatching(/^O\d{2}-J-\d{5}$/), status: 'ISSUED', hasClaimSecret: true });
      expect(r.claimCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(r.code.data).toMatch(/^[A-Za-z0-9_-]{106}$/);
      expect(r.genome.fingerprint).toMatch(/^G1-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(JSON.stringify(r)).not.toMatch(/claim_secret_hash|scrypt\$/);

      const unknown = await operator.post('/api/admin/products', { categoryCode: 'J', modelId, material: 'x', price: 100 });
      expect(unknown.statusCode).toBe(400);
      expect(errorOf(unknown).code).toBe('VALIDATION_FAILED');
    });

    it('lists with filters and pagination, and shows full detail with live signature checks', async () => {
      const a = await issueViaApi();
      await issueViaApi();
      const all = safeJson(await auditor.get('/api/admin/products?pageSize=2')) as any;
      expect(all.page).toBe(1);
      expect(all.pageSize).toBe(2);
      expect(all.items).toHaveLength(2);
      expect(all.total).toBeGreaterThanOrEqual(3);

      const byQ = safeJson(await auditor.get(`/api/admin/products?q=${a.product.productId}`)) as any;
      expect(byQ.items.map((i: any) => i.productId)).toEqual([a.product.productId]);
      const wildcard = safeJson(await auditor.get('/api/admin/products?q=%25')) as any;
      expect(wildcard.total).toBe(0); // "%" is matched literally
      const byStatus = safeJson(await auditor.get('/api/admin/products?status=ISSUED&category=j')) as any;
      expect(byStatus.total).toBe(all.total);
      expect((await auditor.get('/api/admin/products?status=NOPE')).statusCode).toBe(400);

      const detail = await auditor.get(`/api/admin/products/${a.product.productId}`);
      expect(detail.statusCode).toBe(200);
      const d = safeJson(detail) as any;
      expect(d.product).toMatchObject({ productId: a.product.productId, category: { code: 'J', name: 'Jewelry' }, model: { name: 'MONOLITHE', type: 'RING' }, collection: 'ORBIT' });
      expect(d.genome.fingerprint).toBe(a.genome.fingerprint);
      expect(d.codes).toHaveLength(1);
      expect(d.codes[0].verification).toEqual({ valid: true, keyStatus: 'ACTIVE' });
      expect(d.codes[0].data).toBeUndefined(); // read views never carry the printable payload
      expect(d.lifecycle).toMatchObject({ status: 'ISSUED', allowed: expect.arrayContaining(['ACTIVATED', 'REVOKED']) });
      expect(d.statusHistory).toHaveLength(1);
      expect(d.warranty.status).toBe('NOT_STARTED');
      expect(d.scans).toEqual({ count: 0, lastAt: null });

      // A signature tampered with in the database (guard trigger bypassed, as a DB compromise would) shows up as invalid.
      await h.t.pglite.exec('ALTER TABLE codes DISABLE TRIGGER codes_immutable_identity');
      await h.t.pglite.query(`UPDATE codes SET signature = set_byte(signature, 0, get_byte(signature, 0) # 1) WHERE id = $1`, [a.code.id]);
      await h.t.pglite.exec('ALTER TABLE codes ENABLE TRIGGER codes_immutable_identity');
      const tampered = safeJson(await auditor.get(`/api/admin/products/${a.product.productId}`)) as any;
      expect(tampered.codes[0].verification).toEqual({ valid: false, reason: 'SIGNATURE_INVALID', keyStatus: 'ACTIVE' });

      expect((await auditor.get('/api/admin/products/O26-J-99999')).statusCode).toBe(404);
      expect((await auditor.get('/api/admin/products/garbage')).statusCode).toBe(400);
      // The detail also resolves the row uuid.
      expect((await auditor.get(`/api/admin/products/${a.product.id}`)).statusCode).toBe(200);
    });

    it('moves a product through its lifecycle; revocation and reinstatement are ADMIN-only', async () => {
      const p = await issueViaApi();
      const pid = p.product.productId;
      const act = await operator.post(`/api/admin/products/${pid}/transitions`, { to: 'ACTIVATED', reason: 'sold in store' });
      expect(act.statusCode).toBe(200);
      expect((safeJson(act) as any).statusChange).toMatchObject({ from: 'ISSUED', to: 'ACTIVATED' });
      const illegal = await operator.post(`/api/admin/products/${pid}/transitions`, { to: 'ISSUED' });
      expect(illegal.statusCode).toBe(409);

      expect((await operator.post(`/api/admin/products/${pid}/transitions`, { to: 'REVOKED', reason: 'test' })).statusCode).toBe(403);
      const revoke = await admin.post(`/api/admin/products/${pid}/transitions`, { to: 'REVOKED', reason: 'counterfeit investigation' });
      expect(revoke.statusCode).toBe(200);
      expect((safeJson(await h.client().post('/api/v1/verify', { code: p.code.data })) as any).state).toBe('REVOKED');

      expect((await operator.post(`/api/admin/products/${pid}/reinstate`, {})).statusCode).toBe(403);
      const back = await admin.post(`/api/admin/products/${pid}/reinstate`);
      expect(back.statusCode).toBe(200);
      expect((safeJson(back) as any).statusChange).toMatchObject({ from: 'REVOKED', to: 'ACTIVATED' });
      const revs = safeJson(await auditor.get('/api/admin/revocations')) as any;
      const row = revs.items.find((r: any) => r.targetId === pid);
      expect(row).toMatchObject({ targetType: 'PRODUCT', liftedBy: expect.stringMatching(/^admin:/) });
    });

    it('re-issues a code: the old one verifies as REVOKED, the new one as authentic', async () => {
      const p = await issueViaApi();
      expect((await operator.post(`/api/admin/products/${p.product.productId}/codes/reissue`, {})).statusCode).toBe(400);
      const res = await operator.post(`/api/admin/products/${p.product.productId}/codes/reissue`, { reason: 'label damaged' });
      expect(res.statusCode).toBe(201);
      const code = (safeJson(res) as any).code;
      expect(code).toMatchObject({ issue: 2, status: 'ACTIVE', data: expect.any(String) });
      const verifier = h.client();
      expect((safeJson(await verifier.post('/api/v1/verify', { code: p.code.data })) as any).state).toBe('REVOKED');
      expect((safeJson(await verifier.post('/api/v1/verify', { code: code.data })) as any).state).toBe('AUTHENTIC');
    });

    it('activates and voids warranties, opens and completes services', async () => {
      const p = await issueViaApi();
      const pid = p.product.productId;
      const act = await operator.post(`/api/admin/products/${pid}/warranty/activate`, { purchaseDate: '2026-03-01', retailer: 'ORBES PARIS', country: 'fr' });
      expect(act.statusCode, act.body).toBe(200);
      expect((safeJson(act) as any).warranty).toMatchObject({ status: 'ACTIVE', startDate: '2026-03-01', endDate: expect.any(String), country: 'FR' });
      expect((await operator.post(`/api/admin/products/${pid}/warranty/activate`, { purchaseDate: '2026-02-30' })).statusCode).toBe(400);

      const svc = await operator.post(`/api/admin/products/${pid}/services`, { type: 'RESIZE', location: 'Paris', notes: 'size 52 → 54' });
      expect(svc.statusCode).toBe(201);
      const serviceId = (safeJson(svc) as any).service.id;
      expect((await operator.post(`/api/admin/products/${pid}/services`, { type: 'TELEPORT' })).statusCode).toBe(400);
      const done = await operator.post(`/api/admin/services/${serviceId}/complete`, { notes: 'resized' });
      expect(done.statusCode).toBe(200);
      expect((safeJson(done) as any).service.status).toBe('COMPLETED');
      expect((await operator.post(`/api/admin/services/${serviceId}/complete`)).statusCode).toBe(409);

      const voided = await operator.post(`/api/admin/products/${pid}/warranty/void`, { reason: 'unauthorised modification' });
      expect(voided.statusCode).toBe(200);
      expect((safeJson(voided) as any).warranty.status).toBe('VOID');

      const list = safeJson(await auditor.get('/api/admin/warranties?status=VOID')) as any;
      expect(list.items.map((w: any) => w.productId)).toContain(pid);
      expect((await auditor.get('/api/admin/warranties?status=BROKEN')).statusCode).toBe(400);
    });

    it('confirms an unverified registration', async () => {
      const p = await issueViaApi();
      await operator.post(`/api/admin/products/${p.product.productId}/warranty/activate`, {});
      const { client } = await accountClient(h);
      const scan = safeJson(await client.post('/api/v1/verify', { code: p.code.data })) as any;
      const reg = await client.post('/api/v1/ownership/register', { registrationToken: scan.registration.token });
      expect((safeJson(reg) as any).verified).toBe(false);
      const confirm = await operator.post(`/api/admin/products/${p.product.productId}/ownership/confirm`);
      expect(confirm.statusCode).toBe(200);
      expect((safeJson(confirm) as any).ownership).toMatchObject({ verified: true });
      expect((await operator.post(`/api/admin/products/${p.product.productId}/ownership/confirm`)).statusCode).toBe(409);

      const owners = safeJson(await auditor.get('/api/admin/owners')) as any;
      expect(owners.items.some((o: any) => o.products >= 1)).toBe(true);
      const detail = safeJson(await auditor.get(`/api/admin/products/${p.product.productId}`)) as any;
      expect(detail.ownership.current).toMatchObject({ verified: true });
      expect(detail.ownership.owners).toHaveLength(1);
      expect(detail.scans.count).toBe(1);
    });
  });

  describe('batches', () => {
    const BATCH = 'B-2026-10-LOT';
    const template = (extra: Record<string, unknown> = {}) => ({ categoryCode: 'J', modelId, material: '925 STERLING SILVER', productionBatch: BATCH, productionDate: '2026-10-01', withClaimSecret: true, ...extra });
    const batchOf = async (productionBatch: string) => (safeJson(await auditor.get(`/api/admin/products?productionBatch=${productionBatch}&pageSize=200`)) as any).items as any[];

    it('issues a batch of 3: one result per piece, unique codes, claim codes shown once and never audited', async () => {
      const res = await operator.post('/api/admin/products/batch', { template: template(), items: [{ variant: 'Size 52' }, { variant: 'Size 54', sku: 'MNL-RG-54-POLI' }, {}] });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const b = safeJson(res) as any;
      expect(b).toMatchObject({ issued: 3, failed: 0, skipped: 0 });
      expect(b.items.map((i: any) => [i.index, i.status])).toEqual([[0, 'ISSUED'], [1, 'ISSUED'], [2, 'ISSUED']]);
      for (const i of b.items) {
        expect(i).toMatchObject({ productId: expect.stringMatching(/^O\d{2}-J-\d{5}$/), codeId: expect.stringMatching(/^[0-9a-f-]{36}$/), claimCode: expect.stringMatching(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/) });
        expect(Object.keys(i).sort()).toEqual(['claimCode', 'codeId', 'index', 'productId', 'serial', 'sku', 'status', 'variant']);
      }
      expect(b.items.map((i: any) => [i.variant, i.sku])).toEqual([
        ['Size 52', 'MNL-RG-SIZE-52'],
        ['Size 54', 'MNL-RG-54-POLI'],
        [null, 'MNL-RG'],
      ]);
      // Unique identities, codes and claim codes; consecutive serials.
      for (const k of ['productId', 'codeId', 'claimCode', 'serial']) expect(new Set(b.items.map((i: any) => i[k])).size, k).toBe(3);
      expect(b.items[1].serial - b.items[0].serial).toBe(1);
      expect(b.items[2].serial - b.items[1].serial).toBe(1);

      // All three in Products under the batch, each with its own active code that verifies.
      const listed = await batchOf(BATCH);
      expect(listed.map((p) => p.productId).sort()).toEqual(b.items.map((i: any) => i.productId).sort());
      expect(listed.every((p) => p.productionBatch === BATCH && p.codeId && p.status === 'ISSUED')).toBe(true);
      // The claim codes are the products' own: the certificate route checks each against its hash.
      const cards = await operator.post('/api/admin/certificates', { items: b.items.map((i: any) => ({ productId: i.productId, claimCode: i.claimCode })), format: 'csv' });
      expect(cards.statusCode, cards.body.slice(0, 200)).toBe(200);

      // Audited: one product.issue per piece and the batch's summary, with the admin and hashed IP; no claim code anywhere.
      const summary = await h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', 'product.issue_batch').execute();
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatchObject({ actor_type: 'admin', target_type: 'product', target_id: null, ip_hash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
      expect(summary[0].details).toEqual({
        count: 3,
        issued: 3,
        failed: 0,
        skipped: 0,
        productIds: b.items.map((i: any) => i.productId),
        failures: [],
        category: 'J',
        modelId,
        productionBatch: BATCH,
        claimSecret: true,
      });
      const perPiece = await h.ctx.db.selectFrom('audit_logs').select('target_id').where('action', '=', 'product.issue').where('target_id', 'in', b.items.map((i: any) => i.productId)).execute();
      expect(perPiece).toHaveLength(3);
      const log = JSON.stringify(await h.ctx.db.selectFrom('audit_logs').select('details').execute());
      for (const i of b.items) expect(log).not.toContain(i.claimCode.replace(/-/g, '').slice(0, 8));
    });

    it('refuses 51 pieces, an invalid line or an unknown model (400 / 404) with nothing signed; AUDITOR and a missing CSRF token get 403', async () => {
      const before = (safeJson(await auditor.get('/api/admin/products?pageSize=1')) as any).total;
      const tooMany = await operator.post('/api/admin/products/batch', { template: template(), items: Array.from({ length: 51 }, () => ({})) });
      expect(tooMany.statusCode).toBe(400);
      expect(errorOf(tooMany)).toEqual({ code: 'VALIDATION_FAILED', message: 'items: At most 50 pieces per request.' });
      expect((await operator.post('/api/admin/products/batch', { template: template(), items: [] })).statusCode).toBe(400);
      expect((await operator.post('/api/admin/products/batch', { items: [{}] })).statusCode).toBe(400);
      expect(errorOf(await operator.post('/api/admin/products/batch', { template: template({ price: 1 }), items: [{}] })).message).toMatch(/unknown fields in template: price/);
      expect(errorOf(await operator.post('/api/admin/products/batch', { template: template(), items: [{}, { variant: '52', size: 'L' }] })).message).toMatch(/unknown fields in items\.1: size/);
      expect(errorOf(await operator.post('/api/admin/products/batch', { template: template(), items: [{}, {}, { sku: '-bad' }] })).message).toMatch(/^items\.2\.sku: /);
      // The service checks each line with the issue rules too (a tab is a control character there).
      expect(errorOf(await operator.post('/api/admin/products/batch', { template: template(), items: [{}, { variant: 'a\tb' }] })).message).toBe('items.1: Variant contains invalid characters.');
      expect(errorOf(await operator.post('/api/admin/products/batch', { template: template(), items: [{ serial: 4242 }, { serial: 4242 }] })).message).toBe('items.1.serial: the same serial as items.0.');
      const unknownModel = await operator.post('/api/admin/products/batch', { template: template({ modelId: '00000000-0000-4000-8000-000000000000' }), items: [{}] });
      expect(unknownModel.statusCode).toBe(404);
      expect(errorOf(unknownModel).code).toBe('MODEL_NOT_FOUND');

      const asAuditor = await auditor.post('/api/admin/products/batch', { template: template(), items: [{}] });
      expect(asAuditor.statusCode).toBe(403);
      expect(errorOf(asAuditor).code).toBe('FORBIDDEN');
      expect((await operator.post('/api/admin/products/batch', { template: template(), items: [{}] }, { noCsrf: true })).statusCode).toBe(403);
      expect((safeJson(await auditor.get('/api/admin/products?pageSize=1')) as any).total).toBe(before);
    });

    it('a serial conflict fails its piece alone; the other pieces are issued', async () => {
      const taken = (await issueViaApi()).product.serial;
      const res = await operator.post('/api/admin/products/batch', { template: template({ productionBatch: 'B-2026-10-CONFLICT' }), items: [{ variant: '50' }, { serial: taken }, { variant: '56' }] });
      expect(res.statusCode, res.body).toBe(200);
      const b = safeJson(res) as any;
      expect(b).toMatchObject({ issued: 2, failed: 1, skipped: 0 });
      expect(b.items[1]).toEqual({ index: 1, status: 'FAILED', error: { code: 'SERIAL_TAKEN', message: 'This serial number is already used.' } });
      expect([b.items[0].status, b.items[2].status]).toEqual(['ISSUED', 'ISSUED']);
      expect((await batchOf('B-2026-10-CONFLICT')).map((p) => p.variant).sort()).toEqual(['50', '56']);
      const summary = await h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'product.issue_batch').orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(summary.details).toMatchObject({ issued: 2, failed: 1, failures: [{ index: 1, code: 'SERIAL_TAKEN' }] });
    });

    it('signs one batch at a time per admin: a second one sent meanwhile answers 429', async () => {
      const [a, b] = await Promise.all([
        operator.post('/api/admin/products/batch', { template: template({ productionBatch: 'B-2026-10-TWICE' }), items: [{}, {}] }),
        operator.post('/api/admin/products/batch', { template: template({ productionBatch: 'B-2026-10-TWICE' }), items: [{}] }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
      const refused = a.statusCode === 429 ? a : b;
      expect(errorOf(refused)).toEqual({ code: 'RATE_LIMITED', message: 'A batch is already being signed. Wait for it to finish, then try again.' });
      expect((await batchOf('B-2026-10-TWICE')).length).toBe(a.statusCode === 200 ? 2 : 1);
    });
  });

  describe('code artifacts', () => {
    it('downloads SVG, PNG and PDF as audited attachments', async () => {
      const p = await issueViaApi();
      const svg = await operator.get(`/api/admin/codes/${p.code.id}/artifact.svg?widthMm=25&theme=ivory&label=true&decor=false`);
      expect(svg.statusCode, svg.body.slice(0, 200)).toBe(200);
      expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/);
      expect(svg.headers['content-disposition']).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.svg"$/);
      expect(svg.headers['cache-control']).toBe('no-store');
      expect(svg.headers['content-security-policy']).toMatch(/default-src 'none'.*sandbox/);
      expect(svg.body).toMatch(/^<\?xml|^<svg/);

      const png = await operator.get(`/api/admin/codes/${p.code.id}/artifact.png?dpi=150`);
      expect(png.statusCode).toBe(200);
      expect(png.headers['content-type']).toBe('image/png');
      expect(png.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const pdf = await operator.get(`/api/admin/codes/${p.code.id}/artifact.pdf`);
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

      expect((await operator.get(`/api/admin/codes/${p.code.id}/artifact.gif`)).statusCode).toBe(400);
      expect((await operator.get(`/api/admin/codes/${p.code.id}/artifact.png?dpi=1`)).statusCode).toBe(400);
      expect((await operator.get(`/api/admin/codes/${p.code.id}/artifact.svg?theme=neon`)).statusCode).toBe(400);
      expect((await auditor.get(`/api/admin/codes/${p.code.id}/artifact.svg`)).statusCode).toBe(403);

      const renders = await h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', 'code.render').where('target_id', '=', p.code.id).execute();
      expect(renders).toHaveLength(3);
      for (const r of renders) expect(r.ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('renders a multi-up print sheet (OPERATOR, CSRF-protected)', async () => {
      const a = await issueViaApi();
      const b = await issueViaApi();
      const sheet = await operator.post('/api/admin/codes/print-sheet', { codeIds: [a.code.id, b.code.id], page: 'A4', widthMm: 20 });
      expect(sheet.statusCode, sheet.body.slice(0, 200)).toBe(200);
      expect(sheet.headers['content-type']).toBe('application/pdf');
      expect(sheet.headers['content-disposition']).toMatch(/^attachment; filename=".+\.pdf"$/);
      expect(sheet.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect((await operator.post('/api/admin/codes/print-sheet', { codeIds: [] })).statusCode).toBe(400);
      expect((await operator.post('/api/admin/codes/print-sheet', { codeIds: [a.code.id], page: 'A9' })).statusCode).toBe(400);
      expect((await auditor.post('/api/admin/codes/print-sheet', { codeIds: [a.code.id] })).statusCode).toBe(403);
      expect((await operator.post('/api/admin/codes/print-sheet', { codeIds: [a.code.id] }, { noCsrf: true })).statusCode).toBe(403);
      const audit = await h.ctx.db.selectFrom('audit_logs').select(['action', 'ip_hash']).where('action', '=', 'code.render_sheet').execute();
      expect(audit).toHaveLength(1);
      expect(audit[0].ip_hash).toBeTruthy();
    });

    it('revokes a code (ADMIN) and lists codes and genomes without payloads', async () => {
      const p = await issueViaApi();
      expect((await operator.post(`/api/admin/codes/${p.code.id}/revoke`, { reason: 'x' })).statusCode).toBe(403);
      const res = await admin.post(`/api/admin/codes/${p.code.id}/revoke`, { reason: 'leaked artwork' });
      expect(res.statusCode).toBe(200);
      expect((safeJson(res) as any).code).toMatchObject({ id: p.code.id, status: 'REVOKED', revocationReason: 'leaked artwork' });
      expect((await admin.post(`/api/admin/codes/${p.code.id}/revoke`, { reason: 'again' })).statusCode).toBe(409);
      expect((await admin.post(`/api/admin/codes/00000000-0000-4000-8000-000000000000/revoke`, { reason: 'x' })).statusCode).toBe(404);
      expect((safeJson(await h.client().post('/api/v1/verify', { code: p.code.data })) as any).state).toBe('REVOKED');
      // A revoked code is never printed again.
      expect((await operator.get(`/api/admin/codes/${p.code.id}/artifact.svg`)).statusCode).toBe(409);

      const codes = safeJson(await auditor.get('/api/admin/codes?pageSize=500')) as any;
      expect(codes.pageSize).toBe(200);
      expect(codes.items.find((c: any) => c.id === p.code.id)).toMatchObject({ status: 'REVOKED' });
      expect(JSON.stringify(codes)).not.toContain(p.code.data);
      const genomes = safeJson(await auditor.get('/api/admin/genomes?page=1&pageSize=1')) as any;
      expect(genomes).toMatchObject({ page: 1, pageSize: 1, total: expect.any(Number) });
      expect(genomes.items[0]).toMatchObject({ versionLabel: 'GENOME-01', glyphs: expect.any(Array), ids: expect.any(Array) });
    });
  });

  describe('scans, anomalies, dashboard', () => {
    it('shows scan and authentication events with internal detail to admins only', async () => {
      const p = await issueViaApi();
      await h.client().post('/api/v1/verify', { code: p.code.data });
      const scans = safeJson(await auditor.get(`/api/admin/scans?productId=${p.product.productId}`)) as any;
      expect(scans.total).toBe(1);
      expect(scans.items[0]).toMatchObject({
        productId: p.product.productId,
        state: 'AUTHENTIC',
        eventType: 'VERIFY',
        authentication: { signatureValid: true, riskScore: expect.any(Number) },
      });
      const none = safeJson(await auditor.get('/api/admin/scans?productId=O26-J-99999')) as any;
      expect(none.total).toBe(0);
      const byState = safeJson(await auditor.get('/api/admin/scans?state=MALFORMED_CODE')) as any;
      expect(byState.items.every((s: any) => s.state === 'MALFORMED_CODE')).toBe(true);
      expect((await auditor.get('/api/admin/scans?state=FINE')).statusCode).toBe(400);
    });

    it('lists and triages anomalies', async () => {
      // A genome reading that contradicts the signed identity raises GENOME_MISMATCH.
      const p = await issueViaApi();
      const wrong = p.genome.glyphs.map((g: number) => (g + 1) % 16);
      const v = safeJson(await h.client().post('/api/v1/verify', { code: p.code.data, genome: { glyphs: wrong } })) as any;
      expect(v.state).toBe('SUSPICIOUS_ACTIVITY');
      const list = safeJson(await auditor.get('/api/admin/anomalies?status=OPEN')) as any;
      const anomaly = list.items.find((a: any) => a.productId === p.product.productId);
      expect(anomaly).toMatchObject({ type: 'GENOME_MISMATCH', status: 'OPEN' });
      expect((await auditor.patch(`/api/admin/anomalies/${anomaly.id}`, { status: 'ACKNOWLEDGED' })).statusCode).toBe(403);
      const patched = await operator.patch(`/api/admin/anomalies/${anomaly.id}`, { status: 'RESOLVED', note: 'scanner glare' });
      expect(patched.statusCode).toBe(200);
      expect(safeJson(patched)).toMatchObject({ status: 'RESOLVED', resolutionNote: 'scanner glare' });
      expect((await operator.patch(`/api/admin/anomalies/${anomaly.id}`, { status: 'GONE' })).statusCode).toBe(400);
      expect((await auditor.get('/api/admin/anomalies?severity=HUGE')).statusCode).toBe(400);
    });

    it('summarises the registry on the dashboard', async () => {
      const res = await auditor.get('/api/admin/dashboard');
      expect(res.statusCode).toBe(200);
      const d = safeJson(res) as any;
      expect(d.products.total).toBeGreaterThan(0);
      expect(d.products.byStatus).toHaveProperty('ISSUED');
      expect(d.scans.last24h).toBeGreaterThan(0);
      expect(d.scans.last7d).toBeGreaterThanOrEqual(d.scans.last24h);
      expect(d.anomalies.openBySeverity).toHaveProperty('CRITICAL');
      expect(d.activeKey).toMatchObject({ keyId: 1 });
      expect(d.recentEvents.length).toBeGreaterThan(0);
      expect(d.recentEvents.length).toBeLessThanOrEqual(10);
    });
  });

  it('audited every admin action of this suite with the admin id and hashed IP', async () => {
    const rows = await h.ctx.db.selectFrom('audit_logs').select(['action', 'actor_id', 'ip_hash']).where('actor_type', '=', 'admin').execute();
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.actor_id, r.action).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.ip_hash, r.action).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['product.issue', 'product.transition', 'product.reinstate', 'code.reissue', 'code.revoke', 'code.render', 'warranty.activate', 'warranty.void', 'service.open', 'service.complete', 'ownership.confirm', 'anomaly.update', 'admin.login']) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});
