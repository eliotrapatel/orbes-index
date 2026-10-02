# Platform contracts (internal)

These are the binding interfaces for the server, database and web applications. They are read together with `CONTRACTS.md` (core), whose conventions also apply here: ESM, `.js` import extensions, strict TypeScript, no `package.json` edits, no git state changes.

Server code lives in `genome/src/server/**` and is Node-only. Web code lives in `genome/src/web/**`, runs in the browser and may import `src/core/**`.

---

## 0. Runtime context & configuration

`src/server/config.ts` parses the environment with zod at startup and fails fast if anything is invalid.

```ts
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string; port: number;
  publicOrigin: string;                 // e.g. https://verify.theorbes.com (CSRF origin check, links)
  databaseUrl: string;                  // postgres://… | pglite:memory | pglite:/abs/path
  cookieSecret: string;                 // ≥ 32 chars (signing cookies)
  ipHashPepper: string;                 // ≥ 32 chars, HMAC key for IP / device pseudonymisation
  trustProxy: boolean | string;         // passed to Fastify
  geo: { mode: 'none' | 'cloudflare' | 'headers' | 'mmdb'; countryHeader?: string; latHeader?: string; lonHeader?: string; mmdbPath?: string /* absolute, mmdb mode */ };
  keys: { provider: 'local' | 'memory'; dir?: string; encryptionKey?: string /* base64url 32 bytes, AES-256-GCM */ };
  bootstrapAdmin?: { email: string; password: string };   // first-run only
  anomaly: AnomalyConfig;               // internal thresholds — NEVER exposed via API
  rateLimits: { verifyPerMinute: number; authPerMinute: number; adminPerMinute: number; apiPerMinute: number };
  sessionTtlHours: { account: number; admin: number };
  scanRetentionDays: number | null;    // SCAN_RETENTION_DAYS; null = keep scan history indefinitely
  clientServices: { email?: string; phone?: string; hours?: string };   // CLIENT_SERVICES_*; public, {} = no contact shown
}
export function loadConfig(env?: NodeJS.ProcessEnv): AppConfig;
```

Further fields: `migrateOnStart` (`MIGRATE_ON_START`, apply pending migrations at a production start; `--migrate` does the same), `logLevel` (`LOG_LEVEL`: fatal | error | warn | info | debug | trace | silent; default info / debug / warn by environment) and `adminRequireMfa` (`ADMIN_REQUIRE_MFA`, admin sessions must pass TOTP; default true in production only). `RATE_LIMIT_API_PER_MINUTE` (default 120) sets `rateLimits.apiPerMinute`, the budget of the `api` route group. `scanRetentionDays` (`SCAN_RETENTION_DAYS`, whole days 30–3650, never below `scanLookbackDays(anomaly)`, the longest anomaly window or decay period) makes housekeeping purge older scan history (`startHousekeeping`, DATABASE §10); unset is `null`. `clientServices` (`CLIENT_SERVICES_EMAIL`, a plain mailbox safe in a `mailto:` link; `CLIENT_SERVICES_PHONE`, `+` and 7–15 digits with single spaces, dots or hyphens; `CLIENT_SERVICES_HOURS`, one line of at most 120 characters, only beside an email or a phone) is served publicly by `GET /api/v1/client-services`; each is optional, and `redactConfig` logs only `[set]`.

In production, `loadConfig` refuses: a `pglite:` database URL, the `memory` key provider, default, short or low-variety secrets (and identical cookie secret and pepper), an `http:` `publicOrigin`, `TRUST_PROXY=true`, a numeric `TRUST_PROXY` (refused everywhere), and `GEO_MODE=cloudflare|headers|mmdb` without `TRUST_PROXY`. In every environment `GEO_MODE=mmdb` requires an absolute `GEO_MMDB_PATH` (a missing file only disables lookups). `configWarnings(config)` lists accepted but risky settings (`ADMIN_REQUIRE_MFA=false`, or no `SCAN_RETENTION_DAYS`, in production), logged at start.

`src/server/context.ts`:

```ts
export interface AppContext {
  config: AppConfig;
  db: Kysely<Database>;
  clock: () => Date;                    // injectable (tests move time)
  log: { info(o: object | string, m?: string): void; warn(...): void; error(...): void };
  categories: CategoryRegistry;
  keys: KeyService;
  audit: AuditService;
  geo: GeoResolver;
  services: {
    issuance: IssuanceService; verification: VerificationService; anomaly: AnomalyService;
    lifecycle: LifecycleService; ownership: OwnershipService; warranty: WarrantyService;
    auth: AuthService; authenticators: AuthenticatorRegistry;
    catalog: CatalogService;              // collections and models (categories: CategoryRegistry)
  };
}
export async function createContext(config: AppConfig, overrides?: Partial<…>): Promise<AppContext>;
```

---

## 1. Database (PostgreSQL; PGlite in dev/test)

- `src/server/db/schema.ts` holds the Kysely `Database` interface: one table interface per table, with `Generated<>` and `ColumnType<>` where appropriate.
- `src/server/db/migrations/0001_initial.ts` (Kysely `Migration`, raw SQL allowed) and `src/server/db/migrate.ts` (`migrateToLatest(db)`, using a static migration provider so it works when bundled).
- `src/server/db/connection.ts` exports `createDb(url): Kysely<Database>`. It uses the `pg` Pool for `postgres://` URLs and Kysely's built-in `PGliteDialect` for `pglite:` URLs.
- Test helper: `test/support/db.ts` exports `createTestDb()`, which returns a fresh in-memory PGlite database with all migrations applied.

All timestamps are `timestamptz`. All ids are `uuid` (`gen_random_uuid()`) unless stated otherwise. Enumerations are `text` columns with `CHECK` constraints, which are simpler to migrate than PG enums.

Timestamp convention: every row records when it came into being, named after what it records — `created_at` on most tables, but `occurred_at` on the event logs (`scan_events`, `audit_logs`), `started_at` on `ownership`, `opened_at` on `service_records` and `first_seen_at` / `last_seen_at` on `anomalies`. Lifecycle moments have their own columns (`activated_at`, `retired_at`, `revoked_at`, `ended_at`, `completed_at`, `used_at`, `resolved_at`, …). Only the four tables with free-form mutable business data carry `updated_at`: `products`, `accounts`, `admin_users` and `warranties`; it is maintained by the `orbes_touch_updated_at()` trigger. Services set `updated_at` from their injected clock; the trigger stamps `now()` only when an UPDATE leaves the value unchanged, so an explicit value equal to the old one (a frozen test clock) is replaced by the database clock — tests must not compare `updated_at` with the injected clock across two updates at the same instant. Append-only and write-once tables (logs, history, genomes, codes, keys, tokens) have no `updated_at`.

