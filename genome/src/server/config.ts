/**
 * Runtime configuration, parsed from the environment once at startup.
 *
 * Fail fast: every problem is collected and reported together in one
 * ConfigError, and the process should refuse to start. Messages name the
 * variable and the rule, never the value (values may be secrets).
 *
 * Development and test get working defaults (in-memory PGlite, memory keys,
 * well-known dev secrets). Production gets none of those and is hardened:
 * see `productionIssues()`.
 */
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { fromBase64Url } from '../core/bytes.js';
import { parseDatabaseUrl, redactDatabaseUrl } from './db/url.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type OrbesEnv = 'development' | 'test' | 'production';

/** Internal anomaly thresholds — NEVER exposed via the API. */
export interface AnomalyConfig {
  suspiciousThreshold: number;
  impossibleTravelKmh: number;
  minTravelKm: number;
  velocityWindowMin: number;
  velocityMaxScans: number;
  velocityMinDevices: number;
  deviceWindowDays: number;
  deviceMax: number;
  geoWindowDays: number;
  geoMaxCountries: number;
  decayDays: number;
}

export interface AppConfig {
  env: OrbesEnv;
  host: string;
  port: number;
  publicOrigin: string;                 // scheme://host[:port], no trailing slash
  databaseUrl: string;                  // postgres://… | pglite:memory | pglite:/abs/path
  cookieSecret: string;                 // ≥ 32 chars
  ipHashPepper: string;                 // ≥ 32 chars, HMAC key for IP / device pseudonymisation
  trustProxy: boolean | string;         // passed to Fastify
  geo: { mode: 'none' | 'cloudflare' | 'headers' | 'mmdb'; countryHeader?: string; latHeader?: string; lonHeader?: string; mmdbPath?: string /* absolute, mmdb mode */ };
  keys: { provider: 'local' | 'memory'; dir?: string; encryptionKey?: string /* base64url 32 bytes, AES-256-GCM */ };
  bootstrapAdmin?: { email: string; password: string };
  anomaly: AnomalyConfig;
  rateLimits: { verifyPerMinute: number; authPerMinute: number; adminPerMinute: number; apiPerMinute: number };
  sessionTtlHours: { account: number; admin: number };
  /** MIGRATE_ON_START: apply pending migrations at startup in production (always done in development/test). */
  migrateOnStart: boolean;
  /** LOG_LEVEL: pino level of the server log. */
  logLevel: LogLevel;
  /** ADMIN_REQUIRE_MFA: admin sessions must have passed TOTP outside the auth routes (default: production only). */
  adminRequireMfa: boolean;
  /**
   * SCAN_RETENTION_DAYS: scan history (scan_events with their authentication_events, scan_tokens and scan_reports)
   * older than this many days is purged by housekeeping. null (unset, the default) keeps it indefinitely;
   * production then logs a warning. Never shorter than the anomaly look-back (scanLookbackDays).
   */
  scanRetentionDays: number | null;
  /**
   * CLIENT_SERVICES_EMAIL / _PHONE / _HOURS: how ORBES Client Services is reached, served publicly by
   * GET /api/v1/client-services for the contact of non-authentic results. Each is optional; with neither
   * an email nor a phone set (the default), the verification app shows no contact at all.
   */
  clientServices: ClientServicesConfig;
  /**
   * CARE_SUBSCRIBE_URL (P-M02): where SUBSCRIBE of ORBES Care leads, in a new tab, from the CARE tab of MY PIECES (the
   * subscription page of Whop, later). Optional, https only, served publicly by GET /api/v1/client-services
   * (`careSubscribeUrl`). null (unset, the default): the tab reads "Subscriptions open soon", with nothing to press.
   */
  careSubscribeUrl: string | null;
  /**
   * TRANSFER_ACCEPT_REQUIRE_PRODUCT (default true, F-03): an acceptance of a transfer must name the piece the
   * recipient scanned (`productId`, refused with 409 TRANSFER_PRODUCT_MISMATCH when the code is another piece's)
   * and carry the TRANSFER_ACCEPT token of that scan. false makes both optional, for an acceptance assisted by
   * ORBES Client Services; whichever is sent is still checked. It acts on the API only: the verify app still asks
   * for a signed-in scan of the piece. Production warns while it is false.
   */
  transferAcceptRequireProduct: boolean;
}

