import { describe, expect, it } from 'vitest';
import { ConfigError, configWarnings, DEFAULT_ANOMALY_CONFIG, loadConfig, redactConfig, testConfig } from '../../src/server/config.js';

const KEY32 = Buffer.alloc(32, 7).toString('base64url'); // 'BwcH…' (43 chars, no padding)
const RANDOMISH_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff)).toString('base64url');
const COOKIE = 'c00kie-Secret-with-Plenty-of-Entropy-0123456789';
const PEPPER = 'pepper-Secret-with-Plenty-of-Entropy-9876543210';

const PROD = {
  ORBES_ENV: 'production',
  PUBLIC_ORIGIN: 'https://verify.theorbes.com',
  DATABASE_URL: 'postgres://orbes:pw@db:5432/orbes',
  COOKIE_SECRET: COOKIE,
  IP_HASH_PEPPER: PEPPER,
  KEY_PROVIDER: 'local',
  KEY_DIR: '/var/lib/orbes/keys',
  KEY_ENCRYPTION_KEY: RANDOMISH_KEY,
};

function issues(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).issues;
  }
  return [];
}

describe('loadConfig — development defaults', () => {
  it('works with an empty environment', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      env: 'development',
      host: '127.0.0.1',
      port: 8080,
      publicOrigin: 'http://localhost:8080',
      databaseUrl: 'pglite:memory',
      trustProxy: false,
      geo: { mode: 'none' },
      keys: { provider: 'memory' },
      rateLimits: { verifyPerMinute: 60, authPerMinute: 10, adminPerMinute: 300, apiPerMinute: 120 },
      sessionTtlHours: { account: 720, admin: 8 },
      migrateOnStart: false,
      logLevel: 'debug',
      adminRequireMfa: false,
    });
    expect(c.anomaly).toEqual(DEFAULT_ANOMALY_CONFIG);
    expect(c.cookieSecret.length).toBeGreaterThanOrEqual(32);
    expect(c.ipHashPepper).not.toBe(c.cookieSecret);
    expect(c.bootstrapAdmin).toBeUndefined();
  });

  it('is deeply frozen', () => {
    const c = loadConfig({});
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.anomaly)).toBe(true);
    expect(() => {
      (c.anomaly as { suspiciousThreshold: number }).suspiciousThreshold = 1;
    }).toThrow(TypeError);
  });

  it('treats empty values as unset and parses typed values', () => {
    const c = loadConfig({
      HOST: '0.0.0.0',
      PORT: '3000',
      PUBLIC_ORIGIN: 'https://example.test:8443',
      DATABASE_URL: '  ',
      TRUST_PROXY: '10.0.0.0/8,127.0.0.1',
      GEO_MODE: 'headers',
      GEO_COUNTRY_HEADER: 'X-Geo-Country',
      GEO_LAT_HEADER: 'x-geo-lat',
      GEO_LON_HEADER: 'x-geo-lon',
      ANOMALY_SUSPICIOUS_THRESHOLD: '75',
      ANOMALY_DECAY_DAYS: '14.5',
      RATE_LIMIT_VERIFY_PER_MINUTE: '120',
      SESSION_TTL_ADMIN_HOURS: '4',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@theorbes.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'a-long-bootstrap-password',
    });
    expect(c.port).toBe(3000);
    expect(c.publicOrigin).toBe('https://example.test:8443');
    expect(c.databaseUrl).toBe('pglite:memory');
    expect(c.trustProxy).toBe('10.0.0.0/8,127.0.0.1');
    expect(c.geo).toEqual({ mode: 'headers', countryHeader: 'x-geo-country', latHeader: 'x-geo-lat', lonHeader: 'x-geo-lon' });
    expect(c.anomaly.suspiciousThreshold).toBe(75);
    expect(c.anomaly.decayDays).toBe(14.5);
    expect(c.anomaly.velocityMaxScans).toBe(DEFAULT_ANOMALY_CONFIG.velocityMaxScans);
    expect(c.rateLimits.verifyPerMinute).toBe(120);
    expect(c.sessionTtlHours.admin).toBe(4);
    expect(c.bootstrapAdmin).toEqual({ email: 'admin@theorbes.com', password: 'a-long-bootstrap-password' });
  });

  it('parses TRUST_PROXY booleans and refuses hop counts', () => {
    for (const v of ['true', 'TRUE', 'yes']) expect(loadConfig({ TRUST_PROXY: v }).trustProxy).toBe(true);
    // '1' used to mean "trust every hop"; a number is ambiguous, so it is refused (security review SEC-1).
    expect(() => loadConfig({ TRUST_PROXY: '1' })).toThrow(/TRUST_PROXY: hop counts are not supported/);
    for (const v of ['false', '0', 'no']) expect(loadConfig({ TRUST_PROXY: v }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });

  it('test env uses generous rate limits; NODE_ENV=production alone selects production rules', () => {
    expect(loadConfig({ ORBES_ENV: 'test' }).rateLimits.verifyPerMinute).toBe(10_000);
    expect(issues({ NODE_ENV: 'production' })).toContain('PUBLIC_ORIGIN: required in production');
  });

  it('local key provider needs an absolute dir and a 32-byte base64url key', () => {
    expect(loadConfig({ KEY_PROVIDER: 'local', KEY_DIR: '/k', KEY_ENCRYPTION_KEY: KEY32 }).keys).toEqual({
      provider: 'local',
      dir: '/k',
      encryptionKey: KEY32,
    });
    expect(issues({ KEY_PROVIDER: 'local' })).toEqual([
      'KEY_DIR: required when KEY_PROVIDER=local',
      'KEY_ENCRYPTION_KEY: required when KEY_PROVIDER=local',
    ]);
    expect(issues({ KEY_PROVIDER: 'local', KEY_DIR: 'keys', KEY_ENCRYPTION_KEY: KEY32 })).toEqual(['KEY_DIR: must be an absolute path']);
    for (const bad of [Buffer.alloc(31).toString('base64url'), `${KEY32}=`, Buffer.alloc(32).toString('base64'), 'not base64!']) {
      expect(issues({ KEY_PROVIDER: 'local', KEY_DIR: '/k', KEY_ENCRYPTION_KEY: bad })[0]).toMatch(/^KEY_ENCRYPTION_KEY:/);
    }
  });

  it('collects every problem, naming variables but never values', () => {
    const secret = 'short-secret-value';
    const list = issues({
      ORBES_ENV: 'staging',
      PORT: '99999',
      PUBLIC_ORIGIN: 'https://x.test/path',
      DATABASE_URL: `mysql://u:${secret}@h/db`,
      COOKIE_SECRET: secret,
      GEO_MODE: 'gps',
      KEY_PROVIDER: 'hsm',
      BOOTSTRAP_ADMIN_EMAIL: 'not-an-email',
      BOOTSTRAP_ADMIN_PASSWORD: 'short',
      ANOMALY_SUSPICIOUS_THRESHOLD: '0',
      ANOMALY_TYPO_SETTING: '1',
      RATE_LIMIT_VERIFY_PER_MINUTE: 'fast',
      RATE_LIMIT_NOPE: '1',
      SESSION_TTL_ACCOUNT_HOURS: '-1',
    });
    const vars = list.map((i) => i.split(':')[0]);
    expect(vars).toEqual([
      'ORBES_ENV',
      'PORT',
      'PUBLIC_ORIGIN',
      'DATABASE_URL',
      'COOKIE_SECRET',
      'GEO_MODE',
      'KEY_PROVIDER',
      'BOOTSTRAP_ADMIN_EMAIL',
      'BOOTSTRAP_ADMIN_PASSWORD',
      'ANOMALY_SUSPICIOUS_THRESHOLD',
      'ANOMALY_TYPO_SETTING',
      'RATE_LIMIT_VERIFY_PER_MINUTE',
      'RATE_LIMIT_NOPE',
      'SESSION_TTL_ACCOUNT_HOURS',
    ]);
    expect(list.join('\n')).not.toContain(secret);
    expect(() => loadConfig({ COOKIE_SECRET: secret })).toThrow(/COOKIE_SECRET/);
  });

  it('validates geo header configuration', () => {
    expect(issues({ GEO_MODE: 'headers' })).toEqual(['GEO_COUNTRY_HEADER: required when GEO_MODE=headers']);
    expect(issues({ GEO_MODE: 'headers', GEO_COUNTRY_HEADER: 'x-c', GEO_LAT_HEADER: 'x-lat' })).toEqual([
      'GEO_LAT_HEADER / GEO_LON_HEADER: set both or neither',
    ]);
    expect(issues({ GEO_MODE: 'headers', GEO_COUNTRY_HEADER: 'bad header' })[0]).toMatch(/^GEO_COUNTRY_HEADER:/);
    expect(loadConfig({ GEO_MODE: 'cloudflare' }).geo).toEqual({ mode: 'cloudflare' });
  });

  it('requires bootstrap email and password together', () => {
    expect(issues({ BOOTSTRAP_ADMIN_EMAIL: 'a@b.co' })).toEqual(['BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD: set both or neither']);
  });
});