| Table | Columns (constraints) |
|---|---|
| `categories` | `id smallint PK` (= immutable 5-bit category index 1..31) · `code char(1) UNIQUE CHECK (code ~ '^[A-Z]$')` · `name text` · `warranty_months int NOT NULL DEFAULT 24` · `active boolean DEFAULT true` · `created_at` |
| `collections` | `id uuid PK` · `name text UNIQUE` · `created_at` |
| `models` | `id uuid PK` · `collection_id uuid FK NULL` · `category_id smallint FK` · `name text` (e.g. MONOLITHE) · `type text` (e.g. RING) · `sku_prefix text UNIQUE` · `default_material text NULL` · `care_instructions text NULL` · `created_at` |
| `products` | `id uuid PK` · `product_id text UNIQUE` (canonical `O26-J-00184`) · `packed_identity bigint UNIQUE` · `year smallint` · `category_id smallint FK` · `serial int` · `UNIQUE(year, category_id, serial)` · `sku text` · `model_id uuid FK` · `collection_id uuid FK NULL` · `variant text NULL` · `material text` · `production_batch text NULL` · `production_date date NULL` · `status text CHECK in ProductStatus` · `ownership_state text CHECK in ('UNREGISTERED','REGISTERED','OWNED','TRANSFER_PENDING')` · `auth_policy text DEFAULT 'PRINTED_CODE'` · `claim_secret_hash text NULL` · `created_at` · `updated_at` |
| `product_status_history` | `id uuid PK` · `product_id FK` · `from_status text NULL` · `to_status text` · `reason text NULL` · `actor_type text` · `actor_id text NULL` · `created_at` |
| `genomes` | `id uuid PK` · `product_id uuid FK` · `genome_version smallint` · `genome_id text` (= canonical product id string) · `value bigint` (u32) · `glyphs smallint[]` (8) · `pattern text` (glyph ids joined by `·`) · `fingerprint text` · `UNIQUE(product_id, genome_version)` · `UNIQUE(genome_version, value)` · `UNIQUE(fingerprint)` · `created_at` |
| `cryptographic_keys` | `key_id smallint PK CHECK 1..255` · `kid text UNIQUE` · `algorithm text CHECK = 'Ed25519'` · `public_key bytea CHECK length 32` · `status text CHECK in ('ACTIVE','RETIRED','REVOKED')` · `provider text` · `provider_ref text` (reference, never a secret) · `created_at` · `activated_at NULL` · `retired_at NULL` · `revoked_at NULL` · `compromised_at NULL` · `revocation_reason text NULL` · partial `UNIQUE INDEX ON (status) WHERE status='ACTIVE'` |
| `codes` | `id uuid PK` · `product_id FK` · `genome_id uuid FK` → `genomes.id` · `key_id smallint FK` · `code_version smallint` · `issue smallint` · `issued_day int` · `nonce bytea` (4) · `payload bytea` (13) · `signature bytea` (64) · `payload_hash bytea UNIQUE` (sha256) · `status text CHECK in ('ACTIVE','SUPERSEDED','REVOKED')` · `revoked_at NULL` · `revocation_reason NULL` · `UNIQUE(product_id, issue)` · `created_at` |
| `accounts` | `id uuid PK` · `email text` · `email_normalized text UNIQUE` · `password_hash text` · `display_name text NULL` · `country char(2) NULL` · `status text CHECK in ('ACTIVE','LOCKED','DELETED')` · `failed_logins int NOT NULL DEFAULT 0 CHECK >= 0` · `failed_logins_since NULL` (login throttle, migration 0002) · `transfers_frozen_until timestamptz NULL` (72-hour transfer pause after an assisted recovery, migration 0005) · `created_at` · `updated_at` |
| `admin_users` | `id uuid PK` · `email_normalized text UNIQUE` · `email text` · `password_hash text` · `role text CHECK in ('ADMIN','OPERATOR','AUDITOR')` · `totp_secret_enc text NULL` · `failed_logins int DEFAULT 0` · `locked_until NULL` · `disabled_at NULL` · `created_at` · `updated_at` |
| `sessions` | `id_hash bytea PK` (sha256 of the random token) · `subject_type text CHECK in ('account','admin')` · `subject_id uuid` · `csrf_token text` · `mfa_passed boolean DEFAULT false` · `created_at` · `expires_at` · `last_seen_at` · `ip_hash text NULL` · `user_agent text NULL` |
| `ownership` | `id uuid PK` · `product_id FK` · `account_id FK` · `acquired_via text CHECK in ('FIRST_REGISTRATION','TRANSFER','RESALE','ADMIN')` · `verified boolean` (claim secret / retailer proof) · `started_at` · `ended_at NULL` · `ended_reason text NULL` · partial `UNIQUE (product_id) WHERE ended_at IS NULL` |
| `ownership_transfers` | `id uuid PK` · `product_id FK` · `from_account_id FK` · `to_account_id FK NULL` · `token_hash bytea UNIQUE` · `status text CHECK in ('PENDING','ACCEPTED','CANCELLED','EXPIRED')` · `created_at` · `expires_at` · `completed_at NULL` · partial `UNIQUE (product_id) WHERE status='PENDING'` |
| `warranties` | `id uuid PK` · `product_id FK UNIQUE` · `purchase_date date NULL` · `retailer text NULL` · `country char(2) NULL` · `start_date date NULL` · `duration_months int` · `end_date date NULL` · `voided_at NULL` · `void_reason NULL` · `created_at` · `updated_at`. Status is **computed**: `NOT_STARTED`, `ACTIVE`, `EXPIRED` or `VOID`. |
| `service_records` | `id uuid PK` · `product_id FK` · `type text CHECK in ('INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION')` · `status text CHECK in ('OPEN','COMPLETED','CANCELLED')` · `location text NULL` · `notes text NULL` · `opened_at` · `closed_at NULL` · `performed_by text NULL` |
| `scan_tokens` | `id_hash bytea PK` · `product_id FK` · `scan_event_id FK` · `purpose text CHECK in ('FIRST_REGISTRATION')` · `expires_at` · `used_at NULL` · `created_at` |
| `scan_events` | `id uuid PK` · `occurred_at` · `code_id FK NULL` · `product_id FK NULL` · `packed_identity bigint NULL` · `event_type text CHECK in ('VERIFY','REGISTER','TRANSFER','ADMIN_TEST')` · `device_hash text NULL` · `session_hash text NULL` · `account_id FK NULL` · `ip_hash text NULL` · `country char(2) NULL` · `region text NULL` · `lat real NULL` · `lon real NULL` (coarse, rounded to 1 decimal) · `user_agent_family text NULL` · `client_metrics jsonb NULL` · `result_state text` · `latency_ms int NULL` |
| `authentication_events` | `id uuid PK` · `scan_event_id FK` · `code_id FK NULL` · `product_id FK NULL` · `key_id smallint NULL` · `signature_valid boolean` · `genome_check text CHECK in ('MATCH','MISMATCH','NOT_PROVIDED','INCONCLUSIVE')` · `state text` · `reasons text[]` · `risk_score int` · `authenticators jsonb` · `created_at` |
| `anomalies` | `id uuid PK` · `product_id FK NULL` · `code_id FK NULL` · `type text` · `severity text CHECK in ('LOW','MEDIUM','HIGH','CRITICAL')` · `risk_score int` · `details jsonb` · `status text CHECK in ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')` · `occurrences int DEFAULT 1` · `first_seen_at` · `last_seen_at` · `resolved_by text NULL` · `resolved_at NULL` · `resolution_note text NULL` · partial `UNIQUE (product_id, type) WHERE status IN ('OPEN','ACKNOWLEDGED')` (repeat findings increment `occurrences`) |
| `revocations` | `id uuid PK` · `target_type text CHECK in ('CODE','PRODUCT','KEY')` · `target_id text` · `reason_code text` · `reason text NULL` · `created_by text` · `created_at` · `lifted_at NULL` · `lifted_by NULL` |
| `account_recovery_codes` | Migration 0005. `id uuid PK` · `account_id uuid FK → accounts` · `code_hash text CHECK LIKE 'scrypt$%'` (scrypt of the 12-character Crockford code; the code itself is never stored) · `created_by uuid FK → admin_users` · `created_at` · `expires_at` (+ 30 min) · `used_at NULL` · `revoked_at NULL` · never both used and revoked · partial `UNIQUE (account_id) WHERE used_at IS NULL AND revoked_at IS NULL` (one open code per account) · both foreign keys indexed. |
| `scan_reports` | Migration 0004. `id uuid PK` · `scan_event_id uuid FK UNIQUE` (one report per scan) · `channel text CHECK in ('BOUTIQUE','ONLINE','PRIVATE','OTHER')` · `place text NULL` (≤ 200) · `note text NULL` (≤ 500) · `created_at` · `status text CHECK in ('OPEN','CLOSED') DEFAULT 'OPEN'` · `handled_by uuid FK → admin_users NULL` (indexed) · `handled_at NULL` · `resolution_note text NULL` (≤ 2 000). A customer's words: purged with the scan, never audited. |
| `audit_logs` | `id bigserial PK` · `occurred_at` · `actor_type text CHECK in ('admin','account','system')` · `actor_id text NULL` · `action text` · `target_type text NULL` · `target_id text NULL` · `details jsonb` · `ip_hash text NULL` · `prev_hash bytea` · `hash bytea UNIQUE`. Append-only: a trigger rejects UPDATE and DELETE. |