/** Public contact details of ORBES Client Services (all optional, validated at start). */
export interface ClientServicesConfig {
  /** A mailbox safe to put in a mailto: link as it is. */
  email?: string;
  /** International format, e.g. "+33 1 23 45 67 89" (digits, spaces, dots or hyphens after the +). */
  phone?: string;
  /** Opening hours as the brand writes them, one line of plain text. */
  hours?: string;
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
  }
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_ANOMALY_CONFIG: Readonly<AnomalyConfig> = Object.freeze({
  suspiciousThreshold: 60,
  impossibleTravelKmh: 900,
  minTravelKm: 500,
  velocityWindowMin: 60,
  velocityMaxScans: 20,
  velocityMinDevices: 5,
  deviceWindowDays: 7,
  deviceMax: 12,
  geoWindowDays: 7,
  geoMaxCountries: 3,
  decayDays: 30,
});

/** env var → AnomalyConfig key, with the accepted range. */
const ANOMALY_ENV: Record<string, { key: keyof AnomalyConfig; int: boolean; min: number; max: number }> = {
  ANOMALY_SUSPICIOUS_THRESHOLD: { key: 'suspiciousThreshold', int: true, min: 1, max: 100 },
  ANOMALY_IMPOSSIBLE_TRAVEL_KMH: { key: 'impossibleTravelKmh', int: false, min: 1, max: 100_000 },
  ANOMALY_MIN_TRAVEL_KM: { key: 'minTravelKm', int: false, min: 0, max: 40_075 },
  ANOMALY_VELOCITY_WINDOW_MIN: { key: 'velocityWindowMin', int: true, min: 1, max: 10_080 },
  ANOMALY_VELOCITY_MAX_SCANS: { key: 'velocityMaxScans', int: true, min: 1, max: 1_000_000 },
  ANOMALY_VELOCITY_MIN_DEVICES: { key: 'velocityMinDevices', int: true, min: 1, max: 1_000_000 },
  ANOMALY_DEVICE_WINDOW_DAYS: { key: 'deviceWindowDays', int: true, min: 1, max: 3_650 },
  ANOMALY_DEVICE_MAX: { key: 'deviceMax', int: true, min: 1, max: 1_000_000 },
  ANOMALY_GEO_WINDOW_DAYS: { key: 'geoWindowDays', int: true, min: 1, max: 3_650 },
  ANOMALY_GEO_MAX_COUNTRIES: { key: 'geoMaxCountries', int: true, min: 1, max: 250 },
  ANOMALY_DECAY_DAYS: { key: 'decayDays', int: false, min: 0.001, max: 3_650 },
};

const RATE_LIMIT_ENV = {
  RATE_LIMIT_VERIFY_PER_MINUTE: 'verifyPerMinute',
  RATE_LIMIT_AUTH_PER_MINUTE: 'authPerMinute',
  RATE_LIMIT_ADMIN_PER_MINUTE: 'adminPerMinute',
  RATE_LIMIT_API_PER_MINUTE: 'apiPerMinute',
} as const;

const DEFAULT_RATE_LIMITS = { verifyPerMinute: 60, authPerMinute: 10, adminPerMinute: 300, apiPerMinute: 120 };
// Tests issue many requests in a burst; rate-limit tests override these explicitly.
const TEST_RATE_LIMITS = { verifyPerMinute: 10_000, authPerMinute: 10_000, adminPerMinute: 10_000, apiPerMinute: 10_000 };

const DEFAULT_LOG_LEVEL: Readonly<Record<OrbesEnv, LogLevel>> = { production: 'info', test: 'warn', development: 'debug' };

/** Absolute session lifetimes without SESSION_TTL_*_HOURS: 30 days for a customer, 8 hours in the console (docs/legal/TERMS-FACTS.md). */
export const DEFAULT_SESSION_TTL_HOURS = Object.freeze({ account: 720, admin: 8 });

