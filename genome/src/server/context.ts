/**
 * Application context (contract §0): the one place where the database, the
 * key custody provider and every service are constructed and wired together.
 *
 * All services share ONE clock (tests move time through it; the claim-code
 * limit, sessions and scan tokens must agree on "now") and one logger.
 *
 * Startup, in order:
 *   1. database (created from DATABASE_URL unless one is injected);
 *   2. migrations: applied automatically in development/test or when asked
 *      explicitly (`migrate: true`); otherwise production refuses to start on
 *      a schema with pending migrations instead of failing on first use;
 *   3. category cache load (the core identity resolver is synchronous);
 *   4. services;
 *   5. first-run admin bootstrap (BOOTSTRAP_ADMIN_*), and the signing key:
 *      created on demand in development/test, self-tested in production.
 */
import { closeDb, createDb, type Db } from './db/connection.js';
import { migrateToLatest, migrationStatus } from './db/migrate.js';
import type { AppConfig } from './config.js';
import { GeoResolver } from './geo/resolver.js';
import { createKeyProvider, KeyService, type KeyProvider } from './keys/index.js';
import { AuthenticatorRegistry } from './authenticators/index.js';
import { AccountRecoveryService } from './services/account-recovery.js';
import { AnomalyService } from './services/anomaly.js';
import { AuditService } from './services/audit.js';
import { AuthService, deriveTotpEncryptionKey } from './services/auth.js';
import { CatalogService } from './services/catalog.js';
import { CategoryRegistry } from './services/categories.js';
import { CertificateService } from './services/certificates.js';
import { IssuanceService } from './services/issuance.js';
import { LifecycleService } from './services/lifecycle.js';
import { deriveTransferCodeKey, OwnershipService } from './services/ownership.js';
import { ScanReportService } from './services/scan-reports.js';
import { purgeScanHistory } from './services/scan-retention.js';
import { purgeScanTokens } from './services/scan-tokens.js';
import { SessionService } from './services/sessions.js';
import { VerificationService } from './services/verification.js';
import { WarrantyService } from './services/warranty.js';
import { noopLogger, SYSTEM_ACTOR, systemClock, type Clock, type Logger } from './types.js';

export interface AppServices {
  issuance: IssuanceService;
  verification: VerificationService;
  anomaly: AnomalyService;
  lifecycle: LifecycleService;
  ownership: OwnershipService;
  warranty: WarrantyService;
  auth: AuthService;
  authenticators: AuthenticatorRegistry;
  /** Collections and models (categories: `AppContext.categories`). */
  catalog: CatalogService;
  /** Certificate cards carrying claim codes (PDF, A4 sheet, CSV for print shops). */
  certificates: CertificateService;
  /** Customers' reports on scans that were not authentic, and the console's Cases queue. */
  reports: ScanReportService;
  /** Assisted recovery of a customer account: one-time codes issued by ORBES Client Services. */
  recovery: AccountRecoveryService;
}

export interface AppContext {
  config: AppConfig;
  db: Db;
  /** Injectable time source shared by every service. */
  clock: Clock;
  log: Logger;
  categories: CategoryRegistry;
  keys: KeyService;
  audit: AuditService;
  geo: GeoResolver;
  /** Session tokens (used by AuthService and the HTTP layer's cookie guard). */
  sessions: SessionService;
  services: AppServices;
  /** Release what the context owns (the database, unless it was injected). Idempotent. */
  close(): Promise<void>;
}

export interface ContextOverrides {
  /** Use this database instead of opening DATABASE_URL. The caller keeps ownership (close() leaves it open). */
  db?: Db;
  clock?: Clock;
  log?: Logger;
  /** Key custody provider (default: built from config.keys). */
  keyProvider?: KeyProvider;
  geo?: GeoResolver;
  /** Apply pending migrations at startup. Default: true in development/test, false in production. */
  migrate?: boolean;
  /** Create the BOOTSTRAP_ADMIN_* admin on first start (default true). */
  bootstrapAdmin?: boolean;
  /** Create a signing key when none is ACTIVE. Default: true in development/test, false in production. */
  ensureActiveKey?: boolean;
  /** Replace individual services (tests). */
  services?: Partial<AppServices>;
}