Also create a `product_overview` view that joins `products`, `categories`, `models`, `collections`, the current genome, the active code and `warranties`. It exposes the spec's flat product fields (`product_id`, `sku`, `category`, `collection`, `model`, `variant`, `material`, `production_batch`, `production_date`, `genome_id`, `genome_pattern`, `code_version`, `status`, `warranty_start`, `warranty_end`, `ownership_state`, `created_at`, `updated_at`).

`ProductStatus` = `ISSUED | ACTIVATED | REGISTERED | OWNED | TRANSFERRED | SERVICED | RESOLD | RETIRED | REVOKED | COUNTERFEIT_FLAGGED | LOST | STOLEN`.

---

## 2. Services (`src/server/services/*.ts`)

Each service is a class constructed with the `AppContext` or the parts it needs. Each mutating method takes an `actor: Actor`, where `Actor = { type: 'admin' | 'account' | 'system'; id?: string; ipHash?: string }`, and writes an audit entry. Domain errors are thrown as `DomainError(code, httpStatus, publicMessage)`, defined in `src/server/errors.ts`.

### 2.1 CategoryRegistry (`categories.ts`)
`load()`, `resolver(): CategoryResolver` (sync, cached), `list()`, `create({ code, name, warrantyMonths }, actor)`. `create` assigns the lowest free index in 1..31. **Indices are immutable** once assigned.

### 2.2 Keys (`src/server/keys/`)
```ts
export interface KeyProvider {               // private key custody abstraction (local file / KMS / HSM)
  readonly name: string;
  generate(kid: string): Promise<{ publicKey: Uint8Array; providerRef: string }>;
  sign(providerRef: string, message: Uint8Array): Promise<Uint8Array>;   // Ed25519, 64 bytes
}
export class LocalKeyProvider implements KeyProvider { /* seeds encrypted at rest with AES-256-GCM under
   config.keys.encryptionKey, one file per key in config.keys.dir, mode 0600; never logged */ }
export class MemoryKeyProvider implements KeyProvider { /* dev/test only; refused in production */ }
export class KeyService {
  activeSigner(): Promise<{ keyId: number; kid: string; sign(msg: Uint8Array): Promise<Uint8Array> }>;
  publicKey(keyId: number): Promise<KeyRecord | undefined>;      // cached, invalidated on change
  listPublic(): Promise<PublicKeyInfo[]>;                         // { keyId, kid, alg, publicKey(b64url), status, activatedAt, retiredAt, revokedAt, compromisedAt }
  rotate(actor, kid?): Promise<KeyRecord>;                        // generate new, ACTIVE; previous ACTIVE → RETIRED (verify-only)
  retire(keyId, actor): Promise<void>;
  revoke(keyId, { compromisedAt?: Date; reason: string }, actor): Promise<void>;
}
```
Every signature produced is verified with the stored public key before it is persisted (defence against faulty HSM/KMS output).

### 2.3 IssuanceService (`issuance.ts`)
```ts
issueProduct(input: { categoryCode: string; year?: number; modelId: string; collectionId?: string; sku?: string;
  variant?: string; material: string; productionBatch?: string; productionDate?: string; serial?: number;
  withClaimSecret?: boolean; authPolicy?: string }, actor): Promise<{ product; genome; code; claimCode?: string }>;
reissueCode(productId: string, reason: string, actor): Promise<CodeRecord>;     // old ACTIVE → SUPERSEDED, issue+1
revokeCode(codeId: string, reason: string, actor): Promise<CodeRecord>;         // ACTIVE|SUPERSEDED → REVOKED + revocations row + audit
renderCode(codeId: string, format: 'svg' | 'png' | 'pdf', opts?: { widthMm?: number /* 10–500 */; theme?: 'classic' | 'inverted' | 'ivory' /* 'black' = deprecated alias of classic */; decor?: boolean; dpi?: number; label?: boolean; kOnly?: boolean /* PDF, classic|inverted: DeviceCMYK K only */ }): Promise<{ contentType: string; body: Uint8Array | string; filename: string }>;
renderPrintSheet(codeIds: string[], opts?: { widthMm?; theme?; decor?; label?; kOnly?; page?: 'A4' | 'A3' | 'LETTER'; cropMarks? }, actor?): Promise<RenderedArtifact>;
```
- Serial allocation is atomic: `max(serial)+1` per `(year, category)` inside a transaction with retry on unique violation. An explicit serial is also allowed.
- Payload: `issuedDay` is today, `nonce` is 4 random bytes, `keyId` is the active key, `genomeVersion` is 1, `codeVersion` is 1.
- The claim code is 12 Crockford-base32 characters shown once, stored as an scrypt hash. Format: `XXXX-XXXX-XXXX`.
- Rendering comes from the core encoder: SVG via `renderOrbesCodeSvg`, PNG via resvg at a given dpi, PDF via pdfkit from the same primitives (vector paths). The optional label is a tracked uppercase product ID + `ORBES` under the code in the PDF/SVG print sheet.