/** SCAN_RETENTION_DAYS bounds (whole days). */
export const SCAN_RETENTION_LIMITS = Object.freeze({ min: 30, max: 3_650 });

/**
 * Longest stretch of scan history (whole days) that anomaly scoring reads: the device and geography
 * windows, the velocity window and the decay period. A retention period below it would erase evidence
 * the scorer still uses.
 */
export function scanLookbackDays(a: AnomalyConfig): number {
  return Math.ceil(Math.max(a.deviceWindowDays, a.geoWindowDays, a.decayDays, a.velocityWindowMin / 1_440));
}

// Well-known non-production secrets. Production refuses them by value.
const DEV_COOKIE_SECRET = 'orbes-dev-cookie-secret-not-for-production-use-0001';
const DEV_IP_HASH_PEPPER = 'orbes-dev-ip-hash-pepper-not-for-production-use-0001';
const KNOWN_DEV_SECRETS = new Set([DEV_COOKIE_SECRET, DEV_IP_HASH_PEPPER]);

const MIN_SECRET_LENGTH = 32;
// Cheap guard against placeholders like 'xxxxxxxx…' or 'changeme' repeated.
const MIN_SECRET_DISTINCT_CHARS = 10;

// ── Field schemas ──────────────────────────────────────────────────────────

const zPort = z.coerce.number().int().min(1).max(65_535);
const zHost = z.string().min(1).max(255).regex(/^[A-Za-z0-9.:_\-[\]]+$/, 'must be a hostname or IP address');
const zHeaderName = z
  .string()
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/, 'must be a valid HTTP header name')
  .transform((s) => s.toLowerCase());
/** Boolean switches: 1/true/yes and 0/false/no (any case). */
const zSwitch = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(['1', 'true', 'yes', '0', 'false', 'no'], { error: 'must be true or false' }))
  .transform((s) => s === '1' || s === 'true' || s === 'yes');
const zEmail = z
  .string()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email address');
/** A public mailbox for a mailto: link: none of the characters URL syntax gives a meaning (? & # % / :). */
const zMailbox = z
  .string()
  .max(254)
  .regex(/^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/, 'must be an email address (letters, digits and . _ + - only)');
/** An international number (E.164 digits, at most 15), with optional single spaces, dots or hyphens between digits. */
const zPhone = z
  .string()
  .max(32)
  .regex(/^\+[1-9](?:[ .-]?[0-9]){6,14}$/, 'must be an international number such as +33 1 23 45 67 89');
/** One line of plain text. */
const zHours = z
  .string()
  .max(120, 'must be at most 120 characters')
  .regex(/^[^\p{Cc}]+$/u, 'must be one line of plain text');
/** A public https link, opened as it is in a new tab: no credentials, no space, at most 2 048 characters. */
const zHttpsLink = z
  .string()
  .max(2_048, 'must be at most 2048 characters')
  .regex(/^[^\s\p{Cc}]+$/u, 'must be a URL without spaces')
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '';
    } catch {
      return false;
    }
  }, 'must be an https:// URL without credentials');