export async function createContext(config: AppConfig, overrides: ContextOverrides = {}): Promise<AppContext> {
  const log = overrides.log ?? noopLogger;
  const clock = overrides.clock ?? systemClock;
  const ownsDb = overrides.db === undefined;
  const db = overrides.db ?? createDb(config.databaseUrl, { log });
  const production = config.env === 'production';

  try {
    // ── Schema ─────────────────────────────────────────────────────────────
    if (overrides.migrate ?? !production) {
      const { applied } = await migrateToLatest(db);
      if (applied.length > 0) log.info({ applied }, 'database migrations applied');
    } else {
      const pending = (await migrationStatus(db)).filter((m) => m.executedAt === undefined).map((m) => m.name);
      if (pending.length > 0) {
        throw new Error(`database schema is not up to date (pending: ${pending.join(', ')}); run the migrations first`);
      }
    }

    // ── Services ───────────────────────────────────────────────────────────
    const audit = new AuditService({ db, clock });
    const categories = new CategoryRegistry({ db, audit, clock });
    await categories.load();

    const provider = overrides.keyProvider ?? (await createKeyProvider(config, log));
    const keys = new KeyService({ db, provider, audit, clock, log });
    const geo = overrides.geo ?? new GeoResolver(config.geo, { log, clock });
    const sessions = new SessionService({ db, clock, ttlHours: config.sessionTtlHours });

    const auth = new AuthService({ db, audit, sessions, totpKey: deriveTotpEncryptionKey(config), clock });
    const lifecycle = new LifecycleService({ db, audit, clock });
    const ownership = new OwnershipService({ db, audit, lifecycle, clock, transferKey: deriveTransferCodeKey(config) });
    const warranty = new WarrantyService({ db, audit, lifecycle, clock });
    const issuance = new IssuanceService({ db, keys, audit, categories, clock, log });
    const catalog = new CatalogService({ db, audit, categories, clock });
    const certificates = new CertificateService({ db, audit, clock });
    const anomaly = new AnomalyService({ db, config: config.anomaly, audit, clock, log });
    const reports = new ScanReportService({ db, audit, clock, log });
    const recovery = new AccountRecoveryService({ db, audit, sessions, ownership, clock });
    const authenticators = AuthenticatorRegistry.withDefaults();
    const verification = new VerificationService({ db, keys, anomaly, config, authenticators, clock, log });

    const services: AppServices = {
      issuance,
      verification,
      anomaly,
      lifecycle,
      ownership,
      warranty,
      auth,
      authenticators,
      catalog,
      certificates,
      reports,
      recovery,
      ...overrides.services,
    };

    let closed = false;
    const ctx: AppContext = {
      config,
      db,
      clock,
      log,
      categories,
      keys,
      audit,
      geo,
      sessions,
      services,
      async close() {
        if (closed) return;
        closed = true;
        if (ownsDb) await closeDb(db);
      },
    };

    // ── First run ──────────────────────────────────────────────────────────
    if (overrides.bootstrapAdmin ?? true) {
      const r = await services.auth.bootstrapAdmin(config);
      if (r.created) log.info({ adminId: r.adminId }, 'bootstrap admin created');
    }
    if (overrides.ensureActiveKey ?? !production) {
      const k = await keys.ensureActiveKey(SYSTEM_ACTOR);
      log.info({ keyId: k.keyId, kid: k.kid, provider: k.provider }, 'signing key ready');
    } else if (!(await keys.selfTest())) {
      // Verification keeps working (it only needs public keys); issuance does not.
      log.error({}, 'signing key self-test failed or no ACTIVE key: issuance is unavailable until a key is rotated in');
    }
    return ctx;
  } catch (e) {
    if (ownsDb) await closeDb(db).catch(() => {});
    throw e;
  }
}

// ── Housekeeping ───────────────────────────────────────────────────────────

export interface Housekeeping {
  /** Run every job once now (also what the timer does). Errors are logged, never thrown. */
  runOnce(): Promise<{ sessions: number; transfers: number; scanTokens: number; scanHistory: number }>;
  /** Stop the timer and wait for a running pass to finish. */
  stop(): Promise<void>;
}

/**
 * Purges expired sessions and scan tokens, expires stale transfers and, when
 * SCAN_RETENTION_DAYS is set, purges scan history older than the retention
 * period, every `intervalMs` (default 10 min).
 */
export function startHousekeeping(
  ctx: AppContext,
  opts: { intervalMs?: number; scanTokenGraceMs?: number; scanHistoryBatchSize?: number } = {},
): Housekeeping {
  const intervalMs = opts.intervalMs ?? 10 * 60_000;
  // Keep expired scan tokens a while so "expired" (410) stays distinguishable from "unknown" (400).
  const graceMs = opts.scanTokenGraceMs ?? 24 * 60 * 60_000;
  let running: Promise<unknown> | undefined;

  const runOnce = async () => {
    const result = { sessions: 0, transfers: 0, scanTokens: 0, scanHistory: 0 };
    const job = async (name: keyof typeof result, fn: () => Promise<number>) => {
      try {
        result[name] = await fn();
      } catch (e) {
        ctx.log.error({ job: name, err: { message: (e as Error)?.message } }, 'housekeeping job failed');
      }
    };
    await job('sessions', () => ctx.sessions.purgeExpired());
    await job('transfers', () => ctx.services.ownership.expireStaleTransfers());
    await job('scanTokens', () => purgeScanTokens(ctx.db, new Date(ctx.clock().getTime() - graceMs)));
    const retentionDays = ctx.config.scanRetentionDays;
    if (retentionDays !== null && retentionDays !== undefined) {
      await job('scanHistory', () =>
        purgeScanHistory(ctx.db, new Date(ctx.clock().getTime() - retentionDays * 86_400_000), { batchSize: opts.scanHistoryBatchSize }),
      );
    }
    if (result.sessions + result.transfers + result.scanTokens + result.scanHistory > 0) ctx.log.info(result, 'housekeeping');
    return result;
  };

  const timer = setInterval(() => {
    if (running) return; // never overlap passes
    running = runOnce().finally(() => {
      running = undefined;
    });
  }, intervalMs);
  timer.unref();

  return {
    runOnce,
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