### 2.4 VerificationService (`verification.ts`)

```ts
export type VerificationState = 'AUTHENTIC' | 'AUTHENTIC_FIRST_REGISTRATION' | 'AUTHENTIC_REGISTERED' |
  'AUTHENTIC_OWNERSHIP_VERIFIED' | 'SUSPICIOUS_ACTIVITY' | 'REVOKED' | 'UNKNOWN' | 'INVALID_SIGNATURE' | 'MALFORMED_CODE';
export interface VerifyInput { code: string /* base64url of the 79-byte framed data */;
  genome?: { glyphs: (number | null)[]; confidence?: number[] }; client?: { rsErrors?: number; rsErasures?: number; moduleSizePx?: number; decodeMs?: number; source?: 'camera' | 'upload' } }
export interface ScanMeta { deviceHash?: string; sessionHash?: string; accountId?: string; ipHash?: string; geo?: GeoInfo; userAgentFamily?: string }
verify(input: VerifyInput, meta: ScanMeta): Promise<VerifyOutcome>;
```

The decision procedure is normative. Each step that ends the procedure records the reason. The order is: parse → key lookup → signature → revoked-key trust → genome-version support → registry → genome cross-check → statuses → anomalies → ownership → authenticators.

1. **Strict structural parse.** Any string of at most 1024 characters (the empty string included) reaches this step (the route refuses only a missing, non-string or longer `code` with 400, unrecorded). Decode base64url (≤ 200 characters), then `unframeAnyCodeData(bytes, CODE_PROFILES)` (`src/core/code-profiles.ts`): the high nibble of byte 0 picks the code version's profile, whose strict unframing applies (CODE-01: `unframeCodeData`, 79 bytes, CRC-16, then `decodePayload`: reserved values such as genome version, key id or issue 0; field ranges). Any failure gives `MALFORMED_CODE` (reason `MALFORMED:<INPUT|ENCODING|LENGTH|CRC|VERSION|RESERVED|RANGE>`), recorded as a scan. **Exception:** an intact frame (≥ 67 bytes, CRC-16 over everything before it) naming a code version 2–8 without a profile on this server gives `UNKNOWN` (reason `UNSUPPORTED_CODE_VERSION`) and a log warning, like step 5: the server is outdated (or the nibble was edited; it can never reach an authentic state). No anomaly is recorded. The signature (step 3) is verified over the profile's `signingMessage`.
2. **Key lookup.** Look up `keyId`. If no key exists, the result is `INVALID_SIGNATURE` (reason `UNKNOWN_KEY`).
3. **Signature.** Verify Ed25519 over `signingMessage(payload)` using **`verifyEd25519Node` from `src/server/crypto/ed25519-node.ts`**. Never call `crypto.verify` directly. That helper is strict: it rejects small-order and non-canonical public keys *before* calling OpenSSL, because OpenSSL 3.5 accepts the identity point as a key, which enables a universal forgery with R = identity and S = 0. A failure gives `INVALID_SIGNATURE` (reason `BAD_SIGNATURE`). `KeyService` must also refuse to register any public key that fails the same weak-key check. The signature covers every payload field, the genome version included: an edited genome version is a forgery, not an unreadable code.
4. **Revoked-key trust.** Look up the product by `packed_identity` and the code by `(product, issue)`. If the key is `REVOKED`, it vouches only for a code whose registry record exists and was created before `compromised_at` (or `revoked_at` when `compromised_at` is null). Otherwise — no product, no code of that issue, or a record created at or after the cut-off — the result is `INVALID_SIGNATURE` (reason `KEY_REVOKED`), with no anomaly (the key is already known compromised). A record older than the cut-off whose payload hash differs continues to step 6 (`CODE_MISMATCH`).
5. **Genome-version support.** A validly signed (and trusted) code whose genome version this server does not support gives `UNKNOWN` (reason `UNSUPPORTED_GENOME_VERSION`) and a log warning: the server is outdated, the code may be genuine. No anomaly is recorded.
6. **Registry.** If the product or code is missing, the result is `UNKNOWN` with a CRITICAL anomaly `VALID_SIGNATURE_UNREGISTERED` (reasons `PRODUCT_NOT_REGISTERED` / `CODE_NOT_REGISTERED`). If the code exists but `payload_hash` differs, the result is `SUSPICIOUS_ACTIVITY` with a CRITICAL anomaly `CODE_MISMATCH`.
7. **Genome cross-check:** recompute the genome from the signed identity and genome version. If at least 6 glyphs were provided with confidence ≥ 0.5 and at least 2 of those mismatch, the result is `SUSPICIOUS_ACTIVITY` with anomaly `GENOME_MISMATCH`. Record `genome_check`.
8. **Statuses.** Code status `SUPERSEDED` or `REVOKED` gives `REVOKED`. Product status `REVOKED`, `COUNTERFEIT_FLAGGED` or `RETIRED` gives `REVOKED`. Product status `LOST` or `STOLEN` gives `SUSPICIOUS_ACTIVITY`.
9. **Anomalies.** The scan event is inserted (for every request, steps 1–8 included) with the provisional `result_state` `'PENDING'` when no earlier step decided, and updated to the final state in the same transaction (step 12). For a trusted, registered code, run `anomaly.evaluate(...)`, which includes this scan. If the risk score is at least `config.anomaly.suspiciousThreshold`, the result is `SUSPICIOUS_ACTIVITY` (reason `RISK_THRESHOLD`). The exception is a logged-in current owner: they get `AUTHENTIC_OWNERSHIP_VERIFIED` with `notice: 'UNUSUAL_ACTIVITY'` (reason `RISK_THRESHOLD_OWNER`).
10. **Ownership**, when the result is not already decided:
    - The viewer is the current owner: `AUTHENTIC_OWNERSHIP_VERIFIED`.
    - Another current owner exists: `AUTHENTIC_REGISTERED`.
    - There is no owner and the status is `ACTIVATED`, `RESOLD` or `SERVICED` (not a pre-sale service entered from `ISSUED`, §2.6): `AUTHENTIC_FIRST_REGISTRATION`, plus a single-use registration token (32 random bytes, valid 15 minutes).
    - Otherwise: `AUTHENTIC`.

    **Anomaly-poisoning exception:** when the result is `SUSPICIOUS_ACTIVITY` *only* because of the risk score (step 9; not a status, genome or code finding), the product has no owner, its status is registrable as above and it **has a claim secret**, a registration token is still issued with `claimCodeRequired: true` (reason `REGISTRATION_WITH_CLAIM_CODE`). Strangers scanning copies cannot lock out the buyer who holds the certificate claim code, and the token is useless without it. Products without a claim secret get no token while suspicious.
