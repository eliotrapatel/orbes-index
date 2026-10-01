/**
 * Build the web apps (src/web/<app>/) into dist/web/ for the Fastify static
 * routes (src/server/http/static.ts):
 *
 *   dist/web/<app>/index.html      the app shell, asset references rewritten
 *   dist/web/assets/<name>-HASH.*  bundles, stylesheets and static files
 *   dist/web/manifest.json         logical name → published path, per app
 *
 * Discovery: every directory under src/web/ (except `shared`) with an
 * index.html and a main.ts is an app. Its entries are main.ts (→ <app>.js),
 * worker.ts (→ <app>-worker.js) and styles.css (→ <app>.css) when present.
 * index.html refers to them by their source names (`./main.ts`,
 * `./styles.css`, `<meta name="orbes-worker" content="./worker.ts">`); any
 * other local file it references (favicon.svg) is copied with a content hash.
 *
 * Bundles are ESM, minified, content-hashed (`-[A-Z0-9]{8}`, which the
 * static server caches as immutable) and without sourcemaps in production.
 * The shell is checked for CSP compliance (no inline scripts, styles or
 * event handlers) and the build fails on a dangling local reference.
 *
 * The new tree is written beside the output and swapped in with renames, so
 * a running server never serves a half-written build.
 *
 *   npx tsx scripts/build-web.ts            production
 *   npx tsx scripts/build-web.ts --dev      unminified, linked sourcemaps
 *   npx tsx scripts/build-web.ts --out DIR  another output directory
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SRC_DIR = join(ROOT, 'src', 'web');
export const DEFAULT_OUT_DIR = join(ROOT, 'dist', 'web');
/** Public URL prefix of dist/web/assets (static.ts serves it at /assets/). */
export const ASSET_PREFIX = '/assets/';
/** Browsers the apps support (module workers, optional chaining, BigInt for noble). */
export const BROWSER_TARGETS = ['es2020', 'chrome96', 'edge96', 'firefox115', 'safari15'];

const NOT_APPS = new Set(['shared']);

export type BuildMode = 'production' | 'development';

export interface BuildWebOptions {
  srcDir?: string;
  outDir?: string;
  mode?: BuildMode;
  /** Limit the build to these apps (default: every discovered app). */
  apps?: string[];
  log?: (line: string) => void;
}

export interface WebApp {
  name: string;
  dir: string;
  html: string;
  /** Entry name in index.html (e.g. 'main.ts') → absolute source path. */
  entries: Record<string, string>;
}

export interface BuiltApp {
  name: string;
  /** Logical reference in index.html → published URL (/assets/…). */
  assets: Record<string, string>;
}

export interface BuildWebResult {
  outDir: string;
  mode: BuildMode;
  apps: BuiltApp[];
  /** Every file written, relative to outDir. */
  files: string[];
}

export class WebBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebBuildError';
  }
}

// ── Discovery ──────────────────────────────────────────────────────────────

const ENTRY_FILES = ['main.ts', 'worker.ts', 'styles.css'] as const;

export function discoverApps(srcDir: string = DEFAULT_SRC_DIR): WebApp[] {
  if (!existsSync(srcDir)) return [];
  const apps: WebApp[] = [];
  for (const name of readdirSync(srcDir).sort()) {
    const dir = join(srcDir, name);
    if (NOT_APPS.has(name) || name.startsWith('.') || name.startsWith('_') || !statSync(dir).isDirectory()) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
    const html = join(dir, 'index.html');
    const main = join(dir, 'main.ts');
    if (!existsSync(html) || !existsSync(main)) continue;
    const entries: Record<string, string> = {};
    for (const f of ENTRY_FILES) if (existsSync(join(dir, f))) entries[f] = join(dir, f);
    apps.push({ name, dir, html, entries });
  }
  return apps;
}

/** Output base name of an entry: main.ts → <app>, worker.ts → <app>-worker, styles.css → <app>. */
export function entryOutName(app: string, entry: string): string {
  if (entry === 'worker.ts') return `${app}-worker`;
  return app;
}