describe('loadConfig — production hardening', () => {
  it('accepts a hardened production environment', () => {
    const c = loadConfig(PROD);
    expect(c.env).toBe('production');
    expect(c.host).toBe('0.0.0.0');
    expect(c.keys.provider).toBe('local');
    expect(c.rateLimits.verifyPerMinute).toBe(60);
  });

  it('requires the essentials (no defaults in production)', () => {
    expect(issues({ ORBES_ENV: 'production' })).toEqual([
      'PUBLIC_ORIGIN: required in production',
      'DATABASE_URL: required in production',
      'COOKIE_SECRET: required in production',
      'IP_HASH_PEPPER: required in production',
      'KEY_DIR: required when KEY_PROVIDER=local',
      'KEY_ENCRYPTION_KEY: required when KEY_PROVIDER=local',
    ]);
  });

  it('refuses pglite, the memory key provider, http origins and dev/short/weak secrets', () => {
    expect(issues({ ...PROD, DATABASE_URL: 'pglite:/data' })).toEqual(['DATABASE_URL: pglite is refused in production']);
    expect(issues({ ...PROD, DATABASE_URL: 'pglite:memory' })).toEqual(['DATABASE_URL: pglite is refused in production']);
    expect(issues({ ...PROD, KEY_PROVIDER: 'memory' })).toEqual(['KEY_PROVIDER: memory is refused in production']);
    expect(issues({ ...PROD, PUBLIC_ORIGIN: 'http://verify.theorbes.com' })).toEqual(['PUBLIC_ORIGIN: must be https:// in production']);
    expect(issues({ ...PROD, COOKIE_SECRET: 'x'.repeat(31) })).toEqual(['COOKIE_SECRET: must be at least 32 characters']);
    expect(issues({ ...PROD, COOKIE_SECRET: 'ab'.repeat(40) })).toEqual(['COOKIE_SECRET: too little variety, use a random value']);
    expect(issues({ ...PROD, IP_HASH_PEPPER: COOKIE })).toEqual(['COOKIE_SECRET / IP_HASH_PEPPER: must be different secrets']);
    const dev = loadConfig({});
    expect(issues({ ...PROD, COOKIE_SECRET: dev.cookieSecret })).toEqual([
      'COOKIE_SECRET: the development default is refused in production',
    ]);
    expect(issues({ ...PROD, IP_HASH_PEPPER: dev.ipHashPepper })).toEqual([
      'IP_HASH_PEPPER: the development default is refused in production',
    ]);
    expect(issues({ ...PROD, KEY_ENCRYPTION_KEY: KEY32 })).toEqual(['KEY_ENCRYPTION_KEY: refused (all bytes identical)']);
    expect(issues({ ...PROD, GEO_MODE: 'headers', GEO_COUNTRY_HEADER: 'x-country' })).toEqual([
      'GEO_MODE: headers mode requires TRUST_PROXY in production',
    ]);
    expect(loadConfig({ ...PROD, GEO_MODE: 'headers', GEO_COUNTRY_HEADER: 'x-country', TRUST_PROXY: '10.0.0.0/8' }).geo.mode).toBe('headers');
  });
});