11. **Authenticators.** Authenticator policy (`AuthenticatorRegistry.evaluate`): when the policy requires hardware evidence that was not provided, add `assurance: 'CODE_ONLY'` and `hardwareProofRequired: true`. The state stays the same.
12. **Persist** the `authentication_events` row and the final `scan_events.result_state`. Return the outcome (below). Target latency is p95 < 300 ms.

`VerifyOutcome` is the API response body. The internal risk score, thresholds and raw status are never included.

```ts
{ state, scanId, verifiedAt,
  title: string, message: string,            // brand copy, uppercase titles e.g. 'AUTHENTIC', 'UNUSUAL ACTIVITY DETECTED'
  notice?: 'UNUSUAL_ACTIVITY',
  verification?: { signature: 'VALID'; keyId: number; codeVersion: string /* 'CODE-01' */; genomeVersion: string /* 'GENOME-01' */; issuedAt: string /* date */; issue: number; assurance: 'CODE' | 'CODE_ONLY' | 'CODE_AND_HARDWARE'; hardwareProofRequired?: boolean },
  product?: { productId; category: { code; name }; collection?; model; type; variant?; material; createdYear: number; productionDate?: string;
              care?: string },                                     // only for AUTHENTIC* states
  genome?: { id: string /* product id */; version: 'GENOME-01'; fingerprint; glyphs: number[]; ids: string[] }, // AUTHENTIC*, SUSPICIOUS, REVOKED
  warranty?: { status: 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED' | 'VOID'; startDate?: string; endDate?: string },  // AUTHENTIC* only
  ownership?: { registered: boolean; you: boolean; transferPending?: boolean },                             // AUTHENTIC* only
  registration?: { token: string; expiresAt: string; claimCodeRequired: boolean } }                          // FIRST_REGISTRATION; SUSPICIOUS only per step 10's exception (claimCodeRequired: true)
```

### 2.5 AnomalyService (`anomaly.ts`)

```ts
export interface AnomalyConfig { suspiciousThreshold: number; impossibleTravelKmh: number; minTravelKm: number;
  velocityWindowMin: number; velocityMaxScans: number; velocityMinDevices: number; deviceWindowDays: number;
  deviceMax: number; geoWindowDays: number; geoMaxCountries: number; decayDays: number }
evaluate(input: { productId: string; codeId: string; scanEventId: string; accountIsOwner: boolean }): Promise<{ riskScore: number; findings: AnomalyFinding[] }>;
recordFinding(f: AnomalyFinding): Promise<void>;     // upsert into anomalies (increment occurrences)
```

The rules are pure functions over the code's recent scan history, which keeps them testable:

| Rule | Condition | Severity / weight |
|---|---|---|
| `IMPOSSIBLE_TRAVEL` | Consecutive located scans (lat/lon when available, else the country) whose distance is `≥ minTravelKm` and whose speed is `> impossibleTravelKmh`. The distance is a **lower bound**: exact between two coordinates; zero inside one country when a side has only the country; otherwise the distance between the best known points (coordinates, else the country centroid) minus the radius of each country-only side | HIGH / 60 |
| `SCAN_VELOCITY` | More than `velocityMaxScans` scans in `velocityWindowMin` minutes from at least `velocityMinDevices` distinct **sources** | MEDIUM / 45 |
| `DEVICE_DIVERSITY` | More than `deviceMax` distinct **sources** in `deviceWindowDays` | MEDIUM / 30 |
| `GEO_DISPERSION` | More than `geoMaxCountries` distinct countries in `geoWindowDays` | HIGH / 45 |
| `LOST_STOLEN_SCAN` | Scan of a product whose status is `LOST` or `STOLEN` | HIGH / 50 |
| `POST_REVOCATION_SCAN` | Scan of a revoked or superseded code | MEDIUM / 30 |

The service-level findings `GENOME_MISMATCH` (HIGH), `CODE_MISMATCH` (CRITICAL) and `VALID_SIGNATURE_UNREGISTERED` (CRITICAL) are recorded by the verification service.

- **Sources, not cookies (SEC-7):** `SCAN_VELOCITY` and `DEVICE_DIVERSITY` count distinct sources: the IP pseudonym (`ip_hash`) when present, else the device-cookie pseudonym, else the session pseudonym; scans with none share one bucket. A client that drops its cookie on every request (one address) is one source; so is a boutique wifi with many phones. The config names `velocityMinDevices` / `deviceMax` are kept and apply to sources. `IMPOSSIBLE_TRAVEL` and `GEO_DISPERSION` use the geo fields, not sources.
- **Risk score:** `100 · (1 − Π(1 − wᵢ·decayᵢ/100))`, rounded. `decay` is linear over `decayDays`, from the time of each rule's most recent violation. A same-place burst (`SCAN_VELOCITY` ⊕ `DEVICE_DIVERSITY`) scores 62 ≥ 60.
- **Owner adjustment:** scans of the product's current owner — the authenticated owner's scan being verified, and every past scan whose `account_id` is the current owner's — are left out of `DEVICE_DIVERSITY` and `SCAN_VELOCITY`, so the owner never triggers them; they still count for travel and dispersion.
- **New findings only:** every finding contributes its decayed weight to the score, but only findings whose violation involves the scan being verified are recorded (upserted into `anomalies`); an old burst is not re-counted as a new occurrence on every later scan.
- **Defaults:** threshold 60, 900 km/h, 500 km, 60 min / 20 scans / 5 devices, 7 days / 12 devices, 7 days / 3 countries, 30-day decay.
- **Country centroids:** `src/server/geo/centroids.ts` holds approximate centroids for ISO 3166-1 alpha-2 codes.

### 2.6 LifecycleService (`lifecycle.ts`)

The state machine is data, not scattered `if`s: `TRANSITIONS: Record<ProductStatus, ProductStatus[]>`.

| From | Allowed next statuses |
|---|---|
| `ISSUED` | `ACTIVATED`, `SERVICED` (pre-sale inspection / QA), `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `ACTIVATED` | `REGISTERED`, `OWNED`, `SERVICED`, `RESOLD`, `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `REGISTERED` | `OWNED`, `TRANSFERRED`, `SERVICED`, `RESOLD`, `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `OWNED` | `TRANSFERRED`, `SERVICED`, `RESOLD`, `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `TRANSFERRED` | `OWNED`, `TRANSFERRED`, `SERVICED`, `RESOLD`, `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `SERVICED` | Return to the pre-service status (one of `ISSUED`, `ACTIVATED`, `REGISTERED`, `OWNED`, `TRANSFERRED`, `RESOLD`), or `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `RESOLD` | `REGISTERED`, `OWNED`, `SERVICED`, `RETIRED`, `REVOKED`, `COUNTERFEIT_FLAGGED`, `LOST`, `STOLEN` |
| `LOST`, `STOLEN` | Recovery to the previous non-incident status, or `RETIRED`, `REVOKED` |
| `COUNTERFEIT_FLAGGED` | Clear to the previous status, or `REVOKED`, `RETIRED` |
| `REVOKED` | Reinstatement only: `reinstate(productId, reason, actor)` back to the status before the revocation (ADMIN only) |
| `RETIRED` | None (terminal) |