// ── HTML ───────────────────────────────────────────────────────────────────

/**
 * Refuse shells the CSP would break: inline <script>, <style>, style="" or
 * on*="" attributes, and javascript: URLs.
 */
export function assertCspSafeHtml(html: string, label = 'index.html'): void {
  const problems: string[] = [];
  // Strip comments first so commented-out markup does not trip the checks.
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/.test(m[1]) || m[2].trim() !== '') problems.push('inline <script>');
  }
  if (/<style[\s>]/i.test(body)) problems.push('<style> element');
  if (/\sstyle\s*=/i.test(body)) problems.push('style="" attribute');
  if (/\son[a-z]+\s*=/i.test(body)) problems.push('on*="" event handler attribute');
  if (/javascript:/i.test(body)) problems.push('javascript: URL');
  if (problems.length > 0) throw new WebBuildError(`${label}: not CSP-safe (${[...new Set(problems)].join(', ')})`);
}

const REF_ATTR = /\b(src|href|content)\s*=\s*"([^"]*)"/g;

function isLocalRef(value: string): boolean {
  return value !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(value) && !/\s/.test(value);
}

/**
 * Rewrite the local references of an app shell. `resolveRef` maps a path
 * relative to the app directory (e.g. 'main.ts', 'favicon.svg') to its
 * published URL, or returns undefined when the file does not exist.
 * `content` attributes are rewritten only for values that look like files.
 */