describe('loadConfig — operations settings', () => {
  it('formalises MIGRATE_ON_START, LOG_LEVEL and ADMIN_REQUIRE_MFA with per-environment defaults', () => {
    expect(loadConfig({ ORBES_ENV: 'test' })).toMatchObject({ migrateOnStart: false, logLevel: 'warn', adminRequireMfa: false });
    expect(loadConfig(PROD)).toMatchObject({ migrateOnStart: false, logLevel: 'info', adminRequireMfa: true });
    expect(loadConfig({ ...PROD, MIGRATE_ON_START: 'true', LOG_LEVEL: 'WARN', ADMIN_REQUIRE_MFA: 'false' })).toMatchObject({
      migrateOnStart: true,
      logLevel: 'warn',
      adminRequireMfa: false,
    });
    expect(loadConfig({ ADMIN_REQUIRE_MFA: 'yes', MIGRATE_ON_START: '1', LOG_LEVEL: 'silent' })).toMatchObject({
      adminRequireMfa: true,
      migrateOnStart: true,
      logLevel: 'silent',
    });
    expect(issues({ LOG_LEVEL: 'verbose', MIGRATE_ON_START: 'maybe', ADMIN_REQUIRE_MFA: '2' }).map((i) => i.split(':')[0])).toEqual([
      'MIGRATE_ON_START',
      'LOG_LEVEL',
      'ADMIN_REQUIRE_MFA',
    ]);
  });

  it('warns (without refusing) when production admin sessions may skip TOTP', () => {
    expect(configWarnings(loadConfig(PROD))).toEqual([]);
    expect(configWarnings(loadConfig({ ...PROD, ADMIN_REQUIRE_MFA: 'false' }))).toEqual([
      expect.stringMatching(/^ADMIN_REQUIRE_MFA: .*TOTP/),
    ]);
    expect(configWarnings(loadConfig({}))).toEqual([]);
  });

  it('RATE_LIMIT_API_PER_MINUTE is the budget of the api route group, separate from the admin one', () => {
    const c = loadConfig({ RATE_LIMIT_API_PER_MINUTE: '42', RATE_LIMIT_ADMIN_PER_MINUTE: '500' });
    expect(c.rateLimits).toMatchObject({ apiPerMinute: 42, adminPerMinute: 500 });
    expect(issues({ RATE_LIMIT_API_PER_MINUTE: '0' })[0]).toMatch(/^RATE_LIMIT_API_PER_MINUTE: /);
  });

  it('refuses proxy trust that a client could forge, and edge geo without proxy trust, in production', () => {
    expect(issues({ ...PROD, TRUST_PROXY: 'true' })).toEqual([expect.stringMatching(/^TRUST_PROXY: "true" trusts every X-Forwarded-For hop/)]);
    expect(issues({ ...PROD, TRUST_PROXY: '2' })).toEqual([expect.stringMatching(/^TRUST_PROXY: hop counts are not supported/)]);
    expect(issues({ ...PROD, GEO_MODE: 'cloudflare' })).toEqual(['GEO_MODE: cloudflare mode requires TRUST_PROXY in production']);
    expect(loadConfig({ ...PROD, GEO_MODE: 'cloudflare', TRUST_PROXY: '173.245.48.0/20' }).geo.mode).toBe('cloudflare');
  });
});

