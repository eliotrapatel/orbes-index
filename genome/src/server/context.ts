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
 *      created on demand in development/test, self-tested in production;
 *   6. the stock and the orders (plan LIVE RELEASE+): the first boot's
 *      locations and carriers, the pieces and sizes on sale linked to their
 *      SKUs, the orders of the sales committed without them
 *      (OrderService.prepare, idempotent); then the tiers' grants of the
 *      accounts at PLATINE or PALLADIUM (plan NEXT-NINE, BP-19 T5:
 *      TierGrantService.prepare, idempotent).
 */
import { closeDb, createDb, poolOf, type Db } from './db/connection.js';
import { parseDatabaseUrl } from './db/url.js';
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
import { ClaimRenewalService, deriveClaimRevealKey } from './services/claim-renewals.js';
import { CircleService } from './services/circle.js';
import { ClubService } from './services/club.js';
import { ClubProgramService } from './services/club-program.js';
import { TierGrantService } from './services/tier-grants.js';
import { CareService, eraseCareLabels } from './services/care.js';
import { GuaranteeService } from './services/guarantees.js';
import { SizeService } from './services/sizes.js';
import { AddressService } from './services/addresses.js';
import { TasteService } from './services/tastes.js';
import { ProfileService } from './services/profiles.js';
import { aggregateWishMonths, purgeWishHistory, WishlistService } from './services/wishlist.js';
import { morningWindowOpen, parisDay } from './services/schedule.js';
import { aggregateViews, intelligenceSizes, purgeViews } from './services/tracking-jobs.js';
import { deriveDropSeedKey, DropService } from './services/drops.js';
import { deriveLiveTurnKey, eraseLiveNetworkHashes, LiveService } from './services/live.js';
import { LiveConsoleService } from './services/live-console.js';
import { LiveEngine } from './services/live-engine.js';
import { LiveInsightsService } from './services/live-insights.js';
import { LiveRoomService } from './services/live-room.js';
import { IssuanceService } from './services/issuance.js';
import { LifecycleService } from './services/lifecycle.js';
import { LookbookService } from './services/lookbook.js';
import { MediaService } from './services/media.js';
import { MessageService } from './services/messages.js';
import { deriveTransferCodeKey, OwnershipService } from './services/ownership.js';
import { OwnershipCertificateService } from './services/ownership-certificates.js';
import { OrderService } from './services/orders.js';
import { InvoiceService } from './services/invoices.js';
import { FulfilmentService } from './services/fulfilment.js';
import { GrowthService } from './services/growth.js';
import { OwnerService } from './services/owners.js';
import { PastReleaseService } from './services/past-releases.js';
import { PlaceService } from './services/places.js';
import { AcquisitionService } from './services/acquisition.js';
import { LinkService } from './services/links.js';
import { TrackingService } from './services/tracking.js';
import { SalonService } from './services/salon.js';
import { ShopifyExportService } from './services/shopify.js';
import { ScanReportService } from './services/scan-reports.js';
import { RetailerService } from './services/retailers.js';
import { SaleService } from './services/sale.js';
import { SegmentService } from './services/segments.js';
import { ActivityService, aggregateActivity } from './services/activity.js';
import { QuestionService } from './services/question.js';
import { purgeScanHistory } from './services/scan-retention.js';
import { aggregateScanStats } from './services/scan-stats.js';
import { purgeScanTokens } from './services/scan-tokens.js';
import { SessionService } from './services/sessions.js';
import { StockService } from './services/stock.js';
import { SupplierOrderService } from './services/supplier-orders.js';
import { deriveCardClaimKey, ReceptionService } from './services/receptions.js';
import { LogisticsService } from './services/logistics.js';
import { OrderCaseService } from './services/order-cases.js';
import { purgePackingPhotos } from './services/parcels.js';
import { SupplierService } from './services/suppliers.js';
import { VerificationService } from './services/verification.js';
import { WarrantyService } from './services/warranty.js';
import { noopLogger, SYSTEM_ACTOR, systemClock, type Clock, type Logger } from './types.js';

