import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheControlFor, IMMUTABLE_CACHE, REVALIDATE_CACHE } from '../../src/server/http/static.js';
import { createHarness, type Harness } from './support.js';

describe('static web apps', () => {
  let h: Harness;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orbes-web-'));
    mkdirSync(join(dir, 'verify'));
    mkdirSync(join(dir, 'admin'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'verify', 'index.html'), '<!doctype html><title>VERIFY</title>');
    writeFileSync(join(dir, 'admin', 'index.html'), '<!doctype html><title>ADMIN</title>');
    writeFileSync(join(dir, 'assets', 'verify-4F2KQ7ZB.js'), 'console.log(1)');
    writeFileSync(join(dir, 'assets', 'gravesend-sans-500-JQUMMK2Q.woff2'), 'wOF2');
    writeFileSync(join(dir, 'assets', 'brand.css'), 'body{}');
    writeFileSync(join(dir, 'assets', '.env'), 'SECRET=1');
    writeFileSync(join(dir, 'secret.txt'), 'not public');
    h = await createHarness({ app: { serveStatic: true, staticDir: dir } });
  });
  afterAll(async () => {
    await h?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('redirects / to /verify', async () => {
    const res = await h.client().get('/');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/verify');
  });

  it('serves the app shells with no-cache and the CSP', async () => {
    const c = h.client();
    for (const [url, title] of [
      ['/verify', 'VERIFY'],
      ['/verify/', 'VERIFY'],
      ['/verify/pieces', 'VERIFY'],
      ['/verify/result/abc', 'VERIFY'],
      ['/admin', 'ADMIN'],
      ['/admin/products/O26-J-00001', 'ADMIN'],
    ] as const) {
      const res = await c.get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.body).toContain(`<title>${title}</title>`);
      expect(res.headers['cache-control']).toBe(REVALIDATE_CACHE);
      expect(res.headers['content-security-policy']).toMatch(/^default-src 'self'/);
    }
  });

  it('serves hashed assets as immutable and others with revalidation', async () => {
    const c = h.client();
    const hashed = await c.get('/assets/verify-4F2KQ7ZB.js');
    expect(hashed.statusCode).toBe(200);
    expect(hashed.headers['cache-control']).toBe(IMMUTABLE_CACHE);
    expect(hashed.headers['content-type']).toMatch(/javascript/);
    // The display font the shells preload: its type, and immutable like the bundles.
    const font = await c.get('/assets/gravesend-sans-500-JQUMMK2Q.woff2');
    expect(font.statusCode).toBe(200);
    expect(font.headers['content-type']).toBe('font/woff2');
    expect(font.headers['cache-control']).toBe(IMMUTABLE_CACHE);
    const css = await c.get('/assets/brand.css');
    expect(css.statusCode).toBe(200);
    expect(css.headers['cache-control']).toBe(REVALIDATE_CACHE);
    expect(cacheControlFor('/x/app-ABCDEFGH.css')).toBe(IMMUTABLE_CACHE);
    expect(cacheControlFor('/x/app.css')).toBe(REVALIDATE_CACHE);
  });

  it('never serves dotfiles, files outside assets/ or path traversals', async () => {
    const c = h.client();
    expect((await c.get('/assets/.env')).statusCode).not.toBe(200);
    expect((await c.get('/secret.txt')).statusCode).toBe(404);
    expect((await c.get('/assets/../secret.txt')).statusCode).not.toBe(200);
    expect((await c.get('/assets/%2e%2e/secret.txt')).statusCode).not.toBe(200);
    expect((await c.get('/assets/missing.js')).statusCode).toBe(404);
  });

  it('does not shadow the API', async () => {
    expect((await h.client().get('/api/v1/health')).statusCode).toBe(200);
  });
});

describe('static web apps without a build', () => {
  it('registers no web routes when dist/web is missing', async () => {
    const h = await createHarness({ app: { serveStatic: true, staticDir: join(tmpdir(), 'orbes-no-such-dir') } });
    try {
      expect((await h.client().get('/verify')).statusCode).toBe(404);
      expect((await h.client().get('/')).statusCode).toBe(404);
      expect((await h.client().get('/api/v1/health')).statusCode).toBe(200);
    } finally {
      await h.close();
    }
  });
});
