/**
 * The OVH VPS stack (deploy/vps) and the Vercel redirect keep their decided
 * shape and their safety properties:
 *
 *  - vercel.json holds ONLY the two /verify redirects to verify.theorbes.com
 *    (temporary 307), and .vercelignore still keeps genome/, docs/, deploy/,
 *    .github/ and node_modules/ off the public website;
 *  - compose.yaml publishes ports from Caddy only, keeps the app and
 *    PostgreSQL on internal networks, hardens the app container, and pins the
 *    app's TRUST_PROXY to Caddy's fixed address (outside the dynamic range);
 *  - the app environment built by compose from deploy/vps/.env.example (with
 *    secrets filled in) is a valid production configuration (GEO_MODE=mmdb);
 *  - every app setting of genome/.env.example reaches the app (the ORBES
 *    Client Services contact included, empty until the brand supplies it,
 *    and the ORBES Care subscription page, empty until it opens),
 *    and every variable compose interpolates is documented in
 *    deploy/vps/.env.example;
 *  - the Caddyfile forwards exactly one X-Forwarded-For entry ({client_ip}),
 *    trusts no proxy in direct mode, strips query strings and headers from the
 *    access log, leaves HSTS to the app, and limits every request body to
 *    64 KB except the console's four photograph uploads (F-04: a model's
 *    reference photograph, a piece's; P-R02: a photograph of a model's
 *    lookbook gallery; P-X01: a photograph of a post of the owners' circle;
 *    1 200 KB, over the app's 1 MiB);
 *  - the scripts are strict bash with --help, and the destructive ones have
 *    --dry-run; the systemd units point at scripts that exist;
 *  - whatever the operator's umask, the image's sources and Caddy's
 *    bind-mounted configuration stay readable (lib.sh helpers run in bash).
 *
 * No Docker here: the stack itself is exercised by bringing it up
 * (docs/DEPLOYMENT.md §15.12).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { BlockList } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';
import { MEDIA_BODY_LIMIT_BYTES, MEDIA_UPLOAD_ROUTES } from '../../src/server/routes/admin/media.js';
import { BODY_LIMIT_BYTES } from '../../src/server/app.js';

const GENOME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = join(GENOME, '..');
const STACK = join(REPO, 'deploy', 'vps');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

/** `NAME=value` (active) and `# NAME=value` (documented) lines of an env template. */
function parseEnvTemplate(text: string): { active: Map<string, string>; documented: Set<string> } {
  const active = new Map<string, string>();
  const documented = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    documented.add(m[2]);
    if (!m[1]) active.set(m[2], m[3].replace(/\s+#.*$/, '').trim());
  }
  return { active, documented };
}

/** Top-level service blocks of compose.yaml (text between `  name:` lines under `services:`). */
function services(compose: string): Map<string, string> {
  const body = compose.slice(compose.indexOf('\nservices:\n'), compose.search(/\nvolumes:\n/));
  const out = new Map<string, string>();
  const parts = body.split(/\n {2}(?=[a-z][a-z0-9-]*:\n)/);
  for (const part of parts.slice(1)) {
    const name = part.slice(0, part.indexOf(':'));
    out.set(name, part);
  }
  return out;
}

/** `KEY: value` pairs of a service's `environment:` mapping. */
function environment(service: string): Map<string, string> {
  const m = /\n {4}environment:\n((?: {6}.*\n| {6}#.*\n)+)/.exec(`${service}\n`);
  const out = new Map<string, string>();
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^ {6}([A-Z][A-Z0-9_]*): (.*)$/.exec(line);
    if (kv) out.set(kv[1], kv[2].replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

/** Compose-style interpolation of ${NAME}, ${NAME:-default}, ${NAME:?message}. */
function interpolate(value: string, vars: Map<string, string>): string {
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)(?::([-?])([^}]*))?\}/g, (_m, name: string, op?: string, arg?: string) => {
    const v = vars.get(name);
    if (v !== undefined && v !== '') return v;
    if (op === '?') throw new Error(`${name} is required: ${arg}`);
    return op === '-' ? (arg ?? '') : '';
  });
}

describe('vercel.json (theorbes.com stays a static site on Vercel)', () => {
  const vercel = JSON.parse(read(REPO, 'vercel.json')) as Record<string, unknown>;

  it('contains nothing but the two temporary /verify redirects, path kept', () => {
    expect(Object.keys(vercel)).toEqual(['redirects']);
    expect(vercel.redirects).toEqual([
      { source: '/verify', destination: 'https://verify.theorbes.com/verify', statusCode: 307 },
      { source: '/verify/:path*', destination: 'https://verify.theorbes.com/verify/:path*', statusCode: 307 },
    ]);
  });

  it('.vercelignore still keeps the system, its documentation, the VPS stack, CI and tool caches off the website', () => {
    const ignored = read(REPO, '.vercelignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const entry of ['genome/', 'docs/', 'deploy/', '.github/', 'node_modules/']) expect(ignored, entry).toContain(entry);
    expect(ignored).not.toContain('index.html');
  });

  it('the repository root ignores node_modules/ (tool caches written by a run from the root)', () => {
    const ignored = read(REPO, '.gitignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(ignored).toContain('node_modules/');
  });
});

describe('deploy/vps/compose.yaml', () => {
  const compose = read(STACK, 'compose.yaml');
  const svc = services(compose);
  const example = parseEnvTemplate(read(STACK, '.env.example'));

  it('has the caddy, app and postgres services (plus the geoip-update tool)', () => {
    expect([...svc.keys()].sort()).toEqual(['app', 'caddy', 'geoip-update', 'postgres']);
    expect(svc.get('caddy')).toMatch(/\n {4}image: caddy:2\n/);
    expect(svc.get('postgres')).toMatch(/\n {4}image: postgres:17\n/);
    expect(svc.get('app')).toMatch(/\n {6}context: \.\.\/\.\.\/genome\n/);
    expect(svc.get('geoip-update')).toMatch(/profiles: \["tools"\]/);
  });

  it('publishes ports from Caddy only (80, 443/tcp, 443/udp)', () => {
    for (const [name, text] of svc) {
      if (name === 'caddy') continue;
      expect(text, name).not.toMatch(/\n {4}ports:/);
      expect(text, name).not.toMatch(/\n {4}network_mode:/);
    }
    const caddy = svc.get('caddy')!;
    expect(caddy).toMatch(/:80\/tcp"/);
    expect(caddy).toMatch(/:443\/tcp"/);
    expect(caddy).toMatch(/:443\/udp"/);
    // IPv4 only: an IPv6 publish goes through Docker's userland proxy and hides every IPv6 client
    // behind one internal address (shared rate limit, no geo, Cloudflare origin lock bypassed).
    const published = [...caddy.matchAll(/\n {6}- "([^"]+)"/g)].map((m) => m[1]).filter((p) => /:\d+\/(tcp|udp)$/.test(p));
    expect(published.length).toBe(3);
    for (const p of published) expect(p, p).toMatch(/^0\.0\.0\.0:/);
  });

  it('keeps the app and PostgreSQL on internal networks only', () => {
    const networks = compose.slice(compose.search(/\nnetworks:\n/));
    expect(networks).toMatch(/\n {2}edge:\n {4}internal: true\n/);
    expect(networks).toMatch(/\n {2}backend:\n {4}internal: true\n/);
    expect(svc.get('postgres')).toMatch(/\n {4}networks:\n {6}backend: \{\}\n/);
    expect(svc.get('app')).toMatch(/\n {4}networks:\n {6}edge: \{\}\n {6}backend: \{\}\n/);
  });

  it('hardens the app container and gives every service limits, healthchecks and log rotation', () => {
    const app = svc.get('app')!;
    expect(app).toMatch(/\n {4}user: "1000:1000"\n/);
    expect(app).toMatch(/\n {4}read_only: true\n/);
    expect(app).toMatch(/\n {6}- \/tmp:size=/);
    expect(app).toMatch(/\n {4}cap_drop: \[ALL\]\n/);
    expect(app).not.toMatch(/cap_add/);
    expect(app).toMatch(/no-new-privileges:true/);
    expect(app).toMatch(/\n {6}- geoip:\/var\/lib\/orbes\/geoip:ro\n/);
    for (const name of ['caddy', 'app', 'postgres']) {
      const text = svc.get(name)!;
      expect(text, name).toMatch(/\n {4}restart: unless-stopped\n/);
      expect(text, name).toMatch(/\n {4}mem_limit: /);
      expect(text, name).toMatch(/\n {4}cpus: /);
      expect(text, name).toMatch(/\n {4}healthcheck:\n/);
      expect(text, name).toMatch(/\n {4}logging: \*logging\n/);
      expect(text, name).toMatch(/no-new-privileges:true/);
    }
    expect(compose).toMatch(/x-logging: &logging\n {2}driver: json-file\n {2}options:\n {4}max-size: "10m"\n {4}max-file: "5"/);
  });

  it("pins TRUST_PROXY to Caddy's fixed address, which no other container can be given", () => {
    const appEnv = environment(svc.get('app')!);
    expect(appEnv.get('TRUST_PROXY')).toBe('${CADDY_EDGE_IP:-172.30.80.2}');
    expect(svc.get('caddy')).toMatch(/\n {6}edge:\n {8}ipv4_address: \$\{CADDY_EDGE_IP:-172\.30\.80\.2\}\n/);
    expect(compose).toMatch(/subnet: \$\{EDGE_SUBNET:-172\.30\.80\.0\/28\}\n {10}ip_range: \$\{EDGE_DYNAMIC_RANGE:-172\.30\.80\.8\/29\}/);
    const ip = example.active.get('CADDY_EDGE_IP')!;
    const [subnet, subnetBits] = example.active.get('EDGE_SUBNET')!.split('/');
    const [range, rangeBits] = example.active.get('EDGE_DYNAMIC_RANGE')!.split('/');
    const inSubnet = new BlockList();
    inSubnet.addSubnet(subnet, Number(subnetBits));
    const inRange = new BlockList();
    inRange.addSubnet(range, Number(rangeBits));
    expect(ip).toBe('172.30.80.2');
    expect(inSubnet.check(ip)).toBe(true);
    expect(inRange.check(ip)).toBe(false);
    expect(inSubnet.check(range)).toBe(true);
  });

  it('documents every variable it interpolates in deploy/vps/.env.example', () => {
    const used = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
    const missing = [...used].filter((n) => !example.documented.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it('passes every app setting of genome/.env.example to the app', () => {
    const appEnv = environment(svc.get('app')!);
    const genomeVars = parseEnvTemplate(read(GENOME, '.env.example')).documented;
    // Compose/tooling-only names, CLI-only secrets, and modes this stack does not use.
    const notForTheApp = new Set([
      'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'APP_BIND', 'APP_PORT', 'ORBES_IMAGE_TAG', 'ORBES_ENV_FILE',
      'DEMO_ACCOUNT_PASSWORD', 'ADMIN_PASSWORD', 'ADMIN_TOTP_SECRET', 'ORBES_DEMO', 'GEO_COUNTRY_HEADER', 'GEO_LAT_HEADER', 'GEO_LON_HEADER',
    ]);
    const missing = [...genomeVars].filter((n) => !notForTheApp.has(n) && !appEnv.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it('builds a valid production configuration from .env.example once the secrets are filled in', () => {
    const vars = new Map(example.active);
    expect(vars.get('POSTGRES_PASSWORD')).toBe('');
    expect(vars.get('COOKIE_SECRET')).toBe('');
    expect(vars.get('IP_HASH_PEPPER')).toBe('');
    expect(vars.get('KEY_ENCRYPTION_KEY')).toBe('');
    expect(vars.get('BOOTSTRAP_ADMIN_PASSWORD')).toBe('');
    // Without secrets, compose itself refuses to start the stack.
    expect(() => interpolate(environment(svc.get('app')!).get('COOKIE_SECRET')!, vars)).toThrow(/COOKIE_SECRET is required/);

    expect(vars.get('POSTGRES_APP_PASSWORD')).toBe('');
    expect(() => interpolate(environment(svc.get('app')!).get('DATABASE_URL')!, vars)).toThrow(/POSTGRES_APP_PASSWORD is required/);

    vars.set('POSTGRES_PASSWORD', randomBytes(24).toString('hex'));
    vars.set('POSTGRES_APP_PASSWORD', randomBytes(24).toString('hex'));
    vars.set('COOKIE_SECRET', randomBytes(48).toString('base64url'));
    vars.set('IP_HASH_PEPPER', randomBytes(48).toString('base64url'));
    vars.set('KEY_ENCRYPTION_KEY', randomBytes(32).toString('base64url'));
    const env: Record<string, string> = {};
    for (const [k, v] of environment(svc.get('app')!)) env[k] = interpolate(v, vars);
    const c = loadConfig(env);
    expect(c.env).toBe('production');
    expect(c.publicOrigin).toBe('https://verify.theorbes.com');
    expect(c.port).toBe(8080);
    expect(c.trustProxy).toBe('172.30.80.2');
    // The app's role cannot run DDL: deploy.sh / restore.sh migrate as the owner first.
    expect(c.migrateOnStart).toBe(false);
    expect(c.keys).toMatchObject({ provider: 'local', dir: '/var/lib/orbes/keys' });
    expect(c.geo).toMatchObject({ mode: 'mmdb', mmdbPath: '/var/lib/orbes/geoip/dbip-city-lite.mmdb' });
    // Least privilege: the app connects as its own DML-only role, never as the superuser/owner.
    expect(c.databaseUrl).toMatch(/^postgres:\/\/orbes_app:[0-9a-f]{48}@postgres:5432\/orbes$/);
    expect(c.databaseUrl).not.toContain(vars.get('POSTGRES_PASSWORD')!);
    expect(example.active.get('POSTGRES_APP_USER')).not.toBe(example.active.get('POSTGRES_USER'));
    // ORBES Client Services: empty in the template, so the app shows no contact until the brand's details are set.
    expect(c.clientServices).toEqual({});
    // F-03: unset in the template, so a transfer is accepted for the piece scanned only.
    expect(c.transferAcceptRequireProduct).toBe(true);
  });

  it('hands the ORBES Client Services details from .env to the app, empty meaning unset', () => {
    const appEnv = environment(svc.get('app')!);
    for (const name of ['CLIENT_SERVICES_EMAIL', 'CLIENT_SERVICES_PHONE', 'CLIENT_SERVICES_HOURS']) {
      expect(appEnv.get(name), name).toBe(`\${${name}:-}`);
      expect(example.active.get(name), name).toBe('');
    }
    const vars = new Map(example.active);
    vars.set('POSTGRES_APP_PASSWORD', randomBytes(24).toString('hex'));
    vars.set('COOKIE_SECRET', randomBytes(48).toString('base64url'));
    vars.set('IP_HASH_PEPPER', randomBytes(48).toString('base64url'));
    vars.set('KEY_ENCRYPTION_KEY', randomBytes(32).toString('base64url'));
    vars.set('CLIENT_SERVICES_EMAIL', 'clientservices@theorbes.com');
    vars.set('CLIENT_SERVICES_PHONE', '+33 1 23 45 67 89');
    vars.set('CLIENT_SERVICES_HOURS', 'Monday to Saturday, 10:00–19:00 (Paris)');
    const env: Record<string, string> = {};
    for (const [k, v] of appEnv) env[k] = interpolate(v, vars);
    expect(loadConfig(env).clientServices).toEqual({
      email: 'clientservices@theorbes.com',
      phone: '+33 1 23 45 67 89',
      hours: 'Monday to Saturday, 10:00–19:00 (Paris)',
    });
  });

  it('hands the ORBES Care subscription page (CARE_SUBSCRIBE_URL, P-M02) from .env to the app, empty meaning none yet', () => {
    const appEnv = environment(svc.get('app')!);
    expect(appEnv.get('CARE_SUBSCRIBE_URL')).toBe('${CARE_SUBSCRIBE_URL:-}');
    expect(example.active.get('CARE_SUBSCRIBE_URL')).toBe('');
    const vars = new Map(example.active);
    vars.set('POSTGRES_APP_PASSWORD', randomBytes(24).toString('hex'));
    vars.set('COOKIE_SECRET', randomBytes(48).toString('base64url'));
    vars.set('IP_HASH_PEPPER', randomBytes(48).toString('base64url'));
    vars.set('KEY_ENCRYPTION_KEY', randomBytes(32).toString('base64url'));
    const build = () => {
      const env: Record<string, string> = {};
      for (const [k, v] of appEnv) env[k] = interpolate(v, vars);
      return loadConfig(env);
    };
    expect(build().careSubscribeUrl).toBeNull();
    vars.set('CARE_SUBSCRIBE_URL', 'https://whop.com/orbes/care');
    expect(build().careSubscribeUrl).toBe('https://whop.com/orbes/care');
  });

  it('migrates as the schema owner and grants the app role DML only (scripts)', () => {
    const lib = read(STACK, 'scripts', 'lib.sh');
    const fn = (name: string) => new RegExp(`\\n${name}\\(\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(lib)?.[1] ?? '';
    // Migrations: one-off app container with the OWNER's URL (from the environment, not argv).
    expect(fn('db_migrate')).toMatch(/DATABASE_URL="postgres:\/\/\$\(db_owner\):\$\{pw\}@postgres:5432\/\$\(db_name\)"/);
    expect(fn('db_migrate')).toMatch(/compose run --rm --no-deps -T -e DATABASE_URL app /);
    // The role: never a superuser, no DDL; only SELECT/INSERT/UPDATE/DELETE and sequence use.
    expect(fn('db_ensure_app_role')).toMatch(/NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
    const grants = fn('db_grant_app_role');
    expect(grants).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I/);
    expect(grants).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
    expect(grants).not.toMatch(/GRANT (ALL|.*TRUNCATE|.*CREATE ON SCHEMA)/);
    expect(fn('check_db_names')).toMatch(/POSTGRES_APP_USER must differ from POSTGRES_USER/);
    // deploy.sh prepares the database before the app starts; restore.sh does it after pg_restore.
    expect(read(STACK, 'scripts', 'deploy.sh')).toMatch(/db_prepare \|\| return 1\n {2}compose up -d --remove-orphans/);
    const restore = read(STACK, 'scripts', 'restore.sh');
    expect(restore).toMatch(/db_ensure_app_role\n[\s\S]*pg_restore [^\n]*--no-privileges[^\n]*\n {2}db_grant_app_role/);
    expect(restore).toMatch(/db_prepare \|\| die[^\n]*\ncompose up -d\n/);
  });
});

describe('deploy/vps/Caddyfile', () => {
  const caddyfile = read(STACK, 'Caddyfile');
  const direct = read(STACK, 'caddy.d', 'edge-direct.caddy');
  const cloudflare = read(STACK, 'caddy.d', 'edge-cloudflare.caddy');
  const directives = (text: string) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  it("proxies to the app's real port with exactly one forwarded client IP", () => {
    const port = /\bPORT: "(\d+)"/.exec(read(STACK, 'compose.yaml'))![1];
    expect(directives(caddyfile)).toMatch(new RegExp(`reverse_proxy app:${port} \\{`));
    expect(directives(caddyfile)).toMatch(/header_up X-Forwarded-For \{client_ip\}/);
    expect(directives(caddyfile)).toMatch(/header_up -X-Real-Ip/);
    expect(directives(caddyfile)).toMatch(/header_up -Forwarded/);
  });

  it('trusts no proxy in direct mode, and only Cloudflare (strict, CF-Connecting-IP) in cloudflare mode', () => {
    expect(directives(direct)).not.toMatch(/trusted_proxies|client_ip_headers/);
    expect(directives(cloudflare)).toMatch(/trusted_proxies static (\S+ )+\S+/);
    expect(directives(cloudflare)).toMatch(/client_ip_headers CF-Connecting-IP/);
    expect(directives(cloudflare)).toMatch(/trusted_proxies_strict/);
    expect(directives(cloudflare)).not.toMatch(/0\.0\.0\.0\/0|::\/0|private_ranges/);
    expect(directives(caddyfile)).toMatch(/import caddy\.d\/edge-\{\$EDGE_MODE:direct\}\.caddy/);
    // Forged Cloudflare geolocation headers never reach the app in direct mode.
    expect(directives(caddyfile)).toMatch(/\(upstream_direct\) \{[^}]*header_up -Cf-Ipcountry/);
  });

  it('logs JSON to stdout without query strings, headers or full client IPs', () => {
    const d = directives(caddyfile);
    expect(d).toMatch(/output stdout/);
    expect(d).toMatch(/request>uri regexp \\\?\.\*\$ ""/);
    expect(d).toMatch(/request>headers delete/);
    expect(d).toMatch(/resp_headers delete/);
    expect(d).toMatch(/request>client_ip ip_mask/);
    expect(d).toMatch(/exclude http\.log\.access/);
    // The runtime log carries http.log.error, which embeds the whole request (e.g. a 502 while
    // the app restarts): it gets the same filter, so no full IP, query string or header there either.
    const runtime = /log default \{([\s\S]*?)\n\t\}/.exec(d)?.[1] ?? '';
    expect(runtime).toMatch(/format filter \{/);
    expect(runtime).toMatch(/request>uri regexp \\\?\.\*\$ ""/);
    expect(runtime).toMatch(/request>headers delete/);
    expect(runtime).toMatch(/request>remote_ip ip_mask/);
    expect(runtime).toMatch(/request>client_ip ip_mask/);
  });

  it('leaves security headers to the app, limits bodies, compresses, and supports tls internal and an admin allowlist', () => {
    const d = directives(caddyfile);
    expect(d).not.toMatch(/Strict-Transport-Security|Content-Security-Policy/i);
    expect(d).toMatch(/encode zstd gzip/);
    expect(d).toMatch(/import tls_\{\$TLS_MODE:acme\}/);
    expect(d).toMatch(/\(tls_internal\) \{\s*tls internal\s*\}/);
    expect(d).toMatch(/not client_ip \{\$ADMIN_ALLOWED_IPS:0\.0\.0\.0\/0 ::\/0\}/);
    expect(d).toMatch(/path \/admin \/admin\/\* \/api\/admin \/api\/admin\/\*/);
  });

  it('limits every body to 64 KB, except the four photograph uploads of the console (F-04, P-R02, P-X01): 1 200 KB, over the app\'s 1 MiB', () => {
    const d = directives(caddyfile);
    // Caddy reads KB as 1 000 bytes.
    const kb = (v: string) => Number(/^(\d+)KB$/.exec(v)![1]) * 1000;
    const limits = [...d.matchAll(/request_body (\S+) \{\s*max_size (\S+)\s*\}/g)].map((m) => [m[1], m[2]]);
    expect(limits).toEqual([
      ['@photo_upload', '1200KB'],
      ['@not_photo_upload', '64KB'],
    ]);
    // No request_body without a matcher: exactly one of the two applies to any request.
    expect([...d.matchAll(/request_body/g)]).toHaveLength(2);
    expect(kb('1200KB')).toBeGreaterThan(MEDIA_BODY_LIMIT_BYTES);
    expect(kb('64KB')).toBeGreaterThan(BODY_LIMIT_BYTES);
    expect(kb('64KB')).toBeLessThan(MEDIA_BODY_LIMIT_BYTES);
    // The exception is a POST to one of the upload paths; its complement is the very same pair, negated.
    const upload = /@photo_upload \{\n\t\tmethod POST\n\t\tpath_regexp (\S+)\n\t\}/.exec(d);
    expect(upload, 'the @photo_upload matcher').not.toBeNull();
    const pattern = upload![1];
    expect(d).toContain(`@not_photo_upload {\n\t\tnot {\n\t\t\tmethod POST\n\t\t\tpath_regexp ${pattern}\n\t\t}\n\t}`);
    // The pattern is RE2 and JavaScript alike here: it matches the app's four routes, with or without a trailing slash…
    const re = new RegExp(pattern);
    const sample = (route: string) => route.replace(':id', '73c68b47-012d-4569-a59a-fd2effa613c1').replace(':productId', 'O26-J-00184');
    expect([...MEDIA_UPLOAD_ROUTES]).toEqual([
      '/api/admin/models/:id/image',
      '/api/admin/products/:productId/photo',
      '/api/admin/models/:id/gallery',
      '/api/admin/circle/posts/:id/photos',
    ]);
    for (const route of MEDIA_UPLOAD_ROUTES) {
      expect(re.test(sample(route)), route).toBe(true);
      expect(re.test(`${sample(route)}/`), route).toBe(true);
    }
    // …and nothing else of the API.
    for (const path of [
      '/api/admin/models',
      '/api/admin/models/73c68b47-012d-4569-a59a-fd2effa613c1',
      '/api/admin/products/O26-J-00184',
      '/api/admin/products/batch',
      '/api/admin/products/O26-J-00184/photo/extra',
      // The gallery: a photograph's removal and the order (a DELETE and a PATCH, never a POST here) keep 64 KB anyway.
      `/api/admin/models/73c68b47-012d-4569-a59a-fd2effa613c1/gallery/${'ab'.repeat(32)}`,
      '/api/admin/models/73c68b47-012d-4569-a59a-fd2effa613c1/galleries',
      '/api/admin/models//gallery',
      // A post of the circle: its photograph's removal and the order (a DELETE and a PATCH) keep 64 KB anyway; the post
      // itself and its other routes are JSON.
      `/api/admin/circle/posts/73c68b47-012d-4569-a59a-fd2effa613c1/photos/${'ab'.repeat(32)}`,
      '/api/admin/circle/posts/73c68b47-012d-4569-a59a-fd2effa613c1',
      '/api/admin/circle/posts/73c68b47-012d-4569-a59a-fd2effa613c1/photo',
      '/api/admin/circle/posts/73c68b47-012d-4569-a59a-fd2effa613c1/publish',
      '/api/admin/circle/posts//photos',
      '/api/admin/circle/posts',
      '/api/v1/club/circle/73c68b47-012d-4569-a59a-fd2effa613c1',
      '/api/v1/lookbook/monolithe-ring',
      '/api/admin/models//image',
      '/api/admin/x/models/1/image',
      '/api/v1/verify',
      '/api/v1/media/' + 'ab'.repeat(32),
      '/admin/api/admin/models/1/image',
    ]) {
      expect(re.test(path), path).toBe(false);
    }
  });
});

describe('deploy/vps scripts and systemd units', () => {
  const scripts = readdirSync(join(STACK, 'scripts')).filter((f) => f.endsWith('.sh') && f !== 'lib.sh');

  it('are strict, documented bash with --help; destructive ones have --dry-run', () => {
    expect(scripts.sort()).toEqual(['backup.sh', 'bootstrap-ubuntu.sh', 'deploy.sh', 'geoip-update.sh', 'restore.sh', 'setup.sh']);
    for (const f of scripts) {
      const text = read(STACK, 'scripts', f);
      expect(text.startsWith('#!/usr/bin/env bash\n'), f).toBe(true);
      expect(text, f).toMatch(/\nset -Eeuo pipefail\n/);
      expect(text, f).toMatch(/-h \| --help\) usage; exit 0 ;;/);
      expect(statSync(join(STACK, 'scripts', f)).mode & 0o111, f).not.toBe(0);
    }
    for (const f of ['bootstrap-ubuntu.sh', 'deploy.sh', 'backup.sh', 'restore.sh', 'geoip-update.sh']) {
      expect(read(STACK, 'scripts', f), f).toMatch(/--dry-run\) DRY_RUN=true;/);
    }
    // restore asks for explicit confirmation and needs the offline identity.
    const restore = read(STACK, 'scripts', 'restore.sh');
    expect(restore).toMatch(/--identity <age identity file> is required/);
    expect(restore).toMatch(/Type the domain to continue/);
    // .env is parsed, never sourced or eval'ed.
    for (const f of [...scripts, 'lib.sh']) {
      expect(read(STACK, 'scripts', f), f).not.toMatch(/^\s*(source|\.)\s+["']?\$\{?ENV_FILE/m);
    }
  });

  it('install timers that run existing scripts as the deploy user', () => {
    for (const unit of ['orbes-backup', 'orbes-geoip']) {
      const service = read(STACK, 'systemd', `${unit}.service`);
      const timer = read(STACK, 'systemd', `${unit}.timer`);
      expect(service).toMatch(/\nType=oneshot\n/);
      expect(service).toMatch(/\nUser=@DEPLOY_USER@\n/);
      const script = /\nExecStart=@APP_DIR@\/(deploy\/vps\/scripts\/[a-z-]+\.sh)/.exec(service)![1];
      expect(existsSync(join(REPO, script)), script).toBe(true);
      expect(timer).toMatch(/\nPersistent=true\n/);
      expect(timer).toMatch(/\nOnCalendar=/);
      expect(timer).toMatch(/\nWantedBy=timers\.target\n/);
    }
    // Backups nightly; GeoIP weekly (DB-IP publishes monthly, and a run before the new
    // edition is out keeps the previous one, so a monthly timer could lag by a month).
    expect(read(STACK, 'systemd', 'orbes-backup.timer')).toMatch(/\nOnCalendar=\*-\*-\* \d\d:\d\d:\d\d\n/);
    expect(read(STACK, 'systemd', 'orbes-geoip.timer')).toMatch(/\nOnCalendar=(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \*-\*-\* \d\d:\d\d:\d\d\n/);
  });

  it('fail safe for a careless operator: Caddy validated before rollout, --latest never picks a safety backup, retention per kind', () => {
    const deploy = read(STACK, 'scripts', 'deploy.sh');
    // A typo in .env (EDGE_MODE, a comma in ADMIN_ALLOWED_IPS) must not crash-loop the only public entry point.
    expect(deploy.indexOf('caddy_validate || die')).toBeGreaterThan(0);
    expect(deploy.indexOf('caddy_validate || die')).toBeLessThan(deploy.indexOf('step "pre-deploy backup"'));
    expect(read(STACK, 'scripts', 'lib.sh')).toMatch(/caddy:2 caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile/);
    // Restoring "the latest" twice must not restore the state that was being replaced.
    expect(read(STACK, 'scripts', 'restore.sh')).toMatch(/--latest[\s\S]*! -name '\*-pre-restore\.tar\.age'/);
    // Many deploys in a day (pre-deploy backups) never prune the nightly history.
    const backup = read(STACK, 'scripts', 'backup.sh');
    expect(backup).toMatch(/prune "\$DAILY" "\$KEEP_DAILY" scheduled\nprune "\$DAILY" "\$KEEP_DAILY" event\n/);
  });

  it("keep the image's sources and Caddy's configuration readable whatever the operator's umask", () => {
    // setup.sh runs (and calls deploy.sh) under umask 077: the image once shipped 0600 sources (EACCES).
    const deploy = read(STACK, 'scripts', 'deploy.sh');
    const normalize = deploy.indexOf('normalize_build_context "$BUILD_CTX"');
    expect(normalize).toBeGreaterThan(deploy.indexOf('git -C "$REPO_DIR" archive'));
    expect(normalize).toBeGreaterThan(deploy.indexOf('| tar -C "$BUILD_CTX" -xf -'));
    expect(normalize).toBeLessThan(deploy.indexOf('run env DOCKER_BUILDKIT=1 docker build'));
    // An image built before that fix (same commit, same tag) is never reused as is.
    expect(deploy).toMatch(/\n {4}if image_sources_readable "\$IMAGE"; then\n {6}reuse=true\n/);
    // Caddy has no capabilities: its bind-mounted configuration must be readable before it
    // starts, and a container that crash-looped on it is recreated (restart count reset).
    expect(deploy.indexOf('ensure_caddy_config_readable')).toBeGreaterThan(0);
    expect(deploy.indexOf('ensure_caddy_config_readable')).toBeLessThan(deploy.indexOf('caddy_validate || die'));
    expect(deploy).toMatch(/\n {2}compose up -d --remove-orphans \|\| return 1\n {2}recreate_caddy_if_fixed \|\| return 1\n/);
    const restore = read(STACK, 'scripts', 'restore.sh');
    expect(restore.indexOf('ensure_caddy_config_readable')).toBeGreaterThan(0);
    expect(restore.indexOf('ensure_caddy_config_readable')).toBeLessThan(restore.indexOf('\ncompose up -d\n'));
    expect(restore).toMatch(/\ncompose up -d\nrecreate_caddy_if_fixed\n/);
  });

  it('normalise a build context made under umask 077, and open up the Caddy configuration only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbes-umask-'));
    try {
      const script = [
        'set -Eeuo pipefail',
        'umask 077',
        'source "$1"',
        // mktemp -d, as deploy.sh: the context root is 0700 from the start.
        'ctx="$(mktemp -d "$2/ctx.XXXXXX")"; mkdir -p "$ctx/src/core"; echo "{}" >"$ctx/package.json"; echo x >"$ctx/src/core/a.ts"',
        'echo secret >"$2/outside"; ln -s "$2/outside" "$ctx/link"',
        'normalize_build_context "$ctx"',
        'echo "ctx=$ctx"',
        'STACK_DIR="$2/stack"; mkdir -p "$STACK_DIR/caddy.d"',
        'echo ":80" >"$STACK_DIR/Caddyfile"; echo "# edge" >"$STACK_DIR/caddy.d/edge-direct.caddy"; echo "SECRET=1" >"$STACK_DIR/.env"',
        'echo "fixed-before=$CADDY_CONFIG_FIXED"',
        'ensure_caddy_config_readable',
        'ensure_caddy_config_readable',
        'echo "fixed-after=$CADDY_CONFIG_FIXED"',
      ].join('\n');
      // Pinned: lib.sh reads DRY_RUN and QUIET from the environment.
      const env = { ...process.env, DRY_RUN: 'false', QUIET: 'false' };
      const r = spawnSync('bash', ['-c', script, 'bash', join(STACK, 'scripts', 'lib.sh'), dir], { encoding: 'utf8', env });
      expect(r.status, r.stderr).toBe(0);
      const ctx = /^ctx=.*\/(ctx\.\w+)$/m.exec(r.stdout)![1];
      const mode = (...p: string[]) => statSync(join(dir, ...p)).mode & 0o777;
      // Readable and traversable by `node`, writable by no one else; the context root stays
      // private and a symbolic link's target outside it is left alone.
      expect(mode(ctx)).toBe(0o700);
      expect(mode(ctx, 'package.json')).toBe(0o644);
      expect(mode(ctx, 'src')).toBe(0o755);
      expect(mode(ctx, 'src', 'core', 'a.ts')).toBe(0o644);
      expect(mode('outside')).toBe(0o600);
      // Caddy's files opened up once (the second call has nothing to do), which flags the
      // container for recreation; .env untouched.
      expect(mode('stack', 'Caddyfile')).toBe(0o644);
      expect(mode('stack', 'caddy.d')).toBe(0o755);
      expect(mode('stack', 'caddy.d', 'edge-direct.caddy')).toBe(0o644);
      expect(mode('stack', '.env')).toBe(0o600);
      expect(r.stderr.match(/making the Caddy configuration readable/g)).toHaveLength(1);
      expect(r.stdout).toMatch(/^fixed-before=false$/m);
      expect(r.stdout).toMatch(/^fixed-after=true$/m);
      // --dry-run only shows the change.
      const dry = spawnSync('bash', ['-c', [
        'set -Eeuo pipefail', 'umask 077', 'source "$1"',
        'STACK_DIR="$2/dry"; mkdir -p "$STACK_DIR/caddy.d"; echo ":80" >"$STACK_DIR/Caddyfile"',
        'ensure_caddy_config_readable', 'echo "fixed=$CADDY_CONFIG_FIXED"',
      ].join('\n'), 'bash', join(STACK, 'scripts', 'lib.sh'), dir], { encoding: 'utf8', env: { ...env, DRY_RUN: 'true' } });
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stderr).toMatch(/\[dry-run\] chmod -R a\+rX/);
      expect(mode('dry', 'Caddyfile')).toBe(0o600);
      expect(dry.stdout).toMatch(/^fixed=false$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keep the filled-in .env and local state out of git', () => {
    const ignore = read(STACK, '.gitignore').split('\n').map((l) => l.trim());
    for (const entry of ['.env', '.env.*', '!.env.example', '.state/']) expect(ignore, entry).toContain(entry);
  });

  it('enrol the first TOTP from the environment, never with the secret on a command line (scripts/admin.ts reads ADMIN_TOTP_SECRET)', () => {
    for (const [name, text] of [
      ['README.md', read(STACK, 'README.md')],
      ['scripts/setup.sh', read(STACK, 'scripts', 'setup.sh')],
    ] as const) {
      expect(text, name).not.toMatch(/totp-enable[^\n]*--secret/);
      // The four lines of LAUNCH.md and DEPLOYMENT.md: read without echo, off the screen, into the container, then gone.
      expect(text, name).toMatch(/read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET/);
      expect(text, name).toMatch(/docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts\/admin\.ts totp-enable --email <[^>]+> --code <[^>]+>/);
      expect(text, name).toMatch(/\n\s*unset ADMIN_TOTP_SECRET\n/);
    }
  });
});