export interface AppServices {
  issuance: IssuanceService;
  verification: VerificationService;
  anomaly: AnomalyService;
  lifecycle: LifecycleService;
  ownership: OwnershipService;
  /** Shareable ownership certificates (F-06): the owner's links to the live record of a piece. */
  ownershipCertificates: OwnershipCertificateService;
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
  /** The console's customer sheet: search by email or REF, lock and unlock, the right-of-access export. */
  owners: OwnerService;
  /** The register of points of sale (A-08). */
  retailers: RetailerService;
  /** The sale mode: staff scan, then warranty activation through a sale token (A-08). */
  sale: SaleService;
  /** Reference photographs of models and photographs of pieces, stored once and served publicly (F-04); the galleries of the lookbook (P-R02). */
  media: MediaService;
  /** The lookbook of the models (P-R02): the PUBLIC ones and their sheets, the RESERVED ones for the club. */
  lookbook: LookbookService;
  /** The drops (P-R03): releases on a waiting list, entered from /verify and drawn by tier from a committed seed. */
  drops: DropService;
  /** The owners' club: what a signed-in account holds decides what it reads (P-R03: its tier and its entries; P-X04: its tier's benefits and the next tier, their words set from the console). */
  club: ClubService;
  /** THE PRIVATE SALON (P-X08): the lookbook's RESERVED models by tier, with their prices, requested from /verify and closed from the console. */
  salon: SalonService;
  /** The owners' circle (P-X01): posts by tier (notes, invitations, polls), their answers and votes, the visits by day. */
  circle: CircleService;
  /** The LIVE RELEASES (plan of 2026-10-04): the room, the line at T0, the turns and holds, the console's live controls; the engine's pass (startLiveEngine). */
  live: LiveService;
  /** What the LIVE RELEASES show: their announcements stage by stage, the room as its viewers read it, the boutique board, an account's own entries. */
  liveRoom: LiveRoomService;
  /** THE RELEASES' PAST (plan LIVE RELEASE+, choice 5): the releases ended, public, and the releases an account took part in. */
  pastReleases: PastReleaseService;
  /** The LIVE RELEASES in the console: created, edited until their announcement, published, cancelled; the live board; Client Services' reservations. */
  liveConsole: LiveConsoleService;
  /** The console's intelligence on the LIVE RELEASES: the planner, the forecasts, the radars, the alerts, the report, the collectors, the comparison. */
  liveInsights: LiveInsightsService;
  /** The stock (plan LIVE RELEASE+): per SKU and location, from the ledger; transfers between locations and counts corrected. */
  stock: StockService;
  /** The orders of every sales channel (plan LIVE RELEASE+), step by step: what each holds, its steps, its buyer; the boot's setup. */
  orders: OrderService;
  /** The invoices and credit notes of the orders (plan LIVE RELEASE+, M7): a month's, their PDFs, the accountant's CSV; MY PIECES' own. */
  invoices: InvoiceService;
  /** The fulfilment board (plan LIVE RELEASE+): the orders by step, their time in it and the late ones (M3), the CSV, the delays. */
  fulfilment: FulfilmentService;
  /** The segments (plan LIVE RELEASE+, choice 27): saved groups of collectors, their members read live, their CSV. */
  segments: SegmentService;
  /** The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11): who is asked it, their answers, the console's count. */
  questions: QuestionService;
  /** The best time to open (plan LIVE RELEASE+, choice 10): the sign-ins and scans by hour, country and tier, no account. */
  activity: ActivityService;
  /** Shopify readiness (plan LIVE RELEASE+, N2 and N3): the product and order exports in Shopify's formats, the ids pasted back. */
  shopify: ShopifyExportService;
  /** MESSAGES (plan NEXT-NINE, CS-01): the collector writes to ORBES Client Services, who answer from the console's Messages board. */
  messages: MessageService;
  /** THE PROGRAM (plan NEXT-NINE, BP-19 T2): the figures of the tiers' benefits, and the optional shipping rates. */
  clubProgram: ClubProgramService;
  /** The tiers' grants (plan NEXT-NINE, BP-19 T5): the welcome gift and the credit, once per tier and per account, ever. */
  tierGrants: TierGrantService;
  /** The yearly care (plan NEXT-NINE, BP-19 T6): asked for from the piece, a prepaid label both ways, recorded as YEARLY CARE. */
  care: CareService;
  /** THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01): a guaranteed place at a coming release, granted by Client Services. */
  guarantees: GuaranteeService;
  /** YOUR SIZES (plan NEXT-NINE, AC-01): the sizes a collector saves, which preselect a size it then confirms; a model's size kind and fits. */
  sizes: SizeService;
  /** YOUR ADDRESSES (plan NEXT LOT §3.6.B): the delivery addresses a collector saves, one of them the default, put on each new order. */
  addresses: AddressService;
  /** YOUR TASTES (plan CUSTOMER INTELLIGENCE §3.2 W.5): the favourite pieces and finishes, chosen from what THE COLLECTION shows. */
  tastes: TasteService;
  /** YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1): the names, country, city, phone, date of birth, Instagram, tastes and how they heard of ORBES; the console's answers to that question. */
  profiles: ProfileService;
  /** YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2): the models a collector keeps with the heart on their sheet; private, never audited per tap. */
  wishlist: WishlistService;
  /** The places from the connection (plan CUSTOMER INTELLIGENCE §3.3 T.8.2): a country with or without its city, once each, by an integer id, cached. */
  places: PlaceService;
  /** What collectors look at, from which device and place (plan CUSTOMER INTELLIGENCE §3.3 T.8.3): POST /api/v1/seen's views, buffered and written every 2 s. */
  tracking: TrackingService;
  /** Where collectors come from (plan CUSTOMER INTELLIGENCE §3.4): the console's links, the sources, the visits on the device and their attribution. */
  acquisition: AcquisitionService;
  /** The console's links (plan CUSTOMER INTELLIGENCE §3.4 A.7.1): short ORBES addresses by channel, /go/<code>'s destinations. */
  links: LinkService;
  /** The suppliers (plan NEXT LOT §3.5.6.2): who makes ORBES's pieces, and the supplier of each model and size. */
  suppliers: SupplierService;
  /** The supplier orders (plan NEXT LOT §3.5.6.3): the proposal, the drafts, their steps, invoices and PDFs; ORBES's only. */
  supplierOrders: SupplierOrderService;
  /** The receptions (plan NEXT LOT §3.5.6.5): a delivery counted by the agent, confirmed by ORBES, its identities issued by a worker, its cards printed. */
  receptions: ReceptionService;
  /** Logistics (plan NEXT LOT §3.5.6.6): the stock as the agent and ORBES read it, corrections, transfers, minimums, pieces counted in. */
  logistics: LogisticsService;
  /** Order cases (plan NEXT LOT §1.1 (b), §3.5.6.7): returns, size exchanges and parcel problems, opened, received, decided. */
  orderCases: OrderCaseService;
  /** GROWTH (plan NEXT-NINE, BP-29): what a collector is worth, repeat buying, the funnel from a scan to PALLADIUM, the revenue; reads only. */
  growth: GrowthService;
  /** NEW CLAIM CODE (plan NEXT LOT §3.4): a new claim code for a piece not registered yet, shown once to staff or sealed for its buyer. */
  claimRenewals: ClaimRenewalService;
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
  /**
   * The background workers' timers (the receptions' issuing worker, §3.5.6.5). Default: on, except with ORBES_ENV=test,
   * where tests drive `issuePending` themselves.
   */
  timers?: boolean;
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
    const ownership = new OwnershipService({
      db,
      audit,
      lifecycle,
      clock,
      transferKey: deriveTransferCodeKey(config),
      requireScannedPiece: config.transferAcceptRequireProduct,
    });
    const ownershipCertificates = new OwnershipCertificateService({ db, audit, ownership, publicOrigin: config.publicOrigin, clock });
    const warranty = new WarrantyService({ db, audit, lifecycle, clock });
    const issuance = new IssuanceService({ db, keys, audit, categories, clock, log });
    const catalog = new CatalogService({ db, audit, categories, clock });
    const certificates = new CertificateService({ db, audit, issuance, clock });
    const anomaly = new AnomalyService({ db, config: config.anomaly, audit, clock, log });
    const reports = new ScanReportService({ db, audit, clock, log });
    const recovery = new AccountRecoveryService({ db, audit, sessions, ownership, clock });
    const owners = new OwnerService({ db, audit, sessions, ownership, clock });
    const authenticators = AuthenticatorRegistry.withDefaults();
    const verification = new VerificationService({ db, keys, anomaly, config, authenticators, clock, log });
    const retailers = new RetailerService({ db, audit, clock });
    const sale = new SaleService({ db, verification, warranty, clock });
    const media = new MediaService({ db, audit, clock, log });
    const lookbook = new LookbookService({ db, clock });
    const drops = new DropService({ db, audit, seedKey: deriveDropSeedKey(config), clock });
    const club = new ClubService({ db, drops, audit, clock });
    const salon = new SalonService({ db, audit, lookbook, club, clock });
    const circle = new CircleService({ db, audit, clock, log });
    const turnKey = deriveLiveTurnKey(config);
    const live = new LiveService({ db, audit, seedKey: deriveDropSeedKey(config), turnKey, clock });
    const liveRoom = new LiveRoomService({ db, turnKey, publicOrigin: config.publicOrigin, clock });
    const pastReleases = new PastReleaseService({ db, clock });
    const liveInsights = new LiveInsightsService({ db, clock });
    const questions = new QuestionService({ db, audit, clock });
    const activity = new ActivityService({ db, clock });
    const liveConsole = new LiveConsoleService({ db, audit, seedKey: deriveDropSeedKey(config), publicOrigin: config.publicOrigin, insights: liveInsights, questions, clock });
    const stock = new StockService({ db, audit, clock });
    const orders = new OrderService({ db, audit, lifecycle, clock, log });
    const invoices = new InvoiceService({ db, clock });
    const fulfilment = new FulfilmentService({ db, audit, orders, clock });
    const segments = new SegmentService({ db, audit, clock });
    const shopify = new ShopifyExportService({ db, audit, publicOrigin: config.publicOrigin, clock });
    const messages = new MessageService({ db, audit, lookbook, clock });
    const clubProgram = new ClubProgramService({ db, audit, clock });
    const tierGrants = new TierGrantService({ db, audit, clock, log });
    const care = new CareService({ db, audit, warranty, clock });
    const guarantees = new GuaranteeService({ db, audit, clock });
    const sizes = new SizeService({ db, audit, clock });
    const addresses = new AddressService({ db, audit, clock });
    const tastes = new TasteService({ db, clock });
    const profiles = new ProfileService({ db, audit, tastes, clock });
    const wishlist = new WishlistService({ db, clock });
    const places = new PlaceService({ db });
    // The recording's writes wait while the pool has requests waiting (§3.3 T.8.3): the collectors come first.
    const acquisition = new AcquisitionService({ db, publicOrigin: config.publicOrigin, clock, log });
    const links = new LinkService({ db, audit, publicOrigin: config.publicOrigin, clock });
    // The page load's arrival rides in the views' batches (§3.0 (c), §3.4 A.7.2): the same route, the same exclusions.
    const tracking = new TrackingService({ db, places, clock, log, waiting: () => (poolOf(db)?.waitingCount ?? 0) > 0, arrive: (input) => acquisition.arrive(input) });
    const suppliers = new SupplierService({ db, audit, clock });
    const supplierOrders = new SupplierOrderService({ db, audit, clock });
    const logistics = new LogisticsService({ db, audit, stock, verification, warranty, clock });
    const orderCases = new OrderCaseService({ db, audit, lifecycle, clock, messages });
    const receptions = new ReceptionService({ db, audit, issuance, certificates, cardKey: deriveCardClaimKey(config), clock, log });
    const growth = new GrowthService({ db, clock });
    const claimRenewals = new ClaimRenewalService({ db, audit, certificates, revealKey: deriveClaimRevealKey(config), clock });