// ── loadConfig ─────────────────────────────────────────────────────────────

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const issues: string[] = [];
  const e = normaliseEnv(env);

  const field = <T>(name: string, schema: z.ZodType<T>, value: string | undefined): T | undefined => {
    if (value === undefined) return undefined;
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    issues.push(`${name}: ${r.error.issues.map((i) => i.message).join('; ')}`);
    return undefined;
  };

  // Environment. NODE_ENV=production without ORBES_ENV fails safe into production rules.
  let orbesEnv: OrbesEnv = 'development';
  if (e.ORBES_ENV !== undefined) {
    const r = z.enum(['development', 'test', 'production']).safeParse(e.ORBES_ENV);
    if (r.success) orbesEnv = r.data;
    else issues.push('ORBES_ENV: must be one of development, test, production');
  } else if (e.NODE_ENV === 'production') {
    orbesEnv = 'production';
  }
  const prod = orbesEnv === 'production';

  const host = field('HOST', zHost, e.HOST) ?? (prod ? '0.0.0.0' : '127.0.0.1');
  const port = field('PORT', zPort, e.PORT) ?? 8080;

  // Public origin.
  let publicOrigin: string | undefined;
  if (e.PUBLIC_ORIGIN !== undefined) {
    const r = parseOrigin(e.PUBLIC_ORIGIN);
    if (typeof r === 'string') publicOrigin = r;
    else issues.push(`PUBLIC_ORIGIN: ${r.error}`);
  } else if (prod) {
    issues.push('PUBLIC_ORIGIN: required in production');
  } else {
    publicOrigin = `http://localhost:${port}`;
  }

  // Database.
  let databaseUrl: string | undefined;
  if (e.DATABASE_URL !== undefined) {
    try {
      parseDatabaseUrl(e.DATABASE_URL);
      databaseUrl = e.DATABASE_URL;
    } catch (err) {
      issues.push(`DATABASE_URL: ${(err as Error).message}`);
    }
  } else if (prod) {
    issues.push('DATABASE_URL: required in production');
  } else {
    databaseUrl = 'pglite:memory';
  }

  // Secrets.
  const secret = (name: string, value: string | undefined, devDefault: string): string | undefined => {
    if (value === undefined) {
      if (prod) {
        issues.push(`${name}: required in production`);
        return undefined;
      }
      return devDefault;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      issues.push(`${name}: must be at least ${MIN_SECRET_LENGTH} characters`);
      return undefined;
    }
    return value;
  };
  const cookieSecret = secret('COOKIE_SECRET', e.COOKIE_SECRET, DEV_COOKIE_SECRET);
  const ipHashPepper = secret('IP_HASH_PEPPER', e.IP_HASH_PEPPER, DEV_IP_HASH_PEPPER);

  // Proxy trust.
  const trustProxy = parseTrustProxy(e.TRUST_PROXY, issues);

  // Geo.
  const geoMode = field('GEO_MODE', z.enum(['none', 'cloudflare', 'headers', 'mmdb']), e.GEO_MODE) ?? 'none';
  const geo: AppConfig['geo'] = { mode: geoMode };
  const countryHeader = field('GEO_COUNTRY_HEADER', zHeaderName, e.GEO_COUNTRY_HEADER);
  const latHeader = field('GEO_LAT_HEADER', zHeaderName, e.GEO_LAT_HEADER);
  const lonHeader = field('GEO_LON_HEADER', zHeaderName, e.GEO_LON_HEADER);
  if (geoMode === 'headers') {
    if (countryHeader === undefined && e.GEO_COUNTRY_HEADER === undefined) {
      issues.push('GEO_COUNTRY_HEADER: required when GEO_MODE=headers');
    }
    if ((latHeader === undefined) !== (lonHeader === undefined)) {
      issues.push('GEO_LAT_HEADER / GEO_LON_HEADER: set both or neither');
    }
    if (countryHeader) geo.countryHeader = countryHeader;
    if (latHeader) geo.latHeader = latHeader;
    if (lonHeader) geo.lonHeader = lonHeader;
  }
  // mmdb: local GeoIP database file. Its existence is NOT checked here: a missing file degrades to no geo.
  if (geoMode === 'mmdb') {
    const p = e.GEO_MMDB_PATH;
    if (p === undefined) issues.push('GEO_MMDB_PATH: required when GEO_MODE=mmdb');
    else if (!isAbsolute(p) || p.length > 4096 || p.includes('\0')) issues.push('GEO_MMDB_PATH: must be an absolute path');
    else geo.mmdbPath = p;
  }

  // Keys.
  const keyProvider = field('KEY_PROVIDER', z.enum(['local', 'memory']), e.KEY_PROVIDER) ?? (prod ? 'local' : 'memory');
  const keys: AppConfig['keys'] = { provider: keyProvider };
  if (keyProvider === 'local') {
    if (e.KEY_DIR === undefined) issues.push('KEY_DIR: required when KEY_PROVIDER=local');
    else if (!isAbsolute(e.KEY_DIR)) issues.push('KEY_DIR: must be an absolute path');
    else keys.dir = e.KEY_DIR;

    if (e.KEY_ENCRYPTION_KEY === undefined) {
      issues.push('KEY_ENCRYPTION_KEY: required when KEY_PROVIDER=local');
    } else {
      const k = decodeKey32(e.KEY_ENCRYPTION_KEY);
      if (k === undefined) issues.push('KEY_ENCRYPTION_KEY: must be base64url (no padding) encoding exactly 32 bytes');
      else if (prod && isDegenerateKey(k)) issues.push('KEY_ENCRYPTION_KEY: refused (all bytes identical)');
      else keys.encryptionKey = e.KEY_ENCRYPTION_KEY;
    }
  }

  // Bootstrap admin (first run only).
  let bootstrapAdmin: AppConfig['bootstrapAdmin'];
  const bEmail = e.BOOTSTRAP_ADMIN_EMAIL;
  const bPassword = e.BOOTSTRAP_ADMIN_PASSWORD;
  if ((bEmail === undefined) !== (bPassword === undefined)) {
    issues.push('BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD: set both or neither');
  } else if (bEmail !== undefined && bPassword !== undefined) {
    const email = field('BOOTSTRAP_ADMIN_EMAIL', zEmail, bEmail);
    // Same minimum as AuthService (contract §2.9); upper bound caps scrypt input size.
    let passwordOk = true;
    if (bPassword.length < 12 || bPassword.length > 1024) {
      issues.push('BOOTSTRAP_ADMIN_PASSWORD: must be 12..1024 characters');
      passwordOk = false;
    }
    if (email !== undefined && passwordOk) bootstrapAdmin = { email, password: bPassword };
  }

  // Anomaly overrides. Unknown ANOMALY_* names are errors: a typo would silently keep a default.
  const anomaly: AnomalyConfig = { ...DEFAULT_ANOMALY_CONFIG };
  for (const name of Object.keys(e)) {
    if (!name.startsWith('ANOMALY_')) continue;
    const spec = ANOMALY_ENV[name];
    if (!spec) {
      issues.push(`${name}: unknown anomaly setting`);
      continue;
    }
    const base = spec.int ? z.coerce.number().int() : z.coerce.number();
    const v = field(name, base.min(spec.min).max(spec.max), e[name]);
    if (v !== undefined) anomaly[spec.key] = v;
  }

  // Rate limits.
  const rateLimits = { ...(orbesEnv === 'test' ? TEST_RATE_LIMITS : DEFAULT_RATE_LIMITS) };
  for (const name of Object.keys(e)) {
    if (!name.startsWith('RATE_LIMIT_')) continue;
    if (!(name in RATE_LIMIT_ENV)) {
      issues.push(`${name}: unknown rate limit setting`);
      continue;
    }
    const key = RATE_LIMIT_ENV[name as keyof typeof RATE_LIMIT_ENV];
    const v = field(name, z.coerce.number().int().min(1).max(1_000_000), e[name]);
    if (v !== undefined) rateLimits[key] = v;
  }

  const sessionTtlHours = {
    account:
      field('SESSION_TTL_ACCOUNT_HOURS', z.coerce.number().int().min(1).max(8_760), e.SESSION_TTL_ACCOUNT_HOURS) ??
      DEFAULT_SESSION_TTL_HOURS.account,
    admin:
      field('SESSION_TTL_ADMIN_HOURS', z.coerce.number().int().min(1).max(168), e.SESSION_TTL_ADMIN_HOURS) ??
      DEFAULT_SESSION_TTL_HOURS.admin,
  };

  // Operations.
  const migrateOnStart = field('MIGRATE_ON_START', zSwitch, e.MIGRATE_ON_START) ?? false;
  const logLevel =
    field('LOG_LEVEL', z.string().transform((s) => s.toLowerCase()).pipe(z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })), e.LOG_LEVEL) ??
    DEFAULT_LOG_LEVEL[orbesEnv];
  const adminRequireMfa = field('ADMIN_REQUIRE_MFA', zSwitch, e.ADMIN_REQUIRE_MFA) ?? prod;

  // Scan-history retention (period agreed with counsel; unset keeps everything).
  const scanRetentionDays =
    field(
      'SCAN_RETENTION_DAYS',
      z.string().regex(/^\d+$/, 'must be a whole number of days').transform(Number).pipe(z.number().int().min(SCAN_RETENTION_LIMITS.min).max(SCAN_RETENTION_LIMITS.max)),
      e.SCAN_RETENTION_DAYS,
    ) ?? null;
  if (scanRetentionDays !== null && scanRetentionDays < scanLookbackDays(anomaly)) {
    issues.push(`SCAN_RETENTION_DAYS: must be at least the anomaly look-back of ${scanLookbackDays(anomaly)} days (longest ANOMALY_*_WINDOW / ANOMALY_DECAY_DAYS)`);
  }

  // ORBES Client Services contact (public; supplied by the brand). Hours alone would offer no way to reach anyone.
  const clientServices: ClientServicesConfig = {};
  const csEmail = field('CLIENT_SERVICES_EMAIL', zMailbox, e.CLIENT_SERVICES_EMAIL);
  const csPhone = field('CLIENT_SERVICES_PHONE', zPhone, e.CLIENT_SERVICES_PHONE);
  const csHours = field('CLIENT_SERVICES_HOURS', zHours, e.CLIENT_SERVICES_HOURS);
  if (csEmail !== undefined) clientServices.email = csEmail;
  if (csPhone !== undefined) clientServices.phone = csPhone;
  if (csHours !== undefined) {
    if (e.CLIENT_SERVICES_EMAIL === undefined && e.CLIENT_SERVICES_PHONE === undefined) {
      issues.push('CLIENT_SERVICES_HOURS: set it together with CLIENT_SERVICES_EMAIL or CLIENT_SERVICES_PHONE');
    } else {
      clientServices.hours = csHours;
    }
  }

  // ORBES Care (P-M02): the subscription page SUBSCRIBE opens; unset, the CARE tab says subscriptions open soon.
  const careSubscribeUrl = field('CARE_SUBSCRIBE_URL', zHttpsLink, e.CARE_SUBSCRIBE_URL) ?? null;

  // Transfers (F-03): the scanned piece and its scan, required unless ORBES Client Services assists an acceptance.
  const transferAcceptRequireProduct = field('TRANSFER_ACCEPT_REQUIRE_PRODUCT', zSwitch, e.TRANSFER_ACCEPT_REQUIRE_PRODUCT) ?? true;

  if (issues.length > 0) throw new ConfigError(issues);

  const config: AppConfig = {
    env: orbesEnv,
    host,
    port,
    publicOrigin: publicOrigin!,
    databaseUrl: databaseUrl!,
    cookieSecret: cookieSecret!,
    ipHashPepper: ipHashPepper!,
    trustProxy,
    geo,
    keys,
    ...(bootstrapAdmin ? { bootstrapAdmin } : {}),
    anomaly,
    rateLimits,
    sessionTtlHours,
    migrateOnStart,
    logLevel,
    adminRequireMfa,
    scanRetentionDays,
    clientServices,
    careSubscribeUrl,
    transferAcceptRequireProduct,
  };

  if (prod) {
    const prodIssues = productionIssues(config);
    if (prodIssues.length > 0) throw new ConfigError(prodIssues);
  }
  return deepFreeze(config);
}