export function rewriteHtml(html: string, resolveRef: (relPath: string) => string | undefined): string {
  return html.replace(REF_ATTR, (whole, attr: string, value: string) => {
    if (!isLocalRef(value)) return whole;
    if (attr === 'content' && !/^\.{1,2}\/|\.[a-z0-9]{1,5}$/i.test(value)) return whole;
    const rel = value.replace(/^\.\//, '');
    const url = resolveRef(rel);
    if (url === undefined) {
      if (attr === 'content') return whole;
      throw new WebBuildError(`reference to missing file "${value}"`);
    }
    return `${attr}="${url}"`;
  });
}

// ── Build ──────────────────────────────────────────────────────────────────

function hashName(file: string, bytes: Uint8Array): string {
  // Same alphabet and length as esbuild's [hash] so static.ts treats it as immutable.
  const digest = createHash('sha256').update(bytes).digest();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let h = '';
  for (let i = 0; i < 8; i++) h += alphabet[digest[i] & 31];
  const ext = extname(file);
  return `${basename(file, ext)}-${h}${ext}`;
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

export async function buildWeb(opts: BuildWebOptions = {}): Promise<BuildWebResult> {
  const srcDir = resolve(opts.srcDir ?? DEFAULT_SRC_DIR);
  const outDir = resolve(opts.outDir ?? DEFAULT_OUT_DIR);
  const mode: BuildMode = opts.mode ?? 'production';
  const log = opts.log ?? (() => {});
  const production = mode === 'production';

  let apps = discoverApps(srcDir);
  if (opts.apps) {
    const wanted = new Set(opts.apps);
    for (const name of wanted) if (!apps.some((a) => a.name === name)) throw new WebBuildError(`unknown web app "${name}"`);
    apps = apps.filter((a) => wanted.has(a.name));
  }
  if (apps.length === 0) throw new WebBuildError(`no web apps found in ${srcDir}`);

  // Validate the shells before spending time on bundling.
  const shells = new Map<string, string>();
  for (const app of apps) {
    const html = readFileSync(app.html, 'utf8');
    assertCspSafeHtml(html, `${app.name}/index.html`);
    shells.set(app.name, html);
  }

  const stage = `${outDir}.staging-${process.pid}-${Date.now().toString(36)}`;
  const assetsDir = join(stage, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  try {
    const entryPoints = apps.flatMap((app) => Object.entries(app.entries).map(([entry, path]) => ({ in: path, out: entryOutName(app.name, entry) })));
    const result = await esbuild.build({
      entryPoints,
      outdir: assetsDir,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: BROWSER_TARGETS,
      splitting: false,
      minify: production,
      sourcemap: production ? false : 'linked',
      legalComments: production ? 'none' : 'inline',
      entryNames: '[name]-[hash]',
      assetNames: '[name]-[hash]',
      publicPath: ASSET_PREFIX.replace(/\/$/, ''),
      loader: { '.svg': 'file', '.png': 'file', '.jpg': 'file', '.woff2': 'file' },
      define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
      drop: production ? ['debugger'] : [],
      metafile: true,
      write: true,
      logLevel: 'silent',
      charset: 'utf8',
    });
    for (const w of result.warnings) log(`warning: ${w.text}`);

    // entry source path → published URL
    const published = new Map<string, string>();
    for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
      if (!meta.entryPoint || outPath.endsWith('.map')) continue;
      published.set(resolve(meta.entryPoint), ASSET_PREFIX + basename(outPath));
    }

    const built: BuiltApp[] = [];
    for (const app of apps) {
      const assets: Record<string, string> = {};
      const resolveRef = (rel: string): string | undefined => {
        const abs = resolve(app.dir, rel);
        // Never let a shell pull files from outside its own app directory (or shared/).
        if (!abs.startsWith(app.dir + sep) && !abs.startsWith(join(srcDir, 'shared') + sep)) {
          throw new WebBuildError(`${app.name}/index.html: "${rel}" points outside the app`);
        }
        if (!existsSync(abs) || !statSync(abs).isFile()) return undefined;
        const fromEntry = published.get(abs);
        if (fromEntry) {
          assets[rel] = fromEntry;
          return fromEntry;
        }
        if (/\.(ts|tsx|js|mjs|css)$/.test(abs)) throw new WebBuildError(`${app.name}/index.html: "${rel}" is not a build entry`);
        const bytes = readFileSync(abs);
        const name = hashName(basename(abs), bytes);
        writeFileSync(join(assetsDir, name), bytes);
        assets[rel] = ASSET_PREFIX + name;
        return assets[rel];
      };
      const html = rewriteHtml(shells.get(app.name)!, resolveRef);
      for (const required of Object.keys(app.entries)) {
        if (!assets[required]) throw new WebBuildError(`${app.name}/index.html does not reference ./${required}`);
      }
      mkdirSync(join(stage, app.name), { recursive: true });
      writeFileSync(join(stage, app.name, 'index.html'), html);
      built.push({ name: app.name, assets });
      log(`${app.name}: ${Object.entries(assets).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
    }

    writeFileSync(
      join(stage, 'manifest.json'),
      `${JSON.stringify({ mode, apps: Object.fromEntries(built.map((b) => [b.name, b.assets])) }, null, 2)}\n`,
    );

    // Swap the new tree in: rename is atomic per directory on the same filesystem.
    mkdirSync(dirname(outDir), { recursive: true });
    const old = `${outDir}.old-${process.pid}-${Date.now().toString(36)}`;
    if (existsSync(outDir)) renameSync(outDir, old);
    renameSync(stage, outDir);
    rmSync(old, { recursive: true, force: true });

    return { outDir, mode, apps: built, files: listFiles(outDir) };
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    if (e instanceof WebBuildError) throw e;
    const errors = (e as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
    if (errors?.length) {
      throw new WebBuildError(errors.map((x) => (x.location ? `${x.location.file}:${x.location.line}: ${x.text}` : x.text)).join('\n'));
    }
    throw e;
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): BuildWebOptions {
  const opts: BuildWebOptions = { mode: 'production' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') opts.mode = 'development';
    else if (a === '--out') opts.outDir = resolve(argv[++i] ?? '');
    else if (a === '--app') (opts.apps ??= []).push(argv[++i] ?? '');
    else throw new WebBuildError(`unknown argument ${a} (use --dev, --out DIR, --app NAME)`);
  }
  return opts;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const started = Date.now();
  buildWeb({ ...parseArgs(process.argv.slice(2)), log: (l) => console.log(l) })
    .then((r) => {
      console.log(`web build (${r.mode}): ${r.files.length} files in ${relative(process.cwd(), r.outDir) || '.'} — ${Date.now() - started} ms`);
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
}