describe('testConfig / redactConfig', () => {
  it('testConfig merges nested overrides on a valid test config', () => {
    const c = testConfig({ anomaly: { suspiciousThreshold: 10 }, rateLimits: { verifyPerMinute: 3 }, publicOrigin: 'https://t.test' });
    expect(c.env).toBe('test');
    expect(c.databaseUrl).toBe('pglite:memory');
    expect(c.keys.provider).toBe('memory');
    expect(c.anomaly).toEqual({ ...DEFAULT_ANOMALY_CONFIG, suspiciousThreshold: 10 });
    expect(c.rateLimits).toEqual({ verifyPerMinute: 3, authPerMinute: 10_000, adminPerMinute: 10_000, apiPerMinute: 10_000 });
    expect(c.publicOrigin).toBe('https://t.test');
    expect(Object.isFrozen(c.anomaly)).toBe(true);
  });

  it('redactConfig never contains secrets or anomaly thresholds', () => {
    const c = loadConfig({ ...PROD, BOOTSTRAP_ADMIN_EMAIL: 'a@theorbes.com', BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password-123' });
    const text = JSON.stringify(redactConfig(c));
    for (const secret of [COOKIE, PEPPER, RANDOMISH_KEY, 'bootstrap-password-123', ':pw@']) expect(text).not.toContain(secret);
    expect(text).not.toContain('suspiciousThreshold');
    expect(redactConfig(c)).toMatchObject({ database: 'postgres://orbes:***@db:5432/orbes', keys: { provider: 'local', encryptionKey: '[set]' } });
  });
});