    const services: AppServices = {
      issuance,
      verification,
      anomaly,
      lifecycle,
      ownership,
      ownershipCertificates,
      warranty,
      auth,
      authenticators,
      catalog,
      certificates,
      reports,
      recovery,
      owners,
      retailers,
      sale,
      media,
      lookbook,
      drops,
      club,
      salon,
      circle,
      live,
      liveRoom,
      pastReleases,
      liveConsole,
      liveInsights,
      stock,
      orders,
      invoices,
      fulfilment,
      segments,
      questions,
      activity,
      shopify,
      messages,
      clubProgram,
      tierGrants,
      care,
      guarantees,
      sizes,
      addresses,
      tastes,
      profiles,
      wishlist,
      places,
      tracking,
      acquisition,
      links,
      suppliers,
      supplierOrders,
      receptions,
      logistics,
      orderCases,
      growth,
      claimRenewals,
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
        await services.receptions.stop();
        // The views still in memory are written before the database closes (§3.3 T.8.3).
        await services.tracking.stop();
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
    // The stock and the orders: the first boot's locations and carriers, the SKUs, the orders of sales made without them.
    const prepared = await services.orders.prepare();
    if (prepared.locations.length + prepared.carriers.length + prepared.linked.products + prepared.linked.sizes + prepared.orders > 0) {
      log.info(prepared, 'stock and orders ready');
    }
    // The tiers' grants of the accounts already at PLATINE or PALLADIUM (plan NEXT-NINE, BP-19 T5).
    const grants = await services.tierGrants.prepare();
    if (grants > 0) log.info({ grants }, 'tier grants ready');
    // The first boot's answers to « How did you hear about ORBES? » (plan CUSTOMER INTELLIGENCE §3.1 P.3.4).
    const heard = await services.profiles.prepare();
    if (heard.length > 0) log.info({ heard }, 'sign-up answers ready');
    // The recording's start, once (plan CUSTOMER INTELLIGENCE §3.3 T.6 table 10); the past scans follow in the background (start()).
    await services.tracking.prepare();
    // The links' channels, the fixed sources and the visits' start, once (plan CUSTOMER INTELLIGENCE §3.4 A.6, A.12).
    const acquired = await services.acquisition.prepare();
    if (acquired.channels.length + acquired.sources.length > 0 || acquired.started) log.info(acquired, 'visit sources ready');
    // The receptions' issuing worker: what the last process left confirmed is issued, then it polls (§3.5.6.5).
    if (overrides.timers ?? config.env !== 'test') services.receptions.start();
    // The views' buffer writes every 2 s on its own unref'd interval (§3.0 (f)), and the past scans are recorded in the
    // background (§3.3 T.11); tests drive both themselves.
    if (overrides.timers ?? config.env !== 'test') services.tracking.start();
    return ctx;
  } catch (e) {
    if (ownsDb) await closeDb(db).catch(() => {});
    throw e;
  }
}