The service API: `transition(productId, to, { reason }, actor)`, `history(productId)`, `allowedTransitions(productId)` and `isPreSaleService(productId)` (SERVICED entered from ISSUED: never sold, so not open for first registration; ownership refuses it with `REGISTRATION_NOT_ALLOWED`, and verification step 10 must not offer a registration token for it). Every transition writes `product_status_history` (append-only, DB-enforced) and an audit entry. Transitions to `REVOKED` also insert a `revocations` row.

### 2.7 OwnershipService (`ownership.ts`)

| Method | Behaviour |
|---|---|
| `registerFirst(accountId, { registrationToken, claimCode? }, actor)` | The token is single-use, unexpired and bound to the product. If the product has a claim secret, the claim code must match (constant-time scrypt compare; 5 failed attempts per product per hour, then 429). The product must have no current owner. Creates an `ownership` row (`FIRST_REGISTRATION`, `verified` = claim code matched). Product status becomes `OWNED` if verified, otherwise `REGISTERED`, and `ownership_state` is updated. |
| `initiateTransfer(accountId, productId, actor)` | The caller must be the current owner and no transfer may be pending. Returns `{ transferCode: 'XXXX-XXXX-XXXX', expiresAt }` (7 days). Only the hash of the code is stored. Refused with `409 TRANSFERS_PAUSED` while the account's `transfers_frozen_until` is in the future (72 hours after an assisted recovery). |
| `acceptTransfer(accountId, transferCode, actor)` | The recipient cannot be the current owner. Ends the old ownership (`TRANSFERRED_OUT`) and starts the new one (`TRANSFER`, `verified` = previous verified). Product status becomes `TRANSFERRED`. |
| `cancelTransfer(accountId, productId, actor)` | Cancels the pending transfer. |
| `cancelPendingTransfersFrom(tx, accountId, actor, reason)` | Inside the caller's transaction (the assisted recovery, which holds the account row): cancels every pending transfer offered by the account, audited `ownership.transfer.cancel` with the reason. |
| `confirmOwnership(productId, actor /* admin */)` | `REGISTERED` becomes `OWNED` (proof reviewed by client services). |
| `reportIncident(accountId, productId, 'LOST' \| 'STOLEN', actor)` | Owner only. Moves the product to `LOST` or `STOLEN`. |
| `listForAccount(accountId)` / `history(productId)` (admin) | — |

Ownership never changes any cryptographic identity: products, genomes and codes are untouched.

### 2.8 WarrantyService (`warranty.ts`)

| Method | Behaviour |
|---|---|
| `activate(productId, { purchaseDate, retailer, country }, actor)` | Retailer or admin activation. Status goes `ISSUED` → `ACTIVATED`. `start_date` is the purchase date. `end_date` is the start plus the category's warranty months. |
| `status(productId, now)` | Returns `NOT_STARTED`, `ACTIVE`, `EXPIRED` or `VOID`. |
| `void(productId, reason, actor)` / `extend(productId, months, actor)` | `extend`: 1–120 whole months on an activated, non-void warranty; the end date is recomputed from the start (HTTP: `POST /api/admin/products/:productId/warranty/extend`). |
| `openService(productId, { type, location, notes }, actor)` | Moves the product to `SERVICED`. |
| `completeService(serviceId, { notes }, actor)` | Returns the product to its pre-service status. |
| `services(productId)` | — |

### 2.9 AuthService (`auth.ts`)

- **Passwords:** scrypt (`node:crypto`) with N = 2^15, r = 8, p = 1, a 16-byte salt and a 32-byte key. Encoded as `scrypt$15$8$1$<salt b64url>$<hash b64url>`. Verification uses `timingSafeEqual`. Minimum password length is 12.
- **Accounts:** `registerAccount` (optional ISO `country`), `login` (per-account throttle: 10 wrong passwords in 15 minutes → refused with the generic `INVALID_CREDENTIALS`, `accounts.failed_logins` / `failed_logins_since`) and `logout`.
- **Admins:** `adminLogin` (password, then TOTP when enabled; lockout after 10 failures for 15 minutes), `createAdmin`, `createTotpEnrollment` + `enableTotp`, `disableTotp` (the reset: also revokes every session of that admin), `listAdmins`, `findAdminByEmail`. TOTP follows RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step) and the secret is stored AES-GCM encrypted. Operator CLI: `scripts/admin.ts`.
- **Sessions:** a 32-byte random token goes into an httpOnly, Secure (in prod), SameSite=Strict cookie (`orbes_session` / `orbes_admin`; `__Host-orbes_session` / `__Host-orbes_admin` in production). Only the sha256 of the token is stored in the DB. There is a per-session CSRF token. Session ids rotate on login and on the MFA step-up (`SessionService.rotate`: TOTP enrolment issues a new MFA-passed token, same expiry).
- **Bootstrap:** `bootstrapAdmin(config)` runs on first start when there are no admins.

### 2.10 AuditService (`audit.ts`)

`record(entry)` is hash-chained: `hash = sha256(prev_hash ‖ canonicalJSON(entry without hash))`. The genesis `prev_hash` is 32 zero bytes. Appends are serialized with a Postgres advisory transaction lock. `verifyChain()` returns `{ ok, checked, firstBadId? }`. `list(filters, page)`.

### 2.11 Authenticators (`src/server/authenticators/`)

```ts
export type AuthenticatorKind = 'PRINTED_CODE' | 'SECURE_NFC' | 'SECURE_ELEMENT' | 'TAMPER_EVIDENT';
export interface PhysicalAuthenticator { readonly kind: AuthenticatorKind; readonly implemented: boolean;
  evaluate(evidence: unknown, ctx: { product; code }): Promise<{ kind; status: 'PASS' | 'FAIL' | 'NOT_PROVIDED' | 'UNSUPPORTED'; detail?: string }> }
export class PrintedCodeAuthenticator implements PhysicalAuthenticator { /* PASS when signature + registry checks passed */ }
export class AuthenticatorRegistry { register(a); evaluate(policy: string /* 'PRINTED_CODE' | 'PRINTED_CODE+SECURE_NFC' … */, evidence, ctx) }
```

Hardware authenticators are **not implemented**. The registry reports `UNSUPPORTED` for them, and the policy degrades to `CODE_ONLY` assurance. No fake hardware security exists anywhere.

### 2.12 GeoResolver (`src/server/geo/resolver.ts`)

`resolve(request): GeoInfo { country?: string; region?: string; lat?: number; lon?: number }`. Behaviour depends on the mode:

