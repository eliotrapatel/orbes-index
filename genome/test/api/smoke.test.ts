import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, issue, seedCatalog, type Harness } from './support.js';

describe('smoke', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h?.close());
  it('works', async () => {
    const c = h.client();
    const res = await c.get('/api/v1/health');
    console.log(res.statusCode, res.headers, res.body);
    const cat = await seedCatalog(h.ctx);
    const p = await issue(h.ctx, cat);
    const v = await c.post('/api/v1/verify', { code: p.code.data });
    console.log(v.statusCode, v.headers['set-cookie'], v.body);
    expect(res.statusCode).toBe(200);
  });
});