// ── Housekeeping ───────────────────────────────────────────────────────────

export interface Housekeeping {
  /** Run every job once now (also what the timer does). Errors are logged, never thrown. */
  runOnce(): Promise<{
    sessions: number;
    transfers: number;
    scanTokens: number;
    scanStats: number;
    activity: number;
    viewStats: number;
    viewMonths: number;
    wishMonths: number;
    scanHistory: number;
    viewPurge: number;
    wishHistory: number;
    devicePurge: number;
    liveNetworks: number;
    careLabels: number;
    packingPhotos: number;
    sizes: number;
  }>;
  /** Stop the timer and wait for a running pass to finish. */
  stop(): Promise<void>;
}

/**
 * Purges expired sessions and scan tokens, expires stale transfers, counts
 * the scans of every complete UTC day into scan_daily_stats, counts the
 * sign-ins and scans of every complete UTC hour into activity_hourly (the best
 * time to open, plan LIVE RELEASE+: services/activity.ts) and, when
 * SCAN_RETENTION_DAYS is set, purges scan history older than the retention
 * period, and erases the network hashes of the LIVE RELEASES' entries 30 days
 * after their release ended (services/live.ts), and the prepaid labels of the
 * yearly care 30 days after their request ended (services/care.ts), and the
 * packing photos of the parcels past their keeping (services/parcels.ts), every
 * `intervalMs` (default 10 min).
 *
 * The daily statistics and the hourly activity always run before the purge,
 * and a pass where either failed purges nothing: no scan leaves the history
 * before it is counted (DATABASE §10).
 *
 * The customer intelligence lot's jobs (plan CUSTOMER INTELLIGENCE §3.0 (f)) run
 * only in its morning window (services/schedule.ts morningWindowOpen: from
 * 07:30 UTC until the Paris day ends), in the order of §3.0 (f):
 *   viewStats    each complete Paris day of the views not yet counted, into
 *                view_daily_stats, device_daily_stats and collector_places
 *                (services/tracking-jobs.ts, §3.3 T.10);
 *   viewMonths   the month whose last Paris day viewStats counts, into
 *                collector_view_months, in that day's transaction;
 *   wishMonths   each complete Paris month of YOUR WISHLIST not yet counted,
 *                into model_wish_months (services/wishlist.ts, §3.2 W.7);
 *   (scanHistory, as above)
 *   viewPurge    only when viewStats succeeded in this pass, the raw views past
 *                their 13 months, folded per collector, a whole counted Paris
 *                day per transaction;
 *   wishHistory  only when wishMonths succeeded in this pass, the removed
 *                wishes past their 13 months whose month is counted;
 *   devicePurge  the devices never linked, unseen for 13 months, with no view
 *                left (TrackingService.purgeDevices);
 *   (liveNetworks, careLabels, packingPhotos, as above)
 *   sizes        once a Paris day, the `intelligence sizes` log line: the bytes
 *                of the lot's growing tables (the 50 MB backup watch, §8).
 */