/**
 * Production hardening (contract §0) plus two defence-in-depth rules:
 * distinct cookie/pepper secrets, and header-based geo only behind a trusted proxy
 * (otherwise any client could forge its location).
 */
export function productionIssues(c: AppConfig): string[] {
  const issues: string[] = [];
  try {
    if (parseDatabaseUrl(c.databaseUrl).kind === 'pglite') issues.push('DATABASE_URL: pglite is refused in production');
  } catch {
    issues.push('DATABASE_URL: invalid');
  }
  if (c.keys.provider === 'memory') issues.push('KEY_PROVIDER: memory is refused in production');
  for (const [name, value] of [
    ['COOKIE_SECRET', c.cookieSecret],
    ['IP_HASH_PEPPER', c.ipHashPepper],
  ] as const) {
    if (KNOWN_DEV_SECRETS.has(value)) issues.push(`${name}: the development default is refused in production`);
    else if (value.length < MIN_SECRET_LENGTH) issues.push(`${name}: must be at least ${MIN_SECRET_LENGTH} characters`);
    else if (new Set(value).size < MIN_SECRET_DISTINCT_CHARS) issues.push(`${name}: too little variety, use a random value`);
  }
  if (c.cookieSecret === c.ipHashPepper) issues.push('COOKIE_SECRET / IP_HASH_PEPPER: must be different secrets');
  if (!c.publicOrigin.startsWith('https://')) issues.push('PUBLIC_ORIGIN: must be https:// in production');
  if (c.geo.mode === 'headers' && c.trustProxy === false) {
    issues.push('GEO_MODE: headers mode requires TRUST_PROXY in production');
  }
  // Behind Cloudflare without proxy trust, every client shares the edge's IP (one rate-limit
  // bucket for everybody), and a cf-* header reaching the app directly is client-forged.
  if (c.geo.mode === 'cloudflare' && c.trustProxy === false) {
    issues.push('GEO_MODE: cloudflare mode requires TRUST_PROXY in production');
  }
  // Production always sits behind a TLS proxy (https:// is required): without proxy trust the client IP is
  // the proxy's own private address, so every mmdb lookup would silently find nothing.
  if (c.geo.mode === 'mmdb' && c.trustProxy === false) {
    issues.push('GEO_MODE: mmdb mode requires TRUST_PROXY in production');
  }
  // `true` makes the LEFT-most X-Forwarded-For entry the client IP. Proxies append, so that entry is
  // whatever the client sent: rate limits (login, claim and transfer codes) and IP pseudonyms become forgeable.
  if (c.trustProxy === true) {
    issues.push('TRUST_PROXY: "true" trusts every X-Forwarded-For hop (client-forgeable); list the proxy addresses or ranges instead');
  }
  return issues;
}

