/**
 * Deployment files stay in sync with the code and keep their safety
 * properties: .env.example documents every variable the server reads and is
 * fail-safe (a copy with the secrets left empty cannot start in production);
 * the Dockerfile, docker-compose.yml and .dockerignore keep the hardening.
 *
 * The images themselves are built and run outside the unit test suite
 * (docker build / docker compose up); this guards the text against drift.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_ANOMALY_CONFIG, loadConfig } from '../../src/server/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');

/** `NAME=value` and commented `# NAME=value` lines of .env.example. */
function parseEnvExample(text: string): { active: Map<string, string>; documented: Set<string> } {
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

const SECRETS = ['COOKIE_SECRET', 'IP_HASH_PEPPER', 'KEY_ENCRYPTION_KEY', 'POSTGRES_PASSWORD', 'BOOTSTRAP_ADMIN_PASSWORD', 'DEMO_ACCOUNT_PASSWORD'];

describe('.env.example', () => {
  const example = parseEnvExample(read('.env.example'));

  it('documents every environment variable the server and the CLIs read', () => {
    const sources = ['src/server/config.ts', 'src/server/index.ts', 'scripts/db.ts', 'scripts/admin.ts', 'docker-compose.yml'].map(read).join('\n');
    const names = new Set<string>();
    for (const m of sources.matchAll(/\b(?:e|env|process\.env)\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
    for (const m of read('src/server/config.ts').matchAll(/^\s+((?:ANOMALY|RATE_LIMIT)_[A-Z_]+):/gm)) names.add(m[1]);
    for (const m of read('docker-compose.yml').matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    for (const n of ['NODE_ENV']) names.delete(n); // set by the image, not an operator setting
    const missing = [...names].filter((n) => !example.documented.has(n)).sort();
    expect(missing).toEqual([]);
    expect(names.size).toBeGreaterThan(30);
  });

  it('ships every secret empty, so a copy that was not filled in cannot start in production', () => {
    for (const s of SECRETS) expect(example.active.get(s), s).toBe('');
    expect(() => loadConfig({ ...Object.fromEntries(example.active), DATABASE_URL: 'postgres://orbes@db:5432/orbes' })).toThrow(ConfigError);
    try {
      loadConfig({ ...Object.fromEntries(example.active), DATABASE_URL: 'postgres://orbes@db:5432/orbes' });
    } catch (e) {
      const issues = (e as ConfigError).issues.join('\n');
      expect(issues).toMatch(/COOKIE_SECRET: required in production/);
      expect(issues).toMatch(/IP_HASH_PEPPER: required in production/);
      expect(issues).toMatch(/KEY_ENCRYPTION_KEY: required/);
    }
  });

  it('once the secrets are filled in, loads as a valid production configuration with the documented defaults', () => {
    const env = {
      ...Object.fromEntries(example.active),
      DATABASE_URL: 'postgres://orbes:pw@db:5432/orbes',
      COOKIE_SECRET: randomBytes(48).toString('base64url'),
      IP_HASH_PEPPER: randomBytes(48).toString('base64url'),
      KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    };
    const c = loadConfig(env);
    expect(c.env).toBe('production');
    expect(c.keys).toEqual({ provider: 'local', dir: '/var/lib/orbes/keys', encryptionKey: env.KEY_ENCRYPTION_KEY });
    expect(c.rateLimits).toEqual({ verifyPerMinute: 60, authPerMinute: 10, adminPerMinute: 300, apiPerMinute: 120 });
    expect(c.sessionTtlHours).toEqual({ account: 720, admin: 8 });
    expect(c.trustProxy).toBe('uniquelocal');
    expect(c.anomaly).toEqual(DEFAULT_ANOMALY_CONFIG);
    // The commented anomaly defaults match the code's defaults.
    const text = read('.env.example');
    for (const [, name, value] of [...text.matchAll(/^#\s*(ANOMALY_[A-Z_]+)=(\d+)/gm)]) {
      const key = name
        .replace(/^ANOMALY_/, '')
        .toLowerCase()
        .replace(/_([a-z])/g, (_m: string, ch: string) => ch.toUpperCase());
      expect(DEFAULT_ANOMALY_CONFIG[key as keyof typeof DEFAULT_ANOMALY_CONFIG], name).toBe(Number(value));
    }
  });
});

describe('Dockerfile, docker-compose.yml, .dockerignore', () => {
  const dockerfile = read('Dockerfile');
  const compose = read('docker-compose.yml');
  const ignore = read('.dockerignore').split('\n').map((l) => l.trim());

  it('builds multi-stage on node:22-slim, installs production dependencies only and runs as a non-root user', () => {
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:22-slim$/m);
    expect(dockerfile.match(/^FROM \$\{NODE_IMAGE\} AS \w+/gm)?.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/npm ci --omit=dev --ignore-scripts/);
    expect(dockerfile).toMatch(/npm run build:web/);
    expect(dockerfile).toMatch(/^USER node$/m);
    // The operator CLIs ship in the runtime image (migrations, keys, console users).
    expect(dockerfile).toMatch(/^COPY scripts\/db\.ts scripts\/keys\.ts scripts\/admin\.ts \.\/scripts\/$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK [^\n]*\\\n\s+CMD [^\n]*\/api\/v1\/health/m);
    expect(dockerfile).toMatch(/^CMD \["node", "--import", "tsx", "src\/server\/index\.ts"\]$/m);
    // No secret ever baked into an image layer.
    for (const s of [...SECRETS, 'DATABASE_URL']) expect(dockerfile, s).not.toMatch(new RegExp(`^(ENV|ARG)\\b.*\\b${s}\\b`, 'm'));
  });

  it('runs the app hardened next to postgres:17 with persistent volumes, never publishing the database', () => {
    expect(compose).toMatch(/image: postgres:17\b/);
    expect(compose).toMatch(/POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
    expect(compose).toMatch(/- pgdata:\/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/- keys:\/var\/lib\/orbes\/keys/);
    expect(compose).toMatch(/read_only: true/);
    expect(compose).toMatch(/cap_drop: \[ALL\]/);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).toMatch(/condition: service_healthy/);
    expect(compose).toMatch(/"\$\{APP_BIND:-127\.0\.0\.1\}:\$\{APP_PORT:-8080\}:8080"/);
    // Only one `ports:` block (the app's): the database stays on the internal network.
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
  });

  it('keeps local state, secrets and dependencies out of the build context', () => {
    for (const entry of ['node_modules', 'dist', 'out', '.env', '.env.*', '!.env.example', '.secrets', '.data', '*.key.json', 'test']) {
      expect(ignore, entry).toContain(entry);
    }
  });
});
