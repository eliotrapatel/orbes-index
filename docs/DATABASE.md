# ORBES GENOME CODE™ — Database

Status: v0.1, describes migration `0001_initial`. This document is descriptive: where it and the code disagree, the code wins and this document is wrong.

Implementation:

- `genome/src/server/db/migrations/0001_initial.ts` (the schema, raw SQL)
- `genome/src/server/db/schema.ts` (Kysely types, enumerations, value helpers)
- `genome/src/server/db/connection.ts` (drivers, type normalisation, transactions, advisory locks)
- `genome/src/server/db/migrate.ts` (migration runner)
- `genome/src/server/db/pg-errors.ts` (SQLSTATE helpers)
- `genome/src/server/services/*.ts`, `genome/src/server/keys/key-service.ts` and `genome/src/server/services/catalog.ts` (collections and models) (the writers)
- Contract: `genome/PLATFORM-CONTRACTS.md` §1

Related documents: [ARCHITECTURE](ARCHITECTURE.md) · [CRYPTOGRAPHY](CRYPTOGRAPHY.md) · [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md) · [SECURITY-MODEL](SECURITY-MODEL.md) · [API](API.md)

---

## Contents

1. [Purpose](#1-purpose)
2. [Engines, connection and value types](#2-engines-connection-and-value-types)
3. [Schema conventions](#3-schema-conventions)
4. [Entity-relationship diagram](#4-entity-relationship-diagram)
5. [Tables](#5-tables)
6. [The `product_overview` view](#6-the-product_overview-view)
7. [Product lifecycle](#7-product-lifecycle)
8. [Transactions and locking](#8-transactions-and-locking)
9. [Migrations](#9-migrations)
10. [Housekeeping and retention](#10-housekeeping-and-retention)
11. [Backup, restore and point-in-time recovery](#11-backup-restore-and-point-in-time-recovery)
12. [Mapping of the specification's product fields](#12-mapping-of-the-specifications-product-fields)

---

## 1. Purpose

The database is the **registry** of the ORBES GENOME CODE system. It records:

- the catalogue (categories, collections, models);
- every issued product, its genome and every code ever signed for it, together with the public half of every signing key;
- customer accounts, staff (admin) users and their login sessions, and the one-time codes with which ORBES Client Services lets a customer recover a forgotten password;
- ownership, ownership transfers, warranties and service records;
- every verification request (scan) and its authentication decision;
- customers' reports on scans that were not authentic (where they saw or bought the piece), and the cases staff follow up;
- the scans of every complete day counted by country, result and event type, an anonymous record that outlives the scan history;
- anomaly findings and revocations;
- an append-only, hash-chained audit log of every mutation.

It never holds private signing keys, raw IP addresses, raw device identifiers, plaintext passwords, claim codes, transfer codes, recovery codes, registration tokens or session tokens.

A successful verification proves that ORBES issued and signed a code and what the registry says about it. It does not prove that the physical object carrying the code is genuine: a printed code can be copied (see [CRYPTOGRAPHY §7](CRYPTOGRAPHY.md#7-what-the-cryptography-does-not-prove)).

---

## 2. Engines, connection and value types

### 2.1 Engines

| Engine | Used for | `DATABASE_URL` |
|---|---|---|
| PostgreSQL (driver `pg`, `pg.Pool`) | Production | `postgres://user:pass@host:5432/db` or `postgresql://…` (Unix sockets via `?host=/path`) |
| PGlite (PostgreSQL compiled to WebAssembly, `@electric-sql/pglite`) | Development, tests, demo | `pglite:memory` (in memory, lost on exit) or `pglite:/absolute/data/dir` (persistent) |

- Without `DATABASE_URL`, development and test use `pglite:memory`. Production has no default.
- In production (`ORBES_ENV=production`, or `NODE_ENV=production` without `ORBES_ENV`), configuration loading refuses any `pglite:` URL.
- The PGlite engine is imported lazily, so a production process never loads it.
- The migration relies on `gen_random_uuid()` from the PostgreSQL core, available from PostgreSQL 13. The code does not check the server version.
- Error messages about the URL never echo it, and logs show it with the password masked (`redactDatabaseUrl`).

### 2.2 Value types

Both drivers are configured in `connection.ts` to return **the same JavaScript types**. Code that works on PGlite therefore behaves identically on PostgreSQL.

| PostgreSQL type | JavaScript value | Notes |
|---|---|---|
| `int8` / `bigint` (also `count(*)`) | `number` | Values beyond 2⁵³ come back as `BigInt` instead of being rounded. Every `bigint` column in this schema holds a value below 2³². |
| `date` | `string` `'YYYY-MM-DD'` | Never converted to a local-time `Date`, so no time-zone shift. |
| `bytea` | plain `Uint8Array` | Never a Node `Buffer` (pg buffers can be views on a shared pool slab, so they are copied). `toBytes()` normalises values that reach the code by other paths, including Postgres hex text `\x…`. |
| `timestamptz` | `Date` | |
| `jsonb` | parsed JSON on read | **Written as JSON text.** Services pass `jsonText(value)`, never a JS object or array: `pg` would serialise a top-level JS array as a Postgres array literal. `jsonText` rejects non-finite numbers, `BigInt` and NUL characters. |
| `smallint[]`, `text[]` | `number[]`, `string[]` | |
| `char(1)`, `char(2)` | `string` | Serialisers `trim()` these values defensively. |

`schema.ts` mirrors the migration column for column (snake_case, no camel-case plugin). Its enumeration constants are the exact value sets of the `CHECK` constraints; `test/db/schema.test.ts` asserts that they match.

### 2.3 PostgreSQL pool settings

| Setting | Value |
|---|---|
| Maximum pool size | 10 (`poolMax` option) |
| `statement_timeout` | 30 s (`statementTimeoutMs` option; 0 disables) |
| Idle client timeout | 30 s |
| Connection timeout | 10 s |
| `application_name` | `orbes-genome` |

Connections open lazily on the first query. Errors of idle pool clients are logged (message and SQLSTATE only, never query parameters) instead of crashing the process.

PGlite has a **single connection**. Kysely serialises access to it, which is why every query inside a transaction must go through the transaction object (§8).

### 2.4 SQLSTATE codes the application recognises

`pg-errors.ts` reads the SQLSTATE identically from both drivers.

| SQLSTATE | Meaning in this schema |
|---|---|
| `23505` | Unique violation (including the partial unique indexes) |
| `23503` | Foreign key violation (missing referenced row) |
| `23001` | Restrict violation: delete of a row still referenced (every FK is `ON DELETE RESTRICT`) |
| `23514` | `CHECK` violation |
| `23502` | `NOT NULL` violation |
| **`OR001`** | **Custom: raised by the schema's guard triggers** (immutable columns, append-only audit log, undeletable categories, immutable genomes) |
| `40001`, `40P01` | Serialisation failure, deadlock (retryable; issuance retries them) |
| `P0001` | Generic `RAISE EXCEPTION` (not used by the schema) |

`OR001` was chosen so a blocked mutation can be told apart from a constraint failure; `23001` was not usable because PostgreSQL already raises it for `ON DELETE RESTRICT`.

---

## 3. Schema conventions

- **Identifiers:** `uuid` primary keys generated by `gen_random_uuid()`, except `categories.id` (the 5-bit category index), `cryptographic_keys.key_id` (the 1-byte key id), `sessions.id_hash` and `scan_tokens.id_hash` (SHA-256 of a secret token), `audit_logs.id` (`bigserial`) and `scan_daily_stats` (its four keys, §5.24).
- **Time:** every timestamp is `timestamptz`. Calendar dates (`production_date`, warranty dates) are `date` and evaluated in UTC by the services.
- **Enumerations:** `text` columns with `CHECK (… IN (…))`, which are simpler to migrate than PostgreSQL enums.
- **Foreign keys:** every foreign key is `ON DELETE RESTRICT` and every foreign-key column is the leading column of an index (checked by `test/db/migrations.test.ts`).
- **Integrity guards** (defence in depth against application bugs and ad-hoc SQL), all raising SQLSTATE `OR001`:
  - `audit_logs` and `product_status_history` are append-only: `UPDATE`, `DELETE` and `TRUNCATE` are rejected;
  - `categories.id` and `categories.code` are immutable and categories are never deleted;
  - the cryptographic identity columns of `products`, `codes` and `cryptographic_keys` are immutable; `genomes` rows cannot be updated at all;
  - `genomes` and `cryptographic_keys` rows are never deleted (`DELETE` and `TRUNCATE` raise): a key id is a 1-byte value signed into every code and must never be reused.
- **Timestamps per table:** every row records when it came into being, named after what it records: `created_at` on most tables, `occurred_at` on `scan_events` and `audit_logs`, `started_at` on `ownership`, `opened_at` on `service_records`, `first_seen_at` on `anomalies`; `scan_daily_stats` records a day (`day`), not an instant. Lifecycle moments have their own columns (`activated_at`, `revoked_at`, `ended_at`, `used_at`, …).
- **`updated_at`:** only on the four tables with free-form mutable business data — `products`, `accounts`, `admin_users` and `warranties` — maintained by the trigger function `orbes_touch_updated_at()`. Services set `updated_at` from their injectable clock; when a statement leaves `updated_at` unchanged (including setting it to its current value), the trigger stamps `now()` (the transaction start time). **Clock mixing:** with a frozen or coarse injected clock, a second update at the same instant writes the old value again and therefore gets the database clock instead; compare `updated_at` with the injected clock only across distinct instants, and never order rows across tables by `updated_at`.
- **No business seed data.** The migration creates no categories, models, keys or users. Categories, collections and models are created through the admin API. The first admin is created at startup from `BOOTSTRAP_ADMIN_*`; the first signing key is created at startup in development and test, and through `POST /api/admin/keys/rotate` in production (§9.4).

### 3.1 Trigger functions

| Function | Behaviour |
|---|---|
| `orbes_touch_updated_at()` | `BEFORE UPDATE`, row level: if `NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at`, set `NEW.updated_at := now()`. |
| `orbes_reject_mutation(reason)` | Raises `'<OP> on <table> is not allowed (<reason>)'` with SQLSTATE `OR001`. Used row level (UPDATE/DELETE) and statement level (TRUNCATE). |
| `orbes_guard_immutable_columns(col, …)` | `BEFORE UPDATE`, row level: compares each listed column through `to_jsonb(OLD)` / `to_jsonb(NEW)` and raises `'<table>.<column> is immutable'` with SQLSTATE `OR001` on any difference. |

Triggers can be disabled by a table owner or superuser (`ALTER TABLE … DISABLE TRIGGER`). They protect against mistakes and an application-level compromise, not against a database administrator. See §11 for the recommended role separation.

---

## 4. Entity-relationship diagram

Solid lines are foreign keys. Dotted lines are logical references without a foreign key. The core chain is **product → genome → code (payload + Ed25519 signature, under a key) → scan event → authentication event**.

```mermaid
erDiagram
  CATEGORIES ||--o{ MODELS : "category_id"
  CATEGORIES ||--o{ PRODUCTS : "category_id"
  COLLECTIONS |o--o{ MODELS : "collection_id"
  COLLECTIONS |o--o{ PRODUCTS : "collection_id"
  MODELS ||--o{ PRODUCTS : "model_id"

  PRODUCTS ||--o{ PRODUCT_STATUS_HISTORY : "product_id"
  PRODUCTS ||--o{ GENOMES : "product_id"
  GENOMES ||--o{ CODES : "genome_id (uuid)"
  PRODUCTS ||--o{ CODES : "product_id"
  CRYPTOGRAPHIC_KEYS ||--o{ CODES : "key_id (signing key)"

  CODES |o--o{ SCAN_EVENTS : "code_id"
  PRODUCTS |o--o{ SCAN_EVENTS : "product_id"
  ACCOUNTS |o--o{ SCAN_EVENTS : "account_id"
  SCAN_EVENTS ||--o{ AUTHENTICATION_EVENTS : "scan_event_id"
  CODES |o--o{ AUTHENTICATION_EVENTS : "code_id"
  PRODUCTS |o--o{ AUTHENTICATION_EVENTS : "product_id"
  CRYPTOGRAPHIC_KEYS |o..o{ AUTHENTICATION_EVENTS : "key_id (no FK)"
  SCAN_EVENTS ||--o{ SCAN_TOKENS : "scan_event_id"
  SCAN_EVENTS ||--o| SCAN_REPORTS : "scan_event_id (unique)"
  ADMIN_USERS |o--o{ SCAN_REPORTS : "handled_by"
  SCAN_EVENTS }o..o{ SCAN_DAILY_STATS : "counted by day (no FK)"
  PRODUCTS ||--o{ SCAN_TOKENS : "product_id"

  PRODUCTS ||--o{ OWNERSHIP : "product_id"
  ACCOUNTS ||--o{ OWNERSHIP : "account_id"
  PRODUCTS ||--o{ OWNERSHIP_TRANSFERS : "product_id"
  ACCOUNTS ||--o{ OWNERSHIP_TRANSFERS : "from_account_id"
  ACCOUNTS |o--o{ OWNERSHIP_TRANSFERS : "to_account_id"
  PRODUCTS ||--o| WARRANTIES : "product_id (unique)"
  RETAILERS |o--o{ WARRANTIES : "retailer_id"
  ADMIN_USERS |o--o{ SCAN_EVENTS : "admin_id (ADMIN_TEST only)"
  PRODUCTS ||--o{ SERVICE_RECORDS : "product_id"

  PRODUCTS |o--o{ ANOMALIES : "product_id"
  CODES |o--o{ ANOMALIES : "code_id"
  PRODUCTS |o..o{ REVOCATIONS : "target_id when PRODUCT (no FK)"
  CODES |o..o{ REVOCATIONS : "target_id when CODE (no FK)"
  CRYPTOGRAPHIC_KEYS |o..o{ REVOCATIONS : "target_id when KEY (no FK)"

  ACCOUNTS ||--o{ ACCOUNT_RECOVERY_CODES : "account_id"
  ADMIN_USERS ||--o{ ACCOUNT_RECOVERY_CODES : "created_by"

  ACCOUNTS |o..o{ SESSIONS : "subject_id (no FK)"
  ADMIN_USERS |o..o{ SESSIONS : "subject_id (no FK)"
  AUDIT_LOGS |o..o| AUDIT_LOGS : "prev_hash = predecessor hash"

  PRODUCTS {
    uuid id PK
    text product_id UK "canonical, e.g. O26-J-00184"
    bigint packed_identity UK "u32"
    smallint category_id FK
    uuid model_id FK
    uuid collection_id FK "nullable"
    text status
    text ownership_state
  }
  GENOMES {
    uuid id PK
    uuid product_id FK
    smallint genome_version
    text genome_id "same text as products.product_id"
    bigint value "u32"
    text fingerprint UK "G1-XXXX-XXXX"
  }
  CRYPTOGRAPHIC_KEYS {
    smallint key_id PK "1..255"
    text kid UK
    bytea public_key UK "32 bytes, Ed25519"
    text status "ACTIVE | RETIRED | REVOKED"
  }
  CODES {
    uuid id PK
    uuid product_id FK
    uuid genome_id FK
    smallint key_id FK
    smallint issue "1..255"
    bytea payload "13 bytes, canonical"
    bytea signature "64 bytes, Ed25519 over payload"
    bytea payload_hash UK "SHA-256 of payload"
    text status "ACTIVE | SUPERSEDED | REVOKED"
  }
  SCAN_EVENTS {
    uuid id PK
    uuid code_id FK "nullable"
    uuid product_id FK "nullable"
    uuid account_id FK "nullable"
    text result_state
  }
  SCAN_DAILY_STATS {
    date day PK
    char country PK "ZZ when unknown"
    text result_state PK
    text event_type PK "VERIFY | REGISTER | TRANSFER"
    int n
  }
  AUTHENTICATION_EVENTS {
    uuid id PK
    uuid scan_event_id FK
    uuid code_id FK "nullable"
    uuid product_id FK "nullable"
    smallint key_id "no FK"
    boolean signature_valid
    text state
  }
```

Naming caveat: `genomes.genome_id` is **text** (the canonical product id, which is also the genome id), whereas `codes.genome_id` is a **uuid** foreign key to `genomes.id`.

---

## 5. Tables

Column tables use: **Null** = `NOT NULL` or `NULL`; **Default** = server default (— for none). Every `uuid` primary key defaults to `gen_random_uuid()`.

### 5.1 `categories`

Product categories and their **immutable 5-bit index**. The index is packed into every product identity, and therefore into every signed code and genome, so it can never change or be reused.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `smallint` | NOT NULL | — | PK. `CHECK (id BETWEEN 1 AND 31)`. Not generated: the application assigns the lowest free index. Immutable. |
| `code` | `char(1)` | NOT NULL | — | UNIQUE. `CHECK (code ~ '^[A-Z]$')`. Immutable. |
| `name` | `text` | NOT NULL | — | `CHECK (length(btrim(name)) BETWEEN 1 AND 200)`. The service limits names to 64 characters without control characters. |
| `warranty_months` | `int` | NOT NULL | `24` | `CHECK (warranty_months BETWEEN 0 AND 600)` |
| `active` | `boolean` | NOT NULL | `true` | Inactive categories still resolve (old products keep verifying) but cannot receive new products. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; unique `code`.
- **Triggers:** `categories_immutable_identity` (BEFORE UPDATE, guards `id`, `code`); `categories_no_delete` (BEFORE DELETE, rejects with "category indices are never released; deactivate instead"). Both raise `OR001`.
- **Written by:** `CategoryRegistry.create` (`POST /api/admin/categories`, ADMIN), under the `CATEGORY_ALLOCATION` advisory lock; audit action `category.create`. `CategoryRegistry.setActive` (`POST /api/admin/categories/:code/active`, ADMIN, A-10) locks the row and sets `active`, audited `category.activate` / `category.deactivate`; asking for the state it already has writes nothing.

### 5.2 `collections`

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `name` | `text` | NOT NULL | — | UNIQUE. `CHECK (length(btrim(name)) > 0)`. The API limits it to 100 characters. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Written by:** `CatalogService.createCollection` (`POST /api/admin/collections`, OPERATOR), which inserts the row and the audit entry `collection.create` in one transaction. `CatalogService.updateCollection` (`PATCH /api/admin/collections/:id`, OPERATOR, A-10) renames it under a row lock (`FOR UPDATE`), with the audit entry `collection.update` (the name before and after, and `issuedPieces`: the pieces whose public result names the collection, their own collection or else their model's) in the same transaction; the same name again writes nothing. No delete path exists.

### 5.3 `models`

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `collection_id` | `uuid` | NULL | — | FK → `collections.id`. The model's default collection. |
| `category_id` | `smallint` | NOT NULL | — | FK → `categories.id` |
| `name` | `text` | NOT NULL | — | Non-blank (e.g. `MONOLITHE`). |
| `type` | `text` | NOT NULL | — | Non-blank (e.g. `RING`). |
| `sku_prefix` | `text` | NOT NULL | — | UNIQUE, non-blank. The API upper-cases it and allows letters, digits, `.`, `_`, `-` (≤ 32 characters). |
| `default_material` | `text` | NULL | — | |
| `care_instructions` | `text` | NULL | — | Shown to the public as `product.care` in verification results. |
| `active` | `boolean` | NOT NULL | `true` | Migration `0010_models_active`. Offered for new products: an inactive model is hidden by the generator and refused by `IssuanceService.issueProduct` (`409 MODEL_INACTIVE`); its pieces verify as before. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; unique `sku_prefix`; `models_collection_id_idx (collection_id)`; `models_category_id_idx (category_id)`.
- **Triggers:** `models_immutable_identity` (BEFORE UPDATE, guards `id`, `category_id`, `sku_prefix`, `created_at`; migration `0010_models_active`), raising `OR001`: the category is in the identity of every piece issued with the model, the SKU prefix starts every SKU issued with it.
- **Written by:** `CatalogService.createModel` (`POST /api/admin/models`, OPERATOR), insert plus audit `model.create` in one transaction. `CatalogService.updateModel` (`PATCH /api/admin/models/:id`, OPERATOR, A-10) changes `name`, `default_material`, `care_instructions`, `collection_id` and `active`, never the category nor the SKU prefix (400, and the trigger above), under a row lock (`FOR UPDATE`), with the audit entry `model.update` (the changed fields before and after, and `issuedPieces`: the products of the model) in the same transaction; a change that changes nothing writes nothing. The name, `type`, care instructions and collection are read live by every public result of the model's pieces ([API §9.2](API.md#92-response)). No delete path exists.

### 5.4 `products`

One row per issued product. The identity columns are fixed at issuance and guarded by a trigger.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Immutable. |
| `product_id` | `text` | NOT NULL | — | UNIQUE. Canonical id `O{YY}-{C}-{NNNNN}`, `CHECK (product_id ~ '^O[0-9]{2}-[A-Z]-([0-9]{5}|[1-9][0-9]{5})$')`. Immutable. |
| `packed_identity` | `bigint` | NOT NULL | — | UNIQUE. `CHECK (BETWEEN 0 AND 4294967295)`. The u32 packed identity carried in the code payload. Immutable. |
| `year` | `smallint` | NOT NULL | — | `CHECK (year BETWEEN 2000 AND 2099)`. Immutable. |
| `category_id` | `smallint` | NOT NULL | — | FK → `categories.id`. Immutable. |
| `serial` | `int` | NOT NULL | — | `CHECK (serial BETWEEN 1 AND 999999)`. Immutable. |
| `sku` | `text` | NOT NULL | — | Non-blank. Defaults (in the service) to the model's `sku_prefix` plus a slug of the variant, e.g. `MNL-RG-SIZE-52`. Not unique. |
| `model_id` | `uuid` | NOT NULL | — | FK → `models.id` |
| `collection_id` | `uuid` | NULL | — | FK → `collections.id`. When NULL, the model's collection applies (see §6). |
| `variant` | `text` | NULL | — | |
| `material` | `text` | NOT NULL | — | |
| `production_batch` | `text` | NULL | — | |
| `production_date` | `date` | NULL | — | The service refuses dates after tomorrow (UTC). |
| `status` | `text` | NOT NULL | `'ISSUED'` | `CHECK` in the 12 product statuses (§7.1). |
| `ownership_state` | `text` | NOT NULL | `'UNREGISTERED'` | `CHECK (ownership_state IN ('UNREGISTERED','REGISTERED','OWNED','TRANSFER_PENDING'))` (§7.3). |
| `auth_policy` | `text` | NOT NULL | `'PRINTED_CODE'` | `CHECK (auth_policy ~ '^[A-Z][A-Z_]*(\+[A-Z][A-Z_]*)*$')`. The service accepts only combinations of `PRINTED_CODE`, `SECURE_NFC`, `SECURE_ELEMENT`, `TAMPER_EVIDENT` that include `PRINTED_CODE`. Hardware authenticators are not implemented. |
| `claim_secret_hash` | `text` | NULL | — | scrypt hash (`scrypt$15$8$1$<salt>$<hash>`) of the canonical 12-character claim code. NULL when the product was issued without a claim code. The code itself is shown once at issuance and never stored. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Immutable. |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Maintained by trigger unless set explicitly. |

Table constraints:

- `UNIQUE (year, category_id, serial)`.
- `products_packed_identity_consistent`: `packed_identity = ((year − 2000) << 25) | (category_id << 20) | serial`, the same packing as the core `packIdentity()` (7 + 5 + 20 bits).
- `products_product_id_consistent`: the two year digits of `product_id` equal `year − 2000` and its serial part equals `serial`. The category **letter** is not cross-checked against `category_id` by the database; the application derives it from the category registry.

- **Indexes:** primary key; unique `product_id`; unique `packed_identity`; unique `(year, category_id, serial)`; `products_category_id_idx`, `products_model_id_idx`, `products_collection_id_idx`, `products_status_idx`; `products_production_batch_idx` on `(production_batch)` (migration `0007_print_batch_indexes`), for the batch filters of the products and codes lists and a batch's print sheet ([API §14.1, §15.5, §15.9](API.md#155-get-apiadmincodes)).
- **Triggers:** `products_touch_updated_at`; `products_immutable_identity` guarding `id`, `product_id`, `packed_identity`, `year`, `category_id`, `serial`, `created_at` (`OR001`).
- **Written by:**
  - `IssuanceService.issueProduct` inserts the row (status `ISSUED`, ownership `UNREGISTERED`). The serial is `max(serial) + 1` per `(year, category)` under the `SERIAL_ALLOCATION` advisory lock, or an explicit serial.
  - `LifecycleService` updates `status` (and, for transitions made on behalf of other services, `ownership_state`) and `updated_at`.
  - `OwnershipService` updates `ownership_state` and `updated_at` directly when a transfer is initiated, cancelled or expires, and when ownership is confirmed.
  - No code path updates the descriptive columns (`sku`, `model_id`, `collection_id`, `variant`, `material`, `production_batch`, `production_date`, `auth_policy`, `claim_secret_hash`) after issuance, although the database would allow it.
- **Privacy:** no personal data.

### 5.5 `product_status_history`

Every status a product has held, oldest first. The lifecycle's "return to the previous status" rules are derived from this table (§7.2), so it is the source of truth for recoveries and reinstatements.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `from_status` | `text` | NULL | — | `CHECK` in product statuses. NULL only for the issuance row. |
| `to_status` | `text` | NOT NULL | — | `CHECK` in product statuses |
| `reason` | `text` | NULL | — | Free text (≤ 1 000 characters through the service). |
| `actor_type` | `text` | NOT NULL | — | `CHECK (actor_type IN ('admin','account','system'))` |
| `actor_id` | `text` | NULL | — | Admin or account uuid; NULL for the system. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | The service bumps it by 1 ms past the latest row when the clock has not moved, so the order per product is strict. |

- **Indexes:** primary key; `product_status_history_product_idx (product_id, created_at)`.
- **Triggers:** `product_status_history_append_only` (BEFORE UPDATE OR DELETE) and `product_status_history_no_truncate` reject every change with "product_status_history is append-only" (`OR001`, migration `0002_platform_guards`). Editing the history would change where a recovery or reinstatement leads.
- **Written by:** `IssuanceService` (the `NULL → ISSUED` row, reason `Product issued`) and `LifecycleService.apply` (every other change, in the same transaction as the status update and its audit entry).
- **Read for MY PIECES (F-01):** a piece is the owner's to find again (`OwnershipService.resolveIncident`, `POST /api/v1/ownership/incidents/resolve`, and `incidentResolvable` in `GET /api/v1/account/products`) only when the last row of its history moved it to `LOST` with `actor_type = 'account'` and `actor_id` the owner's account: the owner's own declaration. A `LOST` written by staff, or a `STOLEN`, is not. The withdrawal is a return move (§7.2) to the status before the loss. No schema change: F-01 has no migration.

### 5.6 `genomes`

The GENOME-01 visual identity of a product. It is a pure function of the signed identity and the genome version (see [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md)), so it is written once and never changes.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `genome_version` | `smallint` | NOT NULL | — | `CHECK (BETWEEN 1 AND 15)`. The service writes version 1. |
| `genome_id` | `text` | NOT NULL | — | The canonical product id string (the genome id equals the product id). |
| `value` | `bigint` | NOT NULL | — | `CHECK (BETWEEN 0 AND 4294967295)`: the permuted u32. |
| `glyphs` | `smallint[]` | NOT NULL | — | `CHECK`: one-dimensional, exactly 8 elements, no NULL, every element 0–15. |
| `pattern` | `text` | NOT NULL | — | Glyph ids joined by `·` (U+00B7), e.g. `POINT·HALF_ARC_E·…`. |
| `fingerprint` | `text` | NOT NULL | — | UNIQUE. `CHECK (fingerprint ~ '^G[0-9]{1,2}-[0-9A-F]{4}-[0-9A-F]{4}$')`, e.g. `G1-E1DC-BE52`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; unique `(product_id, genome_version)`; unique `(genome_version, value)`; unique `fingerprint`. The two last constraints restate the genome bijection as a database invariant.
- **Triggers:** `genomes_immutable` (BEFORE UPDATE) rejects every update with "genomes are immutable"; `genomes_no_delete` and `genomes_no_truncate` (migration `0002_platform_guards`) reject deletion with "genomes are permanent" (`OR001`), even for a genome no code references.
- **Written by:** `IssuanceService.issueProduct` only.

### 5.7 `cryptographic_keys`

The public registry of Ed25519 signing keys. Private keys stay with the key custody provider (`KeyProvider`: local encrypted files, or a KMS/HSM); only an opaque reference is stored.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `key_id` | `smallint` | NOT NULL | — | PK. `CHECK (key_id BETWEEN 1 AND 255)`. Allocated by `KeyService` as the lowest unused id; never reused. Carried in every code payload. Immutable. |
| `kid` | `text` | NOT NULL | — | UNIQUE, non-blank. Default label `orbes-k<NNN>-<yyyymmdd>-<4 hex>`; custom labels must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Immutable. |
| `algorithm` | `text` | NOT NULL | `'Ed25519'` | `CHECK (algorithm = 'Ed25519')`. Immutable. |
| `public_key` | `bytea` | NOT NULL | — | UNIQUE. `CHECK (octet_length(public_key) = 32)`. The service also refuses non-canonical and small-order points (`isStrictEd25519PublicKey`, the same rule verification applies). Immutable. |
| `status` | `text` | NOT NULL | — | `CHECK (status IN ('ACTIVE','RETIRED','REVOKED'))` |
| `provider` | `text` | NOT NULL | — | Custody provider name (`local`, `memory`). Immutable. |
| `provider_ref` | `text` | NOT NULL | — | Opaque provider reference (file name, KMS key reference). **Never a secret.** Immutable. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Immutable. |
| `activated_at` | `timestamptz` | NULL | — | |
| `retired_at` | `timestamptz` | NULL | — | |
| `revoked_at` | `timestamptz` | NULL | — | |
| `compromised_at` | `timestamptz` | NULL | — | When set on a REVOKED key, codes whose `codes.created_at` is **strictly before** it stay trusted; without it the cut-off is `revoked_at`. |
| `revocation_reason` | `text` | NULL | — | |

| Status | Signs new codes | Verifies codes |
|---|---|---|
| `ACTIVE` | Yes. At most one row, enforced by the partial unique index. | Yes |
| `RETIRED` | No | Yes |
| `REVOKED` | No | Only codes recorded before the cut-off (`compromised_at`, else `revoked_at`). Otherwise the result is `INVALID_SIGNATURE`. |

- **Indexes:** primary key; unique `kid`; unique `public_key`; `cryptographic_keys_single_active`: unique `(status) WHERE status = 'ACTIVE'`.
- **Triggers:** `cryptographic_keys_immutable_identity` guards `key_id`, `kid`, `algorithm`, `public_key`, `provider`, `provider_ref`, `created_at` (`OR001`). `cryptographic_keys_no_delete` and `cryptographic_keys_no_truncate` (migration `0002_platform_guards`) reject deletion ("key ids are never reused; retire or revoke the key instead"): a deleted row would let `KeyService` allocate its id to a new key, and every code carrying that id would then be judged against the wrong public key.
- **Written by:** `KeyService` under the `KEY_ROTATION` advisory lock: `rotate` / `ensureActiveKey` (insert ACTIVE; the previous ACTIVE row becomes RETIRED first), `retire`, `revoke` (also inserts a `revocations` row), and a repeated `revoke` that may only move `compromised_at` earlier. Audit actions `key.rotate`, `key.retire`, `key.revoke`, `key.revoke.amend`. Rows are never deleted.

### 5.8 `codes`

Every ORBES CODE ever signed. The `payload` and `signature` are exactly what is printed; `payload ‖ signature ‖ CRC-16` is the 79-byte framed data a scanner reads (see [CRYPTOGRAPHY §3–4](CRYPTOGRAPHY.md#3-canonical-payload-code-01)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Immutable. |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id`. Immutable. |
| `genome_id` | `uuid` | NOT NULL | — | FK → `genomes.id`. Immutable. |
| `key_id` | `smallint` | NOT NULL | — | FK → `cryptographic_keys.key_id`: the key that signed the code. Immutable. |
| `code_version` | `smallint` | NOT NULL | — | `CHECK (BETWEEN 1 AND 8)`. The service writes 1 (CODE-01). Immutable. |
| `issue` | `smallint` | NOT NULL | — | `CHECK (BETWEEN 1 AND 255)`. 1 at issuance, +1 per re-issue. Immutable. |
| `issued_day` | `int` | NOT NULL | — | `CHECK (BETWEEN 0 AND 65535)`. Days since 2024-01-01 UTC, as in the payload. Immutable. |
| `nonce` | `bytea` | NOT NULL | — | `CHECK (octet_length = 4)`. Random per code. Immutable. |
| `payload` | `bytea` | NOT NULL | — | `CHECK (octet_length = 13)`. Canonical CODE-01 payload. Immutable. |
| `signature` | `bytea` | NOT NULL | — | `CHECK (octet_length = 64)`. Ed25519 over `"ORBES-CODE/v1" ‖ 0x00 ‖ payload`, verified against the registered public key before insertion. Immutable. |
| `payload_hash` | `bytea` | NOT NULL | — | UNIQUE. `CHECK (octet_length = 32)`. SHA-256 of `payload`. Immutable. |
| `status` | `text` | NOT NULL | `'ACTIVE'` | `CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED'))` |
| `revoked_at` | `timestamptz` | NULL | — | Set for SUPERSEDED and REVOKED codes. |
| `revocation_reason` | `text` | NULL | — | The re-issue reason (SUPERSEDED) or the revocation reason (REVOKED). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Compared with a revoked key's cut-off. Immutable. |

| Code status | Set by | Verification result |
|---|---|---|
| `ACTIVE` | Issuance and re-issue | Normal decision procedure |
| `SUPERSEDED` | `IssuanceService.reissueCode`: the previous ACTIVE code, before the new one is inserted | `REVOKED` |
| `REVOKED` | Code revocation (`POST /api/admin/codes/:codeId/revoke` or `POST /api/admin/revocations` with `CODE`) | `REVOKED` |

- **Indexes:** primary key; unique `(product_id, issue)`; unique `payload_hash`; `codes_single_active_per_product`: unique `(product_id) WHERE status = 'ACTIVE'`; `codes_genome_id_idx`; `codes_key_id_idx`; `codes_created_at_idx` on `(created_at)` (migration `0007_print_batch_indexes`), for the codes list's issue-day filters and its newest-first order.
- **Triggers:** `codes_immutable_identity` guards every column except `status`, `revoked_at` and `revocation_reason` (`OR001`).
- **Written by:** `IssuanceService` (`issueProduct`, `reissueCode`, `revokeCode`; audit `product.issue`, `code.reissue`, `code.revoke`; a revocation also inserts a `revocations` row). `issueBatch` (API §14.11) calls `issueProduct` once per piece, each in its own transaction, and then audits `product.issue_batch`: no schema change, A-07 needs no migration. Before an artifact is rendered, the stored row is re-verified end to end (payload fields, hash, genome, key trust, signature); a tampered row is refused.

### 5.9 `accounts`

Customer accounts.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `email` | `text` | NOT NULL | — | As entered (trimmed, NFC). |
| `email_normalized` | `text` | NOT NULL | — | UNIQUE. Lower-cased `email`: the lookup key. |
| `password_hash` | `text` | NOT NULL | — | scrypt, `scrypt$15$8$1$<salt>$<hash>`. Re-hashed on login when parameters change. |
| `display_name` | `text` | NULL | — | ≤ 80 characters, no control characters or `<` `>`. |
| `country` | `char(2)` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. Optional `country` of the registration body (ISO 3166-1 alpha-2, stored upper case). |
| `status` | `text` | NOT NULL | `'ACTIVE'` | `CHECK (status IN ('ACTIVE','LOCKED','DELETED'))`. Only ACTIVE accounts can log in or use a session. LOCKED is set and cleared by ORBES Client Services (A-06, `POST /api/admin/owners/:id/lock` and `/unlock`); no code path sets DELETED in this version. |
| `failed_logins` | `int` | NOT NULL | `0` | `CHECK (failed_logins >= 0)`. Wrong passwords in the current throttle window (migration `0002_platform_guards`). From 10 within 15 minutes, logins to the account are refused with the generic `INVALID_CREDENTIALS` until the window ends; reset to 0 by a successful login. |
| `failed_logins_since` | `timestamptz` | NULL | — | Start of the throttle window (the first failure); NULL when there is none. A failure after the window has ended starts a new one. |
| `transfers_frozen_until` | `timestamptz` | NULL | — | Migration `0005_account_recovery`. Set to now + 72 hours by an assisted recovery of the password (§5.23): until then `OwnershipService.initiateTransfer` refuses new transfers out of the account (`409 TRANSFERS_PAUSED`). NULL when no recovery happened; a past value has no effect. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Trigger-maintained. |

- **Indexes:** primary key; unique `email_normalized`.
- **Triggers:** `accounts_touch_updated_at`.
- **Written by:** `AuthService.registerAccount` (audit `account.register`), `AuthService.login` (password re-hash; throttle counter, audit `account.login_failed` with `failedLogins`, `account.login_throttled`), `AuthService.changePassword` (`POST /api/v1/account/password`; a wrong current password counts in the throttle, `account.login_failed` with `via: "password_change"`; audit `account.password_change`), `AccountRecoveryService.recover` (`POST /api/v1/account/recover`: the new password, the throttle cleared and `transfers_frozen_until`, in the transaction that uses the recovery code; audit `account.recover`), `OwnerService.lock` and `unlock` (`services/owners.ts`, A-06: `status` LOCKED, in one transaction with every session of the account deleted, its pending transfers cancelled, §5.13, and its open recovery code revoked, §5.23; audit `account.lock` with `{ sessionsRevoked, transfersCancelled, recoveryCodesRevoked }`; back to ACTIVE, audit `account.unlock`). `AuthService.login` reads the account's status and password hash again `FOR NO KEY UPDATE` in the transaction that opens the session, so a sign-in whose password check was under way when a lock, a recovery or a password change committed is refused, and a re-hash is written only over the hash that was checked; `AuthService.changePassword` does the same before it writes the new hash (§8.2). A-06 needs no schema change: the LOCKED status exists since migration `0001_initial`, the owner's sheet reads `ownership` (index on `account_id`) and `scan_events` (index `scan_events_account_id_idx`), and a search by REF is a primary-key range scan of `scan_events.id`.
- **Privacy:** `email` and `display_name` are personal data. They are **never written to `audit_logs`**, whose entries name account ids only, so that an erasure request does not collide with the append-only log.

### 5.10 `admin_users`

Staff accounts for the admin console.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `email_normalized` | `text` | NOT NULL | — | UNIQUE |
| `email` | `text` | NOT NULL | — | |
| `password_hash` | `text` | NOT NULL | — | scrypt, as for accounts. |
| `role` | `text` | NOT NULL | — | `CHECK (role IN ('ADMIN','OPERATOR','AUDITOR','RETAIL'))`. RETAIL (migration `0008_retail_mode`, A-08): a seller, ranked under AUDITOR, who reaches the sale mode only (API §2.3). |
| `totp_secret_enc` | `text` | NULL | — | NULL until TOTP is enrolled. Sealed with AES-256-GCM (`v1.<iv>.<ciphertext‖tag>`, base64url) under a key derived by HKDF-SHA-256 from `KEY_ENCRYPTION_KEY` (or from `COOKIE_SECRET` when no key encryption key is configured), with the admin id as associated data. The plaintext holds the base32 secret and the last accepted time step (replay protection). |
| `failed_logins` | `int` | NOT NULL | `0` | `CHECK (failed_logins >= 0)`. Reset on a successful login. |
| `locked_until` | `timestamptz` | NULL | — | Set to now + 15 min when `failed_logins` reaches 10, and again on every further failure. |
| `disabled_at` | `timestamptz` | NULL | — | A disabled admin cannot log in and its sessions stop working. Set and cleared by `AuthService.setAdminDisabled` (the console's Team page, `scripts/admin.ts disable` / `enable`), which deletes the admin's sessions in the same transaction. |
| `password_change_required` | `boolean` | NOT NULL | `false` | Migration `0006_admin_password_change_required`. True for a staff account created from the console with a temporary password (`AuthService.createStaff`); the guard then refuses every admin route but logout, `me` and the password change (`403 PASSWORD_CHANGE_REQUIRED`, API §2.4). Cleared by `changePassword`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Trigger-maintained. |

- **Indexes:** primary key; unique `email_normalized`.
- **Triggers:** `admin_users_touch_updated_at`.
- **Written by:** `AuthService`: `createAdmin` (the first-run bootstrap from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`, and `scripts/admin.ts create`; any role), `createStaff` (`POST /api/admin/admins`, ADMIN: OPERATOR, AUDITOR or RETAIL with a temporary password, `password_change_required = true`), `adminLogin` and its failure counter, `enableTotp`, `disableTotp`, `changePassword` (`POST /api/admin/auth/password`: new hash, `password_change_required = false`, counter reset; a wrong current password counts as a failure), `setAdminRole`, `setAdminDisabled` and `unlockAdmin` (the Team routes, API §17.9–§17.11, and `scripts/admin.ts role` / `disable` / `enable`). `setAdminRole` and `setAdminDisabled` run under the `ADMIN_ROSTER` advisory lock (§8.3) and refuse to leave no active ADMIN (`LAST_ADMIN`). Audit actions `admin.create`, `admin.login`, `admin.login_failed`, `admin.logout`, `admin.password_change`, `admin.role_change`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.sessions_revoke`, `admin.totp.enable`, `admin.totp.disable`; a password, temporary or not, never enters the log.

### 5.11 `sessions`

Server-side login sessions for both customers and admins.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id_hash` | `bytea` | NOT NULL | — | PK. `CHECK (octet_length = 32)`. SHA-256 of the 32-byte random token held in the cookie. The token itself is never stored. |
| `subject_type` | `text` | NOT NULL | — | `CHECK (subject_type IN ('account','admin'))` |
| `subject_id` | `uuid` | NOT NULL | — | `accounts.id` or `admin_users.id`. **No foreign key** (polymorphic). |
| `csrf_token` | `text` | NOT NULL | — | Per-session CSRF token (32 random bytes, base64url). |
| `mfa_passed` | `boolean` | NOT NULL | `false` | True when the admin session was opened with a TOTP code, or after TOTP enrolment on that session. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `expires_at` | `timestamptz` | NOT NULL | — | Absolute expiry: `SESSION_TTL_ACCOUNT_HOURS` (default 720) or `SESSION_TTL_ADMIN_HOURS` (default 8). No sliding renewal. |
| `last_seen_at` | `timestamptz` | NOT NULL | `now()` | Refreshed at most once per minute. |
| `ip_hash` | `text` | NULL | — | HMAC pseudonym of the client IP at login or registration (§5.16). |
| `user_agent` | `text` | NULL | — | The `User-Agent` header at login or registration, control characters removed, at most 256 characters. |

- **Indexes:** primary key; `sessions_subject_idx (subject_type, subject_id)`; `sessions_expires_at_idx (expires_at)`.
- **Written by:** `SessionService`. A login inserts a new row and deletes the session it replaces (session-fixation defence); at most 20 sessions per subject are kept (the oldest are deleted). Logout deletes the row. Expired rows are deleted when presented and by housekeeping (§10). Every session of a subject is deleted by a password change (except the caller's), a TOTP enrolment (except the session that enrolled, in the console; every one from the shell; audit `admin.totp.enable` with `sessionsRevoked`), a TOTP reset, and, for admins, by disabling the account or ending its sessions from the Team page (`AuthService.revokeAdminSessions`, audit `admin.sessions_revoke`). The Team page lists an admin's sessions (`SessionService.listForSubject`) without the token hash or the CSRF token.
- **Privacy:** `user_agent` is the only place a full user-agent string is stored. Sessions are short-lived and deleted on expiry.

### 5.12 `ownership`

Ownership periods. A product has at most one current owner (`ended_at IS NULL`).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` |
| `acquired_via` | `text` | NOT NULL | — | `CHECK (acquired_via IN ('FIRST_REGISTRATION','TRANSFER','RESALE','ADMIN'))`. The current code writes `FIRST_REGISTRATION` and `TRANSFER` only. |
| `verified` | `boolean` | NOT NULL | `false` | True when the claim code matched at first registration, or after client services confirmed the ownership. Carried over by a transfer. |
| `started_at` | `timestamptz` | NOT NULL | `now()` | |
| `ended_at` | `timestamptz` | NULL | — | `CHECK (ended_at IS NULL OR ended_at >= started_at)` |
| `ended_reason` | `text` | NULL | — | `TRANSFERRED_OUT` is the only value written today. |

- **Indexes:** primary key; `ownership_single_current`: unique `(product_id) WHERE ended_at IS NULL`; `ownership_product_id_idx (product_id, started_at)`; `ownership_account_id_idx (account_id)`.
- **Written by:** `OwnershipService`: `registerFirst` (insert; audit `ownership.register`), `acceptTransfer` (ends the current row, inserts the new one; audit `ownership.transfer.accept`), `confirmOwnership` (`verified = true`; audit `ownership.confirm`). Ownership never changes a product's cryptographic identity.

### 5.13 `ownership_transfers`

Transfer offers from the current owner to another account.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `from_account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` |
| `to_account_id` | `uuid` | NULL | — | FK → `accounts.id`. Set on acceptance. |
| `token_hash` | `bytea` | NOT NULL | — | UNIQUE. `CHECK (octet_length = 32)`. HMAC-SHA256 of the canonical 12-character transfer code under a server key derived with HKDF-SHA256 from `COOKIE_SECRET` (salt `ORBES`, info `orbes/transfer-code/v1`). Deterministic, so the lookup is a unique-index probe; keyed, so a leaked table cannot be brute-forced offline. The code (`XXXX-XXXX-XXXX`, 60 bits) is shown once to the sender. Rotating `COOKIE_SECRET` invalidates pending codes. |
| `status` | `text` | NOT NULL | `'PENDING'` | `CHECK (status IN ('PENDING','ACCEPTED','CANCELLED','EXPIRED'))` |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `expires_at` | `timestamptz` | NOT NULL | — | Creation + 7 days. |
| `completed_at` | `timestamptz` | NULL | — | Time of acceptance, cancellation or expiry. |

- **Indexes:** primary key; unique `token_hash`; `ownership_transfers_single_pending`: unique `(product_id) WHERE status = 'PENDING'`; indexes on `product_id`, `from_account_id`, `to_account_id`.
- **Written by:** `OwnershipService`: `initiateTransfer` (audit `ownership.transfer.initiate`; refused while the account's `transfers_frozen_until` is in the future), `acceptTransfer` (for the piece the recipient scanned only, using up the `TRANSFER_ACCEPT` scan token of that scan in the same transaction, §5.17, F-03), `cancelTransfer` (audit `ownership.transfer.cancel`), `cancelPendingTransfersFrom` (every PENDING transfer offered by an account, when its password is recovered, §5.23, or when ORBES Client Services locks it, §5.9; it locks the products in product order and cancels each transfer, then records one `ownership.transfer.cancel` per transfer with `reason: "account_recovery"` or `"account_locked"`, so no row is locked after the audit chain's lock, §8.3), `reportIncident` (cancels a pending transfer), and expiry (`EXPIRED`, audit `ownership.transfer.expire` by the system actor), which runs lazily when a product is touched and in housekeeping. A PENDING row past `expires_at` is reported as EXPIRED by the read APIs even before it is rewritten.

### 5.14 `warranties`

At most one warranty per product. The row is created at issuance with the category's duration and no dates; activation fills the dates.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | UNIQUE. FK → `products.id` |
| `purchase_date` | `date` | NULL | — | |
| `retailer` | `text` | NULL | — | ≤ 200 characters. Free text of the activations made before the register (and of API callers that still send it); the console sends `retailer_id` instead. |
| `retailer_id` | `uuid` | NULL | — | Migration `0008_retail_mode`. FK → `retailers.id` (§5.25): the point of sale chosen from the register. The name shown (`WarrantyRecord.retailer`) is the register's current name when set, the free text otherwise. |
| `country` | `char(2)` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. Defaults to the point of sale's country at activation. |
| `start_date` | `date` | NULL | — | Equals the purchase date. NULL until activation. |
| `duration_months` | `int` | NOT NULL | — | `CHECK (BETWEEN 0 AND 1200)`. Copied from `categories.warranty_months`. |
| `end_date` | `date` | NULL | — | Start + duration in calendar months, clamped to the end of the month (2026-01-31 + 1 month = 2026-02-28). Coverage includes the end date. |
| `voided_at` | `timestamptz` | NULL | — | |
| `void_reason` | `text` | NULL | — | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Trigger-maintained. |

Table constraint: `CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)`.

**Warranty status is computed, never stored** (UTC calendar date `today`):

| Status | Rule (first match) |
|---|---|
| `VOID` | `voided_at` is set |
| `NOT_STARTED` | no warranty row, or `start_date` is NULL or after today |
| `EXPIRED` | `duration_months = 0`, or `end_date` is before today |
| `ACTIVE` | otherwise |

- **Indexes:** primary key; unique `product_id`; `warranties_retailer_id_idx (retailer_id)`.
- **Triggers:** `warranties_touch_updated_at`.
- **Written by:** `IssuanceService.issueProduct` (insert); `WarrantyService.activate` (the console's product page, and the sale mode's `SaleService.activate` inside the transaction that uses its sale token up; audit `warranty.activate` with `retailer`, `retailerId` and, from the sale mode, `saleScanId`; the point of sale is locked `FOR SHARE` so it cannot be deactivated meanwhile; an ISSUED product moves to ACTIVATED in the same transaction), `void` (audit `warranty.void`; inserts the row if none exists) and `extend` (audit `warranty.extend`; service only, no HTTP route).
- **Privacy:** `retailer` and `country` describe the point of sale, not the customer.

### 5.15 `service_records`

After-sales service operations.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `type` | `text` | NOT NULL | — | `CHECK (type IN ('INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION'))` |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK (status IN ('OPEN','COMPLETED','CANCELLED'))` |
| `location` | `text` | NULL | — | ≤ 200 characters. Visible to the owner. |
| `notes` | `text` | NULL | — | ≤ 4 000 characters. Internal: never shown to owners. Closing notes are appended. |
| `opened_at` | `timestamptz` | NOT NULL | `now()` | |
| `closed_at` | `timestamptz` | NULL | — | `CHECK (closed_at IS NULL OR closed_at >= opened_at)` |
| `performed_by` | `text` | NULL | — | Workshop or technician; defaults to the acting user's label (e.g. `admin:<uuid>`). Internal. |

- **Indexes:** primary key; `service_records_product_id_idx (product_id, opened_at)`.
- **Written by:** `WarrantyService.openService` (moves the product to SERVICED; audit `service.open`), `completeService` (audit `service.complete`) and `cancelService` (audit `service.cancel`; service only, no HTTP route). When the last open record of a SERVICED product closes, the product returns to its pre-service status.

### 5.16 `scan_events`

One row per processed verification request (`POST /api/v1/verify`), including requests whose code turned out to be malformed or invalid, and per staff scan of the sale mode (`POST /api/admin/sale/lookup`, A-08: `ADMIN_TEST`). A verification request that carries a console session is a staff scan too (S-07, API §9.7: `ADMIN_TEST`). Requests rejected before processing (request validation errors, oversized or non-JSON bodies, rate limiting) are not recorded.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Returned to the client as `scanId`. |
| `occurred_at` | `timestamptz` | NOT NULL | `now()` | |
| `code_id` | `uuid` | NULL | — | FK → `codes.id`. Set only when the scanned code matched the registry and its key was trusted. |
| `product_id` | `uuid` | NULL | — | FK → `products.id`. Set when the signature was valid and the signed identity resolved to a product. |
| `packed_identity` | `bigint` | NULL | — | `CHECK (BETWEEN 0 AND 4294967295)`. Set whenever the payload decoded. |
| `event_type` | `text` | NOT NULL | — | `CHECK (event_type IN ('VERIFY','REGISTER','TRANSFER','ADMIN_TEST'))`. The current code writes `VERIFY` (public scans) and `ADMIN_TEST` (staff scans: the sale mode, and `/api/v1/verify` with a console session, S-07); anomaly scoring and the daily statistics (§5.24) ignore `ADMIN_TEST`, and an `ADMIN_TEST` scan raises no history finding and no `UNSOLD_PIECE_SCAN`; a staff scan, of `/api/v1/verify` or of the sale mode, still records the code's own findings of steps 6–7 (`details.staffScan = true`). |
| `device_hash` | `text` | NULL | — | Device pseudonym (see Privacy). |
| `session_hash` | `text` | NULL | — | Session pseudonym, when the viewer was logged in. |
| `account_id` | `uuid` | NULL | — | FK → `accounts.id`: the logged-in viewer. |
| `admin_id` | `uuid` | NULL | — | Migration `0008_retail_mode`. FK → `admin_users.id`: the console user behind a staff scan. `scan_events_admin_id_admin_test CHECK (admin_id IS NULL OR event_type = 'ADMIN_TEST')`. A staff scan carries no device, session or account pseudonym. |
| `ip_hash` | `text` | NULL | — | IP pseudonym. |
| `country` | `char(2)` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. Only codes with a known centroid; pseudo-codes such as `XX` or `T1` are dropped. |
| `region` | `text` | NULL | — | ≤ 64 characters (Cloudflare `cf-region` in `cloudflare` geo mode). |
| `lat` | `real` | NULL | — | `CHECK (BETWEEN -90 AND 90)`. Rounded to 1 decimal place. |
| `lon` | `real` | NULL | — | `CHECK (BETWEEN -180 AND 180)`. Rounded to 1 decimal place; present only together with `lat`. |
| `user_agent_family` | `text` | NULL | — | Coarse `Browser/OS`, e.g. `Safari/iOS`, `Chrome/Android`, `Bot/Other`. No versions. |
| `client_metrics` | `jsonb` | NULL | — | Decoder metrics sent by the client (`rsErrors`, `rsErasures`, `moduleSizePx`, `decodeMs`, `source`). Informational; invalid values are dropped. |
| `result_state` | `text` | NOT NULL | — | The verification state (see [API §9.3](API.md#93-states-and-public-wording)). No `CHECK`: the row is inserted before the decision completes — with the state already decided by steps 1–8, or the provisional value `'PENDING'` while anomaly scoring and ownership (steps 9–10) still run — and updated to the final state in the same transaction, so `'PENDING'` is never visible after commit. |
| `latency_ms` | `int` | NULL | — | `CHECK (latency_ms >= 0)`. Server-side processing time. |

- **Indexes:** primary key; `scan_events_product_occurred_idx (product_id, occurred_at)`; `scan_events_code_occurred_idx (code_id, occurred_at)`; `scan_events_account_id_idx (account_id)`; `scan_events_admin_id_idx (admin_id)`; `scan_events_occurred_at_idx (occurred_at)`.
- **Written by:** `VerificationService.verify`, in one transaction with the matching `authentication_events` row, any anomaly findings and any scan token (a staff scan, S-07: `event_type = 'ADMIN_TEST'` with `admin_id` and without the device, session and account pseudonyms, no `UNSOLD_PIECE_SCAN` and no history finding, the findings of steps 6–7 (`VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH`, `GENOME_MISMATCH`) recorded as for any scan with `staffScan: true` in their details, no registration token; no migration: the 0008 columns and CHECK already allow it); and `VerificationService.staffScan` (the sale mode, A-08: steps 1–8 only, `event_type = 'ADMIN_TEST'` with `admin_id`; the findings of steps 6–7 recorded with `staffScan: true` as above, never a history finding or `UNSOLD_PIECE_SCAN`; its `authentication_events` row with the risk of that step 6–7 finding when there is one (60 for `GENOME_MISMATCH`, 100 for `CODE_MISMATCH` and `VALID_SIGNATURE_UNREGISTERED`) and 0 otherwise; and the sale token minted in the same transaction).
- **Privacy:**
  - **IP addresses and device ids are stored only as HMACs.** Each pseudonym is `base64url(HMAC-SHA-256(IP_HASH_PEPPER, "orbes/<domain>/v1" ‖ 0x00 ‖ value))` (43 characters), with domain `ip` (canonical client IP; IPv4-mapped IPv6 unwrapped, IPv6 not truncated), `device` (the random 128-bit id from the signed `orbes_device` cookie, `__Host-orbes_device` in production) or `session` (the session id, itself the SHA-256 of the session token). The domain label keeps the three kinds from colliding. Without the pepper the values cannot be linked back to an address or a cookie.
  - **Coordinates are coarse:** latitude and longitude are rounded to 0.1° (about 10 km) and are only recorded when the edge or a trusted proxy supplies them (`GEO_MODE=cloudflare`, or `headers` behind `TRUST_PROXY`), or when the server looks the client IP up in a local GeoIP database (`GEO_MODE=mmdb`, `TRUST_PROXY` required in production; the IP itself is never stored). `region` is filled only in `cloudflare` mode. With `GEO_MODE=none` (the default), no location is stored.
  - No raw user-agent string is stored here, only the family.
  - Retention: kept indefinitely unless `SCAN_RETENTION_DAYS` is set; then housekeeping deletes old scan events with everything attached to them, a customer's report (§5.22) included (§10), after counting every complete day into `scan_daily_stats` (§5.24), which keeps the trends and nothing about a scan.

### 5.17 `scan_tokens`

Single-use tokens that bind an action to a fresh, successful scan of that product: registration tokens (`FIRST_REGISTRATION`), minted by an `AUTHENTIC_FIRST_REGISTRATION` verification for the first registration; sale tokens (`SALE_ACTIVATION`, migration `0008_retail_mode`, A-08), minted by a staff scan of the sale mode for the warranty activation; and transfer tokens (`TRANSFER_ACCEPT`, migration `0011_scan_token_transfer_accept`, F-03), minted by the verification of a signed-in account that is not the owner of a piece whose transfer is pending, on an authentic result, for the acceptance of that transfer. A token of one purpose is refused for the others.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id_hash` | `bytea` | NOT NULL | — | PK. `CHECK (octet_length = 32)`. SHA-256 of the 32-byte token (the client receives the token, base64url, 43 characters). |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `scan_event_id` | `uuid` | NOT NULL | — | FK → `scan_events.id`: the scan that earned it. |
| `purpose` | `text` | NOT NULL | — | `CHECK (purpose IN ('FIRST_REGISTRATION','SALE_ACTIVATION','TRANSFER_ACCEPT'))` (`TRANSFER_ACCEPT`: migration `0011_scan_token_transfer_accept`) |
| `expires_at` | `timestamptz` | NOT NULL | — | Creation + 15 minutes (registration, transfer) or 10 minutes (sale). |
| `used_at` | `timestamptz` | NULL | — | Set by one conditional UPDATE, so two concurrent registrations cannot both consume it. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; `scan_tokens_product_id_idx`; `scan_tokens_scan_event_id_idx`.
- **Written by:** `createScanToken` (from `VerificationService`, registration and transfer tokens in the verification's transaction, and from `SaleService.lookup` inside the staff scan's transaction), `consumeScanToken` (from `OwnershipService.registerFirst`, inside the registration transaction; from `SaleService.activate`, inside the activation transaction, which also checks that the scan's `admin_id` is the caller; and from `OwnershipService.acceptTransfer`, inside the acceptance's transaction, for the transfer's piece, which also checks that the scan's `account_id` is the recipient: the binding to an account needs no column of its own, the scan event names it), `purgeScanTokens` (housekeeping deletes tokens that expired more than 24 hours ago, so "expired" stays distinguishable from "unknown" for a day).

### 5.18 `authentication_events`

The internal decision record for each scan event. Never exposed publicly; visible to admins in `GET /api/admin/scans`.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `scan_event_id` | `uuid` | NOT NULL | — | FK → `scan_events.id`. Exactly one authentication event is written per scan event. |
| `code_id` | `uuid` | NULL | — | FK → `codes.id`. Same rule as `scan_events.code_id`. |
| `product_id` | `uuid` | NULL | — | FK → `products.id` |
| `key_id` | `smallint` | NULL | — | `CHECK (BETWEEN 0 AND 255)`. The key id named by the payload. **No foreign key**, so unknown key ids are recorded too. |
| `signature_valid` | `boolean` | NOT NULL | — | Ed25519 signature valid under the named key. |
| `genome_check` | `text` | NOT NULL | — | `CHECK (genome_check IN ('MATCH','MISMATCH','NOT_PROVIDED','INCONCLUSIVE'))` |
| `state` | `text` | NOT NULL | — | `CHECK` in the 9 verification states. |
| `reasons` | `text[]` | NOT NULL | `'{}'` | Machine reasons, e.g. `MALFORMED:CRC`, `UNKNOWN_KEY`, `BAD_SIGNATURE`, `PRODUCT_NOT_REGISTERED`, `CODE_NOT_REGISTERED`, `CODE_MISMATCH`, `KEY_REVOKED`, `UNSUPPORTED_GENOME_VERSION`, `UNSUPPORTED_CODE_VERSION`, `GENOME_MISMATCH`, `CODE_SUPERSEDED`, `CODE_REVOKED`, `PRODUCT_<STATUS>`, `ANOMALY:<TYPE>`, `RISK_THRESHOLD`, `RISK_THRESHOLD_OWNER`, `REGISTRATION_WITH_CLAIM_CODE` (a registration token was issued on a scan that is suspicious from its history alone). |
| `risk_score` | `int` | NOT NULL | — | `CHECK (BETWEEN 0 AND 100)`. Internal. |
| `authenticators` | `jsonb` | NOT NULL | `'{}'` | Written as an object: `{ "policy", "assurance", "results": [{ "kind", "status", "detail"? }] }`, or `{ "policy": null, "results": [] }` when the policy was not evaluated. The default is the empty object (migration `0003_authentication_events_default`; `0001` declared `'[]'`), so every row holds the same JSON type. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; `authentication_events_scan_event_id_idx`; `authentication_events_code_id_idx`; `authentication_events_product_id_idx (product_id, created_at)`.
- **Written by:** `VerificationService.verify` (step 12 of the decision procedure) and `VerificationService.staffScan` (the sale mode's lookup, A-08: `risk_score` is the weight of its step 6–7 finding when there is one, 0 otherwise).

### 5.19 `anomalies`

Risk findings for human review. The system never revokes automatically.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NULL | — | FK → `products.id`. NULL for a validly signed identity that is not registered. |
| `code_id` | `uuid` | NULL | — | FK → `codes.id` |
| `type` | `text` | NOT NULL | — | `CHECK (type ~ '^[A-Z][A-Z0-9_]*$')`. Values written: `IMPOSSIBLE_TRAVEL`, `SCAN_VELOCITY`, `DEVICE_DIVERSITY`, `GEO_DISPERSION`, `LOST_STOLEN_SCAN`, `POST_REVOCATION_SCAN` (rules) and `GENOME_MISMATCH`, `CODE_MISMATCH`, `VALID_SIGNATURE_UNREGISTERED`, `UNSOLD_PIECE_SCAN` (verification; the last, S-07, with `risk_score` 0, once per product and UTC day). A new type needs no migration: the CHECK takes any upper-case name. |
| `severity` | `text` | NOT NULL | — | `CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'))` |
| `risk_score` | `int` | NOT NULL | — | `CHECK (BETWEEN 0 AND 100)`. Keeps its maximum across repeats. |
| `details` | `jsonb` | NOT NULL | `'{}'` | Finding details (latest occurrence), with `scanEventId`, the scan that raised it (every finding, rule or service level, since 2026-10-02). A verification finding recorded by a staff scan (S-07 on `/api/v1/verify`, A-08 in the sale mode) carries `staffScan: true`. |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED'))` |
| `occurrences` | `int` | NOT NULL | `1` | `CHECK (occurrences >= 1)` |
| `first_seen_at` | `timestamptz` | NOT NULL | `now()` | |
| `last_seen_at` | `timestamptz` | NOT NULL | `now()` | `CHECK (last_seen_at >= first_seen_at)` |
| `resolved_by` | `text` | NULL | — | Actor label, e.g. `admin:<uuid>`, for RESOLVED / DISMISSED. |
| `resolved_at` | `timestamptz` | NULL | — | |
| `resolution_note` | `text` | NULL | — | ≤ 2 000 characters. |

- **Indexes:** primary key; `anomalies_single_open_per_type`: unique `(product_id, type) WHERE status IN ('OPEN','ACKNOWLEDGED')` (a repeat finding increments `occurrences` instead of adding a row); `anomalies_status_severity_idx`; `anomalies_product_id_idx`; `anomalies_code_id_idx`.
- **Written by:** `AnomalyService.recordFinding` (called by `VerificationService`, from `verify` and, for the findings of steps 6–7, from `staffScan`; upsert on the partial unique index). `UNSOLD_PIECE_SCAN` (S-07, a piece ISSUED or in a pre-sale service whose warranty has not started) is recorded with `oncePerUtcDay`: nothing when a row of that product and type was last seen on the same UTC day, whatever its status (served by `anomalies_product_id_idx`), and the upsert's `DO UPDATE … WHERE last_seen_at < <day start>` keeps a concurrent first scan of the day from counting twice; its `occurrences` count days. Findings without a product cannot be deduplicated by the index (NULLs never conflict), so they are deduplicated by type and `details.packedIdentity` under a dedicated advisory lock (§8.3). `AnomalyService.updateStatus` (`PATCH /api/admin/anomalies/:id`; audit `anomaly.update`). Recording a finding is not audited.
- **Read by:** the console's triage (API §16.4, §16.14, §16.15): the list most severe first, the OPEN HIGH and CRITICAL count of its badge (`anomalies_status_severity_idx`), and a finding's scans in its window, read from `scan_events` by `(product_id, occurred_at)` (`scan_events_product_occurred_idx`), or by `packed_identity` within the window for a finding without a product. No schema change: A-04 needs no migration.
- **Confidentiality:** risk scores, rule details and thresholds are internal and never appear in public responses.

### 5.20 `revocations`

Register of revocations of codes, products and keys.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `target_type` | `text` | NOT NULL | — | `CHECK (target_type IN ('CODE','PRODUCT','KEY'))` |
| `target_id` | `text` | NOT NULL | — | `CODE`: `codes.id` (uuid). `PRODUCT`: the **canonical product id** (e.g. `O26-J-00184`), not the uuid. `KEY`: the key id in decimal (e.g. `"2"`). No foreign key. |
| `reason_code` | `text` | NOT NULL | — | `CODE_REVOKED`; `KEY_REVOKED` or `KEY_COMPROMISED` (when a compromise time was given); for products `ADMIN_DECISION`, or `COUNTERFEIT` / `LOST` / `STOLEN` when revoked from those statuses. |
| `reason` | `text` | NULL | — | Free text from the operator. |
| `created_by` | `text` | NOT NULL | — | Actor label, e.g. `admin:<uuid>` or `system`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `lifted_at` | `timestamptz` | NULL | — | Set for PRODUCT rows when the product is reinstated. Code and key revocations are never lifted. |
| `lifted_by` | `text` | NULL | — | |

- **Indexes:** primary key; `revocations_target_idx (target_type, target_id)`.
- **Written by:** `LifecycleService` (a transition to REVOKED inserts a PRODUCT row; reinstatement lifts it), `IssuanceService.revokeCode` (CODE), `KeyService.revoke` (KEY). A code superseded by re-issue gets no revocation row.

### 5.21 `audit_logs`

Append-only, hash-chained log of every mutation.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `bigserial` | NOT NULL | sequence | PK. Allocated explicitly (`nextval`) by `AuditService` under the chain lock, so ids follow chain order. |
| `occurred_at` | `timestamptz` | NOT NULL | — | No default: set by the service clock. |
| `actor_type` | `text` | NOT NULL | — | `CHECK (actor_type IN ('admin','account','system'))` |
| `actor_id` | `text` | NULL | — | Admin or account uuid; a label such as `bootstrap` for some system actions. |
| `action` | `text` | NOT NULL | — | `CHECK (length(action) BETWEEN 1 AND 200)`. Dotted lower-case verb, e.g. `product.issue`. |
| `target_type` | `text` | NULL | — | e.g. `product`, `code`, `key`, `category`, `collection`, `model`, `account`, `admin`, `anomaly`, `scan`. |
| `target_id` | `text` | NULL | — | Products are referenced by canonical id; codes, accounts, admins, anomalies and scans by uuid; keys by key id; categories by letter. |
| `details` | `jsonb` | NOT NULL | `'{}'` | JSON object, ≤ 64 KiB. Never secrets, raw IPs, private keys or customer PII. |
| `ip_hash` | `text` | NULL | — | HMAC pseudonym of the actor's IP (§5.16). |
| `prev_hash` | `bytea` | NOT NULL | — | `CHECK (octet_length = 32)`. Hash of the previous entry; 32 zero bytes for the first entry. |
| `hash` | `bytea` | NOT NULL | — | UNIQUE. `CHECK (octet_length = 32)`. |

Hash chain: `hash = SHA-256(prev_hash ‖ UTF-8(canonicalJSON(entry)))`, where `entry` is the stored row keyed by column name, `{ action, actor_id, actor_type, details, id, ip_hash, occurred_at, target_id, target_type }`, with keys sorted, no whitespace, `occurred_at` as ISO-8601 UTC with milliseconds and absent values as `null`. Because column names are used, an auditor can recompute the chain from a plain SQL export.

- **Indexes:** primary key; unique `hash`; `audit_logs_prev_hash_key`: unique `(prev_hash)` (each entry can be the predecessor of only one entry, so a forked chain fails at insert time); `audit_logs_occurred_at_idx`; `audit_logs_target_idx (target_type, target_id)`. No index on the actor: the one read by actor, the right-of-access export of an account (API §16.13, the entries it made as well as those about it), is a rare ADMIN request and reads the whole log.
- **Triggers:** `audit_logs_append_only` (BEFORE UPDATE OR DELETE, row level) and `audit_logs_no_truncate` (BEFORE TRUNCATE, statement level), both raising `OR001` with "audit_logs is append-only".
- **Written by:** `AuditService.record` only, under the `AUDIT_CHAIN` advisory lock, normally inside the transaction of the change it describes. `verifyChain()` (`GET /api/admin/audit/verify`) recomputes every hash and link; `head()` returns the newest id and hash for external anchoring. The chain detects edits and deletions inside the log, not the removal of the newest entries; anchor the head outside the database (§11).
- **Actions recorded:** `account.register`, `account.login`, `account.login_failed`, `account.logout`, `account.password_change`, `admin.create`, `admin.login`, `admin.login_failed`, `admin.logout`, `admin.password_change`, `admin.role_change`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.sessions_revoke`, `admin.totp.enable`, `admin.totp.disable`, `category.create`, `category.activate`, `category.deactivate`, `collection.create`, `collection.update`, `model.create`, `model.update`, `product.issue`, `product.issue_batch`, `product.transition`, `product.reinstate`, `code.reissue`, `code.revoke`, `code.render`, `code.render_sheet`, `code.sheet_manifest`, `certificate.render`, `certificate.render_refused`, `key.rotate`, `key.retire`, `key.revoke`, `key.revoke.amend`, `warranty.activate`, `warranty.void`, `warranty.extend`, `service.open`, `service.complete`, `service.cancel`, `ownership.register`, `ownership.claim_failed`, `ownership.transfer.initiate`, `ownership.transfer.accept`, `ownership.transfer.cancel`, `ownership.transfer.expire`, `ownership.confirm`, `ownership.incident`, `ownership.incident.resolve`, `anomaly.update`, `retailer.create`, `retailer.update`, `scan.report`, `scan.report.close`, `account.recovery_code.issue`, `account.recover`, `account.recover_failed`, `account.recover_throttled`, `account.lock`, `account.unlock`, `account.export`. Verifications themselves are recorded in `scan_events`, not in the audit log. `scan.report` and `scan.report.close` both target the scan (§5.22) and never carry the customer's words or the resolution note. The four `account.recover*` actions target the account (§5.23) and never carry the code or the email; neither do `account.lock`, `account.unlock` and `account.export` (A-06), which carry counts only.
- `ownership.claim_failed` entries double as the counter for the claim-code attempt limit (5 failures per product per rolling hour), so the limit holds across server instances and restarts. `account.recover_failed` entries do the same for the recovery-code limit (5 wrong guesses per code per rolling hour: the entries naming the open code, `details.recoveryCodeId`; §5.23).
- **Retention:** permanent. The application cannot delete entries.

### 5.22 `scan_reports`

A customer's report on a scan that was not authentic: where they saw or bought the piece (C-02; [API §8.5](API.md#85-post-apiv1reports)), and the **case** staff follow up in the console's Cases queue ([API §16.8](API.md#168-get-apiadminreports-extension-of-the-contract)). Migration `0004_scan_reports`.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. The case id. |
| `scan_event_id` | `uuid` | NOT NULL | — | UNIQUE, FK → `scan_events.id`: one report per scan. |
| `channel` | `text` | NOT NULL | — | `CHECK (channel IN ('BOUTIQUE','ONLINE','PRIVATE','OTHER'))` (`REPORT_CHANNELS`). |
| `place` | `text` | NULL | — | `CHECK (char_length BETWEEN 1 AND 200)`. Free text from the customer (the API field `where`): **personal data**. |
| `note` | `text` | NULL | — | `CHECK (char_length BETWEEN 1 AND 500)`. Free text from the customer: **personal data**. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK (status IN ('OPEN','CLOSED'))` (`REPORT_STATUSES`). |
| `handled_by` | `uuid` | NULL | — | FK → `admin_users.id`: the admin who closed the case. |
| `handled_at` | `timestamptz` | NULL | — | `CHECK (handled_at IS NULL OR handled_at >= created_at)`. |
| `resolution_note` | `text` | NULL | — | `CHECK (char_length BETWEEN 1 AND 2000)`. What was done, or why nothing was. |

- **`scan_reports_handled_consistent`:** an OPEN case has no `handled_by`, `handled_at` or `resolution_note`; a CLOSED case has `handled_by` and `handled_at`.
- **Indexes:** primary key; `scan_reports_scan_event_id_key` (unique `scan_event_id`, which leads with the foreign key); `scan_reports_handled_by_idx (handled_by)`; `scan_reports_status_created_idx (status, created_at)` (the queue).
- **Written by:** `ScanReportService.submit` (`POST /api/v1/reports`: a VERIFY scan whose result was not authentic, less than 24 hours old, no report yet; audit `scan.report`) and `ScanReportService.close` (`PATCH /api/admin/reports/:id`, OPERATOR: OPEN → CLOSED with a note; audit `scan.report.close`). `purgeScanHistory` deletes it with its scan (§10).
- **Read by:** the Cases queue (`GET /api/admin/reports`), the scans list (`report`) and the anomalies list (`reports`): an admin session only, never a public response.
- **Privacy:** `place` and `note` are the customer's own words. They live exactly as long as the scan they are attached to, open or closed, and are never copied into `audit_logs` (permanent), whose entries name the scan alone. The resolution note stays with the case for the same reason. The verify app asks the customer to leave out their name and contact details (SECURITY-MODEL §3.6).

### 5.23 `account_recovery_codes`

The one-time code with which a customer who forgot the password sets a new one (C-04; [API §10.8](API.md#108-post-apiv1accountrecover) and [§16.10](API.md#1610-post-apiadminownersidrecovery-code-extension-of-the-contract)). There is no email channel: ORBES Client Services checks the customer's identity, then an ADMIN issues the code in the console and reads it to the customer. Migration `0005_account_recovery`, with `accounts.transfers_frozen_until` (§5.9).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Named in the audit entries instead of the code. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` (`ON DELETE RESTRICT`). |
| `code_hash` | `text` | NOT NULL | — | `CHECK (code_hash LIKE 'scrypt$%')`. scrypt hash (`scrypt$15$8$1$<salt>$<hash>`, as for claim codes) of the canonical 12-character Crockford base32 code (60 bits). The code (`XXXX-XXXX-XXXX`) is in the issuing response only. |
| `created_by` | `uuid` | NOT NULL | — | FK → `admin_users.id` (`ON DELETE RESTRICT`): the ADMIN who issued it. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |
| `expires_at` | `timestamptz` | NOT NULL | — | `CHECK (expires_at > created_at)`. Creation + 30 minutes (`RECOVERY_CODE_TTL_MS`). |
| `used_at` | `timestamptz` | NULL | — | `CHECK (used_at IS NULL OR used_at >= created_at)`. Set by the recovery that used it. |
| `revoked_at` | `timestamptz` | NULL | — | `CHECK (revoked_at IS NULL OR revoked_at >= created_at)`. Set when a newer code is issued for the account, or when the account is locked while the code still works (A-06, §5.9). |

- **`account_recovery_codes_used_or_revoked`:** `CHECK (used_at IS NULL OR revoked_at IS NULL)`, never both.
- **Indexes:** primary key; `account_recovery_codes_single_open`: unique `(account_id) WHERE used_at IS NULL AND revoked_at IS NULL` (one open code per account); `account_recovery_codes_account_idx (account_id, created_at)` and `account_recovery_codes_created_by_idx (created_by)`, which lead with the foreign keys (the partial index does not serve the `RESTRICT` check on every row).
- **Written by:** `AccountRecoveryService` (`services/account-recovery.ts`). `issue` (`POST /api/admin/owners/:id/recovery-code`, ADMIN; an ACTIVE account only) locks the account row, revokes the open code and inserts the new one (audit `account.recovery_code.issue` with `{ recoveryCodeId, expiresAt, replaced }`). `recover` (`POST /api/v1/account/recover`) locks the account row and reads the open code. Without one, or once it has expired, the attempt is committed as `account.recover_failed` with its reason (`NO_OPEN_CODE`, `EXPIRED`) and does not count. Otherwise it counts the `account.recover_failed` entries of the last hour that name this code (`details->>'recoveryCodeId'`, read through the `audit_logs_target_idx` index on the account; at most 5; then `account.recover_throttled`, the code is not checked), and checks the code against its hash (a wrong guess is committed as `account.recover_failed` with `{ recoveryCodeId, attempt, reason: "MISMATCH" }` before the answer); then, in one transaction, it re-locks the account, sets `used_at` only if the code is still open, writes the new password, clears the login throttle, sets `transfers_frozen_until` to now + 72 hours, deletes every session of the account and cancels its pending transfers (§5.13), and records `account.recover`. A LOCKED account is refused and its code is not used. `OwnerService.lock` (A-06) revokes the account's open, unexpired code in the lock's transaction (counted as `recoveryCodesRevoked` in `account.lock`), so a code issued before a lock fails after the unlock.
- **Read by:** the owners list (`GET /api/admin/owners`: the expiry of the open code, never the hash).
- **Retention:** rows are kept, used, revoked or expired, as the record of each recovery beside its audit entries; they hold no code, only its hash. The account and the admin cannot be deleted while their codes exist (`RESTRICT`).
- **Concurrency:** two attempts with the same code are serialised by the account's row lock and the `used_at IS NULL` condition of the update: one recovery succeeds, the other is refused like a used code.

### 5.24 `scan_daily_stats`

The scans of each complete UTC day, counted by country, verification state and event type (migration `0009_scan_daily_stats`, recommendation A-09). Anonymous: the four keys and a count, no code, product, account, device, IP or session. Written before any scan is purged and never rewritten, so the trends survive `SCAN_RETENTION_DAYS` (§10); read by `GET /api/admin/analytics` ([API §16.16](API.md#1616-get-apiadminanalytics-extension-of-the-contract)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `day` | `date` | NOT NULL | — | The UTC day of `scan_events.occurred_at`. |
| `country` | `char(2)` | NOT NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. `scan_events.country`, `ZZ` when unknown. |
| `result_state` | `text` | NOT NULL | — | `CHECK` in the nine public verification states (`VERIFICATION_STATES`). |
| `event_type` | `text` | NOT NULL | — | `CHECK (event_type IN ('VERIFY','REGISTER','TRANSFER'))`: staff scans (`ADMIN_TEST`) are never counted. |
| `n` | `integer` | NOT NULL | — | `CHECK (n >= 0)`. The number of scans. |

- **Primary key:** `(day, country, result_state, event_type)`, which also serves every read (a range of days). No foreign key.
- **Written by:** `aggregateScanStats` (`src/server/services/scan-stats.ts`), the scan-statistics job of housekeeping (§10), `GET /api/admin/analytics` before it reads (the same idempotent pass, for the complete days no pass has counted yet), and once at the end of the demo seed. One `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE` counts the scans of the days after the latest day already counted, up to the last complete day (a day is complete ten minutes after midnight UTC, so a verification that began before midnight has committed). A day once counted is never counted again, so the purge of its scans cannot lower it; a pass repeated on the same days (two instances) writes the same values. A scan recorded with a time before the latest counted day (a clock set back) is not counted.
- **Read by:** `scanStatsReport` (`GET /api/admin/analytics`): at most 366 days per request. Its `through` (`countedThrough`) is the last day really counted: no watermark is stored (a day without scans writes no row), so it is the day before the first scan of a complete day that no pass has counted yet (`scan_events_occurred_at_idx`), else the last complete day.
- **Retention:** permanent; about 9 states × 3 types × the countries seen per day, at most a few thousand rows a year.

### 5.25 `retailers`

The register of points of sale (migration `0008_retail_mode`, A-08): boutiques, department stores, the online shop. A warranty names its point of sale by `warranties.retailer_id`, chosen from a list in the console (product page) and in the sale mode of a seller's phone, so one boutique is never spelt three ways.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `name` | `text` | NOT NULL | — | `CHECK (char_length BETWEEN 1 AND 120)`. As the client knows it. |
| `city` | `text` | NULL | — | `CHECK (NULL or char_length BETWEEN 1 AND 80)`. NULL for the online shop. |
| `country` | `char(2)` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. The default purchase country of its sales; NULL for the online shop (the country is then the buyer's, given at activation). |
| `active` | `boolean` | NOT NULL | `true` | An inactive point of sale leaves the lists and refuses new activations (`409 RETAILER_INACTIVE`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Trigger-maintained. |

- **Indexes:** primary key; `retailers_name_city_unique`: unique `(lower(name), lower(coalesce(city, '')))` (one point of sale per name and city, ignoring case: `409 RETAILER_EXISTS`).
- **Triggers:** `retailers_touch_updated_at`; `retailers_no_delete` (BEFORE DELETE, `OR001` "retailers are made inactive, never deleted": the warranties of its sales point to it).
- **Written by:** `RetailerService.create` and `update` (`POST` and `PATCH /api/admin/retailers`, ADMIN; audit `retailer.create`, `retailer.update` with the changed values before and after); the demo seed loads the boutiques of the demo maison. Read by every role down to RETAIL (`GET /api/admin/retailers`).
- **Privacy:** a point of sale is a business, not a person.

---

## 6. The `product_overview` view

A read-only, flat view of each product for admin lists and exports (`GET /api/admin/products`). One row per product.

```sql
FROM products p
JOIN categories c ON c.id = p.category_id
JOIN models m ON m.id = p.model_id
LEFT JOIN collections col ON col.id = COALESCE(p.collection_id, m.collection_id)
LEFT JOIN LATERAL (SELECT … FROM genomes WHERE product_id = p.id ORDER BY genome_version DESC LIMIT 1) g ON true
LEFT JOIN codes ac ON ac.product_id = p.id AND ac.status = 'ACTIVE'
LEFT JOIN warranties w ON w.product_id = p.id
```

| Column | Source | Null when |
|---|---|---|
| `id` | `products.id` | — |
| `product_id` | `products.product_id` | — |
| `packed_identity` | `products.packed_identity` | — |
| `sku` | `products.sku` | — |
| `category_id` | `products.category_id` | — |
| `category_code` | `categories.code` | — |
| `category` | `categories.name` | — |
| `collection` | `collections.name` of `COALESCE(products.collection_id, models.collection_id)`: the product's own collection wins over the model's default | neither is set |
| `model` | `models.name` | — |
| `model_type` | `models.type` | — |
| `variant` | `products.variant` | not set |
| `material` | `products.material` | — |
| `production_batch` | `products.production_batch` | not set |
| `production_date` | `products.production_date` | not set |
| `genome_id` | `genomes.genome_id` of the highest `genome_version` (text, the canonical id) | no genome |
| `genome_version` | `genomes.genome_version` (same row) | no genome |
| `genome_pattern` | `genomes.pattern` (same row) | no genome |
| `genome_fingerprint` | `genomes.fingerprint` (same row) | no genome |
| `code_id` | `codes.id` of the ACTIVE code | no ACTIVE code (e.g. after the code was revoked) |
| `code_version` | `codes.code_version` of the ACTIVE code | no ACTIVE code |
| `code_issue` | `codes.issue` of the ACTIVE code | no ACTIVE code |
| `status` | `products.status` | — |
| `warranty_start` | `warranties.start_date` | not activated |
| `warranty_end` | `warranties.end_date` | not activated |
| `ownership_state` | `products.ownership_state` | — |
| `created_at` | `products.created_at` | — |
| `updated_at` | `products.updated_at` | — |

The view does not compute the warranty status; services compute it from the warranty row (§5.14).

---

## 7. Product lifecycle

The state machine is data (`TRANSITIONS` in `services/lifecycle.ts`). Every change locks the product row, updates `products.status`, appends `product_status_history` and writes an audit entry in one transaction. A move to REVOKED also inserts a `revocations` row.

### 7.1 Statuses

| Status | Meaning | Entered through | Public verification result |
|---|---|---|---|
| `ISSUED` | Code signed, not yet sold | Issuance (`IssuanceService.issueProduct`) | `AUTHENTIC` |
| `ACTIVATED` | Sold; warranty started | Warranty activation (from ISSUED), admin transition | Unowned: `AUTHENTIC_FIRST_REGISTRATION` |
| `REGISTERED` | Registered to an owner without proof (no claim code) | First registration without a claim code, admin transition | Owned: `AUTHENTIC_REGISTERED` / `AUTHENTIC_OWNERSHIP_VERIFIED` |
| `OWNED` | Registered with proof (claim code, or confirmed by client services) | First registration with claim code, ownership confirmation, admin transition | as above |
| `TRANSFERRED` | Changed hands through an accepted transfer | Transfer acceptance, admin transition | as above |
| `SERVICED` | In service: after-sales, or a pre-sale inspection / quality control (entered from ISSUED) | Opening a service record, admin transition | Unowned after sale: `AUTHENTIC_FIRST_REGISTRATION`; owned: as above. A pre-sale service is not open for first registration. |
| `RESOLD` | Resold through a channel | Admin transition only | Unowned: `AUTHENTIC_FIRST_REGISTRATION`; owned: as above |
| `RETIRED` | Out of circulation (terminal) | Admin transition | `REVOKED` |
| `REVOKED` | Identity revoked | Admin transition (ADMIN role) or revocation | `REVOKED` |
| `COUNTERFEIT_FLAGGED` | Under counterfeit investigation | Admin transition | `REVOKED` |
| `LOST` | Reported lost | Owner incident report, admin transition | `SUSPICIOUS_ACTIVITY` |
| `STOLEN` | Reported stolen | Owner incident report, admin transition | `SUSPICIOUS_ACTIVITY` |

The verification column assumes the code itself is valid and ACTIVE. Whatever the status, an anomaly risk score at or above the configured threshold turns an authentic result into `SUSPICIOUS_ACTIVITY` (for the logged-in current owner: `AUTHENTIC_OWNERSHIP_VERIFIED` with an `UNUSUAL_ACTIVITY` notice). See [API](API.md) for the full decision procedure.

Further effects: codes cannot be rendered for printing while the product is RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN; a product that is RETIRED or REVOKED cannot receive a new code.

### 7.2 Transitions

| From | Allowed next statuses |
|---|---|
| `ISSUED` | ACTIVATED, SERVICED (pre-sale inspection / quality control), RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `ACTIVATED` | REGISTERED, OWNED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `REGISTERED` | OWNED, TRANSFERRED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `OWNED` | TRANSFERRED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `TRANSFERRED` | OWNED, TRANSFERRED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `SERVICED` | Return to the pre-service status (one of ISSUED, ACTIVATED, REGISTERED, OWNED, TRANSFERRED, RESOLD); RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `RESOLD` | REGISTERED, OWNED, SERVICED, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| `LOST`, `STOLEN` | Return to the previous status (one of ISSUED, ACTIVATED, REGISTERED, OWNED, TRANSFERRED, SERVICED, RESOLD); RETIRED, REVOKED |
| `COUNTERFEIT_FLAGGED` | Return to the previous status (same set); REVOKED, RETIRED |
| `REVOKED` | None through `transition`. Only reinstatement, back to the status held before the revocation (ADMIN). |
| `RETIRED` | None (terminal) |

"Return" moves are allowed only towards the one status held before the current episode. That status is derived by replaying `product_status_history`, never stored separately. When it cannot be determined (history edited outside the service), the move fails with `PREVIOUS_STATUS_UNKNOWN`. One exception: a first registration may move a SERVICED product to REGISTERED or OWNED even when that is not its pre-service status, **unless the service started before sale** (ISSUED → SERVICED, `isPreSaleService`): such a piece was never sold and returns to ISSUED when its service record is completed.

ISSUED → SERVICED is allowed for pre-sale inspection and quality control: a service record can be opened for an unsold product, and completing it returns the product to ISSUED.

### 7.3 Ownership state

`products.ownership_state` summarises the current ownership:

| Value | Meaning |
|---|---|
| `UNREGISTERED` | No current owner |
| `REGISTERED` | Current owner, not verified |
| `OWNED` | Current owner, verified |
| `TRANSFER_PENDING` | A transfer offer is pending |

`OwnershipService` maintains it. Admin status transitions through `POST /api/admin/products/:productId/transitions` change `status` only.

---

## 8. Transactions and locking

### 8.1 Transactions

- `inTransaction(db, fn)` opens a transaction, or **joins the caller's transaction** when `db` already is one, so services compose inside a larger unit of work (for example, `OwnershipService.registerFirst` calls `LifecycleService` and `AuditService` inside its own transaction).
- **Inside a transaction, every query goes through the transaction object** (`trx`), never the outer `db`. On PGlite, which has one connection, a query on the outer `db` would wait for the transaction to finish and deadlock. Service methods that can run inside a caller's transaction take an optional `trx` parameter (e.g. `AuditService.record(entry, trx)`).
- An audit entry is written in the same transaction as the change it describes, so both commit or roll back together.
- The code does not set an isolation level, so transactions run at the server default (READ COMMITTED unless the database was configured otherwise). Correctness relies on row locks, advisory locks and unique constraints.
- `IssuanceService` retries a whole issuance (up to 5 attempts, fresh transaction each time) on a serialisation failure (`40001`), a deadlock (`40P01`), a stale signing key, or a unique violation on an automatically allocated serial.
- The claim-code check commits its failure record (audit entry) in its own transaction before the error is returned, so failed attempts count even though the request fails. The recovery-code check does the same (`account.recover_failed`, §5.23).

### 8.2 Row locks

| Lock | Where |
|---|---|
| `products … FOR UPDATE` | Every lifecycle change, ownership operation, warranty change, service open/close, code revocation and re-issue. |
| `cryptographic_keys … FOR SHARE` | Issuance and re-issue: a code is never committed under a key that a concurrent rotation, retirement or revocation has already changed; issuance then retries with the new active key. |
| `cryptographic_keys … FOR UPDATE` | Retire and revoke. |
| `codes`, `service_records`, `ownership_transfers`, `anomalies … FOR UPDATE` | Code revocation, service completion, transfer acceptance, anomaly triage. |
| `accounts … FOR UPDATE` | Issuing a recovery code, each recovery attempt and the recovery itself (§5.23): attempts on one account run one at a time, so the attempt limit is exact. Locking and unlocking an account (§5.9). |
| `accounts … FOR NO KEY UPDATE` | A customer's sign-in, in the transaction that opens the session, and a password change, before it writes: a lock, a recovery or a password change in progress is waited for, then refuses it (the status or the password hash changed); one that starts after it waits, then ends the new session. Exclusive, not `FOR SHARE`: the same transaction may then write the row (the throttle reset, a re-hash, the new hash), and two share locks both upgraded to a write deadlock; concurrent sign-ins of one account run one after the other. Foreign-key checks (`FOR KEY SHARE`) are not blocked. |
| `accounts … FOR SHARE` | Transfer initiation and a LOST / STOLEN declaration, before the product: a request made while a recovery or a lock commits waits for it, then sees the pause or the lock (`403 ACCOUNT_LOCKED`). |
| `models` and `categories … FOR SHARE` | Issuance, in its transaction: the model's and the category's `active` are read again, so a deactivation that committed while the piece was prepared refuses it (`409 MODEL_INACTIVE`, `409 CATEGORY_INACTIVE`). |
| `models … FOR UPDATE`, `categories … FOR NO KEY UPDATE` | A model's edit, a category's activation or deactivation (A-10): waits for an issuance under way (its share lock above), and an issuance waits for it. |
| `collections … FOR UPDATE` | A collection's rename (A-10): two renames run one after the other. |

Lock order is **product before code**, **product before service record** and **account before product** (a recovery or a lock locks the account, then the products of its pending transfers, in product order), everywhere, so concurrent operations cannot deadlock on these pairs. The audit chain's advisory lock (§8.3) comes **last**: a transaction locks its rows, then records its audit entries (`cancelPendingTransfersFrom` locks and updates every product first, then audits each cancellation; `OwnerService.lock` revokes the recovery code before it cancels the transfers).

### 8.3 Advisory locks

Transaction-scoped advisory locks (`pg_advisory_xact_lock`, released at COMMIT or ROLLBACK) through `advisoryXactLock(trx, key, subKey?)`, which refuses to run outside a transaction. The keys share one `"OR"` namespace (`0x4F52…`) so services never collide.

| Name | Key | Serialises |
|---|---|---|
| `AUDIT_CHAIN` | `0x4F520001` | Audit appends: id allocation, predecessor lookup and insert, so `prev_hash` links follow commit order even across instances. Held until the commit: a transaction records its audit entries after taking its row locks (§8.2). |
| `CATEGORY_ALLOCATION` | `0x4F520002` | Category creation (lowest free index 1–31). |
| `SERIAL_ALLOCATION` | `0x4F520003`, sub-key `(year − 2000) × 32 + category index` | Serial allocation per (year, category) at issuance. Two-part (int4, int4) form. |
| `KEY_ROTATION` | `0x4F520004` | Key rotation, first-key creation, retirement and revocation. |
| `ANOMALY_UNREGISTERED` | `0x4F520101` | Recording of findings without a product id (`VALID_SIGNATURE_UNREGISTERED`), which the partial unique index cannot deduplicate. `services/anomaly.ts` keeps `ANOMALY_UNREGISTERED_LOCK` as an alias. |
| `ADMIN_ROSTER` | `0x4F520201` | Role changes and (de)activation of console users (`AuthService.setAdminRole`, `setAdminDisabled`): the last-active-ADMIN check sees every concurrent change, so two ADMINs disabling each other at once cannot leave none. |

In PostgreSQL, single-key (bigint) and two-key (int4, int4) advisory locks occupy separate key spaces. Kysely's migrator uses its own session-level advisory lock (§9.2).

---

## 9. Migrations

### 9.1 Layout

- Migrations are listed statically in `MIGRATIONS` in `db/migrate.ts` (imports, not a directory scan, so they still work when the server is bundled): `0001_initial` (the schema), `0002_platform_guards` (append-only `product_status_history`, no deletion of `genomes` and `cryptographic_keys`, the customer login throttle columns of `accounts`), `0003_authentication_events_default` (`authentication_events.authenticators` defaults to `'{}'`), `0004_scan_reports` (customers' reports on scans and the Cases queue, §5.22; its down step drops the table and nothing else), `0005_account_recovery` (the recovery codes of §5.23 and `accounts.transfers_frozen_until`; its down step drops the column and the table, which restores the schema of `0004` exactly), `0006_admin_password_change_required` (`admin_users.password_change_required`, boolean NOT NULL DEFAULT false: the temporary password of a staff account created from the console; its down step drops the column, which restores the schema of `0005` exactly, after ending the sessions of the accounts that still hold their temporary password and disabling them (`disabled_at` set, an earlier date kept): without the flag, such an account would sign in with a password an ADMIN was shown and use its full role for good. Re-enabling one after a rollback would let that password in; create a new account for the member instead), `0007_print_batch_indexes` (indexes `products_production_batch_idx` and `codes_created_at_idx`, for printing by production batch; indexes only, so the previous application version runs on it unchanged), `0008_retail_mode` (A-08, the sale mode: the RETAIL role in the `admin_users.role` CHECK, the `retailers` register (§5.25), `warranties.retailer_id`, `scan_events.admin_id` with its ADMIN_TEST-only CHECK, and the `SALE_ACTIVATION` purpose of `scan_tokens`; every new column nullable, so the previous image runs on it. Its down step restores the 0006 schema exactly: it first copies each warranty's point-of-sale name into an empty free-text `retailer`, deletes the outstanding SALE_ACTIVATION tokens and the sessions of the RETAIL accounts, and keeps those accounts but stops them working: each becomes AUDITOR, the lowest role the previous schema knows, and disabled (`disabled_at` set, an earlier date kept), so it cannot sign in. They are not deleted because other tables point to a console user with ON DELETE RESTRICT (0004 `scan_reports.handled_by`, 0005 `account_recovery_codes.created_by`): a member of the team who handled a case or issued a recovery code, then was stepped down to RETAIL on the Team page, would make the delete, and with it the whole rollback, fail; the audit log keeps their history by id either way. Trade-off: an ADMIN who re-enables such an account after a rollback gives it AUDITOR rights, so check its role first), `0009_scan_daily_stats` (the table `scan_daily_stats`, §5.24, which the previous version ignores; its down step drops it), `0010_models_active` (A-10: `models.active`, true for every existing model, and the trigger `models_immutable_identity` on a model's category and SKU prefix, §5.3; additions an older image ignores; its down step drops the trigger and the column and nothing else), `0011_scan_token_transfer_accept` (F-03: the `TRANSFER_ACCEPT` purpose of `scan_tokens`, §5.17; the CHECK is dropped and re-created with the three purposes, those of 0008 kept; the previous image never writes the new purpose. Its down step deletes the outstanding `TRANSFER_ACCEPT` tokens, 15-minute proofs nothing refers to, and restores the CHECK of 0008 exactly, `SALE_ACTIVATION` included), and any later entry of `MIGRATIONS`. Numbers follow the planned deployment order of the 2026-10-02 recommendations (0004 to 0013), each migration keeping its number whatever the order of development.
- A migration is a list of SQL strings executed one by one: PGlite runs queries through the extended protocol, which refuses multi-statement strings.
- Value lists for `CHECK` constraints are literal in the migration, so a migration never changes when application constants evolve; a test asserts they still match `schema.ts`.
- Rules: append new migrations to `MIGRATIONS`; never edit an applied migration.
- **Numbers follow the order of deployment, and a database applies them in that order only.** Kysely's migrator refuses a migration numbered below one already applied (unordered migrations are not allowed). The numbers `0004`–`0013` are reserved, lot by lot, by the plan of the 2026-10-02 recommendations, and a branch may carry a higher number before the lower ones exist, as `0010_models_active` once did before `0006`–`0009` were merged. Such a tip must not reach a database that will later need the lower numbers: deploy the lots in their order, each with all of its migrations.
- Kysely records applied migrations in `kysely_migration` and uses `kysely_migration_lock`; both tables are created on the first run.

### 9.2 Behaviour

- `migrateToLatest(db)` applies every pending migration and returns the names applied; a failure throws `MigrationError` naming the failed migration.
- Kysely 0.29 runs **all pending migrations of one call inside one transaction** (transactional DDL), under an advisory lock on PostgreSQL. Instances that start together therefore apply each migration exactly once, and a failure rolls back every migration of that run, not only the failing one: the schema is left unchanged. Migrations must therefore be transaction-safe (no `CREATE INDEX CONCURRENTLY`, no `VACUUM`).
- `migrationStatus(db)` lists every known migration with its execution time. `migrateDown(db)` rolls back the most recent migration; it is development tooling only (`scripts/db.ts reset-demo` rolls back one migration at a time until none is applied; `0001_initial`'s down step drops every object).

### 9.3 How to run them

| Environment | How |
|---|---|
| Development, test | Automatic: `createContext()` applies pending migrations at startup whenever the environment is `development` or `test` (`npm run dev`, `npm start`, and every test database). |
| Production | **Not automatic.** Start the server with `--migrate` (`npm start -- --migrate`) or with `MIGRATE_ON_START` set to `1`, `true` or `yes` (case-insensitive). Without either, the server refuses to start when migrations are pending, with "database schema is not up to date (pending: …); run the migrations first". |
| Stand-alone | `scripts/db.ts` against `DATABASE_URL`: `npm run db:migrate` (apply pending migrations; safe in production), `npm run db:status` (applied / PENDING per migration, `--json`), `npm run db:seed` (demo dataset into an empty database; refused in production) and `npm run db:reset-demo` (`tsx scripts/db.ts reset-demo --yes [--force]`: roll every migration back, migrate and reseed; refused in production). Signing keys: `scripts/keys.ts` (`npm run keys:generate`, `keys:rotate`, `keys:list`; `tsx scripts/keys.ts retire <id> --yes`, `revoke <id> --reason … [--compromised-at …] --yes`). Console users: `scripts/admin.ts` (`create`, `list`, `totp-setup`, `totp-enable`, `reset-totp`, `role`, `disable`, `enable`). See [DEPLOYMENT](DEPLOYMENT.md). |

Recommended production procedure: run the migration once, from a single deployment step with a role that owns the schema, then start the application instances without `--migrate` (they verify that nothing is pending).

### 9.4 First start

After the schema is current, `createContext()` also:

- loads the category cache;
- creates the bootstrap ADMIN from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` when no admin exists (idempotent and race-safe);
- in development and test, creates a signing key when none is ACTIVE; in production, runs a signing self-test instead and logs an error (issuance unavailable, verification unaffected) when there is no usable ACTIVE key. An ADMIN then creates one with `POST /api/admin/keys/rotate`, or an operator with `npm run keys:generate`.

---

## 10. Housekeeping and retention

`startHousekeeping()` runs every 10 minutes in the server process (never overlapping runs):

| Job | Effect |
|---|---|
| Sessions | Deletes sessions whose `expires_at` has passed. |
| Transfers | Marks overdue PENDING transfers EXPIRED and recomputes the product's `ownership_state`. |
| Scan tokens | Deletes scan tokens that expired more than 24 hours ago. |
| Scan statistics | Counts the scans of every complete UTC day not counted yet into `scan_daily_stats` (§5.24) by country, state and event type, `ADMIN_TEST` left out (`src/server/services/scan-stats.ts`). Idempotent; always runs before the scan history job. |
| Scan history | Only when `SCAN_RETENTION_DAYS` is set, and only when the scan statistics of the same pass succeeded (a scan never leaves the history before it is counted): deletes `scan_events` whose `occurred_at` is older than the period, together with the `scan_reports` (a customer's report, open or closed), `scan_tokens` and `authentication_events` that reference them (deleted first: the foreign keys are `ON DELETE RESTRICT`). Batches of 1 000 scan events, one short transaction each, at most 50 batches per pass, oldest first (`src/server/services/scan-retention.ts`). |

Rows deleted by the application: `sessions`, `scan_tokens`, and, with a retention period, old `scan_events` with their `authentication_events` and `scan_reports`. Every other table grows monotonically.

**Retention period.** `SCAN_RETENTION_DAYS` (whole days, 30–3650) is unset by default: scan history is then kept indefinitely, and production logs a `risky configuration` warning at every start. The period itself is a legal decision, to agree with counsel. Points to consider:

- the stored scan data is pseudonymous (HMACs of IP, device and session; coarse location; browser family), but pseudonymous data is still personal data in many jurisdictions; a customer's report (§5.22) adds their own words, which may name a person or a place, and goes with its scan;
- anomaly scoring only reads the recent history of a code (the longest of the configured windows and the decay period: 30 days with the default settings), so older scans are not needed for scoring. The configuration refuses a period shorter than that look-back (`scanLookbackDays` in `config.ts`);
- `anomalies` rows are not purged: they are case records reviewed by staff, keyed to the product, and keep their own first/last-seen times; `audit_logs` cannot be purged by the application and must not be edited, since that breaks the hash chain;
- the product page's scan count and the dashboard's scan figures count only the scans still stored; the console's Analytics view reads `scan_daily_stats` (§5.24), which keeps the counts by day, country, state and event type of every purged scan: a short period loses no trend, only the pseudonymous detail of each scan;
- rotating `IP_HASH_PEPPER` makes new pseudonyms unlinkable to old ones (which also resets device and IP diversity counting).

---

## 11. Backup, restore and point-in-time recovery

These are operational recommendations; the code does not implement backups.

**What a backup contains.** Product registry, codes and signatures, public keys, accounts (email, display name), staff accounts, password, claim-code and recovery-code hashes, sealed TOTP secrets, pseudonymous scan data and the audit log. It contains **no private signing keys** (they live in the key provider: `KEY_DIR` files encrypted under `KEY_ENCRYPTION_KEY`, or a KMS/HSM) and no usable session, registration or transfer tokens (only their hashes).

Recommendations:

1. **Continuous archiving with point-in-time recovery.** Use PostgreSQL WAL archiving plus periodic base backups (or the managed equivalent), so the registry can be restored to any moment before an incident such as a faulty bulk change or a compromised admin.
2. **Encrypt backups and restrict access** like the production database: they contain personal data and the pseudonymous scan history. Store `COOKIE_SECRET`, `IP_HASH_PEPPER` and `KEY_ENCRYPTION_KEY` in a secret manager, separately from database backups. A database backup plus `KEY_ENCRYPTION_KEY` (or `COOKIE_SECRET` when no key encryption key is set) is enough to open the stored TOTP secrets.
3. **Back up key custody separately.** Losing the private keys does not affect verification (public keys are in the database) but prevents issuing codes under those keys; rotate to a new key in that case. Never place key files in the same backup set as the database without separate encryption.
4. **Anchor the audit chain.** Export the head returned by `GET /api/admin/audit/verify` (`head.id`, `head.hash`) regularly to write-once storage. After any restore, run `GET /api/admin/audit/verify` and compare the restored head with the last exported anchor: a point-in-time restore legitimately drops the newest entries, and the anchor shows how many.
5. **Restore into an empty database.** `audit_logs` rejects `TRUNCATE`, `DELETE` and `UPDATE`, and categories cannot be deleted, so a restore over existing data fails by design.
6. **Use separate roles.** Let a migration role own the schema and give the application role only `SELECT`, `INSERT`, `UPDATE` and `DELETE` on the tables, `USAGE` on the sequences and `SELECT` on `kysely_migration` (the production start-up check reads it). The guard triggers stop the application role, but a table owner or superuser can disable them.
7. **Test restores** on a schedule: restore, start a server against the copy (it refuses to start if migrations are missing), verify the audit chain and verify a known code end to end.

---

## 12. Mapping of the specification's product fields

The master specification (§3) describes a product with flat fields. They map to the schema as follows; `product_overview` exposes all of them under these names.

| Spec field | Stored in | `product_overview` column | Notes |
|---|---|---|---|
| `product_id` | `products.product_id` | `product_id` | Canonical text id `O26-J-00184`. The row uuid is `products.id` (view column `id`). |
| `sku` | `products.sku` | `sku` | Defaults to model SKU prefix + variant slug. |
| `category` | `categories.name` via `products.category_id` | `category` | Letter in `category_code`, 5-bit index in `category_id`. |
| `collection` | `collections.name` via `COALESCE(products.collection_id, models.collection_id)` | `collection` | NULL when neither the product nor its model has one. |
| `model` | `models.name` via `products.model_id` | `model` | Type (e.g. RING) in `model_type`. |
| `variant` | `products.variant` | `variant` | |
| `material` | `products.material` | `material` | |
| `production_batch` | `products.production_batch` | `production_batch` | |
| `production_date` | `products.production_date` | `production_date` | `'YYYY-MM-DD'` |
| `genome_id` | `genomes.genome_id` (current genome) | `genome_id` | Text equal to the product id. Not the uuid `genomes.id`. |
| `genome_pattern` | `genomes.pattern` (current genome) | `genome_pattern` | Glyph ids joined by `·`. Fingerprint in `genome_fingerprint`. |
| `code_version` | `codes.code_version` (ACTIVE code) | `code_version` | 1 = CODE-01. NULL when the product has no ACTIVE code. Issue number in `code_issue`. |
| `status` | `products.status` | `status` | §7.1 |
| `warranty_start` | `warranties.start_date` | `warranty_start` | NULL until activation. |
| `warranty_end` | `warranties.end_date` | `warranty_end` | NULL until activation. |
| `ownership_state` | `products.ownership_state` | `ownership_state` | §7.3 |
| `created_at` | `products.created_at` | `created_at` | |
| `updated_at` | `products.updated_at` | `updated_at` | |