/**
 * Accepted but risky settings, logged as warnings at startup (never values).
 * ADMIN_REQUIRE_MFA=false in production lets a stolen admin password alone
 * reach every console action: it is allowed for a first-run enrolment window,
 * not as a steady state. An unset SCAN_RETENTION_DAYS in production keeps
 * pseudonymous scan history without limit (the period is a legal decision,
 * so it has no default). TRANSFER_ACCEPT_REQUIRE_PRODUCT=false in production
 * lets a transfer code complete without a scan of its piece (F-03): allowed
 * while ORBES Client Services assists an acceptance, not as a steady state.
 */
export function configWarnings(c: AppConfig): string[] {
  const warnings: string[] = [];
  if (c.env === 'production' && !c.adminRequireMfa) {
    warnings.push('ADMIN_REQUIRE_MFA: disabled in production; admin sessions without TOTP can use the whole console (enrol every admin, then remove the override)');
  }
  if (c.env === 'production' && c.scanRetentionDays === null) {
    warnings.push('SCAN_RETENTION_DAYS: not set in production; pseudonymous scan history is kept indefinitely (set the retention period agreed with counsel, at least 30 days)');
  }
  if (c.env === 'production' && !c.transferAcceptRequireProduct) {
    warnings.push('TRANSFER_ACCEPT_REQUIRE_PRODUCT: disabled in production; the API accepts the code of any pending transfer without a scan of its piece (the verify app still asks for one: keep it only for an acceptance assisted by ORBES Client Services, then remove the override)');
  }
  return warnings;
}