export function startHousekeeping(
  ctx: AppContext,
  opts: { intervalMs?: number; scanTokenGraceMs?: number; scanHistoryBatchSize?: number } = {},
): Housekeeping {
  const intervalMs = opts.intervalMs ?? 10 * 60_000;
  // Keep expired scan tokens a while so "expired" (410) stays distinguishable from "unknown" (400).
  const graceMs = opts.scanTokenGraceMs ?? 24 * 60 * 60_000;
  let running: Promise<unknown> | undefined;
  /** The Paris day the `intelligence sizes` line was last written (once a day, §3.3 T.10). */
  let sizesDay: string | null = null;

  const runOnce = async () => {
    // In the order the jobs run (§3.0 (f)).
    const result = {
      sessions: 0,
      transfers: 0,
      scanTokens: 0,
      scanStats: 0,
      activity: 0,
      viewStats: 0,
      viewMonths: 0,
      wishMonths: 0,
      scanHistory: 0,
      viewPurge: 0,
      wishHistory: 0,
      devicePurge: 0,
      liveNetworks: 0,
      careLabels: 0,
      packingPhotos: 0,
      sizes: 0,
    };
    /** Runs one job; false when it failed (logged). */
    const job = async (name: keyof typeof result, fn: () => Promise<number>): Promise<boolean> => {
      try {
        result[name] = await fn();
        return true;
      } catch (e) {
        ctx.log.error({ job: name, err: { message: (e as Error)?.message } }, 'housekeeping job failed');
        return false;
      }
    };
    await job('sessions', () => ctx.sessions.purgeExpired());
    await job('transfers', () => ctx.services.ownership.expireStaleTransfers());
    await job('scanTokens', () => purgeScanTokens(ctx.db, new Date(ctx.clock().getTime() - graceMs)));
    // Count the complete days first: the purge below must never take a scan that is not counted yet.
    const counted = await job('scanStats', () => aggregateScanStats(ctx.db, ctx.clock()));
    const hourly = await job('activity', () => aggregateActivity(ctx.db, ctx.clock()));
    // The lot's morning window (plan CUSTOMER INTELLIGENCE §3.0 (f)): the views' days and months, then YOUR WISHLIST's
    // months, each counted before its purge.
    const morning = morningWindowOpen(ctx.clock());
    // viewMonths: a month is written in the transaction of its last day's count, so a pass's months are its days'.
    let viewMonths = 0;
    const viewsCounted =
      morning &&
      (await job('viewStats', async () => {
        const r = await aggregateViews(ctx.db, ctx.clock());
        viewMonths = r.months;
        return r.days;
      }));
    result.viewMonths = viewMonths;
    const wishesCounted = morning && (await job('wishMonths', () => aggregateWishMonths(ctx.db, ctx.clock())));
    const retentionDays = ctx.config.scanRetentionDays;
    if (counted && hourly && retentionDays !== null && retentionDays !== undefined) {
      await job('scanHistory', () =>
        purgeScanHistory(ctx.db, new Date(ctx.clock().getTime() - retentionDays * 86_400_000), { batchSize: opts.scanHistoryBatchSize }),
      );
    }
    // A pass where the days failed purges no view: none leaves before its day is counted (§3.3 T.10).
    if (viewsCounted) await job('viewPurge', () => purgeViews(ctx.db, ctx.clock()));
    // A pass where the months failed purges no wish: none leaves before its month is counted.
    if (wishesCounted) await job('wishHistory', () => purgeWishHistory(ctx.db, ctx.clock()));
    if (morning) await job('devicePurge', () => ctx.services.tracking.purgeDevices(ctx.clock()));
    await job('liveNetworks', () => eraseLiveNetworkHashes(ctx.db, ctx.clock()));
    await job('careLabels', () => eraseCareLabels(ctx.db, ctx.clock()));
    // Plan NEXT LOT §3.5.6.8: the packing photos, 14 days after delivery (or after a return opened in time is closed).
    await job('packingPhotos', () => purgePackingPhotos(ctx.db, ctx.clock()));
    // Once a Paris day in the window: the bytes of the lot's growing tables, for the 50 MB backup watch (§3.3 T.10, §8).
    const today = parisDay(ctx.clock());
    if (morning && sizesDay !== today) {
      const measured = await job('sizes', async () => {
        const tables = await intelligenceSizes(ctx.db);
        const total = Object.values(tables).reduce((a, b) => a + b, 0);
        ctx.log.info({ tables, total }, 'intelligence sizes');
        return Object.keys(tables).length;
      });
      if (measured) sizesDay = today;
    }
    if (Object.values(result).some((n) => n > 0)) ctx.log.info(result, 'housekeeping');
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

// ── The LIVE RELEASES' engine ──────────────────────────────────────────────

/**
 * Start the engine of the LIVE RELEASES (services/live-engine.ts): a pass every 250 ms by the one process that holds
 * its advisory lock. On PostgreSQL the lock and the passes use one reserved connection of the pool; on PGlite, its only
 * connection. Stop it before closing the context.
 */
export function startLiveEngine(ctx: AppContext, opts: { tickMs?: number; standbyMs?: number; connection?: 'reserved' | 'shared' } = {}): LiveEngine {
  const engine = new LiveEngine({
    db: ctx.db,
    live: ctx.services.live,
    log: ctx.log,
    connection: opts.connection ?? (parseDatabaseUrl(ctx.config.databaseUrl).kind === 'pglite' ? 'shared' : 'reserved'),
    ...(opts.tickMs !== undefined ? { tickMs: opts.tickMs } : {}),
    ...(opts.standbyMs !== undefined ? { standbyMs: opts.standbyMs } : {}),
  });
  engine.start();
  return engine;
}