- `none`: returns nothing.
- `cloudflare`: reads `cf-ipcountry`, `cf-iplatitude`, `cf-iplongitude` and `cf-region` (the only mode that fills `region`).
- `headers`: reads the configured header names (country, optional lat/lon). Only use this behind a trusted proxy.
- `mmdb`: looks `request.ip` up in the local GeoIP database at `GEO_MMDB_PATH` (`src/server/geo/mmdb.ts`, DB-IP / MaxMind format; country, lat/lon; no region). `request.ip` is the client only behind `TRUST_PROXY`, which production requires. A missing or unreadable file gives no location, never an error.

Coordinates are rounded to 1 decimal place, which is roughly 10 km. Raw IP addresses are never stored. Only `ipHash`, the HMAC with the pepper, is kept.

---

## 3. HTTP API (Fastify)

Request bodies are JSON validated with zod (strict objects, unknown keys rejected) and are limited to 16 KB. Errors are returned as `{ error: { code, message } }` with no stack traces.

- **Security headers:** `@fastify/helmet`. The CSP is `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, plus `Permissions-Policy: camera=(self)`, HSTS in production and `Referrer-Policy: no-referrer`.
- **CSRF:** cookie-authenticated mutating routes require `x-csrf-token` to equal the session's token, and the `Origin` must equal `publicOrigin` (or be absent with `Sec-Fetch-Site: same-origin`).
- **Rate limits:** `@fastify/rate-limit` per route group.
- **Device cookie:** `orbes_device` (`__Host-orbes_device` in production) is a random 128-bit id set by the server (httpOnly, SameSite=Lax, 2 years). The server stores only `HMAC(pepper, id)`.
- **Shutdown:** requests arriving while the server drains get `503 { error: { code: 'SERVICE_UNAVAILABLE', message } }` with `Connection: close`.

### Public routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Returns `{ ok, version }`. |
| GET | `/api/v1/keys` and `/.well-known/orbes-keys.json` | Public keys (`listPublic`), including `revokedAt` and `compromisedAt` so offline verifiers apply the same trust cut-off. |
| GET | `/api/v1/categories` | Returns `[{ code, index, name }]` for active categories. |
| GET | `/api/v1/client-services` | Extension: `{ email?, phone?, hours? }` from `CLIENT_SERVICES_*`, `{}` when none is set. `Cache-Control: public, max-age=300`. |
| POST | `/api/v1/reports` | Extension: `{ scanId, channel: 'BOUTIQUE'\|'ONLINE'\|'PRIVATE'\|'OTHER', where? (≤ 200), note? (≤ 500) }` → 201 `{ ok: true }`. Only for a VERIFY scan that was not authentic and is less than 24 h old, one per scan (`409 REPORT_NOT_ALLOWED`, `409 REPORT_ALREADY_SENT`). Rate group `verify`, origin check, audited `scan.report` with the scan id alone. |
| POST | `/api/v1/verify` | Takes `VerifyInput` (`code`: any string of at most 1024 characters; undecodable codes are recorded as `MALFORMED_CODE`), returns `VerifyOutcome`. Missing, non-string or longer codes and other schema violations → 400, not recorded. Rate-limited. Reads the session cookie optionally to detect the owner. |

### Account routes (cookie `orbes_session`, `__Host-` prefixed in production)

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/account/register` | Body `{ email, password, displayName?, country? }`. Creates the account and logs in. |
| POST | `/api/v1/account/login` | Body `{ email, password }`. |
| POST | `/api/v1/account/logout` | — |
| GET | `/api/v1/account/session` | Session probe: `{ account: null }` (200) when signed out, else the `me` body. Never 401. |
| GET | `/api/v1/account/me` | Returns `{ account: { email, displayName }, csrfToken }`. 401 if not logged in. |
| GET | `/api/v1/account/products` | The caller's current products, each with genome and warranty summary. |
| POST | `/api/v1/account/password` | Extension: body `{ currentPassword, newPassword }`. `changePassword` keeping this session; a wrong current password is `400 CURRENT_PASSWORD_INVALID`, never a 401. Rate group `auth`. |
| POST | `/api/v1/account/recover` | Extension: body `{ email, recoveryCode, newPassword }`, session-less (origin check), rate group `auth`. One answer, `400 RECOVERY_CODE_INVALID`, for an unknown email and a wrong, expired or used code; 5 failures per account per hour. In one transaction: new password, every session revoked, pending transfers cancelled, new transfers paused 72 h, code used. Returns `{ ok: true, transfersPausedUntil }`; no session is opened. |
| POST | `/api/v1/ownership/register` | Body `{ registrationToken, claimCode? }`. |
| POST | `/api/v1/ownership/transfers` | Body `{ productId }`. Returns `{ transferCode, expiresAt }`. |
| POST | `/api/v1/ownership/transfers/accept` | Body `{ transferCode }`. |
| POST | `/api/v1/ownership/transfers/cancel` | Body `{ productId }`. |
| POST | `/api/v1/ownership/incidents` | Body `{ productId, type: 'LOST' \| 'STOLEN' }`. |
| GET | `/api/v1/products/:productId/service-history` | Owner only. |

### Admin routes (cookie `orbes_admin`, `__Host-` prefixed in production; roles ADMIN > OPERATOR > AUDITOR)