// ── Test helper ────────────────────────────────────────────────────────────

export type ConfigOverrides = Partial<Omit<AppConfig, 'geo' | 'keys' | 'anomaly' | 'rateLimits' | 'sessionTtlHours'>> & {
  geo?: Partial<AppConfig['geo']>;
  keys?: Partial<AppConfig['keys']>;
  anomaly?: Partial<AnomalyConfig>;
  rateLimits?: Partial<AppConfig['rateLimits']>;
  sessionTtlHours?: Partial<AppConfig['sessionTtlHours']>;
};

/**
 * A valid `test` config (in-memory PGlite, memory keys) with overrides merged
 * one level deep. Overrides are not re-validated, so tests can probe edge values.
 */
export function testConfig(overrides: ConfigOverrides = {}): AppConfig {
  const base = loadConfig({ ORBES_ENV: 'test' });
  const merged: AppConfig = {
    ...base,
    // A test config for another environment gets that environment's MFA default, like loadConfig.
    adminRequireMfa: overrides.env === 'production',
    ...overrides,
    geo: { ...base.geo, ...overrides.geo },
    keys: { ...base.keys, ...overrides.keys },
    anomaly: { ...base.anomaly, ...overrides.anomaly },
    rateLimits: { ...base.rateLimits, ...overrides.rateLimits },
    sessionTtlHours: { ...base.sessionTtlHours, ...overrides.sessionTtlHours },
  };
  return deepFreeze(merged);
}

