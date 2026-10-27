import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADS_ENV, ConfigError, configWarnings, DEFAULT_ANOMALY_CONFIG, loadConfig, redactConfig, testConfig } from '../../src/server/config.js';

const GENOME = join(import.meta.dirname, '..', '..');

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
  SCAN_RETENTION_DAYS: '395',
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

  it('SCAN_RETENTION_DAYS: off by default, 30..3650 whole days, never shorter than the anomaly look-back', () => {
    expect(loadConfig({}).scanRetentionDays).toBeNull();
    expect(loadConfig({ SCAN_RETENTION_DAYS: '400' }).scanRetentionDays).toBe(400);
    expect(loadConfig({ SCAN_RETENTION_DAYS: '30' }).scanRetentionDays).toBe(30);
    for (const bad of ['29', '3651', '45.5', 'forever', '-1']) {
      expect(issues({ SCAN_RETENTION_DAYS: bad }).map((i) => i.split(':')[0]), bad).toEqual(['SCAN_RETENTION_DAYS']);
    }
    // The purge must never remove history that anomaly scoring still reads.
    expect(issues({ SCAN_RETENTION_DAYS: '45', ANOMALY_GEO_WINDOW_DAYS: '60' })).toEqual([
      expect.stringMatching(/^SCAN_RETENTION_DAYS: .*60 days/),
    ]);
    expect(issues({ SCAN_RETENTION_DAYS: '45', ANOMALY_DECAY_DAYS: '50.5' })).toEqual([expect.stringMatching(/^SCAN_RETENTION_DAYS: .*51 days/)]);
    expect(loadConfig({ SCAN_RETENTION_DAYS: '60', ANOMALY_GEO_WINDOW_DAYS: '60' }).scanRetentionDays).toBe(60);
    expect(redactConfig(loadConfig({ SCAN_RETENTION_DAYS: '400' }))).toMatchObject({ scanRetentionDays: 400 });
  });

  it('TRANSFER_ACCEPT_REQUIRE_PRODUCT (F-03): on by default everywhere, a switch, and a warning while production turns it off', () => {
    expect(loadConfig({}).transferAcceptRequireProduct).toBe(true);
    expect(loadConfig(PROD).transferAcceptRequireProduct).toBe(true);
    expect(loadConfig({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'false' }).transferAcceptRequireProduct).toBe(false);
    expect(loadConfig({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'NO' }).transferAcceptRequireProduct).toBe(false);
    expect(loadConfig({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'yes' }).transferAcceptRequireProduct).toBe(true);
    expect(loadConfig({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: '' }).transferAcceptRequireProduct).toBe(true);
    expect(issues({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'sometimes' })).toEqual(['TRANSFER_ACCEPT_REQUIRE_PRODUCT: must be true or false']);
    expect(configWarnings(loadConfig({ ...PROD, TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'false' }))).toEqual([expect.stringMatching(/^TRANSFER_ACCEPT_REQUIRE_PRODUCT: .*ORBES Client Services/)]);
    expect(configWarnings(loadConfig({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'false' }))).toEqual([]);
    expect(redactConfig(loadConfig({ TRANSFER_ACCEPT_REQUIRE_PRODUCT: 'false' }))).toMatchObject({ transferAcceptRequireProduct: false });
    expect(testConfig().transferAcceptRequireProduct).toBe(true);
  });

  it('warns in production while no scan retention period is set (scan history would grow without bound)', () => {
    expect(configWarnings(loadConfig({ ...PROD, SCAN_RETENTION_DAYS: undefined }))).toEqual([expect.stringMatching(/^SCAN_RETENTION_DAYS: /)]);
    expect(configWarnings(loadConfig({ ...PROD, SCAN_RETENTION_DAYS: '395' }))).toEqual([]);
  });

  it('CLIENT_SERVICES_*: optional, none by default, each validated, hours only beside an email or a phone', () => {
    expect(loadConfig({}).clientServices).toEqual({});
    expect(loadConfig(PROD).clientServices).toEqual({});
    const c = loadConfig({
      ...PROD,
      CLIENT_SERVICES_EMAIL: 'clientservices@theorbes.com',
      CLIENT_SERVICES_PHONE: ' +33 1 23 45 67 89 ',
      CLIENT_SERVICES_HOURS: 'Monday to Saturday, 10:00–19:00 (Paris)',
    });
    expect(c.clientServices).toEqual({ email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' });
    expect(Object.isFrozen(c.clientServices)).toBe(true);
    // Each alone is accepted; an empty value is unset.
    expect(loadConfig({ CLIENT_SERVICES_PHONE: '+33.1.23.45.67.89' }).clientServices).toEqual({ phone: '+33.1.23.45.67.89' });
    expect(loadConfig({ CLIENT_SERVICES_EMAIL: 'care@theorbes.com', CLIENT_SERVICES_PHONE: '' }).clientServices).toEqual({ email: 'care@theorbes.com' });
    expect(loadConfig({ CLIENT_SERVICES_PHONE: '+1-212-555-0100' }).clientServices.phone).toBe('+1-212-555-0100');
    // The mailbox goes into a mailto: link as it is, so URL syntax is refused (? & # % / : and spaces).
    for (const bad of ['not-an-email', 'care@theorbes', 'care@theorbes.com?cc=x@y.z', 'a&b@theorbes.com', 'care#1@theorbes.com', 'c%40@theorbes.com', 'care @theorbes.com', 'a/b@theorbes.com']) {
      expect(issues({ CLIENT_SERVICES_EMAIL: bad }).map((i) => i.split(':')[0]), bad).toEqual(['CLIENT_SERVICES_EMAIL']);
    }
    // International format only: a leading +, then 7 to 15 digits with single separators.
    for (const bad of ['01 23 45 67 89', '+33 (0)1 23 45 67 89', '+0 123 456 789', '+33', '+33 1 23 45 67 89 01 23 45', '+33  1 23 45 67 89', 'tel:+33123456789', '+33 1 23 45 67 8a']) {
      expect(issues({ CLIENT_SERVICES_PHONE: bad }).map((i) => i.split(':')[0]), bad).toEqual(['CLIENT_SERVICES_PHONE']);
    }
    // Hours: one line of at most 120 characters, and never alone (they would offer no way to reach anyone).
    expect(issues({ CLIENT_SERVICES_HOURS: '10:00–19:00' })).toEqual(['CLIENT_SERVICES_HOURS: set it together with CLIENT_SERVICES_EMAIL or CLIENT_SERVICES_PHONE']);
    expect(issues({ CLIENT_SERVICES_PHONE: '+33 1 23 45 67 89', CLIENT_SERVICES_HOURS: 'x'.repeat(121) })).toEqual(['CLIENT_SERVICES_HOURS: must be at most 120 characters']);
    expect(issues({ CLIENT_SERVICES_PHONE: '+33 1 23 45 67 89', CLIENT_SERVICES_HOURS: 'Monday\nto Saturday' })).toEqual(['CLIENT_SERVICES_HOURS: must be one line of plain text']);
  });

  it('CARE_SUBSCRIBE_URL (P-M02): optional, none by default, an https:// URL without credentials, masked in the log', () => {
    expect(loadConfig({}).careSubscribeUrl).toBeNull();
    expect(loadConfig(PROD).careSubscribeUrl).toBeNull();
    expect(loadConfig({ CARE_SUBSCRIBE_URL: '' }).careSubscribeUrl).toBeNull();
    expect(testConfig().careSubscribeUrl).toBeNull();
    expect(loadConfig({ ...PROD, CARE_SUBSCRIBE_URL: ' https://whop.com/orbes/care ' }).careSubscribeUrl).toBe('https://whop.com/orbes/care');
    expect(loadConfig({ CARE_SUBSCRIBE_URL: 'https://whop.com/checkout/plan_X1?d=1' }).careSubscribeUrl).toBe('https://whop.com/checkout/plan_X1?d=1');
    // https only (it becomes a link as it is), no credentials, no space, at most 2 048 characters.
    for (const bad of ['http://whop.com/orbes', 'javascript:alert(1)', 'whop.com/orbes', '//whop.com/orbes', 'https://user:pw@whop.com/orbes', 'https://whop.com/a b', 'ftp://whop.com', `https://whop.com/${'a'.repeat(2048)}`]) {
      expect(issues({ CARE_SUBSCRIBE_URL: bad }).map((i) => i.split(':')[0]), bad).toEqual(['CARE_SUBSCRIBE_URL']);
    }
    // No warning either way: unset is the expected state until the subscription opens.
    expect(configWarnings(loadConfig({ ...PROD, SCAN_RETENTION_DAYS: '395' }))).toEqual([]);
    expect(configWarnings(loadConfig({ ...PROD, SCAN_RETENTION_DAYS: '395', CARE_SUBSCRIBE_URL: 'https://whop.com/orbes' }))).toEqual([]);
    const text = JSON.stringify(redactConfig(loadConfig({ CARE_SUBSCRIBE_URL: 'https://whop.com/orbes/care' })));
    expect(text).not.toContain('whop.com');
    expect(redactConfig(loadConfig({ CARE_SUBSCRIBE_URL: 'https://whop.com/orbes/care' }))).toMatchObject({ careSubscribeUrl: '[set]' });
    expect(redactConfig(loadConfig({})).careSubscribeUrl).toBeUndefined();
  });

  it('EMAIL_TRANSPORT (macro scope E0): off by default and when empty; smtp needs its host, sender, user and password, named; masked in the log', () => {
    expect(loadConfig({}).email).toEqual({ transport: 'off' });
    expect(loadConfig(PROD).email).toEqual({ transport: 'off' });
    expect(loadConfig({ EMAIL_TRANSPORT: '' }).email).toEqual({ transport: 'off' });
    expect(loadConfig({ EMAIL_TRANSPORT: 'OFF', SMTP_HOST: 'smtp.example.com' }).email).toEqual({ transport: 'off' });
    expect(testConfig().email).toEqual({ transport: 'off' });
    const SMTP = { EMAIL_TRANSPORT: 'smtp', EMAIL_FROM: 'ORBES <hello@theorbes.com>', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'apikey', SMTP_PASSWORD: 'smtp-Secret-0123456789' };
    expect(loadConfig({ ...PROD, ...SMTP }).email).toEqual({
      transport: 'smtp',
      from: { address: 'hello@theorbes.com', name: 'ORBES' },
      replyTo: null,
      smtp: { host: 'smtp.example.com', port: 465, security: 'tls', user: 'apikey', password: 'smtp-Secret-0123456789' },
    });
    // The security follows the port, the port the security; a plain sender and a reply-to.
    expect(loadConfig({ ...SMTP, SMTP_PORT: '587' }).email).toMatchObject({ smtp: { port: 587, security: 'starttls' } });
    expect(loadConfig({ ...SMTP, SMTP_SECURITY: 'STARTTLS' }).email).toMatchObject({ smtp: { port: 587, security: 'starttls' } });
    expect(loadConfig({ ...SMTP, SMTP_SECURITY: 'tls', SMTP_PORT: '2465' }).email).toMatchObject({ smtp: { port: 2465, security: 'tls' } });
    expect(loadConfig({ ...SMTP, EMAIL_FROM: 'hello@theorbes.com', EMAIL_REPLY_TO: 'clientservices@theorbes.com' }).email).toMatchObject({
      from: { address: 'hello@theorbes.com', name: null },
      replyTo: 'clientservices@theorbes.com',
    });
    // Each missing piece is named; values never appear.
    expect(issues({ EMAIL_TRANSPORT: 'smtp' })).toEqual([
      'SMTP_HOST: required when EMAIL_TRANSPORT=smtp',
      'EMAIL_FROM: required when EMAIL_TRANSPORT=smtp',
      'SMTP_USER: required when EMAIL_TRANSPORT=smtp',
      'SMTP_PASSWORD: required when EMAIL_TRANSPORT=smtp',
    ]);
    expect(issues({ ...SMTP, SMTP_PASSWORD: undefined })).toEqual(['SMTP_PASSWORD: required when EMAIL_TRANSPORT=smtp']);
    expect(issues({ EMAIL_TRANSPORT: 'sendgrid' })).toEqual(['EMAIL_TRANSPORT: must be off or smtp']);
    // Set values are checked even while the channel is off, so a typo shows before the day it is switched on.
    expect(issues({ SMTP_SECURITY: 'ssl' })).toEqual(['SMTP_SECURITY: must be tls or starttls']);
    expect(issues({ SMTP_PORT: '0' }).map((i) => i.split(':')[0])).toEqual(['SMTP_PORT']);
    for (const from of ['ORBES', 'hello@theorbes', 'ORBES <hello@theorbes.com', 'Ünïcode <hello@theorbes.com>', 'a b@theorbes.com', 'hello@theorbes.com\r\nBcc: x@example.com', '"ORBES" <hello@theorbes.com>']) {
      expect(issues({ ...SMTP, EMAIL_FROM: from }).map((i) => i.split(':')[0]), from).toEqual(['EMAIL_FROM']);
    }
    expect(issues({ EMAIL_REPLY_TO: 'Client Services <cs@theorbes.com>' }).map((i) => i.split(':')[0])).toEqual(['EMAIL_REPLY_TO']);
    expect(issues({ SMTP_HOST: 'smtp.example.com/path' }).map((i) => i.split(':')[0])).toEqual(['SMTP_HOST']);
    expect(issues({ ...SMTP, SMTP_PASSWORD: 'line\u0007bell' }).map((i) => i.split(':')[0])).toEqual(['SMTP_PASSWORD']);
    for (const issue of issues({ ...SMTP, SMTP_PASSWORD: 'x\u0007-secret-value', EMAIL_FROM: 'secret-from' })) expect(issue).not.toMatch(/secret-value|secret-from/);
    // The log: the server and its mode; the sender, the user and the password only as [set].
    const c = loadConfig({ ...SMTP, EMAIL_REPLY_TO: 'clientservices@theorbes.com' });
    expect(redactConfig(c).email).toEqual({ transport: 'smtp', host: 'smtp.example.com', port: 465, security: 'tls', from: '[set]', replyTo: '[set]', user: '[set]', password: '[set]' });
    const text = JSON.stringify(redactConfig(c));
    for (const value of ['hello@theorbes.com', 'clientservices@theorbes.com', 'apikey', 'smtp-Secret-0123456789']) expect(text).not.toContain(value);
    expect(redactConfig(loadConfig({})).email).toEqual({ transport: 'off' });
    expect(configWarnings(loadConfig({ ...PROD, ...SMTP }))).toEqual([]);
  });

  it('ADS_* (lot M4, K27 A2 and A5): no platform by default; a platform\'s keys all together, a missing one named; each validated; masked in the log', () => {
    const META = { ADS_META_DATASET_ID: '123456789012345', ADS_META_ACCESS_TOKEN: 'meta-Secret-Token-0123456789' };
    const TIKTOK = { ADS_TIKTOK_PIXEL_CODE: 'CTESTPIXEL0123', ADS_TIKTOK_ACCESS_TOKEN: 'tiktok-Secret-Token-0123456789' };
    const GOOGLE = {
      ADS_GOOGLE_CUSTOMER_ID: '123-456-7890',
      ADS_GOOGLE_DEVELOPER_TOKEN: 'google-Developer-Token-0123',
      ADS_GOOGLE_CLIENT_ID: 'orbes-ads.apps.googleusercontent.com',
      ADS_GOOGLE_CLIENT_SECRET: 'google-Client-Secret-0123',
      ADS_GOOGLE_REFRESH_TOKEN: '1//google-Refresh-Token-0123',
    };
    // None set (or set empty): no platform is ready, in every environment.
    expect(loadConfig({}).ads).toEqual({ meta: null, tiktok: null, google: null });
    expect(loadConfig({ ...PROD, ADS_META_DATASET_ID: '', ADS_META_ACCESS_TOKEN: '  ' }).ads).toEqual({ meta: null, tiktok: null, google: null });
    expect(testConfig().ads).toEqual({ meta: null, tiktok: null, google: null });
    // All of a platform's keys: ready; the Google customer kept as its digits, the login customer optional.
    expect(loadConfig({ ...PROD, ...META, ...TIKTOK, ...GOOGLE }).ads).toEqual({
      meta: { datasetId: '123456789012345', accessToken: 'meta-Secret-Token-0123456789' },
      tiktok: { pixelCode: 'CTESTPIXEL0123', accessToken: 'tiktok-Secret-Token-0123456789' },
      google: {
        customerId: '1234567890',
        loginCustomerId: null,
        developerToken: 'google-Developer-Token-0123',
        clientId: 'orbes-ads.apps.googleusercontent.com',
        clientSecret: 'google-Client-Secret-0123',
        refreshToken: '1//google-Refresh-Token-0123',
      },
    });
    expect(loadConfig({ ...GOOGLE, ADS_GOOGLE_LOGIN_CUSTOMER_ID: '1112223333' }).ads.google).toMatchObject({ loginCustomerId: '1112223333' });
    expect(loadConfig({ ...TIKTOK }).ads).toMatchObject({ meta: null, google: null });
    // Some but not all: refused at start, each missing variable named, never a value.
    expect(issues({ ADS_META_DATASET_ID: '123' })).toEqual(['ADS_META_ACCESS_TOKEN: required when another ADS_META_* key is set (a platform\'s keys go together)']);
    expect(issues({ ADS_META_ACCESS_TOKEN: 'meta-Secret-Token-0123456789' })).toEqual(['ADS_META_DATASET_ID: required when another ADS_META_* key is set (a platform\'s keys go together)']);
    expect(issues({ ...TIKTOK, ADS_TIKTOK_PIXEL_CODE: undefined }).map((i) => i.split(':')[0])).toEqual(['ADS_TIKTOK_PIXEL_CODE']);
    expect(issues({ ...GOOGLE, ADS_GOOGLE_CLIENT_SECRET: undefined, ADS_GOOGLE_REFRESH_TOKEN: undefined }).map((i) => i.split(':')[0])).toEqual(['ADS_GOOGLE_CLIENT_SECRET', 'ADS_GOOGLE_REFRESH_TOKEN']);
    expect(issues({ ADS_GOOGLE_LOGIN_CUSTOMER_ID: '1112223333' }).map((i) => i.split(':')[0])).toEqual([
      'ADS_GOOGLE_CUSTOMER_ID',
      'ADS_GOOGLE_DEVELOPER_TOKEN',
      'ADS_GOOGLE_CLIENT_ID',
      'ADS_GOOGLE_CLIENT_SECRET',
      'ADS_GOOGLE_REFRESH_TOKEN',
    ]);
    expect(issues({ ...PROD, ...META, ADS_TIKTOK_ACCESS_TOKEN: 'x-token' }).map((i) => i.split(':')[0])).toEqual(['ADS_TIKTOK_PIXEL_CODE']);
    // Each value validated, the variable named, never the value.
    for (const [name, bad] of [
      ['ADS_META_DATASET_ID', 'pixel-12'],
      ['ADS_META_ACCESS_TOKEN', 'with space-secret-value'],
      ['ADS_TIKTOK_PIXEL_CODE', 'C-1'],
      ['ADS_GOOGLE_CUSTOMER_ID', '98-765-4321'],
      ['ADS_GOOGLE_LOGIN_CUSTOMER_ID', '12345678901'],
      ['ADS_GOOGLE_REFRESH_TOKEN', `x${'y'.repeat(1_024)}`],
    ] as const) {
      const env = { ...META, ...TIKTOK, ...GOOGLE, [name]: bad };
      const found = issues(env);
      expect(found.map((i) => i.split(':')[0]), name).toEqual([name]);
      expect(found.join(' '), name).not.toContain(bad);
    }
    // The log says which platforms have their keys, never a key nor an id.
    const c = loadConfig({ ...PROD, ...META, ...GOOGLE, ADS_GOOGLE_LOGIN_CUSTOMER_ID: '1112223333' });
    expect(redactConfig(c).ads).toEqual({ meta: '[set]', tiktok: undefined, google: '[set]' });
    const text = JSON.stringify(redactConfig(c));
    for (const value of [...Object.values(META), ...Object.values(GOOGLE), '1234567890', '1112223333']) expect(text).not.toContain(value);
    expect(redactConfig(loadConfig({})).ads).toEqual({ meta: undefined, tiktok: undefined, google: undefined });
    expect(configWarnings(c)).toEqual([]);
  });

  it('genome/.env.example documents the ten ADS_* keys, commented and empty, and where they go', () => {
    const example = readFileSync(join(GENOME, '.env.example'), 'utf8');
    const names = [...example.matchAll(/^# (ADS_[A-Z_]+)=$/gm)].map((m) => m[1]);
    expect(names).toEqual([...ADS_ENV.meta, ...ADS_ENV.tiktok, ...ADS_ENV.google]);
    expect(names).toHaveLength(10);
    expect(example).not.toMatch(/^ADS_/m);
    const prose = example.replace(/\n# /g, ' ');
    expect(prose).toContain("Keys go in the server's .env, never in chat; the deployment that switches conversions on passes them to the app (deploy/vps/compose.yaml) and opens its route out.");
    // config.ts reads every one of them.
    const source = readFileSync(join(GENOME, 'src', 'server', 'config.ts'), 'utf8');
    for (const name of names) expect(source, name).toContain(`e.${name}`);
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

  it('redactConfig masks the Client Services details, saying only which are set', () => {
    const c = loadConfig({ CLIENT_SERVICES_EMAIL: 'clientservices@theorbes.com', CLIENT_SERVICES_PHONE: '+33 1 23 45 67 89' });
    const text = JSON.stringify(redactConfig(c));
    for (const value of ['clientservices@theorbes.com', '+33 1 23 45 67 89']) expect(text).not.toContain(value);
    expect(redactConfig(c).clientServices).toEqual({ email: '[set]', phone: '[set]', hours: undefined });
    expect(redactConfig(loadConfig({})).clientServices).toEqual({ email: undefined, phone: undefined, hours: undefined });
  });
});