AUDITOR is read-only. Mutations require OPERATOR, or ADMIN for keys, revocation (including transitions to REVOKED and RETIRED), reinstatement, categories, console users and a customer's recovery code.

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/auth/login` | Body `{ email, password, totp? }`. |
| POST | `/api/admin/auth/logout` | — |
| GET | `/api/admin/auth/me` | — |
| GET | `/api/admin/dashboard` | Counts: products by status, scans in the last 24 h / 7 d, open anomalies by severity, active key, recent events. |
| GET | `/api/admin/categories` | Lists categories. |
| POST | `/api/admin/categories` | Creates a category. |
| GET | `/api/admin/models` | Lists models. |
| POST | `/api/admin/models` | Creates a model. |
| GET | `/api/admin/collections` | Lists collections. |
| POST | `/api/admin/collections` | Creates a collection. |
| GET | `/api/admin/products?status&category&q&page` | Product list. |
| POST | `/api/admin/products` | Issues a product (the generator). |
| GET | `/api/admin/products/:productId` | Full detail: product, genome, codes, signature validity (re-verified live), scan count, ownership + history, warranty + services, anomalies, status history, allowed transitions. |
| POST | `/api/admin/products/:productId/transitions` | Body `{ to, reason }`. |
| POST | `/api/admin/products/:productId/reinstate` | — |
| POST | `/api/admin/products/:productId/codes/reissue` | Body `{ reason }`. |
| POST | `/api/admin/products/:productId/warranty/activate` | Activates the warranty. |
| POST | `/api/admin/products/:productId/warranty/void` | Voids the warranty. |
| POST | `/api/admin/products/:productId/warranty/extend` | Body `{ months }` (1–120). Extends an activated warranty (extension). |
| POST | `/api/admin/products/:productId/services` | Opens a service record. |
| POST | `/api/admin/services/:id/complete` | Completes a service record. |
| POST | `/api/admin/products/:productId/ownership/confirm` | Confirms ownership. |
| GET | `/api/admin/codes/:codeId/artifact.(svg\|png\|pdf)?widthMm&theme&decor&label&dpi&kOnly` | Downloads the code artifact (`theme`: classic \| inverted \| ivory; `black` = deprecated alias). |
| POST | `/api/admin/codes/:codeId/revoke` | Body `{ reason }`. |
| GET | `/api/admin/genomes?page` | — |
| GET | `/api/admin/codes?page` | — |
| GET | `/api/admin/scans?productId&state&scanId&page` | Scan and authentication events, each with the customer's `report` (or null). |
| GET | `/api/admin/owners?page` | Accounts with product counts, the end of a transfer pause and the expiry of an open recovery code (`routes/admin/owners.ts`). |
| POST | `/api/admin/owners/:id/recovery-code` | Extension, ADMIN: a one-time recovery code (12 Crockford characters, 30 min, scrypt hash only, one open per account), shown once, after an identity check by ORBES Client Services. Audited `account.recovery_code.issue`, never with the code. |
| GET | `/api/admin/warranties?status&page` | — |
| GET | `/api/admin/anomalies?status&severity&id&page` | Each with `reports` (count, open, latest) on the scans that took part in it. |
| PATCH | `/api/admin/anomalies/:id` | Body `{ status, note }`. |
| GET | `/api/admin/reports?status&scanId&anomalyId&page` | AUDITOR. The Cases queue (extension): each report with its scan, the anomaly the scan took part in and its piece; open cases first. |
| PATCH | `/api/admin/reports/:id` | OPERATOR. Body `{ status: 'CLOSED', note }` (extension). Audited `scan.report.close`. |
| GET | `/api/admin/revocations` | — |
| POST | `/api/admin/revocations` | Body `{ targetType, targetId, reason }`. Dispatches to the code, product or key service. |
| GET | `/api/admin/keys` | Lists keys. |
| POST | `/api/admin/keys/rotate` | — |
| POST | `/api/admin/keys/:keyId/retire` | — |
| POST | `/api/admin/keys/:keyId/revoke` | Body `{ reason, compromisedAt? }`. |
| GET | `/api/admin/audit?page` | Lists audit entries. |
| GET | `/api/admin/audit/verify` | Verifies the audit hash chain. |
| POST | `/api/admin/auth/totp/setup`, `/api/admin/auth/totp/enable` | TOTP enrolment (extension); enable rotates the session token. |
| POST | `/api/admin/codes/print-sheet` | Multi-up PDF of ACTIVE codes (extension). |
| POST | `/api/admin/certificates` | OPERATOR. Certificate cards (PDF card or A4 sheet of 10, or the print shop's CSV), each claim code checked against its hash, never stored or logged; every card and every file name, the CSV's included, says PROOF until the brand validates the layout; checks stop at the first wrong code, one request in progress per admin (extension). |
| GET | `/api/admin/admins` | ADMIN. Console users (extension). |
| POST | `/api/admin/admins/:id/totp/reset` | ADMIN. Removes a lost second factor, ends that admin's sessions, audited (extension). |

Pagination uses `?page=1&pageSize=50` (max 200) and returns `{ items, page, pageSize, total }`.

### Static web

| Path | Serves |
|---|---|
| `/` | `302` redirect to `/verify` |
| `/verify` | `dist/web/verify/index.html` |
| `/admin` | `dist/web/admin/index.html` |
| `/assets/*` | Bundles and css, built by `scripts/build-web.ts` (esbuild) |

---

## 4. Web applications (`src/web/`)

- **verify** (mobile first). Flow: `ORBES / AUTHENTICATION / [ SCAN ORBES CODE ]`, then the camera (rear, 1080p ideal, continuous focus, torch and zoom when supported) with an orbit reticle, then `SCANNING…`, then `VERIFYING…`, then the result. Decoding runs in a Web Worker that imports `decodeOrbesCode` from core; frames are sent as transferable `ImageData` buffers at most every 120 ms. The landing page warms the worker at idle with one synthetic decode. When the camera exposes zoom it opens at about 2× (clamped to the track's range; a control resets it). A read whose correction load 2·rsErrors + rsErasures exceeds 50 is submitted only after a second, independent frame decodes to identical data (a photo: a second resampling). Scan hints are distance-aware (place the whole code inside the orbit · hold steady · hold about 20 cm away · zoom in), never "move closer". A photo upload fallback is available. The result view shows the state title, the GENOME (rendered with the core genome renderer), the product lines (MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026) and the tabs PRODUCT · WARRANTY · CARE · OWNERSHIP. The ownership tab covers login/register, product registration with a claim code, and transfer. An `UNUSUAL ACTIVITY DETECTED` result that carries a registration token (step 10's anomaly-poisoning exception) shows no tabs and no product data, but adds under its help line the section `DO YOU HOLD THE CERTIFICATE CARD?`: sign-in, then the required claim code, then `VIEW AS OWNER`. When ORBES Client Services is configured (`GET /api/v1/client-services`), every caution and void result shows under its help line `CONTACT ORBES CLIENT SERVICES` (a `mailto:` with the subject `ORBES — REF {ref} — {title}` and a body prefilled with the reference, the result and the time with its offset from UTC; the contact never holds the result back more than 1 s), then the phone as a `tel:` link and the hours; the WARRANTY tab of a warranty that no longer applies offers the same. Nothing appears without configuration. Under the contact (and under the certificate-card section when there is one), every result that was not authentic asks `WHERE DID YOU SEE OR BUY THIS PIECE?`, optional: BOUTIQUE · ONLINE · PRIVATE SALE · OTHER, then a place, a note and `SEND ANSWER` (a text link), posted to `POST /api/v1/reports` against the result's `scanId`.
- **admin**. A sidebar with PRODUCTS, GENOMES, CODES, VERIFICATION EVENTS, ANOMALIES, CASES (customers' reports on scans, each leading to its scan, anomaly and piece; an OPERATOR closes one with a note), OWNERS, WARRANTIES, REVOCATIONS, KEYS and AUDIT LOG, plus a GENERATOR (issue form, preview, SVG/PNG/PDF downloads, and the certificate card download while the claim code is shown). The product page follows spec §22.
- **Brand:** white `#FFFFFF`, ivory `#F6F2EA`, ink `#0A0A0A`, hairlines `rgba(10,10,10,.12)`, a subtle metal grey `#9A9A9A`. Type is "Helvetica Neue", Helvetica, Arial, sans-serif, uppercase, tracking 0.18–0.32 em, light weights for display. Layout uses an architectural grid, hairline corner brackets as in `index.html`, generous whitespace and slow cubic-bezier(0.22,1,0.36,1) motion. No gradients, no SaaS cards with drop shadows, no crypto or web3 clichés.
- No inline scripts or inline `<style>` (CSP). All CSS is in external files.