// ── Logging ────────────────────────────────────────────────────────────────

/** A summary safe to log at startup: no secrets, no anomaly thresholds. */
export function redactConfig(c: AppConfig): Record<string, unknown> {
  return {
    env: c.env,
    host: c.host,
    port: c.port,
    publicOrigin: c.publicOrigin,
    database: redactDatabaseUrl(c.databaseUrl),
    trustProxy: c.trustProxy,
    geo: c.geo,
    keys: { provider: c.keys.provider, dir: c.keys.dir, encryptionKey: c.keys.encryptionKey ? '[set]' : undefined },
    bootstrapAdmin: c.bootstrapAdmin ? '[set]' : undefined,
    rateLimits: c.rateLimits,
    sessionTtlHours: c.sessionTtlHours,
    migrateOnStart: c.migrateOnStart,
    logLevel: c.logLevel,
    adminRequireMfa: c.adminRequireMfa,
    scanRetentionDays: c.scanRetentionDays,
    // Public once served, but kept out of the log like any value an operator types.
    clientServices: {
      email: c.clientServices.email ? '[set]' : undefined,
      phone: c.clientServices.phone ? '[set]' : undefined,
      hours: c.clientServices.hours ? '[set]' : undefined,
    },
    careSubscribeUrl: c.careSubscribeUrl ? '[set]' : undefined,
    transferAcceptRequireProduct: c.transferAcceptRequireProduct,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Trim values and drop empty ones, so `FOO=` behaves like an unset variable. */
function normaliseEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t !== '') out[k] = t;
  }
  return out;
}

function parseOrigin(s: string): string | { error: string } {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: 'must be an absolute URL origin such as https://verify.theorbes.com' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'must use http or https' };
  if (u.username || u.password) return { error: 'must not contain credentials' };
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || s.endsWith('/')) {
    return { error: 'must be an origin only (no path, query, fragment or trailing slash)' };
  }
  return u.origin;
}

/**
 * 'true'/'yes' and 'false'/'no'/'0' become booleans; anything else is handed to Fastify verbatim
 * (IPs/CIDRs/'loopback'/'uniquelocal'). A positive number is refused: operators write it meaning
 * "one proxy hop", but it used to mean "trust everything" here, and this Fastify version treats a
 * number as "trust nothing" — neither is what was asked for.
 */
function parseTrustProxy(v: string | undefined, issues: string[]): boolean | string {
  if (v === undefined) return false;
  const l = v.toLowerCase();
  if (l === 'true' || l === 'yes') return true;
  if (l === 'false' || l === 'no' || l === '0') return false;
  if (/^\d+$/.test(l)) {
    issues.push('TRUST_PROXY: hop counts are not supported; list the proxy addresses or ranges (e.g. loopback, uniquelocal, 10.0.0.0/8)');
    return false;
  }
  return v;
}

function decodeKey32(s: string): Uint8Array | undefined {
  try {
    const b = fromBase64Url(s);
    return b.length === 32 ? b : undefined;
  } catch {
    return undefined;
  }
}

function isDegenerateKey(k: Uint8Array): boolean {
  return k.every((b) => b === k[0]);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
