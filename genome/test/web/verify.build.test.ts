import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertCspSafeHtml, buildWeb, discoverApps, entryOutName, rewriteHtml, WebBuildError, type BuildWebResult } from '../../scripts/build-web.js';
import { cacheControlFor, HASHED_ASSET_RE, IMMUTABLE_CACHE } from '../../src/server/http/static.js';

const FONT_SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src/web/shared/fonts/gravesend-sans-500.woff2');
const FONT_REF = '../shared/fonts/gravesend-sans-500.woff2';

describe('build-web: production build of the real apps', () => {
  let dir: string;
  let result: BuildWebResult;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orbes-build-'));
    result = await buildWeb({ outDir: join(dir, 'web'), mode: 'production', apps: ['verify'] });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const html = () => readFileSync(join(result.outDir, 'verify', 'index.html'), 'utf8');
  const asset = (url: string) => join(result.outDir, url.replace(/^\/assets\//, 'assets/'));

  it('publishes the verify shell, main bundle, worker bundle, stylesheet, favicon and preloaded font', () => {
    const app = result.apps.find((a) => a.name === 'verify')!;
    expect(Object.keys(app.assets).sort()).toEqual([FONT_REF, 'favicon.svg', 'main.ts', 'styles.css', 'worker.ts']);
    expect(app.assets['main.ts']).toMatch(/^\/assets\/verify-[A-Z0-9]{8}\.js$/);
    expect(app.assets['worker.ts']).toMatch(/^\/assets\/verify-worker-[A-Z0-9]{8}\.js$/);
    expect(app.assets['styles.css']).toMatch(/^\/assets\/verify-[A-Z0-9]{8}\.css$/);
    for (const url of Object.values(app.assets)) {
      expect(existsSync(asset(url)), url).toBe(true);
      // The static server caches exactly these names as immutable.
      expect(HASHED_ASSET_RE.test(url), url).toBe(true);
    }
    expect(result.files).toContain('verify/index.html');
    expect(result.files).toContain('manifest.json');
  });

  it('rewrites every source reference in the shell (worker URL included)', () => {
    const page = html();
    expect(page).not.toMatch(/\.ts"/);
    expect(page).not.toMatch(/"\.\.?\/[^"]+"/);
    const app = result.apps.find((a) => a.name === 'verify')!;
    expect(page).toContain(`<script type="module" src="${app.assets['main.ts']}"></script>`);
    expect(page).toContain(`<meta name="orbes-worker" content="${app.assets['worker.ts']}">`);
    expect(page).toContain(`<link rel="stylesheet" href="${app.assets['styles.css']}">`);
    expect(() => assertCspSafeHtml(page)).not.toThrow();
  });

  it('minifies, drops sourcemaps and bundles the shared brand stylesheet', () => {
    const app = result.apps.find((a) => a.name === 'verify')!;
    const js = readFileSync(asset(app.assets['main.ts']), 'utf8');
    const css = readFileSync(asset(app.assets['styles.css']), 'utf8');
    expect(js).not.toMatch(/sourceMappingURL/);
    expect(readdirSync(join(result.outDir, 'assets')).filter((f) => f.endsWith('.map'))).toEqual([]);
    expect(js.split('\n').length).toBeLessThan(20);
    expect(css).not.toMatch(/@import/);
    expect(css).toMatch(/--ivory:\s?#f6f2ea/);
    expect(css).toMatch(/cubic-bezier\(0?\.22,\s?1,\s?0?\.36,\s?1\)/);
  });

  it('keeps the browser bundles free of server code and secrets', () => {
    const app = result.apps.find((a) => a.name === 'verify')!;
    for (const entry of ['main.ts', 'worker.ts']) {
      const js = readFileSync(asset(app.assets[entry]), 'utf8');
      expect(js, entry).not.toMatch(/node:crypto|node:fs|from"node:|require\("/);
      expect(js, entry).not.toMatch(/PRIVATE KEY|privateKey|ipHashPepper|cookieSecret|suspiciousThreshold/);
    }
    // The worker carries the decoder; the page never needs it.
    const main = readFileSync(asset(app.assets['main.ts']), 'utf8');
    const worker = readFileSync(asset(app.assets['worker.ts']), 'utf8');
    expect(worker.length).toBeGreaterThan(10_000);
    expect(main).not.toMatch(/decodeCellsToCodeword|rsDecode/);
  });

  it('loads stylesheet assets only from the page origin or data: URIs', () => {
    const app = result.apps.find((a) => a.name === 'verify')!;
    const css = readFileSync(asset(app.assets['styles.css']), 'utf8');
    // Quoted data: URIs may contain url(#…) of their own; look only at the outer references.
    const outer = css.replace(/url\(\s*"data:[^"]*"\s*\)/g, 'url(data:)');
    const refs = [...outer.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r, r).toMatch(/^(data:|\/assets\/)/);
  });

  it('writes a manifest of published names', () => {
    const manifest = JSON.parse(readFileSync(join(result.outDir, 'manifest.json'), 'utf8')) as { mode: string; apps: Record<string, Record<string, string>> };
    expect(manifest.mode).toBe('production');
    expect(manifest.apps.verify['main.ts']).toBe(result.apps[0].assets['main.ts']);
  });

  it('replaces a previous build atomically and leaves no staging directories', async () => {
    writeFileSync(join(result.outDir, 'stale.txt'), 'old');
    const again = await buildWeb({ outDir: result.outDir, apps: ['verify'] });
    expect(existsSync(join(again.outDir, 'stale.txt'))).toBe(false);
    expect(readdirSync(dir).filter((n) => n !== 'web')).toEqual([]);
  });
});

describe('build-web: the display font, preloaded by both shells', () => {
  let dir: string;
  let result: BuildWebResult;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orbes-build-font-'));
    result = await buildWeb({ outDir: join(dir, 'web'), mode: 'production' });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const read = (url: string) => readFileSync(join(result.outDir, url.replace(/^\/assets\//, 'assets/')));

  it('publishes one hashed copy of the font, byte for byte, cached as immutable', () => {
    const copies = readdirSync(join(result.outDir, 'assets')).filter((f) => f.startsWith('gravesend-sans-500'));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^gravesend-sans-500-[A-Z0-9]{8}\.woff2$/);
    const url = `/assets/${copies[0]}`;
    expect(HASHED_ASSET_RE.test(url)).toBe(true);
    expect(cacheControlFor(url)).toBe(IMMUTABLE_CACHE);
    expect(read(url).equals(readFileSync(FONT_SRC))).toBe(true);
  });

  it('preloads, in each shell, exactly the file its stylesheet loads', () => {
    expect(result.apps.map((a) => a.name).sort()).toEqual(['admin', 'legal', 'verify']);
    const urls = new Set<string>();
    for (const app of result.apps) {
      const page = readFileSync(join(result.outDir, app.name, 'index.html'), 'utf8');
      const links = [...page.matchAll(/<link rel="preload"([^>]*)>/g)].map((m) => m[1]);
      expect(links, app.name).toHaveLength(1);
      const href = /\shref="([^"]+)"/.exec(links[0])?.[1];
      // as=font, the font type, and CORS mode: without crossorigin the browser would fetch the font twice.
      expect(links[0], app.name).toMatch(/\sas="font"/);
      expect(links[0], app.name).toMatch(/\stype="font\/woff2"/);
      expect(links[0], app.name).toMatch(/\scrossorigin(\s|$)/);
      const css = read(app.assets['styles.css']).toString('utf8');
      const fontUrls = [...css.matchAll(/url\(\s*"?([^")]+\.woff2)"?\s*\)/g)].map((m) => m[1]);
      expect(fontUrls, app.name).toEqual([href]);
      expect(app.assets[FONT_REF], app.name).toBe(href);
      // The stylesheet of the build declares the face that the preload warms.
      expect(css).toMatch(/@font-face\{font-family:\s?"?Gravesend Sans"?;src:url\("?\/assets\/gravesend-sans-500-[A-Z0-9]{8}\.woff2"?\) format\("woff2"\)/);
      expect(css).toMatch(/font-display:\s?swap/);
      urls.add(href!);
    }
    // One URL for every app: a visitor of /verify, /legal and /admin downloads the font once.
    expect(urls.size).toBe(1);
  });

  it('builds the legal pages (J-06), discovered like the others: shell, bundle, stylesheet, tab icon, preloaded font, no decoder', () => {
    const legal = result.apps.find((a) => a.name === 'legal')!;
    expect(Object.keys(legal.assets).sort()).toEqual([FONT_REF, 'favicon.svg', 'main.ts', 'styles.css']);
    expect(legal.assets['main.ts']).toMatch(/^\/assets\/legal-[A-Z0-9]{8}\.js$/);
    expect(legal.assets['styles.css']).toMatch(/^\/assets\/legal-[A-Z0-9]{8}\.css$/);
    for (const url of Object.values(legal.assets)) expect(HASHED_ASSET_RE.test(url), url).toBe(true);
    // The public apps share one tab icon: the same hashed file.
    expect(legal.assets['favicon.svg']).toBe(result.apps.find((a) => a.name === 'verify')!.assets['favicon.svg']);
    const page = readFileSync(join(result.outDir, 'legal', 'index.html'), 'utf8');
    expect(page).toContain(`<script type="module" src="${legal.assets['main.ts']}"></script>`);
    expect(page).not.toMatch(/\.ts"|orbes-worker/);
    expect(() => assertCspSafeHtml(page)).not.toThrow();
    const js = read(legal.assets['main.ts']).toString('utf8');
    expect(js).not.toMatch(/node:crypto|node:fs|from"node:|require\("/);
    expect(js).not.toMatch(/decodeCellsToCodeword|rsDecode|no code structure around the seal/);
    // The FAQ carries the sentence /verify shows under AUTHENTIC — REGISTERED, from the shared module, without the
    // verification app's client (copy.ts, api.ts): the pages read nothing but the contact of ORBES Client Services.
    expect(js).toContain('Buying this piece? Ask the seller for a transfer code from their ORBES account');
    expect(js).not.toContain('/api/v1/verify');
    expect(js).toContain('/api/v1/client-services');
    const css = read(legal.assets['styles.css']).toString('utf8');
    expect(css).not.toMatch(/@import/);
    expect(css).toMatch(/@media print/);
  });

  it('gives the console its own decoder worker (A-08): the sale mode reads codes, the main bundle carries no decoder', () => {
    const admin = result.apps.find((a) => a.name === 'admin')!;
    expect(Object.keys(admin.assets).sort()).toEqual([FONT_REF, 'favicon.svg', 'main.ts', 'styles.css', 'worker.ts']);
    expect(admin.assets['worker.ts']).toMatch(/^\/assets\/admin-worker-[A-Z0-9]{8}\.js$/);
    const page = readFileSync(join(result.outDir, 'admin', 'index.html'), 'utf8');
    expect(page).toContain(`<meta name="orbes-worker" content="${admin.assets['worker.ts']}">`);
    expect(() => assertCspSafeHtml(page)).not.toThrow();
    const main = read(admin.assets['main.ts']).toString('utf8');
    const worker = read(admin.assets['worker.ts']).toString('utf8');
    // The decoder's own diagnostics travel with it: in the worker, never in the page.
    for (const marker of ['no code structure around the seal', 'format word unreadable']) {
      expect(worker, marker).toContain(marker);
      expect(main, marker).not.toContain(marker);
    }
    expect(main).not.toMatch(/decodeCellsToCodeword|rsDecode/);
    // The same decoder as /verify: the two worker bundles are built from one source.
    const verifyWorker = read(result.apps.find((a) => a.name === 'verify')!.assets['worker.ts']).toString('utf8');
    expect(worker.length).toBeGreaterThan(10_000);
    expect(Math.abs(worker.length - verifyWorker.length)).toBeLessThan(200);
    for (const js of [main, worker]) expect(js).not.toMatch(/node:crypto|node:fs|from"node:|require\("/);
  });
});

describe('build-web: development build', () => {
  it('keeps code readable and links sourcemaps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbes-build-dev-'));
    try {
      const r = await buildWeb({ outDir: join(dir, 'web'), mode: 'development', apps: ['verify'] });
      const main = r.apps[0].assets['main.ts'];
      const js = readFileSync(join(r.outDir, main.replace(/^\/assets\//, 'assets/')), 'utf8');
      expect(js).toMatch(/sourceMappingURL=\/assets\/verify-[A-Z0-9]{8}\.js\.map/);
      expect(existsSync(join(r.outDir, main.replace(/^\/assets\//, 'assets/') + '.map'))).toBe(true);
      expect(js.split('\n').length).toBeGreaterThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('build-web: discovery and validation', () => {
  let src: string;
  beforeAll(() => {
    src = mkdtempSync(join(tmpdir(), 'orbes-websrc-'));
    const app = (name: string, files: Record<string, string>) => {
      mkdirSync(join(src, name), { recursive: true });
      for (const [f, body] of Object.entries(files)) writeFileSync(join(src, name, f), body);
    };
    app('alpha', {
      'index.html': '<!doctype html><title>A</title><link rel="stylesheet" href="./styles.css"><script type="module" src="./main.ts"></script><meta name="orbes-worker" content="./worker.ts">',
      'main.ts': 'import { greet } from "../shared/x.js"; console.log(greet());',
      'worker.ts': 'self.postMessage(1);',
      'styles.css': '@import "../shared/base.css"; body { color: red }',
    });
    app('shared', { 'x.ts': 'export const greet = () => "hi";', 'base.css': 'html { margin: 0 }', 'main.ts': '', 'index.html': '' });
    app('nomain', { 'index.html': '<!doctype html>' });
    app('Bad Name', { 'index.html': '', 'main.ts': '' });
  });
  afterAll(() => rmSync(src, { recursive: true, force: true }));

  it('finds apps with an index.html and a main.ts, never shared/', () => {
    const apps = discoverApps(src);
    expect(apps.map((a) => a.name)).toEqual(['alpha']);
    expect(Object.keys(apps[0].entries).sort()).toEqual(['main.ts', 'styles.css', 'worker.ts']);
    expect(entryOutName('alpha', 'worker.ts')).toBe('alpha-worker');
    expect(entryOutName('alpha', 'main.ts')).toBe('alpha');
  });

  it('builds a discovered app with shared imports', async () => {
    const out = join(src, '..', `${src.split('/').pop()}-out`);
    try {
      const r = await buildWeb({ srcDir: src, outDir: out });
      const a = r.apps[0];
      expect(readFileSync(join(out, 'alpha', 'index.html'), 'utf8')).toContain(a.assets['worker.ts']);
      expect(readFileSync(join(out, a.assets['main.ts'].slice(1)), 'utf8')).toContain('hi');
      expect(readFileSync(join(out, a.assets['styles.css'].slice(1)), 'utf8')).toMatch(/margin:0/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('rewrites a preloaded font to the file its stylesheet loads, and refuses a font no stylesheet loads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orbes-websrc-font-'));
    const srcDir = join(root, 'src');
    const out = join(root, 'out');
    try {
      mkdirSync(join(srcDir, 'gamma'), { recursive: true });
      mkdirSync(join(srcDir, 'shared', 'fonts'), { recursive: true });
      writeFileSync(join(srcDir, 'shared', 'fonts', 'f.woff2'), 'stand-in for a font file');
      writeFileSync(join(srcDir, 'shared', 'fonts', 'unused.woff2'), 'a font no stylesheet names');
      writeFileSync(join(srcDir, 'gamma', 'main.ts'), 'console.log(1);');
      writeFileSync(join(srcDir, 'gamma', 'styles.css'), '@font-face { font-family: F; src: url("../shared/fonts/f.woff2") format("woff2"); } body { font-family: F }');
      const shell = (font: string) =>
        `<!doctype html><link rel="preload" href="../shared/fonts/${font}" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="./styles.css"><script type="module" src="./main.ts"></script>`;
      writeFileSync(join(srcDir, 'gamma', 'index.html'), shell('f.woff2'));
      const r = await buildWeb({ srcDir, outDir: out });
      const href = r.apps[0].assets['../shared/fonts/f.woff2'];
      expect(href).toMatch(/^\/assets\/f-[A-Z0-9]{8}\.woff2$/);
      expect(readFileSync(join(out, r.apps[0].assets['styles.css'].slice(1)), 'utf8')).toMatch(new RegExp(`url\\("?${href.replace(/[.]/g, '\\.')}"?\\)`));
      expect(readFileSync(join(out, 'gamma', 'index.html'), 'utf8')).toContain(`href="${href}"`);
      expect(readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.woff2'))).toEqual([href.slice('/assets/'.length)]);

      writeFileSync(join(srcDir, 'gamma', 'index.html'), shell('unused.woff2'));
      await expect(buildWeb({ srcDir, outDir: out })).rejects.toThrow(/font no stylesheet of the build loads/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unknown apps and an empty source tree', async () => {
    await expect(buildWeb({ srcDir: src, outDir: join(src, 'x'), apps: ['nope'] })).rejects.toThrow(WebBuildError);
    const empty = mkdtempSync(join(tmpdir(), 'orbes-empty-'));
    try {
      await expect(buildWeb({ srcDir: empty, outDir: join(empty, 'out') })).rejects.toThrow(/no web apps/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('refuses shells that the CSP would break', () => {
    expect(() => assertCspSafeHtml('<script>alert(1)</script>')).toThrow(/inline <script>/);
    expect(() => assertCspSafeHtml('<script src="./a.ts">x</script>')).toThrow(/inline <script>/);
    expect(() => assertCspSafeHtml('<style>body{}</style>')).toThrow(/<style>/);
    expect(() => assertCspSafeHtml('<p style="color:red">')).toThrow(/style=""/);
    expect(() => assertCspSafeHtml('<button onclick="go()">')).toThrow(/event handler/);
    expect(() => assertCspSafeHtml('<a href="javascript:void(0)">')).toThrow(/javascript:/);
    expect(() => assertCspSafeHtml('<!-- <script>old()</script> --><script type="module" src="./main.ts"></script>')).not.toThrow();
  });

  it('rewrites only local file references and fails on dangling ones', () => {
    const map: Record<string, string> = { 'main.ts': '/assets/m-AAAAAAAA.js', 'icon.svg': '/assets/icon-BBBBBBBB.svg' };
    const out = rewriteHtml(
      '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">' +
        '<link rel="icon" href="./icon.svg"><a href="https://theorbes.com/">x</a><a href="/verify">v</a><script src="./main.ts"></script>',
      (rel) => map[rel],
    );
    expect(out).toContain('href="/assets/icon-BBBBBBBB.svg"');
    expect(out).toContain('src="/assets/m-AAAAAAAA.js"');
    expect(out).toContain('href="https://theorbes.com/"');
    expect(out).toContain('href="/verify"');
    expect(out).toContain('content="light"');
    expect(() => rewriteHtml('<img src="./missing.png">', () => undefined)).toThrow(/missing file/);
  });
});
