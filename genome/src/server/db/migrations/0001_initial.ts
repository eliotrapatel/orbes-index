/**
 * 0001 — initial ORBES schema (PLATFORM-CONTRACTS §1).
 *
 * Raw SQL, one statement per array entry: PGlite runs queries through the
 * extended protocol, which refuses multi-statement strings. Kysely's
 * Migrator wraps the whole migration in one transaction (transactional DDL),
 * so it applies completely or not at all.
 *
 * Conventions: uuid ids via gen_random_uuid(), timestamptz everywhere,
 * enumerations as text + CHECK, every FK ON DELETE RESTRICT and indexed.
 * Seeds no business data (categories are seeded by scripts).
 *
 * Integrity guards beyond plain constraints (defence in depth against
 * application bugs and ad-hoc SQL):
 *  - audit_logs is append-only (UPDATE/DELETE/TRUNCATE raise),
 *  - category index/code are immutable and categories are never deleted,
 *  - cryptographic identity columns of products, genomes, codes and keys are immutable,
 *  - updated_at is maintained by trigger unless the statement sets it explicitly.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose: a migration must never change
// when application constants evolve. test/db/schema.test.ts checks they match schema.ts.
const PRODUCT_STATUS = `'ISSUED','ACTIVATED','REGISTERED','OWNED','TRANSFERRED','SERVICED','RESOLD','RETIRED','REVOKED','COUNTERFEIT_FLAGGED','LOST','STOLEN'`;
const VERIFICATION_STATE = `'AUTHENTIC','AUTHENTIC_FIRST_REGISTRATION','AUTHENTIC_REGISTERED','AUTHENTIC_OWNERSHIP_VERIFIED','SUSPICIOUS_ACTIVITY','REVOKED','UNKNOWN','INVALID_SIGNATURE','MALFORMED_CODE'`;
const ACTOR_TYPE = `'admin','account','system'`;

// Custom SQLSTATE for every guard below, so callers can tell a blocked
// mutation apart from constraint failures (23001 is taken by FK ON DELETE RESTRICT).
const GUARD_ERRCODE = `'OR001'`;

export const UP: readonly string[] = [
  // ── Trigger functions ────────────────────────────────────────────────────
  `CREATE FUNCTION orbes_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     -- Respect an explicit value (services pass their injectable clock); otherwise stamp now().
     IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
       NEW.updated_at := now();
     END IF;
     RETURN NEW;
   END $$`,

  `CREATE FUNCTION orbes_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'immutable')
       USING ERRCODE = ${GUARD_ERRCODE};
   END $$`,

  // TG_ARGV lists the immutable columns; compared through jsonb so one function serves every table.
  `CREATE FUNCTION orbes_guard_immutable_columns() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     col text;
     old_row jsonb := to_jsonb(OLD);
     new_row jsonb := to_jsonb(NEW);
   BEGIN
     FOREACH col IN ARRAY TG_ARGV LOOP
       IF (new_row -> col) IS DISTINCT FROM (old_row -> col) THEN
         RAISE EXCEPTION '%.% is immutable', TG_TABLE_NAME, col USING ERRCODE = ${GUARD_ERRCODE};
       END IF;
     END LOOP;
     RETURN NEW;
   END $$`,

  // ── categories ───────────────────────────────────────────────────────────
  `CREATE TABLE categories (
     id              smallint    PRIMARY KEY CHECK (id BETWEEN 1 AND 31),
     code            char(1)     NOT NULL UNIQUE CHECK (code ~ '^[A-Z]$'),
     name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
     warranty_months int         NOT NULL DEFAULT 24 CHECK (warranty_months BETWEEN 0 AND 600),
     active          boolean     NOT NULL DEFAULT true,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TRIGGER categories_immutable_identity BEFORE UPDATE ON categories
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'code')`,
  `CREATE TRIGGER categories_no_delete BEFORE DELETE ON categories
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('category indices are never released; deactivate instead')`,

  // ── collections / models ─────────────────────────────────────────────────
  `CREATE TABLE collections (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name       text        NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE models (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     collection_id     uuid        NULL REFERENCES collections (id) ON DELETE RESTRICT,
     category_id       smallint    NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
     name              text        NOT NULL CHECK (length(btrim(name)) > 0),
     type              text        NOT NULL CHECK (length(btrim(type)) > 0),
     sku_prefix        text        NOT NULL UNIQUE CHECK (length(btrim(sku_prefix)) > 0),
     default_material  text        NULL,
     care_instructions text        NULL,
     created_at        timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX models_collection_id_idx ON models (collection_id)`,
  `CREATE INDEX models_category_id_idx ON models (category_id)`,

  // ── products ─────────────────────────────────────────────────────────────
  `CREATE TABLE products (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id        text        NOT NULL UNIQUE CHECK (product_id ~ '^O[0-9]{2}-[A-Z]-([0-9]{5}|[1-9][0-9]{5})$'),
     packed_identity   bigint      NOT NULL UNIQUE CHECK (packed_identity BETWEEN 0 AND 4294967295),
     year              smallint    NOT NULL CHECK (year BETWEEN 2000 AND 2099),
     category_id       smallint    NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
     serial            int         NOT NULL CHECK (serial BETWEEN 1 AND 999999),
     sku               text        NOT NULL CHECK (length(btrim(sku)) > 0),
     model_id          uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     collection_id     uuid        NULL REFERENCES collections (id) ON DELETE RESTRICT,
     variant           text        NULL,
     material          text        NOT NULL,
     production_batch  text        NULL,
     production_date   date        NULL,
     status            text        NOT NULL DEFAULT 'ISSUED' CHECK (status IN (${PRODUCT_STATUS})),
     ownership_state   text        NOT NULL DEFAULT 'UNREGISTERED'
                                   CHECK (ownership_state IN ('UNREGISTERED','REGISTERED','OWNED','TRANSFER_PENDING')),
     auth_policy       text        NOT NULL DEFAULT 'PRINTED_CODE' CHECK (auth_policy ~ '^[A-Z][A-Z_]*(\\+[A-Z][A-Z_]*)*$'),
     claim_secret_hash text        NULL,
     created_at        timestamptz NOT NULL DEFAULT now(),
     updated_at        timestamptz NOT NULL DEFAULT now(),
     UNIQUE (year, category_id, serial),
     -- Same packing as core packIdentity(): yy:7 | category:5 | serial:20.
     CONSTRAINT products_packed_identity_consistent
       CHECK (packed_identity = (((year - 2000)::bigint << 25) | (category_id::bigint << 20) | serial::bigint)),
     -- CASE guards the casts: CHECK clauses have no evaluation order, and a malformed id
     -- must fail as a check violation, not as a cast error.
     CONSTRAINT products_product_id_consistent CHECK (
       CASE WHEN product_id ~ '^O[0-9]{2}-[A-Z]-[0-9]{5,6}$'
         THEN substr(product_id, 2, 2)::int = year - 2000 AND split_part(product_id, '-', 3)::int = serial
         ELSE false
       END)
   )`,
  `CREATE INDEX products_category_id_idx ON products (category_id)`,
  `CREATE INDEX products_model_id_idx ON products (model_id)`,
  `CREATE INDEX products_collection_id_idx ON products (collection_id)`,
  `CREATE INDEX products_status_idx ON products (status)`,
  `CREATE TRIGGER products_touch_updated_at BEFORE UPDATE ON products
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER products_immutable_identity BEFORE UPDATE ON products
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'product_id', 'packed_identity', 'year', 'category_id', 'serial', 'created_at')`,

  `CREATE TABLE product_status_history (
     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id  uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     from_status text        NULL CHECK (from_status IN (${PRODUCT_STATUS})),
     to_status   text        NOT NULL CHECK (to_status IN (${PRODUCT_STATUS})),
     reason      text        NULL,
     actor_type  text        NOT NULL CHECK (actor_type IN (${ACTOR_TYPE})),
     actor_id    text        NULL,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX product_status_history_product_idx ON product_status_history (product_id, created_at)`,

  // ── genomes ──────────────────────────────────────────────────────────────
  `CREATE TABLE genomes (
     id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id     uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     genome_version smallint    NOT NULL CHECK (genome_version BETWEEN 1 AND 15),
     genome_id      text        NOT NULL,
     value          bigint      NOT NULL CHECK (value BETWEEN 0 AND 4294967295),
     glyphs         smallint[]  NOT NULL CHECK (
                      array_ndims(glyphs) = 1 AND cardinality(glyphs) = 8
                      AND array_position(glyphs, NULL) IS NULL
                      AND 0 <= ALL (glyphs) AND 15 >= ALL (glyphs)),
     pattern        text        NOT NULL,
     fingerprint    text        NOT NULL UNIQUE CHECK (fingerprint ~ '^G[0-9]{1,2}-[0-9A-F]{4}-[0-9A-F]{4}$'),
     created_at     timestamptz NOT NULL DEFAULT now(),
     UNIQUE (product_id, genome_version),
     UNIQUE (genome_version, value)
   )`,
  // A genome is derived from the signed identity: once written it never changes.
  `CREATE TRIGGER genomes_immutable BEFORE UPDATE ON genomes
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('genomes are immutable')`,

  // ── cryptographic_keys ───────────────────────────────────────────────────
  `CREATE TABLE cryptographic_keys (
     key_id            smallint    PRIMARY KEY CHECK (key_id BETWEEN 1 AND 255),
     kid               text        NOT NULL UNIQUE CHECK (length(btrim(kid)) > 0),
     algorithm         text        NOT NULL DEFAULT 'Ed25519' CHECK (algorithm = 'Ed25519'),
     public_key        bytea       NOT NULL UNIQUE CHECK (octet_length(public_key) = 32),
     status            text        NOT NULL CHECK (status IN ('ACTIVE','RETIRED','REVOKED')),
     provider          text        NOT NULL,
     provider_ref      text        NOT NULL,
     created_at        timestamptz NOT NULL DEFAULT now(),
     activated_at      timestamptz NULL,
     retired_at        timestamptz NULL,
     revoked_at        timestamptz NULL,
     compromised_at    timestamptz NULL,
     revocation_reason text        NULL
   )`,
  `CREATE UNIQUE INDEX cryptographic_keys_single_active ON cryptographic_keys (status) WHERE status = 'ACTIVE'`,
  `CREATE TRIGGER cryptographic_keys_immutable_identity BEFORE UPDATE ON cryptographic_keys
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('key_id', 'kid', 'algorithm', 'public_key', 'provider', 'provider_ref', 'created_at')`,

  // ── codes ────────────────────────────────────────────────────────────────
  `CREATE TABLE codes (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id        uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     genome_id         uuid        NOT NULL REFERENCES genomes (id) ON DELETE RESTRICT,
     key_id            smallint    NOT NULL REFERENCES cryptographic_keys (key_id) ON DELETE RESTRICT,
     code_version      smallint    NOT NULL CHECK (code_version BETWEEN 1 AND 8),
     issue             smallint    NOT NULL CHECK (issue BETWEEN 1 AND 255),
     issued_day        int         NOT NULL CHECK (issued_day BETWEEN 0 AND 65535),
     nonce             bytea       NOT NULL CHECK (octet_length(nonce) = 4),
     payload           bytea       NOT NULL CHECK (octet_length(payload) = 13),
     signature         bytea       NOT NULL CHECK (octet_length(signature) = 64),
     payload_hash      bytea       NOT NULL UNIQUE CHECK (octet_length(payload_hash) = 32),
     status            text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED')),
     revoked_at        timestamptz NULL,
     revocation_reason text        NULL,
     created_at        timestamptz NOT NULL DEFAULT now(),
     UNIQUE (product_id, issue)
   )`,
  // At most one ACTIVE code per product (re-issue supersedes the previous one first).
  `CREATE UNIQUE INDEX codes_single_active_per_product ON codes (product_id) WHERE status = 'ACTIVE'`,
  `CREATE INDEX codes_genome_id_idx ON codes (genome_id)`,
  `CREATE INDEX codes_key_id_idx ON codes (key_id)`,
  `CREATE TRIGGER codes_immutable_identity BEFORE UPDATE ON codes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'product_id', 'genome_id', 'key_id', 'code_version', 'issue', 'issued_day', 'nonce', 'payload', 'signature', 'payload_hash', 'created_at')`,

  // ── accounts / admin_users / sessions ────────────────────────────────────
  `CREATE TABLE accounts (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     email            text        NOT NULL,
     email_normalized text        NOT NULL UNIQUE,
     password_hash    text        NOT NULL,
     display_name     text        NULL,
     country          char(2)     NULL CHECK (country ~ '^[A-Z]{2}$'),
     status           text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOCKED','DELETED')),
     created_at       timestamptz NOT NULL DEFAULT now(),
     updated_at       timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TRIGGER accounts_touch_updated_at BEFORE UPDATE ON accounts
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  `CREATE TABLE admin_users (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     email_normalized text        NOT NULL UNIQUE,
     email            text        NOT NULL,
     password_hash    text        NOT NULL,
     role             text        NOT NULL CHECK (role IN ('ADMIN','OPERATOR','AUDITOR')),
     totp_secret_enc  text        NULL,
     failed_logins    int         NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
     locked_until     timestamptz NULL,
     disabled_at      timestamptz NULL,
     created_at       timestamptz NOT NULL DEFAULT now(),
     updated_at       timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TRIGGER admin_users_touch_updated_at BEFORE UPDATE ON admin_users
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  `CREATE TABLE sessions (
     id_hash      bytea       PRIMARY KEY CHECK (octet_length(id_hash) = 32),
     subject_type text        NOT NULL CHECK (subject_type IN ('account','admin')),
     subject_id   uuid        NOT NULL,
     csrf_token   text        NOT NULL,
     mfa_passed   boolean     NOT NULL DEFAULT false,
     created_at   timestamptz NOT NULL DEFAULT now(),
     expires_at   timestamptz NOT NULL,
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     ip_hash      text        NULL,
     user_agent   text        NULL
   )`,
  `CREATE INDEX sessions_subject_idx ON sessions (subject_type, subject_id)`,
  `CREATE INDEX sessions_expires_at_idx ON sessions (expires_at)`,

  // ── ownership ────────────────────────────────────────────────────────────
  `CREATE TABLE ownership (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id   uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     account_id   uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     acquired_via text        NOT NULL CHECK (acquired_via IN ('FIRST_REGISTRATION','TRANSFER','RESALE','ADMIN')),
     verified     boolean     NOT NULL DEFAULT false,
     started_at   timestamptz NOT NULL DEFAULT now(),
     ended_at     timestamptz NULL,
     ended_reason text        NULL,
     CHECK (ended_at IS NULL OR ended_at >= started_at)
   )`,
  `CREATE UNIQUE INDEX ownership_single_current ON ownership (product_id) WHERE ended_at IS NULL`,
  `CREATE INDEX ownership_product_id_idx ON ownership (product_id, started_at)`,
  `CREATE INDEX ownership_account_id_idx ON ownership (account_id)`,

  `CREATE TABLE ownership_transfers (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id      uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     from_account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     to_account_id   uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     token_hash      bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
     status          text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','CANCELLED','EXPIRED')),
     created_at      timestamptz NOT NULL DEFAULT now(),
     expires_at      timestamptz NOT NULL,
     completed_at    timestamptz NULL
   )`,
  `CREATE UNIQUE INDEX ownership_transfers_single_pending ON ownership_transfers (product_id) WHERE status = 'PENDING'`,
  `CREATE INDEX ownership_transfers_product_id_idx ON ownership_transfers (product_id)`,
  `CREATE INDEX ownership_transfers_from_account_idx ON ownership_transfers (from_account_id)`,
  `CREATE INDEX ownership_transfers_to_account_idx ON ownership_transfers (to_account_id)`,

  // ── warranties / service_records ─────────────────────────────────────────
  `CREATE TABLE warranties (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id      uuid        NOT NULL UNIQUE REFERENCES products (id) ON DELETE RESTRICT,
     purchase_date   date        NULL,
     retailer        text        NULL,
     country         char(2)     NULL CHECK (country ~ '^[A-Z]{2}$'),
     start_date      date        NULL,
     duration_months int         NOT NULL CHECK (duration_months BETWEEN 0 AND 1200),
     end_date        date        NULL,
     voided_at       timestamptz NULL,
     void_reason     text        NULL,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now(),
     CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
   )`,
  `CREATE TRIGGER warranties_touch_updated_at BEFORE UPDATE ON warranties
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  `CREATE TABLE service_records (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id   uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     type         text        NOT NULL CHECK (type IN ('INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION')),
     status       text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
     location     text        NULL,
     notes        text        NULL,
     opened_at    timestamptz NOT NULL DEFAULT now(),
     closed_at    timestamptz NULL,
     performed_by text        NULL,
     CHECK (closed_at IS NULL OR closed_at >= opened_at)
   )`,
  `CREATE INDEX service_records_product_id_idx ON service_records (product_id, opened_at)`,

  // ── scans ────────────────────────────────────────────────────────────────
  `CREATE TABLE scan_events (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     occurred_at       timestamptz NOT NULL DEFAULT now(),
     code_id           uuid        NULL REFERENCES codes (id) ON DELETE RESTRICT,
     product_id        uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     packed_identity   bigint      NULL CHECK (packed_identity BETWEEN 0 AND 4294967295),
     event_type        text        NOT NULL CHECK (event_type IN ('VERIFY','REGISTER','TRANSFER','ADMIN_TEST')),
     device_hash       text        NULL,
     session_hash      text        NULL,
     account_id        uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     ip_hash           text        NULL,
     country           char(2)     NULL CHECK (country ~ '^[A-Z]{2}$'),
     region            text        NULL,
     lat               real        NULL CHECK (lat BETWEEN -90 AND 90),
     lon               real        NULL CHECK (lon BETWEEN -180 AND 180),
     user_agent_family text        NULL,
     client_metrics    jsonb       NULL,
     result_state      text        NOT NULL,
     latency_ms        int         NULL CHECK (latency_ms >= 0)
   )`,
  `CREATE INDEX scan_events_product_occurred_idx ON scan_events (product_id, occurred_at)`,
  `CREATE INDEX scan_events_code_occurred_idx ON scan_events (code_id, occurred_at)`,
  `CREATE INDEX scan_events_account_id_idx ON scan_events (account_id)`,
  `CREATE INDEX scan_events_occurred_at_idx ON scan_events (occurred_at)`,

  `CREATE TABLE scan_tokens (
     id_hash       bytea       PRIMARY KEY CHECK (octet_length(id_hash) = 32),
     product_id    uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     scan_event_id uuid        NOT NULL REFERENCES scan_events (id) ON DELETE RESTRICT,
     purpose       text        NOT NULL CHECK (purpose IN ('FIRST_REGISTRATION')),
     expires_at    timestamptz NOT NULL,
     used_at       timestamptz NULL,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX scan_tokens_product_id_idx ON scan_tokens (product_id)`,
  `CREATE INDEX scan_tokens_scan_event_id_idx ON scan_tokens (scan_event_id)`,

  `CREATE TABLE authentication_events (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     scan_event_id   uuid        NOT NULL REFERENCES scan_events (id) ON DELETE RESTRICT,
     code_id         uuid        NULL REFERENCES codes (id) ON DELETE RESTRICT,
     product_id      uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     key_id          smallint    NULL CHECK (key_id BETWEEN 0 AND 255),
     signature_valid boolean     NOT NULL,
     genome_check    text        NOT NULL CHECK (genome_check IN ('MATCH','MISMATCH','NOT_PROVIDED','INCONCLUSIVE')),
     state           text        NOT NULL CHECK (state IN (${VERIFICATION_STATE})),
     reasons         text[]      NOT NULL DEFAULT '{}',
     risk_score      int         NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
     authenticators  jsonb       NOT NULL DEFAULT '[]',
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX authentication_events_scan_event_id_idx ON authentication_events (scan_event_id)`,
  `CREATE INDEX authentication_events_code_id_idx ON authentication_events (code_id)`,
  `CREATE INDEX authentication_events_product_id_idx ON authentication_events (product_id, created_at)`,

  // ── anomalies / revocations ──────────────────────────────────────────────
  `CREATE TABLE anomalies (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id      uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     code_id         uuid        NULL REFERENCES codes (id) ON DELETE RESTRICT,
     type            text        NOT NULL CHECK (type ~ '^[A-Z][A-Z0-9_]*$'),
     severity        text        NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
     risk_score      int         NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
     details         jsonb       NOT NULL DEFAULT '{}',
     status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
     occurrences     int         NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
     first_seen_at   timestamptz NOT NULL DEFAULT now(),
     last_seen_at    timestamptz NOT NULL DEFAULT now(),
     resolved_by     text        NULL,
     resolved_at     timestamptz NULL,
     resolution_note text        NULL,
     CHECK (last_seen_at >= first_seen_at)
   )`,
  // Repeat findings for an open/acknowledged anomaly increment occurrences instead of adding rows.
  `CREATE UNIQUE INDEX anomalies_single_open_per_type ON anomalies (product_id, type) WHERE status IN ('OPEN','ACKNOWLEDGED')`,
  `CREATE INDEX anomalies_status_severity_idx ON anomalies (status, severity)`,
  `CREATE INDEX anomalies_product_id_idx ON anomalies (product_id)`,
  `CREATE INDEX anomalies_code_id_idx ON anomalies (code_id)`,

  `CREATE TABLE revocations (
     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     target_type text        NOT NULL CHECK (target_type IN ('CODE','PRODUCT','KEY')),
     target_id   text        NOT NULL,
     reason_code text        NOT NULL,
     reason      text        NULL,
     created_by  text        NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     lifted_at   timestamptz NULL,
     lifted_by   text        NULL
   )`,
  `CREATE INDEX revocations_target_idx ON revocations (target_type, target_id)`,

  // ── audit_logs (append-only, hash-chained by AuditService) ───────────────
  `CREATE TABLE audit_logs (
     id          bigserial   PRIMARY KEY,
     occurred_at timestamptz NOT NULL,
     actor_type  text        NOT NULL CHECK (actor_type IN (${ACTOR_TYPE})),
     actor_id    text        NULL,
     action      text        NOT NULL CHECK (length(action) BETWEEN 1 AND 200),
     target_type text        NULL,
     target_id   text        NULL,
     details     jsonb       NOT NULL DEFAULT '{}',
     ip_hash     text        NULL,
     prev_hash   bytea       NOT NULL CHECK (octet_length(prev_hash) = 32),
     hash        bytea       NOT NULL UNIQUE CHECK (octet_length(hash) = 32)
   )`,
  // Each hash can be the predecessor of only one entry: a forked chain fails at insert time.
  `CREATE UNIQUE INDEX audit_logs_prev_hash_key ON audit_logs (prev_hash)`,
  `CREATE INDEX audit_logs_occurred_at_idx ON audit_logs (occurred_at)`,
  `CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id)`,
  `CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('audit_logs is append-only')`,
  `CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('audit_logs is append-only')`,

  // ── product_overview ─────────────────────────────────────────────────────
  // Current genome = highest genome_version; active code = the (unique) ACTIVE one.
  // The product's own collection wins over the model's default collection.
  `CREATE VIEW product_overview AS
   SELECT
     p.id,
     p.product_id,
     p.packed_identity,
     p.sku,
     p.category_id,
     c.code            AS category_code,
     c.name            AS category,
     col.name          AS collection,
     m.name            AS model,
     m.type            AS model_type,
     p.variant,
     p.material,
     p.production_batch,
     p.production_date,
     g.genome_id,
     g.genome_version,
     g.pattern         AS genome_pattern,
     g.fingerprint     AS genome_fingerprint,
     ac.id             AS code_id,
     ac.code_version,
     ac.issue          AS code_issue,
     p.status,
     w.start_date      AS warranty_start,
     w.end_date        AS warranty_end,
     p.ownership_state,
     p.created_at,
     p.updated_at
   FROM products p
   JOIN categories c ON c.id = p.category_id
   JOIN models m ON m.id = p.model_id
   LEFT JOIN collections col ON col.id = COALESCE(p.collection_id, m.collection_id)
   LEFT JOIN LATERAL (
     SELECT gg.genome_id, gg.genome_version, gg.pattern, gg.fingerprint
     FROM genomes gg
     WHERE gg.product_id = p.id
     ORDER BY gg.genome_version DESC
     LIMIT 1
   ) g ON true
   LEFT JOIN codes ac ON ac.product_id = p.id AND ac.status = 'ACTIVE'
   LEFT JOIN warranties w ON w.product_id = p.id`,
];

export const DOWN: readonly string[] = [
  `DROP VIEW IF EXISTS product_overview`,
  `DROP TABLE IF EXISTS audit_logs`,
  `DROP TABLE IF EXISTS revocations`,
  `DROP TABLE IF EXISTS anomalies`,
  `DROP TABLE IF EXISTS authentication_events`,
  `DROP TABLE IF EXISTS scan_tokens`,
  `DROP TABLE IF EXISTS scan_events`,
  `DROP TABLE IF EXISTS service_records`,
  `DROP TABLE IF EXISTS warranties`,
  `DROP TABLE IF EXISTS ownership_transfers`,
  `DROP TABLE IF EXISTS ownership`,
  `DROP TABLE IF EXISTS sessions`,
  `DROP TABLE IF EXISTS admin_users`,
  `DROP TABLE IF EXISTS accounts`,
  `DROP TABLE IF EXISTS codes`,
  `DROP TABLE IF EXISTS cryptographic_keys`,
  `DROP TABLE IF EXISTS genomes`,
  `DROP TABLE IF EXISTS product_status_history`,
  `DROP TABLE IF EXISTS products`,
  `DROP TABLE IF EXISTS models`,
  `DROP TABLE IF EXISTS collections`,
  `DROP TABLE IF EXISTS categories`,
  `DROP FUNCTION IF EXISTS orbes_guard_immutable_columns()`,
  `DROP FUNCTION IF EXISTS orbes_reject_mutation()`,
  `DROP FUNCTION IF EXISTS orbes_touch_updated_at()`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
