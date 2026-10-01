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
});
