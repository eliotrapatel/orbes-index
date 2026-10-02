/**
 * Printing by production batch (A-03): the codes registry's filters
 * (production batch, model, code status, issue days), the ids of a batch's
 * printable codes (at most 1 000), the products' batch filter, and the print
 * sheet's manifest, which lists the labels in the PDF's order.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const DAY1 = '2026-03-02';
const DAY2 = '2026-03-03';
const BATCH_A = 'B-2026-03-A';
const BATCH_B = 'B-2026-03-B';

type CodeIds = { ids: string[]; total: number; truncated: boolean };

/** Rows of an RFC 4180 document whose every field is quoted. */
function parseCsv(csv: string): string[][] {
  return csv
    .replace(/\r\n$/, '')
    .split('\r\n')
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m) => m[1].replace(/""/g, '"')));
}

describe('admin codes: filters, batch ids and the print-sheet manifest', () => {
  let h: Harness;
  let auditor: Client;
  let operator: Client;
  let rings: Catalog;
  let pendants: Catalog;
  /** Batch A, day 1: a0 (re-issued on day 2), a1 (code revoked), a2 (LOST). Day 2: a3, a4. */
  const a: IssueResult[] = [];
  const b: IssueResult[] = [];
  let a0Reissued: string;
  let unbatched: IssueResult;

  beforeAll(async () => {
    h = await createHarness();
    rings = await seedCatalog(h.ctx);
    pendants = await seedCatalog(h.ctx);
    const { issuance, lifecycle } = h.ctx.services;
    h.clock.set(`${DAY1}T10:00:00.000Z`);
    for (const size of [48, 50, 52]) a.push(await issue(h.ctx, rings, { productionBatch: BATCH_A, variant: `Size ${size}` }));
    for (let i = 0; i < 2; i++) b.push(await issue(h.ctx, pendants, { productionBatch: BATCH_B }));
    await issuance.revokeCode(a[1].code.id, 'misprinted label', SYSTEM_ACTOR);
    await lifecycle.transition(a[2].product.productId, 'LOST', { reason: 'Lost in the workshop' }, SYSTEM_ACTOR);
    // Day 2, just before midnight UTC: still day 2 in UTC whatever the server's time zone.
    h.clock.set(`${DAY2}T23:30:00.000Z`);
    for (const size of [54, 56]) a.push(await issue(h.ctx, rings, { productionBatch: BATCH_A, variant: `Size ${size}` }));
    unbatched = await issue(h.ctx, rings);
    a0Reissued = (await issuance.reissueCode(a[0].product.productId, 'damaged label', SYSTEM_ACTOR)).id;
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
  }, 60_000);
  afterAll(() => h?.close());

  const list = async (query: string) => {
    const res = await auditor.get(`/api/admin/codes?pageSize=200&${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as { items: { id: string; productId: string; status: string; issuedAt: string; createdAt: string }[]; total: number; page: number; pageSize: number };
  };
  const ids = async (query: string) => {
    const res = await auditor.get(`/api/admin/codes/ids?${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as CodeIds;
  };
  const batch = (name: string) => `productionBatch=${encodeURIComponent(name)}`;

  describe('GET /api/admin/codes', () => {
    it('filters by production batch, newest first', async () => {
      const r = await list(batch(BATCH_A));
      // a0 holds two codes (SUPERSEDED + its re-issue), a1 a REVOKED one, a2 to a4 one each.
      expect(r.total).toBe(6);
      expect(new Set(r.items.map((c) => c.productId))).toEqual(new Set(a.map((x) => x.product.productId)));
      const times = r.items.map((c) => Date.parse(c.createdAt));
      expect(times).toEqual([...times].sort((x, y) => y - x));
      expect(r.items.slice(0, 3).map((c) => c.id).sort()).toEqual([a0Reissued, a[3].code.id, a[4].code.id].sort());
      expect((await list(batch(BATCH_B))).total).toBe(2);
      expect((await list(batch('B-2026-03'))).total).toBe(0); // exact, not a prefix
      expect((await list(batch(` ${BATCH_B} `))).total).toBe(2); // trimmed like the issued value
    });

    it('filters by model, code status and issue days (UTC, both included), and combines them', async () => {
      const byModel = await list(`modelId=${pendants.modelId}`);
      expect(byModel.items.map((c) => c.productId).sort()).toEqual(b.map((x) => x.product.productId).sort());
      const active = await list(`${batch(BATCH_A)}&status=ACTIVE`);
      expect(active.total).toBe(4);
      expect(active.items.every((c) => c.status === 'ACTIVE')).toBe(true);
      expect((await list(`${batch(BATCH_A)}&status=SUPERSEDED`)).items.map((c) => c.id)).toEqual([a[0].code.id]);
      expect((await list(`${batch(BATCH_A)}&status=REVOKED`)).items.map((c) => c.id)).toEqual([a[1].code.id]);

      const day1 = await list(`${batch(BATCH_A)}&issuedFrom=${DAY1}&issuedTo=${DAY1}`);
      expect(day1.items.map((c) => c.id).sort()).toEqual([a[0].code.id, a[1].code.id, a[2].code.id].sort());
      expect(day1.items.every((c) => c.issuedAt === DAY1)).toBe(true);
      const day2 = await list(`${batch(BATCH_A)}&issuedFrom=${DAY2}`);
      expect(day2.items.map((c) => c.id).sort()).toEqual([a0Reissued, a[3].code.id, a[4].code.id].sort());
      expect((await list(`issuedTo=${DAY1}`)).total).toBe(5); // everything issued on day 1, both batches
      expect((await list(`issuedFrom=${DAY2}&issuedTo=${DAY2}&status=ACTIVE&modelId=${rings.modelId}`)).total).toBe(4); // a0's re-issue, a3, a4, the unbatched one
      expect((await list('issuedFrom=2026-03-04')).total).toBe(0);
    });

    it('pages within the filters and ignores blank filter values', async () => {
      const page = async (n: number) => safeJson(await auditor.get(`/api/admin/codes?${batch(BATCH_A)}&pageSize=4&page=${n}`)) as { items: { id: string }[]; total: number };
      const [p1, p2] = [await page(1), await page(2)];
      expect([p1.total, p2.total]).toEqual([6, 6]);
      expect([p1.items.length, p2.items.length]).toEqual([4, 2]);
      expect(new Set([...p1.items, ...p2.items].map((c) => c.id)).size).toBe(6);
      const everything = await list('');
      expect(everything.total).toBe(9);
      expect((await list('productionBatch=&modelId=&status=&issuedFrom=&issuedTo=')).total).toBe(9);
      expect((await list('productionBatch=%20%20')).total).toBe(9);
    });

    it('refuses invalid filters (400)', async () => {
      for (const q of [
        `issuedFrom=${DAY2}&issuedTo=${DAY1}`,
        'issuedFrom=2026-02-30',
        'issuedFrom=0000-01-01', // PostgreSQL has no year 0000
        'issuedTo=03/03/2026',
        'status=LOST',
        'modelId=not-a-uuid',
        `productionBatch=${'x'.repeat(101)}`,
      ]) {
        const res = await auditor.get(`/api/admin/codes?${q}`);
        expect(res.statusCode, q).toBe(400);
        expect(errorOf(res).code, q).toBe('VALIDATION_FAILED');
        expect((await auditor.get(`/api/admin/codes/ids?${q}`)).statusCode, q).toBe(400);
      }
    });
  });

  describe('GET /api/admin/codes/ids', () => {
    it('answers the ACTIVE codes of printable products only, in identity order', async () => {
      // a1's code is REVOKED, a2 is LOST (not printable), a0 prints its re-issue.
      expect(await ids(batch(BATCH_A))).toEqual({ ids: [a0Reissued, a[3].code.id, a[4].code.id], total: 3, truncated: false });
      expect(await ids(`modelId=${pendants.modelId}`)).toEqual({ ids: b.map((x) => x.code.id), total: 2, truncated: false });
      expect(await ids(`${batch(BATCH_A)}&issuedTo=${DAY1}`)).toEqual({ ids: [], total: 0, truncated: false });
      expect(await ids(`${batch(BATCH_A)}&status=REVOKED`)).toEqual({ ids: [], total: 0, truncated: false });
      const all = await ids('');
      expect(all.ids).toEqual(expect.arrayContaining([unbatched.code.id, ...b.map((x) => x.code.id)]));
      expect(all.ids).not.toContain(a[2].code.id);
    });

    it('is a read: AUDITOR may list ids, and nothing is audited', async () => {
      const before = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      await ids(batch(BATCH_A));
      const after = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      expect(Number(after.n)).toBe(Number(before.n));
    });
  });

  describe('GET /api/admin/products?productionBatch=', () => {
    it('lists the products of one batch', async () => {
      const res = await auditor.get(`/api/admin/products?${batch(BATCH_A)}`);
      expect(res.statusCode).toBe(200);
      const body = safeJson(res) as { items: { productId: string; productionBatch: string }[]; total: number };
      expect(body.total).toBe(5);
      expect(body.items.every((p) => p.productionBatch === BATCH_A)).toBe(true);
      expect((safeJson(await auditor.get(`/api/admin/products?${batch(BATCH_B)}&status=ISSUED`)) as { total: number }).total).toBe(2);
      expect((safeJson(await auditor.get('/api/admin/products?productionBatch=')) as { total: number }).total).toBe(8);
      expect((await auditor.get(`/api/admin/products?productionBatch=${'x'.repeat(101)}`)).statusCode).toBe(400);
    });
  });

  describe('POST /api/admin/codes/print-sheet/manifest', () => {
    it('lists the labels in the order of the PDF, with what the workshop needs, and audits it', async () => {
      const codeIds = [a[4].code.id, a0Reissued, a[3].code.id, a[4].code.id];
      const res = await operator.post('/api/admin/codes/print-sheet/manifest', { codeIds, widthMm: 30, page: 'A4' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8; header=present');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="ORBES-sheet-${DAY2}-3-classic-30mm-manifest.csv"`);
      const rows = parseCsv(res.body);
      expect(rows[0]).toEqual(['page', 'row', 'column', 'productId', 'sku', 'variant', 'material', 'codeId']);
      const expected = [a[4], a[0], a[3]].map((x, i) => [
        '1',
        '1',
        String(i + 1),
        x.product.productId,
        x.product.sku,
        x.product.variant ?? '',
        x.product.material,
        x === a[0] ? a0Reissued : x.code.id,
      ]);
      expect(rows.slice(1)).toEqual(expected);
      expect(rows[1][5]).toBe('Size 56');

      const audit = await h.ctx.db.selectFrom('audit_logs').select(['action', 'actor_type', 'target_type', 'details']).where('action', '=', 'code.sheet_manifest').execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_type: 'admin',
        target_type: 'code',
        details: { codeIds: [a[4].code.id, a0Reissued, a[3].code.id], productIds: [a[4], a[0], a[3]].map((x) => x.product.productId), widthMm: 30, page: 'A4' },
      });
    });

    it('agrees with the print sheet: the same codes print, the same are refused', async () => {
      const codeIds = [a0Reissued, a[3].code.id];
      const sheet = await operator.post('/api/admin/codes/print-sheet', { codeIds, widthMm: 30 });
      const manifest = await operator.post('/api/admin/codes/print-sheet/manifest', { codeIds, widthMm: 30 });
      expect([sheet.statusCode, manifest.statusCode]).toEqual([200, 200]);
      expect(manifest.headers['content-disposition']).toBe(String(sheet.headers['content-disposition']).replace('.pdf"', '-manifest.csv"'));
      for (const [body, code] of [
        [{ codeIds: [a[0].code.id] }, 'CODE_NOT_ACTIVE'],
        [{ codeIds: [a[1].code.id] }, 'CODE_NOT_ACTIVE'],
        [{ codeIds: [a[2].code.id] }, 'PRODUCT_NOT_PRINTABLE'],
        [{ codeIds: ['00000000-0000-4000-8000-000000000000'] }, 'CODE_NOT_FOUND'],
        [{ codeIds: [a0Reissued], widthMm: 400 }, 'VALIDATION_FAILED'],
        [{ codeIds: [] }, 'VALIDATION_FAILED'],
        [{ codeIds: Array.from({ length: 201 }, () => a0Reissued) }, 'VALIDATION_FAILED'],
        [{ codeIds: [a0Reissued], definitelyNotAField: true }, 'VALIDATION_FAILED'],
      ] as const) {
        const s = await operator.post('/api/admin/codes/print-sheet', body);
        const m = await operator.post('/api/admin/codes/print-sheet/manifest', body);
        expect([errorOf(s).code, errorOf(m).code], JSON.stringify(body).slice(0, 80)).toEqual([code, code]);
        expect(m.statusCode).toBe(s.statusCode);
      }
    });

    it('needs OPERATOR and the CSRF token', async () => {
      const body = { codeIds: [a0Reissued] };
      const denied = await auditor.post('/api/admin/codes/print-sheet/manifest', body);
      expect(denied.statusCode).toBe(403);
      expect(errorOf(denied).code).toBe('FORBIDDEN');
      expect((await operator.post('/api/admin/codes/print-sheet/manifest', body, { noCsrf: true })).statusCode).toBe(403);
      expect((await h.client().post('/api/admin/codes/print-sheet/manifest', body)).statusCode).toBe(401);
    });
  });

  describe('a production batch of 120 codes', () => {
    it('prints from its ids in one sheet and one manifest, in serial order', async () => {
      const issued: IssueResult[] = [];
      for (let i = 0; i < 120; i++) issued.push(await issue(h.ctx, rings, { productionBatch: 'B-120', variant: `Size ${40 + (i % 30)}` }));
      const r = await ids(batch('B-120'));
      expect(r).toEqual({ ids: issued.map((x) => x.code.id), total: 120, truncated: false });
      const sheet = await operator.post('/api/admin/codes/print-sheet', { codeIds: r.ids, widthMm: 30, page: 'A4' });
      expect(sheet.statusCode, sheet.body.slice(0, 200)).toBe(200);
      expect(sheet.headers['content-disposition']).toMatch(/-120-classic-30mm\.pdf"$/);
      const rows = parseCsv((await operator.post('/api/admin/codes/print-sheet/manifest', { codeIds: r.ids, widthMm: 30, page: 'A4' })).body).slice(1);
      expect(rows.map((row) => row[3])).toEqual(issued.map((x) => x.product.productId));
      // 30 mm labelled codes: 5 columns × 6 rows = 30 per A4, so 4 pages.
      expect(rows.map((row) => row[0])).toEqual(Array.from({ length: 120 }, (_, i) => String(Math.floor(i / 30) + 1)));
      expect(rows[29].slice(0, 3)).toEqual(['1', '6', '5']);
      expect(rows[30].slice(0, 3)).toEqual(['2', '1', '1']);
    }, 120_000);
  });

  describe('the 1 000-id cap', () => {
    it('answers the first 1 000 of a larger batch and says it is truncated', async () => {
      // 1 001 codes written directly (the ids route reads rows; it never renders or verifies them).
      const cat = (await h.ctx.categories.getByCode('J'))!.index;
      const keyId = (await h.ctx.keys.activeSigner()).keyId;
      const db = h.ctx.db;
      await sql`
        INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material, production_batch)
        SELECT 'O25-J-' || lpad(s::text, 5, '0'), ((25::bigint << 25) | (${cat}::bigint << 20) | s), 2025, ${cat}, s, 'BULK-' || s, ${rings.modelId}::uuid, 'SILVER', 'BULK'
        FROM generate_series(20001, 21001) AS s`.execute(db);
      await sql`
        INSERT INTO genomes (product_id, genome_version, genome_id, value, glyphs, pattern, fingerprint)
        SELECT p.id, 1, p.product_id, 4000000000 + p.serial, '{0,0,0,0,0,0,0,0}', 'BULK',
               'G1-' || upper(lpad(to_hex((4000000000 + p.serial) >> 16), 4, '0')) || '-' || upper(lpad(to_hex((4000000000 + p.serial) & 65535), 4, '0'))
        FROM products p WHERE p.production_batch = 'BULK'`.execute(db);
      await sql`
        INSERT INTO codes (product_id, genome_id, key_id, code_version, issue, issued_day, nonce, payload, signature, payload_hash, status)
        SELECT p.id, g.id, ${keyId}, 1, 1, 800, '\\x00000000'::bytea, decode(lpad(to_hex(p.serial), 26, '0'), 'hex'),
               decode(repeat('00', 64), 'hex'), decode(lpad(to_hex(p.serial), 64, '0'), 'hex'), 'ACTIVE'
        FROM products p JOIN genomes g ON g.product_id = p.id WHERE p.production_batch = 'BULK'`.execute(db);

      const r = await ids(batch('BULK'));
      expect(r.total).toBe(1001);
      expect(r.truncated).toBe(true);
      expect(r.ids).toHaveLength(1000);
      expect(new Set(r.ids).size).toBe(1000);
      // Identity order: the cap drops the last serial.
      const last = await db.selectFrom('codes as c').innerJoin('products as p', 'p.id', 'c.product_id').select('c.id').where('p.serial', '=', 21001).executeTakeFirstOrThrow();
      const first = await db.selectFrom('codes as c').innerJoin('products as p', 'p.id', 'c.product_id').select('c.id').where('p.serial', '=', 20001).executeTakeFirstOrThrow();
      expect(r.ids[0]).toBe(first.id);
      expect(r.ids).not.toContain(last.id);
      expect((await list(batch('BULK'))).total).toBe(1001);
    }, 60_000);
  });
});
