/**
 * GET /api/admin/documents (the staff documents of the console): the list,
 * one document's Markdown, its illustrations, and 404 for anything else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, type Client, type Harness } from './support.js';

describe('admin documents', () => {
  let h: Harness;
  let auditor: Client;
  beforeAll(async () => {
    h = await createHarness();
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  it('lists the playbook and the kit', async () => {
    const res = await auditor.get('/api/admin/documents');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).documents.map((d: { id: string }) => d.id)).toEqual(['sales-playbook', 'packaging-kit']);
  });

  it('serves a document as Markdown', async () => {
    const res = await auditor.get('/api/admin/documents/sales-playbook');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ id: 'sales-playbook', lang: 'fr' });
    expect(body.markdown).toMatch(/^# ORBES — Procédure de vente et d'expédition/);
  });

  it('serves the illustrations the documents cite, with their type, and nothing else', async () => {
    const svg = await auditor.get('/api/admin/documents/assets/certificate-card-specimen.svg');
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/);
    const png = await auditor.get('/api/admin/documents/assets/admin-02-product.png');
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toMatch(/^image\/png/);
    for (const url of ['/api/admin/documents/assets/..%2F..%2Fconfig.ts', '/api/admin/documents/assets/SALES-PLAYBOOK.md', '/api/admin/documents/nope', '/api/admin/documents/__proto__']) {
      expect((await auditor.get(url)).statusCode, url).toBe(404);
    }
  });
});
